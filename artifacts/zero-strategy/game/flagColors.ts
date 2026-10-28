import { FLAG_COLOR_CONFIG } from './flagColorConfig';
import type { FlagProfileConfig } from './flagProfileConfig';
import type { FlagPaletteEntry, FlagSpec } from './flagSpec';

export type FlagColorClass = 'metal' | 'color';

export interface FlagColorShade {
  id: string;
  hex: string;
}

export interface FlagColorDefinition {
  id: string;
  family: string;
  class: FlagColorClass;
  eras: readonly number[];
  shades: readonly FlagColorShade[];
  rare?: boolean;
}

export interface FlagColorProfile {
  colorWeights: Record<string, number>;
  archetypeWeights: Record<string, number>;
  freePaletteWeight: number;
  freeColorWeights?: Record<string, number>;
  archetypeProbability: number;
  colorCountWeights: { count: number; weight: number }[];
  tinctureProbability: number;
}

/** Преобразует профиль генератора в конфигурацию решателя палитры без догадок о пропущенных весах. */
export function createFlagColorProfile(profile: FlagProfileConfig): FlagColorProfile {
  if (!profile.PAL?.weights || profile.PAL.p_arch === null ||
    !profile.PAL.free_colors || !profile.K) {
    throw new Error(`Для профиля ${profile.id} не заданы параметры PAL или K.`);
  }
  const freeColorWeights: Record<string, number> = {};
  for (const [id, weight] of Object.entries(profile.PAL.free_colors)) {
    if (weight === null || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`У свободного цвета ${id} в профиле ${profile.id} указан недопустимый вес.`);
    }
    if (!CONFIG.colors.some((color) => color.id === id)) {
      throw new Error(`Свободный цвет ${id} профиля ${profile.id} отсутствует в каталоге цветов.`);
    }
    freeColorWeights[id] = weight;
  }
  const archetypeWeights: Record<string, number> = {};
  for (const [id, weight] of Object.entries(profile.PAL.weights)) {
    if (weight === null || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`У архетипа ${id} в профиле ${profile.id} указан недопустимый вес.`);
    }
    archetypeWeights[id] = weight;
  }
  const colorWeights = Object.fromEntries(CONFIG.colors.map(({ id }) => [id, 1]));
  const colorCountWeights = Object.entries(profile.K).map(([count, weight]) => {
    if (weight === null || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`Для K=${count} в профиле ${profile.id} указан недопустимый вес.`);
    }
    return { count: Number(count), weight };
  });
  return {
    colorWeights,
    archetypeWeights,
    freePaletteWeight: profile.PAL.free ?? 0,
    freeColorWeights,
    archetypeProbability: profile.PAL.p_arch,
    colorCountWeights,
    tinctureProbability: profile.TINC ?? FLAG_COLOR_CONFIG.profiles.starter.tinctureProbability,
  };
}

export interface FlagColorAdjacency {
  a: string;
  b: string;
  boundary: number;
  kind?: 'field' | 'other';
}

export interface FlagChargeBackground {
  chargeSlot: string;
  backgroundSlot: string;
  /** Истинно, если другой слот образует обводку вокруг заряда. */
  outlined?: boolean;
  /** Диаметр заряда, делённый на меньшую сторону флага (D / min(w,h)). */
  diameterRatio?: number;
}

export type RasterSlot = string | number | null | undefined;

export interface FlagSlotRaster {
  /** Растр layer_slot_at в порядке строк; значения null/undefined соответствуют областям вне флага. */
  values: ArrayLike<RasterSlot>;
  width: number;
  height: number;
  /** Связывает числовые значения растра с символьными слотами; строковые значения используются напрямую. */
  slotIds?: Record<number, string>;
  /** Размер пикселя растра в единицах координат флага. По умолчанию — 5 (240 пикселей при H=1200). */
  pixelSize?: number;
}

export interface FlagPaletteCheck {
  rule: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'ERA' | 'PALETTE';
  passed: boolean;
  violations: string[];
}

export type FlagPaletteSolveResult =
  | {
      success: true;
      palette: Record<string, FlagPaletteEntry>;
      colorCount: number;
      tincture: boolean;
      attempts: number;
      checks: FlagPaletteCheck[];
    }
  | {
      success: false;
      reason: string;
      tincture: boolean;
      attempts: number;
      checks: FlagPaletteCheck[];
    };

export interface SolveFlagPaletteOptions {
  slotRaster: FlagSlotRaster;
  random: () => number;
  profile?: FlagColorProfile;
  profileId?: string;
  era: number;
  equalities?: [string, string][];
  adjacency?: FlagColorAdjacency[];
  chargeBackgrounds?: FlagChargeBackground[];
  maxColors?: number;
  tincture?: boolean;
}

interface ColorCandidate {
  id: string;
  family: string;
  class: FlagColorClass;
  hex: string;
  weight: number;
}

const BASE_CONFIG = FLAG_COLOR_CONFIG as unknown as {
  colors: FlagColorDefinition[];
  archetypes: { id: string; groups: string[][] }[];
  forbiddenNeighborFamilies: [string, string][];
  thresholds: Record<string, number>;
  profiles: Record<string, FlagColorProfile>;
};
const CONFIG = BASE_CONFIG;
const EPSILON = 1e-9;

function threshold(name: keyof typeof FLAG_COLOR_CONFIG.thresholds): number {
  return FLAG_COLOR_CONFIG.thresholds[name];
}

function validateRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('palette random source must return a value in [0, 1)');
  }
  return value;
}

function weightedPick<T>(items: readonly { value: T; weight: number }[], random: () => number): T | null {
  const valid = items.filter(({ weight }) => Number.isFinite(weight) && weight > 0);
  const total = valid.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return null;
  let roll = validateRandom(random) * total;
  for (const item of valid) {
    roll -= item.weight;
    if (roll < 0) return item.value;
  }
  return valid[valid.length - 1].value;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(validateRandom(random) * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function profileFor(profile?: FlagColorProfile, profileId = 'starter'): FlagColorProfile {
  const selected = profile ?? CONFIG.profiles[profileId];
  if (!selected) throw new RangeError(`unknown flag color profile "${profileId}"; supply its weights or add it to flagColorConfig`);
  for (const probability of [selected.archetypeProbability, selected.tinctureProbability]) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError('flag color profile probabilities must be in [0, 1]');
    }
  }
  return selected;
}

function validateColorConfig(): void {
  const ids = new Set<string>();
  const shadeIds = new Set<string>();
  for (const color of CONFIG.colors) {
    if (!color.id || ids.has(color.id)) throw new TypeError(`duplicate or empty color id "${color.id}"`);
    ids.add(color.id);
    if (!color.family || !['metal', 'color'].includes(color.class)) {
      throw new TypeError(`invalid family or heraldic class for color "${color.id}"`);
    }
    if (color.shades.length < 1 || color.shades.length > 4) {
      throw new RangeError(`color "${color.id}" must define between one and four shades`);
    }
    for (const shade of color.shades) {
      if (!shade.id || shadeIds.has(shade.id) || !/^#[\da-f]{6}$/i.test(shade.hex)) {
        throw new TypeError(`invalid or duplicate shade in color "${color.id}"`);
      }
      shadeIds.add(shade.id);
    }
  }
}

validateColorConfig();

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

const METRIC_CACHE_LIMIT = 4096;
const hexRgbCache = new Map<string, readonly [number, number, number]>();
const labCache = new Map<string, readonly [number, number, number]>();
const luminanceCache = new Map<string, number>();
const deltaCache = new Map<string, number>();
const contrastCache = new Map<string, number>();

function cacheMetric<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= METRIC_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

function parseHex(hex: string): readonly [number, number, number] {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new RangeError(`invalid sRGB hex color "${hex}"`);
  const key = hex.toLowerCase();
  const cached = hexRgbCache.get(key);
  if (cached) return cached;
  return cacheMetric(hexRgbCache, key, [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ]);
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function labPivot(value: number): number {
  const delta = 6 / 29;
  return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta ** 2) + 4 / 29;
}

function labValues(hex: string): readonly [number, number, number] {
  const key = hex.toLowerCase();
  const cached = labCache.get(key);
  if (cached) return cached;
  const [r8, g8, b8] = parseHex(hex);
  const r = linearize(r8), g = linearize(g8), b = linearize(b8);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = labPivot(x), fy = labPivot(y), fz = labPivot(z);
  return cacheMetric(labCache, key, [
    116 * fy - 16,
    500 * (fx - fy),
    200 * (fy - fz),
  ]);
}

/** Переводит sRGB HEX в CIELAB относительно белой точки D65. */
export function srgbToLab(hex: string): LabColor {
  const [l, a, b] = labValues(hex);
  return { l, a, b };
}

/** Евклидово расстояние CIE76 между двумя цветами sRGB HEX. */
export function deltaE76(firstHex: string, secondHex: string): number {
  const firstKey = firstHex.toLowerCase(), secondKey = secondHex.toLowerCase();
  const key = firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
  const cached = deltaCache.get(key);
  if (cached !== undefined) return cached;
  const first = labValues(firstHex), second = labValues(secondHex);
  return cacheMetric(deltaCache, key, Math.hypot(
    first[0] - second[0], first[1] - second[1], first[2] - second[2],
  ));
}

/** Относительная яркость sRGB HEX по WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const key = hex.toLowerCase();
  const cached = luminanceCache.get(key);
  if (cached !== undefined) return cached;
  const [r8, g8, b8] = parseHex(hex);
  return cacheMetric(luminanceCache, key,
    0.2126 * linearize(r8) + 0.7152 * linearize(g8) + 0.0722 * linearize(b8));
}

/** Контраст WCAG; результат всегда не меньше 1. */
export function wcagContrast(firstHex: string, secondHex: string): number {
  const firstKey = firstHex.toLowerCase(), secondKey = secondHex.toLowerCase();
  const key = firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
  const cached = contrastCache.get(key);
  if (cached !== undefined) return cached;
  const first = relativeLuminance(firstHex);
  const second = relativeLuminance(secondHex);
  return cacheMetric(contrastCache, key,
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05));
}

function unionSlots(slots: string[], equalities: [string, string][] = []): Map<string, string> {
  const parent = new Map(slots.map((slot) => [slot, slot]));
  const find = (slot: string): string => {
    const current = parent.get(slot);
    if (!current) throw new RangeError(`slot equality references unknown slot "${slot}"`);
    if (current === slot) return slot;
    const root = find(current);
    parent.set(slot, root);
    return root;
  };
  for (const [first, second] of equalities) {
    if (!parent.has(first) || !parent.has(second)) {
      throw new RangeError(`slot equality references unknown slot "${!parent.has(first) ? first : second}"`);
    }
    const a = find(first);
    const b = find(second);
    if (a !== b) parent.set(b, a);
  }
  for (const slot of slots) parent.set(slot, find(slot));
  return parent;
}

function rasterSlot(value: RasterSlot, slotIds?: Record<number, string>): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value || null;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new TypeError('numeric layer_slot_at values must be finite integers');
  }
  if (slotIds && Object.hasOwn(slotIds, value)) return slotIds[value];
  if (value < 0) return null;
  throw new RangeError(`numeric layer_slot_at value "${value}" has no symbolic slot mapping`);
}

/** Строит граф общих границ по растру слотов, упорядоченному по строкам. */
type FlagSlotRasterMetrics = {
  adjacency: FlagColorAdjacency[];
  pixelAreas: { byRoot: Map<string, number>; total: number };
};

function buildFlagSlotAdjacencyAndAreas(
  raster: FlagSlotRaster,
  slots: readonly string[],
  equalities: [string, string][],
  minimumBoundary: number,
  collectAreas: boolean,
  suppliedRoots?: Map<string, string>,
): FlagSlotRasterMetrics {
  const { values, width, height } = raster;
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || values.length !== width * height) {
    throw new RangeError('slot raster dimensions must match its row-major values');
  }
  const known = new Set(slots);
  const size = raster.pixelSize ??
    FLAG_COLOR_CONFIG.thresholds.defaultRasterHeight *
    FLAG_COLOR_CONFIG.thresholds.defaultRasterPixelSize /
    height;
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('raster pixel size must be positive');
  const roots = suppliedRoots ?? unionSlots([...slots], equalities);
  if (raster.slotIds && ArrayBuffer.isView(values) && typeof values[0] === 'number') {
    const rootNames = [...new Set(roots.values())].sort();
    const rootIndex = new Map(rootNames.map((root, index) => [root, index]));
    const slotEntries = Object.entries(raster.slotIds).map(([rawCode, slot]) => [Number(rawCode), slot] as const);
    let maximumCode = -1;
    for (const [code] of slotEntries) if (Number.isInteger(code) && code > maximumCode) maximumCode = code;
    if (maximumCode <= 65_535) {
      const rootByCode = new Int32Array(maximumCode + 1).fill(-2);
      const slotByCode: (string | undefined)[] = Array(maximumCode + 1);
      for (const [code, slot] of slotEntries) {
        if (!Number.isInteger(code) || code < 0 || code > maximumCode) continue;
        slotByCode[code] = slot;
        rootByCode[code] = known.has(slot)
          ? rootIndex.get(roots.get(slot)!) ?? -2
          : -3;
      }
      const numericValues = values as ArrayLike<number>;
      const boundaries = new Map<number, { boundary: number; firstOrder: number }>();
      const areaCounts = collectAreas ? new Uint32Array(rootNames.length) : null;
      let totalArea = 0;
      const countRootEdge = (first: number, second: number, order: number) => {
        if (first < 0 || second < 0 || first === second) return;
        const low = Math.min(first, second), high = Math.max(first, second);
        const key = low * rootNames.length + high;
        const current = boundaries.get(key);
        if (current) {
          current.boundary += size;
          current.firstOrder = Math.min(current.firstOrder, order);
        } else {
          boundaries.set(key, { boundary: size, firstOrder: order });
        }
      };
      let previousRowRoots = new Int32Array(width).fill(-1);
      let currentRowRoots = new Int32Array(width).fill(-1);
      for (let y = 0; y < height; y += 1) {
        const row = y * width;
        let leftRoot = -1;
        for (let x = 0; x < width; x += 1) {
          const value = numericValues[row + x];
          if (!Number.isFinite(value) || !Number.isInteger(value)) {
            throw new TypeError('numeric layer_slot_at values must be finite integers');
          }
          let currentRoot = -1;
          if (value >= 0) {
            if (value >= rootByCode.length || rootByCode[value] === -2) {
              throw new RangeError(`numeric layer_slot_at value "${value}" has no symbolic slot mapping`);
            }
            if (rootByCode[value] === -3) {
              throw new RangeError(`slot raster contains unknown slot "${slotByCode[value]}"`);
            }
            currentRoot = rootByCode[value];
          }
          if (areaCounts && currentRoot >= 0) {
            areaCounts[currentRoot] += 1;
            totalArea += 1;
          }
          if (x > 0) countRootEdge(leftRoot, currentRoot, (row + x - 1) * 2);
          if (y > 0) countRootEdge(previousRowRoots[x], currentRoot, (row - width + x) * 2 + 1);
          currentRowRoots[x] = currentRoot;
          leftRoot = currentRoot;
        }
        const previous = previousRowRoots;
        previousRowRoots = currentRowRoots;
        currentRowRoots = previous;
      }
      const adjacency = [...boundaries.entries()]
        .sort((first, second) => first[1].firstOrder - second[1].firstOrder)
        .map(([key, { boundary }]) => ({
          a: rootNames[Math.floor(key / rootNames.length)],
          b: rootNames[key % rootNames.length],
          boundary,
          kind: 'field' as const,
        }))
        .filter(({ boundary }) => boundary + EPSILON >= minimumBoundary);
      const byRoot = new Map<string, number>();
      if (areaCounts) {
        for (let index = 0; index < areaCounts.length; index += 1) {
          if (areaCounts[index] > 0) byRoot.set(rootNames[index], areaCounts[index]);
        }
      }
      return { adjacency, pixelAreas: { byRoot, total: totalArea } };
    }
  }
  const boundaries = new Map<string, number>();
  const areaByRoot = new Map<string, number>();
  let totalArea = 0;
  const read = (index: number) => rasterSlot(values[index], raster.slotIds);
  const countArea = (slot: string | null) => {
    if (!collectAreas || slot === null) return;
    if (!known.has(slot)) throw new RangeError(`slot raster contains unknown slot "${slot}"`);
    const root = roots.get(slot);
    if (!root) throw new RangeError(`slot "${slot}" has no equality root`);
    areaByRoot.set(root, (areaByRoot.get(root) ?? 0) + 1);
    totalArea += 1;
  };
  const countEdge = (left: string | null, right: string | null) => {
    if (left === null || right === null || left === right) return;
    if (!known.has(left) || !known.has(right)) {
      throw new RangeError(`slot raster contains unknown slot "${!known.has(left) ? left : right}"`);
    }
    const leftRoot = roots.get(left)!;
    const rightRoot = roots.get(right)!;
    if (leftRoot === rightRoot) return;
    const key = leftRoot < rightRoot ? `${leftRoot}\u0000${rightRoot}` : `${rightRoot}\u0000${leftRoot}`;
    boundaries.set(key, (boundaries.get(key) ?? 0) + size);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = read(index);
      countArea(current);
      if (x + 1 < width) countEdge(current, read(index + 1));
      if (y + 1 < height) countEdge(current, read(index + width));
    }
  }
  const adjacency = [...boundaries.entries()]
    .map(([key, boundary]) => {
      const [a, b] = key.split('\u0000');
      return { a, b, boundary, kind: 'field' as const };
    })
    .filter(({ boundary }) => boundary + EPSILON >= minimumBoundary);
  return { adjacency, pixelAreas: { byRoot: areaByRoot, total: totalArea } };
}

/** Строит граф общих границ по растру слотов, упорядоченному по строкам. */
export function buildFlagSlotAdjacency(
  raster: FlagSlotRaster,
  slots: readonly string[],
  equalities: [string, string][] = [],
  minimumBoundary = threshold('minimumSharedBoundary'),
): FlagColorAdjacency[] {
  return buildFlagSlotAdjacencyAndAreas(
    raster,
    slots,
    equalities,
    minimumBoundary,
    false,
  ).adjacency;
}

function candidateColors(profile: FlagColorProfile, era: number): ColorCandidate[] {
  const result: ColorCandidate[] = [];
  for (const color of CONFIG.colors) {
    const weight = profile.colorWeights[color.id] ?? 0;
    if (!color.eras.includes(era) || weight <= 0) continue;
    for (const shade of color.shades) {
      result.push({ id: shade.id, family: color.family, class: color.class, hex: shade.hex, weight });
    }
  }
  return result;
}

function chooseColorCountOrder(profile: FlagColorProfile, maxColors: number, slotsCount: number, random: () => number): number[] {
  const remaining = profile.colorCountWeights
    .filter(({ count, weight }) => count >= threshold('minColors') && count <= maxColors && count <= slotsCount && weight > 0)
    .map(({ count, weight }) => ({ value: count, weight }));
  const order: number[] = [];
  while (remaining.length > 0) {
    const selected = weightedPick(remaining, random);
    if (selected === null) break;
    order.push(selected);
    const index = remaining.findIndex(({ value }) => value === selected);
    if (index < 0) break;
    remaining.splice(index, 1);
  }
  return order;
}

function pickShade(colorId: string, candidates: ColorCandidate[], random: () => number): ColorCandidate | null {
  return weightedPick(
    candidates.filter((candidate) => CONFIG.colors.find(({ shades }) => shades.some((shade) => shade.id === candidate.id))?.id === colorId)
      .map((candidate) => ({ value: candidate, weight: candidate.weight })),
    random,
  );
}

function chooseArchetypePalette(
  profile: FlagColorProfile,
  candidates: ColorCandidate[],
  count: number,
  random: () => number,
): ColorCandidate[] | null {
  const eligible = CONFIG.archetypes
    .map((archetype) => ({
      archetype,
      weight: profile.archetypeWeights[archetype.id] ?? 0,
      availableGroups: archetype.groups
        .map((group) => group.filter((colorId) => candidates.some((candidate) =>
          CONFIG.colors.find((color) => color.id === colorId)?.shades.some((shade) => shade.id === candidate.id))))
        .filter((group) => group.length > 0),
    }))
    .filter(({ weight, availableGroups }) => weight > 0 && availableGroups.length >= count);
  const selected = weightedPick(eligible.map((entry) => ({ value: entry, weight: entry.weight })), random);
  if (!selected) return null;
  const groups = shuffle(selected.availableGroups, random).slice(0, count);
  const palette: ColorCandidate[] = [];
  for (const group of groups) {
    const colorId = weightedPick(group.map((id) => ({ value: id, weight: profile.colorWeights[id] ?? 0 })), random);
    if (!colorId) return null;
    const shade = pickShade(colorId, candidates, random);
    if (!shade) return null;
    palette.push(shade);
  }
  return palette;
}

function chooseWeightedFreePalette(
  candidates: ColorCandidate[],
  count: number,
  random: () => number,
  freeColorWeights?: Record<string, number>,
): ColorCandidate[] | null {
  const remaining = candidates
    .filter(({ id }) => !freeColorWeights || (freeColorWeights[id] ?? 0) > 0)
    .map((candidate) => ({
      ...candidate,
      weight: freeColorWeights?.[candidate.id] ?? candidate.weight,
    }));
  const palette: ColorCandidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const selected = weightedPick(remaining.map((color) => ({ value: color, weight: color.weight })), random);
    if (!selected) return null;
    palette.push(selected);
    remaining.splice(remaining.indexOf(selected), 1);
  }
  return palette;
}

function samplePalette(
  profile: FlagColorProfile,
  candidates: ColorCandidate[],
  count: number,
  random: () => number,
): ColorCandidate[] | null {
  const useArchetype = validateRandom(random) < profile.archetypeProbability;
  if (useArchetype) return chooseArchetypePalette(profile, candidates, count, random);
  if (profile.freePaletteWeight <= 0) return null;
  return chooseWeightedFreePalette(candidates, count, random, profile.freeColorWeights);
}

function familyForbidden(first: ColorCandidate, second: ColorCandidate): boolean {
  return CONFIG.forbiddenNeighborFamilies.some(([a, b]) =>
    (first.family === a && second.family === b) || (first.family === b && second.family === a));
}

interface SolveContext {
  slots: string[];
  roots: Map<string, string>;
  edges: FlagColorAdjacency[];
  charges: FlagChargeBackground[];
  raster: FlagSlotRaster;
  pixelAreas: { byRoot: Map<string, number>; total: number };
  era: number;
  tincture: boolean;
}

function assignPalette(
  palette: ColorCandidate[],
  context: SolveContext,
  random: () => number,
  onLeafFailure?: (checks: FlagPaletteCheck[]) => void,
): Map<string, ColorCandidate> | null {
  const rootSlots = [...new Set(context.slots.map((slot) => context.roots.get(slot)!))];
  if (palette.length > rootSlots.length) return null;
  const rootNeighbors = new Map(rootSlots.map((slot) => [slot, new Set<string>()]));
  for (const edge of context.edges) {
    if (edge.boundary + EPSILON < threshold('minimumSharedBoundary')) continue;
    const a = context.roots.get(edge.a);
    const b = context.roots.get(edge.b);
    if (!a || !b || a === b) continue;
    rootNeighbors.get(a)?.add(b);
    rootNeighbors.get(b)?.add(a);
  }
  const assignment = new Map<string, ColorCandidate>();
  const colorCounts = new Map(palette.map((color) => [color.id, 0]));
  const getCandidate = (slot: string) => assignment.get(slot);
  const allowed = (slot: string, color: ColorCandidate): boolean => {
    for (const neighbor of rootNeighbors.get(slot) ?? []) {
      const other = getCandidate(neighbor);
      if (!other) continue;
      if (deltaE76(color.hex, other.hex) + EPSILON < threshold('minimumAdjacentDeltaE')) return false;
      if (familyForbidden(color, other)) return false;
      if (context.tincture && color.class === other.class) return false;
    }
    for (const charge of context.charges) {
      const chargeRoot = context.roots.get(charge.chargeSlot);
      const backgroundRoot = context.roots.get(charge.backgroundSlot);
      if (slot !== chargeRoot && slot !== backgroundRoot) continue;
      const chargeColor = slot === chargeRoot ? color : getCandidate(chargeRoot!);
      const backgroundColor = slot === backgroundRoot ? color : getCandidate(backgroundRoot!);
      if (!chargeColor || !backgroundColor) continue;
      if (deltaE76(chargeColor.hex, backgroundColor.hex) + EPSILON < threshold('minimumChargeDeltaE')) return false;
      if (context.tincture && chargeColor.class === backgroundColor.class) return false;
      const contrast = wcagContrast(chargeColor.hex, backgroundColor.hex);
      const smallOutlined = (charge.diameterRatio ?? Infinity) < threshold('smallChargeDiameterRatio');
      if (smallOutlined) {
        if (contrast + EPSILON < threshold('minimumSmallOutlinedChargeContrast')) return false;
      } else if (!charge.outlined && contrast + EPSILON < threshold('minimumChargeContrast')) return false;
    }
    return true;
  };
  const visit = (): boolean => {
    if (assignment.size === rootSlots.length) {
      if (!colorCounts.values().every((count) => count > 0)) return false;
      const checks = paletteChecks(palette, assignment, context);
      if (checks.every((check) => check.passed)) return true;
      onLeafFailure?.(checks);
      return false;
    }
    const unassigned = rootSlots.filter((slot) => !assignment.has(slot));
    if (palette.length - [...colorCounts.values()].filter((count) => count > 0).length > unassigned.length) return false;
    let selectedSlot: string | null = null;
    let selectedDomain: ColorCandidate[] = [];
    for (const slot of unassigned) {
      const domain = palette.filter((color) => allowed(slot, color));
      if (domain.length === 0) return false;
      if (selectedSlot === null || domain.length < selectedDomain.length ||
        (domain.length === selectedDomain.length && (rootNeighbors.get(slot)?.size ?? 0) > (rootNeighbors.get(selectedSlot)?.size ?? 0))) {
        selectedSlot = slot;
        selectedDomain = domain;
      }
    }
    for (const color of shuffle(selectedDomain, random)) {
      assignment.set(selectedSlot!, color);
      colorCounts.set(color.id, colorCounts.get(color.id)! + 1);
      if (visit()) return true;
      colorCounts.set(color.id, colorCounts.get(color.id)! - 1);
      assignment.delete(selectedSlot!);
    }
    return false;
  };
  if (!visit()) return null;
  const slotsByColor = new Map<string, ColorCandidate>();
  for (const [slot, color] of assignment) slotsByColor.set(slot, color);
  return slotsByColor;
}

function pixelColorCounts(
  pixelAreas: { byRoot: Map<string, number>; total: number },
  assignment: Map<string, ColorCandidate>,
): { colorCounts: Map<string, number>; total: number } {
  const colorCounts = new Map<string, number>();
  for (const [root, count] of pixelAreas.byRoot) {
    const color = assignment.get(root);
    if (!color) throw new RangeError(`slot "${root}" has no color assignment`);
    colorCounts.set(color.id, (colorCounts.get(color.id) ?? 0) + count);
  }
  return { colorCounts, total: pixelAreas.total };
}

function paletteChecks(
  palette: ColorCandidate[],
  assignment: Map<string, ColorCandidate> | null,
  context: SolveContext,
): FlagPaletteCheck[] {
  const violations: Record<FlagPaletteCheck['rule'], string[]> = {
    C1: [], C2: [], C3: [], C4: [], C5: [], ERA: [], PALETTE: [],
  };
  if (!assignment) {
    return (Object.keys(violations) as FlagPaletteCheck['rule'][]).map((rule) => ({
      rule,
      passed: false,
      violations: ['no valid slot coloring was found'],
    }));
  }
  const colorBySlot = (slot: string) => assignment.get(context.roots.get(slot) ?? '');
  for (const color of palette) {
    const definition = CONFIG.colors.find(({ shades }) => shades.some((shade) => shade.id === color.id));
    if (!definition?.eras.includes(context.era)) violations.ERA.push(`${color.id} is unavailable in era ${context.era}`);
  }
  for (const edge of context.edges) {
    if (edge.boundary + EPSILON < threshold('minimumSharedBoundary')) continue;
    const a = colorBySlot(edge.a);
    const b = colorBySlot(edge.b);
    if (!a || !b) continue;
    if (a.id === b.id) {
      violations.C1.push(`${edge.a}/${edge.b}: adjacent slots use the same color`);
      continue;
    }
    const distance = deltaE76(a.hex, b.hex);
    if (distance + EPSILON < threshold('minimumAdjacentDeltaE')) {
      violations.C1.push(`${edge.a}/${edge.b}: ΔE76 ${distance.toFixed(2)} < ${threshold('minimumAdjacentDeltaE')}`);
    }
    if (context.tincture && edge.kind !== 'other' && a.class === b.class) {
      violations.C3.push(`${edge.a}/${edge.b}: adjacent field slots must alternate metal and color`);
    }
    if (familyForbidden(a, b)) violations.C4.push(`${edge.a}/${edge.b}: forbidden ${a.family}/${b.family} adjacency`);
  }
  for (const charge of context.charges) {
    const foreground = colorBySlot(charge.chargeSlot);
    const background = colorBySlot(charge.backgroundSlot);
    if (!foreground || !background) continue;
    const distance = deltaE76(foreground.hex, background.hex);
    const contrast = wcagContrast(foreground.hex, background.hex);
    if (distance + EPSILON < threshold('minimumChargeDeltaE')) {
      violations.C2.push(`${charge.chargeSlot}/${charge.backgroundSlot}: ΔE76 ${distance.toFixed(2)} < ${threshold('minimumChargeDeltaE')}`);
    }
    if (context.tincture && foreground.class === background.class) {
      violations.C3.push(`${charge.chargeSlot}/${charge.backgroundSlot}: charge and background must be metal/color opposites`);
    }
    const smallOutlined = (charge.diameterRatio ?? Infinity) < threshold('smallChargeDiameterRatio');
    if (smallOutlined && contrast + EPSILON < threshold('minimumSmallOutlinedChargeContrast')) {
      violations.C2.push(`${charge.chargeSlot}/${charge.backgroundSlot}: small-charge CR ${contrast.toFixed(2)} < ${threshold('minimumSmallOutlinedChargeContrast')}`);
    } else if (!smallOutlined && !charge.outlined && contrast + EPSILON < threshold('minimumChargeContrast')) {
      violations.C2.push(`${charge.chargeSlot}/${charge.backgroundSlot}: CR ${contrast.toFixed(2)} < ${threshold('minimumChargeContrast')}`);
    }
  }
  const { colorCounts, total } = pixelColorCounts(context.pixelAreas, assignment);
  for (const color of palette) {
    const share = total > 0 ? (colorCounts.get(color.id) ?? 0) / total : 0;
    if (share + EPSILON < threshold('minimumColorAreaShare')) {
      violations.C5.push(`${color.id}: доля ${(share * 100).toFixed(2)}% меньше ${threshold('minimumColorAreaShare') * 100}%`);
    }
    if (share - EPSILON > threshold('maximumColorAreaShare')) {
      violations.C5.push(`${color.id}: доля ${(share * 100).toFixed(2)}% больше ${threshold('maximumColorAreaShare') * 100}%`);
    }
    if ((colorCounts.get(color.id) ?? 0) === 0) violations.PALETTE.push(`${color.id} is declared but unused`);
  }
  return (Object.keys(violations) as FlagPaletteCheck['rule'][]).map((rule) => ({
    rule,
    passed: violations[rule].length === 0,
    violations: violations[rule],
  }));
}

/** Подбирает и проверяет палитру FlagSpec с помощью переданного детерминированного потока. */
export function solveFlagPalette(spec: FlagSpec, options: Omit<SolveFlagPaletteOptions, 'era' | 'equalities'> & {
  era?: number;
  equalities?: [string, string][];
}): FlagPaletteSolveResult {
  const slots = [...spec.slots.items];
  if (slots.length === 0) throw new RangeError('palette solving requires at least one symbolic slot');
  const era = options.era ?? spec.era;
  if (!Number.isInteger(era) || era < 0 || era > 6) throw new RangeError('palette era must be an integer in [0, 6]');
  if (typeof options.random !== 'function') throw new TypeError('palette solving requires an injected deterministic random source');
  if (!options.slotRaster) throw new TypeError('palette solving requires the final layer_slot_at raster for C5 validation');
  const profile = profileFor(options.profile, options.profileId ?? spec.profile_id);
  const maxColors = Math.min(
    options.maxColors ?? threshold('maxColors'),
    threshold('maxColors'),
  );
  if (!Number.isInteger(maxColors) || maxColors < threshold('minColors')) {
    throw new RangeError(`maxColors must be an integer in [${threshold('minColors')}, ${threshold('maxColors')}]`);
  }
  const roots = unionSlots(slots, options.equalities ?? spec.slots.equalities);
  const rasterMetrics = buildFlagSlotAdjacencyAndAreas(
    options.slotRaster,
    slots,
    options.equalities ?? spec.slots.equalities,
    threshold('minimumSharedBoundary'),
    true,
    roots,
  );
  const edges = [...rasterMetrics.adjacency, ...(options.adjacency ?? [])];
  for (const edge of edges) {
    if (!roots.has(edge.a) || !roots.has(edge.b) || !Number.isFinite(edge.boundary) || edge.boundary < 0) {
      throw new RangeError('palette adjacency must reference known slots and have a non-negative boundary length');
    }
  }
  const charges = options.chargeBackgrounds ?? [];
  for (const charge of charges) {
    if (!roots.has(charge.chargeSlot) || !roots.has(charge.backgroundSlot)) {
      throw new RangeError('charge/background relationships must reference known slots');
    }
    if (charge.diameterRatio !== undefined && (!Number.isFinite(charge.diameterRatio) || charge.diameterRatio < 0)) {
      throw new RangeError('charge diameter ratios must be finite and non-negative');
    }
  }
  const tincture = options.tincture ?? (validateRandom(options.random) < profile.tinctureProbability);
  const context: SolveContext = {
    slots,
    roots,
    edges,
    charges,
    raster: options.slotRaster,
    pixelAreas: rasterMetrics.pixelAreas,
    era,
    tincture,
  };
  const candidates = candidateColors(profile, era);
  const slotGroupCount = new Set(roots.values()).size;
  const countOrder = chooseColorCountOrder(profile, maxColors, slotGroupCount, options.random);
  if (countOrder.length === 0) {
    const checks = paletteChecks([], null, context);
    return {
      success: false,
      reason: `В распределении числа цветов профиля нет допустимого варианта для доступных цветовых слотов: объединённых групп ${slotGroupCount}, минимальное K=${threshold('minColors')}`,
      tincture,
      attempts: 0,
      checks,
    };
  }
  const largestSlotShare = Math.max(
    0,
    ...[...context.pixelAreas.byRoot.values()].map((area) => area / Math.max(1, context.pixelAreas.total)),
  );
  if (largestSlotShare - EPSILON > threshold('maximumColorAreaShare')) {
    const checks = paletteChecks([], null, context);
    return {
      success: false,
      reason: `Решение C5 невозможно: одна цветовая группа занимает ${(largestSlotShare * 100).toFixed(2)}%, больше ${threshold('maximumColorAreaShare') * 100}%`,
      tincture,
      attempts: 0,
      checks,
    };
  }
  const countPlans = countOrder.map((count, index) => ({
    count,
    attempts: index === 0 ? threshold('paletteResamples') + 1 : threshold('escalationAttempts'),
  }));
  let attempts = 0;
  let unavailablePalettes = 0;
  let unsatisfiedAssignments = 0;
  let lastAssignmentFailure: FlagPaletteCheck[] = [];
  let lastChecks = paletteChecks([], null, context);
  for (const plan of countPlans) {
    for (let attempt = 0; attempt < plan.attempts; attempt += 1) {
      attempts += 1;
      const palette = samplePalette(profile, candidates, plan.count, options.random);
      if (!palette) {
        unavailablePalettes += 1;
        continue;
      }
      const currentAssignmentFailures: FlagPaletteCheck[][] = [];
      const assignment = assignPalette(palette, context, options.random, (checks) => {
        currentAssignmentFailures.push(checks);
      });
      if (!assignment) {
        unsatisfiedAssignments += 1;
        if (currentAssignmentFailures.length) {
          lastAssignmentFailure = currentAssignmentFailures[currentAssignmentFailures.length - 1];
        }
        lastChecks = paletteChecks(palette, null, context);
        continue;
      }
      lastChecks = paletteChecks(palette, assignment, context);
      if (lastChecks.some((check) => !check.passed)) continue;
      const result: Record<string, FlagPaletteEntry> = {};
      for (const slot of slots) {
        const color = assignment.get(roots.get(slot)!);
        if (!color) throw new Error(`internal palette error: slot "${slot}" was not assigned`);
        result[slot] = { color_id: color.id, hex: color.hex };
      }
      return { success: true, palette: result, colorCount: plan.count, tincture, attempts, checks: lastChecks };
    }
  }
  const lastFailureRules = [...new Set(lastAssignmentFailure.filter((check) => !check.passed).map(({ rule }) => rule))];
  const lastFailureDetails = lastAssignmentFailure
    ?.filter((check) => !check.passed)
    .flatMap(({ violations }) => violations)
    .slice(0, 3) ?? [];
  return {
    success: false,
    reason: `палитра не найдена за ${attempts} попыток (недоступная палитра: ${unavailablePalettes}; несовместимые назначения: ${unsatisfiedAssignments}; правила: ${lastFailureRules.join(', ') || 'нет полного назначения'}${lastFailureDetails.length ? `; детали: ${lastFailureDetails.join('; ')}` : ''})`,
    tincture,
    attempts,
    checks: lastChecks,
  };
}

/** Возвращает результаты метрик цвета и правил палитры для существующего назначения слотов. */
export function validateFlagPalette(
  spec: FlagSpec,
  palette: Record<string, FlagPaletteEntry>,
  options: Omit<SolveFlagPaletteOptions, 'random'> & { era?: number },
): FlagPaletteCheck[] {
  const slots = [...spec.slots.items];
  const roots = unionSlots(slots, options.equalities ?? spec.slots.equalities);
  const era = options.era ?? spec.era;
  const colors: ColorCandidate[] = [];
  const byShadeId = new Map<string, ColorCandidate>();
  for (const definition of CONFIG.colors) {
    const weight = 1;
    for (const shade of definition.shades) {
      const color = { id: shade.id, family: definition.family, class: definition.class, hex: shade.hex, weight };
      byShadeId.set(shade.id, color);
    }
  }
  const assignment = new Map<string, ColorCandidate>();
  const violations: string[] = [];
  for (const slot of slots) {
    const entry = palette[slot];
    const color = entry && byShadeId.get(entry.color_id);
    if (!entry || !color || entry.hex.toUpperCase() !== color.hex.toUpperCase()) {
      violations.push(`${slot} has a missing, unknown, or mismatched configured color`);
      continue;
    }
    colors.push(color);
    const root = roots.get(slot)!;
    const existing = assignment.get(root);
    if (existing && existing.id !== color.id) violations.push(`${slot} violates its slot-equality constraint`);
    assignment.set(root, color);
    if (!CONFIG.colors.find(({ shades }) => shades.some((shade) => shade.id === color.id))?.eras.includes(era)) {
      violations.push(`${color.id} is unavailable in era ${era}`);
    }
  }
  if (new Set(colors.map(({ id }) => id)).size > threshold('maxColors')) {
    violations.push(`palette exceeds ${threshold('maxColors')} colors`);
  }
  if (!Number.isInteger(era) || era < 0 || era > 6) throw new RangeError('palette era must be an integer in [0, 6]');
  if (!options.slotRaster) throw new TypeError('palette validation requires the final layer_slot_at raster');
  if (!Number.isInteger(options.slotRaster.width) || options.slotRaster.width < 1 ||
    !Number.isInteger(options.slotRaster.height) || options.slotRaster.height < 1 ||
    options.slotRaster.values.length !== options.slotRaster.width * options.slotRaster.height) {
    throw new RangeError('slot raster dimensions must match its row-major values');
  }
  const rasterMetrics = buildFlagSlotAdjacencyAndAreas(
    options.slotRaster,
    slots,
    options.equalities ?? spec.slots.equalities,
    threshold('minimumSharedBoundary'),
    true,
    roots,
  );
  const edges = [
    ...rasterMetrics.adjacency,
    ...(options.adjacency ?? []),
  ];
  const charges = options.chargeBackgrounds ?? [];
  for (const edge of edges) {
    if (!roots.has(edge.a) || !roots.has(edge.b) || !Number.isFinite(edge.boundary) || edge.boundary < 0) {
      throw new RangeError('palette adjacency must reference known slots and have a non-negative boundary length');
    }
  }
  for (const charge of charges) {
    if (!roots.has(charge.chargeSlot) || !roots.has(charge.backgroundSlot)) {
      throw new RangeError('charge/background relationships must reference known slots');
    }
    if (charge.diameterRatio !== undefined && (!Number.isFinite(charge.diameterRatio) || charge.diameterRatio < 0)) {
      throw new RangeError('charge diameter ratios must be finite and non-negative');
    }
  }
  const context: SolveContext = {
    slots,
    roots,
    edges,
    charges,
    raster: options.slotRaster,
    pixelAreas: rasterMetrics.pixelAreas,
    era,
    tincture: options.tincture ?? false,
  };
  const checks = paletteChecks(colors, violations.length ? null : assignment, context);
  if (violations.length) checks.find((check) => check.rule === 'PALETTE')!.violations.push(...violations);
  return checks;
}

