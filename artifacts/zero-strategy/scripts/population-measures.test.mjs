import assert from 'node:assert/strict';
import { sumPopulationMeasures, takePopulationMeasure } from '../game/populationMeasures.ts';

const close = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ожидалось ${expected}, получено ${actual}`);
};

const source = [
  { cultureId: 1, religionId: 2, humanOriginMix: 10, population: 30 },
  { cultureId: 1, religionId: 3, humanOriginMix: 10, population: 20 },
  { cultureId: 4, religionId: 2, humanOriginMix: 10, population: 10 },
  { cultureId: 5, religionId: 5, humanOriginMix: 20, population: 40 },
];
const reference = [source[0]];

const forward = takePopulationMeasure(source, 40, reference, [0, 1, 2]);
const selectedByKey = new Map(forward.selected.map((group) => [
  `${group.cultureId}/${group.religionId}/${group.humanOriginMix}`,
  group.population,
]));
close(selectedByKey.get('1/2/10'), 30, 'точное совпадение выбирается первым');
close(selectedByKey.get('1/3/10'), 20 / 3, 'первая часть смешанного приоритета пропорциональна');
close(selectedByKey.get('4/2/10'), 10 / 3, 'вторая часть смешанного приоритета пропорциональна');
assert.equal(selectedByKey.has('5/5/20'), false, 'несвязанные группы не выбираются раньше совпадающих');
close(forward.selected.reduce((sum, group) => sum + group.population, 0), 40, 'выбранный объём сохраняется');
close(forward.remaining.reduce((sum, group) => sum + group.population, 0), 60, 'остаток объёма сохраняется');

const reverse = takePopulationMeasure(source, 20, reference, [2, 1, 0]);
close(reverse.selected.reduce((sum, group) => sum + group.population, 0), 20, 'обратный приоритет сохраняет объём');
assert.deepEqual(
  reverse.selected.map((group) => [group.cultureId, group.religionId, group.humanOriginMix]),
  [[5, 5, 20]],
  'обратный приоритет сначала выбирает несвязанные группы',
);

const merged = sumPopulationMeasures([
  { cultureId: 7, religionId: null, humanOriginMix: 4, population: 0.125 },
  { cultureId: 7, religionId: null, humanOriginMix: 4, population: 0.375 },
]);
assert.equal(merged.length, 1, 'ядро объединяет одинаковые записи меры');
close(merged[0].population, 0.5, 'дробная доля населения не округляется');

const tiny = takePopulationMeasure(
  [{ cultureId: 9, religionId: null, humanOriginMix: 0, population: 0.8 }],
  0.13,
  [],
);
close(tiny.selected[0].population, 0.13, 'малые доли населения сохраняются точно');
close(tiny.remaining[0].population, 0.67, 'малые доли не теряются при переносе');

console.log('Population measure algebra tests passed.');
