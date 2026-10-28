import assert from 'node:assert/strict';
import { generateProfiledFlag } from '../game/flagProfiledGenerator.js';
import { assertValidFlagSpec } from '../game/flagSpec.js';

const scenarios = [
  'FIELD_ONLY',
  'FIELD_ONE_ORDINARY',
  'FIELD_ONE_ORDINARY_BORDURE',
  'FIELD_ONE_ORDINARY_BORDURE_ONE_CHARGE',
];
const outputs = scenarios.map((ablationScenario) => {
  const result = generateProfiledFlag({
    seed: 1000,
    profileId: 'P01',
    era: 0,
    ablationScenario,
  });
  assertValidFlagSpec(result.flag);
  assert.match(result.svg, /^<svg\b[\s\S]*<\/svg>$/);
  return result.flag.meta.visual_hash;
});

assert.equal(new Set(outputs).size, scenarios.length,
  'Каждый режим абляции должен изменять видимый состав флага.');
console.log(`Проверены все ${scenarios.length} режима абляции.`);
