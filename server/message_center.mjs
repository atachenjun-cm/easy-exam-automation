import { createHash } from "node:crypto";

const PHONE_ALIASES = ["手机号码", "手机号", "手机", "联系电话", "电话", "mobile", "phone"];
const EMAIL_ALIASES = ["邮箱", "邮箱地址", "电子邮箱", "电子邮件", "邮件", "email", "mail"];

function text(value) {
  return String(value ?? "").trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function customFieldValue(customFields = {}, aliases = []) {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return "";
  const entries = Object.entries(customFields);
  for (const alias of aliases) {
    const normalizedAlias = alias.replace(/\s+/g, "").toLowerCase();
    const match = entries.find(([key]) => text(key).replace(/\s+/g, "").toLowerCase() === normalizedAlias);
    const value = text(match?.[1]);
    if (value) return value;
  }
  return "";
}

export function normalizeMessageCenterPhone(value) {
  let normalized = text(value).replace(/[\s\u3000()-]/g, "").replace(/\.0$/, "");
  normalized = normalized.replace(/^\+86/, "").replace(/^0086/, "");
  if (/^86\d{11}$/.test(normalized)) normalized = normalized.slice(2);
  return normalized;
}

export function normalizeMessageCenterEmail(value) {
  return text(value).toLowerCase();
}

export function messageCenterContactForCandidate(candidate = {}) {
  return {
    name: firstNonEmpty(candidate.full_name, candidate.fullName, candidate.name),
    phone: normalizeMessageCenterPhone(firstNonEmpty(
      candidate.mobile,
      candidate.phone,
      candidate.mobile_phone,
      candidate.telephone,
      customFieldValue(candidate.custom_fields || candidate.customFields, PHONE_ALIASES),
    )),
    email: normalizeMessageCenterEmail(firstNonEmpty(
      candidate.email,
      candidate.email_address,
      customFieldValue(candidate.custom_fields || candidate.customFields, EMAIL_ALIASES),
    )),
  };
}

function validPhone(value) {
  return /^1[3-9]\d{9}$/.test(text(value));
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));
}

export function buildMessageCenterRoster(candidates = [], { sessionId = "" } = {}) {
  const normalizedSessionId = text(sessionId);
  const source = (Array.isArray(candidates) ? candidates : []).filter((candidate) => (
    !normalizedSessionId || text(candidate?.session_id) === normalizedSessionId
  ));
  const rows = source.map(messageCenterContactForCandidate);
  const sendableRows = rows.filter((row) => row.name && (validPhone(row.phone) || validEmail(row.email)));
  const duplicatePhones = new Set();
  const duplicateEmails = new Set();
  const phoneCounts = new Map();
  const emailCounts = new Map();
  for (const row of sendableRows) {
    if (validPhone(row.phone)) phoneCounts.set(row.phone, (phoneCounts.get(row.phone) || 0) + 1);
    if (validEmail(row.email)) emailCounts.set(row.email, (emailCounts.get(row.email) || 0) + 1);
  }
  for (const [phone, count] of phoneCounts) if (count > 1) duplicatePhones.add(phone);
  for (const [email, count] of emailCounts) if (count > 1) duplicateEmails.add(email);
  return {
    rows: sendableRows,
    summary: {
      total: source.length,
      prepared: sendableRows.length,
      availableSms: sendableRows.filter((row) => validPhone(row.phone)).length,
      availableEmail: sendableRows.filter((row) => validEmail(row.email)).length,
      missingPhone: rows.filter((row) => !validPhone(row.phone)).length,
      missingEmail: rows.filter((row) => !validEmail(row.email)).length,
      skipped: rows.length - sendableRows.length,
      duplicatePhoneCount: duplicatePhones.size,
      duplicateEmailCount: duplicateEmails.size,
    },
  };
}

export function messageCenterOperationBatch(task = {}) {
  const batch = task.config?.operationBatch || {};
  return {
    code: firstNonEmpty(task.config?.operationBatchCode, batch.code),
    name: firstNonEmpty(batch.batchName, batch.name),
  };
}

export function messageCenterPreparationFingerprint(value = {}) {
  return createHash("sha256").update(JSON.stringify({
    operationBatchCode: text(value.operationBatchCode),
    operationBatchName: text(value.operationBatchName),
    externalBatchName: text(value.externalBatchName),
    requirementIndex: Number(value.requirementIndex || 0),
    messageKind: text(value.messageKind),
    smsContent: text(value.smsContent),
    emailTemplates: Array.isArray(value.emailTemplates) ? value.emailTemplates.map((template) => ({
      kind: text(template?.kind),
      subject: text(template?.subject),
      content: text(template?.content),
    })) : [],
    taskUpdatedAt: text(value.taskUpdatedAt),
    roster: Array.isArray(value.roster) ? value.roster : [],
  })).digest("hex");
}

export function messageCenterTemplatesForPreparation(value = {}) {
  const code = text(value.operationBatchCode);
  const name = text(value.operationBatchName);
  const prefix = text(value.externalBatchName) || `${code}_${name}`;
  return (Array.isArray(value.emailTemplates) ? value.emailTemplates : []).map((template, index) => {
    const kind = text(template?.kind).toLowerCase();
    const suffix = kind === "psychological"
      ? "心理测评通知"
      : kind === "standard"
        ? "考试通知"
        : `邮件通知${index + 1}`;
    return {
      channel: "email",
      name: `${prefix}-${suffix}`.slice(0, 200),
      subject: text(template?.subject),
      content: text(template?.content),
      backcontent: [],
      is_enabled: true,
    };
  });
}

export async function ensureMessageCenterTemplate(client, template) {
  const listed = await client.listTemplates({ channel: template.channel, keyword: template.name });
  const existing = (Array.isArray(listed?.results) ? listed.results : []).find((item) => (
    text(item?.channel) === text(template.channel) && text(item?.name) === text(template.name)
  ));
  if (existing) {
    const contentChanged = Object.hasOwn(existing, "content") && text(existing.content) !== text(template.content);
    const subjectChanged = template.channel === "email"
      && Object.hasOwn(existing, "subject")
      && text(existing.subject) !== text(template.subject);
    if (contentChanged || subjectChanged) {
      throw new Error(`信息触达平台已存在同名${template.channel === "email" ? "邮件" : "短信"}模板，但内容不同`);
    }
    return { ...existing, reused: true };
  }
  return { ...(await client.createTemplate(template)), reused: false };
}

export function messageCenterConfigFromEnv(env = process.env, settings = {}) {
  const baseUrl = firstNonEmpty(settings.apiBase, env.MESSAGE_CENTER_API_BASE).replace(/\/+$/, "");
  const token = firstNonEmpty(
    settings.credential,
    settings.apiKey,
    settings.jwt,
    env.MESSAGE_CENTER_CREDENTIAL,
    env.MESSAGE_CENTER_API_KEY,
    env.MESSAGE_CENTER_JWT,
  );
  const requestedAuthScheme = firstNonEmpty(
    settings.authScheme,
    env.MESSAGE_CENTER_AUTH_SCHEME,
    (settings.apiKey || env.MESSAGE_CENTER_API_KEY) ? "ApiKey" : "",
    "Bearer",
  ).toLowerCase();
  const authScheme = requestedAuthScheme === "apikey" ? "ApiKey" : requestedAuthScheme === "bearer" ? "Bearer" : "";
  if (!baseUrl) throw new Error("未配置短信平台接口地址，请在“系统配置 → 短信平台连接”中填写并验证。");
  if (!authScheme) throw new Error("短信平台认证方式仅支持 ApiKey 或 Bearer JWT");
  if (!token) throw new Error("未配置短信平台访问凭证，请在“系统配置 → 短信平台连接”中填写并验证。");
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("信息触达平台地址格式不正确");
  }
  const localHttp = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  const allowInsecureHttp = settings.allowInsecureHttp === true
    || text(env.MESSAGE_CENTER_ALLOW_INSECURE_HTTP) === "1";
  if (parsed.protocol !== "https:" && !localHttp && !allowInsecureHttp) {
    throw new Error("短信平台未启用 HTTPS；如确认仅用于可信测试网络，请在系统配置中允许 HTTP 测试连接。");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("信息触达平台仅支持 HTTP 或 HTTPS");
  const webBaseUrl = firstNonEmpty(
    settings.webBaseUrl,
    env.MESSAGE_CENTER_WEB_BASE,
    `${parsed.origin}/#/MessageCampaigns`,
  );
  const batchUrlTemplate = firstNonEmpty(settings.batchUrlTemplate, env.MESSAGE_CENTER_BATCH_URL_TEMPLATE);
  for (const [label, value] of [
    ["平台页面地址", webBaseUrl],
    ["批次定位地址模板", batchUrlTemplate.replaceAll("{batchId}", "1").replaceAll("{batch_id}", "1")],
  ]) {
    if (!value) continue;
    let target;
    try {
      target = new URL(value);
    } catch {
      throw new Error(`${label}格式不正确`);
    }
    if (!new Set(["http:", "https:"]).has(target.protocol)) throw new Error(`${label}仅支持 HTTP 或 HTTPS`);
  }
  if (batchUrlTemplate && !/\{batch_?[Ii]d\}/.test(batchUrlTemplate)) {
    throw new Error("批次定位地址模板必须包含 {batchId} 或 {batch_id}");
  }
  return {
    baseUrl,
    token,
    authScheme,
    webBaseUrl,
    batchUrlTemplate,
    allowInsecureHttp,
  };
}

export function messageCenterBatchUrl(config = {}, batchId) {
  const id = encodeURIComponent(text(batchId));
  const template = text(config.batchUrlTemplate);
  if (template) return template.replaceAll("{batchId}", id).replaceAll("{batch_id}", id);
  const base = text(config.webBaseUrl);
  if (!base || !id) return base;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}batch_id=${id}`;
}

function messageCenterErrorMessage(status, payload, action) {
  const detail = text(payload?.msg || payload?.detail || payload?.error);
  if (status === 401) return "信息触达平台访问凭证无效或已过期";
  if (status === 403) return `信息触达平台账号无权限${action}`;
  if (status === 409) return `信息触达平台数据已变化，请重新预览后再${action}`;
  return detail || `信息触达平台${action}失败：HTTP ${status}`;
}

function unwrapMessageCenterPayload(payload, status, action) {
  if (payload && typeof payload === "object" && Object.hasOwn(payload, "code")) {
    if (Number(payload.code) !== 3000) throw new Error(messageCenterErrorMessage(status, payload, action));
    return payload.data;
  }
  return payload;
}

export function createMessageCenterClient({ baseUrl, token, authScheme = "Bearer", fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const root = text(baseUrl).replace(/\/+$/, "");
  async function request(pathname, options = {}, action = "请求") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${root}${pathname}`, {
        ...options,
        headers: {
          Authorization: `${authScheme} ${token}`,
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`信息触达平台${action}超时，未自动重试`);
      throw new Error(`无法连接信息触达平台：${error?.message || error}`);
    } finally {
      clearTimeout(timer);
    }
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { detail: raw };
    }
    if (!response.ok) {
      const error = new Error(messageCenterErrorMessage(response.status, payload, action));
      error.status = response.status;
      error.detail = payload;
      throw error;
    }
    return unwrapMessageCenterPayload(payload, response.status, action);
  }

  return {
    capabilities: () => request("/api/messagecenter/capabilities/", {}, "检查渠道"),
    listImports: () => request("/api/messagecenter/imports/?page=1&page_size=1", {}, "检查名单批次权限"),
    listTemplates: ({ channel, keyword, pageSize = 100 } = {}) => {
      const query = new URLSearchParams({ page: "1", page_size: String(pageSize) });
      if (text(channel)) query.set("channel", text(channel));
      if (text(keyword)) query.set("keyword", text(keyword));
      return request(`/api/messagecenter/templates/?${query}`, {}, "查询模板");
    },
    createTemplate: (template) => request("/api/messagecenter/templates/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    }, `创建${text(template?.channel) === "email" ? "邮件" : "短信"}模板`),
    async createImport({ name, fileBuffer, fileName = "message-center-roster.xlsx" }) {
      const form = new FormData();
      form.append("name", text(name));
      form.append(
        "file",
        new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        fileName,
      );
      return await request("/api/messagecenter/imports/", { method: "POST", body: form }, "创建名单批次");
    },
    importDetail: (id) => request(`/api/messagecenter/imports/${encodeURIComponent(id)}/`, {}, "读取名单批次"),
  };
}

export async function waitForMessageCenterImport(client, batch, {
  attempts = 30,
  intervalMs = 1000,
  wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  let current = batch;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = text(current?.status);
    if (status === "completed") return current;
    if (status === "failed") throw new Error(text(current?.error_message) || "信息触达名单导入失败");
    if (attempt < attempts - 1) await wait(intervalMs);
    current = await client.importDetail(current?.id);
  }
  const error = new Error("信息触达名单仍在导入，请稍后继续，不要重复创建批次");
  error.code = "MESSAGE_CENTER_IMPORT_PENDING";
  error.batch = current;
  throw error;
}
