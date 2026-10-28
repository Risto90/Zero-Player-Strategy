import assert from 'node:assert/strict';
import { FLAG_REFERENCE_CORPUS } from '../game/flagReferences.ts';
import {
  batchFlags,
  compareFlagSpecs,
  describeFlagNovelty,
  estimateFlagSpace,
  matchesReference,
  metrics,
  structureHash,
  visualHash,
} from '../game/flagNovelty.ts';
import { parseFlagSpec, serializeFlagSpec, validateFlagSpec } from '../game/flagSpec.ts';

assert.ok(FLAG_REFERENCE_CORPUS.length >= 50, 'корпус содержит не менее пятидесяти машиночитаемых эталонов');
for (const { spec } of FLAG_REFERENCE_CORPUS) {
  assert.deepEqual(validateFlagSpec(spec), [], 'каждый эталон соответствует FlagSpec');
  assert.deepEqual(parseFlagSpec(serializeFlagSpec(spec)), spec, 'каждый эталон проходит каноническую сериализацию без потерь');
  assert.equal(spec.meta.structure_hash, structureHash(spec), 'структурный хеш эталона актуален');
  assert.equal(spec.meta.visual_hash, visualHash(spec), 'визуальный хеш эталона актуален');
}

const source = FLAG_REFERENCE_CORPUS[0].spec;
const paletteOnly = structuredClone(source);
paletteOnly.palette.s2.hex = '#112233';
assert.equal(structureHash(source), structureHash(paletteOnly), 'цвета палитры не меняют структурный хеш');
assert.notEqual(visualHash(source), visualHash(paletteOnly), 'цвета палитры меняют визуальный хеш');
const quantized = structuredClone(source);
quantized.outline.params.offset = 0.001;
const quantizedNear = structuredClone(source);
quantizedNear.outline.params.offset = 0.002;
assert.equal(structureHash(quantized), structureHash(quantizedNear), 'числовые параметры квантуются с шагом 1/24');
assert.equal(compareFlagSpecs(source, source).similarity, 1, 'сходство флага с самим собой равно единице');
assert.equal(matchesReference(source, [source]), true, 'поиск находит точный визуальный хеш эталона');
assert.equal(compareFlagSpecs(source, { ...source, outline: { ...source.outline, type: 'BANNER' } }).similarity, 0);
assert.ok(describeFlagNovelty(source).field_operator.length > 0);
const moduleIdSample = (moduleId) => {
  const sample = structuredClone(source);
  sample.root.layers = [{
    kind: 'layer',
    layer: {
      id: 'проверка-категории-эмблемы',
      role: 'charge',
      shape: { type: moduleId },
      transform: {},
      fill: 's1',
      clip: [],
      tags: ['charge'],
      cost: 1,
    },
  }];
  return describeFlagNovelty(sample).module_family;
};
assert.equal(moduleIdSample('M03'), 'STAR', 'идентификатор модуля преобразуется в семейство эмблемы');
assert.equal(moduleIdSample('M30'), 'BAR_STACK', 'учитывается последний идентификатор каталога эмблем');

const independent = batchFlags(3, 4, 'independent', {
  generate: (seed) => structuredClone(FLAG_REFERENCE_CORPUS[Number(seed) % 50].spec),
});
assert.equal(independent.flags.length, 3);
assert.equal(independent.attempts, 3);

const deduplicated = batchFlags(2, 1, 'dedup', {
  attempts_max: 2,
  generate: () => structuredClone(source),
});
assert.equal(deduplicated.flags.length, 1);
assert.equal(deduplicated.exhausted, true);
assert.equal(deduplicated.rejected, 2);

const farthest = batchFlags(2, 10, 'farthest_point', {
  generate: (seed) => structuredClone(FLAG_REFERENCE_CORPUS[Number(seed) % 50].spec),
});
assert.equal(farthest.flags.length, 2);
assert.equal(farthest.attempts, 20, 'режим farthest_point набирает пул в десять раз больше результата');

let mutations = 0;
const elites = batchFlags(2, 20, 'map_elites', {
  generate: (seed) => structuredClone(FLAG_REFERENCE_CORPUS[Number(seed) % 50].spec),
  mutate: (elite) => {
    mutations += 1;
    return structuredClone(elite);
  },
  map_mutation_iterations: 5,
});
assert.equal(elites.flags.length, 2);
assert.equal(elites.exhausted, false, 'map_elites возвращает элиту для каждой заполненной ячейки');
assert.equal(mutations, 5, 'map_elites выполняет заданное количество мутаций');

const summary = metrics(FLAG_REFERENCE_CORPUS.map(({ spec }) => spec));
assert.equal(summary.sample_count, FLAG_REFERENCE_CORPUS.length);
assert.equal(summary.unique_structure_hashes, new Set(FLAG_REFERENCE_CORPUS.map(({ spec }) => structureHash(spec))).size);
assert.equal(summary.fallback.count, 0);
assert.equal(summary.fallback.ratio, null, 'у эталонов без генерации доля fallback неизвестна');
assert.equal(summary.attempts.mean, null, 'без статистики генерации не указывается одна попытка по умолчанию');
assert.equal(summary.map_elites_coverage.total, 3200);
assert.ok(summary.entropy.field_operator.value >= 0 && summary.entropy.field_operator.value <= 1);
assert.ok(summary.leader_clusters_at_090 > 0);
const measured = metrics([{
  ...structuredClone(source),
  meta: {
    ...structuredClone(source.meta),
    generation_stats: {
      attempts: 2,
      rejected_attempts: 1,
      palette_attempts: 1,
      fallback_used: true,
      fallback_profile_id: 'P28',
      optional_layers_removed: 0,
      rejection_reasons: ['проверка'],
    },
  },
}]);
assert.equal(measured.attempts.mean, 2);
assert.equal(measured.fallback.ratio, 1);

const estimate = estimateFlagSpace('P05');
assert.ok(BigInt(estimate.estimate) > 0n);
assert.ok(Object.keys(estimate.factors).includes('charge_sets'));
assert.ok(estimate.assumptions.length >= 2);

console.log('Проверки новизны флагов, эталонного корпуса и пакетных режимов пройдены.');
console.log(JSON.stringify({ references: FLAG_REFERENCE_CORPUS.length, metrics: summary, estimate }));
