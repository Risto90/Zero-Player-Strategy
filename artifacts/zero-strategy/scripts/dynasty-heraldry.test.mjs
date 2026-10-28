import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dynastyFocusPersonId, ensureDynastyEmblems } from '../game/dynastyHeraldry.js';
import { deserializeWorld, serializeWorld } from '../game/persistence.js';
import { World } from '../game/world.js';

const root = process.cwd();
const world = World.create('random', 281_028);
const culture = world.newCulture(null, 1);
const religion = world.newReligion(1);
const country = world.newCountry({
  rank: 'государство',
  cultureId: culture.id,
  religionId: religion.id,
  density: 1,
  foundedYear: 1,
  parentId: null,
});
const familyId = 920_026;
const familyName = 'Дом Тестовый';
const template = country.ruler;
const members = Array.from({ length: 15 }, (_, index) => ({
  ...template,
  id: 90_000 + index,
  familyId,
  familyName,
  alive: index >= 10,
  age: index >= 10 ? 40 : 90,
  bornAt: index >= 10 ? 50 + index - 10 : 100 - index,
  deathYear: index >= 10 ? null : 180 + index,
  countryId: country.id,
  parents: [],
  spouseIds: [],
  loverIds: [],
  formerRulerOf: [],
  traits: [...template.traits],
}));

world.people.push(...members.slice(0, 14));
country.ruler = members[2];
country.rulerTerms = [
  { personId: members[0].id, startYear: 10, endYear: 20, office: 'ruler' },
  { personId: members[1].id, startYear: 20, endYear: 30, office: 'ruler' },
  { personId: members[2].id, startYear: 30, endYear: null, office: 'ruler' },
];
country.previousRulerIds = [members[0].id, members[1].id];
assert.deepEqual(ensureDynastyEmblems(world), [], 'четырнадцати членов недостаточно, даже при трёх правителях');

world.people.push(members[14]);
country.ruler = members[1];
country.rulerTerms = country.rulerTerms.slice(0, 2);
country.previousRulerIds = [members[0].id];
assert.deepEqual(ensureDynastyEmblems(world), [], 'двух правителей недостаточно при пятнадцати членах');

country.ruler = members[2];
country.rulerTerms = [
  ...country.rulerTerms,
  { personId: members[2].id, startYear: 30, endYear: null, office: 'ruler' },
];
country.previousRulerIds = [members[0].id, members[1].id];
assert.deepEqual(ensureDynastyEmblems(world), [familyId], 'герб появляется при выполнении обоих порогов');

const heraldry = world.dynastyEmblems[familyId];
assert.ok(heraldry?.emblemSpec, 'герб сохраняется как спецификация');
assert.equal(heraldry.flagIdentity.entityType, 'dynasty');
assert.equal(heraldry.flagIdentity.entityId, familyId);
assert.equal(heraldry.flagIdentity.generationPurpose, 'dynasty-coat');
assert.ok(heraldry.flagIdentity.generatorVersion, 'в идентичности сохранена версия генератора');
assert.equal(dynastyFocusPersonId(world.people, familyId), members[10].id,
  'центр дерева выбирается по старшему живому члену, а не по умершим');
assert.deepEqual(ensureDynastyEmblems(world), [], 'повторная проверка не меняет уже присвоенный герб');

const saved = serializeWorld(world);
assert.equal(saved.dynastyEmblems[familyId].emblemSpec.meta.visual_hash, heraldry.emblemSpec.meta.visual_hash,
  'спецификация герба попадает в сохранение');
const loaded = deserializeWorld(saved);
assert.equal(loaded.dynastyEmblems[familyId].emblemSpec.meta.visual_hash, heraldry.emblemSpec.meta.visual_hash,
  'загрузка сохраняет уже выданный герб');

const legacy = JSON.parse(JSON.stringify(saved));
delete legacy.dynastyEmblems;
const legacyLoaded = deserializeWorld(legacy);
assert.deepEqual(legacyLoaded.dynastyEmblems, {}, 'старое сохранение читается без нового поля');
assert.deepEqual(ensureDynastyEmblems(legacyLoaded), [familyId], 'миграция старого сохранения дополняет недостающий герб');
assert.equal(legacyLoaded.dynastyEmblems[familyId].emblemSpec.meta.visual_hash, heraldry.emblemSpec.meta.visual_hash,
  'миграция выдаёт тот же детерминированный герб');

const gameSource = readFileSync(join(root, 'game/game.ts'), 'utf8');
assert.match(gameSource, /normalizePolitics\(game\.world, saved\.year\);[\s\S]*?refreshHeirs\(game\.world, saved\.year\);[\s\S]*?ensureDynastyEmblems\(game\.world\)/u,
  'старые сохранения мигрируют после восстановления истории персонажей');
assert.match(gameSource, /ensureDynastyEmblems\(this\.world\)/u,
  'игра проверяет пороги после очередного года симуляции');

const personPage = readFileSync(join(root, 'app/person/[id].tsx'), 'utf8');
const dynastyPage = readFileSync(join(root, 'app/dynasty/[id].tsx'), 'utf8');
const chronicle = readFileSync(join(root, 'components/game/ChronicleMessage.tsx'), 'utf8');
const countryLists = readFileSync(join(root, 'components/profiles/CountryLists.tsx'), 'utf8');
assert.match(personPage, /DynastyEmblemLink[\s\S]*focusPersonId=\{person\.id\}[\s\S]*size=\{32\}/u,
  'значок рядом с именем персонажа ведёт к дереву с центровкой на нём');
assert.match(personPage, /factFamilyPlain/u,
  'при наличии герба название династии в карточке не является ссылкой');
assert.match(dynastyPage, /pointerEvents="box-none" style=\{styles\.dynastyEmblemOverlay\}[\s\S]*EmblemPreview/u,
  'полноразмерный герб остаётся поверх перемещаемого полотна');
assert.match(dynastyPage, /DynastyEmblemLink[\s\S]*focusPersonId=\{person\.id\}[\s\S]*size=\{64\}/u,
  'герб внешнего ребёнка заменяет стрелку и открывает его династию с его центрированием');
assert.match(chronicle, /DynastyEmblemLink[\s\S]*focusPersonId=\{entity\.reference\.id\}[\s\S]*size=\{16\}[\s\S]*<Pressable/u,
  'в летописи герб стоит перед отдельным значком профиля персонажа');
assert.match(countryLists, /function PersonProfileRow[\s\S]*DynastyEmblemLink/u,
  'списки персонажей на страницах страны показывают гербы их династий');

console.log('Пороговые условия, устойчивое сохранение, миграция и отображение гербов проверены.');
