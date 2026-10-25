import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { mulberry32 } from '../game/random.ts';
import { World } from '../game/world.ts';
import { clearSaveBytes } from '../game/storage.ts';
import { availableNomadCitySites, dissolveCountryIntoNomadicCountries, settleNomadAsCountry } from '../game/nomads.ts';
import { newCitizen, registerPerson } from '../game/characters.ts';
import { filterChronicle, chronicleReference, isChronicleImportant } from '../game/chronicle.ts';
import { appoint, countryRulerHistory } from '../game/succession.ts';

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
    ['owner', 'density', 'humidity', 'temperature', 'drainage', 'culture', 'religion', 'humanOrigins'].map((key) => {
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
  // Repeated ruler appointments survive the actual game save/load path.
  await clearSaveBytes();
  const tenureFixture = makeFixture();
  const firstRuler = tenureFixture.country.ruler;
  const secondRuler = newCitizen(tenureFixture.world, tenureFixture.country, 1005);
  appoint(tenureFixture.world, tenureFixture.country, secondRuler, 1005);
  appoint(tenureFixture.world, tenureFixture.country, firstRuler, 1010);
  const tenureGame = new Game(tenureFixture.world, 'all');
  await tenureGame.saveNow();
  const tenureResumed = await Game.load();
  assert.ok(tenureResumed, 'a world with recorded ruler terms can be loaded');
  assert.deepEqual(countryRulerHistory(tenureResumed.world, tenureResumed.world.countries[tenureFixture.country.id])
    .map(({ person, startYear, endYear }) => [person.id, startYear, endYear]), [
    [firstRuler.id, 1000, 1005],
    [secondRuler.id, 1005, 1010],
    [firstRuler.id, 1010, null],
  ], 'all separate appointments and their end years survive save/load');
  tenureGame.discard();
  tenureResumed.discard();

  // Saves created before the colonization map mode was removed load on the
  // ordinary political view while preserving the active card mechanics.
  await clearSaveBytes();
  const legacyModeGame = new Game(makeFixture().world, 'all');
  legacyModeGame.mapMode = 'colonization';
  await legacyModeGame.saveNow();
  const legacyModeResumed = await Game.load();
  assert.ok(legacyModeResumed, 'a save containing the retired view can be loaded');
  assert.equal(legacyModeResumed.mapMode, 'political', 'the retired view migrates to political colors');
  assert.equal(legacyModeResumed.renderer.mode, 'political', 'the loaded renderer uses the migrated view');
  legacyModeGame.discard();
  legacyModeResumed.discard();

  // Existing saves with the retired nomadic view also return to the combined
  // political map, where nomadic ranges are now an overlay.
  await clearSaveBytes();
  const legacyNomadModeGame = new Game(makeFixture().world, 'all');
  legacyNomadModeGame.mapMode = 'nomads';
  await legacyNomadModeGame.saveNow();
  const legacyNomadModeResumed = await Game.load();
  assert.ok(legacyNomadModeResumed, 'a save with the retired nomadic view can be loaded');
  assert.equal(legacyNomadModeResumed.mapMode, 'political', 'the old nomadic view migrates to political colors');
  assert.equal(legacyNomadModeResumed.renderer.mode, 'political', 'the loaded renderer uses the combined view');
  legacyNomadModeGame.discard();
  legacyNomadModeResumed.discard();

  // An explicit player pause survives a save and can be cleared through the same toggle.
  await clearSaveBytes();
  const pausedGame = new Game(makeFixture().world, 'all');
  pausedGame.togglePause();
  const pausedResumed = await saveAndLoad(pausedGame);
  assert.equal(pausedResumed.getSnapshot().paused, true, 'the saved game restores the player pause');
  pausedResumed.togglePause();
  assert.equal(pausedResumed.getSnapshot().paused, false, 'the normal pause button resumes a loaded game');
  pausedGame.discard();
  pausedResumed.discard();

  // Automatic turn processing is not written as a resumable interruption.
  await clearSaveBytes();
  const processingGame = new Game(makeFixture().world, 'all');
  const savedYear = processingGame.year;
  await processingGame.saveNow();
  processingGame.busy = true;
  processingGame.year += 1;
  processingGame.togglePause();
  await processingGame.saveNow();
  const processingResumed = await Game.load();
  assert.ok(processingResumed, 'the previous completed state remains loadable during turn processing');
  assert.equal(processingResumed.year, savedYear, 'an incomplete automatic turn is not persisted');
  assert.equal(processingResumed.getSnapshot().paused, false,
    'a pause requested during automatic processing is not saved as a separate turn interruption');
  processingGame.discard();
  processingResumed.discard();

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
    importantObjects: [],
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
  assert.deepEqual(colonizationGame.log[0].importantObjects, [],
    'colonization records are not country-important');
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
  assert.deepEqual(choiceGame.log[0].importantObjects, [], 'ordinary government reforms are not important events');
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
  const foundedCity = cityGame.world.cities.at(-1);
  const cityCreation = cityGame.log[0];
  assert.equal(isChronicleImportant(cityCreation, chronicleReference('city', foundedCity.chronicleId)), true,
    'a newly founded city gets its own important event marker');
  assert.equal(isChronicleImportant(cityCreation, chronicleReference('country', cityFixture.country.id)), false,
    'building a city does not make the existing country event-important');
  cityGame.discard();
  cityResumed.discard();

  // Creating a country also records the newly founded culture, but no unrelated profile.
  const creationFixture = makeFixture();
  const newCulture = creationFixture.world.newCulture(null, 1000);
  const newCountry = creationFixture.world.newCountry({
    rank: 'тестовая страна',
    cultureId: newCulture.id,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: null,
  });
  const foundingPixel = creationFixture.world.landIndex.find((pixel) =>
    creationFixture.world.owner[pixel] === 0 && !creationFixture.world.cityAt(pixel));
  assert.notEqual(foundingPixel, undefined, 'the fixture has unused land for a new country');
  creationFixture.world.setOwner(foundingPixel, newCountry.id + 1);
  creationFixture.world.density[foundingPixel] = 80;
  creationFixture.world.culture[foundingPixel] = creationFixture.world.cultureTable.single(newCulture.id, 100);
  creationFixture.world.recountCountries();
  const foundingCity = creationFixture.world.addCity(newCountry.id, foundingPixel, 1, true);
  assert.ok(foundingCity, 'the new country gets its founding city');
  const countryCreationGame = new Game(creationFixture.world, 'all');
  countryCreationGame.finish({
    card: makeCard('create', { newCountryId: newCountry.id, newCultureId: newCulture.id }),
    changed: [],
    colonistsMoved: 0,
    dispose() {},
  });
  const countryCreation = countryCreationGame.log[0];
  assert.equal(isChronicleImportant(countryCreation, chronicleReference('country', newCountry.id)), true,
    'country creation is marked in the country history');
  assert.equal(isChronicleImportant(countryCreation, chronicleReference('culture', newCulture.id)), true,
    'the new culture created with the country is marked in its own history');
  assert.equal(isChronicleImportant(countryCreation, chronicleReference('city', foundingCity.chronicleId)), true,
    'the founding city is marked in its own history');
  assert.equal(isChronicleImportant(countryCreation, chronicleReference('country', creationFixture.country.id)), false,
    'country creation does not mark an unrelated country');
  countryCreationGame.discard();

  const faithFixture = makeFixture();
  const newReligion = faithFixture.world.newReligion(1000);
  const faithGame = new Game(faithFixture.world, 'all');
  faithGame.finish({
    card: makeCard('faith', {
      newReligionId: newReligion.id,
      targetCountryId: faithFixture.country.id,
      ink: 0,
      inkTotal: 1,
    }),
    changed: [],
    colonistsMoved: 0,
    dispose() {},
  });
  const faithCreation = faithGame.log[0];
  assert.equal(isChronicleImportant(faithCreation, chronicleReference('religion', newReligion.id)), true,
    'new religion creation is important in its own history');
  assert.equal(isChronicleImportant(faithCreation, chronicleReference('country', faithFixture.country.id)), false,
    'new religion creation does not mark the affected country important');
  faithGame.discard();

  const cultureFixture = makeFixture();
  const parentCulture = cultureFixture.world.cultures[cultureFixture.country.cultureId];
  const splitCulture = cultureFixture.world.newCulture(parentCulture, 1000);
  const cultureGame = new Game(cultureFixture.world, 'all');
  cultureGame.finish({
    card: makeCard('culture', {
      newCultureId: splitCulture.id,
      sourceCultureId: parentCulture.id,
      targetCountryId: cultureFixture.country.id,
      ink: 0,
      inkTotal: 1,
    }),
    changed: [],
    colonistsMoved: 0,
    dispose() {},
  });
  const cultureSplit = cultureGame.log[0];
  assert.equal(isChronicleImportant(cultureSplit, chronicleReference('culture', splitCulture.id)), true,
    'culture split is important in the new culture history');
  assert.equal(isChronicleImportant(cultureSplit, chronicleReference('culture', parentCulture.id)), true,
    'culture split is important in the source culture history');
  assert.equal(isChronicleImportant(cultureSplit, chronicleReference('country', cultureFixture.country.id)), false,
    'culture split does not mark the affected country important');
  cultureGame.discard();

  // A city can wane or fall, and both marks stay scoped to that city's stable identity.
  const waningFixture = makeFixture();
  const waningCity = waningFixture.world.cities[1];
  waningCity.rank = 2;
  waningCity.population = 80;
  const waningGame = new Game(waningFixture.world, 'all');
  waningGame.finish({
    card: makeCard('waneCity', {
      targetCountryId: waningFixture.country.id,
      choices: [{ label: 'Увядание', detail: 'Увядание', cityId: waningCity.id }],
    }),
    changed: [],
    colonistsMoved: 0,
    dispose() {},
  });
  const waningEvent = waningGame.log[0];
  assert.match(waningEvent.text, /увял/u, 'the city waning action is recorded');
  assert.equal(isChronicleImportant(waningEvent, chronicleReference('city', waningCity.chronicleId)), true,
    'city waning is important in that city history');
  assert.equal(isChronicleImportant(waningEvent, chronicleReference('country', waningFixture.country.id)), false,
    'city waning is not country-important');
  waningGame.discard();

  const cityFallFixture = makeFixture();
  const fallenByEvent = cityFallFixture.world.cities[1];
  fallenByEvent.population = 80;
  const cityFallGame = new Game(cityFallFixture.world, 'all');
  cityFallGame.finish({
    card: makeCard('waneCity', {
      targetCountryId: cityFallFixture.country.id,
      choices: [{ label: 'Падение', detail: 'Падение', cityId: fallenByEvent.id }],
    }),
    changed: [],
    colonistsMoved: 0,
    dispose() {},
  });
  const cityFallEvent = cityFallGame.log[0];
  assert.match(cityFallEvent.text, /удалён/u, 'the city fall action is recorded');
  assert.equal(isChronicleImportant(cityFallEvent, chronicleReference('city', fallenByEvent.chronicleId)), true,
    'city fall remains important in the fallen city archive');
  assert.equal(isChronicleImportant(cityFallEvent, chronicleReference('country', cityFallFixture.country.id)), false,
    'city fall is not country-important');
  cityFallGame.discard();

  // A fallen city keeps its stable archive link after array-index IDs shift.
  await clearSaveBytes();
  const fallenCityFixture = makeFixture();
  const fallenCity = fallenCityFixture.world.cities[1];
  const shiftedCity = fallenCityFixture.world.cities[2];
  const fallenChronicleId = fallenCity.chronicleId;
  const shiftedChronicleId = shiftedCity.chronicleId;
  const fallenCityGame = new Game(fallenCityFixture.world, 'all');
  fallenCityGame.addLog('Падение города', [{ type: 'city', id: fallenChronicleId }],
    [chronicleReference('city', fallenChronicleId)]);
  fallenCityFixture.world.removeCity(fallenCity.id);
  assert.equal(shiftedCity.id, fallenCity.id, 'removing a city still compacts current display indices');
  assert.equal(shiftedCity.chronicleId, shiftedChronicleId, 'compacting display indices does not change archive identity');
  assert.equal(filterChronicle(fallenCityGame.log, [chronicleReference('city', shiftedChronicleId)]).length, 0,
    'a neighboring city does not inherit the fallen city event');
  assert.equal(filterChronicle(fallenCityGame.log, [chronicleReference('city', fallenChronicleId)]).length, 1,
    'the fallen city record remains linked to its own archive identity');
  await fallenCityGame.saveNow();
  const fallenCityResumed = await Game.load();
  assert.ok(fallenCityResumed, 'the fallen city chronicle save loads');
  assert.equal(isChronicleImportant(fallenCityResumed.getSnapshot().chronicle[0], chronicleReference('city', fallenChronicleId)), true,
    'the fallen city importance survives save/load');
  const addedAfterLoad = fallenCityResumed.world.addCity(
    fallenCityFixture.country.id, fallenCityFixture.pixels[20], 1,
  );
  assert.ok(addedAfterLoad && addedAfterLoad.chronicleId > Math.max(fallenChronicleId, shiftedChronicleId),
    'new cities do not reuse archived identities after loading');
  fallenCityGame.discard();
  fallenCityResumed.discard();

  // Nomadic residents keep their current home through the persisted save/load path.
  await clearSaveBytes();
  const nomadFixture = makeFixture();
  const [nomad] = dissolveCountryIntoNomadicCountries(nomadFixture.world, nomadFixture.country, 1001);
  assert.ok(nomad, 'the fixture country becomes a nomadic country');
  assert.equal(nomad.rulerTerms[0].startYear, 1001, 'the new nomadic country begins its ruler timeline on the conversion year');
  assert.equal(nomadFixture.country.rulerTerms[0].endYear, 1001, 'the former settled country closes its ruler term on the conversion year');
  const resident = registerPerson(nomadFixture.world, nomad, newCitizen(nomadFixture.world, nomad, 1001));
  const nomadGame = new Game(nomadFixture.world, 'all');
  nomadGame.addLog('История кочевой страны', [{ type: 'country', id: nomad.id }], [chronicleReference('country', nomad.id)]);
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
  assert.equal(isChronicleImportant(nomadicHistory, chronicleReference('country', nomad.id)), true,
    'nomadic country history saves its object-specific importance marker');
  assert.deepEqual(nomadicHistory.objects, [{ type: 'country', id: nomad.id }],
    'nomadic country history keeps its typed link after loading');
  const settlementSite = availableNomadCitySites(nomadGame.world, nomad)[0];
  assert.notEqual(settlementSite, undefined, 'the nomad has a valid settlement site');
  const settledNomad = settleNomadAsCountry(nomadGame.world, nomad, settlementSite, 1002);
  assert.equal(settledNomad?.id, nomad.id, 'settlement converts the existing country object');
  assert.equal(isChronicleImportant(nomadGame.log[0], chronicleReference('country', nomad.id)), true,
    'settling keeps the original country importance');
  assert.deepEqual(nomadGame.log[0].objects, [{ type: 'country', id: nomad.id }],
    'settling keeps the historical country link on the same successor ID');
  nomadGame.finish({
    card: makeCard('buildCity', { newCountryId: nomad.id, cityPlaced: true }),
    changed: [],
    colonistsMoved: 0,
    dispose() {},
  });
  const settlementEvent = nomadGame.log.find(({ text }) => text.includes('кочевье осело'));
  const settlementCity = nomadGame.world.cities.find((city) => city.countryId === nomad.id);
  assert.ok(settlementCity, 'the settled country has a founding city');
  assert.equal(isChronicleImportant(settlementEvent, chronicleReference('country', nomad.id)), true,
    'transition to settled form is important in the country history');
  assert.equal(isChronicleImportant(settlementEvent,
    chronicleReference('city', settlementCity.chronicleId)), true,
  'the city founded during settlement is marked in its own history');
  assert.equal(isChronicleImportant(settlementEvent,
    chronicleReference('culture', settledNomad.cultureId)), false,
  'country settlement does not make the culture history important');
  nomadGame.discard();
  nomadResumed.discard();

  // Thousands of archived entries, including old important profile history, survive persistence.
  await clearSaveBytes();
  const archiveFixture = makeFixture();
  const archiveGame = new Game(archiveFixture.world, 'all');
  const archiveSize = 3000;
  for (let index = 0; index < archiveSize; index += 1) {
    archiveGame.addLog(
      `Архивная запись ${index}`,
      [{ type: 'country', id: archiveFixture.country.id }],
      index === 0 ? [chronicleReference('country', archiveFixture.country.id)] : [],
    );
  }
  await archiveGame.saveNow();
  const archiveResumed = await Game.load();
  assert.ok(archiveResumed, 'the full chronicle archive can be loaded');
  const restoredChronicle = archiveResumed.getSnapshot().chronicle;
  assert.equal(restoredChronicle.length, archiveSize, 'saving and loading preserves thousands of chronicle entries');
  assert.equal(isChronicleImportant(restoredChronicle.at(-1), chronicleReference('country', archiveFixture.country.id)), true,
    'the oldest important event remains marked for its country after loading');
  assert.equal(restoredChronicle.at(-1).text, 'Архивная запись 0',
    'the oldest important event remains accessible at the end of the loaded archive');
  assert.ok(filterChronicle(restoredChronicle, [chronicleReference('country', archiveFixture.country.id)])
    .some((entry) => entry.text === 'Архивная запись 0' &&
      isChronicleImportant(entry, chronicleReference('country', archiveFixture.country.id))),
  'an old important event remains available in the country profile after loading');
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
    { type: 'city', id: mergeFixture.world.cities[0].chronicleId },
  ], [chronicleReference('country', absorbed.id)]);
  mergeGame.mergeCountries(mergeFixture.country, absorbed);
  const annexedHistory = mergeGame.log.find(({ text }) => text === 'Старая летопись присоединённой страны');
  assert.equal(isChronicleImportant(annexedHistory, chronicleReference('country', mergeFixture.country.id)), true,
    'annexation transfers the source-country importance to the surviving country');
  assert.ok(annexedHistory.objects.some(({ type, id }) => type === 'country' && id === mergeFixture.country.id),
    'the surviving country inherits the predecessor record');
  assert.ok(!annexedHistory.objects.some(({ type, id }) => type === 'country' && id === absorbed.id),
    'annexed history no longer points at the absorbed country');
  assert.ok(annexedHistory.objects.some(({ type, id }) => type === 'city' && id === mergeFixture.world.cities[0].chronicleId),
    'annexation leaves links to other affected objects unchanged');
  const mergerEvent = mergeGame.log.find(({ text }) => text.includes('мирно объединилась'));
  assert.equal(isChronicleImportant(mergerEvent, chronicleReference('country', mergeFixture.country.id)), true,
    'the receiving country has an important absorption record');
  assert.equal(isChronicleImportant(mergerEvent, chronicleReference('country', absorbed.id)), true,
    'the absorbed country has an important absorption record');
  assert.equal(isChronicleImportant(mergerEvent, chronicleReference('city', mergeFixture.world.cities[0].chronicleId)), false,
    'country absorption does not mark merged cities important');
  mergeGame.discard();

  // Dissolution into nomadic successors retains the global entry and replaces its country link.
  const collapseFixture = makeFixture();
  collapseFixture.world.cities = [];
  const collapseGame = new Game(collapseFixture.world, 'all');
  collapseGame.addLog('История распавшейся страны', [
    { type: 'country', id: collapseFixture.country.id },
    { type: 'culture', id: collapseFixture.country.cultureId },
  ], [chronicleReference('country', collapseFixture.country.id)]);
  collapseGame.finish({
    card: makeCard('rain'),
    changed: [],
    colonistsMoved: 0,
    dispose() {},
  });
  const nomadicSuccessors = collapseFixture.world.countries.filter((country) => country.type === 'nomadic');
  assert.ok(nomadicSuccessors.length > 0, 'the test country actually dissolves into nomadic successors');
  const dissolutionEvent = collapseGame.log.find(({ text }) => text.includes('страна распущена'));
  assert.equal(isChronicleImportant(dissolutionEvent,
    chronicleReference('country', collapseFixture.country.id)), true,
  'the dissolved source country keeps the transition in its own chronicle');
  assert.ok(nomadicSuccessors.every(({ id }) => isChronicleImportant(dissolutionEvent, chronicleReference('country', id))),
    'the move into nomadic form is important for every successor country');
  assert.equal(isChronicleImportant(dissolutionEvent,
    chronicleReference('culture', collapseFixture.country.cultureId)), false,
  'a country transition does not make the culture history important');
  const dissolvedHistory = collapseGame.log.find(({ text }) => text === 'История распавшейся страны');
  assert.ok(nomadicSuccessors.every(({ id }) =>
    isChronicleImportant(dissolvedHistory, chronicleReference('country', id))),
  'dissolution transfers country importance to each nomadic successor');
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
