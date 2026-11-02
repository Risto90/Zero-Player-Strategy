export interface WorkerCommand<Request = unknown> {
  readonly operation: 'sum-numbers' | 'score-candidates';
  readonly payload: Request;
}

interface WorkerRequestMessage {
  kind: 'run';
  id: number;
  command: WorkerCommand;
}

interface WorkerSuccessMessage {
  kind: 'success';
  id: number;
  result: unknown;
}

interface WorkerFailureMessage {
  kind: 'failure';
  id: number;
  error: string;
}

interface WorkerLike {
  postMessage(message: WorkerRequestMessage): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerSuccessMessage | WorkerFailureMessage>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<WorkerSuccessMessage | WorkerFailureMessage>) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
}

interface PendingRequest<R> {
  id: number;
  command: WorkerCommand;
  resolve: (result: R) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  enqueuedAt: number;
  startedAt?: number;
  cancelled?: boolean;
}

interface WorkerSlot {
  worker: WorkerLike;
  busy: boolean;
  current: PendingRequest<unknown> | null;
  onMessage: (event: MessageEvent<WorkerSuccessMessage | WorkerFailureMessage>) => void;
  onError: (event: ErrorEvent) => void;
}

export interface WorkerPoolMetrics {
  workers: number;
  pending: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  queueWaitMs: number;
  usefulWorkMs: number;
  estimatedCopyBytes: number;
}

export interface CommandWorkerPoolOptions {
  workerCount?: number;
  maxPending?: number;
}

/** Реальный пул Web Workers для чистых вычислений над переданными снимками. */
export class CommandWorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly pending: PendingRequest<unknown>[] = [];
  private nextId = 1;
  private disposed = false;
  private completed = 0;
  private failed = 0;
  private cancelled = 0;
  private queueWaitMs = 0;
  private usefulWorkMs = 0;
  private estimatedCopyBytes = 0;
  private readonly maxPending: number;

  constructor(
    private readonly workerFactory: () => WorkerLike,
    options: CommandWorkerPoolOptions = {},
  ) {
    const count = options.workerCount ?? availableWorkerCount();
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RangeError('Число работников должно быть положительным целым числом');
    }
    this.maxPending = options.maxPending ?? Math.max(16, count * 8);
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1) {
      throw new RangeError('Размер очереди работников должен быть положительным целым числом');
    }
    for (let index = 0; index < count; index += 1) this.slots.push(this.createSlot(workerFactory));
  }

  run<R>(command: WorkerCommand, options: { signal?: AbortSignal } = {}): Promise<R> {
    if (this.disposed) return Promise.reject(new Error('Пул работников закрыт'));
    if (options.signal?.aborted) {
      this.cancelled += 1;
      return Promise.reject(abortError());
    }
    if (this.pending.length >= this.maxPending) {
      return Promise.reject(new Error('Переполнена очередь вычислений работников'));
    }
    return new Promise<R>((resolve, reject) => {
      const request: PendingRequest<R> = {
        id: this.nextId++,
        command,
        resolve,
        reject,
        signal: options.signal,
        enqueuedAt: performance.now(),
      };
      if (options.signal) {
        request.abortListener = () => {
          const index = this.pending.indexOf(request as PendingRequest<unknown>);
          if (index >= 0) {
            this.pending.splice(index, 1);
            this.cancelled += 1;
            reject(abortError());
            return;
          }
          const runningSlot = this.slots.find((slot) => slot.current === request);
          if (runningSlot) {
            this.cancelled += 1;
            this.removeAbortListener(request);
            request.reject(abortError());
            this.replaceWorker(runningSlot);
            this.dispatch();
          }
        };
        options.signal.addEventListener('abort', request.abortListener, { once: true });
      }
      this.pending.push(request as PendingRequest<unknown>);
      this.estimatedCopyBytes += estimateBytes(command.payload);
      this.dispatch();
    });
  }

  metrics(): WorkerPoolMetrics {
    return {
      workers: this.slots.length,
      pending: this.pending.length,
      active: this.slots.filter((slot) => slot.busy).length,
      completed: this.completed,
      failed: this.failed,
      cancelled: this.cancelled,
      queueWaitMs: this.queueWaitMs,
      usefulWorkMs: this.usefulWorkMs,
      estimatedCopyBytes: this.estimatedCopyBytes,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const request of this.pending.splice(0)) {
      this.removeAbortListener(request);
      this.cancelled += 1;
      request.reject(abortError());
    }
    for (const slot of this.slots) {
      if (slot.current) {
        this.removeAbortListener(slot.current);
        this.cancelled += 1;
        slot.current.reject(abortError());
        slot.current = null;
      }
      slot.worker.removeEventListener('message', slot.onMessage);
      slot.worker.removeEventListener('error', slot.onError);
      slot.worker.terminate();
    }
    this.slots.length = 0;
  }

  private createSlot(factory: () => WorkerLike): WorkerSlot {
    const slot = {
      worker: factory(),
      busy: false,
      current: null,
      onMessage: (_event: MessageEvent<WorkerSuccessMessage | WorkerFailureMessage>) => undefined,
      onError: (_event: ErrorEvent) => undefined,
    } satisfies WorkerSlot;
    slot.onMessage = (event) => {
      const request = slot.current as PendingRequest<unknown> | null;
      if (!request || event.data.id !== request.id) return;
      const elapsed = request.startedAt === undefined ? 0 : performance.now() - request.startedAt;
      this.usefulWorkMs += elapsed;
      slot.current = null;
      slot.busy = false;
      this.removeAbortListener(request);
      if (request.cancelled) {
        this.cancelled += 1;
        request.reject(abortError());
      } else if (event.data.kind === 'failure') {
        this.failed += 1;
        request.reject(new Error(event.data.error));
      } else {
        this.completed += 1;
        request.resolve(event.data.result);
      }
      this.dispatch();
    };
    slot.onError = (event) => {
      const request = slot.current as PendingRequest<unknown> | null;
      slot.current = null;
      slot.busy = false;
      if (request) {
        this.removeAbortListener(request);
        this.failed += 1;
        request.reject(new Error(event.message || 'Поток вычислений завершился с ошибкой'));
      }
      this.replaceWorker(slot);
      this.dispatch();
    };
    slot.worker.addEventListener('message', slot.onMessage);
    slot.worker.addEventListener('error', slot.onError);
    return slot;
  }

  private dispatch(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.busy) continue;
      let request = this.pending.shift();
      while (request?.signal?.aborted) {
        this.removeAbortListener(request);
        this.cancelled += 1;
        request.reject(abortError());
        request = this.pending.shift();
      }
      if (!request) return;
      slot.busy = true;
      slot.current = request;
      request.startedAt = performance.now();
      this.queueWaitMs += request.startedAt - request.enqueuedAt;
      try {
        slot.worker.postMessage({ kind: 'run', id: request.id, command: request.command });
      } catch (error) {
        slot.current = null;
        slot.busy = false;
        this.failed += 1;
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private removeAbortListener<R>(request: PendingRequest<R>): void {
    if (request.abortListener) request.signal?.removeEventListener('abort', request.abortListener);
    request.abortListener = undefined;
  }

  private replaceWorker(slot: WorkerSlot): void {
    const index = this.slots.indexOf(slot);
    if (index < 0) return;
    slot.worker.removeEventListener('message', slot.onMessage);
    slot.worker.removeEventListener('error', slot.onError);
    slot.worker.terminate();
    slot.current = null;
    slot.busy = false;
    if (this.disposed) return;
    try {
      this.slots[index] = this.createSlot(this.workerFactory);
    } catch (error) {
      this.slots.splice(index, 1);
      const reason = error instanceof Error ? error : new Error(String(error));
      if (this.slots.length === 0) {
        for (const request of this.pending.splice(0)) {
          this.removeAbortListener(request);
          this.failed += 1;
          request.reject(reason);
        }
      }
    }
  }
}

/** Ограничивает потоки по аппаратным ядрам и доступной памяти, а не числу игроков. */
export function availableWorkerCount(
  hardwareConcurrency = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2,
  deviceMemoryGiB = typeof navigator === 'undefined'
    ? 2
    : Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 2,
): number {
  const byCpu = Math.max(1, Math.floor(hardwareConcurrency) - 1);
  const byMemory = Math.max(1, Math.floor(deviceMemoryGiB / 0.5));
  return Math.min(8, byCpu, byMemory);
}

export function createBrowserCommandWorkerPool(
  workerUrl: string | URL,
  options: CommandWorkerPoolOptions = {},
): CommandWorkerPool {
  if (typeof Worker === 'undefined') throw new Error('Web Workers не поддерживаются этой платформой');
  return new CommandWorkerPool(() => new Worker(workerUrl, { type: 'module' }), options);
}

function estimateBytes(value: unknown, seen = new Set<object>()): number {
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (value === null || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateBytes(item, seen), 0);
  return Object.entries(value).reduce((sum, [key, item]) => sum + key.length * 2 + estimateBytes(item, seen), 0);
}

function abortError(): Error {
  const error = new Error('Задача работника отменена');
  error.name = 'AbortError';
  return error;
}
