import type { KernelPathData, KernelPolygonData } from './bindings/contracts';
import { getBinaryMathKernel } from './runtime';

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
export interface CubicBezier2 {
  start: Point2;
  control1: Point2;
  control2: Point2;
  end: Point2;
}
export interface ArcCenter {
  center: Point2;
  radiusX: number;
  radiusY: number;
  rotation: number;
  startAngle: number;
  deltaAngle: number;
}
export type PathCommand =
  | { type: 'move' | 'line'; point: Point2 }
  | { type: 'quadratic'; control: Point2; point: Point2 }
  | { type: 'cubic'; control1: Point2; control2: Point2; point: Point2 }
  | {
      type: 'arc';
      radiusX: number;
      radiusY: number;
      rotation: number;
      largeArc: boolean;
      sweep: boolean;
      point: Point2;
    }
  | { type: 'close' };
export type GeometryPath = readonly PathCommand[];
export type Ring2 = Point2[];
export type Polygon2 = Ring2[];
export type MultiPolygon2 = Polygon2[];
export type FillRule = 'evenodd' | 'nonzero';
export type PolygonBooleanOperation = 'union' | 'intersection' | 'difference' | 'xor';
export type StrokeCap = 'butt' | 'square' | 'round';
export type StrokeJoin = 'miter' | 'bevel' | 'round';

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} должен быть конечным числом`);
  return value;
}

function validPoint(value: Point2, name = 'точка'): Point2 {
  if (!value || typeof value !== 'object') throw new TypeError(`${name} не задана`);
  return { x: finite(value.x, `${name}.x`), y: finite(value.y, `${name}.y`) };
}

function validBounds(value: Bounds2): Bounds2 {
  if (!value || ![value.minX, value.minY, value.maxX, value.maxY].every(Number.isFinite) ||
      value.minX > value.maxX || value.minY > value.maxY) {
    throw new RangeError('Границы геометрии некорректны');
  }
  return value;
}

function validTolerance(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Допуск должен быть конечным числом больше нуля');
  }
  return value;
}

function pointValues(point: Point2): number[] {
  const value = validPoint(point);
  return [value.x, value.y];
}

function affineValues(matrix: Affine2): number[] {
  if (!matrix || ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
    .every(Number.isFinite)) {
    throw new TypeError('Матрица должна содержать конечные числа');
  }
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
}

function primitive(
  operation: Parameters<ReturnType<typeof getBinaryMathKernel>['geometryPrimitiveExecute']>[0],
  input: number[],
): Float64Array {
  return getBinaryMathKernel().geometryPrimitiveExecute(
    operation,
    new Float64Array(input),
  );
}

function scalar(
  operation: Parameters<ReturnType<typeof getBinaryMathKernel>['geometryPrimitiveExecute']>[0],
  input: number[],
): number {
  const result = primitive(operation, input);
  if (result.length !== 1) throw new Error('Бинарное ядро вернуло неверный размер результата');
  return result[0];
}

function pointResult(values: Float64Array): Point2 {
  if (values.length !== 2) throw new Error('Бинарное ядро вернуло неверный размер точки');
  return { x: values[0], y: values[1] };
}

function vectorScalar(
  operation: Parameters<ReturnType<typeof getBinaryMathKernel>['vectorExecute']>[0],
  input: number[],
): number {
  const result = getBinaryMathKernel().vectorExecute(operation, new Float64Array(input));
  if (result.length !== 1) throw new Error('Бинарное ядро вернуло неверный размер скаляра');
  return result[0];
}

function affineResult(
  operation: Parameters<ReturnType<typeof getBinaryMathKernel>['affineExecute']>[0],
  input: number[],
): Affine2 {
  const result = getBinaryMathKernel().affineExecute(operation, new Float64Array(input));
  if (result.length !== 6) throw new Error('Бинарное ядро вернуло неверную матрицу');
  return {
    a: result[0], b: result[1], c: result[2],
    d: result[3], e: result[4], f: result[5],
  };
}

export const vector = {
  create(x: number, y: number): Point2 {
    return { x: finite(x, 'x'), y: finite(y, 'y') };
  },
  add(a: Point2, b: Point2): Point2 {
    return pointResult(getBinaryMathKernel().vectorExecute(
      'add', new Float64Array([...pointValues(a), ...pointValues(b)]),
    ));
  },
  subtract(a: Point2, b: Point2): Point2 {
    return pointResult(getBinaryMathKernel().vectorExecute(
      'subtract', new Float64Array([...pointValues(a), ...pointValues(b)]),
    ));
  },
  scale(point: Point2, factor: number): Point2 {
    return pointResult(getBinaryMathKernel().vectorExecute(
      'scale', new Float64Array([...pointValues(point), finite(factor, 'множитель')]),
    ));
  },
  dot(a: Point2, b: Point2): number {
    return vectorScalar('dot', [...pointValues(a), ...pointValues(b)]);
  },
  cross(a: Point2, b: Point2): number {
    return vectorScalar('cross', [...pointValues(a), ...pointValues(b)]);
  },
  length(point: Point2): number {
    return vectorScalar('length', pointValues(point));
  },
  distance(a: Point2, b: Point2): number {
    return vectorScalar('distance', [...pointValues(a), ...pointValues(b)]);
  },
  normalize(point: Point2): Point2 {
    return pointResult(getBinaryMathKernel().vectorExecute(
      'normalize', new Float64Array(pointValues(point)),
    ));
  },
  perpendicular(point: Point2): Point2 {
    return pointResult(getBinaryMathKernel().vectorExecute(
      'perpendicular', new Float64Array(pointValues(point)),
    ));
  },
  lerp(a: Point2, b: Point2, t: number): Point2 {
    return pointResult(getBinaryMathKernel().vectorExecute(
      'lerp',
      new Float64Array([...pointValues(a), ...pointValues(b), finite(t, 'параметр')]),
    ));
  },
};

export const affine = {
  identity(): Affine2 { return affineResult('identity', []); },
  create(a: number, b: number, c: number, d: number, e: number, f: number): Affine2 {
    return affineResult('create', [a, b, c, d, e, f].map((value, index) =>
      finite(value, ['a', 'b', 'c', 'd', 'e', 'f'][index])));
  },
  translation(x: number, y: number): Affine2 {
    return affineResult('translation', [finite(x, 'x'), finite(y, 'y')]);
  },
  scaling(x: number, y = x): Affine2 {
    return affineResult('scaling', [finite(x, 'x'), finite(y, 'y')]);
  },
  rotation(radians: number): Affine2 {
    return affineResult('rotation', [finite(radians, 'угол')]);
  },
  multiply(left: Affine2, right: Affine2): Affine2 {
    return affineResult('multiply', [...affineValues(left), ...affineValues(right)]);
  },
  invert(matrix: Affine2): Affine2 {
    try {
      return affineResult('invert', affineValues(matrix));
    } catch (error) {
      if (error instanceof Error && error.message.includes('INVALID_ARGUMENT')) {
        throw new RangeError('Матрица вырождена');
      }
      throw error;
    }
  },
  apply(matrix: Affine2, point: Point2): Point2 {
    return pointResult(getBinaryMathKernel().affineExecute(
      'apply', new Float64Array([...affineValues(matrix), ...pointValues(point)]),
    ));
  },
};

export function boundsOfPoints(points: readonly Point2[]): Bounds2 {
  if (!points.length) throw new RangeError('Нельзя определить границы пустого набора точек');
  const result = primitive('boundsOfPoints', points.flatMap(pointValues));
  return { minX: result[0], minY: result[1], maxX: result[2], maxY: result[3] };
}

export function boundsDistance(bounds: Bounds2, point: Point2): number {
  const b = validBounds(bounds);
  const p = validPoint(point);
  return scalar('boundsDistance', [b.minX, b.minY, b.maxX, b.maxY, p.x, p.y]);
}

export function boundsIntersect(first: Bounds2, second: Bounds2): boolean {
  const a = validBounds(first);
  const b = validBounds(second);
  return scalar('boundsIntersect', [
    a.minX, a.minY, a.maxX, a.maxY, b.minX, b.minY, b.maxX, b.maxY,
  ]) !== 0;
}

export function boundsOfCircle(circle: Circle2): Bounds2 {
  const center = validPoint(circle.center);
  const radius = finite(circle.radius, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  const result = primitive('boundsCircle', [center.x, center.y, radius]);
  return { minX: result[0], minY: result[1], maxX: result[2], maxY: result[3] };
}

export function circlePoints(
  centerInput: Point2,
  radiusInput: number,
  samples = 96,
  startAngleDegrees = 0,
): Point2[] {
  const center = validPoint(centerInput);
  const radius = finite(radiusInput, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  if (!Number.isSafeInteger(samples) || samples < 3 || samples > 4096) {
    throw new RangeError('Число точек окружности должно быть целым от 3 до 4096');
  }
  const values = primitive('circlePoints', [
    center.x,
    center.y,
    radius,
    samples,
    finite(startAngleDegrees, 'начальный угол'),
  ]);
  if (values.length !== samples * 2) {
    throw new Error('Бинарное ядро вернуло неверное число точек окружности');
  }
  return Array.from({ length: samples }, (_, index) => ({
    x: values[index * 2],
    y: values[index * 2 + 1],
  }));
}

export function clipPolygonToRect(
  polygon: readonly Point2[],
  bounds: Bounds2,
): Point2[] {
  const rectangle = validBounds(bounds);
  if (polygon.length < 3) return [];
  const values = primitive('clipPolygonRect', [
    rectangle.minX,
    rectangle.minY,
    rectangle.maxX,
    rectangle.maxY,
    polygon.length,
    ...polygon.flatMap((point) => pointValues(point)),
  ]);
  if (values.length % 2 !== 0) {
    throw new Error('Бинарное ядро вернуло неверный контур после обрезки');
  }
  return Array.from({ length: values.length / 2 }, (_, index) => ({
    x: values[index * 2],
    y: values[index * 2 + 1],
  }));
}

export function closestPointOnSegment(point: Point2, segment: Segment2): Point2 {
  return pointResult(primitive('closestPointSegment', [
    ...pointValues(point), ...pointValues(segment.start), ...pointValues(segment.end),
  ]));
}

export function distanceToSegment(point: Point2, segment: Segment2): number {
  return scalar('distanceSegment', [
    ...pointValues(point), ...pointValues(segment.start), ...pointValues(segment.end),
  ]);
}

export function segmentLength(segment: Segment2): number {
  return scalar('segmentLength', [...pointValues(segment.start), ...pointValues(segment.end)]);
}

export function segmentTangent(segment: Segment2): Point2 {
  return pointResult(primitive('segmentTangent', [
    ...pointValues(segment.start), ...pointValues(segment.end),
  ]));
}

export function intersectSegments(
  first: Segment2,
  second: Segment2,
  epsilon = 1e-9,
): Point2[] {
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new RangeError('Допуск пересечения должен быть неотрицательным');
  }
  const values = primitive('intersectSegments', [
    ...pointValues(first.start), ...pointValues(first.end),
    ...pointValues(second.start), ...pointValues(second.end), epsilon,
  ]);
  return Array.from({ length: values.length / 2 }, (_, index) => ({
    x: values[index * 2], y: values[index * 2 + 1],
  }));
}

export function polylineLength(points: readonly Point2[], closed = false): number {
  return scalar('polylineLength', [
    closed ? 1 : 0,
    ...points.flatMap(pointValues),
  ]);
}

export function closestPointOnPolyline(
  point: Point2,
  points: readonly Point2[],
  closed = false,
): Point2 | null {
  const result = primitive('closestPointPolyline', [
    ...pointValues(point), closed ? 1 : 0, points.length, ...points.flatMap(pointValues),
  ]);
  return result.length ? pointResult(result) : null;
}

export function polylineIntersections(
  first: readonly Point2[],
  second: readonly Point2[],
  closedFirst = false,
  closedSecond = false,
): Point2[] {
  const values = primitive('polylineIntersections', [
    closedFirst ? 1 : 0, first.length, ...first.flatMap(pointValues),
    closedSecond ? 1 : 0, second.length, ...second.flatMap(pointValues),
  ]);
  return Array.from({ length: values.length / 2 }, (_, index) => ({
    x: values[index * 2], y: values[index * 2 + 1],
  }));
}

export function quadraticAt(curve: QuadraticBezier2, t: number): Point2 {
  return pointResult(primitive('quadraticAt', [
    ...pointValues(curve.start), ...pointValues(curve.control),
    ...pointValues(curve.end), finite(t, 'параметр'),
  ]));
}

export function cubicAt(curve: CubicBezier2, t: number): Point2 {
  return pointResult(primitive('cubicAt', [
    ...pointValues(curve.start), ...pointValues(curve.control1),
    ...pointValues(curve.control2), ...pointValues(curve.end),
    finite(t, 'параметр'),
  ]));
}

export function quadraticTangent(curve: QuadraticBezier2, t: number): Point2 {
  return pointResult(primitive('quadraticTangent', [
    ...pointValues(curve.start), ...pointValues(curve.control),
    ...pointValues(curve.end), finite(t, 'параметр'),
  ]));
}

export function cubicTangent(curve: CubicBezier2, t: number): Point2 {
  return pointResult(primitive('cubicTangent', [
    ...pointValues(curve.start), ...pointValues(curve.control1),
    ...pointValues(curve.control2), ...pointValues(curve.end),
    finite(t, 'параметр'),
  ]));
}

function kernelPath(path: GeometryPath): KernelPathData {
  const types = new Uint32Array(path.length);
  const values: number[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const command = path[index];
    const commandStart = values.length;
    if (command.type === 'close') {
      types[index] = 6;
    } else if (command.type === 'move' || command.type === 'line') {
      types[index] = command.type === 'move' ? 1 : 2;
      values.push(...pointValues(command.point));
    } else if (command.type === 'quadratic') {
      types[index] = 3;
      values.push(...pointValues(command.control), ...pointValues(command.point));
    } else if (command.type === 'cubic') {
      types[index] = 4;
      values.push(
        ...pointValues(command.control1), ...pointValues(command.control2),
        ...pointValues(command.point),
      );
    } else if (command.type === 'arc') {
      types[index] = 5;
      values.push(
        finite(command.radiusX, 'радиус X'), finite(command.radiusY, 'радиус Y'),
        finite(command.rotation, 'поворот'), command.largeArc ? 1 : 0,
        command.sweep ? 1 : 0, ...pointValues(command.point),
      );
    } else {
      throw new TypeError('Неизвестная команда геометрического пути');
    }
    if (values.length - commandStart > 8) {
      throw new TypeError('Команда геометрического пути содержит лишние значения');
    }
    while (values.length - commandStart < 8) values.push(0);
  }
  return { types, values: new Float64Array(values) };
}

function geometryPath(path: KernelPathData): PathCommand[] {
  const result: PathCommand[] = [];
  let index = 0;
  for (const type of path.types) {
    const commandStart = index;
    if (type === 6) {
      result.push({ type: 'close' });
    } else if (type === 1 || type === 2) {
      result.push({
        type: type === 1 ? 'move' : 'line',
        point: { x: path.values[index++], y: path.values[index++] },
      });
    } else if (type === 3) {
      const control = { x: path.values[index++], y: path.values[index++] };
      result.push({
        type: 'quadratic',
        control,
        point: { x: path.values[index++], y: path.values[index++] },
      });
    } else if (type === 4) {
      const control1 = { x: path.values[index++], y: path.values[index++] };
      const control2 = { x: path.values[index++], y: path.values[index++] };
      result.push({
        type: 'cubic',
        control1,
        control2,
        point: { x: path.values[index++], y: path.values[index++] },
      });
    } else if (type === 5) {
      const radiusX = path.values[index++];
      const radiusY = path.values[index++];
      const rotation = path.values[index++];
      const largeArc = path.values[index++] === 1;
      const sweep = path.values[index++] === 1;
      result.push({
        type: 'arc', radiusX, radiusY, rotation, largeArc, sweep,
        point: { x: path.values[index++], y: path.values[index++] },
      });
    } else {
      throw new Error(`Бинарное ядро вернуло неизвестную команду пути: ${type}`);
    }
    index = commandStart + 8;
  }
  if (index !== path.values.length) throw new Error('Бинарное ядро вернуло повреждённый путь');
  return result;
}

export function parseSvgPath(source: string): PathCommand[] {
  return geometryPath(getBinaryMathKernel().pathParse(source));
}

export function serializeSvgPath(path: GeometryPath): string {
  return getBinaryMathKernel().pathSerialize(kernelPath(path));
}

function flattenedPath(
  path: GeometryPath,
  tolerance: number,
  closeForFill = false,
  closedFlags?: boolean[],
): Point2[][] {
  const flattened = getBinaryMathKernel().pathFlatten(kernelPath(path), validTolerance(tolerance));
  return Array.from({ length: flattened.subpathOffsets.length - 1 }, (_, subpath) => {
    const start = flattened.subpathOffsets[subpath];
    const end = flattened.subpathOffsets[subpath + 1];
    const points = Array.from({ length: end - start }, (_, offset) => ({
      x: flattened.coordinates[(start + offset) * 2],
      y: flattened.coordinates[(start + offset) * 2 + 1],
    }));
    const closed = flattened.closed[subpath] === 1;
    if (closeForFill && points.length > 1 && !closed &&
        (points[0].x !== points[points.length - 1].x ||
         points[0].y !== points[points.length - 1].y)) {
      points.push({ ...points[0] });
    }
    closedFlags?.push(closed || closeForFill);
    return points;
  });
}

export function flattenQuadratic(curve: QuadraticBezier2, tolerance: number): Point2[] {
  return flattenedPath([
    { type: 'move', point: curve.start },
    { type: 'quadratic', control: curve.control, point: curve.end },
  ], tolerance)[0] ?? [];
}

export function flattenCubic(curve: CubicBezier2, tolerance: number): Point2[] {
  return flattenedPath([
    { type: 'move', point: curve.start },
    {
      type: 'cubic',
      control1: curve.control1,
      control2: curve.control2,
      point: curve.end,
    },
  ], tolerance)[0] ?? [];
}

export function quadraticLength(curve: QuadraticBezier2, tolerance: number): number {
  return pathLength([
    { type: 'move', point: curve.start },
    { type: 'quadratic', control: curve.control, point: curve.end },
  ], tolerance);
}

export function cubicLength(curve: CubicBezier2, tolerance: number): number {
  return pathLength([
    { type: 'move', point: curve.start },
    {
      type: 'cubic',
      control1: curve.control1,
      control2: curve.control2,
      point: curve.end,
    },
  ], tolerance);
}

function arcInput(arc: EllipseArc2, t?: number): number[] {
  const start = validPoint(arc.start);
  const end = validPoint(arc.end);
  const values = [
    start.x, start.y, end.x, end.y,
    finite(arc.radiusX, 'радиус X'), finite(arc.radiusY, 'радиус Y'),
    finite(arc.rotation, 'поворот'), arc.largeArc ? 1 : 0, arc.sweep ? 1 : 0,
  ];
  return t === undefined ? values : [...values, finite(t, 'параметр')];
}

export function svgArcCenter(arc: EllipseArc2): ArcCenter | null {
  const result = primitive('arcParameters', arcInput(arc));
  if (!result.length) return null;
  return {
    center: { x: result[0], y: result[1] },
    radiusX: result[2],
    radiusY: result[3],
    rotation: result[4],
    startAngle: result[5],
    deltaAngle: result[6],
  };
}

export function ellipseArcAt(arc: EllipseArc2, t: number): Point2 {
  return pointResult(primitive('arcAt', arcInput(arc, t)));
}

export function ellipseArcTangent(arc: EllipseArc2, t: number): Point2 {
  return pointResult(primitive('arcTangent', arcInput(arc, t)));
}

export function flattenEllipseArc(arc: EllipseArc2, tolerance: number): Point2[] {
  return flattenedPath([
    { type: 'move', point: arc.start },
    {
      type: 'arc',
      radiusX: arc.radiusX,
      radiusY: arc.radiusY,
      rotation: arc.rotation,
      largeArc: arc.largeArc,
      sweep: arc.sweep,
      point: arc.end,
    },
  ], tolerance)[0] ?? [];
}

export function ellipseArcLength(arc: EllipseArc2, tolerance: number): number {
  return pathLength([
    { type: 'move', point: arc.start },
    {
      type: 'arc',
      radiusX: arc.radiusX,
      radiusY: arc.radiusY,
      rotation: arc.rotation,
      largeArc: arc.largeArc,
      sweep: arc.sweep,
      point: arc.end,
    },
  ], tolerance);
}

export function circleIntersections(first: Circle2, second: Circle2, epsilon = 1e-9): Point2[] {
  const radius1 = finite(first.radius, 'радиус');
  const radius2 = finite(second.radius, 'радиус');
  if (radius1 < 0 || radius2 < 0 || !Number.isFinite(epsilon) || epsilon < 0) {
    throw new RangeError('Радиус и допуск пересечения должны быть неотрицательными');
  }
  const values = primitive('circleIntersections', [
    ...pointValues(first.center), radius1, ...pointValues(second.center), radius2, epsilon,
  ]);
  return Array.from({ length: values.length / 2 }, (_, index) => ({
    x: values[index * 2], y: values[index * 2 + 1],
  }));
}

export function circleSegmentIntersections(
  circle: Circle2,
  segment: Segment2,
  epsilon = 1e-9,
): Point2[] {
  const radius = finite(circle.radius, 'радиус');
  if (radius < 0 || !Number.isFinite(epsilon) || epsilon < 0) {
    throw new RangeError('Радиус и допуск пересечения должны быть неотрицательными');
  }
  const values = primitive('circleSegmentIntersections', [
    ...pointValues(circle.center), radius,
    ...pointValues(segment.start), ...pointValues(segment.end), epsilon,
  ]);
  return Array.from({ length: values.length / 2 }, (_, index) => ({
    x: values[index * 2], y: values[index * 2 + 1],
  }));
}

export function distanceToCircleBoundary(point: Point2, circle: Circle2): number {
  const radius = finite(circle.radius, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  return scalar('distanceCircleBoundary', [
    ...pointValues(point), ...pointValues(circle.center), radius,
  ]);
}

export function closestPointOnCircleBoundary(point: Point2, circle: Circle2): Point2 {
  const radius = finite(circle.radius, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  return pointResult(primitive('closestPointCircleBoundary', [
    ...pointValues(point), ...pointValues(circle.center), radius,
  ]));
}

export function transformPath(
  path: GeometryPath,
  matrix: Affine2,
  tolerance: number,
): PathCommand[] {
  return geometryPath(getBinaryMathKernel().pathTransform(
    kernelPath(path), new Float64Array(affineValues(matrix)), validTolerance(tolerance),
  ));
}

export function pathLength(path: GeometryPath, tolerance: number): number {
  return getBinaryMathKernel().pathMeasure(
    'length', kernelPath(path), validTolerance(tolerance),
  )[0];
}

export function pathBounds(path: GeometryPath, tolerance: number): Bounds2 {
  const result = getBinaryMathKernel().pathMeasure(
    'bounds', kernelPath(path), validTolerance(tolerance),
  );
  if (result.length !== 4) throw new RangeError('Нельзя определить границы пустого пути');
  return { minX: result[0], minY: result[1], maxX: result[2], maxY: result[3] };
}

export function pathIntersections(
  first: GeometryPath,
  second: GeometryPath,
  tolerance: number,
): Point2[] {
  const result = getBinaryMathKernel().pathIntersections(
    kernelPath(first), kernelPath(second), validTolerance(tolerance),
  );
  return Array.from({ length: result.length / 2 }, (_, index) => ({
    x: result[index * 2], y: result[index * 2 + 1],
  }));
}

export function pointInRing(point: Point2, ring: readonly Point2[]): boolean {
  return scalar('pointInRing', [
    ...pointValues(point), ring.length, ...ring.flatMap(pointValues),
  ]) !== 0;
}

export function ringSignedArea(ring: readonly Point2[]): number {
  return scalar('ringSignedArea', [ring.length, ...ring.flatMap(pointValues)]);
}

function kernelPolygon(multi: MultiPolygon2): KernelPolygonData {
  const coordinates: number[] = [];
  const ringOffsets = [0];
  const polygonOffsets = [0];
  for (const polygon of multi) {
    let ringCount = 0;
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      for (const point of ring) coordinates.push(...pointValues(point));
      ringOffsets.push(coordinates.length / 2);
      ringCount += 1;
    }
    if (ringCount) polygonOffsets.push(ringOffsets.length - 1);
  }
  return {
    coordinates: new Float64Array(coordinates),
    ringOffsets: new Uint32Array(ringOffsets),
    polygonOffsets: new Uint32Array(polygonOffsets),
  };
}

function geometryPolygons(multi: KernelPolygonData): MultiPolygon2 {
  const result: MultiPolygon2 = [];
  for (let polygonIndex = 0;
       polygonIndex + 1 < multi.polygonOffsets.length;
       polygonIndex += 1) {
    const polygon: Polygon2 = [];
    for (let ringIndex = multi.polygonOffsets[polygonIndex];
         ringIndex < multi.polygonOffsets[polygonIndex + 1];
         ringIndex += 1) {
      const start = multi.ringOffsets[ringIndex];
      const end = multi.ringOffsets[ringIndex + 1];
      const ring = Array.from({ length: end - start }, (_, offset) => ({
        x: multi.coordinates[(start + offset) * 2],
        y: multi.coordinates[(start + offset) * 2 + 1],
      }));
      if (ring.length && (ring[0].x !== ring[ring.length - 1].x ||
          ring[0].y !== ring[ring.length - 1].y)) {
        ring.push({ ...ring[0] });
      }
      polygon.push(ring);
    }
    if (polygon.length) result.push(polygon);
  }
  return result;
}

export function pathToPolygons(
  path: GeometryPath,
  tolerance: number,
  fillRule: FillRule = 'nonzero',
): MultiPolygon2 {
  return geometryPolygons(getBinaryMathKernel().pathToPolygons(
    kernelPath(path), validTolerance(tolerance), fillRule,
  ));
}

export function booleanPolygons(
  operation: PolygonBooleanOperation,
  ...inputs: readonly MultiPolygon2[]
): MultiPolygon2 {
  if (!inputs.length) return [];
  return geometryPolygons(getBinaryMathKernel().polygonBoolean(
    operation, inputs.map(kernelPolygon),
  ));
}

export function clipPath(
  subject: GeometryPath,
  clip: GeometryPath,
  tolerance: number,
  fillRule: FillRule = 'nonzero',
): MultiPolygon2 {
  return booleanPolygons(
    'intersection',
    pathToPolygons(subject, tolerance, fillRule),
    pathToPolygons(clip, tolerance, fillRule),
  );
}

export function strokePolylineComponents(
  points: readonly Point2[],
  width: number,
  tolerance: number,
  cap: StrokeCap = 'butt',
  join: StrokeJoin = 'miter',
  miterLimit = 4,
  closed = false,
): MultiPolygon2 {
  const lineWidth = finite(width, 'толщина штриха');
  const limit = finite(miterLimit, 'предел скоса');
  if (lineWidth < 0 || limit < 1) {
    throw new RangeError('Недопустимая толщина или предел скоса');
  }
  return geometryPolygons(getBinaryMathKernel().strokePolyline(
    new Float64Array(points.flatMap(pointValues)),
    lineWidth,
    validTolerance(tolerance),
    cap,
    join,
    limit,
    closed,
  ));
}

export function strokePolyline(
  points: readonly Point2[],
  width: number,
  tolerance: number,
  cap: StrokeCap = 'butt',
  join: StrokeJoin = 'miter',
  miterLimit = 4,
  closed = false,
): MultiPolygon2 {
  const components = strokePolylineComponents(
    points, width, tolerance, cap, join, miterLimit, closed,
  );
  return components.length
    ? booleanPolygons('union', ...components.map((polygon) => [polygon]))
    : [];
}

export function strokePath(
  path: GeometryPath,
  width: number,
  tolerance: number,
  cap: StrokeCap = 'butt',
  join: StrokeJoin = 'miter',
  miterLimit = 4,
): MultiPolygon2 {
  const closedFlags: boolean[] = [];
  const paths = flattenedPath(path, tolerance, false, closedFlags);
  return paths.flatMap((points, index) => {
    const closed = closedFlags[index] ?? false;
    const vertices = closed && points.length > 1 &&
      points[0].x === points[points.length - 1].x &&
      points[0].y === points[points.length - 1].y
      ? points.slice(0, -1)
      : points;
    return strokePolyline(vertices, width, tolerance, cap, join, miterLimit, closed);
  });
}

export type SpatialShape =
  | { type: 'circle'; center: Point2; radius: number }
  | { type: 'polyline'; points: readonly Point2[]; closed?: boolean }
  | { type: 'bounds' };
export interface SpatialEntry<T> {
  id: string | number;
  value: T;
  bounds: Bounds2;
  shape: SpatialShape;
}
export interface NearestResult<T> {
  id: string | number;
  value: T;
  distance: number;
  point: Point2;
}

function idBefore(first: string | number, second: string | number): boolean {
  if (typeof first === 'number' && typeof second === 'number') return first < second;
  return String(first) < String(second);
}

function packSpatialEntries(point: Point2, entries: readonly SpatialEntry<unknown>[]): number[] {
  const input: number[] = [point.x, point.y, entries.length];
  for (const entry of entries) {
    if (entry.shape.type === 'circle') {
      input.push(1, ...pointValues(entry.shape.center), finite(entry.shape.radius, 'радиус'));
    } else if (entry.shape.type === 'polyline') {
      input.push(
        2,
        entry.shape.closed ? 1 : 0,
        entry.shape.points.length,
        ...entry.shape.points.flatMap(pointValues),
      );
    } else {
      const bounds = validBounds(entry.bounds);
      input.push(3, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    }
  }
  return input;
}

export class DynamicSpatialIndex<T> {
  private readonly entries = new Map<string | number, SpatialEntry<T>>();
  private revisionValue = 0;

  constructor(readonly cellSize = 64) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('Размер ячейки индекса должен быть больше нуля');
    }
  }

  get revision(): number { return this.revisionValue; }
  get size(): number { return this.entries.size; }

  insert(entry: SpatialEntry<T>): void {
    if (this.entries.has(entry.id)) throw new Error(`Индекс уже содержит объект ${entry.id}`);
    this.validateEntry(entry);
    this.entries.set(entry.id, entry);
    this.revisionValue += 1;
  }

  update(entry: SpatialEntry<T>): void {
    this.validateEntry(entry);
    this.entries.set(entry.id, entry);
    this.revisionValue += 1;
  }

  remove(id: string | number): boolean {
    if (!this.entries.delete(id)) return false;
    this.revisionValue += 1;
    return true;
  }

  get(id: string | number): SpatialEntry<T> | undefined {
    return this.entries.get(id);
  }

  query(bounds: Bounds2): SpatialEntry<T>[] {
    const query = validBounds(bounds);
    const packed = [
      query.minX, query.minY, query.maxX, query.maxY,
    ];
    return [...this.entries.values()].filter((entry) =>
      scalar('boundsIntersect', [
        ...packed,
        entry.bounds.minX, entry.bounds.minY,
        entry.bounds.maxX, entry.bounds.maxY,
      ]) !== 0);
  }

  nearest(point: Point2): NearestResult<T> | null {
    const ordered = [...this.entries.values()].sort((a, b) =>
      idBefore(a.id, b.id) ? -1 : idBefore(b.id, a.id) ? 1 : 0);
    if (!ordered.length) return null;
    const result = primitive('nearestSpatial', packSpatialEntries(point, ordered));
    const index = result[0];
    const entry = ordered[index];
    if (!entry) throw new Error('Бинарное ядро вернуло неизвестный объект индекса');
    return {
      id: entry.id,
      value: entry.value,
      distance: result[1],
      point: { x: result[2], y: result[3] },
    };
  }

  nearestPoint(
    point: Point2,
    points: readonly { id: string | number; point: Point2; value: T }[],
  ): NearestResult<T> | null {
    if (!points.length) return null;
    const ordered = [...points].sort((a, b) =>
      idBefore(a.id, b.id) ? -1 : idBefore(b.id, a.id) ? 1 : 0);
    const input = [
      ...pointValues(point),
      ordered.length,
      ...ordered.flatMap((candidate) => pointValues(candidate.point)),
    ];
    const result = primitive('nearestPoints', input);
    const entry = ordered[result[0]];
    if (!entry) throw new Error('Бинарное ядро вернуло неизвестную точку');
    return {
      id: entry.id,
      value: entry.value,
      distance: result[1],
      point: { x: result[2], y: result[3] },
    };
  }

  distanceToMany(point: Point2, ids?: readonly (string | number)[]): number {
    const candidates = ids
      ? ids.map((id) => this.entries.get(id)).filter((entry): entry is SpatialEntry<T> => !!entry)
      : [...this.entries.values()];
    if (!candidates.length) return Infinity;
    return primitive('nearestSpatial', packSpatialEntries(point, candidates))[1];
  }

  distanceToBounds(point: Point2, bounds: Bounds2): number {
    return boundsDistance(bounds, point);
  }

  sphereCandidates(center: Point2, radius: number): SpatialEntry<T>[] {
    const value = finite(radius, 'радиус');
    if (value < 0) throw new RangeError('Радиус не может быть отрицательным');
    const candidates = this.query(boundsOfCircle({ center, radius: value }));
    return candidates.filter((entry) => {
      return primitive('nearestSpatial', packSpatialEntries(center, [entry]))[1] <= value;
    });
  }

  private validateEntry(entry: SpatialEntry<T>): void {
    if (!entry || (typeof entry.id !== 'string' && typeof entry.id !== 'number')) {
      throw new TypeError('Недопустимая запись пространственного индекса');
    }
    validBounds(entry.bounds);
    if (!entry.shape) throw new TypeError('Не задана геометрическая форма записи');
  }
}

export function circleSpatialEntry<T>(
  id: string | number,
  value: T,
  circle: Circle2,
): SpatialEntry<T> {
  const center = validPoint(circle.center);
  const radius = finite(circle.radius, 'радиус');
  if (radius < 0) throw new RangeError('Радиус не может быть отрицательным');
  return {
    id, value,
    bounds: boundsOfCircle({ center, radius }),
    shape: { type: 'circle', center, radius },
  };
}

export function polylineSpatialEntry<T>(
  id: string | number,
  value: T,
  points: readonly Point2[],
): SpatialEntry<T> {
  const vertices = points.map((point) => validPoint(point));
  if (!vertices.length) throw new RangeError('Ломаная пространственного индекса пуста');
  return {
    id,
    value,
    bounds: boundsOfPoints(vertices),
    shape: { type: 'polyline', points: vertices },
  };
}

export function gridPathDistance(
  from: Point2,
  to: Point2,
  stepWeight: (x: number, y: number) => number,
): number {
  const samples = primitive('gridPathSamples', [...pointValues(from), ...pointValues(to)]);
  const step = samples[0];
  const count = samples[1];
  const weights: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = samples[2 + index * 2];
    const y = samples[3 + index * 2];
    const weight = finite(stepWeight(x, y), 'вес шага');
    if (weight < 0) throw new RangeError('Вес шага не может быть отрицательным');
    weights.push(weight);
  }
  return scalar('gridPathWeightedSum', [step, ...weights]);
}
