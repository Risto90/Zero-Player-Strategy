import { CompositionTable } from './composition';
import { biomeFor, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, NAMES, PALETTE } from './config';
import {
  decodeEarthLand,
  forEachNeighbour,
  generateClimate,
  generateClimateCooperative,
  labelWater,
  labelWaterCooperative,
  makeRandomLand,
  makeRandomLandCooperative,
  type MapKind,
  type WaterInfo,
  WORLD_SEED,
} from './geography';
import { randomItem } from './random';
import { initialGovernment, randomNameStyle, randomSurnameAffix, type GovernmentId, type NameStyleId, type Person, type PoliticalState, type SurnameAffix } from './government';
import { generateCityIdentity } from './cityNames';
import type { HumanOriginId } from './human';
import { MapContours } from './contours';
import { generateGeography, type GeographyFeature, type RiverFeature } from './geographyFeatures';
import { riverStrengthForRank } from './geographyGeometry';
import { createEntityEmblem, createFlagStyleProfile, cultureTags, ensureFlagIdentity } from './flagIdentity';
import type { FlagIdentity, FlagStyleProfile } from './flagIdentity';
import type { FlagSpec } from './flagSpec';

export type GeographyObjectKind = 'river' | 'peak' | 'volcano';
export interface GeographyNameTarget {
  kind: GeographyObjectKind;
  id: number;
  pixel: number;
  elevation: number;
  active?: boolean;
}
export interface SavedGeographyState {
  rivers: { id: number; name: string | null; discoveredBy: number[] }[];
  peaks: { id: number; name: string | null; discoveredBy: number[] }[];
  volcanoes: { id: number; name: string | null; discoveredBy: number[] }[];
}

export interface Country extends PoliticalState {
  id: number;
  type: 'settled' | 'nomadic';
  name: string;
  color: string;
  rank: string;
  /** Население на каждую точку, передаваемое новой оседлой территории. */
  density: number;
  cultureId: number;
  religionId: number | null;
  foundedYear: number;
  parentId: number | null;
  /** Число точек, обновляемое во время рисования. */
  pixels: number;
  /** Границы области, содержащей все точки государства; после потерь они могут быть больше территории. */
  box: [number, number, number, number];
  /** Перекрывающийся ареал суши и группы населения кочевого государства. */
  range?: number[];
  cells?: NomadCell[];
  /** Историческое место происхождения для летописи; не используется как текущее место жительства. */
  sourceCountryId?: number | null;
  emblemSpec?: FlagSpec;
  flagIdentity?: FlagIdentity;
  styleProfile?: FlagStyleProfile;
}

export function isActiveCountry(country: Country | null | undefined): boolean {
  if (!country) return false;
  return country.type === 'nomadic' ? (country.range?.length ?? 0) > 0 : country.pixels > 0;
}

export type CityRank = 1 | 2 | 3 | 4 | 5 | 6;

export interface City {
  id: number;
  /** Постоянный идентификатор летописи, который не меняется при удалении другого города, в отличие от id. */
  chronicleId: number;
  countryId: number;
  pixel: number;
  rank: CityRank;
  /** Общее население города; плотность сельского населения в точке остаётся в слое населения. */
  population: number;
  /** Городские группы культуры и вероисповедания, не зависящие от сельского состава этой точки. */
  populationGroups?: CityPopulationGroup[];
  capital: boolean;
  /** Название, закреплённое при основании по преобладающей культуре точки города. */
  name?: string;
  namingCultureId?: number;
  namingStyleId?: NameStyleId;
  emblemSpec?: FlagSpec;
  flagIdentity?: FlagIdentity;
  styleProfile?: FlagStyleProfile;
}

export interface CityPopulationGroup {
  cultureId: number;
  religionId: number | null;
  population: number;
  humanOriginMix: number;
}

export interface NomadCell {
  pixel: number;
  population: number;
  cultureMix: number;
  religionMix: number;
  humanOriginMix: number;
}

export interface Culture {
  id: number;
  name: string;
  /** Раса, выбранная для культуры, созданной вместе с новым государством. */
  foundingRaceId?: HumanOriginId;
  /** Постоянная схема именования, выбранная при создании культуры. */
  nameStyleId?: NameStyleId;
  /** Закреплённый префикс или суффикс фамилий этой культуры. */
  surnameAffix?: SurnameAffix;
  color: string;
  parentId: number | null;
  foundedYear: number;
  traits?: string[];
  emblemSpec?: FlagSpec;
  flagIdentity?: FlagIdentity;
  styleProfile?: FlagStyleProfile;
}

export type Religion = Culture;

export interface DynastyHeraldry {
  id: number;
  emblemSpec: FlagSpec;
  flagIdentity: FlagIdentity;
  styleProfile: FlagStyleProfile;
}

/** Весь мир: постоянные географические данные и рабочие растры всех слоёв. */
export class World {
  readonly land: Uint8Array;
  readonly water: WaterInfo;
  readonly elevation: Int16Array;
  /** Индексы точек суши для случайной выборки. */
  readonly landIndex: Int32Array;
  /** Детерминированный слой рек: 0 — нет реки, 1 — приток, 2–3 — крупное русло. */
  readonly rivers: Uint8Array;
  /** Отображаются только реки, уже обнаруженные хотя бы одним государством. */
  readonly knownRivers = new Uint8Array(MAP_PIXELS);
  riverFeatures: RiverFeature[];
  peaks: GeographyFeature[];
  volcanoes: GeographyFeature[];
  readonly riverPixelCount: number;
  readonly majorRiverPixelCount: number;
  readonly owner = new Uint16Array(MAP_PIXELS);
  readonly cityIdAt = new Int32Array(MAP_PIXELS).fill(-1);
  readonly density = new Float32Array(MAP_PIXELS);
  humidity: Uint8Array;
  temperature: Uint8Array;
  drainage: Uint8Array;
  readonly culture = new Uint16Array(MAP_PIXELS);
  readonly religion = new Uint16Array(MAP_PIXELS);
  /** Состав по происхождению не зависит от культуры и вероисповедания. */
  readonly humanOrigins = new Uint16Array(MAP_PIXELS);
  readonly cultureTable = new CompositionTable();
  readonly religionTable = new CompositionTable();
  readonly humanOriginTable = new CompositionTable();
  countries: Country[] = [];
  cities: City[] = [];
  nextCityChronicleId = 0;
  /** Постоянные множители вероятности карт в розыгрышах, привязанные к области действия и идентификатору карты. */
  cardMultipliers: Record<string, number> = {};
  cultures: Culture[] = [];
  religions: Religion[] = [];
  people: Person[] = [];
  /** Сохранённые гербы династий, индексированные по постоянному familyId. */
  dynastyEmblems: Record<number, DynastyHeraldry> = {};
  /** Увеличивается при каждом изменении карты; по нему обновляются кеши. */
  version = 0;
  /** Увеличивается только при расширении территории государства или кочевого ареала. */
  territoryVersion = 0;
  private geographyScanVersion = 0;
  private geographyVersion = 0;
  private readonly geographyNameCache = new Map<number, {
    version: number;
    targets: GeographyNameTarget[];
  }>();
  readonly contours = new MapContours(
    (name) => name === 'water' ? this.water.bodyOf : this[name],
    () => this.version,
  );

  /** Версия меняется только при открытии новых географических контуров. */
  get geographyRevision(): number {
    return this.geographyVersion;
  }

  constructor(
    readonly mapKind: MapKind,
    readonly seed: number,
    land: Uint8Array,
    climate: { humidity: Uint8Array; temperature: Uint8Array; drainage: Uint8Array } | null,
    prepared?: {
      water: WaterInfo;
      landIndex: Int32Array;
    },
  ) {
    this.land = land;
    this.water = prepared?.water ?? labelWater(land);
    const geography = generateGeography(land, seed, mapKind);
    this.elevation = geography.elevation;
    this.rivers = geography.rivers;
    this.riverFeatures = geography.riverFeatures;
    this.peaks = geography.peaks;
    this.volcanoes = geography.volcanoes;
    let riverPixelCount = 0;
    let majorRiverPixelCount = 0;
    for (const strength of this.rivers) {
      if (strength > 0) riverPixelCount += 1;
      if (strength >= 2) majorRiverPixelCount += 1;
    }
    this.riverPixelCount = riverPixelCount;
    this.majorRiverPixelCount = majorRiverPixelCount;
    if (prepared) this.landIndex = prepared.landIndex;
    else {
      const index: number[] = [];
      for (let p = 0; p < MAP_PIXELS; p += 1) if (land[p]) index.push(p);
      this.landIndex = Int32Array.from(index);
    }
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

  static async createCooperative(
    mapKind: MapKind,
    seed?: number,
    onProgress?: (stage: string) => void,
  ): Promise<World> {
    if (mapKind !== 'world' && mapKind !== 'random') throw new Error('Неизвестный тип карты.');
    const actualSeed = mapKind === 'world' ? WORLD_SEED : (seed ?? Math.floor(Math.random() * 2 ** 31));
    onProgress?.('Создаём сушу');
    const land = mapKind === 'world' ? decodeEarthLand() : await makeRandomLandCooperative(actualSeed);
    onProgress?.('Размечаем моря');
    const water = await labelWaterCooperative(land);
    onProgress?.('Строим рельеф и реки');
    onProgress?.('Рассчитываем климат');
    const climate = await generateClimateCooperative(land, actualSeed);
    onProgress?.('Индексируем сушу и реки');
    let landCount = 0;
    for (let p = 0; p < MAP_PIXELS; p += 1) {
      if (land[p]) landCount += 1;
      if (p % 16_384 === 16_383) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const landIndex = new Int32Array(landCount);
    let index = 0;
    for (let p = 0; p < MAP_PIXELS; p += 1) {
      if (land[p]) landIndex[index++] = p;
      if (p % 16_384 === 16_383) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    onProgress?.('Готовим игровой экран');
    return new World(mapKind, actualSeed, land, climate, {
      water,
      landIndex,
    });
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
    this.territoryVersion += 1;
    this.contours.synchronize();
    if (previous > 0) this.countries[previous - 1].pixels -= 1;
    this.owner[p] = id;
    const row = Math.floor(p / MAP_WIDTH);
    this.contours.changed({ x0: 0, x1: MAP_WIDTH - 1, y0: row, y1: row }, ['owner']);
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

  markNomadicRangeExpanded(): void {
    this.territoryVersion += 1;
  }

  unnamedGeographyForCountry(countryId: number): GeographyNameTarget[] {
    const cached = this.geographyNameCache.get(countryId);
    if (cached?.version === this.geographyVersion) return cached.targets;
    const result: GeographyNameTarget[] = [];
    for (const feature of this.riverFeatures) {
      if (!feature.name && feature.discoveredBy.includes(countryId)) {
        result.push({ kind: 'river', id: feature.id, pixel: feature.pixels[Math.floor(feature.pixels.length / 2)] ?? -1, elevation: 0 });
      }
    }
    for (const feature of this.peaks) {
      if (!feature.name && feature.discoveredBy.includes(countryId)) {
        result.push({ kind: 'peak', id: feature.id, pixel: feature.pixel, elevation: feature.elevation });
      }
    }
    for (const feature of this.volcanoes) {
      if (!feature.name && feature.discoveredBy.includes(countryId)) {
        result.push({
          kind: 'volcano',
          id: feature.id,
          pixel: feature.pixel,
          elevation: feature.elevation,
          active: feature.active,
        });
      }
    }
    this.geographyNameCache.set(countryId, { version: this.geographyVersion, targets: result });
    return result;
  }

  nameGeographyFeature(kind: GeographyObjectKind, id: number, name: string): void {
    const feature = kind === 'river'
      ? this.riverFeatures[id]
      : kind === 'peak' ? this.peaks[id] : this.volcanoes[id];
    if (!feature) throw new Error(`Не найден географический объект ${kind}:${id}.`);
    if (feature.name) throw new Error(`Географический объект ${kind}:${id} уже получил имя.`);
    feature.name = name;
    this.geographyVersion += 1;
    this.version += 1;
  }

  geographySaveState(): SavedGeographyState {
    const copy = (features: (GeographyFeature | RiverFeature)[]) => features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      discoveredBy: [...feature.discoveredBy],
    }));
    return {
      rivers: copy(this.riverFeatures),
      peaks: copy(this.peaks),
      volcanoes: copy(this.volcanoes),
    };
  }

  restoreGeographyState(state?: SavedGeographyState): void {
    if (!state) {
      this.geographyScanVersion = this.territoryVersion - 1;
      return;
    }
    const restore = (
      features: (GeographyFeature | RiverFeature)[],
      saved: SavedGeographyState['rivers'],
    ) => {
      for (const value of saved) {
        const feature = features[value.id];
        if (!feature) continue;
        feature.name = value.name;
        feature.discoveredBy = value.discoveredBy.filter((id) => !!this.countries[id]);
      }
    };
    restore(this.riverFeatures, state.rivers);
    restore(this.peaks, state.peaks);
    restore(this.volcanoes, state.volcanoes);
    this.geographyVersion += 1;
    this.geographyNameCache.clear();
    this.knownRivers.fill(0);
    for (const feature of this.riverFeatures) {
      if (feature.discoveredBy.length === 0) continue;
       const strength = riverStrengthForRank(feature.scaleRank);
      for (const pixel of feature.pixels) {
        this.knownRivers[pixel] = Math.max(this.knownRivers[pixel], this.rivers[pixel] || strength);
      }
    }
    this.geographyScanVersion = this.territoryVersion;
  }

  /** Выявляет географические объекты только после расширения территории в этом ходу. */
  discoverGeography(): boolean {
    if (this.geographyScanVersion === this.territoryVersion) return false;
    this.geographyScanVersion = this.territoryVersion;

    const nomadsAtPixel = new Map<number, number[]>();
    for (const country of this.countries) {
      if (country.type !== 'nomadic') continue;
      for (const pixel of country.range ?? []) {
        const ids = nomadsAtPixel.get(pixel) ?? [];
        ids.push(country.id);
        nomadsAtPixel.set(pixel, ids);
      }
    }

    let discovered = false;
    const checkArea = (pixels: number[], feature: GeographyFeature | RiverFeature): void => {
      const known = new Set(feature.discoveredBy);
      for (const pixel of pixels) {
        const x = pixel % MAP_WIDTH;
        const y = Math.floor(pixel / MAP_WIDTH);
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= MAP_HEIGHT) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = (x + dx + MAP_WIDTH) % MAP_WIDTH;
            const nearby = ny * MAP_WIDTH + nx;
            const ownerId = this.owner[nearby] - 1;
            if (ownerId >= 0) known.add(ownerId);
            for (const nomadId of nomadsAtPixel.get(nearby) ?? []) known.add(nomadId);
          }
        }
        if (known.size >= this.countries.length) break;
      }
      const nextDiscoverers = [...known].filter((id) => !!this.countries[id]);
      if (nextDiscoverers.length === feature.discoveredBy.length &&
        nextDiscoverers.every((id) => feature.discoveredBy.includes(id))) return;
      feature.discoveredBy = nextDiscoverers;
      if (feature.discoveredBy.length > 0) discovered = true;
      if ('paths' in feature) {
         const strength = riverStrengthForRank(feature.scaleRank);
        for (const riverPixel of feature.pixels) {
          this.knownRivers[riverPixel] = Math.max(
            this.knownRivers[riverPixel],
            this.rivers[riverPixel] || strength,
          );
        }
      }
    };

    for (const feature of this.riverFeatures) checkArea(feature.pixels, feature);
    for (const feature of this.peaks) checkArea([feature.pixel], feature);
    for (const feature of this.volcanoes) checkArea([feature.pixel], feature);

    if (discovered) {
      this.geographyVersion += 1;
      this.geographyNameCache.clear();
      this.version += 1;
    }
    return discovered;
  }

  cityAt(p: number): City | null {
    const cityId = this.cityIdAt[p];
    return cityId >= 0 ? this.cities[cityId] ?? null : null;
  }

  addCity(countryId: number, pixel: number, rank: CityRank = 1, capital = false): City | null {
    const country = this.countries[countryId];
    if (!country || pixel < 0 || pixel >= MAP_PIXELS || !this.land[pixel] || this.cityAt(pixel)) return null;
    const city: City = {
      id: this.cities.length,
      chronicleId: this.nextCityChronicleId++,
      countryId,
      pixel,
      rank,
      population: this.density[pixel],
      populationGroups: cityPopulationGroupsAtPixel(this, pixel, this.density[pixel]),
      capital,
      ...generateCityIdentity(this, pixel),
    };
    if (rank >= 2) {
      const culture = this.cultures[country.cultureId];
      Object.assign(city, createEntityEmblem(
        this.seed,
        'city',
        city.chronicleId,
        'city-coat',
        culture?.styleProfile,
        undefined,
        rank,
      ));
    }
    if (capital) for (const existing of this.cities) if (existing.countryId === countryId) existing.capital = false;
    this.cities.push(city);
    this.cityIdAt[pixel] = city.id;
    this.version += 1;
    return city;
  }

  removeCity(cityId: number): void {
    const city = this.cities[cityId];
    if (!city) return;
    this.cities.splice(cityId, 1);
    this.cityIdAt[city.pixel] = -1;
    this.cities.forEach((item, index) => {
      item.id = index;
      this.cityIdAt[item.pixel] = index;
    });
    this.version += 1;
  }

  /** Перебирает все точки государства в пределах его ограничивающей рамки. */
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

  /** Пересчитывает население и рамки по растру владельцев после загрузки. */
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

  // ---------- сущности ----------

  private usedColors(items: { color: string }[]): Set<string> {
    return new Set(items.map((item) => item.color.toLowerCase()));
  }

  newCountry(fields: Pick<Country, 'rank' | 'cultureId' | 'religionId' | 'density' | 'foundedYear' | 'parentId'> & { government?: GovernmentId }): Country {
    const used = new Set(this.countries.map((c) => c.name));
    const culture = this.cultures[fields.cultureId];
    const leaders = initialGovernment(fields.foundedYear, fields.cultureId, fields.religionId, culture?.nameStyleId, culture?.surnameAffix);
    const country: Country = {
      id: this.countries.length,
      type: 'settled',
      name: uniqueName(() => `${randomItem(NAMES.countryStart)}${randomItem(NAMES.countryEnd)}`, used),
      color: pickUniqueColor(PALETTE.country, this.usedColors(this.countries)),
      ...leaders,
      rulerSince: fields.foundedYear,
      pixels: 0,
      box: [MAP_WIDTH, MAP_HEIGHT, -1, -1],
      ...fields,
    };
    const cultureStyle = culture?.styleProfile;
    Object.assign(country, ensureFlagIdentity(
      this.seed,
      country,
      'country',
      'country-flag',
      cultureStyle,
    ));
    this.countries.push(country);
    country.ruler.countryId = country.id;
    country.ruler.formerRulerOf = [country.id];
    country.rulerTerms = [{ personId: country.ruler.id, startYear: fields.foundedYear, endYear: null, office: 'ruler' }];
    country.seatSince[country.ruler.id] = fields.foundedYear;
    country.termCounts[country.ruler.id] = 1;
    this.people.push(country.ruler);
    return country;
  }

  newCulture(parent: Culture | null, year: number, foundingRaceId?: HumanOriginId): Culture {
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
      ...(foundingRaceId ? { foundingRaceId } : {}),
      nameStyleId: randomNameStyle(),
      surnameAffix: randomSurnameAffix(Math.random, this.cultures.map((culture) => culture.surnameAffix).filter((affix): affix is SurnameAffix => !!affix)),
      color: pickUniqueColor(PALETTE.culture, this.usedColors(this.cultures)),
      parentId: parent?.id ?? null,
      foundedYear: year,
      traits: Math.random() < 0.25 ? [randomItem(['warlike', 'peaceful', 'genderEqual'])] : [],
    };
    culture.styleProfile = createFlagStyleProfile(
      this.seed,
      'culture',
      culture.id,
      'culture-style',
      cultureTags(culture.id),
      parent,
    );
    culture.flagIdentity = culture.styleProfile.identity;
    this.cultures.push(culture);
    return culture;
  }

  newReligion(year: number, parent: Religion | null = null): Religion {
    const used = new Set(this.religions.map((r) => r.name));
    const religion: Religion = {
      id: this.religions.length,
      name: uniqueName(() => `${randomItem(NAMES.religionStart)} ${randomItem(NAMES.religionEnd)}`, used),
      color: pickUniqueColor(PALETTE.religion, this.usedColors(this.religions)),
      parentId: parent?.id ?? null,
      foundedYear: year,
      traits: Math.random() < 0.25 ? [randomItem(['maleClergy', 'femaleClergy', 'equalClergy'])] : [],
    };
    religion.styleProfile = createFlagStyleProfile(
      this.seed,
      'religion',
      religion.id,
      'religion-symbol',
      [],
      parent,
    );
    Object.assign(religion, ensureFlagIdentity(
      this.seed,
      religion,
      'religion',
      'religion-symbol',
      religion.styleProfile,
      parent,
    ));
    this.religions.push(religion);
    return religion;
  }

  /** Удаляет последнюю неиспользованную сущность, созданную картой, которая ничего не закрасила. */
  discardLast(list: 'countries' | 'cultures' | 'religions', id: number): void {
    const items = this[list] as { id: number }[];
    if (items.length > 0 && items[items.length - 1].id === id) {
      items.pop();
      if (list === 'countries') this.people = this.people.filter((p) => p.countryId !== id);
    }
  }
}

export function cityPopulationGroupsAtPixel(world: World, pixel: number, population: number): CityPopulationGroup[] {
  if (population <= 0) return [];
  const culture = world.cultureTable.entries[world.culture[pixel]];
  const religion = world.religionTable.entries[world.religion[pixel]];
  let humanOriginMix = world.humanOrigins[pixel];
  if (world.humanOriginTable.entries[humanOriginMix]?.total !== 100) {
    humanOriginMix = world.humanOriginTable.single(0, 100);
  }
  const religionIds: (number | null)[] = [...religion.ids, null];
  const religionShares = [...religion.shares, 100 - religion.total];
  const groups: CityPopulationGroup[] = [];
  culture.ids.forEach((cultureId, ci) => {
    religionIds.forEach((religionId, ri) => {
      const amount = population * culture.shares[ci] / 100 * religionShares[ri] / 100;
      if (amount > 0) groups.push({ cultureId, religionId, population: amount, humanOriginMix });
    });
  });
  return groups;
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

/** Неиспользованный цвет: сначала из палитры, затем из равномерно распределённой последовательности. */
export function pickUniqueColor(palette: string[], used: Set<string>): string {
  const free = palette.filter((color) => !used.has(color.toLowerCase()));
  if (free.length > 0) return randomItem(free).toLowerCase();
  for (let i = 0; i < 4000; i += 1) {
    const color = hslToHex((i * 137.508) % 360, 30 + (i % 3) * 12, 36 + (Math.floor(i / 7) % 4) * 9);
    if (!used.has(color)) return color;
  }
  return hslToHex(Math.random() * 360, 40, 50);
}
