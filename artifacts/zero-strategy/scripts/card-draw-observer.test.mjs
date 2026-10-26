import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { setCardDrawTraceListener } from '../game/cards.ts';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  assert.ok(Number.isInteger(parsed) && parsed > 0, `${name} must be a positive integer`);
  return parsed;
}

const years = positiveInteger(process.env.CARD_DRAW_YEARS, 5, 'CARD_DRAW_YEARS');
const parties = positiveInteger(process.env.CARD_DRAW_PARTIES, 1, 'CARD_DRAW_PARTIES');
const traceEnabled = process.env.ZERO_STRATEGY_CARD_TRACE === '1';
const events = [];
let forcedInitialEvents = 0;
const previousRandom = Math.random;
const previousPause = Game.pause;
const previousPersist = Game.persist;
const seedStart = positiveInteger(process.env.CARD_DRAW_SEED, 410_017, 'CARD_DRAW_SEED');

Game.persist = false;
Game.pause = async () => {};
setCardDrawTraceListener((event) => {
  events.push(event);
  if (traceEnabled && event.selectedKey !== null) {
    process.stdout.write(`CARD_DRAW_EVENT ${JSON.stringify(event)}\n`);
  }
});

try {
  for (let party = 0; party < parties; party += 1) {
    Math.random = seededRandom(seedStart + party);
    const game = Game.create('random', 'observer');
    forcedInitialEvents += 1;
    if (traceEnabled) {
      process.stdout.write(`CARD_DRAW_EVENT ${JSON.stringify({
        year: 1000,
        scope: 'world',
        selectedKey: 'create',
        cardType: 'create',
        forced: true,
        reason: 'первая страна создаётся при запуске партии, минуя розыгрыш',
      })}\n`);
    }
    try {
      for (let year = 0; year < years; year += 1) await game.nextTurn();
    } finally {
      game.discard();
    }
  }
} finally {
  setCardDrawTraceListener(null);
  Math.random = previousRandom;
  Game.pause = previousPause;
  Game.persist = previousPersist;
}

const successfulEvents = events.filter((event) => event.selectedKey !== null);
assert.ok(successfulEvents.length > 0, 'headless observer simulation must draw cards');
assert.ok(successfulEvents.every((event) => event.cardType !== null),
  'every selected card must be traced with its resulting card type');
assert.ok(successfulEvents.every((event) => event.choices.some((choice) => choice.key === event.selectedKey)),
  'every selected key must be present in the recorded draw pool');
for (const event of successfulEvents) {
  const actualTotal = event.choices.reduce((sum, choice) => sum + choice.actualProbability, 0);
  const baseTotal = event.choices.reduce((sum, choice) => sum + choice.baseProbability, 0);
  const finalTotal = event.finalChoices.reduce((sum, choice) => sum + choice.actualProbability, 0);
  assert.ok(Math.abs(actualTotal - 1) < 1e-9, 'actual probabilities must sum to one');
  assert.ok(Math.abs(baseTotal - 1) < 1e-9, 'base probabilities must sum to one');
  assert.ok(Math.abs(finalTotal - 1) < 1e-9, 'final retry probabilities must sum to one');
}

const grouped = new Map();
const poolDraws = new Map();
const modifierPeriods = new Map();
const cardTypesByPool = new Map();
for (const event of events) {
  const pool = event.scope === 'world' ? 'world' : event.countryType ?? 'unknown';
  poolDraws.set(pool, (poolDraws.get(pool) ?? 0) + 1);
  if (event.cardType) {
    const types = cardTypesByPool.get(pool) ?? new Map();
    types.set(event.cardType, (types.get(event.cardType) ?? 0) + 1);
    cardTypesByPool.set(pool, types);
  }
  for (const choice of event.choices) {
    const cardKey = choice.key.startsWith('death:') ? 'death' : choice.key;
    const key = `${pool}:${cardKey}`;
    const row = grouped.get(key) ?? {
      pool,
      key: cardKey,
      baseProbabilitySum: 0,
      actualProbabilitySum: 0,
      seen: 0,
      selected: 0,
      programmedMultiplierSum: 0,
      programmedMultiplierCount: 0,
      modifierBaseProbabilitySum: 0,
      modifierActualProbabilitySum: 0,
      modifierProbabilitySampleCount: 0,
    };
    row.baseProbabilitySum += choice.baseProbability;
    row.actualProbabilitySum += choice.actualProbability;
    row.seen += 1;
    if (event.selectedKey === choice.key) row.selected += 1;
    if (choice.programmedMultiplier !== null) {
      row.programmedMultiplierSum += choice.programmedMultiplier;
      row.programmedMultiplierCount += 1;
    }
    if (choice.programmedMultiplier !== null && Math.abs(choice.programmedMultiplier - 1) > 1e-12) {
      row.modifierBaseProbabilitySum += choice.baseProbability;
      row.modifierActualProbabilitySum += choice.actualProbability;
      row.modifierProbabilitySampleCount += 1;
    } else if (choice.baseWeight === 0 && choice.programmedWeight > 0) {
      row.modifierActualProbabilitySum += choice.actualProbability;
      row.modifierProbabilitySampleCount += 1;
    }
    grouped.set(key, row);
  }
  for (const modifier of event.modifiers) {
    const period = modifierPeriods.get(modifier) ?? { draws: 0, cardTypes: new Map() };
    period.draws += 1;
    if (event.cardType) period.cardTypes.set(event.cardType, (period.cardTypes.get(event.cardType) ?? 0) + 1);
    modifierPeriods.set(modifier, period);
  }
}

const summary = [...grouped.values()].map((row) => {
  const draws = poolDraws.get(row.pool) ?? 0;
  return {
    pool: row.pool,
    key: row.key,
    draws,
    observedEvents: row.selected,
    observedRate: draws ? row.selected / draws : 0,
    meanBaseChance: draws ? row.baseProbabilitySum / draws : 0,
    meanActualChance: draws ? row.actualProbabilitySum / draws : 0,
    actualToBaseChanceRatio: row.baseProbabilitySum > 0
      ? row.actualProbabilitySum / row.baseProbabilitySum
      : null,
    modifierPeriods: row.modifierProbabilitySampleCount,
    modifierPeriodProbabilityRatio: row.modifierBaseProbabilitySum > 0
      ? row.modifierActualProbabilitySum / row.modifierBaseProbabilitySum
      : null,
    meanProgrammedWeightMultiplier: row.programmedMultiplierCount
      ? row.programmedMultiplierSum / row.programmedMultiplierCount
      : null,
  };
});

const typeCounts = [...successfulEvents.reduce((counts, event) => {
  counts.set(event.cardType, (counts.get(event.cardType) ?? 0) + 1);
  return counts;
}, new Map())].sort(([a], [b]) => a.localeCompare(b));
const rejectedCounts = new Map();
for (const event of events) {
  for (const key of event.rejectedKeys) rejectedCounts.set(key, (rejectedCounts.get(key) ?? 0) + 1);
}

process.stdout.write(`CARD_DRAW_SUMMARY ${JSON.stringify({
  mode: 'observer',
  graphics: false,
  years,
  parties,
  seedStart,
  forcedInitialEvents,
  drawSlots: events.length,
  successfulEvents: successfulEvents.length,
  rejectedAttempts: Object.fromEntries([...rejectedCounts].sort(([a], [b]) => a.localeCompare(b))),
  eventTypeCounts: Object.fromEntries(typeCounts),
  eventTypeCountsByPool: Object.fromEntries(
    [...cardTypesByPool].sort(([a], [b]) => a.localeCompare(b)).map(([pool, counts]) => [
      pool,
      Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))),
    ]),
  ),
  modifierPeriods: Object.fromEntries(
    [...modifierPeriods].sort(([a], [b]) => a.localeCompare(b)).map(([modifier, period]) => [
      modifier,
      { draws: period.draws, cardTypes: Object.fromEntries([...period.cardTypes].sort(([a], [b]) => a.localeCompare(b))) },
    ]),
  ),
  options: summary,
})}\n`);
