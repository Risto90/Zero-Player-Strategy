import { createWasmKernel } from './bindings/wasm';
import { binaryMathKernelReady, installBinaryMathKernel } from './runtime';

type KernelFactory = (options: {
  wasmBinary: ArrayBuffer;
  locateFile: (path: string) => string;
}) => Promise<Parameters<typeof createWasmKernel>[0]>;

let initialization: Promise<void> | undefined;

function browserKernelBase(): URL {
  const configuredBase = document.querySelector('base')?.href;
  const prefix = configuredBase
    ? new URL(configuredBase).pathname
    : window.location.pathname.startsWith('/zero-strategy')
      ? '/zero-strategy/'
      : '/';
  return new URL('generated-kernel/', new URL(prefix, window.location.origin));
}

export function initializeBrowserBinaryMathKernel(): Promise<void> {
  if (binaryMathKernelReady()) return Promise.resolve();
  if (initialization) return initialization;
  initialization = (async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('Бинарное математическое ядро предназначено для браузерной версии');
    }

    const base = browserKernelBase();
    const moduleUrl = new URL('zero_kernel.mjs', base);
    const wasmUrl = new URL('zero_kernel.wasm', base);
    const [moduleResponse, wasmResponse] = await Promise.all([
      fetch(moduleUrl),
      fetch(wasmUrl),
    ]);
    if (!moduleResponse.ok || !wasmResponse.ok) {
      throw new Error(
        `Не удалось получить бинарное ядро (${moduleResponse.status}/${wasmResponse.status})`,
      );
    }
    const wasmBinary = await wasmResponse.arrayBuffer();
    const dynamicImport = new Function(
      'url',
      'return import(url)',
    ) as (url: string) => Promise<{ default: KernelFactory }>;
    const { default: createModule } = await dynamicImport(moduleUrl.href);
    const module = await createModule({
      wasmBinary,
      locateFile: () => wasmUrl.href,
    });
    installBinaryMathKernel(createWasmKernel(module));
  })().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
