import { strict as assert } from 'node:assert';
import { Game } from '../game/game.ts';
import {
  drawBuildCityCard,
  drawSplitCard,
  drawUpgradeCityCard,
  drawWaneCityCard,
  cityWaningWeight,
} from '../game/cards.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { mulberry32 } from '../game/random.ts';
import {
  applyCityWaning,
  applyDensityGrowth,
  applyDensityLoss,
  canUpgradeCityRank,
  cityAtUpperPopulationThreshold,
  cityAtWaningThreshold,
  cityPopulationMaximum,
  cityPopulationMinimum,
  CityInfluenceIndex,
  populationAtPixel,
  resizeCityPopulation,
} from '../game/settlements.ts';
import { encodeSave } from '../game/saveFile.ts';
import { serializeWorld } from '../game/persistence.ts';
import { writeSaveBytes } from '../game/storage.ts';
import { World } from '../game/world.ts';

function makeCountry(pixelCount, cityRanks = []) {
  const world = World.create('random', 4321);
  const culture = world.newCulture(null, 0);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 10,
    foundedYear: 0,
    parentId: null,
  });
  const pixels = Array.from(world.landIndex.slice(0, pixelCount));
  const cultureMix = world.cultureTable.single(culture.id, 100);
  for (const pixel of pixels) {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 10;
    world.culture[pixel] = cultureMix;
  }
  const cities = cityRanks.map((rank, index) =>
    world.addCity(country.id, pixels[index], rank, index === 0),
  );
  assert.ok(cities.every(Boolean), 'fixture cities should be created');
  return { world, country, pixels, cities };
}

function totalOwnedPopulation(world) {
  let total = 0;
  for (const pixel of world.landIndex) {
    if (world.owner[pixel] > 0) total += populationAtPixel(world, pixel);
  }
  return total;
}

function makeNearbyCityFixture(cityCount, foreignFrom = Infinity, countryPixels = 0) {
  const world = World.create('random', 82731);
  const culture = world.newCulture(null, 0);
  const main = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 10,
    foundedYear: 0,
    parentId: null,
  });
  const foreign = foreignFrom < cityCount
    ? world.newCountry({
      rank: 'тест',
      cultureId: culture.id,
      religionId: null,
      density: 10,
      foundedYear: 0,
      parentId: null,
    })
    : null;
  let locations = [];
  for (const center of world.landIndex) {
    const cx = center % MAP_WIDTH;
    const cy = Math.floor(center / MAP_WIDTH);
    const nearby = [];
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= MAP_WIDTH) continue;
        const pixel = y * MAP_WIDTH + x;
        if (world.land[pixel] && !nearby.includes(pixel)) nearby.push(pixel);
      }
    }
    if (nearby.length >= cityCount + 1) { locations = nearby.slice(0, cityCount + 1); break; }
  }
  assert.ok(locations.length >= cityCount + 1, 'the fixture has a dense local land cluster');
  if (countryPixels > locations.length) {
    for (const pixel of world.landIndex) {
      if (!locations.includes(pixel)) locations.push(pixel);
      if (locations.length >= countryPixels) break;
    }
  }
  const cities = [];
  for (let i = 0; i < locations.length; i += 1) {
    const owner = i < cityCount && i >= foreignFrom ? foreign : main;
    world.setOwner(locations[i], owner.id + 1);
    world.density[locations[i]] = 10;
    world.culture[locations[i]] = world.cultureTable.single(culture.id, 100);
    if (i < cityCount) {
      const city = world.addCity(owner.id, locations[i], 1, i === 0);
      assert.ok(city, 'nearby fixture city should be created');
      cities.push(city);
    }
  }
  return { world, country: main, foreign, cities, targetPixel: locations[cityCount], locations };
}

function assertInvalidCityPlacementIsNoop(getTargetPixel, description) {
  const { world, country, pixels, cities } = makeCountry(4, [1]);
  const foreignCountry = world.newCountry({
    rank: 'тест',
    cultureId: country.cultureId,
    religionId: country.religionId,
    density: 10,
    foundedYear: 0,
    parentId: null,
  });
  const foreignPixel = world.landIndex.find((pixel) => !pixels.includes(pixel));
  assert.notEqual(foreignPixel, undefined, 'the fixture has a foreign land pixel');
  world.setOwner(foreignPixel, foreignCountry.id + 1);
  world.density[foreignPixel] = 10;
  const card = drawBuildCityCard(world, country);
  assert.equal(card?.type, 'buildCity', 'the country can start a manual city placement');
  const game = new Game(world, 'country');
  game.card = card;

  const citiesBefore = structuredClone(world.cities);
  const capitalsBefore = world.cities.map((city) => ({ id: city.id, capital: city.capital }));
  const populationBefore = totalOwnedPopulation(world);
  const targetPixel = getTargetPixel({ world, pixels, cities, foreignPixel });
  const accepted = game.selectCityAt(
    targetPixel % MAP_WIDTH,
    Math.floor(targetPixel / MAP_WIDTH),
  );

  assert.equal(accepted, false, `${description}: placement is rejected`);
  assert.deepEqual(world.cities, citiesBefore, `${description}: the city list is unchanged`);
  assert.deepEqual(
    world.cities.map((city) => ({ id: city.id, capital: city.capital })),
    capitalsBefore,
    `${description}: capitals are unchanged`,
  );
  assert.equal(totalOwnedPopulation(world), populationBefore, `${description}: population is unchanged`);
  assert.equal(game.getSnapshot().cityPlacementAvailable, true, `${description}: placement remains available`);
  game.discard();
}

// Population bands are thresholds for decisions, not hard caps on growth.
{
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => [cityPopulationMinimum(i + 1), cityPopulationMaximum(i + 1)]),
    [[100, 500], [500, 2500], [2500, 10000], [10000, 50000], [50000, 100000], [100000, Infinity]],
  );
  const { world, cities } = makeNearbyCityFixture(4, 2);
  const target = cities.length && world.landIndex.find((pixel) =>
    world.land[pixel] && !world.cityAt(pixel) &&
    new CityInfluenceIndex(world, cities[0].countryId).citiesAt(pixel).length === 4,
  );
  assert.notEqual(target, undefined, 'the target point is covered by four overlapping domestic and foreign city spheres');
  const beforeCities = cities.map((city) => city.population);
  const beforeTotal = totalOwnedPopulation(world);
  const influence = new CityInfluenceIndex(world, cities[0].countryId);
  applyDensityGrowth(world, target, 100, influence.citiesAt(target));
  assert.deepEqual(cities.map((city) => city.population), beforeCities.map((population) => population + 10),
    'each of up to five covering cities receives ten percent, including foreign cities');
  assert.equal(world.density[target], 70, 'the remaining sixty percent is added to the rural point');
  assert.equal(totalOwnedPopulation(world) - beforeTotal, 100, 'city growth shares conserve the full population increase');
}

{
  const { world, cities, country } = makeNearbyCityFixture(5);
  const target = world.landIndex.find((pixel) => !world.cityAt(pixel) &&
    new CityInfluenceIndex(world, country.id).citiesAt(pixel).length === 5);
  assert.notEqual(target, undefined, 'five overlapping city spheres cover the growth point');
  const totalBefore = totalOwnedPopulation(world);
  applyDensityGrowth(world, target, 100, new CityInfluenceIndex(world, country.id).citiesAt(target));
  assert.equal(cities.reduce((sum, city) => sum + city.population, 0), 50 + 5 * 10,
    'five cities receive exactly fifty percent in total');
  assert.equal(totalOwnedPopulation(world) - totalBefore, 100, 'the five-city rule conserves population');
}

{
  const { world, cities, country } = makeNearbyCityFixture(6, 3);
  resizeCityPopulation(world, cities[0], cityPopulationMaximum(1));
  const target = world.landIndex.find((pixel) => !world.cityAt(pixel) &&
    new CityInfluenceIndex(world, country.id).citiesAt(pixel).length === 6);
  assert.notEqual(target, undefined, 'six overlapping city spheres cover the growth point');
  const before = cities.map((city) => city.population);
  const totalBefore = totalOwnedPopulation(world);
  const influence = new CityInfluenceIndex(world, country.id);
  const covering = influence.citiesAt(target);
  assert.equal(covering.length, 6, 'the influence query includes foreign cities');
  applyDensityGrowth(world, target, 100, covering);
  assert.equal(cities[0].population, before[0], 'a city at its upper threshold receives no growth share');
  const eligible = cities.slice(1);
  const received = eligible.map((city, i) => cities[i + 1].population - before[i + 1]);
  assert.ok(Math.abs(received.reduce((sum, value) => sum + value, 0) - 50) < 1e-8,
    'more than five cities split no more than fifty percent among eligible cities');
  for (let i = 0; i < eligible.length; i += 1) {
    const weight = eligible[i].rank * (eligible[i].capital ? 2 : 1) *
      (world.isCoastal(eligible[i].pixel) && world.rivers[eligible[i].pixel] ? 3 :
        world.isCoastal(eligible[i].pixel) || world.rivers[eligible[i].pixel] ? 2 : 1);
    const expected = 50 * weight / eligible.reduce((sum, city) =>
      sum + city.rank * (city.capital ? 2 : 1) *
      (world.isCoastal(city.pixel) && world.rivers[city.pixel] ? 3 :
        world.isCoastal(city.pixel) || world.rivers[city.pixel] ? 2 : 1), 0);
    assert.ok(Math.abs(received[i] - expected) < 1e-8, 'growth is allocated by rank times sphere multiplier');
  }
  assert.ok(Math.abs(totalOwnedPopulation(world) - totalBefore - 100) < 1e-8,
    'the capped city is excluded without losing growth');
}

{
  const { world, country, cities, targetPixel } = makeNearbyCityFixture(2);
  const target = targetPixel;
  world.density[target] = 80;
  resizeCityPopulation(world, cities[0], 200);
  resizeCityPopulation(world, cities[1], 200);
  const before = cities.map((city) => city.population);
  const result = applyDensityLoss(world, target, 30);
  assert.equal(result, 30, 'ordinary loss is applied to its full requested amount');
  assert.equal(world.density[target], 80, 'same-country cities fully compensate a supported rural loss');
  assert.equal(before[0] - cities[0].population + before[1] - cities[1].population, 30,
    'city residents fill the density loss');
  assert.ok(cities.every((city) => city.population >= cityPopulationMinimum(city.rank)),
    'compensation never takes a city below its rank minimum');
  const foreignFixture = makeNearbyCityFixture(4, 2);
  const foreignTarget = foreignFixture.targetPixel;
  foreignFixture.world.density[foreignTarget] = 80;
  foreignFixture.cities.forEach((city) => resizeCityPopulation(foreignFixture.world, city, 200));
  const foreignBefore = foreignFixture.cities.slice(2).map((city) => city.population);
  applyDensityLoss(foreignFixture.world, foreignTarget, 20);
  assert.deepEqual(foreignFixture.cities.slice(2).map((city) => city.population), foreignBefore,
    'foreign cities do not compensate another country’s population loss');

  const cappedFixture = makeNearbyCityFixture(2);
  cappedFixture.world.density[cappedFixture.targetPixel] = 80;
  resizeCityPopulation(cappedFixture.world, cappedFixture.cities[0], 110);
  resizeCityPopulation(cappedFixture.world, cappedFixture.cities[1], 200);
  applyDensityLoss(cappedFixture.world, cappedFixture.targetPixel, 60);
  assert.equal(cappedFixture.cities[0].population, 100,
    'a city contributes only the ten residents it has above its lower rank limit');
  assert.ok(cappedFixture.cities[1].population > 100,
    'the remaining compensation is apportioned to other cities with available population');
}

// City promotion requires the upper population threshold and two same-rank neighbors in its sphere.
{
  const { world, country, cities } = makeNearbyCityFixture(3);
  resizeCityPopulation(world, cities[0], 499);
  assert.equal(cityAtUpperPopulationThreshold(cities[0]), false, 'one person below the cap is not eligible');
  assert.equal(canUpgradeCityRank(world, country.id, 1), false, 'promotion is unavailable below the upper threshold');
  resizeCityPopulation(world, cities[0], 500);
  assert.equal(cityAtUpperPopulationThreshold(cities[0]), true, 'the inclusive upper threshold qualifies');
  assert.equal(canUpgradeCityRank(world, country.id, 1), true, 'two other same-rank cities in its sphere qualify it');
  const card = drawUpgradeCityCard(world, country);
  assert.equal(card?.type, 'upgradeCity', 'the state receives a promotion card when it has a candidate');
  assert.equal(card?.choices?.length, 1, 'one suitable candidate is still offered');
  const twoCities = makeNearbyCityFixture(2);
  resizeCityPopulation(twoCities.world, twoCities.cities[0], 500);
  assert.equal(canUpgradeCityRank(twoCities.world, twoCities.country.id, 1), false,
    'a city at the upper threshold cannot upgrade without two other same-rank cities');
}

// Waning eligibility, threshold-first targets, capital exclusion, and rank-weighted card weight.
{
  const { world, country, cities } = makeNearbyCityFixture(3);
  cities.forEach((city) => resizeCityPopulation(world, city, 200));
  assert.equal(drawWaneCityCard(world, country), null, 'a state with no city at either threshold gets no card');
  assert.equal(cityWaningWeight(world, country), 0, 'no threshold city gives the card zero weight');
  resizeCityPopulation(world, cities[0], 100);
  assert.equal(cityAtWaningThreshold(cities[0]), true, 'the lower boundary is included');
  assert.equal(drawWaneCityCard(world, country), null,
    'a capital at threshold is not a target when the country has more than two cities');
  resizeCityPopulation(world, cities[1], 100);
  const card = drawWaneCityCard(world, country);
  assert.equal(card?.type, 'waneCity', 'a non-capital threshold city enables waning');
  assert.ok(card.choices.every((choice) => choice.cityId !== cities[0].id),
    'the capital is excluded from choices in a country with more than two cities');
  assert.ok(card.choices.some((choice) => choice.cityId === cities[1].id),
    'a threshold city is included before ordinary candidates');
  const baseWeight = cityWaningWeight(world, country);
  assert.ok(baseWeight > 0, 'the waning card receives positive weight');
  const rankSum = cities.reduce((sum, city) => sum + city.rank, 0);
  const oldRank = cities[1].rank;
  cities[1].rank = 2;
  assert.equal(cityWaningWeight(world, country), baseWeight * (rankSum + 1) / rankSum,
    'waning-card weight grows in direct proportion to total city ranks');
}

// A city above its lower threshold loses twenty percent and resettles half the loss.
{
  const { world, country, cities } = makeNearbyCityFixture(2, Infinity, 300);
  const city = cities[0];
  const alternateCulture = world.newCulture(null, 0);
  const religion = world.newReligion(0);
  city.populationGroups = [
    { cultureId: country.cultureId, religionId: null, population: 600 },
    { cultureId: alternateCulture.id, religionId: religion.id, population: 400 },
  ];
  city.population = 1_000;
  resizeCityPopulation(world, city, 1_000);
  const before = totalOwnedPopulation(world);
  const result = applyCityWaning(world, city);
  assert.equal(result.removed, false, 'a city above its lower threshold is not removed');
  assert.equal(city.population, 800, 'the city population falls by twenty percent');
  assert.deepEqual(city.populationGroups.map((group) => group.population), [480, 320],
    'the city preserves its cultural and religious group proportions');
  assert.ok(result.transferredPopulation > 0, 'half the lost population is resettled in the same-country sphere');
  assert.ok(Math.abs(totalOwnedPopulation(world) - (before - 100)) < 1e-3,
    'half the city loss is deleted and half remains in the country');
}

// Cities at or below the lower threshold lose rank; a rank-one capital can be removed safely.
{
  const { world, country, cities } = makeNearbyCityFixture(2, Infinity, 300);
  resizeCityPopulation(world, cities[0], 500);
  cities[0].rank = 2;
  resizeCityPopulation(world, cities[0], 500);
  const demoted = applyCityWaning(world, cities[0]);
  assert.equal(demoted.removed, false, 'a non-first-rank city is demoted rather than removed');
  assert.equal(cities[0].rank, 1, 'the city loses exactly one rank at its lower threshold');
  assert.equal(cities[0].population, 500, 'rank demotion does not independently change population');

  resizeCityPopulation(world, cities[0], 100);
  const removed = applyCityWaning(world, cities[0]);
  assert.equal(removed.removed, true, 'a rank-one city at its lower threshold is removed');
  assert.equal(world.cityAt(cities[0].pixel), null, 'the city pixel is cleared');
  assert.equal(world.cities.length, 1, 'the other city remains');
  assert.equal(world.cities[0].capital, true, 'the remaining city becomes capital after the old capital is removed');
  assert.ok(removed.transferredPopulation > 0, 'half the removed city population is resettled');
}

// The single-city target is automatic; removing it converts the remaining population to nomadic countries.
{
  const { world, country, cities } = makeNearbyCityFixture(1, Infinity, 100);
  const city = cities[0];
  resizeCityPopulation(world, city, 100);
  const expectedNomadPopulation = totalOwnedPopulation(world) -
    city.population * 0.5 + world.density[city.pixel];
  const card = drawWaneCityCard(world, country);
  assert.equal(card.choices.length, 1, 'a single city is the only automatic target');
  assert.equal(card.choices[0].cityId, city.id, 'the card selects the sole city without asking the player');
  const previousPersist = Game.persist;
  Game.persist = false;
  const game = new Game(world, 'observer');
  try {
    game.startCard(card);
    game.dispatchAction({ type: 'completeCard' });
  } finally {
    game.discard();
    Game.persist = previousPersist;
  }
  assert.equal(world.cities.filter((item) => item.countryId === country.id).length, 0, 'the state has no cities');
  assert.equal(country.pixels, 0, 'the city-less state loses its territory');
  assert.ok(world.landIndex.every((pixel) => world.owner[pixel] !== country.id + 1),
    'the former state territory becomes unclaimed');
  const nomadicCountries = world.countries.filter((item) => item.type === 'nomadic' && item.sourceCountryId === country.id);
  const nomadPopulation = nomadicCountries.flatMap((item) => item.cells ?? []).reduce((sum, cell) => sum + cell.population, 0);
  assert.ok(Math.abs(nomadPopulation - expectedNomadPopulation) < 1e-3,
    'all population remaining after waning, including resettled urban residents, becomes nomadic');
}

// A country with its mandatory capital still offers another city, and the actual
// player placement path accepts that city on an unoccupied home pixel.
{
  const { world, country, pixels, cities } = makeCountry(4, [1]);
  const card = drawBuildCityCard(world, country);
  assert.equal(card?.type, 'buildCity', 'a country with a capital can build another city');
  const game = new Game(world, 'country');
  game.card = card;
  assert.equal(game.getSnapshot().cityPlacementAvailable, true, 'the player sees an available city placement');
  assert.equal(game.selectCityAt(pixels[1] % MAP_WIDTH, Math.floor(pixels[1] / MAP_WIDTH)), true);
  assert.equal(world.cities.length, 2, 'manual placement adds a second city');
  assert.equal(world.cities[0].capital, true, 'the required capital remains the capital');
  assert.equal(world.cityAt(pixels[1])?.capital, false, 'the manually placed city is not a capital');
  game.discard();
}

// A fully occupied country must not offer a build card or report a usable
// placement tool. The game-side gate must also reject a card made before the
// country's last open site was occupied.
{
  const { world, country } = makeCountry(4, [1, 1, 1, 1]);
  assert.equal(drawBuildCityCard(world, country), null, 'a fully occupied country has no build-city card');
  const game = new Game(world, 'country');
  assert.equal(game.getSnapshot().cityPlacementAvailable, false, 'the player sees no available placement');
  game.discard();
}

{
  const { world, country, pixels } = makeCountry(3, [1]);
  const staleCard = drawBuildCityCard(world, country);
  assert.equal(staleCard?.type, 'buildCity', 'the card is available while a country site is open');
  for (const pixel of pixels.slice(1)) {
    assert.ok(world.addCity(country.id, pixel, 1, false), 'the remaining country site can be occupied');
  }
  const game = new Game(world, 'country');
  game.card = staleCard;
  assert.equal(game.getSnapshot().cityPlacementAvailable, false, 'a stale card does not enable placement');
  assert.equal(
    game.selectCityAt(pixels[0] % MAP_WIDTH, Math.floor(pixels[0] / MAP_WIDTH)),
    false,
    'the game rejects placement when every country site is occupied',
  );
  game.discard();
}

// Invalid targets must not add a city, transfer population, or change capitals.
assertInvalidCityPlacementIsNoop(
  ({ world }) => world.land.findIndex((isLand) => !isLand),
  'water',
);
assertInvalidCityPlacementIsNoop(
  ({ foreignPixel }) => foreignPixel,
  'foreign territory',
);
assertInvalidCityPlacementIsNoop(
  ({ cities }) => cities[0].pixel,
  'an occupied point',
);

// Merging by union or inheritance retains the main country's capital and
// demotes every capital from the incoming country to an ordinary city.
for (const cause of ['union', 'inheritance']) {
  const { world, country: main, pixels: mainPixels } = makeCountry(4, [1, 1]);
  const incoming = world.newCountry({
    rank: 'тест',
    cultureId: main.cultureId,
    religionId: main.religionId,
    density: 10,
    foundedYear: 0,
    parentId: null,
  });
  const incomingPixels = world.landIndex.filter((pixel) => !mainPixels.includes(pixel)).slice(0, 2);
  for (const pixel of incomingPixels) {
    world.setOwner(pixel, incoming.id + 1);
    world.density[pixel] = 10;
  }
  const incomingCapital = world.addCity(incoming.id, incomingPixels[0], 1, true);
  assert.ok(incomingCapital, `${cause}: incoming capital should be created`);

  const game = new Game(world, 'observer');
  if (cause === 'union') {
    game.startCard({
      type: 'union',
      title: 'Объединение',
      detail: 'Тестовое объединение',
      ink: 0,
      inkTotal: 0,
      targetCountryId: main.id,
      newCountryId: incoming.id,
      newCultureId: null,
      newReligionId: null,
      sourceCultureId: null,
      newGovernmentId: null,
      newRuler: null,
      choices: null,
      selectedChoice: 0,
      characterEvent: null,
      hint: -1,
    });
    game.dispatchAction({ type: 'completeCard' });
  } else {
    game.appointAndAnnex(main, incoming.ruler, 1000);
  }

  const capitalCities = world.cities.filter((city) => city.countryId === main.id && city.capital);
  assert.equal(capitalCities.length, 1, `${cause}: merged country has exactly one capital`);
  assert.equal(capitalCities[0].id, 0, `${cause}: main country's capital is retained`);
  assert.equal(incomingCapital.countryId, main.id, `${cause}: incoming city belongs to the main country`);
  assert.equal(incomingCapital.capital, false, `${cause}: former capital becomes an ordinary city`);
  for (const pixel of incomingPixels) {
    assert.equal(world.owner[pixel], main.id + 1, `${cause}: incoming land belongs to the main country`);
  }
  game.discard();
}

// Loading a saved world with duplicate capital flags keeps the first capital in
// saved city order; countries with no capital still promote their best city.
{
  const { world, country: main, pixels } = makeCountry(6, [1, 1, 1]);
  world.cities[1].capital = true;
  const noCapitalCountry = world.newCountry({
    rank: 'тест',
    cultureId: main.cultureId,
    religionId: main.religionId,
    density: 10,
    foundedYear: 0,
    parentId: null,
  });
  const otherPixels = world.landIndex.filter((pixel) => !pixels.includes(pixel)).slice(0, 2);
  for (const pixel of otherPixels) {
    world.setOwner(pixel, noCapitalCountry.id + 1);
    world.density[pixel] = 10;
  }
  const ordinaryCity = world.addCity(noCapitalCountry.id, otherPixels[0], 1, false);
  const higherRankCity = world.addCity(noCapitalCountry.id, otherPixels[1], 2, false);
  assert.ok(ordinaryCity && higherRankCity, 'the no-capital country should have two cities');

  const savedWorld = serializeWorld(world);
  await writeSaveBytes(encodeSave({
    version: 2,
    savedAt: 0,
    role: 'observer',
    year: 1000,
    turn: 1,
    focusCountryId: null,
    card: null,
    queue: [],
    brushMode: 'respect',
    brushSize: 'm',
    mapMode: 'political',
    log: [],
    world: savedWorld,
  }));
  let loadedGame;
  try {
    loadedGame = await Game.load();
    assert.ok(loadedGame, 'the saved world should load');
    const loadedCities = loadedGame.world.cities;
    const capitals = loadedCities.filter((city) => city.countryId === main.id && city.capital);
    assert.deepEqual(capitals.map((city) => city.id), [0], 'first saved capital is retained deterministically');
    const recoveredCapitals = loadedCities.filter((city) => city.countryId === noCapitalCountry.id && city.capital);
    assert.deepEqual(recoveredCapitals.map((city) => city.id), [higherRankCity.id],
      'a country without a capital still promotes its highest-rank city');
  } finally {
    loadedGame?.discard();
    await Game.deleteSave();
  }
}

// Automatic play may choose either option. The actual selected city must be the
// one promoted, with a capital and multiple ordinary cities in the country.
for (const selectedIndex of [0, 1]) {
  const { world, country, cities } = makeCountry(6, [1, 1, 1, 1]);
  cities.forEach((city) => resizeCityPopulation(world, city, cityPopulationMaximum(city.rank)));
  assert.equal(cities.filter((city) => city.capital).length, 1, 'the country has one capital');
  assert.equal(cities.filter((city) => !city.capital).length, 3, 'the country has several ordinary cities');
  assert.equal(canUpgradeCityRank(world, country.id, 1), true, 'four rank-1 cities allow one promotion');
  const card = drawUpgradeCityCard(world, country);
  assert.equal(card?.type, 'upgradeCity', 'promotion is offered when the resulting rank balance is valid');
  assert.equal(card?.choices?.length, 2, 'the card offers the two largest eligible cities');

  const ranksBefore = world.cities.map((city) => city.rank);
  const game = new Game(world, 'observer');
  const previousRandom = Math.random;
  try {
    Math.random = () => selectedIndex === 0 ? 0 : 0.999999;
    game.resolveAutomatically(card);
    assert.equal(card.selectedChoice, selectedIndex, 'automatic play selects the expected option');
    const selectedCityId = card.choices[card.selectedChoice].cityId;
    assert.equal(world.cities[selectedCityId].rank, ranksBefore[selectedCityId] + 1,
      'resolving the card increases the rank of the selected city');
    for (const city of world.cities) {
      if (city.id !== selectedCityId) {
        assert.equal(city.rank, ranksBefore[city.id], 'non-selected cities keep their ranks');
      }
    }
  } finally {
    Math.random = previousRandom;
    game.discard();
  }
}

// A 3,000-pixel country with a capital and another city can split without
// binding the player to a selected city.
{
  const { world, country, cities } = makeCountry(3000, [1, 1]);
  const split = drawSplitCard(world, country, 1000);
  assert.equal(split?.type, 'split', 'a sufficiently large, multi-city country can split');
  assert.equal(split?.choices, null, 'the split card does not offer city choices');
  assert.equal('requiredCityId' in split, false, 'the split card does not require a preselected city');
  assert.equal(cities.filter((city) => city.capital).length, 1, 'the source capital is unchanged before painting');
  assert.equal(split?.newCountryId, world.countries.length - 1, 'the split card creates its destination country');
}

// Run the real observer engine for a fixed 100-year window and report activity.
{
  const previousRandom = Math.random;
  const previousPause = Game.pause;
  Game.persist = false;
  Game.pause = async () => {};
  Math.random = mulberry32(210021);
  let game;
  try {
    game = Game.create('random', 'observer');
    const firstCityId = game.world.cities.length;
    let expandedCityRankCount = 0;
    for (let year = 0; year < 100; year += 1) {
      const ranks = game.world.cities.map((city) => city.rank);
      await game.nextTurn();
      for (let i = 0; i < ranks.length; i += 1) {
        expandedCityRankCount += Math.max(0, game.world.cities[i].rank - ranks[i]);
      }
    }
    const builtCityCount = game.world.cities.length - firstCityId;
    assert.equal(game.getSnapshot().year, 1100, 'the fixed-seed observer simulation advances exactly 100 years');
    assert.ok(builtCityCount > 0, 'the long simulation should build cities');
    assert.ok(expandedCityRankCount > 0, 'the long simulation should expand city ranks');
    console.log(
      `100-year city regression passed (seed 210021): built ${builtCityCount}, rank upgrades ${expandedCityRankCount}.`,
    );
  } finally {
    game?.discard();
    Math.random = previousRandom;
    Game.pause = previousPause;
    Game.persist = true;
  }
}
