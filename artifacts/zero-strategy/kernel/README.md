# Вычислительное ядро Zero Strategy

Исходники C++20 и стабильный C ABI находятся в `kernel/include` и `kernel/src`. Третьих сторонних библиотек у ядра нет. Компилятор WASM — Emscripten 4.0.8, нативный компилятор — Clang 20.1.8; Node.js-адаптер использует встроенный API Node.js и не добавляет npm-зависимостей. Сторонний исходный код и новые лицензии не добавляются.

Сборка создаёт однопоточный WASM, pthread WASM, Node.js-модуль и объектный файл JSI из одного исходного ядра. Все двоичные результаты и кэш Emscripten находятся в игнорируемом `generated-artifacts/kernel/`.

```sh
pnpm --filter @workspace/zero-strategy run kernel:build
pnpm --filter @workspace/zero-strategy run kernel:android-sdk
pnpm --filter @workspace/zero-strategy run kernel:android-build
pnpm --filter @workspace/zero-strategy run kernel:test
```

Установка использует закреплённую версию Android Command-line Tools и проверяет её SHA-256. SDK Manager запрашивает принятие лицензий интерактивно; команды не принимают их автоматически.

Android-сборка компилирует C ABI в `.so`, JSI-обвязку в `.a` и smoke-программу для `arm64-v8a` и `x86_64`. Она проверяет формат ELF, но для запуска smoke-программы требуется подключённое Android-устройство или эмулятор. SDK и артефакты находятся в игнорируемом каталоге `generated-artifacts/`.

TS-обвязки `bindings/wasm.ts` и `bindings/native.ts` принимают модуль через фабрику/интерфейс: игровой код не импортирует сгенерированные бинарные файлы напрямую. JSI-адаптер компилируется против заголовков установленного React Native. Текущий артефакт Zero Strategy остаётся браузерным; JSI не подключён к приложению.

Полный контракт, численная семантика, память, ошибки, многопоточность и статус платформ — в [`contract-v1.md`](./contract-v1.md).
