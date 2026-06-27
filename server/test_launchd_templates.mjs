import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("easy exam service launchd template points at the Application Support runtime", () => {
  const plist = fs.readFileSync(path.join(rootDir, "deploy", "com.ata.easy-exam-service.plist.template"), "utf8");
  assert.match(plist, /<string>com\.ata\.easy-exam-service<\/string>/);
  assert.match(plist, /\/Users\/ata\/Library\/Application Support\/easy-exam-automation\/app\/scripts\/run_local_service\.sh/);
  assert.doesNotMatch(plist, /\/Users\/ata\/Documents\/easy-exam-automation/);
  assert.equal(plist.includes("/Users/chen"), false);
});

test("local service runner uses current bundled runtimes", () => {
  const script = fs.readFileSync(path.join(rootDir, "scripts", "run_local_service.sh"), "utf8");
  assert.match(script, /\/Users\/ata\/\.cache\/codex-runtimes\/codex-primary-runtime\/dependencies\/node\/bin\/node/);
  assert.match(script, /\/Users\/ata\/\.cache\/codex-runtimes\/codex-primary-runtime\/dependencies\/python\/bin\/python3/);
  assert.equal(script.includes("/Users/chen"), false);
});

test("wechat collector launchd template uses OCR capture mode", () => {
  const plist = fs.readFileSync(path.join(rootDir, "deploy", "com.ata.easy-exam-wechat-collector.plist.template"), "utf8");
  assert.match(plist, /<string>--captureMode<\/string>\s*<string>ocr<\/string>/);
  assert.match(plist, /\/Users\/ata\/Library\/Application Support\/easy-exam-automation\/app\/scripts\/wechat_visible_collect\.mjs/);
  assert.match(plist, /\/Users\/ata\/Library\/Application Support\/easy-exam-automation\/runtime\/wechat-requirement-groups\.json/);
  assert.doesNotMatch(plist, /\/Users\/ata\/Documents\/easy-exam-automation/);
});
