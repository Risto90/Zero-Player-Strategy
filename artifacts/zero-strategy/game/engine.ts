import colors from '@/constants/colors';

export type MapKind = 'world' | 'random';
export type PlayerRole = 'all' | 'country' | 'world' | 'observer';
export type CardType = 'create' | 'expand' | 'split' | 'drought' | 'rain';
export type BrushMode = 'respect' | 'density';

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
}

export interface Country {
  id: string;
  name: string;
  color: string;
  rank: string;
  culture: string;
  religion: string;
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
}

export interface QueuedCard {
  card: GameCard;
  draftCountry: Country | null;
}

export interface GameState {
  mapKind: MapKind;
  role: PlayerRole;
  turn: number;
  year: number;
  cells: WorldCell[];
  countries: Country[];
  focusCountryId: string | null;
  activeCard: GameCard | null;
  queuedCards: QueuedCard[];
  draftCountry: Country | null;
  draftCellIds: string[];
  brushMode: BrushMode;
  secondsLeft: number;
  paused: boolean;
  eventLog: string[];
  message: string;
}

const ROWS = 12;
const COLS = 20;

const COUNTRY_COLORS = colors.light.countryPalette;
const CULTURES = [
  'Велари',
  'Тарны',
  'Саэли',
  'Орвены',
  'Келты',
  'Айнумены',
  'Нарви',
  'Эрвалы',
];
const RELIGIONS = [
  'Вечный Огонь',
  'Путь Прилива',
  'Старые Дубы',
  'Без веры',
  'Небесный Завет',
  'Память Предков',
];
const NAME_START = [
  'Аст',
  'Вел',
  'Кал',
  'Мор',
  'Нор',
  'Тар',
  'Эр',
  'Сол',
  'Лир',
  'Ор',
];
const NAME_END = [
  'ария',
  'вальд',
  'марк',
  'орн',
  'ест',
  'ания',
  'дора',
  'град',
  'рия',
  'вена',
];
const RANKS = [
  { name: 'Баронство', ink: 12 },
  { name: 'Графство', ink: 18 },
  { name: 'Герцогство', ink: 25 },
  { name: 'Королевство', ink: 34 },
  { name: 'Империя', ink: 44 },
  { name: 'Гегемония', ink: 56 },
];

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomName(): string {
  return `${randomItem(NAME_START)}${randomItem(NAME_END)}`;
}

function idFor(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isInEllipse(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
): boolean {
  const dx = (x - centerX) / radiusX;
  const dy = (y - centerY) / radiusY;
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
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const x = col / (COLS - 1);
    const y = row / (ROWS - 1);
    const edge = Math.random() * 0.28 - 0.14;
    return centers.some(({ x: cx, y: cy, rx, ry }) =>
      isInEllipse(x, y, cx, cy, rx + edge, ry + edge),
    );
  });

  return mask.map((land, index) => {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    let neighbors = 0;
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (
        nextRow >= 0 &&
        nextRow < ROWS &&
        nextCol >= 0 &&
        nextCol < COLS &&
        mask[nextRow * COLS + nextCol]
      ) {
        neighbors += 1;
      }
    }
    return land ? neighbors > 0 : neighbors >= 3;
  });
}

function biomeFor(humidity: number, temperature: number, drainage: number): string {
  if (drainage > 78 && humidity > 58) return 'Болота';
  if (humidity < 23) return 'Пустыня';
  if (temperature < 25) return humidity > 45 ? 'Тайга' : 'Тундра';
  if (humidity > 73) return 'Тропики';
  if (humidity > 48) return 'Леса';
  if (humidity > 30) return 'Степи';
  return 'Пустыня';
}

function makeCells(mapKind: MapKind): WorldCell[] {
  const randomMask = mapKind === 'random' ? makeRandomLandMask() : [];
  return Array.from({ length: ROWS * COLS }, (_, index) => {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const x = col / (COLS - 1);
    const y = row / (ROWS - 1);
    const land =
      mapKind === 'world'
        ? isWorldLand(x, y)
        : randomMask[index];
    const temperature = Math.max(4, Math.min(92, Math.round(95 - Math.abs(y - 0.5) * 150 + (Math.random() * 14 - 7))));
    const humidity = Math.round(15 + Math.random() * 75);
    const drainage = Math.round(Math.random() * 100);
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
    };
  });
}

function makeCountry(
  rank: (typeof RANKS)[number] = randomItem(RANKS),
  source?: Country,
): Country {
  return {
    id: idFor('nation'),
    name: randomName(),
    color: randomItem(COUNTRY_COLORS),
    rank: rank.name,
    culture: source?.culture ?? randomItem(CULTURES),
    religion: source?.religion ?? randomItem(RELIGIONS),
    government: source?.government ?? 'Племя',
    density: source?.density ?? 1 + Math.floor(Math.random() * 5),
    ink: rank.ink,
  };
}

function makeCard(type: CardType, targetCountryId: string | null = null): GameCard {
  const ink = type === 'create' ? 0 : type === 'expand' ? 7 : type === 'split' ? 8 : 8;
  const titles: Record<CardType, string> = {
    create: 'Создание государства',
    expand: 'Расширение страны',
    split: 'Раскол страны',
    drought: 'Засуха',
    rain: 'Ливни',
  };
  const detail: Record<CardType, string> = {
    create: 'Проведите кистью по суше, чтобы определить первые границы.',
    expand: 'Закрашивайте свободные земли у границ или за морем.',
    split: 'Выделите часть страны в новое государство.',
    drought: 'Снижайте влажность на суше. Нулевые значения не расходуют чернила.',
    rain: 'Повышайте влажность на суше.',
  };
  return { type, title: titles[type], detail: detail[type], ink, targetCountryId };
}

export function createGame(mapKind: MapKind, role: PlayerRole): GameState {
  const rank = randomItem(RANKS);
  const starter = makeCountry(rank);
  const activeCard = role === 'observer' ? null : makeCard('create');
  if (activeCard) activeCard.ink = rank.ink;
  const cells = makeCells(mapKind);
  const initial: GameState = {
    mapKind,
    role,
    turn: 1,
    year: 1000,
    cells,
    countries: [],
    focusCountryId: role === 'country' ? starter.id : null,
    activeCard,
    queuedCards: [],
    draftCountry: starter,
    draftCellIds: [],
    brushMode: 'respect',
    secondsLeft: 60,
    paused: false,
    eventLog: ['Мир создан. Первое государство ждёт своих границ.'],
    message:
      role === 'observer'
        ? 'Вы наблюдаете за зарождением мира.'
        : `${starter.rank} ${starter.name}: ${starter.culture}, ${starter.density} ед. населения на область.`,
  };
  if (role !== 'observer') return initial;

  const seed = findAutoLand(cells);
  if (!seed) return { ...initial, draftCountry: null };
  const establishedCells = growFromSeed(cells, seed, 5, starter.id);
  return {
    ...initial,
    cells: establishedCells.map((cell) =>
      cell.ownerId === starter.id ? { ...cell, density: starter.density } : cell,
    ),
    countries: [starter],
    draftCountry: null,
    draftCellIds: [],
    eventLog: [`${starter.name} основало первое государство.`, ...initial.eventLog].slice(0, 8),
    message: `${starter.name} возникло без вмешательства игрока.`,
  };
}

function cellNeighbors(cells: WorldCell[], cell: WorldCell): WorldCell[] {
  return cells.filter(
    (candidate) =>
      Math.abs(candidate.row - cell.row) + Math.abs(candidate.col - cell.col) === 1,
  );
}

function isCoastal(cells: WorldCell[], cell: WorldCell): boolean {
  return cellNeighbors(cells, cell).some((neighbor) => !neighbor.land);
}

function isLinkedByLandOrSea(
  cells: WorldCell[],
  target: WorldCell,
  linkedCells: WorldCell[],
): boolean {
  const nearby = cellNeighbors(cells, target);
  if (linkedCells.some((cell) => nearby.some((neighbor) => neighbor.id === cell.id))) {
    return true;
  }
  if (!isCoastal(cells, target)) return false;
  const targetWater = nearby.filter((neighbor) => !neighbor.land);
  return linkedCells.some(
    (cell) =>
      isCoastal(cells, cell) &&
      cellNeighbors(cells, cell).some((neighbor) =>
        targetWater.some((water) => water.id === neighbor.id),
      ),
  );
}

function updateBiome(cell: WorldCell): WorldCell {
  return { ...cell, biome: biomeFor(cell.humidity, cell.temperature, cell.drainage) };
}

function setMessage(state: GameState, message: string): GameState {
  if (state.message === message) return state;
  return { ...state, message };
}

export function paintCell(state: GameState, cellId: string): GameState {
  const card = state.activeCard;
  if (!card || state.paused) return state;
  const targetIndex = state.cells.findIndex((cell) => cell.id === cellId);
  if (targetIndex < 0) return state;
  const target = state.cells[targetIndex];

  if (card.type === 'drought' || card.type === 'rain') {
    if (!target.land) return state;
    if (
      card.targetCountryId &&
      target.ownerId !== card.targetCountryId
    ) {
      return setMessage(state, 'Эта карта действует только на территории выбранной страны.');
    }
    if (card.ink <= 0) return setMessage(state, 'Чернила этой карты закончились.');
    const humidity = Math.max(
      0,
      Math.min(100, target.humidity + (card.type === 'rain' ? 15 : -15)),
    );
    if (humidity === target.humidity) {
      return setMessage(state, 'На этой области влажность уже достигла предела.');
    }
    const cells = [...state.cells];
    cells[targetIndex] = updateBiome({ ...target, humidity });
    return {
      ...state,
      cells,
      activeCard: { ...card, ink: card.ink - 1 },
      secondsLeft: Math.min(90, state.secondsLeft + 2),
      message: `${target.biome} → ${cells[targetIndex].biome}; влажность ${humidity}%.`,
    };
  }

  const isNewCountry = card.type === 'create' || card.type === 'split';
  const workingCountry = isNewCountry ? state.draftCountry : null;
  const countryId = workingCountry?.id ?? card.targetCountryId;
  if (!countryId) return state;
  if (!target.land) return state;

  const alreadyOnTarget = target.ownerId === countryId;
  if (alreadyOnTarget) {
    if (state.brushMode !== 'density' || card.ink <= 0) return state;
    const cells = [...state.cells];
    cells[targetIndex] = { ...target, density: Math.min(20, target.density + 1) };
    return {
      ...state,
      cells,
      activeCard: { ...card, ink: card.ink - 1 },
      secondsLeft: Math.min(90, state.secondsLeft + 2),
      message: `Плотность населения увеличена на области ${target.row + 1}:${target.col + 1}.`,
    };
  }

  if (card.ink <= 0) return setMessage(state, 'Чернила этой карты закончились.');
  const linked = isNewCountry
    ? state.cells.filter((cell) => state.draftCellIds.includes(cell.id))
    : state.cells.filter((cell) => cell.ownerId === countryId);
  if (linked.length > 0 && !isLinkedByLandOrSea(state.cells, target, linked)) {
    return setMessage(state, 'Начните новую часть от своей территории, не прерывая мазок.');
  }

  if (card.type === 'expand' && target.ownerId !== null) {
    return setMessage(state, 'Для расширения выберите свободную территорию.');
  }
  if (card.type === 'split' && target.ownerId !== card.targetCountryId) {
    return setMessage(state, 'Раскол можно рисовать только внутри исходной страны.');
  }
  if (card.type === 'create' && target.ownerId !== null) {
    return setMessage(state, 'Эта область уже принадлежит другому государству.');
  }

  const cells = [...state.cells];
  cells[targetIndex] = {
    ...target,
    ownerId: countryId,
    density: workingCountry?.density ?? target.density,
  };
  const newDraftCells = isNewCountry
    ? [...state.draftCellIds, target.id]
    : state.draftCellIds;
  return {
    ...state,
    cells,
    draftCellIds: newDraftCells,
    activeCard: { ...card, ink: card.ink - 1 },
    secondsLeft: Math.min(90, state.secondsLeft + 2),
    message: `${workingCountry?.name ?? 'Государство'}: окрашено областей ${newDraftCells.length || linked.length + 1}.`,
  };
}

function findAutoLand(cells: WorldCell[], requiredOwner: string | null = null): WorldCell | undefined {
  const valid = cells.filter((cell) =>
    requiredOwner === null ? cell.land && !cell.ownerId : cell.ownerId === requiredOwner,
  );
  return randomItem(valid);
}

function growFromSeed(cells: WorldCell[], seed: WorldCell, count: number, ownerId: string): WorldCell[] {
  const owned = new Set([seed.id]);
  let frontier = [seed];
  while (owned.size < count && frontier.length > 0) {
    const nextFrontier: WorldCell[] = [];
    for (const current of frontier) {
      for (const neighbor of cellNeighbors(cells, current)) {
        if (neighbor.land && !neighbor.ownerId && !owned.has(neighbor.id)) {
          owned.add(neighbor.id);
          nextFrontier.push(neighbor);
          if (owned.size >= count) break;
        }
      }
      if (owned.size >= count) break;
    }
    frontier = nextFrontier;
  }
  return cells.map((cell) => (owned.has(cell.id) ? { ...cell, ownerId } : cell));
}

function completeActiveCard(state: GameState): GameState {
  const card = state.activeCard;
  if (!card) return state;
  let cells = [...state.cells];
  let countries = [...state.countries];
  let draftCellIds = [...state.draftCellIds];
  let draftCountry = state.draftCountry;

  if (draftCountry) {
    if (draftCellIds.length === 0 && card.type === 'create') {
      const seed = findAutoLand(cells);
      if (seed) {
        const before = new Set(cells.filter((cell) => cell.ownerId === draftCountry?.id).map((cell) => cell.id));
        cells = growFromSeed(cells, seed, 5, draftCountry.id);
        draftCellIds = cells.filter((cell) => cell.ownerId === draftCountry?.id && !before.has(cell.id)).map((cell) => cell.id);
      }
    } else if (draftCellIds.length === 0 && card.type === 'split' && card.targetCountryId) {
      const sourceCells = cells.filter((cell) => cell.ownerId === card.targetCountryId);
      const seed = randomItem(sourceCells);
      if (seed) {
        const sourceIndex = cells.findIndex((cell) => cell.id === seed.id);
        const newCell = { ...seed, id: `split-${seed.id}`, ownerId: draftCountry.id };
        cells.splice(sourceIndex, 1, { ...seed, ownerId: card.targetCountryId }, newCell);
        draftCellIds = [newCell.id];
      }
    }

    if (draftCellIds.length > 0) {
      const bonus = Math.floor(card.ink / draftCellIds.length);
      cells = cells.map((cell) =>
        draftCellIds.includes(cell.id)
          ? { ...cell, density: Math.min(20, cell.density + bonus) }
          : cell,
      );
      countries.push(draftCountry);
      if (state.role === 'country' && !state.focusCountryId) {
        state = { ...state, focusCountryId: draftCountry.id };
      }
    }
    draftCountry = null;
    draftCellIds = [];
  }

  const logEntry =
    draftCountry === null && state.draftCountry && draftCellIds.length === 0
      ? `${state.draftCountry.name} завершило ход.`
      : `${card.title}: ход завершён.`;
  return {
    ...state,
    cells,
    countries,
    activeCard: null,
    draftCountry,
    draftCellIds,
    eventLog: [logEntry, ...state.eventLog].slice(0, 8),
    message: logEntry,
  };
}

function aiExpand(cells: WorldCell[], country: Country): { cells: WorldCell[]; count: number } {
  const borders = cells.filter(
    (cell) =>
      cell.land &&
      !cell.ownerId &&
      cellNeighbors(cells, cell).some((neighbor) => neighbor.ownerId === country.id),
  );
  if (borders.length === 0) return { cells, count: 0 };
  const seed = randomItem(borders);
  const before = cells.filter((cell) => cell.ownerId === country.id).length;
  const nextCells = growFromSeed(cells, seed, 2 + Math.floor(Math.random() * 3), country.id)
    .map((cell) =>
      cell.ownerId === country.id && cell.density === 0
        ? { ...cell, density: country.density }
        : cell,
    );
  const after = nextCells.filter((cell) => cell.ownerId === country.id).length;
  return { cells: nextCells, count: after - before };
}

function countryCard(state: GameState, country: Country): QueuedCard {
  const ownedCount = state.cells.filter((cell) => cell.ownerId === country.id).length;
  const options: CardType[] = ['expand', 'expand', 'drought', 'rain'];
  if (ownedCount >= 8) options.push('split', 'split');
  const type = randomItem(options);
  if (type !== 'split') {
    return { card: makeCard(type, country.id), draftCountry: null };
  }

  const split = makeCountry(
    { name: country.rank, ink: Math.max(4, Math.min(12, Math.floor(ownedCount / 2))) },
    country,
  );
  split.name = `${country.name} — ${randomName()}`;
  return {
    card: { ...makeCard('split', country.id), ink: split.ink },
    draftCountry: split,
  };
}

function worldCard(state: GameState): QueuedCard {
  const openLand = state.cells.filter((cell) => cell.land && !cell.ownerId).length;
  if (openLand >= 3 && state.countries.length < 12 && Math.random() < 0.28) {
    const rank = randomItem(RANKS);
    const country = makeCountry(rank);
    return {
      card: { ...makeCard('create'), ink: rank.ink },
      draftCountry: country,
    };
  }
  const type: CardType = Math.random() < 0.5 ? 'drought' : 'rain';
  return { card: makeCard(type), draftCountry: null };
}

function playerCardsForTurn(state: GameState): QueuedCard[] {
  if (state.role === 'observer') return [];
  if (state.role === 'country') {
    const focus = state.countries.find((country) => country.id === state.focusCountryId);
    return focus ? [countryCard(state, focus)] : [];
  }
  if (state.role === 'world') return [worldCard(state)];

  const cards = [worldCard(state)];
  for (const country of state.countries) {
    cards.push(countryCard(state, country));
  }
  return cards;
}

function applyClimate(
  cells: WorldCell[],
  targets: WorldCell[],
  type: 'drought' | 'rain',
  count: number,
): { cells: WorldCell[]; changed: number } {
  const candidates = [...targets];
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  let changed = 0;
  for (let i = 0; i < count && candidates.length > 0; i += 1) {
    const pickIndex = Math.floor(Math.random() * candidates.length);
    const target = candidates.splice(pickIndex, 1)[0];
    if (!target) continue;
    const current = cellsById.get(target.id);
    if (!current) continue;
    const humidity = Math.max(
      0,
      Math.min(100, current.humidity + (type === 'rain' ? 12 : -12)),
    );
    if (humidity === current.humidity) continue;
    cellsById.set(current.id, updateBiome({ ...current, humidity }));
    changed += 1;
  }
  return { cells: cells.map((cell) => cellsById.get(cell.id) ?? cell), changed };
}

function splitByAI(
  cells: WorldCell[],
  source: Country,
  ownedCells: WorldCell[],
): { cells: WorldCell[]; country: Country | null; count: number } {
  if (ownedCells.length < 8) return { cells, country: null, count: 0 };
  for (const seed of [...ownedCells].sort(() => Math.random() - 0.5)) {
    const group = [seed];
    const seen = new Set([seed.id]);
    let frontier = [seed];
    while (group.length < 3 && frontier.length > 0) {
      const next: WorldCell[] = [];
      for (const cell of frontier) {
        for (const neighbor of cellNeighbors(cells, cell)) {
          if (neighbor.ownerId === source.id && !seen.has(neighbor.id)) {
            seen.add(neighbor.id);
            group.push(neighbor);
            next.push(neighbor);
            if (group.length >= 3) break;
          }
        }
        if (group.length >= 3) break;
      }
      frontier = next;
    }
    if (group.length < 2 || group.length >= ownedCells.length) continue;
    const newCountry = makeCountry(
      { name: source.rank, ink: 6 },
      source,
    );
    newCountry.name = `${source.name} ${randomName()}`;
    const groupIds = new Set(group.map((cell) => cell.id));
    return {
      cells: cells.map((cell) =>
        groupIds.has(cell.id)
          ? { ...cell, ownerId: newCountry.id }
          : cell,
      ),
      country: newCountry,
      count: group.length,
    };
  }
  return { cells, country: null, count: 0 };
}

function resolveAICountryCard(
  cells: WorldCell[],
  countries: Country[],
  country: Country,
): { cells: WorldCell[]; countries: Country[]; log: string } {
  const owned = cells.filter((cell) => cell.ownerId === country.id);
  const roll = Math.random();
  if (owned.length >= 8 && roll < 0.15) {
    const split = splitByAI(cells, country, owned);
    if (split.country) {
      return {
        cells: split.cells,
        countries: [...countries, split.country],
        log: `${country.name} сыграло карту раскола: возникло ${split.country.name}.`,
      };
    }
  }
  if (roll < 0.68) {
    const expanded = aiExpand(cells, country);
    if (expanded.count > 0) {
      return {
        cells: expanded.cells,
        countries,
        log: `${country.name} сыграло карту расширения: +${expanded.count} обл.`,
      };
    }
  }
  const type: 'drought' | 'rain' = roll < 0.84 ? 'drought' : 'rain';
  const climate = applyClimate(cells, owned, type, Math.min(3, owned.length));
  return {
    cells: climate.cells,
    countries,
    log: `${country.name} сыграло карту «${type === 'drought' ? 'Засуха' : 'Ливни'}» (${climate.changed} обл.).`,
  };
}

function resolveAutonomousWorldCard(
  cells: WorldCell[],
  countries: Country[],
): { cells: WorldCell[]; countries: Country[]; log: string } {
  const openLand = cells.filter((cell) => cell.land && !cell.ownerId);
  if (openLand.length >= 3 && countries.length < 12 && Math.random() < 0.34) {
    const rank = randomItem(RANKS);
    const country = makeCountry(rank);
    const seed = randomItem(openLand);
    const expandedCells = growFromSeed(cells, seed, 2 + Math.floor(Math.random() * 3), country.id)
      .map((cell) =>
        cell.ownerId === country.id ? { ...cell, density: country.density } : cell,
      );
    return {
      cells: expandedCells,
      countries: [...countries, country],
      log: `Мировая карта основания: ${country.name} возникло как ${country.rank.toLowerCase()}.`,
    };
  }

  const type: 'drought' | 'rain' = Math.random() < 0.5 ? 'drought' : 'rain';
  const land = cells.filter((cell) => cell.land);
  const climate = applyClimate(cells, land, type, 5 + Math.floor(Math.random() * 6));
  return {
    cells: climate.cells,
    countries,
    log: `Мировая карта «${type === 'drought' ? 'Засуха' : 'Ливни'}»: затронуто областей — ${climate.changed}.`,
  };
}

export function normalizeSavedGame(state: GameState): GameState {
  const role: PlayerRole = ['all', 'country', 'world', 'observer'].includes(
    state.role as string,
  )
    ? state.role
    : 'country';
  const queuedCards = Array.isArray(state.queuedCards) ? state.queuedCards : [];
  let activeCard = state.activeCard;
  if (
    role === 'country' &&
    activeCard &&
    !activeCard.targetCountryId &&
    (activeCard.type === 'drought' || activeCard.type === 'rain') &&
    state.focusCountryId
  ) {
    activeCard = makeCard('expand', state.focusCountryId);
  }
  return { ...state, role, activeCard, queuedCards };
}

export function advanceTurn(current: GameState): GameState {
  const state = completeActiveCard(current);
  const queuedCards = state.queuedCards ?? [];
  if (queuedCards.length > 0) {
    const [nextCard, ...remaining] = queuedCards;
    if (nextCard) {
      return {
        ...state,
        activeCard: nextCard.card,
        draftCountry: nextCard.draftCountry,
        draftCellIds: [],
        queuedCards: remaining,
        secondsLeft: 60,
        paused: false,
        message: nextCard.card.detail,
      };
    }
  }

  let cells = [...state.cells];
  let countries = [...state.countries];
  const actions: string[] = [];

  if (state.role !== 'all' && state.role !== 'world') {
    const worldResult = resolveAutonomousWorldCard(cells, countries);
    cells = worldResult.cells;
    countries = worldResult.countries;
    actions.push(worldResult.log);
  }

  if (state.role !== 'all') {
    const activeCountries = [...countries];
    for (const country of activeCountries) {
      if (state.role === 'country' && country.id === state.focusCountryId) continue;
      const result = resolveAICountryCard(cells, countries, country);
      cells = result.cells;
      countries = result.countries;
      actions.push(result.log);
    }
  }

  const newTurn = state.turn + 1;
  const interim: GameState = {
    ...state,
    cells,
    countries,
    turn: newTurn,
    year: state.year + 1,
    secondsLeft: 60,
    paused: false,
    draftCellIds: [],
    activeCard: null,
    draftCountry: null,
    queuedCards: [],
  };
  const cards = playerCardsForTurn(interim);
  const [firstCard, ...remainingCards] = cards;
  const logLine = actions.length ? actions.join(' · ') : 'Год прошёл спокойно.';
  return {
    ...interim,
    activeCard: firstCard?.card ?? null,
    draftCountry: firstCard?.draftCountry ?? null,
    queuedCards: remainingCards,
    eventLog: [`${interim.year}: ${logLine}`, ...state.eventLog].slice(0, 8),
    message:
      firstCard?.card.detail ??
      (state.role === 'observer'
        ? logLine
        : 'Для этой страны больше нет доступных карт.'),
  };
}

export function tickTimer(state: GameState): GameState {
  if (state.paused) return state;
  if (state.secondsLeft <= 1) return advanceTurn(state);
  return { ...state, secondsLeft: state.secondsLeft - 1 };
}

export function togglePause(state: GameState): GameState {
  return { ...state, paused: !state.paused };
}

export function toggleBrushMode(state: GameState): GameState {
  const brushMode = state.brushMode === 'respect' ? 'density' : 'respect';
  return {
    ...state,
    brushMode,
    message:
      brushMode === 'density'
        ? 'Повторная окраска повышает плотность и расходует чернила.'
        : 'Повторная окраска не влияет на уже закрашенную территорию.',
  };
}

export function getCellColor(cell: WorldCell): string {
  const biomes = colors.light.biomePalette;
  if (cell.ownerId) return 'country';
  const paletteIndex =
    cell.biome === 'Тропики' ? 0 :
    cell.biome === 'Леса' ? 1 :
    cell.biome === 'Степи' ? 2 :
    cell.biome === 'Болота' ? 3 :
    cell.biome === 'Тайга' ? 4 :
    cell.biome === 'Тундра' ? 5 : 6;
  return biomes[paletteIndex];
}

export const MAP_ROWS = ROWS;
export const MAP_COLS = COLS;
