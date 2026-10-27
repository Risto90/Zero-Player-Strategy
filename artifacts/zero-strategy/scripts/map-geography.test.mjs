import assert from 'node:assert/strict';
import {
  discoveredRiverPaths,
  riverStrengthForRank,
  riverVisibilityScale,
} from '../game/geographyGeometry.ts';
import { MAP_WIDTH } from '../game/config.ts';

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
  ],
};

assert.equal(riverStrengthForRank(1), 3, 'largest rivers use the strongest map stroke');
assert.equal(riverStrengthForRank(4), 2, 'middle-ranked rivers use the middle map stroke');
assert.equal(riverStrengthForRank(7), 1, 'small tributaries use the lightest map stroke');
assert.equal(riverVisibilityScale(0.4, 3), 0.4, 'large rivers are visible at the initial map scale');
assert.ok(riverVisibilityScale(0.4, 2) > riverVisibilityScale(0.4, 3),
  'secondary rivers appear after the map is enlarged');
assert.ok(riverVisibilityScale(0.4, 1) > riverVisibilityScale(0.4, 2),
  'small tributaries appear after secondary rivers');

const visible = discoveredRiverPaths(world);
assert.equal(visible.length, 3, 'undiscovered rivers are omitted from map geometry');
assert.ok(visible.every((segment) => segment.riverId !== 1), 'an unnamed, undiscovered river stays hidden');
assert.equal(visible.filter((segment) => segment.riverId === 2).length, 2,
  'a river crossing the map edge is split into two edge segments');
assert.ok(visible.filter((segment) => segment.riverId === 2).every((segment) => segment.length < 20),
  'a seam crossing never draws a line across the entire map');
assert.equal(discoveredRiverPaths(world), visible, 'unchanged geography reuses its prepared paths');

world.territoryVersion += 1;
assert.notEqual(discoveredRiverPaths(world), visible, 'new territory refreshes the discovered river paths');
world.riverFeatures[1].discoveredBy.push(0);
world.version += 1;
assert.ok(discoveredRiverPaths(world).some((segment) => segment.riverId === 1),
  'newly discovered rivers enter the map geometry after a world update');

console.log('River discovery, zoom hierarchy, and map-edge geometry checks passed.');
