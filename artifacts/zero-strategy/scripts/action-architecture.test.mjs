import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const game = readFileSync(resolve(root, 'game/game.ts'), 'utf8');
const brush = readFileSync(resolve(root, 'game/brush.ts'), 'utf8');
const autoPaint = readFileSync(resolve(root, 'game/autoPaint.ts'), 'utf8');
const autoPaintCandidates = readFileSync(resolve(root, 'game/autoPaintCandidates.ts'), 'utf8');
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
assert.match(dispatcherBody, /case 'dab': return this\.applyDab\(/);
assert.match(dispatcherBody, /case 'line': return this\.applyLine\(/);
assert.match(dispatcherBody, /case 'paintContour': return this\.painter\?\.paintContour\(/);
assert.match(dispatcherBody, /case 'paintContours': return this\.painter\?\.paintContours\(/);

const finishBody = methodBody(game, 'private finish(painter: CardPainter): void');
const completedTypes = new Set([...finishBody.matchAll(/case '([^']+)'/g)].map((match) => match[1]));
for (const type of cardTypes) {
  assert.ok(completedTypes.has(type), `card type "${type}" must complete through the shared card resolver`);
}

const automaticBody = methodBody(game, 'private resolveAutomaticCard(');
assert.match(automaticBody, /dispatchAction\(\{\s*type: 'selectChoice'/);
assert.match(automaticBody, /autoPaint\(painter, actions(?:, onMeasure)?\)/);
assert.match(automaticBody, /contour: [^\n]*dispatchAction\(\{ type: 'paintContour'/,
  'Контурная заливка ИИ проходит через общий обработчик действий');
assert.match(automaticBody, /dispatchAction\(\{\s*type: 'placeCity'/);
assert.match(automaticBody, /dispatchAction\(\{\s*type: 'completeCard'/);
assert.doesNotMatch(automaticBody, /draw(World|Country|Nomad)Card|startNextPlayerCard/,
  'automatic resolution must not start another draw unless the turn flow explicitly schedules one');
assert.doesNotMatch(automaticBody, /this\.finish\(|addCityAndConcentrate\(|\.setOwner\(|\.owner\[[^\]]+\]\s*=|\.density\[[^\]]+\]\s*=/,
  'automatic play must not mutate world state or resolve cards outside the shared commands');
assert.equal((game.match(/new CardPainter\(/g) ?? []).length, 1,
  'all cards must create their painter through the shared card-start path');

const autoPaintBody = methodBody(autoPaint, 'export function autoPaint(');
assert.match(autoPaintBody, /new AutoPaintStrategy\(painter,\s*actions,\s*onMeasure\)\.run\(\)/);
const strategyBody = methodBody(autoPaint, 'class AutoPaintStrategy');
for (const action of ['beginStroke', 'dab', 'line', 'endStroke', 'contour', 'contours']) {
  assert.match(strategyBody, new RegExp(`actions\\.${action}\\s*\\(`),
    `Автоматическая стратегия должна наносить мазок общей командой ${action}`);
}
assert.doesNotMatch(strategyBody, /painter\.(dab|line|paintContour|paintContours)\(/,
  'автоматическая стратегия не обходит общий обработчик и кисть');
const contourStrategyBody = methodBody(autoPaint, 'class ContourTerritoryStrategy');
assert.match(contourStrategyBody, /this\.actions\.contour!\(/);
assert.match(contourStrategyBody, /this\.actions\.endStroke\(/);
assert.doesNotMatch(contourStrategyBody, /this\.painter\.(dab|line|paintContour|paintContours)\(/,
  'контурная стратегия применяет заливку через общий обработчик');
assert.match(autoPaint, /if \(card\.type === 'colonization'\)[\s\S]{0,220}new ContourTerritoryStrategy/,
  'ИИ выбирает колонизацию через контурную стратегию');
assert.doesNotMatch(autoPaintCandidates, /card\.type === 'colonization'[\s\S]{0,220}colonizationMask/,
  'поиск случайных точек больше не используется для выбора места колонизации');
assert.match(autoPaint, /export function autoPaint\(\s*painter: CardPainter,\s*actions: PaintActions(?:,|\))/,
  'automatic painting must require a shared command adapter; no direct-painter fallback is allowed');
assert.match(automaticBody, /beginStroke: \(x, y\) => this\.dispatchAction\(\{\s*type: 'beginStroke'/);
assert.match(automaticBody, /dab: \(x, y, radius\) => this\.dispatchAction\(\{\s*type: 'dab'/);
assert.match(automaticBody, /line: \(ax, ay, bx, by, radius\) => this\.dispatchAction\(\{\s*type: 'line'/);
assert.match(automaticBody, /endStroke: \(\) => this\.dispatchAction\(\{\s*type: 'endStroke'/);
assert.match(automaticBody, /contour: \(area, seed\) => this\.dispatchAction\(\{\s*type: 'paintContour'/);
assert.match(automaticBody, /type: 'paintContours'/);

const dabBody = methodBody(brush, 'dab(cx: number, cy: number, radius: number): number');
assert.match(dabBody, /return this\.paintContour\(ContourArea\.circle/);
const contourBody = methodBody(brush, 'paintContour(area: ContourArea, seed\?: number): number');
assert.match(contourBody, /return this\.paintContours\(\[area\], seed\)/);
assert.match(methodBody(game, 'private applyDab('), /this\.painter\.dab\(/);
assert.match(methodBody(game, 'private applyLine('), /this\.painter\.line\(/);

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
assert.match(completionBody, /this\.cardCompletionBlocker\(\)/,
  'manual and automatic card completion share the same game-rule validation');
assert.match(methodBody(game, 'async nextTurn(automaticallyCompleteCard = false): Promise<void>'),
  /this\.cardCompletionBlocker\(\)/,
  'the turn flow checks the shared completion rules before advancing');
assert.match(methodBody(game, 'private canCompleteCardNormally(): boolean'),
  /this\.cardCompletionBlocker\(\)/,
  'the UI readiness state uses the same card completion rules as the engine');
assert.match(methodBody(game, 'private completeCard(): void'), /dispatchAction\(\{\s*type: 'completeCard'/);
assert.equal((game.match(/this\.finish\(/g) ?? []).length, 1,
  'all cards must pass through the single shared completion function');
assert.match(instructions, /Never add or change a game mechanic for only the player or only the AI/);
assert.match(instructions, /parity coverage before merging/);

console.log(`Action architecture guard passed for ${cardTypes.length} card types and ${actionTypes.length} action commands.`);
