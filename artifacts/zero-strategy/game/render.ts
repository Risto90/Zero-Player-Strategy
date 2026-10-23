import type { Rect } from './brush';
import type { CompositionTable } from './composition';
import { BIOMES, biomeFor, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, MAX_DENSITY, PALETTE } from './config';
import type { World } from './world';

export type MapMode = 'political' | 'biomes' | 'cultures' | 'religions' | 'humidity' | 'temperature' | 'drainage' | 'density';
export interface EntityLayer {
  kind: 'culture' | 'religion';
  id: number;
}

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function pack([r, g, b]: RGB): number {
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as RGB;
}

function shade(color: number, factor: number): number {
  const r = (color & 255) * factor;
  const g = ((color >> 8) & 255) * factor;
  const b = ((color >> 16) & 255) * factor;
  return (255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
}

/** Colour ramps for value layers (0–100). */
export const RAMPS: Record<'humidity' | 'temperature' | 'drainage' | 'density', string[]> = {
  humidity: ['#c9a66b', '#d9cf98', '#9fbf8c', '#5f9c8f', '#2f6f86'],
  temperature: ['#eef1f4', '#8fb3cf', '#a9c48b', '#e0c065', '#c96a43'],
  drainage: ['#56756a', '#8aa38c', '#c8c4a0', '#c9a776', '#a8794c'],
  density: ['#efe8d2', '#d8c08c', '#c08a52', '#93512f', '#5e2a1d'],
};

function rampColor(stops: RGB[], t: number): RGB {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}


/** The map is repainted in tiles; a strip is one full-width row of tiles (the unit uploaded to the GPU). */
export const STRIPS = 16;
export const STRIP_H = MAP_HEIGHT / STRIPS;
const TILE_COLS = 8;
const TILE_W = MAP_WIDTH / TILE_COLS;
const TILES = TILE_COLS * STRIPS;

/** Biome for every (humidity, temperature, drainage) triple, filled on first use (255 = not yet known). */
const biomeTable = new Uint8Array(101 * 101 * 101).fill(255);
function biomeOf(h: number, t: number, d: number): number {
  const i = (h * 101 + t) * 101 + d;
  let b = biomeTable[i];
  if (b === 255) {
    b = biomeFor(h, t, d);
    biomeTable[i] = b;
  }
  return b;
}

const MODE_CODE: Record<MapMode, number> = { political: 0, biomes: 1, cultures: 2, religions: 3, density: 4, humidity: 5, temperature: 6, drainage: 7 };

// Neighbour bits of `nb`: which of the 4 neighbours are land, plus whether the pixel touches water.
const LEFT = 1;
const RIGHT = 2;
const UP = 4;
const DOWN = 8;
const COAST = 16;

/** Paints the map into a 32-bit RGBA pixel buffer, a few tiles at a time. */
export class MapRenderer {
  readonly pixels = new Uint32Array(MAP_PIXELS);
  mode: MapMode = 'political';
  layer: EntityLayer | null = null;
  private readonly dirtyTiles = new Uint8Array(TILES);
  private dirtyCount = 0;
  /** Tile index to continue from, so a long repaint walks the map top to bottom. */
  private cursor = 0;
  /** Strips with freshly painted tiles that are not on screen yet. */
  private readonly unsent = new Uint8Array(STRIPS);
  private countryColors: number[] = [];
  private cultureColors: number[] = [];
  private religionColors: number[] = [];
  private colorKey = '';
  /** Colour per composition id (0 = not computed yet); compositions never change once interned. */
  private compCache = { culture: new Int32Array(256), religion: new Int32Array(256) };
  private readonly unclaimed = hexToRgb(PALETTE.unclaimedLand);
  private readonly biomeRgb = BIOMES.map((b) => hexToRgb(b.color));
  private readonly biomePacked = Int32Array.from(this.biomeRgb.map(pack));
  private readonly unclaimedByBiome = Int32Array.from(this.biomeRgb.map((c) => pack(mix(hexToRgb(PALETTE.unclaimedLand), c, 0.22))));
  private readonly unclaimedPacked = pack(hexToRgb(PALETTE.unclaimedLand));
  private readonly ramps = Object.fromEntries(
    Object.entries(RAMPS).map(([key, stops]) => [key, Int32Array.from({ length: 101 }, (_, v) => pack(rampColor(stops.map(hexToRgb), v / 100)))]),
  ) as Record<keyof typeof RAMPS, Int32Array>;
  /** Water never changes: its colours are computed once and copied row by row. */
  private readonly base = new Uint32Array(MAP_PIXELS);
  private readonly nb = new Uint8Array(MAP_PIXELS);

  constructor(private readonly world: World) {
    const land = world.land;
    const ocean = pack(hexToRgb(PALETTE.ocean));
    const shallow = pack(mix(hexToRgb(PALETTE.ocean), [255, 255, 255], 0.25));
    for (let p = 0; p < MAP_PIXELS; p += 1) {
      const x = p % MAP_WIDTH;
      let bits = 0;
      if (x > 0 && land[p - 1]) bits |= LEFT;
      if (x < MAP_WIDTH - 1 && land[p + 1]) bits |= RIGHT;
      if (p >= MAP_WIDTH && land[p - MAP_WIDTH]) bits |= UP;
      if (p < MAP_PIXELS - MAP_WIDTH && land[p + MAP_WIDTH]) bits |= DOWN;
      const neighbours = (x > 0 ? 1 : 0) + (x < MAP_WIDTH - 1 ? 1 : 0) + (p >= MAP_WIDTH ? 1 : 0) + (p < MAP_PIXELS - MAP_WIDTH ? 1 : 0);
      const landNeighbours = (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1) + ((bits >> 3) & 1);
      if (landNeighbours < neighbours) bits |= COAST;
      this.nb[p] = bits;
      if (!land[p]) this.base[p] = bits & (LEFT | RIGHT | UP | DOWN) ? shallow : ocean;
    }
  }

  setView(mode: MapMode, layer: EntityLayer | null): void {
    const same = mode === this.mode && (layer === this.layer || (layer !== null && this.layer !== null && layer.kind === this.layer.kind && layer.id === this.layer.id));
    if (same) return;
    this.mode = mode;
    this.layer = layer;
    this.compCache.culture.fill(0);
    this.compCache.religion.fill(0);
    this.markAll();
  }

  markAll(): void {
    this.dirtyTiles.fill(1);
    this.dirtyCount = TILES;
  }

  /** Marks an area (plus a 1-pixel rim, whose borders may change) for repainting. */
  mark(rect: Rect): void {
    const c0 = Math.max(0, Math.floor((rect.x0 - 1) / TILE_W));
    const c1 = Math.min(TILE_COLS - 1, Math.floor((rect.x1 + 1) / TILE_W));
    const r0 = Math.max(0, Math.floor((rect.y0 - 1) / STRIP_H));
    const r1 = Math.min(STRIPS - 1, Math.floor((rect.y1 + 1) / STRIP_H));
    for (let r = r0; r <= r1; r += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const t = r * TILE_COLS + col;
        if (!this.dirtyTiles[t]) {
          this.dirtyTiles[t] = 1;
          this.dirtyCount += 1;
        }
      }
    }
  }

  get pending(): boolean {
    return this.dirtyCount > 0;
  }

  /** Repaints everything at once (tests and tools). */
  flush(): number[] {
    return this.flushSome(Infinity);
  }

  /**
   * Repaints dirty tiles for about `budgetMs` milliseconds. Returns the strips that are now
   * complete and changed since the last call; a strip is returned only once all its tiles are done.
   */
  flushSome(budgetMs: number): number[] {
    if (this.dirtyCount > 0) {
      this.syncColors();
      const started = Date.now();
      for (let i = 0; i < TILES && this.dirtyCount > 0; i += 1) {
        const t = (this.cursor + i) % TILES;
        if (!this.dirtyTiles[t]) continue;
        this.dirtyTiles[t] = 0;
        this.dirtyCount -= 1;
        const strip = Math.floor(t / TILE_COLS);
        this.paintTile((t % TILE_COLS) * TILE_W, strip * STRIP_H);
        this.unsent[strip] = 1;
        if (Date.now() - started >= budgetMs) {
          this.cursor = (t + 1) % TILES;
          break;
        }
      }
      if (this.dirtyCount === 0) this.cursor = 0;
    }
    const ready: number[] = [];
    for (let s = 0; s < STRIPS; s += 1) {
      if (!this.unsent[s]) continue;
      let clean = true;
      for (let col = 0; col < TILE_COLS; col += 1) if (this.dirtyTiles[s * TILE_COLS + col]) clean = false;
      if (clean) {
        this.unsent[s] = 0;
        ready.push(s);
      }
    }
    return ready;
  }

  private syncColors(): void {
    const w = this.world;
    // Entities may be discarded and recreated with new colours at the same id.
    const key = `${w.countries.map((c) => c.color).join()}|${w.cultures.map((c) => c.color).join()}|${w.religions.map((c) => c.color).join()}`;
    if (key === this.colorKey) return;
    this.colorKey = key;
    this.countryColors = w.countries.map((c) => pack(hexToRgb(c.color)));
    this.cultureColors = w.cultures.map((c) => pack(hexToRgb(c.color)));
    this.religionColors = w.religions.map((c) => pack(hexToRgb(c.color)));
    this.compCache.culture.fill(0);
    this.compCache.religion.fill(0);
  }

  private paintTile(x0: number, y0: number): void {
    const w = this.world;
    const pixels = this.pixels;
    const base = this.base;
    const nb = this.nb;
    const land = w.land;
    const owner = w.owner;
    const humidity = w.humidity;
    const temperature = w.temperature;
    const drainage = w.drainage;
    const density = w.density;
    const culture = w.culture;
    const religion = w.religion;
    const mode = MODE_CODE[this.mode];
    const countryColors = this.countryColors;
    const unclaimedByBiome = this.unclaimedByBiome;
    const biomePacked = this.biomePacked;
    const unclaimedPacked = this.unclaimedPacked;
    const ramp = mode >= 4 ? this.ramps[this.mode as keyof typeof RAMPS] : this.ramps.density;
    const values = mode === 5 ? humidity : mode === 6 ? temperature : drainage;
    const borderShade = mode === 0 ? 0.55 : 0.7;
    const x1 = x0 + TILE_W;
    for (let y = y0; y < y0 + STRIP_H; y += 1) {
      const row = y * MAP_WIDTH;
      pixels.set(base.subarray(row + x0, row + x1), row + x0);
      for (let p = row + x0; p < row + x1; p += 1) {
        if (!land[p]) continue;
        const o = owner[p];
        let color: number;
        if (mode === 0) color = o > 0 ? countryColors[o - 1] : unclaimedByBiome[biomeOf(humidity[p], temperature[p], drainage[p])];
        else if (mode === 1) color = biomePacked[biomeOf(humidity[p], temperature[p], drainage[p])];
        else if (o === 0) color = mode >= 5 ? ramp[values[p]] : unclaimedPacked;
        else if (mode === 2) color = this.compColor('culture', culture[p]);
        else if (mode === 3) color = this.compColor('religion', religion[p]);
        else if (mode === 4) color = ramp[Math.round((density[p] / MAX_DENSITY) * 100)];
        else color = ramp[values[p]];
        // Country borders show in every mode; coasts are lightly outlined.
        const bits = nb[p];
        if (
          ((bits & LEFT) !== 0 && owner[p - 1] !== o) ||
          ((bits & RIGHT) !== 0 && owner[p + 1] !== o) ||
          ((bits & UP) !== 0 && owner[p - MAP_WIDTH] !== o) ||
          ((bits & DOWN) !== 0 && owner[p + MAP_WIDTH] !== o)
        )
          color = shade(color, borderShade);
        else if (bits & COAST) color = shade(color, 0.82);
        pixels[p] = color;
      }
    }
  }

  private compColor(kind: 'culture' | 'religion', comp: number): number {
    let cache = this.compCache[kind];
    if (comp >= cache.length) {
      const grown = new Int32Array(Math.max(comp + 1, cache.length * 2));
      grown.set(cache);
      this.compCache[kind] = grown;
      cache = grown;
    }
    let color = cache[comp];
    if (color === 0) {
      color = pack(this.layerOrBlend(kind, comp));
      cache[comp] = color;
    }
    return color;
  }

  private blend(table: CompositionTable, comp: number, colors: number[], rest: RGB): RGB {
    const entry = table.entries[comp];
    let r = 0;
    let g = 0;
    let b = 0;
    entry.ids.forEach((id, i) => {
      const c = colors[id] ?? 0;
      const t = entry.shares[i] / 100;
      r += (c & 255) * t;
      g += ((c >> 8) & 255) * t;
      b += ((c >> 16) & 255) * t;
    });
    const left = Math.max(0, 1 - entry.total / 100);
    return [Math.round(r + rest[0] * left), Math.round(g + rest[1] * left), Math.round(b + rest[2] * left)];
  }

  private layerOrBlend(kind: 'culture' | 'religion', comp: number): RGB {
    const w = this.world;
    const table = kind === 'culture' ? w.cultureTable : w.religionTable;
    if (this.layer && this.layer.kind === kind) {
      const share = table.shareOf(comp, this.layer.id) / 100;
      const colors = kind === 'culture' ? this.cultureColors : this.religionColors;
      const c = colors[this.layer.id] ?? 0;
      return mix([238, 233, 218], [c & 255, (c >> 8) & 255, (c >> 16) & 255], share);
    }
    return kind === 'culture'
      ? this.blend(table, comp, this.cultureColors, this.unclaimed)
      : this.blend(table, comp, this.religionColors, hexToRgb(PALETTE.noFaith));
  }
}
