import { MAP_HEIGHT, MAP_WIDTH, RANKS } from './config';
import { quantizeShares } from './composition';
import type { City, CityRank, World } from './world';

const CITY_CANONICAL_MODIFIERS = [1, 1, 1, 2, 3, 6];
const RANK_AREA = RANKS.map((rank) => rank.ink);

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

export interface CityInfluence {
  ownRankSum: number;
  ownLargestRank: number;
  ownCityCount: number;
  foreignRankSum: number;
  nearestOwnDistance: number;
  nearestOwnAnchorDistance: number;
  nearestOwnCityId: number | null;
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

  constructor(private readonly world: World, private readonly countryId: number) {
    for (const city of world.cities) {
      const x = city.pixel % MAP_WIDTH;
      const y = Math.floor(city.pixel / MAP_WIDTH);
      const indexed: IndexedCity = { ...city, x, y, radius: cityInfluenceRadius(world, city) };
      const bx = Math.floor(x / BUCKET), by = Math.floor(y / BUCKET);
      const key = this.key(bx, by);
      const list = this.centers.get(key) ?? [];
      list.push(indexed);
      this.centers.set(key, list);
      if (city.countryId !== countryId) continue;
      const r = Math.ceil(indexed.radius);
      const x0 = Math.max(0, x - r), x1 = Math.min(MAP_WIDTH - 1, x + r);
      const y0 = Math.max(0, y - r), y1 = Math.min(MAP_HEIGHT - 1, y + r);
      const rr = indexed.radius * indexed.radius;
      const seen = new Set<number>();
      for (let yy = y0; yy <= y1; yy += 1) {
        for (let xx = x0; xx <= x1; xx += 1) {
          if ((xx - x) ** 2 + (yy - y) ** 2 > rr) continue;
          const p = yy * MAP_WIDTH + xx;
          if (world.land[p] && (world.isCoastal(p) || world.rivers[p] > 0)) seen.add(p);
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

  at(pixel: number): CityInfluence {
    const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
    const bx = Math.floor(x / BUCKET), by = Math.floor(y / BUCKET);
    let ownRankSum = 0, ownLargestRank = 0, ownCityCount = 0, foreignRankSum = 0;
    let nearestOwnDistance = Infinity, nearestOwnCityId: number | null = null;
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
            }
          } else if (distance <= city.radius) {
            foreignRankSum += city.rank;
          }
        }
      }
    }
    return {
      ownRankSum,
      ownLargestRank,
      ownCityCount,
      foreignRankSum,
      nearestOwnDistance,
      nearestOwnAnchorDistance: this.nearestAnchor(x, y, bx, by),
      nearestOwnCityId,
    };
  }

  private nearestAnchor(x: number, y: number, bx: number, by: number): number {
    let nearest = Infinity;
    for (let ring = 0; ring < Math.max(this.maxX, this.maxY); ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (const dy of [-ring, ring]) this.checkAnchors(bx + dx, by + dy, x, y, (d) => { nearest = Math.min(nearest, d); });
      }
      for (let dy = -ring + 1; dy < ring; dy += 1) {
        for (const dx of [-ring, ring]) this.checkAnchors(bx + dx, by + dy, x, y, (d) => { nearest = Math.min(nearest, d); });
      }
      const lowerBound = Math.max(0, (ring - 1) * BUCKET - Math.SQRT2 * BUCKET);
      if (nearest <= lowerBound) break;
    }
    return nearest;
  }

  private checkAnchors(bx: number, by: number, x: number, y: number, visit: (distance: number) => void): void {
    for (const pixel of this.anchors.get(this.key(bx, by)) ?? []) {
      visit(Math.hypot(pixel % MAP_WIDTH - x, Math.floor(pixel / MAP_WIDTH) - y));
    }
  }

  private key(x: number, y: number): number {
    return x >= 0 && x < this.maxX && y >= 0 && y < this.maxY ? y * this.maxX + x : -1;
  }
}

type Pair = { culture: number; religion: number | null; population: number };

/** Moves 10% from each source pixel into a city, preferring matches to the city's population. */
export function movePopulationToCity(world: World, source: number, target: number, amount: number): number {
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
  world.density[source] = Math.max(0, sourceTotal);
  updateMix(source, sourceRemain, sourceTotal);

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
  return actual;
}

export function addCityAndConcentrate(world: World, countryId: number, pixel: number, capital = false): City | null {
  const city = world.addCity(countryId, pixel, 1, capital);
  if (!city) return null;
  const radius = cityInfluenceRadius(world, city);
  const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
  const x0 = Math.max(0, Math.floor(x - radius)), x1 = Math.min(MAP_WIDTH - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius)), y1 = Math.min(MAP_HEIGHT - 1, Math.ceil(y + radius));
  const r2 = radius * radius;
  for (let yy = y0; yy <= y1; yy += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      const source = yy * MAP_WIDTH + xx;
      if (source === pixel || !world.land[source] || (xx - x) ** 2 + (yy - y) ** 2 > r2) continue;
      const amount = world.density[source] * 0.1;
      if (amount <= 0) continue;
      movePopulationToCity(world, source, pixel, amount);
    }
  }
  world.version += 1;
  return city;
}
