import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { advancePeople } from '../game/characters.ts';
import { drawCountryCard, drawWorldCard, normalizedCardProbabilities, updateCardDrawMultipliers } from '../game/cards.ts';
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

// Every eligible option participates in one normalized distribution.
const distribution = normalizedCardProbabilities([
  { key: 'a', weight: 1 },
  { key: 'b', weight: 3 },
  { key: 'c', weight: 0 },
]);
closeTo(distribution.reduce((sum, item) => sum + item.probability, 0), 1, 'normalized card odds total 100%');
closeTo(distribution[0].probability, 0.25, 'base weight determines the normalized probability');

// Only previously higher-chance cards build a persistent multiplier; the drawn card alone resets.
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

  const ruler = country.ruler;
  const other = world.newCountry({
    rank: 'вторая',
    cultureId: country.cultureId,
    religionId: null,
    density: 10,
    foundedYear: 1000,
    parentId: null,
  }).ruler;
  world.cardMultipliers['country:0:death:unavailable-person'] = 1.331;
  world.cardMultipliers[`country:${country.id}:death:${ruler.id}`] = 1e100;
  country.pendingDeathIds = [ruler.id]; // A pre-migration save may still contain this legacy field.
  const game = new Game(world, 'all');
  await game.saveNow();
  const restored = await Game.load();
  assert.ok(restored, 'the card probability state survives save and load');
  closeTo(restored.world.cardMultipliers['country:0:death:unavailable-person'], 1.331,
    'multipliers for currently unavailable cards are persisted');

  const savedRuler = restored.world.countries[country.id].ruler;
  const savedOther = restored.world.people.find((person) => person.id === other.id);
  advancePeople(restored.world, 1001);
  assert.equal(savedRuler.alive, true, 'annual aging does not independently kill a character');
  assert.equal(savedOther.alive, true, 'annual aging does not queue any character death');
  assert.equal('pendingDeathIds' in restored.world.countries[country.id], false, 'country state has no death queue');

  const death = drawCountryCard(restored.world, restored.world.countries[country.id], 1001);
  assert.equal(death?.type, 'death', 'a death is returned as the one selected country card');
  assert.deepEqual(death.characterEvent.personIds, [savedRuler.id],
    'the selected death card refers only to its own character');
  assert.equal(savedRuler.alive, true, 'the death card itself does not kill anyone before resolution');
  restored.applyCharacterEvent(restored.world.countries[country.id], death.characterEvent, null);
  assert.equal(savedRuler.alive, false, 'the selected death card causes death when resolved');
  assert.equal(savedOther.alive, true, 'resolving one death card leaves other characters alive');
  assert.equal(death.characterEvent.personIds.length, 1, 'one draw never returns multiple death cards');
  restored.discard();
  game.discard();
} finally {
  await clearSaveBytes();
  Game.persist = previousPersist;
}

console.log('Card probability, death-card, and save/load regressions passed.');
