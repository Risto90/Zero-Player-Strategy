import { MAP_HEIGHT, MAP_WIDTH, RANKS } from './config';
import { quantizeShares } from './composition';
import { cityPopulationGroupsAtPixel, type City, type CityPopulationGroup, type CityRank, type NomadCell, type NomadGroup, type World } from './world';

const CITY_CANONICAL_MODIFIERS = [1, 1, 1, 2, 3, 6];
const RANK_AREA = RANKS.map((rank) => rank.ink);
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
  const coastal = world.isCoastal(city.pixel);
  const river = world.rivers[city.pixel] > 0;
  const port = coastal && river ? 3 : coastal || river ? 2 : 1;
  return (city.capital ? 2 : 1) * port;
}

export function cityInfluenceArea(world: World, city: City): number {
  const targetArea = RANK_AREA[city.rank - 1];
  return (targetArea / CITY_CANONICAL_MODIFIERS[city.rank - 1]) * cityInfluenceMultiplier(world, city);
}

export function cityInfluenceRadius(world: World, city: City): number {
  return Math.sqrt(cityInfluenceArea(world, city) / Math.PI);
}

export function cityRankName(rank: CityRank): string {
  return ['городок', 'город', 'вольный город', 'полис', 'мегаполис', 'конгломерация'][rank - 1];
}

/** The city replaces its pixel's rural population in totals; its urban part is the excess. */
export function populationAtPixel(world: World, pixel: number): number {
  return world.cityAt(pixel)?.population ?? world.density[pixel];
}

/** Returns true when a top-threshold city has two same-rank, same-country neighbors in its sphere. */
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
  nearestOwnDistance: number;
  nearestOwnAnchorDistance: number;
  nearestOwnAnchorPixel: number | null;
  nearestOwnCityId: number | null;
  nearestOwnCityPixel: number | null;
  nearestOwnRadius: number;
}

type IndexedCity = City & { x: number; y: number; radius: number };
const BUCKET = 64;
const MAX_CITY_RADIUS = 128;

/**
 * A per-card spatial index. It avoids testing every city for every brush pixel,
 * which matters on the full-size world map and low-end Expo Go devices.
 */
export class CityInfluenceIndex {
  private readonly centers = new Map<number, IndexedCity[]>();
  private readonly anchors = new Map<number, number[]>();
  private readonly maxX = Math.ceil(MAP_WIDTH / BUCKET);
  private readonly maxY = Math.ceil(MAP_HEIGHT / BUCKET);

  constructor(
    private readonly world: World,
    private readonly countryId: number,
    private readonly includeAnchors = false,
    private readonly anchorMask?: Uint8Array,
  ) {
    for (const city of world.cities) {
      const x = city.pixel % MAP_WIDTH;
      const y = Math.floor(city.pixel / MAP_WIDTH);
      const indexed: IndexedCity = { ...city, x, y, radius: cityInfluenceRadius(world, city) };
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
      const seen = new Set<number>();
      for (let yy = y0; yy <= y1; yy += 1) {
        for (let xx = x0; xx <= x1; xx += 1) {
          if ((xx - x) ** 2 + (yy - y) ** 2 > rr) continue;
          const p = yy * MAP_WIDTH + xx;
          if (world.land[p] && (world.isCoastal(p) || world.rivers[p] > 0) &&
            (!this.anchorMask || this.anchorMask[p] === 1)) seen.add(p);
        }
      }
      for (const p of seen) {
        const anchorKey = this.key(Math.floor((p % MAP_WIDTH) / BUCKET), Math.floor(Math.floor(p / MAP_WIDTH) / BUCKET));
        const bucket = this.anchors.get(anchorKey) ?? [];
        bucket.push(p);
        this.anchors.set(anchorKey, bucket);
      }
    }
  }

  at(pixel: number, needAnchor = false): CityInfluence {
    const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
    const bx = Math.floor(x / BUCKET), by = Math.floor(y / BUCKET);
    let ownRankSum = 0, ownLargestRank = 0, ownCityCount = 0, foreignRankSum = 0;
    let nearestOwnDistance = Infinity, nearestOwnCityId: number | null = null;
    let nearestOwnCityPixel: number | null = null, nearestOwnRadius = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        for (const city of this.centers.get(this.key(bx + dx, by + dy)) ?? []) {
          const distance = Math.hypot(city.x - x, city.y - y);
          const edgeDistance = Math.max(0, distance - city.radius);
          if (city.countryId === this.countryId) {
            if (distance <= city.radius) {
              ownRankSum += city.rank;
              ownCityCount += 1;
              ownLargestRank = Math.max(ownLargestRank, city.rank);
            }
            if (edgeDistance < nearestOwnDistance) {
              nearestOwnDistance = edgeDistance;
              nearestOwnCityId = city.id;
              nearestOwnCityPixel = city.pixel;
              nearestOwnRadius = city.radius;
            }
          } else if (distance <= city.radius) {
            foreignRankSum += city.rank;
          }
        }
      }
    }
    if (this.countryId >= 0 && (nearestOwnCityId === null || nearestOwnDistance > 0)) {
      for (let ring = 3; ring < Math.max(this.maxX, this.maxY); ring += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          for (const dy of [-ring, ring]) this.checkCities(bx + dx, by + dy, x, y, (city, distance) => {
            if (city.countryId !== this.countryId) return;
            const edgeDistance = Math.max(0, distance - city.radius);
            if (edgeDistance < nearestOwnDistance) {
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
            if (edgeDistance < nearestOwnDistance) {
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

type Pair = { culture: number; religion: number | null; population: number };

/** Initializes old/incomplete city records from their founding pixel and keeps group totals aligned. */
export function ensureCityPopulationGroups(world: World, city: City): CityPopulationGroup[] {
  let groups = city.populationGroups;
  if (!groups?.length && city.population > 0) {
    groups = cityPopulationGroupsAtPixel(world, city.pixel, city.population);
  }
  groups ??= [];
  const total = groups.reduce((sum, group) => sum + group.population, 0);
  if (city.population <= 0) groups = [];
  else if (total <= 0) groups = cityPopulationGroupsAtPixel(world, city.pixel, city.population);
  else if (Math.abs(total - city.population) > 1e-8) {
    const scale = city.population / total;
    groups = groups.map((group) => ({ ...group, population: group.population * scale }));
  }
  city.populationGroups = groups;
  return groups;
}

/** Resizes a city's resident groups proportionally, preserving its urban composition. */
export function resizeCityPopulation(world: World, city: City, population: number): void {
  const groups = ensureCityPopulationGroups(world, city);
  const total = groups.reduce((sum, group) => sum + group.population, 0);
  const target = Math.max(0, population);
  city.populationGroups = total > 0
    ? groups.map((group) => ({ ...group, population: group.population * target / total }))
    : cityPopulationGroupsAtPixel(world, city.pixel, target);
  city.population = target;
}

/** Removes residents proportionally, then adds the incoming cohort groups. */
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
  const combined = new Map<string, CityPopulationGroup>();
  for (const group of groups) {
    const population = group.population * scale;
    if (population > 1e-9) combined.set(`${group.cultureId}/${group.religionId ?? -1}`, { ...group, population });
  }
  for (const group of additions) {
    const key = `${group.cultureId}/${group.religionId ?? -1}`;
    const current = combined.get(key);
    if (current) current.population += group.population;
    else if (group.population > 1e-9) combined.set(key, { ...group });
  }
  city.populationGroups = [...combined.values()];
  city.population = city.populationGroups.reduce((sum, group) => sum + group.population, 0);
}

function pixelGroups(world: World, pixel: number, amount = world.density[pixel]): CityPopulationGroup[] {
  return cityPopulationGroupsAtPixel(world, pixel, amount);
}

function addGroupsToPixel(world: World, pixel: number, additions: CityPopulationGroup[]): void {
  const city = world.cityAt(pixel);
  if (city) {
    changeCityPopulation(world, city, additions);
    return;
  }
  const initial = pixelGroups(world, pixel);
  const groups = [...initial, ...additions];
  const cultures = new Map<number, number>();
  const religions = new Map<number, number>();
  let total = 0, faithful = 0;
  for (const group of groups) {
    cultures.set(group.cultureId, (cultures.get(group.cultureId) ?? 0) + group.population);
    if (group.religionId !== null) {
      religions.set(group.religionId, (religions.get(group.religionId) ?? 0) + group.population);
      faithful += group.population;
    }
    total += group.population;
  }
  world.density[pixel] += additions.reduce((sum, group) => sum + group.population, 0);
  world.culture[pixel] = world.cultureTable.intern(quantizeShares(cultures, 100));
  world.religion[pixel] = world.religionTable.intern(
    quantizeShares(religions, total > 0 ? faithful / total * 100 : 0),
  );
}

function takeCityPopulation(world: World, city: City, amount: number): CityPopulationGroup[] {
  const groups = ensureCityPopulationGroups(world, city);
  const total = groups.reduce((sum, group) => sum + group.population, 0);
  const taken = Math.min(Math.max(0, amount), total);
  const scale = total > 0 ? taken / total : 0;
  const removed = groups.map((group) => ({ ...group, population: group.population * scale }));
  resizeCityPopulation(world, city, total - taken);
  return removed;
}

function addGroupsAcrossPixels(
  world: World,
  pixels: number[],
  groups: CityPopulationGroup[],
): void {
  if (!pixels.length) return;
  const perPixel = groups.map((group) => ({ ...group, population: group.population / pixels.length }));
  for (const pixel of pixels) addGroupsToPixel(world, pixel, perPixel);
}

function apportionByWeightWithCaps(
  items: { city: City; weight: number; capacity: number }[],
  requested: number,
): Map<number, number> {
  const allocated = new Map<number, number>();
  let remaining = requested;
  let active = items.filter((item) => item.capacity > 1e-9 && item.weight > 0);
  while (remaining > 1e-9 && active.length) {
    const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
    let capped = false;
    for (const item of active) {
      const prior = allocated.get(item.city.id) ?? 0;
      const share = remaining * item.weight / totalWeight;
      const room = item.capacity - prior;
      if (share >= room - 1e-9) {
        allocated.set(item.city.id, item.capacity);
        remaining -= room;
        active = active.filter((candidate) => candidate.city.id !== item.city.id);
        capped = true;
        break;
      }
    }
    if (capped) continue;
    for (const item of active) {
      const share = remaining * item.weight / totalWeight;
      allocated.set(item.city.id, (allocated.get(item.city.id) ?? 0) + share);
    }
    remaining = 0;
  }
  return allocated;
}

/** Splits new density between the rural point and every eligible city covering it. */
export function applyDensityGrowth(world: World, pixel: number, amount: number, coveringCities?: City[]): void {
  if (amount <= 0) return;
  const cities = coveringCities ?? new CityInfluenceIndex(world, -1).citiesAt(pixel);
  const eligible = cities.filter((city) => !cityAtUpperPopulationThreshold(city));
  let shares = new Map<number, number>();
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
  const distributed = [...shares.values()].reduce((sum, share) => sum + share, 0);
  const local = Math.max(0, amount - distributed);
  const sourceGroups = pixelGroups(world, pixel, amount);
  for (const city of eligible) {
    const share = shares.get(city.id) ?? 0;
    if (share > 0) {
      const groups = sourceGroups.map((group) => ({ ...group, population: group.population * share / amount }));
      changeCityPopulation(world, city, groups);
    }
  }
  const localCity = world.cityAt(pixel);
  if (localCity) {
    const groups = sourceGroups.map((group) => ({ ...group, population: group.population * local / amount }));
    if (local > 0) changeCityPopulation(world, localCity, groups);
    world.density[pixel] += amount;
  } else {
    world.density[pixel] += local;
  }
}

/**
 * Applies an ordinary density loss. Nearby cities in the same state release
 * residents proportionally, up to their populations above the rank minimum.
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
  const allocations = apportionByWeightWithCaps(donors, loss);
  const migrated: CityPopulationGroup[] = [];
  for (const donor of donors) {
    const amount = allocations.get(donor.city.id) ?? 0;
    if (amount > 0) migrated.push(...takeCityPopulation(world, donor.city, amount));
  }
  const compensated = migrated.reduce((sum, group) => sum + group.population, 0);
  const removed = loss - compensated;
  const baseGroups = pixelGroups(world, pixel);
  let toRemove = loss;
  for (const group of baseGroups) {
    if (toRemove <= 0) break;
    const take = Math.min(group.population, toRemove);
    group.population -= take;
    toRemove -= take;
  }
  const remainingGroups = [...baseGroups, ...migrated].filter((group) => group.population > 1e-9);
  world.density[pixel] = Math.max(0, world.density[pixel] - removed);
  const cultures = new Map<number, number>(), religions = new Map<number, number>();
  let total = 0, faithful = 0;
  for (const group of remainingGroups) {
    cultures.set(group.cultureId, (cultures.get(group.cultureId) ?? 0) + group.population);
    if (group.religionId !== null) {
      religions.set(group.religionId, (religions.get(group.religionId) ?? 0) + group.population);
      faithful += group.population;
    }
    total += group.population;
  }
  world.culture[pixel] = world.cultureTable.intern(quantizeShares(cultures, 100));
  world.religion[pixel] = world.religionTable.intern(
    quantizeShares(religions, total > 0 ? faithful / total * 100 : 0),
  );
  world.version += 1;
  return loss;
}

/** Adds country residents to an existing rural point or city without changing group composition. */
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

/** Applies the population-loss, resettlement, demotion, and capital rules for a waning city. */
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
    const loss = city.population * 0.2;
    resizeCityPopulation(world, city, city.population - loss);
    const settlementGroups = before.map((group) => ({
      ...group,
      population: group.population * (loss * 0.5 / Math.max(1e-9, before.reduce((sum, item) => sum + item.population, 0))),
    }));
    const settlementPixels = targets.filter((pixel) => pixel !== city.pixel);
    addGroupsAcrossPixels(world, settlementPixels, settlementGroups);
    world.version += 1;
    return {
      removed: false,
      transferredPopulation: settlementPixels.length ? loss * 0.5 : 0,
      affectedPixels: [...new Set([city.pixel, ...settlementPixels])],
    };
  }

  if (city.rank > 1) {
    city.rank = (city.rank - 1) as CityRank;
    world.version += 1;
    return { removed: false, transferredPopulation: 0, affectedPixels: [city.pixel] };
  }

  const population = city.population;
  const groups = ensureCityPopulationGroups(world, city).map((group) => ({
    ...group,
    population: group.population * 0.5,
  }));
  removeCityAndChooseCapital(world, city);
  addGroupsAcrossPixels(world, targets, groups);
  world.version += 1;
  return {
    removed: true,
    transferredPopulation: targets.length ? population * 0.5 : 0,
    affectedPixels: [...new Set([city.pixel, ...targets])],
  };
}

export function cityComposition(world: World, city: City): {
  cultures: { id: number; percent: number }[];
  religions: { id: number | null; percent: number }[];
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
  return { cultures: shares(cultures), religions: shares(religions) };
}

/** Moves 10% from each source pixel into a city, preferring matches to the city's population. */
export function movePopulationToCity(world: World, source: number, target: number, amount: number, fromCityRural = true): number {
  if (source === target || amount <= 0 || world.density[source] <= 0) return 0;
  const sourceCulture = world.cultureTable.entries[world.culture[source]];
  const sourceReligion = world.religionTable.entries[world.religion[source]];
  const targetCulture = world.cultureTable.entries[world.culture[target]];
  const targetReligion = world.religionTable.entries[world.religion[target]];
  const sourceFaithIds: (number | null)[] = [...sourceReligion.ids, null];
  const sourceFaithShares = [...sourceReligion.shares, 100 - sourceReligion.total];
  const targetFaithShares = new Map<number | null, number>([
    ...targetReligion.ids.map((id, i) => [id, targetReligion.shares[i]] as const),
    [null, 100 - targetReligion.total],
  ]);
  const sourcePairs: Pair[] = [];
  for (const [ci, cultureId] of sourceCulture.ids.entries()) {
    sourceFaithIds.forEach((religionId, ri) => {
      const population = world.density[source] * sourceCulture.shares[ci] / 100 * sourceFaithShares[ri] / 100;
      if (population > 0) sourcePairs.push({ culture: cultureId, religion: religionId, population });
    });
  }
  const targetCultures = new Map(targetCulture.ids.map((id, i) => [id, targetCulture.shares[i]]));
  const targetCultureShare = (id: number) => targetCultures.get(id) ?? 0;
  sourcePairs.sort((a, b) => {
    const exactA = targetCultureShare(a.culture) > 0 && (targetFaithShares.get(a.religion) ?? 0) > 0;
    const exactB = targetCultureShare(b.culture) > 0 && (targetFaithShares.get(b.religion) ?? 0) > 0;
    const tierA = exactA ? 3 : targetCultureShare(a.culture) > 0 || (targetFaithShares.get(a.religion) ?? 0) > 0 ? 2 : 1;
    const tierB = exactB ? 3 : targetCultureShare(b.culture) > 0 || (targetFaithShares.get(b.religion) ?? 0) > 0 ? 2 : 1;
    return tierB - tierA ||
      (targetCultureShare(b.culture) + (targetFaithShares.get(b.religion) ?? 0)) -
      (targetCultureShare(a.culture) + (targetFaithShares.get(a.religion) ?? 0));
  });

  let remaining = Math.min(amount, world.density[source]);
  const moved = new Map<string, Pair>();
  for (const group of sourcePairs) {
    if (remaining <= 0) break;
    const take = Math.min(group.population, remaining);
    const key = `${group.culture}/${group.religion ?? -1}`;
    const current = moved.get(key);
    if (current) current.population += take;
    else moved.set(key, { ...group, population: take });
    group.population -= take;
    remaining -= take;
  }
  const actual = amount - remaining;
  if (actual <= 0) return 0;

  const updateMix = (pixel: number, groups: Pair[], total: number) => {
    const cultures = new Map<number, number>(), religions = new Map<number, number>();
    let religiousTotal = 0;
    for (const group of groups) {
      cultures.set(group.culture, (cultures.get(group.culture) ?? 0) + group.population);
      if (group.religion !== null) {
        religions.set(group.religion, (religions.get(group.religion) ?? 0) + group.population);
        religiousTotal += group.population;
      }
    }
    world.culture[pixel] = world.cultureTable.intern(quantizeShares(cultures, 100));
    const faithMix = quantizeShares(religions, total > 0 ? (religiousTotal / total) * 100 : 0);
    world.religion[pixel] = world.religionTable.intern(faithMix);
  };
  const sourceTotal = world.density[source] - actual;
  const sourceRemain = sourcePairs.filter((group) => group.population > 1e-9);
  const sourceCity = fromCityRural ? world.cityAt(source) : null;
  if (sourceCity) changeCityPopulation(world, sourceCity, [], actual);
  world.density[source] = Math.max(0, sourceTotal);
  updateMix(source, sourceRemain, sourceTotal);

  const targetCity = world.cityAt(target);
  if (targetCity) {
    changeCityPopulation(
      world,
      targetCity,
      [...moved.values()].map((group) => ({ cultureId: group.culture, religionId: group.religion, population: group.population })),
    );
  } else {
    const targetTotal = world.density[target];
    const targetPairs: Pair[] = [];
    const targetCultureEntry = world.cultureTable.entries[world.culture[target]];
    const targetReligionEntry = world.religionTable.entries[world.religion[target]];
    const targetReligions: (number | null)[] = [...targetReligionEntry.ids, null];
    const targetRelShares = [...targetReligionEntry.shares, 100 - targetReligionEntry.total];
    for (const [ci, cultureId] of targetCultureEntry.ids.entries()) {
      targetReligions.forEach((religionId, ri) => {
        const population = targetTotal * targetCultureEntry.shares[ci] / 100 * targetRelShares[ri] / 100;
        if (population > 0) targetPairs.push({ culture: cultureId, religion: religionId, population });
      });
    }
    targetPairs.push(...moved.values());
    world.density[target] += actual;
    updateMix(target, targetPairs, targetTotal + actual);
  }
  return actual;
}

export function concentrateCityPopulation(world: World, city: City): void {
  const radius = cityInfluenceRadius(world, city);
  const pixel = city.pixel;
  const nomadCellsAtPixel = new Map<number, { nomad: NomadGroup; cell: NomadCell }[]>();
  for (const nomad of world.nomads) for (const cell of nomad.cells) {
    const entries = nomadCellsAtPixel.get(cell.pixel) ?? [];
    entries.push({ nomad, cell });
    nomadCellsAtPixel.set(cell.pixel, entries);
  }
  const emptyNomadCells = new Set<NomadCell>();
  const affectedNomads = new Set<NomadGroup>();
  const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
  const x0 = Math.max(0, Math.floor(x - radius)), x1 = Math.min(MAP_WIDTH - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius)), y1 = Math.min(MAP_HEIGHT - 1, Math.ceil(y + radius));
  const r2 = radius * radius;
  for (let yy = y0; yy <= y1; yy += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      const source = yy * MAP_WIDTH + xx;
      if (source === pixel || !world.land[source] || (xx - x) ** 2 + (yy - y) ** 2 > r2) continue;
      const pools: { cell: NomadCell | null; nomad: NomadGroup | null; population: number; cultureMix: number; religionMix: number; priority: number }[] = [];
      const targetCulture = world.cultureTable.entries[world.culture[pixel]];
      const targetReligion = world.religionTable.entries[world.religion[pixel]];
      const scoreMix = (cultureMix: number, religionMix: number) => {
        const cultures = world.cultureTable.entries[cultureMix];
        const religions = world.religionTable.entries[religionMix];
        const targetCultures = new Set(targetCulture.ids);
        const targetFaiths = new Set<number | null>([...targetReligion.ids, null]);
        const sourceFaiths: (number | null)[] = [...religions.ids, null];
        const shares = [...religions.shares, 100 - religions.total];
        let best = 1;
        cultures.ids.forEach((cultureId, ci) => sourceFaiths.forEach((religionId, ri) => {
          if (cultures.shares[ci] <= 0 || shares[ri] <= 0) return;
          const sameCulture = targetCultures.has(cultureId);
          const sameReligion = targetFaiths.has(religionId);
          best = Math.max(best, sameCulture && sameReligion ? 3 : sameCulture || sameReligion ? 2 : 1);
        }));
        return best;
      };
      if (world.density[source] > 0) {
        pools.push({
          cell: null, nomad: null, population: world.density[source], cultureMix: world.culture[source], religionMix: world.religion[source],
          priority: scoreMix(world.culture[source], world.religion[source]),
        });
      }
      for (const { nomad, cell } of nomadCellsAtPixel.get(source) ?? []) {
        if (cell.population) pools.push({
          cell, nomad, population: cell.population, cultureMix: cell.cultureMix, religionMix: cell.religionMix,
          priority: scoreMix(cell.cultureMix, cell.religionMix),
        });
      }
      pools.sort((a, b) => b.priority - a.priority);
      for (const pool of pools) {
        const amount = pool.population * 0.1;
        if (amount <= 0) continue;
        if (!pool.cell) {
          movePopulationToCity(world, source, pixel, amount);
          continue;
        }
        const countryDensity = world.density[source];
        const countryCulture = world.culture[source];
        const countryReligion = world.religion[source];
        world.density[source] = pool.cell.population;
        world.culture[source] = pool.cell.cultureMix;
        world.religion[source] = pool.cell.religionMix;
        movePopulationToCity(world, source, pixel, amount, false);
        pool.cell.population = world.density[source];
        pool.cell.cultureMix = world.culture[source];
        pool.cell.religionMix = world.religion[source];
        if (pool.nomad) affectedNomads.add(pool.nomad);
        if (pool.cell.population <= 1e-9) emptyNomadCells.add(pool.cell);
        world.density[source] = countryDensity;
        world.culture[source] = countryCulture;
        world.religion[source] = countryReligion;
      }
    }
  }
  if (affectedNomads.size) {
    for (const nomad of affectedNomads) nomad.cells = nomad.cells.filter((cell) => !emptyNomadCells.has(cell));
    world.nomadVersion += 1;
  }
  world.version += 1;
}

export function addCityAndConcentrate(world: World, countryId: number, pixel: number, capital = false): City | null {
  const city = world.addCity(countryId, pixel, 1, capital);
  if (!city) return null;
  concentrateCityPopulation(world, city);
  return city;
}
