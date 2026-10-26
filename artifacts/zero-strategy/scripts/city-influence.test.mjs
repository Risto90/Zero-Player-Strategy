import { strict as assert } from 'node:assert';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { CityInfluenceIndex, cityInfluenceRadius } from '../game/settlements.ts';

const city = {
  id: 0,
  countryId: 0,
  pixel: 100 * MAP_WIDTH + 100,
  rank: 1,
  capital: false,
};
const land = new Uint8Array(MAP_PIXELS).fill(1);
const rivers = new Uint8Array(MAP_PIXELS);
const isCoastal = (pixel) => pixel % MAP_WIDTH === 100;
const world = { cities: [city], land, rivers, isCoastal };
const radius = cityInfluenceRadius(world, city);
const centerX = city.pixel % MAP_WIDTH;
const centerY = Math.floor(city.pixel / MAP_WIDTH);
const anchors = [];
for (let y = Math.max(0, centerY - Math.ceil(radius)); y <= Math.min(MAP_HEIGHT - 1, centerY + Math.ceil(radius)); y += 1) {
  for (let x = Math.max(0, centerX - Math.ceil(radius)); x <= Math.min(MAP_WIDTH - 1, centerX + Math.ceil(radius)); x += 1) {
    const pixel = y * MAP_WIDTH + x;
    if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2 && isCoastal(pixel)) anchors.push(pixel);
  }
}
const queryX = centerX + 120;
const queryY = centerY + 3;
const queryPixel = queryY * MAP_WIDTH + queryX;
const exactDistance = Math.min(...anchors.map((pixel) =>
  Math.hypot(pixel % MAP_WIDTH - queryX, Math.floor(pixel / MAP_WIDTH) - queryY),
));
const actual = new CityInfluenceIndex(world, city.countryId, true).at(queryPixel, true);
assert.equal(actual.nearestOwnAnchorDistance, exactDistance, 'nearest-anchor pruning preserves the exact Euclidean distance');
assert.ok(anchors.includes(actual.nearestOwnAnchorPixel), 'the selected anchor belongs to the city influence area');

const noAnchorWorld = { ...world, isCoastal: () => false };
const noAnchor = new CityInfluenceIndex(noAnchorWorld, city.countryId, true).at(queryPixel, true);
assert.equal(noAnchor.nearestOwnAnchorDistance, Infinity, 'an index without anchors returns immediately with no distance');
assert.equal(noAnchor.nearestOwnAnchorPixel, null);

console.log('Проверки индекса влияния городов пройдены.');
