/** Распределяет целое количество единиц по весам методом наибольших остатков. */
export function apportionIntegerTotal(total: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError('Итоговое количество должно быть неотрицательным целым числом');
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new RangeError('Веса должны быть конечными неотрицательными числами');
  }
  const sum = weights.reduce((value, weight) => value + weight, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => total * weight / sum);
  const result = exact.map(Math.floor);
  let remainder = total - result.reduce((value, amount) => value + amount, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - result[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) result[order[index].index] += 1;
  return result;
}
