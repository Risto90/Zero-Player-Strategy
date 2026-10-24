import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game, hasPlayerActionCard } from '../game/game.ts';
import { mulberry32 } from '../game/random.ts';

const root = process.cwd();
const screen = readFileSync(resolve(root, 'app/play.tsx'), 'utf8');
const cardPanel = readFileSync(resolve(root, 'components/game/CardPanel.tsx'), 'utf8');
const logPanel = readFileSync(resolve(root, 'components/game/LogPanel.tsx'), 'utf8');

function makePauseGate() {
  let entered;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  return {
    entered: new Promise((resolve) => { entered = resolve; }),
    wait() {
      entered();
      return waiting;
    },
    release() {
      release();
    },
  };
}

const activePlayerCard = {
  role: 'all',
  card: { title: 'Событие' },
  progress: null,
};

assert.equal(hasPlayerActionCard(activePlayerCard), true,
  'an active player card keeps the event button available');
assert.equal(hasPlayerActionCard({ ...activePlayerCard, progress: { done: 1, total: 3 } }), false,
  'AI turn progress hides the event button even if a card is present');
assert.equal(hasPlayerActionCard({ role: 'world', card: null, progress: null }), false,
  'a player with no active card does not get an event button');
assert.equal(hasPlayerActionCard({ role: 'world', card: null, progress: null, message: 'В этом году нет карт.' }), false,
  'an informational message alone does not show an event button');
assert.equal(hasPlayerActionCard({ ...activePlayerCard, role: 'observer' }), false,
  'observer mode never shows the player event button');

assert.match(screen, /const canOpenEvent = hasPlayerActionCard\(snap\);/,
  'the event button and card overlay use the tested visibility condition');
assert.match(screen, /onPress=\{\(\) => setCardOpen\(\(open\) => \{[\s\S]*?testID="button-event-card"/,
  'pressing the event button still opens the card overlay');
assert.match(screen, /cardOpen && canOpenEvent && \([\s\S]*?<CardPanel game=\{game\} snap=\{snap\} \/>/,
  'the opened overlay still renders the active card and its actions');
assert.match(cardPanel, /game\.selectChoice\(index\)/,
  'card choices still dispatch their existing game action');
assert.match(screen, /onPress=\{\(\) => \{[\s\S]*?setLogOpen\(true\);[\s\S]*?testID="button-toggle-log"/,
  'the chronicle keeps its independent toggle');
assert.match(screen, /logOpen && \([\s\S]*?<View style=\{styles\.logOverlay\} testID="overlay-chronicle">/,
  'the chronicle overlay fills the map area without covering the game header or footer');
assert.match(screen, /<Pressable[\s\S]*?onPress=\{\(\) => setLogOpen\(false\)\}[\s\S]*?testID="button-close-log"/,
  'the chronicle has an independent close button above its messages');
assert.match(screen, /logOverlay: \{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0/,
  'the chronicle overlay spans the whole map area');
assert.match(screen, /logCloseButton: \{[^}]*width: 44, height: 44/,
  'the close control has a mobile-sized touch target');
assert.match(logPanel, /data=\{log\}/,
  'the chronicle renders its complete archive in a scrollable list');
const minimalLogPanel = logPanel.match(/if \(minimal\) \{([\s\S]*?)\n  \}\n\n  return \(/)?.[1];
assert.ok(minimalLogPanel, 'the game can render a separate minimal chronicle mode');
assert.doesNotMatch(minimalLogPanel, /TextInput|filters|Загрузить ещё|ЛЕТОПИСЬ|событий/,
  'the in-game chronicle contains no heading, search, filters, counters, or paging controls');

const pauseButton = screen.match(/<Pressable[\s\S]*?testID="button-pause"[\s\S]*?\/>/)?.[0];
assert.ok(pauseButton, 'the pause button remains rendered during turn progress');
assert.doesNotMatch(pauseButton, /\bdisabled=/,
  'turn progress does not disable the pause button');

const previousPersist = Game.persist;
const previousPause = Game.pause;
const previousRandom = Math.random;
const previousNow = Date.now;
Game.persist = false;
Game.pause = async () => {};
Math.random = mulberry32(105_240);

let game;
try {
  game = await Game.createCooperative('random', 'all', 105_240);

  // Automatic AI cards resolve without replacing the player's selected map view.
  const firstCard = game.getSnapshot().card;
  assert.ok(firstCard, 'the test game starts with a player card');
  game.setMapMode('cultures');
  game.resolveAutomatically(firstCard);
  assert.equal(game.getSnapshot().mapMode, 'cultures',
    'automatic card resolution preserves the selected map mode');

  // The regular player-card path continues to select a mode based on card type.
  game.startCard({ ...firstCard, type: 'drought' });
  assert.equal(game.mapMode, 'humidity',
    'starting a player drought card selects the humidity map mode');
  game.busy = true;
  game.paused = false;
  game.pauseChangedDuringBusy = false;
  game.togglePause();
  game.startCard({ ...firstCard, type: 'faith' });
  assert.equal(game.paused, true,
    'a pause requested during processing remains active when the next player card starts');
  assert.equal(game.mapMode, 'religions',
    'the next player card still selects its automatic map mode during processing');
  game.pauseChangedDuringBusy = false;
  game.startCard({ ...firstCard, type: 'drought' });
  assert.equal(game.paused, false,
    'starting a card without a new busy-time pause keeps the previous unpause behavior');
  game.busy = false;
  game.pauseChangedDuringBusy = false;

  // Exercise the actual sliced turn with a controlled yield so pause can be
  // toggled while work is in progress and then observed at turn completion.
  game.discard();
  game = await Game.createCooperative('random', 'observer', 105_241);
  game.role = 'observer';
  let gate = makePauseGate();
  Game.pause = () => gate.wait();
  let fakeTime = 0;
  Date.now = () => (fakeTime += 20);
  const firstTurn = game.nextTurn();
  await gate.entered;
  Date.now = previousNow;
  assert.equal(game.getSnapshot().busy, true, 'the current turn remains busy at a yield');
  assert.ok(game.getSnapshot().progress, 'turn progress remains visible while paused');
  assert.ok(game.getSnapshot().progress.done < game.getSnapshot().progress.total,
    'the pause is requested before every AI event has been processed');
  game.togglePause();
  assert.equal(game.getSnapshot().paused, true, 'the pause request is visible during processing');
  gate.release();
  await firstTurn;
  assert.equal(game.getSnapshot().busy, false, 'all events finish before the turn becomes idle');
  assert.equal(game.getSnapshot().progress, null, 'turn progress clears only after processing ends');
  assert.equal(game.getSnapshot().paused, true, 'the completed turn remains paused');

  if (game.getSnapshot().drawing) game.mapDrawn();
  game.start();
  const pausedSeconds = game.getSnapshot().secondsLeft;
  game.tick();
  assert.equal(game.getSnapshot().secondsLeft, pausedSeconds,
    'the timer does not advance until the player resumes');
  game.togglePause();
  game.tick();
  assert.equal(game.getSnapshot().secondsLeft, pausedSeconds - 1,
    'resuming restarts the timer');

  // A second toggle during processing cancels the pending pause.
  gate = makePauseGate();
  Game.pause = () => gate.wait();
  fakeTime = 0;
  Date.now = () => (fakeTime += 20);
  const secondTurn = game.nextTurn();
  await gate.entered;
  Date.now = previousNow;
  game.togglePause();
  game.togglePause();
  assert.equal(game.getSnapshot().paused, false,
    'toggling pause twice during processing cancels the pending pause');
  gate.release();
  await secondTurn;
  assert.equal(game.getSnapshot().paused, false,
    'the turn completes unpaused when its pending pause was cancelled');
} finally {
  game?.discard();
  Game.persist = previousPersist;
  Game.pause = previousPause;
  Math.random = previousRandom;
  Date.now = previousNow;
}
