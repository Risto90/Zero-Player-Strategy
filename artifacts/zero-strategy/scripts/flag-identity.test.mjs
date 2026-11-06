import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import './binary-kernel-test-setup.mjs';
import { createEntityEmblem, createFlagStyleProfile } from '../game/flagIdentity.js';
import { describeFlagNovelty } from '../game/flagNovelty.js';
import { deserializeWorld, serializeWorld } from '../game/persistence.js';
import { World } from '../game/world.js';
import { WORLD_SEED } from '../game/geography.js';

const world = World.create('random', 260_281);
assert.equal(world.flagSeed, world.seed, 'явный seed случайной карты задаёт seed эмблем');
const culture = world.newCulture(null, 100);
const childCulture = world.newCulture(culture, 200);
assert.ok(culture.styleProfile, 'новая культура получает сохранённый стилевой профиль');
assert.equal(childCulture.styleProfile.profileId, culture.styleProfile.profileId, 'культурные ветви наследуют профиль');
assert.equal(childCulture.styleProfile.identity.parentStyleRef, `culture:${culture.id}:${culture.styleProfile.profileId}`);
assert.equal(childCulture.flagIdentity.entityId, childCulture.id, 'идентичность культуры опирается на её постоянный ID');
const taggedParentStyle = createFlagStyleProfile(world.seed, 'culture', 880, 'culture-style', ['neutral']);
const taggedChildStyle = createFlagStyleProfile(world.seed, 'culture', 881, 'culture-style', [], {
  id: 880,
  styleProfile: taggedParentStyle,
});
assert.deepEqual(taggedChildStyle.tags, taggedParentStyle.tags, 'культурные ветви наследуют теги родителя без собственной настройки');

const religion = world.newReligion(150);
const childReligion = world.newReligion(250, religion);
assert.ok(religion.emblemSpec, 'новая религия получает символ');
assert.notEqual(childReligion.styleProfile.profileId, religion.styleProfile.profileId,
  'этот детерминированный сид выбирает новую совместимую половину ветвления');
assert.notEqual(childReligion.emblemSpec.meta.visual_hash, religion.emblemSpec.meta.visual_hash, 'родственные символы остаются различимыми');
assert.equal(childReligion.flagIdentity.relationshipType, 'religion-branch');

const country = world.newCountry({
  rank: 'государство',
  cultureId: culture.id,
  religionId: religion.id,
  density: 1,
  foundedYear: 100,
  parentId: null,
});
assert.ok(country.emblemSpec, 'новая страна получает флаг');
assert.equal(country.emblemSpec.profile_id, culture.styleProfile.profileId, 'страна использует профиль своей культуры');
assert.equal(country.flagIdentity.worldSeed, world.seed);
assert.equal(country.flagIdentity.flagSeed, world.flagSeed);
assert.equal(country.flagIdentity.entityType, 'country');
assert.equal(country.flagIdentity.cultureId, culture.id, 'флаг хранит связь с культурой');

const availableCityPixels = world.landIndex.filter((pixel) => !world.cityAt(pixel));
const rankOneCity = world.addCity(country.id, availableCityPixels[0], 1, false, 1);
const rankTwoCity = world.addCity(country.id, availableCityPixels[1], 2, false, 1);
assert.ok(rankOneCity);
assert.equal(rankOneCity.emblemSpec, undefined, 'города первого ранга не получают герб');
assert.ok(rankTwoCity?.emblemSpec, 'города второго ранга получают герб при создании');
assert.equal(rankTwoCity.flagIdentity.entityId, rankTwoCity.chronicleId, 'идентичность города опирается на постоянный номер летописи');
assert.match(rankTwoCity.emblemSvg, /^<svg\b/, 'герб создаётся вместе с сохранённым SVG');

const saved = serializeWorld(world);
assert.equal(saved.flagSeed, world.flagSeed, 'сохранение содержит отдельный seed эмблем');
assert.equal(saved.countries[0].emblemSvg, country.emblemSvg, 'сохранение хранит SVG страны');
assert.equal(saved.religions[1].emblemSvg, childReligion.emblemSvg, 'сохранение хранит SVG религии');
assert.equal(saved.cities[1].emblemSvg, rankTwoCity.emblemSvg, 'сохранение хранит SVG города');
for (const [index, entity] of [
  ...saved.countries,
  ...saved.cities,
  ...saved.cultures,
  ...saved.religions,
  ...Object.values(saved.dynastyEmblems ?? {}),
].entries()) {
  if (entity.emblemSvg) {
    entity.emblemSvg = entity.emblemSvg.replace(/^<svg\b/u, `<svg data-saved-image="${index}"`);
  }
}
const loaded = deserializeWorld(saved);
assert.equal(loaded.flagSeed, world.flagSeed, 'загрузка восстанавливает seed эмблем');
assert.equal(loaded.countries[0].emblemSpec.meta.visual_hash, country.emblemSpec.meta.visual_hash);
assert.equal(loaded.religions[1].emblemSpec.meta.visual_hash, childReligion.emblemSpec.meta.visual_hash);
assert.equal(loaded.cities[1].emblemSpec.meta.visual_hash, rankTwoCity.emblemSpec.meta.visual_hash);
assert.equal(loaded.countries[0].emblemSvg, saved.countries[0].emblemSvg,
  'загрузка сохраняет готовый SVG страны без повторного рендеринга');
assert.equal(loaded.religions[1].emblemSvg, saved.religions[1].emblemSvg,
  'загрузка сохраняет готовый SVG религии без повторного рендеринга');
assert.equal(loaded.cities[1].emblemSvg, saved.cities[1].emblemSvg,
  'загрузка сохраняет готовый SVG города без повторного рендеринга');
assert.equal(loaded.cities[0].emblemSpec, undefined);

const missingSvgSave = JSON.parse(JSON.stringify(saved));
for (const entity of [
  ...missingSvgSave.countries,
  ...missingSvgSave.cities,
  ...missingSvgSave.cultures,
  ...missingSvgSave.religions,
  ...Object.values(missingSvgSave.dynastyEmblems ?? {}),
]) {
  delete entity.emblemSvg;
}
const migratedSvgWorld = deserializeWorld(missingSvgSave);
assert.match(migratedSvgWorld.countries[0].emblemSvg, /^<svg\b/,
  'старое сохранение с FlagSpec однократно получает отсутствующий SVG');
const migratedSvgSave = serializeWorld(migratedSvgWorld);
const reopenedMigratedWorld = deserializeWorld(migratedSvgSave);
assert.equal(reopenedMigratedWorld.countries[0].emblemSvg, migratedSvgWorld.countries[0].emblemSvg,
  'после миграции готовый SVG сохраняется и больше не пересоздаётся');

const legacy = JSON.parse(JSON.stringify(saved));
delete legacy.flagSeed;
delete legacy.generatedFlagKeys;
for (const entity of [...legacy.countries, ...legacy.cities, ...legacy.cultures, ...legacy.religions]) {
  delete entity.emblemSpec;
  delete entity.flagIdentity;
  delete entity.styleProfile;
  delete entity.emblemSvg;
}
const migrated = deserializeWorld(legacy);
const migratedSave = serializeWorld(migrated);
const reopened = deserializeWorld(migratedSave);
assert.equal(migrated.flagSeed, legacy.seed, 'старое сохранение использует прежний seed карты');
assert.equal(migrated.cities[0].emblemSpec, undefined);
assert.equal(reopened.countries[0].emblemSpec.meta.visual_hash, migrated.countries[0].emblemSpec.meta.visual_hash);
assert.equal(reopened.cities[1].emblemSpec.meta.visual_hash, migrated.cities[1].emblemSpec.meta.visual_hash,
  'новые изображения после миграции сохраняются вместе с восстановленными спеками');
assert.equal(reopened.countries[0].emblemSvg, migrated.countries[0].emblemSvg,
  'после первой миграции загружается сохранённое SVG, а не создаётся новое');
assert.equal(migrated.cultures[1].styleProfile.profileId, migrated.cultures[0].styleProfile.profileId);

const firstCountryIn = (gameWorld) => {
  const firstCulture = gameWorld.newCulture(null, 0);
  return gameWorld.newCountry({
    rank: 'государство',
    cultureId: firstCulture.id,
    religionId: null,
    density: 1,
    foundedYear: 0,
    parentId: null,
  });
};
const firstGameA = World.create('world');
const firstGameB = World.create('world');
assert.equal(firstGameA.seed, firstGameB.seed, 'обычная карта сохраняет прежнюю географию');
assert.notEqual(firstGameA.flagSeed, firstGameB.flagSeed, 'новая игра получает отдельный seed эмблем');
assert.notEqual(
  firstCountryIn(firstGameA).emblemSpec.meta.visual_hash,
  firstCountryIn(firstGameB).emblemSpec.meta.visual_hash,
  'первый флаг отличается между новыми играми',
);

const seedSamples = Array.from({ length: 64 }, (_, index) => {
  const flagSeed = 10_000 + index;
  const styleProfile = createFlagStyleProfile(
    WORLD_SEED,
    'culture',
    0,
    'culture-style',
    [],
    undefined,
    flagSeed,
  );
  const { emblemSpec } = createEntityEmblem(
    WORLD_SEED,
    'country',
    0,
    'country-flag',
    styleProfile,
    undefined,
    undefined,
    flagSeed,
  );
  return { flagSeed, styleProfile, emblemSpec, novelty: describeFlagNovelty(emblemSpec) };
});
assert.equal(new Set(seedSamples.map(({ emblemSpec }) => emblemSpec.meta.visual_hash)).size, seedSamples.length,
  'разные игровые seed дают разные флаги первой страны');
assert.deepEqual(new Set(seedSamples.map(({ styleProfile }) => styleProfile.era)), new Set([0, 1, 2, 3, 4, 5, 6]),
  'выбор охватывает все разрешённые эпохи');
assert.ok(seedSamples.some(({ novelty }) => novelty.outline_class !== 'RECT'),
  'игровая интеграция генерирует полотнища разных форм');
assert.ok(seedSamples.filter(({ novelty }) => novelty.module_family === 'NONE').length < seedSamples.length / 3,
  'простые флаги без эмблем не достигают трети корпуса');
assert.equal(seedSamples.filter(({ emblemSpec }) => emblemSpec.meta.color_count === 1).length, 0,
  'генератор не сводит корпус к одноцветным полотнищам');
assert.equal(seedSamples.filter(({ emblemSpec }) => emblemSpec.meta.generation_stats?.fallback_used).length, 0,
  'обычный корпус не маскируется fallback-генерацией');

const gameSource = readFileSync(join(process.cwd(), 'game/game.ts'), 'utf8');
assert.match(gameSource, /import \{ createCityHeraldry \} from '\.\/flagHeraldry'/u);
const cityUpgrade = gameSource.match(/case 'upgradeCity':\s*\{([\s\S]*?)\n\s*case 'waneCity':/u)?.[1] ?? '';
assert.match(cityUpgrade, /city\.rank = \(city\.rank \+ 1\)/u,
  'повышение сначала меняет ранг города');
assert.match(cityUpgrade, /city\.rank >= 2 && city\.rank <= 6 && !city\.emblemSpec[\s\S]*?createCityHeraldry\(w, target, city\)/u,
  'при повышении герб создаётся общей процедурой выбора эпохи и профиля города');
const cityHeraldrySource = readFileSync(join(process.cwd(), 'game/flagHeraldry.ts'), 'utf8');
assert.match(cityHeraldrySource, /country\.flagIdentity\?\.seed[\s\S]*?world\.currentMove \+ city\.id/u,
  'сид герба города учитывает сид страны, ход и постоянный идентификатор города');
const cardSources = [
  readFileSync(join(process.cwd(), 'app/country/[id].tsx'), 'utf8'),
  readFileSync(join(process.cwd(), 'app/city/[id].tsx'), 'utf8'),
  readFileSync(join(process.cwd(), 'app/religion/[id].tsx'), 'utf8'),
];
for (const source of cardSources) assert.match(source, /EmblemPreview/);
assert.match(
  readFileSync(join(process.cwd(), 'components/profiles/PersistedEmblemImage.tsx'), 'utf8'),
  /SvgXml/,
  'общий компонент отображает сохранённый SVG в Expo',
);
assert.match(
  readFileSync(join(process.cwd(), 'components/profiles/PersistedEmblemImage.tsx'), 'utf8'),
  /createElement\('img'/,
  'в браузере сохранённый SVG остаётся обычным изображением',
);

console.log('Проверки идентичности, родства, рангов, сохранения и миграции завершены.');
