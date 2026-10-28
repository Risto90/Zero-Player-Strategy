/**
 * Начальные параметры ординариев из §9.
 *
 * Значения хранятся в конфигурации отдельно от построения геометрии.
 */
export const FLAG_ORDINARY_CONFIG = {
  canvasHeight: 1200,
  minimumThicknessDivisor: 40,
  minimumGap: 20,
  polygonSamples: 48,
  defaultCenter: { u: 0.5, v: 0.5 },
  fimbration: [30, 60],
  limits: {
    maxOrdinaries: 3,
    maxCantons: 1,
    maxBordures: 1,
    maxFrameDepth: 3,
  },
  costs: {
    operators: {
      O01: 1,
      O02: 1,
      O03: 0.7,
      O04: 1,
      O05: 1.5,
      O06: 1,
      O07: 1.2,
      O08: 1,
      O09: 3,
    },
    doubleBordure: 0.5,
    cantonContentMultiplier: 0.7,
    nonStraightBoundaryGroup: 0.5,
    patternFill: 1,
    fimbration: 0.5,
  },
  thicknessSnap: { preferredDivisor: 24, fineDivisor: 60, preferredProbability: 0.75 },
  operators: {
    O01: {
      thicknessDivisors: [12, 4], defaultThicknessDivisor: 6, coupleLength: [0.2, 0.45],
      defaultCoupleLength: 0.32, flare: [1.3, 1.8], defaultFlare: 1.5,
      latinLength: [1.2, 1.5], defaultLatinLength: 1.3, defaultScandinavianCenter: 0.36,
      scandinavianCenterRange: [0.3, 0.42],
      doubleScale: [0.4, 0.7],
    },
    O02: { thicknessDivisors: [12, 4], defaultThicknessDivisor: 6 },
    O03: {
      thicknessDivisors: [12, 4], defaultThicknessDivisor: 8,
      edgeThicknessDivisors: [8, 3],
      angles: [0, 90, 'DIAGONAL', 30, -30, 45, -45, 60, -60], defaultAxis: 'DIAGONAL',
      defaultOffset: 0,
    },
    O04: { thicknessDivisors: [12, 5], defaultThicknessDivisor: 10, halfAngles: [20, 60], defaultHalfAngle: 35 },
    O05: {
      thicknessDivisors: [12, 6],
      defaultThicknessDivisor: 12,
      stemDirections: [
        { id: 'DOWN', angle: 90, weight: 4 },
        { id: 'UP', angle: -90, weight: 1 },
        { id: 'FLY', angle: 0, weight: 2 },
        { id: 'HOIST', angle: 180, weight: 1 },
      ],
      branchAngles: [
        { angle: 135, weight: 0.6 },
        { angle: 120, weight: 0.4 },
      ],
      defaultStemDirection: 'DOWN',
      defaultBranchAngle: 135,
      centerDivisor: 24,
      centerRange: [8 / 24, 16 / 24],
    },
    O06: {
      baseSideFraction: [0.4, 1], defaultBaseSideFraction: 0.65,
      depthFraction: [0.25, 1], defaultDepthFraction: 0.55,
      apexPosition: [0.3, 0.7], defaultApexPosition: 0.5,
      truncatedTip: [0, 0.5], defaultTipFraction: 0, defaultTruncatedTipFraction: 0.25,
    },
    O07: {
      thicknessDivisors: [32, 7], defaultThicknessDivisor: 8,
      checkyThicknessDivisors: [16, 8],
      variants: ['PLAIN', 'DOUBLE', 'CHECKY', 'ORLE'],
      defaultSecondaryFill: 's3',
    },
    O08: {
      widthFraction: [0.25, 0.5], defaultWidthFraction: 0.36,
      heightFraction: [0.25, 0.6], defaultHeightFraction: 0.36,
      defaultCorner: 'HOIST_TOP',
    },
    O09: {
      saltireCount: [1, 2], defaultSaltireCount: 1, secondSaltireScale: [0.3, 0.5],
      pinwheelShift: [0, 0.5], crossCount: [0, 1, 2], defaultCrossCount: 1,
      thicknessDivisors: [12, 4], defaultThicknessDivisor: 6,
      defaultSecondSaltireScale: 0.4, defaultSecondCrossScale: 0.5,
      defaultFieldFill: 's1', defaultSaltireFill: 's3', defaultSecondSaltireFill: 's4',
      defaultCrossFill: 's2', defaultSecondCrossFill: 's5', defaultSecondarySlot: 's2',
    },
  },
} as const;
