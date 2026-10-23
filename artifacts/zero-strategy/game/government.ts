import { randomItem } from './random';

export type GovernmentId = 'tribal' | 'hereditary' | 'tyranny' | 'republic';
export type GovernmentModifierId =
  | 'theocracy' | 'ethnic' | 'liberal' | 'communist' | 'patriarchal' | 'matriarchal'
  | 'meritocracy' | 'seniority' | 'minority' | 'primogeniture' | 'oligarchy' | 'partition'
  | 'pornocracy' | 'term' | 'termLimit' | 'continuous' | 'consulate' | 'federation'
  | 'confederation' | 'coRule';
export type Gender = 'female' | 'male';

export interface Person {
  id: number;
  name: string;
  age: number;
  gender: Gender;
  trait: string;
  since: number;
  alive: boolean;
  parents: number[];
  spouseIds: number[];
  familyId: number;
  cultureId: number;
  religionId: number | null;
}

export interface Government {
  id: GovernmentId;
  name: string;
  modifiers: string[];
  development: number;
}

export interface Modifier {
  id: GovernmentModifierId;
  name: string;
  effect: string;
  excludes?: GovernmentModifierId[];
  forms?: GovernmentId[];
}

export const GOVERNMENTS: Record<GovernmentId, Government> = {
  tribal: { id: 'tribal', name: 'Племенная', modifiers: ['Олигархия'], development: 0 },
  hereditary: { id: 'hereditary', name: 'Наследственная', modifiers: ['Первородство'], development: 1 },
  tyranny: { id: 'tyranny', name: 'Тирания', modifiers: [], development: 0 },
  republic: { id: 'republic', name: 'Республика', modifiers: ['Срок правления'], development: 2 },
};

export const MODIFIERS: Record<GovernmentModifierId, Modifier> = {
  theocracy: { id: 'theocracy', name: 'Теократия', effect: 'При выборе правителя предпочитается ведущая вера; наследники должны разделять веру правителя.' },
  ethnic: { id: 'ethnic', name: 'Этническая', effect: 'При выборе вождя или правителя предпочитается ведущая культура.' },
  liberal: { id: 'liberal', name: 'Либеральная', effect: 'Культура и вера кандидата не влияют на шансы выбора.' },
  communist: { id: 'communist', name: 'Коммунистическая', effect: 'При выборе правителя предпочтение космополитам; несовместима с наследственной формой.' },
  patriarchal: { id: 'patriarchal', name: 'Патриархальная', effect: 'Правителем может стать только мужчина.', excludes: ['matriarchal'] },
  matriarchal: { id: 'matriarchal', name: 'Матриархальная', effect: 'Правителем может стать только женщина.', excludes: ['patriarchal'] },
  meritocracy: { id: 'meritocracy', name: 'Меритократия', effect: 'Дети и подростки не могут стать правителями.', forms: ['tribal', 'hereditary', 'tyranny'] },
  seniority: { id: 'seniority', name: 'Сеньорат', effect: 'Наследует старший подходящий член династии.', excludes: ['minority', 'oligarchy'], forms: ['tribal', 'hereditary', 'tyranny'] },
  minority: { id: 'minority', name: 'Минорат', effect: 'Наследует младший подходящий член династии.', excludes: ['seniority'], forms: ['tribal', 'hereditary', 'tyranny'] },
  primogeniture: { id: 'primogeniture', name: 'Первородство', effect: 'Приоритет у старшего подходящего ребёнка правителя.', forms: ['tribal', 'hereditary', 'tyranny'] },
  oligarchy: { id: 'oligarchy', name: 'Олигархия', effect: 'Кандидат выбирается случайно из правящей семьи; в республике дети прежних правителей получают приоритет.', excludes: ['seniority', 'minority'], forms: ['tribal', 'hereditary', 'republic'] },
  partition: { id: 'partition', name: 'Разделение', effect: 'При наследовании нескольких детей территория делится между наследниками.', excludes: ['coRule'], forms: ['tribal', 'hereditary'] },
  pornocracy: { id: 'pornocracy', name: 'Порнократия', effect: 'Супруги и возлюбленные правителя включаются в линию наследования.' },
  term: { id: 'term', name: 'Срок правления', effect: 'Республиканский лидер переизбирается по окончании срока.', forms: ['republic'] },
  termLimit: { id: 'termLimit', name: 'Ограничение сроков', effect: 'Один лидер может занимать пост ограниченное число раз.', forms: ['republic'] },
  continuous: { id: 'continuous', name: 'Непрерывное правление', effect: 'Действующий лидер может быть переизбран; доступно при нескольких сроках.', forms: ['republic'] },
  consulate: { id: 'consulate', name: 'Консулат', effect: 'Несколько соправителей делят управление; ослабляет экспансию.', excludes: ['coRule'] },
  federation: { id: 'federation', name: 'Федерация', effect: 'Удваивает вероятность раскола и мирного объединения.' , excludes: ['confederation'], forms: ['tribal', 'hereditary', 'republic'] },
  confederation: { id: 'confederation', name: 'Конфедерация', effect: 'Утраивает вероятность раскола и мирного объединения.', excludes: ['federation'], forms: ['tribal', 'hereditary'] },
  coRule: { id: 'coRule', name: 'Соправительство', effect: 'Правитель делит полномочия с членом семьи.', excludes: ['partition'], forms: ['tribal', 'hereditary', 'tyranny'] },
};

const GIVEN = ['Арен', 'Белан', 'Велимир', 'Гелия', 'Дарен', 'Елена', 'Зария', 'Илар', 'Кай', 'Лея', 'Мирон', 'Нарис', 'Орина', 'Радан', 'Севир', 'Тария', 'Фарен', 'Элина'];
const FAMILY = ['Аст', 'Бор', 'Вел', 'Гед', 'Кир', 'Лир', 'Мор', 'Нор', 'Рав', 'Сол', 'Тар', 'Эр'];
const TRAITS = ['Дальновидный', 'Решительный', 'Уступчивый', 'Амбициозный', 'Осторожный', 'Харизматичный', 'Фанатик', 'Циник', 'Космополит', 'Националист', 'Плодовитый'];
let nextPersonId = 1;
const pick = <T,>(items: T[]): T => randomItem(items);
export function ageStage(age: number): string {
  if (age < 3) return 'младенец';
  if (age <= 7) return 'ребёнок';
  if (age <= 11) return 'отрок';
  if (age <= 19) return 'подросток';
  if (age <= 28) return 'молодой';
  if (age <= 45) return 'зрелый';
  if (age <= 65) return 'пожилой';
  return 'старик';
}
export function createPerson(year: number, age = 20 + Math.floor(Math.random() * 26), familyId = nextPersonId, parents: number[] = [], cultureId = 0, religionId: number | null = null): Person {
  const id = nextPersonId++;
  const gender: Gender = Math.random() < 0.5 ? 'female' : 'male';
  return { id, name: pick(GIVEN), age, gender, trait: pick(TRAITS), since: year, alive: true, parents, spouseIds: [], familyId, cultureId, religionId };
}
export function createFamilyId(): number { return nextPersonId++; }
export function governmentOf(value: string | undefined | null): Government {
  if (value && value in GOVERNMENTS) return GOVERNMENTS[value as GovernmentId];
  if (value === 'Монархия' || value === 'Империя') return GOVERNMENTS.hereditary;
  if (value === 'Республика') return GOVERNMENTS.republic;
  if (value === 'Тирания') return GOVERNMENTS.tyranny;
  return GOVERNMENTS.tribal;
}
export function initialGovernment(year: number, cultureId = 0, religionId: number | null = null) {
  const familyId = createFamilyId();
  return { government: 'tribal' as GovernmentId, ruler: createPerson(year, 20 + Math.floor(Math.random() * 26), familyId, [], cultureId, religionId), heir: null as Person | null, rulerSince: year, characters: [] as Person[], modifiers: ['oligarchy'] as GovernmentModifierId[] };
}
export function normalizeCountry(country: {
  government: string; ruler?: Person | null; heir?: Person | null; rulerSince?: number;
  characters?: Person[]; modifiers?: GovernmentModifierId[]; cultureId?: number; religionId?: number | null;
}, year: number): void {
  country.government = governmentOf(country.government).id;
  country.modifiers ??= GOVERNMENTS[governmentOf(country.government).id].modifiers as GovernmentModifierId[];
  country.characters ??= [];
  for (const p of country.characters) nextPersonId = Math.max(nextPersonId, p.id + 1);
  if (!country.ruler) country.ruler = createPerson(year, 25, createFamilyId(), [], country.cultureId ?? 0, country.religionId ?? null);
  nextPersonId = Math.max(nextPersonId, country.ruler.id + 1);
  const existing = country.characters.find((p) => p.id === country.ruler!.id);
  if (existing) country.ruler = existing;
  else country.characters.push(country.ruler);
  country.rulerSince ??= country.ruler.since ?? year;
  if (country.heir) {
    const heir = country.characters.find((p) => p.id === country.heir!.id);
    if (heir) country.heir = heir;
    else country.characters.push(country.heir);
  }
  if (governmentOf(country.government).id !== 'hereditary' && country.government !== 'tyranny' && !country.modifiers.includes('oligarchy')) country.heir = null;
}
export function changeGovernment(country: { government: string; modifiers?: GovernmentModifierId[] }, next: GovernmentId): void {
  country.government = next;
  country.modifiers = [...GOVERNMENTS[next].modifiers] as GovernmentModifierId[];
}
export function availableModifiers(form: GovernmentId, current: GovernmentModifierId[]): GovernmentModifierId[] {
  return (Object.keys(MODIFIERS) as GovernmentModifierId[]).filter((id) => {
    const m = MODIFIERS[id];
    return (!m.forms || m.forms.includes(form)) && !current.includes(id) && !(m.excludes ?? []).some((x) => current.includes(x)) &&
      !(id === 'continuous' && !current.includes('termLimit')) && !(id === 'termLimit' && !current.includes('term'));
  });
}
export function applyModifier(current: GovernmentModifierId[], id: GovernmentModifierId): GovernmentModifierId[] {
  const result = current.filter((m) => !(MODIFIERS[id].excludes ?? []).includes(m));
  if (id === 'confederation') return [...result.filter((m) => m !== 'federation'), id];
  return [...result, id];
}
export function deathChance(age: number): number {
  if (age < 3) return 1 - Math.pow(1 - 0.33, 1 / 3);
  if (age <= 7) return 1 - Math.pow(1 - 0.20, 1 / 5);
  if (age <= 11) return 0.01;
  if (age <= 19) return 1 - Math.pow(1 - 0.10, 1 / 8);
  if (age <= 28) return 0.01;
  if (age <= 45) return 0.01;
  if (age <= 65) return 0.01;
  return Math.min(0.99, (age - 56) / 100);
}
export function uniqueLeader(countryId: number, year: number): Person {
  const person = createPerson(year, 29 + Math.floor(Math.random() * 17), createFamilyId());
  person.name = `${person.name} ${pick(FAMILY)}${countryId + 1}`;
  return person;
}
