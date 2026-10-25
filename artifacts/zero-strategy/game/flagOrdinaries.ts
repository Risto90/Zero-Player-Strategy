import { buildFlagField, clipFlagPolygons, type FlagFieldNode, type FlagFieldPaintLayer, type FlagFieldFrame, type FlagPolygon, type FlagPolygonSet, type FlagPoint } from './flagField';
import { FLAG_ORDINARY_CONFIG as CONFIG } from './flagOrdinaryConfig';
import { generateFlagBoundary, type FlagLineStyle } from './flagLineStyles';

export type FlagOrdinaryType = 'O01' | 'O02' | 'O03' | 'O04' | 'O05' | 'O06' | 'O07' | 'O08' | 'O09';
export interface FlagOrdinarySpec {
  type: FlagOrdinaryType;
  params?: Record<string, unknown>;
  fill?: string | { pattern: unknown; [key: string]: unknown };
  fimbration?: { delta: number; fill: string };
  cost?: number;
  id?: string;
  children?: FlagOrdinarySpec[];
}
export interface FlagOrdinaryFrame extends FlagFieldFrame {}
export interface FlagOrdinaryOptions {
  canvasHeight?: number;
  /** Flag outline and inherited frames, outermost first. */
  clipChain?: FlagPolygonSet[];
}
export interface FlagOrdinaryPaintLayer {
  kind: 'ordinary' | 'canton' | 'ground';
  id: string;
  operator: FlagOrdinaryType | string;
  fill: unknown;
  polygons: FlagPolygonSet;
  clipChain: FlagPolygonSet[];
  depth: number;
  cost: number;
  tags: string[];
  part?: 'fimbration' | 'main';
}
export interface FlagOrdinaryIssue {
  path: string;
  message: string;
}
export interface FlagOrdinaryResult {
  paintLayers: FlagOrdinaryPaintLayer[];
  ordinaryCount: number;
  cantonCount: number;
  bordureCount: number;
  totalCost: number;
  maxDepth: number;
}

const EPS = 1e-8;
const LIMITS = CONFIG.limits;

function pt(x: number, y: number): FlagPoint {
  return { x, y };
}

function finite(value: unknown, name: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new RangeError(`${name} must be a finite number`);
  return result;
}

function range(value: unknown, limits: readonly number[], name: string): number {
  const result = finite(value, name);
  if (result < limits[0] - EPS || result > limits[1] + EPS) {
    throw new RangeError(`${name} must be in [${limits[0]}, ${limits[1]}]`);
  }
  return result;
}

function frameCenter(frame: FlagOrdinaryFrame, params: Record<string, unknown>): FlagPoint {
  const origin = (params.center && typeof params.center === 'object' ? params.center : {}) as Record<string, unknown>;
  const u = finite(origin.u ?? params.cx ?? (params.scandinavian === true ? CONFIG.operators.O01.defaultScandinavianCenter : CONFIG.defaultCenter.u), 'center.u');
  const v = finite(origin.v ?? params.cy ?? CONFIG.defaultCenter.v, 'center.v');
  if (u < 0 || u > 1 || v < 0 || v > 1) throw new RangeError('ordinary center must be within its frame');
  return pt(frame.x0 + u * frame.w, frame.y0 + v * frame.h);
}

function rectangle(x0: number, y0: number, x1: number, y1: number): FlagPolygon {
  return [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];
}

function rectangleAlong(a: FlagPoint, b: FlagPoint, width: number, extendStart = 0, extendEnd = 0): FlagPolygon {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPS || width <= 0) return [];
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy * width / 2;
  const ny = ux * width / 2;
  const start = pt(a.x - ux * extendStart, a.y - uy * extendStart);
  const end = pt(b.x + ux * extendEnd, b.y + uy * extendEnd);
  return [
    pt(start.x + nx, start.y + ny),
    pt(end.x + nx, end.y + ny),
    pt(end.x - nx, end.y - ny),
    pt(start.x - nx, start.y - ny),
  ];
}

function variableBand(a: FlagPoint, b: FlagPoint, startWidth: number, endWidth: number): FlagPolygon {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPS) return [];
  const nx = -dy / length;
  const ny = dx / length;
  return [
    pt(a.x + nx * startWidth / 2, a.y + ny * startWidth / 2),
    pt(b.x + nx * endWidth / 2, b.y + ny * endWidth / 2),
    pt(b.x - nx * endWidth / 2, b.y - ny * endWidth / 2),
    pt(a.x - nx * startWidth / 2, a.y - ny * startWidth / 2),
  ];
}

function circle(center: FlagPoint, radius: number): FlagPolygon {
  const points: FlagPolygon = [];
  const count = CONFIG.polygonSamples;
  for (let i = 0; i < count; i += 1) {
    const angle = 2 * Math.PI * i / count;
    points.push(pt(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius));
  }
  return points;
}

function boundaryPoint(side: string, frame: FlagOrdinaryFrame): FlagPoint {
  switch (side.toUpperCase()) {
    case 'HOIST': case 'LEFT': return pt(frame.x0, frame.y0 + frame.h / 2);
    case 'FLY': case 'RIGHT': return pt(frame.x0 + frame.w, frame.y0 + frame.h / 2);
    case 'TOP': return pt(frame.x0 + frame.w / 2, frame.y0);
    case 'BOTTOM': return pt(frame.x0 + frame.w / 2, frame.y0 + frame.h);
    default: throw new RangeError('edge must be HOIST, FLY, TOP, or BOTTOM');
  }
}

function fullLine(angleDegrees: number, center: FlagPoint, frame: FlagOrdinaryFrame): [FlagPoint, FlagPoint] {
  const angle = angleDegrees * Math.PI / 180;
  const length = 2 * Math.hypot(frame.w, frame.h);
  const dx = Math.cos(angle) * length / 2;
  const dy = Math.sin(angle) * length / 2;
  return [pt(center.x - dx, center.y - dy), pt(center.x + dx, center.y + dy)];
}

function crossGeometry(params: Record<string, unknown>, frame: FlagOrdinaryFrame, height: number, thickness?: number): FlagPolygonSet {
  const config = CONFIG.operators.O01;
  const t = thickness ?? range(params.thickness ?? height / config.defaultThicknessDivisor,
    config.thicknessDivisors.map((n) => height / n), 'cross thickness');
  const center = frameCenter(frame, params);
  const mode = String(params.arms ?? 'FULL').toUpperCase();
  if (!['FULL', 'COUPED'].includes(mode)) throw new RangeError('cross arms must be FULL or COUPED');
  const profile = String(params.profile ?? 'STRAIGHT').toUpperCase();
  if (!['STRAIGHT', 'FLARED', 'LATIN'].includes(profile)) throw new RangeError('cross profile must be STRAIGHT, FLARED, or LATIN');
  if (params.scandinavian === true) {
    const u = Number((params.center as Record<string, unknown> | undefined)?.u ?? params.cx ?? config.defaultScandinavianCenter);
    if (u < config.scandinavianCenterRange[0] || u > config.scandinavianCenterRange[1]) {
      throw new RangeError('Scandinavian cross center must be in 0.30W..0.42W');
    }
    if (Math.abs(center.y - (frame.y0 + frame.h / 2)) > EPS) throw new RangeError('Scandinavian cross must be vertically centered');
  }
  let halfLength = 0;
  if (mode === 'COUPED') halfLength = range(params.halfLength ?? Math.min(frame.w, frame.h) * config.defaultCoupleLength,
    CONFIG.operators.O01.coupleLength.map((n) => n * Math.min(frame.w, frame.h)) as unknown as readonly number[], 'cross halfLength');
  const horizontalEnd = mode === 'FULL' ? frame.w : halfLength;
  const verticalEnd = mode === 'FULL' ? frame.h : halfLength;
  const horizontalRight = profile === 'LATIN' ? horizontalEnd * range(params.latinRatio ?? config.defaultLatinLength, config.latinLength, 'cross latinRatio') : horizontalEnd;
  const verticalDown = profile === 'LATIN' ? verticalEnd * range(params.latinRatio ?? config.defaultLatinLength, config.latinLength, 'cross latinRatio') : verticalEnd;
  const factor = profile === 'FLARED' ? range(params.flareRatio ?? config.defaultFlare, config.flare, 'cross flareRatio') : 1;
  const polygons: FlagPolygonSet = [];
  const left = mode === 'FULL' ? frame.x0 : center.x - horizontalEnd;
  const right = mode === 'FULL' ? frame.x0 + frame.w : center.x + horizontalRight;
  const top = mode === 'FULL' ? frame.y0 : center.y - verticalEnd;
  const bottom = mode === 'FULL' ? frame.y0 + frame.h : center.y + verticalDown;
  if (profile === 'FLARED') {
    polygons.push(
      variableBand(center, pt(left, center.y), t, t * factor),
      variableBand(center, pt(right, center.y), t, t * factor),
      variableBand(center, pt(center.x, top), t, t * factor),
      variableBand(center, pt(center.x, bottom), t, t * factor),
    );
  } else {
    polygons.push(
      rectangle(left, center.y - t / 2, right, center.y + t / 2),
      rectangle(center.x - t / 2, top, center.x + t / 2, bottom),
    );
  }
  return polygons;
}

function saltireGeometry(params: Record<string, unknown>, frame: FlagOrdinaryFrame, height: number, thickness?: number): FlagPolygonSet {
  const config = CONFIG.operators.O02;
  const t = thickness ?? range(params.thickness ?? height / config.defaultThicknessDivisor,
    config.thicknessDivisors.map((n) => height / n), 'saltire thickness');
  const center = frameCenter(frame, params);
  const mode = String(params.mode ?? 'CORNER').toUpperCase();
  if (!['CORNER', 'D45'].includes(mode)) throw new RangeError('saltire mode must be CORNER or D45');
  const diagonal = Math.atan2(frame.h, frame.w) * 180 / Math.PI;
  return [diagonal, -diagonal].map((angle) => {
    const [a, b] = fullLine(mode === 'D45' ? (angle < 0 ? -45 : 45) : angle, center, frame);
    return rectangleAlong(a, b, t);
  });
}

function bandGeometry(params: Record<string, unknown>, frame: FlagOrdinaryFrame, height: number, thickness?: number): FlagPolygonSet {
  const config = CONFIG.operators.O03;
  const t = thickness ?? range(params.thickness ?? height / config.defaultThicknessDivisor,
    config.thicknessDivisors.map((n) => height / n), 'band thickness');
  const rawAxis = params.axis ?? config.defaultAxis;
  let angle: number;
  if (String(rawAxis).toUpperCase() === 'DIAGONAL') angle = Math.atan2(frame.h, frame.w) * 180 / Math.PI;
  else angle = finite(rawAxis, 'band axis');
  if (!(CONFIG.operators.O03.angles as readonly unknown[]).some((value) =>
    typeof value === 'string' ? String(rawAxis).toUpperCase() === value : Math.abs(angle - Number(value)) < EPS)) {
    throw new RangeError('band axis must be 0°, 90°, diagonal, or ±30°/±45°/±60°');
  }
  let center = frameCenter(frame, params);
  const placement = String(params.placement ?? 'CENTER').toUpperCase();
  if (placement === 'AT_EDGE') {
    const edge = boundaryPoint(String(params.edge ?? 'TOP'), frame);
    center = edge;
  } else if (placement !== 'CENTER') throw new RangeError('band placement must be CENTER or AT_EDGE');
  const offset = finite(params.offset ?? config.defaultOffset, 'band offset');
  if (placement !== 'AT_EDGE') {
    const normalAngle = (angle + 90) * Math.PI / 180;
    center = pt(center.x + Math.cos(normalAngle) * offset, center.y + Math.sin(normalAngle) * offset);
  }
  const [a, b] = fullLine(angle, center, frame);
  return [rectangleAlong(a, b, t)];
}

function chevronGeometry(params: Record<string, unknown>, frame: FlagOrdinaryFrame, height: number, thickness?: number): FlagPolygonSet {
  const config = CONFIG.operators.O04;
  const t = thickness ?? range(params.thickness ?? height / config.defaultThicknessDivisor,
    config.thicknessDivisors.map((n) => height / n), 'chevron thickness');
  const center = frameCenter(frame, params);
  const orientation = String(params.orientation ?? 'RIGHT').toUpperCase();
  const angle = range(params.halfAngle ?? config.defaultHalfAngle, config.halfAngles, 'chevron halfAngle') * Math.PI / 180;
  const rotation: Record<string, number> = { RIGHT: 0, DOWN: 90, LEFT: 180, UP: -90 };
  if (!(orientation in rotation)) throw new RangeError('chevron orientation must be RIGHT, LEFT, UP, or DOWN');
  const baseAngle = rotation[orientation] * Math.PI / 180;
  const length = Math.hypot(frame.w, frame.h) * 1.5;
  return [-1, 1].map((sign) => {
    const rayAngle = baseAngle + Math.PI + sign * angle;
    return rectangleAlong(center, pt(center.x + Math.cos(rayAngle) * length, center.y + Math.sin(rayAngle) * length), t);
  }).concat([circle(center, t / 2)]);
}

function pallGeometry(params: Record<string, unknown>, frame: FlagOrdinaryFrame, height: number, thickness?: number): FlagPolygonSet {
  const config = CONFIG.operators.O05;
  const t = thickness ?? range(params.thickness ?? height / config.defaultThicknessDivisor,
    config.thicknessDivisors.map((n) => height / n), 'pall thickness');
  const center = frameCenter(frame, params);
  const length = Math.hypot(frame.w, frame.h) * 1.4;
  const angles = (params.angles as number[] | undefined) ?? [...config.defaultAngles];
  if (!Array.isArray(angles) || angles.length !== 3 || angles.some((a) => !Number.isFinite(a))) {
    throw new RangeError('pall angles must contain three finite directions');
  }
  return angles.map((degrees) => {
    const angle = degrees * Math.PI / 180;
    return rectangleAlong(center, pt(center.x + Math.cos(angle) * length, center.y + Math.sin(angle) * length), t);
  }).concat([circle(center, t / 2)]);
}

function pileGeometry(params: Record<string, unknown>, frame: FlagOrdinaryFrame): FlagPolygonSet {
  const side = String(params.side ?? 'HOIST').toUpperCase();
  if (!['HOIST', 'FLY', 'TOP', 'BOTTOM'].includes(side)) throw new RangeError('pile side must be HOIST, FLY, TOP, or BOTTOM');
  const horizontal = side === 'HOIST' || side === 'FLY';
  const sideLength = horizontal ? frame.h : frame.w;
  const config = CONFIG.operators.O06;
  const baseLength = range(params.baseLength ?? sideLength * config.defaultBaseSideFraction,
    config.baseSideFraction.map((v) => v * sideLength) as unknown as readonly number[], 'pile baseLength');
  const depth = range(params.depth ?? (horizontal ? frame.w : frame.h) * config.defaultDepthFraction,
    config.depthFraction.map((v) => v * (horizontal ? frame.w : frame.h)) as unknown as readonly number[], 'pile depth');
  const apexPosition = range(params.apexPosition ?? config.defaultApexPosition, config.apexPosition, 'pile apexPosition');
  const defaultTipFraction = params.truncated === true ? config.defaultTruncatedTipFraction : config.defaultTipFraction;
  const tipWidth = range(params.tipWidth ?? baseLength * defaultTipFraction,
    config.truncatedTip.map((v) => v * baseLength) as unknown as readonly number[], 'pile tipWidth');
  const baseStart = (sideLength - baseLength) / 2;
  const tip = side === 'HOIST' ? pt(frame.x0 + depth, frame.y0 + sideLength * apexPosition)
    : side === 'FLY' ? pt(frame.x0 + frame.w - depth, frame.y0 + sideLength * apexPosition)
    : side === 'TOP' ? pt(frame.x0 + sideLength * apexPosition, frame.y0 + depth)
    : pt(frame.x0 + sideLength * apexPosition, frame.y0 + frame.h - depth);
  let p1: FlagPoint;
  let p2: FlagPoint;
  if (horizontal) {
    const y0 = frame.y0 + baseStart;
    p1 = pt(side === 'HOIST' ? frame.x0 : frame.x0 + frame.w, y0);
    p2 = pt(side === 'HOIST' ? frame.x0 : frame.x0 + frame.w, y0 + baseLength);
  } else {
    const x0 = frame.x0 + baseStart;
    p1 = pt(x0, side === 'TOP' ? frame.y0 : frame.y0 + frame.h);
    p2 = pt(x0 + baseLength, side === 'TOP' ? frame.y0 : frame.y0 + frame.h);
  }
  const points = [p1, p2];
  if (tipWidth > EPS) {
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const normal = pt(-Math.sin(angle) * tipWidth / 2, Math.cos(angle) * tipWidth / 2);
    points.push(pt(tip.x - normal.x, tip.y - normal.y), pt(tip.x + normal.x, tip.y + normal.y));
  } else points.push(tip);
  return [points];
}

function borderBands(
  frame: FlagOrdinaryFrame,
  inset: number,
  thickness: number,
  height: number,
  lineStyle: FlagLineStyle | string | undefined,
): FlagPolygonSet {
  const x0 = frame.x0 + inset;
  const y0 = frame.y0 + inset;
  const x1 = frame.x0 + frame.w - inset;
  const y1 = frame.y0 + frame.h - inset;
  if (x1 - x0 <= 2 * thickness || y1 - y0 <= 2 * thickness) throw new RangeError('bordure leaves no interior opening');
  const ix0 = x0 + thickness;
  const iy0 = y0 + thickness;
  const ix1 = x1 - thickness;
  const iy1 = y1 - thickness;
  const panel = (outerStart: FlagPoint, outerEnd: FlagPoint, innerStart: FlagPoint, innerEnd: FlagPoint): FlagPolygon => {
    const inner = generateFlagBoundary([innerStart, innerEnd], lineStyle, height).points;
    return [outerStart, outerEnd, ...inner.slice().reverse()];
  };
  return [
    panel(pt(x0, y0), pt(x1, y0), pt(ix0, iy0), pt(ix1, iy0)),
    panel(pt(x1, y0), pt(x1, y1), pt(ix1, iy0), pt(ix1, iy1)),
    panel(pt(x1, y1), pt(x0, y1), pt(ix1, iy1), pt(ix0, iy1)),
    panel(pt(x0, y1), pt(x0, y0), pt(ix0, iy1), pt(ix0, iy0)),
  ];
}

function checkyBands(params: Record<string, unknown>, frame: FlagOrdinaryFrame, height: number): [FlagPolygonSet, FlagPolygonSet] {
  const t = range(params.thickness ?? height / CONFIG.operators.O07.defaultThicknessDivisor,
    CONFIG.operators.O07.thicknessDivisors.map((n) => height / n), 'bordure thickness');
  const cellSize = finite(params.cellSize ?? height / CONFIG.operators.O07.defaultCheckCellDivisor, 'checky cellSize');
  if (cellSize < height / CONFIG.minimumThicknessDivisor) throw new RangeError('checky cellSize cannot be below T_MIN');
  const styledBorder = borderBands(frame, 0, t, height, params.line_style as FlagLineStyle | string | undefined);
  const colors: [FlagPolygonSet, FlagPolygonSet] = [[], []];
  const distribute = (length: number, desiredCellSize: number): number => {
    const requested = Math.max(1, Math.round(length / desiredCellSize));
    const minimumCount = Math.max(1, Math.floor(length / (height / CONFIG.minimumThicknessDivisor)));
    return Math.min(requested, minimumCount);
  };
  const topBottomCount = distribute(frame.w, cellSize);
  const horizontalStep = frame.w / topBottomCount;
  for (let index = 0; index < topBottomCount; index += 1) {
    const x0 = frame.x0 + index * horizontalStep;
    const x1 = frame.x0 + (index + 1) * horizontalStep;
    for (const y0 of [frame.y0, frame.y0 + frame.h - t]) {
      const pieces = clipFlagPolygons([rectangle(x0, y0, x1, y0 + t)], [styledBorder]);
      colors[index & 1].push(...pieces);
    }
  }
  const verticalLength = frame.h - 2 * t;
  const sideCount = distribute(verticalLength, cellSize);
  const verticalStep = verticalLength / sideCount;
  for (let index = 0; index < sideCount; index += 1) {
    const y0 = frame.y0 + t + index * verticalStep;
    const y1 = frame.y0 + t + (index + 1) * verticalStep;
    for (const x0 of [frame.x0, frame.x0 + frame.w - t]) {
      const pieces = clipFlagPolygons([rectangle(x0, y0, x0 + t, y1)], [styledBorder]);
      colors[(index + 1) & 1].push(...pieces);
    }
  }
  return colors;
}

function bordureGeometry(params: Record<string, unknown>, frame: FlagOrdinaryFrame, height: number): FlagPolygonSet {
  const t = range(params.thickness ?? height / CONFIG.operators.O07.defaultThicknessDivisor,
    CONFIG.operators.O07.thicknessDivisors.map((n) => height / n), 'bordure thickness');
  const variant = String(params.variant ?? 'PLAIN').toUpperCase();
  if (!(CONFIG.operators.O07.variants as readonly string[]).includes(variant)) throw new RangeError('bordure variant must be PLAIN, DOUBLE, CHECKY, or ORLE');
  if (variant === 'ORLE') {
    const gap = range(params.gap ?? CONFIG.minimumGap, [CONFIG.minimumGap, height / 20], 'orle gap');
    return borderBands(frame, gap, t, height, params.line_style as FlagLineStyle | string | undefined);
  }
  if (variant === 'DOUBLE') {
    const gap = finite(params.gap ?? CONFIG.minimumGap, 'double bordure gap');
    if (gap < CONFIG.minimumGap) throw new RangeError(`double bordure gap must be at least G_MIN (${CONFIG.minimumGap})`);
    const style = params.line_style as FlagLineStyle | string | undefined;
    return [...borderBands(frame, 0, t, height, style), ...borderBands(frame, t + gap, t, height, style)];
  }
  if (variant === 'CHECKY') {
    return checkyBands(params, frame, height).flat();
  }
  return borderBands(frame, 0, t, height, params.line_style as FlagLineStyle | string | undefined);
}

function getGeometry(type: FlagOrdinaryType, params: Record<string, unknown>, frame: FlagOrdinaryFrame, height: number, widthOverride?: number): FlagPolygonSet {
  switch (type) {
    case 'O01': return crossGeometry(params, frame, height, widthOverride);
    case 'O02': return saltireGeometry(params, frame, height, widthOverride);
    case 'O03': return bandGeometry(params, frame, height, widthOverride);
    case 'O04': return chevronGeometry(params, frame, height, widthOverride);
    case 'O05': return pallGeometry(params, frame, height, widthOverride);
    case 'O06': return pileGeometry(params, frame);
    case 'O07': return bordureGeometry(params, frame, height);
    default: throw new RangeError(`${type} geometry is composite and cannot be requested directly`);
  }
}

function clipped(polygons: FlagPolygonSet, clipChain: FlagPolygonSet[]): FlagPolygonSet {
  return clipChain.length ? clipFlagPolygons(polygons, clipChain) : polygons;
}

function fillFor(spec: FlagOrdinarySpec, fallback = 's2'): unknown {
  return spec.fill ?? fallback;
}

/** Offset each convex component so fimbration follows the figure's contour. */
function offsetPolygon(polygon: FlagPolygon, distance: number): FlagPolygon {
  if (polygon.length < 3 || distance <= 0) return polygon.map(({ x, y }) => pt(x, y));
  const area = polygon.reduce((sum, a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0);
  const sign = Math.sign(area) || 1;
  const lines = polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPS) throw new RangeError('fimbration cannot offset a degenerate edge');
    return {
      a: pt(a.x + sign * dy / length * distance, a.y - sign * dx / length * distance),
      direction: pt(dx / length, dy / length),
    };
  });
  return polygon.map((_, index) => {
    const previous = lines[(index + lines.length - 1) % lines.length];
    const current = lines[index];
    const cross = previous.direction.x * current.direction.y - previous.direction.y * current.direction.x;
    if (Math.abs(cross) <= EPS) return current.a;
    const dx = current.a.x - previous.a.x;
    const dy = current.a.y - previous.a.y;
    const t = (dx * current.direction.y - dy * current.direction.x) / cross;
    return pt(previous.a.x + previous.direction.x * t, previous.a.y + previous.direction.y * t);
  });
}

function offsetPolygons(polygons: FlagPolygonSet, distance: number): FlagPolygonSet {
  return polygons.map((polygon) => offsetPolygon(polygon, distance));
}

function idFor(spec: FlagOrdinarySpec, index: number): string {
  return spec.id ?? `${spec.type.toLowerCase()}-${index + 1}`;
}

function emitShape(
  spec: FlagOrdinarySpec,
  frame: FlagOrdinaryFrame,
  options: FlagOrdinaryOptions,
  depth: number,
  index: number,
  result: FlagOrdinaryResult,
  params = spec.params ?? {},
  type = spec.type,
  componentName = idFor(spec, index),
): void {
  const height = options.canvasHeight ?? CONFIG.canvasHeight;
  const inherited = options.clipChain ?? [];
  const baseCost = finite(spec.cost ?? CONFIG.costs.default, `${componentName}.cost`);
  if (baseCost < 0) throw new RangeError(`${componentName}.cost cannot be negative`);
  const cost = baseCost + (spec.fimbration ? CONFIG.costs.fimbration : 0);
  result.totalCost += cost;
  const fimb = spec.fimbration;
  if (type === 'O07' && String(params.variant ?? 'PLAIN').toUpperCase() === 'CHECKY') {
    const delta = fimb ? range(fimb.delta, CONFIG.fimbration, `${componentName}.fimbration.delta`) : 0;
    if (fimb) {
      const thickness = range(params.thickness ?? height / CONFIG.operators.O07.defaultThicknessDivisor,
        CONFIG.operators.O07.thicknessDivisors.map((n) => height / n), 'bordure thickness');
      const fill = offsetPolygons(borderBands(frame, 0, thickness, height, params.line_style as FlagLineStyle | string | undefined), delta);
      result.paintLayers.push({
        kind: 'ordinary', id: `${componentName}-fimbration`, operator: type,
        fill: fimb.fill, polygons: clipped(fill, inherited), clipChain: inherited,
        depth, cost: CONFIG.costs.fimbration, tags: ['ordinary', 'bordure', 'fimbration'], part: 'fimbration',
      });
    }
    const [firstColor, secondColor] = checkyBands(params, frame, height);
    const firstFill = fillFor(spec);
    const secondFill = params.secondary_fill ?? CONFIG.operators.O07.defaultSecondaryFill;
    if (firstFill === secondFill) throw new RangeError('CHECKY bordure requires two distinct fill slots');
    result.paintLayers.push({
      kind: 'ordinary', id: `${componentName}-checky-a`, operator: type, fill: firstFill,
      polygons: clipped(firstColor, inherited), clipChain: inherited, depth,
      cost: baseCost / 2, tags: ['ordinary', 'bordure', 'checky', 'checker-a'], part: 'main',
    });
    result.paintLayers.push({
      kind: 'ordinary', id: `${componentName}-checky-b`, operator: type, fill: secondFill,
      polygons: clipped(secondColor, inherited), clipChain: inherited, depth,
      cost: baseCost / 2, tags: ['ordinary', 'bordure', 'checky', 'checker-b'], part: 'main',
    });
    return;
  }
  if (fimb) {
    const delta = range(fimb.delta, CONFIG.fimbration, `${componentName}.fimbration.delta`);
    const expanded = offsetPolygons(getGeometry(type, params, frame, height), delta);
    result.paintLayers.push({
      kind: 'ordinary', id: `${componentName}-fimbration`, operator: type,
      fill: fimb.fill, polygons: clipped(expanded, inherited), clipChain: inherited,
      depth, cost: CONFIG.costs.fimbration, tags: ['fimbration'], part: 'fimbration',
    });
  }
  result.paintLayers.push({
    kind: 'ordinary', id: componentName, operator: type, fill: fillFor(spec),
    polygons: clipped(getGeometry(type, params, frame, height), inherited), clipChain: inherited,
    depth, cost: baseCost, tags: ['ordinary'], part: 'main',
  });
}

function cantonGeometry(spec: FlagOrdinarySpec, frame: FlagOrdinaryFrame): { polygon: FlagPolygon; frame: FlagOrdinaryFrame } {
  const params = spec.params ?? {};
  const config = CONFIG.operators.O08;
  const w = range(params.width ?? frame.w * config.defaultWidthFraction,
    CONFIG.operators.O08.widthFraction.map((v) => v * frame.w) as unknown as readonly number[], 'canton width');
  let h = range(params.height ?? frame.h * config.defaultHeightFraction,
    CONFIG.operators.O08.heightFraction.map((v) => v * frame.h) as unknown as readonly number[], 'canton height');
  if (params.square === true) {
    h = range(w, config.heightFraction.map((v) => v * frame.h) as unknown as readonly number[], 'square canton size');
  }
  if (h > frame.h + EPS || w > frame.w + EPS) throw new RangeError('square canton must fit within its frame');
  const corner = String(params.corner ?? config.defaultCorner).toUpperCase();
  const left = corner.endsWith('HOIST') || corner === 'HOIST_TOP' || corner === 'HOIST_BOTTOM';
  const top = corner.endsWith('_TOP');
  const valid = ['HOIST_TOP', 'FLY_TOP', 'HOIST_BOTTOM', 'FLY_BOTTOM'];
  if (!valid.includes(corner)) throw new RangeError('canton corner must be HOIST_TOP, FLY_TOP, HOIST_BOTTOM, or FLY_BOTTOM');
  const x0 = left ? frame.x0 : frame.x0 + frame.w - w;
  const y0 = top ? frame.y0 : frame.y0 + frame.h - h;
  return { polygon: rectangle(x0, y0, x0 + w, y0 + h), frame: { x0, y0, w, h } };
}

function addCanton(spec: FlagOrdinarySpec, frame: FlagOrdinaryFrame, options: FlagOrdinaryOptions, depth: number, index: number, result: FlagOrdinaryResult): void {
  const { polygon, frame: innerFrame } = cantonGeometry(spec, frame);
  const clipChain = [...(options.clipChain ?? []), [polygon]];
  const id = idFor(spec, index);
  const cantonCost = finite(spec.cost ?? CONFIG.costs.default, `${id}.cost`);
  if (cantonCost < 0) throw new RangeError(`${id}.cost cannot be negative`);
  result.totalCost += cantonCost;
  if (spec.fimbration) {
    const delta = range(spec.fimbration.delta, CONFIG.fimbration, `${id}.fimbration.delta`);
    const outer = rectangle(polygon[0].x - delta, polygon[0].y - delta, polygon[2].x + delta, polygon[2].y + delta);
    result.paintLayers.push({
      kind: 'ordinary', id: `${id}-fimbration`, operator: 'O08', fill: spec.fimbration.fill,
      polygons: clipped([outer], options.clipChain ?? []), clipChain: options.clipChain ?? [],
      depth, cost: CONFIG.costs.fimbration, tags: ['canton', 'fimbration'], part: 'fimbration',
    });
    result.totalCost += CONFIG.costs.fimbration;
  }
  result.paintLayers.push({
    kind: 'canton', id, operator: 'O08', fill: fillFor(spec), polygons: clipped([polygon], options.clipChain ?? []),
    clipChain: options.clipChain ?? [], depth, cost: cantonCost, tags: ['canton'],
  });
  const fieldNode = spec.params?.field as FlagFieldNode | undefined;
  if (fieldNode) {
    const field = buildFlagField(fieldNode, innerFrame, { canvasHeight: options.canvasHeight ?? CONFIG.canvasHeight, clipChain });
    for (const layer of field.paintLayers as FlagFieldPaintLayer[]) {
      result.paintLayers.push({
        kind: 'ground', id: `${id}-${layer.op.toLowerCase()}-${layer.regionIndex ?? 'base'}`,
        operator: layer.op, fill: layer.slot, polygons: layer.polygons, clipChain: layer.clipChain,
        depth: depth + 1, cost: 0, tags: ['canton-field'],
      });
    }
  }
  const children = spec.children ?? [];
  if (children.length) {
    const nested = buildFlagOrdinaries(children, innerFrame, { ...options, clipChain }, depth + 1);
    result.paintLayers.push(...nested.paintLayers);
    result.ordinaryCount += nested.ordinaryCount;
    result.bordureCount += nested.bordureCount;
    result.cantonCount += nested.cantonCount;
    result.totalCost += nested.totalCost;
    result.maxDepth = Math.max(result.maxDepth, nested.maxDepth);
  }
}

function addUnion(spec: FlagOrdinarySpec, frame: FlagOrdinaryFrame, options: FlagOrdinaryOptions, depth: number, index: number, result: FlagOrdinaryResult): void {
  const params = spec.params ?? {};
  const config = CONFIG.operators.O09;
  const saltireCount = Number(params.n_saltire ?? config.defaultSaltireCount);
  const crossCount = Number(params.n_cross ?? config.defaultCrossCount);
  if (![1, 2].includes(saltireCount)) throw new RangeError('union n_saltire must be 1 or 2');
  if (![0, 1, 2].includes(crossCount)) throw new RangeError('union n_cross must be 0, 1, or 2');
  const baseT = range(params.thickness ?? (options.canvasHeight ?? CONFIG.canvasHeight) / config.defaultThicknessDivisor,
    config.thicknessDivisors.map((n) => (options.canvasHeight ?? CONFIG.canvasHeight) / n), 'union thickness');
  const layers: Array<{ type: 'O01' | 'O02'; params: Record<string, unknown>; fill: unknown; fimbration?: FlagOrdinarySpec['fimbration']; name: string; t: number }> = [];
  const ratioSaltire = saltireCount === 2 ? range(params.second_saltire_ratio ?? config.defaultSecondSaltireScale, config.secondSaltireScale, 'second saltire ratio') : 1;
  for (let i = 0; i < saltireCount; i += 1) {
    const ratio = i === 1 ? ratioSaltire : 1;
    layers.push({
      type: 'O02', params: { mode: params.saltire_mode ?? 'CORNER', center: params.center, thickness: baseT * ratio },
      fill: i === 0 ? (params.saltire_fill ?? config.defaultSaltireFill) : (params.second_saltire_fill ?? config.defaultSecondSaltireFill),
      fimbration: (params[`fimbration_saltire_${i + 1}`] ?? params.fimbration_saltire) as FlagOrdinarySpec['fimbration'],
      name: `saltire-${i + 1}`, t: baseT * ratio,
    });
  }
  const ratioCross = crossCount === 2 ? range(params.second_cross_ratio ?? config.defaultSecondCrossScale, CONFIG.operators.O01.doubleScale, 'second cross ratio') : 1;
  for (let i = 0; i < crossCount; i += 1) {
    const ratio = i === 1 ? ratioCross : 1;
    layers.push({
      type: 'O01', params: { arms: 'FULL', center: params.center, thickness: baseT * ratio },
      fill: i === 0 ? (params.cross_fill ?? config.defaultCrossFill) : (params.second_cross_fill ?? config.defaultSecondCrossFill),
      fimbration: (params[`fimbration_cross_${i + 1}`] ?? params.fimbration_cross) as FlagOrdinarySpec['fimbration'],
      name: `cross-${i + 1}`, t: baseT * ratio,
    });
  }
  const fieldFill = params.field_fill ?? config.defaultFieldFill;
  const secondarySlot = params.secondary_slot ?? layers[1]?.fill ?? config.defaultSecondarySlot;
  if (new Set([fieldFill, layers[0]?.fill ?? config.defaultSaltireFill, secondarySlot, ...layers.map((layer) => layer.fill)]).size < 3) {
    throw new RangeError('union motif requires at least three distinct color slots');
  }
  const pinwheel = params.pinwheel === true;
  const shift = pinwheel ? range(params.pinwheel_shift ?? 0, config.pinwheelShift.map((v) => v * baseT) as unknown as readonly number[], 'pinwheel shift') : 0;
  layers.forEach((layer) => {
    const componentClip = options.clipChain ?? [];
    const splitSaltire = pinwheel && layer.type === 'O02';
    const halves = splitSaltire ? [
      { polygon: rectangle(frame.x0, frame.y0, frame.x0 + frame.w / 2, frame.y0 + frame.h), shift: -shift },
      { polygon: rectangle(frame.x0 + frame.w / 2, frame.y0, frame.x0 + frame.w, frame.y0 + frame.h), shift },
    ] : [{ polygon: undefined, shift: 0 }];
    for (const half of halves) {
      const angle = layer.type === 'O02' ? Math.atan2(frame.h, frame.w) : 0;
      const shiftX = Math.cos(angle) * half.shift;
      const shiftY = Math.sin(angle) * half.shift;
      const center = (params.center as Record<string, unknown> | undefined) ?? CONFIG.defaultCenter;
      const paramsForGeometry = {
        ...layer.params,
        center: {
          u: Number(center.u ?? CONFIG.defaultCenter.u) + shiftX / frame.w,
          v: Number(center.v ?? CONFIG.defaultCenter.v) + shiftY / frame.h,
        },
        thickness: layer.t,
      };
      const clips = half.polygon ? [...componentClip, [half.polygon]] : componentClip;
      if (layer.fimbration) {
        const delta = range(layer.fimbration.delta, CONFIG.fimbration, `union.${layer.name}.fimbration.delta`);
        const expanded = offsetPolygons(getGeometry(layer.type, paramsForGeometry, frame, options.canvasHeight ?? CONFIG.canvasHeight, layer.t), delta);
        result.paintLayers.push({
          kind: 'ordinary', id: `${idFor(spec, index)}-${layer.name}-fimbration`, operator: layer.type,
          fill: layer.fimbration.fill, polygons: clipped(expanded, clips), clipChain: clips,
          depth, cost: CONFIG.costs.fimbration / halves.length, tags: ['ordinary', 'fimbration'], part: 'fimbration',
        });
      }
      result.paintLayers.push({
        kind: 'ordinary', id: `${idFor(spec, index)}-${layer.name}`, operator: layer.type,
        fill: layer.fill, polygons: clipped(getGeometry(layer.type, paramsForGeometry, frame, options.canvasHeight ?? CONFIG.canvasHeight, layer.t), clips),
        clipChain: clips, depth, cost: (spec.cost ?? CONFIG.costs.default) / layers.length / halves.length,
        tags: ['ordinary', 'union-motif'], part: 'main',
      });
    }
  });
  result.totalCost += finite(spec.cost ?? CONFIG.costs.default, `${idFor(spec, index)}.cost`) + layers.reduce((sum, layer) => sum + (layer.fimbration ? CONFIG.costs.fimbration : 0), 0);
}

function buildFlagOrdinaries(specs: FlagOrdinarySpec[], frame: FlagOrdinaryFrame, options: FlagOrdinaryOptions, depth: number): FlagOrdinaryResult {
  const result: FlagOrdinaryResult = { paintLayers: [], ordinaryCount: 0, cantonCount: 0, bordureCount: 0, totalCost: 0, maxDepth: depth };
  specs.forEach((spec, index) => {
    if (!spec || !['O01', 'O02', 'O03', 'O04', 'O05', 'O06', 'O07', 'O08', 'O09'].includes(spec.type)) {
      throw new RangeError(`unsupported ordinary operator at index ${index}`);
    }
    result.ordinaryCount += 1;
    result.maxDepth = Math.max(result.maxDepth, depth);
    if (depth > LIMITS.maxFrameDepth) throw new RangeError('ordinary frame nesting must not exceed depth 3');
    if (spec.type === 'O07') result.bordureCount += 1;
    if (spec.type === 'O08') {
      result.cantonCount += 1;
      addCanton(spec, frame, options, depth, index, result);
    } else if (spec.type === 'O09') addUnion(spec, frame, options, depth, index, result);
    else emitShape(spec, frame, options, depth, index, result);
  });
  return result;
}

function crossParams(spec: FlagOrdinarySpec): Record<string, unknown> {
  return spec.params ?? {};
}

function validateCrossPair(specs: FlagOrdinarySpec[], issues: FlagOrdinaryIssue[], path: string): void {
  const crosses = specs.filter((spec) => spec.type === 'O01');
  if (crosses.length > 2) issues.push({ path, message: 'at most two O01 crosses are allowed; use O09 for other combinations' });
  if (crosses.length === 2) {
    const [a, b] = crosses.map(crossParams);
    const center = (params: Record<string, unknown>) => {
      const value = (params.center as Record<string, unknown> | undefined) ?? {};
      const defaultU = params.scandinavian === true ? CONFIG.operators.O01.defaultScandinavianCenter : CONFIG.defaultCenter.u;
      return [Number(value.u ?? params.cx ?? defaultU), Number(value.v ?? params.cy ?? CONFIG.defaultCenter.v)];
    };
    const [aX, aY] = center(a);
    const [bX, bY] = center(b);
    if (Math.abs(aX - bX) > EPS || Math.abs(aY - bY) > EPS) {
      issues.push({ path, message: 'two O01 crosses are allowed only as a double cross with a common center' });
    }
    const tA = Number(a.thickness ?? 200);
    const tB = Number(b.thickness ?? 200);
    const ratio = Math.min(tA, tB) / Math.max(tA, tB);
    if (ratio < CONFIG.operators.O01.doubleScale[0] - EPS || ratio > CONFIG.operators.O01.doubleScale[1] + EPS) {
      issues.push({ path, message: 'double-cross thickness ratio must be in [0.4, 0.7]' });
    }
  }
}

function validateOrdinaryTree(specs: FlagOrdinarySpec[], issues: FlagOrdinaryIssue[], path = '$'): void {
  validateCrossPair(specs, issues, path);
  specs.forEach((spec, index) => {
    if (spec.type === 'O08' && spec.children?.length) {
      validateOrdinaryTree(spec.children, issues, `${path}[${index}].children`);
    }
  });
}

/** Build O01–O09 as ordered polygons with inherited clipping and canton subframes. */
export function buildFlagOrdinaryLayers(
  specs: FlagOrdinarySpec[],
  frame: FlagOrdinaryFrame,
  options: FlagOrdinaryOptions = {},
): FlagOrdinaryResult {
  if (!Array.isArray(specs)) throw new TypeError('ordinary specs must be an array');
  if (![frame.x0, frame.y0, frame.w, frame.h].every(Number.isFinite) || frame.w <= 0 || frame.h <= 0) {
    throw new RangeError('ordinary frame must have finite coordinates and positive dimensions');
  }
  const compositionIssues: FlagOrdinaryIssue[] = [];
  validateOrdinaryTree(specs, compositionIssues);
  if (compositionIssues.length) {
    throw new RangeError(`invalid ordinary composition: ${compositionIssues.map(({ message }) => message).join('; ')}`);
  }
  const result = buildFlagOrdinaries(specs, frame, options, 1);
  if (result.ordinaryCount > LIMITS.maxOrdinaries) throw new RangeError(`ordinary count exceeds ${LIMITS.maxOrdinaries}`);
  if (result.cantonCount > LIMITS.maxCantons) throw new RangeError(`canton count exceeds ${LIMITS.maxCantons}`);
  if (result.bordureCount > LIMITS.maxBordures) throw new RangeError(`bordure count exceeds ${LIMITS.maxBordures}`);
  if (result.totalCost > LIMITS.maxTotalCost + EPS) throw new RangeError(`ordinary cost ${result.totalCost} exceeds ${LIMITS.maxTotalCost}`);
  return result;
}

/** Return geometry and composition failures without mutating the supplied specs. */
export function validateFlagOrdinaries(
  specs: FlagOrdinarySpec[],
  frame: FlagOrdinaryFrame,
  options: FlagOrdinaryOptions = {},
): FlagOrdinaryIssue[] {
  const issues: FlagOrdinaryIssue[] = [];
  try {
    validateOrdinaryTree(specs, issues);
    const result = buildFlagOrdinaryLayers(specs, frame, options);
    if (result.paintLayers.some((layer) => layer.polygons.some((polygon) =>
      polygon.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))))) {
      issues.push({ path: '$', message: 'ordinary geometry contains a non-finite point' });
    }
  } catch (error) {
    issues.push({ path: '$', message: error instanceof Error ? error.message : String(error) });
  }
  return issues;
}
