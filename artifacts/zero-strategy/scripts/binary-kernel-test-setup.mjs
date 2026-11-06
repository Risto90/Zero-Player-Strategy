import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createWasmKernel } from '../generated-artifacts/kernel/wasm/wasm-binding.mjs';
import createModule from '../generated-artifacts/kernel/wasm/zero_kernel.mjs';
import { installBinaryMathKernel } from '../kernel/runtime.ts';

const wasmRoot = path.resolve(process.cwd(), 'generated-artifacts/kernel/wasm');
const wasmBinary = readFileSync(path.join(wasmRoot, 'zero_kernel.wasm'));
const wasmModule = await createModule({ wasmBinary });
installBinaryMathKernel(createWasmKernel(wasmModule));
