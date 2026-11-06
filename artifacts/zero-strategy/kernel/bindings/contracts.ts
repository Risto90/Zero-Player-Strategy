/** Версия стабильного C ABI, не версия игрового сохранения. */
export const KERNEL_ABI_VERSION = 1;

export type KernelBufferType = 'u8' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64' | 'i64' | 'u64';
export type KernelSetOperation = 'union' | 'intersection' | 'difference' | 'symmetricDifference' | 'complement';
export type KernelMeasureOperation = KernelSetOperation;
export type KernelMatrixScalar = Float32Array | Float64Array;
export type KernelVectorOperation =
  | 'add' | 'subtract' | 'scale' | 'dot' | 'cross'
  | 'length' | 'distance' | 'normalize' | 'perpendicular' | 'lerp';
export type KernelAffineOperation =
  | 'identity' | 'create' | 'translation' | 'scaling'
  | 'rotation' | 'multiply' | 'invert' | 'apply';
export type KernelGeometryPrimitiveOperation =
  | 'boundsOfPoints' | 'boundsDistance' | 'boundsIntersect' | 'boundsCircle'
  | 'closestPointSegment' | 'distanceSegment' | 'segmentLength' | 'segmentTangent'
  | 'intersectSegments' | 'polylineLength' | 'closestPointPolyline'
  | 'polylineIntersections' | 'quadraticAt' | 'cubicAt' | 'quadraticTangent'
  | 'cubicTangent' | 'circleIntersections' | 'circleSegmentIntersections'
  | 'distanceCircleBoundary' | 'closestPointCircleBoundary' | 'pointInRing'
  | 'ringSignedArea' | 'arcParameters' | 'arcAt' | 'arcTangent'
  | 'nearestSpatial' | 'nearestPoints' | 'gridPathSamples'
  | 'gridPathWeightedSum' | 'circlePoints' | 'clipPolygonRect';
export type KernelContourSpanOperation =
  | 'normalize' | 'intersection' | 'union' | 'difference' | 'border' | 'offset';
export type KernelPathFillRule = 'evenodd' | 'nonzero';
export type KernelPolygonBooleanOperation =
  | 'union' | 'intersection' | 'difference' | 'xor';
export type KernelStrokeCap = 'butt' | 'square' | 'round';
export type KernelStrokeJoin = 'miter' | 'bevel' | 'round';
export interface KernelContourSpan {
  y: number;
  start: number;
  end: number;
}
export interface KernelContourRingData {
  /** Координаты вершин колец в порядке обхода, по два целых значения на вершину. */
  coordinates: Int32Array;
  /** Смещения в вершинах; последняя запись равна числу вершин. */
  ringOffsets: Uint32Array;
}
export interface KernelContourScalarChunk {
  /** Значения групп в возрастающем порядке. */
  values: Float64Array;
  /** Смещения групп в массиве кодов рёбер, последняя запись равна числу кодов. */
  offsets: Uint32Array;
  /** Ориентированные граничные рёбра, сгруппированные по значению. */
  codes: Uint32Array;
}
export interface KernelContourCompositionChunk {
  /** Идентификаторы сущностей для групп долей. */
  entities: Uint32Array;
  /** Доли из соответствующих смесей. */
  values: Float64Array;
  /** Смещения групп в массиве кодов рёбер. */
  offsets: Uint32Array;
  /** Ориентированные граничные рёбра по группам «сущность — доля». */
  codes: Uint32Array;
}
export interface KernelPathData {
  types: Uint32Array;
  values: Float64Array;
}
export interface KernelFlattenedPath {
  coordinates: Float64Array;
  subpathOffsets: Uint32Array;
  closed: Uint8Array;
}
export interface KernelPolygonData {
  coordinates: Float64Array;
  ringOffsets: Uint32Array;
  polygonOffsets: Uint32Array;
}
export type KernelMatrixOperation =
  | 'transpose' | 'add' | 'subtract' | 'hadamard' | 'divide'
  | 'matmul' | 'matvec' | 'dot' | 'outer' | 'sum' | 'mean'
  | 'normL1' | 'normFrobenius' | 'trace' | 'determinant' | 'rank'
  | 'inverse' | 'pseudoinverse' | 'solve' | 'minimum' | 'maximum'
  | 'logicalAnd' | 'logicalOr' | 'logicalXor' | 'equal' | 'lessThan'
  | 'reduceMin' | 'reduceMax' | 'seededRandom' | 'sampleIndices'
  | 'stencilZero' | 'stencilClamp' | 'bilinearInterpolate';
export type KernelMatrixFactorization = 'lu' | 'qr' | 'cholesky' | 'svd' | 'symmetricEigen';
export interface KernelMatrixResult {
  values: KernelMatrixScalar;
  rows: number;
  columns: number;
}
export interface KernelMatrixFactorizationResult {
  a: KernelMatrixResult;
  b: KernelMatrixResult;
  c: KernelMatrixResult;
}
export interface KernelPopulationMeasure {
  /** По четыре uint32 на группу: культура, вера, происхождение, принадлежность. */
  keys: Uint32Array;
  /** Одна неотрицательная масса на группу; неверие кодируется в ключе веры как UINT32_MAX. */
  mass: Float64Array;
}
export interface KernelPopulationSplit {
  selected: KernelPopulationMeasure;
  remaining: KernelPopulationMeasure;
}

export interface NativeKernelBinding {
  abiVersion(): number;
  addI32(left: number, right: number): number;
  queueAddI32(left: number, right: number): Promise<number>;
  sumI32(values: Int32Array): bigint;
  createBuffer(type: KernelBufferType, count: number): ArrayBufferView;
  setAlgebra(operation: KernelSetOperation, left: Uint32Array, right: Uint32Array): Uint32Array;
  measureAlgebra(operation: KernelMeasureOperation, left: KernelPopulationMeasure, right: KernelPopulationMeasure): KernelPopulationMeasure;
  sumPopulationMeasure(input: KernelPopulationMeasure): KernelPopulationMeasure;
  algebraQuery(request: string): string;
  vectorExecute?(operation: KernelVectorOperation, input: Float64Array): Float64Array;
  affineExecute?(operation: KernelAffineOperation, input: Float64Array): Float64Array;
  contourSpansExecute?(
    operation: KernelContourSpanOperation,
    left: readonly KernelContourSpan[],
    right: readonly KernelContourSpan[],
    width: number,
    height: number,
    distance?: number,
  ): KernelContourSpan[];
  contourLinkRings?(codes: Uint32Array, width: number, height: number): KernelContourRingData;
  contourTraceScalarChunk?(
    values: Float64Array,
    include: Uint8Array | null,
    sourceRowStart: number,
    processRowStart: number,
    processRowEnd: number,
    width: number,
    height: number,
    skip: number | null,
  ): KernelContourScalarChunk;
  contourTraceCompositionChunk?(
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
  pathParse?(svg: string): KernelPathData;
  pathSerialize?(path: KernelPathData): string;
  pathTransform?(path: KernelPathData, affine: Float64Array, tolerance: number): KernelPathData;
  pathMeasure?(
    operation: 'length' | 'bounds',
    path: KernelPathData,
    tolerance: number,
  ): Float64Array;
  pathIntersections?(
    first: KernelPathData,
    second: KernelPathData,
    tolerance: number,
  ): Float64Array;
  pathToPolygons?(
    path: KernelPathData,
    tolerance: number,
    fillRule: KernelPathFillRule,
  ): KernelPolygonData;
  polygonBoolean?(
    operation: KernelPolygonBooleanOperation,
    inputs: readonly KernelPolygonData[],
  ): KernelPolygonData;
  matrixExecute?(
    operation: KernelMatrixOperation,
    left: KernelMatrixScalar,
    leftRows: number,
    leftColumns: number,
    right: KernelMatrixScalar,
    rightRows: number,
    rightColumns: number,
  ): KernelMatrixResult;
  matrixFactorize?(
    factorization: KernelMatrixFactorization,
    input: KernelMatrixScalar,
    rows: number,
    columns: number,
  ): KernelMatrixFactorizationResult;
  matrixBatchMatmul?(
    left: KernelMatrixScalar,
    leftBatches: number,
    leftRows: number,
    leftColumns: number,
    right: KernelMatrixScalar,
    rightBatches: number,
    rightRows: number,
    rightColumns: number,
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
}

export interface KernelBuffer<T extends ArrayBufferView> {
  readonly handle: bigint;
  readonly view: T;
  release(): void;
}

export type KernelErrorCode =
  | 'INVALID_ARGUMENT'
  | 'OUT_OF_MEMORY'
  | 'INVALID_HANDLE'
  | 'STALE_HANDLE'
  | 'TYPE_MISMATCH'
  | 'OUT_OF_RANGE'
  | 'OVERFLOW'
  | 'UNSUPPORTED'
  | 'CONFLICT'
  | 'INTERNAL';
