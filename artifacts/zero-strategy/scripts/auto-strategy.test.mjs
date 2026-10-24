import assert from 'node:assert/strict';
import { autoPaint } from '../game/autoPaint.ts';
import { CardPainter } from '../game/brush.ts';
import { humanClimateSuitabilityAt, humanOriginMixToTable } from '../game/human.ts';
import { Game } from '../game/game.ts';
import { mulberry32 } from '../game/random.ts';
import { MAP_HEIGHT, MAP_WIDTH, RANKS } from '../game/config.ts';
import { forEachNeighbour } from '../game/geography.ts';
import { World } from '../game/world.ts';

function withSeed(seed, callback) {
  const previous = Math.random;
  Math.random = mulberry32(seed);
  try {
    return callback();
  } finally {
    Math.random = previous;
  }
}

function landBlob(world, start, limit = 90) {
  const seen = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length && queue.length < limit; head += 1) {
    forEachNeighbour(queue[head], (next) => {
      if (world.land[next] && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    });
  }
  return queue;
}

function fixture() {
  return withSeed(55129, () => {
    const world = World.create('random', 7721);
    const centers = [];
    for (const pixel of world.landIndex) {
      if (centers.every((center) => Math.hypot(
        center % MAP_WIDTH - pixel % MAP_WIDTH,
        Math.floor(center / MAP_WIDTH) - Math.floor(pixel / MAP_WIDTH),
      ) > 120)) centers.push(pixel);
      if (centers.length === 3) break;
    }
    assert.equal(centers.length, 3, 'the fixed map provides three separated land areas');
    const regions = centers.map((center) => landBlob(world, center));
    const culture = world.newCulture(null, 1000);
    const country = world.newCountry({
      rank: 'test',
      cultureId: culture.id,
      religionId: null,
      density: 100,
      foundedYear: 1000,
      parentId: null,
    });
    const mixes = [
      { ids: ['european'], shares: [100] },
      { ids: ['pygmy'], shares: [100] },
      { ids: ['european', 'pygmy'], shares: [75, 25] },
    ];
    const mixIds = mixes.map((mix) => world.humanOriginTable.intern(humanOriginMixToTable(mix)));
    const cultureMix = world.cultureTable.single(culture.id, 100);
    const touched = [];
    regions.forEach((region, regionIndex) => {
      region.forEach((pixel) => {
        world.setOwner(pixel, country.id + 1);
        world.density[pixel] = 100;
        world.temperature[pixel] = regionIndex === 0 ? 15 : regionIndex === 1 ? 90 : 20;
        world.humidity[pixel] = regionIndex === 1 ? 100 : 50;
        world.humanOrigins[pixel] = mixIds[regionIndex];
        world.culture[pixel] = cultureMix;
        touched.push(pixel);
      });
    });
    world.recountCountries();
    return { world, country, regions, touched };
  });
}

function climateCard(type, targetCountryId, hint, ink = 900) {
  return {
    type,
    title: type,
    detail: type,
    ink,
    inkTotal: ink,
    targetCountryId,
    newCountryId: null,
    newCultureId: null,
    newReligionId: null,
    sourceCultureId: null,
    newGovernmentId: null,
    newRuler: null,
    choices: null,
    selectedChoice: 0,
    characterEvent: null,
    hint,
  };
}

function runPainter(painter) {
  const radius = 16;
  const actions = {
    beginStroke: (x, y) => painter.dab(x, y, radius),
    dab: (x, y, r) => painter.dab(x, y, r),
    line: (ax, ay, bx, by, r) => painter.line(ax, ay, bx, by, r),
    endStroke: () => painter.endStroke(),
  };
  autoPaint(painter, actions);
}

function climatePopulationFit(world, pixels) {
  return pixels.reduce((sum, pixel) =>
    sum + world.density[pixel] * humanClimateSuitabilityAt(world, pixel), 0);
}

function legacyRandomPaint(painter, hint, seed) {
  const random = mulberry32(seed);
  const card = painter.card;
  const radius = 16;
  let x = (hint % MAP_WIDTH) + 0.5;
  let y = Math.floor(hint / MAP_WIDTH) + 0.5;
  let misses = 0;
  for (let step = 0; step < 4000 && card.ink > 0; step += 1) {
    const spent = painter.dab(x, y, radius);
    misses = spent > 0 ? 0 : misses + 1;
    if (misses > 80) break;
    const changed = painter.changed;
    const from = changed.length
      ? changed[changed.length - 1 - Math.floor(random() * Math.min(changed.length, 600))]
      : hint;
    const angle = random() * Math.PI * 2;
    const distance = radius * (0.6 + random() * 0.8);
    x = Math.max(0, Math.min(MAP_WIDTH - 1, (from % MAP_WIDTH) + 0.5 + Math.cos(angle) * distance));
    y = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.floor(from / MAP_WIDTH) + 0.5 + Math.sin(angle) * distance));
  }
  painter.endStroke();
}

const first = fixture();
const [europeanPixels, pygmyPixels, mixedPixels] = first.regions;
const warm = climateCard('warmCurrent', null, pygmyPixels[0]);
const warmPainter = new CardPainter(first.world, warm, 'respect');
assert.ok(warmPainter.strategyImpactAt(europeanPixels[0]) > 0,
  'warming improves the European profile in a cold habitat');
assert.ok(warmPainter.strategyImpactAt(pygmyPixels[0]) < 0,
  'warming is identified as harmful to a hot-habitat population');
assert.ok(warmPainter.strategyImpactAt(mixedPixels[0]) > 0,
  'mixed origins are scored using their canonical 75/25 shares');
const mixed = first.world.humanOriginTable.entries[first.world.humanOrigins[mixedPixels[0]]];
assert.deepEqual(mixed.shares, [75, 25], 'stored ancestry shares remain in quarter increments');

const legacy = fixture();
const legacyPixels = legacy.touched;
const legacyBefore = climatePopulationFit(legacy.world, legacyPixels);
legacyRandomPaint(
  new CardPainter(legacy.world, climateCard('warmCurrent', null, legacy.regions[1][0]), 'respect'),
  legacy.regions[1][0],
  83411,
);
const legacyGain = climatePopulationFit(legacy.world, legacyPixels) - legacyBefore;

const planned = fixture();
const plannedPixels = planned.touched;
const plannedBefore = climatePopulationFit(planned.world, plannedPixels);
const plannedPainter = new CardPainter(
  planned.world,
  climateCard('warmCurrent', null, planned.regions[1][0]),
  'respect',
);
runPainter(plannedPainter);
const plannedGain = climatePopulationFit(planned.world, plannedPixels) - plannedBefore;
assert.ok(plannedGain > legacyGain,
  `effect per ink should improve over the old random strategy (${plannedGain} > ${legacyGain})`);

const repeated = fixture();
const repeatedPainter = new CardPainter(
  repeated.world,
  climateCard('warmCurrent', null, repeated.regions[1][0]),
  'respect',
);
runPainter(repeatedPainter);
assert.deepEqual(
  repeated.touched.map((pixel) => repeated.world.temperature[pixel]),
  plannedPixels.map((pixel) => planned.world.temperature[pixel]),
  'identical world state, card and seed produce identical climate changes',
);
assert.equal(repeatedPainter.card.ink, plannedPainter.card.ink,
  'identical AI runs spend identical ink');

const safer = fixture();
const before = climatePopulationFit(safer.world, safer.touched);
runPainter(new CardPainter(
  safer.world,
  climateCard('warmCurrent', safer.country.id, safer.regions[1][0]),
  'respect',
));
assert.ok(climatePopulationFit(safer.world, safer.touched) >= before,
  'a country climate card does not spend ink on a harmful-only change');

function cityPlacementFixture() {
  const world = World.create('random', 61503);
  const width = 80, height = 50;
  const x0 = Math.floor((MAP_WIDTH - width) / 2);
  const y0 = Math.floor((MAP_HEIGHT - height) / 2);
  const pixels = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      world.land[pixel] = 1;
      pixels.push(pixel);
    }
  }
  const existingLand = new Set(world.landIndex);
  world.landIndex = Int32Array.from([
    ...world.landIndex,
    ...pixels.filter((pixel) => !existingLand.has(pixel)),
  ]);
  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'test',
    cultureId: culture.id,
    religionId: null,
    density: 20,
    foundedYear: 1000,
    parentId: null,
  });
  const mix = world.cultureTable.single(culture.id, 100);
  for (const pixel of pixels) {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 20;
    world.culture[pixel] = mix;
  }
  const denseRegion = { x0: x0 + 30, y0: y0 + 15, x1: x0 + 50, y1: y0 + 35 };
  for (let y = denseRegion.y0; y <= denseRegion.y1; y += 1) {
    for (let x = denseRegion.x0; x <= denseRegion.x1; x += 1) {
      world.density[y * MAP_WIDTH + x] = 80;
    }
  }
  const spike = (y0 + 8) * MAP_WIDTH + x0 + 8;
  world.density[spike] = 250;
  world.recountCountries();
  const capitalPixel = (y0 + 2) * MAP_WIDTH + x0 + 2;
  assert.ok(world.addCity(country.id, capitalPixel, 1, true));
  return { world, country, denseRegion, spike };
}

const cityFixture = cityPlacementFixture();
const cityCard = climateCard('buildCity', cityFixture.country.id, -1, 0);
const cityGame = new Game(cityFixture.world, 'observer');
cityGame.resolveAutomatically(cityCard);
const placedCity = cityFixture.world.cities.find((city) =>
  city.countryId === cityFixture.country.id && !city.capital,
);
assert.ok(placedCity, 'automatic city placement creates a legal additional city');
const placedX = placedCity.pixel % MAP_WIDTH;
const placedY = Math.floor(placedCity.pixel / MAP_WIDTH);
assert.ok(
  placedX >= cityFixture.denseRegion.x0 && placedX <= cityFixture.denseRegion.x1 &&
  placedY >= cityFixture.denseRegion.y0 && placedY <= cityFixture.denseRegion.y1,
  'city placement prefers the region that gathers more population over the isolated density peak',
);
assert.notEqual(placedCity.pixel, cityFixture.spike);
cityGame.discard();

function nomadPlacementFixture() {
  const world = World.create('random', 61504);
  const width = 80, height = 50;
  const x0 = Math.floor((MAP_WIDTH - width) / 2);
  const y0 = Math.floor((MAP_HEIGHT - height) / 2);
  const range = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      world.land[pixel] = 1;
      range.push(pixel);
    }
  }
  const existingLand = new Set(world.landIndex);
  world.landIndex = Int32Array.from([
    ...world.landIndex,
    ...range.filter((pixel) => !existingLand.has(pixel)),
  ]);
  const culture = world.newCulture(null, 1000);
  const nomad = world.newCountry({
    rank: 'test',
    cultureId: culture.id,
    religionId: null,
    density: 20,
    foundedYear: 1000,
    parentId: null,
  });
  nomad.type = 'nomadic';
  nomad.range = range;
  const cultureMix = world.cultureTable.single(culture.id, 100);
  const humanOriginMix = world.humanOriginTable.single(0, 100);
  const denseRegion = { x0: x0 + 30, y0: y0 + 15, x1: x0 + 50, y1: y0 + 35 };
  nomad.cells = range.map((pixel) => {
    const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
    const dense = x >= denseRegion.x0 && x <= denseRegion.x1 &&
      y >= denseRegion.y0 && y <= denseRegion.y1;
    const spike = x === x0 + 8 && y === y0 + 8;
    return {
      pixel,
      population: spike ? 250 : dense ? 80 : 20,
      cultureMix,
      religionMix: 0,
      humanOriginMix,
    };
  });
  return {
    world,
    nomad,
    denseRegion,
    range,
    populationByPixel: new Map(nomad.cells.map((cell) => [cell.pixel, cell.population])),
  };
}

const nomadFixture = nomadPlacementFixture();
const nomadCard = climateCard('buildCity', nomadFixture.nomad.id, -1, 0);
const nomadGame = new Game(nomadFixture.world, 'observer');
nomadGame.resolveAutomatically(nomadCard);
assert.equal(nomadFixture.nomad.type, 'settled',
  'automatic nomad settlement follows the existing nomadic city rule');
const nomadCity = nomadFixture.world.cities.find((city) => city.countryId === nomadFixture.nomad.id);
assert.ok(nomadCity, 'the nomadic country is settled with a city');
const nomadSiteScore = (pixel) => {
  const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
  const port = nomadFixture.world.isCoastal(pixel)
    ? (nomadFixture.world.rivers[pixel] > 0 ? 3 : 2)
    : (nomadFixture.world.rivers[pixel] > 0 ? 2 : 1);
  const radius = Math.sqrt(RANKS[0].ink * port * 2 / Math.PI);
  let score = 0;
  for (const source of nomadFixture.range) {
    const sourceX = source % MAP_WIDTH, sourceY = Math.floor(source / MAP_WIDTH);
    if ((sourceX - x) ** 2 + (sourceY - y) ** 2 <= radius ** 2) {
      score += nomadFixture.populationByPixel.get(source) ?? 0;
    }
  }
  return score;
};
const bestNomadScore = Math.max(...nomadFixture.range.map(nomadSiteScore));
assert.equal(
  nomadSiteScore(nomadCity.pixel),
  bestNomadScore,
  'nomadic settlement picks the valid site with the largest population footprint under its settlement rule',
);
nomadGame.discard();

console.log('AI climate scoring, quarter-share mixes, settled and nomadic city sites, determinism, and ink efficiency passed.');
