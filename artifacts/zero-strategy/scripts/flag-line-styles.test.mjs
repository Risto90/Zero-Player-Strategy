import assert from 'node:assert/strict';
import { buildFlagField, flagPolygonSetArea } from '../game/flagField.ts';
import { generateFlagBoundary } from '../game/flagLineStyles.ts';
import { FLAG_LINE_STYLE_CONFIG } from '../game/flagLineStyleConfig.ts';

const height = 1200;
const frame = { x0: 17, y0: 23, w: 960, h: 640 };
const frameArea = frame.w * frame.h;
const styleNames = [
  'STRAIGHT',
  'EMBATTLED',
  'DANCETTY',
  'WAVY',
  'ENGRAILED',
  'INVECTED',
  'NEBULY',
];

for (const type of styleNames) {
  const boundary = generateFlagBoundary([{ x: 10, y: 0 }, { x: 10, y: height }], {
    type,
    amplitude: height / 20,
    period: height / 6,
  }, height);

  if (type === 'STRAIGHT') {
    assert.deepEqual(boundary.points, [{ x: 10, y: 0 }, { x: 10, y: height }]);
    assert.equal(boundary.periods, 0);
    continue;
  }

  assert.equal(boundary.periods, Math.max(2, Math.round(height / (height / 6))),
    `${type} uses an integral number of periods`);
  assert.ok(Math.abs(boundary.periodLength * boundary.periods - height) < 1e-8,
    `${type} periods fill the complete boundary`);
  assert.equal(boundary.points.length, boundary.periods * FLAG_LINE_STYLE_CONFIG.samplesPerPeriod + 1);
  assert.deepEqual(boundary.points[0], { x: 10, y: 0 }, `${type} begins at the shared boundary endpoint`);
  assert.deepEqual(boundary.points.at(-1), { x: 10, y: height }, `${type} ends at the shared boundary endpoint`);
  assert.ok(boundary.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
    `${type} produces finite geometry`);
  const displacement = Math.max(...boundary.points.map(({ x }) => Math.abs(x - 10)));
  assert.ok(displacement >= height / 40 - 1e-6 && displacement <= height / 12 + 1e-6,
    `${type} keeps its smallest and largest details within the configured amplitude range`);
  for (let index = 0; index < boundary.points.length; index += 1) {
    const mirrored = boundary.points[boundary.points.length - 1 - index];
    assert.ok(Math.abs(boundary.points[index].x - mirrored.x) < 1e-6,
      `${type} profile is symmetric across its midpoint`);
    assert.ok(Math.abs(boundary.points[index].y + mirrored.y - height) < 1e-6,
      `${type} profile retains mirrored arc length`);
  }
}

for (const [amplitude, period] of [[height / 40, height / 10], [height / 12, height / 3]]) {
  const boundary = generateFlagBoundary([{ x: 0, y: 0 }, { x: 0, y: height }], {
    type: 'ENGRAILED',
    amplitude,
    period,
  }, height);
  assert.equal(boundary.amplitude, amplitude, 'configured amplitude endpoints are accepted');
  assert.ok(Math.abs(boundary.periodLength * boundary.periods - height) < 1e-8,
    'configured period endpoints still fit an integer number of periods');
}

assert.throws(() => generateFlagBoundary([{ x: 0, y: 0 }, { x: 0, y: 10 }], 'WAVY', height),
  /positive length|amplitude|period/);
assert.throws(() => generateFlagBoundary([{ x: 0, y: 0 }, { x: 0, y: height }], {
  type: 'WAVY',
  amplitude: height / 41,
}, height), /amplitude/);
assert.throws(() => generateFlagBoundary([{ x: 0, y: 0 }, { x: 0, y: height }], {
  type: 'WAVY',
  period: height / 40,
}, height), /period/);

function sharedEdgeExists(regionA, regionB, a, b) {
  return regionA.some((polygon) => polygon.some((from, index) => {
    const to = polygon[(index + 1) % polygon.length];
    return Math.abs(from.x - a.x) < 1e-7 && Math.abs(from.y - a.y) < 1e-7 &&
      Math.abs(to.x - b.x) < 1e-7 && Math.abs(to.y - b.y) < 1e-7;
  })) && regionB.some((polygon) => polygon.some((from, index) => {
    const to = polygon[(index + 1) % polygon.length];
    return Math.abs(from.x - b.x) < 1e-7 && Math.abs(from.y - b.y) < 1e-7 &&
      Math.abs(to.x - a.x) < 1e-7 && Math.abs(to.y - a.y) < 1e-7;
  }));
}

function hasProperSelfIntersection(polygon) {
  const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    for (let j = i + 1; j < polygon.length; j += 1) {
      if (j === i || j === (i + 1) % polygon.length || (j + 1) % polygon.length === i) continue;
      const c = polygon[j];
      const d = polygon[(j + 1) % polygon.length];
      const abC = orient(a, b, c);
      const abD = orient(a, b, d);
      const cdA = orient(c, d, a);
      const cdB = orient(c, d, b);
      if (abC * abD < -1e-8 && cdA * cdB < -1e-8) return true;
    }
  }
  return false;
}

for (const type of styleNames.filter((name) => name !== 'STRAIGHT')) {
  const result = buildFlagField({
    op: 'G02',
    params: { axis: 'H', n: 3, weights: { kind: 'equal' }, line_style: type },
  }, frame, { canvasHeight: height });
  const area = result.regions.reduce((sum, region) => sum + region.area, 0);
  assert.ok(Math.abs(area - frameArea) < 0.02, `${type} regions remain closed and cover the full frame`);
  assert.ok(result.regions.every(({ polygons }) =>
    polygons.every((polygon) => polygon.length > 3 && flagPolygonSetArea([polygon]) > 0 &&
      polygon.every((point, index) => Number.isFinite(point.x) && Number.isFinite(point.y) &&
        Math.hypot(point.x - polygon[(index + 1) % polygon.length].x,
          point.y - polygon[(index + 1) % polygon.length].y) > 1e-8) &&
      !hasProperSelfIntersection(polygon))),
  `${type} produces finite, closed, non-self-intersecting fill contours without a stroke`);

  // Endpoints of the shared top/bottom profile edges are exactly reused,
  // and each segment of the generated contour has a matching reversed edge.
  const sharedSegments = result.regions[0].polygons.flatMap((polygon) => polygon.flatMap((from, index) => {
    const to = polygon[(index + 1) % polygon.length];
    return sharedEdgeExists(result.regions[0].polygons, result.regions[1].polygons, from, to) ? [[from, to]] : [];
  }));
  assert.ok(sharedSegments.length >= 2, `${type} boundary remains stitched between neighboring regions`);
}

for (const opCase of [
  { op: 'G03', params: { angle: 45, n: 3, line_style: 'WAVY' } },
  { op: 'G04', params: { mode: 'BEND', line_style: 'ENGRAILED' } },
  { op: 'G04', params: { mode: 'CHEVRON', line_style: 'NEBULY' } },
  { op: 'G11', params: { n: 3, amplitude: 0.1, line_style: 'DANCETTY' } },
]) {
  const result = buildFlagField(opCase, frame, { canvasHeight: height, random: () => 0 });
  assert.ok(Math.abs(result.regions.reduce((sum, region) => sum + region.area, 0) - frameArea) < 0.02,
    `${opCase.op} preserves region adjacency after styling`);
}

console.log('Flag line styles, symmetric periods, minimum parameters, and shared fill boundaries passed.');
