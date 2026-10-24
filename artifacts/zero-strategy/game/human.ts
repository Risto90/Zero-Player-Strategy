export type HumanOriginId =
  | 'european'
  | 'negroid'
  | 'pygmy'
  | 'bushman'
  | 'ethiopian'
  | 'amerindian'
  | 'australoid'
  | 'veddoid';

export interface AgeStageRule {
  name: string;
  minimum: number;
  maximum: number;
}

export interface HumanSpecies {
  id: 'human';
  name: 'Человек';
  ageStages: readonly AgeStageRule[];
}

/** Parent human species owns the unchanged age stages shared by every category. */
export const HUMAN_SPECIES: HumanSpecies = {
  id: 'human',
  name: 'Человек',
  ageStages: [
  { name: 'младенец', minimum: 0, maximum: 2 },
  { name: 'ребёнок', minimum: 3, maximum: 7 },
  { name: 'отрок', minimum: 8, maximum: 11 },
  { name: 'подросток', minimum: 12, maximum: 19 },
  { name: 'молодой', minimum: 20, maximum: 28 },
  { name: 'зрелый', minimum: 29, maximum: 45 },
  { name: 'пожилой', minimum: 46, maximum: 65 },
  { name: 'старик', minimum: 66, maximum: Infinity },
  ],
};
export const HUMAN_AGE_STAGES = HUMAN_SPECIES.ageStages;

export interface HumanOriginCategory {
  id: HumanOriginId;
  name: string;
  parentSpeciesId: HumanSpecies['id'];
  ageStages: HumanSpecies['ageStages'];
  /** Approximate habitat reference on the game's 0–100 temperature/humidity scales. */
  climate: { temperature: [number, number]; humidity: [number, number] };
}

/**
 * These names are retained as requested legacy game labels, not as a claim that
 * they are discrete biological races. Climate ranges are abstract habitat
 * references, not claims of innate comfort or ability. See human-climate-profiles.md.
 */
export const HUMAN_ORIGINS: readonly HumanOriginCategory[] = [
  { id: 'european', name: 'Европейская', parentSpeciesId: HUMAN_SPECIES.id, ageStages: HUMAN_SPECIES.ageStages, climate: { temperature: [35, 65], humidity: [35, 75] } },
  { id: 'negroid', name: 'Негрская', parentSpeciesId: HUMAN_SPECIES.id, ageStages: HUMAN_SPECIES.ageStages, climate: { temperature: [50, 85], humidity: [35, 85] } },
  { id: 'pygmy', name: 'Пигмейская', parentSpeciesId: HUMAN_SPECIES.id, ageStages: HUMAN_SPECIES.ageStages, climate: { temperature: [65, 95], humidity: [65, 100] } },
  { id: 'bushman', name: 'Бушменская', parentSpeciesId: HUMAN_SPECIES.id, ageStages: HUMAN_SPECIES.ageStages, climate: { temperature: [55, 90], humidity: [10, 45] } },
  { id: 'ethiopian', name: 'Эфиопская', parentSpeciesId: HUMAN_SPECIES.id, ageStages: HUMAN_SPECIES.ageStages, climate: { temperature: [30, 70], humidity: [20, 65] } },
  { id: 'amerindian', name: 'Американоидная', parentSpeciesId: HUMAN_SPECIES.id, ageStages: HUMAN_SPECIES.ageStages, climate: { temperature: [25, 85], humidity: [20, 90] } },
  { id: 'australoid', name: 'Австралоидная', parentSpeciesId: HUMAN_SPECIES.id, ageStages: HUMAN_SPECIES.ageStages, climate: { temperature: [45, 90], humidity: [10, 65] } },
  { id: 'veddoid', name: 'Веддоидная', parentSpeciesId: HUMAN_SPECIES.id, ageStages: HUMAN_SPECIES.ageStages, climate: { temperature: [55, 85], humidity: [45, 90] } },
];

export type HumanOriginMix = { ids: HumanOriginId[]; shares: number[] };
export interface HumanOriginShare {
  id: HumanOriginId;
  name: string;
  color: string;
  share: number;
}

export const HUMAN_ORIGIN_COLORS: Record<HumanOriginId, string> = {
  european: '#527d8c',
  negroid: '#b65d3d',
  pygmy: '#547b4b',
  bushman: '#ad8b3f',
  ethiopian: '#795d93',
  amerindian: '#3f8a79',
  australoid: '#a44f68',
  veddoid: '#6371a4',
};

export const HUMAN_ORIGIN_SHARE_STEP = 25;
export const DEFAULT_LEGACY_ORIGIN: HumanOriginId = 'european';

const originOrder = new Map(HUMAN_ORIGINS.map((origin, index) => [origin.id, index]));

/** Creates display rows only from an already-canonical, complete composition. */
export function humanOriginShares(mix: HumanOriginMix | null | undefined): HumanOriginShare[] | null {
  if (!mix || !Array.isArray(mix.ids) || !Array.isArray(mix.shares) ||
      mix.ids.length === 0 || mix.ids.length !== mix.shares.length) return null;
  const seen = new Set<HumanOriginId>();
  const total = mix.shares.reduce((sum, share, index) => {
    const id = mix.ids[index];
    if (!originOrder.has(id) || seen.has(id) || !Number.isInteger(share) ||
        share <= 0 || share % HUMAN_ORIGIN_SHARE_STEP !== 0) return Number.NaN;
    seen.add(id);
    return sum + share;
  }, 0);
  if (total !== 100) return null;
  return mix.ids.map((id, index) => ({
    id,
    name: HUMAN_ORIGINS[originOrder.get(id)!].name,
    color: HUMAN_ORIGIN_COLORS[id],
    share: mix.shares[index],
  }));
}

export function humanOriginMixToTable(mix: HumanOriginMix): Map<number, number> {
  return new Map(mix.ids.map((id, index) => [originOrder.get(id)!, mix.shares[index] ?? 0]));
}

export function humanOriginIndex(id: HumanOriginId): number {
  return originOrder.get(id) ?? 0;
}

export function humanOriginMixFromTable(ids: number[], shares: number[]): HumanOriginMix {
  return canonicalizeHumanOrigins(new Map(ids.flatMap((id, index) => {
    const category = HUMAN_ORIGINS[id]?.id;
    return category ? [[category, shares[index] ?? 0] as const] : [];
  })));
}

export function combineHumanOriginTableMixes(
  table: { entries: { ids: number[]; shares: number[] }[]; intern(mix: Map<number, number>): number },
  mixes: { id: number; weight: number }[],
): number {
  const totals = new Map<HumanOriginId, number>();
  for (const { id: mixId, weight } of mixes) {
    if (!(weight > 0)) continue;
    const entry = table.entries[mixId];
    if (!entry) continue;
    const mix = humanOriginMixFromTable(entry.ids, entry.shares);
    mix.ids.forEach((originId, index) => {
      totals.set(originId, (totals.get(originId) ?? 0) + weight * mix.shares[index] / 100);
    });
  }
  return table.intern(humanOriginMixToTable(canonicalizeHumanOrigins(totals)));
}

export function defaultHumanOriginMix(): HumanOriginMix {
  return { ids: [DEFAULT_LEGACY_ORIGIN], shares: [100] };
}

export function normalizeHumanOriginMix(value: unknown): HumanOriginMix {
  if (!value || typeof value !== 'object') return defaultHumanOriginMix();
  const candidate = value as { ids?: unknown; shares?: unknown };
  if (!Array.isArray(candidate.ids) || !Array.isArray(candidate.shares)) return defaultHumanOriginMix();
  const ids = candidate.ids;
  const shares = candidate.shares;
  const values = new Map<HumanOriginId, number>();
  ids.forEach((id, index) => {
    const share = shares[index];
    if (typeof id === 'string' && originOrder.has(id as HumanOriginId) &&
        typeof share === 'number' && Number.isFinite(share) && share > 0) {
      const origin = id as HumanOriginId;
      values.set(origin, (values.get(origin) ?? 0) + share);
    }
  });
  return canonicalizeHumanOrigins(values);
}

/** Floors shares to quarter units, drops smaller components, and assigns the remainder deterministically. */
export function canonicalizeHumanOrigins(values: ReadonlyMap<HumanOriginId, number>): HumanOriginMix {
  const ordered = [...values]
    .filter(([id, value]) => originOrder.has(id) && Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1] || originOrder.get(a[0])! - originOrder.get(b[0])!)
    .slice(0, 4);
  const total = ordered.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return { ids: [DEFAULT_LEGACY_ORIGIN], shares: [100] };
  const parts = ordered.map(([id, value]) => ({
    id,
    raw: value / total * 100,
    share: Math.floor(value / total * 4) * HUMAN_ORIGIN_SHARE_STEP,
  }));
  const winner = parts.reduce((best, part) =>
    part.raw > best.raw || (part.raw === best.raw && originOrder.get(part.id)! < originOrder.get(best.id)!)
      ? part
      : best,
  );
  winner.share += 100 - parts.reduce((sum, part) => sum + part.share, 0);
  const kept = parts.filter((part) => part.share > 0)
    .sort((a, b) => originOrder.get(a.id)! - originOrder.get(b.id)!);
  return { ids: kept.map((part) => part.id), shares: kept.map((part) => part.share) };
}

/** Combines parent or cohort origins by their supplied population weights. */
export function combineHumanOrigins(
  mixes: { mix: HumanOriginMix; weight: number }[],
): HumanOriginMix {
  const totals = new Map<HumanOriginId, number>();
  for (const { mix, weight } of mixes) {
    if (!(weight > 0)) continue;
    mix.ids.forEach((id, index) => {
      totals.set(id, (totals.get(id) ?? 0) + weight * (mix.shares[index] ?? 0) / 100);
    });
  }
  return canonicalizeHumanOrigins(totals);
}

/** A child receives equal contributions from both parents, quantized only once. */
export function inheritHumanOrigins(first: HumanOriginMix, second: HumanOriginMix): HumanOriginMix {
  return combineHumanOrigins([{ mix: first, weight: 1 }, { mix: second, weight: 1 }]);
}

/**
 * Expected child origins from local category counts. Pair frequencies use n(n−1)/2
 * within a category and nᵢ*nⱼ across categories, as specified by the game rules.
 */
export function expectedOriginsFromPairCounts(
  counts: ReadonlyMap<HumanOriginId, number>,
): HumanOriginMix {
  const categories = [...counts]
    .filter(([id, count]) => originOrder.has(id) && Number.isFinite(count) && count > 0)
    .sort((a, b) => originOrder.get(a[0])! - originOrder.get(b[0])!);
  const result = new Map<HumanOriginId, number>();
  let pairTotal = 0;
  for (let i = 0; i < categories.length; i += 1) {
    const [id, count] = categories[i];
    const within = count * (count - 1) / 2;
    if (within > 0) {
      result.set(id, (result.get(id) ?? 0) + within);
      pairTotal += within;
    }
    for (let j = i + 1; j < categories.length; j += 1) {
      const [otherId, otherCount] = categories[j];
      const between = count * otherCount;
      if (between <= 0) continue;
      result.set(id, (result.get(id) ?? 0) + between / 2);
      result.set(otherId, (result.get(otherId) ?? 0) + between / 2);
      pairTotal += between;
    }
  }
  if (pairTotal <= 0) {
    const fallback = categories.sort((a, b) =>
      b[1] - a[1] || (originOrder.get(a[0]) ?? 999) - (originOrder.get(b[0]) ?? 999),
    )[0]?.[0];
    return { ids: [fallback ?? DEFAULT_LEGACY_ORIGIN], shares: [100] };
  }
  return canonicalizeHumanOrigins(result);
}

/** Expected origin mix for new residents born from the available local pair pool. */
export function expectedOriginsForPopulation(mix: HumanOriginMix, population: number): HumanOriginMix {
  if (!(population >= 2)) return canonicalizeHumanOrigins(
    new Map(mix.ids.map((id, index) => [id, mix.shares[index] ?? 0])),
  );
  return expectedOriginsFromPairCounts(new Map(
    mix.ids.map((id, index) => [id, population * (mix.shares[index] ?? 0) / 100]),
  ));
}

export function humanAgeStage(age: number): string {
  return HUMAN_AGE_STAGES.find((stage) => age >= stage.minimum && age <= stage.maximum)?.name ??
    (age < 0 ? HUMAN_AGE_STAGES[0].name : HUMAN_AGE_STAGES[HUMAN_AGE_STAGES.length - 1].name);
}

function distanceToRange(value: number, range: [number, number]): number {
  return value < range[0] ? range[0] - value : value > range[1] ? value - range[1] : 0;
}

/** Weighted habitat-range match, using only canonical origin shares. */
export function climateSuitability(
  mix: HumanOriginMix,
  temperature: number,
  humidity: number,
): number {
  return mix.ids.reduce((score, id, index) => {
    const profile = HUMAN_ORIGINS.find((origin) => origin.id === id)!;
    const tempDistance = distanceToRange(temperature, profile.climate.temperature);
    const humidityDistance = distanceToRange(humidity, profile.climate.humidity);
    const fit = Math.max(0, 100 - Math.hypot(tempDistance, humidityDistance));
    return score + fit * (mix.shares[index] ?? 0) / 100;
  }, 0);
}

export function humanClimateSuitabilityAt(
  world: {
    humanOrigins: Uint16Array;
    humanOriginTable: { entries: { ids: number[]; shares: number[]; total: number }[] };
    temperature: Uint8Array;
    humidity: Uint8Array;
  },
  pixel: number,
): number {
  const entry = world.humanOriginTable.entries[world.humanOrigins[pixel]];
  const mix = entry?.total === 100
    ? humanOriginMixFromTable(entry.ids, entry.shares)
    : defaultHumanOriginMix();
  return climateSuitability(mix, world.temperature[pixel], world.humidity[pixel]);
}

/** Deterministic initial habitat label for new settlement, based on local climate rather than RNG. */
export function originForHabitat(temperature: number, humidity: number): HumanOriginId {
  return HUMAN_ORIGINS.map((origin, index) => ({
    id: origin.id,
    index,
    distance: Math.hypot(
      distanceToRange(temperature, origin.climate.temperature),
      distanceToRange(humidity, origin.climate.humidity),
    ),
  })).sort((a, b) => a.distance - b.distance || a.index - b.index)[0].id;
}
