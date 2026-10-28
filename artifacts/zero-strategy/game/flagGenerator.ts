import { FLAG_GENERATOR_CONFIG } from './flagGeneratorConfig';
import { stampFlagHashes } from './flagNovelty';
import { flagStageRandom } from './random';
import { assertValidFlagSpec, type FlagSpec, type JsonValue } from './flagSpec';

export interface FlagGenerationDiagnostic {
  attempt: number;
  stage: string;
  code: string;
  measured: JsonValue | null;
  threshold: JsonValue | null;
  layerId: string | null;
  layerIds: string[];
  layerContributors?: {
    layerId: string;
    sourceId?: string | null;
    parentId?: string | null;
    anchor?: string | null;
    operator: string | null;
    module: string | null;
    tags?: string[];
  }[];
  operator: string | null;
  module: string | null;
  profileId: string | null;
  details: string[];
}

export type FlagGenerationStage =
  | 'S1_PROFILE'
  | 'S2_OUTLINE'
  | 'S3_STYLE'
  | 'S4_COMPOSITION'
  | 'S5_COMPLEXITY'
  | 'S6_PALETTE'
  | 'S7_GEOMETRY'
  | 'S8_VALIDATION'
  | 'S9_NOVELTY'
  | 'S10_OUTPUT'
  | 'S1_FALLBACK';

export interface FlagGenerationStats {
  /** Число кандидатов, включая резервные попытки P28_FB. */
  attempts: number;
  rejected_attempts: number;
  palette_attempts: number;
  fallback_used: boolean;
  fallback_profile_id: string | null;
  optional_layers_removed: number;
  small_layers_removed: number;
  rejection_reasons: string[];
  diagnostics: FlagGenerationDiagnostic[];
  symmetry_downgrades: number;
}

export interface FlagGenerationContext {
  seed: string | number;
  /** Monotonically increasing candidate index; each stage has its own stream. */
  attempt: number;
  /** Stable identifiers removed in the documented deterministic order. */
  excludedOptionalLayerIds: readonly string[];
  stats: FlagGenerationStats;
  random(stage: FlagGenerationStage): () => number;
}

export type FlagGenerationCheck =
  | boolean
  | { passed: boolean; reason?: string };

export interface FlagGenerationHooks<Draft> {
  /** S1–S7 are required so missing profile/operator policy cannot silently fall back. */
  selectProfile(context: FlagGenerationContext): Draft;
  selectOutline(draft: Draft, context: FlagGenerationContext): Draft;
  selectStyleAndComplexity(draft: Draft, context: FlagGenerationContext): Draft;
  compose(draft: Draft, context: FlagGenerationContext): Draft;
  enforceComplexityBudget(draft: Draft, context: FlagGenerationContext): Draft;
  solvePalette(draft: Draft, context: FlagGenerationContext): Draft;
  repairGeometry(draft: Draft, context: FlagGenerationContext): Draft;
  validate(draft: Draft, context: FlagGenerationContext): FlagGenerationCheck;
  /** S9 is intentionally injectable; novelty metrics are a separate task. */
  checkNovelty?(draft: Draft, context: FlagGenerationContext): FlagGenerationCheck;
  /** Return the next optional-layer id in the §14.5 removal order, or null. */
  removeLastOptionalLayer(draft: Draft, context: FlagGenerationContext): string | null;
  /** Создаёт резервный профиль P28_FB с отдельными ограничениями. */
  createFallback(profileId: 'P28_FB', context: FlagGenerationContext): Draft;
  /** Build the spec before rendering so its version and attempt stats are included. */
  buildFlagSpec(draft: Draft, context: FlagGenerationContext): FlagSpec;
  render?(spec: FlagSpec): string;
  onStageTiming?(stage: FlagGenerationStage | 'render', durationMs: number): void;
}

export interface FlagGenerationResult {
  flag: FlagSpec;
  svg?: string;
  stats: FlagGenerationStats;
}

export interface GenerateFlagOptions {
  attempts_max?: number;
  generator_version?: string;
}

export interface FlagComplexityReducer<Draft> {
  complexity(draft: Draft): number;
  limit(draft: Draft): number;
  /** Select the lowest-weight optional charge; break equal weights by source order. */
  removeLowestWeightOptionalCharge(draft: Draft): { draft: Draft; id: string } | null;
  removeFimbriation(draft: Draft): { draft: Draft; id: string } | null;
  removePatternFill(draft: Draft): { draft: Draft; id: string } | null;
  removeSecondOrdinary(draft: Draft): { draft: Draft; id: string } | null;
}

/** Apply the §14.5 pruning order without allowing adapters to reorder priorities. */
export function enforceFlagComplexityBudget<Draft>(
  input: Draft,
  adapter: FlagComplexityReducer<Draft>,
): Draft {
  let draft = input;
  let complexity = adapter.complexity(draft);
  const cap = adapter.limit(draft);
  if (!Number.isFinite(complexity) || complexity < 0 || !Number.isFinite(cap) || cap < 0) {
    throw new RangeError('flag complexity and CMAX must be non-negative finite numbers');
  }
  const removers = {
    'optional-charge-lowest-weight': adapter.removeLowestWeightOptionalCharge,
    fimbriation: adapter.removeFimbriation,
    'pattern-fill': adapter.removePatternFill,
    'second-ordinary': adapter.removeSecondOrdinary,
  } as const;

  let removedCount = 0;
  while (complexity > cap) {
    let removed = false;
    for (const priority of FLAG_GENERATOR_CONFIG.complexityRemovalOrder) {
      const result = removers[priority](draft);
      if (!result) continue;
      const nextComplexity = adapter.complexity(result.draft);
      if (!Number.isFinite(nextComplexity) || nextComplexity < 0 || nextComplexity >= complexity) {
        throw new Error(`complexity reduction "${priority}" did not reduce the measured cost`);
      }
      draft = result.draft;
      complexity = nextComplexity;
      removed = true;
      removedCount += 1;
      break;
    }
    if (!removed) {
      throw new FlagGenerationAttemptError('S5_COMPLEXITY', `complexity ${complexity} exceeds CMAX ${cap}; no removable optional layer remains`);
    }
    if (removedCount > FLAG_GENERATOR_CONFIG.maxOptionalLayerRemovals) {
      throw new FlagGenerationAttemptError('S5_COMPLEXITY', 'complexity pruning exceeded the configured layer limit');
    }
  }
  return draft;
}

export interface FlagGeometryRepairAdapter<Draft> {
  isSafe(draft: Draft): boolean;
  /** Return charge ids in stable painter/source order. */
  chargeIds(draft: Draft): readonly string[];
  scaleCharge(draft: Draft, id: string, scale: number): Draft;
  moveChargeToNearestAllowedPoint(draft: Draft, id: string): Draft | null;
  /** Return repeat ids in stable painter/source order. */
  repeaterIds(draft: Draft): readonly string[];
  increaseRepeatStep(draft: Draft, id: string, scale: number): Draft | null;
  /** Remove the last remaining repeater, or then the last optional charge. */
  removeLastRepeaterOrCharge(draft: Draft): { draft: Draft; id: string } | null;
}

/** Apply the S7 repair sequence with the exact configured factors and bounds. */
export function repairFlagGeometry<Draft>(
  input: Draft,
  adapter: FlagGeometryRepairAdapter<Draft>,
): Draft {
  let draft = input;
  if (adapter.isSafe(draft)) return draft;
  const { geometryRepair } = FLAG_GENERATOR_CONFIG;
  const distinct = (ids: readonly string[], what: string) => {
    if (new Set(ids).size !== ids.length) throw new TypeError(`${what} ids must be unique and ordered`);
    return [...ids];
  };

  for (const step of geometryRepair.order) {
    if (step === 'shrink-charge') {
      for (const id of distinct(adapter.chargeIds(draft), 'charge')) {
        for (let attempt = 0; attempt < geometryRepair.chargeScaleAttempts; attempt += 1) {
          draft = adapter.scaleCharge(draft, id, geometryRepair.chargeScale);
          if (adapter.isSafe(draft)) return draft;
        }
      }
    } else if (step === 'move-to-nearest-safe-point') {
      for (const id of distinct(adapter.chargeIds(draft), 'charge')) {
        draft = adapter.moveChargeToNearestAllowedPoint(draft, id) ?? draft;
        if (adapter.isSafe(draft)) return draft;
      }
    } else if (step === 'expand-repeat-step') {
      for (const id of distinct(adapter.repeaterIds(draft), 'repeater')) {
        draft = adapter.increaseRepeatStep(draft, id, geometryRepair.repeatStepScale) ?? draft;
        if (adapter.isSafe(draft)) return draft;
      }
    } else {
      const removedIds = new Set<string>();
      for (let attempt = 0; attempt < FLAG_GENERATOR_CONFIG.maxOptionalLayerRemovals; attempt += 1) {
        const removal = adapter.removeLastRepeaterOrCharge(draft);
        if (!removal) break;
        if (removedIds.has(removal.id)) throw new Error(`geometry repair removed duplicate layer id "${removal.id}"`);
        removedIds.add(removal.id);
        draft = removal.draft;
        if (adapter.isSafe(draft)) return draft;
      }
    }
  }
  throw new FlagGenerationAttemptError('S7_GEOMETRY', 'geometry remained outside the permitted safe area after all repairs');
}

function passed(check: FlagGenerationCheck): boolean {
  return typeof check === 'boolean' ? check : check.passed;
}

function reason(check: FlagGenerationCheck): string | undefined {
  return typeof check === 'boolean' ? undefined : check.reason;
}

function makeContext(
  seed: string | number,
  attempt: number,
  excludedOptionalLayerIds: string[],
  stats: FlagGenerationStats,
): FlagGenerationContext {
  return {
    seed,
    attempt,
    excludedOptionalLayerIds,
    stats,
    random: (stage) => flagStageRandom(seed, stage, attempt),
  };
}

function recordRejection(
  stats: FlagGenerationStats,
  stage: string,
  detail: string | undefined,
  context: FlagGenerationContext,
  draft?: unknown,
): void {
  stats.rejected_attempts += 1;
  stats.rejection_reasons.push(detail ? `${stage}: ${detail}` : `${stage}: rejected`);
  if (stats.diagnostics.some((item) => item.attempt === context.attempt + 1)) return;
  const value = draft && typeof draft === 'object' ? draft as Record<string, unknown> : {};
  const profile = value.profile && typeof value.profile === 'object'
    ? value.profile as Record<string, unknown> : {};
  stats.diagnostics.push({
    attempt: context.attempt + 1,
    stage,
    code: 'GEN',
    measured: null,
    threshold: null,
    layerId: null,
    layerIds: [],
    operator: typeof value.fieldOperator === 'string' ? value.fieldOperator : null,
    module: null,
    profileId: typeof profile.id === 'string' ? profile.id : null,
    details: detail ? [detail] : ['Кандидат отклонён на стадии генерации'],
  });
}

/**
 * Run S1–S10 in fixed order. The formal V01–V16 and novelty policies are
 * supplied by later modules; this function owns stage isolation, retries,
 * deterministic optional-layer removal, fallback, and output statistics.
 */
export function generateFlag<Draft>(
  seed: string | number,
  hooks: FlagGenerationHooks<Draft>,
  options: GenerateFlagOptions = {},
): FlagGenerationResult {
  const attemptsMax = options.attempts_max ?? FLAG_GENERATOR_CONFIG.attemptsMax;
  if (!Number.isSafeInteger(attemptsMax) || attemptsMax < 1) {
    throw new RangeError('attempts_max must be a positive safe integer');
  }
  const version = options.generator_version ?? FLAG_GENERATOR_CONFIG.generatorVersion;
  if (!version) throw new TypeError('generator_version must not be empty');
  if (typeof seed === 'number' && !Number.isFinite(seed)) {
    throw new RangeError('flag generation seed must be a finite number or string');
  }

  const stats: FlagGenerationStats = {
    attempts: 0,
    rejected_attempts: 0,
    palette_attempts: 0,
    fallback_used: false,
    fallback_profile_id: null,
    optional_layers_removed: 0,
    small_layers_removed: 0,
    rejection_reasons: [],
    diagnostics: [],
    symmetry_downgrades: 0,
  };
  const measure = <T>(stage: FlagGenerationStage | 'render', operation: () => T): T => {
    const report = hooks.onStageTiming;
    if (!report) return operation();
    const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
    const startedAt = now();
    try {
      return operation();
    } finally {
      report(stage, now() - startedAt);
    }
  };
  const excludedOptionalLayerIds: string[] = [];
  const runAttempt = (fallback = false): { draft?: Draft; accepted: boolean } => {
    const attempt = stats.attempts;
    stats.attempts += 1;
    const context = makeContext(seed, attempt, excludedOptionalLayerIds, stats);
    let draft: Draft | undefined;
    try {
      draft = fallback
        ? measure('S1_FALLBACK', () => hooks.createFallback(FLAG_GENERATOR_CONFIG.fallbackProfileId, context))
        : measure('S1_PROFILE', () => hooks.selectProfile(context));
      draft = measure('S2_OUTLINE', () => hooks.selectOutline(draft!, context));
      draft = measure('S3_STYLE', () => hooks.selectStyleAndComplexity(draft!, context));
      draft = measure('S4_COMPOSITION', () => hooks.compose(draft!, context));
      draft = measure('S5_COMPLEXITY', () => hooks.enforceComplexityBudget(draft!, context));
      draft = measure('S6_PALETTE', () => hooks.solvePalette(draft!, context));
      draft = measure('S7_GEOMETRY', () => hooks.repairGeometry(draft!, context));
      const validation = measure('S8_VALIDATION', () => hooks.validate(draft!, context));
      if (!passed(validation)) {
        recordRejection(stats, 'S8_VALIDATION', reason(validation), context, draft);
        return { draft, accepted: false };
      }
      if (!fallback && hooks.checkNovelty) {
        const novelty = measure('S9_NOVELTY', () => hooks.checkNovelty!(draft!, context));
        if (!passed(novelty)) {
          recordRejection(stats, 'S9_NOVELTY', reason(novelty), context, draft);
          return { draft, accepted: false };
        }
      }
    } catch (error) {
      // Candidate-level infeasibility is a rejected attempt; programming errors
      // should be surfaced by throwing from a hook only when unrecoverable.
      if (!(error instanceof FlagGenerationAttemptError)) throw error;
      recordRejection(stats, error.stage, error.message, context, draft);
      return { draft, accepted: false };
    }

    return { draft, accepted: true };
  };

  let acceptedDraft: Draft | undefined;
  let removalSource: Draft | undefined;
  while (!acceptedDraft) {
    for (let attempt = 0; attempt < attemptsMax; attempt += 1) {
      const result = runAttempt();
      if (result.accepted) {
        acceptedDraft = result.draft;
        break;
      }
      removalSource = result.draft ?? removalSource;
    }
    if (acceptedDraft) break;
    if (!removalSource) break;
    if (stats.optional_layers_removed >= FLAG_GENERATOR_CONFIG.maxOptionalLayerRemovals) break;

    const context = makeContext(seed, stats.attempts, excludedOptionalLayerIds, stats);
    const removedId = hooks.removeLastOptionalLayer(removalSource, context);
    if (!removedId) break;
    if (excludedOptionalLayerIds.includes(removedId)) {
      throw new Error(`optional-layer removal returned duplicate id "${removedId}"`);
    }
    excludedOptionalLayerIds.push(removedId);
    stats.optional_layers_removed += 1;
  }

  if (!acceptedDraft) {
    stats.fallback_used = true;
    stats.fallback_profile_id = FLAG_GENERATOR_CONFIG.fallbackProfileId;
    for (let fallbackAttempt = 0; fallbackAttempt < FLAG_GENERATOR_CONFIG.fallbackAttemptsMax; fallbackAttempt += 1) {
      const result = runAttempt(true);
      if (result.accepted) {
        acceptedDraft = result.draft;
        break;
      }
    }
    if (!acceptedDraft) {
      const reasons = stats.rejection_reasons.slice(-FLAG_GENERATOR_CONFIG.fallbackAttemptsMax);
      throw new Error(`P28 fallback failed the configured generation validation; no flag was returned. ${reasons.join(' | ')}`);
    }
  }

  const finalContext = makeContext(seed, Math.max(0, stats.attempts - 1), excludedOptionalLayerIds, stats);
  if (acceptedDraft === undefined) throw new Error('flag generation ended without an accepted candidate.');
  const flag = measure('S10_OUTPUT', () => {
    const output = hooks.buildFlagSpec(acceptedDraft!, finalContext);
    output.generator_version = version;
    output.seed = seed;
    output.meta.generation_stats = {
      attempts: stats.attempts,
      rejected_attempts: stats.rejected_attempts,
      palette_attempts: stats.palette_attempts,
      fallback_used: stats.fallback_used,
      fallback_profile_id: stats.fallback_profile_id,
      optional_layers_removed: stats.optional_layers_removed,
      small_layers_removed: stats.small_layers_removed,
      rejection_reasons: [...stats.rejection_reasons],
      symmetry_downgrades: stats.symmetry_downgrades,
      diagnostics: stats.diagnostics as unknown as import('./flagSpec').JsonObject[],
    };
    stampFlagHashes(output);
    assertValidFlagSpec(output);
    return output;
  });
  const svg = hooks.render ? measure('render', () => hooks.render!(flag)) : undefined;
  return {
    flag,
    ...(svg !== undefined ? { svg } : {}),
    stats: {
      ...stats,
      rejection_reasons: [...stats.rejection_reasons],
      diagnostics: stats.diagnostics.map((item) => ({ ...item, layerIds: [...item.layerIds], details: [...item.details] })),
    },
  };
}

/** Expected infeasibility signal for a single sampled candidate. */
export class FlagGenerationAttemptError extends Error {
  constructor(readonly stage: FlagGenerationStage, message: string) {
    super(message);
    this.name = 'FlagGenerationAttemptError';
  }
}
