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

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const KNOWN_PATHS = new Set(["/health", "/chrome/ensure", "/fanwei/read", "/score-stamp/start"]);
const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
const SCORE_STAMP_JSON_BODY_LIMIT_BYTES = 160 * 1024 * 1024;
const SCORE_STAMP_ARCHIVE_LIMIT_BYTES = 100 * 1024 * 1024;

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

export function createFanweiLocalHelperServer({
  allowedOrigins,
  host = "127.0.0.1",
  port = 18765,
  chromePort = 19222,
  runtimeDir,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  webSocketFactory,
  spawnImpl = spawn,
  existsSync = fsExistsSync,
} = {}) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new TypeError("Fanwei local helper host must be loopback-only");
  }
  const origins = normalizeAllowedOrigins(allowedOrigins);
  const helperRuntimeDir = runtimeDir || path.join(os.homedir(), ".yikao-local-helper");
  const supportedPlatform = platform === "darwin" || platform === "win32";
  let ensurePromise = null;

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

  async function launchChrome() {
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
      startUrl: "https://oa.ata.net.cn/",
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

  async function ensureChrome() {
    if (!supportedPlatform) {
      throw new HelperError("unsupported_platform", `当前系统 ${platform} 暂不支持泛微自动读取。`, 501);
    }
    const initial = await chromeStatus();
    if (initial.chromeConnected) {
      return { ...initial, launchedChrome: false };
    }
    await launchChrome();
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

  async function ensureChromeOnce() {
    if (!ensurePromise) {
      ensurePromise = ensureChrome().finally(() => {
        ensurePromise = null;
      });
    }
    return await ensurePromise;
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

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        const status = supportedPlatform
          ? await chromeStatus()
          : { chromeConnected: false, fanweiTabFound: false };
        sendJson(res, 200, {
          available: supportedPlatform,
          platform,
          ...status,
        }, origin);
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

      sendJson(res, 405, {
        ok: false,
        error: { code: "method_not_allowed", message: "请求方法不受支持。" },
      }, origin);
    } catch (error) {
      sendError(res, error, origin);
    }
  });

  server.listen(port, host);
  return server;
}
