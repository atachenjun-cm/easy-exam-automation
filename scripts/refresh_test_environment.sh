#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.chen.yikao-auto-config-test"
TARGET="gui/$(id -u)/$LABEL"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PYTHON_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
INCLUDE_UPLOADS=""

if [ "${1:-}" = "--include-uploads" ]; then
  INCLUDE_UPLOADS="--include-uploads"
elif [ -n "${1:-}" ]; then
  echo "Usage: refresh_test_environment.sh [--include-uploads]" >&2
  exit 2
fi

production_pid="$(lsof -nP -iTCP:8765 -sTCP:LISTEN -t | head -n 1)"
if [ -z "$production_pid" ]; then
  echo "Production 8765 is not listening; refusing to refresh." >&2
  exit 3
fi
curl -fsS http://127.0.0.1:8765/api/health >/dev/null

if launchctl print "$TARGET" >/dev/null 2>&1; then
  launchctl bootout "$TARGET"
fi

for _ in $(seq 1 50); do
  if ! lsof -nP -iTCP:8766 -sTCP:LISTEN | tail -n +2 | rg -q .; then
    break
  fi
  sleep 0.1
done
if lsof -nP -iTCP:8766 -sTCP:LISTEN | tail -n +2 | rg -q .; then
  echo "Port 8766 is still in use; refusing to overwrite test data." >&2
  exit 4
fi

"$PYTHON_BIN" "$ROOT_DIR/scripts/refresh_test_runtime.py" $INCLUDE_UPLOADS

if [ ! -f "$PLIST" ]; then
  "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
    "$ROOT_DIR/scripts/test_service_launchd.mjs" install >/dev/null
else
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
fi

for _ in $(seq 1 50); do
  if curl -fsS http://127.0.0.1:8766/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
curl -fsS http://127.0.0.1:8766/api/health >/dev/null

current_production_pid="$(lsof -nP -iTCP:8765 -sTCP:LISTEN -t | head -n 1)"
if [ "$current_production_pid" != "$production_pid" ]; then
  echo "Production 8765 PID changed unexpectedly." >&2
  exit 5
fi
curl -fsS http://127.0.0.1:8765/api/health >/dev/null
printf '8766 refreshed; production 8765 PID unchanged: %s\n' "$production_pid"
