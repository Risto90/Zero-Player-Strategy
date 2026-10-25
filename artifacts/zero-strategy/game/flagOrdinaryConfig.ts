/**
 * Starting parameters for the §9 ordinary operators.
 *
 * Values stay in configuration so the generator can tune them without
 * changing geometry code.
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
    maxTotalCost: 6,
    maxFrameDepth: 3,
  },
  costs: {
    default: 1,
    fimbration: 0.5,
  },
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
      angles: [0, 90, 'DIAGONAL', 30, -30, 45, -45, 60, -60], defaultAxis: 'DIAGONAL',
      defaultOffset: 0,
    },
    O04: { thicknessDivisors: [12, 4], defaultThicknessDivisor: 8, halfAngles: [20, 60], defaultHalfAngle: 35 },
    O05: { thicknessDivisors: [12, 4], defaultThicknessDivisor: 8, defaultAngles: [-90, 150, 30] },
    O06: {
      baseSideFraction: [0.4, 1], defaultBaseSideFraction: 0.65,
      depthFraction: [0.25, 1], defaultDepthFraction: 0.55,
      apexPosition: [0.3, 0.7], defaultApexPosition: 0.5,
      truncatedTip: [0, 0.5], defaultTipFraction: 0, defaultTruncatedTipFraction: 0.25,
    },
    O07: {
      thicknessDivisors: [32, 7], defaultThicknessDivisor: 16,
      variants: ['PLAIN', 'DOUBLE', 'CHECKY', 'ORLE'], defaultCheckCellDivisor: 8,
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
