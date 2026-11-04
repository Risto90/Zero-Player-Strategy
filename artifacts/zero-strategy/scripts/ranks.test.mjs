import assert from 'node:assert/strict';
import { INK, MAP_POINT_AREA_KM2, RANKS, RANK_AREA_BY_NAME, countryRankForArea } from '../game/config.ts';
import { firstCreateCard } from '../game/cards.ts';
import { World } from '../game/world.ts';

assert.equal(RANKS.length, 10, 'на карте доступны все десять исторических рангов');
for (let index = 0; index < RANKS.length; index += 1) {
  assert.ok(RANKS[index].ink >= 1, 'каждый порог занимает как минимум одну точку');
  if (index > 0) assert.ok(RANKS[index].ink < RANKS[index - 1].ink, 'пороги строго убывают по площади');
}
assert.ok(MAP_POINT_AREA_KM2 > 0);
assert.equal(
  RANK_AREA_BY_NAME['Империя'],
  Math.round(1_200_000 / MAP_POINT_AREA_KM2),
  'порог имперского ранга соответствует площади империи Карла Великого',
);
assert.equal(
  INK.expand,
  RANK_AREA_BY_NAME['Гегемония'],
  'территориальная кисть может получить ранг гегемонии, если доступной земли достаточно',
);
assert.equal(
  INK.colonization,
  RANK_AREA_BY_NAME['Гегемония'],
  'кисть колонизации использует тот же верхний предел рангов',
);
assert.equal(countryRankForArea(RANKS[0].ink), RANKS[0].name);
assert.equal(countryRankForArea(RANKS.at(-1).ink - 1), RANKS.at(-1).name);

const world = World.create('random', 199_031);
const culture = world.newCulture(null, 1000);
const country = world.newCountry({
  rank: RANKS[0].name,
  cultureId: culture.id,
  religionId: null,
  density: 1,
  foundedYear: 1000,
  parentId: null,
});
const smallestRank = RANKS.at(-1).name;
const nextRank = RANKS.at(-2);
assert.equal(country.rank, smallestRank, 'пустая страна начинает с ранга фактической площади');
const pixels = Array.from(world.landIndex.slice(0, nextRank.ink));
assert.equal(pixels.length, nextRank.ink, 'для проверки выделены точки до порога следующего ранга');
for (const pixel of pixels.slice(0, -1)) world.setOwner(pixel, country.id + 1);
assert.equal(country.rank, smallestRank, 'страна не повышается до достижения порога');
world.setOwner(pixels.at(-1), country.id + 1);
assert.equal(country.rank, nextRank.name, 'страна повышается при достижении площади следующего ранга');
world.setOwner(pixels[0], 0);
assert.equal(country.rank, smallestRank, 'страна понижается при сокращении ниже порога');

const createCard = firstCreateCard(world, 1001);
assert.ok(createCard, 'создаётся карточка основания новой страны');
assert.ok(createCard.brushRank, 'кисть новой страны получает отдельный ранг');
assert.ok(createCard.ink <= RANK_AREA_BY_NAME[createCard.brushRank],
  'чернила не превышают предел выбранного ранга кисти');
const founded = world.countries[createCard.newCountryId];
assert.equal(founded.rank, smallestRank, 'ранг государства не наследуется от ранга кисти');
assert.equal(founded.religionId, null, 'новая страна начинает с населения-атеистов');
assert.equal(founded.density, 1, 'новая страна создаёт население с плотностью 1 чел./км²');

console.log('Пороги площади стран, отдельные ранги кистей и безрелигиозное основание проверены.');
