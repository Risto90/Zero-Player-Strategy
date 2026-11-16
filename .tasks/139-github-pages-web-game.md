---
id: github-pages-web-game
title: Опубликовать браузерную игру через GitHub Pages
issue_number: 139
relationship: parent|rust-extendr-migration
relationship: blocked_by|webr-rust-interface
relationship: blocked_by|northsea-graphics-profiles
relationship: blocked_by|cargo-package-release
subtask: pages-build|01. Собрать статический WebR и Rust/WASM сайт|Собрать все browser runtime артефакты, ресурсы и release metadata в отдельный каталог публикации.|140
subtask: pages-path|02. Настроить путь проекта для GitHub Pages|Обеспечить корректные URL, base path и загрузку ресурсов из страницы репозитория, а не только из корня домена.|141
subtask: pages-deploy|03. Развернуть и проверить сайт после успешных тестов|Использовать GitHub Pages Actions и проверить опубликованный URL на загрузку игры и корректный WebGPU/WebGL выбор.|142

---

## Что и зачем
Добавить вкладку/адрес браузерной версии Zero Strategy через GitHub Pages, повторив NorthSea-путь сборки и публикации.

## Точный алгоритм участка
Workflow должен собрать WebR/R-пакет и Rust/WASM для публикации в отдельный статический каталог, включая все ресурсы и метаданные версии. Настроить GitHub Pages base path для репозитория `Zero-Player-Strategy`; не рассчитывать, что сайт будет размещён в корне домена.
После успешных проверок настроить Pages, загрузить артефакт и развернуть его официальными GitHub Pages actions. Публикацию Pages не запускать при провале проверок сборки, паритета или графических профилей. Сохранить адрес/вкладку браузерной игры доступными пользователю и проверить открытие по опубликованному URL.

## Готово, когда
- Вкладка/адрес Web-версии открывает рабочую игру на GitHub Pages, включая загрузку WebR/WASM по корректным путям.
- Проверены мобильный и настольный браузеры, WebGPU, резервный WebGL и диагностика отсутствия обоих API.
- Ошибка теста блокирует публикацию; workflow не меняет GitHub Pages на частично собранный сайт.


