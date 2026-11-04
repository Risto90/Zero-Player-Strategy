import { strict as assert } from 'node:assert';
import { World } from '../game/world.ts';
import { deserializeWorld, serializeWorld } from '../game/persistence.ts';
import { ColonizationDonorHeap, transferColonizationPopulation } from '../game/colonization.ts';
import {
  cityComposition,
  cityInfluenceRadius,
  addCityAndConcentrate,
  concentrateCityPopulation,
  movePopulationToCity,
  populationAtPixel,
  resizeCityPopulation,
} from '../game/settlements.ts';
import { demography } from '../game/demography.ts';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { densityToResidents, roundResidents } from '../game/populationUnits.ts';
import { ancestryProfileId } from '../game/human.ts';
import { populationCohortsAtPixel, setPopulationCohortsAtPixel } from '../game/populationCohorts.ts';

function assertEqual(actual, expected, message) {
  assert.equal(actual, expected, message);
}

function setUp() {
  const world = World.create('random', 4321);
  const culture = world.newCulture(null, 0);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 1,
    foundedYear: 0,
    parentId: null,
  });
  let next = 0;
  const pixel = () => world.landIndex[next++];
  const ownPixel = (density, cityPopulation) => {
    const p = pixel();
    world.setOwner(p, country.id + 1);
    world.density[p] = density;
    world.culture[p] = world.cultureTable.single(culture.id, 100);
    const city = cityPopulation === null ? null : world.addCity(country.id, p, 1, false);
    if (city) resizeCityPopulation(world, city, cityPopulation);
    return { p, city };
  };
  return { world, country, ownPixel, pixel };
}

function transfer(world, donor, target, amount) {
  const ideal = world.density[donor] * 0.1;
  const result = transferColonizationPopulation(world, donor, target, amount / ideal);
  if (result) world.setOwner(target, world.owner[donor]);
  return result;
}

const { world, country, ownPixel, pixel } = setUp();

// Точка без города передаёт только сельскую плотность, сохраняя сумму растра.
const rural = ownPixel(14, null);
const ruralTarget = pixel();
const ruralTotalBefore = world.density[rural.p];
assert.ok(transfer(world, rural.p, ruralTarget, 1));
assertEqual(world.density[rural.p], 13, 'ordinary donor density');
assertEqual(world.density[ruralTarget], 1, 'ordinary target density');
assertEqual(world.density[rural.p] + world.density[ruralTarget], ruralTotalBefore, 'ordinary transfer total');
assertEqual(populationAtPixel(world, rural.p), densityToResidents(13),
  'city-free point converts rural density into residents');

// Перенос сельской плотности не меняет напрямую население города.
const urban = ownPixel(14, 1400);
for (let i = 0; i < 4; i += 1) {
  assert.ok(transfer(world, urban.p, pixel(), 1));
}
assertEqual(world.density[urban.p], 10, 'city contour density after four transfers');
assertEqual(urban.city.population, 1400, 'rural transfer leaves city residents unchanged');
assertEqual(populationAtPixel(world, urban.p),
  urban.city.population + densityToResidents(10), 'pixel total adds city residents and rural population');

// Города в равных контурах плотности считаются отдельно; точки без города остаются сельскими.
const firstCity = ownPixel(14, 1400);
const secondCity = ownPixel(14, 700);
const mixedContour = ownPixel(14, null);
assert.ok(transfer(world, firstCity.p, pixel(), 1));
assert.ok(transfer(world, secondCity.p, pixel(), 1));
assertEqual(firstCity.city.population, 1400, 'first city residents remain unchanged by raster transfer');
assertEqual(secondCity.city.population, 700, 'second city residents remain unchanged by raster transfer');
assertEqual(populationAtPixel(world, mixedContour.p), densityToResidents(14),
  'a point outside cities converts its rural density without urban addition');

// Выбор донора зависит от сельской плотности, а не от населения города.
const denseRuralDonor = ownPixel(14, null);
const lessDenseCityDonor = ownPixel(10, 10000);
assertEqual(
  new ColonizationDonorHeap(world, [lessDenseCityDonor.p, denseRuralDonor.p]).peek(),
  denseRuralDonor.p,
  'donor heap ranks rural density above city headcount',
);

// Перемещение сельского населения между точками городов сохраняет общую численность.
const sourceCity = ownPixel(8, 800);
const targetCity = ownPixel(5, 500);
const totalBeforeConcentration = populationAtPixel(world, sourceCity.p) + populationAtPixel(world, targetCity.p);
assertEqual(movePopulationToCity(world, sourceCity.p, targetCity.p, 1), 1, 'one resident moved between city points');
assertEqual(sourceCity.city.population, 800, 'moving rural residents leaves the source city count unchanged');
assertEqual(targetCity.city.population, 501, 'receiving city count includes concentrated residents');
assertEqual(
  populationAtPixel(world, sourceCity.p) + populationAtPixel(world, targetCity.p),
  totalBeforeConcentration,
  'city concentration conserves the population total',
);

// Состав групп населения города меняется независимо от сельского состава точки города.
const newCulture = world.newCulture(world.cultures[country.cultureId], 0);
const newReligion = world.newReligion(0);
const incomingRural = ownPixel(10, null);
const receivingCity = ownPixel(5, 500);
world.culture[incomingRural.p] = world.cultureTable.single(newCulture.id, 100);
world.religion[incomingRural.p] = world.religionTable.single(newReligion.id, 100);
const ruralCultureBefore = world.culture[receivingCity.p];
const ruralReligionBefore = world.religion[receivingCity.p];
assertEqual(movePopulationToCity(world, incomingRural.p, receivingCity.p, 2), 2, 'two rural residents concentrated into the city');
const urbanMix = cityComposition(world, receivingCity.city);
assert.ok(urbanMix.cultures.some((group) => group.id === newCulture.id && group.percent > 0), 'incoming culture is recorded in city cohorts');
assert.ok(urbanMix.religions.some((group) => group.id === newReligion.id && group.percent > 0), 'incoming religion is recorded in city cohorts');
assertEqual(world.culture[receivingCity.p], ruralCultureBefore, 'urban culture change does not overwrite rural pixel culture');
assertEqual(world.religion[receivingCity.p], ruralReligionBefore, 'urban religion change does not overwrite rural pixel religion');
world.version += 1;
assert.ok(demography(world, country).cultures.get(newCulture.id) > 0, 'country demography includes the separate city culture cohorts');

// Перемещение сохраняет доли групп донора, не подгоняя их под состав города.
const proportionalDonor = ownPixel(10, null);
const proportionalCity = ownPixel(5, 500);
const raceProfileA = ancestryProfileId({ ids: ['australoid'], shares: [100] });
const raceProfileB = ancestryProfileId({ ids: ['mongoloid'], shares: [100] });
setPopulationCohortsAtPixel(world, proportionalDonor.p, [
  {
    cultureId: country.cultureId,
    religionId: null,
    originProfileId: raceProfileA,
    weight: 1,
  },
  {
    cultureId: newCulture.id,
    religionId: newReligion.id,
    originProfileId: raceProfileB,
    weight: 1,
  },
]);
assertEqual(
  movePopulationToCity(world, proportionalDonor.p, proportionalCity.p, 100),
  100,
  'сто жителей перемещены из точки в город',
);
const proportionalCultureCounts = new Map();
for (const group of proportionalCity.city.populationGroups) {
  proportionalCultureCounts.set(group.cultureId,
    (proportionalCultureCounts.get(group.cultureId) ?? 0) + group.population);
}
assertEqual(proportionalCultureCounts.get(country.cultureId), 550,
  'половина перемещённого населения сохраняет культуру донора');
assertEqual(proportionalCultureCounts.get(newCulture.id), 50,
  'вторая половина перемещённого населения сохраняет культуру донора');

// Колонизация меняет сельский растр, но не группы жителей города.
const colonizingCity = ownPixel(14, 1400);
world.culture[colonizingCity.p] = world.cultureTable.single(newCulture.id, 100);
world.religion[colonizingCity.p] = world.religionTable.single(newReligion.id, 100);
assert.ok(transfer(world, colonizingCity.p, pixel(), 1));
assertEqual(colonizingCity.city.population, 1400, 'colonization leaves city residents unchanged');
assert.deepEqual(cityComposition(world, colonizingCity.city).cultures, [{ id: country.cultureId, percent: 100 }], "colonization preserves the city's separate culture composition");
assert.deepEqual(cityComposition(world, colonizingCity.city).religions, [{ id: null, percent: 100 }], "colonization preserves the city's separate religion composition");
assertEqual(world.cultureTable.shareOf(world.culture[colonizingCity.p], newCulture.id), 100, 'rural donor culture remains independently updated');

// Колонизация сохраняет точные группы, переносимые из точки-донора.
const mixedColonizationDonor = ownPixel(12, null);
const mixedColonizationTarget = pixel();
setPopulationCohortsAtPixel(world, mixedColonizationDonor.p, [
  {
    cultureId: country.cultureId,
    religionId: null,
    originProfileId: raceProfileA,
    weight: 1,
  },
  {
    cultureId: newCulture.id,
    religionId: newReligion.id,
    originProfileId: raceProfileB,
    weight: 1,
  },
]);
const initialDonorGroups = populationCohortsAtPixel(
  world, mixedColonizationDonor.p, world.density[mixedColonizationDonor.p],
);
assert.ok(transfer(world, mixedColonizationDonor.p, mixedColonizationTarget, 1));
const movedGroupTotals = new Map();
for (const p of [mixedColonizationDonor.p, mixedColonizationTarget]) {
  for (const group of populationCohortsAtPixel(world, p, world.density[p])) {
    const key = `${group.cultureId}/${group.religionId ?? -1}/${group.originProfileId}`;
    movedGroupTotals.set(key, (movedGroupTotals.get(key) ?? 0) + group.weight);
  }
}
assert.deepEqual(
  [...movedGroupTotals.entries()].sort(([a], [b]) => a.localeCompare(b)),
  initialDonorGroups.map((group) => [
    `${group.cultureId}/${group.religionId ?? -1}/${group.originProfileId}`,
    group.weight,
  ]).sort(([a], [b]) => a.localeCompare(b)),
  'колонизация сохраняет численность каждой культурной, религиозной и расовой группы',
);

let expectedCountryPopulation = 0;
let expectedRuralDensity = 0;
world.forEachCountryPixel(country, (p) => {
  expectedCountryPopulation += populationAtPixel(world, p);
  expectedRuralDensity += world.density[p];
});
const countryDemography = demography(world, country);
assertEqual(countryDemography.population, expectedCountryPopulation, 'country total uses city population without double counting');
assertEqual(countryDemography.density, expectedRuralDensity / country.pixels, 'country density remains the rural-layer average');

// При нулевом населении город удаляется, а малую положительную плотность всё ещё можно перемещать.
const boundary = ownPixel(0, 0);
assert.equal(transferColonizationPopulation(world, boundary.p, pixel(), 10), null);
assert.equal(boundary.city, null, 'a zero-resident city is not created');
const tiny = ownPixel(0.05, 0.05);
assert.ok(transfer(world, tiny.p, pixel(), 0.005));
assert.equal(world.cityAt(tiny.p), null, 'rounding zero city residents removes the city');

// Создание и повышение ранга собирают всю зону целевого ранга, а не только новое кольцо.
const rankWorld = World.create('random', 4321);
const rankCulture = rankWorld.newCulture(null, 0);
const rankCountry = rankWorld.newCountry({
  rank: 'тест',
  cultureId: rankCulture.id,
  religionId: null,
  density: 1,
  foundedYear: 0,
  parentId: null,
});
let rankFixture = null;
for (const center of rankWorld.landIndex) {
  if (rankWorld.isCoastal(center) || rankWorld.rivers[center]) continue;
  const probe = { countryId: rankCountry.id, pixel: center, rank: 1, capital: false };
  const oldRadius = cityInfluenceRadius(rankWorld, probe);
  probe.rank = 2;
  const newRadius = cityInfluenceRadius(rankWorld, probe);
  if (newRadius <= oldRadius) continue;
  let inner = -1, outer = -1;
  const cx = center % MAP_WIDTH, cy = Math.floor(center / MAP_WIDTH);
  for (let y = Math.max(0, Math.floor(cy - newRadius)); y <= Math.min(MAP_HEIGHT - 1, Math.ceil(cy + newRadius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - newRadius)); x <= Math.min(MAP_WIDTH - 1, Math.ceil(cx + newRadius)); x += 1) {
      const pixel = y * MAP_WIDTH + x;
      const distance = Math.hypot(x - cx, y - cy);
      if (!rankWorld.land[pixel] || pixel === center || distance > newRadius) continue;
      if (distance <= oldRadius && inner < 0) inner = pixel;
      if (distance > oldRadius && outer < 0) outer = pixel;
    }
  }
  if (inner >= 0 && outer >= 0) {
    rankFixture = { center, inner, outer };
    break;
  }
}
assert.ok(rankFixture, 'rank-up fixture has land inside both the old and expanded city zones');
for (const p of [rankFixture.center, rankFixture.inner, rankFixture.outer]) {
  rankWorld.setOwner(p, rankCountry.id + 1);
  rankWorld.density[p] = 100;
  rankWorld.culture[p] = rankWorld.cultureTable.single(rankCountry.cultureId, 100);
}
const rankPixels = [rankFixture.center, rankFixture.inner, rankFixture.outer];
const rankBounds = rankPixels.reduce((bounds, p) => {
  const x = p % MAP_WIDTH, y = Math.floor(p / MAP_WIDTH);
  return {
    x0: Math.min(bounds.x0, x), y0: Math.min(bounds.y0, y),
    x1: Math.max(bounds.x1, x), y1: Math.max(bounds.y1, y),
  };
}, { x0: MAP_WIDTH, y0: MAP_HEIGHT, x1: -1, y1: -1 });
rankWorld.contours.changed(rankBounds, ['density', 'culture']);
const densityBeforeCreation = new Map(rankPixels.map((p) => [p, rankWorld.density[p]]));
const rankCity = addCityAndConcentrate(rankWorld, rankCountry.id, rankFixture.center, false);
assert.ok(rankCity, 'rank-up fixture city is created and gathers its first zone');
for (const p of [rankFixture.center, rankFixture.inner]) {
  const taken = densityToResidents(densityBeforeCreation.get(p) - rankWorld.density[p]);
  assert.ok(Math.abs(taken - densityToResidents(10)) < 0.5,
    'creation collects ten percent from the full rank-one zone');
}
assert.equal(rankWorld.density[rankFixture.outer], 100, 'rank-one creation leaves the larger-rank annulus untouched');
const densityBeforePromotion = new Map(rankPixels.map((p) => [p, rankWorld.density[p]]));
const cityPopulationBeforeUpgrade = rankCity.population;
rankCity.rank = 2;
concentrateCityPopulation(rankWorld, rankCity);
const collectedResidents = [...densityBeforePromotion].reduce((sum, [p, before]) => {
  const taken = densityToResidents(before - rankWorld.density[p]);
  assert.ok(Math.abs(taken - densityToResidents(before) * 0.1) < 0.5,
    'promotion collects ten percent from every point in the full target-rank zone');
  return sum + taken;
}, 0);
assert.equal(rankCity.population - cityPopulationBeforeUpgrade, roundResidents(collectedResidents),
  'the promoted city receives the rounded residents collected from its full new zone');

// Население нового города переживает сохранение и загрузку; контуры плотности точно восстанавливают растр.
const beforeDensity = world.density.slice();
const saved = serializeWorld(world);
const loaded = deserializeWorld(saved);
assert.ok(saved.layers.density.every((zone, i, zones) =>
  (i === 0 || zones[i - 1].value < zone.value) && zone.rings.length > 0 &&
  zone.rings.every((ring) => ring.length >= 8 && ring.length % 2 === 0),
), 'density storage consists of ordered, closed equal-value contours');
assertEqual(loaded.cities.length, world.cities.length, 'city count after save/load');
for (let i = 0; i < world.cities.length; i += 1) {
  assertEqual(loaded.cities[i].population, world.cities[i].population, `city ${i} population after save/load`);
  assert.deepEqual(loaded.cities[i].populationGroups, world.cities[i].populationGroups, `city ${i} cohorts after save/load`);
}
for (let p = 0; p < MAP_PIXELS; p += 1) {
  assertEqual(loaded.density[p], beforeDensity[p], `density raster round-trip at ${p}`);
}

// В старых сохранениях не было поля населения города; сохранённая численность хранилась в плотности точки города.
const legacy = serializeWorld(world);
const legacyCity = legacy.cities[0];
const legacyCityResidents = Math.floor(world.density[legacyCity.pixel] + 0.5);
delete legacyCity.population;
delete legacyCity.populationGroups;
delete legacy.populationUnits;
const migrated = deserializeWorld(legacy);
assertEqual(migrated.cities[0].population, legacyCityResidents,
  'legacy city residents are migrated from the old cell count');
assertEqual(migrated.density[legacyCity.pixel], 0, 'legacy city population is removed from the rural layer');
assert.equal(
  migrated.cities[0].populationGroups.reduce((sum, group) => sum + group.population, 0),
  migrated.cities[0].population,
  'legacy city cohorts are reconstructed from saved pixel composition',
);

console.log(`City population checks passed for ${country.name}.`);
