// Собирает среднюю температуру суши и поверхности океана в сетку карты игры.
// Требует curl, unzip и GDAL; сжатый растр записывается в game/data/earthTemperature.ts.
import { execFileSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIDTH = 2048;
const HEIGHT = 832;
const TOP_LAT = 84;
const DEG_PER_PIXEL = 360 / WIDTH;
const BOTTOM_LAT = TOP_LAT - HEIGHT * DEG_PER_PIXEL;
const DATA_DIR = path.resolve(import.meta.dirname, '../game/data');
const LAND_FILE = path.join(DATA_DIR, 'earthLand.ts');
const OUTPUT_FILE = path.join(DATA_DIR, 'earthTemperature.ts');
const WORLDCLIM_URL = 'https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_bio.zip';
const WOA_URL = 'https://www.ncei.noaa.gov/data/oceans/woa/WOA23/DATA/temperature/csv/decav71A0/1.00/woa23_decav71A0_t00an01.csv.gz';

function decodeLandMask() {
  const source = readFileSync(LAND_FILE, 'utf8');
  const encoded = source.match(/EARTH_LAND_RLE = '([^']+)'/)?.[1];
  if (!encoded) throw new Error('Не найден сжатый контур суши в earthLand.ts.');
  const bytes = Buffer.from(encoded, 'base64');
  const land = new Uint8Array(WIDTH * HEIGHT);
  let cursor = 0;
  let pixel = 0;
  let value = 0;
  while (cursor < bytes.length && pixel < land.length) {
    let count = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[cursor++];
      count |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    if (value) land.fill(1, pixel, pixel + count);
    pixel += count;
    value ^= 1;
  }
  if (pixel !== land.length) throw new Error('Размер маски суши не совпадает с сеткой карты.');
  return land;
}

function parseOceanGrid(gzipPath) {
  const csv = gunzipSync(readFileSync(gzipPath)).toString('utf8');
  const grid = new Float32Array(360 * 180).fill(Number.NaN);
  let valid = 0;
  for (const line of csv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const fields = line.split(',');
    const latitude = Number(fields[0]);
    const longitude = Number(fields[1]);
    const surfaceTemperature = Number(fields[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      !Number.isFinite(surfaceTemperature) || surfaceTemperature < -5 || surfaceTemperature > 40) continue;
    const row = Math.round(latitude + 89.5);
    const column = (Math.round(longitude + 179.5) + 360) % 360;
    if (row < 0 || row >= 180) continue;
    grid[row * 360 + column] = surfaceTemperature;
    valid += 1;
  }
  if (!valid) throw new Error('В данных NOAA не найдено ни одной температуры поверхности океана.');
  return grid;
}

function sampleOcean(grid, longitude, latitude) {
  const x = ((longitude + 179.5) % 360 + 360) % 360;
  const y = Math.max(0, Math.min(179, latitude + 89.5));
  const x0 = Math.floor(x), x1 = (x0 + 1) % 360;
  const y0 = Math.floor(y), y1 = Math.min(179, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const candidates = [
    [y0, x0, (1 - fx) * (1 - fy)],
    [y0, x1, fx * (1 - fy)],
    [y1, x0, (1 - fx) * fy],
    [y1, x1, fx * fy],
  ];
  let totalWeight = 0;
  let weightedTemperature = 0;
  for (const [row, column, weight] of candidates) {
    const temperature = grid[row * 360 + column];
    if (!Number.isFinite(temperature) || weight <= 0) continue;
    totalWeight += weight;
    weightedTemperature += temperature * weight;
  }
  if (totalWeight > 0) return weightedTemperature / totalWeight;

  for (let radius = 1; radius <= 8; radius += 1) {
    let nearest = Number.NaN;
    let nearestDistance = Infinity;
    const centerX = Math.round(x), centerY = Math.round(y);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const row = Math.max(0, Math.min(179, centerY + dy));
        const column = (centerX + dx + 360) % 360;
        const temperature = grid[row * 360 + column];
        const distance = dx * dx + dy * dy;
        if (Number.isFinite(temperature) && distance < nearestDistance) {
          nearest = temperature;
          nearestDistance = distance;
        }
      }
    }
    if (Number.isFinite(nearest)) return nearest;
  }
  return null;
}

function findNearbyLandTemperature(raster, land, pixel) {
  const x = pixel % WIDTH;
  const y = Math.floor(pixel / WIDTH);
  for (let radius = 1; radius <= 12; radius += 1) {
    let nearest = Number.NaN;
    let nearestDistance = Infinity;
    for (let dy = -radius; dy <= radius; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= HEIGHT) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= WIDTH) continue;
        const candidate = yy * WIDTH + xx;
        if (!land[candidate]) continue;
        const temperature = raster.readFloatLE(candidate * 4);
        if (!Number.isFinite(temperature) || temperature < -100 || temperature > 60) continue;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearest = temperature;
          nearestDistance = distance;
        }
      }
    }
    if (Number.isFinite(nearest)) return nearest;
  }
  return Number.NaN;
}

function decodeLandTemperatureRaster(rasterPath) {
  const raster = readFileSync(rasterPath);
  if (raster.length !== WIDTH * HEIGHT * 4) {
    throw new Error('GDAL создал растр суши неверного размера.');
  }
  return raster;
}

function base64Chunks(value) {
  return value.match(/.{1,100000}/g)?.join("' +\n  '") ?? '';
}

async function main() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'zero-earth-temperature-'));
  try {
    const worldclimZip = path.join(tempDir, 'worldclim-bio.zip');
    const oceanGzip = path.join(tempDir, 'woa23-ocean.csv.gz');
    const worldclimTiff = path.join(tempDir, 'worldclim-bio1.tif');
    const warpedTiff = path.join(tempDir, 'worldclim-map.tif');
    const warpedRaster = path.join(tempDir, 'worldclim-map.bin');
    execFileSync('curl', ['-fL', '--retry', '2', '-o', worldclimZip, WORLDCLIM_URL], { stdio: 'inherit' });
    execFileSync('curl', ['-fL', '--retry', '2', '-o', oceanGzip, WOA_URL], { stdio: 'inherit' });
    const bio1 = execFileSync('unzip', ['-p', worldclimZip, 'wc2.1_10m_bio_1.tif'], {
      maxBuffer: 20 * 1024 * 1024,
    });
    writeFileSync(worldclimTiff, bio1);
    execFileSync('gdalwarp', [
      '-q', '-overwrite', '-r', 'bilinear', '-te',
      '-180', String(BOTTOM_LAT), '180', String(TOP_LAT),
      '-ts', String(WIDTH), String(HEIGHT),
      '-dstnodata', '-9999', '-ot', 'Float32',
      worldclimTiff, warpedTiff,
    ], { stdio: 'inherit' });
    execFileSync('gdal_translate', [
      '-q', '-of', 'ENVI', '-ot', 'Float32', warpedTiff, warpedRaster,
    ], { stdio: 'inherit' });

    const land = decodeLandMask();
    const landRaster = decodeLandTemperatureRaster(warpedRaster);
    const oceanGrid = parseOceanGrid(oceanGzip);
    const values = Buffer.alloc(WIDTH * HEIGHT * 2);
    let landFallbacks = 0;
    let iceCoveredOceanFallbacks = 0;
    for (let y = 0; y < HEIGHT; y += 1) {
      const latitude = TOP_LAT - (y + 0.5) * DEG_PER_PIXEL;
      for (let x = 0; x < WIDTH; x += 1) {
        const pixel = y * WIDTH + x;
        const longitude = -180 + (x + 0.5) * DEG_PER_PIXEL;
        let temperature;
        if (land[pixel]) {
          temperature = landRaster.readFloatLE(pixel * 4);
          if (!Number.isFinite(temperature) || temperature < -100 || temperature > 60) {
            temperature = findNearbyLandTemperature(landRaster, land, pixel);
            if (!Number.isFinite(temperature)) {
              // Мелкие острова, не попавшие в 10-минутную сетку WorldClim,
              // получают местную норму поверхности океана NOAA.
              temperature = sampleOcean(oceanGrid, longitude, latitude);
            }
            landFallbacks += 1;
          }
        } else {
          temperature = sampleOcean(oceanGrid, longitude, latitude);
          if (temperature === null) {
            // WOA23 не содержит измерений в части постоянного морского льда;
            // солёная вода под таким льдом находится около точки замерзания.
            temperature = -1.8;
            iceCoveredOceanFallbacks += 1;
          }
        }
        if (!Number.isFinite(temperature)) {
          throw new Error(`Для точки ${pixel} нет среднего значения температуры.`);
        }
        values.writeInt16LE(Math.round(temperature * 10), pixel * 2);
      }
    }

    const compressed = gzipSync(values, { level: 9, mtime: 0 });
    const base64 = compressed.toString('base64');
    const generated = `// Сетка средней температуры суши и океана; источник и нормы описаны рядом.\n` +
      `import { gunzipSync } from 'fflate';\n` +
      `import { MAP_PIXELS } from '../config';\n\n` +
      `const TEMPERATURE_GRID_GZIP =\n  '${base64Chunks(base64)}';\n` +
      `const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';\n` +
      `let decoded: Int16Array | null = null;\n\n` +
      `function decodeBase64(text: string): Uint8Array {\n` +
      `  const lookup = new Int16Array(128).fill(-1);\n` +
      `  for (let index = 0; index < BASE64.length; index += 1) lookup[BASE64.charCodeAt(index)] = index;\n` +
      `  const output = new Uint8Array(Math.floor((text.length * 3) / 4));\n` +
      `  let bits = 0, count = 0, position = 0;\n` +
      `  for (let index = 0; index < text.length; index += 1) {\n` +
      `    const value = lookup[text.charCodeAt(index)];\n` +
      `    if (value < 0) continue;\n` +
      `    bits = (bits << 6) | value; count += 6;\n` +
      `    if (count >= 8) { count -= 8; output[position++] = (bits >> count) & 255; }\n` +
      `  }\n` +
      `  return output.subarray(0, position);\n` +
      `}\n\n` +
      `export function earthMeanTemperatureDeciC(): Int16Array {\n` +
      `  if (decoded) return decoded;\n` +
      `  const bytes = gunzipSync(decodeBase64(TEMPERATURE_GRID_GZIP));\n` +
      `  if (bytes.byteLength !== MAP_PIXELS * 2) throw new Error('Сетка температуры имеет неверный размер.');\n` +
      `  const values = new Int16Array(MAP_PIXELS);\n` +
      `  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);\n` +
      `  for (let pixel = 0; pixel < MAP_PIXELS; pixel += 1) values[pixel] = view.getInt16(pixel * 2, true);\n` +
      `  decoded = values;\n` +
      `  return values;\n` +
      `}\n\n` +
      `export function fillEarthMeanTemperature(target: Float32Array): void {\n` +
      `  if (target.length !== MAP_PIXELS) throw new RangeError('Размер растра температуры не совпадает с картой.');\n` +
      `  const values = earthMeanTemperatureDeciC();\n` +
      `  for (let pixel = 0; pixel < MAP_PIXELS; pixel += 1) target[pixel] = values[pixel] / 10;\n` +
      `}\n`;
    writeFileSync(OUTPUT_FILE, generated);
    console.log(`Сформирована сетка ${WIDTH}×${HEIGHT}; подстановка суши: ${landFallbacks}; морской лёд без наблюдений: ${iceCoveredOceanFallbacks}; сжатый растр: ${compressed.length} байт.`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
