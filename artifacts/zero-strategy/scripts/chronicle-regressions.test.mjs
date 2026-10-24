import assert from 'node:assert/strict';
import {
  CHRONICLE_OBJECT_HISTORY_LIMIT,
  CHRONICLE_PAGE_SIZE,
  chroniclePage,
  filterChronicle,
  migrateChronicle,
  reindexChronicleObjects,
  searchChronicle,
  transferCountryChronicle,
} from '../game/chronicle.ts';

const oldEntries = migrateChronicle([
  '1000: Ancient country: the name in this line is not a relationship.',
  'A line without a year or verified object links',
]);
assert.deepEqual(oldEntries, [
  { year: 1000, text: 'Ancient country: the name in this line is not a relationship.', objects: [], important: false },
  { year: 0, text: 'A line without a year or verified object links', objects: [], important: false },
], 'old string records remain available without inferred object links');

const entries = migrateChronicle([
  { year: 1012, text: 'Country event', objects: [{ type: 'country', id: 3 }, { type: 'city', id: 4 }] },
  { year: 1011, text: 'Another city event', objects: [{ type: 'city', id: 5 }] },
  { year: 1010, text: 'Unrelated country event', objects: [{ type: 'country', id: 8 }] },
  { year: 1009, text: 'Invalid link is discarded', important: true, objects: [{ type: 'dynasty', id: 3 }, { type: 'religion', id: -1 }] },
]);
assert.deepEqual(filterChronicle(entries, [{ type: 'city', id: 4 }]).map(({ text }) => text),
  ['Country event'], 'only entries explicitly linked to the city are returned');
assert.deepEqual(filterChronicle(entries, [{ type: 'country', id: 3 }]).map(({ text }) => text),
  ['Country event'], 'a country does not inherit unrelated country records');
assert.equal(entries[3].objects.length, 0, 'unknown object kinds and invalid IDs are rejected');

const routineExpansion = migrateChronicle([
  { year: 1008, text: 'Лирдора расширяется на 4000 земель.', important: true, objects: [{ type: 'country', id: 3 }] },
  { year: 1007, text: 'Кочевье: кочевой ареал расширен на 260 земель.', important: true, objects: [{ type: 'country', id: 3 }] },
]);
assert.equal(routineExpansion[0].important, false, 'routine country expansion is not an important event');
assert.equal(routineExpansion[1].important, false, 'routine nomad expansion is not an important event');

const historical = migrateChronicle([
  { year: 1, text: 'Person event', objects: [{ type: 'person', id: 41 }] },
  { year: 2, text: 'Important event', important: true, objects: [{ type: 'country', id: 3 }] },
  { year: 3, text: 'Legacy structured event', objects: [{ type: 'country', id: 3 }] },
]);
assert.deepEqual(historical[0].objects, [{ type: 'person', id: 41 }],
  'person relationships are kept as typed references');
assert.equal(historical[1].important, true, 'the explicit importance marker survives migration');
assert.equal(historical[2].important, false, 'old structured entries do not acquire invented importance');

const longArchive = Array.from({ length: 160 }, (_, index) => ({
  year: 2000 - index,
  text: `Event ${index}`,
  objects: [{ type: 'country', id: 7 }],
  important: index === 115 || index === 150,
}));
const objectHistory = filterChronicle(longArchive, [{ type: 'country', id: 7 }]);
assert.equal(objectHistory.length, CHRONICLE_OBJECT_HISTORY_LIMIT + 2,
  'object history keeps the newest 100 links and older important events');
assert.equal(objectHistory[0].text, 'Event 0', 'object history remains newest first');
assert.deepEqual(objectHistory.slice(-2).map(({ text }) => text), ['Event 115', 'Event 150'],
  'important events survive regardless of age');
assert.equal(filterChronicle(longArchive, [{ type: 'country', id: 99 }]).length, 0,
  'importance does not make unrelated objects inherit an event');
const completeObjectSearch = searchChronicle(longArchive, { reference: { type: 'country', id: 7 } });
assert.equal(completeObjectSearch.length, 160,
  'archive search reaches linked records older than the profile history limit');
assert.equal(chroniclePage(completeObjectSearch, 1)[0].text, 'Event 25',
  'filtered archive pages keep the original newest-first ordering');
assert.deepEqual(searchChronicle(longArchive, { text: 'EVENT 15', year: '1985' }).map(({ text }) => text),
  ['Event 15'], 'text and exact year filters combine without changing newest-first ordering');
assert.deepEqual(searchChronicle([
  { year: 9, text: 'Основан город ВЕЖА', objects: [], important: false },
  { year: 8, text: 'Основан город', objects: [], important: false },
], { text: 'основан вежа' }).map(({ year }) => year),
  [9], 'text search ignores letter case and requires every search term');
assert.equal(searchChronicle(longArchive, { year: 'invalid' }).length, 0,
  'invalid year filters never silently return the unfiltered archive');

const archivePages = Array.from({ length: 61 }, (_, index) => ({
  year: 2060 - index, text: `Archive ${index}`, objects: [], important: false,
}));
assert.equal(chroniclePage(archivePages, 0).length, CHRONICLE_PAGE_SIZE, 'global archive initially exposes 25 records');
assert.equal(chroniclePage(archivePages, 1)[0].text, 'Archive 25', 'the next page starts after the first 25');
assert.equal(chroniclePage(archivePages, 2).length, 11, 'the last archive page contains only remaining records');

const countryArchive = migrateChronicle([
  { year: 100, text: 'Country and city', important: false, objects: [{ type: 'country', id: 3 }, { type: 'city', id: 4 }] },
  { year: 50, text: 'Old important country event', important: true, objects: [{ type: 'country', id: 3 }] },
  { year: 90, text: 'Other country', important: true, objects: [{ type: 'country', id: 8 }] },
]);
const transferred = transferCountryChronicle(countryArchive, 3, [9], true);
assert.equal(transferred.length, countryArchive.length, 'moving object links never deletes global archive entries');
assert.deepEqual(transferred[0].objects, [{ type: 'city', id: 4 }, { type: 'country', id: 9 }],
  'a dissolved source link is replaced without losing links to other objects');
assert.equal(transferred[1].important, true, 'important status survives successor transfer');
assert.deepEqual(filterChronicle(transferred, [{ type: 'country', id: 9 }]).map(({ text }) => text),
  ['Country and city', 'Old important country event'], 'successor receives ordinary and important source history');
assert.deepEqual(transferred[2].objects, [{ type: 'country', id: 8 }],
  'history belonging to another country is unchanged');
assert.deepEqual(transferCountryChronicle(countryArchive, 3, [9]).map(({ objects }) => objects[0]),
  [{ type: 'country', id: 3 }, { type: 'country', id: 3 }, { type: 'country', id: 8 }],
  'a surviving partition source keeps its history while successors gain a link');
assert.deepEqual(transferCountryChronicle(countryArchive, 3, [], true)[0].objects,
  [{ type: 'city', id: 4 }], 'a dissolved country with no successor loses only its stale country link');

const shifted = reindexChronicleObjects(entries, 'city', 4);
assert.deepEqual(shifted[0].objects, [{ type: 'country', id: 3 }],
  'links to a deleted city are dropped rather than reassigned');
assert.deepEqual(shifted[1].objects, [{ type: 'city', id: 4 }],
  'records for later cities follow their reindexed city');
console.log('Chronicle migration, filtering, and entity reindexing passed.');
