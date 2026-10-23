import { autoPaint } from './autoPaint';
import { brushOptionFor, CardPainter, type BrushMode, type BrushOption, type Card } from './brush';
import { drawCountryCard, drawWorldCard, firstCreateCard } from './cards';
import { BIOMES, BRUSH_SIZES, type BrushSize, LOG_LIMIT, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, PALETTE, TURN_SECONDS } from './config';
import type { MapKind } from './geography';
import { copyWorld, deserializeWorld, serializeSteps, type SavedWorld } from './persistence';
import { decodeSave, encodeSave } from './saveFile';
import { clearSaveBytes, hasSaveBytes, readSaveBytes, writeSaveBytes } from './storage';
import { fmt } from './format';
import { MapRenderer, type EntityLayer, type MapMode } from './render';
import { World, type Country } from './world';

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

export interface PixelInfo {
  x: number;
  y: number;
  land: boolean;
  country: Country | null;
  biome: string | null;
  humidity: number;
  temperature: number;
  drainage: number;
  density: number;
  cultures: { id: number; name: string; color: string; share: number }[];
  religions: { id: number; name: string; color: string; share: number }[];
  nonBelievers: number;
}

export interface GameSnapshot {
  year: number;
  turn: number;
  role: PlayerRole;
  mapKind: MapKind;
  focusCountry: Country | null;
  card: Card | null;
  /** Country the active card belongs to, if any. */
  cardCountry: Country | null;
  queuedCards: number;
  canPaint: boolean;
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
  log: string[];
  message: string;
  legend: Legend;
}

interface SavedGame {
  version: 2;
  savedAt: number;
  role: PlayerRole;
  year: number;
  turn: number;
  focusCountryId: number | null;
  card: Card | null;
  queue: Slot[];
  brushMode: BrushMode;
  brushSize: BrushSize;
  mapMode: MapMode;
  log: string[];
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
  private card: Card | null = null;
  private painter: CardPainter | null = null;
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
  private log: string[] = [];
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
  ) {
    this.role = role;
    this.renderer = new MapRenderer(world);
    // The newest game owns the save file; older (discarded) games may no longer write it.
    Game.saveOwner = this;
    this.redrawAll();
  }

  /** Repaints the whole map (e.g. for a newly opened map view); the timer waits until it is shown. */
  redrawAll(): void {
    this.renderer.markAll();
    this.drawing = true;
    this.emit(true);
  }

  static create(mapKind: MapKind, role: PlayerRole): Game {
    const game = new Game(World.create(mapKind), role);
    game.addLog('Мир создан.');
    const first = firstCreateCard(game.world, game.year);
    if (!first) {
      game.message = 'На карте нет свободной суши.';
      return game;
    }
    if (role === 'observer') {
      game.resolveAutomatically(first);
      game.secondsLeft = OBSERVER_SECONDS;
      game.message = game.log[0] ?? '';
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
    const game = new Game(deserializeWorld(saved.world), saved.role);
    game.year = saved.year;
    game.turn = saved.turn;
    game.focusCountryId = saved.focusCountryId;
    game.queue = saved.queue;
    game.brushMode = saved.brushMode;
    game.brushSize = saved.brushSize;
    game.log = saved.log;
    if (saved.card) game.startCard(saved.card);
    game.mapMode = saved.mapMode;
    game.renderer.setView(game.mapMode, null);
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

  get brushRadius(): number {
    return BRUSH_SIZES.find((size) => size.id === this.brushSize)?.radius ?? 11;
  }

  setBrushSize(size: BrushSize): void {
    this.brushSize = size;
    this.emit();
  }

  toggleBrushMode(): void {
    this.brushMode = this.brushMode === 'respect' ? 'repeat' : 'respect';
    if (this.painter) this.painter.mode = this.brushMode;
    this.emit();
  }

  beginStroke(x: number, y: number): void {
    if (!this.painter) return;
    this.painter.message = '';
    this.lastPoint = { x, y };
    this.painter.dab(x, y, this.brushRadius);
    this.afterPaint();
  }

  strokeTo(x: number, y: number): void {
    if (!this.painter || !this.lastPoint) return;
    this.painter.line(this.lastPoint.x, this.lastPoint.y, x, y, this.brushRadius);
    this.lastPoint = { x, y };
    this.afterPaint();
  }

  endStroke(): void {
    if (!this.painter) return;
    this.painter.endStroke();
    this.lastPoint = null;
    this.message = this.painter.message || this.message;
    this.emit();
    this.scheduleSave();
  }

  private afterPaint(): void {
    const painter = this.painter;
    if (!painter) return;
    if (painter.dirty) {
      this.renderer.mark(painter.dirty);
      painter.dirty = null;
    }
    if (painter.message) this.message = painter.message;
    this.emit(true);
  }

  // ---------- map view ----------

  setMapMode(mode: MapMode): void {
    this.mapMode = mode;
    this.layer = null;
    this.renderer.setView(mode, null);
    this.emit(true);
  }

  /** Shows a single culture or religion layer: its share at every point. */
  showLayer(layer: EntityLayer | null): void {
    if (layer) this.mapMode = layer.kind === 'culture' ? 'cultures' : 'religions';
    this.layer = layer;
    this.renderer.setView(this.mapMode, layer);
    this.emit(true);
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
    return {
      x: px,
      y: py,
      land,
      country: owner > 0 ? w.countries[owner - 1] : null,
      biome: land ? BIOMES[w.biomeAt(p)].name : null,
      humidity: w.humidity[p],
      temperature: w.temperature[p],
      drainage: w.drainage[p],
      density: owner > 0 ? w.density[p] : 0,
      cultures: owner > 0 ? cultureEntry.ids.map((id, i) => ({ id, name: w.cultures[id].name, color: w.cultures[id].color, share: cultureEntry.shares[i] })) : [],
      religions: owner > 0 ? religionEntry.ids.map((id, i) => ({ id, name: w.religions[id].name, color: w.religions[id].color, share: religionEntry.shares[i] })) : [],
      nonBelievers: owner > 0 ? 100 - religionEntry.total : 0,
    };
  }

  // ---------- turns ----------

  /** Ends the player's card and plays the rest of the year in slices, showing progress. */
  async nextTurn(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.completeCard();
      if (this.queue.length > 0 && this.startNextPlayerCard()) return;
      this.turn += 1;
      this.year += 1;
      const jobs: (() => void)[] = [];
      if (this.role === 'country' || this.role === 'observer') {
        jobs.push(() => {
          const card = drawWorldCard(this.world, this.year);
          if (card) this.resolveAutomatically(card);
        });
      }
      if (this.role !== 'all') {
        const ids = this.world.countries.filter((c) => c.pixels > 0).map((c) => c.id);
        for (const id of ids) {
          if (this.role === 'country' && id === this.focusCountryId) continue;
          jobs.push(() => {
            const country = this.world.countries[id];
            if (!country || country.pixels <= 0) return;
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
      // Only areas the AI painted are repainted; the timer waits until the map is drawn.
      this.drawing = this.renderer.pending;
      this.emit(true);
      this.scheduleSave();
    }
  }

  private playerSlots(): Slot[] {
    if (this.role === 'observer') return [];
    if (this.role === 'country') return this.focusCountryId !== null && this.world.countries[this.focusCountryId]?.pixels > 0 ? [{ scope: 'country', countryId: this.focusCountryId }] : [];
    if (this.role === 'world') return [{ scope: 'world' }];
    return [{ scope: 'world' }, ...this.world.countries.filter((c) => c.pixels > 0).map((c): Slot => ({ scope: 'country', countryId: c.id }))];
  }

  private startNextPlayerCard(): boolean {
    while (this.queue.length > 0) {
      const slot = this.queue.shift() as Slot;
      let card: Card | null = null;
      if (slot.scope === 'world') card = drawWorldCard(this.world, this.year);
      else {
        const country = this.world.countries[slot.countryId];
        if (country && country.pixels > 0) card = drawCountryCard(this.world, country, this.year);
      }
      if (card) {
        this.startCard(card);
        return true;
      }
    }
    this.card = null;
    this.painter = null;
    this.secondsLeft = this.role === 'observer' ? OBSERVER_SECONDS : TURN_SECONDS;
    this.message = this.role === 'observer' ? (this.log[0] ?? 'Мир развивается сам.') : 'В этом году нет применимых карт.';
    return false;
  }

  private startCard(card: Card): void {
    this.card = card;
    this.painter = new CardPainter(this.world, card, this.brushMode);
    this.secondsLeft = TURN_SECONDS;
    this.paused = false;
    this.message = card.detail;
    const mode: MapMode =
      card.type === 'drought' || card.type === 'rain' ? 'humidity' : card.type === 'faith' ? 'religions' : card.type === 'culture' ? 'cultures' : 'political';
    this.mapMode = mode;
    this.layer = null;
    this.renderer.setView(mode, null);
  }

  private resolveAutomatically(card: Card): void {
    const territorial = card.type === 'create' || card.type === 'expand' || card.type === 'split';
    const painter = new CardPainter(this.world, card, !territorial && Math.random() < 0.3 ? 'repeat' : 'respect');
    autoPaint(painter);
    if (painter.dirty) this.renderer.mark(painter.dirty);
    this.finish(painter);
  }

  private completeCard(): void {
    if (!this.painter) return;
    this.finish(this.painter);
    this.painter = null;
    this.card = null;
  }

  /** Writes the outcome to the log and drops entities the card created but never used. */
  private finish(painter: CardPainter): void {
    const card = painter.card;
    const w = this.world;
    const used = card.inkTotal - card.ink;
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
          this.addLog(`Основано: ${country.rank} ${country.name} (народ «${culture.name}»${faith}).`);
        }
        break;
      }
      case 'expand':
        if (used > 0 && target) this.addLog(`${target.name} расширяется на ${used} земель.`);
        break;
      case 'split': {
        const country = w.countries[card.newCountryId as number];
        if (country.pixels === 0) w.discardLast('countries', country.id);
        else if (target) this.addLog(`${country.name} откалывается от ${target.name}.`);
        break;
      }
      case 'drought':
      case 'rain':
        if (used > 0) this.addLog(`${card.type === 'rain' ? 'Ливни' : 'Засуха'}${target ? ` в ${target.name}` : ''}: ${used} земель.`);
        break;
      case 'faith': {
        const religion = w.religions[card.newReligionId as number];
        if (used === 0) w.discardLast('religions', religion.id);
        else this.addLog(`Возникает вера «${religion.name}»${target ? ` в ${target.name}` : ''}.`);
        break;
      }
      case 'culture': {
        const culture = w.cultures[card.newCultureId as number];
        if (used === 0) w.discardLast('cultures', culture.id);
        else this.addLog(`Выделяется народ «${culture.name}» из «${w.cultures[card.sourceCultureId as number].name}».`);
        break;
      }
    }
    w.version += 1;
  }

  private addLog(text: string): void {
    this.log = [`${this.year}: ${text}`, ...this.log].slice(0, LOG_LIMIT);
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
      card: card ? { ...card } : null,
      cardCountry: card && card.targetCountryId !== null ? w.countries[card.targetCountryId] : null,
      queuedCards: this.queue.length,
      canPaint: !!this.painter && (card?.ink ?? 0) > 0,
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
      log: this.log,
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
      const d = w.density[p];
      countryPop[owner - 1] += d;
      total += d;
      cultureAcc[w.culture[p]] += d;
      religionAcc[w.religion[p]] += d;
    }
    w.cultureTable.entries.forEach((entry, c) => {
      if (cultureAcc[c] > 0) entry.ids.forEach((id, i) => (culturePop[id] += (cultureAcc[c] * entry.shares[i]) / 100));
    });
    w.religionTable.entries.forEach((entry, c) => {
      if (religionAcc[c] <= 0) return;
      entry.ids.forEach((id, i) => (religionPop[id] += (religionAcc[c] * entry.shares[i]) / 100));
      nonBelievers += (religionAcc[c] * (100 - entry.total)) / 100;
    });
    const percent = (value: number, of: number) => (of > 0 ? Math.round((value / of) * 1000) / 10 : 0);
    const landTotal = w.landIndex.length;
    const byValue = (a: LegendRow, b: LegendRow) => b.value - a.value;
    return {
      totalPopulation: Math.round(total),
      countries: w.countries
        .filter((c) => c.pixels > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          value: Math.round(countryPop[c.id]),
          percent: percent(countryPop[c.id], total),
          detail: `${c.rank}, ${fmt(c.pixels)} земель`,
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
        name: 'Без веры',
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
