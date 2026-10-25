import { FLAG_FIELD_CONFIG } from './flagFieldConfig';
import { styleSharedFlagRegionBoundaries, type FlagLineStyle } from './flagLineStyles';

/**
 * Geometry for the compositional flag-ground operators (§7).
 *
 * Geometry stays in floating-point flag coordinates until the SVG output
 * stage. Every operator partitions its frame into polygons; a clip chain is
 * kept separately so renderers can use the same parent boundaries and paint
 * the complete ground before its subdivisions.
 */
export interface FlagPoint {
  x: number;
  y: number;
}

export type FlagPolygon = FlagPoint[];
export type FlagPolygonSet = FlagPolygon[];
export type FlagFieldOperator =
  | 'G01' | 'G02' | 'G03' | 'G04' | 'G05' | 'G06'
  | 'G07' | 'G08' | 'G09' | 'G10' | 'G11' | 'G12';

export interface FlagFieldFrame {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export interface FlagFieldNode {
  op: FlagFieldOperator;
  params?: Record<string, unknown>;
  /** A child node for each generated region, in painter/region order. */
  children?: FlagFieldNode[];
}

export interface FlagFieldOptions {
  /** Height of the full flag in document units; T_MIN is H/40. */
  canvasHeight?: number;
  /** Parent clip chain, ordered from the flag outline inward. */
  clipChain?: FlagPolygonSet[];
  /** Deterministic random source, required only by WG-comp. */
  random?: () => number;
  /** Default color slots used by the SP mapping. */
  slots?: string[];
}

export interface FlagFieldRegion {
  op: FlagFieldOperator;
  index: number;
  slot: string;
  /** Source geometry before the inherited clipping chain is applied. */
  polygons: FlagPolygonSet;
  clipChain: FlagPolygonSet[];
  /** Convex polygon pieces after clipping; suitable for area checks/rasterizing. */
  visiblePolygons: FlagPolygonSet;
  area: number;
  depth: number;
}

export interface FlagFieldPaintLayer {
  kind: 'underpaint' | 'region';
  op: FlagFieldOperator;
  slot: string;
  polygons: FlagPolygonSet;
  clipChain: FlagPolygonSet[];
  depth: number;
  regionIndex?: number;
}

export interface FlagFieldResult {
  regions: FlagFieldRegion[];
  /** Paint these in order. Each split paints its whole parent before its regions. */
  paintLayers: FlagFieldPaintLayer[];
  regionCount: number;
  maxDepth: number;
}

export interface FlagFieldIssue {
  path: string;
  message: string;
}

export type FlagWeightSpec =
  | { kind: 'equal' }
  | { kind: 'sym'; ratio: number }
  | { kind: '5'; variant: '11211' | '12121' }
  | { kind: 'comp'; total?: number }
  | { kind: 'accent'; separator?: number }
  | { kind: 'custom'; weights: number[] };

const EPSILON = 1e-8;
const DEFAULT_SLOTS: string[] = [...FLAG_FIELD_CONFIG.slots];
const WG_SYM_RATIOS: readonly number[] = FLAG_FIELD_CONFIG.weights.symmetricRatios;

function point(x: number, y: number): FlagPoint {
  return { x, y };
}

function assertFrame(frame: FlagFieldFrame): void {
  if (![frame.x0, frame.y0, frame.w, frame.h].every(Number.isFinite) || frame.w <= 0 || frame.h <= 0) {
    throw new RangeError('flag field frame must have finite coordinates and positive width/height');
  }
}

function rectPolygon(frame: FlagFieldFrame): FlagPolygon {
  const { x0, y0, w, h } = frame;
  return [point(x0, y0), point(x0 + w, y0), point(x0 + w, y0 + h), point(x0, y0 + h)];
}

export function flagPolygonArea(polygon: FlagPolygon): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

export function flagPolygonSetArea(polygons: FlagPolygonSet): number {
  return polygons.reduce((sum, polygon) => sum + flagPolygonArea(polygon), 0);
}

function signedArea(polygon: FlagPolygon): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

function cleanPolygon(polygon: FlagPolygon): FlagPolygon {
  const result: FlagPolygon = [];
  for (const p of polygon) {
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(previous.x - p.x, previous.y - p.y) > EPSILON) result.push(point(p.x, p.y));
  }
  if (result.length > 1 && Math.hypot(result[0].x - result[result.length - 1].x, result[0].y - result[result.length - 1].y) <= EPSILON) {
    result.pop();
  }
  return result.length >= 3 && flagPolygonArea(result) > EPSILON ? result : [];
}

function clipHalfPlane(
  polygon: FlagPolygon,
  evaluate: (p: FlagPoint) => number,
): FlagPolygon {
  if (polygon.length < 3) return [];
  const result: FlagPolygon = [];
  let previous = polygon[polygon.length - 1];
  let previousValue = evaluate(previous);
  for (const current of polygon) {
    const currentValue = evaluate(current);
    const previousInside = previousValue >= -EPSILON;
    const currentInside = currentValue >= -EPSILON;
    if (previousInside !== currentInside) {
      const denominator = previousValue - currentValue;
      const t = Math.abs(denominator) < EPSILON ? 0 : previousValue / denominator;
      result.push(point(
        previous.x + (current.x - previous.x) * t,
        previous.y + (current.y - previous.y) * t,
      ));
    }
    if (currentInside) result.push(point(current.x, current.y));
    previous = current;
    previousValue = currentValue;
  }
  return cleanPolygon(result);
}

function clipConvex(subject: FlagPolygon, clip: FlagPolygon): FlagPolygon {
  let result = cleanPolygon(subject);
  if (result.length < 3 || clip.length < 3) return [];
  const orientation = Math.sign(signedArea(clip)) || 1;
  for (let i = 0; i < clip.length && result.length >= 3; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    result = clipHalfPlane(result, (p) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)));
  }
  return result;
}

/** Ear-clips any simple polygon into non-overlapping triangles. */
function triangulate(input: FlagPolygon): FlagPolygonSet {
  const polygon = cleanPolygon(input);
  if (polygon.length < 3) return [];
  if (polygon.length === 3) return [polygon];
  const direction = Math.sign(signedArea(polygon)) || 1;
  const remaining = polygon.map((_, index) => index);
  const triangles: FlagPolygonSet = [];
  let guard = polygon.length * polygon.length;

  const inTriangle = (p: FlagPoint, a: FlagPoint, b: FlagPoint, c: FlagPoint): boolean => {
    const cross = (p1: FlagPoint, p2: FlagPoint, p3: FlagPoint) =>
      (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    const ab = direction * cross(a, b, p);
    const bc = direction * cross(b, c, p);
    const ca = direction * cross(c, a, p);
    return ab >= -EPSILON && bc >= -EPSILON && ca >= -EPSILON;
  };

  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let foundEar = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const prevIndex = remaining[(i + remaining.length - 1) % remaining.length];
      const currentIndex = remaining[i];
      const nextIndex = remaining[(i + 1) % remaining.length];
      const a = polygon[prevIndex];
      const b = polygon[currentIndex];
      const c = polygon[nextIndex];
      const cross = direction * ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
      if (cross <= EPSILON) continue;
      if (remaining.some((index) =>
        index !== prevIndex && index !== currentIndex && index !== nextIndex && inTriangle(polygon[index], a, b, c))) continue;
      triangles.push([a, b, c]);
      remaining.splice(i, 1);
      foundEar = true;
      break;
    }
    if (!foundEar) break;
  }
  if (remaining.length === 3) {
    triangles.push(remaining.map((index) => polygon[index]));
  }
  if (triangles.length !== polygon.length - 2) {
    throw new RangeError('flag region must be a simple, non-self-intersecting polygon');
  }
  return triangles;
}

function intersectSets(subject: FlagPolygonSet, clipSet: FlagPolygonSet): FlagPolygonSet {
  const results: FlagPolygonSet = [];
  for (const subjectPolygon of subject) {
    const subjectTriangles = triangulate(subjectPolygon);
    for (const clipPolygon of clipSet) {
      const clipTriangles = triangulate(clipPolygon);
      for (const subjectTriangle of subjectTriangles) {
        for (const clipTriangle of clipTriangles) {
          const intersection = clipConvex(subjectTriangle, clipTriangle);
          if (intersection.length >= 3) results.push(intersection);
        }
      }
    }
  }
  return results;
}

export function clipFlagPolygons(
  polygons: FlagPolygonSet,
  clipChain: FlagPolygonSet[],
): FlagPolygonSet {
  let visible = polygons.map(cleanPolygon).filter((polygon) => polygon.length >= 3);
  for (const clipSet of clipChain) {
    if (clipSet.length === 0) return [];
    visible = intersectSets(visible, clipSet);
    if (visible.length === 0) break;
  }
  return visible;
}

function normalizeWeights(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || weights.some((weight) => !Number.isFinite(weight) || weight <= 0) || sum <= 0) {
    throw new RangeError('band weights must be a non-empty list of positive finite numbers');
  }
  return weights.map((weight) => weight / sum);
}

function randomIndex(random: () => number, count: number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('deterministic random source must return values in [0, 1)');
  }
  return Math.floor(value * count);
}

function getRandom(params: Record<string, unknown>, fallback?: () => number): () => number {
  const random = typeof params.random === 'function' ? params.random as () => number : fallback;
  if (!random) throw new TypeError('WG-comp requires a deterministic random source');
  return random;
}

function generateCompWeights(
  n: number,
  params: Record<string, unknown>,
  random: () => number,
  frameHeight: number,
  minBand: number,
): number[] {
  if (n < 2 || n > FLAG_FIELD_CONFIG.weights.compositionTotal[1]) {
    throw new RangeError('WG-comp cannot satisfy the documented part limit for this band count');
  }
  const [minTotal, maxTotal] = FLAG_FIELD_CONFIG.weights.compositionTotal;
  const minimumTotal = Math.max(minTotal, n);
  const totals: number[] = [];
  for (let total = minimumTotal; total <= maxTotal; total += 1) {
    const minimumPart = Math.max(1, Math.ceil(minBand * total / frameHeight - EPSILON));
    if (n * minimumPart <= total && n * Math.floor(total / 2) >= total) totals.push(total);
  }
  if (totals.length === 0) throw new RangeError('WG-comp has no valid total for this band count');
  const total = Number.isInteger(params.total) ? params.total as number : totals[randomIndex(random, totals.length)];
  if (!totals.includes(total)) throw new RangeError(`WG-comp total must be in [${minTotal}, ${maxTotal}] and feasible for the band count`);
  const maxPart = Math.floor(total / 2);
  const minPart = Math.max(1, Math.ceil(minBand * total / frameHeight - EPSILON));
  let remaining = total;
  const parts: number[] = [];
  for (let index = 0; index < n - 1; index += 1) {
    const left = n - index - 1;
    const candidates: number[] = [];
    for (let part = minPart; part <= maxPart; part += 1) {
      const rest = remaining - part;
      if (rest >= left * minPart && rest <= left * maxPart) candidates.push(part);
    }
    if (candidates.length === 0) throw new RangeError('WG-comp could not form a valid weighted partition');
    const part = candidates[randomIndex(random, candidates.length)];
    parts.push(part);
    remaining -= part;
  }
  if (remaining < minPart || remaining > maxPart) throw new RangeError('WG-comp could not form a valid weighted partition');
  parts.push(remaining);
  return parts;
}

export function generateFlagBandWeights(
  spec: FlagWeightSpec,
  count: number,
  options: { frameHeight?: number; canvasHeight?: number; random?: () => number } = {},
): number[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('band count must be a positive integer');
  const frameHeight = options.frameHeight ?? options.canvasHeight ?? FLAG_FIELD_CONFIG.canvasHeight;
  const canvasHeight = options.canvasHeight ?? FLAG_FIELD_CONFIG.canvasHeight;
  let weights: number[];
  switch (spec.kind) {
    case 'equal':
      weights = Array(count).fill(1);
      break;
    case 'sym':
    if (count !== 3 || !WG_SYM_RATIOS.some((ratio) => Math.abs(ratio - spec.ratio) < EPSILON)) {
        throw new RangeError('WG-sym requires three bands and a documented b/a ratio');
      }
      weights = [1, spec.ratio, 1];
      break;
    case '5':
      if (count !== 5) throw new RangeError('WG-5 requires five bands');
      weights = spec.variant === '11211' ? [1, 1, 2, 1, 1] : [1, 2, 1, 2, 1];
      break;
    case 'comp':
      weights = generateCompWeights(
        count,
        { total: spec.total },
        getRandom({ total: spec.total }, options.random),
        frameHeight,
        canvasHeight / FLAG_FIELD_CONFIG.minimumThicknessDivisor,
      );
      break;
    case 'accent': {
      if (count !== 3) throw new RangeError('WG-accent requires exactly three bands');
      const [minDivisor, maxDivisor] = FLAG_FIELD_CONFIG.weights.accentSeparatorDivisors;
      const min = canvasHeight / minDivisor;
      const max = canvasHeight / maxDivisor;
      const thickness = spec.separator ?? canvasHeight / FLAG_FIELD_CONFIG.weights.defaultAccentSeparatorDivisor;
      if (!Number.isFinite(thickness) || thickness < min || thickness > max) {
        throw new RangeError(`WG-accent separator must be between H/12 and H/6 (${min}..${max})`);
      }
      if (frameHeight - thickness < 2 * canvasHeight / FLAG_FIELD_CONFIG.minimumThicknessDivisor) {
        throw new RangeError('WG-accent leaves a broad band thinner than T_MIN');
      }
      weights = [(frameHeight - thickness) / 2, thickness, (frameHeight - thickness) / 2];
      break;
    }
    case 'custom':
      if (spec.weights.length !== count) throw new RangeError('custom weight count must match the number of bands');
      weights = [...spec.weights];
      break;
  }
  const normalized = normalizeWeights(weights);
  const minBand = (options.canvasHeight ?? FLAG_FIELD_CONFIG.canvasHeight) / FLAG_FIELD_CONFIG.minimumThicknessDivisor;
  if (normalized.some((weight) => weight * frameHeight < minBand - EPSILON)) {
    throw new RangeError(`every band must be at least T_MIN (${minBand}) units thick`);
  }
  return normalized;
}

function readWeightSpec(value: unknown): FlagWeightSpec {
  if (!value || typeof value !== 'object') return { kind: 'equal' };
  const spec = value as Record<string, unknown>;
  const kind = String(spec.kind ?? spec.type ?? 'equal').toLowerCase();
  if (kind === 'wg-equal' || kind === 'equal') return { kind: 'equal' };
  if (kind === 'wg-sym' || kind === 'sym') return { kind: 'sym', ratio: Number(spec.ratio ?? spec.bOverA ?? 1) };
  if (kind === 'wg-5' || kind === '5') return { kind: '5', variant: spec.variant === '1:2:1:2:1' || spec.variant === '12121' ? '12121' : '11211' };
  if (kind === 'wg-comp' || kind === 'comp') return { kind: 'comp', ...(spec.total === undefined ? {} : { total: Number(spec.total) }) };
  if (kind === 'wg-accent' || kind === 'accent') return { kind: 'accent', ...(spec.separator === undefined ? {} : { separator: Number(spec.separator) }) };
  if (kind === 'custom') return { kind: 'custom', weights: Array.isArray(spec.weights) ? spec.weights.map(Number) : [] };
  throw new RangeError(`unsupported flag band weight generator "${kind}"`);
}

function slotsFor(params: Record<string, unknown>, fallback: string[]): string[] {
  const value = params.slots;
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || !value.every((slot) => typeof slot === 'string' && slot.length > 0)) {
    throw new TypeError('operator slots must be an array of non-empty strings');
  }
  return value as string[];
}

function patternSlots(patternValue: unknown, count: number, slots: string[]): string[] {
  const pattern = String(patternValue ?? 'CYC').toUpperCase();
  if (slots.length === 0) throw new RangeError('at least one color slot is required');
  switch (pattern) {
    case 'CYC':
      if (slots.length < 2) throw new RangeError('SP-CYC requires at least two slots');
      return Array.from({ length: count }, (_, i) => slots[i % 2]);
    case 'MIRROR': {
      if (count !== 5 || slots.length < 3) throw new RangeError('SP-MIRROR is the five-band pattern ABCBA');
      return [slots[0], slots[1], slots[2], slots[1], slots[0]];
    }
    case 'TRIAD':
      if (slots.length < 3) throw new RangeError('SP-TRIAD requires three slots');
      return Array.from({ length: count }, (_, i) => slots[i % 3]);
    case 'SEP':
      if (count < 3 || count % 2 === 0 || slots.length < 2) throw new RangeError('SP-SEP requires an odd band count of at least three and two slots');
      return Array.from({ length: count }, (_, i) => i % 2 === 0 ? slots[0] : slots[1]);
    case 'DISTINCT':
      if (count > 5 || slots.length < count) throw new RangeError('SP-DISTINCT requires one unique slot per band and at most five bands');
      return slots.slice(0, count);
    default:
      throw new RangeError(`unsupported flag slot pattern "${pattern}"`);
  }
}

function polygonByProjection(frame: FlagFieldFrame, nx: number, ny: number, low: number, high: number): FlagPolygon {
  let polygon = rectPolygon(frame);
  polygon = clipHalfPlane(polygon, (p) => nx * p.x + ny * p.y - low);
  return clipHalfPlane(polygon, (p) => high - nx * p.x - ny * p.y);
}

function bandPolygons(
  frame: FlagFieldFrame,
  weights: number[],
  axisX: number,
  axisY: number,
): FlagPolygonSet[] {
  const corners = rectPolygon(frame);
  const projections = corners.map((p) => axisX * p.x + axisY * p.y);
  const minimum = Math.min(...projections);
  const maximum = Math.max(...projections);
  const span = maximum - minimum;
  let cursor = minimum;
  const regions: FlagPolygonSet[] = [];
  weights.forEach((weight, index) => {
    const next = index === weights.length - 1 ? maximum : cursor + span * weight;
    regions.push([polygonByProjection(frame, axisX, axisY, cursor, next)]);
    cursor = next;
  });
  return regions;
}

function assertPointParam(params: Record<string, unknown>, name: string, defaults: { u: number; v: number }): { u: number; v: number } {
  const raw = params[name] ?? defaults;
  if (!raw || typeof raw !== 'object') throw new TypeError(`${name} must be a relative point`);
  const value = raw as Record<string, unknown>;
  const u = Number(value.u);
  const v = Number(value.v);
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
    throw new RangeError(`${name} coordinates must be in [0, 1]`);
  }
  return { u, v };
}

function lineCutRegions(
  frame: FlagFieldFrame,
  a: FlagPoint,
  b: FlagPoint,
): FlagPolygonSet[] {
  const direction = (p: FlagPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return [
    [clipHalfPlane(rectPolygon(frame), (p) => direction(p))],
    [clipHalfPlane(rectPolygon(frame), (p) => -direction(p))],
  ];
}

function getBandWeights(
  params: Record<string, unknown>,
  count: number,
  frame: FlagFieldFrame,
  options: FlagFieldOptions,
  bandExtent = frame.h,
): number[] {
  return generateFlagBandWeights(readWeightSpec(params.weights), count, {
    frameHeight: bandExtent,
    canvasHeight: options.canvasHeight ?? FLAG_FIELD_CONFIG.canvasHeight,
    random: options.random,
  });
}

function getCount(params: Record<string, unknown>, key: string, defaultValue: number, min: number, max: number): number {
  const count = params[key] === undefined ? defaultValue : Number(params[key]);
  if (!Number.isInteger(count) || count < min || count > max) throw new RangeError(`${key} must be an integer in [${min}, ${max}]`);
  return count;
}

function pointOnFrame(frame: FlagFieldFrame, u: number, v: number): FlagPoint {
  return point(frame.x0 + u * frame.w, frame.y0 + v * frame.h);
}

function sectorPolygons(frame: FlagFieldFrame, center: FlagPoint, start: number, end: number): FlagPolygonSet {
  const rect = rectPolygon(frame);
  const a = point(Math.cos(start), Math.sin(start));
  const b = point(Math.cos(end), Math.sin(end));
  const cross = (ray: FlagPoint, p: FlagPoint) => ray.x * (p.y - center.y) - ray.y * (p.x - center.x);
  let sector = clipHalfPlane(rect, (p) => cross(a, p));
  sector = clipHalfPlane(sector, (p) => -cross(b, p));
  return sector.length >= 3 ? [sector] : [];
}

function makeBandPolygons(frame: FlagFieldFrame, boundaries: number[]): FlagPolygonSet[] {
  const result: FlagPolygonSet[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const top = boundaries[i];
    const bottom = boundaries[i + 1];
    result.push([[
      point(frame.x0, frame.y0 + top * frame.h),
      point(frame.x0 + frame.w, frame.y0 + top * frame.h),
      point(frame.x0 + frame.w, frame.y0 + bottom * frame.h),
      point(frame.x0, frame.y0 + bottom * frame.h),
    ]]);
  }
  return result;
}

function chevronnyRegions(frame: FlagFieldFrame, params: Record<string, unknown>, count: number): FlagPolygonSet[] {
  const apex = assertPointParam(params, 'vertex', FLAG_FIELD_CONFIG.operators.G11.defaultVertex);
  const amplitude = params.amplitude === undefined ? FLAG_FIELD_CONFIG.operators.G11.defaultAmplitude : Number(params.amplitude);
  const maxAmplitude = FLAG_FIELD_CONFIG.operators.G11.maxAmplitudePerBand / count;
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > maxAmplitude) {
    throw new RangeError(`G11 amplitude must be in [0, ${maxAmplitude}]`);
  }
  const boundary = (level: number): FlagPoint[] => {
    const peak = level + amplitude;
    return [
      point(frame.x0, frame.y0 + level * frame.h),
      point(frame.x0 + apex.u * frame.w, frame.y0 + peak * frame.h),
      point(frame.x0 + frame.w, frame.y0 + level * frame.h),
    ];
  };
  const result: FlagPolygonSet[] = [];
  for (let index = 0; index < count; index += 1) {
    const lower = index === 0
      ? [point(frame.x0, frame.y0), point(frame.x0 + frame.w, frame.y0)]
      : boundary(index / count);
    const upper = index === count - 1
      ? [point(frame.x0, frame.y0 + frame.h), point(frame.x0 + frame.w, frame.y0 + frame.h)]
      : boundary((index + 1) / count);
    const polygon = cleanPolygon([...lower, ...upper.slice().reverse()]);
    result.push([polygon]);
  }
  return result;
}

function rotatedSquare(
  center: FlagPoint,
  size: number,
  angle: number,
  frame: FlagFieldFrame,
  ix: number,
  iy: number,
): FlagPolygon {
  const local = [
    [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5],
  ];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cx = center.x + ix * size * c - iy * size * s;
  const cy = center.y + ix * size * s + iy * size * c;
  return local.map(([x, y]) => point(cx + size * (x * c - y * s), cy + size * (x * s + y * c)));
}

function lozengyRegions(frame: FlagFieldFrame, params: Record<string, unknown>, canvasHeight: number): FlagPolygonSet[] {
  const [minAngle, maxAngle] = FLAG_FIELD_CONFIG.operators.G10.angles;
  const alpha = Number(params.angle ?? FLAG_FIELD_CONFIG.operators.G10.defaultAngle) * Math.PI / 180;
  if (!Number.isFinite(alpha) || alpha < minAngle * Math.PI / 180 - EPSILON || alpha > maxAngle * Math.PI / 180 + EPSILON) {
    throw new RangeError('G10 angle must be in [50, 70] degrees');
  }
  const [minCellDivisor, maxCellDivisor] = FLAG_FIELD_CONFIG.operators.G10.cellSizeDivisors;
  const size = Number(params.cellSize ?? canvasHeight / FLAG_FIELD_CONFIG.operators.G10.defaultCellSizeDivisor);
  if (!Number.isFinite(size) || size < canvasHeight / minCellDivisor || size > canvasHeight / maxCellDivisor) {
    throw new RangeError('G10 cellSize must be between H/10 and H/4');
  }
  const originMode = String(params.origin ?? FLAG_FIELD_CONFIG.operators.G10.defaultOrigin).toUpperCase();
  const center = originMode === 'CORNER'
    ? point(frame.x0, frame.y0)
    : point(frame.x0 + frame.w / 2, frame.y0 + frame.h / 2);
  if (!['CENTER', 'CORNER'].includes(originMode)) throw new RangeError('G10 origin must be CENTER or CORNER');
  const count = Math.ceil(Math.hypot(frame.w, frame.h) / size) + 3;
  const results: FlagPolygonSet[] = [[], []];
  for (let iy = -count; iy <= count; iy += 1) {
    for (let ix = -count; ix <= count; ix += 1) {
      const cell = rotatedSquare(center, size, alpha, frame, ix, iy);
      const clipped = clipConvex(cell, rectPolygon(frame));
      if (clipped.length >= 3) results[(ix + iy + (originMode === 'CENTER' ? count : 0)) & 1].push(clipped);
    }
  }
  return results;
}

function rayToRect(center: FlagPoint, angle: number, frame: FlagFieldFrame): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const candidates: number[] = [];
  if (dx > EPSILON) candidates.push((frame.x0 + frame.w - center.x) / dx);
  if (dx < -EPSILON) candidates.push((frame.x0 - center.x) / dx);
  if (dy > EPSILON) candidates.push((frame.y0 + frame.h - center.y) / dy);
  if (dy < -EPSILON) candidates.push((frame.y0 - center.y) / dy);
  const positive = candidates.filter((t) => t >= -EPSILON);
  if (positive.length === 0) throw new RangeError('G12 center must be inside its frame');
  return Math.min(...positive);
}

function concentricRegions(
  frame: FlagFieldFrame,
  params: Record<string, unknown>,
  count: number,
  options: FlagFieldOptions,
): FlagPolygonSet[] {
  const centerRelative = assertPointParam(params, 'center', FLAG_FIELD_CONFIG.operators.G12.defaultCenter);
  const center = pointOnFrame(frame, centerRelative.u, centerRelative.v);
  const figure = String(params.figure ?? FLAG_FIELD_CONFIG.operators.G12.defaultFigure).toLowerCase();
  if (!['circle', 'square', 'rhombus', 'rectangle'].includes(figure)) {
    throw new RangeError('G12 figure must be circle, square, rhombus, or rectangle');
  }
  const weights = getBandWeights(params, count, frame, options);
  const samples = FLAG_FIELD_CONFIG.operators.G12.polygonSamples;
  const frameContour: FlagPolygon = [];
  const sideSamples = samples / 4;
  for (let i = 0; i < sideSamples; i += 1) {
    const t = i / sideSamples;
    frameContour.push(point(frame.x0 + t * frame.w, frame.y0));
  }
  for (let i = 0; i < sideSamples; i += 1) {
    const t = i / sideSamples;
    frameContour.push(point(frame.x0 + frame.w, frame.y0 + t * frame.h));
  }
  for (let i = 0; i < sideSamples; i += 1) {
    const t = i / sideSamples;
    frameContour.push(point(frame.x0 + (1 - t) * frame.w, frame.y0 + frame.h));
  }
  for (let i = 0; i < sideSamples; i += 1) {
    const t = i / sideSamples;
    frameContour.push(point(frame.x0, frame.y0 + (1 - t) * frame.h));
  }
  const contours: FlagPolygon[] = [];
  let cumulative = 0;
  for (let ring = 0; ring < count; ring += 1) {
    cumulative += weights[ring];
    const scale = Math.max(0, 1 - cumulative);
    const contour: FlagPolygon = [];
    for (const edgePoint of frameContour) {
      const angle = Math.atan2(edgePoint.y - center.y, edgePoint.x - center.x);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const frameRadius = rayToRect(center, angle, frame);
      let shapeRadius: number;
      switch (figure) {
        case 'circle':
          shapeRadius = Math.min(frame.w, frame.h) / 2;
          break;
        case 'square':
          shapeRadius = Math.min(frame.w, frame.h) / (2 * Math.max(Math.abs(dx), Math.abs(dy)));
          break;
        case 'rhombus':
          shapeRadius = Math.min(frame.w, frame.h) / (2 * (Math.abs(dx) + Math.abs(dy)));
          break;
        default:
          shapeRadius = Math.min(
            frame.w / 2 / Math.max(Math.abs(dx), EPSILON),
            frame.h / 2 / Math.max(Math.abs(dy), EPSILON),
          );
      }
      const radius = Math.min(frameRadius, shapeRadius) * scale;
      contour.push(point(center.x + dx * radius, center.y + dy * radius));
    }
    contours.push(contour);
  }
  const result: FlagPolygonSet[] = [];
  let outer = frameContour;
  for (const inner of contours) {
    const cells: FlagPolygonSet = [];
    for (let i = 0; i < samples; i += 1) {
      const next = (i + 1) % samples;
      const quad = cleanPolygon([outer[i], outer[next], inner[next], inner[i]]);
      if (quad.length >= 3) cells.push(quad);
    }
    result.push(cells);
    outer = inner;
  }
  return result;
}

function operatorRegions(
  op: FlagFieldOperator,
  frame: FlagFieldFrame,
  params: Record<string, unknown>,
  options: FlagFieldOptions,
): { polygons: FlagPolygonSet[]; slots: string[] } {
  const canvasHeight = options.canvasHeight ?? FLAG_FIELD_CONFIG.canvasHeight;
  const frameRect = rectPolygon(frame);
  const allSlots = slotsFor(params, options.slots ?? DEFAULT_SLOTS);
  let polygons: FlagPolygonSet[];
  let slots: string[];
  switch (op) {
    case 'G01':
      polygons = [[frameRect]];
      slots = [allSlots[0] ?? 's1'];
      break;
    case 'G02': {
      const count = getCount(params, 'n', FLAG_FIELD_CONFIG.operators.G02.defaultBands,
        FLAG_FIELD_CONFIG.operators.G02.bands[0], FLAG_FIELD_CONFIG.operators.G02.bands[1]);
      const axis = String(params.axis ?? FLAG_FIELD_CONFIG.operators.G02.defaultAxis).toUpperCase();
      if (axis !== 'H' && axis !== 'V') throw new RangeError('G02 axis must be H or V');
      const weights = getBandWeights(params, count, frame, options, axis === 'H' ? frame.h : frame.w);
      polygons = axis === 'H'
        ? bandPolygons(frame, weights, 0, 1)
        : bandPolygons(frame, weights, 1, 0);
      slots = patternSlots(params.pattern ?? params.sp, count, allSlots);
      break;
    }
    case 'G03': {
      const count = getCount(params, 'n', FLAG_FIELD_CONFIG.operators.G03.defaultBands,
        FLAG_FIELD_CONFIG.operators.G03.bands[0], FLAG_FIELD_CONFIG.operators.G03.bands[1]);
      const angleParam = params.angle ?? params.theta ?? FLAG_FIELD_CONFIG.operators.G03.defaultAngle;
      let angle: number;
      if (typeof angleParam === 'string' && angleParam.toUpperCase() === 'DIAGONAL') {
        angle = Math.atan2(frame.h, frame.w);
      } else {
        const degrees = Number(angleParam);
        if (!FLAG_FIELD_CONFIG.operators.G03.angles.includes(degrees as 30 | 45 | 60)) {
          throw new RangeError('G03 angle must be DIAGONAL, 30°, 45°, or 60°');
        }
        angle = degrees * Math.PI / 180;
      }
      if (!Number.isFinite(angle)) throw new RangeError('G03 angle must be a number or DIAGONAL');
      if (params.mirror === true) angle = -angle;
      const directionX = -Math.sin(angle);
      const directionY = Math.cos(angle);
      const corners = rectPolygon(frame);
      const projections = corners.map((p) => directionX * p.x + directionY * p.y);
      const projectionSpan = Math.max(...projections) - Math.min(...projections);
      const weights = getBandWeights(params, count, frame, options, projectionSpan);
      polygons = bandPolygons(frame, weights, directionX, directionY);
      slots = patternSlots(params.pattern ?? params.sp, count, allSlots);
      break;
    }
    case 'G04': {
      const mode = String(params.mode ?? 'PALE').toUpperCase();
      const p = Number(params.p ?? FLAG_FIELD_CONFIG.operators.G05.defaultSplit);
      if (mode === 'PALE' || mode === 'FESS') {
        if (!FLAG_FIELD_CONFIG.operators.G04.splitFractions.some((v) => Math.abs(v - p) < EPSILON)) {
          throw new RangeError('G04 PALE/FESS p must be one of the documented fractions');
        }
        polygons = bandPolygons(frame, [p, 1 - p], mode === 'PALE' ? 1 : 0, mode === 'PALE' ? 0 : 1);
        // Keep order as left/right for PALE and top/bottom for FESS.
        slots = patternSlots(params.pattern ?? params.sp, 2, allSlots);
      } else if (mode === 'BEND') {
        const slash = String(params.diagonal ?? 'BACKSLASH').toUpperCase();
        if (slash !== 'BACKSLASH' && slash !== 'SLASH') throw new RangeError('G04 BEND diagonal must be BACKSLASH or SLASH');
        polygons = slash === 'BACKSLASH'
          ? lineCutRegions(frame, point(frame.x0, frame.y0), point(frame.x0 + frame.w, frame.y0 + frame.h))
          : lineCutRegions(frame, point(frame.x0 + frame.w, frame.y0), point(frame.x0, frame.y0 + frame.h));
        slots = patternSlots(params.pattern ?? params.sp, 2, allSlots);
      } else if (mode === 'CHEVRON') {
        const vertex = assertPointParam(params, 'vertex', FLAG_FIELD_CONFIG.operators.G04.defaultChevronVertex);
        const slope = Number(params.slope ?? FLAG_FIELD_CONFIG.operators.G04.defaultChevronSlope);
        if (!Number.isFinite(slope) || Math.abs(slope) <= EPSILON ||
          Math.abs(vertex.u * FLAG_FIELD_CONFIG.operators.G04.chevronVertexDivisor -
            Math.round(vertex.u * FLAG_FIELD_CONFIG.operators.G04.chevronVertexDivisor)) > EPSILON ||
          Math.abs(vertex.v * FLAG_FIELD_CONFIG.operators.G04.chevronVertexDivisor -
            Math.round(vertex.v * FLAG_FIELD_CONFIG.operators.G04.chevronVertexDivisor)) > EPSILON) {
          throw new RangeError('G04 CHEVRON requires a nonzero signed slope and vertex coordinates in multiples of 1/24');
        }
        const leftV = vertex.v + slope * vertex.u;
        const rightV = vertex.v + slope * (1 - vertex.u);
        if (leftV < -EPSILON || leftV > 1 + EPSILON || rightV < -EPSILON || rightV > 1 + EPSILON) {
          throw new RangeError('G04 CHEVRON arms must meet the left and right frame edges');
        }
        const a = pointOnFrame(frame, 0, leftV);
        const tip = pointOnFrame(frame, vertex.u, vertex.v);
        const b = pointOnFrame(frame, 1, rightV);
        const path = [a, tip, b];
        const perimeterPosition = (p: FlagPoint): number => {
          const x = (p.x - frame.x0) / frame.w;
          const y = (p.y - frame.y0) / frame.h;
          if (Math.abs(y) < EPSILON) return x;
          if (Math.abs(x - 1) < EPSILON) return 1 + y;
          if (Math.abs(y - 1) < EPSILON) return 3 - x;
          return 4 - y;
        };
        const arc = (from: FlagPoint, to: FlagPoint, direction: 1 | -1): FlagPoint[] => {
          let start = perimeterPosition(from);
          let end = perimeterPosition(to);
          if (direction === 1 && end <= start) end += 4;
          if (direction === -1 && end >= start) end -= 4;
          const samples = [from];
          const corners = [
            point(frame.x0, frame.y0), point(frame.x0 + frame.w, frame.y0),
            point(frame.x0 + frame.w, frame.y0 + frame.h), point(frame.x0, frame.y0 + frame.h),
            point(frame.x0, frame.y0),
          ];
          if (direction === 1) {
            for (let corner = Math.floor(start) + 1; corner < end - EPSILON; corner += 1) {
              samples.push(corners[corner % 4]);
            }
          } else {
            for (let corner = Math.ceil(start) - 1; corner > end + EPSILON; corner -= 1) {
              samples.push(corners[((corner % 4) + 4) % 4]);
            }
          }
          samples.push(to);
          return samples;
        };
        const regions = [
          cleanPolygon([...path, ...arc(b, a, 1).slice(1, -1)]),
          cleanPolygon([...path.slice().reverse(), ...arc(a, b, 1).slice(1, -1)]),
        ].filter((polygon) => polygon.length >= 3);
        if (regions.length !== 2) throw new RangeError('G04 CHEVRON could not form two regions');
        // The boundary polyline is shared exactly by both regions; perimeter arcs close each side.
        polygons = regions.map((polygon) => [polygon]);
        slots = patternSlots(params.pattern ?? params.sp, 2, allSlots);
      } else {
        throw new RangeError('G04 mode must be PALE, FESS, BEND, or CHEVRON');
      }
      break;
    }
    case 'G05': {
      const allowed = FLAG_FIELD_CONFIG.operators.G05.splitFractions;
      const px = Number(params.px ?? FLAG_FIELD_CONFIG.operators.G05.defaultSplit);
      const py = Number(params.py ?? FLAG_FIELD_CONFIG.operators.G05.defaultSplit);
      if (!allowed.some((v) => Math.abs(v - px) < EPSILON) || !allowed.some((v) => Math.abs(v - py) < EPSILON)) {
        throw new RangeError('G05 px and py must be documented fractions');
      }
      const x = frame.x0 + px * frame.w;
      const y = frame.y0 + py * frame.h;
      polygons = [
        [[point(frame.x0, frame.y0), point(x, frame.y0), point(x, y), point(frame.x0, y)]],
        [[point(x, frame.y0), point(frame.x0 + frame.w, frame.y0), point(frame.x0 + frame.w, y), point(x, y)]],
        [[point(frame.x0, y), point(x, y), point(x, frame.y0 + frame.h), point(frame.x0, frame.y0 + frame.h)]],
        [[point(x, y), point(frame.x0 + frame.w, y), point(frame.x0 + frame.w, frame.y0 + frame.h), point(x, frame.y0 + frame.h)]],
      ];
      const mode = String(params.slotsMode ?? params.mode ?? 'CHECKER').toUpperCase();
      if (mode === 'CHECKER') slots = [allSlots[0], allSlots[1], allSlots[1], allSlots[0]];
      else if (mode === 'AB/CD') slots = [allSlots[0], allSlots[1], allSlots[2], allSlots[3]];
      else if (mode === 'AB/BB') slots = [allSlots[0], allSlots[1], allSlots[1], allSlots[1]];
      else throw new RangeError('G05 slotsMode must be CHECKER, AB/CD, or AB/BB');
      if (slots.some((slot) => !slot)) throw new RangeError(`G05 ${mode} requires more color slots`);
      break;
    }
    case 'G06': {
      const centerRelative = assertPointParam(params, 'center', FLAG_FIELD_CONFIG.operators.G06.defaultCenter);
      const center = pointOnFrame(frame, centerRelative.u, centerRelative.v);
      const corners = [
        point(frame.x0, frame.y0), point(frame.x0 + frame.w, frame.y0),
        point(frame.x0 + frame.w, frame.y0 + frame.h), point(frame.x0, frame.y0 + frame.h),
      ];
      polygons = corners.map((corner, index) => [[corner, corners[(index + 1) % 4], center]]);
      const mode = String(params.slotsMode ?? 'TOP_BOTTOM_SIDES').toUpperCase();
      if (mode === 'TOP_BOTTOM_SIDES') slots = [allSlots[0], allSlots[1], allSlots[0], allSlots[1]];
      else if (mode === 'ALL_DISTINCT') slots = allSlots.slice(0, 4);
      else if (mode === 'TOP_DISTINCT') slots = [allSlots[0], allSlots[1], allSlots[1], allSlots[1]];
      else throw new RangeError('G06 slotsMode must be TOP_BOTTOM_SIDES, ALL_DISTINCT, or TOP_DISTINCT');
      if (slots.length !== 4 || slots.some((slot) => !slot)) throw new RangeError(`G06 ${mode} requires more color slots`);
      break;
    }
    case 'G07': {
      const centerRelative = assertPointParam(params, 'center', FLAG_FIELD_CONFIG.operators.G07.defaultCenter);
      const center = pointOnFrame(frame, centerRelative.u, centerRelative.v);
      const angleSet = params.angles === '90/135/135' ? FLAG_FIELD_CONFIG.operators.G07.angleSets[1] : FLAG_FIELD_CONFIG.operators.G07.angleSets[0];
      const start = Number(params.startAngle ?? FLAG_FIELD_CONFIG.operators.G07.defaultStartAngle) * Math.PI / 180;
      const regions: FlagPolygonSet[] = [];
      let current = start;
      for (const degrees of angleSet) {
        const next = current + degrees * Math.PI / 180;
        const region = sectorPolygons(frame, center, current, next);
        if (region.length > 0) regions.push(region);
        current = next;
      }
      if (regions.length !== 3) throw new RangeError('G07 Y division must create three non-empty regions');
      polygons = regions;
      slots = allSlots.slice(0, 3);
      if (slots.some((slot) => !slot)) throw new RangeError('G07 requires three color slots');
      break;
    }
    case 'G08': {
      const count = params.n === undefined ? FLAG_FIELD_CONFIG.operators.G08.defaultCount : Number(params.n);
      if (!FLAG_FIELD_CONFIG.operators.G08.counts.includes(count as 8 | 12 | 16 | 24)) throw new RangeError('G08 n must be 8, 12, 16, or 24');
      const rawCenter = params.center && typeof params.center === 'object'
        ? params.center as Record<string, unknown>
        : FLAG_FIELD_CONFIG.operators.G08.defaultCenter;
      const center = { u: Number(rawCenter.u), v: Number(rawCenter.v) };
      const [minFanCenter, maxFanCenter] = FLAG_FIELD_CONFIG.operators.G08.fanCenterRange;
      if (!Number.isFinite(center.u) || center.u < minFanCenter || center.u > maxFanCenter ||
        !Number.isFinite(center.v) || center.v < 0 || center.v > 1) {
        throw new RangeError('G08 center.u must be in [-0.3, 1.3] and center.v in [0, 1]');
      }
      if (params.fan !== true &&
        (center.u < 0.5 - FLAG_FIELD_CONFIG.operators.G08.maximumPoleShift || center.u > 0.5)) {
        throw new RangeError('G08 non-fan center may shift toward the pole by at most 0.2 from the default x=0.5');
      }
      const absoluteCenter = pointOnFrame(frame, center.u, center.v);
      const start = Number(params.startAngle ?? -90) * Math.PI / 180;
      const sectors = Array.from({ length: count }, (_, index) => sectorPolygons(
        frame,
        absoluteCenter,
        start + index * Math.PI * 2 / count,
        start + (index + 1) * Math.PI * 2 / count,
      ));
      const colors = Number(params.colors ?? FLAG_FIELD_CONFIG.operators.G08.colors[0]);
      if (!FLAG_FIELD_CONFIG.operators.G08.colors.includes(colors as 2 | 3)) throw new RangeError('G08 colors must be 2 or 3');
      polygons = Array.from({ length: colors }, () => [] as FlagPolygonSet);
      sectors.forEach((region, index) => {
        polygons[index % colors].push(...region);
      });
      const activeColors = polygons
        .map((region, index) => ({ region, index }))
        .filter(({ region }) => region.length > 0);
      polygons = activeColors.map(({ region }) => region);
      slots = activeColors.map(({ index }) => allSlots[index]);
      if (slots.some((slot) => !slot)) throw new RangeError(`G08 requires ${colors} color slots`);
      break;
    }
    case 'G09': {
      const nx = getCount(params, 'nx', FLAG_FIELD_CONFIG.operators.G09.defaultColumns,
        FLAG_FIELD_CONFIG.operators.G09.columns[0], FLAG_FIELD_CONFIG.operators.G09.columns[1]);
      const ny = Math.max(1, Math.round(nx * frame.h / frame.w));
      const origin = String(params.origin ?? FLAG_FIELD_CONFIG.operators.G09.defaultOrigin).toUpperCase();
      if (origin !== 'CORNER' && origin !== 'CENTER') throw new RangeError('G09 origin must be CORNER or CENTER');
      const checkerPolygons: [FlagPolygonSet, FlagPolygonSet] = [[], []];
      const cellSize = frame.w / nx;
      const rows = Math.max(ny, Math.ceil(frame.h / cellSize));
      const originX = origin === 'CENTER' ? frame.x0 + frame.w / 2 : frame.x0;
      const originY = origin === 'CENTER' ? frame.y0 + frame.h / 2 : frame.y0;
      const firstCol = origin === 'CENTER' ? -Math.ceil(nx / 2) - 1 : -1;
      const lastCol = origin === 'CENTER' ? Math.ceil(nx / 2) + 1 : nx + 1;
      const firstRow = origin === 'CENTER' ? -Math.ceil(rows / 2) - 1 : -1;
      const lastRow = origin === 'CENTER' ? Math.ceil(rows / 2) + 1 : rows + 1;
      for (let row = firstRow; row < lastRow; row += 1) {
        for (let col = firstCol; col < lastCol; col += 1) {
          const x0 = originX + col * cellSize;
          const y0 = originY + row * cellSize;
          const cell = [
            point(x0, y0), point(x0 + cellSize, y0),
            point(x0 + cellSize, y0 + cellSize), point(x0, y0 + cellSize),
          ];
          const clipped = clipConvex(cell, frameRect);
          if (clipped.length > 0) {
            checkerPolygons[(col + row) & 1].push(clipped);
          }
        }
      }
      polygons = checkerPolygons.filter((cells) => cells.length > 0);
      slots = polygons.map((_, index) => allSlots[index]);
      break;
    }
    case 'G10':
      polygons = lozengyRegions(frame, params, canvasHeight);
      slots = polygons.map((_, index) => allSlots[index & 1]);
      break;
    case 'G11': {
      const count = getCount(params, 'n', FLAG_FIELD_CONFIG.operators.G11.defaultBands,
        FLAG_FIELD_CONFIG.operators.G11.bands[0], FLAG_FIELD_CONFIG.operators.G11.bands[1]);
      polygons = chevronnyRegions(frame, params, count);
      const mode = String(params.pattern ?? 'CYC').toUpperCase();
      slots = patternSlots(mode, count, allSlots);
      break;
    }
    case 'G12': {
      const count = getCount(params, 'n', FLAG_FIELD_CONFIG.operators.G12.defaultBands,
        FLAG_FIELD_CONFIG.operators.G12.bands[0], FLAG_FIELD_CONFIG.operators.G12.bands[1]);
      polygons = concentricRegions(frame, params, count, options);
      slots = patternSlots(params.pattern ?? 'CYC', count, allSlots);
      break;
    }
  }

  if (polygons.length === 0 || polygons.length > FLAG_FIELD_CONFIG.limits.maxRegions) {
    throw new RangeError(`${op} must produce between 1 and ${FLAG_FIELD_CONFIG.limits.maxRegions} regions`);
  }
  if (slots.length !== polygons.length) throw new RangeError(`${op} produced a mismatched number of color slots`);
  if (['G02', 'G03', 'G04', 'G11'].includes(op)) {
    const lineStyle = params.line_style ?? params.lineStyle ?? FLAG_FIELD_CONFIG.lineStyles.default;
    polygons = styleSharedFlagRegionBoundaries(polygons, lineStyle as string | FlagLineStyle, canvasHeight);
  }
  for (const region of polygons) {
    if (region.length === 0 || region.some((polygon) => polygon.length < 3 || flagPolygonArea(polygon) <= EPSILON)) {
      throw new RangeError(`${op} produced an empty or degenerate region`);
    }
  }
  return { polygons, slots };
}

function childRegionCount(node: FlagFieldNode): number {
  const params = node.params ?? {};
  switch (node.op) {
    case 'G01': return 1;
    case 'G02': return Number(params.n ?? FLAG_FIELD_CONFIG.operators.G02.defaultBands);
    case 'G03': return Number(params.n ?? FLAG_FIELD_CONFIG.operators.G03.defaultBands);
    case 'G04': return 2;
    case 'G05': case 'G06': return 4;
    case 'G07': return 3;
    case 'G08': return Number(params.colors ?? FLAG_FIELD_CONFIG.operators.G08.colors[0]);
    case 'G09': return 2;
    case 'G10': return 2;
    case 'G11': return Number(params.n ?? FLAG_FIELD_CONFIG.operators.G11.defaultBands);
    case 'G12': return Number(params.n ?? FLAG_FIELD_CONFIG.operators.G12.defaultBands);
  }
}

export function validateFlagFieldTree(root: FlagFieldNode): FlagFieldIssue[] {
  const issues: FlagFieldIssue[] = [];
  let totalRegions = 0;
  const visit = (node: FlagFieldNode, path: string, depth: number) => {
    if (!node || typeof node !== 'object' || !['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10', 'G11', 'G12'].includes(node.op)) {
      issues.push({ path, message: 'must be a G01–G12 field operator' });
      return;
    }
    if (depth + 1 > FLAG_FIELD_CONFIG.limits.maxDepth) {
      issues.push({ path, message: `field split depth cannot exceed ${FLAG_FIELD_CONFIG.limits.maxDepth}` });
    }
    const count = childRegionCount(node);
    if (!Number.isInteger(count) || count < 1) {
      issues.push({ path, message: 'operator has an invalid region count' });
      return;
    }
    totalRegions += count;
    if (node.children !== undefined) {
      if (!Array.isArray(node.children) || node.children.length !== count) {
        issues.push({ path: `${path}.children`, message: `must contain exactly ${count} child operators` });
      } else if (depth + 1 < FLAG_FIELD_CONFIG.limits.maxDepth) {
        node.children.forEach((child, index) => visit(child, `${path}.children[${index}]`, depth + 1));
      } else if (node.children.length > 0) {
        issues.push({ path: `${path}.children`, message: `field split depth cannot exceed ${FLAG_FIELD_CONFIG.limits.maxDepth}` });
      }
    }
  };
  visit(root, '$', 0);
  if (totalRegions > FLAG_FIELD_CONFIG.limits.maxRegions) {
    issues.push({ path: '$', message: `field region count ${totalRegions} exceeds ${FLAG_FIELD_CONFIG.limits.maxRegions}` });
  }
  return issues;
}

function buildNode(
  node: FlagFieldNode,
  frame: FlagFieldFrame,
  depth: number,
  clipChain: FlagPolygonSet[],
  options: FlagFieldOptions,
  result: FlagFieldResult,
): void {
  const params = node.params ?? {};
  const generated = operatorRegions(node.op, frame, params, options);
  const framePolygon = rectPolygon(frame);
  const defaultSlot = generated.slots[0];
  result.paintLayers.push({
    kind: 'underpaint',
    op: node.op,
    slot: defaultSlot,
    polygons: [framePolygon],
    clipChain: clipChain.map((set) => set.map((polygon) => polygon.map(({ x, y }) => point(x, y)))),
    depth,
  });
  const count = generated.polygons.length;
  if (node.children && node.children.length !== count) {
    throw new RangeError(`${node.op} requires exactly ${count} child operators when children are provided`);
  }

  generated.polygons.forEach((polygons, index) => {
    const nextClipChain = [...clipChain, polygons];
    const visiblePolygons = clipFlagPolygons(polygons, clipChain);
    const visibleArea = flagPolygonSetArea(visiblePolygons);
    const region: FlagFieldRegion = {
      op: node.op,
      index,
      slot: generated.slots[index],
      polygons,
      clipChain: nextClipChain,
      visiblePolygons,
      area: visibleArea,
      depth,
    };
    result.regions.push(region);
    result.paintLayers.push({
      kind: 'region',
      op: node.op,
      slot: region.slot,
      polygons,
      clipChain: clipChain.map((set) => set.map((polygon) => polygon.map(({ x, y }) => point(x, y)))),
      depth,
      regionIndex: index,
    });
    if (node.children?.[index]) {
      buildNode(node.children[index], {
        x0: Math.min(...polygons.flatMap((polygon) => polygon.map(({ x }) => x))),
        y0: Math.min(...polygons.flatMap((polygon) => polygon.map(({ y }) => y))),
        w: Math.max(...polygons.flatMap((polygon) => polygon.map(({ x }) => x))) -
          Math.min(...polygons.flatMap((polygon) => polygon.map(({ x }) => x))),
        h: Math.max(...polygons.flatMap((polygon) => polygon.map(({ y }) => y))) -
          Math.min(...polygons.flatMap((polygon) => polygon.map(({ y }) => y))),
      }, depth + 1, nextClipChain, options, result);
    }
  });
  result.regionCount += count;
  result.maxDepth = Math.max(result.maxDepth, depth + 1);
}

/** Build a bounded field operator tree, preserving parent clip chains and paint order. */
export function buildFlagField(
  root: FlagFieldNode,
  frame: FlagFieldFrame,
  options: FlagFieldOptions = {},
): FlagFieldResult {
  assertFrame(frame);
  const issues = validateFlagFieldTree(root);
  if (issues.length > 0) {
    throw new RangeError(`invalid flag field tree:\n${issues.map(({ path, message }) => `- ${path}: ${message}`).join('\n')}`);
  }
  const result: FlagFieldResult = { regions: [], paintLayers: [], regionCount: 0, maxDepth: 0 };
  buildNode(root, frame, 0, options.clipChain ?? [], options, result);
  if (result.regionCount > FLAG_FIELD_CONFIG.limits.maxRegions || result.maxDepth > FLAG_FIELD_CONFIG.limits.maxDepth) {
    throw new RangeError('flag field exceeds the documented region/depth limits');
  }
  return result;
}
