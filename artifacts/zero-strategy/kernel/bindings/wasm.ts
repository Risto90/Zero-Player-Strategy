import { KERNEL_ABI_VERSION, type KernelBuffer, type KernelBufferType } from './contracts';

export interface EmscriptenKernelModule {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _zk_abi_version(): number;
  _zk_execution_mode(): number;
  _zk_i32_add(left: number, right: number, resultPointer: number): number;
  _zk_buffer_create(type: number, count: number, resultPointer: number): number;
  _zk_buffer_release(handle: bigint): number;
  _zk_buffer_data(handle: bigint, byteLengthPointer: number, errorPointer: number): number;
  _zk_buffer_i32_sum(handle: bigint, start: number, count: number, resultPointer: number): number;
}

const TYPE_IDS: Record<KernelBufferType, number> = {
  u8: 1, u16: 2, i32: 3, u32: 4, f32: 5, f64: 6, i64: 7, u64: 8,
};

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
 * Создаёт TS-обвязку над Emscripten-модулем. Каждый буфер остаётся в памяти WASM;
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
  };
}

function validateCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff_ffff) {
    throw new RangeError('Количество элементов должно быть целым числом uint32');
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
