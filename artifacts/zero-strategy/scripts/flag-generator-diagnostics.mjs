import { generateProfiledFlag } from '../game/flagProfiledGenerator.js';

const args = process.argv.slice(2).filter((argument) => argument !== '--');
const noInstrumentation = args.includes('--no-instrumentation');
const positionalArgs = args.filter((argument) => argument !== '--no-instrumentation');
const profileId = positionalArgs[0] ?? 'P04';
const firstSeed = Number(positionalArgs[1] ?? 1000);
const seedCount = Number(positionalArgs[2] ?? 1);
const era = Number(positionalArgs[3] ?? 2);
if (!Number.isInteger(firstSeed) || !Number.isInteger(seedCount) || seedCount < 1 ||
    !Number.isInteger(era) || era < 0 || era > 6) {
  throw new RangeError('Ожидаются профиль, начальное целое зерно, положительное число зерён и эпоха от 0 до 6');
}

const totals = new Map();
const candidates = [];
for (let offset = 0; offset < seedCount; offset += 1) {
  const seed = firstSeed + offset;
  const stageTimings = {};
  const validationRuleTimings = {};
  const startedAt = performance.now();
  const options = {
    seed,
    profileId,
    era,
  };
  if (!noInstrumentation) {
    options.onStageTiming = (stage, durationMs) => {
      stageTimings[stage] = (stageTimings[stage] ?? 0) + durationMs;
    };
    options.onValidationRuleTiming = (rule, durationMs, section = rule) => {
      validationRuleTimings[section] = (validationRuleTimings[section] ?? 0) + durationMs;
    };
  }
  const result = generateProfiledFlag(options);
  candidates.push({
    seed,
    elapsed_ms: Number((performance.now() - startedAt).toFixed(2)),
    stage_timings_ms: Object.fromEntries(Object.entries(stageTimings)
      .map(([stage, duration]) => [stage, Number(duration.toFixed(2))])),
    validation_rule_timings_ms: Object.fromEntries(Object.entries(validationRuleTimings)
      .map(([rule, duration]) => [rule, Number(duration.toFixed(2))])),
    attempts: result.stats.attempts,
    rejected_attempts: result.stats.rejected_attempts,
    fallback_used: result.stats.fallback_used,
    fallback_profile_id: result.stats.fallback_profile_id,
    diagnostics: result.stats.diagnostics ?? [],
  });
  for (const diagnostic of result.stats.diagnostics ?? []) {
    const key = [diagnostic.code, diagnostic.operator ?? '—', diagnostic.module ?? '—'].join(' × ');
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
}

console.log(JSON.stringify({
  profile: profileId,
  era,
  first_seed: firstSeed,
  seed_count: seedCount,
  candidates,
  diagnostic_table: [...totals.entries()]
    .map(([key, count]) => ({ category: key, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'ru')),
}, null, 2));
