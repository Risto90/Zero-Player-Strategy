import * as polygonClipping from 'polygon-clipping';

/** Единый допуск задаётся вызывающей стороной в координатах текущей геометрии. */
export interface Point2 { x: number; y: number }
export interface Bounds2 { minX: number; minY: number; maxX: number; maxY: number }
export interface Affine2 { a: number; b: number; c: number; d: number; e: number; f: number }
export interface Segment2 { start: Point2; end: Point2 }
export interface Circle2 { center: Point2; radius: number }
export interface EllipseArc2 {
  start: Point2;
  end: Point2;
  radiusX: number;
  radiusY: number;
  rotation: number;
  largeArc: boolean;
  sweep: boolean;
}
export interface QuadraticBezier2 { start: Point2; control: Point2; end: Point2 }
export interface CubicBezier2 { start: Point2; control1: Point2; control2: Point2; end: Point2 }
export type PathCommand =
  | { type: 'move' | 'line'; point: Point2 }
  | { type: 'quadratic'; control: Point2; point: Point2 }
  | { type: 'cubic'; control1: Point2; control2: Point2; point: Point2 }
  | { type: 'arc'; radiusX: number; radiusY: number; rotation: number; largeArc: boolean; sweep: boolean; point: Point2 }
  | { type: 'close' };
export type GeometryPath = readonly PathCommand[];
export type Ring2 = Point2[];
export type Polygon2 = Ring2[];
export type MultiPolygon2 = Polygon2[];
export type FillRule = 'evenodd' | 'nonzero';
export type StrokeCap = 'butt' | 'square' | 'round';
export type StrokeJoin = 'miter' | 'bevel' | 'round';

const EPSILON = 1e-12;
const MAX_FLATTENED_POINTS = 1_000_000;
const identity: Affine2 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} должен быть конечным числом`);
  return value;
}
function nonnegativeDistance(value: number, name: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new RangeError(`${name} должно быть неотрицательным числом`);
  }
  return value;
}
function validPoint(value: Point2, name = 'точка'): Point2 {
  if (!value || typeof value !== 'object') throw new TypeError(`${name} не задана`);
  return { x: finite(value.x, `${name}.x`), y: finite(value.y, `${name}.y`) };
}
function validBounds(value: Bounds2): Bounds2 {
  if (!value || ![value.minX, value.minY, value.maxX, value.maxY].every(Number.isFinite) ||
      value.minX > value.maxX || value.minY > value.maxY) throw new RangeError('Границы геометрии некорректны');
  return value;
}
function validAffine(value: Affine2): Affine2 {
  if (!value || ![value.a, value.b, value.c, value.d, value.e, value.f].every(Number.isFinite)) {
    throw new TypeError('Матрица должна содержать конечные числа');
  }
  return value;
}
function validTolerance(tolerance: number): number {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError('Допуск должен быть конечным числом больше нуля');
  return tolerance;
}
function samePoint(a: Point2, b: Point2, epsilon = EPSILON): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}
function cross(a: Point2, b: Point2): number { return a.x * b.y - a.y * b.x; }
function subtract(a: Point2, b: Point2): Point2 { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Point2, b: Point2): Point2 { return { x: a.x + b.x, y: a.y + b.y }; }
function scale(point: Point2, factor: number): Point2 { return { x: point.x * factor, y: point.y * factor }; }

export const vector = {
  create(x: number, y: number): Point2 { return { x: finite(x, 'x'), y: finite(y, 'y') }; },
  add(a: Point2, b: Point2): Point2 { return add(validPoint(a), validPoint(b)); },
  subtract(a: Point2, b: Point2): Point2 { return subtract(validPoint(a), validPoint(b)); },
  scale(point: Point2, factor: number): Point2 { return scale(validPoint(point), finite(factor, 'множитель')); },
  dot(a: Point2, b: Point2): number { const first = validPoint(a), second = validPoint(b); return first.x * second.x + first.y * second.y; },
  cross(a: Point2, b: Point2): number { return cross(validPoint(a), validPoint(b)); },
  length(point: Point2): number { const p = validPoint(point); return Math.hypot(p.x, p.y); },
  distance(a: Point2, b: Point2): number { const first = validPoint(a), second = validPoint(b); return Math.hypot(first.x - second.x, first.y - second.y); },
  normalize(point: Point2): Point2 {
    const p = validPoint(point), length = Math.hypot(p.x, p.y);
    return length === 0 ? { x: 0, y: 0 } : { x: p.x / length, y: p.y / length };
  },
  perpendicular(point: Point2): Point2 { const p = validPoint(point); return { x: -p.y, y: p.x }; },
  lerp(a: Point2, b: Point2, t: number): Point2 {
    finite(t, 'параметр'); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  },
};

export const affine = {
  identity(): Affine2 { return { ...identity }; },
  create(a: number, b: number, c: number, d: number, e: number, f: number): Affine2 {
    return { a: finite(a, 'a'), b: finite(b, 'b'), c: finite(c, 'c'), d: finite(d, 'd'), e: finite(e, 'e'), f: finite(f, 'f') };
  },
  translation(x: number, y: number): Affine2 { return { ...identity, e: finite(x, 'x'), f: finite(y, 'y') }; },
  scaling(x: number, y = x): Affine2 { return { a: finite(x, 'x'), d: finite(y, 'y'), b: 0, c: 0, e: 0, f: 0 }; },
  rotation(radians: number): Affine2 {
    const angle = finite(radians, 'угол'), cosine = Math.cos(angle), sine = Math.sin(angle);
    return { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
  },
  multiply(left: Affine2, right: Affine2): Affine2 {
    validAffine(left); validAffine(right);
    return {
      a: left.a * right.a + left.c * right.b, b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d, d: left.b * right.c + left.d * right.d,
      e: left.a * right.e + left.c * right.f + left.e, f: left.b * right.e + left.d * right.f + left.f,
    };
  },
  invert(matrix: Affine2): Affine2 {
    validAffine(matrix);
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) <= EPSILON) throw new RangeError('Аффинная матрица вырождена и не обратима');
    return {
      a: matrix.d / determinant, b: -matrix.b / determinant, c: -matrix.c / determinant, d: matrix.a / determinant,
      e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
      f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
    };
  },
  apply(matrix: Affine2, point: Point2): Point2 {
    validAffine(matrix);
    const p = validPoint(point);
    return { x: matrix.a * p.x + matrix.c * p.y + matrix.e, y: matrix.b * p.x + matrix.d * p.y + matrix.f };
  },
};

export function boundsOfPoints(points: readonly Point2[]): Bounds2 {
  if (!points.length) throw new RangeError('Нельзя определить границы пустого набора точек');
  const first = validPoint(points[0]);
  return points.slice(1).reduce((bounds, raw) => {
    const point = validPoint(raw);
    return { minX: Math.min(bounds.minX, point.x), minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x), maxY: Math.max(bounds.maxY, point.y) };
  }, { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y });
}
export function boundsDistance(bounds: Bounds2, point: Point2): number {
  const b = validBounds(bounds), p = validPoint(point);
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  return Math.hypot(dx, dy);
}
export function boundsIntersect(a: Bounds2, b: Bounds2): boolean {
  const left = validBounds(a), right = validBounds(b);
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}
export function boundsOfCircle(circle: Circle2): Bounds2 {
  const center = validPoint(circle.center), radius = finite(circle.radius, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  return { minX: center.x - radius, minY: center.y - radius, maxX: center.x + radius, maxY: center.y + radius };
}

export function closestPointOnSegment(point: Point2, segment: Segment2): Point2 {
  const p = validPoint(point), start = validPoint(segment.start), end = validPoint(segment.end);
  const dx = end.x - start.x, dy = end.y - start.y, denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / denominator));
  return { x: start.x + t * dx, y: start.y + t * dy };
}
export function distanceToSegment(point: Point2, segment: Segment2): number {
  return vector.distance(validPoint(point), closestPointOnSegment(point, segment));
}
export function segmentLength(segment: Segment2): number { return vector.distance(segment.start, segment.end); }
export function segmentTangent(segment: Segment2): Point2 { return vector.normalize(subtract(segment.end, segment.start)); }

/** Пересечение отрезков с включёнными касаниями и коллинеарным перекрытием. */
export function intersectSegments(first: Segment2, second: Segment2, epsilon = 1e-9): Point2[] {
  const a = validPoint(first.start), b = validPoint(first.end), c = validPoint(second.start), d = validPoint(second.end);
  const r = subtract(b, a), s = subtract(d, c), denominator = cross(r, s), ca = subtract(c, a);
  if (Math.abs(denominator) <= epsilon) {
    if (Math.abs(cross(ca, r)) > epsilon) return [];
    if (vector.length(r) <= epsilon) return distanceToSegment(a, second) <= epsilon ? [a] : [];
    const rr = vector.dot(r, r);
    const t0 = vector.dot(ca, r) / rr, t1 = t0 + vector.dot(s, r) / rr;
    const low = Math.max(0, Math.min(t0, t1)), high = Math.min(1, Math.max(t0, t1));
    if (high < low - epsilon) return [];
    const firstPoint = vector.lerp(a, b, Math.max(0, Math.min(1, low)));
    const lastPoint = vector.lerp(a, b, Math.max(0, Math.min(1, high)));
    return samePoint(firstPoint, lastPoint, epsilon) ? [firstPoint] : [firstPoint, lastPoint];
  }
  const t = cross(ca, s) / denominator, u = cross(ca, r) / denominator;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return [];
  return [vector.lerp(a, b, Math.max(0, Math.min(1, t)))];
}
export function polylineLength(points: readonly Point2[], closed = false): number {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) result += vector.distance(points[index - 1], points[index]);
  if (closed && points.length > 1) result += vector.distance(points[points.length - 1], points[0]);
  return result;
}
export function closestPointOnPolyline(point: Point2, points: readonly Point2[], closed = false): Point2 | null {
  if (!points.length) return null;
  if (points.length === 1) return validPoint(points[0]);
  let closest: Point2 | null = null, distance = Infinity;
  const count = points.length - 1 + (closed ? 1 : 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = closestPointOnSegment(point, { start: points[index], end: points[(index + 1) % points.length] });
    const nextDistance = vector.distance(point, candidate);
    if (nextDistance < distance) { closest = candidate; distance = nextDistance; }
  }
  return closest;
}
export function polylineIntersections(first: readonly Point2[], second: readonly Point2[], closedFirst = false, closedSecond = false): Point2[] {
  const firstCount = first.length - 1 + (closedFirst && first.length > 1 ? 1 : 0);
  const secondCount = second.length - 1 + (closedSecond && second.length > 1 ? 1 : 0);
  const result: Point2[] = [];
  for (let i = 0; i < firstCount; i += 1) for (let j = 0; j < secondCount; j += 1) {
    for (const hit of intersectSegments({ start: first[i], end: first[(i + 1) % first.length] },
      { start: second[j], end: second[(j + 1) % second.length] })) {
      if (!result.some((point) => samePoint(point, hit, 1e-8))) result.push(hit);
    }
  }
  return result;
}

function distancePointLine(point: Point2, start: Point2, end: Point2): number {
  const line = subtract(end, start), length = vector.length(line);
  return length === 0 ? vector.distance(point, start) : Math.abs(cross(line, subtract(point, start))) / length;
}
function splitQuadratic(curve: QuadraticBezier2): [QuadraticBezier2, QuadraticBezier2] {
  const a = vector.lerp(curve.start, curve.control, 0.5), b = vector.lerp(curve.control, curve.end, 0.5), middle = vector.lerp(a, b, 0.5);
  return [{ start: curve.start, control: a, end: middle }, { start: middle, control: b, end: curve.end }];
}
function splitCubic(curve: CubicBezier2): [CubicBezier2, CubicBezier2] {
  const a = vector.lerp(curve.start, curve.control1, 0.5), b = vector.lerp(curve.control1, curve.control2, 0.5);
  const c = vector.lerp(curve.control2, curve.end, 0.5), d = vector.lerp(a, b, 0.5), e = vector.lerp(b, c, 0.5);
  const middle = vector.lerp(d, e, 0.5);
  return [{ start: curve.start, control1: a, control2: d, end: middle },
    { start: middle, control1: e, control2: c, end: curve.end }];
}
export function quadraticAt(curve: QuadraticBezier2, t: number): Point2 {
  const u = 1 - t;
  return { x: u * u * curve.start.x + 2 * u * t * curve.control.x + t * t * curve.end.x,
    y: u * u * curve.start.y + 2 * u * t * curve.control.y + t * t * curve.end.y };
}
export function cubicAt(curve: CubicBezier2, t: number): Point2 {
  const u = 1 - t, u2 = u * u, t2 = t * t;
  return { x: u2 * u * curve.start.x + 3 * u2 * t * curve.control1.x + 3 * u * t2 * curve.control2.x + t2 * t * curve.end.x,
    y: u2 * u * curve.start.y + 3 * u2 * t * curve.control1.y + 3 * u * t2 * curve.control2.y + t2 * t * curve.end.y };
}
export function quadraticTangent(curve: QuadraticBezier2, t: number): Point2 {
  return vector.normalize({ x: 2 * (1 - t) * (curve.control.x - curve.start.x) + 2 * t * (curve.end.x - curve.control.x),
    y: 2 * (1 - t) * (curve.control.y - curve.start.y) + 2 * t * (curve.end.y - curve.control.y) });
}
export function cubicTangent(curve: CubicBezier2, t: number): Point2 {
  const u = 1 - t;
  return vector.normalize({ x: 3 * u * u * (curve.control1.x - curve.start.x) + 6 * u * t * (curve.control2.x - curve.control1.x) + 3 * t * t * (curve.end.x - curve.control2.x),
    y: 3 * u * u * (curve.control1.y - curve.start.y) + 6 * u * t * (curve.control2.y - curve.control1.y) + 3 * t * t * (curve.end.y - curve.control2.y) });
}
export function flattenQuadratic(curve: QuadraticBezier2, tolerance: number): Point2[] {
  validTolerance(tolerance);
  const output = [validPoint(curve.start)];
  const visit = (part: QuadraticBezier2, depth: number): void => {
    if (distancePointLine(part.control, part.start, part.end) <= tolerance) { output.push(part.end); return; }
    if (depth >= 32 || output.length >= MAX_FLATTENED_POINTS) throw new RangeError('Квадратичная кривая не укладывается в заданный допуск');
    const [left, right] = splitQuadratic(part); visit(left, depth + 1); visit(right, depth + 1);
  };
  visit(curve, 0);
  return output;
}
export function flattenCubic(curve: CubicBezier2, tolerance: number): Point2[] {
  validTolerance(tolerance);
  const output = [validPoint(curve.start)];
  const visit = (part: CubicBezier2, depth: number): void => {
    if (Math.max(distancePointLine(part.control1, part.start, part.end), distancePointLine(part.control2, part.start, part.end)) <= tolerance) {
      output.push(part.end); return;
    }
    if (depth >= 32 || output.length >= MAX_FLATTENED_POINTS) throw new RangeError('Кубическая кривая не укладывается в заданный допуск');
    const [left, right] = splitCubic(part); visit(left, depth + 1); visit(right, depth + 1);
  };
  visit(curve, 0);
  return output;
}
export function quadraticLength(curve: QuadraticBezier2, tolerance: number): number {
  return polylineLength(flattenQuadratic(curve, tolerance));
}
export function cubicLength(curve: CubicBezier2, tolerance: number): number {
  return polylineLength(flattenCubic(curve, tolerance));
}

interface ArcCenter {
  center: Point2; radiusX: number; radiusY: number; rotation: number; startAngle: number; deltaAngle: number;
}
/** Преобразование SVG 2 от конечных точек к центру с коррекцией радиусов и вырожденных дуг. */
export function svgArcCenter(arc: EllipseArc2): ArcCenter | null {
  let rx = Math.abs(finite(arc.radiusX, 'радиус X')), ry = Math.abs(finite(arc.radiusY, 'радиус Y'));
  const start = validPoint(arc.start), end = validPoint(arc.end), rotation = finite(arc.rotation, 'поворот');
  if (samePoint(start, end)) return null;
  if (rx === 0 || ry === 0) return null;
  const phi = rotation * Math.PI / 180, cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const dx = (start.x - end.x) / 2, dy = (start.y - end.y) / 2;
  const xp = cosPhi * dx + sinPhi * dy, yp = -sinPhi * dx + cosPhi * dy;
  const lambda = xp * xp / (rx * rx) + yp * yp / (ry * ry);
  if (lambda > 1) { const factor = Math.sqrt(lambda); rx *= factor; ry *= factor; }
  const sign = arc.largeArc === arc.sweep ? -1 : 1;
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp);
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cxp = coefficient * (rx * yp / ry), cyp = coefficient * (-ry * xp / rx);
  const center = { x: cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2,
    y: sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2 };
  const u = { x: (xp - cxp) / rx, y: (yp - cyp) / ry }, v = { x: (-xp - cxp) / rx, y: (-yp - cyp) / ry };
  const startAngle = Math.atan2(u.y, u.x);
  let deltaAngle = Math.atan2(cross(u, v), vector.dot(u, v));
  if (!arc.sweep && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  if (arc.sweep && deltaAngle < 0) deltaAngle += 2 * Math.PI;
  return { center, radiusX: rx, radiusY: ry, rotation: phi, startAngle, deltaAngle };
}
export function ellipseArcAt(arc: EllipseArc2, t: number): Point2 {
  const parameters = svgArcCenter(arc);
  if (!parameters) return vector.lerp(arc.start, arc.end, t);
  const angle = parameters.startAngle + parameters.deltaAngle * t, cosPhi = Math.cos(parameters.rotation), sinPhi = Math.sin(parameters.rotation);
  const x = parameters.radiusX * Math.cos(angle), y = parameters.radiusY * Math.sin(angle);
  return { x: parameters.center.x + cosPhi * x - sinPhi * y, y: parameters.center.y + sinPhi * x + cosPhi * y };
}
export function ellipseArcTangent(arc: EllipseArc2, t: number): Point2 {
  const parameters = svgArcCenter(arc);
  if (!parameters) return vector.normalize(subtract(arc.end, arc.start));
  const angle = parameters.startAngle + parameters.deltaAngle * t, cosPhi = Math.cos(parameters.rotation), sinPhi = Math.sin(parameters.rotation);
  return vector.normalize({ x: parameters.deltaAngle * (-cosPhi * parameters.radiusX * Math.sin(angle) - sinPhi * parameters.radiusY * Math.cos(angle)),
    y: parameters.deltaAngle * (-sinPhi * parameters.radiusX * Math.sin(angle) + cosPhi * parameters.radiusY * Math.cos(angle)) });
}
export function flattenEllipseArc(arc: EllipseArc2, tolerance: number): Point2[] {
  validTolerance(tolerance);
  const params = svgArcCenter(arc);
  if (!params) return [validPoint(arc.start), validPoint(arc.end)];
  const radius = Math.max(params.radiusX, params.radiusY);
  const ratio = tolerance / radius;
  const maxStep = ratio < 1e-8 ? Math.sqrt(8 * ratio) : 2 * Math.acos(Math.max(-1, 1 - ratio));
  const step = Math.min(Math.PI / 2, maxStep);
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('Допуск дуги слишком мал для данной точности чисел');
  const count = Math.max(1, Math.ceil(Math.abs(params.deltaAngle) / step));
  if (count + 1 > MAX_FLATTENED_POINTS) throw new RangeError('Дуга превышает предел точек при заданном допуске');
  return Array.from({ length: count + 1 }, (_, index) => ellipseArcAt(arc, index / count));
}
export function ellipseArcLength(arc: EllipseArc2, tolerance: number): number {
  return polylineLength(flattenEllipseArc(arc, tolerance));
}
export function circleIntersections(first: Circle2, second: Circle2, epsilon = 1e-9): Point2[] {
  const r1 = finite(first.radius, 'радиус'), r2 = finite(second.radius, 'радиус');
  if (r1 < 0 || r2 < 0) throw new RangeError('Радиус не может быть отрицательным');
  const a = validPoint(first.center), b = validPoint(second.center), dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= epsilon && Math.abs(r1 - r2) <= epsilon) return [];
  if (d > r1 + r2 + epsilon || d < Math.abs(r1 - r2) - epsilon || d <= epsilon) return [];
  const along = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const middle = { x: a.x + along * dx / d, y: a.y + along * dy / d };
  const offset = { x: -dy * height / d, y: dx * height / d };
  const one = add(middle, offset), two = subtract(middle, offset);
  return samePoint(one, two, epsilon) ? [one] : [one, two];
}
export function circleSegmentIntersections(circle: Circle2, segment: Segment2, epsilon = 1e-9): Point2[] {
  const center = validPoint(circle.center), start = validPoint(segment.start), end = validPoint(segment.end);
  const direction = subtract(end, start), offset = subtract(start, center), radius = finite(circle.radius, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  const a = vector.dot(direction, direction);
  if (a === 0) return Math.abs(vector.distance(start, center) - radius) <= epsilon ? [start] : [];
  const b = 2 * vector.dot(offset, direction), c = vector.dot(offset, offset) - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -epsilon) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [...new Set([(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((t) => t >= -epsilon && t <= 1 + epsilon)
    .map((t) => vector.lerp(start, end, Math.max(0, Math.min(1, t)))))]
    .filter((point, index, points) => points.findIndex((other) => samePoint(point, other, epsilon)) === index);
}
export function distanceToCircleBoundary(point: Point2, circle: Circle2): number {
  const radius = finite(circle.radius, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  return Math.abs(vector.distance(validPoint(point), validPoint(circle.center)) - radius);
}
export function closestPointOnCircleBoundary(point: Point2, circle: Circle2): Point2 {
  const p = validPoint(point), center = validPoint(circle.center), radius = finite(circle.radius, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  const direction = vector.normalize(subtract(p, center));
  return vector.length(direction) === 0 ? { x: center.x + radius, y: center.y }
    : { x: center.x + direction.x * radius, y: center.y + direction.y * radius };
}

const TOKEN = /([a-zA-Z])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/gy;
export function parseSvgPath(source: string): PathCommand[] {
  if (typeof source !== 'string') throw new TypeError('SVG path должен быть строкой');
  const tokens: Array<{ command?: string; value?: number }> = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (/[\s,]/u.test(source[cursor])) { cursor += 1; continue; }
    TOKEN.lastIndex = cursor;
    const match = TOKEN.exec(source);
    if (!match) throw new SyntaxError(`Некорректный символ SVG path в позиции ${cursor}`);
    tokens.push(match[1] ? { command: match[1] } : { value: Number(match[2]) });
    cursor = TOKEN.lastIndex;
  }
  const result: PathCommand[] = [];
  let index = 0, current = { x: 0, y: 0 }, subpath = { x: 0, y: 0 };
  let previousCommand = '', lastCubic: Point2 | null = null, lastQuadratic: Point2 | null = null;
  const hasNumber = () => index < tokens.length && tokens[index].value !== undefined;
  const read = () => {
    if (!hasNumber()) throw new SyntaxError('SVG path: ожидалось числовое значение');
    return finite(tokens[index++].value as number, 'координата path');
  };
  const point = (relative: boolean): Point2 => {
    const x = read(), y = read();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  let command = '';
  while (index < tokens.length) {
    if (tokens[index].command) command = tokens[index++].command as string;
    else if (!command) throw new SyntaxError('SVG path: команда отсутствует');
    const relative = command === command.toLowerCase(), op = command.toUpperCase();
    if (op === 'Z') {
      result.push({ type: 'close' }); current = { ...subpath }; lastCubic = lastQuadratic = null; previousCommand = op; command = ''; continue;
    }
    if (op === 'M' || op === 'L' || op === 'T') {
      let first = true;
      do {
        const end = point(relative);
        if (op === 'M' && first) { result.push({ type: 'move', point: end }); subpath = { ...end }; command = relative ? 'l' : 'L'; }
        else if (op === 'T') {
          const control: Point2 = previousCommand === 'Q' || previousCommand === 'T'
            ? { x: current.x * 2 - (lastQuadratic?.x ?? current.x), y: current.y * 2 - (lastQuadratic?.y ?? current.y) } : { ...current };
          result.push({ type: 'quadratic', control, point: end }); lastQuadratic = control;
        } else result.push({ type: 'line', point: end });
        current = end; lastCubic = null; if (op !== 'T') lastQuadratic = null;
        previousCommand = op === 'M' ? (first ? 'M' : 'L') : op;
        first = false;
      } while (hasNumber());
    } else if (op === 'H' || op === 'V') {
      do {
        const value = read(), end = op === 'H' ? { x: relative ? current.x + value : value, y: current.y }
          : { x: current.x, y: relative ? current.y + value : value };
        result.push({ type: 'line', point: end }); current = end; previousCommand = op; lastCubic = lastQuadratic = null;
      } while (hasNumber());
    } else if (op === 'C' || op === 'S') {
      do {
        let control1: Point2, control2: Point2, end: Point2;
        if (op === 'C') { control1 = point(relative); control2 = point(relative); end = point(relative); }
        else {
          control1 = previousCommand === 'C' || previousCommand === 'S'
            ? { x: current.x * 2 - (lastCubic?.x ?? current.x), y: current.y * 2 - (lastCubic?.y ?? current.y) } : { ...current };
          control2 = point(relative); end = point(relative);
        }
        result.push({ type: 'cubic', control1, control2, point: end }); current = end; lastCubic = control2; lastQuadratic = null; previousCommand = op;
      } while (hasNumber());
    } else if (op === 'Q') {
      do {
        const control = point(relative), end = point(relative);
        result.push({ type: 'quadratic', control, point: end }); current = end; lastQuadratic = control; lastCubic = null; previousCommand = op;
      } while (hasNumber());
    } else if (op === 'A') {
      do {
        const radiusX = read(), radiusY = read(), rotation = read(), large = read(), sweep = read();
        if ((large !== 0 && large !== 1) || (sweep !== 0 && sweep !== 1)) throw new SyntaxError('Флаги SVG-дуги должны быть 0 или 1');
        const end = point(relative);
        result.push({ type: 'arc', radiusX, radiusY, rotation, largeArc: large === 1, sweep: sweep === 1, point: end });
        current = end; lastCubic = lastQuadratic = null; previousCommand = op;
      } while (hasNumber());
    } else throw new SyntaxError(`Неподдерживаемая команда SVG path: ${command}`);
  }
  return result;
}

function formatNumber(value: number): string {
  finite(value, 'координата path');
  const rounded = Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(12));
  return String(rounded);
}
export function serializeSvgPath(path: GeometryPath): string {
  return path.map((command) => {
    if (command.type === 'close') return 'Z';
    if (command.type === 'move') return `M${formatNumber(command.point.x)} ${formatNumber(command.point.y)}`;
    if (command.type === 'line') return `L${formatNumber(command.point.x)} ${formatNumber(command.point.y)}`;
    if (command.type === 'quadratic') return `Q${formatNumber(command.control.x)} ${formatNumber(command.control.y)} ${formatNumber(command.point.x)} ${formatNumber(command.point.y)}`;
    if (command.type === 'cubic') return `C${formatNumber(command.control1.x)} ${formatNumber(command.control1.y)} ${formatNumber(command.control2.x)} ${formatNumber(command.control2.y)} ${formatNumber(command.point.x)} ${formatNumber(command.point.y)}`;
    if (command.type === 'arc') {
    return `A${formatNumber(command.radiusX)} ${formatNumber(command.radiusY)} ${formatNumber(command.rotation)} ${command.largeArc ? 1 : 0} ${command.sweep ? 1 : 0} ${formatNumber(command.point.x)} ${formatNumber(command.point.y)}`;
    }
    throw new TypeError('Неизвестная команда геометрического пути');
  }).join(' ');
}
function flattenPathSegments(path: GeometryPath, tolerance: number, closeForFill = false, closedFlags?: boolean[]): Point2[][] {
  validTolerance(tolerance);
  const subpaths: Point2[][] = [];
  let points: Point2[] = [], current: Point2 | null = null, origin: Point2 | null = null;
  const flush = (close = false) => {
    if (close && points.length > 1 && !samePoint(points[0], points[points.length - 1])) points.push({ ...points[0] });
    if (points.length) { subpaths.push(points); closedFlags?.push(close); }
    points = []; current = origin = null;
  };
  for (const command of path) {
    if (command.type === 'move') { flush(); current = origin = validPoint(command.point); points.push(current); continue; }
    if (!current) {
      if (command.type === 'close') continue;
      throw new SyntaxError('SVG path рисует до начальной команды M');
    }
    if (command.type === 'line') { current = validPoint(command.point); points.push(current); }
    else if (command.type === 'quadratic') {
      const curve: QuadraticBezier2 = { start: current, control: validPoint(command.control), end: validPoint(command.point) };
      points.push(...flattenQuadratic(curve, tolerance).slice(1)); current = curve.end;
    } else if (command.type === 'cubic') {
      const curve: CubicBezier2 = { start: current, control1: validPoint(command.control1), control2: validPoint(command.control2), end: validPoint(command.point) };
      points.push(...flattenCubic(curve, tolerance).slice(1)); current = curve.end;
    } else if (command.type === 'arc') {
      const arc: EllipseArc2 = { start: current, end: validPoint(command.point), radiusX: command.radiusX, radiusY: command.radiusY,
        rotation: command.rotation, largeArc: command.largeArc, sweep: command.sweep };
      points.push(...flattenEllipseArc(arc, tolerance).slice(1)); current = arc.end;
    } else {
      if (points.length > 1 && origin && !samePoint(points[0], points[points.length - 1])) points.push({ ...origin });
      if (points.length) { subpaths.push(points); closedFlags?.push(true); }
      points = origin ? [{ ...origin }] : [];
      current = origin ? { ...origin } : null;
    }
  }
  if (closeForFill && points.length > 1 && origin && !samePoint(points[0], points[points.length - 1])) points.push({ ...origin });
  if (points.length) { subpaths.push(points); closedFlags?.push(closeForFill); }
  return subpaths;
}
export function transformPath(path: GeometryPath, matrix: Affine2, tolerance: number): PathCommand[] {
  validTolerance(tolerance);
  validAffine(matrix);
  const aa = matrix.a * matrix.a + matrix.b * matrix.b;
  const bb = matrix.c * matrix.c + matrix.d * matrix.d;
  const ab = matrix.a * matrix.c + matrix.b * matrix.d;
  const maxScale = Math.sqrt(Math.max(0, (aa + bb + Math.sqrt((aa - bb) ** 2 + 4 * ab * ab)) / 2));
  const sourceTolerance = maxScale > 0 ? tolerance / maxScale : tolerance;
  const result: PathCommand[] = [];
  let current: Point2 | null = null, origin: Point2 | null = null;
  for (const command of path) {
    if (command.type === 'move') { current = command.point; origin = command.point; result.push({ type: 'move', point: affine.apply(matrix, command.point) }); }
    else if (command.type === 'line') { current = command.point; result.push({ type: 'line', point: affine.apply(matrix, command.point) }); }
    else if (command.type === 'quadratic') {
      result.push({ type: 'quadratic', control: affine.apply(matrix, command.control), point: affine.apply(matrix, command.point) }); current = command.point;
    } else if (command.type === 'cubic') {
      result.push({ type: 'cubic', control1: affine.apply(matrix, command.control1), control2: affine.apply(matrix, command.control2), point: affine.apply(matrix, command.point) }); current = command.point;
    } else if (command.type === 'arc') {
      if (!current) throw new SyntaxError('Дуга path не имеет начальной точки');
      const points = flattenEllipseArc({ start: current, end: command.point, radiusX: command.radiusX, radiusY: command.radiusY,
        rotation: command.rotation, largeArc: command.largeArc, sweep: command.sweep }, sourceTolerance);
      result.push(...points.slice(1).map((point) => ({ type: 'line' as const, point: affine.apply(matrix, point) })));
      current = command.point;
    } else { result.push({ type: 'close' }); current = origin; }
  }
  return result;
}
export function pathLength(path: GeometryPath, tolerance: number): number {
  const parts = flattenPathSegments(path, tolerance);
  return parts.reduce((sum, points) => sum + polylineLength(points), 0);
}
export function pathBounds(path: GeometryPath, tolerance: number): Bounds2 {
  return boundsOfPoints(flattenPathSegments(path, tolerance).flat());
}
export function pathIntersections(first: GeometryPath, second: GeometryPath, tolerance: number): Point2[] {
  const a = flattenPathSegments(first, tolerance), b = flattenPathSegments(second, tolerance), result: Point2[] = [];
  for (const left of a) for (const right of b) {
    for (const hit of polylineIntersections(left, right)) if (!result.some((point) => samePoint(point, hit, tolerance))) result.push(hit);
  }
  return result;
}
export function pointInRing(point: Point2, ring: readonly Point2[]): boolean {
  const p = validPoint(point);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (distanceToSegment(p, { start: a, end: b }) <= 1e-10) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function ringSignedArea(ring: readonly Point2[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) area += cross(ring[i], ring[(i + 1) % ring.length]);
  return area / 2;
}
function interiorPoint(ring: Ring2): Point2 {
  const ys = [...new Set(ring.map(({ y }) => y))].sort((a, b) => a - b);
  for (let index = 1; index < ys.length; index += 1) {
    if (ys[index] - ys[index - 1] <= EPSILON) continue;
    const y = (ys[index] + ys[index - 1]) / 2, crossings: number[] = [];
    for (let edge = 0; edge < ring.length; edge += 1) {
      const a = ring[edge], b = ring[(edge + 1) % ring.length];
      if ((a.y > y) === (b.y > y)) continue;
      crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    crossings.sort((a, b) => a - b);
    for (let crossing = 1; crossing < crossings.length; crossing += 2) {
      const candidate = { x: (crossings[crossing - 1] + crossings[crossing]) / 2, y };
      if (pointInRing(candidate, ring)) return candidate;
    }
  }
  throw new RangeError('Не удалось найти внутреннюю точку простого контура');
}
function asPolygonCoordinate(ring: Ring2): polygonClipping.Ring {
  return [...ring, ring[0]].map(({ x, y }) => [x, y]);
}
function fromPolygonCoordinate(multi: polygonClipping.MultiPolygon): MultiPolygon2 {
  return multi.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))));
}
function clipMany(
  operation: 'union' | 'intersection' | 'xor',
  geometries: polygonClipping.Geom[],
): polygonClipping.MultiPolygon {
  if (!geometries.length) return [];
  const [first, ...rest] = geometries;
  if (operation === 'union') return polygonClipping.union(first, ...rest);
  if (operation === 'intersection') return polygonClipping.intersection(first, ...rest);
  return polygonClipping.xor(first, ...rest);
}
function cleanRing(points: readonly Point2[]): Ring2 {
  const cleaned: Ring2 = [];
  for (const raw of points) {
    const point = validPoint(raw, 'вершина кольца');
    if (!cleaned.length || !samePoint(cleaned[cleaned.length - 1], point, 1e-10)) cleaned.push(point);
  }
  if (cleaned.length > 1 && samePoint(cleaned[0], cleaned[cleaned.length - 1], 1e-10)) cleaned.pop();
  return cleaned.length >= 3 ? cleaned : [];
}
export function pathToPolygons(path: GeometryPath, tolerance: number, fillRule: FillRule = 'nonzero'): MultiPolygon2 {
  const rings = flattenPathSegments(path, tolerance, true).map(cleanRing).filter((ring) => ring.length >= 3 && Math.abs(ringSignedArea(ring)) > 1e-12);
  if (!rings.length) return [];
  const geometries = rings.map((ring) => [[asPolygonCoordinate(ring)]]);
  if (fillRule === 'evenodd') return fromPolygonCoordinate(clipMany('xor', geometries));
  const ordered = rings.map((ring) => ({
    ring,
    geometry: [[asPolygonCoordinate(ring)]] as polygonClipping.MultiPolygon,
    area: ringSignedArea(ring),
    sample: interiorPoint(ring),
  })).sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const processed: typeof ordered = [];
  let filled: polygonClipping.MultiPolygon = [];
  for (const contour of ordered) {
    const outsideWinding = processed.reduce((sum, parent) =>
      pointInRing(contour.sample, parent.ring) ? sum + Math.sign(parent.area) : sum, 0);
    const insideWinding = outsideWinding + Math.sign(contour.area);
    if (outsideWinding === 0 && insideWinding !== 0) {
      filled = filled.length ? clipMany('union', [filled, contour.geometry]) : contour.geometry;
    } else if (outsideWinding !== 0 && insideWinding === 0 && filled.length) {
      filled = polygonClipping.difference(filled, contour.geometry);
    }
    processed.push(contour);
  }
  return fromPolygonCoordinate(filled);
}
export type PolygonBooleanOperation = 'union' | 'intersection' | 'difference' | 'xor';
export function booleanPolygons(operation: PolygonBooleanOperation, ...inputs: readonly MultiPolygon2[]): MultiPolygon2 {
  if (!inputs.length) return [];
  const geometries = inputs.map((multi) => multi.map((polygon) => polygon.map((ring) => asPolygonCoordinate(cleanRing(ring)))));
  if (operation === 'union') return fromPolygonCoordinate(clipMany('union', geometries));
  if (operation === 'intersection') return fromPolygonCoordinate(clipMany('intersection', geometries));
  if (operation === 'xor') return fromPolygonCoordinate(clipMany('xor', geometries));
  if (geometries.length === 1) return fromPolygonCoordinate(geometries[0]);
  return fromPolygonCoordinate(polygonClipping.difference(geometries[0], ...geometries.slice(1)));
}
function unionPolygonParts(parts: readonly MultiPolygon2[]): MultiPolygon2 {
  let level = parts.filter((part) => part.length > 0);
  while (level.length > 1) {
    const next: MultiPolygon2[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const merged = index + 1 < level.length
        ? booleanPolygons('union', level[index], level[index + 1])
        : level[index];
      if (merged.length) next.push(merged);
    }
    level = next;
  }
  return level[0] ?? [];
}
export function clipPath(subject: GeometryPath, clip: GeometryPath, tolerance: number, fillRule: FillRule = 'nonzero'): MultiPolygon2 {
  return booleanPolygons('intersection', pathToPolygons(subject, tolerance, fillRule), pathToPolygons(clip, tolerance, fillRule));
}
function strokePolylineParts(points: readonly Point2[], width: number, tolerance: number, cap: StrokeCap = 'butt',
  join: StrokeJoin = 'miter', miterLimit = 4, closed = false): MultiPolygon2[] {
  validTolerance(tolerance);
  const half = finite(width, 'толщина штриха') / 2;
  if (half < 0 || !Number.isFinite(miterLimit) || miterLimit < 1) throw new RangeError('Недопустимая толщина или предел скоса');
  if (half === 0 || points.length < 2) return [];
  const source: Point2[] = [];
  for (const raw of points) {
    const point = validPoint(raw);
    if (!source.length || !samePoint(source[source.length - 1], point)) source.push(point);
  }
  if (closed && source.length > 1 && samePoint(source[0], source[source.length - 1])) source.pop();
  if (source.length < 2) return [];
  const lineCount = source.length - 1 + (closed ? 1 : 0);
  const parts: MultiPolygon2[] = [];
  const addRing = (ring: Ring2) => {
    if (Math.abs(ringSignedArea(ring)) > EPSILON) parts.push([[ring]]);
  };
  const disk = (center: Point2) => {
    const angle = Math.acos(Math.max(-1, 1 - tolerance / half));
    const count = Math.max(8, Math.ceil(Math.PI / angle));
    if (!Number.isFinite(count) || count > MAX_FLATTENED_POINTS) throw new RangeError('Круглый штрих превышает предел точек при заданном допуске');
    const ring = Array.from({ length: count }, (_, index) => ({ x: center.x + half * Math.cos(index * Math.PI * 2 / count),
      y: center.y + half * Math.sin(index * Math.PI * 2 / count) }));
    return [[ring]];
  };
  for (let index = 0; index < lineCount; index += 1) {
    let a = source[index], b = source[(index + 1) % source.length];
    const tangent = vector.normalize(subtract(b, a));
    if (vector.length(tangent) === 0) continue;
    if (!closed && cap === 'square') {
      if (index === 0) a = subtract(a, scale(tangent, half));
      if (index === lineCount - 1) b = add(b, scale(tangent, half));
    }
    const normal = scale(vector.perpendicular(tangent), half);
    const rect: Ring2 = [add(a, normal), add(b, normal), subtract(b, normal), subtract(a, normal)];
    addRing(rect);
    if (!closed && cap === 'round') {
      if (index === 0) parts.push(disk(source[0]));
      if (index === lineCount - 1) parts.push(disk(source[source.length - 1]));
    }
  }
  const firstJoin = closed ? 0 : 1, lastJoin = closed ? source.length : source.length - 1;
  for (let index = firstJoin; index < lastJoin; index += 1) {
    const point = source[index], before = source[(index - 1 + source.length) % source.length], after = source[(index + 1) % source.length];
    const first = vector.normalize(subtract(point, before)), second = vector.normalize(subtract(after, point));
    if (vector.length(first) === 0 || vector.length(second) === 0) continue;
    if (join === 'round') { parts.push(disk(point)); continue; }
    for (const side of [-1, 1]) {
      const n1 = scale(vector.perpendicular(first), half * side), n2 = scale(vector.perpendicular(second), half * side);
      const p1 = add(point, n1), p2 = add(point, n2);
      const denominator = cross(first, second);
      if (Math.abs(denominator) < EPSILON) continue;
      const t = cross(subtract(p2, p1), second) / denominator;
      const miter = add(p1, scale(first, t));
      const useMiter = join === 'miter' && vector.distance(point, miter) <= half * miterLimit;
      addRing([p1, useMiter ? miter : point, p2]);
    }
  }
  return parts;
}
/** Строит исходные полигоны штриха без их топологического объединения. */
export function strokePolylineComponents(points: readonly Point2[], width: number, tolerance: number, cap: StrokeCap = 'butt',
  join: StrokeJoin = 'miter', miterLimit = 4, closed = false): MultiPolygon2 {
  return strokePolylineParts(points, width, tolerance, cap, join, miterLimit, closed).flatMap((part) => part);
}
export function strokePolyline(points: readonly Point2[], width: number, tolerance: number, cap: StrokeCap = 'butt',
  join: StrokeJoin = 'miter', miterLimit = 4, closed = false): MultiPolygon2 {
  return unionPolygonParts(strokePolylineParts(points, width, tolerance, cap, join, miterLimit, closed));
}
export function strokePath(path: GeometryPath, width: number, tolerance: number, cap: StrokeCap = 'butt',
  join: StrokeJoin = 'miter', miterLimit = 4): MultiPolygon2 {
  const closedFlags: boolean[] = [];
  const parts = flattenPathSegments(path, tolerance, false, closedFlags);
  return parts.flatMap((points, index) => {
    const closed = closedFlags[index] ?? false;
    const vertices = closed && points.length > 1 && samePoint(points[0], points[points.length - 1])
      ? points.slice(0, -1) : points;
    return strokePolyline(vertices, width, tolerance, cap, join, miterLimit, closed);
  });
}

export interface SpatialEntry<T> {
  id: string | number;
  value: T;
  bounds: Bounds2;
  distanceToPoint(point: Point2): number;
  closestPointToPoint?(point: Point2): Point2;
}
export interface NearestResult<T> { id: string | number; value: T; distance: number; point: Point2 }
/** Динамическая равномерная сетка с точным пересчётом расстояния и выборкой кандидатов по границам. */
export class DynamicSpatialIndex<T> {
  private readonly entries = new Map<string | number, SpatialEntry<T>>();
  private readonly cells = new Map<string, Set<string | number>>();
  private readonly oversized = new Set<string | number>();
  private minCellX = Infinity;
  private minCellY = Infinity;
  private maxCellX = -Infinity;
  private maxCellY = -Infinity;
  private revisionValue = 0;
  constructor(readonly cellSize = 64) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Размер ячейки индекса должен быть больше нуля');
  }
  get revision(): number { return this.revisionValue; }
  get size(): number { return this.entries.size; }
  insert(entry: SpatialEntry<T>): void {
    if (this.entries.has(entry.id)) throw new Error(`Индекс уже содержит объект ${entry.id}`);
    this.validateEntry(entry); this.entries.set(entry.id, entry); this.addToCells(entry); this.revisionValue += 1;
  }
  update(entry: SpatialEntry<T>): void {
    this.validateEntry(entry);
    const old = this.entries.get(entry.id);
    if (old) this.removeFromCells(old);
    this.entries.set(entry.id, entry); this.addToCells(entry); this.revisionValue += 1;
  }
  remove(id: string | number): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.removeFromCells(entry); this.entries.delete(id); this.revisionValue += 1; return true;
  }
  get(id: string | number): SpatialEntry<T> | undefined { return this.entries.get(id); }
  query(bounds: Bounds2): SpatialEntry<T>[] {
    const valid = validBounds(bounds), ids = this.idsInBounds(valid);
    for (const id of this.oversized) ids.add(id);
    return [...ids].map((id) => this.entries.get(id)!).filter((entry) => boundsIntersect(entry.bounds, valid));
  }
  nearest(point: Point2): NearestResult<T> | null {
    const p = validPoint(point);
    if (!this.entries.size) return null;
    let best: NearestResult<T> | null = null;
    let bestDistance = Infinity;
    const visited = new Set<string | number>();
    const scan = (id: string | number) => {
      if (visited.has(id)) return;
      visited.add(id);
      const entry = this.entries.get(id);
      if (!entry) return;
      const distance = entry.distanceToPoint(p);
      if (!Number.isFinite(distance) || distance < 0) throw new RangeError(`Объект ${entry.id} вернул недопустимое расстояние`);
      if (!best || distance < bestDistance || (distance === bestDistance && idBefore(entry.id, best.id))) {
        best = { id: entry.id, value: entry.value, distance,
          point: entry.closestPointToPoint?.(p) ?? closestPointForEntry(entry, p) };
        bestDistance = distance;
      }
    };
    for (const id of this.oversized) scan(id);
    const cx = Math.floor(p.x / this.cellSize), cy = Math.floor(p.y / this.cellSize);
    const maxRing = Math.max(Math.abs(cx - this.minCellX), Math.abs(cx - this.maxCellX),
      Math.abs(cy - this.minCellY), Math.abs(cy - this.maxCellY));
    for (let ring = 0; ring <= maxRing; ring += 1) {
      if (ring === 0) {
        for (const id of this.cells.get(this.key(cx, cy)) ?? []) scan(id);
      } else {
        for (let dx = -ring; dx <= ring; dx += 1) {
          for (const dy of [-ring, ring]) for (const id of this.cells.get(this.key(cx + dx, cy + dy)) ?? []) scan(id);
        }
        for (let dy = -ring + 1; dy < ring; dy += 1) {
          for (const dx of [-ring, ring]) for (const id of this.cells.get(this.key(cx + dx, cy + dy)) ?? []) scan(id);
        }
      }
      const lowX = (cx - ring) * this.cellSize, highX = (cx + ring + 1) * this.cellSize;
      const lowY = (cy - ring) * this.cellSize, highY = (cy + ring + 1) * this.cellSize;
      const unseenLowerBound = Math.min(p.x - lowX, highX - p.x, p.y - lowY, highY - p.y);
      if (bestDistance < unseenLowerBound) break;
    }
    return best;
  }
  nearestPoint(point: Point2, points: readonly { id: string | number; point: Point2; value: T }[]): NearestResult<T> | null {
    const p = validPoint(point);
    let best: NearestResult<T> | null = null;
    for (const candidate of points) {
      const target = validPoint(candidate.point), distance = vector.distance(p, target);
      if (!best || distance < best.distance || (distance === best.distance && idBefore(candidate.id, best.id))) {
        best = { id: candidate.id, value: candidate.value, distance, point: target };
      }
    }
    return best;
  }
  distanceToMany(point: Point2, ids?: readonly (string | number)[]): number {
    const p = validPoint(point), candidates = ids ? ids.map((id) => this.entries.get(id)).filter(Boolean) as SpatialEntry<T>[] : [...this.entries.values()];
    return candidates.reduce((nearest, entry) => Math.min(nearest, entry.distanceToPoint(p)), Infinity);
  }
  distanceToBounds(point: Point2, bounds: Bounds2): number { return boundsDistance(bounds, validPoint(point)); }
  sphereCandidates(center: Point2, radius: number): SpatialEntry<T>[] {
    const bounds = boundsOfCircle({ center: validPoint(center), radius });
    return this.query(bounds).filter((entry) => entry.distanceToPoint(center) <= radius);
  }
  private validateEntry(entry: SpatialEntry<T>): void {
    if (!entry || typeof entry.id !== 'string' && typeof entry.id !== 'number' ||
        typeof entry.distanceToPoint !== 'function') throw new TypeError('Недопустимая запись пространственного индекса');
    const b = entry.bounds;
    if (![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite) || b.minX > b.maxX || b.minY > b.maxY) {
      throw new RangeError('Границы пространственного объекта некорректны');
    }
  }
  private cellRange(bounds: Bounds2): [number, number, number, number] {
    return [Math.floor(bounds.minX / this.cellSize), Math.floor(bounds.minY / this.cellSize),
      Math.floor(bounds.maxX / this.cellSize), Math.floor(bounds.maxY / this.cellSize)];
  }
  private key(x: number, y: number): string { return `${x},${y}`; }
  private idsInBounds(bounds: Bounds2): Set<string | number> {
    const [x0, y0, x1, y1] = this.cellRange(bounds), ids = new Set<string | number>();
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (count > 1_000_000) return new Set(this.entries.keys());
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      for (const id of this.cells.get(this.key(x, y)) ?? []) ids.add(id);
    }
    return ids;
  }
  private addToCells(entry: SpatialEntry<T>): void {
    const [x0, y0, x1, y1] = this.cellRange(entry.bounds);
    this.minCellX = Math.min(this.minCellX, x0); this.minCellY = Math.min(this.minCellY, y0);
    this.maxCellX = Math.max(this.maxCellX, x1); this.maxCellY = Math.max(this.maxCellY, y1);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 100_000) { this.oversized.add(entry.id); return; }
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const key = this.key(x, y), bucket = this.cells.get(key) ?? new Set<string | number>();
      bucket.add(entry.id); this.cells.set(key, bucket);
    }
  }
  private removeFromCells(entry: SpatialEntry<T>): void {
    const [x0, y0, x1, y1] = this.cellRange(entry.bounds);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 100_000) { this.oversized.delete(entry.id); return; }
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const key = this.key(x, y), bucket = this.cells.get(key);
      bucket?.delete(entry.id); if (!bucket?.size) this.cells.delete(key);
    }
  }
}
function idBefore(a: string | number, b: string | number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  return String(a) < String(b);
}
function closestPointForEntry<T>(entry: SpatialEntry<T>, point: Point2): Point2 {
  return { x: Math.max(entry.bounds.minX, Math.min(entry.bounds.maxX, point.x)),
    y: Math.max(entry.bounds.minY, Math.min(entry.bounds.maxY, point.y)) };
}
export function circleSpatialEntry<T>(id: string | number, value: T, circle: Circle2): SpatialEntry<T> {
  const bounds = boundsOfCircle(circle), center = validPoint(circle.center), radius = circle.radius;
  return {
    id, value, bounds,
    distanceToPoint(point) { return Math.max(0, vector.distance(point, center) - radius); },
    closestPointToPoint(point) {
      const dx = point.x - center.x, dy = point.y - center.y, distance = Math.hypot(dx, dy);
      if (distance <= radius || distance === 0) return { ...point };
      return { x: center.x + dx * radius / distance, y: center.y + dy * radius / distance };
    },
  };
}
export function polylineSpatialEntry<T>(id: string | number, value: T, points: readonly Point2[]): SpatialEntry<T> {
  const vertices = points.map((point) => validPoint(point)), bounds = boundsOfPoints(vertices);
  return { id, value, bounds, distanceToPoint(point) {
    const nearest = closestPointOnPolyline(point, vertices);
    return nearest ? vector.distance(point, nearest) : Infinity;
  }, closestPointToPoint(point) { return closestPointOnPolyline(point, vertices) ?? { ...point }; } };
}

/** Универсальная длина растрового пути с весом шага, заданным вызывающей стороной. */
export function gridPathDistance(from: Point2, to: Point2, stepWeight: (x: number, y: number) => number): number {
  const start = validPoint(from), end = validPoint(to);
  const distance = vector.distance(start, end), steps = Math.max(1, Math.ceil(distance)), step = distance / steps;
  let total = 0;
  for (let index = 1; index <= steps; index += 1) {
    const x = Math.round(start.x + (end.x - start.x) * index / steps);
    const y = Math.round(start.y + (end.y - start.y) * index / steps);
    const weight = finite(stepWeight(x, y), 'вес шага');
    if (weight < 0) throw new RangeError('Вес шага не может быть отрицательным');
    total += step * weight;
  }
  return total;
}

