import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export const WECHAT_COLLECTOR_LAUNCHD_LABEL = "com.ata.easy-exam-wechat-collector";
export const EASY_EXAM_SERVICE_LAUNCHD_LABEL = "com.ata.easy-exam-service";

function defaultPythonPath(homeDir = os.homedir()) {
  const bundledPath = path.join(
    homeDir,
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "bin",
    "python3",
  );
  return process.env.CODEX_PYTHON || (existsSync(bundledPath) ? bundledPath : "/usr/bin/python3");
}

function xmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderLaunchdTemplate(template, {
  appDir,
  runtimeDir,
  nodePath,
  pythonPath,
} = {}) {
  const replacements = {
    __EASY_EXAM_APP_DIR__: appDir,
    __EASY_EXAM_RUNTIME_DIR__: runtimeDir,
    __EASY_EXAM_NODE__: nodePath,
    __EASY_EXAM_PYTHON__: pythonPath,
  };
  return Object.entries(replacements).reduce(
    (rendered, [token, value]) => rendered.replaceAll(token, xmlEscape(value)),
    template,
  );
}

function launchdLabelIsUsable(label) {
  return Boolean(label && label !== "0" && label.includes(".") && /^[A-Za-z0-9._-]+$/.test(label));
}

export function defaultWechatCollectorLaunchdPaths(homeDir = os.homedir()) {
  return {
    templatePath: path.join(rootDir, "deploy", `${WECHAT_COLLECTOR_LAUNCHD_LABEL}.plist.template`),
    plistPath: path.join(homeDir, "Library", "LaunchAgents", `${WECHAT_COLLECTOR_LAUNCHD_LABEL}.plist`),
  };
}

export function defaultEasyExamServiceLaunchdPaths(homeDir = os.homedir()) {
  return {
    templatePath: path.join(rootDir, "deploy", `${EASY_EXAM_SERVICE_LAUNCHD_LABEL}.plist.template`),
    plistPath: path.join(homeDir, "Library", "LaunchAgents", `${EASY_EXAM_SERVICE_LAUNCHD_LABEL}.plist`),
  };
}

function getLaunchdStatus({
  label,
  plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  const installed = existsSync(plistPath);
  let loaded = false;
  let detail = installed ? "LaunchAgent plist exists but is not loaded" : "LaunchAgent plist is not installed";
  try {
    const list = execFileSyncImpl("launchctl", ["list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    loaded = String(list || "")
      .split(/\r?\n/)
      .some((line) => line.trim().split(/\s+/).at(-1) === label);
    if (loaded) detail = "launchd job is loaded";
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }
  return {
    label,
    plistPath,
    installed,
    loaded,
    detail,
  };
}

function installLaunchdJob({
  label,
  templatePath,
  plistPath,
  appDir,
  runtimeDir,
  nodePath,
  pythonPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  mkdirSync(path.dirname(plistPath), { recursive: true });
  if (runtimeDir) mkdirSync(path.join(runtimeDir, "logs"), { recursive: true });
  const template = readFileSync(templatePath, "utf8");
  writeFileSync(plistPath, renderLaunchdTemplate(template, {
    appDir,
    runtimeDir,
    nodePath,
    pythonPath,
  }));
  execFileSyncImpl("plutil", ["-lint", plistPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  execFileSyncImpl("launchctl", ["load", plistPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return getLaunchdStatus({ label, plistPath, execFileSyncImpl });
}

function uninstallLaunchdJob({
  label,
  plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (existsSync(plistPath)) {
    try {
      execFileSyncImpl("launchctl", ["unload", plistPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      // Removing the plist is still useful if launchd no longer has it loaded.
    }
    rmSync(plistPath, { force: true });
  }
  return getLaunchdStatus({ label, plistPath, execFileSyncImpl });
}

export function getWechatCollectorLaunchdStatus({
  plistPath = defaultWechatCollectorLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return getLaunchdStatus({ label: WECHAT_COLLECTOR_LAUNCHD_LABEL, plistPath, execFileSyncImpl });
}

export function installWechatCollectorLaunchd({
  templatePath = defaultWechatCollectorLaunchdPaths().templatePath,
  plistPath = defaultWechatCollectorLaunchdPaths().plistPath,
  appDir = rootDir,
  runtimeDir = path.join(appDir, ".easy_exam_runtime"),
  nodePath = process.execPath,
  pythonPath = defaultPythonPath(),
  execFileSyncImpl = execFileSync,
} = {}) {
  return installLaunchdJob({
    label: WECHAT_COLLECTOR_LAUNCHD_LABEL,
    templatePath,
    plistPath,
    appDir,
    runtimeDir,
    nodePath,
    pythonPath,
    execFileSyncImpl,
  });
}

export function uninstallWechatCollectorLaunchd({
  plistPath = defaultWechatCollectorLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return uninstallLaunchdJob({ label: WECHAT_COLLECTOR_LAUNCHD_LABEL, plistPath, execFileSyncImpl });
}

export function getEasyExamServiceLaunchdStatus({
  plistPath = defaultEasyExamServiceLaunchdPaths().plistPath,
  homeDir = os.homedir(),
  activeServiceLabel = process.env.EASY_EXAM_SERVICE_LABEL || process.env.XPC_SERVICE_NAME,
  activeServicePlistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  const canonicalStatus = getLaunchdStatus({
    label: EASY_EXAM_SERVICE_LAUNCHD_LABEL,
    plistPath,
    execFileSyncImpl,
  });
  if (
    canonicalStatus.loaded
    || !launchdLabelIsUsable(activeServiceLabel)
    || activeServiceLabel === EASY_EXAM_SERVICE_LAUNCHD_LABEL
  ) {
    return canonicalStatus;
  }
  const resolvedActivePlistPath = activeServicePlistPath || path.join(
    homeDir,
    "Library",
    "LaunchAgents",
    `${activeServiceLabel}.plist`,
  );
  if (!existsSync(resolvedActivePlistPath)) return canonicalStatus;
  const activeStatus = getLaunchdStatus({
    label: activeServiceLabel,
    plistPath: resolvedActivePlistPath,
    execFileSyncImpl,
  });
  if (!activeStatus.loaded) return canonicalStatus;
  return {
    ...activeStatus,
    canonicalLabel: EASY_EXAM_SERVICE_LAUNCHD_LABEL,
    reused: true,
    detail: "current Easy Exam launchd job is loaded",
  };
}

export function installEasyExamServiceLaunchd({
  templatePath = defaultEasyExamServiceLaunchdPaths().templatePath,
  plistPath = defaultEasyExamServiceLaunchdPaths().plistPath,
  appDir = rootDir,
  runtimeDir = path.join(appDir, ".easy_exam_runtime"),
  nodePath = process.execPath,
  pythonPath = defaultPythonPath(),
  execFileSyncImpl = execFileSync,
} = {}) {
  return installLaunchdJob({
    label: EASY_EXAM_SERVICE_LAUNCHD_LABEL,
    templatePath,
    plistPath,
    appDir,
    runtimeDir,
    nodePath,
    pythonPath,
    execFileSyncImpl,
  });
}

export function uninstallEasyExamServiceLaunchd({
  plistPath = defaultEasyExamServiceLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return uninstallLaunchdJob({ label: EASY_EXAM_SERVICE_LAUNCHD_LABEL, plistPath, execFileSyncImpl });
}
