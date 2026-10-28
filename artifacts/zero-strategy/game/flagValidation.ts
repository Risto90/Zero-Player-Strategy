import { FLAG_COLOR_CONFIG } from './flagColorConfig';
import { deltaE76, srgbToLab, validateFlagPalette, wcagContrast, type FlagChargeBackground, type FlagSlotRaster, type RasterSlot } from './flagColors';
import { FLAG_EMBLEM_CONFIG } from './flagEmblemConfig';
import { FLAG_OUTLINE_CONFIG } from './flagOutlineConfig';
import { FLAG_PROFILE_CONFIG } from './flagProfileConfig';
import { areFlagTagSetsCompatible, canUseHybridProfiles, getFlagProfile, isPureFlagStyle } from './flagProfiles';
import type { FlagSpec, JsonObject, JsonValue } from './flagSpec';
import { FLAG_VALIDATION_CONFIG } from './flagValidationConfig';
import { morphologyMask, morphologySequenceMask } from './flagMorphology';
import type { FlagReferenceRaster } from './flagReferenceRaster';

export type FlagValidationRule =
  | 'V01' | 'V02' | 'V03' | 'V04' | 'V05' | 'V06' | 'V07' | 'V08'
  | 'V09' | 'V10' | 'V11' | 'V12' | 'V13' | 'V14' | 'V15' | 'V16';

export interface FlagValidationCheck {
  passed: boolean;
  /** Числовое или структурированное измерение; null означает отсутствие обязательных данных. */
  value: JsonValue | null;
  limit?: JsonValue;
  details: string[];
}

export interface FlagValidationReport {
  passed: boolean;
  checks: Record<FlagValidationRule, FlagValidationCheck>;
}

export interface FlagValidationLayer {
  id: string;
  sourceId?: string;
  role: string;
  anchor?: string;
  slot?: string;
  operator?: string;
  module?: string;
  parentId?: string;
  overlayWith?: string[];
  touchingEdge?: boolean;
  tags?: string[];
  catalogIds?: string[];
}

export interface FlagValidationPath {
  points: { x: number; y: number }[];
  layerId?: string;
  operator?: string;
  module?: string;
  closed?: boolean;
  signedArea?: number;
  /** Для многоугольников солнечных лучей отдельно задан минимум 8°. */
  sunRay?: boolean;
}

export interface FlagValidationFeature {
  type: 'cutout' | 'tooth' | 'scallop' | 'tab' | 'edge';
  minimumWidthPx: number;
  mask?: ArrayLike<number>;
}

export interface FlagValidationEvidence {
  raster: FlagReferenceRaster;
  /** Детальный растр 480 px для V02/V03; остальные правила используют эталон 240 px. */
  componentRaster?: FlagReferenceRaster;
  /** Описания и маски должны использовать постоянные идентификаторы слоёв. */
  layers: FlagValidationLayer[];
  /** Итоговый растр слотов слоёв для проверки цветовых правил C1–C3. */
  slotRaster?: FlagSlotRaster;
  chargeBackgrounds?: FlagChargeBackground[];
  tincture?: boolean;
  primitiveCount: number;
  pathPointCount: number;
  paths: FlagValidationPath[];
  componentPaths?: FlagValidationPath[];
  /** Идентификаторы модулей и композиторов каталога после раскрытия геометрии. */
  catalogIds: string[];
  /** Ожидаемое число масок — по одной на каждый экземпляр заряда, включая составной. */
  expectedEmblemMaskCount: number;
  /** Маски каждой отдельной эмблемы без фона при разрешении 64 пикселя. */
  emblemMasks?: ArrayLike<number>[];
  /** Маска всей композиции без фона в квадратном растре 64×64. */
  compositionMask?: ArrayLike<number>;
  /** Исключённая зона выреза или края в разрешении эталонного растра. */
  outlineExclusionMask?: ArrayLike<number>;
  /** Пиксели внутри безопасной области, отстоящей от контура на M_SAFE. */
  safeAreaMask?: ArrayLike<number>;
  /** SVG, созданный из той же спецификации и используемый для V15. */
  svg?: string;
  /** Идентификаторы слоёв SVG; составные повторные экземпляры не имеют отдельных элементов в определении. */
  svgLayerIds?: string[];
  outlineFeatures?: FlagValidationFeature[];
  /** Исходная геометрия контура для V16; V14 намеренно её не проверяет. */
  outlinePaths?: FlagValidationPath[];
  /** Контекст генератора, который нельзя восстановить из развёрнутой геометрии. */
  forbiddenMotifs?: string[];
  /** Переопределение списка разрешённых тегов для профиля. */
  allowedTags?: string[];
  /** Разрешает служебные атрибуты data-* для экспорта метаданных. */
  embedMetadata?: boolean;
}

export interface FlagValidationOptions {
  onlyRules?: readonly FlagValidationRule[];
  /** Явно отложенные правила, например для низкоразрешающего предварительного этапа. */
  skipRules?: readonly FlagValidationRule[];
  /** Слои, которые будут удалены на S7; учитываются только в локальной предварительной проверке. */
  ignoreLayerIds?: readonly string[];
  onRuleTiming?: (rule: FlagValidationRule, durationMs: number, section?: string) => void;
  /** Останавливает проверку генераторного кандидата при первом нарушении. */
  stopAfterFirstFailure?: boolean;
  thresholds?: {
    maximumComplexity?: number;
    maximumLayers?: number;
    maximumPrimitives?: number;
    maximumPathPoints?: number;
    minimumThicknessPx?: number;
    minimumGapPx?: number;
    maximumOpeningLoss?: number;
    maximumClosingIncrease?: number;
    minimumColorShare?: number;
    maximumColorShare?: number;
    minimumAdjacentDeltaE?: number;
    minimumChargeDeltaE?: number;
    minimumChargeContrast?: number;
    minimumSmallOutlinedChargeContrast?: number;
    minimumBalanceWeightShare?: number;
    maximumOverlapShare?: number;
    minimumSymmetryAgreement?: number;
    maximumSvgBytes?: number;
    maximumColors?: number;
    minimumPolygonAngle?: number;
    minimumSunRayAngle?: number;
  };
}

type Mask = Uint8Array;
type Point = { x: number; y: number };
const RULES: FlagValidationRule[] = [
  'V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08',
  'V09', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16',
];
const PIXEL_NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const PIXEL_NEIGHBORS_8 = [
  ...PIXEL_NEIGHBORS,
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;
const eqPair = (a: string, b: string) => `${a}\u0000${b}`;
const check = (passed: boolean, value: FlagValidationCheck['value'], limit?: FlagValidationCheck['limit'], details: string[] = []): FlagValidationCheck =>
  ({ passed, value, ...(limit === undefined ? {} : { limit }), details });
const unavailable = (reason: string): FlagValidationCheck => check(false, null, undefined, [reason]);

function assertRaster(raster: FlagReferenceRaster): void {
  const size = raster.width * raster.height;
  const colorBufferLength = raster.colorIds?.length ?? raster.colors.length;
  const layerBufferLength = raster.layerIdIndices?.length ?? raster.layerIds.length;
  if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height) ||
    raster.width < 1 || raster.height < 1 || colorBufferLength !== size ||
    layerBufferLength !== size) {
    throw new RangeError('Некорректные размеры или буферы эталонного растра');
  }
  for (const [id, mask] of Object.entries(raster.layerMasks)) {
    if (!id || mask.length !== size) throw new RangeError(`Некорректная эталонная маска "${id}"`);
  }
}

function slotAt(raster: FlagSlotRaster, index: number): string | null {
  const value: RasterSlot = raster.values[index];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return raster.slotIds?.[value] ?? null;
  return null;
}

function validSlotRaster(raster: FlagSlotRaster | undefined, width: number, height: number, slots: readonly string[]): raster is FlagSlotRaster {
  if (!raster || raster.width !== width || raster.height !== height ||
    raster.values.length !== width * height) return false;
  const known = new Set(slots);
  if (raster.slotIds && ArrayBuffer.isView(raster.values) && typeof raster.values[0] === 'number') {
    const numericValues = raster.values as ArrayLike<number>;
    const slotEntries = Object.entries(raster.slotIds).map(([value, slot]) => [Number(value), slot] as const);
    const maximumCode = Math.max(-1, ...slotEntries.map(([value]) => value));
    const validCodes = new Uint8Array(maximumCode + 1);
    for (const [value, slot] of slotEntries) if (value >= 0 && known.has(slot)) validCodes[value] = 1;
    for (let index = 0; index < numericValues.length; index += 1) {
      const value = numericValues[index];
      if (!Number.isFinite(value) || !Number.isInteger(value)) return false;
      if (value < 0) continue;
      if (value >= validCodes.length || !validCodes[value]) return false;
    }
    return true;
  }
  for (let index = 0; index < raster.values.length; index += 1) {
    const value = raster.values[index];
    if (value === null || value === undefined) continue;
    const slot = slotAt(raster, index);
    if (!slot || !known.has(slot)) return false;
  }
  return true;
}

function colorMaskData(raster: FlagReferenceRaster, includeMasks = true): {
  masks: Map<string, Mask>;
  areas: Map<string, number>;
  xSums: Map<string, number>;
  ySums: Map<string, number>;
} {
  const masks = new Map<string, Mask>();
  const areas = new Map<string, number>();
  const xSums = new Map<string, number>();
  const ySums = new Map<string, number>();
  if (raster.colorIds && raster.colorPalette) {
    const colorIds = raster.colorIds;
    const masksById: (Mask | undefined)[] | null = includeMasks ? [] : null;
    const areasById = new Uint32Array(raster.colorPalette.length);
    const xSumsById = new Float64Array(raster.colorPalette.length);
    const ySumsById = new Float64Array(raster.colorPalette.length);
    for (let y = 0; y < raster.height; y += 1) {
      const row = y * raster.width, centerY = y + 0.5;
      for (let x = 0; x < raster.width; x += 1) {
        const index = row + x, colorId = colorIds[index];
        if (!colorId) continue;
        const color = raster.colorPalette[colorId - 1];
        if (!color) throw new RangeError(`Идентификатор цвета ${colorId} отсутствует в палитре растра`);
        if (masksById) {
          let mask = masksById[colorId];
          if (!mask) {
            mask = new Uint8Array(colorIds.length);
            masksById[colorId] = mask;
            masks.set(color, mask);
          }
          mask[index] = 1;
        }
        areasById[colorId - 1] += 1;
        xSumsById[colorId - 1] += x + 0.5;
        ySumsById[colorId - 1] += centerY;
      }
    }
    for (let colorId = 0; colorId < areasById.length; colorId += 1) {
      if (areasById[colorId]) {
        const color = raster.colorPalette[colorId];
        areas.set(color, areasById[colorId]);
        xSums.set(color, xSumsById[colorId]);
        ySums.set(color, ySumsById[colorId]);
      }
    }
    return { masks, areas, xSums, ySums };
  }
  for (let y = 0; y < raster.height; y += 1) {
    const row = y * raster.width, centerY = y + 0.5;
    for (let x = 0; x < raster.width; x += 1) {
      const index = row + x, color = raster.colors[index]?.toLowerCase();
      if (!color) continue;
      if (includeMasks) {
        let mask = masks.get(color);
        if (!mask) {
          mask = new Uint8Array(raster.colors.length);
          masks.set(color, mask);
        }
        mask[index] = 1;
      }
      areas.set(color, (areas.get(color) ?? 0) + 1);
      xSums.set(color, (xSums.get(color) ?? 0) + x + 0.5);
      ySums.set(color, (ySums.get(color) ?? 0) + centerY);
    }
  }
  return { masks, areas, xSums, ySums };
}

function colorMasks(raster: FlagReferenceRaster): Map<string, Mask> {
  return colorMaskData(raster).masks;
}

function components(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  neighbors: readonly (readonly [number, number])[] = PIXEL_NEIGHBORS,
): { indices: number[]; area: number; minX: number; minY: number; maxX: number; maxY: number }[] {
  const seen = new Uint8Array(width * height);
  const result: { indices: number[]; area: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const pixels = [start];
    let minX = width, minY = height, maxX = -1, maxY = -1;
    seen[start] = 1;
    for (let head = 0; head < pixels.length; head += 1) {
      const current = pixels[head], x = current % width, y = Math.floor(current / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !seen[next]) { seen[next] = 1; pixels.push(next); }
      }
    }
    result.push({ indices: pixels, area: pixels.length, minX, minY, maxX, maxY });
  }
  return result;
}

type RasterComponent = {
  indices: ArrayLike<number>;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function componentsByColor(
  raster: FlagReferenceRaster,
  width: number,
  height: number,
  neighbors: readonly (readonly [number, number])[] = PIXEL_NEIGHBORS,
): (RasterComponent & { color: string; layerIds: string[] })[] {
  const colorIds = raster.colorIds, colorPalette = raster.colorPalette;
  if (!colorIds || !colorPalette) {
    return [...colorMasks(raster)].flatMap(([color, mask]) =>
      components(mask, width, height, neighbors).map((component) => ({
        color,
        ...component,
        layerIds: componentLayerIds(component, raster),
      })));
  }

  const seen = new Uint8Array(width * height);
  const allIndices = new Int32Array(width * height);
  const layerVisitMarks = raster.layerIdIndices && raster.layerIdPalette
    ? new Uint32Array(raster.layerIdPalette.length + 1)
    : null;
  let allIndicesLength = 0;
  let componentMark = 0;
  const result: (RasterComponent & { color: string; layerIds: string[] })[] = [];
  for (let start = 0; start < colorIds.length; start += 1) {
    const colorId = colorIds[start];
    if (!colorId || seen[start]) continue;
    const color = colorPalette[colorId - 1];
    if (!color) throw new RangeError(`Идентификатор цвета ${colorId} отсутствует в палитре растра`);
    let head = 0, tail = 0;
    const indexStart = allIndicesLength;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    componentMark += 1;
    const componentLayerIndices: number[] | null = layerVisitMarks ? [] : null;
    const layerIds = componentLayerIndices ? null : new Set<string>();
    allIndices[indexStart + tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const current = allIndices[indexStart + head++];
      if (componentLayerIndices) {
        const layerIndex = raster.layerIdIndices![current];
        if (layerIndex) {
          if (layerIndex >= layerVisitMarks!.length) {
            throw new RangeError(`Идентификатор слоя ${layerIndex} отсутствует в палитре растра`);
          }
          if (layerVisitMarks![layerIndex] !== componentMark) {
            layerVisitMarks![layerIndex] = componentMark;
            componentLayerIndices.push(layerIndex);
          }
        }
      } else {
        const layerId = raster.layerIds[current];
        if (layerId) layerIds!.add(layerId);
      }
      const x = current % width, y = Math.floor(current / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x + 1 < width) {
        const next = current + 1;
        if (colorIds[next] === colorId && !seen[next]) { seen[next] = 1; allIndices[indexStart + tail++] = next; }
      }
      if (x > 0) {
        const next = current - 1;
        if (colorIds[next] === colorId && !seen[next]) { seen[next] = 1; allIndices[indexStart + tail++] = next; }
      }
      if (y + 1 < height) {
        const next = current + width;
        if (colorIds[next] === colorId && !seen[next]) { seen[next] = 1; allIndices[indexStart + tail++] = next; }
      }
      if (y > 0) {
        const next = current - width;
        if (colorIds[next] === colorId && !seen[next]) { seen[next] = 1; allIndices[indexStart + tail++] = next; }
      }
      if (neighbors.length === 8) {
        if (x + 1 < width && y + 1 < height) {
          const next = current + width + 1;
          if (colorIds[next] === colorId && !seen[next]) { seen[next] = 1; allIndices[indexStart + tail++] = next; }
        }
        if (x + 1 < width && y > 0) {
          const next = current - width + 1;
          if (colorIds[next] === colorId && !seen[next]) { seen[next] = 1; allIndices[indexStart + tail++] = next; }
        }
        if (x > 0 && y + 1 < height) {
          const next = current + width - 1;
          if (colorIds[next] === colorId && !seen[next]) { seen[next] = 1; allIndices[indexStart + tail++] = next; }
        }
        if (x > 0 && y > 0) {
          const next = current - width - 1;
          if (colorIds[next] === colorId && !seen[next]) { seen[next] = 1; allIndices[indexStart + tail++] = next; }
        }
      }
    }
    allIndicesLength += tail;
    result.push({
      color,
      layerIds: componentLayerIndices && raster.layerIdPalette
        ? componentLayerIndices.map((index) => raster.layerIdPalette![index - 1])
        : [...(layerIds ?? [])],
      indices: allIndices.subarray(indexStart, allIndicesLength),
      area: tail,
      minX,
      minY,
      maxX,
      maxY,
    });
  }
  return result;
}

function morphology(mask: ArrayLike<number>, width: number, height: number, radius: number, operation: 'dilate' | 'erode'): Mask {
  if (radius <= 31) return morphologyMask(mask, width, height, radius, operation);
  const result = new Uint8Array(width * height);
  if (operation === 'dilate') {
    const distanceSquared = distanceTransformSquared(mask, width, height);
    const radiusSquared = radius * radius;
    for (let index = 0; index < result.length; index += 1) result[index] = Number(distanceSquared[index] <= radiusSquared);
    return result;
  }
  const paddedWidth = width + 2, paddedHeight = height + 2;
  const padded = new Uint8Array(paddedWidth * paddedHeight).fill(1);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    padded[(y + 1) * paddedWidth + x + 1] = Number(!mask[y * width + x]);
  }
  const distanceSquared = distanceTransformSquared(padded, paddedWidth, paddedHeight);
  const radiusSquared = radius * radius;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    result[index] = Number(!!mask[index] && distanceSquared[(y + 1) * paddedWidth + x + 1] > radiusSquared);
  }
  return result;
}

function morphologySequence(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
  operations: readonly ('dilate' | 'erode')[],
): Uint8Array {
  if (radius <= 31) return morphologySequenceMask(mask, width, height, radius, operations);
  let result: Mask = Uint8Array.from({ length: mask.length }, (_, index) => Number(Boolean(mask[index])));
  for (const operation of operations) result = morphology(result, width, height, radius, operation);
  return result;
}

function acuteTipExclusionMask(
  paths: readonly FlagValidationPath[],
  width: number,
  height: number,
  radius: number,
  angleLimit: number,
  kind: 'convex' | 'concave',
): Mask {
  const excluded = new Uint8Array(width * height);
  for (const path of paths) {
    if (!path.closed || path.points.length < 3) continue;
    const orientation = Math.sign(path.signedArea ?? pathArea(path.points));
    if (!orientation) continue;
    for (let index = 0; index < path.points.length; index += 1) {
      const previous = path.points[(index + path.points.length - 1) % path.points.length];
      const current = path.points[index];
      const next = path.points[(index + 1) % path.points.length];
      const turn = (current.x - previous.x) * (next.y - current.y) -
        (current.y - previous.y) * (next.x - current.x);
      const convex = turn * orientation >= 0;
      if ((kind === 'convex') !== convex) continue;
      const interior = interiorAngle(path.points, index);
      const wedge = convex ? interior : 360 - interior;
      if (!(wedge > 0 && wedge < angleLimit)) continue;
      const zoneRadius = radius * (1 / Math.tan(wedge * Math.PI / 360) + 1);
      const minX = Math.max(0, Math.floor(current.x - zoneRadius));
      const maxX = Math.min(width - 1, Math.ceil(current.x + zoneRadius));
      const minY = Math.max(0, Math.floor(current.y - zoneRadius));
      const maxY = Math.min(height - 1, Math.ceil(current.y + zoneRadius));
      const radiusSquared = zoneRadius * zoneRadius;
      for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
        if ((x - current.x) ** 2 + (y - current.y) ** 2 <= radiusSquared) excluded[y * width + x] = 1;
      }
    }
  }
  return excluded;
}

function componentLayerIds(component: { indices: ArrayLike<number> }, raster: FlagReferenceRaster): string[] {
  const ids = new Set<string>();
  for (let offset = 0; offset < component.indices.length; offset += 1) {
    const index = component.indices[offset];
    let id: string | undefined;
    if (raster.layerIdIndices) {
      const layerIndex = raster.layerIdIndices[index];
      if (layerIndex) id = raster.layerIdPalette?.[layerIndex - 1];
    } else {
      id = raster.layerIds[index] ?? undefined;
    }
    if (id) ids.add(id);
  }
  return [...ids];
}

function changedPixelsOutsideMask(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  excluded: ArrayLike<number>,
  width: number,
  height: number,
  direction: 'loss' | 'gain',
  candidateIndices?: ArrayLike<number>,
): number {
  let count = 0;
  if (candidateIndices && direction === 'loss') {
    for (let offset = 0; offset < candidateIndices.length; offset += 1) {
      const index = candidateIndices[offset];
      if (before[index] && !after[index] && !excluded[index]) count += 1;
    }
    return count;
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (excluded[index]) continue;
    if (direction === 'loss' ? !!before[index] && !after[index] : !before[index] && !!after[index]) count += 1;
  }
  return count;
}

function sumMask(mask: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < mask.length; i += 1) sum += Number(!!mask[i]);
  return sum;
}

function getSymmetry(spec: FlagSpec): string {
  const raw = spec.meta.symmetry;
  if (typeof raw === 'string') return raw.toUpperCase();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as JsonObject;
    const type = String(record.type ?? '').toUpperCase();
    if (type === 'NONE') return 'NONE';
    if (type === 'ROT180' || type === 'ROTATIONAL') return 'ROT180';
    const axis = String(record.axis ?? '').toLowerCase();
    if (type.includes('MIRROR')) return axis === 'vertical' || axis === 'y' ? 'MIR_H' : 'MIR_V';
    return String(record.class ?? type);
  }
  return '';
}

function classifySymmetry(raster: FlagReferenceRaster, minimum: number): { actual: string; agreements: Record<string, number> } {
  const values = raster.colorIds ?? raster.colors;
  let comparedH = 0, matchingH = 0, comparedV = 0, matchingV = 0, comparedR = 0, matchingR = 0;
  const halfWidth = Math.floor(raster.width / 2);
  for (let y = 0; y < raster.height; y += 1) {
    const row = y * raster.width;
    for (let x = 0; x < halfWidth; x += 1) {
      const a = values[row + x], b = values[row + raster.width - 1 - x];
      if ((a === 0 || a === null) && (b === 0 || b === null)) continue;
      comparedH += 1;
      if (a === b) matchingH += 1;
    }
    if (raster.width % 2) {
      const center = values[row + halfWidth];
      if (center !== 0 && center !== null) { comparedH += 1; matchingH += 1; }
    }
  }
  const halfHeight = Math.floor(raster.height / 2);
  for (let y = 0; y < halfHeight; y += 1) {
    const upper = y * raster.width;
    const lower = (raster.height - 1 - y) * raster.width;
    for (let x = 0; x < raster.width; x += 1) {
      const a = values[upper + x], b = values[lower + x];
      if ((a === 0 || a === null) && (b === 0 || b === null)) continue;
      comparedV += 1;
      if (a === b) matchingV += 1;
    }
  }
  if (raster.height % 2) {
    const center = halfHeight * raster.width;
    for (let x = 0; x < raster.width; x += 1) {
      const value = values[center + x];
      if (value !== 0 && value !== null) { comparedV += 1; matchingV += 1; }
    }
  }
  const pixelCount = raster.width * raster.height;
  for (let index = 0; index < Math.floor(pixelCount / 2); index += 1) {
    const a = values[index], b = values[pixelCount - 1 - index];
    if ((a === 0 || a === null) && (b === 0 || b === null)) continue;
    comparedR += 1;
    if (a === b) matchingR += 1;
  }
  if (pixelCount % 2) {
    const center = values[Math.floor(pixelCount / 2)];
    if (center !== 0 && center !== null) { comparedR += 1; matchingR += 1; }
  }
  const horizontal = comparedH ? matchingH / comparedH : 1;
  const vertical = comparedV ? matchingV / comparedV : 1;
  const rotation = comparedR ? matchingR / comparedR : 1;
  const agreements = { MIR_H: horizontal, MIR_V: vertical, BOTH: Math.min(horizontal, vertical), ROT180: rotation };
  const actual = agreements.BOTH >= minimum ? 'BOTH'
    : horizontal >= minimum ? 'MIR_H'
      : vertical >= minimum ? 'MIR_V'
        : rotation >= minimum ? 'ROT180' : 'NONE';
  return { actual, agreements };
}

function squaredDistance1d(
  input: ArrayLike<number>,
  length: number,
  output: Float64Array,
  sites: Int32Array,
  boundaries: Float64Array,
): void {
  let firstSite = -1;
  for (let i = 0; i < length; i += 1) if (input[i] < 1e19) { firstSite = i; break; }
  if (firstSite < 0) { output.fill(1e20, 0, length); return; }
  let k = 0;
  sites[0] = firstSite;
  boundaries[0] = -Infinity;
  boundaries[1] = Infinity;
  for (let q = firstSite + 1; q < length; q += 1) {
    if (input[q] >= 1e19) continue;
    let firstBetter = Math.floor(
      ((input[q] + q * q) - (input[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k])),
    ) + 1;
    while (firstBetter <= boundaries[k]) {
      k -= 1;
      firstBetter = Math.floor(
        ((input[q] + q * q) - (input[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k])),
      ) + 1;
    }
    k += 1;
    sites[k] = q;
    boundaries[k] = firstBetter;
    boundaries[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while (boundaries[k + 1] <= q) k += 1;
    output[q] = (q - sites[k]) ** 2 + input[sites[k]];
  }
}

interface DistanceTransformWorkspace {
  horizontal: Float64Array;
  result: Float64Array;
  line: Float64Array;
  lineOutput: Float64Array;
  sites: Int32Array;
  boundaries: Float64Array;
}

let distanceTransformWorkspace: DistanceTransformWorkspace | null = null;

function getDistanceTransformWorkspace(width: number, height: number): DistanceTransformWorkspace {
  const size = width * height;
  const lineLength = Math.max(width, height);
  if (!distanceTransformWorkspace ||
      distanceTransformWorkspace.horizontal.length < size ||
      distanceTransformWorkspace.result.length < size ||
      distanceTransformWorkspace.line.length < lineLength) {
    distanceTransformWorkspace = {
      horizontal: new Float64Array(size),
      result: new Float64Array(size),
      line: new Float64Array(lineLength),
      lineOutput: new Float64Array(lineLength),
      sites: new Int32Array(lineLength),
      boundaries: new Float64Array(lineLength + 1),
    };
  }
  return distanceTransformWorkspace;
}

// Буферы переиспользуются: преобразование расстояния синхронно, а его результат сразу считывается вызывающим кодом.
function distanceTransformSquared(mask: ArrayLike<number>, width: number, height: number): Float64Array {
  const size = width * height;
  const workspace = getDistanceTransformWorkspace(width, height);
  const { horizontal, result, line, lineOutput, sites, boundaries } = workspace;
  // Для бинарной исходной строки достаточно двух точных проходов до ближайшего пикселя.
  for (let y = 0; y < height; y += 1) {
    const offset = y * width;
    let nearest = -1;
    for (let x = 0; x < width; x += 1) {
      if (mask[offset + x]) nearest = x;
      horizontal[offset + x] = nearest < 0 ? 1e20 : (x - nearest) ** 2;
    }
    nearest = -1;
    for (let x = width - 1; x >= 0; x -= 1) {
      if (mask[offset + x]) nearest = x;
      if (nearest < 0) continue;
      const distance = (x - nearest) ** 2;
      if (distance < horizontal[offset + x]) horizontal[offset + x] = distance;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) line[y] = horizontal[y * width + x];
    squaredDistance1d(line, height, lineOutput, sites, boundaries);
    for (let y = 0; y < height; y += 1) result[y * width + x] = lineOutput[y];
  }
  return result.subarray(0, size);
}

interface PixelMaskBounds { minX: number; minY: number; maxX: number; maxY: number }

function getMaskBounds(mask: ArrayLike<number>, width: number, height: number): PixelMaskBounds | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!mask[y * width + x]) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < minX || maxY < minY ? null : { minX, minY, maxX, maxY };
}

/** Перевод расстояния между центрами пикселей в расстояние между краями для V08. */
function maskBoundsGap(first: PixelMaskBounds, second: PixelMaskBounds): number {
  const dx = Math.max(0, first.minX - second.maxX, second.minX - first.maxX);
  const dy = Math.max(0, first.minY - second.maxY, second.minY - first.maxY);
  return Math.max(0, Math.hypot(dx, dy) - 1);
}

function minimumMaskGapNear(
  first: ArrayLike<number>,
  second: ArrayLike<number>,
  firstBounds: PixelMaskBounds,
  secondBounds: PixelMaskBounds,
  width: number,
  height: number,
  threshold: number,
): { gap: number; exact: boolean } | null {
  const lowerBound = maskBoundsGap(firstBounds, secondBounds);
  if (lowerBound >= threshold) return { gap: lowerBound, exact: false };
  const margin = Math.ceil(threshold + 1);
  const minX = Math.max(0, firstBounds.minX - margin);
  const minY = Math.max(0, firstBounds.minY - margin);
  const maxX = Math.min(width - 1, firstBounds.maxX + margin);
  const maxY = Math.min(height - 1, firstBounds.maxY + margin);
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const cropped = new Uint8Array(cropWidth * cropHeight);
  for (let y = firstBounds.minY; y <= firstBounds.maxY; y += 1) {
    const sourceOffset = y * width;
    const targetOffset = (y - minY) * cropWidth;
    for (let x = firstBounds.minX; x <= firstBounds.maxX; x += 1) {
      const index = sourceOffset + x;
      if (first[index]) cropped[targetOffset + x - minX] = 1;
    }
  }
  const distances = distanceTransformSquared(cropped, cropWidth, cropHeight);
  let minimumSquared = Infinity;
  const scanMinX = Math.max(minX, secondBounds.minX);
  const scanMinY = Math.max(minY, secondBounds.minY);
  const scanMaxX = Math.min(maxX, secondBounds.maxX);
  const scanMaxY = Math.min(maxY, secondBounds.maxY);
  for (let y = scanMinY; y <= scanMaxY; y += 1) {
    const sourceOffset = y * width;
    const targetOffset = (y - minY) * cropWidth;
    for (let x = scanMinX; x <= scanMaxX; x += 1) {
      const index = sourceOffset + x;
      if (second[index]) minimumSquared = Math.min(minimumSquared, distances[targetOffset + x - minX]);
    }
  }
  return Number.isFinite(minimumSquared)
    ? { gap: Math.max(0, Math.sqrt(minimumSquared) - 1), exact: true }
    : null;
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return match?.[1] ?? match?.[2];
}

function parseSvg(
  svg: string,
  maxBytes: number,
  width: number,
  height: number,
  embedMetadata: boolean,
  requiredLayerIds: string[],
): { passed: boolean; bytes: number; elements: number; pathCommands: string[]; badCoordinates: number; reasons: string[] } {
  const bytes = new TextEncoder().encode(svg).length;
  const reasons: string[] = [];
  const cleaned = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*\?>/g, '').trim();
  if (!cleaned.startsWith('<svg') || !cleaned.endsWith('</svg>')) reasons.push('Корневой элемент SVG отсутствует или имеет неверный формат');
  const tokens = cleaned.match(/<[^>]+>/g) ?? [];
  const textCheck = embedMetadata ? cleaned.replace(/<metadata(?:\s[^>]*)?>[\s\S]*?<\/metadata\s*>/gi, '') : cleaned;
  if (textCheck.replace(/<[^>]+>/g, '').trim()) reasons.push('Текстовые узлы не разрешены');
  const stack: string[] = [], elements: string[] = [], pathCommands: string[] = [];
  let badCoordinates = 0;
  const allowedElements = new Set<string>([
    ...FLAG_VALIDATION_CONFIG.svg.allowedElements,
    ...(embedMetadata ? ['metadata'] : []),
  ]);
  const allowedAttributes = new Set([
    'xmlns', 'viewBox', 'width', 'height', 'id', 'fill', 'fill-rule', 'clip-path',
    'd', 'points', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
    'href', 'transform', 'preserveAspectRatio',
  ]);
  const ids = new Set<string>(), layerIds = new Set<string>(), references: string[] = [];
  for (const token of tokens) {
    if (/^<\//.test(token)) {
      const name = token.match(/^<\/([\w:-]+)\s*>/)?.[1];
      if (!name || stack.pop() !== name) reasons.push(`Закрывающий элемент ${name ?? token} не соответствует открывающему`);
      continue;
    }
    if (/^<!/.test(token)) { reasons.push('Объявления и DOCTYPE не разрешены'); continue; }
    const name = token.match(/^<([\w:-]+)/)?.[1];
    if (!name) { reasons.push(`Некорректный элемент ${token}`); continue; }
    elements.push(name);
    if (!allowedElements.has(name)) reasons.push(`Элемент <${name}> не разрешён`);
    const selfClosing = /\/\s*>$/.test(token);
    if (!selfClosing) stack.push(name);
    const attrsText = token.slice(name.length + 1, token.length - (selfClosing ? 2 : 1));
    const attrPattern = /([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g;
    let match: RegExpExecArray | null;
    const seenAttributes = new Set<string>();
    const attributeValues: Record<string, string> = {};
    while ((match = attrPattern.exec(attrsText))) {
      const attr = match[1], value = match[2].slice(1, -1);
      attributeValues[attr] = value;
      if (seenAttributes.has(attr)) reasons.push(`Атрибут ${attr} указан повторно`);
      seenAttributes.add(attr);
      if (!allowedAttributes.has(attr) && !(embedMetadata && attr.startsWith('data-'))) reasons.push(`Атрибут ${attr} не разрешён`);
      if (/^(?:stroke|style|filter|class|on[\w-]+)$/i.test(attr)) reasons.push(`Атрибут ${attr} запрещён`);
      if (attr === 'fill' && !/^#[\da-f]{6}$/.test(value)) reasons.push('Заливки должны быть шестизначными HEX-цветами в нижнем регистре');
      if (['viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'points', 'd', 'transform'].includes(attr) &&
        /(?:^|[^a-zA-Z0-9.])[-+]?(?:\d+\.\d{2,}|\.\d{2,})(?:e[-+]?\d+)?/i.test(value)) {
        reasons.push(`В атрибуте ${attr} указано число с точностью более одного знака после запятой`);
      }
      if (attr === 'id') {
        if (!value) reasons.push('Идентификатор SVG не может быть пустым');
        if (ids.has(value)) reasons.push(`Идентификатор "${value}" указан повторно`);
        ids.add(value);
        if (name === 'g') {
          if (!/^L\d+-[a-z0-9]+-[a-z0-9-]+$/.test(value)) {
            reasons.push(`Идентификатор слоя "${value}" не соответствует шаблону L{номер}-{роль}-{тип}`);
          } else layerIds.add(value);
        }
      }
      if (attr === 'd') {
        const tokens = value.replace(/[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?/g, ' ').match(/[a-z]/gi) ?? [];
        const commandList = tokens;
        pathCommands.push(...commandList.map((command) => command.toUpperCase()));
        const pathCommandsAllowed: readonly string[] = FLAG_VALIDATION_CONFIG.svg.allowedPathCommands;
        if (commandList.some((command) => !pathCommandsAllowed.includes(command))) {
          reasons.push('Контур содержит неподдерживаемую команду');
        }
        const pathTokens = value.match(/[A-Za-z]|[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?/g) ?? [];
        let command = '', cursor = 0;
        const checkX = (value: number) => value < -FLAG_OUTLINE_CONFIG.height * 0.1 ||
          value > width + FLAG_OUTLINE_CONFIG.height * 0.1;
        const checkY = (value: number) => value < -FLAG_OUTLINE_CONFIG.height * 0.1 ||
          value > height + FLAG_OUTLINE_CONFIG.height * 0.1;
        while (cursor < pathTokens.length) {
          if (/^[A-Za-z]$/.test(pathTokens[cursor])) command = pathTokens[cursor++];
          if (!command || !pathCommandsAllowed.includes(command)) { cursor += 1; continue; }
          if (command === 'Z') { command = ''; continue; }
          const args = command === 'A' ? 7 : command === 'H' || command === 'V' ? 1 : 2;
          if (cursor + args > pathTokens.length || /^[A-Za-z]$/.test(pathTokens[cursor])) {
            reasons.push('Для команды контура указано недостаточно координат');
            break;
          }
          const values = pathTokens.slice(cursor, cursor + args).map(Number);
          if ((command === 'M' || command === 'L') && (checkX(values[0]) || checkY(values[1]))) badCoordinates += 1;
          if (command === 'H' && checkX(values[0])) badCoordinates += 1;
          if (command === 'V' && checkY(values[0])) badCoordinates += 1;
          if (command === 'A' && (checkX(values[5]) || checkY(values[6]))) badCoordinates += 1;
          cursor += args;
          if (command === 'M') command = 'L';
        }
      }
      if (['x', 'x1', 'x2'].includes(attr)) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < -FLAG_OUTLINE_CONFIG.height * 0.1 ||
          number > width + FLAG_OUTLINE_CONFIG.height * 0.1) badCoordinates += 1;
      }
      if (['y', 'y1', 'y2'].includes(attr)) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < -FLAG_OUTLINE_CONFIG.height * 0.1 ||
          number > height + FLAG_OUTLINE_CONFIG.height * 0.1) badCoordinates += 1;
      }
      if (['cx', 'cy', 'r'].includes(attr)) {
        const number = Number(value);
        const maximum = attr === 'cx' ? width : height;
        if (!Number.isFinite(number) || number < -FLAG_OUTLINE_CONFIG.height * 0.1 ||
          number > maximum + FLAG_OUTLINE_CONFIG.height * 0.1) badCoordinates += 1;
      }
      if (attr === 'points') {
        const coordinateTokens = value.trim().split(/[ ,]+/);
        const coordinates = coordinateTokens.map(Number);
        if (coordinates.length < 6 || coordinates.length % 2 !== 0 ||
          coordinateTokens.some((coordinate) => !coordinate) ||
          coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
          reasons.push('Список точек многоугольника имеет неверный формат');
        } else {
          for (let index = 0; index < coordinates.length; index += 2) {
            if (coordinates[index] < -FLAG_OUTLINE_CONFIG.height * 0.1 ||
              coordinates[index] > width + FLAG_OUTLINE_CONFIG.height * 0.1 ||
              coordinates[index + 1] < -FLAG_OUTLINE_CONFIG.height * 0.1 ||
              coordinates[index + 1] > height + FLAG_OUTLINE_CONFIG.height * 0.1) badCoordinates += 1;
          }
        }
      }
      if (attr === 'transform') {
        const transformPattern = /(translate|rotate|scale)\(([^)]*)\)/g;
        const transforms = value.match(/(?:translate|rotate|scale)\([^)]*\)/g) ?? [];
        const residue = value.replace(transformPattern, '').replace(/[ ,]+/g, '');
        if (!transforms.length || residue) reasons.push('Преобразование SVG имеет неверный формат');
        for (const transform of transforms) {
          const name = transform.slice(0, transform.indexOf('('));
          const parameters = transform.slice(transform.indexOf('(') + 1, -1).trim().split(/[ ,]+/).filter(Boolean).map(Number);
          const validCount = name === 'translate' || name === 'scale'
            ? parameters.length === 1 || parameters.length === 2
            : parameters.length === 1 || parameters.length === 3;
          if (!validCount || parameters.some((parameter) => !Number.isFinite(parameter))) {
            reasons.push('Преобразование SVG содержит некорректные числа');
          }
        }
      }
      if (attr === 'href') {
        if (!value.startsWith('#')) reasons.push('Ссылки use должны указывать на локальные идентификаторы фрагментов');
        else references.push(value.slice(1));
      }
      if (attr === 'clip-path') {
        const reference = value.match(/^url\(#([\w.-]+)\)$/);
        if (!reference) reasons.push('clip-path должен ссылаться на локальный идентификатор');
        else references.push(reference[1]);
      }
      if (attr === 'fill-rule' && !['evenodd', 'even-odd', 'nonzero'].includes(value)) reasons.push('Неподдерживаемое правило заливки');
    }
    if (attrsText.replace(attrPattern, '').trim()) reasons.push(`Некорректные атрибуты элемента <${name}>`);
    if (name === 'rect') {
      const x = Number(attributeValues.x ?? 0), y = Number(attributeValues.y ?? 0);
      const rectWidth = Number(attributeValues.width), rectHeight = Number(attributeValues.height);
      const margin = FLAG_OUTLINE_CONFIG.height * 0.1;
      if (![x, y, rectWidth, rectHeight].every(Number.isFinite) || rectWidth < 0 || rectHeight < 0 ||
        x < -margin || y < -margin || x + rectWidth > width + margin || y + rectHeight > height + margin) {
        badCoordinates += 1;
      }
    }
    if (name === 'circle') {
      const cx = Number(attributeValues.cx), cy = Number(attributeValues.cy), radius = Number(attributeValues.r);
      const margin = FLAG_OUTLINE_CONFIG.height * 0.1;
      if (![cx, cy, radius].every(Number.isFinite) || radius < 0 ||
        cx - radius < -margin || cy - radius < -margin ||
        cx + radius > width + margin || cy + radius > height + margin) badCoordinates += 1;
    }
    if (name === 'svg') {
      const viewBox = readAttribute(token, 'viewBox');
      const numbers = viewBox?.trim().split(/[ ,]+/).map(Number);
      if (!numbers || numbers.length !== 4 || numbers[0] !== 0 || numbers[1] !== 0 ||
        numbers[2] !== width || numbers[3] !== height) reasons.push('viewBox корневого элемента должен совпадать с размерами флага');
      for (const attr of ['width', 'height']) {
        const value = readAttribute(token, attr);
        const dimension = value === undefined ? undefined : Number(value);
        if (value !== undefined && (!Number.isFinite(dimension) || dimension! <= 0 ||
          dimension! % FLAG_OUTLINE_CONFIG.height !== 0)) {
          reasons.push(`Значение ${attr} должно быть положительным и кратным 1200`);
        }
      }
    }
  }
  if (stack.length) reasons.push(`Элемент <${stack[stack.length - 1]}> не закрыт`);
  if (bytes > maxBytes) reasons.push(`Размер SVG ${bytes} байт превышает лимит ${maxBytes} байт`);
  if (badCoordinates) reasons.push(`Координат вне допустимого диапазона: ${badCoordinates}`);
  for (const reference of references) if (!ids.has(reference)) reasons.push(`Ссылка на отсутствующий идентификатор "${reference}"`);
  for (const layerId of requiredLayerIds) if (!layerIds.has(layerId)) reasons.push(`Слой "${layerId}" отсутствует в SVG`);
  return { passed: reasons.length === 0, bytes, elements: elements.length, pathCommands, badCoordinates, reasons };
}

function angleAt(previous: Point, current: Point, next: Point): number {
  const a = Math.hypot(previous.x - current.x, previous.y - current.y);
  const b = Math.hypot(next.x - current.x, next.y - current.y);
  if (!a || !b) return 0;
  const dot = (previous.x - current.x) * (next.x - current.x) + (previous.y - current.y) * (next.y - current.y);
  return Math.acos(Math.max(-1, Math.min(1, dot / (a * b)))) * 180 / Math.PI;
}

function pathArea(points: Point[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function uniqueClosedPathPoints(points: Point[]): Point[] {
  const unique: Point[] = [];
  for (const current of points) {
    const previous = unique.at(-1);
    if (!previous || Math.hypot(current.x - previous.x, current.y - previous.y) > 1e-9) unique.push(current);
  }
  if (unique.length > 1 &&
    Math.hypot(unique[0].x - unique.at(-1)!.x, unique[0].y - unique.at(-1)!.y) <= 1e-9) {
    unique.pop();
  }
  return unique;
}

function interiorAngle(points: Point[], index: number): number {
  const previous = points[(index + points.length - 1) % points.length];
  const current = points[index];
  const next = points[(index + 1) % points.length];
  const incomingX = current.x - previous.x, incomingY = current.y - previous.y;
  const outgoingX = next.x - current.x, outgoingY = next.y - current.y;
  const turn = incomingX * outgoingY - incomingY * outgoingX;
  const convexAngle = angleAt(previous, current, next);
  return turn * pathArea(points) >= 0 ? convexAngle : 360 - convexAngle;
}

function collectCatalogIds(spec: FlagSpec, output: string[] = []): string[] {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    for (const key of ['module', 'composer', 'module_id', 'composer_id']) {
      if (typeof record[key] === 'string') output.push(record[key] as string);
    }
    Object.values(record).forEach(visit);
  };
  visit(spec.root);
  return output;
}

function colorComponents(raster: FlagReferenceRaster): Map<string, { id: Int32Array; areas: number[] }> {
  const result = new Map<string, { id: Int32Array; areas: number[] }>();
  for (const [color, mask] of colorMasks(raster)) {
    const id = new Int32Array(mask.length); id.fill(-1);
    const areas: number[] = [];
    components(mask, raster.width, raster.height).forEach((part, componentId) => {
      areas[componentId] = part.area;
      for (const index of part.indices) id[index] = componentId;
    });
    result.set(color, { id, areas });
  }
  return result;
}

function downsampleMajority(raster: FlagReferenceRaster, targetHeight: number): {
  width: number;
  height: number;
  colors: (string | null)[];
  sourceToTargetIndex: Uint32Array;
} {
  const width = Math.max(1, Math.round(raster.width * targetHeight / raster.height));
  const palette = raster.colorPalette ? [...raster.colorPalette] : [];
  let sourceIds = raster.colorIds;
  if (!sourceIds || !raster.colorPalette) {
    palette.length = 0;
    sourceIds = new Uint32Array(raster.colors.length);
    const idsByColor = new Map<string, number>();
    for (let index = 0; index < raster.colors.length; index += 1) {
      const color = raster.colors[index]?.toLowerCase();
      if (!color) continue;
      let id = idsByColor.get(color);
      if (id === undefined) {
        id = palette.length + 1;
        palette.push(color);
        idsByColor.set(color, id);
      }
      sourceIds[index] = id;
    }
  }
  const stride = palette.length + 1;
  const targetSize = width * targetHeight;
  const counts = new Uint32Array(targetSize * stride);
  const firstSeen = new Int32Array(targetSize * stride).fill(-1);
  const sourceToTargetIndex = new Uint32Array(raster.width * raster.height);
  const targetX = new Uint32Array(raster.width);
  const targetY = new Uint32Array(raster.height);
  for (let x = 0; x < raster.width; x += 1) {
    targetX[x] = Math.min(width - 1, Math.ceil((x + 1) * width / raster.width) - 1);
  }
  for (let y = 0; y < raster.height; y += 1) {
    targetY[y] = Math.min(targetHeight - 1, Math.ceil((y + 1) * targetHeight / raster.height) - 1);
  }
  for (let y = 0; y < raster.height; y += 1) {
    const sourceRow = y * raster.width;
    const targetRow = targetY[y] * width;
    for (let x = 0; x < raster.width; x += 1) {
      const sourceIndex = sourceRow + x;
      const cell = targetRow + targetX[x];
      sourceToTargetIndex[sourceIndex] = cell;
      const colorId = sourceIds[sourceIndex];
      if (!colorId) continue;
      const position = cell * stride + colorId;
      counts[position] += 1;
      if (firstSeen[position] < 0) firstSeen[position] = sourceIndex;
    }
  }
  const colors: (string | null)[] = Array(targetSize).fill(null);
  for (let cell = 0; cell < targetSize; cell += 1) {
    let selectedId = 0, maximum = 0, selectedFirstSeen = Infinity;
    const offset = cell * stride;
    for (let colorId = 1; colorId < stride; colorId += 1) {
      const count = counts[offset + colorId];
      const first = firstSeen[offset + colorId];
      if (count > maximum || count === maximum && count > 0 && first < selectedFirstSeen) {
        selectedId = colorId;
        maximum = count;
        selectedFirstSeen = first;
      }
    }
    if (selectedId) colors[cell] = palette[selectedId - 1] ?? null;
  }
  return { width, height: targetHeight, colors, sourceToTargetIndex };
}

function checkV12C4(mask: ArrayLike<number>, width: number, height: number, minimum: number): number {
  if (width !== height) return 0;
  const rotate90 = (x: number, y: number) => (width - 1 - x) * width + y;
  let total = 0, same = 0;
  for (let i = 0; i < width * height; i += 1) {
    if (mask[i] || mask[rotate90(i % width, Math.floor(i / width))]) {
      total += 1;
      if (!!mask[i] === !!mask[rotate90(i % width, Math.floor(i / width))]) same += 1;
    }
  }
  if (!total || same / total < minimum) return 0;
  let hasMirror = false;
  for (const transform of [
    (x: number, y: number) => [width - 1 - x, y] as [number, number],
    (x: number, y: number) => [x, height - 1 - y] as [number, number],
    (x: number, y: number) => [y, x] as [number, number],
    (x: number, y: number) => [width - 1 - y, height - 1 - x] as [number, number],
  ]) {
    let compared = 0, equal = 0;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const [tx, ty] = transform(x, y);
      const current = !!mask[y * width + x], reflected = !!mask[ty * width + tx];
      if (current || reflected) {
        compared += 1;
        if (current === reflected) equal += 1;
      }
    }
    if (compared && equal / compared >= minimum) hasMirror = true;
  }
  return hasMirror ? 0 : same / total;
}

/** Проверяет все машиночитаемые правила V01–V16 по итоговым эталонным данным. */
export function validateFlag(
  spec: FlagSpec,
  evidence: FlagValidationEvidence,
  options: FlagValidationOptions = {},
): FlagValidationReport {
  const mandatoryCompositionRules = new Set<FlagValidationRule>(['V02', 'V03', 'V08', 'V14']);
  const skippedRules = new Set(options.skipRules ?? []);
  const shouldRun = (rule: FlagValidationRule) => !skippedRules.has(rule) &&
    (!options.onlyRules || options.onlyRules.includes(rule) || mandatoryCompositionRules.has(rule));
  const ignoredLayerIds = new Set(options.ignoreLayerIds ?? []);
  const now = () => typeof globalThis.performance === 'undefined' ? Date.now() : globalThis.performance.now();
  let lastRuleTimingAt = options.onRuleTiming ? now() : 0;
  const recordRuleTiming = (rule: FlagValidationRule, section: string = rule) => {
    if (!options.onRuleTiming) return;
    const current = now();
    options.onRuleTiming(rule, current - lastRuleTimingAt, section);
    lastRuleTimingAt = current;
  };
  const thresholds = { ...options.thresholds };
  const config = FLAG_VALIDATION_CONFIG;
  assertRaster(evidence.raster);
  const raster = evidence.raster, width = raster.width, height = raster.height;
  const colorData = colorMaskData(raster, false);
  const colors = colorData.areas;
  const colorCounts = colorData.areas;
  const area = [...colorCounts.values()].reduce((sum, count) => sum + count, 0);
  if (!area) throw new RangeError('Эталонный растр должен содержать хотя бы один пиксель флага');
  const componentRaster = evidence.componentRaster ?? raster;
  assertRaster(componentRaster);
  const componentWidth = componentRaster.width, componentHeight = componentRaster.height;
  const usesHighResolution = Boolean(evidence.componentRaster) ||
    raster.height >= config.components.highResolutionRasterHeight;
  const componentReferenceHeight = usesHighResolution
    ? config.components.highResolutionRasterHeight
    : config.referenceRasterHeight;
  const componentUnitsPerPixel = usesHighResolution
    ? config.components.highResolutionUnitsPerPixel
    : config.physical.referenceUnitsPerPixel;
  const componentPaths = evidence.componentPaths ?? evidence.paths;
  const pathsByLayerId = new Map<string, (typeof componentPaths)[number][]>();
  for (const path of componentPaths) {
    if (!path.layerId) continue;
    const paths = pathsByLayerId.get(path.layerId) ?? [];
    paths.push(path);
    pathsByLayerId.set(path.layerId, paths);
  }
  const pathsForLayers = (layerIds: readonly string[], minX: number, minY: number) => {
    const paths: (typeof componentPaths)[number][] = [];
    for (const layerId of layerIds) {
      for (const path of pathsByLayerId.get(layerId) ?? []) {
        paths.push({
          ...path,
          points: path.points.map(({ x, y }) => ({ x: x - minX, y: y - minY })),
        });
      }
    }
    return paths;
  };
  const minimumGapPx = thresholds.minimumGapPx ??
    config.physical.minimumGap * config.physical.validationFactor / config.physical.referenceUnitsPerPixel *
      height / config.referenceRasterHeight;
  const shares = new Map([...colorCounts].map(([color, count]) => [color, count / area]));
  recordRuleTiming('V01', 'V01-растр-и-цвета');
  const profile = getFlagProfile(spec.profile_id);
  const maxComplexity = thresholds.maximumComplexity ?? profile?.CMAX ?? config.maximumComplexity;
  const layerCount = evidence.layers.length;
  const missingMasks = evidence.layers.filter(({ id }) => !raster.layerMasks[id]);
  const slotRaster = evidence.slotRaster;
  let paletteValidation: {
    slotRasterReady: boolean;
    paletteChecks: ReturnType<typeof validateFlagPalette>;
  } | undefined;
  const getPaletteValidation = () => {
    if (paletteValidation) return paletteValidation;
    const slotRasterReady = (shouldRun('V05') || shouldRun('V13')) &&
      validSlotRaster(slotRaster, width, height, spec.slots.items);
    const paletteChecks = slotRasterReady
      ? validateFlagPalette(spec, spec.palette, {
        slotRaster,
        era: spec.era,
        chargeBackgrounds: evidence.chargeBackgrounds ?? [],
        tincture: evidence.tincture ?? false,
      })
      : [];
    paletteValidation = { slotRasterReady, paletteChecks };
    return paletteValidation;
  };
  const checks = {} as Record<FlagValidationRule, FlagValidationCheck>;
  const stopIfFailed = () => options.stopAfterFirstFailure === true &&
    Object.values(checks).some((result) => result && !result.passed);
  const shouldStopAfterFailure = () => options.stopAfterFirstFailure === true &&
    Object.values(checks).some((result) => result && !result.passed);
  const calculateV06 = () => {
    // V06 использует готовые площади и моменты цвета, без высокодетального растра.
    const [dominant, dominantCount] = [...colorCounts].sort((a, b) => b[1] - a[1])[0];
    const dominantShare = dominantCount / area;
    let averageLab: ReturnType<typeof srgbToLab> | null = null;
    if (dominantShare < 0.45) {
      let l = 0, a = 0, b = 0;
      for (const [color, count] of colorCounts) {
        const lab = srgbToLab(color), share = count / area;
        l += lab.l * share;
        a += lab.a * share;
        b += lab.b * share;
      }
      averageLab = { l, a, b };
    }
    const weightByColor = new Map<string, number>();
    for (const color of colorCounts.keys()) {
      const lab = averageLab ? srgbToLab(color) : null;
      const weight = averageLab && lab
        ? Math.hypot(lab.l - averageLab.l, lab.a - averageLab.a, lab.b - averageLab.b) / 100
        : deltaE76(color, dominant) / 100;
      weightByColor.set(color, weight);
    }
    let weightSum = 0, weightedX = 0, weightedY = 0;
    for (const [color, count] of colorCounts) {
      const weight = weightByColor.get(color) ?? 0;
      weightSum += count * weight;
      weightedX += (colorData.xSums.get(color) ?? 0) / width * weight;
      weightedY += (colorData.ySums.get(color) ?? 0) / height * weight;
    }
    const centroid = weightSum > 0 ? { x: weightedX / weightSum, y: weightedY / weightSum } : null;
    const profileRegion = profile?.BAL
      ? [profile.BAL.x[0], profile.BAL.x[1], profile.BAL.y[0], profile.BAL.y[1]]
      : [...config.balance.defaultRegion];
    const outlineRegion = spec.outline.type === 'BANNER'
      ? [0.30, 0.70, 0.20, 0.60]
      : ['PENNANT', 'DOUBLE_PENNANT'].includes(spec.outline.type)
        ? [0.18, 0.60, 0.30, 0.70]
        : spec.outline.type === 'SWALLOW'
          ? [0.28, 0.60, profileRegion[2], profileRegion[3]]
          : null;
    const region = outlineRegion
      ? [
        Math.min(profileRegion[0], outlineRegion[0]),
        Math.max(profileRegion[1], outlineRegion[1]),
        Math.min(profileRegion[2], outlineRegion[2]),
        Math.max(profileRegion[3], outlineRegion[3]),
      ]
      : profileRegion;
    const weightShare = weightSum / area;
    return check(colors.size > 1 && weightShare >= (thresholds.minimumBalanceWeightShare ?? config.balance.minimumWeightShare) &&
      !!centroid && centroid.x >= region[0] && centroid.x <= region[1] &&
      centroid.y >= region[2] && centroid.y <= region[3],
    { weightShare, centroidX: centroid?.x ?? null, centroidY: centroid?.y ?? null, reference: averageLab ? 'area-average' : 'dominant', dominantShare },
    { minimumWeightShare: thresholds.minimumBalanceWeightShare ?? config.balance.minimumWeightShare,
      x: [region[0], region[1]], y: [region[2], region[3]] },
    colors.size < 2 ? ['single-color flags cannot pass V06'] : []);
  };
  let earlyV06Check: FlagValidationCheck | undefined;

  if (shouldRun('V01')) {
  // V01: сложность и ограничения развёрнутой геометрии.
  const structureCounts = {
    complexity: spec.meta.complexity,
    layers: layerCount,
    primitives: evidence.primitiveCount,
    pathPoints: evidence.pathPointCount,
  };
  const limits = {
    complexity: maxComplexity,
    layers: thresholds.maximumLayers ?? config.limits.layers,
    primitives: thresholds.maximumPrimitives ?? config.limits.primitives,
    pathPoints: thresholds.maximumPathPoints ?? config.limits.pathPoints,
  };
  const v01Missing = [maxComplexity === null ? 'В профиле не задан CMAX и не настроен maximumComplexity' : '',
    Number.isFinite(evidence.primitiveCount) ? '' : 'Не указано число развёрнутых примитивов',
    Number.isFinite(evidence.pathPointCount) ? '' : 'Не указано число точек путей'].filter(Boolean);
  checks.V01 = check(
    v01Missing.length === 0 && spec.meta.complexity <= (maxComplexity ?? -Infinity) &&
      layerCount <= limits.layers && evidence.primitiveCount <= limits.primitives &&
      evidence.pathPointCount <= limits.pathPoints,
    structureCounts,
    { complexity: maxComplexity, layers: limits.layers, primitives: limits.primitives, pathPoints: limits.pathPoints },
    v01Missing,
  );
  recordRuleTiming('V01');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (options.stopAfterFirstFailure && shouldRun('V06')) {
    earlyV06Check = calculateV06();
    recordRuleTiming('V06');
    if (!earlyV06Check.passed) {
      checks.V06 = earlyV06Check;
      return { passed: false, checks };
    }
  }

  const componentNeighbors = config.components.foregroundConnectivity === 8
    ? PIXEL_NEIGHBORS_8
    : PIXEL_NEIGHBORS;
  type VisibleComponent = ReturnType<typeof componentsByColor>[number];
  let cachedVisibleComponents: VisibleComponent[] | undefined;
  const getVisibleComponents = () => {
    if (!cachedVisibleComponents) {
      cachedVisibleComponents = shouldRun('V02') || shouldRun('V03')
        ? componentsByColor(componentRaster, componentWidth, componentHeight, componentNeighbors)
        : [];
    }
    return cachedVisibleComponents;
  };
  const adjacentLayerCache = new WeakMap<object, string[]>();
  const adjacentLayerIds = (component: VisibleComponent): string[] => {
    const cached = adjacentLayerCache.get(component);
    if (cached) return cached;
    const indices = componentRaster.layerIdIndices;
    const palette = componentRaster.layerIdPalette;
    if (!indices || !palette) return [];
    const ownLayers = new Set(component.layerIds);
    const counts = new Map<string, number>();
    const sampleStep = Math.max(1, Math.floor(component.indices.length / 256));
    for (let offset = 0; offset < component.indices.length; offset += sampleStep) {
      const index = component.indices[offset];
      const x = index % componentWidth;
      const y = Math.floor(index / componentWidth);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighborX = x + dx;
          const neighborY = y + dy;
          if (neighborX < 0 || neighborX >= componentWidth || neighborY < 0 || neighborY >= componentHeight) continue;
          const layerIndex = indices[neighborY * componentWidth + neighborX];
          const layerId = layerIndex ? palette[layerIndex - 1] : undefined;
          if (layerId && !ownLayers.has(layerId)) counts.set(layerId, (counts.get(layerId) ?? 0) + 1);
        }
      }
    }
    const result = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([layerId]) => layerId);
    adjacentLayerCache.set(component, result);
    return result;
  };

  if (shouldRun('V02')) {
  const visibleComponents = getVisibleComponents();
  // V02: толщина компонентов и сохранение деталей после морфологического раскрытия.
  const minimumThicknessPx = thresholds.minimumThicknessPx ??
    config.physical.minimumThickness * config.physical.validationFactor / componentUnitsPerPixel *
      componentHeight / componentReferenceHeight;
  const openingRadius = Math.max(1, Math.round(
    config.components.openingRadiusPx * componentHeight / componentReferenceHeight,
  ));
  const smallAreaComponents: string[] = [];
  let maxOpeningLoss = 0, thinComponents = 0;
  const repeatOrGlyph = new Set(evidence.layers.filter((layer) =>
    layer.tags?.some((tag) => tag.toLowerCase() === 'repeat' || tag.toLowerCase() === 'glyph')).map(({ id }) => id));
  const componentArea = visibleComponents.reduce((sum, component) => sum + component.area, 0);
  recordRuleTiming('V02', 'V02-компоненты');
  for (const component of visibleComponents) {
    if (options.stopAfterFirstFailure && (smallAreaComponents.length > 0 || thinComponents > 0)) break;
    const { color, layerIds } = component;
    const bounds = `x=${component.minX}..${component.maxX},y=${component.minY}..${component.maxY}`;
    const boundsArea = (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1);
    const shapeEvidence = `${bounds}; площадь ${component.area} пикс., заполнение ${(component.area / boundsArea * 100).toFixed(1)}%`;
    const adjacentLayers = () => adjacentLayerIds(component);
    const adjacentText = () => {
      const neighbors = adjacentLayers();
      return neighbors.length ? `; рядом: ${neighbors.join(', ')}` : '';
    };
    const share = component.area / componentArea;
    const repeatDetail = layerIds.some((id) => repeatOrGlyph.has(id));
    const scheduledForRemoval = layerIds.length > 0 && layerIds.every((id) => ignoredLayerIds.has(id));
    if (share < config.components.forbiddenAreaShare && !repeatDetail && !scheduledForRemoval) {
      smallAreaComponents.push(
        `${layerIds[0] ?? color}: доля площади ${(share * 100).toFixed(3)}% (${shapeEvidence}${adjacentText()})`,
      );
    }
    if (share < config.components.minimumAreaShare) {
      if (scheduledForRemoval) continue;
      if (repeatDetail) {
        const minimumFeatureWidth = Math.min(
          component.maxX - component.minX + 1,
          component.maxY - component.minY + 1,
        );
        if (minimumFeatureWidth < minimumThicknessPx) {
          thinComponents += 1;
          smallAreaComponents.push(
            `${layerIds[0] ?? color}: ширина повтора или глифа ${minimumFeatureWidth.toFixed(2)} пикс. (${shapeEvidence}${adjacentText()})`,
          );
        }
      }
      continue;
    }
    const cropMargin = openingRadius * 2;
    const cropMinX = Math.max(0, component.minX - cropMargin);
    const cropMinY = Math.max(0, component.minY - cropMargin);
    const cropMaxX = Math.min(componentWidth - 1, component.maxX + cropMargin);
    const cropMaxY = Math.min(componentHeight - 1, component.maxY + cropMargin);
    const cropWidth = cropMaxX - cropMinX + 1;
    const cropHeight = cropMaxY - cropMinY + 1;
    const isolated = new Uint8Array(cropWidth * cropHeight);
    for (let offset = 0; offset < component.indices.length; offset += 1) {
      const index = component.indices[offset];
      const y = Math.floor(index / componentWidth), x = index - y * componentWidth;
      const localX = x - cropMinX, localY = y - cropMinY;
      const localIndex = localY * cropWidth + localX;
      isolated[localIndex] = 1;
    }
    recordRuleTiming('V02', 'V02-локальная-маска');
    const pathsForComponent = pathsForLayers(layerIds, cropMinX, cropMinY);
    const exclusion = acuteTipExclusionMask(
      pathsForComponent,
      cropWidth,
      cropHeight,
      openingRadius,
      config.components.acuteTipAngleDegrees,
      'convex',
    );
    recordRuleTiming('V02', 'V02-исключение-углов');
    const opened = morphologySequence(isolated, cropWidth, cropHeight, openingRadius, ['erode', 'dilate']);
    recordRuleTiming('V02', 'V02-морфология');
    let measuredArea = 0;
    let lostPixels = 0;
    for (let localIndex = 0; localIndex < isolated.length; localIndex += 1) {
      if (!isolated[localIndex] || exclusion[localIndex]) continue;
      measuredArea += 1;
      if (!opened[localIndex]) lostPixels += 1;
    }
    const loss = lostPixels / Math.max(1, measuredArea);
    recordRuleTiming('V02', 'V02-подсчёт-потерь');
    maxOpeningLoss = Math.max(maxOpeningLoss, loss);
    if (loss > (thresholds.maximumOpeningLoss ?? config.components.maximumOpeningLoss)) {
      thinComponents += 1;
      smallAreaComponents.push(
        `${layerIds[0] ?? color}: потеря раскрытия ${(loss * 100).toFixed(2)}% (${shapeEvidence}${adjacentText()})`,
      );
    }
  }
  recordRuleTiming('V02', 'V02-толщина');
  checks.V02 = check(smallAreaComponents.length === 0 && thinComponents === 0,
    { maxOpeningLoss, thinComponents, forbiddenSmallComponents: smallAreaComponents.length },
    { maximumOpeningLoss: thresholds.maximumOpeningLoss ?? config.components.maximumOpeningLoss,
      forbiddenAreaShare: config.components.forbiddenAreaShare, minimumThicknessPx },
    smallAreaComponents.slice(0, 8));
  recordRuleTiming('V02', 'V02-итог');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V03')) {
  const visibleComponents = getVisibleComponents();
  // V03: прирост площади после замыкания измеряется отдельно для каждой видимой цветовой маски.
  const closingRadius = Math.max(1, Math.round(
    config.components.closingRadiusPx * componentHeight / componentReferenceHeight,
  ));
  const visibleComponentGroups = new Map<string, {
    parts: typeof visibleComponents;
    layerIds: Set<string>;
    bounds: PixelMaskBounds;
  }>();
  for (const component of visibleComponents) {
    let group = visibleComponentGroups.get(component.color);
    if (!group) {
      group = {
        parts: [],
        layerIds: new Set<string>(),
        bounds: {
          minX: component.minX, minY: component.minY,
          maxX: component.maxX, maxY: component.maxY,
        },
      };
      visibleComponentGroups.set(component.color, group);
    } else {
      group.bounds.minX = Math.min(group.bounds.minX, component.minX);
      group.bounds.minY = Math.min(group.bounds.minY, component.minY);
      group.bounds.maxX = Math.max(group.bounds.maxX, component.maxX);
      group.bounds.maxY = Math.max(group.bounds.maxY, component.maxY);
    }
    group.parts.push(component);
    for (const layerId of component.layerIds) group.layerIds.add(layerId);
  }
  recordRuleTiming('V03', 'V03-компоненты');
  const closingLimit = thresholds.maximumClosingIncrease ?? config.components.maximumClosingIncrease;
  const closingMeasurements: { color: string; layerIds: string[]; growth: number }[] = [];
  for (const color of visibleComponentGroups.keys()) {
    const group = visibleComponentGroups.get(color);
    const layerIds = group ? [...group.layerIds] : [];
    if (layerIds.length > 0 && layerIds.every((id) => ignoredLayerIds.has(id))) {
      closingMeasurements.push({ color, layerIds, growth: 0 });
      continue;
    }
    const bounds = group?.bounds ??
      { minX: 0, minY: 0, maxX: componentWidth - 1, maxY: componentHeight - 1 };
    const cropMargin = closingRadius * 2;
    const cropMinX = Math.max(0, bounds.minX - cropMargin);
    const cropMinY = Math.max(0, bounds.minY - cropMargin);
    const cropMaxX = Math.min(componentWidth - 1, bounds.maxX + cropMargin);
    const cropMaxY = Math.min(componentHeight - 1, bounds.maxY + cropMargin);
    const cropWidth = cropMaxX - cropMinX + 1;
    const cropHeight = cropMaxY - cropMinY + 1;
    const localMask = new Uint8Array(cropWidth * cropHeight);
    for (const component of group?.parts ?? []) {
      for (let offset = 0; offset < component.indices.length; offset += 1) {
        const sourceIndex = component.indices[offset];
        const y = Math.floor(sourceIndex / componentWidth);
        const x = sourceIndex - y * componentWidth;
        localMask[(y - cropMinY) * cropWidth + x - cropMinX] = 1;
      }
    }
    recordRuleTiming('V03', 'V03-маска');
    const localPaths = pathsForLayers(layerIds, cropMinX, cropMinY);
    const exclusion = acuteTipExclusionMask(
      localPaths,
      cropWidth,
      cropHeight,
      closingRadius,
      config.components.acuteTipAngleDegrees,
      'concave',
    );
    recordRuleTiming('V03', 'V03-исключение-углов');
    const closed = morphologySequence(localMask, cropWidth, cropHeight, closingRadius, ['dilate', 'erode']);
    recordRuleTiming('V03', 'V03-морфология');
    let baseArea = 0, addedArea = 0;
    for (let index = 0; index < localMask.length; index += 1) {
      if (exclusion[index]) continue;
      const original = !!localMask[index], closedPixel = !!closed[index];
      baseArea += Number(original);
      addedArea += Number(!original && closedPixel);
    }
    const growth = addedArea / Math.max(1, baseArea);
    recordRuleTiming('V03', 'V03-подсчёт-прироста');
    closingMeasurements.push({ color, layerIds, growth });
    if (options.stopAfterFirstFailure && growth > closingLimit) break;
  }
  const maxClosingGrowth = Math.max(0, ...closingMeasurements.map(({ growth }) => growth));
  checks.V03 = check(maxClosingGrowth <= (thresholds.maximumClosingIncrease ?? config.components.maximumClosingIncrease),
    maxClosingGrowth, closingLimit,
    closingMeasurements.filter(({ growth }) => growth > closingLimit)
      .map(({ color, layerIds, growth }) => `${layerIds[0] ?? color}: прирост замыкания ${(growth * 100).toFixed(2)}%`));
  recordRuleTiming('V03');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V04')) {
  // V04: уменьшение до 32 пикселей и сохранение значимых связных деталей.
  const small = downsampleMajority(raster, config.components.smallRasterHeight);
  recordRuleTiming('V04', 'V04-уменьшение');
  const smallRaster: FlagReferenceRaster = {
    width: small.width, height: small.height, colors: small.colors,
    layerIds: Array(small.colors.length).fill(null), layerMasks: {},
  };
  const smallComponents = colorComponents(smallRaster);
  recordRuleTiming('V04', 'V04-компоненты');
  let minRetention = 1, lostSmallComponents = 0;
  const significantColors = new Set([...shares].filter(([, share]) => share >= config.colors.minimumShare).map(([color]) => color));
  let missingSignificantColors = 0;
  for (const color of significantColors) if (!small.colors.includes(color)) missingSignificantColors += 1;
  const scale = (small.width * small.height) / (width * height);
  const lowResolutionComponents = options.stopAfterFirstFailure && missingSignificantColors > 0
    ? []
    : componentRaster === raster
      ? getVisibleComponents()
      : componentsByColor(raster, width, height, componentNeighbors);
  const lostSmallComponentDetails: string[] = [];
  for (const { color, layerIds, indices, area: lowComponentArea } of lowResolutionComponents) {
    if (options.stopAfterFirstFailure &&
      (missingSignificantColors > 0 || lostSmallComponents > 0)) break;
    if (lowComponentArea / area < config.components.smallRasterComponentShare) continue;
    const smallData = smallComponents.get(color);
    const targetIds = smallData?.id;
    const votes = new Uint32Array(smallData?.areas.length ?? 0);
    const firstVoteOrder = new Int32Array(votes.length).fill(-1);
    let nextVoteOrder = 0;
    for (let offset = 0; offset < indices.length; offset += 1) {
      const index = indices[offset];
      const targetId = targetIds?.[small.sourceToTargetIndex[index]] ?? -1;
      if (targetId >= 0 && targetId < votes.length) {
        if (firstVoteOrder[targetId] < 0) firstVoteOrder[targetId] = nextVoteOrder++;
        votes[targetId] += 1;
      }
    }
    let componentId = -1, maximumVotes = 0, earliestVoteOrder = Infinity;
    for (let targetId = 0; targetId < votes.length; targetId += 1) {
      if (votes[targetId] > maximumVotes ||
          votes[targetId] === maximumVotes && votes[targetId] > 0 && firstVoteOrder[targetId] < earliestVoteOrder) {
        componentId = targetId;
        maximumVotes = votes[targetId];
        earliestVoteOrder = firstVoteOrder[targetId];
      }
    }
    const reducedArea = componentId >= 0 ? smallData!.areas[componentId] : 0;
    const expected = lowComponentArea * scale;
    const retention = expected ? reducedArea / expected : 0;
    minRetention = Math.min(minRetention, retention);
    if (retention < config.components.minimumSmallRasterRetention) {
      lostSmallComponents += 1;
      if (lostSmallComponentDetails.length < 12) {
        lostSmallComponentDetails.push(
          `${layerIds[0] ?? color}: сохранение ${(retention * 100).toFixed(1)}%`,
        );
      }
    }
  }
  recordRuleTiming('V04', 'V04-сохранение-деталей');
  checks.V04 = check(missingSignificantColors === 0 && lostSmallComponents === 0,
    { minimumComponentRetention: minRetention, missingSignificantColors, lostComponents: lostSmallComponents },
    { minimumColorShare: config.colors.minimumShare, minimumComponentShare: config.components.smallRasterComponentShare,
      minimumRetention: config.components.minimumSmallRasterRetention },
    lostSmallComponentDetails);
  recordRuleTiming('V04');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V05')) {
  const { slotRasterReady, paletteChecks } = getPaletteValidation();
  // V05: C1 и C2 измеряются по итоговым цветам, а C3 использует проверку раскладки слотов.
  if (!slotRasterReady || !slotRaster) checks.V05 = unavailable('Нужен корректный итоговый растр слотов для проверки C1–C3');
  else {
    let minimumAdjacentDeltaE = Infinity, adjacentPairs = 0;
    const colorIds = raster.colorIds, colorPalette = raster.colorPalette;
    if (colorIds && colorPalette) {
      const distanceStride = colorPalette.length + 1;
      const adjacentDistances = new Float64Array(distanceStride * distanceStride);
      for (let firstId = 1; firstId <= colorPalette.length; firstId += 1) {
        for (let secondId = 1; secondId <= colorPalette.length; secondId += 1) {
          adjacentDistances[firstId * distanceStride + secondId] =
            deltaE76(colorPalette[firstId - 1], colorPalette[secondId - 1]);
        }
      }
      const adjacentPairCounts = new Uint32Array(distanceStride * distanceStride);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const index = y * width + x, colorId = colorIds[index];
        if (!colorId) continue;
        if (x + 1 < width) {
          const otherId = colorIds[index + 1];
          if (otherId && otherId !== colorId) {
            const low = Math.min(colorId, otherId), high = Math.max(colorId, otherId);
            adjacentPairCounts[low * distanceStride + high] += 1;
          }
        }
        if (y + 1 < height) {
          const otherId = colorIds[index + width];
          if (otherId && otherId !== colorId) {
            const low = Math.min(colorId, otherId), high = Math.max(colorId, otherId);
            adjacentPairCounts[low * distanceStride + high] += 1;
          }
        }
      }
      for (let firstId = 1; firstId <= colorPalette.length; firstId += 1) {
        for (let secondId = firstId + 1; secondId <= colorPalette.length; secondId += 1) {
          const pairCount = adjacentPairCounts[firstId * distanceStride + secondId];
          if (!pairCount) continue;
          adjacentPairs += pairCount;
          minimumAdjacentDeltaE = Math.min(minimumAdjacentDeltaE,
            adjacentDistances[firstId * distanceStride + secondId]);
        }
      }
    } else {
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const index = y * width + x, color = raster.colors[index];
        if (!color) continue;
        if (x + 1 < width) {
          const other = raster.colors[index + 1];
          if (other && other !== color) {
            adjacentPairs += 1;
            minimumAdjacentDeltaE = Math.min(minimumAdjacentDeltaE, deltaE76(color, other));
          }
        }
        if (y + 1 < height) {
          const other = raster.colors[index + width];
          if (other && other !== color) {
            adjacentPairs += 1;
            minimumAdjacentDeltaE = Math.min(minimumAdjacentDeltaE, deltaE76(color, other));
          }
        }
      }
    }
    recordRuleTiming('V05', 'V05-смежность');
    const adjacencyLimit = thresholds.minimumAdjacentDeltaE ?? config.colors.minimumAdjacentDeltaE;
    const chargeDetails: string[] = [];
    let minimumChargeDeltaE = Infinity, minimumChargeContrast = Infinity, checkedChargePairs = 0;
    const chargeChecks = evidence.chargeBackgrounds ?? [];
    if (evidence.layers.some(({ role }) => role === 'charge') && chargeChecks.length === 0) {
      chargeDetails.push('Для зарядов не заданы пары цветов «заряд — фон»');
    }
    const numericSlotValues = slotRaster.slotIds && ArrayBuffer.isView(slotRaster.values) &&
      typeof slotRaster.values[0] === 'number'
      ? slotRaster.values as ArrayLike<number>
      : null;
    const numericCodeBySlot = new Map(
      Object.entries(slotRaster.slotIds ?? {}).map(([code, slot]) => [slot, Number(code)]),
    );
    const chargeLayersBySlot = new Map<string, (typeof evidence.layers)[number][]>();
    for (const layer of evidence.layers) {
      if (layer.role !== 'charge' || !layer.slot) continue;
      const matching = chargeLayersBySlot.get(layer.slot) ?? [];
      matching.push(layer);
      chargeLayersBySlot.set(layer.slot, matching);
    }
    const chargePairMetrics = new Map<string, {
      boundaries: number;
      pairDeltaE: number;
      pairContrast: number;
    }>();
    const colorAt = (index: number) => {
      const colorId = raster.colorIds?.[index] ?? 0;
      return colorId && raster.colorPalette
        ? raster.colorPalette[colorId - 1] ?? null
        : raster.colors[index];
    };
    for (const charge of chargeChecks) {
      const cacheKey = `${charge.chargeSlot}\u0000${charge.backgroundSlot}`;
      let metrics = chargePairMetrics.get(cacheKey);
      if (!metrics) {
        let pairDeltaE = Infinity, pairContrast = Infinity, boundaries = 0;
        const chargeLayersForSlot = chargeLayersBySlot.get(charge.chargeSlot) ?? [];
        const layerMasks = chargeLayersForSlot
          .map((layer) => ({ layer, mask: raster.layerMasks[layer.id] }))
          .filter((entry): entry is { layer: typeof chargeLayersForSlot[number]; mask: Uint8Array } => !!entry.mask);
        const chargeCode = numericCodeBySlot.get(charge.chargeSlot);
        const backgroundCode = numericCodeBySlot.get(charge.backgroundSlot);
        const isSlot = (index: number, slot: string, code: number | undefined) =>
          numericSlotValues && code !== undefined
            ? numericSlotValues[index] === code
            : slotAt(slotRaster, index) === slot;
        const inspectChargePixel = (index: number, x: number, y: number) => {
          if (!isSlot(index, charge.chargeSlot, chargeCode)) return;
          for (const [dx, dy] of PIXEL_NEIGHBORS) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const next = ny * width + nx;
            if (!isSlot(next, charge.backgroundSlot, backgroundCode)) continue;
            const foreground = colorAt(index), background = colorAt(next);
            if (!foreground || !background) continue;
            boundaries += 1;
            pairDeltaE = Math.min(pairDeltaE, deltaE76(foreground, background));
            pairContrast = Math.min(pairContrast, wcagContrast(foreground, background));
          }
        };
        if (chargeLayersForSlot.length && layerMasks.length === chargeLayersForSlot.length) {
          for (const { layer, mask } of layerMasks) {
            const bounds = raster.layerBounds?.[layer.id] ?? getMaskBounds(mask, width, height);
            if (!bounds) continue;
            for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
              const row = y * width;
              for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
                const index = row + x;
                if (mask[index]) inspectChargePixel(index, x, y);
              }
            }
          }
        } else {
          for (let index = 0; index < slotRaster.values.length; index += 1) {
            if (isSlot(index, charge.chargeSlot, chargeCode)) {
              inspectChargePixel(index, index % width, Math.floor(index / width));
            }
          }
        }
        metrics = { boundaries, pairDeltaE, pairContrast };
        chargePairMetrics.set(cacheKey, metrics);
      }
      const { boundaries, pairDeltaE, pairContrast } = metrics;
      if (!boundaries) {
        chargeDetails.push(`${charge.chargeSlot}/${charge.backgroundSlot}: не найдена граница заряда с фоном`);
        continue;
      }
      checkedChargePairs += 1;
      minimumChargeDeltaE = Math.min(minimumChargeDeltaE, pairDeltaE);
      minimumChargeContrast = Math.min(minimumChargeContrast, pairContrast);
      const small = (charge.diameterRatio ?? 1) < config.colors.smallChargeDiameterRatio;
      const minContrast = small
        ? thresholds.minimumSmallOutlinedChargeContrast ?? config.colors.minimumSmallOutlinedChargeContrast
        : thresholds.minimumChargeContrast ?? config.colors.minimumChargeContrast;
      if (pairDeltaE < (thresholds.minimumChargeDeltaE ?? config.colors.minimumChargeDeltaE)) {
        chargeDetails.push(`${charge.chargeSlot}/${charge.backgroundSlot}: ΔE ${pairDeltaE.toFixed(2)} меньше установленного порога`);
      }
      if ((small || !charge.outlined) && pairContrast < minContrast) {
        chargeDetails.push(`${charge.chargeSlot}/${charge.backgroundSlot}: контраст ${pairContrast.toFixed(2)} меньше ${minContrast}`);
      }
    }
    recordRuleTiming('V05', 'V05-заряды');
    const c3 = paletteChecks.filter(({ rule }) => rule === 'C3');
    const c3Failures = c3.filter(({ passed }) => !passed);
    const failedC1 = minimumAdjacentDeltaE < adjacencyLimit;
    if (failedC1) chargeDetails.push(`Смежные области: ΔE ${minimumAdjacentDeltaE.toFixed(2)} меньше ${adjacencyLimit}`);
      if (c3Failures.length) chargeDetails.push('Нарушено правило C3 для чередования металлов и цветов');
    checks.V05 = check(!failedC1 && chargeDetails.length === 0,
      { minimumAdjacentDeltaE: Number.isFinite(minimumAdjacentDeltaE) ? minimumAdjacentDeltaE : null,
        adjacentPairs, minimumChargeDeltaE: Number.isFinite(minimumChargeDeltaE) ? minimumChargeDeltaE : null,
        minimumChargeContrast: Number.isFinite(minimumChargeContrast) ? minimumChargeContrast : null,
        checkedChargePairs, failedC3Rules: c3Failures.length },
      { C1: adjacencyLimit, C2: thresholds.minimumChargeDeltaE ?? config.colors.minimumChargeDeltaE,
        C2Contrast: thresholds.minimumChargeContrast ?? config.colors.minimumChargeContrast },
      chargeDetails);
  }
  recordRuleTiming('V05');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V06')) {
    checks.V06 = earlyV06Check ?? calculateV06();
    if (!earlyV06Check) recordRuleTiming('V06');
    if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V07')) {
  // V07: доли цветов в итоговом видимом растре.
  const minimumColorShare = thresholds.minimumColorShare ?? config.colors.minimumShare;
  const maximumColorShare = thresholds.maximumColorShare ?? config.colors.maximumShare;
  const minimumShare = Math.min(...shares.values()), maximumShare = Math.max(...shares.values());
  checks.V07 = check(minimumShare >= minimumColorShare && maximumShare <= maximumColorShare,
    { minimumShare, maximumShare, colorCount: colors.size },
    { minimumShare: minimumColorShare, maximumShare: maximumColorShare });
  recordRuleTiming('V07');
  if (stopIfFailed()) return { passed: false, checks };
  }

  // V08: пересечения и расстояния между слоями с учётом родства и явно разрешённых наложений.
  const collisionDetails: string[] = [];
  let maximumOverlap = 0, minimumMeasuredNearGap = Infinity, minimumUnrelatedGapLowerBound = Infinity;
  const maskInfo = new Map<string, {
    mask: Uint8Array;
    area: number;
    bounds: PixelMaskBounds | null;
  }>();
  for (const layer of evidence.layers) {
    const mask = raster.layerMasks[layer.id];
    if (!mask) continue;
    const hasBounds = !!raster.layerBounds && Object.prototype.hasOwnProperty.call(raster.layerBounds, layer.id);
    maskInfo.set(layer.id, {
      mask,
      area: raster.layerAreas?.[layer.id] ?? sumMask(mask),
      bounds: hasBounds ? raster.layerBounds![layer.id] : getMaskBounds(mask, width, height),
    });
  }
  for (let i = 0; i < evidence.layers.length; i += 1) for (let j = i + 1; j < evidence.layers.length; j += 1) {
    const first = evidence.layers[i], second = evidence.layers[j];
    if (ignoredLayerIds.has(first.id) || ignoredLayerIds.has(second.id)) continue;
    const firstCharge = first.role === 'charge';
    const secondCharge = second.role === 'charge';
    const eligiblePair = firstCharge && secondCharge ||
      firstCharge && second.role === 'ordinary' ||
      secondCharge && first.role === 'ordinary';
    if (!eligiblePair || firstCharge && first.anchor === 'A3' || secondCharge && second.anchor === 'A3') continue;
    const related = first.parentId === second.id || second.parentId === first.id ||
      first.overlayWith?.includes(second.id) || second.overlayWith?.includes(first.id);
    const aInfo = maskInfo.get(first.id), bInfo = maskInfo.get(second.id);
    if (related || !aInfo?.bounds || !bInfo?.bounds) continue;
    const a = aInfo.mask, b = bInfo.mask;
    const minX = Math.max(aInfo.bounds.minX, bInfo.bounds.minX);
    const maxX = Math.min(aInfo.bounds.maxX, bInfo.bounds.maxX);
    const minY = Math.max(aInfo.bounds.minY, bInfo.bounds.minY);
    const maxY = Math.min(aInfo.bounds.maxY, bInfo.bounds.maxY);
    let overlap = 0;
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const p = y * width + x;
      if (a[p] && b[p]) overlap += 1;
    }
    const share = overlap / Math.max(1, Math.min(aInfo.area, bInfo.area));
    maximumOverlap = Math.max(maximumOverlap, share);
    if (share > (thresholds.maximumOverlapShare ?? config.collisions.maximumOverlapShare)) {
      collisionDetails.push(
        `${first.id}/${second.id}: пересечение ${(share * 100).toFixed(2)}%; якоря ${first.anchor ?? '—'}/${second.anchor ?? '—'}`,
      );
      continue;
    }
    if (!first.touchingEdge && !second.touchingEdge && !overlap) {
      const sourceInfo = aInfo.area <= bInfo.area ? aInfo : bInfo;
      const targetInfo = sourceInfo === aInfo ? bInfo : aInfo;
      const gap = minimumMaskGapNear(
        sourceInfo.mask, targetInfo.mask, sourceInfo.bounds!, targetInfo.bounds!, width, height, minimumGapPx,
      );
      if (gap?.exact) {
        minimumMeasuredNearGap = Math.min(minimumMeasuredNearGap, gap.gap);
        if (gap.gap < minimumGapPx) {
          collisionDetails.push(
            `${first.id}/${second.id}: зазор ${gap.gap.toFixed(2)} пикс.; якоря ${first.anchor ?? '—'}/${second.anchor ?? '—'}`,
          );
        }
      } else if (gap) {
        minimumUnrelatedGapLowerBound = Math.min(minimumUnrelatedGapLowerBound, gap.gap);
      }
    }
  }
  checks.V08 = check(collisionDetails.length === 0, {
    maximumOverlapShare: maximumOverlap,
    minimumMeasuredNearGapPx: Number.isFinite(minimumMeasuredNearGap) ? minimumMeasuredNearGap : null,
    minimumUnrelatedGapLowerBoundPx: Number.isFinite(minimumUnrelatedGapLowerBound) ? minimumUnrelatedGapLowerBound : null,
  },
  { maximumOverlapShare: thresholds.maximumOverlapShare ?? config.collisions.maximumOverlapShare,
      minimumGapPx }, collisionDetails);
  recordRuleTiming('V08');
  if (stopIfFailed()) return { passed: false, checks };

  if (shouldRun('V09')) {
  // V09: пиксели зарядов должны находиться внутри маски безопасной области.
  const safeAreaMask = evidence.safeAreaMask;
  const chargeLayers = evidence.layers.filter(({ role }) => role === 'charge');
  if (!chargeLayers.length) checks.V09 = check(true, { chargeLayers: 0, outsideSafeArea: 0 }, { outsideSafeArea: 0 });
  else if (!safeAreaMask || safeAreaMask.length !== width * height) checks.V09 = unavailable('Нужна маска безопасной области');
  else {
    let outside = 0;
    const outsideByLayer: string[] = [];
    for (const layer of chargeLayers) {
      const mask = raster.layerMasks[layer.id];
      if (!mask) {
        outside += 1;
        outsideByLayer.push(`${layer.id}: отсутствует растр слоя`);
        continue;
      }
      const bounds = raster.layerBounds?.[layer.id] ?? getMaskBounds(mask, width, height);
      if (!bounds) continue;
      let layerOutside = 0;
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        const offset = y * width;
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
          const index = offset + x;
          if (mask[index] && !safeAreaMask[index]) {
            outside += 1;
            layerOutside += 1;
          }
        }
      }
      if (layerOutside) {
        outsideByLayer.push(
          `${layer.id}: ${layerOutside} пикс. вне safe_area (x=${bounds.minX}..${bounds.maxX}, y=${bounds.minY}..${bounds.maxY})`,
        );
      }
    }
    checks.V09 = check(outside === 0, outside, 0, outside
      ? [`Зарядов вне safe_area: ${outside} пикс.`, ...outsideByLayer]
      : []);
  }
  recordRuleTiming('V09');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V10')) {
  // V10: заявленная и измеренная симметрия пикселей.
  const declaredSymmetry = getSymmetry(spec);
  const symmetry = classifySymmetry(raster, thresholds.minimumSymmetryAgreement ?? config.symmetry.minimumAgreement);
  spec.meta.symmetry_target ??= declaredSymmetry || 'NONE';
  spec.meta.symmetry_actual = symmetry.actual;
  const declaredAgreement = declaredSymmetry === 'NONE' ? 1 : symmetry.agreements[declaredSymmetry];
  checks.V10 = check(true,
  { declared: declaredSymmetry || null, actual: symmetry.actual, agreement: declaredAgreement ?? null, ...symmetry.agreements },
  { minimumAgreement: thresholds.minimumSymmetryAgreement ?? config.symmetry.minimumAgreement },
  declaredAgreement === undefined ? [`Класс симметрии "${declaredSymmetry}" неизвестен; фактический класс сохранён`] :
    declaredAgreement < (thresholds.minimumSymmetryAgreement ?? config.symmetry.minimumAgreement)
      ? [`Класс понижен с ${declaredSymmetry} до ${symmetry.actual}`] : []);
  recordRuleTiming('V10');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V11')) {
  // V11: культурная совместимость, соответствие чистому профилю и допустимость гибрида.
  const tags = [...new Set(spec.tags)];
  const tagSet = new Set(tags);
  const forbiddenPairs = config.cultural.forbiddenPairs.filter(([a, b]) => tagSet.has(a) && tagSet.has(b));
  const secondary = spec.second_profile_id ? getFlagProfile(spec.second_profile_id) : undefined;
  let hybridValid = true;
  if (spec.second_profile_id) {
    hybridValid = !!profile && !!secondary &&
      canUseHybridProfiles(profile, secondary, tags).valid;
  }
  const permitted = evidence.allowedTags ?? profile?.tags_allowed ?? null;
  const disallowedTags = permitted === null ? [] : tags.filter((tag) => !permitted.includes(tag));
  const foreignGroups = secondary?.tags_allowed
    ? tags.filter((tag) => !profile?.tags_allowed?.includes(tag) && !secondary.tags_allowed!.includes(tag))
    : [];
  const knownTags: ReadonlySet<string> = new Set(config.cultural.allowedTags);
  const unknownTags = tags.filter((tag) => !knownTags.has(tag));
  const tagProfileValid = spec.second_profile_id
    ? hybridValid
    : evidence.allowedTags
      ? tags.every((tag) => evidence.allowedTags!.includes(tag)) && areFlagTagSetsCompatible(tags)
      : profile ? isPureFlagStyle(profile, tags).valid : tags.length === 0;
  checks.V11 = check(forbiddenPairs.length === 0 && hybridValid && disallowedTags.length === 0 &&
    foreignGroups.length === 0 && unknownTags.length === 0 && tagProfileValid,
  { tagCount: tags.length, forbiddenPairs: forbiddenPairs.length, disallowedTags: disallowedTags.length,
    unknownTags: unknownTags.length, hybrid: !!spec.second_profile_id },
  { maximumForeignTagGroups: 1 },
  [
    ...forbiddenPairs.map(([a, b]) => `Запрещённая пара тегов ${a}/${b}`),
    ...(!tagProfileValid ? ['Теги не соответствуют выбранному чистому или гибридному профилю'] : []),
    ...disallowedTags.map((tag) => `Тег "${tag}" не разрешён профилем`),
    ...unknownTags.map((tag) => `Неизвестный культурный тег "${tag}"`),
    ...(foreignGroups.length ? ['Обнаружено больше одной чужой группы тегов'] : []),
  ]);
  recordRuleTiming('V11');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V12')) {
  // V12: наличие в каталоге, запрет хиральной C4-симметрии и запрещённых мотивов.
  const catalog = [...new Set([
    ...evidence.catalogIds,
    ...evidence.layers.flatMap((layer) => layer.catalogIds ?? []),
    ...collectCatalogIds(spec),
  ])];
  const moduleIds = new Set(Object.keys(FLAG_EMBLEM_CONFIG.modules));
  const composerIds = new Set(Object.keys(FLAG_EMBLEM_CONFIG.composers));
  const invalidCatalogIds = catalog.filter((id) => !moduleIds.has(id) && !composerIds.has(id));
  const lightningCount = [...evidence.layers, ...catalog.map((id) => ({ id, role: '', tags: [id] }))]
    .flatMap((item) => item.tags ?? []).filter((tag) => /zigzag.?lightning/i.test(tag)).length;
  const invalidEmblemMasks = (evidence.emblemMasks ?? []).filter((mask) => mask.length !== 64 * 64).length;
  const actualEmblemMaskCount = evidence.emblemMasks?.length ?? 0;
  const expectedEmblemMaskCount = evidence.expectedEmblemMaskCount;
  const emblemMaskCountValid = Number.isInteger(expectedEmblemMaskCount) && expectedEmblemMaskCount >= 0;
  const missingEmblemMasks = emblemMaskCountValid
    ? Math.max(0, expectedEmblemMaskCount - actualEmblemMaskCount)
    : 1;
  const extraEmblemMasks = emblemMaskCountValid
    ? Math.max(0, actualEmblemMaskCount - expectedEmblemMaskCount)
    : 0;
  const compositionMaskReady = evidence.compositionMask?.length === 64 * 64;
  let chiralC4 = 0;
  if (compositionMaskReady) {
    chiralC4 = checkV12C4(evidence.compositionMask!, 64, 64,
      thresholds.minimumSymmetryAgreement ?? config.symmetry.minimumAgreement);
  }
  for (const emblem of evidence.emblemMasks ?? []) {
    if (emblem.length === 64 * 64) {
      chiralC4 = Math.max(chiralC4, checkV12C4(emblem, 64, 64,
        thresholds.minimumSymmetryAgreement ?? config.symmetry.minimumAgreement));
    }
  }
  const explicitForbidden = evidence.forbiddenMotifs ?? [];
  const forbidden = [...explicitForbidden];
  if (lightningCount >= 2) forbidden.push('пара зигзагообразных молний');
  if (chiralC4 > 0) forbidden.push('хиральная четырёхкратная вращательная симметрия');
  checks.V12 = check(invalidCatalogIds.length === 0 && forbidden.length === 0 &&
    compositionMaskReady && invalidEmblemMasks === 0 && missingEmblemMasks === 0 &&
    extraEmblemMasks === 0 && emblemMaskCountValid,
    { invalidCatalogItems: invalidCatalogIds.length, prohibitedMotifs: forbidden.length, chiralC4Agreement: chiralC4,
      invalidEmblemMasks, missingEmblemMasks, extraEmblemMasks, expectedEmblemMaskCount,
      actualEmblemMaskCount, compositionMaskReady },
    { catalogItems: 0, prohibitedMotifs: 0, compositionMask: '64×64', emblemMasks: '64×64' },
    [...invalidCatalogIds.map((id) => `Элемент "${id}" отсутствует в каталоге`), ...forbidden,
      ...(!compositionMaskReady ? ['Отсутствует маска композиции размером 64×64'] : []),
      ...(invalidEmblemMasks ? [`Масок эмблем неверного размера: ${invalidEmblemMasks}`] : []),
      ...(!emblemMaskCountValid ? ['Не задано допустимое ожидаемое число масок эмблем'] : []),
      ...(missingEmblemMasks ? [`Не хватает масок эмблем: ${missingEmblemMasks}`] : []),
      ...(extraEmblemMasks ? [`Лишних масок эмблем: ${extraEmblemMasks}`] : [])]);
  recordRuleTiming('V12');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V13')) {
  const { slotRasterReady, paletteChecks } = getPaletteValidation();
  // V13: число цветов, использование объявленных слотов, доступность в эпохе и проверки решателя палитры.
  const declaredColors = Object.values(spec.palette).map(({ hex }) => hex.toLowerCase());
  const unusedDeclared = declaredColors.filter((hex) => !colorCounts.has(hex));
  const unavailableEra = Object.values(spec.palette).filter((entry) => {
    const definition = FLAG_COLOR_CONFIG.colors.find((color) =>
      color.id === entry.color_id || color.shades.some((shade) => shade.id === entry.color_id));
    return !definition || !(definition.eras as readonly number[]).includes(spec.era);
  }).map(({ color_id }) => color_id);
  const paletteFailures = slotRasterReady
    ? paletteChecks.filter(({ rule, passed }) => !passed && (['C1', 'C2', 'C3', 'C4', 'ERA', 'PALETTE'] as string[]).includes(rule))
    : [];
  const maximumColors = thresholds.maximumColors ?? config.limits.colors;
  checks.V13 = check(colors.size <= maximumColors && unusedDeclared.length === 0 &&
    unavailableEra.length === 0 && paletteFailures.length === 0 && slotRasterReady,
    { usedColors: colors.size, declaredPaletteEntries: declaredColors.length, unusedDeclaredColors: unusedDeclared.length,
      eraUnavailableColors: unavailableEra.length, solverFailures: paletteFailures.length },
    { maximumColors, allDeclaredColorsUsed: true },
    [...(!slotRasterReady ? ['Нужен корректный итоговый растр слотов для проверки ограничений решателя палитры'] : []),
      ...unusedDeclared.map((color) => `Объявленный цвет ${color} не используется`),
      ...unavailableEra.map((color) => `Цвет ${color} недоступен в эпохе ${spec.era}`),
      ...paletteFailures.map(({ rule }) => `Нарушено ограничение решателя палитры ${rule}`)]);
  recordRuleTiming('V13');
  if (stopIfFailed()) return { passed: false, checks };
  }

  // V14: внутренние углы многоугольников и невырожденность контуров.
  let minimumAngle = Infinity, degeneratePaths = 0;
  const anglePaths = evidence.paths.filter((path) => !path.layerId || !ignoredLayerIds.has(path.layerId)).map((path) => ({
    ...path,
    points: path.closed ? uniqueClosedPathPoints(path.points) : path.points,
  }));
  const angleLimit = thresholds.minimumPolygonAngle ?? config.sharpAngles.minimumPolygonDegrees;
  const sunRayLimit = thresholds.minimumSunRayAngle ?? config.sharpAngles.minimumSunRayDegrees;
  const angleFailures: string[] = [];
  for (const path of anglePaths) {
    if (path.points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
      degeneratePaths += 1;
      continue;
    }
    if (path.closed && path.points.length < 3) {
      degeneratePaths += 1;
    } else if (path.closed) {
      const computedArea = path.signedArea ?? pathArea(path.points);
      if (Math.abs(computedArea) < 1e-9) degeneratePaths += 1;
      if (path.operator === 'G12') continue;
      const limit = path.sunRay ? sunRayLimit : angleLimit;
      for (let index = 0; index < path.points.length; index += 1) {
        const angle = interiorAngle(path.points, index);
        minimumAngle = Math.min(minimumAngle, angle);
        if (angle < limit) {
          const source = path.layerId ?? path.module ?? path.operator ?? 'слой без идентификатора';
          angleFailures.push(`${source}: угол ${angle.toFixed(2)}° меньше ${limit}°`);
        }
      }
    }
  }
  checks.V14 = check(degeneratePaths === 0 && angleFailures.length === 0,
    { minimumAngle: Number.isFinite(minimumAngle) ? minimumAngle : null, degeneratePaths },
    { minimumPolygonAngle: angleLimit, minimumSunRayAngle: sunRayLimit },
    angleFailures);
  recordRuleTiming('V14');
  if (stopIfFailed()) return { passed: false, checks };

  if (shouldRun('V15')) {
  // V15: синтаксис SVG, разрешённые элементы, диапазон координат и размер файла.
  if (typeof evidence.svg !== 'string') checks.V15 = unavailable('Нужен итоговый текст SVG');
  else {
    const svgWidth = Math.round(config.flagHeight * spec.outline.aspect);
    const svg = parseSvg(evidence.svg, thresholds.maximumSvgBytes ?? config.limits.svgBytes,
      svgWidth, config.flagHeight, evidence.embedMetadata ?? false,
      evidence.svgLayerIds ?? evidence.layers.map(({ id }) => id));
    checks.V15 = check(svg.passed, { bytes: svg.bytes, elements: svg.elements,
      unsupportedPathCommands: svg.pathCommands.filter((command) =>
        !(FLAG_VALIDATION_CONFIG.svg.allowedPathCommands as readonly string[]).includes(command)).length,
      badCoordinates: svg.badCoordinates }, { maximumBytes: thresholds.maximumSvgBytes ?? config.limits.svgBytes,
      allowedElements: [...FLAG_VALIDATION_CONFIG.svg.allowedElements,
        ...(evidence.embedMetadata ? ['metadata'] : [])] }, svg.reasons);
  }
  recordRuleTiming('V15');
  if (stopIfFailed()) return { passed: false, checks };
  }

  if (shouldRun('V16')) {
  // V16: вырезы и зубцы контура не пересекают заряды, ширина деталей не меньше T_MIN.
  const exclusion = evidence.outlineExclusionMask;
  let featureIntersections = 0, undersizedFeatures = 0;
  const lowerEdge = String(spec.outline.params.lowerEdge ?? spec.outline.params.lower_edge ?? '').toUpperCase();
  const expectsOutlineAngles = spec.outline.type === 'SWALLOW' ||
    Boolean(spec.outline.params.edge) ||
    (spec.outline.type === 'BANNER' && ['POINT', 'SWALLOW', 'TEETH'].includes(lowerEdge));
  const hasCutout = spec.outline.type === 'SWALLOW' || lowerEdge === 'SWALLOW' ||
    Boolean(spec.outline.params.edge);
  const expectsFeatures = lowerEdge === 'TEETH' || lowerEdge === 'SCALLOP' ||
    lowerEdge === 'TABS' || Boolean(spec.outline.params.edge);
  if (exclusion && exclusion.length === width * height) {
    for (const layer of evidence.layers.filter(({ role }) => role === 'charge')) {
      const mask = raster.layerMasks[layer.id];
      if (!mask) continue;
      const bounds = raster.layerBounds?.[layer.id] ?? getMaskBounds(mask, width, height);
      if (!bounds) continue;
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        const row = y * width;
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
          const index = row + x;
          if (mask[index] && exclusion[index]) featureIntersections += 1;
        }
      }
    }
  } else if (evidence.layers.some(({ role }) => role === 'charge') || hasCutout) {
    featureIntersections = -1;
  }
  const minimumThicknessReferencePx = config.physical.minimumThickness * config.physical.validationFactor /
    config.physical.referenceUnitsPerPixel;
  const minFeatureWidth = (thresholds.minimumThicknessPx ?? minimumThicknessReferencePx) *
    height / config.referenceRasterHeight;
  for (const feature of evidence.outlineFeatures ?? []) {
    if (feature.minimumWidthPx < minFeatureWidth || !Number.isFinite(feature.minimumWidthPx)) undersizedFeatures += 1;
    if (feature.mask && feature.mask.length === width * height && exclusion) {
      for (let index = 0; index < feature.mask.length; index += 1) {
        if (feature.mask[index] && exclusion[index]) featureIntersections += 1;
      }
    }
  }
  const outlineAngleLimit = thresholds.minimumPolygonAngle ?? config.sharpAngles.minimumPolygonDegrees;
  let minimumOutlineAngle = Infinity, degenerateOutlinePaths = 0;
  const outlineAngleFailures: string[] = [];
  for (const path of evidence.outlinePaths ?? []) {
    const points = path.closed ? uniqueClosedPathPoints(path.points) : path.points;
    if (points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
      degenerateOutlinePaths += 1;
      continue;
    }
    if (!path.closed || points.length < 3 || Math.abs(pathArea(points)) < 1e-9) {
      degenerateOutlinePaths += 1;
      continue;
    }
    for (let index = 0; index < points.length; index += 1) {
      const angle = interiorAngle(points, index);
      minimumOutlineAngle = Math.min(minimumOutlineAngle, angle);
      if (angle < outlineAngleLimit) {
        outlineAngleFailures.push(
          `${path.operator ?? 'контур'}: угол ${angle.toFixed(2)}° меньше ${outlineAngleLimit}°`,
        );
      }
    }
  }
  const missingOutlineAnglePaths = expectsOutlineAngles && !(evidence.outlinePaths?.length);
  checks.V16 = check(featureIntersections === 0 && undersizedFeatures === 0 &&
    (!expectsFeatures || !!evidence.outlineFeatures?.length) &&
    !missingOutlineAnglePaths && degenerateOutlinePaths === 0 && outlineAngleFailures.length === 0,
  {
    featureIntersections,
    undersizedFeatures,
    featureCount: evidence.outlineFeatures?.length ?? null,
    minimumOutlineAngle: Number.isFinite(minimumOutlineAngle) ? minimumOutlineAngle : null,
    degenerateOutlinePaths,
  },
  {
    minimumFeatureWidthPx: minFeatureWidth,
    minimumOutlineAngle: outlineAngleLimit,
    intersections: 0,
  },
  [
    ...(missingOutlineAnglePaths ? ['Для V16 отсутствует исходная геометрия контура'] : []),
    ...outlineAngleFailures,
  ]);
  }

  // Отсутствие данных о форме не должно незаметно уменьшать полноту приёмочных проверок.
  if (missingMasks.length) {
    const message = `Нет масок для слоёв: ${missingMasks.map(({ id }) => id).join(', ')}`;
    if (shouldRun('V08')) {
      checks.V08.details.push(message);
      checks.V08.passed = false;
    }
    if (shouldRun('V09')) {
      checks.V09.details.push(message);
      checks.V09.passed = false;
    }
    if (shouldRun('V16') && evidence.layers.some(({ role }) => role === 'charge')) {
      checks.V16.details.push(message);
      checks.V16.passed = false;
    }
  }
  if (shouldRun('V08')) {
    const hasVisibleLayerIds = raster.layerIdIndices
      ? raster.layerIdIndices.some((id) => id !== 0)
      : raster.layerIds.every((id) => id === null);
    if (!hasVisibleLayerIds) {
      checks.V08.passed = false;
      checks.V08.details.push('В эталонном растре не указаны видимые идентификаторы слоёв');
    }
  }
  recordRuleTiming('V16');
  if (stopIfFailed()) return { passed: false, checks };
  const selectedRules = options.onlyRules ?? RULES;
  return { passed: selectedRules.every((rule) => checks[rule]?.passed === true), checks };
}

/** Название интерфейса validate из раздела 3 технического задания. */
export const validate = validateFlag;
