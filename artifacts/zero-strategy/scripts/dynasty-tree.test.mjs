import { strict as assert } from 'node:assert';
import { buildDynastyTree, dynastyPairKey } from '../game/dynastyTree.ts';

function character(id, familyId, options = {}) {
  return {
    id,
    familyId,
    familyName: familyId === 1 ? 'Северин' : 'Люмен',
    name: `Персонаж ${id}`,
    bornAt: 1000 + id,
    age: 30,
    alive: options.alive ?? true,
    gender: id % 2 ? 'male' : 'female',
    parents: options.parents ?? [],
    spouseIds: options.spouseIds ?? [],
    loverIds: options.loverIds ?? [],
  };
}

const people = [
  character(1, 1, { spouseIds: [2] }),
  character(2, 2, { spouseIds: [1] }),
  character(3, 1, { parents: [1, 2], spouseIds: [4] }),
  character(4, 2, { spouseIds: [3] }),
  character(5, 1, { parents: [3, 4] }),
  character(6, 2, { parents: [1, 2], spouseIds: [7] }),
  character(7, 3, { spouseIds: [6] }),
  character(8, 2, { spouseIds: [1], alive: false }),
];

const fullTree = buildDynastyTree(people, 1);
const fullIds = new Set(fullTree.nodes.map((node) => node.person.id));
assert.deepEqual(
  [...fullIds].sort((a, b) => a - b),
  [1, 2, 3, 4, 5, 6],
  'в древе есть члены династии, живые партнёры и дети, но нет умершего бездетного партнёра и супруга ребёнка другой династии',
);
assert.ok(fullTree.pairs.some((pair) => pair.firstId === 1 && pair.secondId === 2 && pair.childrenIds.includes(6)));
assert.ok(fullTree.nodes.some((node) => node.person.id === 6 && !node.isDynastyMember));
assert.equal(fullTree.nodes.find((node) => node.person.id === 6)?.childrenIds.length, 0);
const positions = new Map(fullTree.nodes.map((node) => [node.person.id, node]));
assert.equal(positions.get(3)?.y, positions.get(6)?.y, 'дети одного поколения находятся на одной высоте');
assert.equal(
  Math.abs((positions.get(3)?.x ?? 0) - (positions.get(6)?.x ?? 0)),
  262,
  'дети одной пары размещаются рядом, а не среди посторонних ветвей',
);
assert.equal(
  Math.abs((positions.get(1)?.x ?? 0) - (positions.get(2)?.x ?? 0)),
  262,
  'супруги занимают соседние позиции в одном поколении',
);

const collapsedPerson = buildDynastyTree(people, 1, new Set([1]));
assert.ok(collapsedPerson.nodes.some((node) => node.person.id === 1));
assert.ok(collapsedPerson.nodes.some((node) => node.person.id === 2));
assert.ok(!collapsedPerson.nodes.some((node) => node.person.id === 3));
assert.ok(collapsedPerson.nodes.find((node) => node.person.id === 1)?.childrenIds.includes(3));
assert.deepEqual(
  new Set(buildDynastyTree(people, 1).nodes.map((node) => node.person.id)),
  fullIds,
  'после сброса сворачивания ветвь снова полностью отображается',
);

const collapsedPair = buildDynastyTree(people, 1, new Set(), new Set([dynastyPairKey(1, 2)]));
const pairVisibleIds = new Set(collapsedPair.nodes.map((node) => node.person.id));
assert.ok(!pairVisibleIds.has(3));
assert.ok(!pairVisibleIds.has(6));
assert.ok(!pairVisibleIds.has(4));
assert.ok(pairVisibleIds.has(1) && pairVisibleIds.has(2));

console.log('Проверки генеалогического древа пройдены.');
