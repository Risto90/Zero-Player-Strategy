import { createFamilyId, createPerson, deathChance, familyNameForId, governmentOf, GOVERNMENTS, reservePersonId, type Person } from './government';
import type { Country, World } from './world';
import { sampleDemographic } from './demography';

export function person(world: World, id: number | null | undefined): Person | null {
  return id == null ? null : world.people.find((p) => p.id === id) ?? null;
}
export function registerPerson(world: World, country: Country, p: Person): Person {
  const existing = person(world, p.id);
  if (existing) return existing;
  p.countryId = country.id;
  world.people.push(p);
  return p;
}
export function newCitizen(world: World, country: Country, year: number): Person {
  const pair = sampleDemographic(world, country);
  const p = createPerson(year, 29 + Math.floor(Math.random() * 17), createFamilyId(), [], pair?.cultureId ?? country.cultureId, pair?.religionId ?? null);
  if (country.modifiers.includes('communist') && Math.random() < 0.5) {
    if (!p.traits.includes('Космополит')) p.traits.push('Космополит');
    p.trait = p.traits.join(', ');
  }
  if (country.modifiers.includes('patriarchal')) p.gender = 'male';
  if (country.modifiers.includes('matriarchal')) p.gender = 'female';
  p.countryId = country.id;
  return p;
}
function normalizePerson(raw: Person, c: Country, year: number): Person {
  const template = createPerson(year, raw.age ?? 30, raw.familyId ?? createFamilyId(), raw.parents ?? [], raw.cultureId ?? c.cultureId, raw.religionId ?? c.religionId);
  const p: Person = { ...template, ...raw };
  p.id = Number.isFinite(raw.id) ? raw.id : template.id;
  p.familyId = Number.isFinite(raw.familyId) ? raw.familyId : template.familyId;
  p.familyName = familyNameForId(p.familyId);
  p.name = `${(raw.name || template.name).trim().split(/\s+/)[0]} ${p.familyName}`;
  p.parents = Array.isArray(raw.parents) ? [...raw.parents] : [];
  p.spouseIds = Array.isArray(raw.spouseIds) ? [...raw.spouseIds] : [];
  p.loverIds = Array.isArray(raw.loverIds) ? [...raw.loverIds] : [];
  p.friendIds = Array.isArray(raw.friendIds) ? [...raw.friendIds] : [];
  p.traits = Array.isArray(raw.traits) ? [...raw.traits] : [];
  p.formerRulerOf = Array.isArray(raw.formerRulerOf) ? [...raw.formerRulerOf] : [];
  reservePersonId(p.id); reservePersonId(p.familyId);
  p.countryId = Number.isFinite(raw.countryId) && raw.countryId >= 0 ? raw.countryId : c.id;
  return p;
}

/** Additive migration: keep legacy rulers/heirs and map the old empire/monarchy identifiers. */
export function normalizePolitics(world: World, year: number): void {
  for (const p of world.people) { reservePersonId(p.id); reservePersonId(p.familyId); }
  const normalized = new Map<number, Person>();
  for (const c of world.countries) {
    c.government = governmentOf(c.government).id;
    c.modifiers ??= [...GOVERNMENTS[c.government].modifiers];
    c.previousRulerIds ??= [];
    c.dynastyClaims ??= [];
    c.coRulerIds ??= [];
    c.termYears ??= 4; c.maxTerms ??= 1; c.consulCount ??= 2;
    c.seatSince ??= {}; c.termCounts ??= {}; c.barredRulerIds ??= []; c.pendingDeathIds ??= []; c.pressures ??= {};
    const link = (raw: Person): Person => {
      if (Number.isFinite(raw.id) && normalized.has(raw.id)) return normalized.get(raw.id)!;
      const p = normalizePerson(raw, c, year);
      normalized.set(p.id, p);
      return p;
    };
    for (const p of world.people.filter((p) => p.countryId === c.id)) link(p);
    c.ruler = link(c.ruler ?? createPerson(year, 30, createFamilyId(), [], c.cultureId, c.religionId));
    if (c.heir) {
      c.heir = link(c.heir);
      // Older saves could contain a fabricated one-parent heir. Keep the person,
      // but do not preserve a false parent-child relationship or heir status.
      if (c.heir.parents.length < 2) {
        c.heir.parents = [];
        c.heir = null;
      } else {
        c.heir.familyId = c.ruler.familyId;
        c.heir.familyName = familyNameForId(c.heir.familyId);
        c.heir.name = `${c.heir.name.split(/\s+/)[0]} ${c.heir.familyName}`;
        if (c.heir.countryId < 0) c.heir.countryId = c.id;
        if (!c.dynastyClaims.includes(c.heir.familyId)) c.dynastyClaims.push(c.heir.familyId);
      }
    }
    if (!c.ruler.formerRulerOf.includes(c.id)) c.ruler.formerRulerOf.push(c.id);
    if (!c.dynastyClaims.includes(c.ruler.familyId)) c.dynastyClaims.push(c.ruler.familyId);
    c.rulerSince ??= year;
    c.seatSince[c.ruler.id] ??= c.rulerSince;
    c.termCounts[c.ruler.id] ??= 1;
  }
  world.people = [...normalized.values()];
  // The old simulator stored both parents on each real birth but did not always
  // persist the relationship itself. Reconstruct a mutual love bond when needed.
  const byId = new Map(world.people.map((p) => [p.id, p]));
  for (const child of world.people) {
    if (child.parents.length < 2) {
      child.parents = [];
      continue;
    }
    const [a, b] = child.parents.slice(0, 2).map((id) => byId.get(id));
    if (!a || !b) continue;
    const married = a.spouseIds.includes(b.id) || b.spouseIds.includes(a.id);
    const lovers = a.loverIds.includes(b.id) || b.loverIds.includes(a.id);
    const relation = married ? a.spouseIds : lovers ? a.loverIds : a.loverIds;
    const reciprocal = married ? b.spouseIds : b.loverIds;
    if (!relation.includes(b.id)) relation.push(b.id);
    if (!reciprocal.includes(a.id)) reciprocal.push(a.id);
  }
}

export function trackedForBirth(world: World, country: Country, p: Person): boolean {
  if (!p.alive) return false;
  if (p.spouseIds.some((id) => {
    const spouse = person(world, id);
    return !!spouse && (country.dynastyClaims.includes(spouse.familyId) || spouse.formerRulerOf.includes(country.id));
  })) return true;
  if (p.loverIds.some((id) => {
    const lover = person(world, id);
    return !!lover && (country.dynastyClaims.includes(lover.familyId) || lover.formerRulerOf.includes(country.id));
  })) return true;
  return country.dynastyClaims.includes(p.familyId) || p.formerRulerOf.includes(country.id) ||
    p.id === country.ruler.id || country.previousRulerIds.includes(p.id);
}
export function familyOf(world: World, p: Person): Person[] {
  return world.people.filter((x) => x.familyId === p.familyId || p.parents.includes(x.id) || x.parents.includes(p.id) || p.spouseIds.includes(x.id));
}
export function livingPartners(world: World, p: Person): Person[] {
  return [...p.spouseIds, ...p.loverIds].map((id) => person(world, id)).filter((x): x is Person => !!x?.alive);
}
export function related(world: World, a: Person, b: Person): boolean {
  return a.id === b.id || a.parents.includes(b.id) || b.parents.includes(a.id) ||
    a.parents.some((id) => b.parents.includes(id)) ||
    a.parents.some((id) => person(world, id)?.parents.includes(b.id)) ||
    b.parents.some((id) => person(world, id)?.parents.includes(a.id));
}
export function canMarry(c: Country, p: Person): boolean {
  if (!p.alive || p.age < 12) return false;
  if (p.age >= 20) return true;
  if (c.modifiers.includes('meritocracy') && (p.id === c.heir?.id || c.dynastyClaims.includes(p.familyId))) return false;
  return true;
}
export function arePartners(a: Person, b: Person): boolean {
  return (a.spouseIds.includes(b.id) && b.spouseIds.includes(a.id)) ||
    (a.loverIds.includes(b.id) && b.loverIds.includes(a.id));
}
export function marry(world: World, c: Country, a: Person, b: Person, betrothal = false): void {
  const spouse = registerPerson(world, c, b);
  if (betrothal) { a.betrothedId = spouse.id; spouse.betrothedId = a.id; return; }
  if (!a.spouseIds.includes(spouse.id)) a.spouseIds.push(spouse.id);
  if (!spouse.spouseIds.includes(a.id)) spouse.spouseIds.push(a.id);
  const isForeignLeader = world.countries.some((other) => other.id !== c.id && other.pixels > 0 &&
    (other.ruler.id === spouse.id || other.coRulerIds.includes(spouse.id)));
  // Keep a foreign state's active ruler attached to that state until an actual
  // succession transfers power; ordinary spouses join the household.
  if (!isForeignLeader) spouse.countryId = c.id;
  a.betrothedId = null; spouse.betrothedId = null;
}
export function birth(world: World, c: Country, mother: Person, father: Person, year: number): Person | null {
  if (!mother.alive || !father.alive || mother.gender !== 'female' || father.gender !== 'male' ||
      mother.age < 12 || mother.age > 45 || father.age < 12 || !arePartners(mother, father) ||
      related(world, mother, father) || mother.lastBirthYear === year) return null;
  const belongsToRulingFamily = (p: Person) => c.dynastyClaims.includes(p.familyId) || p.id === c.ruler.id || c.previousRulerIds.includes(p.id);
  const lineage = belongsToRulingFamily(mother) ? mother.familyId : belongsToRulingFamily(father) ? father.familyId : mother.familyId;
  const p = createPerson(year, 0, lineage, [mother.id, father.id],
    Math.random() < 0.5 ? mother.cultureId : father.cultureId,
    Math.random() < 0.5 ? mother.religionId : father.religionId);
  p.bornAt = year - Math.random(); p.age = 0; p.trait = ''; p.traits = [];
  mother.lastBirthYear = year;
  return registerPerson(world, c, p);
}
export function advancePeople(world: World, year: number, rng = Math.random): void {
  for (const p of world.people) {
    if (!p.alive) continue;
    const c = world.countries[p.countryId];
    if (!c || c.pixels <= 0) continue;
    const previousAge = p.age;
    p.age = Math.max(previousAge, Math.floor(year - p.bornAt));
    // One mortality test per year; cumulative stage risks are spread over the whole stage.
    if (!c.pendingDeathIds.includes(p.id) && rng() < deathChance(previousAge)) c.pendingDeathIds.push(p.id);
  }
}
export function killPerson(world: World, p: Person, year: number, reason: string): void {
  p.alive = false; p.deathYear = year; p.deathReason = reason;
  const engaged = person(world, p.betrothedId);
  if (engaged) engaged.betrothedId = null;
  p.betrothedId = null;
  for (const c of world.countries) c.pendingDeathIds = c.pendingDeathIds.filter((id) => id !== p.id);
}
