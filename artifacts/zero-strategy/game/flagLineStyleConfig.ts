/**
 * Starting parameters for the §8 division-line styles.
 * Dimensions scale with the flag's canonical height.
 */
export const FLAG_LINE_STYLE_CONFIG = {
  minimumThicknessDivisor: 40,
  amplitudeDivisors: [40, 12],
  defaultAmplitudeDivisor: 20,
  periodDivisors: [10, 3],
  defaultPeriodDivisor: 6,
  samplesPerPeriod: 48,
} as const;
