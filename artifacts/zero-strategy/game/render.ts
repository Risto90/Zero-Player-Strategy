import type { Rect } from './brush';
import type { CompositionTable } from './composition';
import { BIOMES, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, MAX_DENSITY, PALETTE } from './config';
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

/** Paints the map into a 32-bit pixel buffer for a canvas ImageData. */
export class MapRenderer {
  readonly pixels = new Uint32Array(MAP_PIXELS);
  mode: MapMode = 'political';
  layer: EntityLayer | null = null;
  private dirty: Rect | null = null;
  private countryColors: number[] = [];
  private cultureColors: number[] = [];
  private religionColors: number[] = [];
  private readonly ocean = pack(hexToRgb(PALETTE.ocean));
  private readonly oceanShallow = pack(mix(hexToRgb(PALETTE.ocean), [255, 255, 255], 0.25));
  private readonly unclaimed = hexToRgb(PALETTE.unclaimedLand);
  private readonly biomeRgb = BIOMES.map((b) => hexToRgb(b.color));
  private readonly biomePacked = this.biomeRgb.map(pack);
  private readonly unclaimedByBiome = this.biomeRgb.map((c) => pack(mix(hexToRgb(PALETTE.unclaimedLand), c, 0.22)));
  private readonly unclaimedPacked = pack(hexToRgb(PALETTE.unclaimedLand));
  private compCache = { culture: new Map<number, number>(), religion: new Map<number, number>() };
  private readonly ramps = Object.fromEntries(
    Object.entries(RAMPS).map(([key, stops]) => [key, Array.from({ length: 101 }, (_, v) => pack(rampColor(stops.map(hexToRgb), v / 100)))]),
  ) as Record<keyof typeof RAMPS, number[]>;

  constructor(private readonly world: World) {}

  setView(mode: MapMode, layer: EntityLayer | null): void {
    this.mode = mode;
    this.layer = layer;
    this.markAll();
  }

  markAll(): void {
    this.dirty = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
  }

  mark(rect: Rect): void {
    const r = {
      x0: Math.max(0, rect.x0),
      y0: Math.max(0, rect.y0),
      x1: Math.min(MAP_WIDTH - 1, rect.x1),
      y1: Math.min(MAP_HEIGHT - 1, rect.y1),
    };
    if (!this.dirty) this.dirty = r;
    else
      this.dirty = {
        x0: Math.min(this.dirty.x0, r.x0),
        y0: Math.min(this.dirty.y0, r.y0),
        x1: Math.max(this.dirty.x1, r.x1),
        y1: Math.max(this.dirty.y1, r.y1),
      };
  }

  /** Re-renders the dirty area and returns it (or null if nothing changed). */
  flush(): Rect | null {
    return this.flushSome(Infinity);
  }

  get pending(): boolean {
    return this.dirty !== null;
  }

  /**
   * Re-renders dirty rows from the top for about `budgetMs` milliseconds and returns the rows done.
   * Whatever is left stays dirty for the next call, so a full repaint can be spread over frames.
   */
  flushSome(budgetMs: number): Rect | null {
    const rect = this.dirty;
    if (!rect) return null;
    this.dirty = null;
    this.syncColors();
    this.compCache = { culture: new Map(), religion: new Map() };
    const started = Date.now();
    let y = rect.y0;
    for (; y <= rect.y1; y += 1) {
      for (let x = rect.x0; x <= rect.x1; x += 1) this.pixels[y * MAP_WIDTH + x] = this.colorAt(y * MAP_WIDTH + x, x);
      if ((y & 7) === 7 && y < rect.y1 && Date.now() - started >= budgetMs) break;
    }
    const done = { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: Math.min(y, rect.y1) };
    if (done.y1 < rect.y1) this.mark({ x0: rect.x0, y0: done.y1 + 1, x1: rect.x1, y1: rect.y1 });
    return done;
  }

  private syncColors(): void {
    const w = this.world;
    while (this.countryColors.length < w.countries.length) this.countryColors.push(pack(hexToRgb(w.countries[this.countryColors.length].color)));
    while (this.cultureColors.length < w.cultures.length) this.cultureColors.push(pack(hexToRgb(w.cultures[this.cultureColors.length].color)));
    while (this.religionColors.length < w.religions.length) this.religionColors.push(pack(hexToRgb(w.religions[this.religionColors.length].color)));
    // Entities may be discarded and recreated with new colours at the same id.
    w.countries.forEach((c, i) => (this.countryColors[i] = pack(hexToRgb(c.color))));
    w.cultures.forEach((c, i) => (this.cultureColors[i] = pack(hexToRgb(c.color))));
    w.religions.forEach((c, i) => (this.religionColors[i] = pack(hexToRgb(c.color))));
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

  private colorAt(p: number, x: number): number {
    const w = this.world;
    if (!w.land[p]) {
      const nearLand =
        (x > 0 && w.land[p - 1]) || (x < MAP_WIDTH - 1 && w.land[p + 1]) || (p >= MAP_WIDTH && w.land[p - MAP_WIDTH]) || (p < MAP_PIXELS - MAP_WIDTH && w.land[p + MAP_WIDTH]);
      return nearLand ? this.oceanShallow : this.ocean;
    }
    const owner = w.owner[p];
    let color: number;
    switch (this.mode) {
      case 'political':
        color = owner > 0 ? this.countryColors[owner - 1] : this.unclaimedByBiome[w.biomeAt(p)];
        break;
      case 'biomes':
        color = this.biomePacked[w.biomeAt(p)];
        break;
      case 'cultures':
        color = owner === 0 ? this.unclaimedPacked : this.compColor('culture', w.culture[p]);
        break;
      case 'religions':
        color = owner === 0 ? this.unclaimedPacked : this.compColor('religion', w.religion[p]);
        break;
      case 'density':
        color = owner === 0 ? this.unclaimedPacked : this.ramps.density[Math.round((w.density[p] / MAX_DENSITY) * 100)];
        break;
      default:
        color = this.ramps[this.mode][w[this.mode][p]];
    }
    // Country borders show in every mode; coasts are lightly outlined.
    let border = false;
    let coast = false;
    const check = (n: number) => {
      if (!w.land[n]) coast = true;
      else if (w.owner[n] !== owner && (owner > 0 || w.owner[n] > 0)) border = true;
    };
    if (x > 0) check(p - 1);
    if (x < MAP_WIDTH - 1) check(p + 1);
    if (p >= MAP_WIDTH) check(p - MAP_WIDTH);
    if (p < MAP_PIXELS - MAP_WIDTH) check(p + MAP_WIDTH);
    if (border) return shade(color, this.mode === 'political' ? 0.55 : 0.7);
    if (coast) return shade(color, 0.82);
    return color;
  }

  private compColor(kind: 'culture' | 'religion', comp: number): number {
    const cache = this.compCache[kind];
    let color = cache.get(comp);
    if (color === undefined) {
      color = pack(this.layerOrBlend(kind, comp));
      cache.set(comp, color);
    }
    return color;
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
