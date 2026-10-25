import { FLAG_COLOR_CONFIG } from './flagColorConfig';
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
  archetypeProbability: number;
  colorCountWeights: { count: number; weight: number }[];
  tinctureProbability: number;
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
  /** True when a different slot forms a fimbriation/outline around the charge. */
  outlined?: boolean;
  /** Charge diameter divided by the smaller flag dimension (D / min(w,h)). */
  diameterRatio?: number;
}

export type RasterSlot = string | number | null | undefined;

export interface FlagSlotRaster {
  /** Row-major layer_slot_at raster. Null/undefined cells are outside the flag. */
  values: ArrayLike<RasterSlot>;
  width: number;
  height: number;
  /** Maps numeric raster values to symbolic slots; string raster entries map directly. */
  slotIds?: Record<number, string>;
  /** Size of one raster pixel in flag coordinate units. Defaults to 5 (240px over H=1200). */
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

function parseHex(hex: string): [number, number, number] {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new RangeError(`invalid sRGB hex color "${hex}"`);
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function labPivot(value: number): number {
  const delta = 6 / 29;
  return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta ** 2) + 4 / 29;
}

/** Convert an sRGB hex color to CIELAB using the D65 reference white. */
export function srgbToLab(hex: string): LabColor {
  const [r8, g8, b8] = parseHex(hex);
  const r = linearize(r8);
  const g = linearize(g8);
  const b = linearize(b8);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = labPivot(x);
  const fy = labPivot(y);
  const fz = labPivot(z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** CIE76 Euclidean distance between two sRGB hex colors. */
export function deltaE76(firstHex: string, secondHex: string): number {
  const first = srgbToLab(firstHex);
  const second = srgbToLab(secondHex);
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

/** WCAG 2.x relative luminance for an sRGB hex color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, always >= 1. */
export function wcagContrast(firstHex: string, secondHex: string): number {
  const first = relativeLuminance(firstHex);
  const second = relativeLuminance(secondHex);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
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

/** Build a shared-boundary graph from a row-major slot raster. */
export function buildFlagSlotAdjacency(
  raster: FlagSlotRaster,
  slots: readonly string[],
  equalities: [string, string][] = [],
  minimumBoundary = threshold('minimumSharedBoundary'),
): FlagColorAdjacency[] {
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
  const roots = unionSlots([...slots], equalities);
  const boundaries = new Map<string, number>();
  const read = (index: number) => rasterSlot(values[index], raster.slotIds);
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
      if (x + 1 < width) countEdge(current, read(index + 1));
      if (y + 1 < height) countEdge(current, read(index + width));
    }
  }
  return [...boundaries.entries()]
    .map(([key, boundary]) => {
      const [a, b] = key.split('\u0000');
      return { a, b, boundary, kind: 'field' as const };
    })
    .filter(({ boundary }) => boundary + EPSILON >= minimumBoundary);
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

function chooseColorCount(profile: FlagColorProfile, maxColors: number, slotsCount: number, random: () => number): number | null {
  const choices = profile.colorCountWeights
    .filter(({ count, weight }) => count >= threshold('minColors') && count <= maxColors && count <= slotsCount && weight > 0)
    .map(({ count, weight }) => ({ value: count, weight }));
  return weightedPick(choices, random);
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
): ColorCandidate[] | null {
  const remaining = [...candidates];
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
  return chooseWeightedFreePalette(candidates, count, random);
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
  era: number;
  tincture: boolean;
}

function assignPalette(
  palette: ColorCandidate[],
  context: SolveContext,
  random: () => number,
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
    if (assignment.size === rootSlots.length) return colorCounts.values().every((count) => count > 0);
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
  raster: FlagSlotRaster,
  slots: string[],
  roots: Map<string, string>,
  assignment: Map<string, ColorCandidate>,
): { colorCounts: Map<string, number>; total: number } {
  const counts = new Map<string, number>();
  let total = 0;
  const known = new Set(slots);
  for (let index = 0; index < raster.values.length; index += 1) {
    const slot = rasterSlot(raster.values[index], raster.slotIds);
    if (slot === null) continue;
    if (!known.has(slot)) throw new RangeError(`slot raster contains unknown slot "${slot}"`);
    const color = assignment.get(roots.get(slot)!);
    if (!color) throw new RangeError(`slot "${slot}" has no color assignment`);
    counts.set(color.id, (counts.get(color.id) ?? 0) + 1);
    total += 1;
  }
  return { colorCounts: counts, total };
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
  const { colorCounts, total } = pixelColorCounts(context.raster, context.slots, context.roots, assignment);
  for (const color of palette) {
    const share = total > 0 ? (colorCounts.get(color.id) ?? 0) / total : 0;
    if (share + EPSILON < threshold('minimumColorAreaShare')) {
      violations.C5.push(`${color.id}: ${(share * 100).toFixed(2)}% < ${threshold('minimumColorAreaShare') * 100}%`);
    }
    if (share - EPSILON > threshold('maximumColorAreaShare')) {
      violations.C5.push(`${color.id}: ${(share * 100).toFixed(2)}% > ${threshold('maximumColorAreaShare') * 100}%`);
    }
    if ((colorCounts.get(color.id) ?? 0) === 0) violations.PALETTE.push(`${color.id} is declared but unused`);
  }
  return (Object.keys(violations) as FlagPaletteCheck['rule'][]).map((rule) => ({
    rule,
    passed: violations[rule].length === 0,
    violations: violations[rule],
  }));
}

/** Solve and validate a FlagSpec palette using a caller-owned deterministic stream. */
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
  const rasterEdges = buildFlagSlotAdjacency(options.slotRaster, slots, options.equalities ?? spec.slots.equalities);
  const edges = [...rasterEdges, ...(options.adjacency ?? [])];
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
  const context: SolveContext = { slots, roots, edges, charges, raster: options.slotRaster, era, tincture };
  const candidates = candidateColors(profile, era);
  const slotGroupCount = new Set(roots.values()).size;
  const initialCount = chooseColorCount(profile, maxColors, slotGroupCount, options.random);
  if (initialCount === null) {
    const checks = paletteChecks([], null, context);
    return { success: false, reason: 'profile color-count distribution has no feasible choice for the available slots', tincture, attempts: 0, checks };
  }
  const countPlans = [
    { count: initialCount, attempts: threshold('paletteResamples') + 1 },
    ...(initialCount < maxColors
      ? [{ count: initialCount + 1, attempts: threshold('escalationAttempts') }]
      : []),
  ];
  let attempts = 0;
  let lastChecks = paletteChecks([], null, context);
  for (const plan of countPlans) {
    for (let attempt = 0; attempt < plan.attempts; attempt += 1) {
      attempts += 1;
      const palette = samplePalette(profile, candidates, plan.count, options.random);
      if (!palette) continue;
      const assignment = assignPalette(palette, context, options.random);
      lastChecks = paletteChecks(palette, assignment, context);
      if (!assignment || lastChecks.some((check) => !check.passed)) continue;
      const result: Record<string, FlagPaletteEntry> = {};
      for (const slot of slots) {
        const color = assignment.get(roots.get(slot)!);
        if (!color) throw new Error(`internal palette error: slot "${slot}" was not assigned`);
        result[slot] = { color_id: color.id, hex: color.hex };
      }
      return { success: true, palette: result, colorCount: plan.count, tincture, attempts, checks: lastChecks };
    }
  }
  return {
    success: false,
    reason: `no valid palette found after ${attempts} deterministic attempts`,
    tincture,
    attempts,
    checks: lastChecks,
  };
}

/** Return all color-metric and palette rule outcomes for an existing slot assignment. */
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
  const context: SolveContext = {
    slots,
    roots,
    edges: [...buildFlagSlotAdjacency(options.slotRaster, slots, options.equalities ?? spec.slots.equalities), ...(options.adjacency ?? [])],
    charges: options.chargeBackgrounds ?? [],
    raster: options.slotRaster,
    era,
    tincture: options.tincture ?? false,
  };
  if (!Number.isInteger(era) || era < 0 || era > 6) throw new RangeError('palette era must be an integer in [0, 6]');
  if (!options.slotRaster) throw new TypeError('palette validation requires the final layer_slot_at raster');
  if (!Number.isInteger(options.slotRaster.width) || options.slotRaster.width < 1 ||
    !Number.isInteger(options.slotRaster.height) || options.slotRaster.height < 1 ||
    options.slotRaster.values.length !== options.slotRaster.width * options.slotRaster.height) {
    throw new RangeError('slot raster dimensions must match its row-major values');
  }
  for (const edge of context.edges) {
    if (!roots.has(edge.a) || !roots.has(edge.b) || !Number.isFinite(edge.boundary) || edge.boundary < 0) {
      throw new RangeError('palette adjacency must reference known slots and have a non-negative boundary length');
    }
  }
  for (const charge of context.charges) {
    if (!roots.has(charge.chargeSlot) || !roots.has(charge.backgroundSlot)) {
      throw new RangeError('charge/background relationships must reference known slots');
    }
    if (charge.diameterRatio !== undefined && (!Number.isFinite(charge.diameterRatio) || charge.diameterRatio < 0)) {
      throw new RangeError('charge diameter ratios must be finite and non-negative');
    }
  }
  const checks = paletteChecks(colors, violations.length ? null : assignment, context);
  if (violations.length) checks.find((check) => check.rule === 'PALETTE')!.violations.push(...violations);
  return checks;
}

