import { strict as assert } from 'node:assert';
import { MAP_WIDTH, RANKS } from '../game/config.ts';
import {
  CityInfluenceIndex,
  cityInfluenceArea,
  cityInfluenceMultiplier,
  cityInfluenceRadius,
} from '../game/settlements.ts';

const rows = 300;
const land = new Uint8Array(MAP_WIDTH * rows);
const rivers = new Uint8Array(MAP_WIDTH * rows);
const coasts = new Set();
const world = {
  land,
  rivers,
  cities: [],
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
const foreignCity = makeCity(1, 2, 120, 100, 1);
const distantOwnCity = makeCity(2, 1, 500, 100, 1);
world.cities.push(portCapital, foreignCity, distantOwnCity);
coasts.add(portCapital.pixel);
rivers[portCapital.pixel] = 1;

assert.equal(cityInfluenceMultiplier(world, portCapital), 6, 'порт-столица сохраняет множитель 6');
assert.equal(cityInfluenceArea(world, portCapital), RANKS[1].ink * 6);
const portRadius = Math.sqrt(RANKS[1].ink * 6 / Math.PI);
assert.ok(Math.abs(cityInfluenceRadius(world, portCapital) - portRadius) < 1e-10);

const coastalAnchor = markAnchor(105, 102, { coastal: true });
const riverAnchor = markAnchor(108, 100, { river: true });
const masked = new Uint8Array(land.length);
masked[coastalAnchor] = 1;
const index = new CityInfluenceIndex(world, 1, true);
const atCapital = index.at(portCapital.pixel, true);
assert.equal(atCapital.ownRankSum, 2);
assert.equal(atCapital.ownLargestRank, 2);
assert.equal(atCapital.ownCityCount, 1);
assert.equal(atCapital.foreignRankSum, 1);
assert.equal(atCapital.nearestOwnCityId, portCapital.id);
assert.equal(atCapital.nearestOwnCityPixel, portCapital.pixel);
assert.equal(atCapital.nearestOwnDistance, 0);
assert.equal(atCapital.nearestOwnAnchorPixel, coastalAnchor);
assert.ok(Math.abs(atCapital.nearestOwnAnchorDistance - Math.sqrt(29)) < 1e-10);
assert.deepEqual(index.citiesAt(portCapital.pixel).map(({ id }) => id).sort(), [0, 1]);

const farQuery = pixel(300, 100);
const nearestAcrossBuckets = index.at(farQuery);
assert.equal(nearestAcrossBuckets.nearestOwnCityId, portCapital.id);
assert.ok(Math.abs(nearestAcrossBuckets.nearestOwnDistance - (200 - portRadius)) < 1e-10);

const areas = index.colonizationInfluenceAreas();
assert.equal(areas.own.contains(portCapital.pixel), true);
assert.equal(areas.foreign.contains(portCapital.pixel), true);
assert.equal(areas.own.contains(farQuery), false);

const maskedIndex = new CityInfluenceIndex(world, 1, true, masked);
assert.equal(maskedIndex.at(portCapital.pixel, true).nearestOwnAnchorPixel, coastalAnchor,
  'маска оставляет только разрешённый береговой якорь');

coasts.delete(portCapital.pixel);
rivers[portCapital.pixel] = 0;
const afterPortChange = new CityInfluenceIndex(world, 1, true);
assert.equal(cityInfluenceMultiplier(world, portCapital), 2);
assert.equal(afterPortChange.at(portCapital.pixel).ownRankSum, 2);
assert.equal(afterPortChange.at(pixel(180, 100)).ownRankSum, 0,
  'изменение берега и реки пересчитывает городскую сферу в новом индексе');

portCapital.pixel = pixel(160, 100);
const afterMove = new CityInfluenceIndex(world, 1);
assert.equal(afterMove.at(pixel(100, 100)).ownRankSum, 0);
assert.equal(afterMove.at(portCapital.pixel).ownRankSum, 2,
  'перемещённый город учитывается в заново построенном индексе');
assert.equal(afterMove.colonizationInfluenceAreas().own.contains(portCapital.pixel), true);

console.log('Проверки городского индекса, портовых множителей, якорей и пересчёта пройдены.');
