import { GOVERNMENTS, MODIFIERS, availableModifiers, applyModifier, type GovernmentId, type GovernmentModifierId } from './government';
import { canMarry, trackedForBirth } from './characters';
import { demography } from './demography';
import { familyOf, person } from './characters';
import { candidateAllowed, successionOrder } from './succession';
import type { Country, World } from './world';

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
  const family = world.people.filter((p) => p.alive && c.dynastyClaims.includes(p.familyId));
  const relatives = successionOrder(world, c).length;
  const pressure = Object.values(c.pressures).filter((p) => p.until >= year).reduce((n, p) => n + p.strength, 0);
  const divCulture = d.cultureFragmentation, divFaith = d.religionFragmentation;
  const age = c.ruler.age, rulerTraits = c.ruler.traits;
  const density = Math.max(0.01, d.density), area = Math.max(1, c.pixels);
  const proposals: ReformProposal[] = [];

  if (violent) {
    for (const id of Object.keys(GOVERNMENTS) as GovernmentId[]) {
      if (id !== c.government) proposals.push({ government: id, weight: id === 'tyranny' ? 2 : 1, forced: true });
    }
  } else {
    const addForm = (id: GovernmentId, weight: number) => {
      if (id !== c.government && weight > 0) proposals.push({ government: id, weight });
    };
    const tribalToHereditary = clamp((relatives + 1) * (1 + pressure) / (density * (1 + divCulture)));
    const tribalToRepublic = clamp(density * Math.max(divCulture, divFaith) / area * 0.05);
    if (c.government === 'tribal') {
      addForm('hereditary', tribalToHereditary);
      addForm('republic', tribalToRepublic);
      addForm('tyranny', area / (density * 1200) * (trait(c.ruler, 'Решительный') ? 2 : 1));
    } else if (c.government === 'hereditary') {
      addForm('tribal', clamp(1 / Math.max(1, family.length) * 30));
      addForm('republic', clamp(density * Math.max(divCulture, divFaith) / area * 0.05));
      addForm('tyranny', area / (density * 1200));
    } else if (c.government === 'republic') {
      addForm('tribal', clamp(1 / Math.max(1, density * Math.max(divCulture, divFaith))));
      addForm('hereditary', clamp(1 / Math.max(1, family.length)));
      addForm('tyranny', area / (density * 1200));
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
        w *= (topFaithShare > 0.5 ? 2 : 0.5) * (topFaithShare > 2 * secondFaith ? 2 : 0.5);
        if (c.ruler.religionId === d.religion) w *= 2;
        if (trait(c.ruler, 'Фанатик')) w *= 2;
        if (c.ruler.religionId === null || c.ruler.religionId !== d.religion) w *= 0.5;
        if (trait(c.ruler, 'Циник')) w *= 0.5;
        if (faiths.reduce((n, p) => n + p, 0) && (d.religions.get(null) ?? 0) / d.population >= 0.5) w *= 0.5;
        break;
      case 'ethnic':
        w *= (topCultureShare > 0.5 ? 2 : 0.5) * (topCultureShare > 2 * secondCulture ? 2 : 0.5);
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
        break;
      case 'federation':
        if (c.government === 'tyranny' || c.government === 'empire' as GovernmentId || c.modifiers.includes('confederation')) return 0;
        w *= divCulture + divFaith;
        break;
      case 'confederation':
        if (c.government !== 'tribal' && c.government !== 'hereditary' || c.modifiers.includes('federation')) return 0;
        w *= divCulture + divFaith;
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
    let w = addWeight(id);
    if (id === 'theocracy' && c.ruler.religionId !== d.religion && c.government !== 'tyranny' || id === 'ethnic' && c.ruler.cultureId !== d.culture) w *= 4;
    if (id === 'minority' && (age < 12 || age >= 66)) w *= 3;
    if (id === 'primogeniture' && c.government === 'tribal') w *= 2;
    if (id === 'oligarchy' && c.government === 'tribal') w *= 0.5;
    if (id === 'term') w = c.government === 'republic' ? 2 : 0;
    if (id === 'termLimit') w = c.government === 'republic' ? 1 : 0;
    if (id === 'continuous') w = c.government === 'republic' ? 1 : 0;
    return Math.max(0.05, w);
  };
  for (const id of availableModifiers(c.government, c.modifiers)) {
    const weight = addWeight(id) * (violent ? 2 : 0.2);
    if (weight > 0) proposals.push({ add: id, weight, forced: violent });
  }
  for (const id of c.modifiers) {
    const weight = removeWeight(id) * (violent ? 1 : 0.12);
    if (weight > 0) proposals.push({ remove: id, weight, forced: violent });
  }
  if (c.government === 'republic') {
    if (c.modifiers.includes('term')) proposals.push({ termYears: Math.min(12, c.termYears + 1), weight: 0.4 }, { termYears: Math.max(2, c.termYears - 1), weight: 0.4 });
    if (c.modifiers.includes('termLimit')) proposals.push({ maxTerms: Math.min(8, c.maxTerms + 1), weight: 0.3 }, { maxTerms: Math.max(1, c.maxTerms - 1), weight: 0.3 });
  }
  if (c.modifiers.includes('consulate')) proposals.push({ consulCount: Math.min(7, c.consulCount + 1), weight: 0.35 }, { consulCount: Math.max(2, c.consulCount - 1), weight: 0.35 });
  return proposals;
}

export function applyReform(c: Country, proposal: ReformProposal): void {
  if (proposal.government) {
    const old = c.government;
    c.government = proposal.government;
    const kept = c.modifiers.filter((m) => {
      if (proposal.government === 'republic' && ['primogeniture', 'seniority', 'minority', 'partition', 'pornocracy', 'coRule'].includes(m)) return false;
      if (proposal.government === 'hereditary' && m === 'communist') return false;
      if (proposal.government === 'tyranny' && ['oligarchy', 'partition'].includes(m)) return false;
      return true;
    });
    c.modifiers = [...new Set([...kept, ...GOVERNMENTS[c.government].modifiers])];
    if (old === 'republic' && proposal.government !== 'republic') { c.barredRulerIds = []; c.termCounts = {}; }
  } else if (proposal.add) c.modifiers = applyModifier(c.modifiers, proposal.add);
  else if (proposal.remove) {
    c.modifiers = c.modifiers.filter((m) => m !== proposal.remove);
    if (proposal.remove === 'term') c.modifiers = c.modifiers.filter((m) => m !== 'termLimit' && m !== 'continuous');
    if (proposal.remove === 'termLimit') c.modifiers = c.modifiers.filter((m) => m !== 'continuous');
  }
  if (proposal.termYears !== undefined) c.termYears = proposal.termYears;
  if (proposal.maxTerms !== undefined) c.maxTerms = proposal.maxTerms;
  if (proposal.consulCount !== undefined) c.consulCount = proposal.consulCount;
}

export function lifeOpportunity(world: World, c: Country, year: number): { kind: string; ids: number[]; weight: number } | null {
  const locals = world.people.filter((p) => p.alive && p.countryId === c.id);
  const birthParents = locals.filter((p) => trackedForBirth(world, c, p) && canMarry(c, p));
  const death = c.pendingDeathIds.length ? { kind: 'death', ids: [c.pendingDeathIds[0]], weight: 10000 } : null;
  if (death) return death;
  const due = c.government === 'republic' && c.modifiers.includes('term') && year - c.rulerSince >= c.termYears;
  if (due) return { kind: 'election', ids: [c.ruler.id], weight: 10000 };
  const events: { kind: string; ids: number[]; weight: number }[] = [];
  for (const mother of birthParents.filter((p) => p.gender === 'female' && p.age >= 12 && p.age <= 45)) {
    if (mother.lastBirthYear === year) continue;
    const fathers = birthParents.filter((p) => p.gender === 'male' && p.age >= 12 && !p.spouseIds.includes(mother.id) === false);
    const spouse = fathers.find((p) => mother.spouseIds.includes(p.id) && p.alive && !p.parents.some((id) => id === mother.id));
    if (!spouse) continue;
    const fertility = mother.age < 20 ? 0.12 : mother.age <= 45 ? 0.65 : 0;
    const maleFertility = spouse.age <= 45 ? 1 : spouse.age <= 65 ? 0.5 : 0.15;
    events.push({ kind: 'birth', ids: [mother.id, spouse.id], weight: fertility * maleFertility * 0.6 });
  }
  for (const p of locals.filter((x) => canMarry(c, x))) {
    const potential = locals.find((q) => q.id !== p.id && q.gender !== p.gender && canMarry(c, q) &&
      !q.spouseIds.includes(p.id) && !q.parents.includes(p.id) && !p.parents.includes(q.id) &&
      !q.parents.some((id) => p.parents.includes(id)));
    if (potential) events.push({ kind: p.age < 20 ? 'engagement' : 'marriage', ids: [p.id, potential.id], weight: p.age < 20 ? 0.05 : 0.1 });
  }
  const candidates = locals.filter((p) => p.age >= 8 && p.alive);
  if (candidates.length >= 2) events.push({ kind: 'friendship', ids: [candidates[0].id, candidates[candidates.length - 1].id], weight: 0.035 });
  const traits = locals.filter((p) => p.age >= 3 && p.age < 18 && p.traits.length === 0);
  if (traits.length) events.push({ kind: 'trait', ids: [traits[0].id], weight: 0.08 });
  const total = events.reduce((n, x) => n + x.weight, 0);
  if (!events.length || Math.random() > Math.min(0.8, total)) return null;
  let draw = Math.random() * total;
  return events.find((e) => (draw -= e.weight) <= 0) ?? events[events.length - 1];
}
