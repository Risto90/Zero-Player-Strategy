import { strict as assert } from 'node:assert';
import { MAP_POINT_AREA_KM2, MAP_WIDTH } from '../game/config.ts';
import { ContourArea } from '../game/contours.ts';
import {
  CITY_BASE_INFLUENCE_AREA_PIXELS,
  CITY_BASE_RADIUS,
  CityInfluenceIndex,
  cityInfluenceArea,
  cityHasPort,
  cityIsRiverPort,
  cityInfluenceMultiplier,
  cityInfluenceRadius,
  cityBaseRadiusForRank,
} from '../game/settlements.ts';

const rows = 300;
const land = new Uint8Array(MAP_WIDTH * rows);
const rivers = new Uint8Array(MAP_WIDTH * rows);
const coasts = new Set();
const world = {
  version: 0,
  territoryVersion: 0,
  geographyRevision: 0,
  land,
  rivers,
  cities: [],
  riverFeatures: [{
    id: 0,
    name: 'Тестовая река',
    scaleRank: 1,
    discoveredBy: [1],
    paths: [[{ x: 98, y: 100 }, { x: 110, y: 100 }]],
  }],
  water: { coastsOf: [] },
  isCoastal: (pixel) => coasts.has(pixel),
};

function pixel(x, y) {
  return y * MAP_WIDTH + x;
}
function makeCity(id, countryId, x, y, rank, capital = false) {
  return { id, chronicleId: id + 1, countryId, pixel: pixel(x, y), rank, population: 100, capital };
}
function markAnchor(x, y, { coastal = false, river = false } = {}) {
  const target = pixel(x, y);
  land[target] = 1;
  if (coastal) coasts.add(target);
  if (river) rivers[target] = 1;
  return target;
}

const portCapital = makeCity(0, 1, 100, 100, 2, true);
const foreignCity = makeCity(1, 2, 101, 100, 1);
const distantOwnCity = makeCity(2, 1, 500, 100, 1);
const riverOnlyCity = makeCity(3, 1, 106, 100, 1);
world.cities.push(portCapital, foreignCity, distantOwnCity);
land[portCapital.pixel] = 1;
land[foreignCity.pixel] = 1;
land[distantOwnCity.pixel] = 1;
for (let x = 100; x <= 300; x += 1) land[pixel(x, 100)] = 1;
coasts.add(portCapital.pixel);
world.water.coastsOf.push(Int32Array.from([portCapital.pixel]));
rivers[portCapital.pixel] = 1;

assert.equal(cityInfluenceMultiplier(world, portCapital), 6, 'порт-столица сохраняет множитель 6');
const portBaseArea = Math.PI * cityBaseRadiusForRank(portCapital.rank) ** 2;
assert.equal(cityInfluenceArea(world, portCapital), portBaseArea * 6);
const portRadius = Math.sqrt(portBaseArea * 6 / Math.PI);
assert.ok(Math.abs(cityInfluenceRadius(world, portCapital) - portRadius) < 1e-10);
assert.ok(Math.abs(0.1 * CITY_BASE_INFLUENCE_AREA_PIXELS * MAP_POINT_AREA_KM2 - 250) < 1e-9,
  'базовая зона ранга 1 собирает около 250 жителей при плотности 1 чел./км²');
for (let rank = 2; rank <= 6; rank += 1) {
  const previous = cityBaseRadiusForRank(rank - 1);
  const current = cityBaseRadiusForRank(rank);
  assert.equal(current, Math.max(previous * 1.5, previous + 1),
    'радиус каждого следующего ранга растёт на 50%, но минимум на одну точку');
}
assert.equal(cityIsRiverPort(world, riverOnlyCity), true,
  'порт определяется пересечением города с векторным контуром реки');
assert.equal(cityHasPort(world, riverOnlyCity), true,
  'речной город получает тот же признак порта, что и речной контур');

const coastalAnchor = markAnchor(105, 102, { coastal: true });
const riverAnchor = markAnchor(108, 100, { river: true });
const masked = new Uint8Array(land.length);
masked[coastalAnchor] = 1;
const index = new CityInfluenceIndex(world, 1, true);
const atCapital = index.at(portCapital.pixel, true);
assert.equal(atCapital.ownRankSum, 2);
assert.equal(atCapital.ownLargestRank, 2);
assert.equal(atCapital.ownCityCount, 1, 'индекс учитывает город в точке запроса');
assert.equal(atCapital.foreignRankSum, 1);
assert.equal(atCapital.nearestOwnCityId, portCapital.id);
assert.equal(atCapital.nearestOwnCityPixel, portCapital.pixel);
assert.equal(atCapital.nearestOwnDistance, 0);
assert.equal(atCapital.nearestOwnAnchorPixel, portCapital.pixel);
assert.equal(atCapital.nearestOwnAnchorDistance, 0);
assert.deepEqual(index.citiesAt(portCapital.pixel).map(({ id }) => id).sort(), [0, 1]);

const farQuery = pixel(300, 100);
const nearestAcrossBuckets = index.at(farQuery);
assert.equal(nearestAcrossBuckets.nearestOwnCityId, portCapital.id);
assert.ok(Math.abs(nearestAcrossBuckets.nearestOwnDistance - (200 - portRadius)) < 1e-10);
const routeIndex = new CityInfluenceIndex(world, 1, false, undefined, [
  { pixel: pixel(250, 100), extraDistance: 10 },
]);
assert.equal(routeIndex.nearestRouteDistance(farQuery), 60,
  'длина берегового маршрута включает расстояние по воде');
assert.equal(routeIndex.nearestRouteDistance(pixel(500, 100)), Infinity,
  'береговой маршрут не пересекает отдельный контур суши');

const distanceTestArea = ContourArea.pixels([
  pixel(100, 100),
  pixel(200, 100),
  pixel(250, 100),
  pixel(350, 100),
  pixel(500, 100),
]);
const distanceBands = routeIndex.distanceBands(distanceTestArea, 10, 200);
let reconstructedDistanceArea = new ContourArea();
let previousDistanceArea = new ContourArea();
for (let index = 0; index < distanceBands.length; index += 1) {
  const band = distanceBands[index];
  assert.equal(band.intersect(reconstructedDistanceArea).size, 0,
    'дистанционные слои не перекрываются');
  reconstructedDistanceArea = reconstructedDistanceArea.union(band);
  const reachable = distanceTestArea.intersect(routeIndex.distanceReachableArea(index * 10));
  assert.deepEqual(band.spans, reachable.subtract(previousDistanceArea).spans,
    'слой совпадает с точной разностью доступных областей ядра');
  previousDistanceArea = reachable;
}
assert.deepEqual(reconstructedDistanceArea.spans, distanceTestArea.spans,
  'дистанционные слои вместе покрывают целевую область');
const singleDistanceContour = routeIndex.distanceReachableAreaWithin(distanceTestArea, 57);
assert.deepEqual(
  singleDistanceContour.spans,
  distanceTestArea.intersect(routeIndex.distanceReachableArea(57)).spans,
  'единый пороговый контур совпадает с пересечением полного доступного контура',
);

const areas = index.colonizationInfluenceAreas();
assert.equal(areas.own.contains(portCapital.pixel), true);
assert.equal(areas.foreign.contains(portCapital.pixel), true);
assert.equal(areas.own.contains(farQuery), false);

const maskedIndex = new CityInfluenceIndex(world, 1, true, masked);
assert.equal(maskedIndex.at(portCapital.pixel, true).nearestOwnAnchorPixel, coastalAnchor,
  'маска оставляет только разрешённый береговой якорь');

rivers[portCapital.pixel] = 0;
world.riverFeatures[0].discoveredBy = [];
world.version += 1;
world.geographyRevision += 1;
assert.equal(cityIsRiverPort(world, riverOnlyCity), false,
  'недоступный речной контур не считается портом для его страны');
assert.equal(cityHasPort(world, riverOnlyCity), false);
const afterPortChange = new CityInfluenceIndex(world, 1, true);
assert.equal(cityInfluenceMultiplier(world, portCapital), 4,
  'после удаления реки остаются береговой и столичный множители');
assert.equal(afterPortChange.at(portCapital.pixel).ownRankSum, 2,
  'портовый множитель не меняет наличие собственного города в контуре');
assert.equal(afterPortChange.at(pixel(180, 100)).ownRankSum, 0,
  'сфера влияния остаётся ограничена кругом города');

portCapital.pixel = pixel(160, 100);
const afterMove = new CityInfluenceIndex(world, 1);
assert.equal(afterMove.at(pixel(100, 100)).ownRankSum, 0);
assert.equal(afterMove.at(portCapital.pixel).ownRankSum, 2,
  'перемещённый город учитывается в заново построенном индексе');
assert.equal(afterMove.colonizationInfluenceAreas().own.contains(portCapital.pixel), true);

console.log('Проверки городского индекса, портовых множителей, якорей и пересчёта пройдены.');
