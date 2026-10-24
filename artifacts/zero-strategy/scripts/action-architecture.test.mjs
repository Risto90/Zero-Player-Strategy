import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const game = readFileSync(resolve(root, 'game/game.ts'), 'utf8');
const brush = readFileSync(resolve(root, 'game/brush.ts'), 'utf8');
const autoPaint = readFileSync(resolve(root, 'game/autoPaint.ts'), 'utf8');
const instructions = readFileSync(resolve(root, '../../replit.md'), 'utf8');

function methodBody(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected source to contain ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`Unclosed method body for ${marker}`);
}

const cardTypes = brush.match(/export type CardType = ([^;]+);/)?.[1]
  .match(/'([^']+)'/g)
  .map((value) => value.slice(1, -1));
assert.ok(cardTypes?.length, 'the engine must declare its supported card types');
const actionTypes = game.match(/export type GameAction =([\s\S]*?);\n/)?.[1]
  .match(/type: '([^']+)'/g)
  .map((value) => value.match(/'([^']+)'/)[1]);
assert.ok(actionTypes?.length, 'the engine must declare its shared action commands');
const dispatcherBody = methodBody(game, 'dispatchAction(action: GameAction): boolean | number | void');
const dispatchedTypes = new Set([...dispatcherBody.matchAll(/case '([^']+)'/g)].map((match) => match[1]));
for (const type of actionTypes) {
  assert.ok(dispatchedTypes.has(type), `action "${type}" must be handled by the shared dispatcher`);
}

const finishBody = methodBody(game, 'private finish(painter: CardPainter): void');
const completedTypes = new Set([...finishBody.matchAll(/case '([^']+)'/g)].map((match) => match[1]));
for (const type of cardTypes) {
  assert.ok(completedTypes.has(type), `card type "${type}" must complete through the shared card resolver`);
}

const automaticBody = methodBody(game, 'private resolveAutomatically(card: Card): void');
assert.match(automaticBody, /dispatchAction\(\{\s*type: 'selectChoice'/);
assert.match(automaticBody, /autoPaint\(painter, actions\)/);
assert.match(automaticBody, /dispatchAction\(\{\s*type: 'placeCity'/);
assert.match(automaticBody, /dispatchAction\(\{\s*type: 'completeCard'/);
assert.doesNotMatch(automaticBody, /draw(World|Country|Nomad)Card|startNextPlayerCard/,
  'automatic resolution must not start another draw unless the turn flow explicitly schedules one');
assert.doesNotMatch(automaticBody, /this\.finish\(|addCityAndConcentrate\(|\.setOwner\(|\.owner\[[^\]]+\]\s*=|\.density\[[^\]]+\]\s*=/,
  'automatic play must not mutate world state or resolve cards outside the shared commands');
assert.equal((game.match(/new CardPainter\(/g) ?? []).length, 1,
  'all cards must create their painter through the shared card-start path');

const autoPaintBody = methodBody(autoPaint, 'export function autoPaint(');
assert.match(autoPaintBody, /actions\.dab\(/);
assert.match(autoPaintBody, /actions\.line\(/);
assert.match(autoPaintBody, /actions\.endStroke\(/);
assert.doesNotMatch(autoPaintBody, /painter\.(dab|line|endStroke)\(/,
  'the strategy may choose coordinates, but brush effects must go through the action adapter');
assert.match(autoPaint, /export function autoPaint\(painter: CardPainter, actions: PaintActions\)/,
  'automatic painting must require a shared command adapter; no direct-painter fallback is allowed');

for (const [name, marker, pattern] of [
  ['choice selection', 'selectChoice(index: number): void', /dispatchAction\(\{\s*type: 'selectChoice'/],
  ['city placement', 'selectCityAt(x: number, y: number): boolean', /dispatchAction\(\{\s*type: 'placeCity'/],
  ['stroke start', 'beginStroke(x: number, y: number): void', /dispatchAction\(\{\s*type: 'beginStroke'/],
  ['stroke continuation', 'strokeTo(x: number, y: number): void', /dispatchAction\(\{\s*type: 'strokeTo'/],
  ['stroke completion', 'endStroke(): void', /dispatchAction\(\{\s*type: 'endStroke'/],
]) {
  assert.match(methodBody(game, marker), pattern, `${name} must use the common action dispatcher`);
}

const completionBody = methodBody(game, 'private applyCardCompletion(): void');
assert.match(completionBody, /this\.finish\(this\.painter\)/);
assert.match(methodBody(game, 'private completeCard(): void'), /dispatchAction\(\{\s*type: 'completeCard'/);
assert.equal((game.match(/this\.finish\(/g) ?? []).length, 1,
  'all cards must pass through the single shared completion function');
assert.match(instructions, /Never add or change a game mechanic for only the player or only the AI/);
assert.match(instructions, /parity coverage before merging/);

console.log(`Action architecture guard passed for ${cardTypes.length} card types and ${actionTypes.length} action commands.`);
