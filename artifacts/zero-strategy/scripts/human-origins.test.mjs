import assert from 'node:assert/strict';
import { World } from '../game/world.ts';
import { CardPainter } from '../game/brush.ts';
import { firstCreateCard } from '../game/cards.ts';
import { ageStage, createPerson, deathChance, oldAgeDeathChance, randomDeathChance } from '../game/government.ts';
import { birth, marry } from '../game/characters.ts';
import { deserializeWorld, serializeWorld } from '../game/persistence.ts';
import { ensureCityPopulationGroups } from '../game/settlements.ts';
import { normalizePolitics } from '../game/characters.ts';
import { MAP_WIDTH } from '../game/config.ts';
import {
  HUMAN_AGE_STAGES,
  HUMAN_ORIGINS,
  HUMAN_SPECIES,
  canonicalizeHumanOrigins,
  climateSuitability,
  expectedOriginsForPopulation,
  expectedOriginsFromPairCounts,
  humanOriginIndex,
  humanOriginMixFromTable,
  inheritHumanOrigins,
  normalizeHumanOriginMix,
  randomHumanOriginId,
} from '../game/human.ts';

const names = ['Европейская', 'Негрская', 'Пигмейская', 'Бушменская', 'Эфиопская', 'Американоидная', 'Австралоидная', 'Веддоидная'];
assert.deepEqual(HUMAN_ORIGINS.map((origin) => origin.name), names);
assert.deepEqual(
  HUMAN_ORIGINS.map((_, index) => randomHumanOriginId(() => (index + 0.25) / HUMAN_ORIGINS.length)),
  HUMAN_ORIGINS.map(({ id }) => id),
  'founding race selection covers every in-game race, regardless of current map population',
);
assert.equal(HUMAN_SPECIES.id, 'human');
assert.ok(HUMAN_ORIGINS.every((origin) => origin.parentSpeciesId === HUMAN_SPECIES.id && origin.ageStages === HUMAN_SPECIES.ageStages));
assert.deepEqual(HUMAN_AGE_STAGES.map(({ name, minimum, maximum }) => [name, minimum, maximum]), [
  ['младенец', 0, 2], ['ребёнок', 3, 7], ['отрок', 8, 11], ['подросток', 12, 19],
  ['молодой', 20, 28], ['зрелый', 29, 45], ['пожилой', 46, 65], ['старик', 66, Infinity],
]);
for (const [age, expected] of [
  [0, 'младенец'], [2, 'младенец'], [3, 'ребёнок'], [7, 'ребёнок'], [8, 'отрок'], [11, 'отрок'],
  [12, 'подросток'], [19, 'подросток'], [20, 'молодой'], [28, 'молодой'], [29, 'зрелый'],
  [45, 'зрелый'], [46, 'пожилой'], [65, 'пожилой'], [66, 'старик'],
]) assert.equal(ageStage(age), expected, `human age stage at ${age}`);

const europ = 'european', pygmy = 'pygmy', bushman = 'bushman';
const quartered = canonicalizeHumanOrigins(new Map([[europ, 37.5], [pygmy, 37.5], [bushman, 25]]));
assert.deepEqual(quartered, { ids: [europ, pygmy, bushman], shares: [50, 25, 25] }, 'ties use stable category order');
assert.deepEqual(canonicalizeHumanOrigins(new Map([[europ, 87.5], [pygmy, 12.5]])), {
  ids: [europ], shares: [100],
}, 'sub-quarter components are dropped rather than promoted');
const pairMix = expectedOriginsFromPairCounts(new Map([[europ, 3], [pygmy, 2]]));
assert.deepEqual(pairMix, { ids: [europ, pygmy], shares: [75, 25] },
  'pair composition uses 3 same-category pairs, 1 same-category pair, and 6 cross-category pairs');
assert.deepEqual(expectedOriginsForPopulation({ ids: [europ, pygmy], shares: [75, 25] }, 100), pairMix);
const inherited = inheritHumanOrigins({ ids: [europ], shares: [100] }, { ids: [bushman], shares: [100] });
assert.deepEqual(inherited, { ids: [europ, bushman], shares: [50, 50] });
assert.equal(deathChance(2), 1 - Math.pow(1 - 0.33, 1 / 3));
assert.equal(deathChance(3), 1 - Math.pow(1 - 0.20, 1 / 5));
assert.equal(randomDeathChance(20), 1 - Math.pow(1 - 0.01, 1 / 9),
  'the 1% random-death risk applies to the full 20–28 age band');
assert.equal(oldAgeDeathChance(20), 1 - Math.pow(1 - 0.01, 1 / 9),
  'the separate 1% old-age risk applies to the full 20–28 age band');
assert.equal(oldAgeDeathChance(66), 0.1,
  'from age 66 the design document sets the annual old-age risk to age minus 56 percent');
assert.equal(randomDeathChance(66), 0, 'the design document defines only old-age risk from 66 onward');
assert.deepEqual(normalizeHumanOriginMix({ ids: [europ, pygmy], shares: [62.5, 37.5] }), {
  ids: [europ, pygmy], shares: [75, 25],
});
for (const mix of [quartered, pairMix, inherited]) {
  assert.ok(mix.ids.length <= 4);
  assert.equal(mix.shares.reduce((sum, share) => sum + share, 0), 100);
  assert.ok(mix.shares.every((share) => [25, 50, 75, 100].includes(share)));
}
const european = { ids: [europ], shares: [100] };
const mixedFit = climateSuitability(inherited, 60, 50);
assert.equal(mixedFit, (
  climateSuitability(european, 60, 50) +
  climateSuitability({ ids: [bushman], shares: [100] }, 60, 50)
) / 2);

const world = World.create('random', 143);
const culture = world.newCulture(null, 1000);
const country = world.newCountry({
  rank: 'тест', cultureId: culture.id, religionId: null, density: 80, foundedYear: 1000, parentId: null,
});
const mother = createPerson(1000, 25);
const father = createPerson(1000, 27);
mother.gender = 'female';
father.gender = 'male';
mother.humanOrigin = { ids: [europ], shares: [100] };
father.humanOrigin = { ids: [bushman], shares: [100] };
world.people.push(mother);
marry(world, country, mother, father);
const child = birth(world, country, mother, father, 1001);
assert.ok(child);
assert.deepEqual(child.humanOrigin, inherited, 'a real newborn inherits both parents’ canonical origin mix');
const pixel = world.landIndex[0];
world.setOwner(pixel, country.id + 1);
world.density[pixel] = 80;
world.culture[pixel] = world.cultureTable.single(culture.id, 100);
const originTableId = world.humanOriginTable.intern(new Map([
  [humanOriginIndex(europ), 75], [humanOriginIndex(pygmy), 25],
]));
world.humanOrigins[pixel] = originTableId;
country.ruler.humanOrigin = inherited;
const city = world.addCity(country.id, pixel, 1, true);
city.population = 80;
ensureCityPopulationGroups(world, city);
assert.equal(city.populationGroups[0].humanOriginMix, originTableId);

const foundingWorld = new World(world.mapKind, world.seed, world.land, {
  humidity: world.humidity.slice(),
  temperature: world.temperature.slice(),
  drainage: world.drainage.slice(),
}, {
  water: world.water,
  rivers: world.rivers,
  landIndex: world.landIndex,
  riverPixelCount: world.riverPixelCount,
  majorRiverPixelCount: world.majorRiverPixelCount,
});
const existingPixel = foundingWorld.landIndex[0];
const existingCulture = foundingWorld.newCulture(null, 900);
const existingCountry = foundingWorld.newCountry({
  rank: 'тест', cultureId: existingCulture.id, religionId: null, density: 10, foundedYear: 900, parentId: null,
});
foundingWorld.setOwner(existingPixel, existingCountry.id + 1);
foundingWorld.density[existingPixel] = 10;
foundingWorld.culture[existingPixel] = foundingWorld.cultureTable.single(existingCulture.id, 100);
foundingWorld.humanOrigins[existingPixel] = foundingWorld.humanOriginTable.single(humanOriginIndex(europ), 100);

const foundingRaceId = randomHumanOriginId(() => 0.3);
assert.equal(foundingRaceId, pygmy);
assert.notEqual(foundingWorld.humanOriginTable.entries[foundingWorld.humanOrigins[existingPixel]].ids[0],
  humanOriginIndex(foundingRaceId), 'the chosen race is not required to already exist on the map');
const previousRandom = Math.random;
Math.random = () => 0.3;
let creationCard;
try {
  creationCard = firstCreateCard(foundingWorld, 1000);
} finally {
  Math.random = previousRandom;
}
assert.ok(creationCard);
const foundingCulture = foundingWorld.cultures[creationCard.newCultureId];
const foundingCountry = foundingWorld.countries[creationCard.newCountryId];
assert.equal(foundingCulture.foundingRaceId, foundingRaceId,
  'a newly created country receives a random race from the full in-game list');
const foundingPainter = new CardPainter(foundingWorld, creationCard, 'respect');
const targetX = creationCard.hint % MAP_WIDTH;
const targetY = Math.floor(creationCard.hint / MAP_WIDTH);
for (let y = targetY - 1; y <= targetY + 1; y += 1) {
  for (let x = targetX - 1; x <= targetX + 1; x += 1) {
    const p = y * MAP_WIDTH + x;
    foundingWorld.temperature[p] = 50;
    foundingWorld.humidity[p] = 50;
  }
}
foundingPainter.dab(targetX + 0.5, targetY + 0.5, 1);
assert.ok(foundingPainter.changed.length > 0, 'the creation card paints its new country');
for (const paintedPixel of foundingPainter.changed) {
  const entry = foundingWorld.humanOriginTable.entries[foundingWorld.humanOrigins[paintedPixel]];
  assert.deepEqual(humanOriginMixFromTable(entry.ids, entry.shares), { ids: [foundingRaceId], shares: [100] },
    'all founding-culture territory keeps its one randomly assigned race instead of deriving it from habitat');
}
assert.equal(foundingCulture.foundingRaceId, foundingRaceId);
assert.equal(foundingWorld.newCulture(foundingCulture, 1001).foundingRaceId, undefined,
  'a culture that splits off is not assigned a new random race');
const restoredFoundingWorld = deserializeWorld(serializeWorld(foundingWorld));
assert.equal(restoredFoundingWorld.cultures[foundingCulture.id].foundingRaceId, foundingRaceId,
  'the founding race remains attached to its culture after saving');

const nomadId = world.humanOriginTable.intern(new Map([[humanOriginIndex(europ), 50], [humanOriginIndex(bushman), 50]]));
world.countries.push({
  ...country,
  id: world.countries.length,
  name: 'Тестовое кочевье',
  type: 'nomadic',
  cells: [{
    pixel, population: 10, cultureMix: world.culture[pixel], religionMix: world.religion[pixel], humanOriginMix: nomadId,
  }],
  range: [pixel],
});
const saved = serializeWorld(world);
assert.ok(saved.layers.humanOrigins?.length, 'new saves include the human-origin raster');
const restored = deserializeWorld(saved);
assert.deepEqual(
  humanOriginMixFromTable(
    restored.humanOriginTable.entries[restored.humanOrigins[pixel]].ids,
    restored.humanOriginTable.entries[restored.humanOrigins[pixel]].shares,
  ),
  { ids: [europ, pygmy], shares: [75, 25] },
);
const restoredNomadMix = restored.humanOriginTable.entries[restored.countries[1].cells[0].humanOriginMix];
assert.deepEqual(humanOriginMixFromTable(restoredNomadMix.ids, restoredNomadMix.shares), inherited,
  'nomad cell ancestry survives serialization');
assert.deepEqual(ensureCityPopulationGroups(restored, restored.cities[0])[0].humanOriginMix,
  restored.humanOrigins[pixel]);
assert.deepEqual(restored.people[0].humanOrigin, inherited, 'person ancestry survives serialization');

const oldSave = structuredClone(saved);
delete oldSave.layers.humanOrigins;
delete oldSave.humanOriginTable;
oldSave.people = oldSave.people.map(({ humanOrigin, ...person }) => person);
oldSave.countries = oldSave.countries.map((savedCountry) => ({
  ...savedCountry,
  cells: savedCountry.cells?.map(({ humanOriginMix: _mix, ...cell }) => cell),
}));
oldSave.cities = oldSave.cities.map((savedCity) => ({
  ...savedCity,
  populationGroups: savedCity.populationGroups?.map(({ humanOriginMix: _mix, ...group }) => group),
}));
const oldWorld = deserializeWorld(oldSave);
normalizePolitics(oldWorld, 1000);
assert.deepEqual(
  humanOriginMixFromTable(
    oldWorld.humanOriginTable.entries[oldWorld.humanOrigins[pixel]].ids,
    oldWorld.humanOriginTable.entries[oldWorld.humanOrigins[pixel]].shares,
  ),
  european,
  'old map layers get a deterministic European compatibility composition',
);
assert.deepEqual(oldWorld.people[0].humanOrigin, european, 'old people get a deterministic ancestry default');
assert.deepEqual(ensureCityPopulationGroups(oldWorld, oldWorld.cities[0])[0].humanOriginMix,
  oldWorld.humanOrigins[pixel], 'old city groups fall back to the migrated map mix');

console.log('Human origins, age inheritance, pair frequencies, climate scoring, and save compatibility passed.');
