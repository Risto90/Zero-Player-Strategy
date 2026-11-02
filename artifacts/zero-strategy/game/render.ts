import type { Rect } from './brush';
import type { CompositionTable } from './composition';
import { BIOMES, biomeFor, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, PALETTE } from './config';
import { HUMAN_ORIGINS, HUMAN_ORIGIN_COLORS } from './human';
import { ensureCityPopulationGroups } from './settlements';
import type { World } from './world';

export type MapMode = 'political' | 'biomes' | 'cultures' | 'religions' | 'humidity' | 'temperature' | 'drainage' | 'density' | 'elevation' | 'cities' | 'origins';
export interface EntityLayer {
  kind: 'culture' | 'religion' | 'origin';
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

/** Морская батиметрия остаётся видна под всеми тематическими слоями карты. */
export const SEA_DEPTH_RAMP = ['#17374d', '#24526b', '#39748a', '#8bb5b3'] as const;
export const ELEVATION_COLOR_STOPS: readonly [number, string][] = [
  [-11000, '#143046'],
  [-4000, '#326582'],
  [-200, '#84b6be'],
  [0, '#dcd3b2'],
  [500, '#769d69'],
  [1500, '#aa9d69'],
  [3000, '#946c4e'],
  [6000, '#d4cbb8'],
  [8800, '#f7f5ee'],
];
const SEA_DEPTH_STOPS: readonly [number, RGB][] = [
  [0, hexToRgb(SEA_DEPTH_RAMP[3])],
  [1000, hexToRgb(SEA_DEPTH_RAMP[2])],
  [5000, hexToRgb(SEA_DEPTH_RAMP[1])],
  [11000, hexToRgb(SEA_DEPTH_RAMP[0])],
];

function seaDepthColor(depthMeters: number): number {
  const depth = Math.max(0, Math.min(11000, depthMeters));
  let stop = 1;
  while (stop < SEA_DEPTH_STOPS.length - 1 && depth > SEA_DEPTH_STOPS[stop][0]) stop += 1;
  const [shallowDepth, shallowColor] = SEA_DEPTH_STOPS[stop - 1];
  const [deepDepth, deepColor] = SEA_DEPTH_STOPS[stop];
  return pack(mix(shallowColor, deepColor, (depth - shallowDepth) / (deepDepth - shallowDepth)));
}

const SEA_DEPTH_COLORS = Int32Array.from(
  { length: 11001 },
  (_, depth) => seaDepthColor(depth),
);

export function seaDepthPackedColor(elevation: number): number {
  const depth = Math.max(0, Math.min(11000, -elevation));
  return SEA_DEPTH_COLORS[depth];
}

export function elevationPackedColor(elevation: number): number {
  const bounded = Math.max(ELEVATION_COLOR_STOPS[0][0], Math.min(
    ELEVATION_COLOR_STOPS[ELEVATION_COLOR_STOPS.length - 1][0],
    elevation,
  ));
  let stop = 1;
  while (stop < ELEVATION_COLOR_STOPS.length - 1 && bounded > ELEVATION_COLOR_STOPS[stop][0]) stop += 1;
  const [lowHeight, lowHex] = ELEVATION_COLOR_STOPS[stop - 1];
  const [highHeight, highHex] = ELEVATION_COLOR_STOPS[stop];
  const amount = (bounded - lowHeight) / (highHeight - lowHeight);
  return pack(mix(hexToRgb(lowHex), hexToRgb(highHex), amount));
}

/** Colour ramps for value layers (0–100). */
export const RAMPS: Record<'humidity' | 'temperature' | 'drainage' | 'density' | 'elevation', string[]> = {
  humidity: ['#c9a66b', '#d9cf98', '#9fbf8c', '#5f9c8f', '#2f6f86'],
  temperature: ['#eef1f4', '#8fb3cf', '#a9c48b', '#e0c065', '#c96a43'],
  drainage: ['#56756a', '#8aa38c', '#c8c4a0', '#c9a776', '#a8794c'],
  density: ['#efe8d2', '#d8c08c', '#c08a52', '#93512f', '#5e2a1d'],
  elevation: ELEVATION_COLOR_STOPS.filter(([height]) => height >= 0).map(([, color]) => color),
};

export const CITY_COLORS = ['#a66f3d', '#bf6741', '#b2493e', '#8f3036', '#672433', '#431c2e'] as const;

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

const MODE_CODE: Record<MapMode, number> = { political: 0, biomes: 1, cultures: 2, religions: 3, humidity: 5, temperature: 6, drainage: 7, density: 4, elevation: 8, cities: 9, origins: 11 };

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
  private selectedCountryId: number | null = null;
  private readonly dirtyTiles = new Uint8Array(TILES);
  private dirtyCount = 0;
  /** Tile index to continue from, so a long repaint walks the map top to bottom. */
  private cursor = 0;
  /** Strips with freshly painted tiles that are not on screen yet. */
  private readonly unsent = new Uint8Array(STRIPS);
  private countryColors: number[] = [];
  private cultureColors: number[] = [];
  private religionColors: number[] = [];
  private nomadColors: number[] = [];
  private readonly nomadRaster = new Uint32Array(MAP_PIXELS);
  private readonly selectedNomadRaster = new Uint8Array(MAP_PIXELS);
  private readonly nomadDensity = new Float32Array(MAP_PIXELS);
  private nomadRasterVersion = -1;
  private originRasterVersion = -1;
  private readonly originRaster = new Uint8Array(MAP_PIXELS);
  private readonly originComputed = new Uint8Array(MAP_PIXELS);
  private readonly nomadOriginScores = new Map<number, Float64Array>();
  private readonly originColors = HUMAN_ORIGINS.map((origin) => pack(hexToRgb(HUMAN_ORIGIN_COLORS[origin.id])));
  private cityColors = CITY_COLORS.map((color) => pack(hexToRgb(color)));
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

  constructor(private readonly world: World, deferPreparation = false) {
    if (!deferPreparation) this.prepareSync();
  }

  private preparePixel(p: number, land: Uint8Array, ocean: number, shallow: number): void {
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

  private prepareSync(): void {
    const land = this.world.land;
    const ocean = pack(hexToRgb(PALETTE.ocean));
    const shallow = pack(mix(hexToRgb(PALETTE.ocean), [255, 255, 255], 0.25));
    for (let p = 0; p < MAP_PIXELS; p += 1) {
      this.preparePixel(p, land, ocean, shallow);
    }
  }

  async prepareCooperative(): Promise<void> {
    const land = this.world.land;
    const ocean = pack(hexToRgb(PALETTE.ocean));
    const shallow = pack(mix(hexToRgb(PALETTE.ocean), [255, 255, 255], 0.25));
    for (let start = 0; start < MAP_PIXELS; start += 16_384) {
      const end = Math.min(MAP_PIXELS, start + 16_384);
      for (let p = start; p < end; p += 1) this.preparePixel(p, land, ocean, shallow);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  setView(mode: MapMode, layer: EntityLayer | null): void {
    const same = mode === this.mode &&
      (layer === this.layer || (layer !== null && this.layer !== null && layer.kind === this.layer.kind && layer.id === this.layer.id));
    if (same) return;
    this.mode = mode;
    this.layer = layer;
    this.compCache.culture.fill(0);
    this.compCache.religion.fill(0);
    this.markAll();
  }

  setSelectedCountry(countryId: number | null): void {
    if (countryId === this.selectedCountryId) return;
    this.markSelectedCountry(this.selectedCountryId);
    this.selectedCountryId = countryId;
    this.selectedNomadRaster.fill(0);
    const country = countryId === null ? null : this.world.countries[countryId];
    if (country?.type === 'nomadic') {
      for (const pixel of country.range ?? []) {
        if (pixel >= 0 && pixel < MAP_PIXELS) this.selectedNomadRaster[pixel] = 1;
      }
      for (const cell of country.cells ?? []) {
        if (cell.pixel >= 0 && cell.pixel < MAP_PIXELS) this.selectedNomadRaster[cell.pixel] = 1;
      }
    }
    this.markSelectedCountry(countryId);
  }

  private markSelectedCountry(countryId: number | null): void {
    if (countryId === null) return;
    const country = this.world.countries[countryId];
    if (!country) return;
    if (country.type === 'settled') {
      if (country.pixels > 0) {
        const [x0, y0, x1, y1] = country.box;
        this.mark({ x0, y0, x1, y1 });
      }
      return;
    }
    let x0 = MAP_WIDTH, y0 = MAP_HEIGHT, x1 = -1, y1 = -1;
    const include = (pixel: number) => {
      if (pixel < 0 || pixel >= MAP_PIXELS) return;
      const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    };
    for (const pixel of country.range ?? []) include(pixel);
    for (const cell of country.cells ?? []) include(cell.pixel);
    if (x1 >= x0 && y1 >= y0) this.mark({ x0, y0, x1, y1 });
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
    if (key !== this.colorKey) {
      this.colorKey = key;
      this.countryColors = w.countries.map((c) => pack(hexToRgb(c.color)));
      this.cultureColors = w.cultures.map((c) => pack(hexToRgb(c.color)));
      this.religionColors = w.religions.map((c) => pack(hexToRgb(c.color)));
      this.compCache.culture.fill(0);
      this.compCache.religion.fill(0);
      this.nomadRasterVersion = -1;
    }
    if (this.nomadRasterVersion !== w.version) {
      this.nomadRaster.fill(0);
      this.nomadDensity.fill(0);
      for (const nomad of w.countries) {
        if (nomad.type !== 'nomadic') continue;
        const color = this.countryColors[nomad.id] ?? pack(hexToRgb(nomad.color));
        for (const p of nomad.range ?? []) {
          if (p < 0 || p >= MAP_PIXELS || !w.land[p]) continue;
          const old = this.nomadRaster[p];
          this.nomadRaster[p] = old
            ? pack(mix([old & 255, (old >> 8) & 255, (old >> 16) & 255], [color & 255, (color >> 8) & 255, (color >> 16) & 255], 0.5))
            : color;
        }
        for (const cell of nomad.cells ?? []) {
          if (cell.pixel < 0 || cell.pixel >= MAP_PIXELS || !w.land[cell.pixel]) continue;
          this.nomadDensity[cell.pixel] += cell.population;
          const old = this.nomadRaster[cell.pixel];
          this.nomadRaster[cell.pixel] = old
            ? pack(mix([old & 255, (old >> 8) & 255, (old >> 16) & 255], [color & 255, (color >> 8) & 255, (color >> 16) & 255], 0.75))
            : color;
        }
      }
      this.nomadRasterVersion = w.version;
    }
    if (this.originRasterVersion !== w.version) this.prepareOriginRaster();
  }

  private prepareOriginRaster(): void {
    const w = this.world;
    this.originRaster.fill(0);
    this.originComputed.fill(0);
    this.nomadOriginScores.clear();
    for (const country of w.countries) {
      if (country.type !== 'nomadic') continue;
      for (const cell of country.cells ?? []) {
        if (!(cell.population > 0) || cell.pixel < 0 || cell.pixel >= MAP_PIXELS || !w.land[cell.pixel]) continue;
        const entry = w.humanOriginTable.entries[cell.humanOriginMix];
        if (entry?.total !== 100) continue;
        const scores = this.nomadOriginScores.get(cell.pixel) ?? new Float64Array(HUMAN_ORIGINS.length);
        this.addTableMix(scores, entry, cell.population);
        this.nomadOriginScores.set(cell.pixel, scores);
      }
    }
    this.originRasterVersion = w.version;
  }

  private addTableMix(scores: Float64Array, entry: { ids: number[]; shares: number[] }, population: number): void {
    entry.ids.forEach((id, index) => {
      if (HUMAN_ORIGINS[id]) scores[id] += population * (entry.shares[index] ?? 0) / 100;
    });
  }

  private originAt(pixel: number): number {
    if (this.originComputed[pixel]) return this.originRaster[pixel];
    const w = this.world;
    const city = w.cityAt(pixel);
    const nomadScores = this.nomadOriginScores.get(pixel);
    let scores: Float64Array | null = null;
    if (city || nomadScores) {
      scores = new Float64Array(HUMAN_ORIGINS.length);
      if (city) {
        for (const group of ensureCityPopulationGroups(w, city)) {
          if (!(group.population > 0)) continue;
          const entry = w.humanOriginTable.entries[group.humanOriginMix];
          if (entry?.total === 100) this.addTableMix(scores, entry, group.population);
        }
      } else if (w.owner[pixel] > 0 && w.density[pixel] > 0) {
        const entry = w.humanOriginTable.entries[w.humanOrigins[pixel]];
        if (entry?.total === 100) this.addTableMix(scores, entry, w.density[pixel]);
      }
      if (nomadScores) {
        for (let index = 0; index < scores.length; index += 1) scores[index] += nomadScores[index];
      }
    } else if (w.owner[pixel] > 0 && w.density[pixel] > 0) {
      const entry = w.humanOriginTable.entries[w.humanOrigins[pixel]];
      if (entry?.total === 100) {
        let leading = 0;
        for (let index = 1; index < entry.ids.length; index += 1) {
          if (entry.shares[index] > entry.shares[leading]) leading = index;
        }
        this.originRaster[pixel] = entry.ids[leading] + 1;
      }
    }
    if (scores) {
      let leading = 0;
      for (let index = 1; index < scores.length; index += 1) {
        if (scores[index] > scores[leading]) leading = index;
      }
      if (scores[leading] > 0) this.originRaster[pixel] = leading + 1;
    }
    this.originComputed[pixel] = 1;
    return this.originRaster[pixel];
  }

  private originShareAt(pixel: number, originId: number): number {
    if (!HUMAN_ORIGINS[originId]) return 0;
    const w = this.world;
    let population = 0;
    let selectedPopulation = 0;
    const addMix = (mixId: number, amount: number) => {
      if (!(amount > 0)) return;
      const entry = w.humanOriginTable.entries[mixId];
      if (entry?.total !== 100) return;
      population += amount;
      entry.ids.forEach((id, index) => {
        if (id === originId) selectedPopulation += amount * (entry.shares[index] ?? 0) / 100;
      });
    };

    const city = w.cityAt(pixel);
    if (city) {
      for (const group of ensureCityPopulationGroups(w, city)) {
        addMix(group.humanOriginMix, group.population);
      }
    } else if (w.owner[pixel] > 0 && w.density[pixel] > 0) {
      addMix(w.humanOrigins[pixel], w.density[pixel]);
    }

    const nomadScores = this.nomadOriginScores.get(pixel);
    if (nomadScores) {
      for (let index = 0; index < nomadScores.length; index += 1) population += nomadScores[index];
      selectedPopulation += nomadScores[originId];
    }
    return population > 0 ? selectedPopulation / population : 0;
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
      const ramp = mode >= 4 && mode <= 7 ? this.ramps[this.mode as keyof typeof RAMPS] : this.ramps.density;
    const values = mode === 5 ? humidity : mode === 6 ? temperature : drainage;
    const scalarContours = mode >= 5 && mode <= 7
      ? w.contours.layer(mode === 5 ? 'humidity' : mode === 6 ? 'temperature' : 'drainage') : null;
    const borderShade = mode === 0 ? 0.55 : 0.7;
    const x1 = x0 + TILE_W;
    const selectedCountry = this.selectedCountryId === null ? null : w.countries[this.selectedCountryId];
    for (let y = y0; y < y0 + STRIP_H; y += 1) {
      const row = y * MAP_WIDTH;
      if (scalarContours) {
        for (const span of scalarContours.row(y)) {
          if (span.start >= x1) break;
          if (span.end <= x0) continue;
          pixels.fill(ramp[span.value], row + Math.max(x0, span.start), row + Math.min(x1, span.end));
        }
      } else pixels.set(base.subarray(row + x0, row + x1), row + x0);
      for (let p = row + x0; p < row + x1; p += 1) {
        if (!land[p]) {
          const depth = Math.max(0, Math.min(11000, -w.elevation[p]));
          pixels[p] = SEA_DEPTH_COLORS[depth];
          continue;
        }
        const o = owner[p];
        const selected = mode === 0 && !!selectedCountry && (
          selectedCountry.type === 'nomadic' ? this.selectedNomadRaster[p] === 1 : o === selectedCountry.id + 1
        );
        let color: number;
        if (mode === 11) {
          if (this.layer?.kind === 'origin') {
            const packed = this.originColors[this.layer.id] ?? this.unclaimedPacked;
            const selectedColor = [packed & 255, (packed >> 8) & 255, (packed >> 16) & 255] as RGB;
            color = pack(mix([238, 233, 218], selectedColor, this.originShareAt(p, this.layer.id)));
          } else {
            const origin = this.originAt(p);
            color = origin ? this.originColors[origin - 1] : unclaimedByBiome[biomeOf(humidity[p], temperature[p], drainage[p])];
          }
        }
        else if (mode === 8) color = unclaimedPacked;
        else if (mode === 0) {
          color = o > 0 ? countryColors[o - 1] : unclaimedByBiome[biomeOf(humidity[p], temperature[p], drainage[p])];
          if (!selected && this.nomadRaster[p] && ((p % MAP_WIDTH + Math.floor(p / MAP_WIDTH)) % 7 < 3)) {
            const nomad = this.nomadRaster[p];
            color = pack(mix(
              [color & 255, (color >> 8) & 255, (color >> 16) & 255],
              [nomad & 255, (nomad >> 8) & 255, (nomad >> 16) & 255],
              0.48,
            ));
          }
        }
        else if (mode === 9) {
          const cityId = w.cityIdAt[p];
          const city = cityId >= 0 ? w.cities[cityId] : null;
          color = city ? this.cityColors[city.rank - 1] : o > 0 ? countryColors[o - 1] : unclaimedByBiome[biomeOf(humidity[p], temperature[p], drainage[p])];
        } else if (mode === 1) color = biomePacked[biomeOf(humidity[p], temperature[p], drainage[p])];
        else if (o === 0 && mode !== 4) color = scalarContours ? pixels[p] : unclaimedPacked;
        else if (mode === 2) color = this.compColor('culture', culture[p]);
        else if (mode === 3) color = this.compColor('religion', religion[p]);
        else if (mode === 4) color = ramp[Math.min(100, Math.round(Math.log1p(density[p] + this.nomadDensity[p]) * 12))];
        else color = scalarContours ? pixels[p] : ramp[values[p]];
        // На слое высот рельеф рисуется отдельной 3D-сеткой без политических границ.
        const bits = nb[p];
        const boundary = (
          ((bits & LEFT) !== 0 && owner[p - 1] !== o) ||
          ((bits & RIGHT) !== 0 && owner[p + 1] !== o) ||
          ((bits & UP) !== 0 && owner[p - MAP_WIDTH] !== o) ||
          ((bits & DOWN) !== 0 && owner[p + MAP_WIDTH] !== o)
        );
        const selectedBoundary = selected && (
          !this.isSelectedCountryPixel(p - 1) || !this.isSelectedCountryPixel(p + 1) ||
          !this.isSelectedCountryPixel(p - MAP_WIDTH) || !this.isSelectedCountryPixel(p + MAP_WIDTH)
        );
        if (mode !== 8 && boundary) color = shade(color, borderShade);
        else if (mode !== 8 && (bits & COAST)) color = shade(color, 0.82);
        pixels[p] = mode === 0 && selected && selectedCountry
          ? selectedBoundary ? pack([250, 230, 177]) : countryColors[selectedCountry.id] ?? color
          : color;
      }
    }
  }

  private isSelectedCountryPixel(pixel: number): boolean {
    if (pixel < 0 || pixel >= MAP_PIXELS) return false;
    const country = this.selectedCountryId === null ? null : this.world.countries[this.selectedCountryId];
    if (!country) return false;
    return country.type === 'nomadic'
      ? this.selectedNomadRaster[pixel] === 1
      : this.world.owner[pixel] === country.id + 1;
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
