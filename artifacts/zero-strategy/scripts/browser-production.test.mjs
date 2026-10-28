import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticRoot = path.join(projectRoot, 'static-build');
const serverScript = path.join(projectRoot, 'server', 'serve.js');
const configuredBasePath = (process.env.BASE_PATH || '/').trim();
const basePath =
  configuredBasePath === '' || configuredBasePath === '/'
    ? ''
    : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;
const publicOrigin = 'https://published.zero-strategy.example';
const publicHost = new URL(publicOrigin).host;
const indexPath = path.join(staticRoot, 'index.html');
const assetRoot = path.join(staticRoot, 'assets');

assert.ok(
  existsSync(indexPath) && statSync(indexPath).size > 0,
  'production browser build must include static-build/index.html; Expo Go launch bundles are not accepted',
);
assert.doesNotMatch(
  readFileSync(path.resolve(projectRoot, '../../.replitignore'), 'utf8'),
  /(?:^|\n)\s*artifacts\/zero-strategy\/static-build\/?(?:\s|$)/,
  'generated browser files must be included in the published image',
);
const appConfig = JSON.parse(readFileSync(path.join(projectRoot, 'app.json'), 'utf8'));
assert.deepEqual(appConfig.expo.platforms, ['web'], 'the application is built only for the browser');
assert.equal(
  existsSync(path.join(projectRoot, 'components', 'map', 'MapView.tsx')),
  false,
  'the project must not keep a separate native map implementation',
);
assert.equal(
  existsSync(path.join(projectRoot, 'game', 'storage.web.ts')),
  false,
  'browser storage must have a single implementation',
);
const playSource = readFileSync(path.join(projectRoot, 'app', 'play.tsx'), 'utf8');
assert.doesNotMatch(
  playSource,
  /Platform\.OS|Platform\.select|AppState|useSafeAreaInsets/u,
  'the game screen must not branch into native-only behavior',
);

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

async function request(port, pathname, headers = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: {
      host: publicHost,
      'x-forwarded-host': publicHost,
      'x-forwarded-proto': 'https',
      ...headers,
    },
  });
}

function publicPath(pathname) {
  return `${basePath}${pathname.startsWith('/') ? pathname : `/${pathname}`}` || '/';
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Browser server exited early with status ${child.exitCode}`);
    }
    try {
      const response = await request(port, publicPath('/status'));
      if (response.ok) return;
    } catch {
      // The server may not have bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser server did not become ready');
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

const port = await findFreePort();
const child = spawn('node', [serverScript], {
  cwd: projectRoot,
  env: { ...process.env, PORT: String(port), BASE_PATH: basePath || '/' },
  stdio: 'inherit',
});

try {
  await waitForServer(port, child);

  const health = await request(port, publicPath('/status'));
  assert.equal(await health.text(), 'ok');

  const root = await request(port, publicPath('/'), { 'expo-platform': 'android' });
  assert.equal(root.status, 200, 'the public root must serve the browser app');
  assert.match(root.headers.get('content-type') || '', /^text\/html\b/);
  assert.doesNotMatch(
    root.headers.get('content-type') || '',
    /application\/json/,
    'Expo platform headers must not switch the root to a native manifest',
  );
  const html = await root.text();
  assert.match(html, /id="root"/i, 'the browser export should include its React app mount point');
  assert.doesNotMatch(
    html,
    /Expo Go|QR Code|qr-code-styling|exps:\/\//i,
    'the production root must not regress to the Expo Go launch page',
  );

  const localResources = [];
  const resourcePattern = /<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(resourcePattern)) {
    const resource = new URL(match[1], `${publicOrigin}${publicPath('/')}`);
    if (resource.origin !== publicOrigin || resource.protocol === 'data:') continue;
    assert.ok(
      resource.pathname === basePath ||
        resource.pathname.startsWith(`${basePath || ''}/`),
      `browser resource ${resource.href} must use the configured base path`,
    );
    localResources.push(resource);
  }
  assert.ok(
    localResources.some((resource) => resource.pathname.endsWith('.js')),
    'the browser app must load a JavaScript bundle',
  );

  for (const resource of localResources) {
    const response = await request(port, `${resource.pathname}${resource.search}`);
    assert.equal(response.status, 200, `browser resource ${resource.pathname} should load`);
    if (resource.pathname.endsWith('.js')) {
      const bundle = await response.text();
      assert.ok(bundle.length > 0, `${resource.pathname} must not be empty`);
    } else {
      await response.arrayBuffer();
    }
  }

  const staticAssets = listFiles(assetRoot);
  assert.ok(staticAssets.some((file) => file.endsWith('.ttf')), 'the browser build must include fonts');
  assert.ok(staticAssets.some((file) => file.endsWith('.png')), 'the browser build must include map images');
  const assetPaths = staticAssets.map((file) =>
    publicPath(`/assets/${path.relative(assetRoot, file).split(path.sep).join('/')}`),
  );
  for (let index = 0; index < assetPaths.length; index += 16) {
    await Promise.all(
      assetPaths.slice(index, index + 16).map(async (assetPath) => {
        const response = await request(port, assetPath);
        assert.equal(response.status, 200, `browser asset ${assetPath} should load`);
        await response.arrayBuffer();
      }),
    );
  }

  for (const route of ['/play', '/country/example', '/city/example']) {
    const response = await request(port, publicPath(route));
    assert.equal(response.status, 200, `client route ${route} must load directly`);
    assert.match(response.headers.get('content-type') || '', /^text\/html\b/);
    assert.match(await response.text(), /<html/i);
  }

  const manifest = await request(port, publicPath('/manifest'), {
    'expo-platform': 'android',
  });
  assert.equal(manifest.status, 404, 'the Expo Go manifest endpoint must be removed');

  const missingAsset = await request(port, publicPath('/_expo/missing.js'));
  assert.equal(missingAsset.status, 404, 'missing browser assets must not fall back to HTML');

  const mapSource = readFileSync(
    path.join(projectRoot, 'components', 'map', 'MapView.web.tsx'),
    'utf8',
  );
  assert.match(mapSource, /touchAction:\s*'none'/, 'the map must keep touch gesture handling');
  const storageSource = readFileSync(path.join(projectRoot, 'game', 'storage.ts'), 'utf8');
  assert.match(storageSource, /indexedDB\.open/, 'browser saves must use persistent IndexedDB');

  console.log(
    `Browser production checks passed at ${publicPath('/')} with ${localResources.length} local HTML resources.`,
  );
} finally {
  child.kill('SIGTERM');
}
