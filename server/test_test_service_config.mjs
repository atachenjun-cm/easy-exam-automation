import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const startScript = await readFile(new URL("../scripts/run_test_service.sh", import.meta.url), "utf8");
const syncScript = await readFile(new URL("../scripts/sync_test_app.sh", import.meta.url), "utf8");
const launchdManager = await readFile(new URL("../scripts/test_service_launchd.mjs", import.meta.url), "utf8");
const refreshScript = await readFile(new URL("../scripts/refresh_test_environment.sh", import.meta.url), "utf8");
const plistTemplate = await readFile(new URL("../deploy/com.chen.yikao-auto-config-test.plist.template", import.meta.url), "utf8");

test("test service is isolated from production runtime and automatic actions", () => {
  assert.match(startScript, /export HOST=127\.0\.0\.1/);
  assert.match(startScript, /export PORT=8766/);
  assert.match(startScript, /yikao-auto-config-test\/YKAI001/);
  assert.match(startScript, /export PAPER_BIND_SCHEDULER_DISABLED=1/);
  assert.match(startScript, /export SCORE_PROCESS_SCHEDULER_DISABLED=1/);
  assert.match(startScript, /export OPERATION_ARCHIVE_EVIDENCE_SCHEDULER_DISABLED=1/);
  assert.match(startScript, /export OPERATION_CONSOLE_AUTOMATION_ENABLED=0/);
  assert.doesNotMatch(startScript, /sync_local_runtime/);
});

test("test launch agent has a distinct label and source working directory", () => {
  assert.match(plistTemplate, /com\.chen\.yikao-auto-config-test/);
  assert.match(plistTemplate, /__YIKAO_TEST_APP_DIR__\/scripts\/run_test_service\.sh/);
  assert.match(plistTemplate, /<key>KeepAlive<\/key>/);
  assert.match(launchdManager, /const testAppDir = path\.join\(testRoot, "app"\)/);
  assert.match(launchdManager, /sync_test_app\.sh/);
});

test("test application sync has a fixed target and refuses a running 8766", () => {
  assert.match(syncScript, /yikao-auto-config-test\/YKAI001\/app/);
  assert.match(syncScript, /lsof -nP -iTCP:8766 -sTCP:LISTEN/);
  assert.match(syncScript, /rsync -a --delete/);
  assert.doesNotMatch(syncScript, /yikao-auto-config-web/);
});

test("refresh script protects the production listener identity", () => {
  assert.match(refreshScript, /production_pid=/);
  assert.match(refreshScript, /current_production_pid=/);
  assert.match(refreshScript, /Production 8765 PID changed unexpectedly/);
  assert.doesNotMatch(refreshScript, /sync_local_runtime/);
});
