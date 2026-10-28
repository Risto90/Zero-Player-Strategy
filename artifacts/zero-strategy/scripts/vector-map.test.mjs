import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../game/game.ts';
import { ContourArea } from '../game/contours.ts';
import { MAP_HEIGHT, MAP_WIDTH } from '../game/config.ts';
import { seaDepthPackedColor } from '../game/render.ts';
import { World } from '../game/world.ts';
import { buildVectorMapSvg, buildVectorMapSvgTileParts, contourPath } from '../components/map/vectorMap.ts';

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

const renderer = game.renderer;
const fullMapBounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
const firstCorner = { x0: 0, y0: 0, x1: 12, y1: 12 };
const farCorner = {
  x0: MAP_WIDTH - 12,
  y0: MAP_HEIGHT - 12,
  x1: MAP_WIDTH - 1,
  y1: MAP_HEIGHT - 1,
};
renderer.acknowledge(fullMapBounds);
const initialFirstTile = renderer.vectorTilesIn({ ...firstCorner, x1: firstCorner.x1 + 1 })[0];
const initialFarTile = renderer.vectorTilesIn(farCorner)[0];
renderer.markForLayers(firstCorner, ['religion']);
assert.equal(renderer.hasPendingIn(firstCorner), false,
  'изменение неактивного религиозного слоя не помечает политическую заливку');
renderer.markForLayers(firstCorner, ['owner']);
assert.equal(renderer.hasPendingIn(firstCorner), true, 'изменение активного слоя помечает только его область');
assert.equal(renderer.hasPendingIn(farCorner), false, 'изменение за видимой областью не вызывает её перерисовку');
assert.notEqual(
  renderer.vectorTilesIn({ ...firstCorner, x1: firstCorner.x1 + 1 })[0].revision,
  initialFirstTile.revision,
  'изменение активного контура увеличивает версию только затронутой плитки',
);
assert.equal(
  renderer.vectorTilesIn(farCorner)[0].revision,
  initialFarTile.revision,
  'версия далёкой неизменённой плитки остаётся прежней',
);
renderer.acknowledge(fullMapBounds);

renderer.markOverlay(firstCorner);
assert.equal(renderer.hasPendingOverlayIn(firstCorner), true, 'изменение оверлея ожидает видимой отрисовки');
assert.equal(renderer.hasPendingOverlayIn(farCorner), false, 'невидимая область оверлея не считается видимой');
renderer.acknowledgeOverlay(firstCorner);
assert.equal(renderer.hasPendingOverlayIn(firstCorner), false, 'отрисованный участок оверлея снимается с очереди');

renderer.markTerrainPixels([center]);
const centerBounds = { x0: x, y0: y, x1: x, y1: y };
assert.equal(renderer.hasPendingTerrainIn(centerBounds), true, 'изменение рельефного оверлея помечает его участок');
assert.equal(renderer.hasPendingTerrainIn(farCorner), false, 'рельеф вне окна не требует отрисовки');
renderer.acknowledgeTerrain(centerBounds);
assert.equal(renderer.hasPendingTerrainIn(centerBounds), false, 'отрисованный участок рельефа снимается с очереди');

const ownerLayer = world.contours.layer('owner');
const originalOwnerRow = ownerLayer.row.bind(ownerLayer);
let ownerRowReads = 0;
ownerLayer.row = (row) => {
  ownerRowReads += 1;
  return originalOwnerRow(row);
};
world.contours.changedRows([y], ['owner']);
renderer.markForLayers({ x0: x - 40, y0: y - 40, x1: x + 40, y1: y + 40 }, ['owner']);
const afterOwnerChange = buildVectorMapSvg(game, {
  x0: Math.max(0, x - 40),
  y0: Math.max(0, y - 40),
  x1: Math.min(MAP_WIDTH, x + 40),
  y1: Math.min(MAP_HEIGHT - 1, y + 40),
});
ownerLayer.row = originalOwnerRow;
assert.ok(ownerRowReads < MAP_HEIGHT,
  'изменение границы существующей страны не пересобирает граф цветов по всей карте');
const seaDepthPathsAfterChange = [...afterOwnerChange.matchAll(/data-contour="(sea-depth-color:[^"]+)"/gu)]
  .map((match) => match[1]);
assert.deepEqual(seaDepthPathsAfterChange, seaDepthPaths,
  'обновление страны не пересчитывает неизменную подложку глубин моря');

const visibleTile = renderer.vectorTilesIn({
  x0: Math.max(0, x - 40),
  y0: Math.max(0, y - 40),
  x1: Math.min(MAP_WIDTH, x + 41),
  y1: Math.min(MAP_HEIGHT - 1, y + 40),
})[0];
const tileParts = buildVectorMapSvgTileParts(game, visibleTile.bounds, visibleTile.id);
assert.ok(tileParts.every((part) => part.key.startsWith(`tile:${visibleTile.id}:`)),
  'векторные части плиток имеют отдельные стабильные ключи');
assert.ok(tileParts.every((part) => Number.isFinite(part.order)),
  'порядок заливки, границ, берега и кочевых областей задан явно');
assert.match(tileParts.map((part) => part.markup).join(''), /data-contour="country:/u,
  'изменяемая плитка сохраняет контурную заливку государства');

const mapView = readFileSync(resolve(process.cwd(), 'components/map/MapView.web.tsx'), 'utf8');
assert.match(mapView, /vectorTilesIn\(renderBounds\)/u, 'отрисовка получает только плитки видимого окна');
assert.match(mapView, /buildVectorMapSvgTileParts\(game, tile\.bounds, tile\.id\)/u,
  'изменённый контур пересобирается отдельно от неизменённых плиток');
assert.match(mapView, /updateVectorMapSvgParts\(vectorSvg, vectorParts, vectorPartNodesRef\.current\)/u,
  'изменённые векторные группы обновляются отдельно, неизменные остаются на месте');
assert.match(mapView, /hasPendingIn\(visibleBounds\)/u, 'видимая заливка проверяется отдельно от отдалённых плиток');
assert.match(mapView, /hasPendingOverlayIn\(visibleBounds\)/u, 'видимый оверлей обновляется отдельно от заливок');
assert.match(mapView, /hasPendingTerrainIn\(visibleBounds\)/u, 'трёхмерный рельеф не пересобирается из-за невидимых изменений');
assert.match(mapView, /element\.style\.transform = transform/u, 'перетаскивание использует аппаратную трансформацию холстов');
assert.match(mapView, /!routeActiveRef\.current \|\| !pageVisibleRef\.current/u,
  'отрисовка отключена, пока экран игры не виден');
assert.equal((mapView.match(/<canvas\b/gu) ?? []).length, 1, 'единственный видимый холст оставлен 3D-рельефу');
assert.doesNotMatch(mapView, /drawImage\(/u, 'растровая карта не масштабируется и не копируется на холст');

game.discard();
console.log('Проверки SVG-контуров карты завершены.');
