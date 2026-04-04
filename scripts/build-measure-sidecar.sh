#!/usr/bin/env bash
# Build measure-server with PyInstaller and print the Tauri binary destination.
# Run from repository root: ManimStuff/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "Install PyInstaller: pip install pyinstaller" >&2
  exit 1
fi

pyinstaller scripts/measure-server.spec

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
OUT_NAME="measure-server-${TRIPLE}"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    EXT=".exe"
    ;;
  *)
    EXT=""
    ;;
esac

TAURI_BIN_DIR="$ROOT/manim-timeline/src-tauri/binaries"
mkdir -p "$TAURI_BIN_DIR"

SRC="$ROOT/dist/measure-server/measure-server${EXT}"
if [[ ! -x "$SRC" ]] && [[ ! -f "$SRC" ]]; then
  echo "Expected binary not found: $SRC" >&2
  exit 1
fi

DEST="$TAURI_BIN_DIR/${OUT_NAME}${EXT}"
cp -f "$SRC" "$DEST"
echo "Copied sidecar to: $DEST"
echo "Registered in tauri.conf.json as: binaries/measure-server"
