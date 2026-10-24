import type { Country, NomadGroup, World } from './world';
import { ensureCityPopulationGroups } from './settlements';

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
}
const cache = new WeakMap<World, Map<string, { version: number; data: Demography }>>();
export function weighted<T>(items: { value: T; weight: number }[], rng = Math.random): T | null {
  const total = items.reduce((n, x) => n + Math.max(0, x.weight), 0);
  if (!total) return null;
  let draw = rng() * total;
  for (const x of items) { draw -= Math.max(0, x.weight); if (draw < 0) return x.value; }
  return items[items.length - 1]?.value ?? null;
}
export function demography(world: World, country: Country | NomadGroup): Demography {
  let entries = cache.get(world);
  if (!entries) { entries = new Map(); cache.set(world, entries); }
  const key = 'cells' in country ? `nomad:${country.id}` : `country:${country.id}`;
  const cached = entries.get(key);
  if (cached?.version === world.version) return cached.data;
  const pairs = new Map<string, DemographicPair>();
  const cultures = new Map<number, number>();
  const religions = new Map<number | null, number>();
  let population = 0;
  let ruralPopulation = 0;
  const addPopulationGroup = (cultureId: number, religionId: number | null, amount: number) => {
    if (amount <= 0) return;
    population += amount;
    cultures.set(cultureId, (cultures.get(cultureId) ?? 0) + amount);
    religions.set(religionId, (religions.get(religionId) ?? 0) + amount);
    const key = `${cultureId}/${religionId}`;
    const entry = pairs.get(key);
    if (entry) entry.weight += amount;
    else pairs.set(key, { cultureId, religionId, weight: amount });
  };
  if ('cells' in country) {
    for (const cell of country.cells) {
      if (cell.population <= 0) continue;
      ruralPopulation += cell.population;
      const culture = world.cultureTable.entries[cell.cultureMix];
      const religion = world.religionTable.entries[cell.religionMix];
      const religionIds: (number | null)[] = [...religion.ids, null];
      const religionShares = [...religion.shares, 100 - religion.total];
      culture.ids.forEach((cultureId, ci) => {
        religionIds.forEach((religionId, ri) => {
          addPopulationGroup(cultureId, religionId,
            cell.population * culture.shares[ci] / 100 * religionShares[ri] / 100);
        });
      });
    }
  } else {
    world.forEachCountryPixel(country, (p) => {
      ruralPopulation += world.density[p];
      const city = world.cityAt(p);
      if (city) {
        for (const group of ensureCityPopulationGroups(world, city)) {
          addPopulationGroup(group.cultureId, group.religionId, group.population);
        }
        return;
      }
      const pixelPopulation = world.density[p];
      const culture = world.cultureTable.entries[world.culture[p]];
      const religion = world.religionTable.entries[world.religion[p]];
      const religionIds: (number | null)[] = [...religion.ids, null];
      const religionShares = [...religion.shares, 100 - religion.total];
      culture.ids.forEach((cultureId, ci) => {
        religionIds.forEach((religionId, ri) => {
          addPopulationGroup(cultureId, religionId, pixelPopulation * culture.shares[ci] / 100 * religionShares[ri] / 100);
        });
      });
    });
  }
  const leading = <T,>(map: Map<T, number>, fallback: T): T => [...map].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
  const culture = leading(cultures, country.cultureId);
  const religion = leading(religions, country.religionId);
  const data: Demography = {
    pairs: [...pairs.values()], cultures, religions, population,
    density: ruralPopulation / Math.max(1, 'cells' in country ? country.range.length : country.pixels),
    culture, religion,
    cultureFragmentation: cultures.size * (1 - (cultures.get(culture) ?? 0) / Math.max(1, population)),
    religionFragmentation: religions.size * (1 - (religions.get(religion) ?? 0) / Math.max(1, population)),
  };
  entries.set(key, { version: world.version, data });
  return data;
}

/** Draws only combinations that actually coexist on populated pixels, not independent country totals. */
export function sampleDemographic(world: World, c: Country | NomadGroup): DemographicPair | null {
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
