import { FLAG_COLOR_CONFIG } from './flagColorConfig';
import { deltaE76, validateFlagPalette, wcagContrast, type FlagChargeBackground, type FlagSlotRaster, type RasterSlot } from './flagColors';
import { FLAG_EMBLEM_CONFIG } from './flagEmblemConfig';
import { FLAG_OUTLINE_CONFIG } from './flagOutlineConfig';
import { FLAG_PROFILE_CONFIG } from './flagProfileConfig';
import { areFlagTagSetsCompatible, canUseHybridProfiles, isPureFlagStyle } from './flagProfiles';
import type { FlagSpec, JsonObject, JsonValue } from './flagSpec';
import { FLAG_VALIDATION_CONFIG } from './flagValidationConfig';
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
  role: string;
  parentId?: string;
  overlayWith?: string[];
  touchingEdge?: boolean;
  tags?: string[];
  catalogIds?: string[];
}

export interface FlagValidationPath {
  points: { x: number; y: number }[];
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
  /** Описания и маски должны использовать постоянные идентификаторы слоёв. */
  layers: FlagValidationLayer[];
  /** Итоговый растр слотов слоёв для проверки цветовых правил C1–C3. */
  slotRaster?: FlagSlotRaster;
  chargeBackgrounds?: FlagChargeBackground[];
  tincture?: boolean;
  primitiveCount: number;
  pathPointCount: number;
  paths: FlagValidationPath[];
  /** Идентификаторы модулей и композиторов каталога после раскрытия геометрии. */
  catalogIds: string[];
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
  outlineFeatures?: FlagValidationFeature[];
  /** Контекст генератора, который нельзя восстановить из развёрнутой геометрии. */
  forbiddenMotifs?: string[];
  /** Переопределение списка разрешённых тегов для профиля. */
  allowedTags?: string[];
  /** Разрешает служебные атрибуты data-* для экспорта метаданных. */
  embedMetadata?: boolean;
}

export interface FlagValidationOptions {
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
const eqPair = (a: string, b: string) => `${a}\u0000${b}`;
const check = (passed: boolean, value: FlagValidationCheck['value'], limit?: FlagValidationCheck['limit'], details: string[] = []): FlagValidationCheck =>
  ({ passed, value, ...(limit === undefined ? {} : { limit }), details });
const unavailable = (reason: string): FlagValidationCheck => check(false, null, undefined, [reason]);

function assertRaster(raster: FlagReferenceRaster): void {
  const size = raster.width * raster.height;
  if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height) ||
    raster.width < 1 || raster.height < 1 || raster.colors.length !== size ||
    raster.layerIds.length !== size) throw new RangeError('Некорректные размеры или буферы эталонного растра');
  for (const [id, mask] of Object.entries(raster.layerMasks)) {
    if (!id || mask.length !== size) throw new RangeError(`Некорректная эталонная маска "${id}"`);
  }
}

function coveredPixels(raster: FlagReferenceRaster): number {
  return raster.colors.reduce((count, color) => count + (color ? 1 : 0), 0);
}

function makeColorMask(raster: FlagReferenceRaster, color: string): Mask {
  return Uint8Array.from(raster.colors, (pixel) => Number(pixel?.toLowerCase() === color));
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
  for (let index = 0; index < raster.values.length; index += 1) {
    const value = raster.values[index];
    if (value === null || value === undefined) continue;
    const slot = slotAt(raster, index);
    if (!slot || !known.has(slot)) return false;
  }
  return true;
}

function colorMasks(raster: FlagReferenceRaster): Map<string, Mask> {
  const result = new Map<string, Mask>();
  for (const color of raster.colors) {
    if (color && !result.has(color)) result.set(color, makeColorMask(raster, color));
  }
  return result;
}

function components(mask: ArrayLike<number>, width: number, height: number): { indices: number[]; area: number }[] {
  const seen = new Uint8Array(width * height);
  const result: { indices: number[]; area: number }[] = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start], pixels: number[] = [];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head], x = current % width, y = Math.floor(current / width);
      pixels.push(current);
      for (const [dx, dy] of PIXEL_NEIGHBORS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    result.push({ indices: pixels, area: pixels.length });
  }
  return result;
}

function disk(radius: number): Point[] {
  const points: Point[] = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) if (x * x + y * y <= radius * radius) points.push({ x, y });
  }
  return points;
}

function morphology(mask: ArrayLike<number>, width: number, height: number, radius: number, operation: 'dilate' | 'erode'): Mask {
  const result = new Uint8Array(width * height);
  const kernel = disk(radius);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let value = operation === 'erode' ? 1 : 0;
    for (const { x: dx, y: dy } of kernel) {
      const nx = x + dx, ny = y + dy;
      const active = nx >= 0 && nx < width && ny >= 0 && ny < height ? Number(!!mask[ny * width + nx]) : 0;
      if (operation === 'dilate' && active) { value = 1; break; }
      if (operation === 'erode' && !active) { value = 0; break; }
    }
    result[y * width + x] = value;
  }
  return result;
}

function sumMask(mask: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < mask.length; i += 1) sum += Number(!!mask[i]);
  return sum;
}

function componentAreaByColor(raster: FlagReferenceRaster, width: number, height: number) {
  return [...colorMasks(raster)].flatMap(([color, mask]) => components(mask, width, height).map((part) => ({ color, ...part })));
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

function symmetryAgreement(raster: FlagReferenceRaster, transform: (x: number, y: number) => [number, number]): number {
  let compared = 0, matching = 0;
  for (let y = 0; y < raster.height; y += 1) for (let x = 0; x < raster.width; x += 1) {
    const [tx, ty] = transform(x, y);
    if (tx < 0 || tx >= raster.width || ty < 0 || ty >= raster.height) continue;
    const index = y * raster.width + x, other = ty * raster.width + tx;
    if (!raster.colors[index] && !raster.colors[other]) continue;
    compared += 1;
    if (raster.colors[index] === raster.colors[other]) matching += 1;
  }
  return compared ? matching / compared : 1;
}

function classifySymmetry(raster: FlagReferenceRaster, minimum: number): { actual: string; agreements: Record<string, number> } {
  const horizontal = symmetryAgreement(raster, (x, y) => [raster.width - 1 - x, y]);
  const vertical = symmetryAgreement(raster, (x, y) => [x, raster.height - 1 - y]);
  const rotation = symmetryAgreement(raster, (x, y) => [raster.width - 1 - x, raster.height - 1 - y]);
  const agreements = { MIR_H: horizontal, MIR_V: vertical, BOTH: Math.min(horizontal, vertical), ROT180: rotation };
  const actual = agreements.BOTH >= minimum ? 'BOTH'
    : horizontal >= minimum ? 'MIR_H'
      : vertical >= minimum ? 'MIR_V'
        : rotation >= minimum ? 'ROT180' : 'NONE';
  return { actual, agreements };
}

function squaredDistance1d(input: ArrayLike<number>): Float64Array {
  const length = input.length;
  const output = new Float64Array(length);
  const sites = new Int32Array(length);
  const boundaries = new Float64Array(length + 1);
  let firstSite = -1;
  for (let i = 0; i < length; i += 1) if (input[i] < 1e19) { firstSite = i; break; }
  if (firstSite < 0) { output.fill(1e20); return output; }
  let k = 0;
  sites[0] = firstSite;
  boundaries[0] = -Infinity;
  boundaries[1] = Infinity;
  for (let q = firstSite + 1; q < length; q += 1) {
    if (input[q] >= 1e19) continue;
    let crossing = ((input[q] + q * q) - (input[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k]));
    while (crossing <= boundaries[k]) {
      k -= 1;
      crossing = ((input[q] + q * q) - (input[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k]));
    }
    k += 1;
    sites[k] = q;
    boundaries[k] = crossing;
    boundaries[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while (boundaries[k + 1] < q) k += 1;
    output[q] = (q - sites[k]) ** 2 + input[sites[k]];
  }
  return output;
}

/** Точное евклидово расстояние в единицах центров пикселей до ближайшего пикселя маски. */
function distanceTransform(mask: ArrayLike<number>, width: number, height: number): Float64Array {
  const horizontal = new Float64Array(width * height);
  const line = new Float64Array(Math.max(width, height));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) line[x] = mask[y * width + x] ? 0 : 1e20;
    const result = squaredDistance1d(line.subarray(0, width));
    horizontal.set(result, y * width);
  }
  const result = new Float64Array(width * height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) line[y] = horizontal[y * width + x];
    const column = squaredDistance1d(line.subarray(0, height));
    for (let y = 0; y < height; y += 1) result[y * width + x] = Math.sqrt(column[y]);
  }
  return result;
}

/** Перевод расстояния между центрами пикселей в расстояние между краями для V08. */
function minimumMaskGap(first: ArrayLike<number>, second: ArrayLike<number>, width: number, height: number): number {
  if (!sumMask(first) || !sumMask(second)) return Infinity;
  const distance = distanceTransform(first, width, height);
  let minimum = Infinity;
  for (let index = 0; index < second.length; index += 1) {
    if (second[index]) minimum = Math.min(minimum, Math.max(0, distance[index] - 1));
  }
  return minimum;
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
      part.indices.forEach((index) => { id[index] = componentId; });
    });
    result.set(color, { id, areas });
  }
  return result;
}

function downsampleMajority(raster: FlagReferenceRaster, targetHeight: number): { width: number; height: number; colors: (string | null)[] } {
  const width = Math.max(1, Math.round(raster.width * targetHeight / raster.height));
  const colors: (string | null)[] = [];
  for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < width; x += 1) {
    const x0 = Math.floor(x * raster.width / width), x1 = Math.max(x0 + 1, Math.floor((x + 1) * raster.width / width));
    const y0 = Math.floor(y * raster.height / targetHeight), y1 = Math.max(y0 + 1, Math.floor((y + 1) * raster.height / targetHeight));
    const counts = new Map<string, number>();
    for (let sy = y0; sy < Math.min(y1, raster.height); sy += 1) for (let sx = x0; sx < Math.min(x1, raster.width); sx += 1) {
      const color = raster.colors[sy * raster.width + sx];
      if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    let selected: string | null = null, maximum = 0;
    for (const [color, count] of counts) if (count > maximum) { selected = color; maximum = count; }
    colors.push(selected);
  }
  return { width, height: targetHeight, colors };
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
  const thresholds = { ...options.thresholds };
  const config = FLAG_VALIDATION_CONFIG;
  assertRaster(evidence.raster);
  const raster = evidence.raster, width = raster.width, height = raster.height;
  const area = coveredPixels(raster);
  if (!area) throw new RangeError('Эталонный растр должен содержать хотя бы один пиксель флага');
  const minimumGapPx = (thresholds.minimumGapPx ?? config.minimumGapPx) * height / config.referenceRasterHeight;
  const colors = colorMasks(raster);
  const colorCounts = new Map([...colors].map(([color, mask]) => [color, sumMask(mask)]));
  const shares = new Map([...colorCounts].map(([color, count]) => [color, count / area]));
  const profile = FLAG_PROFILE_CONFIG.find(({ id }) => id === spec.profile_id);
  const maxComplexity = thresholds.maximumComplexity ?? profile?.CMAX ?? config.maximumComplexity;
  const layerCount = evidence.layers.length;
  const idsInRaster = new Set(raster.layerIds.filter((id): id is string => !!id));
  const missingMasks = evidence.layers.filter(({ id }) => !raster.layerMasks[id]);
  const slotRaster = evidence.slotRaster;
  const slotRasterReady = validSlotRaster(slotRaster, width, height, spec.slots.items);
  const paletteChecks = slotRasterReady
    ? validateFlagPalette(spec, spec.palette, {
      slotRaster,
      era: spec.era,
      chargeBackgrounds: evidence.chargeBackgrounds ?? [],
      tincture: evidence.tincture ?? false,
    })
    : [];
  const checks = {} as Record<FlagValidationRule, FlagValidationCheck>;

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

  // V02: толщина компонентов и сохранение деталей после морфологического раскрытия.
  const minimumThicknessPx = thresholds.minimumThicknessPx ?? config.minimumThicknessPx * height / config.referenceRasterHeight;
  const smallAreaComponents: string[] = [];
  let maxOpeningLoss = 0, thinComponents = 0;
  const repeatOrGlyph = new Set(evidence.layers.filter((layer) =>
    layer.tags?.some((tag) => tag.toLowerCase() === 'repeat' || tag.toLowerCase() === 'glyph')).map(({ id }) => id));
  for (const [color, mask] of colors) for (const component of components(mask, width, height)) {
    const share = component.area / area;
    const repeatDetail = component.indices.some((index) => repeatOrGlyph.has(raster.layerIds[index] ?? ''));
    if (share < config.components.forbiddenAreaShare && !repeatDetail) {
      smallAreaComponents.push(`${color}: доля площади ${share.toFixed(5)}`);
    }
    const isolated = new Uint8Array(mask.length);
    component.indices.forEach((index) => { isolated[index] = 1; });
    if (share < config.components.minimumAreaShare) {
      if (repeatDetail) {
        const xs = component.indices.map((index) => index % width);
        const ys = component.indices.map((index) => Math.floor(index / width));
        const minimumFeatureWidth = Math.min(Math.max(...xs) - Math.min(...xs) + 1,
          Math.max(...ys) - Math.min(...ys) + 1);
        if (minimumFeatureWidth < minimumThicknessPx) {
          thinComponents += 1;
          smallAreaComponents.push(`${color}: ширина повтора или глифа ${minimumFeatureWidth.toFixed(2)} пикс.`);
        }
      }
      continue;
    }
    const opened = morphology(morphology(isolated, width, height, Math.max(1, Math.round(minimumThicknessPx / 2)), 'erode'),
      width, height, Math.max(1, Math.round(minimumThicknessPx / 2)), 'dilate');
    const loss = Math.max(0, (component.area - sumMask(opened)) / component.area);
    maxOpeningLoss = Math.max(maxOpeningLoss, loss);
    if (loss > (thresholds.maximumOpeningLoss ?? config.components.maximumOpeningLoss)) thinComponents += 1;
  }
  checks.V02 = check(smallAreaComponents.length === 0 && thinComponents === 0,
    { maxOpeningLoss, thinComponents, forbiddenSmallComponents: smallAreaComponents.length },
    { maximumOpeningLoss: thresholds.maximumOpeningLoss ?? config.components.maximumOpeningLoss,
      forbiddenAreaShare: config.components.forbiddenAreaShare, minimumThicknessPx },
    smallAreaComponents.slice(0, 8));

  // V03: прирост площади после замыкания измеряется отдельно для каждой видимой цветовой маски.
  const maxClosingGrowth = Math.max(0, ...[...colors].map(([, mask]) => {
    const radius = Math.max(1, Math.round(minimumGapPx / 2));
    const closed = morphology(morphology(mask, width, height, radius, 'dilate'), width, height, radius, 'erode');
    return Math.max(0, (sumMask(closed) - sumMask(mask)) / Math.max(1, sumMask(mask)));
  }));
  checks.V03 = check(maxClosingGrowth <= (thresholds.maximumClosingIncrease ?? config.components.maximumClosingIncrease),
    maxClosingGrowth, thresholds.maximumClosingIncrease ?? config.components.maximumClosingIncrease);

  // V04: уменьшение до 32 пикселей и сохранение значимых связных деталей.
  const small = downsampleMajority(raster, config.components.smallRasterHeight);
  const smallRaster: FlagReferenceRaster = {
    width: small.width, height: small.height, colors: small.colors,
    layerIds: Array(small.colors.length).fill(null), layerMasks: {},
  };
  const smallComponents = colorComponents(smallRaster);
  let minRetention = 1, lostSmallComponents = 0;
  const significantColors = new Set([...shares].filter(([, share]) => share >= config.colors.minimumShare).map(([color]) => color));
  let missingSignificantColors = 0;
  for (const color of significantColors) if (!small.colors.includes(color)) missingSignificantColors += 1;
  const scale = (small.width * small.height) / (width * height);
  for (const { color, indices, area: componentArea } of componentAreaByColor(raster, width, height)) {
    if (componentArea / area < config.components.smallRasterComponentShare) continue;
    const targetIds = smallComponents.get(color)?.id;
    const votes = new Map<number, number>();
    for (const index of indices) {
      const sx = Math.min(small.width - 1, Math.floor(index % width * small.width / width));
      const sy = Math.min(small.height - 1, Math.floor(Math.floor(index / width) * small.height / height));
      const targetId = targetIds?.[sy * small.width + sx] ?? -1;
      if (targetId >= 0) votes.set(targetId, (votes.get(targetId) ?? 0) + 1);
    }
    const componentId = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    const reducedArea = componentId >= 0 ? smallComponents.get(color)!.areas[componentId] : 0;
    const expected = componentArea * scale;
    const retention = expected ? reducedArea / expected : 0;
    minRetention = Math.min(minRetention, retention);
    if (retention < config.components.minimumSmallRasterRetention) lostSmallComponents += 1;
  }
  checks.V04 = check(missingSignificantColors === 0 && lostSmallComponents === 0,
    { minimumComponentRetention: minRetention, missingSignificantColors, lostComponents: lostSmallComponents },
    { minimumColorShare: config.colors.minimumShare, minimumComponentShare: config.components.smallRasterComponentShare,
      minimumRetention: config.components.minimumSmallRasterRetention });

  // V05: C1 и C2 измеряются по итоговым цветам, а C3 использует проверку раскладки слотов.
  if (!slotRasterReady) checks.V05 = unavailable('Нужен корректный итоговый растр слотов для проверки C1–C3');
  else {
    let minimumAdjacentDeltaE = Infinity, adjacentPairs = 0;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x, color = raster.colors[index];
      if (!color) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const other = raster.colors[ny * width + nx];
        if (!other || other === color) continue;
        adjacentPairs += 1;
        minimumAdjacentDeltaE = Math.min(minimumAdjacentDeltaE, deltaE76(color, other));
      }
    }
    const adjacencyLimit = thresholds.minimumAdjacentDeltaE ?? config.colors.minimumAdjacentDeltaE;
    const chargeDetails: string[] = [];
    let minimumChargeDeltaE = Infinity, minimumChargeContrast = Infinity, checkedChargePairs = 0;
    const chargeChecks = evidence.chargeBackgrounds ?? [];
    if (evidence.layers.some(({ role }) => role === 'charge') && chargeChecks.length === 0) {
      chargeDetails.push('Для зарядов не заданы пары цветов «заряд — фон»');
    }
    for (const charge of chargeChecks) {
      let pairDeltaE = Infinity, pairContrast = Infinity, boundaries = 0;
      for (let index = 0; index < slotRaster.values.length; index += 1) {
        if (slotAt(slotRaster, index) !== charge.chargeSlot) continue;
        const x = index % width, y = Math.floor(index / width);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (slotAt(slotRaster, next) !== charge.backgroundSlot) continue;
          const foreground = raster.colors[index], background = raster.colors[next];
          if (!foreground || !background) continue;
          boundaries += 1;
          pairDeltaE = Math.min(pairDeltaE, deltaE76(foreground, background));
          pairContrast = Math.min(pairContrast, wcagContrast(foreground, background));
        }
      }
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

  // V06: центр масс с весами, пропорциональными цветовому различию.
  const dominant = [...colorCounts].sort((a, b) => b[1] - a[1])[0][0];
  let weightSum = 0, weightedX = 0, weightedY = 0;
  raster.colors.forEach((color, index) => {
    if (!color) return;
    const weight = deltaE76(color, dominant) / 100;
    weightSum += weight;
    weightedX += (index % width + 0.5) / width * weight;
    weightedY += (Math.floor(index / width) + 0.5) / height * weight;
  });
  const centroid = weightSum > 0 ? { x: weightedX / weightSum, y: weightedY / weightSum } : null;
  const region = profile?.BAL
    ? [profile.BAL[0], profile.BAL[1], config.balance.defaultRegion[2], config.balance.defaultRegion[3]]
    : config.balance.defaultRegion;
  const weightShare = weightSum / area;
  checks.V06 = check(colors.size > 1 && weightShare >= (thresholds.minimumBalanceWeightShare ?? config.balance.minimumWeightShare) &&
    !!centroid && centroid.x >= region[0] && centroid.x <= region[1] &&
    centroid.y >= region[2] && centroid.y <= region[3],
  { weightShare, centroidX: centroid?.x ?? null, centroidY: centroid?.y ?? null },
  { minimumWeightShare: thresholds.minimumBalanceWeightShare ?? config.balance.minimumWeightShare,
    x: [region[0], region[1]], y: [region[2], region[3]] },
  colors.size < 2 ? ['single-color flags cannot pass V06'] : []);

  // V07: доли цветов в итоговом видимом растре.
  const minimumColorShare = thresholds.minimumColorShare ?? config.colors.minimumShare;
  const maximumColorShare = thresholds.maximumColorShare ?? config.colors.maximumShare;
  const minimumShare = Math.min(...shares.values()), maximumShare = Math.max(...shares.values());
  checks.V07 = check(minimumShare >= minimumColorShare && maximumShare <= maximumColorShare,
    { minimumShare, maximumShare, colorCount: colors.size },
    { minimumShare: minimumColorShare, maximumShare: maximumColorShare });

  // V08: пересечения и расстояния между слоями с учётом родства и явно разрешённых наложений.
  const collisionDetails: string[] = [];
  let maximumOverlap = 0, minimumUnrelatedGap = Infinity;
  for (let i = 0; i < evidence.layers.length; i += 1) for (let j = i + 1; j < evidence.layers.length; j += 1) {
    const first = evidence.layers[i], second = evidence.layers[j];
    const related = first.parentId === second.id || second.parentId === first.id ||
      first.overlayWith?.includes(second.id) || second.overlayWith?.includes(first.id);
    if (related || !raster.layerMasks[first.id] || !raster.layerMasks[second.id]) continue;
    const a = raster.layerMasks[first.id], b = raster.layerMasks[second.id];
    let overlap = 0;
    for (let p = 0; p < a.length; p += 1) if (a[p] && b[p]) overlap += 1;
    const share = overlap / Math.max(1, Math.min(sumMask(a), sumMask(b)));
    maximumOverlap = Math.max(maximumOverlap, share);
    if (share > (thresholds.maximumOverlapShare ?? config.collisions.maximumOverlapShare)) {
      collisionDetails.push(`${first.id}/${second.id}: пересечение ${(share * 100).toFixed(2)}%`);
      continue;
    }
    if (!first.touchingEdge && !second.touchingEdge && !overlap) {
      const gap = minimumMaskGap(a, b, width, height);
      minimumUnrelatedGap = Math.min(minimumUnrelatedGap, gap);
      if (gap < minimumGapPx) collisionDetails.push(`${first.id}/${second.id}: зазор ${gap.toFixed(2)} пикс.`);
    }
  }
  checks.V08 = check(collisionDetails.length === 0, { maximumOverlapShare: maximumOverlap,
    minimumUnrelatedGapPx: Number.isFinite(minimumUnrelatedGap) ? minimumUnrelatedGap : null },
  { maximumOverlapShare: thresholds.maximumOverlapShare ?? config.collisions.maximumOverlapShare,
      minimumGapPx }, collisionDetails);

  // V09: пиксели зарядов должны находиться внутри маски безопасной области.
  const safeAreaMask = evidence.safeAreaMask;
  const chargeLayers = evidence.layers.filter(({ role }) => role === 'charge');
  if (!chargeLayers.length) checks.V09 = check(true, { chargeLayers: 0, outsideSafeArea: 0 }, { outsideSafeArea: 0 });
  else if (!safeAreaMask || safeAreaMask.length !== width * height) checks.V09 = unavailable('Нужна маска безопасной области');
  else {
    let outside = 0;
    for (const layer of chargeLayers) {
      const mask = raster.layerMasks[layer.id];
      if (!mask) { outside += 1; continue; }
      for (let p = 0; p < mask.length; p += 1) if (mask[p] && !safeAreaMask[p]) outside += 1;
    }
    checks.V09 = check(outside === 0, outside, 0, outside ? [`Зарядов вне safe_area: ${outside} пикс.`] : []);
  }

  // V10: заявленная и измеренная симметрия пикселей.
  const declaredSymmetry = getSymmetry(spec);
  const symmetry = classifySymmetry(raster, thresholds.minimumSymmetryAgreement ?? config.symmetry.minimumAgreement);
  spec.meta.symmetry_actual = symmetry.actual;
  const declaredAgreement = declaredSymmetry === 'NONE' ? 1 : symmetry.agreements[declaredSymmetry];
  checks.V10 = check(declaredSymmetry === 'NONE' ||
    (declaredAgreement !== undefined && declaredAgreement >= (thresholds.minimumSymmetryAgreement ?? config.symmetry.minimumAgreement)),
  { declared: declaredSymmetry || null, actual: symmetry.actual, agreement: declaredAgreement ?? null, ...symmetry.agreements },
  { minimumAgreement: thresholds.minimumSymmetryAgreement ?? config.symmetry.minimumAgreement },
  declaredAgreement === undefined ? [`Неизвестный класс заявленной симметрии "${declaredSymmetry}"`] : []);

  // V11: культурная совместимость, соответствие чистому профилю и допустимость гибрида.
  const tags = [...new Set(spec.tags)];
  const tagSet = new Set(tags);
  const forbiddenPairs = config.cultural.forbiddenPairs.filter(([a, b]) => tagSet.has(a) && tagSet.has(b));
  const secondary = spec.second_profile_id ? FLAG_PROFILE_CONFIG.find(({ id }) => id === spec.second_profile_id) : undefined;
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
  const missingEmblemMasks = Math.max(0, catalog.length - (evidence.emblemMasks?.length ?? 0));
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
    compositionMaskReady && invalidEmblemMasks === 0 && missingEmblemMasks === 0,
    { invalidCatalogItems: invalidCatalogIds.length, prohibitedMotifs: forbidden.length, chiralC4Agreement: chiralC4,
      invalidEmblemMasks, missingEmblemMasks, compositionMaskReady },
    { catalogItems: 0, prohibitedMotifs: 0, compositionMask: '64×64', emblemMasks: '64×64' },
    [...invalidCatalogIds.map((id) => `Элемент "${id}" отсутствует в каталоге`), ...forbidden,
      ...(!compositionMaskReady ? ['Отсутствует маска композиции размером 64×64'] : []),
      ...(invalidEmblemMasks ? [`Масок эмблем неверного размера: ${invalidEmblemMasks}`] : []),
      ...(missingEmblemMasks ? [`Не хватает масок эмблем: ${missingEmblemMasks}`] : [])]);

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

  // V14: внутренние углы многоугольников и невырожденность контуров.
  let minimumAngle = Infinity, degeneratePaths = 0;
  for (const path of evidence.paths) {
    if (path.points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
      degeneratePaths += 1;
      continue;
    }
    if (path.closed && path.points.length >= 3) {
      const computedArea = path.signedArea ?? pathArea(path.points);
      if (Math.abs(computedArea) < 1e-9) degeneratePaths += 1;
      for (let index = 0; index < path.points.length; index += 1) {
        const angle = interiorAngle(path.points, index);
        minimumAngle = Math.min(minimumAngle, angle);
      }
    }
  }
  const angleLimit = thresholds.minimumPolygonAngle ?? config.sharpAngles.minimumPolygonDegrees;
  const angleFailures: string[] = [];
  for (const path of evidence.paths) {
    if (!path.closed || path.points.length < 3) continue;
    const limit = path.sunRay ? thresholds.minimumSunRayAngle ?? config.sharpAngles.minimumSunRayDegrees : angleLimit;
    for (let index = 0; index < path.points.length; index += 1) {
      const angle = interiorAngle(path.points, index);
      if (angle < limit) angleFailures.push(`${path.sunRay ? 'луч солнца' : 'многоугольник'}: угол ${angle.toFixed(2)}° меньше ${limit}°`);
    }
  }
  checks.V14 = check(degeneratePaths === 0 && angleFailures.length === 0,
    { minimumAngle: Number.isFinite(minimumAngle) ? minimumAngle : null, degeneratePaths },
    { minimumPolygonAngle: angleLimit, minimumSunRayAngle: thresholds.minimumSunRayAngle ?? config.sharpAngles.minimumSunRayDegrees },
    angleFailures);

  // V15: синтаксис SVG, разрешённые элементы, диапазон координат и размер файла.
  if (typeof evidence.svg !== 'string') checks.V15 = unavailable('Нужен итоговый текст SVG');
  else {
    const svgWidth = Math.round(config.flagHeight * spec.outline.aspect);
    const svg = parseSvg(evidence.svg, thresholds.maximumSvgBytes ?? config.limits.svgBytes,
      svgWidth, config.flagHeight, evidence.embedMetadata ?? false, evidence.layers.map(({ id }) => id));
    checks.V15 = check(svg.passed, { bytes: svg.bytes, elements: svg.elements,
      unsupportedPathCommands: svg.pathCommands.filter((command) =>
        !(FLAG_VALIDATION_CONFIG.svg.allowedPathCommands as readonly string[]).includes(command)).length,
      badCoordinates: svg.badCoordinates }, { maximumBytes: thresholds.maximumSvgBytes ?? config.limits.svgBytes,
      allowedElements: [...FLAG_VALIDATION_CONFIG.svg.allowedElements,
        ...(evidence.embedMetadata ? ['metadata'] : [])] }, svg.reasons);
  }

  // V16: вырезы и зубцы контура не пересекают заряды, ширина деталей не меньше T_MIN.
  const exclusion = evidence.outlineExclusionMask;
  let featureIntersections = 0, undersizedFeatures = 0;
  const lowerEdge = String(spec.outline.params.lowerEdge ?? spec.outline.params.lower_edge ?? '').toUpperCase();
  const hasCutout = spec.outline.type === 'SWALLOW' || lowerEdge === 'SWALLOW' ||
    Boolean(spec.outline.params.edge);
  const expectsFeatures = lowerEdge === 'TEETH' || lowerEdge === 'SCALLOP' ||
    lowerEdge === 'TABS' || Boolean(spec.outline.params.edge);
  if (exclusion && exclusion.length === width * height) {
    for (const layer of evidence.layers.filter(({ role }) => role === 'charge')) {
      const mask = raster.layerMasks[layer.id];
      if (mask) for (let index = 0; index < mask.length; index += 1) if (mask[index] && exclusion[index]) featureIntersections += 1;
    }
  } else if (evidence.layers.some(({ role }) => role === 'charge') || hasCutout) {
    featureIntersections = -1;
  }
  const minFeatureWidth = (thresholds.minimumThicknessPx ?? config.minimumThicknessPx) *
    height / config.referenceRasterHeight;
  for (const feature of evidence.outlineFeatures ?? []) {
    if (feature.minimumWidthPx < minFeatureWidth || !Number.isFinite(feature.minimumWidthPx)) undersizedFeatures += 1;
    if (feature.mask && feature.mask.length === width * height && exclusion) {
      for (let index = 0; index < feature.mask.length; index += 1) {
        if (feature.mask[index] && exclusion[index]) featureIntersections += 1;
      }
    }
  }
  checks.V16 = check(featureIntersections === 0 && undersizedFeatures === 0 &&
    (!expectsFeatures || !!evidence.outlineFeatures?.length),
  { featureIntersections, undersizedFeatures, featureCount: evidence.outlineFeatures?.length ?? null },
  { minimumFeatureWidthPx: minFeatureWidth, intersections: 0 });

  // Отсутствие данных о форме не должно незаметно уменьшать полноту приёмочных проверок.
  if (missingMasks.length) {
    for (const rule of ['V08', 'V09', 'V16'] as const) {
      checks[rule].details.push(`Нет масок для слоёв: ${missingMasks.map(({ id }) => id).join(', ')}`);
    }
    checks.V08.passed = false;
    checks.V09.passed = false;
    if (evidence.layers.some(({ role }) => role === 'charge')) checks.V16.passed = false;
  }
  if (raster.layerIds.every((id) => id === null)) {
    checks.V08.passed = false;
    checks.V08.details.push('В эталонном растре не указаны видимые идентификаторы слоёв');
  }
  return { passed: RULES.every((rule) => checks[rule].passed), checks };
}

/** Название интерфейса validate из раздела 3 технического задания. */
export const validate = validateFlag;
