import type { Card, CardType } from './brush';
import { INK, MAP_PIXELS, MAP_WIDTH, MAX_COUNTRIES, RANKS } from './config';
import { forEachNeighbour } from './geography';
import { randomItem, weightedPick } from './random';
import type { Country, World } from './world';
import { GOVERNMENTS, type GovernmentId, uniqueLeader } from './government';

export const CARD_TITLES: Record<CardType, string> = {
  create: 'Создание государства',
  expand: 'Расширение страны',
  split: 'Раскол страны',
  drought: 'Засуха',
  rain: 'Ливни',
  faith: 'Возникновение веры',
  culture: 'Выделение культуры',
  government: 'Политическая реформа',
  succession: 'Передача престола',
  election: 'Новые выборы',
};

function makeCard(type: CardType, ink: number, target: Country | null, detail: string, hint: number): Card {
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
    hint,
  };
}

const visited = new Uint8Array(MAP_PIXELS);

/**
 * Counts free land reachable from the seeds (by land, or across any sea to any of its coasts),
 * stopping at `cap`.
 */
function reachableFree(world: World, seeds: number[], cap: number, seas: Set<number>): number {
  const touched: number[] = [];
  const queue: number[] = [];
  const seenSeas = new Set<number>();
  const push = (p: number) => {
    if (visited[p] || !world.land[p] || world.owner[p] !== 0) return;
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
  let best = { seed: -1, capacity: 0 };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const seed = randomLandPixel(world, (p) => world.owner[p] === 0);
    if (seed < 0) break;
    const capacity = reachableFree(world, [seed], RANKS[RANKS.length - 1].ink, new Set());
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
      if (world.density[p] < 20) available.push(p);
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

function drawGovernment(country: Country): Card | null {
  const options = (Object.keys(GOVERNMENTS) as GovernmentId[]).filter((id) => id !== country.government);
  if (!options.length) return null;
  const next = randomItem(options);
  const gov = GOVERNMENTS[next];
  const card = makeCard('government', 0, country, `Совет страны предлагает реформу: перейти к форме «${gov.name}». Модификаторы: ${gov.modifiers.join(' · ')}.`, -1);
  card.newGovernmentId = next;
  return card;
}

function drawLeadership(world: World, country: Country, year: number): Card | null {
  if (country.heir && country.ruler.age >= 60) {
    const card = makeCard('succession', 0, country, `Правитель ${country.ruler.name} стареет. Ожидаемый наследник ${country.heir.name}, ${country.heir.age} лет, готов принять власть.`, -1);
    card.newRuler = { ...country.heir, since: year };
    return card;
  }
  if (country.government === 'republic' && year - country.rulerSince >= 8) {
    const ruler = uniqueLeader(country.id, year);
    const card = makeCard('election', 0, country, `Выборы в ${country.name}: новым главой становится ${ruler.name}, ${ruler.age} лет.`, -1);
    card.newRuler = ruler;
    return card;
  }
  return null;
}

function drawSplit(world: World, country: Country, year: number): Card | null {
  if (country.pixels < 3000) return null;
  const ink = Math.min(INK.split, Math.floor(country.pixels * 0.45));
  const hint = randomCountryPixel(world, country);
  if (hint < 0) return null;
  const split = world.newCountry({
    rank: country.rank,
    cultureId: country.cultureId,
    religionId: country.religionId,
    density: country.density,
    foundedYear: year,
    parentId: country.id,
    government: country.government,
  });
  const card = makeCard('split', ink, country, `${split.name} отделяется от ${country.name}. Население, культура и вера земель не меняются.`, hint);
  card.newCountryId = split.id;
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

function drawClimate(world: World, type: 'drought' | 'rain', country: Country | null): Card | null {
  const { count, hint } = countScope(world, country, INK.climate, (p) =>
    type === 'rain' ? world.humidity[p] < 100 : world.humidity[p] > 0,
  );
  if (count < 1) return null;
  const where = country ? `на территории ${country.name}` : 'на любой суше';
  const detail =
    type === 'drought'
      ? `Снижайте влажность ${where}. Сухие земли (0%) чернил не тратят.`
      : `Повышайте влажность ${where}. Земли со 100% влажностью чернил не тратят.`;
  return makeCard(type, count, country, detail, hint);
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
    { value: () => drawFaith(world, null, year), weight: living > 0 ? 0.25 * faithRoom(world) : 0 },
    { value: () => drawCultureSplit(world, null, year), weight: living > 0 ? 0.3 : 0 },
  ]);
}

export function drawCountryCard(world: World, country: Country, year: number): Card | null {
  const big = country.pixels >= 12000;
  return drawFirstApplicable([
    { value: () => drawExpand(world, country), weight: 4 },
    { value: () => drawGovernment(country), weight: 0.12 },
    { value: () => drawLeadership(world, country, year), weight: 0.2 },
    { value: () => drawSplit(world, country, year), weight: big ? 0.3 : 0 },
    { value: () => drawClimate(world, 'drought', country), weight: 0.8 },
    { value: () => drawClimate(world, 'rain', country), weight: 0.8 },
    { value: () => drawFaith(world, country, year), weight: (country.religionId === null ? 0.1 : 0.03) * faithRoom(world) },
    { value: () => drawCultureSplit(world, country, year), weight: country.pixels >= 6000 ? 0.06 : 0 },
  ]);
}

export function firstCreateCard(world: World, year: number): Card | null {
  return drawCreate(world, year);
}
