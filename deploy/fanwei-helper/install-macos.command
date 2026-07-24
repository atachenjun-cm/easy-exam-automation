#!/bin/bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/Library/Application Support/YikaoFanweiHelper"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$HOME/Library/LaunchAgents/com.ata.yikao-fanwei-helper.plist"
LABEL="com.ata.yikao-fanwei-helper"
CONFIG_SOURCE="$SOURCE_DIR/config.env"
CONSOLE_ORIGINS="$(grep -E '^YIKAO_CONSOLE_ORIGINS=' "$CONFIG_SOURCE" 2>/dev/null | head -n 1 | cut -d= -f2- || true)"
CONSOLE_ORIGIN="${CONSOLE_ORIGINS%%[ ,]*}"
CONSOLE_ORIGIN="${CONSOLE_ORIGIN:-http://172.16.13.214:8765}"
CONSOLE_URL="${CONSOLE_ORIGIN%/}/fanwei-test"

echo "[1/4] 正在安装易考泛微本机助手..."
mkdir -p "$INSTALL_DIR" "$LAUNCH_AGENT_DIR"
launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true

cp -R "$SOURCE_DIR/server" "$INSTALL_DIR/"
cp "$SOURCE_DIR/node" "$INSTALL_DIR/node"
cp "$SOURCE_DIR/com.ata.yikao-fanwei-helper.plist.template" "$INSTALL_DIR/"
chmod 700 "$INSTALL_DIR/node"

if [ -f "$CONFIG_SOURCE" ]; then
  grep -v '^YIKAO_HELPER_RUNTIME_DIR=' "$CONFIG_SOURCE" >"$INSTALL_DIR/config.env"
else
  cat >"$INSTALL_DIR/config.env" <<EOF
YIKAO_HELPER_HOST=127.0.0.1
YIKAO_HELPER_PORT=18765
YIKAO_HELPER_CHROME_PORT=19222
YIKAO_CONSOLE_ORIGINS=$CONSOLE_ORIGIN
EOF
fi
cat >>"$INSTALL_DIR/config.env" <<EOF
YIKAO_HELPER_RUNTIME_DIR=$INSTALL_DIR
EOF
chmod 600 "$INSTALL_DIR/config.env"

echo "[2/4] 正在注册当前用户启动项..."
ESCAPED_INSTALL_DIR=${INSTALL_DIR//&/\\&}
ESCAPED_CONSOLE_ORIGINS=${CONSOLE_ORIGINS//&/\\&}
sed -e "s|__HELPER_DIR__|$ESCAPED_INSTALL_DIR|g" \
  -e "s|__CONSOLE_ORIGINS__|$ESCAPED_CONSOLE_ORIGINS|g" \
  "$SOURCE_DIR/com.ata.yikao-fanwei-helper.plist.template" >"$PLIST_PATH"
chmod 600 "$PLIST_PATH"

echo "[3/4] 正在启动本机助手..."
launchctl bootstrap "gui/$UID" "$PLIST_PATH"
launchctl kickstart -k "gui/$UID/com.ata.yikao-fanwei-helper"

echo "[4/4] 正在打开共享泛微页面..."
open "$CONSOLE_URL"
echo "安装完成。首次使用请在自动打开的专用 Chrome 中登录泛微。"
