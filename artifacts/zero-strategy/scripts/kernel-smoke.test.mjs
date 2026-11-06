import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(appRoot, 'generated-artifacts', 'kernel');
execFileSync(path.join(generated, 'native', 'native-queue.test'));
execFileSync(path.join(generated, 'native', 'kernel-algebra.test'));
execFileSync(path.join(generated, 'native', 'kernel-linear-algebra.test'));
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
const sampledCircle = wasm.geometryPrimitiveExecute(
  'circlePoints',
  new Float64Array([0, 0, 2, 4, 0]),
);
assert.ok(
  [...sampledCircle].every((value, index) =>
    Math.abs(value - [2, 0, 0, 2, -2, 0, 0, -2][index]) < 1e-12),
  'точки окружности вычисляются в бинарной геометрии с допустимой погрешностью float',
);
assert.deepEqual(
  [...wasm.geometryPrimitiveExecute(
    'clipPolygonRect',
    new Float64Array([0, 0, 1, 1, 4, -2, 0, 2, 0, 2, 2, -2, 2]),
  )],
  [0, 1, 0, 0, 1, 0, 1, 1],
  'бинарная обрезка сохраняет порядок вершин и геометрию исходного контура',
);
const matrixProduct = wasm.matrixExecute(
  'matmul',
  new Float64Array([4, 1, 2, 3]),
  2,
  2,
  new Float64Array([1, 2, 3, 4]),
  2,
  2,
);
assert.deepEqual([...matrixProduct.values], [7, 12, 11, 16]);
assert.deepEqual([matrixProduct.rows, matrixProduct.columns], [2, 2]);
assert.deepEqual(
  [...wasm.matrixExecute('transpose', new Float32Array([1, 2, 3, 4]), 2, 2).values],
  [1, 3, 2, 4],
);
assert.deepEqual(
  [...wasm.matrixExecute(
    'add', new Float64Array([1, 2, 3, 4]), 2, 2,
    new Float64Array([10, 20]), 1, 2,
  ).values],
  [11, 22, 13, 24],
);
assert.deepEqual(
  [...wasm.matrixExecute(
    'subtract', new Float64Array([5, 7]), 1, 2,
    new Float64Array([2, 3]), 1, 2,
  ).values],
  [3, 4],
);
assert.deepEqual(
  [...wasm.matrixExecute(
    'hadamard', new Float64Array([2, 3]), 1, 2,
    new Float64Array([4, 5]), 1, 2,
  ).values],
  [8, 15],
);
assert.deepEqual(
  [...wasm.matrixExecute(
    'divide', new Float64Array([8, 15]), 1, 2,
    new Float64Array([2, 3]), 1, 2,
  ).values],
  [4, 5],
);
assert.deepEqual(
  [...wasm.matrixExecute(
    'matvec', new Float64Array([1, 2, 3, 4, 5, 6]), 2, 3,
    new Float64Array([1, 2, 3]), 3, 1,
  ).values],
  [14, 32],
);
assert.equal(
  wasm.matrixExecute(
    'dot', new Float64Array([1, 2, 3]), 1, 3,
    new Float64Array([4, 5, 6]), 3, 1,
  ).values[0],
  32,
);
const outer = wasm.matrixExecute(
  'outer', new Float64Array([1, 2]), 1, 2,
  new Float64Array([3, 4, 5]), 1, 3,
);
assert.deepEqual([...outer.values], [3, 4, 5, 6, 8, 10]);
assert.deepEqual([outer.rows, outer.columns], [2, 3]);
assert.equal(wasm.matrixExecute('sum', new Float64Array([1, 2, 3, 4]), 2, 2).values[0], 10);
assert.equal(wasm.matrixExecute('mean', new Float64Array([1, 2, 3, 4]), 2, 2).values[0], 2.5);
assert.equal(wasm.matrixExecute('normL1', new Float64Array([-1, 2, -3]), 1, 3).values[0], 6);
assert.equal(wasm.matrixExecute('normFrobenius', new Float64Array([3, 4]), 1, 2).values[0], 5);
assert.equal(wasm.matrixExecute('trace', new Float64Array([4, 1, 2, 3]), 2, 2).values[0], 7);
assert.equal(wasm.matrixExecute('rank', new Float64Array([1, 2, 2, 4]), 2, 2).values[0], 1);
const determinant = wasm.matrixExecute('determinant', new Float64Array([4, 1, 2, 3]), 2, 2);
assert.equal(determinant.values[0], 10);
const inverse = wasm.matrixExecute('inverse', new Float64Array([4, 1, 2, 3]), 2, 2);
assert.ok(Math.abs(inverse.values[0] - 0.3) < 1e-12);
const pseudoInverse = wasm.matrixExecute(
  'pseudoinverse', new Float64Array([1, 0, 0, 1, 1, 1]), 3, 2,
);
assert.deepEqual([pseudoInverse.rows, pseudoInverse.columns], [2, 3]);
const pseudoRoundTrip = wasm.matrixExecute(
  'matmul',
  new Float64Array([1, 0, 0, 1, 1, 1]), 3, 2,
  wasm.matrixExecute('matmul', pseudoInverse.values, 2, 3,
    new Float64Array([1, 0, 0, 1, 1, 1]), 3, 2).values,
  2, 2,
);
assert.ok([...pseudoRoundTrip.values].every((value, index) =>
  Math.abs(value - [1, 0, 0, 1, 1, 1][index]) < 1e-8));
assert.throws(
  () => wasm.matrixExecute('inverse', new Float64Array([1, 2, 2, 4]), 2, 2),
  /CONFLICT/,
);
assert.throws(
  () => wasm.matrixExecute('divide', new Float64Array([1]), 1, 1, new Float64Array([0]), 1, 1),
  /INVALID_ARGUMENT/,
);
assert.throws(
  () => wasm.matrixExecute(
    'matmul', new Float64Array([1, 2, 3, 4]), 2, 2,
    new Float64Array([1, 2, 3]), 3, 1,
  ),
  /INVALID_ARGUMENT/,
);
assert.throws(
  () => wasm.matrixExecute('hadamard', new Float32Array([3.4e38]), 1, 1, new Float32Array([2]), 1, 1),
  /OVERFLOW/,
);
assert.throws(
  () => wasm.matrixExecute('determinant', new Float64Array([1e-300, 0, 0, 1e-300]), 2, 2),
  /OVERFLOW/,
);
assert.throws(
  () => wasm.matrixFactorize('cholesky', new Float64Array([1, 2, 2, 1]), 2, 2),
  /CONFLICT/,
);
assert.throws(
  () => wasm.matrixFactorize('symmetricEigen', new Float64Array([1, 2, 0, 1]), 2, 2),
  /INVALID_ARGUMENT/,
);
const wasmSvd = wasm.matrixFactorize(
  'svd',
  new Float64Array([1, 0, 0, 1, 1, 1]),
  3,
  2,
);
assert.deepEqual(
  [wasmSvd.a.rows, wasmSvd.a.columns, wasmSvd.b.rows, wasmSvd.b.columns,
    wasmSvd.c.rows, wasmSvd.c.columns],
  [3, 3, 2, 2, 2, 2],
);
for (let row = 0; row < 3; row += 1) {
  for (let column = 0; column < 2; column += 1) {
    let reconstructed = 0;
    for (let index = 0; index < 2; index += 1) {
      reconstructed += wasmSvd.a.values[row * 3 + index] *
        wasmSvd.b.values[index * 2 + index] *
        wasmSvd.c.values[column * 2 + index];
    }
    assert.ok(Math.abs(reconstructed - [1, 0, 0, 1, 1, 1][row * 2 + column]) < 1e-8);
  }
}
const pivoted = wasm.matrixFactorize(
  'lu', new Float64Array([0, 2, 1, 3]), 2, 2,
);
for (let row = 0; row < 2; row += 1) {
  for (let column = 0; column < 2; column += 1) {
    const pa = pivoted.a.values[row * 2] * [0, 2, 1, 3][column] +
      pivoted.a.values[row * 2 + 1] * [0, 2, 1, 3][2 + column];
    const lu = pivoted.b.values[row * 2] * pivoted.c.values[column] +
      pivoted.b.values[row * 2 + 1] * pivoted.c.values[2 + column];
    assert.ok(Math.abs(pa - lu) < 1e-10);
  }
}
const qr = wasm.matrixFactorize('qr', new Float64Array([1, 2, 3, 4, 5, 6]), 3, 2);
for (let row = 0; row < 3; row += 1) {
  for (let column = 0; column < 2; column += 1) {
    const reconstructed = qr.a.values[row * 2] * qr.b.values[column] +
      qr.a.values[row * 2 + 1] * qr.b.values[2 + column];
    assert.ok(Math.abs(reconstructed - [1, 2, 3, 4, 5, 6][row * 2 + column]) < 1e-10);
  }
}
const batchProduct = wasm.matrixBatchMatmul(
  new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
  2,
  2,
  2,
  new Float32Array([2, 0, 0, 2]),
  1,
  2,
  2,
);
assert.deepEqual([...batchProduct.values], [2, 4, 6, 8, 10, 12, 14, 16]);
const csrRows = new Uint32Array([0, 2, 3]);
const csrColumns = new Uint32Array([0, 2, 1]);
const csrValues = new Float64Array([2, 1, 3]);
assert.deepEqual(
  [...wasm.sparseMatvec(2, 3, csrRows, csrColumns, csrValues, new Float64Array([4, 5, 6]))],
  [14, 15],
);
assert.deepEqual(
  [...wasm.sparseMatmul(
    2, 3, csrRows, csrColumns, csrValues,
    new Float64Array([1, 2, 3, 4, 5, 6]), 2,
  ).values],
  [7, 10, 9, 12],
);
const sparseSide = 20_000;
const sparseRowOffsets = new Uint32Array(sparseSide + 1);
const sparseColumnIndices = new Uint32Array(sparseSide * 2);
const sparseValues = new Float32Array(sparseSide * 2);
for (let row = 0; row < sparseSide; row += 1) {
  sparseRowOffsets[row] = row * 2;
  const firstColumn = row;
  const secondColumn = (row + 1) % sparseSide;
  sparseColumnIndices[row * 2] = Math.min(firstColumn, secondColumn);
  sparseColumnIndices[row * 2 + 1] = Math.max(firstColumn, secondColumn);
  sparseValues[row * 2] = 1;
  sparseValues[row * 2 + 1] = 2;
}
sparseRowOffsets[sparseSide] = sparseSide * 2;
const sparseStartedAt = performance.now();
const sparseResult = wasm.sparseMatvec(
  sparseSide, sparseSide, sparseRowOffsets, sparseColumnIndices,
  sparseValues, new Float32Array(sparseSide).fill(1),
);
const sparseBoundaryMs = performance.now() - sparseStartedAt;
assert.equal(sparseResult.length, sparseSide);
assert.ok([...sparseResult].every((value) => value === 3));
const largeSide = 160;
const largeLeft = new Float32Array(largeSide * largeSide);
const largeIdentity = new Float32Array(largeSide * largeSide);
for (let row = 0; row < largeSide; row += 1) {
  for (let column = 0; column < largeSide; column += 1) {
    largeLeft[row * largeSide + column] = ((row * 17 + column * 13) % 101) / 101;
    if (row === column) largeIdentity[row * largeSide + column] = 1;
  }
}
const denseStartedAt = performance.now();
const largeProduct = wasm.matrixExecute(
  'matmul', largeLeft, largeSide, largeSide,
  largeIdentity, largeSide, largeSide,
);
const denseBoundaryMs = performance.now() - denseStartedAt;
assert.equal(largeProduct.values.length, largeLeft.length);
assert.deepEqual([...largeProduct.values], [...largeLeft]);
assert.ok(denseBoundaryMs < 5000, `Большое пакетное умножение заняло ${denseBoundaryMs.toFixed(1)} мс`);
assert.deepEqual(
  [...wasm.setAlgebra('union', new Uint32Array([1, 3, 9]), new Uint32Array([2, 3, 8]))],
  [1, 2, 3, 8, 9],
);
assert.deepEqual(
  [...wasm.setAlgebra('complement', new Uint32Array([2, 8]), new Uint32Array([1, 2, 3, 8, 13]))],
  [1, 3, 13],
);
assert.throws(() => wasm.setAlgebra('difference', new Uint32Array([2, 1]), new Uint32Array([1])), /INVALID_ARGUMENT/);
assert.deepEqual(
  [...wasm.vectorExecute('add', new Float64Array([2, -3, 4, 7]))],
  [6, 4],
);
assert.deepEqual(
  [...wasm.affineExecute('apply', new Float64Array([1, 0, 0, 1, 9, -4, 2, 0]))],
  [11, -4],
);
assert.deepEqual(
  wasm.contourSpansExecute(
    'offset',
    [{ y: 2, start: 2, end: 3 }],
    [],
    8,
    8,
    1,
  ),
  [
    { y: 1, start: 2, end: 3 },
    { y: 2, start: 1, end: 4 },
    { y: 3, start: 2, end: 3 },
  ],
);
const rectanglePath = wasm.pathParse('M0 0 L10 0 L10 10 L0 10 Z');
const normalizedRectangle = wasm.pathSerialize(rectanglePath);
assert.deepEqual(
  [...wasm.pathMeasure('length', wasm.pathParse(normalizedRectangle), 0.01)],
  [40],
);
assert.deepEqual(
  [...wasm.pathMeasure('bounds', rectanglePath, 0.01)],
  [0, 0, 10, 10],
);
const rectanglePolygons = wasm.pathToPolygons(rectanglePath, 0.01, 'nonzero');
assert.deepEqual([...rectanglePolygons.ringOffsets], [0, 4]);
assert.deepEqual([...rectanglePolygons.polygonOffsets], [0, 1]);
const overlappingRectangle = wasm.pathToPolygons(
  wasm.pathParse('M5 5 L15 5 L15 15 L5 15 Z'),
  0.01,
  'nonzero',
);
const polygonIntersection = wasm.polygonBoolean(
  'intersection',
  [rectanglePolygons, overlappingRectangle],
);
assert.deepEqual([...polygonIntersection.ringOffsets], [0, 4]);
const overlapCoordinates = polygonIntersection.coordinates;
const overlapArea = Math.abs(
  overlapCoordinates[0] * overlapCoordinates[3] -
  overlapCoordinates[2] * overlapCoordinates[1] +
  overlapCoordinates[2] * overlapCoordinates[5] -
  overlapCoordinates[4] * overlapCoordinates[3] +
  overlapCoordinates[4] * overlapCoordinates[7] -
  overlapCoordinates[6] * overlapCoordinates[5] +
  overlapCoordinates[6] * overlapCoordinates[1] -
  overlapCoordinates[0] * overlapCoordinates[7],
) / 2;
assert.equal(overlapArea, 25);

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
const nativeAlgebra = JSON.parse(native.algebraQuery(JSON.stringify({
  inputs: {
    left: { columns: ['id'], rows: [[1], [2]] },
    right: { columns: ['id'], rows: [[2], [3]] },
  },
  operations: [{
    op: 'set', id: 'combined', mode: 'set', kind: 'union',
    left: 'left', right: 'right',
  }],
})));
assert.equal(nativeAlgebra.ok, true);
assert.deepEqual(nativeAlgebra.result.tables.combined.rows, [[1], [2], [3]]);
assert.deepEqual(
  [...native.matrixExecute(
    'matmul',
    new Float64Array([4, 1, 2, 3]),
    2,
    2,
    new Float64Array([1, 2, 3, 4]),
    2,
    2,
  ).values],
  [7, 12, 11, 16],
);
const elementwiseLeft = new Float64Array([1, 0, 3, 4]);
const elementwiseRight = new Float64Array([2, 5, 3, -1]);
assert.deepEqual(
  [...native.matrixExecute('minimum', elementwiseLeft, 2, 2, elementwiseRight, 2, 2).values],
  [1, 0, 3, -1],
);
assert.deepEqual(
  [...native.matrixExecute('logicalAnd', elementwiseLeft, 2, 2, elementwiseRight, 2, 2).values],
  [1, 0, 1, 1],
);
assert.deepEqual(
  [...native.matrixExecute('reduceMin', elementwiseLeft, 2, 2).values],
  [0],
);
assert.deepEqual(
  [...native.matrixExecute('reduceMax', elementwiseLeft, 2, 2).values],
  [4],
);
const seededInput = new Float64Array(4);
const seedInput = new Float64Array([1234]);
assert.deepEqual(
  [...native.matrixExecute('seededRandom', seededInput, 1, 4, seedInput, 1, 1).values],
  [...wasm.matrixExecute('seededRandom', seededInput, 1, 4, seedInput, 1, 1).values],
);
const sampleInput = new Float64Array([3, 23]);
const sampleShape = new Float64Array(20);
assert.deepEqual(
  [...native.matrixExecute('sampleIndices', sampleInput, 1, 2, sampleShape, 1, 20).values],
  [...wasm.matrixExecute('sampleIndices', sampleInput, 1, 2, sampleShape, 1, 20).values],
);
const stencilInput = new Float64Array([1, 2, 3, 4]);
const northStencilInput = new Float64Array([-1, 0, 1]);
assert.deepEqual(
  [...native.matrixExecute('stencilZero', stencilInput, 2, 2, northStencilInput, 1, 3).values],
  [0, 0, 1, 2],
);
assert.deepEqual(
  [...native.matrixExecute('stencilClamp', stencilInput, 2, 2, northStencilInput, 1, 3).values],
  [1, 2, 1, 2],
);
const bilinearInput = new Float64Array([0, 10, 20, 30]);
const bilinearCoordinates = new Float64Array([0.5, 0.5]);
const nativeBilinear = native.matrixExecute(
  'bilinearInterpolate', bilinearInput, 2, 2, bilinearCoordinates, 1, 2,
);
const wasmBilinear = wasm.matrixExecute(
  'bilinearInterpolate', bilinearInput, 2, 2, bilinearCoordinates, 1, 2,
);
assert.deepEqual([...nativeBilinear.values], [15]);
assert.deepEqual([...nativeBilinear.values], [...wasmBilinear.values]);
assert.deepEqual(
  [native.matrixFactorize('cholesky', new Float64Array([4, 2, 2, 3]), 2, 2).a.rows,
    native.matrixFactorize('symmetricEigen', new Float64Array([2, 1, 1, 2]), 2, 2).a.rows],
  [2, 2],
);
assert.deepEqual(
  [...native.matrixBatchMatmul(
    new Float64Array([1, 2, 3, 4]),
    1,
    2,
    2,
    new Float64Array([2, 0, 0, 2, 3, 0, 0, 3]),
    2,
    2,
    2,
  ).values],
  [2, 4, 6, 8, 3, 6, 9, 12],
);
assert.deepEqual(
  [...native.sparseMatvec(
    2, 3,
    new Uint32Array([0, 2, 3]),
    new Uint32Array([0, 2, 1]),
    new Float64Array([2, 1, 3]),
    new Float64Array([4, 5, 6]),
  )],
  [14, 15],
);
assert.deepEqual(
  [...native.sparseMatmul(
    2, 3,
    new Uint32Array([0, 2, 3]),
    new Uint32Array([0, 2, 1]),
    new Float64Array([2, 1, 3]),
    new Float64Array([1, 2, 3, 4, 5, 6]), 2,
  ).values],
  [7, 10, 9, 12],
);
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

console.log(`Ядро прошло проверки через WASM и Node native addon. Объединение 80 000 элементов: ${algebraCallMs.toFixed(2)} мс; умножение 160×160: ${denseBoundaryMs.toFixed(2)} мс; CSR 20 000×20 000 с 40 000 ненулями: ${sparseBoundaryMs.toFixed(2)} мс.`);
