#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_RELEASE_DEFAULTS = Object.freeze({
  label: "com.chen.yikao-auto-config-web",
  port: 8765,
  targetDir: path.join(os.homedir(), "Library", "Application Support", "yikao-auto-config-web"),
  releasesDir: path.join(os.homedir(), "Library", "Application Support", "yikao-auto-config-releases"),
  backupsDir: path.join(os.homedir(), "Library", "Application Support", "yikao-auto-config-deployments"),
  testAppDir: path.join(os.homedir(), "Library", "Application Support", "yikao-auto-config-test", "YKAI001", "app"),
  testPort: 8766,
  testHealthUrl: "http://127.0.0.1:8766/api/health",
  testLabel: "com.chen.yikao-auto-config-test",
  plistPath: path.join(os.homedir(), "Library", "LaunchAgents", "com.chen.yikao-auto-config-web.plist"),
  healthUrl: "http://127.0.0.1:8765/api/health",
});

const DEFAULT_APPLICATION_SCOPE = Object.freeze([
  "server",
  "scripts",
  "web",
  "deploy",
  "template",
  "outputs/web_prototype",
  "package.json",
  "requirements.txt",
  ".env.example",
  "README.md",
  "WORKING_MEMORY.md",
]);

function usage() {
  return [
    "用法：node scripts/production_release.mjs <操作> [选项]",
    "",
    "操作：",
    "  status",
    "  prepare --release <YKAI版本> --confirm <同一版本>",
    "  preflight --release <YKAI版本>",
    "  deploy --release <YKAI版本> --confirm <同一版本>",
    "  rollback --backup <部署备份编号> --confirm <同一备份编号>",
    "",
    "说明：",
    "  status/preflight 只读，不重启 8765。prepare 只从 8766 应用副本生成发布包。",
    "  deploy 只替换应用代码；正式数据、账号、配置、上传和日志均保留。",
    "  rollback 默认只恢复代码，不覆盖部署后产生的业务数据。",
  ].join("\n");
}

export function parseProductionReleaseArgs(argv = process.argv.slice(2)) {
  const [action = ""] = argv;
  if (action === "--help" || action === "-h" || action === "help") return { help: true };
  if (!["status", "prepare", "preflight", "deploy", "rollback"].includes(action)) {
    throw new Error(`未知操作：${action || "(空)"}\n\n${usage()}`);
  }
  const args = { action };
  for (let index = 1; index < argv.length; index += 1) {
    const item = argv[index];
    if (!["--release", "--backup", "--confirm"].includes(item)) {
      throw new Error(`未知参数：${item}\n\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${item} 需要一个值。`);
    args[item.slice(2)] = value;
    index += 1;
  }
  if (["prepare", "preflight", "deploy"].includes(action) && !args.release) {
    throw new Error(`${action} 需要 --release <YKAI版本>。`);
  }
  if (action === "rollback" && !args.backup) {
    throw new Error("rollback 需要 --backup <部署备份编号>。");
  }
  return args;
}

export function normalizeReleaseId(value) {
  const releaseId = String(value || "").trim().toUpperCase();
  if (!/^YKAI\d{3,}$/.test(releaseId)) {
    throw new Error("版本号必须使用 YKAI 加至少三位数字，例如 YKAI002。");
  }
  return releaseId;
}

function normalizeBackupId(value) {
  const backupId = String(value || "").trim();
  if (!/^before-(?:YKAI\d{3,}|rollback-to-[A-Za-z0-9._-]+)-\d{8}T\d{6}$/.test(backupId)) {
    throw new Error("部署备份编号格式无效。");
  }
  return backupId;
}

function assertConfirmation(expected, actual, action) {
  if (String(actual || "").trim() !== expected) {
    throw new Error(`${action} 未执行：请使用 --confirm ${expected} 明确确认。`);
  }
}

function isSafeRelativePath(value) {
  if (!value || path.isAbsolute(value) || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && !normalized.startsWith("../");
}

function scopeContains(scope, relativePath) {
  return relativePath === scope || relativePath.startsWith(`${scope}/`);
}

function validateScope(scope) {
  if (!Array.isArray(scope) || !scope.length) throw new Error("发布范围为空。");
  const normalized = scope.map((entry) => String(entry || "").trim());
  for (const entry of normalized) {
    if (!DEFAULT_APPLICATION_SCOPE.includes(entry)) {
      throw new Error(`发布范围包含未授权路径：${entry}`);
    }
  }
  return Array.from(new Set(normalized));
}

function walkFiles(rootDir, relativeDir = "") {
  const absoluteDir = path.join(rootDir, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  const result = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDir.split(path.sep).join("/"), entry.name);
    const absolutePath = path.join(rootDir, ...relativePath.split("/"));
    if (entry.isSymbolicLink()) throw new Error(`应用包不允许符号链接：${relativePath}`);
    if (entry.isDirectory()) result.push(...walkFiles(rootDir, relativePath));
    else if (entry.isFile()) result.push(relativePath);
  }
  return result.sort();
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const content = readFileSync(filePath);
  hash.update(content);
  return hash.digest("hex");
}

function parseChecksumManifest(text) {
  const entries = new Map();
  for (const [index, line] of String(text || "").split(/\r?\n/).entries()) {
    if (!line) continue;
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match || !isSafeRelativePath(match[2])) {
      throw new Error(`校验清单第 ${index + 1} 行无效。`);
    }
    if (entries.has(match[2])) throw new Error(`校验清单存在重复文件：${match[2]}`);
    entries.set(match[2], match[1]);
  }
  if (!entries.size) throw new Error("校验清单为空。");
  return entries;
}

function verifyApplicationManifest(appDir, manifestPath, scope, expectedCount) {
  const checksums = parseChecksumManifest(readFileSync(manifestPath, "utf8"));
  for (const relativePath of checksums.keys()) {
    if (!scope.some((entry) => scopeContains(entry, relativePath))) {
      throw new Error(`校验清单文件超出发布范围：${relativePath}`);
    }
  }
  const actualFiles = walkFiles(appDir);
  const manifestFiles = Array.from(checksums.keys()).sort();
  if (actualFiles.length !== manifestFiles.length
    || actualFiles.some((entry, index) => entry !== manifestFiles[index])) {
    throw new Error("应用目录与校验清单文件集合不一致。");
  }
  if (expectedCount != null && Number(expectedCount) !== actualFiles.length) {
    throw new Error(`应用文件数不一致：声明 ${expectedCount}，实际 ${actualFiles.length}。`);
  }
  for (const [relativePath, expected] of checksums) {
    const actual = sha256File(path.join(appDir, ...relativePath.split("/")));
    if (actual !== expected) throw new Error(`应用文件校验失败：${relativePath}`);
  }
  return { fileCount: actualFiles.length, files: actualFiles };
}

export function validateReleaseBundle(releaseDir, expectedReleaseId) {
  const releaseId = normalizeReleaseId(expectedReleaseId);
  const resolvedReleaseDir = path.resolve(releaseDir);
  const metadataPath = path.join(resolvedReleaseDir, "release", `${releaseId}.json`);
  const appDir = path.join(resolvedReleaseDir, "app");
  if (!existsSync(metadataPath) || !existsSync(appDir)) {
    throw new Error(`发布包不完整：${releaseId}`);
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.releaseId !== releaseId) throw new Error("发布包版本号与元数据不一致。");
  if (metadata.serviceLabel !== PRODUCTION_RELEASE_DEFAULTS.label) {
    throw new Error("发布包目标服务标识无效。");
  }
  const scope = validateScope(metadata.applicationScope);
  const manifestRelative = String(metadata.manifest || "");
  if (manifestRelative !== `release/${releaseId}.sha256`) {
    throw new Error("发布包校验清单路径无效。");
  }
  const manifestPath = path.join(resolvedReleaseDir, ...manifestRelative.split("/"));
  const verification = verifyApplicationManifest(
    appDir,
    manifestPath,
    scope,
    metadata.applicationFileCount,
  );
  return { releaseId, releaseDir: resolvedReleaseDir, appDir, manifestPath, metadata, scope, ...verification };
}

function copyScope(sourceRoot, targetRoot, scope) {
  for (const relativePath of scope) {
    const sourcePath = path.join(sourceRoot, ...relativePath.split("/"));
    if (!existsSync(sourcePath)) continue;
    const targetPath = path.join(targetRoot, ...relativePath.split("/"));
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true, preserveTimestamps: true });
  }
}

function removeScope(targetRoot, scope) {
  for (const relativePath of [...scope].sort((left, right) => right.length - left.length)) {
    const targetPath = path.resolve(targetRoot, ...relativePath.split("/"));
    if (!targetPath.startsWith(`${path.resolve(targetRoot)}${path.sep}`)) {
      throw new Error(`拒绝删除范围外路径：${targetPath}`);
    }
    rmSync(targetPath, { recursive: true, force: true });
  }
}

function writeApplicationManifest(appDir, manifestPath) {
  const files = walkFiles(appDir);
  const text = files
    .map((relativePath) => `${sha256File(path.join(appDir, ...relativePath.split("/")))}  ${relativePath}`)
    .join("\n");
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${text}\n`, { mode: 0o600 });
  return files;
}

export function prepareProductionRelease({
  releaseId,
  confirm,
  config = PRODUCTION_RELEASE_DEFAULTS,
  inspectTestIdentity = () => inspectServiceIdentity({
    targetDir: config.testAppDir,
    port: config.testPort,
    label: config.testLabel,
  }, "8766"),
  testHealth = () => httpHealth(config.testHealthUrl, "8766"),
  now = new Date(),
} = {}) {
  const normalizedReleaseId = normalizeReleaseId(releaseId);
  assertConfirmation(normalizedReleaseId, confirm, "生成发布包");
  const releaseDir = path.join(config.releasesDir, normalizedReleaseId);
  if (existsSync(releaseDir)) throw new Error(`发布包已经存在：${normalizedReleaseId}`);
  const test = inspectTestIdentity(config);
  const health = testHealth();
  const temporaryDir = path.join(config.releasesDir, `.${normalizedReleaseId}.tmp-${process.pid}`);
  const appDir = path.join(temporaryDir, "app");
  const manifestRelative = `release/${normalizedReleaseId}.sha256`;
  mkdirSync(appDir, { recursive: true, mode: 0o700 });
  try {
    copyScope(config.testAppDir, appDir, DEFAULT_APPLICATION_SCOPE);
    const files = writeApplicationManifest(appDir, path.join(temporaryDir, ...manifestRelative.split("/")));
    if (!files.includes("server/easy_exam_server.mjs")
      || !files.includes("outputs/web_prototype/easy_exam_automation.html")
      || !files.includes("scripts/run_local_service.sh")
      || !files.includes("package.json")) {
      throw new Error("8766 应用副本缺少正式服务启动所需文件。");
    }
    const metadata = {
      releaseId: normalizedReleaseId,
      capturedAt: now.toISOString(),
      source: config.testAppDir,
      sourceTestPid: test.pid,
      serviceLabel: PRODUCTION_RELEASE_DEFAULTS.label,
      applicationFileCount: files.length,
      manifest: manifestRelative,
      applicationScope: DEFAULT_APPLICATION_SCOPE,
    };
    mkdirSync(path.join(temporaryDir, "release"), { recursive: true });
    writeFileSync(
      path.join(temporaryDir, "release", `${normalizedReleaseId}.json`),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { mode: 0o600 },
    );
    const verified = validateReleaseBundle(temporaryDir, normalizedReleaseId);
    mkdirSync(config.releasesDir, { recursive: true, mode: 0o700 });
    renameSync(temporaryDir, releaseDir);
    return {
      ok: true,
      action: "prepare",
      releaseId: normalizedReleaseId,
      releaseDir,
      applicationFileCount: verified.fileCount,
      sourceTest: test,
      health,
    };
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}

function captureCurrentApplication({ targetDir, backupsDir, backupId, scope, metadata = {} }) {
  const backupDir = path.join(backupsDir, backupId);
  if (existsSync(backupDir)) throw new Error(`部署备份已存在：${backupId}`);
  const temporaryDir = `${backupDir}.tmp-${process.pid}`;
  const appDir = path.join(temporaryDir, "app");
  mkdirSync(appDir, { recursive: true, mode: 0o700 });
  try {
    copyScope(targetDir, appDir, scope);
    const files = writeApplicationManifest(appDir, path.join(temporaryDir, "application.sha256"));
    writeFileSync(path.join(temporaryDir, "metadata.json"), `${JSON.stringify({
      backupId,
      createdAt: new Date().toISOString(),
      targetDir,
      applicationScope: scope,
      applicationFileCount: files.length,
      ...metadata,
    }, null, 2)}\n`, { mode: 0o600 });
    mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
    renameSync(temporaryDir, backupDir);
    return { backupId, backupDir, appDir: path.join(backupDir, "app"), fileCount: files.length };
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

function resolvePythonBin() {
  const bundled = path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "bin",
    "python3",
  );
  return existsSync(bundled) ? bundled : "python3";
}

export function snapshotProductionState({ targetDir, backupDir, pythonBin = resolvePythonBin() }) {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "snapshot_production_state.py");
  const output = run(pythonBin, [
    scriptPath,
    "--app-root",
    targetDir,
    "--destination",
    path.join(backupDir, "state"),
  ]).trim();
  const result = JSON.parse(output);
  if (result?.ok !== true) throw new Error("正式运行状态快照失败。");
  return result;
}

function validateDeploymentBackup(backupDir, expectedBackupId) {
  const backupId = normalizeBackupId(expectedBackupId);
  const resolvedBackupDir = path.resolve(backupDir);
  const metadata = JSON.parse(readFileSync(path.join(resolvedBackupDir, "metadata.json"), "utf8"));
  if (metadata.backupId !== backupId) throw new Error("部署备份编号与元数据不一致。");
  const scope = validateScope(metadata.applicationScope);
  const appDir = path.join(resolvedBackupDir, "app");
  const manifestPath = path.join(resolvedBackupDir, "application.sha256");
  const verification = verifyApplicationManifest(
    appDir,
    manifestPath,
    scope,
    metadata.applicationFileCount,
  );
  return { backupId, backupDir: resolvedBackupDir, appDir, manifestPath, metadata, scope, ...verification };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function httpHealth(url, serviceName) {
  const body = run("curl", ["-fsS", url]).trim();
  const parsed = JSON.parse(body);
  if (parsed?.ok !== true) throw new Error(`${serviceName} 健康检查失败：${body}`);
  return parsed;
}

export function createLaunchdProductionService(config = PRODUCTION_RELEASE_DEFAULTS) {
  const uid = process.getuid();
  const domain = `gui/${uid}`;
  const service = `${domain}/${config.label}`;
  return {
    stop() {
      try {
        run("launchctl", ["bootout", service]);
      } catch (error) {
        if (!String(error.stderr || error.message).includes("Could not find service")) throw error;
      }
    },
    start() {
      run("launchctl", ["bootstrap", domain, config.plistPath]);
    },
    health() {
      let lastError = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          const body = run("curl", ["-fsS", config.healthUrl]).trim();
          const parsed = JSON.parse(body);
          if (parsed?.ok === true) return parsed;
          lastError = body;
        } catch (error) {
          lastError = String(error.stderr || error.message || error);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      }
      throw new Error(`8765 健康检查失败：${lastError}`);
    },
  };
}

export function inspectServiceIdentity(config, serviceName = String(config.port)) {
  const pidText = run("lsof", ["-nP", `-iTCP:${config.port}`, "-sTCP:LISTEN", "-t"]).trim();
  const pids = Array.from(new Set(pidText.split(/\s+/).filter(Boolean)));
  if (pids.length !== 1) throw new Error(`端口 ${config.port} 监听进程数量异常：${pids.length}`);
  const pid = Number(pids[0]);
  const cwdOutput = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  const cwdLine = cwdOutput.split(/\r?\n/).find((line) => line.startsWith("n"));
  const cwd = cwdLine ? realpathSync(cwdLine.slice(1)) : "";
  const expectedCwd = realpathSync(config.targetDir);
  if (cwd !== expectedCwd) throw new Error(`${serviceName} 运行目录异常：${cwd || "未知"}`);
  run("launchctl", ["print", `gui/${process.getuid()}/${config.label}`]);
  return { pid, cwd, label: config.label, port: config.port };
}

export function inspectProductionIdentity(config = PRODUCTION_RELEASE_DEFAULTS) {
  return inspectServiceIdentity(config, "8765");
}

function readDeploymentMarker(targetDir) {
  const markerPath = path.join(targetDir, ".easy_exam_runtime", "production-release.json");
  if (!existsSync(markerPath)) return null;
  return JSON.parse(readFileSync(markerPath, "utf8"));
}

function writeDeploymentMarker(targetDir, payload) {
  const markerPath = path.join(targetDir, ".easy_exam_runtime", "production-release.json");
  const temporaryPath = `${markerPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, markerPath);
}

function replaceApplication({ sourceAppDir, targetDir, scope }) {
  removeScope(targetDir, scope);
  copyScope(sourceAppDir, targetDir, scope);
}

export function preflightProductionRelease({
  releaseDir,
  releaseId,
  config = PRODUCTION_RELEASE_DEFAULTS,
  service = createLaunchdProductionService(config),
  inspectIdentity = inspectProductionIdentity,
} = {}) {
  const release = validateReleaseBundle(releaseDir, releaseId);
  const identity = inspectIdentity(config);
  const health = service.health();
  return {
    ok: true,
    action: "preflight",
    releaseId: release.releaseId,
    releaseDir: release.releaseDir,
    applicationFileCount: release.fileCount,
    production: identity,
    health,
    currentRelease: readDeploymentMarker(config.targetDir),
  };
}

export function deployProductionRelease({
  releaseDir,
  releaseId,
  confirm,
  config = PRODUCTION_RELEASE_DEFAULTS,
  service = createLaunchdProductionService(config),
  inspectIdentity = inspectProductionIdentity,
  snapshotState = snapshotProductionState,
  now = new Date(),
} = {}) {
  const normalizedReleaseId = normalizeReleaseId(releaseId);
  assertConfirmation(normalizedReleaseId, confirm, "正式部署");
  const release = validateReleaseBundle(releaseDir, normalizedReleaseId);
  const before = inspectIdentity(config);
  const beforeHealth = service.health();
  const backupId = `before-${normalizedReleaseId}-${timestamp(now)}`;
  const previousMarker = readDeploymentMarker(config.targetDir);
  const backup = captureCurrentApplication({
    targetDir: config.targetDir,
    backupsDir: config.backupsDir,
    backupId,
    scope: release.scope,
    metadata: {
      reason: "before-deploy",
      targetReleaseId: normalizedReleaseId,
      previousRelease: previousMarker,
      productionPid: before.pid,
    },
  });
  const stateSnapshot = snapshotState({ targetDir: config.targetDir, backupDir: backup.backupDir });

  let deploymentError;
  service.stop();
  try {
    replaceApplication({ sourceAppDir: release.appDir, targetDir: config.targetDir, scope: release.scope });
    service.start();
    const health = service.health();
    const production = inspectIdentity(config);
    writeDeploymentMarker(config.targetDir, {
      releaseId: normalizedReleaseId,
      deployedAt: new Date().toISOString(),
      releaseDir: release.releaseDir,
      backupId,
      applicationFileCount: release.fileCount,
    });
    return {
      ok: true,
      action: "deploy",
      releaseId: normalizedReleaseId,
      backupId,
      backupDir: backup.backupDir,
      stateSnapshot,
      before: { ...before, health: beforeHealth },
      production,
      health,
    };
  } catch (error) {
    deploymentError = error;
  }

  try { service.stop(); } catch {}
  replaceApplication({ sourceAppDir: backup.appDir, targetDir: config.targetDir, scope: release.scope });
  service.start();
  const restoredHealth = service.health();
  throw new Error(
    `正式部署失败，已自动恢复部署前代码；恢复健康状态：${JSON.stringify(restoredHealth)}；原始错误：${deploymentError.message}`,
  );
}

export function rollbackProductionRelease({
  backupDir,
  backupId,
  confirm,
  config = PRODUCTION_RELEASE_DEFAULTS,
  service = createLaunchdProductionService(config),
  inspectIdentity = inspectProductionIdentity,
  snapshotState = snapshotProductionState,
  now = new Date(),
} = {}) {
  const normalizedBackupId = normalizeBackupId(backupId);
  assertConfirmation(normalizedBackupId, confirm, "正式回滚");
  const rollbackTarget = validateDeploymentBackup(backupDir, normalizedBackupId);
  const before = inspectIdentity(config);
  const beforeHealth = service.health();
  const safetyBackupId = `before-rollback-to-${normalizedBackupId}-${timestamp(now)}`;
  const safetyBackup = captureCurrentApplication({
    targetDir: config.targetDir,
    backupsDir: config.backupsDir,
    backupId: safetyBackupId,
    scope: rollbackTarget.scope,
    metadata: {
      reason: "before-rollback",
      rollbackTarget: normalizedBackupId,
      previousRelease: readDeploymentMarker(config.targetDir),
      productionPid: before.pid,
    },
  });
  const stateSnapshot = snapshotState({ targetDir: config.targetDir, backupDir: safetyBackup.backupDir });

  service.stop();
  try {
    replaceApplication({ sourceAppDir: rollbackTarget.appDir, targetDir: config.targetDir, scope: rollbackTarget.scope });
    service.start();
    const health = service.health();
    const production = inspectIdentity(config);
    writeDeploymentMarker(config.targetDir, {
      releaseId: rollbackTarget.metadata.previousRelease?.releaseId || "restored-backup",
      deployedAt: new Date().toISOString(),
      restoredFromBackupId: normalizedBackupId,
      safetyBackupId,
      applicationFileCount: rollbackTarget.fileCount,
    });
    return {
      ok: true,
      action: "rollback",
      backupId: normalizedBackupId,
      safetyBackupId,
      safetyBackupDir: safetyBackup.backupDir,
      stateSnapshot,
      before: { ...before, health: beforeHealth },
      production,
      health,
    };
  } catch (error) {
    try { service.stop(); } catch {}
    replaceApplication({ sourceAppDir: safetyBackup.appDir, targetDir: config.targetDir, scope: rollbackTarget.scope });
    service.start();
    const restoredHealth = service.health();
    throw new Error(
      `正式回滚失败，已恢复回滚前代码；恢复健康状态：${JSON.stringify(restoredHealth)}；原始错误：${error.message}`,
    );
  }
}

export function productionReleaseStatus({
  config = PRODUCTION_RELEASE_DEFAULTS,
  service = createLaunchdProductionService(config),
  inspectIdentity = inspectProductionIdentity,
} = {}) {
  return {
    ok: true,
    action: "status",
    production: inspectIdentity(config),
    health: service.health(),
    currentRelease: readDeploymentMarker(config.targetDir),
  };
}

function cliPaths(args, defaults = PRODUCTION_RELEASE_DEFAULTS) {
  if (args.release) {
    const releaseId = normalizeReleaseId(args.release);
    return { releaseId, releaseDir: path.join(defaults.releasesDir, releaseId) };
  }
  if (args.backup) {
    const backupId = normalizeBackupId(args.backup);
    return { backupId, backupDir: path.join(defaults.backupsDir, backupId) };
  }
  return {};
}

export function runProductionReleaseCli(args, dependencies = {}) {
  const defaults = dependencies.config || PRODUCTION_RELEASE_DEFAULTS;
  if (args.help) return { help: usage() };
  if (args.action === "status") return productionReleaseStatus(dependencies);
  if (args.action === "prepare") {
    return prepareProductionRelease({ ...dependencies, ...cliPaths(args, defaults), confirm: args.confirm });
  }
  if (args.action === "preflight") {
    return preflightProductionRelease({ ...dependencies, ...cliPaths(args, defaults) });
  }
  if (args.action === "deploy") {
    return deployProductionRelease({ ...dependencies, ...cliPaths(args, defaults), confirm: args.confirm });
  }
  return rollbackProductionRelease({ ...dependencies, ...cliPaths(args, defaults), confirm: args.confirm });
}

async function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (await isDirectRun()) {
  try {
    const args = parseProductionReleaseArgs();
    const result = runProductionReleaseCli(args);
    if (result.help) process.stdout.write(`${result.help}\n`);
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
