import { CLIMATE_DELTA, CULTURE_CONVERSION, FAITH_CONVERSION, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, MAX_DENSITY } from './config';
import { forEachNeighbour } from './geography';
import type { World } from './world';

export type CardType = 'create' | 'expand' | 'split' | 'drought' | 'rain' | 'faith' | 'culture';
/** 'respect': a pixel changes at most once per card. 'repeat': every new stroke applies again. */
export type BrushMode = 'respect' | 'repeat';
export type BrushOption = 'density' | 'repeat' | null;

export interface Card {
  type: CardType;
  title: string;
  detail: string;
  ink: number;
  inkTotal: number;
  /** Country the card belongs to (country cards) or acts on. */
  targetCountryId: number | null;
  /** Entities created by the card. */
  newCountryId: number | null;
  newCultureId: number | null;
  newReligionId: number | null;
  sourceCultureId: number | null;
  /** A pixel where the card certainly applies (used by automatic play). */
  hint: number;
}

export function brushOptionFor(card: Card | null): BrushOption {
  if (!card) return null;
  if (card.type === 'create' || card.type === 'expand') return 'density';
  if (card.type === 'drought' || card.type === 'rain' || card.type === 'faith' || card.type === 'culture') return 'repeat';
  return null;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Shared scratch buffers (one card is painted at a time).
const cardMask = new Uint8Array(MAP_PIXELS);
const strokeMask = new Uint8Array(MAP_PIXELS);
const dabMask = new Uint8Array(MAP_PIXELS);

/** Applies one card to the world, brush dab by brush dab, spending its ink. */
export class CardPainter {
  /** Pixels changed by this card (for automatic play and logs). */
  readonly changed: number[] = [];
  private readonly cardTouched: number[] = [];
  private strokeTouched: number[] = [];
  private readonly seas = new Set<number>();
  private readonly religionForNewLand: number;
  dirty: Rect | null = null;
  message = '';

  constructor(
    private readonly world: World,
    readonly card: Card,
    public mode: BrushMode,
  ) {
    const working = this.workingCountryId();
    if (working !== null && (card.type === 'expand' || card.type === 'split')) {
      const source = world.countries[card.type === 'split' ? (card.targetCountryId as number) : working];
      if (card.type === 'expand') {
        world.forEachCountryPixel(source, (p) => world.seasOfPixel(p, this.seas));
      }
    }
    const country = working !== null ? world.countries[working] : null;
    this.religionForNewLand =
      country && country.religionId !== null ? world.religionTable.single(country.religionId, 60) : 0;
  }

  /** Country whose territory grows: the new state for create/split, the owner for expand. */
  workingCountryId(): number | null {
    const card = this.card;
    if (card.type === 'create' || card.type === 'split') return card.newCountryId;
    if (card.type === 'expand') return card.targetCountryId;
    return null;
  }

  endStroke(): void {
    for (const p of this.strokeTouched) strokeMask[p] = 0;
    this.strokeTouched = [];
  }

  /** Clears scratch buffers; call once the card is finished. */
  dispose(): void {
    this.endStroke();
    for (const p of this.cardTouched) cardMask[p] = 0;
    this.cardTouched.length = 0;
  }

  private touch(p: number): void {
    if (!strokeMask[p]) {
      strokeMask[p] = 1;
      this.strokeTouched.push(p);
    }
    if (!cardMask[p]) {
      cardMask[p] = 1;
      this.cardTouched.push(p);
    }
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.dirty) this.dirty = { x0, y0, x1, y1 };
    else {
      this.dirty.x0 = Math.min(this.dirty.x0, x0);
      this.dirty.y0 = Math.min(this.dirty.y0, y0);
      this.dirty.x1 = Math.max(this.dirty.x1, x1);
      this.dirty.y1 = Math.max(this.dirty.y1, y1);
    }
  }

  /** Paints a line of dabs from (ax, ay) to (bx, by). Returns ink spent. */
  line(ax: number, ay: number, bx: number, by: number, radius: number): number {
    const distance = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.5)));
    let spent = 0;
    for (let i = 1; i <= steps; i += 1) {
      spent += this.dab(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps, radius);
      if (this.card.ink <= 0) break;
    }
    return spent;
  }

  /** Applies the card inside a circle. Returns ink spent. */
  dab(cx: number, cy: number, radius: number): number {
    const card = this.card;
    if (card.ink <= 0) {
      this.message = 'Чернила этой карты закончились.';
      return 0;
    }
    const r = Math.max(1, radius);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(MAP_WIDTH - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(MAP_HEIGHT - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return 0;
    const pixels: number[] = [];
    const r2 = r * r;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const p = y * MAP_WIDTH + x;
        if (this.world.land[p]) pixels.push(p);
      }
    }
    if (pixels.length === 0) return 0;
    const before = card.ink;
    if (card.type === 'create' || card.type === 'expand' || card.type === 'split') this.paintTerritory(pixels);
    else this.paintLayer(pixels);
    const spent = before - card.ink;
    if (spent > 0) {
      this.world.version += 1;
      this.markDirty(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    }
    return spent;
  }

  private paintTerritory(pixels: number[]): void {
    const world = this.world;
    const card = this.card;
    const workingId = this.workingCountryId();
    if (workingId === null) return;
    const working = world.countries[workingId];
    const tag = workingId + 1;
    const sourceTag = card.type === 'split' ? (card.targetCountryId as number) + 1 : 0;
    const canTake = (p: number) => world.owner[p] === sourceTag;

    // Extra population on already owned land ("density" brush).
    if (card.type !== 'split' && this.mode === 'repeat') {
      for (const p of pixels) {
        if (card.ink <= 0) break;
        if (world.owner[p] !== tag || strokeMask[p] || world.density[p] >= MAX_DENSITY) continue;
        world.density[p] += 1;
        card.ink -= 1;
        this.touch(p);
      }
    }

    // Grow only from existing territory (by land, or by any coast of a sea the country already touches).
    for (const p of pixels) dabMask[p] = 1;
    const queue: number[] = [];
    const queued = new Set<number>();
    const enqueue = (p: number) => {
      if (!queued.has(p)) {
        queued.add(p);
        queue.push(p);
      }
    };
    const first = working.pixels === 0;
    for (const p of pixels) {
      if (!canTake(p)) continue;
      let linked = first;
      if (!linked) {
        forEachNeighbour(p, (n) => {
          if (world.owner[n] === tag) linked = true;
          else if (card.type !== 'split' && this.seas.size > 0 && world.water.bodyOf[n] >= 0 && this.seas.has(world.water.bodyOf[n])) linked = true;
        });
      }
      if (linked) {
        enqueue(p);
        if (first) break;
      }
    }
    if (queue.length === 0 && !first) {
      this.message =
        card.type === 'split'
          ? 'Раскол рисуется внутри исходной страны, продолжая уже выделенную часть.'
          : 'Продолжайте от своей территории — по суше или через то же море.';
    }
    for (let head = 0; head < queue.length; head += 1) {
      if (card.ink <= 0) break;
      const p = queue[head];
      if (!canTake(p)) continue;
      if (card.type === 'split' && world.countries[card.targetCountryId as number].pixels <= 1) break;
      world.setOwner(p, tag);
      if (card.type !== 'split') {
        world.density[p] = working.density;
        world.culture[p] = world.cultureTable.single(working.cultureId, 100);
        world.religion[p] = this.religionForNewLand;
      }
      card.ink -= 1;
      this.touch(p);
      this.changed.push(p);
      if (card.type !== 'split' && world.water.coastsOf.length > 0) world.seasOfPixel(p, this.seas);
      forEachNeighbour(p, (n) => {
        if (dabMask[n] && canTake(n)) enqueue(n);
      });
    }
    for (const p of pixels) dabMask[p] = 0;
    if (card.type === 'split' && world.countries[card.targetCountryId as number].pixels <= 1) {
      this.message = 'Исходная страна должна сохранить хотя бы часть земель.';
    }
  }

  private paintLayer(pixels: number[]): void {
    const world = this.world;
    const card = this.card;
    const targetTag = card.targetCountryId !== null ? card.targetCountryId + 1 : -1;
    let outside = 0;
    for (const p of pixels) {
      if (card.ink <= 0) break;
      if (strokeMask[p] || (this.mode === 'respect' && cardMask[p])) continue;
      if (targetTag > 0 && world.owner[p] !== targetTag) {
        outside += 1;
        continue;
      }
      if (card.type === 'drought' || card.type === 'rain') {
        const value = world.humidity[p];
        const next = card.type === 'rain' ? Math.min(100, value + CLIMATE_DELTA) : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        world.humidity[p] = next;
      } else if (card.type === 'faith') {
        if (world.owner[p] === 0) continue;
        const next = world.religionTable.convert(world.religion[p], card.newReligionId as number, FAITH_CONVERSION, null);
        if (next === world.religion[p]) continue;
        world.religion[p] = next;
      } else {
        if (world.owner[p] === 0) continue;
        const next = world.cultureTable.convert(world.culture[p], card.newCultureId as number, CULTURE_CONVERSION, card.sourceCultureId);
        if (next === world.culture[p]) continue;
        world.culture[p] = next;
      }
      card.ink -= 1;
      this.touch(p);
      this.changed.push(p);
    }
    if (outside > 0 && this.changed.length === 0) this.message = 'Эта карта действует только на территории выбранной страны.';
  }
}
