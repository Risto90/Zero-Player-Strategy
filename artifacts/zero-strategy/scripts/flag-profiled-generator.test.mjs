import assert from 'node:assert/strict';
import { generateProfiledFlag as generateProfiledFlagRaw } from '../game/flagProfiledGenerator.js';
import { getFlagProfile } from '../game/flagProfiles.js';
import { assertValidFlagSpec } from '../game/flagSpec.js';

function generateProfiledFlag(options) {
  try {
    return generateProfiledFlagRaw(options);
  } catch (error) {
    console.error(`Сбой генерации профиля ${options.profileId}, seed ${options.seed}:`, error);
    throw error;
  }
}

const options = { seed: 1000, profileId: 'P04', era: 2 };
const first = generateProfiledFlag(options);
const second = generateProfiledFlag(options);

function collectSplitNodes(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (!Array.isArray(value) && value.kind === 'split') result.push(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectSplitNodes(child, result);
  }
  return result;
}

function collectLayerNodes(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (!Array.isArray(value) && value.kind === 'layer') result.push(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectLayerNodes(child, result);
  }
  return result;
}

assert.equal(first.flag.profile_id, options.profileId);
assert.equal(first.flag.seed, options.seed);
assert.equal(first.flag.era, options.era);
assert.match(first.svg, /^<svg\b/);
assertValidFlagSpec(first.flag);
assert.equal(first.flag.meta.visual_hash, second.flag.meta.visual_hash);
assert.equal(first.flag.meta.structure_hash, second.flag.meta.structure_hash);
assert.equal(first.svg, second.svg);
assert.ok(first.stats.attempts >= 1);
assert.ok(first.stats.attempts <= 200);

const p32G08Regression = generateProfiledFlag({ seed: 80455, profileId: 'P32', era: 4 });
assertValidFlagSpec(p32G08Regression.flag);
assert.match(p32G08Regression.svg, /^<svg\b/);
assert.ok(
  !p32G08Regression.stats.diagnostics.some(({ details = [] }) =>
    details.some((detail) => detail.includes('G08 requires')),
  ),
  'G08 не должен терять цветовой слот при повторной отрисовке обрезанного поля',
);

const p20 = generateProfiledFlag({ seed: 1019, profileId: 'P20', era: 5 });
assertValidFlagSpec(p20.flag);
assert.equal(p20.stats.fallback_used, false, 'P20 должен применять заданные варианты оси и шаблона полос');
const p20Bands = collectSplitNodes(p20.flag.root.ground).find((node) => node.op === 'G02');
assert.ok(p20Bands, 'P20 должен содержать разбиение BANDS');
assert.equal(p20Bands.params.n, 3);
assert.ok(['H', 'V'].includes(p20Bands.params.axis));
assert.ok(['CYC', 'MIRROR', 'TRIAD', 'SEP', 'DISTINCT'].includes(p20Bands.params.pattern));

const p19CrossCenters = new Set();
for (let seed = 1900; seed < 1924; seed += 1) {
  const result = generateProfiledFlag({ seed, profileId: 'P19', era: 5 });
  assertValidFlagSpec(result.flag);
  assert.equal(result.stats.fallback_used, false, `P19 seed ${seed} не должен переходить на резервный флаг`);
  const cross = collectLayerNodes(result.flag.root.layers)
    .find(({ layer }) => layer.role === 'ordinary');
  assert.ok(cross, `P19 seed ${seed} должен содержать обязательный скандинавский крест`);
  const shape = cross.layer.shape;
  const polygons = shape.type === 'multipolygon'
    ? shape.polygons
    : shape.type === 'polygon'
      ? [shape.points]
      : [];
  const vertical = polygons.map((points) => {
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
    };
  }).filter(({ height, width }) => height > width)
    .sort((left, right) => right.height - left.height)[0];
  assert.ok(vertical, `P19 seed ${seed} должен содержать вертикальную часть креста`);
  const center = (vertical.minX + vertical.maxX) / (2 * 1200 * result.flag.outline.aspect);
  assert.ok(center >= 0.3 && center <= 0.42, `Центр креста P19 ${center} вне заданного диапазона`);
  p19CrossCenters.add(center.toFixed(6));
}
assert.ok(p19CrossCenters.size >= 20, `Центр креста P19 должен варьироваться; уникальных значений: ${p19CrossCenters.size}`);

for (const seed of [1065, 1067, 1075]) {
  const p01ClearanceRegression = generateProfiledFlag({ seed, profileId: 'P01', era: 0 });
  assertValidFlagSpec(p01ClearanceRegression.flag);
  assert.equal(
    p01ClearanceRegression.stats.diagnostics.filter(({ code }) => code === 'V08').length,
    0,
    `P01 seed ${seed} не должен создавать коллизии V08 между зарядами A5/A10 и ординариями`,
  );
}

const p14Operators = new Set();
const p14Counts = new Set();
const p14Axes = new Set();
const p14Patterns = new Set();
let p14Fallbacks = 0;
let p14RejectedG04 = 0;
assert.ok(getFlagProfile('P14')?.SPECIAL?.fieldOperatorWeights, 'P14 должен содержать веса операторов поля');
for (let seed = 1400; seed < 1448; seed += 1) {
  const result = generateProfiledFlag({ seed, profileId: 'P14', era: 5 });
  assertValidFlagSpec(result.flag);
  p14Fallbacks += Number(result.stats.fallback_used);
  p14RejectedG04 += result.stats.diagnostics.filter((entry) => entry.operator === 'G04').length;
  const nodes = collectSplitNodes(result.flag.root.ground);
  const field = nodes.find((node) => ['G02', 'G04'].includes(node.op));
  assert.ok(field, 'P14 должен применять один из настроенных операторов поля');
  p14Operators.add(field.op);
  if (field.op === 'G02') {
    p14Counts.add(field.params.n);
    p14Axes.add(field.params.axis);
    p14Patterns.add(field.params.pattern);
  }
}
assert.ok(
  p14Operators.has('G02') && p14RejectedG04 > 0,
  `P14 должен выбирать настроенный SPLIT2; итоговые операторы: ${Array.from(p14Operators).join(', ') || 'нет'}, отклонённые SPLIT2=${p14RejectedG04}`,
);
assert.ok([3, 4, 5].some((count) => p14Counts.has(count)), 'P14 должен применять распределение числа полос');
assert.ok(p14Axes.has('H') && p14Axes.has('V'), 'P14 должен генерировать оба направления полос');
assert.ok(p14Patterns.has('DISTINCT') && p14Patterns.has('MIRROR'), 'P14 должен применять веса шаблонов слотов');

let fallbacks = 0;
let totalAttempts = 0;
const profileSeeds = [];
const rejectionCounts = new Map();
for (let seed = 1000; seed < 1100; seed += 1) {
  const result = generateProfiledFlag({ seed, profileId: 'P04', era: 2 });
  assert.equal(result.flag.profile_id, 'P04');
  assert.equal(result.flag.seed, seed);
  assert.match(result.svg, /^<svg\b/);
  assertValidFlagSpec(result.flag);
  fallbacks += Number(result.stats.fallback_used);
  totalAttempts += result.stats.attempts;
  for (const reason of result.stats.rejection_reasons) {
    rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  }
  profileSeeds.push(seed);
}
const fallbackRate = fallbacks / profileSeeds.length;
const meanAttempts = totalAttempts / profileSeeds.length;
assert.ok(fallbackRate <= 0.05, `Доля fallback P04 должна быть ≤ 5%; получено ${(fallbackRate * 100).toFixed(2)}%`);
assert.ok(meanAttempts <= 6, `Среднее число попыток P04 должно быть ≤ 6; получено ${meanAttempts.toFixed(2)}`);

const p03OutlineCounts = { SWALLOW: 0, PENNANT: 0 };
for (let seed = 1200; seed < 1248; seed += 1) {
  const result = generateProfiledFlag({ seed, profileId: 'P03', era: 2 });
  assertValidFlagSpec(result.flag);
  const { type, aspect } = result.flag.outline;
  if (type === 'SWALLOW' || type === 'PENNANT') {
    const [minimum, maximum] = type === 'SWALLOW' ? [1.4, 2.4] : [1.5, 5];
    assert.ok(aspect >= minimum && aspect <= maximum, `Аспект ${type} должен оставаться в заданном диапазоне`);
    assert.ok(Math.abs(aspect * 20 - Math.round(aspect * 20)) < 1e-8, `Аспект ${type} должен изменяться шагом 0,05`);
    p03OutlineCounts[type] += 1;
  }
}
assert.ok(p03OutlineCounts.SWALLOW > 0, 'P03 должен создавать контуры SWALLOW');
assert.ok(p03OutlineCounts.PENNANT > 0, 'P03 должен создавать контуры PENNANT');

const p26HybridInscribeRegression = generateProfiledFlag({
  seed: 12161,
  profileId: 'P26',
  era: 5,
});
assert.equal(p26HybridInscribeRegression.flag.seed, 12161);
assert.equal(p26HybridInscribeRegression.flag.era, 5);
assertValidFlagSpec(p26HybridInscribeRegression.flag);

const rejectionsByStage = {};
for (const [reason, count] of rejectionCounts) {
  const stage = reason.split(':', 1)[0];
  rejectionsByStage[stage] = (rejectionsByStage[stage] ?? 0) + count;
}
console.log(JSON.stringify({
  профиль: 'P04',
  'первый seed': profileSeeds[0],
  'последний seed': profileSeeds.at(-1),
  'число начальных значений': profileSeeds.length,
  'число резервных результатов': fallbacks,
  'доля резервных результатов': fallbackRate,
  'среднее число попыток': meanAttempts,
  'отказов по стадиям': rejectionsByStage,
}, null, 2));

if (process.env.FLAG_PROFILE_DIAGNOSTICS === '1') {
  const profileIds = ['P02', 'P05', 'P10', 'P13', 'P27', 'P30'];
  const sampleCount = 3;
  const diagnostics = [];
  for (const profileId of profileIds) {
    const stageTotals = new Map();
    const ruleTotals = new Map();
    const compositionTotals = new Map();
    const rejectionsByStage = new Map();
    const rejectionDetails = new Map();
    let attemptsTotal = 0;
    let fallbackCount = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const addTiming = (totals, key, durationMs) => {
        totals.set(key, (totals.get(key) ?? 0) + durationMs);
      };
      const generated = generateProfiledFlag({
        seed: 2000 + index,
        profileId,
        era: getFlagProfile(profileId).eras[0],
        onStageTiming: (stage, durationMs) => addTiming(stageTotals, stage, durationMs),
        onValidationRuleTiming: (rule, durationMs, section) =>
          addTiming(ruleTotals, `${rule}:${section ?? 'итог'}`, durationMs),
        onCompositionTiming: (section, durationMs) => addTiming(compositionTotals, section, durationMs),
      });
      attemptsTotal += generated.stats.attempts;
      if (generated.stats.fallback_used) fallbackCount += 1;
      for (const reason of generated.stats.rejection_reasons) {
        const stage = reason.split(':', 1)[0];
        rejectionsByStage.set(stage, (rejectionsByStage.get(stage) ?? 0) + 1);
        rejectionDetails.set(reason, (rejectionDetails.get(reason) ?? 0) + 1);
      }
    }
    const averages = (totals) => Object.fromEntries(
      [...totals.entries()]
        .map(([key, durationMs]) => [key, Number((durationMs / sampleCount).toFixed(3))])
        .sort((left, right) => right[1] - left[1]),
    );
    diagnostics.push({
      профиль: profileId,
      образцов: sampleCount,
      'среднее число попыток': Number((attemptsTotal / sampleCount).toFixed(3)),
      'резервных результатов': fallbackCount,
      'отказы по стадиям': Object.fromEntries([...rejectionsByStage.entries()].sort()),
      'частые причины отказов': [...rejectionDetails.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ причина: reason, количество: count })),
      'время по стадиям, мс на флаг': averages(stageTotals),
      'состав S4, мс на флаг': averages(compositionTotals),
      'время проверок, мс на флаг': averages(ruleTotals),
    });
  }
  console.log(JSON.stringify({ диагностика: diagnostics }, null, 2));
}
