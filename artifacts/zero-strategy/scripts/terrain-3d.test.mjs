import { strict as assert } from 'node:assert';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { ELEVATION_COLOR_STOPS, elevationPackedColor } from '../game/render.ts';
import {
  buildSeaDepthTexture,
  buildElevationColorTexture,
  buildTerrainGeometry,
  ELEVATION_TEXTURE_WIDTH,
  SEA_DEPTH_TEXTURE_HEIGHT,
  SEA_DEPTH_TEXTURE_WIDTH,
  TERRAIN_CONTOUR_COLUMNS,
  TERRAIN_CONTOUR_ROWS,
} from '../components/map/Terrain3DRenderer.ts';

const land = new Uint8Array(MAP_PIXELS).fill(1);
const elevation = new Int16Array(MAP_PIXELS);
const knownRivers = new Uint8Array(MAP_PIXELS);
for (let y = 0; y < MAP_HEIGHT; y += 1) {
  for (let x = 0; x < MAP_WIDTH / 5; x += 1) {
    const pixel = y * MAP_WIDTH + x;
    land[pixel] = 0;
    elevation[pixel] = -5000;
  }
}
for (let y = 300; y < 720; y += 1) {
  for (let x = 800; x < 1240; x += 1) {
    const distance = Math.hypot((x - 1024) / 220, (y - 510) / 210);
    elevation[y * MAP_WIDTH + x] = Math.max(0, Math.round((1 - distance) * 8500));
  }
}
for (let y = 180; y < 840; y += 1) {
  const pixel = y * MAP_WIDTH + 1024;
  knownRivers[pixel] = 3;
}

const world = { land, elevation, knownRivers };
const geometry = buildTerrainGeometry(world);
const positions = geometry.getAttribute('position');
const indices = geometry.getIndex();
const elevationUvs = geometry.getAttribute('uv');
assert.ok(positions.count > 0, 'контуры высот создают геометрию суши');
assert.ok(positions.count < TERRAIN_CONTOUR_COLUMNS * TERRAIN_CONTOUR_ROWS * 8,
  'модель состоит из контурных площадок, а не из регулярной сетки пикселей');
assert.ok(indices && indices.count > 0, 'контурные площадки и склоны состоят из треугольников');
assert.ok(elevationUvs && elevationUvs.count === positions.count,
  'каждая вершина рельефа получает координату цветовой текстуры высот');
assert.ok(elevationUvs.getX(0) >= 0 && elevationUvs.getX(0) <= 1,
  'высота каждой вершины адресует оттенок в пределах гипсометрической шкалы');

let lowest = Infinity;
let highest = -Infinity;
let westernmost = Infinity;
const distinctHeights = new Set();
for (let index = 0; index < positions.count; index += 1) {
  const x = positions.getX(index);
  const y = positions.getY(index);
  westernmost = Math.min(westernmost, x);
  lowest = Math.min(lowest, y);
  highest = Math.max(highest, y);
  distinctHeights.add(y.toFixed(4));
}
assert.ok(lowest >= 0, 'модель содержит только сушу и не поднимает подводный рельеф');
assert.ok(westernmost > -0.7, 'контур побережья исключает морскую часть из геометрии суши');
assert.ok(highest > 0.09, 'высокие точки формируют заметный положительный рельеф');
assert.ok(distinctHeights.size > 10, 'адаптивное деление контурных площадок сохраняет непрерывные склоны');

let longestGroundEdge = 0;
for (let index = 0; index < indices.count; index += 3) {
  const triangle = [indices.getX(index), indices.getX(index + 1), indices.getX(index + 2)];
  for (let edge = 0; edge < 3; edge += 1) {
    const first = triangle[edge];
    const second = triangle[(edge + 1) % 3];
    const dx = positions.getX(first) - positions.getX(second);
    const dz = positions.getZ(first) - positions.getZ(second);
    longestGroundEdge = Math.max(longestGroundEdge, Math.hypot(dx, dz));
  }
}
assert.ok(longestGroundEdge < 0.06, 'адаптивное деление не оставляет крупных плоских граней');
geometry.dispose();

const elevationTexture = buildElevationColorTexture();
assert.equal(elevationTexture.image.width, ELEVATION_TEXTURE_WIDTH,
  'цвета рельефа хранятся в текстуре высот, а не задаются одним цветом материала');
assert.equal(elevationTexture.image.height, 1, 'цветовая шкала высоты является одномерной текстурой');
assert.equal(elevationTexture.image.data[3], 255, 'текстура высот полностью непрозрачна');
assert.deepEqual(
  [...elevationTexture.image.data.slice(0, 3)],
  [0xdc, 0xd3, 0xb2],
  'нулевая высота использует прежний цвет береговой отметки',
);
assert.ok(elevationTexture.image.data.some((channel, index) => index % 4 === 0 && channel > 200),
  'высокие участки используют восстановленные светлые оттенки');
const firstLandColor = elevationPackedColor(0);
assert.equal(firstLandColor & 255, Number.parseInt(ELEVATION_COLOR_STOPS[3][1].slice(1, 3), 16),
  'контраст подписей опирается на тот же цвет высоты, что и текстура рельефа');
elevationTexture.dispose();

const seaTexture = buildSeaDepthTexture(world);
const depthPixels = seaTexture.image.data;
const oceanOffset = ((SEA_DEPTH_TEXTURE_HEIGHT - 1) * SEA_DEPTH_TEXTURE_WIDTH) * 4;
const landColumn = Math.round((MAP_WIDTH / 5 + 300) / (MAP_WIDTH - 1) * (SEA_DEPTH_TEXTURE_WIDTH - 1));
const landOffset = ((SEA_DEPTH_TEXTURE_HEIGHT - 1) * SEA_DEPTH_TEXTURE_WIDTH + landColumn) * 4;
assert.equal(depthPixels[oceanOffset + 3], 255, 'глубины моря остаются на плоской подложке');
assert.equal(depthPixels[landOffset + 3], 0, 'подложка моря прозрачна под контурной 3D-сушей');
seaTexture.dispose();

assert.ok(TERRAIN_CONTOUR_COLUMNS < MAP_WIDTH && TERRAIN_CONTOUR_ROWS < MAP_HEIGHT,
  'контуры высот строятся из ограниченного набора исходных высот');
console.log('Контуры высот формируют только 3D-сушу; батиметрия остаётся плоской подложкой.');
