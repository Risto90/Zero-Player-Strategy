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
    this.page.on('pageerror', (error) => this.pageErrors.push(error.message));
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

    await this.page.evaluate(() => window.__ZERO_STRATEGY_PERFORMANCE_TEST__.advanceTurn());
    await this.page.waitForFunction((previousYear) => {
      const state = window.__ZERO_STRATEGY_PERFORMANCE_TEST__?.getSnapshot();
      return !!state && state.year > previousYear && !state.busy && !state.drawing && state.progress === null;
    }, before.year, { timeout: this.timeoutMs, polling: 50 });

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
    return result;
  }

  summarize() {
    const durations = this.turns.map(({ durationMs }) => durationMs);
    const events = this.turns.flatMap(({ events: samples }) => samples.filter((sample) => sample.cardType !== null));
    const stages = this.turns.flatMap(({ stages: samples }) => samples);
    const allFrameGaps = this.turns.flatMap(({ frameGaps }) => frameGaps);
    const eventAverageMs = events.length
      ? events.reduce((sum, event) => sum + event.durationMs, 0) / events.length
      : 0;
    const averageDrawMs = events.length
      ? events.reduce((sum, event) => sum + event.drawDurationMs, 0) / events.length
      : 0;
    const averageResolutionMs = events.length
      ? events.reduce((sum, event) => sum + event.resolutionDurationMs, 0) / events.length
      : 0;
    const slowEvents = [...events].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
    const slowStages = [...stages].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
    const summary = {
      turns: this.turns.length,
      totalMs: durations.reduce((sum, duration) => sum + duration, 0),
      averageTurnMs: durations.reduce((sum, duration) => sum + duration, 0) / Math.max(1, durations.length),
      maximumTurnMs: Math.max(0, ...durations),
      eventCount: events.length,
      averageEventMs: eventAverageMs,
      averageCardDrawMs: averageDrawMs,
      averageCardResolutionMs: averageResolutionMs,
      maximumCardDrawMs: Math.max(0, ...events.map(({ drawDurationMs }) => drawDurationMs)),
      maximumCardResolutionMs: Math.max(0, ...events.map(({ resolutionDurationMs }) => resolutionDurationMs)),
      slowStages,
      eventsOverOneSecond: events.filter(({ durationMs }) => durationMs > 1000).length,
      maximumFrameGapMs: Math.max(0, ...allFrameGaps),
      framesOver50Ms: allFrameGaps.filter((gap) => gap > 50).length,
      slowEvents,
    };
    console.log(`Итог браузерного замера: ${JSON.stringify(summary, null, 2)}`);
    if (summary.maximumTurnMs > this.timeoutMs) console.warn('Превышен установленный предел длительности хода.');
    if (summary.eventsOverOneSecond) console.warn('Есть автоматические события дольше одной секунды — их нужно оптимизировать.');
    if (summary.averageEventMs > 200) console.warn('Среднее время автоматического события превышает 200 мс.');
    if (summary.framesOver50Ms) console.warn('Зафиксированы задержки кадров больше 50 мс.');
    assert.deepEqual(this.pageErrors, [], 'В браузере не должно быть необработанных ошибок.');
  }

  async close() {
    await this.context?.close();
    await this.browser?.close();
    if (this.server && this.server.exitCode === null) this.server.kill('SIGTERM');
  }

  async run() {
    try {
      await this.open();
      for (let index = 1; index <= this.years; index += 1) await this.measureTurn(index);
      this.summarize();
    } finally {
      await this.close();
    }
  }
}

await new ObserverPerformanceBenchmark(benchmarkYears, turnTimeoutMs).run();
