import type {
  KernelAffineOperation,
  KernelContourSpan,
  KernelContourRingData,
  KernelContourScalarChunk,
  KernelContourCompositionChunk,
  KernelContourSpanOperation,
  KernelGeometryPrimitiveOperation,
  KernelFlattenedPath,
  KernelMatrixOperation,
  KernelMatrixResult,
  KernelMatrixScalar,
  KernelPathData,
  KernelPathFillRule,
  KernelPolygonBooleanOperation,
  KernelPolygonData,
  KernelPopulationMeasure,
  KernelPopulationSplit,
  KernelStrokeCap,
  KernelStrokeJoin,
  KernelVectorOperation,
} from './bindings/contracts';

export interface BinaryMathKernel {
  labelGridComponents(mask: Uint8Array, width: number, height: number): Int32Array;
  vectorExecute(operation: KernelVectorOperation, input: Float64Array): Float64Array;
  affineExecute(operation: KernelAffineOperation, input: Float64Array): Float64Array;
  geometryPrimitiveExecute(
    operation: KernelGeometryPrimitiveOperation,
    input: Float64Array,
  ): Float64Array;
  contourSpansExecute(
    operation: KernelContourSpanOperation,
    left: readonly KernelContourSpan[],
    right: readonly KernelContourSpan[],
    width: number,
    height: number,
    distance?: number,
  ): KernelContourSpan[];
  contourReplaceRegion(
    source: readonly KernelContourSpan[],
    replacement: readonly KernelContourSpan[],
    bounds: { x0: number; y0: number; x1: number; y1: number },
    width: number,
    height: number,
  ): KernelContourSpan[];
  contourRasterizePolygons(
    polygons: KernelPolygonData,
    width: number,
    height: number,
  ): KernelContourSpan[];
  contourLinkRings(
    codes: Uint32Array,
    width: number,
    height: number,
  ): KernelContourRingData;
  contourTraceScalarChunk(
    values: Float64Array,
    include: Uint8Array | null,
    sourceRowStart: number,
    processRowStart: number,
    processRowEnd: number,
    width: number,
    height: number,
    skip: number | null,
  ): KernelContourScalarChunk;
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
  ): KernelContourCompositionChunk;
  contourClassifySpans(
    humidity: Uint8Array,
    temperature: Float32Array,
    drainage: Uint8Array,
    spans: readonly KernelContourSpan[],
    width: number,
    height: number,
  ): Float64Array;
  sumPopulationMeasure(input: KernelPopulationMeasure): KernelPopulationMeasure;
  takePopulationMeasure(
    source: KernelPopulationMeasure,
    reference: KernelPopulationMeasure,
    priorityOrder: Uint32Array,
    amount: number,
  ): KernelPopulationSplit;
  measureProduct(
    left: KernelPopulationMeasure,
    right: KernelPopulationMeasure,
    outputSources: Uint32Array,
    productDivisor: number,
    multiplier: number,
    finalDivisor: number,
    divideByRightTotal: boolean,
    dropZeroMass: boolean,
  ): KernelPopulationMeasure;
  algebraQuery(request: string): string;
  matrixExecute(
    operation: KernelMatrixOperation,
    left: KernelMatrixScalar,
    leftRows: number,
    leftColumns: number,
    right?: KernelMatrixScalar,
    rightRows?: number,
    rightColumns?: number,
  ): KernelMatrixResult;
  sparseMatvec?(
    rows: number,
    columns: number,
    rowOffsets: Uint32Array,
    columnIndices: Uint32Array,
    values: KernelMatrixScalar,
    vector: KernelMatrixScalar,
  ): KernelMatrixScalar;
  sparseMatmul?(
    rows: number,
    columns: number,
    rowOffsets: Uint32Array,
    columnIndices: Uint32Array,
    values: KernelMatrixScalar,
    right: KernelMatrixScalar,
    rightColumns: number,
  ): KernelMatrixResult;
  pathParse(svg: string): KernelPathData;
  pathSerialize(path: KernelPathData): string;
  pathTransform(path: KernelPathData, affine: Float64Array, tolerance: number): KernelPathData;
  pathMeasure(
    operation: 'length' | 'bounds',
    path: KernelPathData,
    tolerance: number,
  ): Float64Array;
  pathFlatten(path: KernelPathData, tolerance: number): KernelFlattenedPath;
  pathIntersections(
    first: KernelPathData,
    second: KernelPathData,
    tolerance: number,
  ): Float64Array;
  pathToPolygons(
    path: KernelPathData,
    tolerance: number,
    fillRule: KernelPathFillRule,
  ): KernelPolygonData;
  polygonBoolean(
    operation: KernelPolygonBooleanOperation,
    inputs: readonly KernelPolygonData[],
  ): KernelPolygonData;
  strokePolyline(
    coordinates: Float64Array,
    width: number,
    tolerance: number,
    cap: KernelStrokeCap,
    join: KernelStrokeJoin,
    miterLimit: number,
    closed: boolean,
  ): KernelPolygonData;
}

type KernelGlobal = typeof globalThis & {
  __zeroStrategyBinaryMathKernelV1?: BinaryMathKernel;
};

export function installBinaryMathKernel(kernel: BinaryMathKernel): void {
  if (!kernel || typeof kernel.vectorExecute !== 'function' ||
      typeof kernel.labelGridComponents !== 'function' ||
      typeof kernel.affineExecute !== 'function' ||
      typeof kernel.geometryPrimitiveExecute !== 'function' ||
      typeof kernel.contourSpansExecute !== 'function' ||
      typeof kernel.contourReplaceRegion !== 'function' ||
      typeof kernel.contourRasterizePolygons !== 'function' ||
      typeof kernel.contourLinkRings !== 'function' ||
      typeof kernel.contourTraceScalarChunk !== 'function' ||
      typeof kernel.contourTraceCompositionChunk !== 'function' ||
      typeof kernel.contourClassifySpans !== 'function' ||
      typeof kernel.sumPopulationMeasure !== 'function' ||
      typeof kernel.takePopulationMeasure !== 'function' ||
      typeof kernel.measureProduct !== 'function' ||
       typeof kernel.algebraQuery !== 'function' ||
      typeof kernel.matrixExecute !== 'function' ||
      typeof kernel.pathParse !== 'function' ||
      typeof kernel.pathSerialize !== 'function' ||
      typeof kernel.pathTransform !== 'function' ||
      typeof kernel.pathMeasure !== 'function' ||
      typeof kernel.pathFlatten !== 'function' ||
      typeof kernel.pathIntersections !== 'function' ||
      typeof kernel.pathToPolygons !== 'function' ||
      typeof kernel.polygonBoolean !== 'function' ||
      typeof kernel.strokePolyline !== 'function') {
    throw new TypeError('Бинарный математический модуль не реализует общий геометрический контракт');
  }
  (globalThis as KernelGlobal).__zeroStrategyBinaryMathKernelV1 = kernel;
}

export function getBinaryMathKernel(): BinaryMathKernel {
  const kernel = (globalThis as KernelGlobal).__zeroStrategyBinaryMathKernelV1;
  if (!kernel) {
    throw new Error('Бинарное математическое ядро не инициализировано');
  }
  return kernel;
}

export function binaryMathKernelReady(): boolean {
  return (globalThis as KernelGlobal).__zeroStrategyBinaryMathKernelV1 !== undefined;
}
