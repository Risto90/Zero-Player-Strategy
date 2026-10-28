import assert from 'node:assert/strict';
import { rasterizeFlagPolygonMask, rasterizeFlagReference } from '../game/flagReferenceRaster.js';
import { morphologyMask, morphologySequenceMask } from '../game/flagMorphology.js';
import { componentsByColor, validateFlag } from '../game/flagValidation.js';

function referencePolygonContains(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return points.length >= 3 && inside;
}

function referenceContains(shape, x, y) {
  if (shape.type === 'circle') return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.radius ** 2;
  if (shape.type === 'ring') {
    const distanceSquared = (x - shape.cx) ** 2 + (y - shape.cy) ** 2;
    return distanceSquared <= shape.outerRadius ** 2 && distanceSquared >= shape.innerRadius ** 2;
  }
  if (shape.type === 'rect') return x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height;
  if (shape.type === 'multipolygon') {
    return shape.polygons.some((points) => referencePolygonContains(points, x, y));
  }
  return referencePolygonContains(shape.points, x, y);
}

let rasterSeed = 0x71a57e;
const rasterRandom = () => {
  rasterSeed = (rasterSeed * 1664525 + 1013904223) >>> 0;
  return rasterSeed / 0x1_0000_0000;
};
const rasterRange = (min, max) => min + rasterRandom() * (max - min);
for (let sample = 0; sample < 120; sample += 1) {
  const rasterWidth = 1 + Math.floor(rasterRandom() * 19);
  const rasterHeight = 1 + Math.floor(rasterRandom() * 17);
  const layers = Array.from({ length: 3 }, (_, layerIndex) => ({
    id: `R${layerIndex}`,
    color: ['#ffffff', '#ce1126', '#112233'][layerIndex],
    shapes: Array.from({ length: Math.floor(rasterRandom() * 4) }, () => {
      const type = ['circle', 'ring', 'rect', 'polygon', 'multipolygon'][Math.floor(rasterRandom() * 5)];
      if (type === 'circle') return {
        type, cx: rasterRange(-2, rasterWidth + 2), cy: rasterRange(-2, rasterHeight + 2), radius: rasterRange(0, 5),
      };
      if (type === 'ring') {
        const innerRadius = rasterRange(0, 3);
        return {
          type, cx: rasterRange(-2, rasterWidth + 2), cy: rasterRange(-2, rasterHeight + 2),
          innerRadius, outerRadius: innerRadius + rasterRange(0.1, 3),
        };
      }
      if (type === 'rect') return {
        type, x: rasterRange(-2, rasterWidth + 1), y: rasterRange(-2, rasterHeight + 1),
        width: rasterRange(0, 5), height: rasterRange(0, 5),
      };
      if (type === 'multipolygon') {
        const count = 2 + Math.floor(rasterRandom() * 3);
        return {
          type,
          polygons: Array.from({ length: count }, (_, polygonIndex) => {
            const bandHeight = rasterHeight / count;
            return Array.from({ length: 3 + Math.floor(rasterRandom() * 3) }, () => ({
              x: rasterRange(-2, rasterWidth + 2),
              y: rasterRange(bandHeight * polygonIndex - 1, bandHeight * (polygonIndex + 1) + 1),
            }));
          }),
        };
      }
      return {
        type,
        points: Array.from({ length: 3 + Math.floor(rasterRandom() * 3) }, () => ({
          x: rasterRange(-2, rasterWidth + 2), y: rasterRange(-2, rasterHeight + 2),
        })),
      };
    }),
  }));
  const expectedColors = Array(rasterWidth * rasterHeight).fill(null);
  const expectedLayerIds = Array(rasterWidth * rasterHeight).fill(null);
  const expectedMasks = {};
  const expectedAreas = {};
  const expectedBounds = {};
  for (const layer of layers) {
    const mask = new Uint8Array(rasterWidth * rasterHeight);
    let area = 0, minX = rasterWidth, minY = rasterHeight, maxX = -1, maxY = -1;
    for (const shape of layer.shapes) {
      if (shape.type === 'polygon' && shape.points.length < 3) continue;
      for (let y = 0; y < rasterHeight; y += 1) for (let x = 0; x < rasterWidth; x += 1) {
        if (!referenceContains(shape, x + 0.5, y + 0.5)) continue;
        const index = y * rasterWidth + x;
        if (!mask[index]) {
          area += 1;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        mask[index] = 1;
        expectedColors[index] = layer.color;
        expectedLayerIds[index] = layer.id;
      }
    }
    expectedMasks[layer.id] = mask;
    expectedAreas[layer.id] = area;
    expectedBounds[layer.id] = maxX < minX ? null : { minX, minY, maxX, maxY };
  }
  const raster = rasterizeFlagReference(rasterWidth, rasterHeight, layers);
  assert.deepEqual(raster.colors, expectedColors, `растер цветов совпадает с прямой проверкой, пример ${sample}`);
  assert.deepEqual(raster.layerIds, expectedLayerIds, `верхний слой совпадает с прямой проверкой, пример ${sample}`);
  assert.deepEqual(raster.layerMasks, expectedMasks, `маски слоёв совпадают с прямой проверкой, пример ${sample}`);
  assert.deepEqual(raster.layerAreas, expectedAreas, `площади слоёв совпадают с прямой проверкой, пример ${sample}`);
  assert.deepEqual(raster.layerBounds, expectedBounds, `границы слоёв совпадают с прямой проверкой, пример ${sample}`);
  const withoutLayerMasks = rasterizeFlagReference(rasterWidth, rasterHeight, layers, { includeLayerMasks: false });
  assert.deepEqual(withoutLayerMasks.layerAreas, expectedAreas, `площади без сохранения масок совпадают, пример ${sample}`);
  assert.deepEqual(withoutLayerMasks.layerBounds, expectedBounds, `границы без сохранения масок совпадают, пример ${sample}`);
}

const componentNeighbors4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const componentNeighbors8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
function referenceColorComponents(raster, width, height, neighbors) {
  const colorIds = raster.colorIds;
  const seen = new Uint8Array(width * height);
  const result = [];
  for (let start = 0; start < colorIds.length; start += 1) {
    const colorId = colorIds[start];
    if (!colorId || seen[start]) continue;
    const indices = [start];
    const layerIds = new Set();
    seen[start] = 1;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let head = 0; head < indices.length; head += 1) {
      const current = indices[head];
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const layerIndex = raster.layerIdIndices?.[current];
      const layerId = layerIndex
        ? raster.layerIdPalette[layerIndex - 1]
        : raster.layerIds[current];
      if (layerId) layerIds.add(layerId);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (colorIds[next] === colorId && !seen[next]) {
          seen[next] = 1;
          indices.push(next);
        }
      }
    }
    result.push({
      color: raster.colorPalette[colorId - 1],
      indices: indices.sort((a, b) => a - b),
      layerIds: [...layerIds].sort(),
      area: indices.length,
      minX, minY, maxX, maxY,
    });
  }
  return result;
}

function normalizeColorComponents(components) {
  return components.map((component) => ({
    color: component.color,
    indices: Array.from(component.indices).sort((a, b) => a - b),
    layerIds: [...component.layerIds].sort(),
    area: component.area,
    minX: component.minX,
    minY: component.minY,
    maxX: component.maxX,
    maxY: component.maxY,
  }));
}

let componentSeed = 0x2c6f91;
const componentRandom = () => {
  componentSeed = (componentSeed * 1664525 + 1013904223) >>> 0;
  return componentSeed / 0x1_0000_0000;
};
for (let sample = 0; sample < 200; sample += 1) {
  const width = 1 + Math.floor(componentRandom() * 37);
  const height = 1 + Math.floor(componentRandom() * 31);
  const colorIds = Uint8Array.from({ length: width * height }, () =>
    componentRandom() < 0.24 ? 0 : 1 + Math.floor(componentRandom() * 3));
  const layerIdPalette = ['L1', 'L2', 'L3', 'L4'];
  const layerIdIndices = Uint8Array.from({ length: width * height }, () =>
    componentRandom() < 0.18 ? 0 : 1 + Math.floor(componentRandom() * layerIdPalette.length));
  const colorPalette = ['#ffffff', '#ce1126', '#112233'];
  const raster = {
    width,
    height,
    colors: Array.from(colorIds, (id) => id ? colorPalette[id - 1] : null),
    layerIds: Array.from(layerIdIndices, (id) => id ? layerIdPalette[id - 1] : null),
    layerMasks: {},
    colorIds,
    colorPalette,
    ...(sample % 2 ? { layerIdIndices, layerIdPalette } : {}),
  };
  for (const neighbors of [componentNeighbors4, componentNeighbors8]) {
    assert.deepEqual(
      normalizeColorComponents(componentsByColor(raster, width, height, neighbors)),
      referenceColorComponents(raster, width, height, neighbors),
      `Цветовые компоненты совпадают с обходом по пикселям, выборка ${sample}, соседство ${neighbors.length}`,
    );
  }
}

const diagonalComponentRaster = {
  width: 2,
  height: 2,
  colors: ['#ffffff', null, null, '#ffffff'],
  layerIds: ['L1', null, null, 'L2'],
  layerMasks: {},
  colorIds: Uint8Array.from([1, 0, 0, 1]),
  colorPalette: ['#ffffff'],
};
assert.equal(componentsByColor(diagonalComponentRaster, 2, 2, componentNeighbors4).length, 2);
assert.equal(componentsByColor(diagonalComponentRaster, 2, 2, componentNeighbors8).length, 1);

function referenceMorphology(mask, width, height, radius, operation) {
  const result = new Uint8Array(width * height);
  const radiusSquared = radius * radius;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let value = operation === 'dilate' ? false : true;
    for (let dy = -Math.floor(radius); dy <= Math.floor(radius); dy += 1) {
      for (let dx = -Math.floor(radius); dx <= Math.floor(radius); dx += 1) {
        if (dx * dx + dy * dy > radiusSquared) continue;
        const sourceX = x + dx, sourceY = y + dy;
        const source = sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height
          ? !!mask[sourceY * width + sourceX]
          : false;
        if (operation === 'dilate' && source) { value = true; break; }
        if (operation === 'erode' && !source) { value = false; break; }
      }
      if (operation === 'dilate' && value || operation === 'erode' && !value) break;
    }
    result[y * width + x] = Number(value);
  }
  return result;
}

let morphologySeed = 0x5eed;
const morphologyRandom = () => {
  morphologySeed = (morphologySeed * 1664525 + 1013904223) >>> 0;
  return morphologySeed / 0x1_0000_0000;
};
for (const width of [1, 7, 31, 32, 33, 67]) for (const height of [1, 2, 7]) {
  const mask = Uint8Array.from({ length: width * height }, () => Number(morphologyRandom() > 0.55));
  for (const radius of [0, 1, 2, 3, 5]) for (const operation of ['dilate', 'erode']) {
    assert.deepEqual(
      morphologyMask(mask, width, height, radius, operation),
      referenceMorphology(mask, width, height, radius, operation),
    );
  }
  for (const radius of [0, 1, 2, 3, 5]) {
    for (const operations of [['erode', 'dilate'], ['dilate', 'erode']]) {
      const expected = operations.reduce(
        (current, operation) => morphologyMask(current, width, height, radius, operation),
        mask,
      );
      assert.deepEqual(
        morphologySequenceMask(mask, width, height, radius, operations),
        expected,
        'Последовательная морфология должна совпадать с двумя отдельными проходами',
      );
    }
  }
}

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
      expectedEmblemMaskCount: 0,
      compositionMask,
      outlineFeatures: [],
      svg: '<svg viewBox="0 0 1800 1200"><g id="L1-ground-field"><rect x="0" y="0" width="1800" height="1200" fill="#ffffff"/></g><g id="L2-ordinary-stripe"><rect x="720" y="0" width="360" height="1200" fill="#ce1126"/></g></svg>',
    },
  };
}

function setRasterColor(raster, index, color) {
  raster.colors[index] = color;
  if (!raster.colorIds || !raster.colorPalette) return;
  if (!color) {
    raster.colorIds[index] = 0;
    return;
  }
  const normalized = color.toLowerCase();
  let paletteIndex = raster.colorPalette.indexOf(normalized);
  if (paletteIndex < 0) {
    raster.colorPalette.push(normalized);
    paletteIndex = raster.colorPalette.length - 1;
  }
  raster.colorIds[index] = paletteIndex + 1;
}

function fillRasterColor(raster, color) {
  raster.colors.fill(color);
  if (!raster.colorIds) return;
  if (!color || !raster.colorPalette) {
    raster.colorIds.fill(0);
    return;
  }
  const normalized = color.toLowerCase();
  let paletteIndex = raster.colorPalette.indexOf(normalized);
  if (paletteIndex < 0) {
    raster.colorPalette.push(normalized);
    paletteIndex = raster.colorPalette.length - 1;
  }
  raster.colorIds.fill(paletteIndex + 1);
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

const validShortCircuitReport = validateFlag(fixture.spec, fixture.evidence, { stopAfterFirstFailure: true });
assert.equal(validShortCircuitReport.passed, true, 'режим ранней остановки должен пройти полный набор корректных проверок');
assert.deepEqual(Object.keys(validShortCircuitReport.checks), Object.keys(validReport.checks));
const invalidEarlyExit = structuredClone(fixture);
invalidEarlyExit.evidence.primitiveCount = 121;
const earlyExitReport = validateFlag(invalidEarlyExit.spec, invalidEarlyExit.evidence, { stopAfterFirstFailure: true });
assert.equal(earlyExitReport.passed, false, 'режим ранней остановки должен отклонить нарушающий кандидат');
assert.deepEqual(Object.keys(earlyExitReport.checks), ['V01'], 'после первого нарушения не должны выполняться дорогие проверки');
const multipleTinyComponents = structuredClone(fixture);
setRasterColor(multipleTinyComponents.evidence.raster, 10 * width + 10, colors.black);
setRasterColor(multipleTinyComponents.evidence.raster, 30 * width + 30, colors.black);
const earlyV02Report = validateFlag(
  multipleTinyComponents.spec,
  multipleTinyComponents.evidence,
  { stopAfterFirstFailure: true },
);
assert.equal(earlyV02Report.passed, false, 'ранняя остановка должна отклонять V02');
assert.deepEqual(Object.keys(earlyV02Report.checks), ['V01', 'V02']);
assert.equal(earlyV02Report.checks.V02.details.length, 1,
  'генераторный режим не должен тратить время на остальные компоненты после первого нарушения');

const selectedRulesReport = validateFlag(fixture.spec, fixture.evidence, { onlyRules: ['V05'] });
assert.deepEqual(Object.keys(selectedRulesReport.checks), ['V02', 'V03', 'V05', 'V08', 'V14']);
assert.equal(selectedRulesReport.passed, true, 'частичная проверка запускает только выбранное правило и обязательные проверки композиции');
const coarsePreflightReport = validateFlag(fixture.spec, fixture.evidence, {
  onlyRules: ['V08', 'V14'],
  skipRules: ['V02', 'V03'],
});
assert.equal(coarsePreflightReport.checks.V02, undefined, 'низкоразрешающий этап может отложить V02 до полного растра');
assert.equal(coarsePreflightReport.checks.V03, undefined, 'низкоразрешающий этап может отложить V03 до полного растра');
assert.ok(coarsePreflightReport.checks.V08 && coarsePreflightReport.checks.V14,
  'остальные проверки композиции сохраняются на предварительном этапе');

const scheduledRemoval = structuredClone(fixture);
const tinyLayerId = 'L3-scheduled-for-removal';
const tinyIndex = 10 * width + 10;
const tinyMask = new Uint8Array(width * height);
tinyMask[tinyIndex] = 1;
scheduledRemoval.evidence.layers.push({ id: tinyLayerId, role: 'ordinary' });
scheduledRemoval.evidence.raster.layerMasks[tinyLayerId] = tinyMask;
scheduledRemoval.evidence.raster.layerAreas[tinyLayerId] = 1;
scheduledRemoval.evidence.raster.layerBounds[tinyLayerId] = {
  minX: 10, minY: 10, maxX: 10, maxY: 10,
};
scheduledRemoval.evidence.raster.layerIds[tinyIndex] = tinyLayerId;
let tinyPaletteIndex = scheduledRemoval.evidence.raster.layerIdPalette.indexOf(tinyLayerId);
if (tinyPaletteIndex < 0) {
  scheduledRemoval.evidence.raster.layerIdPalette.push(tinyLayerId);
  tinyPaletteIndex = scheduledRemoval.evidence.raster.layerIdPalette.length - 1;
}
scheduledRemoval.evidence.raster.layerIdIndices[tinyIndex] = tinyPaletteIndex + 1;
setRasterColor(scheduledRemoval.evidence.raster, tinyIndex, colors.black);
assert.equal(validateFlag(scheduledRemoval.spec, scheduledRemoval.evidence, {
  onlyRules: ['V02'],
}).passed, false, 'микрослой до удаления не должен проходить V02');
assert.equal(validateFlag(scheduledRemoval.spec, scheduledRemoval.evidence, {
  onlyRules: ['V02'],
  ignoreLayerIds: [tinyLayerId],
}).passed, true, 'слой, который будет удалён на S7, исключён из локальной проверки V02');

const ignoredCollision = structuredClone(fixture);
ignoredCollision.evidence.layers[0].role = 'charge';
ignoredCollision.evidence.layers[0].anchor = 'A5';
ignoredCollision.evidence.layers[0].overlayWith = [];
assert.equal(validateFlag(ignoredCollision.spec, ignoredCollision.evidence, {
  onlyRules: ['V08'],
}).passed, false, 'заряд и ординарий без разрешённого наложения должны нарушать V08');
assert.equal(validateFlag(ignoredCollision.spec, ignoredCollision.evidence, {
  onlyRules: ['V08'],
  ignoreLayerIds: ['L1-ground-field'],
}).passed, true, 'слой, который будет удалён на S7, исключён из локальной проверки V08');

const diagonalJoin = structuredClone(fixture);
const detachedIndex = 20 * width + 143;
const removedIndex = 20 * width + 144;
setRasterColor(diagonalJoin.evidence.raster, detachedIndex, colors.red);
diagonalJoin.evidence.raster.layerIds[detachedIndex] = 'L2-ordinary-stripe';
diagonalJoin.evidence.raster.layerMasks['L2-ordinary-stripe'][detachedIndex] = 1;
diagonalJoin.evidence.raster.layerMasks['L1-ground-field'][detachedIndex] = 0;
setRasterColor(diagonalJoin.evidence.raster, removedIndex, colors.white);
diagonalJoin.evidence.raster.layerIds[removedIndex] = 'L1-ground-field';
diagonalJoin.evidence.raster.layerMasks['L2-ordinary-stripe'][removedIndex] = 0;
diagonalJoin.evidence.raster.layerMasks['L1-ground-field'][removedIndex] = 1;
const diagonalJoinReport = validateFlag(diagonalJoin.spec, diagonalJoin.evidence);
assert.equal(diagonalJoinReport.checks.V02.passed, true,
  'диагонально соприкасающиеся пиксели одного цвета образуют одну растровую компоненту');
const repeatedClosure = structuredClone(fixture);
repeatedClosure.evidence.paths[0].points.push({ ...repeatedClosure.evidence.paths[0].points[0] });
assert.equal(validateFlag(repeatedClosure.spec, repeatedClosure.evidence).checks.V14.passed, true,
  'повтор первой точки в конце замкнутого контура не образует вырожденный угол');

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
  setRasterColor(evidence.raster, 10 * width + 10, colors.black);
}, 'запрещён крошечный компонент');
expectFailure('V02', ({ evidence }) => {
  evidence.layers[0].tags = ['glyph'];
  for (let y = 10; y < 14; y += 1) for (let x = 10; x < 14; x += 1) {
    const index = y * width + x;
    setRasterColor(evidence.raster, index, colors.black);
    evidence.raster.layerIds[index] = 'L1-ground-field';
  }
}, 'деталь глифа уже минимальной толщины');
expectFailure('V03', ({ evidence }) => {
  for (let y = 3; y < height; y += 3) {
    for (let x = 144; x < 216; x += 1) setRasterColor(evidence.raster, y * width + x, colors.white);
  }
}, 'замыкание не должно заполнять множество узких щелей');
expectFailure('V04', ({ evidence }) => {
  for (let y = 20; y < 200; y += 1) for (let x = 2; x < 5; x += 1) {
    setRasterColor(evidence.raster, y * width + x, colors.black);
  }
}, 'деталь, видимая при 240 пикселях, исчезает при 32 пикселях');
expectFailure('V05', ({ evidence }) => {
  for (let y = 0; y < height; y += 1) for (let x = 144; x < 216; x += 1) {
    setRasterColor(evidence.raster, y * width + x, '#fefeff');
  }
}, 'контраст смежных областей недостаточен в итоговом растре');
expectFailure('V05', ({ evidence }) => { evidence.layers[1].role = 'charge'; }, 'для заряда не задана пара с цветом фона');
expectFailure('V06', ({ evidence }) => {
  fillRasterColor(evidence.raster, colors.white);
  evidence.slotRaster.values.fill('s1');
  for (let y = 0; y < height; y += 1) for (let x = 260; x < 332; x += 1) {
    setRasterColor(evidence.raster, y * width + x, colors.red);
    evidence.slotRaster.values[y * width + x] = 's2';
  }
}, 'центр масс цветов находится вне BAL');
expectFailure('V07', ({ evidence }) => {
  fillRasterColor(evidence.raster, colors.red);
  evidence.slotRaster.values.fill('s2');
}, 'один цвет занимает весь флаг');
expectFailure('V08', ({ evidence }) => {
  evidence.layers[0].role = 'charge';
  evidence.layers[0].anchor = 'A5';
  evidence.layers[0].overlayWith = [];
}, 'наложение заряда и ординария не объявлено');
{
  const allowedA3 = structuredClone(fixture);
  allowedA3.evidence.layers[0].role = 'charge';
  allowedA3.evidence.layers[0].anchor = 'A3';
  allowedA3.evidence.layers[0].overlayWith = [];
  assert.equal(validateFlag(allowedA3.spec, allowedA3.evidence).checks.V08.passed, true,
    'V08: заряд на A3 освобождён от проверки столкновений');
}
expectFailure('V09', ({ evidence }) => {
  evidence.layers[1].role = 'charge';
  for (let y = 0; y < height; y += 1) for (let x = 144; x < 216; x += 1) {
    evidence.safeAreaMask[y * width + x] = 0;
  }
}, 'заряд выходит за безопасную область');
{
  const symmetryDowngrade = structuredClone(fixture);
  const { spec, evidence } = symmetryDowngrade;
  spec.meta.symmetry = 'MIR_H';
  fillRasterColor(evidence.raster, colors.white);
  evidence.slotRaster.values.fill('s1');
  for (let y = 0; y < height; y += 1) for (let x = 260; x < 332; x += 1) {
    setRasterColor(evidence.raster, y * width + x, colors.red);
    evidence.slotRaster.values[y * width + x] = 's2';
  }
  const report = validateFlag(spec, evidence);
  assert.equal(report.checks.V10.passed, true, 'V10: симметрия классифицируется, а не отклоняет флаг');
  assert.notEqual(spec.meta.symmetry_actual, spec.meta.symmetry, 'V10: фактическая симметрия сохраняется отдельно');
}
expectFailure('V11', ({ spec }) => { spec.tags = ['islamic']; }, 'тег не разрешён выбранным профилем');
expectFailure('V12', ({ evidence }) => { evidence.catalogIds = ['NOT_IN_CATALOG']; }, 'эмблема отсутствует в каталоге');
expectFailure('V12', ({ evidence }) => { evidence.compositionMask = makeChiralC4Mask(); }, 'обнаружена хиральная C4-симметрия');
const compositeEmblem = makeFixture();
compositeEmblem.evidence.catalogIds = ['M01', 'M03'];
compositeEmblem.evidence.expectedEmblemMaskCount = 1;
compositeEmblem.evidence.emblemMasks = [new Uint8Array(compositeEmblem.evidence.compositionMask)];
assert.equal(
  validateFlag(compositeEmblem.spec, compositeEmblem.evidence, { onlyRules: ['V12'] }).checks.V12.passed,
  true,
  'V12: одна составная эмблема имеет одну маску при нескольких каталоговых компонентах',
);
expectFailure('V12', ({ evidence }) => {
  evidence.catalogIds = ['M01', 'M03'];
  evidence.expectedEmblemMaskCount = 1;
  evidence.emblemMasks = [];
}, 'Не хватает масок эмблем: 1');
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
expectFailure('V16', ({ spec, evidence }) => {
  spec.outline.type = 'SWALLOW';
  evidence.outlinePaths = [];
}, 'для зубчатого контура отсутствует геометрия проверки углов');
expectFailure('V16', ({ spec, evidence }) => {
  spec.outline.type = 'SWALLOW';
  evidence.outlinePaths = [{
    operator: 'OUTLINE',
    closed: true,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 1 }],
  }];
}, 'у контура SWALLOW угол меньше установленного порога');

const rasterRepeat = rasterizeFlagReference(8, 8, [
  { id: 'base', color: colors.white, shapes: [{ type: 'rect', x: 0, y: 0, width: 8, height: 8 }] },
  { id: 'circle', color: colors.red, shapes: [{ type: 'circle', cx: 4, cy: 4, radius: 2 }] },
]);
assert.deepEqual(rasterRepeat.colors, rasterizeFlagReference(8, 8, [
  { id: 'base', color: colors.white, shapes: [{ type: 'rect', x: 0, y: 0, width: 8, height: 8 }] },
  { id: 'circle', color: colors.red, shapes: [{ type: 'circle', cx: 4, cy: 4, radius: 2 }] },
]).colors, 'растеризация эталонной геометрии детерминирована');
assert.equal(rasterRepeat.layerMasks.circle.length, 64);

function referencePolygonMask(testWidth, testHeight, points) {
  const mask = new Uint8Array(testWidth * testHeight);
  for (let y = 0; y < testHeight; y += 1) {
    for (let x = 0; x < testWidth; x += 1) {
      const sampleX = x + 0.5, sampleY = y + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const a = points[i], b = points[j];
        if ((a.y > sampleY) !== (b.y > sampleY) &&
            sampleX < ((b.x - a.x) * (sampleY - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      mask[y * testWidth + x] = Number(inside);
    }
  }
  return mask;
}

const polygonCases = [
  [{ x: 1.5, y: 1.5 }, { x: 10.5, y: 2.5 }, { x: 6.5, y: 9.5 }],
  [{ x: 1, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 10 }, { x: 1, y: 10 }],
  [{ x: 1.5, y: 1.5 }, { x: 10.5, y: 10.5 }, { x: 1.5, y: 10.5 }, { x: 10.5, y: 1.5 }],
  [{ x: -3.5, y: 2.5 }, { x: 5.5, y: -2.5 }, { x: 14.5, y: 2.5 }, { x: 8.5, y: 7.5 }, { x: 13.5, y: 14.5 }, { x: 0.5, y: 12.5 }],
];
for (let caseIndex = 0; caseIndex < polygonCases.length; caseIndex += 1) {
  const points = polygonCases[caseIndex];
  assert.deepEqual(
    rasterizeFlagPolygonMask(12, 12, [points]),
    referencePolygonMask(12, 12, points),
    `быстрая маска полигона совпадает с эталонной проверкой центров пикселей, случай ${caseIndex + 1}`,
  );
  const raster = rasterizeFlagReference(12, 12, [{
    id: `polygon-${caseIndex}`,
    color: colors.red,
    shapes: [{ type: 'polygon', points }],
  }]);
  assert.deepEqual(
    raster.layerMasks[`polygon-${caseIndex}`],
    referencePolygonMask(12, 12, points),
    `сканирующая растеризация сохраняет пиксели эталонного алгоритма, случай ${caseIndex + 1}`,
  );
}
for (let sample = 0; sample < 200; sample += 1) {
  const width = 3 + Math.floor(rasterRandom() * 23);
  const height = 3 + Math.floor(rasterRandom() * 21);
  const pointCount = 3 + Math.floor(rasterRandom() * 14);
  const points = Array.from({ length: pointCount }, () => ({
    x: rasterRange(-width * 0.3, width * 1.3),
    y: rasterRange(-height * 0.3, height * 1.3),
  }));
  const raster = rasterizeFlagReference(width, height, [{
    id: `случайный-многоугольник-${sample}`,
    color: colors.red,
    shapes: [{ type: 'polygon', points }],
  }]);
  assert.deepEqual(
    raster.layerMasks[`случайный-многоугольник-${sample}`],
    referencePolygonMask(width, height, points),
    `сканирующая растеризация сохраняет эталонные пиксели случайного многоугольника ${sample + 1}`,
  );
}
const multiShapePolygons = polygonCases.slice(0, 3);
const multiShapeRaster = rasterizeFlagReference(12, 12, [{
  id: 'слои-с-перекрытием',
  color: colors.red,
  shapes: multiShapePolygons.map((points) => ({ type: 'polygon', points })),
}]);
const multiShapeMask = new Uint8Array(12 * 12);
for (const points of multiShapePolygons) {
  const mask = referencePolygonMask(12, 12, points);
  for (let index = 0; index < mask.length; index += 1) multiShapeMask[index] ||= mask[index];
}
const filledIndices = Array.from(multiShapeMask, (value, index) => value ? index : -1).filter((index) => index >= 0);
assert.deepEqual(multiShapeRaster.layerMasks['слои-с-перекрытием'], multiShapeMask);
assert.equal(multiShapeRaster.layerAreas['слои-с-перекрытием'], filledIndices.length);
assert.deepEqual(multiShapeRaster.layerBounds['слои-с-перекрытием'], filledIndices.length ? {
  minX: Math.min(...filledIndices.map((index) => index % 12)),
  minY: Math.min(...filledIndices.map((index) => Math.floor(index / 12))),
  maxX: Math.max(...filledIndices.map((index) => index % 12)),
  maxY: Math.max(...filledIndices.map((index) => Math.floor(index / 12))),
} : null);

console.log('Отчёт валидатора и синтетические проходящие/нарушающие примеры V01–V16 проверены.');
