const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'static-build');
const configuredBasePath = (process.env.BASE_PATH || '/').trim();
const basePath =
  configuredBasePath === '' || configuredBasePath === '/'
    ? ''
    : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;

if (basePath.includes('..') || basePath.includes('?') || basePath.includes('#')) {
  throw new Error(`Invalid BASE_PATH: ${configuredBasePath}`);
}

fs.rmSync(outputDir, { recursive: true, force: true });

console.log('Exporting Zero Strategy as a browser app...');
console.log(`Browser base path: ${basePath || '/'}`);

const appConfigPath = path.join(projectRoot, 'app.json');
const originalAppConfig = fs.readFileSync(appConfigPath, 'utf8');
const appConfig = JSON.parse(originalAppConfig);
appConfig.expo.experiments = {
  ...appConfig.expo.experiments,
  baseUrl: basePath,
};
fs.writeFileSync(appConfigPath, `${JSON.stringify(appConfig, null, 2)}\n`);

let result;
try {
  result = spawnSync(
    'pnpm',
    [
      'exec',
      'expo',
      'export',
      '--platform',
      'web',
      '--output-dir',
      'static-build',
      '--clear',
    ],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
    },
  );
} finally {
  fs.writeFileSync(appConfigPath, originalAppConfig);
}

if (result.error) throw result.error;
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const indexHtml = path.join(outputDir, 'index.html');
if (!fs.existsSync(indexHtml) || fs.statSync(indexHtml).size === 0) {
  throw new Error('Expo web export did not produce a non-empty static-build/index.html');
}

console.log(`Browser build complete: ${indexHtml}`);
