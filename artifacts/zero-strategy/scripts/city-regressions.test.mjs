import { strict as assert } from 'node:assert';
import { Game } from '../game/game.ts';
import {
  drawBuildCityCard,
  drawSplitCard,
  drawUpgradeCityCard,
} from '../game/cards.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { mulberry32 } from '../game/random.ts';
import { canUpgradeCityRank } from '../game/settlements.ts';
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

// The rank distribution is checked after the proposed promotion, not before it.
{
  const { world, country } = makeCountry(6, [1, 1, 1, 1]);
  assert.equal(canUpgradeCityRank(world, country.id, 1), true, 'four towns allow one rank-1 promotion');
  const card = drawUpgradeCityCard(world, country);
  assert.equal(card?.type, 'upgradeCity', 'promotion is offered when the resulting rank balance is valid');
  assert.equal(card?.choices?.length, 2, 'the card offers the two largest eligible cities');
  const promotedCity = world.cities[card.choices[0].cityId];
  const game = new Game(world, 'observer');
  game.resolveAutomatically(card);
  assert.equal(promotedCity.rank, 2, 'resolving the card increases the selected city rank');
  game.discard();
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
