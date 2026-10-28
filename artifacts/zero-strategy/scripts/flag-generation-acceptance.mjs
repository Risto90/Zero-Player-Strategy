import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describeFlagNovelty } from '../game/flagNovelty.js';
import { FLAG_NOVELTY_CONFIG } from '../game/flagNoveltyConfig.js';
import { FLAG_PROFILE_CONFIG } from '../game/flagProfileConfig.js';
import { generateProfiledFlag } from '../game/flagProfiledGenerator.js';
import { assertValidFlagSpec } from '../game/flagSpec.js';

const profiles = FLAG_PROFILE_CONFIG.filter(({ id }) => /^P\d{2}$/.test(id));
if (profiles.length !== 32) {
  throw new Error(`Ожидалось 32 основных профиля P01–P32; найдено ${profiles.length}.`);
}

function summarizeDurations(values) {
  if (!values.length) {
    return { sample_count: 0, median_ms: null, mean_ms: null, p90_ms: null, maximum_ms: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    sample_count: sorted.length,
    median_ms: percentile(0.5),
    mean_ms: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p90_ms: percentile(0.9),
    maximum_ms: sorted.at(-1),
  };
}

class FlagGenerationAcceptance {
  constructor({ profileStart, profileCount, samplesPerProfile, firstSeed }) {
    this.profileStart = profileStart;
    this.profileCount = profileCount;
    this.samplesPerProfile = samplesPerProfile;
    this.firstSeed = firstSeed;
    this.startedAt = performance.now();
    this.validCount = 0;
    this.fallbackCount = 0;
    this.attemptsTotal = 0;
    this.errors = [];
    this.structureHashes = [];
    this.visualHashes = [];
    this.categoryCounts = new Map([
      ['profile', new Map()],
      ['outline', new Map()],
      ['field_operator', new Map()],
      ['module_family', new Map()],
      ['color_count', new Map()],
    ]);
    this.profileStats = new Map();
  }

  static summarizeCounts(counts) {
    return Object.fromEntries(counts);
  }

  static normalizedEntropy(counts, maximumCategories) {
    const values = Object.values(counts);
    const sampleCount = values.reduce((sum, count) => sum + count, 0);
    if (sampleCount <= 1 || maximumCategories <= 1) {
      return { value: 0, categories: values.filter((count) => count > 0).length };
    }
    const entropy = -values.reduce((sum, count) => {
      if (count === 0) return sum;
      const probability = count / sampleCount;
      return sum + probability * Math.log(probability);
    }, 0);
    return {
      value: entropy / Math.log(maximumCategories),
      categories: values.filter((count) => count > 0).length,
    };
  }

  addCategory(name, value) {
    const counts = this.categoryCounts.get(name);
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  run() {
    for (let profileIndex = this.profileStart;
      profileIndex < this.profileStart + this.profileCount;
      profileIndex += 1) {
      const profile = profiles[profileIndex];
      if (!profile) throw new RangeError(`Индекс профиля вне диапазона: ${profileIndex}`);
      const profileStats = {
        sample_count: 0,
        fallback_count: 0,
        attempts_total: 0,
        generation_durations_ms: [],
        first_1000_structure_hashes: [],
      };
      this.profileStats.set(profile.id, profileStats);

      for (let occurrence = 0; occurrence < this.samplesPerProfile; occurrence += 1) {
        const seed = this.firstSeed + profileIndex + occurrence * profiles.length;
        const era = profile.eras[occurrence % profile.eras.length];
        profileStats.sample_count += 1;
        try {
          const startedAt = performance.now();
          let result;
          try {
            result = generateProfiledFlag({ seed, profileId: profile.id, era });
          } finally {
            profileStats.generation_durations_ms.push(
              Number((performance.now() - startedAt).toFixed(3)),
            );
          }
          assertValidFlagSpec(result.flag);
          assert.equal(result.flag.seed, seed, 'Сгенерированный флаг должен сохранить seed');
          assert.equal(result.flag.era, era, 'Сгенерированный флаг должен сохранить эпоху');
          assert.match(result.svg, /^<svg\b[\s\S]*<\/svg>$/, 'Рендер должен быть завершённым SVG');

          this.validCount += 1;
          this.attemptsTotal += result.stats.attempts;
          profileStats.attempts_total += result.stats.attempts;
          if (result.stats.fallback_used) {
            this.fallbackCount += 1;
            profileStats.fallback_count += 1;
          }

          const descriptor = describeFlagNovelty(result.flag);
          this.structureHashes.push(result.flag.meta.structure_hash);
          this.visualHashes.push(result.flag.meta.visual_hash);
          if (occurrence < 1000) {
            profileStats.first_1000_structure_hashes.push(result.flag.meta.structure_hash);
          }
          this.addCategory('profile', result.flag.profile_id);
          this.addCategory('outline', descriptor.outline_class);
          this.addCategory('field_operator', descriptor.field_operator);
          this.addCategory('module_family', descriptor.module_family);
          this.addCategory('color_count', result.flag.meta.color_count);
        } catch (error) {
          if (this.errors.length < 20) {
            this.errors.push({
              profile_id: profile.id,
              seed,
              era,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    const elapsedMs = performance.now() - this.startedAt;
    return {
      sample_count: this.profileCount * this.samplesPerProfile,
      valid_count: this.validCount,
      fallback_count: this.fallbackCount,
      attempts_total: this.attemptsTotal,
      elapsed_ms: Number(elapsedMs.toFixed(2)),
      category_counts: Object.fromEntries([...this.categoryCounts].map(([name, counts]) =>
        [name, FlagGenerationAcceptance.summarizeCounts(counts)])),
      structure_hashes: this.structureHashes,
      visual_hashes: this.visualHashes,
      profiles: Object.fromEntries(this.profileStats),
      errors: this.errors,
    };
  }
}

class FlagAcceptanceReport {
  static merge(reports) {
  const sampleCount = reports.reduce((sum, report) => sum + report.sample_count, 0);
  const validCount = reports.reduce((sum, report) => sum + report.valid_count, 0);
  const fallbackCount = reports.reduce((sum, report) => sum + report.fallback_count, 0);
  const attemptsTotal = reports.reduce((sum, report) => sum + report.attempts_total, 0);
  const categoryCounts = Object.fromEntries(
    ['profile', 'outline', 'field_operator', 'module_family', 'color_count']
      .map((category) => [category, {}]),
  );
  const profileStats = new Map();

  for (const report of reports) {
    for (const category of Object.keys(categoryCounts)) {
      for (const [key, count] of Object.entries(report.category_counts[category] ?? {})) {
        categoryCounts[category][key] = (categoryCounts[category][key] ?? 0) + count;
      }
    }
    for (const [profileId, stats] of Object.entries(report.profiles)) {
      const target = profileStats.get(profileId) ?? {
        sample_count: 0,
        fallback_count: 0,
        attempts_total: 0,
        generation_durations_ms: [],
        first_1000_structure_hashes: new Set(),
      };
      target.sample_count += stats.sample_count;
      target.fallback_count += stats.fallback_count;
      target.attempts_total += stats.attempts_total;
      target.generation_durations_ms.push(...(stats.generation_durations_ms ?? []));
      for (const hash of stats.first_1000_structure_hashes) {
        target.first_1000_structure_hashes.add(hash);
      }
      profileStats.set(profileId, target);
    }
  }

  const uniqueStructureHashes = new Set(reports.flatMap((report) => report.structure_hashes));
  const uniqueVisualHashes = new Set(reports.flatMap((report) => report.visual_hashes));
  const entropy = {
    profile: FlagGenerationAcceptance.normalizedEntropy(categoryCounts.profile, FLAG_PROFILE_CONFIG.length),
    outline: FlagGenerationAcceptance.normalizedEntropy(
      categoryCounts.outline,
      FLAG_NOVELTY_CONFIG.mapElites.outlineClasses.length,
    ),
    field_operator: FlagGenerationAcceptance.normalizedEntropy(categoryCounts.field_operator, 12),
    module_family: FlagGenerationAcceptance.normalizedEntropy(
      categoryCounts.module_family,
      FLAG_NOVELTY_CONFIG.metricCategories.moduleFamilies,
    ),
    color_count: FlagGenerationAcceptance.normalizedEntropy(
      categoryCounts.color_count,
      FLAG_NOVELTY_CONFIG.mapElites.colorCount[1] - FLAG_NOVELTY_CONFIG.mapElites.colorCount[0] + 1,
    ),
  };

  const reducedStructureProfiles = new Set(['NORDIC', 'SQUARE_NEUTRAL', 'MODERN_MINIMAL']);
  const perProfile = Object.fromEntries([...profileStats].map(([profileId, stats]) => {
    const profile = profiles.find(({ id }) => id === profileId);
    const paletteWeights = profile?.PAL?.weights ?? {};
    const hasReducedTarget = Object.keys(paletteWeights).some((name) => reducedStructureProfiles.has(name));
    const minimumUnique = hasReducedTarget ? 40 : 100;
    const uniqueStructuresFirst1000 = stats.first_1000_structure_hashes.size;
    return [profileId, {
      sample_count: stats.sample_count,
      fallback_count: stats.fallback_count,
      mean_attempts: stats.sample_count ? stats.attempts_total / stats.sample_count : null,
      generation_time_ms: summarizeDurations(stats.generation_durations_ms),
      unique_structure_hashes_first_1000: uniqueStructuresFirst1000,
      target_minimum_unique_structures: minimumUnique,
      target_passed: stats.sample_count >= 1000 && uniqueStructuresFirst1000 >= minimumUnique,
    }];
  }));

  const fallbackRate = validCount ? fallbackCount / validCount : null;
  const uniqueStructureRate = validCount ? uniqueStructureHashes.size / validCount : 0;
  const uniqueVisualRate = validCount ? uniqueVisualHashes.size / validCount : 0;
  const meanAttempts = validCount ? attemptsTotal / validCount : null;
  const generationTime = summarizeDurations(
    [...profileStats.values()].flatMap((stats) => stats.generation_durations_ms),
  );
  const performanceTargets = {
    user_mean_at_most_200ms: generationTime.mean_ms !== null && generationTime.mean_ms <= 200,
    original_spec_at_least_20_flags_per_second:
      generationTime.mean_ms !== null && generationTime.mean_ms <= 50,
  };
  const targets = {
    sample_count_exactly_100000: sampleCount === 100000,
    all_results_validated: validCount === sampleCount && reports.every(({ errors }) => errors.length === 0),
    mean_attempts_at_most_3: meanAttempts !== null && meanAttempts <= 3,
    fallback_at_most_2_percent: fallbackRate !== null && fallbackRate <= 0.02,
    unique_visual_hashes_at_least_95_percent: uniqueVisualRate >= 0.95,
    unique_structure_hashes_at_least_40_percent: uniqueStructureRate >= 0.4,
    profile_entropy_at_least_0_85: entropy.profile.value >= 0.85,
    field_operator_entropy_at_least_0_80: entropy.field_operator.value >= 0.8,
    module_family_entropy_at_least_0_80: entropy.module_family.value >= 0.8,
    color_count_entropy_at_least_0_70: entropy.color_count.value >= 0.7,
    outline_entropy_at_least_0_45: entropy.outline.value >= 0.45,
    per_profile_structure_thresholds: Object.values(perProfile).length === 32 &&
      Object.values(perProfile).every(({ target_passed }) => target_passed),
  };

  return {
    sample_count: sampleCount,
    valid_count: validCount,
    invalid_or_crashed_count: sampleCount - validCount,
    fallback_count: fallbackCount,
    fallback_rate: fallbackRate,
    attempts_total: attemptsTotal,
    mean_attempts: meanAttempts,
    unique_visual_hashes: uniqueVisualHashes.size,
    unique_visual_rate: uniqueVisualRate,
    unique_structure_hashes: uniqueStructureHashes.size,
    unique_structure_rate: uniqueStructureRate,
    category_counts: categoryCounts,
    normalized_entropy: entropy,
    per_profile: perProfile,
    target_results: targets,
    all_targets_passed: Object.values(targets).every(Boolean),
    generation_time_ms: generationTime,
    performance_targets: performanceTargets,
    all_acceptance_targets_passed:
      Object.values(targets).every(Boolean) && performanceTargets.user_mean_at_most_200ms,
    errors: reports.flatMap(({ errors }) => errors).slice(0, 50),
  };
}
}

const args = process.argv.slice(2).filter((argument) => argument !== '--');
if (args[0] === '--merge') {
  const outputPath = path.resolve(args[1] ?? 'generated-artifacts/flags/acceptance-100000.json');
  const inputs = args.slice(2);
  if (!inputs.length) throw new Error('Для объединения укажите файлы результатов диапазонов профилей.');
  const reports = inputs.map((filePath) => JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')));
  const summary = FlagAcceptanceReport.merge(reports);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: outputPath, ...summary }, null, 2));
} else {
  const profileStart = Number(args[0] ?? 0);
  const profileCount = Number(args[1] ?? profiles.length);
  const samplesPerProfile = Number(args[2] ?? 3125);
  const firstSeed = Number(args[3] ?? 1000);
  const outputPath = path.resolve(args[4] ?? `generated-artifacts/flags/acceptance-${profileStart}-${profileCount}.json`);
  if (!Number.isInteger(profileStart) || profileStart < 0 ||
      !Number.isInteger(profileCount) || profileCount < 1 ||
      profileStart + profileCount > profiles.length ||
      !Number.isInteger(samplesPerProfile) || samplesPerProfile < 1 ||
      !Number.isInteger(firstSeed)) {
    throw new RangeError('Ожидаются корректные границы профилей, число seed на профиль и начальный seed.');
  }
  const runner = new FlagGenerationAcceptance({ profileStart, profileCount, samplesPerProfile, firstSeed });
  const report = runner.run();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: outputPath,
    sample_count: report.sample_count,
    valid_count: report.valid_count,
    fallback_count: report.fallback_count,
    mean_attempts: report.valid_count ? report.attempts_total / report.valid_count : null,
    elapsed_ms: report.elapsed_ms,
    error_count: report.sample_count - report.valid_count,
  }, null, 2));
}
