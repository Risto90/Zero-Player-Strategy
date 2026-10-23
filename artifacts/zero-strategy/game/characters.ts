import { createFamilyId, createPerson, deathChance, governmentOf, GOVERNMENTS, reservePersonId, type Person } from './government';
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
      c.heir = link(c.heir); c.heir.familyId = c.ruler.familyId;
      if (!c.heir.parents.length) c.heir.parents = [c.ruler.id];
      if (c.heir.countryId < 0) c.heir.countryId = c.id;
      if (!c.dynastyClaims.includes(c.heir.familyId)) c.dynastyClaims.push(c.heir.familyId);
    }
    if (!c.ruler.formerRulerOf.includes(c.id)) c.ruler.formerRulerOf.push(c.id);
    if (!c.dynastyClaims.includes(c.ruler.familyId)) c.dynastyClaims.push(c.ruler.familyId);
    c.rulerSince ??= year;
    c.seatSince[c.ruler.id] ??= c.rulerSince;
    c.termCounts[c.ruler.id] ??= 1;
  }
  world.people = [...normalized.values()];
}

/** Births in tribes/republics are tracked for rulers themselves, not for unruled grandchildren. */
export function trackedForBirth(world: World, country: Country, p: Person): boolean {
  if (!p.alive || p.countryId !== country.id) return false;
  if (p.spouseIds.some((id) => {
    const spouse = person(world, id);
    return !!spouse && (country.dynastyClaims.includes(spouse.familyId) || spouse.formerRulerOf.includes(country.id));
  })) return true;
  if (country.government === 'hereditary' || country.government === 'tyranny') return country.dynastyClaims.includes(p.familyId);
  return p.formerRulerOf.includes(country.id) ||
    p.parents.some((id) => id === country.ruler.id || country.previousRulerIds.includes(id));
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
export function marry(world: World, c: Country, a: Person, b: Person, betrothal = false): void {
  registerPerson(world, c, b);
  if (betrothal) { a.betrothedId = b.id; b.betrothedId = a.id; return; }
  if (!a.spouseIds.includes(b.id)) a.spouseIds.push(b.id);
  if (!b.spouseIds.includes(a.id)) b.spouseIds.push(a.id);
  a.betrothedId = null; b.betrothedId = null;
}
export function birth(world: World, c: Country, mother: Person, father: Person, year: number): Person {
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
