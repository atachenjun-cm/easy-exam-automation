import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getEasyExamServiceLaunchdStatus,
  getWechatCollectorLaunchdStatus,
  installEasyExamServiceLaunchd,
  installWechatCollectorLaunchd,
  uninstallEasyExamServiceLaunchd,
  uninstallWechatCollectorLaunchd,
} from "./wechat_launchd_manager.mjs";

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "wechat-launchd-"));
}

test("reports launchd collector installed and loaded status", () => {
  const dir = tmpDir();
  const plistPath = path.join(dir, "com.ata.easy-exam-wechat-collector.plist");
  writeFileSync(plistPath, "<plist></plist>");

  const status = getWechatCollectorLaunchdStatus({
    plistPath,
    execFileSyncImpl: () => "123\t0\tcom.ata.easy-exam-wechat-collector\n",
  });

  assert.equal(status.label, "com.ata.easy-exam-wechat-collector");
  assert.equal(status.plistPath, plistPath);
  assert.equal(status.installed, true);
  assert.equal(status.loaded, true);
});

test("installs launchd collector plist and loads it", () => {
  const dir = tmpDir();
  const templatePath = path.join(dir, "template.plist");
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-wechat-collector.plist");
  writeFileSync(templatePath, "<plist><dict></dict></plist>");
  const calls = [];

  const result = installWechatCollectorLaunchd({
    templatePath,
    plistPath,
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.installed, true);
  assert.equal(readFileSync(plistPath, "utf8"), "<plist><dict></dict></plist>");
  assert.deepEqual(calls, [
    ["plutil", ["-lint", plistPath]],
    ["launchctl", ["load", plistPath]],
    ["launchctl", ["list"]],
  ]);
});

test("renders launchd collector paths for the current machine", () => {
  const dir = tmpDir();
  const templatePath = path.join(dir, "template.plist");
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-wechat-collector.plist");
  const appDir = path.join(dir, "Easy Exam & WeChat", "app");
  const runtimeDir = path.join(dir, "Easy Exam & WeChat", "runtime");
  const nodePath = path.join(dir, "runtime", "node");
  writeFileSync(templatePath, [
    "<plist><dict>",
    "<string>__EASY_EXAM_APP_DIR__</string>",
    "<string>__EASY_EXAM_RUNTIME_DIR__</string>",
    "<string>__EASY_EXAM_NODE__</string>",
    "</dict></plist>",
  ].join(""));

  installWechatCollectorLaunchd({
    templatePath,
    plistPath,
    appDir,
    runtimeDir,
    nodePath,
    execFileSyncImpl: (command) => (
      command === "launchctl" ? "123\t0\tcom.ata.easy-exam-wechat-collector\n" : ""
    ),
  });

  const plist = readFileSync(plistPath, "utf8");
  assert.match(plist, /Easy Exam &amp; WeChat\/app/);
  assert.match(plist, /Easy Exam &amp; WeChat\/runtime/);
  assert.match(plist, /runtime\/node/);
  assert.doesNotMatch(plist, /__EASY_EXAM_/);
});

test("uninstalls launchd collector plist and unloads it when present", () => {
  const dir = tmpDir();
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-wechat-collector.plist");
  mkdirSync(path.dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, "<plist></plist>");
  const calls = [];

  const result = uninstallWechatCollectorLaunchd({
    plistPath,
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.installed, false);
  assert.equal(existsSync(plistPath), false);
  assert.deepEqual(calls, [
    ["launchctl", ["unload", plistPath]],
    ["launchctl", ["list"]],
  ]);
});

test("reports easy exam service launchd installed and loaded status", () => {
  const dir = tmpDir();
  const plistPath = path.join(dir, "com.ata.easy-exam-service.plist");
  writeFileSync(plistPath, "<plist></plist>");

  const status = getEasyExamServiceLaunchdStatus({
    plistPath,
    execFileSyncImpl: () => "321\t0\tcom.ata.easy-exam-service\n",
  });

  assert.equal(status.label, "com.ata.easy-exam-service");
  assert.equal(status.plistPath, plistPath);
  assert.equal(status.installed, true);
  assert.equal(status.loaded, true);
});

test("reuses the active Easy Exam LaunchAgent when its label differs", () => {
  const dir = tmpDir();
  const homeDir = path.join(dir, "home");
  const activeLabel = "com.example.easy-exam-web";
  const activePlistPath = path.join(homeDir, "Library", "LaunchAgents", `${activeLabel}.plist`);
  mkdirSync(path.dirname(activePlistPath), { recursive: true });
  writeFileSync(activePlistPath, "<plist></plist>");

  const status = getEasyExamServiceLaunchdStatus({
    homeDir,
    plistPath: path.join(homeDir, "Library", "LaunchAgents", "com.ata.easy-exam-service.plist"),
    activeServiceLabel: activeLabel,
    execFileSyncImpl: () => `321\t0\t${activeLabel}\n`,
  });

  assert.equal(status.label, activeLabel);
  assert.equal(status.canonicalLabel, "com.ata.easy-exam-service");
  assert.equal(status.plistPath, activePlistPath);
  assert.equal(status.installed, true);
  assert.equal(status.loaded, true);
  assert.equal(status.reused, true);
});

test("installs easy exam service plist and loads it", () => {
  const dir = tmpDir();
  const templatePath = path.join(dir, "service-template.plist");
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-service.plist");
  writeFileSync(templatePath, "<plist><dict><key>Label</key></dict></plist>");
  const calls = [];

  const result = installEasyExamServiceLaunchd({
    templatePath,
    plistPath,
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.installed, true);
  assert.equal(readFileSync(plistPath, "utf8"), "<plist><dict><key>Label</key></dict></plist>");
  assert.deepEqual(calls, [
    ["plutil", ["-lint", plistPath]],
    ["launchctl", ["load", plistPath]],
    ["launchctl", ["list"]],
  ]);
});

test("uninstalls easy exam service plist and unloads it when present", () => {
  const dir = tmpDir();
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-service.plist");
  mkdirSync(path.dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, "<plist></plist>");
  const calls = [];

  const result = uninstallEasyExamServiceLaunchd({
    plistPath,
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.installed, false);
  assert.equal(existsSync(plistPath), false);
  assert.deepEqual(calls, [
    ["launchctl", ["unload", plistPath]],
    ["launchctl", ["list"]],
  ]);
});
