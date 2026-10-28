/** Политика конвейера из §14; числовые значения по умолчанию вынесены из кода генератора. */
export const FLAG_GENERATOR_CONFIG = {
  generatorVersion: '1.0.6',
  attemptsMax: 50,
  fallbackAttemptsMax: 200,
  maxOptionalLayerRemovals: 40,
  fallbackProfileId: 'P28_FB',
  physical: {
    minimumThickness: 30,
    minimumGap: 20,
    canvasHeight: 1200,
  },
  localRetries: {
    charges: 8,
    ordinaries: 4,
    field: 1,
  },
  complexityRemovalOrder: [
    'optional-charge-lowest-weight',
    'fimbriation',
    'pattern-fill',
    'second-ordinary',
  ],
  geometryRepair: {
    chargeScale: 0.92,
    chargeScaleAttempts: 5,
    repeatStepScale: 1.1,
    order: ['shrink-charge', 'move-to-nearest-safe-point', 'expand-repeat-step', 'remove-repeat-or-charge'],
  },
} as const;
