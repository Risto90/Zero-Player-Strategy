import * as THREE from 'three';
import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config';
import type { Game } from '../../game/game';
import { discoveredRiverPaths, riverVisibilityScale } from '../../game/geographyGeometry';
import { seaDepthPackedColor } from '../../game/render';
import type { ViewTransform } from './types';

type World = Game['world'];
type ViewSize = { width: number; height: number; dpr: number };
type ScreenPoint = { x: number; y: number };

export const TERRAIN_GRID_COLUMNS = 512;
export const TERRAIN_GRID_ROWS = 256;
const HEIGHT_SCALE = 0.000012;
const RIVER_CARVE_BASE_METERS = 180;
const CAMERA_FOV = 42;
const LAND_COLOR = [174, 163, 135] as const;

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function packedChannels(packed: number): [number, number, number] {
  return [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255];
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

/**
 * Создаёт только визуальную сетку рельефа. Она не заменяет контурную модель карты
 * и не участвует в расчётах кистей, населения, границ или доступной для игры площади.
 */
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

function mapPosition(world: World, x: number, y: number, carveRiver = false): THREE.Vector3 {
  const elevation = sampleElevation(world, x, y) -
    (carveRiver ? riverCarveMeters(world, x, y) : 0);
  return new THREE.Vector3(
    (x / (MAP_WIDTH - 1)) * 2 - 1,
    elevation * HEIGHT_SCALE,
    (y / (MAP_HEIGHT - 1)) - 0.5,
  );
}

export function buildTerrainGeometry(world: World): THREE.BufferGeometry {
  const vertexCount = TERRAIN_GRID_COLUMNS * TERRAIN_GRID_ROWS;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array((TERRAIN_GRID_COLUMNS - 1) * (TERRAIN_GRID_ROWS - 1) * 6);
  let vertex = 0;

  for (let row = 0; row < TERRAIN_GRID_ROWS; row += 1) {
    const y = (row / (TERRAIN_GRID_ROWS - 1)) * (MAP_HEIGHT - 1);
    for (let column = 0; column < TERRAIN_GRID_COLUMNS; column += 1) {
      const x = (column / (TERRAIN_GRID_COLUMNS - 1)) * (MAP_WIDTH - 1);
      const pixelX = Math.min(MAP_WIDTH - 1, Math.round(x));
      const pixelY = Math.min(MAP_HEIGHT - 1, Math.round(y));
      const pixel = pixelY * MAP_WIDTH + pixelX;
      const elevation = sampleElevation(world, x, y);
      const isLand = world.land[pixel] !== 0;
      const carve = isLand ? riverCarveMeters(world, x, y) : 0;

      positions[vertex * 3] = (x / (MAP_WIDTH - 1)) * 2 - 1;
      positions[vertex * 3 + 1] = (elevation - carve) * HEIGHT_SCALE;
      positions[vertex * 3 + 2] = (y / (MAP_HEIGHT - 1)) - 0.5;

      const [red, green, blue] = isLand
        ? [...LAND_COLOR]
        : packedChannels(seaDepthPackedColor(Math.min(0, elevation)));
      colors[vertex * 3] = srgbToLinear(red);
      colors[vertex * 3 + 1] = srgbToLinear(green);
      colors[vertex * 3 + 2] = srgbToLinear(blue);
      vertex += 1;
    }
  }

  let index = 0;
  for (let row = 0; row < TERRAIN_GRID_ROWS - 1; row += 1) {
    for (let column = 0; column < TERRAIN_GRID_COLUMNS - 1; column += 1) {
      const a = row * TERRAIN_GRID_COLUMNS + column;
      const b = a + 1;
      const d = a + TERRAIN_GRID_COLUMNS;
      const c = d + 1;
      indices[index++] = a;
      indices[index++] = c;
      indices[index++] = b;
      indices[index++] = a;
      indices[index++] = d;
      indices[index++] = c;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export class Terrain3DRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.01, 100);
  private readonly raycaster = new THREE.Raycaster();
  private readonly riverGroup = new THREE.Group();
  private terrainMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;
  private world: World | null = null;
  private terrainVersion = -1;
  private riverVersion = -1;
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
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene.background = new THREE.Color('#87b0b2');
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
    if (this.world !== world || this.terrainVersion !== world.territoryVersion) {
      const geometry = buildTerrainGeometry(world);
      if (!this.terrainMesh) {
        const material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.94,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        this.terrainMesh = new THREE.Mesh(geometry, material);
        this.terrainMesh.frustumCulled = false;
        this.scene.add(this.terrainMesh);
      } else {
        this.terrainMesh.geometry.dispose();
        this.terrainMesh.geometry = geometry;
      }
      this.world = world;
      this.terrainVersion = world.territoryVersion;
      this.riverVersion = -1;
    }

    if (this.riverVersion !== world.version) {
      this.rebuildRivers(world);
      this.riverVersion = world.version;
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
      const contour = segment.contourPoints.slice();
      if (contour.length > 1) {
        const first = contour[0];
        const last = contour[contour.length - 1];
        if (first.x === last.x && first.y === last.y) contour.pop();
      }
      if (contour.length < 3) continue;

      const polygon = contour.map((point) => new THREE.Vector2(point.x, point.y));
      const triangles = THREE.ShapeUtils.triangulateShape(polygon, []);
      if (triangles.length === 0) continue;

      const positions = new Float32Array(contour.length * 3);
      contour.forEach((point, index) => {
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
    for (const river of this.riverGroup.children) {
      const strength = river.userData.riverStrength as number;
      river.visible = riverZoom >= riverVisibilityScale(baseScale, strength);
    }
    this.renderer.render(this.scene, this.camera);
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
    const horizontalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    let mapX = (x - view.ox) / view.scale;
    let mapY = (y - view.oy) / view.scale;
    let hitTerrain = false;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      horizontalPlane.constant = -horizontalPlane.normal.y * (
        this.world ? mapPosition(this.world, mapX, mapY, true).y : 0
      );
      if (!this.raycaster.ray.intersectPlane(horizontalPlane, intersection)) break;
      hitTerrain = true;
      mapX = THREE.MathUtils.clamp((intersection.x + 1) * 0.5 * (MAP_WIDTH - 1), 0, MAP_WIDTH - 1);
      mapY = THREE.MathUtils.clamp((intersection.z + 0.5) * (MAP_HEIGHT - 1), 0, MAP_HEIGHT - 1);
      if (!this.world) break;
    }
    if (hitTerrain) return { x: mapX, y: mapY };
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
    if (this.terrainMesh) this.scene.remove(this.terrainMesh);
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
