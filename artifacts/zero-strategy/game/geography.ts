import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, VALUE_STEP } from './config';
import { EARTH_DEG_PER_PX, EARTH_LAND_RLE, EARTH_TOP_LAT } from './data/earthLand';
import { fractalField, mulberry32, valueNoise } from './random';

export type MapKind = 'world' | 'random';

/** Fixed seed: the real-world map and its climate are the same on every launch. */
export const WORLD_SEED = 20261023;

export function latitudeOfRow(y: number): number {
  return EARTH_TOP_LAT - (y + 0.5) * EARTH_DEG_PER_PX;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Plain base64 decoder (works the same in Hermes, browsers and Node). */
function decodeBase64(text: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64.length; i += 1) lookup[BASE64.charCodeAt(i)] = i;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let count = 0;
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const v = lookup[text.charCodeAt(i)];
    if (v < 0) continue;
    bits = (bits << 6) | v;
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[n] = (bits >> count) & 255;
      n += 1;
    }
  }
  return out.subarray(0, n);
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

/** Fills sea temperatures when opening a save made before sea climate was persisted. */
export function fillOceanTemperature(land: Uint8Array, seed: number, temperature: Uint8Array): void {
  const noise = fractalField(MAP_WIDTH, MAP_HEIGHT, seed + 11, 9, 4);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const baseTemp = 96 - Math.abs(latitudeOfRow(y)) * 1.22;
    const row = y * MAP_WIDTH;
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const p = row + x;
      if (!land[p]) temperature[p] = quantize(baseTemp + (noise[p] - 0.5) * 16 - 8);
    }
  }
}

export interface Climate {
  humidity: Uint8Array;
  temperature: Uint8Array;
  drainage: Uint8Array;
}

/** River strength is deterministic map data: 1 = tributary, 2+ = major channel. */
export function generateRivers(land: Uint8Array, seed: number, mapKind: MapKind): Uint8Array {
  const rivers = new Uint8Array(MAP_PIXELS);
  if (mapKind === 'world') {
    const major: [string, [number, number][]][] = [
      ['Amazon', [[-74, -4], [-70, -4], [-66, -3], [-62, -3], [-58, -2], [-54, -1], [-50, -1], [-48, 0]]],
      ['Nile', [[30, 2], [32, 8], [31, 15], [32, 22], [32, 27], [31, 30]]],
      ['Congo', [[27, -10], [24, -7], [20, -5], [17, -4], [13, -5], [12, -6]]],
      ['Mississippi', [[46, 48], [43, 45], [40, 42], [37, 38], [35, 34], [31, 30], [29, 29]]],
      ['Paraná', [[-54, -20], [-56, -24], [-57, -28], [-56, -32], [-58, -35], [-58, -39]]],
      ['Danube', [[10, 48], [15, 48], [20, 46], [24, 45], [28, 45]]],
      ['Volga', [[38, 57], [43, 56], [47, 54], [49, 51], [48, 47]]],
      ['Yangtze', [[91, 33], [97, 31], [103, 30], [109, 30], [115, 30], [121, 31]]],
      ['Yellow River', [[96, 35], [101, 36], [106, 36], [111, 37], [116, 38], [119, 37]]],
      ['Ganges', [[79, 31], [83, 29], [87, 27], [91, 26], [95, 23], [90, 22]]],
      ['Indus', [[78, 32], [74, 30], [72, 27], [70, 24], [68, 23], [67, 24]]],
      ['Mekong', [[95, 33], [100, 28], [103, 23], [105, 18], [106, 13], [105, 10]]],
      ['Lena', [[127, 62], [124, 60], [123, 58], [126, 55], [128, 52], [130, 71]]],
      ['Yenisei', [[92, 52], [91, 55], [90, 59], [89, 63], [91, 69]]],
      ['Ob', [[85, 50], [82, 53], [77, 56], [73, 60], [72, 67]]],
      ['Amur', [[106, 50], [113, 50], [120, 49], [127, 48], [134, 48]]],
      ['Murray', [[146, -35], [143, -35], [140, -35], [138, -35]]],
    ];
    const toPixel = ([lon, lat]: [number, number]) => ({
      x: Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(((lon + 180) / 360) * (MAP_WIDTH - 1)))),
      y: Math.max(0, Math.min(MAP_HEIGHT - 1, Math.round((EARTH_TOP_LAT - lat) / EARTH_DEG_PER_PX))),
    });
    const landNear = (x: number, y: number): number => {
      let best = -1, bestD = Infinity;
      for (let r = 0; r <= 8; r += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const xx = Math.max(0, Math.min(MAP_WIDTH - 1, x + dx));
            const yy = Math.max(0, Math.min(MAP_HEIGHT - 1, y + dy));
            const p = yy * MAP_WIDTH + xx;
            const d = dx * dx + dy * dy;
            if (land[p] && d < bestD) { best = p; bestD = d; }
          }
        }
        if (best >= 0) break;
      }
      return best;
    };
    const markMajor = (p: number) => {
      if (p < 0) return;
      const cx = p % MAP_WIDTH, cy = Math.floor(p / MAP_WIDTH);
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        if (dx * dx + dy * dy > 5) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) continue;
        const q = y * MAP_WIDTH + x;
        if (land[q]) rivers[q] = 3;
      }
    };
    for (const [, path] of major) {
      for (let segment = 1; segment < path.length; segment += 1) {
        const a = toPixel(path[segment - 1]), b = toPixel(path[segment]);
        const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        for (let i = 0; i <= steps; i += 1) {
          const x = Math.round(a.x + ((b.x - a.x) * i) / Math.max(steps, 1));
          const y = Math.round(a.y + ((b.y - a.y) * i) / Math.max(steps, 1));
          const p = landNear(x, y);
          markMajor(p);
        }
      }
    }
    return rivers;
  }

  // On invented maps, carve plausible branching channels from uplands towards the nearest coast.
  const rng = mulberry32(seed ^ 0x6d2b79f5);
  const wideWrap = Math.max(1, Math.ceil(MAP_WIDTH / 150));
  const detailWrap = Math.max(1, Math.ceil(MAP_WIDTH / 48));
  const elevationAt = (x: number, y: number) =>
    valueNoise(x / 150, y / 150, seed + 701, wideWrap) * 0.7 +
    valueNoise(x / 48, y / 48, seed + 702, detailWrap) * 0.3;
  const sources: { p: number; height: number }[] = [];
  for (let i = 0; i < 7000; i += 1) {
    const p = Math.floor(rng() * MAP_PIXELS);
    if (!land[p]) continue;
    const height = elevationAt(p % MAP_WIDTH, Math.floor(p / MAP_WIDTH));
    if (height < 0.58) continue;
    if (sources.some((source) => source.p === p)) continue;
    if (sources.length < 28) sources.push({ p, height });
    else {
      let lowest = 0;
      for (let j = 1; j < sources.length; j += 1) if (sources[j].height < sources[lowest].height) lowest = j;
      if (height > sources[lowest].height) sources[lowest] = { p, height };
    }
  }
  sources.sort((a, b) => b.height - a.height);
  const seen = new Uint8Array(MAP_PIXELS);
  for (const [sourceIndex, source] of sources.entries()) {
    let p = source.p;
    const path: number[] = [];
    for (let step = 0; step < 360 && land[p] && !seen[p]; step += 1) {
      seen[p] = 1;
      path.push(p);
      const x = p % MAP_WIDTH, y = Math.floor(p / MAP_WIDTH);
      let next = -1, best = Infinity, touchesOcean = false;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= MAP_WIDTH || yy < 0 || yy >= MAP_HEIGHT) continue;
        const n = yy * MAP_WIDTH + xx;
        if (!land[n]) { touchesOcean = true; continue; }
        if (seen[n]) continue;
        const score = elevationAt(xx, yy) + rng() * 0.018;
        if (score < best) { best = score; next = n; }
      }
      if (touchesOcean || next < 0) break;
      p = next;
    }
    const level = sourceIndex < 4 ? 3 : sourceIndex < 12 ? 2 : 1;
    for (const riverPixel of path) {
      const x = riverPixel % MAP_WIDTH, y = Math.floor(riverPixel / MAP_WIDTH);
      const width = level >= 3 ? 1 : 0;
      for (let dy = -width; dy <= width; dy += 1) for (let dx = -width; dx <= width; dx += 1) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= MAP_WIDTH || yy < 0 || yy >= MAP_HEIGHT) continue;
        const q = yy * MAP_WIDTH + xx;
        if (land[q]) rivers[q] = Math.max(rivers[q], level);
      }
    }
    for (const riverPixel of path) seen[riverPixel] = 0;
  }
  return rivers;
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
      if (!land[p]) {
        temperature[p] = quantize(baseTemp + (tempNoise[p] - 0.5) * 16 - 8);
        continue;
      }
      const inland = Math.min(1, distance[p] / 160);
      temperature[p] = quantize(baseTemp + (tempNoise[p] - 0.5) * 22 - inland * 4);
      humidity[p] = quantize(baseWet * (1 - inland * 0.55 * tropical) + (wetNoise[p] - 0.5) * 40);
      drainage[p] = quantize(8 + drainNoise[p] * 92);
    }
  }
  return { humidity, temperature, drainage };
}
