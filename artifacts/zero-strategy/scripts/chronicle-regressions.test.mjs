import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHRONICLE_OBJECT_HISTORY_LIMIT,
  CHRONICLE_PAGE_SIZE,
  chroniclePage,
  findChronicleMentions,
  filterChronicle,
  isChronicleImportant,
  migrateChronicle,
  searchChronicle,
  transferCountryChronicle,
} from '../game/chronicle.ts';
import { Game } from '../game/game.ts';
import { marry } from '../game/characters.ts';
import { createPerson } from '../game/government.ts';
import { World } from '../game/world.ts';

const ref = (type, id) => ({ type, id });
const entry = (text, objects, importantObjects = []) => ({
  year: 1000,
  text,
  objects,
  importantObjects,
});
const importance = [
  entry('Создание страны', [ref('country', 1), ref('culture', 2), ref('religion', 3)], [ref('country', 1)]),
  entry('Разделение страны', [ref('country', 1), ref('country', 4), ref('city', 50)], [ref('country', 1), ref('country', 4)]),
  entry('Поглощение страны', [ref('country', 1), ref('country', 4), ref('city', 50)], [ref('country', 1), ref('country', 4)]),
  entry('Переход страны в другую форму', [ref('country', 1), ref('city', 50)], [ref('country', 1)]),
  entry('Создание города', [ref('country', 1), ref('city', 50)], [ref('city', 50)]),
  entry('Расширение города', [ref('country', 1), ref('city', 50)], [ref('city', 50)]),
  entry('Увядание города', [ref('country', 1), ref('city', 50)], [ref('city', 50)]),
  entry('Падение города', [ref('country', 1), ref('city', 50)], [ref('city', 50)]),
  entry('Рождение персонажа', [ref('country', 1), ref('person', 10), ref('person', 11), ref('person', 12)],
    [ref('person', 10), ref('person', 11), ref('person', 12)]),
  entry('Роман', [ref('country', 1), ref('person', 10), ref('person', 11)], [ref('person', 10), ref('person', 11)]),
  entry('Брак', [ref('country', 1), ref('person', 10), ref('person', 11)], [ref('person', 10), ref('person', 11)]),
  entry('Смерть персонажа', [ref('country', 1), ref('person', 10), ref('person', 11)], [ref('person', 10)]),
  entry('Назначение и освобождение должности', [ref('country', 1), ref('person', 10), ref('person', 11)],
    [ref('person', 10), ref('person', 11)]),
  entry('Рождение ребёнка', [ref('country', 1), ref('person', 10), ref('person', 11), ref('person', 12)],
    [ref('person', 10), ref('person', 11), ref('person', 12)]),
  entry('Смерть ребёнка', [ref('country', 1), ref('person', 10), ref('person', 11)], [ref('person', 10), ref('person', 11)]),
  entry('Создание культуры', [ref('culture', 2), ref('country', 1)], [ref('culture', 2)]),
  entry('Раскол культуры', [ref('culture', 2), ref('culture', 5), ref('country', 1)], [ref('culture', 2), ref('culture', 5)]),
  entry('Создание религии', [ref('religion', 3), ref('country', 1)], [ref('religion', 3)]),
  entry('Раскол религии', [ref('religion', 3), ref('religion', 6), ref('country', 1)], [ref('religion', 3), ref('religion', 6)]),
];

for (const event of importance) {
  const migrated = migrateChronicle([event])[0];
  assert.deepEqual(migrated.importantObjects, event.importantObjects, `${event.text} keeps exactly its designated object marks`);
  for (const object of event.objects) {
    assert.equal(isChronicleImportant(migrated, object), event.importantObjects.some((marked) =>
      marked.type === object.type && marked.id === object.id), `${event.text} is scoped to ${object.type}:${object.id}`);
  }
  assert.equal(isChronicleImportant(migrated, null), false, `${event.text} has no universal archive marker`);
}

const unimportant = [
  'Обычное расширение страны',
  'Кочевой ареал расширен',
  'Колонизация',
  'Перенос столицы',
  'Реформа',
  'Дружба',
  'Обручение',
  'Климат изменён',
].map((text) => entry(text, [ref('country', 1), ref('city', 50), ref('person', 10)]));
for (const event of migrateChronicle(unimportant)) {
  assert.deepEqual(event.importantObjects, [], `${event.text} is not important without an explicit classification`);
}

const oldEntries = migrateChronicle([
  '1000: Ancient country: this wording does not establish an object link.',
  'A line without a year or verified object links',
  { year: 8, text: 'Country created', important: true, objects: [ref('country', 1), ref('city', 0)] },
  { year: 7, text: 'City waned', important: true, objects: [ref('city', 0)] },
], new Map(), new Map([[0, 81]]));
assert.deepEqual(oldEntries[0], {
  year: 1000, text: 'Ancient country: this wording does not establish an object link.', objects: [], importantObjects: [],
}, 'old string records remain available without inferred object links');
assert.deepEqual(oldEntries[1], {
  year: 0, text: 'A line without a year or verified object links', objects: [], importantObjects: [],
}, 'old plain text gets no object links or guessed importance');
assert.deepEqual(oldEntries[2].objects, [ref('country', 1), ref('city', 81)],
  'legacy city index links migrate to their stable city identities');
assert.deepEqual(oldEntries[2].importantObjects, [], 'old boolean importance is discarded instead of guessed from text');
assert.deepEqual(oldEntries[3].objects, [ref('city', 81)], 'old city links remain linked after migration');
assert.deepEqual(oldEntries[3].importantObjects, [], 'legacy city importance is also discarded');

const current = migrateChronicle([
  entry('Current city event', [ref('city', 81)], [ref('city', 81)]),
  entry('Unlinked mark is dropped', [ref('country', 1)], [ref('city', 81)]),
]);
assert.deepEqual(current[0].importantObjects, [ref('city', 81)], 'current object-scoped importance survives migration');
assert.deepEqual(current[1].importantObjects, [], 'importance without a valid object link is rejected');
const scopedEntries = migrateChronicle([
  { ...entry('Country-scoped event', [ref('country', 3)]), scope: 'country', scopeCountryId: 3 },
  { ...entry('World-scoped event', []), scope: 'world', scopeCountryId: 3 },
  entry('Legacy event without source metadata', []),
]);
assert.deepEqual(scopedEntries.map(({ scope, scopeCountryId }) => [scope, scopeCountryId]), [
  ['country', 3], ['world', undefined], [undefined, undefined],
], 'метаданные источника сохраняются, а старые записи остаются без классификации');

const countryArchive = migrateChronicle([
  entry('Country and city event', [ref('country', 3), ref('city', 40)], [ref('city', 40)]),
  entry('Country split', [ref('country', 3), ref('country', 4)], [ref('country', 3), ref('country', 4)]),
  entry('Other country event', [ref('country', 8)], [ref('country', 8)]),
]);
assert.deepEqual(filterChronicle(countryArchive, [ref('country', 3)]).map(({ text }) => text),
  ['Country and city event', 'Country split'], 'object history only includes linked records');
assert.equal(isChronicleImportant(countryArchive[0], ref('country', 3)), false,
  'a city-important event does not become country-important');
assert.equal(isChronicleImportant(countryArchive[0], ref('city', 40)), true,
  'the same event remains important in the city history');
const transferred = transferCountryChronicle(countryArchive, 3, [9], true);
assert.equal(transferred.length, countryArchive.length, 'transferring object links never deletes global records');
assert.equal(isChronicleImportant(transferred[1], ref('country', 9)), true,
  'successor countries inherit importance in transferred country history');
assert.equal(isChronicleImportant(transferred[1], ref('country', 3)), false,
  'a dissolved country does not retain a stale importance link');
assert.equal(isChronicleImportant(transferred[0], ref('country', 9)), false,
  'country transfer does not make an unrelated city event country-important');
assert.deepEqual(transferred[0].objects, [ref('city', 40), ref('country', 9)],
  'transferring a city event preserves its stable city link');
assert.deepEqual(transferred[2].objects, [ref('country', 8)], 'unrelated country history is unchanged');

const longArchive = Array.from({ length: 160 }, (_, index) => entry(
  `Event ${index}`,
  [ref('country', 7)],
  index === 115 || index === 150 ? [ref('country', 7)] : [],
));
const objectHistory = filterChronicle(longArchive, [ref('country', 7)]);
assert.equal(objectHistory.length, CHRONICLE_OBJECT_HISTORY_LIMIT + 2,
  'object history keeps the newest 100 records and older important records for that object');
assert.equal(objectHistory[0].text, 'Event 0', 'object history remains newest first');
assert.deepEqual(objectHistory.slice(-2).map(({ text }) => text), ['Event 115', 'Event 150'],
  'old important records survive filtering');
assert.equal(filterChronicle(longArchive, [ref('country', 99)]).length, 0,
  'importance does not make unrelated objects inherit a record');
assert.equal(searchChronicle(longArchive, { reference: ref('country', 7) }).length, 160,
  'archive search reaches linked records older than the profile history limit');
assert.equal(searchChronicle(longArchive, { references: [ref('country', 7)] }).length, objectHistory.length,
  'entity filters show only records that belong to the entity profile chronicle');
assert.equal(chroniclePage(searchChronicle(longArchive, { reference: ref('country', 7) }), 1)[0].text, 'Event 25',
  'filtered archive pages keep newest-first order');
assert.deepEqual(searchChronicle([
  entry('Основан город ВЕЖА', [], []),
  entry('Основан город', [], []),
], { text: 'основан вежа' }).map(({ text }) => text),
['Основан город ВЕЖА'], 'search ignores letter case and requires every search term');
assert.equal(searchChronicle(longArchive, { year: 'invalid' }).length, 0,
  'invalid year filters do not return the unfiltered archive');
const filteredArchive = [
  entry('A', [ref('country', 7), ref('person', 4)]),
  { ...entry('B', [ref('country', 7), ref('person', 4)]), year: 1001 },
  entry('C', [ref('country', 7)]),
];
assert.deepEqual(searchChronicle(filteredArchive, {
  references: [ref('country', 7), ref('person', 4)],
  years: [1000],
}).map(({ text }) => text), ['A'],
'фильтры сущностей пересекаются, а выбранные годы ограничивают тот же архив');
assert.deepEqual(searchChronicle(filteredArchive, {
  references: [ref('country', 7), ref('person', 4)],
  years: [1000, 1001],
}).map(({ text }) => text), ['A', 'B'],
'несколько выбранных годов работают как единая группа при пересечении фильтров сущностей');
assert.deepEqual(findChronicleMentions('Северная Республика и Республика.', [
  { reference: ref('country', 1), name: 'Республика' },
  { reference: ref('country', 2), name: 'Северная Республика' },
]).map(({ reference, name }) => [reference.id, name]), [
  [2, 'Северная Республика'],
  [1, 'Республика'],
], 'для ссылок выбирается самое длинное совпадение, а вложенные совпадения не дублируются');

const archivePages = Array.from({ length: 61 }, (_, index) => entry(`Archive ${index}`, []));
assert.equal(chroniclePage(archivePages, 0).length, CHRONICLE_PAGE_SIZE, 'global archive initially exposes 25 records');
assert.equal(chroniclePage(archivePages, 1)[0].text, 'Archive 25', 'the next page starts after the first 25');
assert.equal(chroniclePage(archivePages, 2).length, 11, 'the last page contains only remaining records');

const thousandsArchive = Array.from({ length: 3000 }, (_, index) => entry(
  `Thousands archive ${index}`,
  [ref('country', 7)],
  index === 2999 ? [ref('country', 7)] : [],
));
const thousandsObjectHistory = filterChronicle(thousandsArchive, [ref('country', 7)]);
assert.equal(thousandsObjectHistory.length, CHRONICLE_OBJECT_HISTORY_LIMIT + 1,
  'country profiles keep recent entries and old entries important for that country');
assert.equal(thousandsObjectHistory.at(-1).text, 'Thousands archive 2999',
  'the oldest important country entry remains available in the profile');
assert.equal(chroniclePage(thousandsObjectHistory, Math.floor((thousandsObjectHistory.length - 1) / CHRONICLE_PAGE_SIZE))
  .some((item) => item.text === 'Thousands archive 2999' && isChronicleImportant(item, ref('country', 7))), true,
'later pages retain old country-important events');

const logPanelSource = readFileSync('components/game/LogPanel.tsx', 'utf8');
assert.match(logPanelSource, /selectedReferences\.some\(\(reference\) => isChronicleImportant\(entry, reference\)\)/u,
  'летопись выделяет важность для любого активного фильтра сущности');
assert.match(logPanelSource, /references: selectedReferences[\s\S]*years: selectedYears/u,
  'архив одновременно применяет несколько фильтров сущностей и годов');
assert.match(logPanelSource, /hasActiveFilters && \([\s\S]*styles\.activeFilters/u,
  'метки фильтров появляются только при активном фильтре');
assert.match(logPanelSource, /const visibleReferences = selectedReferences\.filter\(\(reference\) =>[\s\S]*!chronicleReferencesEqual\(initialReference, reference\)/u,
  'обязательный фильтр летописи сущности скрыт среди выбранных фильтров');
assert.match(logPanelSource, /if \(initialReference && chronicleReferencesEqual\(initialReference, reference\)\) return;/u,
  'обязательный фильтр страницы нельзя удалить');
assert.match(logPanelSource, /\{visibleReferences\.map\(\(reference\) =>/u,
  'в метках показываются только дополнительные фильтры');
assert.match(logPanelSource, /onPress=\{\(\) => addYear\(entry\.year\)\}/u,
  'год события можно выбрать как фильтр архива');
assert.doesNotMatch(logPanelSource, /entry\.important\b/u, 'общий архив не считает пометку объекта универсальной');

// Exercise character-event logging in the game, not just the entry model.
const characterWorld = World.create('random', 57133);
const characterCulture = characterWorld.newCulture(null, 1000);
const characterCountry = characterWorld.newCountry({
  rank: 'тест',
  cultureId: characterCulture.id,
  religionId: null,
  density: 80,
  foundedYear: 1000,
  parentId: null,
});
const characterGame = new Game(characterWorld, 'all');
const makePerson = (gender, age, parents = []) => {
  const person = createPerson(1000, age, undefined, parents, characterCulture.id, null);
  person.gender = gender;
  person.countryId = characterCountry.id;
  characterWorld.people.push(person);
  return person;
};
const mother = makePerson('female', 25);
const father = makePerson('male', 30);
marry(characterWorld, characterCountry, mother, father);
characterGame.applyCharacterEvent(characterCountry, { kind: 'birth', personIds: [mother.id, father.id] }, null);
const birthEvent = characterGame.log[0];
const child = characterWorld.people.find((person) => person.parents.includes(mother.id));
assert.ok(child, 'the game creates a child for a valid birth event');
for (const person of [mother, father, child]) {
  assert.equal(isChronicleImportant(birthEvent, ref('person', person.id)), true,
    'a child birth is important in the parent and child histories');
}
assert.equal(isChronicleImportant(birthEvent, ref('country', characterCountry.id)), false,
  'a child birth is not country-important');

const spouses = [makePerson('female', 23), makePerson('male', 27)];
characterGame.applyCharacterEvent(characterCountry, { kind: 'marriage', personIds: spouses.map(({ id }) => id) }, null);
for (const person of spouses) assert.equal(isChronicleImportant(characterGame.log[0], ref('person', person.id)), true,
  'marriage is important to both spouses');

characterGame.applyCharacterEvent(characterCountry, { kind: 'death', personIds: [child.id] }, null);
const childDeath = characterGame.log[0];
for (const person of [child, mother, father]) assert.equal(isChronicleImportant(childDeath, ref('person', person.id)), true,
  'death of a child is important in the child and parent histories');
assert.equal(isChronicleImportant(childDeath, ref('country', characterCountry.id)), false,
  'a child death is not country-important');
characterGame.discard();
console.log('Chronicle object-scoped importance, migration, filtering, and history transfer passed.');
