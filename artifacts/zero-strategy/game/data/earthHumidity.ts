import { gunzipSync } from 'fflate';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../config';
import raster from './earthHumidityRaster.json';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let decoded: Uint8Array | null = null;

function decodeBase64(text: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64.length; index += 1) {
    lookup[BASE64.charCodeAt(index)] = index;
  }
  const output = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let count = 0;
  let position = 0;
  for (let index = 0; index < text.length; index += 1) {
    const value = lookup[text.charCodeAt(index)];
    if (value < 0) continue;
    bits = (bits << 6) | value;
    count += 6;
    if (count >= 8) {
      count -= 8;
      output[position++] = (bits >> count) & 255;
    }
  }
  return output.subarray(0, position);
}

/** Возвращает климатическую карту относительной влажности суши и океана. */
export function earthMeanHumidityPercent(): Uint8Array {
  if (decoded) return decoded;
  if (raster.ширина !== MAP_WIDTH || raster.высота !== MAP_HEIGHT) {
    throw new Error('Карта влажности NASA не совпадает с размером карты мира.');
  }
  const values = gunzipSync(decodeBase64(raster.растр));
  if (values.byteLength !== MAP_PIXELS) {
    throw new Error('Карта влажности NASA имеет неверный размер.');
  }
  decoded = values;
  return decoded;
}
