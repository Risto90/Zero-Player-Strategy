import {
  parseSvgPath,
  pathIntersections,
  pointInRing,
  type GeometryPath,
  type PathCommand,
  type Point2,
} from '../kernel/geometry';
import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { ContourArea } from './contours';
import { untrimmedRiverPaths } from './geographyGeometry';
import type { Country, GeographyNameTarget, World } from './world';

interface XYBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface RiverContour {
  polygons: Point2[][][];
  path: GeometryPath;
  bounds: XYBounds;
}

const riverContourCache = new WeakMap<object, RiverContour>();

function pathFromContourRings(rings: readonly Int32Array[]): GeometryPath {
  const commands: PathCommand[] = [];
  for (const ring of rings) {
    const pointCount = Math.floor(ring.length / 2);
    if (pointCount < 3) continue;
    commands.push({ type: 'move', point: { x: ring[0], y: ring[1] } });
    for (let index = 1; index < pointCount; index += 1) {
      commands.push({
        type: 'line',
        point: { x: ring[index * 2], y: ring[index * 2 + 1] },
      });
    }
    commands.push({ type: 'close' });
  }
  return commands;
}

function countryTerritory(world: World, country: Country): ContourArea {
  if (country.type === 'nomadic') return ContourArea.pixels(country.range ?? []);
  if (country.pixels === 0) return new ContourArea();
  return world.contours.layer('owner').select(
    (owner) => owner === country.id + 1,
    {
      x0: country.box[0],
      y0: country.box[1],
      x1: country.box[2],
      y1: country.box[3],
    },
    `geography-naming:${country.id}`,
  );
}

function pointsFromRings(rings: readonly Int32Array[]): Point2[][] {
  return rings.map((ring) => Array.from(
    { length: Math.floor(ring.length / 2) },
    (_, index) => ({ x: ring[index * 2], y: ring[index * 2 + 1] }),
  ));
}

function pointInsideContour(point: Point2, rings: readonly (readonly Point2[])[]): boolean {
  let inside = false;
  for (const boundary of rings) {
    if (pointInRing(point, boundary)) inside = !inside;
  }
  return inside;
}

function pointInsideMultiPolygon(point: Point2, polygons: readonly (readonly (readonly Point2[])[])[]): boolean {
  return polygons.some((polygon) => {
    let inside = false;
    for (const boundary of polygon) {
      if (pointInRing(point, boundary)) inside = !inside;
    }
    return inside;
  });
}

function boundsOfRings(rings: readonly (readonly Point2[])[]): XYBounds | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      x0 = Math.min(x0, point.x);
      y0 = Math.min(y0, point.y);
      x1 = Math.max(x1, point.x);
      y1 = Math.max(y1, point.y);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

function boundsOverlap(first: XYBounds, second: XYBounds): boolean {
  return second.x1 >= first.x0 &&
    second.x0 <= first.x1 + 1 &&
    second.y1 >= first.y0 &&
    second.y0 <= first.y1 + 1;
}

function boundsContain(outer: XYBounds, inner: XYBounds): boolean {
  return outer.x0 <= inner.x0 && outer.y0 <= inner.y0 &&
    outer.x1 >= inner.x1 && outer.y1 >= inner.y1;
}

function riverContour(segment: ReturnType<typeof untrimmedRiverPaths>[number]): RiverContour | null {
  const cached = riverContourCache.get(segment);
  if (cached) return cached;
  const polygons = segment.contourPolygons;
  const rings = polygons.flatMap((polygon) => polygon);
  const bounds = boundsOfRings(rings);
  if (!bounds) return null;
  const contour = {
    polygons,
    path: parseSvgPath(segment.contourPath),
    bounds,
  };
  riverContourCache.set(segment, contour);
  return contour;
}

function riverIntersectsTerritory(
  territoryPath: GeometryPath,
  territoryRings: readonly (readonly Point2[])[],
  territoryBounds: XYBounds,
  segment: ReturnType<typeof untrimmedRiverPaths>[number],
): boolean {
  const contour = riverContour(segment);
  if (!contour || !boundsOverlap(territoryBounds, contour.bounds)) return false;

  if (pathIntersections(
    territoryPath,
    contour.path,
    0.25,
  ).length > 0) return true;

  const riverPoint = segment.points[Math.floor(segment.points.length / 2)];
  if (riverPoint && pointInsideContour(riverPoint, territoryRings)) return true;

  return territoryRings.some((ring) => {
    if (!ring.length) return false;
    const ringBounds = boundsOfRings([ring]);
    return Boolean(ringBounds && boundsContain(contour.bounds, ringBounds) &&
      pointInsideMultiPolygon(ring[0], contour.polygons));
  });
}

export function nameableGeographyForCountry(
  world: World,
  country: Country,
): GeographyNameTarget[] {
  const area = countryTerritory(world, country);
  if (area.size === 0) return [];
  const bounds = area.bounds;
  const rings = area.rings();
  const territoryRings = pointsFromRings(rings);
  const territoryPath = pathFromContourRings(rings);
  if (!territoryRings.length) return [];
  const territoryBounds: XYBounds = bounds;

  const result: GeographyNameTarget[] = [];
  const geographyPointIsInside = (pixel: number): boolean => {
    if (!Number.isInteger(pixel) || pixel < 0 || pixel >= MAP_WIDTH * MAP_HEIGHT) {
      return false;
    }
    const point = {
      x: pixel % MAP_WIDTH + 0.5,
      y: Math.floor(pixel / MAP_WIDTH) + 0.5,
    };
    if (point.x < bounds.x0 || point.x > bounds.x1 + 1 ||
      point.y < bounds.y0 || point.y > bounds.y1 + 1) {
      return false;
    }
    return pointInsideContour(point, territoryRings);
  };

  const namedRivers = new Set<number>();
  for (const segment of untrimmedRiverPaths(world)) {
    const river = world.riverFeatures[segment.riverId];
    if (!river || river.name || namedRivers.has(river.id)) continue;
    if (!riverIntersectsTerritory(territoryPath, territoryRings, territoryBounds, segment)) continue;
    namedRivers.add(river.id);
    result.push({
      kind: 'river',
      id: river.id,
      pixel: river.pixels[Math.floor(river.pixels.length / 2)] ?? -1,
      elevation: 0,
    });
  }

  for (const feature of world.peaks) {
    if (!feature.name && geographyPointIsInside(feature.pixel)) {
      result.push({
        kind: 'peak',
        id: feature.id,
        pixel: feature.pixel,
        elevation: feature.elevation,
      });
    }
  }
  for (const feature of world.volcanoes) {
    if (!feature.name && geographyPointIsInside(feature.pixel)) {
      result.push({
        kind: 'volcano',
        id: feature.id,
        pixel: feature.pixel,
        elevation: feature.elevation,
        active: feature.active,
      });
    }
  }
  return result;
}
