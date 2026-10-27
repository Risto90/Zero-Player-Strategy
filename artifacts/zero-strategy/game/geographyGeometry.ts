import { MAP_WIDTH } from './config';
import type { RiverFeature } from './geographyFeatures';
import type { World } from './world';

export interface RiverPathSegment {
  riverId: number;
  scaleRank: number;
  strength: 1 | 2 | 3;
  width: number;
  name: string | null;
  points: { x: number; y: number }[];
  path: string;
  contourPoints: { x: number; y: number }[];
  contourPath: string;
  length: number;
  bounds: [number, number, number, number];
}

const discoveredPathCache = new WeakMap<World, {
  version: number;
  territoryVersion: number;
  segments: RiverPathSegment[];
}>();

export function riverStrengthForRank(scaleRank: number): 1 | 2 | 3 {
  return scaleRank <= 2 ? 3 : scaleRank <= 5 ? 2 : 1;
}

export function riverVisibilityScale(baseScale: number, strength: number): number {
  const tributaryZoom = strength === 2 ? 1.6 : strength === 1 ? 2.4 : 1;
  return baseScale * tributaryZoom;
}

function asPath(points: { x: number; y: number }[]): string {
  return points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
  ).join(' ');
}

function asClosedPath(points: { x: number; y: number }[]): string {
  return points.length < 3 ? '' : `${asPath(points)} Z`;
}

function pathLength(points: { x: number; y: number }[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function riverContour(points: { x: number; y: number }[], width: number): { x: number; y: number }[] {
  const halfWidth = width / 2;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const previousLength = Math.hypot(point.x - before.x, point.y - before.y) || 1;
    const nextLength = Math.hypot(after.x - point.x, after.y - point.y) || 1;
    const previousNormal = { x: -(point.y - before.y) / previousLength, y: (point.x - before.x) / previousLength };
    const nextNormal = { x: -(after.y - point.y) / nextLength, y: (after.x - point.x) / nextLength };
    let nx = previousNormal.x + nextNormal.x;
    let ny = previousNormal.y + nextNormal.y;
    const normalLength = Math.hypot(nx, ny);
    if (normalLength < 0.001) {
      nx = nextNormal.x;
      ny = nextNormal.y;
    } else {
      nx /= normalLength;
      ny /= normalLength;
    }
    const denominator = Math.max(0.5, Math.abs(nx * nextNormal.x + ny * nextNormal.y));
    const offset = Math.min(halfWidth / denominator, halfWidth * 2);
    left.push({ x: point.x + nx * offset, y: point.y + ny * offset });
    right.push({ x: point.x - nx * offset, y: point.y - ny * offset });
  }
  return [...left, ...right.reverse()];
}

function unwrapPath(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (!points.length) return [];
  const result = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const previous = result[index - 1];
    let x = points[index].x;
    while (x - previous.x > MAP_WIDTH / 2) x -= MAP_WIDTH;
    while (x - previous.x < -MAP_WIDTH / 2) x += MAP_WIDTH;
    result.push({ x, y: points[index].y });
  }
  return result;
}

function pathBounds(points: { x: number; y: number }[]) {
  const first = points[0];
  return points.reduce((bounds, point) => ({
    x0: Math.min(bounds.x0, point.x),
    y0: Math.min(bounds.y0, point.y),
    x1: Math.max(bounds.x1, point.x),
    y1: Math.max(bounds.y1, point.y),
  }), { x0: first.x, y0: first.y, x1: first.x, y1: first.y });
}

function pathsMayMeet(
  first: ReturnType<typeof pathBounds>,
  second: ReturnType<typeof pathBounds>,
  padding: number,
): boolean {
  if (first.y1 + padding < second.y0 || second.y1 + padding < first.y0) return false;
  return [-MAP_WIDTH, 0, MAP_WIDTH].some((offset) =>
    first.x1 + padding >= second.x0 + offset && second.x1 + padding >= first.x0 + offset);
}

function pointSegmentDistance(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (start.x + dx * fraction), point.y - (start.y + dy * fraction));
}

function distanceToPaths(point: { x: number; y: number }, paths: { x: number; y: number }[][]): number {
  let distance = Infinity;
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      distance = Math.min(distance, pointSegmentDistance(point, path[index - 1], path[index]));
    }
  }
  return distance;
}

function crossingFraction(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): number | null {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const cdX = d.x - c.x;
  const cdY = d.y - c.y;
  const denominator = abX * cdY - abY * cdX;
  if (Math.abs(denominator) < 1e-9) return null;
  const acX = c.x - a.x;
  const acY = c.y - a.y;
  const t = (acX * cdY - acY * cdX) / denominator;
  const u = (acX * abY - acY * abX) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

function cumulativePathLengths(points: { x: number; y: number }[]): number[] {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    ));
  }
  return lengths;
}

function pointAtDistance(points: { x: number; y: number }[], lengths: number[], distance: number): { x: number; y: number } {
  const target = Math.max(0, Math.min(lengths[lengths.length - 1], distance));
  let index = 1;
  while (index < lengths.length - 1 && lengths[index] < target) index += 1;
  const start = points[index - 1];
  const end = points[index];
  const segmentLength = lengths[index] - lengths[index - 1];
  const fraction = segmentLength > 0 ? (target - lengths[index - 1]) / segmentLength : 0;
  return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
}

function pathPrefix(points: { x: number; y: number }[], lengths: number[], endDistance: number): { x: number; y: number }[] {
  const result = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    if (lengths[index] >= endDistance) break;
    result.push(points[index]);
  }
  const end = pointAtDistance(points, lengths, endDistance);
  const last = result[result.length - 1];
  if (Math.hypot(last.x - end.x, last.y - end.y) > 1e-5) result.push(end);
  return result;
}

/** Обрезает приток по внешней границе более крупного русла, в которое он впадает. */
function trimAtConfluence(
  points: { x: number; y: number }[],
  strongerPaths: { x: number; y: number }[][],
  boundaryDistance: number,
): { x: number; y: number }[] {
  if (points.length < 2 || !strongerPaths.length) return points;
  const lengths = cumulativePathLengths(points);
  const totalLength = lengths[lengths.length - 1];
  if (totalLength <= 0) return points;
  const endpointHits = [
    { distance: distanceToPaths(points[0], strongerPaths), along: 0 },
    { distance: distanceToPaths(points[points.length - 1], strongerPaths), along: totalLength },
  ].filter((hit) => hit.distance <= boundaryDistance + 0.01);

  let crossingAlong: number | null = null;
  if (endpointHits.length) {
    endpointHits.sort((a, b) => a.distance - b.distance);
    crossingAlong = endpointHits[0].along;
  } else {
    const crossings: number[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const segmentLength = lengths[index] - lengths[index - 1];
      for (const main of strongerPaths) {
        for (let mainIndex = 1; mainIndex < main.length; mainIndex += 1) {
          const fraction = crossingFraction(start, end, main[mainIndex - 1], main[mainIndex]);
          if (fraction !== null) crossings.push(lengths[index - 1] + fraction * segmentLength);
        }
      }
    }
    if (crossings.length) {
      crossings.sort((a, b) => Math.min(a, totalLength - a) - Math.min(b, totalLength - b));
      crossingAlong = crossings[0];
    }
  }
  if (crossingAlong === null) return points;

  const reverse = crossingAlong <= totalLength - crossingAlong;
  const oriented = reverse ? [...points].reverse() : points;
  const orientedLengths = reverse
    ? cumulativePathLengths(oriented)
    : lengths;
  const confluenceDistance = reverse ? totalLength - crossingAlong : crossingAlong;
  let cursor = confluenceDistance;
  for (let index = orientedLengths.length - 1; index > 0; index -= 1) {
    const startDistance = orientedLengths[index - 1];
    const startPoint = pointAtDistance(oriented, orientedLengths, startDistance);
    if (distanceToPaths(startPoint, strongerPaths) >= boundaryDistance) {
      let low = startDistance;
      let high = cursor;
      for (let step = 0; step < 24; step += 1) {
        const middle = (low + high) / 2;
        if (distanceToPaths(pointAtDistance(oriented, orientedLengths, middle), strongerPaths) >= boundaryDistance) low = middle;
        else high = middle;
      }
      return pathPrefix(oriented, orientedLengths, (low + high) / 2);
    }
    cursor = startDistance;
  }
  return [];
}

function appendSegment(
  output: RiverPathSegment[],
  river: RiverFeature,
  points: { x: number; y: number }[],
  strength: 1 | 2 | 3,
): void {
  if (points.length < 2) return;
  const length = pathLength(points);
  if (length <= 0) return;
  const width = strength;
  const contourPoints = riverContour(points, width);
  const contourPath = asClosedPath(contourPoints);
  if (!contourPath) return;
  let minX = contourPoints[0].x;
  let minY = contourPoints[0].y;
  let maxX = contourPoints[0].x;
  let maxY = contourPoints[0].y;
  for (const point of contourPoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  output.push({
    riverId: river.id,
    scaleRank: river.scaleRank,
    strength,
    width,
    name: river.name,
    points,
    path: asPath(points),
    contourPoints,
    contourPath,
    length,
    bounds: [minX, minY, maxX, maxY],
  });
}

function splitAtMapSeam(
  river: RiverFeature,
  points: { x: number; y: number }[],
  strength: 1 | 2 | 3,
  output: RiverPathSegment[],
): void {
  if (points.length < 2) return;
  let current = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const rawDx = next.x - previous.x;
    if (Math.abs(rawDx) <= MAP_WIDTH / 2) {
      current.push(next);
      continue;
    }

    const adjustedX = next.x + (rawDx > 0 ? -MAP_WIDTH : MAP_WIDTH);
    const crossesEast = adjustedX > previous.x;
    const edgeX = crossesEast ? MAP_WIDTH : 0;
    const fraction = (edgeX - previous.x) / (adjustedX - previous.x);
    const edgeY = previous.y + (next.y - previous.y) * fraction;
    current.push({ x: edgeX, y: edgeY });
    appendSegment(output, river, current, strength);
    current = [{ x: crossesEast ? 0 : MAP_WIDTH, y: edgeY }, next];
  }
  appendSegment(output, river, current, strength);
}

export function discoveredRiverPaths(world: World): RiverPathSegment[] {
  const cached = discoveredPathCache.get(world);
  if (cached?.version === world.version && cached.territoryVersion === world.territoryVersion) {
    return cached.segments;
  }
  const lines: {
    river: RiverFeature;
    points: { x: number; y: number }[];
    strength: 1 | 2 | 3;
    length: number;
    bounds: ReturnType<typeof pathBounds>;
  }[] = [];
  for (const river of world.riverFeatures) {
    if (river.discoveredBy.length === 0) continue;
    const strength = riverStrengthForRank(river.scaleRank);
    for (const path of river.paths) {
      if (path.length >= 2) {
        const points = unwrapPath(path);
        lines.push({ river, points, strength, length: pathLength(points), bounds: pathBounds(points) });
      }
    }
  }
  const segments: RiverPathSegment[] = [];
  for (const line of lines) {
    const strongerPaths = lines
      .filter((other) => {
        if (other.river.id === line.river.id) return false;
        const higherPriority = other.river.scaleRank < line.river.scaleRank ||
          (other.river.scaleRank === line.river.scaleRank &&
            (other.length > line.length || (other.length === line.length && other.river.id < line.river.id)));
        return higherPriority && pathsMayMeet(line.bounds, other.bounds, (line.strength + 3) / 2);
      })
      .flatMap((other) => {
        const unwrapped = other.points;
        return [-MAP_WIDTH, 0, MAP_WIDTH].map((offset) =>
          unwrapped.map((point) => ({ x: point.x + offset, y: point.y })));
      });
    const points = strongerPaths.length
      ? trimAtConfluence(line.points, strongerPaths, (line.strength + 3) / 2)
      : line.points;
    const wrapped = points.map((point) => ({
      x: ((point.x % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH,
      y: point.y,
    }));
    splitAtMapSeam(line.river, wrapped, line.strength, segments);
  }
  discoveredPathCache.set(world, {
    version: world.version,
    territoryVersion: world.territoryVersion,
    segments,
  });
  return segments;
}
