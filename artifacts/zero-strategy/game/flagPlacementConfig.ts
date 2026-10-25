/**
 * Configurable defaults for charge placement, repetition, and flag symmetry.
 * Coordinates in presets are normalized to their containing frame.
 */
const point = (u: number, v: number, size = 1) => ({ u, v, size });

export const FLAG_PLACEMENT_CONFIG = {
  anchors: {
    sizeRange: [0.12, 0.8],
    hoistCenterX: [0.25, 0.4],
    safeMargin: 40,
    minimumGap: 20,
    preferredSnapStep: 50,
    fineSnapStep: 20,
    preferredSnapProbability: 0.75,
    a10Attempts: 64,
  },
  repeaters: {
    grid: {
      rows: [1, 9],
      cols: [1, 13],
      staggerModes: ['NONE', 'HALF_OFFSET', 'ALTERNATING_6_5'],
      defaultStepX: 0.12,
      defaultStepY: 0.12,
      sixFiveRows: { even: 6, odd: 5 },
    },
    ring: { count: [3, 16], radius: [0.2, 0.5], defaultRadius: 0.32 },
    arc: { count: [3, 16], sweep: [120, 300], radius: [0.2, 0.5], defaultCount: 7, defaultSweep: 240, defaultRadius: 0.38, defaultStartAngle: -90 },
    line: { count: [2, 16], axes: ['HORIZONTAL', 'VERTICAL'], defaultCount: 3, defaultAxis: 'HORIZONTAL', defaultSpan: 0.6 },
    constellations: {
      STAR_TRIANGLE: {
        positions: [point(0.5, 0.22), point(0.29, 0.68), point(0.71, 0.68)],
      },
      SOUTHERN_CROSS: {
        positions: [point(0.48, 0.2), point(0.64, 0.48, 0.82), point(0.48, 0.76), point(0.3, 0.49, 0.78)],
      },
      FIVE_STAR: {
        positions: [point(0.5, 0.19), point(0.79, 0.4), point(0.68, 0.75), point(0.32, 0.75), point(0.21, 0.4)],
      },
      SEVEN_STAR_DIPPER: {
        positions: [
          point(0.22, 0.33), point(0.38, 0.25), point(0.54, 0.29), point(0.61, 0.45),
          point(0.75, 0.57), point(0.84, 0.69), point(0.93, 0.81),
        ],
      },
      CIRCLE_12: {
        positions: Array.from({ length: 12 }, (_, i) => {
          const angle = -Math.PI / 2 + (2 * Math.PI * i) / 12;
          return point(0.5 + 0.34 * Math.cos(angle), 0.5 + 0.34 * Math.sin(angle), 0.72);
        }),
      },
      THREE_BELT: {
        positions: [point(0.25, 0.5), point(0.5, 0.5), point(0.75, 0.5)],
      },
      FIVE_CROSS: {
        positions: [point(0.5, 0.5), point(0.5, 0.22), point(0.78, 0.5), point(0.5, 0.78), point(0.22, 0.5)],
      },
      HEXAGONAL_7: {
        positions: [
          point(0.5, 0.5), point(0.5, 0.2), point(0.76, 0.35), point(0.76, 0.65),
          point(0.5, 0.8), point(0.24, 0.65), point(0.24, 0.35),
        ],
      },
    },
  },
  symmetry: {
    classes: ['NONE', 'MIR_H', 'MIR_V', 'BOTH', 'ROT180'],
    defaultWeights: { NONE: 1, MIR_H: 0, MIR_V: 0, BOTH: 0, ROT180: 0 },
    operatorSupport: {
      fill: ['NONE', 'MIR_H', 'MIR_V', 'BOTH', 'ROT180'],
      split: ['NONE', 'MIR_H', 'MIR_V', 'BOTH', 'ROT180'],
      layer: ['NONE', 'MIR_H', 'MIR_V', 'BOTH', 'ROT180'],
      group: ['NONE', 'MIR_H', 'MIR_V', 'BOTH', 'ROT180'],
      repeat: ['NONE', 'MIR_H', 'MIR_V', 'BOTH', 'ROT180'],
      mirror: ['NONE', 'MIR_H', 'MIR_V', 'BOTH', 'ROT180'],
      counterchange: ['NONE', 'MIR_H', 'MIR_V', 'BOTH', 'ROT180'],
    },
    mirrorAxes: {
      MIR_H: ['x'],
      MIR_V: ['y'],
      BOTH: ['x', 'y'],
      ROT180: ['x', 'y'],
    },
  },
} as const;

export type FlagConstellationId = keyof typeof FLAG_PLACEMENT_CONFIG.repeaters.constellations;
export type FlagSymmetryClass = (typeof FLAG_PLACEMENT_CONFIG.symmetry.classes)[number];
