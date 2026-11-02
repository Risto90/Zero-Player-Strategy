# Вычислительное ядро Zero Strategy

Исходники C++20 и стабильный C ABI находятся в `kernel/include` и `kernel/src`. Ядро не использует сторонние библиотеки. Компилятор WASM — Emscripten 4.0.8, нативный компилятор — Clang 20.1.8. Node.js-адаптер использует встроенный API Node.js и не добавляет npm-зависимостей.

Сборка создаёт однопоточный WASM, WASM с pthread, Node.js-модуль и объектный файл JSI из общего исходного кода. Двоичные результаты и кэш Emscripten находятся в игнорируемом каталоге `generated-artifacts/kernel/`.

```sh
pnpm --filter @workspace/zero-strategy run kernel:build
pnpm --filter @workspace/zero-strategy run kernel:android-sdk
pnpm --filter @workspace/zero-strategy run kernel:android-build
pnpm --filter @workspace/zero-strategy run kernel:test
pnpm --filter @workspace/zero-strategy run test:algebra
```

Установка Android использует закреплённую версию Command-line Tools и проверяет её SHA-256. SDK Manager запрашивает принятие лицензий интерактивно; команды не принимают их автоматически.

Android-сборка компилирует C ABI в `.so`, JSI-обвязку в `.a` и smoke-программу для `arm64-v8a` и `x86_64`. Она проверяет формат ELF, но запуск smoke-программы требует Android-устройство или эмулятор. SDK и артефакты находятся в игнорируемом каталоге `generated-artifacts/`.

TS-обвязки `bindings/wasm.ts` и `bindings/native.ts` принимают модуль через фабрику или интерфейс; игровой код не импортирует сгенерированные бинарные файлы напрямую. JSI-адаптер компилируется с заголовками установленного React Native. Текущий артефакт Zero Strategy предназначен для браузера; JSI не подключён к приложению.

Алгебра множеств и населения описана в [`algebra-contract.md`](./algebra-contract.md). Полный контракт ABI, память, ошибки, многопоточность и платформы описаны в [`contract-v1.md`](./contract-v1.md).
