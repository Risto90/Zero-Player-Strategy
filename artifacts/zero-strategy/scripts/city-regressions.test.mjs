import { strict as assert } from 'node:assert';
import { Game } from '../game/game.ts';
import {
  drawBuildCityCard,
  drawSplitCard,
  drawUpgradeCityCard,
} from '../game/cards.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { mulberry32 } from '../game/random.ts';
import { canUpgradeCityRank, populationAtPixel } from '../game/settlements.ts';
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

// Automatic play may choose either option. The actual selected city must be the
// one promoted, with a capital and multiple ordinary cities in the country.
for (const selectedIndex of [0, 1]) {
  const { world, country, cities } = makeCountry(6, [1, 1, 1, 1]);
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

// A 3,000-pixel country with a capital and another city can split around the
// non-capital city, which is required to lead the new state.
{
  const { world, country, cities } = makeCountry(3000, [1, 1]);
  const split = drawSplitCard(world, country, 1000);
  assert.equal(split?.type, 'split', 'a sufficiently large, multi-city country can split');
  assert.equal(split?.requiredCityId, cities[1].id, 'the non-capital city is selected for the split');
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
