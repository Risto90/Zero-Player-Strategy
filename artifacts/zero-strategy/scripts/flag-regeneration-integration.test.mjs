import assert from 'node:assert/strict';
import './binary-kernel-test-setup.mjs';
import { describeFlagNovelty } from '../game/flagNovelty.js';
import { deserializeWorld, serializeWorld } from '../game/persistence.js';
import { compatibleFlagProfileIds } from '../game/flagIdentity.js';
import { HUMAN_ORIGINS } from '../game/human.js';
import { flagStageRandom } from '../game/random.js';
import { World } from '../game/world.js';

function moveForBranch(seed, entityId, changeProfile) {
  for (let move = 1; move <= 128; move += 1) {
    if ((flagStageRandom(seed + move + entityId, 'S0_DERIVED_PROFILE')() < 0.5) === changeProfile) return move;
  }
  throw new Error('Не найдено зерно для проверки ветви вероятности 50%.');
}

const world = World.create('random', 260_281);
const culture = world.newCulture(null, 100, HUMAN_ORIGINS[0].id);
for (const origin of HUMAN_ORIGINS.slice(1)) world.newCulture(null, 100, origin.id);
const firstEraCounts = new Map();
for (const origin of HUMAN_ORIGINS) {
  const era = world.cultures.find((entry) => entry.parentId === null && entry.foundingRaceId === origin.id)?.styleProfile.era;
  firstEraCounts.set(era, (firstEraCounts.get(era) ?? 0) + 1);
}
assert.ok(Math.max(...firstEraCounts.values()) - Math.min(...firstEraCounts.values()) <= 1,
  'первые культуры рас распределяются только по наименее представленным эпохам');
const religion = world.newReligion(100);
const source = world.newCountry({
  rank: 'государство',
  cultureId: culture.id,
  religionId: religion.id,
  density: 1,
  foundedYear: 100,
  parentId: null,
});
source.modifiers.push('theocracy');
const countryReligion = world.newReligion(110, null, source);
assert.equal(countryReligion.styleProfile.era, source.styleProfile.era,
  'религия, основанная страной, наследует её эпоху');
assert.equal(countryReligion.styleProfile.profileId, source.styleProfile.profileId,
  'теократия всегда использует совместимый профиль страны');
const derived = world.newCountry({
  rank: 'государство',
  cultureId: culture.id,
  religionId: religion.id,
  density: 1,
  foundedYear: 120,
  parentId: source.id,
});

assert.equal(derived.styleProfile.era, source.styleProfile.era, 'производная страна сохраняет эпоху источника');
assert.equal(source.styleProfile.profileId, culture.styleProfile.profileId, 'первая страна наследует профиль культуры');
assert.equal(derived.flagIdentity.seed, derived.emblemSpec.seed, 'сид идентичности совпадает с сидом спецификации');
assert.match(derived.emblemSvg, /^<svg\b/u, 'производный герб создаётся вместе с готовым SVG');
const countryDimensionsMatch = Math.round(source.emblemSpec.outline.aspect * 1200) ===
  Math.round(derived.emblemSpec.outline.aspect * 1200);
const derivedFrame = derived.emblemSpec.root.layers.find((node) => node.kind === 'frame');
if (countryDimensionsMatch) {
  assert.ok(derivedFrame, 'при совпадении размеров производная страна получает составной флаг');
  assert.deepEqual([derivedFrame.frame.x0, derivedFrame.frame.y0], [0, 0],
    'первая композиция размещает источник в верхнем левом углу');
}

const pixel = world.landIndex.find((candidate) => !world.cityAt(candidate));
assert.notEqual(pixel, undefined, 'для города найден участок карты');
const city = world.addCity(derived.id, pixel, 2, false, 1);
assert.ok(city?.emblemSpec, 'город второго ранга получает герб');
assert.equal(city.styleProfile.era, derived.styleProfile.era, 'эпоха герба города наследуется от страны');
assert.equal(city.flagIdentity.seed, city.emblemSpec.seed, 'сид городского герба совпадает с сидом спецификации');
assert.ok(compatibleFlagProfileIds(city.styleProfile.era, city.styleProfile.tags)
  .includes(city.styleProfile.profileId), 'профиль герба города совместим с эпохой и тегами');
assert.match(city.emblemSvg, /^<svg\b/u, 'городской герб создаётся вместе с готовым SVG');
assert.ok(describeFlagNovelty(city.emblemSpec).visual_hash, 'составной герб доступен диагностике разнообразия');
const sourceIsComposite = String(derived.emblemSpec.seed).split('+').length > 1;
const compositeFrame = city.emblemSpec.root.layers.filter((node) => node.kind === 'frame').at(-1);
if (sourceIsComposite && Math.round(derived.emblemSpec.outline.aspect * 1200) ===
  Math.round(city.emblemSpec.outline.aspect * 1200)) {
  assert.ok(compositeFrame, 'при совпадении размеров вторая композиция добавляет слой');
  assert.deepEqual([compositeFrame.frame.x0, compositeFrame.frame.y0], [0.5, 0.5],
    'вторая композиция размещает новую эмблему в нижнем правом углу');
  assert.equal(String(city.emblemSpec.seed).split('+').length, 3,
    'сид двух последовательных композиций сохраняет три части');
}

const countrySeed = Number(source.flagIdentity.seed);
assert.ok(compatibleFlagProfileIds(source.styleProfile.era, source.styleProfile.tags)
  .some((profileId) => profileId !== source.styleProfile.profileId),
'для проверки 50-процентной ветви есть альтернативный профиль страны');
let countryId = world.countries.length;
world.currentMove = moveForBranch(countrySeed, countryId, true);
const changedCountry = world.newCountry({
  rank: source.rank,
  cultureId: source.cultureId,
  religionId: source.religionId,
  density: source.density,
  foundedYear: 101,
  parentId: source.id,
});
assert.notEqual(changedCountry.styleProfile.profileId, source.styleProfile.profileId,
  'производная страна выбирает другой профиль при выпадении ветви смены');

countryId = world.countries.length;
world.currentMove = moveForBranch(countrySeed, countryId, false);
const inheritedCountry = world.newCountry({
  rank: source.rank,
  cultureId: source.cultureId,
  religionId: source.religionId,
  density: source.density,
  foundedYear: 102,
  parentId: source.id,
});
assert.equal(inheritedCountry.styleProfile.profileId, source.styleProfile.profileId,
  'производная страна сохраняет профиль при выпадении ветви наследования');

const religionSeed = Number(religion.flagIdentity.seed);
assert.ok(compatibleFlagProfileIds(religion.styleProfile.era, religion.styleProfile.tags)
  .some((profileId) => profileId !== religion.styleProfile.profileId),
'для проверки 50-процентной ветви есть альтернативный профиль религии');
let religionId = world.religions.length;
world.currentMove = moveForBranch(religionSeed, religionId, true);
const changedReligion = world.newReligion(103, religion);
assert.notEqual(changedReligion.styleProfile.profileId, religion.styleProfile.profileId,
  'производная религия выбирает другой профиль при выпадении ветви смены');

religionId = world.religions.length;
world.currentMove = moveForBranch(religionSeed, religionId, false);
const inheritedReligion = world.newReligion(104, religion);
assert.equal(inheritedReligion.styleProfile.profileId, religion.styleProfile.profileId,
  'производная религия сохраняет профиль при выпадении ветви наследования');

world.currentMove = 1;
const saved = serializeWorld(world);
const loaded = deserializeWorld(saved);
assert.equal(loaded.countries[1].emblemSpec.meta.visual_hash, derived.emblemSpec.meta.visual_hash,
  'сохранённый флаг производной страны не меняется при загрузке');
assert.equal(loaded.cities[0].emblemSpec.meta.visual_hash, city.emblemSpec.meta.visual_hash,
  'сохранённый городской герб не меняется при загрузке');
assert.equal(loaded.countries[1].emblemSvg, derived.emblemSvg,
  'готовое SVG производного флага точно сохраняется при загрузке');
assert.equal(loaded.cities[0].emblemSvg, city.emblemSvg,
  'готовое SVG городского герба точно сохраняется при загрузке');

console.log('Проверены выбор профиля, производный флаг, городской герб, SVG и сохранение.');
