import { CLIMATE_DELTA, CULTURE_CONVERSION, FAITH_CONVERSION, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from './config';
import { forEachNeighbour } from './geography';
import type { World } from './world';
import type { GovernmentId, GovernmentModifierId, Person } from './government';
import { GOVERNMENTS } from './government';
import { ColonizationDonorHeap, colonizationPlan, transferColonizationPopulation } from './colonization';

export type CardType = 'create' | 'expand' | 'colonization' | 'split' | 'drought' | 'rain' | 'desertification' | 'swamping' | 'warmCurrent' | 'coldCurrent' | 'warmWind' | 'coldWind' | 'faith' | 'culture' | 'government' | 'succession' | 'election' | 'marriage' | 'birth' | 'death' | 'character' | 'revolt' | 'union';
export interface CardChoice {
  label: string;
  detail: string;
  government?: GovernmentId;
  modifier?: GovernmentModifierId;
  removeModifier?: GovernmentModifierId;
  ruler?: Person;
  person?: Person;
  seatId?: number;
  termYears?: number;
  maxTerms?: number;
  consulCount?: number;
  violent?: boolean;
}
export interface CharacterEvent { kind: 'marriage' | 'birth' | 'death' | 'friendship' | 'trait' | 'engagement' | 'romance'; personIds: number[]; trait?: string; newPerson?: Person }
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
  splitCultureId?: number;
  splitReligionId?: number;
  newGovernmentId: GovernmentId | null;
  newRuler: Person | null;
  choices: CardChoice[] | null;
  selectedChoice: number;
  characterEvent: CharacterEvent | null;
  violentReform?: boolean;
  developmentOnly?: boolean;
  /** A pixel where the card certainly applies (used by automatic play). */
  hint: number;
}

export function brushOptionFor(card: Card | null): BrushOption {
  if (!card) return null;
  if (card.type === 'create' || card.type === 'expand') return 'density';
  if (['drought', 'rain', 'desertification', 'swamping', 'warmCurrent', 'coldCurrent', 'warmWind', 'coldWind', 'faith', 'culture'].includes(card.type)) return 'repeat';
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

const isCurrent = (type: CardType) => type === 'warmCurrent' || type === 'coldCurrent';
const isWind = (type: CardType) => type === 'warmWind' || type === 'coldWind';
const isTemperatureCard = (type: CardType) => isCurrent(type) || isWind(type);

/** Applies one card to the world, brush dab by brush dab, spending its ink. */
export class CardPainter {
  /** Pixels changed by this card (for automatic play and logs). */
  readonly changed: number[] = [];
  /** Total population moved by a colonization card. */
  colonistsMoved = 0;
  private readonly cardTouched: number[] = [];
  private strokeTouched: number[] = [];
  private readonly seas = new Set<number>();
  private strokeClimateChanges: { p: number; value: number; cost: number; wasInCard: boolean }[] = [];
  private strokeChangedStart = 0;
  private readonly religionForNewLand: number;
  readonly colonizationMask: Uint8Array | null;
  readonly colonizationAnchors: Uint8Array | null;
  private readonly colonizationConnected: Uint8Array | null;
  private readonly colonizationDonors: ColonizationDonorHeap | null;
  readonly extraDirty: Rect[] = [];
  private readonly dirtyTileKeys = new Set<number>();
  dirty: Rect | null = null;
  message = '';

  constructor(
    private readonly world: World,
    readonly card: Card,
    public mode: BrushMode,
  ) {
    const working = this.workingCountryId();
    const colonizationCountry = card.type === 'colonization' && card.targetCountryId !== null
      ? world.countries[card.targetCountryId]
      : null;
    const colonization = colonizationCountry ? colonizationPlan(world, colonizationCountry) : null;
    this.colonizationMask = colonization?.targets ?? null;
    this.colonizationAnchors = colonization?.anchors ?? null;
    this.colonizationConnected = colonization?.connectedTerritory.slice() ?? null;
    this.colonizationDonors = colonization ? new ColonizationDonorHeap(world, colonization.donors) : null;
    if (working !== null && (card.type === 'expand' || card.type === 'split')) {
      const source = world.countries[card.type === 'split' ? (card.targetCountryId as number) : working];
      if (card.type === 'expand') {
        world.forEachCountryPixel(source, (p) => world.seasOfPixel(p, this.seas));
      }
    }
    const country = working !== null
      ? world.countries[working]
      : isWind(card.type) && card.targetCountryId !== null
        ? world.countries[card.targetCountryId]
        : null;
    if (country && isWind(card.type)) world.forEachCountryPixel(country, (p) => world.seasOfPixel(p, this.seas));
    this.religionForNewLand =
      country && country.religionId !== null ? world.religionTable.single(country.religionId, 60) : 0;
  }

  /** Country whose territory grows: the new state for create/split, the owner for expand. */
  workingCountryId(): number | null {
    const card = this.card;
    if (card.type === 'create' || card.type === 'split') return card.newCountryId;
    if (card.type === 'expand' || card.type === 'colonization') return card.targetCountryId;
    return null;
  }

  endStroke(): void {
    for (const p of this.strokeTouched) strokeMask[p] = 0;
    this.strokeTouched = [];
    this.strokeClimateChanges = [];
    this.strokeChangedStart = this.changed.length;
  }

  clearExtraDirtyTiles(): void {
    this.dirtyTileKeys.clear();
  }

  /** Roll back a wind stroke whose finger was released over water instead of home territory. */
  cancelStroke(): void {
    for (const change of this.strokeClimateChanges) {
      this.world.temperature[change.p] = change.value;
      this.card.ink += change.cost;
      cardMask[change.p] = change.wasInCard ? 1 : 0;
      const x = change.p % MAP_WIDTH, y = Math.floor(change.p / MAP_WIDTH);
      this.markDirty(x - 1, y - 1, x + 1, y + 1);
    }
    this.changed.length = this.strokeChangedStart;
    for (const p of this.strokeTouched) strokeMask[p] = 0;
    this.strokeTouched = [];
    this.strokeClimateChanges = [];
    this.message = 'Ветер можно закончить только на суше своей страны. Проведите мазок от своего берега к своему берегу.';
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
        if (this.world.land[p] || (isCurrent(card.type) && this.world.water.bodyOf[p] >= 0) ||
          (isWind(card.type) && this.seas.has(this.world.water.bodyOf[p]))) pixels.push(p);
      }
    }
    if (pixels.length === 0) return 0;
    const before = card.ink;
    const changedStart = this.changed.length;
    if (card.type === 'create' || card.type === 'expand' || card.type === 'colonization' || card.type === 'split') this.paintTerritory(pixels);
    else this.paintLayer(pixels);
    const spent = before - card.ink;
    if (spent > 0) {
      this.world.version += 1;
      if (card.type === 'colonization') {
        for (let i = changedStart; i < this.changed.length; i += 1) this.markDirtyPixel(this.changed[i]);
      } else this.markDirty(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
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
    const canTake = (p: number) => {
      if (card.type === 'colonization') {
        return this.colonizationMask?.[p] === 1 && world.owner[p] !== tag;
      }
      if (world.owner[p] !== sourceTag) return false;
      if (card.type !== 'split' || (card.splitCultureId === undefined && card.splitReligionId === undefined)) return true;
      const cultureMatch = card.splitCultureId !== undefined && world.cultureTable.shareOf(world.culture[p], card.splitCultureId) > 0;
      const faithShare = card.splitReligionId === -1 ? 100 - world.religionTable.entries[world.religion[p]].total :
        card.splitReligionId !== undefined ? world.religionTable.shareOf(world.religion[p], card.splitReligionId) : 0;
      const faithMatch = faithShare > 0;
      return cultureMatch || faithMatch;
    };

    // Extra population on already owned land ("density" brush).
    if (card.type !== 'split' && card.type !== 'colonization' && this.mode === 'repeat') {
      for (const p of pixels) {
        if (card.ink <= 0) break;
        if (world.owner[p] !== tag || strokeMask[p]) continue;
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
    const first = card.type !== 'colonization' && working.pixels === 0;
    for (const p of pixels) {
      if (!canTake(p)) continue;
      let linked = first;
      if (card.type === 'colonization') {
        linked = this.colonizationAnchors?.[p] === 1;
        if (!linked) {
          forEachNeighbour(p, (n) => {
            if (this.colonizationConnected?.[n]) linked = true;
          });
        }
      } else if (!linked) {
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
            : card.type === 'colonization'
              ? 'Начните колонию у побережья или реки либо продолжайте от уже связанной с ними территории.'
          : 'Продолжайте от своей территории — по суше или через то же море.';
    }
    for (let head = 0; head < queue.length; head += 1) {
      if (card.ink <= 0) break;
      const p = queue[head];
      if (!canTake(p)) continue;
      if (card.type === 'split' && world.countries[card.targetCountryId as number].pixels <= 1) break;
      if (card.type === 'colonization') {
        const donor = this.colonizationDonors?.peek() ?? -1;
        if (donor < 0) {
          this.message = 'У страны больше нет населения для переселения.';
          break;
        }
        const transfer = transferColonizationPopulation(world, donor, p, card.ink);
        if (!transfer) {
          this.message = 'На этом участке нельзя переселить население без превышения плотности донора.';
          break;
        }
        this.colonizationDonors?.refreshTop(donor);
        world.setOwner(p, tag);
        this.colonizationDonors?.add(p);
        if (this.colonizationConnected) this.colonizationConnected[p] = 1;
        this.colonistsMoved += transfer.amount;
        card.ink = Math.max(0, card.ink - transfer.ink);
        this.touch(p);
        this.changed.push(p);
        this.markDirtyPixel(donor);
        forEachNeighbour(p, (n) => {
          if (dabMask[n] && canTake(n)) enqueue(n);
        });
        continue;
      }
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

  private markDirtyPixel(p: number): void {
    const tileCols = 8, tileRows = 16;
    const tileWidth = MAP_WIDTH / tileCols, tileHeight = MAP_HEIGHT / tileRows;
    const x = p % MAP_WIDTH, y = Math.floor(p / MAP_WIDTH);
    const col = Math.floor(x / tileWidth), row = Math.floor(y / tileHeight);
    const key = row * tileCols + col;
    if (this.dirtyTileKeys.has(key)) return;
    this.dirtyTileKeys.add(key);
    this.extraDirty.push({
      x0: Math.floor(col * tileWidth), y0: Math.floor(row * tileHeight),
      x1: Math.floor((col + 1) * tileWidth) - 1, y1: Math.floor((row + 1) * tileHeight) - 1,
    });
  }

  private paintLayer(pixels: number[]): void {
    const world = this.world;
    const card = this.card;
    const targetTag = card.targetCountryId !== null ? card.targetCountryId + 1 : -1;
    let outside = 0;
    for (const p of pixels) {
      if (card.ink <= 0) break;
      if (strokeMask[p] || (this.mode === 'respect' && cardMask[p])) continue;
      const onLand = world.land[p] === 1;
      if (isWind(card.type)) {
        if (onLand && world.owner[p] !== targetTag) { outside += 1; continue; }
        if (!onLand && !this.seas.has(world.water.bodyOf[p])) continue;
      } else if (targetTag > 0 && world.owner[p] !== targetTag) {
        outside += 1;
        continue;
      }
      if (card.type === 'drought' || card.type === 'rain') {
        const value = world.humidity[p];
        const next = card.type === 'rain' ? Math.min(100, value + CLIMATE_DELTA) : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        world.humidity[p] = next;
      } else if (card.type === 'desertification' || card.type === 'swamping') {
        const value = world.drainage[p];
        const next = card.type === 'desertification' ? Math.min(100, value + CLIMATE_DELTA) : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        world.drainage[p] = next;
      } else if (isTemperatureCard(card.type)) {
        const value = world.temperature[p];
        const next = card.type === 'warmCurrent' || card.type === 'warmWind'
          ? Math.min(100, value + CLIMATE_DELTA)
          : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        const cost = isWind(card.type) && !onLand ? 0.5 : 1;
        if (isWind(card.type)) this.strokeClimateChanges.push({ p, value, cost, wasInCard: cardMask[p] === 1 });
        world.temperature[p] = next;
        card.ink -= cost;
        this.touch(p);
        this.changed.push(p);
        continue;
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
