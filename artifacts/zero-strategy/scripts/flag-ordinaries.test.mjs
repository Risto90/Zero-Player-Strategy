import assert from 'node:assert/strict';
import {
  buildFlagOrdinaryLayers,
  validateFlagOrdinaries,
} from '../game/flagOrdinaries.ts';
import { flagPolygonSetArea } from '../game/flagField.ts';

const height = 1200;
const frame = { x0: 30, y0: 20, w: 1200, h: 800 };
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const types = [
  { type: 'O01', params: { thickness: 110 } },
  { type: 'O02', params: { mode: 'CORNER', thickness: 110 } },
  { type: 'O02', params: { mode: 'D45', thickness: 110 } },
  { type: 'O03', params: { axis: 'DIAGONAL', thickness: 110 } },
  { type: 'O03', params: { axis: -45, placement: 'AT_EDGE', edge: 'TOP', thickness: 150 } },
  { type: 'O04', params: { halfAngle: 45, thickness: 110 } },
  { type: 'O05', params: { thickness: 110 } },
  { type: 'O06', params: { side: 'HOIST', baseLength: 360, depth: 400 } },
  ...['PLAIN', 'DOUBLE', 'CHECKY', 'ORLE'].map((variant) => ({
    type: 'O07',
    params: { variant, thickness: 75, gap: 20 },
  })),
];

for (const spec of types) {
  const result = buildFlagOrdinaryLayers([spec], frame, { canvasHeight: height });
  assert.equal(result.ordinaryCount, 1, `${spec.type} считается одним ординарием`);
  assert.ok(result.paintLayers.length > 0, `${spec.type} создаёт слой отрисовки`);
  assert.ok(result.paintLayers.every(({ polygons }) => polygons.length > 0), `${spec.type} содержит видимую геометрию`);
  assert.ok(result.paintLayers.every(({ polygons }) => polygons.flat().every(({ x, y }) =>
    Number.isFinite(x) && Number.isFinite(y))), `${spec.type}: координаты конечны`);
}

const assertBuilds = (spec, label) => {
  const result = buildFlagOrdinaryLayers([spec], frame, { canvasHeight: height });
  assert.ok(result.paintLayers.length > 0 && result.paintLayers.every(({ polygons }) => polygons.length > 0), label);
};
for (const thickness of [height / 12, height / 4]) {
  assertBuilds({ type: 'O01', params: { thickness, profile: 'FLARED', flareRatio: 1.3 } }, `O01 принимает предельную толщину ${thickness}`);
  assertBuilds({ type: 'O02', params: { thickness, mode: 'D45' } }, `O02 принимает предельную толщину ${thickness}`);
  assertBuilds({ type: 'O03', params: { thickness, axis: 45 } }, `O03 принимает предельную толщину ${thickness}`);
}
for (const thickness of [height / 12, height / 5]) {
  assertBuilds({ type: 'O04', params: { thickness, halfAngle: 20, orientation: 'UP' } }, `O04 принимает предельную толщину ${thickness}`);
}
for (const thickness of [height / 12, height / 6]) {
  assertBuilds({ type: 'O05', params: { thickness, angles: [90, 135, 135] } }, `O05 принимает предельную толщину ${thickness}`);
}
for (const ratio of [0.2, 0.45]) {
  assertBuilds({
    type: 'O01',
    params: { arms: 'COUPED', halfLength: Math.min(frame.w, frame.h) * ratio, profile: 'LATIN', latinRatio: 1.2 },
  }, `O01 принимает предельную длину укороченного плеча ${ratio}`);
}
for (const axis of [0, 90, 'DIAGONAL', 30, -30, 45, -45, 60, -60]) {
  assertBuilds({ type: 'O03', params: { axis, placement: 'AT_EDGE', edge: 'TOP' } }, `O03 поддерживает ось ${axis}`);
}
for (const orientation of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
  assertBuilds({ type: 'O04', params: { halfAngle: 60, orientation } }, `O04 поддерживает ориентацию ${orientation}`);
}
for (const side of ['HOIST', 'FLY', 'TOP', 'BOTTOM']) {
  const baseSide = side === 'HOIST' || side === 'FLY' ? frame.h : frame.w;
  const inwardSide = side === 'HOIST' || side === 'FLY' ? frame.w : frame.h;
  assertBuilds({
    type: 'O06',
    params: { side, baseLength: baseSide * 0.4, depth: inwardSide * 0.25, tipWidth: baseSide * 0.2 },
  }, `O06 поддерживает сторону основания ${side}`);
}
for (const corner of ['HOIST_TOP', 'FLY_TOP', 'HOIST_BOTTOM', 'FLY_BOTTOM']) {
  const canton = buildFlagOrdinaryLayers([{
    type: 'O08', params: { corner, width: frame.w * 0.25, height: frame.h * 0.25 },
  }], frame, { canvasHeight: height });
  const points = canton.paintLayers[0].polygons.flat();
  const expectedLeft = corner.startsWith('HOIST') ? frame.x0 : frame.x0 + frame.w * 0.75;
  const expectedTop = corner.endsWith('_TOP') ? frame.y0 : frame.y0 + frame.h * 0.75;
  assert.equal(Math.min(...points.map(({ x }) => x)), expectedLeft, `O08 размещает кантон ${corner} по горизонтали`);
  assert.equal(Math.min(...points.map(({ y }) => y)), expectedTop, `O08 размещает кантон ${corner} по вертикали`);
}
assertBuilds({ type: 'O01', params: { scandinavian: true, center: { u: 0.3, v: 0.5 } } },
  'O01 принимает нижнюю границу смещения скандинавского центра');
assertBuilds({ type: 'O01', params: { scandinavian: true, center: { u: 0.42, v: 0.5 } } },
  'O01 принимает верхнюю границу смещения скандинавского центра');
assertBuilds({ type: 'O06', params: { side: 'HOIST', baseLength: 400, depth: 600, apexPosition: 0.3, tipWidth: 200 } },
  'O06 принимает граничные значения основания, глубины, вершины и усечения');
assertBuilds({ type: 'O06', params: { side: 'HOIST', baseLength: 400, depth: 600, truncated: true } },
  'O06 поддерживает явный вариант с усечённой вершиной');
assertBuilds({ type: 'O08', params: { square: true, width: 360 } }, 'O08 поддерживает квадратный кантон');
for (const params of [
  { n_saltire: 1, n_cross: 0 },
  { n_saltire: 2, n_cross: 0, second_saltire_ratio: 0.5 },
  { n_saltire: 1, n_cross: 2, second_cross_ratio: 0.4 },
  { n_saltire: 2, n_cross: 2, second_saltire_ratio: 0.3, second_cross_ratio: 0.7 },
]) {
  assertBuilds({ type: 'O09', params }, 'O09 поддерживает все граничные сочетания числа прямых и косых крестов');
}

const outlineTriangle = [[
  { x: 30, y: 20 }, { x: 1230, y: 20 }, { x: 630, y: 820 },
]];
const clipped = buildFlagOrdinaryLayers(
  [{ type: 'O01', params: { thickness: 160 }, fimbration: { delta: 40, fill: 's3' } }],
  frame,
  { canvasHeight: height, clipChain: [outlineTriangle] },
);
assert.equal(clipped.paintLayers.length, 2, 'фимбриация образует отдельный нижний слой отрисовки');
assert.equal(clipped.paintLayers[0].part, 'fimbration');
assert.equal(clipped.paintLayers[1].part, 'main');
assert.ok(flagPolygonSetArea(clipped.paintLayers[0].polygons) > flagPolygonSetArea(clipped.paintLayers[1].polygons),
  'фимбриация шире окружаемой фигуры');
assert.ok(clipped.paintLayers.every(({ clipChain }) => clipChain.length === 1),
  'слои ординария сохраняют унаследованную цепочку обрезки по контуру');
assert.ok(flagPolygonSetArea(clipped.paintLayers[0].polygons) < 1200 * 800,
  'геометрия ординария обрезана по контуру флага');
const insideTriangle = ({ x, y }) => {
  const vertices = outlineTriangle[0];
  const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const signs = vertices.map((vertex, index) => cross(vertex, vertices[(index + 1) % vertices.length], { x, y }));
  return signs.every((value) => value >= -1e-6) || signs.every((value) => value <= 1e-6);
};
assert.ok(clipped.paintLayers.every(({ polygons }) => polygons.flat().every(insideTriangle)),
  'каждая точка отрисовки остаётся внутри непрямоугольного контура');
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01', params: { thickness: 99 } },
], frame, { canvasHeight: height }), /cross thickness/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01', fimbration: { delta: 29, fill: 's3' } },
], frame, { canvasHeight: height }), /fimbration.delta/);

const nestedCanton = buildFlagOrdinaryLayers([{
  type: 'O08',
  fill: 's2',
  params: {
    corner: 'HOIST_TOP',
    width: 400,
    height: 300,
    field: { op: 'G02', params: { axis: 'H', n: 2 } },
  },
  children: [{ type: 'O01', params: { thickness: 100, arms: 'COUPED', halfLength: 90 } }],
}], frame, { canvasHeight: height });
assert.equal(nestedCanton.cantonCount, 1);
assert.equal(nestedCanton.ordinaryCount, 2, 'содержимое кантона учитывается в общем лимите ординариев флага');
assert.ok(Math.abs(nestedCanton.totalCost - 2.47) < 1e-9,
  'стоимость кантона равна 1 + 0,7 стоимости вложенных поля и ординария');
assert.equal(nestedCanton.paintLayers[0].kind, 'canton');
assert.ok(nestedCanton.paintLayers.some(({ kind }) => kind === 'ground'), 'кантон содержит вложенное поле');
assert.ok(nestedCanton.paintLayers.some(({ kind, depth }) => kind === 'ordinary' && depth === 2),
  'кантон содержит вложенный ординарий на следующем уровне рамки');
assert.ok(nestedCanton.paintLayers.filter(({ depth }) => depth === 2).every(({ clipChain }) => clipChain.length === 1),
  'вложенные слои кантона обрезаны по его границе');

const union = buildFlagOrdinaryLayers([{
  type: 'O09',
  params: {
    n_saltire: 2,
    n_cross: 2,
    thickness: 200,
    second_saltire_ratio: 0.4,
    second_cross_ratio: 0.5,
    fimbration_saltire: { delta: 30, fill: 's4' },
    fimbration_saltire_2: { delta: 60, fill: 's5' },
    pinwheel: true,
    pinwheel_shift: 0.25,
  },
}], frame, { canvasHeight: height, clipChain: [outlineTriangle], random: seededRandom(175) });
assert.equal(union.ordinaryCount, 1, 'макрооператор O09 считается одним ординарием');
assert.ok(union.paintLayers.some(({ part }) => part === 'fimbration'));
const pinwheelSaltireHalves = union.paintLayers.filter(({ id, part }) =>
  id.includes('saltire-2') && part === 'main');
assert.equal(pinwheelSaltireHalves.length, 2, 'второй косой крест разделён на две части «вертушка»');
assert.ok(pinwheelSaltireHalves.every(({ clipChain }) => clipChain.length === 2),
  'части косого креста «вертушка» сохраняют унаследованную обрезку по контуру');
assert.ok(union.paintLayers.filter(({ operator }) => operator === 'O01').every(({ clipChain }) => clipChain.length === 1),
  'кресты остаются целыми слоями поверх косого креста «вертушка»');
assert.ok(union.paintLayers.some(({ id }) => id === 'o09-1-saltire-2-fimbration'),
  'каждый косой крест в объединённом мотиве может иметь отдельную фимбриацию');
assert.ok(union.paintLayers.every(({ polygons }) => polygons.flat().every(({ x, y }) =>
  Number.isFinite(x) && Number.isFinite(y))));
assert.throws(() => buildFlagOrdinaryLayers([{
  type: 'O09',
  params: { n_saltire: 1, n_cross: 1, field_fill: 's1', saltire_fill: 's2', cross_fill: 's1' },
}], frame), /three distinct color slots/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01', params: { thickness: 200, center: { u: 0.4, v: 0.5 } } },
  { type: 'O01', params: { thickness: 100, center: { u: 0.6, v: 0.5 } } },
], frame), /common center/, 'построитель отклоняет пару, не являющуюся двойным крестом');

assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O08' }, { type: 'O08' },
], frame), /ordinary count|canton count/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O07' }, { type: 'O07' },
], frame), /bordure count/);
assert.throws(() => buildFlagOrdinaryLayers([
  { type: 'O01' }, { type: 'O02' }, { type: 'O03' }, { type: 'O04' },
], frame), /ordinary count/);
for (const [type, cost] of [
  ['O01', 1], ['O02', 1], ['O03', 0.7], ['O04', 1], ['O05', 1.5],
  ['O06', 1], ['O07', 1.2], ['O08', 1], ['O09', 3],
]) {
  assert.equal(buildFlagOrdinaryLayers([{ type }], frame).totalCost, cost, `${type} использует стоимость из §14.5`);
}
assert.equal(buildFlagOrdinaryLayers([{ type: 'O07', params: { variant: 'DOUBLE' } }], frame).totalCost, 1.7,
  'двойная бордюра добавляет предусмотренную надбавку 0,5');
assert.equal(buildFlagOrdinaryLayers([{ type: 'O01', cost: 7 }], frame).totalCost, 7,
  'модуль не подменяет профильный CMAX выдуманным общим пределом');
assert.throws(() => buildFlagOrdinaryLayers([{ type: 'O01', cost: -1 }], frame), /cannot be negative/);
assert.equal(buildFlagOrdinaryLayers([{
  type: 'O01', fill: { pattern: { type: 'STRIPES' } },
}], frame).totalCost, 2, 'узорная заливка добавляет предусмотренную стоимость 1');

const doubleCrosses = [
  { type: 'O01', params: { thickness: 200, center: { u: 0.36, v: 0.5 } } },
  { type: 'O01', params: { thickness: 100, center: { u: 0.36, v: 0.5 } } },
];
assert.deepEqual(validateFlagOrdinaries(doubleCrosses, frame), [],
  'два креста с общим центром и заданным отношением толщин проходят проверку');
assert.ok(validateFlagOrdinaries([
  doubleCrosses[0],
  { ...doubleCrosses[1], params: { thickness: 100, center: { u: 0.5, v: 0.5 } } },
], frame).some(({ message }) => message.includes('common center')));
assert.ok(validateFlagOrdinaries([
  doubleCrosses[0],
  { ...doubleCrosses[1], params: { thickness: 50, center: { u: 0.36, v: 0.5 } } },
], frame).some(({ message }) => message.includes('thickness ratio')));

const styledBorder = buildFlagOrdinaryLayers([{
  type: 'O07',
  params: {
    variant: 'ORLE',
    thickness: 75,
    gap: 24,
    line_style: { type: 'DANCETTY', amplitude: 30, period: 200 },
  },
}], frame, { canvasHeight: height });
assert.ok(styledBorder.paintLayers[0].polygons.some((polygon) => polygon.length > 4),
  'bordure applies its configured line style to the inner edge');
for (const thickness of [height / 32, height / 7]) {
  const border = buildFlagOrdinaryLayers([{
    type: 'O07',
    params: { variant: 'PLAIN', thickness },
  }], frame, { canvasHeight: height });
  assert.ok(border.paintLayers[0].polygons.length > 0,
    `bordure accepts the specified thickness endpoint ${thickness}`);
}
for (const thickness of [height / 16, height / 8]) {
  const border = buildFlagOrdinaryLayers([{
    type: 'O07',
    params: { variant: 'CHECKY', thickness },
  }], frame, { canvasHeight: height });
  assert.ok(border.paintLayers.every((layer) => layer.polygons.length > 0),
    `CHECKY accepts its specified thickness endpoint ${thickness}`);
}
const checkeredBorder = buildFlagOrdinaryLayers([{
  type: 'O07',
  fill: 's2',
  params: { variant: 'CHECKY', thickness: 75, cellSize: 75, secondary_fill: 's3' },
}], frame, { canvasHeight: height });
assert.deepEqual(checkeredBorder.paintLayers.map(({ fill }) => fill), ['s2', 's3'],
  'бордюра CHECKY чередует клетки двух цветовых слотов');
assert.ok(checkeredBorder.paintLayers.every(({ polygons }) => polygons.length > 0));
assert.ok(checkeredBorder.paintLayers.every(({ polygons }) =>
  polygons.every((polygon) => polygon.length === 4)),
'Прямоугольная CHECKY-бордюра сохраняет клетки без триангуляционных осколков');
assert.throws(() => buildFlagOrdinaryLayers([{
  type: 'O07',
  params: { variant: 'CHECKY', thickness: 75, cellSize: 150 },
}], frame, { canvasHeight: height }), /размер клетки CHECKY/,
'бордюра CHECKY отклоняет размер клетки, отличный от толщины');
assert.ok(validateFlagOrdinaries([{ type: 'O07', params: { variant: 'ORLE', gap: 19 } }], frame)
  .some(({ message }) => message.includes('G_MIN')));
assert.ok(validateFlagOrdinaries([{ type: 'O07', params: { variant: 'ORLE', gap: 61 } }], frame)
  .some(({ message }) => message.includes('configured maximum')));
assertBuilds({ type: 'O07', params: { variant: 'DOUBLE', thickness: 75, gap: 100 } },
  'двойная бордюра принимает зазор больше предельного зазора ORLE');

console.log('Геометрия O01–O09, фимбриация, обрезка, кантоны, объединённые мотивы и ограничения композиции проверены.');
