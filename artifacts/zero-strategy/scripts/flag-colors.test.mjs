import assert from 'node:assert/strict';
import {
  buildFlagSlotAdjacency,
  deltaE76,
  relativeLuminance,
  solveFlagPalette,
  srgbToLab,
  validateFlagPalette,
  wcagContrast,
} from '../game/flagColors.ts';

const profile = {
  colorWeights: {
    white: 1, red: 1, azure: 0, black: 0, purple: 0, gold: 0, crimson: 0,
    navy: 0, sky: 0, vert: 0, green_dark: 0, tyrian: 0, orange: 0,
    saffron: 0, turquoise: 0, maroon: 0, grey: 0, tenne: 0,
  },
  archetypeWeights: {},
  freePaletteWeight: 1,
  archetypeProbability: 0,
  colorCountWeights: [
    { count: 2, weight: 1 },
    { count: 3, weight: 0 },
    { count: 4, weight: 0 },
    { count: 5, weight: 0 },
  ],
  tinctureProbability: 0,
};
const makeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};
const spec = {
  profile_id: 'test',
  era: 0,
  slots: { items: ['s1', 's2'], equalities: [] },
};
const raster = {
  width: 4,
  height: 2,
  pixelSize: 30,
  values: ['s1', 's1', 's2', 's2', 's1', 's1', 's2', 's2'],
};

const whiteLab = srgbToLab('#FFFFFF');
assert.ok(Math.abs(whiteLab.l - 100) < 1e-4 && Math.abs(whiteLab.a) < 1e-4 && Math.abs(whiteLab.b) < 1e-4,
  'D65 CIELAB maps white to L*=100, a*=b*=0');
assert.ok(Math.abs(srgbToLab('#000000').l) < 1e-8, 'D65 CIELAB maps black to L*=0');
assert.ok(Math.abs(deltaE76('#000000', '#FFFFFF') - 100) < 1e-4, 'ΔE76 is Euclidean CIELAB distance');
assert.equal(relativeLuminance('#000000'), 0, 'WCAG luminance for black is zero');
assert.equal(relativeLuminance('#FFFFFF'), 1, 'WCAG luminance for white is one');
assert.equal(wcagContrast('#000000', '#FFFFFF'), 21, 'black and white have WCAG contrast 21:1');

const adjacency = buildFlagSlotAdjacency(raster, spec.slots.items);
assert.equal(adjacency.length, 1, 'one shared-boundary edge is found');
assert.equal(adjacency[0].a, 's1');
assert.equal(adjacency[0].b, 's2');
assert.equal(adjacency[0].boundary, 60, 'boundary length is accumulated in flag units');
assert.equal(adjacency[0].kind, 'field', 'raster-derived adjacency is identified as field adjacency');
assert.deepEqual(
  buildFlagSlotAdjacency(
    { width: 2, height: 1, pixelSize: 30, values: ['s1', 's2'] },
    ['s1', 's2'],
    [['s1', 's2']],
  ),
  [],
  'equal slots do not create a color-conflict edge',
);

const options = {
  slotRaster: raster,
  random: makeRandom(97),
  profile,
  era: 0,
  chargeBackgrounds: [{ chargeSlot: 's1', backgroundSlot: 's2' }],
};
const solved = solveFlagPalette(spec, options);
assert.equal(solved.success, true, 'a contrasting, even-area palette is solved');
assert.equal(solved.colorCount, 2);
assert.ok(solved.palette.s1 && solved.palette.s2, 'every declared slot receives a palette entry');
assert.equal(solved.checks.every(({ passed }) => passed), true, 'every C1–C5 and availability check passes');
assert.equal(solved.palette.s1.color_id === solved.palette.s2.color_id, false, 'adjacent slots receive distinct colors');

const repeated = solveFlagPalette(spec, { ...options, random: makeRandom(97) });
assert.deepEqual(repeated, solved, 'identical deterministic streams produce identical palette and diagnostics');

const strictFailure = solveFlagPalette(spec, {
  ...options,
  random: makeRandom(13),
  profile: {
    ...profile,
    colorWeights: { ...profile.colorWeights, white: 0, red: 1, azure: 1 },
  },
  tincture: true,
});
assert.equal(strictFailure.success, false, 'strict tincture rejects adjacent color/color fields');
assert.ok(strictFailure.attempts > 0, 'solver returns its deterministic attempt count on failure');

const eraFailure = solveFlagPalette(spec, {
  ...options,
  random: makeRandom(8),
  era: 3,
  profile: {
    ...profile,
    colorWeights: { ...profile.colorWeights, white: 0, red: 0, purple: 1 },
  },
});
assert.equal(eraFailure.success, false, 'palette selection excludes colors unavailable in the requested era');

const prohibited = validateFlagPalette(
  spec,
  { s1: { color_id: 'purple', hex: '#5B2A86' }, s2: { color_id: 'black', hex: '#111111' } },
  { slotRaster: raster, era: 0 },
);
assert.equal(prohibited.find(({ rule }) => rule === 'C4').passed, false, 'C4 rejects purple next to black');
const unusedColor = validateFlagPalette(
  spec,
  { s1: { color_id: 'purple', hex: '#5B2A86' }, s2: { color_id: 'black', hex: '#111111' } },
  { slotRaster: { ...raster, values: Array(8).fill('s1') }, era: 0 },
);
assert.equal(unusedColor.find(({ rule }) => rule === 'C5').passed, false, 'C5 rejects an unused color in the final raster');

assert.throws(
  () => solveFlagPalette(spec, { ...options, slotRaster: { width: 1, height: 1, values: ['unknown'] } }),
  /unknown slot/,
  'unknown raster slots fail explicitly instead of disappearing from area checks',
);

console.log('Flag palette metrics, CSP assignment, equality handling, era checks, and C1–C5 regressions passed.');
