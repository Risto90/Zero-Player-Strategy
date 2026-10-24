import type { Card, CardType } from './brush';
import { BRUSH_SIZES, INK, MAP_PIXELS, MAP_WIDTH, MAX_COUNTRIES, RANKS } from './config';
import { forEachNeighbour } from './geography';
import { randomItem, weightedPick } from './random';
import type { Country, World } from './world';
import { GOVERNMENTS, MODIFIERS, type GovernmentId, type GovernmentModifierId } from './government';
import { lifeOpportunity, marriageCandidates, reformCandidates, type ReformProposal } from './politics';
import { leadershipOptions } from './succession';
import { newCitizen, person } from './characters';
import { demography } from './demography';
import { colonizationPlan } from './colonization';
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
import type { City, NomadGroup } from './world';

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
  character: 'Событие персонажей',
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
// A town gathers 10% from its unmodified sphere; the reference equals five default-M brush dabs.
const CITY_DENSITY_REFERENCE = 5 * standardExpansionPassPixels / (0.1 * RANKS[0].ink);

function makeCard(type: CardType, ink: number, target: Country | null, detail: string, hint: number): Card {
  return {
    type,
    title: CARD_TITLES[type],
    detail,
    ink,
    inkTotal: ink,
    targetCountryId: target?.id ?? null,
    targetNomadId: null,
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

export function drawNomadCard(world: World, nomad: NomadGroup): Card | null {
  if (!nomad.range.length) return null;
  const range = new Set(nomad.range);
  let hint = -1;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const pixel = world.landIndex[Math.floor(Math.random() * world.landIndex.length)];
    if (!range.has(pixel)) { hint = pixel; break; }
  }
  const densityOnly = hint < 0;
  if (densityOnly) hint = nomad.range[0];
  const card = makeCard(
    'nomadExpand',
    INK.expand,
    null,
    `${nomad.name}: на карте «Кочевья» кисть расширяет ареал, а на карте «Население» повышает плотность внутри ареала. Колонизация недоступна.`,
    hint,
  );
  card.targetNomadId = nomad.id;
  card.nomadDensityOnly = densityOnly;
  return card;
}

const visited = new Uint8Array(MAP_PIXELS);

/**
 * Counts free land reachable from the seeds (by land, or across any sea to any of its coasts),
 * stopping at `cap`.
 */
function reachableFree(world: World, seeds: number[], cap: number, seas: Set<number>, accept: (p: number) => boolean = () => true): number {
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
  return Math.min(cap, touched.length);
}

function randomLandPixel(world: World, accept: (p: number) => boolean, tries = 400): number {
  for (let i = 0; i < tries; i += 1) {
    const p = world.landIndex[Math.floor(Math.random() * world.landIndex.length)];
    if (accept(p)) return p;
  }
  return -1;
}

function randomCountryPixel(world: World, country: Country, accept: (p: number) => boolean = () => true): number {
  const [x0, y0, x1, y1] = country.box;
  const tag = country.id + 1;
  for (let i = 0; i < 300; i += 1) {
    const x = x0 + Math.floor(Math.random() * (x1 - x0 + 1));
    const y = y0 + Math.floor(Math.random() * (y1 - y0 + 1));
    const p = y * MAP_WIDTH + x;
    if (world.owner[p] === tag && accept(p)) return p;
  }
  let found = -1;
  const seen: number[] = [];
  world.forEachCountryPixel(country, (p) => {
    if (accept(p)) seen.push(p);
  });
  if (seen.length > 0) found = randomItem(seen);
  return found;
}

function countrySeas(world: World, country: Country): Set<number> {
  const seas = new Set<number>();
  world.forEachCountryPixel(country, (p) => world.seasOfPixel(p, seas));
  return seas;
}

function drawCreate(world: World, year: number): Card | null {
  if (world.countries.filter((c) => c.pixels > 0).length >= MAX_COUNTRIES) return null;
  const cityAreas = new CityInfluenceIndex(world, -1);
  const freeOfCityInfluence = (p: number) => cityAreas.at(p).foreignRankSum === 0;
  let best = { seed: -1, capacity: 0 };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const seed = randomLandPixel(world, (p) => world.owner[p] === 0 && freeOfCityInfluence(p));
    if (seed < 0) break;
    const capacity = reachableFree(world, [seed], RANKS[RANKS.length - 1].ink, new Set(), freeOfCityInfluence);
    if (capacity > best.capacity) best = { seed, capacity };
    if (capacity >= RANKS[2].ink) break;
  }
  if (best.seed < 0) return null;
  const fitting = RANKS.filter((rank) => rank.ink <= best.capacity);
  const rank = fitting.length > 0 ? randomItem(fitting) : RANKS[0];
  const ink = Math.min(rank.ink, best.capacity);
  // A state founded on empty land always brings its own new culture.
  const culture = world.newCulture(null, year);
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

function drawExpand(world: World, country: Country): Card | null {
  const frontier: number[] = [];
  world.forEachCountryPixel(country, (p) => {
    forEachNeighbour(p, (n) => {
      if (world.land[n] && world.owner[n] === 0) frontier.push(n);
    });
  });
  const seas = countrySeas(world, country);
  const capacity = reachableFree(world, frontier, INK.expand, seas);
  if (capacity < 1) {
    // With no unclaimed land, expansion becomes internal development rather than disappearing.
    const available: number[] = [];
    world.forEachCountryPixel(country, (p) => {
      available.push(p);
    });
    if (!available.length) return null;
    const ink = Math.min(INK.expand, available.length);
    const card = makeCard('expand', ink, country, `Свободной суши нет. Повышайте плотность населения в ${country.name}: один мазок развивает уже занятые земли.`, randomItem(available));
    card.developmentOnly = true;
    return card;
  }
  let hint = frontier.length > 0 ? randomItem(frontier) : -1;
  if (hint < 0) {
    for (const body of seas) {
      const free = [...world.water.coastsOf[body]].filter((p) => world.owner[p] === 0);
      if (free.length > 0) {
        hint = randomItem(free);
        break;
      }
    }
  }
  return makeCard('expand', capacity, country, `Закрашивайте свободные земли у границ ${country.name} или на любом берегу того же моря.`, hint);
}

function drawColonization(world: World, country: Country): Card | null {
  const plan = colonizationPlan(world, country);
  const ink = Math.min(INK.colonization, plan.targetCount);
  if (ink < 1 || plan.hint < 0 || plan.availablePopulation <= 0) return null;
  const card = makeCard(
    'colonization',
    ink,
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
  const occupied = new Set(world.cities.map((city) => city.pixel));
  let hasSite = false;
  world.forEachCountryPixel(country, (p) => { if (!occupied.has(p)) hasSite = true; });
  if (!hasSite) return null;
  return makeCard(
    'buildCity',
    0,
    country,
    `Выберите инструмент «Город» и укажите незанятую точку суши в ${country.name}. Появится городок.`,
    -1,
  );
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
  if (!cities.some(cityAtWaningThreshold)) return 0;
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

function drawGovernment(world: World, country: Country, year: number, violent = false): Card | null {
  const proposals = reformCandidates(world, country, year, violent);
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

function ageLabel(age: number): string {
  return age < 3 ? 'младенец' : age <= 7 ? 'ребёнок' : age <= 11 ? 'отрок' : age <= 19 ? 'подросток' : 'взрослый';
}
function personDetail(world: World, candidate: import('./government').Person): string {
  const culture = world.cultures[candidate.cultureId]?.name ?? 'неизвестная культура';
  const religion = candidate.religionId === null ? 'атеист' : world.religions[candidate.religionId]?.name ?? 'неизвестная вера';
  return `${candidate.age} лет · ${candidate.trait || ageLabel(candidate.age)} · ${culture} · ${religion}`;
}
function drawLifeCard(world: World, country: Country, year: number): Card | null {
  if (country.government === 'tribal' && country.ruler.age >= 60 && Math.random() < 0.08) {
    const card = makeCard('succession', 0, country, `Пожилой вождь ${country.ruler.name} может передать власть при жизни.`, -1);
    card.choices = leadershipOptions(world, country, year).slice(0, 2).map((ruler) => ({
      label: ruler.name, detail: personDetail(world, ruler), ruler, seatId: country.ruler.id,
    }));
    return card;
  }
  const opportunity = lifeOpportunity(world, country, year);
  if (!opportunity) return null;
  const p = person(world, opportunity.ids[0]);
  if (!p) return null;
  if (opportunity.kind === 'death') {
    const card = makeCard('death', 0, country, `${p.name}, ${p.age} лет, умер${p.gender === 'female' ? 'ла' : ''}.`, -1);
    card.characterEvent = { kind: 'death', personIds: opportunity.ids };
    if (p.id === country.ruler.id || country.coRulerIds.includes(p.id)) {
      card.choices = leadershipOptions(world, country, year, p).slice(0, 2).map((ruler) => ({
          label: ruler.name, detail: personDetail(world, ruler), ruler, seatId: p.id,
      }));
    }
    return card;
  }
  if (opportunity.kind === 'election') {
    const seat = country.modifiers.includes('consulate') ? 'консула' : 'правителя';
    const card = makeCard('election', 0, country, `Срок полномочий истёк. Выберите ${seat} ${country.name} на ${country.termYears} лет.`, -1);
    card.choices = leadershipOptions(world, country, year, p).slice(0, 2).map((ruler) => ({
      label: ruler.name, detail: personDetail(world, ruler), ruler, seatId: p.id,
    }));
    return card;
  }
  const type = opportunity.kind === 'birth' ? 'birth' : opportunity.kind === 'marriage' || opportunity.kind === 'engagement' ? 'marriage' : 'character';
  const other = person(world, opportunity.ids[1]);
  const title = type === 'birth' ? 'Ожидается рождение ребёнка' :
    type === 'marriage' ? opportunity.kind === 'engagement' ? `Обручение: ${p.name} и ${other?.name ?? 'персонаж'}` : `Выбор супруга: ${p.name}` :
      opportunity.kind === 'friendship' ? `Дружба: ${p.name} и ${other?.name ?? 'персонаж'}` :
        opportunity.kind === 'romance' ? `Романтическая связь: ${p.name} и ${other?.name ?? 'персонаж'}` : `${p.name} получает новую черту`;
  const card = makeCard(type, 0, country, title, -1);
  card.characterEvent = { kind: opportunity.kind as 'birth' | 'marriage' | 'friendship' | 'trait' | 'engagement',
    personIds: opportunity.ids, newPerson: opportunity.newPerson };
  if (opportunity.kind === 'marriage') {
    card.choices = marriageCandidates(world, country, p, year).map((candidate) => ({
      label: candidate.name,
      detail: personDetail(world, candidate),
      person: candidate,
    }));
  }
  return card;
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
  const hint = cityCandidates[0].pixel;
  const ink = Math.min(INK.split, Math.floor(country.pixels * 0.45));
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

function drawUnion(world: World, country: Country, year: number): Card | null {
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
  if (!neighbours.size) return null;
  const candidates = [...neighbours].map(([id, border]) => ({ value: world.countries[id], weight: border }));
  const other = weightedPick(candidates);
  if (!other) return null;
  const card = makeCard('union', 0, country, `Мирное объединение: ${country.name} может присоединить соседнее государство ${other.name}.`, -1);
  card.newCountryId = other.id;
  return card;
}

/** Counts pixels in scope that the card can change, stopping at `cap`. */
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

type ClimateCard = 'drought' | 'rain' | 'desertification' | 'swamping' | 'warmCurrent' | 'coldCurrent' | 'warmWind' | 'coldWind';

function climateCanChange(world: World, type: ClimateCard, p: number): boolean {
  if (type === 'drought') return world.humidity[p] > 0;
  if (type === 'rain') return world.humidity[p] < 100;
  if (type === 'desertification') return world.drainage[p] < 100;
  if (type === 'swamping') return world.drainage[p] > 0;
  if (type === 'warmCurrent' || type === 'warmWind') return world.temperature[p] < 100;
  return world.temperature[p] > 0;
}

function drawClimate(world: World, type: ClimateCard, country: Country | null): Card | null {
  const winds = type === 'warmWind' || type === 'coldWind';
  const seas = new Set<number>();
  if (country && winds) world.forEachCountryPixel(country, (p) => world.seasOfPixel(p, seas));
  let count = 0, hint = -1;
  const cap = INK.climate;
  for (let p = 0; p < MAP_PIXELS && count < cap; p += 1) {
    const land = world.land[p] === 1;
    const inScope = country
      ? (land && world.owner[p] === country.id + 1) || (winds && !land && seas.has(world.water.bodyOf[p]))
      : (type === 'warmCurrent' || type === 'coldCurrent' || land);
    if (!inScope || !climateCanChange(world, type, p)) continue;
    count += 1;
    // Winds must start on the country's land; other climate brushes may start anywhere eligible.
    if ((!country || land) && (hint < 0 || Math.random() < 1 / Math.max(1, count))) hint = p;
  }
  if (count < 1) return null;
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
  return makeCard(type, count, country, detail[type], hint);
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

function dominantCulture(world: World, p: number): number {
  const entry = world.cultureTable.entries[world.culture[p]];
  let best = -1;
  let bestShare = -1;
  entry.ids.forEach((id, i) => {
    if (entry.shares[i] > bestShare) {
      best = id;
      bestShare = entry.shares[i];
    }
  });
  return best;
}

function drawCultureSplit(world: World, country: Country | null, year: number): Card | null {
  let probe: number;
  if (country) probe = randomCountryPixel(world, country);
  else probe = randomLandPixel(world, (p) => world.owner[p] > 0);
  if (probe < 0) return null;
  const sourceId = country ? (world.culture[probe] ? (countryMainCulture(world, country) ?? dominantCulture(world, probe)) : -1) : dominantCulture(world, probe);
  if (sourceId < 0) return null;
  const { count, hint } = countScope(world, country, INK.culture, (p) => world.cultureTable.shareOf(world.culture[p], sourceId) > 0);
  if (count < 40) return null;
  const source = world.cultures[sourceId];
  const culture = world.newCulture(source, year);
  const card = makeCard('culture', count, country, `Половина народа «${source.name}» в закрашенных землях становится народом «${culture.name}».`, hint);
  card.newCultureId = culture.id;
  card.sourceCultureId = sourceId;
  return card;
}

function countryMainCulture(world: World, country: Country): number | null {
  const totals = new Map<number, number>();
  let sampled = 0;
  for (let i = 0; i < 200; i += 1) {
    const p = randomCountryPixel(world, country);
    if (p < 0) break;
    const entry = world.cultureTable.entries[world.culture[p]];
    entry.ids.forEach((id, k) => totals.set(id, (totals.get(id) ?? 0) + entry.shares[k]));
    sampled += 1;
    if (sampled >= 60) break;
  }
  let best: number | null = null;
  let bestTotal = -1;
  totals.forEach((total, id) => {
    if (total > bestTotal) {
      best = id;
      bestTotal = total;
    }
  });
  return best;
}

/** Picks by weight among cards that actually apply; inapplicable cards are never drawn. */
function drawFirstApplicable(options: { value: () => Card | null; weight: number }[]): Card | null {
  let remaining = [...options];
  while (remaining.length > 0) {
    const index = weightedPick(remaining.map((option, i) => ({ value: i, weight: option.weight })));
    if (index === null) return null;
    const card = remaining[index].value();
    if (card) return card;
    remaining = remaining.filter((_, i) => i !== index);
  }
  return null;
}

/** New faiths become rarer as more of them exist, so the world is not flooded with tiny sects. */
function faithRoom(world: World): number {
  return Math.max(0.02, 1 - world.religions.length / 16);
}

export function drawWorldCard(world: World, year: number): Card | null {
  const living = world.countries.filter((c) => c.pixels > 0).length;
  return drawFirstApplicable([
    { value: () => drawCreate(world, year), weight: 3 },
    { value: () => drawClimate(world, 'drought', null), weight: 1 },
    { value: () => drawClimate(world, 'rain', null), weight: 1 },
    { value: () => drawClimate(world, 'desertification', null), weight: 0.6 },
    { value: () => drawClimate(world, 'swamping', null), weight: 0.6 },
    { value: () => drawClimate(world, 'warmCurrent', null), weight: 0.3 },
    { value: () => drawClimate(world, 'coldCurrent', null), weight: 0.3 },
    { value: () => drawFaith(world, null, year), weight: living > 0 ? 0.25 * faithRoom(world) : 0 },
    { value: () => drawCultureSplit(world, null, year), weight: living > 0 ? 0.3 : 0 },
  ]);
}

export function drawCountryCard(world: World, country: Country, year: number): Card | null {
  const big = country.pixels >= 12000;
  const diversity = demography(world, country);
  const countryCities = world.cities.filter((city) => city.countryId === country.id);
  let nonCityDensity = 0, nonCityPixels = 0;
  world.forEachCountryPixel(country, (p) => {
    if (world.cityIdAt[p] >= 0) return;
    nonCityDensity += world.density[p];
    nonCityPixels += 1;
  });
  const averageNonCityDensity = nonCityDensity / Math.max(1, nonCityPixels);
  const cityModifierTotal = countryCities.reduce(
    (sum, city) => sum + city.rank * cityInfluenceMultiplier(world, city),
    0,
  );
  const buildCityWeight = cityModifierTotal > 0
    ? (1 + country.pixels / RANKS[2].ink) * (averageNonCityDensity / CITY_DENSITY_REFERENCE) / cityModifierTotal
    : 0;
  const upperThresholdCount = countryCities.filter(cityAtUpperPopulationThreshold).length;
  const upgradeCityWeight = countryCities.length > 0
    ? diversity.population / RANKS[2].ink * countryCities.length * (1 + upperThresholdCount)
    : 0;
  const capital = countryCities.find((city) => city.capital);
  const largerThanCapital = capital ? countryCities.filter((city) =>
    city.id !== capital.id &&
    (city.rank > capital.rank || (city.rank === capital.rank && city.population > capital.population)),
  ).length : 0;
  const life = drawLifeCard(world, country, year);
  if (life?.type === 'death' || life?.type === 'election' || life?.type === 'birth' || life?.type === 'marriage') return life;
  const consulateScale = country.modifiers.includes('consulate') ? 1 / Math.max(2, country.consulCount) : country.modifiers.includes('coRule') ? 0.5 : 1;
  const splitScale = country.modifiers.includes('confederation') ? 3 : country.modifiers.includes('federation') ? 2 : 1;
  const unrestScale = country.modifiers.includes('confederation') ? 1 / 3 : country.modifiers.includes('federation') ? 1 / 2 : 1;
  return drawFirstApplicable([
    { value: () => life, weight: 1.4 },
    { value: () => drawExpand(world, country), weight: 4 * consulateScale },
    { value: () => drawBuildCityCard(world, country), weight: buildCityWeight },
    { value: () => drawUpgradeCityCard(world, country), weight: upgradeCityWeight },
    { value: () => drawWaneCityCard(world, country), weight: cityWaningWeight(world, country) },
    { value: () => drawMoveCapital(world, country), weight: countryCities.length >= 3 ? 1 : 0 },
    { value: () => drawColonization(world, country), weight: Math.max(0, diversity.density * 0.12) * consulateScale },
    { value: () => drawGovernment(world, country, year), weight: 0.16 * consulateScale },
    { value: () => drawGovernment(world, country, year, true), weight: 0.01 * consulateScale },
    { value: () => drawSplitCard(world, country, year), weight: (big ? 0.3 * (1 + largerThanCapital) : 0) * splitScale * consulateScale },
    { value: () => drawSplitCard(world, country, year, true), weight: Math.min(0.25, (diversity.cultureFragmentation + diversity.religionFragmentation) * 0.015) * unrestScale * consulateScale },
    { value: () => drawUnion(world, country, year), weight: country.modifiers.includes('confederation') ? 0.09 : country.modifiers.includes('federation') ? 0.06 : 0 },
    { value: () => drawClimate(world, 'drought', country), weight: 0.8 },
    { value: () => drawClimate(world, 'rain', country), weight: 0.8 },
    { value: () => drawClimate(world, 'desertification', country), weight: 0.45 },
    { value: () => drawClimate(world, 'swamping', country), weight: 0.45 },
    { value: () => drawClimate(world, 'warmWind', country), weight: 0.25 },
    { value: () => drawClimate(world, 'coldWind', country), weight: 0.25 },
    { value: () => drawFaith(world, country, year), weight: (country.religionId === null ? 0.1 : 0.03) * faithRoom(world) * (country.modifiers.includes('theocracy') ? 2 : 1) },
    { value: () => drawCultureSplit(world, country, year), weight: country.pixels >= 6000 ? 0.06 : 0 },
  ]);
}

export function firstCreateCard(world: World, year: number): Card | null {
  return drawCreate(world, year);
}
