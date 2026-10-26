import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, SHARE_STEP } from './config';
import { quantizeShares } from './composition';
import { combineHumanOriginTableMixes } from './human';
import { demography } from './demography';
import { forEachNeighbour } from './geography';
import type { ContourBounds } from './contours';
import { resizeCityPopulation } from './settlements';
import type { Country, World } from './world';

export const RIVER_COLONIZATION_RADIUS = 18;
const EPSILON = 1e-9;

export interface ColonizationPlan {
  targets: Uint8Array;
  anchors: Uint8Array;
  connectedTerritory: Uint8Array;
  donors: number[];
  averageDensity: number;
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

let cached: { world: World; version: number; countryId: number; plan: ColonizationPlan } | null = null;

/** Keeps the currently densest colonizer pixels at the top as each settlement changes density. */
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

  /** The caller must have just read this pixel from peek(); its changed density is reinserted. */
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

/** Builds culture × religion cohorts using the same proportional mixing used by demography(). */
export function populationGroupsAt(world: World, pixel: number): PopulationGroup[] {
  const population = world.density[pixel];
  if (population <= EPSILON) return [];
  const culture = world.cultureTable.entries[world.culture[pixel]];
  const religion = world.religionTable.entries[world.religion[pixel]];
  const humanOriginMix = world.humanOriginTable.entries[world.humanOrigins[pixel]]?.total === 100
    ? world.humanOrigins[pixel]
    : world.humanOriginTable.single(0, 100);
  const religionIds: (number | null)[] = [...religion.ids, null];
  const religionShares = [...religion.shares, 100 - religion.total];
  const groups: PopulationGroup[] = [];
  culture.ids.forEach((cultureId, ci) => {
    religionIds.forEach((religionId, ri) => {
      const share = culture.shares[ci] * religionShares[ri] / 100;
      if (share > 0) groups.push({
        cultureId,
        religionId,
        population: population * share / 100,
        humanOriginMix,
      });
    });
  });
  return groups;
}

function cohortKey(cultureId: number, religionId: number | null): string {
  return `${cultureId}/${religionId ?? 'a'}`;
}

function splitGroups(
  groups: PopulationGroup[],
  amount: number,
  reference: PopulationGroup[],
  priority: number[],
): { selected: PopulationGroup[]; remaining: PopulationGroup[] } {
  const total = groups.reduce((sum, group) => sum + group.population, 0);
  let remainingToSelect = Math.min(amount, total);
  const selected: PopulationGroup[] = [];
  const remaining: PopulationGroup[] = [];
  const cultures = new Set(reference.filter((group) => group.population > EPSILON).map((group) => group.cultureId));
  const religions = new Set(reference.filter((group) => group.population > EPSILON).map((group) => group.religionId));
  const exactPairs = new Set(reference.filter((group) => group.population > EPSILON)
    .map((group) => cohortKey(group.cultureId, group.religionId)));
  const tiers = groups.map((group) => {
    const sameCulture = cultures.has(group.cultureId);
    const sameReligion = religions.has(group.religionId);
    const tier = sameCulture && sameReligion && exactPairs.has(cohortKey(group.cultureId, group.religionId))
      ? 0
      : sameCulture || sameReligion ? 1 : 2;
    return { group, tier };
  });
  const handled = new Set<PopulationGroup>();
  for (const tier of priority) {
    const bucket = tiers.filter((item) => item.tier === tier);
    const tierTotal = bucket.reduce((sum, item) => sum + item.group.population, 0);
    const tierTaken = Math.min(remainingToSelect, tierTotal);
    const share = tierTotal > EPSILON ? tierTaken / tierTotal : 0;
    for (const { group } of bucket) {
      handled.add(group);
      const taken = group.population * share;
      if (taken > EPSILON) selected.push({ ...group, population: taken });
      if (group.population - taken > EPSILON) remaining.push({ ...group, population: group.population - taken });
    }
    remainingToSelect -= tierTaken;
    if (remainingToSelect <= EPSILON) break;
  }
  for (const { group } of tiers) {
    if (!handled.has(group)) remaining.push({ ...group });
  }
  return { selected, remaining };
}

function combineGroups(...sets: PopulationGroup[][]): PopulationGroup[] {
  const totals = new Map<string, PopulationGroup>();
  for (const group of sets.flat()) {
    const key = `${cohortKey(group.cultureId, group.religionId)}/${group.humanOriginMix}`;
    const current = totals.get(key);
    if (current) current.population += group.population;
    else totals.set(key, { ...group });
  }
  return [...totals.values()].filter((group) => group.population > EPSILON);
}

function setPixelComposition(world: World, pixel: number, groups: PopulationGroup[]): void {
  const total = groups.reduce((sum, group) => sum + group.population, 0);
  if (total <= EPSILON) {
    world.culture[pixel] = 0;
    world.religion[pixel] = 0;
    world.humanOrigins[pixel] = 0;
    return;
  }
  const cultures = new Map<number, number>();
  const religions = new Map<number, number>();
  let faithful = 0;
  for (const group of groups) {
    cultures.set(group.cultureId, (cultures.get(group.cultureId) ?? 0) + group.population);
    if (group.religionId !== null) {
      faithful += group.population;
      religions.set(group.religionId, (religions.get(group.religionId) ?? 0) + group.population);
    }
  }
  const faithfulShare = Math.round((faithful / total * 100) / SHARE_STEP) * SHARE_STEP;
  world.culture[pixel] = world.cultureTable.intern(quantizeShares(cultures, 100));
  world.religion[pixel] = world.religionTable.intern(quantizeShares(religions, faithfulShare));
  world.humanOrigins[pixel] = combineHumanOriginTableMixes(
    world.humanOriginTable,
    groups.map((group) => ({ id: group.humanOriginMix, weight: group.population })),
  );
}

/** Moves up to 10% of a densest donor into one target, displacing the same number of locals. */
export function transferColonizationPopulation(
  world: World,
  donor: number,
  target: number,
  inkRemaining: number,
): ColonizationTransfer | null {
  const sourceDensity = world.density[donor];
  const targetDensity = world.owner[target] > 0 ? world.density[target] : 0;
  const ideal = sourceDensity * 0.1;
  if (ideal <= EPSILON || inkRemaining <= 0) return null;

  let maximum = Math.min(ideal, sourceDensity - targetDensity);
  if (world.owner[target] > 0) maximum = Math.min(maximum, targetDensity);
  const amount = Math.min(maximum, inkRemaining * ideal);
  if (amount <= EPSILON) return null;

  const sourceGroups = populationGroupsAt(world, donor);
  const targetGroups = world.owner[target] > 0 ? populationGroupsAt(world, target) : [];
  const donorSplit = splitGroups(sourceGroups, amount, targetGroups, [0, 1, 2]);
  const migrants = donorSplit.selected;
  const nativeRemoval = world.owner[target] > 0
    ? splitGroups(targetGroups, amount, sourceGroups, [2, 1, 0])
    : { selected: [], remaining: [] };
  const targetAfter = combineGroups(nativeRemoval.remaining, migrants);

  const remainingDensity = Math.max(0, sourceDensity - amount);
  const donorCity = world.cityAt(donor);
  if (donorCity) {
    resizeCityPopulation(
      world,
      donorCity,
      donorCity.population * (sourceDensity > EPSILON ? remainingDensity / sourceDensity : 0),
    );
  }
  world.density[donor] = remainingDensity;
  world.density[target] = world.owner[target] > 0 ? targetDensity : amount;
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

function geographicScope(world: World, country: Country): { scope: Uint8Array; anchors: Uint8Array } {
  const scope = new Uint8Array(MAP_PIXELS);
  const anchors = new Uint8Array(MAP_PIXELS);
  const seas = new Set<number>();
  const riverSeeds: number[] = [];
  world.forEachCountryPixel(country, (p) => {
    world.seasOfPixel(p, seas);
    if (world.rivers[p] > 0) riverSeeds.push(p);
  });

  // A coastal state can settle any coast on the seas it already touches.
  for (const sea of seas) {
    for (const p of world.water.coastsOf[sea] ?? []) {
      scope[p] = 1;
      anchors[p] = 1;
    }
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
      anchors[p] = 1;
      forEachNeighbour(p, (n) => {
        if (world.rivers[n] > 0 && !riverSeen[n]) {
          riverSeen[n] = 1;
          queue.push(n);
        } else if (world.land[n]) {
          scope[n] = 1;
          anchors[n] = 1;
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
  return { scope, anchors };
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
  if (cached?.world === world && cached.version === world.version && cached.countryId === country.id) {
    return cached.plan;
  }
  const averageDensity = demography(world, country).density;
  const { scope: geographic, anchors } = geographicScope(world, country);
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
    if (world.density[p] > 0) {
      donors.push(p);
      availablePopulation += world.density[p];
    }
  });
  for (const p of world.landIndex) {
    if (!geographic[p] || world.owner[p] === country.id + 1) continue;
    const owner = world.owner[p];
    if (owner > 0 && (world.density[p] <= EPSILON || world.density[p] >= averageDensity || allies.has(owner - 1))) continue;
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
    donors,
    averageDensity,
    availablePopulation,
    targetCount,
    hint,
    targetBounds,
  };
  cached = { world, version: world.version, countryId: country.id, plan };
  return plan;
}
