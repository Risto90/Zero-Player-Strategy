import type { Person } from './government';
import type { Country, World } from './world';
import { person, newCitizen, registerPerson } from './characters';
import { demography, weighted } from './demography';

export function rulers(world: World, c: Country): Person[] {
  return [c.ruler, ...c.coRulerIds.map((id) => person(world, id)).filter((p): p is Person => !!p)];
}
export function candidateAllowed(world: World, c: Country, p: Person, old = c.ruler, partnerExempt = false): boolean {
  if (!p.alive || c.pendingDeathIds.includes(p.id)) return false;
  const coRule = c.coRulerIds.includes(p.id);
  const adult = c.government === 'republic' || c.modifiers.includes('meritocracy') ||
    (c.government === 'tyranny' && c.modifiers.includes('communist'));
  const minimum = coRule ? 12 : adult ? 20 : c.government === 'tribal' ? 12 : 0;
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
export function candidateWeight(world: World, c: Country, p: Person, old = c.ruler): number {
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
      p.parents.some((id) => person(world, id)?.formerRulerOf.includes(c.id))) weight *= 2;
  return weight;
}
function communistPool(c: Country, list: Person[]): Person[] {
  if (!c.modifiers.includes('communist')) return list;
  const both = list.filter((p) => p.religionId === null && p.traits.includes('Космополит'));
  if (both.length) return both;
  const either = list.filter((p) => p.religionId === null || p.traits.includes('Космополит'));
  return either.length ? either : list;
}
export function successionOrder(world: World, c: Country, old = c.ruler): Person[] {
  if (c.government === 'republic') return [];
  const former = new Set([...c.previousRulerIds, old.id]);
  let family = world.people.filter((p) => p.id !== old.id && c.dynastyClaims.includes(p.familyId));
  if (c.government === 'tribal') family = family.filter((p) => p.parents.some((id) => former.has(id)));
  const children = world.people.filter((p) => p.parents.includes(old.id));
  let pool = family;
  const youngest = c.modifiers.includes('minority');
  const ageOrder = (a: Person, b: Person) => (youngest ? a.age - b.age : b.age - a.age) || a.id - b.id;
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
  if (c.government === 'tyranny' && !pool.some((p) => candidateAllowed(world, c, p, old))) {
    pool.push(...old.spouseIds.map((id) => person(world, id)).filter((p): p is Person => !!p));
  }
  const partnerIds = new Set<number>();
  if (c.modifiers.includes('pornocracy')) {
    const partners = (p: Person) => [...p.spouseIds, ...p.loverIds].map((id) => person(world, id)).filter((x): x is Person => !!x);
    const oldPartners = partners(old);
    const expanded = pool.flatMap((p) => [...partners(p), p]);
    for (const p of [...oldPartners, ...expanded.filter((p) => !pool.includes(p))]) partnerIds.add(p.id);
    pool = [...oldPartners, ...expanded];
  }
  pool = pool.filter((p, i) => pool.findIndex((x) => x.id === p.id) === i && candidateAllowed(world, c, p, old, partnerIds.has(p.id)));
  return communistPool(c, pool);
}
export function hasFixedHeir(c: Country): boolean {
  return c.government !== 'republic' && !c.modifiers.includes('oligarchy') &&
    (c.government === 'hereditary' || c.modifiers.some((id) => ['seniority', 'minority', 'primogeniture', 'pornocracy'].includes(id)));
}
export function refreshHeirs(world: World): void {
  for (const c of world.countries) c.heir = hasFixedHeir(c) ? successionOrder(world, c)[0] ?? null : null;
}

/** Generated options are proposals only; only the chosen person is added to the world registry. */
export function leadershipOptions(world: World, c: Country, year: number, old = c.ruler): Person[] {
  const family = successionOrder(world, c, old);
  const drawFamily = () => {
    if (hasFixedHeir(c)) return family[0] ?? null;
    return weighted(family.map((p) => ({ value: p, weight: candidateWeight(world, c, p, old) })));
  };
  const fresh = () => newCitizen(world, c, year);
  if (c.government === 'tribal') return [fresh(), drawFamily() ?? fresh()];
  if (c.government !== 'republic') {
    const first = drawFamily();
    return first ? [first] : [fresh()];
  }
  const make = () => {
    const proposal = fresh();
    const matching = communistPool(c, world.people.filter((p) => p.countryId === c.id &&
      p.cultureId === proposal.cultureId && p.religionId === proposal.religionId && candidateAllowed(world, c, p, old)));
    if (matching.length && Math.random() < 0.5) return weighted(matching.map((p) => ({ value: p, weight: candidateWeight(world, c, p, old) })))!;
    return proposal;
  };
  const incumbent = c.modifiers.includes('continuous') && candidateAllowed(world, c, old, old) ? old : null;
  const a = incumbent ?? make();
  let b = make();
  if (a.id === b.id) b = fresh();
  return [a, b];
}
export function appoint(world: World, c: Country, p: Person, year: number, seatId = c.ruler.id): void {
  const old = person(world, seatId) ?? c.ruler;
  const chosen = registerPerson(world, c, p);
  chosen.countryId = c.id;
  if (!chosen.formerRulerOf.includes(c.id)) chosen.formerRulerOf.push(c.id);
  if (!c.previousRulerIds.includes(old.id)) c.previousRulerIds.push(old.id);
  if (c.modifiers.includes('continuous') && c.government === 'republic' && chosen.id !== old.id && !c.barredRulerIds.includes(old.id)) c.barredRulerIds.push(old.id);
  c.termCounts[chosen.id] = (c.termCounts[chosen.id] ?? 0) + 1;
  c.seatSince[chosen.id] = year;
  if (!c.dynastyClaims.includes(chosen.familyId)) c.dynastyClaims.unshift(chosen.familyId);
  if (seatId === c.ruler.id) { c.ruler = chosen; c.rulerSince = year; }
  else c.coRulerIds = c.coRulerIds.map((id) => id === seatId ? chosen.id : id);
  c.coRulerIds = [...new Set(c.coRulerIds)].filter((id) => id !== c.ruler.id);
}
export function ensureOffices(world: World, c: Country, year: number): void {
  const desired = c.modifiers.includes('consulate') ? c.consulCount : c.modifiers.includes('coRule') ? 2 : 1;
  c.coRulerIds = c.coRulerIds.filter((id) => !!person(world, id)?.alive).slice(0, desired - 1);
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
  }
}
