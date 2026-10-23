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
  familyName: string;
  cultureId: number;
  religionId: number | null;
  countryId: number;
  bornAt: number;
  deathYear: number | null;
  deathReason: string | null;
  betrothedId: number | null;
  loverIds: number[];
  friendIds: number[];
  traits: string[];
  formerRulerOf: number[];
  lastBirthYear: number | null;
}

export interface PoliticalState {
  government: GovernmentId;
  modifiers: GovernmentModifierId[];
  ruler: Person;
  heir: Person | null;
  rulerSince: number;
  previousRulerIds: number[];
  dynastyClaims: number[];
  coRulerIds: number[];
  termYears: number;
  maxTerms: number;
  consulCount: number;
  seatSince: Record<number, number>;
  termCounts: Record<number, number>;
  barredRulerIds: number[];
  pendingDeathIds: number[];
  /** Timed political pressure: repeat events extend and double strength. */
  pressures: Record<string, { until: number; strength: number }>;
}

export interface Government {
  id: GovernmentId;
  name: string;
  modifiers: GovernmentModifierId[];
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
  tribal: { id: 'tribal', name: 'Племенная', modifiers: ['oligarchy'], development: 0 },
  hereditary: { id: 'hereditary', name: 'Наследственная', modifiers: ['primogeniture'], development: 0 },
  tyranny: { id: 'tyranny', name: 'Тирания', modifiers: [], development: 0 },
  republic: { id: 'republic', name: 'Республика', modifiers: [], development: 0 },
};

export const MODIFIERS: Record<GovernmentModifierId, Modifier> = {
  theocracy: { id: 'theocracy', name: 'Теократия', effect: 'Республика: ведущая вера. Наследование: вера правителя. Племя: вес веры прежнего вождя и ведущей веры его культуры ×2. Религиозные карты чаще.' },
  ethnic: { id: 'ethnic', name: 'Этническая', effect: 'Республика: ведущая культура. Наследование: культура правителя. Племя: ведущая культура ×4, культура прошлого вождя ×2.' },
  liberal: { id: 'liberal', name: 'Либеральная', effect: 'Равный вес существующих сочетаний культуры и веры, кроме ограничений этничности и теократии.', forms: ['tribal', 'hereditary', 'republic'] },
  communist: { id: 'communist', name: 'Коммунистическая', effect: 'Только через силовую реформу. Приоритет атеистам и космополитам; культуры равновероятны, вес атеистов ×2; космополит у нового лидера с шансом 50%.', forms: ['tribal', 'republic', 'tyranny'] },
  patriarchal: { id: 'patriarchal', name: 'Патриархальная', effect: 'Правителем может стать только мужчина.', excludes: ['matriarchal'] },
  matriarchal: { id: 'matriarchal', name: 'Матриархальная', effect: 'Правителем может стать только женщина.', excludes: ['patriarchal'] },
  meritocracy: { id: 'meritocracy', name: 'Меритократия', effect: 'Дети и подростки не могут стать правителями.', forms: ['tribal', 'hereditary', 'tyranny'] },
  seniority: { id: 'seniority', name: 'Сеньорат', effect: 'Наследует старший подходящий член династии.', excludes: ['minority', 'oligarchy', 'primogeniture'], forms: ['tribal', 'hereditary', 'tyranny'] },
  minority: { id: 'minority', name: 'Минорат', effect: 'Наследует младший подходящий член династии.', excludes: ['seniority'], forms: ['tribal', 'hereditary', 'tyranny'] },
  primogeniture: { id: 'primogeniture', name: 'Первородство', effect: 'Старший ребёнок, затем потомки покойных детей по ветвям. С миноратом — младшая ветвь.', excludes: ['seniority'], forms: ['tribal', 'hereditary', 'tyranny'] },
  oligarchy: { id: 'oligarchy', name: 'Олигархия', effect: 'Кандидат выбирается случайно из правящей семьи; в республике дети прежних правителей получают приоритет.', excludes: ['seniority', 'minority'], forms: ['tribal', 'hereditary', 'republic'] },
  partition: { id: 'partition', name: 'Разделение', effect: 'При наследовании нескольких детей территория делится между наследниками.', excludes: ['coRule'], forms: ['tribal', 'hereditary'] },
  pornocracy: { id: 'pornocracy', name: 'Порнократия', effect: 'Партнёры прежнего лидера — первые; партнёр наследника стоит перед ним и освобождён от ограничения пола.', forms: ['tribal', 'hereditary', 'tyranny'] },
  term: { id: 'term', name: 'Срок правления', effect: 'Республиканский лидер переизбирается по окончании срока.', forms: ['republic'] },
  termLimit: { id: 'termLimit', name: 'Ограничение сроков', effect: 'Один лидер может занимать пост ограниченное число раз.', forms: ['republic'] },
  continuous: { id: 'continuous', name: 'Непрерывное правление', effect: 'Действующий лидер может быть переизбран; доступно при нескольких сроках.', forms: ['republic'] },
  consulate: { id: 'consulate', name: 'Консулат', effect: '2–7 правителей с отдельными сроками. Реформы, экспансия и восстания представленных групп ослаблены в X раз.', excludes: ['coRule'], forms: ['tribal', 'hereditary', 'republic'] },
  federation: { id: 'federation', name: 'Федерация', effect: 'Вдвое снижает риск восстаний большинства в регионах, удваивает вероятность мирного раскола и объединения соседей.', excludes: ['confederation'], forms: ['tribal', 'hereditary', 'republic'] },
  confederation: { id: 'confederation', name: 'Конфедерация', effect: 'Утраивает вероятность раскола и мирного объединения.', excludes: ['federation'], forms: ['tribal', 'hereditary'] },
  coRule: { id: 'coRule', name: 'Соправительство', effect: 'Правитель делит полномочия с членом семьи не младше 12 лет; тот же возрастной допуск действует при назначении преемника.', excludes: ['partition', 'consulate'], forms: ['tribal', 'hereditary', 'tyranny'] },
};

const GIVEN: Record<Person['gender'], string[]> = {
  male: ['Арен', 'Белан', 'Велимир', 'Дарен', 'Илар', 'Кай', 'Мирон', 'Радан', 'Севир', 'Фарен'],
  female: ['Гелия', 'Елена', 'Зария', 'Лея', 'Нарис', 'Орина', 'Тария', 'Элина'],
};
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
/** A stable, readable surname for each dynasty ID; it never leaks numeric IDs into the UI. */
export function familyNameForId(familyId: number): string {
  const parts: string[] = [];
  let remaining = Math.max(0, Math.floor(familyId));
  do {
    parts.push(FAMILY[remaining % FAMILY.length]);
    remaining = Math.floor(remaining / FAMILY.length);
  } while (remaining > 0);
  return parts.reverse().join('-');
}
function inFamily(name: string, familyName: string): string {
  const givenName = name.trim().split(/\s+/)[0] || 'Персонаж';
  return `${givenName} ${familyName}`;
}
export function createPerson(year: number, age = 20 + Math.floor(Math.random() * 26), familyId = nextPersonId, parents: number[] = [], cultureId = 0, religionId: number | null = null): Person {
  const id = nextPersonId++;
  const gender: Gender = Math.random() < 0.5 ? 'female' : 'male';
  const trait = age >= 3 ? pick(TRAITS) : '';
  const familyName = familyNameForId(familyId);
  return { id, name: inFamily(pick(GIVEN[gender]), familyName), age, gender, trait, since: year, alive: true, parents, spouseIds: [], familyId, familyName, cultureId, religionId,
    countryId: -1, bornAt: year - age - Math.random(), deathYear: null, deathReason: null, betrothedId: null,
    loverIds: [], friendIds: [], traits: trait ? [trait] : [], formerRulerOf: [], lastBirthYear: null };
}
export function createFamilyId(): number { return nextPersonId++; }
export function reservePersonId(id: number): void { if (Number.isFinite(id)) nextPersonId = Math.max(nextPersonId, id + 1); }
export function governmentOf(value: string | undefined | null): Government {
  if (value && value in GOVERNMENTS) return GOVERNMENTS[value as GovernmentId];
  if (value === 'Монархия' || value === 'Империя' || value === 'monarchy' || value === 'empire') return GOVERNMENTS.hereditary;
  if (value === 'Республика') return GOVERNMENTS.republic;
  if (value === 'Тирания') return GOVERNMENTS.tyranny;
  return GOVERNMENTS.tribal;
}
export function initialGovernment(year: number, cultureId = 0, religionId: number | null = null) {
  const familyId = createFamilyId();
  return { government: 'tribal' as GovernmentId, ruler: createPerson(year, 29 + Math.floor(Math.random() * 17), familyId, [], cultureId, religionId), heir: null as Person | null, rulerSince: year, modifiers: ['oligarchy'] as GovernmentModifierId[],
    previousRulerIds: [], dynastyClaims: [familyId], coRulerIds: [], termYears: 4, maxTerms: 1, consulCount: 2,
    seatSince: {}, termCounts: {}, barredRulerIds: [], pendingDeathIds: [], pressures: {} };
}
export function availableModifiers(form: GovernmentId, current: GovernmentModifierId[]): GovernmentModifierId[] {
  return (Object.keys(MODIFIERS) as GovernmentModifierId[]).filter((id) => {
    const m = MODIFIERS[id];
    if (current.includes(id) || (m.forms && !m.forms.includes(form) && !(id === 'federation' && form === 'tyranny' && current.includes('communist')))) return false;
    if (id === 'communist' && form === 'hereditary') return false;
    if (id === 'communist' && current.includes('theocracy') && current.includes('ethnic')) return true;
    if (id === 'federation' && form === 'tyranny' && !current.includes('communist')) return false;
    if (id === 'confederation' && form === 'tyranny') return false;
    if (id === 'oligarchy' && form === 'tyranny') return false;
    if (id === 'consulate' && (form === 'tyranny' || current.includes('coRule'))) return false;
    if (id === 'coRule' && (form === 'republic' || current.includes('consulate'))) return false;
    if ((id === 'partition' || id === 'pornocracy' || id === 'seniority' || id === 'minority' || id === 'primogeniture' || id === 'meritocracy') && form === 'republic') return false;
    if (id === 'continuous' && (!current.includes('termLimit') || form !== 'republic')) return false;
    if (id === 'termLimit' && (!current.includes('term') || form !== 'republic')) return false;
    if (id === 'term' && form !== 'republic') return false;
    return !(m.excludes ?? []).some((x) => current.includes(x) &&
      !((id === 'federation' && x === 'confederation') || (id === 'confederation' && x === 'federation')));
  });
}
export function applyModifier(current: GovernmentModifierId[], id: GovernmentModifierId): GovernmentModifierId[] {
  const result = current.filter((m) => !(MODIFIERS[id].excludes ?? []).includes(m));
  if (id === 'confederation' || id === 'federation') return [...result.filter((m) => m !== 'federation' && m !== 'confederation'), id];
  if (id === 'communist') return [...result.filter((m) => m !== 'theocracy' && m !== 'ethnic'), id];
  if ((id === 'theocracy' || id === 'ethnic') && result.includes('communist')) {
    return [...result.filter((m) => m !== 'communist'), id];
  }
  if (id === 'liberal' && result.includes('theocracy') && result.includes('ethnic')) {
    return [...result.filter((m) => m !== 'theocracy' && m !== 'ethnic'), id];
  }
  const merged = [...result, id];
  if ((id === 'theocracy' || id === 'ethnic') && merged.includes('liberal') && merged.includes('theocracy') && merged.includes('ethnic')) {
    return merged.filter((m) => m !== 'liberal');
  }
  return [...result, id];
}
export function deathChance(age: number): number {
  if (age < 3) return 1 - Math.pow(1 - 0.33, 1 / 3);
  if (age <= 7) return 1 - Math.pow(1 - 0.20, 1 / 5);
  if (age <= 11) return 1 - Math.pow(1 - 0.01, 1 / 4);
  if (age <= 19) return 1 - Math.pow(1 - 0.10, 1 / 8);
  if (age <= 28) return 1 - Math.pow(0.99 * 0.99, 1 / 9);
  if (age <= 45) return 1 - Math.pow(0.99 * 0.95, 1 / 17);
  if (age <= 65) return 1 - Math.pow(0.99 * 0.85, 1 / 20);
  // The design specifies an annual, increasing death risk for old age.
  return Math.min(1, (age - 56) / 100);
}
export function uniqueLeader(_countryId: number, year: number): Person {
  return createPerson(year, 29 + Math.floor(Math.random() * 17), createFamilyId());
}
