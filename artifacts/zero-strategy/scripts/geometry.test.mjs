import assert from 'node:assert/strict';
import {
  affine,
  booleanPolygons,
  boundsOfCircle,
  brushScalingBatch,
  circleIntersections,
  circleSegmentIntersections,
  circleSpatialEntry,
  clipPath,
  closestPointOnCircleBoundary,
  closestPointOnSegment,
  cubicAt,
  cubicLength,
  cubicTangent,
  distanceToCircleBoundary,
  distanceToSegment,
  DynamicSpatialIndex,
  ellipseArcAt,
  ellipseArcLength,
  flattenCubic,
  flattenEllipseArc,
  flattenQuadratic,
  intersectSegments,
  parseSvgPath,
  pathBounds,
  pathIntersections,
  pathLength,
  pathToPolygons,
  pointInRing,
  polylineLength,
  polylineSpatialEntry,
  quadraticLength,
  ringSignedArea,
  segmentLength,
  serializeSvgPath,
  strokePath,
  transformPath,
  vector,
  weightedGridSegmentDistance,
} from '../kernel/geometry.ts';
import { FLAG_REFERENCE_CORPUS } from '../game/flagReferences.ts';
import { renderFlagSpec } from '../game/flagRenderer.ts';
import { RANKS } from '../game/config.ts';
import { cityInfluenceArea, cityInfluenceMultiplier, cityInfluenceRadius } from '../game/settlements.ts';

const near = (actual, expected, tolerance = 1e-8, message = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ожидалось ${expected}, получено ${actual}`);
const boxPath = (x, y, width, height) => parseSvgPath(
  `M${x} ${y} h${width} v${height} h-${width} z`,
);

assert.deepEqual(vector.add({ x: 2, y: -3 }, { x: 4, y: 7 }), { x: 6, y: 4 });
near(vector.dot({ x: 2, y: 3 }, { x: 4, y: -1 }), 5);
assert.deepEqual(vector.normalize({ x: 0, y: 0 }), { x: 0, y: 0 });
const matrix = affine.multiply(affine.translation(9, -4), affine.rotation(Math.PI / 2));
const transformed = affine.apply(matrix, { x: 2, y: 0 });
near(transformed.x, 9); near(transformed.y, -2);
const restored = affine.apply(affine.invert(matrix), transformed);
near(restored.x, 2); near(restored.y, 0);
assert.throws(() => affine.invert(affine.scaling(0, 1)), /вырождена/u);

const degenerate = { start: { x: 2, y: 2 }, end: { x: 2, y: 2 } };
assert.equal(segmentLength(degenerate), 0);
assert.deepEqual(closestPointOnSegment({ x: 5, y: 2 }, degenerate), { x: 2, y: 2 });
near(distanceToSegment({ x: 3, y: 4 }, degenerate), Math.sqrt(5));
assert.deepEqual(intersectSegments(
  { start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
  { start: { x: 4, y: 0 }, end: { x: 4, y: 4 } },
), [{ x: 4, y: 0 }], 'касание концами входит в пересечение');
assert.deepEqual(intersectSegments(
  { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
  { start: { x: 3, y: 0 }, end: { x: 8, y: 0 } },
), [{ x: 3, y: 0 }, { x: 5, y: 0 }]);
assert.equal(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]), 7);

const quadratic = { start: { x: 0, y: 0 }, control: { x: 5, y: 10 }, end: { x: 10, y: 0 } };
assert.ok(flattenQuadratic(quadratic, 0.01).length > flattenQuadratic(quadratic, 0.5).length);
near(quadraticLength(quadratic, 0.001), 14.7894, 0.002);
assert.deepEqual(flattenQuadratic({ start: { x: 0, y: 0 }, control: { x: 5, y: 0 }, end: { x: 10, y: 0 } }, 0.01),
  [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
assert.throws(() => flattenQuadratic(quadratic, 0), /Допуск/u);
const cubic = {
  start: { x: 0, y: 0 }, control1: { x: 0, y: 10 },
  control2: { x: 10, y: 10 }, end: { x: 10, y: 0 },
};
assert.deepEqual(cubicAt(cubic, 0.5), { x: 5, y: 7.5 });
const startTangent = cubicTangent(cubic, 0);
near(startTangent.x, 0); near(startTangent.y, 1);
assert.ok(flattenCubic(cubic, 0.005).length > flattenCubic(cubic, 0.1).length);
near(cubicLength(cubic, 0.0005), 20, 0.001);

const quarterArc = {
  start: { x: 1, y: 0 }, end: { x: 0, y: 1 }, radiusX: 1, radiusY: 1,
  rotation: 0, largeArc: false, sweep: true,
};
const arcStart = ellipseArcAt(quarterArc, 0);
const arcEnd = ellipseArcAt(quarterArc, 1);
near(arcStart.x, quarterArc.start.x); near(arcStart.y, quarterArc.start.y);
near(arcEnd.x, quarterArc.end.x); near(arcEnd.y, quarterArc.end.y);
near(ellipseArcLength(quarterArc, 0.0001), Math.PI / 2, 0.0002);
assert.ok(flattenEllipseArc(quarterArc, 0.001).length > flattenEllipseArc(quarterArc, 0.1).length);
const correctedArc = { ...quarterArc, radiusX: 0.1, radiusY: 0.1 };
assert.ok(ellipseArcLength(correctedArc, 0.001) > 1, 'слишком малые радиусы автоматически масштабируются по SVG');
const zeroRadiusArc = { ...quarterArc, radiusX: 0, radiusY: 1 };
assert.equal(ellipseArcLength(zeroRadiusArc, 0.01), Math.sqrt(2));
assert.equal(ellipseArcLength({ ...quarterArc, end: { x: 1, y: 0 } }, 0.01), 0);
assert.equal(circleIntersections(
  { center: { x: 0, y: 0 }, radius: 2 }, { center: { x: 4, y: 0 }, radius: 2 },
).length, 1, 'касательные окружности имеют одну общую точку');
assert.deepEqual(circleSegmentIntersections({ center: { x: 0, y: 0 }, radius: 2 },
  { start: { x: -3, y: 2 }, end: { x: 3, y: 2 } }), [{ x: 0, y: 2 }]);
near(distanceToCircleBoundary({ x: 0, y: 0 }, { center: { x: 0, y: 0 }, radius: 3 }), 3);
const circleClosest = closestPointOnCircleBoundary({ x: 0, y: 0 }, { center: { x: 1, y: 1 }, radius: 2 });
near(circleClosest.x, 1 - Math.sqrt(2)); near(circleClosest.y, 1 - Math.sqrt(2));
assert.deepEqual(boundsOfCircle({ center: { x: 2, y: 3 }, radius: 4 }),
  { minX: -2, minY: -1, maxX: 6, maxY: 7 });

const sourcePath = 'm1 2 h4 v3 q2 2 4 0 t4 0 c1 1 2 1 3 0 s2 -1 3 0 a2 1 30 0 1 4 2 z';
const parsed = parseSvgPath(sourcePath);
const canonical = serializeSvgPath(parsed);
assert.doesNotThrow(() => parseSvgPath(canonical));
assert.equal(parsed[parsed.length - 1].type, 'close');
assert.throws(() => parseSvgPath('M0 0 A1 2 0 2 0 3 4'), /Флаги/u);
assert.throws(() => parseSvgPath('M0 0 X1 1'), /Неподдерживаемая команда/u);
const afterMoveSmooth = parseSvgPath('M0 0 1 1 T2 2');
assert.deepEqual(afterMoveSmooth[2].control, { x: 1, y: 1 }, 'неявная линия после M сбрасывает отражение контрольной точки');
const converted = transformPath(parseSvgPath('M0 0 A2 1 20 0 1 5 2'),
  affine.scaling(2, 3), 0.002);
assert.ok(converted.every((command) => command.type !== 'arc'), 'неравномерное аффинное преобразование дуги аппроксимируется с указанным допуском');
near(converted.at(-1).point.x, 10); near(converted.at(-1).point.y, 6);
const scaledArcLoose = transformPath(parseSvgPath('M0 0 A10 10 0 0 1 10 10'), affine.scaling(100), 0.1);
const scaledArcTight = transformPath(parseSvgPath('M0 0 A10 10 0 0 1 10 10'), affine.scaling(100), 0.001);
assert.ok(scaledArcTight.length > scaledArcLoose.length, 'допуск задаётся в координатах результата после масштабирования');
const crossed = pathIntersections(boxPath(0, 0, 10, 10), parseSvgPath('M-2 5 L12 5'), 0.01);
assert.equal(crossed.length, 2);
assert.ok(pathLength(parseSvgPath('M0 0 L3 4 M10 0 L10 2'), 0.01) === 7);
const bounds = pathBounds(parseSvgPath('M0 0 Q5 10 10 0'), 0.001);
near(bounds.maxY, 5, 0.002);

const outerAndHole = parseSvgPath('M0 0 L10 0 L10 10 L0 10 Z M3 3 L3 7 L7 7 L7 3 Z');
const evenodd = pathToPolygons(outerAndHole, 0.01, 'evenodd');
const nonzero = pathToPolygons(outerAndHole, 0.01, 'nonzero');
assert.equal(evenodd.length, 1);
assert.equal(evenodd[0].length, 2);
assert.equal(nonzero.length, 1);
assert.equal(nonzero[0].length, 2);
assert.equal(pointInRing({ x: 1, y: 1 }, evenodd[0][0]), true);
const sameWinding = pathToPolygons(parseSvgPath('M0 0 L10 0 L10 10 L0 10 Z M3 3 L7 3 L7 7 L3 7 Z'), 0.01, 'nonzero');
assert.equal(sameWinding[0].length, 1, 'одинаковое направление вложенных колец не создаёт отверстие для nonzero');
const nestedFill = pathToPolygons(parseSvgPath(
  'M0 0 L20 0 L20 20 L0 20 Z M3 3 L3 17 L17 17 L17 3 Z M6 6 L14 6 L14 14 L6 14 Z',
), 0.01, 'nonzero');
assert.equal(nestedFill.length, 2, 'остров внутри отверстия снова получает заливку nonzero');
assert.equal(nestedFill.reduce((count, polygon) => count + polygon.length, 0), 3);
const left = pathToPolygons(boxPath(0, 0, 10, 10), 0.01);
const right = pathToPolygons(boxPath(5, 0, 10, 10), 0.01);
const overlap = booleanPolygons('intersection', left, right);
assert.equal(overlap.length, 1);
near(Math.abs(ringSignedArea(overlap[0][0])), 50);
assert.equal(booleanPolygons('union', left, right).length, 1);
const clippedByPath = clipPath(boxPath(0, 0, 10, 10), boxPath(5, 0, 10, 10), 0.01);
assert.equal(clippedByPath.length, 1);
near(Math.abs(ringSignedArea(clippedByPath[0][0])), 50);
const clipped = pathToPolygons(boxPath(2, 2, 4, 4), 0.01);
assert.equal(booleanPolygons('difference', left, clipped)[0].length, 2);
assert.equal(pathToPolygons(parseSvgPath('M0 0 L10 0 L10 10 L0 10 Z'), 0.01).length, 1);
const clippedPaths = pathToPolygons(parseSvgPath('M0 0 L10 0 L10 10 L0 10 Z'), 0.01);
assert.equal(booleanPolygons('xor', clippedPaths, clipped).length, 1);
const clippedPath = pathToPolygons(
  parseSvgPath('M0 0 L10 0 L10 10 L0 10 Z'), 0.01,
);
assert.equal(clippedPath.length, 1);
const stroke = strokePath(parseSvgPath('M0 0 L10 0'), 2, 0.01, 'round');
assert.ok(stroke.length > 0);
const strokeBounds = stroke[0].flat().reduce((result, point) => ({
  minX: Math.min(result.minX, point.x), minY: Math.min(result.minY, point.y),
  maxX: Math.max(result.maxX, point.x), maxY: Math.max(result.maxY, point.y),
}), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
near(strokeBounds.minX, -1, 0.02);
near(strokeBounds.maxX, 11, 0.02);
near(strokeBounds.minY, -1, 0.02);
near(strokeBounds.maxY, 1, 0.02);
const closedStroke = strokePath(parseSvgPath('M0 0 L10 0 L10 10 L0 10 Z'), 2, 0.01);
assert.ok(closedStroke.length > 0);
const closedStrokePoints = closedStroke.flat(2);
near(Math.min(...closedStrokePoints.map(({ x }) => x)), -1, 0.02);
near(Math.max(...closedStrokePoints.map(({ x }) => x)), 11, 0.02);

const index = new DynamicSpatialIndex(10);
index.insert(circleSpatialEntry('city', { kind: 'city', name: 'город' }, { center: { x: 5, y: 0 }, radius: 2 }));
index.insert(polylineSpatialEntry('river', { kind: 'river' }, [{ x: 20, y: -5 }, { x: 20, y: 5 }]));
index.insert(polylineSpatialEntry('coast', { kind: 'coast' }, [{ x: 50, y: 0 }, { x: 50, y: 20 }]));
assert.equal(index.nearest({ x: 0, y: 0 }).id, 'city');
near(index.nearest({ x: 0, y: 0 }).distance, 3);
assert.deepEqual(index.nearest({ x: 0, y: 0 }).point, { x: 3, y: 0 });
assert.deepEqual(index.sphereCandidates({ x: 15, y: 0 }, 6).map(({ id }) => id), ['river']);
assert.equal(index.distanceToMany({ x: 0, y: 0 }, ['river', 'coast']), 20);
const revision = index.revision;
index.update(circleSpatialEntry('city', { kind: 'city', name: 'перенесённый город' }, { center: { x: 80, y: 0 }, radius: 4 }));
assert.equal(index.revision, revision + 1);
assert.equal(index.nearest({ x: 0, y: 0 }).id, 'river');
assert.equal(index.nearest({ x: 79, y: 0 }).id, 'city');
near(index.nearest({ x: 79, y: 0 }).distance, 0);
assert.equal(index.remove('river'), true);
assert.equal(index.get('river'), undefined);
assert.equal(index.nearest({ x: 0, y: 0 }).id, 'coast');
assert.equal(index.query({ minX: 45, minY: -1, maxX: 55, maxY: 2 }).length, 1);
assert.equal(index.remove('coast'), true);
assert.equal(index.nearest({ x: 0, y: 0 }).id, 'city');

const landDistance = weightedGridSegmentDistance({ x: 0, y: 0 }, { x: 4, y: 0 }, (x) => x <= 2, 3);
near(landDistance, 2 + 2 / 3);
near(weightedGridSegmentDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, () => false, 5), 0);
assert.throws(() => weightedGridSegmentDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, () => true, 0), /Коэффициент/u);
const scaling = brushScalingBatch([
  { kind: 'expand', point: { x: 4, y: 0 }, duchyRadius: 5, terrain: (x) => x <= 2,
    influence: { ownRankSum: 6, ownLargestRank: 4, foreignRankSum: 0, nearestOwnDistance: 99,
      nearestOwnAnchorDistance: Infinity, nearestOwnRadius: 1, nearestOwnCity: { x: 0, y: 0 }, nearestOwnAnchor: null } },
  { kind: 'colonization', point: { x: 4, y: 0 }, duchyRadius: 5, terrain: (x) => x <= 2,
    influence: { ownRankSum: 6, ownLargestRank: 4, foreignRankSum: 0, nearestOwnDistance: 0,
      nearestOwnAnchorDistance: Infinity, nearestOwnRadius: 1, nearestOwnCity: null, nearestOwnAnchor: { x: 0, y: 0 } } },
  { kind: 'nomadExpand', point: { x: 0, y: 0 }, duchyRadius: 5, terrain: () => true,
    influence: { ownRankSum: 0, ownLargestRank: 0, foreignRankSum: 2, nearestOwnDistance: Infinity,
      nearestOwnAnchorDistance: Infinity, nearestOwnRadius: 0, nearestOwnCity: null, nearestOwnAnchor: null } },
]);
near(scaling[0].strength, 1.5);
near(scaling[0].cost, 2 / 3);
near(scaling[1].cost, (1 + (2 + 2 / 5) / 5) / 7);
near(scaling[1].strength, 1 / scaling[1].cost);
assert.deepEqual(scaling[2], { cost: 2, strength: 0.5 });
const rulesWorld = { isCoastal: (pixel) => pixel === 7, rivers: new Uint8Array(8) };
rulesWorld.rivers[7] = 1;
const portCapital = { pixel: 7, rank: 1, capital: true };
assert.equal(cityInfluenceMultiplier(rulesWorld, portCapital), 6);
near(cityInfluenceArea(rulesWorld, portCapital), RANKS[0].ink * 6);
near(cityInfluenceRadius(rulesWorld, portCapital), Math.sqrt(RANKS[0].ink * 6 / Math.PI));

const flag = FLAG_REFERENCE_CORPUS.find(({ id }) => id === 'japan');
assert.ok(flag, 'эталонный флаг доступен для проверки геометрии');
const svg = renderFlagSpec(flag.spec);
const pathData = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/gu)].map((match) => match[1]);
assert.ok(pathData.length > 0);
for (const data of pathData) assert.ok(parseSvgPath(data).length > 0, 'путь генератора флагов разбирается общей геометрией');

console.log('Геометрия прошла проверки примитивов, SVG, булевых контуров, индекса, воды, кисти и флагов.');
