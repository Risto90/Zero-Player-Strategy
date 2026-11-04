import { BIOMES, HUMAN_THERMAL_COMFORT_C } from './config';

export type HumanOriginId =
  | 'european'
  | 'negroid'
  | 'pygmy'
  | 'bushman'
  | 'ethiopian'
  | 'amerindian'
  | 'australoid'
  | 'veddoid';

/** Равновероятно выбирает любую игровую расу, в том числе отсутствующую на текущей карте. */
export function randomHumanOriginId(random: () => number = Math.random): HumanOriginId {
  const index = Math.max(0, Math.min(HUMAN_ORIGINS.length - 1, Math.floor(random() * HUMAN_ORIGINS.length)));
  return HUMAN_ORIGINS[index].id;
}

export interface AgeStageRule {
  name: string;
  minimum: number;
  maximum: number;
}

export interface HumanSpecies {
  id: 'human';
  name: 'Человек';
  ageStages: readonly AgeStageRule[];
  climate: { temperature: [number, number] };
}

/** Возрастные этапы принадлежат исходному виду людей и остаются общими для всех категорий. */
export const HUMAN_SPECIES: HumanSpecies = {
  id: 'human',
  name: 'Человек',
  climate: { temperature: [...HUMAN_THERMAL_COMFORT_C] },
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
  /** Биомы, связанные с основными историческими ареалами этой игровой категории. */
  nativeBiomes: readonly number[];
  climate: {
    temperature: [number, number];
    humidity: [number, number];
    drainage: [number, number];
  };
}

/**
 * Это широкие игровые категории происхождения, а не точные биологические группы.
 * Биомы описывают географические ареалы; климатический множитель влияет только на
 * создаваемое население и не задаёт индивидуальные способности человека.
 */
function climateForNativeBiomes(nativeBiomes: readonly number[]): HumanOriginCategory['climate'] {
  const biomes = nativeBiomes.map((id) => BIOMES[id]).filter((biome) => biome !== undefined);
  if (biomes.length === 0) throw new Error('Для категории происхождения не заданы биомы.');
  const nativeTemperature: [number, number] = [
    Math.min(...biomes.map((biome) => biome.climate.temperature[0])),
    Math.max(...biomes.map((biome) => biome.climate.temperature[1])),
  ];
  return {
    temperature: [
      (nativeTemperature[0] + HUMAN_SPECIES.climate.temperature[0]) / 2,
      (nativeTemperature[1] + HUMAN_SPECIES.climate.temperature[1]) / 2,
    ],
    humidity: [
      Math.min(...biomes.map((biome) => biome.climate.humidity[0])),
      Math.max(...biomes.map((biome) => biome.climate.humidity[1])),
    ],
    drainage: [
      Math.min(...biomes.map((biome) => biome.climate.drainage[0])),
      Math.max(...biomes.map((biome) => biome.climate.drainage[1])),
    ],
  };
}

function humanOrigin(
  id: HumanOriginId,
  name: string,
  nativeBiomes: readonly number[],
): HumanOriginCategory {
  return {
    id,
    name,
    parentSpeciesId: HUMAN_SPECIES.id,
    ageStages: HUMAN_SPECIES.ageStages,
    nativeBiomes,
    climate: climateForNativeBiomes(nativeBiomes),
  };
}

export const HUMAN_ORIGINS: readonly HumanOriginCategory[] = [
  humanOrigin('european', 'Европейская', [5, 6]),
  humanOrigin('negroid', 'Негрская', [8, 9]),
  humanOrigin('pygmy', 'Пигмейская', [9]),
  humanOrigin('bushman', 'Бушменская', [7, 8]),
  humanOrigin('ethiopian', 'Эфиопская', [5, 6, 8]),
  humanOrigin('amerindian', 'Американоидная', [2, 5, 6, 8, 9]),
  humanOrigin('australoid', 'Австралоидная', [5, 7, 8, 9]),
  humanOrigin('veddoid', 'Веддоидная', [8, 9]),
];

export type HumanOriginMix = { ids: HumanOriginId[]; shares: number[] };
export interface HumanOriginShare {
  id: HumanOriginId;
  name: string;
  color: string;
  share: number;
}

export interface HumanOriginProfileShare {
  id: number;
  originId: HumanOriginId | null;
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
export interface HumanAncestryProfile {
  id: number;
  mix: HumanOriginMix;
  name: string;
  color: string;
  pureOriginId: HumanOriginId | null;
}

function profileKey(mix: HumanOriginMix): string {
  return mix.ids.map((id, index) => `${id}:${mix.shares[index]}`).join('|');
}

function makeAncestryProfiles(): HumanAncestryProfile[] {
  const mixes: HumanOriginMix[] = HUMAN_ORIGINS.map((origin) => ({ ids: [origin.id], shares: [100] }));
  const append = (start: number, left: number, ids: HumanOriginId[], shares: number[]) => {
    if (left === 0) {
      if (ids.length > 1) mixes.push({ ids: [...ids], shares: [...shares] });
      return;
    }
    for (let index = start; index < HUMAN_ORIGINS.length; index += 1) {
      for (let value = 1; value <= left; value += 1) {
        append(index + 1, left - value, [...ids, HUMAN_ORIGINS[index].id], [...shares, value * HUMAN_ORIGIN_SHARE_STEP]);
      }
    }
  };
  append(0, 4, [], []);
  const unique = new Map(mixes.map((mix) => [profileKey(mix), mix]));
  const pure = HUMAN_ORIGINS.map((origin) => unique.get(`${origin.id}:100`)!);
  const remaining = [...unique.entries()]
    .filter(([key]) => !pure.some((mix) => profileKey(mix) === key))
    .map(([, mix]) => mix)
    .sort((a, b) => profileKey(a) < profileKey(b) ? -1 : profileKey(a) > profileKey(b) ? 1 : 0);
  return [...pure, ...remaining].map((mix, id) => {
    const pureOriginId = mix.ids.length === 1 ? mix.ids[0] : null;
    const name = pureOriginId
      ? HUMAN_ORIGINS[originOrder.get(pureOriginId)!].name
      : `Смешанное происхождение: ${mix.ids.map((originId, index) =>
          `${HUMAN_ORIGINS[originOrder.get(originId)!].name} ${mix.shares[index]}%`).join(' + ')}`;
    const color = pureOriginId
      ? HUMAN_ORIGIN_COLORS[pureOriginId]
      : blendOriginColors(mix);
    return { id, mix, name, color, pureOriginId };
  });
}

function blendOriginColors(mix: HumanOriginMix): string {
  const channels = [1, 3, 5].map((offset) => Math.round(mix.ids.reduce((sum, id, index) =>
    sum + Number.parseInt(HUMAN_ORIGIN_COLORS[id].slice(offset, offset + 2), 16) * mix.shares[index] / 100, 0)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export const HUMAN_ANCESTRY_PROFILES = makeAncestryProfiles();
const ancestryProfileIndex = new Map(HUMAN_ANCESTRY_PROFILES.map((profile) => [profileKey(profile.mix), profile.id]));

export function ancestryProfileId(mix: HumanOriginMix): number {
  const canonical = canonicalizeHumanOrigins(new Map(mix.ids.map((id, index) => [id, mix.shares[index] ?? 0])));
  const id = ancestryProfileIndex.get(profileKey(canonical));
  if (id === undefined) throw new RangeError('Не найден профиль происхождения для состава предков.');
  return id;
}

export function ancestryProfile(profileId: number): HumanAncestryProfile {
  return HUMAN_ANCESTRY_PROFILES[profileId] ?? HUMAN_ANCESTRY_PROFILES[0];
}

export function expectedOriginProfiles(
  counts: ReadonlyMap<number, number>,
  population: number,
): Map<number, number> {
  const groups = [...counts]
    .filter(([profileId, count]) => ancestryProfile(profileId).id === profileId && Number.isFinite(count) && count > 0)
    .sort((a, b) => a[0] - b[0]);
  const pairs = new Map<number, number>();
  let total = 0;
  if (population >= 2) {
    for (let first = 0; first < groups.length; first += 1) {
      const [firstId, firstCount] = groups[first];
      const same = firstCount * (firstCount - 1) / 2;
      if (same > 0) {
        pairs.set(firstId, (pairs.get(firstId) ?? 0) + same);
        total += same;
      }
      for (let second = first + 1; second < groups.length; second += 1) {
        const [secondId, secondCount] = groups[second];
        const amount = firstCount * secondCount;
        if (!(amount > 0)) continue;
        const child = ancestryProfileId(inheritHumanOrigins(
          ancestryProfile(firstId).mix,
          ancestryProfile(secondId).mix,
        ));
        pairs.set(child, (pairs.get(child) ?? 0) + amount);
        total += amount;
      }
    }
  }
  if (!(total > 0)) {
    const sum = groups.reduce((value, [, count]) => value + count, 0);
    for (const [profileId, count] of groups) pairs.set(profileId, count / Math.max(1, sum) * 100);
    return pairs;
  }
  for (const [profileId, amount] of pairs) pairs.set(profileId, amount / total * 100);
  return pairs;
}

/** Создаёт строки отображения только для уже канонического полного состава. */
export function humanOriginShares(mix: HumanOriginMix | null | undefined): HumanOriginShare[] | null {
  if (!mix || !Array.isArray(mix.ids) || !Array.isArray(mix.shares) ||
      mix.ids.length === 0 || mix.ids.length !== mix.shares.length) return null;
  const seen = new Set<HumanOriginId>();
  const total = mix.shares.reduce((sum, share, index) => {
    const id = mix.ids[index];
    if (!originOrder.has(id) || seen.has(id) || !Number.isFinite(share) || share <= 0) return Number.NaN;
    seen.add(id);
    return sum + share;
  }, 0);
  if (Math.abs(total - 100) > 1e-8) return null;
  return mix.ids.map((id, index) => ({
    id,
    name: HUMAN_ORIGINS[originOrder.get(id)!].name,
    color: HUMAN_ORIGIN_COLORS[id],
    share: mix.shares[index],
  }));
}

export function humanOriginProfileShares(
  counts: ReadonlyMap<number, number> | null | undefined,
  population?: number,
): HumanOriginProfileShare[] | null {
  if (!counts) return null;
  const total = population ?? [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  return [...counts]
    .filter(([id, value]) => HUMAN_ANCESTRY_PROFILES[id]?.id === id && Number.isFinite(value) && value > 0)
    .map(([id, value]) => {
      const profile = ancestryProfile(id);
      return { id, originId: profile.pureOriginId, name: profile.name, color: profile.color, share: value / total * 100 };
    })
    .sort((a, b) => b.share - a.share || a.id - b.id);
}

export function humanOriginMixToTable(mix: HumanOriginMix): Map<number, number> {
  return new Map([[ancestryProfileId(mix), 100]]);
}

export function humanOriginIndex(id: HumanOriginId): number {
  return originOrder.get(id) ?? 0;
}

export function humanOriginMixFromTable(ids: number[], shares: number[]): HumanOriginMix {
  const totals = new Map<HumanOriginId, number>();
  ids.forEach((profileId, index) => {
    const profile = ancestryProfile(profileId).mix;
    profile.ids.forEach((originId, originIndex) => {
      totals.set(originId, (totals.get(originId) ?? 0) +
        (shares[index] ?? 0) * profile.shares[originIndex] / 100);
    });
  });
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return total > 0
    ? { ids: [...totals.keys()].sort((a, b) => originOrder.get(a)! - originOrder.get(b)!),
        shares: [...totals.keys()].sort((a, b) => originOrder.get(a)! - originOrder.get(b)!)
          .map((id) => (totals.get(id) ?? 0) * 100 / total) }
    : defaultHumanOriginMix();
}

export function combineHumanOriginTableMixes(
  table: { entries: { ids: number[]; shares: number[] }[]; intern(mix: Map<number, number>): number },
  mixes: { id: number; weight: number }[],
): number {
  const totals = new Map<number, number>();
  for (const { id: mixId, weight } of mixes) {
    if (!(weight > 0)) continue;
    const entry = table.entries[mixId];
    if (!entry) continue;
    entry.ids.forEach((profileId, index) => {
      totals.set(profileId, (totals.get(profileId) ?? 0) + weight * entry.shares[index] / 100);
    });
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return total > 0 ? table.intern(new Map([...totals].map(([id, value]) => [id, value * 100 / total]))) : 0;
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

/** Для профиля происхождения отдельного персонажа округляет доли до четвертей, исключает меньшие составляющие и распределяет остаток детерминированно. */
export function canonicalizeHumanOrigins(values: ReadonlyMap<HumanOriginId, number>): HumanOriginMix {
  const valid = [...values]
    .filter(([id, value]) => originOrder.has(id) && Number.isFinite(value) && value > 0)
    .sort((a, b) => originOrder.get(a[0])! - originOrder.get(b[0])!);
  const total = valid.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return { ids: [DEFAULT_LEGACY_ORIGIN], shares: [100] };
  const ordered = valid.filter(([, value]) => value / total * 100 >= HUMAN_ORIGIN_SHARE_STEP);
  const retainedTotal = ordered.reduce((sum, [, value]) => sum + value, 0);
  if (retainedTotal <= 0) return { ids: [DEFAULT_LEGACY_ORIGIN], shares: [100] };
  const parts = ordered.map(([id, value]) => ({
    id,
    exact: value / retainedTotal * 4,
    units: Math.floor(value / retainedTotal * 4),
  }));
  let remaining = 4 - parts.reduce((sum, part) => sum + part.units, 0);
  for (const part of [...parts].sort((a, b) =>
    (b.exact - b.units) - (a.exact - a.units) || originOrder.get(a.id)! - originOrder.get(b.id)!)) {
    if (remaining <= 0) break;
    part.units += 1;
    remaining -= 1;
  }
  const kept = parts.filter((part) => part.units > 0);
  return {
    ids: kept.map((part) => part.id),
    shares: kept.map((part) => part.units * HUMAN_ORIGIN_SHARE_STEP),
  };
}

/** Объединяет происхождение родителей или групп с заданными весами населения. */
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

/** Ребёнок получает равный вклад обоих родителей с единственным округлением результата. */
export function inheritHumanOrigins(first: HumanOriginMix, second: HumanOriginMix): HumanOriginMix {
  return combineHumanOrigins([{ mix: first, weight: 1 }, { mix: second, weight: 1 }]);
}

/**
 * Ожидаемое происхождение потомства по численности категорий: внутри категории n(n−1)/2,
 * между категориями nᵢ*nⱼ, согласно правилам игры.
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

/** Рассчитывает ожидаемый состав происхождения нового населения по доступным парам местных жителей. */
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

function rangeClimateFactor(value: number, range: [number, number]): number {
  const width = Math.max(Number.EPSILON, range[1] - range[0]);
  return 0.5 ** (distanceToRange(value, range) / width);
}

export function climateFactorForOrigin(
  id: HumanOriginId,
  temperature: number,
  humidity: number,
  drainage: number,
): number {
  const climate = HUMAN_ORIGINS.find((origin) => origin.id === id)!.climate;
  return rangeClimateFactor(temperature, climate.temperature) *
    rangeClimateFactor(humidity, climate.humidity) *
    rangeClimateFactor(drainage, climate.drainage);
}

export function climateFactorForMix(
  mix: HumanOriginMix,
  temperature: number,
  humidity: number,
  drainage: number,
): number {
  return mix.ids.reduce((factor, id, index) =>
    factor + climateFactorForOrigin(id, temperature, humidity, drainage) * (mix.shares[index] ?? 0) / 100,
  0);
}

/** Возвращает соответствие климату по долям происхождения, сохраняя шкалу 0–100 для интерфейса. */
export function climateSuitability(
  mix: HumanOriginMix,
  temperature: number,
  humidity: number,
  drainage = 50,
): number {
  return climateFactorForMix(mix, temperature, humidity, drainage) * 100;
}

export function humanClimateSuitabilityAt(
  world: {
    humanOrigins: Uint16Array;
    humanOriginTable: { entries: { ids: number[]; shares: number[]; total: number }[] };
    temperature: Float32Array;
    humidity: Uint8Array;
    drainage: Uint8Array;
  },
  pixel: number,
): number {
  const entry = world.humanOriginTable.entries[world.humanOrigins[pixel]];
  const mix = entry?.total === 100
    ? humanOriginMixFromTable(entry.ids, entry.shares)
    : defaultHumanOriginMix();
  return climateSuitability(
    mix,
    world.temperature[pixel],
    world.humidity[pixel],
    world.drainage[pixel],
  );
}

/** Детерминированно выбирает начальную климатическую категорию для нового поселения по местному климату, без генератора случайных чисел. */
export function originForHabitat(temperature: number, humidity: number, drainage = 50): HumanOriginId {
  return HUMAN_ORIGINS.map((origin, index) => ({
    id: origin.id,
    index,
    factor: climateFactorForOrigin(origin.id, temperature, humidity, drainage),
  })).sort((a, b) => b.factor - a.factor || a.index - b.index)[0].id;
}
