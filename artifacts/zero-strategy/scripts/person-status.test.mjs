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
  ['app/country/[id].tsx', 5, 'country and nomad rulers and heirs'],
  ['components/game/LegendPanel.tsx', 7, 'country list and map inspection panel'],
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

const inspectSource = readFileSync(resolve(process.cwd(), 'components/game/InspectCard.tsx'), 'utf8');
assert.match(inspectSource, /x \{info\.x\} · y \{info\.y\}/u, 'map inspection keeps point coordinates');
assert.match(inspectSource, /link-inspect-country/u, 'map inspection links to the controlling country');
assert.match(inspectSource, /link-inspect-city/u, 'map inspection links to a city at the point');
assert.doesNotMatch(inspectSource, /personDeathStatus/u, 'detailed person information remains on profile pages');

console.log('Person death status regressions passed.');
