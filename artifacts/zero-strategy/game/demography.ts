import type { Country, World } from './world';
import { ensureCityPopulationGroups } from './settlements';
import { HUMAN_ORIGINS, ancestryProfile, type HumanOriginId, type HumanOriginMix } from './human';
import { ContourPopulationReader } from './contourPopulation';
import { MAP_POINT_AREA_KM2, densityToResidents } from './populationUnits';
import {
  populationCohortsAtPixel,
  populationCohortsFromMixes,
  type PopulationCohortAmount,
} from './populationCohorts';

export interface DemographicPair { cultureId: number; religionId: number | null; weight: number }
export interface Demography {
  pairs: DemographicPair[];
  cultures: Map<number, number>;
  religions: Map<number | null, number>;
  population: number;
  density: number;
  culture: number;
  religion: number | null;
  cultureFragmentation: number;
  religionFragmentation: number;
  humanOrigin: HumanOriginMix;
  originProfiles: Map<number, number>;
  populationGroups: PopulationCohortAmount[];
}
const cache = new WeakMap<World, Map<string, { version: number; data: Demography }>>();
export function weighted<T>(items: { value: T; weight: number }[], rng = Math.random): T | null {
  const total = items.reduce((n, x) => n + Math.max(0, x.weight), 0);
  if (!total) return null;
  let draw = rng() * total;
  for (const x of items) { draw -= Math.max(0, x.weight); if (draw < 0) return x.value; }
  return items[items.length - 1]?.value ?? null;
}
export function demography(world: World, country: Country): Demography {
  let entries = cache.get(world);
  if (!entries) { entries = new Map(); cache.set(world, entries); }
  const key = `country:${country.id}`;
  const cached = entries.get(key);
  if (cached?.version === world.version) return cached.data;
  const pairs = new Map<string, DemographicPair>();
  const cultures = new Map<number, number>();
  const religions = new Map<number | null, number>();
  const humanOrigins = new Map<HumanOriginId, number>();
  const originProfiles = new Map<number, number>();
  const populationGroups = new Map<string, PopulationCohortAmount>();
  let population = 0;
  let ruralPopulation = 0;
  const addPopulationGroup = (
    cultureId: number,
    religionId: number | null,
    amount: number,
    originProfileId: number,
  ) => {
    if (amount <= 0) return;
    population += amount;
    cultures.set(cultureId, (cultures.get(cultureId) ?? 0) + amount);
    religions.set(religionId, (religions.get(religionId) ?? 0) + amount);
    const pairKey = `${cultureId}/${religionId}`;
    const entry = pairs.get(pairKey);
    if (entry) entry.weight += amount;
    else pairs.set(pairKey, { cultureId, religionId, weight: amount });
    const groupKey = `${cultureId}/${religionId ?? -1}/${originProfileId}`;
    const previous = populationGroups.get(groupKey);
    if (previous) previous.population += amount;
    else populationGroups.set(groupKey, { cultureId, religionId, originProfileId, population: amount });
    originProfiles.set(originProfileId, (originProfiles.get(originProfileId) ?? 0) + amount);
    const profile = ancestryProfile(originProfileId).mix;
    profile.ids.forEach((id, originIndex) => {
      humanOrigins.set(id, (humanOrigins.get(id) ?? 0) +
        amount * profile.shares[originIndex] / 100);
    });
  };
  if (country.type === 'nomadic') {
    for (const cell of country.cells ?? []) {
      const cellPopulation = densityToResidents(cell.density);
      if (cellPopulation <= 0) continue;
      ruralPopulation += cellPopulation;
      const cohorts = cell.populationGroups?.map((group) => ({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId: group.originProfileId,
        weight: cellPopulation * group.share / 100,
      })) ?? populationCohortsFromMixes(
        world,
        cell.cultureMix,
        cell.religionMix,
        cell.humanOriginMix ?? world.humanOriginTable.single(0, 100),
        cellPopulation,
      );
      for (const group of cohorts) {
        addPopulationGroup(group.cultureId, group.religionId, group.weight, group.originProfileId);
      }
    }
  } else {
    new ContourPopulationReader(world, country).forEach((p, density) => {
      ruralPopulation += density;
      const city = world.cityAt(p);
      if (city) {
        for (const group of ensureCityPopulationGroups(world, city)) {
          const origins = world.humanOriginTable.entries[group.humanOriginMix];
          if (origins?.total > 0) {
            origins.ids.forEach((originProfileId, index) => {
              addPopulationGroup(
                group.cultureId,
                group.religionId,
                group.population * origins.shares[index] / origins.total,
                originProfileId,
              );
            });
          } else {
            addPopulationGroup(group.cultureId, group.religionId, group.population, 0);
          }
        }
      }
      const pixelPopulation = densityToResidents(density);
      for (const group of populationCohortsAtPixel(world, p, pixelPopulation)) {
        addPopulationGroup(group.cultureId, group.religionId, group.weight, group.originProfileId);
      }
    });
  }
  const leading = <T,>(map: Map<T, number>, fallback: T): T => [...map].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
  const culture = leading(cultures, country.cultureId);
  const religion = leading(religions, country.religionId);
  const data: Demography = {
    pairs: [...pairs.values()], cultures, religions, population,
      density: ruralPopulation / Math.max(1, country.type === 'nomadic'
        ? (country.range?.length ?? 0) * MAP_POINT_AREA_KM2
        : country.pixels),
    culture, religion,
    humanOrigin: {
      ids: [...humanOrigins.keys()].sort((a, b) =>
        HUMAN_ORIGINS.findIndex((origin) => origin.id === a) - HUMAN_ORIGINS.findIndex((origin) => origin.id === b)),
      shares: [...humanOrigins.keys()].sort((a, b) =>
        HUMAN_ORIGINS.findIndex((origin) => origin.id === a) - HUMAN_ORIGINS.findIndex((origin) => origin.id === b))
        .map((id) => humanOrigins.get(id)! * 100 / Math.max(1, population)),
    },
    originProfiles,
    populationGroups: [...populationGroups.values()],
    cultureFragmentation: cultures.size * (1 - (cultures.get(culture) ?? 0) / Math.max(1, population)),
    religionFragmentation: religions.size * (1 - (religions.get(religion) ?? 0) / Math.max(1, population)),
  };
  entries.set(key, { version: world.version, data });
  return data;
}

/** Выбирает только сочетания групп, реально существующих в населённых точках. */
export function sampleDemographic(world: World, c: Country): DemographicPair | null {
  const d = demography(world, c), mods = c.modifiers;
  let pairs = d.pairs;
  const requiredCulture = c.government === 'tribal' || (mods.includes('ethnic') && c.government === 'republic')
    ? d.culture
    : mods.includes('ethnic') ? c.ruler.cultureId : null;
  const requiredFaith = c.government === 'republic' ? d.religion : c.ruler.religionId;
  if (c.government === 'tribal' || mods.includes('ethnic')) pairs = pairs.filter((p) => p.cultureId === requiredCulture);
  if (mods.includes('theocracy') && c.government !== 'tribal') pairs = pairs.filter((p) => p.religionId === requiredFaith);
  if (!pairs.length) return null;
  const cultureWeight = new Map<number, number>();
  for (const p of pairs) cultureWeight.set(p.cultureId, (cultureWeight.get(p.cultureId) ?? 0) + p.weight);
  return weighted(pairs.map((p) => {
    let weight = p.weight;
    if (mods.includes('communist')) weight = p.weight / (cultureWeight.get(p.cultureId) ?? 1) * (p.religionId === null ? 2 : 1);
    else if (mods.includes('liberal')) {
      // Сохраняет защищённые распределения культуры и веры; выравнивает только свободные измерения.
      weight = 1;
      if (c.government === 'tribal' || mods.includes('ethnic') || mods.includes('theocracy')) {
        const group = pairs.filter((x) => (mods.includes('theocracy') ? x.religionId === p.religionId : x.cultureId === p.cultureId));
        weight = p.weight / Math.max(1, group.reduce((n, x) => n + x.weight, 0));
      }
    }
    if (c.government === 'tribal' && mods.includes('theocracy')) {
      const oldCulturePairs = d.pairs.filter((x) => x.cultureId === c.ruler.cultureId);
      const leadingFaith = [...oldCulturePairs].sort((a, b) => b.weight - a.weight)[0]?.religionId;
      if (p.religionId === leadingFaith) weight *= 2;
      if (p.religionId === c.ruler.religionId) weight *= 2;
    }
    if (c.government === 'tyranny') {
      const culture = world.cultures[p.cultureId], religion = p.religionId === null ? null : world.religions[p.religionId];
      for (const group of [culture, religion]) {
        if (group?.traits?.includes('warlike')) weight *= 2;
        if (group?.traits?.includes('peaceful')) weight /= 2;
      }
    }
    return { value: p, weight };
  }));
}
