---
id: rust-extendr-migration
title: Перевести Zero Strategy на Rust и Extendr
issue_number: 109
relationship: sub_issue|population-contour-kernel
relationship: sub_issue|extendr-migration-architecture
relationship: sub_issue|cargo-extendr-foundation
relationship: sub_issue|game-engine-saves
relationship: sub_issue|webr-rust-interface
relationship: sub_issue|northsea-graphics-profiles
relationship: sub_issue|legacy-stack-removal
relationship: sub_issue|cargo-package-release
relationship: sub_issue|github-pages-web-game
relationship: sub_issue|migration-platform-acceptance

---

# Перевести Zero Strategy на Rust и Extendr

## Что и зачем
Перевести приложение с Expo, TypeScript, Node.js и pnpm на архитектуру R + Rust с Extendr, Cargo и WebR. Сохранить игровые правила, данные, визуальный результат и единое исполнение действий игрока и ИИ. Выполнять перенос этапами; старые компоненты удалять только после переноса и проверок их замены.

## Целевая архитектура
- Игровое ядро и высокопроизводительная геометрия реализованы на Rust; функции, предназначенные для R, связываются через Extendr.
- R-код и его зависимости фиксируются как R-пакет с `renv.lock`; Rust-зависимости — в `Cargo.lock`.
- Браузерная версия запускает R-пакет в WebR и Rust/WASM-компоненты. Пользовательские интерфейсы не реализуются на TypeScript или Expo.
- Основной графический профиль — WebGPU. Выбор нативного Vulkan и браузерного WebGL следует правилам NorthSea и описан в дочерней задаче графических профилей.
- Разрешён только сгенерированный Extendr C-мост (`entrypoint.c`) и прочий сгенерированный glue-код, необходимый сборщику. Самостоятельно поддерживаемые C-файлы, Node.js runtime и зависимости, Python, TypeScript, Expo и pnpm удаляются.

## Готово, когда
- Все дочерние задачи закрыты; все действующие экраны, игровые механики, сохранения, генераторы, инструменты и тесты перенесены или имеют явно описанную замену.
- Реальный путь исполнения использует R + Rust/Extendr, а браузер работает через WebR и Rust/WASM без приложения на TypeScript или Expo.
- Выбор графического API, Android/Linux/Web сборки, нумерация версий и GitHub Pages соответствуют требованиям NorthSea.
- Только после успешных проверок старые файлы, скрипты, lock-файлы и зависимости удалены; в репозитории не осталось прикладного кода Python, TypeScript, Expo, Node.js, pnpm или вручную написанного C.
- Все задачи #9 и #12–31 остаются заблокированы этой группой до её завершения; задача #8 не открывается и не включается.

## Внешние спецификации
- Архитектура графики и сборки: https://github.com/Risto90/NorthSea
- Сборка Extendr и R-пакета: https://extendr.rs/user-guide/package-structure.html
- Поддержка Extendr в WebR: https://extendr.rs/user-guide/webr.html


