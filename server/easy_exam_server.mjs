import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bindCoursesToFormalSession,
  createSessionsThenConfigureCourses,
} from "./course_session_binding.mjs";
import { isFrontendRoute, webContentType } from "./frontend_routes.mjs";
import { handleRequirementRequest } from "./requirement_request_api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const webFile = path.join(rootDir, "outputs", "web_prototype", "easy_exam_automation.html");
const webModulesDir = path.join(rootDir, "web");
const runtimeDir = path.join(rootDir, ".easy_exam_runtime");
const uploadsDir = path.join(runtimeDir, "uploads");
const generatedDir = path.join(runtimeDir, "generated");
const settingsPath = path.join(runtimeDir, "settings.json");
const parserScript = path.join(__dirname, "exam_request_parser.py");
const candidateParserScript = path.join(__dirname, "candidate_list_parser.py");
const monitorAccountExporterScript = path.join(__dirname, "monitor_account_exporter.py");
const taskStateScript = path.join(__dirname, "task_state_db.py");
const taskDbPath = path.join(runtimeDir, "task_state.sqlite3");
const pythonBin =
  process.env.CODEX_PYTHON ||
  process.env.PYTHON ||
  "python3";

async function loadEnvFile() {
  const envPath = path.join(rootDir, ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {}
}

const state = {
  imports: new Map(),
  candidateImports: new Map(),
  jobs: new Map(),
  settings: {
    login: {
      url: "",
      username: "",
      password: "",
      tenantApiKey: "",
    },
  },
};

function json(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function ensureRuntime() {
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    state.settings = {
      ...state.settings,
      ...parsed,
      login: {
        ...state.settings.login,
        ...(parsed.login || {}),
      },
    };
  } catch {}
}

function parseJsonSafe(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

function decodeName(raw = "") {
  return decodeURIComponent(raw).replace(/[^\w.\-\u4e00-\u9fff]/g, "_");
}

function safeFileName(raw = "file") {
  return decodeName(raw).slice(0, 160) || "file";
}

function safeExcelFileName(raw = "monitor_accounts") {
  const base = safeFileName(raw).replace(/\.(xlsx|xls|csv)$/i, "").trim() || "monitor_accounts";
  return `${base}.xlsx`;
}

function normalizeApiBase(base) {
  return String(base || "https://eztest.cn").replace(/\/+$/, "");
}

function tenantHeaders(extra = {}) {
  const apiKey = state.settings.login?.tenantApiKey || process.env.YIKAO_API_KEY;
  if (!apiKey) {
    throw new Error("未配置租户 API Key，请在后台连接中填写并保存。");
  }
  return {
    Authorization: `Key ${apiKey}`,
    ...extra,
  };
}

function tenantHeadersForLogin(login = {}, extra = {}) {
  const apiKey = login.tenantApiKey || state.settings.login?.tenantApiKey || process.env.YIKAO_API_KEY;
  if (!apiKey) {
    throw new Error("未配置租户 API Key，请在后台连接中填写并保存。");
  }
  return {
    Authorization: `Key ${apiKey}`,
    ...extra,
  };
}

function tenantErrorMessage(status, action) {
  return status === 401
    ? `租户 API 返回 401，请检查租户 API Key。`
    : status === 403
      ? `租户 API 返回 403，当前 Key 无权限${action}。`
      : status === 429
        ? "租户 API 返回 429，请稍后重试。"
        : `租户 API ${action}失败：${status}`;
}

async function readTenantJson(tenantUrl, options = {}, action = "请求") {
  const response = await fetch(tenantUrl, {
    ...options,
    headers: tenantHeaders(options.headers || {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(tenantErrorMessage(response.status, action));
    error.status = response.status;
    error.detail = payload;
    throw error;
  }
  return payload;
}

async function readTenantJsonWithLogin(login, tenantUrl, options = {}, action = "请求") {
  const { includeResponseMeta = false, ...fetchOptions } = options;
  const response = await fetch(tenantUrl, {
    ...fetchOptions,
    headers: tenantHeadersForLogin(login, fetchOptions.headers || {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(tenantErrorMessage(response.status, action));
    error.status = response.status;
    error.detail = payload;
    throw error;
  }
  return includeResponseMeta
    ? { __tenantResponse: true, httpStatus: response.status, body: payload }
    : payload;
}

function normalizeSessionDate(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
  if (!match) return text;
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "是", "需要", "开启", "开启录制"].includes(text);
}

function positiveNumber(value, fallback = undefined) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(String(value).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildPersonalInformation() {
  return {
    full_name: {
      editable: false,
      required: false,
      visible: true,
      default: true,
      type: "text",
      order: 0,
      label: "姓名",
    },
    email: {
      editable: false,
      required: false,
      visible: false,
      type: "email",
      order: 1,
      label: "邮箱",
    },
    phone: {
      editable: false,
      required: false,
      visible: false,
      type: "text",
      order: 2,
      label: "手机号码",
    },
    gender: {
      editable: false,
      required: false,
      visible: false,
      type: "radio",
      choices: ["男", "女"],
      order: 3,
      label: "性别",
    },
    identity_id: {
      editable: false,
      required: false,
      visible: true,
      default: true,
      type: "text",
      order: 4,
      label: "身份证号",
    },
    id_number: {
      editable: false,
      required: false,
      visible: false,
      type: "text",
      order: 5,
      label: "证件号",
    },
  };
}

function applyTimeRule(payload, rule, fallbackRule = "") {
  const normalized = String(rule || fallbackRule || "").replace(/\s+/g, "");
  delete payload.later_deduction;
  delete payload.auto_add_time;

  if (!normalized) return;
  if (normalized.includes("不扣时")) {
    payload.later_deduction = false;
    return;
  }
  if (normalized.includes("迟到及离开")) {
    payload.auto_add_time = false;
    return;
  }
  if (normalized.includes("迟到")) {
    payload.later_deduction = true;
  }
}

function compactApiDetail(detail) {
  if (detail === undefined || detail === null) return "";
  return typeof detail === "string" ? detail.slice(0, 1000) : JSON.stringify(detail).slice(0, 1000);
}

function extractSessionId(result) {
  return (
    result?.id ||
    result?.session_id ||
    result?.data?.id ||
    result?.data?.session_id ||
    result?.session?.id ||
    ""
  );
}

function normalizeCourseFormCodes(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCourseRecords(config = {}) {
  const rawCourses = Array.isArray(config.courses) ? config.courses : [];
  return rawCourses
    .map((course, index) => {
      const name = String(course?.name || course?.course_name || course?.title || "").trim();
      const code = String(course?.code || course?.course_code || "").trim();
      const formCodes = normalizeCourseFormCodes(course?.form_codes || course?.formCodes || code);
      return {
        name,
        code,
        form_codes: formCodes.length ? formCodes : code ? [code] : [],
        order: index + 1,
      };
    })
    .filter((course) => course.name && course.code);
}

function isExistingCourseResponse(payload) {
  if (!payload) return false;
  if (Array.isArray(payload)) return payload.length > 0;
  if (Array.isArray(payload.results)) return payload.results.length > 0;
  if (Array.isArray(payload.data)) return payload.data.length > 0;
  return Boolean(payload.id || payload.code || payload.course_code || payload.name);
}

async function ensureFormalCoursesCreated({ login, apiBase, config, emitLog }) {
  const courses = normalizeCourseRecords(config);
  if (!courses.length) {
    emitLog("[API 科目] 需求单未读取到可创建的科目信息，跳过科目创建。", "warning");
    return [];
  }

  emitLog(`[API 科目] 准备创建/确认 ${courses.length} 个科目`);
  for (const course of courses) {
    const encodedCode = encodeURIComponent(course.code);
    const coursePayload = {
      name: course.name,
      code: course.code,
      form_codes: course.form_codes,
    };

    let exists = false;
    try {
      const existing = await readTenantJsonWithLogin(
        login,
        `${apiBase}/tenant/api/courses/${encodedCode}/?apply=session`,
        { method: "GET" },
        `查询科目 ${course.code}`,
      );
      exists = isExistingCourseResponse(existing);
      emitLog(`[API 科目] 查询科目：${course.code}，exists=${exists}`);
    } catch (error) {
      if (error?.status === 404) {
        exists = false;
        emitLog(`[API 科目] 科目不存在，准备创建：${course.code}`);
      } else {
        emitLog(
          `[API 科目] 查询科目失败：${course.code}，状态码=${error?.status || "未知"}，响应=${compactApiDetail(error?.detail)}`,
          "warning",
        );
        throw error;
      }
    }

    if (!exists) {
      try {
        await readTenantJsonWithLogin(
          login,
          `${apiBase}/tenant/api/course/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(coursePayload),
          },
          `创建科目 ${course.code}`,
        );
        emitLog(`[API 科目] 创建成功：${course.name} / ${course.code}`);
      } catch (error) {
        emitLog(
          `[API 科目] 创建失败：${course.name} / ${course.code}，状态码=${error?.status || "未知"}，响应=${compactApiDetail(error?.detail)}`,
          "warning",
        );
        throw error;
      }
    } else {
      emitLog(`[API 科目] 科目已存在，跳过创建：${course.name} / ${course.code}`);
    }

  }
  return courses;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function saveApiCreationCapture(job, created) {
  const shotsDir = path.join(runtimeDir, "shots", job.id);
  await fs.mkdir(shotsDir, { recursive: true });
  const fileName = "api-create-confirm.svg";
  const rows = created
    .map((item, index) => {
      const y = 250 + index * 94;
      const kind = item.kind === "mock" ? "试考" : "正式考试";
      return `
        <rect x="92" y="${y}" width="1360" height="64" rx="18" fill="#f8fafc" stroke="#dbe4f0"/>
        <text x="124" y="${y + 40}" font-size="28" font-weight="700" fill="#0f172a">${escapeXml(kind)}</text>
        <text x="310" y="${y + 40}" font-size="26" fill="#1e293b">${escapeXml(item.name)}</text>
        <text x="930" y="${y + 40}" font-size="24" fill="#64748b">session_id: ${escapeXml(item.id || "-")}</text>
        <text x="124" y="${y + 88}" font-size="22" fill="#64748b">${escapeXml(item.start || "")} ~ ${escapeXml(item.end || "")}</text>
      `;
    })
    .join("");
  const height = Math.max(520, 340 + created.length * 94);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1544" height="${height}" viewBox="0 0 1544 ${height}">
  <rect width="1544" height="${height}" fill="#f5f7fb"/>
  <rect x="56" y="56" width="1432" height="${height - 112}" rx="28" fill="#ffffff" stroke="#d9e2ef"/>
  <text x="92" y="126" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="34" font-weight="800" fill="#0f172a">易考创建完成确认</text>
  <text x="92" y="174" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="22" fill="#64748b">租户 API 已返回创建成功结果，以下为本次创建的考试场次。</text>
  <rect x="92" y="202" width="230" height="42" rx="21" fill="#ecfdf5"/>
  <circle cx="120" cy="223" r="11" fill="#22c55e"/>
  <text x="144" y="231" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="20" font-weight="700" fill="#15803d">创建完成</text>
  <g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">${rows}</g>
</svg>`;
  await fs.writeFile(path.join(shotsDir, fileName), svg, "utf8");
  return {
    title: "创建完成",
    url: `/artifacts/${encodeURIComponent(job.id)}/${encodeURIComponent(fileName)}`,
  };
}

function buildSessionPayloads(config) {
  const videoMonitor = boolValue(config.videoMonitor);
  const clientExam = boolValue(config.clientExam) || String(config.examType || "").includes("客户端");
  const pledgeContent = String(config.pledgeContent || "").trim();
  const usePostPoliceVerify = videoMonitor && String(config.loginVerifyMode || "考后公安验证").includes("考后公安");
  const common = {
    allow_anonymous: false,
    face_detection: false,
    face_detection_dur: true,
    face_detection_review: false,
    police_detection: false,
    police_detection_after: usePostPoliceVerify,
    app_required: false,
    publish_permit: false,
    ip_white_list: false,
    public_score: false,
    show_score_detail: false,
    publish_score: false,
    send_result_email: false,
    manual_score: false,
    new_mark: false,
    practice_mode: false,
    monitor: videoMonitor,
    audio_monitor: videoMonitor,
    eagle_eye: boolValue(config.hawkeye),
    watermark: true,
    copy_item_unable: true,
    message: String(config.welcomeText || ""),
    notice: String(config.preLoginPrompt || ""),
    nda: Boolean(pledgeContent),
    nda_notice: pledgeContent,
    personal: buildPersonalInformation(),
  };

  const main = {
    ...common,
    name: String(config.examName || "").trim(),
    start: normalizeSessionDate(config.startTimeDisplay),
    end: normalizeSessionDate(config.endTimeDisplay),
    save_video: videoMonitor && boolValue(config.videoRecord),
  };
  applyTimeRule(main, config.timeRule);
  const early = positiveNumber(config.earlyLoginMinutes);
  const later = positiveNumber(config.lateLimitMinutes);
  if (early !== undefined && early > 0) main.early = early;
  if (later !== undefined && later > 0) main.later = later;
  if (clientExam) {
    Object.assign(main, {
      client_required: true,
      lock_screen: true,
      exclusive_network: true,
      check_bluetooth: true,
      login_times: 10,
    });
  } else {
    Object.assign(main, {
      client_required: false,
      lock_screen_time: positiveNumber(config.leaveLimit, 5),
    });
  }

  const payloads = [{ kind: "main", payload: main }];
  if (config.mockExamEnabled && config.mockStartTimeDisplay && config.mockEndTimeDisplay) {
    const trial = {
      ...common,
      name: String(config.mockExamName || `${config.examName}-试考`).trim(),
      start: normalizeSessionDate(config.mockStartTimeDisplay),
      end: normalizeSessionDate(config.mockEndTimeDisplay),
      save_video: false,
    };
    applyTimeRule(trial, "不扣时");
    delete trial.early;
    delete trial.later;
    if (clientExam) {
      Object.assign(trial, {
        client_required: true,
        lock_screen: true,
        exclusive_network: true,
        check_bluetooth: true,
        login_times: 20,
      });
    } else {
      Object.assign(trial, {
        client_required: false,
        lock_screen_time: 99,
      });
    }
    payloads.push({ kind: "mock", payload: trial });
  }
  return payloads;
}

async function runYikaoApiCreationJob({ job, login }) {
  const ts = () => new Date().toISOString();
  const emitLog = (message, level = "success") => {
    pushEvent(job, { type: "log", level, message, ts: ts() });
  };
  const emitStage = (stage, percent) => {
    pushEvent(job, { type: "stage", stage, percent, ts: ts() });
  };

  let activeStep = "formal_session_create";
  try {
    pushEvent(job, { type: "status", status: "running", message: "租户 API 创建考试中", ts: ts() });
    emitStage("读取需求单", 10);
    const payloads = buildSessionPayloads(job.config);
    const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
    emitLog("[API 创建] 使用租户 API：POST /tenant/api/session/");
    emitLog(`[API 创建] 待创建场次：${payloads.map((item) => item.payload.name).join("、")}`);

    const created = await createSessionsThenConfigureCourses({
      sessionPayloads: payloads,
      createSession: async (item, index) => {
        activeStep = item.kind === "main" ? "formal_session_create" : "trial_session_create";
        await updateTaskStep(job.taskId, activeStep, "running", {
          message: `开始创建${item.kind === "main" ? "正式考试" : "试考"}：${item.payload.name}`,
        });
        emitStage(item.kind === "main" ? "创建主考试" : "创建试考", 20 + index * 35);
        emitLog(`[API 创建] 开始创建${item.kind === "main" ? "主考试" : "试考"}：${item.payload.name}`);
        emitLog(
          `[API 创建] 扣时字段：timeRule=${item.kind === "main" ? job.config.timeRule || "未填写" : "不扣时"}，auto_add_time=${JSON.stringify(item.payload.auto_add_time)}，later_deduction=${JSON.stringify(item.payload.later_deduction)}`,
        );
        const result = await readTenantJsonWithLogin(
          login,
          `${apiBase}/tenant/api/session/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item.payload),
          },
          "创建考试场次",
        );
        const sessionId = extractSessionId(result);
        const createdSession = {
          kind: item.kind,
          name: item.payload.name,
          start: item.payload.start,
          end: item.payload.end,
          id: sessionId,
          url: result?.url,
          result,
        };
        await runTaskState("upsert_session", {
          taskId: job.taskId,
          sessionType: item.kind === "main" ? "formal" : "trial",
          session: {
            session_id: sessionId,
            name: item.payload.name,
            start: item.payload.start,
            end: item.payload.end,
            status: "success",
            url: result?.url || "",
          },
        });
        await updateTaskStep(job.taskId, activeStep, "success", {
          message: `创建成功：${item.payload.name}${sessionId ? `，session_id=${sessionId}` : ""}`,
          result: { sessionId, name: item.payload.name, kind: item.kind },
        });
        emitLog(`[API 创建] 创建成功：${item.payload.name}${sessionId ? `，session_id=${sessionId}` : ""}`);
        return createdSession;
      },
      configureCourses: async (formalSession) => {
        activeStep = "course_create";
        await updateTaskStep(job.taskId, "course_create", "running", { message: "开始创建并确认正式考试科目" });
        emitStage("正式考试科目", 85);
        const courses = await ensureFormalCoursesCreated({
          login,
          apiBase,
          config: job.config,
          emitLog,
        });
        await updateTaskStep(job.taskId, "course_create", "success", { message: "科目创建/确认完成" });

        activeStep = "paper_bind";
        await updateTaskStep(job.taskId, "paper_bind", "running", {
          message: "开始回查科目详情并绑定试卷到正式场次",
        });
        const bindResult = await bindCoursesToFormalSession({
          login,
          apiBase,
          sessionId: formalSession.id,
          courses,
          requestJson: readTenantJsonWithLogin,
          emitLog,
        });
        if (bindResult.status === "waiting_manual") {
          await updateTaskStep(job.taskId, "paper_bind", "waiting_manual", {
            message: `科目已创建，待试卷绑定：${bindResult.missingCourseCodes.join("、")}`,
            result: { missingCourseCodes: bindResult.missingCourseCodes },
          });
        } else {
          await updateTaskStep(job.taskId, "paper_bind", "success", {
            message: `已将 ${courses.length} 个科目的试卷绑定到正式考试场次`,
          });
        }
      },
    });

    const creationCapture = await saveApiCreationCapture(job, created);
    pushEvent(job, { type: "captures", captures: [creationCapture], ts: ts() });
    emitLog("[API 创建] 已生成创建完成确认截图，可在网页最后确认截图区域查看");
    emitStage("完成", 100);
    pushEvent(job, {
      type: "done",
      ts: ts(),
      summary: {
        created,
        captures: [creationCapture],
      },
    });
  } catch (error) {
    await updateTaskStep(job.taskId, activeStep, "failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      message: `步骤执行失败：${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    const detail = error?.detail ? `；接口返回：${JSON.stringify(error.detail).slice(0, 1000)}` : "";
    pushEvent(job, {
      type: "error",
      ts: ts(),
      message: `${error instanceof Error ? error.message : String(error)}${detail}`,
    });
  }
}

async function runPythonJson(args) {
  const child = spawn(pythonBin, args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "脚本执行失败");
  }
  return JSON.parse(stdout);
}

async function runTaskState(action, payload = {}) {
  const child = spawn(pythonBin, [taskStateScript, taskDbPath, action], {
    cwd: rootDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  child.stdin.end(JSON.stringify(payload));
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || `任务状态操作失败：${action}`);
  return JSON.parse(stdout || "null");
}

async function updateTaskStep(taskId, stepKey, status, result = {}) {
  if (!taskId) return null;
  return await runTaskState("update_step", { taskId, stepKey, status, result });
}

async function parseWorkbook(uploadPath) {
  return await runPythonJson([parserScript, uploadPath]);
}

function createJob(importRecord, login) {
  const job = {
    id: randomUUID(),
    importId: importRecord.id,
    taskId: importRecord.taskId,
    config: importRecord.parsed.config,
    login,
    status: "queued",
    progress: 0,
    stage: "等待开始",
    logs: [],
    captures: [],
    events: [],
    listeners: new Set(),
    createdAt: new Date().toISOString(),
  };
  state.jobs.set(job.id, job);
  return job;
}

function pushEvent(job, evt) {
  job.events.push(evt);
  if (evt.type === "log") {
    job.logs.unshift({
      level: evt.level || "",
      message: evt.message,
      ts: evt.ts,
    });
  }
  if (evt.type === "stage") {
    job.stage = evt.stage;
    job.progress = evt.percent;
  }
  if (evt.type === "status") {
    job.status = evt.status;
    job.statusMessage = evt.message;
  }
  if (evt.type === "captures") {
    job.captures = [...job.captures, ...(evt.captures || [])];
  }
  if (evt.type === "done") {
    job.status = "done";
  }
  if (evt.type === "error") {
    job.status = "error";
    job.statusMessage = evt.message;
    job.logs.unshift({
      level: "warn",
      message: evt.message,
      ts: evt.ts,
    });
  }

  for (const send of job.listeners) {
    send(evt);
  }
}

async function handleImport(req, res) {
  const filename = decodeName(new URL(req.url, "http://localhost").searchParams.get("filename") || "需求单.xlsx");
  const body = await readBody(req);
  if (!body.length) {
    return badRequest(res, "未收到文件内容");
  }

  const importId = randomUUID();
  const uploadPath = path.join(uploadsDir, `${importId}-${filename}`);
  await fs.writeFile(uploadPath, body);
  const parsed = await parseWorkbook(uploadPath);
  const projectName = String(parsed?.config?.examName || filename.replace(/\.[^.]+$/, "") || "未命名项目").trim();
  const task = await runTaskState("create", {
    projectName,
    sourceAccount: state.settings.login?.username || "",
    config: parsed?.config || {},
  });
  await updateTaskStep(task.taskId, "requirement_parse", "success", {
    message: `需求单解析完成：${filename}`,
    result: { filename, uploadId: importId },
  });
  const record = { id: importId, taskId: task.taskId, filename, uploadPath, parsed, createdAt: new Date().toISOString() };
  state.imports.set(importId, record);
  json(res, 200, { uploadId: importId, taskId: task.taskId, ...parsed, filename });
}

async function handleCandidateParse(req, res) {
  const url = new URL(req.url, "http://localhost");
  const filename = safeFileName(url.searchParams.get("filename") || "candidates.xlsx");
  const ext = path.extname(filename).toLowerCase();
  if (![".xlsx", ".xls", ".csv"].includes(ext)) {
    return badRequest(res, "文件格式不支持，仅支持 .xlsx、.xls、.csv");
  }

  const body = await readBody(req);
  if (!body.length) {
    return badRequest(res, "未上传文件");
  }

  const importId = randomUUID();
  const uploadPath = path.join(uploadsDir, `${importId}-${filename}`);
  await fs.writeFile(uploadPath, body);
  const parsed = await runPythonJson([candidateParserScript, "parse", uploadPath]);
  state.candidateImports.set(importId, {
    id: importId,
    filename,
    uploadPath,
    parsed,
    createdAt: new Date().toISOString(),
  });
  json(res, 200, { uploadId: importId, filename, ...parsed });
}

function validateCandidatePayload(candidates = []) {
  const errors = [];
  if (!Array.isArray(candidates) || !candidates.length) {
    return ["缺少考生数据"];
  }
  const permitRows = new Map();
  const identityRows = new Map();
  candidates.forEach((candidate, index) => {
    const row = index + 2;
    const permit = String(candidate?.permit || "").trim();
    const fullName = String(candidate?.full_name || "").trim();
    const identityId = String(candidate?.identity_id || "").trim();
    if (!permit) errors.push(`第 ${row} 行缺少 permit`);
    if (!fullName) errors.push(`第 ${row} 行缺少 full_name`);
    if (!identityId) errors.push(`第 ${row} 行缺少 identity_id`);
    if (permit) permitRows.set(permit, [...(permitRows.get(permit) || []), row]);
    if (identityId) identityRows.set(identityId, [...(identityRows.get(identityId) || []), row]);
    if (/^\s*\d+(?:\.\d+)?[eE]\+?\d+\s*$/.test(identityId)) {
      errors.push(`第 ${row} 行 identity_id 为科学计数法格式，请修正原始文件后再导入`);
    }
    if (/^\s*\d+(?:\.\d+)?[eE]\+?\d+\s*$/.test(permit)) {
      errors.push(`第 ${row} 行 permit 为科学计数法格式，请修正原始文件后再导入`);
    }
  });
  for (const [permit, rows] of permitRows.entries()) {
    if (rows.length > 1) errors.push(`准考证号重复：${permit}，行号：${rows.join("、")}`);
  }
  for (const [identityId, rows] of identityRows.entries()) {
    if (rows.length > 1) errors.push(`证件号重复：${identityId}，行号：${rows.join("、")}`);
  }
  return errors;
}

async function handleCandidateTemplate(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const candidates = payload?.candidates || [];
  const errors = validateCandidatePayload(candidates);
  if (errors.length) {
    return json(res, 400, { error: "考生数据校验失败", errors });
  }

  const templateId = randomUUID();
  const payloadPath = path.join(generatedDir, `${templateId}.json`);
  const outputPath = path.join(generatedDir, `${templateId}-candidates.xlsx`);
  await fs.writeFile(payloadPath, JSON.stringify({ candidates }, null, 2), "utf8");
  const result = await runPythonJson([candidateParserScript, "template", payloadPath, outputPath]);
  if (!result.ok) {
    return json(res, 400, { error: "考生模板生成失败", errors: result.errors || [] });
  }
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="yikao_candidates_template.xlsx"',
  });
  createReadStream(outputPath).pipe(res);
}

async function handleMonitorAccountsExcel(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const session = payload?.session || {};
  const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
  if (!String(session.session_id || "").trim()) {
    return badRequest(res, "缺少 session_id");
  }
  if (!rooms.length) {
    return badRequest(res, "缺少监考账号数据");
  }

  const exportId = randomUUID();
  const fileName = safeExcelFileName(`${session.session_id}-${session.name || "监考账号"}`);
  const payloadPath = path.join(generatedDir, `${exportId}-monitor-accounts.json`);
  const outputPath = path.join(generatedDir, `${exportId}-monitor-accounts.xlsx`);
  await fs.writeFile(
    payloadPath,
    JSON.stringify(
      {
        session,
        rooms: rooms.map((room) => ({
          name: String(room.name || ""),
          num: room.num ?? "",
          account: String(room.account || ""),
          pwd: String(room.pwd || ""),
          monitor_url: String(room.monitor_url || room.monitorUrl || room.url || session.url || ""),
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
  const result = await runPythonJson([monitorAccountExporterScript, payloadPath, outputPath]);
  if (!result.ok) {
    return json(res, 400, { error: "监考账号 Excel 生成失败", errors: result.errors || [] });
  }
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
  createReadStream(outputPath).pipe(res);
}

function normalizeTenantList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  return [];
}

function parseDateValue(value) {
  if (!value) return 0;
  const normalized = String(value).replace(/\//g, "-").replace(" ", "T");
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : 0;
}

function calculateRoomSizes(totalEntries, targetSize = 30) {
  if (!Number.isInteger(totalEntries) || totalEntries <= 0) {
    return [];
  }

  if (totalEntries <= targetSize + 2) {
    return [totalEntries];
  }

  const fullRooms = Math.floor(totalEntries / targetSize);
  const remainder = totalEntries % targetSize;

  if (remainder === 0) {
    return Array(fullRooms).fill(targetSize);
  }

  const sizes = Array(fullRooms).fill(targetSize);
  sizes[sizes.length - 1] += remainder;

  return sizes;
}

function randomRoomPassword() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let value = "";
  for (let index = 0; index < 6; index += 1) {
    value += alphabet[randomInt(0, alphabet.length)];
  }
  return value;
}

function buildRooms(sizes) {
  return sizes.map((num, index) => ({
    num,
    name: `第${index + 1}班`,
    account: `room${String(index + 1).padStart(3, "0")}`,
    pwd: randomRoomPassword(),
  }));
}

function validateRooms(rooms, entriesNum) {
  const normalizedRooms = rooms.map((room) => ({
    num: Number(room?.num),
    name: String(room?.name || ""),
    account: String(room?.account || ""),
    pwd: String(room?.pwd || ""),
  }));
  const invalid = normalizedRooms.filter(
    (room) =>
      !Number.isInteger(room.num) ||
      room.num <= 0 ||
      !room.name ||
      !room.account ||
      !room.pwd,
  );
  const total = normalizedRooms.reduce((sum, room) => sum + (Number.isInteger(room.num) ? room.num : 0), 0);
  return {
    ok: invalid.length === 0 && total === entriesNum,
    rooms: normalizedRooms,
    invalid,
    total,
  };
}

function getEntriesNum(payload) {
  const value = payload?.entries_num ?? payload?.data?.entries_num;
  const num = Number(value);
  return Number.isInteger(num) ? num : 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeImportErrors(errors = []) {
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => {
    if (error && typeof error === "object") {
      return {
        ...error,
        entry: String(error.entry ?? error.permit ?? error.identity_id ?? ""),
        error: error.error ?? error.code ?? "",
      };
    }
    return { entry: String(error), error: "" };
  });
}

function summarizeStatuses(items = []) {
  return items.reduce((acc, item) => {
    const status = String(item.status ?? "unknown");
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function isSoftDeletedPermitConflict(cleanup) {
  const failed = cleanup?.failed || [];
  if (!cleanup || !cleanup.requested || cleanup.succeeded > 0 || !failed.length) return false;
  return failed.every((item) => {
    const detail = typeof item.detail === "string" ? item.detail : JSON.stringify(item.detail || "");
    return Number(item.status) === 403 && /not existed/i.test(detail);
  });
}

function diagnoseCandidateImport({ errors = [], fail = 0, entriesNum = 0, requestedCount = 0, importState = null, attempts = [] }) {
  const codes = [...new Set(errors.map((error) => String(error.error || "")).filter(Boolean))];
  const all4002 = errors.length > 0 && errors.every((error) => String(error.error || "") === "4002");
  const alreadyExistsLikely = Number(fail) > 0 && all4002;
  const canContinueRoomAssign = Number(fail) > 0 && entriesNum >= requestedCount && requestedCount > 0;
  const messages = [];
  if (importState) {
    messages.push(
      `已刷新易考最新状态：当前场次 ${importState.entriesNum} 人，班级 ${importState.roomsCount} 个。`,
    );
  }
  if (attempts.length > 1) {
    messages.push(`检测到重复账号错误后已重试 ${attempts.length - 1} 次。`);
  }
  const cleanupCount = attempts.reduce((sum, attempt) => sum + Number(attempt.duplicate_cleanup?.succeeded || 0), 0);
  if (cleanupCount > 0) {
    messages.push(`已按当前场次执行重复准考证号清理 ${cleanupCount} 条。`);
  }
  if (attempts.some((attempt) => attempt.blocked_by_soft_deleted_permit_conflict)) {
    messages.push(
      "当前场次最新状态为 0 人，但租户 API 仍返回 4002，且当前场次删除接口提示记录不存在；准考证号仍被易考占用。系统不会自动修改准考证号，请先在易考后台/API 释放该准考证号后再重试。",
    );
  }
  if (alreadyExistsLikely) {
    messages.push("租户 API 返回 4002：考生账号重复。");
  }
  if (Number(fail) > 0) {
    messages.push(`导入请求 ${requestedCount} 人，失败 ${fail} 人，当前场次接口统计 ${entriesNum} 人。`);
  }
  if (canContinueRoomAssign) {
    messages.push("当前场次考生数已满足本次名单人数，系统将按当前场次考生继续自动分班。");
  } else if (Number(fail) > 0) {
    messages.push("当前场次考生数不足，本次不会自动分班。请确认易考后台删除状态已经释放后重试。");
  }
  return {
    codes,
    all4002,
    alreadyExistsLikely,
    canContinueRoomAssign,
    blockedBySoftDeletedPermitConflict: attempts.some((attempt) => attempt.blocked_by_soft_deleted_permit_conflict),
    messages,
  };
}

function normalizeRooms(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rooms)) return payload.rooms;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function getEntryCount(sessionId) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/entry_count/`, base);
  return await readTenantJson(tenantUrl, {}, "查询场次考生统计");
}

async function getEntryList(sessionId) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/entry/`, base);
  const payload = await readTenantJson(tenantUrl, {}, "查询场次考生列表");
  if (Array.isArray(payload?.entries)) return payload.entries;
  return normalizeTenantList(payload);
}

async function getRoomList(sessionId) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/rooms/`, base);
  const payload = await readTenantJson(tenantUrl, {}, "查询场次班级列表");
  return normalizeRooms(payload);
}

async function getSessionImportState(sessionId) {
  const [entryCount, entries, rooms] = await Promise.all([
    getEntryCount(sessionId),
    getEntryList(sessionId).catch(() => []),
    getRoomList(sessionId).catch(() => []),
  ]);
  return {
    entryCount,
    entries,
    rooms,
    entriesNum: getEntriesNum(entryCount),
    entriesListCount: Array.isArray(entries) ? entries.length : 0,
    roomsCount: Array.isArray(rooms) ? rooms.length : 0,
  };
}

async function postCandidatesToTenant(sessionId, candidates) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/entry/`, base);
  const response = await fetch(tenantUrl, {
    method: "POST",
    headers: tenantHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(
      candidates.map((candidate) => ({
        permit: String(candidate.permit),
        full_name: String(candidate.full_name),
        identity_id: String(candidate.identity_id),
      })),
    ),
  });
  const text = await response.text();
  let payloadResponse = null;
  try {
    payloadResponse = text ? JSON.parse(text) : null;
  } catch {
    payloadResponse = text;
  }
  return { response, payloadResponse };
}

async function deleteCandidatePermit(sessionId, permit) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(
    `/tenant/api/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(permit)}/`,
    base,
  );
  const response = await fetch(tenantUrl, {
    method: "DELETE",
    headers: tenantHeaders(),
  });
  const text = await response.text();
  let detail = null;
  try {
    detail = text ? JSON.parse(text) : null;
  } catch {
    detail = text;
  }
  return {
    permit,
    ok: response.ok,
    status: response.status,
    detail,
  };
}

async function cleanupDuplicateCandidatePermits(sessionId, errors) {
  const permits = [
    ...new Set(
      normalizeImportErrors(errors)
        .filter((error) => String(error.error || "") === "4002")
        .map((error) => String(error.entry || "").trim())
        .filter(Boolean),
    ),
  ];
  const results = [];
  const concurrency = 12;
  for (let index = 0; index < permits.length; index += concurrency) {
    const batch = permits.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map((permit) => deleteCandidatePermit(sessionId, permit)));
    results.push(...batchResults);
  }
  const failedItems = results.filter((item) => !(item.ok || item.status === 404));
  return {
    requested: permits.length,
    succeeded: results.filter((item) => item.ok || item.status === 404).length,
    failed_count: failedItems.length,
    failed_statuses: summarizeStatuses(failedItems),
    failed: failedItems
      .slice(0, 20)
      .map((item) => ({ permit: item.permit, status: item.status, detail: item.detail })),
  };
}

async function pollProgressbar(progressbarId, timeoutMs = 90000) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const startedAt = Date.now();
  let lastPayload = null;
  while (Date.now() - startedAt < timeoutMs) {
    const tenantUrl = new URL(`/tenant/api/progressbar/${encodeURIComponent(progressbarId)}/`, base);
    lastPayload = await readTenantJson(tenantUrl, {}, "查询分班进度");
    const status = String(lastPayload?.status || "");
    const percent = Number(lastPayload?.percent || 0);
    if (status === "finished" || percent >= 100) {
      return lastPayload;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const error = new Error("progressbar 查询超时");
  error.detail = lastPayload;
  throw error;
}

async function handleSessions(req, res) {
  const url = new URL(req.url, "http://localhost");
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL("/tenant/api/session/", base);
  const sessionIds = url.searchParams.get("session_ids");
  if (sessionIds) tenantUrl.searchParams.set("session_ids", sessionIds);

  const activeKey = state.settings.login?.tenantApiKey || process.env.YIKAO_API_KEY || "";
  const keyHint = activeKey ? `末尾 ${activeKey.slice(-4)}` : "未配置";
  const response = await fetch(tenantUrl, {
    headers: tenantHeaders(),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message =
      response.status === 401
        ? "租户 API 返回 401，请检查租户 API Key。"
        : response.status === 403
          ? "租户 API 返回 403，当前 Key 无权限获取场次。"
          : response.status === 429
            ? "租户 API 返回 429，请稍后重试。"
            : `租户 API 获取场次失败：${response.status}`;
    return json(res, response.status, {
      error: message,
      detail: payload,
      diagnostics: {
        apiBase: base,
        url: tenantUrl.toString(),
        status: response.status,
        keyHint,
        rawType: Array.isArray(payload) ? "array" : typeof payload,
      },
    });
  }

  const now = Date.now();
  const normalized = normalizeTenantList(payload)
    .map((item) => ({
      session_id: String(item.id ?? item.session_id ?? ""),
      name: String(item.name ?? ""),
      start: item.start ?? "",
      end: item.end ?? "",
      url: item.url ?? "",
    }));
  const validSessions = normalized.filter((item) => item.session_id && item.name);
  const droppedInvalid = normalized.length - validSessions.length;
  const futureSessions = validSessions.filter((item) => {
      const endTime = parseDateValue(item.end);
      return endTime ? endTime >= now : true;
    });
  const expiredSessions = validSessions.filter((item) => {
    const endTime = parseDateValue(item.end);
    return Boolean(endTime && endTime < now);
  });
  const sessions = futureSessions
    .sort((a, b) => {
      const aStart = parseDateValue(a.start);
      const bStart = parseDateValue(b.start);
      if (aStart && bStart && aStart !== bStart) return aStart - bStart;
      return Number(b.session_id) - Number(a.session_id);
    });
  json(res, 200, {
    sessions,
    diagnostics: {
      apiBase: base,
      url: tenantUrl.toString(),
      status: response.status,
      keyHint,
      rawType: Array.isArray(payload) ? "array" : typeof payload,
      rawCount: normalized.length,
      validCount: validSessions.length,
      unexpiredCount: sessions.length,
      expiredCount: expiredSessions.length,
      droppedInvalid,
      serverNow: new Date(now).toISOString(),
      expiredSamples: expiredSessions.slice(0, 5),
      invalidSamples: normalized.filter((item) => !item.session_id || !item.name).slice(0, 5),
    },
  });
}

async function handleCandidateImport(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const sessionId = String(payload?.session_id || "").trim();
  const candidates = payload?.candidates || [];
  if (!sessionId) {
    return badRequest(res, "未选择场次");
  }
  const errors = validateCandidatePayload(candidates);
  if (errors.length) {
    return json(res, 400, { error: "考生数据校验失败", errors });
  }

  let beforeState = null;
  try {
    beforeState = await getSessionImportState(sessionId);
  } catch (error) {
    beforeState = { error: error.message || String(error), detail: error.detail || null };
  }

  let payloadResponse = null;
  let importErrors = [];
  let finalResponseStatus = 200;
  const attempts = [];
  const maxAttempts = 4;
  const retryDelays = [1500, 3000, 5000];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { response, payloadResponse: currentPayload } = await postCandidatesToTenant(sessionId, candidates);
    payloadResponse = currentPayload;
    finalResponseStatus = response.status;

    if (!response.ok) {
      const message =
        response.status === 401
          ? "租户 API 返回 401，请检查租户 API Key。"
          : response.status === 403
            ? "租户 API 返回 403，当前 Key 无权限导入考生。"
            : response.status === 429
              ? "租户 API 返回 429，请稍后重试。"
              : `租户 API 导入考生失败：${response.status}`;
      return json(res, response.status, { error: message, detail: payloadResponse, before_state: beforeState });
    }

    const currentFail = Number(payloadResponse?.fail ?? 0);
    importErrors = normalizeImportErrors(payloadResponse?.errors || []);
    let currentState = null;
    try {
      currentState = await getSessionImportState(sessionId);
    } catch (error) {
      currentState = { error: error.message || String(error), detail: error.detail || null, entriesNum: 0 };
    }
    attempts.push({
      attempt,
      succeed: Number(payloadResponse?.succeed ?? 0),
      fail: currentFail,
      entries_num: Number(currentState?.entriesNum || 0),
      rooms_count: Number(currentState?.roomsCount || 0),
      error_codes: [...new Set(importErrors.map((error) => String(error.error || "")).filter(Boolean))],
    });

    const currentSucceed = Number(payloadResponse?.succeed ?? 0);
    const all4002 = importErrors.length > 0 && importErrors.every((error) => String(error.error || "") === "4002");
    const enoughEntries = Number(currentState?.entriesNum || 0) >= candidates.length;
    if (!currentFail || enoughEntries || !all4002 || currentSucceed > 0 || attempt >= maxAttempts) {
      break;
    }

    const cleanup = await cleanupDuplicateCandidatePermits(sessionId, importErrors);
    attempts[attempts.length - 1].duplicate_cleanup = cleanup;
    if (Number(currentState?.entriesNum || 0) === 0 && isSoftDeletedPermitConflict(cleanup)) {
      attempts[attempts.length - 1].blocked_by_soft_deleted_permit_conflict = true;
      break;
    }
    await wait(retryDelays[attempt - 1] || 5000);
  }

  const succeed = Number(payloadResponse?.succeed ?? 0);
  const fail = Number(payloadResponse?.fail ?? 0);
  let importState = null;
  try {
    importState = await getSessionImportState(sessionId);
  } catch (error) {
    importState = { error: error.message || String(error), detail: error.detail || null, entriesNum: 0 };
  }
  const entryCount = importState?.entryCount || null;
  const entriesNum = Number(importState?.entriesNum || 0);
  const diagnosis = diagnoseCandidateImport({
    errors: importErrors,
    fail,
    entriesNum,
    requestedCount: candidates.length,
    importState,
    attempts,
  });

  json(res, 200, {
    succeed,
    fail,
    permits: payloadResponse?.permits || [],
    errors: importErrors,
    requestedCount: candidates.length,
    before_state: beforeState,
    import_state: importState,
    attempts,
    entry_count: entryCount,
    entries_num: entriesNum,
    diagnosis,
  });
}

async function handleRoomsPreview(sessionId, req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const targetSize = Number(payload?.targetSize || 30);
  if (!sessionId) {
    return badRequest(res, "session_id 为空");
  }
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    return badRequest(res, "每个班级人数必须是正整数");
  }

  const latestState = await getSessionImportState(sessionId);
  const entryCount = latestState.entryCount;
  const entriesNum = latestState.entriesNum;
  if (!entriesNum) {
    return badRequest(res, "entries_num = 0，当前场次没有可分班考生");
  }

  const rooms = buildRooms(calculateRoomSizes(entriesNum, targetSize));
  json(res, 200, {
    session_id: sessionId,
    entries_num: entriesNum,
    targetSize,
    rooms,
    entry_count: entryCount,
    entries_list_count: latestState.entriesListCount,
    rooms_count: latestState.roomsCount,
  });
}

async function handleRoomsAuto(sessionId, req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const requestedRooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
  const overwrite = Boolean(payload?.overwrite);
  const targetSize = Number(payload?.targetSize || 30);
  if (!sessionId) {
    return badRequest(res, "session_id 为空");
  }
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    return badRequest(res, "每个班级人数必须是正整数");
  }

  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const roomsUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/rooms/`, base);
  const latestState = await getSessionImportState(sessionId);
  const entriesNum = Number(latestState.entriesNum || 0);
  if (!entriesNum) {
    return badRequest(res, "entries_num = 0，当前场次没有可分班考生");
  }
  const existingRooms = normalizeRooms(latestState.rooms).filter((room) => room?.id || room?.name);
  if (existingRooms.length && !overwrite) {
    return json(res, 409, {
      needConfirmOverwrite: true,
      message: "当前场次已存在班级，是否删除后重新分班？",
      existingCount: existingRooms.length,
      latest_state: {
        entries_num: entriesNum,
        entries_list_count: latestState.entriesListCount,
        rooms_count: latestState.roomsCount,
      },
    });
  }

  if (existingRooms.length && overwrite) {
    await readTenantJson(
      roomsUrl,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_ids: [] }),
      },
      "删除已有分班",
    );
  }

  let rooms = requestedRooms;
  const requestedTotal = requestedRooms.reduce((sum, room) => sum + Number(room?.num || 0), 0);
  if (!requestedRooms.length || requestedTotal !== entriesNum) {
    rooms = buildRooms(calculateRoomSizes(entriesNum, targetSize));
  }
  const roomValidation = validateRooms(rooms, entriesNum);
  if (!roomValidation.ok) {
    return json(res, 400, {
      error: "自动分班生成了无效班级，请检查每个班级人数设置。",
      entries_num: entriesNum,
      rooms_total: roomValidation.total,
      invalid_rooms: roomValidation.invalid,
      rooms,
    });
  }
  rooms = roomValidation.rooms;

  const result = await readTenantJson(
    roomsUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rooms,
      }),
    },
    "自动分班",
  );
  const progressbarId = result?.id;
  if (!progressbarId) {
    return json(res, 500, { error: "自动分班接口未返回 progressbar id", detail: result });
  }
  const progressbar = await pollProgressbar(progressbarId);
  json(res, 200, {
    session_id: sessionId,
    progressbar_id: progressbarId,
    rooms,
    progressbar,
    latest_state: {
      entries_num: entriesNum,
      entries_list_count: latestState.entriesListCount,
      rooms_count_before: latestState.roomsCount,
    },
  });
}

async function handleCreateJob(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  if (!payload?.uploadId) {
    return badRequest(res, "缺少 uploadId");
  }
  const importRecord = state.imports.get(payload.uploadId);
  if (!importRecord) {
    return badRequest(res, "需求单记录不存在，请重新导入。");
  }
  const config = importRecord.parsed?.config || {};
  if (!config.examName || !config.startTimeDisplay || !config.endTimeDisplay) {
    return badRequest(res, "需求单缺少考试名称或考试时间，请重新导入并检查表格。");
  }

  const login = {
    ...state.settings.login,
    ...(payload.login || {}),
  };
  if (!login.url || !login.username || !login.password) {
    return badRequest(res, "请先填写并保存后台登录配置。");
  }

  const job = createJob(importRecord, login);
  pushEvent(job, { type: "status", status: "queued", message: "任务已创建", ts: new Date().toISOString() });

  const hasTenantApiKey = Boolean(login.tenantApiKey || state.settings.login?.tenantApiKey || process.env.YIKAO_API_KEY);
  if (!hasTenantApiKey) {
    pushEvent(job, {
      type: "error",
      ts: new Date().toISOString(),
      message: "缺少租户 API Key，已停用浏览器自动化路径，请先填写租户 API Key。",
    });
    return json(res, 400, {
      error: "缺少租户 API Key",
      message: "已停用浏览器自动化路径，请先填写租户 API Key 后再开始配置。",
    });
  }

  runYikaoApiCreationJob({ job, login });

  json(res, 200, { jobId: job.id, taskId: job.taskId });
}

async function handleGetSettings(_req, res) {
  json(res, 200, state.settings);
}

async function handleSaveSettings(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const nextSettings = {
    ...state.settings,
    login: {
      ...state.settings.login,
      ...(payload?.login || {}),
    },
  };
  state.settings = nextSettings;
  await fs.writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), "utf8");
  json(res, 200, { ok: true, settings: state.settings });
}

function handleJobState(job, res) {
  json(res, 200, {
    id: job.id,
    taskId: job.taskId,
    status: job.status,
    statusMessage: job.statusMessage || "",
    progress: job.progress,
    stage: job.stage,
    logs: job.logs,
    captures: job.captures,
  });
}

async function handleTaskList(_req, res) {
  json(res, 200, { tasks: await runTaskState("list") });
}

async function handleExamList(_req, res) {
  json(res, 200, { sessions: await runTaskState("list_sessions") });
}

async function handleTaskDetail(taskId, res) {
  const task = await runTaskState("get", { taskId });
  return task ? json(res, 200, task) : notFound(res);
}

async function handleTaskStepRetry(taskId, stepKey, res) {
  if (stepKey === "paper_bind") {
    const task = await runTaskState("get", { taskId });
    if (!task) return notFound(res);

    const formalSession = (task.sessions || []).find((session) => session.sessionType === "formal");
    const courses = normalizeCourseRecords(task.config || {});
    const login = state.settings.login || {};
    const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
    const retryLogs = [];
    const emitLog = (message) => retryLogs.push(message);

    await updateTaskStep(taskId, stepKey, "running", {
      incrementRetry: true,
      message: "开始单独重试科目绑定，不重新创建场次或科目",
    });
    try {
      const bindResult = await bindCoursesToFormalSession({
        login,
        apiBase,
        sessionId: formalSession?.session_id,
        courses,
        requestJson: readTenantJsonWithLogin,
        emitLog,
      });
      if (bindResult.status === "waiting_manual") {
        const updated = await updateTaskStep(taskId, stepKey, "waiting_manual", {
          message: [...retryLogs, `科目已创建，待试卷绑定：${bindResult.missingCourseCodes.join("、")}`].join("\n"),
          result: { sessionId: formalSession?.session_id, missingCourseCodes: bindResult.missingCourseCodes },
        });
        return json(res, 200, updated);
      }
      const updated = await updateTaskStep(taskId, stepKey, "success", {
        message: retryLogs.join("\n") || "科目绑定重试成功",
        result: { sessionId: formalSession?.session_id, courseCount: courses.length },
      });
      return json(res, 200, updated);
    } catch (error) {
      await updateTaskStep(taskId, stepKey, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        message: [...retryLogs, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n"),
      });
      throw error;
    }
  }

  const task = await updateTaskStep(taskId, stepKey, "pending", {
    incrementRetry: true,
    message: "已提交单步骤重试，等待对应业务执行器处理",
  });
  json(res, 200, task);
}

function handleEvents(job, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write("\n");

  const send = (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };

  job.events.forEach(send);
  job.listeners.add(send);

  req.on("close", () => {
    job.listeners.delete(send);
  });
}

async function handleArtifact(urlPath, res) {
  const [, , jobId, fileName] = urlPath.split("/");
  const filePath = path.join(runtimeDir, "shots", jobId, fileName);
  try {
    await fs.access(filePath);
  } catch {
    return notFound(res);
  }
  const ext = path.extname(fileName).toLowerCase();
  const contentType =
    ext === ".svg" ? "image/svg+xml; charset=utf-8" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
}

async function buildHtml() {
  const html = await fs.readFile(webFile, "utf8");
  return html.replace(
    "</body>",
    `\n<script>window.EASY_EXAM_RUNTIME={apiBase:"",appVersion:"1.0.0"};</script>\n</body>`,
  );
}

async function handleWebModule(urlPath, res) {
  const relativePath = decodeURIComponent(urlPath.slice("/web/".length));
  const filePath = path.resolve(webModulesDir, relativePath);
  if (!filePath.startsWith(`${webModulesDir}${path.sep}`)) return notFound(res);
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": webContentType(filePath),
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    return notFound(res);
  }
}

async function requestHandler(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname.startsWith("/web/")) {
      return await handleWebModule(url.pathname, res);
    }
    if (req.method === "GET" && (isFrontendRoute(url.pathname) || url.pathname === "/easy_exam_automation.html")) {
      return sendHtml(res, await buildHtml());
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      return await handleGetSettings(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      return await handleSaveSettings(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      return await handleImport(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/jobs") {
      return await handleCreateJob(req, res);
    }
    if (await handleRequirementRequest(req, res, url)) {
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/tasks") {
      return await handleTaskList(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/exams") {
      return await handleExamList(req, res);
    }
    const taskRetryMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/steps\/([^/]+)\/retry$/);
    if (req.method === "POST" && taskRetryMatch) {
      return await handleTaskStepRetry(decodeURIComponent(taskRetryMatch[1]), decodeURIComponent(taskRetryMatch[2]), res);
    }
    const taskDetailMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === "GET" && taskDetailMatch) {
      return await handleTaskDetail(decodeURIComponent(taskDetailMatch[1]), res);
    }
    if (req.method === "POST" && url.pathname === "/api/candidates/parse") {
      return await handleCandidateParse(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/candidates/generate-template") {
      return await handleCandidateTemplate(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      return await handleSessions(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/candidates/import") {
      return await handleCandidateImport(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/rooms/monitor-accounts/excel") {
      return await handleMonitorAccountsExcel(req, res);
    }
    const roomsPreviewMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rooms\/preview$/);
    if (req.method === "POST" && roomsPreviewMatch) {
      return await handleRoomsPreview(decodeURIComponent(roomsPreviewMatch[1]), req, res);
    }
    const roomsAutoMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rooms\/auto$/);
    if (req.method === "POST" && roomsAutoMatch) {
      return await handleRoomsAuto(decodeURIComponent(roomsAutoMatch[1]), req, res);
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/events")) {
      const jobId = url.pathname.split("/")[3];
      const job = state.jobs.get(jobId);
      return job ? handleEvents(job, req, res) : notFound(res);
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const jobId = url.pathname.split("/")[3];
      const job = state.jobs.get(jobId);
      return job ? handleJobState(job, res) : notFound(res);
    }
    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      return await handleArtifact(url.pathname, res);
    }
    notFound(res);
  } catch (error) {
    json(res, error.status || 500, {
      error: error instanceof Error ? error.message : String(error),
      detail: error.detail,
    });
  }
}

await loadEnvFile();
await ensureRuntime();

const port = Number(process.env.PORT || 8765);
const server = http.createServer(requestHandler);
server.listen(port, "127.0.0.1", () => {
  console.log(`Easy Exam server running at http://127.0.0.1:${port}`);
});
