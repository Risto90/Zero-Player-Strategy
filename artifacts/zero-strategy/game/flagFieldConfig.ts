/**
 * Starting parameters for the §7 field operators.
 *
 * Keep numerical policy here so profiles and future tuning can override it
 * without changing the geometry implementation.
 */
export const FLAG_FIELD_CONFIG = {
  canvasHeight: 1200,
  minimumThicknessDivisor: 40,
  limits: {
    maxRegions: 16,
    maxDepth: 2,
  },
  slots: ['s1', 's2', 's3', 's4', 's5'],
  weights: {
    symmetricRatios: [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 2, 2, 3, 4],
    compositionTotal: [6, 24],
    accentSeparatorDivisors: [12, 6],
    defaultAccentSeparatorDivisor: 8,
  },
  operators: {
    G02: { bands: [2, 13], defaultBands: 3, defaultAxis: 'H' },
    G03: { bands: [2, 7], defaultBands: 3, defaultAngle: 'DIAGONAL', angles: [30, 45, 60] },
    G04: {
      splitFractions: [1 / 2, 1 / 3, 2 / 5, 3 / 5, 2 / 3],
      chevronVertexDivisor: 24,
      defaultChevronSlope: 0.5,
      defaultChevronVertex: { u: 0.5, v: 0.5 },
    },
    G05: { splitFractions: [1 / 2, 2 / 5, 3 / 8, 3 / 5, 1 / 3], defaultSplit: 0.5 },
    G06: { defaultCenter: { u: 0.5, v: 0.5 } },
    G07: { defaultCenter: { u: 0.5, v: 0.5 }, defaultStartAngle: -90, angleSets: [[120, 120, 120], [90, 135, 135]] },
    G08: {
      counts: [8, 12, 16, 24],
      colors: [2, 3],
      defaultCount: 8,
      defaultCenter: { u: 0.5, v: 0.5 },
      maximumPoleShift: 0.2,
      fanCenterRange: [-0.3, 1.3],
    },
    G09: { columns: [4, 16], defaultColumns: 8, defaultOrigin: 'CORNER' },
    G10: {
      angles: [50, 70],
      cellSizeDivisors: [10, 4],
      defaultAngle: 60,
      defaultCellSizeDivisor: 6,
      defaultOrigin: 'CENTER',
    },
    G11: {
      bands: [3, 9],
      defaultBands: 3,
      defaultAmplitude: 0.12,
      maxAmplitudePerBand: 1,
      defaultVertex: { u: 0.5, v: 0.5 },
    },
    G12: {
      bands: [2, 6],
      defaultBands: 3,
      defaultCenter: { u: 0.5, v: 0.5 },
      defaultFigure: 'circle',
      polygonSamples: 64,
    },
  },
} as const;
