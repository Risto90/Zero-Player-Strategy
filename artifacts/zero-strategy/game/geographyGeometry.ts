import { MAP_WIDTH } from './config';
import type { RiverFeature } from './geographyFeatures';
import type { World } from './world';

export interface RiverPathSegment {
  riverId: number;
  scaleRank: number;
  strength: 1 | 2 | 3;
  name: string | null;
  points: { x: number; y: number }[];
  path: string;
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
  return baseScale * (1 + (3 - Math.max(1, Math.min(3, strength))) * 0.2);
}

function asPath(points: { x: number; y: number }[]): string {
  return points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
  ).join(' ');
}

function pathLength(points: { x: number; y: number }[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
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
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  output.push({
    riverId: river.id,
    scaleRank: river.scaleRank,
    strength,
    name: river.name,
    points,
    path: asPath(points),
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
  const segments: RiverPathSegment[] = [];
  for (const river of world.riverFeatures) {
    if (river.discoveredBy.length === 0) continue;
    const strength = riverStrengthForRank(river.scaleRank);
    for (const points of river.paths) splitAtMapSeam(river, points, strength, segments);
  }
  discoveredPathCache.set(world, {
    version: world.version,
    territoryVersion: world.territoryVersion,
    segments,
  });
  return segments;
}
