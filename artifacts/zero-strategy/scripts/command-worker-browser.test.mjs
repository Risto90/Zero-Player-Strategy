import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(appRoot, '../..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'zero-strategy-command-workers-'));
const browserCandidates = [
  process.env.CHROMIUM_PATH,
  '/repl/tools/bin/chromium',
  '/nix/store/71577rskzyhch3axhdqx7faygc2xyn4v-playwright-browsers-1.55.0-with-cjk/chromium-1187/chrome-linux/chrome',
  '/nix/store/d7y5039fgn5432kgkn0cv09hda4a7nxz-playwright-chromium-cjk-1.55.0-1187/chrome-linux/chrome',
].filter(Boolean);
const executablePath = browserCandidates.find(existsSync);
if (!executablePath) throw new Error('Chromium не найден для проверки Web Workers.');

function build(source, output) {
  const result = spawnSync(path.join(appRoot, '../api-server/node_modules/.bin/esbuild'), [
    source,
    '--bundle',
    '--platform=browser',
    '--format=esm',
    '--target=es2022',
    `--outfile=${output}`,
  ], { cwd: workspaceRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Не удалось собрать браузерный модуль: ${result.stderr || result.stdout}`);
  }
}

build(path.join(appRoot, 'game/commandWorkerPool.ts'), path.join(tempRoot, 'pool.js'));
build(path.join(appRoot, 'game/commandWorker.ts'), path.join(tempRoot, 'worker.js'));

const html = `<!doctype html>
<meta charset="utf-8">
<script type="module">
  import { CommandWorkerPool } from './pool.js';
  const pool = new CommandWorkerPool(
    () => new Worker('./worker.js', { type: 'module' }),
    { workerCount: 2, maxPending: 4 },
  );
  try {
    const [sum, ranked] = await Promise.all([
      pool.run({ operation: 'sum-numbers', payload: [5, 11, 26] }),
      pool.run({
        operation: 'score-candidates',
        payload: { candidates: [
          { id: 2, impact: 6, cost: 3, climateFit: 0.8 },
          { id: 1, impact: 10, cost: 2, climateFit: 0.8 },
        ] },
      }),
    ]);
    window.commandWorkerResult = {
      workers: pool.metrics().workers,
      sum,
      ranked,
      errors: pool.metrics().failed,
    };
  } catch (error) {
    window.commandWorkerError = error instanceof Error ? error.message : String(error);
  } finally {
    pool.dispose();
  }
</script>`;

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    return;
  }
  const filename = pathname === '/pool.js' ? 'pool.js' : pathname === '/worker.js' ? 'worker.js' : null;
  if (!filename) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }).end(awaitRead(filename));
});

function awaitRead(filename) {
  return readFileSync(path.join(tempRoot, filename));
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() =>
    window.commandWorkerResult !== undefined || window.commandWorkerError !== undefined);
  const result = await page.evaluate(() => ({
    result: window.commandWorkerResult,
    error: window.commandWorkerError,
  }));
  assert.equal(result.error, undefined);
  assert.equal(result.result.workers, 2);
  assert.equal(result.result.sum, 42);
  assert.deepEqual(result.result.ranked.map(({ id }) => id), [1, 2]);
  assert.deepEqual(errors, []);
  console.log('Web Workers браузера выполнили два независимых расчёта; проверка пула завершена.');
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())));
  rmSync(tempRoot, { recursive: true, force: true });
}
