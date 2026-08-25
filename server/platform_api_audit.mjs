import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const REDACTED = "[已脱敏]";
const SENSITIVE_KEY = /(?:authorization|api[_-]?key|password|passwd|secret|token|cookie|credential)/i;
const MAX_VALUE_CHARS = 500_000;
const MAX_LOG_BYTES = 50 * 1024 * 1024;
let writeQueue = Promise.resolve();

function sanitizeValue(value, key = "", seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(String(key || ""))) return REDACTED;
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (Buffer.isBuffer(value)) return `[二进制数据 ${value.length} bytes]`;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[循环引用]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, "", seen));
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey, seen),
    ]),
  );
}

function limitValue(value) {
  const sanitized = sanitizeValue(value);
  let serialized = "";
  try {
    serialized = JSON.stringify(sanitized);
  } catch {
    return String(sanitized);
  }
  if (serialized.length <= MAX_VALUE_CHARS) return sanitized;
  return {
    truncated: true,
    originalCharacters: serialized.length,
    preview: serialized.slice(0, MAX_VALUE_CHARS),
  };
}

function parsedRequestBody(body) {
  if (body === null || body === undefined || body === "") return null;
  if (typeof body !== "string") return limitValue(body);
  try {
    return limitValue(JSON.parse(body));
  } catch {
    return limitValue(body);
  }
}

function requestTarget(rawUrl) {
  const url = new URL(String(rawUrl));
  return {
    endpoint: `${url.origin}${url.pathname}`,
    query: Object.fromEntries([...url.searchParams.entries()].map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : value,
    ])),
  };
}

export function buildPlatformApiLogEntry({
  requestTime = new Date().toISOString(),
  completedAt = new Date().toISOString(),
  login = {},
  url,
  options = {},
  action = "请求平台接口",
  responseStatus = null,
  responseData = null,
  error = "",
} = {}) {
  const target = requestTarget(url);
  const method = String(options.method || "GET").toUpperCase();
  return {
    id: randomUUID(),
    requestTime,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(requestTime).getTime()),
    method,
    endpoint: target.endpoint,
    action: String(action || "请求平台接口"),
    requestParams: {
      query: limitValue(target.query),
      body: parsedRequestBody(options.body),
    },
    responseStatus: responseStatus !== null && responseStatus !== undefined && Number.isFinite(Number(responseStatus))
      ? Number(responseStatus)
      : null,
    responseData: limitValue(responseData),
    success: !error && (responseStatus === null || Number(responseStatus) < 400),
    error: error ? String(error) : "",
    operatorAccount: String(
      login.operatorAccount || login.auditActor || login.username || "系统自动任务",
    ).trim() || "系统自动任务",
  };
}

function uniqueAuditTexts(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function buildAssistantQueryLogEntry({
  queryTime = new Date().toISOString(),
  completedAt = new Date().toISOString(),
  question = "",
  result = null,
  error = "",
} = {}) {
  const results = Array.isArray(result?.results) ? result.results : [];
  const sessions = results.flatMap((item) => (
    Array.isArray(item?.sessions) ? item.sessions.filter((session) => session?.available !== false) : []
  ));
  const examNames = uniqueAuditTexts(results.map((item) => item?.examName || item?.projectName));
  const subjectStatCount = sessions.reduce((total, session) => (
    total + (Array.isArray(session?.subjectStats) ? session.subjectStats.length : 0)
  ), 0);
  const success = !error && Boolean(result?.ok);
  let summary = "查询完成";
  if (!success) summary = String(error || result?.error || "查询失败");
  else if (result?.kind === "not_found") summary = "未找到对应考试";
  else if (result?.kind === "choices") summary = `等待选择，匹配 ${Number(result?.choices?.length || 0)} 个考试`;
  else if (result?.kind === "prompt") summary = "等待补充考试名称、编号或日期";
  else {
    const parts = [];
    if (results.length) parts.push(`${results.length} 个考试`);
    if (sessions.length) parts.push(`${sessions.length} 个场次`);
    if (subjectStatCount) parts.push(`${subjectStatCount} 项科目统计`);
    summary = parts.length ? `已返回${parts.join("、")}` : "查询完成";
  }
  return {
    id: randomUUID(),
    queryTime,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(queryTime).getTime()),
    question: String(question || "").trim().slice(0, 500),
    kind: String(result?.kind || (success ? "answer" : "failed")),
    success,
    summary,
    examNames,
    examCount: results.length,
    sessionCount: sessions.length,
    subjectStatCount,
  };
}

async function rotateIfNeeded(logFile, incomingBytes) {
  let size = 0;
  try {
    size = (await fs.stat(logFile)).size;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (size + incomingBytes <= MAX_LOG_BYTES) return;
  const archivedFile = `${logFile}.1`;
  await fs.rm(archivedFile, { force: true });
  await fs.rename(logFile, archivedFile).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

export async function appendPlatformApiLog(logFile, entry) {
  const line = `${JSON.stringify(entry)}\n`;
  const write = async () => {
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    await rotateIfNeeded(logFile, Buffer.byteLength(line));
    await fs.appendFile(logFile, line, { encoding: "utf8", mode: 0o600 });
  };
  writeQueue = writeQueue.then(write, write);
  return await writeQueue;
}

export async function appendAssistantQueryLog(logFile, entry) {
  return await appendPlatformApiLog(logFile, entry);
}

export async function readPlatformApiLogs(logFile, { limit = 200, operatorAccount = "" } = {}) {
  let raw = "";
  try {
    raw = await fs.readFile(logFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const normalizedAccount = String(operatorAccount || "").trim().toLowerCase();
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 200));
  const entries = [];
  const lines = raw.trim().split("\n");
  for (let index = lines.length - 1; index >= 0 && entries.length < safeLimit; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]);
      if (normalizedAccount && String(entry.operatorAccount || "").trim().toLowerCase() !== normalizedAccount) continue;
      entries.push(entry);
    } catch {
      // Ignore a partial final line if the process stopped during an append.
    }
  }
  return entries;
}

export async function readAssistantQueryLogs(logFile, { limit = 50 } = {}) {
  return await readPlatformApiLogs(logFile, { limit });
}
