import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(projectRoot, 'server', 'serve.js');
const configuredBasePath = (process.env.BASE_PATH || '/').trim();
const basePath = configuredBasePath === '' || configuredBasePath === '/'
  ? ''
  : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;
const chromiumPath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.CHROMIUM_PATH,
  spawnSync('which', ['chromium'], { encoding: 'utf8' }).stdout?.trim(),
  spawnSync('which', ['google-chrome'], { encoding: 'utf8' }).stdout?.trim(),
].find((candidate) => candidate && existsSync(candidate));
const benchmarkYears = Number(process.env.PERF_BENCHMARK_YEARS ?? 10);
const turnTimeoutMs = Number(process.env.PERF_BENCHMARK_TURN_TIMEOUT_MS ?? 60_000);

assert.ok(chromiumPath, 'Для браузерного замера нужен установленный Chromium.');
assert.ok(Number.isInteger(benchmarkYears) && benchmarkYears > 0, 'Число ходов должно быть положительным целым.');
assert.ok(Number.isInteger(turnTimeoutMs) && turnTimeoutMs > 0, 'Ограничение времени хода должно быть положительным целым.');

function publicPath(pathname) {
  return `${basePath}${pathname.startsWith('/') ? pathname : `/${pathname}`}` || '/';
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Сервер браузерной сборки завершился с кодом ${child.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${publicPath('/status')}`);
      if (response.ok) return;
    } catch {
      // Сервер может ещё запускаться.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Сервер браузерной сборки не запустился.');
}

class ObserverPerformanceBenchmark {
  constructor(years, timeoutMs) {
    this.years = years;
    this.timeoutMs = timeoutMs;
    this.turns = [];
    this.pageErrors = [];
    this.port = null;
    this.server = null;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async open() {
    this.port = await findFreePort();
    this.server = spawn('node', [serverScript], {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(this.port), BASE_PATH: basePath || '/' },
      stdio: 'inherit',
    });
    await waitForServer(this.port, this.server);
    this.browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
      args: ['--no-sandbox'],
    });
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
    await this.context.addInitScript(({ seed }) => {
      let state = seed >>> 0;
      Math.random = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };

      window.__performanceFrameGaps = [];
      let previousFrame = 0;
      const recordFrame = (time) => {
        if (previousFrame) window.__performanceFrameGaps.push(time - previousFrame);
        previousFrame = time;
        requestAnimationFrame(recordFrame);
      };
      requestAnimationFrame(recordFrame);
    }, { seed: 160_100 });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(120_000);
    this.page.on('pageerror', (error) => this.pageErrors.push(error.stack ?? error.message));
    this.page.on('crash', () => {
      const message = 'Браузерная страница аварийно завершилась.';
      this.pageErrors.push(message);
      console.error(message);
    });
    this.page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error') {
        const location = message.location();
        const source = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : '';
        this.pageErrors.push(`${text}${source}`);
      }
    });
    await this.page.goto(`http://127.0.0.1:${this.port}${publicPath('/')}`);
    await this.page.getByTestId('button-role-observer').click();
    await this.page.getByTestId('button-start').click();
    await this.page.getByTestId('button-next').waitFor({ state: 'visible', timeout: 180_000 });
    await this.page.waitForFunction(() =>
      Boolean(window.__ZERO_STRATEGY_PERFORMANCE_TEST__) &&
      Boolean(document.querySelector('[data-testid="map-canvas"]')),
    );
    await this.waitForIdle(180_000);
  }

  async waitForIdle(timeoutMs) {
    await this.page.waitForFunction(() => {
      const state = window.__ZERO_STRATEGY_PERFORMANCE_TEST__?.getSnapshot();
      return !!state && !state.busy && !state.drawing && state.progress === null;
    }, null, { timeout: timeoutMs, polling: 50 });
  }

  async measureTurn(index) {
    const before = await this.page.evaluate(() => {
      const bridge = window.__ZERO_STRATEGY_PERFORMANCE_TEST__;
      return {
        year: bridge.getSnapshot().year,
        startedAt: performance.now(),
        firstFrameGap: window.__performanceFrameGaps.length,
      };
    });

    await this.page.evaluate(() => {
      const bridge = window.__ZERO_STRATEGY_PERFORMANCE_TEST__;
      window.__ZERO_STRATEGY_BENCHMARK_ERROR__ = null;
      setTimeout(() => {
        try {
          void bridge.advanceTurn().catch((error) => {
            window.__ZERO_STRATEGY_BENCHMARK_ERROR__ = error?.stack ?? String(error);
            console.error(window.__ZERO_STRATEGY_BENCHMARK_ERROR__);
          });
        } catch (error) {
          window.__ZERO_STRATEGY_BENCHMARK_ERROR__ = error?.stack ?? String(error);
          console.error(window.__ZERO_STRATEGY_BENCHMARK_ERROR__);
        }
      }, 0);
    });
    try {
      await this.page.waitForFunction((previousYear) => {
        const state = window.__ZERO_STRATEGY_PERFORMANCE_TEST__?.getSnapshot();
        return !!state && (state.year > previousYear && !state.busy && !state.drawing && state.progress === null ||
          !!window.__ZERO_STRATEGY_BENCHMARK_ERROR__);
      }, before.year, { timeout: this.timeoutMs, polling: 50 });
    } catch (error) {
      console.log(`Ход ${index}/${this.years} не завершился за ${this.timeoutMs} мс; год до запуска: ${before.year}.`);
      console.log(`Ошибки браузера: ${JSON.stringify(this.pageErrors)}`);
      throw error;
    }
    const advanceError = await this.page.evaluate(() => window.__ZERO_STRATEGY_BENCHMARK_ERROR__);
    if (advanceError) throw new Error(`Автоматический ход завершился с ошибкой: ${advanceError}`);

    const result = await this.page.evaluate(({ index, before }) => {
      const bridge = window.__ZERO_STRATEGY_PERFORMANCE_TEST__;
      const state = bridge.getSnapshot();
      const frameGaps = window.__performanceFrameGaps.splice(before.firstFrameGap);
      return {
        index,
        year: state.year,
        durationMs: performance.now() - before.startedAt,
        events: bridge.takeSamples(),
        stages: bridge.takeStages(),
        frameGaps,
      };
    }, { index, before });

    this.turns.push(result);
    const resolved = result.events.filter((event) => event.cardType !== null);
    const slowest = [...resolved].sort((a, b) => b.durationMs - a.durationMs)[0];
    const slowestStage = [...result.stages].sort((a, b) => b.durationMs - a.durationMs)[0];
    console.log(`Ход ${index}/${this.years}, год ${result.year}: ${result.durationMs.toFixed(1)} мс, событий ${resolved.length}${slowest ? `, медленнейшее ${slowest.cardType}: выбор ${slowest.drawDurationMs.toFixed(1)} мс, выполнение ${slowest.resolutionDurationMs.toFixed(1)} мс` : ''}${slowestStage ? `; этап ${slowestStage.stage} (${slowestStage.cardType}): ${slowestStage.durationMs.toFixed(1)} мс` : ''}.`);
    if (process.env.PERF_VERBOSE === '1') {
      const slowStages = [...result.stages].sort((a, b) => b.durationMs - a.durationMs).slice(0, 8);
      console.log(`Самые долгие подэтапы: ${slowStages.map(({ stage, cardType, durationMs }) =>
        `${stage} (${cardType}): ${durationMs.toFixed(1)} мс`).join('; ')}`);
      const totals = new Map();
      for (const { stage, cardType, durationMs } of result.stages) {
        const key = `${stage} (${cardType})`;
        const total = totals.get(key) ?? { durationMs: 0, count: 0, maximumMs: 0 };
        total.durationMs += durationMs;
        total.count += 1;
        total.maximumMs = Math.max(total.maximumMs, durationMs);
        totals.set(key, total);
      }
      const slowTotals = [...totals].sort((a, b) => b[1].durationMs - a[1].durationMs).slice(0, 8);
      console.log(`Суммарные этапы: ${slowTotals.map(([stage, total]) =>
        `${stage}: ${total.durationMs.toFixed(1)} мс за ${total.count} вызовов, максимум ${total.maximumMs.toFixed(1)} мс`).join('; ')}`);
    }
    return result;
  }

  summarize() {
    const durations = this.turns.map(({ durationMs }) => durationMs);
    const events = this.turns.flatMap(({ events: samples }) => samples.filter((sample) => sample.cardType !== null));
    const stages = this.turns.flatMap(({ stages: samples }) => samples);
    const allFrameGaps = this.turns.flatMap(({ frameGaps }) => frameGaps);
    const median = (values) => {
      if (!values.length) return 0;
      const ordered = [...values].sort((a, b) => a - b);
      const middle = Math.floor(ordered.length / 2);
      return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
    };
    const slowEvents = [...events].sort((a, b) => b.resolutionDurationMs - a.resolutionDurationMs).slice(0, 10);
    const slowStages = [...stages].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
    const eventTypes = Object.groupBy(events, ({ cardType }) => cardType);
    const summary = {
      turns: this.turns.length,
      totalMs: durations.reduce((sum, duration) => sum + duration, 0),
      maximumTurnMs: Math.max(0, ...durations),
      eventCount: events.length,
      medianTurnMs: median(durations),
      medianCardCycleMs: median(events.map(({ durationMs }) => durationMs)),
      medianEventExecutionMs: median(events.map(({ resolutionDurationMs }) => resolutionDurationMs)),
      maximumEventExecutionMs: Math.max(0, ...events.map(({ resolutionDurationMs }) => resolutionDurationMs)),
      medianCardDrawMs: median(events.map(({ drawDurationMs }) => drawDurationMs)),
      maximumEventMs: Math.max(0, ...events.map(({ durationMs }) => durationMs)),
      medianFrameGapMs: median(allFrameGaps),
      eventTypeMedians: Object.fromEntries(Object.entries(eventTypes ?? {}).map(([type, samples]) => [type, {
        count: samples.length,
        cardCycleMs: median(samples.map(({ durationMs }) => durationMs)),
        executionMs: median(samples.map(({ resolutionDurationMs }) => resolutionDurationMs)),
      }])),
      maximumCardDrawMs: Math.max(0, ...events.map(({ drawDurationMs }) => drawDurationMs)),
      maximumCardResolutionMs: Math.max(0, ...events.map(({ resolutionDurationMs }) => resolutionDurationMs)),
      slowStages,
      eventsExecutionOverOneSecond: events.filter(({ resolutionDurationMs }) => resolutionDurationMs > 1000).length,
      maximumFrameGapMs: Math.max(0, ...allFrameGaps),
      framesOver50Ms: allFrameGaps.filter((gap) => gap > 50).length,
      slowEvents,
    };
    console.log(`Итог браузерного замера: ${JSON.stringify(summary, null, 2)}`);
    assert.ok(summary.maximumTurnMs <= 60_000, 'Один ход не должен длиться больше 60 секунд.');
    assert.ok(summary.maximumEventExecutionMs <= 1_000, 'Исполнение одного события не должно длиться больше секунды.');
    assert.ok(summary.medianEventExecutionMs <= 200, 'Медианное время исполнения события не должно превышать 200 мс.');
    assert.deepEqual(this.pageErrors, [], 'В браузере не должно быть необработанных ошибок.');
  }

  async close() {
    await this.browser?.close().catch(() => {});
    if (this.server && this.server.exitCode === null) this.server.kill('SIGTERM');
  }

  async run() {
    let profiler = null;
    try {
      await this.open();
      profiler = process.env.PERF_CPU_PROFILE === '1'
        ? await this.context.newCDPSession(this.page) : null;
      if (profiler) {
        await profiler.send('Profiler.enable');
        await profiler.send('Profiler.start');
      }
      try {
        for (let index = 1; index <= this.years; index += 1) await this.measureTurn(index);
      } finally {
        if (profiler) {
          const { profile } = await profiler.send('Profiler.stop');
          const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
          const samples = new Map();
          profile.samples?.forEach((id, index) => {
            samples.set(id, (samples.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
          });
          console.log('Профиль процессора:', [...samples].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([id, microseconds]) => ({
            function: nodes.get(id)?.callFrame.functionName ?? 'неизвестная функция',
            milliseconds: Math.round(microseconds / 1000),
            line: nodes.get(id)?.callFrame.lineNumber ?? -1,
            parent: profile.nodes.find((node) => node.children?.includes(id))?.callFrame.functionName ?? null,
          })));
        }
      }
      this.summarize();
    } finally {
      await this.close();
    }
  }
}

await new ObserverPerformanceBenchmark(benchmarkYears, turnTimeoutMs).run();
