import { randomItem } from './random';
import { defaultHumanOriginMix, humanAgeStage, type HumanOriginMix } from './human';

export type GovernmentId = 'tribal' | 'hereditary' | 'tyranny' | 'republic';
export type GovernmentModifierId =
  | 'theocracy' | 'ethnic' | 'liberal' | 'communist' | 'patriarchal' | 'matriarchal'
  | 'meritocracy' | 'seniority' | 'minority' | 'primogeniture' | 'oligarchy' | 'partition'
  | 'pornocracy' | 'term' | 'termLimit' | 'continuous' | 'consulate' | 'federation'
  | 'confederation' | 'coRule';
export type Gender = 'female' | 'male';
export type NameStyleId =
  | 'given-family'
  | 'family-given'
  | 'russian-patronymic'
  | 'spanish-double-surname'
  | 'icelandic-patronymic'
  | 'arabic-nasab';
export interface SurnameAffix {
  position: 'prefix' | 'suffix';
  text: string;
}

export const NAME_STYLES: { id: NameStyleId; label: string }[] = [
  { id: 'given-family', label: 'Личное имя — фамилия' },
  { id: 'family-given', label: 'Фамилия — личное имя' },
  { id: 'russian-patronymic', label: 'Имя — отчество — фамилия' },
  { id: 'spanish-double-surname', label: 'Имя — фамилия отца — фамилия матери' },
  { id: 'icelandic-patronymic', label: 'Имя — имя родителя с окончанием -сон/-доттир' },
  { id: 'arabic-nasab', label: 'Имя — ибн/бинт — имя отца' },
];
const NAME_STYLE_IDS = NAME_STYLES.map((style) => style.id);

export function randomNameStyle(rng: () => number = Math.random): NameStyleId {
  return randomItem(NAME_STYLE_IDS, rng);
}

/** Deterministic style for old saves that predate per-culture name styles. */
export function legacyNameStyleForCulture(cultureId: number): NameStyleId {
  const index = Math.abs(Math.floor(Number.isFinite(cultureId) ? cultureId : 0)) % NAME_STYLE_IDS.length;
  return NAME_STYLE_IDS[index];
}

export interface PersonNameContext {
  style?: NameStyleId;
  fatherGivenName?: string;
  paternalSurname?: string;
  maternalSurname?: string;
  familyName?: string;
  familyCultureId?: number;
  surnameAffix?: SurnameAffix;
}

export interface Person {
  id: number;
  name: string;
  age: number;
  gender: Gender;
  trait: string;
  givenName: string;
  since: number;
  alive: boolean;
  parents: number[];
  spouseIds: number[];
  familyId: number;
  familyName: string;
  /** Cultural origin of the family name; descendants inherit this even if their culture differs. */
  familyCultureId?: number;
  cultureId: number;
  /** Independent origin composition; cultural and religious identities remain separate. */
  humanOrigin?: HumanOriginMix;
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

export interface RulerTerm {
  personId: number;
  startYear: number | null;
  endYear: number | null;
  office: 'ruler' | 'coRuler';
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
  /** One record per time a person held the ruler or co-ruler office. */
  rulerTerms: RulerTerm[];
  termYears: number;
  maxTerms: number;
  consulCount: number;
  seatSince: Record<number, number>;
  termCounts: Record<number, number>;
  barredRulerIds: number[];
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
  partition: { id: 'partition', name: 'Разделение', effect: 'При смерти правителя с несколькими подходящими родными детьми страна делится кистью: обычно поровну, а с другими законами наследования основной наследник получает половину, остаток делят остальные претенденты. Участки той же культуры или веры получают приоритет ×2, совпадение обеих — ×4.', excludes: ['coRule'], forms: ['tribal', 'hereditary'] },
  pornocracy: { id: 'pornocracy', name: 'Порнократия', effect: 'Наследственные формы: партнёры правителя и наследников входят в линию перед ними, без ограничения пола. Республика: партнёры правителя и допущенных кандидатов получают вес выбора ×2, но не наследуют.', forms: ['tribal', 'hereditary', 'tyranny', 'republic'] },
  term: { id: 'term', name: 'Срок правления', effect: 'Республиканский лидер переизбирается по окончании срока.', forms: ['republic'] },
  termLimit: { id: 'termLimit', name: 'Ограничение сроков', effect: 'Один лидер может занимать пост ограниченное число раз.', forms: ['republic'] },
  continuous: { id: 'continuous', name: 'Непрерывное правление', effect: 'Действующий лидер может быть переизбран; доступно при нескольких сроках.', forms: ['republic'] },
  consulate: { id: 'consulate', name: 'Консулат', effect: '2–7 равноправных правителей с отдельными сроками. Реформы, экспансия и восстания представленных групп ослаблены в X раз.', excludes: ['coRule'], forms: ['tribal', 'hereditary', 'republic'] },
  federation: { id: 'federation', name: 'Федерация', effect: 'Вдвое снижает риск восстаний большинства в регионах, удваивает вероятность мирного раскола и объединения соседей.', excludes: ['confederation'], forms: ['tribal', 'hereditary', 'republic'] },
  confederation: { id: 'confederation', name: 'Конфедерация', effect: 'Утраивает вероятность раскола и мирного объединения.', excludes: ['federation'], forms: ['tribal', 'hereditary'] },
  coRule: { id: 'coRule', name: 'Соправительство', effect: 'Правитель делит полномочия с членом семьи не младше 12 лет; тот же возрастной допуск действует при назначении преемника.', excludes: ['partition', 'consulate'], forms: ['tribal', 'hereditary', 'tyranny'] },
};

const GIVEN: Record<Person['gender'], string[]> = {
  male: ['Арен', 'Белан', 'Велимир', 'Дарен', 'Илар', 'Кай', 'Мирон', 'Радан', 'Севир', 'Фарен'],
  female: ['Гелия', 'Елена', 'Зария', 'Лея', 'Нарис', 'Орина', 'Тария', 'Элина'],
};
const AFFIX_SYLLABLES = ['ба', 'ке', 'лу', 'ми', 'ра', 'се', 'та', 'ве', 'но', 'ша', 'жи', 'ду', 'эла', 'ха', 'иро', 'мо'];
const SURNAME_AFFIXES: SurnameAffix[] = [
  ...AFFIX_SYLLABLES.flatMap((text) => [
    { position: 'prefix' as const, text },
    { position: 'suffix' as const, text },
  ]),
  ...AFFIX_SYLLABLES.flatMap((first) => AFFIX_SYLLABLES.map((second) => `${first}${second}`)).flatMap((text) => [
    { position: 'prefix' as const, text },
    { position: 'suffix' as const, text },
  ]),
];
const SURNAME_SYLLABLES = [
  'ба', 'бе', 'би', 'бо', 'бу', 'да', 'де', 'ди', 'до', 'ду', 'га', 'ге', 'ги', 'го', 'гу',
  'ка', 'ке', 'ки', 'ко', 'ку', 'ла', 'ле', 'ли', 'ло', 'лу', 'ма', 'ме', 'ми', 'мо', 'му',
  'на', 'не', 'ни', 'но', 'ну', 'ра', 'ре', 'ри', 'ро', 'ру', 'са', 'се', 'си', 'со', 'су',
  'та', 'те', 'ти', 'то', 'ту', 'ва', 'ве', 'ви', 'во', 'ву', 'жа', 'же', 'жи', 'жо', 'жу',
];
function seededSyllables(familyId: number, familyCultureId: number, variant: number): string {
  let state = (Math.imul(familyId + 1, 0x45d9f3b) ^ Math.imul(familyCultureId + 7, 0x27d4eb2d) ^ Math.imul(variant + 11, 0x165667b1)) >>> 0;
  const next = () => {
    state = (Math.imul(state ^ (state >>> 16), 0x45d9f3b) + 0x27100001) >>> 0;
    return state % SURNAME_SYLLABLES.length;
  };
  const count = 2 + (next() % 2);
  let stem = '';
  for (let i = 0; i < count; i += 1) stem += SURNAME_SYLLABLES[next()];
  return stem;
}
export function randomSurnameAffix(rng: () => number = Math.random, used: SurnameAffix[] = []): SurnameAffix {
  const key = (affix: SurnameAffix) => `${affix.position}:${affix.text}`;
  const occupied = new Set(used.map(key));
  const available = SURNAME_AFFIXES.filter((affix) => !occupied.has(key(affix)));
  return { ...(available.length ? randomItem(available, rng) : randomItem(SURNAME_AFFIXES, rng)) };
}
export function legacySurnameAffixForCulture(cultureId: number): SurnameAffix {
  const index = Math.abs(Math.floor(Number.isFinite(cultureId) ? cultureId : 0)) % SURNAME_AFFIXES.length;
  return { ...SURNAME_AFFIXES[index] };
}
const TRAITS = ['Дальновидный', 'Решительный', 'Уступчивый', 'Амбициозный', 'Осторожный', 'Харизматичный', 'Фанатик', 'Циник', 'Космополит', 'Националист', 'Плодовитый'];
let nextPersonId = 1;
export function personIdSequence(): number { return nextPersonId; }
export function restorePersonIdSequence(id: number): void { nextPersonId = id; }
const pick = <T,>(items: T[]): T => randomItem(items);
export function ageStage(age: number): string {
  return humanAgeStage(age);
}
export function personDeathStatus(person: Pick<Person, 'alive' | 'gender' | 'deathYear'>): string | null {
  if (person.alive) return null;
  const verb = person.gender === 'female' ? 'умерла' : 'умер';
  return person.deathYear === null || person.deathYear === undefined
    ? `${verb}, год смерти неизвестен`
    : `${verb} в ${person.deathYear} году`;
}
/** Repeatable syllable-built surname; the culture's fixed affix makes its sound pattern recognizable. */
export function familyNameForId(
  familyId: number,
  familyCultureId = 0,
  affix: SurnameAffix = legacySurnameAffixForCulture(familyCultureId),
  variant = 0,
): string {
  const stem = seededSyllables(
    Math.max(0, Math.floor(Number.isFinite(familyId) ? familyId : 0)),
    Math.max(0, Math.floor(Number.isFinite(familyCultureId) ? familyCultureId : 0)),
    Math.max(0, Math.floor(Number.isFinite(variant) ? variant : 0)),
  );
  const name = affix.position === 'prefix' ? `${affix.text}${stem}` : `${stem}${affix.text}`;
  return name.charAt(0).toLocaleUpperCase('ru-RU') + name.slice(1);
}

function patronymic(parentName: string, gender: Gender): string {
  if (/[я]$/u.test(parentName)) return `${parentName.slice(0, -1)}${gender === 'female' ? 'инична' : 'ич'}`;
  if (/[йь]$/u.test(parentName)) return `${parentName.slice(0, -1)}${gender === 'female' ? 'евна' : 'евич'}`;
  return `${parentName}${gender === 'female' ? 'овна' : 'ович'}`;
}

function genderedRussianSurname(surname: string, gender: Gender): string {
  if (gender === 'male') return surname;
  if (/(ов|ев|ёв|ин|ын)$/u.test(surname)) return `${surname}а`;
  if (/(ский|цкий)$/u.test(surname)) return surname.replace(/ий$/u, 'ая');
  return surname;
}

export function formatPersonName(
  givenName: string,
  familyName: string,
  gender: Gender,
  context: PersonNameContext = {},
): string {
  const style = context.style ?? 'given-family';
  const father = context.fatherGivenName?.trim();
  switch (style) {
    case 'family-given':
      return `${familyName} ${givenName}`;
    case 'russian-patronymic':
      return father
        ? `${givenName} ${patronymic(father, gender)} ${genderedRussianSurname(familyName, gender)}`
        : `${givenName} ${genderedRussianSurname(familyName, gender)}`;
    case 'spanish-double-surname': {
      const paternal = context.paternalSurname ?? familyName;
      const maternal = context.maternalSurname;
      return `${givenName} ${paternal}${maternal && maternal !== paternal ? ` ${maternal}` : ''}`;
    }
    case 'icelandic-patronymic':
      return father ? `${givenName} ${father}${gender === 'female' ? 'доттир' : 'сон'}` : givenName;
    case 'arabic-nasab':
      return father ? `${givenName} ${gender === 'female' ? 'бинт' : 'ибн'} ${father}` : givenName;
    default:
      return `${givenName} ${familyName}`;
  }
}

export function createPerson(
  year: number,
  age = 20 + Math.floor(Math.random() * 26),
  familyId = nextPersonId,
  parents: number[] = [],
  cultureId = 0,
  religionId: number | null = null,
  nameContext: PersonNameContext = {},
): Person {
  const id = nextPersonId++;
  const gender: Gender = Math.random() < 0.5 ? 'female' : 'male';
  const trait = age >= 3 ? pick(TRAITS) : '';
  const familyCultureId = nameContext.familyCultureId ?? cultureId;
  const familyName = nameContext.familyName ?? familyNameForId(familyId, familyCultureId, nameContext.surnameAffix);
  const givenName = pick(GIVEN[gender]);
  return { id, givenName, name: formatPersonName(givenName, familyName, gender, nameContext), age, gender, trait, since: year, alive: true, parents, spouseIds: [], familyId, familyName, familyCultureId, cultureId, religionId,
    humanOrigin: defaultHumanOriginMix(), countryId: -1, bornAt: year - age - Math.random(), deathYear: null, deathReason: null, betrothedId: null,
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
export function initialGovernment(year: number, cultureId = 0, religionId: number | null = null, nameStyle?: NameStyleId, surnameAffix?: SurnameAffix) {
  const familyId = createFamilyId();
  const ruler = createPerson(year, 29 + Math.floor(Math.random() * 17), familyId, [], cultureId, religionId, { style: nameStyle, familyCultureId: cultureId, surnameAffix });
  return { government: 'tribal' as GovernmentId, ruler, heir: null as Person | null, rulerSince: year, modifiers: ['oligarchy'] as GovernmentModifierId[],
    previousRulerIds: [], dynastyClaims: [familyId], coRulerIds: [], termYears: 4, maxTerms: 1, consulCount: 2,
    rulerTerms: [{ personId: ruler.id, startYear: year, endYear: null, office: 'ruler' as const }],
    seatSince: {}, termCounts: {}, barredRulerIds: [], pressures: {} };
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
    if ((id === 'partition' || id === 'seniority' || id === 'minority' || id === 'primogeniture' || id === 'meritocracy') && form === 'republic') return false;
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
