import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { mulberry32 } from '../game/random.ts';
import { World } from '../game/world.ts';
import { clearSaveBytes } from '../game/storage.ts';
import { availableNomadCitySites, dissolveCountryIntoNomadicCountries, settleNomadAsCountry } from '../game/nomads.ts';
import { newCitizen, registerPerson } from '../game/characters.ts';

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
  for (const offset of [0, 4, 8, 12]) {
    assert.ok(world.addCity(country.id, pixels[offset], 1, offset === 0));
  }
  return { world, country, pixels };
}

function makeCard(type, updates = {}) {
  return {
    type,
    title: type,
    detail: type,
    ink: 12,
    inkTotal: 12,
    targetCountryId: null,
    newCountryId: null,
    newCultureId: null,
    newReligionId: null,
    sourceCultureId: null,
    newGovernmentId: null,
    newRuler: null,
    choices: null,
    selectedChoice: 0,
    characterEvent: null,
    hint: -1,
    ...updates,
  };
}

function worldState(world) {
  const rasters = Object.fromEntries(
    ['owner', 'density', 'humidity', 'temperature', 'drainage', 'culture', 'religion'].map((key) => {
      const raster = world[key];
      return [key, Buffer.from(raster.buffer, raster.byteOffset, raster.byteLength)];
    }),
  );
  return {
    rasters,
    countries: structuredClone(world.countries),
    cities: structuredClone(world.cities),
    cultures: structuredClone(world.cultures),
    religions: structuredClone(world.religions),
    people: structuredClone(world.people),
  };
}

function sameResult(left, right, name) {
  assert.deepEqual(worldState(left.world), worldState(right.world), `${name}: final world`);
  assert.deepEqual(left.log, right.log, `${name}: card effects and log`);
}

function withSeed(seed, callback) {
  const previousRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return callback();
  } finally {
    Math.random = previousRandom;
  }
}

async function saveAndLoad(game) {
  await game.saveNow();
  const restored = await Game.load();
  assert.ok(restored, 'a saved in-progress card can be loaded');
  return restored;
}

const previousPersist = Game.persist;
const previousPause = Game.pause;
Game.persist = true;
Game.pause = async () => {};
try {
  // A completed brush stroke must remain protected from a second application.
  await clearSaveBytes();
  const fixture = makeFixture();
  const uninterrupted = new Game(fixture.world, 'all');
  uninterrupted.addLog('Связь с объектом сохранена', [{ type: 'country', id: fixture.country.id }]);
  const card = makeCard('rain', { targetCountryId: fixture.country.id, hint: fixture.pixels[16] });
  uninterrupted.card = card;
  uninterrupted.startCard(card);
  const pixel = fixture.pixels[16];
  uninterrupted.dispatchAction({ type: 'dab', x: pixel % MAP_WIDTH, y: Math.floor(pixel / MAP_WIDTH), radius: 0 });
  const savedInk = card.ink;
  assert.ok(savedInk < card.inkTotal, 'the first brush application spends ink');

  const resumed = await saveAndLoad(uninterrupted);
  assert.equal(resumed.getSnapshot().card.ink, savedInk, 'remaining ink is restored');
  assert.equal(resumed.getSnapshot().card.selectedChoice, 0, 'the current choice is restored');
  assert.deepEqual(resumed.getSnapshot().chronicle[0], {
    year: 1000,
    text: 'Связь с объектом сохранена',
    objects: [{ type: 'country', id: fixture.country.id }],
    important: false,
  }, 'object links in new chronicle entries survive save/load');
  const resumePixel = fixture.pixels[16];
  resumed.dispatchAction({
    type: 'dab', x: resumePixel % MAP_WIDTH, y: Math.floor(resumePixel / MAP_WIDTH), radius: 0,
  });
  uninterrupted.dispatchAction({
    type: 'dab', x: pixel % MAP_WIDTH, y: Math.floor(pixel / MAP_WIDTH), radius: 0,
  });
  uninterrupted.dispatchAction({ type: 'completeCard' });
  resumed.dispatchAction({ type: 'completeCard' });
  sameResult(uninterrupted, resumed, 'painted climate card');
  assert.match(uninterrupted.getSnapshot().chronicle[0].text, /Ливни/u, 'the painted weather event is recorded');
  assert.deepEqual(uninterrupted.getSnapshot().chronicle[0].objects, [{ type: 'country', id: fixture.country.id }],
    'events explicitly link to the affected country');
  uninterrupted.discard();
  resumed.discard();

  const globalFixture = makeFixture();
  const globalWeather = new Game(globalFixture.world, 'all');
  const globalPixel = globalFixture.pixels[16];
  const globalCard = makeCard('rain', { hint: globalPixel });
  globalWeather.card = globalCard;
  globalWeather.startCard(globalCard);
  globalWeather.dispatchAction({
    type: 'dab', x: globalPixel % MAP_WIDTH, y: Math.floor(globalPixel / MAP_WIDTH), radius: 0,
  });
  globalWeather.dispatchAction({ type: 'completeCard' });
  assert.deepEqual(globalWeather.getSnapshot().chronicle[0].objects, [
    { type: 'country', id: globalFixture.country.id },
  ], 'a world-area event links to the country that owned the changed land');
  globalWeather.discard();

  // Colonization logging depends on counts that are not reconstructible from the raster.
  await clearSaveBytes();
  const colonizationFixture = makeFixture();
  const colonizationGame = new Game(colonizationFixture.world, 'all');
  const colonizationCard = makeCard('colonization', {
    targetCountryId: colonizationFixture.country.id,
    ink: 20,
    inkTotal: 20,
  });
  colonizationGame.card = colonizationCard;
  colonizationGame.startCard(colonizationCard);
  const target = colonizationGame.painter.colonizationMask?.findIndex((value) => value === 1) ?? -1;
  assert.ok(target >= 0, 'the fixture has a colonization target');
  colonizationGame.dispatchAction({
    type: 'dab', x: target % MAP_WIDTH, y: Math.floor(target / MAP_WIDTH), radius: 0,
  });
  assert.ok(colonizationGame.painter.changed.length > 0, 'the first colonization dab changes land');
  assert.ok(colonizationGame.painter.colonistsMoved > 0, 'the first colonization dab moves population');
  const colonizationChanged = colonizationGame.painter.changed.length;
  const colonizationMoved = colonizationGame.painter.colonistsMoved;
  const colonizationResumed = await saveAndLoad(colonizationGame);
  assert.equal(colonizationResumed.painter.changed.length, colonizationChanged,
    'the number of colonized pixels is restored');
  assert.equal(colonizationResumed.painter.colonistsMoved, colonizationMoved,
    'the number of moved residents is restored');
  colonizationGame.dispatchAction({ type: 'completeCard' });
  colonizationResumed.dispatchAction({ type: 'completeCard' });
  sameResult(colonizationGame, colonizationResumed, 'colonization effects');
  colonizationGame.discard();
  colonizationResumed.discard();

  // A selected non-brush option remains selected and drives the same completion effect.
  await clearSaveBytes();
  const choiceFixture = makeFixture();
  const choiceGame = new Game(choiceFixture.world, 'all');
  const choiceCard = makeCard('government', {
    targetCountryId: choiceFixture.country.id,
    ink: 0,
    inkTotal: 0,
    choices: [
      { label: 'Республика', detail: 'Республика', government: 'republic' },
      { label: 'Тирания', detail: 'Тирания', government: 'tyranny' },
    ],
  });
  choiceGame.card = choiceCard;
  choiceGame.startCard(choiceCard);
  choiceGame.selectChoice(1);
  const choiceResumed = await saveAndLoad(choiceGame);
  assert.equal(choiceResumed.getSnapshot().card.selectedChoice, 1, 'the selected option is restored');
  choiceGame.dispatchAction({ type: 'completeCard' });
  choiceResumed.dispatchAction({ type: 'completeCard' });
  sameResult(choiceGame, choiceResumed, 'selected government option');
  choiceGame.discard();
  choiceResumed.discard();

  // A city card remains pending after load and completes only after the same placement.
  await clearSaveBytes();
  const cityFixture = makeFixture();
  const cityGame = new Game(cityFixture.world, 'all');
  const cityPixel = cityFixture.pixels[2];
  const cityCard = makeCard('buildCity', {
    targetCountryId: cityFixture.country.id,
    ink: 0,
    inkTotal: 0,
    hint: cityPixel,
  });
  cityGame.card = cityCard;
  cityGame.startCard(cityCard);
  const cityResumed = await saveAndLoad(cityGame);
  assert.equal(cityResumed.getSnapshot().cityPlacementAvailable, true, 'pending city placement is restored');
  const x = cityPixel % MAP_WIDTH, y = Math.floor(cityPixel / MAP_WIDTH);
  withSeed(78701, () => {
    assert.equal(cityGame.selectCityAt(x, y), true);
    cityGame.dispatchAction({ type: 'completeCard' });
  });
  withSeed(78701, () => {
    assert.equal(cityResumed.selectCityAt(x, y), true);
    cityResumed.dispatchAction({ type: 'completeCard' });
  });
  sameResult(cityGame, cityResumed, 'pending city placement');
  cityGame.discard();
  cityResumed.discard();

  // Nomadic residents keep their current home through the persisted save/load path.
  await clearSaveBytes();
  const nomadFixture = makeFixture();
  const [nomad] = dissolveCountryIntoNomadicCountries(nomadFixture.world, nomadFixture.country, 1001);
  assert.ok(nomad, 'the fixture country becomes a nomadic country');
  const resident = registerPerson(nomadFixture.world, nomad, newCitizen(nomadFixture.world, nomad, 1001));
  const nomadGame = new Game(nomadFixture.world, 'all');
  nomadGame.addLog('История кочевой страны', [{ type: 'country', id: nomad.id }], true);
  await nomadGame.saveNow();
  const nomadResumed = await Game.load();
  assert.ok(nomadResumed, 'the saved nomadic world can be loaded');
  const restoredResident = nomadResumed.world.people.find((person) => person.id === resident.id);
  assert.equal(restoredResident?.countryId, nomad.id, 'a loaded nomadic resident keeps the country ID');
  assert.equal('nomadId' in restoredResident, false, 'the saved character has no separate nomad ID');
  assert.equal(nomadResumed.world.countries[nomad.id].type, 'nomadic');
  assert.equal(nomadResumed.world.countries[nomad.id].sourceCountryId, nomadFixture.country.id,
    'the source country remains available as historical metadata');
  const nomadicHistory = nomadResumed.getSnapshot().chronicle.find(({ text }) => text === 'История кочевой страны');
  assert.equal(nomadicHistory.important, true, 'nomadic country history saves its importance marker');
  assert.deepEqual(nomadicHistory.objects, [{ type: 'country', id: nomad.id }],
    'nomadic country history keeps its typed link after loading');
  const settlementSite = availableNomadCitySites(nomadGame.world, nomad)[0];
  assert.notEqual(settlementSite, undefined, 'the nomad has a valid settlement site');
  const settledNomad = settleNomadAsCountry(nomadGame.world, nomad, settlementSite, 1002);
  assert.equal(settledNomad?.id, nomad.id, 'settlement converts the existing country object');
  assert.equal(nomadGame.log[0].important, true, 'settling keeps the original history importance');
  assert.deepEqual(nomadGame.log[0].objects, [{ type: 'country', id: nomad.id }],
    'settling keeps the historical country link on the same successor ID');
  nomadGame.discard();
  nomadResumed.discard();

  // The global archive has no rolling cap, including through a persisted save.
  await clearSaveBytes();
  const archiveFixture = makeFixture();
  const archiveGame = new Game(archiveFixture.world, 'all');
  for (let index = 0; index < 140; index += 1) {
    archiveGame.addLog(`Архивная запись ${index}`, [{ type: 'country', id: archiveFixture.country.id }], index === 0);
  }
  await archiveGame.saveNow();
  const archiveResumed = await Game.load();
  assert.ok(archiveResumed, 'the full chronicle archive can be loaded');
  assert.equal(archiveResumed.getSnapshot().chronicle.length, 140, 'saving preserves entries beyond the old rolling cap');
  assert.equal(archiveResumed.getSnapshot().chronicle.at(-1).important, true,
    'an old important entry remains marked after saving and loading');
  assert.equal(archiveResumed.getSnapshot().log.length, 120,
    'the compatibility log projection remains bounded independently of the archive');
  archiveGame.discard();
  archiveResumed.discard();

  // Annexation moves all source-country links to the surviving country.
  const mergeFixture = makeFixture();
  const absorbed = mergeFixture.world.newCountry({
    rank: 'тест',
    cultureId: mergeFixture.country.cultureId,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: mergeFixture.country.id,
  });
  for (const pixel of mergeFixture.pixels.slice(20)) mergeFixture.world.setOwner(pixel, absorbed.id + 1);
  mergeFixture.world.recountCountries();
  const mergeGame = new Game(mergeFixture.world, 'all');
  mergeGame.addLog('Старая летопись присоединённой страны', [
    { type: 'country', id: absorbed.id },
    { type: 'city', id: mergeFixture.world.cities[0].id },
  ], true);
  mergeGame.mergeCountries(mergeFixture.country, absorbed);
  const annexedHistory = mergeGame.log.find(({ text }) => text === 'Старая летопись присоединённой страны');
  assert.equal(annexedHistory.important, true, 'annexation preserves the importance marker');
  assert.ok(annexedHistory.objects.some(({ type, id }) => type === 'country' && id === mergeFixture.country.id),
    'the surviving country inherits the predecessor record');
  assert.ok(!annexedHistory.objects.some(({ type, id }) => type === 'country' && id === absorbed.id),
    'annexed history no longer points at the absorbed country');
  assert.ok(annexedHistory.objects.some(({ type, id }) => type === 'city' && id === mergeFixture.world.cities[0].id),
    'annexation leaves links to other affected objects unchanged');
  mergeGame.discard();

  // Dissolution into nomadic successors retains the global entry and replaces its country link.
  const collapseFixture = makeFixture();
  collapseFixture.world.cities = [];
  const collapseGame = new Game(collapseFixture.world, 'all');
  collapseGame.addLog('История распавшейся страны', [
    { type: 'country', id: collapseFixture.country.id },
    { type: 'culture', id: collapseFixture.country.cultureId },
  ], true);
  collapseGame.finish({
    card: makeCard('rain'),
    changed: [],
    colonistsMoved: 0,
    dispose() {},
  });
  const nomadicSuccessors = collapseFixture.world.countries.filter((country) => country.type === 'nomadic');
  assert.ok(nomadicSuccessors.length > 0, 'the test country actually dissolves into nomadic successors');
  const dissolvedHistory = collapseGame.log.find(({ text }) => text === 'История распавшейся страны');
  assert.equal(dissolvedHistory.important, true, 'dissolution keeps the important entry');
  assert.ok(!dissolvedHistory.objects.some(({ type, id }) => type === 'country' && id === collapseFixture.country.id),
    'dissolution removes the obsolete source-country link');
  assert.deepEqual(
    dissolvedHistory.objects.filter(({ type }) => type === 'country').map(({ id }) => id).sort((a, b) => a - b),
    nomadicSuccessors.map(({ id }) => id).sort((a, b) => a - b),
    'every nomadic successor inherits the source country record',
  );
  assert.ok(dissolvedHistory.objects.some(({ type, id }) => type === 'culture' && id === collapseFixture.country.cultureId),
    'dissolution preserves the separate culture reference');
  collapseGame.discard();
} finally {
  await clearSaveBytes();
  Game.persist = previousPersist;
  Game.pause = previousPause;
}

console.log('Save/resume parity passed for painted cards, selected options, and pending city placement.');
