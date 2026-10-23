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
  ['app/person/[id].tsx', 5, 'person and relative profiles'],
  ['app/dynasty/[id].tsx', 2, 'dynasty cards and relation links'],
  ['app/country/[id].tsx', 3, 'country rulers and heirs'],
  ['app/nomad/[id].tsx', 2, 'nomad rulers and heirs'],
  ['components/game/LegendPanel.tsx', 7, 'country list and map inspection panel'],
  ['components/game/InspectCard.tsx', 2, 'map inspection person rows'],
  ['components/game/CardPanel.tsx', 2, 'event names and person choices'],
];

for (const [relativePath, minimumUsages, description] of viewFiles) {
  const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  const usages = source.match(/personDeathStatus\(/gu)?.length ?? 0;
  assert.ok(
    usages >= minimumUsages,
    `${description} should apply the shared death status to each person display (found ${usages})`,
  );
}

console.log('Person death status regressions passed.');
