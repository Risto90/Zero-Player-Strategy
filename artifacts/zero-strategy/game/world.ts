import { CompositionTable } from './composition';
import { biomeFor, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, NAMES, PALETTE } from './config';
import {
  decodeEarthLand,
  forEachNeighbour,
  generateClimate,
  generateRivers,
  labelWater,
  makeRandomLand,
  type MapKind,
  type WaterInfo,
  WORLD_SEED,
} from './geography';
import { randomItem } from './random';
import { initialGovernment, randomNameStyle, randomSurnameAffix, type GovernmentId, type NameStyleId, type Person, type PoliticalState, type SurnameAffix } from './government';

export interface Country extends PoliticalState {
  id: number;
  name: string;
  color: string;
  rank: string;
  /** Population per pixel given to newly settled land. */
  density: number;
  cultureId: number;
  religionId: number | null;
  foundedYear: number;
  parentId: number | null;
  /** Pixel count, kept up to date while painting. */
  pixels: number;
  /** Bounding box that contains all of the country's pixels (may be larger after losses). */
  box: [number, number, number, number];
}

export interface Culture {
  id: number;
  name: string;
  /** Persistent naming convention selected when this culture was founded. */
  nameStyleId?: NameStyleId;
  /** One fixed family-name prefix or ending for this culture. */
  surnameAffix?: SurnameAffix;
  color: string;
  parentId: number | null;
  foundedYear: number;
  traits?: string[];
}

export type Religion = Culture;

/** The whole map: static geography plus working rasters for every layer. */
export class World {
  readonly land: Uint8Array;
  readonly water: WaterInfo;
  /** Land pixel indices, for random sampling. */
  readonly landIndex: Int32Array;
  /** Deterministic hydrology layer; 0 = no river, 1 = tributary, 2–3 = large channel. */
  readonly rivers: Uint8Array;
  readonly riverPixelCount: number;
  readonly majorRiverPixelCount: number;
  readonly owner = new Uint16Array(MAP_PIXELS);
  readonly density = new Float32Array(MAP_PIXELS);
  humidity: Uint8Array;
  temperature: Uint8Array;
  drainage: Uint8Array;
  readonly culture = new Uint16Array(MAP_PIXELS);
  readonly religion = new Uint16Array(MAP_PIXELS);
  readonly cultureTable = new CompositionTable();
  readonly religionTable = new CompositionTable();
  countries: Country[] = [];
  cultures: Culture[] = [];
  religions: Religion[] = [];
  people: Person[] = [];
  /** Bumped on every map change; caches compare against it. */
  version = 0;

  constructor(
    readonly mapKind: MapKind,
    readonly seed: number,
    land: Uint8Array,
    climate: { humidity: Uint8Array; temperature: Uint8Array; drainage: Uint8Array } | null,
  ) {
    this.land = land;
    this.water = labelWater(land);
    this.rivers = generateRivers(land, seed, mapKind);
    let riverPixelCount = 0, majorRiverPixelCount = 0;
    for (const strength of this.rivers) {
      if (strength > 0) riverPixelCount += 1;
      if (strength >= 2) majorRiverPixelCount += 1;
    }
    this.riverPixelCount = riverPixelCount;
    this.majorRiverPixelCount = majorRiverPixelCount;
    const index: number[] = [];
    for (let p = 0; p < MAP_PIXELS; p += 1) if (land[p]) index.push(p);
    this.landIndex = Int32Array.from(index);
    const generated = climate ?? generateClimate(land, seed);
    this.humidity = generated.humidity;
    this.temperature = generated.temperature;
    this.drainage = generated.drainage;
  }

  static create(mapKind: MapKind, seed?: number): World {
    const actualSeed = mapKind === 'world' ? WORLD_SEED : (seed ?? Math.floor(Math.random() * 2 ** 31));
    const land = mapKind === 'world' ? decodeEarthLand() : makeRandomLand(actualSeed);
    return new World(mapKind, actualSeed, land, null);
  }

  biomeAt(p: number): number {
    return biomeFor(this.humidity[p], this.temperature[p], this.drainage[p]);
  }

  isCoastal(p: number): boolean {
    let coastal = false;
    forEachNeighbour(p, (n) => {
      if (!this.land[n]) coastal = true;
    });
    return coastal;
  }

  seasOfPixel(p: number, into: Set<number>): void {
    forEachNeighbour(p, (n) => {
      const body = this.water.bodyOf[n];
      if (body >= 0) into.add(body);
    });
  }

  setOwner(p: number, id: number): void {
    const previous = this.owner[p];
    if (previous === id) return;
    if (previous > 0) this.countries[previous - 1].pixels -= 1;
    this.owner[p] = id;
    if (id > 0) {
      const country = this.countries[id - 1];
      country.pixels += 1;
      const x = p % MAP_WIDTH;
      const y = (p - x) / MAP_WIDTH;
      const box = country.box;
      if (country.pixels === 1) {
        country.box = [x, y, x, y];
      } else {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
    }
  }

  /** Visits every pixel of a country (scans its bounding box). */
  forEachCountryPixel(country: Country, visit: (p: number) => void): void {
    if (country.pixels <= 0) return;
    const [x0, y0, x1, y1] = country.box;
    const tag = country.id + 1;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const p = y * MAP_WIDTH + x;
        if (this.owner[p] === tag) visit(p);
      }
    }
  }

  /** Recomputes counts and boxes from the owner raster (after loading). */
  recountCountries(): void {
    for (const country of this.countries) {
      country.pixels = 0;
      country.box = [MAP_WIDTH, MAP_HEIGHT, -1, -1];
    }
    for (let p = 0; p < MAP_PIXELS; p += 1) {
      const id = this.owner[p];
      if (id === 0) continue;
      const country = this.countries[id - 1];
      if (!country) continue;
      country.pixels += 1;
      const x = p % MAP_WIDTH;
      const y = (p - x) / MAP_WIDTH;
      country.box[0] = Math.min(country.box[0], x);
      country.box[1] = Math.min(country.box[1], y);
      country.box[2] = Math.max(country.box[2], x);
      country.box[3] = Math.max(country.box[3], y);
    }
  }

  // ---------- entities ----------

  private usedColors(items: { color: string }[]): Set<string> {
    return new Set(items.map((item) => item.color.toLowerCase()));
  }

  newCountry(fields: Pick<Country, 'rank' | 'cultureId' | 'religionId' | 'density' | 'foundedYear' | 'parentId'> & { government?: GovernmentId }): Country {
    const used = new Set(this.countries.map((c) => c.name));
    const culture = this.cultures[fields.cultureId];
    const leaders = initialGovernment(fields.foundedYear, fields.cultureId, fields.religionId, culture?.nameStyleId, culture?.surnameAffix);
    const country: Country = {
      id: this.countries.length,
      name: uniqueName(() => `${randomItem(NAMES.countryStart)}${randomItem(NAMES.countryEnd)}`, used),
      color: pickUniqueColor(PALETTE.country, this.usedColors(this.countries)),
      ...leaders,
      rulerSince: fields.foundedYear,
      pixels: 0,
      box: [MAP_WIDTH, MAP_HEIGHT, -1, -1],
      ...fields,
    };
    this.countries.push(country);
    country.ruler.countryId = country.id;
    country.ruler.formerRulerOf = [country.id];
    country.seatSince[country.ruler.id] = fields.foundedYear;
    country.termCounts[country.ruler.id] = 1;
    this.people.push(country.ruler);
    return country;
  }

  newCulture(parent: Culture | null, year: number): Culture {
    const used = new Set(this.cultures.map((c) => c.name));
    const name = uniqueName(
      () =>
        parent && !NAMES.cultureBranch.some((prefix) => parent.name.startsWith(prefix))
          ? `${randomItem(NAMES.cultureBranch)} ${parent.name.toLowerCase()}`
          : `${randomItem(NAMES.cultureStart)}${randomItem(NAMES.cultureEnd)}`,
      used,
    );
    const culture: Culture = {
      id: this.cultures.length,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      nameStyleId: randomNameStyle(),
      surnameAffix: randomSurnameAffix(Math.random, this.cultures.map((culture) => culture.surnameAffix).filter((affix): affix is SurnameAffix => !!affix)),
      color: pickUniqueColor(PALETTE.culture, this.usedColors(this.cultures)),
      parentId: parent?.id ?? null,
      foundedYear: year,
      traits: Math.random() < 0.25 ? [randomItem(['warlike', 'peaceful', 'genderEqual'])] : [],
    };
    this.cultures.push(culture);
    return culture;
  }

  newReligion(year: number): Religion {
    const used = new Set(this.religions.map((r) => r.name));
    const religion: Religion = {
      id: this.religions.length,
      name: uniqueName(() => `${randomItem(NAMES.religionStart)} ${randomItem(NAMES.religionEnd)}`, used),
      color: pickUniqueColor(PALETTE.religion, this.usedColors(this.religions)),
      parentId: null,
      foundedYear: year,
      traits: Math.random() < 0.25 ? [randomItem(['maleClergy', 'femaleClergy', 'equalClergy'])] : [],
    };
    this.religions.push(religion);
    return religion;
  }

  /** Removes an unused entity created for a card that ended up painting nothing (always the last one). */
  discardLast(list: 'countries' | 'cultures' | 'religions', id: number): void {
    const items = this[list] as { id: number }[];
    if (items.length > 0 && items[items.length - 1].id === id) {
      items.pop();
      if (list === 'countries') this.people = this.people.filter((p) => p.countryId !== id);
    }
  }
}

export function uniqueName(make: () => string, used: Set<string>): string {
  for (let i = 0; i < 40; i += 1) {
    const name = make();
    if (!used.has(name)) return name;
  }
  const base = make();
  let suffix = 2;
  while (used.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) =>
    Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** A color not yet used: first from the palette, then from an evenly spread generated sequence. */
export function pickUniqueColor(palette: string[], used: Set<string>): string {
  const free = palette.filter((color) => !used.has(color.toLowerCase()));
  if (free.length > 0) return randomItem(free).toLowerCase();
  for (let i = 0; i < 4000; i += 1) {
    const color = hslToHex((i * 137.508) % 360, 30 + (i % 3) * 12, 36 + (Math.floor(i / 7) % 4) * 9);
    if (!used.has(color)) return color;
  }
  return hslToHex(Math.random() * 360, 40, 50);
}
