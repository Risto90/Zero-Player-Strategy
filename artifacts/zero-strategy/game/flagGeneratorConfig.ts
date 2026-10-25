/** Pipeline policy from §14; numerical defaults live outside the generator code. */
export const FLAG_GENERATOR_CONFIG = {
  generatorVersion: '0.1.0',
  attemptsMax: 50,
  maxOptionalLayerRemovals: 40,
  fallbackProfileId: 'P28',
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
