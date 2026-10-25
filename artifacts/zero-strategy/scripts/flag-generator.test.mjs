import assert from 'node:assert/strict';
import { flagStageRandom, flagWeightedPick } from '../game/random.ts';
import {
  enforceFlagComplexityBudget,
  FlagGenerationAttemptError,
  generateFlag,
  repairFlagGeometry,
} from '../game/flagGenerator.ts';
import { parseFlagSpec, serializeFlagSpec } from '../game/flagSpec.ts';

const flagStageNames = [
  'S1_PROFILE',
  'S2_OUTLINE',
  'S3_STYLE',
  'S4_COMPOSITION',
  'S5_COMPLEXITY',
  'S6_PALETTE',
  'S7_GEOMETRY',
];

function makeFlag(profileId = 'P-test') {
  return {
    generator_version: 'draft',
    seed: 'draft',
    profile_id: profileId,
    second_profile_id: null,
    era: 6,
    tags: [],
    outline: { type: 'RECT', params: {}, aspect: 1.5, safe_area: { margin: 0.03 } },
    slots: { items: ['s1', 's2'], equalities: [] },
    palette: {
      s1: { color_id: 'red', hex: '#CE1126' },
      s2: { color_id: 'white', hex: '#FFFFFF' },
    },
    root: {
      x0: 0, y0: 0, w: 1, h: 1, clip: [],
      ground: { kind: 'split', op: 'BANDS', params: {}, children: [
        { kind: 'fill', fill: 's1' }, { kind: 'fill', fill: 's2' },
      ] },
      layers: [],
    },
    meta: { complexity: 1, symmetry: 'NONE', color_count: 2, structure_hash: 'structure', visual_hash: 'visual' },
  };
}

function makeHooks(overrides = {}) {
  const calls = [];
  const stage = (name) => (draft, context) => {
    calls.push([name, context.attempt]);
    return { ...draft, seen: [...(draft.seen ?? []), name] };
  };
  return {
    calls,
    hooks: {
      selectProfile: (context) => {
        calls.push(['S1_PROFILE', context.attempt]);
        return { profile_id: 'P-test', seen: [] };
      },
      selectOutline: stage('S2_OUTLINE'),
      selectStyleAndComplexity: stage('S3_STYLE'),
      compose: stage('S4_COMPOSITION'),
      enforceComplexityBudget: stage('S5_COMPLEXITY'),
      solvePalette: stage('S6_PALETTE'),
      repairGeometry: stage('S7_GEOMETRY'),
      validate: (draft, context) => {
        calls.push(['S8_VALIDATION', context.attempt]);
        return { passed: true };
      },
      checkNovelty: (draft, context) => {
        calls.push(['S9_NOVELTY', context.attempt]);
        return true;
      },
      removeLastOptionalLayer: () => null,
      createFallback: (profileId, context) => {
        calls.push(['S1_FALLBACK', context.attempt, profileId]);
        return { profile_id: profileId, seen: [] };
      },
      buildFlagSpec: (draft) => makeFlag(draft.profile_id),
      render: (spec) => JSON.stringify(spec),
      ...overrides,
    },
  };
}

const first = flagStageRandom('same-seed', 'S4_COMPOSITION', 0);
const repeated = flagStageRandom('same-seed', 'S4_COMPOSITION', 0);
assert.deepEqual(Array.from({ length: 8 }, first), Array.from({ length: 8 }, repeated));
assert.notEqual(flagStageRandom('same-seed', 'S4_COMPOSITION', 0)(), flagStageRandom('same-seed', 'S6_PALETTE', 0)());
assert.notEqual(flagStageRandom('same-seed', 'S4_COMPOSITION', 0)(), flagStageRandom('same-seed', 'S4_COMPOSITION', 1)());
assert.throws(() => flagStageRandom('seed', 'stage', -1), /attempt/);
assert.equal(flagWeightedPick([
  { value: 'first', weight: 1 }, { value: 'second', weight: 3 },
], () => 0.25), 'second', 'weighted selection follows the accumulated configuration order');
assert.throws(() => flagWeightedPick([{ value: 'bad', weight: null }], () => 0), /weights/);

const stableHooks = makeHooks();
const one = generateFlag('reproducible', stableHooks.hooks, { attempts_max: 2 });
const two = generateFlag('reproducible', makeHooks().hooks, { attempts_max: 2 });
assert.deepEqual(one, two, 'same seed and generator version produce identical specs, SVG, and stats');
assert.deepEqual(stableHooks.calls.slice(0, 9).map(([name]) => name), [
  'S1_PROFILE', 'S2_OUTLINE', 'S3_STYLE', 'S4_COMPOSITION', 'S5_COMPLEXITY',
  'S6_PALETTE', 'S7_GEOMETRY', 'S8_VALIDATION', 'S9_NOVELTY',
]);
assert.equal(one.flag.generator_version, '0.1.0');
assert.equal(one.flag.seed, 'reproducible');
assert.equal(one.flag.meta.generation_stats.attempts, 1);
assert.equal(one.svg, JSON.stringify(one.flag));
assert.deepEqual(parseFlagSpec(serializeFlagSpec(one.flag)), one.flag, 'generation statistics survive canonical spec serialization');

let validations = 0;
const trimmedHooks = makeHooks({
  validate: (_draft, context) => {
    validations += 1;
    return context.excludedOptionalLayerIds.includes('optional-charge');
  },
  removeLastOptionalLayer: (_draft, context) =>
    context.excludedOptionalLayerIds.length === 0 ? 'optional-charge' : null,
});
const trimmed = generateFlag(7, trimmedHooks.hooks, { attempts_max: 2 });
assert.equal(validations, 3);
assert.equal(trimmed.stats.attempts, 3);
assert.equal(trimmed.stats.optional_layers_removed, 1);
assert.equal(trimmed.stats.fallback_used, false);

const fallbackHooks = makeHooks({
  validate: (draft) => draft.profile_id === 'P28',
  removeLastOptionalLayer: () => null,
});
const fallback = generateFlag('fallback', fallbackHooks.hooks, { attempts_max: 1 });
assert.equal(fallback.flag.profile_id, 'P28');
assert.equal(fallback.stats.fallback_used, true);
assert.equal(fallback.stats.fallback_profile_id, 'P28');
assert.equal(fallback.stats.attempts, 2);
assert.ok(fallback.flag.meta.generation_stats);
assert.ok(fallbackHooks.calls.some(([name, , profile]) => name === 'S1_FALLBACK' && profile === 'P28'));

const retryHooks = makeHooks({
  compose: (draft, context) => {
    if (context.attempt === 0) throw new FlagGenerationAttemptError('S4_COMPOSITION', 'infeasible sample');
    return draft;
  },
});
const retried = generateFlag('retry', retryHooks.hooks, { attempts_max: 2 });
assert.equal(retried.stats.attempts, 2);
assert.equal(retried.stats.rejected_attempts, 1);
assert.deepEqual(retried.stats.rejection_reasons, ['S4_COMPOSITION: infeasible sample']);
assert.throws(() => generateFlag('seed', makeHooks().hooks, { attempts_max: 0 }), /attempts_max/);

const complexityOrder = [];
const budgeted = enforceFlagComplexityBudget(
  { cost: 8, removed: [] },
  {
    complexity: (draft) => draft.cost,
    limit: () => 5,
    removeLowestWeightOptionalCharge: (draft) => {
      complexityOrder.push('charge');
      return draft.cost > 7 ? { draft: { ...draft, cost: draft.cost - 1, removed: [...draft.removed, 'charge'] }, id: 'charge' } : null;
    },
    removeFimbriation: (draft) => {
      complexityOrder.push('fimbriation');
      return draft.cost > 6 ? { draft: { ...draft, cost: draft.cost - 1, removed: [...draft.removed, 'fimbriation'] }, id: 'fimbriation' } : null;
    },
    removePatternFill: (draft) => {
      complexityOrder.push('pattern-fill');
      return draft.cost > 5 ? { draft: { ...draft, cost: draft.cost - 1, removed: [...draft.removed, 'pattern-fill'] }, id: 'pattern-fill' } : null;
    },
    removeSecondOrdinary: () => {
      complexityOrder.push('second-ordinary');
      return null;
    },
  },
);
assert.equal(budgeted.cost, 5);
assert.deepEqual(budgeted.removed, ['charge', 'fimbriation', 'pattern-fill']);
assert.deepEqual(complexityOrder, ['charge', 'charge', 'fimbriation', 'charge', 'fimbriation', 'pattern-fill']);

const repairOrder = [];
const geometry = repairFlagGeometry(
  { fixed: false },
  {
    isSafe: (draft) => draft.fixed,
    chargeIds: () => ['charge-1'],
    scaleCharge: (draft, id, scale) => {
      repairOrder.push(['shrink', id, scale]);
      return draft;
    },
    moveChargeToNearestAllowedPoint: (draft, id) => {
      repairOrder.push(['move', id]);
      return draft;
    },
    repeaterIds: () => ['repeat-1'],
    increaseRepeatStep: (draft, id, scale) => {
      repairOrder.push(['repeat', id, scale]);
      return { fixed: true };
    },
    removeLastRepeaterOrCharge: () => {
      repairOrder.push(['remove']);
      return null;
    },
  },
);
assert.equal(geometry.fixed, true);
assert.deepEqual(repairOrder, [
  ...Array.from({ length: 5 }, () => ['shrink', 'charge-1', 0.92]),
  ['move', 'charge-1'],
  ['repeat', 'repeat-1', 1.1],
]);

console.log('Deterministic flag pipeline checks passed.');
