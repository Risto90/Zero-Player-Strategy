import { GOVERNMENTS, MODIFIERS } from './government';
import { MAP_WIDTH } from './config';
import { quantizeShares } from './composition';
import type { Country, NomadCell, NomadGroup, World } from './world';

type Cohort = { cultureId: number; religionId: number | null; population: number; pixel: number };
type SplitGroup = { cultures: Set<number>; religions: Set<number | null> };

function memberships(values: (number | null)[], probability: number, forceSplit: boolean): Set<number | null>[] {
  if (forceSplit) return values.map((value) => new Set([value]));
  if (probability <= 0) return [new Set(values)];
  const separated: Set<number | null>[] = [];
  const combined = new Set<number | null>();
  for (const value of values) {
    if (Math.random() < probability) separated.push(new Set([value]));
    else combined.add(value);
  }
  if (combined.size) separated.push(combined);
  return separated.length ? separated : [new Set(values)];
}

function splitProbability(country: Country): number {
  if (country.modifiers.includes('confederation')) return 0.25;
  if (country.modifiers.includes('federation')) return 0.5;
  return 0;
}

/** Converts an area-less country's population into overlapping nomadic people. */
export function dissolveCountryIntoNomads(world: World, country: Country): NomadGroup[] {
  if (!country.pixels || world.nomads.some((group) => group.sourceCountryId === country.id && group.cells.length)) return [];
  const pixels: number[] = [];
  world.forEachCountryPixel(country, (pixel) => pixels.push(pixel));
  if (!pixels.length) return [];

  const cohorts: Cohort[] = [];
  const cultureTotals = new Map<number, number>();
  const religionTotals = new Map<number | null, number>();
  for (const pixel of pixels) {
    const density = world.density[pixel];
    if (density <= 0) continue;
    const culture = world.cultureTable.entries[world.culture[pixel]];
    const religion = world.religionTable.entries[world.religion[pixel]];
    const faithIds: (number | null)[] = [...religion.ids, null];
    const faithShares = [...religion.shares, 100 - religion.total];
    culture.ids.forEach((cultureId, ci) => {
      faithIds.forEach((religionId, ri) => {
        const population = density * culture.shares[ci] / 100 * faithShares[ri] / 100;
        if (population <= 1e-9) return;
        cohorts.push({ cultureId, religionId, population, pixel });
        cultureTotals.set(cultureId, (cultureTotals.get(cultureId) ?? 0) + population);
        religionTotals.set(religionId, (religionTotals.get(religionId) ?? 0) + population);
      });
    });
  }
  const cultureIds = [...cultureTotals.keys()].sort((a, b) => cultureTotals.get(b)! - cultureTotals.get(a)!);
  const faithIds = [...religionTotals.keys()].sort((a, b) => religionTotals.get(b)! - religionTotals.get(a)!);
  const ethnic = country.modifiers.includes('ethnic');
  const communist = country.modifiers.includes('communist');
  const probability = splitProbability(country);
  const cultureSplits: Set<number>[] = !cultureIds.length ? [] : ethnic
    ? cultureIds.map((id) => new Set([id]))
    : communist
      ? [new Set(cultureIds)]
      : memberships(cultureIds, probability, false).map((set) =>
          new Set([...set].filter((id): id is number => id !== null)),
        );
  const theocratic = country.modifiers.includes('theocracy');
  let faithSplits: Set<number | null>[];
  if (!theocratic) faithSplits = [new Set(faithIds)];
  else {
    const actualReligions = faithIds.filter((id): id is number => id !== null);
    faithSplits = actualReligions.length
      ? memberships(actualReligions, probability, probability === 0)
      : [new Set<number | null>()];
    if (faithIds.includes(null)) {
      const atheistGroup = faithSplits[0] ?? new Set<number | null>();
      atheistGroup.add(null);
      if (!faithSplits.length) faithSplits.push(atheistGroup);
    }
  }
  const groups: SplitGroup[] = [];
  for (const cultures of cultureSplits) for (const religions of faithSplits) groups.push({ cultures, religions });

  const created: NomadGroup[] = [];
  for (const group of groups) {
    const perPixel = new Map<number, Cohort[]>();
    const groupCultures = new Map<number, number>();
    const groupReligions = new Map<number, number>();
    let total = 0, faithful = 0;
    for (const cohort of cohorts) {
      if (!group.cultures.has(cohort.cultureId) || !group.religions.has(cohort.religionId)) continue;
      const cellCohorts = perPixel.get(cohort.pixel) ?? [];
      cellCohorts.push(cohort);
      perPixel.set(cohort.pixel, cellCohorts);
      groupCultures.set(cohort.cultureId, (groupCultures.get(cohort.cultureId) ?? 0) + cohort.population);
      if (cohort.religionId !== null) {
        groupReligions.set(cohort.religionId, (groupReligions.get(cohort.religionId) ?? 0) + cohort.population);
        faithful += cohort.population;
      }
      total += cohort.population;
    }
    if (total <= 1e-9) continue;
    const cells: NomadCell[] = [];
    for (const [pixel, entries] of perPixel) {
      const cellTotal = entries.reduce((sum, entry) => sum + entry.population, 0);
      const cultureMix = new Map<number, number>(), religionMix = new Map<number, number>();
      let cellFaithful = 0;
      for (const entry of entries) {
        cultureMix.set(entry.cultureId, (cultureMix.get(entry.cultureId) ?? 0) + entry.population);
        if (entry.religionId !== null) {
          religionMix.set(entry.religionId, (religionMix.get(entry.religionId) ?? 0) + entry.population);
          cellFaithful += entry.population;
        }
      }
      cells.push({
        pixel,
        population: cellTotal,
        cultureMix: world.cultureTable.intern(quantizeShares(cultureMix, 100)),
        religionMix: world.religionTable.intern(quantizeShares(religionMix, cellTotal > 0 ? cellFaithful / cellTotal * 100 : 0)),
      });
    }
    const dominantCulture = [...groupCultures].sort((a, b) => b[1] - a[1])[0][0];
    const cultureName = world.cultures[dominantCulture]?.name ?? country.name;
    const includedReligions = [...groupReligions.keys()];
    const religionId = includedReligions.length === 1 && faithful >= total * 0.999 ? includedReligions[0] : null;
    const suffix = religionId === null ? '' : ` · ${world.religions[religionId]?.name ?? ''}`;
    const name = group.cultures.size === 1 ? `${cultureName} кочевье${suffix}` : `${country.name} кочевье${suffix}`;
    const validModifiers = country.modifiers.filter((modifier) =>
      MODIFIERS[modifier].forms?.includes('tribal') ?? true,
    );
    const nomad: NomadGroup = {
      id: world.nomads.length,
      name,
      color: country.color,
      cultureId: dominantCulture,
      religionId,
      cells,
      range: [...pixels],
      sourceCountryId: country.id,
      pixels: pixels.length,
      government: 'tribal',
      modifiers: [...new Set([...GOVERNMENTS.tribal.modifiers, ...validModifiers])],
      ruler: country.ruler,
      heir: country.heir,
      rulerSince: country.rulerSince,
      previousRulerIds: [...country.previousRulerIds],
      dynastyClaims: [...country.dynastyClaims],
      coRulerIds: [...country.coRulerIds],
      termYears: country.termYears,
      maxTerms: country.maxTerms,
      consulCount: country.consulCount,
      seatSince: { ...country.seatSince },
      termCounts: { ...country.termCounts },
      barredRulerIds: [...country.barredRulerIds],
      pendingDeathIds: [...country.pendingDeathIds],
      pressures: { ...country.pressures },
    };
    world.nomads.push(nomad);
    created.push(nomad);
  }

  for (const pixel of pixels) {
    world.owner[pixel] = 0;
    world.density[pixel] = 0;
    world.culture[pixel] = 0;
    world.religion[pixel] = 0;
  }
  country.pixels = 0;
  country.box = [MAP_WIDTH, 0, Math.floor(world.land.length / MAP_WIDTH), 0];
  world.recountCountries();
  world.nomadVersion += 1;
  world.version += 1;
  return created;
}

export function moveNomadCell(world: World, nomad: NomadGroup, pixel: number, amount: number): number {
  const current = nomad.cells.find((cell) => cell.pixel === pixel);
  if (!current || amount <= 0) return 0;
  const moved = Math.min(current.population, amount);
  current.population -= moved;
  if (current.population <= 1e-9) nomad.cells = nomad.cells.filter((cell) => cell.population > 1e-9);
  nomadVersion(world);
  return moved;
}

export function nomadVersion(world: World): void {
  world.nomadVersion += 1;
  world.version += 1;
}
