import {
  FLAG_PROFILE_CONFIG,
  FLAG_PROFILE_DEFAULTS,
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
  return FLAG_PROFILE_CONFIG.find((entry) => entry.id === id);
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
  const choices = primary.HYB
    .map((id) => getFlagProfile(id))
    .filter((entry): entry is FlagProfileConfig => !!entry && entry.eras.includes(era) && canUseHybridProfiles(primary, entry, tags).valid);
  if (choices.length === 0) return null;
  return choices[Math.min(choices.length - 1, Math.floor(checkedRandom(random) * choices.length))];
}

/**
 * Probabilities are explicit data/inputs. `unresolved` is returned for the
 * remaining probability because §13 does not define another style mode.
 */
export function chooseFlagProfileMode(
  random: () => number,
  purity = FLAG_PROFILE_DEFAULTS.purity,
  hybridProbability = FLAG_PROFILE_DEFAULTS.hybridProbability,
): FlagProfileMode {
  if (!isProbability(purity) || !isProbability(hybridProbability) || purity + hybridProbability > 1) {
    throw new RangeError('Profile mode probabilities must be in [0, 1] and sum to at most 1.');
  }
  const value = checkedRandom(random);
  if (value < purity) return 'pure';
  if (value < purity + hybridProbability) return 'hybrid';
  return 'unresolved';
}

export interface HybridProfileMix {
  OUT: FlagProfileConfig['OUT'];
  ASP: FlagProfileConfig['ASP'];
  PAL: FlagProfileConfig['PAL'];
  fieldAndOrdinaries: { GND: FlagProfileConfig['GND']; ORD: FlagProfileConfig['ORD']; sourceProfileId: string };
  charges: { CHG: FlagProfileConfig['CHG']; sourceProfileId: string };
}

/** Primary owns outline, aspect and palette; two explicit coin flips pick the other data groups. */
export function mixHybridProfileProperties(
  primary: FlagProfileConfig,
  second: FlagProfileConfig,
  random: () => number,
): HybridProfileMix {
  const fieldSource = checkedRandom(random) < 0.5 ? primary : second;
  const chargeSource = checkedRandom(random) < 0.5 ? primary : second;
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
