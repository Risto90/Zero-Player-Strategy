import { strict as assert } from 'node:assert';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from '../game/config.ts';
import { MapContours } from '../game/contours.ts';
import { CompositionTable } from '../game/composition.ts';
import { cityLabelFontSize } from '../game/cityVisibility.ts';
import { fitLabelToVisibleContour } from '../game/labelGeometry.ts';
import {
  countryLabelViewportLayout,
  countryMapLabels,
  entityMapLabels,
  geographicVisibilityScale,
  shouldShowCityMarks,
  shouldShowGeographyMarks,
  visibleCityLabelIds,
  volcanoVisibilityScale,
} from '../game/mapLabels.ts';
import { seaDepthPackedColor } from '../game/render.ts';

const owner = new Uint16Array(MAP_PIXELS);
const land = new Uint8Array(MAP_PIXELS);
for (let y = 20; y < 60; y += 1) {
  for (let x = 20; x < 140; x += 1) {
    const pixel = y * MAP_WIDTH + x;
    owner[pixel] = 1;
    land[pixel] = 1;
  }
}
const nomadRange = [];
for (let y = 100; y < 130; y += 1) {
  for (let x = 300; x < 330; x += 1) {
    const pixel = y * MAP_WIDTH + x;
    land[pixel] = 1;
    nomadRange.push(pixel);
  }
}
for (let y = 20; y < 50; y += 1) {
  for (let x = 500; x < 530; x += 1) owner[y * MAP_WIDTH + x] = 3;
}
for (let y = 90; y < 120; y += 1) {
  for (let x = 570; x < 600; x += 1) owner[y * MAP_WIDTH + x] = 3;
}

const world = {
  version: 1,
  territoryVersion: 1,
  owner,
  land,
  culture: new Uint16Array(MAP_PIXELS),
  religion: new Uint16Array(MAP_PIXELS),
  humanOrigins: new Uint16Array(MAP_PIXELS),
  cultureTable: new CompositionTable(),
  religionTable: new CompositionTable(),
  humanOriginTable: new CompositionTable(),
  cities: [
    { id: 10, name: 'Главный город', pixel: 80 * MAP_WIDTH + 80, rank: 6, capital: true },
    { id: 11, name: 'Соседний город', pixel: 80 * MAP_WIDTH + 80, rank: 6, capital: false },
    { id: 12, name: 'Малый город', pixel: 80 * MAP_WIDTH + 100, rank: 1, capital: false },
  ],
  knownRivers: new Uint8Array(MAP_PIXELS),
  isCoastal: () => false,
  cultures: [{ id: 0, name: 'Народ' }],
  religions: [{ id: 0, name: 'Вера' }],
  countries: [
    { id: 0, type: 'settled', name: 'Республика', pixels: 4800, box: [20, 20, 139, 59] },
    { id: 1, type: 'nomadic', name: 'Кочевье', pixels: 0, box: [300, 100, 329, 129], range: nomadRange, cells: [] },
    { id: 2, type: 'settled', name: 'Дальняя федерация', pixels: 1800, box: [500, 20, 599, 119] },
  ],
};
const cultureMix = world.cultureTable.single(0, 100);
const religionMix = world.religionTable.single(0, 100);
const originMix = world.humanOriginTable.single(0, 100);
for (let y = 20; y < 60; y += 1) for (let x = 20; x < 140; x += 1) {
  const pixel = y * MAP_WIDTH + x;
  world.culture[pixel] = cultureMix;
  world.religion[pixel] = religionMix;
  world.humanOrigins[pixel] = originMix;
}
world.contours = new MapContours((name) => world[name], () => world.version);

const zoomedOut = countryMapLabels(world, 0.3, 'political', 1);
const zoomedIn = countryMapLabels(world, 2, 'political', 1);
assert.equal(zoomedOut.some((label) => label.countryId === 0), false, 'маленькая подпись страны скрыта, пока не помещается');
assert.ok(zoomedIn.some((label) => label.countryId === 0), 'подпись осёдлой страны появляется, когда помещается в её область');
assert.ok(zoomedIn.some((label) => label.countryId === 1 && label.selected), 'выбранное кочевье подписано на карте государств');
assert.ok(countryMapLabels(world, 2, 'cities', 1).some((label) => label.countryId === 1),
  'подписи кочевий также появляются на карте городов');
assert.ok(countryMapLabels(world, 2, 'political', null).some((label) => label.countryId === 1),
  'названия кочевий видны и без выбора страны');
assert.equal(countryMapLabels(world, 2, 'humidity', 1).length, 0,
  'подписи государств скрыты на климатических слоях');
assert.equal(countryMapLabels(world, 1, 'humidity', 1).some((label) => label.countryId === 1), false,
  'кочевье не подписывается на климатическом слое');
assert.equal(shouldShowCityMarks('political'), true, 'города видны на карте государств');
assert.equal(shouldShowCityMarks('cities'), true, 'города видны на карте городов');
assert.equal(shouldShowCityMarks('elevation'), false, 'города скрыты на карте высот');
assert.ok(cityLabelFontSize(8, 1) > cityLabelFontSize(1, 1),
  'названия городов увеличиваются при приближении карты');
const cityNameIds = visibleCityLabelIds(world, 'political', 1, 1, 0, 0, 320, 180);
assert.ok(cityNameIds.has(10), 'для видимой столицы показывается подпись');
assert.equal(cityNameIds.has(11), false, 'перекрывающиеся подписи городов не рисуются друг поверх друга');
assert.equal(cityNameIds.has(12), false, 'подпись города скрыта, пока не виден его значок');
assert.equal(visibleCityLabelIds(world, 'political', 1, 1, 0, 0, 320, 180, [
  { left: 40, top: 45, right: 120, bottom: 70 },
]).has(10), false, 'подпись города скрывается при конфликте с уже размещённой подписью карты');
assert.equal(visibleCityLabelIds(world, 'elevation', 10, 1, 0, 0, 320, 180).size, 0,
  'значки и подписи городов отсутствуют на карте высот');
assert.equal(shouldShowGeographyMarks('political'), true, 'горы видны на карте государств');
assert.equal(shouldShowGeographyMarks('elevation'), true, 'горы видны на карте высот');
assert.equal(shouldShowGeographyMarks('cultures'), false, 'горы скрыты на карте культур');
assert.ok(entityMapLabels(world, 'cultures', { kind: 'culture', id: 0 }, 2)
  .some((label) => label.text === 'Народ'), 'выбранная культура получает контурную подпись');
assert.ok(entityMapLabels(world, 'religions', { kind: 'religion', id: 0 }, 2)
  .some((label) => label.text === 'Вера'), 'выбранная религия получает контурную подпись');
assert.ok(entityMapLabels(world, 'origins', { kind: 'origin', id: 0 }, 2)
  .some((label) => label.text.length > 0), 'выбранная раса получает контурную подпись');
const dividedLabels = countryMapLabels(world, 8, 'political', null).filter((label) => label.countryId === 2);
assert.equal(dividedLabels.filter((label) => !label.allFragments).length, 2,
  'раздельные территории страны получают отдельные подписи, если общая не помещается');
for (let left = 0; left < zoomedIn.length; left += 1) {
  for (let right = left + 1; right < zoomedIn.length; right += 1) {
    const a = zoomedIn[left];
    const b = zoomedIn[right];
    assert.ok(Math.abs(a.x - b.x) * 2 >= a.width + b.width || Math.abs(a.y - b.y) * 2 >= a.height + b.height,
      'видимые подписи стран не накладываются друг на друга');
  }
}
assert.equal(geographicVisibilityScale(1, 6500), 1, 'самые высокие вершины видны при общем масштабе');
assert.ok(geographicVisibilityScale(1, 700) > geographicVisibilityScale(1, 6500),
  'низкие вершины становятся видны только при приближении');
assert.equal(volcanoVisibilityScale(1, 4, 3), 1, 'частые мощные извержения видны при общем масштабе');
assert.ok(volcanoVisibilityScale(1, 60, 1) >= 8.7, 'слабое извержение раз в шестьдесят лет видно только вблизи');
assert.ok(volcanoVisibilityScale(1, 4, 3) < volcanoVisibilityScale(1, 60, 1),
  'видимость вулкана зависит от частоты и силы извержений');
const viewportLabel = zoomedIn.find((label) => label.countryId === 0);
const fitted = countryLabelViewportLayout(viewportLabel, 100, -5000, -5000, 320, 180);
assert.ok(fitted.fontSize <= 140, 'подписи стран не увеличиваются за пределы видимой области');
assert.ok(fitted.x >= 8 && fitted.x <= 312 && fitted.y >= 8 && fitted.y <= 172,
  'подписи стран остаются внутри видимой области');
const measuredWidthFactor = 1.1;
const fittedMeasured = countryLabelViewportLayout(viewportLabel, 100, -5000, -5000, 320, 180, measuredWidthFactor);
const measuredTextWidth = fittedMeasured.fontSize * measuredWidthFactor;
assert.ok(fittedMeasured.x - measuredTextWidth / 2 >= 8 &&
  fittedMeasured.x + measuredTextWidth / 2 <= 312,
  'подписи помещаются по ширине отображаемых букв');
const obstacleFit = fitLabelToVisibleContour({
  rings: [new Int32Array([20, 20, 260, 20, 260, 140, 20, 140])],
  scale: 1,
  ox: 0,
  oy: 0,
  viewportWidth: 320,
  viewportHeight: 180,
  glyphWidthFactor: 7,
  glyphCount: 10,
  maxFontSize: 20,
  allowBridge: false,
  obstacles: [{ left: 145, top: 44, right: 175, bottom: 116 }],
});
const obstacleTextWidth = obstacleFit &&
  7 * obstacleFit.fontSize + 9 * obstacleFit.letterSpacing;
const obstacleLineHeight = obstacleFit && obstacleFit.fontSize * 1.2;
const obstaclePaddedWidth = obstacleFit && obstacleTextWidth + obstacleLineHeight * 0.5;
const obstaclePaddedHeight = obstacleFit && obstacleLineHeight * 1.5;
const obstacleMargin = obstacleFit && obstacleFit.fontSize * 0.3;
const obstacleExtentX = obstacleFit && (
  Math.abs(Math.cos(obstacleFit.angle)) * obstaclePaddedWidth +
  Math.abs(Math.sin(obstacleFit.angle)) * obstaclePaddedHeight
) / 2 + (obstacleMargin || 0);
const obstacleExtentY = obstacleFit && (
  Math.abs(Math.sin(obstacleFit.angle)) * obstaclePaddedWidth +
  Math.abs(Math.cos(obstacleFit.angle)) * obstaclePaddedHeight
) / 2 + (obstacleMargin || 0);
const placedOutsideObstacle = obstacleFit && obstacleTextWidth &&
  !(obstacleFit.x - obstacleExtentX < 175 && obstacleFit.x + obstacleExtentX > 145 &&
    obstacleFit.y - obstacleExtentY < 116 && obstacleFit.y + obstacleExtentY > 44);
assert.ok(placedOutsideObstacle,
  'подпись перемещается из-под элементов управления карты, если контур оставляет для неё место');
const multilineLayout = countryLabelViewportLayout({
  ...viewportLabel,
  key: 'multiline-layout-test',
  text: 'Дальняя республика островов',
  fontSize: 20,
  rings: [new Int32Array([10, 10, 130, 10, 130, 90, 10, 90])],
  countryBounds: { x0: 10, y0: 10, x1: 129, y1: 89 },
  allowBridge: false,
}, 1, 0, 0, 160, 120, undefined, 11, (line) => [...line].length * 0.48);
assert.ok(multilineLayout.visible && multilineLayout.lines.length === 2,
  'длинное название с несколькими словами переносится на две строки, если форма области этого требует');
assert.equal(countryLabelViewportLayout(viewportLabel, 1, 10000, 10000, 320, 180).visible, false,
  'подпись скрывается, когда территория страны вне экрана');
const wideLabelRing = new Int32Array([10, 10, 210, 10, 210, 110, 10, 110]);
const wideLabel = fitLabelToVisibleContour({
  rings: [wideLabelRing],
  scale: 1,
  ox: 0,
  oy: 0,
  viewportWidth: 240,
  viewportHeight: 140,
  glyphWidthFactor: 3.4,
  glyphCount: 8,
  maxFontSize: 32,
  allowBridge: false,
});
assert.ok(wideLabel && wideLabel.fontSize >= 11, 'векторный контур получает читаемую подпись');
assert.ok(wideLabel.letterSpacing > 0, 'свободное место заполняется межбуквенным интервалом');
const diagonalLabelRing = new Int32Array([10, 10, 180, 80, 160, 130, -10, 60]);
const diagonalLabel = fitLabelToVisibleContour({
  rings: [diagonalLabelRing],
  scale: 1,
  ox: 0,
  oy: 0,
  viewportWidth: 220,
  viewportHeight: 150,
  glyphWidthFactor: 2.8,
  glyphCount: 5,
  maxFontSize: 28,
  allowBridge: false,
});
assert.ok(diagonalLabel && (Math.abs(diagonalLabel.angle) > 0.1 ||
  (diagonalLabel.path && Math.abs(Math.atan2(
    diagonalLabel.path.at(-1).y - diagonalLabel.path[0].y,
    diagonalLabel.path.at(-1).x - diagonalLabel.path[0].x,
  )) > 0.1)),
  'вытянутая область получает подпись, ориентированную вдоль её контура');
const fullVisibleLabel = fitLabelToVisibleContour({
  rings: [new Int32Array([0, 0, 200, 0, 200, 100, 0, 100])],
  scale: 1,
  ox: 0,
  oy: 0,
  viewportWidth: 220,
  viewportHeight: 120,
  glyphWidthFactor: 3.4,
  glyphCount: 8,
  maxFontSize: 32,
  allowBridge: false,
});
const pannedVisibleLabel = fitLabelToVisibleContour({
  rings: [new Int32Array([0, 0, 200, 0, 200, 100, 0, 100])],
  scale: 1,
  ox: -80,
  oy: 0,
  viewportWidth: 220,
  viewportHeight: 120,
  glyphWidthFactor: 3.4,
  glyphCount: 8,
  maxFontSize: 32,
  allowBridge: false,
});
assert.ok(fullVisibleLabel && pannedVisibleLabel && pannedVisibleLabel.x < fullVisibleLabel.x - 20,
  'при сдвиге подпись перестраивается по видимой части территории, а не просто зажимается у края');
const clippedFragmentsLabel = fitLabelToVisibleContour({
  rings: [new Int32Array([-100, 20, 180, 20, 180, 50, -50, 50, -50, 80, 180, 80, 180, 110, -100, 110])],
  scale: 1,
  ox: 0,
  oy: 0,
  viewportWidth: 220,
  viewportHeight: 120,
  glyphWidthFactor: 2.5,
  glyphCount: 6,
  maxFontSize: 18,
  allowBridge: false,
});
assert.ok(clippedFragmentsLabel &&
  !(clippedFragmentsLabel.y > 50 && clippedFragmentsLabel.y < 80),
  'при обрезке контура окном просмотра подпись не перескакивает через разрыв в чужой области');
assert.ok(clippedFragmentsLabel?.path?.every((point) =>
  point.x >= 8 && point.x <= 212 && point.y >= 8 && point.y <= 112),
  'криволинейная подпись ограничена видимой областью карты');
const bridgedLabel = fitLabelToVisibleContour({
  rings: [
    new Int32Array([10, 10, 35, 10, 35, 50, 10, 50]),
    new Int32Array([55, 10, 80, 10, 80, 50, 55, 50]),
  ],
  scale: 1,
  ox: 0,
  oy: 0,
  viewportWidth: 100,
  viewportHeight: 70,
  glyphWidthFactor: 5,
  glyphCount: 8,
  maxFontSize: 18,
  allowBridge: true,
});
assert.ok(bridgedLabel && bridgedLabel.x > 35 && bridgedLabel.x < 55,
  'близкие раздельные части получают одну подпись, растянутую через общий промежуток');
const clippedAwayLabel = fitLabelToVisibleContour({
  rings: [new Int32Array([205, 20, 400, 20, 400, 70, 205, 70])],
  scale: 1,
  ox: 0,
  oy: 0,
  viewportWidth: 220,
  viewportHeight: 100,
  glyphWidthFactor: 2.5,
  glyphCount: 6,
  maxFontSize: 24,
  allowBridge: false,
});
assert.equal(clippedAwayLabel, null, 'слишком узкая видимая часть контура не получает обрезанную подпись');
assert.ok(MAP_HEIGHT * MAP_WIDTH === MAP_PIXELS, 'аннотации используют полный размер карты');
assert.notEqual(seaDepthPackedColor(-9000), seaDepthPackedColor(-100),
  'цвета различают глубокое море и мелководье у берега');

console.log('Подписи карты и пороги видимости объектов проверены.');
