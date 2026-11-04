import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { ContourArea, ContourDistanceBands, type ContourSpan } from './contours';
import { quantizeShares } from './composition';
import {
  combineHumanOriginTableMixes,
  combineHumanOrigins,
  humanOriginMixToTable,
  expectedOriginsForPopulation,
  humanOriginMixFromTable,
  defaultHumanOriginMix,
  humanOriginProfileShares,
  type HumanOriginProfileShare,
  type HumanOriginMix,
} from './human';
import {
  setPopulationCohortsAtPixel,
  type PopulationCohortShare,
  type PopulationCohortWeight,
} from './populationCohorts';
import {
  cityPopulationGroupWeightsAtPixel,
  cityPopulationGroupWeightsFromMix,
  cityPopulationGroupsAtPixel,
  type City,
  type CityPopulationGroup,
  type CityRank,
  type Country,
  type World,
} from './world';
import { apportionIntegerTotal } from '../kernel/proportions';
import { labelGridComponents } from '../kernel/matrix';
import { MAP_POINT_AREA_KM2, densityToResidents, residentsToDensity, roundResidents } from './populationUnits';
import { rasterizePolygonContours } from '../kernel/contour-spans';
import { untrimmedDiscoveredRiverPaths } from './geographyGeometry';
import { sumPopulationMeasures } from './populationMeasures';

/** Радиус, при котором 10% плотности 1 чел./км² дают около 250 жителей. */
export const CITY_BASE_RADIUS = Math.sqrt((250 / 0.1 / MAP_POINT_AREA_KM2) / Math.PI);
export const CITY_BASE_INFLUENCE_AREA_PIXELS = Math.PI * CITY_BASE_RADIUS ** 2;
const CITY_RANK_RADII = [CITY_BASE_RADIUS];
for (let rank = 1; rank < 6; rank += 1) {
  const previous = CITY_RANK_RADII[rank - 1];
  CITY_RANK_RADII.push(Math.max(previous * 1.5, previous + 1));
}
const coastAreaCache = new WeakMap<World, ContourArea>();
const riverAreaCache = new WeakMap<World, Map<string, ContourArea>>();
const cityMultiplierCache = new WeakMap<World, Map<string, number>>();
const landComponentCache = new WeakMap<World, Int32Array>();

function landComponents(world: World): Int32Array {
  const cached = landComponentCache.get(world);
  if (cached) return cached;
  const height = world.land.length / MAP_WIDTH;
  if (!Number.isInteger(height)) throw new Error('Размер земельной матрицы не кратен её ширине.');
  const labels = labelGridComponents(world.land, MAP_WIDTH, height);
  landComponentCache.set(world, labels);
  return labels;
}

function coastContourArea(world: World): ContourArea {
  const cached = coastAreaCache.get(world);
  if (cached) return cached;
  const pixels: number[] = [];
  for (const coast of world.water.coastsOf) for (const pixel of coast) pixels.push(pixel);
  const area = ContourArea.pixels(pixels);
  coastAreaCache.set(world, area);
  return area;
}

function riverContourArea(world: World, countryId: number): ContourArea {
  const cache = riverAreaCache.get(world) ?? new Map<string, ContourArea>();
  riverAreaCache.set(world, cache);
  const key = `${countryId}/${world.geographyRevision}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const spans: ContourSpan[] = [];
  for (const segment of untrimmedDiscoveredRiverPaths(world, countryId)) {
    for (const span of rasterizePolygonContours(
      segment.contourPolygons, MAP_WIDTH, MAP_HEIGHT,
    )) spans.push(span);
  }
  const area = new ContourArea(spans);
  cache.set(key, area);
  return area;
}

export function cityIsRiverPort(world: World, city: City): boolean {
  return riverContourArea(world, city.countryId).contains(city.pixel);
}

export function cityHasPort(world: World, city: City): boolean {
  return world.isCoastal(city.pixel) || cityIsRiverPort(world, city);
}

function baseCityInfluenceArea(city: City): number {
  const radius = cityBaseRadiusForRank(city.rank);
  return Math.PI * radius ** 2;
}

export function cityBaseRadiusForRank(rank: CityRank): number {
  return CITY_RANK_RADII[rank - 1];
}
export const CITY_POPULATION_BANDS = [
  { minimum: 100, maximum: 500 },
  { minimum: 500, maximum: 2_500 },
  { minimum: 2_500, maximum: 10_000 },
  { minimum: 10_000, maximum: 50_000 },
  { minimum: 50_000, maximum: 100_000 },
  { minimum: 100_000, maximum: Infinity },
] as const;

export function cityPopulationMinimum(rank: CityRank): number {
  return CITY_POPULATION_BANDS[rank - 1].minimum;
}

export function cityPopulationMaximum(rank: CityRank): number {
  return CITY_POPULATION_BANDS[rank - 1].maximum;
}

export function cityAtUpperPopulationThreshold(city: City): boolean {
  return city.population >= cityPopulationMaximum(city.rank);
}

export function cityAtWaningThreshold(city: City): boolean {
  return city.population <= cityPopulationMinimum(city.rank) || cityAtUpperPopulationThreshold(city);
}

export function cityInfluenceMultiplier(world: World, city: City): number {
  const cache = cityMultiplierCache.get(world) ?? new Map<string, number>();
  cityMultiplierCache.set(world, cache);
  const key = `${city.countryId}/${world.geographyRevision}/${city.pixel}/${city.rank}/${Number(city.capital)}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const radius = Math.sqrt(baseCityInfluenceArea(city) / Math.PI);
  const x = city.pixel % MAP_WIDTH, y = Math.floor(city.pixel / MAP_WIDTH);
  const initialZone = ContourArea.integerCircle(x, y, radius);
  const rivers = riverContourArea(world, city.countryId);
  const hasRiver = initialZone.intersect(rivers).size > 0;
  const hasCoast = initialZone.intersect(coastContourArea(world)).size > 0;
  const zoneFactor = hasRiver && hasCoast ? 3 : hasRiver || hasCoast ? 2 : 1;
  const specialFactor = city.capital || rivers.contains(city.pixel) || world.isCoastal(city.pixel) ? 2 : 1;
  const multiplier = zoneFactor * specialFactor;
  cache.set(key, multiplier);
  return multiplier;
}

export function cityInfluenceArea(world: World, city: City): number {
  return baseCityInfluenceArea(city) * cityInfluenceMultiplier(world, city);
}

export function cityInfluenceRadius(world: World, city: City): number {
  return Math.sqrt(cityInfluenceArea(world, city) / Math.PI);
}

export function cityRankName(rank: CityRank): string {
  return ['городок', 'город', 'вольный город', 'полис', 'мегаполис', 'конгломерация'][rank - 1];
}

/** Переводит сельскую плотность площади точки в жителей и прибавляет население городской структуры. */
export function populationAtPixel(world: World, pixel: number): number {
  return densityToResidents(world.density[pixel]) + (world.cityAt(pixel)?.population ?? 0);
}

/** Проверяет, что у города верхнего порога в его сфере есть два соседних города той же страны и ранга. */
export function canUpgradeCityRank(world: World, countryId: number, rank: CityRank): boolean {
  if (rank >= 6) return false;
  const influence = new CityInfluenceIndex(world, countryId);
  return world.cities.some((city) =>
    city.countryId === countryId &&
    city.rank === rank &&
    cityAtUpperPopulationThreshold(city) &&
    influence.citiesAt(city.pixel).filter((other) =>
      other.countryId === countryId && other.id !== city.id && other.rank === rank,
    ).length >= 2,
  );
}

export function upgradeableCities(world: World, countryId: number): City[] {
  const result: City[] = [];
  for (let rank = 1; rank < 6; rank += 1) {
    if (!canUpgradeCityRank(world, countryId, rank as CityRank)) continue;
    const influence = new CityInfluenceIndex(world, countryId);
    for (const city of world.cities) {
      if (city.countryId !== countryId || city.rank !== rank || !cityAtUpperPopulationThreshold(city)) continue;
      const neighbours = influence.citiesAt(city.pixel).filter((other) =>
        other.countryId === countryId && other.id !== city.id && other.rank === rank,
      );
      if (neighbours.length >= 2) result.push(city);
    }
  }
  return result;
}

export interface CityInfluence {
  ownRankSum: number;
  ownLargestRank: number;
  ownCityCount: number;
  foreignRankSum: number;
  ownModifier: number;
  foreignModifier: number;
  foreignLargestRank: number;
  nearestOwnDistance: number;
  nearestOwnAnchorDistance: number;
  nearestOwnAnchorPixel: number | null;
  nearestOwnCityId: number | null;
  nearestOwnCityPixel: number | null;
  nearestOwnRadius: number;
}

export interface CityAccessRoutePoint {
  pixel: number;
  extraDistance: number;
}

export interface CityInfluenceContour {
  cityId: number;
  area: ContourArea;
}

type IndexedCity = City & { x: number; y: number; radius: number };
type IndexedRoutePoint = CityAccessRoutePoint & { component: number };
type IndexedCityInfluenceContour = { city: IndexedCity; area: ContourArea };
const BUCKET = 64;
const MAX_CITY_RADIUS = 128;

/**
 * Пространственный индекс на одну карту: не проверяет все города для каждой точки кисти.
 * Контурные зоны влияния для колонизации точно повторяют радиус и окно соседних корзин метода at().
 */
export class CityInfluenceIndex {
  private readonly centers = new Map<number, IndexedCity[]>();
  private readonly anchors = new Map<number, number[]>();
  private readonly routePoints = new Map<number, IndexedRoutePoint[]>();
  private readonly routeComponents = new Set<number>();
  private readonly colonizationZonesByBucket = new Map<number, IndexedCityInfluenceContour[]>();
  private readonly colonizationCityZones: IndexedCityInfluenceContour[] = [];
  private readonly routeSourceAreas = new Map<number, ContourArea>();
  private readonly distanceAreaCache = new Map<number, ContourArea>();
  private distanceBandBuilder: ContourDistanceBands | null = null;
  private distanceSourceArea: ContourArea | null = null;
  private readonly landComponents: Int32Array;
  private readonly maxX = Math.ceil(MAP_WIDTH / BUCKET);
  private readonly maxY = Math.ceil(MAP_HEIGHT / BUCKET);

  constructor(
    private readonly world: World,
    private readonly countryId: number,
    private readonly includeAnchors = false,
    private readonly anchorMask?: Uint8Array,
    routes?: readonly CityAccessRoutePoint[],
    colonizationAreas?: readonly CityInfluenceContour[],
  ) {
    this.landComponents = landComponents(world);
    const seenAnchors = new Set<number>();
    const indexedCities = new Map<number, IndexedCity>();
    const suppliedAreas = new Map(colonizationAreas?.map(({ cityId, area }) => [cityId, area]));
    for (const city of world.cities) {
      const x = city.pixel % MAP_WIDTH;
      const y = Math.floor(city.pixel / MAP_WIDTH);
      const indexed: IndexedCity = { ...city, x, y, radius: cityInfluenceRadius(world, city) };
      indexedCities.set(city.id, indexed);
      const bx = Math.floor(x / BUCKET), by = Math.floor(y / BUCKET);
      const key = this.key(bx, by);
      const list = this.centers.get(key) ?? [];
      list.push(indexed);
      this.centers.set(key, list);
      if (city.countryId !== countryId || !this.includeAnchors) continue;
      const r = Math.ceil(indexed.radius);
      const x0 = Math.max(0, x - r), x1 = Math.min(MAP_WIDTH - 1, x + r);
      const y0 = Math.max(0, y - r), y1 = Math.min(MAP_HEIGHT - 1, y + r);
      const rr = indexed.radius * indexed.radius;
      for (let yy = y0; yy <= y1; yy += 1) {
        for (let xx = x0; xx <= x1; xx += 1) {
          if ((xx - x) ** 2 + (yy - y) ** 2 > rr) continue;
          const p = yy * MAP_WIDTH + xx;
          if (world.land[p] && (world.isCoastal(p) || world.rivers[p] > 0) &&
            (!this.anchorMask || this.anchorMask[p] === 1)) seenAnchors.add(p);
        }
      }
    }
    if (includeAnchors) {
      for (const city of indexedCities.values()) {
        const area = suppliedAreas.get(city.id) ?? ContourArea.integerCircle(city.x, city.y, city.radius);
        const zone = { city, area };
        this.colonizationCityZones.push(zone);
        const bucketKeys = new Set<number>();
        for (const span of area.spans) {
          const bucketY = Math.floor(span.y / BUCKET);
          for (let bucketX = Math.floor(span.start / BUCKET);
            bucketX <= Math.floor((span.end - 1) / BUCKET); bucketX += 1) {
            bucketKeys.add(this.key(bucketX, bucketY));
          }
        }
        for (const key of bucketKeys) {
          const bucket = this.colonizationZonesByBucket.get(key) ?? [];
          bucket.push(zone);
          this.colonizationZonesByBucket.set(key, bucket);
        }
      }
    }
    for (const p of seenAnchors) {
        const anchorKey = this.key(Math.floor((p % MAP_WIDTH) / BUCKET), Math.floor(Math.floor(p / MAP_WIDTH) / BUCKET));
        const bucket = this.anchors.get(anchorKey) ?? [];
        bucket.push(p);
        this.anchors.set(anchorKey, bucket);
    }
    const routePixels = new Map<number, number[]>();
    for (const route of routes ?? []) {
      const component = this.landComponents[route.pixel] ?? -1;
      if (component < 0 || !Number.isFinite(route.extraDistance) || route.extraDistance < 0) continue;
      const x = route.pixel % MAP_WIDTH;
      const y = Math.floor(route.pixel / MAP_WIDTH);
      const routeKey = this.key(Math.floor(x / BUCKET), Math.floor(y / BUCKET));
      const bucket = this.routePoints.get(routeKey) ?? [];
      bucket.push({ ...route, component });
      this.routePoints.set(routeKey, bucket);
      this.routeComponents.add(component);
      const pixels = routePixels.get(route.extraDistance) ?? [];
      pixels.push(route.pixel);
      routePixels.set(route.extraDistance, pixels);
    }
    for (const [extraDistance, pixels] of routePixels) {
      this.routeSourceAreas.set(extraDistance, ContourArea.pixels(pixels));
    }
  }

  colonizationInfluenceAreas(): { own: ContourArea; foreign: ContourArea } {
    const ownSpans: ContourSpan[] = [];
    const foreignSpans: ContourSpan[] = [];
    const zones = this.colonizationCityZones.length
      ? this.colonizationCityZones
      : [...this.centers.values()].flatMap((cities) => cities.map((city) => ({
        city,
        area: ContourArea.integerCircle(city.x, city.y, city.radius),
      })));
    for (const { city, area } of zones) {
      (city.countryId === this.countryId ? ownSpans : foreignSpans).push(...area.spans);
    }
    return {
      own: new ContourArea(ownSpans),
      foreign: new ContourArea(foreignSpans),
    };
  }

  /** Контур точек, достижимых за заданное расстояние от игровых зон и маршрутов. */
  distanceReachableArea(distance: number): ContourArea {
    if (!Number.isFinite(distance) || distance < 0) return new ContourArea();
    const cached = this.distanceAreaCache.get(distance);
    if (cached) return cached;
    this.ensureDistanceSourceArea();
    const area = this.getDistanceBandBuilder().reachableArea(distance);
    this.distanceAreaCache.set(distance, area);
    return area;
  }

  /** Строит единый смещённый контур, сразу ограниченный целевой областью. */
  distanceReachableAreaWithin(area: ContourArea, distance: number): ContourArea {
    if (!Number.isFinite(distance) || distance < 0) return new ContourArea();
    this.ensureDistanceSourceArea();
    return this.getDistanceBandBuilder().reachableAreaWithin(area, distance);
  }

  /** Разбивает заданную область на дистанционные слои средствами контурного ядра. */
  distanceBands(area: ContourArea, step: number, maximumDistance: number): ContourArea[] {
    this.ensureDistanceSourceArea();
    return this.getDistanceBandBuilder().bands(area, step, maximumDistance);
  }

  private getDistanceBandBuilder(): ContourDistanceBands {
    if (!this.distanceBandBuilder) {
      this.distanceBandBuilder = new ContourDistanceBands([
        { area: this.distanceSourceArea! },
        ...[...this.routeSourceAreas].map(([additionalDistance, sourceArea]) => ({
          area: sourceArea,
          additionalDistance,
        })),
      ]);
    }
    return this.distanceBandBuilder;
  }

  private ensureDistanceSourceArea(): void {
    if (this.distanceSourceArea) return;
    if (this.includeAnchors) {
      this.distanceSourceArea = this.colonizationInfluenceAreas().own;
      return;
    }
    const spans = [...this.centers.values()].flatMap((cities) => cities
      .filter((city) => city.countryId === this.countryId)
      .flatMap((city) => ContourArea.integerCircle(city.x, city.y, city.radius).spans));
    this.distanceSourceArea = new ContourArea(spans);
  }

  maximumRouteExtraDistance(): number {
    let maximum = 0;
    for (const distance of this.routeSourceAreas.keys()) maximum = Math.max(maximum, distance);
    return maximum;
  }

  at(pixel: number, needAnchor = false): CityInfluence {
    const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
    const bx = Math.floor(x / BUCKET), by = Math.floor(y / BUCKET);
    const landComponent = this.landComponents[pixel] ?? -1;
    let ownRankSum = 0, ownLargestRank = 0, ownCityCount = 0, foreignRankSum = 0;
    let ownProduct = 1, foreignProduct = 1, foreignLargestRank = 0;
    let nearestOwnDistance = Infinity, nearestOwnCityId: number | null = null;
    let nearestOwnCityPixel: number | null = null, nearestOwnRadius = 0;
    const addCityInfluence = (city: IndexedCity) => {
      if (city.countryId === this.countryId) {
        ownRankSum += city.rank;
        ownCityCount += 1;
        ownLargestRank = Math.max(ownLargestRank, city.rank);
        ownProduct *= city.rank * cityInfluenceMultiplier(this.world, city);
      } else {
        foreignRankSum += city.rank;
        foreignLargestRank = Math.max(foreignLargestRank, city.rank);
        foreignProduct *= city.rank * cityInfluenceMultiplier(this.world, city);
      }
    };
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        for (const city of this.centers.get(this.key(bx + dx, by + dy)) ?? []) {
          const distance = Math.hypot(city.x - x, city.y - y);
          const edgeDistance = Math.max(0, distance - city.radius);
          if (city.countryId === this.countryId) {
            if (!needAnchor && distance <= city.radius) addCityInfluence(city);
            if (landComponent >= 0 && this.landComponents[city.pixel] === landComponent &&
              edgeDistance < nearestOwnDistance) {
              nearestOwnDistance = edgeDistance;
              nearestOwnCityId = city.id;
              nearestOwnCityPixel = city.pixel;
              nearestOwnRadius = city.radius;
            }
          } else if (!needAnchor && distance <= city.radius) {
            addCityInfluence(city);
          }
        }
      }
    }
    if (needAnchor) {
      for (const zone of this.colonizationZonesByBucket.get(this.key(bx, by)) ?? []) {
        if (zone.area.contains(pixel)) addCityInfluence(zone.city);
      }
    }
    if (this.countryId >= 0 && (nearestOwnCityId === null || nearestOwnDistance > 0)) {
      for (let ring = 3; ring < Math.max(this.maxX, this.maxY); ring += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          for (const dy of [-ring, ring]) this.checkCities(bx + dx, by + dy, x, y, (city, distance) => {
            if (city.countryId !== this.countryId) return;
            const edgeDistance = Math.max(0, distance - city.radius);
            if (landComponent >= 0 && this.landComponents[city.pixel] === landComponent &&
              edgeDistance < nearestOwnDistance) {
              nearestOwnDistance = edgeDistance;
              nearestOwnCityId = city.id;
              nearestOwnCityPixel = city.pixel;
              nearestOwnRadius = city.radius;
            }
          });
        }
        for (let dy = -ring + 1; dy < ring; dy += 1) {
          for (const dx of [-ring, ring]) this.checkCities(bx + dx, by + dy, x, y, (city, distance) => {
            if (city.countryId !== this.countryId) return;
            const edgeDistance = Math.max(0, distance - city.radius);
            if (landComponent >= 0 && this.landComponents[city.pixel] === landComponent &&
              edgeDistance < nearestOwnDistance) {
              nearestOwnDistance = edgeDistance;
              nearestOwnCityId = city.id;
              nearestOwnCityPixel = city.pixel;
              nearestOwnRadius = city.radius;
            }
          });
        }
        if (nearestOwnCityId !== null && nearestOwnDistance <= Math.max(0, (ring - 1) * BUCKET - MAX_CITY_RADIUS)) break;
      }
    }
    const nearestAnchor = this.countryId >= 0 && needAnchor
      ? this.nearestAnchor(x, y, bx, by)
      : { distance: Infinity, pixel: null };
    return {
      ownRankSum,
      ownLargestRank,
      ownCityCount,
      foreignRankSum,
      ownModifier: ownProduct,
      foreignModifier: foreignProduct,
      foreignLargestRank,
      nearestOwnDistance,
      nearestOwnAnchorDistance: nearestAnchor.distance,
      nearestOwnAnchorPixel: nearestAnchor.pixel,
      nearestOwnCityId,
      nearestOwnCityPixel,
      nearestOwnRadius,
    };
  }

  citiesAt(pixel: number): City[] {
    const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
    const bx = Math.floor(x / BUCKET), by = Math.floor(y / BUCKET);
    const result: City[] = [];
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        for (const city of this.centers.get(this.key(bx + dx, by + dy)) ?? []) {
          if (Math.hypot(city.x - x, city.y - y) <= city.radius) {
            const current = this.world.cities[city.id];
            if (current) result.push(current);
          }
        }
      }
    }
    return result;
  }

  /** Находит расстояние до ближайшего доступного берега или русла с учётом водного участка маршрута. */
  nearestRouteDistance(pixel: number, upperBound = Infinity): number {
    const component = this.landComponents[pixel] ?? -1;
    if (component < 0 || !this.routeComponents.has(component)) return upperBound;
    const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
    const bx = Math.floor(x / BUCKET), by = Math.floor(y / BUCKET);
    let nearest = upperBound;
    const check = (bucketX: number, bucketY: number) => {
      for (const route of this.routePoints.get(this.key(bucketX, bucketY)) ?? []) {
        if (route.component !== component) continue;
        const distance = Math.hypot(route.pixel % MAP_WIDTH - x, Math.floor(route.pixel / MAP_WIDTH) - y) +
          route.extraDistance;
        if (distance < nearest) nearest = distance;
      }
    };
    for (let ring = 0; ring < Math.max(this.maxX, this.maxY); ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (const dy of [-ring, ring]) check(bx + dx, by + dy);
      }
      for (let dy = -ring + 1; dy < ring; dy += 1) {
        for (const dx of [-ring, ring]) check(bx + dx, by + dy);
      }
      const lowerBound = Math.max(0, (ring - 1) * BUCKET - Math.SQRT2 * BUCKET);
      if (nearest <= lowerBound) break;
    }
    return nearest;
  }

  private nearestAnchor(x: number, y: number, bx: number, by: number): { distance: number; pixel: number | null } {
    let nearest = Infinity, nearestPixel: number | null = null;
    for (let ring = 0; ring < Math.max(this.maxX, this.maxY); ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (const dy of [-ring, ring]) this.checkAnchors(bx + dx, by + dy, x, y, (p, d) => {
          if (d < nearest) { nearest = d; nearestPixel = p; }
        });
      }
      for (let dy = -ring + 1; dy < ring; dy += 1) {
        for (const dx of [-ring, ring]) this.checkAnchors(bx + dx, by + dy, x, y, (p, d) => {
          if (d < nearest) { nearest = d; nearestPixel = p; }
        });
      }
      const lowerBound = Math.max(0, (ring - 1) * BUCKET - Math.SQRT2 * BUCKET);
      if (nearest <= lowerBound) break;
    }
    return { distance: nearest, pixel: nearestPixel };
  }

  private checkAnchors(bx: number, by: number, x: number, y: number, visit: (pixel: number, distance: number) => void): void {
    for (const pixel of this.anchors.get(this.key(bx, by)) ?? []) {
      visit(pixel, Math.hypot(pixel % MAP_WIDTH - x, Math.floor(pixel / MAP_WIDTH) - y));
    }
  }

  private checkCities(bx: number, by: number, x: number, y: number, visit: (city: IndexedCity, distance: number) => void): void {
    for (const city of this.centers.get(this.key(bx, by)) ?? []) visit(city, Math.hypot(city.x - x, city.y - y));
  }

  private key(x: number, y: number): number {
    return x >= 0 && x < this.maxX && y >= 0 && y < this.maxY ? y * this.maxX + x : -1;
  }
}

type Pair = { culture: number; religion: number | null; population: number; humanOriginMix: number };

/** Восстанавливает отсутствующие данные города по точке основания и согласует численность групп. */
export function ensureCityPopulationGroups(world: World, city: City): CityPopulationGroup[] {
  city.population = roundResidents(city.population);
  if (city.population === 0) {
    if (world.cities[city.id] === city) removeCityAndChooseCapital(world, city);
    city.populationGroups = [];
    return [];
  }
  let groups = city.populationGroups;
  if (!groups?.length && city.population > 0) {
    groups = cityPopulationGroupsAtPixel(world, city.pixel, city.population);
  }
  groups ??= [];
  const legacyOriginMix = world.humanOrigins[city.pixel] || world.humanOriginTable.single(0, 100);
  groups = groups.map((group) => ({
    ...group,
    humanOriginMix: Number.isInteger(group.humanOriginMix) &&
      world.humanOriginTable.entries[group.humanOriginMix]?.total === 100
      ? group.humanOriginMix
      : legacyOriginMix,
  }));
  const weights = groups.map((group) => Math.max(0, group.population));
  const total = weights.reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) groups = cityPopulationGroupsAtPixel(world, city.pixel, city.population);
  else if (Math.abs(total - city.population) > 1e-8 || groups.some((group) => !Number.isInteger(group.population))) {
    const counts = apportionIntegerTotal(city.population, weights);
    groups = groups.flatMap((group, index) => counts[index] > 0
      ? [{ ...group, population: counts[index] }]
      : []);
  }
  city.populationGroups = groups;
  return groups;
}

/** Пропорционально изменяет численность групп города, сохраняя городской состав населения. */
export function resizeCityPopulation(world: World, city: City, population: number): void {
  const groups = ensureCityPopulationGroups(world, city);
  const target = roundResidents(population);
  if (target === 0) {
    removeCityAndChooseCapital(world, city);
    return;
  }
  const currentWeights = groups.map((group) => Math.max(0, group.population));
  const counts = currentWeights.some((weight) => weight > 0)
    ? apportionIntegerTotal(target, currentWeights)
    : null;
  city.populationGroups = counts
    ? groups.flatMap((group, index) => counts[index] > 0 ? [{ ...group, population: counts[index] }] : [])
    : cityPopulationGroupsAtPixel(world, city.pixel, target);
  city.population = target;
}

/** Пропорционально удаляет жителей, затем добавляет полученные группы населения. */
export function changeCityPopulation(
  world: World,
  city: City,
  additions: CityPopulationGroup[] = [],
  remove = 0,
): void {
  const groups = ensureCityPopulationGroups(world, city);
  const total = groups.reduce((sum, group) => sum + group.population, 0);
  const remaining = Math.max(0, total - Math.max(0, remove));
  const scale = total > 0 ? remaining / total : 0;
  const retained = groups.flatMap((group) => {
    const humanOriginMix = Number.isInteger(group.humanOriginMix) &&
      world.humanOriginTable.entries[group.humanOriginMix]?.total === 100
      ? group.humanOriginMix
      : world.humanOriginTable.single(0, 100);
    const population = group.population * scale;
    return population > 1e-9 ? [{ ...group, humanOriginMix, population }] : [];
  });
  const incoming = additions.flatMap((group) => {
    const humanOriginMix = Number.isInteger(group.humanOriginMix) &&
      world.humanOriginTable.entries[group.humanOriginMix]?.total === 100
      ? group.humanOriginMix
      : world.humanOriginTable.single(0, 100);
    return group.population > 1e-9 ? [{ ...group, humanOriginMix }] : [];
  });
  const entries = sumPopulationMeasures(retained, incoming);
  const target = roundResidents(entries.reduce((sum, group) => sum + group.population, 0));
  if (target === 0) {
    removeCityAndChooseCapital(world, city);
    return;
  }
  const counts = apportionIntegerTotal(target, entries.map((group) => Math.max(0, group.population)));
  city.populationGroups = entries.flatMap((group, index) => counts[index] > 0
    ? [{ ...group, population: counts[index] }]
    : []);
  city.population = target;
}

function pixelGroups(world: World, pixel: number, residents = densityToResidents(world.density[pixel])): CityPopulationGroup[] {
  return cityPopulationGroupsAtPixel(world, pixel, residents);
}

function writePixelPopulationGroups(
  world: World,
  pixel: number,
  groups: readonly { cultureId: number; religionId: number | null; humanOriginMix: number; weight: number }[],
): void {
  const cohorts: PopulationCohortWeight[] = [];
  for (const group of groups) {
    if (!(group.weight > 0)) continue;
    const entry = world.humanOriginTable.entries[group.humanOriginMix];
    if (entry?.total > 0) {
      entry.ids.forEach((originProfileId, index) => cohorts.push({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId,
        weight: group.weight * entry.shares[index] / entry.total,
      }));
    } else {
      cohorts.push({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId: 0,
        weight: group.weight,
      });
    }
  }
  setPopulationCohortsAtPixel(world, pixel, cohorts);
}

function addGroupsToPixel(world: World, pixel: number, additions: CityPopulationGroup[]): void {
  const city = world.cityAt(pixel);
  if (city) {
    changeCityPopulation(world, city, additions);
    return;
  }
  const initial = pixelGroups(world, pixel);
  const groups = [...initial, ...additions];
  world.density[pixel] += residentsToDensity(additions.reduce((sum, group) => sum + group.population, 0));
  writePixelPopulationGroups(world, pixel, groups.map((group) => ({
    cultureId: group.cultureId,
    religionId: group.religionId,
    humanOriginMix: group.humanOriginMix,
    weight: group.population,
  })));
}

function takeCityPopulation(world: World, city: City, amount: number): CityPopulationGroup[] {
  const groups = ensureCityPopulationGroups(world, city);
  const total = groups.reduce((sum, group) => sum + group.population, 0);
  const taken = Math.min(roundResidents(Math.max(0, amount)), total);
  if (taken <= 0) return [];
  const scale = total > 0 ? taken / total : 0;
  const amounts = apportionIntegerTotal(taken, groups.map((group) => group.population));
  const removed = groups.flatMap((group, index) => amounts[index] > 0
    ? [{ ...group, population: amounts[index] }]
    : []);
  resizeCityPopulation(world, city, total - taken);
  return removed;
}

function addGroupsAcrossPixels(
  world: World,
  pixels: number[],
  groups: CityPopulationGroup[],
): void {
  if (!pixels.length) return;
  const totalResidents = roundResidents(groups.reduce((sum, group) => sum + group.population, 0));
  const groupCounts = apportionIntegerTotal(
    totalResidents,
    groups.map((group) => group.population),
  );
  const allocations = groupCounts.map((count) => apportionIntegerTotal(
    count,
    pixels.map(() => 1),
  ));
  for (let index = 0; index < pixels.length; index += 1) {
    const perPixel = groups.flatMap((group, groupIndex) => allocations[groupIndex][index] > 0
      ? [{ ...group, population: allocations[groupIndex][index] }]
      : []);
    if (perPixel.length) addGroupsToPixel(world, pixels[index], perPixel);
  }
  const assigned = allocations.reduce((sum, allocation) => sum + allocation.reduce((part, amount) => part + amount, 0), 0);
  if (assigned !== totalResidents) {
    throw new Error('Распределение жителей по точкам не сохранило исходное целое количество.');
  }
}

function apportionByWeightWithCaps(
  items: { city: City; weight: number; capacity: number }[],
  requested: number,
): Map<number, number> {
  const allocated = new Map<number, number>();
  let remaining = roundResidents(requested);
  let active = items.filter((item) => item.capacity > 1e-9 && item.weight > 0);
  while (remaining > 1e-9 && active.length) {
    const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
    let capped = false;
    for (const item of active) {
      const prior = allocated.get(item.city.id) ?? 0;
      const share = remaining * item.weight / totalWeight;
      const room = item.capacity - prior;
      if (share >= room - 1e-9) {
        const amount = Math.min(remaining, roundResidents(room));
        allocated.set(item.city.id, prior + amount);
        remaining -= amount;
        active = active.filter((candidate) => candidate.city.id !== item.city.id);
        capped = true;
        break;
      }
    }
    if (capped) continue;
    const split = apportionIntegerTotal(remaining, active.map((item) => item.weight));
    active.forEach((item, index) =>
      allocated.set(item.city.id, (allocated.get(item.city.id) ?? 0) + split[index]));
    remaining = 0;
  }
  return allocated;
}

/** Создаёт новую плотность и отдельно переселяет её рассчитанную долю в города. */
export function applyDensityGrowth(
  world: World,
  pixel: number,
  amount: number,
  coveringCities?: City[],
  growthComposition?: {
    cultureMix: number;
    religionMix: number;
    humanOriginMix: number;
    populationCohorts?: PopulationCohortShare[];
  },
): void {
  if (amount <= 0) return;
  const cities = coveringCities ?? new CityInfluenceIndex(world, -1).citiesAt(pixel);
  const eligible = cities.filter((city) => !cityAtUpperPopulationThreshold(city));
  const cultureMix = growthComposition?.cultureMix ?? world.culture[pixel];
  const religionMix = growthComposition?.religionMix ?? world.religion[pixel];
  const humanOriginMix = growthComposition?.humanOriginMix ?? world.humanOrigins[pixel];
  const growthResidents = densityToResidents(amount);
  const shares = new Map<number, number>();
  if (cities.length <= 5) {
    for (const city of eligible) shares.set(city.id, amount * 0.1);
  } else if (eligible.length) {
    const totalWeight = eligible.reduce(
      (sum, city) => sum + city.rank * cityInfluenceMultiplier(world, city),
      0,
    );
    for (const city of eligible) {
      shares.set(city.id, amount * 0.5 * city.rank * cityInfluenceMultiplier(world, city) / totalWeight);
    }
  }
  const totalGrowthResidents = Math.max(0, roundResidents(densityToResidents(amount)));
  const allocatedCityResidents = Math.min(totalGrowthResidents, roundResidents(
    densityToResidents([...shares.values()].reduce((sum, share) => sum + share, 0)),
  ));
  const cityAllocations = apportionIntegerTotal(
    allocatedCityResidents,
    eligible.map((city) => shares.get(city.id) ?? 0),
  );
  const growthGroups = growthComposition?.populationCohorts?.length
    ? growthComposition.populationCohorts.map((group) => ({
      cultureId: group.cultureId,
      religionId: group.religionId,
      humanOriginMix: world.humanOriginTable.single(group.originProfileId, 100),
      weight: growthResidents * group.share / 100,
    }))
    : growthComposition
      ? cityPopulationGroupWeightsFromMix(world, cultureMix, religionMix, humanOriginMix, growthResidents)
      : cityPopulationGroupWeightsAtPixel(world, pixel, growthResidents);
  let cityIndex = 0;
  for (const city of eligible) {
    const amountResidents = cityAllocations[cityIndex++];
    if (amountResidents <= 0) continue;
    const amounts = apportionIntegerTotal(amountResidents, growthGroups.map((group) => group.weight));
    changeCityPopulation(world, city, growthGroups.flatMap((group, index) => amounts[index] > 0 ? [{
      ...group,
      population: amounts[index],
    }] : []));
  }
  const ruralGrowth = Math.max(0, amount - residentsToDensity(allocatedCityResidents));
  const oldGroups = cityPopulationGroupWeightsAtPixel(
    world, pixel, densityToResidents(world.density[pixel]),
  );
  const ruralGrowthResidents = densityToResidents(ruralGrowth);
  const retainedGroups = growthResidents > 0
    ? growthGroups.map((group) => ({
      ...group,
      weight: group.weight * ruralGrowthResidents / growthResidents,
    }))
    : [];
  world.density[pixel] += ruralGrowth;
  writePixelPopulationGroups(world, pixel, [...oldGroups, ...retainedGroups]);
}

/**
 * Применяет обычную убыль плотности. Близлежащие города того же государства
 * пропорционально освобождают жителей, не опускаясь ниже минимума своего ранга.
 */
export function applyDensityLoss(world: World, pixel: number, requested: number): number {
  const loss = Math.min(Math.max(0, requested), world.density[pixel]);
  if (loss <= 0) return 0;
  const countryId = world.owner[pixel] - 1;
  const covering = new CityInfluenceIndex(world, countryId).citiesAt(pixel);
  const sourceCity = world.cityAt(pixel);
  const donors = covering
    .filter((city) => city.countryId === countryId && city.id !== sourceCity?.id)
    .map((city) => ({
      city,
      weight: city.rank * cityInfluenceMultiplier(world, city),
      capacity: Math.max(0, city.population - cityPopulationMinimum(city.rank)),
    }));
  const requestedResidents = Math.min(roundResidents(densityToResidents(loss)),
    Math.floor(donors.reduce((sum, donor) => sum + donor.capacity, 0)));
  const allocations = apportionByWeightWithCaps(donors, requestedResidents);
  const migrated: CityPopulationGroup[] = [];
  for (const donor of donors) {
    const amount = allocations.get(donor.city.id) ?? 0;
    if (amount > 0) migrated.push(...takeCityPopulation(world, donor.city, amount));
  }
  const compensated = migrated.reduce((sum, group) => sum + group.population, 0);
  const baseGroups = pixelGroups(world, pixel);
  let toRemove = loss * MAP_POINT_AREA_KM2;
  for (const group of baseGroups) {
    if (toRemove <= 0) break;
    const take = Math.min(group.population, toRemove);
    group.population -= take;
    toRemove -= take;
  }
  const remainingGroups = [...baseGroups, ...migrated].filter((group) => group.population > 1e-9);
  world.density[pixel] = Math.max(0, world.density[pixel] - loss + residentsToDensity(compensated));
  writePixelPopulationGroups(world, pixel, remainingGroups.map((group) => ({
    cultureId: group.cultureId,
    religionId: group.religionId,
    humanOriginMix: group.humanOriginMix,
    weight: group.population,
  })));
  world.version += 1;
  return loss;
}

/** Добавляет жителей государства к сельской точке или городу, сохраняя состав групп. */
export function settlePopulationGroups(world: World, pixel: number, groups: CityPopulationGroup[]): void {
  addGroupsToPixel(world, pixel, groups);
}

export function removeCityAndChooseCapital(world: World, city: City): City | null {
  const countryId = city.countryId;
  const wasCapital = city.capital;
  world.removeCity(city.id);
  const remaining = world.cities.filter((candidate) => candidate.countryId === countryId);
  if (!remaining.length) return null;
  let capital = remaining.find((candidate) => candidate.capital) ?? null;
  if (!capital || wasCapital) {
    capital = [...remaining].sort((a, b) => b.population - a.population || b.rank - a.rank || a.pixel - b.pixel)[0];
  }
  for (const candidate of remaining) candidate.capital = candidate.id === capital.id;
  return capital;
}

export interface CityWaningResult {
  removed: boolean;
  transferredPopulation: number;
  affectedPixels: number[];
}

/** Применяет правила убыли населения, переселения, понижения ранга и смены столицы. */
export function applyCityWaning(world: World, city: City): CityWaningResult | null {
  if (!cityAtWaningThreshold(city)) return null;
  const countryId = city.countryId;
  const x = city.pixel % MAP_WIDTH, y = Math.floor(city.pixel / MAP_WIDTH);
  const radius = cityInfluenceRadius(world, city);
  const x0 = Math.max(0, Math.floor(x - radius)), x1 = Math.min(MAP_WIDTH - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius)), y1 = Math.min(MAP_HEIGHT - 1, Math.ceil(y + radius));
  const r2 = radius * radius;
  const targets: number[] = [];
  for (let yy = y0; yy <= y1; yy += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      const pixel = yy * MAP_WIDTH + xx;
      if (!world.land[pixel] || world.owner[pixel] !== countryId + 1 ||
        (xx - x) ** 2 + (yy - y) ** 2 > r2) continue;
      targets.push(pixel);
    }
  }
  if (city.population > cityPopulationMinimum(city.rank)) {
    const before = ensureCityPopulationGroups(world, city).map((group) => ({ ...group }));
    const populationBefore = city.population;
    resizeCityPopulation(world, city, populationBefore * 0.8);
    const actualLoss = populationBefore - city.population;
    const settlementAmount = roundResidents(actualLoss * 0.5);
    const settlementCounts = apportionIntegerTotal(settlementAmount, before.map((group) => group.population));
    const settlementGroups = before.map((group, index) => ({
      ...group,
      population: settlementCounts[index],
    })).filter((group) => group.population > 0);
    const settlementPixels = targets.filter((pixel) => pixel !== city.pixel);
    addGroupsAcrossPixels(world, settlementPixels, settlementGroups);
    world.version += 1;
    return {
      removed: false,
      transferredPopulation: settlementPixels.length ? settlementAmount : 0,
      affectedPixels: [...new Set([city.pixel, ...settlementPixels])],
    };
  }

  if (city.rank > 1) {
    city.rank = (city.rank - 1) as CityRank;
    world.version += 1;
    return { removed: false, transferredPopulation: 0, affectedPixels: [city.pixel] };
  }

  const population = city.population;
  const settlementAmount = roundResidents(population * 0.5);
  const groups = ensureCityPopulationGroups(world, city)
    .map((group) => ({ ...group, population: group.population * settlementAmount / Math.max(1, population) }));
  const settlementCounts = apportionIntegerTotal(settlementAmount, groups.map((group) => group.population));
  const settlementGroups = groups.map((group, index) => ({ ...group, population: settlementCounts[index] }))
    .filter((group) => group.population > 0);
  removeCityAndChooseCapital(world, city);
  addGroupsAcrossPixels(world, targets, settlementGroups);
  world.version += 1;
  return {
    removed: true,
    transferredPopulation: targets.length ? settlementAmount : 0,
    affectedPixels: [...new Set([city.pixel, ...targets])],
  };
}

export function cityComposition(world: World, city: City): {
  cultures: { id: number; percent: number }[];
  religions: { id: number | null; percent: number }[];
  humanOrigins: HumanOriginProfileShare[] | null;
} {
  const groups = ensureCityPopulationGroups(world, city);
  const cultures = new Map<number, number>();
  const religions = new Map<number | null, number>();
  const total = groups.reduce((sum, group) => sum + group.population, 0);
  for (const group of groups) {
    cultures.set(group.cultureId, (cultures.get(group.cultureId) ?? 0) + group.population);
    religions.set(group.religionId, (religions.get(group.religionId) ?? 0) + group.population);
  }
  const shares = <T,>(values: Map<T, number>) => [...values.entries()]
    .map(([id, population]) => ({ id, percent: total > 0 ? Math.round(population / total * 1000) / 10 : 0 }))
    .sort((a, b) => b.percent - a.percent);
  const originProfiles = new Map<number, number>();
  for (const group of groups) {
    if (!(group.population > 0)) continue;
    const entry = world.humanOriginTable.entries[group.humanOriginMix];
    if (entry?.total > 0) entry.ids.forEach((profileId, index) => {
      originProfiles.set(profileId, (originProfiles.get(profileId) ?? 0) +
        group.population * entry.shares[index] / entry.total);
    });
  }
  return {
    cultures: shares(cultures),
    religions: shares(religions),
    humanOrigins: humanOriginProfileShares(originProfiles, total),
  };
}

/** Переселяет часть населения точки в город, отдавая приоритет совпадениям с его группами. */
export function movePopulationToCity(world: World, source: number, target: number, amount: number, _fromCityRural = true): number {
  if (source === target || amount <= 0 || world.density[source] <= 0) return 0;
  const sourcePairs: Pair[] = cityPopulationGroupWeightsAtPixel(
    world, source, densityToResidents(world.density[source]),
  ).map((group) => ({
    culture: group.cultureId,
    religion: group.religionId,
    population: group.weight,
    humanOriginMix: group.humanOriginMix,
  }));

  const requested = roundResidents(amount);
  const transferable = Math.min(requested, Math.floor(densityToResidents(world.density[source]) + 1e-9));
  const sourceResidentWeights = apportionIntegerTotal(
    Math.floor(densityToResidents(world.density[source]) + 1e-9),
    sourcePairs.map((group) => group.population),
  );
  sourcePairs.forEach((group, index) => { group.population = sourceResidentWeights[index]; });
  const movedResidents = apportionIntegerTotal(transferable, sourcePairs.map((group) => group.population));
  const moved = new Map<string, Pair>();
  sourcePairs.forEach((group, index) => {
    const take = Math.min(group.population, movedResidents[index] ?? 0);
    if (take <= 0) return;
    const key = `${group.culture}/${group.religion ?? -1}/${group.humanOriginMix}`;
    const current = moved.get(key);
    if (current) current.population += take;
    else moved.set(key, { ...group, population: take });
    group.population -= take;
  });
  const actual = [...moved.values()].reduce((sum, group) => sum + group.population, 0);
  if (actual <= 0) return 0;

  const updateMix = (pixel: number, groups: Pair[]) => {
    writePixelPopulationGroups(world, pixel, groups.map((group) => ({
      cultureId: group.culture,
      religionId: group.religion,
      humanOriginMix: group.humanOriginMix,
      weight: group.population,
    })));
  };
  const sourceTotal = Math.max(0, world.density[source] - residentsToDensity(actual));
  const sourceRemain = sourcePairs.filter((group) => group.population > 1e-9);
  world.density[source] = Math.max(0, sourceTotal);
  updateMix(source, sourceRemain);

  const targetCity = world.cityAt(target);
  if (targetCity) {
    changeCityPopulation(
      world,
      targetCity,
      [...moved.values()].map((group) => ({
        cultureId: group.culture,
        religionId: group.religion,
        population: group.population,
        humanOriginMix: group.humanOriginMix,
      })),
    );
  } else {
    const targetTotal = densityToResidents(world.density[target]);
    const targetPairs: Pair[] = cityPopulationGroupWeightsAtPixel(world, target, targetTotal)
      .map((group) => ({
        culture: group.cultureId,
        religion: group.religionId,
        population: group.weight,
        humanOriginMix: group.humanOriginMix,
      }));
    targetPairs.push(...moved.values());
    world.density[target] += residentsToDensity(actual);
    updateMix(target, targetPairs);
  }
  return actual;
}

interface CityDensityCollection {
  population: number;
  groups: CityPopulationGroup[];
  densityTaken: { pixel: number; amount: number }[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

function planCityDensityCollection(world: World, city: City, share = 0.1): CityDensityCollection | null {
  const radius = cityInfluenceRadius(world, city);
  const x = city.pixel % MAP_WIDTH, y = Math.floor(city.pixel / MAP_WIDTH);
  const bounds = {
    x0: Math.max(0, Math.floor(x - radius)),
    y0: Math.max(0, Math.floor(y - radius)),
    x1: Math.min(MAP_WIDTH - 1, Math.ceil(x + radius)),
    y1: Math.min(MAP_HEIGHT - 1, Math.ceil(y + radius)),
  };
  const zone = ContourArea.integerCircle(x, y, radius);
  const land = world.contours.layer('land').select((value) => value === 1, bounds, 'land');
  const populated = world.contours.layer('density').select((value) => value > 0, bounds);
  const cells = zone.intersect(land).intersect(populated);
  const densityTaken: CityDensityCollection['densityTaken'] = [];
  const groupWeights = new Map<string, CityPopulationGroup & { population: number }>();
  let exactResidents = 0;
  for (const pixel of cells) {
    const amount = world.density[pixel] * MAP_POINT_AREA_KM2 * share;
    if (!(amount > 0)) continue;
    densityTaken.push({ pixel, amount });
    exactResidents += amount;
    for (const group of cityPopulationGroupWeightsAtPixel(world, pixel, amount)) {
      const key = `${group.cultureId}/${group.religionId ?? -1}/${group.humanOriginMix}`;
      const existing = groupWeights.get(key);
      if (existing) existing.population += group.weight;
      else groupWeights.set(key, {
        cultureId: group.cultureId,
        religionId: group.religionId,
        humanOriginMix: group.humanOriginMix,
        population: group.weight,
      });
    }
  }
  const population = roundResidents(exactResidents);
  if (population <= 0 || exactResidents <= 0) return null;
  const groups = [...groupWeights.values()];
  const amounts = apportionIntegerTotal(population, groups.map((group) => group.population));
  return {
    population,
    groups: groups.flatMap((group, index) => amounts[index] > 0
      ? [{ ...group, population: amounts[index] }]
      : []),
    densityTaken: densityTaken.map((entry) => ({
      pixel: entry.pixel,
      amount: entry.amount * population / exactResidents,
    })),
    bounds,
  };
}

function applyCityDensityCollection(world: World, city: City, plan: CityDensityCollection, cityAlreadyReceived = false): void {
  for (const { pixel, amount } of plan.densityTaken) {
    const remaining = Math.max(0, world.density[pixel] - residentsToDensity(amount));
    world.density[pixel] = remaining;
    if (remaining <= 0) setPopulationCohortsAtPixel(world, pixel, []);
  }
  world.contours.changed(plan.bounds, ['density']);
  world.version += 1;
  if (!cityAlreadyReceived && world.cities[city.id] === city) changeCityPopulation(world, city, plan.groups);
}

export function concentrateCityPopulation(world: World, city: City): void {
  const plan = planCityDensityCollection(world, city);
  if (!plan) return;
  applyCityDensityCollection(world, city, plan);
}

export function addCityAndConcentrate(world: World, countryId: number, pixel: number, capital = false): City | null {
  const candidate = { countryId, pixel, rank: 1, capital } as City;
  const plan = planCityDensityCollection(world, candidate);
  if (!plan) return null;
  const city = world.addCity(countryId, pixel, 1, capital, plan.population, plan.groups);
  if (!city) return null;
  applyCityDensityCollection(world, city, plan, true);
  return city;
}
