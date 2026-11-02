import {
  KERNEL_ABI_VERSION,
  type KernelBufferType,
  type KernelMeasureOperation,
  type KernelPopulationMeasure,
  type KernelSetOperation,
  type NativeKernelBinding,
} from './contracts';

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

export { BUFFER_CTORS };
