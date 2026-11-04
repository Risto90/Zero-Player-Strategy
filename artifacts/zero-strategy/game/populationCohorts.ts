import { quantizeShares, type CompositionTable } from './composition';
import { sumPopulationMeasures, takePopulationMeasure } from './populationMeasures';
import { runAlgebraQuery } from '../kernel/algebra';
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
  const religions = {
    columns: ['religionId', 'share'],
    rows: [
      ...religion.ids.map((religionId, index) => [religionId, religion.shares[index]]),
      [null, Math.max(0, 100 - religion.total)],
    ],
  };
  const origins = origin?.total > 0
    ? {
      columns: ['originProfileId', 'share'],
      rows: origin.ids.map((originProfileId, index) => [originProfileId, origin.shares[index]]),
    }
    : {
      columns: ['originProfileId', 'share'],
      rows: [[0, 100]],
    };
  const intersections = runAlgebraQuery({
    inputs: {
      cultures: {
        columns: ['cultureId', 'share'],
        rows: culture.ids.map((cultureId, index) => [cultureId, culture.shares[index]]),
      },
      religions,
      origins,
    },
    operations: [
      {
        op: 'product',
        id: 'cultureReligions',
        left: 'cultures',
        right: 'religions',
        columns: [
          { from: 'left', column: 'cultureId', as: 'cultureId' },
          { from: 'left', column: 'share', as: 'cultureShare' },
          { from: 'right', column: 'religionId', as: 'religionId' },
          { from: 'right', column: 'share', as: 'religionShare' },
        ],
      },
      {
        op: 'product',
        id: 'populationGroups',
        left: 'cultureReligions',
        right: 'origins',
        columns: [
          { from: 'left', column: 'cultureId', as: 'cultureId' },
          { from: 'left', column: 'cultureShare', as: 'cultureShare' },
          { from: 'left', column: 'religionId', as: 'religionId' },
          { from: 'left', column: 'religionShare', as: 'religionShare' },
          { from: 'right', column: 'originProfileId', as: 'originProfileId' },
          { from: 'right', column: 'share', as: 'originShare' },
        ],
      },
    ],
  }).tables.populationGroups;
  return intersections.rows.flatMap((row) => {
    const [cultureId, cultureShare, religionId, religionShare, originProfileId, originShare] = row;
    if (typeof cultureId !== 'number' || typeof cultureShare !== 'number' ||
        (typeof religionId !== 'number' && religionId !== null) ||
        typeof religionShare !== 'number' || typeof originProfileId !== 'number' ||
        typeof originShare !== 'number') {
      throw new TypeError('Ядро вернуло некорректное пересечение состава населения.');
    }
    const share = cultureShare * religionShare * originShare / 10_000;
    return share > 0
      ? [{ cultureId, religionId, originProfileId, weight: population * share / 100 }]
      : [];
  });
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
  const religionTotal = religions.reduce((sum, [, population]) => sum + population, 0);
  const childTotal = children.reduce((sum, group) => sum + group.population, 0);
  if (!(childTotal > 0) || !(religionTotal > 0)) {
    return sourceGroups
      .filter((group) => group.population > 0)
      .map((group) => ({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId: group.originProfileId,
        weight: group.population,
      }));
  }

  const product = runAlgebraQuery({
    inputs: {
      children: {
        columns: ['cultureId', 'originProfileId', 'population'],
        rows: children.map((child) => [child.cultureId, child.humanOriginMix, child.population]),
      },
      religions: {
        columns: ['religionId', 'population'],
        rows: religions.map(([religionId, population]) => [religionId, population]),
      },
    },
    operations: [{
      op: 'product',
      id: 'newPopulationGroups',
      left: 'children',
      right: 'religions',
      columns: [
        { from: 'left', column: 'cultureId', as: 'cultureId' },
        { from: 'left', column: 'originProfileId', as: 'originProfileId' },
        { from: 'left', column: 'population', as: 'childPopulation' },
        { from: 'right', column: 'religionId', as: 'religionId' },
        { from: 'right', column: 'population', as: 'religionPopulation' },
      ],
    }],
  }).tables.newPopulationGroups;
  return product.rows.map((row) => {
    const [cultureId, originProfileId, childPopulation, religionId, religionPopulation] = row;
    if (typeof cultureId !== 'number' || typeof originProfileId !== 'number' ||
        typeof childPopulation !== 'number' || typeof religionPopulation !== 'number' ||
        (typeof religionId !== 'number' && religionId !== null)) {
      throw new TypeError('Ядро вернуло некорректное пересечение состава населения.');
    }
    return {
      cultureId,
      originProfileId,
      religionId: religionId === null || religionId < 0 ? null : religionId,
      weight: childPopulation * religionPopulation / religionTotal,
    };
  });
}
