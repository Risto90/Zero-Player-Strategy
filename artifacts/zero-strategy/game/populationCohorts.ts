import { quantizeShares, type CompositionTable } from './composition';
import { sumPopulationMeasures, takePopulationMeasure } from './populationMeasures';
import type { KernelPopulationMeasure } from '../kernel/bindings/contracts';
import { getBinaryMathKernel } from '../kernel/runtime';
import {
  ancestryProfile,
  ancestryProfileId,
  climateFactorForMix,
  inheritHumanOrigins,
  type HumanOriginId,
} from './human';

export interface PopulationCohortShare {
  cultureId: number;
  religionId: number | null;
  originProfileId: number;
  share: number;
}

export interface PopulationCohortWeight extends Omit<PopulationCohortShare, 'share'> {
  weight: number;
}

export interface PopulationCohortAmount extends Omit<PopulationCohortShare, 'share'> {
  population: number;
}

function makePopulationMeasure(
  keyColumns: readonly ArrayLike<number | null>[],
  masses: ArrayLike<number>,
): KernelPopulationMeasure {
  if (keyColumns.length > 4 || keyColumns.some((column) => column.length !== masses.length)) {
    throw new TypeError('Измерения состава населения имеют несовместимые размеры.');
  }
  const keys = new Uint32Array(masses.length * 4);
  for (let row = 0; row < masses.length; row += 1) {
    for (let column = 0; column < keyColumns.length; column += 1) {
      const key = keyColumns[column][row];
      if (key === null) {
        keys[row * 4 + column] = 0xffff_ffff;
      } else if (!Number.isSafeInteger(key) || key < 0 || key >= 0xffff_ffff) {
        throw new RangeError('Ключ состава населения должен быть uint32, кроме зарезервированного неверия.');
      } else {
        keys[row * 4 + column] = key;
      }
    }
  }
  return { keys, mass: Float64Array.from(masses) };
}

function populationWeightsFromMeasure(measure: KernelPopulationMeasure): PopulationCohortWeight[] {
  const groups: PopulationCohortWeight[] = [];
  for (let index = 0; index < measure.mass.length; index += 1) {
    const offset = index * 4;
    const religionId = measure.keys[offset + 1];
    groups.push({
      cultureId: measure.keys[offset],
      religionId: religionId === 0xffff_ffff ? null : religionId,
      originProfileId: measure.keys[offset + 2],
      weight: measure.mass[index],
    });
  }
  return groups;
}

/** Уменьшает только создаваемое население и перераспределяет его доли по климату точки. */
export function climateAdjustedPopulationCohorts(
  groups: readonly PopulationCohortWeight[],
  temperature: number,
  humidity: number,
  drainage: number,
): { growthFactor: number; groups: PopulationCohortWeight[] } {
  const originalTotal = groups.reduce((sum, group) => sum + Math.max(0, group.weight), 0);
  if (!(originalTotal > 0)) return { growthFactor: 0, groups: [] };
  const adjusted = groups.flatMap((group) => {
    if (!(group.weight > 0)) return [];
    const factor = climateFactorForMix(
      ancestryProfile(group.originProfileId).mix,
      temperature,
      humidity,
      drainage,
    );
    const weight = group.weight * factor;
    return weight > 0 ? [{ ...group, weight }] : [];
  });
  const adjustedTotal = adjusted.reduce((sum, group) => sum + group.weight, 0);
  return {
    growthFactor: adjustedTotal / originalTotal,
    groups: adjusted,
  };
}

export class PopulationCohortTable {
  readonly entries: PopulationCohortShare[][] = [[]];
  private readonly index = new Map<string, number>([['', 0]]);

  intern(groups: readonly PopulationCohortWeight[]): number {
    const totals = sumPopulationMeasures(groups
      .filter((group) => Number.isFinite(group.weight) && group.weight > 0)
      .map((group) => ({
        cultureId: group.cultureId,
        religionId: group.religionId,
        humanOriginMix: group.originProfileId,
        population: group.weight,
      })));
    const total = totals.reduce((sum, group) => sum + group.population, 0);
    if (!(total > 0)) return 0;

    const normalized = totals
      .sort((a, b) =>
        a.cultureId - b.cultureId ||
        (a.religionId ?? -1) - (b.religionId ?? -1) ||
        a.humanOriginMix - b.humanOriginMix,
      )
      .map((group) => ({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId: group.humanOriginMix,
        share: group.population * 100 / total,
      }));
    const largest = normalized.reduce((best, group, index) =>
      group.share > normalized[best].share ? index : best, 0);
    normalized[largest].share += 100 - normalized.reduce((sum, group) => sum + group.share, 0);
    const key = normalized.map((group) =>
      `${group.cultureId}/${group.religionId ?? -1}/${group.originProfileId}:${group.share}`,
    ).join(',');
    const known = this.index.get(key);
    if (known !== undefined) return known;

    const id = this.entries.length;
    if (id > 0xffff_ffff) throw new Error('Превышено число вариантов состава населения на карте.');
    this.entries.push(normalized);
    this.index.set(key, id);
    return id;
  }

  restore(entries: readonly PopulationCohortShare[][]): void {
    for (const entry of entries) {
      const restored = this.intern(entry.map((group) => ({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId: group.originProfileId,
        weight: group.share,
      })));
      if (restored !== this.entries.length - 1) {
        throw new Error('Не удалось восстановить исходные составы населения.');
      }
    }
  }
}

export interface PopulationCohortWorld {
  culture: Uint16Array;
  religion: Uint16Array;
  humanOrigins: Uint16Array;
  populationCohorts: Uint32Array;
  cultureTable: CompositionTable;
  religionTable: CompositionTable;
  humanOriginTable: CompositionTable;
  populationCohortTable: PopulationCohortTable;
}

export interface PopulationCohortComposition {
  populationCohortId: number;
  groups: PopulationCohortShare[];
  cultureMixId: number;
  religionMixId: number;
  originMixId: number;
}

export function populationCohortsFromMixes(
  world: PopulationCohortWorld,
  cultureMixId: number,
  religionMixId: number,
  originMixId: number,
  population: number,
): PopulationCohortWeight[] {
  if (!(population > 0)) return [];
  const culture = world.cultureTable.entries[cultureMixId];
  const religion = world.religionTable.entries[religionMixId];
  const origin = world.humanOriginTable.entries[originMixId];
  const religionIds = [...religion.ids, null];
  const religionShares = [...religion.shares, Math.max(0, 100 - religion.total)];
  const originIds = origin?.total > 0 ? origin.ids : [0];
  const originShares = origin?.total > 0 ? origin.shares : [100];
  const kernel = getBinaryMathKernel();
  const cultureAndReligion = kernel.measureProduct(
    makePopulationMeasure([culture.ids], culture.shares),
    makePopulationMeasure([religionIds], religionShares),
    new Uint32Array([0, 4, 8, 8]),
    1,
    1,
    1,
    false,
    true,
  );
  return populationWeightsFromMeasure(kernel.measureProduct(
    cultureAndReligion,
    makePopulationMeasure([originIds], originShares),
    new Uint32Array([0, 1, 4, 8]),
    10_000,
    population,
    100,
    false,
    true,
  ));
}

export function populationCohortsAtPixel(
  world: PopulationCohortWorld,
  pixel: number,
  population: number,
): PopulationCohortWeight[] {
  if (!(population > 0)) return [];
  const mixId = world.populationCohorts[pixel];
  const mix = world.populationCohortTable.entries[mixId];
  if (mix?.length) {
    return mix.map((group) => ({
      cultureId: group.cultureId,
      religionId: group.religionId,
      originProfileId: group.originProfileId,
      weight: population * group.share / 100,
    }));
  }
  return populationCohortsFromMixes(
    world,
    world.culture[pixel],
    world.religion[pixel],
    world.humanOrigins[pixel],
    population,
  );
}

export function setPopulationCohortsAtPixel(
  world: PopulationCohortWorld,
  pixel: number,
  groups: readonly PopulationCohortWeight[],
): void {
  const composition = internPopulationCohorts(world, groups);
  world.populationCohorts[pixel] = composition.populationCohortId;
  world.culture[pixel] = composition.cultureMixId;
  world.religion[pixel] = composition.religionMixId;
  world.humanOrigins[pixel] = composition.originMixId;
}

export function internPopulationCohorts(
  world: PopulationCohortWorld,
  groups: readonly PopulationCohortWeight[],
): PopulationCohortComposition {
  const populationCohortId = world.populationCohortTable.intern(groups);
  const normalizedGroups = world.populationCohortTable.entries[populationCohortId];
  if (!normalizedGroups?.length) {
    return { populationCohortId, groups: [], cultureMixId: 0, religionMixId: 0, originMixId: 0 };
  }
  const cultures = new Map<number, number>();
  const religions = new Map<number, number>();
  const origins = new Map<number, number>();
  let faithful = 0;
  for (const group of normalizedGroups) {
    cultures.set(group.cultureId, (cultures.get(group.cultureId) ?? 0) + group.share);
    origins.set(group.originProfileId, (origins.get(group.originProfileId) ?? 0) + group.share);
    if (group.religionId !== null) {
      religions.set(group.religionId, (religions.get(group.religionId) ?? 0) + group.share);
      faithful += group.share;
    }
  }
  return {
    populationCohortId,
    groups: normalizedGroups,
    cultureMixId: world.cultureTable.intern(quantizeShares(cultures, 100)),
    religionMixId: world.religionTable.intern(quantizeShares(religions, faithful)),
    originMixId: world.humanOriginTable.intern(quantizeShares(origins, 100)),
  };
}

export function convertPopulationCohortCulture(
  world: PopulationCohortWorld,
  pixel: number,
  to: number,
  fraction: number,
  from: number | null,
): void {
  const current = populationCohortsAtPixel(world, pixel, 100);
  const untouched = from === null ? [] : current.filter((group) => group.cultureId !== from);
  const eligible = from === null ? current : current.filter((group) => group.cultureId === from);
  const eligibleWeight = eligible.reduce((sum, group) => sum + group.weight, 0);
  const split = takePopulationMeasure(eligible.map((group) => ({
    cultureId: group.cultureId,
    religionId: group.religionId,
    humanOriginMix: group.originProfileId,
    population: group.weight,
  })), eligibleWeight * fraction, [], [0, 1, 2]);
  const result: PopulationCohortWeight[] = [
    ...untouched,
    ...split.remaining.map((group) => ({
      cultureId: group.cultureId,
      religionId: group.religionId,
      originProfileId: group.humanOriginMix,
      weight: group.population,
    })),
    ...split.selected.map((group) => ({
      cultureId: to,
      religionId: group.religionId,
      originProfileId: group.humanOriginMix,
      weight: group.population,
    })),
  ];
  setPopulationCohortsAtPixel(world, pixel, result);
}

export function convertPopulationCohortReligion(
  world: PopulationCohortWorld,
  pixel: number,
  to: number,
  fraction: number,
): void {
  const current = populationCohortsAtPixel(world, pixel, 100);
  const split = takePopulationMeasure(current.map((group) => ({
    cultureId: group.cultureId,
    religionId: group.religionId,
    humanOriginMix: group.originProfileId,
    population: group.weight,
  })), current.reduce((sum, group) => sum + group.weight, 0) * fraction, [], [0, 1, 2]);
  const result: PopulationCohortWeight[] = [
    ...split.remaining.map((group) => ({
      cultureId: group.cultureId,
      religionId: group.religionId,
      originProfileId: group.humanOriginMix,
      weight: group.population,
    })),
    ...split.selected.map((group) => ({
      cultureId: group.cultureId,
      religionId: to,
      originProfileId: group.humanOriginMix,
      weight: group.population,
    })),
  ];
  setPopulationCohortsAtPixel(world, pixel, result);
}

export function expectedExpansionPopulationCohorts(
  sourceGroups: readonly PopulationCohortAmount[],
  religionCounts: ReadonlyMap<number | null, number>,
  foundingRaces: readonly ({ foundingRaceId?: HumanOriginId } | undefined)[],
): PopulationCohortWeight[] {
  const parentGroups = sumPopulationMeasures(sourceGroups
    .filter((group) => group.population > 0)
    .map((group) => ({
      cultureId: group.cultureId,
      religionId: null,
      humanOriginMix: group.originProfileId,
      population: group.population,
    })));
  const childMeasures: {
    cultureId: number;
    religionId: null;
    humanOriginMix: number;
    population: number;
  }[] = [];
  for (let first = 0; first < parentGroups.length; first += 1) {
    const a = parentGroups[first];
    for (let second = first; second < parentGroups.length; second += 1) {
      const b = parentGroups[second];
      const pairCount = first === second
        ? a.population * (a.population - 1) / 2
        : a.population * b.population;
      if (!(pairCount > 0)) continue;
      const childOriginId = ancestryProfileId(inheritHumanOrigins(
        ancestryProfile(a.humanOriginMix).mix,
        ancestryProfile(b.humanOriginMix).mix,
      ));
      const childRaces = new Set(ancestryProfile(childOriginId).mix.ids);
      const candidateCultures = a.cultureId === b.cultureId
        ? [a.cultureId]
        : [a.cultureId, b.cultureId];
      const eligibleCultures = candidateCultures.filter((cultureId) => {
        const foundingRaceId = foundingRaces[cultureId]?.foundingRaceId;
        return foundingRaceId === undefined || childRaces.has(foundingRaceId);
      });
      if (!eligibleCultures.length) continue;
      for (const cultureId of eligibleCultures) {
        const share = pairCount / eligibleCultures.length;
        childMeasures.push({
          cultureId,
          religionId: null,
          humanOriginMix: childOriginId,
          population: share,
        });
      }
    }
  }
  const children = sumPopulationMeasures(childMeasures);

  const religions = [...religionCounts]
    .filter(([, population]) => Number.isFinite(population) && population > 0);
  if (!children.length || !religions.length) {
    return sourceGroups
      .filter((group) => group.population > 0)
      .map((group) => ({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId: group.originProfileId,
        weight: group.population,
      }));
  }

  const product = getBinaryMathKernel().measureProduct(
    makePopulationMeasure(
      [children.map((child) => child.cultureId), children.map((child) => child.humanOriginMix)],
      children.map((child) => child.population),
    ),
    makePopulationMeasure(
      [religions.map(([religionId]) => religionId)],
      religions.map(([, population]) => population),
    ),
    new Uint32Array([0, 4, 1, 8]),
    1,
    1,
    1,
    true,
    false,
  );
  return populationWeightsFromMeasure(product);
}
