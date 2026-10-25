import type {
  CounterchangeCopy,
  CounterchangeNode,
  FlagFrame,
  FlagNode,
  JsonObject,
  JsonValue,
} from './flagSpec';
import { FLAG_PLACEMENT_CONFIG, type FlagConstellationId, type FlagSymmetryClass } from './flagPlacementConfig';

export { FLAG_PLACEMENT_CONFIG } from './flagPlacementConfig';
export type { FlagConstellationId, FlagSymmetryClass } from './flagPlacementConfig';

export type FlagChargeAnchor = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10';
export type FlagRepeatKind = 'GRID' | 'RING' | 'ARC' | 'LINE' | 'CONSTELLATION';
export interface PlacementPoint {
  u: number;
  v: number;
}
export interface ChargePlacement extends PlacementPoint {
  size: number;
  rotation: number;
  mirror: boolean;
}
export interface RepeatPlacement extends PlacementPoint {
  /** Relative to the charge's base diameter, not to the frame. */
  sizeMultiplier: number;
  rotation: number;
  mirror: boolean;
}
export interface PlacementFrame {
  w: number;
  h: number;
}
export interface PlacementSafeArea {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}
export interface PlacementOutlinePoint {
  x: number;
  y: number;
}
export type PlacementSafeAreaInput = PlacementSafeArea | PlacementPoint[] | PlacementOutlinePoint[];
export interface ExistingPlacement extends ChargePlacement {}
export interface PlacementReferences {
  ordinaryCenter?: PlacementPoint;
  cantonCenter?: PlacementPoint;
  quarter?: number;
  bandCenter?: PlacementPoint;
  boundaryCenter?: PlacementPoint;
  pileInterior?: PlacementPoint[];
  edge?: 'HOIST' | 'FLY' | 'TOP' | 'BOTTOM';
  corner?: 'TOP_HOIST' | 'TOP_FLY' | 'BOTTOM_HOIST' | 'BOTTOM_FLY';
  candidates?: PlacementPoint[];
  isCounterchange?: boolean;
}
export interface ResolvePlacementOptions {
  anchor: FlagChargeAnchor;
  frame: PlacementFrame;
  safeArea: PlacementSafeAreaInput;
  size: number;
  canvasHeight?: number;
  rotation?: number;
  mirror?: boolean;
  references?: PlacementReferences;
  existing?: ExistingPlacement[];
  symmetry?: FlagSymmetryClass;
  rng?: () => number;
}

const EPSILON = 1e-9;
const ANCHORS = new Set<FlagChargeAnchor>(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10']);
const REPEATERS = new Set<FlagRepeatKind>(['GRID', 'RING', 'ARC', 'LINE', 'CONSTELLATION']);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
};
const rngRequired = (rng?: () => number): (() => number) => {
  if (typeof rng !== 'function') throw new TypeError('placement and symmetry selection require an injected seeded random source');
  return rng;
};

function validateFrame(frame: PlacementFrame): void {
  if (!frame || !Number.isFinite(frame.w) || !Number.isFinite(frame.h) || frame.w <= 0 || frame.h <= 0) {
    throw new RangeError('placement frame width and height must be positive finite numbers');
  }
}

function safeAreaPolygon(area: PlacementSafeAreaInput, frame: PlacementFrame, canvasHeight: number): PlacementPoint[] {
  if (Array.isArray(area)) {
    if (area.length < 3) {
      throw new RangeError('safe-area polygon must contain at least three finite points');
    }
    return area.map((point) => {
      if ('u' in point && 'v' in point && Number.isFinite(point.u) && Number.isFinite(point.v)) return point;
      if ('x' in point && 'y' in point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        return { u: point.x / (frame.w * canvasHeight), v: point.y / (frame.h * canvasHeight) };
      }
      throw new RangeError('safe-area polygon points must use either normalized u/v or outline x/y coordinates');
    });
  }
  if (![area.minU, area.minV, area.maxU, area.maxV].every(Number.isFinite) ||
      area.minU >= area.maxU || area.minV >= area.maxV) {
    throw new RangeError('safe-area bounds must have positive finite width and height');
  }
  return [
    { u: area.minU, v: area.minV },
    { u: area.maxU, v: area.minV },
    { u: area.maxU, v: area.maxV },
    { u: area.minU, v: area.maxV },
  ];
}

function pointInPolygon(point: PlacementPoint, polygon: PlacementPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i], b = polygon[j];
    const crosses = (a.v > point.v) !== (b.v > point.v) &&
      point.u < ((b.u - a.u) * (point.v - a.v)) / (b.v - a.v) + a.u;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: PlacementPoint, a: PlacementPoint, b: PlacementPoint, frame: PlacementFrame): number {
  const px = point.u * frame.w, py = point.v * frame.h;
  const ax = a.u * frame.w, ay = a.v * frame.h;
  const bx = b.u * frame.w, by = b.v * frame.h;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function physicalRadius(size: number, frame: PlacementFrame): number {
  return size * Math.min(frame.w, frame.h) / 2;
}

function isSafe(point: PlacementPoint, radius: number, frame: PlacementFrame, polygon: PlacementPoint[]): boolean {
  if (!pointInPolygon(point, polygon)) return false;
  return polygon.every((vertex, index) =>
    distanceToSegment(point, vertex, polygon[(index + 1) % polygon.length], frame) + EPSILON >= radius);
}

function hasClearance(
  point: PlacementPoint,
  radius: number,
  frame: PlacementFrame,
  existing: ExistingPlacement[],
  minGap: number,
): boolean {
  return existing.every((other) => {
    const dx = (point.u - other.u) * frame.w;
    const dy = (point.v - other.v) * frame.h;
    return Math.hypot(dx, dy) + EPSILON >= radius + physicalRadius(other.size, frame) + minGap;
  });
}

/** Snap a charge diameter to H/24 (75%) or H/60 (25%) using the supplied seeded stream. */
export function snapChargeSize(size: number, frame: PlacementFrame, rng: () => number, canvasHeight = 1200): number {
  validateFrame(frame);
  finite(size, 'charge size');
  finite(canvasHeight, 'canvas height');
  if (canvasHeight <= 0) throw new RangeError('canvas height must be positive');
  const { sizeRange } = FLAG_PLACEMENT_CONFIG.anchors;
  if (size < sizeRange[0] || size > sizeRange[1]) {
    throw new RangeError(`charge size must be in ${sizeRange[0]}..${sizeRange[1]}`);
  }
  return snapValue(size, frame, rng, canvasHeight, sizeRange);
}

function snapValue(
  value: number,
  frame: PlacementFrame,
  rng: () => number,
  canvasHeight: number,
  bounds?: readonly [number, number],
): number {
  const random = rngRequired(rng)();
  if (!(random >= 0 && random < 1)) throw new RangeError('seeded random source must return a value in [0,1)');
  const { preferredSnapProbability, preferredSnapStep, fineSnapStep } = FLAG_PLACEMENT_CONFIG.anchors;
  const physicalFrameMin = Math.min(frame.w, frame.h) * canvasHeight;
  const step = random < preferredSnapProbability ? preferredSnapStep : fineSnapStep;
  const snapUnit = step / physicalFrameMin;
  let steps = Math.round(value / snapUnit);
  if (bounds) {
    const minSteps = Math.ceil(bounds[0] / snapUnit);
    const maxSteps = Math.floor(bounds[1] / snapUnit);
    steps = clamp(steps, minSteps, maxSteps);
  }
  return steps * snapUnit;
}

/** Apply the same design grid to any dimensional charge parameter. */
export function snapChargeParameter(value: number, frame: PlacementFrame, rng: () => number, canvasHeight = 1200): number {
  validateFrame(frame);
  finite(value, 'charge parameter');
  finite(canvasHeight, 'canvas height');
  if (canvasHeight <= 0) throw new RangeError('canvas height must be positive');
  return snapValue(value, frame, rng, canvasHeight);
}

function polygonCentroid(vertices: PlacementPoint[]): PlacementPoint {
  if (vertices.length < 3) throw new RangeError('A9 requires the PILE interior polygon');
  let twiceArea = 0, u = 0, v = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const cross = a.u * b.v - b.u * a.v;
    twiceArea += cross;
    u += (a.u + b.u) * cross;
    v += (a.v + b.v) * cross;
  }
  if (Math.abs(twiceArea) < EPSILON) throw new RangeError('A9 PILE interior polygon must have non-zero area');
  return { u: u / (3 * twiceArea), v: v / (3 * twiceArea) };
}

function anchorPoint(
  anchor: FlagChargeAnchor,
  references: PlacementReferences,
  frame: PlacementFrame,
  radius: number,
  canvasHeight: number,
): PlacementPoint {
  switch (anchor) {
    case 'A1': return { u: 0.5, v: 0.5 };
    case 'A2': return { u: (FLAG_PLACEMENT_CONFIG.anchors.hoistCenterX[0] + FLAG_PLACEMENT_CONFIG.anchors.hoistCenterX[1]) / 2, v: 0.5 };
    case 'A3':
      if (!references.ordinaryCenter) throw new RangeError('A3 requires the center of an ordinary');
      return references.ordinaryCenter;
    case 'A4':
      if (!references.cantonCenter) throw new RangeError('A4 requires the canton center');
      return references.cantonCenter;
    case 'A5': {
      const quarters = [
        { u: 0.25, v: 0.25 }, { u: 0.75, v: 0.25 },
        { u: 0.25, v: 0.75 }, { u: 0.75, v: 0.75 },
      ];
      const index = references.quarter ?? 0;
      if (!Number.isInteger(index) || index < 0 || index >= quarters.length) {
        throw new RangeError('A5 quarter must be an integer from 0 to 3');
      }
      return quarters[index];
    }
    case 'A6':
      if (!references.bandCenter) throw new RangeError('A6 requires the center of a selected band');
      return references.bandCenter;
    case 'A7':
      if (!references.isCounterchange || !references.boundaryCenter) {
        throw new RangeError('A7 is only valid at a counterchanged regional boundary');
      }
      return references.boundaryCenter;
    case 'A8': {
      const margin = FLAG_PLACEMENT_CONFIG.anchors.safeMargin / canvasHeight + radius;
      if (references.edge) {
        const edgePositions: Record<NonNullable<PlacementReferences['edge']>, PlacementPoint> = {
          HOIST: { u: margin / frame.w, v: 0.5 },
          FLY: { u: 1 - margin / frame.w, v: 0.5 },
          TOP: { u: 0.5, v: margin / frame.h },
          BOTTOM: { u: 0.5, v: 1 - margin / frame.h },
        };
        return edgePositions[references.edge];
      }
      const corners: Record<NonNullable<PlacementReferences['corner']>, PlacementPoint> = {
        TOP_HOIST: { u: margin / frame.w, v: margin / frame.h },
        TOP_FLY: { u: 1 - margin / frame.w, v: margin / frame.h },
        BOTTOM_HOIST: { u: margin / frame.w, v: 1 - margin / frame.h },
        BOTTOM_FLY: { u: 1 - margin / frame.w, v: 1 - margin / frame.h },
      };
      if (!references.corner) throw new RangeError('A8 requires a named edge or corner');
      return corners[references.corner];
    }
    case 'A9':
      if (!references.pileInterior) throw new RangeError('A9 requires the interior polygon of a PILE');
      return polygonCentroid(references.pileInterior);
    case 'A10':
      if (!references.candidates?.length) throw new RangeError('A10 requires ordered free-placement candidates');
      return references.candidates[0];
  }
}

/** Resolve A1–A10, apply SNAP to size, and reject unsafe or crowded placements. */
export function resolveChargePlacement(options: ResolvePlacementOptions): ChargePlacement {
  const { anchor, frame } = options;
  if (!ANCHORS.has(anchor)) throw new TypeError(`unsupported charge anchor: ${String(anchor)}`);
  validateFrame(frame);
  const random = rngRequired(options.rng);
  const size = snapChargeSize(options.size, frame, random, options.canvasHeight);
  const radius = physicalRadius(size, frame);
  const canvasHeight = options.canvasHeight ?? 1200;
  const safeArea = safeAreaPolygon(options.safeArea, frame, canvasHeight);
  const existing = options.existing ?? [];
  const minGap = FLAG_PLACEMENT_CONFIG.anchors.minimumGap / canvasHeight;
  const references = options.references ?? {};
  const candidates = anchor === 'A10'
    ? references.candidates!
    : [anchorPoint(anchor, references, frame, radius, canvasHeight)];
  const placementIsValid = (candidate: PlacementPoint) => {
    const placement = { ...candidate, size, rotation: options.rotation ?? 0, mirror: options.mirror ?? false };
    const copies = expandSymmetricPlacements([placement], options.symmetry ?? 'NONE');
    return copies.every((copy, index) => {
      const peers = copies.filter((other, otherIndex) =>
        otherIndex !== index && (Math.abs(other.u - copy.u) >= EPSILON || Math.abs(other.v - copy.v) >= EPSILON));
      return isSafe(copy, radius, frame, safeArea) &&
        hasClearance(copy, radius, frame, [...existing, ...peers], minGap);
    });
  };
  const point = candidates.find(placementIsValid);
  if (!point) {
    throw new RangeError(`${anchor} has no placement inside safe_area with the required minimum gaps`);
  }
  return {
    u: point.u,
    v: point.v,
    size,
    rotation: finite(options.rotation ?? 0, 'rotation'),
    mirror: options.mirror ?? false,
  };
}

export function isValidChargePlacement(
  placement: ChargePlacement,
  frame: PlacementFrame,
  safeArea: PlacementSafeAreaInput,
  existing: ExistingPlacement[] = [],
  canvasHeight = 1200,
): boolean {
  validateFrame(frame);
  const polygon = safeAreaPolygon(safeArea, frame, canvasHeight);
  const radius = physicalRadius(placement.size, frame);
  return isSafe(placement, radius, frame, polygon) &&
    hasClearance(placement, radius, frame, existing, FLAG_PLACEMENT_CONFIG.anchors.minimumGap / canvasHeight);
}

function boundedCount(value: number | undefined, range: readonly [number, number], fallback: number, label: string): number {
  const count = Math.round(value ?? fallback);
  if (!Number.isFinite(count) || count < range[0] || count > range[1]) {
    throw new RangeError(`${label} must be between ${range[0]} and ${range[1]}`);
  }
  return count;
}

export interface RepeatOptions {
  rows?: number;
  cols?: number;
  count?: number;
  stepX?: number;
  stepY?: number;
  stagger?: 'NONE' | 'HALF_OFFSET' | 'ALTERNATING_6_5';
  radius?: number;
  sweep?: number;
  startAngle?: number;
  axis?: 'HORIZONTAL' | 'VERTICAL';
  span?: number;
  constellation?: FlagConstellationId;
  size?: number;
}

/** Expand a repeat operator into normalized charge centers and relative size multipliers. */
export function expandFlagRepeat(kind: FlagRepeatKind, options: RepeatOptions = {}): RepeatPlacement[] {
  if (!REPEATERS.has(kind)) throw new TypeError(`unsupported repeat operator: ${String(kind)}`);
  const c = FLAG_PLACEMENT_CONFIG.repeaters;
  let points: Array<PlacementPoint & { size?: number }>;
  switch (kind) {
    case 'GRID': {
      const rows = boundedCount(options.rows, c.grid.rows, 1, 'GRID rows');
      const cols = boundedCount(options.cols, c.grid.cols, 1, 'GRID columns');
      const stagger = options.stagger ?? 'NONE';
      if (!c.grid.staggerModes.includes(stagger)) throw new TypeError(`unsupported GRID stagger mode: ${stagger}`);
      const stepX = finite(options.stepX ?? c.grid.defaultStepX, 'GRID stepX');
      const stepY = finite(options.stepY ?? c.grid.defaultStepY, 'GRID stepY');
      if (stepX <= 0 || stepY <= 0) throw new RangeError('GRID steps must be positive');
      points = [];
      for (let row = 0; row < rows; row += 1) {
        const rowCols = stagger === 'ALTERNATING_6_5'
          ? (row % 2 === 0 ? c.grid.sixFiveRows.even : c.grid.sixFiveRows.odd)
          : cols;
        const shift = stagger === 'HALF_OFFSET' && row % 2 ? stepX / 2 : 0;
        for (let col = 0; col < rowCols; col += 1) {
          points.push({
            u: 0.5 + (col - (rowCols - 1) / 2) * stepX + shift,
            v: rows === 1 ? 0.5 : 0.5 + (row - (rows - 1) / 2) * stepY,
            size: 1,
          });
        }
      }
      break;
    }
    case 'RING': {
      const count = boundedCount(options.count, c.ring.count, 6, 'RING count');
      const radius = finite(options.radius ?? c.ring.defaultRadius, 'RING radius');
      if (radius < c.ring.radius[0] || radius > c.ring.radius[1]) throw new RangeError('RING radius is outside the configured range');
      points = Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + 2 * Math.PI * i / count;
        return { u: 0.5 + radius * Math.cos(angle), v: 0.5 + radius * Math.sin(angle), size: 1 };
      });
      break;
    }
    case 'ARC': {
      const count = boundedCount(options.count, c.arc.count, c.arc.defaultCount, 'ARC count');
      const sweep = finite(options.sweep ?? c.arc.defaultSweep, 'ARC sweep');
      const radius = finite(options.radius ?? c.arc.defaultRadius, 'ARC radius');
      if (sweep < c.arc.sweep[0] || sweep > c.arc.sweep[1]) throw new RangeError('ARC sweep is outside the configured range');
      if (radius < c.arc.radius[0] || radius > c.arc.radius[1]) throw new RangeError('ARC radius is outside the configured range');
      const start = finite(options.startAngle ?? c.arc.defaultStartAngle, 'ARC start angle');
      points = Array.from({ length: count }, (_, i) => {
        const angle = (start - sweep / 2 + sweep * i / (count - 1)) * Math.PI / 180;
        return { u: 0.5 + radius * Math.cos(angle), v: 0.5 + radius * Math.sin(angle), size: 1 };
      });
      break;
    }
    case 'LINE': {
      const count = boundedCount(options.count, c.line.count, c.line.defaultCount, 'LINE count');
      const axis = options.axis ?? c.line.defaultAxis;
      if (!c.line.axes.includes(axis)) throw new TypeError(`unsupported LINE axis: ${axis}`);
      const span = finite(options.span ?? c.line.defaultSpan, 'LINE span');
      if (span <= 0 || span > 1) throw new RangeError('LINE span must be in (0,1]');
      points = Array.from({ length: count }, (_, i) => {
        const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * span;
        return axis === 'HORIZONTAL'
          ? { u: 0.5 + offset, v: 0.5, size: 1 }
          : { u: 0.5, v: 0.5 + offset, size: 1 };
      });
      break;
    }
    case 'CONSTELLATION': {
      const id = options.constellation;
      if (!id || !Object.hasOwn(c.constellations, id)) throw new TypeError('CONSTELLATION requires a configured preset id');
      points = c.constellations[id].positions.map((position) => ({ ...position }));
      break;
    }
  }
  const requestedSize = finite(options.size ?? 1, 'repeat size');
  if (requestedSize <= 0) throw new RangeError('repeat size multiplier must be positive');
  return points.map(({ u, v, size }) => ({
    u, v, sizeMultiplier: requestedSize * (size ?? 1), rotation: 0, mirror: false,
  }));
}

export function expandSymmetricRepeatPlacements(
  placements: RepeatPlacement[],
  symmetry: FlagSymmetryClass,
): RepeatPlacement[] {
  const charges = placements.map(({ u, v, sizeMultiplier, rotation, mirror }) => ({
    u, v, size: sizeMultiplier, rotation, mirror,
  }));
  return expandSymmetricPlacements(charges, symmetry)
    .map(({ u, v, size, rotation, mirror }) => ({ u, v, sizeMultiplier: size, rotation, mirror }));
}

export interface ResolveRepeatOptions extends RepeatOptions {
  kind: FlagRepeatKind;
  baseSize: number;
  frame: PlacementFrame;
  safeArea: PlacementSafeAreaInput;
  canvasHeight?: number;
  existing?: ExistingPlacement[];
  symmetry?: FlagSymmetryClass;
  rng: () => number;
}

/** Expand a repeat, snap each charge, and reject the full set if any copy violates spacing or safe_area. */
export function resolveFlagRepeatPlacements(options: ResolveRepeatOptions): ChargePlacement[] {
  validateFrame(options.frame);
  const { sizeRange } = FLAG_PLACEMENT_CONFIG.anchors;
  if (!Number.isFinite(options.baseSize) || options.baseSize < sizeRange[0] || options.baseSize > sizeRange[1]) {
    throw new RangeError(`repeat base size must be in ${sizeRange[0]}..${sizeRange[1]}`);
  }
  const canvasHeight = options.canvasHeight ?? 1200;
  const minGap = FLAG_PLACEMENT_CONFIG.anchors.minimumGap / canvasHeight;
  const area = safeAreaPolygon(options.safeArea, options.frame, canvasHeight);
  const repeated = expandSymmetricRepeatPlacements(
    expandFlagRepeat(options.kind, options),
    options.symmetry ?? 'NONE',
  );
  const placements = repeated.map(({ u, v, sizeMultiplier, rotation, mirror }) => {
    const requestedSize = options.baseSize * sizeMultiplier;
    if (requestedSize < sizeRange[0] || requestedSize > sizeRange[1]) {
      throw new RangeError(`${options.kind} repeat produces charge size outside ${sizeRange[0]}..${sizeRange[1]}`);
    }
    const size = snapChargeSize(requestedSize, options.frame, options.rng, canvasHeight);
    return { u, v, size, rotation, mirror };
  });
  const occupied: ChargePlacement[] = [];
  const existing = options.existing ?? [];
  for (const placement of placements) {
    const radius = physicalRadius(placement.size, options.frame);
    if (!isSafe(placement, radius, options.frame, area)) {
      throw new RangeError(`${options.kind} repeat places a charge outside safe_area`);
    }
    const sameCenter = (other: ExistingPlacement) =>
      Math.abs(other.u - placement.u) < EPSILON && Math.abs(other.v - placement.v) < EPSILON;
    if (!hasClearance(placement, radius, options.frame, existing, minGap) ||
        !hasClearance(placement, radius, options.frame, occupied.filter((other) => !sameCenter(other)), minGap)) {
      throw new RangeError(`${options.kind} repeat violates the required minimum gaps`);
    }
    occupied.push(placement);
  }
  return placements;
}

export function createRepeatNode(child: FlagNode, kind: FlagRepeatKind, options: RepeatOptions = {}): FlagNode {
  expandFlagRepeat(kind, options);
  const pattern = {
    type: kind,
    symmetry_support: [...FLAG_PLACEMENT_CONFIG.symmetry.operatorSupport.repeat],
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
  } as JsonObject;
  return { kind: 'repeat', pattern, child };
}

function reflectPlacement(placement: ChargePlacement, axis: 'X' | 'Y'): ChargePlacement {
  if (axis === 'X') {
    return { ...placement, u: 1 - placement.u, rotation: 180 - placement.rotation, mirror: !placement.mirror };
  }
  return { ...placement, v: 1 - placement.v, rotation: -placement.rotation, mirror: !placement.mirror };
}

function samePlacement(a: ChargePlacement, b: ChargePlacement): boolean {
  return Math.abs(a.u - b.u) < EPSILON && Math.abs(a.v - b.v) < EPSILON &&
    Math.abs(a.size - b.size) < EPSILON && Math.abs(a.rotation - b.rotation) < EPSILON &&
    a.mirror === b.mirror;
}

/** Add exact reflected partners, avoiding duplicate copies that lie on an axis. */
export function expandSymmetricPlacements(
  placements: ChargePlacement[],
  symmetry: FlagSymmetryClass,
): ChargePlacement[] {
  if (!FLAG_PLACEMENT_CONFIG.symmetry.classes.includes(symmetry)) throw new TypeError(`unsupported flag symmetry: ${symmetry}`);
  const axes: Array<'X' | 'Y'> = symmetry === 'MIR_H' ? ['X']
    : symmetry === 'MIR_V' ? ['Y']
      : symmetry === 'BOTH' ? ['X', 'Y'] : [];
  const expanded: ChargePlacement[] = [];
  for (const placement of placements) {
    const copies = symmetry === 'ROT180'
      ? [placement, reflectPlacement(reflectPlacement(placement, 'X'), 'Y')]
      : [placement];
    for (const axis of axes) copies.push(reflectPlacement(placement, axis));
    if (axes.length === 2) copies.push(reflectPlacement(reflectPlacement(placement, axes[0]), axes[1]));
    for (const copy of copies) if (!expanded.some((present) => samePlacement(present, copy))) expanded.push(copy);
  }
  return expanded;
}

function cloneNode(node: FlagNode): FlagNode {
  return JSON.parse(JSON.stringify(node)) as FlagNode;
}

function mirrored(node: FlagNode, axis: 'x' | 'y'): FlagNode {
  return { kind: 'mirror', axis, child: cloneNode(node) };
}

/** Apply a previously selected symmetry class around an already-composed operator tree. */
export function applyFlagSymmetry(node: FlagNode, symmetry: FlagSymmetryClass): FlagNode {
  if (!FLAG_PLACEMENT_CONFIG.symmetry.classes.includes(symmetry)) throw new TypeError(`unsupported flag symmetry: ${symmetry}`);
  if (symmetry === 'NONE') return node;
  const x = mirrored(node, 'x');
  const y = mirrored(node, 'y');
  const children: FlagNode[] = symmetry === 'MIR_H' ? [node, x]
    : symmetry === 'MIR_V' ? [node, y]
        : symmetry === 'BOTH'
        ? [node, x, y, mirrored(x, 'y')]
        : [node, mirrored(x, 'y')];
  return {
    kind: 'group',
    layout: { operator: 'flag-symmetry', class: symmetry, axes: [...FLAG_PLACEMENT_CONFIG.symmetry.mirrorAxes[symmetry]] },
    children,
  };
}

export function chooseFlagSymmetry(
  weights: Partial<Record<FlagSymmetryClass, number>> = FLAG_PLACEMENT_CONFIG.symmetry.defaultWeights,
  rng?: () => number,
): FlagSymmetryClass {
  const random = rngRequired(rng)();
  if (!(random >= 0 && random < 1)) throw new RangeError('seeded random source must return a value in [0,1)');
  const weighted = FLAG_PLACEMENT_CONFIG.symmetry.classes
    .map((symmetry) => ({ symmetry, weight: weights[symmetry] ?? 0 }))
    .filter(({ weight }) => Number.isFinite(weight) && weight > 0);
  const total = weighted.reduce((sum, { weight }) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError('symmetry weights must include a positive finite class weight');
  let threshold = random * total;
  for (const { symmetry, weight } of weighted) {
    threshold -= weight;
    if (threshold < 0) return symmetry;
  }
  return weighted[weighted.length - 1].symmetry;
}

export function supportsFlagSymmetry(node: FlagNode, symmetry: FlagSymmetryClass): boolean {
  if (!FLAG_PLACEMENT_CONFIG.symmetry.classes.includes(symmetry)) return false;
  const declaredSupport = FLAG_PLACEMENT_CONFIG.symmetry.operatorSupport[node.kind] as readonly FlagSymmetryClass[];
  if (!declaredSupport.includes(symmetry)) return false;
  switch (node.kind) {
    case 'fill': return true;
    case 'layer': return node.frame
      ? supportsFlagSymmetry(node.frame.ground, symmetry) && node.frame.layers.every((layer) => supportsFlagSymmetry(layer, symmetry))
      : true;
    case 'split': return node.children.every((child) => supportsFlagSymmetry(child, symmetry));
    case 'group': return node.children.every((child) => supportsFlagSymmetry(child, symmetry));
    case 'repeat': return supportsFlagSymmetry(node.child, symmetry);
    case 'mirror': return supportsFlagSymmetry(node.child, symmetry);
    case 'counterchange': return supportsFlagSymmetry(node.child, symmetry) &&
      (node.copies ?? []).every((copy) => supportsFlagSymmetry(copy.child, symmetry));
  }
}

export function applySymmetryToFrame(frame: FlagFrame, symmetry: FlagSymmetryClass): FlagFrame {
  return {
    ...frame,
    ground: applyFlagSymmetry(frame.ground, symmetry),
    layers: frame.layers.map((layer) => applyFlagSymmetry(layer, symmetry)),
  };
}

function remapSlots(node: FlagNode, slotMap: Record<string, string>): FlagNode {
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') return slotMap[value] ?? value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
    }
    return value;
  };
  return rewrite(node) as FlagNode;
}

export interface CounterchangeRegion {
  id: string;
  clip: JsonValue;
  backgroundSlot: string;
}
export interface BuildCounterchangeOptions {
  boundary: JsonValue;
  first: CounterchangeRegion;
  second: CounterchangeRegion;
  chargeSlot: string;
}

/** Make two region-clipped copies whose charge color is the other region's background slot. */
export function buildCounterchangeNode(child: FlagNode, options: BuildCounterchangeOptions): CounterchangeNode {
  const { first, second, chargeSlot } = options;
  if (!first.id || !second.id || first.id === second.id) throw new RangeError('counterchange needs two distinct region ids');
  if (!chargeSlot || !first.backgroundSlot || !second.backgroundSlot || first.backgroundSlot === second.backgroundSlot) {
    throw new RangeError('counterchange needs a charge slot and two distinct background slots');
  }
  const copies: CounterchangeCopy[] = [
    {
      region_id: first.id,
      clip: first.clip,
      slot_map: { [chargeSlot]: second.backgroundSlot },
      child: remapSlots(cloneNode(child), { [chargeSlot]: second.backgroundSlot }),
    },
    {
      region_id: second.id,
      clip: second.clip,
      slot_map: { [chargeSlot]: first.backgroundSlot },
      child: remapSlots(cloneNode(child), { [chargeSlot]: first.backgroundSlot }),
    },
  ];
  return { kind: 'counterchange', boundary: options.boundary, child, copies };
}
