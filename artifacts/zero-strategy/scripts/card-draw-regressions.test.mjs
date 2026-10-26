import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { advancePeople } from '../game/characters.ts';
import {
  drawClimateCard,
  drawCountryCard,
  drawWorldCard,
  normalizedCardProbabilities,
  setCardDrawTraceListener,
  updateCardDrawMultipliers,
} from '../game/cards.ts';
import { CardPainter } from '../game/brush.ts';
import { autoPaint } from '../game/autoPaint.ts';
import { forEachNeighbour } from '../game/geography.ts';
import { arePartners, birth as createChild, newCitizen } from '../game/characters.ts';
import { clearSaveBytes } from '../game/storage.ts';
import { World } from '../game/world.ts';

function makeFixture() {
  const world = World.create('random', 9917);
  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: null,
  });
  const pixels = Array.from(world.landIndex.slice(0, 32));
  const cultureMix = world.cultureTable.single(culture.id, 100);
  for (const pixel of pixels) {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 80;
    world.culture[pixel] = cultureMix;
  }
  world.recountCountries();
  assert.ok(world.addCity(country.id, pixels[0], 1, true));
  return { world, country };
}

const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-12, message);

// Каждый подходящий вариант участвует в общем нормированном распределении.
const distribution = normalizedCardProbabilities([
  { key: 'a', weight: 1 },
  { key: 'b', weight: 3 },
  { key: 'c', weight: 0 },
]);
closeTo(distribution.reduce((sum, item) => sum + item.probability, 0), 1, 'normalized card odds total 100%');
closeTo(distribution[0].probability, 0.25, 'base weight determines the normalized probability');
const tinyChance = normalizedCardProbabilities([
  { key: 'tiny', weight: 1e-200 },
  { key: 'ordinary', weight: 1 },
]);
assert.ok(tinyChance.find((item) => item.key === 'tiny')?.probability > 0,
  'любая положительная вероятность остаётся в распределении карт');

// Постоянный множитель растёт только у карт с более высоким прежним шансом; множитель вытянутой карты сбрасывается.
const multipliers = { 'country:4:a': 1.21, 'country:4:missing': 1.5 };
updateCardDrawMultipliers('country:4', distribution, 'a', multipliers);
closeTo(multipliers['country:4:b'], 1.1, 'a card with higher odds receives the 1.1 bonus');
closeTo(multipliers['country:4:a'], 1, 'the drawn card multiplier resets');
closeTo(multipliers['country:4:missing'], 1.5, 'unavailable cards retain their multiplier');
updateCardDrawMultipliers('country:4', distribution, 'a', multipliers);
closeTo(multipliers['country:4:b'], 1.21, 'unplayed-card bonuses multiply across draws');
const second = normalizedCardProbabilities([
  { key: 'a', weight: 1 },
  { key: 'b', weight: 3 },
], multipliers, 'country:4');
updateCardDrawMultipliers('country:4', second, 'b', multipliers);
closeTo(multipliers['country:4:b'], 1, 'the bonus resets when that card is eventually drawn');

// Мировой адаптивный множитель накапливается геометрически и сбрасывается после выпадения карты.
const worldMultipliers = {};
const worldPool = [
  { key: 'low', weight: 1 },
  { key: 'high', weight: 3 },
];
for (const expected of [1.1, 1.21, 1.331]) {
  const odds = normalizedCardProbabilities(worldPool, worldMultipliers, 'world');
  updateCardDrawMultipliers('world', odds, 'low', worldMultipliers);
  closeTo(worldMultipliers['world:high'], expected, `three misses compound to x${expected}`);
}
updateCardDrawMultipliers(
  'world',
  normalizedCardProbabilities(worldPool, worldMultipliers, 'world'),
  'high',
  worldMultipliers,
);
closeTo(worldMultipliers['world:high'], 1, 'the world multiplier resets after the card is drawn');

const previousPersist = Game.persist;
Game.persist = true;
try {
  await clearSaveBytes();
  const { world, country } = makeFixture();
  world.humidity.fill(50);
  const preWorldCounts = [world.countries.length, world.cultures.length, world.religions.length];
  world.cardMultipliers['world:drought'] = 1e100;
  const worldCard = drawWorldCard(world, 1000);
  assert.equal(worldCard?.type, 'drought', 'the world draw chooses exactly one available card');
  assert.deepEqual([world.countries.length, world.cultures.length, world.religions.length], preWorldCounts,
    'checking unselected world cards does not leave their entities behind');

  const nomad = world.newCountry({
    rank: 'кочевье',
    cultureId: country.cultureId,
    religionId: null,
    density: 50,
    foundedYear: 1000,
    parentId: country.id,
  });
  nomad.type = 'nomadic';
  nomad.cells = [{ pixel: world.landIndex[0], population: 50, cultureMix: world.cultureTable.single(country.cultureId, 100), religionMix: 0 }];
  nomad.range = [world.landIndex[0]];
  nomad.pixels = 0;
  world.cardMultipliers[`country:${nomad.id}:nomadExpand`] = 1e100;
  const nomadCard = drawCountryCard(world, nomad, 1000);
  assert.equal(nomadCard?.type, 'nomadExpand', 'the shared country draw selects a nomadic-country card');
  const rangeSet = new Set(nomad.range);
  const reachable = new Set(rangeSet);
  const queue = [...rangeSet];
  for (let head = 0; head < queue.length; head += 1) {
    forEachNeighbour(queue[head], (pixel) => {
      if (world.land[pixel] && !reachable.has(pixel)) {
        reachable.add(pixel);
        queue.push(pixel);
      }
    });
  }
  const reachableOutside = [...reachable].filter((pixel) => !rangeSet.has(pixel)).length;
  const nomadCapacity = reachableOutside || rangeSet.size;
  assert.ok(nomadCard.inkTotal <= nomadCapacity,
    'nomad expansion ink is capped by connected new land or existing range density targets');

  // Кисть ветра тратит на воду половину чернил, а на сушу страны — одно чернило.
  world.temperature.fill(100);
  let coastalLand = -1;
  let coastalSea = -1;
  for (const pixel of world.landIndex) {
    if (world.owner[pixel] > 0) continue;
    const bodies = new Set();
    world.seasOfPixel(pixel, bodies);
    const body = [...bodies][0];
    if (body !== undefined) {
      coastalLand = pixel;
      coastalSea = body;
      break;
    }
  }
  assert.ok(coastalLand >= 0, 'the fixture includes a free coastal land point');
  world.setOwner(coastalLand, country.id + 1);
  world.recountCountries();
  const countryPixels = [];
  world.forEachCountryPixel(country, (pixel) => countryPixels.push(pixel));
  countryPixels.slice(0, 2).forEach((pixel) => { world.temperature[pixel] = 50; });
  const seas = new Set();
  world.forEachCountryPixel(country, (pixel) => world.seasOfPixel(pixel, seas));
  assert.ok(seas.has(coastalSea), 'the country is adjacent to the selected sea');
  const seaPixel = world.water.bodyOf.findIndex((body) => body === coastalSea);
  assert.ok(seaPixel >= 0, 'the selected sea includes a paintable water point');
  world.temperature[seaPixel] = 50;
  const wind = drawClimateCard(world, 'warmWind', country);
  assert.equal(wind?.inkTotal, 2.5,
    'a wind card counts two land points and one half-cost sea point');
  const painter = new CardPainter(world, wind, 'respect');
  let availableInk = 0;
  for (let pixel = 0; pixel < world.land.length; pixel += 1) {
    availableInk += painter.strategyInkCostAt(pixel);
  }
  assert.equal(availableInk, wind.inkTotal,
    'the generated climate quota equals its brush-eligible capacity');
  autoPaint(painter, {
    beginStroke: (x, y) => painter.dab(x, y, 11),
    dab: (x, y, radius) => painter.dab(x, y, radius),
    line: (ax, ay, bx, by, radius) => painter.line(ax, ay, bx, by, radius),
    endStroke: () => painter.endStroke(),
  });
  assert.equal(wind.ink, 0, 'the automatic wind painter spends the entire land-and-sea quota');
  assert.ok(wind.ink >= 0, 'the wind brush never overspends a fractional sea quota');
  for (const pixel of countryPixels) world.temperature[pixel] = 100;
  world.temperature[seaPixel] = 50;
  const seaOnlyWind = drawClimateCard(world, 'warmWind', country);
  assert.equal(seaOnlyWind?.inkTotal, 0.5,
    'a sea-only climate opportunity uses a land point only to start the stroke');
  const seaPainter = new CardPainter(world, seaOnlyWind, 'respect');
  autoPaint(seaPainter, {
    beginStroke: (x, y) => seaPainter.dab(x, y, 11),
    dab: (x, y, radius) => seaPainter.dab(x, y, radius),
    line: (ax, ay, bx, by, radius) => seaPainter.line(ax, ay, bx, by, radius),
    endStroke: () => seaPainter.endStroke(),
  });
  assert.equal(seaOnlyWind.ink, 0, 'the automatic wind painter can spend a half-ink sea-only quota');

  const ruler = country.ruler;
  ruler.age = 30;
  const spouse = newCitizen(world, country, 1000);
  spouse.age = 30;
  spouse.gender = ruler.gender === 'female' ? 'male' : 'female';
  spouse.countryId = country.id;
  if (!world.people.some((candidate) => candidate.id === ruler.id)) world.people.push(ruler);
  world.people.push(spouse);
  ruler.spouseIds.push(spouse.id);
  spouse.spouseIds.push(ruler.id);
  const motherBeforeSave = ruler.gender === 'female' ? ruler : spouse;
  const fatherBeforeSave = ruler.gender === 'male' ? ruler : spouse;
  const adultChild = createChild(world, country, motherBeforeSave, fatherBeforeSave, 1000);
  assert.ok(adultChild, 'родившийся ребёнок зарегистрирован у обоих партнёров');
  adultChild.age = 25;
  adultChild.bornAt = 975;
  const other = world.newCountry({
    rank: 'вторая',
    cultureId: country.cultureId,
    religionId: null,
    density: 10,
    foundedYear: 1000,
    parentId: null,
  }).ruler;
  world.cardMultipliers['country:0:death:random:unavailable-person'] = 1.331;
  world.cardMultipliers[`country:${country.id}:death:random:${ruler.id}`] = 1e100;
  country.pendingDeathIds = [ruler.id]; // A pre-migration save may still contain this legacy field.
  const game = new Game(world, 'all');
  await game.saveNow();
  const restored = await Game.load();
  assert.ok(restored, 'the card probability state survives save and load');
  closeTo(restored.world.cardMultipliers['country:0:death:random:unavailable-person'], 1.331,
    'multipliers for currently unavailable cards are persisted');

  const savedRuler = restored.world.countries[country.id].ruler;
  const savedOther = restored.world.people.find((person) => person.id === other.id);
  advancePeople(restored.world, 1001);
  assert.equal(savedRuler.alive, true, 'annual aging does not independently kill a character');
  assert.equal(savedOther.alive, true, 'annual aging does not queue any character death');
  assert.equal('pendingDeathIds' in restored.world.countries[country.id], false, 'country state has no death queue');

  const restoredCountry = restored.world.countries[country.id];
  const savedSpouse = restored.world.people.find((person) => person.id === spouse.id);
  const savedAdultChild = restored.world.people.find((person) => person.id === adultChild.id);
  assert.ok(savedSpouse && arePartners(savedRuler, savedSpouse),
    'родители взаимно записаны супругами до появления карты рождения');
  assert.ok(savedAdultChild, 'семейный персонаж сохранился после загрузки');
  const mother = savedRuler.gender === 'female' ? savedRuler : savedSpouse;
  const father = savedRuler.gender === 'male' ? savedRuler : savedSpouse;
  const birthKey = `birth:${mother.id}:${father.id}`;
  restored.world.cardMultipliers[`country:${country.id}:${birthKey}`] = 1e200;
  const drawTraces = [];
  setCardDrawTraceListener((event) => drawTraces.push(event));
  const birth = drawCountryCard(restored.world, restoredCountry, 1001);
  assert.equal(birth?.type, 'birth',
    `отдельная карта этой пары родителей может выпасть: ${JSON.stringify(drawTraces.at(-1))}`);
  assert.deepEqual(birth.characterEvent.personIds, [mother.id, father.id],
    'карта рождения указывает обоих родителей и не создаёт ребёнка без них');
  restored.year = 1001;
  restored.applyCharacterEvent(restoredCountry, birth.characterEvent, null);
  const child = restored.world.people.find((person) =>
    person.id !== savedAdultChild.id &&
    person.parents.includes(mother.id) && person.parents.includes(father.id));
  assert.ok(child, 'после карты рождения у ребёнка записаны оба родителя');
  assert.ok(arePartners(mother, father), 'родители ребёнка состоят в браке или взаимной любовной связи');

  const birthTrace = drawTraces.at(-1);
  assert.ok(!birthTrace.choices.some((choice) => choice.key === 'life-event'),
    'в пуле нет общей карты «событие жизни»');
  assert.ok(birthTrace.choices.some((choice) => choice.key === birthKey),
    'у пары родителей есть собственная карта с независимым весом');
  assert.ok(birthTrace.choices.filter((choice) => !choice.key.startsWith('death:'))
    .every((choice) => choice.baseWeight === 1),
  'для карт без заданного процентного шанса базовый вес равен 1');

  restored.world.cardMultipliers[`country:${country.id}:marriage:${savedAdultChild.id}`] = 1e200;
  const marriage = drawCountryCard(restored.world, restoredCountry, 1001);
  assert.equal(marriage?.type, 'marriage', 'отдельная карта брака конкретного персонажа может выпасть');
  assert.equal(marriage.choices?.length, 2, 'карта выбора супруга всегда предлагает ровно двух кандидатов');

  const fiance = newCitizen(restored.world, restoredCountry, 1001);
  fiance.age = 25;
  fiance.gender = savedAdultChild.gender === 'female' ? 'male' : 'female';
  fiance.countryId = country.id;
  restored.world.people.push(fiance);
  savedAdultChild.betrothedId = fiance.id;
  fiance.betrothedId = savedAdultChild.id;
  const betrothalFirstId = Math.min(savedAdultChild.id, fiance.id);
  const betrothalSecondId = Math.max(savedAdultChild.id, fiance.id);
  restored.world.cardMultipliers[
    `country:${country.id}:marriage:betrothed:${betrothalFirstId}:${betrothalSecondId}`
  ] = 1e200;
  const betrothedMarriage = drawCountryCard(restored.world, restoredCountry, 1001);
  assert.equal(betrothedMarriage?.type, 'marriage', 'карта свадьбы после помолвки также разыгрывается');
  assert.equal(betrothedMarriage.choices?.length, 2,
    'даже при помолвке карта брака предлагает два варианта');
  assert.equal(betrothedMarriage.choices[0].person.id, fiance.id,
    'помолвленный персонаж первым кандидатом сохраняет своего жениха или невесту');
  const alternativeSpouse = betrothedMarriage.choices[1].person;
  restored.applyCharacterEvent(restoredCountry, betrothedMarriage.characterEvent, null, betrothedMarriage.choices[1]);
  assert.equal(savedAdultChild.betrothedId, null, 'после выбора другого кандидата помолвка снимается');
  assert.equal(fiance.betrothedId, null, 'снятая помолвка не оставляет одностороннюю ссылку');
  assert.ok(arePartners(savedAdultChild, alternativeSpouse),
    `выбранный вместо помолвленного кандидата становится супругом: ${JSON.stringify({
      adultChild: { id: savedAdultChild.id, spouses: savedAdultChild.spouseIds },
      alternative: { id: alternativeSpouse.id, spouses: alternativeSpouse.spouseIds },
    })}`);

  const death = drawCountryCard(restored.world, restoredCountry, 1001);
  assert.equal(death?.type, 'death', 'в розыгрыше выбрана карта смерти');
  assert.deepEqual(death.characterEvent.personIds, [savedRuler.id],
    'карта смерти относится только к одному персонажу');
  assert.equal(death.characterEvent.deathCause, 'random',
    'причина смерти задана картой и не выводится только из возраста');
  const deathTrace = drawTraces.at(-1);
  const rulerDeathCards = deathTrace.choices.filter((choice) =>
    choice.key === `death:random:${savedRuler.id}` ||
    choice.key === `death:oldAge:${savedRuler.id}`);
  assert.equal(rulerDeathCards.length, 2, 'случайная смерть и смерть от старости — разные карты персонажа');
  assert.equal(new Set(rulerDeathCards.map((choice) => choice.key)).size, 2,
    'у каждой причины смерти свой ключ накопительного множителя');
  assert.ok(deathTrace.choices.some((choice) => choice.key === `death:random:${savedSpouse.id}`),
    'карты смерти создаются и для именных жителей вне семейного пула правителя');
  assert.ok(!deathTrace.choices.some((choice) => choice.key === 'life-event'),
    'смерть и другие события персонажей не сворачиваются в общую карту');
  assert.equal(savedRuler.alive, true, 'сама карта смерти не убивает персонажа до её разрешения');
  restored.applyCharacterEvent(restored.world.countries[country.id], death.characterEvent, null);
  assert.equal(savedRuler.alive, false, 'смерть наступает при разрешении выбранной карты');
  assert.equal(savedRuler.deathReason, 'болезнь или несчастный случай',
    'карта случайной смерти явно сохраняет свою причину');
  assert.equal(savedOther.alive, true, 'смерть одного персонажа не убивает остальных');
  assert.equal(death.characterEvent.personIds.length, 1, 'одна карта смерти относится только к одному человеку');
  setCardDrawTraceListener(null);
  restored.discard();
  game.discard();
} finally {
  setCardDrawTraceListener(null);
  await clearSaveBytes();
  Game.persist = previousPersist;
}

console.log('Card probability, death-card, and save/load regressions passed.');
