import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SerialCommandQueue,
  VersionedCommandRuntime,
} from '../game/commandRuntime.ts';
import {
  availableWorkerCount,
  CommandWorkerPool,
} from '../game/commandWorkerPool.ts';

class NodeWorkerAdapter {
  listeners = new Map();

  constructor(url) {
    this.worker = new Worker(url, { type: 'module' });
  }

  postMessage(message) {
    this.worker.postMessage(message);
  }

  terminate() {
    void this.worker.terminate();
  }

  addEventListener(type, listener) {
    const adapted = type === 'message'
      ? (data) => listener({ data })
      : (error) => listener({ message: error.message });
    this.listeners.set(listener, adapted);
    this.worker.on(type, adapted);
  }

  removeEventListener(type, listener) {
    const adapted = this.listeners.get(listener);
    if (adapted) this.worker.off(type, adapted);
    this.listeners.delete(listener);
  }
}

const queue = new SerialCommandQueue(1);
let release;
const blocker = new Promise((resolve) => { release = resolve; });
const order = [];
const first = queue.enqueue('первый', async (value) => {
  order.push(`${value}:старт`);
  await blocker;
  order.push(`${value}:конец`);
  return 1;
});
await new Promise((resolve) => setTimeout(resolve, 0));
const second = queue.enqueue('второй', (value) => {
  order.push(`${value}:запуск`);
  return 2;
});
await assert.rejects(queue.enqueue('третий', () => 3), /Переполнена очередь/);
release();
assert.deepEqual(await Promise.all([first, second]), [1, 2]);
assert.deepEqual(order, ['первый:старт', 'первый:конец', 'второй:запуск']);

let releaseActive;
const activeGate = new Promise((resolve) => { releaseActive = resolve; });
const active = queue.enqueue('активная', async () => activeGate);
await new Promise((resolve) => setTimeout(resolve, 0));
const controller = new AbortController();
const cancelled = queue.enqueue('отмена', () => 4, { signal: controller.signal });
controller.abort();
await assert.rejects(cancelled, { name: 'AbortError' });
releaseActive();
await active;
assert.equal(queue.metrics().отменено, 1);
queue.dispose();

const world = { coins: 1, left: 0, right: 0, next: 0 };
const runtime = new VersionedCommandRuntime({
  readState: () => world,
  replaceState: (next) => Object.assign(world, next),
  snapshot: (state) => ({ value: { ...state }, copiedBytes: 32 }),
});
let initialPlans = 0;
let releasePlans;
const bothPlansReady = new Promise((resolve) => { releasePlans = resolve; });
const makeSpend = (id) => ({
  id,
  reads: ['кошелёк'],
  writes: ['кошелёк'],
  async plan(snapshot, context) {
    if (context.attempt === 1) {
      initialPlans += 1;
      if (initialPlans === 2) releasePlans();
      await bothPlansReady;
    }
    return {
      patch: Math.max(0, snapshot.coins - (snapshot.coins > 0 ? 1 : 0)),
      result: snapshot.coins > 0,
    };
  },
  reduce(current, patch) {
    return { ...current, coins: patch };
  },
});
const unrelatedLeft = {
  id: 'слева', reads: ['слева'], writes: ['слева'],
  plan: (snapshot) => ({ patch: snapshot.left + 1 }),
  reduce: (current, patch) => ({ ...current, left: patch }),
};
const unrelatedRight = {
  id: 'справа', reads: ['справа'], writes: ['справа'],
  plan: (snapshot) => ({ patch: snapshot.right + 1 }),
  reduce: (current, patch) => ({ ...current, right: patch }),
};
const dependent = {
  id: 'после', dependsOn: ['трата-б'], reads: ['следующий'], writes: ['следующий'],
  plan: (snapshot, context) => ({
    patch: snapshot.next + 1,
    result: context.dependencyResults.get('трата-б'),
  }),
  reduce: (current, patch) => ({ ...current, next: patch }),
};
const batch = await runtime.executeBatch([
  makeSpend('трата-а'),
  makeSpend('трата-б'),
  unrelatedLeft,
  unrelatedRight,
  dependent,
]);
assert.deepEqual(batch.map(({ status }) => status), ['успех', 'успех', 'успех', 'успех', 'успех']);
assert.equal(batch[0].result, true);
assert.equal(batch[1].result, false, 'устаревший план должен увидеть исчерпанный общий ресурс');
assert.equal(batch[1].attempts, 2);
assert.equal(batch[4].result, false, 'зависимая команда получает результат предшественника');
assert.deepEqual(world, { coins: 0, left: 1, right: 1, next: 1 });
assert.equal(runtime.metrics().конфликты, 1);
assert.equal(runtime.metrics().повторныеРасчёты, 1);
assert.equal(runtime.metrics().объёмКопированияБайт, 5 * 32 + 32);

const changingState = { value: 0 };
const changingRuntime = new VersionedCommandRuntime({
  readState: () => changingState,
  replaceState: (next) => Object.assign(changingState, next),
  snapshot: (state) => ({ value: { ...state }, copiedBytes: 8 }),
});
let notifyPlanStarted;
const planStarted = new Promise((resolve) => { notifyPlanStarted = resolve; });
let releaseChangingPlan;
const changingPlanGate = new Promise((resolve) => { releaseChangingPlan = resolve; });
const changingCommand = {
  id: 'обновление во время пакета',
  reads: ['область'],
  writes: ['область'],
  async plan(snapshot, context) {
    if (context.attempt === 1) {
      notifyPlanStarted();
      await changingPlanGate;
    }
    return { patch: snapshot.value + 1, result: snapshot.value };
  },
  reduce(current, patch) {
    return { ...current, value: patch };
  },
};
const changingBatch = changingRuntime.executeBatch([changingCommand]);
await planStarted;
changingState.value = 10;
changingRuntime.invalidateScopes(['область']);
releaseChangingPlan();
const changingResult = await changingBatch;
assert.equal(changingResult[0].attempts, 2);
assert.equal(changingResult[0].result, 10);
assert.equal(changingState.value, 11, 'устаревший план пересчитывается на новом общем состоянии');

const stateBeforeFailure = { ...world };
const failed = runtime.executeSync({
  id: 'сбой фиксации', reads: ['ошибка'], writes: ['ошибка'],
  plan: () => ({ patch: 10 }),
  reduce: () => { throw new Error('сбой до фиксации'); },
});
assert.equal(failed.status, 'ошибка');
assert.deepEqual(world, stateBeforeFailure, 'неудачная фиксация не меняет общее состояние');

assert.equal(availableWorkerCount(16, 2), 4);
assert.equal(availableWorkerCount(128, 32), 8);
assert.equal(availableWorkerCount(1, 0.25), 1);
const workerUrl = pathToFileURL(path.join(process.cwd(), 'scripts/command-worker-thread.mjs'));
const pool = new CommandWorkerPool(
  () => new NodeWorkerAdapter(workerUrl),
  { workerCount: 2, maxPending: 1 },
);
const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
const firstWorker = pool.run({
  operation: 'overlap-probe',
  payload: { shared, delayMs: 120 },
});
const secondWorker = pool.run({
  operation: 'overlap-probe',
  payload: { shared, delayMs: 120 },
});
const queuedWorker = pool.run({ operation: 'sum-numbers', payload: [10, 20, 12] });
await assert.rejects(
  pool.run({ operation: 'sum-numbers', payload: [1] }),
  /Переполнена очередь вычислений работников/,
);
await Promise.all([firstWorker, secondWorker]);
assert.ok(Atomics.load(new Int32Array(shared), 1) >= 2, 'два независимых расчёта действительно шли в потоках одновременно');
assert.equal(await queuedWorker, 42);
await assert.rejects(pool.run({ operation: 'fail', payload: null }), /Преднамеренная ошибка потока/);
assert.equal(pool.metrics().failed, 1);
assert.equal(pool.metrics().workers, 2);
const workerAbort = new AbortController();
const activeCancellation = pool.run({
  operation: 'overlap-probe',
  payload: { shared, delayMs: 500 },
}, { signal: workerAbort.signal });
workerAbort.abort();
await assert.rejects(activeCancellation, { name: 'AbortError' });
assert.equal(pool.metrics().active, 0, 'отмена завершает активный расчёт и освобождает поток');
assert.equal(await pool.run({ operation: 'sum-numbers', payload: [1, 2, 3] }), 6);

const workerState = { first: 0, second: 0 };
const workerRuntime = new VersionedCommandRuntime({
  readState: () => workerState,
  replaceState: (next) => Object.assign(workerState, next),
  snapshot: (state) => ({ value: { ...state }, copiedBytes: 16 }),
  compute: pool,
});
const workerCommand = (id, field, numbers) => ({
  id,
  reads: [field],
  writes: [field],
  async plan(_snapshot, context) {
    const sum = await context.compute({ operation: 'sum-numbers', payload: numbers });
    return { patch: sum, result: sum };
  },
  reduce(current, patch) {
    return { ...current, [field]: patch };
  },
});
const workerResults = await workerRuntime.executeBatch([
  workerCommand('первый расчёт', 'first', [20, 22]),
  workerCommand('второй расчёт', 'second', [8, 34]),
]);
assert.deepEqual(workerResults.map(({ result }) => result), [42, 42]);
assert.deepEqual(workerState, { first: 42, second: 42 });
pool.dispose();
assert.equal(pool.metrics().workers, 0);

console.log('Протокол команд, версии, повторная оценка, FIFO, отмена, ошибки и реальные потоки проверены.');
