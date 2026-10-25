import { FLAG_COLOR_CONFIG } from './flagColorConfig';
import { FLAG_NOVELTY_CONFIG } from './flagNoveltyConfig';
import { FLAG_PROFILE_CONFIG, type FlagProfileConfig } from './flagProfileConfig';
import { deltaE76 } from './flagColors';
import type { FlagNode, FlagSpec } from './flagSpec';

const HASH_MASK = (1n << 64n) - 1n;
const REFERENCE_RASTER_WIDTH = FLAG_NOVELTY_CONFIG.referenceRasterWidth;
const CELL_COUNT = (FLAG_NOVELTY_CONFIG.mapElites.colorCount[1] - FLAG_NOVELTY_CONFIG.mapElites.colorCount[0] + 1)
  * FLAG_NOVELTY_CONFIG.mapElites.symmetries.length
  * FLAG_NOVELTY_CONFIG.mapElites.complexityBinCount
  * FLAG_NOVELTY_CONFIG.mapElites.outlineClasses.length
  * FLAG_NOVELTY_CONFIG.mapElites.structureFamilies.length;
const OPERATOR_CATALOG = [
  'G01', 'G02', 'G03', 'G04', 'G05', 'G06',
  'G07', 'G08', 'G09', 'G10', 'G11', 'G12',
] as const;
const MODULE_CATALOG = [
  'DISC', 'RING', 'STAR', 'POLYGON', 'RHOMBUS', 'CRESCENT', 'SUN', 'WHEEL',
  'CROSS_EMB', 'CHEVRON_ARROW', 'LENS', 'LILY', 'TOWER', 'CROWN', 'KEY',
  'SWORD', 'SPEAR', 'ANCHOR', 'TREE', 'MOUNTAIN', 'WAVES', 'SHIP', 'WINGED',
  'GLYPH', 'SWIRL', 'FOIL', 'FLAME', 'SHIELD', 'BOW_ARROW', 'BAR_STACK',
] as const;

export type FlagBatchMode = 'independent' | 'dedup' | 'farthest_point' | 'map_elites';
export type FlagSeed = string | number;
export type FlagRaster = { width: number; height: number; colors: (string | null)[] };
export type FlagSpecGenerator = (seed: FlagSeed, attempt: number) => FlagSpec;
export type FlagSpecMutator = (elite: FlagSpec, seed: FlagSeed) => FlagSpec;

export interface FlagNoveltyOptions {
  generate: FlagSpecGenerator;
  rasterize?: (spec: FlagSpec) => FlagRaster;
  mutate?: FlagSpecMutator;
  attempts_max?: number;
  map_mutation_iterations?: number;
  configured_operators?: readonly string[];
  configured_modules?: readonly string[];
}

export interface FlagBatchResult {
  flags: FlagSpec[];
  attempts: number;
  rejected: number;
  exhausted: boolean;
}

export interface FlagSimilarityResult {
  similarity: number;
  distance: number;
  comparable: boolean;
}

export interface FlagNoveltyDescriptor {
  structure_hash: string;
  visual_hash: string;
  field_operator: string;
  ordinary_family: string;
  module_family: string;
  structure_family: string;
  symmetry: string;
  outline_class: string;
  palette_archetype: string;
}

export interface FlagSpaceEstimate {
  estimate: string;
  factors: Record<string, string>;
  details: Record<string, string>;
  assumptions: string[];
}

export interface FlagMetrics {
  sample_count: number;
  entropy: Record<string, { value: number; categories: number }>;
  unique_structure_hashes: number;
  unique_visual_hashes: number;
  leader_clusters_at_090: number;
  map_elites_coverage: { occupied: number; total: number; ratio: number };
  operator_frequencies: Record<string, number>;
  module_frequencies: Record<string, number>;
  dead_operators: string[];
  dead_modules: string[];
  attempts: { measured_count: number; values: number[]; mean: number | null; histogram: Record<string, number> };
  fallback: { count: number; measured_count: number; ratio: number | null };
}

function fnv64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & HASH_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

function quantizeNumbers(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * FLAG_NOVELTY_CONFIG.quantizationDivisor) / FLAG_NOVELTY_CONFIG.quantizationDivisor;
  if (Array.isArray(value)) return value.map(quantizeNumbers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, quantizeNumbers(child)]));
  }
  return value;
}

function structureProjection(spec: FlagSpec): unknown {
  return quantizeNumbers({
    outline: { type: spec.outline.type, params: spec.outline.params, aspect: spec.outline.aspect },
    slots: spec.slots,
    root: spec.root,
  });
}

/** Хеширует дерево операторов и квантует числа шагом 1/24; цветовые значения не участвуют. */
export function structureHash(spec: FlagSpec): string {
  return fnv64(stableJson(structureProjection(spec)));
}

/** Хеш структуры и назначений цветов по слотам. */
export function visualHash(spec: FlagSpec): string {
  const palette = Object.fromEntries(spec.slots.items.map((slot) => [slot, spec.palette[slot]?.hex?.toUpperCase() ?? null]));
  return fnv64(`${structureHash(spec)}|${stableJson(palette)}`);
}

/** Записывает вычисленные хеши в meta перед сохранением или выдачей FlagSpec. */
export function stampFlagHashes(spec: FlagSpec): FlagSpec {
  spec.meta.structure_hash = structureHash(spec);
  spec.meta.visual_hash = visualHash(spec);
  return spec;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nodeOperator(node: FlagNode): string[] {
  if (node.kind === 'split') return [node.op, ...node.children.flatMap(nodeOperator)];
  if (node.kind === 'group') return node.children.flatMap(nodeOperator);
  if (node.kind === 'repeat' || node.kind === 'mirror' || node.kind === 'counterchange') {
    return node.kind === 'counterchange'
      ? [node.kind, ...node.copies.flatMap((copy) => nodeOperator(copy.child))]
      : [node.kind, ...nodeOperator(node.child)];
  }
  if (node.kind === 'layer') {
    return node.frame
      ? [...nodeOperator(node.frame.ground), ...node.frame.layers.flatMap(nodeOperator)]
      : [];
  }
  return [];
}

function walkLayers(node: FlagNode, result: { role: string; shape: unknown; tags: string[] }[]): void {
  if (node.kind === 'layer') {
    result.push({ role: node.layer.role, shape: node.layer.shape, tags: node.layer.tags });
    if (node.frame) {
      walkLayers(node.frame.ground, result);
      node.frame.layers.forEach((child) => walkLayers(child, result));
    }
  } else if (node.kind === 'split' || node.kind === 'group') {
    node.children.forEach((child) => walkLayers(child, result));
  } else if (node.kind === 'repeat' || node.kind === 'mirror') {
    walkLayers(node.child, result);
  } else if (node.kind === 'counterchange') {
    node.copies.forEach((copy) => walkLayers(copy.child, result));
  }
}

function firstNonGroundLayer(spec: FlagSpec, roles: string[]): { role: string; shape: unknown; tags: string[] } | undefined {
  const all: { role: string; shape: unknown; tags: string[] }[] = [];
  spec.root.layers.forEach((node) => walkLayers(node, all));
  return all.find((layer) => roles.includes(layer.role));
}

function paletteArchetype(spec: FlagSpec): string {
  const colors = new Set(Object.values(spec.palette).map((entry) => entry.color_id));
  const matches = FLAG_COLOR_CONFIG.archetypes
    .filter((archetype) => archetype.groups.every((group) => group.some((color) => colors.has(color))))
    .sort((a, b) => a.id.localeCompare(b.id));
  return matches[0]?.id ?? 'free';
}

function fieldOperator(spec: FlagSpec): string {
  const operators = nodeOperator(spec.root.ground).filter((op) => OPERATOR_CATALOG.includes(op as typeof OPERATOR_CATALOG[number]));
  return operators[0] ?? 'G01';
}

function moduleName(shape: unknown): string {
  const value = object(shape);
  const candidate = String(value?.module ?? value?.type ?? value?.kind ?? 'NONE').toUpperCase();
  return MODULE_CATALOG.includes(candidate as typeof MODULE_CATALOG[number]) ? candidate : (candidate === 'NONE' ? 'NONE' : 'OTHER');
}

function outlineClass(spec: FlagSpec): string {
  return ['RECT', 'PENNANT', 'SWALLOW', 'BANNER', 'OTHER'].includes(spec.outline.type)
    ? spec.outline.type
    : 'OTHER';
}

function structureFamily(spec: FlagSpec): string {
  const op = fieldOperator(spec);
  if (op === 'G02' || op === 'G03') return 'полосы';
  if (op === 'G01' && firstNonGroundLayer(spec, ['ordinary'])) return 'крест';
  if (['G04', 'G05', 'G06', 'G07'].includes(op)) return 'деления';
  if (firstNonGroundLayer(spec, ['canton'])) return 'кантон';
  if (firstNonGroundLayer(spec, ['ordinary'])) {
    const shape = firstNonGroundLayer(spec, ['ordinary'])?.shape;
    const type = String(object(shape)?.type ?? '').toLowerCase();
    if (type.includes('pile') || type.includes('triangle') || type.includes('wedge')) return 'клин';
  }
  if (['G09', 'G10', 'G11', 'G12'].includes(op)) return 'сетка-узор';
  if (firstNonGroundLayer(spec, ['charge'])) return 'диск-заряд';
  return 'прочее';
}

/** Описывает признаки структуры и палитры, используемые пакетными режимами и метриками. */
export function describeFlagNovelty(spec: FlagSpec): FlagNoveltyDescriptor {
  const ordinary = firstNonGroundLayer(spec, ['ordinary', 'border']);
  const charge = firstNonGroundLayer(spec, ['charge']);
  const shapeType = (shape: unknown) => String(object(shape)?.module ?? object(shape)?.type ?? 'NONE').toUpperCase();
  return {
    structure_hash: structureHash(spec),
    visual_hash: visualHash(spec),
    field_operator: fieldOperator(spec),
    ordinary_family: ordinary ? shapeType(ordinary.shape) : 'NONE',
    module_family: charge ? moduleName(charge.shape) : 'NONE',
    structure_family: structureFamily(spec),
    symmetry: String(spec.meta.symmetry_actual ?? spec.meta.symmetry ?? 'NONE').toUpperCase(),
    outline_class: outlineClass(spec),
    palette_archetype: paletteArchetype(spec),
  };
}

function fillColor(spec: FlagSpec, fill: unknown): string | null {
  if (typeof fill !== 'string') throw new TypeError('Растеризатор новизны не поддерживает узорные заливки');
  const color = spec.palette[fill]?.hex;
  if (!color) throw new TypeError(`Для слота "${fill}" не задан цвет`);
  return color.toUpperCase();
}

function writeRect(raster: FlagRaster, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
  const maxX = Math.min(raster.width, Math.ceil(Math.max(x0, x1)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
  const maxY = Math.min(raster.height, Math.ceil(Math.max(y0, y1)));
  for (let y = minY; y < maxY; y += 1) for (let x = minX; x < maxX; x += 1) {
    raster.colors[y * raster.width + x] = color;
  }
}

function containsPolygon(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function drawShape(raster: FlagRaster, shape: unknown, color: string): void {
  const value = object(shape);
  if (!value) throw new TypeError('Для растеризации нужна геометрическая фигура слоя');
  const scaleX = raster.width;
  const scaleY = raster.height;
  const normalized = value.units !== 'pixels';
  const px = (n: unknown, scale: number) => Number(n ?? 0) * (normalized ? scale : 1);
  const type = String(value.type ?? value.module ?? '').toLowerCase();
  if (type === 'rect' || type === 'rectangle') {
    const x = px(value.x, scaleX), y = px(value.y, scaleY);
    const w = px(value.w ?? value.width, scaleX), h = px(value.h ?? value.height, scaleY);
    writeRect(raster, x, y, x + w, y + h, color);
    return;
  }
  if (type === 'polygon' || type === 'star') {
    let points = Array.isArray(value.points) ? value.points : [];
    if (type === 'star' && points.length === 0) {
      const cx = px(value.cx ?? 0.5, scaleX), cy = px(value.cy ?? 0.5, scaleY);
      const radius = px(value.radius ?? 0.2, Math.min(scaleX, scaleY));
      const inner = radius * Number(value.inner_ratio ?? 0.42);
      points = Array.from({ length: Number(value.points_count ?? 10) }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI / 5;
        const r = index % 2 ? inner : radius;
        return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
      });
    }
    const polygon = points.map((point) => {
      const p = object(point) ?? {};
      return { x: px(p.x ?? p.u, scaleX), y: px(p.y ?? p.v, scaleY) };
    });
    const bounds = polygon.reduce((result, p) => ({
      minX: Math.min(result.minX, p.x), maxX: Math.max(result.maxX, p.x),
      minY: Math.min(result.minY, p.y), maxY: Math.max(result.maxY, p.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    for (let y = Math.max(0, Math.floor(bounds.minY)); y < Math.min(raster.height, Math.ceil(bounds.maxY)); y += 1) {
      for (let x = Math.max(0, Math.floor(bounds.minX)); x < Math.min(raster.width, Math.ceil(bounds.maxX)); x += 1) {
        if (containsPolygon(x + 0.5, y + 0.5, polygon)) raster.colors[y * raster.width + x] = color;
      }
    }
    return;
  }
  if (['circle', 'disc', 'disk'].includes(type)) {
    const cx = px(value.cx ?? value.x ?? 0.5, scaleX);
    const cy = px(value.cy ?? value.y ?? 0.5, scaleY);
    const radius = px(value.radius ?? value.r ?? 0.2, Math.min(scaleX, scaleY));
    const minX = Math.max(0, Math.floor(cx - radius)), maxX = Math.min(raster.width, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius)), maxY = Math.min(raster.height, Math.ceil(cy + radius));
    for (let y = minY; y < maxY; y += 1) for (let x = minX; x < maxX; x += 1) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius ** 2) raster.colors[y * raster.width + x] = color;
    }
    return;
  }
  throw new TypeError(`Фигура слоя "${type || 'без типа'}" не поддерживается растеризатором новизны; передайте адаптер rasterize`);
}

function paintNode(spec: FlagSpec, raster: FlagRaster, node: FlagNode): void {
  if (node.kind === 'fill') {
    const color = fillColor(spec, node.fill);
    if (color) raster.colors.fill(color);
  } else if (node.kind === 'split') {
    const op = node.op.toUpperCase();
    const params = node.params as Record<string, unknown>;
    if (!['G02', 'BANDS', 'G04', 'SPLIT2', 'G05', 'QUARTERLY'].includes(op)) {
      throw new TypeError(`Оператор поля "${op}" не поддерживается растеризатором новизны; передайте адаптер rasterize`);
    }
    if (node.children.some((child) => child.kind !== 'fill')) {
      throw new TypeError(`Вложенные разбиения "${op}" требуют адаптера rasterize`);
    }
    const colors = node.children.map((child) => child.kind === 'fill' ? fillColor(spec, child.fill) : null);
    if (op === 'G02' || op === 'BANDS') {
      const axis = String(params.axis ?? 'H').toUpperCase();
      const total = axis === 'V' ? raster.width : raster.height;
      const weights = Array.isArray(params.weights) ? params.weights.map(Number) : node.children.map(() => 1);
      const sum = weights.reduce((a, b) => a + b, 0) || node.children.length;
      let cursor = 0;
      node.children.forEach((_, index) => {
        const next = index === node.children.length - 1 ? total : cursor + total * (weights[index] ?? 1) / sum;
        if (colors[index]) {
          if (axis === 'V') writeRect(raster, cursor, 0, next, raster.height, colors[index] as string);
          else writeRect(raster, 0, cursor, raster.width, next, colors[index] as string);
        }
        cursor = next;
      });
    } else if (op === 'G04' || op === 'SPLIT2') {
      const mode = String(params.mode ?? params.type ?? params.axis ?? 'PALE').toUpperCase();
      const p = Number(params.position ?? 0.5);
      for (let y = 0; y < raster.height; y += 1) for (let x = 0; x < raster.width; x += 1) {
        const fractionX = (x + 0.5) / raster.width, fractionY = (y + 0.5) / raster.height;
        const first = mode.includes('FESS') ? fractionY < p
          : mode.includes('BEND') || mode.includes('DIAG') ? fractionX + fractionY < 1
            : fractionX < p;
        const color = colors[first ? 0 : 1];
        if (color) raster.colors[y * raster.width + x] = color;
      }
    } else if (op === 'G05' || op === 'QUARTERLY') {
      const point = object(params.point) ?? {};
      const splitX = Number(point.u ?? params.px ?? 0.5);
      const splitY = Number(point.v ?? params.py ?? 0.5);
      for (let y = 0; y < raster.height; y += 1) for (let x = 0; x < raster.width; x += 1) {
        const right = (x + 0.5) / raster.width >= splitX;
        const bottom = (y + 0.5) / raster.height >= splitY;
        const quadrant = bottom ? (right ? 3 : 2) : (right ? 1 : 0);
        const color = colors[quadrant];
        if (color) raster.colors[y * raster.width + x] = color;
      }
    }
  } else if (node.kind === 'layer') {
    const color = fillColor(spec, node.layer.fill);
    const transform = object(node.layer.transform);
    const translate = object(transform?.translate);
    if (Number(transform?.rotate ?? 0) !== 0 || Number(transform?.scale ?? 1) !== 1 ||
        Number(translate?.u ?? 0) !== 0 || Number(translate?.v ?? 0) !== 0) {
      throw new TypeError('Преобразования слоя требуют адаптера rasterize');
    }
    if (node.frame) throw new TypeError('Вложенные рамки требуют адаптера rasterize');
    if (color) drawShape(raster, node.layer.shape, color);
  } else {
    throw new TypeError(`Узел "${node.kind}" требует адаптера rasterize`);
  }
}

function inFlagOutline(spec: FlagSpec, x: number, y: number, width: number, height: number): boolean {
  const u = x / width, v = y / height;
  const params = spec.outline.params;
  const ratio = (keys: string[], fallback: number) => {
    for (const key of keys) {
      const value = params[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1 ? value / 1200 : value;
      }
    }
    return fallback;
  };
  let points: { x: number; y: number }[] | undefined;
  if (spec.outline.type === 'PENNANT') {
    const thickness = ratio(['thickness_ratio', 'thickness', 't'], 0);
    points = [{ x: 0, y: 0 }, { x: 1, y: 0.5 - thickness / 2 }, { x: 1, y: 0.5 + thickness / 2 }, { x: 0, y: 1 }];
  } else if (spec.outline.type === 'SWALLOW') {
    const depth = ratio(['depth_ratio', 'depth', 'd'], 0.1);
    points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1 - depth, y: 0.5 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  } else if (spec.outline.type === 'DOUBLE_PENNANT') {
    const y = ratio(['waist_y', 'ys'], 0.5);
    const outer = ratio(['outer_point_x', 'w1'], 0.7);
    const inner = ratio(['inner_point_x', 'xn'], 0.35);
    points = [{ x: 0, y: 0 }, { x: outer, y }, { x: inner, y }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  } else if (spec.outline.type === 'BANNER') {
    const lower = String(params.lowerEdge ?? params.lower_edge ?? 'STRAIGHT').toUpperCase();
    if (!['STRAIGHT', 'POINT'].includes(lower)) {
      throw new TypeError(`Нижний край знамени "${lower}" требует адаптера rasterize`);
    }
    if (lower === 'POINT') {
      const depth = ratio(['point_depth_ratio', 'point_depth'], 0.15);
      points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 - depth }, { x: 0.5, y: 1 }, { x: 0, y: 1 - depth }];
    } else {
      points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    }
  }
  if (!['RECT', 'PENNANT', 'SWALLOW', 'DOUBLE_PENNANT', 'BANNER'].includes(spec.outline.type)) {
    throw new TypeError(`Контур "${spec.outline.type}" требует адаптера rasterize`);
  }
  return !points || containsPolygon(u, v, points);
}

/** Растеризатор простого подмножества FlagSpec для воспроизводимого сравнения эталонов. */
export function rasterizeFlagSpec(spec: FlagSpec): FlagRaster {
  const aspect = spec.outline.aspect;
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError('aspect должен быть положительным');
  const width = REFERENCE_RASTER_WIDTH;
  const height = Math.max(1, Math.round(width / aspect));
  const raster: FlagRaster = { width, height, colors: Array(width * height).fill(null) };
  if (spec.root.x0 !== 0 || spec.root.y0 !== 0 || spec.root.w !== 1 || spec.root.h !== 1) {
    throw new TypeError('Растеризатор новизны принимает только корневую рамку 0,0,1,1; передайте адаптер rasterize');
  }
  paintNode(spec, raster, spec.root.ground);
  spec.root.layers.forEach((node) => paintNode(spec, raster, node));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!inFlagOutline(spec, x + 0.5, y + 0.5, width, height)) raster.colors[y * width + x] = null;
  }
  return raster;
}

const rasterCache = new WeakMap<FlagSpec, { key: string; raster: FlagRaster }>();

function cachedRasterizeFlagSpec(spec: FlagSpec): FlagRaster {
  const key = stableJson({ outline: spec.outline, root: spec.root, palette: spec.palette });
  const cached = rasterCache.get(spec);
  if (cached?.key === key) return cached.raster;
  const raster = rasterizeFlagSpec(spec);
  rasterCache.set(spec, { key, raster });
  return raster;
}

function normalizedRasterColor(raster: FlagRaster, x: number, y: number, targetHeight: number): string | null {
  const sourceX = Math.min(raster.width - 1, Math.floor((x + 0.5) * raster.width / REFERENCE_RASTER_WIDTH));
  const sourceY = Math.min(raster.height - 1, Math.floor((y + 0.5) * raster.height / targetHeight));
  return raster.colors[sourceY * raster.width + sourceX] ?? null;
}

/** Сходство по средней ΔE76 с нормированием до сетки 64×64; несовместимые контуры дают 0. */
export function compareFlagSpecs(
  first: FlagSpec,
  second: FlagSpec,
  rasterize: (spec: FlagSpec) => FlagRaster = cachedRasterizeFlagSpec,
): FlagSimilarityResult {
  if (first.outline.type !== second.outline.type ||
      Math.abs(first.outline.aspect - second.outline.aspect) / first.outline.aspect >
        FLAG_NOVELTY_CONFIG.similarity.maximumRelativeAspectDifference) {
    return { similarity: 0, distance: 1, comparable: false };
  }
  const a = rasterize(first), b = rasterize(second);
  let deltaSum = 0;
  for (let y = 0; y < REFERENCE_RASTER_WIDTH; y += 1) for (let x = 0; x < REFERENCE_RASTER_WIDTH; x += 1) {
    const ca = normalizedRasterColor(a, x, y, 64);
    const cb = normalizedRasterColor(b, x, y, 64);
    deltaSum += ca && cb ? deltaE76(ca, cb) : ca === cb ? 0 : FLAG_NOVELTY_CONFIG.similarity.transparentPixelPenalty;
  }
  const similarity = Math.max(0, Math.min(1,
    1 - deltaSum / (REFERENCE_RASTER_WIDTH * REFERENCE_RASTER_WIDTH) / FLAG_NOVELTY_CONFIG.similarity.maximumDeltaE));
  return { similarity, distance: 1 - similarity, comparable: true };
}

/** Возвращает true, когда найдено совпадение с любым эталоном по §16.2. */
export function matchesReference(
  candidate: FlagSpec,
  references: readonly FlagSpec[],
  rasterize: (spec: FlagSpec) => FlagRaster = cachedRasterizeFlagSpec,
): boolean {
  const visual = visualHash(candidate);
  return references.some((reference) =>
    visualHash(reference) === visual ||
    compareFlagSpecs(candidate, reference, rasterize).similarity >= FLAG_NOVELTY_CONFIG.similarity.referenceRejection);
}

function gridHashKeys(spec: FlagSpec, rasterize: (spec: FlagSpec) => FlagRaster): string[] {
  const raster = rasterize(spec);
  const gridSize = FLAG_NOVELTY_CONFIG.deduplication.hashGridSize;
  const keys: string[] = [];
  for (let gridY = 0; gridY < gridSize; gridY += 1) {
    for (let gridX = 0; gridX < gridSize; gridX += 1) {
      const left = Math.floor(gridX * raster.width / gridSize);
      const right = Math.max(left + 1, Math.floor((gridX + 1) * raster.width / gridSize));
      const top = Math.floor(gridY * raster.height / gridSize);
      const bottom = Math.max(top + 1, Math.floor((gridY + 1) * raster.height / gridSize));
      const cell: string[] = [];
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) cell.push(raster.colors[y * raster.width + x] ?? 'transparent');
      }
      keys.push(`${gridY * gridSize + gridX}:${fnv64(cell.join(','))}`);
    }
  }
  return keys;
}

function numericSeed(seed: FlagSeed, increment: number): FlagSeed {
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) {
    if (increment === 0) return seed;
    throw new TypeError('Режимы пакетной генерации требуют целочисленный числовой seed');
  }
  const next = seed + increment;
  if (!Number.isSafeInteger(next)) throw new RangeError('seed вышел за безопасный целочисленный диапазон');
  return next;
}

function quality(spec: FlagSpec): number {
  const value = (spec.meta as typeof spec.meta & { quality?: number; Q?: number }).quality
    ?? (spec.meta as typeof spec.meta & { Q?: number }).Q;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function gridCell(spec: FlagSpec): number {
  const descriptor = describeFlagNovelty(spec);
  const colorBin = Math.max(0, Math.min(
    FLAG_NOVELTY_CONFIG.mapElites.colorCount[1] - FLAG_NOVELTY_CONFIG.mapElites.colorCount[0],
    spec.meta.color_count - FLAG_NOVELTY_CONFIG.mapElites.colorCount[0],
  ));
  const symmetryBin = Math.max(0, (FLAG_NOVELTY_CONFIG.mapElites.symmetries as readonly string[]).indexOf(descriptor.symmetry));
  const complexityBin = Math.min(
    FLAG_NOVELTY_CONFIG.mapElites.complexityBinCount - 1,
    Math.floor(spec.meta.complexity / FLAG_NOVELTY_CONFIG.mapElites.complexityBinCount),
  );
  const outlineBin = Math.max(0, (FLAG_NOVELTY_CONFIG.mapElites.outlineClasses as readonly string[]).indexOf(descriptor.outline_class));
  const familyBin = Math.max(0, (FLAG_NOVELTY_CONFIG.mapElites.structureFamilies as readonly string[]).indexOf(descriptor.structure_family));
  const { symmetries, complexityBinCount, outlineClasses, structureFamilies } = FLAG_NOVELTY_CONFIG.mapElites;
  return ((((colorBin * symmetries.length + symmetryBin) * complexityBinCount + complexityBin) *
    outlineClasses.length + outlineBin) * structureFamilies.length + familyBin);
}

function distanceToSet(spec: FlagSpec, set: readonly FlagSpec[], rasterize: (spec: FlagSpec) => FlagRaster): number {
  if (!set.length) return 1;
  return Math.min(...set.map((other) => compareFlagSpecs(spec, other, rasterize).distance));
}

/** Реализует четыре режима пакетной генерации; ошибки исчерпания не маскируются. */
export function batchFlags(count: number, seed: FlagSeed, mode: FlagBatchMode, options: FlagNoveltyOptions): FlagBatchResult {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('count должен быть неотрицательным целым');
  if (!options || typeof options.generate !== 'function') throw new TypeError('нужно передать функцию generate');
  if (count === 0) return { flags: [], attempts: 0, rejected: 0, exhausted: false };
  const rasterize = options.rasterize ?? cachedRasterizeFlagSpec;
  let attempts = 0, rejected = 0;
  const generate = (index: number, attempt = 0) => {
    attempts += 1;
    return options.generate(numericSeed(seed, index), attempt);
  };
  if (mode === 'independent') {
    return { flags: Array.from({ length: count }, (_, index) => generate(index)), attempts: count, rejected: 0, exhausted: false };
  }
  if (mode === 'dedup') {
    const flags: FlagSpec[] = [];
    const hashIndex = new Map<string, Set<number>>();
    const indexFlag = (spec: FlagSpec, flagIndex: number) => {
      for (const key of gridHashKeys(spec, rasterize)) {
        const bucket = hashIndex.get(key) ?? new Set<number>();
        bucket.add(flagIndex);
        hashIndex.set(key, bucket);
      }
    };
    let seedOffset = 0;
    for (let index = 0; index < count; index += 1) {
      let accepted: FlagSpec | undefined;
      for (let attempt = 0; attempt < (options.attempts_max ?? FLAG_NOVELTY_CONFIG.deduplication.attemptsPerFlag); attempt += 1) {
        const candidate = generate(seedOffset, attempt);
        seedOffset += 1;
        const shared = new Map<number, number>();
        for (const key of gridHashKeys(candidate, rasterize)) {
          for (const flagIndex of hashIndex.get(key) ?? []) shared.set(flagIndex, (shared.get(flagIndex) ?? 0) + 1);
        }
        const localCandidates = [...shared.entries()].sort((a, b) => b[1] - a[1]).map(([flagIndex]) => flagIndex);
        const localSet = new Set(localCandidates);
        const orderedCandidates = [...localCandidates, ...flags.map((_, flagIndex) => flagIndex).filter((flagIndex) => !localSet.has(flagIndex))];
        const duplicate = orderedCandidates.some((flagIndex) =>
          compareFlagSpecs(candidate, flags[flagIndex], rasterize).similarity >= FLAG_NOVELTY_CONFIG.similarity.deduplication);
        if (!duplicate) {
          accepted = candidate;
          break;
        }
        rejected += 1;
      }
      if (!accepted) return { flags, attempts, rejected, exhausted: true };
      flags.push(accepted);
      indexFlag(accepted, flags.length - 1);
    }
    return { flags, attempts, rejected, exhausted: false };
  }
  if (mode === 'farthest_point') {
    const pool = Array.from({ length: count * FLAG_NOVELTY_CONFIG.farthestPoint.poolMultiplier }, (_, index) => generate(index));
    const selected: FlagSpec[] = [];
    const remaining = new Set(pool.map((_, index) => index));
    let best = 0;
    for (let i = 1; i < pool.length; i += 1) if (quality(pool[i]) > quality(pool[best])) best = i;
    if (pool.length) {
      selected.push(pool[best]);
      remaining.delete(best);
    }
    while (selected.length < count && remaining.size) {
      let chosen = -1, maximumDistance = -1;
      for (const index of remaining) {
        const distance = distanceToSet(pool[index], selected, rasterize);
        if (distance > maximumDistance || (distance === maximumDistance && quality(pool[index]) > quality(pool[chosen]))) {
          chosen = index;
          maximumDistance = distance;
        }
      }
      selected.push(pool[chosen]);
      remaining.delete(chosen);
    }
    return { flags: selected, attempts, rejected: pool.length - selected.length, exhausted: selected.length < count };
  }
  if (mode === 'map_elites') {
    if (typeof options.mutate !== 'function') throw new TypeError('map_elites требует функцию mutate');
    const elites = new Map<number, FlagSpec>();
    const consider = (candidate: FlagSpec) => {
      const cell = gridCell(candidate);
      const previous = elites.get(cell);
      if (!previous || quality(candidate) > quality(previous)) elites.set(cell, candidate);
    };
    const initialCount = Math.max(count * FLAG_NOVELTY_CONFIG.mapElites.initialPoolMultiplier, Math.min(CELL_COUNT, count));
    for (let i = 0; i < initialCount; i += 1) consider(generate(i));
    const iterations = options.map_mutation_iterations ?? Math.max(
      count * FLAG_NOVELTY_CONFIG.mapElites.mutationIterationMultiplier,
      FLAG_NOVELTY_CONFIG.mapElites.minimumMutationIterations,
    );
    for (let i = 0; i < iterations; i += 1) {
      const current = [...elites.entries()].sort(([a], [b]) => a - b);
      if (!current.length) break;
      const [cell, elite] = current[i % current.length];
      const mutantSeed = numericSeed(seed, initialCount + i);
      attempts += 1;
      const mutant = options.mutate(elite, mutantSeed);
      if (gridCell(mutant) === cell && quality(mutant) <= quality(elite)) rejected += 1;
      else consider(mutant);
    }
    const flags = [...elites.values()].sort((a, b) => quality(b) - quality(a)).slice(0, count);
    return { flags, attempts, rejected, exhausted: flags.length < count };
  }
  throw new TypeError(`Неизвестный режим пакетной генерации: ${String(mode)}`);
}

function shannon(values: readonly string[], maximumCategories: number): { value: number; categories: number } {
  if (!values.length) return { value: 0, categories: 0 };
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const entropy = [...counts.values()].reduce((sum, count) => {
    const p = count / values.length;
    return sum - p * Math.log(p);
  }, 0);
  const denominator = Math.log(Math.max(2, maximumCategories));
  return { value: entropy / denominator, categories: counts.size };
}

function slotColorId(spec: FlagSpec, slot: string): string {
  return spec.palette[slot]?.color_id ?? 'unknown';
}

function matchesArchetype(spec: FlagSpec, archetype: typeof FLAG_COLOR_CONFIG.archetypes[number]): boolean {
  const colors = new Set(spec.slots.items.map((slot) => slotColorId(spec, slot)));
  return archetype.groups.every((group) => group.some((color) => colors.has(color)));
}

function profileById(profile: string | FlagProfileConfig): FlagProfileConfig {
  if (typeof profile !== 'string') return profile;
  const found = FLAG_PROFILE_CONFIG.find((entry) => entry.id === profile);
  if (!found) throw new RangeError(`Неизвестный профиль флага: ${profile}`);
  return found;
}

function q24Range(range: readonly number[]): bigint {
  if (range.length < 2 || !range.every(Number.isFinite) || range[1] < range[0]) return 1n;
  return BigInt(Math.max(1, Math.floor((range[1] - range[0]) * FLAG_NOVELTY_CONFIG.quantizationDivisor) + 1));
}

/** Оценивает количество структур и возвращает все использованные множители отдельно. */
export function estimateFlagSpace(profile: string | FlagProfileConfig): FlagSpaceEstimate {
  const definition = profileById(profile);
  const assumptions: string[] = [
    'Непрерывные параметры считаются дискретными с шагом 1/24 согласно §16.2.',
    'Неизвестные или нулевые веса не включаются; оценка является консервативным нижним пределом.',
    'Порядок слоёв учитывается, а совпадающие результирующие структуры отдельно не исключаются.',
    'Для каждого до трёх ординариев и зарядов учтён один свободный параметр 0..1; остальные параметры и ограничения пар не расширяют множитель.',
  ];
  const weightedCount = (weights: Record<string, number | null> | null | undefined): bigint =>
    BigInt(weights ? Object.values(weights).filter((weight) => typeof weight === 'number' && weight > 0).length : 0);
  const outlineTypes = weightedCount(definition.OUT);
  const aspectOptions = definition.OUT
    ? Object.entries(definition.OUT)
      .filter(([, weight]) => typeof weight === 'number' && weight > 0)
      .reduce((sum, [key]) => {
        const encoded = key.split(':').slice(1).join(':');
        const listed = encoded.match(/-?\d+(?:\.\d+)?/g)?.length ?? 0;
        return sum + BigInt(listed || (key.includes('RECT') ? 11 : 1));
      }, 0n)
    : 0n;
  const aspects = outlineTypes === 0n ? 0n : aspectOptions;
  const fieldOperators = weightedCount(definition.GND);
  const ordinaryFamilies = weightedCount(definition.ORD);
  const moduleFamilies = weightedCount(definition.CHG?.modules);
  const chargeGroupRange = definition.CHG?.groups ?? [0, 0];
  const chargeCounts = chargeGroupRange[0] <= chargeGroupRange[1]
    ? Array.from({ length: chargeGroupRange[1] - chargeGroupRange[0] + 1 }, (_, index) => chargeGroupRange[0] + index)
    : [0];
  let chargeSets = 0n;
  for (const count of chargeCounts) chargeSets += moduleFamilies ** BigInt(count);
  const colorSlots = weightedCount(definition.K);
  const slotAssignments = colorSlots > 0n ? colorSlots : 1n;
  const fieldSettings = definition.GND
    ? Object.entries(definition.GND)
      .filter(([, weight]) => typeof weight === 'number' && weight > 0)
      .reduce((sum, [key]) => {
        const normalized = key.toUpperCase().split(/[:(]/, 1)[0];
        const cardinality = FLAG_NOVELTY_CONFIG.fieldOperatorCardinalities[normalized as keyof typeof FLAG_NOVELTY_CONFIG.fieldOperatorCardinalities] ?? 1;
        return sum + BigInt(cardinality);
      }, 0n)
    : 0n;
  let ordinarySets = 1n;
  for (let count = 1; count <= 3; count += 1) ordinarySets += ordinaryFamilies ** BigInt(count);
  const ordinaryParameterStates = ordinaryFamilies ? q24Range(FLAG_NOVELTY_CONFIG.estimateParameterRange) ** 3n : 1n;
  const chargeParameterStates = moduleFamilies ? q24Range(FLAG_NOVELTY_CONFIG.estimateParameterRange) ** 3n : 1n;
  const factors: Record<string, bigint> = {
    outline_aspect_pairs: aspects,
    field_operator_settings: fieldSettings,
    ordinary_sets: ordinaryFamilies > 0n ? ordinarySets : 1n,
    charge_sets: chargeSets > 0n ? chargeSets : 1n,
    quantized_ordinary_parameters: ordinaryParameterStates,
    quantized_charge_parameters: chargeParameterStates,
    slots: slotAssignments,
  };
  let total = 1n;
  for (const factor of Object.values(factors)) total *= factor;
  return {
    estimate: total.toString(),
    factors: Object.fromEntries(Object.entries(factors).map(([key, value]) => [key, value.toString()])),
    details: {
      outline_types: outlineTypes.toString(),
      field_operator_types: fieldOperators.toString(),
      ordinary_operator_types: ordinaryFamilies.toString(),
      charge_module_types: moduleFamilies.toString(),
      color_count_choices: colorSlots.toString(),
    },
    assumptions,
  };
}

function mapCellCoverage(flags: readonly FlagSpec[]): number {
  return new Set(flags.map(gridCell)).size;
}

function countOperatorTokens(spec: FlagSpec): string[] {
  const tokens = nodeOperator(spec.root.ground).filter((value) => OPERATOR_CATALOG.includes(value as typeof OPERATOR_CATALOG[number]));
  return tokens.length ? tokens : ['G01'];
}

function countModuleTokens(spec: FlagSpec): string[] {
  const layers: { role: string; shape: unknown; tags: string[] }[] = [];
  spec.root.layers.forEach((node) => walkLayers(node, layers));
  return layers.filter((layer) => layer.role === 'charge').map((layer) => moduleName(layer.shape)).filter((module) => module !== 'NONE');
}

/** Считает энтропии, кластеры-лидеры, покрытие, частоты, попытки и fallback. */
export function metrics(
  flags: readonly FlagSpec[],
  options: Pick<FlagNoveltyOptions, 'rasterize' | 'configured_operators' | 'configured_modules'> = {},
): FlagMetrics {
  const rasterize = options.rasterize ?? cachedRasterizeFlagSpec;
  const descriptors = flags.map(describeFlagNovelty);
  const features = {
    profile: { values: flags.map((flag) => flag.profile_id), max: FLAG_PROFILE_CONFIG.length },
    outline: { values: descriptors.map((item) => item.outline_class), max: FLAG_NOVELTY_CONFIG.mapElites.outlineClasses.length },
    field_operator: { values: descriptors.map((item) => item.field_operator), max: OPERATOR_CATALOG.length },
    ordinary_family: { values: descriptors.map((item) => item.ordinary_family), max: FLAG_NOVELTY_CONFIG.metricCategories.ordinaryFamilies },
    module_family: { values: descriptors.map((item) => item.module_family), max: FLAG_NOVELTY_CONFIG.metricCategories.moduleFamilies },
    color_count: {
      values: flags.map((flag) => String(flag.meta.color_count)),
      max: FLAG_NOVELTY_CONFIG.mapElites.colorCount[1] - FLAG_NOVELTY_CONFIG.mapElites.colorCount[0] + 1,
    },
    palette_archetype: { values: descriptors.map((item) => item.palette_archetype), max: FLAG_COLOR_CONFIG.archetypes.length + 1 },
    symmetry: { values: descriptors.map((item) => item.symmetry), max: FLAG_NOVELTY_CONFIG.mapElites.symmetries.length },
  };
  const entropy = Object.fromEntries(Object.entries(features).map(([key, feature]) =>
    [key, shannon(feature.values, feature.max)]));
  const leaders: FlagSpec[] = [];
  for (const flag of flags) {
    if (leaders.some((leader) =>
      visualHash(flag) === visualHash(leader) ||
      compareFlagSpecs(flag, leader, rasterize).similarity >= FLAG_NOVELTY_CONFIG.similarity.cluster)) continue;
    leaders.push(flag);
  }
  const operatorFrequencies: Record<string, number> = {};
  const moduleFrequencies: Record<string, number> = {};
  flags.forEach((flag) => {
    new Set(countOperatorTokens(flag)).forEach((operator) => { operatorFrequencies[operator] = (operatorFrequencies[operator] ?? 0) + 1; });
    new Set(countModuleTokens(flag)).forEach((module) => { moduleFrequencies[module] = (moduleFrequencies[module] ?? 0) + 1; });
  });
  const operatorCatalog = options.configured_operators ?? OPERATOR_CATALOG;
  const moduleCatalog = options.configured_modules ?? MODULE_CATALOG;
  const deadThreshold = flags.length * FLAG_NOVELTY_CONFIG.deadFeatureFrequency;
  const generatedFlags = flags.filter((flag) => flag.meta.generation_stats !== undefined);
  const attempts = generatedFlags.map((flag) => flag.meta.generation_stats?.attempts as number);
  const histogram: Record<string, number> = {};
  attempts.forEach((count) => {
    const bin = String(count);
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  });
  const fallbackCount = generatedFlags.filter((flag) => flag.meta.generation_stats?.fallback_used === true).length;
  return {
    sample_count: flags.length,
    entropy,
    unique_structure_hashes: new Set(descriptors.map((item) => item.structure_hash)).size,
    unique_visual_hashes: new Set(descriptors.map((item) => item.visual_hash)).size,
    leader_clusters_at_090: leaders.length,
    map_elites_coverage: {
      occupied: mapCellCoverage(flags),
      total: CELL_COUNT,
      ratio: flags.length ? mapCellCoverage(flags) / CELL_COUNT : 0,
    },
    operator_frequencies: operatorFrequencies,
    module_frequencies: moduleFrequencies,
    dead_operators: operatorCatalog.filter((operator) => (operatorFrequencies[operator] ?? 0) < deadThreshold),
    dead_modules: moduleCatalog.filter((module) => (moduleFrequencies[module] ?? 0) < deadThreshold),
    attempts: {
      measured_count: attempts.length,
      values: attempts,
      mean: attempts.length ? attempts.reduce((sum, value) => sum + value, 0) / attempts.length : null,
      histogram,
    },
    fallback: {
      count: fallbackCount,
      measured_count: generatedFlags.length,
      ratio: generatedFlags.length ? fallbackCount / generatedFlags.length : null,
    },
  };
}
