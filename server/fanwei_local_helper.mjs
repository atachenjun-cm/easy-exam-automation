import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync as fsExistsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  buildWindowsChromeLaunchArgs,
  createChromeDevToolsTab,
  evaluateChromeDevToolsExpression,
  fetchChromeDevToolsTabs,
  findMacChromeExecutable,
  findWindowsChromeExecutable,
  isAllowedChromeDevToolsWebSocketUrl,
  isFanweiPageUrl,
  isRetryableChromeDevToolsError,
  runChromeDevToolsFanweiRead,
  uploadFilesToChromeDevToolsFileInput,
} from "./fanwei_auto_read.mjs";
import {
  buildScoreStampAttachmentPrepareScript,
  buildScoreStampApplicationFillScript,
  buildScoreStampApplicationSaveScript,
} from "./score_stamp_application.mjs";
import {
  FanweiHelperUpdateError,
  runFanweiHelperUpdate,
} from "./fanwei_local_helper_update.mjs";
import { FANWEI_LOCAL_HELPER_VERSION } from "./fanwei_local_helper_version.mjs";

export { FANWEI_LOCAL_HELPER_VERSION } from "./fanwei_local_helper_version.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const KNOWN_PATHS = new Set([
  "/health",
  "/chrome/ensure",
  "/fanwei/read",
  "/score-stamp/start",
  "/operation-batch/create",
  "/operation-batch/reconcile",
  "/operation-batch/inspect",
  "/operation-batch/update",
  "/operation-archive/inspect",
  "/operation-archive/submit",
  "/operation-content/sync",
  "/operation-personnel/preview",
  "/operation-personnel/send",
  "/operation-personnel/recheck",
  "/update",
]);
const OPERATION_PATHS = new Set([
  "/fanwei/read",
  "/score-stamp/start",
  "/operation-batch/create",
  "/operation-batch/reconcile",
  "/operation-batch/inspect",
  "/operation-batch/update",
  "/operation-archive/inspect",
  "/operation-archive/submit",
  "/operation-content/sync",
  "/operation-personnel/preview",
  "/operation-personnel/send",
  "/operation-personnel/recheck",
]);
const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
const SCORE_STAMP_JSON_BODY_LIMIT_BYTES = 160 * 1024 * 1024;
const SCORE_STAMP_ARCHIVE_LIMIT_BYTES = 100 * 1024 * 1024;
const OPERATION_ARCHIVE_ATTACHMENT_LIMIT_BYTES = 300 * 1024;
const OPERATION_ARCHIVE_ATTACHMENT_COUNT_LIMIT = 10;
const OPERATION_BATCH_REQUEST_TTL_MS = 30 * 60 * 1000;
const OPERATION_PERSONNEL_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FANWEI_START_URL = "https://oa.ata.net.cn/";

export const FANWEI_LOCAL_HELPER_CAPABILITIES = Object.freeze({
  fanweiRead: true,
  scoreStampApplication: true,
  operationBatchCreate: true,
  operationBatchReconcile: true,
  operationBatchInspect: true,
  operationBatchUpdate: true,
  operationArchive: true,
  operationContentSync: true,
  operationPersonnelTask: true,
  selfUpdate: true,
});

class HelperError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function normalizeAllowedOrigins(value = "") {
  const candidates = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,]+/);
  const normalized = [];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text || text === "*") continue;
    try {
      const url = new URL(text);
      if (!new Set(["http:", "https:"]).has(url.protocol)) continue;
      if (url.username || url.password || url.search || url.hash) continue;
      if (url.pathname !== "/") continue;
      if (!normalized.includes(url.origin)) normalized.push(url.origin);
    } catch {
      // Invalid entries are ignored so one bad environment value cannot widen CORS.
    }
  }
  return normalized;
}

export function isAllowedHelperOrigin(origin = "", allowedOrigins = []) {
  const candidate = String(origin || "").trim();
  return Boolean(candidate) && candidate !== "null" && allowedOrigins.includes(candidate);
}

export function loopbackBaseUrl(host = "127.0.0.1", port = 18765) {
  const hostname = String(host).includes(":") ? `[${host}]` : host;
  return `http://${hostname}:${Number(port)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonBody(req, { maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxBytes) {
      throw new HelperError("body_too_large", "请求内容过大。", 413);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HelperError("invalid_json", "请求内容不是有效的 JSON。", 400);
  }
}

function hasFanweiTab(tabs, chromePort) {
  return (Array.isArray(tabs) ? tabs : []).some((tab) =>
    isFanweiPageUrl(tab?.url) &&
    isAllowedChromeDevToolsWebSocketUrl(tab?.webSocketDebuggerUrl, chromePort),
  );
}

function parseChromeJsonValue(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return JSON.parse(text);
}

function isChromeNavigationRetryableError(error) {
  const message = error?.message || String(error || "");
  return /Execution context was destroyed|Cannot find context|Cannot find default execution context|Inspected target navigated|Target closed|WebSocket 在操作完成前已关闭/.test(message);
}

function safeArchiveFileName(value = "") {
  const baseName = path.basename(String(value || "成绩盖章附件.zip").replace(/\\/g, "/"));
  return baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "成绩盖章附件.zip";
}

function scoreStampError(error) {
  if (error instanceof HelperError) return error;
  return new HelperError("score_stamp_failed", error?.message || String(error), 502);
}

function operationConsoleBaseUrl(value = "") {
  try {
    const url = new URL(String(value || "https://dashboard.ata.net.cn").trim());
    if (url.protocol !== "https:"
      || url.hostname !== "dashboard.ata.net.cn"
      || url.port
      || !["", "/"].includes(url.pathname)
      || url.username
      || url.password
      || url.search
      || url.hash) {
      throw new Error("invalid operation console URL");
    }
    return url.origin;
  } catch {
    throw new HelperError(
      "operation_batch_url_invalid",
      "运控建批次地址必须为 https://dashboard.ata.net.cn。",
      400,
    );
  }
}

function operationBatchFailure(error, fallbackCode = "operation_batch_failed") {
  return {
    errorCode: String(error?.code || fallbackCode),
    errorMessage: error?.message || String(error),
  };
}

function operationBatchRequestId(value = "") {
  const requestId = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new HelperError("operation_batch_request_invalid", "缺少有效的本机建批次请求编号。", 400);
  }
  return requestId;
}

export function createFanweiLocalHelperServer({
  allowedOrigins,
  host = "127.0.0.1",
  port = 18765,
  chromePort = 19222,
  runtimeDir,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  updateFetchImpl = globalThis.fetch,
  webSocketFactory,
  spawnImpl = spawn,
  existsSync = fsExistsSync,
  connectOperationBrowserImpl,
  runOperationBatchCreationImpl,
  runOperationBatchReconciliationImpl,
  clickOperationBatchPublishImpl,
  runOperationBatchScheduleInitializationImpl,
  inspectOperationBatchManagedSnapshotImpl,
  runOperationBatchManagedUpdateImpl,
  synchronizeOperationBatchScheduleForArchiveImpl,
  inspectOperationArchiveImpl,
  submitOperationArchiveImpl,
  syncOperationContentImpl,
  runOperationPersonnelInspectionSessionImpl,
  runOperationPersonnelAttemptImpl,
  runOperationPersonnelRecheckImpl,
  closeOperationPersonnelBrowserSessionImpl,
  runHelperUpdateImpl = runFanweiHelperUpdate,
} = {}) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new TypeError("Fanwei local helper host must be loopback-only");
  }
  const origins = normalizeAllowedOrigins(allowedOrigins);
  const helperRuntimeDir = runtimeDir || path.join(os.homedir(), ".yikao-local-helper");
  const supportedPlatform = platform === "darwin" || platform === "win32";
  let ensurePromise = null;
  let operationBrowserPromise = null;
  let activeOperationRequests = 0;
  let updateInProgress = false;
  const operationBatchRequests = new Map();
  const operationPersonnelSessions = new Map();

  async function chromeStatus() {
    if (typeof fetchImpl !== "function") {
      return { chromeConnected: false, fanweiTabFound: false };
    }
    try {
      const tabs = await fetchChromeDevToolsTabs({
        port: chromePort,
        fetchImpl,
        timeoutMs: 500,
      });
      return { chromeConnected: true, fanweiTabFound: hasFanweiTab(tabs, chromePort) };
    } catch {
      return { chromeConnected: false, fanweiTabFound: false };
    }
  }

  function findChromeExecutable() {
    if (platform === "darwin") return findMacChromeExecutable({ existsSync });
    if (platform === "win32") return findWindowsChromeExecutable({ existsSync });
    return "";
  }

  async function launchChrome(startUrl = DEFAULT_FANWEI_START_URL) {
    const executable = findChromeExecutable();
    if (!executable) {
      throw new HelperError(
        "chrome_not_found",
        "未找到 Google Chrome，请先安装 Chrome 后重试。",
        503,
      );
    }
    const userDataDir = path.join(helperRuntimeDir, "chrome-fanwei-profile");
    await mkdir(userDataDir, { recursive: true });
    const args = buildWindowsChromeLaunchArgs({
      userDataDir,
      port: chromePort,
      startUrl,
    });
    try {
      const child = spawnImpl(executable, args, { detached: true, stdio: "ignore" });
      if (typeof child?.once === "function") {
        await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("spawn", resolve);
        });
      }
      child?.unref?.();
    } catch (error) {
      throw new HelperError(
        "chrome_launch_failed",
        `Chrome 启动失败：${error?.message || String(error)}`,
        503,
      );
    }
  }

  async function ensureChrome(startUrl = DEFAULT_FANWEI_START_URL) {
    if (!supportedPlatform) {
      throw new HelperError("unsupported_platform", `当前系统 ${platform} 暂不支持泛微自动读取。`, 501);
    }
    const initial = await chromeStatus();
    if (initial.chromeConnected) {
      return { ...initial, launchedChrome: false };
    }
    await launchChrome(startUrl);
    const deadline = Date.now() + 5000;
    do {
      const status = await chromeStatus();
      if (status.chromeConnected) return { ...status, launchedChrome: true };
      if (Date.now() >= deadline) break;
      await sleep(100);
    } while (true);
    throw new HelperError(
      "chrome_devtools_unavailable",
      "Chrome 已启动，但 5 秒内未能连接调试端口，请稍后重试。",
      503,
    );
  }

  async function ensureChromeOnce(startUrl = DEFAULT_FANWEI_START_URL) {
    if (!ensurePromise) {
      ensurePromise = ensureChrome(startUrl).finally(() => {
        ensurePromise = null;
      });
    }
    return await ensurePromise;
  }

  async function connectOperationBrowser() {
    if (operationBrowserPromise) return await operationBrowserPromise;
    operationBrowserPromise = (async () => {
      if (typeof connectOperationBrowserImpl === "function") {
        return await connectOperationBrowserImpl({ chromePort });
      }
      let chromium;
      try {
        ({ chromium } = await import("playwright"));
      } catch (error) {
        throw new HelperError(
          "operation_batch_playwright_missing",
          "本机助手版本缺少运控自动化组件，请重新下载安装本机助手。",
          503,
        );
      }
      return await chromium.connectOverCDP(`http://127.0.0.1:${chromePort}`);
    })().then((browser) => {
      browser?.once?.("disconnected", () => { operationBrowserPromise = null; });
      return browser;
    }).catch((error) => {
      operationBrowserPromise = null;
      throw error;
    });
    return await operationBrowserPromise;
  }

  async function operationBatchRunners() {
    const operationBatchRunner = await import("./operation_batch_runner.mjs");
    const creation = typeof runOperationBatchCreationImpl === "function"
      ? runOperationBatchCreationImpl
      : operationBatchRunner.runOperationBatchCreation;
    const reconciliation = typeof runOperationBatchReconciliationImpl === "function"
      ? runOperationBatchReconciliationImpl
      : operationBatchRunner.runOperationBatchReconciliation;
    const publish = typeof clickOperationBatchPublishImpl === "function"
      ? clickOperationBatchPublishImpl
      : operationBatchRunner.clickOperationBatchPublish;
    let initialize = runOperationBatchScheduleInitializationImpl;
    if (typeof initialize !== "function") {
      try {
        initialize = (await import("./operation_batch_update_runner.mjs"))
          .runOperationBatchScheduleInitialization;
      } catch {
        initialize = null;
      }
    }
    return { creation, reconciliation, publish, initialize };
  }

  function openOperationBatchDetailPage(context, detailUrl, baseUrl) {
    try {
      const expectedOrigin = new URL(baseUrl).origin;
      const expectedDetail = new URL(detailUrl);
      if (expectedDetail.origin !== expectedOrigin || expectedDetail.pathname !== "/batch/batchDetail") {
        return null;
      }
      return context.pages().find((page) => {
        try {
          const value = new URL(page.url());
          return value.origin === expectedOrigin
            && value.pathname === "/batch/batchDetail"
            && value.searchParams.get("batch_guid") === expectedDetail.searchParams.get("batch_guid");
        } catch {
          return false;
        }
      }) || null;
    } catch {
      return null;
    }
  }

  async function operationBatchManagedRunners() {
    const runner = await import("./operation_batch_update_runner.mjs");
    return {
      inspect: typeof inspectOperationBatchManagedSnapshotImpl === "function"
        ? inspectOperationBatchManagedSnapshotImpl
        : runner.inspectOperationBatchManagedSnapshot,
      update: typeof runOperationBatchManagedUpdateImpl === "function"
        ? runOperationBatchManagedUpdateImpl
        : runner.runOperationBatchManagedUpdate,
      syncForArchive: typeof synchronizeOperationBatchScheduleForArchiveImpl === "function"
        ? synchronizeOperationBatchScheduleForArchiveImpl
        : runner.synchronizeOperationBatchScheduleForArchive,
    };
  }

  async function inspectOperationBatchBaseline(operationBatchCode, baseUrl, context) {
    const runners = await operationBatchManagedRunners();
    const snapshot = await runners.inspect({
      batch: { code: operationBatchCode },
    }, {
      baseUrl,
      context,
      closeContext: false,
      headless: false,
    });
    return {
      verified: true,
      snapshot,
      action: "baseline",
      checkpoints: ["created_batch_inspected"],
      allowEmptySchedules: true,
    };
  }

  async function operationArchiveRunners() {
    const runner = await import("./operation_archive_runner.mjs");
    return {
      inspect: typeof inspectOperationArchiveImpl === "function"
        ? inspectOperationArchiveImpl
        : runner.prepareOperationArchive,
      submit: typeof submitOperationArchiveImpl === "function"
        ? submitOperationArchiveImpl
        : runner.submitOperationArchive,
    };
  }

  async function operationContentRunner() {
    if (typeof syncOperationContentImpl === "function") return syncOperationContentImpl;
    return (await import("./operation_content_runner.mjs")).syncOperationContent;
  }

  async function operationPersonnelRunners() {
    const runner = await import("./operation_personnel_task_runner.mjs");
    return {
      inspectSession: typeof runOperationPersonnelInspectionSessionImpl === "function"
        ? runOperationPersonnelInspectionSessionImpl
        : runner.runOperationPersonnelInspectionSession,
      attempt: typeof runOperationPersonnelAttemptImpl === "function"
        ? runOperationPersonnelAttemptImpl
        : runner.runOperationPersonnelAttempt,
      recheck: typeof runOperationPersonnelRecheckImpl === "function"
        ? runOperationPersonnelRecheckImpl
        : runner.runOperationPersonnelRecheck,
      closeSession: typeof closeOperationPersonnelBrowserSessionImpl === "function"
        ? closeOperationPersonnelBrowserSessionImpl
        : runner.closeOperationPersonnelBrowserSession,
    };
  }

  async function disposeOperationPersonnelSession(record) {
    if (!record || record.closed) return;
    record.closed = true;
    if (record.timer) clearTimeout(record.timer);
    if (operationPersonnelSessions.get(record.sessionToken) === record) {
      operationPersonnelSessions.delete(record.sessionToken);
    }
    const runners = await operationPersonnelRunners();
    await runners.closeSession(record.browserSession);
  }

  function retainOperationPersonnelSession(browserSession, instruction, requestId) {
    const sessionToken = randomUUID();
    const expiresAtMs = Date.now() + OPERATION_PERSONNEL_SESSION_TTL_MS;
    const record = {
      sessionToken,
      requestId,
      browserSession,
      batchCode: String(instruction?.batch?.code || instruction?.batchCode || "").trim(),
      expiresAtMs,
      closed: false,
      timer: null,
    };
    operationPersonnelSessions.set(sessionToken, record);
    record.timer = setTimeout(() => {
      void disposeOperationPersonnelSession(record).catch(() => {});
    }, OPERATION_PERSONNEL_SESSION_TTL_MS);
    record.timer.unref?.();
    return {
      sessionToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async function executeOperationPersonnelPreview(payload = {}) {
    const requestId = operationBatchRequestId(payload?.requestId);
    const instruction = payload?.instruction;
    const batchCode = String(instruction?.batch?.code || instruction?.batchCode || "").trim();
    if (!instruction || !batchCode) {
      throw new HelperError("operation_personnel_payload_invalid", "缺少完整的人员任务预览参数。", 400);
    }
    const baseUrl = operationConsoleBaseUrl(payload?.baseUrl);
    await ensureChromeOnce(baseUrl);
    const browser = await connectOperationBrowser();
    const context = browser?.contexts?.()[0];
    if (!context) {
      throw new HelperError(
        "operation_personnel_chrome_context_missing",
        "未取得点击者电脑的专用 Chrome 登录环境。",
        503,
      );
    }
    const runners = await operationPersonnelRunners();
    const inspected = await runners.inspectSession(instruction, {
      baseUrl,
      context,
      closeContext: false,
      headless: false,
    });
    const retained = retainOperationPersonnelSession(
      inspected.browserSession,
      instruction,
      requestId,
    );
    return {
      status: "success",
      snapshot: inspected.snapshot,
      ...retained,
    };
  }

  async function executeOperationPersonnelAttempt(payload = {}) {
    operationBatchRequestId(payload?.requestId);
    const sessionToken = String(payload?.sessionToken || "").trim();
    const instruction = payload?.instruction;
    const record = operationPersonnelSessions.get(sessionToken);
    const batchCode = String(instruction?.batch?.code || instruction?.batchCode || "").trim();
    if (
      !record
      || record.closed
      || record.expiresAtMs <= Date.now()
      || !instruction
      || !batchCode
      || record.batchCode !== batchCode
    ) {
      throw new HelperError(
        "operation_personnel_preview_stale",
        "当前电脑的人员任务预览已失效，请重新预览。",
        409,
      );
    }
    const checkpoints = [];
    let verification = null;
    try {
      const runners = await operationPersonnelRunners();
      const result = await runners.attempt(instruction, {
        baseUrl: operationConsoleBaseUrl(payload?.baseUrl),
        browserSession: record.browserSession,
        closeContext: false,
        headless: false,
        onCheckpoint: async (checkpoint) => {
          const index = checkpoints.findIndex((item) => item.name === checkpoint.name);
          if (index >= 0) checkpoints[index] = structuredClone(checkpoint);
          else checkpoints.push(structuredClone(checkpoint));
        },
        onVerification: async (value) => { verification = structuredClone(value); },
      });
      return {
        status: "completed",
        result,
        checkpoints,
        verification,
      };
    } catch (error) {
      return {
        status: "failed",
        error: {
          code: String(error?.code || "PERSONNEL_LOCAL_EXECUTION_FAILED"),
          message: error?.message || String(error),
          status: Number(error?.status || 409),
        },
        checkpoints,
        verification,
      };
    } finally {
      await disposeOperationPersonnelSession(record).catch(() => {});
    }
  }

  async function executeOperationPersonnelRecheck(payload = {}) {
    operationBatchRequestId(payload?.requestId);
    const instruction = payload?.instruction;
    const batchCode = String(instruction?.batch?.code || instruction?.batchCode || "").trim();
    if (!instruction || !batchCode) {
      throw new HelperError("operation_personnel_payload_invalid", "缺少完整的人员任务复核参数。", 400);
    }
    const baseUrl = operationConsoleBaseUrl(payload?.baseUrl);
    await ensureChromeOnce(baseUrl);
    const browser = await connectOperationBrowser();
    const context = browser?.contexts?.()[0];
    if (!context) {
      throw new HelperError(
        "operation_personnel_chrome_context_missing",
        "未取得点击者电脑的专用 Chrome 登录环境。",
        503,
      );
    }
    const runners = await operationPersonnelRunners();
    const result = await runners.recheck(instruction, {
      baseUrl,
      context,
      closeContext: false,
      headless: false,
    });
    return { status: "success", result };
  }

  async function executeOperationContent(payload = {}) {
    const draft = payload?.draft;
    if (!draft?.batch?.code || !draft?.batch?.name || !draft?.batch?.detailUrl) {
      throw new HelperError("operation_content_payload_invalid", "缺少完整的运控内容同步参数。", 400);
    }
    if (!payload?.dispatchTarget?.projectCode || !Array.isArray(payload?.dispatchTarget?.recipients)) {
      throw new HelperError("operation_content_dispatch_target_invalid", "缺少内容任务单收件人或项目分组参数。", 400);
    }
    const baseUrl = operationConsoleBaseUrl(payload?.baseUrl);
    await ensureChromeOnce(baseUrl);
    const browser = await connectOperationBrowser();
    const context = browser?.contexts?.()[0];
    if (!context) {
      throw new HelperError("operation_content_chrome_context_missing", "未取得本机专用 Chrome 登录环境，请关闭专用 Chrome 后重试。", 503);
    }
    try {
      const sync = await operationContentRunner();
      return await sync(draft, {
        baseUrl,
        context,
        dispatchTarget: payload.dispatchTarget,
        confirmDispatch: true,
        sendKind: payload.sendKind,
        changeSummary: payload.changeSummary,
        closeContext: false,
        headless: false,
      });
    } catch (error) {
      throw new HelperError(
        String(error?.code || "operation_content_sync_failed"),
        error?.message || String(error),
        Number(error?.status || 409),
      );
    }
  }

  function operationArchiveAttachmentName(value = "", index = 0) {
    const baseName = path.basename(String(value || `归档凭证-${index + 1}.png`).replace(/\\/g, "/"));
    const safeName = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
    return safeName || `归档凭证-${index + 1}.png`;
  }

  async function materializeOperationArchiveAttachments(payload = {}, requestId = "") {
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (attachments.length > OPERATION_ARCHIVE_ATTACHMENT_COUNT_LIMIT) {
      throw new HelperError("operation_archive_attachment_count", "归档凭证最多上传 10 张。", 400);
    }
    if (payload?.draft?.attachmentsRequired !== false && !attachments.length) {
      throw new HelperError("operation_archive_attachment_required", "请至少选择一张归档凭证图片。", 400);
    }
    if (!attachments.length) return { tempDir: "", filePaths: [] };
    const tempDir = path.join(helperRuntimeDir, "operation-archive", requestId);
    await rm(tempDir, { recursive: true, force: true });
    await mkdir(tempDir, { recursive: true });
    const filePaths = [];
    try {
      for (let index = 0; index < attachments.length; index += 1) {
        const attachment = attachments[index] || {};
        const mimeType = String(attachment.mimeType || "").toLowerCase();
        if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(mimeType)) {
          throw new HelperError("operation_archive_attachment_type", "归档凭证仅支持 PNG、JPG 或 WebP 图片。", 400);
        }
        const base64 = String(attachment.base64 || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
        if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
          throw new HelperError("operation_archive_attachment_invalid", "归档凭证不是有效的图片数据。", 400);
        }
        const buffer = Buffer.from(base64, "base64");
        if (!buffer.length || buffer.length >= OPERATION_ARCHIVE_ATTACHMENT_LIMIT_BYTES) {
          throw new HelperError("operation_archive_attachment_size", "每张归档凭证必须小于 300KB。", 400);
        }
        const filePath = path.join(tempDir, `${index + 1}-${operationArchiveAttachmentName(attachment.fileName, index)}`);
        await writeFile(filePath, buffer);
        filePaths.push(filePath);
      }
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return { tempDir, filePaths };
  }

  async function executeOperationArchive(payload = {}, mode = "inspect") {
    const draft = payload?.draft;
    if (!draft?.fields || typeof draft.fields !== "object") {
      throw new HelperError("operation_archive_payload_invalid", "缺少有效的运控归档参数。", 400);
    }
    const baseUrl = operationConsoleBaseUrl(payload?.baseUrl);
    await ensureChromeOnce(baseUrl);
    const browser = await connectOperationBrowser();
    const context = browser?.contexts?.()[0];
    if (!context) {
      throw new HelperError("operation_archive_chrome_context_missing", "未取得本机专用 Chrome 登录环境，请关闭专用 Chrome 后重试。", 503);
    }
    const runners = await operationArchiveRunners();
    const requestId = operationBatchRequestId(payload?.requestId);
    let materialized = { tempDir: "", filePaths: [] };
    try {
      let scheduleSynchronization = null;
      if (mode === "submit") {
        materialized = await materializeOperationArchiveAttachments(payload, requestId);
      }
      const runner = mode === "submit" ? runners.submit : runners.inspect;
      const runArchive = () => runner(draft, {
          baseUrl,
          batchDetailUrl: String(payload?.batchDetailUrl || "").trim(),
          context,
          closeContext: false,
          headless: false,
          attachmentPaths: materialized.filePaths,
        });
      const reusePreparedArchiveForm = mode === "submit" && payload.reusePreparedArchiveForm === true;
      let result;
      try {
        result = await runArchive();
      } catch (error) {
        const scheduleFallbackCodes = new Set([
          "OPERATION_ARCHIVE_ACTION_NOT_FOUND",
          "OPERATION_ARCHIVE_SCHEDULE_REQUIRED",
        ]);
        if (reusePreparedArchiveForm || !scheduleFallbackCodes.has(String(error?.code || ""))) throw error;
        if (!payload.scheduleInstruction?.desiredSnapshot) {
          throw new HelperError("operation_archive_schedule_required", "缺少可核验的正式考试日程，不能进入归档。", 400);
        }
        const managedRunners = await operationBatchManagedRunners();
        scheduleSynchronization = await managedRunners.syncForArchive(payload.scheduleInstruction, {
          baseUrl,
          context,
          closeContext: false,
          headless: false,
        });
        if (scheduleSynchronization?.verified !== true) {
          throw new HelperError("operation_archive_schedule_unverified", "运营批次考试日程未通过回读验证，不能进入归档。", 409);
        }
        result = await runArchive();
      }
      const normalizedResult = mode === "inspect" && result?.status === "prepared"
        ? { ...result, status: "ready", formPrepared: true }
        : result;
      return {
        ...normalizedResult,
        ...(scheduleSynchronization ? { scheduleSynchronization } : {}),
      };
    } catch (error) {
      if (error instanceof HelperError) throw error;
      throw new HelperError(
        String(error?.code || (mode === "submit" ? "operation_archive_submit_failed" : "operation_archive_inspect_failed")),
        error?.message || String(error),
        Number(error?.status || 409),
      );
    } finally {
      if (materialized.tempDir) await rm(materialized.tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function executeOperationBatchApplication(payload = {}) {
    const draft = payload?.draft;
    if (!draft?.fields || typeof draft.fields !== "object") {
      throw new HelperError("operation_batch_payload_invalid", "缺少有效的运控建批次参数。", 400);
    }
    const baseUrl = operationConsoleBaseUrl(payload?.baseUrl);
    const desired = payload?.desired && typeof payload.desired === "object"
      ? payload.desired
      : { complete: false };
    await ensureChromeOnce(baseUrl);
    const browser = await connectOperationBrowser();
    const context = browser?.contexts?.()[0];
    if (!context) {
      throw new HelperError(
        "operation_batch_chrome_context_missing",
        "未取得本机专用 Chrome 登录环境，请关闭专用 Chrome 后重试。",
        503,
      );
    }
    const runners = await operationBatchRunners();
    const runnerOptions = {
      baseUrl,
      context,
      closeContext: false,
      headless: false,
      allowTaskMismatch: false,
      publishAfterCreate: false,
    };
    let created;
    let reconciled = false;
    try {
      created = await runners.creation(draft, runnerOptions);
    } catch (error) {
      if (error?.code === "OPERATION_BATCH_RECONCILIATION_REQUIRED") {
        try {
          created = await runners.reconciliation(draft, runnerOptions);
          reconciled = true;
        } catch {
          // Keep the explicit confirmation state when the external list is still inconclusive.
        }
        if (!created?.operationBatchCode) {
          return {
            status: "reconciliation_required",
            externalBatchConfirmed: true,
            ...operationBatchFailure(error, "OPERATION_BATCH_RECONCILIATION_REQUIRED"),
          };
        }
      } else {
        throw new HelperError(
          String(error?.code || "operation_batch_create_failed"),
          error?.message || String(error),
          Number(error?.status || 502),
        );
      }
    }
    const locateCreatedBatch = async () => {
      const createdDetailPage = openOperationBatchDetailPage(
        context,
        String(created?.detailUrl || "").trim(),
        baseUrl,
      );
      const expectedBatchName = String(draft?.fields?.batchName?.value || "").trim();
      if (created?.identityVerified === true
        && created?.operationBatchCode
        && created?.batchName === expectedBatchName
        && createdDetailPage) {
        return { located: created, detailPage: createdDetailPage };
      }
      let located;
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          located = await runners.reconciliation(draft, {
            ...runnerOptions,
            operationBatchCode: created?.operationBatchCode || "",
            publishAfterCreate: false,
            ...(createdDetailPage ? { page: createdDetailPage } : {}),
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt > 0 || error?.code !== "OPERATION_BATCH_RECONCILIATION_REQUIRED") throw error;
          if (typeof createdDetailPage?.waitForTimeout === "function") {
            await createdDetailPage.waitForTimeout(1000);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
      if (!located) throw lastError || new Error("按批次号搜索未返回运营批次");
      const detailPage = openOperationBatchDetailPage(
        context,
        String(located?.detailUrl || "").trim(),
        baseUrl,
      );
      if (!located?.operationBatchCode || !detailPage) {
        const error = new Error("按批次号定位后未进入唯一的运营批次详情页");
        error.code = "OPERATION_BATCH_DETAIL_NOT_OPENED";
        throw error;
      }
      return { located, detailPage };
    };
    let located;
    let detailPage;
    let locateFailure;
    try {
      ({ located, detailPage } = await locateCreatedBatch());
    } catch (error) {
      locateFailure = operationBatchFailure(error, "operation_batch_locate_failed");
    }
    let managedResult;
    let scheduleStatus = "synced";
    let scheduleFailure;
    const actualBatchName = String(located?.batchName || created?.batchName || "").trim();
    if (!desired.complete) {
      scheduleStatus = "waiting_schedule";
      scheduleFailure = {
        errorCode: "operation_batch_schedule_incomplete",
        errorMessage: `正式考试日程不完整：${(desired.missing || []).join("；") || "缺少日程字段"}`,
      };
    } else if (typeof runners.initialize !== "function") {
      scheduleStatus = "failed";
      scheduleFailure = {
        errorCode: "operation_batch_initializer_missing",
        errorMessage: "本机助手版本缺少批次日程初始化组件，请重新下载安装本机助手。",
      };
    } else if (!detailPage) {
      scheduleStatus = "failed";
      scheduleFailure = locateFailure || {
        errorCode: "OPERATION_BATCH_DETAIL_NOT_OPENED",
        errorMessage: "未进入按批次号唯一定位的批次详情页，未补充日程。",
      };
    } else {
      try {
        if (!actualBatchName) {
          const error = new Error("未取得实际批次名");
          error.code = "OPERATION_BATCH_ACTUAL_NAME_MISSING";
          throw error;
        }
        const desiredSnapshot = { ...desired.snapshot, batchName: actualBatchName };
        managedResult = await runners.initialize({
          batch: { code: located.operationBatchCode, name: actualBatchName },
          desiredSnapshot,
        }, {
          ...runnerOptions,
          page: detailPage,
          reuseVerifiedDetail: true,
          verifiedDetailUrl: located.detailUrl,
        });
        if (managedResult?.verified !== true) {
          throw new Error("运营批次日程写入后未通过回读校验");
        }
      } catch (error) {
        scheduleStatus = "failed";
        scheduleFailure = operationBatchFailure(error, "operation_batch_initialize_failed");
      }
    }
    let published = located?.status === "published" ? located : null;
    let publishFailure;
    if (!published && detailPage) {
      try {
        const publishResult = await runners.publish(detailPage, { baseUrl });
        if (publishResult?.status !== "published") {
          throw new Error("运营批次发布后未回读到已发布状态");
        }
        published = { ...located, ...publishResult, status: "published" };
      } catch (error) {
        publishFailure = operationBatchFailure(error, "operation_batch_publish_failed");
      }
    } else if (!published) {
      publishFailure = locateFailure || {
        errorCode: "operation_batch_publish_failed",
        errorMessage: "未进入按批次号唯一定位的批次详情页，未执行发布。",
      };
    }
    return {
      status: published ? "success" : "publish_failed",
      publishStatus: published ? "published" : "failed",
      operationBatchCode: published?.operationBatchCode || located?.operationBatchCode || created?.operationBatchCode || "",
      created: published || located || { ...created, status: "created_unpublished" },
      initialCreated: created,
      managedResult,
      scheduleStatus,
      ...(scheduleFailure ? {
        scheduleErrorCode: scheduleFailure.errorCode,
        scheduleErrorMessage: scheduleFailure.errorMessage,
      } : {}),
      reconciled,
      ...(publishFailure || {}),
    };
  }

  async function runOperationBatchApplication(payload = {}) {
    const requestId = operationBatchRequestId(payload?.requestId);
    const now = Date.now();
    for (const [id, request] of operationBatchRequests) {
      if (request.expiresAt <= now) operationBatchRequests.delete(id);
    }
    const existing = operationBatchRequests.get(requestId);
    if (existing) return await existing.promise;
    const promise = executeOperationBatchApplication(payload);
    operationBatchRequests.set(requestId, {
      promise,
      expiresAt: now + OPERATION_BATCH_REQUEST_TTL_MS,
    });
    return await promise;
  }

  async function executeOperationBatchReconciliation(payload = {}) {
    const draft = payload?.draft;
    if (!draft?.fields || typeof draft.fields !== "object") {
      throw new HelperError("operation_batch_payload_invalid", "缺少有效的运控批次回查参数。", 400);
    }
    const operationBatchCode = String(payload.operationBatchCode || "").trim();
    if (!operationBatchCode) {
      throw new HelperError(
        "operation_batch_code_required",
        "添加日程必须先有批次代码，请先补录批次代码和批次名称。",
        409,
      );
    }
    const baseUrl = operationConsoleBaseUrl(payload?.baseUrl);
    await ensureChromeOnce(baseUrl);
    const browser = await connectOperationBrowser();
    const context = browser?.contexts?.()[0];
    if (!context) {
      throw new HelperError("operation_batch_chrome_context_missing", "未取得本机专用 Chrome 登录环境，请关闭专用 Chrome 后重试。", 503);
    }
    const runners = await operationBatchRunners();
    try {
      const located = await runners.reconciliation(draft, {
        baseUrl,
        context,
        closeContext: false,
        headless: false,
        operationBatchCode,
        publishAfterCreate: false,
      });
      if (!located?.operationBatchCode) throw new Error("运营批次回查没有返回批次代码");
      let published = located.status === "published" ? located : null;
      let publishFailure;
      if (!published && payload.publishRequired !== false) {
        try {
          const detailPage = openOperationBatchDetailPage(context, located.detailUrl, baseUrl);
          if (!detailPage) throw new Error("批次代码定位后未保留唯一批次详情页");
          const publishResult = await runners.publish(detailPage, { baseUrl });
          published = { ...located, ...publishResult, status: "published" };
        } catch (error) {
          publishFailure = operationBatchFailure(error, "operation_batch_publish_failed");
        }
      } else if (!published) {
        publishFailure = {
          errorCode: "operation_batch_publish_not_verified",
          errorMessage: "运营批次详情未回读到已发布状态",
        };
      }
      let managedResult;
      let scheduleStatus = "synced";
      let scheduleFailure;
      const actualBatchName = String(located.batchName || "").trim();
      if (!payload.desired?.complete) {
        scheduleStatus = "waiting_schedule";
        scheduleFailure = {
          errorCode: "operation_batch_schedule_incomplete",
          errorMessage: `正式考试日程不完整：${(payload.desired?.missing || []).join("；") || "缺少日程字段"}`,
        };
      } else {
        try {
          if (!actualBatchName) {
            const error = new Error("未取得实际批次名");
            error.code = "OPERATION_BATCH_ACTUAL_NAME_MISSING";
            throw error;
          }
          const desiredSnapshot = { ...payload.desired.snapshot, batchName: actualBatchName };
          const managedRunners = await operationBatchManagedRunners();
          managedResult = await managedRunners.syncForArchive({
            batch: {
              code: located.operationBatchCode,
              name: actualBatchName,
            },
            desiredSnapshot,
          }, {
            baseUrl,
            context,
            closeContext: false,
            headless: false,
            reuseVerifiedDetail: true,
            verifiedDetailUrl: located.detailUrl,
          });
          if (managedResult?.verified !== true) {
            throw new Error("运营批次日程写入后未通过回读校验");
          }
        } catch (error) {
          scheduleStatus = "failed";
          scheduleFailure = operationBatchFailure(error, "operation_batch_initialize_failed");
        }
      }
      return {
        status: published ? "success" : "publish_failed",
        publishStatus: published ? "published" : "failed",
        operationBatchCode: located.operationBatchCode,
        created: published || { ...located, status: "created_unpublished" },
        initialCreated: located,
        managedResult,
        scheduleStatus,
        ...(scheduleFailure ? {
          scheduleErrorCode: scheduleFailure.errorCode,
          scheduleErrorMessage: scheduleFailure.errorMessage,
        } : {}),
        reconciled: true,
        ...(publishFailure || {}),
      };
    } catch (error) {
      if (error?.code === "OPERATION_BATCH_RECONCILIATION_REQUIRED") {
        return {
          status: "reconciliation_required",
          externalBatchConfirmed: true,
          ...operationBatchFailure(error, "OPERATION_BATCH_RECONCILIATION_REQUIRED"),
        };
      }
      throw new HelperError(
        String(error?.code || "operation_batch_reconcile_failed"),
        error?.message || String(error),
        Number(error?.status || 502),
      );
    }
  }

  async function runOperationBatchReconciliationApplication(payload = {}) {
    const requestId = operationBatchRequestId(payload?.requestId);
    const now = Date.now();
    for (const [id, request] of operationBatchRequests) {
      if (request.expiresAt <= now) operationBatchRequests.delete(id);
    }
    const existing = operationBatchRequests.get(requestId);
    if (existing) return await existing.promise;
    const promise = executeOperationBatchReconciliation(payload);
    operationBatchRequests.set(requestId, { promise, expiresAt: now + OPERATION_BATCH_REQUEST_TTL_MS });
    return await promise;
  }

  async function operationBatchManagedContext(payload = {}) {
    const instruction = payload?.instruction;
    if (!instruction?.batch || typeof instruction.batch !== "object") {
      throw new HelperError("operation_batch_payload_invalid", "缺少有效的运营批次更新参数。", 400);
    }
    const baseUrl = operationConsoleBaseUrl(payload?.baseUrl);
    await ensureChromeOnce(baseUrl);
    const browser = await connectOperationBrowser();
    const context = browser?.contexts?.()[0];
    if (!context) {
      throw new HelperError(
        "operation_batch_chrome_context_missing",
        "未取得本机专用 Chrome 登录环境，请关闭专用 Chrome 后重试。",
        503,
      );
    }
    return {
      instruction,
      runners: await operationBatchManagedRunners(),
      runnerOptions: {
        baseUrl,
        context,
        closeContext: false,
        headless: false,
      },
    };
  }

  async function executeOperationBatchInspection(payload = {}) {
    const { instruction, runners, runnerOptions } = await operationBatchManagedContext(payload);
    try {
      const snapshot = await runners.inspect(instruction, runnerOptions);
      return {
        status: "success",
        snapshot,
        checkpoints: ["opened_exact_batch", "managed_fields_read"],
      };
    } catch (error) {
      throw new HelperError(
        String(error?.code || "").trim() || "operation_batch_inspection_failed",
        error?.message || String(error),
        Number(error?.status || 409),
      );
    }
  }

  async function executeOperationBatchManagedUpdate(payload = {}) {
    const { instruction, runners, runnerOptions } = await operationBatchManagedContext(payload);
    try {
      const result = await runners.update(instruction, runnerOptions);
      return { status: "success", ...result };
    } catch (error) {
      let inspectedAfter = null;
      try {
        inspectedAfter = await runners.inspect({ batch: instruction.batch }, runnerOptions);
      } catch {
        // Keep the original update failure when exact readback is unavailable.
      }
      const desired = instruction.desiredSnapshot;
      const expected = instruction.batch?.expectedAppliedSnapshot;
      if (inspectedAfter && JSON.stringify(inspectedAfter) === JSON.stringify(desired)) {
        return {
          status: "success",
          verified: true,
          snapshot: inspectedAfter,
          checkpoints: ["reconciled_exact_readback"],
        };
      }
      const unchanged = inspectedAfter
        && JSON.stringify(inspectedAfter) === JSON.stringify(expected);
      return {
        status: unchanged ? "failed" : inspectedAfter ? "conflict" : "failed",
        errorCode: String(error?.code || "").trim() || "operation_batch_update_failed",
        errorMessage: error?.message || String(error),
        ...(inspectedAfter ? { inspectedAfter } : {}),
      };
    }
  }

  async function runManagedOperationRequest(payload, operation) {
    const requestId = operationBatchRequestId(payload?.requestId);
    const now = Date.now();
    for (const [id, request] of operationBatchRequests) {
      if (request.expiresAt <= now) operationBatchRequests.delete(id);
    }
    const existing = operationBatchRequests.get(requestId);
    if (existing) return await existing.promise;
    const promise = operation(payload);
    operationBatchRequests.set(requestId, {
      promise,
      expiresAt: now + OPERATION_BATCH_REQUEST_TTL_MS,
    });
    return await promise;
  }

  async function resolveCreatedChromeTab(tab, workflowUrl) {
    if (isAllowedChromeDevToolsWebSocketUrl(tab?.webSocketDebuggerUrl, chromePort)) return tab;
    const tabs = await fetchChromeDevToolsTabs({ port: chromePort, fetchImpl, timeoutMs: 5000 });
    const expectedWorkflowId = new URL(workflowUrl).hash.match(/workflowid=([^&]+)/)?.[1] || "105021";
    return (Array.isArray(tabs) ? tabs : []).find((item) =>
      tab?.id &&
      item.id === tab.id &&
      isAllowedChromeDevToolsWebSocketUrl(item?.webSocketDebuggerUrl, chromePort)
    ) || (Array.isArray(tabs) ? tabs : []).find((item) =>
      String(item?.url || "").includes(`workflowid=${expectedWorkflowId}`) &&
      isAllowedChromeDevToolsWebSocketUrl(item?.webSocketDebuggerUrl, chromePort)
    );
  }

  async function withScoreStampChromeRetry({ tab, workflowUrl, operation, attempts = 4, delayMs = 1000 } = {}) {
    let currentTab = tab;
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await operation(currentTab);
      } catch (error) {
        lastError = error;
        if (!isChromeNavigationRetryableError(error) || attempt === attempts - 1) throw error;
        await sleep(delayMs);
        currentTab = await resolveCreatedChromeTab(currentTab, workflowUrl) || currentTab;
      }
    }
    throw lastError || new Error("Chrome DevTools 操作失败");
  }

  async function runScoreStampApplication(payload) {
    await ensureChromeOnce();
    const stampPayload = payload?.payload && typeof payload.payload === "object" ? payload.payload : {};
    const workflowUrl = String(stampPayload.workflowUrl || "").trim();
    if (!workflowUrl) {
      throw new HelperError("score_stamp_payload_invalid", "缺少 OA 盖章申请地址。", 400);
    }
    let workflowHost = "";
    try {
      workflowHost = new URL(workflowUrl).hostname;
    } catch {
      throw new HelperError("score_stamp_payload_invalid", "OA 盖章申请地址格式不正确。", 400);
    }
    if (workflowHost !== "oa.ata.net.cn" && !workflowHost.endsWith(".oa.ata.net.cn")) {
      throw new HelperError("score_stamp_payload_invalid", "OA 盖章申请地址不受信任。", 400);
    }
    const archiveBase64 = String(payload?.archiveBase64 || "").replace(/\s+/g, "");
    if (!archiveBase64) {
      throw new HelperError("score_stamp_archive_required", "缺少需要上传的盖章附件压缩包。", 400);
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(archiveBase64)) {
      throw new HelperError("score_stamp_archive_invalid", "盖章附件内容不是有效的 base64 数据。", 400);
    }
    const archiveBuffer = Buffer.from(archiveBase64, "base64");
    if (!archiveBuffer.length) {
      throw new HelperError("score_stamp_archive_required", "缺少需要上传的盖章附件压缩包。", 400);
    }
    if (archiveBuffer.length > SCORE_STAMP_ARCHIVE_LIMIT_BYTES) {
      throw new HelperError("score_stamp_archive_too_large", "盖章附件超过 100MB，无法通过本机助手上传。", 413);
    }
    const archiveFileName = safeArchiveFileName(payload?.archiveFileName || stampPayload.archiveFileName);
    const tempDir = path.join(helperRuntimeDir, "score-stamp", randomUUID());
    await mkdir(tempDir, { recursive: true });
    const archiveFilePath = path.join(tempDir, archiveFileName);
    try {
      await writeFile(archiveFilePath, archiveBuffer);
      const createdTab = await createChromeDevToolsTab({
        url: workflowUrl,
        port: chromePort,
        fetchImpl,
        timeoutMs: 10000,
      });
      const tab = await resolveCreatedChromeTab(createdTab, workflowUrl);
      if (!tab?.webSocketDebuggerUrl) {
        throw new Error("已打开 OA 页面，但未取得可自动填写的 Chrome DevTools 标签页。");
      }
      const raw = await withScoreStampChromeRetry({
        tab,
        workflowUrl,
        operation: (currentTab) => evaluateChromeDevToolsExpression({
          tab: currentTab,
          expression: buildScoreStampApplicationFillScript({ ...stampPayload, archiveFileName }),
          timeoutMs: 45000,
          port: chromePort,
          webSocketFactory,
        }),
      });
      const pageResult = parseChromeJsonValue(raw);
      if (!pageResult.ok) {
        const detail = (pageResult.warnings || []).join("；") ||
          (pageResult.url ? `页面地址：${pageResult.url}` : "") ||
          `返回：${JSON.stringify(pageResult).slice(0, 240)}`;
        throw new Error(`OA 成绩盖章申请页预填失败：${detail}`);
      }
      const uploadResult = await withScoreStampChromeRetry({
        tab,
        workflowUrl,
        operation: (currentTab) => uploadFilesToChromeDevToolsFileInput({
          tab: currentTab,
          filePaths: [archiveFilePath],
          selector: 'input[type="file"][data-codex-score-stamp-upload="1"]',
          prepareExpression: buildScoreStampAttachmentPrepareScript(),
          timeoutMs: 30000,
          port: chromePort,
          webSocketFactory,
        }),
      });
      if (!uploadResult.ok || !uploadResult.uploaded) {
        throw new Error("OA 成绩盖章申请页未找到可上传附件的文件控件，请检查页面附件区域。");
      }
      let saveResult = {};
      try {
        const saveRaw = await withScoreStampChromeRetry({
          tab,
          workflowUrl,
          attempts: 1,
          operation: (currentTab) => evaluateChromeDevToolsExpression({
            tab: currentTab,
            expression: buildScoreStampApplicationSaveScript(),
            timeoutMs: 15000,
            port: chromePort,
            webSocketFactory,
          }),
        });
        saveResult = parseChromeJsonValue(saveRaw);
      } catch (error) {
        if (!isChromeNavigationRetryableError(error)) throw error;
        saveResult = {
          ok: true,
          saved: true,
          navigatedAfterSave: true,
          warnings: ["OA 保存后页面已跳转，按已保存处理"],
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }
      if (!saveResult.ok || !saveResult.saved) {
        const detail = (saveResult.warnings || []).join("；") ||
          (saveResult.url ? `页面地址：${saveResult.url}` : "") ||
          `返回：${JSON.stringify(saveResult).slice(0, 240)}`;
        throw new Error(`OA 成绩盖章申请页保存失败：${detail}`);
      }
      return {
        status: "opened",
        attemptedAt: new Date().toISOString(),
        workflowUrl,
        pageUrl: pageResult.url || "",
        pdfFileName: stampPayload.pdfFileName || "",
        archiveFileName,
        archivePassword: stampPayload.archivePassword || "",
        filled: Array.isArray(pageResult.filled) ? pageResult.filled : [],
        uploadedFileNames: Array.isArray(uploadResult.fileNames) && uploadResult.fileNames.length
          ? uploadResult.fileNames
          : [archiveFileName],
        uploadHiddenValue: uploadResult.hiddenValue || "",
        saved: Boolean(saveResult.saved),
        alreadySaved: Boolean(saveResult.alreadySaved),
        navigatedAfterSave: Boolean(saveResult.navigatedAfterSave),
        saveButtonText: saveResult.buttonText || "",
        warnings: Array.isArray(pageResult.warnings) ? pageResult.warnings : [],
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function corsHeaders(origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Vary": "Origin",
    };
  }

  function sendJson(res, status, payload, origin = "") {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin ? corsHeaders(origin) : {}),
    });
    res.end(JSON.stringify(payload));
  }

  function sendError(res, error, origin) {
    const helperError = error instanceof HelperError
      ? error
      : new HelperError("internal_error", `本机助手处理失败：${error?.message || String(error)}`, 500);
    sendJson(res, helperError.status, {
      ok: false,
      error: { code: helperError.code, message: helperError.message },
    }, origin);
  }

  function fanweiReadError(error) {
    if (error?.code === "fanwei_serial_not_found") {
      return new HelperError(error.code, error.message, 404);
    }
    if (error instanceof SyntaxError) {
      return new HelperError("fanwei_parse_failed", error.message, 502);
    }
    return new HelperError("fanwei_read_failed", error?.message || String(error), 502);
  }

  function helperUpdateError(error) {
    if (error instanceof FanweiHelperUpdateError) {
      return new HelperError(error.code, error.message, error.status);
    }
    return new HelperError(
      "helper_update_failed",
      `助手更新失败：${error?.message || String(error)}`,
      500,
    );
  }

  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || "");
    const url = new URL(req.url || "/", loopbackBaseUrl(host, port));
    const directHealthCheck = !origin && req.method === "GET" && url.pathname === "/health";
    if (!directHealthCheck && !isAllowedHelperOrigin(origin, origins)) {
      sendJson(res, 403, {
        ok: false,
        error: { code: "origin_forbidden", message: "请求来源未获授权。" },
      });
      return;
    }

    if (!KNOWN_PATHS.has(url.pathname)) {
      sendJson(res, 404, {
        ok: false,
        error: { code: "not_found", message: "接口不存在。" },
      }, origin);
      return;
    }

    if (req.method === "OPTIONS") {
      const headers = corsHeaders(origin);
      if (req.headers["access-control-request-private-network"] === "true") {
        headers["Access-Control-Allow-Private-Network"] = "true";
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const tracksOperation = req.method === "POST" && OPERATION_PATHS.has(url.pathname);
    if (tracksOperation && updateInProgress) {
      sendJson(res, 409, {
        ok: false,
        error: { code: "helper_update_in_progress", message: "本机助手正在更新，请稍后重试。" },
      }, origin);
      return;
    }
    if (tracksOperation) activeOperationRequests += 1;

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        const status = supportedPlatform
          ? await chromeStatus()
          : { chromeConnected: false, fanweiTabFound: false };
        sendJson(res, 200, {
          available: supportedPlatform,
          platform,
          helperVersion: FANWEI_LOCAL_HELPER_VERSION,
          capabilities: FANWEI_LOCAL_HELPER_CAPABILITIES,
          ...status,
        }, origin);
        return;
      }

      if (req.method === "POST" && url.pathname === "/update") {
        if (updateInProgress) {
          throw new HelperError("helper_update_in_progress", "本机助手正在更新，请稍后重试。", 409);
        }
        if (activeOperationRequests > 0) {
          throw new HelperError("helper_update_busy", "本机助手仍有任务正在执行，暂不更新。", 409);
        }
        const payload = await readJsonBody(req);
        updateInProgress = true;
        let update;
        try {
          update = await runHelperUpdateImpl(payload, {
            runtimeDir: helperRuntimeDir,
            allowedOrigins: origins,
            platform,
            arch,
            currentVersion: FANWEI_LOCAL_HELPER_VERSION,
            fetchImpl: updateFetchImpl,
          });
        } catch (error) {
          updateInProgress = false;
          throw helperUpdateError(error);
        }
        res.once("finish", () => {
          server.emit("helper-update-applied", update, {
            resumeAfterRestartFailure() {
              updateInProgress = false;
            },
          });
        });
        sendJson(res, 202, { ok: true, update });
        return;
      }

      if (req.method === "POST" && url.pathname === "/chrome/ensure") {
        const status = await ensureChromeOnce();
        sendJson(res, 200, { ok: true, ...status }, origin);
        return;
      }

      if (req.method === "POST" && url.pathname === "/fanwei/read") {
        const payload = await readJsonBody(req);
        const serialNo = String(payload?.serialNo || "").trim();
        if (!serialNo) {
          throw new HelperError("serial_no_required", "请填写泛微流水号。", 400);
        }
        const readFanwei = () => runChromeDevToolsFanweiRead({
          serialNo,
          port: chromePort,
          fetchImpl,
          webSocketFactory,
          distinguishSerialNotFound: true,
        });
        let data;
        try {
          data = await readFanwei();
        } catch (error) {
          if (isRetryableChromeDevToolsError(error)) {
            await ensureChromeOnce();
            try {
              data = await readFanwei();
            } catch (retryError) {
              throw fanweiReadError(retryError);
            }
          } else {
            throw fanweiReadError(error);
          }
        }
        if (!data) {
          throw new HelperError(
            "fanwei_tab_not_found",
            "未找到已打开的泛微需求页面，请在专用 Chrome 窗口中打开后重试。",
            409,
          );
        }
        sendJson(res, 200, { ok: true, data }, origin);
        return;
      }

      if (req.method === "POST" && url.pathname === "/score-stamp/start") {
        const payload = await readJsonBody(req, { maxBytes: SCORE_STAMP_JSON_BODY_LIMIT_BYTES });
        let stampApplication;
        try {
          stampApplication = await runScoreStampApplication(payload);
        } catch (error) {
          throw scoreStampError(error);
        }
        sendJson(res, 200, { ok: true, stampApplication }, origin);
        return;
      }

      if (req.method === "POST" && url.pathname === "/operation-batch/create") {
        const payload = await readJsonBody(req);
        const operationBatch = await runOperationBatchApplication(payload);
        sendJson(res, 200, { ok: true, operationBatch }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-batch/reconcile") {
        const payload = await readJsonBody(req);
        const operationBatch = await runOperationBatchReconciliationApplication(payload);
        sendJson(res, 200, { ok: true, operationBatch }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-batch/inspect") {
        const payload = await readJsonBody(req);
        const operationBatchInspection = await runManagedOperationRequest(
          payload,
          executeOperationBatchInspection,
        );
        sendJson(res, 200, { ok: true, operationBatchInspection }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-batch/update") {
        const payload = await readJsonBody(req);
        const operationBatchUpdate = await runManagedOperationRequest(
          payload,
          executeOperationBatchManagedUpdate,
        );
        sendJson(res, 200, { ok: true, operationBatchUpdate }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-archive/inspect") {
        const payload = await readJsonBody(req);
        const operationArchiveInspection = await runManagedOperationRequest(
          payload,
          (value) => executeOperationArchive(value, "inspect"),
        );
        sendJson(res, 200, { ok: true, operationArchiveInspection }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-archive/submit") {
        const payload = await readJsonBody(req, { maxBytes: 5 * 1024 * 1024 });
        const operationArchiveSubmission = await runManagedOperationRequest(
          payload,
          (value) => executeOperationArchive(value, "submit"),
        );
        sendJson(res, 200, { ok: true, operationArchiveSubmission }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-content/sync") {
        const payload = await readJsonBody(req);
        const operationContentSync = await runManagedOperationRequest(payload, executeOperationContent);
        sendJson(res, 200, { ok: true, operationContentSync }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-personnel/preview") {
        const payload = await readJsonBody(req);
        const operationPersonnelPreview = await runManagedOperationRequest(
          payload,
          executeOperationPersonnelPreview,
        );
        sendJson(res, 200, { ok: true, operationPersonnelPreview }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-personnel/send") {
        const payload = await readJsonBody(req);
        const operationPersonnelAttempt = await runManagedOperationRequest(
          payload,
          executeOperationPersonnelAttempt,
        );
        sendJson(res, 200, { ok: true, operationPersonnelAttempt }, origin);
        return;
      }
      if (req.method === "POST" && url.pathname === "/operation-personnel/recheck") {
        const payload = await readJsonBody(req);
        const operationPersonnelRecheck = await runManagedOperationRequest(
          payload,
          executeOperationPersonnelRecheck,
        );
        sendJson(res, 200, { ok: true, operationPersonnelRecheck }, origin);
        return;
      }

      sendJson(res, 405, {
        ok: false,
        error: { code: "method_not_allowed", message: "请求方法不受支持。" },
      }, origin);
    } catch (error) {
      sendError(res, error, origin);
    } finally {
      if (tracksOperation) activeOperationRequests -= 1;
    }
  });

  server.listen(port, host);
  return server;
}
