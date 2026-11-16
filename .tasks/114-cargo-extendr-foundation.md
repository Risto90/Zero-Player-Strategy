---
id: cargo-extendr-foundation
title: Создать основу Cargo и R-пакета Extendr
issue_number: 114
relationship: parent|rust-extendr-migration
relationship: blocked_by|extendr-migration-architecture
subtask: cargo-workspace|01. Подготовить Cargo workspace и lock-файл|Создать workspace/crates и зафиксировать Rust toolchain и зависимости в Cargo.lock для всех целевых платформ.|115
subtask: r-package|02. Подготовить R-пакет с Extendr|Создать пакет R с DESCRIPTION, конфигурацией rextendr и Rust crate, не редактируя вручную генерируемые Extendr-обвязки.|116
subtask: r-dependencies|03. Закрепить R-зависимости собственным менеджером пакетов R|Настроить renv, сохранить renv.lock и проверить чистое восстановление зависимостей в среде без ранее установленного R-библиотечного кэша.|117
subtask: web-build|04. Подготовить воспроизводимую WebR и WASM-сборку|Настроить WebR, Rust/WASM targets и их сгенерированные артефакты; подтвердить запуск минимального Extendr-пакета в браузере.|118
---

## Что и зачем
Создать воспроизводимую основу миграции без pnpm. Cargo управляет Rust-кодом, `renv` фиксирует R-пакеты, а rextendr формирует обязательную границу между R и Rust.

## Точный алгоритм участка
Использовать шаблон Extendr для R-пакета и Rust crate. Сгенерированные `entrypoint.c`, R wrappers, configure/Makevars и wasm glue не редактировать вручную; в репозитории разрешены только те из них, которые нужны проверяемой сборке. Собственный C-код не добавлять.
Создать Cargo workspace и lock-файл, закрепить версии Rust toolchain и target triples. Восстанавливать R-зависимости только через `renv::restore()` из закоммиченного `renv.lock`; проверить очистку и повторное восстановление окружения. Для WebR зафиксировать используемые версии R, пакетов и wasm-артефактов в воспроизводимой сборке.
Добавить проверки `cargo test --locked`, R-проверку пакета и компиляцию WebR/WASM; не добавлять Node.js, pnpm или Python как runtime или менеджер сборки.

## Готово, когда
- Чистая среда восстанавливает Rust и R-зависимости только из lock-файлов.
- Минимальный R-вызов успешно проходит через Extendr в нативной сборке и WebR.
- `cargo test --locked`, проверка R-пакета и wasm-сборка воспроизводимы.


