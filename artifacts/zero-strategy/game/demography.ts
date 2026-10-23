import type { Country, World } from './world';

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
const cache = new WeakMap<World, Map<number, { version: number; data: Demography }>>();
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
  const cached = entries.get(country.id);
  if (cached?.version === world.version) return cached.data;
  const combinations = new Map<string, { culture: number; religion: number; population: number }>();
  world.forEachCountryPixel(country, (p) => {
    const culture = world.culture[p], religion = world.religion[p];
    const key = `${culture}/${religion}`;
    const entry = combinations.get(key);
    if (entry) entry.population += world.density[p];
    else combinations.set(key, { culture, religion, population: world.density[p] });
  });
  const pairs = new Map<string, DemographicPair>();
  const cultures = new Map<number, number>();
  const religions = new Map<number | null, number>();
  let population = 0;
  for (const item of combinations.values()) {
    population += item.population;
    const culture = world.cultureTable.entries[item.culture];
    const religion = world.religionTable.entries[item.religion];
    const religionIds: (number | null)[] = [...religion.ids, null];
    const religionShares = [...religion.shares, 100 - religion.total];
    culture.ids.forEach((c, ci) => {
      const pop = item.population * culture.shares[ci] / 100;
      cultures.set(c, (cultures.get(c) ?? 0) + pop);
      religionIds.forEach((r, ri) => {
        const weight = pop * religionShares[ri] / 100;
        if (weight <= 0) return;
        const key = `${c}/${r}`;
        const entry = pairs.get(key);
        if (entry) entry.weight += weight;
        else pairs.set(key, { cultureId: c, religionId: r, weight });
      });
    });
    religionIds.forEach((r, i) => religions.set(r, (religions.get(r) ?? 0) + item.population * religionShares[i] / 100));
  }
  const leading = <T,>(map: Map<T, number>, fallback: T): T => [...map].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
  const culture = leading(cultures, country.cultureId);
  const religion = leading(religions, country.religionId);
  const data: Demography = {
    pairs: [...pairs.values()], cultures, religions, population, density: population / Math.max(1, country.pixels),
    culture, religion,
    cultureFragmentation: cultures.size * (1 - (cultures.get(culture) ?? 0) / Math.max(1, population)),
    religionFragmentation: religions.size * (1 - (religions.get(religion) ?? 0) / Math.max(1, population)),
  };
  entries.set(country.id, { version: world.version, data });
  return data;
}

/** Draws only combinations that actually coexist on populated pixels, not independent country totals. */
export function sampleDemographic(world: World, c: Country): DemographicPair | null {
  const d = demography(world, c), mods = c.modifiers;
  let pairs = d.pairs;
  if (c.government === 'tribal' || mods.includes('ethnic')) pairs = pairs.filter((p) => p.cultureId === d.culture);
  if (mods.includes('theocracy') && c.government === 'republic') pairs = pairs.filter((p) => p.religionId === d.religion);
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
