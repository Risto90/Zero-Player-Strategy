import { strict as assert } from 'node:assert';
import {
  buildDynastyTree,
  centerDynastyPoint,
  dynastyCrownTargets,
  dynastyPairKey,
  DYNASTY_NODE_GAP_X,
  DYNASTY_NODE_WIDTH,
  toggleDynastySelection,
  zoomDynastyAtViewportCenter,
} from '../game/dynastyTree.ts';

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
  character(5, 1, { parents: [3, 4], spouseIds: [9] }),
  character(6, 2, { parents: [1, 2], spouseIds: [7] }),
  character(7, 3, { spouseIds: [6] }),
  character(8, 2, { spouseIds: [1], alive: false }),
  character(9, 2, { spouseIds: [5] }),
];

const fullTree = buildDynastyTree(people, 1);
const fullIds = new Set(fullTree.nodes.map((node) => node.person.id));
assert.deepEqual(
  [...fullIds].sort((a, b) => a - b),
  [1, 2, 3, 4, 5, 6, 9],
  'в древе есть члены династии, живые партнёры и дети, но нет умершего бездетного партнёра и супруга ребёнка другой династии',
);
assert.ok(fullTree.pairs.some((pair) => pair.firstId === 1 && pair.secondId === 2 && pair.childrenIds.includes(6)));
assert.ok(fullTree.nodes.some((node) => node.person.id === 6 && !node.isDynastyMember));
assert.equal(fullTree.nodes.find((node) => node.person.id === 6)?.childrenIds.length, 0);
const positions = new Map(fullTree.nodes.map((node) => [node.person.id, node]));
assert.equal(positions.get(3)?.y, positions.get(6)?.y, 'дети одного поколения находятся на одной высоте');
assert.equal(positions.get(4)?.generation, positions.get(3)?.generation, 'супруг ребёнка остаётся в поколении своего партнёра');
assert.equal(positions.get(9)?.generation, positions.get(5)?.generation, 'супруг внука остаётся в поколении своего партнёра');
assert.equal(positions.get(5)?.generation, positions.get(3)?.generation + 1, 'следующее поколение располагается ниже родителей');
assert.equal(
  Math.abs((positions.get(3)?.x ?? 0) - (positions.get(4)?.x ?? 0)),
  DYNASTY_NODE_WIDTH + DYNASTY_NODE_GAP_X,
  'супруг ребёнка стоит рядом со своим партнёром',
);
assert.equal(
  Math.abs((positions.get(3)?.x ?? 0) - (positions.get(6)?.x ?? 0)),
  (DYNASTY_NODE_WIDTH + DYNASTY_NODE_GAP_X) * 2,
  'дети одной пары вместе со своими партнёрами остаются в общем блоке',
);
assert.equal(
  Math.abs((positions.get(1)?.x ?? 0) - (positions.get(2)?.x ?? 0)),
  DYNASTY_NODE_WIDTH + DYNASTY_NODE_GAP_X,
  'супруги занимают соседние позиции в одном поколении',
);
assert.equal(
  Math.abs((positions.get(5)?.x ?? 0) - (positions.get(9)?.x ?? 0)),
  DYNASTY_NODE_WIDTH + DYNASTY_NODE_GAP_X,
  'супруг внука стоит рядом с ним, а не с основателями',
);

const crownPerson1 = character(51, 1);
const crownPerson2 = character(52, 1);
const crownPerson3 = character(53, 1);
const crownWorld = {
  people: [crownPerson1, crownPerson2, crownPerson3],
  countries: [
    {
      id: 1,
      name: 'Альфа',
      ruler: crownPerson1,
      coRulerIds: [],
      modifiers: [],
      heir: crownPerson2,
      previousRulerIds: [crownPerson1.id, crownPerson3.id],
      rulerTerms: [
        { personId: crownPerson1.id, startYear: 10, endYear: null, office: 'ruler' },
        { personId: crownPerson3.id, startYear: 1, endYear: 9, office: 'ruler' },
      ],
    },
    {
      id: 2,
      name: 'Бета',
      ruler: crownPerson1,
      coRulerIds: [],
      modifiers: [],
      heir: null,
      previousRulerIds: [crownPerson2.id],
      rulerTerms: [],
    },
  ],
};
const crowns = dynastyCrownTargets(crownWorld, new Set([crownPerson1.id, crownPerson2.id, crownPerson3.id]));
assert.equal(crowns.get(crownPerson1.id)?.role, 'ruler', 'действующий правитель важнее наследника и бывшего правителя');
assert.deepEqual(
  crowns.get(crownPerson1.id)?.countries.map((country) => country.id),
  [1, 2],
  'значок правителя открывает все страны, которыми персонаж правит',
);
assert.equal(crowns.get(crownPerson2.id)?.role, 'heir', 'ожидаемый наследник важнее бывшего правителя');
assert.deepEqual(crowns.get(crownPerson2.id)?.countries.map((country) => country.id), [1]);
assert.equal(crowns.get(crownPerson3.id)?.role, 'former', 'для бывшего правителя показывается чёрная корона');
assert.deepEqual(crowns.get(crownPerson3.id)?.countries.map((country) => country.id), [1]);
assert.equal(toggleDynastySelection(51, 51), null, 'повторное нажатие снимает выделение карточки');
assert.equal(toggleDynastySelection(null, 51), 51, 'первое нажатие выделяет карточку');

const viewport = { width: 400, height: 700 };
const originalOffset = { x: -120, y: -80 };
const zoomedOffset = zoomDynastyAtViewportCenter(originalOffset, viewport, 1, 1.5);
assert.deepEqual(
  zoomDynastyAtViewportCenter(zoomedOffset, viewport, 1.5, 1),
  originalOffset,
  'масштабирование и возврат сохраняют точку, находившуюся в центре области просмотра',
);
assert.deepEqual(
  centerDynastyPoint({ x: 80, y: 120 }, viewport, 2),
  { x: 40, y: 110 },
  'выбранный персонаж можно точно центрировать при любом масштабе',
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