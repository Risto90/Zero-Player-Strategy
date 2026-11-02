import {
  KERNEL_ABI_VERSION,
  type KernelBuffer,
  type KernelBufferType,
  type KernelMeasureOperation,
  type KernelMatrixOperation,
  type KernelMatrixFactorization,
  type KernelMatrixFactorizationResult,
  type KernelMatrixResult,
  type KernelMatrixScalar,
  type KernelPopulationMeasure,
  type KernelSetOperation,
} from './contracts';

export interface EmscriptenKernelModule {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _zk_abi_version(): number;
  _zk_execution_mode(): number;
  _zk_i32_add(left: number, right: number, resultPointer: number): number;
  _zk_set_binary(operation: number, left: number, leftCount: number, right: number, rightCount: number,
    output: number, outputCapacity: number, resultCount: number): number;
  _zk_measure_binary(operation: number, leftKeys: number, leftMass: number, leftCount: number,
    rightKeys: number, rightMass: number, rightCount: number, outputKeys: number, outputMass: number,
    outputCapacity: number, resultCount: number): number;
  _zk_measure_sum(keys: number, mass: number, count: number, outputKeys: number, outputMass: number,
    outputCapacity: number, resultCount: number): number;
  _zk_matrix_execute(operation: number, type: number, left: number, leftRows: number,
    leftColumns: number, right: number, rightRows: number, rightColumns: number,
    output: number, outputCapacity: number, outputRows: number, outputColumns: number): number;
  _zk_matrix_factorize(factorization: number, type: number, input: number,
    rows: number, columns: number, outputA: number, capacityA: number,
    rowsA: number, columnsA: number, outputB: number, capacityB: number,
    rowsB: number, columnsB: number, outputC: number, capacityC: number,
    rowsC: number, columnsC: number): number;
  _zk_matrix_batch_matmul(type: number, left: number, leftBatches: number,
    leftRows: number, leftColumns: number, right: number, rightBatches: number,
    rightRows: number, rightColumns: number, output: number,
    outputCapacity: number): number;
  _zk_sparse_matvec(type: number, rows: number, columns: number,
    rowOffsets: number, columnIndices: number, values: number,
    nonzeroCount: number, vector: number, output: number,
    outputCapacity: number): number;
  _zk_sparse_matmul(type: number, rows: number, inner: number,
    rowOffsets: number, columnIndices: number, values: number,
    nonzeroCount: number, right: number, rightColumns: number,
    output: number, outputCapacity: number): number;
  _zk_buffer_create(type: number, count: number, resultPointer: number): number;
  _zk_buffer_release(handle: bigint): number;
  _zk_buffer_data(handle: bigint, byteLengthPointer: number, errorPointer: number): number;
  _zk_buffer_i32_sum(handle: bigint, start: number, count: number, resultPointer: number): number;
}

const TYPE_IDS: Record<KernelBufferType, number> = {
  u8: 1, u16: 2, i32: 3, u32: 4, f32: 5, f64: 6, i64: 7, u64: 8,
};

const SET_OPERATION_IDS: Record<KernelSetOperation, number> = {
  union: 1, intersection: 2, difference: 3, symmetricDifference: 4, complement: 5,
};

const MEASURE_OPERATION_IDS: Record<KernelMeasureOperation, number> = SET_OPERATION_IDS;
const MATRIX_OPERATION_IDS: Record<KernelMatrixOperation, number> = {
  transpose: 1, add: 2, subtract: 3, hadamard: 4, divide: 5,
  matmul: 6, matvec: 7, dot: 8, outer: 9, sum: 10, mean: 11,
  normL1: 12, normFrobenius: 13, trace: 14, determinant: 15, rank: 16,
  inverse: 17, pseudoinverse: 18, solve: 19,
};
const FACTORIZATION_IDS: Record<KernelMatrixFactorization, number> = {
  lu: 1, qr: 2, cholesky: 3, svd: 4, symmetricEigen: 5,
};
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

export interface WasmKernelOptions {
  crossOriginIsolated?: boolean;
}

/**
 * Создаёт TypeScript-обвязку над Emscripten-модулем. Буферы остаются в памяти WASM,
 * возвращаемое представление — временный типизированный вид на ту же память.
 */
export function createWasmKernel(
  module: EmscriptenKernelModule,
  options: WasmKernelOptions = {},
) {
  if (module._zk_abi_version() !== KERNEL_ABI_VERSION) {
    throw new Error('Версия ABI модуля WASM не совпадает с TypeScript-обвязкой');
  }
  const threaded = module._zk_execution_mode() === 2;
  if (threaded && !options.crossOriginIsolated) {
    throw new Error('Многопоточный WASM требует изоляции источника и SharedArrayBuffer');
  }
  if (threaded && typeof SharedArrayBuffer === 'undefined') {
    throw new Error('Многопоточный WASM недоступен: SharedArrayBuffer отсутствует');
  }

  return {
    backend: 'wasm' as const,
    threaded,
    addI32(left: number, right: number): number {
      const output = module._malloc(4);
      if (!output) throw new Error('Не удалось выделить память для результата');
      try {
        checkError(module._zk_i32_add(left, right, output));
        return module.HEAP32[output >>> 2];
      } finally {
        module._free(output);
      }
    },
    createBuffer<T extends ArrayBufferView = Uint8Array>(
      type: KernelBufferType,
      count: number,
    ): KernelBuffer<T> {
      validateCount(count);
      const handlePointer = module._malloc(8);
      if (!handlePointer) throw new Error('Не удалось выделить память для дескриптора');
      let handle: bigint;
      try {
        checkError(module._zk_buffer_create(TYPE_IDS[type], count, handlePointer));
        handle = new DataView(module.HEAPU8.buffer).getBigUint64(handlePointer, true);
      } finally {
        module._free(handlePointer);
      }

      const sizePointer = module._malloc(4);
      const errorPointer = module._malloc(4);
      if (!sizePointer || !errorPointer) {
        if (sizePointer) module._free(sizePointer);
        if (errorPointer) module._free(errorPointer);
        module._zk_buffer_release(handle);
        throw new Error('Не удалось выделить память для описания буфера');
      }

      let released = false;
      let dataPointer = 0;
      let bytes = 0;
      try {
        dataPointer = module._zk_buffer_data(handle, sizePointer, errorPointer);
        checkError(module.HEAP32[errorPointer >>> 2]);
        bytes = module.HEAPU32[sizePointer >>> 2];
        if (dataPointer + bytes > module.HEAPU8.buffer.byteLength) {
          throw new Error('Диапазон буфера выходит за границы памяти WASM');
        }
      } catch (error) {
        module._zk_buffer_release(handle);
        throw error;
      } finally {
        module._free(sizePointer);
        module._free(errorPointer);
      }

      return {
        handle,
        get view(): T {
          if (released) throw new Error('Дескриптор буфера уже освобождён');
          const currentBuffer = module.HEAPU8.buffer;
          if (dataPointer + bytes > currentBuffer.byteLength) {
            throw new Error('Диапазон буфера выходит за границы памяти WASM');
          }
          const ctor = BUFFER_CTORS[type] as unknown as new (
            buffer: ArrayBufferLike,
            offset: number,
            length: number,
          ) => T;
          return new ctor(currentBuffer, dataPointer, count);
        },
        release(): void {
          if (released) return;
          released = true;
          checkError(module._zk_buffer_release(handle));
        },
      };
    },
    sumI32(values: Int32Array): bigint {
      const buffer = this.createBuffer<Int32Array>('i32', values.length);
      try {
        buffer.view.set(values);
        const resultPointer = module._malloc(8);
        if (!resultPointer) throw new Error('Не удалось выделить память для суммы');
        try {
          checkError(module._zk_buffer_i32_sum(buffer.handle, 0, values.length, resultPointer));
          return new DataView(module.HEAPU8.buffer).getBigInt64(resultPointer, true);
        } finally {
          module._free(resultPointer);
        }
      } finally {
        buffer.release();
      }
    },
    setAlgebra(operation: KernelSetOperation, left: Uint32Array, right: Uint32Array): Uint32Array {
      const capacity = left.length + right.length;
      validateCount(capacity);
      const buffers: KernelBuffer<ArrayBufferView>[] = [];
      const resultPointer = module._malloc(4);
      if (!resultPointer) throw new Error('Не удалось выделить память для результата алгебры');
      try {
        const leftBuffer = this.createBuffer<Uint32Array>('u32', left.length);
        buffers.push(leftBuffer);
        leftBuffer.view.set(left);
        const rightBuffer = this.createBuffer<Uint32Array>('u32', right.length);
        buffers.push(rightBuffer);
        rightBuffer.view.set(right);
        const output = this.createBuffer<Uint32Array>('u32', capacity);
        buffers.push(output);
        checkError(module._zk_set_binary(
          SET_OPERATION_IDS[operation],
          leftBuffer.view.byteOffset,
          left.length,
          rightBuffer.view.byteOffset,
          right.length,
          output.view.byteOffset,
          capacity,
          resultPointer,
        ));
        const count = module.HEAPU32[resultPointer >>> 2];
        if (count > capacity) throw new Error('Ядро вернуло недопустимый размер множества');
        return output.view.slice(0, count);
      } finally {
        module._free(resultPointer);
        buffers.forEach((buffer) => buffer.release());
      }
    },
    measureAlgebra(
      operation: KernelMeasureOperation,
      left: KernelPopulationMeasure,
      right: KernelPopulationMeasure,
    ): KernelPopulationMeasure {
      return runMeasure(operation, left, right, this.createBuffer);
    },
    sumPopulationMeasure(input: KernelPopulationMeasure): KernelPopulationMeasure {
      return runMeasureSum(input, this.createBuffer);
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
      return runMatrix(operation, left, leftRows, leftColumns, right, rightRows, rightColumns);
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
      return runFactorization(factorization, input, rows, columns);
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
      if (left.constructor !== right.constructor || leftColumns !== rightRows) {
        throw new TypeError('Несовместимые типы или формы пакетных матриц');
      }
      return runBatchMatmul(
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
      return runSparseMatvec(rows, columns, rowOffsets, columnIndices, values, vector);
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
      return runSparseMatmul(rows, columns, rowOffsets, columnIndices, values, right, rightColumns);
    },
  };

  function runMeasure(operation: KernelMeasureOperation, left: KernelPopulationMeasure,
    right: KernelPopulationMeasure,
    allocate: <T extends ArrayBufferView>(type: KernelBufferType, count: number) => KernelBuffer<T>): KernelPopulationMeasure {
    validateMeasure(left);
    validateMeasure(right);
    const capacity = left.mass.length + right.mass.length;
    validateCount(capacity);
    const buffers: KernelBuffer<ArrayBufferView>[] = [];
    const resultPointer = module._malloc(4);
    if (!resultPointer) throw new Error('Не удалось выделить память для результата меры');
    try {
      const leftKeys = allocate<Uint32Array>('u32', left.keys.length);
      buffers.push(leftKeys); leftKeys.view.set(left.keys);
      const leftMass = allocate<Float64Array>('f64', left.mass.length);
      buffers.push(leftMass); leftMass.view.set(left.mass);
      const rightKeys = allocate<Uint32Array>('u32', right.keys.length);
      buffers.push(rightKeys); rightKeys.view.set(right.keys);
      const rightMass = allocate<Float64Array>('f64', right.mass.length);
      buffers.push(rightMass); rightMass.view.set(right.mass);
      const outputKeys = allocate<Uint32Array>('u32', capacity * 4);
      buffers.push(outputKeys);
      const outputMass = allocate<Float64Array>('f64', capacity);
      buffers.push(outputMass);
      checkError(module._zk_measure_binary(
        MEASURE_OPERATION_IDS[operation],
        leftKeys.view.byteOffset, leftMass.view.byteOffset, left.mass.length,
        rightKeys.view.byteOffset, rightMass.view.byteOffset, right.mass.length,
        outputKeys.view.byteOffset, outputMass.view.byteOffset, capacity, resultPointer,
      ));
      const count = module.HEAPU32[resultPointer >>> 2];
      if (count > capacity) throw new Error('Ядро вернуло недопустимый размер меры');
      return {
        keys: outputKeys.view.slice(0, count * 4),
        mass: outputMass.view.slice(0, count),
      };
    } finally {
      module._free(resultPointer);
      buffers.forEach((buffer) => buffer.release());
    }
  }

  function runMeasureSum(input: KernelPopulationMeasure,
    allocate: <T extends ArrayBufferView>(type: KernelBufferType, count: number) => KernelBuffer<T>): KernelPopulationMeasure {
    validateMeasure(input);
    const capacity = input.mass.length;
    const buffers: KernelBuffer<ArrayBufferView>[] = [];
    const resultPointer = module._malloc(4);
    if (!resultPointer) throw new Error('Не удалось выделить память для суммы меры');
    try {
      const keys = allocate<Uint32Array>('u32', input.keys.length);
      buffers.push(keys); keys.view.set(input.keys);
      const mass = allocate<Float64Array>('f64', input.mass.length);
      buffers.push(mass); mass.view.set(input.mass);
      const outputKeys = allocate<Uint32Array>('u32', capacity * 4);
      buffers.push(outputKeys);
      const outputMass = allocate<Float64Array>('f64', capacity);
      buffers.push(outputMass);
      checkError(module._zk_measure_sum(
        keys.view.byteOffset, mass.view.byteOffset, input.mass.length,
        outputKeys.view.byteOffset, outputMass.view.byteOffset, capacity, resultPointer,
      ));
      const count = module.HEAPU32[resultPointer >>> 2];
      if (count > capacity) throw new Error('Ядро вернуло недопустимый размер меры');
      return {
        keys: outputKeys.view.slice(0, count * 4),
        mass: outputMass.view.slice(0, count),
      };
    } finally {
      module._free(resultPointer);
      buffers.forEach((buffer) => buffer.release());
    }
  }

  function runMatrix(
    operation: KernelMatrixOperation,
    left: KernelMatrixScalar,
    leftRows: number,
    leftColumns: number,
    right: KernelMatrixScalar,
    rightRows: number,
    rightColumns: number,
  ): KernelMatrixResult {
    const outputCapacity = Math.max(
      left.length,
      leftRows * rightColumns,
      operation === 'outer' ? left.length * right.length : 0,
    );
    validateCount(outputCapacity);
    validateKernelBytes(
      left.byteLength, right.byteLength, outputCapacity * left.BYTES_PER_ELEMENT,
    );
    const pointers: number[] = [];
    const allocate = (bytes: number) => {
      const pointer = module._malloc(bytes || 1);
      if (!pointer) throw new Error('Недостаточно памяти для матричного вызова');
      pointers.push(pointer);
      return pointer;
    };
    try {
      const isF32 = left instanceof Float32Array;
      const leftPointer = allocate(left.byteLength);
      const rightPointer = allocate(right.byteLength);
      const outputPointer = allocate(outputCapacity * left.BYTES_PER_ELEMENT);
      const rowsPointer = allocate(4);
      const columnsPointer = allocate(4);
      module.HEAPU8.set(new Uint8Array(left.buffer, left.byteOffset, left.byteLength), leftPointer);
      module.HEAPU8.set(new Uint8Array(right.buffer, right.byteOffset, right.byteLength), rightPointer);
      checkError(module._zk_matrix_execute(
        MATRIX_OPERATION_IDS[operation],
        isF32 ? 5 : 6,
        leftPointer,
        leftRows,
        leftColumns,
        rightPointer,
        rightRows,
        rightColumns,
        outputPointer,
        outputCapacity,
        rowsPointer,
        columnsPointer,
      ));
      const view = isF32
        ? new Float32Array(module.HEAPU8.buffer, outputPointer)
        : new Float64Array(module.HEAPU8.buffer, outputPointer);
      const rows = module.HEAPU32[rowsPointer >>> 2];
      const columns = module.HEAPU32[columnsPointer >>> 2];
      const count = rows * columns;
      if (!Number.isSafeInteger(count) || count > outputCapacity) {
        throw new Error('Ядро вернуло недопустимую форму матрицы');
      }
      return { values: view.slice(0, count), rows, columns };
    } finally {
      pointers.forEach((pointer) => module._free(pointer));
    }
  }

  function runFactorization(
    factorization: KernelMatrixFactorization,
    input: KernelMatrixScalar,
    rows: number,
    columns: number,
  ): KernelMatrixFactorizationResult {
    const extent = Math.min(rows, columns);
    let capacityA = rows * rows;
    let capacityB = rows * columns;
    let capacityC = columns * columns;
    if (factorization === 'qr') {
      capacityA = rows * extent;
      capacityB = extent * columns;
      capacityC = 0;
    } else if (factorization === 'lu') {
      if (rows !== columns) throw new TypeError('LU требует квадратную матрицу');
      capacityA = capacityB = capacityC = rows * rows;
    } else if (factorization === 'cholesky') {
      if (rows !== columns) throw new TypeError('Cholesky требует квадратную матрицу');
      capacityB = capacityC = 0;
    } else if (factorization === 'svd') {
      capacityA = rows * rows;
      capacityB = extent * extent;
      capacityC = columns * columns;
    } else if (factorization === 'symmetricEigen') {
      if (rows !== columns) throw new TypeError('Собственные значения требуют квадратную матрицу');
      capacityA = rows;
      capacityB = rows * rows;
      capacityC = 0;
    }
    const elementBytes = input.BYTES_PER_ELEMENT;
    const capacities = [capacityA, capacityB, capacityC];
    validateKernelBytes(
      input.byteLength,
      ...capacities.map((capacity) => capacity * elementBytes),
    );
    const pointers: number[] = [];
    const allocate = (bytes: number) => {
      const pointer = module._malloc(Math.max(bytes, 1));
      if (!pointer) throw new Error('Недостаточно памяти для матричного разложения');
      pointers.push(pointer);
      return pointer;
    };
    try {
      const inputPointer = allocate(input.byteLength);
      const outputPointers = capacities.map((capacity) => allocate(capacity * elementBytes));
      const shapePointers = Array.from({ length: 6 }, () => allocate(4));
      module.HEAPU8.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength), inputPointer);
      checkError(module._zk_matrix_factorize(
        FACTORIZATION_IDS[factorization],
        input instanceof Float32Array ? 5 : 6,
        inputPointer, rows, columns,
        outputPointers[0], capacityA, shapePointers[0], shapePointers[1],
        outputPointers[1], capacityB, shapePointers[2], shapePointers[3],
        outputPointers[2], capacityC, shapePointers[4], shapePointers[5],
      ));
      const shape = shapePointers.map((pointer) => module.HEAPU32[pointer >>> 2]);
      const makeResult = (index: number) => {
        const rowCount = shape[index * 2];
        const columnCount = shape[index * 2 + 1];
        const count = rowCount * columnCount;
        const values = input instanceof Float32Array
          ? new Float32Array(module.HEAPU8.buffer, outputPointers[index], count).slice()
          : new Float64Array(module.HEAPU8.buffer, outputPointers[index], count).slice();
        return { values, rows: rowCount, columns: columnCount };
      };
      return { a: makeResult(0), b: makeResult(1), c: makeResult(2) };
    } finally {
      pointers.forEach((pointer) => module._free(pointer));
    }
  }

  function runBatchMatmul(
    left: KernelMatrixScalar,
    leftBatches: number,
    leftRows: number,
    leftColumns: number,
    right: KernelMatrixScalar,
    rightBatches: number,
    rightRows: number,
    rightColumns: number,
  ): KernelMatrixResult {
    const batches = Math.max(leftBatches, rightBatches);
    const outputCapacity = batches * leftRows * rightColumns;
    validateCount(outputCapacity);
    validateKernelBytes(
      left.byteLength, right.byteLength,
      outputCapacity * left.BYTES_PER_ELEMENT,
    );
    const pointers: number[] = [];
    const allocate = (bytes: number) => {
      const pointer = module._malloc(Math.max(bytes, 1));
      if (!pointer) throw new Error('Недостаточно памяти для пакетного умножения');
      pointers.push(pointer);
      return pointer;
    };
    try {
      const leftPointer = allocate(left.byteLength);
      const rightPointer = allocate(right.byteLength);
      const outputPointer = allocate(outputCapacity * left.BYTES_PER_ELEMENT);
      module.HEAPU8.set(new Uint8Array(left.buffer, left.byteOffset, left.byteLength), leftPointer);
      module.HEAPU8.set(new Uint8Array(right.buffer, right.byteOffset, right.byteLength), rightPointer);
      checkError(module._zk_matrix_batch_matmul(
        left instanceof Float32Array ? 5 : 6,
        leftPointer, leftBatches, leftRows, leftColumns,
        rightPointer, rightBatches, rightRows, rightColumns,
        outputPointer, outputCapacity,
      ));
      const count = outputCapacity;
      const values = left instanceof Float32Array
        ? new Float32Array(module.HEAPU8.buffer, outputPointer, count).slice()
        : new Float64Array(module.HEAPU8.buffer, outputPointer, count).slice();
      return { values, rows: batches * leftRows, columns: rightColumns };
    } finally {
      pointers.forEach((pointer) => module._free(pointer));
    }
  }

  function runSparseMatvec(
    rows: number,
    columns: number,
    rowOffsets: Uint32Array,
    columnIndices: Uint32Array,
    values: KernelMatrixScalar,
    vector: KernelMatrixScalar,
  ): KernelMatrixScalar {
    validateKernelBytes(
      rowOffsets.byteLength, columnIndices.byteLength,
      values.byteLength, vector.byteLength, rows * values.BYTES_PER_ELEMENT,
    );
    const pointers: number[] = [];
    const allocate = (bytes: number) => {
      const pointer = module._malloc(Math.max(bytes, 1));
      if (!pointer) throw new Error('Недостаточно памяти для разреженного вектора');
      pointers.push(pointer);
      return pointer;
    };
    try {
      const rowPointer = allocate(rowOffsets.byteLength);
      const indexPointer = allocate(columnIndices.byteLength);
      const valuesPointer = allocate(values.byteLength);
      const vectorPointer = allocate(vector.byteLength);
      const outputPointer = allocate(rows * values.BYTES_PER_ELEMENT);
      module.HEAPU8.set(new Uint8Array(rowOffsets.buffer, rowOffsets.byteOffset, rowOffsets.byteLength), rowPointer);
      module.HEAPU8.set(new Uint8Array(columnIndices.buffer, columnIndices.byteOffset, columnIndices.byteLength), indexPointer);
      module.HEAPU8.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), valuesPointer);
      module.HEAPU8.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength), vectorPointer);
      checkError(module._zk_sparse_matvec(
        values instanceof Float32Array ? 5 : 6,
        rows, columns, rowPointer, indexPointer, valuesPointer, values.length,
        vectorPointer, outputPointer, rows,
      ));
      return values instanceof Float32Array
        ? new Float32Array(module.HEAPU8.buffer, outputPointer, rows).slice()
        : new Float64Array(module.HEAPU8.buffer, outputPointer, rows).slice();
    } finally {
      pointers.forEach((pointer) => module._free(pointer));
    }
  }

  function runSparseMatmul(
    rows: number,
    columns: number,
    rowOffsets: Uint32Array,
    columnIndices: Uint32Array,
    values: KernelMatrixScalar,
    right: KernelMatrixScalar,
    rightColumns: number,
  ): KernelMatrixResult {
    const outputCapacity = rows * rightColumns;
    validateCount(outputCapacity);
    validateKernelBytes(
      rowOffsets.byteLength, columnIndices.byteLength,
      values.byteLength, right.byteLength,
      outputCapacity * values.BYTES_PER_ELEMENT,
    );
    const pointers: number[] = [];
    const allocate = (bytes: number) => {
      const pointer = module._malloc(Math.max(bytes, 1));
      if (!pointer) throw new Error('Недостаточно памяти для разреженного умножения');
      pointers.push(pointer);
      return pointer;
    };
    try {
      const rowPointer = allocate(rowOffsets.byteLength);
      const indexPointer = allocate(columnIndices.byteLength);
      const valuesPointer = allocate(values.byteLength);
      const rightPointer = allocate(right.byteLength);
      const outputPointer = allocate(outputCapacity * values.BYTES_PER_ELEMENT);
      module.HEAPU8.set(new Uint8Array(rowOffsets.buffer, rowOffsets.byteOffset, rowOffsets.byteLength), rowPointer);
      module.HEAPU8.set(new Uint8Array(columnIndices.buffer, columnIndices.byteOffset, columnIndices.byteLength), indexPointer);
      module.HEAPU8.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), valuesPointer);
      module.HEAPU8.set(new Uint8Array(right.buffer, right.byteOffset, right.byteLength), rightPointer);
      checkError(module._zk_sparse_matmul(
        values instanceof Float32Array ? 5 : 6,
        rows, columns, rowPointer, indexPointer, valuesPointer, values.length,
        rightPointer, rightColumns, outputPointer, outputCapacity,
      ));
      const count = outputCapacity;
      const result = values instanceof Float32Array
        ? new Float32Array(module.HEAPU8.buffer, outputPointer, count).slice()
        : new Float64Array(module.HEAPU8.buffer, outputPointer, count).slice();
      return { values: result, rows, columns: rightColumns };
    } finally {
      pointers.forEach((pointer) => module._free(pointer));
    }
  }

  function validateMeasure(input: KernelPopulationMeasure): void {
    if (!(input.keys instanceof Uint32Array) || !(input.mass instanceof Float64Array) ||
        input.keys.length !== input.mass.length * 4) {
      throw new TypeError('Мера требует четыре ключа uint32 и один вес f64 на группу');
    }
  }
}

function validateMatrix(values: KernelMatrixScalar, rows: number, columns: number): void {
  if (!(values instanceof Float32Array || values instanceof Float64Array) ||
      !Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) ||
      rows < 0 || columns < 0 || rows * columns !== values.length) {
    throw new TypeError('Форма матрицы не совпадает с типизированным массивом');
  }
  validateKernelBytes(values.byteLength);
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
      rowOffsets.length !== rows + 1 || columnIndices.length !== values.length ||
      rowOffsets[0] !== 0 || rowOffsets[rows] !== values.length) {
    throw new TypeError('Неверная форма CSR-матрицы');
  }
  validateKernelBytes(
    rowOffsets.byteLength, columnIndices.byteLength, values.byteLength,
  );
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

function validateCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff_ffff) {
    throw new RangeError('Количество элементов должно быть целым числом uint32');
  }
}

function validateKernelBytes(...byteCounts: number[]): void {
  const total = byteCounts.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_KERNEL_BYTES) {
    throw new RangeError('Рабочая область превышает лимит памяти матричного ядра');
  }
}

function checkError(code: number): void {
  const names = [
    'OK',
    'INVALID_ARGUMENT',
    'OUT_OF_MEMORY',
    'INVALID_HANDLE',
    'STALE_HANDLE',
    'TYPE_MISMATCH',
    'OUT_OF_RANGE',
    'OVERFLOW',
    'UNSUPPORTED',
    'CONFLICT',
    'INTERNAL',
  ];
  if (code !== 0) throw new Error(`Ошибка ядра Zero Strategy: ${names[code] ?? 'INTERNAL'}`);
}
