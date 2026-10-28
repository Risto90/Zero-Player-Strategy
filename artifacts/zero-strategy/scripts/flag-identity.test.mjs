import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFlagStyleProfile } from '../game/flagIdentity.js';
import { renderFlagSpec } from '../game/flagRenderer.js';
import { deserializeWorld, serializeWorld } from '../game/persistence.js';
import { World } from '../game/world.js';

const world = World.create('random', 260_281);
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
assert.equal(childReligion.styleProfile.profileId, religion.styleProfile.profileId, 'религиозные ветви наследуют профиль');
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
assert.equal(country.flagIdentity.entityType, 'country');
assert.equal(country.flagIdentity.cultureId, culture.id, 'флаг хранит связь с культурой');

const rankOneCity = world.addCity(country.id, world.landIndex[0], 1);
const rankTwoCity = world.addCity(country.id, world.landIndex[1], 2);
assert.ok(rankOneCity);
assert.equal(rankOneCity.emblemSpec, undefined, 'города первого ранга не получают герб');
assert.ok(rankTwoCity?.emblemSpec, 'города второго ранга получают герб при создании');
assert.equal(rankTwoCity.flagIdentity.entityId, rankTwoCity.chronicleId, 'идентичность города опирается на постоянный номер летописи');
assert.match(renderFlagSpec(rankTwoCity.emblemSpec), /^<svg\b/);

const saved = serializeWorld(world);
const loaded = deserializeWorld(saved);
assert.equal(loaded.countries[0].emblemSpec.meta.visual_hash, country.emblemSpec.meta.visual_hash);
assert.equal(loaded.religions[1].emblemSpec.meta.visual_hash, childReligion.emblemSpec.meta.visual_hash);
assert.equal(loaded.cities[1].emblemSpec.meta.visual_hash, rankTwoCity.emblemSpec.meta.visual_hash);
assert.equal(loaded.cities[0].emblemSpec, undefined);

const legacy = JSON.parse(JSON.stringify(saved));
for (const entity of [...legacy.countries, ...legacy.cities, ...legacy.cultures, ...legacy.religions]) {
  delete entity.emblemSpec;
  delete entity.flagIdentity;
  delete entity.styleProfile;
}
const migrated = deserializeWorld(legacy);
const reopened = deserializeWorld(legacy);
assert.equal(migrated.countries[0].emblemSpec.meta.visual_hash, country.emblemSpec.meta.visual_hash);
assert.equal(migrated.cities[1].emblemSpec.meta.visual_hash, rankTwoCity.emblemSpec.meta.visual_hash);
assert.equal(migrated.cities[0].emblemSpec, undefined);
assert.equal(reopened.countries[0].emblemSpec.meta.visual_hash, migrated.countries[0].emblemSpec.meta.visual_hash);
assert.equal(migrated.cultures[1].styleProfile.profileId, migrated.cultures[0].styleProfile.profileId);

const gameSource = readFileSync(join(process.cwd(), 'game/game.ts'), 'utf8');
assert.match(gameSource, /city\.rank\s*>=\s*2\s*&&\s*city\.rank\s*<=\s*6\s*&&\s*!city\.emblemSpec[\s\S]{0,500}createEntityEmblem/);
const cityUpgrade = gameSource.match(/case 'upgradeCity':\s*\{([\s\S]*?)\n\s*case 'waneCity':/u)?.[1] ?? '';
assert.match(cityUpgrade, /city\.rank = \(city\.rank \+ 1\)/u,
  'повышение сначала меняет ранг города');
assert.match(cityUpgrade, /city\.rank >= 2 && city\.rank <= 6 && !city\.emblemSpec[\s\S]*?createEntityEmblem\([\s\S]*?city\.chronicleId[\s\S]*?city\.rank/u,
  'при переходе с ранга 1 на 2 герб создаётся по постоянному идентификатору города');
const cardSources = [
  readFileSync(join(process.cwd(), 'app/country/[id].tsx'), 'utf8'),
  readFileSync(join(process.cwd(), 'app/city/[id].tsx'), 'utf8'),
  readFileSync(join(process.cwd(), 'app/religion/[id].tsx'), 'utf8'),
];
for (const source of cardSources) assert.match(source, /EmblemPreview/);
assert.match(
  readFileSync(join(process.cwd(), 'components/profiles/EmblemPreview.tsx'), 'utf8'),
  /SvgXml/,
  'общий компонент использует SVG-рендерер для Expo и веба',
);

console.log('Проверки идентичности, родства, рангов, сохранения и миграции завершены.');
