import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(appRoot, 'generated-artifacts', 'kernel');
execFileSync(path.join(generated, 'native', 'native-queue.test'));
const { createWasmKernel } = await import(pathToFileURL(
  path.join(generated, 'wasm', 'wasm-binding.mjs'),
));
const { createNativeKernel } = await import(pathToFileURL(
  path.join(generated, 'node', 'native-binding.mjs'),
));
const wasmFactory = (await import(pathToFileURL(path.join(generated, 'wasm', 'zero_kernel.mjs')))).default;
const wasmModule = await wasmFactory();
const wasm = createWasmKernel(wasmModule);

assert.equal(wasm.backend, 'wasm');
assert.equal(wasmModule._zk_execution_mode(), 1);
assert.equal(wasm.addI32(19, 23), 42);
assert.equal(wasm.sumI32(new Int32Array([8, -3, 37])), 42n);
assert.throws(() => wasm.addI32(2_147_483_647, 1), /OVERFLOW/);

const memory = wasm.createBuffer('i32', 3);
memory.view.set([1, 2, 3]);
assert.equal(wasm.sumI32(memory.view), 6n);
const releasedHandle = memory.handle;
memory.release();
memory.release();
const staleErrorPointer = wasmModule._malloc(4);
assert.equal(wasmModule._zk_buffer_size(releasedHandle, staleErrorPointer), 4);
wasmModule._free(staleErrorPointer);
assert.equal(wasm.threaded, false);

const empty = wasm.createBuffer('u8', 0);
assert.equal(empty.view.byteLength, 0);
empty.release();

const persistent = wasm.createBuffer('i32', 1);
persistent.view[0] = 1234;
const oldMemoryView = persistent.view;
const growthBuffer = wasm.createBuffer('u8', 24 * 1024 * 1024);
assert.notEqual(persistent.view.buffer, oldMemoryView.buffer);
assert.equal(persistent.view[0], 1234);
growthBuffer.release();
persistent.release();

const require = createRequire(import.meta.url);
const addon = require(path.join(generated, 'node', 'zero_kernel_native.node'));
const native = createNativeKernel(addon);
assert.equal(native.backend, 'native');
assert.equal(native.addI32(10, 32), 42);
assert.equal(native.sumI32(new Int32Array([5, -2, 39])), 42n);
assert.equal(await native.queueAddI32(20, 22), 42);
assert.throws(() => native.addI32(2_147_483_647, 1), /Переполнение/);
assert.throws(
  () => native.addI32(2_147_483_647, 1),
  (error) => error.code === 'OVERFLOW',
);

const nativeBuffer = native.createBuffer('i32', 3);
assert.ok(nativeBuffer instanceof Int32Array);
nativeBuffer.set([9, 10, 23]);
assert.deepEqual([...nativeBuffer], [9, 10, 23]);
assert.equal(native.createBuffer('u8', 0).byteLength, 0);
assert.equal(addon.abiVersion(), 1);

console.log('Ядро прошло минимальные проверки через WASM и Node native addon.');
