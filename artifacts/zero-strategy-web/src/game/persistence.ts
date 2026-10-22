import { MAP_PIXELS } from './config';
import type { MapKind } from './geography';
import { decodeEarthLand } from './geography';
import { fillRings, rasterizeScalar, traceComposition, traceScalar, type EntityZones, type Zone } from './zones';
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

export function serializeWorld(world: World): SavedWorld {
  const populated = new Uint8Array(MAP_PIXELS);
  for (let p = 0; p < MAP_PIXELS; p += 1) populated[p] = world.owner[p] > 0 ? 1 : 0;
  return {
    mapKind: world.mapKind,
    seed: world.seed,
    countries: world.countries.map((c) => ({ ...c, box: [...c.box] as Country['box'] })),
    cultures: world.cultures.map((c) => ({ ...c })),
    religions: world.religions.map((r) => ({ ...r })),
    layers: {
      land: world.mapKind === 'world' ? null : traceScalar(world.land, null, 0),
      political: traceScalar(world.owner, null, 0),
      density: traceScalar(world.density, populated, null),
      humidity: traceScalar(world.humidity, world.land, null),
      temperature: traceScalar(world.temperature, world.land, null),
      drainage: traceScalar(world.drainage, world.land, null),
      cultures: traceComposition(world.culture, world.cultureTable),
      religions: traceComposition(world.religion, world.religionTable),
    },
  };
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

// ---------- IndexedDB ----------

const DB_NAME = 'zero-strategy';
const STORE = 'saves';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function writeSave<T>(value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readSave<T>(): Promise<T | null> {
  const db = await openDb();
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

export async function clearSave(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
