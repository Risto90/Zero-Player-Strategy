import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = '/tmp/zero-strategy-matrix-api.mjs';
execFileSync(path.join(appRoot, '../api-server/node_modules/.bin/esbuild'), [
  path.join(appRoot, 'kernel/matrix.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  `--outfile=${output}`,
]);
const matrix = await import(pathToFileURL(output));
const { DenseMatrix, CsrMatrix, DenseVector, MatrixBatch } = matrix;

const source = DenseMatrix.fromRows([[1, 2, 3], [4, 5, 6]]);
const transpose = source.transpose();
assert.deepEqual(transpose.toRows(), [[1, 4], [2, 5], [3, 6]]);
transpose.set(1, 0, 20);
assert.equal(source.get(0, 1), 20, 'представление transpose должно совместно использовать буфер');
assert.deepEqual(source.slice(0, 2, 1, 3).toRows(), [[20, 3], [5, 6]]);
assert.deepEqual(source.reshape(3, 2).toRows(), [[1, 20], [3, 4], [5, 6]]);

const broadcast = matrix.elementwise(
  DenseMatrix.fromRows([[1, 2, 3], [4, 5, 6]]),
  DenseMatrix.fromRows([[10, 20, 30]]),
  'add',
);
assert.deepEqual(broadcast.toRows(), [[11, 22, 33], [14, 25, 36]]);
assert.deepEqual(
  matrix.elementwise(
    DenseMatrix.fromRows([[1, 2], [3, 4]]),
    DenseMatrix.fromRows([[2, 1]]),
    'lessThan',
  ).toRows(),
  [[1, 0], [0, 0]],
);
assert.deepEqual(
  matrix.concatenate([
    DenseMatrix.fromRows([[1, 2]]),
    DenseMatrix.fromRows([[3, 4]]),
  ], 0).toRows(),
  [[1, 2], [3, 4]],
);
assert.deepEqual(
  matrix.mask(DenseMatrix.fromRows([[3, 4], [5, 6]]), new Uint8Array([1, 0, 0, 1])).toRows(),
  [[3, 0], [0, 6]],
);
assert.equal(matrix.reduce(DenseMatrix.fromRows([[1e12, 1, -1e12]]), 'sum'), 1);
assert.equal(matrix.reduce(DenseMatrix.fromRows([[3, 4]]), 'normFrobenius'), 5);
assert.throws(() => matrix.elementwise(source, 0, 'divide'), /ноль/);
assert.throws(() => DenseMatrix.fromRows([[1], [2, 3]]), /одинаковую длину/);
assert.throws(() => new DenseMatrix(new Float64Array([NaN]), 1, 1), /NaN/);
assert.throws(() => DenseMatrix.fromRows([[256]], new Uint8Array()), /диапазон/);
assert.throws(
  () => matrix.elementwise(new DenseMatrix(new Uint8Array([255]), 1, 1), 1, 'add'),
  /диапазон/,
);
assert.throws(() => DenseMatrix.zeros(100_000_000, 100_000_000), /лимит памяти/);

const vector = new DenseVector(new Float64Array([2, 4, 6, 8]), 2, 0, 2);
assert.deepEqual([...vector.toContiguous()], [2, 6]);
vector.slice(1).set(0, 7);
assert.equal(vector.get(1), 7);

const dense = DenseMatrix.fromRows([[0, 2, 0], [3, 0, 4]], new Float32Array());
const sparse = CsrMatrix.fromDense(dense);
assert.deepEqual(sparse.toDense().toRows(), dense.toRows());
assert.deepEqual(sparse.transpose().toDense().toRows(), [[0, 3], [2, 0], [0, 4]]);
assert.deepEqual(sparse.slice(1, 2, 1, 3).toDense().toRows(), [[0, 4]]);
assert.deepEqual([...sparse.multiplyVector(new Float32Array([1, 2, 3]))], [4, 15]);
assert.deepEqual(sparse.reshape(3, 2).toDense().toRows(), [[0, 2], [0, 3], [0, 4]]);
assert.equal(sparse.sum(), 9);
assert.equal(sparse.normL1(), 9);
assert.equal(sparse.mean(), 1.5);
assert.equal(sparse.min(), 0);
assert.equal(sparse.max(), 4);
assert.ok(Math.abs(sparse.normFrobenius() - Math.sqrt(29)) < 1e-12);
assert.deepEqual(
  matrix.maskSparse(sparse, new Uint8Array([0, 1, 1, 0, 1, 1])).toDense().toRows(),
  [[0, 2, 0], [0, 0, 4]],
);
assert.deepEqual(
  matrix.concatenateSparse([sparse, sparse], 0).toDense().toRows(),
  [[0, 2, 0], [3, 0, 4], [0, 2, 0], [3, 0, 4]],
);
assert.deepEqual(
  matrix.concatenateSparse([sparse, sparse], 1).toDense().toRows(),
  [[0, 2, 0, 0, 2, 0], [3, 0, 4, 3, 0, 4]],
);
assert.deepEqual(
  matrix.elementwiseSparse(sparse, sparse, 'add').toDense().toRows(),
  [[0, 4, 0], [6, 0, 8]],
);
assert.deepEqual(
  matrix.elementwiseSparse(sparse, sparse, 'and').toDense().toRows(),
  [[0, 1, 0], [1, 0, 1]],
);
assert.equal(matrix.elementwiseSparse(sparse, sparse, 'xor').values.length, 0);
assert.deepEqual(
  matrix.elementwiseSparse(sparse, 2, 'multiply').toDense().toRows(),
  [[0, 4, 0], [6, 0, 8]],
);
assert.throws(() => matrix.elementwiseSparse(sparse, sparse, 'divide'), /ненулевой плотной/);
const sparseRow = CsrMatrix.fromDense(
  DenseMatrix.fromRows([[1, 0, 2]], new Float32Array()),
);
assert.deepEqual(
  matrix.elementwiseSparseBroadcast(sparse, sparseRow, 'add').toRows(),
  [[1, 2, 2], [4, 0, 6]],
);
assert.throws(
  () => new CsrMatrix(1, 2, new Uint32Array([0, 2]), new Uint32Array([1, 0]), new Float64Array([1, 2])),
  /отсортированные столбцы/,
);

const batches = new MatrixBatch([
  DenseMatrix.fromRows([[1, 2], [3, 4]], new Float32Array()),
  DenseMatrix.fromRows([[5, 6], [7, 8]], new Float32Array()),
]);
const mockBackend = {
  matrixBatchMatmul(left, leftBatches, leftRows, leftColumns, right, rightBatches, rightRows, rightColumns) {
    assert.equal(leftBatches, 2);
    assert.equal(rightBatches, 1);
    assert.equal(leftColumns, rightRows);
    return {
      values: new Float32Array([2, 4, 6, 8, 10, 12, 14, 16]),
      rows: 4,
      columns: 2,
    };
  },
  sparseMatvec(rows, columns, rowOffsets, columnIndices, values, vector) {
    assert.deepEqual([rows, columns], [2, 3]);
    assert.deepEqual([...rowOffsets], [0, 1, 3]);
    assert.deepEqual([...columnIndices], [1, 0, 2]);
    assert.deepEqual([...values], [2, 3, 4]);
    assert.deepEqual([...vector], [1, 2, 3]);
    return new Float32Array([4, 15]);
  },
  sparseMatmul(rows, columns, rowOffsets, columnIndices, values, right, rightColumns) {
    assert.deepEqual([rows, columns, rightColumns], [2, 3, 2]);
    assert.equal(right.length, 6);
    return { values: new Float32Array([4, 8, 15, 30]), rows: 2, columns: 2 };
  },
};
assert.deepEqual(
  [...sparse.multiplyVector(new Float32Array([1, 2, 3]), mockBackend)],
  [4, 15],
);
assert.deepEqual(
  sparse.multiplyDense(DenseMatrix.fromRows([[1, 2], [3, 4], [5, 6]], new Float32Array()), mockBackend).toRows(),
  [[4, 8], [15, 30]],
);
const batchResult = matrix.batchMatmul(
  mockBackend,
  batches,
  new MatrixBatch([DenseMatrix.fromRows([[2, 0], [0, 2]], new Float32Array())]),
);
assert.deepEqual(batchResult.matrices.map((item) => item.toRows()), [
  [[2, 4], [6, 8]],
  [[10, 12], [14, 16]],
]);

const kernel = DenseMatrix.fromRows([[0, 1, 0], [1, -4, 1], [0, 1, 0]]);
assert.deepEqual(
  matrix.convolve2D(DenseMatrix.fromRows([[1, 1, 1], [1, 1, 1], [1, 1, 1]]), kernel).toRows(),
  [[-2, -1, -2], [-1, 0, -1], [-2, -1, -2]],
);
assert.equal(matrix.interpolateBilinear(DenseMatrix.fromRows([[0, 10], [20, 30]]), 0.5, 0.5), 15);
assert.deepEqual(matrix.normalizeMinMax(DenseMatrix.fromRows([[4, 6], [8, 10]])).toRows(), [
  [0, 1 / 3],
  [2 / 3, 1],
]);
assert.deepEqual(
  [...matrix.seededMatrix(1, 4, 1234).values],
  [...matrix.seededMatrix(1, 4, 1234).values],
);
assert.notDeepEqual(
  [...matrix.seededMatrix(1, 4, 1234).values],
  [...matrix.seededMatrix(1, 4, 1235).values],
);
assert.equal(matrix.sampleWithSeed(new Float64Array([10, 20, 30]), 20, 23).length, 20);

console.log('Плотные, разреженные и пакетные представления матриц прошли независимые проверки.');
