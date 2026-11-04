import { runAlgebraQuery, type AlgebraTable } from '../kernel/algebra';

/** Игровая запись меры: размер группы остаётся в единицах вызывающей операции. */
export interface PopulationMeasureEntry {
  cultureId: number;
  religionId: number | null;
  humanOriginMix: number;
  population: number;
}

export type PopulationPriorityTier = 0 | 1 | 2;

const KEY_COLUMNS = ['cultureId', 'religionId', 'humanOriginMix'] as const;
const WEIGHT_COLUMN = 'population';

function tableFromGroups(groups: readonly PopulationMeasureEntry[]): AlgebraTable {
  return {
    columns: [...KEY_COLUMNS, WEIGHT_COLUMN],
    rows: groups.filter((group) => group.population > 0).map((group) => [
      group.cultureId,
      group.religionId ?? -1,
      group.humanOriginMix,
      group.population,
    ]),
    weightColumn: WEIGHT_COLUMN,
  };
}

function groupsFromTable(table: AlgebraTable): PopulationMeasureEntry[] {
  const columns = new Map(table.columns.map((name, index) => [name, index]));
  const index = (name: string) => {
    const value = columns.get(name);
    if (value === undefined) throw new Error(`В результате меры отсутствует измерение «${name}».`);
    return value;
  };
  const cultureAt = index('cultureId');
  const religionAt = index('religionId');
  const originAt = index('humanOriginMix');
  const populationAt = index(WEIGHT_COLUMN);
  return table.rows.map((row) => {
    const cultureId = row[cultureAt];
    const religionId = row[religionAt];
    const humanOriginMix = row[originAt];
    const population = row[populationAt];
    if (typeof cultureId !== 'number' || typeof religionId !== 'number' ||
        typeof humanOriginMix !== 'number' || typeof population !== 'number') {
      throw new TypeError('Ядро вернуло запись меры населения неверного формата.');
    }
    return {
      cultureId,
      religionId: religionId < 0 ? null : religionId,
      humanOriginMix,
      population,
    };
  });
}

/** Складывает одинаковые записи меры населения средствами общей алгебры ядра. */
export function sumPopulationMeasures(
  ...measures: readonly (readonly PopulationMeasureEntry[])[]
): PopulationMeasureEntry[] {
  const groups = measures.flat();
  if (!groups.length) return [];
  const result = runAlgebraQuery({
    inputs: { source: tableFromGroups(groups) },
    operations: [{
      op: 'measureSum',
      id: 'sum',
      inputs: ['source'],
      keyColumns: KEY_COLUMNS,
      weightColumn: WEIGHT_COLUMN,
    }],
  });
  return groupsFromTable(result.tables.sum);
}

/**
 * Извлекает массу из записи по игровым приоритетным слоям.
 * Ядро выполняет только взвешенное извлечение; правило соответствия групп задаётся здесь.
 */
export function takePopulationMeasure(
  source: readonly PopulationMeasureEntry[],
  amount: number,
  reference: readonly PopulationMeasureEntry[],
  priorityOrder: readonly PopulationPriorityTier[] = [0, 1, 2],
): { selected: PopulationMeasureEntry[]; remaining: PopulationMeasureEntry[] } {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Количество населения должно быть неотрицательным числом.');
  if (priorityOrder.length !== 3 || new Set(priorityOrder).size !== 3 ||
      priorityOrder.some((tier) => tier < 0 || tier > 2)) {
    throw new RangeError('Приоритетные слои населения должны содержать каждый ранг ровно один раз.');
  }
  if (!source.length) return { selected: [], remaining: [] };

  const referenceCultures = new Set(reference.filter((group) => group.population > 0).map((group) => group.cultureId));
  const referenceReligions = new Set(reference.filter((group) => group.population > 0).map((group) => group.religionId));
  const exactPairs = new Set(reference.filter((group) => group.population > 0)
    .map((group) => `${group.cultureId}/${group.religionId ?? 'a'}`));
  const ranked = source.map((group) => {
    const sameCulture = referenceCultures.has(group.cultureId);
    const sameReligion = referenceReligions.has(group.religionId);
    const samePair = exactPairs.has(`${group.cultureId}/${group.religionId ?? 'a'}`);
    const tier: PopulationPriorityTier = sameCulture && sameReligion && samePair
      ? 0
      : sameCulture || sameReligion ? 1 : 2;
    return { group, tier };
  });
  const selected: PopulationMeasureEntry[] = [];
  const remaining: PopulationMeasureEntry[] = [];
  let left = Math.min(amount, source.reduce((sum, group) => sum + Math.max(0, group.population), 0));
  for (const tier of priorityOrder) {
    const bucket = ranked.filter((item) => item.tier === tier && item.group.population > 0)
      .map((item) => item.group);
    if (!bucket.length) continue;
    if (left <= 0) {
      remaining.push(...bucket);
      continue;
    }
    const result = runAlgebraQuery({
      inputs: { source: tableFromGroups(bucket) },
      operations: [{
        op: 'take',
        id: 'selection',
        input: 'source',
        keyColumns: KEY_COLUMNS,
        weightColumn: WEIGHT_COLUMN,
        amount: left,
      }],
    });
    const split = result.selections.selection;
    const taken = groupsFromTable(split.selected);
    const kept = groupsFromTable(split.remaining);
    selected.push(...taken);
    remaining.push(...kept);
    left -= taken.reduce((sum, group) => sum + group.population, 0);
  }
  return { selected, remaining };
}
