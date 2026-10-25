export type OutlineType = 'RECT' | 'SWALLOW' | 'PENNANT' | 'DOUBLE_PENNANT' | 'BANNER';
export type EdgeShape = 'TRIANGLE' | 'ROUND';
export type BannerLowerEdge = 'STRAIGHT' | 'POINT' | 'SWALLOW' | 'TEETH' | 'SCALLOP' | 'TABS';
export type NumericRange = readonly [number, number];

export interface FlagOutlineConfig {
  height: number;
  safeMargin: number;
  minimumDetailThickness: number;
  curveTolerance: number;
  types: {
    RECT: { weight: number | null; aspects: readonly number[] };
    SWALLOW: {
      weight: number | null;
      aspect: NumericRange;
      depth: NumericRange;
      notchCount: NumericRange;
      notchShapes: readonly ('V' | 'U')[];
      uRadiusMinimum: number;
      defaults: { depthRatio: number; notchCount: number; notchShape: 'V' | 'U' };
      singleNotchCenter: number;
      singleNotchSpan: number;
      doubleNotchCenters: readonly [number, number];
      doubleNotchSpan: number;
    };
    PENNANT: {
      weight: number | null;
      aspect: NumericRange;
      thickness: NumericRange;
      defaultThickness: number;
    };
    DOUBLE_PENNANT: {
      weight: number | null;
      aspect: NumericRange;
      waistY: NumericRange;
      outerPointX: NumericRange;
      innerPointX: NumericRange;
      defaults: { waistY: number; outerPointX: number; innerPointX: number };
    };
    BANNER: {
      weight: number | null;
      aspects: readonly number[];
      lowerEdges: readonly BannerLowerEdge[];
      pointDepth: NumericRange;
      swallowDepth: NumericRange;
      teethCount: NumericRange;
      teethDepthFactor: NumericRange;
      scallopCount: NumericRange;
      tabCount: NumericRange;
      tabWidthStepRatio: number;
      tabHeight: NumericRange;
      tabShapes: readonly ('RECTANGLE' | 'TRIANGLE')[];
      defaults: {
        lowerEdge: BannerLowerEdge;
        pointDepthRatio: number;
        swallowDepthRatio: number;
        teethCount: number;
        teethDepthFactor: number;
        scallopCount: number;
        tabCount: number;
        tabHeight: number;
        tabShape: 'RECTANGLE' | 'TRIANGLE';
      };
    };
  };
  edge: {
    count: NumericRange;
    depth: NumericRange;
    shapes: readonly EdgeShape[];
  };
}

/**
 * Data-only starter settings from section 6 of SVGFlagGenTT.
 * Outline weights are intentionally profile-owned: null means a profile must
 * provide a numeric weight rather than silently receiving an invented one.
 */
export const FLAG_OUTLINE_CONFIG = {
  height: 1200,
  safeMargin: 40,
  minimumDetailThickness: 30,
  curveTolerance: 1200 / 2000,
  types: {
    RECT: {
      weight: null,
      aspects: [1, 1.25, 1.333, 1.375, 1.4, 1.5, 1.6, 1.667, 1.9, 2, 2.545],
    },
    SWALLOW: {
      weight: null,
      aspect: [1.4, 2.4],
      depth: [0.1, 0.33],
      notchCount: [1, 2],
      notchShapes: ['V', 'U'],
      uRadiusMinimum: 1200 / 6,
      defaults: { depthRatio: 0.1, notchCount: 1, notchShape: 'V' },
      singleNotchCenter: 0.5,
      singleNotchSpan: 1,
      doubleNotchCenters: [1 / 3, 2 / 3],
      doubleNotchSpan: 1 / 3,
    },
    PENNANT: {
      weight: null,
      aspect: [1.5, 5],
      thickness: [0, 0.1 * 1200],
      defaultThickness: 0,
    },
    DOUBLE_PENNANT: {
      weight: null,
      aspect: [0.7, 1.3],
      waistY: [0.42, 0.58],
      outerPointX: [0.55, 0.9],
      innerPointX: [0.25, 0.5],
      defaults: { waistY: 0.5, outerPointX: 0.55, innerPointX: 0.5 },
    },
    BANNER: {
      weight: null,
      aspects: [0.2, 0.25, 0.333, 0.4, 0.5, 0.6, 0.667, 0.75],
      lowerEdges: ['STRAIGHT', 'POINT', 'SWALLOW', 'TEETH', 'SCALLOP', 'TABS'],
      pointDepth: [0.15, 0.5],
      swallowDepth: [0.15, 0.5],
      teethCount: [2, 6],
      teethDepthFactor: [0.1, 0.35],
      scallopCount: [2, 6],
      tabCount: [3, 7],
      tabWidthStepRatio: 0.6,
      tabHeight: [0.05 * 1200, 0.12 * 1200],
      tabShapes: ['RECTANGLE', 'TRIANGLE'],
      defaults: {
        lowerEdge: 'STRAIGHT',
        pointDepthRatio: 0.15,
        swallowDepthRatio: 0.15,
        teethCount: 2,
        teethDepthFactor: 0.1,
        scallopCount: 2,
        tabCount: 3,
        tabHeight: 0.05 * 1200,
        tabShape: 'RECTANGLE',
      },
    },
  },
  edge: {
    count: [7, 21],
    depth: [0.015 * 1200, 0.04 * 1200],
    shapes: ['TRIANGLE', 'ROUND'],
  },
} as const satisfies FlagOutlineConfig;
