import { strict as assert } from 'node:assert';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { MapContours } from '../game/contours.ts';
import { CompositionTable } from '../game/composition.ts';
import {
  countryLabelViewportLayout,
  countryMapLabels,
  entityMapLabels,
  geographicVisibilityScale,
  shouldShowCityMarks,
  shouldShowGeographyMarks,
  volcanoVisibilityScale,
} from '../game/mapLabels.ts';
import { seaDepthPackedColor } from '../game/render.ts';
import { terrainProjectedY, terrainReliefPaths } from '../game/terrainModel.ts';

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
for (let y = 20; y < 50; y += 1) {
  for (let x = 500; x < 530; x += 1) owner[y * MAP_WIDTH + x] = 3;
}
for (let y = 90; y < 120; y += 1) {
  for (let x = 570; x < 600; x += 1) owner[y * MAP_WIDTH + x] = 3;
}

const world = {
  version: 1,
  territoryVersion: 1,
  owner,
  land,
  culture: new Uint16Array(MAP_PIXELS),
  religion: new Uint16Array(MAP_PIXELS),
  humanOrigins: new Uint16Array(MAP_PIXELS),
  cultureTable: new CompositionTable(),
  religionTable: new CompositionTable(),
  humanOriginTable: new CompositionTable(),
  cultures: [{ id: 0, name: 'Народ' }],
  religions: [{ id: 0, name: 'Вера' }],
  countries: [
    { id: 0, type: 'settled', name: 'Республика', pixels: 4800, box: [20, 20, 139, 59] },
    { id: 1, type: 'nomadic', name: 'Кочевье', pixels: 0, box: [300, 100, 329, 129], range: nomadRange, cells: [] },
    { id: 2, type: 'settled', name: 'Дальняя федерация', pixels: 1800, box: [500, 20, 599, 119] },
  ],
};
const cultureMix = world.cultureTable.single(0, 100);
const religionMix = world.religionTable.single(0, 100);
const originMix = world.humanOriginTable.single(0, 100);
for (let y = 20; y < 60; y += 1) for (let x = 20; x < 140; x += 1) {
  const pixel = y * MAP_WIDTH + x;
  world.culture[pixel] = cultureMix;
  world.religion[pixel] = religionMix;
  world.humanOrigins[pixel] = originMix;
}
world.contours = new MapContours((name) => world[name], () => world.version);

const zoomedOut = countryMapLabels(world, 0.3, 'political', 1);
const zoomedIn = countryMapLabels(world, 2, 'political', 1);
assert.equal(zoomedOut.some((label) => label.countryId === 0), false, 'small country labels stay hidden when they cannot fit');
assert.ok(zoomedIn.some((label) => label.countryId === 0), 'the settled country label appears when its area can fit it');
assert.ok(zoomedIn.some((label) => label.countryId === 1 && label.selected), 'the selected nomadic country is labelled on the political layer');
assert.ok(countryMapLabels(world, 2, 'cities', 1).some((label) => label.countryId === 1),
  'selected nomadic labels also appear on the city layer');
assert.equal(countryMapLabels(world, 2, 'humidity', 1).length, 0,
  'state names are absent from climate layers');
assert.equal(countryMapLabels(world, 1, 'humidity', 1).some((label) => label.countryId === 1), false,
  'nomadic labels remain hidden outside the political layer');
assert.equal(countryMapLabels(world, 1, 'political', null).some((label) => label.countryId === 1), false,
  'unselected nomadic countries are not labelled');
assert.equal(shouldShowCityMarks('political'), true, 'cities are visible on the political layer');
assert.equal(shouldShowCityMarks('cities'), true, 'cities are visible on the city layer');
assert.equal(shouldShowCityMarks('elevation'), false, 'cities are hidden on the elevation layer');
assert.equal(shouldShowGeographyMarks('political'), true, 'mountains are visible on the political layer');
assert.equal(shouldShowGeographyMarks('elevation'), true, 'mountains are visible on the elevation layer');
assert.equal(shouldShowGeographyMarks('cultures'), false, 'mountains are hidden on the culture layer');
assert.ok(entityMapLabels(world, 'cultures', { kind: 'culture', id: 0 }, 2)
  .some((label) => label.text === 'Народ'), 'the selected culture receives a contour-based map label');
assert.ok(entityMapLabels(world, 'religions', { kind: 'religion', id: 0 }, 2)
  .some((label) => label.text === 'Вера'), 'the selected religion receives a contour-based map label');
assert.ok(entityMapLabels(world, 'origins', { kind: 'origin', id: 0 }, 2)
  .some((label) => label.text.length > 0), 'the selected race receives a contour-based map label');
const dividedLabels = countryMapLabels(world, 8, 'political', null).filter((label) => label.countryId === 2);
assert.equal(dividedLabels.length, 2, 'disconnected country parts receive independent labels when no shared label fits');
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
assert.equal(volcanoVisibilityScale(1, 4, 3), 1, 'frequent and powerful eruptions can appear at world scale');
assert.ok(volcanoVisibilityScale(1, 60, 1) >= 8.7, 'a mild eruption every sixty years needs close zoom');
assert.ok(volcanoVisibilityScale(1, 4, 3) < volcanoVisibilityScale(1, 60, 1),
  'volcano visibility follows eruption recurrence and intensity');
const viewportLabel = zoomedIn.find((label) => label.countryId === 0);
const fitted = countryLabelViewportLayout(viewportLabel, 100, -5000, -5000, 320, 180);
assert.ok(fitted.fontSize <= 140, 'country labels do not grow beyond the visible viewport');
assert.ok(fitted.x >= 8 && fitted.x <= 312 && fitted.y >= 8 && fitted.y <= 172,
  'country labels remain inside the visible viewport');
const measuredWidthFactor = 1.1;
const fittedMeasured = countryLabelViewportLayout(viewportLabel, 100, -5000, -5000, 320, 180, measuredWidthFactor);
const measuredTextWidth = fittedMeasured.fontSize * measuredWidthFactor;
assert.ok(fittedMeasured.x - measuredTextWidth / 2 >= 6 &&
  fittedMeasured.x + measuredTextWidth / 2 <= 314,
  'country labels fit the viewport using the rendered glyph width');
assert.equal(countryLabelViewportLayout(viewportLabel, 1, 10000, 10000, 320, 180).visible, false,
  'a country label is hidden when its territory is outside the viewport');
assert.ok(MAP_HEIGHT * MAP_WIDTH === MAP_PIXELS, 'map annotations use the full map dimensions');
assert.notEqual(seaDepthPackedColor(-9000), seaDepthPackedColor(-100),
  'sea-depth colors distinguish deep water from coastal water');

const terrainWorld = {
  land: new Uint8Array(MAP_PIXELS).fill(1),
  elevation: new Int16Array(MAP_PIXELS).fill(1000),
};
assert.equal(terrainProjectedY(terrainWorld, 0, 100), 96,
  'height is represented as vertical relief in the generated 3D view');
assert.ok(terrainReliefPaths(terrainWorld).length > 0,
  'the elevation model produces a shaded triangle mesh');

console.log('Map labels and geographic visibility thresholds passed.');
