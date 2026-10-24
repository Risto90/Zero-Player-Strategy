import { MAP_PIXELS } from './config';
import type { MapKind } from './geography';
import { decodeEarthLand, fillOceanTemperature } from './geography';
import { fillRings, rasterizeScalar, runSteps, traceCompositionSteps, traceScalarSteps, type EntityZones, type Steps, type TableView, type Zone } from './zones';
import { World, type City, type Country, type Culture, type NomadCell, type Religion } from './world';
import { generateCityIdentity } from './cityNames';
import { ensureCityPopulationGroups } from './settlements';

/**
 * Saved map: every layer is stored as closed-curve zones, never as per-pixel values.
 *  - political: one zone set per country;
 *  - climate and population density: one zone set per value ("humidity 10%");
 *  - each culture / religion: its own layer of zones per share.
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
}

export interface SavedWorld {
  mapKind: MapKind;
  seed: number;
  countries: Country[];
  cities?: City[];
  /** Read-only compatibility for pre-unification saves; never emitted by new saves. */
  nomads?: LegacyNomadSave[];
  cultures: Culture[];
  religions: Religion[];
  people: World['people'];
  cardMultipliers?: Record<string, number>;
  /** Added when sea temperatures became part of climate layers. */
  climateWater?: boolean;
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

/** Frozen copy of everything a save needs, so it can be traced in slices while the game goes on. */
export interface WorldCopy {
  mapKind: MapKind;
  seed: number;
  land: Uint8Array;
  owner: Uint16Array;
  density: Float32Array;
  humidity: Uint8Array;
  temperature: Uint8Array;
  drainage: Uint8Array;
  culture: Uint16Array;
  religion: Uint16Array;
  cultureTable: TableView;
  religionTable: TableView;
  countries: Country[];
  cities: City[];
  cultures: Culture[];
  religions: Religion[];
  people: World['people'];
  cardMultipliers: Record<string, number>;
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
    land: world.land,
    owner: world.owner.slice(),
    density: world.density.slice(),
    humidity: world.humidity.slice(),
    temperature: world.temperature.slice(),
    drainage: world.drainage.slice(),
    culture: world.culture.slice(),
    religion: world.religion.slice(),
    cultureTable: freezeTable(world.cultureTable),
    religionTable: freezeTable(world.religionTable),
    countries: world.countries.map((c) => ({
      ...c,
      box: [...c.box] as Country['box'],
      ...(c.range ? { range: [...c.range] } : {}),
      ...(c.cells ? { cells: c.cells.map((cell) => ({ ...cell })) } : {}),
      rulerTerms: c.rulerTerms.map((term) => ({ ...term })),
      ruler: { ...c.ruler, parents: [...c.ruler.parents], spouseIds: [...c.ruler.spouseIds], loverIds: [...c.ruler.loverIds], friendIds: [...c.ruler.friendIds], traits: [...c.ruler.traits], formerRulerOf: [...c.ruler.formerRulerOf] },
      heir: c.heir ? { ...c.heir, parents: [...c.heir.parents], spouseIds: [...c.heir.spouseIds], loverIds: [...c.heir.loverIds], friendIds: [...c.heir.friendIds], traits: [...c.heir.traits], formerRulerOf: [...c.heir.formerRulerOf] } : null,
    })),
    cities: world.cities.map((city) => ({
      ...city,
      populationGroups: city.populationGroups?.map((group) => ({ ...group })),
    })),
    cultures: world.cultures.map((c) => ({ ...c })),
    religions: world.religions.map((r) => ({ ...r })),
    people: world.people.map((p) => ({ ...p, parents: [...p.parents], spouseIds: [...p.spouseIds], loverIds: [...p.loverIds], friendIds: [...p.friendIds], traits: [...p.traits], formerRulerOf: [...p.formerRulerOf] })),
    cardMultipliers: { ...world.cardMultipliers },
  };
}

/** Traces every layer of the copy into closed-curve zones, in slices. */
export function* serializeSteps(copy: WorldCopy): Steps<SavedWorld> {
  const populated = new Uint8Array(MAP_PIXELS);
  for (let p = 0; p < MAP_PIXELS; p += 1) populated[p] = copy.owner[p] > 0 ? 1 : 0;
  yield;
  const land = copy.mapKind === 'world' ? null : yield* traceScalarSteps(copy.land, null, 0);
  const political = yield* traceScalarSteps(copy.owner, null, 0);
  const density = yield* traceScalarSteps(copy.density, populated, null);
  const humidity = yield* traceScalarSteps(copy.humidity, copy.land, null);
  const temperature = yield* traceScalarSteps(copy.temperature, null, null);
  const drainage = yield* traceScalarSteps(copy.drainage, copy.land, null);
  const cultures = yield* traceCompositionSteps(copy.culture, copy.cultureTable);
  const religions = yield* traceCompositionSteps(copy.religion, copy.religionTable);
  return {
    mapKind: copy.mapKind,
    seed: copy.seed,
    countries: copy.countries,
    cities: copy.cities,
    cultures: copy.cultures,
    religions: copy.religions,
    people: copy.people,
    cardMultipliers: copy.cardMultipliers,
    climateWater: true,
    layers: { land, political, density, humidity, temperature, drainage, cultures, religions },
  };
}

export function serializeWorld(world: World): SavedWorld {
  return runSteps(serializeSteps(copyWorld(world)));
}

function rasterize<T extends Uint8Array | Uint16Array | Float32Array>(zones: Zone[], target: T): T {
  rasterizeScalar(zones, target);
  return target;
}

/** Rebuilds the working rasters from the stored zones. */
export function deserializeWorld(saved: SavedWorld): World {
  const layers = saved.layers;
  const land = saved.mapKind === 'world' ? decodeEarthLand() : rasterize(layers.land ?? [], new Uint8Array(MAP_PIXELS));
  const temperature = rasterize(layers.temperature, new Uint8Array(MAP_PIXELS));
  if (!saved.climateWater) fillOceanTemperature(land, saved.seed, temperature);
  const world = new World(saved.mapKind, saved.seed, land, {
    humidity: rasterize(layers.humidity, new Uint8Array(MAP_PIXELS)),
    temperature,
    drainage: rasterize(layers.drainage, new Uint8Array(MAP_PIXELS)),
  });
  world.countries = saved.countries.map((c) => ({
    ...c,
    type: c.type ?? 'settled',
    ...(c.range ? { range: [...c.range] } : {}),
    ...(c.cells ? { cells: c.cells.map((cell) => ({ ...cell })) } : {}),
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
      density: legacy.density ?? (legacy.cells ?? []).reduce((sum, cell) => sum + cell.population, 0) /
        Math.max(1, legacy.range?.length ?? 0),
      range: [...(legacy.range ?? [])],
      cells: (legacy.cells ?? []).map((cell) => ({ ...cell })),
      sourceCountryId: legacy.sourceCountryId,
    } as Country);
  }
  world.cities = (saved.cities ?? []).map((city) => ({ ...city }));
  for (const city of world.cities) {
    if (city.pixel >= 0 && city.pixel < MAP_PIXELS) world.cityIdAt[city.pixel] = city.id;
  }
  world.people = saved.people ?? [];
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
  rasterizeScalar(layers.political, world.owner);
  rasterizeScalar(layers.density, world.density);
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
  for (const city of world.cities) {
    // Before city population was stored separately, density at the city pixel held
    // the whole city. Preserve that count when opening an older save.
    if (!Number.isFinite(city.population)) city.population = world.density[city.pixel];
    ensureCityPopulationGroups(world, city);
    if (!city.name) Object.assign(city, generateCityIdentity(world, city.pixel));
  }
  world.recountCountries();
  // A version-2 save from before the family system has rulers/heirs but no person registry.
  // Game.load supplies its saved year for migration after the map has been reconstructed.
  return world;
}
