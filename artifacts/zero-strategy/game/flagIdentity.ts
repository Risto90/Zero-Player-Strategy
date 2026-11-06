import { FLAG_GENERATOR_CONFIG } from './flagGeneratorConfig';
import { FLAG_IDENTITY_CONFIG, type FlagEntityType, type FlagGenerationPurpose } from './flagIdentityConfig';
import type { FlagProfileConfig } from './flagProfileConfig';
import { areFlagTagSetsCompatible, availableFlagProfiles } from './flagProfiles';
import { generateProfiledFlag } from './flagProfiledGenerator';
import type { FlagSpec } from './flagSpec';
import { flagStageRandom } from './random';
import { renderFlagSpec } from './flagRenderer';

export interface FlagIdentity {
  worldSeed: number;
  flagSeed?: number;
  entityType: FlagEntityType;
  entityId: number;
  generationPurpose: FlagGenerationPurpose;
  seed: string;
  variationSeed: string;
  generatorVersion: string;
  profileId: string;
  era: number;
  tags: string[];
  parentStyleRef: string | null;
  relationshipType: 'culture-branch' | 'religion-branch' | null;
  cultureId?: number;
}

export interface FlagStyleProfile {
  profileId: string;
  era: number;
  tags: string[];
  generatorVersion: string;
  identity: FlagIdentity;
}

export interface FlagEntityStyleSource {
  id: number;
  styleProfile?: FlagStyleProfile;
  parentId?: number | null;
}

export interface FlaggedEntity {
  id: number;
  emblemSpec?: FlagSpec;
  emblemSvg?: string;
  flagIdentity?: FlagIdentity;
  styleProfile?: FlagStyleProfile;
}

export interface FlagGenerationSelection {
  era?: number;
  profileId?: string;
  generationSeed?: string | number;
  tags?: readonly string[];
}

function profilesAllowedForTags(
  profiles: readonly FlagProfileConfig[],
  tags: readonly string[],
): FlagProfileConfig[] {
  return profiles.filter((profile) =>
    (profile.tags_allowed === null ? tags.length === 0 : tags.every((tag) => profile.tags_allowed!.includes(tag))) &&
    areFlagTagSetsCompatible(tags),
  );
}

function profilesForEra(era: number, tags: readonly string[]): FlagProfileConfig[] {
  const profiles = availableFlagProfiles(era);
  const eligible = profilesAllowedForTags(profiles, tags);
  return eligible.length ? eligible : tags.length === 0 ? profiles : [];
}

export function compatibleFlagProfileIds(era: number, tags: readonly string[] = []): string[] {
  return profilesForEra(era, tags).map(({ id }) => id);
}

export function selectFlagProfileId(
  purpose: FlagGenerationPurpose,
  era: number,
  tags: readonly string[],
  selectionSeed: string | number,
  customWeights?: Readonly<Record<string, number>>,
  excludedProfileIds: readonly string[] = [],
): string {
  const candidates = profilesForEra(era, tags)
    .filter(({ id }) => !excludedProfileIds.includes(id));
  if (!candidates.length) throw new Error(`Для эпохи ${era} и назначения «${purpose}» не настроен ни один профиль флага.`);
  const configuredWeights = FLAG_IDENTITY_CONFIG.profileWeightsByPurpose[purpose];
  const weights = candidates.map(({ id }) => customWeights
    ? Math.max(0, customWeights[id] ?? 0)
    : Math.max(0, configuredWeights[id as keyof typeof configuredWeights] ?? 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) throw new Error(`Для эпохи ${era} и назначения «${purpose}» у профилей нулевой общий вес.`);
  let point = flagStageRandom(`${selectionSeed}|${purpose}:${era}:${tags.join(',')}`, 'S0_PROFILE')() * total;
  for (let index = 0; index < candidates.length; index += 1) {
    point -= weights[index];
    if (point < 0) return candidates[index].id;
  }
  return candidates[candidates.length - 1].id;
}

function chooseProfileAndEra(
  purpose: FlagGenerationPurpose,
  tags: readonly string[],
  preferredProfileId: string | undefined,
  selectionSeed: string,
  requestedEra?: number,
): { profile: FlagProfileConfig; era: number } {
  const preferredProfiles = preferredProfileId
    ? Array.from({ length: 7 }, (_, era) => availableFlagProfiles(era))
      .flat()
      .filter(({ id }, index, all) => id === preferredProfileId && all.findIndex((entry) => entry.id === id) === index)
    : [];
  const preferred = preferredProfiles[0];
  if (preferred) {
    if (preferred.tags_allowed === null ? tags.length > 0 : !tags.every((tag) => preferred.tags_allowed!.includes(tag))) {
      throw new Error(`Профиль ${preferred.id} не допускает заданные культурные теги.`);
    }
    if (!areFlagTagSetsCompatible(tags)) throw new Error('Заданные культурные теги несовместимы.');
  } else if (preferredProfileId) {
    throw new Error(`Неизвестный профиль флага ${preferredProfileId}.`);
  }

  const eras = (requestedEra === undefined
    ? preferred ? preferred.eras : Array.from({ length: 7 }, (_, era) => era)
    : [requestedEra])
    .filter((era, index, all) => Number.isInteger(era) && era >= 0 && era <= 6 && all.indexOf(era) === index)
    .filter((era) => preferred
      ? preferred.eras.includes(era)
      : profilesForEra(era, tags).length > 0);
  if (!eras.length) {
    throw new Error(requestedEra === undefined
      ? `Для назначения «${purpose}» не найдено допустимых эпох.`
      : `Для назначения «${purpose}» нет профиля в эпохе ${requestedEra}.`);
  }
  const eraIndex = Math.floor(flagStageRandom(`${selectionSeed}|${purpose}`, 'S0_ERA')() * eras.length);
  const era = eras[eraIndex];
  const profileId = preferred?.id ?? selectFlagProfileId(purpose, era, tags, selectionSeed);
  const profile = availableFlagProfiles(era).find(({ id }) => id === profileId);
  if (!profile) throw new Error(`Для эпохи ${era} и назначения «${purpose}» не найден профиль ${profileId}.`);
  return { profile, era };
}

function profileFor(
  purpose: FlagGenerationPurpose,
  era: number,
  tags: readonly string[],
  preferredProfileId?: string,
  selectionSeed = '',
): FlagProfileConfig {
  const profiles = availableFlagProfiles(era);
  const preferred = preferredProfileId ? profiles.find(({ id }) => id === preferredProfileId) : undefined;
  if (preferred) {
    if (preferred.tags_allowed === null ? tags.length > 0 : !tags.every((tag) => preferred.tags_allowed!.includes(tag))) {
      throw new Error(`Профиль ${preferred.id} не допускает заданные культурные теги.`);
    }
    if (!areFlagTagSetsCompatible(tags)) throw new Error('Заданные культурные теги несовместимы.');
    return preferred;
  }
  if (preferredProfileId) {
    throw new Error(`Профиль ${preferredProfileId} недоступен в настроенной эпохе ${era}.`);
  }

  const eligible = profiles.filter((profile) =>
    (profile.tags_allowed === null ? tags.length === 0 : tags.every((tag) => profile.tags_allowed!.includes(tag))) &&
    areFlagTagSetsCompatible(tags),
  );
  const candidates = eligible.length ? eligible : tags.length === 0 ? profiles : [];
  if (!candidates.length) throw new Error(`Для эпохи ${era} не настроен ни один профиль флага.`);
  const configuredWeights = FLAG_IDENTITY_CONFIG.profileWeightsByPurpose[purpose];
  const weights = candidates.map(({ id }) => Math.max(0, configuredWeights[id as keyof typeof configuredWeights] ?? 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) throw new Error(`Для назначения «${purpose}» у профилей эпохи ${era} нулевой общий вес.`);
  let point = flagStageRandom(
    `${selectionSeed}|${purpose}:${era}:${tags.join(',')}`,
    'S0_PROFILE',
  )() * total;
  for (let index = 0; index < candidates.length; index += 1) {
    point -= weights[index];
    if (point < 0) return candidates[index];
  }
  return candidates[candidates.length - 1];
}

function buildIdentity(
  worldSeed: number,
  entityType: FlagEntityType,
  entityId: number,
  purpose: FlagGenerationPurpose,
  profile: FlagProfileConfig,
  era: number,
  tags: readonly string[],
  parentStyleRef: string | null = null,
  relationshipType: FlagIdentity['relationshipType'] = null,
  variationSalt = 0,
  flagSeed = worldSeed,
  generationSeed?: string | number,
): FlagIdentity {
  const stableIdentity = `${worldSeed}|flagSeed=${flagSeed}|${entityType}|${entityId}|${purpose}|profile=${profile.id}|era=${era}`;
  const seed = generationSeed === undefined ? `zero-strategy|${stableIdentity}` : String(generationSeed);
  const variationSeed = generationSeed === undefined
    ? `${seed}|parent=${parentStyleRef ?? 'root'}|variation=${variationSalt}`
    : seed;
  return {
    worldSeed,
    flagSeed,
    entityType,
    entityId,
    generationPurpose: purpose,
    seed,
    variationSeed,
    generatorVersion: FLAG_GENERATOR_CONFIG.generatorVersion,
    profileId: profile.id,
    era,
    tags: [...tags],
    parentStyleRef,
    relationshipType,
  };
}

export function createFlagStyleProfile(
  worldSeed: number,
  entityType: 'culture' | 'religion',
  entityId: number,
  purpose: 'culture-style' | 'religion-symbol',
  tags: readonly string[] = [],
  parent?: FlagEntityStyleSource | null,
  flagSeed = worldSeed,
  selection: FlagGenerationSelection = {},
): FlagStyleProfile {
  const parentProfile = parent?.styleProfile;
  const configuredTags = entityType === 'culture'
    ? FLAG_IDENTITY_CONFIG.cultureTagsById[entityId]
    : undefined;
  const resolvedTags = configuredTags ?? (selection.tags ? [...selection.tags] : tags.length ? [...tags] : parentProfile?.tags ?? []);
  const mappedProfile = entityType === 'culture'
    ? FLAG_IDENTITY_CONFIG.cultureProfilesById[entityId]
    : undefined;
  const selectionSeed = `${flagSeed}|${entityType}|${entityId}|${purpose}`;
  const selected = parentProfile && selection.profileId === undefined
    ? {
      profile: profileFor(purpose, parentProfile.era, resolvedTags, parentProfile.profileId, selectionSeed),
      era: parentProfile.era,
    }
    : chooseProfileAndEra(
      purpose,
      resolvedTags,
      selection.profileId ?? mappedProfile,
      selectionSeed,
      selection.era,
    );
  const { profile, era } = selected;
  const identity = buildIdentity(
    worldSeed,
    entityType,
    entityId,
    purpose,
    profile,
    era,
    resolvedTags,
    parentProfile ? `${entityType}:${parent!.id}:${parentProfile.profileId}` : null,
    parentProfile ? (entityType === 'culture' ? 'culture-branch' : 'religion-branch') : null,
    0,
    flagSeed,
    selection.generationSeed,
  );
  return {
    profileId: profile.id,
    era,
    tags: [...resolvedTags],
    generatorVersion: FLAG_GENERATOR_CONFIG.generatorVersion,
    identity,
  };
}

export function createEntityEmblem(
  worldSeed: number,
  entityType: FlagEntityType,
  entityId: number,
  purpose: FlagGenerationPurpose,
  styleProfile?: FlagStyleProfile,
  parent?: FlaggedEntity | null,
  cityRank?: number,
  flagSeed = worldSeed,
  selection: FlagGenerationSelection = {},
): { emblemSpec: FlagSpec; emblemSvg: string; flagIdentity: FlagIdentity; styleProfile: FlagStyleProfile } {
  if (entityType === 'city' && (!Number.isInteger(cityRank) || (cityRank ?? 0) < 2 || (cityRank ?? 0) > 6)) {
    throw new Error('Герб создаётся только для города ранга 2–6.');
  }
  const parentProfile = parent?.styleProfile;
  const tags = selection.tags ? [...selection.tags] : parentProfile?.tags ?? styleProfile?.tags ?? [];
  const inheritedProfile = parentProfile ?? styleProfile;
  const selectionSeed = `${flagSeed}|${entityType}|${entityId}|${purpose}`;
  const selected = inheritedProfile && selection.profileId === undefined
    ? {
      profile: profileFor(purpose, inheritedProfile.era, tags, inheritedProfile.profileId, selectionSeed),
      era: inheritedProfile.era,
    }
    : chooseProfileAndEra(
      purpose,
      tags,
      selection.profileId,
      selectionSeed,
      selection.era ?? inheritedProfile?.era,
    );
  const { profile, era } = selected;
  const parentStyleRef = parent?.flagIdentity
    ? `${parent.flagIdentity.entityType}:${parent.flagIdentity.entityId}:${parent.flagIdentity.profileId}`
    : parentProfile
      ? `${entityType === 'religion' ? 'religion' : 'culture'}:${parent?.id}:${parentProfile.profileId}`
      : null;
  const relationshipType: FlagIdentity['relationshipType'] = parentStyleRef
    ? entityType === 'religion' ? 'religion-branch' : 'culture-branch'
    : null;

  const identity = buildIdentity(
    worldSeed,
    entityType,
    entityId,
    purpose,
    profile,
    era,
    tags,
    parentStyleRef,
    relationshipType,
    0,
    flagSeed,
    selection.generationSeed,
  );
  if (styleProfile?.identity.entityType === 'culture') {
    identity.cultureId = styleProfile.identity.entityId;
  }
  const result = generateProfiledFlag({
    seed: identity.variationSeed,
    profileId: profile.id,
    era,
    generator_version: FLAG_IDENTITY_CONFIG.generatorVersion,
    generation_context: {
      world_seed: worldSeed,
      flag_seed: flagSeed,
      entity_type: entityType,
      entity_id: entityId,
      generation_purpose: purpose,
      ...(entityType === 'city' ? { city_rank: cityRank ?? 2 } : {}),
      ...(styleProfile?.identity.entityType === 'culture'
        ? { culture_id: styleProfile.identity.entityId, culture_tags: [...tags] }
        : {}),
      ...(parentStyleRef ? {
        parent_style_ref: parentStyleRef,
        relationship_type: relationshipType ?? undefined,
      } : {}),
      variation_seed: identity.variationSeed,
      variation_policy: FLAG_IDENTITY_CONFIG.variationPolicy,
    },
  });
  if (!result.svg) throw new Error(`Генератор не вернул SVG для эмблемы ${entityType}:${entityId}.`);
  return {
    emblemSpec: result.flag,
    emblemSvg: result.svg,
    flagIdentity: identity,
    styleProfile: {
      profileId: profile.id,
      era,
      tags: [...tags],
      generatorVersion: result.flag.generator_version,
      identity,
    },
  };
}

/** Однократно восстанавливает SVG старого сохранения из его сохранённой спецификации. */
export function ensureEmblemSvg<T extends FlaggedEntity>(entity: T): T {
  if (entity.emblemSpec && !entity.emblemSvg) {
    entity.emblemSvg = renderFlagSpec(entity.emblemSpec);
  }
  return entity;
}

export function ensureFlagIdentity<T extends FlaggedEntity>(
  worldSeed: number,
  entity: T,
  entityType: FlagEntityType,
  purpose: FlagGenerationPurpose,
  styleProfile?: FlagStyleProfile,
  parent?: FlaggedEntity | null,
  cityRank?: number,
  flagSeed = worldSeed,
  selection: FlagGenerationSelection = {},
): T {
  if (entityType === 'city' && ((cityRank ?? 1) < 2 || (cityRank ?? 1) > 6)) return entity;
  if (entity.emblemSpec && entity.flagIdentity && entity.styleProfile) return entity;

  const resolvedStyle = styleProfile ?? entity.styleProfile;
  if (entity.emblemSpec) {
    entity.styleProfile ??= {
      profileId: entity.emblemSpec.profile_id,
      era: entity.emblemSpec.era,
      tags: [...entity.emblemSpec.tags],
      generatorVersion: entity.emblemSpec.generator_version,
      identity: entity.flagIdentity ?? {
        ...buildIdentity(
          worldSeed,
          entityType,
          entity.id,
          purpose,
          profileFor(
            purpose,
            entity.emblemSpec.era,
            entity.emblemSpec.tags,
            entity.emblemSpec.profile_id,
            `${flagSeed}|${entityType}|${entity.id}|${purpose}`,
          ),
          entity.emblemSpec.era,
          entity.emblemSpec.tags,
          null,
          null,
          0,
          flagSeed,
        ),
        seed: String(entity.emblemSpec.seed),
        variationSeed: String(entity.emblemSpec.seed),
        generatorVersion: entity.emblemSpec.generator_version,
      },
    };
    entity.flagIdentity ??= entity.emblemSpec.seed === entity.styleProfile.identity.variationSeed
      ? entity.styleProfile.identity
      : {
        ...entity.styleProfile.identity,
        seed: String(entity.emblemSpec.seed),
        variationSeed: String(entity.emblemSpec.seed),
        generatorVersion: entity.emblemSpec.generator_version,
      };
    return entity;
  }

  const generated = createEntityEmblem(
    worldSeed,
    entityType,
    entity.id,
    purpose,
    resolvedStyle,
    parent,
    cityRank,
    flagSeed,
    selection,
  );
  entity.emblemSpec = generated.emblemSpec;
  entity.emblemSvg = generated.emblemSvg;
  entity.flagIdentity = generated.flagIdentity;
  entity.styleProfile = generated.styleProfile;
  return entity;
}

export function ensureStyleProfile(
  worldSeed: number,
  entity: FlaggedEntity,
  entityType: 'culture' | 'religion',
  purpose: 'culture-style' | 'religion-symbol',
  tags: readonly string[] = [],
  parent?: FlagEntityStyleSource | null,
  flagSeed = worldSeed,
  selection: FlagGenerationSelection = {},
): FlagStyleProfile {
  if (entity.styleProfile) return entity.styleProfile;
  if (entity.emblemSpec) {
    entity.styleProfile = {
      profileId: entity.emblemSpec.profile_id,
      era: entity.emblemSpec.era,
      tags: [...entity.emblemSpec.tags],
      generatorVersion: entity.emblemSpec.generator_version,
      identity: entity.flagIdentity ?? {
        ...buildIdentity(
          worldSeed,
          entityType,
          entity.id,
          purpose,
          profileFor(
            purpose,
            entity.emblemSpec.era,
            entity.emblemSpec.tags,
            entity.emblemSpec.profile_id,
            `${flagSeed}|${entityType}|${entity.id}|${purpose}`,
          ),
          entity.emblemSpec.era,
          entity.emblemSpec.tags,
          null,
          null,
          0,
          flagSeed,
        ),
        seed: String(entity.emblemSpec.seed),
        variationSeed: String(entity.emblemSpec.seed),
        generatorVersion: entity.emblemSpec.generator_version,
      },
    };
    entity.flagIdentity ??= entity.styleProfile.identity;
    return entity.styleProfile;
  }
  entity.styleProfile = createFlagStyleProfile(worldSeed, entityType, entity.id, purpose, tags, parent, flagSeed, selection);
  entity.flagIdentity ??= entity.styleProfile.identity;
  return entity.styleProfile;
}

export function cultureTags(cultureId: number): string[] {
  return [...(FLAG_IDENTITY_CONFIG.cultureTagsById[cultureId] ?? [])];
}
