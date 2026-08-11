#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.easy_exam_runtime"

FRPC_BIN="${OPENFRP_BIN:-$RUNTIME_DIR/bin/openfrpc}"
TOKEN_FILE="${OPENFRP_TOKEN_FILE:-$RUNTIME_DIR/openfrp.token}"
TUNNEL_ID="${OPENFRP_TUNNEL_ID:-1202081}"

if [ ! -x "$FRPC_BIN" ]; then
  echo "OpenFrp client is not executable: $FRPC_BIN" >&2
  exit 1
fi

if [ ! -r "$TOKEN_FILE" ]; then
  echo "OpenFrp token file is not readable: $TOKEN_FILE" >&2
  exit 1
fi

OPENFRP_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
if [ -z "$OPENFRP_TOKEN" ]; then
  echo "OpenFrp token file is empty: $TOKEN_FILE" >&2
  exit 1
fi

exec "$FRPC_BIN" -u "$OPENFRP_TOKEN" -p "$TUNNEL_ID"
