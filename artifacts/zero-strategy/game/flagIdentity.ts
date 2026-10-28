import { FLAG_GENERATOR_CONFIG } from './flagGeneratorConfig';
import { FLAG_IDENTITY_CONFIG, type FlagEntityType, type FlagGenerationPurpose } from './flagIdentityConfig';
import type { FlagProfileConfig } from './flagProfileConfig';
import { areFlagTagSetsCompatible, availableFlagProfiles } from './flagProfiles';
import { generateProfiledFlag } from './flagProfiledGenerator';
import type { FlagSpec } from './flagSpec';

export interface FlagIdentity {
  worldSeed: number;
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
  flagIdentity?: FlagIdentity;
  styleProfile?: FlagStyleProfile;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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
  let point = Number.parseInt(
    stableHash(`${selectionSeed}|${purpose}:${era}:${tags.join(',')}`).slice(0, 8),
    16,
  ) / 0xffffffff * total;
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
  tags: readonly string[],
  parentStyleRef: string | null = null,
  relationshipType: FlagIdentity['relationshipType'] = null,
  variationSalt = 0,
): FlagIdentity {
  const stableIdentity = `${worldSeed}|${entityType}|${entityId}|${purpose}`;
  const seed = `zero-strategy|${stableIdentity}`;
  const variationSeed = `${seed}|parent=${parentStyleRef ?? 'root'}|variation=${variationSalt}`;
  return {
    worldSeed,
    entityType,
    entityId,
    generationPurpose: purpose,
    seed,
    variationSeed,
    generatorVersion: FLAG_GENERATOR_CONFIG.generatorVersion,
    profileId: profile.id,
    era: FLAG_IDENTITY_CONFIG.eraByPurpose[purpose] ?? FLAG_IDENTITY_CONFIG.defaultEra,
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
): FlagStyleProfile {
  const parentProfile = parent?.styleProfile;
  const configuredTags = entityType === 'culture'
    ? FLAG_IDENTITY_CONFIG.cultureTagsById[entityId]
    : undefined;
  const resolvedTags = configuredTags ?? (tags.length ? [...tags] : parentProfile?.tags ?? []);
  const mappedProfile = entityType === 'culture'
    ? FLAG_IDENTITY_CONFIG.cultureProfilesById[entityId]
    : undefined;
  const era = parentProfile?.era ?? FLAG_IDENTITY_CONFIG.eraByPurpose[purpose];
  const selectionSeed = `${worldSeed}|${entityType}|${entityId}|${purpose}`;
  const profile = profileFor(purpose, era, resolvedTags, parentProfile?.profileId ?? mappedProfile, selectionSeed);
  const identity = buildIdentity(
    worldSeed,
    entityType,
    entityId,
    purpose,
    profile,
    resolvedTags,
    parentProfile ? `${entityType}:${parent!.id}:${parentProfile.profileId}` : null,
    parentProfile ? (entityType === 'culture' ? 'culture-branch' : 'religion-branch') : null,
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
): { emblemSpec: FlagSpec; flagIdentity: FlagIdentity; styleProfile: FlagStyleProfile } {
  if (entityType === 'city' && (!Number.isInteger(cityRank) || (cityRank ?? 0) < 2 || (cityRank ?? 0) > 6)) {
    throw new Error('Герб создаётся только для города ранга 2–6.');
  }
  const parentProfile = parent?.styleProfile;
  const profileId = parentProfile?.profileId ?? styleProfile?.profileId;
  const tags = parentProfile?.tags ?? styleProfile?.tags ?? [];
  const era = parentProfile?.era ?? styleProfile?.era ?? FLAG_IDENTITY_CONFIG.eraByPurpose[purpose];
  const profile = profileFor(purpose, era, tags, profileId);
  const parentStyleRef = parent?.flagIdentity
    ? `${parent.flagIdentity.entityType}:${parent.flagIdentity.entityId}:${parent.flagIdentity.profileId}`
    : parentProfile
      ? `${entityType === 'religion' ? 'religion' : 'culture'}:${parent?.id}:${parentProfile.profileId}`
      : null;
  const relationshipType: FlagIdentity['relationshipType'] = parentStyleRef
    ? entityType === 'religion' ? 'religion-branch' : 'culture-branch'
    : null;

  let result: ReturnType<typeof generateProfiledFlag> | null = null;
  let identity: FlagIdentity | null = null;
  const attempts = parentStyleRef ? FLAG_IDENTITY_CONFIG.relatedVariationAttempts : 1;
  for (let variation = 0; variation < attempts; variation += 1) {
    identity = buildIdentity(
      worldSeed, entityType, entityId, purpose, profile, tags, parentStyleRef, relationshipType, variation,
    );
    if (styleProfile?.identity.entityType === 'culture') {
      identity.cultureId = styleProfile.identity.entityId;
    }
    result = generateProfiledFlag({
      seed: identity.variationSeed,
      profileId: profile.id,
      era,
      generator_version: FLAG_IDENTITY_CONFIG.generatorVersion,
      generation_context: {
        world_seed: worldSeed,
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
    if (!parent?.emblemSpec || result.flag.meta.visual_hash !== parent.emblemSpec.meta.visual_hash) break;
  }
  if (!result || !identity) throw new Error(`Не удалось создать эмблему ${entityType}:${entityId}.`);
  return {
    emblemSpec: result.flag,
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

export function ensureFlagIdentity<T extends FlaggedEntity>(
  worldSeed: number,
  entity: T,
  entityType: FlagEntityType,
  purpose: FlagGenerationPurpose,
  styleProfile?: FlagStyleProfile,
  parent?: FlaggedEntity | null,
  cityRank?: number,
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
            `${worldSeed}|${entityType}|${entity.id}|${purpose}`,
          ),
          entity.emblemSpec.tags,
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

  const generated = createEntityEmblem(worldSeed, entityType, entity.id, purpose, resolvedStyle, parent, cityRank);
  entity.emblemSpec = generated.emblemSpec;
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
            `${worldSeed}|${entityType}|${entity.id}|${purpose}`,
          ),
          entity.emblemSpec.tags,
        ),
        seed: String(entity.emblemSpec.seed),
        variationSeed: String(entity.emblemSpec.seed),
        generatorVersion: entity.emblemSpec.generator_version,
      },
    };
    entity.flagIdentity ??= entity.styleProfile.identity;
    return entity.styleProfile;
  }
  entity.styleProfile = createFlagStyleProfile(worldSeed, entityType, entity.id, purpose, tags, parent);
  entity.flagIdentity ??= entity.styleProfile.identity;
  return entity.styleProfile;
}

export function cultureTags(cultureId: number): string[] {
  return [...(FLAG_IDENTITY_CONFIG.cultureTagsById[cultureId] ?? [])];
}
