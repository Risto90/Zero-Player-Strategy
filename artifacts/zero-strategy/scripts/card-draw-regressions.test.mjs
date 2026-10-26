import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { advancePeople } from '../game/characters.ts';
import { drawClimateCard, drawCountryCard, drawWorldCard, normalizedCardProbabilities, updateCardDrawMultipliers } from '../game/cards.ts';
import { CardPainter } from '../game/brush.ts';
import { autoPaint } from '../game/autoPaint.ts';
import { forEachNeighbour } from '../game/geography.ts';
import { clearSaveBytes } from '../game/storage.ts';
import { World } from '../game/world.ts';

function makeFixture() {
  const world = World.create('random', 9917);
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
    world.culture[pixel] = cultureMix;
  }
  world.recountCountries();
  assert.ok(world.addCity(country.id, pixels[0], 1, true));
  return { world, country };
}

const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-12, message);

// Каждый подходящий вариант участвует в общем нормированном распределении.
const distribution = normalizedCardProbabilities([
  { key: 'a', weight: 1 },
  { key: 'b', weight: 3 },
  { key: 'c', weight: 0 },
]);
closeTo(distribution.reduce((sum, item) => sum + item.probability, 0), 1, 'normalized card odds total 100%');
closeTo(distribution[0].probability, 0.25, 'base weight determines the normalized probability');
const tinyChance = normalizedCardProbabilities([
  { key: 'tiny', weight: 1e-200 },
  { key: 'ordinary', weight: 1 },
]);
assert.ok(tinyChance.find((item) => item.key === 'tiny')?.probability > 0,
  'любая положительная вероятность остаётся в распределении карт');

// Постоянный множитель растёт только у карт с более высоким прежним шансом; множитель вытянутой карты сбрасывается.
const multipliers = { 'country:4:a': 1.21, 'country:4:missing': 1.5 };
updateCardDrawMultipliers('country:4', distribution, 'a', multipliers);
closeTo(multipliers['country:4:b'], 1.1, 'a card with higher odds receives the 1.1 bonus');
closeTo(multipliers['country:4:a'], 1, 'the drawn card multiplier resets');
closeTo(multipliers['country:4:missing'], 1.5, 'unavailable cards retain their multiplier');
updateCardDrawMultipliers('country:4', distribution, 'a', multipliers);
closeTo(multipliers['country:4:b'], 1.21, 'unplayed-card bonuses multiply across draws');
const second = normalizedCardProbabilities([
  { key: 'a', weight: 1 },
  { key: 'b', weight: 3 },
], multipliers, 'country:4');
updateCardDrawMultipliers('country:4', second, 'b', multipliers);
closeTo(multipliers['country:4:b'], 1, 'the bonus resets when that card is eventually drawn');

// Мировой адаптивный множитель накапливается геометрически и сбрасывается после выпадения карты.
const worldMultipliers = {};
const worldPool = [
  { key: 'low', weight: 1 },
  { key: 'high', weight: 3 },
];
for (const expected of [1.1, 1.21, 1.331]) {
  const odds = normalizedCardProbabilities(worldPool, worldMultipliers, 'world');
  updateCardDrawMultipliers('world', odds, 'low', worldMultipliers);
  closeTo(worldMultipliers['world:high'], expected, `three misses compound to x${expected}`);
}
updateCardDrawMultipliers(
  'world',
  normalizedCardProbabilities(worldPool, worldMultipliers, 'world'),
  'high',
  worldMultipliers,
);
closeTo(worldMultipliers['world:high'], 1, 'the world multiplier resets after the card is drawn');

const previousPersist = Game.persist;
Game.persist = true;
try {
  await clearSaveBytes();
  const { world, country } = makeFixture();
  world.humidity.fill(50);
  const preWorldCounts = [world.countries.length, world.cultures.length, world.religions.length];
  world.cardMultipliers['world:drought'] = 1e100;
  const worldCard = drawWorldCard(world, 1000);
  assert.equal(worldCard?.type, 'drought', 'the world draw chooses exactly one available card');
  assert.deepEqual([world.countries.length, world.cultures.length, world.religions.length], preWorldCounts,
    'checking unselected world cards does not leave their entities behind');

  const nomad = world.newCountry({
    rank: 'кочевье',
    cultureId: country.cultureId,
    religionId: null,
    density: 50,
    foundedYear: 1000,
    parentId: country.id,
  });
  nomad.type = 'nomadic';
  nomad.cells = [{ pixel: world.landIndex[0], population: 50, cultureMix: world.cultureTable.single(country.cultureId, 100), religionMix: 0 }];
  nomad.range = [world.landIndex[0]];
  nomad.pixels = 0;
  world.cardMultipliers[`country:${nomad.id}:nomadExpand`] = 1e100;
  const nomadCard = drawCountryCard(world, nomad, 1000);
  assert.equal(nomadCard?.type, 'nomadExpand', 'the shared country draw selects a nomadic-country card');
  const rangeSet = new Set(nomad.range);
  const reachable = new Set(rangeSet);
  const queue = [...rangeSet];
  for (let head = 0; head < queue.length; head += 1) {
    forEachNeighbour(queue[head], (pixel) => {
      if (world.land[pixel] && !reachable.has(pixel)) {
        reachable.add(pixel);
        queue.push(pixel);
      }
    });
  }
  const reachableOutside = [...reachable].filter((pixel) => !rangeSet.has(pixel)).length;
  const nomadCapacity = reachableOutside || rangeSet.size;
  assert.ok(nomadCard.inkTotal <= nomadCapacity,
    'nomad expansion ink is capped by connected new land or existing range density targets');

  // Кисть ветра тратит на воду половину чернил, а на сушу страны — одно чернило.
  world.temperature.fill(100);
  let coastalLand = -1;
  let coastalSea = -1;
  for (const pixel of world.landIndex) {
    if (world.owner[pixel] > 0) continue;
    const bodies = new Set();
    world.seasOfPixel(pixel, bodies);
    const body = [...bodies][0];
    if (body !== undefined) {
      coastalLand = pixel;
      coastalSea = body;
      break;
    }
  }
  assert.ok(coastalLand >= 0, 'the fixture includes a free coastal land point');
  world.setOwner(coastalLand, country.id + 1);
  world.recountCountries();
  const countryPixels = [];
  world.forEachCountryPixel(country, (pixel) => countryPixels.push(pixel));
  countryPixels.slice(0, 2).forEach((pixel) => { world.temperature[pixel] = 50; });
  const seas = new Set();
  world.forEachCountryPixel(country, (pixel) => world.seasOfPixel(pixel, seas));
  assert.ok(seas.has(coastalSea), 'the country is adjacent to the selected sea');
  const seaPixel = world.water.bodyOf.findIndex((body) => body === coastalSea);
  assert.ok(seaPixel >= 0, 'the selected sea includes a paintable water point');
  world.temperature[seaPixel] = 50;
  const wind = drawClimateCard(world, 'warmWind', country);
  assert.equal(wind?.inkTotal, 2.5,
    'a wind card counts two land points and one half-cost sea point');
  const painter = new CardPainter(world, wind, 'respect');
  let availableInk = 0;
  for (let pixel = 0; pixel < world.land.length; pixel += 1) {
    availableInk += painter.strategyInkCostAt(pixel);
  }
  assert.equal(availableInk, wind.inkTotal,
    'the generated climate quota equals its brush-eligible capacity');
  autoPaint(painter, {
    beginStroke: (x, y) => painter.dab(x, y, 11),
    dab: (x, y, radius) => painter.dab(x, y, radius),
    line: (ax, ay, bx, by, radius) => painter.line(ax, ay, bx, by, radius),
    endStroke: () => painter.endStroke(),
  });
  assert.equal(wind.ink, 0, 'the automatic wind painter spends the entire land-and-sea quota');
  assert.ok(wind.ink >= 0, 'the wind brush never overspends a fractional sea quota');
  for (const pixel of countryPixels) world.temperature[pixel] = 100;
  world.temperature[seaPixel] = 50;
  const seaOnlyWind = drawClimateCard(world, 'warmWind', country);
  assert.equal(seaOnlyWind?.inkTotal, 0.5,
    'a sea-only climate opportunity uses a land point only to start the stroke');
  const seaPainter = new CardPainter(world, seaOnlyWind, 'respect');
  autoPaint(seaPainter, {
    beginStroke: (x, y) => seaPainter.dab(x, y, 11),
    dab: (x, y, radius) => seaPainter.dab(x, y, radius),
    line: (ax, ay, bx, by, radius) => seaPainter.line(ax, ay, bx, by, radius),
    endStroke: () => seaPainter.endStroke(),
  });
  assert.equal(seaOnlyWind.ink, 0, 'the automatic wind painter can spend a half-ink sea-only quota');

  const ruler = country.ruler;
  const other = world.newCountry({
    rank: 'вторая',
    cultureId: country.cultureId,
    religionId: null,
    density: 10,
    foundedYear: 1000,
    parentId: null,
  }).ruler;
  world.cardMultipliers['country:0:death:unavailable-person'] = 1.331;
  world.cardMultipliers[`country:${country.id}:death:${ruler.id}`] = 1e100;
  country.pendingDeathIds = [ruler.id]; // A pre-migration save may still contain this legacy field.
  const game = new Game(world, 'all');
  await game.saveNow();
  const restored = await Game.load();
  assert.ok(restored, 'the card probability state survives save and load');
  closeTo(restored.world.cardMultipliers['country:0:death:unavailable-person'], 1.331,
    'multipliers for currently unavailable cards are persisted');

  const savedRuler = restored.world.countries[country.id].ruler;
  const savedOther = restored.world.people.find((person) => person.id === other.id);
  advancePeople(restored.world, 1001);
  assert.equal(savedRuler.alive, true, 'annual aging does not independently kill a character');
  assert.equal(savedOther.alive, true, 'annual aging does not queue any character death');
  assert.equal('pendingDeathIds' in restored.world.countries[country.id], false, 'country state has no death queue');

  const death = drawCountryCard(restored.world, restored.world.countries[country.id], 1001);
  assert.equal(death?.type, 'death', 'a death is returned as the one selected country card');
  assert.deepEqual(death.characterEvent.personIds, [savedRuler.id],
    'the selected death card refers only to its own character');
  assert.equal(savedRuler.alive, true, 'the death card itself does not kill anyone before resolution');
  restored.applyCharacterEvent(restored.world.countries[country.id], death.characterEvent, null);
  assert.equal(savedRuler.alive, false, 'the selected death card causes death when resolved');
  assert.equal(savedOther.alive, true, 'resolving one death card leaves other characters alive');
  assert.equal(death.characterEvent.personIds.length, 1, 'one draw never returns multiple death cards');
  restored.discard();
  game.discard();
} finally {
  await clearSaveBytes();
  Game.persist = previousPersist;
}

console.log('Card probability, death-card, and save/load regressions passed.');
