import type { Person } from './government';
import { formatPersonName, legacyNameStyleForCulture } from './government';
import type { Country, World } from './world';
import { person, newCitizen, registerPerson } from './characters';
import { demography, weighted } from './demography';

function isMember(c: Country, p: Person): boolean {
  return p.countryId === c.id || c.ruler.id === p.id || c.coRulerIds.includes(p.id);
}

export function rulers(world: World, c: Country): Person[] {
  return [c.ruler, ...c.coRulerIds.map((id) => person(world, id)).filter((p): p is Person => !!p)];
}
export interface RulerHistoryEntry {
  person: Person;
  startYear: number | null;
  endYear: number | null;
  office: 'ruler' | 'coRuler';
  current: boolean;
  currentCoRuler: boolean;
}
/** Reconcile open terms when offices are adjusted outside a direct appointment. */
export function syncRulerTerms(c: Country, year: number): void {
  c.rulerTerms ??= [];
  const active = new Map<number, 'ruler' | 'coRuler'>([[c.ruler.id, 'ruler']]);
  for (const id of c.coRulerIds) if (!active.has(id)) active.set(id, 'coRuler');
  for (const term of c.rulerTerms) {
    if (term.endYear !== null) continue;
    if (active.get(term.personId) !== term.office) term.endYear = year;
  }
  for (const [personId, office] of active) {
    const alreadyOpen = c.rulerTerms.some((term) => term.personId === personId &&
      term.office === office && term.endYear === null);
    if (!alreadyOpen) c.rulerTerms.push({ personId, office, startYear: c.seatSince[personId] ?? (office === 'ruler' ? c.rulerSince : null), endYear: null });
  }
}

export function closeRulerTerms(c: Country, year: number): void {
  c.rulerTerms ??= [];
  for (const term of c.rulerTerms) if (term.endYear === null) term.endYear = year;
}

function closeRulerTerm(c: Country, personId: number, office: 'ruler' | 'coRuler', year: number): void {
  const term = [...(c.rulerTerms ?? [])].reverse().find((entry) =>
    entry.personId === personId && entry.office === office && entry.endYear === null);
  if (term) term.endYear = year;
}

/** Returns one chronologically sorted row for every recorded appointment. */
export function countryRulerHistory(world: World, c: Country): RulerHistoryEntry[] {
  const activeIds = new Set([c.ruler.id, ...c.coRulerIds]);
  const ids = new Set([
    ...world.people.filter((p) => p.formerRulerOf.includes(c.id)).map((p) => p.id),
    ...activeIds,
  ]);
  const byId = new Map(world.people.map((p) => [p.id, p]));
  byId.set(c.ruler.id, c.ruler);
  for (const p of rulers(world, c)) byId.set(p.id, p);

  const terms = (c.rulerTerms ?? []).map((term) => ({ ...term }));
  const represented = new Set(terms.map((term) => term.personId));
  for (const id of ids) {
    if (represented.has(id)) continue;
    const office = c.coRulerIds.includes(id) ? 'coRuler' : 'ruler';
    const year = c.seatSince[id] ?? (id === c.ruler.id ? c.rulerSince : null);
    terms.push({ personId: id, startYear: Number.isFinite(year) ? year : null, endYear: null, office });
  }
  for (const id of activeIds) {
    const office = c.coRulerIds.includes(id) ? 'coRuler' : 'ruler';
    if (!terms.some((term) => term.personId === id && term.office === office && term.endYear === null)) {
      const year = c.seatSince[id] ?? (office === 'ruler' ? c.rulerSince : null);
      terms.push({ personId: id, startYear: Number.isFinite(year) ? year : null, endYear: null, office });
    }
  }
  return terms.flatMap((term) => {
    const p = byId.get(term.personId);
    if (!p) return [];
    const current = activeIds.has(term.personId) &&
      (term.office === 'coRuler' ? c.coRulerIds.includes(term.personId) : c.ruler.id === term.personId) &&
      term.endYear === null;
    return [{
      person: p,
      startYear: Number.isFinite(term.startYear) ? term.startYear : null,
      endYear: Number.isFinite(term.endYear) ? term.endYear : null,
      office: term.office,
      current,
      currentCoRuler: current && term.office === 'coRuler',
    }];
  }).sort((a, b) => (a.startYear ?? Number.POSITIVE_INFINITY) - (b.startYear ?? Number.POSITIVE_INFINITY) ||
    (a.endYear ?? Number.POSITIVE_INFINITY) - (b.endYear ?? Number.POSITIVE_INFINITY) ||
    a.person.id - b.person.id);
}
export function expectedHeirFor(world: World, c: Country, leader: Person): Person | null {
  if (!hasFixedHeir(c)) return null;
  return successionOrder(world, c, leader)[0] ?? null;
}
export function candidateAllowed(
  world: World,
  c: Country,
  p: Person,
  old = c.ruler,
  partnerExempt = false,
  allowCurrentLeader = false,
  memberExempt = false,
): boolean {
  const foreignDynast = c.government !== 'republic' && c.dynastyClaims.includes(p.familyId);
  if (!p.alive || (!isMember(c, p) && !partnerExempt && !memberExempt && !foreignDynast)) return false;
  if (!allowCurrentLeader && rulers(world, c).some((leader) => leader.id === p.id && leader.id !== old.id)) return false;
  const coRule = c.coRulerIds.includes(p.id);
  const adult = c.government === 'republic' || c.modifiers.includes('meritocracy') ||
    (c.government === 'tyranny' && c.modifiers.includes('communist'));
  const minimum = coRule || c.modifiers.includes('coRule') ? 12 : adult ? 20 : c.government === 'tribal' || c.government === 'tyranny' ? 12 : 0;
  if (p.age < minimum) return false;
  if (!partnerExempt) {
    if (c.modifiers.includes('patriarchal') && p.gender !== 'male') return false;
    if (c.modifiers.includes('matriarchal') && p.gender !== 'female') return false;
  }
  if (c.government !== 'tribal') {
    const d = demography(world, c);
    if (c.modifiers.includes('theocracy') && p.religionId !== (c.government === 'republic' ? d.religion : old.religionId)) return false;
    if (c.modifiers.includes('ethnic') && p.cultureId !== (c.government === 'republic' ? d.culture : old.cultureId)) return false;
  }
  if (c.government === 'republic') {
    if (c.barredRulerIds.includes(p.id)) return false;
    const max = c.modifiers.includes('termLimit') ? c.maxTerms : 1;
    if ((c.termCounts[p.id] ?? 0) >= max) return false;
    if (c.modifiers.includes('continuous') && c.previousRulerIds.includes(p.id) && !rulers(world, c).some((r) => r.id === p.id)) return false;
  }
  return true;
}
export function candidateWeight(
  world: World,
  c: Country,
  p: Person,
  old = c.ruler,
  republicanPornocracyPartner = false,
  peopleById?: ReadonlyMap<number, Person>,
): number {
  const d = demography(world, c);
  let weight = p.age >= 20 && p.age <= 28 ? 0.5 : 1;
  if (c.government === 'tribal') {
    if (c.modifiers.includes('ethnic')) {
      if (p.cultureId === d.culture) weight *= 4;
      if (p.cultureId === old.cultureId) weight *= 2;
    }
    if (c.modifiers.includes('theocracy')) {
      const byFaith = new Map<number | null, number>();
      for (const pair of d.pairs) if (pair.cultureId === old.cultureId) byFaith.set(pair.religionId, (byFaith.get(pair.religionId) ?? 0) + pair.weight);
      const faith = [...byFaith].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (p.religionId === faith) weight *= 2;
      if (p.religionId === old.religionId) weight *= 2;
    }
  }
  if (c.government === 'tyranny') {
    for (const group of [world.cultures[p.cultureId], p.religionId === null ? null : world.religions[p.religionId]]) {
      if (group?.traits?.includes('warlike')) weight *= 2;
      if (group?.traits?.includes('peaceful')) weight /= 2;
    }
  }
  if (c.modifiers.includes('oligarchy') && c.government === 'republic' &&
      isChildOfFormerRuler(world, c, p, peopleById)) weight *= 2;
  if (c.government === 'republic' && c.modifiers.includes('pornocracy') && republicanPornocracyPartner) weight *= 2;
  return weight;
}
function communistPool(c: Country, list: Person[]): Person[] {
  if (!c.modifiers.includes('communist')) return list;
  const both = list.filter((p) => p.religionId === null && p.traits.includes('Космополит'));
  if (both.length) return both;
  return list.filter((p) => p.religionId === null || p.traits.includes('Космополит'));
}

export interface CountryCandidate {
  person: Person;
  kind: 'succession' | 'election';
  basis: string[];
  advantages: string[];
  expectedHeir: boolean;
  weight: number | null;
}

function partnerCandidateIds(anchors: Person[], candidates: Person[]): Set<number> {
  const anchorIds = new Set(anchors.map((p) => p.id));
  const candidateIds = new Set(candidates.map((p) => p.id));
  const result = new Set<number>();
  for (const anchor of anchors) {
    for (const id of [...anchor.spouseIds, ...anchor.loverIds]) {
      if (candidateIds.has(id)) result.add(id);
    }
  }
  for (const candidate of candidates) {
    if ([...candidate.spouseIds, ...candidate.loverIds].some((id) => anchorIds.has(id))) {
      result.add(candidate.id);
    }
  }
  return result;
}

function isChildOfFormerRuler(
  world: World,
  c: Country,
  p: Person,
  peopleById?: ReadonlyMap<number, Person>,
): boolean {
  return p.parents.some((id) => {
    const parent = peopleById ? peopleById.get(id) : person(world, id);
    return parent?.formerRulerOf.includes(c.id) ?? false;
  });
}

function candidateWeightNotes(
  world: World,
  c: Country,
  p: Person,
  old: Person,
  republicanPartner: boolean,
  peopleById?: ReadonlyMap<number, Person>,
): string[] {
  const notes: string[] = [];
  if (p.age >= 20 && p.age <= 28) notes.push('Возраст 20–28 лет: вес ×0,5.');
  if (c.government === 'tribal' && c.modifiers.includes('ethnic')) {
    const d = demography(world, c);
    if (p.cultureId === d.culture) notes.push('Ведущая культура страны: вес ×4.');
    if (p.cultureId === old.cultureId) notes.push('Культура прежнего вождя: вес ×2.');
  }
  if (c.government === 'tribal' && c.modifiers.includes('theocracy')) {
    const d = demography(world, c);
    const byFaith = new Map<number | null, number>();
    for (const pair of d.pairs) {
      if (pair.cultureId === old.cultureId) byFaith.set(pair.religionId, (byFaith.get(pair.religionId) ?? 0) + pair.weight);
    }
    const leadingFaith = [...byFaith].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (p.religionId === leadingFaith) notes.push('Ведущая вера в культуре прежнего вождя: вес ×2.');
    if (p.religionId === old.religionId) notes.push('Вера прежнего вождя: вес ×2.');
  }
  if (c.government === 'tyranny') {
    for (const [group, label] of [
      [world.cultures[p.cultureId], 'Культура'],
      [p.religionId === null ? null : world.religions[p.religionId], 'Вера'],
    ] as const) {
      if (group?.traits?.includes('warlike')) notes.push(`${label} воинственная: вес ×2.`);
      if (group?.traits?.includes('peaceful')) notes.push(`${label} мирная: вес ÷2.`);
    }
  }
  if (c.government === 'republic' && c.modifiers.includes('oligarchy') &&
      isChildOfFormerRuler(world, c, p, peopleById)) {
    notes.push('Олигархия: ребёнок прежнего правителя, вес выбора ×2.');
  }
  if (c.government === 'republic' && c.modifiers.includes('pornocracy') && republicanPartner) {
    notes.push('Порнократия: партнёр правителя или допущенного кандидата, вес выбора ×2; права наследования нет.');
  }
  return notes;
}

/** Eligible existing candidates, with chance advantages kept separate from succession rights. */
export function countryCandidates(world: World, c: Country): CountryCandidate[] {
  const old = c.ruler;
  const peopleById = new Map(world.people.map((p) => [p.id, p]));
  if (c.government === 'republic') {
    let eligible = world.people.filter((p) => p.countryId === c.id && candidateAllowed(world, c, p, old));
    eligible = communistPool(c, eligible);
    const anchors = [old, ...eligible];
    const partners = c.modifiers.includes('pornocracy')
      ? partnerCandidateIds(anchors, eligible)
      : new Set<number>();
    return eligible.map((p) => {
      const advantages = candidateWeightNotes(world, c, p, old, partners.has(p.id), peopleById);
      const basis = ['Живой житель страны, прошедший возрастные, половые, культурные, религиозные и избирательные ограничения.'];
      if (c.modifiers.includes('communist')) {
        basis.push('Коммунистический фильтр: допущены атеисты и/или космополиты.');
      }
      if (c.modifiers.includes('termLimit')) {
        basis.push(`Использовано сроков: ${c.termCounts[p.id] ?? 0} из ${c.maxTerms}.`);
      }
      return {
        person: p,
        kind: 'election',
        basis,
        advantages,
        expectedHeir: false,
        weight: candidateWeight(world, c, p, old, partners.has(p.id), peopleById),
      };
    });
  }

  const ordered = successionOrder(world, c, old);
  const successionPartners = c.modifiers.includes('pornocracy')
    ? partnerCandidateIds([old, ...ordered], ordered)
    : new Set<number>();
  const fixedHeir = hasFixedHeir(c);
  const eligibleChildren = world.people.filter((p) =>
    p.parents.includes(old.id) && candidateAllowed(world, c, p, old));
  const previousLeaders = new Set([...c.previousRulerIds, old.id]);
  const candidates = ordered.map((p, index): CountryCandidate => {
    const basis: string[] = [];
    const advantages: string[] = [];
    if (c.government === 'tribal') {
      basis.push('Живой ребёнок нынешнего или прежнего вождя: возможный кандидат, не гарантированное наследование.');
    } else if (c.government === 'tyranny' && old.spouseIds.includes(p.id) &&
        !eligibleChildren.some((child) => child.id === p.id)) {
      basis.push('Супруг(а) правителя: допускается при отсутствии подходящего ребёнка для преемства.');
    } else if (c.modifiers.includes('pornocracy') && successionPartners.has(p.id)) {
      basis.push('Порнократия: партнёр правителя или кандидата включён в линию наследования.');
    } else if (c.government === 'tyranny' && eligibleChildren.length > 0) {
      basis.push(p.parents.includes(old.id)
        ? 'Ребёнок правителя; при тирании дети рассматриваются прежде других родственников.'
        : 'Кандидат из родни; дети правителя имеют приоритет.');
    } else if (p.parents.some((parentId) => previousLeaders.has(parentId)) && c.modifiers.includes('oligarchy') && c.government === 'hereditary') {
      basis.push('Кандидат из правящей династии при олигархии.');
    } else {
      basis.push('Живой допустимый член наследственной линии или семьи правителя.');
    }
    if (c.modifiers.includes('seniority')) advantages.push('Порядок сеньората: старший подходящий член династии.');
    if (c.modifiers.includes('minority')) advantages.push('Порядок минората: младший подходящий член династии.');
    if (c.modifiers.includes('primogeniture')) advantages.push('Порядок первородства: старшая подходящая ветвь первой.');
    if (c.modifiers.includes('oligarchy') && c.government !== 'republic') {
      advantages.push('Олигархия: выбор наследника случаен среди допустимых членов династии.');
    }
    if (c.modifiers.includes('partition')) {
      advantages.push('Разделение влияет на распределение страны между подходящими наследниками, а не гарантирует вступление во власть.');
    }
    if (c.modifiers.includes('pornocracy') && successionPartners.has(p.id)) {
      advantages.push('Партнёры стоят в линии перед связанным с ними правителем или кандидатом.');
    }
    if (c.modifiers.includes('communist')) {
      basis.push('Коммунистический фильтр: член семьи должен быть атеистом и/или космополитом.');
    }
    if (c.modifiers.includes('coRule') && p.age < 20) {
      basis.push('Соправительство допускает кандидата от 12 лет.');
    }
    if (fixedHeir && index === 0) {
      basis.push('Ожидаемый наследник по действующему закону; это порядок преемства, а не бонус к выборному весу.');
    }
    advantages.push(...candidateWeightNotes(world, c, p, old, false, peopleById));
    return {
      person: p,
      kind: 'succession',
      basis,
      advantages,
      expectedHeir: fixedHeir && index === 0,
      weight: fixedHeir ? null : candidateWeight(world, c, p, old, false, peopleById),
    };
  });
  return candidates;
}

export function successionOrder(world: World, c: Country, old = c.ruler): Person[] {
  if (c.government === 'republic') return [];
  const peopleById = new Map(world.people.map((p) => [p.id, p]));
  const former = new Set([...c.previousRulerIds, old.id]);
  let family = world.people.filter((p) => p.id !== old.id && c.dynastyClaims.includes(p.familyId) && isMember(c, p));
  if (c.government === 'tribal') family = family.filter((p) => p.parents.some((id) => former.has(id)));
  const children = world.people.filter((p) => p.parents.includes(old.id) && isMember(c, p));
  let pool = family;
  const youngest = c.modifiers.includes('minority');
  const ageOrder = (a: Person, b: Person) => (youngest ? b.bornAt - a.bornAt : a.bornAt - b.bornAt) || a.id - b.id;
  if (c.modifiers.includes('primogeniture') && !c.modifiers.includes('oligarchy')) {
    const seen = new Set<number>();
    const branch = (parent: Person): Person[] => {
      if (seen.has(parent.id)) return [];
      seen.add(parent.id);
      const kids = world.people.filter((p) => p.parents.includes(parent.id)).sort(ageOrder);
      return kids.flatMap((p) => p.alive && candidateAllowed(world, c, p, old) ? [p] : branch(p));
    };
    pool = [...branch(old), ...family.sort(ageOrder)];
  } else if (!c.modifiers.includes('seniority') && !youngest &&
      (c.government === 'tyranny' || (c.modifiers.includes('primogeniture') && c.modifiers.includes('oligarchy')))) {
    const direct = children.filter((p) => candidateAllowed(world, c, p, old));
    pool = direct.length ? direct : family;
  } else pool = [...family].sort(ageOrder);
  if (c.modifiers.includes('consulate') && c.modifiers.includes('partition')) {
    const siblings = world.people.filter((p) => p.id !== old.id && p.alive &&
      old.parents.some((parentId) => p.parents.includes(parentId)));
    const siblingIds = new Set(siblings.map((p) => p.id));
    const siblingPool = pool.filter((p) => siblingIds.has(p.id));
    const sittingConsuls = rulers(world, c).filter((p) => p.alive);
    const consulChildren = world.people.filter((p) => p.alive &&
      sittingConsuls.some((leader) => p.parents.includes(leader.id)));
    const consulChildIds = new Set(consulChildren.map((p) => p.id));
    const childPool = pool.filter((p) => consulChildIds.has(p.id) && !siblingIds.has(p.id));
    const preferred = [...siblingPool, ...childPool];
    pool = [...preferred, ...pool.filter((p) => !preferred.some((x) => x.id === p.id))];
  }
  const tyrantSpouses = c.government === 'tyranny' && !children.some((p) => candidateAllowed(world, c, p, old))
    ? old.spouseIds.map((id) => person(world, id)).filter((p): p is Person => !!p)
    : [];
  if (tyrantSpouses.length) pool = [...pool, ...tyrantSpouses];
  const tyrantSpouseIds = new Set(tyrantSpouses.map((p) => p.id));
  if (tyrantSpouseIds.size) {
    pool = pool.filter((p) => candidateAllowed(world, c, p, old, false, false, tyrantSpouseIds.has(p.id)));
  }
  const partnerIds = new Set<number>();
  if (c.modifiers.includes('pornocracy')) {
    const partners = (p: Person) => [...p.spouseIds, ...p.loverIds]
      .map((id) => peopleById.get(id)).filter((x): x is Person => !!x);
    const oldPartners = partners(old);
    const expanded = pool.flatMap((p) => [...partners(p), p]);
    for (const p of [...oldPartners, ...expanded.filter((p) => !pool.includes(p))]) partnerIds.add(p.id);
    pool = [...oldPartners, ...expanded];
  }
  pool = pool.filter((p, i) => pool.findIndex((x) => x.id === p.id) === i &&
    candidateAllowed(world, c, p, old, partnerIds.has(p.id), false, tyrantSpouseIds.has(p.id)));
  return communistPool(c, pool);
}
export function hasFixedHeir(c: Country): boolean {
  return c.government === 'hereditary' && !c.modifiers.includes('oligarchy') &&
    c.modifiers.some((id) => ['seniority', 'minority', 'primogeniture'].includes(id));
}
export function refreshHeirs(world: World, year?: number): void {
  for (const c of world.countries) {
    if (!hasFixedHeir(c)) { c.heir = null; continue; }
    c.heir = successionOrder(world, c)[0] ?? null;
  }
}

/** Generated options are proposals only; only the chosen person is added to the world registry. */
export function leadershipOptions(
  world: World,
  c: Country,
  year: number,
  old = c.ruler,
  options: { peacefulTransfer?: boolean } = {},
): Person[] {
  const family = successionOrder(world, c, old);
  const unique = (people: (Person | null)[]) => people.filter((p, i, all): p is Person =>
    !!p && all.findIndex((x) => x?.id === p.id) === i);
  const fresh = () => newCitizen(world, c, year);
  const dynastic = (): Person => {
    const p = fresh();
    p.familyId = old.familyId;
    p.familyName = old.familyName;
    p.familyCultureId = old.familyCultureId ?? old.cultureId;
    p.parents = [];
    p.age = c.modifiers.includes('meritocracy') || (c.government === 'republic') ? 24 :
      c.government === 'tyranny' || c.modifiers.includes('coRule') ? 12 : 16;
    p.bornAt = year - p.age - Math.random();
    if (c.modifiers.includes('ethnic') && c.government !== 'republic') p.cultureId = old.cultureId;
    if (c.modifiers.includes('theocracy') && c.government !== 'republic') p.religionId = old.religionId;
    p.name = formatPersonName(p.givenName, p.familyName, p.gender, {
      style: world.cultures[p.cultureId]?.nameStyleId ?? legacyNameStyleForCulture(p.cultureId),
    });
    return p;
  };
  const oldDynastyHeirs = unique(family).filter((p) => p.familyId === old.familyId);
  const hasPartition = options.peacefulTransfer && c.modifiers.includes('partition');
  const allowForeignDynasty = !hasPartition || oldDynastyHeirs.length <= 1 ||
    world.cities.filter((city) => city.countryId === c.id).length === 1;
  const restrictForeignDynasties = hasPartition && !allowForeignDynasty;
  const distinctFamily = unique(family).filter((p) =>
    !restrictForeignDynasties || p.familyId === old.familyId);
  const fallback = () => restrictForeignDynasties ? dynastic() : fresh();
  const republicanPartners = c.government === 'republic' && c.modifiers.includes('pornocracy')
    ? new Set(countryCandidates(world, c).filter((candidate) =>
      candidate.advantages.some((reason) => reason.startsWith('Порнократия:')))
      .map((candidate) => candidate.person.id))
    : new Set<number>();
  const eligibleFamily = distinctFamily.filter((p) => candidateAllowed(world, c, p, old) ||
    (c.modifiers.includes('pornocracy') && !isMember(c, p)));
  const ensurePair = (first: Person | null, second: Person | null, fallback: () => Person): Person[] => {
    const pair = unique([first, second]);
    while (pair.length < 2) {
      let candidate = fallback();
      for (let attempt = 0; attempt < 8 && pair.some((p) => p.id === candidate.id); attempt += 1) candidate = fallback();
      pair.push(candidate);
    }
    return pair.slice(0, 2);
  };
  if (c.modifiers.includes('consulate') && c.modifiers.includes('partition')) {
    const candidates = eligibleFamily;
    return ensurePair(candidates[0] ?? null, candidates[1] ?? null, fallback);
  }
  const drawFamily = () => {
    if (hasFixedHeir(c)) return distinctFamily[0] ?? null;
    if (c.modifiers.includes('consulate') && c.modifiers.includes('partition')) return distinctFamily[0] ?? null;
    return weighted(distinctFamily.map((p) => ({ value: p, weight: candidateWeight(world, c, p, old) })));
  };
  if (c.government === 'tribal') {
    const child = drawFamily();
    return child ? ensurePair(fallback(), child, fallback) : ensurePair(fallback(), null, fallback);
  }
  if (c.government === 'hereditary') {
    const eligible = eligibleFamily;
    const first = hasFixedHeir(c) ? eligible[0] ?? null :
      weighted(eligible.map((p) => ({ value: p, weight: candidateWeight(world, c, p, old) })));
    const second = eligible.find((p) => p.id !== first?.id) ?? null;
    return ensurePair(first, second, dynastic);
  }
  if (c.government === 'tyranny') {
    const first = drawFamily();
    const second = eligibleFamily.find((p) => p.id !== first?.id) ?? null;
    return ensurePair(first, second, fallback);
  }
  const make = () => {
    const proposal = fallback();
    const matching = communistPool(c, world.people.filter((p) => isMember(c, p) &&
      p.cultureId === proposal.cultureId && p.religionId === proposal.religionId &&
      (!restrictForeignDynasties || p.familyId === old.familyId) && candidateAllowed(world, c, p, old)));
    if (matching.length && Math.random() < 0.5) return weighted(matching.map((p) => ({
      value: p,
      weight: candidateWeight(world, c, p, old, republicanPartners.has(p.id)),
    })))!;
    return proposal;
  };
  const incumbent = c.modifiers.includes('continuous') && candidateAllowed(world, c, old, old) ? old : null;
  const a = incumbent ?? make();
  let b = make();
  for (let attempt = 0; b.id === a.id && attempt < 8; attempt += 1) b = make();
  return ensurePair(a, b.id === a.id ? fallback() : b, fallback);
}
export function appoint(world: World, c: Country, p: Person, year: number, seatId = c.ruler.id): void {
  const old = person(world, seatId) ?? c.ruler;
  const oldOffice = seatId === c.ruler.id ? 'ruler' : 'coRuler';
  closeRulerTerm(c, old.id, oldOffice, year);
  const chosen = registerPerson(world, c, p);
  if (!chosen.formerRulerOf.includes(c.id)) chosen.formerRulerOf.push(c.id);
  if (!c.previousRulerIds.includes(old.id)) c.previousRulerIds.push(old.id);
  if (c.modifiers.includes('continuous') && c.government === 'republic' && chosen.id !== old.id && !c.barredRulerIds.includes(old.id)) c.barredRulerIds.push(old.id);
  c.termCounts[chosen.id] = (c.termCounts[chosen.id] ?? 0) + 1;
  c.seatSince[chosen.id] = year;
  if (!c.dynastyClaims.includes(chosen.familyId)) c.dynastyClaims.unshift(chosen.familyId);
  if (seatId === c.ruler.id) { c.ruler = chosen; c.rulerSince = year; }
  else c.coRulerIds = c.coRulerIds.map((id) => id === seatId ? chosen.id : id);
  c.coRulerIds = [...new Set(c.coRulerIds)].filter((id) => id !== c.ruler.id);
  c.rulerTerms ??= [];
  c.rulerTerms.push({ personId: chosen.id, startYear: year, endYear: null, office: chosen.id === c.ruler.id ? 'ruler' : 'coRuler' });
  syncRulerTerms(c, year);
}
/**
 * Repairs legacy or inconsistent active offices without changing living leaders.
 * The callback lets country successions retain the game's normal annexation path.
 */
export function repairDeadOfficeHolders(
  world: World,
  c: Country,
  year: number,
  appointOffice: (leader: Person, seatId: number) => void = (leader, seatId) => appoint(world, c, leader, year, seatId),
): boolean {
  let repaired = false;
  const replace = (leader: Person, seatId: number) => {
    const successor = successionOrder(world, c, leader)[0] ?? newCitizen(world, c, year);
    appointOffice(successor, seatId);
    repaired = true;
  };

  for (const seatId of [...c.coRulerIds]) {
    const leader = person(world, seatId);
    if (!leader) {
      c.coRulerIds = c.coRulerIds.filter((id) => id !== seatId);
      repaired = true;
    } else if (!leader.alive) {
      replace(leader, seatId);
    }
  }

  const ruler = person(world, c.ruler.id) ?? c.ruler;
  if (!ruler.alive) replace(ruler, ruler.id);

  if (repaired) ensureOffices(world, c, year);
  return repaired;
}
export function ensureOffices(world: World, c: Country, year: number): void {
  const desired = c.modifiers.includes('consulate') ? c.consulCount : c.modifiers.includes('coRule') ? 2 : 1;
  c.coRulerIds = c.coRulerIds.filter((id) => !!person(world, id)?.alive).slice(0, desired - 1);
  if (c.modifiers.includes('consulate')) {
    for (const leader of rulers(world, c)) {
      if (!c.dynastyClaims.includes(leader.familyId)) c.dynastyClaims.push(leader.familyId);
    }
  }
  while (c.coRulerIds.length < desired - 1) {
    const occupied = new Set([c.ruler.id, ...c.coRulerIds]);
    let next: Person | null = null;
    if (c.modifiers.includes('coRule')) {
      next = c.heir ?? world.people.find((p) => p.alive && p.age >= 12 && p.familyId === c.ruler.familyId && !occupied.has(p.id)) ?? null;
      if (!next) { c.modifiers = c.modifiers.filter((m) => m !== 'coRule'); break; }
    } else next = newCitizen(world, c, year);
    registerPerson(world, c, next);
    c.coRulerIds.push(next.id); c.seatSince[next.id] = year; c.termCounts[next.id] = (c.termCounts[next.id] ?? 0) + 1;
    if (!next.formerRulerOf.includes(c.id)) next.formerRulerOf.push(c.id);
    if (c.modifiers.includes('consulate') && !c.dynastyClaims.includes(next.familyId)) {
      c.dynastyClaims.push(next.familyId);
    }
  }
  syncRulerTerms(c, year);
}
