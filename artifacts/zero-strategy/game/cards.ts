import { CardPainter, type Card, type CardChoice, type CardType } from './brush';
import { BRUSH_SIZES, INK, MAP_PIXELS, MAX_COUNTRIES, RANKS } from './config';
import { forEachNeighbour } from './geography';
import { randomItem, weightedPick } from './random';
import { isActiveCountry, type Country, type World } from './world';
import { oldAgeDeathChance, randomDeathChance, personIdSequence, reservePersonId, restorePersonIdSequence, GOVERNMENTS, MODIFIERS, type GovernmentId, type GovernmentModifierId, type Person } from './government';
import { marriageCandidates, reformCandidates, type ReformProposal } from './politics';
import { candidateAllowed, leadershipOptions, successionOrder } from './succession';
import { arePartners, canMarry, livingPartners, newCitizen, person, related, trackedForCharacterCards } from './characters';
import { demography } from './demography';
import { colonizationPlan } from './colonization';
import { randomHumanOriginId } from './human';
import { CountryExpansionContourIndex } from './countryExpansionContours';
import {
  CityInfluenceIndex,
  cityAtUpperPopulationThreshold,
  cityAtWaningThreshold,
  cityInfluenceMultiplier,
  cityPopulationMinimum,
  cityRankName,
  populationAtPixel,
  upgradeableCities,
} from './settlements';
import type { City } from './world';

export const CARD_TITLES: Record<CardType, string> = {
  create: 'Создание государства',
  expand: 'Расширение страны',
  colonization: 'Колонизация',
  split: 'Раскол страны',
  buildCity: 'Создание города',
  upgradeCity: 'Расширение города',
  waneCity: 'Увядание города',
  moveCapital: 'Перенос столицы',
  nomadExpand: 'Расширение кочевья',
  drought: 'Засуха',
  rain: 'Ливни',
  desertification: 'Опустынивание',
  swamping: 'Заболачивание',
  warmCurrent: 'Тёплое течение',
  coldCurrent: 'Холодное течение',
  warmWind: 'Тёплый ветер',
  coldWind: 'Холодный ветер',
  faith: 'Возникновение веры',
  culture: 'Выделение культуры',
  government: 'Политическая реформа',
  succession: 'Передача престола',
  election: 'Новые выборы',
  marriage: 'Брак',
  birth: 'Рождение ребёнка',
  death: 'Смерть',
  character: 'Событие персонажа',
  revolt: 'Переворот',
  union: 'Объединение',
};

const STANDARD_EXPANSION_RADIUS = BRUSH_SIZES[1].radius;
let standardExpansionPassPixels = 0;
for (let y = -STANDARD_EXPANSION_RADIUS; y <= STANDARD_EXPANSION_RADIUS; y += 1) {
  for (let x = -STANDARD_EXPANSION_RADIUS; x <= STANDARD_EXPANSION_RADIUS; x += 1) {
    if (x * x + y * y <= STANDARD_EXPANSION_RADIUS * STANDARD_EXPANSION_RADIUS) standardExpansionPassPixels += 1;
  }
}
// Город собирает 10% населения из немодифицированной сферы; ориентир равен пяти мазкам стандартной кисти M.
const CITY_DENSITY_REFERENCE = 5 * standardExpansionPassPixels / (0.1 * RANKS[0].ink);

type Polity = Country;
/**
 * Один объект — одна отдельная карта в общем розыгрыше.
 * Если дизайн-док не задаёт процентный базовый шанс, baseWeight равен 1;
 * численные веса ниже являются только явно заданными шансами или множителями.
 * Для персонажей ключ обязательно включает конкретного участника события,
 * чтобы адаптивный множитель каждого персонажа накапливался отдельно.
 */
type CardDrawOption = {
  key: string;
  weight: number;
  baseWeight?: number;
  available?: (world: World, polity: Polity | null) => boolean;
  value: (world: World, polity: Polity | null) => Card;
};
type PreparedCard = {
  card: Card;
  additions: {
    countries: World['countries'];
    cultures: World['cultures'];
    religions: World['religions'];
    people: World['people'];
  };
  nextPersonId: number;
};

export interface CardDrawTraceChoice {
  key: string;
  baseWeight: number;
  programmedWeight: number;
  programmedMultiplier: number | null;
  adaptiveMultiplier: number;
  baseProbability: number;
  actualProbability: number;
}

export interface CardDrawTraceEvent {
  year: number;
  scope: string;
  countryId: number | null;
  countryType: Country['type'] | null;
  government: Country['government'] | null;
  modifiers: GovernmentModifierId[];
  selectedKey: string | null;
  cardType: CardType | null;
  choices: CardDrawTraceChoice[];
}

let cardDrawTraceListener: ((event: CardDrawTraceEvent) => void) | null = null;

export function setCardDrawTraceListener(
  listener: ((event: CardDrawTraceEvent) => void) | null,
): void {
  cardDrawTraceListener = listener;
}

export function normalizedCardProbabilities(
  options: { key: string; weight: number }[],
  multipliers: Record<string, number> = {},
  scope = '',
): { key: string; probability: number }[] {
  const adjusted = options
    .map((option) => ({
      key: option.key,
      weight: option.weight * (multipliers[scope ? `${scope}:${option.key}` : option.key] ?? 1),
    }))
    .filter((option) => Number.isFinite(option.weight) && option.weight > 0);
  const total = adjusted.reduce((sum, option) => sum + option.weight, 0);
  return total > 0 ? adjusted.map((option) => ({ key: option.key, probability: option.weight / total })) : [];
}

function traceCardDraw(
  world: World,
  scope: string,
  year: number,
  polity: Polity | null,
  options: CardDrawOption[],
  selectedKey: string | null,
  cardType: CardType | null,
): void {
  const listener = cardDrawTraceListener;
  if (!listener) return;
  const makeChoices = (drawOptions: CardDrawOption[]) => {
    const actual = normalizedCardProbabilities(
      drawOptions.map((option) => ({ key: option.key, weight: option.weight })),
      world.cardMultipliers,
      scope,
    );
    // Адаптивный множитель учитывается и в базе; здесь убираются только запрограммированные множители.
    const baseline = normalizedCardProbabilities(
      drawOptions.map((option) => ({ key: option.key, weight: option.baseWeight ?? 1 })),
      world.cardMultipliers,
      scope,
    );
    const actualByKey = new Map(actual.map((option) => [option.key, option.probability]));
    const baselineByKey = new Map(baseline.map((option) => [option.key, option.probability]));
    return drawOptions.map((option) => {
      const baseWeight = option.baseWeight ?? 1;
      return {
        key: option.key,
        baseWeight,
        programmedWeight: option.weight,
        programmedMultiplier: baseWeight > 0 ? option.weight / baseWeight : null,
        adaptiveMultiplier: world.cardMultipliers[`${scope}:${option.key}`] ?? 1,
        baseProbability: baselineByKey.get(option.key) ?? 0,
        actualProbability: actualByKey.get(option.key) ?? 0,
      };
    });
  };
  const choices = makeChoices(options);
  listener({
    year,
    scope,
    countryId: polity?.id ?? null,
    countryType: polity?.type ?? null,
    government: polity?.government ?? null,
    modifiers: polity ? [...polity.modifiers] : [],
    selectedKey,
    cardType,
    choices,
  });
}

export function updateCardDrawMultipliers(
  scope: string,
  probabilities: { key: string; probability: number }[],
  drawnKey: string,
  multipliers: Record<string, number>,
): void {
  const drawn = probabilities.find((candidate) => candidate.key === drawnKey);
  if (!drawn) throw new Error(`Drawn card ${drawnKey} was not in the probability distribution.`);
  // У каждого ключа — своя карта, в том числе у смерти, брака, помолвки и рождения
  // конкретного персонажа. Здесь нельзя объединять эти вероятности в общую «карту жизни».
  for (const candidate of probabilities) {
    const key = `${scope}:${candidate.key}`;
    if (candidate.key === drawnKey) multipliers[key] = 1;
    else if (candidate.probability > drawn.probability) multipliers[key] = (multipliers[key] ?? 1) * 1.1;
  }
}

function isNomad(polity: Polity): boolean {
  return polity.type === 'nomadic';
}

function makeCard(type: CardType, ink: number, target: Polity | null, detail: string, hint: number): Card {
  return {
    type,
    title: CARD_TITLES[type],
    detail,
    ink,
    inkTotal: ink,
    targetCountryId: target?.id ?? null,
    newCountryId: null,
    newCultureId: null,
    newReligionId: null,
    sourceCultureId: null,
    newGovernmentId: null,
    newRuler: null,
    choices: null,
    selectedChoice: 0,
    characterEvent: null,
    hint,
  };
}

/**
 * Защита инварианта розыгрыша: генератор уже выбранной карты не может вернуть
 * пустой результат, чтобы отказаться от карты или запустить переброс.
 */
function requireCard(card: Card | null, key: string): Card {
  if (!card) throw new Error(`Карта «${key}» прошла проверку доступности, но не была создана.`);
  return card;
}

function drawNomadicCountryCard(world: World, nomad: Country, year: number): Card | null {
  if (!nomad.range?.length) return null;
  const countryCount = world.countries.filter(isActiveCountry).length;
  const citySite = countryCount < MAX_COUNTRIES
    ? nomad.range.find((pixel) => world.land[pixel] && world.owner[pixel] === 0 && !world.cityAt(pixel))
    : undefined;
  const population = (nomad.cells ?? []).reduce((sum, cell) => sum + cell.population, 0);
  const density = population / Math.max(1, nomad.range.length);
  const cityWeight = citySite === undefined
    ? 0
     : (1 + nomad.range.length / RANKS[2].ink) * (density / CITY_DENSITY_REFERENCE);
  const consulateScale = nomad.modifiers.includes('consulate')
    ? 1 / Math.max(2, nomad.consulCount)
    : nomad.modifiers.includes('coRule') ? 0.5 : 1;
  const options: CardDrawOption[] = [
    ...characterCardOptions(world, nomad, year),
    { key: 'nomadExpand', value: (_w, p) => requireCard(drawNomadExpansionCard(_w, p as Country), 'nomadExpand'),
      weight: consulateScale, baseWeight: 1,
      available: () => (nomad.range ?? []).some((pixel) => world.land[pixel]) },
    { key: 'government', value: (_w, p) => requireCard(drawGovernment(_w, p!, year), 'government'),
      weight: governmentEventWeight(world, nomad, year, false, consulateScale), baseWeight: 1,
      available: (_w, p) => reformCandidates(world, p as Country, year, false).length > 0 },
    { key: 'revolt', value: (_w, p) => requireCard(drawGovernment(_w, p!, year, true), 'revolt'),
      weight: governmentEventWeight(world, nomad, year, true, consulateScale), baseWeight: 1,
      available: (_w, p) => reformCandidates(world, p as Country, year, true).length > 0 },
    { key: 'buildCity', value: (_w, p) => {
      const candidate = p as Country;
      const freeSite = (candidate.range ?? []).find((pixel) => _w.land[pixel] && _w.owner[pixel] === 0 && !_w.cityAt(pixel));
      return requireCard(freeSite === undefined ? null : makeCard(
      'buildCity',
      0,
      candidate,
      `${candidate.name}: выберите инструмент «Город» и укажите свободную точку суши в пределах ареала. После основания города кочевье оседает.`,
      freeSite,
    ), 'buildCity');
    }, weight: cityWeight, baseWeight: 1, available: () => citySite !== undefined },
  ];
  return drawFirstApplicable(world, `country:${nomad.id}`, nomad, options, year);
}

function drawNomadExpansionCard(world: World, nomad: Country): Card | null {
  const queue = (nomad.range ?? []).filter((pixel) => world.land[pixel]);
  const range = new Set(queue);
  const visited = new Uint8Array(MAP_PIXELS);
  for (const pixel of queue) visited[pixel] = 1;
  let hint = -1;
  let capacity = 0;
  for (let head = 0; head < queue.length; head += 1) {
    forEachNeighbour(queue[head], (next) => {
      if (!world.land[next] || visited[next]) return;
      visited[next] = 1;
      queue.push(next);
      if (!range.has(next)) {
        capacity += 1;
        if (hint < 0) hint = next;
      }
    });
  }
  const densityOnly = capacity === 0;
  if (densityOnly) {
    capacity = range.size;
    hint = queue[0] ?? -1;
  }
  const ink = Math.min(INK.expand, capacity);
  if (ink < 1 || hint < 0) return null;
  const card = makeCard(
    'nomadExpand',
    ink,
    nomad,
    `${nomad.name}: на карте «Страны» кисть расширяет ареал, а на карте «Население» повышает плотность внутри ареала. Колонизация недоступна.`,
    hint,
  );
  card.nomadDensityOnly = densityOnly;
  return card;
}

const visited = new Uint8Array(MAP_PIXELS);

/**
 * Считает свободные земли, достижимые от исходных точек по суше или через море до любого берега,
 * и останавливается на значении `cap`.
 */
function reachableFree(
  world: World,
  seeds: number[],
  cap: number,
  seas: Set<number>,
  accept: (p: number) => boolean = () => true,
): { count: number; pixels: number[] } {
  const touched: number[] = [];
  const queue: number[] = [];
  const seenSeas = new Set<number>();
  const push = (p: number) => {
    if (visited[p] || !world.land[p] || world.owner[p] !== 0 || !accept(p)) return;
    visited[p] = 1;
    touched.push(p);
    queue.push(p);
  };
  const openSea = (body: number) => {
    if (seenSeas.has(body)) return;
    seenSeas.add(body);
    for (const p of world.water.coastsOf[body]) {
      push(p);
      if (touched.length >= cap) return;
    }
  };
  seeds.forEach(push);
  seas.forEach(openSea);
  for (let head = 0; head < queue.length && touched.length < cap; head += 1) {
    const p = queue[head];
    forEachNeighbour(p, (n) => {
      if (world.land[n]) push(n);
      else openSea(world.water.bodyOf[n]);
    });
  }
  for (const p of touched) visited[p] = 0;
  return { count: Math.min(cap, touched.length), pixels: touched };
}

function firstCountryPixel(world: World, country: Country): number {
  let found = -1;
  world.forEachCountryPixel(country, (pixel) => {
    if (found < 0) found = pixel;
  });
  return found;
}

function countrySeas(world: World, country: Country): Set<number> {
  return new CountryExpansionContourIndex(world, country).seaBodies();
}

type CapacityDonor = { pixel: number; density: number };

function higherCapacityDonor(a: CapacityDonor, b: CapacityDonor): boolean {
  return Math.abs(a.density - b.density) > 1e-9
    ? a.density > b.density
    : a.pixel < b.pixel;
}

function pushCapacityDonor(heap: CapacityDonor[], donor: CapacityDonor): void {
  heap.push(donor);
  let child = heap.length - 1;
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2);
    if (!higherCapacityDonor(heap[child], heap[parent])) break;
    [heap[child], heap[parent]] = [heap[parent], heap[child]];
    child = parent;
  }
}

function popCapacityDonor(heap: CapacityDonor[]): CapacityDonor | null {
  const top = heap[0];
  const last = heap.pop();
  if (!top || last === undefined) return null;
  if (heap.length) {
    heap[0] = last;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1, right = left + 1;
      let best = parent;
      if (left < heap.length && higherCapacityDonor(heap[left], heap[best])) best = left;
      if (right < heap.length && higherCapacityDonor(heap[right], heap[best])) best = right;
      if (best === parent) break;
      [heap[parent], heap[best]] = [heap[best], heap[parent]];
      parent = best;
    }
  }
  return top;
}

function createSeeds(world: World): number[] {
  if (world.countries.filter((c) => c.pixels > 0).length >= MAX_COUNTRIES) return [];
  const cityAreas = new CityInfluenceIndex(world, -1);
  const freeOfCityInfluence = (p: number) => cityAreas.at(p).foreignRankSum === 0;
  const seeds: number[] = [];
  for (const pixel of world.landIndex) {
    if (world.owner[pixel] === 0 && freeOfCityInfluence(pixel)) seeds.push(pixel);
  }
  return seeds;
}

function drawCreate(world: World, year: number, seeds = createSeeds(world)): Card | null {
  if (!seeds.length) return null;
  const cityAreas = new CityInfluenceIndex(world, -1);
  const freeOfCityInfluence = (p: number) => cityAreas.at(p).foreignRankSum === 0;
  let best = { seed: -1, capacity: 0 };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const seed = randomItem(seeds);
    const reachable = reachableFree(world, [seed], RANKS[RANKS.length - 1].ink, new Set(), freeOfCityInfluence);
    if (reachable.count > best.capacity) best = { seed, capacity: reachable.count };
    if (reachable.count >= RANKS[2].ink) break;
  }
  if (best.seed < 0) throw new Error('A checked country-creation site became unreachable before its card was prepared.');
  const fitting = RANKS.filter((rank) => rank.ink <= best.capacity);
  const rank = fitting.length > 0 ? randomItem(fitting) : RANKS[0];
  const ink = Math.min(rank.ink, best.capacity);
  // Государство, основанное на ничейной земле, всегда приносит новую культуру.
  const culture = world.newCulture(null, year, randomHumanOriginId());
  const religionsInUse = world.religions.filter((r) => r.foundedYear <= year);
  const religionId = religionsInUse.length > 0 && Math.random() < 0.4 ? randomItem(religionsInUse).id : null;
  const country = world.newCountry({
    rank: rank.name,
    cultureId: culture.id,
    religionId,
    density: 1 + Math.floor(Math.random() * 5),
    foundedYear: year,
    parentId: null,
  });
  const card = makeCard(
    'create',
    ink,
    null,
    `${country.rank} ${country.name}: народ «${culture.name}». Проведите кистью по свободной суше; через море можно перейти к любому берегу того же моря.`,
    best.seed,
  );
  card.newCountryId = country.id;
  card.newCultureId = culture.id;
  return card;
}

type ExpansionCardPlan = {
  hints: number[];
  ink: number;
  developmentOnly: boolean;
};

/**
 * Рассчитывает заранее, есть ли у расширения хотя бы одна доступная точка
 * и достаточная стоимость мазка. План не использует случайность: генератор
 * карты не сможет вернуть пустой результат после её выбора.
 */
function expansionCardPlan(world: World, country: Country): ExpansionCardPlan {
  const contours = new CountryExpansionContourIndex(world, country);
  const frontierArea = contours.frontier();
  const frontier: number[] = [];
  frontierArea.forEachPixel((pixel) => frontier.push(pixel));
  const seas = contours.seaBodies();
  const reachable = reachableFree(world, frontier, INK.expand, seas);
  if (reachable.count < 1) {
    // Если ничейной земли нет, расширение становится внутренним развитием, а не исчезает.
    const available: number[] = [];
    contours.territory.forEachPixel((pixel) => available.push(pixel));
    if (!available.length) return { hints: [], ink: 0, developmentOnly: true };
    const probe = makeCard('expand', INK.expand, country, '', available[0]);
    probe.developmentOnly = true;
    const painter = new CardPainter(world, probe, 'repeat');
    return {
      hints: available,
      ink: territoryInkCapacity(available, painter, INK.expand),
      developmentOnly: true,
    };
  }
  let hints = frontier;
  if (!hints.length) {
    hints = [];
    for (const body of seas) {
      const free = [...world.water.coastsOf[body]].filter((p) => world.owner[p] === 0);
      if (free.length > 0) {
        hints = free;
        break;
      }
    }
  }
  if (!hints.length) return { hints: [], ink: 0, developmentOnly: false };
  const probe = makeCard('expand', INK.expand, country, '', hints[0]);
  const painter = new CardPainter(world, probe, 'respect');
  return {
    hints,
    ink: territoryInkCapacity(reachable.pixels, painter, INK.expand),
    developmentOnly: false,
  };
}

function drawExpand(world: World, country: Country, plan: ExpansionCardPlan): Card {
  if (plan.ink < 1 || !plan.hints.length) {
    throw new Error(`Карта расширения ${country.name} не имеет доступной точки для кисти.`);
  }
  const hint = randomItem(plan.hints);
  const card = makeCard('expand', plan.ink, country,
    plan.developmentOnly
      ? `Свободной суши нет. Повышайте плотность населения в ${country.name}: один мазок развивает уже занятые земли.`
      : `Закрашивайте свободные земли у границ ${country.name} или на любом берегу того же моря.`,
    hint);
  if (plan.developmentOnly) card.developmentOnly = true;
  card.inkTotal = card.ink;
  return card;
}

function territoryInkCapacity(pixels: Iterable<number>, painter: CardPainter, limit: number): number {
  let capacity = 0;
  for (const pixel of pixels) {
    capacity += painter.strategyTerritoryInkCostAt(pixel);
    if (capacity >= limit) return limit;
  }
  return capacity;
}

function colonizationInkCapacity(world: World, country: Country, plan: ReturnType<typeof colonizationPlan>): number {
  const ink = Math.min(INK.colonization, plan.targetCount);
  if (ink < 1 || plan.hint < 0 || plan.availablePopulation <= 0) return 0;
  const probe = makeCard('colonization', ink, country, '', plan.hint);
  const painter = new CardPainter(world, probe, 'respect');
  const donors: CapacityDonor[] = [];
  for (const pixel of plan.donors) pushCapacityDonor(donors, { pixel, density: world.density[pixel] });
  let inkCapacity = 0;
  for (const pixel of world.landIndex) {
    if (!plan.targets[pixel] || !donors.length) continue;
    const donor = donors[0];
    const costCapacity = painter.strategyColonizationInkCapacityAt(pixel, donor.density);
    if (costCapacity <= 0) continue;
    const targetDensity = world.owner[pixel] > 0 ? world.density[pixel] : 0;
    const ideal = donor.density * 0.1;
    let transferable = Math.min(ideal, donor.density - targetDensity);
    if (world.owner[pixel] > 0) transferable = Math.min(transferable, targetDensity);
    if (transferable <= 1e-9) continue;
    inkCapacity += costCapacity;
    const depletedDonor = popCapacityDonor(donors);
    if (!depletedDonor) break;
    depletedDonor.density -= transferable;
    if (depletedDonor.density > 1e-9) pushCapacityDonor(donors, depletedDonor);
    pushCapacityDonor(donors, {
      pixel,
      density: world.owner[pixel] > 0 ? targetDensity : transferable,
    });
    if (inkCapacity >= ink) break;
  }
  return Math.min(ink, inkCapacity);
}

function drawColonization(
  world: World,
  country: Country,
  plan = colonizationPlan(world, country),
  capacity = colonizationInkCapacity(world, country, plan),
): Card | null {
  if (capacity < 1) return null;
  const card = makeCard(
    'colonization',
    capacity,
    country,
    `Колонизируйте побережья доступных морей или земли в бассейне реки, уже проходящей через ${country.name}. Отдельная колония может быть отделена от основной территории, но должна оставаться связанной с рекой или побережьем. Чужие участки доступны, только если их плотность ниже средней плотности страны и государства не союзники. Для каждой точки заново выбирается самый плотный участок страны-донор; переселяется до 10% его населения. На чужой точке число переселенцев ограничено её исходной плотностью, на ничейной — нет. Точка колонии не становится плотнее донора: при меньшей разнице плотности выравниваются, расходуя меньше чернил. Сколько жителей переселилось, столько местных удаляется. Совпадение культуры и религии даёт первый приоритет переселенцам и последний местным на удаление; совпадение только одного признака — следующий приоритет.`,
    plan.hint,
  );
  return card;
}

function cityChoices(world: World, cities: City[]): { label: string; detail: string; cityId: number }[] {
  return cities.map((city) => ({
    label: `${cityRankName(city.rank)} · ${city.capital ? 'столица' : 'город'}`,
    detail: `Город: ${Math.round(city.population)} чел. · сельская плотность: ${Math.round(world.density[city.pixel])} чел./участок`,
    cityId: city.id,
  }));
}

function largestCities(world: World, cities: City[], limit = 2): City[] {
  return [...cities].sort((a, b) =>
    b.rank - a.rank ||
    b.population - a.population ||
    a.pixel - b.pixel,
  ).slice(0, limit);
}

export function drawBuildCityCard(world: World, country: Country): Card | null {
  if (!world.countries[country.id] || !country.pixels) return null;
  if (firstFreeCitySite(world, country) === undefined) return null;
  return makeCard(
    'buildCity',
    0,
    country,
    `Выберите инструмент «Город» и укажите незанятую точку суши в ${country.name}. Появится городок.`,
    -1,
  );
}

function firstFreeCitySite(world: World, country: Country): number | undefined {
  const occupied = new Set(world.cities.map((city) => city.pixel));
  let site: number | undefined;
  world.forEachCountryPixel(country, (pixel) => {
    if (site === undefined && !occupied.has(pixel)) site = pixel;
  });
  return site;
}

export function drawUpgradeCityCard(world: World, country: Country): Card | null {
  const candidates = upgradeableCities(world, country.id);
  if (!candidates.length) return null;
  const selected = [...candidates];
  const shown: City[] = [];
  while (selected.length && shown.length < 2) {
    shown.push(selected.splice(Math.floor(Math.random() * selected.length), 1)[0]);
  }
  const card = makeCard(
    'upgradeCity',
    0,
    country,
    `Выберите подходящий город ${country.name}: население достигло верхнего порога, а в его сфере есть ещё два города того же ранга.`,
    -1,
  );
  card.choices = cityChoices(world, shown).map((choice) => ({
    label: choice.label,
    detail: `${choice.detail} Новый ранг: ${cityRankName((world.cities[choice.cityId].rank + 1) as City['rank'])}.`,
    cityId: choice.cityId,
  }));
  return card;
}

export function cityWaningWeight(world: World, country: Country): number {
  const cities = world.cities.filter((city) => city.countryId === country.id);
  const candidates = cities.length > 2 ? cities.filter((city) => !city.capital) : cities;
  if (!candidates.some(cityAtWaningThreshold)) return 0;
  const averageDensity = demography(world, country).population / Math.max(1, country.pixels);
  const rankSum = cities.reduce((sum, city) => sum + city.rank, 0);
  return rankSum /
    ((1 + averageDensity / CITY_DENSITY_REFERENCE) * (1 + country.pixels / RANKS[2].ink));
}

export function drawWaneCityCard(world: World, country: Country): Card | null {
  const allCities = world.cities.filter((city) => city.countryId === country.id);
  if (!allCities.length) return null;
  const candidates = allCities.length > 2 ? allCities.filter((city) => !city.capital) : allCities;
  const thresholdCities = candidates.filter(cityAtWaningThreshold);
  if (!thresholdCities.length) return null;
  const chosen: City[] = [];
  const takeRandom = (pool: City[]) => {
    const available = pool.filter((city) => !chosen.includes(city));
    if (available.length) chosen.push(available[Math.floor(Math.random() * available.length)]);
  };
  while (chosen.length < 2 && thresholdCities.some((city) => !chosen.includes(city))) takeRandom(thresholdCities);
  while (chosen.length < 2 && candidates.some((city) => !chosen.includes(city))) takeRandom(candidates);
  const card = makeCard(
    'waneCity',
    0,
    country,
    allCities.length === 1
      ? `У ${country.name} остался один город. Его увядание произойдёт автоматически.`
      : `Выберите город ${country.name} у границы населения или за ней. Если городов больше двух, столица не выбирается.`,
    -1,
  );
  card.choices = cityChoices(world, chosen).map((choice) => ({
    ...choice,
    detail: `${choice.detail} Порог ранга: ${cityPopulationMinimum(world.cities[choice.cityId].rank)}–${cityAtUpperPopulationThreshold(world.cities[choice.cityId]) ? 'достигнут верхний' : 'нижний'} предел.`,
  }));
  return card;
}

function drawMoveCapital(world: World, country: Country): Card | null {
  const candidates = largestCities(world, world.cities.filter((city) => city.countryId === country.id && !city.capital));
  if (world.cities.filter((city) => city.countryId === country.id).length < 3 || candidates.length < 2) return null;
  const card = makeCard(
    'moveCapital',
    0,
    country,
    `Выберите новую столицу из двух крупнейших городов, кроме нынешней столицы.`,
    -1,
  );
  card.choices = cityChoices(world, candidates).map((choice) => ({
    label: choice.label,
    detail: choice.detail,
    cityId: choice.cityId,
  }));
  return card;
}

function proposalChoice(world: World, proposal: ReformProposal, ruler?: import('./government').Person): {
  label: string; detail: string; government?: GovernmentId; modifier?: GovernmentModifierId;
  removeModifier?: GovernmentModifierId; termYears?: number; maxTerms?: number; consulCount?: number; violent?: boolean;
  ruler?: import('./government').Person;
} {
  let label: string, detail: string;
  if (proposal.government) {
    label = `Перейти: ${GOVERNMENTS[proposal.government].name}`;
    detail = `Сменить форму правления на «${GOVERNMENTS[proposal.government].name}».`;
  } else if (proposal.add) {
    label = `Ввести: ${MODIFIERS[proposal.add].name}`; detail = MODIFIERS[proposal.add].effect;
  } else if (proposal.remove) {
    label = `Отменить: ${MODIFIERS[proposal.remove].name}`; detail = `Отменить закон «${MODIFIERS[proposal.remove].name}».`;
  } else if (proposal.termYears !== undefined) {
    label = `Срок: ${proposal.termYears} лет`; detail = `Сменить срок полномочий на ${proposal.termYears} лет.`;
  } else if (proposal.maxTerms !== undefined) {
    label = `Лимит: ${proposal.maxTerms}`; detail = `Установить лимит в ${proposal.maxTerms} срока для одного лидера.`;
  } else {
    label = `Консулов: ${proposal.consulCount}`; detail = `Установить ${proposal.consulCount} мест в консулате.`;
  }
  return { label: ruler ? `${label} · ${ruler.name}` : label,
    detail: ruler ? `${detail} Новый правитель: ${personDetail(world, ruler)}` : detail,
    government: proposal.government, modifier: proposal.add, removeModifier: proposal.remove,
    termYears: proposal.termYears, maxTerms: proposal.maxTerms, consulCount: proposal.consulCount, violent: proposal.forced, ruler };
}

function drawGovernment(world: World, country: Polity, year: number, violent = false): Card | null {
  const proposals = reformCandidates(world, country, year, violent)
    .filter((proposal) => Number.isFinite(proposal.weight) && proposal.weight > 0);
  if (!proposals.length) return null;
  const take = () => {
    const index = weightedPick(proposals.map((p, i) => ({ value: i, weight: p.weight })));
    return index === null ? null : proposals.splice(index, 1)[0];
  };
  const first = take(), second = take();
  if (!first) return null;
  const secondProposal = second ?? (violent ? first : null);
  const leaders = violent ? [newCitizen(world, country, year), newCitizen(world, country, year)] : [];
  if (violent && leaders[0].id === leaders[1].id) leaders[1] = newCitizen(world, country, year);
  const card = makeCard(violent ? 'revolt' : 'government', 0, country,
    violent ? `Переворот в ${country.name}: выберите новую форму правления или реформу.` : `Реформа в ${country.name}: выберите одно из предложенных изменений.`, -1);
  card.choices = [
    proposalChoice(world, first, leaders[0]),
    ...(secondProposal ? [proposalChoice(world, secondProposal, leaders[1])]: []),
  ];
  card.violentReform = violent;
  card.newGovernmentId = first.government ?? null;
  return card;
}

export function governmentEventWeight(world: World, country: Polity, year: number, violent: boolean, consulateScale: number): number {
  // Процентный шанс для этих карт не задан: их исходный вес равен 1.
  // Учитываются только действующие модификаторы, а не придуманный низкий базовый вес.
  const base = consulateScale;
  if (!country.modifiers.includes('consulate') || !country.modifiers.includes('partition')) return base;
  const total = (polity: Polity) => reformCandidates(world, polity, year, violent)
    .reduce((sum, proposal) => sum + proposal.weight, 0);
  const adjustedTotal = total(country);
  const baseline = total({ ...country, modifiers: country.modifiers.filter((modifier) => modifier !== 'partition') });
  return baseline > 0 ? base * adjustedTotal / baseline : 0;
}

export function consulDeathChoices(world: World, country: Polity, year: number, deceased: Person): CardChoice[] {
  const heirs = successionOrder(world, country, deceased)
    .filter((candidate) => candidateAllowed(world, country, candidate, deceased));
  const choices: CardChoice[] = heirs.slice(0, 2).map((ruler) => ({
    label: ruler.name, detail: personDetail(world, ruler), ruler, seatId: deceased.id,
  }));
  const heirIds = new Set(heirs.map((heir) => heir.id));
  const usedIds = new Set(choices.map((choice) => choice.ruler?.id));
  const residents = world.people.filter((candidate) =>
    candidate.countryId === country.id && !heirIds.has(candidate.id) &&
    candidateAllowed(world, country, candidate, deceased));
  for (const resident of residents) {
    if (choices.length >= 2) break;
    choices.push({ label: resident.name, detail: personDetail(world, resident), ruler: resident, seatId: deceased.id });
    usedIds.add(resident.id);
  }
  while (choices.length < 2) {
    const generated = newCitizen(world, country, year);
    if (usedIds.has(generated.id)) continue;
    choices.push({ label: generated.name, detail: personDetail(world, generated), ruler: generated, seatId: deceased.id });
    usedIds.add(generated.id);
  }
  if (heirs.length < 2 && choices.length > heirs.length && Math.random() < 0.5) {
    choices[choices.length - 1] = {
      label: 'Не назначать консула',
      detail: 'Закрыть вакантное место и уменьшить число консульских мест на одно.',
      seatId: deceased.id,
      closeConsulateSeat: true,
    };
  }
  return choices;
}

function ageLabel(age: number): string {
  return age < 3 ? 'младенец' : age <= 7 ? 'ребёнок' : age <= 11 ? 'отрок' : age <= 19 ? 'подросток' : 'взрослый';
}
function personDetail(world: World, candidate: import('./government').Person): string {
  const culture = world.cultures[candidate.cultureId]?.name ?? 'неизвестная культура';
  const religion = candidate.religionId === null ? 'атеист' : world.religions[candidate.religionId]?.name ?? 'неизвестная вера';
  return `${candidate.age} лет · ${candidate.trait || ageLabel(candidate.age)} · ${culture} · ${religion}`;
}
function countryPeople(world: World, polity: Polity): Person[] {
  return world.people.filter((candidate) => candidate.alive &&
    (candidate.countryId === polity.id || candidate.id === polity.ruler.id || polity.coRulerIds.includes(candidate.id)));
}

function pairCardKey(kind: 'engagement' | 'friendship' | 'romance', a: Person, b: Person): string {
  const firstId = Math.min(a.id, b.id);
  const secondId = Math.max(a.id, b.id);
  return `${kind}:${firstId}:${secondId}`;
}

function makeNewBetrothed(world: World, polity: Polity, person: Person, year: number): Person {
  const betrothed = newCitizen(world, polity, year);
  betrothed.age = person.age < 12
    ? 8 + Math.floor(Math.random() * 4)
    : 12 + Math.floor(Math.random() * 8);
  betrothed.bornAt = year - betrothed.age - Math.random();
  if (betrothed.gender === person.gender) betrothed.gender = person.gender === 'male' ? 'female' : 'male';
  return betrothed;
}

/**
 * Генерирует уже выбранную карту смерти одного конкретного человека.
 * Причина передаётся в событии явно: возраст сам по себе не превращает случайную
 * смерть в смерть от старости и наоборот.
 */
function drawDeathCard(
  world: World,
  polity: Polity,
  personId: number,
  year: number,
  deathCause: 'random' | 'oldAge',
): Card {
  const deceased = person(world, personId);
  if (!deceased?.alive) throw new Error(`Карта смерти ссылается на отсутствующего или умершего персонажа ${personId}.`);
  const causeText = deathCause === 'oldAge' ? 'умер от старости' : 'умер случайно';
  const card = makeCard('death', 0, polity, `${deceased.name}, ${deceased.age} лет: ${causeText}.`, -1);
  card.characterEvent = { kind: 'death', personIds: [deceased.id], deathCause };
  if (deceased.id === polity.ruler.id || polity.coRulerIds.includes(deceased.id)) {
    card.choices = polity.modifiers.includes('consulate')
      ? consulDeathChoices(world, polity, year, deceased)
      : leadershipOptions(world, polity, year, deceased).slice(0, 2).map((ruler) => ({
        label: ruler.name, detail: personDetail(world, ruler), ruler, seatId: deceased.id,
      }));
  }
  return card;
}

function drawElectionCard(world: World, polity: Polity, personId: number, year: number): Card {
  const outgoing = person(world, personId);
  if (!outgoing?.alive) throw new Error(`Карта выборов ссылается на отсутствующего или умершего должностного лица ${personId}.`);
  const seat = polity.modifiers.includes('consulate') ? 'консула' : 'правителя';
  const card = makeCard('election', 0, polity,
    `Срок полномочий истёк. Выберите ${seat} ${polity.name} на ${polity.termYears} лет.`, -1);
  card.choices = leadershipOptions(world, polity, year, outgoing).slice(0, 2).map((ruler) => ({
    label: ruler.name, detail: personDetail(world, ruler), ruler, seatId: outgoing.id,
  }));
  return card;
}

function drawCharacterEventCard(
  world: World,
  polity: Polity,
  kind: 'birth' | 'marriage' | 'engagement' | 'friendship' | 'romance' | 'trait',
  personIds: number[],
  year: number,
  createBetrothed = false,
): Card {
  const first = person(world, personIds[0]);
  if (!first?.alive) throw new Error(`Карта «${kind}» ссылается на отсутствующего или умершего персонажа ${personIds[0]}.`);
  const second = person(world, personIds[1]);
  const newPerson = createBetrothed ? makeNewBetrothed(world, polity, first, year) : undefined;
  const otherName = second?.name ?? newPerson?.name ?? 'персонаж';
  const type: CardType = kind === 'birth' ? 'birth' :
    kind === 'marriage' || kind === 'engagement' ? 'marriage' : 'character';
  const title = kind === 'birth' ? `Рождение ребёнка у ${first.name} и ${otherName}` :
    kind === 'marriage' ? `Выбор супруга: ${first.name}` :
      kind === 'engagement' ? `Обручение: ${first.name} и ${otherName}` :
        kind === 'friendship' ? `Дружба: ${first.name} и ${otherName}` :
          kind === 'romance' ? `Романтическая связь: ${first.name} и ${otherName}` :
            `${first.name} получает новую черту`;
  const card = makeCard(type, 0, polity, title, -1);
  card.characterEvent = { kind, personIds, newPerson };
  if (kind === 'birth') {
    const mother = personIds.map((id) => person(world, id)).find((candidate) => candidate?.gender === 'female');
    const father = personIds.map((id) => person(world, id)).find((candidate) => candidate?.gender === 'male');
    if (!mother || !father || !mother.alive || !father.alive ||
        !arePartners(mother, father) || related(world, mother, father)) {
      throw new Error(`Карта рождения для ${first.name} не имеет двух живых партнёров-родителей.`);
    }
  }
  if (kind === 'marriage') {
    let candidates: Person[];
    if (personIds.length === 1) {
      // Пользователь выбирает супруга из двух кандидатов; генерация новых людей
      // допустима только внутри marriageCandidates, если реальных кандидатов меньше двух.
      candidates = marriageCandidates(world, polity, first, year, 2);
    } else if (personIds.length === 2 && second?.alive && first.betrothedId === second.id) {
      // Помолвка ставит одного кандидата первым; второго ищем среди реальных
      // подходящих людей и создаём только при полном отсутствии такого кандидата.
      const alternative = marriageCandidates(world, polity, { ...first, betrothedId: null }, year, 1)
        .filter((candidate) => candidate.id !== second.id);
      candidates = [second, ...alternative].slice(0, 2);
    } else {
      throw new Error(`Карта брака персонажа ${first.name} не связана с его выбором супруга.`);
    }
    if (candidates.length !== 2) {
      throw new Error(`Для карты брака персонажа ${first.name} не подготовлены ровно два кандидата.`);
    }
    card.choices = candidates.map((candidate) => ({
      label: candidate.name,
      detail: personDetail(world, candidate),
      person: candidate,
    }));
  }
  return card;
}

/**
 * Формирует пул независимых карт персонажей.
 * Никакой агрегированной карты «событие жизни» здесь нет: смерть, рождение,
 * помолвка, брак, дружба, роман и черта имеют собственный ключ и вес.
 */
function characterCardOptions(world: World, polity: Polity, year: number): CardDrawOption[] {
  const members = countryPeople(world, polity);
  const tracked = members.filter((candidate) => trackedForCharacterCards(world, polity, candidate));
  const options: CardDrawOption[] = [];
  const addedKeys = new Set<string>();

  const addPersonCard = (
    key: string,
    value: CardDrawOption['value'],
    weight = 1,
    baseWeight = 1,
  ) => {
    if (addedKeys.has(key)) return;
    addedKeys.add(key);
    options.push({ key, weight, baseWeight, value });
  };

  // Там, где дизайн-док говорит только «редко», «обычно» или «чаще», но не
  // задаёт процент, отдельная карта получает базовый вес 1; численное отношение
  // между такими событиями здесь не выдумывается.
  // Смерть отслеживается для каждого живого именного персонажа страны,
  // независимо от того, входит ли он в династию или пул семейных карт.
  for (const candidate of members) {
    const randomRisk = randomDeathChance(candidate.age);
    if (randomRisk > 0) {
      const key = `death:random:${candidate.id}`;
      addPersonCard(key,
        (candidateWorld, candidatePolity) =>
          drawDeathCard(candidateWorld, candidatePolity!, candidate.id, year, 'random'),
        randomRisk,
        randomRisk);
    }
    const oldAgeRisk = oldAgeDeathChance(candidate.age);
    if (oldAgeRisk > 0) {
      const key = `death:oldAge:${candidate.id}`;
      addPersonCard(key,
        (candidateWorld, candidatePolity) =>
          drawDeathCard(candidateWorld, candidatePolity!, candidate.id, year, 'oldAge'),
        oldAgeRisk,
        oldAgeRisk);
    }
  }

  // Карты рождения создаются по каждой паре родителей отдельно. Наличие ребёнка
  // возможно только у живых партнёров; их отношения проверяются повторно при
  // создании карты и при её разыгрывании.
  const birthPairs = new Set<string>();
  for (const trackedPerson of tracked) {
    for (const partner of livingPartners(world, trackedPerson)) {
      const mother = trackedPerson.gender === 'female' ? trackedPerson : partner;
      const father = trackedPerson.gender === 'male' ? trackedPerson : partner;
      if (mother.gender !== 'female' || father.gender !== 'male' ||
          mother.age < 12 || mother.age > 45 || father.age < 12 ||
          mother.lastBirthYear === year || !arePartners(mother, father) || related(world, mother, father)) continue;
      const key = `birth:${mother.id}:${father.id}`;
      if (birthPairs.has(key)) continue;
      birthPairs.add(key);
      addPersonCard(key,
        (candidateWorld, candidatePolity) =>
          drawCharacterEventCard(candidateWorld, candidatePolity!, 'birth', [mother.id, father.id], year));
    }
  }

  // Семейные карты доступны только персонажам, которых отслеживает текущая форма
  // правления. Все возможные пары добавляются отдельно, а не сворачиваются в один шанс.
  for (let i = 0; i < tracked.length; i += 1) {
    const candidate = tracked[i];
    const hasLivingSpouse = candidate.spouseIds.some((id) => person(world, id)?.alive);
    const betrothed = person(world, candidate.betrothedId);
    if (!hasLivingSpouse && betrothed?.alive && betrothed.betrothedId === candidate.id &&
        !betrothed.spouseIds.some((id) => person(world, id)?.alive) &&
        candidate.age >= 12 && betrothed.age >= 12 &&
        canMarry(polity, candidate) && canMarry(polity, betrothed)) {
      const firstId = Math.min(candidate.id, betrothed.id);
      const secondId = Math.max(candidate.id, betrothed.id);
      addPersonCard(`marriage:betrothed:${firstId}:${secondId}`,
        (candidateWorld, candidatePolity) =>
          drawCharacterEventCard(candidateWorld, candidatePolity!, 'marriage',
            [candidate.id, betrothed.id], year));
    }

    if (!hasLivingSpouse && candidate.betrothedId === null && canMarry(polity, candidate)) {
      addPersonCard(`marriage:${candidate.id}`,
        (candidateWorld, candidatePolity) =>
          drawCharacterEventCard(candidateWorld, candidatePolity!, 'marriage', [candidate.id], year));
    }
    if (!hasLivingSpouse && candidate.betrothedId === null &&
        candidate.age >= 8 && candidate.age < 20 && !polity.modifiers.includes('meritocracy')) {
      const possibleBetrothed = tracked.filter((other) =>
        other.id !== candidate.id && other.gender !== candidate.gender &&
        other.age >= 8 && other.betrothedId === null &&
        !other.spouseIds.some((id) => person(world, id)?.alive) &&
        !related(world, candidate, other));
      if (possibleBetrothed.length) {
        for (const other of possibleBetrothed) {
          addPersonCard(pairCardKey('engagement', candidate, other),
            (candidateWorld, candidatePolity) =>
              drawCharacterEventCard(candidateWorld, candidatePolity!, 'engagement',
                [candidate.id, other.id], year));
        }
      } else {
        addPersonCard(`engagement:${candidate.id}:new`,
          (candidateWorld, candidatePolity) =>
            drawCharacterEventCard(candidateWorld, candidatePolity!, 'engagement',
              [candidate.id], year, true));
      }
    }

    if (candidate.age >= 3 && candidate.age < 18 && candidate.traits.length === 0) {
      addPersonCard(`trait:${candidate.id}`,
        (candidateWorld, candidatePolity) =>
          drawCharacterEventCard(candidateWorld, candidatePolity!, 'trait', [candidate.id], year));
    }

    for (let j = i + 1; j < tracked.length; j += 1) {
      const other = tracked[j];
      if (candidate.age >= 3 && other.age >= 3 &&
          !candidate.friendIds.includes(other.id) && !other.friendIds.includes(candidate.id)) {
        const key = pairCardKey('friendship', candidate, other);
        addPersonCard(key,
          (candidateWorld, candidatePolity) =>
            drawCharacterEventCard(candidateWorld, candidatePolity!, 'friendship',
              [candidate.id, other.id], year));
      }
      if (candidate.gender !== other.gender && candidate.age >= 12 && other.age >= 12 &&
          !candidate.loverIds.includes(other.id) && !other.loverIds.includes(candidate.id) &&
          !candidate.spouseIds.includes(other.id) && !other.spouseIds.includes(candidate.id) &&
          !related(world, candidate, other)) {
        const key = pairCardKey('romance', candidate, other);
        addPersonCard(key,
          (candidateWorld, candidatePolity) =>
            drawCharacterEventCard(candidateWorld, candidatePolity!, 'romance',
              [candidate.id, other.id], year));
      }
    }
  }

  // Условия срока полномочий создают отдельную карту для каждого истёкшего места.
  const electionAllowed = (polity.government === 'republic' && polity.modifiers.includes('term')) ||
    polity.modifiers.includes('consulate');
  if (electionAllowed) {
    const officeHolders = [polity.ruler, ...polity.coRulerIds
      .map((id) => person(world, id))
      .filter((holder): holder is Person => !!holder?.alive)];
    for (const holder of officeHolders) {
      const since = polity.seatSince[holder.id] ?? polity.rulerSince;
      if (year - since < polity.termYears) continue;
      addPersonCard(`election:${holder.id}`,
        (candidateWorld, candidatePolity) =>
          drawElectionCard(candidateWorld, candidatePolity!, holder.id, year));
    }
  }

  // Передача власти при жизни — самостоятельная карта старого племенного вождя,
  // а не вероятность внутри общей карты персонажей.
  if (polity.government === 'tribal' && polity.ruler.age >= 66) {
    addPersonCard(`succession:${polity.ruler.id}`, (candidateWorld, candidatePolity) => {
      const card = makeCard('succession', 0, candidatePolity!,
        `Пожилой вождь ${polity.ruler.name} может передать власть при жизни.`, -1);
      card.choices = leadershipOptions(candidateWorld, candidatePolity!, year, polity.ruler).slice(0, 2).map((ruler) => ({
        label: ruler.name, detail: personDetail(candidateWorld, ruler), ruler, seatId: polity.ruler.id,
      }));
      return card;
    });
  }
  return options;
}

function splitCardAvailable(world: World, country: Country, uprising: boolean): boolean {
  if (country.pixels < 3000) return false;
  const cities = world.cities.filter((city) => city.countryId === country.id);
  const nonCapitalCities = cities.filter((city) => !city.capital);
  if (cities.length < 2 || nonCapitalCities.length < 1) return false;
  let splitCultureId: number | undefined;
  let splitReligionId: number | undefined;
  if (uprising || country.modifiers.includes('federation') || country.modifiers.includes('confederation')) {
    const d = demography(world, country);
    const minority = d.pairs.filter((pair) => pair.cultureId !== d.culture || pair.religionId !== d.religion)
      .sort((a, b) => b.weight - a.weight)[0];
    if (minority) {
      if (minority.cultureId !== d.culture) splitCultureId = minority.cultureId;
      if (minority.religionId !== d.religion) splitReligionId = minority.religionId ?? -1;
      if (!splitCultureId && !splitReligionId) splitCultureId = minority.cultureId;
    } else if (uprising) return false;
    if (uprising && !splitCultureId && !splitReligionId) return false;
  }
  return nonCapitalCities.some((city) => {
    const cultureMatch = splitCultureId !== undefined && world.cultureTable.shareOf(world.culture[city.pixel], splitCultureId) > 0;
    const faithMatch = splitReligionId !== undefined && world.religionTable.shareOf(world.religion[city.pixel], splitReligionId) > 0;
    return splitCultureId === undefined && splitReligionId === undefined || cultureMatch || faithMatch;
  });
}

export function drawSplitCard(world: World, country: Country, year: number, uprising = false): Card | null {
  if (country.pixels < 3000) return null;
  const cities = world.cities.filter((city) => city.countryId === country.id && !city.capital);
  if (world.cities.filter((city) => city.countryId === country.id).length < 2 || cities.length < 1) return null;
  let splitCultureId: number | undefined;
  let splitReligionId: number | undefined;
  let cultureId = country.cultureId, religionId = country.religionId;
  if (uprising || country.modifiers.includes('federation') || country.modifiers.includes('confederation')) {
    const d = demography(world, country);
    const minority = d.pairs.filter((p) => p.cultureId !== d.culture || p.religionId !== d.religion)
      .sort((a, b) => b.weight - a.weight)[0];
    if (minority) {
      if (minority.cultureId !== d.culture) { splitCultureId = minority.cultureId; cultureId = minority.cultureId; }
      if (minority.religionId !== d.religion) {
        splitReligionId = minority.religionId ?? -1;
        religionId = minority.religionId;
      }
      if (!splitCultureId && !splitReligionId) splitCultureId = minority.cultureId;
    } else if (uprising) return null;
    if (uprising && !splitCultureId && !splitReligionId) return null;
  }
  const accept = (p: number) => {
    const cultureMatch = splitCultureId !== undefined && world.cultureTable.shareOf(world.culture[p], splitCultureId) > 0;
    const faithMatch = splitReligionId !== undefined && world.religionTable.shareOf(world.religion[p], splitReligionId) > 0;
    return splitCultureId === undefined && splitReligionId === undefined || cultureMatch || faithMatch;
  };
  const cityCandidates = largestCities(world, cities.filter((city) => accept(city.pixel)));
  if (!cityCandidates.length) return null;
  const capitalPixel = world.cities.find((city) => city.countryId === country.id && city.capital)?.pixel ?? -1;
  const tag = country.id + 1;
  const capacityAtCity = (seed: number): number => {
    const seen = new Uint8Array(MAP_PIXELS);
    const queue = [seed];
    seen[seed] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      forEachNeighbour(queue[head], (next) => {
        if (seen[next] || world.owner[next] !== tag || next === capitalPixel || !accept(next)) return;
        seen[next] = 1;
        queue.push(next);
      });
    }
    return Math.min(queue.length, Math.max(0, country.pixels - 1));
  };
  const hint = cityCandidates[0].pixel;
  const reachableCapacity = capacityAtCity(hint);
  const ink = Math.min(INK.split, Math.floor(country.pixels * 0.45), reachableCapacity);
  if (ink < 1 || hint < 0) return null;
  const split = world.newCountry({
    rank: country.rank,
    cultureId,
    religionId,
    density: country.density,
    foundedYear: year,
    parentId: country.id,
    government: country.government,
  });
  split.modifiers = [...country.modifiers];
  split.previousRulerIds = [...country.previousRulerIds];
  split.dynastyClaims = [...split.dynastyClaims, ...country.dynastyClaims];
  split.termYears = country.termYears; split.maxTerms = country.maxTerms; split.consulCount = country.consulCount;
  const card = makeCard('split', ink, country, uprising
    ? `Региональная группа добивается отделения от ${country.name}; проведите кистью по связной территории с городом. Столица останется в исходной стране.`
    : splitCultureId !== undefined || splitReligionId !== undefined
      ? `В ${country.name} мирно отделяется регион, где заметно влияние другой культуры или веры. Выделите связную территорию с городом; столица останется в исходной стране.`
    : `${split.name} отделяется от ${country.name}. Выделите связную территорию с городом; столица останется в исходной стране.`, hint);
  if (uprising) card.title = 'Восстание региона';
  card.newCountryId = split.id;
  if (splitCultureId !== undefined) card.splitCultureId = splitCultureId;
  if (splitReligionId !== undefined) card.splitReligionId = splitReligionId;
  if (splitCultureId !== undefined) card.sourceCultureId = splitCultureId;
  if (splitReligionId !== undefined && splitReligionId >= 0) card.newReligionId = splitReligionId;
  return card;
}

function unionCandidates(world: World, country: Country): Map<number, number> {
  const neighbours = new Map<number, number>();
  const tag = country.id + 1;
  world.forEachCountryPixel(country, (p) => forEachNeighbour(p, (n) => {
    const otherId = world.owner[n] - 1;
    if (otherId < 0 || otherId === country.id) return;
    const other = world.countries[otherId];
    if (!other || other.pixels <= 0) return;
    const dynastic = country.dynastyClaims.some((id) => other.dynastyClaims.includes(id));
    const cultural = country.ruler.cultureId === other.ruler.cultureId;
    const religious = country.ruler.religionId !== null && country.ruler.religionId === other.ruler.religionId;
    if (dynastic || cultural || religious) neighbours.set(otherId, (neighbours.get(otherId) ?? 0) + 1);
  }));
  return neighbours;
}

function drawUnion(world: World, country: Country, year: number, neighbours = unionCandidates(world, country)): Card | null {
  if (!neighbours.size) return null;
  const candidates = [...neighbours].map(([id, border]) => ({ value: world.countries[id], weight: border }));
  const other = weightedPick(candidates);
  if (!other) return null;
  const card = makeCard('union', 0, country, `Мирное объединение: ${country.name} может присоединить соседнее государство ${other.name}.`, -1);
  card.newCountryId = other.id;
  return card;
}

/** Считает доступные карте точки в заданной области и останавливается на `cap`. */
function countScope(world: World, country: Country | null, cap: number, accept: (p: number) => boolean): { count: number; hint: number } {
  let count = 0;
  let hint = -1;
  const visit = (p: number) => {
    if (count >= cap || !accept(p)) return;
    count += 1;
    if (hint < 0 || Math.random() < 1 / count) hint = p;
  };
  if (country) {
    world.forEachCountryPixel(country, visit);
  } else {
    const n = world.landIndex.length;
    const offset = Math.floor(Math.random() * n);
    for (let i = 0; i < n && count < cap; i += 1) visit(world.landIndex[(offset + i) % n]);
  }
  return { count, hint };
}

export type ClimateCard = 'drought' | 'rain' | 'desertification' | 'swamping' | 'warmCurrent' | 'coldCurrent' | 'warmWind' | 'coldWind';

function climateCanChange(world: World, type: ClimateCard, p: number): boolean {
  if (type === 'drought') return world.humidity[p] > 0;
  if (type === 'rain') return world.humidity[p] < 100;
  if (type === 'desertification') return world.drainage[p] < 100;
  if (type === 'swamping') return world.drainage[p] > 0;
  if (type === 'warmCurrent' || type === 'warmWind') return world.temperature[p] < 100;
  return world.temperature[p] > 0;
}

const CLIMATE_CARD_KEYS = new Set<ClimateCard>([
  'drought', 'rain', 'desertification', 'swamping',
  'warmCurrent', 'coldCurrent', 'warmWind', 'coldWind',
]);

/** Все климатические варианты используют одну проверку с ранним выходом, а не пересканируют всю карту. */
function availableClimateCards(world: World, polity: Polity | null, keys: Set<string>): Set<string> {
  const candidates = [...keys].filter((key): key is ClimateCard => CLIMATE_CARD_KEYS.has(key as ClimateCard));
  const available = new Set<string>();
  if (!candidates.length) return available;
  const country = polity && !isNomad(polity) ? polity : null;
  if (country) {
    // Для климатической карты страны нужна исходная точка на её суше.
    // Проверка ограничивающей рамки избегает полного сканирования мира при каждом розыгрыше.
    world.forEachCountryPixel(country, (pixel) => {
      for (const type of candidates) {
        if (!available.has(type) && climateCanChange(world, type, pixel)) available.add(type);
      }
    });
    const missingWinds = candidates.filter((type) =>
      (type === 'warmWind' || type === 'coldWind') && !available.has(type),
    );
    if (missingWinds.length) {
      const seas = countrySeas(world, country);
      for (let pixel = 0; pixel < MAP_PIXELS && missingWinds.some((type) => !available.has(type)); pixel += 1) {
        if (world.land[pixel] || !seas.has(world.water.bodyOf[pixel])) continue;
        for (const type of missingWinds) {
          if (!available.has(type) && climateCanChange(world, type, pixel)) available.add(type);
        }
      }
    }
    return available;
  }
  for (let pixel = 0; pixel < MAP_PIXELS && available.size < candidates.length; pixel += 1) {
    const land = world.land[pixel] === 1;
    for (const type of candidates) {
      if (available.has(type)) continue;
      const inScope = type === 'warmCurrent' || type === 'coldCurrent'
        ? land || world.water.bodyOf[pixel] >= 0
        : land;
      if (inScope && climateCanChange(world, type, pixel)) available.add(type);
    }
  }
  return available;
}

export function drawClimateCard(world: World, type: ClimateCard, country: Country | null): Card | null {
  const winds = type === 'warmWind' || type === 'coldWind';
  const seas = new Set<number>();
  if (country && winds) world.forEachCountryPixel(country, (p) => world.seasOfPixel(p, seas));
  let capacity = 0, hint = -1;
  const cap = INK.climate;
  for (let p = 0; p < MAP_PIXELS && capacity < cap; p += 1) {
    const land = world.land[p] === 1;
    const isCurrent = type === 'warmCurrent' || type === 'coldCurrent';
    const inScope = isCurrent
      ? land || world.water.bodyOf[p] >= 0
      : country
        ? (land && world.owner[p] === country.id + 1) || (winds && !land && seas.has(world.water.bodyOf[p]))
        : land;
    if (!inScope || !climateCanChange(world, type, p)) continue;
    const cost = winds && !land ? 0.5 : 1;
    if (capacity + cost > cap) continue;
    capacity += cost;
    // Кисть ветра должна начинаться на суше страны; другие климатические кисти могут начинаться в любой подходящей точке.
    if ((!country || land) && (hint < 0 || Math.random() < 1 / Math.max(1, capacity))) hint = p;
  }
  if (capacity <= 0) return null;
  if (hint < 0 && country && winds) hint = firstCountryPixel(world, country);
  if (hint < 0) return null;
  const where = country ? `в ${country.name}` : 'по всему миру';
  const detail: Record<ClimateCard, string> = {
    drought: `Снижайте влажность на суше ${where}. Сухие земли (0%) чернил не тратят.`,
    rain: `Повышайте влажность на суше ${where}. Земли со 100% влажностью чернил не тратят.`,
    desertification: `Повышайте дренаж на суше ${where}: почва будет быстрее терять влагу.`,
    swamping: `Снижайте дренаж на суше ${where}: местность будет заболачиваться.`,
    warmCurrent: 'Проведите тёплое течение по суше и морю: температура меняется по всему миру.',
    coldCurrent: 'Проведите холодное течение по суше и морю: температура меняется по всему миру.',
    warmWind: `Проведите тёплый ветер по земле ${where} и соседним морям. Начните и завершите мазок на своей суше; вода расходует чернила вдвое медленнее.`,
    coldWind: `Проведите холодный ветер по земле ${where} и соседним морям. Начните и завершите мазок на своей суше; вода расходует чернила вдвое медленнее.`,
  };
  return makeCard(type, capacity, country, detail[type], hint);
}

function drawFaith(world: World, country: Country | null, year: number): Card | null {
  const { count, hint } = countScope(world, country, INK.faith, (p) => world.owner[p] > 0);
  if (count < 1) return null;
  const religion = world.newReligion(year);
  const where = country ? `в ${country.name}` : 'в любых государствах';
  const card = makeCard('faith', count, country, `Вера «${religion.name}» распространяется ${where}: каждый мазок обращает 40% жителей.`, hint);
  card.newReligionId = religion.id;
  return card;
}

function availableCultureSources(world: World, country: Country | null): number[] {
  const counts = new Map<number, number>();
  const inhabited = new Set<number>();
  const visit = (pixel: number) => {
    const entry = world.cultureTable.entries[world.culture[pixel]];
    for (let i = 0; i < entry.ids.length; i += 1) {
      const id = entry.ids[i];
      if (entry.shares[i] <= 0) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (world.owner[pixel] > 0) inhabited.add(id);
    }
  };
  if (country) world.forEachCountryPixel(country, visit);
  else for (const pixel of world.landIndex) visit(pixel);
  return [...counts].filter(([id, count]) => count >= 40 && inhabited.has(id)).map(([id]) => id);
}

function drawCultureSplit(
  world: World,
  country: Country | null,
  year: number,
  sources = availableCultureSources(world, country),
): Card | null {
  if (!sources.length) return null;
  const sourceId = sources[Math.floor(Math.random() * sources.length)];
  const { count, hint } = countScope(world, country, INK.culture, (p) => world.cultureTable.shareOf(world.culture[p], sourceId) > 0);
  if (count < 40 || hint < 0) throw new Error(`Culture ${sourceId} became unavailable while preparing its card.`);
  const source = world.cultures[sourceId];
  if (!source) throw new Error(`Culture ${sourceId} is missing while preparing its card.`);
  const culture = world.newCulture(source, year);
  const card = makeCard('culture', count, country, `Половина народа «${source.name}» в закрашенных землях становится народом «${culture.name}».`, hint);
  card.newCultureId = culture.id;
  card.sourceCultureId = sourceId;
  return card;
}

function forkWorld(world: World, polity: Polity | null): World {
  const fork = Object.assign(Object.create(Object.getPrototypeOf(world)), world) as World;
  fork.countries = world.countries.map((country) => ({
    ...country,
    box: [...country.box] as Country['box'],
    range: country.range ? [...country.range] : undefined,
    cells: country.cells?.map((cell) => ({ ...cell })),
  }));
  fork.cities = world.cities;
  if (polity) {
    fork.countries[polity.id] = { ...fork.countries[polity.id], ...polity,
      box: [...polity.box] as Country['box'],
      range: polity.range ? [...polity.range] : undefined,
      cells: polity.cells?.map((cell) => ({ ...cell })),
    };
  }
  fork.people = [...world.people];
  fork.cultures = [...world.cultures];
  fork.religions = [...world.religions];
  fork.cardMultipliers = { ...world.cardMultipliers };
  return fork;
}

function prepareSelectedCard(fork: World, option: CardDrawOption, candidate: Polity | null, seed: number): PreparedCard {
  const originalRandom = Math.random;
  const personIds = personIdSequence();
  const countryCount = fork.countries.length;
  const cultureCount = fork.cultures.length;
  const religionCount = fork.religions.length;
  const peopleCount = fork.people.length;
  let state = (seed + 1) >>> 0;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  try {
    const card = option.value(fork, candidate);
    if (!card) throw new Error(`Генератор выбранной карты «${option.key}» вернул пустой результат.`);
    return {
      card,
      additions: {
        countries: fork.countries.slice(countryCount),
        cultures: fork.cultures.slice(cultureCount),
        religions: fork.religions.slice(religionCount),
        people: fork.people.slice(peopleCount),
      },
      nextPersonId: personIdSequence(),
    };
  } finally {
    Math.random = originalRandom;
    restorePersonIdSequence(personIds);
    fork.countries.length = countryCount;
    fork.cultures.length = cultureCount;
    fork.religions.length = religionCount;
    fork.people.length = peopleCount;
  }
}

function commitPreparedCard(world: World, prepared: PreparedCard): Card {
  world.countries.push(...prepared.additions.countries);
  world.cultures.push(...prepared.additions.cultures);
  world.religions.push(...prepared.additions.religions);
  world.people.push(...prepared.additions.people);
  if (prepared.nextPersonId > personIdSequence()) reservePersonId(prepared.nextPersonId - 1);
  return prepared.card;
}

/** Разыгрывает одну выбранную карту; генератор результата не может запустить повторный розыгрыш. */
function drawFirstApplicable(
  world: World,
  scope: string,
  polity: Polity | null,
  options: CardDrawOption[],
  year: number,
): Card | null {
  const climateOptions = availableClimateCards(world, polity, new Set(options.map((option) => option.key)));
  const stagingWorld = forkWorld(world, polity);
  const stagingPolity = polity ? stagingWorld.countries[polity.id] : null;
  const candidates = options.filter((option) => {
    if (!Number.isFinite(option.weight) || option.weight <= 0) return false;
    if (CLIMATE_CARD_KEYS.has(option.key as ClimateCard)) {
      if (!climateOptions.has(option.key)) return false;
    }
    if (option.key.startsWith('death:')) {
      const personId = Number(option.key.slice(option.key.lastIndexOf(':') + 1));
      if (!person(world, personId)?.alive) return false;
    }
    return option.available?.(world, polity) ?? true;
  });
  if (!candidates.length) {
    traceCardDraw(world, scope, year, polity, [], null, null);
    return null;
  }
  const probabilities = normalizedCardProbabilities(
    candidates.map((option) => ({ key: option.key, weight: option.weight })),
    world.cardMultipliers,
    scope,
  );
  if (!probabilities.length) {
    traceCardDraw(world, scope, year, polity, [], null, null);
    return null;
  }
  const drawnKey = weightedPick(probabilities.map((option) => ({ value: option.key, weight: option.probability })));
  if (drawnKey === null) throw new Error(`Card draw produced no selection for ${scope} with a non-empty pool.`);
  const selected = candidates.find((option) => option.key === drawnKey);
  if (!selected) throw new Error(`Card draw selected unknown option ${drawnKey} for ${scope}.`);
  const seed = Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
  const prepared = prepareSelectedCard(stagingWorld, selected, stagingPolity, seed);
  traceCardDraw(world, scope, year, polity, candidates, selected.key, prepared.card.type);
  updateCardDrawMultipliers(scope, probabilities, selected.key, world.cardMultipliers);
  return commitPreparedCard(world, prepared);
}

export function drawWorldCard(world: World, year: number): Card | null {
  const living = world.countries.filter((c) => c.pixels > 0).length;
  const seeds = createSeeds(world);
  const cultureSources = availableCultureSources(world, null);
  const hasOwnedLand = world.landIndex.some((pixel) => world.owner[pixel] > 0);
  return drawFirstApplicable(world, 'world', null, [
    { key: 'create', value: (w) => requireCard(drawCreate(w, year, seeds), 'create'), weight: 1, baseWeight: 1,
      available: () => seeds.length > 0 },
    { key: 'drought', value: (w) => requireCard(drawClimateCard(w, 'drought', null), 'drought'), weight: 1, baseWeight: 1 },
    { key: 'rain', value: (w) => requireCard(drawClimateCard(w, 'rain', null), 'rain'), weight: 1, baseWeight: 1 },
    { key: 'desertification', value: (w) => requireCard(drawClimateCard(w, 'desertification', null), 'desertification'), weight: 1, baseWeight: 1 },
    { key: 'swamping', value: (w) => requireCard(drawClimateCard(w, 'swamping', null), 'swamping'), weight: 1, baseWeight: 1 },
    { key: 'warmCurrent', value: (w) => requireCard(drawClimateCard(w, 'warmCurrent', null), 'warmCurrent'), weight: 1, baseWeight: 1 },
    { key: 'coldCurrent', value: (w) => requireCard(drawClimateCard(w, 'coldCurrent', null), 'coldCurrent'), weight: 1, baseWeight: 1 },
    { key: 'faith', value: (w) => requireCard(drawFaith(w, null, year), 'faith'), weight: living > 0 ? 1 : 0, baseWeight: 1,
      available: () => hasOwnedLand },
    { key: 'culture', value: (w) => requireCard(drawCultureSplit(w, null, year, cultureSources), 'culture'), weight: living > 0 ? 1 : 0, baseWeight: 1,
      available: () => cultureSources.length > 0 },
  ], year);
}

export function drawCountryCard(world: World, country: Country, year: number): Card | null {
  if (country.type === 'nomadic') return drawNomadicCountryCard(world, country, year);
  const diversity = demography(world, country);
  const countryCities = world.cities.filter((city) => city.countryId === country.id);
  const freeCitySite = firstFreeCitySite(world, country);
  const expansionPlan = country.pixels > 0
    ? expansionCardPlan(world, country)
    : { hints: [], ink: 0, developmentOnly: false };
  const upgradeCandidates = upgradeableCities(world, country.id);
  const capitalCandidates = largestCities(world, countryCities.filter((city) => !city.capital));
  const cultureSources = availableCultureSources(world, country);
  const ordinarySplitAvailable = splitCardAvailable(world, country, false);
  const uprisingAvailable = splitCardAvailable(world, country, true);
  const governmentAvailable = reformCandidates(world, country, year, false).length > 0;
  const revoltAvailable = reformCandidates(world, country, year, true).length > 0;
  const unionTargets = country.modifiers.includes('confederation') || country.modifiers.includes('federation')
    ? unionCandidates(world, country)
    : new Map<number, number>();
  const colonizationBaseWeight = Math.max(0, diversity.density * 0.12);
  const colonization = colonizationBaseWeight > 0 ? colonizationPlan(world, country) : null;
  const colonizationCapacity = colonization ? colonizationInkCapacity(world, country, colonization) : 0;
  const averageNonCityDensity = CountryExpansionContourIndex.averageNonCityDensity(
    world,
    country,
    diversity.density * country.pixels,
    countryCities,
  );
  const cityModifierTotal = countryCities.reduce(
    (sum, city) => sum + city.rank * cityInfluenceMultiplier(world, city),
    0,
  );
  const buildCityWeight = cityModifierTotal > 0
    ? (1 + country.pixels / RANKS[2].ink) * (averageNonCityDensity / CITY_DENSITY_REFERENCE) / cityModifierTotal
    : 0;
  const upperThresholdCount = countryCities.filter(cityAtUpperPopulationThreshold).length;
  const upgradeCityWeight = upgradeCandidates.length > 0
    ? diversity.population / RANKS[2].ink * countryCities.length * (1 + upperThresholdCount)
    : 0;
  const capital = countryCities.find((city) => city.capital);
  const largerThanCapital = capital ? countryCities.filter((city) =>
    city.id !== capital.id &&
    (city.rank > capital.rank || (city.rank === capital.rank && city.population > capital.population)),
  ).length : 0;
  const consulateScale = country.modifiers.includes('consulate') ? 1 / Math.max(2, country.consulCount) : country.modifiers.includes('coRule') ? 0.5 : 1;
  const splitScale = country.modifiers.includes('confederation') ? 3 : country.modifiers.includes('federation') ? 2 : 1;
  const unrestScale = country.modifiers.includes('confederation') ? 1 / 3 : country.modifiers.includes('federation') ? 1 / 2 : 1;
  const options: CardDrawOption[] = [
    ...characterCardOptions(world, country, year),
    { key: 'expand', value: (w, p) => drawExpand(w, p as Country, expansionPlan),
      weight: expansionPlan.ink > 0 ? consulateScale : 0, baseWeight: 1,
      available: () => expansionPlan.ink > 0 },
    { key: 'buildCity', value: (w, p) => requireCard(drawBuildCityCard(w, p as Country), 'buildCity'), weight: buildCityWeight, baseWeight: 1,
      available: () => freeCitySite !== undefined },
    { key: 'upgradeCity', value: (w, p) => requireCard(drawUpgradeCityCard(w, p as Country), 'upgradeCity'), weight: upgradeCityWeight, baseWeight: 1,
      available: () => upgradeCandidates.length > 0 },
    { key: 'waneCity', value: (w, p) => requireCard(drawWaneCityCard(w, p as Country), 'waneCity'),
      weight: cityWaningWeight(world, country) > 0 ? 1 : 0, baseWeight: 1,
      available: () => cityWaningWeight(world, country) > 0 },
    { key: 'moveCapital', value: (w, p) => requireCard(drawMoveCapital(w, p as Country), 'moveCapital'),
      weight: capitalCandidates.length >= 2 ? 1 : 0, baseWeight: 1,
      available: () => capitalCandidates.length >= 2 },
    { key: 'colonization', value: (w, p) => requireCard(
      drawColonization(w, p as Country, colonization!, colonizationCapacity), 'colonization'),
      weight: colonizationCapacity >= 1 ? colonizationBaseWeight * consulateScale : 0, baseWeight: 1,
      available: () => colonizationCapacity >= 1 },
    { key: 'government', value: (w, p) => requireCard(drawGovernment(w, p!, year), 'government'),
      weight: governmentEventWeight(world, country, year, false, consulateScale), baseWeight: 1,
      available: () => governmentAvailable },
    { key: 'revolt', value: (w, p) => requireCard(drawGovernment(w, p!, year, true), 'revolt'),
      weight: governmentEventWeight(world, country, year, true, consulateScale), baseWeight: 1,
      available: () => revoltAvailable },
    { key: 'split', value: (w, p) => requireCard(drawSplitCard(w, p as Country, year), 'split'),
      weight: (1 + largerThanCapital) * splitScale * consulateScale, baseWeight: 1,
      available: () => ordinarySplitAvailable },
    { key: 'uprising', value: (w, p) => requireCard(drawSplitCard(w, p as Country, year, true), 'uprising'),
      weight: uprisingAvailable ? unrestScale * consulateScale : 0, baseWeight: 1,
      available: () => uprisingAvailable },
    { key: 'union', value: (w, p) => requireCard(drawUnion(w, p as Country, year, unionTargets), 'union'),
      weight: unionTargets.size > 0 ? 1 : 0, baseWeight: 1,
      available: () => unionTargets.size > 0 },
    { key: 'drought', value: (w, p) => requireCard(drawClimateCard(w, 'drought', p as Country), 'drought'), weight: 1, baseWeight: 1 },
    { key: 'rain', value: (w, p) => requireCard(drawClimateCard(w, 'rain', p as Country), 'rain'), weight: 1, baseWeight: 1 },
    { key: 'desertification', value: (w, p) => requireCard(drawClimateCard(w, 'desertification', p as Country), 'desertification'), weight: 1, baseWeight: 1 },
    { key: 'swamping', value: (w, p) => requireCard(drawClimateCard(w, 'swamping', p as Country), 'swamping'), weight: 1, baseWeight: 1 },
    { key: 'warmWind', value: (w, p) => requireCard(drawClimateCard(w, 'warmWind', p as Country), 'warmWind'), weight: 1, baseWeight: 1 },
    { key: 'coldWind', value: (w, p) => requireCard(drawClimateCard(w, 'coldWind', p as Country), 'coldWind'), weight: 1, baseWeight: 1 },
    { key: 'faith', value: (w, p) => requireCard(drawFaith(w, p as Country, year), 'faith'),
      weight: country.pixels > 0 ? (country.modifiers.includes('theocracy') ? 2 : 1) : 0, baseWeight: 1,
      available: () => country.pixels > 0 },
    { key: 'culture', value: (w, p) => requireCard(drawCultureSplit(w, p as Country, year, cultureSources), 'culture'),
      weight: cultureSources.length > 0 ? 1 : 0, baseWeight: 1,
      available: () => cultureSources.length > 0 },
  ];
  return drawFirstApplicable(world, `country:${country.id}`, country, options, year);
}

export function firstCreateCard(world: World, year: number): Card | null {
  return drawCreate(world, year);
}
