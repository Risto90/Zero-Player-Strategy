/**
 * Исходные параметры стилей линий раздела §8.
 * Размеры масштабируются по канонической высоте флага.
 */
export const FLAG_LINE_STYLE_CONFIG = {
  minimumThicknessDivisor: 40,
  amplitudeDivisors: [40, 12],
  defaultAmplitudeDivisor: 20,
  periodDivisors: [10, 3],
  defaultPeriodDivisor: 6,
  samplesPerPeriod: 48,
} as const;
