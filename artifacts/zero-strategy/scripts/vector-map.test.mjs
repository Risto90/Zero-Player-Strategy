import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../game/game.ts';
import { ContourArea } from '../game/contours.ts';
import { MAP_HEIGHT, MAP_WIDTH } from '../game/config.ts';
import { seaDepthPackedColor } from '../game/render.ts';
import { World } from '../game/world.ts';
import { buildVectorMapSvg, contourPath } from '../components/map/vectorMap.ts';

Game.persist = false;
const world = World.create('random', 61_407);
const culture = world.newCulture(null, 1000);
const country = world.newCountry({
  rank: 'тест',
  cultureId: culture.id,
  religionId: null,
  density: 80,
  foundedYear: 1000,
  parentId: null,
  government: 'hereditary',
});
const points = Array.from(world.landIndex.slice(0, 120));
for (const pixel of points) {
  world.setOwner(pixel, country.id + 1);
  world.density[pixel] = 80;
  world.humidity[pixel] = 45;
  world.temperature[pixel] = 50;
  world.drainage[pixel] = 50;
}
world.recountCountries();

const rectangle = contourPath(ContourArea.rectangle({ x0: 10, y0: 20, x1: 12, y1: 23 }));
assert.equal(rectangle, 'M10 20L13 20L13 24L10 24Z',
  'SVG получает координаты кольца как пары x/y, сохраняя реальную область суши');

const game = new Game(world, 'observer');
const center = points.find((pixel) => world.isCoastal(pixel)) ?? points[Math.floor(points.length / 2)];
const x = center % MAP_WIDTH;
const y = Math.floor(center / MAP_WIDTH);
const markup = buildVectorMapSvg(game, {
  x0: Math.max(0, x - 40),
  y0: Math.max(0, y - 40),
  x1: Math.min(MAP_WIDTH, x + 40),
  y1: Math.min(MAP_HEIGHT - 1, y + 40),
});

assert.match(markup, /<path[^>]+d="M\d+ \d+/u, 'контурная область формируется в SVG-путь');
assert.match(markup, /data-contour="country:/u, 'заливка страны берётся из единого контура её значений');
assert.match(markup, /stroke="#654e3a"/u, 'границы стран выводятся отдельными векторными контурами');
const seaDepthPaths = [...markup.matchAll(/data-contour="(sea-depth-color:[^"]+)"/gu)].map((match) => match[1]);
const paletteColors = new Set(Array.from({ length: 11_001 }, (_, depth) => seaDepthPackedColor(-depth)));
assert.ok(seaDepthPaths.length > 0, 'подложка морских глубин остаётся векторной');
assert.equal(new Set(seaDepthPaths).size, seaDepthPaths.length, 'одинаковые цвета глубины объединяются в один векторный путь');
assert.ok(seaDepthPaths.length <= paletteColors.size, 'число путей морских глубин ограничено числом реальных цветов палитры');

const mapView = readFileSync(resolve(process.cwd(), 'components/map/MapView.web.tsx'), 'utf8');
assert.match(mapView, /buildVectorMapSvg\(game, renderBounds\)/u, 'карта собирается из SVG-контуров текущего видимого окна');
assert.equal((mapView.match(/<canvas\b/gu) ?? []).length, 1, 'единственный видимый холст оставлен 3D-рельефу');
assert.doesNotMatch(mapView, /drawImage\(/u, 'растровая карта не масштабируется и не копируется на холст');

game.discard();
console.log('Проверки SVG-контуров карты завершены.');
