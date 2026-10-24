import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { AUTO_TURN_HOLD_MS } from '../game/holdConfirmation.ts';
import { World } from '../game/world.ts';

const screen = readFileSync(resolve(process.cwd(), 'app/play.tsx'), 'utf8');

function makeFixture(seed) {
  const world = World.create('random', seed);
  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: null,
    government: 'hereditary',
  });
  const pixels = Array.from(world.landIndex.slice(0, 200));
  const mix = world.cultureTable.single(culture.id, 100);
  for (const pixel of pixels) {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 80;
    world.humidity[pixel] = 45;
    world.temperature[pixel] = 50;
    world.drainage[pixel] = 50;
    world.culture[pixel] = mix;
  }
  world.recountCountries();
  assert.ok(world.addCity(country.id, pixels[0], 1, true));
  return { world, country, pixels };
}

function makeCard(type, updates = {}) {
  return {
    type,
    title: type,
    detail: type,
    ink: 12,
    inkTotal: 12,
    targetCountryId: null,
    newCountryId: null,
    newCultureId: null,
    newReligionId: null,
    sourceCultureId: null,
    newGovernmentId: null,
    newRuler: null,
    choices: null,
    selectedChoice: 0,
    characterEvent: null,
    hint: -1,
    ...updates,
  };
}

const previousPersist = Game.persist;
const previousPause = Game.pause;
Game.persist = false;
Game.pause = async () => {};

try {
  assert.equal(AUTO_TURN_HOLD_MS, 3000, 'the confirmation duration is exactly three seconds');

  // Expiration triggers automatic completion only after the map reports a full draw.
  {
    const { world, pixels } = makeFixture(61_401);
    const game = new Game(world, 'all');
    const card = makeCard('rain', { hint: pixels[20] });
    game.startCard(card);
    game.dispatchAction({
      type: 'dab',
      x: (pixels[20] % MAP_WIDTH) + 0.5,
      y: Math.floor(pixels[20] / MAP_WIDTH) + 0.5,
      radius: 1,
    });
    game.dispatchAction({ type: 'endStroke' });
    const manuallyPaintedHumidity = world.humidity[pixels[20]];
    assert.ok(card.ink < card.inkTotal, 'the player can make a partial card action');
    const year = game.getSnapshot().year;
    assert.equal(game.getSnapshot().canCompleteCard, false, 'remaining ink still requires the automatic hold');
    await game.nextTurn();
    assert.equal(game.getSnapshot().year, year, 'a short press cannot skip unfinished card work');
    assert.ok(game.getSnapshot().card, 'an unfinished card remains active after a short press');
    game.secondsLeft = 1;
    game.tick();
    assert.equal(game.secondsLeft, 1, 'the timer waits for the initial map redraw');
    assert.equal(game.getSnapshot().year, year, 'a timeout cannot advance while the map is drawing');
    game.mapDrawn();
    game.tick();
    assert.equal(game.getSnapshot().year, year + 1, 'timeout automatically completes the remaining card and advances the year');
    assert.equal(world.humidity[pixels[20]], manuallyPaintedHumidity,
      'the existing brush state is reused instead of applying the player-painted pixel twice');
    assert.ok(card.ink > 0, 'the automatic strategy preserves ink when no beneficial climate change remains');
    assert.equal(game.getSnapshot().drawing, true, 'automatic completion waits for the changed map to redraw');
    const nextTurnSeconds = game.secondsLeft;
    game.tick();
    assert.equal(game.secondsLeft, nextTurnSeconds, 'the next timer stays paused until the automatic redraw completes');
    game.mapDrawn();
    game.tick();
    assert.equal(game.secondsLeft, nextTurnSeconds - 1, 'the timer resumes after the redraw callback');
    game.discard();
  }

  // A blank city card uses the automatic placement strategy without bypassing its city rule.
  {
    const { world, country } = makeFixture(61_402);
    const game = new Game(world, 'all');
    const card = makeCard('buildCity', { targetCountryId: country.id, ink: 0, inkTotal: 0 });
    const oldCityCount = world.cities.filter((city) => city.countryId === country.id).length;
    game.startCard(card);
    const year = game.getSnapshot().year;
    assert.equal(game.getSnapshot().canCompleteCard, false, 'a required city blocks ordinary completion');
    await game.nextTurn();
    assert.equal(game.getSnapshot().year, year, 'a short press cannot bypass required city placement');
    await game.nextTurn(true);
    assert.equal(card.cityPlaced, true, 'automatic completion places the required city');
    assert.equal(world.cities.filter((city) => city.countryId === country.id).length, oldCityCount + 1,
      'a blank city card creates exactly one city');
    assert.equal(game.getSnapshot().year, year + 1, 'the city card completes through the ordinary turn flow');
    game.discard();
  }

  // Spent ink plus a placed city makes the ordinary next button finish the card.
  {
    const { world, country } = makeFixture(61_404);
    const game = new Game(world, 'all');
    const card = makeCard('buildCity', {
      targetCountryId: country.id,
      ink: 0,
      inkTotal: 12,
      cityPlaced: true,
    });
    game.startCard(card);
    const year = game.getSnapshot().year;
    assert.equal(game.getSnapshot().canCompleteCard, true, 'an exhausted card with its city placed is ready to finish');
    await game.nextTurn();
    assert.equal(game.getSnapshot().year, year + 1, 'a short press ends a ready card and advances the year');
    assert.notEqual(game.getSnapshot().card?.title, card.title, 'the completed card is no longer the active player card');
    game.discard();
  }

  // An explicit choice stays selected when the rest of an action-free card is automated.
  {
    const { world } = makeFixture(61_403);
    const game = new Game(world, 'all');
    const card = makeCard('character', {
      choices: [
        { label: 'Первый вариант', detail: 'Первый вариант.' },
        { label: 'Второй вариант', detail: 'Второй вариант.' },
      ],
    });
    game.startCard(card);
    game.selectChoice(1);
    let automaticChoiceChanges = 0;
    const dispatch = game.dispatchAction.bind(game);
    game.dispatchAction = (action) => {
      if (action.type === 'selectChoice') automaticChoiceChanges += 1;
      return dispatch(action);
    };
    await game.nextTurn(true);
    assert.equal(card.selectedChoice, 1, 'auto-turn preserves the player-selected choice');
    assert.equal(automaticChoiceChanges, 0, 'auto-turn does not replace the selected choice with a random one');
    game.discard();
  }
} finally {
  Game.persist = previousPersist;
  Game.pause = previousPause;
}

assert.match(screen, /<View style=\{styles\.titleRow\}>[\s\S]*?Zero Strategy[\s\S]*?<View style=\{styles\.topBar\}>/,
  'the game title is on its own line above the top bar');
assert.match(screen, /onLongPress=\{snap\.card && !snap\.canCompleteCard && !snap\.busy \? \(\) => \{[\s\S]*?game\.nextTurn\(true\)/,
  'the platform long-press handler starts automatic card completion');
assert.match(screen, /delayLongPress=\{AUTO_TURN_HOLD_MS\}/,
  'automatic completion requires a full three-second hold');
assert.match(screen, /onPressOut=\{\(\) => setHoldingNext\(false\)\}/,
  'releasing early clears the hold hint');
assert.match(screen, /if \(!snap\.card \|\| snap\.canCompleteCard\) void game\.nextTurn\(\)/,
  'a short press finishes only cards the game marks ready');
assert.match(screen, /Удерживайте 3 секунды для автохода/,
  'the active hold shows the three-second confirmation hint');

console.log('Automatic turn, mandatory city, redraw-gating, and hold-confirmation checks passed.');
