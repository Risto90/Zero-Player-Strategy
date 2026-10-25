/**
 * External starter data for §13 flag profiles.
 *
 * `null` means the brief does not supply this field for the profile. It is
 * intentionally different from an empty/zero-weight distribution.
 */
/** Null weights preserve options whose relative probability is not specified. */
export type FlagProfileWeights = Record<string, number | null>;
export type FlagProfileRange = readonly [number, number];

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
  BAL: FlagProfileRange | null;
  EDGE: FlagProfileWeights | null;
  HYB: string[];
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
    ...fields,
  };
}

const palette = (
  weights: FlagProfileWeights | null,
  free: number | null = null,
  p_arch: number | null = null,
  free_allowed: boolean | null = free !== null ? true : null,
) => ({
  weights,
  free,
  free_allowed,
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

/** All supplied starter profile data from §13.2; omitted values remain null. */
export const FLAG_PROFILE_CONFIG: FlagProfileConfig[] = [
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
      { STAR: null, DISC: null, CROSS_EMB: null, CROWN: 2, SWORD: 1 },
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
    CHG: charges({ 'STAR:n6-12:SHARP_N_OVER_2': 3, CRESCENT: 3, DISC: 1, 'RING_STAR:INSCRIBE': 1 }),
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
    OUT: { 'BANNER:ASPECT_0.2-0.33': 3, 'RECT:1.5': 2 }, PAL: palette({ 'white/black/red/navy/gold': null }),
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
    CHG: charges({ 'SMALL:DISC|STAR|SHIELD': null }, null, null, null, [0, 3], 0.1),
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
    SYM: { NONE: 4 }, K: { '2|3|4': null }, CMAX: 7,
  }),
  profile('P29', [3, 4, 5, 6], {
    OUT: { 'RECT:1.2-1.5': 5, SWALLOW: 2, PENNANT: 2 }, PAL: palette({ MARITIME: null }),
    K: { '2-3': null }, GND: { QUARTERLY: 3, SPLIT2: 4, BANDS: 3, SALTIRE_DIV: 2, CHECKY: 1 },
    ORD: { CROSS: 3, SALTIRE: 2, BORDURE: 2 }, CHG: charges({ 'SMALL_DISC': 3 }),
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

export const FLAG_PROFILE_DEFAULTS = {
  purity: 0.88,
  hybridProbability: 0,
  probabilityRange: [0, 1] as const,
} as const;

/** Symmetric cultural-tag rules in §13.3. Unlisted pairs are compatible. */
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

/** Game-culture bindings stay user/config supplied; no invented mappings. */
export const FLAG_CULTURE_PROFILE_BINDINGS: Record<string, { profileIds: string[]; tags: string[] }> = {};
