/** Начальные данные профилей флагов из §13 и уточнений приёмки. */
export type FlagProfileWeights = Record<string, number | null>;
export type FlagProfileRange = readonly [number, number];
export interface FlagBalanceRegion {
  x: FlagProfileRange;
  y: FlagProfileRange;
}

export interface FlagProfileGenerationConfig {
  ordinaryCountWeights: FlagProfileWeights;
  chargeGroupCountWeights: FlagProfileWeights;
  fimbrationProbability: number;
  nonStraightLineProbability: number;
  edgeProbability: number;
  patternProbability: number;
}

export interface FlagProfileConfig {
  id: string;
  eras: number[];
  tags_allowed: string[] | null;
  OUT: FlagProfileWeights | null;
  ASP: FlagProfileWeights | null;
  PAL: {
    weights: FlagProfileWeights | null;
    free: number | null;
    free_allowed: boolean | null;
    free_colors: FlagProfileWeights | null;
    p_arch: number | null;
  } | null;
  K: FlagProfileWeights | null;
  GND: FlagProfileWeights | null;
  LINE: {
    non_straight_probability: number | null;
    styles: string[] | null;
    style_weights: FlagProfileWeights | null;
  } | null;
  ORD: FlagProfileWeights | null;
  CHG: {
    modules: FlagProfileWeights | null;
    composers: FlagProfileWeights | null;
    repeaters: FlagProfileWeights | null;
    anchors: FlagProfileWeights | null;
    counterchange_weight: number | null;
    groups: FlagProfileRange | null;
    probability_any: number | null;
  } | null;
  SYM: FlagProfileWeights | null;
  TINC: number | null;
  CMAX: number | null;
  BAL: FlagBalanceRegion | null;
  EDGE: FlagProfileWeights | null;
  HYB: string[];
  GEN: FlagProfileGenerationConfig | null;
  SPECIAL: Record<string, unknown> | null;
}

type ProfileFields = Partial<Omit<FlagProfileConfig, 'id' | 'eras' | 'HYB'>>;

function profile(id: string, eras: number[], fields: ProfileFields = {}, HYB: string[] = []): FlagProfileConfig {
  return {
    id,
    eras,
    tags_allowed: null,
    OUT: null,
    ASP: null,
    PAL: null,
    K: null,
    GND: null,
    LINE: null,
    ORD: null,
    CHG: {
      modules: null,
      composers: null,
      repeaters: null,
      anchors: null,
      counterchange_weight: null,
      groups: [0, 3],
      probability_any: null,
    },
    SYM: null,
    TINC: null,
    CMAX: null,
    BAL: null,
    EDGE: null,
    HYB,
    GEN: null,
    SPECIAL: null,
    ...fields,
  };
}

const palette = (
  weights: FlagProfileWeights | null,
  free: number | null = null,
  p_arch: number | null = null,
  free_allowed: boolean | null = free !== null ? true : null,
  free_colors: FlagProfileWeights | null = null,
) => ({
  weights,
  free,
  free_allowed,
  free_colors,
  p_arch,
});
const charges = (
  modules: FlagProfileWeights | null,
  composers: FlagProfileWeights | null = null,
  repeaters: FlagProfileWeights | null = null,
  anchors: FlagProfileWeights | null = null,
  groups: FlagProfileRange | null = [0, 3],
  probability_any: number | null = null,
  counterchange_weight: number | null = null,
) => ({ modules, composers, repeaters, anchors, counterchange_weight, groups, probability_any });

/** Неполные исходные данные профилей из §13.2 до применения ответов приёмки. */
const FLAG_PROFILE_STARTER_CONFIG: FlagProfileConfig[] = [
  profile('P01', [0, 1], {
    OUT: { 'BANNER:TABS': 4, 'RECT:1.0': 1 }, PAL: palette({ ANTIQUE_PURPLE: 5 }),
    GND: { SOLID: 4, 'BANDS:V:2-3': 1 }, ORD: { BORDURE: 3, BAND: 1 },
    CHG: charges({ WINGED: 3, DISC: 2, SPEAR: 2, STAR: 1 }, null, { ARC_REPEAT_WREATH: 3 }),
    SYM: { MIR_H: 5 }, CMAX: 9,
  }),
  profile('P02', [0, 1], {
    OUT: { BANNER: 3, RECT: 2 }, PAL: palette({ 'purple/gold/red': null }),
    GND: { 'CONCENTRIC:SQUARE': 3, CHECKY: 2, LOZENGY: 2, SOLID: 2 },
    ORD: { 'BORDURE:CHECKY|DANCETTY': 4 }, CHG: charges({ STAR: 3, DISC: 3, SUN: 2 }),
    EDGE: { TEETH: 2 }, SYM: { BOTH: 3 }, CMAX: 10,
  }),
  profile('P03', [1, 2], {
    OUT: { SWALLOW: 4, PENNANT: 2, RECT: 2 }, PAL: palette({ 'red/white/black/azure/gold': null }, null, null, true),
    GND: { SOLID: 4, SPLIT2: 1, BANDS: 1 }, ORD: { CHEVRON: 1, BORDURE: 1 },
    CHG: charges({ WINGED: 4, 'SWIRL:n=3': 3, GLYPH: 3, 'CROSSED:SWORD': 1, DISC: 1 }),
    SYM: { NONE: 3, MIR_V: 2 }, EDGE: { TEETH: 2 }, CMAX: 8,
  }),
  profile('P04', [1, 2], {
    OUT: { 'RECT:1.0': 3, 'RECT:1.25': 2, BANNER: 2 }, PAL: palette({ ANTIQUE_PURPLE: null }),
    GND: { SOLID: 3, QUARTERLY: 2, BANDS: 1 }, ORD: { 'CROSS:PLAIN|FLARED:CENTER': 5, SALTIRE: 1, BORDURE: 2 },
    CHG: charges(
      { 'SMALL:STAR|DISC|CROSS_EMB': 3, CROWN: 2, DISC: 2, SWORD: 1 },
      null,
      null,
      { A5: 3 },
    ),
    SYM: { BOTH: 4 }, tags_allowed: ['christian', 'royal'], CMAX: 10,
  }),
  profile('P05', [2, 3], {
    OUT: { 'RECT:1.0|1.25|1.333': 5, SWALLOW: 1 }, PAL: palette({ HERALDIC: null }), TINC: 0.95,
    GND: { SOLID: 2, SPLIT2: 4, QUARTERLY: 3, SALTIRE_DIV: 1, 'GYRONNY:8': 1, CHECKY: 1, LOZENGY: 1, CHEVRONNY: 1, 'BANDS:6-10': 2 },
    LINE: {
      non_straight_probability: 0.25,
      styles: ['EMBATTLED', 'WAVY', 'DANCETTY', 'ENGRAILED', 'INVECTED'],
      style_weights: null,
    },
    ORD: { CROSS: 3, SALTIRE: 2, CHEVRON: 2, BAND: 4, PALL: 1, PILE: 1, BORDURE: 3, CANTON: 2 },
    CHG: charges({ LILY: 3, STAR: 2, TOWER: 2, KEY: 2, CROWN: 2, SWORD: 2, FOIL: 3, DISC: 3, TREE: 1 },
      { SINGLE: 4, STACK: 1, CROSSED: 2, RING: 1, PAIR_MIRROR: 2 }, { 'GRID_QUINCUNX:n6-12': 2 }, null, [0, 3], null, 2),
    SYM: { MIR_H: 3, NONE: 3 }, CMAX: 14,
  }),
  profile('P06', [2, 3], {
    OUT: { 'RECT:1.333|1.5': 4, SWALLOW: 1 }, PAL: palette({ 'red/white/vert/azure/gold': null }), TINC: 0.6,
    GND: { 'SPLIT2:PALE|FESS': 4, SOLID: 2, QUARTERLY: 1 }, ORD: { 'CROSS:1:1:CENTER': 4, BORDURE: 1 },
    CHG: charges({ KEY: 3, TOWER: 3, STAR: 2, FOIL: 1 }), SYM: { MIR_H: 2, NONE: 3 }, CMAX: 9,
  }),
  profile('P07', [2, 3], {
    OUT: { 'RECT:1.25|1.5': 4, SWALLOW: 1 }, PAL: palette({ GERMANIC: null }), TINC: 0.7,
    GND: { 'BANDS:H:2-3': 4, SPLIT2: 2 }, ORD: { 'BAND:CHIEF': 2, BORDURE: 1 },
    CHG: charges({ WINGED: 4, STAR: 1, CROWN: 2 }), SYM: { MIR_H: 3, NONE: 3 }, CMAX: 10,
  }),
  profile('P08', [1, 2, 3], {
    OUT: { RECT: 3, SWALLOW: 2, PENNANT: 2 }, PAL: palette({ ISLAMIC_GREEN: null }),
    GND: { SOLID: 5, 'BANDS:H:2-3': 2, SPLIT2: 1 }, ORD: { BAND: 1, 'BORDURE:THIN': 1 },
    CHG: charges({ 'STAR:n6-12:SHARP_N_OVER_2': 3, CRESCENT: 3, DISC: 1, 'INSCRIBE:RING+STAR': 1 }),
    tags_allowed: ['islamic'], CMAX: 6,
  }),
  profile('P09', [1, 2, 3], {
    OUT: { 'SWALLOW:NOTCHES_2': 3, RECT: 2, 'BANNER:TEETH': 2 }, PAL: palette({ TURKIC: 4 }, 1),
    GND: { SOLID: 4, BANDS: 2 }, ORD: { BORDURE: 1, BAND: 1 },
    CHG: charges({ GLYPH: 5, SUN: 2, DISC: 2, CRESCENT: 1, 'WHEEL:SHANYRAK': 1 }),
    SYM: { NONE: 3, MIR_H: 2 }, CMAX: 7,
  }, ['P08']),
  profile('P10', [2, 3, 4], {
    OUT: { PENNANT: 3, SWALLOW: 2, RECT: 2, BANNER: 2 }, EDGE: { TEETH: 4 }, PAL: palette({ IMPERIAL_EAST: null }),
    GND: { SOLID: 4, BANDS: 1, 'SPLIT2:DIAGONAL': 1 }, ORD: { 'BORDURE:INNER_DANCETTY': 4 },
    CHG: charges({ SUN: 3, DISC: 2, 'SWIRL:n=2': 2, WAVES: 2, MOUNTAIN: 2, GLYPH: 1, STAR: 1 }),
    SYM: { MIR_H: 3 }, CMAX: 9,
  }),
  profile('P11', [2, 3, 4, 5, 6], {
    OUT: { BANNER: 3, 'RECT:1.5': 2 }, PAL: palette({ 'white/black/red/navy/gold': null }),
    GND: { SOLID: 5, 'BANDS:H:2-3': 1, 'GYRONNY:n16:OFF_FRAME:2_COLORS': 3 },
    CHG: charges({ 'INSCRIBE:DISC|RING:SWIRL|ARC_REPEAT|WHEEL|FOIL': 4, DISC: 3 }),
    SYM: { 'ROT|MIR': 4 }, CMAX: 7,
  }),
  profile('P12', [2, 3, 4], {
    OUT: { PENNANT: 3, SWALLOW: 3, RECT: 1 }, PAL: palette({ SAFFRON: null }),
    GND: { SOLID: 3, 'BANDS:H:2-3': 2, 'SPLIT2:DIAGONAL': 1 },
    CHG: charges({ SUN: 3, DISC: 2, WHEEL: 3, CRESCENT: 1, STAR: 2 }),
    tags_allowed: ['dharmic'], CMAX: 8,
  }),
  profile('P13', [4, 5], {
    OUT: { 'RECT:1.5|2.0': 5 }, PAL: palette({ 'MARITIME(+NAVY)': null }), GND: { SOLID: 5 },
    ORD: { 'CANTON:UNION_MOTIF_REQUIRED': null },
    CHG: charges({ 'HOIST_BADGE:INSCRIBE_DISC|SHIELD': 3, CONSTELLATION: 4, STAR: 2 }, null, null, null, [0, 3]),
    SYM: { NONE: null }, CMAX: 13,
  }),
  profile('P14', [4, 5], {
    OUT: { 'RECT:1.4|1.5|1.667|2.0': 5 },
    PAL: palette({ TRICOLOR_FR: null, PAN_SLAVIC: null, ITALIAN: null, GERMANIC: null, DUTCH_TYPE: null }),
    GND: { 'BANDS:V': 3, 'BANDS:H': 4, 'SPLIT2:PALE': 2 },
    CHG: charges({ 'SMALL:DISC|STAR|SHIELD': 1 }, null, null, null, [0, 3], 0.1),
    SYM: { 'MIR_V|MIR_H': null }, CMAX: 6,
  }),
  profile('P15', [4, 5], {
    OUT: { 'RECT:1.4|1.5|1.667': 5 },
    PAL: palette({ GRAN_COLOMBIA: null, 'sky+white': null, 'red+white+vert': null }),
    GND: { 'BANDS:H:3|5:WG_SYM': 5, DIAG_BANDS: 1, 'SPLIT2:DIAGONAL': 1 },
    ORD: { 'BAND:DIAGONAL': 1, 'PILE:HOIST': 1, CANTON: 1 },
    CHG: charges({ 'SUN:WAVY_ALT': 3, STAR: 3, DISC: 2, MOUNTAIN: 1, 'TREE:PALM': 1, 'INSCRIBE:SHIELD': 3 },
      null, { ARC_REPEAT_WREATH: 2 }, null, [0, 3]), CMAX: 9,
  }),
  profile('P16', [4, 5, 6], {
    OUT: { 'RECT:1.5|1.667': 5 }, PAL: palette({ 'ISLAMIC_GREEN+RED': null }),
    GND: { SOLID: 4, BANDS: 3, 'SPLIT2:FESS': 1 }, ORD: { 'PILE:HOIST': 1 },
    CHG: charges({ 'CRESCENT:1-5_STARS_IN_HORNS': 5, 'STAR:n5-9': 2 }), tags_allowed: ['islamic'], CMAX: 6,
  }),
  profile('P17', [4, 5, 6], {
    OUT: { 'RECT:1.5|2.0': 5 }, PAL: palette({ PAN_ARAB: 5 }), GND: { 'BANDS:H:3_EQUAL': 5 },
    ORD: { 'PILE:HOIST:TRUNCATED_OPTIONAL': 4, BAND: 1 }, CHG: charges({ STAR: 2 }),
    SYM: { 'NONE|MIR_V': null }, CMAX: 6,
  }),
  profile('P18', [4, 5, 6], {
    PAL: palette({ 'red/white/azure|navy/gold': null }), GND: { 'BANDS:H:7-13:CYC_2': 5 },
    ORD: { 'CANTON:GRID_STARS:STAGGER_ALTERNATING:ROWS_5-9': 5 }, CMAX: 9,
  }),
  profile('P19', [5, 6], {
    OUT: { 'RECT:1.4|1.375|1.636|1.389|1.321': 5 }, PAL: palette({ NORDIC: null }),
    GND: { SOLID: 5 }, ORD: { 'CROSS:SCANDINAVIAN:REQUIRED': 5, 'CROSS:FIMBRIATION': 4, 'CROSS:DOUBLE': 1 },
    CHG: charges({}, null, null, null, [0, 3], 0.05), SYM: { NONE: 1 }, CMAX: 6,
  }),
  profile('P20', [5, 6], {
    OUT: { 'RECT:1.5|1.667': 5 }, PAL: palette({ PAN_AFRICAN: 5, PAN_AFRICAN_B: 3 }),
    GND: { 'BANDS:3:H|V': 4 }, ORD: { PILE: 1, 'BAND:DIAGONAL': 1 },
    CHG: charges({ STAR: 4, 'INSCRIBE:DISC+STAR': 3, SUN: 1 }), SYM: { MIR_V: 3 }, CMAX: 8,
  }),
  profile('P21', [5, 6], {
    PAL: palette({ SOCIALIST: 1 }), GND: { 'SOLID:RED': 4, BANDS: 2, DIAG_BANDS: 1, SPLIT2: 1 },
    ORD: { BAND: 1 }, CHG: charges({ 'STAR:ANCHORS_A4|A2|A1': 5, GEAR: 1, SUN: 1 }),
    tags_allowed: ['socialist'], CMAX: 7,
  }),
  profile('P22', [5, 6], {
    PAL: palette({ 'white/red/vert/azure/gold': null }), GND: { SOLID: 5, 'BANDS:H:2': 1 },
    CHG: charges({ 'DISC:CENTER|HOIST_9_20': 5, SUN: 2, 'RING+DISC': 1 }), CMAX: 6,
  }),
  profile('P23', [5, 6], {
    PAL: palette({ 'red/white/azure/gold': null }),
    GND: { 'BANDS:H:5_WG5|3_WGSYM|7-14_EQUAL': 4 }, ORD: { CANTON: 1 },
    CHG: charges({ STAR: 3, 'CRESCENT+STAR': 2, WHEEL: 1, SUN: 1, DISC: 1 }), CMAX: 8,
  }),
  profile('P24', [5, 6], {
    OUT: { 'RECT:1.667|2.0': 5 }, PAL: palette({ TURKIC: null }),
    GND: { 'BANDS:H:3-5:SEP': 4, 'SOLID:SKY': 2 },
    CHG: charges({ SUN: 2, 'CRESCENT+CONSTELLATION:UP_TO_12': 3, 'WHEEL:SHANYRAK': 3, GLYPH: 1 }), CMAX: 8,
  }),
  profile('P25', [5, 6], {
    PAL: palette({ 'azure/white/gold/red': null }), GND: { SOLID: 3, BANDS: 2, 'SPLIT2:DIAGONAL': 1 },
    CHG: charges({ DISC: 3, STAR: 3, WAVES: 2, CRESCENT: 1, 'TREE:PALM': 1 }), CMAX: 7,
  }),
  profile('P26', [5, 6], {
    PAL: palette({ 'gold/black/vert/azure/red/white': null }), GND: { SALTIRE_DIV: 3, 'SPLIT2:BEND': 2, DIAG_BANDS: 1 },
    ORD: { SALTIRE: 3, 'BAND:DIAGONAL': 3, 'BAND:FIMBRIATION': 2, PILE: 2 },
    CHG: charges({ STAR: 1, DISC: 1 }), CMAX: 8,
  }),
  profile('P27', [4, 5, 6], {
    OUT: { 'RECT:1.0': 5, 'RECT:1.25': 1 }, PAL: palette({ 'red/white/gold/azure': null }),
    GND: { SOLID: 5, 'SPLIT2:PALE': 1 },
    ORD: { 'CROSS:COUPED:0.55_SIDE:T_1_5_SIDE': 5 }, CHG: charges({ 'CROSS_EMB:RECT': 3 }), CMAX: 4,
  }),
  profile('P28', [6], {
    OUT: { 'RECT:1.5|1.6|1.667|1.9|2.0': 5 }, GND: { BANDS: 2, SPLIT2: 4, SOLID: 2 },
    ORD: { CHEVRON: 3, PILE: 3, 'BAND:DIAGONAL': 3, CROSS: 1 },
    CHG: charges({ 'ONE_MODULE:STAR|CRESCENT|SUN|WHEEL|GLYPH|POLYGON|RHOMBUS': 4 }),
    SYM: { NONE: 4 }, K: { '2': 3, '3': 5, '4': 2 }, CMAX: 7,
  }),
  profile('P29', [3, 4, 5, 6], {
    OUT: { 'RECT:1.2-1.5': 5, SWALLOW: 2, PENNANT: 2 }, PAL: palette({ MARITIME: null }),
    K: { '2': 5, '3': 5, '4': 0, '5': 0 }, GND: { QUARTERLY: 3, SPLIT2: 4, BANDS: 3, SALTIRE_DIV: 2, CHECKY: 1 },
    ORD: { CROSS: 3, SALTIRE: 2, BORDURE: 2 }, CHG: charges({ 'SMALL:DISC': 3 }),
    tags_allowed: ['maritime'], CMAX: 5,
  }),
  profile('P30', [0, 1, 2, 3, 4, 5, 6], {
    OUT: { RECT: 4, BANNER: 1 }, PAL: palette({ MESO: null }),
    GND: { 'CONCENTRIC:RHOMBUS|SQUARE': 4, SOLID: 2, BANDS: 2 },
    LINE: { non_straight_probability: null, styles: ['EMBATTLED'], style_weights: { EMBATTLED: 5 } },
    ORD: { 'BORDURE:EMBATTLED': 4, 'BAND:DANCETTY': 2 },
    CHG: charges({ RHOMBUS: 3, STAR: 2, SUN: 2, DISC: 2 }),
    SYM: { BOTH: 3, MIR_H: 2 }, CMAX: 10,
  }),
  profile('P31', [3, 4, 5], {
    OUT: { 'RECT:1.5|1.667': 5 }, PAL: palette({ 'red/white/azure/gold': null }),
    GND: { 'SPLIT2:FESS': 4, 'BANDS:H': 3 },
    CHG: charges({ 'SMALL_HOIST:KEY|TOWER|SHIELD|STAR': 3 }), CMAX: 7,
  }),
  profile('P32', [2, 3, 4, 5], {
    OUT: { 'RECT:1.5|1.667|2.0': 4, SWALLOW: 1 }, PAL: palette({ PAN_SLAVIC: null, 'red+white+azure': null }),
    GND: { 'BANDS:H:3': 3, SPLIT2: 2, SOLID: 2 },
    ORD: { 'CROSS:CENTER:NON_SCANDINAVIAN': 2, BORDURE: 1 },
    CHG: charges({ WINGED: 2, STAR: 1, CROWN: 2 }), CMAX: 9,
  }),
];

const balanceRegion = (x: FlagProfileRange, y: FlagProfileRange): FlagBalanceRegion => ({ x, y });
const BAL_STD = balanceRegion([0.30, 0.62], [0.35, 0.65]);
const BAL_HOIST = balanceRegion([0.22, 0.62], [0.25, 0.65]);
const BAL_BANNER = balanceRegion([0.30, 0.70], [0.20, 0.60]);
const BAL_WIDE = balanceRegion([0.25, 0.70], [0.30, 0.70]);

const profilePalette = (weights: FlagProfileWeights, p_arch: number, freeColorIds: string[] = []) => {
  const free_colors = Object.fromEntries(freeColorIds.map((id) => [id, 1]));
  return {
  weights,
  free: Object.keys(free_colors).length ? 1 - p_arch : 0,
  free_allowed: Object.keys(free_colors).length > 0,
  free_colors,
  p_arch,
  };
};

const profileGeneration = (
  ordinary: readonly [number, number, number, number],
  charges: readonly [number, number, number, number],
  fimbration: number,
  line: number,
  edge: number,
  pattern: number,
): FlagProfileGenerationConfig => ({
  ordinaryCountWeights: { '0': ordinary[0], '1': ordinary[1], '2': ordinary[2], '3': ordinary[3] },
  chargeGroupCountWeights: { '0': charges[0], '1': charges[1], '2': charges[2], '3': charges[3] },
  fimbrationProbability: fimbration,
  nonStraightLineProbability: line,
  edgeProbability: edge,
  patternProbability: pattern,
});

type ResolvedProfileData = Pick<FlagProfileConfig, 'ASP' | 'PAL' | 'K' | 'BAL' | 'tags_allowed' | 'GEN'> & {
  SPECIAL?: FlagProfileConfig['SPECIAL'];
};

/** Полные ответы для ASP, PAL, K, BAL, тегов и частот из файла приёмки. */
const RESOLVED_PROFILE_DATA: Record<string, ResolvedProfileData> = {
  P01: { ASP: { 'RECT:1.0': 5, 'BANNER:0.5': 1, 'BANNER:0.6': 2, 'BANNER:0.667': 3, 'BANNER:0.75': 3 }, PAL: profilePalette({ ANTIQUE_PURPLE: 5 }, 0.90, ['purple', 'tyrian', 'crimson', 'gold', 'white', 'black']), K: { '2': 1, '3': 4, '4': 3, '5': 0 }, BAL: BAL_BANNER, tags_allowed: ['roman', 'royal'], GEN: profileGeneration([30, 50, 20, 0], [10, 60, 30, 0], 0.05, 0.10, 0, 0) },
  P02: { ASP: { 'RECT:1.0': 2, 'RECT:1.25': 2, 'RECT:1.5': 2, 'BANNER:0.5': 2, 'BANNER:0.6': 2, 'BANNER:0.667': 2, 'BANNER:0.75': 1 }, PAL: profilePalette({ ANTIQUE_PURPLE: 3, IMPERIAL_EAST: 2, HERALDIC: 1 }, 0.80, ['purple', 'gold', 'red', 'azure', 'white', 'black', 'vert']), K: { '2': 1, '3': 3, '4': 4, '5': 1 }, BAL: BAL_WIDE, tags_allowed: ['royal', 'neutral'], GEN: profileGeneration([20, 60, 20, 0], [10, 50, 35, 5], 0.05, 0.30, 0.25, 0.10) },
  P03: { ASP: { 'RECT:1.25': 1, 'RECT:1.4': 2, 'RECT:1.5': 3 }, PAL: profilePalette({ HERALDIC: 1, NORDIC: 1 }, 0.20, ['red', 'white', 'black', 'azure', 'gold']), K: { '2': 2, '3': 4, '4': 3, '5': 0 }, BAL: BAL_WIDE, tags_allowed: ['norse', 'neutral'], GEN: profileGeneration([60, 30, 10, 0], [10, 60, 30, 0], 0.05, 0.05, 0.25, 0) },
  P04: { ASP: { 'RECT:1.0': 3, 'RECT:1.25': 2, 'BANNER:0.5': 1, 'BANNER:0.667': 2, 'BANNER:0.75': 2 }, PAL: profilePalette({ ANTIQUE_PURPLE: 4, IMPERIAL_EAST: 2 }, 0.90, ['purple', 'tyrian', 'gold', 'crimson', 'white', 'black', 'azure']), K: { '2': 1, '3': 3, '4': 4, '5': 1 }, BAL: BAL_STD, tags_allowed: ['christian', 'royal'], GEN: profileGeneration([5, 70, 25, 0], [10, 40, 40, 10], 0.10, 0.05, 0, 0.05) },
  P05: { ASP: { 'RECT:1.0': 3, 'RECT:1.25': 3, 'RECT:1.333': 3 }, PAL: profilePalette({ HERALDIC: 5 }, 0.92, ['red', 'gold', 'azure', 'white', 'black', 'vert', 'purple']), K: { '2': 3, '3': 4, '4': 3, '5': 1 }, BAL: BAL_WIDE, tags_allowed: ['christian', 'royal', 'neutral'], GEN: profileGeneration([30, 40, 25, 5], [25, 45, 25, 5], 0.15, 0.25, 0, 0.10) },
  P06: { ASP: { 'RECT:1.333': 3, 'RECT:1.5': 4 }, PAL: profilePalette({ ITALIAN: 2, HERALDIC: 2 }, 0.50, ['red', 'white', 'vert', 'azure', 'gold']), K: { '2': 5, '3': 3, '4': 1, '5': 0 }, BAL: BAL_STD, tags_allowed: ['christian', 'neutral'], GEN: profileGeneration([30, 60, 10, 0], [20, 60, 20, 0], 0.05, 0.05, 0, 0) },
  P07: { ASP: { 'RECT:1.25': 3, 'RECT:1.5': 4 }, PAL: profilePalette({ GERMANIC: 5, HERALDIC: 1 }, 0.85, ['black', 'red', 'gold', 'white']), K: { '2': 3, '3': 4, '4': 2, '5': 0 }, BAL: BAL_STD, tags_allowed: ['christian', 'royal'], GEN: profileGeneration([45, 40, 15, 0], [20, 60, 20, 0], 0.05, 0.10, 0, 0) },
  P08: { ASP: { 'RECT:1.5': 3, 'RECT:1.667': 2, 'RECT:2.0': 1 }, PAL: profilePalette({ ISLAMIC_GREEN: 5 }, 0.92, ['vert', 'white', 'black', 'red', 'gold']), K: { '2': 3, '3': 4, '4': 3, '5': 1 }, BAL: BAL_STD, tags_allowed: ['islamic'], GEN: profileGeneration([70, 25, 5, 0], [5, 70, 25, 0], 0.05, 0, 0, 0) },
  P09: { ASP: { 'RECT:1.5': 2, 'RECT:1.667': 2, 'RECT:2.0': 1, 'BANNER:0.25': 1, 'BANNER:0.333': 2, 'BANNER:0.4': 2, 'BANNER:0.5': 2 }, PAL: profilePalette({ TURKIC: 4 }, 0.80, ['sky', 'white', 'gold', 'red', 'vert', 'black']), K: { '2': 3, '3': 4, '4': 2, '5': 1 }, BAL: BAL_WIDE, tags_allowed: ['steppe', 'neutral'], GEN: profileGeneration([60, 30, 10, 0], [5, 65, 30, 0], 0, 0, 0.30, 0) },
  P10: { ASP: { 'RECT:1.5': 2, 'RECT:1.667': 2, 'BANNER:0.25': 1, 'BANNER:0.333': 2, 'BANNER:0.4': 2, 'BANNER:0.5': 1, 'BANNER:0.6': 1 }, PAL: profilePalette({ IMPERIAL_EAST: 5 }, 0.90, ['gold', 'red', 'azure', 'black', 'white']), K: { '2': 2, '3': 3, '4': 3, '5': 2 }, BAL: BAL_WIDE, tags_allowed: ['royal', 'neutral'], GEN: profileGeneration([20, 65, 15, 0], [5, 70, 25, 0], 0.05, 0.80, 0.50, 0) },
  P11: { ASP: { 'RECT:1.5': 5, 'BANNER:0.2': 2, 'BANNER:0.25': 3, 'BANNER:0.333': 2 }, PAL: profilePalette({ IMPERIAL_EAST: 1 }, 0.20, ['white', 'red', 'black', 'navy', 'gold']), K: { '2': 5, '3': 4, '4': 1, '5': 0 }, BAL: BAL_STD, tags_allowed: ['neutral'], GEN: profileGeneration([85, 15, 0, 0], [10, 80, 10, 0], 0, 0, 0, 0) },
  P12: { ASP: { 'RECT:1.5': 3, 'RECT:1.667': 2 }, PAL: profilePalette({ SAFFRON: 5 }, 0.90, ['saffron', 'white', 'vert', 'navy', 'red', 'gold']), K: { '2': 1, '3': 4, '4': 3, '5': 2 }, BAL: BAL_WIDE, tags_allowed: ['dharmic', 'royal'], GEN: profileGeneration([60, 35, 5, 0], [5, 75, 20, 0], 0.05, 0, 0, 0) },
  P13: { ASP: { 'RECT:1.5': 3, 'RECT:2.0': 3 }, PAL: profilePalette({ MARITIME: 5 }, 0.95, ['azure', 'navy', 'red', 'white']), K: { '2': 0, '3': 6, '4': 3, '5': 1 }, BAL: balanceRegion([0.22, 0.65], [0.25, 0.62]), tags_allowed: ['maritime', 'neutral'], GEN: profileGeneration([0, 80, 20, 0], [5, 55, 40, 0], 0.50, 0, 0, 0) },
  P14: { ASP: { 'RECT:1.4': 1, 'RECT:1.5': 4, 'RECT:1.667': 2, 'RECT:2.0': 2 }, PAL: profilePalette({ TRICOLOR_FR: 4, ITALIAN: 3, PAN_SLAVIC: 3, GERMANIC: 2, DUTCH_TYPE: 2 }, 0.97), K: { '2': 1, '3': 8, '4': 1, '5': 0 }, BAL: BAL_STD, tags_allowed: ['neutral'], GEN: profileGeneration([85, 15, 0, 0], [90, 10, 0, 0], 0, 0, 0, 0), SPECIAL: { fieldOperatorWeights: { 'BANDS:V': 3, 'BANDS:H': 4, 'SPLIT2:PALE': 2 }, bandCountWeights: { '3': 0.8, '4': 0.1, '5': 0.1 }, bandWeighting: { equal: 0.7, symmetric: 0.3 }, slotPattern: { distinct: 0.7, mirror: 0.3 }, smallEmblemProbability: 0.1 } },
  P15: { ASP: { 'RECT:1.4': 1, 'RECT:1.5': 3, 'RECT:1.667': 3 }, PAL: profilePalette({ GRAN_COLOMBIA: 3, ITALIAN: 2 }, 0.70, ['sky', 'white', 'gold', 'azure', 'red', 'vert']), K: { '2': 2, '3': 5, '4': 2, '5': 0 }, BAL: BAL_STD, tags_allowed: ['neutral'], GEN: profileGeneration([60, 35, 5, 0], [20, 60, 20, 0], 0.10, 0, 0, 0) },
  P16: { ASP: { 'RECT:1.5': 4, 'RECT:1.667': 3 }, PAL: profilePalette({ ISLAMIC_GREEN: 4, TURKIC: 1 }, 0.95, ['red', 'white', 'vert', 'black']), K: { '2': 6, '3': 3, '4': 1, '5': 0 }, BAL: BAL_STD, tags_allowed: ['islamic'], GEN: profileGeneration([75, 25, 0, 0], [0, 90, 10, 0], 0.05, 0, 0, 0) },
  P17: { ASP: { 'RECT:1.5': 3, 'RECT:2.0': 3 }, PAL: profilePalette({ PAN_ARAB: 5 }, 1), K: { '2': 0, '3': 3, '4': 6, '5': 1 }, BAL: BAL_HOIST, tags_allowed: ['neutral'], GEN: profileGeneration([10, 85, 5, 0], [75, 25, 0, 0], 0.05, 0, 0, 0) },
  P18: { ASP: { 'RECT:1.9': 4, 'RECT:1.667': 1, 'RECT:1.5': 1 }, PAL: profilePalette({ MARITIME: 3, TRICOLOR_FR: 2 }, 0.90, ['red', 'white', 'azure', 'navy', 'gold']), K: { '2': 0, '3': 7, '4': 3, '5': 0 }, BAL: BAL_HOIST, tags_allowed: ['neutral'], GEN: profileGeneration([0, 100, 0, 0], [100, 0, 0, 0], 0, 0, 0, 0) },
  P19: { ASP: { 'RECT:1.321': 1, 'RECT:1.375': 2, 'RECT:1.389': 1, 'RECT:1.4': 2, 'RECT:1.6': 2, 'RECT:1.636': 1 }, PAL: profilePalette({ NORDIC: 5 }, 0.97, ['azure', 'navy', 'red', 'white', 'gold']), K: { '2': 3, '3': 6, '4': 1, '5': 0 }, BAL: BAL_HOIST, tags_allowed: ['neutral'], GEN: profileGeneration([0, 85, 15, 0], [95, 5, 0, 0], 0.50, 0, 0, 0) },
  P20: { ASP: { 'RECT:1.5': 4, 'RECT:1.667': 3 }, PAL: profilePalette({ PAN_AFRICAN: 5, PAN_AFRICAN_B: 3 }, 1), K: { '2': 0, '3': 5, '4': 5, '5': 0 }, BAL: BAL_STD, tags_allowed: ['neutral'], GEN: profileGeneration([55, 40, 5, 0], [10, 75, 15, 0], 0.10, 0, 0, 0) },
  P21: { ASP: { 'RECT:1.5': 3, 'RECT:1.667': 2, 'RECT:2.0': 2 }, PAL: profilePalette({ SOCIALIST: 5 }, 0.95, ['red', 'gold', 'azure', 'white', 'black']), K: { '2': 3, '3': 6, '4': 1, '5': 0 }, BAL: BAL_HOIST, tags_allowed: ['socialist'], GEN: profileGeneration([60, 35, 5, 0], [5, 65, 30, 0], 0.05, 0, 0, 0) },
  P22: { ASP: { 'RECT:1.5': 3, 'RECT:1.667': 2, 'RECT:1.4': 1 }, PAL: profilePalette({ MARITIME: 1 }, 0.10, ['white', 'red', 'vert', 'azure', 'gold']), K: { '2': 6, '3': 4, '4': 1, '5': 0 }, BAL: BAL_STD, tags_allowed: ['neutral'], GEN: profileGeneration([95, 5, 0, 0], [0, 85, 15, 0], 0, 0, 0, 0) },
  P23: { ASP: { 'RECT:1.5': 2, 'RECT:1.667': 2, 'RECT:2.0': 2 }, PAL: profilePalette({ MARITIME: 2, SOCIALIST: 1 }, 0.40, ['red', 'white', 'azure', 'gold']), K: { '2': 2, '3': 5, '4': 3, '5': 0 }, BAL: BAL_HOIST, tags_allowed: ['neutral', 'islamic'], GEN: profileGeneration([70, 30, 0, 0], [20, 60, 20, 0], 0.05, 0, 0, 0) },
  P24: { ASP: { 'RECT:1.667': 3, 'RECT:2.0': 3 }, PAL: profilePalette({ TURKIC: 5 }, 0.85, ['sky', 'white', 'gold', 'red', 'vert']), K: { '2': 1, '3': 4, '4': 4, '5': 2 }, BAL: BAL_STD, tags_allowed: ['steppe', 'islamic', 'neutral'], GEN: profileGeneration([50, 45, 5, 0], [10, 60, 30, 0], 0.05, 0.05, 0, 0) },
  P25: { ASP: { 'RECT:1.5': 3, 'RECT:2.0': 3 }, PAL: profilePalette({ MARITIME: 3, TRICOLOR_FR: 1 }, 0.50, ['azure', 'white', 'gold', 'red']), K: { '2': 2, '3': 5, '4': 3, '5': 0 }, BAL: BAL_WIDE, tags_allowed: ['neutral', 'maritime'], GEN: profileGeneration([60, 35, 5, 0], [10, 60, 30, 0], 0.05, 0, 0, 0) },
  P26: { ASP: { 'RECT:1.667': 2, 'RECT:2.0': 3 }, PAL: profilePalette({ PAN_AFRICAN_B: 2, PAN_AFRICAN: 1 }, 0.55, ['gold', 'black', 'vert', 'azure', 'red', 'white']), K: { '2': 1, '3': 4, '4': 4, '5': 2 }, BAL: BAL_WIDE, tags_allowed: ['neutral'], GEN: profileGeneration([10, 70, 20, 0], [40, 50, 10, 0], 0.40, 0, 0, 0) },
  P27: { ASP: { 'RECT:1.0': 5, 'RECT:1.25': 1 }, PAL: profilePalette({ NORDIC: 1, MARITIME: 1 }, 0.30, ['red', 'white', 'gold', 'azure']), K: { '2': 7, '3': 3, '4': 0, '5': 0 }, BAL: BAL_STD, tags_allowed: ['neutral'], GEN: profileGeneration([0, 100, 0, 0], [60, 40, 0, 0], 0.10, 0, 0, 0) },
  P28: { ASP: { 'RECT:1.5': 2, 'RECT:1.6': 2, 'RECT:1.667': 3, 'RECT:1.9': 1, 'RECT:2.0': 2 }, PAL: { ...profilePalette({ MARITIME: 2, TRICOLOR_FR: 2, NORDIC: 1, PAN_AFRICAN: 1, GRAN_COLOMBIA: 1, IMPERIAL_EAST: 1, SOCIALIST: 1, ITALIAN: 1 }, 0.50), free_colors: { white: 5, red: 5, azure: 5, vert: 4, gold: 4, black: 3, navy: 3, sky: 2, orange: 2, turquoise: 1, maroon: 1, saffron: 1 }, free: 0.50, free_allowed: true }, K: { '2': 3, '3': 5, '4': 2, '5': 0 }, BAL: BAL_WIDE, tags_allowed: ['neutral'], GEN: profileGeneration([25, 60, 15, 0], [20, 70, 10, 0], 0.10, 0.10, 0, 0) },
  P29: { ASP: { 'RECT:1.25': 2, 'RECT:1.333': 2, 'RECT:1.4': 1, 'RECT:1.5': 2 }, PAL: profilePalette({ MARITIME: 5 }, 0.95, ['azure', 'white', 'red', 'gold', 'black']), K: { '2': 5, '3': 5, '4': 0, '5': 0 }, BAL: BAL_WIDE, tags_allowed: ['maritime'], GEN: profileGeneration([30, 60, 10, 0], [60, 35, 5, 0], 0.20, 0, 0, 0) },
  P30: { ASP: { 'RECT:1.0': 2, 'RECT:1.25': 1, 'RECT:1.5': 2, 'BANNER:0.5': 1, 'BANNER:0.667': 1, 'BANNER:0.75': 1 }, PAL: profilePalette({ MESO: 5 }, 0.95, ['turquoise', 'red', 'gold', 'black', 'white']), K: { '2': 0, '3': 3, '4': 5, '5': 2 }, BAL: BAL_STD, tags_allowed: ['mesoamerican', 'neutral'], GEN: profileGeneration([30, 55, 15, 0], [15, 60, 25, 0], 0.05, 0.60, 0, 0.10) },
  P31: { ASP: { 'RECT:1.5': 3, 'RECT:1.667': 3 }, PAL: profilePalette({ MARITIME: 2, HERALDIC: 1 }, 0.50, ['red', 'white', 'azure', 'gold']), K: { '2': 3, '3': 5, '4': 2, '5': 0 }, BAL: BAL_HOIST, tags_allowed: ['neutral'], GEN: profileGeneration([30, 60, 10, 0], [10, 75, 15, 0], 0.10, 0.05, 0, 0) },
  P32: { ASP: { 'RECT:1.5': 3, 'RECT:1.667': 3, 'RECT:2.0': 2 }, PAL: profilePalette({ PAN_SLAVIC: 5, MARITIME: 1, IMPERIAL_EAST: 1 }, 0.90, ['red', 'white', 'azure', 'gold', 'black']), K: { '2': 1, '3': 6, '4': 3, '5': 0 }, BAL: BAL_STD, tags_allowed: ['christian', 'royal'], GEN: profileGeneration([55, 40, 5, 0], [20, 55, 25, 0], 0.05, 0.05, 0, 0) },
};

const PROFILE_ANCHOR_WEIGHTS: Record<string, FlagProfileWeights> = {
  P01: { A1: 6, A6: 1 },
  P02: { A1: 6, A2: 1, A10: 1 },
  P03: { A1: 5, A2: 2, A10: 1 },
  P04: { A5: 6, A3: 3, A1: 1 },
  P05: { A5: 4, A1: 3, A3: 3, A7: 2, A2: 1, A6: 1, A9: 1, A10: 1 },
  P06: { A3: 3, A5: 3, A1: 2 },
  P07: { A1: 5, A6: 2, A2: 1 },
  P08: { A1: 5, A2: 2, A6: 1 },
  P09: { A1: 3, A2: 3, A8: 1 },
  P10: { A1: 6, A2: 1 },
  P11: { A1: 6, A2: 1 },
  P12: { A1: 3, A6: 3, A2: 1 },
  P13: { A11: 5 },
  P14: { A1: 1 },
  P15: { A6: 4, A1: 3, A9: 1, A2: 1 },
  P16: { A2: 4, A1: 3, A9: 1 },
  P17: { A9: 3, A1: 2, A6: 1 },
  P18: { A1: 1 },
  P19: { A3: 3, A5: 2 },
  P20: { A6: 4, A1: 3, A9: 1 },
  P21: { A4: 5, A1: 2, A2: 1, A6: 1 },
  P22: { A1: 3, A2: 2 },
  P23: { A6: 3, A4: 3, A1: 2, A2: 1 },
  P24: { A4: 4, A2: 2, A6: 2, A1: 1 },
  P25: { A1: 3, A2: 2, A4: 2, A6: 1 },
  P26: { A3: 4, A1: 2, A9: 2, A5: 1 },
  P27: { A3: 4, A1: 1 },
  P28: { A1: 3, A2: 3, A9: 2, A4: 1, A3: 1, A6: 1 },
  P29: { A5: 4, A1: 2, A3: 2 },
  P30: { A1: 5, A10: 2, A2: 1 },
  P31: { A2: 4, A4: 3, A1: 1 },
  P32: { A1: 4, A6: 3, A3: 2, A2: 1 },
};

const PROFILE_CHARGE_OVERRIDES: Record<string, Partial<NonNullable<FlagProfileConfig['CHG']>>> = {
  P19: {
    modules: { STAR: 4, DISC: 3, RING: 2, POLYGON: 1 },
    composers: { SINGLE: 1 },
    repeaters: {},
  },
};

export const FLAG_PROFILE_CONFIG: FlagProfileConfig[] = FLAG_PROFILE_STARTER_CONFIG.map((starter) => {
  const resolved = RESOLVED_PROFILE_DATA[starter.id];
  if (!resolved) throw new Error(`Нет ответов приёмки для профиля ${starter.id}.`);
  const chargeConfig: NonNullable<FlagProfileConfig['CHG']> = {
    ...starter.CHG!,
    ...(PROFILE_CHARGE_OVERRIDES[starter.id] ?? {}),
    anchors: PROFILE_ANCHOR_WEIGHTS[starter.id] ?? starter.CHG?.anchors,
  };
  return {
    ...starter,
    ...resolved,
    CHG: chargeConfig,
    SPECIAL: resolved.SPECIAL ?? starter.SPECIAL,
    HYB: [],
  };
});

/** Вес неупорядоченной пары гибридных профилей; применяется в обоих направлениях. */
export const FLAG_PROFILE_HYBRID_PAIR_WEIGHTS: readonly { first: string; second: string; weight: number }[] = [
  { first: 'P01', second: 'P04', weight: 3 }, { first: 'P01', second: 'P02', weight: 2 }, { first: 'P01', second: 'P05', weight: 1 },
  { first: 'P02', second: 'P10', weight: 3 }, { first: 'P02', second: 'P09', weight: 2 }, { first: 'P02', second: 'P30', weight: 1 },
  { first: 'P03', second: 'P05', weight: 3 }, { first: 'P03', second: 'P07', weight: 2 }, { first: 'P03', second: 'P09', weight: 1 }, { first: 'P03', second: 'P29', weight: 1 },
  { first: 'P04', second: 'P05', weight: 2 }, { first: 'P04', second: 'P06', weight: 2 }, { first: 'P04', second: 'P07', weight: 2 }, { first: 'P04', second: 'P32', weight: 4 }, { first: 'P04', second: 'P09', weight: 1 },
  { first: 'P05', second: 'P06', weight: 3 }, { first: 'P05', second: 'P07', weight: 3 }, { first: 'P05', second: 'P31', weight: 2 }, { first: 'P05', second: 'P32', weight: 1 }, { first: 'P05', second: 'P29', weight: 1 },
  { first: 'P06', second: 'P31', weight: 3 }, { first: 'P06', second: 'P29', weight: 1 }, { first: 'P07', second: 'P31', weight: 1 },
  { first: 'P08', second: 'P09', weight: 3 }, { first: 'P08', second: 'P16', weight: 3 }, { first: 'P08', second: 'P24', weight: 2 },
  { first: 'P09', second: 'P24', weight: 3 }, { first: 'P09', second: 'P10', weight: 2 }, { first: 'P09', second: 'P16', weight: 2 },
  { first: 'P10', second: 'P11', weight: 3 }, { first: 'P10', second: 'P12', weight: 2 }, { first: 'P10', second: 'P23', weight: 1 },
  { first: 'P11', second: 'P22', weight: 2 }, { first: 'P11', second: 'P28', weight: 1 }, { first: 'P12', second: 'P22', weight: 2 }, { first: 'P12', second: 'P28', weight: 1 },
  { first: 'P13', second: 'P29', weight: 3 }, { first: 'P13', second: 'P25', weight: 2 }, { first: 'P13', second: 'P26', weight: 2 }, { first: 'P13', second: 'P18', weight: 2 },
  { first: 'P14', second: 'P15', weight: 2 }, { first: 'P14', second: 'P20', weight: 1 }, { first: 'P14', second: 'P31', weight: 1 }, { first: 'P14', second: 'P28', weight: 2 }, { first: 'P14', second: 'P32', weight: 2 }, { first: 'P14', second: 'P19', weight: 1 },
  { first: 'P15', second: 'P26', weight: 1 }, { first: 'P15', second: 'P18', weight: 1 },
  { first: 'P16', second: 'P17', weight: 3 }, { first: 'P16', second: 'P24', weight: 1 }, { first: 'P16', second: 'P23', weight: 1 },
  { first: 'P17', second: 'P20', weight: 1 }, { first: 'P17', second: 'P21', weight: 2 }, { first: 'P18', second: 'P23', weight: 1 }, { first: 'P18', second: 'P20', weight: 1 },
  { first: 'P19', second: 'P28', weight: 3 }, { first: 'P19', second: 'P27', weight: 2 }, { first: 'P19', second: 'P29', weight: 2 },
  { first: 'P20', second: 'P21', weight: 2 }, { first: 'P20', second: 'P26', weight: 1 },
  { first: 'P21', second: 'P22', weight: 2 }, { first: 'P21', second: 'P23', weight: 2 }, { first: 'P21', second: 'P28', weight: 2 }, { first: 'P21', second: 'P24', weight: 1 },
  { first: 'P22', second: 'P23', weight: 2 }, { first: 'P22', second: 'P25', weight: 1 }, { first: 'P22', second: 'P28', weight: 2 },
  { first: 'P25', second: 'P26', weight: 2 }, { first: 'P25', second: 'P29', weight: 2 }, { first: 'P25', second: 'P28', weight: 1 },
  { first: 'P26', second: 'P29', weight: 1 }, { first: 'P27', second: 'P28', weight: 3 }, { first: 'P27', second: 'P29', weight: 2 },
  { first: 'P28', second: 'P29', weight: 2 }, { first: 'P28', second: 'P30', weight: 1 }, { first: 'P28', second: 'P31', weight: 1 },
  { first: 'P29', second: 'P31', weight: 1 },
];
export const FLAG_HYBRID_SOURCE_WEIGHTS = {
  donorBase: 3,
  baseDonor: 4,
  donorDonor: 3,
} as const;

for (const profile of FLAG_PROFILE_CONFIG) {
  profile.HYB = FLAG_PROFILE_HYBRID_PAIR_WEIGHTS
    .filter(({ first, second }) => first === profile.id || second === profile.id)
    .map(({ first, second }) => first === profile.id ? second : first)
    .sort();
}

/** Резерв P28_FB — отдельный чистый профиль с ограничениями из §32.3. */
export const FLAG_FALLBACK_PROFILE_CONFIG: FlagProfileConfig = {
  ...FLAG_PROFILE_CONFIG.find(({ id }) => id === 'P28')!,
  id: 'P28_FB',
  eras: [6],
  tags_allowed: ['neutral'],
  OUT: { RECT: 1 },
  ASP: { 'RECT:1.5': 1, 'RECT:1.667': 1 },
  GND: { BANDS: 1, SPLIT2: 1 },
  PAL: profilePalette({ TRICOLOR_FR: 3, MARITIME: 2, NORDIC: 1 }, 1),
  K: { '2': 4, '3': 6, '4': 0, '5': 0 },
  ORD: {},
  CHG: charges({ DISC: 1, STAR: 1, RHOMBUS: 1 }, null, null, { A1: 1 }, [1, 1], 1),
  GEN: profileGeneration([1, 0, 0, 0], [0, 100, 0, 0], 0, 0, 0, 0),
  HYB: [],
  SPECIAL: {
    fallback: true,
    fieldOperators: ['G02', 'G04'],
    bands: [2, 3],
    bandWeighting: ['equal', 'symmetric'],
    ordinaryCount: 0,
    emblemModules: ['DISC', 'STAR', 'RHOMBUS'],
    emblemAnchors: ['A1'],
    emblemDiameters: [0.30, 0.36],
    maxEmblems: 1,
    outline: 'RECT',
    attempts: 200,
    snapStep: 50,
  },
};

export const FLAG_PROFILE_DEFAULTS = {
  purity: 0.88,
  probabilityRange: [0, 1] as const,
} as const;

/** Симметричные правила совместимости тегов из §13.3. */
export const FLAG_TAG_COMPATIBILITY = {
  forbidden: [
    ['christian', 'islamic'],
    ['christian', 'dharmic'],
    ['islamic', 'dharmic'],
    ['socialist', 'royal'],
    ['socialist', 'christian'],
  ],
  hybridOnly: [
    ['steppe', 'islamic'],
    ['steppe', 'christian'],
    ['norse', 'christian'],
    ['maritime', '*'],
    ['roman', 'christian'],
  ],
  universal: 'neutral',
} as const;

/** Связи культур игры с профилями задаются отдельно; невыданные соответствия не выводятся. */
export const FLAG_CULTURE_PROFILE_BINDINGS: Record<string, { profileIds: string[]; tags: string[] }> = {};
