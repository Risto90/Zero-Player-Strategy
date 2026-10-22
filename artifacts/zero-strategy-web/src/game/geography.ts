import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, VALUE_STEP } from './config';
import { EARTH_DEG_PER_PX, EARTH_LAND_RLE, EARTH_TOP_LAT } from './data/earthLand';
import { fractalField, mulberry32 } from './random';

export type MapKind = 'world' | 'random';

/** Fixed seed: the real-world map and its climate are the same on every launch. */
export const WORLD_SEED = 20261023;

export function latitudeOfRow(y: number): number {
  return EARTH_TOP_LAT - (y + 0.5) * EARTH_DEG_PER_PX;
}

function decodeBase64(text: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/** Natural Earth coastlines, rasterized at build time (see scripts/build-earth.mjs). */
export function decodeEarthLand(): Uint8Array {
  const bytes = decodeBase64(EARTH_LAND_RLE);
  const land = new Uint8Array(MAP_PIXELS);
  let pos = 0;
  let value = 0;
  let i = 0;
  while (i < bytes.length && pos < MAP_PIXELS) {
    let run = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = bytes[i];
      i += 1;
      run |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    if (value === 1) land.fill(1, pos, pos + run);
    pos += run;
    value ^= 1;
  }
  return land;
}

/** Fractal continents for a "new world"; the seed is stored with the game. */
export function makeRandomLand(seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const field = fractalField(MAP_WIDTH, MAP_HEIGHT, seed, 5, 6);
  const centres = Array.from({ length: 5 + Math.floor(rng() * 3) }, () => ({
    x: 0.08 + rng() * 0.84,
    y: 0.2 + rng() * 0.6,
    r: 0.12 + rng() * 0.16,
  }));
  const land = new Uint8Array(MAP_PIXELS);
  const score = new Float32Array(MAP_PIXELS);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const ny = y / MAP_HEIGHT;
    const edge = Math.min(1, ny / 0.08, (1 - ny) / 0.08);
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const nx = x / MAP_WIDTH;
      let bump = 0;
      for (const c of centres) {
        const dx = (nx - c.x) * 2.4;
        const dy = ny - c.y;
        const d = Math.sqrt(dx * dx + dy * dy) / c.r;
        bump = Math.max(bump, 1 - d);
      }
      const i = y * MAP_WIDTH + x;
      score[i] = (field[i] * 0.9 + bump * 0.55) * edge;
    }
  }
  // Pick the threshold that turns ~30% of the map into land.
  const sample = Array.from({ length: 4000 }, () => score[Math.floor(rng() * MAP_PIXELS)]).sort((a, b) => b - a);
  const threshold = sample[Math.floor(sample.length * 0.3)];
  for (let i = 0; i < MAP_PIXELS; i += 1) land[i] = score[i] >= threshold ? 1 : 0;
  return land;
}

export interface WaterInfo {
  /** Water body id per pixel, -1 on land. */
  bodyOf: Int32Array;
  bodyCount: number;
  /** Coastal land pixels touching each body. */
  coastsOf: Int32Array[];
}

/** Labels connected seas (the map wraps east–west for water), and lists their coastal land pixels. */
export function labelWater(land: Uint8Array): WaterInfo {
  const bodyOf = new Int32Array(MAP_PIXELS).fill(-1);
  const stack = new Int32Array(MAP_PIXELS);
  let bodyCount = 0;
  for (let start = 0; start < MAP_PIXELS; start += 1) {
    if (land[start] || bodyOf[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    bodyOf[start] = bodyCount;
    while (top > 0) {
      const p = stack[--top];
      const x = p % MAP_WIDTH;
      const y = (p - x) / MAP_WIDTH;
      const left = x > 0 ? p - 1 : p + MAP_WIDTH - 1;
      const right = x < MAP_WIDTH - 1 ? p + 1 : p - MAP_WIDTH + 1;
      const neighbours = [left, right, y > 0 ? p - MAP_WIDTH : -1, y < MAP_HEIGHT - 1 ? p + MAP_WIDTH : -1];
      for (const n of neighbours) {
        if (n < 0 || land[n] || bodyOf[n] !== -1) continue;
        bodyOf[n] = bodyCount;
        stack[top++] = n;
      }
    }
    bodyCount += 1;
  }
  const lists: number[][] = Array.from({ length: bodyCount }, () => []);
  for (let p = 0; p < MAP_PIXELS; p += 1) {
    if (!land[p]) continue;
    const seen: number[] = [];
    forEachNeighbour(p, (n) => {
      const body = bodyOf[n];
      if (body >= 0 && !seen.includes(body)) {
        seen.push(body);
        lists[body].push(p);
      }
    });
  }
  return { bodyOf, bodyCount, coastsOf: lists.map((list) => Int32Array.from(list)) };
}

export function forEachNeighbour(p: number, visit: (n: number) => void): void {
  const x = p % MAP_WIDTH;
  if (x > 0) visit(p - 1);
  if (x < MAP_WIDTH - 1) visit(p + 1);
  if (p >= MAP_WIDTH) visit(p - MAP_WIDTH);
  if (p < MAP_PIXELS - MAP_WIDTH) visit(p + MAP_WIDTH);
}

/** Land distance (pixels, capped) to the nearest sea. */
function coastDistance(land: Uint8Array): Uint16Array {
  const dist = new Uint16Array(MAP_PIXELS).fill(65535);
  const queue = new Int32Array(MAP_PIXELS);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < MAP_PIXELS; p += 1) {
    if (!land[p]) {
      dist[p] = 0;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const next = dist[p] + 1;
    if (next > 400) continue;
    forEachNeighbour(p, (n) => {
      if (dist[n] > next) {
        dist[n] = next;
        queue[tail++] = n;
      }
    });
  }
  return dist;
}

function interpolate(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

/** Humidity by latitude: wet equator, dry subtropics, wet temperate belt, dry poles. */
const HUMIDITY_BY_LAT: [number, number][] = [
  [0, 82],
  [12, 62],
  [24, 18],
  [34, 38],
  [50, 64],
  [65, 46],
  [85, 26],
];

export function quantize(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value / VALUE_STEP) * VALUE_STEP));
}

export interface Climate {
  humidity: Uint8Array;
  temperature: Uint8Array;
  drainage: Uint8Array;
}

/** Deterministic climate for a seed: temperature by latitude, humidity by latitude and distance to sea. */
export function generateClimate(land: Uint8Array, seed: number): Climate {
  const humidity = new Uint8Array(MAP_PIXELS);
  const temperature = new Uint8Array(MAP_PIXELS);
  const drainage = new Uint8Array(MAP_PIXELS);
  const tempNoise = fractalField(MAP_WIDTH, MAP_HEIGHT, seed + 11, 9, 4);
  const wetNoise = fractalField(MAP_WIDTH, MAP_HEIGHT, seed + 23, 12, 5);
  const drainNoise = fractalField(MAP_WIDTH, MAP_HEIGHT, seed + 37, 18, 5);
  const distance = coastDistance(land);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const lat = Math.abs(latitudeOfRow(y));
    const baseTemp = 96 - lat * 1.22;
    const baseWet = interpolate(HUMIDITY_BY_LAT, lat);
    const tropical = lat < 14 ? 0.3 : 1;
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const p = y * MAP_WIDTH + x;
      if (!land[p]) continue;
      const inland = Math.min(1, distance[p] / 160);
      temperature[p] = quantize(baseTemp + (tempNoise[p] - 0.5) * 22 - inland * 4);
      humidity[p] = quantize(baseWet * (1 - inland * 0.55 * tropical) + (wetNoise[p] - 0.5) * 40);
      drainage[p] = quantize(8 + drainNoise[p] * 92);
    }
  }
  return { humidity, temperature, drainage };
}
