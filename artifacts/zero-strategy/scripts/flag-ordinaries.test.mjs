import assert from 'node:assert/strict';
import {
  buildFlagOrdinaryLayers,
  validateFlagOrdinaries,
} from '../game/flagOrdinaries.ts';
import { flagPolygonSetArea } from '../game/flagField.ts';

const height = 1200;
const frame = { x0: 30, y0: 20, w: 1200, h: 800 };
const types = [
  { type: 'O01', params: { thickness: 110 } },
  { type: 'O02', params: { mode: 'CORNER', thickness: 110 } },
  { type: 'O02', params: { mode: 'D45', thickness: 110 } },
  { type: 'O03', params: { axis: 'DIAGONAL', thickness: 110 } },
  { type: 'O03', params: { axis: -45, placement: 'AT_EDGE', edge: 'TOP', thickness: 110 } },
  { type: 'O04', params: { halfAngle: 45, thickness: 110 } },
  { type: 'O05', params: { thickness: 110 } },
  { type: 'O06', params: { side: 'HOIST', baseLength: 360, depth: 400 } },
  ...['PLAIN', 'DOUBLE', 'CHECKY', 'ORLE'].map((variant) => ({
    type: 'O07',
    params: { variant, thickness: 60, gap: 20 },
  })),
];

for (const spec of types) {
  const result = buildFlagOrdinaryLayers([spec], frame, { canvasHeight: height });
  assert.equal(result.ordinaryCount, 1, `${spec.type} counts as one ordinary`);
  assert.ok(result.paintLayers.length > 0, `${spec.type} creates a paint layer`);
  assert.ok(result.paintLayers.every(({ polygons }) => polygons.length > 0), `${spec.type} has visible geometry`);
  assert.ok(result.paintLayers.every(({ polygons }) => polygons.flat().every(({ x, y }) =>
    Number.isFinite(x) && Number.isFinite(y))), `${spec.type} coordinates remain finite`);
}

const assertBuilds = (spec, label) => {
  const result = buildFlagOrdinaryLayers([spec], frame, { canvasHeight: height });
  assert.ok(result.paintLayers.length > 0 && result.paintLayers.every(({ polygons }) => polygons.length > 0), label);
};
for (const thickness of [height / 12, height / 4]) {
  assertBuilds({ type: 'O01', params: { thickness, profile: 'FLARED', flareRatio: 1.3 } }, `O01 accepts thickness endpoint ${thickness}`);
  assertBuilds({ type: 'O02', params: { thickness, mode: 'D45' } }, `O02 accepts thickness endpoint ${thickness}`);
  assertBuilds({ type: 'O03', params: { thickness, axis: 45 } }, `O03 accepts thickness endpoint ${thickness}`);
  assertBuilds({ type: 'O04', params: { thickness, halfAngle: 20, orientation: 'UP' } }, `O04 accepts thickness endpoint ${thickness}`);
  assertBuilds({ type: 'O05', params: { thickness, angles: [90, 135, 135] } }, `O05 accepts thickness endpoint ${thickness}`);
}
for (const ratio of [0.2, 0.45]) {
  assertBuilds({
    type: 'O01',
    params: { arms: 'COUPED', halfLength: Math.min(frame.w, frame.h) * ratio, profile: 'LATIN', latinRatio: 1.2 },
  }, `O01 accepts couped arm endpoint ${ratio}`);
}
for (const axis of [0, 90, 'DIAGONAL', 30, -30, 45, -45, 60, -60]) {
  assertBuilds({ type: 'O03', params: { axis, placement: 'AT_EDGE', edge: 'TOP' } }, `O03 supports axis ${axis}`);
}
for (const orientation of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
  assertBuilds({ type: 'O04', params: { halfAngle: 60, orientation } }, `O04 supports orientation ${orientation}`);
}
for (const side of ['HOIST', 'FLY', 'TOP', 'BOTTOM']) {
  const baseSide = side === 'HOIST' || side === 'FLY' ? frame.h : frame.w;
  const inwardSide = side === 'HOIST' || side === 'FLY' ? frame.w : frame.h;
  assertBuilds({
    type: 'O06',
    params: { side, baseLength: baseSide * 0.4, depth: inwardSide * 0.25, tipWidth: baseSide * 0.2 },
  }, `O06 supports base side ${side}`);
}
for (const corner of ['HOIST_TOP', 'FLY_TOP', 'HOIST_BOTTOM', 'FLY_BOTTOM']) {
  const canton = buildFlagOrdinaryLayers([{
    type: 'O08', params: { corner, width: frame.w * 0.25, height: frame.h * 0.25 },
  }], frame, { canvasHeight: height });
  const points = canton.paintLayers[0].polygons.flat();
  const expectedLeft = corner.startsWith('HOIST') ? frame.x0 : frame.x0 + frame.w * 0.75;
  const expectedTop = corner.endsWith('_TOP') ? frame.y0 : frame.y0 + frame.h * 0.75;
  assert.equal(Math.min(...points.map(({ x }) => x)), expectedLeft, `O08 places canton at ${corner} horizontally`);
  assert.equal(Math.min(...points.map(({ y }) => y)), expectedTop, `O08 places canton at ${corner} vertically`);
}
assertBuilds({ type: 'O01', params: { scandinavian: true, center: { u: 0.3, v: 0.5 } } },
  'O01 accepts the lower Scandinavian-center endpoint');
assertBuilds({ type: 'O01', params: { scandinavian: true, center: { u: 0.42, v: 0.5 } } },
  'O01 accepts the upper Scandinavian-center endpoint');
assertBuilds({ type: 'O06', params: { side: 'HOIST', baseLength: 400, depth: 600, apexPosition: 0.3, tipWidth: 200 } },
  'O06 accepts its base/depth/apex/truncated-tip endpoints');
assertBuilds({ type: 'O06', params: { side: 'HOIST', baseLength: 400, depth: 600, truncated: true } },
  'O06 supports its explicit truncated-tip variant');
assertBuilds({ type: 'O08', params: { square: true, width: 360 } }, 'O08 supports a nested square canton');
for (const params of [
  { n_saltire: 1, n_cross: 0 },
  { n_saltire: 2, n_cross: 0, second_saltire_ratio: 0.5 },
  { n_saltire: 1, n_cross: 2, second_cross_ratio: 0.4 },
  { n_saltire: 2, n_cross: 2, second_saltire_ratio: 0.3, second_cross_ratio: 0.7 },
]) {
  assertBuilds({ type: 'O09', params }, 'O09 supports every optional cross/saltire count and ratio endpoints');
}

const outlineTriangle = [[
  { x: 30, y: 20 }, { x: 1230, y: 20 }, { x: 630, y: 820 },
]];
const clipped = buildFlagOrdinaryLayers(
  [{ type: 'O01', params: { thickness: 160 }, fimbration: { delta: 40, fill: 's3' } }],
  frame,
  { canvasHeight: height, clipChain: [outlineTriangle] },
);
assert.equal(clipped.paintLayers.length, 2, 'fimbriation is a separate lower paint layer');
assert.equal(clipped.paintLayers[0].part, 'fimbration');
assert.equal(clipped.paintLayers[1].part, 'main');
assert.ok(flagPolygonSetArea(clipped.paintLayers[0].polygons) > flagPolygonSetArea(clipped.paintLayers[1].polygons),
  'fimbriation is wider than the figure it surrounds');
assert.ok(clipped.paintLayers.every(({ clipChain }) => clipChain.length === 1),
  'ordinary layers retain the inherited outline clipping chain');
assert.ok(flagPolygonSetArea(clipped.paintLayers[0].polygons) < 1200 * 800,
  'ordinary geometry is clipped to the flag outline');
const insideTriangle = ({ x, y }) => {
  const vertices = outlineTriangle[0];
  const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const signs = vertices.map((vertex, index) => cross(vertex, vertices[(index + 1) % vertices.length], { x, y }));
  return signs.every((value) => value >= -1e-6) || signs.every((value) => value <= 1e-6);
};
assert.ok(clipped.paintLayers.every(({ polygons }) => polygons.flat().every(insideTriangle)),
  'every rendered point stays within the non-rectangular outline clip');
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01', params: { thickness: 99 } },
], frame, { canvasHeight: height }), /cross thickness/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01', fimbration: { delta: 29, fill: 's3' } },
], frame, { canvasHeight: height }), /fimbration.delta/);

const nestedCanton = buildFlagOrdinaryLayers([{
  type: 'O08',
  fill: 's2',
  params: {
    corner: 'HOIST_TOP',
    width: 400,
    height: 300,
    field: { op: 'G02', params: { axis: 'H', n: 2 } },
  },
  children: [{ type: 'O01', params: { thickness: 100, arms: 'COUPED', halfLength: 90 } }],
}], frame, { canvasHeight: height });
assert.equal(nestedCanton.cantonCount, 1);
assert.equal(nestedCanton.ordinaryCount, 2, 'canton contents count toward the flag-wide ordinary limit');
assert.equal(nestedCanton.paintLayers[0].kind, 'canton');
assert.ok(nestedCanton.paintLayers.some(({ kind }) => kind === 'ground'), 'canton contains a nested field');
assert.ok(nestedCanton.paintLayers.some(({ kind, depth }) => kind === 'ordinary' && depth === 2),
  'canton contains a nested ordinary at the next frame depth');
assert.ok(nestedCanton.paintLayers.filter(({ depth }) => depth === 2).every(({ clipChain }) => clipChain.length === 1),
  'nested canton layers are clipped to the canton boundary');

const union = buildFlagOrdinaryLayers([{
  type: 'O09',
  params: {
    n_saltire: 2,
    n_cross: 2,
    thickness: 200,
    second_saltire_ratio: 0.4,
    second_cross_ratio: 0.5,
    fimbration_saltire: { delta: 30, fill: 's4' },
    fimbration_saltire_2: { delta: 60, fill: 's5' },
    pinwheel: true,
    pinwheel_shift: 40,
  },
}], frame, { canvasHeight: height, clipChain: [outlineTriangle] });
assert.equal(union.ordinaryCount, 1, 'O09 macro counts once against the ordinary limit');
assert.ok(union.paintLayers.some(({ part }) => part === 'fimbration'));
assert.ok(union.paintLayers.filter(({ operator }) => operator === 'O02').every(({ clipChain }) => clipChain.length === 2),
  'pinwheel saltire halves compose with the inherited outline clip');
assert.ok(union.paintLayers.filter(({ operator }) => operator === 'O01').every(({ clipChain }) => clipChain.length === 1),
  'crosses remain whole layers over the pinwheel saltire');
assert.ok(union.paintLayers.some(({ id }) => id === 'o09-1-saltire-2-fimbration'),
  'each saltire in a union motif can have independent fimbriation');
assert.ok(union.paintLayers.every(({ polygons }) => polygons.flat().every(({ x, y }) =>
  Number.isFinite(x) && Number.isFinite(y))));
assert.throws(() => buildFlagOrdinaryLayers([{
  type: 'O09',
  params: { n_saltire: 1, n_cross: 1, field_fill: 's1', saltire_fill: 's2', cross_fill: 's1' },
}], frame), /three distinct color slots/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01', params: { thickness: 200, center: { u: 0.4, v: 0.5 } } },
  { type: 'O01', params: { thickness: 100, center: { u: 0.6, v: 0.5 } } },
], frame), /common center/, 'the builder rejects a pair that is not a double cross');

assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O08' }, { type: 'O08' },
], frame), /ordinary count|canton count/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O07' }, { type: 'O07' },
], frame), /bordure count/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01' }, { type: 'O02' }, { type: 'O03' }, { type: 'O04' },
], frame), /ordinary count/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01', cost: 7 },
], frame), /cost/);

const doubleCrosses = [
  { type: 'O01', params: { thickness: 200, center: { u: 0.36, v: 0.5 } } },
  { type: 'O01', params: { thickness: 100, center: { u: 0.36, v: 0.5 } } },
];
assert.deepEqual(validateFlagOrdinaries(doubleCrosses, frame), [],
  'two centered crosses with the specified double-cross ratio validate');
assert.ok(validateFlagOrdinaries([
  doubleCrosses[0],
  { ...doubleCrosses[1], params: { thickness: 100, center: { u: 0.5, v: 0.5 } } },
], frame).some(({ message }) => message.includes('common center')));
assert.ok(validateFlagOrdinaries([
  doubleCrosses[0],
  { ...doubleCrosses[1], params: { thickness: 50, center: { u: 0.36, v: 0.5 } } },
], frame).some(({ message }) => message.includes('thickness ratio')));

const styledBorder = buildFlagOrdinaryLayers([{
  type: 'O07',
  params: {
    variant: 'ORLE',
    thickness: 60,
    gap: 24,
    line_style: { type: 'DANCETTY', amplitude: 30, period: 200 },
  },
}], frame, { canvasHeight: height });
assert.ok(styledBorder.paintLayers[0].polygons.some((polygon) => polygon.length > 4),
  'bordure applies its configured line style to the inner edge');
const checkeredBorder = buildFlagOrdinaryLayers([{
  type: 'O07',
  fill: 's2',
  params: { variant: 'CHECKY', thickness: 60, cellSize: 150, secondary_fill: 's3' },
}], frame, { canvasHeight: height });
assert.deepEqual(checkeredBorder.paintLayers.map(({ fill }) => fill), ['s2', 's3'],
  'CHECKY bordure paints alternating cells with two distinct slots');
assert.ok(checkeredBorder.paintLayers.every(({ polygons }) => polygons.length > 0));
assert.ok(validateFlagOrdinaries([{ type: 'O07', params: { variant: 'ORLE', gap: 19 } }], frame)
  .some(({ message }) => message.includes('orle gap')));
assertBuilds({ type: 'O07', params: { variant: 'DOUBLE', thickness: 60, gap: 100 } },
  'DOUBLE bordure accepts gaps larger than the ORLE maximum');

console.log('O01–O09 ordinary geometry, fimbriation, clipping, cantons, union motifs, and composition limits passed.');
