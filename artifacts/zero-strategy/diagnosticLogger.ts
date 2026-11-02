const DETAILED_LOGGING_ENABLED = process.env.EXPO_PUBLIC_APP_LOG_MODE === 'detailed';
const LOG_FILE_NAME = 'zero-strategy-test-log.txt';
const MAX_LOG_CHARACTERS = 1_000_000;
const FLUSH_DELAY_MS = 500;

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
type FileSystemModule = typeof import('expo-file-system/legacy');
type ErrorHandler = (error: Error, isFatal: boolean) => void;
type GlobalWithErrorUtils = typeof globalThis & {
  ErrorUtils?: {
    getGlobalHandler?: () => ErrorHandler;
    setGlobalHandler: (handler: ErrorHandler) => void;
  };
};

const consoleLevels: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
const consoleTarget = console as unknown as Record<LogLevel, (...args: unknown[]) => void>;
const originalConsole = Object.fromEntries(
  consoleLevels.map((level) => [level, consoleTarget[level].bind(console)]),
) as Record<LogLevel, (...args: unknown[]) => void>;

let installed = false;
let fileSystem: FileSystemModule | null = null;
let logFileUri: string | null = null;
let storageReady = false;
let storagePromise: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let logContents = '';
let pendingContents = '';

function trimLog(text: string): string {
  if (text.length <= MAX_LOG_CHARACTERS) return text;
  const tail = text.slice(-MAX_LOG_CHARACTERS);
  const nextLine = tail.indexOf('\n');
  return nextLine === -1 ? tail : tail.slice(nextLine + 1);
}

function formatValue(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function appendEntry(level: string, values: unknown[]): void {
  if (!DETAILED_LOGGING_ENABLED) return;

  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${values.map(formatValue).join(' ')}`;
  if (storageReady) {
    logContents = trimLog(`${logContents}${line}\n`);
  } else {
    pendingContents = trimLog(`${pendingContents}${line}\n`);
  }
  scheduleFlush(level === 'error' || level === 'fatal' || level === 'unhandledrejection');
  void prepareStorage();
}

function scheduleFlush(immediate: boolean): void {
  if (!DETAILED_LOGGING_ENABLED) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (immediate) {
    void persistLog();
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void persistLog();
  }, FLUSH_DELAY_MS);
}

function prepareStorage(): Promise<void> {
  if (!DETAILED_LOGGING_ENABLED) return Promise.resolve();
  if (storagePromise) return storagePromise;

  storagePromise = (async () => {
    const fs = await import('expo-file-system/legacy');
    if (!fs.documentDirectory) throw new Error('Android не предоставил папку документов приложения.');

    fileSystem = fs;
    logFileUri = `${fs.documentDirectory}${LOG_FILE_NAME}`;
    const info = await fs.getInfoAsync(logFileUri);
    const previousLog = info.exists ? await fs.readAsStringAsync(logFileUri) : '';
    logContents = trimLog(`${previousLog}${previousLog ? '\n' : ''}${pendingContents}`);
    pendingContents = '';
    storageReady = true;
    appendEntry('session', ['Начало запуска тестовой сборки']);
  })().catch((error: unknown) => {
    originalConsole.error('Не удалось открыть файл журнала тестовой сборки:', error);
  });

  return storagePromise;
}

async function persistLog(): Promise<void> {
  if (!DETAILED_LOGGING_ENABLED) return;
  await prepareStorage();
  if (!storageReady || !fileSystem || !logFileUri) return;

  const snapshot = logContents;
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => fileSystem!.writeAsStringAsync(logFileUri!, snapshot));
  try {
    await writeQueue;
  } catch (error) {
    originalConsole.error('Не удалось записать файл журнала тестовой сборки:', error);
  }
}

export function initializeDiagnosticLogging(): void {
  if (!DETAILED_LOGGING_ENABLED || installed) return;
  installed = true;

  for (const level of consoleLevels) {
    const original = originalConsole[level];
    consoleTarget[level] = (...values: unknown[]) => {
      original(...values);
      appendEntry(level, values);
    };
  }

  const errorUtils = (globalThis as GlobalWithErrorUtils).ErrorUtils;
  if (errorUtils) {
    const previousHandler = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error, isFatal) => {
      appendEntry(isFatal ? 'fatal' : 'uncaught', [error]);
      void persistLog();
      if (previousHandler) previousHandler(error, isFatal);
      else originalConsole.error(error);
    });
  }

  const eventHost = globalThis as unknown as {
    addEventListener?: (type: string, listener: (event: { reason?: unknown }) => void) => void;
  };
  eventHost.addEventListener?.('unhandledrejection', (event) => {
    appendEntry('unhandledrejection', [event.reason]);
    void persistLog();
  });

  appendEntry('session', ['Инициализация журнала тестовой сборки']);
}

export function recordDiagnosticError(error: Error, stackTrace: string): void {
  appendEntry('react-error-boundary', [error, stackTrace]);
  void persistLog();
}

export async function exportDiagnosticLog(): Promise<'saved' | 'cancelled'> {
  if (!DETAILED_LOGGING_ENABLED) throw new Error('Журнал доступен только в тестовой сборке.');
  await persistLog();
  if (!fileSystem || !logFileUri) throw new Error('Файл журнала ещё не создан.');

  const content = await fileSystem.readAsStringAsync(logFileUri);
  const permission = await fileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return 'cancelled';

  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const exportedFile = await fileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    `zero-strategy-test-log-${suffix}`,
    'text/plain',
  );
  await fileSystem.StorageAccessFramework.writeAsStringAsync(exportedFile, content);
  return 'saved';
}
