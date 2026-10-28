import fs from 'node:fs/promises';
import path from 'node:path';
import { FLAG_PROFILE_CONFIG } from '../game/flagProfileConfig.ts';
import { renderFlagContactSheet } from '../game/flagContactSheet.ts';
import { generateProfiledFlag } from '../game/flagProfiledGenerator.ts';

const SAMPLE_SIZE = 200;
const FIRST_SEED = 1000;
const OUTPUT_DIR = path.resolve('generated-artifacts/flags');

class FlagContactSheetAcceptance {
  constructor({ sampleSize, firstSeed, outputDirectory }) {
    this.sampleSize = sampleSize;
    this.firstSeed = firstSeed;
    this.outputDirectory = outputDirectory;
  }

  async run() {
    const profiles = FLAG_PROFILE_CONFIG.filter(({ id }) => /^P\d{2}$/.test(id));
    if (profiles.length !== 32) {
      throw new Error(`Ожидалось 32 основных профиля P01–P32; найдено ${profiles.length}.`);
    }

    const occurrences = new Map();
    const flags = [];
    const manifest = [];
    for (let index = 0; index < this.sampleSize; index += 1) {
      const profile = profiles[index % profiles.length];
      const occurrence = occurrences.get(profile.id) ?? 0;
      occurrences.set(profile.id, occurrence + 1);
      const era = profile.eras[occurrence % profile.eras.length];
      const seed = this.firstSeed + index;
      let result;
      try {
        result = generateProfiledFlag({ seed, profileId: profile.id, era });
      } catch (error) {
        throw new Error(`Не удалось построить контактный образец ${profile.id}, начальное значение=${seed}, эпоха=${era}`, {
          cause: error,
        });
      }
      flags.push(result.flag);
      manifest.push({
        seed,
        requested_profile_id: profile.id,
        actual_profile_id: result.flag.profile_id,
        era,
        attempts: result.stats.attempts,
        rejection_reasons: result.stats.rejection_reasons,
        fallback_used: result.stats.fallback_used,
        fallback_profile_id: result.stats.fallback_profile_id,
        visual_hash: result.flag.meta.visual_hash,
        structure_hash: result.flag.meta.structure_hash,
        symmetry_target: result.flag.meta.symmetry_target,
        symmetry_actual: result.flag.meta.symmetry_actual,
      });
    }

    const fallbackCount = manifest.filter(({ fallback_used }) => fallback_used).length;
    const html = renderFlagContactSheet(flags, {
      title: 'Приёмочный контактный лист — 200 флагов, сбалансированная выборка P01–P32',
    });
    await fs.mkdir(this.outputDirectory, { recursive: true });
    await fs.writeFile(path.join(this.outputDirectory, 'contact-sheet-200.html'), html, 'utf8');
    await fs.writeFile(
      path.join(this.outputDirectory, 'contact-sheet-200.json'),
      `${JSON.stringify(flags, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(path.join(this.outputDirectory, 'contact-sheet-200-manifest.json'), `${JSON.stringify({
      sample_size: this.sampleSize,
      first_seed: this.firstSeed,
      last_seed: this.firstSeed + this.sampleSize - 1,
      sampling: 'Сбалансированная выборка: P01–P32 циклически, эпохи профиля по очереди.',
      fallback_count: fallbackCount,
      fallback_rate: fallbackCount / this.sampleSize,
      profiles: Object.fromEntries(occurrences),
      results: manifest,
    }, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify({
      contact_sheet: path.join(this.outputDirectory, 'contact-sheet-200.html'),
      manifest: path.join(this.outputDirectory, 'contact-sheet-200-manifest.json'),
      flags: this.sampleSize,
      profiles: profiles.length,
      fallback_count: fallbackCount,
    }, null, 2));
  }
}

await new FlagContactSheetAcceptance({
  sampleSize: SAMPLE_SIZE,
  firstSeed: FIRST_SEED,
  outputDirectory: OUTPUT_DIR,
}).run();
