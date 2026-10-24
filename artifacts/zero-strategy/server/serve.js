/**
 * Serves the static browser export produced by scripts/build.js.
 * Unknown extensionless paths fall back to index.html for Expo Router's
 * client-side routes. Missing static assets remain 404s.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const STATIC_ROOT = path.resolve(__dirname, '..', 'static-build');
const INDEX_FILE = path.join(STATIC_ROOT, 'index.html');
const configuredBasePath = (process.env.BASE_PATH || '/').trim();
const BASE_PATH =
  configuredBasePath === '' || configuredBasePath === '/'
    ? ''
    : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
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

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

function resolveStaticFile(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const candidate = path.resolve(STATIC_ROOT, `.${decodedPath}`);
  if (candidate !== STATIC_ROOT && !candidate.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    return null;
  }

  if (!fs.existsSync(candidate)) {
    if (path.extname(candidate)) return null;
    const htmlCandidate = `${candidate}.html`;
    if (fs.existsSync(htmlCandidate) && fs.statSync(htmlCandidate).isFile()) {
      return htmlCandidate;
    }
    return INDEX_FILE;
  }

  const stat = fs.statSync(candidate);
  if (stat.isDirectory()) {
    const directoryIndex = path.join(candidate, 'index.html');
    return fs.existsSync(directoryIndex) ? directoryIndex : null;
  }
  return stat.isFile() ? candidate : null;
}

function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch {
    return send(res, 400, 'Bad Request');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  if (BASE_PATH) {
    if (pathname === BASE_PATH) {
      res.writeHead(308, { location: `${BASE_PATH}/${url.search}` });
      return res.end();
    }
    if (!pathname.startsWith(`${BASE_PATH}/`)) {
      return send(res, 404, 'Not Found');
    }
    pathname = pathname.slice(BASE_PATH.length) || '/';
  }

  if (pathname === '/status') {
    return send(res, 200, 'ok');
  }
  if (pathname === '/manifest') {
    return send(res, 404, 'Not Found');
  }

  let filePath;
  try {
    filePath = resolveStaticFile(pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return send(res, 404, 'Not Found');
  }

  const extension = path.extname(filePath).toLowerCase();
  const headers = {
    'content-type': MIME_TYPES[extension] || 'application/octet-stream',
    'cache-control':
      extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  const body = req.method === 'HEAD' ? undefined : fs.readFileSync(filePath);
  res.writeHead(200, headers);
  res.end(body);
}

if (!fs.existsSync(INDEX_FILE)) {
  throw new Error(
    `Browser build not found at ${INDEX_FILE}; run "pnpm --filter @workspace/zero-strategy run build" first`,
  );
}

const port = Number.parseInt(process.env.PORT || '3000', 10);
const server = http.createServer(handleRequest);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving Zero Strategy browser build on port ${port} at ${BASE_PATH || '/'}`);
});
