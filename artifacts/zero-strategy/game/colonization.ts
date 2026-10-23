import { MAP_PIXELS, MAX_DENSITY } from './config';
import { demography } from './demography';
import { forEachNeighbour } from './geography';
import type { Country, World } from './world';

export const RIVER_COLONIZATION_RADIUS = 18;

export interface ColonizationPlan {
  targets: Uint8Array;
  donors: number[];
  refugeeSinks: Map<number, { pixels: number[]; index: number }>;
  averageDensity: number;
  availablePopulation: number;
  targetCount: number;
  hint: number;
}

let cached: { world: World; version: number; countryId: number; plan: ColonizationPlan } | null = null;

function rulingFamilies(world: World, country: Country): Set<number> {
  const families = new Set([country.ruler.familyId]);
  for (const id of country.coRulerIds) {
    const coRuler = world.people.find((person) => person.id === id);
    if (coRuler) families.add(coRuler.familyId);
  }
  return families;
}

/** Countries are allies when one dynasty rules both or their ruling families are linked by marriage. */
export function areColonizationAllies(world: World, a: Country, b: Country): boolean {
  const aFamilies = rulingFamilies(world, a);
  const bFamilies = rulingFamilies(world, b);
  for (const familyId of aFamilies) if (bFamilies.has(familyId)) return true;
  const byId = new Map(world.people.map((person) => [person.id, person]));
  for (const person of world.people) {
    if (!person.alive || !aFamilies.has(person.familyId)) continue;
    for (const spouseId of person.spouseIds) {
      const spouse = byId.get(spouseId);
      if (spouse?.alive && bFamilies.has(spouse.familyId)) return true;
    }
  }
  return false;
}

function geographicScope(world: World, country: Country): Uint8Array {
  const scope = new Uint8Array(MAP_PIXELS);
  const seas = new Set<number>();
  const riverSeeds: number[] = [];
  world.forEachCountryPixel(country, (p) => {
    world.seasOfPixel(p, seas);
    if (world.rivers[p] > 0) riverSeeds.push(p);
  });

  // A coastal state can settle any coast on the seas it already touches.
  for (const sea of seas) {
    for (const p of world.water.coastsOf[sea] ?? []) scope[p] = 1;
  }

  // Find the connected river network already inside the country.
  const riverSeen = new Uint8Array(MAP_PIXELS);
  const riverPixels: number[] = [];
  for (const seed of riverSeeds) {
    if (riverSeen[seed]) continue;
    riverSeen[seed] = 1;
    const queue = [seed];
    for (let head = 0; head < queue.length; head += 1) {
      const p = queue[head];
      riverPixels.push(p);
      scope[p] = 1;
      forEachNeighbour(p, (n) => {
        if (world.rivers[n] > 0 && !riverSeen[n]) {
          riverSeen[n] = 1;
          queue.push(n);
        }
      });
    }
  }

  // Approximate each river's catchment as a land corridor around its connected channel.
  if (riverPixels.length > 0) {
    const distance = new Uint8Array(MAP_PIXELS).fill(255);
    const queue: number[] = [];
    for (const p of riverPixels) {
      distance[p] = 0;
      queue.push(p);
    }
    for (let head = 0; head < queue.length; head += 1) {
      const p = queue[head];
      const nextDistance = distance[p] + 1;
      if (nextDistance > RIVER_COLONIZATION_RADIUS) continue;
      forEachNeighbour(p, (n) => {
        if (!world.land[n] || distance[n] <= nextDistance) return;
        distance[n] = nextDistance;
        scope[n] = 1;
        queue.push(n);
      });
    }
  }
  return scope;
}

export function colonizationPlan(world: World, country: Country): ColonizationPlan {
  if (cached?.world === world && cached.version === world.version && cached.countryId === country.id) {
    return cached.plan;
  }
  const averageDensity = demography(world, country).density;
  const geographic = geographicScope(world, country);
  const targets = new Uint8Array(MAP_PIXELS);
  const allies = new Set<number>();
  for (const other of world.countries) {
    if (other.id === country.id || other.pixels <= 0) continue;
    if (areColonizationAllies(world, country, other)) allies.add(other.id);
  }

  const donors: number[] = [];
  let availablePopulation = 0;
  world.forEachCountryPixel(country, (p) => {
    if (world.density[p] > 0) {
      donors.push(p);
      availablePopulation += world.density[p];
    }
  });
  donors.sort((a, b) => world.density[b] - world.density[a] || a - b);

  let targetCount = 0;
  const foreignTargets = new Map<number, number[]>();
  for (const p of world.landIndex) {
    if (!geographic[p] || world.owner[p] === country.id + 1) continue;
    const owner = world.owner[p];
    if (owner > 0 && (world.density[p] >= averageDensity || allies.has(owner - 1))) continue;
    targets[p] = 1;
    targetCount += 1;
    if (owner > 0) {
      const list = foreignTargets.get(owner - 1) ?? [];
      list.push(p);
      foreignTargets.set(owner - 1, list);
    }
  }

  const refugeeSinks = new Map<number, { pixels: number[]; index: number }>();
  for (const [countryId, targetsInCountry] of foreignTargets) {
    const originalCountry = world.countries[countryId];
    const sinks: number[] = [];
    let capacity = 0;
    world.forEachCountryPixel(originalCountry, (p) => {
      if (targets[p] || world.density[p] >= MAX_DENSITY) return;
      sinks.push(p);
      capacity += MAX_DENSITY - world.density[p];
    });
    sinks.sort((a, b) => world.density[a] - world.density[b] || a - b);
    const orderedTargets = [...targetsInCountry].sort((a, b) => world.density[a] - world.density[b] || a - b);
    for (const p of orderedTargets) {
      const displaced = world.density[p];
      if (displaced > capacity) {
        targets[p] = 0;
        targetCount -= 1;
        continue;
      }
      capacity -= displaced;
    }
    refugeeSinks.set(countryId, { pixels: sinks, index: 0 });
  }

  let hint = -1, validCount = 0;
  for (const p of world.landIndex) {
    if (!targets[p]) continue;
    validCount += 1;
    if (hint < 0 || Math.random() < 1 / validCount) hint = p;
  }
  targetCount = validCount;
  const plan = { targets, donors, refugeeSinks, averageDensity, availablePopulation, targetCount, hint };
  cached = { world, version: world.version, countryId: country.id, plan };
  return plan;
}
