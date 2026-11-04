import assert from 'node:assert/strict';
import { autoPaint } from '../game/autoPaint.ts';
import { selectCompetitiveContour } from '../game/autoPaintCandidates.ts';
import { CardPainter } from '../game/brush.ts';
import {
  ancestryProfile,
  ancestryProfileId,
  humanClimateSuitabilityAt,
  humanOriginMixToTable,
} from '../game/human.ts';
import { Game } from '../game/game.ts';
import { mulberry32 } from '../game/random.ts';
import { MAP_HEIGHT, MAP_WIDTH, RANKS } from '../game/config.ts';
import { forEachNeighbour } from '../game/geography.ts';
import { World } from '../game/world.ts';
import {
  colonizationInkCapacity,
  drawColonization,
  territoryInkCapacity,
} from '../game/cards.ts';
import { colonizationPlan, expansionCoastRoutePoints } from '../game/colonization.ts';
import { CityInfluenceIndex } from '../game/settlements.ts';
import { densityToResidents, residentsToDensity } from '../game/populationUnits.ts';

function withSeed(seed, callback) {
  const previous = Math.random;
  Math.random = mulberry32(seed);
  try {
    return callback();
  } finally {
    Math.random = previous;
  }
}

const competitionCandidates = ['A', 'B', 'C', 'D'].map((id, index) => ({
  id,
  score: 4 - index,
  accessible: { size: 10 },
}));
const competitionChecks = [];
const limitCompetition = (candidate, competitor) => {
  competitionChecks.push(`${candidate.id}:${competitor?.id ?? 'нет'}`);
  if (candidate.id === 'B' && competitor?.id === 'C') {
    return { ...candidate, score: 3, accessible: { size: 1 } };
  }
  if (candidate.id === 'C' && competitor?.id === 'D') {
    return { ...candidate, score: 2, accessible: { size: 1 } };
  }
  return null;
};
const secondContour = selectCompetitiveContour(
  competitionCandidates,
  2,
  limitCompetition,
  (left, right) => right.score - left.score,
);
assert.equal(secondContour?.candidate.id, 'B');
assert.equal(secondContour?.sampleSize, 3, 'при смене контура выборка расширяется на одного соперника');
const thirdContour = selectCompetitiveContour(
  competitionCandidates,
  (secondContour?.sampleSize ?? 2) + 1,
  limitCompetition,
  (left, right) => right.score - left.score,
);
assert.equal(thirdContour?.candidate.id, 'C');
assert.equal(thirdContour?.sampleSize, 4);
assert.ok(competitionChecks.includes('B:C') && competitionChecks.includes('C:D'),
  'новый контур сравнивается с худшим участником расширенной выборки, не с предыдущим мазком');

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
    world.water.coastsOf = [];
    world.isCoastal = () => false;
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
        world.temperature[pixel] = regionIndex === 0 ? 0 : regionIndex === 1 ? 28 : 5;
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
    ...(['warmCurrent', 'coldCurrent'].includes(type) ? { temperatureStepC: 2 } : {}),
    ...(['warmWind', 'coldWind'].includes(type) ? { temperatureStepC: 1 } : {}),
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
assert.deepEqual(mixed.shares, [100], 'the raster stores the population share of an ancestry profile');
assert.deepEqual(ancestryProfile(mixed.ids[0]).mix.shares, [75, 25],
  'quarter increments apply to one person’s ancestry profile');
const continuousMix = first.world.humanOriginTable.intern(new Map([
  [ancestryProfileId({ ids: ['european'], shares: [100] }), 67.1],
  [ancestryProfileId({ ids: ['pygmy'], shares: [100] }), 32.9],
]));
assert.deepEqual(first.world.humanOriginTable.entries[continuousMix].shares, [67.1, 32.9],
  'population proportions retain precise shares instead of quarter rounding');

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

const noPopulationBenefit = fixture();
for (const pixel of noPopulationBenefit.touched) noPopulationBenefit.world.density[pixel] = 0;
const noBenefitCard = climateCard('warmCurrent', noPopulationBenefit.country.id,
  noPopulationBenefit.regions[1][0], 20);
runPainter(new CardPainter(noPopulationBenefit.world, noBenefitCard, 'respect'));
assert.equal(noBenefitCard.ink, 0,
  'climate automation spends its quota on eligible points even when no comfort benefit can be scored');

function colonizationContourFixture() {
  const world = World.create('random', 61505);
  const width = 100, height = 160;
  const x0 = Math.floor((MAP_WIDTH - width) / 2);
  const y0 = Math.floor((MAP_HEIGHT - height) / 2);
  const patch = [];
  const origin = world.humanOriginTable.intern(humanOriginMixToTable({
    ids: ['european'],
    shares: [100],
  }));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      world.land[pixel] = 1;
      world.water.bodyOf[pixel] = -1;
      world.rivers[pixel] = 0;
      world.temperature[pixel] = 0;
      world.humidity[pixel] = 0;
      world.drainage[pixel] = 30;
      world.humanOrigins[pixel] = origin;
      patch.push(pixel);
    }
  }
  const existingLand = new Set(world.landIndex);
  world.landIndex = Int32Array.from([
    ...world.landIndex,
    ...patch.filter((pixel) => !existingLand.has(pixel)),
  ].sort((a, b) => a - b));

  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 1000,
    foundedYear: 1000,
    parentId: null,
  });
  const cultureMix = world.cultureTable.single(culture.id, 100);
  for (let y = 0; y <= 130; y += 1) {
    for (let x = 0; x <= 19; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      world.setOwner(pixel, country.id + 1);
      world.density[pixel] = 1000;
      world.culture[pixel] = cultureMix;
    }
  }
  for (let y = 0; y <= 130; y += 1) {
    for (let x = 20; x < width; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      world.density[pixel] = 100;
      world.culture[pixel] = cultureMix;
    }
  }
  const riverPixels = [];
  for (let y = 20; y <= 130; y += 1) {
    const pixel = (y0 + y) * MAP_WIDTH + x0 + 19;
    world.rivers[pixel] = 1;
    riverPixels.push(pixel);
  }
  const testRiver = {
    id: world.riverFeatures.length,
    scaleRank: 1,
    paths: [[{ x: x0 + 19.5, y: y0 + 20 }, { x: x0 + 19.5, y: y0 + 130 }]],
    pixels: riverPixels,
    name: 'Тестовая река',
    discoveredBy: [],
  };
  world.riverFeatures.push(testRiver);
  const branchPixels = [];
  for (let x = 19; x <= 70; x += 1) {
    const pixel = (y0 + 80) * MAP_WIDTH + x0 + x;
    world.rivers[pixel] = 1;
    branchPixels.push(pixel);
  }
  const firstTributary = {
    id: world.riverFeatures.length,
    scaleRank: 1,
    paths: [[{ x: x0 + 19.5, y: y0 + 80 }, { x: x0 + 70, y: y0 + 80 }]],
    pixels: branchPixels,
    name: 'Первая притока',
    discoveredBy: [country.id],
  };
  world.riverFeatures.push(firstTributary);
  const secondBranchPixels = [];
  for (let y = 50; y <= 80; y += 1) {
    const pixel = (y0 + y) * MAP_WIDTH + x0 + 70;
    world.rivers[pixel] = 1;
    secondBranchPixels.push(pixel);
  }
  world.riverFeatures.push({
    id: world.riverFeatures.length,
    scaleRank: 1,
    paths: [[{ x: x0 + 70, y: y0 + 50 }, { x: x0 + 70, y: y0 + 80 }]],
    pixels: secondBranchPixels,
    name: 'Вторая притока',
    discoveredBy: [country.id],
  });
  world.recountCountries();
  const ownCityPixel = (y0 + 1) * MAP_WIDTH + x0 + 19;
  world.rivers[ownCityPixel] = 0;
  assert.ok(world.addCity(country.id, ownCityPixel, 1, false));
  const riverPortPixel = (y0 + 20) * MAP_WIDTH + x0 + 19;
  assert.ok(world.addCity(country.id, riverPortPixel, 1, false),
    'тестовый речной бассейн должен пересекать зону влияния реального речного порта');
  const coastPixels = [];
  for (let x = 1; x <= 40; x += 1) coastPixels.push((y0 + 1) * MAP_WIDTH + x0 + x);
  for (let y = 2; y <= 120; y += 1) coastPixels.push((y0 + y) * MAP_WIDTH + x0 + 40);
  world.water.coastsOf = [Int32Array.from(coastPixels)];

  const foreignCulture = world.newCulture(null, 1000);
  const foreign = world.newCountry({
    rank: 'тест',
    cultureId: foreignCulture.id,
    religionId: null,
    density: 10,
    foundedYear: 1000,
    parentId: null,
  });
  const foreignMix = world.cultureTable.single(foreignCulture.id, 100);
  for (let y = 0; y <= 2; y += 1) {
    for (let x = 20; x <= 22; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      world.setOwner(pixel, foreign.id + 1);
      world.density[pixel] = 10;
      world.culture[pixel] = foreignMix;
    }
  }
  for (let y = 119; y <= 121; y += 1) {
    for (let x = 39; x <= 41; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      world.setOwner(pixel, foreign.id + 1);
      world.density[pixel] = 10;
      world.culture[pixel] = foreignMix;
    }
  }
  world.recountCountries();
  assert.ok(world.addCity(foreign.id, (y0 + 1) * MAP_WIDTH + x0 + 20, 1, false));
  assert.ok(world.addCity(foreign.id, (y0 + 120) * MAP_WIDTH + x0 + 40, 1, false));

  const betterTemperature = 20, betterHumidity = 55;
  for (let y = 75; y <= 80; y += 1) {
    for (let x = 20; x <= 26; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      world.temperature[pixel] = betterTemperature;
      world.humidity[pixel] = betterHumidity;
    }
  }
  return {
    world,
    country,
    x0,
    y0,
    betterTemperature,
    betterHumidity,
    riverPixels,
    testRiver,
    remoteRiverPixel: (y0 + 50) * MAP_WIDTH + x0 + 70,
    blockedPixel: (y0 + 120) * MAP_WIDTH + x0 + 40,
    preferredPixel: (y0 + 75) * MAP_WIDTH + x0 + 20,
    cityCapturePixel: (y0 + 1) * MAP_WIDTH + x0 + 20,
  };
}

const colonizationFixtureData = colonizationContourFixture();
const undiscoveredRiverPlan = colonizationPlan(colonizationFixtureData.world, colonizationFixtureData.country);
assert.equal(undiscoveredRiverPlan.targets[colonizationFixtureData.preferredPixel], 0,
  'an undiscovered river does not make its adjacent inland target available');
assert.equal(colonizationFixtureData.world.discoverGeography(), true,
  'territorial expansion reveals the adjacent river through the game path');
const colonizationPlanData = colonizationPlan(
  colonizationFixtureData.world,
  colonizationFixtureData.country,
);
assert.ok(colonizationPlanData.targetCount > 0, 'речная область содержит подходящие цели колонизации');
assert.equal(colonizationPlanData.targets[colonizationFixtureData.preferredPixel], 1,
  'предпочтительный климатический контур доступен по реке');
assert.equal(colonizationPlanData.targets[colonizationFixtureData.blockedPixel], 1,
  'точка внутри чужой городской сферы есть в географическом плане для проверки городского запрета');
assert.ok(colonizationPlanData.routePoints.length > 0,
  'известный речной бассейн попадает в индекс маршрутов колонизации');
assert.equal(
  territoryInkCapacity([0, 1, 2], { strategyTerritoryInkCostAt: (pixel) => [0.25, 0.5, 0.75][pixel] }, 10),
  1.5,
  'вместимость расширения складывает фактическую цену всех точек, а не их количество',
);
assert.equal(
  territoryInkCapacity([0, 1, 2], { strategyTerritoryInkCostAt: (pixel) => [0.25, 0.5, 0.75][pixel] }, 1),
  1,
  'вместимость расширения не превышает лимит ранга',
);
const capacityTargetPixel = colonizationFixtureData.cityCapturePixel;
const capacityDonorPixel = colonizationPlanData.donors[0];
const oneTargetColonizationPlan = {
  ...colonizationPlanData,
  targets: new Uint8Array(MAP_WIDTH * MAP_HEIGHT),
  targetCount: 1,
  donors: [capacityDonorPixel],
  hint: capacityTargetPixel,
  availablePopulation: colonizationFixtureData.world.density[capacityDonorPixel],
};
oneTargetColonizationPlan.targets[capacityTargetPixel] = 1;
const originalColonizationCost = CardPainter.prototype.strategyColonizationInkCapacityAt;
CardPainter.prototype.strategyColonizationInkCapacityAt = () => 0.25;
try {
  const capacity = colonizationInkCapacity(
    colonizationFixtureData.world,
    colonizationFixtureData.country,
    oneTargetColonizationPlan,
  );
  assert.equal(capacity, 0.25,
    'вместимость колонизации учитывает дробную стоимость единственной допустимой точки');
  const fractionalColonizationCard = drawColonization(
    colonizationFixtureData.world,
    colonizationFixtureData.country,
    oneTargetColonizationPlan,
    capacity,
  );
  assert.equal(fractionalColonizationCard?.inkTotal, 0.25,
    'карта колонизации может использовать дробную квоту одного прохода');
} finally {
  CardPainter.prototype.strategyColonizationInkCapacityAt = originalColonizationCost;
}
assert.equal(colonizationPlanData.targets[colonizationFixtureData.remoteRiverPixel], 1,
  'речной маршрут рекурсивно включает притоку притоки основного бассейна');
assert.equal(colonizationPlanData.anchors[colonizationFixtureData.remoteRiverPixel], 1,
  'удалённая речная цель сама является якорем колонизации');
let remoteRiverTouchesHome = false;
forEachNeighbour(colonizationFixtureData.remoteRiverPixel, (neighbor) => {
  if (colonizationFixtureData.world.owner[neighbor] === colonizationFixtureData.country.id + 1) {
    remoteRiverTouchesHome = true;
  }
});
assert.equal(remoteRiverTouchesHome, false,
  'удалённая речная цель не прилегает к территории страны');
const riverInfluenceIndex = new CityInfluenceIndex(
  colonizationFixtureData.world,
  colonizationFixtureData.country.id,
  true,
  colonizationPlanData.anchors,
  colonizationPlanData.routePoints,
  colonizationPlanData.cityInfluenceAreas,
);
assert.ok(riverInfluenceIndex.at(colonizationFixtureData.remoteRiverPixel, true).ownRankSum > 0,
  'колонизационные модификаторы распространяются на всю рекурсивную зону бассейна');
assert.equal(
  new CityInfluenceIndex(colonizationFixtureData.world, colonizationFixtureData.country.id)
    .at(colonizationFixtureData.remoteRiverPixel).ownRankSum,
  0,
  'обычная сфера города не расширяется по речному бассейну',
);
const expansionFixture = colonizationContourFixture();
const expansionCity = expansionFixture.world.cities.find(
  (city) => city.countryId === expansionFixture.country.id,
);
assert.ok(expansionCity);
const coastX = expansionCity.pixel % MAP_WIDTH;
const coastY = Math.floor(expansionCity.pixel / MAP_WIDTH);
const ownedCoast = [];
for (let y = coastY; y <= expansionFixture.y0 + 80; y += 1) {
  ownedCoast.push(y * MAP_WIDTH + coastX);
}
const inaccessibleCoast = (expansionFixture.y0 + 150) * MAP_WIDTH + expansionFixture.x0 + 80;
expansionFixture.world.water.coastsOf = [
  Int32Array.from([...ownedCoast, inaccessibleCoast]),
];
const expansionRoutes = expansionCoastRoutePoints(expansionFixture.world, expansionFixture.country);
const remoteCoastPixel = ownedCoast[ownedCoast.length - 1];
assert.ok(expansionRoutes.some((route) => route.pixel === remoteCoastPixel),
  'расширение использует непрерывный береговой контур, пересекающий границу своей страны');
assert.equal(expansionRoutes.some((route) => route.pixel === inaccessibleCoast), false,
  'расширение не использует береговой контур, не пересекающий границу своей страны');
const expansionInfluence = new CityInfluenceIndex(
  expansionFixture.world,
  expansionFixture.country.id,
  false,
  undefined,
  expansionRoutes,
);
assert.ok(expansionInfluence.nearestRouteDistance(remoteCoastPixel) <
  expansionInfluence.at(remoteCoastPixel).nearestOwnDistance,
  'для расширения выбирается более выгодный путь через доступное побережье');
const coastRefreshFixture = colonizationContourFixture();
const newlyOwnedCoastPixel = (coastRefreshFixture.y0 + 10) * MAP_WIDTH + coastRefreshFixture.x0 + 20;
const adjacentWaterPixel = newlyOwnedCoastPixel + 1;
coastRefreshFixture.world.land[adjacentWaterPixel] = 0;
coastRefreshFixture.world.landIndex = Int32Array.from(
  [...coastRefreshFixture.world.landIndex].filter((pixel) => pixel !== adjacentWaterPixel),
);
const refreshCoast = [];
for (let y = 10; y <= 80; y += 1) {
  refreshCoast.push((coastRefreshFixture.y0 + y) * MAP_WIDTH + coastRefreshFixture.x0 + 20);
}
coastRefreshFixture.world.water.coastsOf = [Int32Array.from(refreshCoast)];
const coastRefreshCard = climateCard(
  'expand',
  coastRefreshFixture.country.id,
  newlyOwnedCoastPixel,
  2_000,
);
const coastRefreshPainter = new CardPainter(coastRefreshFixture.world, coastRefreshCard, 'respect');
const coastRefreshTarget = refreshCoast[refreshCoast.length - 1];
const impactBeforeCoastOwnership = coastRefreshPainter.strategyImpactAt(coastRefreshTarget);
coastRefreshPainter.dab(
  newlyOwnedCoastPixel % MAP_WIDTH,
  Math.floor(newlyOwnedCoastPixel / MAP_WIDTH),
  0,
);
assert.equal(coastRefreshFixture.world.owner[newlyOwnedCoastPixel], coastRefreshFixture.country.id + 1,
  'кисть расширения может занять доступный прибрежный участок');
assert.ok(coastRefreshPainter.strategyImpactAt(coastRefreshTarget) > impactBeforeCoastOwnership,
  'приобретение берега немедленно обновляет морской маршрут расширения');
const colonizationCard = climateCard(
  'colonization',
  colonizationFixtureData.country.id,
  -1,
  20,
);
const colonizationPainter = new CardPainter(colonizationFixtureData.world, colonizationCard, 'respect');
const worldBounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
const colonizationArea = colonizationPainter.strategyCandidateArea(worldBounds);
assert.ok(colonizationPainter.strategyImpactAt(colonizationFixtureData.preferredPixel) > 0,
  'доступный речной маршрут даёт силу кисти за пределами круга города');
assert.equal(colonizationPainter.strategyImpactAt(colonizationFixtureData.blockedPixel), 0,
  'чужая городская сфера без пересечения со своей запрещает колонизацию точки');
assert.equal(colonizationArea.contains(colonizationFixtureData.blockedPixel), false,
  'ИИ исключает запрещённую городскую область ещё при выборе контуров');
const influenceIndex = new CityInfluenceIndex(
  colonizationFixtureData.world,
  colonizationFixtureData.country.id,
);
const influenceAreas = influenceIndex.colonizationInfluenceAreas();
for (const city of colonizationFixtureData.world.cities) {
  const cx = city.pixel % MAP_WIDTH;
  const cy = Math.floor(city.pixel / MAP_WIDTH);
  for (let y = cy - 90; y <= cy + 90; y += 5) {
    for (let x = cx - 90; x <= cx + 90; x += 5) {
      if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) continue;
      const pixel = y * MAP_WIDTH + x;
      const influence = influenceIndex.at(pixel);
      assert.equal(influenceAreas.own.contains(pixel), influence.ownRankSum > 0,
        'контур своей городской сферы совпадает с индексом кисти');
      assert.equal(influenceAreas.foreign.contains(pixel), influence.foreignRankSum > 0,
        'контур чужой городской сферы совпадает с индексом кисти');
    }
  }
}
const overlapPixel = colonizationFixtureData.cityCapturePixel;
const overlappingCity = colonizationFixtureData.world.cityAt(overlapPixel);
assert.ok(overlappingCity, 'чужой город находится в точке пересечения городских сфер');
assert.equal(overlappingCity.countryId !== colonizationFixtureData.country.id, true,
  'до колонизации город принадлежит соседней стране');
assert.ok(influenceAreas.own.contains(overlapPixel) && influenceAreas.foreign.contains(overlapPixel),
  'точка находится одновременно в своей и чужой городских сферах');
assert.equal(colonizationArea.contains(overlapPixel), true,
  'своя городская сфера разрешает колонизацию точки внутри чужой сферы');
const playerCaptureFixture = colonizationContourFixture();
assert.equal(playerCaptureFixture.world.discoverGeography(), true);
const playerCapturePlan = colonizationPlan(playerCaptureFixture.world, playerCaptureFixture.country);
const playerCapturePixel = playerCaptureFixture.cityCapturePixel;
assert.equal(playerCapturePlan.targets[playerCapturePixel], 1,
  'доступная точка чужого города включена в контур колонизации');
const capturedCity = playerCaptureFixture.world.cityAt(playerCapturePixel);
assert.ok(capturedCity);
const cityResidentsBeforeCapture = capturedCity.population;
const ruralCultureBeforeCapture = playerCaptureFixture.world.culture[playerCapturePixel];
const playerCaptureGame = new Game(playerCaptureFixture.world, 'all');
const playerCaptureCard = climateCard(
  'colonization',
  playerCaptureFixture.country.id,
  playerCapturePlan.hint,
  20,
);
playerCaptureGame.card = playerCaptureCard;
playerCaptureGame.startCard(playerCaptureCard);
playerCaptureGame.dispatchAction({
  type: 'dab',
  x: playerCapturePixel % MAP_WIDTH,
  y: Math.floor(playerCapturePixel / MAP_WIDTH),
  radius: 0,
});
assert.ok(playerCaptureGame.painter.changed.includes(playerCapturePixel),
  'ход игрока меняет владельца доступной городской точки кистью колонизации');
assert.equal(playerCaptureFixture.world.owner[playerCapturePixel], playerCaptureFixture.country.id + 1);
assert.equal(capturedCity.countryId, playerCaptureFixture.country.id,
  'город переходит к стране вместе с территорией');
assert.equal(capturedCity.population, cityResidentsBeforeCapture,
  'колонизация территории не меняет население города напрямую');
assert.notEqual(playerCaptureFixture.world.culture[playerCapturePixel], ruralCultureBeforeCapture,
  'колонизация меняет состав сельского населения под городом');
playerCaptureGame.discard();
const colonizationActions = {
  beginStroke: (x, y) => colonizationPainter.dab(x, y, 10),
  dab: (x, y, radius) => colonizationPainter.dab(x, y, radius),
  line: (ax, ay, bx, by, radius) => colonizationPainter.line(ax, ay, bx, by, radius),
  endStroke: () => colonizationPainter.endStroke(),
  contour: (area, seed) => colonizationPainter.paintContour(area, seed),
  contours: (areas) => colonizationPainter.paintContours(areas),
};
autoPaint(colonizationPainter, colonizationActions);
assert.ok(colonizationPainter.changed.length > 0, 'ИИ колонизирует часть разрешённой речной области');
assert.ok(colonizationPainter.changed.includes(colonizationFixtureData.cityCapturePixel),
  'ИИ в первую очередь выбирает доступную точку вражеского города');
assert.equal(
  colonizationFixtureData.world.cityAt(colonizationFixtureData.cityCapturePixel).countryId,
  colonizationFixtureData.country.id,
  'город захватывается тем же контурным путём, что и территория под ним',
);
assert.ok(colonizationPainter.changed.every((pixel) => colonizationPlanData.targets[pixel] === 1),
  'кисть остаётся внутри береговых и речных целей плана колонизации');

const disconnectedRiverFixture = colonizationContourFixture();
const disconnectedRiverWorld = disconnectedRiverFixture.world;
const disconnectedRiverCountry = disconnectedRiverFixture.country;
disconnectedRiverWorld.cities = disconnectedRiverWorld.cities.filter(
  (city) => city.countryId === disconnectedRiverCountry.id,
);
assert.equal(disconnectedRiverWorld.discoverGeography(), true);
const disconnectedRiverPlan = colonizationPlan(disconnectedRiverWorld, disconnectedRiverCountry);
const disconnectedRiverPixel = disconnectedRiverFixture.remoteRiverPixel;
assert.equal(disconnectedRiverPlan.targets[disconnectedRiverPixel], 1,
  'удалённая речная цель входит в доступную область колонизации');
assert.equal(disconnectedRiverPlan.anchors[disconnectedRiverPixel], 1,
  'удалённая речная цель отмечена отдельным речным якорем');
const disconnectedRiverCard = climateCard(
  'colonization',
  disconnectedRiverCountry.id,
  -1,
  colonizationInkCapacity(disconnectedRiverWorld, disconnectedRiverCountry, disconnectedRiverPlan),
);
const disconnectedRiverPainter = new CardPainter(disconnectedRiverWorld, disconnectedRiverCard, 'respect');
const disconnectedRiverActions = {
  beginStroke: (x, y) => disconnectedRiverPainter.dab(x, y, 10),
  dab: (x, y, radius) => disconnectedRiverPainter.dab(x, y, radius),
  line: (ax, ay, bx, by, radius) => disconnectedRiverPainter.line(ax, ay, bx, by, radius),
  endStroke: () => disconnectedRiverPainter.endStroke(),
  contour: (area, seed) => disconnectedRiverPainter.paintContour(area, seed),
  contours: (areas) => disconnectedRiverPainter.paintContours(areas),
};
autoPaint(disconnectedRiverPainter, disconnectedRiverActions);
assert.ok(disconnectedRiverPainter.changed.includes(disconnectedRiverPixel),
  'ИИ колонизирует речную цель вдали от границы своей территории');
assert.ok(disconnectedRiverPainter.changed.every((pixel) => disconnectedRiverPlan.targets[pixel] === 1),
  'удалённая речная кисть остаётся в исходных допустимых целях');

const peacefulExpansionFixture = colonizationContourFixture();
const peacefulWorld = peacefulExpansionFixture.world;
const peacefulCountry = peacefulExpansionFixture.country;
const rivalIds = new Set(
  peacefulWorld.countries
    .filter((candidate) => candidate.id !== peacefulCountry.id)
    .map((candidate) => candidate.id),
);
for (const pixel of peacefulWorld.landIndex) {
  if (rivalIds.has(peacefulWorld.owner[pixel] - 1)) peacefulWorld.setOwner(pixel, 0);
}
peacefulWorld.cities = peacefulWorld.cities.filter((city) => city.countryId === peacefulCountry.id);
peacefulWorld.countries = peacefulWorld.countries.filter((candidate) => candidate.id === peacefulCountry.id);
peacefulWorld.recountCountries();
for (let y = 15; y <= 105; y += 1) {
  for (let x = 20; x <= 95; x += 1) {
    const pixel = (peacefulExpansionFixture.y0 + y) * MAP_WIDTH +
      peacefulExpansionFixture.x0 + x;
    peacefulWorld.temperature[pixel] = 20;
    peacefulWorld.humidity[pixel] = 55;
  }
}
const peacefulHint = (peacefulExpansionFixture.y0 + 75) * MAP_WIDTH +
  peacefulExpansionFixture.x0 + 20;
const peacefulCard = climateCard('expand', peacefulCountry.id, peacefulHint, 250);
const peacefulPainter = new CardPainter(peacefulWorld, peacefulCard, 'respect');
const ownedBeforePeacefulExpansion = peacefulCountry.pixels;
const peacefulActions = {
  beginStroke: (x, y) => peacefulPainter.dab(x, y, 10),
  dab: (x, y, radius) => peacefulPainter.dab(x, y, radius),
  line: (ax, ay, bx, by, radius) => peacefulPainter.line(ax, ay, bx, by, radius),
  endStroke: () => peacefulPainter.endStroke(),
  contour: (area, seed) => peacefulPainter.paintContour(area, seed),
  contours: (areas) => peacefulPainter.paintContours(areas),
};
autoPaint(peacefulPainter, peacefulActions);
assert.ok(peacefulCountry.pixels > ownedBeforePeacefulExpansion,
  'без соседей ИИ всё равно выбирает доступную новую территорию, если климатическая выгода высокая');

const climateOnlyFixture = colonizationContourFixture();
const climateOnlyEnemyIds = new Set(
  climateOnlyFixture.world.countries
    .filter((country) => country.id !== climateOnlyFixture.country.id)
    .map((country) => country.id),
);
for (const enemyId of climateOnlyEnemyIds) {
  const enemy = climateOnlyFixture.world.countries[enemyId];
  const pixels = [];
  climateOnlyFixture.world.forEachCountryPixel(enemy, (pixel) => pixels.push(pixel));
  for (const pixel of pixels) climateOnlyFixture.world.setOwner(pixel, 0);
}
climateOnlyFixture.world.cities = climateOnlyFixture.world.cities
  .filter((city) => city.countryId === climateOnlyFixture.country.id);
climateOnlyFixture.world.recountCountries();
assert.equal(climateOnlyFixture.world.discoverGeography(), true);
const climateOnlyPlan = colonizationPlan(climateOnlyFixture.world, climateOnlyFixture.country);
const climateOnlyCard = climateCard(
  'colonization', climateOnlyFixture.country.id, -1, 0.02,
);
const climateOnlyPainter = new CardPainter(climateOnlyFixture.world, climateOnlyCard, 'respect');
const climateOnlyActions = {
  beginStroke: (x, y) => climateOnlyPainter.dab(x, y, 10),
  dab: (x, y, radius) => climateOnlyPainter.dab(x, y, radius),
  line: (ax, ay, bx, by, radius) => climateOnlyPainter.line(ax, ay, bx, by, radius),
  endStroke: () => climateOnlyPainter.endStroke(),
  contour: (area, seed) => climateOnlyPainter.paintContour(area, seed),
  contours: (areas) => climateOnlyPainter.paintContours(areas),
};
autoPaint(climateOnlyPainter, climateOnlyActions);
assert.ok(climateOnlyPainter.changed.length > 0);
assert.equal(
  climateOnlyFixture.world.temperature[climateOnlyPainter.changed[0]],
  climateOnlyFixture.betterTemperature,
  'без доступного города ИИ выбирает климатически подходящую цель',
);
assert.equal(
  climateOnlyFixture.world.humidity[climateOnlyPainter.changed[0]],
  climateOnlyFixture.betterHumidity,
  'климатический выбор учитывает влажность и температуру',
);
assert.ok(climateOnlyPainter.changed.every((pixel) => climateOnlyPlan.targets[pixel] === 1));

function cityPlacementFixture() {
  const world = World.create('random', 61503);
  world.riverFeatures = [];
  world.water.coastsOf = [];
  world.isCoastal = () => false;
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
const expectedCitySite = cityGame.chooseAutomaticCitySite(cityFixture.country);
const expectedCityPopulation = cityGame.expectedCityPopulation(
  expectedCitySite,
  false,
  new Map(),
  false,
  cityFixture.country.id,
);
const spikeCityPopulation = cityGame.expectedCityPopulation(
  cityFixture.spike,
  false,
  new Map(),
  false,
  cityFixture.country.id,
);
assert.ok(
  expectedCityPopulation > spikeCityPopulation,
  'automatic placement chooses a city zone that gathers more residents than the isolated density peak',
);
cityGame.resolveAutomatically(cityCard);
const placedCity = cityFixture.world.cities.find((city) =>
  city.countryId === cityFixture.country.id && !city.capital,
);
assert.ok(placedCity, 'automatic city placement creates a legal additional city');
assert.equal(placedCity.pixel, expectedCitySite, 'the live placement follows the same automatic scoring path');
assert.equal(placedCity.population, expectedCityPopulation, 'the placed city receives the predicted residents');
assert.notEqual(placedCity.pixel, cityFixture.spike, 'the isolated density peak is not the preferred city site');
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
      density: residentsToDensity(spike ? 250 : dense ? 80 : 20),
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
    populationByPixel: new Map(nomad.cells.map((cell) => [cell.pixel, densityToResidents(cell.density)])),
  };
}

const nomadFixture = nomadPlacementFixture();
const nomadCard = climateCard('buildCity', nomadFixture.nomad.id, -1, 0);
const nomadGame = new Game(nomadFixture.world, 'observer');
const expectedNomadSite = nomadGame.chooseAutomaticCitySite(nomadFixture.nomad);
const nomadSiteScore = (pixel) => nomadGame.expectedCityPopulation(
  pixel,
  true,
  nomadFixture.populationByPixel,
  true,
  nomadFixture.nomad.id,
);
const bestNomadScore = Math.max(...nomadFixture.range.map(nomadSiteScore));
assert.equal(
  nomadSiteScore(expectedNomadSite),
  bestNomadScore,
  'automatic settlement chooses the site with the largest footprint under the shared city rule',
);
nomadGame.resolveAutomatically(nomadCard);
assert.equal(nomadFixture.nomad.type, 'settled',
  'automatic nomad settlement follows the existing nomadic city rule');
const nomadCity = nomadFixture.world.cities.find((city) => city.countryId === nomadFixture.nomad.id);
assert.ok(nomadCity, 'the nomadic country is settled with a city');
assert.equal(
  nomadCity.pixel,
  expectedNomadSite,
  'live nomadic settlement uses the same site-selection calculation as its preview',
);
nomadGame.discard();

console.log('Проверки климатического выбора, долей смешанного происхождения, поселений, детерминированности и расхода чернил пройдены.');
