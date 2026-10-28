/**
 * Настраиваемые значения размещения зарядов, повторителей и симметрии флага.
 * Координаты эталонных схем нормированы относительно рамки.
 */
const point = (u: number, v: number, size = 1) => ({ u, v, size });

export const FLAG_PLACEMENT_CONFIG = {
  anchors: {
    sizeRange: [0.12, 0.8],
    hoistCenterX: [0.25, 0.4],
    hoistCenterXValues: [0.25, 0.3, 0.35, 0.4],
    bannerA2YValues: [0.25, 0.3, 0.35, 0.4],
    p22HoistCenterX: 0.45,
    freePartCenterXValues: [0.62, 0.68, 0.75],
    virtualCantonWidths: [0.3, 0.35, 0.4],
    virtualCantonHeights: [0.3, 0.4, 0.5],
    cornerWeights: { TOP_HOIST: 4, BOTTOM_HOIST: 2, TOP_FLY: 2, BOTTOM_FLY: 2 },
    a11GroupY: [1 / 3, 2 / 3],
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
      sixFiveRows: { first: 6, second: 5 },
    },
    ring: { count: [3, 16], maximumSize: 0.35, defaultCount: 6 },
    arc: {
      count: [6, 13],
      sweep: [120, 300],
      radius: [0.2, 0.5],
      centerDirections: [-90, 90, 0, 180],
      defaultCount: 7,
      defaultSweep: 240,
      defaultRadius: 0.38,
      defaultCenterDirection: -90,
    },
    line: {
      count: [2, 16],
      axes: ['HORIZONTAL', 'VERTICAL'],
      gapRatios: [0.25, 0.5],
      defaultCount: 3,
      defaultAxis: 'HORIZONTAL',
      defaultGapRatio: 0.25,
    },
    constellations: {
      STAR_TRIANGLE: {
        positions: [point(0.5, 0.15), point(0.197, 0.675), point(0.803, 0.675)],
      },
      SOUTHERN_CROSS: {
        positions: [point(0.5, 0.08, 1), point(0.5, 0.92, 1), point(0.22, 0.42, 0.85), point(0.8, 0.58, 0.85)],
      },
      FIVE_STAR: {
        positions: [point(0.5, 0.1), point(0.88, 0.376), point(0.735, 0.824), point(0.265, 0.824), point(0.12, 0.376)],
      },
      SEVEN_STAR_DIPPER: {
        positions: [
          point(0, 0.34, 0.9), point(0.16, 0.42, 0.9), point(0.32, 0.48), point(0.48, 0.5),
          point(0.5, 0.76), point(0.88, 0.78), point(0.88, 0.44),
        ],
      },
      CIRCLE_12: {
        positions: Array.from({ length: 12 }, (_, i) => {
          const angle = -Math.PI / 2 + (2 * Math.PI * i) / 12;
          return point(0.5 + 0.4 * Math.cos(angle), 0.5 + 0.4 * Math.sin(angle));
        }),
      },
      THREE_BELT: {
        positions: [point(0.14, 0.56), point(0.5, 0.5), point(0.86, 0.44)],
      },
      FIVE_CROSS: {
        positions: [point(0.5, 0.5, 1.2), point(0.5, 0.16), point(0.16, 0.5), point(0.84, 0.5), point(0.5, 0.84)],
      },
      HEXAGONAL_7: {
        positions: [
          point(0.5, 0.5), ...Array.from({ length: 6 }, (_, i) => {
            const angle = -Math.PI / 2 + 2 * Math.PI * i / 6;
            return point(0.5 + 0.3 * Math.cos(angle), 0.5 + 0.3 * Math.sin(angle));
          }),
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
