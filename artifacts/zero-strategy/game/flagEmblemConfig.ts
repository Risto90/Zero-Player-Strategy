/**
 * Starter settings for charge modules and recursive composers (§10).
 * Weights/costs are data-owned so future profiles can replace these values.
 * A unit is the emblem's normalized diameter (1); geometry algorithms live in
 * flagEmblems.ts.
 */
const moduleEntry = (tags: string[], defaults: Record<string, unknown>, cost = 1) => ({
  tags,
  cost,
  primitiveCount: 'computed',
  defaults,
});

export const FLAG_EMBLEM_CONFIG = {
  maxDepth: 3,
  maxPrimitives: 64,
  curveTolerance: 0.0005,
  glyph: {
    gridSizes: [3, 4, 5],
    edgeCount: [3, 8],
    directions: [0, 45, 90, 135],
    mirrorProbability: 0.6,
    curveProbability: 0.35,
    strokeWidth: 0.06,
    defaultCap: 'BUTT',
    defaultJoin: 'MITER',
    minimumStroke: 30,
    defaultCanvasHeight: 1200,
    minimumScale: 0.4166666667,
    endpointCaps: ['BUTT', 'ROUND'],
    joins: ['MITER', 'ROUND'],
    maxAspectRatio: 2,
    minimumStarTipAngle: 12,
    separationFactor: 2,
    attempts: 200,
    arcSamples: 12,
  },
  modules: {
    M01: moduleEntry(['round', 'plain'], {}),
    M02: moduleEntry(['round', 'annular'], { innerRatio: 0.65 }, 1),
    M03: moduleEntry(['star', 'radial'], { points: 5, innerRatio: 0.382, mode: 'POINTED', skip: 2 }),
    M04: moduleEntry(['polygon', 'regular'], { sides: 5, rotation: 'FLAT' }),
    M05: moduleEntry(['polygon', 'lozenge'], { verticalRatio: 0.75 }),
    M06: moduleEntry(['crescent', 'lunar'], { innerRatio: 0.8, offsetRatio: 0.35, rotation: 0 }),
    M07: moduleEntry(['solar', 'radial'], { rays: 12, rayType: 'TRI', coreRadius: 0.24, rayLength: 0.55, rayWidth: 0.65, waveAmplitude: 0.08 }),
    M08: moduleEntry(['wheel', 'radial'], { spokes: 8, innerRatio: 0.66, hubRatio: 0.17, gear: false }),
    M09: moduleEntry(['cross', 'heraldic'], { arms: 4, thickness: 0.22, profile: 'RECT', latinRatio: 1.2 }),
    M10: moduleEntry(['chevron', 'arrow'], { mode: 'ARROW', angle: 50, thickness: 0.12 }),
    M11: moduleEntry(['lens', 'organic'], { length: 0.8, width: 0.38 }),
    M12: moduleEntry(['lily', 'floral'], { sideAngle: 45, lowerPetal: false }),
    M13: moduleEntry(['tower', 'architectural'], { merlons: 4, sideTowers: false, windows: 0, archedDoor: false }),
    M14: moduleEntry(['crown', 'regalia'], { points: 5, arch: false }),
    M15: moduleEntry(['key', 'tool'], { teeth: 2 }),
    M16: moduleEntry(['sword', 'tool'], { bladeRatio: 0.66 }),
    M17: moduleEntry(['spear', 'tool'], { mode: 'SPEAR', head: 'TRIANGLE' }),
    M18: moduleEntry(['anchor', 'nautical'], {}),
    M19: moduleEntry(['tree', 'nature'], { style: 'CONIFER', tiers: 3, leaves: 7 }),
    M20: moduleEntry(['mountain', 'landscape'], { peaks: 1, snow: false, sun: false }),
    M21: moduleEntry(['waves', 'water'], { bands: 3, amplitude: 0.08, wavelength: 0.28 }),
    M22: moduleEntry(['ship', 'nautical'], { sails: 2, galley: false, oars: 6 }),
    M23: moduleEntry(['winged', 'animal'], { body: 'DISC', feathers: 4, featherAngle: 35, tail: false, head: false }),
    M24: moduleEntry(['glyph', 'geometric'], { strokeWidth: 0.06 }),
    M25: moduleEntry(['swirl', 'rotational'], { lobes: 3 }),
    M26: moduleEntry(['foil', 'floral'], { style: 'TREFOIL', radius: 0.32 }),
    M27: moduleEntry(['flame', 'organic'], {}),
    M28: moduleEntry(['shield', 'container'], { shape: 'HEATER', inset: 0.58 }),
    M29: moduleEntry(['bow', 'weapon'], { span: 120, strokeWidth: 0.055 }),
    M30: moduleEntry(['bar-stack', 'composite'], { modules: ['M11', 'M01', 'M06', 'M04'] }),
  },
  composers: {
    SINGLE: { cost: 0, defaults: {} },
    STACK: { cost: 1, count: [2, 4], gap: [0.05, 0.25], defaults: { axis: 'VERTICAL', count: 3, gap: 0.1 } },
    PAIR_MIRROR: { cost: 1, distance: [0.05, 0.5], defaults: { axis: 'VERTICAL', distance: 0.3 } },
    CROSSED: { cost: 1, angle: [25, 50], defaults: { angle: 35, order: 'FIRST_OVER_SECOND' } },
    RING: { cost: 1, count: [3, 16], radius: [0.2, 0.5], defaults: { count: 6, radius: 0.32, orientation: 'OUT' } },
    ARC_REPEAT: { cost: 1, count: [3, 16], sweep: [120, 300], radius: [0.2, 0.5], defaults: { count: 7, sweep: 240, radius: 0.38 } },
    INSCRIBE: { cost: 1, scale: [0.45, 0.7], defaults: { frame: 'DISC', scale: 0.58 } },
    FLANK: { cost: 1, scale: [0.5, 0.8], defaults: { sideScale: 0.65, offset: 0.3 } },
    CHARGE_ON_CHARGE: { cost: 1, scale: [0.2, 0.6], defaults: { smallScale: 0.38, offset: { x: 0, y: 0 } } },
    CONCENTRIC: { cost: 1, rings: [1, 4], defaults: { rings: 2, innerRatio: 0.68 } },
  },
  defaults: {
    circleSamples: 96,
    arcSamples: 24,
    minimumDetail: 0.025,
  },
} as const;

export type FlagEmblemModuleId = keyof typeof FLAG_EMBLEM_CONFIG.modules;
export type FlagEmblemComposerId = keyof typeof FLAG_EMBLEM_CONFIG.composers;
