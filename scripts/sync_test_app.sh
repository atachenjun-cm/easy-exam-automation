#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$HOME/Library/Application Support/yikao-auto-config-test/YKAI001/app"
EXPECTED_TARGET="$HOME/Library/Application Support/yikao-auto-config-test/YKAI001/app"
DEPENDENCY_DIR="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"

if [ "$TARGET_DIR" != "$EXPECTED_TARGET" ]; then
  echo "Unexpected test app target: $TARGET_DIR" >&2
  exit 2
fi
if lsof -nP -iTCP:8766 -sTCP:LISTEN | tail -n +2 | rg -q .; then
  echo "Stop the 8766 service before synchronizing test code." >&2
  exit 3
fi

mkdir -p "$TARGET_DIR"

sync_directory() {
  relative_path="$1"
  mkdir -p "$TARGET_DIR/$relative_path"
  rsync -a --delete --exclude='.DS_Store' \
    "$SOURCE_DIR/$relative_path/" "$TARGET_DIR/$relative_path/"
}

for relative_path in server scripts web deploy template outputs/web_prototype; do
  sync_directory "$relative_path"
done

for relative_path in .env.example package.json requirements.txt README.md WORKING_MEMORY.md; do
  if [ -f "$SOURCE_DIR/$relative_path" ]; then
    cp "$SOURCE_DIR/$relative_path" "$TARGET_DIR/$relative_path"
  fi
done

if [ -e "$TARGET_DIR/node_modules" ] && [ ! -L "$TARGET_DIR/node_modules" ]; then
  echo "Refusing to replace non-symlink test node_modules." >&2
  exit 4
fi
if [ ! -e "$TARGET_DIR/node_modules" ]; then
  ln -s "$DEPENDENCY_DIR" "$TARGET_DIR/node_modules"
fi

printf 'Test application synchronized to %s\n' "$TARGET_DIR"
