/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC_ROOT = path.resolve(__dirname, '..', 'static-build');
const TEMPLATE_PATH = path.resolve(__dirname, 'templates', 'landing-page.html');
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, '..', 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
    return typeof appJson.expo?.name === 'string'
      ? appJson.expo.name
      : 'App Landing Page';
  } catch {
    return 'App Landing Page';
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toScriptString(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function getRequestOrigin(req) {
  const firstHeaderValue = (value) =>
    typeof value === 'string' ? value.split(',')[0].trim() : '';
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const protocol =
    forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  const host = forwardedHost || req.headers.host;

  if (!host || !['http', 'https'].includes(protocol)) {
    throw new Error('Missing or invalid request origin');
  }

  return new URL(`${protocol}://${host}`).origin;
}

function rebaseResourceUrl(value, origin) {
  const parsed = new URL(value, 'https://build.invalid');
  let pathname = parsed.pathname;
  if (
    basePath &&
    pathname !== basePath &&
    !pathname.startsWith(`${basePath}/`)
  ) {
    pathname = `${basePath}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  }

  return `${origin}${pathname}${parsed.search}${parsed.hash}`;
}

function rebaseManifest(manifest, origin, platform) {
  if (manifest.launchAsset?.url) {
    manifest.launchAsset.url = rebaseResourceUrl(
      manifest.launchAsset.url,
      origin,
    );
  }

  if (Array.isArray(manifest.assets)) {
    for (const asset of manifest.assets) {
      if (asset.url) asset.url = rebaseResourceUrl(asset.url, origin);
    }
  }

  const expoClient = manifest.extra?.expoClient;
  if (expoClient) {
    if (expoClient.iconUrl) {
      expoClient.iconUrl = rebaseResourceUrl(expoClient.iconUrl, origin);
    }
    expoClient.hostUri = `${new URL(origin).host}${basePath}/${platform}`;
  }

  if (manifest.extra?.expoGo) {
    manifest.extra.expoGo.debuggerHost =
      `${new URL(origin).host}${basePath}/${platform}`;
  }

  return manifest;
}

function serveManifest(req, platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  let manifest;
  try {
    manifest = rebaseManifest(
      JSON.parse(fs.readFileSync(manifestPath, 'utf-8')),
      getRequestOrigin(req),
      platform,
    );
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `Could not prepare manifest: ${error.message}` }));
    return;
  }

  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
  });
  res.end(JSON.stringify(manifest));
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `exps://${host}${basePath}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_ATTRIBUTE_PLACEHOLDER/g, escapeHtml(expsUrl))
    .replace(/EXPS_URL_JSON_PLACEHOLDER/g, toScriptString(expsUrl))
    .replace(/APP_NAME_PLACEHOLDER/g, escapeHtml(appName));

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveStaticFile(urlPath, req, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  let content = fs.readFileSync(filePath);
  if (
    ext === '.js' &&
    filePath.endsWith(`${path.sep}bundle.js`) &&
    content.includes('__ZERO_STRATEGY_ORIGIN__')
  ) {
    content = Buffer.from(
      content
        .toString('utf-8')
        .replaceAll(
          '__ZERO_STRATEGY_ORIGIN__',
          `${getRequestOrigin(req)}${basePath}`,
        ),
    );
  }
  res.writeHead(200, { 'content-type': contentType });
  res.end(content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
const appName = getAppName();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (
    basePath &&
    pathname !== basePath &&
    !pathname.startsWith(`${basePath}/`)
  ) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  if (pathname === '/' || pathname === '/manifest') {
    const platform = req.headers['expo-platform'];
    if (platform === 'ios' || platform === 'android') {
      return serveManifest(req, platform, res);
    }

    if (pathname === '/') {
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  serveStaticFile(pathname, req, res);
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving static Expo build on port ${port}`);
});
