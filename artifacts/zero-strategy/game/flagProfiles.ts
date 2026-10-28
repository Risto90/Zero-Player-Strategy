import {
  FLAG_PROFILE_CONFIG,
  FLAG_PROFILE_DEFAULTS,
  FLAG_HYBRID_SOURCE_WEIGHTS,
  FLAG_PROFILE_HYBRID_PAIR_WEIGHTS,
  FLAG_FALLBACK_PROFILE_CONFIG,
  FLAG_TAG_COMPATIBILITY,
  type FlagProfileConfig,
  type FlagProfileWeights,
} from './flagProfileConfig';

export type FlagProfileId = (typeof FLAG_PROFILE_CONFIG)[number]['id'];
export type FlagProfileMode = 'pure' | 'hybrid' | 'unresolved';

export interface ProfileTagCheck {
  valid: boolean;
  reason?: 'unknown-profile' | 'missing-tags-allowed' | 'tag-not-allowed' | 'hybrid-not-configured' | 'incompatible-tags' | 'multiple-foreign-groups';
}

export function getFlagProfile(id: string): FlagProfileConfig | undefined {
  return FLAG_PROFILE_CONFIG.find((entry) => entry.id === id) ??
    (FLAG_FALLBACK_PROFILE_CONFIG.id === id ? FLAG_FALLBACK_PROFILE_CONFIG : undefined);
}

export function availableFlagProfiles(era: number): FlagProfileConfig[] {
  if (!Number.isInteger(era) || era < 0 || era > 6) return [];
  return FLAG_PROFILE_CONFIG.filter((entry) => entry.eras.includes(era));
}

/** Pair rules are symmetric; a neutral tag is compatible with every tag. */
export function flagTagsCompatible(first: string, second: string, hybridMode = false): boolean {
  if (first === second || first === FLAG_TAG_COMPATIBILITY.universal || second === FLAG_TAG_COMPATIBILITY.universal) return true;
  const hasPair = (pairs: readonly (readonly string[])[], a: string, b: string) =>
    pairs.some(([left, right]) => (left === a && right === b) || (left === b && right === a) || (right === '*' && left === a) || (left === '*' && right === a) || (right === '*' && left === b) || (left === '*' && right === b));
  if (hasPair(FLAG_TAG_COMPATIBILITY.forbidden, first, second)) return false;
  if (hasPair(FLAG_TAG_COMPATIBILITY.hybridOnly, first, second)) return hybridMode;
  return true;
}

export function areFlagTagSetsCompatible(tags: readonly string[], hybridMode = false): boolean {
  for (let first = 0; first < tags.length; first += 1) {
    for (let second = first + 1; second < tags.length; second += 1) {
      if (!flagTagsCompatible(tags[first], tags[second], hybridMode)) return false;
    }
  }
  return true;
}

export function isPureFlagStyle(profile: FlagProfileConfig, tags: readonly string[]): ProfileTagCheck {
  if (profile.tags_allowed === null && tags.length > 0) return { valid: false, reason: 'missing-tags-allowed' };
  if (!tags.every((tag) => profile.tags_allowed?.includes(tag))) return { valid: false, reason: 'tag-not-allowed' };
  if (!areFlagTagSetsCompatible(tags)) return { valid: false, reason: 'incompatible-tags' };
  return { valid: true };
}

export function canUseHybridProfiles(primary: FlagProfileConfig, second: FlagProfileConfig, tags: readonly string[] = []): ProfileTagCheck {
  if (!primary.HYB.includes(second.id)) return { valid: false, reason: 'hybrid-not-configured' };
  if (!areFlagTagSetsCompatible(tags, true)) return { valid: false, reason: 'incompatible-tags' };
  if (primary.tags_allowed === null && tags.length > 0) return { valid: false, reason: 'missing-tags-allowed' };

  const primaryTags = new Set(primary.tags_allowed ?? []);
  const foreign = tags.filter((tag) => !primaryTags.has(tag));
  if (foreign.length === 0) return { valid: true };
  if (second.tags_allowed === null || !foreign.every((tag) => second.tags_allowed?.includes(tag))) {
    return { valid: false, reason: 'tag-not-allowed' };
  }
  // The selected secondary profile is the single foreign tag group; foreign
  // tags from other profiles are rejected by the secondary allowance check.
  return { valid: true };
}

export function chooseHybridProfile(
  primary: FlagProfileConfig,
  era: number,
  random: () => number,
  tags: readonly string[] = [],
): FlagProfileConfig | null {
  const choices = FLAG_PROFILE_HYBRID_PAIR_WEIGHTS
    .filter(({ first, second }) => first === primary.id || second === primary.id)
    .map((pair) => ({
      profile: getFlagProfile(pair.first === primary.id ? pair.second : pair.first),
      weight: pair.weight,
    }))
    .filter(({ profile }) => profile && era >= Math.min(...profile.eras) - 1 &&
      era <= Math.max(...profile.eras) + 1 && canUseHybridProfiles(primary, profile, tags).valid);
  if (choices.length === 0) return null;
  let target = checkedRandom(random) * choices.reduce((total, entry) => total + entry.weight, 0);
  for (const choice of choices) {
    target -= choice.weight;
    if (target < 0) return choice.profile!;
  }
  return choices[choices.length - 1].profile!;
}

/** Вероятность гибрида по ответу равна дополнению чистоты до единицы. */
export function chooseFlagProfileMode(
  random: () => number,
  purity = FLAG_PROFILE_DEFAULTS.purity,
): Exclude<FlagProfileMode, 'unresolved'> {
  if (!isProbability(purity)) throw new RangeError('Profile purity must be in [0, 1].');
  const value = checkedRandom(random);
  return value < purity ? 'pure' : 'hybrid';
}

export interface HybridProfileMix {
  OUT: FlagProfileConfig['OUT'];
  ASP: FlagProfileConfig['ASP'];
  PAL: FlagProfileConfig['PAL'];
  fieldAndOrdinaries: { GND: FlagProfileConfig['GND']; ORD: FlagProfileConfig['ORD']; sourceProfileId: string };
  charges: { CHG: FlagProfileConfig['CHG']; sourceProfileId: string };
}

/** Контур, аспект и палитра принадлежат базе; два источника выбираются одним взвешенным исходом. */
export function mixHybridProfileProperties(
  primary: FlagProfileConfig,
  second: FlagProfileConfig,
  random: () => number,
): HybridProfileMix {
  const outcome = chooseFlagProfileWeight<'donor-base' | 'base-donor' | 'donor-donor'>({
    'donor-base': FLAG_HYBRID_SOURCE_WEIGHTS.donorBase,
    'base-donor': FLAG_HYBRID_SOURCE_WEIGHTS.baseDonor,
    'donor-donor': FLAG_HYBRID_SOURCE_WEIGHTS.donorDonor,
  }, random);
  const fieldSource = outcome === 'donor-base' || outcome === 'donor-donor' ? second : primary;
  const chargeSource = outcome === 'base-donor' || outcome === 'donor-donor' ? second : primary;
  return {
    OUT: primary.OUT,
    ASP: primary.ASP,
    PAL: primary.PAL,
    fieldAndOrdinaries: { GND: fieldSource.GND, ORD: fieldSource.ORD, sourceProfileId: fieldSource.id },
    charges: { CHG: chargeSource.CHG, sourceProfileId: chargeSource.id },
  };
}

/** Selects a configured weight without introducing defaults for absent weights. */
export function chooseFlagProfileWeight<T extends string>(weights: FlagProfileWeights | null, random: () => number): T {
  if (!weights) throw new Error('Profile weight distribution is not specified.');
  const entries = Object.entries(weights).map(([value, weight]) => {
    if (weight === null || !Number.isFinite(weight) || weight < 0) {
      throw new Error('Profile weight distribution must contain non-negative finite weights.');
    }
    return [value, weight] as const;
  });
  if (entries.length === 0) {
    throw new Error('Profile weight distribution must contain non-negative finite weights.');
  }
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) throw new Error('Profile weight distribution must have positive total weight.');
  const target = checkedRandom(random) * total;
  let cumulative = 0;
  for (const [value, weight] of entries) {
    cumulative += weight;
    if (target < cumulative) return value as T;
  }
  return entries[entries.length - 1][0] as T;
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function checkedRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Injected random source must return a number in [0, 1).');
  }
  return value;
}

/** Проверяет парные ограничения гибридов при загрузке конфигурации. */
export function validateFlagHybridPairConfig(): string[] {
  const issues: string[] = [];
  for (const pair of FLAG_PROFILE_HYBRID_PAIR_WEIGHTS) {
    const first = getFlagProfile(pair.first), second = getFlagProfile(pair.second);
    if (!first || !second || first.id === 'P28_FB' || second.id === 'P28_FB') {
      issues.push(`Пара ${pair.first}–${pair.second} ссылается на неизвестный или резервный профиль.`);
      continue;
    }
    if (!Number.isFinite(pair.weight) || pair.weight <= 0) {
      issues.push(`Пара ${pair.first}–${pair.second} имеет недопустимый вес.`);
    }
    const rangesOverlap = Math.min(Math.max(...first.eras) + 1, Math.max(...second.eras) + 1) >=
      Math.max(Math.min(...first.eras) - 1, Math.min(...second.eras) - 1);
    if (!rangesOverlap) issues.push(`Эпохи пары ${pair.first}–${pair.second} не пересекаются даже после расширения на ±1.`);
    if (!areFlagTagSetsCompatible([...(first.tags_allowed ?? []), ...(second.tags_allowed ?? [])], true)) {
      issues.push(`Собственные теги пары ${pair.first}–${pair.second} нарушают матрицу совместимости.`);
    }
    if (!first.HYB.includes(second.id) || !second.HYB.includes(first.id)) {
      issues.push(`Связь HYB пары ${pair.first}–${pair.second} не симметрична.`);
    }
  }
  return issues;
}

const hybridPairIssues = validateFlagHybridPairConfig();
if (hybridPairIssues.length) throw new Error(hybridPairIssues.join('\n'));
