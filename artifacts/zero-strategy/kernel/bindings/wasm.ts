import {
  KERNEL_ABI_VERSION,
  type KernelAffineOperation,
  type KernelBuffer,
  type KernelBufferType,
  type KernelContourSpan,
  type KernelContourRingData,
  type KernelContourScalarChunk,
  type KernelContourCompositionChunk,
  type KernelContourSpanOperation,
  type KernelPathData,
  type KernelPathFillRule,
  type KernelGeometryPrimitiveOperation,
  type KernelFlattenedPath,
  type KernelPolygonBooleanOperation,
  type KernelPolygonData,
  type KernelStrokeCap,
  type KernelStrokeJoin,
  type KernelMeasureOperation,
  type KernelMatrixOperation,
  type KernelMatrixFactorization,
  type KernelMatrixFactorizationResult,
  type KernelMatrixResult,
  type KernelMatrixScalar,
  type KernelPopulationMeasure,
  type KernelPopulationSplit,
  type KernelSetOperation,
  type KernelVectorOperation,
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
  _zk_measure_take_priority(
    sourceKeys: number, sourceMass: number, sourceCount: number,
    referenceKeys: number, referenceMass: number, referenceCount: number,
    priorityOrder: number, amount: number,
    selectedKeys: number, selectedMass: number, selectedCapacity: number, selectedCount: number,
    remainingKeys: number, remainingMass: number, remainingCapacity: number, remainingCount: number,
  ): number;
  _zk_measure_product(
    leftKeys: number, leftMass: number, leftCount: number,
    rightKeys: number, rightMass: number, rightCount: number,
    outputSources: number, productDivisor: number, multiplier: number, finalDivisor: number,
    divideByRightTotal: number, dropZeroMass: number, outputKeys: number, outputMass: number,
    outputCapacity: number, resultCount: number,
  ): number;
  _zk_algebra_query(
    request: number, requestLength: number,
    response: number, responseCapacity: number, responseLength: number,
  ): number;
  _zk_vector_execute(operation: number, input: number, inputCount: number,
    output: number, outputCapacity: number, outputCount: number): number;
  _zk_affine_execute(operation: number, input: number, inputCount: number,
    output: number, outputCapacity: number, outputCount: number): number;
  _zk_geometry_primitive_execute(operation: number, input: number,
    inputCount: number, output: number, outputCapacity: number,
    outputCount: number): number;
  _zk_contour_spans_execute(operation: number, left: number, leftCount: number,
    right: number, rightCount: number, width: number, height: number,
    distance: number, output: number, outputCapacity: number, outputCount: number): number;
  _zk_contour_replace_region(source: number, sourceCount: number,
    replacement: number, replacementCount: number, x0: number, y0: number,
    x1: number, y1: number, width: number, height: number, output: number,
    outputCapacity: number, outputCount: number): number;
  _zk_contour_rasterize_polygons(coordinates: number, pointCount: number,
    ringOffsets: number, ringCount: number, polygonOffsets: number,
    polygonCount: number, width: number, height: number, output: number,
    outputCapacity: number, outputCount: number): number;
  _zk_contour_link_rings(codes: number, codeCount: number, width: number,
    height: number, outputXY: number, pointCapacity: number,
    outputRingOffsets: number, ringCapacity: number,
    outputPointCount: number, outputRingCount: number): number;
  _zk_contour_trace_scalar_chunk(values: number, include: number,
    localPixelCount: number, sourceRowStart: number, processRowStart: number,
    processRowEnd: number, width: number, height: number, hasSkip: number,
    skipValue: number, outputValues: number, valueCapacity: number,
    outputOffsets: number, offsetCapacity: number, outputCodes: number,
    codeCapacity: number, outputGroupCount: number, outputCodeCount: number): number;
  _zk_contour_trace_composition_chunk(compositions: number, localPixelCount: number,
    compositionOffsets: number, compositionCount: number, entityIds: number,
    shares: number, entryCount: number, sourceRowStart: number,
    processRowStart: number, processRowEnd: number, width: number, height: number,
    outputEntities: number, outputShares: number, groupCapacity: number,
    outputOffsets: number, offsetCapacity: number, outputCodes: number,
    codeCapacity: number, outputGroupCount: number, outputCodeCount: number): number;
  _zk_contour_classify_spans(humidity: number, temperature: number,
    drainage: number, spans: number, spanCount: number, width: number,
    height: number, output: number, outputCapacity: number,
    outputCount: number): number;
  _zk_geometry_path_parse(svg: number, svgLength: number, commandTypes: number,
    typeCapacity: number, commandValues: number, valueCapacity: number,
    commandCount: number): number;
  _zk_geometry_path_serialize(commandTypes: number, commandValues: number,
    commandCount: number, output: number, outputCapacity: number,
    outputLength: number): number;
  _zk_geometry_path_transform(commandTypes: number, commandValues: number,
    commandCount: number, affine: number, tolerance: number,
    outputTypes: number, typeCapacity: number, outputValues: number,
    valueCapacity: number, outputCount: number): number;
  _zk_geometry_path_measure(operation: number, commandTypes: number,
    commandValues: number, commandCount: number, tolerance: number,
    output: number, outputCapacity: number, outputCount: number): number;
  _zk_geometry_path_flatten(commandTypes: number, commandValues: number,
    commandCount: number, tolerance: number, outputXY: number,
    pointCapacity: number, outputSubpathOffsets: number,
    subpathCapacity: number, outputClosed: number, closedCapacity: number,
    pointCount: number, subpathCount: number): number;
  _zk_geometry_path_intersections(firstTypes: number, firstValues: number,
    firstCount: number, secondTypes: number, secondValues: number,
    secondCount: number, tolerance: number, outputXY: number,
    pointCapacity: number, pointCount: number): number;
  _zk_geometry_path_to_polygons(commandTypes: number, commandValues: number,
    commandCount: number, tolerance: number, fillRule: number, outputXY: number,
    pointCapacity: number, ringOffsets: number, ringCapacity: number,
    polygonOffsets: number, polygonCapacity: number, pointCount: number,
    ringCount: number, polygonCount: number): number;
  _zk_geometry_polygon_boolean(operation: number, inputXY: number,
    inputPointCount: number, inputRingOffsets: number, inputRingCount: number,
    inputPolygonOffsets: number, inputPolygonCount: number,
    inputGeometryOffsets: number, inputGeometryCount: number, outputXY: number,
    pointCapacity: number, outputRingOffsets: number, ringCapacity: number,
    outputPolygonOffsets: number, polygonCapacity: number, pointCount: number,
    ringCount: number, polygonCount: number): number;
  _zk_geometry_stroke_polyline(inputXY: number, pointCount: number,
    width: number, tolerance: number, cap: number, join: number,
    miterLimit: number, closed: number, outputXY: number,
    pointCapacity: number, outputRingOffsets: number, ringCapacity: number,
    outputPolygonOffsets: number, polygonCapacity: number,
    outputPointCount: number, outputRingCount: number,
    outputPolygonCount: number): number;
  _zk_geometry_stroke_polyline(inputXY: number, pointCount: number,
    width: number, tolerance: number, cap: number, join: number,
    miterLimit: number, closed: number, outputXY: number,
    pointCapacity: number, outputRingOffsets: number, ringCapacity: number,
    outputPolygonOffsets: number, polygonCapacity: number,
    outputPointCount: number, outputRingCount: number,
    outputPolygonCount: number): number;
  _zk_matrix_execute(operation: number, type: number, left: number, leftRows: number,
    leftColumns: number, right: number, rightRows: number, rightColumns: number,
    output: number, outputCapacity: number, outputRows: number, outputColumns: number): number;
  _zk_matrix_label_components(mask: number, width: number, height: number,
    labels: number, outputCapacity: number, componentCount: number): number;
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
  inverse: 17, pseudoinverse: 18, solve: 19, minimum: 20, maximum: 21,
  logicalAnd: 22, logicalOr: 23, logicalXor: 24, equal: 25, lessThan: 26,
  reduceMin: 27, reduceMax: 28, seededRandom: 29, sampleIndices: 30,
  stencilZero: 31, stencilClamp: 32, bilinearInterpolate: 33,
};
const FACTORIZATION_IDS: Record<KernelMatrixFactorization, number> = {
  lu: 1, qr: 2, cholesky: 3, svd: 4, symmetricEigen: 5,
};
const VECTOR_OPERATION_IDS: Record<KernelVectorOperation, number> = {
  add: 1, subtract: 2, scale: 3, dot: 4, cross: 5,
  length: 6, distance: 7, normalize: 8, perpendicular: 9, lerp: 10,
};
const AFFINE_OPERATION_IDS: Record<KernelAffineOperation, number> = {
  identity: 1, create: 2, translation: 3, scaling: 4,
  rotation: 5, multiply: 6, invert: 7, apply: 8,
};
const GEOMETRY_PRIMITIVE_OPERATION_IDS: Record<KernelGeometryPrimitiveOperation, number> = {
  boundsOfPoints: 1, boundsDistance: 2, boundsIntersect: 3, boundsCircle: 4,
  closestPointSegment: 5, distanceSegment: 6, segmentLength: 7, segmentTangent: 8,
  intersectSegments: 9, polylineLength: 10, closestPointPolyline: 11,
  polylineIntersections: 12, quadraticAt: 13, cubicAt: 14, quadraticTangent: 15,
  cubicTangent: 16, circleIntersections: 17, circleSegmentIntersections: 18,
  distanceCircleBoundary: 19, closestPointCircleBoundary: 20, pointInRing: 21,
  ringSignedArea: 22, arcParameters: 23, arcAt: 24, arcTangent: 25,
  nearestSpatial: 26, nearestPoints: 27, gridPathSamples: 28,
  gridPathWeightedSum: 29, circlePoints: 30, clipPolygonRect: 31,
};
const CONTOUR_SPAN_OPERATION_IDS: Record<KernelContourSpanOperation, number> = {
  normalize: 1, intersection: 2, union: 3, difference: 4, border: 5, offset: 6,
};
const PATH_MEASURE_OPERATION_IDS = { length: 1, bounds: 2 } as const;
const FILL_RULE_IDS: Record<KernelPathFillRule, number> = { evenodd: 1, nonzero: 2 };
const POLYGON_BOOLEAN_OPERATION_IDS: Record<KernelPolygonBooleanOperation, number> = {
  union: 1, intersection: 2, difference: 3, xor: 4,
};
const STROKE_CAP_IDS: Record<KernelStrokeCap, number> = {
  butt: 1, square: 2, round: 3,
};
const STROKE_JOIN_IDS: Record<KernelStrokeJoin, number> = {
  miter: 1, bevel: 2, round: 3,
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
    algebraQuery(request: string): string {
      if (typeof request !== 'string') {
        throw new TypeError('Запрос бинарной алгебры должен быть строкой');
      }
      const inputBytes = new TextEncoder().encode(request);
      validateKernelBytes(inputBytes.byteLength, 4);
      const inputPointer = module._malloc(inputBytes.byteLength || 1);
      const lengthPointer = module._malloc(4);
      if (!inputPointer || !lengthPointer) {
        if (inputPointer) module._free(inputPointer);
        if (lengthPointer) module._free(lengthPointer);
        throw new Error('Недостаточно памяти для запроса бинарной алгебры');
      }
      module.HEAPU8.set(inputBytes, inputPointer);
      let outputCapacity = Math.min(
        Math.max(1024, inputBytes.byteLength * 2 + 1024),
        MAX_KERNEL_BYTES - inputBytes.byteLength - 8,
      );
      let outputPointer = 0;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          validateKernelBytes(inputBytes.byteLength, outputCapacity, 8);
          outputPointer = module._malloc(Math.max(1, outputCapacity));
          if (!outputPointer) {
            throw new Error('Недостаточно памяти для результата бинарной алгебры');
          }
          const status = module._zk_algebra_query(
            inputPointer,
            inputBytes.byteLength,
            outputPointer,
            outputCapacity,
            lengthPointer,
          );
          const outputLength = module.HEAPU32[lengthPointer >>> 2];
          if (status === 6 && outputLength > outputCapacity) {
            module._free(outputPointer);
            outputPointer = 0;
            outputCapacity = outputLength;
            continue;
          }
          checkError(status);
          if (outputLength > outputCapacity) {
            throw new Error('Ядро вернуло недопустимый размер результата алгебры');
          }
          const outputBytes = module.HEAPU8.slice(
            outputPointer,
            outputPointer + outputLength,
          );
          return new TextDecoder().decode(outputBytes);
        }
        throw new Error('Не удалось выделить рабочую область результата алгебры');
      } finally {
        if (outputPointer) module._free(outputPointer);
        module._free(lengthPointer);
        module._free(inputPointer);
      }
    },
    takePopulationMeasure(
      source: KernelPopulationMeasure,
      reference: KernelPopulationMeasure,
      priorityOrder: Uint32Array,
      amount: number,
    ): KernelPopulationSplit {
      return runMeasureTake(source, reference, priorityOrder, amount, this.createBuffer);
    },
    measureProduct(
      left: KernelPopulationMeasure,
      right: KernelPopulationMeasure,
      outputSources: Uint32Array,
      productDivisor: number,
      multiplier: number,
      finalDivisor: number,
      divideByRightTotal: boolean,
      dropZeroMass: boolean,
    ): KernelPopulationMeasure {
      return runMeasureProduct(
        left, right, outputSources, productDivisor, multiplier, finalDivisor, divideByRightTotal,
        dropZeroMass, this.createBuffer,
      );
    },
    labelGridComponents(mask: Uint8Array, width: number, height: number): Int32Array {
      return runLabelGridComponents(mask, width, height);
    },
    vectorExecute(operation: KernelVectorOperation, input: Float64Array): Float64Array {
      return runNumericOperation(
        module._zk_vector_execute,
        VECTOR_OPERATION_IDS[operation],
        input,
        2,
      );
    },
    affineExecute(operation: KernelAffineOperation, input: Float64Array): Float64Array {
      return runNumericOperation(
        module._zk_affine_execute,
        AFFINE_OPERATION_IDS[operation],
        input,
        6,
      );
    },
    geometryPrimitiveExecute(
      operation: KernelGeometryPrimitiveOperation,
      input: Float64Array,
    ): Float64Array {
      return runGeometryPrimitive(operation, input);
    },
    contourSpansExecute(
      operation: KernelContourSpanOperation,
      left: readonly KernelContourSpan[],
      right: readonly KernelContourSpan[],
      width: number,
      height: number,
      distance = 0,
    ): KernelContourSpan[] {
      return runContourSpans(operation, left, right, width, height, distance);
    },
    contourReplaceRegion(
      source: readonly KernelContourSpan[],
      replacement: readonly KernelContourSpan[],
      bounds: { x0: number; y0: number; x1: number; y1: number },
      width: number,
      height: number,
    ): KernelContourSpan[] {
      return runContourReplaceRegion(source, replacement, bounds, width, height);
    },
    contourRasterizePolygons(
      polygons: KernelPolygonData,
      width: number,
      height: number,
    ): KernelContourSpan[] {
      return runContourRasterizePolygons(polygons, width, height);
    },
    contourLinkRings(
      codes: Uint32Array,
      width: number,
      height: number,
    ): KernelContourRingData {
      return runContourLinkRings(codes, width, height);
    },
    contourTraceScalarChunk(
      values: Float64Array,
      include: Uint8Array | null,
      sourceRowStart: number,
      processRowStart: number,
      processRowEnd: number,
      width: number,
      height: number,
      skip: number | null,
    ): KernelContourScalarChunk {
      return runContourTraceScalarChunk(
        values,
        include,
        sourceRowStart,
        processRowStart,
        processRowEnd,
        width,
        height,
        skip,
      );
    },
    contourTraceCompositionChunk(
      compositions: Uint16Array,
      compositionOffsets: Uint32Array,
      entityIds: Uint32Array,
      shares: Float64Array,
      sourceRowStart: number,
      processRowStart: number,
      processRowEnd: number,
      width: number,
      height: number,
    ): KernelContourCompositionChunk {
      return runContourTraceCompositionChunk(
        compositions,
        compositionOffsets,
        entityIds,
        shares,
        sourceRowStart,
        processRowStart,
        processRowEnd,
        width,
        height,
      );
    },
    contourClassifySpans(
      humidity: Uint8Array,
      temperature: Float32Array,
      drainage: Uint8Array,
      spans: readonly KernelContourSpan[],
      width: number,
      height: number,
    ): Float64Array {
      return runContourClassifySpans(humidity, temperature, drainage, spans, width, height);
    },
    pathParse(svg: string): KernelPathData {
      return runPathParse(svg);
    },
    pathSerialize(path: KernelPathData): string {
      return runPathSerialize(path);
    },
    pathTransform(path: KernelPathData, affine: Float64Array, tolerance: number): KernelPathData {
      return runPathTransform(path, affine, tolerance);
    },
    pathMeasure(
      operation: 'length' | 'bounds',
      path: KernelPathData,
      tolerance: number,
    ): Float64Array {
      return runPathMeasure(operation, path, tolerance);
    },
    pathFlatten(path: KernelPathData, tolerance: number): KernelFlattenedPath {
      return runPathFlatten(path, tolerance);
    },
    pathIntersections(
      first: KernelPathData,
      second: KernelPathData,
      tolerance: number,
    ): Float64Array {
      return runPathIntersections(first, second, tolerance);
    },
    pathToPolygons(
      path: KernelPathData,
      tolerance: number,
      fillRule: KernelPathFillRule,
    ): KernelPolygonData {
      return runPathToPolygons(path, tolerance, fillRule);
    },
    polygonBoolean(
      operation: KernelPolygonBooleanOperation,
      inputs: readonly KernelPolygonData[],
    ): KernelPolygonData {
      return runPolygonBoolean(operation, inputs);
    },
    strokePolyline(
      coordinates: Float64Array,
      width: number,
      tolerance: number,
      cap: KernelStrokeCap,
      join: KernelStrokeJoin,
      miterLimit: number,
      closed: boolean,
    ): KernelPolygonData {
      return runStrokePolyline(
        coordinates, width, tolerance, cap, join, miterLimit, closed,
      );
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

  function runMeasureTake(
    source: KernelPopulationMeasure,
    reference: KernelPopulationMeasure,
    priorityOrder: Uint32Array,
    amount: number,
    allocate: <T extends ArrayBufferView>(type: KernelBufferType, count: number) => KernelBuffer<T>,
  ): KernelPopulationSplit {
    validateMeasure(source);
    validateMeasure(reference);
    if (!(priorityOrder instanceof Uint32Array) || priorityOrder.length !== 3 ||
        new Set(priorityOrder).size !== 3 || [...priorityOrder].some((tier) => tier > 2)) {
      throw new RangeError('Приоритетные слои населения должны быть перестановкой трёх рангов.');
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError('Количество населения должно быть конечным и неотрицательным.');
    }
    if (!source.mass.length) {
      return {
        selected: { keys: new Uint32Array(0), mass: new Float64Array(0) },
        remaining: { keys: new Uint32Array(0), mass: new Float64Array(0) },
      };
    }
    const capacity = source.mass.length;
    validateCount(capacity);
    const buffers: KernelBuffer<ArrayBufferView>[] = [];
    const resultPointer = module._malloc(8);
    if (!resultPointer) throw new Error('Не удалось выделить память для результата распределения меры');
    try {
      const sourceKeys = allocate<Uint32Array>('u32', source.keys.length);
      buffers.push(sourceKeys); sourceKeys.view.set(source.keys);
      const sourceMass = allocate<Float64Array>('f64', source.mass.length);
      buffers.push(sourceMass); sourceMass.view.set(source.mass);
      const referenceKeys = allocate<Uint32Array>('u32', reference.keys.length);
      buffers.push(referenceKeys); referenceKeys.view.set(reference.keys);
      const referenceMass = allocate<Float64Array>('f64', reference.mass.length);
      buffers.push(referenceMass); referenceMass.view.set(reference.mass);
      const priorities = allocate<Uint32Array>('u32', priorityOrder.length);
      buffers.push(priorities); priorities.view.set(priorityOrder);
      const selectedKeys = allocate<Uint32Array>('u32', capacity * 4);
      buffers.push(selectedKeys);
      const selectedMass = allocate<Float64Array>('f64', capacity);
      buffers.push(selectedMass);
      const remainingKeys = allocate<Uint32Array>('u32', capacity * 4);
      buffers.push(remainingKeys);
      const remainingMass = allocate<Float64Array>('f64', capacity);
      buffers.push(remainingMass);
      checkError(module._zk_measure_take_priority(
        sourceKeys.view.byteOffset, sourceMass.view.byteOffset, source.mass.length,
        referenceKeys.view.byteOffset, referenceMass.view.byteOffset, reference.mass.length,
        priorities.view.byteOffset, amount,
        selectedKeys.view.byteOffset, selectedMass.view.byteOffset, capacity, resultPointer,
        remainingKeys.view.byteOffset, remainingMass.view.byteOffset, capacity, resultPointer + 4,
      ));
      const selectedCount = module.HEAPU32[resultPointer >>> 2];
      const remainingCount = module.HEAPU32[(resultPointer + 4) >>> 2];
      if (selectedCount > capacity || remainingCount > capacity) {
        throw new Error('Ядро вернуло недопустимое число групп распределения');
      }
      return {
        selected: {
          keys: selectedKeys.view.slice(0, selectedCount * 4),
          mass: selectedMass.view.slice(0, selectedCount),
        },
        remaining: {
          keys: remainingKeys.view.slice(0, remainingCount * 4),
          mass: remainingMass.view.slice(0, remainingCount),
        },
      };
    } finally {
      module._free(resultPointer);
      buffers.forEach((buffer) => buffer.release());
    }
  }

  function runMeasureProduct(
    left: KernelPopulationMeasure,
    right: KernelPopulationMeasure,
    outputSources: Uint32Array,
    productDivisor: number,
    multiplier: number,
    finalDivisor: number,
    divideByRightTotal: boolean,
    dropZeroMass: boolean,
    allocate: <T extends ArrayBufferView>(type: KernelBufferType, count: number) => KernelBuffer<T>,
  ): KernelPopulationMeasure {
    validateMeasure(left);
    validateMeasure(right);
    if (!(outputSources instanceof Uint32Array) || outputSources.length !== 4 ||
        [...outputSources].some((source) => source > 8)) {
      throw new TypeError('Схема результата произведения должна содержать четыре источника ключей.');
    }
    if (!Number.isFinite(productDivisor) || productDivisor <= 0 ||
        !Number.isFinite(multiplier) || multiplier < 0 ||
        !Number.isFinite(finalDivisor) || finalDivisor <= 0 ||
        typeof divideByRightTotal !== 'boolean' || typeof dropZeroMass !== 'boolean') {
      throw new RangeError('Множители произведения меры должны быть конечными и допустимыми.');
    }
    const capacity = left.mass.length * right.mass.length;
    validateCount(capacity);
    validateKernelBytes(
      left.keys.byteLength, left.mass.byteLength,
      right.keys.byteLength, right.mass.byteLength,
      outputSources.byteLength,
      capacity * Uint32Array.BYTES_PER_ELEMENT * 4,
      capacity * Float64Array.BYTES_PER_ELEMENT,
    );
    if (!capacity) return { keys: new Uint32Array(0), mass: new Float64Array(0) };
    const buffers: KernelBuffer<ArrayBufferView>[] = [];
    const resultPointer = module._malloc(4);
    if (!resultPointer) throw new Error('Не удалось выделить память для результата произведения меры');
    try {
      const leftKeys = allocate<Uint32Array>('u32', left.keys.length);
      buffers.push(leftKeys); leftKeys.view.set(left.keys);
      const leftMass = allocate<Float64Array>('f64', left.mass.length);
      buffers.push(leftMass); leftMass.view.set(left.mass);
      const rightKeys = allocate<Uint32Array>('u32', right.keys.length);
      buffers.push(rightKeys); rightKeys.view.set(right.keys);
      const rightMass = allocate<Float64Array>('f64', right.mass.length);
      buffers.push(rightMass); rightMass.view.set(right.mass);
      const sources = allocate<Uint32Array>('u32', outputSources.length);
      buffers.push(sources); sources.view.set(outputSources);
      const outputKeys = allocate<Uint32Array>('u32', capacity * 4);
      buffers.push(outputKeys);
      const outputMass = allocate<Float64Array>('f64', capacity);
      buffers.push(outputMass);
      checkError(module._zk_measure_product(
        leftKeys.view.byteOffset, leftMass.view.byteOffset, left.mass.length,
        rightKeys.view.byteOffset, rightMass.view.byteOffset, right.mass.length,
        sources.view.byteOffset, productDivisor, multiplier, finalDivisor,
        divideByRightTotal ? 1 : 0,
        dropZeroMass ? 1 : 0,
        outputKeys.view.byteOffset, outputMass.view.byteOffset, capacity, resultPointer,
      ));
      const count = module.HEAPU32[resultPointer >>> 2];
      if (count > capacity) throw new Error('Ядро вернуло недопустимый размер произведения меры');
      return {
        keys: outputKeys.view.slice(0, count * 4),
        mass: outputMass.view.slice(0, count),
      };
    } finally {
      module._free(resultPointer);
      buffers.forEach((buffer) => buffer.release());
    }
  }

  function runNumericOperation(
    execute: EmscriptenKernelModule['_zk_vector_execute'] | EmscriptenKernelModule['_zk_affine_execute'],
    operation: number,
    input: Float64Array,
    maximumOutput: number,
  ): Float64Array {
    if (!(input instanceof Float64Array) || input.some((value) => !Number.isFinite(value))) {
      throw new TypeError('Геометрические данные должны быть конечным массивом float64');
    }
    validateKernelBytes(input.byteLength, maximumOutput * Float64Array.BYTES_PER_ELEMENT);
    const inputPointer = module._malloc(input.byteLength || 1);
    const outputPointer = module._malloc(maximumOutput * Float64Array.BYTES_PER_ELEMENT);
    const countPointer = module._malloc(4);
    if (!inputPointer || !outputPointer || !countPointer) {
      if (inputPointer) module._free(inputPointer);
      if (outputPointer) module._free(outputPointer);
      if (countPointer) module._free(countPointer);
      throw new Error('Недостаточно памяти для геометрической операции');
    }
    try {
      module.HEAPU8.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength), inputPointer);
      checkError(execute(
        operation, inputPointer, input.length, outputPointer, maximumOutput, countPointer,
      ));
      const count = module.HEAPU32[countPointer >>> 2];
      if (count > maximumOutput) throw new Error('Ядро вернуло недопустимый размер геометрического результата');
      return new Float64Array(module.HEAPU8.buffer, outputPointer, count).slice();
    } finally {
      module._free(inputPointer);
      module._free(outputPointer);
      module._free(countPointer);
    }
  }

  function runGeometryPrimitive(
    operation: KernelGeometryPrimitiveOperation,
    input: Float64Array,
  ): Float64Array {
    if (!(input instanceof Float64Array) ||
        input.some((value) => !Number.isFinite(value))) {
      throw new TypeError('Геометрические данные должны быть конечным массивом float64');
    }
    validateKernelBytes(input.byteLength);
    const inputPointer = allocateBytes(input.byteLength);
    const countPointer = allocateBytes(4);
    if (!inputPointer || !countPointer) {
      if (inputPointer) module._free(inputPointer);
      if (countPointer) module._free(countPointer);
      throw new Error('Недостаточно памяти для геометрической операции');
    }
    try {
      if (input.length) {
        module.HEAPU8.set(
          new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
          inputPointer,
        );
      }
      const queryError = module._zk_geometry_primitive_execute(
        GEOMETRY_PRIMITIVE_OPERATION_IDS[operation],
        inputPointer, input.length, 0, 0, countPointer,
      );
      if (queryError !== 6) checkError(queryError);
      const count = module.HEAPU32[countPointer >>> 2];
      validateCount(count);
      const outputPointer = allocateBytes(count * 8);
      if (!outputPointer) throw new Error('Недостаточно памяти для результата геометрии');
      try {
        checkError(module._zk_geometry_primitive_execute(
          GEOMETRY_PRIMITIVE_OPERATION_IDS[operation],
          inputPointer, input.length, outputPointer, count, countPointer,
        ));
        return new Float64Array(module.HEAPU8.buffer, outputPointer, count).slice();
      } finally {
        module._free(outputPointer);
      }
    } finally {
      module._free(inputPointer);
      module._free(countPointer);
    }
  }

  function runContourSpans(
    operation: KernelContourSpanOperation,
    left: readonly KernelContourSpan[],
    right: readonly KernelContourSpan[],
    width: number,
    height: number,
    distance: number,
  ): KernelContourSpan[] {
    validateRaster(width, height);
    if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Расстояние должно быть неотрицательным');
    if (operation === 'normalize') {
      validateSpanRecords(left);
      validateSpanRecords(right);
    } else {
      validateSpans(left);
      validateSpans(right);
    }
    const leftValues = flattenSpans(left);
    const rightValues = flattenSpans(right);
    let outputCapacity = Math.max(16, left.length + right.length);
    if (operation === 'border') outputCapacity = Math.max(outputCapacity, left.length * 3);
    if (operation === 'offset') {
      outputCapacity = Math.max(outputCapacity, left.length * Math.min(height, Math.ceil(distance * 2 + 1)));
    }
    const limit = Math.floor(MAX_KERNEL_BYTES / (3 * Int32Array.BYTES_PER_ELEMENT));
    outputCapacity = Math.min(limit, outputCapacity);
    const leftPointer = allocateBytes(leftValues.byteLength);
    const rightPointer = allocateBytes(rightValues.byteLength);
    const countPointer = allocateBytes(4);
    if (!leftPointer || !rightPointer || !countPointer) {
      if (leftPointer) module._free(leftPointer);
      if (rightPointer) module._free(rightPointer);
      if (countPointer) module._free(countPointer);
      throw new Error('Недостаточно памяти для контурных интервалов');
    }
    try {
      if (leftValues.length) module.HEAPU8.set(new Uint8Array(leftValues.buffer), leftPointer);
      if (rightValues.length) module.HEAPU8.set(new Uint8Array(rightValues.buffer), rightPointer);
      for (;;) {
        const outputPointer = allocateBytes(outputCapacity * 3 * Int32Array.BYTES_PER_ELEMENT);
        if (!outputPointer) throw new Error('Недостаточно памяти для результата контуров');
        try {
          const error = module._zk_contour_spans_execute(
            CONTOUR_SPAN_OPERATION_IDS[operation], leftPointer, left.length,
            rightPointer, right.length, width, height, distance,
            outputPointer, outputCapacity, countPointer,
          );
          if (error === 6 && outputCapacity < limit) {
            outputCapacity = Math.min(limit, Math.max(outputCapacity + 1, outputCapacity * 2));
            continue;
          }
          checkError(error);
          const count = module.HEAPU32[countPointer >>> 2];
          if (count > outputCapacity) throw new Error('Ядро вернуло недопустимое число контуров');
          const values = new Int32Array(module.HEAPU8.buffer, outputPointer, count * 3);
          return Array.from({ length: count }, (_, index) => ({
            y: values[index * 3],
            start: values[index * 3 + 1],
            end: values[index * 3 + 2],
          }));
        } finally {
          module._free(outputPointer);
        }
      }
    } finally {
      module._free(leftPointer);
      module._free(rightPointer);
      module._free(countPointer);
    }
  }

  function runContourReplaceRegion(
    source: readonly KernelContourSpan[],
    replacement: readonly KernelContourSpan[],
    bounds: { x0: number; y0: number; x1: number; y1: number },
    width: number,
    height: number,
  ): KernelContourSpan[] {
    validateRaster(width, height);
    validateSpans(source);
    validateSpans(replacement);
    for (const value of [bounds?.x0, bounds?.y0, bounds?.x1, bounds?.y1]) {
      if (!Number.isSafeInteger(value)) throw new TypeError('Границы замены контура должны быть целыми числами');
    }
    const nativeBounds = {
      x0: Math.max(-1, Math.min(width, bounds.x0)),
      y0: Math.max(-1, Math.min(height, bounds.y0)),
      x1: Math.max(-1, Math.min(width, bounds.x1)),
      y1: Math.max(-1, Math.min(height, bounds.y1)),
    };
    const sourceValues = flattenSpans(source);
    const replacementValues = flattenSpans(replacement);
    const sourcePointer = sourceValues.byteLength ? allocateBytes(sourceValues.byteLength) : 0;
    const replacementPointer = replacementValues.byteLength
      ? allocateBytes(replacementValues.byteLength)
      : 0;
    const countPointer = allocateBytes(4);
    if ((sourceValues.byteLength && !sourcePointer) ||
        (replacementValues.byteLength && !replacementPointer) || !countPointer) {
      if (sourcePointer) module._free(sourcePointer);
      if (replacementPointer) module._free(replacementPointer);
      if (countPointer) module._free(countPointer);
      throw new Error('Недостаточно памяти для замены контурной области');
    }
    try {
      if (sourcePointer) {
        module.HEAPU8.set(
          new Uint8Array(sourceValues.buffer, sourceValues.byteOffset, sourceValues.byteLength),
          sourcePointer,
        );
      }
      if (replacementPointer) {
        module.HEAPU8.set(
          new Uint8Array(
            replacementValues.buffer,
            replacementValues.byteOffset,
            replacementValues.byteLength,
          ),
          replacementPointer,
        );
      }
      const invoke = (output: number, capacity: number) =>
        module._zk_contour_replace_region(
          sourcePointer,
          source.length,
          replacementPointer,
          replacement.length,
          nativeBounds.x0,
          nativeBounds.y0,
          nativeBounds.x1,
          nativeBounds.y1,
          width,
          height,
          output,
          capacity,
          countPointer,
        );
      const limit = Math.floor(MAX_KERNEL_BYTES / (3 * Int32Array.BYTES_PER_ELEMENT));
      let outputCapacity = Math.min(
        limit,
        Math.max(16, source.length * 2 + replacement.length),
      );
      for (;;) {
        const outputPointer = allocateBytes(outputCapacity * 3 * Int32Array.BYTES_PER_ELEMENT);
        if (!outputPointer) throw new Error('Недостаточно памяти для результата замены контуров');
        try {
          const error = invoke(outputPointer, outputCapacity);
          if (error === 6 && outputCapacity < limit) {
            outputCapacity = Math.min(limit, Math.max(outputCapacity + 1, outputCapacity * 2));
            continue;
          }
          checkError(error);
          const count = module.HEAPU32[countPointer >>> 2];
          if (count > outputCapacity) throw new Error('Ядро вернуло недопустимое число контуров');
          const values = new Int32Array(module.HEAPU8.buffer, outputPointer, count * 3);
          return Array.from({ length: count }, (_, index) => ({
            y: values[index * 3],
            start: values[index * 3 + 1],
            end: values[index * 3 + 2],
          }));
        } finally {
          module._free(outputPointer);
        }
      }
    } finally {
      if (sourcePointer) module._free(sourcePointer);
      if (replacementPointer) module._free(replacementPointer);
      module._free(countPointer);
    }
  }

  function runContourRasterizePolygons(
    polygons: KernelPolygonData,
    width: number,
    height: number,
  ): KernelContourSpan[] {
    validateRaster(width, height);
    if (!polygons || !(polygons.coordinates instanceof Float64Array) ||
        !(polygons.ringOffsets instanceof Uint32Array) ||
        !(polygons.polygonOffsets instanceof Uint32Array) ||
        polygons.coordinates.length % 2 !== 0 ||
        polygons.ringOffsets.length === 0 ||
        polygons.polygonOffsets.length === 0 ||
        polygons.coordinates.some((value) => !Number.isFinite(value))) {
      throw new TypeError('Полигоны растра содержат неверные бинарные данные');
    }
    const pointCount = polygons.coordinates.length / 2;
    const ringCount = polygons.ringOffsets.length - 1;
    const polygonCount = polygons.polygonOffsets.length - 1;
    if (polygons.ringOffsets[0] !== 0 ||
        polygons.ringOffsets[ringCount] !== pointCount ||
        polygons.polygonOffsets[0] !== 0 ||
        polygons.polygonOffsets[polygonCount] !== ringCount) {
      throw new TypeError('Смещения полигонов растра не согласованы с координатами');
    }
    const coordinatesPointer = polygons.coordinates.byteLength
      ? allocateBytes(polygons.coordinates.byteLength)
      : 0;
    const ringOffsetsPointer = polygons.ringOffsets.byteLength
      ? allocateBytes(polygons.ringOffsets.byteLength)
      : 0;
    const polygonOffsetsPointer = polygons.polygonOffsets.byteLength
      ? allocateBytes(polygons.polygonOffsets.byteLength)
      : 0;
    const countPointer = allocateBytes(4);
    if ((polygons.coordinates.byteLength && !coordinatesPointer) ||
        (polygons.ringOffsets.byteLength && !ringOffsetsPointer) ||
        (polygons.polygonOffsets.byteLength && !polygonOffsetsPointer) ||
        !countPointer) {
      if (coordinatesPointer) module._free(coordinatesPointer);
      if (ringOffsetsPointer) module._free(ringOffsetsPointer);
      if (polygonOffsetsPointer) module._free(polygonOffsetsPointer);
      if (countPointer) module._free(countPointer);
      throw new Error('Недостаточно памяти для подготовки полигона к растрированию');
    }
    try {
      if (coordinatesPointer) {
        module.HEAPU8.set(
          new Uint8Array(
            polygons.coordinates.buffer,
            polygons.coordinates.byteOffset,
            polygons.coordinates.byteLength,
          ),
          coordinatesPointer,
        );
      }
      if (ringOffsetsPointer) {
        module.HEAPU8.set(
          new Uint8Array(
            polygons.ringOffsets.buffer,
            polygons.ringOffsets.byteOffset,
            polygons.ringOffsets.byteLength,
          ),
          ringOffsetsPointer,
        );
      }
      if (polygonOffsetsPointer) {
        module.HEAPU8.set(
          new Uint8Array(
            polygons.polygonOffsets.buffer,
            polygons.polygonOffsets.byteOffset,
            polygons.polygonOffsets.byteLength,
          ),
          polygonOffsetsPointer,
        );
      }
      const invoke = (output: number, capacity: number) =>
        module._zk_contour_rasterize_polygons(
          coordinatesPointer, pointCount, ringOffsetsPointer, ringCount,
          polygonOffsetsPointer, polygonCount, width, height,
          output, capacity, countPointer,
        );
      const queryError = invoke(0, 0);
      if (queryError !== 6) checkError(queryError);
      const count = module.HEAPU32[countPointer >>> 2];
      validateCount(count);
      if (!count) return [];
      const outputPointer = allocateBytes(count * 3 * Int32Array.BYTES_PER_ELEMENT);
      if (!outputPointer) throw new Error('Недостаточно памяти для результатов растрирования');
      try {
        checkError(invoke(outputPointer, count));
        const values = new Int32Array(module.HEAPU8.buffer, outputPointer, count * 3);
        return Array.from({ length: count }, (_, index) => ({
          y: values[index * 3],
          start: values[index * 3 + 1],
          end: values[index * 3 + 2],
        }));
      } finally {
        module._free(outputPointer);
      }
    } finally {
      if (coordinatesPointer) module._free(coordinatesPointer);
      if (ringOffsetsPointer) module._free(ringOffsetsPointer);
      if (polygonOffsetsPointer) module._free(polygonOffsetsPointer);
      module._free(countPointer);
    }
  }

  function runContourLinkRings(
    codes: Uint32Array,
    width: number,
    height: number,
  ): KernelContourRingData {
    validateRaster(width, height);
    if (!(codes instanceof Uint32Array)) {
      throw new TypeError('Коды рёбер контуров должны быть Uint32Array');
    }
    validateCount(codes.length * 2);
    validateCount(codes.length + 1);
    const codesPointer = codes.byteLength ? allocateBytes(codes.byteLength) : 0;
    const pointPointer = codes.length
      ? allocateBytes(codes.length * 2 * Int32Array.BYTES_PER_ELEMENT)
      : 0;
    const offsetsPointer = allocateBytes(
      (codes.length + 1) * Uint32Array.BYTES_PER_ELEMENT,
    );
    const pointCountPointer = allocateBytes(Uint32Array.BYTES_PER_ELEMENT);
    const ringCountPointer = allocateBytes(Uint32Array.BYTES_PER_ELEMENT);
    const pointers = [
      ...(codes.byteLength ? [codesPointer] : []),
      ...(codes.length ? [pointPointer] : []),
      offsetsPointer,
      pointCountPointer,
      ringCountPointer,
    ];
    if (pointers.some((pointer) => !pointer)) {
      for (const pointer of pointers) if (pointer) module._free(pointer);
      throw new Error('Недостаточно памяти для подготовки рёбер контуров');
    }
    try {
      if (codesPointer) {
        module.HEAPU8.set(
          new Uint8Array(codes.buffer, codes.byteOffset, codes.byteLength),
          codesPointer,
        );
      }
      checkError(module._zk_contour_link_rings(
        codesPointer,
        codes.length,
        width,
        height,
        pointPointer,
        codes.length,
        offsetsPointer,
        codes.length + 1,
        pointCountPointer,
        ringCountPointer,
      ));
      const pointCount = module.HEAPU32[pointCountPointer >>> 2];
      const ringCount = module.HEAPU32[ringCountPointer >>> 2];
      if (pointCount > codes.length || ringCount > codes.length) {
        throw new Error('Ядро вернуло недопустимое число вершин колец');
      }
      const coordinates = new Int32Array(pointCount * 2);
      if (pointCount) {
        coordinates.set(new Int32Array(module.HEAPU8.buffer, pointPointer, pointCount * 2));
      }
      const ringOffsets = new Uint32Array(ringCount + 1);
      ringOffsets.set(
        new Uint32Array(module.HEAPU8.buffer, offsetsPointer, ringCount + 1),
      );
      return { coordinates, ringOffsets };
    } finally {
      for (const pointer of pointers) module._free(pointer);
    }
  }

  function runContourTraceScalarChunk(
    values: Float64Array,
    include: Uint8Array | null,
    sourceRowStart: number,
    processRowStart: number,
    processRowEnd: number,
    width: number,
    height: number,
    skip: number | null,
  ): KernelContourScalarChunk {
    validateRaster(width, height);
    if (!(values instanceof Float64Array) ||
        values.length % width !== 0 ||
        (include !== null && (!(include instanceof Uint8Array) ||
          include.length !== values.length))) {
      throw new TypeError('Скалярный блок и маска содержат несовместимые данные');
    }
    const localRows = values.length / width;
    const sourceRowEnd = sourceRowStart + localRows;
    if (!Number.isInteger(sourceRowStart) || sourceRowStart < 0 ||
        sourceRowEnd > height || !Number.isInteger(processRowStart) ||
        !Number.isInteger(processRowEnd) || processRowStart < sourceRowStart ||
        processRowEnd < processRowStart || processRowEnd > sourceRowEnd ||
        (skip !== null && !Number.isFinite(skip))) {
      throw new RangeError('Границы скалярного блока выходят за размеры растра');
    }
    const processRows = processRowEnd - processRowStart;
    const maxGroups = processRows * width;
    const maxCodes = maxGroups * 4;
    validateCount(maxGroups);
    validateCount(maxGroups + 1);
    validateCount(maxCodes);

    const valuesPointer = values.byteLength ? allocateBytes(values.byteLength) : 0;
    const includePointer = include?.byteLength ? allocateBytes(include.byteLength) : 0;
    const outputValuesPointer = maxGroups
      ? allocateBytes(maxGroups * Float64Array.BYTES_PER_ELEMENT)
      : 0;
    const outputOffsetsPointer = allocateBytes((maxGroups + 1) * Uint32Array.BYTES_PER_ELEMENT);
    const outputCodesPointer = maxCodes
      ? allocateBytes(maxCodes * Uint32Array.BYTES_PER_ELEMENT)
      : 0;
    const groupCountPointer = allocateBytes(Uint32Array.BYTES_PER_ELEMENT);
    const codeCountPointer = allocateBytes(Uint32Array.BYTES_PER_ELEMENT);
    const pointers = [
      ...(values.byteLength ? [valuesPointer] : []),
      ...(include?.byteLength ? [includePointer] : []),
      ...(maxGroups ? [outputValuesPointer] : []),
      outputOffsetsPointer,
      ...(maxCodes ? [outputCodesPointer] : []),
      groupCountPointer,
      codeCountPointer,
    ];
    if (pointers.some((pointer) => !pointer)) {
      for (const pointer of pointers) if (pointer) module._free(pointer);
      throw new Error('Недостаточно памяти для контурного блока');
    }
    try {
      if (valuesPointer) {
        module.HEAPU8.set(
          new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
          valuesPointer,
        );
      }
      if (includePointer && include) {
        module.HEAPU8.set(
          new Uint8Array(include.buffer, include.byteOffset, include.byteLength),
          includePointer,
        );
      }
      checkError(module._zk_contour_trace_scalar_chunk(
        valuesPointer,
        includePointer,
        values.length,
        sourceRowStart,
        processRowStart,
        processRowEnd,
        width,
        height,
        skip === null ? 0 : 1,
        skip ?? 0,
        outputValuesPointer,
        maxGroups,
        outputOffsetsPointer,
        maxGroups + 1,
        outputCodesPointer,
        maxCodes,
        groupCountPointer,
        codeCountPointer,
      ));
      const groupCount = module.HEAPU32[groupCountPointer >>> 2];
      const codeCount = module.HEAPU32[codeCountPointer >>> 2];
      if (groupCount > maxGroups || codeCount > maxCodes) {
        throw new Error('Ядро вернуло недопустимые размеры контурного блока');
      }
      const outputValues = new Float64Array(groupCount);
      if (groupCount) {
        outputValues.set(new Float64Array(module.HEAPU8.buffer, outputValuesPointer, groupCount));
      }
      const outputOffsets = new Uint32Array(groupCount + 1);
      outputOffsets.set(
        new Uint32Array(module.HEAPU8.buffer, outputOffsetsPointer, groupCount + 1),
      );
      const outputCodes = new Uint32Array(codeCount);
      if (codeCount) {
        outputCodes.set(new Uint32Array(module.HEAPU8.buffer, outputCodesPointer, codeCount));
      }
      return { values: outputValues, offsets: outputOffsets, codes: outputCodes };
    } finally {
      for (const pointer of pointers) module._free(pointer);
    }
  }

  function runContourTraceCompositionChunk(
    compositions: Uint16Array,
    compositionOffsets: Uint32Array,
    entityIds: Uint32Array,
    shares: Float64Array,
    sourceRowStart: number,
    processRowStart: number,
    processRowEnd: number,
    width: number,
    height: number,
  ): KernelContourCompositionChunk {
    validateRaster(width, height);
    if (!(compositions instanceof Uint16Array) ||
        compositions.length % width !== 0 ||
        !(compositionOffsets instanceof Uint32Array) ||
        compositionOffsets.length < 2 ||
        !(entityIds instanceof Uint32Array) ||
        !(shares instanceof Float64Array) ||
        shares.length !== entityIds.length ||
        compositionOffsets[0] !== 0 ||
        compositionOffsets[compositionOffsets.length - 1] !== entityIds.length) {
      throw new TypeError('Растр смесей и таблица составов имеют несовместимые данные');
    }
    const compositionCount = compositionOffsets.length - 1;
    if (compositionCount > 65536) {
      throw new RangeError('Число смесей превышает диапазон Uint16');
    }
    let maxEntrySize = 0;
    for (let index = 0; index < compositionCount; index += 1) {
      const begin = compositionOffsets[index];
      const end = compositionOffsets[index + 1];
      if (end < begin || end > entityIds.length) {
        throw new TypeError('Смещения таблицы составов должны возрастать');
      }
      maxEntrySize = Math.max(maxEntrySize, end - begin);
    }
    const localRows = compositions.length / width;
    const sourceRowEnd = sourceRowStart + localRows;
    if (!Number.isInteger(sourceRowStart) || sourceRowStart < 0 ||
        sourceRowEnd > height || !Number.isInteger(processRowStart) ||
        !Number.isInteger(processRowEnd) || processRowStart < sourceRowStart ||
        processRowEnd <= processRowStart || processRowEnd > sourceRowEnd ||
        (processRowStart > 0 && sourceRowStart === processRowStart) ||
        (processRowEnd < height && processRowEnd === sourceRowEnd)) {
      throw new RangeError('Границы блока смесей выходят за размеры растра');
    }
    const processRows = processRowEnd - processRowStart;
    const maxGroups = entityIds.length;
    const maxCodes = processRows * width * maxEntrySize * 4;
    validateCount(compositions.length);
    validateCount(compositionOffsets.length);
    validateCount(entityIds.length);
    validateCount(maxGroups + 1);
    validateCount(maxCodes);
    validateKernelBytes(
      compositions.byteLength,
      compositionOffsets.byteLength,
      entityIds.byteLength,
      shares.byteLength,
      maxGroups * Uint32Array.BYTES_PER_ELEMENT,
      maxGroups * Float64Array.BYTES_PER_ELEMENT,
      (maxGroups + 1) * Uint32Array.BYTES_PER_ELEMENT,
      maxCodes * Uint32Array.BYTES_PER_ELEMENT,
      2 * Uint32Array.BYTES_PER_ELEMENT,
    );

    const compositionsPointer = allocateBytes(compositions.byteLength);
    const compositionOffsetsPointer = allocateBytes(compositionOffsets.byteLength);
    const entityIdsPointer = entityIds.byteLength ? allocateBytes(entityIds.byteLength) : 0;
    const sharesPointer = shares.byteLength ? allocateBytes(shares.byteLength) : 0;
    const outputEntitiesPointer = maxGroups
      ? allocateBytes(maxGroups * Uint32Array.BYTES_PER_ELEMENT)
      : 0;
    const outputSharesPointer = maxGroups
      ? allocateBytes(maxGroups * Float64Array.BYTES_PER_ELEMENT)
      : 0;
    const outputOffsetsPointer = allocateBytes(
      (maxGroups + 1) * Uint32Array.BYTES_PER_ELEMENT,
    );
    const outputCodesPointer = maxCodes
      ? allocateBytes(maxCodes * Uint32Array.BYTES_PER_ELEMENT)
      : 0;
    const groupCountPointer = allocateBytes(Uint32Array.BYTES_PER_ELEMENT);
    const codeCountPointer = allocateBytes(Uint32Array.BYTES_PER_ELEMENT);
    const pointers = [
      compositionsPointer,
      compositionOffsetsPointer,
      ...(entityIds.byteLength ? [entityIdsPointer] : []),
      ...(shares.byteLength ? [sharesPointer] : []),
      ...(maxGroups ? [outputEntitiesPointer, outputSharesPointer] : []),
      outputOffsetsPointer,
      ...(maxCodes ? [outputCodesPointer] : []),
      groupCountPointer,
      codeCountPointer,
    ];
    if (pointers.some((pointer) => !pointer)) {
      for (const pointer of pointers) if (pointer) module._free(pointer);
      throw new Error('Недостаточно памяти для подготовки контуров смесей');
    }
    try {
      module.HEAPU8.set(
        new Uint8Array(compositions.buffer, compositions.byteOffset, compositions.byteLength),
        compositionsPointer,
      );
      module.HEAPU8.set(
        new Uint8Array(
          compositionOffsets.buffer,
          compositionOffsets.byteOffset,
          compositionOffsets.byteLength,
        ),
        compositionOffsetsPointer,
      );
      if (entityIdsPointer) {
        module.HEAPU8.set(
          new Uint8Array(entityIds.buffer, entityIds.byteOffset, entityIds.byteLength),
          entityIdsPointer,
        );
        module.HEAPU8.set(
          new Uint8Array(shares.buffer, shares.byteOffset, shares.byteLength),
          sharesPointer,
        );
      }
      checkError(module._zk_contour_trace_composition_chunk(
        compositionsPointer,
        compositions.length,
        compositionOffsetsPointer,
        compositionCount,
        entityIdsPointer,
        sharesPointer,
        entityIds.length,
        sourceRowStart,
        processRowStart,
        processRowEnd,
        width,
        height,
        outputEntitiesPointer,
        outputSharesPointer,
        maxGroups,
        outputOffsetsPointer,
        maxGroups + 1,
        outputCodesPointer,
        maxCodes,
        groupCountPointer,
        codeCountPointer,
      ));
      const groupCount = module.HEAPU32[groupCountPointer >>> 2];
      const codeCount = module.HEAPU32[codeCountPointer >>> 2];
      if (groupCount > maxGroups || codeCount > maxCodes) {
        throw new Error('Ядро вернуло недопустимые размеры контуров смесей');
      }
      const outputEntities = new Uint32Array(groupCount);
      const outputShares = new Float64Array(groupCount);
      if (groupCount) {
        outputEntities.set(
          new Uint32Array(module.HEAPU8.buffer, outputEntitiesPointer, groupCount),
        );
        outputShares.set(
          new Float64Array(module.HEAPU8.buffer, outputSharesPointer, groupCount),
        );
      }
      const outputOffsets = new Uint32Array(groupCount + 1);
      outputOffsets.set(
        new Uint32Array(module.HEAPU8.buffer, outputOffsetsPointer, groupCount + 1),
      );
      const outputCodes = new Uint32Array(codeCount);
      if (codeCount) {
        outputCodes.set(new Uint32Array(module.HEAPU8.buffer, outputCodesPointer, codeCount));
      }
      if (outputOffsets[0] !== 0 || outputOffsets[groupCount] !== codeCount) {
        throw new Error('Ядро вернуло некорректные смещения контуров смесей');
      }
      return {
        entities: outputEntities,
        values: outputShares,
        offsets: outputOffsets,
        codes: outputCodes,
      };
    } finally {
      for (const pointer of pointers) module._free(pointer);
    }
  }

  function runContourClassifySpans(
    humidity: Uint8Array,
    temperature: Float32Array,
    drainage: Uint8Array,
    spans: readonly KernelContourSpan[],
    width: number,
    height: number,
  ): Float64Array {
    validateRaster(width, height);
    const pixelCount = width * height;
    if (!(humidity instanceof Uint8Array) || humidity.length !== pixelCount ||
        !(temperature instanceof Float32Array) || temperature.length !== pixelCount ||
        !(drainage instanceof Uint8Array) || drainage.length !== pixelCount) {
      throw new TypeError('Климатические слои не совпадают с размерами растра');
    }
    validateSpans(spans);
    if (!spans.length) return new Float64Array();
    const spanValues = flattenSpans(spans);
    const humidityPointer = allocateBytes(humidity.byteLength);
    const temperaturePointer = allocateBytes(temperature.byteLength);
    const drainagePointer = allocateBytes(drainage.byteLength);
    const spansPointer = allocateBytes(spanValues.byteLength);
    const countPointer = allocateBytes(4);
    const pointers = [
      humidityPointer,
      temperaturePointer,
      drainagePointer,
      spansPointer,
      countPointer,
    ];
    if (pointers.some((pointer) => !pointer)) {
      for (const pointer of pointers) if (pointer) module._free(pointer);
      throw new Error('Недостаточно памяти для климатических контуров');
    }

    try {
      module.HEAPU8.set(humidity, humidityPointer);
      module.HEAPU8.set(
        new Uint8Array(temperature.buffer, temperature.byteOffset, temperature.byteLength),
        temperaturePointer,
      );
      module.HEAPU8.set(drainage, drainagePointer);
      module.HEAPU8.set(
        new Uint8Array(spanValues.buffer, spanValues.byteOffset, spanValues.byteLength),
        spansPointer,
      );
      const invoke = (output: number, capacity: number) =>
        module._zk_contour_classify_spans(
          humidityPointer,
          temperaturePointer,
          drainagePointer,
          spansPointer,
          spans.length,
          width,
          height,
          output,
          capacity,
          countPointer,
        );
      const queryError = invoke(0, 0);
      if (queryError !== 6) checkError(queryError);
      const count = module.HEAPU32[countPointer >>> 2];
      validateCount(count);
      if (!count) return new Float64Array();
      const outputPointer = allocateBytes(count * 6 * Float64Array.BYTES_PER_ELEMENT);
      if (!outputPointer) throw new Error('Недостаточно памяти для климатических контуров');
      try {
        checkError(invoke(outputPointer, count));
        return new Float64Array(module.HEAPU8.buffer, outputPointer, count * 6).slice();
      } finally {
        module._free(outputPointer);
      }
    } finally {
      for (const pointer of pointers) module._free(pointer);
    }
  }

  function runLabelGridComponents(
    mask: Uint8Array,
    width: number,
    height: number,
  ): Int32Array {
    if (!(mask instanceof Uint8Array) ||
        !Number.isSafeInteger(width) || width <= 0 ||
        !Number.isSafeInteger(height) || height <= 0 ||
        !Number.isSafeInteger(width * height) ||
        width * height !== mask.length) {
      throw new RangeError('Размеры матрицы компонентов не совпадают с маской');
    }
    const labels = new Int32Array(mask.length);
    const maskPointer = allocateBytes(mask.byteLength);
    const labelsPointer = allocateBytes(labels.byteLength);
    const countPointer = allocateBytes(4);
    if (!maskPointer || !labelsPointer || !countPointer) {
      if (maskPointer) module._free(maskPointer);
      if (labelsPointer) module._free(labelsPointer);
      if (countPointer) module._free(countPointer);
      throw new Error('Недостаточно памяти для разметки компонент матрицы');
    }
    try {
      module.HEAPU8.set(
        new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength),
        maskPointer,
      );
      checkError(module._zk_matrix_label_components(
        maskPointer, width, height, labelsPointer, labels.length, countPointer,
      ));
      const componentCount = module.HEAPU32[countPointer >>> 2];
      if (componentCount > labels.length) {
        throw new Error('Ядро вернуло недопустимое число компонент матрицы');
      }
      labels.set(
        new Int32Array(module.HEAPU8.buffer, labelsPointer, labels.length),
      );
      return labels;
    } finally {
      module._free(maskPointer);
      module._free(labelsPointer);
      module._free(countPointer);
    }
  }

  function runPathParse(svg: string): KernelPathData {
    if (typeof svg !== 'string') throw new TypeError('SVG-путь должен быть строкой');
    const encoded = new TextEncoder().encode(svg);
    validateKernelBytes(encoded.byteLength);
    const svgPointer = allocateBytes(encoded.byteLength);
    const countPointer = allocateBytes(4);
    const count = () => module.HEAPU32[countPointer >>> 2];
    if (!svgPointer || !countPointer) {
      if (svgPointer) module._free(svgPointer);
      if (countPointer) module._free(countPointer);
      throw new Error('Недостаточно памяти для разбора SVG-пути');
    }
    try {
      if (encoded.length) module.HEAPU8.set(encoded, svgPointer);
      const queryError = module._zk_geometry_path_parse(
        svgPointer, encoded.length, 0, 0, 0, 0, countPointer,
      );
      if (queryError !== 6) checkError(queryError);
      const commandCount = count();
      validateCount(commandCount);
      validateKernelBytes(commandCount * 4, commandCount * 8 * 8);
      const typesPointer = allocateBytes(commandCount * 4);
      const valuesPointer = allocateBytes(commandCount * 8 * 8);
      if (!typesPointer || !valuesPointer) {
        if (typesPointer) module._free(typesPointer);
        if (valuesPointer) module._free(valuesPointer);
        throw new Error('Недостаточно памяти для команд SVG-пути');
      }
      try {
        checkError(module._zk_geometry_path_parse(
          svgPointer, encoded.length, typesPointer, commandCount,
          valuesPointer, commandCount * 8, countPointer,
        ));
        return {
          types: new Uint32Array(module.HEAPU8.buffer, typesPointer, commandCount).slice(),
          values: new Float64Array(module.HEAPU8.buffer, valuesPointer, commandCount * 8).slice(),
        };
      } finally {
        module._free(typesPointer);
        module._free(valuesPointer);
      }
    } finally {
      module._free(svgPointer);
      module._free(countPointer);
    }
  }

  function runPathSerialize(path: KernelPathData): string {
    validatePathData(path);
    return withPath(path, (typesPointer, valuesPointer) => {
      const lengthPointer = allocateBytes(4);
      if (!lengthPointer) throw new Error('Недостаточно памяти для длины SVG-пути');
      try {
        const queryError = module._zk_geometry_path_serialize(
          typesPointer, valuesPointer, path.types.length, 0, 0, lengthPointer,
        );
        if (queryError !== 6) checkError(queryError);
        const length = module.HEAPU32[lengthPointer >>> 2];
        validateKernelBytes(length);
        const outputPointer = allocateBytes(length);
        if (!outputPointer) throw new Error('Недостаточно памяти для сериализации SVG-пути');
        try {
          checkError(module._zk_geometry_path_serialize(
            typesPointer, valuesPointer, path.types.length,
            outputPointer, length, lengthPointer,
          ));
          return new TextDecoder().decode(
            new Uint8Array(module.HEAPU8.buffer, outputPointer, length),
          );
        } finally {
          module._free(outputPointer);
        }
      } finally {
        module._free(lengthPointer);
      }
    });
  }

  function runPathTransform(
    path: KernelPathData,
    affine: Float64Array,
    tolerance: number,
  ): KernelPathData {
    validatePathData(path);
    validateAffineInput(affine);
    validateTolerance(tolerance);
    return withPath(path, (typesPointer, valuesPointer) => {
      const affinePointer = allocateBytes(6 * 8);
      const countPointer = allocateBytes(4);
      if (!affinePointer || !countPointer) {
        if (affinePointer) module._free(affinePointer);
        if (countPointer) module._free(countPointer);
        throw new Error('Недостаточно памяти для преобразования SVG-пути');
      }
      try {
        module.HEAPU8.set(new Uint8Array(affine.buffer, affine.byteOffset, affine.byteLength), affinePointer);
        const queryError = module._zk_geometry_path_transform(
          typesPointer, valuesPointer, path.types.length, affinePointer,
          tolerance, 0, 0, 0, 0, countPointer,
        );
        if (queryError !== 6) checkError(queryError);
        const count = module.HEAPU32[countPointer >>> 2];
        validateCount(count);
        const outputTypes = allocateBytes(count * 4);
        const outputValues = allocateBytes(count * 8 * 8);
        if (!outputTypes || !outputValues) {
          if (outputTypes) module._free(outputTypes);
          if (outputValues) module._free(outputValues);
          throw new Error('Недостаточно памяти для результата преобразования');
        }
        try {
          checkError(module._zk_geometry_path_transform(
            typesPointer, valuesPointer, path.types.length, affinePointer,
            tolerance, outputTypes, count, outputValues, count * 8, countPointer,
          ));
          return {
            types: new Uint32Array(module.HEAPU8.buffer, outputTypes, count).slice(),
            values: new Float64Array(module.HEAPU8.buffer, outputValues, count * 8).slice(),
          };
        } finally {
          module._free(outputTypes);
          module._free(outputValues);
        }
      } finally {
        module._free(affinePointer);
        module._free(countPointer);
      }
    });
  }

  function runPathMeasure(
    operation: 'length' | 'bounds',
    path: KernelPathData,
    tolerance: number,
  ): Float64Array {
    validatePathData(path);
    validateTolerance(tolerance);
    return withPath(path, (typesPointer, valuesPointer) => {
      const outputPointer = allocateBytes(4 * 8);
      const countPointer = allocateBytes(4);
      if (!outputPointer || !countPointer) {
        if (outputPointer) module._free(outputPointer);
        if (countPointer) module._free(countPointer);
        throw new Error('Недостаточно памяти для измерения SVG-пути');
      }
      try {
        checkError(module._zk_geometry_path_measure(
          PATH_MEASURE_OPERATION_IDS[operation], typesPointer, valuesPointer,
          path.types.length, tolerance, outputPointer, 4, countPointer,
        ));
        const count = module.HEAPU32[countPointer >>> 2];
        return new Float64Array(module.HEAPU8.buffer, outputPointer, count).slice();
      } finally {
        module._free(outputPointer);
        module._free(countPointer);
      }
    });
  }

  function runPathFlatten(
    path: KernelPathData,
    tolerance: number,
  ): KernelFlattenedPath {
    validatePathData(path);
    validateTolerance(tolerance);
    return withPath(path, (typesPointer, valuesPointer) => {
      const pointCountPointer = allocateBytes(4);
      const subpathCountPointer = allocateBytes(4);
      if (!pointCountPointer || !subpathCountPointer) {
        if (pointCountPointer) module._free(pointCountPointer);
        if (subpathCountPointer) module._free(subpathCountPointer);
        throw new Error('Недостаточно памяти для размеров уплощённого пути');
      }
      try {
        const queryError = module._zk_geometry_path_flatten(
          typesPointer, valuesPointer, path.types.length, tolerance,
          0, 0, 0, 0, 0, 0, pointCountPointer, subpathCountPointer,
        );
        if (queryError !== 6) checkError(queryError);
        const pointCount = module.HEAPU32[pointCountPointer >>> 2];
        const subpathCount = module.HEAPU32[subpathCountPointer >>> 2];
        validateCount(pointCount);
        validateCount(subpathCount + 1);
        const pointsPointer = allocateBytes(pointCount * 2 * 8);
        const offsetsPointer = allocateBytes((subpathCount + 1) * 4);
        const closedPointer = allocateBytes(subpathCount);
        if (!pointsPointer || !offsetsPointer || !closedPointer) {
          if (pointsPointer) module._free(pointsPointer);
          if (offsetsPointer) module._free(offsetsPointer);
          if (closedPointer) module._free(closedPointer);
          throw new Error('Недостаточно памяти для уплощённого пути');
        }
        try {
          checkError(module._zk_geometry_path_flatten(
            typesPointer, valuesPointer, path.types.length, tolerance,
            pointsPointer, pointCount, offsetsPointer, subpathCount + 1,
            closedPointer, subpathCount, pointCountPointer, subpathCountPointer,
          ));
          return {
            coordinates: new Float64Array(
              module.HEAPU8.buffer, pointsPointer, pointCount * 2,
            ).slice(),
            subpathOffsets: new Uint32Array(
              module.HEAPU8.buffer, offsetsPointer, subpathCount + 1,
            ).slice(),
            closed: new Uint8Array(
              module.HEAPU8.buffer, closedPointer, subpathCount,
            ).slice(),
          };
        } finally {
          module._free(pointsPointer);
          module._free(offsetsPointer);
          module._free(closedPointer);
        }
      } finally {
        module._free(pointCountPointer);
        module._free(subpathCountPointer);
      }
    });
  }

  function runPathIntersections(
    first: KernelPathData,
    second: KernelPathData,
    tolerance: number,
  ): Float64Array {
    validatePathData(first);
    validatePathData(second);
    validateTolerance(tolerance);
    return withPath(first, (firstTypes, firstValues) =>
      withPath(second, (secondTypes, secondValues) => {
        const countPointer = allocateBytes(4);
        if (!countPointer) throw new Error('Недостаточно памяти для пересечений путей');
        try {
          const queryError = module._zk_geometry_path_intersections(
            firstTypes, firstValues, first.types.length, secondTypes, secondValues,
            second.types.length, tolerance, 0, 0, countPointer,
          );
          if (queryError !== 6) checkError(queryError);
          const count = module.HEAPU32[countPointer >>> 2];
          validateCount(count);
          const outputPointer = allocateBytes(count * 2 * 8);
          if (!outputPointer) throw new Error('Недостаточно памяти для пересечений путей');
          try {
            checkError(module._zk_geometry_path_intersections(
              firstTypes, firstValues, first.types.length, secondTypes, secondValues,
              second.types.length, tolerance, outputPointer, count, countPointer,
            ));
            return new Float64Array(module.HEAPU8.buffer, outputPointer, count * 2).slice();
          } finally {
            module._free(outputPointer);
          }
        } finally {
          module._free(countPointer);
        }
      }),
    );
  }

  function runPathToPolygons(
    path: KernelPathData,
    tolerance: number,
    fillRule: KernelPathFillRule,
  ): KernelPolygonData {
    validatePathData(path);
    validateTolerance(tolerance);
    return withPath(path, (typesPointer, valuesPointer) => {
      const countPointers = Array.from({ length: 3 }, () => allocateBytes(4));
      if (countPointers.some((pointer) => !pointer)) {
        countPointers.filter(Boolean).forEach((pointer) => module._free(pointer));
        throw new Error('Недостаточно памяти для размеров многоугольника');
      }
      try {
        const [pointCountPointer, ringCountPointer, polygonCountPointer] = countPointers;
        const queryError = module._zk_geometry_path_to_polygons(
          typesPointer, valuesPointer, path.types.length, tolerance,
          FILL_RULE_IDS[fillRule], 0, 0, 0, 0, 0, 0,
          pointCountPointer, ringCountPointer, polygonCountPointer,
        );
        if (queryError !== 6) checkError(queryError);
        const pointCount = module.HEAPU32[pointCountPointer >>> 2];
        const ringCount = module.HEAPU32[ringCountPointer >>> 2];
        const polygonCount = module.HEAPU32[polygonCountPointer >>> 2];
        validateCount(pointCount);
        validateCount(ringCount + 1);
        validateCount(polygonCount + 1);
        const pointsPointer = allocateBytes(pointCount * 2 * 8);
        const ringOffsetsPointer = allocateBytes((ringCount + 1) * 4);
        const polygonOffsetsPointer = allocateBytes((polygonCount + 1) * 4);
        if (!pointsPointer || !ringOffsetsPointer || !polygonOffsetsPointer) {
          if (pointsPointer) module._free(pointsPointer);
          if (ringOffsetsPointer) module._free(ringOffsetsPointer);
          if (polygonOffsetsPointer) module._free(polygonOffsetsPointer);
          throw new Error('Недостаточно памяти для результата полигонов');
        }
        try {
          checkError(module._zk_geometry_path_to_polygons(
            typesPointer, valuesPointer, path.types.length, tolerance,
            FILL_RULE_IDS[fillRule], pointsPointer, pointCount,
            ringOffsetsPointer, ringCount + 1, polygonOffsetsPointer,
            polygonCount + 1, pointCountPointer, ringCountPointer,
            polygonCountPointer,
          ));
          return {
            coordinates: new Float64Array(
              module.HEAPU8.buffer, pointsPointer, pointCount * 2,
            ).slice(),
            ringOffsets: new Uint32Array(
              module.HEAPU8.buffer, ringOffsetsPointer, ringCount + 1,
            ).slice(),
            polygonOffsets: new Uint32Array(
              module.HEAPU8.buffer, polygonOffsetsPointer, polygonCount + 1,
            ).slice(),
          };
        } finally {
          module._free(pointsPointer);
          module._free(ringOffsetsPointer);
          module._free(polygonOffsetsPointer);
        }
      } finally {
        countPointers.forEach((pointer) => module._free(pointer));
      }
    });
  }

  function runPolygonBoolean(
    operation: KernelPolygonBooleanOperation,
    inputs: readonly KernelPolygonData[],
  ): KernelPolygonData {
    const packed = packPolygonInputs(inputs);
    const pointers: number[] = [];
    const allocate = (bytes: number) => {
      const pointer = allocateBytes(bytes);
      if (!pointer) throw new Error('Недостаточно памяти для булевой операции полигонов');
      pointers.push(pointer);
      return pointer;
    };
    try {
      const inputXY = allocate(packed.coordinates.byteLength);
      const inputRings = allocate(packed.ringOffsets.byteLength);
      const inputPolygons = allocate(packed.polygonOffsets.byteLength);
      const inputGeometries = allocate(packed.geometryOffsets.byteLength);
      const countPointers = Array.from({ length: 3 }, () => allocate(4));
      module.HEAPU8.set(new Uint8Array(packed.coordinates.buffer), inputXY);
      module.HEAPU8.set(new Uint8Array(packed.ringOffsets.buffer), inputRings);
      module.HEAPU8.set(new Uint8Array(packed.polygonOffsets.buffer), inputPolygons);
      module.HEAPU8.set(new Uint8Array(packed.geometryOffsets.buffer), inputGeometries);
      const [pointCountPointer, ringCountPointer, polygonCountPointer] = countPointers;
      const invoke = (
        outputXY: number,
        pointCapacity: number,
        outputRings: number,
        ringCapacity: number,
        outputPolygons: number,
        polygonCapacity: number,
      ) => module._zk_geometry_polygon_boolean(
        POLYGON_BOOLEAN_OPERATION_IDS[operation], inputXY, packed.pointCount,
        inputRings, packed.ringCount, inputPolygons, packed.polygonCount,
        inputGeometries, inputs.length, outputXY, pointCapacity, outputRings,
        ringCapacity, outputPolygons, polygonCapacity, pointCountPointer,
        ringCountPointer, polygonCountPointer,
      );
      const queryError = invoke(0, 0, 0, 0, 0, 0);
      if (queryError !== 6) checkError(queryError);
      const pointCount = module.HEAPU32[pointCountPointer >>> 2];
      const ringCount = module.HEAPU32[ringCountPointer >>> 2];
      const polygonCount = module.HEAPU32[polygonCountPointer >>> 2];
      validateCount(pointCount);
      validateCount(ringCount + 1);
      validateCount(polygonCount + 1);
      const outputXY = allocate(pointCount * 2 * 8);
      const outputRings = allocate((ringCount + 1) * 4);
      const outputPolygons = allocate((polygonCount + 1) * 4);
      checkError(invoke(
        outputXY, pointCount, outputRings, ringCount + 1,
        outputPolygons, polygonCount + 1,
      ));
      return {
        coordinates: new Float64Array(
          module.HEAPU8.buffer, outputXY, pointCount * 2,
        ).slice(),
        ringOffsets: new Uint32Array(
          module.HEAPU8.buffer, outputRings, ringCount + 1,
        ).slice(),
        polygonOffsets: new Uint32Array(
          module.HEAPU8.buffer, outputPolygons, polygonCount + 1,
        ).slice(),
      };
    } finally {
      pointers.forEach((pointer) => module._free(pointer));
    }
  }

  function runStrokePolylineOld(
    coordinates: Float64Array,
    width: number,
    tolerance: number,
    cap: KernelStrokeCap,
    join: KernelStrokeJoin,
    miterLimit: number,
    closed: boolean,
  ): KernelPolygonData {
    if (!(coordinates instanceof Float64Array) || coordinates.length % 2 !== 0 ||
        coordinates.some((value) => !Number.isFinite(value)) ||
        !Number.isFinite(width) || width < 0 || !Number.isFinite(miterLimit) ||
        miterLimit < 1 || typeof closed !== 'boolean') {
      throw new TypeError('Параметры бинарной обводки заданы неверно');
    }
    validateTolerance(tolerance);
    validateKernelBytes(coordinates.byteLength);
    const inputPointer = allocateBytes(coordinates.byteLength);
    const countPointers = Array.from({ length: 3 }, () => allocateBytes(4));
    if (!inputPointer || countPointers.some((pointer) => !pointer)) {
      if (inputPointer) module._free(inputPointer);
      countPointers.filter(Boolean).forEach((pointer) => module._free(pointer));
      throw new Error('Недостаточно памяти для бинарной обводки');
    }
    try {
      if (coordinates.length) {
        module.HEAPU8.set(
          new Uint8Array(coordinates.buffer, coordinates.byteOffset, coordinates.byteLength),
          inputPointer,
        );
      }
      const [pointCountPointer, ringCountPointer, polygonCountPointer] = countPointers;
      const invoke = (
        outputXY: number,
        pointCapacity: number,
        outputRings: number,
        ringCapacity: number,
        outputPolygons: number,
        polygonCapacity: number,
      ) => module._zk_geometry_stroke_polyline(
        inputPointer, coordinates.length / 2, width, tolerance,
        STROKE_CAP_IDS[cap], STROKE_JOIN_IDS[join], miterLimit,
        closed ? 1 : 0, outputXY, pointCapacity, outputRings, ringCapacity,
        outputPolygons, polygonCapacity, pointCountPointer, ringCountPointer,
        polygonCountPointer,
      );
      const queryError = invoke(0, 0, 0, 0, 0, 0);
      if (queryError !== 6) checkError(queryError);
      const pointCount = module.HEAPU32[pointCountPointer >>> 2];
      const ringCount = module.HEAPU32[ringCountPointer >>> 2];
      const polygonCount = module.HEAPU32[polygonCountPointer >>> 2];
      validateCount(pointCount);
      validateCount(ringCount + 1);
      validateCount(polygonCount + 1);
      const outputXY = allocateBytes(pointCount * 2 * 8);
      const outputRings = allocateBytes((ringCount + 1) * 4);
      const outputPolygons = allocateBytes((polygonCount + 1) * 4);
      if (!outputXY || !outputRings || !outputPolygons) {
        if (outputXY) module._free(outputXY);
        if (outputRings) module._free(outputRings);
        if (outputPolygons) module._free(outputPolygons);
        throw new Error('Недостаточно памяти для результата обводки');
      }
      try {
        checkError(invoke(
          outputXY, pointCount, outputRings, ringCount + 1,
          outputPolygons, polygonCount + 1,
        ));
        return {
          coordinates: new Float64Array(module.HEAPU8.buffer, outputXY, pointCount * 2).slice(),
          ringOffsets: new Uint32Array(module.HEAPU8.buffer, outputRings, ringCount + 1).slice(),
          polygonOffsets: new Uint32Array(module.HEAPU8.buffer, outputPolygons, polygonCount + 1).slice(),
        };
      } finally {
        module._free(outputXY);
        module._free(outputRings);
        module._free(outputPolygons);
      }
    } finally {
      module._free(inputPointer);
      countPointers.forEach((pointer) => module._free(pointer));
    }
  }

  function runStrokePolyline(
    coordinates: Float64Array,
    width: number,
    tolerance: number,
    cap: KernelStrokeCap,
    join: KernelStrokeJoin,
    miterLimit: number,
    closed: boolean,
  ): KernelPolygonData {
    if (!(coordinates instanceof Float64Array) || coordinates.length % 2 !== 0 ||
        coordinates.some((value) => !Number.isFinite(value)) ||
        !Number.isFinite(width) || width < 0 || !Number.isFinite(miterLimit) ||
        miterLimit < 1 || typeof closed !== 'boolean') {
      throw new TypeError('Параметры бинарной обводки заданы неверно');
    }
    validateTolerance(tolerance);
    validateKernelBytes(coordinates.byteLength);
    const inputPointer = allocateBytes(coordinates.byteLength);
    const countPointers = Array.from({ length: 3 }, () => allocateBytes(4));
    if (!inputPointer || countPointers.some((pointer) => !pointer)) {
      if (inputPointer) module._free(inputPointer);
      countPointers.filter(Boolean).forEach((pointer) => module._free(pointer));
      throw new Error('Недостаточно памяти для бинарной обводки');
    }
    try {
      if (coordinates.length) {
        module.HEAPU8.set(
          new Uint8Array(coordinates.buffer, coordinates.byteOffset, coordinates.byteLength),
          inputPointer,
        );
      }
      const [pointCountPointer, ringCountPointer, polygonCountPointer] = countPointers;
      const invoke = (
        outputXY: number,
        pointCapacity: number,
        outputRings: number,
        ringCapacity: number,
        outputPolygons: number,
        polygonCapacity: number,
      ) => module._zk_geometry_stroke_polyline(
        inputPointer, coordinates.length / 2, width, tolerance,
        STROKE_CAP_IDS[cap], STROKE_JOIN_IDS[join], miterLimit,
        closed ? 1 : 0, outputXY, pointCapacity, outputRings, ringCapacity,
        outputPolygons, polygonCapacity, pointCountPointer, ringCountPointer,
        polygonCountPointer,
      );
      const queryError = invoke(0, 0, 0, 0, 0, 0);
      if (queryError !== 6) checkError(queryError);
      const pointCount = module.HEAPU32[pointCountPointer >>> 2];
      const ringCount = module.HEAPU32[ringCountPointer >>> 2];
      const polygonCount = module.HEAPU32[polygonCountPointer >>> 2];
      validateCount(pointCount);
      validateCount(ringCount + 1);
      validateCount(polygonCount + 1);
      const outputXY = allocateBytes(pointCount * 2 * 8);
      const outputRings = allocateBytes((ringCount + 1) * 4);
      const outputPolygons = allocateBytes((polygonCount + 1) * 4);
      if (!outputXY || !outputRings || !outputPolygons) {
        if (outputXY) module._free(outputXY);
        if (outputRings) module._free(outputRings);
        if (outputPolygons) module._free(outputPolygons);
        throw new Error('Недостаточно памяти для результата обводки');
      }
      try {
        checkError(invoke(
          outputXY, pointCount, outputRings, ringCount + 1,
          outputPolygons, polygonCount + 1,
        ));
        return {
          coordinates: new Float64Array(
            module.HEAPU8.buffer, outputXY, pointCount * 2,
          ).slice(),
          ringOffsets: new Uint32Array(
            module.HEAPU8.buffer, outputRings, ringCount + 1,
          ).slice(),
          polygonOffsets: new Uint32Array(
            module.HEAPU8.buffer, outputPolygons, polygonCount + 1,
          ).slice(),
        };
      } finally {
        module._free(outputXY);
        module._free(outputRings);
        module._free(outputPolygons);
      }
    } finally {
      module._free(inputPointer);
      countPointers.forEach((pointer) => module._free(pointer));
    }
  }

  function withPath<T>(
    path: KernelPathData,
    run: (typesPointer: number, valuesPointer: number) => T,
  ): T {
    const typesPointer = allocateBytes(path.types.byteLength);
    const valuesPointer = allocateBytes(path.values.byteLength);
    if (!typesPointer || !valuesPointer) {
      if (typesPointer) module._free(typesPointer);
      if (valuesPointer) module._free(valuesPointer);
      throw new Error('Недостаточно памяти для передачи SVG-пути в ядро');
    }
    try {
      if (path.types.length) {
        module.HEAPU8.set(new Uint8Array(path.types.buffer, path.types.byteOffset, path.types.byteLength), typesPointer);
        module.HEAPU8.set(new Uint8Array(path.values.buffer, path.values.byteOffset, path.values.byteLength), valuesPointer);
      }
      return run(typesPointer, valuesPointer);
    } finally {
      module._free(typesPointer);
      module._free(valuesPointer);
    }
  }

  function allocateBytes(bytes: number): number {
    return module._malloc(Math.max(1, bytes));
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

function validateRaster(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || width > 0x7fff_ffff || height > 0x7fff_ffff) {
    throw new RangeError('Размеры растрового контура должны быть положительными uint31');
  }
}

function validateSpans(spans: readonly KernelContourSpan[]): void {
  validateSpanRecords(spans);
  for (const span of spans) {
    if (span.start < 0 || span.end <= span.start) {
      throw new TypeError('Контур содержит некорректный полуоткрытый интервал');
    }
  }
}

function validateSpanRecords(spans: readonly KernelContourSpan[]): void {
  if (!Array.isArray(spans)) throw new TypeError('Контур должен быть массивом интервалов');
  for (const span of spans) {
    if (!span || !Number.isSafeInteger(span.y) || !Number.isSafeInteger(span.start) ||
        !Number.isSafeInteger(span.end) ||
        [span.y, span.start, span.end].some((value) =>
          value < -0x8000_0000 || value > 0x7fff_ffff)) {
      throw new TypeError('Контур содержит некорректный полуоткрытый интервал');
    }
  }
}

function flattenSpans(spans: readonly KernelContourSpan[]): Int32Array {
  const values = new Int32Array(spans.length * 3);
  spans.forEach((span, index) => {
    values[index * 3] = span.y;
    values[index * 3 + 1] = span.start;
    values[index * 3 + 2] = span.end;
  });
  return values;
}

function validatePathData(path: KernelPathData): void {
  if (!path || !(path.types instanceof Uint32Array) ||
      !(path.values instanceof Float64Array) ||
      path.values.length !== path.types.length * 8 ||
      path.values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('SVG-путь содержит некорректные бинарные команды');
  }
}

function validateAffineInput(affine: Float64Array): void {
  if (!(affine instanceof Float64Array) || affine.length !== 6 ||
      affine.some((value) => !Number.isFinite(value))) {
    throw new TypeError('Аффинная матрица должна содержать шесть конечных чисел');
  }
}

function validateTolerance(tolerance: number): void {
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new RangeError('Геометрический допуск должен быть больше нуля');
  }
}

function packPolygonInputs(inputs: readonly KernelPolygonData[]) {
  const coordinates: number[] = [];
  const ringOffsets = [0];
  const polygonOffsets = [0];
  const geometryOffsets = [0];
  let pointBase = 0;
  let ringBase = 0;
  let polygonBase = 0;
  for (const input of inputs) {
    if (!input || !(input.coordinates instanceof Float64Array) ||
        !(input.ringOffsets instanceof Uint32Array) ||
        !(input.polygonOffsets instanceof Uint32Array) ||
        input.coordinates.length % 2 !== 0 || input.ringOffsets.length === 0 ||
        input.polygonOffsets.length === 0 ||
        input.coordinates.some((value) => !Number.isFinite(value))) {
      throw new TypeError('Булева операция получила повреждённую структуру полигонов');
    }
    const pointCount = input.coordinates.length / 2;
    const ringCount = input.ringOffsets.length - 1;
    const polygonCount = input.polygonOffsets.length - 1;
    if (input.ringOffsets[0] !== 0 ||
        input.ringOffsets[ringCount] !== pointCount ||
        input.polygonOffsets[0] !== 0 ||
        input.polygonOffsets[polygonCount] !== ringCount) {
      throw new TypeError('Смещения колец и полигонов не согласованы с координатами');
    }
    for (let index = 0; index < ringCount; index += 1) {
      if (input.ringOffsets[index] > input.ringOffsets[index + 1]) {
        throw new TypeError('Смещения колец должны возрастать');
      }
      ringOffsets.push(pointBase + input.ringOffsets[index + 1]);
    }
    for (let index = 0; index < polygonCount; index += 1) {
      if (input.polygonOffsets[index] > input.polygonOffsets[index + 1]) {
        throw new TypeError('Смещения полигонов должны возрастать');
      }
      polygonOffsets.push(ringBase + input.polygonOffsets[index + 1]);
    }
    for (const value of input.coordinates) coordinates.push(value);
    pointBase += pointCount;
    ringBase += ringCount;
    polygonBase += polygonCount;
    geometryOffsets.push(polygonBase);
  }
  const packed = {
    coordinates: new Float64Array(coordinates),
    ringOffsets: new Uint32Array(ringOffsets),
    polygonOffsets: new Uint32Array(polygonOffsets),
    geometryOffsets: new Uint32Array(geometryOffsets),
    pointCount: pointBase,
    ringCount: ringBase,
    polygonCount: polygonBase,
  };
  validateKernelBytes(
    packed.coordinates.byteLength,
    packed.ringOffsets.byteLength,
    packed.polygonOffsets.byteLength,
    packed.geometryOffsets.byteLength,
  );
  return packed;
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
    'INVALID_PATH_FLAGS',
    'UNSUPPORTED_PATH_COMMAND',
  ];
  if (code !== 0) {
    const details: Record<number, string> = {
      11: 'Флаги SVG-дуги должны иметь значение 0 или 1',
      12: 'Неподдерживаемая команда SVG-пути',
    };
    const detail = details[code];
    throw new Error(
      `Ошибка ядра Zero Strategy: ${names[code] ?? 'INTERNAL'}${detail ? `: ${detail}` : ''}`,
    );
  }
}
