import assert from 'node:assert/strict';
import {
  FLAG_EMBLEM_COMPOSERS,
  FLAG_EMBLEM_MODULES,
  calculateFlagEmblemCost,
  calculateFlagRepeatCost,
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
const specifiedModuleCosts = {
  M01: 0.7, M02: 0.7, M03: 0.7, M04: 0.7, M06: 0.7,
  M07: 1.2, M08: 1.2, M09: 1.2, M11: 1, M12: 2, M13: 3, M14: 3,
  M15: 2, M16: 2, M18: 2, M19: 2, M22: 3, M23: 3, M24: 3,
  M26: 1, M27: 1,
};
for (const id of FLAG_EMBLEM_MODULES) {
  assert.equal(typeof FLAG_EMBLEM_CONFIG.modules[id].cost, 'number', `${id} has a configurable cost`);
  if (Object.hasOwn(specifiedModuleCosts, id)) {
    assert.equal(FLAG_EMBLEM_CONFIG.modules[id].cost, specifiedModuleCosts[id], `${id} uses its explicit §14.5 cost`);
  }
  assertFiniteGeometry(validateFlagEmblem(node(id), { rng: seeded(Number(id.slice(1))) }), id);
}
assert.equal(calculateFlagEmblemCost(node('M01')), 0.7);
assert.equal(validateFlagEmblem(node('M01')).cost, 0.7);
assert.ok(Math.abs(calculateFlagEmblemCost({ composer: 'SINGLE', children: [node('M01')] }) - 0.56) < 1e-12,
  'composers multiply the sum of child costs by 0.8');
assert.ok(Math.abs(calculateFlagEmblemCost({ composer: 'CROSSED', children: [node('M16'), node('M17')] }) - 2.8) < 1e-12);
assert.ok(Math.abs(calculateFlagRepeatCost(1, 6) - 1.6) < 1e-12);
assert.equal(calculateFlagRepeatCost(1, 50), 3, 'repeat surcharge is capped at 2');
assert.throws(() => calculateFlagRepeatCost(1, -1), /неотрицательным целым/);

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
const wavySun = validateFlagEmblem(node('M07', { rays: 12, rayType: 'WAVY_ALT' }));
assertFiniteGeometry(wavySun, 'WAVY_ALT sun');
assert.ok(wavySun.primitives.some((primitive) => primitive.kind === 'polygon' && primitive.points.length === 50),
  'WAVY_ALT rays are formed from two connected sampled arcs and taper to a point');
const lily = validateFlagEmblem(node('M12', { lowerPetal: false })).primitives;
assert.equal(lily.length, 4, 'у лилии без нижнего лепестка есть центральная линза, два боковых лепестка и пояс');
assert.equal(validateFlagEmblem(node('M12', { lowerPetal: true })).primitiveCount, 5,
  'нижний лепесток включается явным параметром');
for (const sideLens of lily.slice(1, 3)) {
  assert.ok(sideLens.kind === 'polygon' && sideLens.points.some(({ x, y }) => Math.hypot(x, y - 0.1) < 1e-6),
    'каждый боковой лепесток начинается у нижнего конца центральной линзы');
  assert.ok(sideLens.kind === 'polygon' && sideLens.points.some(({ x, y }) => Math.abs(Math.hypot(x, y - 0.1) - 0.75 * 0.6) < 1e-6),
    'длина бокового лепестка равна 0,75 длины центральной линзы');
}
const ship = validateFlagEmblem(node('M22')).primitives[0];
assert.ok(ship.kind === 'polygon' && ship.points.length >= 25, 'корпус корабля содержит аппроксимированную дугу днища');
assert.ok(ship.kind === 'polygon' && Math.max(...ship.points.map(({ y }) => y)) > 0.38,
  'дуга днища ниже прямых бортов корпуса');
const anchor = validateFlagEmblem(node('M18')).primitives[3];
assert.ok(anchor.kind === 'polygon');
const anchorGeometry = FLAG_EMBLEM_CONFIG.geometry.anchor;
const flukeRadii = anchor.points.map(({ x, y }) => Math.hypot(
  x - anchorGeometry.flukeCenter[0],
  y - anchorGeometry.flukeCenter[1],
));
assert.ok(Math.abs(Math.min(...flukeRadii) - 0.14) < 1e-9);
assert.ok(Math.abs(Math.max(...flukeRadii) - 0.21) < 1e-9);
assert.ok(Math.abs((Math.min(...flukeRadii) + Math.max(...flukeRadii)) / 2 -
  0.35 * 0.5) < 1e-9, 'центральный радиус лап равен 0,35R при R=0,5');

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
  CONCENTRIC: [node('M03')],
  OVERLAY: [node('M06'), node('M03')],
  CONSTELLATION: [node('M03')],
};
assert.equal(FLAG_EMBLEM_COMPOSERS.length, 12, 'all 12 composers are registered');
for (const [index, composer] of FLAG_EMBLEM_COMPOSERS.entries()) {
  const expectedFactor = ['OVERLAY', 'CONSTELLATION'].includes(composer) ? 1 : 0.8;
  const params = composer === 'CONSTELLATION' ? { preset: 'STAR_TRIANGLE' } : {};
  assert.equal(FLAG_EMBLEM_CONFIG.composers[composer].costFactor, expectedFactor, `${composer} applies the specified cost multiplier`);
  assertFiniteGeometry(validateFlagEmblem({ composer, params, children: composerChildren[composer] }, { rng: seeded(500 + index) }), composer);
}
assert.throws(() => validateFlagEmblem({ composer: 'ARC_REPEAT', children: [node('M03')] }), /requires an M11/);
assert.equal(validateFlagEmblem({ composer: 'STACK', params: { count: 4 }, children: [node('M01')] }).primitiveCount, 4);
assert.equal(validateFlagEmblem({ composer: 'RING', params: { count: 16 }, children: [node('M01')] }).primitiveCount, 16);
console.log('Flag emblem catalog, geometry, GLYPH, and composer checks passed.');
