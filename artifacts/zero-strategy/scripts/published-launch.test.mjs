import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(projectRoot, 'server', 'serve.js');
const basePath = '/preview-zero-strategy';
const publicOrigin = 'https://published.zero-strategy.example';
const publicHost = new URL(publicOrigin).host;

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Static server exited early with status ${child.exitCode}`);
    }
    try {
      const response = await request(port, basePath, { 'expo-platform': 'android' });
      if (response.ok) return;
    } catch {
      // The server may not have bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Static server did not become ready');
}

async function checkRemoteResource(port, resource, expectedContentType, consumeBody = true) {
  const url = new URL(resource.url);
  assert.equal(url.origin, publicOrigin, `${resource.label} must use the active request origin`);
  assert.ok(
    url.pathname === basePath || url.pathname.startsWith(`${basePath}/`),
    `${resource.label} must include configured base path`,
  );
  assert.doesNotMatch(resource.url, /localhost|127\.0\.0\.1|spock\.replit\.dev/i);

  const response = await request(port, `${url.pathname}${url.search}`);
  assert.equal(response.status, 200, `${resource.label} should be served`);
  const contentType = response.headers.get('content-type') || '';
  if (expectedContentType) {
    assert.ok(
      contentType.startsWith(expectedContentType),
      `${resource.label} expected ${expectedContentType}, received ${contentType}`,
    );
  }
  if (consumeBody) await response.arrayBuffer();
  return response;
}

const port = await findFreePort();
const child = spawn('node', [serverScript], {
  cwd: projectRoot,
  env: { ...process.env, PORT: String(port), BASE_PATH: basePath },
  stdio: 'inherit',
});

try {
  await waitForServer(port, child);

  for (const platform of ['android', 'ios']) {
    const response = await request(port, basePath, { 'expo-platform': platform });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('expo-protocol-version'), '1');
    assert.equal(response.headers.get('expo-sfv-version'), '0');
    assert.match(response.headers.get('content-type') || '', /^application\/json\b/);

    const manifest = await response.json();
    assert.equal(manifest.runtimeVersion, 'exposdk:58.0.0');
    assert.ok(manifest.launchAsset?.url, `${platform} manifest needs a launch bundle`);
    assert.doesNotMatch(
      JSON.stringify(manifest),
      /localhost|127\.0\.0\.1|spock\.replit\.dev/i,
      `${platform} manifest must not expose stale or local URLs`,
    );

    const bundleResponse = await checkRemoteResource(
      port,
      { label: `${platform} launch bundle`, url: manifest.launchAsset.url },
      manifest.launchAsset.contentType || 'application/javascript',
      false,
    );
    const bundle = await bundleResponse.text();
    assert.ok(bundle.length > 0, `${platform} launch bundle must not be empty`);
    assert.ok(
      !bundle.includes('__ZERO_STRATEGY_ORIGIN__'),
      `${platform} bundle origin marker must be replaced at request time`,
    );
    assert.doesNotMatch(
      bundle,
      /\/\/[#@]\s*sourceMappingURL=/,
      `${platform} bundle must not reference an unpublished source map`,
    );
    assert.doesNotMatch(bundle, /httpServerLocation:"https?:\/\/[^"]*spock\.replit\.dev/i);

    const bundleAssets = [];
    const assetPattern =
      /httpServerLocation:"([^"]+)"[^}]*hash:"[^"]+"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g;
    for (const match of bundle.matchAll(assetPattern)) {
      const assetDirectory = match[1].endsWith('/') ? match[1] : `${match[1]}/`;
      const url = new URL(`${match[2]}.${match[3]}`, assetDirectory).toString();
      const type = match[3].toLowerCase();
      const contentType =
        type === 'jpg' ? 'image/jpeg' :
        type === 'png' ? 'image/png' :
        type === 'webp' ? 'image/webp' :
        type === 'avif' ? 'image/avif' :
        type === 'svg' ? 'image/svg+xml' :
        type === 'ttf' ? 'font/ttf' :
        type === 'otf' ? 'font/otf' :
        type === 'woff' ? 'font/woff' :
        type === 'woff2' ? 'font/woff2' :
        type === 'xml' ? 'application/xml' :
        undefined;
      bundleAssets.push({
        label: `${platform} bundle asset ${match[2]}.${match[3]}`,
        url,
        contentType,
      });
    }
    assert.ok(bundleAssets.length > 0, `${platform} bundle should declare local assets`);

    const resources = [
      ...bundleAssets,
      ...(manifest.assets || []).map((asset, index) => ({
        label: `${platform} declared asset ${index + 1}`,
        url: asset.url,
        contentType: asset.contentType,
      })),
      ...(manifest.extra?.expoClient?.iconUrl
        ? [{
            label: `${platform} app icon`,
            url: manifest.extra.expoClient.iconUrl,
            contentType: 'image/png',
          }]
        : []),
    ];

    for (let index = 0; index < resources.length; index += 16) {
      await Promise.all(
        resources
          .slice(index, index + 16)
          .map((resource) =>
            checkRemoteResource(port, resource, resource.contentType),
          ),
      );
    }
  }

  console.log('Published Expo Go launch checks passed for iOS and Android.');
} finally {
  child.kill('SIGTERM');
}
