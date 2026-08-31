import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  FANWEI_LOCAL_HELPER_UPDATE_SCHEMA_VERSION,
  FANWEI_LOCAL_HELPER_UPDATE_STRATEGY,
} from "./fanwei_local_helper_version.mjs";

const execFileAsync = promisify(execFile);
const UPDATE_PACKAGE_PATH = "/api/fanwei/helper-update-package";
const UPDATE_PACKAGE_MAX_BYTES = 180 * 1024 * 1024;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 120_000;
const REQUIRED_SERVER_FILES = [
  "fanwei_local_helper_cli.mjs",
  "fanwei_local_helper.mjs",
  "fanwei_local_helper_update.mjs",
  "fanwei_local_helper_version.mjs",
];

export class FanweiHelperUpdateError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function updateError(code, message, status = 400) {
  return new FanweiHelperUpdateError(code, message, status);
}

function normalizedSha256(value = "") {
  const digest = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw updateError("helper_update_digest_invalid", "助手更新包缺少有效的 SHA-256 校验值。");
  }
  return digest;
}

function normalizedTargetVersion(value, currentVersion) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw updateError("helper_update_version_invalid", "助手更新版本无效。");
  }
  if (version <= currentVersion) {
    throw updateError("helper_update_not_newer", "目标助手版本不是更新版本。", 409);
  }
  return version;
}

export function validateFanweiHelperUpdateRequest(payload = {}, {
  allowedOrigins = [],
  currentVersion,
} = {}) {
  const targetVersion = normalizedTargetVersion(payload.version, Number(currentVersion || 0));
  const sha256 = normalizedSha256(payload.sha256);
  let packageUrl;
  try {
    packageUrl = new URL(String(payload.packageUrl || ""));
  } catch {
    throw updateError("helper_update_url_invalid", "助手更新包地址无效。");
  }
  if (
    !["http:", "https:"].includes(packageUrl.protocol)
    || packageUrl.username
    || packageUrl.password
    || packageUrl.hash
    || packageUrl.pathname !== UPDATE_PACKAGE_PATH
    || !allowedOrigins.includes(packageUrl.origin)
  ) {
    throw updateError("helper_update_url_forbidden", "助手更新包地址未获授权。", 403);
  }
  const token = String(packageUrl.searchParams.get("token") || "");
  const queryKeys = Array.from(packageUrl.searchParams.keys());
  if (!/^[0-9a-f]{64}$/i.test(token) || queryKeys.length !== 1 || queryKeys[0] !== "token") {
    throw updateError("helper_update_token_invalid", "助手更新令牌无效。", 403);
  }
  return {
    targetVersion,
    sha256,
    packageUrl: packageUrl.toString(),
  };
}

function expectedPackagePlatform(platform, arch) {
  if (platform === "win32") return "win-x64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "darwin") return "darwin-arm64";
  return "";
}

async function readPackageManifest(packageDir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageDir, "helper-package.json"), "utf8"));
  } catch {
    throw updateError("helper_update_manifest_invalid", "助手更新包清单无效。", 422);
  }
  return manifest;
}

export async function validateStagedFanweiHelperPackage(packageDir, {
  platform,
  arch,
  targetVersion,
} = {}) {
  const manifest = await readPackageManifest(packageDir);
  if (
    manifest.schemaVersion !== FANWEI_LOCAL_HELPER_UPDATE_SCHEMA_VERSION
    || manifest.updateStrategy !== FANWEI_LOCAL_HELPER_UPDATE_STRATEGY
    || manifest.helperVersion !== targetVersion
    || manifest.platform !== expectedPackagePlatform(platform, arch)
  ) {
    throw updateError("helper_update_manifest_mismatch", "助手更新包与当前系统或目标版本不匹配。", 422);
  }
  const serverDir = path.join(packageDir, "server");
  for (const fileName of REQUIRED_SERVER_FILES) {
    try {
      await access(path.join(serverDir, fileName));
    } catch {
      throw updateError("helper_update_package_incomplete", `助手更新包缺少 ${fileName}。`, 422);
    }
  }
  return manifest;
}

async function defaultExtractPackage({ packagePath, outputDir, platform }) {
  if (platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      packagePath,
      outputDir,
    ], { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS, windowsHide: true });
    return;
  }
  await execFileAsync("unzip", ["-q", packagePath, "-d", outputDir], {
    timeout: UPDATE_DOWNLOAD_TIMEOUT_MS,
  });
}

async function defaultPreflightPackage({ packageDir, runtimeDir, platform }) {
  const runtimeName = platform === "win32" ? "node.exe" : "node";
  const nodePath = path.join(runtimeDir, runtimeName);
  try {
    await access(nodePath);
  } catch {
    throw updateError("helper_update_runtime_invalid", "未找到助手自带的 Node 运行环境。", 409);
  }
  const entryUrl = pathToFileURL(path.join(packageDir, "server", "fanwei_local_helper_cli.mjs")).href;
  try {
    await execFileAsync(nodePath, [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(entryUrl)})`,
    ], {
      cwd: packageDir,
      timeout: 30_000,
      windowsHide: true,
    });
  } catch (error) {
    throw updateError(
      "helper_update_preflight_failed",
      `助手更新包启动校验失败：${error?.stderr || error?.message || String(error)}`,
      422,
    );
  }
}

async function downloadedPackage(fetchImpl, request, destination) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_DOWNLOAD_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(request.packageUrl, {
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/zip" },
    });
    if (!response?.ok) {
      throw updateError(
        "helper_update_download_failed",
        `助手更新包下载失败：HTTP ${response?.status || 0}。`,
        502,
      );
    }
    const declaredSize = Number(response.headers?.get?.("content-length") || 0);
    if (declaredSize > UPDATE_PACKAGE_MAX_BYTES) {
      throw updateError("helper_update_package_too_large", "助手更新包超过大小限制。", 413);
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length || content.length > UPDATE_PACKAGE_MAX_BYTES) {
      throw updateError("helper_update_package_too_large", "助手更新包为空或超过大小限制。", 413);
    }
    const actualDigest = createHash("sha256").update(content).digest("hex");
    if (actualDigest !== request.sha256) {
      throw updateError("helper_update_digest_mismatch", "助手更新包校验失败，未执行更新。", 422);
    }
    await writeFile(destination, content, { mode: 0o600 });
  } catch (error) {
    if (error instanceof FanweiHelperUpdateError) throw error;
    if (error?.name === "AbortError") {
      throw updateError("helper_update_download_timeout", "助手更新包下载超时。", 504);
    }
    throw updateError(
      "helper_update_download_failed",
      `助手更新包下载失败：${error?.message || String(error)}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function findExtractedPackageDir(outputDir) {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isDirectory());
  if (candidates.length !== 1) {
    throw updateError("helper_update_archive_invalid", "助手更新包目录结构无效。", 422);
  }
  return path.join(outputDir, candidates[0].name);
}

async function copyOptionalPackageFiles(packageDir, runtimeDir, platform) {
  const files = platform === "win32"
    ? ["install-windows.bat", "start-windows.bat"]
    : ["install-macos.command", "com.ata.yikao-fanwei-helper.plist.template"];
  for (const fileName of files) {
    try {
      await cp(path.join(packageDir, fileName), path.join(runtimeDir, fileName));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export async function applyStagedFanweiHelperUpdate({
  runtimeDir,
  packageDir,
  platform,
  arch,
  currentVersion,
  targetVersion,
} = {}) {
  await validateStagedFanweiHelperPackage(packageDir, { platform, arch, targetVersion });
  const installedServerDir = path.join(runtimeDir, "server");
  try {
    const installedStat = await stat(installedServerDir);
    if (!installedStat.isDirectory()) throw new Error("not a directory");
  } catch {
    throw updateError("helper_update_runtime_invalid", "未找到已安装的助手程序目录。", 409);
  }

  const updateId = `${Date.now()}-${randomUUID()}`;
  const nextServerDir = path.join(runtimeDir, `.helper-update-next-${updateId}`);
  const backupRoot = path.join(runtimeDir, ".helper-update-backups");
  const backupServerDir = path.join(backupRoot, `server-v${currentVersion}-${updateId}`);
  await mkdir(backupRoot, { recursive: true });
  await cp(path.join(packageDir, "server"), nextServerDir, { recursive: true });

  let previousMoved = false;
  try {
    await rename(installedServerDir, backupServerDir);
    previousMoved = true;
    await rename(nextServerDir, installedServerDir);
    await copyOptionalPackageFiles(packageDir, runtimeDir, platform);
    await writeFile(path.join(runtimeDir, ".helper-update-state.json"), `${JSON.stringify({
      fromVersion: currentVersion,
      toVersion: targetVersion,
      backupServerDir,
      appliedAt: new Date().toISOString(),
      restartPending: true,
    }, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    await rm(nextServerDir, { recursive: true, force: true }).catch(() => {});
    if (previousMoved) {
      await rm(installedServerDir, { recursive: true, force: true }).catch(() => {});
      await rename(backupServerDir, installedServerDir).catch(() => {});
    }
    throw updateError(
      "helper_update_apply_failed",
      `助手更新文件替换失败：${error?.message || String(error)}`,
      500,
    );
  }

  return {
    fromVersion: currentVersion,
    toVersion: targetVersion,
    backupServerDir,
    restartRequired: true,
  };
}

export async function runFanweiHelperUpdate(payload, {
  runtimeDir,
  allowedOrigins,
  platform,
  arch,
  currentVersion,
  fetchImpl = globalThis.fetch,
  extractPackageImpl = defaultExtractPackage,
  preflightPackageImpl = defaultPreflightPackage,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw updateError("helper_update_download_unavailable", "当前助手无法下载安装更新。", 500);
  }
  const request = validateFanweiHelperUpdateRequest(payload, { allowedOrigins, currentVersion });
  const updateRoot = path.join(runtimeDir, ".helper-updates", randomUUID());
  const packagePath = path.join(updateRoot, "helper-update.zip");
  const extractDir = path.join(updateRoot, "extracted");
  await mkdir(extractDir, { recursive: true });
  try {
    await downloadedPackage(fetchImpl, request, packagePath);
    await extractPackageImpl({ packagePath, outputDir: extractDir, platform });
    const packageDir = await findExtractedPackageDir(extractDir);
    await validateStagedFanweiHelperPackage(packageDir, {
      platform,
      arch,
      targetVersion: request.targetVersion,
    });
    await preflightPackageImpl({ packageDir, runtimeDir, platform });
    return await applyStagedFanweiHelperUpdate({
      runtimeDir,
      packageDir,
      platform,
      arch,
      currentVersion,
      targetVersion: request.targetVersion,
    });
  } finally {
    await rm(updateRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function markFanweiHelperUpdateVerified(runtimeDir, currentVersion) {
  const statePath = path.join(runtimeDir, ".helper-update-state.json");
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (Number(state?.toVersion) !== Number(currentVersion) || state.restartPending !== true) {
    return false;
  }
  await writeFile(statePath, `${JSON.stringify({
    ...state,
    restartPending: false,
    verifiedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  return true;
}
