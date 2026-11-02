#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_ROOT="${ANDROID_SDK_ROOT:-$APP_ROOT/generated-artifacts/android-sdk}"
TOOLCHAIN_FILE="$APP_ROOT/kernel/toolchain.json"
mapfile -t TOOLCHAIN_VALUES < <(node -e '
  const t = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  console.log(t.androidCommandLineToolsRevision);
  console.log(t.androidCommandLineToolsSha256);
  console.log(t.androidNdk);
  console.log(t.androidCmake);
' "$TOOLCHAIN_FILE")
TOOLS_REVISION="${TOOLCHAIN_VALUES[0]}"
TOOLS_SHA256="${TOOLCHAIN_VALUES[1]}"
ARCHIVE="$SDK_ROOT/downloads/commandlinetools-linux-${TOOLS_REVISION}_latest.zip"
SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"

mkdir -p "$SDK_ROOT/downloads"
if [[ ! -x "$SDKMANAGER" ]]; then
  if [[ ! -f "$ARCHIVE" ]]; then
    curl -fL --retry 3 --retry-all-errors \
      "https://dl.google.com/android/repository/commandlinetools-linux-${TOOLS_REVISION}_latest.zip" \
      -o "$ARCHIVE"
  fi
  printf '%s  %s\n' "$TOOLS_SHA256" "$ARCHIVE" | sha256sum -c -
  mkdir -p "$SDK_ROOT/cmdline-tools/unpacked" "$SDK_ROOT/cmdline-tools/latest"
  unzip -oq "$ARCHIVE" -d "$SDK_ROOT/cmdline-tools/unpacked"
  cp -a "$SDK_ROOT/cmdline-tools/unpacked/cmdline-tools/." \
    "$SDK_ROOT/cmdline-tools/latest/"
fi

if [[ ! -t 0 ]]; then
  echo "Для установки SDK нужны интерактивное принятие лицензий и подтверждение условий." >&2
  echo "Запустите эту команду из терминала с вводом пользователя." >&2
  exit 2
fi

export ANDROID_HOME="$SDK_ROOT"
export ANDROID_SDK_ROOT="$SDK_ROOT"
"$SDKMANAGER" --sdk_root="$SDK_ROOT" --licenses
"$SDKMANAGER" --sdk_root="$SDK_ROOT" --install \
  "ndk;${TOOLCHAIN_VALUES[2]}" \
  "cmake;${TOOLCHAIN_VALUES[3]}"
