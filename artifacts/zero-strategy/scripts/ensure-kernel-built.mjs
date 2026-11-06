import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = [
  path.join(appRoot, 'kernel', 'src'),
  path.join(appRoot, 'kernel', 'include'),
];
const buildScript = path.join(appRoot, 'scripts', 'build-kernel.mjs');
const outputs = [
  path.join(appRoot, 'public', 'generated-kernel', 'zero_kernel.mjs'),
  path.join(appRoot, 'public', 'generated-kernel', 'zero_kernel.wasm'),
];

function newestFileTime(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestFileTime(entryPath));
    } else {
      newest = Math.max(newest, statSync(entryPath).mtimeMs);
    }
  }
  return newest;
}

const outputsExist = outputs.every((file) => existsSync(file));
const oldestOutput = outputsExist
  ? Math.min(...outputs.map((file) => statSync(file).mtimeMs))
  : 0;
const newestSource = Math.max(
  statSync(buildScript).mtimeMs,
  ...sourceRoots.map(newestFileTime),
);

if (outputsExist && oldestOutput >= newestSource) {
  console.log('Бинарное ядро актуально; повторная компиляция не требуется.');
  process.exit(0);
}

console.log('Исходники бинарного ядра изменились; выполняется компиляция.');
const result = spawnSync(process.execPath, [buildScript], {
  cwd: appRoot,
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
