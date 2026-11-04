import * as THREE from 'three';
import { contours } from 'd3-contour';
import { difference, intersection, type MultiPolygon } from 'polygon-clipping';
import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config';
import type { Game } from '../../game/game';
import { discoveredRiverPaths, riverVisibilityScale } from '../../game/geographyGeometry';
import { ELEVATION_COLOR_STOPS, seaDepthPackedColor } from '../../game/render';
import type { ViewTransform } from './types';

type World = Game['world'];
type ViewSize = { width: number; height: number; dpr: number };
type ScreenPoint = { x: number; y: number };

export function terrainDataNeedsRebuild(
  world: Pick<World, 'terrainRevision'>,
  installedWorld: object | null,
  installedRevision: number,
): boolean {
  return world !== installedWorld || world.terrainRevision !== installedRevision;
}

export const TERRAIN_CONTOUR_COLUMNS = 512;
export const TERRAIN_CONTOUR_ROWS = 256;
export const SEA_DEPTH_TEXTURE_WIDTH = 1024;
export const SEA_DEPTH_TEXTURE_HEIGHT = 512;
const HEIGHT_SCALE = 0.00003;
const HEIGHT_CONTOUR_STEP_METERS = 250;
const MAX_TERRAIN_TRIANGLE_EDGE = 0.03;
const MAX_TERRAIN_SUBDIVISION_DEPTH = 6;
const RIVER_CARVE_BASE_METERS = 180;
const CAMERA_FOV = 42;
const LAND_SURFACE_OFFSET = 0.00015;
const MIN_ELEVATION_TEXTURE_HEIGHT = 0;
const MAX_ELEVATION_TEXTURE_HEIGHT = ELEVATION_COLOR_STOPS[ELEVATION_COLOR_STOPS.length - 1][0];
export const ELEVATION_TEXTURE_WIDTH = 512;

function packedChannels(packed: number): [number, number, number] {
  return [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255];
}

type ContourGeometry = {
  value: number;
  coordinates: number[][][][];
};

const surfaceMaskCache = new WeakMap<object, { revision: number; polygons: MultiPolygon }>();

function exactTerrainSurface(world: World): MultiPolygon {
  const revision = world.terrainRevision ?? 0;
  const cached = surfaceMaskCache.get(world);
  if (cached?.revision === revision) return cached.polygons;
  const mask = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const raisedLakeBed = !world.land[pixel] &&
      world.elevation[pixel] > 0 && (world.depth?.[pixel] ?? 0) > 0;
    mask[pixel] = world.land[pixel] || raisedLakeBed ? 1 : 0;
  }
  const outline = contours()
    .size([MAP_WIDTH, MAP_HEIGHT])
    .thresholds([0.5])(mask as unknown as number[])[0]?.coordinates as MultiPolygon | undefined;
  const polygons = outline ?? [];
  surfaceMaskCache.set(world, { revision, polygons });
  return polygons;
}

function isTerrainSurfacePixel(world: World, pixel: number): boolean {
  return world.land[pixel] === 1 ||
    (world.elevation[pixel] > 0 && (world.depth?.[pixel] ?? 0) > 0);
}

function sampleElevation(world: World, x: number, y: number): number {
  const mapX = Math.max(0, Math.min(MAP_WIDTH - 1, x));
  const mapY = Math.max(0, Math.min(MAP_HEIGHT - 1, y));
  const x0 = Math.floor(mapX);
  const y0 = Math.floor(mapY);
  const x1 = Math.min(MAP_WIDTH - 1, x0 + 1);
  const y1 = Math.min(MAP_HEIGHT - 1, y0 + 1);
  const tx = mapX - x0;
  const ty = mapY - y0;
  const top = world.elevation[y0 * MAP_WIDTH + x0] * (1 - tx) +
    world.elevation[y0 * MAP_WIDTH + x1] * tx;
  const bottom = world.elevation[y1 * MAP_WIDTH + x0] * (1 - tx) +
    world.elevation[y1 * MAP_WIDTH + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function sampleSurfaceElevation(world: World, x: number, y: number): number {
  const mapX = Math.max(0, Math.min(MAP_WIDTH - 1, x));
  const mapY = Math.max(0, Math.min(MAP_HEIGHT - 1, y));
  const x0 = Math.floor(mapX);
  const y0 = Math.floor(mapY);
  const x1 = Math.min(MAP_WIDTH - 1, x0 + 1);
  const y1 = Math.min(MAP_HEIGHT - 1, y0 + 1);
  const tx = mapX - x0;
  const ty = mapY - y0;
  const samples = [
    [y0 * MAP_WIDTH + x0, (1 - tx) * (1 - ty)],
    [y0 * MAP_WIDTH + x1, tx * (1 - ty)],
    [y1 * MAP_WIDTH + x0, (1 - tx) * ty],
    [y1 * MAP_WIDTH + x1, tx * ty],
  ] as const;
  let elevation = 0;
  let weight = 0;
  for (const [pixel, sampleWeight] of samples) {
    if (sampleWeight <= 0 || !isTerrainSurfacePixel(world, pixel)) continue;
    elevation += world.elevation[pixel] * sampleWeight;
    weight += sampleWeight;
  }
  return weight > 0 ? elevation / weight : sampleElevation(world, x, y);
}

function riverCarveMeters(world: World, x: number, y: number): number {
  let strongest = 0;
  let bestWeight = 0;
  for (let dy = -4; dy <= 4; dy += 2) {
    const py = Math.round(y + dy);
    if (py < 0 || py >= MAP_HEIGHT) continue;
    for (let dx = -4; dx <= 4; dx += 2) {
      const px = (Math.round(x + dx) + MAP_WIDTH) % MAP_WIDTH;
      const strength = world.knownRivers[py * MAP_WIDTH + px];
      if (strength === 0) continue;
      const weight = Math.max(0, 1 - Math.hypot(dx, dy) / 6);
      if (weight > bestWeight) {
        bestWeight = weight;
        strongest = strength;
      }
    }
  }
  if (bestWeight === 0) return 0;
  return (RIVER_CARVE_BASE_METERS + strongest * 55) * bestWeight;
}

function terrainElevation(world: World, x: number, y: number): number {
  const elevation = sampleSurfaceElevation(world, x, y);
  if (elevation < 0) return elevation;
  return Math.max(0, elevation - riverCarveMeters(world, x, y));
}

function terrainHeight(world: World, x: number, y: number): number {
  const elevation = terrainElevation(world, x, y);
  return elevation < 0
    ? elevation * HEIGHT_SCALE
    : elevation * HEIGHT_SCALE + LAND_SURFACE_OFFSET;
}

function mapPosition(world: World, x: number, y: number, carveRiver = false): THREE.Vector3 {
  const elevation = carveRiver ? terrainHeight(world, x, y) : sampleSurfaceElevation(world, x, y);
  const height = carveRiver
    ? elevation
    : elevation < 0
      ? elevation * HEIGHT_SCALE
      : elevation * HEIGHT_SCALE + LAND_SURFACE_OFFSET;
  return new THREE.Vector3(
    (x / (MAP_WIDTH - 1)) * 2 - 1,
    height,
    (y / (MAP_HEIGHT - 1)) - 0.5,
  );
}

/**
 * Контуры задают полосы высот суши; адаптивно дробятся только длинные грани,
 * а не каждый пиксель. Эта геометрия служит только 3D-отрисовке.
 */
export function buildTerrainGeometry(world: World): THREE.BufferGeometry {
  const sampledHeights = new Array<number>(TERRAIN_CONTOUR_COLUMNS * TERRAIN_CONTOUR_ROWS);
  let minimumHeight = 0;
  let maximumHeight = 0;
  const surfaceHeights = new Float64Array(TERRAIN_CONTOUR_COLUMNS * TERRAIN_CONTOUR_ROWS);
  const surfaceMask = new Uint8Array(surfaceHeights.length);
  for (let row = 0; row < TERRAIN_CONTOUR_ROWS; row += 1) {
    const mapY = Math.round(row / (TERRAIN_CONTOUR_ROWS - 1) * (MAP_HEIGHT - 1));
    for (let column = 0; column < TERRAIN_CONTOUR_COLUMNS; column += 1) {
      const mapX = Math.round(column / (TERRAIN_CONTOUR_COLUMNS - 1) * (MAP_WIDTH - 1));
      const pixel = mapY * MAP_WIDTH + mapX;
      const onSurface = isTerrainSurfacePixel(world, pixel);
      const value = onSurface ? terrainElevation(world, mapX, mapY) : 0;
      const index = row * TERRAIN_CONTOUR_COLUMNS + column;
      surfaceHeights[index] = value;
      surfaceMask[index] = onSurface ? 1 : 0;
      if (onSurface) {
        minimumHeight = Math.min(minimumHeight, value);
        maximumHeight = Math.max(maximumHeight, value);
      }
    }
  }

  const firstLevel = Math.floor(minimumHeight / HEIGHT_CONTOUR_STEP_METERS) * HEIGHT_CONTOUR_STEP_METERS;
  const seaSentinel = firstLevel - HEIGHT_CONTOUR_STEP_METERS;
  const levels: number[] = [];
  for (let elevation = firstLevel; elevation <= maximumHeight; elevation += HEIGHT_CONTOUR_STEP_METERS) {
    levels.push(elevation);
  }
  if (levels[levels.length - 1] < maximumHeight) levels.push(maximumHeight);
  for (let index = 0; index < sampledHeights.length; index += 1) {
    sampledHeights[index] = surfaceMask[index] ? surfaceHeights[index] : seaSentinel;
  }
  const heightContours = contours()
    .size([TERRAIN_CONTOUR_COLUMNS, TERRAIN_CONTOUR_ROWS])
    .thresholds(levels)(sampledHeights) as ContourGeometry[];
  const terrainSurface = exactTerrainSurface(world);
  const positions: number[] = [];
  const elevationUvs: number[] = [];
  const indices: number[] = [];
  const vertexIndices = new Map<string, number>();

  const mapPoint = (point: number[]): THREE.Vector2 => new THREE.Vector2(
    (point[0] / (MAP_WIDTH - 1)) * 2 - 1,
    (point[1] / (MAP_HEIGHT - 1)) - 0.5,
  );
  const normalizedRing = (ring: number[][]): THREE.Vector2[] => {
    const points = ring.map(mapPoint);
    if (points.length > 1 && points[0].distanceToSquared(points[points.length - 1]) < 1e-10) {
      points.pop();
    }
    return points;
  };
  const addVertex = (point: THREE.Vector2): number => {
    const mapX = ((point.x + 1) / 2) * (MAP_WIDTH - 1);
    const mapY = (point.y + 0.5) * (MAP_HEIGHT - 1);
    const height = terrainHeight(world, mapX, mapY);
    const key = `${Math.round(point.x * 1e6)}:${Math.round(point.y * 1e6)}:${Math.round(height * 1e6)}`;
    const existing = vertexIndices.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(point.x, height, point.y);
    elevationUvs.push(THREE.MathUtils.clamp(mapX / (MAP_WIDTH - 1), 0, 1),
      THREE.MathUtils.clamp(1 - mapY / (MAP_HEIGHT - 1), 0, 1));
    vertexIndices.set(key, index);
    return index;
  };
  const addTriangle = (
    a: THREE.Vector2,
    b: THREE.Vector2,
    c: THREE.Vector2,
    depth = 0,
    subdivide = true,
  ): void => {
    const abLength = a.distanceToSquared(b);
    const bcLength = b.distanceToSquared(c);
    const caLength = c.distanceToSquared(a);
    if (
      subdivide &&
      depth < MAX_TERRAIN_SUBDIVISION_DEPTH &&
      Math.max(abLength, bcLength, caLength) > MAX_TERRAIN_TRIANGLE_EDGE ** 2
    ) {
      const ab = a.clone().add(b).multiplyScalar(0.5);
      const bc = b.clone().add(c).multiplyScalar(0.5);
      const ca = c.clone().add(a).multiplyScalar(0.5);
      addTriangle(a, ab, ca, depth + 1, subdivide);
      addTriangle(ab, b, bc, depth + 1, subdivide);
      addTriangle(ca, bc, c, depth + 1, subdivide);
      addTriangle(ab, bc, ca, depth + 1, subdivide);
      return;
    }
    indices.push(addVertex(a), addVertex(b), addVertex(c));
  };

  for (let contourIndex = 0; contourIndex < heightContours.length; contourIndex += 1) {
    const heightContour = heightContours[contourIndex];
    const nextContour = heightContours[contourIndex + 1];
    const coarseIsoband = nextContour
      ? difference(
        heightContour.coordinates as MultiPolygon,
        nextContour.coordinates as MultiPolygon,
      )
      : heightContour.coordinates;
    const mapIsoband = coarseIsoband.map((polygon) => polygon.map((ring) =>
      ring.map(([x, y]) => [
        x / (TERRAIN_CONTOUR_COLUMNS - 1) * (MAP_WIDTH - 1),
        y / (TERRAIN_CONTOUR_ROWS - 1) * (MAP_HEIGHT - 1),
      ]),
    )) as MultiPolygon;
    const isoband = terrainSurface.length > 0
      ? intersection(mapIsoband, terrainSurface)
      : [];
    const coastCorrection = contourIndex === 0 && terrainSurface.length > 0
      ? difference(terrainSurface, mapIsoband)
      : [];

    for (const polygon of [...isoband, ...coastCorrection]) {
      const rings = polygon.map(normalizedRing).filter((ring) => ring.length >= 3);
      const [outer, ...holes] = rings;
      if (!outer) continue;

      const triangles = THREE.ShapeUtils.triangulateShape(outer, holes);
      const polygonPoints = [outer, ...holes].flat();
      for (const triangle of triangles) {
        addTriangle(
          polygonPoints[triangle[0]],
          polygonPoints[triangle[1]],
          polygonPoints[triangle[2]],
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(elevationUvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function hexChannels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function elevationColorAt(elevation: number): [number, number, number] {
  const bounded = THREE.MathUtils.clamp(
    elevation,
    MIN_ELEVATION_TEXTURE_HEIGHT,
    MAX_ELEVATION_TEXTURE_HEIGHT,
  );
  let upper = 1;
  while (upper < ELEVATION_COLOR_STOPS.length - 1 && bounded > ELEVATION_COLOR_STOPS[upper][0]) {
    upper += 1;
  }
  const [lowerHeight, lowerHex] = ELEVATION_COLOR_STOPS[upper - 1];
  const [upperHeight, upperHex] = ELEVATION_COLOR_STOPS[upper];
  const lower = hexChannels(lowerHex);
  const higher = hexChannels(upperHex);
  const fraction = (bounded - lowerHeight) / (upperHeight - lowerHeight);
  return lower.map((channel, index) => Math.round(channel + (higher[index] - channel) * fraction)) as
    [number, number, number];
}

/** Цветовая текстура сохраняет прежнюю гипсометрическую шкалу карты. */
export function buildElevationColorTexture(): THREE.DataTexture {
  const data = new Uint8Array(ELEVATION_TEXTURE_WIDTH * 4);
  for (let column = 0; column < ELEVATION_TEXTURE_WIDTH; column += 1) {
    const elevation = MIN_ELEVATION_TEXTURE_HEIGHT +
      column / (ELEVATION_TEXTURE_WIDTH - 1) *
      (MAX_ELEVATION_TEXTURE_HEIGHT - MIN_ELEVATION_TEXTURE_HEIGHT);
    const [red, green, blue] = elevationColorAt(elevation);
    const offset = column * 4;
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, ELEVATION_TEXTURE_WIDTH, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Текстура хранит высоту и независимую глубину, включая водоёмы над уровнем моря. */
export function buildTerrainColorTexture(world: World): THREE.DataTexture {
  const data = new Uint8Array(SEA_DEPTH_TEXTURE_WIDTH * SEA_DEPTH_TEXTURE_HEIGHT * 4);
  for (let row = 0; row < SEA_DEPTH_TEXTURE_HEIGHT; row += 1) {
    const mapY = Math.round(row / (SEA_DEPTH_TEXTURE_HEIGHT - 1) * (MAP_HEIGHT - 1));
    const textureRow = SEA_DEPTH_TEXTURE_HEIGHT - 1 - row;
    for (let column = 0; column < SEA_DEPTH_TEXTURE_WIDTH; column += 1) {
      const mapX = Math.round(column / (SEA_DEPTH_TEXTURE_WIDTH - 1) * (MAP_WIDTH - 1));
      const pixel = mapY * MAP_WIDTH + mapX;
      const depth = world.depth?.[pixel] ?? Math.max(0, -world.elevation[pixel]);
      const channels = depth > 0
        ? packedChannels(seaDepthPackedColor(-depth))
        : elevationColorAt(world.elevation[pixel]);
      const offset = (textureRow * SEA_DEPTH_TEXTURE_WIDTH + column) * 4;
      data[offset] = channels[0];
      data[offset + 1] = channels[1];
      data[offset + 2] = channels[2];
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(
    data,
    SEA_DEPTH_TEXTURE_WIDTH,
    SEA_DEPTH_TEXTURE_HEIGHT,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Создаёт плоскую текстуру глубин моря под контурной 3D-сушей. */
export function buildSeaDepthTexture(world: World): THREE.DataTexture {
  const data = new Uint8Array(SEA_DEPTH_TEXTURE_WIDTH * SEA_DEPTH_TEXTURE_HEIGHT * 4);
  for (let row = 0; row < SEA_DEPTH_TEXTURE_HEIGHT; row += 1) {
    const mapY = Math.round(row / (SEA_DEPTH_TEXTURE_HEIGHT - 1) * (MAP_HEIGHT - 1));
    const textureRow = SEA_DEPTH_TEXTURE_HEIGHT - 1 - row;
    for (let column = 0; column < SEA_DEPTH_TEXTURE_WIDTH; column += 1) {
      const mapX = Math.round(column / (SEA_DEPTH_TEXTURE_WIDTH - 1) * (MAP_WIDTH - 1));
      const pixel = mapY * MAP_WIDTH + mapX;
      const offset = (textureRow * SEA_DEPTH_TEXTURE_WIDTH + column) * 4;
      const depth = world.depth?.[pixel] ?? Math.max(0, -world.elevation[pixel]);
      const [red, green, blue] = packedChannels(seaDepthPackedColor(-depth));
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = !world.land[pixel] && world.elevation[pixel] <= 0 && depth > 0 ? 255 : 0;
    }
  }
  const texture = new THREE.DataTexture(
    data,
    SEA_DEPTH_TEXTURE_WIDTH,
    SEA_DEPTH_TEXTURE_HEIGHT,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export class Terrain3DRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.01, 100);
  private readonly raycaster = new THREE.Raycaster();
  private readonly riverGroup = new THREE.Group();
  private terrainMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;
  private seaMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private terrainColorTexture: THREE.DataTexture | null = null;
  private world: World | null = null;
  private terrainDataRevision = -1;
  private riverGeographyVersion = -1;
  private lastRenderWorld: World | null = null;
  private lastRenderKey = '';
  private width = 1;
  private height = 1;
  private yaw = 0;
  private pitch = 0.82;
  private target = new THREE.Vector3();
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene.background = null;
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.25));

    const sunlight = new THREE.DirectionalLight(0xfff5df, 2.2);
    sunlight.position.set(-2.5, 4.5, 3.5);
    this.scene.add(sunlight);
    const fillLight = new THREE.DirectionalLight(0xc9e2ed, 0.7);
    fillLight.position.set(3, 2, -4);
    this.scene.add(fillLight);
    this.scene.add(this.riverGroup);
  }

  private installWorld(world: World): void {
    const changedWorld = this.world !== world;
    if (terrainDataNeedsRebuild(world, this.world, this.terrainDataRevision)) {
      const seaTexture = buildSeaDepthTexture(world);
      if (!this.seaMesh) {
        const geometry = new THREE.PlaneGeometry(2, 1);
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({
          map: seaTexture,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        this.seaMesh = new THREE.Mesh(geometry, material);
        this.seaMesh.renderOrder = 0;
        this.seaMesh.frustumCulled = false;
        this.scene.add(this.seaMesh);
      } else {
        this.seaMesh.material.map?.dispose();
        this.seaMesh.material.map = seaTexture;
        this.seaMesh.material.needsUpdate = true;
      }

      const geometry = buildTerrainGeometry(world);
      const colorTexture = buildTerrainColorTexture(world);
      if (!this.terrainMesh) {
        const material = new THREE.MeshStandardMaterial({
          color: '#ffffff',
          map: colorTexture,
          vertexColors: false,
          roughness: 0.94,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        this.terrainMesh = new THREE.Mesh(geometry, material);
        this.terrainMesh.frustumCulled = false;
        this.terrainMesh.renderOrder = 1;
        this.scene.add(this.terrainMesh);
      } else {
        this.terrainMesh.geometry.dispose();
        this.terrainMesh.geometry = geometry;
        this.terrainMesh.material.map?.dispose();
        this.terrainMesh.material.map = colorTexture;
        this.terrainMesh.material.needsUpdate = true;
      }
      this.world = world;
      this.terrainColorTexture = colorTexture;
      this.terrainDataRevision = world.terrainRevision;
    }

    if (changedWorld) this.riverGeographyVersion = -1;
    if (this.riverGeographyVersion !== world.geographyRevision) {
      this.rebuildRivers(world);
      this.riverGeographyVersion = world.geographyRevision;
    }
  }

  private rebuildRivers(world: World): void {
    const oldMaterials = new Set<THREE.Material>();
    for (const child of [...this.riverGroup.children]) {
      this.riverGroup.remove(child);
      const river = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      river.geometry.dispose();
      oldMaterials.add(river.material);
    }
    for (const material of oldMaterials) material.dispose();

    const materials: Record<number, THREE.MeshStandardMaterial> = {
      1: new THREE.MeshStandardMaterial({
        color: '#76aab5',
        roughness: 0.42,
        metalness: 0.05,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      2: new THREE.MeshStandardMaterial({
        color: '#4c8fa5',
        roughness: 0.38,
        metalness: 0.04,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      3: new THREE.MeshStandardMaterial({
        color: '#2d6e8d',
        roughness: 0.34,
        metalness: 0.03,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    };

    for (const segment of discoveredRiverPaths(world)) {
      for (const polygonRings of segment.contourPolygons) {
        const rings = polygonRings.map((ring) => {
          const contour = ring.slice();
          if (contour.length > 1) {
            const first = contour[0];
            const last = contour[contour.length - 1];
            if (first.x === last.x && first.y === last.y) contour.pop();
          }
          return contour;
        }).filter((ring) => ring.length >= 3);
        const outer = rings[0];
        if (!outer) continue;
        const contour = outer.map((point) => new THREE.Vector2(point.x, point.y));
        const holes = rings.slice(1).map((ring) =>
          ring.map((point) => new THREE.Vector2(point.x, point.y)),
        );
        const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
        if (triangles.length === 0) continue;

        const vertices = rings.flat();
        const positions = new Float32Array(vertices.length * 3);
        vertices.forEach((point, index) => {
          const position = mapPosition(world, point.x, point.y, true);
          positions[index * 3] = position.x;
          positions[index * 3 + 1] = position.y + 0.0015;
          positions[index * 3 + 2] = position.z;
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(triangles.flat());
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, materials[segment.strength]);
        mesh.userData.riverStrength = segment.strength;
        mesh.renderOrder = 2;
        this.riverGroup.add(mesh);
      }
    }

    if (this.riverGroup.children.length === 0) {
      for (const material of Object.values(materials)) material.dispose();
    }
  }

  private updateCamera(view: ViewTransform, size: ViewSize): void {
    const centerMapX = (size.width / 2 - view.ox) / view.scale;
    const centerMapY = (size.height / 2 - view.oy) / view.scale;
    this.target.set(
      (centerMapX / (MAP_WIDTH - 1)) * 2 - 1,
      0,
      (centerMapY / (MAP_HEIGHT - 1)) - 0.5,
    );

    this.camera.aspect = Math.max(0.01, size.width / size.height);
    this.camera.updateProjectionMatrix();
    const focalPixels = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)));
    const distance = Math.max(
      0.18,
      focalPixels * 2 / (MAP_WIDTH * Math.max(view.scale, 0.0001)),
    );
    const horizontal = Math.cos(this.pitch) * distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  render(world: World, view: ViewTransform, size: ViewSize, baseScale: number): void {
    if (this.disposed) return;
    this.installWorld(world);
    if (this.width !== size.width || this.height !== size.height ||
      this.renderer.getPixelRatio() !== size.dpr) {
      this.width = size.width;
      this.height = size.height;
      this.renderer.setPixelRatio(size.dpr);
      this.renderer.setSize(size.width, size.height, false);
    }
    this.updateCamera(view, size);
    const riverZoom = view.scale;
    const renderKey = [
      view.ox, view.oy, view.scale, size.width, size.height, size.dpr, baseScale,
      this.yaw, this.pitch, world.terrainRevision, world.geographyRevision,
    ].join('/');
    if (this.lastRenderWorld === world && this.lastRenderKey === renderKey) return;
    for (const river of this.riverGroup.children) {
      const strength = river.userData.riverStrength as number;
      river.visible = riverZoom >= riverVisibilityScale(baseScale, strength);
    }
    this.renderer.render(this.scene, this.camera);
    this.lastRenderWorld = world;
    this.lastRenderKey = renderKey;
  }

  orbit(deltaX: number, deltaY: number): void {
    this.yaw -= deltaX * 0.006;
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaY * 0.006, 0.16, 1.48);
  }

  projectMapPoint(
    x: number,
    y: number,
    size: Pick<ViewSize, 'width' | 'height'>,
    world: World,
  ): ScreenPoint | null {
    const point = mapPosition(world, x, y, true).project(this.camera);
    if (point.z < -1 || point.z > 1 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    return {
      x: (point.x * 0.5 + 0.5) * size.width,
      y: (-point.y * 0.5 + 0.5) * size.height,
    };
  }

  mapPointAt(
    x: number,
    y: number,
    view: ViewTransform,
    size: ViewSize,
    world: World,
  ): ScreenPoint {
    this.updateCamera(view, size);
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / size.width) * 2 - 1, 1 - (y / size.height) * 2),
      this.camera,
    );
    this.scene.updateMatrixWorld(true);
    const surfaces: THREE.Object3D[] = [];
    if (this.terrainMesh) surfaces.push(this.terrainMesh);
    if (this.seaMesh) surfaces.push(this.seaMesh);
    const hit = this.raycaster.intersectObjects(surfaces, false)[0];
    if (hit) {
      return {
        x: THREE.MathUtils.clamp((hit.point.x + 1) * 0.5 * (MAP_WIDTH - 1), 0, MAP_WIDTH - 1),
        y: THREE.MathUtils.clamp((hit.point.z + 0.5) * (MAP_HEIGHT - 1), 0, MAP_HEIGHT - 1),
      };
    }
    return {
      x: (x - view.ox) / view.scale,
      y: (y - view.oy) / view.scale,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terrainMesh?.geometry.dispose();
    this.terrainMesh?.material.dispose();
    this.terrainColorTexture?.dispose();
    this.terrainColorTexture = null;
    if (this.terrainMesh) this.scene.remove(this.terrainMesh);
    if (this.seaMesh) {
      this.seaMesh.material.map?.dispose();
      this.seaMesh.material.dispose();
      this.seaMesh.geometry.dispose();
      this.scene.remove(this.seaMesh);
    }
    this.scene.remove(this.riverGroup);
    const materials = new Set<THREE.Material>();
    for (const child of [...this.riverGroup.children]) {
      this.riverGroup.remove(child);
      const river = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      river.geometry.dispose();
      materials.add(river.material);
    }
    for (const material of materials) material.dispose();
    this.renderer.dispose();
  }
}
