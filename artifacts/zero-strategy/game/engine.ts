import colors from '@/constants/colors';

export type MapKind = 'world' | 'random';
export type PlayerRole = 'all' | 'country' | 'world' | 'observer';
export type CardType = 'create' | 'expand' | 'split' | 'drought' | 'rain' | 'faith' | 'culture';
/** 'respect' — repeated strokes have no effect; 'density' — repeated strokes apply the card again. */
export type BrushMode = 'respect' | 'density';
export type BrushOption = 'density' | 'repeat' | null;
export type MapMode = 'political' | 'biomes' | 'cultures' | 'religions';

export interface WorldCell {
  id: string;
  row: number;
  col: number;
  land: boolean;
  humidity: number;
  temperature: number;
  drainage: number;
  biome: string;
  ownerId: string | null;
  density: number;
  cultureId: string | null;
  religionId: string | null;
}

export interface Culture {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

export interface Religion {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

export interface Country {
  id: string;
  name: string;
  color: string;
  rank: string;
  cultureId: string;
  religionId: string | null;
  government: string;
  density: number;
  ink: number;
}

export interface GameCard {
  type: CardType;
  title: string;
  detail: string;
  ink: number;
  targetCountryId: string | null;
  sourceCultureId: string | null;
}

/** A pending card slot; the card itself is drawn only when the slot becomes active so it always fits the current map. */
export type CardSlot = { scope: 'world' } | { scope: 'country'; countryId: string };

interface DrawnCard {
  card: GameCard;
  draftCountry: Country | null;
  draftCulture: Culture | null;
  draftReligion: Religion | null;
}

export interface GameState {
  mapKind: MapKind;
  role: PlayerRole;
  turn: number;
  year: number;
  cells: WorldCell[];
  countries: Country[];
  cultures: Culture[];
  religions: Religion[];
  focusCountryId: string | null;
  activeCard: GameCard | null;
  queuedCards: CardSlot[];
  draftCountry: Country | null;
  draftCulture: Culture | null;
  draftReligion: Religion | null;
  strokeCellIds: string[];
  brushMode: BrushMode;
  mapMode: MapMode;
  secondsLeft: number;
  paused: boolean;
  eventLog: string[];
  message: string;
}

const ROWS = 12;
const COLS = 20;
const LOG_LIMIT = 80;
const HUMIDITY_PER_INK = 5;
const HUMIDITY_PER_STROKE = 15;
const CLIMATE_INK = 24;
const EXPAND_INK = 7;
const SPLIT_INK = 8;
const FAITH_INK = 6;
const CULTURE_INK = 6;
const MAX_DENSITY = 20;
const MAX_COUNTRIES = 40;

const NAME_START = ['Аст', 'Вел', 'Кал', 'Мор', 'Нор', 'Тар', 'Эр', 'Сол', 'Лир', 'Ор', 'Дан', 'Иск', 'Рав', 'Ул'];
const NAME_END = ['ария', 'вальд', 'марк', 'орн', 'ест', 'ания', 'дора', 'град', 'рия', 'вена', 'тия', 'лон'];
const CULTURE_START = ['Ве', 'Та', 'Са', 'Ор', 'Ке', 'Ай', 'На', 'Эр', 'Ло', 'Ми', 'Ду', 'Ри', 'Ха', 'Зе'];
const CULTURE_END = ['лари', 'рны', 'эли', 'вены', 'лты', 'нумены', 'рви', 'валы', 'деты', 'ссы', 'ромы', 'киры'];
const CULTURE_BRANCH = ['Северные', 'Южные', 'Горные', 'Прибрежные', 'Западные', 'Восточные', 'Степные', 'Лесные'];
const RELIGION_START = ['Путь', 'Завет', 'Свет', 'Круг', 'Память', 'Учение', 'Огонь', 'Голос'];
const RELIGION_END = ['Прилива', 'Предков', 'Небес', 'Дубов', 'Солнца', 'Пепла', 'Звёзд', 'Камня', 'Ветра'];
const RANKS = [
  { name: 'Баронство', ink: 12 },
  { name: 'Графство', ink: 18 },
  { name: 'Герцогство', ink: 25 },
  { name: 'Королевство', ink: 34 },
  { name: 'Империя', ink: 44 },
  { name: 'Гегемония', ink: 56 },
];

export interface BiomeInfo {
  name: string;
  rule: string;
  color: string;
}

const BIOME_COLORS = colors.light.biomePalette;
export const BIOMES: BiomeInfo[] = [
  { name: 'Ледник', rule: 't < 10', color: BIOME_COLORS[0] },
  { name: 'Тундра', rule: 't 10–24', color: BIOME_COLORS[1] },
  { name: 'Болота', rule: 't ≥ 10, вл ≥ 55, дренаж ≤ 25', color: BIOME_COLORS[2] },
  { name: 'Тайга', rule: 't 25–39, эвл ≥ 35', color: BIOME_COLORS[3] },
  { name: 'Холодная степь', rule: 't 25–39, эвл < 35', color: BIOME_COLORS[4] },
  { name: 'Лиственный лес', rule: 't 40–64, эвл ≥ 45', color: BIOME_COLORS[5] },
  { name: 'Степь', rule: 't 40–64, эвл 20–44', color: BIOME_COLORS[6] },
  { name: 'Пустыня', rule: 't ≥ 40, эвл < 20', color: BIOME_COLORS[7] },
  { name: 'Саванна', rule: 't ≥ 65, эвл 20–49', color: BIOME_COLORS[8] },
  { name: 'Тропический лес', rule: 't ≥ 65, эвл ≥ 50', color: BIOME_COLORS[9] },
];
export const BIOME_NOTE =
  't — температура (0–100), вл — влажность, эвл — влажность с учётом дренажа: вл × (1,3 − 0,006 × дренаж).';

const CARD_TITLES: Record<CardType, string> = {
  create: 'Создание государства',
  expand: 'Расширение страны',
  split: 'Раскол страны',
  drought: 'Засуха',
  rain: 'Ливни',
  faith: 'Возникновение веры',
  culture: 'Выделение культуры',
};

// ---------- small helpers ----------

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function weightedPick<T>(options: { value: T; weight: number }[]): T | null {
  const valid = options.filter((option) => option.weight > 0);
  const total = valid.reduce((sum, option) => sum + option.weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const option of valid) {
    roll -= option.weight;
    if (roll <= 0) return option.value;
  }
  return valid[valid.length - 1].value;
}

function idFor(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function uniqueName(make: () => string, used: Set<string>): string {
  for (let i = 0; i < 40; i += 1) {
    const name = make();
    if (!used.has(name)) return name;
  }
  let suffix = 2;
  const base = make();
  while (used.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const value = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Returns a color that is not in `used`: first from the palette, then from an evenly spread generated sequence. */
function pickUniqueColor(palette: string[], used: Set<string>): string {
  const free = palette.filter((color) => !used.has(color.toLowerCase()));
  if (free.length > 0) return randomItem(free).toLowerCase();
  for (let i = 0; i < 2000; i += 1) {
    const hue = (i * 137.508) % 360;
    const lightness = 36 + (Math.floor(i / 7) % 4) * 9;
    const saturation = 30 + (i % 3) * 10;
    const color = hslToHex(hue, saturation, lightness);
    if (!used.has(color)) return color;
  }
  return hslToHex(Math.random() * 360, 40, 50);
}

function colorSet(items: { color: string }[]): Set<string> {
  return new Set(items.map((item) => item.color.toLowerCase()));
}

// ---------- geography ----------

function isInEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function isWorldLand(x: number, y: number): boolean {
  const edge = Math.random() * 0.14 - 0.07;
  return (
    isInEllipse(x, y, 0.19, 0.34, 0.16 + edge, 0.24 + edge) ||
    isInEllipse(x, y, 0.3, 0.69, 0.075 + edge / 2, 0.23) ||
    isInEllipse(x, y, 0.55, 0.3, 0.11 + edge, 0.12 + edge) ||
    isInEllipse(x, y, 0.73, 0.36, 0.24 + edge, 0.16 + edge) ||
    isInEllipse(x, y, 0.55, 0.59, 0.105 + edge, 0.23 + edge) ||
    isInEllipse(x, y, 0.67, 0.55, 0.052 + edge / 2, 0.1 + edge) ||
    isInEllipse(x, y, 0.82, 0.78, 0.11 + edge, 0.075 + edge) ||
    isInEllipse(x, y, 0.32, 0.14, 0.06 + edge / 2, 0.08 + edge) ||
    isInEllipse(x, y, 0.92, 0.47, 0.025, 0.07)
  );
}

function makeRandomLandMask(): boolean[] {
  const centers = Array.from({ length: 7 }, () => ({
    x: 0.08 + Math.random() * 0.84,
    y: 0.1 + Math.random() * 0.8,
    rx: 0.1 + Math.random() * 0.16,
    ry: 0.13 + Math.random() * 0.22,
  }));
  const mask = Array.from({ length: ROWS * COLS }, (_, index) => {
    const x = (index % COLS) / (COLS - 1);
    const y = Math.floor(index / COLS) / (ROWS - 1);
    const edge = Math.random() * 0.28 - 0.14;
    return centers.some(({ x: cx, y: cy, rx, ry }) => isInEllipse(x, y, cx, cy, rx + edge, ry + edge));
  });
  return mask.map((land, index) => {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    let neighbors = 0;
    for (const [dr, dc] of DIRECTIONS) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && mask[r * COLS + c]) neighbors += 1;
    }
    return land ? neighbors > 0 : neighbors >= 3;
  });
}

/** Humidity added by drainage: well-drained ground loses water, poorly drained ground keeps it. */
export function effectiveMoisture(humidity: number, drainage: number): number {
  return Math.round(humidity * (1.3 - 0.006 * drainage));
}

export function biomeFor(humidity: number, temperature: number, drainage: number): string {
  const moisture = effectiveMoisture(humidity, drainage);
  if (temperature < 10) return 'Ледник';
  if (humidity >= 55 && drainage <= 25) return 'Болота';
  if (temperature < 25) return 'Тундра';
  if (temperature < 40) return moisture >= 35 ? 'Тайга' : 'Холодная степь';
  if (moisture < 20) return 'Пустыня';
  if (temperature < 65) return moisture >= 45 ? 'Лиственный лес' : 'Степь';
  return moisture >= 50 ? 'Тропический лес' : 'Саванна';
}

/** Latitude humidity: wet equator, dry subtropics, wet temperate belt, dry poles. */
function baseHumidity(latitude: number): number {
  const points: [number, number][] = [
    [0, 78],
    [0.3, 24],
    [0.55, 62],
    [0.8, 46],
    [1, 30],
  ];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (latitude <= x1) return y0 + ((latitude - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 30;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function makeCells(mapKind: MapKind): WorldCell[] {
  const randomMask = mapKind === 'random' ? makeRandomLandMask() : [];
  return Array.from({ length: ROWS * COLS }, (_, index) => {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const x = col / (COLS - 1);
    const y = row / (ROWS - 1);
    const latitude = Math.abs(y - 0.5) * 2;
    const land = mapKind === 'world' ? isWorldLand(x, y) : randomMask[index];
    const temperature = Math.round(clamp(92 - latitude * 95 + (Math.random() * 14 - 7)));
    const humidity = Math.round(clamp(baseHumidity(latitude) + (Math.random() * 36 - 18)));
    const drainage = Math.round(10 + Math.random() * 85);
    return {
      id: `cell-${index}`,
      row,
      col,
      land,
      humidity,
      temperature,
      drainage,
      biome: biomeFor(humidity, temperature, drainage),
      ownerId: null,
      density: 0,
      cultureId: null,
      religionId: null,
    };
  });
}

const DIRECTIONS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function cellNeighbors(cells: WorldCell[], cell: WorldCell): WorldCell[] {
  const result: WorldCell[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    const row = cell.row + dr;
    const col = cell.col + dc;
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
    const neighbor = cells[row * COLS + col];
    if (neighbor) result.push(neighbor);
  }
  return result;
}

/** Labels each connected body of water so coasts on the same sea can be linked at any distance. */
function waterBodies(cells: WorldCell[]): Map<string, number> {
  const bodies = new Map<string, number>();
  let next = 0;
  for (const start of cells) {
    if (start.land || bodies.has(start.id)) continue;
    const stack = [start];
    bodies.set(start.id, next);
    while (stack.length > 0) {
      const current = stack.pop() as WorldCell;
      for (const neighbor of cellNeighbors(cells, current)) {
        if (!neighbor.land && !bodies.has(neighbor.id)) {
          bodies.set(neighbor.id, next);
          stack.push(neighbor);
        }
      }
    }
    next += 1;
  }
  return bodies;
}

function shoreBodies(cells: WorldCell[], cell: WorldCell, bodies: Map<string, number>): number[] {
  return cellNeighbors(cells, cell)
    .filter((neighbor) => !neighbor.land)
    .map((neighbor) => bodies.get(neighbor.id) as number);
}

/** True when target touches the linked area by land or shares a sea with any linked coast (any distance). */
function isLinkedByLandOrSea(cells: WorldCell[], target: WorldCell, linkedIds: Set<string>): boolean {
  if (cellNeighbors(cells, target).some((neighbor) => linkedIds.has(neighbor.id))) return true;
  const bodies = waterBodies(cells);
  const targetSeas = new Set(shoreBodies(cells, target, bodies));
  if (targetSeas.size === 0) return false;
  for (const cell of cells) {
    if (!linkedIds.has(cell.id)) continue;
    if (shoreBodies(cells, cell, bodies).some((sea) => targetSeas.has(sea))) return true;
  }
  return false;
}

/** Random organic growth: takes cells allowed by canTake, travels through cells allowed by canPass. */
function growOrder(
  cells: WorldCell[],
  seeds: WorldCell[],
  canTake: (cell: WorldCell) => boolean,
  canPass: (cell: WorldCell) => boolean,
  limit: number,
): WorldCell[] {
  const result: WorldCell[] = [];
  const seen = new Set(seeds.map((seed) => seed.id));
  const frontier = [...seeds];
  while (frontier.length > 0 && result.length < limit) {
    const current = frontier.splice(Math.floor(Math.random() * frontier.length), 1)[0];
    let spreads = false;
    if (canTake(current)) {
      result.push(current);
      spreads = true;
    } else if (canPass(current)) {
      spreads = true;
    }
    if (!spreads) continue;
    for (const neighbor of cellNeighbors(cells, current)) {
      if (seen.has(neighbor.id)) continue;
      seen.add(neighbor.id);
      frontier.push(neighbor);
    }
  }
  return result;
}

function freeLand(cell: WorldCell): boolean {
  return cell.land && cell.ownerId === null;
}

/** Free land a country can reach by land or across seas. */
function reachableFreeLand(cells: WorldCell[], countryId: string): WorldCell[] {
  const owned = cells.filter((cell) => cell.ownerId === countryId);
  return growOrder(cells, owned, freeLand, (cell) => !cell.land || cell.ownerId === countryId, Infinity);
}

/** Size of the largest group of free land linked by land or sea (the most a new state can paint). */
function largestFreeArea(cells: WorldCell[]): number {
  const seen = new Set<string>();
  let best = 0;
  for (const start of cells) {
    if (!freeLand(start) || seen.has(start.id)) continue;
    const group = growOrder(cells, [start], freeLand, (cell) => !cell.land, Infinity);
    group.forEach((cell) => seen.add(cell.id));
    best = Math.max(best, group.length);
  }
  return best;
}

function climateRoom(cell: WorldCell, type: 'drought' | 'rain'): number {
  return type === 'rain' ? 100 - cell.humidity : cell.humidity;
}

function climateInkCapacity(cells: WorldCell[], type: 'drought' | 'rain'): number {
  return cells.reduce((sum, cell) => sum + Math.ceil(climateRoom(cell, type) / HUMIDITY_PER_INK), 0);
}

function countBy(cells: WorldCell[], key: 'cultureId' | 'religionId'): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const id = cell[key];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function leading(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  counts.forEach((count, id) => {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  });
  return best;
}

// ---------- entities ----------

function makeCulture(state: GameState, parent: Culture | null = null): Culture {
  const used = new Set([...state.cultures, ...(state.draftCulture ? [state.draftCulture] : [])].map((c) => c.name));
  const baseName = () => `${randomItem(CULTURE_START)}${randomItem(CULTURE_END)}`;
  const name = uniqueName(
    () =>
      parent && !CULTURE_BRANCH.some((prefix) => parent.name.startsWith(prefix))
        ? `${randomItem(CULTURE_BRANCH)} ${parent.name.toLowerCase()}`
        : baseName(),
    used,
  );
  const usedColors = colorSet([...state.cultures, ...(state.draftCulture ? [state.draftCulture] : [])]);
  return {
    id: idFor('culture'),
    name: name.charAt(0).toUpperCase() + name.slice(1),
    color: pickUniqueColor(colors.light.culturePalette, usedColors),
    parentId: parent?.id ?? null,
  };
}

function makeReligion(state: GameState): Religion {
  const used = new Set(state.religions.map((religion) => religion.name));
  return {
    id: idFor('faith'),
    name: uniqueName(() => `${randomItem(RELIGION_START)} ${randomItem(RELIGION_END)}`, used),
    color: pickUniqueColor(colors.light.religionPalette, colorSet(state.religions)),
    parentId: null,
  };
}

function usedCountryColors(state: GameState): Set<string> {
  return colorSet([...state.countries, ...(state.draftCountry ? [state.draftCountry] : [])]);
}

function makeCountryShell(
  state: GameState,
  rank: { name: string; ink: number },
  cultureId: string,
  religionId: string | null,
  density: number,
): Country {
  const usedNames = new Set(state.countries.map((country) => country.name));
  return {
    id: idFor('nation'),
    name: uniqueName(() => `${randomItem(NAME_START)}${randomItem(NAME_END)}`, usedNames),
    color: pickUniqueColor(colors.light.countryPalette, usedCountryColors(state)),
    rank: rank.name,
    cultureId,
    religionId,
    government: 'Племя',
    density,
    ink: rank.ink,
  };
}

function makeCard(
  type: CardType,
  ink: number,
  targetCountryId: string | null,
  detail: string,
  sourceCultureId: string | null = null,
): GameCard {
  return { type, title: CARD_TITLES[type], detail, ink, targetCountryId, sourceCultureId };
}

// ---------- drawing applicable cards ----------

function drawCreate(state: GameState): DrawnCard | null {
  if (state.countries.length >= MAX_COUNTRIES) return null;
  const capacity = largestFreeArea(state.cells);
  if (capacity < 1) return null;
  const fitting = RANKS.filter((rank) => rank.ink <= capacity);
  const rank = fitting.length > 0 ? randomItem(fitting) : RANKS[0];
  const ink = Math.min(rank.ink, capacity);
  // A state founded on empty land always brings its own new culture.
  const culture = makeCulture(state);
  const religionsInUse = state.religions.filter((religion) =>
    state.cells.some((cell) => cell.religionId === religion.id),
  );
  const religionId = religionsInUse.length > 0 && Math.random() < 0.4 ? randomItem(religionsInUse).id : null;
  const country = makeCountryShell(state, { name: rank.name, ink }, culture.id, religionId, 1 + Math.floor(Math.random() * 5));
  return {
    card: makeCard('create', ink, null, 'Проведите кистью по свободной суше. Через море можно перейти к любому берегу того же моря.'),
    draftCountry: country,
    draftCulture: culture,
    draftReligion: null,
  };
}

function drawExpand(state: GameState, country: Country): DrawnCard | null {
  const reachable = reachableFreeLand(state.cells, country.id).length;
  if (reachable < 1) return null;
  return {
    card: makeCard('expand', Math.min(EXPAND_INK, reachable), country.id, 'Закрашивайте свободные земли у границ или на любом берегу того же моря.'),
    draftCountry: null,
    draftCulture: null,
    draftReligion: null,
  };
}

function drawSplit(state: GameState, country: Country): DrawnCard | null {
  const owned = state.cells.filter((cell) => cell.ownerId === country.id).length;
  if (owned < 2) return null;
  const ink = Math.min(SPLIT_INK, owned - 1);
  const splitCountry = makeCountryShell(state, { name: country.rank, ink }, country.cultureId, country.religionId, country.density);
  splitCountry.government = country.government;
  return {
    card: makeCard('split', ink, country.id, `Выделите часть ${country.name}. Население, культура и вера областей не меняются.`),
    draftCountry: splitCountry,
    draftCulture: null,
    draftReligion: null,
  };
}

function drawClimate(state: GameState, type: 'drought' | 'rain', country: Country | null): DrawnCard | null {
  const scope = state.cells.filter((cell) => cell.land && (!country || cell.ownerId === country.id));
  const capacity = climateInkCapacity(scope, type);
  if (capacity < 1) return null;
  const where = country ? `на территории ${country.name}` : 'на любой суше';
  const detail =
    type === 'drought'
      ? `Снижайте влажность ${where}. Области с нулевой влажностью не тратят чернил.`
      : `Повышайте влажность ${where}. Области со 100% влажностью не тратят чернил.`;
  return {
    card: makeCard(type, Math.min(CLIMATE_INK, capacity), country?.id ?? null, detail),
    draftCountry: null,
    draftCulture: null,
    draftReligion: null,
  };
}

function drawFaith(state: GameState, country: Country | null): DrawnCard | null {
  const scope = state.cells.filter((cell) => cell.ownerId !== null && (!country || cell.ownerId === country.id));
  if (scope.length < 1) return null;
  const religion = makeReligion(state);
  const where = country ? `в ${country.name}` : 'в любых государствах';
  return {
    card: makeCard('faith', Math.min(FAITH_INK, scope.length), country?.id ?? null, `Новая вера «${religion.name}» распространяется ${where}. Мазок может прерываться.`),
    draftCountry: null,
    draftCulture: null,
    draftReligion: religion,
  };
}

function drawCultureSplit(state: GameState, country: Country | null): DrawnCard | null {
  const scope = state.cells.filter((cell) => cell.ownerId !== null && (!country || cell.ownerId === country.id));
  const counts = countBy(scope, 'cultureId');
  const candidates = [...counts.entries()].filter(([, count]) => count >= 2).map(([id]) => id);
  if (candidates.length === 0) return null;
  const sourceId = country ? (leading(counts) as string) : randomItem(candidates);
  const sourceCount = counts.get(sourceId) ?? 0;
  if (sourceCount < 2) return null;
  const source = state.cultures.find((culture) => culture.id === sourceId) ?? null;
  const culture = makeCulture(state, source);
  return {
    card: makeCard(
      'culture',
      Math.min(CULTURE_INK, sourceCount),
      country?.id ?? null,
      `Часть народа «${source?.name ?? 'культура'}» становится народом «${culture.name}».`,
      sourceId,
    ),
    draftCountry: null,
    draftCulture: culture,
    draftReligion: null,
  };
}

function drawCountryCard(state: GameState, country: Country): DrawnCard | null {
  const owned = state.cells.filter((cell) => cell.ownerId === country.id);
  const diverse = owned.some((cell) => cell.cultureId !== country.cultureId || cell.religionId !== country.religionId);
  const options: { value: () => DrawnCard | null; weight: number }[] = [
    { value: () => drawExpand(state, country), weight: 4 },
    { value: () => drawSplit(state, country), weight: owned.length >= 8 ? 0.2 + (diverse ? 0.25 : 0) : 0 },
    { value: () => drawClimate(state, 'drought', country), weight: 1 },
    { value: () => drawClimate(state, 'rain', country), weight: 1 },
    { value: () => drawFaith(state, country), weight: owned.some((cell) => cell.religionId === null) ? 0.45 : 0.01 },
    { value: () => drawCultureSplit(state, country), weight: owned.length >= 6 ? 0.2 : 0 },
  ];
  return drawFirstApplicable(options);
}

function drawWorldCard(state: GameState): DrawnCard | null {
  const options: { value: () => DrawnCard | null; weight: number }[] = [
    { value: () => drawCreate(state), weight: 3 },
    { value: () => drawClimate(state, 'drought', null), weight: 1.2 },
    { value: () => drawClimate(state, 'rain', null), weight: 1.2 },
    { value: () => drawFaith(state, null), weight: state.cells.some((cell) => cell.ownerId && !cell.religionId) ? 0.5 : 0.08 },
    { value: () => drawCultureSplit(state, null), weight: 0.4 },
  ];
  return drawFirstApplicable(options);
}

/** Picks by weight among cards that actually apply to the current map; inapplicable cards are never drawn. */
function drawFirstApplicable(options: { value: () => DrawnCard | null; weight: number }[]): DrawnCard | null {
  let remaining = [...options];
  while (remaining.length > 0) {
    const draw = weightedPick(remaining.map((option, index) => ({ value: index, weight: option.weight })));
    if (draw === null) return null;
    const card = remaining[draw].value();
    if (card) return card;
    remaining = remaining.filter((_, index) => index !== draw);
  }
  return null;
}

// ---------- applying a card to one cell ----------

export function brushOptionFor(card: GameCard | null): BrushOption {
  if (!card) return null;
  if (card.type === 'create' || card.type === 'expand') return 'density';
  if (card.type === 'drought' || card.type === 'rain') return 'repeat';
  return null;
}

function workingCountry(state: GameState): Country | null {
  const card = state.activeCard;
  if (!card) return null;
  if (card.type === 'create' || card.type === 'split') return state.draftCountry;
  return state.countries.find((country) => country.id === card.targetCountryId) ?? null;
}

function withCell(state: GameState, cell: WorldCell, cost: number, message: string): GameState {
  const card = state.activeCard as GameCard;
  const cells = [...state.cells];
  cells[cell.row * COLS + cell.col] = cell;
  return {
    ...state,
    cells,
    activeCard: { ...card, ink: card.ink - cost },
    strokeCellIds: state.strokeCellIds.includes(cell.id) ? state.strokeCellIds : [...state.strokeCellIds, cell.id],
    secondsLeft: Math.min(90, state.secondsLeft + 2),
    message,
  };
}

/** Applies the active card to one cell. Returns a new state, a user-facing reason, or '' for a silent no-op. */
function applyCardToCell(state: GameState, target: WorldCell): GameState | string {
  const card = state.activeCard;
  if (!card || !target.land) return '';
  if (card.ink <= 0) return 'Чернила этой карты закончились.';
  const repeat = state.brushMode === 'density';
  const touched = state.strokeCellIds.includes(target.id);

  if (card.type === 'drought' || card.type === 'rain') {
    if (card.targetCountryId && target.ownerId !== card.targetCountryId) {
      return 'Эта карта действует только на территории выбранной страны.';
    }
    if (touched && !repeat) return '';
    const room = climateRoom(target, card.type);
    if (room <= 0) return 'Влажность здесь уже на пределе — чернила не потрачены.';
    const delta = Math.min(HUMIDITY_PER_STROKE, room, card.ink * HUMIDITY_PER_INK);
    const humidity = target.humidity + (card.type === 'rain' ? delta : -delta);
    const updated = { ...target, humidity, biome: biomeFor(humidity, target.temperature, target.drainage) };
    return withCell(state, updated, Math.ceil(delta / HUMIDITY_PER_INK), `${target.biome} → ${updated.biome}; влажность ${humidity}%.`);
  }

  if (card.type === 'create' || card.type === 'expand') {
    const country = workingCountry(state);
    if (!country) return '';
    if (target.ownerId === country.id) {
      if (!repeat) return '';
      if (target.density >= MAX_DENSITY) return 'Плотность здесь уже максимальна.';
      return withCell(state, { ...target, density: target.density + 1 }, 1, `Плотность населения: ${target.density + 1}.`);
    }
    if (target.ownerId !== null) return 'Эта область уже принадлежит другому государству.';
    const painted = state.cells.filter((cell) => cell.ownerId === country.id).length + 1;
    return withCell(
      state,
      { ...target, ownerId: country.id, density: country.density, cultureId: country.cultureId, religionId: country.religionId },
      1,
      `${country.name}: областей ${painted}.`,
    );
  }

  if (card.type === 'split') {
    const draft = state.draftCountry;
    if (!draft || target.ownerId === draft.id) return '';
    if (target.ownerId !== card.targetCountryId) return 'Раскол можно рисовать только внутри исходной страны.';
    const remaining = state.cells.filter((cell) => cell.ownerId === card.targetCountryId).length;
    if (remaining <= 1) return 'Исходная страна должна сохранить хотя бы одну область.';
    return withCell(state, { ...target, ownerId: draft.id }, 1, `${draft.name}: выделено областей ${state.strokeCellIds.length + 1}.`);
  }

  if (card.type === 'faith') {
    const religion = state.draftReligion;
    if (!religion) return '';
    if (target.ownerId === null) return 'На ничейной земле нет населения, которое могло бы принять веру.';
    if (card.targetCountryId && target.ownerId !== card.targetCountryId) return 'Эта вера возникает только в выбранной стране.';
    if (target.religionId === religion.id) return '';
    return withCell(state, { ...target, religionId: religion.id }, 1, `${religion.name}: областей ${state.strokeCellIds.length + 1}.`);
  }

  const culture = state.draftCulture;
  if (!culture) return '';
  if (target.ownerId === null) return 'На ничейной земле нет населения.';
  if (card.targetCountryId && target.ownerId !== card.targetCountryId) return 'Эта карта действует только в выбранной стране.';
  if (target.cultureId === culture.id) return '';
  if (target.cultureId !== card.sourceCultureId) {
    const source = state.cultures.find((item) => item.id === card.sourceCultureId);
    return `Кисть меняет только народ «${source?.name ?? 'исходная культура'}».`;
  }
  return withCell(state, { ...target, cultureId: culture.id }, 1, `${culture.name}: областей ${state.strokeCellIds.length + 1}.`);
}

function setMessage(state: GameState, message: string): GameState {
  if (state.message === message) return state;
  return { ...state, message };
}

export function paintCell(state: GameState, cellId: string): GameState {
  const card = state.activeCard;
  if (!card || state.paused) return state;
  const target = state.cells.find((cell) => cell.id === cellId);
  if (!target || !target.land) return state;

  if (card.type === 'create' || card.type === 'expand' || card.type === 'split') {
    const country = workingCountry(state);
    const ownedByWorking = country !== null && target.ownerId === country.id;
    if (country && !ownedByWorking) {
      const linked = new Set(state.cells.filter((cell) => cell.ownerId === country.id).map((cell) => cell.id));
      if (linked.size > 0 && !isLinkedByLandOrSea(state.cells, target, linked)) {
        return setMessage(state, 'Продолжайте от своей территории — по суше или через то же море.');
      }
    }
  }

  const result = applyCardToCell(state, target);
  if (typeof result === 'string') return result ? setMessage(state, result) : state;
  return result;
}

// ---------- automatic play (AI and timeouts) ----------

function autoTargets(state: GameState): WorldCell[] {
  const card = state.activeCard as GameCard;
  const cells = state.cells;
  const ink = card.ink;
  switch (card.type) {
    case 'create': {
      const seeds = cells.filter(freeLand);
      if (seeds.length === 0) return [];
      return growOrder(cells, [randomItem(seeds)], freeLand, (cell) => !cell.land, ink);
    }
    case 'expand': {
      const owned = cells.filter((cell) => cell.ownerId === card.targetCountryId);
      return growOrder(cells, owned, freeLand, (cell) => !cell.land || cell.ownerId === card.targetCountryId, ink);
    }
    case 'split': {
      const owned = cells.filter((cell) => cell.ownerId === card.targetCountryId);
      if (owned.length < 2) return [];
      return growOrder(cells, [randomItem(owned)], (cell) => cell.ownerId === card.targetCountryId, () => false, Math.min(ink, owned.length - 1));
    }
    case 'drought':
    case 'rain': {
      const type = card.type;
      return shuffle(
        cells.filter((cell) => cell.land && climateRoom(cell, type) > 0 && (!card.targetCountryId || cell.ownerId === card.targetCountryId)),
      ).slice(0, Math.max(3, Math.ceil(ink / 3)));
    }
    case 'faith': {
      const inScope = (cell: WorldCell) => cell.ownerId !== null && (!card.targetCountryId || cell.ownerId === card.targetCountryId);
      const scope = cells.filter(inScope);
      if (scope.length === 0) return [];
      return growOrder(cells, [randomItem(scope)], inScope, () => false, ink);
    }
    case 'culture': {
      const inScope = (cell: WorldCell) =>
        cell.ownerId !== null && cell.cultureId === card.sourceCultureId && (!card.targetCountryId || cell.ownerId === card.targetCountryId);
      const scope = cells.filter(inScope);
      if (scope.length === 0) return [];
      return growOrder(cells, [randomItem(scope)], inScope, () => false, ink);
    }
  }
}

function autoFill(state: GameState): GameState {
  let next = { ...state, brushMode: 'respect' as BrushMode };
  for (const target of autoTargets(state)) {
    if (!next.activeCard || next.activeCard.ink <= 0) break;
    const current = next.cells[target.row * COLS + target.col];
    const result = applyCardToCell(next, current);
    if (typeof result !== 'string') next = result;
  }
  return { ...next, brushMode: state.brushMode };
}

function addLog(state: GameState, lines: string[]): string[] {
  return [...lines.map((line) => `${state.year}: ${line}`), ...state.eventLog].slice(0, LOG_LIMIT);
}

/** Finishes the active card: auto-plays it if nothing was painted, registers new entities and writes the log. */
function completeActiveCard(input: GameState): GameState {
  if (!input.activeCard) return input;
  let state = input.strokeCellIds.length === 0 ? autoFill(input) : input;
  const card = state.activeCard as GameCard;
  const touched = state.strokeCellIds.length;
  const target = state.countries.find((country) => country.id === card.targetCountryId);
  let countries = state.countries;
  let cultures = state.cultures;
  let religions = state.religions;
  let cells = state.cells;
  let focusCountryId = state.focusCountryId;
  let log: string;

  switch (card.type) {
    case 'create': {
      const draft = state.draftCountry as Country;
      const created = cells.filter((cell) => cell.ownerId === draft.id);
      if (created.length === 0) {
        log = `${draft.name} так и не было основано.`;
        break;
      }
      // Unspent ink becomes extra population spread over the new territory.
      const bonusEach = Math.floor(card.ink / created.length);
      let remainder = card.ink % created.length;
      cells = cells.map((cell) => {
        if (cell.ownerId !== draft.id) return cell;
        const extra = bonusEach + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        return { ...cell, density: Math.min(MAX_DENSITY, cell.density + extra) };
      });
      countries = [...countries, draft];
      if (state.draftCulture) cultures = [...cultures, state.draftCulture];
      if (state.role === 'country' && !focusCountryId) focusCountryId = draft.id;
      const faith = religions.find((religion) => religion.id === draft.religionId)?.name ?? 'без веры';
      log = `Основано ${draft.rank.toLowerCase()} ${draft.name} (${created.length} обл.), народ «${state.draftCulture?.name}», ${faith}.`;
      break;
    }
    case 'split': {
      const draft = state.draftCountry as Country;
      const taken = cells.filter((cell) => cell.ownerId === draft.id).length;
      if (taken === 0) {
        log = `${target?.name ?? 'Страна'} избежало раскола.`;
        break;
      }
      countries = [...countries, draft];
      log = `${target?.name ?? 'Страна'} раскололось: ${draft.name} забрало ${taken} обл.`;
      break;
    }
    case 'expand':
      log = touched > 0 ? `${target?.name ?? 'Страна'} расширилось (+${touched} обл.).` : `${target?.name ?? 'Страна'} не нашло земель для расширения.`;
      break;
    case 'drought':
    case 'rain':
      log = `${target ? `${target.name}: ` : 'Мир: '}${card.title.toLowerCase()} затронули ${touched} обл.`;
      break;
    case 'faith': {
      const religion = state.draftReligion as Religion;
      if (touched > 0) religions = [...religions, religion];
      log = touched > 0 ? `Возникла вера «${religion.name}»${target ? ` в ${target.name}` : ''} (${touched} обл.).` : 'Новая вера не нашла последователей.';
      break;
    }
    case 'culture': {
      const culture = state.draftCulture as Culture;
      if (touched > 0) cultures = [...cultures, culture];
      log = touched > 0 ? `Выделился народ «${culture.name}»${target ? ` в ${target.name}` : ''} (${touched} обл.).` : 'Новая культура не выделилась.';
      break;
    }
  }

  return {
    ...state,
    cells,
    countries,
    cultures,
    religions,
    focusCountryId,
    activeCard: null,
    draftCountry: null,
    draftCulture: null,
    draftReligion: null,
    strokeCellIds: [],
    eventLog: addLog(state, [log]),
    message: log,
  };
}

function withDrawn(state: GameState, drawn: DrawnCard): GameState {
  return {
    ...state,
    activeCard: drawn.card,
    draftCountry: drawn.draftCountry,
    draftCulture: drawn.draftCulture,
    draftReligion: drawn.draftReligion,
    strokeCellIds: [],
  };
}

function resolveAutomatically(state: GameState, drawn: DrawnCard): GameState {
  return completeActiveCard(withDrawn(state, drawn));
}

function mapModeFor(card: GameCard, current: MapMode): MapMode {
  if (card.type === 'drought' || card.type === 'rain') return 'biomes';
  if (card.type === 'faith') return 'religions';
  if (card.type === 'culture') return 'cultures';
  return current === 'political' ? current : 'political';
}

/** Draws the next applicable player card from the queue, skipping slots that have nothing to play. */
function startNextPlayerCard(state: GameState, slots: CardSlot[]): GameState {
  const remaining = [...slots];
  while (remaining.length > 0) {
    const slot = remaining.shift() as CardSlot;
    let drawn: DrawnCard | null = null;
    if (slot.scope === 'world') {
      drawn = drawWorldCard(state);
    } else {
      const country = state.countries.find((item) => item.id === slot.countryId);
      if (country) drawn = drawCountryCard(state, country);
    }
    if (drawn) {
      return {
        ...withDrawn(state, drawn),
        queuedCards: remaining,
        secondsLeft: 60,
        paused: false,
        mapMode: mapModeFor(drawn.card, state.mapMode),
        message: drawn.card.detail,
      };
    }
  }
  return {
    ...state,
    activeCard: null,
    draftCountry: null,
    draftCulture: null,
    draftReligion: null,
    strokeCellIds: [],
    queuedCards: [],
    message: state.role === 'observer' ? state.eventLog[0] ?? 'Мир развивается сам.' : 'В этом году нет применимых карт.',
  };
}

function playerSlots(state: GameState): CardSlot[] {
  if (state.role === 'observer') return [];
  if (state.role === 'country') {
    return state.focusCountryId ? [{ scope: 'country', countryId: state.focusCountryId }] : [];
  }
  if (state.role === 'world') return [{ scope: 'world' }];
  return [{ scope: 'world' }, ...state.countries.map((country): CardSlot => ({ scope: 'country', countryId: country.id }))];
}

function baseState(mapKind: MapKind, role: PlayerRole): GameState {
  return {
    mapKind,
    role,
    turn: 1,
    year: 1000,
    cells: makeCells(mapKind),
    countries: [],
    cultures: [],
    religions: [],
    focusCountryId: null,
    activeCard: null,
    queuedCards: [],
    draftCountry: null,
    draftCulture: null,
    draftReligion: null,
    strokeCellIds: [],
    brushMode: 'respect',
    mapMode: 'political',
    secondsLeft: 60,
    paused: false,
    eventLog: ['1000: Мир создан.'],
    message: '',
  };
}

export function createGame(mapKind: MapKind, role: PlayerRole): GameState {
  const initial = baseState(mapKind, role);
  const first = drawCreate(initial);
  if (!first) return { ...initial, message: 'На карте нет свободной суши.' };
  if (role === 'observer') {
    const state = resolveAutomatically(initial, first);
    return { ...state, message: state.eventLog[0] };
  }
  const country = first.draftCountry as Country;
  return {
    ...withDrawn(initial, first),
    focusCountryId: role === 'country' ? country.id : null,
    message: `${country.rank} ${country.name}: народ «${first.draftCulture?.name}», ${country.density} ед. населения на область.`,
  };
}

export function advanceTurn(current: GameState): GameState {
  const state = completeActiveCard(current);
  if (state.queuedCards.length > 0) {
    const next = startNextPlayerCard(state, state.queuedCards);
    if (next.activeCard) return next;
  }

  let world: GameState = { ...state, turn: state.turn + 1, year: state.year + 1, queuedCards: [] };

  if (world.role === 'country' || world.role === 'observer') {
    const drawn = drawWorldCard(world);
    if (drawn) world = resolveAutomatically(world, drawn);
  }
  if (world.role !== 'all') {
    for (const id of world.countries.map((country) => country.id)) {
      if (world.role === 'country' && id === world.focusCountryId) continue;
      const country = world.countries.find((item) => item.id === id);
      if (!country) continue;
      const drawn = drawCountryCard(world, country);
      if (drawn) world = resolveAutomatically(world, drawn);
    }
  }

  const started = startNextPlayerCard({ ...pruneExtinct(world), secondsLeft: 60, paused: false }, playerSlots(world));
  return started;
}

/** Drops cultures and religions that no longer have any followers. */
function pruneExtinct(state: GameState): GameState {
  const liveCultures = new Set(state.cells.map((cell) => cell.cultureId));
  const liveReligions = new Set(state.cells.map((cell) => cell.religionId));
  state.countries.forEach((country) => {
    liveCultures.add(country.cultureId);
    liveReligions.add(country.religionId);
  });
  const cultures = state.cultures.filter((culture) => liveCultures.has(culture.id));
  const religions = state.religions.filter((religion) => liveReligions.has(religion.id));
  if (cultures.length === state.cultures.length && religions.length === state.religions.length) return state;
  return { ...state, cultures, religions };
}

export function tickTimer(state: GameState): GameState {
  if (state.paused) return state;
  if (state.secondsLeft <= 1) return advanceTurn(state);
  return { ...state, secondsLeft: state.secondsLeft - 1 };
}

export function togglePause(state: GameState): GameState {
  return { ...state, paused: !state.paused };
}

export function setMapMode(state: GameState, mapMode: MapMode): GameState {
  return state.mapMode === mapMode ? state : { ...state, mapMode };
}

export function toggleBrushMode(state: GameState): GameState {
  const option = brushOptionFor(state.activeCard);
  if (!option) return state;
  const brushMode: BrushMode = state.brushMode === 'respect' ? 'density' : 'respect';
  const message =
    option === 'density'
      ? brushMode === 'density'
        ? 'Повторная окраска своей территории повышает плотность и расходует чернила.'
        : 'Повторная окраска своей территории ничего не меняет.'
      : brushMode === 'density'
        ? 'Повторный мазок по области снова меняет влажность.'
        : 'Каждая область меняется не больше одного раза за карту.';
  return { ...state, brushMode, message };
}

// ---------- map colors and legends ----------

export interface LegendEntry {
  id: string;
  label: string;
  color: string;
  count: number;
  detail?: string;
}

export function getCellColor(state: GameState, cell: WorldCell): string {
  const palette = colors.light;
  if (!cell.land) return palette.ocean;
  switch (state.mapMode) {
    case 'biomes':
      return BIOMES.find((biome) => biome.name === cell.biome)?.color ?? palette.unclaimedLand;
    case 'cultures': {
      if (!cell.cultureId) return palette.unclaimedLand;
      const culture =
        state.cultures.find((item) => item.id === cell.cultureId) ??
        (state.draftCulture?.id === cell.cultureId ? state.draftCulture : null);
      return culture?.color ?? palette.unclaimedLand;
    }
    case 'religions': {
      if (!cell.ownerId) return palette.unclaimedLand;
      if (!cell.religionId) return palette.noFaith;
      const religion =
        state.religions.find((item) => item.id === cell.religionId) ??
        (state.draftReligion?.id === cell.religionId ? state.draftReligion : null);
      return religion?.color ?? palette.noFaith;
    }
    default: {
      if (!cell.ownerId) return palette.unclaimedLand;
      const owner =
        state.countries.find((country) => country.id === cell.ownerId) ??
        (state.draftCountry?.id === cell.ownerId ? state.draftCountry : null);
      return owner?.color ?? palette.unclaimedLand;
    }
  }
}

export function getLegend(state: GameState): LegendEntry[] {
  const palette = colors.light;
  const land = state.cells.filter((cell) => cell.land);
  const tally = (pick: (cell: WorldCell) => string | null) => {
    const counts = new Map<string, number>();
    for (const cell of land) {
      const key = pick(cell);
      if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  switch (state.mapMode) {
    case 'biomes': {
      const counts = tally((cell) => cell.biome);
      return BIOMES.map((biome) => ({ id: biome.name, label: biome.name, color: biome.color, count: counts.get(biome.name) ?? 0, detail: biome.rule }));
    }
    case 'cultures': {
      const counts = tally((cell) => cell.cultureId);
      const all = [...state.cultures, ...(state.draftCulture ? [state.draftCulture] : [])];
      return all
        .filter((culture) => (counts.get(culture.id) ?? 0) > 0)
        .map((culture) => ({ id: culture.id, label: culture.name, color: culture.color, count: counts.get(culture.id) ?? 0 }))
        .sort((a, b) => b.count - a.count);
    }
    case 'religions': {
      const counts = tally((cell) => (cell.ownerId ? cell.religionId ?? 'none' : null));
      const all = [...state.religions, ...(state.draftReligion ? [state.draftReligion] : [])];
      const entries: LegendEntry[] = all
        .filter((religion) => (counts.get(religion.id) ?? 0) > 0)
        .map((religion) => ({ id: religion.id, label: religion.name, color: religion.color, count: counts.get(religion.id) ?? 0 }));
      if ((counts.get('none') ?? 0) > 0) entries.push({ id: 'none', label: 'Без веры', color: palette.noFaith, count: counts.get('none') ?? 0 });
      return entries.sort((a, b) => b.count - a.count);
    }
    default: {
      const counts = tally((cell) => cell.ownerId);
      const all = [...state.countries, ...(state.draftCountry ? [state.draftCountry] : [])];
      return all
        .map((country) => ({ id: country.id, label: country.name, color: country.color, count: counts.get(country.id) ?? 0 }))
        .filter((entry) => entry.count > 0 || entry.id === state.draftCountry?.id)
        .sort((a, b) => b.count - a.count);
    }
  }
}

export function cultureName(state: GameState, id: string | null): string {
  if (!id) return '—';
  return (state.cultures.find((item) => item.id === id) ?? (state.draftCulture?.id === id ? state.draftCulture : null))?.name ?? '—';
}

export function religionName(state: GameState, id: string | null): string {
  if (!id) return 'Без веры';
  return (state.religions.find((item) => item.id === id) ?? (state.draftReligion?.id === id ? state.draftReligion : null))?.name ?? 'Без веры';
}

// ---------- saved games ----------

type LegacyCountry = Partial<Country> & { culture?: string; religion?: string };

/** Upgrades older saves: fixes split duplicates, adds cultures/religions, unique colors and new biome rules. */
export function normalizeSavedGame(raw: GameState): GameState {
  const legacy = !Array.isArray(raw.cultures);
  const role: PlayerRole = ['all', 'country', 'world', 'observer'].includes(raw.role as string) ? raw.role : 'country';

  // Older versions inserted duplicate "split-" cells; fold them back into the grid.
  const byId = new Map<string, WorldCell>();
  for (const cell of raw.cells) {
    if (!cell.id.startsWith('split-')) byId.set(cell.id, { ...cell });
  }
  for (const cell of raw.cells) {
    if (!cell.id.startsWith('split-')) continue;
    const original = byId.get(cell.id.slice('split-'.length));
    if (original) original.ownerId = cell.ownerId;
  }
  let cells = [...byId.values()]
    .sort((a, b) => a.row * COLS + a.col - (b.row * COLS + b.col))
    .map((cell) => ({
      ...cell,
      cultureId: cell.cultureId ?? null,
      religionId: cell.religionId ?? null,
      biome: biomeFor(cell.humidity, cell.temperature, cell.drainage),
    }));

  let state: GameState = {
    ...baseState(raw.mapKind, role),
    ...raw,
    role,
    cells,
    cultures: legacy ? [] : raw.cultures,
    religions: Array.isArray(raw.religions) ? raw.religions : [],
    draftCulture: raw.draftCulture ?? null,
    draftReligion: raw.draftReligion ?? null,
    strokeCellIds: Array.isArray(raw.strokeCellIds) ? raw.strokeCellIds : [],
    mapMode: raw.mapMode ?? 'political',
    brushMode: raw.brushMode === 'density' ? 'density' : 'respect',
    queuedCards: Array.isArray(raw.queuedCards) ? raw.queuedCards.filter((slot) => slot && 'scope' in slot) : [],
    eventLog: Array.isArray(raw.eventLog) ? raw.eventLog : [],
  };

  // Keep every country color unique.
  const usedColors = new Set<string>();
  const countries = state.countries.map((country) => {
    let color = country.color.toLowerCase();
    if (usedColors.has(color)) color = pickUniqueColor(colors.light.countryPalette, usedColors);
    usedColors.add(color);
    return { ...country, color };
  });
  state = { ...state, countries };

  if (!legacy) return state;

  // Legacy saves stored culture and religion names on countries only.
  const cultures: Culture[] = [];
  const religions: Religion[] = [];
  const cultureByName = new Map<string, Culture>();
  const religionByName = new Map<string, Religion>();
  const upgraded = (state.countries as LegacyCountry[]).map((country) => {
    const cultureLabel = country.culture ?? 'Народ';
    let culture = cultureByName.get(cultureLabel);
    if (!culture) {
      culture = { id: idFor('culture'), name: cultureLabel, color: pickUniqueColor(colors.light.culturePalette, colorSet(cultures)), parentId: null };
      cultureByName.set(cultureLabel, culture);
      cultures.push(culture);
    }
    let religionId: string | null = null;
    if (country.religion && country.religion !== 'Без веры') {
      let religion = religionByName.get(country.religion);
      if (!religion) {
        religion = { id: idFor('faith'), name: country.religion, color: pickUniqueColor(colors.light.religionPalette, colorSet(religions)), parentId: null };
        religionByName.set(country.religion, religion);
        religions.push(religion);
      }
      religionId = religion.id;
    }
    const { culture: _culture, religion: _religion, ...rest } = country;
    return { ...rest, cultureId: culture.id, religionId } as Country;
  });
  const ownerInfo = new Map(upgraded.map((country) => [country.id, country]));
  cells = state.cells.map((cell) => {
    const owner = cell.ownerId ? ownerInfo.get(cell.ownerId) : undefined;
    return owner ? { ...cell, cultureId: owner.cultureId, religionId: owner.religionId } : { ...cell, ownerId: null };
  });

  const migrated: GameState = {
    ...state,
    cells,
    countries: upgraded,
    cultures,
    religions,
    activeCard: null,
    draftCountry: null,
    draftCulture: null,
    draftReligion: null,
    strokeCellIds: [],
    queuedCards: [],
  };
  if (migrated.countries.length === 0 && role !== 'observer') {
    const first = drawCreate(migrated);
    return first ? { ...withDrawn(migrated, first), message: first.card.detail } : migrated;
  }
  if (role === 'country' && !upgraded.some((country) => country.id === migrated.focusCountryId)) {
    migrated.focusCountryId = upgraded[0]?.id ?? null;
  }
  return startNextPlayerCard(migrated, playerSlots(migrated));
}

export const MAP_ROWS = ROWS;
export const MAP_COLS = COLS;
