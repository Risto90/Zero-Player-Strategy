#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Удаляю зависимости Node.js после завершения production-сборки."
find "$root" -name node_modules -prune -exec rm -rf -- {} +

echo "Очищаю кэш pnpm, не нужный для запуска production-сервисов."
pnpm store prune
