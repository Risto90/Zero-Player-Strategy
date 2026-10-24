import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { consulDeathChoices, governmentEventWeight } from '../game/cards.ts';
import { createFamilyId, createPerson } from '../game/government.ts';
import { Game } from '../game/game.ts';
import { reformCandidates } from '../game/politics.ts';
import { ensureOffices, expectedHeirFor, rulers } from '../game/succession.ts';
import { MAP_HEIGHT, MAP_WIDTH } from '../game/config.ts';
import { World } from '../game/world.ts';
import { chronicleReference, isChronicleImportant } from '../game/chronicle.ts';

function makeFixture(cityCount, seed = 8516) {
  const world = World.create('random', seed);
  const width = 60;
  const x0 = Math.floor((MAP_WIDTH - width) / 2);
  const y = Math.floor(MAP_HEIGHT / 2);
  const pixels = Array.from({ length: width }, (_, column) => y * MAP_WIDTH + x0 + column);
  const previousLand = new Set(world.landIndex);
  for (const pixel of pixels) world.land[pixel] = 1;
  world.landIndex = Int32Array.from([...world.landIndex, ...pixels.filter((pixel) => !previousLand.has(pixel))]);

  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 10,
    foundedYear: 1000,
    parentId: null,
    government: 'hereditary',
  });
  country.government = 'hereditary';
  const cultureMix = world.cultureTable.single(culture.id, 100);
  for (const pixel of pixels) {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 10;
    world.culture[pixel] = cultureMix;
  }
  const cityColumns = [3, 13, 23, 33, 43, 53].slice(0, cityCount);
  cityColumns.forEach((column, index) => {
    assert.ok(world.addCity(country.id, pixels[column], 1, index === 0), 'fixture city is created');
  });
  world.recountCountries();
  return { world, country, pixels };
}

function addChild(world, country, parent, index) {
  const child = createPerson(1000, 25, parent.familyId, [parent.id], country.cultureId, country.religionId);
  child.name = `Наследник ${index + 1}`;
  child.countryId = country.id;
  world.people.push(child);
  return child;
}

function addIncumbent(world, country, index) {
  const incumbent = createPerson(1000, 35, createFamilyId(), [], country.cultureId, country.religionId);
  incumbent.name = `Консул ${index + 1}`;
  incumbent.countryId = country.id;
  world.people.push(incumbent);
  return incumbent;
}

function checkPartition({ childrenCount, incumbentCount, cityCount, expectedParts, expectedSeatedChildren }) {
  const { world, country, pixels } = makeFixture(cityCount, 8516 + childrenCount + incumbentCount + cityCount);
  country.modifiers = ['consulate', 'partition'];
  country.consulCount = 3;
  const deceased = country.ruler;
  const children = Array.from({ length: childrenCount }, (_, index) => addChild(world, country, deceased, index));
  const incumbents = Array.from({ length: incumbentCount }, (_, index) => addIncumbent(world, country, index));
  deceased.alive = false;
  country.ruler = children[0];
  country.coRulerIds = incumbents.map((leader) => leader.id);
  children[0].formerRulerOf.push(country.id);

  const game = new Game(world, 'country');
  game.focusCountryId = country.id;
  game.addLog('Давняя запись до наследственного разделения', [
    { type: 'country', id: country.id },
  ], [chronicleReference('country', country.id)]);
  game.partitionCountry(country, deceased, children[0]);

  const states = world.countries.filter((state) => state.id === country.id || state.parentId === country.id);
  assert.equal(states.length, expectedParts,
    `the formula selects the expected number of countries: ${JSON.stringify({ childrenCount, incumbentCount, cityCount, expectedParts, log: game.getSnapshot().log })}`);
  const predecessorEntry = game.log.find(({ text }) => text === 'Давняя запись до наследственного разделения');
  assert.equal(isChronicleImportant(predecessorEntry, chronicleReference('country', country.id)), true,
    'the source country keeps its own importance marker during a pending split');
  assert.deepEqual(
    predecessorEntry.objects.filter(({ type }) => type === 'country').map(({ id }) => id).sort((a, b) => a - b),
    [country.id],
    'the predecessor keeps its history while the player is still painting the pending split',
  );
  const pending = game.pendingInheritanceSplit;
  assert.equal(pending.destinationIds.length, expectedParts - 1);
  assert.ok(pending.quotas.every((quota) => quota === Math.floor(pixels.length / expectedParts) ||
    quota === Math.ceil(pixels.length / expectedParts)), 'the existing split quotas cover the formula-selected countries');
  for (const state of states) {
    assert.equal(state.government, 'hereditary', 'each country keeps the original government');
    assert.ok(state.modifiers.includes('partition') && state.modifiers.includes('consulate'));
    assert.equal(state.consulCount, 3, 'each country keeps the original consulate degree');
    ensureOffices(world, state, 1000);
    assert.equal(rulers(world, state).filter((leader) => leader.alive).length, 3,
      'each country has exactly its inherited number of active consuls');
  }
  const allLeaders = states.flatMap((state) => rulers(world, state).filter((leader) => leader.alive));
  const seatedChildren = children.filter((child) => allLeaders.some((leader) => leader.id === child.id));
  assert.equal(seatedChildren.length, expectedSeatedChildren,
    'as many children as the city-limited number of consulate seats are appointed');
  assert.equal(children.length - seatedChildren.length, childrenCount - expectedSeatedChildren);
  for (const child of seatedChildren) {
    assert.equal(allLeaders.filter((leader) => leader.id === child.id).length, 1,
      `${child.name} has exactly one consular seat`);
  }
  for (const incumbent of incumbents) {
    assert.equal(allLeaders.filter((leader) => leader.id === incumbent.id).length, 1,
      `${incumbent.name} keeps one office`);
  }
  game.discard();
}

// The five/six-child examples, both death-order R values, and the city cap.
checkPartition({ childrenCount: 5, incumbentCount: 1, cityCount: 5, expectedParts: 2, expectedSeatedChildren: 5 });
checkPartition({ childrenCount: 5, incumbentCount: 2, cityCount: 5, expectedParts: 3, expectedSeatedChildren: 5 });
checkPartition({ childrenCount: 6, incumbentCount: 1, cityCount: 5, expectedParts: 3, expectedSeatedChildren: 6 });
checkPartition({ childrenCount: 5, incumbentCount: 2, cityCount: 2, expectedParts: 2, expectedSeatedChildren: 4 });

// An automatically completed inheritance split transfers the archive to each heir state.
{
  const { world, country } = makeFixture(5, 8611);
  country.modifiers = ['consulate', 'partition'];
  country.consulCount = 3;
  const deceased = country.ruler;
  const children = Array.from({ length: 5 }, (_, index) => addChild(world, country, deceased, index));
  const incumbent = addIncumbent(world, country, 1);
  deceased.alive = false;
  country.ruler = children[0];
  country.coRulerIds = [incumbent.id];
  children[0].formerRulerOf.push(country.id);

  const game = new Game(world, 'observer');
  game.addLog('Давняя запись до наследственного разделения', [{ type: 'country', id: country.id }],
    [chronicleReference('country', country.id)]);
  game.partitionCountry(country, deceased, children[0]);
  const states = world.countries.filter((state) => state.id === country.id || state.parentId === country.id);
  assert.ok(states.length > 1, 'the automatic split creates successor states');
  const predecessorEntry = game.log.find(({ text }) => text === 'Давняя запись до наследственного разделения');
  assert.deepEqual(
    predecessorEntry.objects.filter(({ type }) => type === 'country').map(({ id }) => id).sort((a, b) => a - b),
    states.map(({ id }) => id).sort((a, b) => a - b),
    'every completed heir state receives the source archive',
  );
  assert.ok(states.every(({ id }) => isChronicleImportant(predecessorEntry, chronicleReference('country', id))),
    'the split history keeps its importance in each successor country');
  const splitEvent = game.log.find(({ text }) => text.includes('страна разделена'));
  assert.ok(splitEvent, 'the completed split is recorded in the chronicle');
  assert.ok(states.every(({ id }) => isChronicleImportant(splitEvent, chronicleReference('country', id))),
    'country split is important in every resulting country history');
  assert.ok(world.cities.filter((city) => states.some((state) => state.id === city.countryId))
    .every((city) => !isChronicleImportant(splitEvent, chronicleReference('city', city.chronicleId))),
  'country split does not mark related city histories important');
  game.discard();
}

// Expected heirs are resolved separately for each active consul's family line.
{
  const { world, country } = makeFixture(3, 9101);
  country.government = 'hereditary';
  country.modifiers = ['consulate', 'partition', 'primogeniture'];
  const main = country.ruler;
  const second = addIncumbent(world, country, 20);
  country.coRulerIds = [second.id];
  country.dynastyClaims.push(second.familyId);
  const mainChild = addChild(world, country, main, 0);
  const secondChild = addChild(world, country, second, 1);
  assert.equal(expectedHeirFor(world, country, main)?.id, mainChild.id);
  assert.equal(expectedHeirFor(world, country, second)?.id, secondChild.id);
}

// Reforms use the specified adjustments only with partition/consulate active.
{
  const { world, country } = makeFixture(4, 9201);
  const children = Array.from({ length: 6 }, (_, index) => addChild(world, country, country.ruler, index));
  country.modifiers = ['partition'];
  const withPartition = reformCandidates(world, country, 1000).find((proposal) => proposal.add === 'consulate');
  country.modifiers = [];
  const withoutPartition = reformCandidates(world, country, 1000).find((proposal) => proposal.add === 'consulate');
  assert.ok(withPartition && withoutPartition);
  assert.ok(Math.abs(withPartition.weight - withoutPartition.weight * children.length / 4) < 1e-9,
    'consulate introduction is scaled by eligible heirs over city count when partition is present');

  country.modifiers = ['consulate', 'partition'];
  country.consulCount = 3;
  const increase = reformCandidates(world, country, 1000).find((proposal) => proposal.consulCount === 4);
  const decrease = reformCandidates(world, country, 1000).find((proposal) => proposal.consulCount === 2);
  const cancellation = reformCandidates(world, country, 1000).find((proposal) => proposal.remove === 'consulate');
  assert.ok(increase);
  assert.ok(Math.abs(increase.weight - 0.35 * (children.length - 3) / 4 / 3) < 1e-9);
  assert.ok(decrease);
  assert.ok(Math.abs(decrease.weight - 0.35 / 3) < 1e-9);
  assert.equal(cancellation, undefined, 'the consulate cannot be cancelled above degree two');
  const adjustedEvent = governmentEventWeight(world, country, 1000, false, 1 / 3);
  const adjustedWeight = reformCandidates(world, country, 1000).reduce((sum, proposal) => sum + proposal.weight, 0);
  const baseline = { ...country, modifiers: ['consulate'] };
  const baselineWeight = reformCandidates(world, baseline, 1000).reduce((sum, proposal) => sum + proposal.weight, 0);
  assert.ok(Math.abs(adjustedEvent - (0.16 / 3) * adjustedWeight / baselineWeight) < 1e-9,
    'government-card probability follows the sum of available adjusted reform weights');

  country.consulCount = 2;
  const cancellationAtTwo = reformCandidates(world, country, 1000).find((proposal) => proposal.remove === 'consulate');
  assert.ok(cancellationAtTwo, 'cancellation becomes available at degree two');
  country.modifiers = ['consulate'];
  const ordinaryDecrease = reformCandidates(world, country, 1000).find((proposal) => proposal.consulCount === 1);
  assert.equal(ordinaryDecrease, undefined, 'outside partition/consulate, the base degree floor stays unchanged');
  const ordinaryEvent = governmentEventWeight(world, country, 1000, false, 1 / 2);
  assert.equal(ordinaryEvent, 0.08, 'outside the combination, the ordinary consulate card weight is unchanged');
}

// Missing heir options are filled from residents/generated candidates; 50% can replace
// a fallback with the explicit choice to close the office.
{
  const { world, country } = makeFixture(2, 9301);
  country.modifiers = ['consulate'];
  const deceased = country.ruler;
  const local = addIncumbent(world, country, 30);
  country.coRulerIds = [local.id];
  const previousRandom = Math.random;
  try {
    Math.random = () => 0;
    const declineOptions = consulDeathChoices(world, country, 1000, deceased);
    assert.equal(declineOptions.length, 2);
    assert.ok(declineOptions.some((choice) => choice.closeConsulateSeat));
    assert.ok(declineOptions.some((choice) => choice.ruler));
    Math.random = () => 0.99;
    const appointmentOptions = consulDeathChoices(world, country, 1000, deceased);
    assert.equal(appointmentOptions.length, 2);
    assert.ok(appointmentOptions.every((choice) => choice.ruler),
      'the ordinary fallback choices remain available when the no-appointment option is not drawn');
  } finally {
    Math.random = previousRandom;
  }
}

// Closing a dead co-consul seat decreases the degree without replacing the vacancy.
{
  const { world, country } = makeFixture(2, 9401);
  country.modifiers = ['consulate'];
  country.consulCount = 3;
  const first = addIncumbent(world, country, 40);
  const second = addIncumbent(world, country, 41);
  country.coRulerIds = [first.id, second.id];
  const game = new Game(world, 'observer');
  game.applyCharacterEvent(country, { kind: 'death', personIds: [first.id] }, null, {
    label: 'Не назначать консула',
    detail: 'Закрыть место.',
    closeConsulateSeat: true,
  });
  assert.equal(country.consulCount, 2);
  assert.deepEqual(country.coRulerIds, [second.id]);
  assert.equal(rulers(world, country).filter((leader) => leader.alive).length, 2);
  game.discard();
}

// The profile label always includes the consul-seat count in parentheses.
{
  const profile = readFileSync('app/country/[id].tsx', 'utf8');
  assert.match(profile, /Консулат \(\$\{country\.consulCount\}\)/);
}

console.log('Consulate inheritance and reform regressions passed.');
