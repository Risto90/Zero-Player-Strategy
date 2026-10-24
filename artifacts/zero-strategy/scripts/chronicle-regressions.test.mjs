import assert from 'node:assert/strict';
import { filterChronicle, migrateChronicle, reindexChronicleObjects } from '../game/chronicle.ts';

const oldEntries = migrateChronicle([
  '1000: Ancient country: the name in this line is not a relationship.',
  'A line without a year or verified object links',
]);
assert.deepEqual(oldEntries, [
  { year: 1000, text: 'Ancient country: the name in this line is not a relationship.', objects: [] },
  { year: 0, text: 'A line without a year or verified object links', objects: [] },
], 'old string records remain available without inferred object links');

const entries = migrateChronicle([
  { year: 1012, text: 'Country event', objects: [{ type: 'country', id: 3 }, { type: 'city', id: 4 }] },
  { year: 1011, text: 'Another city event', objects: [{ type: 'city', id: 5 }] },
  { year: 1010, text: 'Unrelated country event', objects: [{ type: 'country', id: 8 }] },
  { year: 1009, text: 'Invalid link is discarded', objects: [{ type: 'person', id: 3 }, { type: 'religion', id: -1 }] },
]);
assert.deepEqual(filterChronicle(entries, [{ type: 'city', id: 4 }]).map(({ text }) => text),
  ['Country event'], 'only entries explicitly linked to the city are returned');
assert.deepEqual(filterChronicle(entries, [{ type: 'country', id: 3 }]).map(({ text }) => text),
  ['Country event'], 'a country does not inherit unrelated country records');
assert.equal(entries[3].objects.length, 0, 'unknown object kinds and invalid IDs are rejected');

const shifted = reindexChronicleObjects(entries, 'city', 4);
assert.deepEqual(shifted[0].objects, [{ type: 'country', id: 3 }],
  'links to a deleted city are dropped rather than reassigned');
assert.deepEqual(shifted[1].objects, [{ type: 'city', id: 4 }],
  'records for later cities follow their reindexed city');
console.log('Chronicle migration, filtering, and entity reindexing passed.');
