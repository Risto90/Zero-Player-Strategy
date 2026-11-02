import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kernelRoot = path.join(appRoot, 'kernel');
const outputRoot = path.join(appRoot, 'generated-artifacts', 'kernel');
const wasmRoot = path.join(outputRoot, 'wasm');
const nodeRoot = path.join(outputRoot, 'node');
const nativeRoot = path.join(outputRoot, 'native');
const emscriptenCache = path.join(outputRoot, 'emscripten-cache');
const sources = [
  path.join(kernelRoot, 'src', 'core.cpp'),
  path.join(kernelRoot, 'src', 'algebra.cpp'),
  path.join(kernelRoot, 'src', 'buffers', 'buffer_store.cpp'),
];
const header = path.join(kernelRoot, 'include');
const cxx = process.env.CXX ?? 'clang++';
const emcc = process.env.EMCC ?? 'emcc';
const nodeExecutable = realpathSync(process.execPath);
const reactNativeRoot = path.join(appRoot, 'node_modules', 'react-native');
const jsiInclude = path.join(reactNativeRoot, 'ReactCommon', 'jsi');

mkdirSync(wasmRoot, { recursive: true });
mkdirSync(nodeRoot, { recursive: true });
mkdirSync(nativeRoot, { recursive: true });
prepareEmscriptenCache();
assertEmscriptenVersion();
assertCompilerVersion();
const nodeInclude = findNodeHeaders();
if (!existsSync(path.join(jsiInclude, 'jsi', 'jsi.h'))) {
  throw new Error('В установленном React Native не найдены заголовки JSI.');
}

const exports = [
  '_zk_abi_version',
  '_zk_memory_limit_bytes',
  '_zk_execution_mode',
  '_zk_error_name',
  '_zk_error_message',
  '_zk_i32_add',
  '_zk_i32_sum',
  '_zk_set_binary',
  '_zk_measure_binary',
  '_zk_measure_sum',
  '_zk_buffer_create',
  '_zk_buffer_release',
  '_zk_buffer_data',
  '_zk_buffer_size',
  '_zk_buffer_i32_sum',
  '_malloc',
  '_free',
].join(',');

const wasmCommon = [
  '-std=c++20',
  '-O2',
  '-fno-fast-math',
  '-ffp-contract=off',
  `-I${header}`,
  ...sources,
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sENVIRONMENT=web,node',
  '-sWASM_BIGINT=1',
  `-sEXPORTED_FUNCTIONS=${exports}`,
  '-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32,HEAP32',
  '-sFILESYSTEM=0',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sMAXIMUM_MEMORY=268435456',
  '-Wl,--build-id=none',
];

run(emcc, [...wasmCommon, '-o', path.join(wasmRoot, 'zero_kernel.mjs')]);
run(emcc, [
  ...wasmCommon,
  '-pthread',
  '-sPTHREAD_POOL_SIZE=2',
  '-sSHARED_MEMORY=1',
  '-sINITIAL_MEMORY=67108864',
  '-o',
  path.join(wasmRoot, 'zero_kernel_threads.mjs'),
]);

run(cxx, [
  '-std=c++20',
  '-O2',
  '-fPIC',
  '-shared',
  '-fno-fast-math',
  '-ffp-contract=off',
  '-pthread',
  '-DNODE_GYP_MODULE_NAME=zero_kernel_native',
  `-I${header}`,
  `-I${nodeInclude}`,
  path.join(kernelRoot, 'bindings', 'node', 'native_addon.cpp'),
  ...sources,
  '-Wl,--build-id=none',
  '-o',
  path.join(nodeRoot, 'zero_kernel_native.node'),
]);

run(cxx, [
  '-std=c++20',
  '-O2',
  '-fPIC',
  '-fno-fast-math',
  '-ffp-contract=off',
  '-pthread',
  `-I${header}`,
  `-I${jsiInclude}`,
  '-c',
  path.join(kernelRoot, 'bindings', 'jsi', 'zero_kernel_jsi.cpp'),
  '-o',
  path.join(nativeRoot, 'zero_kernel_jsi.o'),
]);

run(cxx, [
  '-std=c++20',
  '-O2',
  '-pthread',
  `-I${path.join(kernelRoot, 'src', 'native')}`,
  path.join(appRoot, 'scripts', 'native-queue.test.cpp'),
  '-o',
  path.join(nativeRoot, 'native-queue.test'),
]);

run(cxx, [
  '-std=c++20',
  '-O2',
  '-fno-fast-math',
  '-ffp-contract=off',
  `-I${header}`,
  path.join(appRoot, 'scripts', 'kernel-algebra.test.cpp'),
  path.join(kernelRoot, 'src', 'algebra.cpp'),
  '-o',
  path.join(nativeRoot, 'kernel-algebra.test'),
]);

const esbuild = path.resolve(appRoot, '../api-server/node_modules/.bin/esbuild');
if (!existsSync(esbuild)) {
  throw new Error(`Не найден esbuild для браузерной проверки: ${esbuild}`);
}
run(esbuild, [
  path.join(kernelRoot, 'bindings', 'wasm.ts'),
  '--bundle',
  '--format=esm',
  '--target=es2022',
  `--outfile=${path.join(wasmRoot, 'wasm-binding.mjs')}`,
]);
run(esbuild, [
  path.join(kernelRoot, 'bindings', 'native.ts'),
  '--bundle',
  '--format=esm',
  '--target=es2022',
  `--outfile=${path.join(nodeRoot, 'native-binding.mjs')}`,
]);
copyFileSync(
  path.join(kernelRoot, 'tests', 'browser.html'),
  path.join(wasmRoot, 'browser.html'),
);

const compilerInfo = readCommand(cxx, ['--version']).split('\n')[0];
const nodeApiVersion = process.versions.napi ?? 'неизвестна';
const buildRecord = {
  cxxStandard: 'c++20',
  compiler: compilerInfo,
  emscripten: readCommand(emcc, ['--version']).split('\n')[0],
  node: process.version,
  nodeApiVersion,
  artifacts: [
    'wasm/zero_kernel.mjs',
    'wasm/zero_kernel.wasm',
    'wasm/zero_kernel_threads.mjs',
    'wasm/zero_kernel_threads.wasm',
    'wasm/wasm-binding.mjs',
    'wasm/browser.html',
    'node/zero_kernel_native.node',
    'node/native-binding.mjs',
    'native/zero_kernel_jsi.o',
    'native/native-queue.test',
    'native/kernel-algebra.test',
  ],
};
await import('node:fs/promises').then(({ writeFile }) =>
  writeFile(path.join(outputRoot, 'build-info.json'), `${JSON.stringify(buildRecord, null, 2)}\n`),
);
console.log('Ядро собрано: однопоточный WASM, pthread WASM и нативная Node-обвязка.');

function assertEmscriptenVersion() {
  const output = readCommand(emcc, ['--version']);
  if (!output.includes('4.0.8')) {
    throw new Error(`Ожидается Emscripten 4.0.8, установлен: ${output.split('\n')[0]}`);
  }
}

function assertCompilerVersion() {
  const output = readCommand(cxx, ['--version']);
  if (!output.includes('20.1.8')) {
    throw new Error(`Ожидается Clang 20.1.8, установлен: ${output.split('\n')[0]}`);
  }
}

function prepareEmscriptenCache() {
  const stamp = path.join(emscriptenCache, 'sysroot_install.stamp');
  if (!existsSync(stamp)) {
    const packagedCache = path.join(findEmscriptenRoot(), 'cache');
    if (!existsSync(path.join(packagedCache, 'sysroot_install.stamp'))) {
      throw new Error('В кэше Emscripten не найдены подготовленные заголовки sysroot.');
    }
    if (existsSync(emscriptenCache)) {
      makeTreeWritable(emscriptenCache);
      rmSync(emscriptenCache, { recursive: true, force: true });
    }
    cpSync(packagedCache, emscriptenCache, { recursive: true, preserveTimestamps: true });
  }
  makeTreeWritable(emscriptenCache);
}

function findEmscriptenRoot() {
  const located = spawnSync('which', [emcc], { encoding: 'utf8' });
  if (located.status !== 0 || !located.stdout.trim()) {
    throw new Error(`Не найден компилятор Emscripten: ${emcc}`);
  }
  const wrapper = readFileSync(located.stdout.trim(), 'utf8');
  const match = wrapper.match(/exec\s+["']([^"']+\/share\/emscripten\/emcc)["']/);
  if (match) return path.dirname(match[1]);
  throw new Error('Не удалось найти каталог Emscripten для подготовки его кэша.');
}

function makeTreeWritable(root) {
  if (!existsSync(root)) return;
  const info = statSync(root);
  chmodSync(root, info.mode | 0o200 | (info.isDirectory() ? 0o700 : 0));
  if (!info.isDirectory()) return;
  for (const child of readdirSync(root)) {
    makeTreeWritable(path.join(root, child));
  }
}

function findNodeHeaders() {
  const candidates = [
    process.env.NODE_INCLUDE_DIR,
    path.resolve(path.dirname(nodeExecutable), '../include/node'),
    '/usr/include/node',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(path.join(candidate, 'node_api.h')));
  if (!found) {
    throw new Error('Не найдены заголовки Node-API; задайте NODE_INCLUDE_DIR для native addon.');
  }
  return found;
}

function readCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: 'inherit',
    env: { ...process.env, EM_CACHE: emscriptenCache },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Не удалось выполнить ${command}: ${result.error?.message ?? `код ${result.status}`}`);
  }
}
