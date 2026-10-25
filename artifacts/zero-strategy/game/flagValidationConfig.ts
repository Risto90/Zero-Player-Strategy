/** Настраиваемые пороги приёмки валидатора по §15. */
export const FLAG_VALIDATION_CONFIG = {
  referenceRasterHeight: 240,
  flagHeight: 1200,
  minimumThicknessPx: 6,
  minimumGapPx: 4,
  maximumComplexity: null as number | null,
  limits: {
    layers: 40,
    primitives: 120,
    pathPoints: 3000,
    svgBytes: 30 * 1024,
    colors: 5,
  },
  components: {
    minimumAreaShare: 0.003,
    forbiddenAreaShare: 0.0015,
    maximumOpeningLoss: 0.1,
    maximumClosingIncrease: 0.02,
    smallRasterHeight: 32,
    smallRasterComponentShare: 0.006,
    minimumSmallRasterRetention: 0.6,
  },
  colors: {
    minimumShare: 0.015,
    maximumShare: 0.85,
    minimumAdjacentDeltaE: 28,
    minimumChargeDeltaE: 35,
    minimumChargeContrast: 1.8,
    minimumSmallOutlinedChargeContrast: 1.3,
    smallChargeDiameterRatio: 0.15,
  },
  balance: {
    minimumWeightShare: 0.02,
    defaultRegion: [0.3, 0.62, 0.35, 0.65] as const,
  },
  collisions: {
    maximumOverlapShare: 0.003,
  },
  symmetry: {
    minimumAgreement: 0.985,
  },
  sharpAngles: {
    minimumPolygonDegrees: 12,
    minimumSunRayDegrees: 8,
  },
  svg: {
    allowedElements: ['svg', 'defs', 'clipPath', 'g', 'rect', 'circle', 'polygon', 'path', 'use'],
    allowedPathCommands: ['M', 'L', 'H', 'V', 'A', 'Z'],
  },
  cultural: {
    forbiddenPairs: [
      ['christian', 'islamic'],
      ['christian', 'dharmic'],
      ['islamic', 'dharmic'],
      ['socialist', 'royal'],
      ['socialist', 'christian'],
    ],
    hybridOnlyPairs: [
      ['steppe', 'islamic'],
      ['steppe', 'christian'],
      ['norse', 'christian'],
      ['maritime', '*'],
      ['roman', 'christian'],
    ],
    allowedTags: [
      'christian', 'islamic', 'dharmic', 'norse', 'steppe', 'royal',
      'socialist', 'maritime', 'roman', 'mesoamerican', 'neutral',
    ],
  },
} as const;

export type FlagValidationConfig = typeof FLAG_VALIDATION_CONFIG;
