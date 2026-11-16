---
id: replit-task-237
title: Перенести пакетную сборку и выпуск на Cargo
relationship: parent|replit-task-230
relationship: blocked_by|replit-task-236
relationship: sub_issue|replit-task-202
relationship: sub_issue|replit-task-203
---

## Что и зачем
Заменить Expo/EAS и pnpm-сборку пакетов воспроизводимым Cargo + R/rextendr workflow, взяв за основу проверенные сценарии NorthSea. Тестовая APK и APK опубликованной версии остаются отдельными дочерними задачами #202 и #203.

## Точный алгоритм участка
Собрать workflow, запускаемый вручную только из `main`. Устанавливать закреплённый Rust toolchain и нужные Android targets, JDK/Android SDK/NDK, Linux-инструменты упаковки и R/rextendr с восстановлением `renv.lock`. Проверять `cargo test --locked` и R-пакет до упаковки.
Собирать Android ARM64 APK через `cargo-apk`, Linux DEB и RPM из Cargo release binary, а браузерную сборку — через Rust/WASM и WebR. До публикации проверять подпись, package/version/versionCode, устанавливать APK в подходящей ARM64 среде, устанавливать DEB/RPM штатными пакетными менеджерами и запускать установленную игру. Для исходного ZIP и tar.gz проверять повторную сборку из архива.
Использовать схему версии NorthSea `GLOBAL_RELEASE.MMYY.counter.commit_count`: `MMYY` рассчитывать по `Europe/Moscow`; при совпадении GLOBAL_RELEASE и месяца увеличивать counter последнего успешного релиза, иначе начинать его с нуля; commit_count считать от родительского коммита предыдущего релиза до собираемого HEAD, минимум 1. Android `versionCode` считать отдельным монотонным алгоритмом. Не создавать tag, Release или увеличенную успешную версию, если любая сборка/проверка/публикация завершилась ошибкой.
Сохранять выходные APK, DEB, RPM и веб-архив в игнорируемом `generated-artifacts/`; Release публиковать только после всех обязательных проверок. Публикацию Pages выполнять отдельным дочерним этапом после готовой и проверенной web-сборки.

## Готово, когда
- Workflow запускается вручную из `main`; релиз не публикуется при провале любой обязательной проверки.
- Все пакеты создаются из одного commit/version и устанавливаются/запускаются в своих проверочных средах.
- Версия общего релиза и Android versionCode воспроизводимы и не расходятся после неудачного запуска.
- Задачи #202 и #203 выполняют тестовый и production-сценарии этой сборки соответственно.

## Релевантные спецификации
- NorthSea workflow: https://github.com/Risto90/NorthSea/blob/main/.github/workflows/build-packages.yml
- Скрипт версии: https://github.com/Risto90/NorthSea/blob/main/scripts/next-release-version.sh
- Android versionCode: https://github.com/Risto90/NorthSea/blob/main/scripts/android-release-version.sh
- Сборка Android/Linux/Web: `scripts/build-android-apk.sh`, `scripts/build-linux-packages.sh`, `scripts/build-web.sh`

