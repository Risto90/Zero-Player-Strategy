import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmRoot = path.join(appRoot, 'generated-artifacts', 'kernel', 'wasm');
const browserCandidates = [
  process.env.CHROMIUM_PATH,
  '/repl/tools/bin/chromium',
  '/nix/store/71577rskzyhch3axhdqx7faygc2xyn4v-playwright-browsers-1.55.0-with-cjk/chromium-1187/chrome-linux/chrome',
  '/nix/store/d7y5039fgn5432kgkn0cv09hda4a7nxz-playwright-chromium-cjk-1.55.0-1187/chrome-linux/chrome',
].filter(Boolean);
const executablePath = browserCandidates.find(existsSync);
if (!executablePath) {
  throw new Error('Chromium не найден; задайте CHROMIUM_PATH для браузерного смоук-теста.');
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};
const server = createServer((request, response) => {
  const name = request.url === '/' ? 'browser.html' : decodeURIComponent(request.url.slice(1));
  const resolved = path.resolve(wasmRoot, name);
  if (!resolved.startsWith(`${wasmRoot}${path.sep}`) && resolved !== path.join(wasmRoot, 'browser.html')) {
    response.writeHead(404).end();
    return;
  }
  try {
    const file = readFileSync(resolved);
    const extension = path.extname(resolved);
    response.writeHead(200, {
      'Content-Type': contentTypes[extension] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    response.end(file);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
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
  await page.waitForFunction(() => window.kernelSmokeResult !== undefined);
  const result = await page.evaluate(() => window.kernelSmokeResult);
  assert.deepEqual(result, { ok: true, sum: '42', threaded: true, isolated: true });
  assert.deepEqual(errors, []);
  console.log(`Браузерное ядро WASM проверено в Chromium: ${executablePath}`);
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
