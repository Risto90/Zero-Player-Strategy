import { MAP_PIXELS, legacyTemperatureIndexToCelsius } from './config';
import { residentsToDensity, roundResidents } from './populationUnits';
import type { MapKind } from './geography';
import { decodeEarthLand, fillOceanTemperature, fillOceanTemperatureLegacy } from './geography';
import { earthMeanHumidityPercent } from './data/earthHumidity';
import { fillRings, rasterizeScalar, runSteps, traceCompositionSteps, traceScalarSteps, type EntityZones, type Steps, type TableView, type Zone } from './zones';
import { World, type City, type Country, type Culture, type DynastyHeraldry, type NomadCell, type Religion, type SavedGeographyState, type TerrainOverride } from './world';
import { generateCityIdentity } from './cityNames';
import { ensureCityPopulationGroups } from './settlements';
import {
  populationCohortsFromMixes,
  type PopulationCohortShare,
} from './populationCohorts';
import {
  cultureTags,
  ensureFlagIdentity,
  ensureStyleProfile,
} from './flagIdentity';

/**
 * Сохранённая карта хранит каждый слой замкнутыми контурами, а не значениями отдельных точек.
 *  - политический слой: отдельный набор зон для каждого государства;
 *  - климат и плотность населения: зоны для каждого значения;
 *  - культуры, религии и совместные группы населения: отдельные слои долей.
 */
export interface SavedLayers {
  land: Zone[] | null;
  political: Zone[];
  density: Zone[];
  humidity: Zone[];
  temperature: Zone[];
  drainage: Zone[];
  cultures: EntityZones[];
  religions: EntityZones[];
  /** Добавлен вместе с составом происхождения; отсутствует в старых сохранениях. */
  humanOrigins?: EntityZones[];
  /** Совместные группы населения; отсутствует в старых сохранениях. */
  populationCohorts?: Zone[];
}

export interface SavedWorld {
  populationUnits?: 'people-per-km2-v1';
  temperatureUnit?: 'celsius-v1';
  mapKind: MapKind;
  seed: number;
  countries: Country[];
  cities?: City[];
  nextCityChronicleId?: number;
  /** Совместимость только для чтения со старыми сохранениями до объединения; новые сохранения это поле не записывают. */
  nomads?: LegacyNomadSave[];
  cultures: Culture[];
  religions: Religion[];
  /** Стабильные индексы составов, на которые ссылаются городские и кочевые группы. */
  cultureTable?: { ids: number[]; shares: number[] }[];
  religionTable?: { ids: number[]; shares: number[] }[];
  humanOriginTable?: { ids: number[]; shares: number[] }[];
  populationCohortTable?: PopulationCohortShare[][];
  people: World['people'];
  dynastyEmblems?: Record<number, DynastyHeraldry>;
  cardMultipliers?: Record<string, number>;
  geography?: SavedGeographyState;
  /** Пустое или отсутствующее поле означает исходный рельеф карты из seed. */
  terrainOverrides?: TerrainOverride[];
  /** Поле добавлено, когда температура моря стала частью климатических слоёв. */
  climateWater?: boolean;
  /** Новые сохранения явно включают влажность моря в контурный слой. */
  humidityWater?: boolean;
  layers: SavedLayers;
}

interface LegacyNomadSave {
  id: number;
  name: string;
  color: string;
  density?: number;
  cultureId: number;
  religionId: number | null;
  cells?: NomadCell[];
  range?: number[];
  personIds?: number[];
  sourceCountryId: number | null;
  government: Country['government'];
  modifiers: Country['modifiers'];
  ruler: Country['ruler'];
  heir: Country['heir'];
  rulerSince: number;
  previousRulerIds: number[];
  dynastyClaims: number[];
  coRulerIds: number[];
  rulerTerms?: Country['rulerTerms'];
  termYears: number;
  maxTerms: number;
  consulCount: number;
  seatSince: Record<number, number>;
  termCounts: Record<number, number>;
  barredRulerIds: number[];
  pressures: Country['pressures'];
}

/** Неизменяемая копия данных сохранения для поэтапной обработки во время игры. */
export interface WorldCopy {
  mapKind: MapKind;
  seed: number;
  terrainOverrides: TerrainOverride[];
  land: Uint8Array;
  owner: Uint16Array;
  density: Float64Array;
  humidity: Uint8Array;
  temperature: Float32Array;
  drainage: Uint8Array;
  culture: Uint16Array;
  religion: Uint16Array;
  humanOrigins: Uint16Array;
  populationCohorts: Uint32Array;
  cultureTable: TableView;
  religionTable: TableView;
  humanOriginTable: TableView;
  populationCohortTable: PopulationCohortShare[][];
  countries: Country[];
  cities: City[];
  nextCityChronicleId: number;
  cultures: Culture[];
  religions: Religion[];
  people: World['people'];
  dynastyEmblems: Record<number, DynastyHeraldry>;
  cardMultipliers: Record<string, number>;
  geography: SavedGeographyState;
}

function copyFlagged<T extends { emblemSpec?: Country['emblemSpec']; flagIdentity?: Country['flagIdentity']; styleProfile?: Country['styleProfile'] }>(entity: T): T {
  return {
    ...entity,
    ...(entity.emblemSpec ? { emblemSpec: JSON.parse(JSON.stringify(entity.emblemSpec)) } : {}),
    ...(entity.flagIdentity ? {
      flagIdentity: { ...entity.flagIdentity, tags: [...entity.flagIdentity.tags] },
    } : {}),
    ...(entity.styleProfile ? {
      styleProfile: {
        ...entity.styleProfile,
        tags: [...entity.styleProfile.tags],
        identity: { ...entity.styleProfile.identity, tags: [...entity.styleProfile.identity.tags] },
      },
    } : {}),
  };
}

function freezeTable(table: World['cultureTable']): TableView {
  const entries = table.entries.slice();
  return {
    entries,
    shareOf(comp: number, entity: number): number {
      const entry = entries[comp];
      const at = entry.ids.indexOf(entity);
      return at < 0 ? 0 : entry.shares[at];
    },
  };
}

export function copyWorld(world: World): WorldCopy {
  return {
    mapKind: world.mapKind,
    seed: world.seed,
    terrainOverrides: [...world.terrainOverrides.values()].sort((a, b) => a.pixel - b.pixel),
    land: world.land,
    owner: world.owner.slice(),
    density: world.density.slice(),
    humidity: world.humidity.slice(),
    temperature: world.temperature.slice(),
    drainage: world.drainage.slice(),
    culture: world.culture.slice(),
    religion: world.religion.slice(),
    humanOrigins: world.humanOrigins.slice(),
    populationCohorts: world.populationCohorts.slice(),
    cultureTable: freezeTable(world.cultureTable),
    religionTable: freezeTable(world.religionTable),
    humanOriginTable: freezeTable(world.humanOriginTable),
    populationCohortTable: world.populationCohortTable.entries.map((entry) =>
      entry.map((group) => ({ ...group })),
    ),
    countries: world.countries.map((c) => ({
      ...c,
      ...copyFlagged(c),
      box: [...c.box] as Country['box'],
      ...(c.range ? { range: [...c.range] } : {}),
      ...(c.cells ? {
        cells: c.cells.map((cell) => ({
          ...cell,
          ...(cell.populationGroups ? {
            populationGroups: cell.populationGroups.map((group) => ({ ...group })),
          } : {}),
        })),
      } : {}),
      rulerTerms: c.rulerTerms.map((term) => ({ ...term })),
      ruler: { ...c.ruler, humanOrigin: c.ruler.humanOrigin ? { ids: [...c.ruler.humanOrigin.ids], shares: [...c.ruler.humanOrigin.shares] } : undefined, parents: [...c.ruler.parents], spouseIds: [...c.ruler.spouseIds], loverIds: [...c.ruler.loverIds], traits: [...c.ruler.traits], formerRulerOf: [...c.ruler.formerRulerOf] },
      heir: c.heir ? { ...c.heir, humanOrigin: c.heir.humanOrigin ? { ids: [...c.heir.humanOrigin.ids], shares: [...c.heir.humanOrigin.shares] } : undefined, parents: [...c.heir.parents], spouseIds: [...c.heir.spouseIds], loverIds: [...c.heir.loverIds], traits: [...c.heir.traits], formerRulerOf: [...c.heir.formerRulerOf] } : null,
    })),
    cities: world.cities.map((city) => ({
      ...city,
      ...copyFlagged(city),
      populationGroups: city.populationGroups?.map((group) => ({ ...group })),
    })),
    nextCityChronicleId: world.nextCityChronicleId,
    cultures: world.cultures.map((c) => copyFlagged(c)),
    religions: world.religions.map((r) => copyFlagged(r)),
    people: world.people.map((p) => ({ ...p, humanOrigin: p.humanOrigin ? { ids: [...p.humanOrigin.ids], shares: [...p.humanOrigin.shares] } : undefined, parents: [...p.parents], spouseIds: [...p.spouseIds], loverIds: [...p.loverIds], traits: [...p.traits], formerRulerOf: [...p.formerRulerOf] })),
    dynastyEmblems: Object.fromEntries(Object.entries(world.dynastyEmblems).map(([id, emblem]) => [id, copyFlagged(emblem)])),
    cardMultipliers: { ...world.cardMultipliers },
    geography: world.geographySaveState(),
  };
}

/** Поэтапно преобразует каждый слой копии в замкнутые контурные зоны. */
export function* serializeSteps(copy: WorldCopy): Steps<SavedWorld> {
  const populated = new Uint8Array(MAP_PIXELS);
  for (let p = 0; p < MAP_PIXELS; p += 1) populated[p] = copy.owner[p] > 0 ? 1 : 0;
  yield;
  const land = copy.mapKind === 'world' ? null : yield* traceScalarSteps(copy.land, null, 0);
  const political = yield* traceScalarSteps(copy.owner, null, 0);
  const density = yield* traceScalarSteps(copy.density, populated, null);
  const humidity = yield* traceScalarSteps(copy.humidity, null, 0);
  const temperature = yield* traceScalarSteps(copy.temperature, null, null);
  const drainage = yield* traceScalarSteps(copy.drainage, copy.land, null);
  const cultures = yield* traceCompositionSteps(copy.culture, copy.cultureTable);
  const religions = yield* traceCompositionSteps(copy.religion, copy.religionTable);
  const humanOrigins = yield* traceCompositionSteps(copy.humanOrigins, copy.humanOriginTable);
  const populationCohorts = yield* traceScalarSteps(copy.populationCohorts, populated, 0);
  return {
    populationUnits: 'people-per-km2-v1',
      temperatureUnit: 'celsius-v1',
    mapKind: copy.mapKind,
    seed: copy.seed,
    countries: copy.countries,
    cities: copy.cities,
    nextCityChronicleId: copy.nextCityChronicleId,
    cultures: copy.cultures,
    religions: copy.religions,
    people: copy.people,
    dynastyEmblems: copy.dynastyEmblems,
    cardMultipliers: copy.cardMultipliers,
    geography: copy.geography,
    terrainOverrides: copy.terrainOverrides,
    climateWater: true,
    humidityWater: true,
    layers: {
      land, political, density, humidity, temperature, drainage, cultures, religions, humanOrigins,
      populationCohorts,
    },
    cultureTable: copy.cultureTable.entries.map((entry) => ({
      ids: [...entry.ids],
      shares: [...entry.shares],
    })),
    religionTable: copy.religionTable.entries.map((entry) => ({
      ids: [...entry.ids],
      shares: [...entry.shares],
    })),
    humanOriginTable: copy.humanOriginTable.entries.map((entry) => ({
      ids: [...entry.ids],
      shares: [...entry.shares],
    })),
    populationCohortTable: copy.populationCohortTable.map((entry) =>
      entry.map((group) => ({ ...group })),
    ),
  };
}

export function serializeWorld(world: World): SavedWorld {
  return runSteps(serializeSteps(copyWorld(world)));
}

function rasterize<T extends Uint8Array | Uint16Array | Float32Array>(zones: Zone[], target: T): T {
  rasterizeScalar(zones, target);
  return target;
}

/** Восстанавливает рабочие растры из сохранённых зон. */
export function deserializeWorld(saved: SavedWorld): World {
  const layers = saved.layers;
  const land = saved.mapKind === 'world' ? decodeEarthLand() : rasterize(layers.land ?? [], new Uint8Array(MAP_PIXELS));
  const humidity = !saved.humidityWater && saved.mapKind === 'world'
    ? earthMeanHumidityPercent().slice()
    : new Uint8Array(MAP_PIXELS);
  rasterize(layers.humidity, humidity);
  let temperature: Float32Array;
  if (saved.temperatureUnit === 'celsius-v1') {
    temperature = rasterize(layers.temperature, new Float32Array(MAP_PIXELS));
    if (!saved.climateWater) fillOceanTemperature(land, saved.seed, temperature, saved.mapKind);
  } else {
    const legacyTemperature = rasterize(layers.temperature, new Uint8Array(MAP_PIXELS));
    if (!saved.climateWater) fillOceanTemperatureLegacy(land, saved.seed, legacyTemperature);
    temperature = new Float32Array(MAP_PIXELS);
    for (let pixel = 0; pixel < MAP_PIXELS; pixel += 1) {
      temperature[pixel] = legacyTemperatureIndexToCelsius(legacyTemperature[pixel]);
    }
  }
  const world = new World(saved.mapKind, saved.seed, land, {
    humidity,
    temperature,
    drainage: rasterize(layers.drainage, new Uint8Array(MAP_PIXELS)),
  });
  world.restoreTerrainOverrides(saved.terrainOverrides ?? []);
  const restoreCompositionTable = (
    table: World['cultureTable'],
    entries: SavedWorld['cultureTable'],
  ) => {
    if (!entries) return;
    entries.slice(1).forEach((entry, index) => {
      const restoredIndex = table.intern(new Map(
        entry.ids.map((id, shareIndex) => [id, entry.shares[shareIndex] ?? 0]),
      ));
      if (restoredIndex !== index + 1) {
        throw new Error('Не удалось сохранить исходные индексы состава населения.');
      }
    });
  };
  restoreCompositionTable(world.cultureTable, saved.cultureTable);
  restoreCompositionTable(world.religionTable, saved.religionTable);
  if (saved.humanOriginTable) {
    for (const entry of saved.humanOriginTable.slice(1)) {
      world.humanOriginTable.intern(new Map(entry.ids.map((id, index) => [id, entry.shares[index] ?? 0])));
    }
  } else {
    world.humanOriginTable.single(0, 100);
  }
  if (saved.populationCohortTable) world.populationCohortTable.restore(saved.populationCohortTable);
  if (!!saved.populationCohortTable !== !!layers.populationCohorts) {
    throw new Error('Сохранение содержит неполные данные совместных групп населения.');
  }
  const hasCurrentPopulationUnits = saved.populationUnits === 'people-per-km2-v1';
  const restoreNomadCell = (cell: NomadCell): NomadCell => {
    const { population: legacyPopulation, ...rest } = cell;
    const density = hasCurrentPopulationUnits
      ? cell.density
      : residentsToDensity(legacyPopulation ?? cell.density ?? 0);
    if (!Number.isFinite(density)) throw new Error('В сохранении найдена некорректная плотность кочевого населения.');
    return {
      ...rest,
      density,
      humanOriginMix: Number.isFinite(cell.humanOriginMix)
        ? cell.humanOriginMix
        : world.humanOriginTable.single(0, 100),
    };
  };
  world.countries = saved.countries.map((c) => ({
    ...c,
    type: c.type ?? 'settled',
    density: hasCurrentPopulationUnits ? c.density : residentsToDensity(c.density),
    ...(c.range ? { range: [...c.range] } : {}),
    ...(c.cells ? { cells: c.cells.map(restoreNomadCell) } : {}),
  }));
  const legacyNomads = saved.nomads ?? [];
  const legacyNomadIds = new Map<number, number>();
  for (const legacy of legacyNomads) {
    const id = world.countries.length;
    legacyNomadIds.set(legacy.id, id);
    const source = legacy.sourceCountryId === null ? undefined : world.countries[legacy.sourceCountryId];
    world.countries.push({
      ...legacy,
      id,
      type: 'nomadic',
      rank: 'Кочевье',
      foundedYear: source?.foundedYear ?? legacy.rulerSince ?? 1000,
      parentId: legacy.sourceCountryId,
      pixels: 0,
      box: [MAP_PIXELS, MAP_PIXELS, -1, -1],
      density: hasCurrentPopulationUnits
        ? legacy.density ?? 0
        : residentsToDensity(legacy.density ?? (legacy.cells ?? []).reduce(
          (sum, cell) => sum + (cell.population ?? 0), 0,
        ) / Math.max(1, legacy.range?.length ?? 0)),
      range: [...(legacy.range ?? [])],
      cells: (legacy.cells ?? []).map(restoreNomadCell),
      sourceCountryId: legacy.sourceCountryId,
    } as Country);
  }
  world.cities = (saved.cities ?? []).map((city, id) => ({ ...city, chronicleId: city.chronicleId ?? id }));
  world.nextCityChronicleId = Math.max(
    saved.nextCityChronicleId ?? 0,
    ...world.cities.map((city) => city.chronicleId + 1),
  );
  for (const city of world.cities) {
    if (city.pixel >= 0 && city.pixel < MAP_PIXELS) world.cityIdAt[city.pixel] = city.id;
  }
  world.people = saved.people ?? [];
  world.dynastyEmblems = Object.fromEntries(
    Object.entries(saved.dynastyEmblems ?? {}).map(([id, emblem]) => [Number(id), { ...emblem }]),
  );
  for (const person of world.people) {
    const legacyId = (person as typeof person & { nomadId?: number }).nomadId;
    let currentCountryId = legacyId == null ? undefined : legacyNomadIds.get(legacyId);
    if (currentCountryId === undefined && person.countryId < 0) {
      const legacy = legacyNomads.find((group) => group.personIds?.includes(person.id) ||
        group.ruler.id === person.id || group.heir?.id === person.id || group.coRulerIds.includes(person.id));
      if (legacy) currentCountryId = legacyNomadIds.get(legacy.id);
    }
    if (currentCountryId !== undefined) person.countryId = currentCountryId;
    delete (person as typeof person & { nomadId?: number }).nomadId;
  }
  const multipliers = { ...(saved.cardMultipliers ?? {}) };
  for (const [key, value] of Object.entries(multipliers)) {
    const match = /^nomad:(\d+):(.*)$/.exec(key);
    if (!match) continue;
    const countryId = legacyNomadIds.get(Number(match[1]));
    delete multipliers[key];
    if (countryId !== undefined) multipliers[`country:${countryId}:${match[2]}`] = value;
  }
  world.cardMultipliers = multipliers;
  world.cultures = saved.cultures.map((c) => ({ ...c }));
  world.religions = saved.religions.map((r) => ({ ...r }));
  for (const culture of world.cultures) {
    ensureStyleProfile(
      world.seed,
      culture,
      'culture',
      'culture-style',
      cultureTags(culture.id),
      culture.parentId === null ? null : world.cultures[culture.parentId] ?? null,
    );
  }
  for (const religion of world.religions) {
    ensureStyleProfile(
      world.seed,
      religion,
      'religion',
      'religion-symbol',
      [],
      religion.parentId === null ? null : world.religions[religion.parentId] ?? null,
    );
    ensureFlagIdentity(
      world.seed,
      religion,
      'religion',
      'religion-symbol',
      religion.styleProfile,
      religion.parentId === null ? null : world.religions[religion.parentId] ?? null,
    );
  }
  for (const country of world.countries) {
    ensureFlagIdentity(
      world.seed,
      country,
      'country',
      'country-flag',
      world.cultures[country.cultureId]?.styleProfile,
    );
  }
  rasterizeScalar(layers.political, world.owner);
  rasterizeScalar(layers.density, world.density);
  if (!hasCurrentPopulationUnits) {
    for (const city of world.cities) {
      if (Number.isFinite(city.population)) continue;
      const legacyResidents = roundResidents(world.density[city.pixel]);
      city.population = legacyResidents;
      world.density[city.pixel] = 0;
    }
    for (let pixel = 0; pixel < MAP_PIXELS; pixel += 1) {
      world.density[pixel] = residentsToDensity(world.density[pixel]);
    }
  }
  for (const layer of layers.cultures) {
    for (const zone of layer.zones) {
      fillRings(zone.rings, (p) => (world.culture[p] = world.cultureTable.withEntry(world.culture[p], layer.entity, zone.value)));
    }
  }
  for (const layer of layers.religions) {
    for (const zone of layer.zones) {
      fillRings(zone.rings, (p) => (world.religion[p] = world.religionTable.withEntry(world.religion[p], layer.entity, zone.value)));
    }
  }
  if (layers.humanOrigins) {
    for (const layer of layers.humanOrigins) {
      for (const zone of layer.zones) {
        fillRings(zone.rings, (p) => (world.humanOrigins[p] =
          world.humanOriginTable.withEntry(world.humanOrigins[p], layer.entity, zone.value)));
      }
    }
  } else {
    const legacyOrigin = world.humanOriginTable.single(0, 100);
    for (let pixel = 0; pixel < MAP_PIXELS; pixel += 1) {
      if (world.owner[pixel] > 0 && world.density[pixel] > 0) world.humanOrigins[pixel] = legacyOrigin;
    }
  }
  if (layers.populationCohorts) {
    rasterizeScalar(layers.populationCohorts, world.populationCohorts);
  } else {
    for (let pixel = 0; pixel < MAP_PIXELS; pixel += 1) {
      if (world.owner[pixel] <= 0 || world.density[pixel] <= 0) continue;
      world.populationCohorts[pixel] = world.populationCohortTable.intern(
        populationCohortsFromMixes(
          world,
          world.culture[pixel],
          world.religion[pixel],
          world.humanOrigins[pixel],
          100,
        ),
      );
    }
  }
  for (const city of world.cities) {
    if (!Number.isFinite(city.population)) {
      throw new Error('В сохранении отсутствует численность города после миграции плотности.');
    }
    ensureCityPopulationGroups(world, city);
    if (!city.name) Object.assign(city, generateCityIdentity(world, city.pixel));
    if (city.rank >= 2 && city.rank <= 6) {
      const country = world.countries[city.countryId];
      ensureFlagIdentity(
        world.seed,
        city,
        'city',
        'city-coat',
        world.cultures[country?.cultureId ?? -1]?.styleProfile,
        undefined,
        city.rank,
      );
    }
  }
  world.recountCountries();
  world.restoreGeographyState(saved.geography);
  // В сохранении версии 2 до появления системы семей есть правители и наследники, но нет реестра персонажей.
  // После восстановления карты Game.load передаёт сохранённый год для миграции.
  return world;
}
