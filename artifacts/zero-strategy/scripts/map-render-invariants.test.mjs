import assert from 'node:assert/strict';
import { BIOMES, MAP_PIXELS, MAP_WIDTH, biomeFor } from '../game/config.ts';
import { MapContours } from '../game/contours.ts';
import { MapRenderer, seaDepthPackedColor, temperaturePackedColor } from '../game/render.ts';
import { fitMapBounds, visibleMapBounds, zoomAround } from '../components/map/viewMath.ts';

const rgb = (hex) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const packed = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const biomeFill = (humidity, temperature, drainage) =>
  packed(rgb(BIOMES[biomeFor(humidity, temperature, drainage)].color));

const land = new Uint8Array(MAP_PIXELS).fill(1);
const elevation = new Int16Array(MAP_PIXELS);
const depth = new Uint16Array(MAP_PIXELS);
const owner = new Uint16Array(MAP_PIXELS);
const humidity = new Uint8Array(MAP_PIXELS).fill(50);
const temperature = new Float32Array(MAP_PIXELS).fill(20);
const drainage = new Uint8Array(MAP_PIXELS).fill(50);
const density = new Float32Array(MAP_PIXELS);
const culture = new Uint16Array(MAP_PIXELS);
const religion = new Uint16Array(MAP_PIXELS);
const cityIdAt = new Int32Array(MAP_PIXELS).fill(-1);
land[0] = 0;
depth[0] = 1500;
temperature[0] = 12.5;

const cityPixel = 312 * MAP_WIDTH + 512;
cityIdAt[cityPixel] = 0;
const unclaimedDesertPixel = 100 * MAP_WIDTH + 100;
const unclaimedForestPixel = 200 * MAP_WIDTH + 200;
humidity[unclaimedDesertPixel] = 5;
temperature[unclaimedDesertPixel] = 12.5;
drainage[unclaimedDesertPixel] = 50;
humidity[unclaimedForestPixel] = 80;
temperature[unclaimedForestPixel] = 22.5;
drainage[unclaimedForestPixel] = 50;
const world = {
  version: 0,
  geographyRevision: 0,
  land,
  elevation,
  depth,
  owner,
  humidity,
  temperature,
  drainage,
  density,
  culture,
  religion,
  cityIdAt,
  cities: [{ id: 0, countryId: 0, pixel: cityPixel, rank: 1 }],
  countries: [],
  cultures: [],
  religions: [],
  contours: {
    layer: (name) => ({
      row: (y) => y === 0
        ? [{ start: 0, end: 1, value: name === 'temperature' ? temperature[0] : 100 }]
        : [],
    }),
  },
};

const renderer = new MapRenderer(world);
const baseBuffer = renderer.base;
renderer.markAll();
renderer.flush();
assert.equal(renderer.tilePaintCount, 128, 'первичный слой карты рисуется один раз целиком');
const politicalCityColor = renderer.pixels[cityPixel];
const depthColor = seaDepthPackedColor(-1500) >>> 0;
assert.equal(renderer.pixels[0], depthColor, 'карта использует глубину воды в базовом слое');
assert.equal(renderer.pixels[unclaimedDesertPixel],
  biomeFill(humidity[unclaimedDesertPixel], temperature[unclaimedDesertPixel], drainage[unclaimedDesertPixel]),
  'ничейная земля получает точный цвет биома, рассчитанный по температуре в °C');
assert.notEqual(renderer.pixels[unclaimedDesertPixel], 0,
  'дробная температура не превращает заливку в прозрачный пиксель');

let painted = renderer.tilePaintCount;
renderer.setView('cities', null);
renderer.flush();
assert.ok(renderer.tilePaintCount - painted < 128,
  'при переходе к городам перерисовываются только плитки их маркеров');
assert.notEqual(renderer.pixels[cityPixel], politicalCityColor,
  'городской слой обновляет маркер поверх сохранённой политической карты');
assert.equal(renderer.pixels[0], depthColor, 'вода переиспользует прежний базовый слой глубин');

painted = renderer.tilePaintCount;
renderer.setView('political', null);
renderer.flush();
assert.ok(renderer.tilePaintCount - painted < 128,
  'возврат к странам тоже меняет только плитки городов');
assert.equal(renderer.pixels[cityPixel], politicalCityColor,
  'политическая заливка восстанавливается из общего буфера');

renderer.setView('humidity', null);
renderer.flush();
assert.notEqual(renderer.pixels[0], depthColor,
  'родное значение влажности на воде перекрывает батиметрию');
renderer.setView('temperature', null);
renderer.flush();
assert.equal(renderer.pixels[0], temperaturePackedColor(temperature[0]) >>> 0,
  'температурная карта окрашивает по значению в градусах Цельсия, а не по старой шкале');
renderer.setView('political', null);
renderer.flush();
assert.equal(renderer.pixels[0], depthColor,
  'после тематического слоя не остаются старые пиксели');
assert.equal(renderer.base, baseBuffer, 'базовый слой не пересоздаётся при переключении карт');
renderer.setView('biomes', null);
renderer.flush();
assert.notEqual(renderer.pixels[unclaimedDesertPixel], renderer.pixels[unclaimedForestPixel],
  'карта биомов различает значения по фактической температуре в °C');
assert.equal(renderer.pixels[unclaimedDesertPixel],
  packed(rgb(BIOMES[biomeFor(
    humidity[unclaimedDesertPixel],
    temperature[unclaimedDesertPixel],
    drainage[unclaimedDesertPixel],
  )].color)),
  'цвет биома на карте совпадает с классификацией точки');
renderer.setView('political', null);
renderer.flush();
assert.equal(renderer.pixels[unclaimedDesertPixel],
  biomeFill(humidity[unclaimedDesertPixel], temperature[unclaimedDesertPixel], drainage[unclaimedDesertPixel]),
  'возврат к странам сохраняет точный цвет биома');

painted = renderer.tilePaintCount;
renderer.flush();
assert.equal(renderer.tilePaintCount, painted, 'повторная отрисовка без изменений не рисует плитки');
renderer.setView('elevation', null);
renderer.flush();
assert.equal(renderer.tilePaintCount, painted, '3D-слой не запускает повторную растровую отрисовку');

const contourIndex = new MapContours(() => new Uint8Array(MAP_PIXELS), () => 0);
const contourChanges = [];
const unsubscribeContours = contourIndex.subscribeChanges((change) => contourChanges.push(change));
contourIndex.changed({ x0: 14, y0: 33, x1: 14, y1: 33 }, ['owner']);
assert.deepEqual(contourChanges[0], {
  revision: 1,
  bounds: { x0: 14, y0: 33, x1: 14, y1: 33 },
  layers: ['owner'],
}, 'ядро публикует точную локальную область и изменённый слой');
unsubscribeContours();

const visible = visibleMapBounds({ scale: 2, ox: -20, oy: -40 }, 200, 100);
assert.deepEqual(visible, { x0: 10, y0: 20, x1: 109, y1: 69 },
  'область просмотра переводится в координаты карты для фильтрации уведомлений');

const focused = fitMapBounds({ x0: 100, y0: 200, x1: 119, y1: 239 }, 400, 800, 800);
const focusedCenterX = (100 + 119 + 1) / 2 * focused.scale + focused.ox;
const focusedCenterY = (200 + 239 + 1) / 2 * focused.scale + focused.oy;
assert.ok(Math.abs(focusedCenterX - 200) < 1e-8 && Math.abs(focusedCenterY - 400) < 1e-8,
  'рамка страны центрируется на экране при выборе');
const focusedLeft = 100 * focused.scale + focused.ox;
const focusedRight = 120 * focused.scale + focused.ox;
const focusedTop = 200 * focused.scale + focused.oy;
const focusedBottom = 240 * focused.scale + focused.oy;
assert.ok(focusedLeft >= 0 && focusedRight <= 400 && focusedTop >= 0 && focusedBottom <= 800,
  'масштаб позволяет полностью показать территорию выбранной страны');
assert.ok(Math.abs(800 * focused.scale ** 2 / (400 * 800) - 0.25) < 1e-8,
  'если рамка позволяет, выбранная страна занимает не менее четверти экрана');
const onePixelFocus = fitMapBounds({ x0: 100, y0: 200, x1: 100, y1: 200 }, 400, 800, 1);
assert.ok(onePixelFocus.scale > 32 && onePixelFocus.maxScale >= onePixelFocus.scale,
  'маленькая страна получает достаточно крупный масштаб и может удерживать его при жестах');
assert.equal(
  zoomAround(onePixelFocus, 1, 200, 400, 400, 800).scale,
  onePixelFocus.scale,
  'обычное ограничение масштаба не сбрасывает уже подобранный крупный масштаб страны',
);

console.log('Проверены центровка страны, масштаб её показа и тематические заливки.');
