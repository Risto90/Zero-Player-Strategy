import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { renderFlagSpec } from '../game/flagRenderer.js';
import { assertValidFlagSpec } from '../game/flagSpec.js';

const INPUT_PATH = 'generated-artifacts/flags/contact-sheet-200.json';
const REPETITIONS = 5;

class FlagRenderPerformance {
  constructor(flags) {
    this.flags = flags;
  }

  static percentile(values, fraction) {
    return values[Math.ceil(values.length * fraction) - 1];
  }

  run() {
    assert.ok(this.flags.length > 0, 'Для измерения нужен хотя бы один флаг');
    renderFlagSpec(this.flags[0]);
    const durations = [];
    for (const flag of this.flags) {
      assertValidFlagSpec(flag);
      let expectedSvg = null;
      const samples = [];
      for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
        const startedAt = performance.now();
        const svg = renderFlagSpec(flag);
        const elapsed = performance.now() - startedAt;
        assert.match(svg, /^<svg\b[\s\S]*<\/svg>$/);
        expectedSvg ??= svg;
        assert.equal(svg, expectedSvg, 'Повторный рендер должен быть детерминированным');
        samples.push(elapsed);
      }
      durations.push(samples.reduce((sum, value) => sum + value, 0) / samples.length);
    }
    const sorted = [...durations].sort((left, right) => left - right);
    const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    const maximumIndex = durations.indexOf(sorted.at(-1));
    const maximumFlag = this.flags[maximumIndex];
    return {
      sample_count: durations.length,
      repetitions_per_flag: REPETITIONS,
      median_ms: FlagRenderPerformance.percentile(sorted, 0.5),
      mean_ms: mean,
      p90_ms: FlagRenderPerformance.percentile(sorted, 0.9),
      maximum_ms: sorted.at(-1),
      maximum_flag: {
        seed: maximumFlag.seed,
        profile_id: maximumFlag.profile_id,
      },
      target_5ms_passed: sorted.at(-1) <= 5,
    };
  }
}

const flags = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
const report = new FlagRenderPerformance(flags).run();
console.log(JSON.stringify(report, null, 2));
