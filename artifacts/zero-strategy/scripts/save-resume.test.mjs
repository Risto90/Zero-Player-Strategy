import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { mulberry32 } from '../game/random.ts';
import { World } from '../game/world.ts';
import { clearSaveBytes } from '../game/storage.ts';
import { dissolveCountryIntoNomads } from '../game/nomads.ts';
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
    targetNomadId: null,
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
    nomads: structuredClone(world.nomads),
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
  uninterrupted.discard();
  resumed.discard();

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
  const [nomad] = dissolveCountryIntoNomads(nomadFixture.world, nomadFixture.country);
  assert.ok(nomad, 'the fixture country becomes a nomad group');
  const resident = registerPerson(nomadFixture.world, nomad, newCitizen(nomadFixture.world, nomad, 1001));
  const nomadGame = new Game(nomadFixture.world, 'all');
  await nomadGame.saveNow();
  const nomadResumed = await Game.load();
  assert.ok(nomadResumed, 'the saved nomadic world can be loaded');
  const restoredResident = nomadResumed.world.people.find((person) => person.id === resident.id);
  assert.equal(restoredResident?.countryId, -1, 'a loaded nomadic resident does not return to the source country');
  assert.equal(restoredResident?.nomadId, 0, 'a loaded nomadic resident keeps the current nomad ID');
  assert.ok(nomadResumed.world.nomads[0].personIds.includes(resident.id),
    'a loaded nomadic resident remains in the group registry');
  assert.equal(nomadResumed.world.nomads[0].sourceCountryId, nomadFixture.country.id,
    'the source country remains available as historical metadata');
  nomadGame.discard();
  nomadResumed.discard();
} finally {
  await clearSaveBytes();
  Game.persist = previousPersist;
  Game.pause = previousPause;
}

console.log('Save/resume parity passed for painted cards, selected options, and pending city placement.');
