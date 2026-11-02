# Подготовка JSI-адаптера

Этот адаптер предназначен для собственного Expo-модуля; текущий артефакт Zero Strategy собирается только для браузера. Expo Go не может загружать произвольный C++/JSI-код. Адаптер не подключён к приложению.

## Android

Команда `pnpm --filter @workspace/zero-strategy run kernel:android-build` собирает C ABI, JSI-архив и smoke-программу через Android NDK для `arm64-v8a` и `x86_64`. Для повторной сборки требуются закреплённые в `kernel/toolchain.json` SDK-компоненты и JSI-заголовки установленного React Native. Smoke-программа компилируется, но требует устройство/эмулятор для запуска.

## iOS

В нативный Expo-модуль нужно включить `zero_kernel_jsi.cpp`, `src/core.cpp` и `src/buffers/buffer_store.cpp`, добавить каталоги `include` и `ReactCommon/jsi` в пути заголовков, задать стандарт C++20 и связать исходники с JSI из React Native. При упаковке через CocoaPods для target требуется `CLANG_CXX_LANGUAGE_STANDARD = c++20`. Сборка и запуск требуют Xcode на macOS; они здесь не выполнялись.

Проверка компиляции JSI-переводной единицы на Linux не выдаётся за iOS-сборку или запуск приложения.
