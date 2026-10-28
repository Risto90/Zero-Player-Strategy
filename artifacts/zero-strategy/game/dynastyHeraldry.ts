import { createEntityEmblem } from './flagIdentity';
import type { Person } from './government';
import type { World } from './world';

const MIN_DYNASTY_RULERS = 3;
const MIN_DYNASTY_MEMBERS = 15;

/** Создаёт гербы только для династий, достигших обоих порогов. */
export function ensureDynastyEmblems(world: World): number[] {
  world.dynastyEmblems ??= {};
  const peopleById = new Map(world.people.map((person) => [person.id, person]));
  const memberIds = new Map<number, Set<number>>();
  const rulerIds = new Map<number, Set<number>>();
  const formerRulersByCountry = new Map<number, Person[]>();

  const addMember = (person: Person | undefined) => {
    if (!person || !Number.isFinite(person.familyId)) return;
    let members = memberIds.get(person.familyId);
    if (!members) {
      members = new Set();
      memberIds.set(person.familyId, members);
    }
    members.add(person.id);
  };

  const addRuler = (personId: number, fallback?: Person) => {
    const person = peopleById.get(personId) ?? (fallback?.id === personId ? fallback : undefined);
    if (!person) return;
    addMember(person);
    let rulers = rulerIds.get(person.familyId);
    if (!rulers) {
      rulers = new Set();
      rulerIds.set(person.familyId, rulers);
    }
    rulers.add(person.id);
  };

  for (const person of world.people) {
    addMember(person);
    for (const countryId of person.formerRulerOf ?? []) {
      const formerRulers = formerRulersByCountry.get(countryId);
      if (formerRulers) formerRulers.push(person);
      else formerRulersByCountry.set(countryId, [person]);
    }
  }
  for (const country of world.countries) {
    for (const term of country.rulerTerms ?? []) addRuler(term.personId, country.ruler);
    for (const personId of country.previousRulerIds ?? []) addRuler(personId, country.ruler);
    if (country.ruler) addRuler(country.ruler.id, country.ruler);
    for (const personId of country.coRulerIds ?? []) addRuler(personId);
    for (const person of formerRulersByCountry.get(country.id) ?? []) addRuler(person.id);
  }

  const created: number[] = [];
  for (const [familyId, rulers] of rulerIds) {
    if (rulers.size < MIN_DYNASTY_RULERS ||
      (memberIds.get(familyId)?.size ?? 0) < MIN_DYNASTY_MEMBERS ||
      world.dynastyEmblems[familyId]?.emblemSpec) continue;
    world.dynastyEmblems[familyId] = {
      id: familyId,
      ...createEntityEmblem(world.seed, 'dynasty', familyId, 'dynasty-coat'),
    };
    created.push(familyId);
  }
  return created;
}

/** Возвращает старшего живого члена, а если живых нет — старшего известного члена. */
export function dynastyFocusPersonId(people: readonly Person[], familyId: number): number | undefined {
  const members = people.filter((person) => person.familyId === familyId);
  const living = members.filter((person) => person.alive);
  const candidates = living.length ? living : members;
  return candidates.sort((first, second) => first.bornAt - second.bornAt || first.id - second.id)[0]?.id;
}
