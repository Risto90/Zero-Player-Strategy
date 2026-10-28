import { strict as assert } from 'node:assert';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import {
  buildTerrainGeometry,
  TERRAIN_GRID_COLUMNS,
  TERRAIN_GRID_ROWS,
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
for (let y = 360; y < 660; y += 1) {
  for (let x = 900; x < 1140; x += 1) {
    elevation[y * MAP_WIDTH + x] = 8500;
  }
}
for (let y = 180; y < 840; y += 1) {
  const pixel = y * MAP_WIDTH + 1024;
  knownRivers[pixel] = 3;
}

const geometry = buildTerrainGeometry({ land, elevation, knownRivers });
const positions = geometry.getAttribute('position');
const colors = geometry.getAttribute('color');
const indices = geometry.getIndex();
assert.equal(positions.count, TERRAIN_GRID_COLUMNS * TERRAIN_GRID_ROWS,
  'рельеф задан связной сеткой вершин, а не картинкой из цветных пикселей');
assert.equal(indices?.count, (TERRAIN_GRID_COLUMNS - 1) * (TERRAIN_GRID_ROWS - 1) * 6,
  'соседние вершины соединены треугольниками в геометрию поверхности');
assert.equal(colors.count, positions.count,
  'каждая вершина хранит цвет высотного материала, включая глубины моря');

let lowest = Infinity;
let highest = -Infinity;
let carvedLowest = Infinity;
for (let index = 0; index < positions.count; index += 1) {
  const x = positions.getX(index);
  const y = positions.getY(index);
  lowest = Math.min(lowest, y);
  highest = Math.max(highest, y);
  if (x > -0.02 && x < 0.02) carvedLowest = Math.min(carvedLowest, y);
}
assert.ok(lowest < -0.05, 'батиметрия формирует рельеф ниже уровня моря');
assert.ok(highest > 0.09, 'высокие точки формируют заметный положительный рельеф');
assert.ok(carvedLowest < highest, 'известное русло вырезает неглубокий канал в модели высот');
geometry.dispose();

console.log('Геометрия 3D-рельефа, батиметрия и русла проверены.');
