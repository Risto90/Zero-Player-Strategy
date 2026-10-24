import { createFamilyId, createPerson, familyNameForId, formatPersonName, legacyNameStyleForCulture, legacySurnameAffixForCulture, governmentOf, GOVERNMENTS, reservePersonId, type Person, type PersonNameContext, type SurnameAffix } from './government';
import type { Country, NomadGroup, World } from './world';
import { sampleDemographic } from './demography';
type Polity = Country | NomadGroup;

function isNomad(polity: Polity): polity is NomadGroup {
  return 'cells' in polity;
}

/** Keep both residence fields in sync when a person changes their current home. */
export function setPersonHome(p: Person, home: Polity | null): void {
  if (!home) {
    p.countryId = -1;
    p.nomadId = null;
  } else if (isNomad(home)) {
    p.countryId = -1;
    p.nomadId = home.id;
  } else {
    p.countryId = home.id;
    p.nomadId = null;
  }
}

function containsPerson(polity: Polity, p: Person): boolean {
  return isNomad(polity)
    ? polity.personIds.includes(p.id) || polity.ruler.id === p.id || polity.coRulerIds.includes(p.id)
    : p.countryId === polity.id || polity.ruler.id === p.id || polity.coRulerIds.includes(p.id);
}

export function person(world: World, id: number | null | undefined): Person | null {
  return id == null ? null : world.people.find((p) => p.id === id) ?? null;
}
export function registerPerson(world: World, country: Polity, p: Person): Person {
  const existing = person(world, p.id);
  const registered = existing ?? p;
  if (!existing) world.people.push(p);
  setPersonHome(registered, country);
  if (isNomad(country)) {
    if (!country.personIds.includes(registered.id)) country.personIds.push(registered.id);
  }
  return registered;
}
export function newCitizen(world: World, country: Polity, year: number): Person {
  const pair = sampleDemographic(world, country);
  const cultureId = pair?.cultureId ?? country.cultureId;
  const style = world.cultures[cultureId]?.nameStyleId ?? legacyNameStyleForCulture(cultureId);
  const p = createPerson(year, 29 + Math.floor(Math.random() * 17), createFamilyId(), [], cultureId, pair?.religionId ?? null, {
    style, familyCultureId: cultureId, surnameAffix: world.cultures[cultureId]?.surnameAffix ?? legacySurnameAffixForCulture(cultureId),
  });
  if (country.modifiers.includes('communist') && Math.random() < 0.5) {
    if (!p.traits.includes('Космополит')) p.traits.push('Космополит');
    p.trait = p.traits.join(', ');
  }
  if (country.modifiers.includes('patriarchal')) p.gender = 'male';
  if (country.modifiers.includes('matriarchal')) p.gender = 'female';
  p.name = formatPersonName(p.givenName, p.familyName, p.gender, { style });
  setPersonHome(p, country);
  return p;
}
function givenNameOf(p: Person): string {
  return (p.givenName || p.name.trim().split(/\s+/)[0] || 'Персонаж');
}
function parentNamingContext(world: World, child: Pick<Person, 'parents'>, style: PersonNameContext['style']): PersonNameContext {
  const parents = child.parents.map((id) => world.people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  const father = parents.find((p) => p.gender === 'male') ?? parents[1];
  const mother = parents.find((p) => p.gender === 'female') ?? parents.find((p) => p !== father);
  return {
    style,
    fatherGivenName: father ? givenNameOf(father) : undefined,
    paternalSurname: father?.familyName,
    maternalSurname: mother?.familyName,
  };
}
function normalizePerson(raw: Person, c: Polity, year: number, world: World): Person {
  const rawCultureId = Number.isFinite(raw.cultureId) ? raw.cultureId : c.cultureId;
  const style = world.cultures[rawCultureId]?.nameStyleId ?? legacyNameStyleForCulture(rawCultureId);
  const rawFamilyCultureId = Number.isFinite(raw.familyCultureId) ? raw.familyCultureId : undefined;
  const surnameCultureId = rawFamilyCultureId ?? rawCultureId;
  const template = createPerson(year, raw.age ?? 30, raw.familyId ?? createFamilyId(), raw.parents ?? [], rawCultureId, raw.religionId ?? c.religionId, {
    style, familyCultureId: surnameCultureId, surnameAffix: world.cultures[surnameCultureId]?.surnameAffix ?? legacySurnameAffixForCulture(surnameCultureId),
  });
  const p: Person = { ...template, ...raw };
  p.id = Number.isFinite(raw.id) ? raw.id : template.id;
  p.familyId = Number.isFinite(raw.familyId) ? raw.familyId : template.familyId;
  p.familyCultureId = rawFamilyCultureId;
  p.familyName = rawFamilyCultureId !== undefined && typeof raw.familyName === 'string'
    ? raw.familyName
    : template.familyName;
  p.givenName = raw.givenName || (raw.name || template.name).trim().split(/\s+/)[0] || template.givenName;
  p.cultureId = rawCultureId;
  p.parents = Array.isArray(raw.parents) ? [...raw.parents] : [];
  p.spouseIds = Array.isArray(raw.spouseIds) ? [...raw.spouseIds] : [];
  p.loverIds = Array.isArray(raw.loverIds) ? [...raw.loverIds] : [];
  p.friendIds = Array.isArray(raw.friendIds) ? [...raw.friendIds] : [];
  p.traits = Array.isArray(raw.traits) ? [...raw.traits] : [];
  p.formerRulerOf = Array.isArray(raw.formerRulerOf) ? [...raw.formerRulerOf] : [];
  reservePersonId(p.id); reservePersonId(p.familyId);
  const rawNomadId = Number.isInteger(raw.nomadId) && raw.nomadId! >= 0 ? raw.nomadId! : null;
  const normalizedNomadId = rawNomadId ?? (isNomad(c) ? c.id : null);
  const rawCountryId = Number.isFinite(raw.countryId) && raw.countryId >= 0 ? raw.countryId : null;
  const rawCountry = rawCountryId === null ? undefined : world.countries[rawCountryId];
  if (normalizedNomadId !== null && world.nomads[normalizedNomadId]) {
    setPersonHome(p, world.nomads[normalizedNomadId]);
  } else if (rawCountry?.pixels) {
    setPersonHome(p, rawCountry);
  } else if (isNomad(c)) {
    setPersonHome(p, c);
  } else if (c.pixels > 0) {
    setPersonHome(p, c);
  } else {
    setPersonHome(p, null);
  }
  p.name = formatPersonName(p.givenName, p.familyName, p.gender, parentNamingContext(world, p, style));
  return p;
}

/** Restore explicit nomad memberships and safely migrate legacy country-only residents. */
export function migrateNomadHomes(world: World): void {
  for (const nomad of world.nomads) {
    nomad.personIds ??= [];
    nomad.coRulerIds ??= [];
    for (const officeHolder of [nomad.ruler, nomad.heir].filter((p): p is Person => !!p)) {
      if (!world.people.some((p) => p.id === officeHolder.id)) world.people.push(officeHolder);
    }
    if (!nomad.personIds.length && nomad.sourceCountryId !== null &&
        world.countries[nomad.sourceCountryId]?.pixels === 0) {
      nomad.personIds = world.people
        .filter((candidate) => candidate.alive &&
          candidate.countryId === nomad.sourceCountryId &&
          candidate.cultureId === nomad.cultureId &&
          (nomad.religionId === null || candidate.religionId === nomad.religionId))
        .map((candidate) => candidate.id);
    }
    for (const id of [nomad.ruler.id, ...(nomad.heir ? [nomad.heir.id] : []), ...nomad.coRulerIds]) {
      if (!nomad.personIds.includes(id)) nomad.personIds.push(id);
    }
  }

  const memberships = new Map<number, NomadGroup[]>();
  for (const nomad of world.nomads) {
    for (const id of nomad.personIds) {
      const groups = memberships.get(id) ?? [];
      groups.push(nomad);
      memberships.set(id, groups);
    }
  }
  for (const p of world.people) {
    if (p.nomadId != null && !world.nomads[p.nomadId]) {
      const activeCountry = world.countries[p.countryId];
      setPersonHome(p, activeCountry?.pixels ? activeCountry : null);
    }
    const groups = memberships.get(p.id) ?? [];
    if (!groups.length) continue;
    const activeCountry = Number.isInteger(p.countryId) ? world.countries[p.countryId] : undefined;
    if ((activeCountry?.pixels ?? 0) > 0 || p.nomadId != null) continue;
    const home = groups.find((nomad) =>
      nomad.cultureId === p.cultureId &&
      (nomad.religionId === null || nomad.religionId === p.religionId),
    ) ?? groups[0];
    setPersonHome(p, home);
  }
}

/** Additive migration: keep legacy rulers/heirs and map the old empire/monarchy identifiers. */
export function normalizePolitics(world: World, year: number): void {
  migrateNomadHomes(world);
  for (const culture of world.cultures) {
    culture.nameStyleId ??= legacyNameStyleForCulture(culture.id);
    culture.surnameAffix ??= legacySurnameAffixForCulture(culture.id);
  }
  for (const p of world.people) { reservePersonId(p.id); reservePersonId(p.familyId); }
  const normalized = new Map<number, Person>();
  for (const c of world.countries) {
    delete (c as Country & { pendingDeathIds?: number[] }).pendingDeathIds;
    c.government = governmentOf(c.government).id;
    c.modifiers ??= [...GOVERNMENTS[c.government].modifiers];
    c.previousRulerIds ??= [];
    c.dynastyClaims ??= [];
    c.coRulerIds ??= [];
    c.termYears ??= 4; c.maxTerms ??= 1; c.consulCount ??= 2;
    c.seatSince ??= {}; c.termCounts ??= {}; c.barredRulerIds ??= []; c.pressures ??= {};
    const link = (raw: Person): Person => {
      if (Number.isFinite(raw.id) && normalized.has(raw.id)) return normalized.get(raw.id)!;
      const p = normalizePerson(raw, c, year, world);
      normalized.set(p.id, p);
      return p;
    };
    for (const p of world.people.filter((p) => p.countryId === c.id && c.pixels > 0)) link(p);
    c.ruler = link(c.ruler ?? createPerson(year, 30, createFamilyId(), [], c.cultureId, c.religionId, {
      style: world.cultures[c.cultureId]?.nameStyleId ?? legacyNameStyleForCulture(c.cultureId),
      familyCultureId: c.cultureId,
      surnameAffix: world.cultures[c.cultureId]?.surnameAffix ?? legacySurnameAffixForCulture(c.cultureId),
    }));
    if (c.heir) {
      c.heir = link(c.heir);
      // Older saves could contain a fabricated one-parent heir. Keep the person,
      // but do not preserve a false parent-child relationship or heir status.
      if (c.heir.parents.length < 2) {
        c.heir.parents = [];
        c.heir = null;
      } else {
        c.heir.familyId = c.ruler.familyId;
        c.heir.familyName = c.ruler.familyName;
        c.heir.familyCultureId = c.ruler.familyCultureId ?? c.ruler.cultureId;
        c.heir.name = formatPersonName(c.heir.givenName, c.heir.familyName, c.heir.gender,
          parentNamingContext(world, c.heir, world.cultures[c.heir.cultureId]?.nameStyleId ?? legacyNameStyleForCulture(c.heir.cultureId)));
        if (c.heir.countryId < 0 && c.pixels > 0 && c.heir.nomadId == null) setPersonHome(c.heir, c);
        if (!c.dynastyClaims.includes(c.heir.familyId)) c.dynastyClaims.push(c.heir.familyId);
      }
    }
    if (!c.ruler.formerRulerOf.includes(c.id)) c.ruler.formerRulerOf.push(c.id);
    if (!c.dynastyClaims.includes(c.ruler.familyId)) c.dynastyClaims.push(c.ruler.familyId);
    c.rulerSince ??= year;
    c.seatSince[c.ruler.id] ??= c.rulerSince;
    c.termCounts[c.ruler.id] ??= 1;
  }
  for (const nomad of world.nomads) {
    delete (nomad as NomadGroup & { pendingDeathIds?: number[] }).pendingDeathIds;
    nomad.personIds ??= [];
    nomad.coRulerIds ??= [];
    nomad.previousRulerIds ??= [];
    nomad.dynastyClaims ??= [];
    nomad.ruler = normalized.get(nomad.ruler.id) ?? nomad.ruler;
    nomad.heir = nomad.heir ? normalized.get(nomad.heir.id) ?? nomad.heir : null;
    for (const id of [nomad.ruler.id, ...nomad.coRulerIds]) {
      if (!nomad.personIds.includes(id)) nomad.personIds.push(id);
    }
    if (!nomad.ruler.formerRulerOf.includes(nomad.sourceCountryId ?? -1) && nomad.sourceCountryId !== null) {
      nomad.ruler.formerRulerOf.push(nomad.sourceCountryId);
    }
    if (!nomad.dynastyClaims.includes(nomad.ruler.familyId)) nomad.dynastyClaims.push(nomad.ruler.familyId);
    nomad.rulerSince ??= year;
  }
  const fallback = world.countries.find((country) => country.pixels > 0) ??
    world.countries[0] ?? world.nomads[0];
  for (const raw of world.people) {
    if (normalized.has(raw.id) || !fallback) continue;
    const home = raw.nomadId == null
      ? world.nomads.find((nomad) => nomad.personIds.includes(raw.id))
      : world.nomads[raw.nomadId];
    const country = raw.countryId >= 0 && world.countries[raw.countryId]?.pixels
      ? world.countries[raw.countryId]
      : undefined;
    const sourceCountry = home?.sourceCountryId == null
      ? undefined
      : world.countries[home.sourceCountryId];
    normalized.set(raw.id, normalizePerson(raw, home ?? country ?? sourceCountry ?? fallback, year, world));
  }
  for (const nomad of world.nomads) {
    nomad.ruler = normalized.get(nomad.ruler.id) ?? nomad.ruler;
    nomad.heir = nomad.heir ? normalized.get(nomad.heir.id) ?? nomad.heir : null;
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
  ensureUniqueDynastySurnames(world);
}

export function trackedForBirth(world: World, country: Polity, p: Person): boolean {
  const member = containsPerson(country, p);
  const inDynasty = country.dynastyClaims.includes(p.familyId) ||
    p.formerRulerOf.includes(isNomad(country) ? country.sourceCountryId ?? -1 : country.id) ||
    p.id === country.ruler.id || country.previousRulerIds.includes(p.id);
  if (!p.alive) return false;
  if (p.spouseIds.some((id) => {
    const spouse = person(world, id);
    return !!spouse && (country.dynastyClaims.includes(spouse.familyId) ||
      spouse.formerRulerOf.includes(isNomad(country) ? country.sourceCountryId ?? -1 : country.id));
  })) return true;
  if (p.loverIds.some((id) => {
    const lover = person(world, id);
    return !!lover && (country.dynastyClaims.includes(lover.familyId) ||
      lover.formerRulerOf.includes(isNomad(country) ? country.sourceCountryId ?? -1 : country.id));
  })) return true;
  return member || inDynasty;
}
/** Every living named person belonging to this country, independent of dynasty. */
export function countryCharacters(world: World, country: Country): Person[] {
  const rulers = new Set([country.ruler.id, ...country.coRulerIds]);
  return world.people
    .filter((p) => p.alive && (p.countryId === country.id || rulers.has(p.id)))
    .sort((a, b) => {
      const rank = (p: Person) => p.id === country.ruler.id ? 2 : country.coRulerIds.includes(p.id) ? 1 : 0;
      return rank(b) - rank(a) || b.age - a.age || a.name.localeCompare(b.name);
    });
}
/** Migrate family surnames, retain each family's cultural affix, and keep living dynasties distinct. */
export function ensureUniqueDynastySurnames(world: World): void {
  const membersByFamily = new Map<number, Person[]>();
  for (const p of world.people) {
    const members = membersByFamily.get(p.familyId) ?? [];
    members.push(p);
    membersByFamily.set(p.familyId, members);
  }
  const familyNames = new Map<number, string>();
  const familyCultures = new Map<number, number>();
  for (const [familyId, members] of membersByFamily) {
    const knownCulture = members.find((p) => Number.isFinite(p.familyCultureId))?.familyCultureId;
    const founder = knownCulture !== undefined
      ? members.find((p) => p.familyCultureId === knownCulture)!
      : [...members].sort((a, b) => a.bornAt - b.bornAt || a.id - b.id)[0];
    const familyCultureId = knownCulture ?? founder.cultureId;
    const affix = world.cultures[familyCultureId]?.surnameAffix ?? legacySurnameAffixForCulture(familyCultureId);
    const surname = knownCulture !== undefined
      ? (members.find((p) => p.familyCultureId === knownCulture && p.familyName)?.familyName ?? familyNameForId(familyId, familyCultureId, affix))
      : familyNameForId(familyId, familyCultureId, affix);
    familyCultures.set(familyId, familyCultureId);
    familyNames.set(familyId, surname);
  }
  const dynasties = new Set<number>();
  for (const country of world.countries) {
    dynasties.add(country.ruler.familyId);
    for (const familyId of country.dynastyClaims) dynasties.add(familyId);
  }
  for (const nomad of world.nomads) {
    dynasties.add(nomad.ruler.familyId);
    for (const familyId of nomad.dynastyClaims) dynasties.add(familyId);
  }
  const activeFamilies = [...dynasties].filter((id) => membersByFamily.get(id)?.some((p) => p.alive)).sort((a, b) => a - b);
  const usedNames = new Set<string>();
  for (const familyId of activeFamilies) {
    const familyCultureId = familyCultures.get(familyId) ?? 0;
    const affix = world.cultures[familyCultureId]?.surnameAffix ?? legacySurnameAffixForCulture(familyCultureId);
    let surname = familyNames.get(familyId)!;
    if (usedNames.has(surname)) {
      let variant = 1;
      while (usedNames.has(surname)) {
        surname = familyNameForId(familyId, familyCultureId, affix, variant);
        variant += 1;
      }
    }
    usedNames.add(surname);
    familyNames.set(familyId, surname);
  }
  for (const p of world.people) {
    const surname = familyNames.get(p.familyId);
    const familyCultureId = familyCultures.get(p.familyId);
    if (!surname || familyCultureId === undefined) continue;
    const changed = p.familyName !== surname;
    p.familyName = surname;
    p.familyCultureId = familyCultureId;
    if (changed) {
      const style = world.cultures[p.cultureId]?.nameStyleId ?? legacyNameStyleForCulture(p.cultureId);
      p.name = formatPersonName(givenNameOf(p), surname, p.gender, parentNamingContext(world, p, style));
    }
  }
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
export function canMarry(c: Polity, p: Person): boolean {
  if (!p.alive || p.age < 12) return false;
  if (p.age >= 20) return true;
  if (c.modifiers.includes('meritocracy') && (p.id === c.heir?.id || c.dynastyClaims.includes(p.familyId))) return false;
  return true;
}
export function arePartners(a: Person, b: Person): boolean {
  return (a.spouseIds.includes(b.id) && b.spouseIds.includes(a.id)) ||
    (a.loverIds.includes(b.id) && b.loverIds.includes(a.id));
}
export function marry(world: World, c: Polity, a: Person, b: Person, betrothal = false): void {
  const existing = person(world, b.id);
  const spouse = existing ?? b;
  if (!existing) world.people.push(spouse);
  const isForeignLeader = world.countries.some((other) => (isNomad(c) || other.id !== c.id) && other.pixels > 0 &&
    (other.ruler.id === spouse.id || other.coRulerIds.includes(spouse.id))) ||
    world.nomads.some((other) => other !== c &&
      (other.ruler.id === spouse.id || other.coRulerIds.includes(spouse.id)));
  if (!isForeignLeader) {
    if (isNomad(c)) {
      setPersonHome(spouse, c);
      if (!c.personIds.includes(spouse.id)) c.personIds.push(spouse.id);
    } else {
      setPersonHome(spouse, c);
    }
  }
  if (betrothal) { a.betrothedId = spouse.id; spouse.betrothedId = a.id; return; }
  if (!a.spouseIds.includes(spouse.id)) a.spouseIds.push(spouse.id);
  if (!spouse.spouseIds.includes(a.id)) spouse.spouseIds.push(a.id);
  a.betrothedId = null; spouse.betrothedId = null;
}
export function birth(world: World, c: Polity, mother: Person, father: Person, year: number): Person | null {
  if (!mother.alive || !father.alive || mother.gender !== 'female' || father.gender !== 'male' ||
      mother.age < 12 || mother.age > 45 || father.age < 12 || !arePartners(mother, father) ||
      related(world, mother, father) || mother.lastBirthYear === year) return null;
  const belongsToRulingFamily = (p: Person) => c.dynastyClaims.includes(p.familyId) || p.id === c.ruler.id || c.previousRulerIds.includes(p.id);
  const lineagePerson = belongsToRulingFamily(mother) ? mother : belongsToRulingFamily(father) ? father : mother;
  const lineage = lineagePerson.familyId;
  const cultureId = Math.random() < 0.5 ? mother.cultureId : father.cultureId;
  const style = world.cultures[cultureId]?.nameStyleId ?? legacyNameStyleForCulture(cultureId);
  const p = createPerson(year, 0, lineage, [mother.id, father.id], cultureId,
    Math.random() < 0.5 ? mother.religionId : father.religionId,
    { style, familyName: lineagePerson.familyName, familyCultureId: lineagePerson.familyCultureId ?? lineagePerson.cultureId,
      fatherGivenName: givenNameOf(father), paternalSurname: father.familyName, maternalSurname: mother.familyName });
  p.bornAt = year - Math.random(); p.age = 0; p.trait = ''; p.traits = [];
  mother.lastBirthYear = year;
  return registerPerson(world, c, p);
}
export function advancePeople(world: World, year: number): void {
  for (const p of world.people) {
    if (!p.alive) continue;
    const c = world.countries[p.countryId];
    const activeCountries = c && c.pixels > 0 ? [c] : [];
    const nomads = activeCountries.length ? [] : world.nomads.filter((group) =>
      group.personIds.includes(p.id) || group.ruler.id === p.id || group.coRulerIds.includes(p.id));
    if (!activeCountries.length && !nomads.length) continue;
    p.age = Math.max(p.age, Math.floor(year - p.bornAt));
  }
}
export function killPerson(world: World, p: Person, year: number, reason: string): void {
  p.alive = false; p.deathYear = year; p.deathReason = reason;
  const engaged = person(world, p.betrothedId);
  if (engaged) engaged.betrothedId = null;
  p.betrothedId = null;
}
