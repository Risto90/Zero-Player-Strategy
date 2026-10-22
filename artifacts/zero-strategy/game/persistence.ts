import { MAP_PIXELS } from './config';
import type { MapKind } from './geography';
import { decodeEarthLand } from './geography';
import { fillRings, rasterizeScalar, runSteps, traceCompositionSteps, traceScalarSteps, type EntityZones, type Steps, type TableView, type Zone } from './zones';
import { World, type Country, type Culture, type Religion } from './world';

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
  cultures: Culture[];
  religions: Religion[];
  layers: SavedLayers;
}

/** Frozen copy of everything a save needs, so it can be traced in slices while the game goes on. */
export interface WorldCopy {
  mapKind: MapKind;
  seed: number;
  land: Uint8Array;
  owner: Uint16Array;
  density: Uint8Array;
  humidity: Uint8Array;
  temperature: Uint8Array;
  drainage: Uint8Array;
  culture: Uint16Array;
  religion: Uint16Array;
  cultureTable: TableView;
  religionTable: TableView;
  countries: Country[];
  cultures: Culture[];
  religions: Religion[];
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
    countries: world.countries.map((c) => ({ ...c, box: [...c.box] as Country['box'] })),
    cultures: world.cultures.map((c) => ({ ...c })),
    religions: world.religions.map((r) => ({ ...r })),
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
  const temperature = yield* traceScalarSteps(copy.temperature, copy.land, null);
  const drainage = yield* traceScalarSteps(copy.drainage, copy.land, null);
  const cultures = yield* traceCompositionSteps(copy.culture, copy.cultureTable);
  const religions = yield* traceCompositionSteps(copy.religion, copy.religionTable);
  return {
    mapKind: copy.mapKind,
    seed: copy.seed,
    countries: copy.countries,
    cultures: copy.cultures,
    religions: copy.religions,
    layers: { land, political, density, humidity, temperature, drainage, cultures, religions },
  };
}

export function serializeWorld(world: World): SavedWorld {
  return runSteps(serializeSteps(copyWorld(world)));
}

function rasterize<T extends Uint8Array | Uint16Array>(zones: Zone[], target: T): T {
  rasterizeScalar(zones, target);
  return target;
}

/** Rebuilds the working rasters from the stored zones. */
export function deserializeWorld(saved: SavedWorld): World {
  const layers = saved.layers;
  const land = saved.mapKind === 'world' ? decodeEarthLand() : rasterize(layers.land ?? [], new Uint8Array(MAP_PIXELS));
  const world = new World(saved.mapKind, saved.seed, land, {
    humidity: rasterize(layers.humidity, new Uint8Array(MAP_PIXELS)),
    temperature: rasterize(layers.temperature, new Uint8Array(MAP_PIXELS)),
    drainage: rasterize(layers.drainage, new Uint8Array(MAP_PIXELS)),
  });
  world.countries = saved.countries.map((c) => ({ ...c }));
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
  world.recountCountries();
  return world;
}
