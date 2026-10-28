import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FLAG_PROFILE_CONFIG } from '../game/flagProfileConfig.js';
import { generateProfiledFlag } from '../game/flagProfiledGenerator.js';

const profiles = FLAG_PROFILE_CONFIG.filter(({ id }) => /^P\d{2}$/.test(id));
const ablationProtocol = 'В FIELD_ONLY при выбранном G01 применяется доступный многосекционный оператор профиля; если такого оператора нет, сохраняется исходное поле и фиксируется несовместимость с минимальным K. В остальных режимах базовый ординарий выбирается из настроенных не-O07; если их нет, используется тестовый O01. Для C/D чётные seed получают один настроенный O07, если он есть; иначе применяется фимбриация. Это расписание покрытия, а не вероятность игровой генерации.';
const scenarios = [
  ['FIELD_ONLY', 'поле без дополнительных элементов'],
  ['FIELD_ONE_ORDINARY', 'поле и один ординарий'],
  ['FIELD_ONE_ORDINARY_BORDURE', 'поле, один ординарий и бордюр/фимбриация'],
  ['FIELD_ONE_ORDINARY_BORDURE_ONE_CHARGE', 'поле, один ординарий, бордюр/фимбриация и одна группа зарядов'],
];

function addCount(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

function addMap(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) addCount(target, key, value);
}

function splitElements(value) {
  return typeof value === 'string'
    ? value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean)
    : [];
}

function candidateFailureKey(diagnostic, profileId, seed) {
  const firstDetail = diagnostic.details?.[0] ?? '';
  const retryContext = firstDetail.match(/S4\.[1-3], локальная попытка \d+/)?.[0] ?? '';
  return [profileId, seed, diagnostic.attempt, diagnostic.stage, retryContext].join('|');
}

function collectDiagnostic(report, diagnostic, profileId, seed) {
  const operators = splitElements(diagnostic.operator);
  const modules = splitElements(diagnostic.module);
  const key = candidateFailureKey(diagnostic, profileId, seed);
  let failure = report.failureEvents.get(key);
  if (!failure) {
    failure = {
      codes: new Set(),
      operators: new Set(),
      modules: new Set(),
      codeOperators: new Set(),
      codeModules: new Set(),
    };
    report.failureEvents.set(key, failure);
  }
  if (!failure.codes.has(diagnostic.code)) {
    failure.codes.add(diagnostic.code);
    addCount(report.by_code, diagnostic.code);
    if (report.by_profile_and_code) {
      addCount(report.by_profile_and_code, `${profileId}:${diagnostic.code}`);
    }
  }
  for (const operator of operators) {
    if (!failure.operators.has(operator)) {
      failure.operators.add(operator);
      addCount(report.by_operator, operator);
    }
    const pair = `${diagnostic.code}:${operator}`;
    if (!failure.codeOperators.has(pair)) {
      failure.codeOperators.add(pair);
      addCount(report.by_code_and_operator, pair);
    }
  }
  for (const module of modules) {
    if (!failure.modules.has(module)) {
      failure.modules.add(module);
      addCount(report.by_module, module);
    }
    const pair = `${diagnostic.code}:${module}`;
    if (!failure.codeModules.has(pair)) {
      failure.codeModules.add(pair);
      addCount(report.by_code_and_module, pair);
    }
  }
  report.diagnostic_row_count += 1;
}

function collectException(report, profileId, seed) {
  const key = `${profileId}|${seed}|exception`;
  let failure = report.failureEvents.get(key);
  if (!failure) {
    failure = {
      codes: new Set(),
      operators: new Set(),
      modules: new Set(),
      codeOperators: new Set(),
      codeModules: new Set(),
    };
    report.failureEvents.set(key, failure);
  }
  if (!failure.codes.has('EXCEPTION')) {
    failure.codes.add('EXCEPTION');
    addCount(report.by_code, 'EXCEPTION');
    if (report.by_profile_and_code) addCount(report.by_profile_and_code, `${profileId}:EXCEPTION`);
  }
}

function createScenarioReport() {
  return {
    sample_count: 0,
    valid_count: 0,
    fallback_count: 0,
    attempts_total: 0,
    exception_count: 0,
    diagnostic_row_count: 0,
    by_code: {},
    by_profile_and_code: {},
    by_operator: {},
    by_module: {},
    by_code_and_operator: {},
    by_code_and_module: {},
    failureEvents: new Map(),
    fieldOnlyPaletteIncompatibilities: new Set(),
    profiles: {},
    errors: [],
  };
}

function finalizeScenario(report) {
  const totalFailures = report.failureEvents.size;
  const operatorFailures = {};
  const moduleFailures = {};
  for (const failure of report.failureEvents.values()) {
    failure.operators.forEach((operator) => addCount(operatorFailures, operator));
    failure.modules.forEach((module) => addCount(moduleFailures, module));
  }
  const elementFailureShare = (counts) => Object.fromEntries(
    Object.entries(counts)
      .map(([element, failures]) => [element, {
        failure_events: failures,
        total_failure_events: totalFailures,
        share: totalFailures ? failures / totalFailures : 0,
        exceeds_10_percent: totalFailures > 0 && failures / totalFailures > 0.1,
      }])
      .sort((left, right) => right[1].share - left[1].share),
  );
  const profilesResult = Object.fromEntries(Object.entries(report.profiles).map(([profileId, stats]) => {
    const failures = stats.failureEvents.size;
    const operatorFailuresForProfile = {};
    const moduleFailuresForProfile = {};
    for (const failure of stats.failureEvents.values()) {
      failure.operators.forEach((operator) => addCount(operatorFailuresForProfile, operator));
      failure.modules.forEach((module) => addCount(moduleFailuresForProfile, module));
    }
    return [profileId, {
      sample_count: stats.sample_count,
      valid_count: stats.valid_count,
      fallback_count: stats.fallback_count,
      exception_count: stats.exception_count,
      attempts_total: stats.attempts_total,
      diagnostic_failure_events: failures,
      by_code: stats.by_code,
      by_operator: stats.by_operator,
      by_module: stats.by_module,
      by_code_and_operator: stats.by_code_and_operator,
      by_code_and_module: stats.by_code_and_module,
      diagnostic_row_count: stats.diagnostic_row_count,
      operator_failure_share: elementFailureShareForProfile(operatorFailuresForProfile, failures),
      module_failure_share: elementFailureShareForProfile(moduleFailuresForProfile, failures),
      errors: stats.errors,
    }];
  }));
  return {
    sample_count: report.sample_count,
    valid_count: report.valid_count,
    invalid_count: report.sample_count - report.valid_count,
    fallback_count: report.fallback_count,
    fallback_rate: report.valid_count ? report.fallback_count / report.valid_count : null,
    attempts_total: report.attempts_total,
    mean_attempts: report.valid_count ? report.attempts_total / report.valid_count : null,
    exception_count: report.exception_count,
    diagnostic_row_count: report.diagnostic_row_count,
    diagnostic_failure_events: totalFailures,
    field_only_palette_incompatibility_count: report.fieldOnlyPaletteIncompatibilities.size,
    field_only_palette_incompatibility_seeds: [...report.fieldOnlyPaletteIncompatibilities].sort(),
    by_code: report.by_code,
    by_profile_and_code: report.by_profile_and_code,
    by_operator: report.by_operator,
    by_module: report.by_module,
    by_code_and_operator: report.by_code_and_operator,
    by_code_and_module: report.by_code_and_module,
    operator_failure_share: elementFailureShare(operatorFailures),
    module_failure_share: elementFailureShare(moduleFailures),
    profiles: profilesResult,
    errors: report.errors,
  };
}

function elementFailureShareForProfile(counts, totalFailures) {
  return Object.fromEntries(
    Object.entries(counts)
      .map(([element, failures]) => [element, {
        failure_events: failures,
        total_failure_events: totalFailures,
        share: totalFailures ? failures / totalFailures : 0,
        exceeds_10_percent: totalFailures > 0 && failures / totalFailures > 0.1,
      }])
      .sort((left, right) => right[1].share - left[1].share),
  );
}

function runRange({ profileStart, profileCount, samplesPerProfile, firstSeed, diagnosticsLogPath }) {
  const startedAt = performance.now();
  const results = Object.fromEntries(scenarios.map(([id]) => [id, createScenarioReport()]));
  const diagnosticsFd = fs.openSync(diagnosticsLogPath, 'w');
  let diagnosticsBuffer = [];
  const writeDiagnostic = (record) => {
    diagnosticsBuffer.push(JSON.stringify(record));
    if (diagnosticsBuffer.length >= 500) {
      fs.writeSync(diagnosticsFd, `${diagnosticsBuffer.join('\n')}\n`);
      diagnosticsBuffer = [];
    }
  };
  try {
    for (const [scenarioId] of scenarios) {
    const scenarioReport = results[scenarioId];
    for (let profileIndex = profileStart; profileIndex < profileStart + profileCount; profileIndex += 1) {
      const profile = profiles[profileIndex];
      if (!profile) throw new RangeError(`Индекс профиля вне диапазона: ${profileIndex}`);
      const profileStats = {
        sample_count: 0,
        valid_count: 0,
        fallback_count: 0,
        attempts_total: 0,
        exception_count: 0,
        diagnostic_row_count: 0,
        by_code: {},
        by_operator: {},
        by_module: {},
        by_code_and_operator: {},
        by_code_and_module: {},
        failureEvents: new Map(),
        errors: [],
      };
      scenarioReport.profiles[profile.id] = profileStats;
      for (let occurrence = 0; occurrence < samplesPerProfile; occurrence += 1) {
        const seed = firstSeed + occurrence;
        const era = profile.eras[occurrence % profile.eras.length];
        scenarioReport.sample_count += 1;
        profileStats.sample_count += 1;
        try {
          const result = generateProfiledFlag({
            seed,
            profileId: profile.id,
            era,
            ablationScenario: scenarioId,
          });
          scenarioReport.valid_count += 1;
          profileStats.valid_count += 1;
          scenarioReport.attempts_total += result.stats.attempts;
          profileStats.attempts_total += result.stats.attempts;
          if (result.stats.fallback_used) {
            scenarioReport.fallback_count += 1;
            profileStats.fallback_count += 1;
          }
          for (const diagnostic of result.stats.diagnostics) {
            if (
              scenarioId === 'FIELD_ONLY' &&
              diagnostic.code === 'GEN' &&
              diagnostic.stage === 'S6_PALETTE' &&
              (diagnostic.details ?? []).some((detail) => /объединённых групп 1/.test(detail))
            ) {
              scenarioReport.fieldOnlyPaletteIncompatibilities.add(`${profile.id}:${seed}`);
            }
            collectDiagnostic(scenarioReport, diagnostic, profile.id, seed);
            collectDiagnostic(profileStats, diagnostic, profile.id, seed);
            writeDiagnostic({
              scenario_id: scenarioId,
              profile_id: profile.id,
              seed,
              era,
              diagnostic,
            });
          }
        } catch (error) {
          scenarioReport.exception_count += 1;
          profileStats.exception_count += 1;
          collectException(scenarioReport, profile.id, seed);
          collectException(profileStats, profile.id, seed);
          const details = {
            profile_id: profile.id,
            seed,
            era,
            message: error instanceof Error ? error.message : String(error),
          };
          if (scenarioReport.errors.length < 50) scenarioReport.errors.push(details);
          if (profileStats.errors.length < 20) profileStats.errors.push(details);
          writeDiagnostic({ scenario_id: scenarioId, ...details, kind: 'exception' });
        }
      }
    }
    }
  } finally {
    if (diagnosticsBuffer.length) fs.writeSync(diagnosticsFd, `${diagnosticsBuffer.join('\n')}\n`);
    fs.closeSync(diagnosticsFd);
  }
  return {
    protocol: ablationProtocol,
    diagnostics_log: diagnosticsLogPath,
    profile_start: profileStart,
    profile_count: profileCount,
    samples_per_profile: samplesPerProfile,
    first_seed: firstSeed,
    elapsed_ms: Number((performance.now() - startedAt).toFixed(2)),
    scenarios: Object.fromEntries(Object.entries(results).map(([id, report]) => [
      id,
      finalizeScenario(report),
    ])),
  };
}

const args = process.argv.slice(2).filter((argument) => argument !== '--');
if (args[0] === '--merge') {
  const outputPath = path.resolve(args[1] ?? 'generated-artifacts/flags/ablation-128000.json');
  const inputs = args.slice(2);
  if (!inputs.length) throw new Error('Для объединения укажите файлы отдельных диапазонов.');
  const reports = inputs.map((filePath) => JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')));
  const scenariosResult = Object.fromEntries(scenarios.map(([scenarioId]) => {
    const parts = reports.map((report) => report.scenarios[scenarioId]);
    const sampleCount = parts.reduce((sum, part) => sum + part.sample_count, 0);
    const validCount = parts.reduce((sum, part) => sum + part.valid_count, 0);
    const attemptsTotal = parts.reduce((sum, part) => sum + part.attempts_total, 0);
    const fallbackCount = parts.reduce((sum, part) => sum + part.fallback_count, 0);
    const byCode = {};
    const byProfileAndCode = {};
    const byOperator = {};
    const byModule = {};
    const byCodeAndOperator = {};
    const byCodeAndModule = {};
    const profileEntries = new Map();
    let diagnosticRowCount = 0;
    for (const part of parts) {
      addMap(byCode, part.by_code);
      addMap(byProfileAndCode, part.by_profile_and_code);
      addMap(byOperator, part.by_operator);
      addMap(byModule, part.by_module);
      addMap(byCodeAndOperator, part.by_code_and_operator);
      addMap(byCodeAndModule, part.by_code_and_module);
      diagnosticRowCount += part.diagnostic_row_count;
      for (const [profileId, stats] of Object.entries(part.profiles)) {
        const target = profileEntries.get(profileId) ?? {
          sample_count: 0,
          valid_count: 0,
          fallback_count: 0,
          attempts_total: 0,
          exception_count: 0,
          diagnostic_failure_events: 0,
          diagnostic_row_count: 0,
          by_code: {},
          by_operator: {},
          by_module: {},
          by_code_and_operator: {},
          by_code_and_module: {},
          operatorEventCounts: {},
          moduleEventCounts: {},
          errors: [],
        };
        target.sample_count += stats.sample_count;
        target.valid_count += stats.valid_count;
        target.fallback_count += stats.fallback_count;
        target.attempts_total += stats.attempts_total;
        target.exception_count += stats.exception_count;
        target.diagnostic_failure_events += stats.diagnostic_failure_events;
        target.diagnostic_row_count += stats.diagnostic_row_count;
        addMap(target.by_code, stats.by_code);
        addMap(target.by_operator, stats.by_operator);
        addMap(target.by_module, stats.by_module);
        addMap(target.by_code_and_operator, stats.by_code_and_operator);
        addMap(target.by_code_and_module, stats.by_code_and_module);
        for (const [name, item] of Object.entries(stats.operator_failure_share)) {
          addCount(target.operatorEventCounts, name, item.failure_events);
        }
        for (const [name, item] of Object.entries(stats.module_failure_share)) {
          addCount(target.moduleEventCounts, name, item.failure_events);
        }
        target.errors.push(...stats.errors);
        profileEntries.set(profileId, target);
      }
    }
    const allEventCount = parts.reduce((sum, part) => sum + part.diagnostic_failure_events, 0);
    const fieldOnlyPaletteIncompatibilitySeeds = [...new Set(parts.flatMap(
      (part) => part.field_only_palette_incompatibility_seeds ?? [],
    ))].sort();
    const operatorEventCounts = {};
    const moduleEventCounts = {};
    for (const part of parts) {
      for (const [name, item] of Object.entries(part.operator_failure_share)) {
        addCount(operatorEventCounts, name, item.failure_events);
      }
      for (const [name, item] of Object.entries(part.module_failure_share)) {
        addCount(moduleEventCounts, name, item.failure_events);
      }
    }
    const shares = (counts) => Object.fromEntries(Object.entries(counts)
      .map(([name, count]) => [name, {
        failure_events: count,
        total_failure_events: allEventCount,
        share: allEventCount ? count / allEventCount : 0,
        exceeds_10_percent: allEventCount > 0 && count / allEventCount > 0.1,
      }])
      .sort((left, right) => right[1].share - left[1].share));
    return [scenarioId, {
      sample_count: sampleCount,
      valid_count: validCount,
      invalid_count: sampleCount - validCount,
      fallback_count: fallbackCount,
      fallback_rate: validCount ? fallbackCount / validCount : null,
      attempts_total: attemptsTotal,
      mean_attempts: validCount ? attemptsTotal / validCount : null,
      exception_count: parts.reduce((sum, part) => sum + part.exception_count, 0),
      diagnostic_row_count: diagnosticRowCount,
      diagnostic_failure_events: allEventCount,
      field_only_palette_incompatibility_count: fieldOnlyPaletteIncompatibilitySeeds.length,
      field_only_palette_incompatibility_seeds: fieldOnlyPaletteIncompatibilitySeeds,
      by_code: byCode,
      by_profile_and_code: byProfileAndCode,
      by_operator: byOperator,
      by_module: byModule,
      by_code_and_operator: byCodeAndOperator,
      by_code_and_module: byCodeAndModule,
      operator_failure_share: shares(operatorEventCounts),
      module_failure_share: shares(moduleEventCounts),
      profiles: Object.fromEntries([...profileEntries].map(([profileId, stats]) => [profileId, {
        sample_count: stats.sample_count,
        valid_count: stats.valid_count,
        fallback_count: stats.fallback_count,
        exception_count: stats.exception_count,
        diagnostic_row_count: stats.diagnostic_row_count,
        diagnostic_failure_events: stats.diagnostic_failure_events,
        mean_attempts: stats.valid_count ? stats.attempts_total / stats.valid_count : null,
        by_code: stats.by_code,
        by_operator: stats.by_operator,
        by_module: stats.by_module,
        by_code_and_operator: stats.by_code_and_operator,
        by_code_and_module: stats.by_code_and_module,
        operator_failure_share: elementFailureShareForProfile(
          stats.operatorEventCounts,
          stats.diagnostic_failure_events,
        ),
        module_failure_share: elementFailureShareForProfile(
          stats.moduleEventCounts,
          stats.diagnostic_failure_events,
        ),
        errors: stats.errors.slice(0, 50),
      }])),
      errors: parts.flatMap((part) => part.errors).slice(0, 200),
    }];
  }));
  const summary = {
    protocol: ablationProtocol,
    diagnostics_logs: reports.map(({ diagnostics_log }) => diagnostics_log),
    sample_count: reports.reduce((sum, report) => sum + report.profile_count * report.samples_per_profile * scenarios.length, 0),
    scenarios: scenariosResult,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: outputPath, ...summary }, null, 2));
} else {
  const profileStart = Number(args[0] ?? 0);
  const profileCount = Number(args[1] ?? profiles.length);
  const samplesPerProfile = Number(args[2] ?? 1000);
  const firstSeed = Number(args[3] ?? 1000);
  const outputPath = path.resolve(args[4] ?? `generated-artifacts/flags/ablation-${profileStart}-${profileCount}.json`);
  const diagnosticsLogPath = outputPath.replace(/\.json$/i, '.diagnostics.jsonl');
  if (!Number.isInteger(profileStart) || profileStart < 0 ||
      !Number.isInteger(profileCount) || profileCount < 1 ||
      profileStart + profileCount > profiles.length ||
      !Number.isInteger(samplesPerProfile) || samplesPerProfile < 1 ||
      !Number.isInteger(firstSeed)) {
    throw new RangeError('Ожидаются корректные границы профилей, число seed на профиль и начальный seed.');
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const report = runRange({
    profileStart,
    profileCount,
    samplesPerProfile,
    firstSeed,
    diagnosticsLogPath,
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(report)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: outputPath,
    diagnostics_log: report.diagnostics_log,
    profile_start: report.profile_start,
    profile_count: report.profile_count,
    samples_per_profile: report.samples_per_profile,
    elapsed_ms: report.elapsed_ms,
    scenarios: Object.fromEntries(Object.entries(report.scenarios).map(([id, scenario]) => [
      id,
      {
        sample_count: scenario.sample_count,
        valid_count: scenario.valid_count,
        invalid_count: scenario.invalid_count,
        fallback_count: scenario.fallback_count,
        diagnostic_failure_events: scenario.diagnostic_failure_events,
      },
    ])),
  }, null, 2));
}
