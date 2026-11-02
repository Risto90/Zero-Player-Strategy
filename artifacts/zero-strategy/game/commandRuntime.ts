import type { WorkerCommand } from './commandWorkerPool';

export interface CommandRuntimeMetrics {
  полезнаяРаботаМс: number;
  ожиданиеОчередиМс: number;
  времяКопированияМс: number;
  объёмКопированияБайт: number;
  конфликты: number;
  повторныеРасчёты: number;
  завершено: number;
  отменено: number;
  ошибок: number;
  глубинаОчереди: number;
}

export interface QueuedCommandOptions {
  signal?: AbortSignal;
}

interface QueueEntry<C, R> {
  command: C;
  run: (command: C) => R | PromiseLike<R>;
  resolve: (value: R | PromiseLike<R>) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  signal?: AbortSignal;
  abortListener?: () => void;
}

/** Последовательная FIFO-очередь команд с ограничением накопления и отменой. */
export class SerialCommandQueue<C, R> {
  private readonly pending: QueueEntry<C, R>[] = [];
  private running = false;
  private disposed = false;
  private usefulWorkMs = 0;
  private queueWaitMs = 0;
  private completed = 0;
  private cancelled = 0;
  private failed = 0;

  constructor(private readonly maxPending = 2048) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
      throw new RangeError('Размер очереди должен быть положительным целым числом');
    }
  }

  executeSync(command: C, run: (command: C) => R): R {
    if (this.disposed) throw new Error('Очередь команд уже закрыта');
    const startedAt = performance.now();
    try {
      const result = run(command);
      this.completed += 1;
      return result;
    } catch (error) {
      this.failed += 1;
      throw error;
    } finally {
      this.usefulWorkMs += performance.now() - startedAt;
    }
  }

  enqueue(
    command: C,
    run: (command: C) => R | PromiseLike<R>,
    options: QueuedCommandOptions = {},
  ): Promise<R> {
    if (this.disposed) return Promise.reject(new Error('Очередь команд уже закрыта'));
    if (options.signal?.aborted) {
      this.cancelled += 1;
      return Promise.reject(abortError());
    }
    if (this.pending.length >= this.maxPending) {
      return Promise.reject(new Error('Переполнена очередь команд'));
    }

    return new Promise<R>((resolve, reject) => {
      const entry: QueueEntry<C, R> = {
        command, run, resolve, reject, enqueuedAt: performance.now(), signal: options.signal,
      };
      if (options.signal) {
        entry.abortListener = () => {
          const index = this.pending.indexOf(entry);
          if (index < 0) return;
          this.pending.splice(index, 1);
          options.signal?.removeEventListener('abort', entry.abortListener!);
          this.cancelled += 1;
          reject(abortError());
        };
        options.signal.addEventListener('abort', entry.abortListener, { once: true });
      }
      this.pending.push(entry);
      void this.pump();
    });
  }

  /** Отменяет ожидающие команды; уже выполняющуюся команду не прерывает. */
  clear(reason = 'Очередь очищена'): number {
    const entries = this.pending.splice(0);
    for (const entry of entries) {
      if (entry.abortListener) entry.signal?.removeEventListener('abort', entry.abortListener);
      this.cancelled += 1;
      entry.reject(new Error(reason));
    }
    return entries.length;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear('Очередь команд закрыта');
  }

  metrics(): Pick<CommandRuntimeMetrics,
    'полезнаяРаботаМс' | 'ожиданиеОчередиМс' | 'завершено' | 'отменено' | 'ошибок' | 'глубинаОчереди'> {
    return {
      полезнаяРаботаМс: this.usefulWorkMs,
      ожиданиеОчередиМс: this.queueWaitMs,
      завершено: this.completed,
      отменено: this.cancelled,
      ошибок: this.failed,
      глубинаОчереди: this.pending.length,
    };
  }

  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (!this.disposed && this.pending.length) {
        const entry = this.pending.shift()!;
        if (entry.abortListener) entry.signal?.removeEventListener('abort', entry.abortListener);
        if (entry.signal?.aborted) {
          this.cancelled += 1;
          entry.reject(abortError());
          continue;
        }
        this.queueWaitMs += performance.now() - entry.enqueuedAt;
        const startedAt = performance.now();
        try {
          entry.resolve(await entry.run(entry.command));
          this.completed += 1;
        } catch (error) {
          entry.reject(error);
          this.failed += 1;
        } finally {
          this.usefulWorkMs += performance.now() - startedAt;
        }
      }
    } finally {
      this.running = false;
      if (this.pending.length && !this.disposed) void this.pump();
    }
  }
}

export interface ScopedCommandContext {
  readonly commandId: string;
  readonly seed: number;
  readonly attempt: number;
  readonly random: () => number;
  readonly signal?: AbortSignal;
  readonly dependencyResults: ReadonlyMap<string, unknown>;
  /** Тяжёлые независимые расчёты следует отправлять в настоящий пул потоков. */
  readonly compute?: <R>(command: WorkerCommand, options?: { signal?: AbortSignal }) => Promise<R>;
}

export interface ScopedCommandPlan<P> {
  readonly patch: P;
  readonly result?: unknown;
}

export interface VersionedCommand<S, P> {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly seed?: number;
  readonly maxRetries?: number;
  plan(snapshot: S, context: ScopedCommandContext): Promise<ScopedCommandPlan<P>> | ScopedCommandPlan<P>;
  /** Возвращает новое состояние; реализация не должна мутировать переданный объект. */
  reduce(current: S, patch: P): S;
}

export interface CommandResult {
  readonly id: string;
  readonly status: 'успех' | 'ошибка' | 'отмена';
  readonly result?: unknown;
  readonly error?: string;
  readonly attempts: number;
}

export interface VersionedRuntimeOptions<S> {
  readState(): S;
  replaceState(state: S): void;
  snapshot(state: S): { value: S; copiedBytes?: number };
  /** Возвращает стабильную версию области; её увеличивает координатор после фиксации. */
  initialVersion?(scope: string): number;
  maxRetries?: number;
  compute?: {
    run<R>(command: WorkerCommand, options?: { signal?: AbortSignal }): Promise<R>;
  };
}

/**
 * Планирование может идти одновременно; изменения фиксируются по порядку команд.
 * Области чтения и записи проверяются перед каждой фиксацией, устаревшие планы
 * пересчитываются на новом снимке. Замена корневого состояния — единственная точка фиксации.
 */
export class VersionedCommandRuntime<S extends object> {
  private readonly versions = new Map<string, number>();
  private readonly metricsValue: CommandRuntimeMetrics = {
    полезнаяРаботаМс: 0,
    ожиданиеОчередиМс: 0,
    времяКопированияМс: 0,
    объёмКопированияБайт: 0,
    конфликты: 0,
    повторныеРасчёты: 0,
    завершено: 0,
    отменено: 0,
    ошибок: 0,
    глубинаОчереди: 0,
  };
  private readonly queue = new SerialCommandQueue<{
    command: VersionedCommand<S, unknown>;
    options?: QueuedCommandOptions;
  }, CommandResult>(2048);

  constructor(private readonly options: VersionedRuntimeOptions<S>) {}

  /** Немедленный путь для коротких синхронных команд. */
  executeSync<P>(command: VersionedCommand<S, P>, seed = command.seed ?? 0): CommandResult {
    const started = performance.now();
    let attempts = 0;
    try {
      for (;;) {
        attempts += 1;
        const state = this.options.readState();
        const snapshot = this.makeSnapshot(state, uniqueScopes(command));
        const context = makeContext(command, seed, attempts, new Map());
        const plan = command.plan(snapshot.value, context);
        if (isPromiseLike(plan)) throw new Error('Синхронная команда вернула асинхронный план');
        const keys = uniqueScopes(command);
        if (!this.versionsMatch(keys, snapshot.value)) {
          this.metricsValue.конфликты += 1;
          if (attempts > (command.maxRetries ?? this.options.maxRetries ?? 4)) {
            throw new Error('Не удалось зафиксировать команду после повторных расчётов');
          }
          this.metricsValue.повторныеРасчёты += 1;
          continue;
        }
        const next = command.reduce(state, plan.patch);
        this.options.replaceState(next);
        this.bumpVersions(command.writes);
        this.metricsValue.завершено += 1;
        return { id: command.id, status: 'успех', result: plan.result, attempts };
      }
    } catch (error) {
      this.metricsValue.ошибок += 1;
      return { id: command.id, status: 'ошибка', error: errorMessage(error), attempts };
    } finally {
      this.metricsValue.полезнаяРаботаМс += performance.now() - started;
    }
  }

  enqueue<P>(
    command: VersionedCommand<S, P>,
    options: QueuedCommandOptions = {},
  ): Promise<CommandResult> {
    this.metricsValue.глубинаОчереди += 1;
    return this.queue.enqueue({ command, options }, ({ command: queued, options: queueOptions }) =>
      this.executeAsync(queued, queueOptions), options).finally(() => {
      this.metricsValue.глубинаОчереди = Math.max(0, this.metricsValue.глубинаОчереди - 1);
      this.syncQueueMetrics();
    });
  }

  /**
   * Независимые планы каждой волны запускаются одновременно. Тяжёлую работу
   * планировщик обязан отправлять через context.compute, а не считать на UI-потоке.
   * Фиксация и разрешение конфликтов всегда следуют исходному порядку команд.
   */
  async executeBatch<P>(
    commands: readonly VersionedCommand<S, P>[],
    options: QueuedCommandOptions = {},
  ): Promise<CommandResult[]> {
    validateBatch(commands);
    const results = new Map<string, CommandResult>();
    const dependencyResults = new Map<string, unknown>();
    const pending = new Map(commands.map((command, index) => [command.id, { command, index }]));
    const ordered = [...commands];
    while (pending.size) {
      if (options.signal?.aborted) {
        for (const { command } of pending.values()) {
          results.set(command.id, { id: command.id, status: 'отмена', error: 'Команда отменена', attempts: 0 });
          this.metricsValue.отменено += 1;
        }
        break;
      }
      const ready = [...pending.values()]
        .filter(({ command }) => (command.dependsOn ?? []).every((id) => results.has(id)))
        .sort((a, b) => a.index - b.index);
      if (!ready.length) throw new Error('Циклическая зависимость команд');
      const prepared = await Promise.all(ready.map(async ({ command }) => {
        const dependencyFailed = (command.dependsOn ?? []).some((id) => results.get(id)?.status !== 'успех');
        if (dependencyFailed) {
          return { command, plan: null, snapshot: null, attempts: 0, error: 'Зависимая команда завершилась ошибкой' };
        }
        try {
          if (options.signal?.aborted) throw abortError();
          const { value } = this.makeSnapshot(this.options.readState(), uniqueScopes(command));
          const started = performance.now();
          const plan = await command.plan(value, makeContext(
            command,
            command.seed ?? 0,
            1,
            dependencyResults,
            options.signal,
            this.options.compute?.run.bind(this.options.compute),
          ));
          this.metricsValue.полезнаяРаботаМс += performance.now() - started;
          return { command, plan, snapshot: value, attempts: 1, error: null };
        } catch (error) {
          return { command, plan: null, snapshot: null, attempts: 1, error: errorMessage(error) };
        }
      }));

      for (const item of prepared) {
        const { command } = item;
        let result: CommandResult;
        if (item.error || !item.plan || item.snapshot === null) {
          const cancelled = options.signal?.aborted || item.error === 'Команда отменена';
          result = {
            id: command.id,
            status: cancelled ? 'отмена' : 'ошибка',
            error: item.error ?? 'Команда не создала план',
            attempts: item.attempts,
          };
          if (cancelled) this.metricsValue.отменено += 1;
          else this.metricsValue.ошибок += 1;
        } else {
          result = await this.commitWithReplan(command, item.plan, item.snapshot, dependencyResults, options.signal);
        }
        results.set(command.id, result);
        if (result.status === 'успех') dependencyResults.set(command.id, result.result);
        pending.delete(command.id);
      }
    }
    return ordered.map(({ id }) => results.get(id)!);
  }

  metrics(): CommandRuntimeMetrics {
    this.syncQueueMetrics();
    return { ...this.metricsValue };
  }

  /** Сообщает об изменении состояния извне, чтобы ожидающие планы стали устаревшими. */
  invalidateScopes(scopes: readonly string[]): void {
    this.bumpVersions([...new Set(scopes)]);
  }

  clearQueue(): number {
    const cleared = this.queue.clear();
    this.syncQueueMetrics();
    return cleared;
  }

  dispose(): void {
    this.queue.dispose();
  }

  private async executeAsync<P>(
    command: VersionedCommand<S, P>,
    options?: QueuedCommandOptions,
  ): Promise<CommandResult> {
    const started = performance.now();
    let attempts = 0;
    try {
      for (;;) {
        if (options?.signal?.aborted) throw abortError();
        attempts += 1;
        const { value } = this.makeSnapshot(this.options.readState(), uniqueScopes(command));
        const plan = await command.plan(value, makeContext(
          command,
          command.seed ?? 0,
          attempts,
          new Map(),
          options?.signal,
          this.options.compute?.run.bind(this.options.compute),
        ));
        const result = await this.commitWithReplan(command, plan, value, new Map(), options?.signal, attempts);
        return result;
      }
    } catch (error) {
      const cancelled = options?.signal?.aborted || errorMessage(error) === 'Команда отменена';
      if (cancelled) this.metricsValue.отменено += 1;
      else this.metricsValue.ошибок += 1;
      return {
        id: command.id,
        status: cancelled ? 'отмена' : 'ошибка',
        error: errorMessage(error),
        attempts,
      };
    } finally {
      this.metricsValue.полезнаяРаботаМс += performance.now() - started;
    }
  }

  private async commitWithReplan<P>(
    command: VersionedCommand<S, P>,
    initialPlan: ScopedCommandPlan<P>,
    initialSnapshot: S,
    dependencyResults: ReadonlyMap<string, unknown>,
    signal?: AbortSignal,
    initialAttempts = 1,
  ): Promise<CommandResult> {
    let plan = initialPlan;
    let snapshot = initialSnapshot;
    let attempts = initialAttempts;
    const maxRetries = command.maxRetries ?? this.options.maxRetries ?? 4;
    for (;;) {
      if (signal?.aborted) {
        this.metricsValue.отменено += 1;
        return { id: command.id, status: 'отмена', error: 'Команда отменена', attempts };
      }
      if (this.versionsMatch(uniqueScopes(command), snapshot)) {
        try {
          const next = command.reduce(this.options.readState(), plan.patch);
          this.options.replaceState(next);
          this.bumpVersions(command.writes);
          this.metricsValue.завершено += 1;
          return { id: command.id, status: 'успех', result: plan.result, attempts };
        } catch (error) {
          this.metricsValue.ошибок += 1;
          return { id: command.id, status: 'ошибка', error: errorMessage(error), attempts };
        }
      }
      this.metricsValue.конфликты += 1;
      if (attempts > maxRetries) {
        this.metricsValue.ошибок += 1;
        return { id: command.id, status: 'ошибка', error: 'Конфликт версий не разрешён', attempts };
      }
      this.metricsValue.повторныеРасчёты += 1;
      attempts += 1;
      const nextSnapshot = this.makeSnapshot(this.options.readState(), uniqueScopes(command));
      snapshot = nextSnapshot.value;
      try {
        const started = performance.now();
        plan = await command.plan(snapshot, makeContext(
          command,
          command.seed ?? 0,
          attempts,
          dependencyResults,
          signal,
          this.options.compute?.run.bind(this.options.compute),
        ));
        this.metricsValue.полезнаяРаботаМс += performance.now() - started;
      } catch (error) {
        const cancelled = signal?.aborted || errorMessage(error) === 'Команда отменена';
        if (cancelled) this.metricsValue.отменено += 1;
        else this.metricsValue.ошибок += 1;
        return {
          id: command.id,
          status: cancelled ? 'отмена' : 'ошибка',
          error: errorMessage(error),
          attempts,
        };
      }
    }
  }

  private makeSnapshot(state: S, scopes: readonly string[] = []): { value: S; copiedBytes: number } {
    const started = performance.now();
    const result = this.options.snapshot(state);
    this.metricsValue.времяКопированияМс += performance.now() - started;
    this.metricsValue.объёмКопированияБайт += result.copiedBytes ?? 0;
    if (typeof result.value !== 'object' || result.value === null) {
      throw new TypeError('Снимок команды должен быть объектом');
    }
    const captured = new Map(this.versions);
    for (const scope of scopes) {
      if (!captured.has(scope)) {
        captured.set(scope, this.currentVersion(scope));
      }
    }
    snapshotVersions.set(result.value, captured);
    return { value: result.value, copiedBytes: result.copiedBytes ?? 0 };
  }

  private versionsMatch(keys: readonly string[], _snapshot: S): boolean {
    // Версии фиксируются в начале подготовки для каждой команды отдельно.
    // Снимок соответствующих версий хранится в слабой карте ниже.
    const captured = snapshotVersions.get(_snapshot);
    return !!captured && keys.every((key) =>
      this.currentVersion(key) === (captured.get(key) ?? this.currentVersion(key)));
  }

  private bumpVersions(scopes: readonly string[]): void {
    for (const scope of scopes) this.versions.set(scope, this.currentVersion(scope) + 1);
  }

  private currentVersion(scope: string): number {
    return this.versions.get(scope) ?? this.options.initialVersion?.(scope) ?? 0;
  }

  private syncQueueMetrics(): void {
    const queue = this.queue.metrics();
    this.metricsValue.ожиданиеОчередиМс = queue.ожиданиеОчередиМс;
    this.metricsValue.глубинаОчереди = queue.глубинаОчереди;
  }
}

const snapshotVersions = new WeakMap<object, Map<string, number>>();

function uniqueScopes<S, P>(command: VersionedCommand<S, P>): string[] {
  return [...new Set([...command.reads, ...command.writes])];
}

function makeContext<S, P>(
  command: VersionedCommand<S, P>,
  seed: number,
  attempt: number,
  dependencyResults: ReadonlyMap<string, unknown>,
  signal?: AbortSignal,
  compute?: <R>(command: WorkerCommand, options?: { signal?: AbortSignal }) => Promise<R>,
): ScopedCommandContext {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return {
    commandId: command.id,
    seed: seed >>> 0,
    attempt,
    signal,
    dependencyResults,
    compute,
    random: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
    },
  };
}

function validateBatch<S, P>(commands: readonly VersionedCommand<S, P>[]): void {
  const ids = new Set<string>();
  for (const command of commands) {
    if (!command.id || ids.has(command.id)) throw new Error(`Идентификатор команды повторяется: ${command.id}`);
    ids.add(command.id);
  }
  for (const command of commands) {
    for (const dependency of command.dependsOn ?? []) {
      if (!ids.has(dependency)) throw new Error(`Не найдена зависимость ${dependency} для команды ${command.id}`);
    }
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value &&
    typeof (value as { then?: unknown }).then === 'function';
}

function abortError(): Error {
  const error = new Error('Команда отменена');
  error.name = 'AbortError';
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
