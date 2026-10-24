import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasPlayerActionCard } from '../game/game.ts';

const root = process.cwd();
const screen = readFileSync(resolve(root, 'app/play.tsx'), 'utf8');
const cardPanel = readFileSync(resolve(root, 'components/game/CardPanel.tsx'), 'utf8');

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
assert.match(screen, /onPress=\{\(\) => setLogOpen\(\(open\) => \{[\s\S]*?testID="button-toggle-log"/,
  'the chronicle keeps its independent toggle');
