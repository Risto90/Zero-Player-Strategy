/**
 * Геометрия подписей использует только векторные кольца контуров и экранное окно.
 * Не заменять эти проверки проходом по пикселям карты: при сдвиге и масштабе
 * подпись заново размещается по видимой части тех же контуров.
 */
export interface LabelGeometryPoint {
  x: number;
  y: number;
}

export interface LabelGeometryPlacement {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  angle: number;
  fontSize: number;
  letterSpacing: number;
  path: LabelGeometryPoint[] | null;
  lineCount: number;
}

export interface LabelAvoidanceRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LabelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Axis {
  x: number;
  y: number;
  angle: number;
  elongation: number;
}

const LABEL_EDGE_MARGIN = 8;
const LABEL_MIN_SIZE = 11;
const LABEL_MAX_TRACKING = 0.35;

function pointsFromRing(ring: ArrayLike<number>, scale: number, ox: number, oy: number): LabelGeometryPoint[] {
  const points: LabelGeometryPoint[] = [];
  for (let index = 0; index + 1 < ring.length; index += 2) {
    points.push({ x: ox + ring[index] * scale, y: oy + ring[index + 1] * scale });
  }
  return points;
}

function boundsOf(rings: readonly LabelGeometryPoint[][]): LabelBounds | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
  }
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

function clipSegment(
  from: LabelGeometryPoint,
  to: LabelGeometryPoint,
  bounds: LabelBounds,
): [LabelGeometryPoint, LabelGeometryPoint] | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  let start = 0, end = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [from.x - bounds.left, bounds.right - from.x, from.y - bounds.top, bounds.bottom - from.y];
  for (let index = 0; index < 4; index += 1) {
    if (Math.abs(p[index]) < 1e-9) {
      if (q[index] < 0) return null;
      continue;
    }
    const t = q[index] / p[index];
    if (p[index] < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return null;
  }
  return [
    { x: from.x + dx * start, y: from.y + dy * start },
    { x: from.x + dx * end, y: from.y + dy * end },
  ];
}

function visibleBoundaryPoints(rings: readonly LabelGeometryPoint[][], bounds: LabelBounds): LabelGeometryPoint[] {
  const points: LabelGeometryPoint[] = [];
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const clipped = clipSegment(ring[previous], ring[index], bounds);
      if (clipped) points.push(...clipped);
    }
  }
  return points;
}

function containsPoint(rings: readonly LabelGeometryPoint[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const a = ring[index], b = ring[previous];
      if ((a.y > y) !== (b.y > y) &&
          x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

function principalAxis(points: readonly LabelGeometryPoint[]): Axis {
  if (!points.length) return { x: 1, y: 0, angle: 0, elongation: 1 };
  let centerX = 0, centerY = 0;
  for (const point of points) {
    centerX += point.x;
    centerY += point.y;
  }
  centerX /= Math.max(1, points.length);
  centerY /= Math.max(1, points.length);
  let xx = 0, yy = 0, xy = 0;
  for (const point of points) {
    const x = point.x - centerX, y = point.y - centerY;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const trace = xx + yy;
  const root = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy * xy));
  const major = Math.max(0.001, (trace + root) / 2);
  const minor = Math.max(0.001, (trace - root) / 2);
  return { x: Math.cos(angle), y: Math.sin(angle), angle, elongation: Math.sqrt(major / minor) };
}

function lineIntervals(
  rings: readonly LabelGeometryPoint[][],
  axis: Axis,
  at: number,
): [number, number][] {
  const intersections: number[] = [];
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const a = ring[previous], b = ring[index];
      const au = a.x * axis.x + a.y * axis.y;
      const bu = b.x * axis.x + b.y * axis.y;
      if ((au <= at && bu > at) || (bu <= at && au > at)) {
        const t = (at - au) / (bu - au);
        const av = -a.x * axis.y + a.y * axis.x;
        const bv = -b.x * axis.y + b.y * axis.x;
        intersections.push(av + (bv - av) * t);
      }
    }
  }
  intersections.sort((a, b) => a - b);
  const intervals: [number, number][] = [];
  for (let index = 1; index < intersections.length; index += 2) {
    intervals.push([intersections[index - 1], intersections[index]]);
  }
  return intervals;
}

function viewportVRangeAtU(axis: Axis, u: number, viewport: LabelBounds): [number, number] | null {
  const corners = [
    { x: viewport.left, y: viewport.top },
    { x: viewport.right, y: viewport.top },
    { x: viewport.right, y: viewport.bottom },
    { x: viewport.left, y: viewport.bottom },
  ];
  const values: number[] = [];
  for (let index = 0; index < corners.length; index += 1) {
    const first = corners[index], second = corners[(index + 1) % corners.length];
    const firstU = first.x * axis.x + first.y * axis.y;
    const secondU = second.x * axis.x + second.y * axis.y;
    const firstV = -first.x * axis.y + first.y * axis.x;
    const secondV = -second.x * axis.y + second.y * axis.x;
    if (Math.abs(secondU - firstU) < 1e-9) {
      if (Math.abs(u - firstU) < 0.01) values.push(firstV, secondV);
      continue;
    }
    const t = (u - firstU) / (secondU - firstU);
    if (t >= -1e-9 && t <= 1 + 1e-9) values.push(firstV + (secondV - firstV) * t);
  }
  return values.length >= 2 ? [Math.min(...values), Math.max(...values)] : null;
}

function intervalAtPoint(
  rings: readonly LabelGeometryPoint[][],
  x: number,
  y: number,
  angle: number,
  viewport: LabelBounds,
  allowBridge: boolean,
): number {
  const axis = { x: -Math.sin(angle), y: Math.cos(angle), angle: angle + Math.PI / 2, elongation: 1 };
  const u = x * axis.x + y * axis.y;
  const along = -(x * Math.cos(angle) + y * Math.sin(angle));
  const visibleV = viewportVRangeAtU(axis, u, viewport);
  if (!visibleV) return 0;
  const intervals = lineIntervals(rings, axis, u)
    .map(([start, end]) => [Math.max(start, visibleV[0]), Math.min(end, visibleV[1])] as [number, number])
    .filter(([start, end]) => start <= end);
  const interval = allowBridge
    ? intervals.length && along >= intervals[0][0] - 0.01 && along <= intervals.at(-1)![1] + 0.01
      ? [intervals[0][0], intervals.at(-1)![1]] as [number, number]
      : undefined
    : intervals.find(([start, end]) => along >= start - 0.01 && along <= end + 0.01);
  return interval ? interval[1] - interval[0] : 0;
}

function segmentIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: LabelBounds,
): boolean {
  const dx = bx - ax, dy = by - ay;
  let start = 0, end = 1;
  for (const [p, q] of [
    [-dx, ax - rect.left],
    [dx, rect.right - ax],
    [-dy, ay - rect.top],
    [dy, rect.bottom - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return false;
  }
  return true;
}

function sampleRectangle(
  rings: readonly LabelGeometryPoint[][],
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  allowBridge: boolean,
  viewport: LabelBounds,
): boolean {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const totalWidth = width + height * 0.5;
  const totalHeight = height * 1.5;
  const corners = [
    [-totalWidth / 2, -totalHeight / 2],
    [totalWidth / 2, -totalHeight / 2],
    [totalWidth / 2, totalHeight / 2],
    [-totalWidth / 2, totalHeight / 2],
  ].map(([localX, localY]) => ({
    x: x + localX * cos - localY * sin,
    y: y + localX * sin + localY * cos,
  }));
  const footprint = {
    left: Math.min(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    right: Math.max(...corners.map((point) => point.x)),
    bottom: Math.max(...corners.map((point) => point.y)),
  };
  if (corners.some((point) =>
    point.x < viewport.left || point.x > viewport.right ||
    point.y < viewport.top || point.y > viewport.bottom)) return false;
  if (!allowBridge) {
    if (!corners.every((point) => containsPoint(rings, point.x, point.y))) return false;
    for (const ring of rings) {
      for (let index = 0; index < ring.length; index += 1) {
        const start = ring[index], end = ring[(index + 1) % ring.length];
        if (segmentIntersectsRect(start.x, start.y, end.x, end.y, footprint)) return false;
      }
    }
    return true;
  }
  let inside = 0, total = 0;
  for (let row = 0; row <= 4; row += 1) {
    const localY = (row / 4 - 0.5) * totalHeight;
    for (let column = 0; column <= 8; column += 1) {
      const localX = (column / 8 - 0.5) * totalWidth;
      const pointX = x + localX * cos - localY * sin;
      const pointY = y + localX * sin + localY * cos;
       if (pointX >= viewport.left && pointX <= viewport.right &&
           pointY >= viewport.top && pointY <= viewport.bottom &&
           containsPoint(rings, pointX, pointY)) inside += 1;
      total += 1;
    }
  }
  const coverage = inside / total;
  return allowBridge ? coverage > 0.5 : coverage === 1;
}

function normalizeReadableAngle(angle: number): number {
  while (angle > Math.PI / 2) angle -= Math.PI;
  while (angle <= -Math.PI / 2) angle += Math.PI;
  return angle;
}

function labelCenterCandidates(
  rings: readonly LabelGeometryPoint[][],
  bounds: LabelBounds,
  allowBridge: boolean,
  gridSteps = 7,
): LabelGeometryPoint[] {
  const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
  const candidates = [center];
  for (let row = 1; row <= gridSteps; row += 1) {
    for (let column = 1; column <= gridSteps; column += 1) {
      candidates.push({
        x: bounds.left + (bounds.right - bounds.left) * column / (gridSteps + 1),
        y: bounds.top + (bounds.bottom - bounds.top) * row / (gridSteps + 1),
      });
    }
  }
  const horizontal = { x: 0, y: 1, angle: Math.PI / 2, elongation: 1 };
  const lineCount = Math.max(8, Math.min(32, Math.ceil((bounds.bottom - bounds.top) / 12)));
  for (let index = 0; index <= lineCount; index += 1) {
    const y = bounds.top + (bounds.bottom - bounds.top) * index / lineCount;
    for (const [start, end] of lineIntervals(rings, horizontal, y)) {
      candidates.push({ x: -(start + end) / 2, y });
    }
  }
  const unique = new Map<string, LabelGeometryPoint>();
  for (const candidate of candidates) {
    const key = `${Math.round(candidate.x * 2)}:${Math.round(candidate.y * 2)}`;
    unique.set(key, candidate);
  }
  return [...unique.values()]
    .filter((point) => point.x >= bounds.left && point.x <= bounds.right &&
      point.y >= bounds.top && point.y <= bounds.bottom &&
      (allowBridge || containsPoint(rings, point.x, point.y)))
    .sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y));
}

function smoothPath(points: LabelGeometryPoint[]): LabelGeometryPoint[] {
  if (points.length < 5) return points;
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1], current = points[index], after = points[index + 1];
    result.push({
      x: before.x * 0.25 + current.x * 0.5 + after.x * 0.25,
      y: before.y * 0.25 + current.y * 0.5 + after.y * 0.25,
    });
  }
  result.push(points[points.length - 1]);
  return result;
}

function centerline(
  rings: readonly LabelGeometryPoint[][],
  axis: Axis,
  viewport: LabelBounds,
): LabelGeometryPoint[] {
  let minU = Infinity, maxU = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      const u = point.x * axis.x + point.y * axis.y;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
    }
  }
  const viewportCorners = [
    { x: viewport.left, y: viewport.top },
    { x: viewport.right, y: viewport.top },
    { x: viewport.right, y: viewport.bottom },
    { x: viewport.left, y: viewport.bottom },
  ];
  const viewportU = viewportCorners.map((point) => point.x * axis.x + point.y * axis.y);
  minU = Math.max(minU, Math.min(...viewportU));
  maxU = Math.min(maxU, Math.max(...viewportU));
  if (!Number.isFinite(minU) || maxU - minU < 1) return [];
  const points: LabelGeometryPoint[] = [];
  let previousV: number | null = null;
  const count = Math.max(20, Math.min(80, Math.ceil((maxU - minU) / 12)));
  for (let index = 0; index <= count; index += 1) {
    const u = minU + (maxU - minU) * index / count;
    const visibleV = viewportVRangeAtU(axis, u, viewport);
    if (!visibleV) continue;
    const candidates = lineIntervals(rings, axis, u)
      .map(([start, end]) => [Math.max(start, visibleV[0]), Math.min(end, visibleV[1])] as [number, number])
      .filter((interval) => interval[1] - interval[0] > 0.5);
    if (!candidates.length) continue;
    const selected: [number, number] = previousV === null
      ? candidates.reduce((best, interval) =>
        interval[1] - interval[0] > best[1] - best[0] ? interval : best)
      : candidates.reduce((best, interval) => {
        const center = (interval[0] + interval[1]) / 2;
        const bestCenter = (best[0] + best[1]) / 2;
        const score = Math.abs(center - previousV!) - (interval[1] - interval[0]) * 0.02;
        const bestScore = Math.abs(bestCenter - previousV!) - (best[1] - best[0]) * 0.02;
        return score < bestScore ? interval : best;
      });
    previousV = (selected[0] + selected[1]) / 2;
    points.push({
      x: axis.x * u - axis.y * previousV,
      y: axis.y * u + axis.x * previousV,
    });
  }
  return smoothPath(points);
}

function pathLength(points: readonly LabelGeometryPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function pointAlongPath(points: readonly LabelGeometryPoint[], distance: number): { point: LabelGeometryPoint; angle: number } {
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1], after = points[index];
    const length = Math.hypot(after.x - before.x, after.y - before.y);
    if (traversed + length >= distance) {
      const t = length > 0 ? (distance - traversed) / length : 0;
      return {
        point: { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t },
        angle: Math.atan2(after.y - before.y, after.x - before.x),
      };
    }
    traversed += length;
  }
  const last = points[points.length - 1] ?? { x: 0, y: 0 };
  const before = points[points.length - 2] ?? last;
  return { point: last, angle: Math.atan2(last.y - before.y, last.x - before.x) };
}

function centeredPath(points: readonly LabelGeometryPoint[], width: number): LabelGeometryPoint[] | null {
  const length = pathLength(points);
  if (length < width) return null;
  const start = (length - width) / 2;
  const end = start + width;
  const result = [pointAlongPath(points, start).point];
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    traversed += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    if (traversed > start && traversed < end) result.push(points[index]);
  }
  result.push(pointAlongPath(points, end).point);
  return result;
}

function curveAllowed(points: readonly LabelGeometryPoint[], fontSize: number): boolean {
  if (points.length < 3) return false;
  let totalTurn = 0, previousAngle: number | null = null, minimumRadius = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const angle = Math.atan2(points[index].y - points[index - 1].y, points[index].x - points[index - 1].x);
    if (previousAngle !== null) {
      let turn = angle - previousAngle;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      totalTurn += Math.abs(turn);
      const segmentLength = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
      if (Math.abs(turn) > 0.001) minimumRadius = Math.min(minimumRadius, segmentLength / Math.abs(turn));
    }
    previousAngle = angle;
  }
  const chord = Math.hypot(points[points.length - 1].x - points[0].x, points[points.length - 1].y - points[0].y);
  const length = pathLength(points);
  return totalTurn <= (120 * Math.PI) / 180 &&
    minimumRadius >= 3 * fontSize &&
    length / Math.max(1, chord) <= 1.25;
}

function pathCoverage(
  rings: readonly LabelGeometryPoint[][],
  path: readonly LabelGeometryPoint[],
  fontSize: number,
  allowBridge: boolean,
  viewport: LabelBounds,
): boolean {
  let inside = 0, total = 0;
  const length = pathLength(path);
  const sampleCount = Math.max(8, Math.ceil(length / Math.max(2, fontSize * 0.25)));
  for (let index = 0; index <= sampleCount; index += 1) {
    const location = pointAlongPath(path, length * index / sampleCount);
    const normalX = -Math.sin(location.angle), normalY = Math.cos(location.angle);
    for (const offset of [-0.48, 0, 0.48]) {
      const x = location.point.x + normalX * fontSize * offset;
      const y = location.point.y + normalY * fontSize * offset;
      if (x >= viewport.left && x <= viewport.right && y >= viewport.top && y <= viewport.bottom &&
          containsPoint(rings, x, y)) inside += 1;
      total += 1;
    }
  }
  return allowBridge ? inside / total > 0.5 : inside === total;
}

/**
 * Подбирает подпись только по видимым в окне векторным кольцам; растр и проверка точек карты не нужны.
 */
export function fitLabelToVisibleContour(input: {
  rings: readonly ArrayLike<number>[];
  scale: number;
  ox: number;
  oy: number;
  viewportWidth: number;
  viewportHeight: number;
  glyphWidthFactor: number;
  glyphCount: number;
  lineCount?: number;
  maxFontSize: number;
  allowBridge: boolean;
  obstacles?: readonly LabelAvoidanceRect[];
}): LabelGeometryPlacement | null {
  const rings = input.rings.map((ring) => pointsFromRing(ring, input.scale, input.ox, input.oy));
  const contourBounds = boundsOf(rings);
  if (!contourBounds) return null;
  const viewport = {
    left: LABEL_EDGE_MARGIN,
    top: LABEL_EDGE_MARGIN,
    right: Math.max(LABEL_EDGE_MARGIN, input.viewportWidth - LABEL_EDGE_MARGIN),
    bottom: Math.max(LABEL_EDGE_MARGIN, input.viewportHeight - LABEL_EDGE_MARGIN),
  };
  const bounds = {
    left: Math.max(contourBounds.left, viewport.left),
    top: Math.max(contourBounds.top, viewport.top),
    right: Math.min(contourBounds.right, viewport.right),
    bottom: Math.min(contourBounds.bottom, viewport.bottom),
  };
  if (bounds.right - bounds.left < LABEL_MIN_SIZE || bounds.bottom - bounds.top < LABEL_MIN_SIZE) return null;

  const axis = principalAxis(visibleBoundaryPoints(rings, viewport));
  const maxAngle = axis.elongation >= 3 ? Math.PI / 2 : axis.elongation >= 2 ? Math.PI / 3 : Math.PI / 12;
  const principalAngle = Math.max(-maxAngle, Math.min(maxAngle, normalizeReadableAngle(axis.angle)));
  const angles = [...new Set([
    0,
    principalAngle,
    Math.max(-maxAngle, principalAngle - Math.PI / 12),
    Math.min(maxAngle, principalAngle + Math.PI / 12),
  ].map((angle) => Math.round(normalizeReadableAngle(angle) * 1000) / 1000))];
  const centers = labelCenterCandidates(rings, bounds, input.allowBridge);
  const naturalLimit = Math.min(
    Math.max(LABEL_MIN_SIZE, input.maxFontSize),
    Math.max(LABEL_MIN_SIZE, Math.hypot(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.35),
  );
  const lineCount = Math.max(1, Math.min(3, Math.floor(input.lineCount ?? 1)));
  const curvedPath = lineCount === 1 && axis.elongation >= 1.5
    ? centerline(rings, axis, viewport)
    : [];
  let best: LabelGeometryPlacement | null = null;
  let bestFillScore = -Infinity;

  const findTracking = (fontSize: number, available: number) => {
    const gaps = Math.max(0, input.glyphCount - 1);
    const glyphWidth = input.glyphWidthFactor * fontSize;
    const targetWidth = available * 0.72;
    const letterSpacing = gaps > 0
      ? Math.max(0, Math.min(fontSize * LABEL_MAX_TRACKING, (targetWidth - glyphWidth) / gaps))
      : 0;
    return { glyphWidth, letterSpacing, textWidth: glyphWidth + gaps * letterSpacing };
  };

  const consider = (
    center: LabelGeometryPoint,
    angle: number,
    available: number,
    curved: readonly LabelGeometryPoint[] | null,
  ) => {
    if (available <= 0) return;
    let low = LABEL_MIN_SIZE;
    let high = Math.min(naturalLimit, available / Math.max(1, input.glyphWidthFactor) * 0.92);
    let placement: LabelGeometryPlacement | null = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (high < LABEL_MIN_SIZE || (attempt > 0 && high - low <= 0.15)) break;
      const fontSize = attempt === 0 ? high : (low + high) / 2;
      const metrics = findTracking(fontSize, available);
      const lineHeight = fontSize * 1.2 * lineCount;
      const fittedPath = curved ? centeredPath(curved, metrics.textWidth) : null;
      const shapeFits = metrics.textWidth <= available * 0.9 &&
        (curved
          ? Boolean(fittedPath && curveAllowed(fittedPath, fontSize) &&
            pathCoverage(rings, fittedPath, fontSize, input.allowBridge, viewport))
          : sampleRectangle(
            rings,
            center.x,
            center.y,
            metrics.textWidth,
            lineHeight,
            angle,
            input.allowBridge,
            viewport,
          ));
      const margin = fontSize * 0.3;
      const obstacleBounds = fittedPath?.length
        ? {
          left: Math.min(...fittedPath.map((point) => point.x)) - lineHeight * 0.75 - margin,
          top: Math.min(...fittedPath.map((point) => point.y)) - lineHeight * 0.75 - margin,
          right: Math.max(...fittedPath.map((point) => point.x)) + lineHeight * 0.75 + margin,
          bottom: Math.max(...fittedPath.map((point) => point.y)) + lineHeight * 0.75 + margin,
        }
        : (() => {
          const paddedWidth = metrics.textWidth + lineHeight * 0.5;
          const paddedHeight = lineHeight * 1.5;
          const extentX = (Math.abs(Math.cos(angle)) * paddedWidth +
            Math.abs(Math.sin(angle)) * paddedHeight) / 2 + margin;
          const extentY = (Math.abs(Math.sin(angle)) * paddedWidth +
            Math.abs(Math.cos(angle)) * paddedHeight) / 2 + margin;
          return {
            left: center.x - extentX,
            top: center.y - extentY,
            right: center.x + extentX,
            bottom: center.y + extentY,
          };
        })();
      const clearOfObstacles = !(input.obstacles ?? []).some((obstacle) =>
        obstacleBounds.left < obstacle.right && obstacleBounds.right > obstacle.left &&
        obstacleBounds.top < obstacle.bottom && obstacleBounds.bottom > obstacle.top);
      const fits = shapeFits && clearOfObstacles;
      if (fits) {
        placement = {
          x: center.x,
          y: center.y,
          worldX: (center.x - input.ox) / input.scale,
          worldY: (center.y - input.oy) / input.scale,
          angle: curved ? 0 : normalizeReadableAngle(angle),
          fontSize,
          letterSpacing: metrics.letterSpacing,
          path: fittedPath,
          lineCount,
        };
        low = fontSize;
      } else high = fontSize;
    }
    if (!placement) return;
    const fill = (input.glyphWidthFactor * placement.fontSize +
      Math.max(0, input.glyphCount - 1) * placement.letterSpacing) / Math.max(1, available);
    const score = placement.fontSize - Math.abs(fill - 0.7) * 0.2;
    if (!best || score > bestFillScore) {
      best = placement;
      bestFillScore = score;
    }
  };

  for (const angle of angles) {
    for (const center of centers) {
      const available = intervalAtPoint(rings, center.x, center.y, angle, viewport, input.allowBridge);
      consider(center, angle, available, null);
    }
  }
  if (!best && input.obstacles?.length) {
    const finerCenters = labelCenterCandidates(rings, bounds, input.allowBridge, 15);
    for (const angle of angles) {
      for (const center of finerCenters) {
        const available = intervalAtPoint(rings, center.x, center.y, angle, viewport, input.allowBridge);
        consider(center, angle, available, null);
      }
    }
  }
  if (curvedPath.length >= 3) {
    const length = pathLength(curvedPath);
    if (length > 0) {
      const midpoint = pointAlongPath(curvedPath, length / 2).point;
      consider(midpoint, axis.angle, length, curvedPath);
    }
  }
  return best;
}
