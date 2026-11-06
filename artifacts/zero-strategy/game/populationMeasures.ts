import type { KernelPopulationMeasure } from '../kernel/bindings/contracts';
import { getBinaryMathKernel } from '../kernel/runtime';

/** Игровая запись меры: размер группы остаётся в единицах вызывающей операции. */
export interface PopulationMeasureEntry {
  cultureId: number;
  religionId: number | null;
  humanOriginMix: number;
  population: number;
}

export type PopulationPriorityTier = 0 | 1 | 2;

/** Складывает одинаковые записи меры населения средствами общей алгебры ядра. */
export function sumPopulationMeasures(
  ...measures: readonly (readonly PopulationMeasureEntry[])[]
): PopulationMeasureEntry[] {
  const source = measureToKernel(measures.flat());
  if (!source.mass.length) return [];
  return groupsFromKernel(getBinaryMathKernel().sumPopulationMeasure(source));
}

function measureToKernel(groups: readonly PopulationMeasureEntry[]): KernelPopulationMeasure {
  const included = groups.filter((group) => group.population > 0);
  const keys = new Uint32Array(included.length * 4);
  const mass = new Float64Array(included.length);
  included.forEach((group, index) => {
    const religion = group.religionId === null ? 0xffff_ffff : group.religionId;
    for (const [value, name] of [
      [group.cultureId, 'культура'],
      [religion, 'вера'],
      [group.humanOriginMix, 'происхождение'],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new RangeError(`Идентификатор измерения «${name}» должен быть uint32.`);
      }
    }
    if (!Number.isFinite(group.population)) {
      throw new RangeError('Масса группы населения должна быть конечной.');
    }
    const offset = index * 4;
    keys[offset] = group.cultureId;
    keys[offset + 1] = religion;
    keys[offset + 2] = group.humanOriginMix;
    keys[offset + 3] = 0;
    mass[index] = group.population;
  });
  return { keys, mass };
}

function groupsFromKernel(measure: KernelPopulationMeasure): PopulationMeasureEntry[] {
  return Array.from(measure.mass, (population, index) => ({
    cultureId: measure.keys[index * 4],
    religionId: measure.keys[index * 4 + 1] === 0xffff_ffff
      ? null
      : measure.keys[index * 4 + 1],
    humanOriginMix: measure.keys[index * 4 + 2],
    population,
  }));
}

/** Извлекает массу из записи по игровым приоритетным слоям бинарного ядра. */
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
  const sourceMeasure = measureToKernel(source);
  if (!sourceMeasure.mass.length) return { selected: [], remaining: [] };
  const split = getBinaryMathKernel().takePopulationMeasure(
    sourceMeasure,
    measureToKernel(reference),
    new Uint32Array(priorityOrder),
    amount,
  );
  return {
    selected: groupsFromKernel(split.selected),
    remaining: groupsFromKernel(split.remaining),
  };
}
