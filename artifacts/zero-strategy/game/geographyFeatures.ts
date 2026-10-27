import { EARTH_ELEVATION_BASE64, EARTH_ELEVATION_COLUMNS, EARTH_ELEVATION_LAT_START, EARTH_ELEVATION_LON_START, EARTH_ELEVATION_ROWS, EARTH_ELEVATION_STEP } from './data/earthElevation';
import {
  EARTH_PEAKS_BASE64,
  EARTH_RIVERS_BASE64,
  EARTH_VOLCANOES_BASE64,
} from './data/earthGeography';
import { EARTH_VOLCANO_ACTIVITY_BASE64, EARTH_VOLCANO_ACTIVITY_COUNT } from './data/earthVolcanoActivity';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from './config';
import { generateRivers, type MapKind } from './geography';
import { riverStrengthForRank } from './geographyGeometry';

export interface GeographyFeature {
  id: number;
  pixel: number;
  elevation: number;
  name: string | null;
  discoveredBy: number[];
  active?: boolean;
  activityIntervalYears?: number;
  eruptionIntensity?: number;
}

export interface RiverFeature {
  id: number;
  scaleRank: number;
  paths: { x: number; y: number }[][];
  pixels: number[];
  name: string | null;
  discoveredBy: number[];
}

export interface GeneratedGeography {
  elevation: Int16Array;
  rivers: Uint8Array;
  riverFeatures: RiverFeature[];
  peaks: GeographyFeature[];
  volcanoes: GeographyFeature[];
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
  const output = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of clean) {
    buffer = (buffer << 6) | BASE64.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[index++] = (buffer >> bits) & 255;
    }
  }
  return output.subarray(0, index);
}

function readUnsigned(bytes: Uint8Array, cursor: { value: number }): number {
  let result = 0;
  let shift = 0;
  while (cursor.value < bytes.length) {
    const byte = bytes[cursor.value++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result >>> 0;
    shift += 7;
  }
  throw new Error('Повреждены встроенные данные географических объектов.');
}

function readSigned(bytes: Uint8Array, cursor: { value: number }): number {
  const value = readUnsigned(bytes, cursor);
  return (value & 1) === 0 ? value >>> 1 : -((value + 1) >>> 1);
}

function pointFeatureRows(encoded: string, isVolcano: boolean): GeographyFeature[] {
  const bytes = decodeBase64(encoded);
  const cursor = { value: 0 };
  const count = readUnsigned(bytes, cursor);
  const activityBytes = isVolcano ? decodeBase64(EARTH_VOLCANO_ACTIVITY_BASE64) : null;
  if (isVolcano && (count !== EARTH_VOLCANO_ACTIVITY_COUNT || activityBytes?.length !== count * 2)) {
    throw new Error('Повреждены встроенные данные активности вулканов.');
  }
  const result: GeographyFeature[] = [];
  let x = 0;
  let y = 0;
  for (let id = 0; id < count; id += 1) {
    x += readSigned(bytes, cursor);
    y += readSigned(bytes, cursor);
    const elevation = readUnsigned(bytes, cursor);
    const active = isVolcano ? readUnsigned(bytes, cursor) === 1 : undefined;
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) continue;
    result.push({
      id,
      pixel: y * MAP_WIDTH + x,
      elevation,
      name: null,
      discoveredBy: [],
      ...(active === undefined ? {} : { active }),
      ...(active === undefined || !activityBytes ? {} : {
        activityIntervalYears: activityBytes[id * 2],
        eruptionIntensity: activityBytes[id * 2 + 1],
      }),
    });
  }
  return result;
}

function earthRiverFeatures(): RiverFeature[] {
  const bytes = decodeBase64(EARTH_RIVERS_BASE64);
  const cursor = { value: 0 };
  const count = readUnsigned(bytes, cursor);
  const result: RiverFeature[] = [];
  for (let id = 0; id < count; id += 1) {
    const scaleRank = readUnsigned(bytes, cursor);
    const pathCount = readUnsigned(bytes, cursor);
    const paths: { x: number; y: number }[][] = [];
    const pixels = new Set<number>();
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const pointCount = readUnsigned(bytes, cursor);
      const path: { x: number; y: number }[] = [];
      let x = 0;
      let y = 0;
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        x += readSigned(bytes, cursor);
        y += readSigned(bytes, cursor);
        path.push({ x, y });
        const pixel = rasterizeRiverPoint(x, y);
        if (pixel !== null) pixels.add(pixel);
      }
      paths.push(path);
    }
    result.push({
      id,
      scaleRank,
      paths,
      pixels: [...pixels],
      name: null,
      discoveredBy: [],
    });
  }
  return result;
}

function rasterizeRiverPoint(x: number, y: number): number | null {
  const row = Math.round(y);
  if (row < 0 || row >= MAP_HEIGHT) return null;
  const column = ((Math.round(x) % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH;
  return row * MAP_WIDTH + column;
}

function rasterizeRiverPaths(features: RiverFeature[], land: Uint8Array): Uint8Array {
  const rivers = new Uint8Array(MAP_PIXELS);
  for (const feature of features) {
    const strength = riverStrengthForRank(feature.scaleRank);
    const pixels = new Set<number>();
    for (const path of feature.paths) {
      for (let point = 1; point < path.length; point += 1) {
        const first = path[point - 1];
        const second = path[point];
        let dx = second.x - first.x;
        if (dx > MAP_WIDTH / 2) dx -= MAP_WIDTH;
        if (dx < -MAP_WIDTH / 2) dx += MAP_WIDTH;
        const dy = second.y - first.y;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 1.5));
        for (let step = 0; step <= steps; step += 1) {
          const pixel = rasterizeRiverPoint(first.x + dx * step / steps, first.y + dy * step / steps);
          if (pixel !== null && land[pixel]) {
            rivers[pixel] = Math.max(rivers[pixel], strength);
            pixels.add(pixel);
          }
        }
      }
    }
    feature.pixels = [...pixels];
  }
  return rivers;
}

function decodeEarthElevation(): Int16Array {
  const bytes = decodeBase64(EARTH_ELEVATION_BASE64);
  const values = new Int16Array(EARTH_ELEVATION_ROWS * EARTH_ELEVATION_COLUMNS);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i += 1) values[i] = view.getInt16(i * 2, true);
  return values;
}

function earthElevationMap(): Int16Array {
  const source = decodeEarthElevation();
  const result = new Int16Array(MAP_PIXELS);
  const sample = (row: number, column: number) =>
    source[Math.max(0, Math.min(EARTH_ELEVATION_ROWS - 1, row)) * EARTH_ELEVATION_COLUMNS +
      ((column % EARTH_ELEVATION_COLUMNS) + EARTH_ELEVATION_COLUMNS) % EARTH_ELEVATION_COLUMNS];
  const latitudeStep = 180 / MAP_WIDTH;
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const latitude = 84 - (y + 0.5) * latitudeStep;
    const sourceY = (latitude - EARTH_ELEVATION_LAT_START) / EARTH_ELEVATION_STEP;
    const y0 = Math.floor(sourceY);
    const yf = sourceY - y0;
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const longitude = -180 + (x + 0.5) * 360 / MAP_WIDTH;
      const sourceX = (longitude - EARTH_ELEVATION_LON_START) / EARTH_ELEVATION_STEP;
      const x0 = Math.floor(sourceX);
      const xf = sourceX - x0;
      const top = sample(y0, x0) * (1 - xf) + sample(y0, x0 + 1) * xf;
      const bottom = sample(y0 + 1, x0) * (1 - xf) + sample(y0 + 1, x0 + 1) * xf;
      result[y * MAP_WIDTH + x] = Math.round(top * (1 - yf) + bottom * yf);
    }
  }
  return result;
}

function randomElevation(land: Uint8Array, seed: number): Int16Array {
  let state = (seed ^ 0x6d2b79f5) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const gridWidth = 65;
  const gridHeight = 27;
  const grid = Float32Array.from({ length: gridWidth * gridHeight }, random);
  const result = new Int16Array(MAP_PIXELS);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const gy = y / (MAP_HEIGHT - 1) * (gridHeight - 1);
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const gx = x / (MAP_WIDTH - 1) * (gridWidth - 1);
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const a = grid[y0 * gridWidth + x0] * (1 - fx) + grid[y0 * gridWidth + x0 + 1] * fx;
      const b = grid[(y0 + 1) * gridWidth + x0] * (1 - fx) + grid[(y0 + 1) * gridWidth + x0 + 1] * fx;
      const broad = a * (1 - fy) + b * fy;
      const detail = random();
      const value = Math.max(0, Math.min(1, broad * 0.72 + detail * 0.28));
      const pixel = y * MAP_WIDTH + x;
      result[pixel] = land[pixel]
        ? Math.round(120 + value ** 2.25 * 7800)
        : -Math.round(100 + value * 6800);
    }
  }
  return result;
}

function randomPointFeatures(elevation: Int16Array, land: Uint8Array, seed: number): {
  peaks: GeographyFeature[];
  volcanoes: GeographyFeature[];
} {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const candidates: GeographyFeature[] = [];
  for (let y = 1; y < MAP_HEIGHT - 1; y += 2) {
    for (let x = 1; x < MAP_WIDTH - 1; x += 2) {
      const pixel = y * MAP_WIDTH + x;
      const height = elevation[pixel];
      if (!land[pixel] || height < 700) continue;
      let maximum = true;
      for (let dy = -1; dy <= 1 && maximum; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (elevation[pixel + dy * MAP_WIDTH + dx] > height) {
            maximum = false;
            break;
          }
        }
      }
      if (maximum) candidates.push({ id: 0, pixel, elevation: height, name: null, discoveredBy: [] });
    }
  }
  candidates.sort((a, b) => b.elevation - a.elevation);
  const peaks: GeographyFeature[] = [];
  for (const candidate of candidates) {
    if (peaks.length >= 160) break;
    if (peaks.some((peak) => Math.abs(peak.pixel % MAP_WIDTH - candidate.pixel % MAP_WIDTH) < 18 &&
      Math.abs(Math.floor(peak.pixel / MAP_WIDTH) - Math.floor(candidate.pixel / MAP_WIDTH)) < 18)) continue;
    peaks.push({ ...candidate, id: peaks.length });
  }
  const volcanoes: GeographyFeature[] = [];
  const available = land.filter((value) => value > 0).length;
  const targets = Math.min(24, Math.max(6, Math.round(available / 7000)));
  const used = new Set<number>();
  for (let attempt = 0; attempt < targets * 30 && volcanoes.length < targets; attempt += 1) {
    const candidate = candidates[Math.floor(random() * candidates.length)];
    if (!candidate || candidate.elevation < 900 || used.has(candidate.pixel)) continue;
    used.add(candidate.pixel);
    const active = random() < 0.45;
    volcanoes.push({
      id: volcanoes.length,
      pixel: candidate.pixel,
      elevation: candidate.elevation,
      name: null,
      discoveredBy: [],
      active,
      ...(active ? {
        activityIntervalYears: Math.round(1 + random() * 120),
        eruptionIntensity: Math.max(1, Math.ceil(random() * 8)),
      } : {}),
    });
  }
  return { peaks, volcanoes };
}

function randomRiverFeatures(
  rivers: Uint8Array,
  tracedPaths: { pixels: number[]; scaleRank: number }[],
): RiverFeature[] {
  if (tracedPaths.length > 0) {
    return tracedPaths.map((flow, id) => {
      const pixels = [...new Set(flow.pixels)];
      return {
        id,
        scaleRank: flow.scaleRank,
        paths: [pixels.map((pixel) => ({ x: pixel % MAP_WIDTH, y: Math.floor(pixel / MAP_WIDTH) }))],
        pixels,
        name: null,
        discoveredBy: [],
      };
    });
  }
  const seen = new Uint8Array(MAP_PIXELS);
  const result: RiverFeature[] = [];
  const queue: number[] = [];
  for (let start = 0; start < MAP_PIXELS; start += 1) {
    if (rivers[start] === 0 || seen[start]) continue;
    const pixels: number[] = [];
    queue.length = 0;
    queue.push(start);
    seen[start] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const pixel = queue[head];
      pixels.push(pixel);
      const x = pixel % MAP_WIDTH;
      const y = Math.floor(pixel / MAP_WIDTH);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (ny < 0 || ny >= MAP_HEIGHT) continue;
          const next = ny * MAP_WIDTH + ((nx + MAP_WIDTH) % MAP_WIDTH);
          if (rivers[next] > 0 && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    result.push({
      id: result.length,
      scaleRank: pixels.reduce((best, pixel) => Math.max(best, rivers[pixel]), 1) >= 3 ? 1 : 5,
      paths: [],
      pixels,
      name: null,
      discoveredBy: [],
    });
  }
  return result;
}

export function generateGeography(land: Uint8Array, seed: number, mapKind: MapKind): GeneratedGeography {
  const elevation = mapKind === 'world' ? earthElevationMap() : randomElevation(land, seed);
  if (mapKind === 'world') {
    const riverFeatures = earthRiverFeatures();
    const rivers = rasterizeRiverPaths(riverFeatures, land);
    return {
      elevation,
      rivers,
      riverFeatures,
      peaks: pointFeatureRows(EARTH_PEAKS_BASE64, false),
      volcanoes: pointFeatureRows(EARTH_VOLCANOES_BASE64, true),
    };
  }
  const riverFlows: { pixels: number[]; scaleRank: number }[] = [];
  const rivers = generateRivers(land, seed, mapKind, riverFlows);
  const { peaks, volcanoes } = randomPointFeatures(elevation, land, seed);
  return { elevation, rivers, riverFeatures: randomRiverFeatures(rivers, riverFlows), peaks, volcanoes };
}
