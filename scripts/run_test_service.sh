#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_ROOT="${YIKAO_TEST_ROOT:-$HOME/Library/Application Support/yikao-auto-config-test/YKAI001}"
RUNTIME_DIR="$TEST_ROOT/runtime"

mkdir -p "$RUNTIME_DIR" "$TEST_ROOT/logs"
chmod 700 "$TEST_ROOT" "$RUNTIME_DIR"

DEFAULT_DEPENDENCIES="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
NODE_BIN="${CODEX_NODE:-$DEFAULT_DEPENDENCIES/node/bin/node}"
PYTHON_BIN="${CODEX_PYTHON:-$DEFAULT_DEPENDENCIES/python/bin/python3}"

if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="$(command -v python3)"
fi

# Test mode is deliberately local-only and cannot inherit production secrets.
export HOST=127.0.0.1
export PORT=8766
export NODE_ENV=production
export CODEX_NODE="$NODE_BIN"
export CODEX_PYTHON="$PYTHON_BIN"
export EASY_EXAM_RUNTIME_DIR="$RUNTIME_DIR"
export REQUIREMENT_DB_PATH="$RUNTIME_DIR/requirement_requests.sqlite3"
export APP_LOGIN_EMAIL=
export APP_LOGIN_PASSWORD=
export YIKAO_API_BASE=
export YIKAO_API_KEY=
export TENCENT_DOC_CLIENT_ID=
export TENCENT_DOC_ACCESS_TOKEN=
export TENCENT_DOC_OPEN_ID=
export TENCENT_DOC_FILE_ID=
export TENCENT_DOC_SHEET_ID=
export PAPER_BIND_SCHEDULER_DISABLED=1
export SCORE_PROCESS_SCHEDULER_DISABLED=1
export OPERATION_ARCHIVE_EVIDENCE_SCHEDULER_DISABLED=1
export OPERATION_CONSOLE_AUTOMATION_ENABLED=0
export SCORE_STAMP_AUTO_DISABLED=1

exec "$NODE_BIN" "$ROOT_DIR/server/easy_exam_server.mjs"
