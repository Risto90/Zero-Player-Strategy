import assert from 'node:assert/strict';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { earthMeanHumidityPercent } from '../game/data/earthHumidity.ts';
import { EARTH_DEG_PER_PX, EARTH_TOP_LAT } from '../game/data/earthLand.ts';
import { generateClimate } from '../game/geography.ts';

const values = earthMeanHumidityPercent();
assert.equal(values.length, MAP_PIXELS, 'растр влажности совпадает с размером карты');

let minimum = 101;
let maximum = -1;
for (const value of values) {
  minimum = Math.min(minimum, value);
  maximum = Math.max(maximum, value);
  assert.ok(value <= 100, 'относительная влажность не превышает 100%');
}
assert.ok(minimum >= 0 && maximum <= 100, 'значения влажности хранятся в процентах');

function humidityAt(longitude, latitude) {
  const x = Math.floor(((longitude + 180) / 360) * MAP_WIDTH);
  const y = Math.floor((EARTH_TOP_LAT - latitude) / EARTH_DEG_PER_PX);
  assert.ok(x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT, 'точка находится на игровой карте');
  return values[y * MAP_WIDTH + x];
}

assert.ok(humidityAt(20, 25) < 50, 'сухой пояс Сахары отражает низкую влажность');
assert.ok(humidityAt(-60, -3) > 65, 'влажный район Амазонии отражает высокую влажность');
assert.ok(humidityAt(140, 0) > 0, 'влажность Тихого океана не заменена нулём');
assert.ok(humidityAt(140, 0) !== humidityAt(140, -25), 'влажность океана меняется по климатическим зонам');
assert.notEqual(values[0], values[MAP_PIXELS - 1], 'замыкание долготы не создаёт нулевой полосы');

const oceanX = Math.floor(((-150 + 180) / 360) * MAP_WIDTH);
const oceanY = Math.floor((EARTH_TOP_LAT - 0) / EARTH_DEG_PER_PX);
const oceanPixel = oceanY * MAP_WIDTH + oceanX;
const generatedWorldClimate = generateClimate(new Uint8Array(MAP_PIXELS), 1729, 'world');
assert.equal(generatedWorldClimate.humidity[oceanPixel], values[oceanPixel],
  'генератор карты Земли подключает реальную влажность над океаном');
assert.equal(generatedWorldClimate.drainage[oceanPixel], 0,
  'дренажное поле остаётся неизменённым на морском дне');

console.log('Глобальная карта NASA POWER хранит относительную влажность над сушей и океаном.');
