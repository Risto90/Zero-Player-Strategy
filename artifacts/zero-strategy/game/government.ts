import { NAMES } from './config';
import { randomItem } from './random';

export type GovernmentId = 'tribal' | 'monarchy' | 'republic' | 'empire';

export interface Person {
  name: string;
  age: number;
  trait: string;
  since: number;
}

export interface Government {
  id: GovernmentId;
  name: string;
  successor: boolean;
  modifiers: string[];
  /** Extra population levels gained per development mark, beyond the usual +1. */
  development: number;
}

export const GOVERNMENTS: Record<GovernmentId, Government> = {
  tribal: { id: 'tribal', name: 'Племенной союз', successor: false, modifiers: ['Развитие: +0'], development: 0 },
  monarchy: { id: 'monarchy', name: 'Монархия', successor: true, modifiers: ['Развитие: +1', 'Наследственная власть'], development: 1 },
  republic: { id: 'republic', name: 'Республика', successor: false, modifiers: ['Развитие: +2', 'Выборная власть'], development: 2 },
  empire: { id: 'empire', name: 'Империя', successor: true, modifiers: ['Развитие: +1', 'Наследственная власть', 'Большая держава'], development: 1 },
};

const GIVEN = ['Арен', 'Белан', 'Велимир', 'Гелия', 'Дарен', 'Елена', 'Зария', 'Илар', 'Кай', 'Лея', 'Мирон', 'Нарис', 'Орина', 'Радан', 'Севир', 'Тария', 'Фарен', 'Элина'];
const TRAITS = ['Дальновидный', 'Решительный', 'Уступчивый', 'Амбициозный', 'Осторожный', 'Харизматичный'];

export function governmentOf(value: string | undefined | null): Government {
  if (value && value in GOVERNMENTS) return GOVERNMENTS[value as GovernmentId];
  if (value === 'Монархия') return GOVERNMENTS.monarchy;
  if (value === 'Республика') return GOVERNMENTS.republic;
  if (value === 'Империя') return GOVERNMENTS.empire;
  return GOVERNMENTS.tribal;
}

export function createPerson(year: number, age = 20 + Math.floor(Math.random() * 26)): Person {
  return { name: randomItem(GIVEN), age, trait: randomItem(TRAITS), since: year };
}

export function initialGovernment(year: number): { government: GovernmentId; ruler: Person; heir: Person | null } {
  const government: GovernmentId = 'tribal';
  return { government, ruler: createPerson(year), heir: null };
}

export function ensureCountryLeaders(country: {
  government: string;
  ruler?: Person | null;
  heir?: Person | null;
  rulerSince?: number;
}, year: number): void {
  const gov = governmentOf(country.government);
  country.government = gov.id;
  if (!country.ruler) country.ruler = createPerson(year);
  country.rulerSince ??= country.ruler.since ?? year;
  if (gov.successor && !country.heir) country.heir = createPerson(year, 16 + Math.floor(Math.random() * 20));
  if (!gov.successor) country.heir = null;
}

export function changeGovernment(country: {
  government: string;
  ruler?: Person | null;
  heir?: Person | null;
  rulerSince?: number;
}, next: GovernmentId, year: number): void {
  country.government = next;
  if (!country.ruler) country.ruler = createPerson(year);
  if (GOVERNMENTS[next].successor) {
    if (!country.heir) country.heir = createPerson(year, 16 + Math.floor(Math.random() * 20));
  } else country.heir = null;
}

export function advanceLeaders(countries: {
  government: string;
  ruler?: Person | null;
  heir?: Person | null;
  rulerSince?: number;
}[], year: number): void {
  for (const country of countries) {
    ensureCountryLeaders(country, year);
    country.ruler!.age += 1;
    if (country.heir) country.heir.age += 1;
  }
}

export function uniqueLeader(countryId: number, year: number): Person {
  const person = createPerson(year);
  return { ...person, name: `${person.name} ${countryId + 1}` };
}
