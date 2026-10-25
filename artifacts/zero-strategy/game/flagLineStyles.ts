import { FLAG_LINE_STYLE_CONFIG } from './flagLineStyleConfig';

export interface BoundaryPoint {
  x: number;
  y: number;
}

export type FlagLineStyleName =
  | 'STRAIGHT'
  | 'EMBATTLED'
  | 'DANCETTY'
  | 'WAVY'
  | 'ENGRAILED'
  | 'INVECTED'
  | 'NEBULY';

export interface FlagLineStyle {
  type: FlagLineStyleName;
  amplitude?: number;
  period?: number;
}

export interface GeneratedFlagBoundary {
  points: BoundaryPoint[];
  length: number;
  periods: number;
  periodLength: number;
  amplitude: number;
}

const STYLE_NAMES = new Set<FlagLineStyleName>([
  'STRAIGHT',
  'EMBATTLED',
  'DANCETTY',
  'WAVY',
  'ENGRAILED',
  'INVECTED',
  'NEBULY',
]);
const EPSILON = 1e-8;

function pointAtDistance(path: BoundaryPoint[], distance: number): BoundaryPoint {
  let remaining = distance;
  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length + EPSILON) {
      const t = length <= EPSILON ? 0 : Math.max(0, Math.min(1, remaining / length));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return { ...path[path.length - 1] };
}

function tangentAtDistance(path: BoundaryPoint[], distance: number): BoundaryPoint {
  let remaining = distance;
  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (remaining <= length + EPSILON || index === path.length - 2) {
      if (length <= EPSILON) return { x: 1, y: 0 };
      return { x: dx / length, y: dy / length };
    }
    remaining -= length;
  }
  return { x: 1, y: 0 };
}

function symmetricPeriodSign(index: number, count: number): number {
  return Math.floor(Math.min(index, count - 1 - index) / 1) % 2 === 0 ? 1 : -1;
}

function parseStyle(input: FlagLineStyle | FlagLineStyleName | string | undefined): FlagLineStyle {
  if (input === undefined) return { type: 'STRAIGHT' };
  const raw: { type: unknown; amplitude?: number; period?: number } =
    typeof input === 'string' ? { type: input } : input;
  if (!raw || typeof raw !== 'object') throw new TypeError('line_style must be a style name or style object');
  const type = String(raw.type).toUpperCase() as FlagLineStyleName;
  if (!STYLE_NAMES.has(type)) throw new RangeError(`unsupported flag line style "${raw.type}"`);
  return { type, amplitude: raw.amplitude, period: raw.period };
}

export function resolveFlagLineStyle(
  input: FlagLineStyle | FlagLineStyleName | string | undefined,
  canvasHeight: number,
): Required<FlagLineStyle> {
  if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) {
    throw new RangeError('canvasHeight must be finite and positive');
  }
  const style = parseStyle(input);
  const [maxAmplitudeDivisor, minAmplitudeDivisor] = FLAG_LINE_STYLE_CONFIG.amplitudeDivisors;
  const [maxPeriodDivisor, minPeriodDivisor] = FLAG_LINE_STYLE_CONFIG.periodDivisors;
  const amplitude = style.amplitude ?? canvasHeight / FLAG_LINE_STYLE_CONFIG.defaultAmplitudeDivisor;
  const period = style.period ?? canvasHeight / FLAG_LINE_STYLE_CONFIG.defaultPeriodDivisor;
  const minAmplitude = canvasHeight / maxAmplitudeDivisor;
  const maxAmplitude = canvasHeight / minAmplitudeDivisor;
  const minPeriod = canvasHeight / maxPeriodDivisor;
  const maxPeriod = canvasHeight / minPeriodDivisor;
  if (!Number.isFinite(amplitude) || amplitude < minAmplitude - EPSILON || amplitude > maxAmplitude + EPSILON) {
    throw new RangeError(`line_style amplitude must be in [H/${maxAmplitudeDivisor}, H/${minAmplitudeDivisor}]`);
  }
  if (!Number.isFinite(period) || period < minPeriod - EPSILON || period > maxPeriod + EPSILON) {
    throw new RangeError(`line_style period must be in [H/${maxPeriodDivisor}, H/${minPeriodDivisor}]`);
  }
  return { type: style.type, amplitude, period };
}

/**
 * Build a closed-at-both-ends fill boundary. Integer periods exactly span its
 * length; all styles use mirrored profiles so the complete contour is
 * symmetric around its midpoint.
 */
export function generateFlagBoundary(
  sourcePath: BoundaryPoint[],
  input: FlagLineStyle | FlagLineStyleName | string | undefined,
  canvasHeight: number,
): GeneratedFlagBoundary {
  if (sourcePath.length < 2 || sourcePath.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new TypeError('boundary path must contain at least two finite points');
  }
  const path = sourcePath.map(({ x, y }) => ({ x, y }));
  const length = path.slice(1).reduce((sum, p, index) =>
    sum + Math.hypot(p.x - path[index].x, p.y - path[index].y), 0);
  if (length <= EPSILON) throw new RangeError('boundary path must have positive length');

  const style = resolveFlagLineStyle(input, canvasHeight);
  if (style.type === 'STRAIGHT') {
    return { points: path, length, periods: 0, periodLength: 0, amplitude: 0 };
  }

  const periods = Math.max(2, Math.round(length / style.period));
  const periodLength = length / periods;
  const minimumFeature = canvasHeight / FLAG_LINE_STYLE_CONFIG.minimumThicknessDivisor;
  if (periodLength < minimumFeature - EPSILON) {
    throw new RangeError(`line_style period length cannot be below T_MIN (${minimumFeature})`);
  }
  const samplesPerPeriod = FLAG_LINE_STYLE_CONFIG.samplesPerPeriod;
  const samples = periods * samplesPerPeriod;
  const points: BoundaryPoint[] = [];
  for (let sample = 0; sample <= samples; sample += 1) {
    const t = sample / samples;
    const distance = t * length;
    const base = pointAtDistance(path, distance);
    const tangent = tangentAtDistance(path, distance);
    const normal = { x: -tangent.y, y: tangent.x };
    const unit = Math.min(periods - 1, Math.floor(Math.min(t * periods, periods - EPSILON)));
    const phase = Math.min(1, t * periods - unit);
    let offset = 0;

    switch (style.type) {
      case 'EMBATTLED':
        // One half-period is the raised merlon, the other the crenel.
        offset = phase >= 0.25 && phase <= 0.75 ? style.amplitude : 0;
        break;
      case 'DANCETTY':
        offset = style.amplitude * (phase < 0.5 ? phase * 2 : (1 - phase) * 2);
        break;
      case 'WAVY': {
        // A sine wave with an envelope that makes the complete profile
        // mirror-symmetric while retaining an integral number of periods.
        const value = Math.sin(2 * Math.PI * periods * t) * Math.cos(Math.PI * t);
        offset = style.amplitude * value;
        break;
      }
      case 'ENGRAILED':
        offset = style.amplitude * Math.sqrt(Math.max(0, 1 - (2 * phase - 1) ** 2));
        break;
      case 'INVECTED':
        offset = -style.amplitude * Math.sqrt(Math.max(0, 1 - (2 * phase - 1) ** 2));
        break;
      case 'NEBULY':
        offset = style.amplitude * symmetricPeriodSign(unit, periods) *
          Math.sqrt(Math.max(0, 1 - (2 * phase - 1) ** 2));
        break;
    }

    points.push({ x: base.x + normal.x * offset, y: base.y + normal.y * offset });
  }
  points[0] = { ...path[0] };
  points[points.length - 1] = { ...path[path.length - 1] };
  return { points, length, periods, periodLength, amplitude: style.amplitude };
}

function samePoint(a: BoundaryPoint, b: BoundaryPoint): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function edgeKey(a: BoundaryPoint, b: BoundaryPoint): string {
  const format = (value: number) => Number(value.toPrecision(12));
  const first = `${format(a.x)},${format(a.y)}`;
  const second = `${format(b.x)},${format(b.y)}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

interface EdgeReference {
  region: number;
  polygon: number;
  edge: number;
  from: BoundaryPoint;
  to: BoundaryPoint;
}

/**
 * Decorate exact shared edges in a set of field regions. Both neighboring
 * polygons receive the same point sequence in opposite order, so fills stay
 * edge-to-edge without strokes or cracks.
 */
export function styleSharedFlagRegionBoundaries<T extends BoundaryPoint[][]>(
  sourceRegions: T[],
  input: FlagLineStyle | FlagLineStyleName | string | undefined,
  canvasHeight: number,
): T[] {
  const style = resolveFlagLineStyle(input, canvasHeight);
  const regions = sourceRegions.map((region) => region.map((polygon) => polygon.map(({ x, y }) => ({ x, y }))));
  if (style.type === 'STRAIGHT') return regions as T[];

  const edges = new Map<string, EdgeReference[]>();
  regions.forEach((region, regionIndex) => region.forEach((polygon, polygonIndex) => {
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
      const from = polygon[edgeIndex];
      const to = polygon[(edgeIndex + 1) % polygon.length];
      const key = edgeKey(from, to);
      const refs = edges.get(key) ?? [];
      refs.push({ region: regionIndex, polygon: polygonIndex, edge: edgeIndex, from, to });
      edges.set(key, refs);
    }
  }));

  const replacements = new Map<string, BoundaryPoint[]>();
  const refKey = (ref: EdgeReference) => `${ref.region}:${ref.polygon}:${ref.edge}`;
  for (const refs of edges.values()) {
    if (refs.length !== 2 || refs[0].region === refs[1].region) continue;
    const [first, second] = refs;
    if (!samePoint(first.from, second.to) || !samePoint(first.to, second.from)) {
      throw new RangeError('shared flag boundary edges must have opposite winding');
    }
    const boundary = generateFlagBoundary([first.from, first.to], style, canvasHeight).points;
    replacements.set(refKey(first), boundary);
    replacements.set(refKey(second), boundary.slice().reverse());
  }

  regions.forEach((region, regionIndex) => region.forEach((polygon, polygonIndex) => {
    const expanded: BoundaryPoint[] = [];
    for (let edge = 0; edge < polygon.length; edge += 1) {
      expanded.push(polygon[edge]);
      const points = replacements.get(`${regionIndex}:${polygonIndex}:${edge}`);
      if (points) expanded.push(...points.slice(1, -1));
    }
    region[polygonIndex] = expanded;
  }));
  return regions as T[];
}
