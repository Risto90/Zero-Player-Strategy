import { MAP_HEIGHT, MAP_WIDTH } from './config';
import type { World } from './world';

export interface TerrainReliefPath {
  color: string;
  path: string;
}

const GRID_STEP = 8;
const HEIGHT_EXAGGERATION = 0.004;
const RIVER_BED_DEPTH_METERS = 250;
const MATERIAL: readonly [number, number, number] = [183, 172, 145];
const SHADE_COUNT = 24;
const LIGHT = normalize3(-0.45, -0.58, 0.68);
const modelCache = new WeakMap<World, TerrainReliefPath[]>();

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function shadeColor(index: number): string {
  const light = 0.68 + (index / (SHADE_COUNT - 1)) * 0.42;
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * light))).toString(16).padStart(2, '0');
  return `#${channel(MATERIAL[0])}${channel(MATERIAL[1])}${channel(MATERIAL[2])}`;
}

function smoothedElevationAt(world: World, x: number, y: number): number {
  let total = 0;
  let count = 0;
  for (const offsetY of [-GRID_STEP, 0, GRID_STEP]) {
    const sampleY = Math.max(0, Math.min(MAP_HEIGHT - 1, y + offsetY));
    for (const offsetX of [-GRID_STEP, 0, GRID_STEP]) {
      const sampleX = Math.max(0, Math.min(MAP_WIDTH - 1, x + offsetX));
      const pixel = sampleY * MAP_WIDTH + sampleX;
      if (!world.land[pixel]) continue;
      total += world.elevation[pixel];
      count += 1;
    }
  }
  const center = Math.max(0, Math.min(MAP_HEIGHT - 1, y)) * MAP_WIDTH +
    Math.max(0, Math.min(MAP_WIDTH - 1, x));
  return count ? total / count : world.elevation[center] ?? 0;
}

function pathPoint(x: number, y: number, height: number): string {
  return `${x.toFixed(1)} ${(y - Math.max(0, height) * HEIGHT_EXAGGERATION).toFixed(1)}`;
}

function triangleShade(a: [number, number, number], b: [number, number, number], c: [number, number, number]): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = normalize3(
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  );
  const illumination = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
  return Math.max(0, Math.min(SHADE_COUNT - 1, Math.round(illumination * (SHADE_COUNT - 1))));
}

/** Высота смещает точку вверх по экрану в проекции рельефа и на слое высот. */
export function terrainProjectedY(world: World, pixel: number, mapY = Math.floor(pixel / MAP_WIDTH)): number {
  const x = pixel % MAP_WIDTH;
  const y = Math.floor(pixel / MAP_WIDTH);
  return mapY - Math.max(0, smoothedElevationAt(world, x, y)) * HEIGHT_EXAGGERATION;
}

/** Русло немного ниже соседней поверхности; правило влияет только на визуальную проекцию. */
export function terrainRiverbedY(world: World, pixel: number, mapY = Math.floor(pixel / MAP_WIDTH)): number {
  return terrainProjectedY(world, pixel, mapY) + RIVER_BED_DEPTH_METERS * HEIGHT_EXAGGERATION;
}

/** Выбирает контрастный цвет подписи по затенению рельефа под её координатой. */
export function terrainTextColor(world: World, pixel: number): string {
  const x = pixel % MAP_WIDTH;
  const y = Math.floor(pixel / MAP_WIDTH);
  const west = smoothedElevationAt(world, Math.max(0, x - GRID_STEP), y);
  const east = smoothedElevationAt(world, Math.min(MAP_WIDTH - 1, x + GRID_STEP), y);
  const north = smoothedElevationAt(world, x, Math.max(0, y - GRID_STEP));
  const south = smoothedElevationAt(world, x, Math.min(MAP_HEIGHT - 1, y + GRID_STEP));
  const normal = normalize3(
    -((east - west) * HEIGHT_EXAGGERATION) / (GRID_STEP * 2),
    -((south - north) * HEIGHT_EXAGGERATION) / (GRID_STEP * 2),
    1,
  );
  const illumination = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
  const brightness = 0.48 + illumination * 0.7;
  const materialLuminance = (0.2126 * MATERIAL[0] + 0.7152 * MATERIAL[1] + 0.0722 * MATERIAL[2]) / 255;
  return materialLuminance * brightness > 0.45 ? '#28231e' : '#fff7df';
}

/**
 * Строит единую разреженную треугольную модель высот. Это только визуальный слой:
 * кисти, ИИ, контуры и правила владения продолжают работать с прежней геометрией.
 */
export function terrainReliefPaths(world: World): TerrainReliefPath[] {
  const cached = modelCache.get(world);
  if (cached) return cached;

  const faces = Array.from({ length: SHADE_COUNT }, () => [] as string[]);
  const xCoordinates = Array.from({ length: Math.ceil((MAP_WIDTH - 1) / GRID_STEP) + 1 }, (_, index) =>
    Math.min(MAP_WIDTH - 1, index * GRID_STEP));
  const yCoordinates = Array.from({ length: Math.ceil((MAP_HEIGHT - 1) / GRID_STEP) + 1 }, (_, index) =>
    Math.min(MAP_HEIGHT - 1, index * GRID_STEP));
  const heights = yCoordinates.map((y) => xCoordinates.map((x) => smoothedElevationAt(world, x, y)));

  for (let row = 0; row < yCoordinates.length - 1; row += 1) {
    const y0 = yCoordinates[row], y1 = yCoordinates[row + 1];
    for (let column = 0; column < xCoordinates.length - 1; column += 1) {
      const x0 = xCoordinates[column], x1 = xCoordinates[column + 1];
      const pixels = [
        y0 * MAP_WIDTH + x0,
        y0 * MAP_WIDTH + x1,
        y1 * MAP_WIDTH + x1,
        y1 * MAP_WIDTH + x0,
      ];
      const points: [number, number, number][] = pixels.map((pixel, index) => [
        index === 0 || index === 3 ? x0 : x1,
        index < 2 ? y0 : y1,
        index === 0 ? heights[row][column] :
          index === 1 ? heights[row][column + 1] :
            index === 2 ? heights[row + 1][column + 1] : heights[row + 1][column],
      ]);
      const triangles = [[0, 1, 2], [0, 2, 3]] as const;
      for (const [ia, ib, ic] of triangles) {
        const pa = pixels[ia], pb = pixels[ib], pc = pixels[ic];
        if (!world.land[pa] || !world.land[pb] || !world.land[pc]) continue;
        const shade = triangleShade(points[ia], points[ib], points[ic]);
        faces[shade].push(
          `M ${pathPoint(points[ia][0], points[ia][1], points[ia][2])}` +
          ` L ${pathPoint(points[ib][0], points[ib][1], points[ib][2])}` +
          ` L ${pathPoint(points[ic][0], points[ic][1], points[ic][2])} Z`,
        );
      }
    }
  }

  const result = faces
    .map((paths, index) => ({ color: shadeColor(index), path: paths.join(' ') }))
    .filter((entry) => entry.path.length > 0);
  modelCache.set(world, result);
  return result;
}

export function terrainProjectedRiverPath(
  world: World,
  points: readonly { x: number; y: number }[],
  close = false,
): string {
  if (!points.length) return '';
  const path = points.map((point, index) => {
    const x = Math.max(0, Math.min(MAP_WIDTH - 1, Math.floor(point.x)));
    const y = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.floor(point.y)));
    const pixel = y * MAP_WIDTH + x;
    const projectedY = terrainRiverbedY(world, pixel, point.y);
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${projectedY.toFixed(2)}`;
  }).join(' ');
  return close ? `${path} Z` : path;
}
