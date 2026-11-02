/** Версия стабильного C ABI, не версия игрового сохранения. */
export const KERNEL_ABI_VERSION = 1;

export type KernelBufferType = 'u8' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64' | 'i64' | 'u64';
export type KernelSetOperation = 'union' | 'intersection' | 'difference' | 'symmetricDifference' | 'complement';
export type KernelMeasureOperation = KernelSetOperation;
export interface KernelPopulationMeasure {
  /** По четыре uint32 на группу: культура, вера, происхождение, принадлежность. */
  keys: Uint32Array;
  /** Одна неотрицательная масса на группу; неверие кодируется в ключе веры как UINT32_MAX. */
  mass: Float64Array;
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
