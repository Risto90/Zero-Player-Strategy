import assert from 'node:assert/strict';
import {
  buildFlagField,
  flagPolygonSetArea,
  generateFlagBandWeights,
  validateFlagFieldTree,
} from '../game/flagField.ts';

const frame = { x0: 17, y0: 23, w: 960, h: 640 };
const frameArea = frame.w * frame.h;
const cases = [
  { op: 'G01' },
  { op: 'G02', params: { axis: 'H', n: 5, weights: { kind: 'wg-5', variant: '11211' }, pattern: 'MIRROR' } },
  { op: 'G02', params: { axis: 'V', n: 4, weights: { kind: 'equal' }, pattern: 'CYC' } },
  { op: 'G02', params: { axis: 'H', n: 3, weights: { kind: 'sym', ratio: 1 / 3 }, pattern: 'SEP' } },
  { op: 'G02', params: { axis: 'H', n: 5, weights: { kind: '5', variant: '12121' }, pattern: 'DISTINCT' } },
  { op: 'G02', params: { axis: 'H', n: 4, weights: { kind: 'comp', total: 12 }, pattern: 'CYC' } },
  { op: 'G02', params: { axis: 'H', n: 13, weights: { kind: 'comp', total: 13 }, pattern: 'CYC' } },
  { op: 'G02', params: { axis: 'H', n: 3, weights: { kind: 'accent', separator: 120 }, pattern: 'SEP' } },
  { op: 'G03', params: { angle: 'DIAGONAL', n: 5, weights: { kind: 'equal' }, pattern: 'TRIAD' } },
  { op: 'G03', params: { angle: 30, mirror: true, n: 3, weights: { kind: 'sym', ratio: 3 }, pattern: 'CYC' } },
  { op: 'G04', params: { mode: 'PALE', p: 2 / 5 } },
  { op: 'G04', params: { mode: 'FESS', p: 3 / 5 } },
  { op: 'G04', params: { mode: 'BEND', diagonal: 'SLASH' } },
  { op: 'G04', params: { mode: 'CHEVRON', vertex: { u: 0.5, v: 0.5 }, slope: 0.5 } },
  { op: 'G04', params: { mode: 'CHEVRON', vertex: { u: 0.5, v: 0.5 }, slope: -0.5 } },
  { op: 'G05', params: { px: 3 / 8, py: 2 / 5, slotsMode: 'AB/CD' } },
  { op: 'G05', params: { px: 1 / 3, py: 3 / 5, slotsMode: 'AB/BB' } },
  { op: 'G06', params: { center: { u: 0.47, v: 0.55 }, slotsMode: 'TOP_DISTINCT' } },
  { op: 'G06', params: { center: { u: 0.5, v: 0.5 }, slotsMode: 'ALL_DISTINCT' } },
  { op: 'G07', params: { angles: '90/135/135', startAngle: -90 } },
  { op: 'G07', params: { angles: '120/120/120', startAngle: 25 } },
  { op: 'G08', params: { n: 8, colors: 2 } },
  { op: 'G08', params: { n: 12, colors: 2 } },
  { op: 'G08', params: { n: 16, colors: 3 } },
  { op: 'G08', params: { n: 24, center: { u: -0.15, v: 0.52 }, colors: 3, fan: true } },
  { op: 'G09', params: { nx: 4, origin: 'CORNER' } },
  { op: 'G09', params: { nx: 7, origin: 'CENTER' } },
  { op: 'G09', params: { nx: 16, origin: 'CORNER' } },
  { op: 'G10', params: { angle: 50, cellSize: 120, origin: 'CENTER' } },
  { op: 'G10', params: { angle: 60, cellSize: 180, origin: 'CORNER' } },
  { op: 'G10', params: { angle: 70, cellSize: 300, origin: 'CENTER' } },
  { op: 'G11', params: { n: 3, amplitude: 0.1, pattern: 'CYC' } },
  { op: 'G11', params: { n: 7, vertex: { u: 0.62, v: 0.46 }, amplitude: 0.08, pattern: 'TRIAD' } },
  { op: 'G11', params: { n: 9, amplitude: 0.05, pattern: 'CYC' } },
  { op: 'G12', params: { figure: 'circle', n: 2, weights: { kind: 'equal' } } },
  { op: 'G12', params: { figure: 'square', n: 3, weights: { kind: 'sym', ratio: 1 / 2 } } },
  { op: 'G12', params: { figure: 'rhombus', n: 5, weights: { kind: 'equal' } } },
  { op: 'G12', params: { figure: 'rectangle', n: 6, weights: { kind: 'equal' } } },
];

for (const { op, params } of cases) {
  const result = buildFlagField({ op, params }, frame, { random: () => 0 });
  const area = result.regions.reduce((sum, region) => sum + region.area, 0);
  assert.ok(Math.abs(area - frameArea) < 0.02, `${op} partitions its complete frame: ${area} vs ${frameArea}`);
  assert.equal(result.paintLayers[0].kind, 'underpaint', `${op} paints its parent ground first`);
  assert.ok(result.regions.every(({ visiblePolygons }) => flagPolygonSetArea(visiblePolygons) > 0), `${op} has no empty visible region`);
  for (const region of result.regions) {
    assert.ok(region.polygons.flat().every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)), `${op} keeps finite coordinates`);
  }
}

const clipped = buildFlagField(
  { op: 'G05', params: { slotsMode: 'CHECKER' } },
  frame,
  { clipChain: [[[
    { x: 150, y: 100 }, { x: 850, y: 140 }, { x: 520, y: 600 },
  ]]] },
);
const triangleArea = flagPolygonSetArea([[
  { x: 150, y: 100 }, { x: 850, y: 140 }, { x: 520, y: 600 },
]]);
assert.ok(Math.abs(clipped.regions.reduce((sum, region) => sum + region.area, 0) - triangleArea) < 0.02,
  'clipped regions cover exactly their shared parent triangle');
assert.ok(clipped.regions.every(({ clipChain }) => clipChain.length === 2), 'each clipped region retains its parent clip and own region');

const nested = buildFlagField({
  op: 'G04',
  params: { mode: 'BEND' },
  children: [
    { op: 'G02', params: { axis: 'H', n: 3, weights: { kind: 'equal' }, pattern: 'CYC' } },
    { op: 'G02', params: { axis: 'V', n: 4, weights: { kind: 'equal' }, pattern: 'CYC' } },
  ],
}, frame);
const childRegions = nested.regions.filter((region) => region.depth === 1 && region.op === 'G02');
assert.equal(childRegions.length, 7, 'nested field creates three and four child bands');
assert.ok(Math.abs(childRegions.reduce((sum, region) => sum + region.area, 0) - frameArea) < 0.02,
  'child bands clipped to their parent regions cover the whole flag');
assert.ok(childRegions.every(({ clipChain }) => clipChain.length === 2), 'child bands retain their parent and own region clips');
assert.equal(nested.maxDepth, 2, 'nested field depth is measured from the root');
assert.ok(nested.regionCount <= 16);
assert.deepEqual(validateFlagFieldTree({
  op: 'G05',
  children: Array.from({ length: 4 }, () => ({ op: 'G12', params: { n: 6 } })),
}), [{ path: '$', message: 'field region count 28 exceeds 16' }]);
assert.ok(validateFlagFieldTree({
  op: 'G01',
  children: [{ op: 'G01', children: [{ op: 'G01' }] }],
}).some(({ message }) => message.includes('depth cannot exceed 2')));

const compWeights = generateFlagBandWeights(
  { kind: 'comp', total: 12 },
  4,
  { frameHeight: 1200, canvasHeight: 1200, random: () => 0 },
);
assert.equal(compWeights.length, 4);
assert.ok(Math.abs(compWeights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
assert.throws(() => generateFlagBandWeights({ kind: 'comp' }, 4), /deterministic random source/);
assert.throws(() => generateFlagBandWeights({ kind: 'comp', total: 24 }, 13, {
  frameHeight: 640, canvasHeight: 1200, random: () => 0,
}), /feasible/);
assert.throws(() => generateFlagBandWeights({ kind: 'equal' }, 13, { frameHeight: 300, canvasHeight: 1200 }), /T_MIN/);
assert.deepEqual(
  buildFlagField({ op: 'G02', params: { n: 4, pattern: 'CYC' } }, frame).regions.map(({ slot }) => slot),
  ['s1', 's2', 's1', 's2'],
  'SP-CYC repeats exactly two color slots',
);
assert.throws(() => buildFlagField({ op: 'G02', params: { n: 4, pattern: 'MIRROR' } }, frame), /five-band/);
assert.equal(buildFlagField({ op: 'G08', params: { n: 24, colors: 3 } }, frame).regionCount, 3,
  'gyronny sector geometry may group repeated regions sharing a color slot');
assert.throws(() => buildFlagField({ op: 'G03', params: { angle: 25 } }, frame), /30°/);
assert.throws(() => buildFlagField({ op: 'G04', params: { mode: 'CHEVRON', vertex: { u: 0.51, v: 0.5 } } }, frame), /1\/24/);
assert.throws(() => buildFlagField({ op: 'G08', params: { center: { u: 0.7, v: 0.5 } } }, frame), /shift toward the pole/);

console.log('Flag field operators, WG/SP, clipping, shared areas, and tree limits passed.');
