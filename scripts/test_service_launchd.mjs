#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const label = "com.chen.yikao-auto-config-test";
const uid = process.getuid();
const domain = `gui/${uid}`;
const target = `${domain}/${label}`;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceAppDir = path.resolve(scriptDir, "..");
const testRoot = path.join(os.homedir(), "Library", "Application Support", "yikao-auto-config-test", "YKAI001");
const testAppDir = path.join(testRoot, "app");
const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
const templatePath = path.join(sourceAppDir, "deploy", `${label}.plist.template`);
const dependencies = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");
const nodePath = path.join(dependencies, "node", "bin", "node");
const pythonPath = path.join(dependencies, "python", "bin", "python3");

function loaded() {
  return spawnSync("launchctl", ["print", target], { stdio: "ignore" }).status === 0;
}

function launchctl(args, options = {}) {
  return spawnSync("launchctl", args, { encoding: "utf8", ...options });
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderTemplate() {
  return fs.readFileSync(templatePath, "utf8")
    .replaceAll("__YIKAO_TEST_APP_DIR__", xml(testAppDir))
    .replaceAll("__YIKAO_TEST_ROOT__", xml(testRoot))
    .replaceAll("__YIKAO_TEST_NODE__", xml(nodePath))
    .replaceAll("__YIKAO_TEST_PYTHON__", xml(pythonPath));
}

function install() {
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.join(testRoot, "runtime"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(testRoot, "logs"), { recursive: true, mode: 0o700 });
  fs.chmodSync(testRoot, 0o700);
  if (loaded()) launchctl(["bootout", target], { stdio: "ignore" });
  const syncResult = spawnSync("/bin/bash", [path.join(sourceAppDir, "scripts", "sync_test_app.sh")], {
    encoding: "utf8",
  });
  if (syncResult.status !== 0) throw new Error(syncResult.stderr || syncResult.stdout || "test app sync failed");
  const temporaryPath = `${plistPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, renderTemplate(), { mode: 0o600 });
  fs.renameSync(temporaryPath, plistPath);
  const result = launchctl(["bootstrap", domain, plistPath]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "launchctl bootstrap failed");
}

function stop() {
  if (!loaded()) return;
  const result = launchctl(["bootout", target]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "launchctl bootout failed");
}

function restart() {
  if (!loaded()) install();
  const result = launchctl(["kickstart", "-k", target]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "launchctl kickstart failed");
}

function status() {
  let detail = "";
  if (loaded()) {
    try {
      detail = execFileSync("launchctl", ["print", target], { encoding: "utf8" })
        .split("\n")
        .filter((line) => /^\s*(state|pid|runs|last exit code) =/.test(line))
        .map((line) => line.trim())
        .join(", ");
    } catch {}
  }
  return {
    label,
    sourceAppDir,
    testAppDir,
    testRoot,
    plistPath,
    installed: fs.existsSync(plistPath),
    loaded: loaded(),
    detail,
  };
}

const action = process.argv[2] || "status";
if (action === "install" || action === "sync") install();
else if (action === "stop") stop();
else if (action === "restart") restart();
else if (action !== "status") throw new Error("Usage: test_service_launchd.mjs [install|sync|stop|restart|status]");
process.stdout.write(`${JSON.stringify({ ok: true, action, status: status() }, null, 2)}\n`);
