import {
  FLAG_OUTLINE_CONFIG,
  type EdgeShape,
  type FlagOutlineConfig,
  type OutlineType,
} from './flagOutlineConfig';

export interface OutlinePoint {
  x: number;
  y: number;
}

export type OutlineParameters = Record<string, number | string | boolean | OutlineEdgeModifier | undefined>;

export interface FlagOutlineInput {
  type: OutlineType;
  aspect: number;
  params?: OutlineParameters;
}

export interface OutlineEdgeModifier {
  count: number;
  depth: number;
  shape: EdgeShape;
}

export interface FlagOutlineGeometry {
  type: OutlineType;
  width: number;
  height: number;
  aspect: number;
  params: OutlineParameters;
  /** Ordered outer boundary. Coordinates remain unrounded. */
  boundary: OutlinePoint[];
  /** Regions removed from the field, such as swallow-tail cut-outs. */
  cutouts: OutlinePoint[][];
  /** Inward offset of the outline by the configured safe margin. */
  safe_area: OutlinePoint[];
  edge?: OutlineEdgeModifier & { effectiveCount: number };
}

type Point = OutlinePoint;

function finite(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
  return value;
}

function inRange(value: number, range: readonly number[], label: string): number {
  if (value < range[0] || value > range[1]) {
    throw new RangeError(`${label} must be between ${range[0]} and ${range[1]}`);
  }
  return value;
}

function integerInRange(value: number, range: readonly number[], label: string): number {
  if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
    throw new RangeError(`${label} must be an integer between ${range[0]} and ${range[1]}`);
  }
  return value;
}

function point(x: number, y: number): Point {
  return { x, y };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

function append(target: Point[], source: Point[]): void {
  for (const item of source) {
    if (!target.length || !samePoint(target[target.length - 1], item)) target.push(item);
  }
}

function area(points: Point[]): number {
  let result = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    result += a.x * b.y - b.x * a.y;
  }
  return result / 2;
}

function lineIntersection(p: Point, d: Point, q: Point, e: Point): Point | null {
  const cross = d.x * e.y - d.y * e.x;
  if (Math.abs(cross) < 1e-10) return null;
  const qp = point(q.x - p.x, q.y - p.y);
  const t = (qp.x * e.y - qp.y * e.x) / cross;
  return point(p.x + t * d.x, p.y + t * d.y);
}

function pointOnSegment(p: Point, a: Point, b: Point, tolerance = 1e-7): boolean {
  const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > tolerance * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) return false;
  return p.x >= Math.min(a.x, b.x) - tolerance && p.x <= Math.max(a.x, b.x) + tolerance
    && p.y >= Math.min(a.y, b.y) - tolerance && p.y <= Math.max(a.y, b.y) + tolerance;
}

function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (pointOnSegment(p, a, b)) return true;
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function boundaryDistance(p: Point, polygon: Point[]): number {
  return Math.min(...polygon.map((a, index) => pointSegmentDistance(p, a, polygon[(index + 1) % polygon.length])));
}

function findInteriorAnchor(polygon: Point[], clearance: number): Point {
  const xs = polygon.map(({ x }) => x);
  const ys = polygon.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let best: Point | undefined;
  let bestDistance = clearance;
  const divisions = 40;
  for (let yi = 1; yi < divisions; yi += 1) {
    for (let xi = 1; xi < divisions; xi += 1) {
      const candidate = point(
        minX + (maxX - minX) * xi / divisions,
        minY + (maxY - minY) * yi / divisions,
      );
      if (!pointInPolygon(candidate, polygon)) continue;
      const distance = boundaryDistance(candidate, polygon);
      if (distance > bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  if (!best) throw new RangeError('outline has no interior region wide enough for the safe margin');
  return best;
}

function isSafeInset(candidate: Point[], polygon: Point[], margin: number): boolean {
  if (candidate.length < 3 || Math.abs(area(candidate)) < 1e-8 || Math.sign(area(candidate)) !== Math.sign(area(polygon))) return false;
  for (let index = 0; index < candidate.length; index += 1) {
    const a = candidate[index];
    const b = candidate[(index + 1) % candidate.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / Math.max(1, margin / 2)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const sample = point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (!pointInPolygon(sample, polygon) || boundaryDistance(sample, polygon) < margin - 1e-5) return false;
    }
  }
  return true;
}

/**
 * Offsets a simple polygon toward its interior. The miter construction keeps
 * straight edges exact; concave miter spikes are conservatively pulled inward
 * until the entire safe boundary stays inside the outline at least margin away.
 */
export function insetPolygon(input: Point[], margin: number): Point[] {
  if (!Number.isFinite(margin) || margin < 0) throw new RangeError('margin must be non-negative');
  const points = input.filter((p, i) => !samePoint(p, input[(i + input.length - 1) % input.length]));
  if (points.length < 3 || Math.abs(area(points)) < 1e-9) throw new RangeError('polygon must have non-zero area');
  if (margin === 0) return points.map(({ x, y }) => point(x, y));
  const orientation = Math.sign(area(points));
  const raw: Point[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i + points.length - 1) % points.length];
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const prevLength = Math.hypot(current.x - prev.x, current.y - prev.y);
    const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
    if (prevLength < 1e-9 || nextLength < 1e-9) continue;
    // For positive screen-coordinate winding, (-dy, dx) points inward.
    const prevShift = point(
      prev.x - orientation * (current.y - prev.y) / prevLength * margin,
      prev.y + orientation * (current.x - prev.x) / prevLength * margin,
    );
    const nextShift = point(
      current.x - orientation * (next.y - current.y) / nextLength * margin,
      current.y + orientation * (next.x - current.x) / nextLength * margin,
    );
    const intersection = lineIntersection(
      prevShift,
      point(current.x - prev.x, current.y - prev.y),
      nextShift,
      point(next.x - current.x, next.y - current.y),
    );
    raw.push(intersection ?? point(
      current.x - orientation * (current.y - prev.y) / prevLength * margin,
      current.y + orientation * (current.x - prev.x) / prevLength * margin,
    ));
  }
  const anchor = findInteriorAnchor(points, margin);
  for (let scale = 1; scale >= 1 / 4096; scale /= 2) {
    const candidate = raw.map((p) => point(
      anchor.x + (p.x - anchor.x) * scale,
      anchor.y + (p.y - anchor.y) * scale,
    ));
    if (isSafeInset(candidate, points, margin)) return candidate;
  }
  throw new RangeError('safe area collapses at the requested margin');
}

function outlinePathPoints(radius: number, start: number, end: number, centerX: number, centerY: number, config: FlagOutlineConfig): Point[] {
  const angle = Math.abs(end - start);
  const tolerance = config.curveTolerance;
  const maxAngle = radius <= tolerance
    ? Math.PI / 8
    : 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius)));
  const steps = Math.max(2, Math.ceil(angle / Math.max(maxAngle, 0.01)));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const theta = start + (end - start) * index / steps;
    return point(centerX - radius * Math.cos(theta), centerY + radius * Math.sin(theta));
  });
}

function samplePolyline(points: Point[], distance: number): { p: Point; tangent: Point } {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(total);
  }
  const clamped = Math.max(0, Math.min(total, distance));
  let segment = lengths.findIndex((length) => length >= clamped);
  if (segment < 0) segment = lengths.length - 1;
  const before = segment === 0 ? 0 : lengths[segment - 1];
  const a = points[segment];
  const b = points[segment + 1];
  const length = lengths[segment] - before || 1;
  const t = (clamped - before) / length;
  const dx = (b.x - a.x) / length;
  const dy = (b.y - a.y) / length;
  return { p: point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), tangent: point(dx, dy) };
}

/** Makes a repeated saw/scallop edge while keeping its outermost extent fixed. */
function decorateFreeEdge(
  points: Point[],
  requestedCount: number,
  depth: number,
  shape: EdgeShape,
  minimumWidth: number,
): { points: Point[]; count: number } {
  const total = points.slice(1).reduce((sum, p, index) =>
    sum + Math.hypot(p.x - points[index].x, p.y - points[index].y), 0);
  const count = Math.min(requestedCount, Math.floor(total / minimumWidth));
  if (count < 1 || total <= 0) return { points: points.map(({ x, y }) => point(x, y)), count: 0 };

  const output: Point[] = [];
  const stepsPerTooth = shape === 'ROUND' ? 8 : 2;
  for (let tooth = 0; tooth < count; tooth += 1) {
    const startDistance = total * tooth / count;
    const endDistance = total * (tooth + 1) / count;
    const samples = tooth === 0 ? stepsPerTooth + 1 : stepsPerTooth;
    for (let step = tooth === 0 ? 0 : 1; step < samples; step += 1) {
      const t = step / stepsPerTooth;
      const { p, tangent } = samplePolyline(points, startDistance + (endDistance - startDistance) * t);
      const insetProfile = shape === 'TRIANGLE'
        ? 1 - Math.abs(2 * t - 1)
        : 1 - Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
      const normalX = tangent.y;
      const normalY = -tangent.x;
      output.push(point(p.x - normalX * depth * insetProfile, p.y - normalY * depth * insetProfile));
    }
  }
  const end = samplePolyline(points, total).p;
  if (!output.length || !samePoint(output[output.length - 1], end)) output.push(end);
  return { points: output, count };
}

function param(params: OutlineParameters, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' ? value : undefined;
}

function stringParam(params: OutlineParameters, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function buildSwallowNotch(
  width: number,
  centerY: number,
  span: number,
  depth: number,
  shape: 'V' | 'U',
  config: FlagOutlineConfig,
): { edge: Point[]; cutout: Point[] } {
  const top = point(width, centerY - span / 2);
  const bottom = point(width, centerY + span / 2);
  if (shape === 'V') {
    const tip = point(width - depth, centerY);
    return { edge: [top, tip, bottom], cutout: [top, tip, bottom] };
  }
  const radius = Math.max(config.types.SWALLOW.uRadiusMinimum, (depth ** 2 + (span / 2) ** 2) / (2 * depth));
  const halfChord = Math.sqrt(Math.max(0, radius ** 2 - (radius - depth) ** 2));
  const actualSpan = Math.min(span, halfChord * 2);
  const effectiveRadius = Math.max(config.types.SWALLOW.uRadiusMinimum, (depth ** 2 + (actualSpan / 2) ** 2) / (2 * depth));
  const actualHalfChord = Math.sqrt(Math.max(0, effectiveRadius ** 2 - (effectiveRadius - depth) ** 2));
  const alpha = Math.asin(Math.min(1, actualHalfChord / effectiveRadius));
  const edge = outlinePathPoints(effectiveRadius, -alpha, alpha, width - depth + effectiveRadius, centerY, config);
  const cutout = [top, ...edge, bottom];
  return { edge, cutout };
}

function buildBannerLowerEdge(
  width: number,
  height: number,
  params: OutlineParameters,
  config: FlagOutlineConfig,
): { edge: Point[]; cutouts: Point[][] } {
  const banner = config.types.BANNER;
  const type = stringParam(params, 'lowerEdge') ?? banner.defaults.lowerEdge;
  if (!(banner.lowerEdges as readonly string[]).includes(type)) throw new RangeError(`unsupported BANNER lowerEdge "${type}"`);
  const cutouts: Point[][] = [];
  if (type === 'STRAIGHT') return { edge: [point(width, height), point(0, height)], cutouts };
  if (type === 'POINT') {
    const depth = inRange(param(params, 'lowerDepth') ?? width * banner.defaults.pointDepthRatio, [width * banner.pointDepth[0], width * banner.pointDepth[1]], 'BANNER point depth');
    return { edge: [point(width, height - depth), point(width / 2, height), point(0, height - depth)], cutouts };
  }
  if (type === 'SWALLOW') {
    const depth = inRange(param(params, 'lowerDepth') ?? width * banner.defaults.swallowDepthRatio, [width * banner.swallowDepth[0], width * banner.swallowDepth[1]], 'BANNER swallow depth');
    const cutout = [point(width, height), point(width / 2, height - depth), point(0, height)];
    cutouts.push(cutout);
    return { edge: cutout, cutouts };
  }
  if (type === 'TEETH') {
    const count = integerInRange(param(params, 'lowerCount') ?? banner.defaults.teethCount, banner.teethCount, 'BANNER teeth count');
    const factor = inRange(param(params, 'lowerDepthFactor') ?? banner.defaults.teethDepthFactor, banner.teethDepthFactor, 'BANNER teeth depth factor');
    const depth = factor * (width / count) * 2;
    const edge: Point[] = [point(width, height - depth)];
    for (let index = 0; index < count; index += 1) {
      edge.push(point(width * (1 - (index + 0.5) / count), height));
      edge.push(point(width * (1 - (index + 1) / count), height - depth));
    }
    return { edge, cutouts };
  }
  if (type === 'SCALLOP') {
    const count = integerInRange(param(params, 'lowerCount') ?? banner.defaults.scallopCount, banner.scallopCount, 'BANNER scallop count');
    const step = width / count;
    const radius = step / 2;
    const edge: Point[] = [point(width, height - radius)];
    for (let index = 0; index < count; index += 1) {
      const centerX = width - step * (index + 0.5);
      const centerY = height - radius;
      append(edge, outlinePathPoints(radius, Math.PI, 0, centerX, centerY, config));
    }
    return { edge, cutouts };
  }

  const count = integerInRange(param(params, 'lowerCount') ?? banner.defaults.tabCount, banner.tabCount, 'BANNER tab count');
  const heightRange = banner.tabHeight;
  const tabHeight = inRange(param(params, 'tabHeight') ?? banner.defaults.tabHeight, heightRange, 'BANNER tab height');
  const tabShape = stringParam(params, 'tabShape') ?? banner.defaults.tabShape;
  if (!(banner.tabShapes as readonly string[]).includes(tabShape)) throw new RangeError(`unsupported BANNER tabShape "${tabShape}"`);
  const step = width / count;
  const tabWidth = step * banner.tabWidthStepRatio;
  const edge: Point[] = [point(width, height - tabHeight)];
  for (let index = count - 1; index >= 0; index -= 1) {
    const center = (index + 0.5) * step;
    const left = center - tabWidth / 2;
    const right = center + tabWidth / 2;
    edge.push(point((index + 1) * step, height - tabHeight));
    edge.push(point(right, height - tabHeight));
    if (tabShape === 'TRIANGLE') edge.push(point(center, height), point(left, height - tabHeight));
    else {
      edge.push(point(right, height), point(left, height), point(left, height - tabHeight));
    }
  }
  edge.push(point(0, height - tabHeight));
  return { edge, cutouts };
}

function validateAspect(type: OutlineType, aspect: number, config: FlagOutlineConfig): void {
  const settings = config.types[type];
  if ('aspects' in settings) {
    if (!settings.aspects.some((candidate) => Math.abs(candidate - aspect) < 1e-9)) {
      throw new RangeError(`${type} aspect must be one of the configured values`);
    }
  } else {
    inRange(aspect, settings.aspect, `${type} aspect`);
  }
}

/**
 * Builds the exact, unrounded outline and its safe inset. Optional values use
 * the low end of the documented range; profiles can supply generated values.
 */
export function buildFlagOutline(
  input: FlagOutlineInput,
  config: FlagOutlineConfig = FLAG_OUTLINE_CONFIG,
): FlagOutlineGeometry {
  const { type } = input;
  const params: OutlineParameters = { ...(input.params ?? {}) };
  const aspect = finite(input.aspect, 'aspect');
  validateAspect(type, aspect, config);
  const height = config.height;
  const width = Math.round(height * aspect);
  const edgeParams = params.edge;
  let edge: FlagOutlineGeometry['edge'];
  if (edgeParams !== undefined) {
    if (!edgeParams || typeof edgeParams !== 'object') throw new TypeError('edge must be an object');
    const modifier = edgeParams as unknown as Record<string, unknown>;
    const count = integerInRange(Number(modifier.count), config.edge.count, 'EDGE count');
    const depth = inRange(Number(modifier.depth), config.edge.depth, 'EDGE depth');
    const shape = modifier.shape;
    if (shape !== 'TRIANGLE' && shape !== 'ROUND') throw new RangeError('EDGE shape must be TRIANGLE or ROUND');
    edge = { count, depth, shape, effectiveCount: count };
  }

  const cutouts: Point[][] = [];
  let boundary: Point[];
  if (type === 'RECT') {
    const right = [point(width, 0), point(width, height)];
    const fly = edge ? decorateFreeEdge(right, edge.count, edge.depth, edge.shape, config.minimumDetailThickness) : { points: right, count: 0 };
    boundary = [point(0, 0), ...fly.points, point(0, height)];
    if (edge) edge.effectiveCount = fly.count;
  } else if (type === 'SWALLOW') {
    const settings = config.types.SWALLOW;
    const depth = inRange(param(params, 'depth') ?? width * settings.defaults.depthRatio, [width * settings.depth[0], width * settings.depth[1]], 'SWALLOW depth');
    const notchCount = integerInRange(param(params, 'notchCount') ?? settings.defaults.notchCount, settings.notchCount, 'SWALLOW notchCount');
    const configuredNotchShape = stringParam(params, 'notchShape') ?? settings.defaults.notchShape;
    if (!(settings.notchShapes as readonly string[]).includes(configuredNotchShape)) {
      throw new RangeError(`unsupported SWALLOW notchShape "${configuredNotchShape}"`);
    }
    const notchShape = configuredNotchShape as 'V' | 'U';
    let rightEdge: Point[] = [point(width, 0)];
    const spans = notchCount === 1
      ? [{
        center: height * settings.singleNotchCenter,
        span: height * settings.singleNotchSpan,
      }]
      : settings.doubleNotchCenters.map((center) => ({
        center: height * center,
        span: height * settings.doubleNotchSpan,
      }));
    for (const notch of spans) {
      const startY = notch.center - notch.span / 2;
      const endY = notch.center + notch.span / 2;
      if (startY > rightEdge[rightEdge.length - 1].y) rightEdge.push(point(width, startY));
      const built = buildSwallowNotch(width, notch.center, notch.span, depth, notchShape, config);
      append(rightEdge, built.edge);
      cutouts.push(built.cutout);
      rightEdge.push(point(width, endY));
    }
    rightEdge.push(point(width, height));
    if (edge) {
      const decorated = decorateFreeEdge(rightEdge, edge.count, edge.depth, edge.shape, config.minimumDetailThickness);
      rightEdge = decorated.points;
      edge.effectiveCount = decorated.count;
    }
    boundary = [point(0, 0), ...rightEdge, point(0, height)];
  } else if (type === 'PENNANT') {
    const settings = config.types.PENNANT;
    const thickness = inRange(param(params, 'thickness') ?? settings.defaultThickness, settings.thickness, 'PENNANT thickness');
    const upper = point(width, height / 2 - thickness / 2);
    const lower = point(width, height / 2 + thickness / 2);
    const freeEdge = thickness === 0 ? [upper] : [upper, lower];
    const fly = edge && thickness > 0
      ? decorateFreeEdge(freeEdge, edge.count, edge.depth, edge.shape, config.minimumDetailThickness)
      : { points: freeEdge, count: 0 };
    boundary = [point(0, 0), ...fly.points, point(0, height)];
    if (edge) edge.effectiveCount = fly.count;
  } else if (type === 'DOUBLE_PENNANT') {
    const settings = config.types.DOUBLE_PENNANT;
    const waistY = inRange(param(params, 'waistY') ?? settings.defaults.waistY, settings.waistY, 'DOUBLE_PENNANT waistY') * height;
    const outerPointX = inRange(param(params, 'outerPointX') ?? settings.defaults.outerPointX, settings.outerPointX, 'DOUBLE_PENNANT outerPointX') * width;
    const innerPointX = inRange(param(params, 'innerPointX') ?? settings.defaults.innerPointX, settings.innerPointX, 'DOUBLE_PENNANT innerPointX') * width;
    if (!(innerPointX < outerPointX && outerPointX <= width)) throw new RangeError('DOUBLE_PENNANT requires xn < w1 <= W');
    boundary = [point(0, 0), point(outerPointX, waistY), point(innerPointX, waistY), point(width, height), point(0, height)];
  } else {
    const lower = buildBannerLowerEdge(width, height, params, config);
    cutouts.push(...lower.cutouts);
    const lowerEdge = edge
      ? decorateFreeEdge(lower.edge, edge.count, edge.depth, edge.shape, config.minimumDetailThickness)
      : { points: lower.edge, count: 0 };
    boundary = [point(0, 0), point(width, 0), ...lowerEdge.points, point(0, 0)];
    if (edge) edge.effectiveCount = lowerEdge.count;
  }

  // Remove the duplicate closing point; the polygon itself is implicitly closed.
  if (boundary.length > 1 && samePoint(boundary[0], boundary[boundary.length - 1])) boundary.pop();
  const safeArea = insetPolygon(boundary, config.safeMargin);
  return {
    type,
    width,
    height,
    aspect,
    params,
    boundary,
    cutouts,
    safe_area: safeArea,
    ...(edge ? { edge } : {}),
  };
}

/** SVG path serialization is the only place geometry coordinates are rounded. */
export function outlinePath(points: Point[], precision = 3): string {
  if (points.length < 3) throw new RangeError('an outline path needs at least three points');
  const coordinate = (value: number) => {
    const rounded = Number(value.toFixed(precision));
    return Object.is(rounded, -0) ? '0' : String(rounded);
  };
  return `M ${coordinate(points[0].x)} ${coordinate(points[0].y)} ${points.slice(1).map((p) =>
    `L ${coordinate(p.x)} ${coordinate(p.y)}`).join(' ')} Z`;
}

export function getConfiguredOutlineWeights(
  weights: Partial<Record<OutlineType, number>> = {},
  config: FlagOutlineConfig = FLAG_OUTLINE_CONFIG,
): Array<{ type: OutlineType; weight: number }> {
  const types = Object.keys(config.types) as OutlineType[];
  return types.map((type) => {
    const weight = weights[type] ?? config.types[type].weight;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`profile weight for ${type} must be a non-negative finite number`);
    }
    return { type, weight };
  });
}

export function getOutlineAspectOptions(type: OutlineType, config: FlagOutlineConfig = FLAG_OUTLINE_CONFIG): number[] | readonly number[] {
  const settings = config.types[type];
  return 'aspects' in settings ? [...settings.aspects] : [];
}

export function outlineAspectRange(type: OutlineType, config: FlagOutlineConfig = FLAG_OUTLINE_CONFIG): readonly number[] | null {
  const settings = config.types[type];
  return 'aspect' in settings ? [...settings.aspect] : null;
}

