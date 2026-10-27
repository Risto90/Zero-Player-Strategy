import { strict as assert } from 'node:assert';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { countryMapLabels, geographicVisibilityScale } from '../game/mapLabels.ts';

const owner = new Uint16Array(MAP_PIXELS);
const land = new Uint8Array(MAP_PIXELS);
for (let y = 20; y < 60; y += 1) {
  for (let x = 20; x < 140; x += 1) {
    const pixel = y * MAP_WIDTH + x;
    owner[pixel] = 1;
    land[pixel] = 1;
  }
}
const nomadRange = [];
for (let y = 100; y < 130; y += 1) {
  for (let x = 300; x < 330; x += 1) {
    const pixel = y * MAP_WIDTH + x;
    land[pixel] = 1;
    nomadRange.push(pixel);
  }
}

const world = {
  version: 1,
  territoryVersion: 1,
  owner,
  land,
  countries: [
    { id: 0, type: 'settled', name: 'Республика', pixels: 4800, box: [20, 20, 139, 59] },
    { id: 1, type: 'nomadic', name: 'Кочевье', pixels: 0, box: [300, 100, 329, 129], range: nomadRange },
  ],
};

const zoomedOut = countryMapLabels(world, 0.3, 'political', 1);
const zoomedIn = countryMapLabels(world, 1, 'political', 1);
assert.equal(zoomedOut.some((label) => label.countryId === 0), false, 'small country labels stay hidden when they cannot fit');
assert.ok(zoomedIn.some((label) => label.countryId === 0), 'the settled country label appears when its area can fit it');
assert.ok(zoomedIn.some((label) => label.countryId === 1 && label.selected), 'the selected nomadic country is labelled on the political layer');
assert.equal(countryMapLabels(world, 1, 'humidity', 1).some((label) => label.countryId === 1), false,
  'nomadic labels remain hidden outside the political layer');
assert.equal(countryMapLabels(world, 1, 'political', null).some((label) => label.countryId === 1), false,
  'unselected nomadic countries are not labelled');
for (let left = 0; left < zoomedIn.length; left += 1) {
  for (let right = left + 1; right < zoomedIn.length; right += 1) {
    const a = zoomedIn[left];
    const b = zoomedIn[right];
    assert.ok(Math.abs(a.x - b.x) * 2 >= a.width + b.width || Math.abs(a.y - b.y) * 2 >= a.height + b.height,
      'visible country names do not overlap');
  }
}
assert.equal(geographicVisibilityScale(1, 6500), 1, 'the highest peaks can appear at the base zoom');
assert.ok(geographicVisibilityScale(1, 700) > geographicVisibilityScale(1, 6500),
  'lower peaks require a closer map scale');
assert.equal(geographicVisibilityScale(1, 700, true), 1, 'active volcanoes appear at the base zoom');
assert.ok(MAP_HEIGHT * MAP_WIDTH === MAP_PIXELS, 'map annotations use the full map dimensions');

console.log('Map labels and geographic visibility thresholds passed.');
