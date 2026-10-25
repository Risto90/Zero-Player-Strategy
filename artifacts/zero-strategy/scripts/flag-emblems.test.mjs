import assert from 'node:assert/strict';
import {
  FLAG_EMBLEM_COMPOSERS,
  FLAG_EMBLEM_MODULES,
  flagEmblemArea,
  flagEmblemBounds,
  generateFlagGlyph,
  validateFlagEmblem,
} from '../game/flagEmblems.js';
import { FLAG_EMBLEM_CONFIG } from '../game/flagEmblemConfig.js';

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function node(module, params = {}) {
  return { module, params };
}
function assertFiniteGeometry(result, label) {
  assert.ok(result.primitiveCount > 0, `${label} has geometry`);
  assert.ok(result.primitiveCount <= FLAG_EMBLEM_CONFIG.maxPrimitives, `${label} stays under the primitive limit`);
  assert.ok(result.primitives.every((shape) => flagEmblemArea(shape) > 1e-10 && Number.isFinite(flagEmblemArea(shape))), `${label} has positive finite primitive areas`);
  const bounds = flagEmblemBounds(result.primitives);
  assert.ok(Object.values(bounds).every(Number.isFinite), `${label} has finite bounds`);
}

assert.equal(FLAG_EMBLEM_MODULES.length, 30, 'all M01–M30 modules are registered');
assert.deepEqual(FLAG_EMBLEM_MODULES, Array.from({ length: 30 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`));
for (const id of FLAG_EMBLEM_MODULES) {
  assert.equal(typeof FLAG_EMBLEM_CONFIG.modules[id].cost, 'number', `${id} has a configurable cost`);
  assertFiniteGeometry(validateFlagEmblem(node(id), { rng: seeded(Number(id.slice(1))) }), id);
}

const pointedStar = validateFlagEmblem(node('M03', { points: 5, mode: 'POINTED', skip: 2 })).primitives[0];
assert.equal(pointedStar.kind, 'polygon');
const radii = pointedStar.points.map(({ x, y }) => Math.hypot(x, y));
assert.ok(Math.abs(Math.max(...radii) - 0.5) < 1e-9, 'pointed star uses the specified circumscribed radius');
assert.ok(Math.abs(Math.min(...radii) - 0.5 * 0.382) < 0.002, 'n=5, k=2 star ratio matches the reference');
const sixStar = validateFlagEmblem(node('M03', { points: 6, mode: 'POINTED', skip: 2 })).primitives[0];
assert.ok(Math.abs(Math.min(...sixStar.points.map(({ x, y }) => Math.hypot(x, y))) - 0.5 * 0.577) < 0.002,
  'n=6, k=2 star ratio matches the reference');
for (const points of [3, 5, 12, 24]) {
  const fullStar = validateFlagEmblem(node('M03', { points, mode: 'FULL', innerRatio: 0.4 })).primitives[0];
  const radii = fullStar.points.map(({ x, y }) => Math.hypot(x, y));
  const minimumRadius = Math.min(...radii);
  const tipAngle = 2 * Math.atan2(minimumRadius * Math.sin(Math.PI / points), 0.5 - minimumRadius * Math.cos(Math.PI / points));
  assert.ok(tipAngle * 180 / Math.PI >= 12 - 1e-8, `n=${points} full star meets the minimum tip angle`);
}

const crescent = validateFlagEmblem(node('M06', { innerRatio: 0.8, offsetRatio: 0.35 })).primitives[0];
assert.equal(crescent.kind, 'polygon');
const polygonArea = flagEmblemArea(crescent);
const R = 0.5, r = 0.4, d = 0.175;
const x = (d * d + R * R - r * r) / (2 * d);
const intersection = Math.sqrt(R * R - x * x);
const overlapArea = R * R * Math.acos(x / R) + r * r * Math.acos((d - x) / r) - d * intersection;
const analyticArea = Math.PI * R * R - overlapArea;
assert.ok(Math.abs(polygonArea - analyticArea) < 0.001, `crescent polygon area approximates analytic lens subtraction (${polygonArea})`);
assert.ok(crescent.points.length >= 100, 'crescent contour samples both circular arcs');
assert.throws(() => validateFlagEmblem(node('M06', { innerRatio: 0.7, offsetRatio: 0.2 })), /intersection and thickness/);

const longShortSun = validateFlagEmblem(node('M07', { rays: 32, rayType: 'LONG_SHORT' }));
assert.equal(longShortSun.primitiveCount, 33, 'LONG_SHORT uses alternating full and half-length rays rather than dropping every other ray');
assertFiniteGeometry(validateFlagEmblem(node('M07', { rays: 12, rayType: 'WAVY_ALT' })), 'WAVY_ALT sun');

for (let seed = 1; seed <= 100; seed += 1) {
  let glyph;
  try {
    glyph = generateFlagGlyph({}, seeded(seed));
  } catch (error) {
    error.message = `GLYPH seed ${seed}: ${error.message}`;
    throw error;
  }
  assertFiniteGeometry(glyph, `GLYPH seed ${seed}`);
  assert.ok(glyph.graph.edges.length >= 3 && glyph.graph.edges.length <= 8, `GLYPH seed ${seed} respects edge-count range`);
  const reached = new Set([glyph.graph.edges[0].from]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of glyph.graph.edges) {
      if (reached.has(edge.from) && !reached.has(edge.to)) { reached.add(edge.to); grew = true; }
      if (reached.has(edge.to) && !reached.has(edge.from)) { reached.add(edge.from); grew = true; }
    }
  }
  assert.ok(glyph.graph.edges.every(({ from, to }) => reached.has(from) && reached.has(to)), `GLYPH seed ${seed} has a connected graph`);
  assert.ok(glyph.graph.edges.every(({ path, width }) => path.length >= 2 && width > 0), `GLYPH seed ${seed} exposes stroked line/arc paths`);
  assert.ok(glyph.primitives.every((shape) => shape.kind === 'polygon' && shape.strokeWidth >= 0.02), 'GLYPH strokes become polygons');
  assert.ok(glyph.requiredScale <= 1, 'default glyph stroke is physically thick enough at the default scale');
}
assert.deepEqual(generateFlagGlyph({}, seeded(731)), generateFlagGlyph({}, seeded(731)), 'the same seeded source builds the same glyph');
assert.throws(() => generateFlagGlyph(), /injected seeded random source/, 'GLYPH does not silently use an unseeded system RNG');
assert.throws(() => generateFlagGlyph({ strokeWidth: 0.02, scale: 0.1 }, seeded(1)), /thinner than/);
assert.throws(() => validateFlagEmblem(node('M24', { strokeWidth: 0.1 }), { scale: 0.1, rng: seeded(9) }), /thinner than/);
assert.throws(() => validateFlagEmblem({
  composer: 'STACK', params: { count: 4 }, children: [node('M07', { rays: 32 })],
}), /maximum is 64/);
assert.throws(() => validateFlagEmblem({
  composer: 'SINGLE', children: [{
    composer: 'SINGLE', children: [{
      composer: 'SINGLE', children: [node('M01')],
    }],
  }],
}), /depth exceeds 3/);

const composerChildren = {
  SINGLE: [node('M01')],
  STACK: [node('M01')],
  PAIR_MIRROR: [node('M01')],
  CROSSED: [node('M16'), node('M17')],
  RING: [node('M03')],
  ARC_REPEAT: [node('M11')],
  INSCRIBE: [node('M06')],
  FLANK: [node('M01'), node('M03'), node('M04')],
  CHARGE_ON_CHARGE: [node('M03'), node('M01')],
  CONCENTRIC: [node('M03'), node('M01')],
};
assert.equal(FLAG_EMBLEM_COMPOSERS.length, 10, 'all 10 composers are registered');
for (const composer of FLAG_EMBLEM_COMPOSERS) {
  assert.equal(typeof FLAG_EMBLEM_CONFIG.composers[composer].cost, 'number', `${composer} has a configurable cost`);
  assertFiniteGeometry(validateFlagEmblem({ composer, children: composerChildren[composer] }), composer);
}
assert.throws(() => validateFlagEmblem({ composer: 'ARC_REPEAT', children: [node('M03')] }), /requires an M11/);
assert.equal(validateFlagEmblem({ composer: 'STACK', params: { count: 4 }, children: [node('M01')] }).primitiveCount, 4);
assert.equal(validateFlagEmblem({ composer: 'RING', params: { count: 16 }, children: [node('M01')] }).primitiveCount, 16);
console.log('Flag emblem catalog, geometry, GLYPH, and composer checks passed.');
