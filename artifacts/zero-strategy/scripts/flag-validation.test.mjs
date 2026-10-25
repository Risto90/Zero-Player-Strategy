import assert from 'node:assert/strict';
import { rasterizeFlagReference } from '../game/flagReferenceRaster.js';
import { validateFlag } from '../game/flagValidation.js';

const width = 360;
const height = 240;
const colors = { white: '#ffffff', red: '#ce1126', black: '#111111' };

function makeFixture() {
  const raster = rasterizeFlagReference(width, height, [
    { id: 'L1-ground-field', color: colors.white, shapes: [{ type: 'rect', x: 0, y: 0, width, height }] },
    { id: 'L2-ordinary-stripe', color: colors.red, shapes: [{ type: 'rect', x: 144, y: 0, width: 72, height }] },
  ]);
  const slotValues = raster.colors.map((color) => color === colors.red ? 's2' : 's1');
  const square = [
    { x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 },
  ];
  const compositionMask = new Uint8Array(64 * 64);
  for (let y = 0; y < 64; y += 1) for (let x = 24; x < 40; x += 1) compositionMask[y * 64 + x] = 1;
  return {
    spec: {
      generator_version: 'test',
      seed: 'validator-fixture',
      profile_id: 'P04',
      era: 2,
      tags: [],
      outline: { type: 'RECT', params: {}, aspect: 1.5, safe_area: { margin: 40 } },
      slots: { items: ['s1', 's2'], equalities: [] },
      palette: {
        s1: { color_id: 'white', hex: colors.white },
        s2: { color_id: 'red', hex: colors.red },
      },
      root: {
        x0: 0, y0: 0, w: 1, h: 1, clip: [],
        ground: { kind: 'fill', fill: 's1' },
        layers: [],
      },
      meta: {
        complexity: 4, symmetry: 'NONE', color_count: 2,
        structure_hash: 'test-structure', visual_hash: 'test-visual',
      },
    },
    evidence: {
      raster,
      layers: [
        { id: 'L1-ground-field', role: 'ground', overlayWith: ['L2-ordinary-stripe'] },
        { id: 'L2-ordinary-stripe', role: 'ordinary' },
      ],
      safeAreaMask: new Uint8Array(width * height).fill(1),
      slotRaster: { values: slotValues, width, height, pixelSize: 5 },
      primitiveCount: 2,
      pathPointCount: 8,
      paths: [{ points: square, closed: true }],
      catalogIds: [],
      compositionMask,
      outlineFeatures: [],
      svg: '<svg viewBox="0 0 1800 1200"><g id="L1-ground-field"><rect x="0" y="0" width="1800" height="1200" fill="#ffffff"/></g><g id="L2-ordinary-stripe"><rect x="720" y="0" width="360" height="1200" fill="#ce1126"/></g></svg>',
    },
  };
}

const fixture = makeFixture();
const validReport = validateFlag(fixture.spec, fixture.evidence);
assert.deepEqual(Object.keys(validReport.checks), Array.from({ length: 16 }, (_, index) => `V${String(index + 1).padStart(2, '0')}`));
assert.equal(validReport.passed, true, JSON.stringify(validReport.checks, null, 2));
assert.equal(fixture.spec.meta.symmetry_actual, validReport.checks.V10.value.actual);
for (const [rule, result] of Object.entries(validReport.checks)) {
  assert.equal(result.passed, true, `${rule}: корректный синтетический флаг должен пройти проверку`);
  assert.notEqual(result.value, null, `${rule}: необходимо вернуть измеренное значение`);
}

function expectFailure(rule, mutate, message) {
  const invalid = structuredClone(fixture);
  mutate(invalid);
  const report = validateFlag(invalid.spec, invalid.evidence);
  assert.equal(report.checks[rule].passed, false, `${rule}: ${message}`);
  assert.notEqual(report.checks[rule].value, null, `${rule}: необходимо вернуть измерение с нарушением`);
}

function makeChiralC4Mask() {
  const mask = new Uint8Array(64 * 64);
  for (const [startX, startY] of [[40, 24], [43, 27], [37, 30]]) {
    let x = startX, y = startY;
    for (let turn = 0; turn < 4; turn += 1) {
      mask[y * 64 + x] = 1;
      [x, y] = [63 - y, x];
    }
  }
  return mask;
}

expectFailure('V01', ({ evidence }) => { evidence.primitiveCount = 121; }, 'превышен предел числа примитивов');
expectFailure('V02', ({ evidence }) => {
  evidence.raster.colors[10 * width + 10] = colors.black;
}, 'запрещён крошечный компонент');
expectFailure('V02', ({ evidence }) => {
  evidence.layers[0].tags = ['glyph'];
  for (let y = 10; y < 14; y += 1) for (let x = 10; x < 14; x += 1) {
    const index = y * width + x;
    evidence.raster.colors[index] = colors.black;
    evidence.raster.layerIds[index] = 'L1-ground-field';
  }
}, 'деталь глифа уже минимальной толщины');
expectFailure('V03', ({ evidence }) => {
  for (let y = 3; y < height; y += 3) {
    for (let x = 144; x < 216; x += 1) evidence.raster.colors[y * width + x] = colors.white;
  }
}, 'замыкание не должно заполнять множество узких щелей');
expectFailure('V04', ({ evidence }) => {
  for (let y = 20; y < 200; y += 1) for (let x = 2; x < 5; x += 1) {
    evidence.raster.colors[y * width + x] = colors.black;
  }
}, 'деталь, видимая при 240 пикселях, исчезает при 32 пикселях');
expectFailure('V05', ({ evidence }) => {
  for (let y = 0; y < height; y += 1) for (let x = 144; x < 216; x += 1) {
    evidence.raster.colors[y * width + x] = '#fefeff';
  }
}, 'контраст смежных областей недостаточен в итоговом растре');
expectFailure('V05', ({ evidence }) => { evidence.layers[1].role = 'charge'; }, 'для заряда не задана пара с цветом фона');
expectFailure('V06', ({ evidence }) => {
  evidence.raster.colors.fill(colors.white);
  evidence.slotRaster.values.fill('s1');
  for (let y = 0; y < height; y += 1) for (let x = 260; x < 332; x += 1) {
    evidence.raster.colors[y * width + x] = colors.red;
    evidence.slotRaster.values[y * width + x] = 's2';
  }
}, 'центр масс цветов находится вне BAL');
expectFailure('V07', ({ evidence }) => {
  evidence.raster.colors.fill(colors.red);
  evidence.slotRaster.values.fill('s2');
}, 'один цвет занимает весь флаг');
expectFailure('V08', ({ evidence }) => { evidence.layers[0].overlayWith = []; }, 'наложение слоёв не объявлено');
expectFailure('V09', ({ evidence }) => {
  evidence.layers[1].role = 'charge';
  for (let y = 0; y < height; y += 1) for (let x = 144; x < 216; x += 1) {
    evidence.safeAreaMask[y * width + x] = 0;
  }
}, 'заряд выходит за безопасную область');
expectFailure('V10', ({ spec, evidence }) => {
  spec.meta.symmetry = 'MIR_H';
  evidence.raster.colors.fill(colors.white);
  evidence.slotRaster.values.fill('s1');
  for (let y = 0; y < height; y += 1) for (let x = 260; x < 332; x += 1) {
    evidence.raster.colors[y * width + x] = colors.red;
    evidence.slotRaster.values[y * width + x] = 's2';
  }
}, 'заявленная зеркальная симметрия отсутствует');
expectFailure('V11', ({ spec }) => { spec.tags = ['islamic']; }, 'тег не разрешён выбранным профилем');
expectFailure('V12', ({ evidence }) => { evidence.catalogIds = ['NOT_IN_CATALOG']; }, 'эмблема отсутствует в каталоге');
expectFailure('V12', ({ evidence }) => { evidence.compositionMask = makeChiralC4Mask(); }, 'обнаружена хиральная C4-симметрия');
expectFailure('V13', ({ spec }) => {
  spec.slots.items.push('s3');
  spec.palette.s3 = { color_id: 'gold', hex: '#fcd116' };
}, 'объявленный цвет палитры не используется');
expectFailure('V14', ({ evidence }) => {
  evidence.paths = [{ points: [{ x: 0, y: 0 }, { x: 100, y: 1 }, { x: 200, y: 0 }], closed: true }];
}, 'у многоугольника есть острый угол');
expectFailure('V15', ({ evidence }) => {
  evidence.svg = evidence.svg.replace('</svg>', '<script></script></svg>');
}, 'элемент SVG отсутствует в списке разрешённых');
expectFailure('V15', ({ evidence }) => {
  evidence.svg = evidence.svg.replace('width="1800"', 'width="2000"');
}, 'геометрия SVG выходит за допустимые координаты');
expectFailure('V16', ({ spec, evidence }) => {
  spec.outline.params.edge = { count: 7 };
  evidence.outlineFeatures = [{ type: 'tooth', minimumWidthPx: 3 }];
}, 'деталь контура тоньше T_MIN');

const rasterRepeat = rasterizeFlagReference(8, 8, [
  { id: 'base', color: colors.white, shapes: [{ type: 'rect', x: 0, y: 0, width: 8, height: 8 }] },
  { id: 'circle', color: colors.red, shapes: [{ type: 'circle', cx: 4, cy: 4, radius: 2 }] },
]);
assert.deepEqual(rasterRepeat.colors, rasterizeFlagReference(8, 8, [
  { id: 'base', color: colors.white, shapes: [{ type: 'rect', x: 0, y: 0, width: 8, height: 8 }] },
  { id: 'circle', color: colors.red, shapes: [{ type: 'circle', cx: 4, cy: 4, radius: 2 }] },
]).colors, 'растеризация эталонной геометрии детерминирована');
assert.equal(rasterRepeat.layerMasks.circle.length, 64);

console.log('Отчёт валидатора и синтетические проходящие/нарушающие примеры V01–V16 проверены.');
