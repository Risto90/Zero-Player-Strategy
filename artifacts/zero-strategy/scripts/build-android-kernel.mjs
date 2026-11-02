import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(appRoot, 'generated-artifacts', 'android-kernel');
const sdkRoot =
  process.env.ANDROID_SDK_ROOT ??
  path.join(appRoot, 'generated-artifacts', 'android-sdk');
const toolchain = JSON.parse(
  readFileSync(path.join(appRoot, 'kernel', 'toolchain.json'), 'utf8'),
);
const ndkRoot = path.join(sdkRoot, 'ndk', toolchain.androidNdk);
const cmake = path.join(sdkRoot, 'cmake', toolchain.androidCmake, 'bin', 'cmake');
const sdkmanager = path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager');
const readelf = path.join(
  ndkRoot,
  'toolchains',
  'llvm',
  'prebuilt',
  'linux-x86_64',
  'bin',
  'llvm-readelf',
);
const androidCompiler = path.join(
  ndkRoot,
  'toolchains',
  'llvm',
  'prebuilt',
  'linux-x86_64',
  'bin',
  'clang++',
);
const sourceRoot = path.join(appRoot, 'kernel', 'android');
const reactNativeRoot = path.join(appRoot, 'node_modules', 'react-native');
const expectedMachines = {
  'arm64-v8a': 'AArch64',
  x86_64: 'Advanced Micro Devices X86-64',
};
const architectures = toolchain.androidAbis.map((abi) => {
  const expectedMachine = expectedMachines[abi];
  if (!expectedMachine) throw new Error(`Неизвестная Android ABI: ${abi}`);
  return { abi, expectedMachine };
});
const builtArtifacts = [];

for (const requiredPath of [
  cmake,
  sdkmanager,
  androidCompiler,
  path.join(ndkRoot, 'build', 'cmake', 'android.toolchain.cmake'),
  path.join(reactNativeRoot, 'ReactCommon', 'jsi', 'jsi', 'jsi.h'),
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Не найден Android-компонент: ${requiredPath}`);
  }
}

const sdkmanagerVersion = readCommand(sdkmanager, ['--version']).trim();
if (sdkmanagerVersion !== toolchain.androidSdkManager) {
  throw new Error(
    `Ожидается SDK Manager ${toolchain.androidSdkManager}, установлен ${sdkmanagerVersion}`,
  );
}
const androidCompilerVersion = readCommand(androidCompiler, ['--version']).split('\n')[0];

mkdirSync(outputRoot, { recursive: true });
for (const { abi, expectedMachine } of architectures) {
  const buildDir = path.join(outputRoot, abi);
  run(cmake, [
    '-S',
    sourceRoot,
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_TOOLCHAIN_FILE=${path.join(ndkRoot, 'build', 'cmake', 'android.toolchain.cmake')}`,
    `-DANDROID_ABI=${abi}`,
    `-DANDROID_PLATFORM=android-${toolchain.androidApi}`,
    '-DANDROID_STL=c++_shared',
    `-DREACT_NATIVE_ROOT=${reactNativeRoot}`,
  ]);
  run(cmake, ['--build', buildDir, '--parallel', '2']);

  for (const artifact of [
    path.join(buildDir, 'libzero_kernel_android.so'),
    path.join(buildDir, 'libzero_kernel_jsi.a'),
    path.join(buildDir, 'zero_kernel_android_smoke'),
  ]) {
    if (!existsSync(artifact)) {
      throw new Error(`Android-артефакт не создан: ${artifact}`);
    }
    builtArtifacts.push(path.relative(outputRoot, artifact));
  }

  const header = readCommand(readelf, ['-h', path.join(buildDir, 'libzero_kernel_android.so')]);
  if (!header.includes(expectedMachine)) {
    throw new Error(`Артефакт ${abi} имеет неверную архитектуру.`);
  }
  console.log(`Android ${abi}: C ABI, JSI-адаптер и smoke-программа собраны.`);
}
writeFileSync(
  path.join(outputRoot, 'build-info.json'),
  `${JSON.stringify(
    {
      sdkManager: sdkmanagerVersion,
      ndk: toolchain.androidNdk,
      cmake: toolchain.androidCmake,
      compiler: androidCompilerVersion,
      androidApi: toolchain.androidApi,
      abis: toolchain.androidAbis,
      reactNative: JSON.parse(
        readFileSync(path.join(reactNativeRoot, 'package.json'), 'utf8'),
      ).version,
      artifacts: builtArtifacts,
      runtimeSmokeExecuted: false,
    },
    null,
    2,
  )}\n`,
);
console.log('Android smoke-программы собраны, но не запускались: эмулятор/устройство не подключены.');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Не удалось выполнить ${command}: ${result.error?.message ?? `код ${result.status}`}`,
    );
  }
}

function readCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: process.env });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Не удалось выполнить ${command}: ${result.error?.message ?? `код ${result.status}`}`,
    );
  }
  return result.stdout;
}
