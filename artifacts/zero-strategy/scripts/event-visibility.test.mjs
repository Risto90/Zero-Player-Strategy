import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game, hasPlayerActionCard } from '../game/game.ts';
import { notificationIsForSubscriber } from '../game/notifications.ts';
import { mulberry32 } from '../game/random.ts';

const root = process.cwd();
const screen = readFileSync(resolve(root, 'app/play.tsx'), 'utf8');
const mapControls = readFileSync(resolve(root, 'components/game/MapControls.tsx'), 'utf8');
const cardPanel = readFileSync(resolve(root, 'components/game/CardPanel.tsx'), 'utf8');
const logPanel = readFileSync(resolve(root, 'components/game/LogPanel.tsx'), 'utf8');
const modeTabs = readFileSync(resolve(root, 'components/game/ModeTabs.tsx'), 'utf8');
const renderer = readFileSync(resolve(root, 'game/render.ts'), 'utf8');
const notifications = readFileSync(resolve(root, 'game/notifications.ts'), 'utf8');
const gameSource = readFileSync(resolve(root, 'game/game.ts'), 'utf8');

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
  'an active player card remains eligible for a choice panel');
assert.equal(hasPlayerActionCard({ ...activePlayerCard, progress: { done: 1, total: 3 } }), false,
  'AI turn progress hides the choice panel even if a card is present');
assert.equal(hasPlayerActionCard({ role: 'world', card: null, progress: null }), false,
  'a player with no active card does not get a choice panel');
assert.equal(hasPlayerActionCard({ role: 'world', card: null, progress: null, message: 'В этом году нет карт.' }), false,
  'an informational message alone does not show a choice panel');
assert.equal(hasPlayerActionCard({ ...activePlayerCard, role: 'observer' }), false,
  'observer mode never shows the player choice panel');

const countrySeven = { scope: 'country', countryId: 7 };
assert.equal(notificationIsForSubscriber(countrySeven, [countrySeven]), true,
  'a country-slot notification reaches a viewer subscribed to that country');
assert.equal(notificationIsForSubscriber(countrySeven, [{ scope: 'country', countryId: 8 }]), false,
  'a country-slot notification does not reach a viewer subscribed to another country');
assert.equal(notificationIsForSubscriber({ scope: 'world' }, [{ scope: 'country', countryId: 7 }]), false,
  'world-slot notifications do not leak into a country-only view');
assert.equal(notificationIsForSubscriber({ scope: 'game' }, [{ scope: 'country', countryId: 7 }]), true,
  'game-wide notifications reach every subscribed viewer');
assert.equal(notificationIsForSubscriber({ scope: 'world' }, [{ scope: 'any' }]), true,
  'a viewer subscribed to all recipients receives each slot notification');
assert.doesNotMatch(notifications, /AI|ИИ|artificial intelligence|автоматическ/u,
  'notification delivery contains no producer or automation-specific rules');
assert.match(gameSource, /messageRecipient: NotificationRecipient/,
  'the game snapshot carries an explicit notification recipient');
assert.match(gameSource, /this\.startCard\(card, undefined, true, slot\)/,
  'player-card notifications inherit the slot that drew the card');
assert.match(gameSource, /this\.resolveAutomatically\(card, \{ scope: 'country', countryId: id \}\)/,
  'country-slot notifications retain their recipient when the card is processed');

assert.match(screen, /const canOpenChoices = canOpenEvent && snap\.card\?\.choices\?\.length === 2;/,
  'the choice tool appears only for an active card with exactly two choices');
assert.match(screen, /const activeCard = canOpenEvent \? snap\.card : null;/,
  'the header only receives a card while the player can act');
assert.match(screen, /activeCard && \([\s\S]*?testID="button-active-card"[\s\S]*?\{activeCard\.title\}/,
  'the active player card is visible in the game-title row');
assert.match(screen, /onHoverIn=\{openCardHelp\}[\s\S]*?onHoverOut=\{closeCardHelp\}/,
  'hovering the card title opens and closes its help');
assert.match(screen, /onHoverIn=\{openCardHelp\}[\s\S]*?onHoverOut=\{closeCardHelp\}[\s\S]*?testID="card-help-tooltip"/,
  'moving the pointer into the instruction block keeps the help open');
assert.match(screen, /cardHelpTimer\.current = setTimeout\(\(\) => \{\s*setCardHelpOpen\(false\)[\s\S]*?180\);/,
  'card help closes after a short delay so long instructions stay usable');
assert.match(screen, /testID="card-help-tooltip"[\s\S]*?\{activeCard\.detail\}/,
  'the card help uses the existing card instructions');
assert.match(modeTabs, /export const MODES:[\s\S]*?\{ id: 'density', label: 'Население' \},[\s\S]*?\];/);
assert.doesNotMatch(modeTabs, /colonization|Колонизация/,
  'the standalone colonization map mode is absent from the mode picker');
assert.doesNotMatch(renderer, /colonizationMask|mode === 9[\s\S]{0,240}137, 171, 118/,
  'the renderer has no dedicated colonization overlay or fill');
assert.match(screen, /showChoice=\{canOpenChoices\}[\s\S]*?onToggleChoice=/,
  'the choice toggle is passed into the shared map tool panel');
assert.match(mapControls, /onPress=\{onToggleChoice\}[\s\S]*?testID="button-tool-choice"/,
  'the choice control is rendered as part of the map tool panel');
assert.match(screen, /const showTools = 1 \+ Number\(canBrush\) \+ Number\(canPlaceCity\) \+ Number\(canOpenChoices\) >= 2;/,
  'the tool panel stays hidden if the hand is the only available tool');
assert.match(screen, /compact=\{width < 420\}/,
  'the toolbar switches to accessible icon-only controls on narrow screens');
assert.doesNotMatch(screen, /button-event-card|eventBadge/,
  'the floating event badge is removed');
assert.match(screen, /cardOpen && canOpenChoices && \([\s\S]*?<CardPanel game=\{game\} snap=\{snap\} \/>/,
  'the centered choice window still renders the existing card content and actions');
assert.match(screen, /testID="map-ink-status"/,
  'the remaining-ink strip stays at the top of the screen');
assert.doesNotMatch(cardPanel, /text-ink|fmt\(card\.ink\)/,
  'the card panel no longer displays numeric ink counts');
assert.match(screen, /testID="map-hint-toast"[\s\S]*?hintToastText/,
  'map instructions and game messages use the transient hint toast');
assert.match(screen, /notificationIsForSubscriber\(snap\.messageRecipient, notificationSubscriptions\)/,
  'the screen displays game messages only when the viewer is subscribed to their recipient');
assert.match(screen, /showHint\(messageForViewer, 'notification'\)/,
  'game messages use the recipient-filtered notification path');
assert.match(screen, /setTimeout\(\(\) => \{\s*setHint\(''\)/,
  'hint messages disappear automatically');
assert.match(screen, /hintToastText: \{[^}]*backgroundColor: 'rgba\(0,0,0,0\.72\)'[^}]*color: '#fff'/,
  'transient messages use white text on a translucent black background');
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

  // Card processing keeps the selected map view and carries the event recipient.
  const firstCard = game.getSnapshot().card;
  assert.ok(firstCard, 'the test game starts with a player card');
  game.setMapMode('cultures');
  game.resolveAutomatically(firstCard, { scope: 'world' });
  assert.equal(game.getSnapshot().mapMode, 'cultures',
    'card processing preserves the selected map mode');
  assert.deepEqual(game.getSnapshot().messageRecipient, { scope: 'world' },
    'card processing preserves its explicit recipient in the game snapshot');

  // Starting a rain card selects humidity and queues a real raster repaint.
  game.setMapMode('political');
  game.renderer.flush();
  const previousPixels = game.renderer.pixels.slice();
  game.startCard({ ...firstCard, type: 'rain' });
  assert.equal(game.mapMode, 'humidity',
    'starting a rain card selects the humidity map mode');
  assert.equal(game.renderer.mode, 'humidity',
    'the map renderer receives the humidity view');
  assert.equal(game.renderer.pending, true,
    'changing to the card view marks its map tiles dirty immediately');
  game.renderer.flush();
  assert.ok(game.world.landIndex.some((pixel) => previousPixels[pixel] !== game.renderer.pixels[pixel]),
    'flushing the new view changes rendered map pixels');

  // Other player-card types keep the existing view mappings; colonization uses political colors.
  for (const [type, mode] of [
    ['drought', 'humidity'],
    ['desertification', 'drainage'],
    ['warmCurrent', 'temperature'],
    ['faith', 'religions'],
    ['culture', 'cultures'],
    ['colonization', 'political'],
  ]) {
    const previousMode = game.renderer.mode;
    game.startCard({ ...firstCard, type });
    assert.equal(game.mapMode, mode, `starting ${type} selects ${mode}`);
    assert.equal(game.renderer.mode, mode, `the renderer switches to ${mode} for ${type}`);
    assert.equal(game.renderer.pending, previousMode !== mode, `${type} redraws when its selected mode changes`);
    game.renderer.flush();
  }

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
