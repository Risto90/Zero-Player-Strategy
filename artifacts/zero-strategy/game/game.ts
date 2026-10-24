import { autoPaint } from './autoPaint';
import type { PaintActions } from './autoPaint';
import { brushOptionFor, CardPainter, finalizeSplitCities, PartitionBrush, validateSplitPartition, validateSplitTerritory,
  type BrushMode, type BrushOption, type Card, type CardChoice, type CardPainterState, type CharacterEvent } from './brush';
import { drawCountryCard, drawWorldCard, firstCreateCard } from './cards';
import { BIOMES, BRUSH_SIZES, MAX_COUNTRIES, type BrushSize, LOG_LIMIT, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, PALETTE, TURN_SECONDS } from './config';
import { forEachNeighbour, type MapKind } from './geography';
import { copyWorld, deserializeWorld, serializeSteps, type SavedWorld } from './persistence';
import { decodeSave, encodeSave } from './saveFile';
import { clearSaveBytes, hasSaveBytes, readSaveBytes, writeSaveBytes } from './storage';
import { fmt } from './format';
import { MapRenderer, type EntityLayer, type MapMode } from './render';
import { World, isActiveCountry, type City, type Country } from './world';
import { GOVERNMENTS, reservePersonId, type Person } from './government';
import { advancePeople, arePartners, birth, countryCharacters, ensureUniqueDynastySurnames, killPerson, marry, newCitizen, normalizePolitics, person, registerPerson } from './characters';
import { applyReform } from './politics';
import { appoint, candidateAllowed, ensureOffices, refreshHeirs, repairDeadOfficeHolders, successionOrder } from './succession';
import { randomItem } from './random';
import { demography } from './demography';
import {
  addCityAndConcentrate,
  applyCityWaning,
  canUpgradeCityRank,
  cityInfluenceRadius,
  cityRankName,
  concentrateCityPopulation,
  populationAtPixel,
} from './settlements';
import { availableNomadCitySites, dissolveCountryIntoNomadicCountries, settleNomadAsCountry } from './nomads';
import {
  chronicleReference,
  migrateChronicle,
  reindexChronicleObjects,
  type ChronicleEntry,
  type ChronicleReference,
} from './chronicle';

function polityChronicleReference(polity: Country): ChronicleReference {
  return chronicleReference('country', polity.id);
}

export type PlayerRole = 'all' | 'country' | 'world' | 'observer';
type Slot = { scope: 'world' } | { scope: 'country'; countryId: number };

export interface LegendRow {
  id: number;
  name: string;
  color: string;
  /** Population (countries, cultures, religions) or pixel count (biomes). */
  value: number;
  /** Share of the total, 0–100. */
  percent: number;
  detail: string;
}

export interface Legend {
  countries: LegendRow[];
  cultures: LegendRow[];
  religions: LegendRow[];
  /** People who follow no religion. */
  nonBelievers: LegendRow;
  biomes: LegendRow[];
  totalPopulation: number;
}

export interface CountryShare {
  id: number | null;
  name: string;
  color: string;
  population: number;
  percent: number;
}

export interface CountryComposition {
  population: number;
  cultures: CountryShare[];
  religions: CountryShare[];
}

export interface PixelInfo {
  x: number;
  y: number;
  land: boolean;
  country: Country | null;
  countryPopulation: number;
  biome: string | null;
  humidity: number;
  temperature: number;
  drainage: number;
  density: number;
  cultures: { id: number; name: string; color: string; share: number }[];
  religions: { id: number; name: string; color: string; share: number }[];
  nonBelievers: number;
  city: City | null;
  family: Person[];
}

export interface GameSnapshot {
  year: number;
  turn: number;
  role: PlayerRole;
  mapKind: MapKind;
  focusCountry: Country | null;
  selectedCountryId: number | null;
  card: Card | null;
  /** Country the active card belongs to, if any. */
  cardCountry: Country | null;
  queuedCards: number;
  canPaint: boolean;
  cityPlacementAvailable: boolean;
  brushMode: BrushMode;
  brushOption: BrushOption;
  brushSize: BrushSize;
  mapMode: MapMode;
  layer: EntityLayer | null;
  secondsLeft: number;
  paused: boolean;
  busy: boolean;
  /** The year's changes are still being drawn; the timer waits for them. */
  drawing: boolean;
  /** AI turn progress while the world moves, e.g. 3 of 12 countries done. */
  progress: { done: number; total: number } | null;
  /** Human-readable legacy shape used by the main game screen. */
  log: string[];
  /** Structured linked records for object profile pages. */
  chronicle: ChronicleEntry[];
  message: string;
  legend: Legend;
}

export type GameAction =
  | { type: 'selectChoice'; index: number }
  | { type: 'setBrushMode'; mode: BrushMode }
  | { type: 'setPainterMode'; mode: BrushMode }
  | { type: 'beginStroke'; x: number; y: number }
  | { type: 'strokeTo'; x: number; y: number }
  | { type: 'endStroke' }
  | { type: 'dab'; x: number; y: number; radius: number }
  | { type: 'line'; ax: number; ay: number; bx: number; by: number; radius: number }
  | { type: 'placeCity'; x: number; y: number }
  | { type: 'completeCard' };

interface SavedGame {
  version: 2;
  savedAt: number;
  role: PlayerRole;
  year: number;
  turn: number;
  focusCountryId: number | null;
  card: Card | null;
  painterState?: CardPainterState | null;
  queue: Slot[];
  brushMode: BrushMode;
  brushSize: BrushSize;
  mapMode: MapMode;
  log: Array<string | ChronicleEntry>;
  world: SavedWorld;
}

const OBSERVER_SECONDS = 3;
/** Work is cut into slices of about this many milliseconds, so the screen never freezes. */
const SLICE_MS = 12;

/** Save-file reads, writes and deletes run one at a time, in the order they were requested. */
let fileQueue: Promise<unknown> = Promise.resolve();
function onSaveFile<T>(op: () => Promise<T>): Promise<T> {
  const run = fileQueue.then(op, op);
  fileQueue = run.catch(() => undefined);
  return run;
}

/** Lets the UI breathe between slices of work. */
export const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class Game {
  readonly renderer: MapRenderer;
  private role: PlayerRole;
  private year = 1000;
  private turn = 1;
  private focusCountryId: number | null = null;
  private selectedCountryId: number | null = null;
  private card: Card | null = null;
  private painter: CardPainter | null = null;
  private pendingInheritanceSplit: {
    sourceCountryId: number;
    destinationIds: number[];
    quotas: number[];
    baselinePixels: number[];
  } | null = null;
  private queue: Slot[] = [];
  private brushMode: BrushMode = 'respect';
  private brushSize: BrushSize = 'm';
  private mapMode: MapMode = 'political';
  private layer: EntityLayer | null = null;
  private secondsLeft = TURN_SECONDS;
  private paused = false;
  private busy = false;
  /** True from the end of a turn until the map view has shown the new map. */
  private drawing = false;
  private progress: { done: number; total: number } | null = null;
  private saving: Promise<void> | null = null;
  private saveAgain = false;
  private disposed = false;
  /** Turned off by the test harness, which has no storage. */
  static persist = true;
  private static saveOwner: Game | null = null;
  /** How to wait between slices; the harness can swap in an immediate one. */
  static pause: () => Promise<void> = nextFrame;
  private log: ChronicleEntry[] = [];
  private message = '';
  private lastPoint: { x: number; y: number } | null = null;
  private legendCache: { version: number; legend: Legend } | null = null;
  private snapshot: GameSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly mapListeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    readonly world: World,
    role: PlayerRole,
    deferMapPreparation = false,
  ) {
    this.role = role;
    this.renderer = new MapRenderer(world, deferMapPreparation);
    // The newest game owns the save file; older (discarded) games may no longer write it.
    if (!deferMapPreparation) Game.saveOwner = this;
    if (!deferMapPreparation) this.redrawAll();
  }

  /** Repaints the whole map (e.g. for a newly opened map view); the timer waits until it is shown. */
  redrawAll(): void {
    this.renderer.markAll();
    this.drawing = true;
    this.emit(true);
  }

  static create(mapKind: MapKind, role: PlayerRole): Game {
    const game = new Game(World.create(mapKind), role);
    return Game.initializeNewGame(game, role);
  }

  static async createCooperative(
    mapKind: MapKind,
    role: PlayerRole,
    seed?: number,
    onProgress?: (stage: string) => void,
  ): Promise<Game> {
    const world = await World.createCooperative(mapKind, seed, onProgress);
    const game = new Game(world, role, true);
    await game.renderer.prepareCooperative();
    game.redrawAll();
    onProgress?.('Создаём первую карточку');
    const initialized = Game.initializeNewGame(game, role);
    Game.saveOwner = game;
    return initialized;
  }

  private static initializeNewGame(game: Game, role: PlayerRole): Game {
    game.addLog('Мир создан.');
    const first = firstCreateCard(game.world, game.year);
    if (!first) {
      game.message = 'На карте нет свободной суши.';
      return game;
    }
    if (role === 'observer') {
      game.resolveAutomatically(first);
      game.secondsLeft = OBSERVER_SECONDS;
      game.message = game.log[0] ? `${game.log[0].year}: ${game.log[0].text}` : '';
    } else {
      if (role === 'country') game.focusCountryId = first.newCountryId;
      game.startCard(first);
    }
    game.scheduleSave();
    return game;
  }

  static async load(): Promise<Game | null> {
    const bytes = await onSaveFile(readSaveBytes);
    const saved = bytes ? decodeSave<SavedGame>(bytes) : null;
    if (!saved || saved.version !== 2) return null;
    const loadedWorld = deserializeWorld(saved.world);
    for (const country of loadedWorld.countries) {
      if (!country.pixels) continue;
      const cities = loadedWorld.cities.filter((city) => city.countryId === country.id);
      if (!cities.length) {
        let capitalPixel = -1, population = -1;
        loadedWorld.forEachCountryPixel(country, (p) => {
          if (loadedWorld.density[p] > population) {
            population = loadedWorld.density[p];
            capitalPixel = p;
          }
        });
        if (capitalPixel >= 0) loadedWorld.addCity(country.id, capitalPixel, 1, true);
      } else {
        const existingCapital = cities.find((city) => city.capital);
        if (existingCapital) {
          for (const city of cities) city.capital = city.id === existingCapital.id;
        } else {
          cities.sort((a, b) => b.rank - a.rank || b.population - a.population);
          cities[0].capital = true;
        }
      }
    }
    const game = new Game(loadedWorld, saved.role);
    game.year = saved.year;
    normalizePolitics(game.world, saved.year);
    for (const choice of saved.card?.choices ?? []) {
      if (choice.ruler) reservePersonId(choice.ruler.id);
      if (choice.person) reservePersonId(choice.person.id);
    }
    if (saved.card?.newRuler) reservePersonId(saved.card.newRuler.id);
    if (saved.card?.characterEvent?.newPerson) reservePersonId(saved.card.characterEvent.newPerson.id);
    refreshHeirs(game.world, saved.year);
    for (const country of [...game.world.countries]) {
      if (!game.world.countries.includes(country)) continue;
      repairDeadOfficeHolders(game.world, country, saved.year,
        (leader, seatId) => game.appointAndAnnex(country, leader, saved.year, seatId));
      ensureOffices(game.world, country, saved.year);
    }
    refreshHeirs(game.world, saved.year);
    game.turn = saved.turn;
    game.focusCountryId = saved.focusCountryId;
    const legacyNomadIds = new Map<number, number>();
    for (const legacy of saved.world.nomads ?? []) legacyNomadIds.set(legacy.id, saved.world.countries.length + legacy.id);
    game.queue = (saved.queue as (Slot | { scope: 'nomad'; nomadId: number })[]).flatMap((slot) => {
      if (slot.scope !== 'nomad') return [slot];
      const countryId = legacyNomadIds.get(slot.nomadId);
      return countryId === undefined ? [] : [{ scope: 'country', countryId }];
    });
    game.brushMode = saved.brushMode;
    game.brushSize = saved.brushSize;
    game.log = migrateChronicle(saved.log, legacyNomadIds);
    if (saved.card) {
      const card = { ...saved.card };
      const legacyNomadId = (saved.card as Card & { targetNomadId?: number | null }).targetNomadId;
      if (legacyNomadId != null) {
        card.targetCountryId = legacyNomadIds.get(legacyNomadId) ?? null;
        delete (card as Card & { targetNomadId?: number | null }).targetNomadId;
      }
      game.startCard(card, saved.painterState);
    }
    game.mapMode = saved.mapMode;
    game.renderer.setView(game.mapMode, null, game.mapMode === 'colonization' ? game.painter?.colonizationMask ?? null : null);
    return game;
  }

  static async hasSave(): Promise<boolean> {
    try {
      return await onSaveFile(hasSaveBytes);
    } catch {
      return false;
    }
  }

  static async deleteSave(): Promise<void> {
    await onSaveFile(clearSaveBytes);
  }

  // ---------- subscriptions ----------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called whenever map pixels need repainting (read `renderer.flush()`). */
  onMapChange(listener: () => void): () => void {
    this.mapListeners.add(listener);
    return () => this.mapListeners.delete(listener);
  }

  getSnapshot = (): GameSnapshot => {
    if (!this.snapshot) this.snapshot = this.buildSnapshot();
    return this.snapshot;
  };

  private emit(mapChanged = false): void {
    this.snapshot = null;
    this.listeners.forEach((listener) => listener());
    if (mapChanged) this.mapListeners.forEach((listener) => listener());
  }

  /** The map view calls this when every changed tile is on screen. */
  mapDrawn(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.emit();
  }

  // ---------- timer ----------

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (this.paused || this.busy || this.drawing) return;
    this.secondsLeft -= 1;
    if (this.secondsLeft <= 0) void this.nextTurn();
    else this.emit();
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.emit();
  }

  // ---------- brush ----------

  /** The single command boundary used by both UI input and automatic strategy. */
  dispatchAction(action: GameAction): boolean | number | void {
    switch (action.type) {
      case 'selectChoice': return this.applyChoice(action.index);
      case 'setBrushMode':
        this.brushMode = action.mode;
        if (this.painter) this.painter.mode = action.mode;
        this.emit();
        return;
      case 'setPainterMode':
        if (this.painter) this.painter.mode = action.mode;
        return;
      case 'beginStroke': return this.applyBeginStroke(action.x, action.y);
      case 'strokeTo': return this.applyStrokeTo(action.x, action.y);
      case 'endStroke': return this.applyEndStroke();
      case 'dab': return this.applyDab(action.x, action.y, action.radius);
      case 'line': return this.applyLine(action.ax, action.ay, action.bx, action.by, action.radius);
      case 'placeCity': return this.applyCityPlacement(action.x, action.y);
      case 'completeCard': return this.applyCardCompletion();
    }
  }

  get brushRadius(): number {
    return BRUSH_SIZES.find((size) => size.id === this.brushSize)?.radius ?? 11;
  }

  setBrushSize(size: BrushSize): void {
    this.brushSize = size;
    this.emit();
  }

  selectChoice(index: number): void {
    this.dispatchAction({ type: 'selectChoice', index });
  }

  private applyChoice(index: number): void {
    if (!this.card?.choices || index < 0 || index >= this.card.choices.length) return;
    this.card.selectedChoice = index;
    this.message = this.card.choices[index].detail;
    this.emit();
    this.scheduleSave();
  }

  selectCityAt(x: number, y: number): boolean {
    return this.dispatchAction({ type: 'placeCity', x, y }) === true;
  }

  private applyCityPlacement(x: number, y: number): boolean {
    const card = this.card;
    if (!card || !this.canPlaceCity()) return false;
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= MAP_WIDTH || py >= MAP_HEIGHT) return false;
    const pixel = py * MAP_WIDTH + px;
    const targetCountry = card.type === 'buildCity' && card.targetCountryId !== null
      ? this.world.countries[card.targetCountryId] : null;
    if (targetCountry?.type === 'nomadic') {
      if (!availableNomadCitySites(this.world, targetCountry).includes(pixel)) {
        this.message = 'Кочевье может основать город только на свободной суше в пределах своего ареала.';
        this.emit();
        return false;
      }
      const country = settleNomadAsCountry(this.world, targetCountry, pixel, this.year);
      if (!country) {
        this.message = 'Не удалось основать город и расселить кочевье.';
        this.emit();
        return false;
      }
      ensureOffices(this.world, country, this.year);
      refreshHeirs(this.world, this.year);
      card.newCountryId = country.id;
      card.cityPlaced = true;
      this.message = `${country.name} основано; кочевая страна стала оседлой.`;
      this.mapMode = 'political';
      this.layer = null;
      this.renderer.setView('political', null);
      this.renderer.markAll();
      this.emit();
      this.scheduleSave();
      return true;
    }
    const countryId = card.type === 'buildCity' ? card.targetCountryId : card.newCountryId;
    const country = countryId === null ? null : this.world.countries[countryId];
    if (!country || this.world.owner[pixel] !== country.id + 1 || !this.world.land[pixel]) {
      this.message = 'Город можно разместить только на незанятой точке суши своей страны.';
      this.emit();
      return false;
    }
    if (this.world.cityAt(pixel)) {
      this.message = 'На этой точке уже есть город.';
      this.emit();
      return false;
    }
    const city = addCityAndConcentrate(this.world, country.id, pixel, card.type === 'create');
    if (!city) {
      this.message = 'Не удалось создать город в этой точке.';
      this.emit();
      return false;
    }
    card.cityPlaced = true;
    this.message = `${cityRankName(city.rank)} создан. Население собрано из зоны влияния.`;
    this.markCityArea(city);
    this.emit();
    this.scheduleSave();
    return true;
  }

  private canPlaceCity(): boolean {
    const card = this.card;
    if (!card || !['create', 'buildCity'].includes(card.type)) return false;
    if (card.type === 'buildCity' && card.targetCountryId !== null &&
      this.world.countries[card.targetCountryId]?.type === 'nomadic') {
      const country = this.world.countries[card.targetCountryId];
      return isActiveCountry(country) && !card.cityPlaced && availableNomadCitySites(this.world, country).length > 0;
    }
    const countryId = card.type === 'buildCity' ? card.targetCountryId : card.newCountryId;
    const country = countryId === null ? null : this.world.countries[countryId];
    if (!country || !isActiveCountry(country) || card.cityPlaced || !this.hasOpenCitySite(country)) return false;
    return card.type === 'buildCity' || !this.world.cities.some((city) => city.countryId === country.id);
  }

  private hasOpenCitySite(country: Country): boolean {
    if (country.type === 'nomadic') return availableNomadCitySites(this.world, country).length > 0;
    let available = false;
    this.world.forEachCountryPixel(country, (pixel) => {
      if (!this.world.cityAt(pixel)) available = true;
    });
    return available;
  }

  private markCityArea(city: City): void {
    const radius = cityInfluenceRadius(this.world, city);
    const x = city.pixel % MAP_WIDTH, y = Math.floor(city.pixel / MAP_WIDTH);
    this.renderer.mark({
      x0: Math.max(0, Math.floor(x - radius)),
      y0: Math.max(0, Math.floor(y - radius)),
      x1: Math.min(MAP_WIDTH - 1, Math.ceil(x + radius)),
      y1: Math.min(MAP_HEIGHT - 1, Math.ceil(y + radius)),
    });
  }

  toggleBrushMode(): void {
    this.dispatchAction({ type: 'setBrushMode', mode: this.brushMode === 'respect' ? 'repeat' : 'respect' });
  }

  beginStroke(x: number, y: number): void {
    this.dispatchAction({ type: 'beginStroke', x, y });
  }

  private applyBeginStroke(x: number, y: number): void {
    if (!this.painter) return;
    if (this.card?.type === 'warmWind' || this.card?.type === 'coldWind') {
      const px = Math.floor(x), py = Math.floor(y);
      const countryId = this.card.targetCountryId;
      if (px < 0 || py < 0 || px >= MAP_WIDTH || py >= MAP_HEIGHT ||
        countryId === null || this.world.owner[py * MAP_WIDTH + px] !== countryId + 1) {
        this.message = 'Начните мазок на суше своей страны.';
        this.emit();
        return;
      }
    }
    this.painter.message = '';
    this.lastPoint = { x, y };
    this.dispatchAction({ type: 'dab', x, y, radius: this.brushRadius });
    this.afterPaint();
  }

  strokeTo(x: number, y: number): void {
    this.dispatchAction({ type: 'strokeTo', x, y });
  }

  private applyStrokeTo(x: number, y: number): void {
    if (!this.painter || !this.lastPoint) return;
    this.dispatchAction({
      type: 'line',
      ax: this.lastPoint.x,
      ay: this.lastPoint.y,
      bx: x,
      by: y,
      radius: this.brushRadius,
    });
    this.lastPoint = { x, y };
    this.afterPaint();
  }

  endStroke(): void {
    this.dispatchAction({ type: 'endStroke' });
  }

  private applyEndStroke(): void {
    if (!this.painter) return;
    if ((this.card?.type === 'warmWind' || this.card?.type === 'coldWind') && this.lastPoint) {
      const px = Math.floor(this.lastPoint.x), py = Math.floor(this.lastPoint.y);
      const countryId = this.card.targetCountryId;
      if (px < 0 || py < 0 || px >= MAP_WIDTH || py >= MAP_HEIGHT ||
        countryId === null || this.world.owner[py * MAP_WIDTH + px] !== countryId + 1) {
        this.painter.cancelStroke();
        this.lastPoint = null;
        this.afterPaint();
        this.scheduleSave();
        return;
      }
    }
    this.painter.endStroke();
    this.lastPoint = null;
    this.message = this.painter.message || this.message;
    this.emit();
    this.scheduleSave();
  }

  private applyDab(x: number, y: number, radius: number): number {
    if (!this.painter) return 0;
    return this.painter.dab(x, y, radius);
  }

  private applyLine(ax: number, ay: number, bx: number, by: number, radius: number): number {
    if (!this.painter) return 0;
    return this.painter.line(ax, ay, bx, by, radius);
  }

  private afterPaint(): void {
    const painter = this.painter;
    if (!painter) return;
    if (painter.dirty) {
      this.renderer.mark(painter.dirty);
      painter.dirty = null;
    }
    for (const rect of painter.extraDirty) this.renderer.mark(rect);
    painter.extraDirty.length = 0;
    painter.clearExtraDirtyTiles();
    if (painter.message) this.message = painter.message;
    this.emit(true);
  }

  // ---------- map view ----------

  setMapMode(mode: MapMode): void {
    this.mapMode = mode;
    this.layer = null;
    if (this.painter?.card.type === 'nomadExpand') {
      this.painter.setNomadMode(mode === 'nomads' ? 'range' : mode === 'density' ? 'density' : 'inactive');
    }
    this.renderer.setView(mode, null, mode === 'colonization' ? this.painter?.colonizationMask ?? null : null);
    this.emit(true);
  }

  /** Shows a single culture or religion layer: its share at every point. */
  showLayer(layer: EntityLayer | null): void {
    if (layer) this.mapMode = layer.kind === 'culture' ? 'cultures' : 'religions';
    this.layer = layer;
    this.renderer.setView(this.mapMode, layer, this.mapMode === 'colonization' ? this.painter?.colonizationMask ?? null : null);
    this.emit(true);
  }

  selectCountry(countryId: number | null): void {
    if (countryId !== null && (!this.world.countries[countryId] || this.world.countries[countryId].pixels <= 0)) return;
    if (this.selectedCountryId === countryId) return;
    this.selectedCountryId = countryId;
    this.renderer.setSelectedCountry(countryId);
    this.emit(true);
  }

  showCountryOnMap(countryId: number): void {
    if (!this.world.countries[countryId] || this.world.countries[countryId].pixels <= 0) return;
    this.setMapMode('political');
    this.selectCountry(countryId);
  }

  countryComposition(countryId: number): CountryComposition {
    const country = this.world.countries[countryId];
    if (!country) return { population: 0, cultures: [], religions: [] };
    const data = demography(this.world, country);
    const percent = (value: number) => data.population > 0 ? Math.round(value / data.population * 1000) / 10 : 0;
    return {
      population: Math.round(data.population),
      cultures: [...data.cultures.entries()]
        .filter(([, population]) => population > 0)
        .map(([id, population]) => ({
          id, name: this.world.cultures[id]?.name ?? 'Неизвестная культура',
          color: this.world.cultures[id]?.color ?? PALETTE.unclaimedLand,
          population: Math.round(population), percent: percent(population),
        }))
        .sort((a, b) => b.population - a.population),
      religions: [...data.religions.entries()]
        .filter(([, population]) => population > 0)
        .map(([id, population]) => ({
          id, name: id === null ? 'Атеисты' : this.world.religions[id]?.name ?? 'Неизвестная вера',
          color: id === null ? PALETTE.noFaith : this.world.religions[id]?.color ?? PALETTE.noFaith,
          population: Math.round(population), percent: percent(population),
        }))
        .sort((a, b) => b.population - a.population),
    };
  }

  inspect(x: number, y: number): PixelInfo | null {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= MAP_WIDTH || py >= MAP_HEIGHT) return null;
    const w = this.world;
    const p = py * MAP_WIDTH + px;
    const land = w.land[p] === 1;
    const owner = w.owner[p];
    const cultureEntry = w.cultureTable.entries[w.culture[p]];
    const religionEntry = w.religionTable.entries[w.religion[p]];
    const country = owner > 0 ? w.countries[owner - 1] : null;
    const countryPopulation = country ? this.legend().countries.find((row) => row.id === country.id)?.value ?? 0 : 0;
    return {
      x: px,
      y: py,
      land,
      country,
      countryPopulation,
      biome: land ? BIOMES[w.biomeAt(p)].name : null,
      humidity: w.humidity[p],
      temperature: w.temperature[p],
      drainage: w.drainage[p],
      density: owner > 0 ? w.density[p] : 0,
      cultures: owner > 0 ? cultureEntry.ids.map((id, i) => ({ id, name: w.cultures[id].name, color: w.cultures[id].color, share: cultureEntry.shares[i] })) : [],
      religions: owner > 0 ? religionEntry.ids.map((id, i) => ({ id, name: w.religions[id].name, color: w.religions[id].color, share: religionEntry.shares[i] })) : [],
      nonBelievers: owner > 0 ? 100 - religionEntry.total : 0,
      city: w.cityAt(p),
      family: country ? w.people.filter((p) => p.countryId === country.id &&
        (p.familyId === country.ruler.familyId || country.coRulerIds.includes(p.id)))
        .sort((a, b) => Number(b.alive) - Number(a.alive) || b.age - a.age).slice(0, 24) : [],
    };
  }

  /** All living named people in the country; ruling-dynasty membership is shown separately. */
  importantPeople(countryId: number): Person[] {
    const country = this.world.countries[countryId];
    if (!country) return [];
    return countryCharacters(this.world, country);
  }

  // ---------- turns ----------

  /** Ends the player's card and plays the rest of the year in slices, showing progress. */
  async nextTurn(): Promise<void> {
    if (this.busy) return;
    if (this.card && this.needsCityPlacement()) {
      this.message = 'Сначала выберите на карте точку для города.';
      this.emit();
      return;
    }
    if (this.card?.type === 'split' && this.card.targetCountryId !== null && this.card.newCountryId !== null) {
      const batch = this.card.splitBatch;
      const result = batch && batch.nextIndex === batch.destinationIds.length - 1
        ? validateSplitPartition(this.world, batch.sourceCountryId, batch.destinationIds, batch.quotas, batch.baselinePixels)
        : validateSplitTerritory(this.world, this.card.targetCountryId, this.card.newCountryId,
          this.card.splitRequiredPixels, this.card.splitBaselinePixels);
      if (!result.valid) {
        this.message = result.reason;
        this.emit();
        return;
      }
    }
    const completedCard = this.card;
    if (completedCard?.type === 'split' && completedCard.splitBatch &&
      completedCard.splitBatch.nextIndex < completedCard.splitBatch.destinationIds.length - 1) {
      const batch = completedCard.splitBatch;
      this.busy = true;
      try {
        this.completeCard();
        this.startInheritanceSplitCard(batch, batch.nextIndex + 1);
        return;
      } finally {
        this.busy = false;
        this.drawing = this.renderer.pending;
        this.emit(true);
        this.scheduleSave();
      }
    }
    this.busy = true;
    try {
      this.completeCard();
      if (this.pendingInheritanceSplit) {
        const batch = this.pendingInheritanceSplit;
        this.pendingInheritanceSplit = null;
        this.startInheritanceSplitCard({ ...batch, nextIndex: 0 }, 0);
        return;
      }
      if (this.queue.length > 0 && this.startNextPlayerCard()) return;
      this.turn += 1;
      this.year += 1;
      advancePeople(this.world, this.year);
      refreshHeirs(this.world, this.year);
      const jobs: (() => void)[] = [];
      if (this.role === 'country' || this.role === 'observer') {
        jobs.push(() => {
          const card = drawWorldCard(this.world, this.year);
          if (card) this.resolveAutomatically(card);
        });
      }
      if (this.role !== 'all') {
        const ids = this.world.countries.filter(isActiveCountry).map((c) => c.id);
        for (const id of ids) {
          if (this.role === 'country' && id === this.focusCountryId) continue;
          jobs.push(() => {
            const country = this.world.countries[id];
            if (!country || !isActiveCountry(country)) return;
            const card = drawCountryCard(this.world, country, this.year);
            if (card) this.resolveAutomatically(card);
          });
        }
      }
      this.progress = { done: 0, total: jobs.length };
      this.emit();
      let sliceStart = Date.now();
      for (let i = 0; i < jobs.length; i += 1) {
        if (this.disposed) return;
        jobs[i]();
        if (Date.now() - sliceStart >= SLICE_MS || i === jobs.length - 1) {
          this.progress = { done: i + 1, total: jobs.length };
          this.emit();
          await Game.pause();
          sliceStart = Date.now();
        }
      }
      this.queue = this.playerSlots();
      this.startNextPlayerCard();
    } finally {
      this.busy = false;
      this.progress = null;
      this.drawing = this.renderer.pending;
      this.emit(true);
      this.scheduleSave();
    }
  }

  private needsCityPlacement(): boolean {
    if (!this.card || !['create', 'buildCity'].includes(this.card.type)) return false;
    const countryId = this.card.type === 'buildCity' ? this.card.targetCountryId : this.card.newCountryId;
    const country = countryId === null ? null : this.world.countries[countryId];
    if (!country || !isActiveCountry(country) || this.card.cityPlaced) return false;
    if (this.card.type === 'create') return !this.world.cities.some((city) => city.countryId === country.id);
    return this.hasOpenCitySite(country);
  }

  private playerSlots(): Slot[] {
    if (this.role === 'observer') return [];
    if (this.role === 'country') return this.focusCountryId !== null && isActiveCountry(this.world.countries[this.focusCountryId]) ? [{ scope: 'country', countryId: this.focusCountryId }] : [];
    if (this.role === 'world') return [{ scope: 'world' }];
    return [
      { scope: 'world' },
      ...this.world.countries.filter(isActiveCountry).map((c): Slot => ({ scope: 'country', countryId: c.id })),
    ];
  }

  private startNextPlayerCard(): boolean {
    while (this.queue.length > 0) {
      const slot = this.queue.shift() as Slot;
      let card: Card | null = null;
      if (slot.scope === 'world') card = drawWorldCard(this.world, this.year);
      else if (slot.scope === 'country') {
        const country = this.world.countries[slot.countryId];
        if (country && isActiveCountry(country)) card = drawCountryCard(this.world, country, this.year);
      }
      if (card) {
        this.startCard(card);
        return true;
      }
    }
    this.card = null;
    this.painter = null;
    this.secondsLeft = this.role === 'observer' ? OBSERVER_SECONDS : TURN_SECONDS;
    this.message = this.role === 'observer'
      ? (this.log[0] ? `${this.log[0].year}: ${this.log[0].text}` : 'Мир развивается сам.')
      : 'В этом году нет применимых карт.';
    return false;
  }

  private startCard(card: Card, painterState?: CardPainterState | null): void {
    this.card = card;
    if (card.developmentOnly) this.brushMode = 'repeat';
    this.painter = new CardPainter(this.world, card, this.brushMode, painterState);
    this.secondsLeft = TURN_SECONDS;
    this.paused = false;
    this.message = card.detail;
    const mode: MapMode =
      card.type === 'drought' || card.type === 'rain' ? 'humidity'
        : card.type === 'desertification' || card.type === 'swamping' ? 'drainage'
          : ['warmCurrent', 'coldCurrent', 'warmWind', 'coldWind'].includes(card.type) ? 'temperature'
        : card.type === 'faith' ? 'religions' : card.type === 'culture' ? 'cultures'
          : card.type === 'colonization' ? 'colonization'
          : card.type === 'buildCity' && card.targetCountryId !== null && this.world.countries[card.targetCountryId]?.type === 'nomadic' ? 'nomads'
          : card.type === 'nomadExpand' ? (card.nomadDensityOnly ? 'density' : 'nomads') : 'political';
    this.mapMode = mode;
    this.layer = null;
    this.renderer.setView(mode, null, mode === 'colonization' ? this.painter.colonizationMask : null);
    if (card.type === 'nomadExpand') this.painter.setNomadMode(card.nomadDensityOnly ? 'density' : 'range');
  }

  private isPlayerControlled(countryId: number): boolean {
    return this.role === 'all' || (this.role === 'country' && this.focusCountryId === countryId);
  }

  private startInheritanceSplitCard(
    batch: NonNullable<Card['splitBatch']>,
    index: number,
  ): void {
    const source = this.world.countries[batch.sourceCountryId];
    const destination = this.world.countries[batch.destinationIds[index]];
    if (!source || !destination) {
      this.message = 'Не удалось продолжить разделение наследства: страна больше не найдена.';
      this.emit();
      return;
    }
    let hint = -1, bestScore = -1;
    this.world.forEachCountryPixel(source, (pixel) => {
      if (this.world.owner[pixel] !== source.id + 1 || this.world.cityAt(pixel)?.capital) return;
      const culture = this.world.cultureTable.shareOf(this.world.culture[pixel], destination.ruler.cultureId) > 0;
      const faith = destination.ruler.religionId === null
        ? this.world.religionTable.entries[this.world.religion[pixel]].total < 100
        : this.world.religionTable.shareOf(this.world.religion[pixel], destination.ruler.religionId) > 0;
      const score = (this.world.cityAt(pixel) ? 8 : 0) + (culture && faith ? 4 : culture || faith ? 2 : 0);
      if (score > bestScore) { hint = pixel; bestScore = score; }
    });
    const quota = batch.quotas[index];
    const card: Card = {
      type: 'split',
      title: 'Разделение наследства',
      detail: `Наследник ${destination.ruler.name}: выделите кистью связную территорию с городом (${index + 1} из ${batch.destinationIds.length}), не включая столицу исходной страны. Квота: ${quota} участков.`,
      ink: quota,
      inkTotal: quota,
      targetCountryId: source.id,
      newCountryId: destination.id,
      newCultureId: null,
      newReligionId: null,
      sourceCultureId: null,
      newGovernmentId: null,
      newRuler: null,
      choices: null,
      selectedChoice: 0,
      characterEvent: null,
      splitRequiredPixels: quota,
      splitBatch: {
        ...batch,
        destinationIds: [...batch.destinationIds],
        quotas: [...batch.quotas],
        baselinePixels: [...batch.baselinePixels],
        nextIndex: index,
      },
      splitBaselinePixels: batch.baselinePixels[index] ?? 0,
      hint,
    };
    this.startCard(card);
  }

  private resolveAutomatically(card: Card): void {
    this.card = card;
    if (card.choices && card.choices.length > 1) {
      this.dispatchAction({ type: 'selectChoice', index: Math.floor(Math.random() * card.choices.length) });
    }
    this.startCard(card);
    const territorial = card.type === 'create' || card.type === 'expand' || card.type === 'split' || card.type === 'colonization' || card.type === 'nomadExpand';
    const painter = this.painter;
    if (!painter) return;
    this.dispatchAction({
      type: 'setPainterMode',
      mode: card.developmentOnly || (!territorial && Math.random() < 0.3) ? 'repeat' : 'respect',
    });
    const actions: PaintActions = {
      beginStroke: (x, y) => this.dispatchAction({ type: 'beginStroke', x, y }),
      dab: (x, y, radius) => this.dispatchAction({ type: 'dab', x, y, radius }) as number,
      line: (ax, ay, bx, by, radius) => this.dispatchAction({ type: 'line', ax, ay, bx, by, radius }) as number,
      endStroke: () => this.dispatchAction({ type: 'endStroke' }),
    };
    autoPaint(painter, actions);
    this.afterPaint();
    const targetCountry = card.type === 'buildCity' && card.targetCountryId !== null
      ? this.world.countries[card.targetCountryId] : null;
    if (targetCountry?.type === 'nomadic') {
      const pixel = availableNomadCitySites(this.world, targetCountry)[0];
      if (pixel !== undefined) this.dispatchAction({ type: 'placeCity', x: pixel % MAP_WIDTH, y: Math.floor(pixel / MAP_WIDTH) });
    } else if (card.type === 'create' || card.type === 'buildCity') {
      const countryId = card.type === 'create' ? card.newCountryId : card.targetCountryId;
      const country = countryId === null ? null : this.world.countries[countryId];
      const hasCity = country ? this.world.cities.some((city) => city.countryId === country.id) : false;
      const shouldPlace = card.type === 'create' ? !hasCity : !card.cityPlaced;
      if (country && country.type === 'settled' && country.pixels > 0 && shouldPlace) {
        let best = -1;
        let bestDensity = -1;
        this.world.forEachCountryPixel(country, (p) => {
          if (this.world.cityAt(p) || this.world.density[p] <= bestDensity) return;
          best = p; bestDensity = this.world.density[p];
        });
        if (best >= 0) {
          this.dispatchAction({ type: 'placeCity', x: best % MAP_WIDTH, y: Math.floor(best / MAP_WIDTH) });
        }
      }
    }
    this.dispatchAction({ type: 'completeCard' });
  }

  private completeCard(): void {
    this.dispatchAction({ type: 'completeCard' });
  }

  private applyCardCompletion(): void {
    if (!this.painter) return;
    if (this.card?.type === 'split' && this.card.targetCountryId !== null && this.card.newCountryId !== null) {
      const batch = this.card.splitBatch;
      const result = batch && batch.nextIndex === batch.destinationIds.length - 1
        ? validateSplitPartition(this.world, batch.sourceCountryId, batch.destinationIds, batch.quotas, batch.baselinePixels)
        : validateSplitTerritory(this.world, this.card.targetCountryId, this.card.newCountryId,
          this.card.splitRequiredPixels, this.card.splitBaselinePixels);
      if (!result.valid) {
        this.message = result.reason;
        this.emit();
        return;
      }
    }
    this.afterPaint();
    this.finish(this.painter);
    this.painter = null;
    this.card = null;
    if (this.mapMode === 'colonization') {
      this.mapMode = 'political';
      this.layer = null;
      this.renderer.setView('political', null);
    }
  }

  /** Writes the outcome to the log and drops entities the card created but never used. */
  private finish(painter: CardPainter): void {
    const card = painter.card;
    const w = this.world;
    const used = card.inkTotal - card.ink;
    const colonizedPixels = card.type === 'colonization' ? painter.changed.length : 0;
    const colonistsMoved = painter.colonistsMoved;
    const changedCountryIds = [...new Set(painter.changed
      .map((pixel) => w.owner[pixel] - 1)
      .filter((countryId) => countryId >= 0))];
    painter.dispose();
    const target = card.targetCountryId !== null ? w.countries[card.targetCountryId] : null;
    switch (card.type) {
      case 'create': {
        const country = w.countries[card.newCountryId as number];
        if (country.pixels === 0) {
          w.discardLast('countries', country.id);
          w.discardLast('cultures', card.newCultureId as number);
        } else {
          const culture = w.cultures[card.newCultureId as number];
          const faith = country.religionId !== null ? `, вера «${w.religions[country.religionId].name}»` : '';
          this.addLog(`Основано: ${country.rank} ${country.name} (народ «${culture.name}»${faith}).`, [
            chronicleReference('country', country.id),
            chronicleReference('culture', culture.id),
            ...(country.religionId === null ? [] : [chronicleReference('religion', country.religionId)]),
          ]);
        }
        break;
      }
      case 'buildCity': {
        if (target && card.cityPlaced) {
          const city = w.cities[w.cities.length - 1];
          this.addLog(`${target.name}: основан городок.`, [
            chronicleReference('country', target.id),
            ...(city ? [chronicleReference('city', city.id)] : []),
          ]);
        }
        else if (card.cityPlaced && card.newCountryId !== null) {
          const founded = w.countries[card.newCountryId];
          if (founded) {
            const city = w.cities.filter((item) => item.countryId === founded.id).at(-1);
            this.addLog(`${founded.name}: кочевье осело; основаны государство и городок.`, [
              chronicleReference('country', founded.id),
              ...(city ? [chronicleReference('city', city.id)] : []),
              chronicleReference('culture', founded.cultureId),
              ...(founded.religionId === null ? [] : [chronicleReference('religion', founded.religionId)]),
            ]);
          }
        }
        break;
      }
      case 'upgradeCity': {
        const cityId = card.choices?.[card.selectedChoice]?.cityId;
        const city = cityId === undefined ? null : w.cities[cityId];
        if (city && target && city.countryId === target.id && canUpgradeCityRank(w, target.id, city.rank)) {
          city.rank = (city.rank + 1) as City['rank'];
          concentrateCityPopulation(w, city);
          this.markCityArea(city);
          this.addLog(`${target.name}: город повышен до ранга «${cityRankName(city.rank)}».`, [
            chronicleReference('country', target.id), chronicleReference('city', city.id),
          ]);
        }
        break;
      }
      case 'waneCity': {
        const cityId = card.choices?.[card.selectedChoice]?.cityId;
        const city = cityId === undefined ? null : w.cities[cityId];
        const countryCities = target ? w.cities.filter((item) => item.countryId === target.id) : [];
        const isAllowedTarget = !!city && !!target && city.countryId === target.id &&
          (countryCities.length <= 2 || !city.capital);
        const result = isAllowedTarget && city ? applyCityWaning(w, city) : null;
        if (result && target && city) {
          this.renderer.markAll();
          if (result.removed) this.log = reindexChronicleObjects(this.log, 'city', city.id);
          this.addLog(result.removed
            ? `${target.name}: городок ${city.name ?? 'без названия'} удалён; половина жителей расселена.`
            : `${target.name}: ${city.name ?? 'город'} увял; расселено ${fmt(Math.round(result.transferredPopulation))} жителей.`,
          [chronicleReference('country', target.id), ...(result.removed ? [] : [chronicleReference('city', city.id)])]);
        }
        break;
      }
      case 'moveCapital': {
        const cityId = card.choices?.[card.selectedChoice]?.cityId;
        const city = cityId === undefined ? null : w.cities[cityId];
        if (city && target && city.countryId === target.id && !city.capital) {
          const oldCapital = w.cities.find((item) => item.countryId === target.id && item.capital);
          if (oldCapital) oldCapital.capital = false;
          city.capital = true;
          w.version += 1;
          this.markCityArea(city);
          if (oldCapital) this.markCityArea(oldCapital);
          this.addLog(`${target.name}: столица перенесена.`, [
            chronicleReference('country', target.id),
            chronicleReference('city', city.id),
            ...(oldCapital ? [chronicleReference('city', oldCapital.id)] : []),
          ]);
        }
        break;
      }
      case 'nomadExpand': {
        if (used > 0 && target) this.addLog(`${target.name}: кочевой ареал расширен на ${Math.floor(used)} земель.`,
          [chronicleReference('country', target.id)]);
        break;
      }
      case 'expand':
        if (used > 0 && target) this.addLog(`${target.name} расширяется на ${used} земель.`, [chronicleReference('country', target.id)]);
        break;
      case 'colonization':
        if (colonizedPixels > 0 && target) this.addLog(`${target.name} колонизирует ${colonizedPixels} участков: переселено ${fmt(colonistsMoved)} человек, столько же местных жителей удалено.`, [chronicleReference('country', target.id)]);
        break;
      case 'split': {
        const country = w.countries[card.newCountryId as number];
        if (country.pixels === 0) w.discardLast('countries', country.id);
        else if (target) {
          finalizeSplitCities(w, country.id);
          this.addLog(`${country.name} откалывается от ${target.name}.`, [
            chronicleReference('country', country.id), chronicleReference('country', target.id),
            ...w.cities.filter((city) => city.countryId === country.id).map((city) => chronicleReference('city', city.id)),
            chronicleReference('culture', country.cultureId),
            ...(country.religionId === null ? [] : [chronicleReference('religion', country.religionId)]),
          ]);
          if (card.splitCultureId !== undefined) this.extendPressure(target, 'ethnic');
          if (card.splitReligionId !== undefined) this.extendPressure(target, 'faith');
        }
        break;
      }
      case 'drought':
      case 'rain':
        if (used > 0) this.addLog(`${card.type === 'rain' ? 'Ливни' : 'Засуха'}${target ? ` в ${target.name}` : ''}: ${used} земель.`,
          target ? [chronicleReference('country', target.id)] : changedCountryIds.map((id) => chronicleReference('country', id)));
        break;
      case 'desertification':
      case 'swamping':
      case 'warmCurrent':
      case 'coldCurrent':
      case 'warmWind':
      case 'coldWind':
        if (used > 0) this.addLog(`${card.title}${target ? ` в ${target.name}` : ''}: изменено ${Math.ceil(used)} участков климата.`,
          target ? [chronicleReference('country', target.id)] : changedCountryIds.map((id) => chronicleReference('country', id)));
        break;
      case 'faith': {
        const religion = w.religions[card.newReligionId as number];
        if (used === 0) w.discardLast('religions', religion.id);
        else {
          const affectedCountries = target
            ? [target]
            : changedCountryIds.map((id) => w.countries[id]).filter((country): country is Country => !!country);
          this.addLog(`Возникает вера «${religion.name}»${target ? ` в ${target.name}` : ''}.`, [
            chronicleReference('religion', religion.id),
            ...affectedCountries.map((country) => chronicleReference('country', country.id)),
          ]);
          for (const country of affectedCountries) this.extendPressure(country, 'faith');
        }
        break;
      }
      case 'culture': {
        const culture = w.cultures[card.newCultureId as number];
        if (used === 0) w.discardLast('cultures', culture.id);
        else {
          this.addLog(`Выделяется народ «${culture.name}» из «${w.cultures[card.sourceCultureId as number].name}».`, [
            chronicleReference('culture', culture.id),
            chronicleReference('culture', card.sourceCultureId as number),
            ...(target
              ? [chronicleReference('country', target.id)]
              : changedCountryIds.map((countryId) => chronicleReference('country', countryId))),
          ]);
          if (target) this.extendPressure(target, 'ethnic');
        }
        break;
      }
      case 'government':
      case 'revolt': {
        const polity = target;
        if (polity) {
          const choice = card.choices?.[card.selectedChoice];
          const previous = GOVERNMENTS[polity.government].name;
          if (choice) {
            applyReform(polity, { government: choice.government, add: choice.modifier, remove: choice.removeModifier,
              termYears: choice.termYears, maxTerms: choice.maxTerms, consulCount: choice.consulCount, forced: choice.violent, weight: 1 });
            if (choice.violent) {
              const pressure = polity.pressures.coup ?? { until: this.year, strength: 0 };
              pressure.until = Math.max(pressure.until, this.year + 8);
              pressure.strength = Math.max(1, pressure.strength * 2);
              polity.pressures.coup = pressure;
              const ruler = registerPerson(w, polity, choice.ruler ?? newCitizen(w, polity, this.year));
              this.appointCountryLeader(polity, ruler, this.year);
              this.addLog(`${polity.name}: переворот. ${GOVERNMENTS[polity.government].name}, правитель ${polity.ruler.name}.`, [polityChronicleReference(polity)]);
            } else this.addLog(`${polity.name}: введено изменение «${choice.label}»; форма ${previous}.`, [polityChronicleReference(polity)]);
            ensureOffices(w, polity, this.year);
            refreshHeirs(w, this.year);
          }
        }
        break;
      }
      case 'succession':
      case 'election': {
        const polity = target;
        if (polity) {
          const choice = card.choices?.[card.selectedChoice];
          const ruler = choice?.ruler ?? card.newRuler;
          if (ruler) {
            const seatId = choice?.seatId ?? polity.ruler.id;
            const previousLeader = person(w, seatId) ?? polity.ruler;
            this.appointCountryLeader(polity, ruler, this.year, seatId);
            ensureOffices(w, polity, this.year);
            refreshHeirs(w, this.year);
            const seatLabel = polity.modifiers.includes('consulate') ? 'консулом' : 'правителем';
            this.addLog(`${polity.name}: ${card.type === 'election' ? 'выбран' : 'власть передана'} ${ruler.name} вместо ${previousLeader.name}; теперь он ${seatLabel}.`, [polityChronicleReference(polity)]);
          }
        }
        break;
      }
      case 'death':
      case 'marriage':
      case 'birth':
      case 'character':
        if (target && card.characterEvent) {
          this.applyCharacterEvent(target, card.characterEvent, card.newRuler, card.choices?.[card.selectedChoice]);
        }
        break;
      case 'union':
        if (target && card.newCountryId !== null) this.mergeCountries(target, w.countries[card.newCountryId]);
        break;
    }
    let dissolved = false;
    for (const country of [...w.countries]) {
      if (country.type !== 'settled' || country.pixels <= 0 || w.cities.some((city) => city.countryId === country.id)) continue;
      const newCountries = dissolveCountryIntoNomadicCountries(w, country, this.year);
      this.addLog(`${country.name}: без городов страна распущена; население перешло в ${newCountries.length} кочевых стран.`, [
        chronicleReference('country', country.id),
        ...newCountries.map((newCountry) => chronicleReference('country', newCountry.id)),
        chronicleReference('culture', country.cultureId),
        ...(country.religionId === null ? [] : [chronicleReference('religion', country.religionId)]),
      ]);
      dissolved = true;
    }
    if (dissolved) this.renderer.markAll();
    ensureUniqueDynastySurnames(w);
    w.version += 1;
  }

  private mergeCountries(main: Country, incoming?: Country, cause: 'union' | 'inheritance' = 'union'): void {
    if (!incoming || incoming.id === main.id || incoming.pixels <= 0) return;
    const w = this.world;
    const incomingTag = incoming.id + 1, mainTag = main.id + 1;
    const mainCapital = w.cities.find((city) => city.countryId === main.id && city.capital);
    for (let p = 0; p < w.owner.length; p += 1) if (w.owner[p] === incomingTag) w.owner[p] = mainTag;
    for (const city of w.cities) if (city.countryId === incoming.id) city.countryId = main.id;
    const mergedCities = w.cities.filter((city) => city.countryId === main.id);
    const retainedCapital = mainCapital ?? mergedCities[0];
    for (const city of mergedCities) city.capital = city.id === retainedCapital?.id;
    if (incoming.ruler.id !== main.ruler.id) {
      if (!main.previousRulerIds.includes(incoming.ruler.id)) main.previousRulerIds.push(incoming.ruler.id);
      if (!incoming.ruler.formerRulerOf.includes(main.id)) incoming.ruler.formerRulerOf.push(main.id);
    }
    main.dynastyClaims = [...new Set([...main.dynastyClaims, ...incoming.dynastyClaims])];
    main.previousRulerIds = [...new Set([...main.previousRulerIds, ...incoming.previousRulerIds])];
    for (const p of w.people) if (p.countryId === incoming.id) p.countryId = main.id;
    refreshHeirs(w, this.year); ensureOffices(w, main, this.year);
    w.recountCountries(); w.version += 1; this.renderer.markAll();
    this.addLog(cause === 'inheritance'
      ? `${incoming.name} поглощена ${main.name} после перехода власти к её правителю.`
      : `${incoming.name} мирно объединилась с ${main.name}.`, [
      chronicleReference('country', main.id),
      chronicleReference('country', incoming.id),
      ...mergedCities.map((city) => chronicleReference('city', city.id)),
    ]);
  }

  /** If another country's sitting ruler inherits this throne, their former state joins it. */
  private appointAndAnnex(country: Country, ruler: Person, year: number, seatId = country.ruler.id): void {
    const homes = this.world.countries.filter((other) => other.id !== country.id && other.pixels > 0 &&
      (other.ruler.id === ruler.id ||
        (other.modifiers.includes('consulate') && other.coRulerIds.includes(ruler.id))));
    appoint(this.world, country, ruler, year, seatId);
    const isLeader = country.ruler.id === ruler.id ||
      (country.modifiers.includes('consulate') && country.coRulerIds.includes(ruler.id));
    if (!isLeader) return;
    for (const home of homes) this.mergeCountries(country, home, 'inheritance');
  }

  private appointCountryLeader(country: Country, ruler: Person, year: number, seatId = country.ruler.id): void {
    if (country.type === 'settled') this.appointAndAnnex(country, ruler, year, seatId);
    else appoint(this.world, country, ruler, year, seatId);
  }

  private extendPressure(country: Country, kind: 'faith' | 'ethnic' | 'coup'): void {
    const previous = country.pressures[kind];
    const active = previous?.until !== undefined && previous.until >= this.year;
    country.pressures[kind] = {
      until: Math.max(active ? previous!.until : this.year, this.year + 8),
      strength: active ? Math.max(1, previous!.strength * 2) : 1,
    };
  }

  private applyCharacterEvent(country: Country, event: CharacterEvent, generated: Person | null, choice?: CardChoice): void {
    const w = this.world, ids = event.personIds;
    if (event.kind === 'death') {
      const deceased = person(w, ids[0]);
      if (!deceased) return;
      const wasLeader = deceased.id === country.ruler.id || country.coRulerIds.includes(deceased.id);
      killPerson(w, deceased, this.year, deceased.age >= 66 ? 'старость' : 'болезнь или несчастный случай');
      if (wasLeader) {
        const seatId = deceased.id;
        const closesConsulateSeat = country.modifiers.includes('consulate') && choice?.closeConsulateSeat;
        let next: Person | null;
        if (closesConsulateSeat) {
          if (seatId === country.ruler.id) {
            const promoted = country.coRulerIds.map((id) => person(w, id))
              .find((leader): leader is Person => !!leader?.alive);
            next = promoted ?? registerPerson(w, country, newCitizen(w, country, this.year));
            this.appointCountryLeader(country, next, this.year, seatId);
          } else {
            country.coRulerIds = country.coRulerIds.filter((id) => id !== seatId);
            next = country.ruler;
          }
          country.consulCount = Math.max(1, country.consulCount - 1);
          if (country.consulCount === 1) country.modifiers = country.modifiers.filter((modifier) => modifier !== 'consulate');
        } else {
          next = choice?.ruler ?? null;
          const inSuccessionOrder = next && successionOrder(w, country, deceased).some((candidate) => candidate.id === next!.id);
          if (!next || !next.alive || (!inSuccessionOrder && !candidateAllowed(w, country, next, deceased))) {
            next = successionOrder(w, country, deceased)[0] ?? null;
          }
          if (!next) {
            next = registerPerson(w, country, newCitizen(w, country, this.year));
            this.addLog(`${country.name}: линия наследования прервалась; выбран новый правитель.`, [polityChronicleReference(country)]);
          }
          this.appointCountryLeader(country, next, this.year, seatId);
          ensureOffices(w, country, this.year);
        }
        if (country.government === 'tyranny' && Math.random() < 0.5) {
          const form = randomItem(['tribal', 'hereditary', 'republic'] as const);
          applyReform(country as Country, { government: form, forced: true, weight: 1 });
          const pressure = country.pressures.tyranny ?? { until: this.year, strength: 0 };
          pressure.until = Math.max(pressure.until, this.year + 8);
          pressure.strength = Math.max(1, pressure.strength * 2);
          country.pressures.tyranny = pressure;
          this.addLog(`${country.name}: после смерти правителя тирания сменена на форму «${GOVERNMENTS[form].name}».`, [polityChronicleReference(country)]);
        } else if (closesConsulateSeat) {
          this.addLog(`${country.name}: вакантное консульское место закрыто; осталось ${country.consulCount} мест.`, [
            polityChronicleReference(country),
          ]);
        } else this.addLog(`${country.name}: ${deceased.name} умер${deceased.gender === 'female' ? 'ла' : ''}; правит ${next.name}.`, [polityChronicleReference(country)]);
        if (country.type === 'settled' && country.modifiers.includes('partition') && country.government !== 'republic' && country.government !== 'tyranny') {
          this.partitionCountry(country, deceased, choice?.ruler ?? next);
        }
      } else {
        this.addLog(`${country.name}: умер${deceased.gender === 'female' ? 'ла' : ''} ${deceased.name}, ${deceased.age} лет.`, [polityChronicleReference(country)]);
      }
      refreshHeirs(w, this.year);
      return;
    }
    if (event.kind === 'birth') {
      const parents = ids.map((id) => person(w, id)).filter((p): p is Person => !!p && p.alive);
      const mother = parents.find((p) => p.gender === 'female'), father = parents.find((p) => p.gender === 'male');
      if (mother && father && arePartners(mother, father)) {
        const child = birth(w, country, mother, father, this.year);
        if (!child) return;
        this.addLog(`${country.name}: у ${mother.name} и ${father.name} родился ребёнок ${child.name}.`, [polityChronicleReference(country)]);
        refreshHeirs(w, this.year);
      }
      return;
    }
    if (event.kind === 'marriage' || event.kind === 'engagement') {
      const a = person(w, ids[0]);
      const b = choice?.person ?? choice?.ruler ?? person(w, ids[1]) ?? event.newPerson ?? generated;
      if (a && b && a.alive && b.alive) {
        marry(w, country, a, b, event.kind === 'engagement');
        this.addLog(`${country.name}: ${event.kind === 'engagement' ? 'обручились' : 'поженились'} ${a.name} и ${b.name}.`, [polityChronicleReference(country)]);
      }
      return;
    }
    const a = person(w, ids[0]), b = person(w, ids[1]);
    if (event.kind === 'romance' && a && b && a.alive && b.alive) {
      if (!a.loverIds.includes(b.id)) a.loverIds.push(b.id);
      if (!b.loverIds.includes(a.id)) b.loverIds.push(a.id);
      this.addLog(`${country.name}: романтическая связь между ${a.name} и ${b.name}.`, [polityChronicleReference(country)]);
    }
    if (event.kind === 'friendship' && a && b) {
      if (!a.friendIds.includes(b.id)) a.friendIds.push(b.id);
      if (!b.friendIds.includes(a.id)) b.friendIds.push(a.id);
      this.addLog(`${country.name}: ${a.name} и ${b.name} стали друзьями.`, [polityChronicleReference(country)]);
    } else if (event.kind === 'trait' && a && a.traits.length === 0) {
      const traits = ['Фанатик', 'Циник', 'Космополит', 'Националист', 'Плодовитый', 'Дальновидный', 'Решительный', 'Уступчивый', 'Осторожный', 'Харизматичный'];
      a.trait = randomItem(traits); a.traits.push(a.trait);
      this.addLog(`${country.name}: у ${a.name} проявилась черта «${a.trait}».`, [polityChronicleReference(country)]);
    }
  }

  /** Applies the design-doc partition law by painting contiguous areas for each heir. */
  private partitionCountry(source: Country, deceased: Person, preferred: Person): void {
    const w = this.world;
    const sourceCities = w.cities.filter((city) => city.countryId === source.id);
    const consulatePartition = source.modifiers.includes('consulate') && source.modifiers.includes('partition');
    if (sourceCities.length < (consulatePartition ? 1 : 2)) return;
    const ranked = successionOrder(w, source, deceased);
    const eligibleChildren = w.people.filter((p) => p.parents.includes(deceased.id) &&
      candidateAllowed(w, source, p, deceased, false, consulatePartition));
    if (eligibleChildren.length < (consulatePartition ? 1 : 2)) return;

    const hasOtherSuccessionLaw = source.modifiers.some((id) =>
      ['seniority', 'minority', 'primogeniture', 'oligarchy', 'pornocracy', 'meritocracy',
        'patriarchal', 'matriarchal', 'theocracy', 'ethnic', 'communist'].includes(id));
    let heirs = consulatePartition
      ? [...ranked.filter((p) => eligibleChildren.some((child) => child.id === p.id)), ...eligibleChildren]
          .filter((p, index, all) => all.findIndex((x) => x.id === p.id) === index)
      : hasOtherSuccessionLaw
        ? [...ranked, ...eligibleChildren].filter((p, index, all) =>
            candidateAllowed(w, source, p, deceased) && all.findIndex((x) => x.id === p.id) === index)
        : [...eligibleChildren];
    if (hasOtherSuccessionLaw && !consulatePartition && !heirs.some((p) => p.id === preferred.id) &&
        candidateAllowed(w, source, preferred, deceased)) {
      heirs.unshift(preferred);
    }
    if (consulatePartition) {
      const firstChildId = eligibleChildren.some((child) => child.id === source.ruler.id)
        ? source.ruler.id
        : preferred.id;
      heirs.sort((a, b) => Number(b.id === firstChildId) - Number(a.id === firstChildId));
    } else if (hasOtherSuccessionLaw) {
      const primary = heirs.find((p) => p.id === preferred.id) ?? heirs[0];
      heirs = [primary, ...heirs.filter((p) => p.id !== primary.id)];
    } else {
      // Without another succession law, neither child has a prescribed priority.
      for (let i = heirs.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [heirs[i], heirs[j]] = [heirs[j], heirs[i]];
      }
    }
    heirs = heirs.filter((p) => p.alive && p.id !== deceased.id);
    if (heirs.length < (consulatePartition ? 1 : 2)) return;

    const pixels: number[] = [];
    w.forEachCountryPixel(source, (p) => pixels.push(p));
    let partitionCount: number;
    let destinationHeirs: Person[];
    let consulateOfficeHolders: Person[] = [];
    if (consulatePartition) {
      const childIds = new Set(eligibleChildren.map((child) => child.id));
      const activeLeaders = [source.ruler, ...source.coRulerIds.map((id) => person(w, id))
        .filter((leader): leader is Person => !!leader?.alive)].filter((leader) => leader.alive && leader.id !== deceased.id);
      const retainedConsuls = activeLeaders.filter((leader) => !childIds.has(leader.id));
      const activeChildLeaders = activeLeaders.filter((leader) => childIds.has(leader.id));
      const orderedChildren = [
        ...heirs.filter((heir) => activeChildLeaders.some((leader) => leader.id === heir.id)),
        ...heirs.filter((heir) => !activeChildLeaders.some((leader) => leader.id === heir.id)),
      ];
      const maxChildren = Math.max(0, sourceCities.length * source.consulCount - retainedConsuls.length);
      heirs = orderedChildren;
      heirs = heirs.slice(0, maxChildren);
      const H = heirs.length;
      const R = retainedConsuls.length;
      consulateOfficeHolders = [...activeLeaders, ...heirs]
        .filter((leader, index, all) => all.findIndex((candidate) => candidate.id === leader.id) === index);
      const K = source.consulCount;
      const G = sourceCities.length;
      partitionCount = Math.min(G, Math.max(1, Math.ceil((H + R) / K)));
      if (partitionCount < 2) {
        source.coRulerIds = [];
        const remaining = consulateOfficeHolders.filter((leader) => leader.id !== source.ruler.id);
        for (const leader of remaining.slice(0, Math.max(0, source.consulCount - 1))) {
          source.coRulerIds.push(leader.id);
          leader.countryId = source.id;
        }
        ensureOffices(w, source, this.year);
        return;
      }
      destinationHeirs = heirs.slice(1, partitionCount);
      if (destinationHeirs.length !== partitionCount - 1) return;
    } else {
      heirs = heirs.slice(0, Math.min(pixels.length, sourceCities.length));
      if (heirs.length < 2) return;
      partitionCount = heirs.length;
      destinationHeirs = heirs.slice(1);
    }
    const sourceCapital = sourceCities.find((city) => city.capital) ?? sourceCities[0];
    const heirCities = [
      sourceCapital,
      ...sourceCities.filter((city) => city.id !== sourceCapital.id)
        .sort((a, b) => b.rank - a.rank || b.population - a.population)
        .slice(0, partitionCount - 1),
    ];
    if (heirCities.length < partitionCount) return;
    const originalId = source.id;
    const states: Country[] = [source];
    const originalCoRulerIds = [...source.coRulerIds];
    const originalOfficeHomes = consulatePartition
      ? new Map([source.ruler, ...source.coRulerIds.map((id) => person(w, id))
          .filter((leader): leader is Person => !!leader)].map((leader) => [leader.id, leader.countryId]))
      : null;
    const originalHeirHomes = consulatePartition
      ? new Map(eligibleChildren.map((heir) => [heir.id, heir.countryId]))
      : null;
    const mergedHomes: {
      destinationId: number;
      homeId: number;
      pixels: number[];
      cityIds: number[];
      personIds: number[];
      rulerId: number;
    }[] = [];
    for (const heir of destinationHeirs) {
      const state = w.newCountry({ rank: source.rank, cultureId: heir.cultureId, religionId: heir.religionId, density: source.density,
        foundedYear: this.year, parentId: originalId, government: source.government });
      w.people = w.people.filter((p) => p.id !== state.ruler.id);
      state.ruler = heir; heir.countryId = state.id;
      if (!heir.formerRulerOf.includes(state.id)) heir.formerRulerOf.push(state.id);
      state.modifiers = [...source.modifiers]; state.previousRulerIds = [...source.previousRulerIds];
      state.dynastyClaims = [...source.dynastyClaims];
      // Seats belong to each new country; never duplicate the old country's consuls.
      state.coRulerIds = [];
      state.termYears = source.termYears; state.maxTerms = source.maxTerms; state.consulCount = source.consulCount;
      state.seatSince = { ...source.seatSince }; state.termCounts = { ...source.termCounts };
      state.rulerSince = this.year;
      const homes = w.countries.filter((other) => other.id !== state.id && other.id !== source.id &&
        other.pixels > 0 && (other.ruler.id === heir.id ||
          (other.modifiers.includes('consulate') && other.coRulerIds.includes(heir.id))));
      for (const home of homes) {
        const pixels: number[] = [];
        w.forEachCountryPixel(home, (pixel) => pixels.push(pixel));
        mergedHomes.push({
          destinationId: state.id,
          homeId: home.id,
          pixels,
          cityIds: w.cities.filter((city) => city.countryId === home.id).map((city) => city.id),
          personIds: w.people.filter((person) => person.countryId === home.id).map((person) => person.id),
          rulerId: home.ruler.id,
        });
        this.mergeCountries(state, home, 'inheritance');
      }
      states.push(state);
    }
    partitionCount = states.length;
    const territoryHeirs = consulatePartition ? [heirs[0], ...destinationHeirs] : heirs.slice(0, partitionCount);
    if (consulatePartition) {
      const primaryIds = new Set(states.map((state) => state.ruler.id));
      const remaining = consulateOfficeHolders.filter((leader) => !primaryIds.has(leader.id));
      for (const state of states) state.coRulerIds = [];
      for (const leader of remaining) {
        const state = states.filter((candidate) => candidate.coRulerIds.length < source.consulCount - 1)
          .sort((a, b) => a.coRulerIds.length - b.coRulerIds.length)[0];
        if (!state) break;
        state.coRulerIds.push(leader.id);
        leader.countryId = state.id;
        if (state.seatSince[leader.id] === undefined) state.seatSince[leader.id] = this.year;
      }
    }
    const quotas = new Array<number>(partitionCount).fill(0);
    if (hasOtherSuccessionLaw) {
      quotas[0] = Math.floor(pixels.length / 2);
      const remainder = pixels.length - quotas[0];
      for (let i = 1; i < partitionCount; i += 1) quotas[i] = Math.floor(remainder / (partitionCount - 1));
      for (let i = 1; i <= remainder % (partitionCount - 1); i += 1) quotas[i] += 1;
    } else {
      const base = Math.floor(pixels.length / partitionCount);
      quotas.fill(base);
      for (let i = 0; i < pixels.length % partitionCount; i += 1) quotas[i] += 1;
    }

    if (this.isPlayerControlled(source.id)) {
      this.pendingInheritanceSplit = {
        sourceCountryId: source.id,
        destinationIds: states.slice(1).map((state) => state.id),
        quotas: quotas.slice(1),
        baselinePixels: states.slice(1).map((state) => state.pixels),
      };
      return;
    }

    // Grow one contiguous region at a time. A shared culture and faith gets
    // the 4x priority from the design; a match on only one gets 2x.
    const available = new Uint8Array(MAP_PIXELS);
    for (const p of pixels) available[p] = 1;
    const reservedCityState = new Int16Array(MAP_PIXELS).fill(-1);
    const partitionBaselines = states.slice(1).map((state) => state.pixels);
    for (let stateIndex = 0; stateIndex < heirCities.length; stateIndex += 1) {
      const city = heirCities[stateIndex];
      const hasExistingTerritory = stateIndex > 0 && partitionBaselines[stateIndex - 1] > 0;
      if (city && !hasExistingTerritory) reservedCityState[city.pixel] = stateIndex;
    }
    const partitionBrushes = states.map((state, index) => index === 0
      ? null
      : new PartitionBrush(w, source.id, state.id, quotas[index], partitionBaselines[index - 1]));
    const transferredPixels: number[] = [];
    const inFrontier = new Uint8Array(MAP_PIXELS);
    for (let stateIndex = 0; stateIndex < partitionCount; stateIndex += 1) {
      const heir = territoryHeirs[stateIndex];
      const buckets: Set<number>[] = [new Set(), new Set(), new Set()];
      const category = (p: number) => {
        const cultureMatch = w.cultureTable.shareOf(w.culture[p], heir.cultureId) > 0;
        const religionMatch = heir.religionId === null
          ? w.religionTable.entries[w.religion[p]].total < 100
          : w.religionTable.shareOf(w.religion[p], heir.religionId) > 0;
        return cultureMatch && religionMatch ? 2 : cultureMatch || religionMatch ? 1 : 0;
      };
      const addNeighbours = (p: number) => forEachNeighbour(p, (next) => {
        if (!available[next] || inFrontier[next] || reservedCityState[next] > stateIndex) return;
        inFrontier[next] = 1;
        buckets[category(next)].add(next);
      });
      const citySeed = heirCities[stateIndex];
      let left = quotas[stateIndex];
      let seedPixel = citySeed?.pixel ?? -1;
      if (stateIndex > 0 && partitionBaselines[stateIndex - 1] > 0) {
        seedPixel = -1;
        let bestPriority = -1;
        for (const candidate of pixels) {
          if (!available[candidate] || !partitionBrushes[stateIndex]?.canPaint(candidate)) continue;
          const priority = category(candidate);
          if (priority > bestPriority) {
            seedPixel = candidate;
            bestPriority = priority;
          }
        }
      }
      if (seedPixel >= 0 && available[seedPixel]) {
        available[seedPixel] = 0;
        if (stateIndex > 0) {
          if (!partitionBrushes[stateIndex]?.paint(seedPixel)) continue;
          transferredPixels.push(seedPixel);
        }
        left = Math.max(0, left - 1);
        addNeighbours(seedPixel);
      }
      while (left > 0) {
        let bucketIndex = buckets[2].size ? 2 : buckets[1].size ? 1 : 0;
        let next = -1;
        if (buckets[bucketIndex].size) {
          const first = buckets[bucketIndex].values().next().value;
          if (first === undefined) continue;
          next = first;
          buckets[bucketIndex].delete(next);
          inFrontier[next] = 0;
        } else {
          break;
        }
        available[next] = 0;
        if (stateIndex > 0) {
          if (!partitionBrushes[stateIndex]?.paint(next)) continue;
          transferredPixels.push(next);
        }
        left -= 1;
        addNeighbours(next);
      }
      for (const bucket of buckets) for (const p of bucket) inFrontier[p] = 0;
    }
    const validation = validateSplitPartition(w, source.id,
      states.slice(1).map((state) => state.id), quotas.slice(1), partitionBaselines);
    if (!validation.valid) {
      this.addLog(`${source.name}: наследственное разделение отменено — ${validation.reason}`, [chronicleReference('country', source.id)]);
      for (const pixel of transferredPixels) w.setOwner(pixel, source.id + 1);
      for (const saved of mergedHomes.reverse()) {
        const home = w.countries[saved.homeId];
        if (!home) continue;
        for (const pixel of saved.pixels) w.setOwner(pixel, saved.homeId + 1);
        for (const cityId of saved.cityIds) {
          const city = w.cities.find((item) => item.id === cityId);
          if (city) city.countryId = saved.homeId;
        }
        for (const personId of saved.personIds) {
          const person = w.people.find((item) => item.id === personId);
          if (person) person.countryId = saved.homeId;
        }
        const ruler = w.people.find((person) => person.id === saved.rulerId);
        if (ruler) ruler.formerRulerOf = ruler.formerRulerOf.filter((id) => id !== saved.destinationId);
      }
      for (const state of states.slice(1)) {
        const heir = state.ruler;
        heir.countryId = source.id;
        heir.formerRulerOf = heir.formerRulerOf.filter((id) => id !== state.id);
      }
      for (const state of states.slice(1).reverse()) {
        if (w.countries[w.countries.length - 1]?.id === state.id) w.discardLast('countries', state.id);
      }
      if (consulatePartition) {
        source.coRulerIds = originalCoRulerIds;
        for (const [personId, countryId] of [...(originalOfficeHomes ?? []), ...(originalHeirHomes ?? [])]) {
          const leader = w.people.find((person) => person.id === personId);
          if (leader) leader.countryId = countryId;
        }
      }
      w.recountCountries();
      return;
    }
    for (const state of states.slice(1)) finalizeSplitCities(w, state.id);
    for (const state of states) ensureOffices(w, state, this.year);
    w.recountCountries(); w.version += 1; this.renderer.markAll();
    this.addLog(`${source.name}: страна разделена на ${partitionCount} части между ${consulatePartition ? heirs.length : partitionCount} наследниками.`, [
      chronicleReference('country', source.id),
      ...states.map((state) => chronicleReference('country', state.id)),
      ...w.cities.filter((city) => states.some((state) => state.id === city.countryId)).map((city) => chronicleReference('city', city.id)),
      ...states.flatMap((state) => [
        chronicleReference('culture', state.cultureId),
        ...(state.religionId === null ? [] : [chronicleReference('religion', state.religionId)]),
      ]),
    ]);
  }

  private addLog(text: string, objects: ChronicleReference[] = []): void {
    const uniqueObjects = new Map(objects.map((reference) => [`${reference.type}:${reference.id}`, reference]));
    this.log = [{ year: this.year, text, objects: [...uniqueObjects.values()] }, ...this.log].slice(0, LOG_LIMIT);
  }

  // ---------- snapshot ----------

  private buildSnapshot(): GameSnapshot {
    const w = this.world;
    const card = this.card;
    return {
      year: this.year,
      turn: this.turn,
      role: this.role,
      mapKind: w.mapKind,
      focusCountry: this.focusCountryId !== null ? (w.countries[this.focusCountryId] ?? null) : null,
      selectedCountryId: this.selectedCountryId,
      card: card ? { ...card } : null,
      cardCountry: card && card.targetCountryId !== null ? w.countries[card.targetCountryId] : null,
      queuedCards: this.queue.length,
      canPaint: !!this.painter && (card?.ink ?? 0) > 0,
      cityPlacementAvailable: this.canPlaceCity(),
      brushMode: this.brushMode,
      brushOption: brushOptionFor(card),
      brushSize: this.brushSize,
      mapMode: this.mapMode,
      layer: this.layer,
      secondsLeft: this.secondsLeft,
      paused: this.paused,
      busy: this.busy,
      drawing: this.drawing,
      progress: this.progress,
      log: this.log.map((entry) => entry.year ? `${entry.year}: ${entry.text}` : entry.text),
      chronicle: this.log,
      message: this.message,
      legend: this.lastPoint ? (this.legendCache?.legend ?? this.computeLegend()) : this.legend(),
    };
  }

  private legend(): Legend {
    if (!this.legendCache || this.legendCache.version !== this.world.version) {
      this.legendCache = { version: this.world.version, legend: this.computeLegend() };
    }
    return this.legendCache.legend;
  }

  private computeLegend(): Legend {
    const w = this.world;
    const countryPop = new Float64Array(w.countries.length);
    const culturePop = new Float64Array(w.cultures.length);
    const religionPop = new Float64Array(w.religions.length);
    const biomeCount = new Float64Array(BIOMES.length);
    const cultureAcc = new Float64Array(w.cultureTable.entries.length);
    const religionAcc = new Float64Array(w.religionTable.entries.length);
    let nonBelievers = 0;
    let total = 0;
    for (const p of w.landIndex) {
      biomeCount[w.biomeAt(p)] += 1;
      const owner = w.owner[p];
      if (owner === 0) continue;
      const d = populationAtPixel(w, p);
      countryPop[owner - 1] += d;
      total += d;
      cultureAcc[w.culture[p]] += d;
      religionAcc[w.religion[p]] += d;
    }
    for (const country of w.countries) {
      if (country.type !== 'nomadic') continue;
      for (const cell of country.cells ?? []) {
        const population = cell.population;
        countryPop[country.id] += population;
        total += population;
        cultureAcc[cell.cultureMix] += population;
        religionAcc[cell.religionMix] += population;
      }
    }
    w.cultureTable.entries.forEach((entry, c) => {
      const population = cultureAcc[c];
      if (population > 0) entry.ids.forEach((id, i) => (culturePop[id] += (population * entry.shares[i]) / 100));
    });
    w.religionTable.entries.forEach((entry, c) => {
      const population = religionAcc[c];
      if (population <= 0) return;
      entry.ids.forEach((id, i) => (religionPop[id] += (population * entry.shares[i]) / 100));
      nonBelievers += (population * (100 - entry.total)) / 100;
    });
    const percent = (value: number, of: number) => (of > 0 ? Math.round((value / of) * 1000) / 10 : 0);
    const landTotal = w.landIndex.length;
    const byValue = (a: LegendRow, b: LegendRow) => b.value - a.value;
    return {
      totalPopulation: Math.round(total),
      countries: w.countries
        .filter(isActiveCountry)
        .map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          value: Math.round(countryPop[c.id]),
          percent: percent(countryPop[c.id], total),
          detail: `${c.type === 'nomadic' ? 'кочевая страна' : c.rank}, ${fmt(c.type === 'nomadic' ? c.range?.length ?? 0 : c.pixels)} земель`,
        }))
        .sort(byValue),
      cultures: w.cultures
        .filter((c) => culturePop[c.id] > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          value: Math.round(culturePop[c.id]),
          percent: percent(culturePop[c.id], total),
          detail: c.parentId !== null ? `ветвь «${w.cultures[c.parentId].name}»` : '',
        }))
        .sort(byValue),
      religions: w.religions
        .filter((r) => religionPop[r.id] > 0)
        .map((r) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          value: Math.round(religionPop[r.id]),
          percent: percent(religionPop[r.id], total),
          detail: `с ${r.foundedYear} г.`,
        }))
        .sort(byValue),
      nonBelievers: {
        id: -1,
        name: 'Атеисты',
        color: PALETTE.noFaith,
        value: Math.round(nonBelievers),
        percent: percent(nonBelievers, total),
        detail: '',
      },
      biomes: BIOMES.map((b) => ({
        id: b.id,
        name: b.name,
        color: b.color,
        value: biomeCount[b.id],
        percent: percent(biomeCount[b.id], landTotal),
        detail: b.rule,
      })).filter((row) => row.value > 0),
    };
  }

  // ---------- saving ----------

  private scheduleSave(): void {
    if (!Game.persist || this.disposed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      // Let the map finish drawing first: both share the JS thread.
      if (this.drawing) this.scheduleSave();
      else void this.save();
    }, 1500);
  }

  /** Saves right away (e.g. when the app goes to the background). */
  saveNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.save();
  }

  /** Copies the world, traces its zones in slices and writes the file. One save at a time. */
  async save(): Promise<void> {
    if (!Game.persist) return;
    if (this.saving) {
      this.saveAgain = true;
      return this.saving;
    }
    this.saving = (async () => {
      do {
        this.saveAgain = false;
        await this.saveOnce();
      } while (this.saveAgain);
    })();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  private async saveOnce(): Promise<void> {
    if (!this.ownsSave) return;
    const head = {
      version: 2 as const,
      savedAt: Date.now(),
      role: this.role,
      year: this.year,
      turn: this.turn,
      focusCountryId: this.focusCountryId,
      card: this.card ? { ...this.card } : null,
      painterState: this.painter?.snapshotState() ?? null,
      queue: this.queue.map((slot) => ({ ...slot })),
      brushMode: this.brushMode,
      brushSize: this.brushSize,
      mapMode: this.mapMode,
      log: this.log.slice(),
    };
    const steps = serializeSteps(copyWorld(this.world));
    let world: SavedWorld | null = null;
    let sliceStart = Date.now();
    for (;;) {
      const next = steps.next();
      if (next.done) {
        world = next.value;
        break;
      }
      if (Date.now() - sliceStart >= SLICE_MS) {
        await Game.pause();
        if (!this.ownsSave) return;
        sliceStart = Date.now();
      }
    }
    const bytes = encodeSave({ ...head, world } satisfies SavedGame);
    try {
      // Checked again inside the queue: a delete or a new game may have been requested meanwhile.
      await onSaveFile(async () => {
        if (this.ownsSave) await writeSaveBytes(bytes);
      });
    } catch (error) {
      this.message = `Не удалось сохранить игру: ${(error as Error).message}`;
      this.emit();
    }
  }

  private get ownsSave(): boolean {
    return !this.disposed && Game.saveOwner === this;
  }

  /** Stops the game without saving; a save already in progress is abandoned. */
  discard(): void {
    this.disposed = true;
    if (Game.saveOwner === this) Game.saveOwner = null;
    this.stop();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
}
