import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { createFamilyId, createPerson, personDeathStatus } from '../game/government.ts';
import { leadershipOptions, successionOrder } from '../game/succession.ts';
import { clearSaveBytes } from '../game/storage.ts';
import { World } from '../game/world.ts';

function makeFixture() {
  const world = World.create('random', 7721);
  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: null,
  });
  country.government = 'hereditary';
  country.modifiers = ['primogeniture', 'coRule'];
  const pixels = Array.from(world.landIndex.slice(0, 32));
  const cultureMix = world.cultureTable.single(culture.id, 100);
  for (const pixel of pixels) {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 80;
    world.humidity[pixel] = 50;
    world.temperature[pixel] = 50;
    world.drainage[pixel] = 50;
    world.culture[pixel] = cultureMix;
  }
  world.recountCountries();
  assert.ok(world.addCity(country.id, pixels[0], 1, true));
  return { world, country, pixels };
}

function addChild(world, country, parent, year = 1000) {
  const otherParent = createPerson(year, 30, createFamilyId(), [], country.cultureId, country.religionId);
  otherParent.countryId = country.id;
  world.people.push(otherParent);
  const child = createPerson(year, 25, parent.familyId, [parent.id, otherParent.id], country.cultureId, country.religionId);
  child.countryId = country.id;
  world.people.push(child);
  if (!country.dynastyClaims.includes(child.familyId)) country.dynastyClaims.push(child.familyId);
  return child;
}

function worldAddSecondCity(fixture) {
  const city = fixture.world.addCity(fixture.country.id, fixture.pixels[1], 1, false);
  assert.ok(city, 'the second city is added to the fixture country');
}

function addForeignDynast(world, country, age = 30) {
  const candidate = createPerson(1000, age, createFamilyId(), [], country.cultureId, country.religionId);
  candidate.gender = 'male';
  candidate.countryId = country.id;
  world.people.push(candidate);
  country.dynastyClaims.push(candidate.familyId);
  return candidate;
}

async function saveAndLoad(game) {
  await game.saveNow();
  const restored = await Game.load();
  assert.ok(restored, 'the in-progress game loads');
  return restored;
}

const previousPersist = Game.persist;
const previousPause = Game.pause;
Game.persist = true;
Game.pause = async () => {};
try {
  // Peaceful succession with partition suppresses a foreign dynasty only while
  // at least two eligible successors of the current ruler remain and there is
  // more than one city. Death succession keeps its existing candidate pool.
  {
    const zeroHeirs = makeFixture();
    zeroHeirs.country.modifiers = ['partition'];
    worldAddSecondCity(zeroHeirs);
    const outsider = addForeignDynast(zeroHeirs.world, zeroHeirs.country);
    const zeroOptions = leadershipOptions(zeroHeirs.world, zeroHeirs.country, 1000, zeroHeirs.country.ruler, {
      peacefulTransfer: true,
    });
    assert.ok(zeroOptions.some((candidate) => candidate.familyId === outsider.familyId),
      'a foreign dynasty is allowed when there are no eligible heirs');

    const oneHeir = makeFixture();
    oneHeir.country.modifiers = ['partition'];
    worldAddSecondCity(oneHeir);
    addChild(oneHeir.world, oneHeir.country, oneHeir.country.ruler);
    const oneOutsider = addForeignDynast(oneHeir.world, oneHeir.country, 35);
    const oneOptions = leadershipOptions(oneHeir.world, oneHeir.country, 1000, oneHeir.country.ruler, {
      peacefulTransfer: true,
    });
    assert.ok(oneOptions.some((candidate) => candidate.familyId === oneOutsider.familyId),
      'a foreign dynasty is allowed when exactly one eligible heir remains');

    const ineligibleHeir = makeFixture();
    ineligibleHeir.country.modifiers = ['partition', 'patriarchal'];
    worldAddSecondCity(ineligibleHeir);
    const eligibleChild = addChild(ineligibleHeir.world, ineligibleHeir.country, ineligibleHeir.country.ruler);
    eligibleChild.gender = 'male';
    const disallowedChild = addChild(ineligibleHeir.world, ineligibleHeir.country, ineligibleHeir.country.ruler);
    disallowedChild.gender = 'female';
    const ineligibleCaseOutsider = addForeignDynast(ineligibleHeir.world, ineligibleHeir.country, 35);
    const ineligibleCaseOptions = leadershipOptions(
      ineligibleHeir.world, ineligibleHeir.country, 1000, ineligibleHeir.country.ruler, { peacefulTransfer: true },
    );
    assert.ok(ineligibleCaseOptions.some((candidate) => candidate.familyId === ineligibleCaseOutsider.familyId),
      'a related candidate rejected by the country inheritance rules does not count as an eligible heir');

    const multipleHeirs = makeFixture();
    multipleHeirs.country.modifiers = ['partition'];
    worldAddSecondCity(multipleHeirs);
    addChild(multipleHeirs.world, multipleHeirs.country, multipleHeirs.country.ruler);
    addChild(multipleHeirs.world, multipleHeirs.country, multipleHeirs.country.ruler);
    const blockedOutsider = addForeignDynast(multipleHeirs.world, multipleHeirs.country, 35);
    const peacefulOptions = leadershipOptions(
      multipleHeirs.world, multipleHeirs.country, 1000, multipleHeirs.country.ruler, { peacefulTransfer: true },
    );
    assert.ok(peacefulOptions.every((candidate) => candidate.familyId !== blockedOutsider.familyId),
      'a foreign dynasty is excluded when multiple eligible heirs and multiple cities remain');
    const deathOptions = leadershipOptions(multipleHeirs.world, multipleHeirs.country, 1000);
    assert.ok(deathOptions.some((candidate) => candidate.familyId === blockedOutsider.familyId),
      'the regular succession candidate pool is unchanged for death events');

    const singleCity = makeFixture();
    singleCity.country.modifiers = ['partition'];
    addChild(singleCity.world, singleCity.country, singleCity.country.ruler);
    addChild(singleCity.world, singleCity.country, singleCity.country.ruler);
    const cityException = addForeignDynast(singleCity.world, singleCity.country, 35);
    const cityOptions = leadershipOptions(singleCity.world, singleCity.country, 1000, singleCity.country.ruler, {
      peacefulTransfer: true,
    });
    assert.ok(cityOptions.some((candidate) => candidate.familyId === cityException.familyId),
      'a single city allows a foreign dynasty despite multiple eligible heirs');

    const noPartition = makeFixture();
    noPartition.country.modifiers = [];
    worldAddSecondCity(noPartition);
    addChild(noPartition.world, noPartition.country, noPartition.country.ruler);
    addChild(noPartition.world, noPartition.country, noPartition.country.ruler);
    const noPartitionOutsider = addForeignDynast(noPartition.world, noPartition.country, 35);
    const noPartitionOptions = leadershipOptions(
      noPartition.world, noPartition.country, 1000, noPartition.country.ruler, { peacefulTransfer: true },
    );
    assert.ok(noPartitionOptions.some((candidate) => candidate.familyId === noPartitionOutsider.familyId),
      'countries without partition retain the existing foreign-dynasty option');
  }

  // A ruler's death transfers the office to an eligible descendant and keeps the death record.
  const deathFixture = makeFixture();
  const ruler = deathFixture.country.ruler;
  const heir = addChild(deathFixture.world, deathFixture.country, ruler);
  const deathGame = new Game(deathFixture.world, 'all');
  deathGame.applyCharacterEvent(deathFixture.country, { kind: 'death', personIds: [ruler.id] }, null);
  assert.equal(deathFixture.country.ruler.id, heir.id, 'the eligible descendant succeeds the dead ruler');
  assert.equal(ruler.alive, false, 'succession preserves the ruler death');
  assert.equal(personDeathStatus(ruler), `умер${ruler.gender === 'female' ? 'ла' : ''} в 1000 году`,
    'the deceased ruler biography retains the year');

  // A dead co-ruler is replaced while the living primary ruler remains in office.
  const coFixture = makeFixture();
  const primary = coFixture.country.ruler;
  const coRuler = createPerson(1000, 30, primary.familyId, [], coFixture.country.cultureId, null);
  coRuler.countryId = coFixture.country.id;
  coFixture.world.people.push(coRuler);
  coFixture.country.coRulerIds = [coRuler.id];
  const coSuccessor = addChild(coFixture.world, coFixture.country, coRuler);
  const coGame = new Game(coFixture.world, 'all');
  coGame.applyCharacterEvent(coFixture.country, { kind: 'death', personIds: [coRuler.id] }, null);
  assert.equal(coFixture.country.ruler.id, primary.id, 'the living primary ruler is unchanged');
  assert.equal(coFixture.country.coRulerIds[0], coSuccessor.id, 'the eligible descendant succeeds the dead co-ruler');
  assert.equal(coRuler.alive, false, 'the co-ruler death remains in the record');

  // A government without a valid dynastic candidate still uses the existing new-citizen fallback.
  const fallbackFixture = makeFixture();
  const deceased = fallbackFixture.country.ruler;
  fallbackFixture.country.government = 'republic';
  fallbackFixture.country.modifiers = [];
  const fallbackGame = new Game(fallbackFixture.world, 'all');
  fallbackGame.applyCharacterEvent(fallbackFixture.country, { kind: 'death', personIds: [deceased.id] }, null);
  assert.notEqual(fallbackFixture.country.ruler.id, deceased.id, 'the fallback replaces a deceased ruler');
  assert.equal(fallbackFixture.country.ruler.alive, true, 'the fallback leader is alive');

  // Loading an inconsistent save repairs both dead office holders and preserves history.
  await clearSaveBytes();
  const staleFixture = makeFixture();
  const oldRuler = staleFixture.country.ruler;
  addChild(staleFixture.world, staleFixture.country, oldRuler);
  const oldCoRuler = createPerson(1000, 30, oldRuler.familyId, [], staleFixture.country.cultureId, null);
  oldCoRuler.countryId = staleFixture.country.id;
  staleFixture.world.people.push(oldCoRuler);
  addChild(staleFixture.world, staleFixture.country, oldCoRuler);
  staleFixture.country.coRulerIds = [oldCoRuler.id];
  const oldNomadRuler = createPerson(1000, 35, createFamilyId(), [], staleFixture.country.cultureId, null);
  oldNomadRuler.countryId = staleFixture.country.id;
  staleFixture.world.people.push(oldNomadRuler);
  const nomadHeir = addChild(staleFixture.world, staleFixture.country, oldNomadRuler);
  const nomad = staleFixture.world.newCountry({
    rank: 'кочевье',
    cultureId: staleFixture.country.cultureId,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: staleFixture.country.id,
  });
  nomad.type = 'nomadic';
  nomad.government = 'tribal';
  nomad.modifiers = ['oligarchy'];
  nomad.ruler = oldNomadRuler;
  nomad.heir = null;
  nomad.previousRulerIds = [];
  nomad.dynastyClaims = [oldNomadRuler.familyId];
  nomad.coRulerIds = [];
  nomad.cells = [{
    pixel: staleFixture.pixels[1],
    population: 80,
    cultureMix: staleFixture.world.cultureTable.single(staleFixture.country.cultureId, 100),
    religionMix: 0,
  }];
  nomad.range = [staleFixture.pixels[1]];
  nomad.sourceCountryId = staleFixture.country.id;
  nomad.pixels = 0;
  oldNomadRuler.countryId = nomad.id;
  nomadHeir.countryId = nomad.id;
  const expectedRuler = successionOrder(staleFixture.world, staleFixture.country, oldRuler)[0];
  const expectedCoRuler = successionOrder(staleFixture.world, staleFixture.country, oldCoRuler)[0];
  oldRuler.alive = false;
  oldRuler.deathYear = 997;
  oldRuler.deathReason = 'старость';
  oldCoRuler.alive = false;
  oldCoRuler.deathYear = 998;
  oldCoRuler.deathReason = 'болезнь';
  oldNomadRuler.alive = false;
  oldNomadRuler.deathYear = 996;
  oldNomadRuler.deathReason = 'старость';
  const staleGame = new Game(staleFixture.world, 'all');
  const restored = await saveAndLoad(staleGame);
  const restoredCountry = restored.world.countries[staleFixture.country.id];
  assert.ok(expectedRuler, 'the fixture has an eligible successor for the main ruler');
  assert.ok(expectedCoRuler, 'the fixture has an eligible successor for the co-ruler');
  assert.equal(restoredCountry.ruler.id, expectedRuler.id, 'load restores the main ruler using succession');
  assert.equal(restoredCountry.coRulerIds[0], expectedCoRuler.id, 'load restores the co-ruler using succession');
  assert.equal(restored.world.countries[nomad.id].ruler.id, nomadHeir.id, 'load restores a dead nomadic-country ruler using succession');
  const restoredDead = restored.world.people.find((person) => person.id === oldRuler.id);
  assert.equal(restoredDead.alive, false, 'load does not revive the deceased ruler');
  assert.equal(restoredDead.deathYear, 997, 'load preserves the death year');
  assert.equal(personDeathStatus(restoredDead),
    `умер${restoredDead.gender === 'female' ? 'ла' : ''} в 997 году`,
    'the death biography remains available after load');
  const restoredDeadNomadRuler = restored.world.people.find((person) => person.id === oldNomadRuler.id);
  assert.equal(restoredDeadNomadRuler.alive, false, 'nomad load does not revive the deceased ruler');
  assert.equal(restoredDeadNomadRuler.deathYear, 996, 'nomad load preserves the death year');

  // A consistent saved ruler is not changed by the load repair.
  await clearSaveBytes();
  const livingFixture = makeFixture();
  const livingRulerId = livingFixture.country.ruler.id;
  const livingGame = new Game(livingFixture.world, 'all');
  const livingRestored = await saveAndLoad(livingGame);
  assert.equal(livingRestored.world.countries[livingFixture.country.id].ruler.id, livingRulerId,
    'load keeps an ordinary living ruler unchanged');
} finally {
  await clearSaveBytes();
  Game.persist = previousPersist;
  Game.pause = previousPause;
}

console.log('Dead ruler and save recovery regressions passed.');
