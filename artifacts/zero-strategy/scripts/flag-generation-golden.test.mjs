import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAG_PROFILE_CONFIG } from '../game/flagProfileConfig.js';
import { generateProfiledFlag } from '../game/flagProfiledGenerator.js';
import { parseFlagSpec, serializeFlagSpec, assertValidFlagSpec } from '../game/flagSpec.js';
import { renderFlagSpec } from '../game/flagRenderer.js';

const SAMPLE_SIZE = 200;
const FIRST_SEED = 1000;
const profiles = FLAG_PROFILE_CONFIG.filter(({ id }) => /^P\d{2}$/.test(id));
const scriptPath = fileURLToPath(import.meta.url);
const goldenPath = path.resolve('game/flag-golden-200.json');

class FlagGoldenAcceptance {
  runWorker(outputPath) {
    const occurrences = new Map();
    const results = [];
    let generatorVersion = null;
    for (let index = 0; index < SAMPLE_SIZE; index += 1) {
      const profile = profiles[index % profiles.length];
      const occurrence = occurrences.get(profile.id) ?? 0;
      occurrences.set(profile.id, occurrence + 1);
      const era = profile.eras[occurrence % profile.eras.length];
      const seed = FIRST_SEED + index;
      const result = generateProfiledFlag({ seed, profileId: profile.id, era });
      assertValidFlagSpec(result.flag);
      const roundTripSvg = renderFlagSpec(parseFlagSpec(serializeFlagSpec(result.flag)));
      assert.equal(roundTripSvg, result.svg, `${profile.id}, seed=${seed}: сериализация и разбор должны сохранить SVG`);
      generatorVersion ??= result.flag.generator_version;
      assert.equal(result.flag.generator_version, generatorVersion);
      results.push({
        seed,
        requested_profile_id: profile.id,
        profile_id: result.flag.profile_id,
        era,
        fallback_used: result.stats.fallback_used,
        structure_hash: result.flag.meta.structure_hash,
        visual_hash: result.flag.meta.visual_hash,
        svg_sha256: createHash('sha256').update(result.svg, 'utf8').digest('hex'),
        svg: result.svg,
      });
    }
    fs.writeFileSync(outputPath, JSON.stringify({ generator_version: generatorVersion, results }), 'utf8');
  }

  runSeparateProcess(outputPath) {
    execFileSync(process.execPath, [scriptPath, '--worker', outputPath], {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  }

  runParent(createSnapshot) {
    assert.equal(profiles.length, 32, 'В выборке должны присутствовать профили P01–P32');
    const firstPath = path.join(os.tmpdir(), `flag-golden-a-${process.pid}.json`);
    const secondPath = path.join(os.tmpdir(), `flag-golden-b-${process.pid}.json`);
    const first = this.runSeparateProcess(firstPath);
    const second = this.runSeparateProcess(secondPath);
    assert.deepEqual(first, second, 'SVG в двух независимых процессах должны совпадать побайтно');
    assert.equal(first.results.length, SAMPLE_SIZE);

    if (createSnapshot) {
      fs.writeFileSync(goldenPath, `${JSON.stringify({
        generator_version: first.generator_version,
        first_seed: FIRST_SEED,
        last_seed: FIRST_SEED + SAMPLE_SIZE - 1,
        sampling: 'Профили P01–P32 циклически, эпохи каждого профиля по очереди.',
        results: first.results.map(({ svg, ...entry }) => entry),
      }, null, 2)}\n`, 'utf8');
    } else {
      const snapshot = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
      assert.equal(first.generator_version, snapshot.generator_version,
        'Изменение версии генератора требует нового утверждённого golden-снимка');
      assert.equal(snapshot.results.length, SAMPLE_SIZE);
      for (let index = 0; index < SAMPLE_SIZE; index += 1) {
        const actual = first.results[index];
        const expected = snapshot.results[index];
        assert.deepEqual({
          seed: actual.seed,
          requested_profile_id: actual.requested_profile_id,
          profile_id: actual.profile_id,
          era: actual.era,
          fallback_used: actual.fallback_used,
          structure_hash: actual.structure_hash,
          visual_hash: actual.visual_hash,
          svg_sha256: actual.svg_sha256,
        }, expected, `Эталонный результат изменился: seed=${actual.seed}`);
      }
    }
    fs.rmSync(firstPath, { force: true });
    fs.rmSync(secondPath, { force: true });
    console.log(JSON.stringify({
      sample_count: SAMPLE_SIZE,
      first_seed: FIRST_SEED,
      last_seed: FIRST_SEED + SAMPLE_SIZE - 1,
      generator_version: first.generator_version,
      fallback_count: first.results.filter(({ fallback_used }) => fallback_used).length,
      golden_snapshot: goldenPath,
      snapshot_created: createSnapshot,
      cross_process_byte_equality: true,
      generated_round_trip: true,
    }, null, 2));
  }
}

const args = process.argv.slice(2).filter((argument) => argument !== '--');
const acceptance = new FlagGoldenAcceptance();
if (args[0] === '--worker') {
  if (!args[1]) throw new Error('Не указан временный файл результата дочернего процесса.');
  acceptance.runWorker(path.resolve(args[1]));
} else {
  acceptance.runParent(args[0] === '--create');
}
