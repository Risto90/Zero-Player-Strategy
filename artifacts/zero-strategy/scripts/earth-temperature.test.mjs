import assert from 'node:assert/strict';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { earthMeanTemperatureDeciC } from '../game/data/earthTemperature.ts';

const values = earthMeanTemperatureDeciC();
assert.equal(values.length, MAP_PIXELS, 'климатический растр совпадает с размером карты');

let minimum = Infinity;
let maximum = -Infinity;
for (const value of values) {
  const celsius = value / 10;
  minimum = Math.min(minimum, celsius);
  maximum = Math.max(maximum, celsius);
  assert.ok(celsius >= -60 && celsius <= 40, 'значения температуры остаются в правдоподобном диапазоне °C');
}
assert.ok(minimum < -20, 'в карте сохранён настоящий полярный холод');
assert.ok(maximum > 25, 'в карте сохранена настоящая тропическая жара');

function temperatureAt(longitude, latitude) {
  const x = Math.floor(((longitude + 180) / 360) * MAP_WIDTH);
  const y = Math.floor((84 - latitude) / (360 / MAP_WIDTH));
  assert.ok(x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT, 'точка находится на игровой карте');
  return values[y * MAP_WIDTH + x] / 10;
}

assert.ok(temperatureAt(20, 20) > 18, 'Сахара отражает жаркий годовой климат');
assert.ok(temperatureAt(-40, 72) < 0, 'Гренландия отражает холодный годовой климат');
assert.ok(temperatureAt(0, 0) > 18, 'экваториальная суша отражает тёплый годовой климат');
assert.ok(temperatureAt(-150, 83) < 2, 'поверхность Северного Ледовитого океана отражает холодный климат');

console.log('Климатическая карта суши и океана хранит годовую температуру в °C.');
