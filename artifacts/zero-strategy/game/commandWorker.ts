interface WorkerCommandMessage {
  kind: 'run';
  id: number;
  command: {
    operation: 'sum-numbers' | 'score-candidates';
    payload: unknown;
  };
}

interface Candidate {
  id: number;
  impact: number;
  cost: number;
  climateFit: number;
}

const scope = globalThis as typeof globalThis & {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerCommandMessage>) => void): void;
};

scope.addEventListener('message', (event) => {
  const { id, command } = event.data;
  try {
    let result: unknown;
    if (command.operation === 'sum-numbers') {
      if (!Array.isArray(command.payload) ||
          command.payload.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new TypeError('Суммирование принимает только конечные числа');
      }
      result = command.payload.reduce((sum, value) => sum + value, 0);
    } else if (command.operation === 'score-candidates') {
      const payload = command.payload as { candidates?: Candidate[] };
      if (!Array.isArray(payload?.candidates)) throw new TypeError('Не заданы кандидаты для оценки');
      result = payload.candidates.map((candidate) => {
        if (!Number.isSafeInteger(candidate.id) ||
            !Number.isFinite(candidate.impact) ||
            !Number.isFinite(candidate.cost) || candidate.cost <= 0 ||
            !Number.isFinite(candidate.climateFit)) {
          throw new TypeError('Некорректные данные кандидата');
        }
        return {
          id: candidate.id,
          efficiency: candidate.impact / candidate.cost,
          climateFit: candidate.climateFit,
        };
      }).sort((left, right) =>
        right.climateFit - left.climateFit ||
        right.efficiency - left.efficiency ||
        left.id - right.id);
    } else {
      throw new Error('Неизвестная операция работника');
    }
    scope.postMessage({ kind: 'success', id, result });
  } catch (error) {
    scope.postMessage({
      kind: 'failure',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
