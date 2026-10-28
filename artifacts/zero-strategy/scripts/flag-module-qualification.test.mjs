import assert from 'node:assert/strict';
import {
  FLAG_EMBLEM_MODULES,
  validateFlagEmblem,
} from '../game/flagEmblems.js';
import { FLAG_EMBLEM_CONFIG } from '../game/flagEmblemConfig.js';
import { rasterizeFlagReference } from '../game/flagReferenceRaster.js';
import { validateFlag } from '../game/flagValidation.js';
import { FLAG_VALIDATION_CONFIG } from '../game/flagValidationConfig.js';

const HEIGHT_UNITS = FLAG_VALIDATION_CONFIG.flagHeight;
const RASTER_HEIGHT = FLAG_VALIDATION_CONFIG.components.highResolutionRasterHeight;
const RASTER_WIDTH = 720;
const UNITS_PER_PIXEL = FLAG_VALIDATION_CONFIG.components.highResolutionUnitsPerPixel;
const MAX_DIAMETER = HEIGHT_UNITS * FLAG_EMBLEM_CONFIG.qualification.maximumDiameterFraction;
const DIAMETER_GRID_POINTS = FLAG_EMBLEM_CONFIG.qualification.diameterGridPoints;
const BACKGROUND = '#ffffff';
const EMBLEM_COLOR = '#777777';

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function minimumFeatureFraction(moduleId, params) {
  const qualification = FLAG_EMBLEM_CONFIG.modules[moduleId].qualification;
  let value = qualification.f_min;
  for (const [parameter, values] of Object.entries(qualification.f_min_by_parameter ?? {})) {
    const candidate = values[String(params[parameter])];
    if (Number.isFinite(candidate)) value = candidate;
  }
  if (moduleId === 'M09' && String(params.profile).toUpperCase() === 'FLARED') {
    value = Number(params.thickness);
  }
  assert.ok(value > 0 && value <= 1, `${moduleId}: некорректный f_min=${value}`);
  return value;
}

function rasterShape(primitive, diameterPx, centerX, centerY) {
  if (primitive.kind === 'circle') {
    return {
      type: 'circle',
      cx: centerX + primitive.center.x * diameterPx,
      cy: centerY + primitive.center.y * diameterPx,
      radius: primitive.radius * diameterPx,
    };
  }
  if (primitive.kind === 'ring') {
    return {
      type: 'ring',
      cx: centerX + primitive.center.x * diameterPx,
      cy: centerY + primitive.center.y * diameterPx,
      innerRadius: primitive.innerRadius * diameterPx,
      outerRadius: primitive.outerRadius * diameterPx,
    };
  }
  return {
    type: 'polygon',
    points: primitive.points.map(({ x, y }) => ({
      x: centerX + x * diameterPx,
      y: centerY + y * diameterPx,
    })),
  };
}

function componentSizes(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const sizes = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let size = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      size += 1;
      const x = index % width, y = Math.floor(index / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [nx, ny] of [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
        [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1],
      ]) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    sizes.push({ size, minX, minY, maxX, maxY });
  }
  return sizes.sort((left, right) => left.size - right.size);
}

function validationFixture(moduleId, primitives, diameterUnits) {
  const diameterPx = diameterUnits / UNITS_PER_PIXEL;
  const shapes = primitives.map((primitive) =>
    rasterShape(primitive, diameterPx, RASTER_WIDTH / 2, RASTER_HEIGHT / 2));
  const raster = rasterizeFlagReference(RASTER_WIDTH, RASTER_HEIGHT, [
    {
      id: 'ground',
      color: BACKGROUND,
      shapes: [{ type: 'rect', x: 0, y: 0, width: RASTER_WIDTH, height: RASTER_HEIGHT }],
    },
    { id: 'charge', color: EMBLEM_COLOR, shapes },
  ]);
  const paths = primitives
    .filter((primitive) => primitive.kind === 'polygon')
    .map((primitive) => ({
      layerId: 'charge',
      operator: 'QUALIFICATION',
      module: moduleId,
      closed: true,
      sunRay: moduleId === 'M07',
      points: primitive.points.map(({ x, y }) => ({
        x: RASTER_WIDTH / 2 + x * diameterPx,
        y: RASTER_HEIGHT / 2 + y * diameterPx,
      })),
    }));
  const pixelCount = RASTER_WIDTH * RASTER_HEIGHT;
  const slotRaster = {
    values: raster.layerIds.map((id) => id === 'charge' ? 's2' : 's1'),
    width: RASTER_WIDTH,
    height: RASTER_HEIGHT,
    pixelSize: UNITS_PER_PIXEL,
  };
  const spec = {
    generator_version: 'module-qualification',
    seed: `${moduleId}-${diameterUnits}`,
    profile_id: 'P04',
    era: 2,
    tags: [],
    outline: { type: 'RECT', params: {}, aspect: 1.5, safe_area: { margin: 40 } },
    slots: { items: ['s1', 's2'], equalities: [] },
    palette: {
      s1: { color_id: 'white', hex: BACKGROUND },
      s2: { color_id: 'neutral', hex: EMBLEM_COLOR },
    },
    root: {
      x0: 0,
      y0: 0,
      w: 1,
      h: 1,
      clip: [],
      ground: { kind: 'fill', fill: 's1' },
      layers: [],
    },
    meta: {
      complexity: 1,
      symmetry: 'NONE',
      symmetry_target: 'NONE',
      symmetry_actual: 'NONE',
      color_count: 2,
      structure_hash: 'qualification',
      visual_hash: 'qualification',
    },
  };
  const evidence = {
    raster,
    layers: [
      { id: 'ground', role: 'ground', overlayWith: ['charge'] },
      { id: 'charge', sourceId: moduleId, role: 'charge', anchor: 'A1', slot: 's2', operator: 'QUALIFICATION', module: moduleId },
    ],
    safeAreaMask: new Uint8Array(pixelCount).fill(1),
    slotRaster,
    primitiveCount: primitives.length,
    pathPointCount: paths.reduce((sum, path) => sum + path.points.length, 0),
    paths,
    catalogIds: [moduleId],
    emblemMasks: [raster.layerMasks.charge],
    compositionMask: raster.layerMasks.charge,
    outlineFeatures: [],
    chargeBackgrounds: [],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${RASTER_WIDTH} ${RASTER_HEIGHT}"></svg>`,
  };
  return { spec, evidence };
}

let qualifiedSets = 0;
let checkedDiameters = 0;
const qualificationFailures = new Map();
let totalQualificationFailures = 0;
for (const moduleId of FLAG_EMBLEM_MODULES) {
  const configuration = FLAG_EMBLEM_CONFIG.modules[moduleId].qualification;
  assert.ok(configuration.f_min > 0, `${moduleId}: задан f_min`);
  assert.ok(configuration.symmetry_group, `${moduleId}: задана группа симметрии`);
  assert.ok(configuration.minimum_convex_angle_degrees >= 8,
    `${moduleId}: задан минимальный выпуклый угол`);
  assert.ok(configuration.allowed_parameter_sets.length > 0,
    `${moduleId}: заданы квалификационные наборы параметров`);
  for (let setIndex = 0; setIndex < configuration.allowed_parameter_sets.length; setIndex += 1) {
    const params = configuration.allowed_parameter_sets[setIndex];
    for (const [parameter, groups] of Object.entries(configuration.symmetry_group_by_parameter ?? {})) {
      assert.ok(groups[String(params[parameter])],
        `${moduleId} ${JSON.stringify(params)}: не задана группа симметрии для ${parameter}`);
    }
    const fraction = minimumFeatureFraction(moduleId, params);
    const minimumDiameter = FLAG_VALIDATION_CONFIG.physical.minimumThickness / fraction;
    assert.ok(minimumDiameter <= MAX_DIAMETER,
      `${moduleId} ${JSON.stringify(params)}: D_min ${minimumDiameter} превышает 0,80H`);
    const built = validateFlagEmblem(
      { module: moduleId, params },
      { canvasHeight: HEIGHT_UNITS, scale: 1, rng: seeded(10000 + setIndex) },
    );
    assert.ok(built.primitiveCount > 0, `${moduleId} ${JSON.stringify(params)}: геометрия отсутствует`);
    const diameters = Array.from({ length: DIAMETER_GRID_POINTS }, (_, index) =>
      minimumDiameter + (MAX_DIAMETER - minimumDiameter) * index / Math.max(1, DIAMETER_GRID_POINTS - 1));
    for (const diameter of diameters) {
      const { spec, evidence } = validationFixture(moduleId, built.primitives, diameter);
      const report = validateFlag(spec, evidence);
      for (const rule of ['V02', 'V03', 'V14']) {
        const check = report.checks[rule];
        if (!check.passed) {
          totalQualificationFailures += 1;
          const key = `${moduleId} ${JSON.stringify(params)} ${rule}`;
          const failure = qualificationFailures.get(key) ?? { moduleId, params, rule, count: 0, examples: [] };
          failure.count += 1;
          if (failure.examples.length < 3) {
            failure.examples.push({
              diameter,
              value: check.value,
              details: check.details,
              components: componentSizes(evidence.raster.layerMasks.charge, RASTER_WIDTH, RASTER_HEIGHT)
                .slice(0, 8)
                .map(({ size, minX, minY }) => `${size}@${minX},${minY}`),
            });
          }
          qualificationFailures.set(key, failure);
        }
      }
      checkedDiameters += 1;
    }
    qualifiedSets += 1;
  }
}

if (totalQualificationFailures) {
  console.error(`Квалификация модулей провалена: ${totalQualificationFailures} нарушений V02/V03/V14.`);
  console.error(JSON.stringify([...qualificationFailures.values()], null, 2));
}
assert.equal(totalQualificationFailures, 0, 'Квалификационные наборы должны проходить V02, V03 и V14 для всего диапазона D.');
console.log(`Квалификация модулей пройдена: ${qualifiedSets} наборов параметров, ${checkedDiameters} значений D.`);
