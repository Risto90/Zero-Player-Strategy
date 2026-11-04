import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from './config';
import { rasterizePolygonContours } from '../kernel/contour-spans';
import { quantizeShares } from './composition';
import { combineHumanOriginTableMixes } from './human';
import { untrimmedDiscoveredRiverPaths } from './geographyGeometry';
import { forEachNeighbour } from './geography';
import { ContourArea, type ContourBounds } from './contours';
import { densityToResidents } from './populationUnits';
import {
  sumPopulationMeasures,
  takePopulationMeasure,
  type PopulationPriorityTier,
} from './populationMeasures';
import {
  populationCohortsAtPixel,
  setPopulationCohortsAtPixel,
} from './populationCohorts';
import {
  cityInfluenceRadius,
  type CityAccessRoutePoint,
  type CityInfluenceContour,
} from './settlements';
import type { Country, World } from './world';

const EPSILON = 1e-9;

export interface ColonizationPlan {
  targets: Uint8Array;
  anchors: Uint8Array;
  connectedTerritory: Uint8Array;
  routePoints: CityAccessRoutePoint[];
  cityInfluenceAreas: CityInfluenceContour[];
  donors: number[];
  maximumHomeDensity: number;
  availablePopulation: number;
  targetCount: number;
  hint: number;
  targetBounds: ContourBounds;
}

export interface PopulationGroup {
  cultureId: number;
  religionId: number | null;
  population: number;
  humanOriginMix: number;
}

export interface ColonizationTransfer {
  amount: number;
  ink: number;
}

let cached: {
  world: World;
  version: number;
  territoryVersion: number;
  countryId: number;
  plan: ColonizationPlan;
} | null = null;

/** Поддерживает наверху участки колонизатора с наибольшей текущей плотностью населения. */
export class ColonizationDonorHeap {
  private readonly heap: number[] = [];

  constructor(private readonly world: World, pixels: number[]) {
    for (const pixel of pixels) this.heap.push(pixel);
    for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i -= 1) this.siftDown(i);
  }

  peek(): number {
    while (this.heap.length > 0 && this.world.density[this.heap[0]] <= EPSILON) this.pop();
    return this.heap[0] ?? -1;
  }

  /** Вызывать только для точки, только что полученной из peek(); после изменения плотности она вставляется заново. */
  refreshTop(donor: number): void {
    const root = this.pop();
    if (root !== donor) throw new Error('Colonization donor heap changed before transfer.');
    if (this.world.density[donor] > EPSILON) this.push(donor);
  }

  add(pixel: number): void {
    if (this.world.density[pixel] > EPSILON) this.push(pixel);
  }

  private higher(a: number, b: number): boolean {
    const difference = this.world.density[a] - this.world.density[b];
    return Math.abs(difference) > EPSILON ? difference > 0 : a < b;
  }

  private push(pixel: number): void {
    this.heap.push(pixel);
    let child = this.heap.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (!this.higher(this.heap[child], this.heap[parent])) break;
      [this.heap[child], this.heap[parent]] = [this.heap[parent], this.heap[child]];
      child = parent;
    }
  }

  private pop(): number {
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return first ?? -1;
  }

  private siftDown(start: number): void {
    let parent = start;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;
      if (left < this.heap.length && this.higher(this.heap[left], this.heap[best])) best = left;
      if (right < this.heap.length && this.higher(this.heap[right], this.heap[best])) best = right;
      if (best === parent) break;
      [this.heap[parent], this.heap[best]] = [this.heap[best], this.heap[parent]];
      parent = best;
    }
  }
}

/** Формирует совместные группы культуры, веры и происхождения для переселяемого населения. */
export function populationGroupsAt(world: World, pixel: number): PopulationGroup[] {
  const population = world.density[pixel];
  if (population <= EPSILON) return [];
  return populationCohortsAtPixel(world, pixel, population).map((group) => ({
    cultureId: group.cultureId,
    religionId: group.religionId,
    population: group.weight,
    humanOriginMix: world.humanOriginTable.single(group.originProfileId, 100),
  }));
}

function splitGroups(
  groups: readonly PopulationGroup[],
  amount: number,
  reference: readonly PopulationGroup[],
  priority: readonly PopulationPriorityTier[],
): { selected: PopulationGroup[]; remaining: PopulationGroup[] } {
  return takePopulationMeasure(groups, amount, reference, priority);
}

function combineGroups(...sets: readonly PopulationGroup[][]): PopulationGroup[] {
  return sumPopulationMeasures(...sets);
}

function setPixelComposition(world: World, pixel: number, groups: PopulationGroup[]): void {
  const cohorts = [];
  for (const group of groups) {
    const origins = world.humanOriginTable.entries[group.humanOriginMix];
    if (!(origins?.total > 0)) {
      cohorts.push({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId: 0,
        weight: group.population,
      });
      continue;
    }
    origins.ids.forEach((originProfileId, index) => {
      cohorts.push({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId,
        weight: group.population * origins.shares[index] / origins.total,
      });
    });
  }
  setPopulationCohortsAtPixel(world, pixel, cohorts);
}

/** Переносит до 10% населения самого плотного донора в целевую точку, вытесняя столько же местных жителей. */
export function transferColonizationPopulation(
  world: World,
  donor: number,
  target: number,
  inkRemaining: number,
  preserveTargetPopulation = false,
): ColonizationTransfer | null {
  const sourceDensity = world.density[donor];
  const targetDensity = world.owner[target] > 0 ? world.density[target] : 0;
  const ideal = sourceDensity * 0.1;
  if (ideal <= EPSILON || inkRemaining <= 0) return null;

  let maximum = Math.min(ideal, sourceDensity - targetDensity);
  if (world.owner[target] > 0 && !preserveTargetPopulation) maximum = Math.min(maximum, targetDensity);
  const amount = Math.min(maximum, inkRemaining * ideal);
  if (amount <= EPSILON) return null;

  const sourceGroups = populationGroupsAt(world, donor);
  const targetGroups = world.owner[target] > 0 ? populationGroupsAt(world, target) : [];
  const donorSplit = splitGroups(sourceGroups, amount, targetGroups, [0, 1, 2]);
  const migrants = donorSplit.selected;
  const nativeRemoval = world.owner[target] > 0 && !preserveTargetPopulation
    ? splitGroups(targetGroups, amount, sourceGroups, [2, 1, 0])
    : { selected: [], remaining: targetGroups };
  const targetAfter = combineGroups(nativeRemoval.remaining, migrants);

  const remainingDensity = Math.max(0, sourceDensity - amount);
  world.density[donor] = remainingDensity;
  world.density[target] = world.owner[target] > 0
    ? targetDensity + (preserveTargetPopulation ? amount : 0)
    : amount;
  setPixelComposition(world, donor, donorSplit.remaining);
  setPixelComposition(world, target, targetAfter);
  return { amount, ink: amount / ideal };
}

function rulingFamilies(world: World, country: Country): Set<number> {
  const families = new Set([country.ruler.familyId]);
  for (const id of country.coRulerIds) {
    const coRuler = world.people.find((person) => person.id === id);
    if (coRuler) families.add(coRuler.familyId);
  }
  return families;
}

/** Страны считаются союзниками, если ими правит одна династия или их правящие семьи связаны браком. */
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

interface CityAreaRecord {
  cityId: number;
  countryId: number;
  x: number;
  y: number;
  radius: number;
  area: ContourArea;
}

function cityAreaRecords(world: World, cities: readonly World['cities'][number][]): CityAreaRecord[] {
  return cities.map((city) => {
    const x = city.pixel % MAP_WIDTH;
    const y = Math.floor(city.pixel / MAP_WIDTH);
    const radius = cityInfluenceRadius(world, city);
    return {
      cityId: city.id,
      countryId: city.countryId,
      x,
      y,
      radius,
      area: ContourArea.integerCircle(x, y, radius),
    };
  });
}

function riverBasins(riverAreas: ReadonlyMap<number, ContourArea>): ContourArea[] {
  const pending = new Map(riverAreas);
  const basins: ContourArea[] = [];
  while (pending.size > 0) {
    const first = pending.entries().next().value as [number, ContourArea];
    pending.delete(first[0]);
    let basin = first[1];
    let joined: boolean;
    do {
      joined = false;
      for (const [riverId, area] of pending) {
        if (!basin.intersects(area)) continue;
        basin = basin.union(area);
        pending.delete(riverId);
        joined = true;
      }
    } while (joined);
    basins.push(basin);
  }
  return basins;
}

const riverBasinCache = new WeakMap<World, Map<string, ContourArea[]>>();

function countryRiverBasins(world: World, countryId: number): ContourArea[] {
  const cache = riverBasinCache.get(world) ?? new Map<string, ContourArea[]>();
  riverBasinCache.set(world, cache);
  const key = `${countryId}/${world.geographyRevision}`;
  const cachedBasins = cache.get(key);
  if (cachedBasins) return cachedBasins;
  const riverAreas = new Map<number, ContourArea>();
  for (const segment of untrimmedDiscoveredRiverPaths(world, countryId)) {
    const area = new ContourArea(rasterizePolygonContours(
      segment.contourPolygons, MAP_WIDTH, MAP_HEIGHT,
    ));
    const current = riverAreas.get(segment.riverId);
    riverAreas.set(segment.riverId, current ? current.union(area) : area);
  }
  const basins = riverBasins(riverAreas);
  cache.set(key, basins);
  return basins;
}

function extendByRiverBasins(area: ContourArea, basins: readonly ContourArea[]): ContourArea {
  let expanded = area;
  for (const basin of basins) {
    if (expanded.intersects(basin)) expanded = expanded.union(basin);
  }
  return expanded;
}

function coastalRoutes(
  world: World,
  cityAreas: readonly CityAreaRecord[],
  allowedCoast: ContourArea,
): { area: ContourArea; routePoints: CityAccessRoutePoint[] } {
  const routeByPixel = new Map<number, number>();
  let area = new ContourArea();
  const routeColumns = Math.ceil(MAP_WIDTH / 64);
  const routeRows = Math.ceil(MAP_HEIGHT / 64);

  for (let sea = 0; sea < world.water.coastsOf.length; sea += 1) {
    const shore = world.water.coastsOf[sea] ?? [];
    if (!shore.length) continue;
    const seaArea = ContourArea.pixels(shore);
    const coastComponents = seaArea.components().filter((component) => component.intersects(allowedCoast));
    if (!coastComponents.length) continue;
    const linkedCities = cityAreas.filter((city) => city.area.intersects(seaArea));
    if (!linkedCities.length) continue;

    const cityBuckets = new Map<number, CityAreaRecord[]>();
    for (const city of linkedCities) {
      const key = Math.floor(city.y / 64) * routeColumns + Math.floor(city.x / 64);
      const bucket = cityBuckets.get(key) ?? [];
      bucket.push(city);
      cityBuckets.set(key, bucket);
    }
    const nearestCityEdge = (pixel: number): number => {
      const x = pixel % MAP_WIDTH;
      const y = Math.floor(pixel / MAP_WIDTH);
      const bx = Math.floor(x / 64);
      const by = Math.floor(y / 64);
      let nearest = Infinity;
      const check = (bucketX: number, bucketY: number) => {
        if (bucketX < 0 || bucketY < 0 || bucketX >= routeColumns || bucketY >= routeRows) return;
        for (const city of cityBuckets.get(bucketY * routeColumns + bucketX) ?? []) {
          nearest = Math.min(nearest, Math.max(0, Math.hypot(x - city.x, y - city.y) - city.radius));
        }
      };
      for (let ring = 0; ring < Math.max(routeColumns, routeRows); ring += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          check(bx + dx, by - ring);
          if (ring > 0) check(bx + dx, by + ring);
        }
        for (let dy = -ring + 1; dy < ring; dy += 1) {
          check(bx - ring, by + dy);
          if (ring > 0) check(bx + ring, by + dy);
        }
        if (nearest <= Math.max(0, (ring - 1) * 64 - Math.SQRT2 * 64)) break;
      }
      return nearest;
    };

    for (const component of coastComponents) {
      area = area.union(component);
      for (const span of component.spans) {
        const row = span.y * MAP_WIDTH;
        for (let x = span.start; x < span.end; x += 1) {
          const pixel = row + x;
          const extraDistance = nearestCityEdge(pixel) / 2;
          if (!Number.isFinite(extraDistance)) continue;
          const previous = routeByPixel.get(pixel);
          if (previous === undefined || extraDistance < previous) routeByPixel.set(pixel, extraDistance);
        }
      }
    }
  }

  return {
    area,
    routePoints: [...routeByPixel].map(([pixel, extraDistance]) => ({ pixel, extraDistance })),
  };
}

function geographicScope(world: World, country: Country): {
  scope: Uint8Array;
  anchors: Uint8Array;
  routePoints: CityAccessRoutePoint[];
  cityInfluenceAreas: CityInfluenceContour[];
} {
  const scope = new Uint8Array(MAP_PIXELS);
  const anchors = new Uint8Array(MAP_PIXELS);
  const allCityAreas = cityAreaRecords(world, world.cities);
  const cityAreas = allCityAreas.filter((city) => city.countryId === country.id);
  const cityArea = cityAreas.reduce((area, city) => area.union(city.area), new ContourArea());
  const coast = coastalRoutes(world, cityAreas, cityArea);
  const routePoints: CityAccessRoutePoint[] = [...coast.routePoints];
  const basinsByCountry = new Map<number, ContourArea[]>();
  const basinsForCountry = (countryId: number) => {
    let basins = basinsByCountry.get(countryId);
    if (!basins) {
      basins = countryRiverBasins(world, countryId);
      basinsByCountry.set(countryId, basins);
    }
    return basins;
  };
  const ownBasins = basinsForCountry(country.id);
  const cityInfluenceAreas = allCityAreas.map(({ cityId, countryId, area }) => ({
    cityId,
    area: extendByRiverBasins(area, basinsForCountry(countryId)),
  }));
  const expandedOwnArea = cityAreas.reduce(
    (area, city) => area.union(extendByRiverBasins(city.area, ownBasins)),
    new ContourArea(),
  );
  const riverArea = expandedOwnArea.subtract(cityArea);

  for (const span of riverArea.spans) {
    for (let x = span.start; x < span.end; x += 1) {
      routePoints.push({ pixel: span.y * MAP_WIDTH + x, extraDistance: 0 });
    }
  }

  const accessibleArea = cityArea.union(coast.area).union(riverArea);
  for (const areaPixel of accessibleArea.spans) {
    const row = areaPixel.y * MAP_WIDTH;
    for (let x = areaPixel.start; x < areaPixel.end; x += 1) {
      const pixel = row + x;
      scope[pixel] = 1;
      anchors[pixel] = 1;
    }
  }
  return { scope, anchors, routePoints, cityInfluenceAreas };
}

export function expansionCoastRoutePoints(world: World, country: Country): CityAccessRoutePoint[] {
  const cityAreas = cityAreaRecords(
    world,
    world.cities.filter((city) => city.countryId === country.id),
  );
  if (!cityAreas.length) return [];
  const countryArea = world.contours.layer('owner').select(
    (owner) => owner === country.id + 1,
    { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 },
  );
  return coastalRoutes(world, cityAreas, countryArea).routePoints;
}

function connectedCountryTerritory(world: World, country: Country, anchors: Uint8Array): Uint8Array {
  const connected = new Uint8Array(MAP_PIXELS);
  const queue: number[] = [];
  const tag = country.id + 1;
  world.forEachCountryPixel(country, (p) => {
    if (!anchors[p]) return;
    connected[p] = 1;
    queue.push(p);
  });
  for (let head = 0; head < queue.length; head += 1) {
    forEachNeighbour(queue[head], (n) => {
      if (connected[n] || world.owner[n] !== tag) return;
      connected[n] = 1;
      queue.push(n);
    });
  }
  return connected;
}

export function colonizationPlan(world: World, country: Country): ColonizationPlan {
  if (cached?.world === world && cached.version === world.version &&
    cached.territoryVersion === world.territoryVersion && cached.countryId === country.id) {
    return cached.plan;
  }
  let maximumHomeDensity = 0;
  const { scope: geographic, anchors, routePoints, cityInfluenceAreas } = geographicScope(world, country);
  const connectedTerritory = connectedCountryTerritory(world, country, anchors);
  const candidates = new Uint8Array(MAP_PIXELS);
  const targets = new Uint8Array(MAP_PIXELS);
  const allies = new Set<number>();
  for (const other of world.countries) {
    if (other.id === country.id || other.pixels <= 0) continue;
    if (areColonizationAllies(world, country, other)) allies.add(other.id);
  }

  const donors: number[] = [];
  let availablePopulation = 0;
  world.forEachCountryPixel(country, (p) => {
    maximumHomeDensity = Math.max(maximumHomeDensity, world.density[p]);
    if (world.density[p] > 0) {
      donors.push(p);
      availablePopulation += densityToResidents(world.density[p]);
    }
  });
  for (const p of world.landIndex) {
    if (!geographic[p] || world.owner[p] === country.id + 1) continue;
    const owner = world.owner[p];
    if (owner > 0 && (world.density[p] <= EPSILON ||
      world.density[p] >= maximumHomeDensity || allies.has(owner - 1))) continue;
    candidates[p] = 1;
  }

  const queue: number[] = [];
  let hint = -1;
  for (const p of world.landIndex) {
    if (!candidates[p]) continue;
    let linked = anchors[p] === 1;
    if (!linked) {
      forEachNeighbour(p, (n) => {
        if (connectedTerritory[n]) linked = true;
      });
    }
    if (!linked) continue;
    targets[p] = 1;
    queue.push(p);
    if (hint < 0) hint = p;
  }
  for (let head = 0; head < queue.length; head += 1) {
    forEachNeighbour(queue[head], (n) => {
      if (!candidates[n] || targets[n]) return;
      targets[n] = 1;
      queue.push(n);
    });
  }
  const targetCount = queue.length;
  const targetBounds = { x0: MAP_WIDTH, y0: MAP_HEIGHT, x1: -1, y1: -1 };
  for (const pixel of queue) {
    const x = pixel % MAP_WIDTH;
    const y = Math.floor(pixel / MAP_WIDTH);
    targetBounds.x0 = Math.min(targetBounds.x0, x);
    targetBounds.y0 = Math.min(targetBounds.y0, y);
    targetBounds.x1 = Math.max(targetBounds.x1, x);
    targetBounds.y1 = Math.max(targetBounds.y1, y);
  }
  const plan = {
    targets,
    anchors,
    connectedTerritory,
    routePoints,
    cityInfluenceAreas,
    donors,
    maximumHomeDensity,
    availablePopulation,
    targetCount,
    hint,
    targetBounds,
  };
  cached = {
    world,
    version: world.version,
    territoryVersion: world.territoryVersion,
    countryId: country.id,
    plan,
  };
  return plan;
}
