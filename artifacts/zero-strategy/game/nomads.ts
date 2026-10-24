import { GOVERNMENTS, MODIFIERS } from './government';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, RANKS } from './config';
import { quantizeShares } from './composition';
import type { Country, NomadCell, NomadGroup, World } from './world';
import { forEachNeighbour } from './geography';
import { addCityAndConcentrate, cityInfluenceRadius } from './settlements';
import { appoint, successionOrder } from './succession';
import { newCitizen } from './characters';

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
      : memberships(cultureIds, probability, probability === 0).map((set) =>
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
  const createdGroups: SplitGroup[] = [];
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
      for (const entry of entries) {
        cultureMix.set(entry.cultureId, (cultureMix.get(entry.cultureId) ?? 0) + entry.population);
        if (entry.religionId !== null) {
          religionMix.set(entry.religionId, (religionMix.get(entry.religionId) ?? 0) + entry.population);
        }
      }
      cells.push({
        pixel,
        population: cellTotal,
        cultureMix: world.cultureTable.intern(quantizeShares(cultureMix, 100)),
        religionMix: world.religionTable.intern(
          new Map([...religionMix].map(([religionId, amount]) => [religionId, amount / cellTotal * 100])),
        ),
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
      density: country.density,
      cultureId: dominantCulture,
      religionId,
      cells,
      range: [...pixels],
      personIds: [],
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
    createdGroups.push(group);
  }

  for (const resident of world.people.filter((person) => person.countryId === country.id)) {
    let target = createdGroups.findIndex((group) =>
      group.cultures.has(resident.cultureId) && group.religions.has(resident.religionId));
    if (target < 0) target = createdGroups.findIndex((group) => group.cultures.has(resident.cultureId));
    if (target < 0 && created.length) target = 0;
    if (target >= 0 && !created[target].personIds.includes(resident.id)) {
      created[target].personIds.push(resident.id);
    }
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

export function availableNomadCitySites(world: World, nomad: NomadGroup): number[] {
  return nomad.range.filter((pixel) =>
    world.land[pixel] && world.owner[pixel] === 0 && !world.cityAt(pixel),
  );
}

/** Founding a town settles the nomad on the free portion of its influence sphere. */
export function settleNomadAsCountry(world: World, nomad: NomadGroup, cityPixel: number, year: number): Country | null {
  if (!availableNomadCitySites(world, nomad).includes(cityPixel)) return null;
  const proposedCity = {
    id: -1,
    countryId: -1,
    pixel: cityPixel,
    rank: 1 as const,
    population: 0,
    capital: true,
  };
  const radius = cityInfluenceRadius(world, proposedCity);
  const cx = cityPixel % MAP_WIDTH, cy = Math.floor(cityPixel / MAP_WIDTH);
  const radiusSquared = radius * radius;
  const territory = nomad.range.filter((pixel) => {
    const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
    return world.land[pixel] && world.owner[pixel] === 0 && !world.cityAt(pixel) &&
      (x - cx) ** 2 + (y - cy) ** 2 <= radiusSquared;
  });
  if (!territory.includes(cityPixel)) return null;

  const rank = [...RANKS].reverse().find((candidate) => candidate.ink <= territory.length) ?? RANKS[0];
  const country = world.newCountry({
    rank: rank.name,
    cultureId: nomad.cultureId,
    religionId: nomad.religionId,
    density: nomad.density,
    foundedYear: year,
    parentId: nomad.sourceCountryId,
    government: 'tribal',
  });
  const generatedRulerId = country.ruler.id;
  country.government = 'tribal';
  country.modifiers = [...new Set([
    ...GOVERNMENTS.tribal.modifiers,
    ...nomad.modifiers.filter((modifier) => MODIFIERS[modifier].forms?.includes('tribal') ?? true),
  ])];
  country.ruler = nomad.ruler;
  country.heir = successionOrder(world, nomad)[0] ?? null;
  country.rulerSince = nomad.rulerSince;
  country.previousRulerIds = [...nomad.previousRulerIds];
  country.dynastyClaims = [...nomad.dynastyClaims];
  country.coRulerIds = [...nomad.coRulerIds];
  country.termYears = nomad.termYears;
  country.maxTerms = nomad.maxTerms;
  country.consulCount = nomad.consulCount;
  country.seatSince = { ...nomad.seatSince };
  country.termCounts = { ...nomad.termCounts };
  country.barredRulerIds = [...nomad.barredRulerIds];
  country.pendingDeathIds = [...nomad.pendingDeathIds];
  country.pressures = Object.fromEntries(
    Object.entries(nomad.pressures).map(([key, pressure]) => [key, { ...pressure }]),
  );
  country.ruler.formerRulerOf = [...new Set([...country.ruler.formerRulerOf, country.id])];
  country.ruler.countryId = country.id;
  if (!country.dynastyClaims.includes(country.ruler.familyId)) country.dynastyClaims.push(country.ruler.familyId);
  world.people = world.people.filter((person) => person.id !== generatedRulerId);

  for (const pixel of territory) world.setOwner(pixel, country.id + 1);
  const destinations = new Set(territory);
  const nearest = new Int32Array(MAP_PIXELS).fill(-1);
  const queue = new Int32Array(MAP_PIXELS);
  let tail = 0;
  for (const pixel of territory) {
    nearest[pixel] = pixel;
    queue[tail++] = pixel;
  }
  for (let head = 0; head < tail; head += 1) {
    const pixel = queue[head];
    forEachNeighbour(pixel, (next) => {
      if (nearest[next] !== -1) return;
      nearest[next] = nearest[pixel];
      queue[tail++] = next;
    });
  }

  const additions = new Map<number, {
    population: number;
    cultures: Map<number, number>;
    religions: Map<number, number>;
  }>();
  const addMix = (totals: Map<number, number>, mixId: number, population: number, table: World['cultureTable']): void => {
    const entry = table.entries[mixId];
    for (let index = 0; index < entry.ids.length; index += 1) {
      const id = entry.ids[index];
      totals.set(id, (totals.get(id) ?? 0) + population * entry.shares[index] / 100);
    }
  };
  for (const cell of nomad.cells) {
    if (cell.population <= 0) continue;
    const destination = destinations.has(cell.pixel) ? cell.pixel : nearest[cell.pixel];
    if (destination < 0) continue;
    let addition = additions.get(destination);
    if (!addition) {
      addition = { population: 0, cultures: new Map(), religions: new Map() };
      additions.set(destination, addition);
    }
    addition.population += cell.population;
    addMix(addition.cultures, cell.cultureMix, cell.population, world.cultureTable);
    addMix(addition.religions, cell.religionMix, cell.population, world.religionTable as World['cultureTable']);
  }
  for (const [pixel, addition] of additions) {
    const existing = world.density[pixel];
    const total = existing + addition.population;
    const cultures = new Map<number, number>(), religions = new Map<number, number>();
    if (existing > 0) {
      addMix(cultures, world.culture[pixel], existing, world.cultureTable);
      addMix(religions, world.religion[pixel], existing, world.religionTable as World['cultureTable']);
    }
    for (const [id, amount] of addition.cultures) cultures.set(id, (cultures.get(id) ?? 0) + amount);
    for (const [id, amount] of addition.religions) religions.set(id, (religions.get(id) ?? 0) + amount);
    world.density[pixel] = total;
    world.culture[pixel] = world.cultureTable.intern(
      new Map([...cultures].map(([id, amount]) => [id, amount * 100 / total])),
    );
    world.religion[pixel] = world.religionTable.intern(
      new Map([...religions].map(([id, amount]) => [id, amount * 100 / total])),
    );
  }

  const nomadIndex = world.nomads.indexOf(nomad);
  if (nomadIndex >= 0) world.nomads.splice(nomadIndex, 1);
  world.nomads.forEach((item, index) => { item.id = index; });
  const transferredOffices = new Set([country.ruler.id, ...country.coRulerIds]);
  for (const other of world.nomads) {
    for (const leaderId of [other.ruler.id, ...other.coRulerIds]) {
      if (!transferredOffices.has(leaderId)) continue;
      const successor = successionOrder(world, other).find((person) =>
        person.id !== leaderId && !other.coRulerIds.includes(person.id) && person.id !== other.ruler.id) ??
        newCitizen(world, other, year);
      appoint(world, other, successor, year, leaderId);
    }
  }
  const city = addCityAndConcentrate(world, country.id, cityPixel, true);
  if (!city) throw new Error('Validated nomad city site became unavailable during settlement.');
  for (const personId of nomad.personIds) {
    const resident = world.people.find((person) => person.id === personId);
    if (!resident) continue;
    const belongsElsewhere = world.nomads.some((other) => other !== nomad &&
      (other.ruler.id === personId || other.personIds.includes(personId)));
    if (!belongsElsewhere) resident.countryId = country.id;
  }
  world.recountCountries();
  world.nomadVersion += 1;
  world.version += 1;
  return country;
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
