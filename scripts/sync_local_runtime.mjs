#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LABEL = "com.chen.yikao-auto-config-web";
const DEFAULT_TARGET = path.join(os.homedir(), "Library", "Application Support", "yikao-auto-config-web");

function usage() {
  return [
    "用法：node scripts/sync_local_runtime.mjs [选项]",
    "",
    "  --source <目录>       指定源码目录",
    "  --target <目录>       指定运行时目录",
    "  --label <名称>        指定 LaunchAgent label",
    "  --plistPath <路径>    指定 LaunchAgent plist",
    "  --healthUrl <地址>    指定健康检查地址",
    "  --dry-run             只检查并输出计划，不复制、不重启",
    "  --force-sync          忽略运行时版本回退保护",
    "  --no-restart          复制但不重启服务",
    "  --no-health-check     重启后不做健康检查",
    "  --help                显示帮助",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    restart: true,
    healthCheck: true,
    dryRun: false,
    forceSync: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--help" || item === "-h") {
      args.help = true;
      continue;
    }
    if (item === "--no-restart") {
      args.restart = false;
      args.healthCheck = false;
      continue;
    }
    if (item === "--no-health-check") {
      args.healthCheck = false;
      continue;
    }
    if (item === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (item === "--force-sync") {
      args.forceSync = true;
      continue;
    }
    if (["--source", "--target", "--label", "--plistPath", "--healthUrl"].includes(item)) {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
        throw new Error(`${item} 需要一个值。`);
      }
      args[item.slice(2)] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${item}\n\n${usage()}`);
  }
  return args;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function gitValue(sourceDir, args) {
  try {
    return run("git", args, { cwd: sourceDir }).trim();
  } catch {
    return "";
  }
}

function sourceVersion(sourceDir) {
  return {
    branch: gitValue(sourceDir, ["branch", "--show-current"]) || "(detached)",
    commit: gitValue(sourceDir, ["rev-parse", "HEAD"]),
  };
}

function readSyncManifest(targetDir) {
  const manifestPath = path.join(targetDir, ".easy_exam_runtime", "sync-manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`运行时版本标记无法读取：${manifestPath}。请先人工检查，或明确使用 --force-sync。${error.message}`);
  }
}

function hasManagedRuntime(targetDir) {
  return ["server", "scripts", "outputs", "web"].some((entry) => existsSync(path.join(targetDir, entry)));
}

function isAncestor(sourceDir, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: sourceDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function assertRuntimeVersionSafe(sourceDir, targetDir, forceSync) {
  if (forceSync) return;
  const manifest = readSyncManifest(targetDir);
  if (!manifest) {
    if (hasManagedRuntime(targetDir)) {
      throw new Error([
        "拒绝覆盖未标记的现有运行时：无法确认 8765 当前版本。",
        "请先检查目标运行时，再明确使用 --force-sync 建立新的版本标记。",
      ].join("\n"));
    }
    return;
  }
  const current = sourceVersion(sourceDir);
  if (!manifest.sourceCommit || !current.commit || manifest.sourceCommit === current.commit) return;
  if (!isAncestor(sourceDir, manifest.sourceCommit, current.commit)) {
    throw new Error([
      `拒绝覆盖运行时：当前源码 ${current.branch}@${current.commit.slice(0, 12)} 不包含运行时已有提交 ${String(manifest.sourceCommit).slice(0, 12)}。`,
      "这通常表示当前检出分支比 8765 旧。请切换到包含运行时提交的分支，或确认后使用 --force-sync。",
    ].join("\n"));
  }
}

function writeSyncManifest(targetDir, sourceDir, copied) {
  const runtimeDir = path.join(targetDir, ".easy_exam_runtime");
  const manifestPath = path.join(runtimeDir, "sync-manifest.json");
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  const version = sourceVersion(sourceDir);
  writeFileSync(tempPath, `${JSON.stringify({
    sourceDir,
    sourceBranch: version.branch,
    sourceCommit: version.commit,
    copied,
    syncedAt: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, manifestPath);
}

function gitTrackedFiles(sourceDir) {
  const output = run("git", [
    "ls-files",
    "-z",
    "--cached",
    "--modified",
    "--others",
    "--exclude-standard",
    "--",
    "server",
    "scripts",
    "outputs",
    "web",
    "deploy",
    "template",
    "package.json",
    "requirements.txt",
    ".env.example",
    "README.md",
    "WORKING_MEMORY.md",
  ], { cwd: sourceDir });
  return output.split("\0").filter(Boolean);
}

function syncTrackedFiles(sourceDir, targetDir, files) {
  const runtimeDir = path.join(targetDir, ".easy_exam_runtime");
  mkdirSync(runtimeDir, { recursive: true });

  for (const entry of ["server", "scripts", "outputs", "web", "deploy", "template"]) {
    rmSync(path.join(targetDir, entry), { recursive: true, force: true });
  }
  for (const entry of ["package.json", "requirements.txt", ".env.example", "README.md", "WORKING_MEMORY.md"]) {
    rmSync(path.join(targetDir, entry), { force: true });
  }

  let copied = 0;
  for (const relativePath of files) {
    if (relativePath === ".env") continue;
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(targetDir, relativePath);
    if (!existsSync(sourcePath)) continue;
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });
    copied += 1;
  }
  return copied;
}

function restartLaunchd(label, plistPath) {
  const service = `gui/${process.getuid()}/${label}`;
  try {
    run("launchctl", ["kickstart", "-k", service]);
  } catch (error) {
    const stderr = error.stderr || "";
    if (!String(stderr).includes("Could not find service") || !plistPath) {
      throw error;
    }
    run("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath]);
    run("launchctl", ["kickstart", "-k", service]);
  }
}

function waitForHealth(url, attempts = 20) {
  let lastError = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return run("curl", ["-fsS", url]).trim();
    } catch (error) {
      lastError = error.stderr || error.message || String(error);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
  throw new Error(`Health check failed for ${url}: ${lastError}`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
let args;
try {
  args = parseArgs(process.argv);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
if (args?.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}
if (!args) process.exit(2);
const sourceDir = path.resolve(args.source || path.join(scriptDir, ".."));
const targetDir = path.resolve(args.target || DEFAULT_TARGET);
const label = args.label || DEFAULT_LABEL;
const plistPath = path.resolve(args.plistPath || path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`));
const healthUrl = args.healthUrl || "http://127.0.0.1:8765/api/health";

mkdirSync(targetDir, { recursive: true });
const files = gitTrackedFiles(sourceDir);
assertRuntimeVersionSafe(sourceDir, targetDir, args.forceSync);

if (args.dryRun) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    dryRun: true,
    sourceDir,
    targetDir,
    source: sourceVersion(sourceDir),
    plannedFiles: files.length,
    restarted: false,
    health: null,
  }, null, 2)}\n`);
  process.exit(0);
}

const copied = syncTrackedFiles(sourceDir, targetDir, files);
writeSyncManifest(targetDir, sourceDir, copied);

let health = null;
if (args.restart) {
  restartLaunchd(label, plistPath);
  if (args.healthCheck) {
    health = waitForHealth(healthUrl);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceDir,
  targetDir,
  copied,
  source: sourceVersion(sourceDir),
  restarted: args.restart,
  label,
  health,
}, null, 2)}\n`);
