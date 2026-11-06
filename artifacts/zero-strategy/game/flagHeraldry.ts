import { demography } from './demography';
import { ensureCityPopulationGroups } from './settlements';
import {
  compatibleFlagProfileIds,
  createEntityEmblem,
  selectFlagProfileId,
  type FlagGenerationSelection,
  type FlaggedEntity,
} from './flagIdentity';
import { flagStageRandom } from './random';
import type { City, Country, World } from './world';
import { buildFlagOutline } from './flagOutlines';
import { stampFlagHashes } from './flagNovelty';
import { assertValidFlagSpec, type FlagFrame, type FlagNode, type FlagSpec } from './flagSpec';
import { renderFlagSpec } from './flagRenderer';

type StyleSource = { id: number; profileId: string; tags: string[]; weight: number; kind: 'culture' | 'religion' };

function numericSeed(value: string | number): number {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parts = String(value).split('+').map((part) => Number(part.replace(/^\[|\]$/g, '')));
  if (parts.length > 1 && parts.every(Number.isFinite)) {
    return Math.round(parts.reduce((sum, part) => sum + part, 0) / parts.length);
  }
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function sourceWeights(
  world: World,
  city: City,
  country: Country,
): { cultures: Map<number, number>; religions: Map<number, number>; allowedCultureIds: Set<number> } {
  const groups = ensureCityPopulationGroups(world, city);
  const cultureResidents = new Map<number, number>();
  const religionResidents = new Map<number, number>();
  let atheistResidents = 0;
  for (const group of groups) {
    cultureResidents.set(group.cultureId, (cultureResidents.get(group.cultureId) ?? 0) + group.population);
    if (group.religionId === null) atheistResidents += group.population;
    else religionResidents.set(group.religionId, (religionResidents.get(group.religionId) ?? 0) + group.population);
  }

  const allowedCultureIds = new Set(cultureResidents.keys());
  if (country.government === 'tribal' && cultureResidents.size) {
    const ordered = [...cultureResidents].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    allowedCultureIds.clear();
    let included = 0;
    for (const [cultureId, residents] of ordered) {
      allowedCultureIds.add(cultureId);
      included += residents;
      if (included >= city.population / 2) break;
    }
  }

  const leadingReligionResidents = Math.max(0, ...religionResidents.values());
  const onlyCultures = atheistResidents > leadingReligionResidents ||
    (country.modifiers.includes('communist') && !country.modifiers.includes('theocracy'));
  const communist = country.modifiers.includes('communist');
  const liberal = country.modifiers.includes('liberal');
  const cultures = new Map<number, number>();
  const religions = new Map<number, number>();
  for (const [cultureId, residents] of cultureResidents) {
    if (!allowedCultureIds.has(cultureId)) continue;
    cultures.set(cultureId, communist ? 1 : residents / Math.max(1, city.population));
  }
  if (!onlyCultures) {
    for (const [religionId, residents] of religionResidents) {
      religions.set(religionId, liberal ? 1 : residents / Math.max(1, city.population));
    }
  }
  return { cultures, religions, allowedCultureIds };
}

function cityProfileSources(world: World, city: City, country: Country, era: number): StyleSource[] {
  const { cultures, religions } = sourceWeights(world, city, country);
  const result: StyleSource[] = [];
  for (const [id, weight] of cultures) {
    const style = world.cultures[id]?.styleProfile;
    if (style && compatibleFlagProfileIds(era, style.tags).includes(style.profileId)) {
      result.push({ id, profileId: style.profileId, tags: [...style.tags], weight, kind: 'culture' });
    }
  }
  for (const [id, weight] of religions) {
    const style = world.religions[id]?.styleProfile;
    if (style && compatibleFlagProfileIds(era, style.tags).includes(style.profileId)) {
      result.push({ id, profileId: style.profileId, tags: [...style.tags], weight, kind: 'religion' });
    }
  }
  return result;
}

function applyLeadershipWeights(
  world: World,
  country: Country,
  sources: StyleSource[],
): void {
  const data = demography(world, country);
  const leaderIds = [country.ruler.id, ...country.coRulerIds];
  const leaders = leaderIds.map((id) =>
    id === country.ruler.id ? country.ruler : world.people.find((person) => person.id === id),
  ).filter((person): person is NonNullable<typeof person> => !!person);
  for (const source of sources) {
    const isCulture = source.kind === 'culture';
    const nationalId = isCulture ? data.culture : data.religion;
    const nationalShare = nationalId === null ? 0 : isCulture
      ? (data.cultures.get(nationalId) ?? 0) / Math.max(1, data.population)
      : (data.religions.get(nationalId) ?? 0) / Math.max(1, data.population);
    let multiplier = 1;
    let leaderMultiplier = 0;

    if (isCulture && country.government === 'tribal' || isCulture && country.modifiers.includes('ethnic')) {
      const featureCount = Number(country.government === 'tribal') + Number(country.modifiers.includes('ethnic'));
      for (const leader of leaders) {
        if (leader.cultureId !== source.id) continue;
        const consul = country.modifiers.includes('consulate');
        const isRuler = consul || leader.id === country.ruler.id;
        leaderMultiplier += featureCount * (isRuler ? 3 : 2);
      }
    }
    if (!isCulture && country.modifiers.includes('theocracy')) {
      const featureCount = Number(country.government === 'tribal') + Number(country.modifiers.includes('ethnic'));
      for (const leader of leaders) {
        if (leader.religionId !== source.id) continue;
        const isRuler = country.modifiers.includes('consulate') || leader.id === country.ruler.id;
        leaderMultiplier += featureCount * (isRuler ? 3 : 2);
      }
    }
    if (leaderMultiplier > 0) multiplier = leaderMultiplier;
    if (country.modifiers.includes('ethnic') && source.id === nationalId) {
      multiplier *= nationalShare > 0.5 ? 5 : 2;
    }
    source.weight *= multiplier;
  }
}

export function createCityHeraldry(
  world: World,
  country: Country,
  city: City,
): ReturnType<typeof createEntityEmblem> {
  const era = country.styleProfile?.era;
  if (era === undefined) throw new Error(`У страны ${country.id} не задана эпоха флага.`);
  const profileSources = cityProfileSources(world, city, country, era);
  applyLeadershipWeights(world, country, profileSources);
  const weights: Record<string, number> = {};
  for (const source of profileSources) {
    weights[source.profileId] = (weights[source.profileId] ?? 0) + source.weight;
  }

  const seedBase = numericSeed(country.flagIdentity?.seed ?? country.styleProfile!.identity.seed);
  const requestedSeed = Math.round(seedBase) + world.currentMove + city.id;
  let profileId: string;
  if (!Object.keys(weights).length) {
    profileId = country.styleProfile!.profileId;
  } else {
    profileId = selectFlagProfileId(
      'city-coat',
      era,
      [],
      requestedSeed,
      weights,
    );
  }
  const generationSeed = world.generationSeedFor(era, profileId, requestedSeed);
  const selectedSource = profileSources.find((source) => source.profileId === profileId);
  const selection: FlagGenerationSelection = {
    era,
    profileId,
    generationSeed,
    ...(selectedSource ? { tags: selectedSource.tags } : {}),
  };
  const generated = createEntityEmblem(
    world.seed,
    'city',
    city.chronicleId,
    'city-coat',
    undefined,
    country,
    city.rank,
    world.flagSeed,
    selection,
  );
  const target = { ...city, ...generated };
  if (!composeDerivedEmblem(world, target, country, city, city.rank)) {
    world.reserveGeneratedFlag(era, profileId, target.flagIdentity?.seed ?? selection.generationSeed!);
  }
  return {
    emblemSpec: target.emblemSpec!,
    emblemSvg: target.emblemSvg!,
    flagIdentity: target.flagIdentity!,
    styleProfile: target.styleProfile!,
  };
}

export function selectWeightedValue<T>(
  values: readonly { value: T; weight: number }[],
  seed: string | number,
  stage: string,
): T | null {
  const valid = values.filter(({ weight }) => Number.isFinite(weight) && weight > 0);
  const total = valid.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) return null;
  let point = flagStageRandom(seed, stage)() * total;
  for (const entry of valid) {
    point -= entry.weight;
    if (point < 0) return entry.value;
  }
  return valid[valid.length - 1].value;
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compositeParts(seed: string | number): string[] {
  return String(seed).split('+').map((part) => part.replace(/^\[|\]$/g, ''));
}

function remapNodeSlots(node: FlagNode, slotMap: Record<string, string>): FlagNode {
  const visit = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) return value.map((entry) => visit(entry));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([childKey, child]) => {
        if (childKey === 'fill' && typeof child === 'string') return [childKey, slotMap[child] ?? child];
        if (childKey === 'slot_map' && child && typeof child === 'object') {
          return [childKey, Object.fromEntries(Object.entries(child).map(([source, target]) =>
            [slotMap[source] ?? source, typeof target === 'string' ? slotMap[target] ?? target : target]))];
        }
        return [childKey, visit(child, childKey)];
      }));
    }
    return value;
  };
  return visit(node) as FlagNode;
}

function compatibleDimensions(first: FlagSpec, second: FlagSpec): boolean {
  return Math.round(first.outline.aspect * 1200) === Math.round(second.outline.aspect * 1200);
}

function frameFromSpec(spec: FlagSpec, x0: number, y0: number): FlagFrame {
  const geometry = buildFlagOutline({
    type: spec.outline.type as Parameters<typeof buildFlagOutline>[0]['type'],
    params: spec.outline.params as Parameters<typeof buildFlagOutline>[0]['params'],
    aspect: spec.outline.aspect,
  });
  const polygons = [geometry.boundary, ...geometry.cutouts].map((polygon) =>
    polygon.map((point) => [point.x / geometry.width, point.y / geometry.height]));
  return {
    x0,
    y0,
    w: 0.5,
    h: 0.5,
    clip: [polygons],
    ground: copyJson(spec.root.ground),
    layers: copyJson(spec.root.layers),
  };
}

export function composeDerivedEmblem(
  world: World,
  target: FlaggedEntity,
  source: FlaggedEntity,
  parent?: FlaggedEntity,
  cityRank?: number,
): boolean {
  const targetSpec = target.emblemSpec;
  const sourceSpec = source.emblemSpec;
  if (!targetSpec || !sourceSpec || !compatibleDimensions(targetSpec, sourceSpec)) return false;
  const sourceParts = compositeParts(sourceSpec.seed);
  if (sourceParts.length >= 3) return false;
  const nestedSource = sourceParts.length > 1;
  const base = copyJson(nestedSource ? sourceSpec : targetSpec);
  const overlay = nestedSource ? targetSpec : sourceSpec;
  const slotMap: Record<string, string> = {};
  for (const slot of overlay.slots.items) {
    const hex = overlay.palette[slot]?.hex;
    if (!hex) throw new Error(`В эмблеме отсутствует цвет слота ${slot}.`);
    const matching = base.slots.items.find((candidate) =>
      base.palette[candidate]?.hex.toUpperCase() === hex.toUpperCase());
    if (matching) slotMap[slot] = matching;
    else {
      let id = `s${base.slots.items.length + 1}`;
      while (base.slots.items.includes(id)) id = `s${base.slots.items.length + 1}`;
      base.slots.items.push(id);
      base.palette[id] = { color_id: id, hex };
      slotMap[slot] = id;
    }
  }
  for (const [first, second] of overlay.slots.equalities) {
    const equality: [string, string] = [slotMap[first] ?? first, slotMap[second] ?? second];
    if (!base.slots.equalities.some(([a, b]) => a === equality[0] && b === equality[1])) {
      base.slots.equalities.push(equality);
    }
  }
  const frame = frameFromSpec(overlay, nestedSource ? 0.5 : 0, nestedSource ? 0.5 : 0);
  frame.ground = remapNodeSlots(frame.ground, slotMap);
  frame.layers = frame.layers.map((node) => remapNodeSlots(node, slotMap));
  base.root.layers.push({ kind: 'frame', frame });
  const seed = nestedSource
    ? `${sourceSpec.seed}+[${targetSpec.seed}]`
    : `[${targetSpec.seed}]+[${sourceSpec.seed}]`;
  if (world.hasGeneratedFlag(base.era, base.profile_id, seed)) {
    const identity = target.flagIdentity;
    if (!identity) throw new Error('Для повторного выбора сида отсутствует идентичность флага.');
    const uniqueSeed = world.generationSeedFor(
      targetSpec.era,
      identity.profileId,
      numericSeed(seed),
    );
    Object.assign(target, createEntityEmblem(
      identity.worldSeed,
      identity.entityType,
      identity.entityId,
      identity.generationPurpose,
      target.styleProfile,
      parent,
      cityRank,
      identity.flagSeed ?? world.flagSeed,
      {
        era: identity.era,
        profileId: identity.profileId,
        tags: identity.tags,
        generationSeed: uniqueSeed,
      },
    ));
    return false;
  }
  base.seed = seed;
  base.second_profile_id = overlay.profile_id;
  base.meta.color_count = base.slots.items.length;
  stampFlagHashes(base);
  assertValidFlagSpec(base);
  target.emblemSpec = base;
  target.emblemSvg = renderFlagSpec(base);
  if (target.flagIdentity) {
    target.flagIdentity.seed = seed;
    target.flagIdentity.variationSeed = seed;
  }
  if (target.styleProfile?.identity) {
    target.styleProfile.identity.seed = seed;
    target.styleProfile.identity.variationSeed = seed;
  }
  world.reserveGeneratedFlag(base.era, base.profile_id, seed);
  return true;
}
