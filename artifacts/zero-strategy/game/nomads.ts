import { GOVERNMENTS, MODIFIERS } from './government';
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, RANKS } from './config';
import { quantizeShares } from './composition';
import { combineHumanOriginTableMixes } from './human';
import {
  populationCohortsAtPixel,
  populationCohortsFromMixes,
  setPopulationCohortsAtPixel,
  type PopulationCohortWeight,
} from './populationCohorts';
import { densityToResidents, residentsToDensity } from './populationUnits';
import { isActiveCountry, type Country, type NomadCell, type World } from './world';
import { forEachNeighbour } from './geography';
import { addCityAndConcentrate, cityInfluenceRadius } from './settlements';
import { appoint, closeRulerTerms, successionOrder, syncRulerTerms } from './succession';
import { newCitizen, registerPerson, setPersonHome } from './characters';

type Cohort = {
  cultureId: number;
  religionId: number | null;
  population: number;
  pixel: number;
  humanOriginMix: number;
};
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

/** Превращает население государства без территории в кочевые группы. */
export function dissolveCountryIntoNomadicCountries(
  world: World,
  country: Country,
  year = Math.floor(country.ruler.bornAt + country.ruler.age),
): Country[] {
  if (!country.pixels || country.type === 'nomadic') return [];
  const pixels: number[] = [];
  world.forEachCountryPixel(country, (pixel) => pixels.push(pixel));
  if (!pixels.length) return [];

  const cohorts: Cohort[] = [];
  const cultureTotals = new Map<number, number>();
  const religionTotals = new Map<number | null, number>();
  for (const pixel of pixels) {
    const density = world.density[pixel];
    if (density <= 0) continue;
    const residents = densityToResidents(density);
    for (const group of populationCohortsAtPixel(world, pixel, residents)) {
      if (group.weight <= 1e-9) continue;
      cohorts.push({
        cultureId: group.cultureId,
        religionId: group.religionId,
        population: group.weight,
        pixel,
        humanOriginMix: world.humanOriginTable.single(group.originProfileId, 100),
      });
      cultureTotals.set(group.cultureId, (cultureTotals.get(group.cultureId) ?? 0) + group.weight);
      religionTotals.set(group.religionId, (religionTotals.get(group.religionId) ?? 0) + group.weight);
    }
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
  const groups: SplitGroup[] = [];
  for (const cultures of cultureSplits) {
    const cultureSet = new Set(cultures);
    const religionsPresent = new Set<number | null>(cohorts
      .filter((cohort) => cultureSet.has(cohort.cultureId))
      .map((cohort) => cohort.religionId));
    const actualReligions = [...religionsPresent].filter((id): id is number => id !== null);
    let faithSplits: Set<number | null>[];
    if (!theocratic || !actualReligions.length) faithSplits = [new Set(religionsPresent)];
    else {
      faithSplits = memberships(actualReligions, probability, probability === 0);
      if (religionsPresent.has(null)) faithSplits[0].add(null);
    }
    for (const religions of faithSplits) groups.push({ cultures: cultureSet, religions });
  }

  const created: Country[] = [];
  const createdGroups: SplitGroup[] = [];
  const oldState = {
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
    pressures: { ...country.pressures },
  };
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
        density: residentsToDensity(cellTotal),
        cultureMix: world.cultureTable.intern(quantizeShares(cultureMix, 100)),
        religionMix: world.religionTable.intern(
          new Map([...religionMix].map(([religionId, amount]) => [religionId, amount / cellTotal * 100])),
        ),
        humanOriginMix: combineHumanOriginTableMixes(
          world.humanOriginTable,
          entries.map((entry) => ({ id: entry.humanOriginMix, weight: entry.population })),
        ),
        populationGroups: entries.map((entry) => ({
          cultureId: entry.cultureId,
          religionId: entry.religionId,
          originProfileId: world.humanOriginTable.entries[entry.humanOriginMix]?.ids[0] ?? 0,
          share: entry.population * 100 / cellTotal,
        })),
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
    const nomad = world.newCountry({
      rank: country.rank,
      cultureId: dominantCulture,
      religionId,
      density: country.density,
      foundedYear: country.foundedYear,
      parentId: country.id,
    });
    const generatedRulerId = nomad.ruler.id;
    Object.assign(nomad, {
      type: 'nomadic' as const,
      name,
      cells,
      range: [...pixels],
      sourceCountryId: country.id,
      pixels: 0,
      box: [MAP_WIDTH, MAP_HEIGHT, -1, -1] as Country['box'],
      government: 'tribal' as const,
      modifiers: [...new Set([...GOVERNMENTS.tribal.modifiers, ...validModifiers])],
      ruler: oldState.ruler,
      heir: oldState.heir,
      rulerSince: year,
      previousRulerIds: [...oldState.previousRulerIds],
      dynastyClaims: [...oldState.dynastyClaims],
      coRulerIds: [...oldState.coRulerIds],
      rulerTerms: [
        { personId: oldState.ruler.id, startYear: year, endYear: null, office: 'ruler' },
        ...oldState.coRulerIds.filter((id) => id !== oldState.ruler.id)
          .map((personId) => ({ personId, startYear: year, endYear: null, office: 'coRuler' as const })),
      ],
      termYears: oldState.termYears,
      maxTerms: oldState.maxTerms,
      consulCount: oldState.consulCount,
      seatSince: { ...oldState.seatSince },
      termCounts: { ...oldState.termCounts },
      barredRulerIds: [...oldState.barredRulerIds],
      pressures: { ...oldState.pressures },
    });
    nomad.seatSince[nomad.ruler.id] = year;
    for (const id of nomad.coRulerIds) nomad.seatSince[id] = year;
    world.people = world.people.filter((person) => person.id !== generatedRulerId);
    created.push(nomad);
    createdGroups.push(group);
  }

  for (const resident of world.people.filter((person) => person.countryId === country.id)) {
    let target = createdGroups.findIndex((group) =>
      group.cultures.has(resident.cultureId) && group.religions.has(resident.religionId));
    if (target < 0) target = createdGroups.findIndex((group) => group.cultures.has(resident.cultureId));
    if (target < 0 && created.length) target = 0;
    if (target >= 0 && resident.alive) setPersonHome(resident, created[target]);
  }
  for (let index = 1; index < created.length; index += 1) {
    const nomadicCountry = created[index];
    const ruler = newCitizen(world, nomadicCountry, year);
    registerPerson(world, nomadicCountry, ruler);
    nomadicCountry.ruler = ruler;
    nomadicCountry.heir = null;
    nomadicCountry.coRulerIds = [];
    nomadicCountry.rulerTerms = [{ personId: ruler.id, startYear: year, endYear: null, office: 'ruler' }];
    nomadicCountry.rulerSince = year;
    nomadicCountry.seatSince[ruler.id] = year;
    nomadicCountry.dynastyClaims = [ruler.familyId];
  }

  for (const pixel of pixels) {
    world.owner[pixel] = 0;
    world.density[pixel] = 0;
    world.culture[pixel] = 0;
    world.religion[pixel] = 0;
    world.humanOrigins[pixel] = 0;
    world.populationCohorts[pixel] = 0;
  }
  country.pixels = 0;
  closeRulerTerms(country, year);
  country.box = [MAP_WIDTH, 0, Math.floor(world.land.length / MAP_WIDTH), 0];
  world.recountCountries();
  world.version += 1;
  return created;
}

export function availableNomadCitySites(world: World, nomad: Country): number[] {
  return (nomad.range ?? []).filter((pixel) =>
    world.land[pixel] && world.owner[pixel] === 0 && !world.cityAt(pixel),
  );
}

/** Возвращает распущенную оседлую страну, которую ещё может возродить эта ветвь. */
export function nomadRevivalCountry(world: World, nomad: Country): Country | null {
  if (nomad.type !== 'nomadic' || !Number.isInteger(nomad.sourceCountryId)) return null;
  const source = world.countries[nomad.sourceCountryId as number];
  if (!source || source.id === nomad.id || source.type !== 'settled' || isActiveCountry(source)) return null;
  if (world.cities.some((city) => city.countryId === source.id)) return null;
  return source;
}

/** Основание города переводит то же государство из кочевого в оседлое. */
export function settleNomadAsCountry(
  world: World,
  nomad: Country,
  cityPixel: number,
  year: number,
  choice: 'revive' | 'new' = 'new',
): Country | null {
  if (nomad.type !== 'nomadic') return null;
  if (!availableNomadCitySites(world, nomad).includes(cityPixel)) return null;
  const revivedCountry = choice === 'revive' ? nomadRevivalCountry(world, nomad) : null;
  const settledCountry = revivedCountry ?? nomad;
  const proposedCity = {
    id: -1,
    chronicleId: -1,
    countryId: settledCountry.id,
    pixel: cityPixel,
    rank: 1 as const,
    population: 0,
    capital: true,
  };
  const radius = cityInfluenceRadius(world, proposedCity);
  const cx = cityPixel % MAP_WIDTH, cy = Math.floor(cityPixel / MAP_WIDTH);
  const radiusSquared = radius * radius;
  const territory = (nomad.range ?? []).filter((pixel) => {
    const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
    return world.land[pixel] && world.owner[pixel] === 0 && !world.cityAt(pixel) &&
      (x - cx) ** 2 + (y - cy) ** 2 <= radiusSquared;
  });
  if (!territory.includes(cityPixel)) return null;

  const rank = [...RANKS].reverse().find((candidate) => candidate.ink <= territory.length) ?? RANKS[RANKS.length - 1];
  const cells = nomad.cells ?? [];
  if (revivedCountry) {
    revivedCountry.rank = rank.name;
  } else {
    const heir = successionOrder(world, nomad)[0] ?? null;
    nomad.type = 'settled';
    nomad.rank = rank.name;
    nomad.foundedYear = year;
    nomad.modifiers = [...new Set([
      ...GOVERNMENTS.tribal.modifiers,
      ...nomad.modifiers.filter((modifier) => MODIFIERS[modifier].forms?.includes('tribal') ?? true),
    ])];
    nomad.heir = heir;
    delete nomad.range;
    delete nomad.cells;
    delete nomad.sourceCountryId;
  }
  for (const pixel of territory) world.setOwner(pixel, settledCountry.id + 1);
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

  const additions = new Map<number, { population: number; cohorts: PopulationCohortWeight[] }>();
  for (const cell of cells) {
    if (cell.density <= 0) continue;
    const population = densityToResidents(cell.density);
    const destination = destinations.has(cell.pixel) ? cell.pixel : nearest[cell.pixel];
    if (destination < 0) continue;
    let addition = additions.get(destination);
    if (!addition) {
      addition = { population: 0, cohorts: [] };
      additions.set(destination, addition);
    }
    addition.population += population;
    const cohorts = cell.populationGroups?.map((group) => ({
      cultureId: group.cultureId,
      religionId: group.religionId,
      originProfileId: group.originProfileId,
      weight: population * group.share / 100,
    })) ?? populationCohortsFromMixes(
      world,
      cell.cultureMix,
      cell.religionMix,
      cell.humanOriginMix ?? world.humanOriginTable.single(0, 100),
      population,
    );
    addition.cohorts.push(...cohorts);
  }
  for (const [pixel, addition] of additions) {
    const existing = densityToResidents(world.density[pixel]);
    const total = existing + addition.population;
    const cohorts = existing > 0 ? populationCohortsAtPixel(world, pixel, existing) : [];
    cohorts.push(...addition.cohorts);
    world.density[pixel] = residentsToDensity(total);
    setPopulationCohortsAtPixel(world, pixel, cohorts);
  }
  if (additions.size > 0) {
    let x0 = MAP_WIDTH, y0 = MAP_HEIGHT, x1 = -1, y1 = -1;
    for (const pixel of additions.keys()) {
      const x = pixel % MAP_WIDTH;
      const y = Math.floor(pixel / MAP_WIDTH);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    world.contours.changed({ x0, y0, x1, y1 }, ['density', 'culture', 'religion', 'humanOrigins']);
  }

  if (revivedCountry) {
    if (revivedCountry.ruler.id !== nomad.ruler.id) {
      appoint(world, revivedCountry, nomad.ruler, year);
    } else {
      setPersonHome(nomad.ruler, revivedCountry);
      revivedCountry.rulerSince = year;
      revivedCountry.seatSince[nomad.ruler.id] = year;
      syncRulerTerms(revivedCountry, year);
    }
  }
  for (const resident of world.people) {
    if (resident.countryId === nomad.id) setPersonHome(resident, settledCountry);
  }
  if (revivedCountry) {
    nomad.type = 'settled';
    nomad.pixels = 0;
    nomad.box = [MAP_WIDTH, MAP_HEIGHT, -1, -1];
    delete nomad.range;
    delete nomad.cells;
    delete nomad.sourceCountryId;
  }
  const transferredOffices = new Set([nomad.ruler.id, ...nomad.coRulerIds]);
  for (const other of world.countries.filter((item) => item.type === 'nomadic')) {
    for (const leaderId of [other.ruler.id, ...other.coRulerIds]) {
      if (!transferredOffices.has(leaderId)) continue;
      const successor = successionOrder(world, other).find((person) =>
        person.id !== leaderId && !other.coRulerIds.includes(person.id) && person.id !== other.ruler.id) ??
        newCitizen(world, other, year);
      appoint(world, other, successor, year, leaderId);
    }
  }
  const city = addCityAndConcentrate(world, settledCountry.id, cityPixel, true);
  if (!city) throw new Error('Validated nomad city site became unavailable during settlement.');
  world.recountCountries();
  world.version += 1;
  return settledCountry;
}

export function moveNomadCell(world: World, nomad: Country, pixel: number, amount: number): number {
  const current = nomad.cells?.find((cell) => cell.pixel === pixel);
  if (!current || amount <= 0) return 0;
    const moved = Math.min(current.density, amount);
    current.density -= moved;
    if (current.density <= 1e-9) nomad.cells = (nomad.cells ?? []).filter((cell) => cell.density > 1e-9);
  world.version += 1;
  return moved;
}
