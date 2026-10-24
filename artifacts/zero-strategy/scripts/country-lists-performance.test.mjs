import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { countryCharacters } from '../game/characters.ts';
import { createFamilyId, createPerson } from '../game/government.ts';
import { countryCandidates, successionOrder } from '../game/succession.ts';
import { World } from '../game/world.ts';

const PEOPLE_COUNT = 6000;
const MAX_OPERATION_MS = 1000;

function fixture() {
  const world = World.create('random', 731_107);
  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'нагрузочный тест',
    cultureId: culture.id,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: null,
  });
  const pixel = world.landIndex[0];
  world.setOwner(pixel, country.id + 1);
  world.density[pixel] = 80;
  world.culture[pixel] = world.cultureTable.single(culture.id, 100);
  world.religion[pixel] = 0;
  world.recountCountries();
  return { world, country };
}

function measure(label, operation) {
  const start = performance.now();
  const result = operation();
  const elapsed = performance.now() - start;
  console.log(`${label}: ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < MAX_OPERATION_MS, `${label} took ${elapsed.toFixed(1)} ms`);
  return result;
}

const { world, country } = fixture();
const familyId = country.ruler.familyId || createFamilyId();
country.dynastyClaims = [familyId];
const people = [];

for (let index = 0; index < PEOPLE_COUNT; index += 1) {
  const parents = [country.ruler.id];
  const person = createPerson(1000, 30, familyId, parents, country.cultureId, country.religionId);
  person.age = 30;
  person.bornAt = 970 - index;
  person.countryId = country.id;
  world.people.push(person);
  people.push(person);
}

const residents = measure('6000-person resident roster sort', () => countryCharacters(world, country));
assert.equal(residents.length, PEOPLE_COUNT + 1, 'the sitting ruler is included as a living country resident');
assert.ok(residents[0].age >= residents.at(-1).age, 'the roster remains sorted from older to younger residents');

country.government = 'republic';
country.modifiers = [];
const candidates = measure('6000-person republic candidate list', () => countryCandidates(world, country));
const candidateIds = new Set(candidates.map(({ person }) => person.id));
assert.equal(candidates.length, PEOPLE_COUNT, 'all 6000 synthetic residents meet election rules');
assert.ok(people.every(({ id }) => candidateIds.has(id)), 'the full eligible roster is retained');

// A long ineligible lineage stresses descendant traversal without recursion limits.
country.government = 'tyranny';
country.modifiers = ['primogeniture'];
for (let index = 0; index < PEOPLE_COUNT; index += 1) {
  people[index].parents = [index === 0 ? country.ruler.id : people[index - 1].id];
}
for (let index = 0; index < PEOPLE_COUNT - 1; index += 1) people[index].age = 5;
people[PEOPLE_COUNT - 1].age = 30;
const heirLine = measure('6000-generation primogeniture traversal', () => successionOrder(world, country));
assert.equal(heirLine.length, 1);
assert.equal(heirLine[0].id, people[PEOPLE_COUNT - 1].id);
const eligible = measure('large-country succession candidate list', () => countryCandidates(world, country));
assert.equal(eligible.length, 1);
assert.equal(eligible[0].person.id, people[PEOPLE_COUNT - 1].id);

// The destination person profile must handle a broad family without mounting every relation row.
for (let index = 1; index < PEOPLE_COUNT; index += 1) people[index].parents = [people[0].id];
assert.equal(world.people.filter((item) => item.parents.includes(people[0].id)).length, PEOPLE_COUNT - 1);

const listUi = readFileSync(resolve(process.cwd(), 'components/profiles/CountryLists.tsx'), 'utf8');
const profileLayout = readFileSync(resolve(process.cwd(), 'components/profiles/ProfileLayout.tsx'), 'utf8');
const personProfile = readFileSync(resolve(process.cwd(), 'app/person/[id].tsx'), 'utf8');
assert.match(listUi, /<FlatList/u, 'resident and candidate lists use virtualized rendering');
assert.match(listUi, /maxToRenderPerBatch/u, 'list rendering is batched for responsive scrolling');
assert.match(listUi, /windowSize/u, 'only a bounded number of off-screen rows stay mounted');
assert.match(profileLayout, /styles\.extraTabContent/u, 'virtual lists are not nested inside a same-direction ScrollView');
assert.match(personProfile, /<FlatList/u, 'large family lists on the destination person profile are virtualized');

console.log('Large-country lists stay within the operation budget and retain all expected rows.');
