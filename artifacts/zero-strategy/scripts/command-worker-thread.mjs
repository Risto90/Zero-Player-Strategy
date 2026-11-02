import { parentPort } from 'node:worker_threads';

parentPort.on('message', ({ id, command }) => {
  try {
    if (command.operation === 'overlap-probe') {
      const state = new Int32Array(command.payload.shared);
      const active = Atomics.add(state, 0, 1) + 1;
      let peak = Atomics.load(state, 1);
      while (peak < active && !Atomics.compareExchange(state, 1, peak, active)) {
        peak = Atomics.load(state, 1);
      }
      Atomics.wait(state, 2, 0, command.payload.delayMs);
      Atomics.sub(state, 0, 1);
      parentPort.postMessage({ kind: 'success', id, result: active });
      return;
    }
    if (command.operation === 'sum-numbers') {
      const result = command.payload.reduce((sum, value) => sum + value, 0);
      parentPort.postMessage({ kind: 'success', id, result });
      return;
    }
    if (command.operation === 'fail') throw new Error('Преднамеренная ошибка потока');
    throw new Error('Неизвестная тестовая операция');
  } catch (error) {
    parentPort.postMessage({
      kind: 'failure',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
