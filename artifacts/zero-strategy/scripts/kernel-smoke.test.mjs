import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(appRoot, 'generated-artifacts', 'kernel');
execFileSync(path.join(generated, 'native', 'native-queue.test'));
execFileSync(path.join(generated, 'native', 'kernel-algebra.test'));
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
assert.deepEqual(
  [...wasm.setAlgebra('union', new Uint32Array([1, 3, 9]), new Uint32Array([2, 3, 8]))],
  [1, 2, 3, 8, 9],
);
assert.deepEqual(
  [...wasm.setAlgebra('complement', new Uint32Array([2, 8]), new Uint32Array([1, 2, 3, 8, 13]))],
  [1, 3, 13],
);
assert.throws(() => wasm.setAlgebra('difference', new Uint32Array([2, 1]), new Uint32Array([1])), /INVALID_ARGUMENT/);

const populationA = {
  keys: new Uint32Array([1, 0xffff_ffff, 4, 2, 1, 7, 4, 2, 1, 7, 4, 2]),
  mass: new Float64Array([0.125, 5.5, 1.75]),
};
const populationB = {
  keys: new Uint32Array([1, 0xffff_ffff, 4, 2, 1, 7, 4, 2, 2, 7, 4, 3]),
  mass: new Float64Array([0.5, 0.25, 3.25]),
};
const populationUnion = wasm.measureAlgebra('union', populationA, populationB);
assert.deepEqual([...populationUnion.keys], [
  1, 7, 4, 2, 1, 0xffff_ffff, 4, 2, 2, 7, 4, 3,
]);
assert.deepEqual([...populationUnion.mass], [7.25, 0.5, 3.25],
  'объединение меры не должно складывать массу автоматически');
const populationIntersection = wasm.measureAlgebra('intersection', populationA, populationB);
assert.deepEqual([...populationIntersection.mass], [0.25, 0.125]);
const populationDifference = wasm.measureAlgebra('difference', populationA, populationB);
assert.deepEqual([...populationDifference.mass], [7]);
const populationSymmetricDifference = wasm.measureAlgebra('symmetricDifference', populationA, populationB);
assert.deepEqual([...populationSymmetricDifference.mass], [7, 0.375, 3.25]);
const populationComplement = wasm.measureAlgebra('complement', populationA, populationB);
assert.deepEqual([...populationComplement.mass], [0.375, 3.25]);
const populationSum = wasm.sumPopulationMeasure({
  keys: new Uint32Array([
    2, 7, 4, 2, 1, 7, 4, 2, 2, 7, 4, 2, 1, 0xffff_ffff, 4, 2,
  ]),
  mass: new Float64Array([0.2, 0.3, 0.5, 0.1]),
});
assert.deepEqual([...populationSum.keys], [1, 7, 4, 2, 1, 0xffff_ffff, 4, 2, 2, 7, 4, 2]);
assert.deepEqual([...populationSum.mass], [0.3, 0.1, 0.7]);
assert.throws(() => wasm.measureAlgebra('union', { keys: new Uint32Array(3), mass: new Float64Array(1) }, populationB), /четыре ключа/);
assert.throws(() => wasm.sumPopulationMeasure({
  keys: new Uint32Array([1, 2, 3, 4]), mass: new Float64Array([-0.5]),
}), /INVALID_ARGUMENT/);
assert.equal(wasm.sumPopulationMeasure({
  keys: new Uint32Array([1, 2, 3, 4, 1, 2, 3, 4]),
  mass: new Float64Array([1e200, 1e200]),
}).mass[0], 2e200);
const setSize = 40_000;
const leftSet = new Uint32Array(setSize);
const rightSet = new Uint32Array(setSize);
for (let index = 0; index < setSize; index += 1) {
  leftSet[index] = index * 2;
  rightSet[index] = index * 2 + 1;
}
const algebraStartedAt = performance.now();
const largeUnion = wasm.setAlgebra('union', leftSet, rightSet);
const algebraCallMs = performance.now() - algebraStartedAt;
assert.equal(largeUnion.length, setSize * 2);

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
assert.deepEqual(
  [...native.setAlgebra('symmetricDifference', new Uint32Array([1, 2, 5]), new Uint32Array([2, 3, 5]))],
  [1, 3],
);
assert.deepEqual(
  [...native.measureAlgebra('union', populationA, populationB).mass],
  [...populationUnion.mass],
);
assert.deepEqual(
  [...native.sumPopulationMeasure({
    keys: new Uint32Array([1, 7, 4, 2, 1, 7, 4, 2]),
    mass: new Float64Array([0.25, 0.5]),
  }).mass],
  [0.75],
);
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

console.log(`Ядро прошло проверки через WASM и Node native addon. Полный WASM-вызов объединения для 80 000 элементов: ${algebraCallMs.toFixed(2)} мс.`);
