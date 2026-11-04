#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 3 ]]; then
  echo "Использование: with-nix-packages.sh пакет [пакет ...] -- команда [аргументы ...]" >&2
  exit 2
fi

packages=()
while [[ "$#" -gt 0 && "$1" != "--" ]]; do
  packages+=("$1")
  shift
done

if [[ "$#" -eq 0 || "${#packages[@]}" -eq 0 ]]; then
  echo "Нужно указать пакеты Nix и команду после --." >&2
  exit 2
fi
shift
if [[ "$#" -eq 0 ]]; then
  echo "Не указана команда для запуска." >&2
  exit 2
fi

# Версия набора Nixpkgs должна совпадать с каналом в .replit.
nixpkgs_archive="${REPLIT_NIXPKGS_ARCHIVE:-https://storage.googleapis.com/replit-nixpkgs/nixpkgs-25.05.tar.gz}"
printf -v command_line '%q ' "$@"

exec nix-shell \
  -I "nixpkgs=$nixpkgs_archive" \
  -p "${packages[@]}" \
  --run "$command_line"
