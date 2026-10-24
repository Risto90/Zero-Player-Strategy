import { GOVERNMENTS, MODIFIERS, availableModifiers, applyModifier, type GovernmentId, type GovernmentModifierId, type Person, type PoliticalState } from './government';
import { arePartners, canMarry, livingPartners, newCitizen, related, trackedForBirth } from './characters';
import { demography } from './demography';
import { person } from './characters';
import { candidateAllowed, successionOrder } from './succession';
import type { Country, World } from './world';
import { forEachNeighbour } from './geography';

function polityPeople(world: World, polity: Country): Person[] {
  return world.people.filter((p) => p.alive &&
    (p.countryId === polity.id || p.id === polity.ruler.id || polity.coRulerIds.includes(p.id)));
}

function adjacentNomadicCountries(world: World, country: Country): Set<Country> {
  const range = country.range ?? [];
  const ownPixels = new Set(range);
  const adjacentPixels = new Set<number>();
  for (const pixel of range) forEachNeighbour(pixel, (next) => adjacentPixels.add(next));
  return new Set(world.countries.filter((other) => other !== country && other.type === 'nomadic' &&
    (other.range ?? []).some((pixel) => ownPixels.has(pixel) || adjacentPixels.has(pixel))));
}

export interface ReformProposal {
  government?: GovernmentId;
  add?: GovernmentModifierId;
  remove?: GovernmentModifierId;
  termYears?: number;
  maxTerms?: number;
  consulCount?: number;
  weight: number;
  forced?: boolean;
}
const clamp = (v: number, lo = 0, hi = 1000) => Math.max(lo, Math.min(hi, v));
const trait = (p: Country['ruler'], value: string) => p.traits.includes(value) || p.trait === value;

export function reformCandidates(world: World, c: Country, year: number, violent = false): ReformProposal[] {
  if (c.government === 'tyranny' && !violent) return [];
  const d = demography(world, c), close = [...d.cultures.values()].sort((a, b) => b - a);
  const faiths = [...d.religions.values()].sort((a, b) => b - a);
  const faithfulPopulation = [...d.religions].reduce((total, [religionId, population]) =>
    total + (religionId === null ? 0 : population), 0);
  const canTheocracy = c.ruler.religionId !== null && faithfulPopulation > 0;
  const family = world.people.filter((p) => p.alive && c.dynastyClaims.includes(p.familyId));
  const relatives = successionOrder(world, c).length;
  const pressure = Object.values(c.pressures).filter((p) => p.until >= year).reduce((n, p) => n + p.strength, 0);
  const faithPressure = c.pressures.faith?.until >= year ? c.pressures.faith.strength : 0;
  const culturePressure = c.pressures.ethnic?.until >= year ? c.pressures.ethnic.strength : 0;
  const divCulture = d.cultureFragmentation, divFaith = d.religionFragmentation;
  const age = c.ruler.age, rulerTraits = c.ruler.traits;
  const density = Math.max(0.01, d.density), area = Math.max(1, c.type === 'nomadic' ? c.range?.length ?? 0 : c.pixels);
  const consulatePartition = c.modifiers.includes('consulate') && c.modifiers.includes('partition');
  const partitionForConsulate = c.modifiers.includes('partition');
  const cityCount = world.cities.filter((city) => city.countryId === c.id).length;
  const suitableRulerChildren = world.people.filter((p) =>
    p.parents.includes(c.ruler.id) && candidateAllowed(world, c, p, c.ruler, false, true)).length;
  const proposals: ReformProposal[] = [];

  if (violent) {
    for (const id of Object.keys(GOVERNMENTS) as GovernmentId[]) {
      if (id !== c.government) proposals.push({
        government: id,
        weight: id === 'tyranny' ? 2 + area / (density * 1200) + pressure : 1,
        forced: true,
      });
    }
  } else {
    const addForm = (id: GovernmentId, weight: number) => {
      if (id !== c.government && weight > 0) proposals.push({ government: id, weight });
    };
    {
      const leadingFaithWeight = d.pairs.filter((p) => p.cultureId === d.culture).reduce((n, p) => n + p.weight, 0);
      const leadingFaithDiversity = 1 - Math.max(0, ...d.pairs.filter((p) => p.cultureId === d.culture).map((p) => p.weight)) / Math.max(1, leadingFaithWeight);
      const tribalToHereditary = clamp((relatives + 1) * (1 + leadingFaithDiversity) / (density * (1 + divCulture)));
      const tribalToRepublic = clamp(density * (divCulture + divFaith) / area * 0.05);
      if (c.government === 'tribal') {
        addForm('hereditary', tribalToHereditary);
        addForm('republic', tribalToRepublic);
        addForm('tyranny', (area / (density * 1200) + pressure) * (trait(c.ruler, 'Решительный') ? 2 : 1));
      } else if (c.government === 'hereditary') {
        addForm('tribal', clamp(120_000 / (area * (family.length + 1))));
        addForm('republic', clamp(density * Math.max(divCulture, divFaith) / area * 0.05));
        addForm('tyranny', area / (density * 1200) + pressure);
      } else if (c.government === 'republic') {
        addForm('tribal', clamp(density * divCulture / (area * (1 + divFaith)) * 10_000));
        addForm('hereditary', clamp(area / (Math.max(1, family.length) * 12_000)));
        addForm('tyranny', area / (density * 1200) + pressure);
      }
    }
  }

  const addWeight = (id: GovernmentModifierId): number => {
    const topCultureShare = (d.cultures.get(d.culture) ?? 0) / Math.max(1, d.population);
    const topFaithShare = (d.religions.get(d.religion) ?? 0) / Math.max(1, d.population);
    const secondCulture = close[1] ?? 0, secondFaith = faiths[1] ?? 0;
    const familyCandidates = family.filter((p) => candidateAllowed(world, c, p)).length;
    let w = 1 + pressure;
    switch (id) {
      case 'theocracy':
        if (!canTheocracy) return 0;
        w *= (topFaithShare > 0.5 ? 2 : 0.5) * (topFaithShare > 2 * secondFaith ? 2 : 0.5);
        w *= 1 + faithPressure;
        if (c.ruler.religionId === d.religion) w *= 2;
        if (trait(c.ruler, 'Фанатик')) w *= 2;
        if (c.ruler.religionId === null || c.ruler.religionId !== d.religion) w *= 0.5;
        if (trait(c.ruler, 'Циник')) w *= 0.5;
        if (faiths.reduce((n, p) => n + p, 0) && (d.religions.get(null) ?? 0) / d.population >= 0.5) w *= 0.5;
        break;
      case 'ethnic':
        w *= (topCultureShare > 0.5 ? 2 : 0.5) * (topCultureShare > 2 * secondCulture ? 2 : 0.5);
        w *= 1 + culturePressure;
        if (c.ruler.cultureId === d.culture) w *= 2;
        if (trait(c.ruler, 'Националист')) w *= 2;
        if (trait(c.ruler, 'Космополит')) w *= 0.5;
        break;
      case 'liberal':
        w *= Math.max(1, d.cultures.size + d.religions.size) / Math.max(1, area / 2000);
        if (c.government === 'hereditary') w *= 0.5;
        if (c.government === 'republic') w *= 2;
        if (c.modifiers.includes('communist')) w *= 0.5;
        if (c.modifiers.includes('ethnic') || c.modifiers.includes('theocracy')) w *= 0.5;
        break;
      case 'communist':
        w *= (area / 5000 + divCulture + divFaith) * (d.religions.get(null) ?? 0) / Math.max(1, d.population);
        if (c.modifiers.includes('liberal')) w *= 2;
        if (c.government === 'hereditary') w *= 0.5;
        if (c.modifiers.includes('theocracy') && c.ruler.religionId === d.religion) w *= 0.5;
        else if (c.modifiers.includes('theocracy')) w *= 2;
        if (c.modifiers.includes('ethnic') && c.ruler.cultureId === d.culture) w *= 0.5;
        else if (c.modifiers.includes('ethnic')) w *= 2;
        break;
      case 'patriarchal':
      case 'matriarchal': {
        const sex = id === 'patriarchal' ? 'male' : 'female';
        w *= c.ruler.gender === sex ? 2 : 0;
        if (c.government === 'tribal' || c.government === 'hereditary') w *= 2;
        if (c.government === 'republic' || c.modifiers.includes('liberal') || c.modifiers.includes('communist')) w *= 0.5;
        if (c.modifiers.includes('theocracy')) w *= 2;
        const clergy = world.religions[d.religion ?? -1]?.traits ?? [];
        if (clergy.includes(id === 'patriarchal' ? 'maleClergy' : 'femaleClergy')) w *= trait(c.ruler, 'Фанатик') ? 3 : 2;
        const child = world.people.some((p) => p.parents.includes(c.ruler.id) && p.alive && p.gender === sex);
        if (!child && c.government !== 'republic') w = 0;
        break;
      }
      case 'meritocracy':
        if (c.government === 'republic') return 0;
        w *= c.government === 'tribal' ? 2 : c.government === 'hereditary' ? 0.5 : 1;
        if (c.modifiers.includes('seniority')) w *= 2;
        if (age < 20) w *= 2;
        break;
      case 'seniority':
        if (c.government === 'republic') return 0;
        w *= c.government === 'tribal' || c.government === 'tyranny' ? 2 : 1;
        if (c.modifiers.includes('meritocracy')) w *= 0.25;
        if (c.modifiers.includes('oligarchy')) return 0;
        if (age < 12) return 0;
        break;
      case 'minority':
        if (c.government === 'republic') return 0;
        if (age < 12) w *= 4; else if (age < 20) w *= 2; else if (age <= 65) w *= 0.5; else w *= 0.25;
        if (c.modifiers.includes('meritocracy')) w *= 2;
        if (c.modifiers.includes('seniority') || c.modifiers.includes('oligarchy')) return 0;
        break;
      case 'primogeniture':
        if (c.government === 'republic' || c.modifiers.includes('seniority')) return 0;
        w *= c.government === 'hereditary' ? 2 : c.government === 'tribal' ? 0.5 : 1;
        w *= Math.max(1, familyCandidates);
        break;
      case 'oligarchy':
        if (c.government === 'tyranny' || c.modifiers.includes('seniority') || c.modifiers.includes('minority')) return 0;
        w *= c.government === 'tribal' ? 2 : 1;
        break;
      case 'partition':
        if (c.government === 'republic' || c.government === 'tyranny' || c.modifiers.includes('coRule')) return 0;
        w *= c.government === 'tribal' ? 2 : 1;
        break;
      case 'pornocracy':
        if (c.government === 'republic') return 0;
        if (age >= 12 && age <= 19 || age >= 29 && age <= 45 || trait(c.ruler, 'Плодовитый')) w *= 2;
        if (c.modifiers.includes('patriarchal') || c.modifiers.includes('matriarchal')) w *= 2;
        if (c.government === 'tyranny') w *= 2;
        if (age < 12 || age > 65 || c.government === 'tribal') w *= 0.5;
        if (c.modifiers.includes('communist') || c.modifiers.includes('theocracy')) w *= 2;
        break;
      case 'term': return c.government === 'republic' ? 5 : 0;
      case 'termLimit': return c.government === 'republic' && c.modifiers.includes('term') ? 2 : 0;
      case 'continuous': return c.government === 'republic' && c.maxTerms >= 2 && c.modifiers.includes('termLimit') ? 2 : 0;
      case 'consulate':
        if (c.government === 'tyranny' || c.modifiers.includes('coRule')) return 0;
        w *= Math.max(1, d.cultureFragmentation + d.religionFragmentation);
        if (partitionForConsulate && !c.modifiers.includes('consulate')) {
          w *= suitableRulerChildren / Math.max(1, cityCount);
        }
        break;
      case 'federation':
        if ((c.government === 'tyranny' && !c.modifiers.includes('communist')) || c.modifiers.includes('confederation')) return 0;
        w *= divCulture + divFaith;
        if (c.government === 'tribal' || c.government === 'republic') w *= 2;
        if (c.modifiers.includes('consulate')) w *= 0.5;
        w *= 1 + pressure;
        break;
      case 'confederation':
        if (c.government !== 'tribal' && c.government !== 'hereditary' || c.modifiers.includes('federation')) return 0;
        w *= divCulture + divFaith;
        if (c.modifiers.includes('consulate')) w *= 0.25;
        if (c.modifiers.includes('federation')) w *= 2;
        w *= 1 + pressure;
        break;
      case 'coRule':
        if (c.government === 'republic' || c.government === 'tyranny' || c.modifiers.includes('consulate')) return 0;
        w *= familyCandidates;
        break;
    }
    if (c.government === 'tribal' && id !== 'patriarchal' && id !== 'matriarchal') w *= 0.5;
    if (id === 'oligarchy' && c.government === 'tribal') w *= 2;
    return Math.max(0, w);
  };
  const removeWeight = (id: GovernmentModifierId): number => {
    if (id === 'theocracy' && !canTheocracy) return 50;
    let w = addWeight(id);
    if (id === 'theocracy' && c.ruler.religionId !== d.religion && c.government !== 'tyranny' || id === 'ethnic' && c.ruler.cultureId !== d.culture) w *= 4;
    if (id === 'minority' && (age < 12 || age >= 66)) w *= 3;
    if (id === 'primogeniture' && c.government === 'tribal') w *= 2;
    if (id === 'oligarchy' && c.government === 'tribal') w *= 0.5;
    if (id === 'term') w = c.government === 'republic' ? 2 : 0;
    if (id === 'termLimit') w = c.government === 'republic' ? 1 : 0;
    if (id === 'continuous') w = c.government === 'republic' ? 1 : 0;
    if (id === 'communist') w *= 2;
    if ((id === 'theocracy' || id === 'ethnic') && c.modifiers.includes('communist')) w = 0;
    if ((id === 'patriarchal' || id === 'matriarchal') && c.modifiers.includes('communist')) w = 0;
    return Math.max(0.05, w) / (id === 'consulate' && consulatePartition ? c.consulCount : 1);
  };
  for (const id of availableModifiers(c.government, c.modifiers)) {
    if (id === 'communist' && !violent) continue;
    const weight = addWeight(id) * (violent ? 2 : 0.2);
    if (weight > 0) proposals.push({ add: id, weight, forced: violent });
  }
  for (const id of c.modifiers) {
    if (id === 'consulate' && c.consulCount !== 2) continue;
    const weight = removeWeight(id) * (violent ? 1 : 0.12);
    if (weight > 0) proposals.push({ remove: id, weight, forced: violent });
  }
  if (c.government === 'republic') {
    if (c.modifiers.includes('term')) proposals.push({ termYears: Math.min(12, c.termYears + 1), weight: 0.4 }, { termYears: Math.max(2, c.termYears - 1), weight: 0.4 });
    if (c.modifiers.includes('termLimit')) proposals.push({ maxTerms: Math.min(8, c.maxTerms + 1), weight: 0.3 }, { maxTerms: Math.max(1, c.maxTerms - 1), weight: 0.3 });
  }
  if (c.modifiers.includes('consulate')) {
    if (c.government !== 'tyranny' && c.consulCount < 7) {
      const weight = consulatePartition
        ? 0.35 * (suitableRulerChildren - c.consulCount) / Math.max(1, cityCount) / c.consulCount
        : 0.35;
      if (weight > 0) proposals.push({ consulCount: c.consulCount + 1, weight });
    }
    if (c.consulCount > 2) {
      const baseWeight = c.government === 'tyranny' ? 0.7 : 0.35;
      proposals.push({ consulCount: c.consulCount - 1,
        weight: consulatePartition ? baseWeight / c.consulCount : baseWeight });
    }
  }
  return proposals;
}

export function applyReform(c: PoliticalState, proposal: ReformProposal): void {
  if (proposal.government) {
    const old = c.government;
    c.government = proposal.government;
    const kept = c.modifiers.filter((m) => {
      if (old === 'tribal' && m === 'oligarchy') return false;
      if (old === 'hereditary' && m === 'primogeniture') return false;
      if (proposal.government === 'republic' && ['primogeniture', 'seniority', 'minority', 'partition', 'pornocracy', 'coRule', 'meritocracy', 'term', 'termLimit', 'continuous'].includes(m)) return false;
      if (proposal.government === 'hereditary' && m === 'communist') return false;
      if (proposal.government === 'tyranny' && ['oligarchy', 'partition', 'liberal'].includes(m)) return false;
      if (proposal.government === 'tyranny' && ['federation', 'confederation'].includes(m) && !c.modifiers.includes('communist')) return false;
      if (proposal.government === 'hereditary' && ['term', 'termLimit', 'continuous'].includes(m)) return false;
      return true;
    });
    const hasSuccessionLaw = kept.some((m) => ['primogeniture', 'seniority', 'minority', 'oligarchy'].includes(m));
    const baseline = GOVERNMENTS[c.government].modifiers.filter((m) => !(m === 'primogeniture' || m === 'oligarchy') || !hasSuccessionLaw);
    c.modifiers = [...new Set([...kept, ...baseline])];
    if (old === 'republic' && proposal.government !== 'republic') { c.barredRulerIds = []; c.termCounts = {}; }
    if (proposal.government !== 'republic') { c.barredRulerIds = []; c.termCounts = {}; }
  } else if (proposal.add) c.modifiers = applyModifier(c.modifiers, proposal.add);
  else if (proposal.remove) {
    c.modifiers = c.modifiers.filter((m) => m !== proposal.remove);
    if (proposal.remove === 'confederation' && c.government !== 'tyranny') c.modifiers = applyModifier(c.modifiers, 'federation');
    if (proposal.remove === 'term') c.modifiers = c.modifiers.filter((m) => m !== 'termLimit' && m !== 'continuous');
    if (proposal.remove === 'termLimit') c.modifiers = c.modifiers.filter((m) => m !== 'continuous');
  }
  if (proposal.termYears !== undefined) c.termYears = proposal.termYears;
  if (proposal.maxTerms !== undefined) c.maxTerms = proposal.maxTerms;
  if (proposal.consulCount !== undefined) c.consulCount = proposal.consulCount;
}

function neighbouringCountries(world: World, country: Country): Set<number> {
  const neighbours = new Set<number>();
  world.forEachCountryPixel(country, (pixel) => forEachNeighbour(pixel, (next) => {
    const owner = world.owner[next];
    if (owner > 0 && owner - 1 !== country.id) neighbours.add(owner - 1);
  }));
  return neighbours;
}

/** Eligible spouses are ranked by proximity/dynasty first, then by cultural and religious fit. */
export function marriageCandidates(world: World, country: Country, person: Person, year: number): Person[] {
  const neighbours = country.type === 'nomadic' ? null : neighbouringCountries(world, country);
  const neighbourNomads = country.type === 'nomadic' ? adjacentNomadicCountries(world, country) : null;
  const locals = new Set(polityPeople(world, country).map((p) => p.id));
  const knownPairs = new Set(demography(world, country).pairs.map((pair) => `${pair.cultureId}/${pair.religionId ?? 'none'}`));
  const candidates = world.people.filter((candidate) => {
    const isLocal = locals.has(candidate.id);
    const isNeighbour = country.type === 'nomadic'
      ? !!neighbourNomads && [...neighbourNomads].some((other) => other.id === candidate.countryId)
      : candidate.countryId !== country.id && !!neighbours?.has(candidate.countryId);
    if (candidate.id === person.id || candidate.gender === person.gender || !candidate.alive ||
        !canMarry(country, candidate) || candidate.spouseIds.some((id) => personWorldAlive(world, id)) ||
        candidate.betrothedId !== null || (!isLocal && !isNeighbour)) return false;
    if (person.spouseIds.some((id) => personWorldAlive(world, id)) || person.betrothedId !== null) return false;
    return !related(world, person, candidate);
  });
  const category = (candidate: Person) => {
    const sameCulture = candidate.cultureId === person.cultureId;
    const sameReligion = candidate.religionId === person.religionId;
    if (sameCulture && sameReligion) return 3;
    if (sameCulture || sameReligion) return 2;
    if (knownPairs.has(`${candidate.cultureId}/${candidate.religionId ?? 'none'}`)) return 1;
    return 0;
  };
  candidates.sort((a, b) => {
    const priority = (p: Person) => !locals.has(p.id) ? (p.familyId !== person.familyId ? 4 : 3) :
      (p.familyId !== person.familyId ? 2 : 1);
    return priority(b) - priority(a) || category(b) - category(a) || a.id - b.id;
  });
  const selected = candidates.slice(0, 2);
  while (selected.length < 2) {
    const generated = newCitizen(world, country, year);
    generated.age = Math.max(20, person.age + Math.floor(Math.random() * 11) - 5);
    generated.bornAt = year - generated.age - Math.random();
    if (generated.gender === person.gender) generated.gender = person.gender === 'male' ? 'female' : 'male';
    selected.push(generated);
  }
  return selected;
}

function personWorldAlive(world: World, id: number): boolean {
  return person(world, id)?.alive ?? false;
}

export function lifeOpportunity(world: World, c: Country, year: number): { kind: string; ids: number[]; weight: number; newPerson?: import('./government').Person } | null {
  const locals = polityPeople(world, c);
  const trackedLocals = locals.filter((p) => trackedForBirth(world, c, p));
  const birthParents = world.people.filter((p) => trackedForBirth(world, c, p) && p.alive);
  const activeSeats = [c.ruler, ...c.coRulerIds.map((id) => person(world, id)).filter((p): p is NonNullable<typeof p> => !!p)];
  const expiredSeat = activeSeats.find((p) => {
    const since = c.seatSince[p.id] ?? c.rulerSince;
    return ((c.government === 'republic' && c.modifiers.includes('term')) || c.modifiers.includes('consulate')) && year - since >= c.termYears;
  });
  if (expiredSeat) return { kind: 'election', ids: [expiredSeat.id], weight: 10000 };
  const events: { kind: string; ids: number[]; weight: number; newPerson?: Person }[] = [];
  for (const mother of birthParents.filter((p) => p.gender === 'female' && p.age >= 12 && p.age <= 45)) {
    if (mother.lastBirthYear === year) continue;
    const father = livingPartners(world, mother).find((p) => p.gender === 'male' && p.age >= 12 &&
      arePartners(mother, p) && !related(world, mother, p));
    if (!father) continue;
    const fertility = mother.age < 20 ? 0.12 : mother.age <= 45 ? 0.65 : 0;
    const maleFertility = father.age <= 45 ? 1 : father.age <= 65 ? 0.5 : 0.15;
    const fecundity = mother.traits.includes('Плодовитый') || father.traits.includes('Плодовитый') ? 2 : 1;
    events.push({ kind: 'birth', ids: [mother.id, father.id], weight: fertility * maleFertility * fecundity * 0.6 });
  }
  for (const p of trackedLocals.filter((x) => canMarry(c, x) || (x.age >= 8 && x.age < 12))) {
    const betrothed = person(world, p.betrothedId);
    if (betrothed?.alive && p.age >= 12 && betrothed.age >= 12 && canMarry(c, p) && canMarry(c, betrothed)) {
      events.push({ kind: 'marriage', ids: [p.id, betrothed.id], weight: 0.15 });
      continue;
    }
    if (p.betrothedId || p.spouseIds.some((id) => person(world, id)?.alive)) continue;
    const potential = locals.find((q) => q.id !== p.id && q.gender !== p.gender && canMarry(c, q) &&
      !q.spouseIds.includes(p.id) && !q.parents.includes(p.id) && !p.parents.includes(q.id) &&
      !q.parents.some((id) => p.parents.includes(id)) && !related(world, p, q));
    const isMinor = p.age < 20;
    if (potential && isMinor && !c.modifiers.includes('meritocracy')) {
      const marriageWeight = isMinor ? (p.age < 12 ? 0.005 : c.government === 'tribal' ? 0.06 : 0.02) : 0.1;
      events.push({ kind: isMinor ? 'engagement' : 'marriage', ids: [p.id, potential.id], weight: marriageWeight });
    }
    else if (!isMinor) {
      events.push({ kind: 'marriage', ids: [p.id], weight: 0.1 });
    } else if (p.age >= 8 && !c.modifiers.includes('meritocracy')) {
      const betrothed = newCitizen(world, c, year);
      betrothed.age = 8 + Math.floor(Math.random() * 4);
      betrothed.bornAt = year - betrothed.age - Math.random();
      if (betrothed.gender === p.gender) betrothed.gender = p.gender === 'male' ? 'female' : 'male';
      events.push({ kind: 'engagement', ids: [p.id], newPerson: betrothed, weight: 0.005 });
    }
  }
  const candidates = locals.filter((p) => p.age >= 8 && p.alive);
  const friendPair = candidates.flatMap((p, i) => candidates.slice(i + 1).map((q) => [p, q] as const))
    .find(([p, q]) => !p.friendIds.includes(q.id));
  if (friendPair) events.push({ kind: 'friendship', ids: [friendPair[0].id, friendPair[1].id], weight: 0.035 });
  const romancePair = locals.flatMap((p, i) => locals.slice(i + 1).filter((q) => q.gender !== p.gender && q.age >= 12 && p.age >= 12 &&
    !p.loverIds.includes(q.id) && !p.spouseIds.includes(q.id) && !related(world, p, q)).map((q) => [p, q] as const))[0];
  if (romancePair) events.push({ kind: 'romance', ids: [romancePair[0].id, romancePair[1].id], weight: romancePair[0].age < 20 || romancePair[1].age < 20 ? 0.015 : 0.03 });
  const traits = locals.filter((p) => p.age >= 3 && p.age < 18 && p.traits.length === 0);
  if (traits.length) events.push({ kind: 'trait', ids: [traits[0].id], weight: 0.08 });
  const total = events.reduce((n, x) => n + x.weight, 0);
  if (!events.length || Math.random() > Math.min(0.8, total)) return null;
  let draw = Math.random() * total;
  return events.find((e) => (draw -= e.weight) <= 0) ?? events[events.length - 1];
}
