import assert from 'node:assert/strict';
import {
  discoveredRiverPaths,
  riverStrengthForRank,
  riverVisibilityScale,
} from '../game/geographyGeometry.ts';
import { MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { generateGeography } from '../game/geographyFeatures.ts';

const earthGeography = generateGeography(new Uint8Array(MAP_PIXELS).fill(1), 1, 'world');
assert.equal(earthGeography.volcanoes.length, 1194, 'Earth volcanoes retain an activity profile for each catalogue entry');
assert.ok(earthGeography.volcanoes.every((volcano) =>
  Number.isInteger(volcano.activityIntervalYears) &&
  volcano.activityIntervalYears > 0 &&
  Number.isInteger(volcano.eruptionIntensity) &&
  volcano.eruptionIntensity >= 1 && volcano.eruptionIntensity <= 8),
'each Earth volcano has a usable recurrence interval and eruption intensity');

const world = {
  version: 1,
  territoryVersion: 1,
  riverFeatures: [
    {
      id: 0,
      scaleRank: 1,
      paths: [[
        { x: 20, y: 20 },
        { x: 35, y: 26 },
        { x: 50, y: 20 },
      ]],
      pixels: [],
      name: 'Открытая река',
      discoveredBy: [0],
    },
    {
      id: 1,
      scaleRank: 4,
      paths: [[{ x: 100, y: 100 }, { x: 120, y: 110 }]],
      pixels: [],
      name: null,
      discoveredBy: [],
    },
    {
      id: 2,
      scaleRank: 7,
      paths: [[{ x: MAP_WIDTH - 8, y: 200 }, { x: 6, y: 204 }]],
      pixels: [],
      name: 'Приток',
      discoveredBy: [1],
    },
    {
      id: 3,
      scaleRank: 4,
      paths: [[{ x: 35, y: 58 }, { x: 35, y: 26 }]],
      pixels: [],
      name: 'Впадающая река',
      discoveredBy: [0],
    },
    {
      id: 4,
      scaleRank: 4,
      paths: [[{ x: 100, y: 100 }, { x: 110, y: 80 }, { x: 125, y: 60 }]],
      pixels: [],
      name: 'Главное русло',
      discoveredBy: [0],
    },
    {
      id: 5,
      scaleRank: 4,
      paths: [[{ x: 100, y: 130 }, { x: 100, y: 100 }]],
      pixels: [],
      name: 'Равный по рангу приток',
      discoveredBy: [0],
    },
  ],
};

assert.equal(riverStrengthForRank(1), 3, 'largest rivers use the strongest map stroke');
assert.equal(riverStrengthForRank(4), 2, 'middle-ranked rivers use the middle map stroke');
assert.equal(riverStrengthForRank(7), 1, 'small tributaries use the lightest map stroke');
assert.equal(riverVisibilityScale(0.4, 3), 0.4, 'large rivers are visible at the initial map scale');
assert.ok(Math.abs(riverVisibilityScale(0.4, 2) - 0.64) < 1e-9, 'secondary rivers wait until 1.6× the base map scale');
assert.ok(Math.abs(riverVisibilityScale(0.4, 1) - 0.96) < 1e-9, 'small tributaries wait until 2.4× the base map scale');

const visible = discoveredRiverPaths(world);
assert.equal(visible.length, 6, 'undiscovered rivers are omitted from map geometry');
assert.ok(visible.every((segment) => segment.riverId !== 1), 'an unnamed, undiscovered river stays hidden');
assert.equal(visible.filter((segment) => segment.riverId === 2).length, 2,
  'a river crossing the map edge is split into two edge segments');
assert.ok(visible.filter((segment) => segment.riverId === 2).every((segment) => segment.length < 20),
  'a seam crossing never draws a line across the entire map');
const tributary = visible.find((segment) => segment.riverId === 3);
assert.ok(tributary, 'a discovered tributary remains visible');
assert.ok(tributary.contourPath.endsWith('Z') && tributary.contourPoints.length >= 4,
  'river overlays are closed filled contours');
assert.ok(tributary.points.at(-1).y < 29,
  'a tributary ends at the edge of its main river instead of overlapping its center');
const equalRankTributary = visible.find((segment) => segment.riverId === 5);
assert.ok(equalRankTributary, 'a tributary with the same scale rank remains visible');
assert.ok(equalRankTributary.points.at(-1).y > 100 && equalRankTributary.points.at(-1).y < 130,
  'at equal rank, the shorter tributary is clipped at the longer main river');
assert.equal(discoveredRiverPaths(world), visible, 'unchanged geography reuses its prepared paths');

world.territoryVersion += 1;
assert.notEqual(discoveredRiverPaths(world), visible, 'new territory refreshes the discovered river paths');
world.riverFeatures[1].discoveredBy.push(0);
world.version += 1;
assert.ok(discoveredRiverPaths(world).some((segment) => segment.riverId === 1),
  'newly discovered rivers enter the map geometry after a world update');

console.log('River discovery, zoom hierarchy, and map-edge geometry checks passed.');
