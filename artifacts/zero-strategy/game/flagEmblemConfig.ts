/**
 * Начальные параметры модулей и композиторов зарядов из §10.
 * Для модулей без стоимости в исходном ТЗ сохраняется настраиваемое значение 1.
 * Единица масштаба — нормированный диаметр эмблемы; геометрия находится в flagEmblems.ts.
 */
const moduleEntry = (
  tags: string[],
  defaults: Record<string, unknown>,
  cost = 1,
  qualification: {
    f_min?: number;
    symmetry_group?: string;
    minimum_convex_angle_degrees?: number;
    allowed_parameter_sets?: Record<string, unknown>[];
    f_min_by_parameter?: Record<string, Record<string, number>>;
    symmetry_group_by_parameter?: Record<string, Record<string, string>>;
  } = {},
) => ({
  tags,
  cost,
  primitiveCount: 'computed',
  defaults,
  qualification: {
    f_min: qualification.f_min ?? 0.05,
    symmetry_group: qualification.symmetry_group ?? 'D2',
    minimum_convex_angle_degrees: qualification.minimum_convex_angle_degrees ?? 12,
    allowed_parameter_sets: qualification.allowed_parameter_sets ?? [defaults],
    ...(qualification.f_min_by_parameter ? { f_min_by_parameter: qualification.f_min_by_parameter } : {}),
    ...(qualification.symmetry_group_by_parameter ? { symmetry_group_by_parameter: qualification.symmetry_group_by_parameter } : {}),
  },
});
const STAR_MINIMUM_ANGLE = 12;
const STAR_MINIMUM_RATIO = 0.4;
const STAR_MAXIMUM_RATIO = 0.75;
const STAR_PARAMETER_SETS = [5, 6, 8, 12, 24].flatMap((points) => {
  const tangent = Math.tan(STAR_MINIMUM_ANGLE * Math.PI / 360);
  const innerRatio = tangent /
    (Math.sin(Math.PI / points) + tangent * Math.cos(Math.PI / points));
  return [Math.max(STAR_MINIMUM_RATIO, innerRatio), STAR_MAXIMUM_RATIO].map((ratio) => ({
    points, innerRatio: ratio, mode: 'POINTED', skip: 2,
  }));
});
const CROWN_PARAMETER_SETS = [3, 5, 7].map((points) => ({ points, arch: false, dots: false }));
const CROSS_EMB_PARAMETER_SETS = [
  { arms: 4, thickness: 0.22, profile: 'RECT', latinRatio: 1.2 },
  { arms: 4, thickness: 0.22, profile: 'FLARED', latinRatio: 1.2 },
];
const GLYPH_PARAMETER_SETS = [
  { strokeWidth: 0.06, gridSize: 3, mirrored: false, edgeCount: 3, endpointCap: 'BUTT', join: 'MITER' },
  { strokeWidth: 0.06, gridSize: 3, mirrored: true, edgeCount: 8, endpointCap: 'ROUND', join: 'MITER' },
  { strokeWidth: 0.06, gridSize: 5, mirrored: false, edgeCount: 8, endpointCap: 'ROUND', join: 'ROUND' },
  { strokeWidth: 0.06, gridSize: 5, mirrored: true, edgeCount: 5, endpointCap: 'BUTT', join: 'ROUND' },
];
const SUN_RAYS = [8, 12, 16];
const SUN_CORE_RADIUS = 0.24;
const SUN_RAY_WIDTH = 0.5;
const SUN_RAY_LENGTH = 0.55;
const SUN_RAY_OVERLAP = 0.04;
const SUN_RAY_TIP_WIDTH = 0.032;
const SUN_F_MIN_BY_RAYS = Object.fromEntries(SUN_RAYS.map((rays) => [
  String(rays),
  Math.min(2 * SUN_RAY_WIDTH * Math.PI * SUN_CORE_RADIUS / rays, SUN_RAY_TIP_WIDTH),
]));
const SUN_PARAMETER_SETS = SUN_RAYS.map((rays) => ({
  rays,
  rayType: 'TRI',
  coreRadius: SUN_CORE_RADIUS,
  rayLength: SUN_RAY_LENGTH,
  rayWidth: SUN_RAY_WIDTH,
  rayOverlap: SUN_RAY_OVERLAP,
  rayTipWidth: SUN_RAY_TIP_WIDTH,
  waveAmplitude: 0.076,
}));
const WAVE_PARAMETER_SETS = [
  { bands: 2, amplitude: 0.03, wavelength: 0.25, phase: 0, clipShape: 'RECT' },
  { bands: 2, amplitude: 0.08, wavelength: 0.5, phase: Math.PI / 2, clipShape: 'CIRCLE' },
  { bands: 3, amplitude: 0.08, wavelength: 0.28, phase: 0, clipShape: 'RECT' },
  { bands: 3, amplitude: 0.03, wavelength: 0.5, phase: Math.PI, clipShape: 'CIRCLE' },
  { bands: 4, amplitude: 0.03, wavelength: 0.5, phase: Math.PI / 2, clipShape: 'RECT' },
  { bands: 4, amplitude: 0.08, wavelength: 0.25, phase: 0, clipShape: 'CIRCLE' },
];

export const FLAG_EMBLEM_CONFIG = {
  maxDepth: 3,
  maxPrimitives: 64,
  curveTolerance: 0.0005,
  qualification: {
    maximumDiameterFraction: 0.8,
    diameterGridPoints: 5,
  },
  glyph: {
    gridSizes: [3, 4, 5],
    edgeCount: [3, 8],
    directions: [0, 45, 90, 135],
    mirrorProbability: 0.6,
    curveProbability: 0.25,
    straightEdgeProbability: 0.75,
    adjacentStepProbability: 0.8,
    orthogonalSkipProbability: 0.2,
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
  geometry: {
    star: {
      minimumPointAngleDegrees: STAR_MINIMUM_ANGLE,
      minimumInnerRatio: STAR_MINIMUM_RATIO,
      maximumInnerRatio: STAR_MAXIMUM_RATIO,
      minimumSunRayAngleDegrees: 8,
    },
    crown: {
      bandX: [-0.5, 0.5],
      bandY: [0.12, 0.38],
      toothTipY: -0.38,
      allowedPoints: [3, 5, 7],
      dotRadius: 0.075,
      dotMinimumDiameter: 240,
    },
    waves: {
      bandCounts: [2, 3, 4],
      amplitudeRange: [0.03, 0.08],
      wavelengthRange: [0.25, 0.5],
      phaseRange: [0, 2 * Math.PI],
      clipShapes: ['RECT', 'CIRCLE'],
      samplesPerPeriod: 24,
      minimumBandFraction: 0.09,
    },
    sword: {
      bladeTip: [0, -0.5],
      bladeBase: [-0.06, -0.04, 0.06, -0.04],
      guard: [-0.28, -0.04, 0.28, 0.08],
      grip: [-0.06, 0.08, 0.06, 0.36],
      pommelCenter: [0, 0.43],
      pommelRadius: 0.07,
    },
    crossFlared: {
      straightEnd: 0.28,
      armEnd: 0.5,
      endWidthMultiplier: 1.5,
    },
    anchor: {
      shaft: [-0.035, -0.3, 0.035, 0.36],
      crossbar: [-0.25, -0.3, 0.25, -0.23],
      ringCenter: [0, -0.39],
      ringOuterRadius: 0.15,
      ringInnerRadius: 0.07,
      flukeCenter: [0, 0.17],
      flukeCenterlineRadius: 0.175,
      flukeThickness: 0.07,
      flukeAngles: [-10, 190],
      flukeArcSegments: 32,
      flukeBladeBaseHalfWidth: 0.07,
      flukeBladeTangentLength: 0.14,
    },
    shield: {
      shapes: ['HEATER', 'ROUND', 'KITE', 'LOZENGE', 'PENTAGON'],
    },
  },
  costs: {
    composerFactor: 0.8,
    repeatPerCopy: 0.1,
    repeatMaximumSurcharge: 2,
  },
  modules: {
    M01: moduleEntry(['round', 'plain'], {}, 0.7, { f_min: 0.45 }),
    M02: moduleEntry(['round', 'annular'], { innerRatio: 0.65 }, 0.7, { f_min: 0.175 }),
    M03: moduleEntry(['star', 'radial'], { points: 5, innerRatio: 0.4, mode: 'POINTED', skip: 2 }, 0.7,
      { f_min: 0.1, symmetry_group: 'D_VARIABLE', allowed_parameter_sets: STAR_PARAMETER_SETS,
        f_min_by_parameter: { points: { '5': 0.1, '6': 0.1, '8': 0.1, '12': 0.1, '24': 0.1 } },
        symmetry_group_by_parameter: { points: { '5': 'D5', '6': 'D6', '8': 'D8', '12': 'D12', '24': 'D24' } } }),
    M04: moduleEntry(['polygon', 'regular'], { sides: 5, rotation: 'FLAT' }, 0.7),
    M05: moduleEntry(['polygon', 'lozenge'], { verticalRatio: 0.75 }, 0.7),
    M06: moduleEntry(['crescent', 'lunar'], { innerRatio: 0.8, offsetRatio: 0.35, rotation: 0 }, 0.7,
      { f_min: 0.1, symmetry_group: 'D1' }),
    M07: moduleEntry(['solar', 'radial'], { rays: 12, rayType: 'TRI', coreRadius: SUN_CORE_RADIUS, rayLength: SUN_RAY_LENGTH, rayWidth: SUN_RAY_WIDTH, rayOverlap: SUN_RAY_OVERLAP, rayTipWidth: SUN_RAY_TIP_WIDTH, waveAmplitude: 0.076 }, 1.2,
      { f_min: Math.min(...Object.values(SUN_F_MIN_BY_RAYS)), symmetry_group: 'D_VARIABLE',
        minimum_convex_angle_degrees: 8, allowed_parameter_sets: SUN_PARAMETER_SETS,
        f_min_by_parameter: { rays: SUN_F_MIN_BY_RAYS },
        symmetry_group_by_parameter: { rays: { '8': 'D8', '12': 'D12', '16': 'D16', '24': 'D24' } } }),
    M08: moduleEntry(['wheel', 'radial'], { spokes: 8, innerRatio: 0.66, hubRatio: 0.17, gear: false }, 1.2),
    M09: moduleEntry(['cross', 'heraldic'], { arms: 4, thickness: 0.22, profile: 'RECT', latinRatio: 1.2 }, 1.2,
      { f_min: 0.22, symmetry_group: 'D4', allowed_parameter_sets: CROSS_EMB_PARAMETER_SETS }),
    M10: moduleEntry(['chevron', 'arrow'], { mode: 'ARROW', angle: 50, thickness: 0.12 }, 0.7),
    M11: moduleEntry(['lens', 'organic'], { length: 0.8, width: 0.38 }),
    M12: moduleEntry(['lily', 'floral'], { sideAngle: 45, lowerPetalProbability: 0.4 }, 2),
    M13: moduleEntry(['tower', 'architectural'], { merlons: 4, sideTowers: false, windows: 0, archedDoor: false }, 3),
    M14: moduleEntry(['crown', 'regalia'], { points: 5, arch: false, dots: false }, 3,
      { f_min: 0.05, symmetry_group: 'D1', allowed_parameter_sets: CROWN_PARAMETER_SETS,
        f_min_by_parameter: { points: { '3': 0.1, '5': 0.05, '7': 0.05 } } }),
    M15: moduleEntry(['key', 'tool'], { teeth: 2 }, 2),
    M16: moduleEntry(['sword', 'tool'], { bladeRatio: 0.66 }, 2, { f_min: 0.12, symmetry_group: 'D1' }),
    M17: moduleEntry(['spear', 'tool'], { mode: 'SPEAR', head: 'TRIANGLE' }, 1.5),
    M18: moduleEntry(['anchor', 'nautical'], {}, 2, { f_min: 0.06, symmetry_group: 'D1' }),
    M19: moduleEntry(['tree', 'nature'], { style: 'CONIFER', tiers: 3, leaves: 7 }, 2),
    M20: moduleEntry(['mountain', 'landscape'], { peaks: 1, snow: false, sun: false }, 1.5),
    M21: moduleEntry(
      ['waves', 'water'],
      { bands: 3, amplitude: 0.05, wavelength: 1 / 3, phase: 0, clipShape: 'RECT' },
      1.5,
      { f_min: 0.09, symmetry_group: 'D1', allowed_parameter_sets: WAVE_PARAMETER_SETS },
    ),
    M22: moduleEntry(['ship', 'nautical'], { sailType: 'LATEEN', sails: 1, galley: false, oars: 6 }, 3),
    M23: moduleEntry(['winged', 'animal'], { body: 'DISC', feathers: 4, featherAngle: 35, tail: false, head: false }, 3),
    M24: moduleEntry(['glyph', 'geometric'], { strokeWidth: 0.06 }, 3,
      { f_min: 0.05, symmetry_group: 'C1', allowed_parameter_sets: GLYPH_PARAMETER_SETS }),
    M25: moduleEntry(['swirl', 'rotational'], { lobes: 3 }, 1.2),
    M26: moduleEntry(['foil', 'floral'], { style: 'TREFOIL', radius: 0.32 }, 1),
    M27: moduleEntry(['flame', 'organic'], {}, 1),
    M28: moduleEntry(['shield', 'container'], { shape: 'HEATER', inset: 0.58 }, 1,
      { f_min: 0.18, symmetry_group: 'D1' }),
    M29: moduleEntry(['bow', 'weapon'], { span: 120, strokeWidth: 0.055 }, 2),
    M30: moduleEntry(['bar-stack', 'composite'], { modules: ['M11', 'M01', 'M06', 'M04'] }, 3),
  },
  composers: {
    SINGLE: { costFactor: 0.8, defaults: {} },
    STACK: { costFactor: 0.8, count: [2, 4], gap: [0.05, 0.25], defaults: { axis: 'VERTICAL', count: 3, gap: 0.1 } },
    PAIR_MIRROR: {
      costFactor: 0.8,
      gaps: [0.2, 0.3, 0.5],
      gapWeights: { '0.2': 2, '0.3': 2, '0.5': 1 },
      defaults: { axis: 'VERTICAL', gap: 0.3 },
    },
    CROSSED: { costFactor: 0.8, angle: [25, 50], defaults: { angle: 35, order: 'FIRST_OVER_SECOND' } },
    RING: { costFactor: 0.8, count: [3, 16], defaults: { count: 6, orientation: 'OUT' } },
    ARC_REPEAT: { costFactor: 0.8, count: [6, 13], sweep: [120, 300], radius: 0.38, defaults: { sweep: 240 } },
    INSCRIBE: { costFactor: 0.8, scale: [0.45, 0.7], defaults: { frame: 'DISC', scale: 0.58 } },
    OVERLAY: { costFactor: 1, defaults: {} },
    CONSTELLATION: { costFactor: 1, defaults: {} },
    FLANK: { costFactor: 0.8, scale: [0.5, 0.8], defaults: { sideScale: 0.65, offset: 0.3 } },
    CHARGE_ON_CHARGE: {
      costFactor: 0.8,
      smallScales: [0.4, 0.5, 0.6],
      smallScaleWeights: { '0.4': 1, '0.5': 2, '0.6': 1 },
      defaults: { smallScale: 0.5, offset: { x: 0, y: 0 } },
    },
    CONCENTRIC: {
      costFactor: 0.8,
      rings: [1, 2],
      ringWeights: { '1': 0.6, '2': 0.4 },
      ringThickness: 0.07,
      ringGap: 0.06,
      defaults: { rings: 2 },
    },
  },
  defaults: {
    circleSamples: 96,
    arcSamples: 24,
    minimumDetail: 0.025,
  },
} as const;

export type FlagEmblemModuleId = keyof typeof FLAG_EMBLEM_CONFIG.modules;
export type FlagEmblemComposerId = keyof typeof FLAG_EMBLEM_CONFIG.composers;
