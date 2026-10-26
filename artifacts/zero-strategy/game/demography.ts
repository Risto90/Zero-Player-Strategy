import type { Country, World } from './world';
import { ensureCityPopulationGroups } from './settlements';
import { HUMAN_ORIGINS, canonicalizeHumanOrigins, humanOriginMixFromTable, type HumanOriginId, type HumanOriginMix } from './human';
import { ContourPopulationReader } from './contourPopulation';

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
  // Таблицы составов неизменны во время расчёта: один состав преобразуется ровно один раз.
  const originMixes = new Map<number, HumanOriginMix>();
  let population = 0;
  let ruralPopulation = 0;
  const addPopulationGroup = (cultureId: number, religionId: number | null, amount: number, originMixId: number) => {
    if (amount <= 0) return;
    population += amount;
    cultures.set(cultureId, (cultures.get(cultureId) ?? 0) + amount);
    religions.set(religionId, (religions.get(religionId) ?? 0) + amount);
    const key = `${cultureId}/${religionId}`;
    const entry = pairs.get(key);
    if (entry) entry.weight += amount;
    else pairs.set(key, { cultureId, religionId, weight: amount });
    let originMix = originMixes.get(originMixId);
    if (!originMix) {
      const originEntry = world.humanOriginTable.entries[originMixId];
      originMix = originEntry?.total === 100
        ? humanOriginMixFromTable(originEntry.ids, originEntry.shares)
        : { ids: [HUMAN_ORIGINS[0].id], shares: [100] };
      originMixes.set(originMixId, originMix);
    }
    originMix.ids.forEach((id, index) => {
      humanOrigins.set(id, (humanOrigins.get(id) ?? 0) + amount * originMix.shares[index] / 100);
    });
  };
  if (country.type === 'nomadic') {
    for (const cell of country.cells ?? []) {
      if (cell.population <= 0) continue;
      ruralPopulation += cell.population;
      const culture = world.cultureTable.entries[cell.cultureMix];
      const religion = world.religionTable.entries[cell.religionMix];
      const religionIds: (number | null)[] = [...religion.ids, null];
      const religionShares = [...religion.shares, 100 - religion.total];
      culture.ids.forEach((cultureId, ci) => {
        religionIds.forEach((religionId, ri) => {
          addPopulationGroup(cultureId, religionId,
            cell.population * culture.shares[ci] / 100 * religionShares[ri] / 100,
            cell.humanOriginMix ?? world.humanOriginTable.single(0, 100));
        });
      });
    }
  } else {
    new ContourPopulationReader(world, country).forEach((p, amount) => {
      ruralPopulation += amount;
      const city = world.cityAt(p);
      if (city) {
        for (const group of ensureCityPopulationGroups(world, city)) {
          addPopulationGroup(group.cultureId, group.religionId, group.population, group.humanOriginMix);
        }
        return;
      }
      const pixelPopulation = amount;
      const culture = world.cultureTable.entries[world.culture[p]];
      const religion = world.religionTable.entries[world.religion[p]];
      const religionIds: (number | null)[] = [...religion.ids, null];
      const religionShares = [...religion.shares, 100 - religion.total];
      culture.ids.forEach((cultureId, ci) => {
        religionIds.forEach((religionId, ri) => {
          addPopulationGroup(
            cultureId,
            religionId,
            pixelPopulation * culture.shares[ci] / 100 * religionShares[ri] / 100,
            world.humanOrigins[p] || world.humanOriginTable.single(0, 100),
          );
        });
      });
    });
  }
  const leading = <T,>(map: Map<T, number>, fallback: T): T => [...map].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
  const culture = leading(cultures, country.cultureId);
  const religion = leading(religions, country.religionId);
  const data: Demography = {
    pairs: [...pairs.values()], cultures, religions, population,
    density: ruralPopulation / Math.max(1, country.type === 'nomadic' ? country.range?.length ?? 0 : country.pixels),
    culture, religion,
    humanOrigin: canonicalizeHumanOrigins(humanOrigins),
    cultureFragmentation: cultures.size * (1 - (cultures.get(culture) ?? 0) / Math.max(1, population)),
    religionFragmentation: religions.size * (1 - (religions.get(religion) ?? 0) / Math.max(1, population)),
  };
  entries.set(key, { version: world.version, data });
  return data;
}

/** Draws only combinations that actually coexist on populated pixels, not independent country totals. */
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
      // Keep protected culture/religion distributions; equalise only unrestricted dimensions.
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
