import type {
  KernelMatrixOperation,
  KernelMatrixFactorizationResult,
  KernelMatrixResult,
  KernelMatrixScalar,
} from './bindings/contracts';

export type MatrixValues =
  | Uint8Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;
export type MatrixElement = number;
export type MatrixOperationBackend = {
  matrixExecute: (
    operation: KernelMatrixOperation,
    left: KernelMatrixScalar,
    leftRows: number,
    leftColumns: number,
    right?: KernelMatrixScalar,
    rightRows?: number,
    rightColumns?: number,
  ) => KernelMatrixResult;
  matrixBatchMatmul?: (
    left: KernelMatrixScalar,
    leftBatches: number,
    leftRows: number,
    leftColumns: number,
    right: KernelMatrixScalar,
    rightBatches: number,
    rightRows: number,
    rightColumns: number,
  ) => KernelMatrixResult;
  matrixFactorize?: (
    kind: MatrixFactorization,
    input: KernelMatrixScalar,
    rows: number,
    columns: number,
  ) => KernelMatrixFactorizationResult;
  sparseMatvec?: (
    rows: number,
    columns: number,
    rowOffsets: Uint32Array,
    columnIndices: Uint32Array,
    values: KernelMatrixScalar,
    vector: KernelMatrixScalar,
  ) => KernelMatrixScalar;
  sparseMatmul?: (
    rows: number,
    columns: number,
    rowOffsets: Uint32Array,
    columnIndices: Uint32Array,
    values: KernelMatrixScalar,
    right: KernelMatrixScalar,
    rightColumns: number,
  ) => KernelMatrixResult;
};

export type MatrixFactorization =
  | 'lu'
  | 'qr'
  | 'cholesky'
  | 'svd'
  | 'symmetricEigen';
export interface MatrixFactorizationResult {
  a: DenseMatrix;
  b: DenseMatrix;
  c: DenseMatrix;
}

const MAX_MATRIX_ELEMENTS = 64 * 1024 * 1024;

/** Построчная плотная матрица или представление с шагом без копирования. */
export class DenseMatrix {
  readonly values: MatrixValues;
  readonly rows: number;
  readonly columns: number;
  private readonly offset: number;
  private readonly rowStride: number;
  private readonly columnStride: number;

  constructor(
    values: MatrixValues,
    rows: number,
    columns: number,
    layout?: { offset?: number; rowStride?: number; columnStride?: number },
  ) {
    validateShape(rows, columns);
    const offset = layout?.offset ?? 0;
    const rowStride = layout?.rowStride ?? columns;
    const columnStride = layout?.columnStride ?? 1;
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(rowStride) || rowStride < 0 ||
        !Number.isSafeInteger(columnStride) || columnStride < 0) {
      throw new RangeError('Недопустимый шаг представления матрицы');
    }
    const last = rows === 0 || columns === 0
      ? offset
      : offset + (rows - 1) * rowStride + (columns - 1) * columnStride;
    if (last > values.length || (rows > 0 && columns > 0 && last >= values.length)) {
      throw new RangeError('Представление выходит за границы буфера');
    }
    if (!layout) {
      for (const value of values) {
        if (!Number.isFinite(value)) throw new TypeError('Матрица содержит NaN или бесконечность');
      }
    }
    this.values = values;
    this.rows = rows;
    this.columns = columns;
    this.offset = offset;
    this.rowStride = rowStride;
    this.columnStride = columnStride;
  }

  static zeros(
    rows: number,
    columns: number,
    type: MatrixValues = new Float64Array(),
  ): DenseMatrix {
    validateShape(rows, columns);
    return new DenseMatrix(new (type.constructor as MatrixValuesConstructor)(rows * columns), rows, columns);
  }

  static fromRows(rows: readonly (readonly number[])[], type: MatrixValues = new Float64Array()): DenseMatrix {
    const rowCount = rows.length;
    const columnCount = rowCount === 0 ? 0 : rows[0].length;
    validateShape(rowCount, columnCount);
    if (rows.some((row) => row.length !== columnCount)) {
      throw new TypeError('Все строки матрицы должны иметь одинаковую длину');
    }
    const values = new (type.constructor as MatrixValuesConstructor)(rowCount * columnCount);
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      if (!Number.isFinite(value)) throw new TypeError('Матрица содержит NaN или бесконечность');
      values[rowIndex * columnCount + columnIndex] = checkedValue(values, value);
    }));
    return new DenseMatrix(values, rowCount, columnCount);
  }

  get(row: number, column: number): number {
    this.assertIndex(row, column);
    const value = this.values[this.offset + row * this.rowStride + column * this.columnStride];
    if (!Number.isFinite(value)) throw new TypeError('Матрица содержит NaN или бесконечность');
    return value;
  }

  set(row: number, column: number, value: number): void {
    this.assertIndex(row, column);
    if (!Number.isFinite(value)) throw new TypeError('Элемент матрицы должен быть конечным');
    this.values[this.offset + row * this.rowStride + column * this.columnStride] =
      checkedValue(this.values, value);
  }

  view(): DenseMatrix {
    return new DenseMatrix(this.values, this.rows, this.columns, {
      offset: this.offset,
      rowStride: this.rowStride,
      columnStride: this.columnStride,
    });
  }

  slice(
    rowStart = 0,
    rowEnd = this.rows,
    columnStart = 0,
    columnEnd = this.columns,
  ): DenseMatrix {
    validateRange(rowStart, rowEnd, this.rows);
    validateRange(columnStart, columnEnd, this.columns);
    return new DenseMatrix(
      this.values,
      rowEnd - rowStart,
      columnEnd - columnStart,
      {
        offset: this.offset + rowStart * this.rowStride + columnStart * this.columnStride,
        rowStride: this.rowStride,
        columnStride: this.columnStride,
      },
    );
  }

  transpose(): DenseMatrix {
    return new DenseMatrix(this.values, this.columns, this.rows, {
      offset: this.offset,
      rowStride: this.columnStride,
      columnStride: this.rowStride,
    });
  }

  reshape(rows: number, columns: number): DenseMatrix {
    validateShape(rows, columns);
    if (rows * columns !== this.rows * this.columns ||
        this.columnStride !== 1 || this.rowStride !== this.columns) {
      throw new TypeError('Изменение формы требует плотного представления с тем же числом элементов');
    }
    return new DenseMatrix(this.values, rows, columns, {
      offset: this.offset,
      rowStride: columns,
      columnStride: 1,
    });
  }

  toContiguous(): DenseMatrix {
    const result = DenseMatrix.zeros(this.rows, this.columns, this.values);
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        result.values[row * this.columns + column] = this.get(row, column);
      }
    }
    return result;
  }

  toRows(): number[][] {
    return Array.from({ length: this.rows }, (_, row) =>
      Array.from({ length: this.columns }, (_, column) => this.get(row, column)));
  }

  private assertIndex(row: number, column: number): void {
    if (!Number.isInteger(row) || !Number.isInteger(column) ||
        row < 0 || row >= this.rows || column < 0 || column >= this.columns) {
      throw new RangeError('Индекс матрицы вне допустимого диапазона');
    }
  }
}

type MatrixValuesConstructor = new (length: number) => MatrixValues;

/** Разреженное CSR-представление с отсортированными уникальными столбцами. */
export class CsrMatrix {
  readonly rows: number;
  readonly columns: number;
  readonly rowOffsets: Uint32Array;
  readonly columnIndices: Uint32Array;
  readonly values: Float32Array | Float64Array;

  constructor(
    rows: number,
    columns: number,
    rowOffsets: Uint32Array,
    columnIndices: Uint32Array,
    values: Float32Array | Float64Array,
  ) {
    validateShape(rows, columns);
    if (!(rowOffsets instanceof Uint32Array) ||
        !(columnIndices instanceof Uint32Array) ||
        rowOffsets.length !== rows + 1 ||
        columnIndices.length !== values.length ||
        rowOffsets[0] !== 0 || rowOffsets[rows] !== values.length) {
      throw new TypeError('CSR-массивы имеют несовместимые размеры');
    }
    for (let row = 0; row < rows; row += 1) {
      if (rowOffsets[row] > rowOffsets[row + 1] ||
          rowOffsets[row + 1] > values.length) {
        throw new TypeError('Смещения строк CSR должны быть монотонными');
      }
      let previous = -1;
      for (let index = rowOffsets[row]; index < rowOffsets[row + 1]; index += 1) {
        const column = columnIndices[index];
        if (column >= columns || column <= previous ||
            !Number.isFinite(values[index]) || values[index] === 0) {
          throw new TypeError('CSR должен иметь конечные ненулевые элементы и уникальные отсортированные столбцы');
        }
        previous = column;
      }
    }
    this.rows = rows;
    this.columns = columns;
    this.rowOffsets = rowOffsets;
    this.columnIndices = columnIndices;
    this.values = values;
  }

  static fromDense(matrix: DenseMatrix): CsrMatrix {
    const rowOffsets = new Uint32Array(matrix.rows + 1);
    const columns: number[] = [];
    const values: number[] = [];
    for (let row = 0; row < matrix.rows; row += 1) {
      for (let column = 0; column < matrix.columns; column += 1) {
        const value = matrix.get(row, column);
        if (value !== 0) {
          columns.push(column);
          values.push(value);
        }
      }
      rowOffsets[row + 1] = values.length;
    }
    const ctor = matrix.values instanceof Float32Array ? Float32Array : Float64Array;
    return new CsrMatrix(
      matrix.rows,
      matrix.columns,
      rowOffsets,
      Uint32Array.from(columns),
      ctor.from(values),
    );
  }

  get(row: number, column: number): number {
    if (!Number.isInteger(row) || !Number.isInteger(column) ||
        row < 0 || row >= this.rows || column < 0 || column >= this.columns) {
      throw new RangeError('Индекс матрицы вне допустимого диапазона');
    }
    let low = this.rowOffsets[row];
    let high = this.rowOffsets[row + 1];
    while (low < high) {
      const middle = low + ((high - low) >>> 1);
      if (this.columnIndices[middle] < column) low = middle + 1;
      else high = middle;
    }
    return low < this.rowOffsets[row + 1] && this.columnIndices[low] === column
      ? this.values[low]
      : 0;
  }

  transpose(): CsrMatrix {
    const rowOffsets = new Uint32Array(this.columns + 1);
    for (const column of this.columnIndices) rowOffsets[column + 1] += 1;
    for (let row = 0; row < this.columns; row += 1) rowOffsets[row + 1] += rowOffsets[row];
    const next = rowOffsets.slice(0, -1);
    const columnIndices = new Uint32Array(this.values.length);
    const values = new (this.values.constructor as FloatArrayConstructor)(this.values.length);
    for (let row = 0; row < this.rows; row += 1) {
      for (let index = this.rowOffsets[row]; index < this.rowOffsets[row + 1]; index += 1) {
        const column = this.columnIndices[index];
        const target = next[column]++;
        columnIndices[target] = row;
        values[target] = this.values[index];
      }
    }
    return new CsrMatrix(
      this.columns, this.rows, rowOffsets, columnIndices, values,
    );
  }

  slice(rowStart: number, rowEnd: number, columnStart: number, columnEnd: number): CsrMatrix {
    validateRange(rowStart, rowEnd, this.rows);
    validateRange(columnStart, columnEnd, this.columns);
    const rowOffsets = new Uint32Array(rowEnd - rowStart + 1);
    const columns: number[] = [];
    const entries: number[] = [];
    for (let row = rowStart; row < rowEnd; row += 1) {
      for (let index = this.rowOffsets[row]; index < this.rowOffsets[row + 1]; index += 1) {
        const column = this.columnIndices[index];
        if (column >= columnStart && column < columnEnd) {
          columns.push(column - columnStart);
          entries.push(this.values[index]);
        }
      }
      rowOffsets[row - rowStart + 1] = entries.length;
    }
    const slicedValues = new (this.values.constructor as FloatArrayConstructor)(entries.length);
    entries.forEach((value, index) => { slicedValues[index] = value; });
    return new CsrMatrix(
      rowEnd - rowStart,
      columnEnd - columnStart,
      rowOffsets,
      Uint32Array.from(columns),
      slicedValues,
    );
  }

  reshape(rows: number, columns: number): CsrMatrix {
    validateShape(rows, columns);
    if (rows * columns !== this.rows * this.columns) {
      throw new TypeError('Изменение формы CSR требует того же общего размера');
    }
    const entries = Array.from({ length: this.values.length }, (_, index) => ({
      position: this.columnIndices[index] + this.rowOf(index) * this.columns,
      value: this.values[index],
    })).sort((a, b) => a.position - b.position);
    const rowOffsets = new Uint32Array(rows + 1);
    const columnIndices = new Uint32Array(entries.length);
    const values = new (this.values.constructor as FloatArrayConstructor)(entries.length);
    entries.forEach((entry, index) => {
      const row = Math.floor(entry.position / columns);
      rowOffsets[row + 1] += 1;
      columnIndices[index] = entry.position % columns;
      values[index] = entry.value;
    });
    for (let row = 0; row < rows; row += 1) rowOffsets[row + 1] += rowOffsets[row];
    return new CsrMatrix(rows, columns, rowOffsets, columnIndices, values);
  }

  private rowOf(index: number): number {
    let low = 0;
    let high = this.rows;
    while (low < high) {
      const middle = low + ((high - low) >>> 1);
      if (this.rowOffsets[middle + 1] <= index) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  toDense(): DenseMatrix {
    const result = DenseMatrix.zeros(this.rows, this.columns, this.values);
    for (let row = 0; row < this.rows; row += 1) {
      for (let index = this.rowOffsets[row]; index < this.rowOffsets[row + 1]; index += 1) {
        result.values[row * this.columns + this.columnIndices[index]] = this.values[index];
      }
    }
    return result;
  }

  multiplyVector(
    vector: Float32Array | Float64Array,
    backend?: MatrixOperationBackend,
  ): Float32Array | Float64Array {
    if (vector.length !== this.columns) throw new TypeError('Форма вектора не совпадает с CSR-матрицей');
    assertFinite(vector);
    if (backend?.sparseMatvec &&
        (this.values instanceof Float32Array || this.values instanceof Float64Array) &&
        this.values.constructor === vector.constructor) {
      return backend.sparseMatvec(
        this.rows, this.columns, this.rowOffsets, this.columnIndices, this.values, vector,
      ) as Float32Array | Float64Array;
    }
    const output = new (this.values.constructor as FloatArrayConstructor)(this.rows);
    for (let row = 0; row < this.rows; row += 1) {
      let sum = 0;
      let correction = 0;
      for (let index = this.rowOffsets[row]; index < this.rowOffsets[row + 1]; index += 1) {
        const product = this.values[index] * vector[this.columnIndices[index]];
        const adjusted = product - correction;
        const next = sum + adjusted;
        correction = (next - sum) - adjusted;
        sum = next;
      }
      if (!Number.isFinite(sum)) throw new RangeError('Переполнение при разреженном умножении');
      if (output instanceof Float32Array && !Number.isFinite(Math.fround(sum))) {
        throw new RangeError('Переполнение float32 при разреженном умножении');
      }
      output[row] = sum;
    }
    return output;
  }

  multiplyDense(
    right: DenseMatrix,
    backend?: MatrixOperationBackend,
  ): DenseMatrix {
    if (right.rows !== this.columns) throw new TypeError('Формы CSR и плотной матрицы несовместимы');
    const denseRight = right.toContiguous();
    if (backend?.sparseMatmul &&
        (this.values instanceof Float32Array || this.values instanceof Float64Array) &&
        (denseRight.values instanceof Float32Array || denseRight.values instanceof Float64Array) &&
        this.values.constructor === denseRight.values.constructor) {
      const result = backend.sparseMatmul(
        this.rows,
        this.columns,
        this.rowOffsets,
        this.columnIndices,
        this.values,
        denseRight.values,
        right.columns,
      );
      return new DenseMatrix(result.values, result.rows, result.columns);
    }
    const output = new (this.values.constructor as FloatArrayConstructor)(this.rows * right.columns);
    for (let row = 0; row < this.rows; row += 1) {
      const sums = new Float64Array(right.columns);
      const corrections = new Float64Array(right.columns);
      for (let index = this.rowOffsets[row]; index < this.rowOffsets[row + 1]; index += 1) {
        const leftValue = this.values[index];
        const inner = this.columnIndices[index];
        for (let column = 0; column < right.columns; column += 1) {
          const term = leftValue * denseRight.values[inner * right.columns + column];
          const adjusted = term - corrections[column];
          const next = sums[column] + adjusted;
          corrections[column] = (next - sums[column]) - adjusted;
          sums[column] = next;
        }
      }
      for (let column = 0; column < right.columns; column += 1) {
        const value = sums[column];
        if (!Number.isFinite(value)) throw new RangeError('Переполнение при умножении CSR');
        if (output instanceof Float32Array && !Number.isFinite(Math.fround(value))) {
          throw new RangeError('Переполнение float32 при умножении CSR');
        }
        output[row * right.columns + column] = value;
      }
    }
    return new DenseMatrix(output, this.rows, right.columns);
  }

  sum(): number {
    let total = 0;
    let correction = 0;
    for (const value of this.values) {
      const adjusted = value - correction;
      const next = total + adjusted;
      correction = (next - total) - adjusted;
      total = next;
    }
    if (!Number.isFinite(total)) throw new RangeError('Переполнение суммы CSR');
    return total;
  }

  normL1(): number {
    let total = 0;
    let correction = 0;
    for (const value of this.values) {
      const adjusted = Math.abs(value) - correction;
      const next = total + adjusted;
      correction = (next - total) - adjusted;
      total = next;
    }
    if (!Number.isFinite(total)) throw new RangeError('Переполнение нормы CSR');
    return total;
  }

  mean(): number {
    const count = this.rows * this.columns;
    if (count === 0) throw new RangeError('Среднее пустой CSR-матрицы не определено');
    return this.sum() / count;
  }

  min(): number {
    if (this.rows * this.columns === 0) throw new RangeError('Минимум пустой CSR-матрицы не определён');
    let result = this.values.length < this.rows * this.columns ? 0 : this.values[0];
    for (const value of this.values) result = Math.min(result, value);
    return result;
  }

  max(): number {
    if (this.rows * this.columns === 0) throw new RangeError('Максимум пустой CSR-матрицы не определён');
    let result = this.values.length < this.rows * this.columns ? 0 : this.values[0];
    for (const value of this.values) result = Math.max(result, value);
    return result;
  }

  normFrobenius(): number {
    let scale = 0;
    let squares = 1;
    for (const value of this.values) {
      const absolute = Math.abs(value);
      if (absolute === 0) continue;
      if (scale < absolute) {
        squares = 1 + squares * (scale / absolute) ** 2;
        scale = absolute;
      } else {
        squares += (absolute / scale) ** 2;
      }
    }
    const result = scale === 0 ? 0 : scale * Math.sqrt(squares);
    if (!Number.isFinite(result)) throw new RangeError('Переполнение нормы CSR');
    return result;
  }
}

type FloatArrayConstructor = new (length: number) => Float32Array | Float64Array;

/** Одномерный численный вектор с представлением без копирования. */
export class DenseVector {
  readonly values: Float32Array | Float64Array | Int32Array | Uint32Array;
  readonly length: number;
  readonly offset: number;
  readonly stride: number;

  constructor(
    values: Float32Array | Float64Array | Int32Array | Uint32Array,
    length = values.length,
    offset = 0,
    stride = 1,
  ) {
    if (!Number.isSafeInteger(length) || length < 0 ||
        !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(stride) || stride <= 0 ||
        (length > 0 && offset + (length - 1) * stride >= values.length)) {
      throw new RangeError('Форма вектора выходит за границы буфера');
    }
    this.values = values;
    this.length = length;
    this.offset = offset;
    this.stride = stride;
  }

  get(index: number): number {
    this.assertIndex(index);
    return this.values[this.offset + index * this.stride];
  }

  set(index: number, value: number): void {
    this.assertIndex(index);
    if (!Number.isFinite(value)) throw new TypeError('Элемент вектора должен быть конечным');
    this.values[this.offset + index * this.stride] = checkedValue(this.values, value);
  }

  slice(start = 0, end = this.length): DenseVector {
    validateRange(start, end, this.length);
    return new DenseVector(this.values, end - start, this.offset + start * this.stride, this.stride);
  }

  toContiguous(): Float32Array | Float64Array | Int32Array | Uint32Array {
    const result = new (this.values.constructor as VectorArrayConstructor)(this.length);
    for (let index = 0; index < this.length; index += 1) result[index] = this.get(index);
    return result;
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError('Индекс вектора вне допустимого диапазона');
    }
  }
}

type VectorArrayConstructor = new (length: number) =>
  Float32Array | Float64Array | Int32Array | Uint32Array;

/** Несколько плотных матриц одинаковой формы, каждая в отдельном типизированном буфере. */
export class MatrixBatch {
  readonly matrices: readonly DenseMatrix[];
  readonly rows: number;
  readonly columns: number;

  constructor(matrices: readonly DenseMatrix[]) {
    if (matrices.length === 0) throw new TypeError('Пакет матриц не может быть пустым');
    const { rows, columns } = matrices[0];
    if (matrices.some((matrix) =>
      matrix.rows !== rows || matrix.columns !== columns ||
      matrix.values.constructor !== matrices[0].values.constructor)) {
      throw new TypeError('Формы и типы матриц пакета должны совпадать');
    }
    this.matrices = matrices;
    this.rows = rows;
    this.columns = columns;
  }
}

export function concatenate(
  matrices: readonly DenseMatrix[],
  axis: 0 | 1,
): DenseMatrix {
  if (matrices.length === 0) throw new TypeError('Для конкатенации нужна хотя бы одна матрица');
  const type = matrices[0].values;
  if (matrices.some((matrix) => matrix.values.constructor !== type.constructor)) {
    throw new TypeError('Типы матриц при конкатенации должны совпадать');
  }
  const rows = axis === 0
    ? matrices.reduce((sum, matrix) => sum + matrix.rows, 0)
    : matrices[0].rows;
  const columns = axis === 1
    ? matrices.reduce((sum, matrix) => sum + matrix.columns, 0)
    : matrices[0].columns;
  if (matrices.some((matrix) =>
    axis === 0 ? matrix.columns !== columns : matrix.rows !== rows)) {
    throw new TypeError('Формы матриц несовместимы для конкатенации');
  }
  const result = DenseMatrix.zeros(rows, columns, type);
  let offset = 0;
  for (const matrix of matrices) {
    for (let row = 0; row < matrix.rows; row += 1) {
      for (let column = 0; column < matrix.columns; column += 1) {
        const targetRow = axis === 0 ? offset + row : row;
        const targetColumn = axis === 1 ? offset + column : column;
        result.values[targetRow * columns + targetColumn] = matrix.get(row, column);
      }
    }
    offset += axis === 0 ? matrix.rows : matrix.columns;
  }
  return result;
}

export function concatenateSparse(
  matrices: readonly CsrMatrix[],
  axis: 0 | 1,
): CsrMatrix {
  if (matrices.length === 0) throw new TypeError('Для конкатенации нужна хотя бы одна CSR-матрица');
  const type = matrices[0].values.constructor;
  if (matrices.some((matrix) => matrix.values.constructor !== type)) {
    throw new TypeError('Типы CSR-матриц должны совпадать');
  }
  const rows = axis === 0
    ? matrices.reduce((sum, matrix) => sum + matrix.rows, 0)
    : matrices[0].rows;
  const columns = axis === 1
    ? matrices.reduce((sum, matrix) => sum + matrix.columns, 0)
    : matrices[0].columns;
  if (matrices.some((matrix) =>
    axis === 0 ? matrix.columns !== columns : matrix.rows !== rows)) {
    throw new TypeError('Формы CSR-матриц несовместимы для конкатенации');
  }
  validateShape(rows, columns);
  const rowOffsets = new Uint32Array(rows + 1);
  const indices: number[] = [];
  const values: number[] = [];
  if (axis === 0) {
    let rowBase = 0;
    for (const matrix of matrices) {
      for (let row = 0; row < matrix.rows; row += 1) {
        for (let index = matrix.rowOffsets[row]; index < matrix.rowOffsets[row + 1]; index += 1) {
          indices.push(matrix.columnIndices[index]);
          values.push(matrix.values[index]);
        }
        rowOffsets[rowBase + row + 1] = values.length;
      }
      rowBase += matrix.rows;
    }
  } else {
    for (let row = 0; row < rows; row += 1) {
      let columnBase = 0;
      for (const matrix of matrices) {
        for (let index = matrix.rowOffsets[row]; index < matrix.rowOffsets[row + 1]; index += 1) {
          indices.push(columnBase + matrix.columnIndices[index]);
          values.push(matrix.values[index]);
        }
        columnBase += matrix.columns;
      }
      rowOffsets[row + 1] = values.length;
    }
  }
  const resultValues = new (matrices[0].values.constructor as FloatArrayConstructor)(values.length);
  resultValues.set(values);
  return new CsrMatrix(rows, columns, rowOffsets, Uint32Array.from(indices), resultValues);
}

export function maskSparse(matrix: CsrMatrix, selected: Uint8Array): CsrMatrix {
  if (selected.length !== matrix.rows * matrix.columns) {
    throw new TypeError('Размер маски должен совпадать с количеством элементов CSR');
  }
  const rowOffsets = new Uint32Array(matrix.rows + 1);
  const indices: number[] = [];
  const values: number[] = [];
  for (let row = 0; row < matrix.rows; row += 1) {
    for (let index = matrix.rowOffsets[row]; index < matrix.rowOffsets[row + 1]; index += 1) {
      if (selected[row * matrix.columns + matrix.columnIndices[index]] === 1) {
        indices.push(matrix.columnIndices[index]);
        values.push(matrix.values[index]);
      } else if (selected[row * matrix.columns + matrix.columnIndices[index]] !== 0) {
        throw new TypeError('Маска должна содержать только 0 и 1');
      }
    }
    rowOffsets[row + 1] = values.length;
  }
  for (const value of selected) {
    if (value !== 0 && value !== 1) throw new TypeError('Маска должна содержать только 0 и 1');
  }
  const output = new (matrix.values.constructor as FloatArrayConstructor)(values.length);
  output.set(values);
  return new CsrMatrix(matrix.rows, matrix.columns, rowOffsets, Uint32Array.from(indices), output);
}

export function elementwiseSparse(
  left: CsrMatrix,
  right: CsrMatrix | number,
  operation: 'add' | 'subtract' | 'multiply' | 'divide' | 'and' | 'or' | 'xor',
): CsrMatrix {
  if (typeof right === 'number') {
    if (!Number.isFinite(right)) throw new TypeError('Скаляр должен быть конечным');
    if (operation === 'and' || operation === 'or' || operation === 'xor') {
      throw new TypeError('Логические операции CSR требуют две матрицы');
    }
    if ((operation === 'add' || operation === 'subtract') && right !== 0) {
      throw new TypeError('Смещение ненулевым скаляром не сохраняет разреженность');
    }
    if (operation === 'divide' && right === 0) throw new RangeError('Деление CSR на ноль');
    const values: number[] = [];
    const indices: number[] = [];
    const rowOffsets = new Uint32Array(left.rows + 1);
    for (let row = 0; row < left.rows; row += 1) {
      for (let index = left.rowOffsets[row]; index < left.rowOffsets[row + 1]; index += 1) {
        const value = operation === 'add' ? left.values[index]
          : operation === 'subtract' ? left.values[index]
            : operation === 'multiply' ? left.values[index] * right
              : left.values[index] / right;
        const checked = checkedValue(left.values, value);
        if (checked !== 0) {
          indices.push(left.columnIndices[index]);
          values.push(checked);
        }
      }
      rowOffsets[row + 1] = values.length;
    }
    const resultValues = new (left.values.constructor as FloatArrayConstructor)(values.length);
    resultValues.set(values);
    return new CsrMatrix(
      left.rows, left.columns, rowOffsets,
      Uint32Array.from(indices), resultValues,
    );
  }
  if (left.rows !== right.rows || left.columns !== right.columns ||
      left.values.constructor !== right.values.constructor) {
    throw new TypeError('CSR-формы и типы должны совпадать');
  }
  if (operation === 'divide' && right.values.length !== right.rows * right.columns) {
    throw new RangeError('Деление CSR требует ненулевой плотной правой матрицы');
  }
  const rowOffsets = new Uint32Array(left.rows + 1);
  const indices: number[] = [];
  const values: number[] = [];
  for (let row = 0; row < left.rows; row += 1) {
    let a = left.rowOffsets[row];
    let b = right.rowOffsets[row];
    while (a < left.rowOffsets[row + 1] || b < right.rowOffsets[row + 1]) {
      const ac = a < left.rowOffsets[row + 1] ? left.columnIndices[a] : Infinity;
      const bc = b < right.rowOffsets[row + 1] ? right.columnIndices[b] : Infinity;
      const column = Math.min(ac, bc);
      const av = ac === column ? left.values[a++] : 0;
      const bv = bc === column ? right.values[b++] : 0;
      if (operation === 'divide' && bv === 0) {
        if (av !== 0) throw new RangeError('Деление CSR на ноль');
        throw new RangeError('Результат деления CSR неразрежен из-за нулевого знаменателя');
      }
      const value = operation === 'add' ? av + bv
        : operation === 'subtract' ? av - bv
          : operation === 'multiply' ? av * bv
            : operation === 'divide' ? av / bv
              : operation === 'and' ? Number(av !== 0 && bv !== 0)
                : operation === 'or' ? Number(av !== 0 || bv !== 0)
                  : Number((av !== 0) !== (bv !== 0));
      const checked = checkedValue(left.values, value);
      if (checked !== 0) {
        indices.push(column);
        values.push(checked);
      }
    }
    rowOffsets[row + 1] = values.length;
  }
  const resultValues = new (left.values.constructor as FloatArrayConstructor)(values.length);
  resultValues.set(values);
  return new CsrMatrix(left.rows, left.columns, rowOffsets, Uint32Array.from(indices), resultValues);
}

export function mask(matrix: DenseMatrix, selected: Uint8Array): DenseMatrix {
  if (selected.length !== matrix.rows * matrix.columns) {
    throw new TypeError('Размер маски должен совпадать с количеством элементов матрицы');
  }
  const result = DenseMatrix.zeros(matrix.rows, matrix.columns, matrix.values);
  for (let index = 0; index < selected.length; index += 1) {
    if (selected[index] !== 0 && selected[index] !== 1) {
      throw new TypeError('Маска должна содержать только 0 и 1');
    }
    if (selected[index]) {
      result.values[index] = matrix.get(
        Math.floor(index / matrix.columns),
        index % matrix.columns,
      );
    }
  }
  return result;
}

export type ElementwiseOperation = 'add' | 'subtract' | 'multiply' | 'divide' |
  'min' | 'max' | 'and' | 'or' | 'xor' | 'equal' | 'lessThan';

export function elementwise(
  left: DenseMatrix,
  right: DenseMatrix | number,
  operation: ElementwiseOperation,
): DenseMatrix {
  if (typeof right !== 'number' &&
      (right.rows !== left.rows && right.rows !== 1 ||
       right.columns !== left.columns && right.columns !== 1)) {
    throw new TypeError('Формы не поддерживают broadcasting');
  }
  if (typeof right !== 'number' &&
      right.values.constructor !== left.values.constructor &&
      !['and', 'or', 'xor', 'equal', 'lessThan'].includes(operation)) {
    throw new TypeError('Типы матриц не совпадают');
  }
  const outputType = ['and', 'or', 'xor', 'equal', 'lessThan'].includes(operation)
    ? new Uint8Array()
    : left.values;
  const result = DenseMatrix.zeros(left.rows, left.columns, outputType);
  for (let row = 0; row < left.rows; row += 1) {
    for (let column = 0; column < left.columns; column += 1) {
      const a = left.get(row, column);
      const b = typeof right === 'number'
        ? right
        : right.get(right.rows === 1 ? 0 : row, right.columns === 1 ? 0 : column);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new TypeError('Операция матрицы содержит NaN или бесконечность');
      }
      let value: number;
      switch (operation) {
        case 'add': value = a + b; break;
        case 'subtract': value = a - b; break;
        case 'multiply': value = a * b; break;
        case 'divide':
          if (b === 0) throw new RangeError('Деление матрицы на ноль');
          value = a / b;
          break;
        case 'min': value = Math.min(a, b); break;
        case 'max': value = Math.max(a, b); break;
        case 'and': value = Number(Boolean(a) && Boolean(b)); break;
        case 'or': value = Number(Boolean(a) || Boolean(b)); break;
        case 'xor': value = Number(Boolean(a) !== Boolean(b)); break;
        case 'equal': value = Number(a === b); break;
        case 'lessThan': value = Number(a < b); break;
      }
      result.values[row * left.columns + column] = checkedValue(result.values, value);
    }
  }
  return result;
}

export function elementwiseSparseBroadcast(
  left: CsrMatrix,
  right: CsrMatrix,
  operation: ElementwiseOperation,
): DenseMatrix {
  return elementwise(left.toDense(), right.toDense(), operation);
}

export function reduce(
  matrix: DenseMatrix,
  operation: 'sum' | 'mean' | 'min' | 'max' | 'normL1' | 'normFrobenius',
): number {
  let result = operation === 'min' ? Infinity : operation === 'max' ? -Infinity : 0;
  let correction = 0;
  for (let row = 0; row < matrix.rows; row += 1) {
    for (let column = 0; column < matrix.columns; column += 1) {
      const value = matrix.get(row, column);
      if (!Number.isFinite(value)) throw new TypeError('Матрица содержит NaN или бесконечность');
      if (operation === 'min') result = Math.min(result, value);
      else if (operation === 'max') result = Math.max(result, value);
      else {
        const term = operation === 'normL1' ? Math.abs(value)
          : operation === 'normFrobenius' ? value * value : value;
        const adjusted = term - correction;
        const next = result + adjusted;
        correction = (next - result) - adjusted;
        result = next;
      }
    }
  }
  if (operation === 'mean') result /= matrix.rows * matrix.columns;
  if (operation === 'normFrobenius') result = Math.sqrt(result);
  if (operation === 'sum' &&
      !(matrix.values instanceof Float32Array || matrix.values instanceof Float64Array) &&
      !Number.isSafeInteger(result)) {
    throw new RangeError('Сумма целой матрицы превышает точность безопасного целого JavaScript');
  }
  if (!Number.isFinite(result)) throw new RangeError('Переполнение при редукции матрицы');
  return result;
}

export function executeLinearAlgebra(
  backend: MatrixOperationBackend,
  operation: KernelMatrixOperation,
  left: DenseMatrix,
  right?: DenseMatrix,
): DenseMatrix {
  if (!(left.values instanceof Float32Array || left.values instanceof Float64Array) ||
      (right && !(right.values instanceof Float32Array || right.values instanceof Float64Array))) {
    throw new TypeError('Численные операции Eigen принимают только float32 и float64');
  }
  const leftValues = left.toContiguous().values as KernelMatrixScalar;
  const rightValues = right?.toContiguous().values as KernelMatrixScalar | undefined;
  const result = backend.matrixExecute(
    operation, leftValues, left.rows, left.columns,
    rightValues,
    right?.rows ?? 0,
    right?.columns ?? 0,
  );
  return new DenseMatrix(result.values, result.rows, result.columns);
}

export function batchMatmul(
  backend: MatrixOperationBackend,
  left: MatrixBatch,
  right: MatrixBatch,
): MatrixBatch {
  if (left.columns !== right.rows) throw new TypeError('Несовместимые формы для пакетного умножения');
  if (!backend.matrixBatchMatmul) {
    throw new Error('Вычислительное ядро не поддерживает пакетное умножение одним вызовом');
  }
  const leftValues = combineBatch(left);
  const rightValues = combineBatch(right);
  const result = backend.matrixBatchMatmul(
    leftValues, left.matrices.length, left.rows, left.columns,
    rightValues, right.matrices.length, right.rows, right.columns,
  );
  const matrices: DenseMatrix[] = [];
  const batchSize = left.rows * right.columns;
  for (let index = 0; index < Math.max(left.matrices.length, right.matrices.length); index += 1) {
    const start = index * batchSize;
    matrices.push(new DenseMatrix(result.values.slice(start, start + batchSize), left.rows, right.columns));
  }
  return new MatrixBatch(matrices);
}

export function factorize(
  backend: MatrixOperationBackend,
  kind: MatrixFactorization,
  matrix: DenseMatrix,
): MatrixFactorizationResult {
  if (!backend.matrixFactorize) throw new Error('Вычислительное ядро не поддерживает факторизации');
  if (!(matrix.values instanceof Float32Array || matrix.values instanceof Float64Array)) {
    throw new TypeError('Разложения Eigen принимают только float32 и float64');
  }
  const input = matrix.toContiguous().values as KernelMatrixScalar;
  const result = backend.matrixFactorize(kind, input, matrix.rows, matrix.columns);
  return {
    a: new DenseMatrix(result.a.values, result.a.rows, result.a.columns),
    b: new DenseMatrix(result.b.values, result.b.rows, result.b.columns),
    c: new DenseMatrix(result.c.values, result.c.rows, result.c.columns),
  };
}

export interface StencilPoint {
  rowOffset: number;
  columnOffset: number;
  weight: number;
}

export function stencil2D(
  matrix: DenseMatrix,
  stencil: readonly StencilPoint[],
  boundary: 'zero' | 'clamp' = 'zero',
): DenseMatrix {
  if (stencil.length === 0 ||
      stencil.some((point) => !Number.isInteger(point.rowOffset) ||
        !Number.isInteger(point.columnOffset) || !Number.isFinite(point.weight))) {
    throw new TypeError('Стенсил должен содержать конечные целочисленные смещения и веса');
  }
  const result = DenseMatrix.zeros(matrix.rows, matrix.columns, matrix.values);
  for (let row = 0; row < matrix.rows; row += 1) {
    for (let column = 0; column < matrix.columns; column += 1) {
      let sum = 0;
      let correction = 0;
      for (const point of stencil) {
        let y = row + point.rowOffset;
        let x = column + point.columnOffset;
        if (boundary === 'clamp') {
          y = Math.max(0, Math.min(matrix.rows - 1, y));
          x = Math.max(0, Math.min(matrix.columns - 1, x));
        }
        const sample = y < 0 || y >= matrix.rows || x < 0 || x >= matrix.columns
          ? 0
          : matrix.get(y, x);
        const adjusted = sample * point.weight - correction;
        const next = sum + adjusted;
        correction = (next - sum) - adjusted;
        sum = next;
      }
      if (!Number.isFinite(sum)) throw new RangeError('Переполнение при вычислении стенсила');
      result.values[row * matrix.columns + column] = checkedValue(result.values, sum);
    }
  }
  return result;
}

export function convolve2D(
  matrix: DenseMatrix,
  kernel: DenseMatrix,
  boundary: 'zero' | 'clamp' = 'zero',
): DenseMatrix {
  const centerRow = Math.floor(kernel.rows / 2);
  const centerColumn = Math.floor(kernel.columns / 2);
  const stencil: StencilPoint[] = [];
  for (let row = 0; row < kernel.rows; row += 1) {
    for (let column = 0; column < kernel.columns; column += 1) {
      stencil.push({
        rowOffset: row - centerRow,
        columnOffset: column - centerColumn,
        weight: kernel.get(row, column),
      });
    }
  }
  return stencil2D(matrix, stencil, boundary);
}

export function interpolateBilinear(matrix: DenseMatrix, row: number, column: number): number {
  if (!Number.isFinite(row) || !Number.isFinite(column) ||
      matrix.rows === 0 || matrix.columns === 0) {
    throw new RangeError('Нужны конечные координаты и непустая матрица');
  }
  const y = Math.max(0, Math.min(matrix.rows - 1, row));
  const x = Math.max(0, Math.min(matrix.columns - 1, column));
  const y0 = Math.floor(y), x0 = Math.floor(x);
  const y1 = Math.min(matrix.rows - 1, y0 + 1);
  const x1 = Math.min(matrix.columns - 1, x0 + 1);
  const fy = y - y0, fx = x - x0;
  return (matrix.get(y0, x0) * (1 - fx) + matrix.get(y0, x1) * fx) * (1 - fy) +
    (matrix.get(y1, x0) * (1 - fx) + matrix.get(y1, x1) * fx) * fy;
}

export function normalizeMinMax(matrix: DenseMatrix): DenseMatrix {
  if (matrix.rows * matrix.columns === 0) return matrix.toContiguous();
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let row = 0; row < matrix.rows; row += 1) {
    for (let column = 0; column < matrix.columns; column += 1) {
      const value = matrix.get(row, column);
      if (!Number.isFinite(value)) throw new TypeError('Матрица содержит NaN или бесконечность');
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  const result = DenseMatrix.zeros(matrix.rows, matrix.columns, new Float64Array());
  const scale = maximum - minimum;
  if (!Number.isFinite(scale)) throw new RangeError('Переполнение диапазона нормализации');
  for (let row = 0; row < matrix.rows; row += 1) {
    for (let column = 0; column < matrix.columns; column += 1) {
      result.values[row * matrix.columns + column] =
        scale === 0 ? 0 : (matrix.get(row, column) - minimum) / scale;
    }
  }
  return result;
}

export function seededMatrix(rows: number, columns: number, seed: number): DenseMatrix {
  validateShape(rows, columns);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new RangeError('Seed должен быть uint32');
  }
  let state = (seed >>> 0) || 0x6d2b79f5;
  const values = new Float64Array(rows * columns);
  for (let index = 0; index < values.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    values[index] = (state >>> 0) / 0x1_0000_0000;
  }
  return new DenseMatrix(values, rows, columns);
}

export function sampleWithSeed(
  values: Float32Array | Float64Array,
  count: number,
  seed: number,
): Float32Array | Float64Array {
  validateShape(count, values.length === 0 ? 0 : 1);
  assertFinite(values);
  if (values.length === 0 && count !== 0) throw new RangeError('Нельзя выбирать из пустой выборки');
  const source = new DenseMatrix(values, 1, values.length);
  const random = seededMatrix(1, count, seed).values;
  const output = new (values.constructor as FloatArrayConstructor)(count);
  for (let index = 0; index < count; index += 1) {
    output[index] = source.get(0, Math.floor(random[index] * values.length));
  }
  return output;
}

function combineBatch(batch: MatrixBatch): KernelMatrixScalar {
  const ctor = batch.matrices[0].values.constructor as MatrixValuesConstructor;
  const result = new ctor(batch.matrices.length * batch.rows * batch.columns);
  batch.matrices.forEach((matrix, index) => {
    result.set(matrix.toContiguous().values, index * batch.rows * batch.columns);
  });
  if (!(result instanceof Float32Array || result instanceof Float64Array)) {
    throw new TypeError('Умножение пакетов принимает только float32 и float64');
  }
  return result;
}

function checkedValue(values: MatrixValues, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Переполнение при записи элемента матрицы');
  if (values instanceof Float32Array) {
    if (!Number.isFinite(Math.fround(value))) throw new RangeError('Переполнение float32');
    return Math.fround(value);
  }
  if (values instanceof Float64Array) return value;
  if (!Number.isInteger(value)) throw new TypeError('Целочисленная матрица не принимает дробные значения');
  if (values instanceof Uint8Array && (value < 0 || value > 0xff) ||
      values instanceof Uint16Array && (value < 0 || value > 0xffff) ||
      values instanceof Uint32Array && (value < 0 || value > 0xffff_ffff) ||
      values instanceof Int32Array && (value < -0x8000_0000 || value > 0x7fff_ffff)) {
    throw new RangeError('Целое значение выходит за диапазон типа матрицы');
  }
  return value;
}

function validateShape(rows: number, columns: number): void {
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) ||
      rows < 0 || columns < 0 || rows > MAX_MATRIX_ELEMENTS ||
      columns > MAX_MATRIX_ELEMENTS || rows * columns > MAX_MATRIX_ELEMENTS) {
    throw new RangeError('Размеры матрицы должны быть неотрицательными целыми и укладываться в лимит памяти');
  }
}

function validateRange(start: number, end: number, limit: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end < start || end > limit) {
    throw new RangeError('Срез матрицы выходит за допустимый диапазон');
  }
}

function assertFinite(values: ArrayLike<number>): void {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) throw new TypeError('Массив содержит NaN или бесконечность');
  }
}
