import assert from 'node:assert/strict';
import { ContourArea, ScalarContourLayer, MapContours } from '../game/contours.ts';
import { MAP_WIDTH, MAP_HEIGHT, MAP_PIXELS } from '../game/config.ts';
import { rasterizeScalar } from '../game/zones.ts';
import { ContourPopulationReader } from '../game/contourPopulation.ts';
import { CountryExpansionContourIndex } from '../game/countryExpansionContours.ts';
import { forEachNeighbour } from '../game/geography.ts';

const pixels = (area) => {
  const result = new Set();
  area.forEachPixel((pixel) => result.add(pixel));
  return [...result].sort((a, b) => a - b);
};
const rectangle = (x0, y0, x1, y1) => ContourArea.rectangle({ x0, y0, x1, y1 });
let seed = 137;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

for (let iteration = 0; iteration < 100; iteration += 1) {
  const cx = iteration < 5 ? iteration * 0.5 : random() * 100;
  const cy = random() * 100;
  const radius = 1 + random() * 18;
  const expected = [];
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(MAP_HEIGHT - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(MAP_WIDTH - 1, Math.ceil(cx + radius)); x += 1) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius * radius) expected.push(y * MAP_WIDTH + x);
    }
  }
  assert.deepEqual(pixels(ContourArea.circle(cx, cy, radius)), expected, 'Круг совпадает с исходным мазком');
  const a = ContourArea.circle(cx, cy, radius);
  const b = rectangle(10, 10, 60, 60);
  const aa = new Set(pixels(a)), bb = new Set(pixels(b));
  assert.deepEqual(pixels(a.intersect(b)), [...aa].filter((p) => bb.has(p)), 'Точное пересечение');
  assert.deepEqual(pixels(a.subtract(b)), [...aa].filter((p) => !bb.has(p)), 'Точная разность');
  assert.deepEqual(pixels(a.union(b)), [...new Set([...aa, ...bb])].sort((x, y) => x - y), 'Точное объединение');
}

const donut = rectangle(10, 10, 40, 40).subtract(rectangle(15, 15, 35, 35));
const islands = donut.union(rectangle(70, 10, 75, 15));
assert.equal(islands.components().length, 2, 'Дыра не соединяет разные острова');
assert.equal(rectangle(1, 1, 1, 1).union(rectangle(2, 2, 2, 2)).components().length, 2, 'Диагональ не создаёт связность');
const raster = new Uint8Array(MAP_PIXELS);
rasterizeScalar([{ value: 1, rings: islands.rings() }], raster);
assert.deepEqual([...raster.keys()].filter((p) => raster[p] === 1), pixels(islands), 'Кольца точно восстанавливают площадь с дырой');

const values = new Uint8Array(MAP_PIXELS).fill(20);
const layer = new ScalarContourLayer(() => values);
const bounds = { x0: 0, y0: 0, x1: 80, y1: 80 };
const mask = new Uint8Array(MAP_PIXELS);
rectangle(11, 12, 15, 15).forEachPixel((pixel) => { mask[pixel] = 1; });
const masked = ContourArea.fromMask(mask, bounds, (_value, pixel) => pixel % MAP_WIDTH < 14);
assert.deepEqual(pixels(masked), pixels(rectangle(11, 12, 13, 15)),
  'Маска преобразуется в точные горизонтальные контуры с фильтром');
assert.deepEqual(pixels(ContourArea.fromBinaryMask(mask, bounds)), pixels(ContourArea.fromMask(mask, bounds)),
  'Бинарная маска преобразуется в те же контуры');
const unchangedRow = layer.row(70);
assert.equal(layer.select((v) => v === 20, bounds, '20').size, 81 * 81);
values[10 * MAP_WIDTH + 20] = 40;
layer.invalidate(10, 10);
assert.equal(layer.row(70), unchangedRow, 'Неизменённый контур строки остаётся в кэше');
assert.equal(layer.select((v) => v === 40, bounds, '40').size, 1, 'Изменение не теряется в кэше');

let version = 0;
const layers = {
  land: new Uint8Array(MAP_PIXELS),
  humidity: values,
  temperature: new Uint8Array(MAP_PIXELS).fill(50),
  drainage: new Uint8Array(MAP_PIXELS).fill(60),
};
rectangle(10, 10, 40, 40).forEachPixel((p) => { layers.land[p] = 1; });
const map = new MapContours((name) => layers[name], () => version);
const area = rectangle(10, 10, 40, 40);
const parts = map.climateIntersections(area);
assert.equal(parts.reduce((total, part) => total + part.area.size, 0), area.size, 'Пересечения климатов покрывают всю область');
for (const part of parts) part.area.forEachPixel((p) => {
  assert.equal(part.humidity, layers.humidity[p]);
  assert.equal(part.temperature, layers.temperature[p]);
  assert.equal(part.drainage, layers.drainage[p]);
});
const regions = map.climateRegions();
assert.equal(map.climateRegions(), regions, 'Климатические контуры повторно используются');
version += 1;
layers.temperature[20 * MAP_WIDTH + 20] = 70;
map.changed({ x0: 20, y0: 20, x1: 20, y1: 20 }, ['temperature']);
assert.notEqual(map.climateRegions(), regions, 'Изменение климата обновляет пересечения');
assert.equal(map.climateRegions()[map.climateRegionAt(20 * MAP_WIDTH + 20)].temperature, 70);
assert.ok(donut.border().size > 0);
assert.equal(donut.border().intersect(donut).size, 0, 'Граница не включает сам контур');
const demographicLayers = Object.fromEntries(['owner', 'culture', 'religion', 'humanOrigins', 'density']
  .map((name) => [name, name === 'density' ? new Float32Array(MAP_PIXELS) : new Uint16Array(MAP_PIXELS)]));
const country = { id: 0, box: [3, 4, 63, 65] };
const cities = [{ pixel: 20 * MAP_WIDTH + 20, countryId: 0 }, { pixel: 30 * MAP_WIDTH + 40, countryId: 0 }];
rectangle(3, 4, 63, 65).forEachPixel((p) => {
  demographicLayers.owner[p] = p % 7 === 0 ? 0 : 1;
  demographicLayers.culture[p] = (p % MAP_WIDTH) < 40 ? 1 : 2;
  demographicLayers.religion[p] = Math.floor(p / MAP_WIDTH) < 30 ? 0 : 1;
  demographicLayers.humanOrigins[p] = 1;
  demographicLayers.density[p] = (p % 13) / 3;
});
const demographicWorld = { ...demographicLayers, cities };
demographicWorld.contours = new MapContours((name) => demographicLayers[name], () => 0);
const keyOf = (p) => cities.some((city) => city.pixel === p) ? `город:${p}`
  : `${demographicLayers.culture[p]}/${demographicLayers.religion[p]}/${demographicLayers.humanOrigins[p]}`;
const referencePopulation = new Map(), contourPopulation = new Map();
rectangle(3, 4, 63, 65).forEachPixel((p) => {
  if (demographicLayers.owner[p] !== 1) return;
  const key = keyOf(p);
  referencePopulation.set(key, (referencePopulation.get(key) ?? 0) + demographicLayers.density[p]);
});
new ContourPopulationReader(demographicWorld, country).forEach((p, population) => {
  const key = keyOf(p);
  contourPopulation.set(key, (contourPopulation.get(key) ?? 0) + population);
});
assert.equal(contourPopulation.size, referencePopulation.size);
for (const [key, expected] of referencePopulation) {
  assert.ok(Math.abs(contourPopulation.get(key) - expected) < 1e-7, 'Контурные суммы сохраняют составы и отдельные города');
}
const expansionLayers = {
  owner: new Uint16Array(MAP_PIXELS),
  land: new Uint8Array(MAP_PIXELS),
  density: new Float32Array(MAP_PIXELS),
};
const waterBody = new Int32Array(MAP_PIXELS).fill(-1);
const expansionCountry = { id: 2, box: [90, 80, 100, 89], pixels: 0 };
for (let y = 80; y <= 89; y += 1) {
  for (let x = 90; x <= 100; x += 1) {
    const pixel = y * MAP_WIDTH + x;
    expansionLayers.land[pixel] = 1;
    expansionLayers.density[pixel] = (x + y) % 9;
    if ((x + y) % 5 !== 0) {
      expansionLayers.owner[pixel] = expansionCountry.id + 1;
      expansionCountry.pixels += 1;
    }
  }
}
for (let y = 80; y <= 89; y += 1) {
  const coastalPixel = y * MAP_WIDTH + 89;
  expansionLayers.land[coastalPixel] = 0;
  waterBody[coastalPixel] = 4;
}
const expansionWorld = {
  ...expansionLayers,
  water: { bodyOf: waterBody },
  contours: new MapContours((name) => expansionLayers[name], () => 0),
};
const expansionIndex = new CountryExpansionContourIndex(expansionWorld, expansionCountry);
const expectedFrontier = new Set();
const expectedSeas = new Set();
for (let y = 80; y <= 89; y += 1) {
  for (let x = 90; x <= 100; x += 1) {
    const pixel = y * MAP_WIDTH + x;
    if (expansionLayers.owner[pixel] !== expansionCountry.id + 1) continue;
    forEachNeighbour(pixel, (neighbor) => {
      if (waterBody[neighbor] >= 0) expectedSeas.add(waterBody[neighbor]);
      if (expansionLayers.land[neighbor] && expansionLayers.owner[neighbor] === 0) expectedFrontier.add(neighbor);
    });
  }
}
assert.deepEqual(pixels(expansionIndex.frontier()), [...expectedFrontier].sort((a, b) => a - b),
  'Контурный фронтир совпадает с попиксельной проверкой');
assert.deepEqual([...expansionIndex.seaBodies()].sort(), [...expectedSeas].sort(),
  'Контур границы сохраняет доступные морские бассейны');
const expansionCity = { countryId: expansionCountry.id, pixel: 84 * MAP_WIDTH + 94 };
const totalExpansionDensity = [...Array(MAP_PIXELS).keys()]
  .filter((pixel) => expansionLayers.owner[pixel] === expansionCountry.id + 1)
  .reduce((sum, pixel) => sum + expansionLayers.density[pixel], 0);
const expectedNonCityDensity = (totalExpansionDensity - expansionLayers.density[expansionCity.pixel]) /
  (expansionCountry.pixels - 1);
assert.ok(Math.abs(
  CountryExpansionContourIndex.averageNonCityDensity(
    expansionWorld, expansionCountry, totalExpansionDensity, [expansionCity],
  ) - expectedNonCityDensity,
) < 1e-9, 'Средняя плотность без городов сохраняется');
console.log('Проверены круги, пересечения, вычитание, связность, кольца с дырой и локальная инвалидация климатических контуров.');
