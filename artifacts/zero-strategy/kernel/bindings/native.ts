import {
  KERNEL_ABI_VERSION,
  type KernelBufferType,
  type KernelMeasureOperation,
  type KernelMatrixOperation,
  type KernelMatrixFactorization,
  type KernelMatrixFactorizationResult,
  type KernelMatrixResult,
  type KernelMatrixScalar,
  type KernelPopulationMeasure,
  type KernelSetOperation,
  type NativeKernelBinding,
} from './contracts';

const MAX_KERNEL_BYTES = 256 * 1024 * 1024;

const BUFFER_CTORS = {
  u8: Uint8Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  i64: BigInt64Array,
  u64: BigUint64Array,
} as const;

/**
 * Принимает реализацию JSI или Node, не привязывая игровую логику
 * к платформе и способу загрузки двоичного модуля.
 */
export function createNativeKernel(binding: NativeKernelBinding) {
  assertVersion(binding.abiVersion());
  return {
    backend: 'native' as const,
    addI32(left: number, right: number): number {
      return binding.addI32(left, right);
    },
    queueAddI32(left: number, right: number): Promise<number> {
      return binding.queueAddI32(left, right);
    },
    sumI32(values: Int32Array): bigint {
      return binding.sumI32(values);
    },
    createBuffer(type: KernelBufferType, count: number): ArrayBufferView {
      validateCount(count);
      return binding.createBuffer(type, count);
    },
    setAlgebra(operation: KernelSetOperation, left: Uint32Array, right: Uint32Array): Uint32Array {
      return binding.setAlgebra(operation, left, right);
    },
    measureAlgebra(
      operation: KernelMeasureOperation,
      left: KernelPopulationMeasure,
      right: KernelPopulationMeasure,
    ): KernelPopulationMeasure {
      return binding.measureAlgebra(operation, left, right);
    },
    sumPopulationMeasure(input: KernelPopulationMeasure): KernelPopulationMeasure {
      return binding.sumPopulationMeasure(input);
    },
    matrixExecute(
      operation: KernelMatrixOperation,
      left: KernelMatrixScalar,
      leftRows: number,
      leftColumns: number,
      right: KernelMatrixScalar = left instanceof Float32Array
        ? new Float32Array()
        : new Float64Array(),
      rightRows = 0,
      rightColumns = 0,
    ): KernelMatrixResult {
      validateMatrix(left, leftRows, leftColumns);
      validateMatrix(right, rightRows, rightColumns);
      if (left.constructor !== right.constructor) {
        throw new TypeError('Типы матриц должны совпадать');
      }
      if (!binding.matrixExecute) {
        throw new Error('Нативная привязка не поддерживает матричные операции');
      }
      return binding.matrixExecute(
        operation, left, leftRows, leftColumns, right, rightRows, rightColumns,
      );
    },
    matrixFactorize(
      factorization: KernelMatrixFactorization,
      input: KernelMatrixScalar,
      rows: number,
      columns: number,
    ): KernelMatrixFactorizationResult {
      validateMatrix(input, rows, columns);
      if (!(input instanceof Float32Array || input instanceof Float64Array)) {
        throw new TypeError('Разложения Eigen принимают только float32 и float64');
      }
      if (!binding.matrixFactorize) {
        throw new Error('Нативная привязка не поддерживает разложения матриц');
      }
      return binding.matrixFactorize(factorization, input, rows, columns);
    },
    matrixBatchMatmul(
      left: KernelMatrixScalar,
      leftBatches: number,
      leftRows: number,
      leftColumns: number,
      right: KernelMatrixScalar,
      rightBatches: number,
      rightRows: number,
      rightColumns: number,
    ): KernelMatrixResult {
      validateBatch(left, leftBatches, leftRows, leftColumns);
      validateBatch(right, rightBatches, rightRows, rightColumns);
      if (left.constructor !== right.constructor) throw new TypeError('Типы матриц должны совпадать');
      if (!binding.matrixBatchMatmul) {
        throw new Error('Нативная привязка не поддерживает пакетное умножение');
      }
      return binding.matrixBatchMatmul(
        left, leftBatches, leftRows, leftColumns,
        right, rightBatches, rightRows, rightColumns,
      );
    },
    sparseMatvec(
      rows: number,
      columns: number,
      rowOffsets: Uint32Array,
      columnIndices: Uint32Array,
      values: KernelMatrixScalar,
      vector: KernelMatrixScalar,
    ): KernelMatrixScalar {
      validateCsr(rows, columns, rowOffsets, columnIndices, values);
      validateMatrix(vector, columns, 1);
      if (values.constructor !== vector.constructor) throw new TypeError('Типы CSR и вектора должны совпадать');
      if (!binding.sparseMatvec) throw new Error('Нативная привязка не поддерживает умножение CSR');
      return binding.sparseMatvec(rows, columns, rowOffsets, columnIndices, values, vector);
    },
    sparseMatmul(
      rows: number,
      columns: number,
      rowOffsets: Uint32Array,
      columnIndices: Uint32Array,
      values: KernelMatrixScalar,
      right: KernelMatrixScalar,
      rightColumns: number,
    ): KernelMatrixResult {
      validateCsr(rows, columns, rowOffsets, columnIndices, values);
      validateMatrix(right, columns, rightColumns);
      if (values.constructor !== right.constructor) throw new TypeError('Типы CSR и плотной матрицы должны совпадать');
      if (!binding.sparseMatmul) throw new Error('Нативная привязка не поддерживает умножение CSR');
      return binding.sparseMatmul(rows, columns, rowOffsets, columnIndices, values, right, rightColumns);
    },
  };
}

function assertVersion(version: number): void {
  if (version !== KERNEL_ABI_VERSION) {
    throw new Error(`Версия ABI ядра ${version} не поддерживается; требуется ${KERNEL_ABI_VERSION}`);
  }
}

function validateCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff_ffff) {
    throw new RangeError('Количество элементов должно быть целым числом uint32');
  }
}

function validateMatrix(values: KernelMatrixScalar, rows: number, columns: number): void {
  if (!(values instanceof Float32Array || values instanceof Float64Array) ||
      !Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) ||
      rows < 0 || columns < 0 || rows * columns !== values.length) {
    throw new TypeError('Форма матрицы не совпадает с типизированным массивом');
  }
  if (values.byteLength > MAX_KERNEL_BYTES) {
    throw new RangeError('Матрица превышает лимит памяти ядра');
  }
  for (const value of values) {
    if (!Number.isFinite(value)) throw new TypeError('Матрица содержит NaN или бесконечность');
  }
}

function validateBatch(values: KernelMatrixScalar, batches: number, rows: number, columns: number): void {
  if (!Number.isSafeInteger(batches) || batches <= 0 ||
      !Number.isSafeInteger(rows) || rows <= 0 ||
      !Number.isSafeInteger(columns) || columns <= 0 ||
      batches * rows * columns !== values.length) {
    throw new TypeError('Форма пакета матриц не совпадает с типизированным массивом');
  }
  validateMatrix(values, batches * rows, columns);
}

function validateCsr(
  rows: number,
  columns: number,
  rowOffsets: Uint32Array,
  columnIndices: Uint32Array,
  values: KernelMatrixScalar,
): void {
  if (!Number.isSafeInteger(rows) || rows <= 0 ||
      !Number.isSafeInteger(columns) || columns <= 0 ||
      !(rowOffsets instanceof Uint32Array) || !(columnIndices instanceof Uint32Array) ||
      rowOffsets.length !== rows + 1 || columnIndices.length !== values.length ||
      rowOffsets[0] !== 0 || rowOffsets[rows] !== values.length) {
    throw new TypeError('Неверная форма CSR-матрицы');
  }
  if (rowOffsets.byteLength + columnIndices.byteLength + values.byteLength > MAX_KERNEL_BYTES) {
    throw new RangeError('CSR превышает лимит памяти ядра');
  }
  for (let row = 0; row < rows; row += 1) {
    if (rowOffsets[row] > rowOffsets[row + 1] || rowOffsets[row + 1] > values.length) {
      throw new TypeError('Смещения CSR должны быть монотонными');
    }
    let previous = -1;
    for (let index = rowOffsets[row]; index < rowOffsets[row + 1]; index += 1) {
      if (columnIndices[index] >= columns || columnIndices[index] <= previous ||
          !Number.isFinite(values[index]) || values[index] === 0) {
        throw new TypeError('Неканоническая CSR-строка');
      }
      previous = columnIndices[index];
    }
  }
}

export { BUFFER_CTORS };
