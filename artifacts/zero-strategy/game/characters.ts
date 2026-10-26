import { createFamilyId, createPerson, familyNameForId, formatPersonName, legacyNameStyleForCulture, legacySurnameAffixForCulture, governmentOf, GOVERNMENTS, reservePersonId, type Person, type PersonNameContext, type RulerTerm, type SurnameAffix } from './government';
import { isActiveCountry, type Country, type World } from './world';
import { demography, sampleDemographic } from './demography';
import { inheritHumanOrigins, normalizeHumanOriginMix } from './human';

/** Каждое политическое образование — оседлое или кочевое — является страной с одним текущим ID. */
export function setPersonHome(p: Person, home: Country | null): void {
  p.countryId = home?.id ?? -1;
}

function containsPerson(country: Country, p: Person): boolean {
  return p.countryId === country.id || country.ruler.id === p.id || country.coRulerIds.includes(p.id);
}

export function person(world: World, id: number | null | undefined): Person | null {
  return id == null ? null : world.people.find((p) => p.id === id) ?? null;
}
export function registerPerson(world: World, country: Country, p: Person): Person {
  const existing = person(world, p.id);
  const registered = existing ?? p;
  if (!existing) world.people.push(p);
  setPersonHome(registered, country);
  return registered;
}
export function newCitizen(world: World, country: Country, year: number): Person {
  const pair = sampleDemographic(world, country);
  const origin = demography(world, country).humanOrigin;
  const cultureId = pair?.cultureId ?? country.cultureId;
  const style = world.cultures[cultureId]?.nameStyleId ?? legacyNameStyleForCulture(cultureId);
  const p = createPerson(year, 29 + Math.floor(Math.random() * 17), createFamilyId(), [], cultureId, pair?.religionId ?? null, {
    style, familyCultureId: cultureId, surnameAffix: world.cultures[cultureId]?.surnameAffix ?? legacySurnameAffixForCulture(cultureId),
  });
  p.humanOrigin = origin;
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
function normalizePerson(raw: Person, c: Country, year: number, world: World): Person {
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
  p.humanOrigin = normalizeHumanOriginMix(raw.humanOrigin);
  p.parents = Array.isArray(raw.parents) ? [...raw.parents] : [];
  p.spouseIds = Array.isArray(raw.spouseIds) ? [...raw.spouseIds] : [];
  p.loverIds = Array.isArray(raw.loverIds) ? [...raw.loverIds] : [];
  p.friendIds = Array.isArray(raw.friendIds) ? [...raw.friendIds] : [];
  p.traits = Array.isArray(raw.traits) ? [...raw.traits] : [];
  p.formerRulerOf = Array.isArray(raw.formerRulerOf) ? [...raw.formerRulerOf] : [];
  reservePersonId(p.id); reservePersonId(p.familyId);
  const rawCountryId = Number.isFinite(raw.countryId) && raw.countryId >= 0 ? raw.countryId : null;
  const rawCountry = rawCountryId === null ? undefined : world.countries[rawCountryId];
  if (rawCountry && (rawCountry.type === 'nomadic' || rawCountry.pixels > 0)) {
    setPersonHome(p, rawCountry);
  } else if (c.type === 'nomadic' || c.pixels > 0) {
    setPersonHome(p, c);
  } else {
    setPersonHome(p, null);
  }
  p.name = formatPersonName(p.givenName, p.familyName, p.gender, parentNamingContext(world, p, style));
  return p;
}

/** Проверяет, что общий familyId подтверждается связной цепочкой родства. */
function normalizeDynastyLineage(world: World): void {
  const byId = new Map(world.people.map((p) => [p.id, p]));
  const ordered = [...world.people].sort((a, b) => a.bornAt - b.bornAt || a.id - b.id);

  for (const p of ordered) {
    if (!p.parents.length) continue;
    const parents = p.parents.map((id) => byId.get(id));
    if (parents.length < 2 || parents.some((parent) => !parent)) {
      p.parents = [];
      continue;
    }
    const lineageParent = parents.find((parent) => parent?.familyId === p.familyId) ?? parents[0];
    if (lineageParent) p.familyId = lineageParent.familyId;
  }

  const membersByFamily = new Map<number, Person[]>();
  for (const p of world.people) {
    const members = membersByFamily.get(p.familyId) ?? [];
    members.push(p);
    membersByFamily.set(p.familyId, members);
  }

  for (const [familyId, members] of membersByFamily) {
    const memberIds = new Set(members.map((p) => p.id));
    const connected = new Map(members.map((p) => [p.id, new Set<number>()]));
    for (const child of members) {
      for (const parentId of child.parents) {
        const parent = byId.get(parentId);
        if (!parent || parent.familyId !== familyId || !memberIds.has(parentId)) continue;
        connected.get(child.id)!.add(parentId);
        connected.get(parentId)!.add(child.id);
      }
    }

    const components: Person[][] = [];
    const visited = new Set<number>();
    for (const member of members) {
      if (visited.has(member.id)) continue;
      const component: Person[] = [];
      const queue = [member.id];
      visited.add(member.id);
      for (let head = 0; head < queue.length; head += 1) {
        const current = byId.get(queue[head]);
        if (current) component.push(current);
        for (const relatedId of connected.get(queue[head]) ?? []) {
          if (visited.has(relatedId)) continue;
          visited.add(relatedId);
          queue.push(relatedId);
        }
      }
      components.push(component);
    }

    components.sort((a, b) => {
      const firstA = a.reduce((first, p) => p.bornAt < first.bornAt ||
        (p.bornAt === first.bornAt && p.id < first.id) ? p : first, a[0]);
      const firstB = b.reduce((first, p) => p.bornAt < first.bornAt ||
        (p.bornAt === first.bornAt && p.id < first.id) ? p : first, b[0]);
      return firstA.bornAt - firstB.bornAt || firstA.id - firstB.id;
    });

    for (const component of components.slice(1)) {
      const newFamilyId = createFamilyId();
      for (const p of component) {
        p.familyId = newFamilyId;
        delete p.familyCultureId;
      }
    }
  }
}

/** Дополняющая миграция: сохраняет прежних правителей и наследников и сопоставляет старые формы правления. */
export function normalizePolitics(world: World, year: number): void {
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
    for (const p of world.people.filter((p) => p.countryId === c.id && (c.pixels > 0 || c.type === 'nomadic'))) link(p);
    c.ruler = link(c.ruler ?? createPerson(year, 30, createFamilyId(), [], c.cultureId, c.religionId, {
      style: world.cultures[c.cultureId]?.nameStyleId ?? legacyNameStyleForCulture(c.cultureId),
      familyCultureId: c.cultureId,
      surnameAffix: world.cultures[c.cultureId]?.surnameAffix ?? legacySurnameAffixForCulture(c.cultureId),
    }));
    if (c.heir) {
      c.heir = link(c.heir);
      // В старых сохранениях мог быть выдуманный наследник с одним родителем.
      // Персонажа сохраняем, но не оставляем ложную связь родителя с ребёнком и статус наследника.
      if (c.heir.parents.length < 2) {
        c.heir.parents = [];
        c.heir = null;
      } else {
        c.heir.name = formatPersonName(c.heir.givenName, c.heir.familyName, c.heir.gender,
          parentNamingContext(world, c.heir, world.cultures[c.heir.cultureId]?.nameStyleId ?? legacyNameStyleForCulture(c.heir.cultureId)));
        if (c.heir.countryId < 0 && (c.pixels > 0 || c.type === 'nomadic')) setPersonHome(c.heir, c);
        if (!c.dynastyClaims.includes(c.heir.familyId)) c.dynastyClaims.push(c.heir.familyId);
      }
    }
    if (!c.ruler.formerRulerOf.includes(c.id)) c.ruler.formerRulerOf.push(c.id);
    if (!c.dynastyClaims.includes(c.ruler.familyId)) c.dynastyClaims.push(c.ruler.familyId);
    c.rulerSince ??= year;
    c.seatSince[c.ruler.id] ??= c.rulerSince;
    c.termCounts[c.ruler.id] ??= 1;
  }
  const fallback = world.countries.find(isActiveCountry) ?? world.countries[0];
  for (const raw of world.people) {
    if (normalized.has(raw.id) || !fallback) continue;
    const country = raw.countryId >= 0 && world.countries[raw.countryId]?.pixels
      ? world.countries[raw.countryId]
      : undefined;
    const currentCountry = raw.countryId >= 0 ? world.countries[raw.countryId] : undefined;
    normalized.set(raw.id, normalizePerson(raw, currentCountry ?? country ?? fallback, year, world));
  }
  world.people = [...normalized.values()];
  for (const c of world.countries) {
    const rawTerms = (c as Country & { rulerTerms?: unknown }).rulerTerms;
    const terms: RulerTerm[] = Array.isArray(rawTerms) ? rawTerms.flatMap((raw): RulerTerm[] => {
      if (!raw || typeof raw !== 'object') return [];
      const term = raw as Partial<RulerTerm>;
      if (!Number.isFinite(term.personId) ||
        (term.office !== 'ruler' && term.office !== 'coRuler') ||
        (term.startYear !== null && !Number.isFinite(term.startYear)) ||
        (term.endYear !== null && !Number.isFinite(term.endYear))) return [];
      return [{
        personId: term.personId!,
        startYear: term.startYear ?? null,
        endYear: term.endYear ?? null,
        office: term.office,
      }];
    }) : [];
    const active = new Map<number, 'ruler' | 'coRuler'>([[c.ruler.id, 'ruler']]);
    for (const id of c.coRulerIds) if (!active.has(id)) active.set(id, 'coRuler');
    const known = new Set([
      ...(Array.isArray(rawTerms) ? [] : c.previousRulerIds),
      ...world.people.filter((p) => p.formerRulerOf.includes(c.id)).map((p) => p.id),
      ...active.keys(),
    ]);
    const represented = new Set(terms.map((term) => term.personId));
    for (const id of known) {
      if (represented.has(id)) continue;
      const office = active.get(id) ?? 'ruler';
      const savedYear = c.seatSince[id] ?? (id === c.ruler.id ? c.rulerSince : null);
      terms.push({
        personId: id,
        startYear: Number.isFinite(savedYear) ? savedYear : null,
        endYear: null,
        office,
      });
      represented.add(id);
    }
    for (const [id, office] of active) {
      if (terms.some((term) => term.personId === id && term.office === office && term.endYear === null)) continue;
      const savedYear = c.seatSince[id] ?? (office === 'ruler' ? c.rulerSince : null);
      terms.push({
        personId: id,
        startYear: Number.isFinite(savedYear) ? savedYear : null,
        endYear: null,
        office,
      });
    }
    c.rulerTerms = terms;
  }
  // Прежний симулятор записывал обоих родителей при рождении, но не всегда
  // сохранял их отношения. При необходимости восстанавливаем взаимную любовную связь.
  const byId = new Map(world.people.map((p) => [p.id, p]));
  for (const child of world.people) {
    if (child.parents.length < 2) {
      child.parents = [];
      continue;
    }
    const [a, b] = child.parents.slice(0, 2).map((id) => byId.get(id));
    if (!a || !b) {
      child.parents = [];
      continue;
    }
    const married = a.spouseIds.includes(b.id) || b.spouseIds.includes(a.id);
    const lovers = a.loverIds.includes(b.id) || b.loverIds.includes(a.id);
    const relation = married ? a.spouseIds : lovers ? a.loverIds : a.loverIds;
    const reciprocal = married ? b.spouseIds : b.loverIds;
    if (!relation.includes(b.id)) relation.push(b.id);
    if (!reciprocal.includes(a.id)) reciprocal.push(a.id);
  }
  normalizeDynastyLineage(world);
  for (const c of world.countries) {
    const officeFamilies = [c.ruler, ...c.coRulerIds.map((id) => person(world, id)).filter((p): p is Person => !!p)]
      .map((p) => p.familyId);
    if (c.heir) officeFamilies.push(c.heir.familyId);
    c.dynastyClaims = [...new Set([...c.dynastyClaims, ...officeFamilies])];
  }
  ensureUniqueDynastySurnames(world);
}

export function trackedForBirth(world: World, country: Country, p: Person): boolean {
  const member = containsPerson(country, p);
  const inDynasty = country.dynastyClaims.includes(p.familyId) ||
    p.formerRulerOf.includes(country.id) ||
    p.id === country.ruler.id || country.previousRulerIds.includes(p.id);
  if (!p.alive) return false;
  if (p.spouseIds.some((id) => {
    const spouse = person(world, id);
    return !!spouse && (country.dynastyClaims.includes(spouse.familyId) ||
       spouse.formerRulerOf.includes(country.id));
  })) return true;
  if (p.loverIds.some((id) => {
    const lover = person(world, id);
    return !!lover && (country.dynastyClaims.includes(lover.familyId) ||
       lover.formerRulerOf.includes(country.id));
  })) return true;
  return member || inDynasty;
}
/** Все живые именные персонажи страны независимо от династии. */
export function countryCharacters(world: World, country: Country): Person[] {
  return world.people
    .filter((p) => p.alive && p.countryId === country.id)
    .sort((a, b) => b.age - a.age || a.name.localeCompare(b.name) || a.id - b.id);
}
/** Переносит фамилии семей, сохраняет культурный аффикс и разделяет династии живых персонажей. */
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
  const existing = person(world, b.id);
  const spouse = existing ?? b;
  if (!existing) world.people.push(spouse);
  const isForeignLeader = world.countries.some((other) => other.id !== c.id &&
    (other.pixels > 0 || other.type === 'nomadic') &&
    (other.ruler.id === spouse.id || other.coRulerIds.includes(spouse.id)));
  if (!isForeignLeader) {
    setPersonHome(spouse, c);
  }
  if (betrothal) { a.betrothedId = spouse.id; spouse.betrothedId = a.id; return; }
  if (!a.spouseIds.includes(spouse.id)) a.spouseIds.push(spouse.id);
  if (!spouse.spouseIds.includes(a.id)) spouse.spouseIds.push(a.id);
  a.betrothedId = null; spouse.betrothedId = null;
}
export function birth(world: World, c: Country, mother: Person, father: Person, year: number): Person | null {
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
  p.humanOrigin = inheritHumanOrigins(
    mother.humanOrigin ?? normalizeHumanOriginMix(null),
    father.humanOrigin ?? normalizeHumanOriginMix(null),
  );
  p.bornAt = year - Math.random(); p.age = 0; p.trait = ''; p.traits = [];
  mother.lastBirthYear = year;
  return registerPerson(world, c, p);
}
export function advancePeople(world: World, year: number): void {
  for (const p of world.people) {
    if (!p.alive) continue;
    const c = world.countries[p.countryId];
    const activeCountries = isActiveCountry(c) ? [c] : [];
    if (!activeCountries.length) continue;
    p.age = Math.max(p.age, Math.floor(year - p.bornAt));
  }
}
export function killPerson(world: World, p: Person, year: number, reason: string): void {
  p.alive = false; p.deathYear = year; p.deathReason = reason;
  const engaged = person(world, p.betrothedId);
  if (engaged) engaged.betrothedId = null;
  p.betrothedId = null;
}
