import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { personDeathStatus } from '../game/government.ts';

assert.equal(
  personDeathStatus({ alive: false, gender: 'male', deathYear: 120 }),
  'умер в 120 году',
  'male death status includes a known year',
);
assert.equal(
  personDeathStatus({ alive: false, gender: 'female', deathYear: 87 }),
  'умерла в 87 году',
  'female death status includes a known year',
);
assert.equal(
  personDeathStatus({ alive: false, gender: 'female', deathYear: null }),
  'умерла, год смерти неизвестен',
  'unknown death year is explicit',
);
assert.equal(
  personDeathStatus({ alive: false, gender: 'male', deathYear: undefined }),
  'умер, год смерти неизвестен',
  'missing death year in a legacy save is explicit',
);
assert.equal(
  personDeathStatus({ alive: true, gender: 'male', deathYear: null }),
  null,
  'living characters do not receive a death status',
);

const viewFiles = [
  ['app/person/[id].tsx', 5, 'страница персонажа и его родственники'],
  ['app/country/[id].tsx', 5, 'правители и наследники стран и кочевий'],
  ['components/game/CardPanel.tsx', 2, 'имена персонажей на картах'],
];

for (const [relativePath, minimumUsages, description] of viewFiles) {
  const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  const usages = source.match(/personDeathStatus\(/gu)?.length ?? 0;
  assert.ok(
    usages >= minimumUsages,
    `${description}: для каждого персонажа должен отображаться общий статус смерти (найдено: ${usages})`,
  );
}

const inspectSource = readFileSync(resolve(process.cwd(), 'components/game/InspectCard.tsx'), 'utf8');
assert.match(inspectSource, /x \{info\.x\} · y \{info\.y\}/u, 'окно точки сохраняет её координаты');
assert.match(inspectSource, /link-inspect-country/u, 'из окна точки можно открыть государство');
assert.match(inspectSource, /link-inspect-city/u, 'из окна точки можно открыть город');
assert.doesNotMatch(inspectSource, /personDeathStatus/u, 'подробные сведения о персонаже остаются на его странице');

const dynastySource = readFileSync(resolve(process.cwd(), 'app/dynasty/[id].tsx'), 'utf8');
assert.match(dynastySource, /person\.alive \? `\$\{person\.age\} лет` : `\$\{Math\.floor\(person\.bornAt\)\}—\$\{person\.deathYear \?\? '…'\}`/u);
assert.doesNotMatch(dynastySource, /жив\(а\)|умер(?:ла)?/u);
assert.match(dynastySource, /gender-female/u);
assert.match(dynastySource, /gender-male/u);
assert.match(dynastySource, /setSelectedPersonId\(person\.id\)/u);
assert.match(dynastySource, /selectedPersonId === pair\.firstId/u);
assert.doesNotMatch(dynastySource, /pairFoldButton|fold-pair-/u);

console.log('Проверки отображения возраста и года смерти пройдены.');
