import {
  normalizeEmailSettings,
  parseEmailRecipients,
} from "./content_requirement_email.mjs";
import { sendSmtpMail } from "./smtp_mailer.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function taskRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement && typeof task.config.examRequirement === "object"
    ? [task.config.examRequirement]
    : [];
}

function taskRequirement(task = {}, requirementIndex = 0) {
  return taskRequirements(task)[Number(requirementIndex || 0)] || {};
}

function taskFormalSession(task = {}, requirementIndex = 0) {
  const normalizedIndex = Number(requirementIndex || 0);
  return (Array.isArray(task.sessions) ? task.sessions : []).find((session) => (
    text(session?.sessionType || session?.session_type) === "formal"
    && Number(session?.requirementIndex || session?.requirement_index || 0) === normalizedIndex
  ));
}

function parseDate(value) {
  if (!value) return null;
  const normalized = text(value).replace(/\//g, "-").replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function paperBindReminderExamStart(task = {}, requirementIndex = 0) {
  const requirement = taskRequirement(task, requirementIndex);
  const config = requirement.config || (Number(requirementIndex || 0) === 0 ? task.config : {}) || {};
  const session = taskFormalSession(task, requirementIndex);
  const values = [
    config.startTimeIso,
    config.startTimeDisplay,
    config.startTime,
    session?.start,
  ];
  return values.map(parseDate).find(Boolean) || null;
}

export function paperBindReminderSchedule(examStart) {
  const start = examStart instanceof Date ? new Date(examStart) : parseDate(examStart);
  if (!start || !Number.isFinite(start.getTime())) return null;
  const beforeNoon = start.getHours() < 12;
  const scheduled = new Date(start);
  if (beforeNoon) scheduled.setDate(scheduled.getDate() - 1);
  scheduled.setHours(beforeNoon ? 17 : 9, 0, 0, 0);
  return {
    category: beforeNoon ? "before_noon" : "noon_or_after",
    categoryLabel: beforeNoon ? "12:00 前考试" : "12:00 及以后考试",
    reminderLabel: beforeNoon ? "考试前一天 17:00" : "考试当天 09:00",
    scheduled,
  };
}

export function paperBindReminderState(task = {}, requirementIndex = 0) {
  const normalizedIndex = Number(requirementIndex || 0);
  return task.config?.paperBindReminders?.[normalizedIndex]
    || (normalizedIndex === 0 ? task.config?.paperBindReminder : null)
    || {};
}

function paperFormBindState(task = {}, requirementIndex = 0) {
  const normalizedIndex = Number(requirementIndex || 0);
  return task.config?.paperFormBinds?.[normalizedIndex]
    || (normalizedIndex === 0 ? task.config?.paperFormBind : null)
    || {};
}

function paperBindingSucceeded(task = {}, requirementIndex = 0, sessionId = "") {
  const state = paperFormBindState(task, requirementIndex);
  if (state.status !== "success") return false;
  const resultSessionId = text(
    state.result?.sessionId
    || state.result?.bindResult?.results?.[0]?.session_id,
  );
  return !resultSessionId || resultSessionId === text(sessionId);
}

function reminderKey({ sessionId, examStart, scheduledFor }) {
  return [text(sessionId), text(examStart), text(scheduledFor)].join("|");
}

export function paperBindReminderDecision(task = {}, requirementIndex = 0, now = new Date()) {
  const normalizedNow = now instanceof Date ? new Date(now) : parseDate(now);
  if (!normalizedNow || !Number.isFinite(normalizedNow.getTime())) return { due: false, reason: "invalid_now" };
  const session = taskFormalSession(task, requirementIndex);
  if (!text(session?.session_id)) return { due: false, reason: "missing_formal_session" };
  const examStartDate = paperBindReminderExamStart(task, requirementIndex);
  if (!examStartDate) return { due: false, reason: "missing_exam_start" };
  if (paperBindingSucceeded(task, requirementIndex, session.session_id)) {
    return { due: false, reason: "paper_bound" };
  }
  const schedule = paperBindReminderSchedule(examStartDate);
  if (!schedule) return { due: false, reason: "missing_schedule" };
  if (normalizedNow.getTime() < schedule.scheduled.getTime()) return { due: false, reason: "before_schedule" };
  if (normalizedNow.getTime() >= examStartDate.getTime()) return { due: false, reason: "exam_started" };
  const examStart = examStartDate.toISOString();
  const scheduledFor = schedule.scheduled.toISOString();
  const key = reminderKey({ sessionId: session.session_id, examStart, scheduledFor });
  const state = paperBindReminderState(task, requirementIndex);
  if (state.status === "sent" && state.reminderKey === key) {
    return { due: false, reason: "already_sent" };
  }
  return {
    due: true,
    reason: state.status === "failed" && state.reminderKey === key ? "retry" : "scheduled",
    requirementIndex: Number(requirementIndex || 0),
    sessionId: text(session.session_id),
    examStart,
    scheduledFor,
    reminderKey: key,
    category: schedule.category,
    categoryLabel: schedule.categoryLabel,
    reminderLabel: schedule.reminderLabel,
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return text(value) || "--";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function reminderExamName(task = {}, requirementIndex = 0) {
  const requirement = taskRequirement(task, requirementIndex);
  const session = taskFormalSession(task, requirementIndex);
  return text(
    requirement.fields?.["考试名称"]
    || requirement.config?.examName
    || session?.name
    || task.examName
    || task.projectName
    || `考试 ${Number(requirementIndex || 0) + 1}`,
  );
}

function reminderCourses(task = {}, requirementIndex = 0) {
  const requirement = taskRequirement(task, requirementIndex);
  const courseStep = (Array.isArray(task.steps) ? task.steps : []).find((step) => step?.stepKey === "course_create");
  const progressCourses = courseStep?.requirementProgress?.[String(Number(requirementIndex || 0))]?.result?.courses;
  const candidates = [
    progressCourses,
    requirement.config?.courses,
    Number(requirementIndex || 0) === 0 ? task.config?.courses : null,
    requirement.config?.subjects,
    Number(requirementIndex || 0) === 0 ? task.config?.subjects : null,
  ];
  const selected = candidates.find((items) => Array.isArray(items) && items.length) || [];
  return selected.map((course, index) => {
    if (typeof course !== "object" || course === null) {
      return { name: text(course) || `科目 ${index + 1}`, code: "" };
    }
    return {
      name: text(course.name || course.courseName || course.course_name || course.subjectName || course.subject) || `科目 ${index + 1}`,
      code: text(course.code || course.courseCode || course.course_code),
    };
  });
}

function paperPairs(names = [], codes = []) {
  const paperNames = Array.isArray(names) ? names.map(text).filter(Boolean) : [];
  const formCodes = Array.isArray(codes) ? codes.map(text).filter(Boolean) : [];
  const length = Math.max(paperNames.length, formCodes.length);
  return Array.from({ length }, (_, index) => ({
    name: paperNames[index] || "候选试卷",
    code: formCodes[index] || "",
  }));
}

export function paperBindReminderDetails(task = {}, requirementIndex = 0) {
  const state = paperFormBindState(task, requirementIndex);
  const bindResult = state.result?.bindResult || {};
  const duplicateMatches = Array.isArray(state.result?.duplicatePaperMatches)
    ? state.result.duplicatePaperMatches
    : Array.isArray(bindResult.duplicatePaperMatches) ? bindResult.duplicatePaperMatches : [];
  const missingCourseCodes = new Set([
    ...(Array.isArray(state.result?.missingCourseCodes) ? state.result.missingCourseCodes : []),
    ...(Array.isArray(bindResult.missingCourseCodes) ? bindResult.missingCourseCodes : []),
  ].map(text).filter(Boolean));
  const matchedResults = Array.isArray(bindResult.results) ? bindResult.results : [];
  const errorMessage = text(state.errorMessage) || "系统未找到可自动绑定的匹配试卷";
  const courses = reminderCourses(task, requirementIndex);
  const rows = (courses.length ? courses : [{ name: "未保存科目信息", code: "" }]).map((course) => {
    const duplicate = duplicateMatches.find((item) => (
      text(item?.course_code) === course.code
      || (!course.code && text(item?.course_name) === course.name)
    ));
    if (duplicate) {
      const papers = (Array.isArray(duplicate.candidates) ? duplicate.candidates : []).map((paper) => ({
        name: text(paper?.name) || "候选试卷",
        code: text(paper?.code),
      }));
      return {
        courseName: course.name,
        courseCode: course.code,
        papers,
        reasonType: "auto_failed",
        reasonTitle: "有试卷，但无法自动绑定",
        reasonDetail: `找到 ${papers.length || "多"} 份候选试卷，系统无法自动确认应使用哪一份，需要人工核对。`,
      };
    }
    const matched = matchedResults.find((item) => (
      text(item?.course_code) === course.code
      || (!course.code && text(item?.course_name) === course.name)
    ));
    if (matched) {
      return {
        courseName: course.name,
        courseCode: course.code,
        papers: paperPairs(matched.paper_names, matched.form_codes),
        reasonType: "auto_failed",
        reasonTitle: "有试卷，但无法自动绑定",
        reasonDetail: errorMessage,
      };
    }
    const explicitlyMissing = missingCourseCodes.has(course.code);
    return {
      courseName: course.name,
      courseCode: course.code,
      papers: [],
      reasonType: "missing",
      reasonTitle: "未找到试卷",
      reasonDetail: explicitlyMissing
        ? "活跃试卷中未找到包含该科目编号或科目名称的试卷。"
        : errorMessage,
    };
  });
  return { rows, isExample: false };
}

function formatExamTime(task = {}, requirementIndex = 0, reminder = {}) {
  const session = taskFormalSession(task, requirementIndex);
  const start = parseDate(session?.start) || parseDate(reminder.examStart);
  const end = parseDate(session?.end);
  if (!start) return text(reminder.examStart) || "--";
  if (!end) return formatLocalDateTime(start);
  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
  return sameDay
    ? `${formatLocalDateTime(start)}-${pad(end.getHours())}:${pad(end.getMinutes())}`
    : `${formatLocalDateTime(start)} - ${formatLocalDateTime(end)}`;
}

function normalizedReminderDetails(details = {}) {
  const rows = Array.isArray(details.rows) ? details.rows : [];
  return {
    isExample: details.isExample === true,
    checkedAt: text(details.checkedAt),
    rows: rows.map((row, index) => ({
      courseName: text(row?.courseName) || `科目 ${index + 1}`,
      courseCode: text(row?.courseCode),
      papers: (Array.isArray(row?.papers) ? row.papers : []).map((paper) => ({
        name: text(paper?.name || paper) || "候选试卷",
        code: text(paper?.code),
      })),
      reasonType: row?.reasonType === "auto_failed" ? "auto_failed" : "missing",
      reasonTitle: text(row?.reasonTitle) || (row?.reasonType === "auto_failed" ? "有试卷，但无法自动绑定" : "未找到试卷"),
      reasonDetail: text(row?.reasonDetail) || "请登录易考后台检查试卷绑定状态。",
    })),
  };
}

export function buildPaperBindReminderEmail({ task = {}, requirementIndex = 0, context, details } = {}) {
  const reminder = context || paperBindReminderDecision(task, requirementIndex, new Date());
  if (!reminder?.due) throw new Error("当前考试不在试卷绑定提醒时间窗口内");
  const examName = reminderExamName(task, requirementIndex);
  const examTime = formatExamTime(task, requirementIndex, reminder);
  const detail = normalizedReminderDetails(details || paperBindReminderDetails(task, requirementIndex));
  const subject = `${detail.isExample ? "[模板示例] " : ""}[试卷绑定提醒] ${examName} 尚未完成试卷绑定`;
  const detailLines = detail.rows.flatMap((row) => [
    `科目：${row.courseName}${row.courseCode ? `（${row.courseCode}）` : ""}`,
    `涉及试卷：${row.papers.length ? row.papers.map((paper) => `${paper.name}${paper.code ? `（${paper.code}）` : ""}`).join("；") : "未找到匹配试卷"}`,
    `未绑定原因：${row.reasonTitle}。${row.reasonDetail}`,
    "",
  ]);
  const body = [
    ...(detail.isExample ? ["【模板示例】本邮件仅用于确认提醒样式，不代表项目当前真实绑定状态。", ""] : []),
    "试卷尚未完成绑定",
    "",
    `考试名称：${examName}`,
    `考试时间：${examTime}`,
    "",
    "科目与试卷检查结果",
    ...detailLines,
    "",
    "请登录易考后台核对候选试卷，完成缺失试卷上传后，再为正式考试场次绑定对应试卷。",
    "系统自动发送，请勿回复本邮件。",
  ].join("\n");
  const examRows = [
    ["考试名称", examName],
    ["考试时间", examTime],
  ].map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
  const subjectRows = detail.rows.map((row) => {
    const papers = row.papers.length
      ? row.papers.map((paper) => `<div class="paper">${escapeHtml(paper.name)}${paper.code ? `<small>${escapeHtml(paper.code)}</small>` : ""}</div>`).join("")
      : '<strong class="missing-paper">未找到匹配试卷</strong>';
    const reasonClass = row.reasonType === "auto_failed" ? "auto-failed" : "missing";
    return `<tr><td><strong>${escapeHtml(row.courseName)}</strong></td><td><code>${escapeHtml(row.courseCode || "--")}</code></td><td>${papers}</td><td><div class="reason ${reasonClass}"><strong>${escapeHtml(row.reasonTitle)}</strong><span>${escapeHtml(row.reasonDetail)}</span></div></td></tr>`;
  }).join("");
  const reasonGroups = [
    ["auto_failed", "有试卷，无法自动绑定"],
    ["missing", "未找到匹配试卷"],
  ].flatMap(([type, label]) => {
    const matches = detail.rows.filter((row) => row.reasonType === type);
    if (!matches.length) return [];
    return [`<div class="summary ${type === "auto_failed" ? "auto-failed" : "missing"}"><strong>${escapeHtml(label)} · ${matches.length} 个科目</strong><span>${escapeHtml(matches.map((row) => row.courseName).join("、"))}</span></div>`];
  }).join("");
  const exampleBanner = detail.isExample
    ? '<tr><td class="example" bgcolor="#fff8e8" style="padding:11px 24px;border-bottom:1px solid #efd39b;background:#fff8e8;background-color:#fff8e8;color:#704900;"><strong>模板示例</strong>本邮件仅用于确认提醒样式，不代表项目当前真实绑定状态。</td></tr>'
    : "";
  const checkedAt = detail.checkedAt || new Date().toISOString();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:0;background:#eef1f5;background-color:#eef1f5;color:#1f2937;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.mail{max-width:980px;overflow:hidden;border:1px solid #cfd6df;border-top:5px solid #b42318;border-radius:6px;background:#fff;background-color:#fff}.example strong{margin-right:8px}.head{padding:23px 28px;border-bottom:1px solid #e1e6ec;background:#fff;background-color:#fff}.head h1{margin:0;color:#172033;font-size:22px}.head p{margin:6px 0 0;color:#5d697a}.content{padding:22px 28px;background:#fff;background-color:#fff}.section+.section{margin-top:23px;padding-top:22px;border-top:1px solid #e1e6ec}.section h2{margin:0 0 11px;color:#24364b;font-size:16px}.info,.subjects{width:100%;border-collapse:collapse;table-layout:fixed}.info th,.info td,.subjects th,.subjects td{padding:10px;border:1px solid #d9e0e8;text-align:left;vertical-align:top;overflow-wrap:anywhere}.info th{width:16%;background:#f5f7fa;color:#5b6879}.info td{width:34%}.subjects th{background:#f5f7fa;color:#4c596b}.subjects th:nth-child(1){width:16%}.subjects th:nth-child(2){width:19%}.subjects th:nth-child(3){width:29%}.subjects th:nth-child(4){width:36%}code{color:#4a596d;font-size:12px}.paper+.paper{margin-top:7px}.paper small{display:block;color:#687587}.missing-paper{color:#9f2118}.reason{display:grid;gap:3px;padding-left:10px;border-left:3px solid #d97706}.reason.missing{border-left-color:#b42318}.reason span{color:#5d697a}.summaries{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.summary{display:grid;gap:4px;padding:12px 13px;border:1px solid #d9e0e8;border-left:4px solid #d97706;background:#fafbfc}.summary.missing{border-left-color:#b42318}.summary span{color:#5d697a}.action{margin:18px 0 0;padding:12px 14px;border:1px solid #c8d7e6;background:#f1f6fb;color:#2e4e6e}.foot{padding:14px 28px;border-top:1px solid #e1e6ec;background:#f5f7fa;background-color:#f5f7fa;color:#6c7787;font-size:12px}@media(max-width:700px){.canvas-pad{padding:0!important}.mail{border-radius:0}.content,.head{padding-left:16px!important;padding-right:16px!important}.subjects{table-layout:auto}.summaries{grid-template-columns:1fr}}</style></head><body bgcolor="#eef1f5" style="margin:0;padding:0;background:#eef1f5;background-color:#eef1f5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef1f5" style="width:100%;border-collapse:collapse;background:#eef1f5;background-color:#eef1f5;"><tr><td class="canvas-pad" align="center" bgcolor="#eef1f5" style="padding:24px;background:#eef1f5;background-color:#eef1f5;color:#1f2937;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;"><table role="presentation" class="mail" width="980" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:980px;border-collapse:separate;border:1px solid #cfd6df;border-top:5px solid #b42318;border-radius:6px;background:#ffffff;background-color:#ffffff;">${exampleBanner}<tr><td class="head" bgcolor="#ffffff" style="padding:23px 28px;border-bottom:1px solid #e1e6ec;background:#ffffff;background-color:#ffffff;"><h1>试卷尚未完成绑定</h1><p>系统已完成自动检查，以下科目仍需人工处理。</p></td></tr><tr><td class="content" bgcolor="#ffffff" style="padding:22px 28px;background:#ffffff;background-color:#ffffff;"><section class="section"><h2>考试信息</h2><table class="info">${examRows}</table></section><section class="section"><h2>科目与试卷检查结果</h2><table class="subjects"><thead><tr><th>科目</th><th>科目编号</th><th>涉及试卷</th><th>当前未绑定原因</th></tr></thead><tbody>${subjectRows}</tbody></table></section><section class="section"><h2>未绑定原因汇总</h2><div class="summaries">${reasonGroups}</div><p class="action"><strong>请处理：</strong>登录易考后台核对候选试卷，完成缺失试卷上传后，再为正式考试场次绑定对应试卷。</p></section></td></tr><tr><td class="foot" bgcolor="#f5f7fa" style="padding:14px 28px;border-top:1px solid #e1e6ec;background:#f5f7fa;background-color:#f5f7fa;color:#6c7787;font-size:12px;">自动检查时间：${escapeHtml(formatLocalDateTime(checkedAt))}　·　系统自动发送，请勿回复本邮件。</td></tr></table></td></tr></table></body></html>`;
  return { subject, text: body, html, examName, examTime, details: detail };
}

export async function sendPaperBindReminderEmail({
  task = {},
  requirementIndex = 0,
  context,
  details,
  emailSettings,
  sendMail = sendSmtpMail,
  now = new Date(),
} = {}) {
  const reminder = context || paperBindReminderDecision(task, requirementIndex, now);
  if (!reminder?.due) throw new Error("当前考试不在试卷绑定提醒时间窗口内");
  const recipients = parseEmailRecipients(task.ownerEmail);
  if (!recipients.length) throw new Error("任务未记录创建账户邮箱，无法发送试卷绑定提醒");
  const settings = normalizeEmailSettings(emailSettings);
  if (!settings.fromEmail) throw new Error("请先配置发件邮箱");
  if (!settings.username) throw new Error("请先配置 SMTP 用户名");
  if (!settings.password) throw new Error("请先配置 SMTP 密码或应用密码");
  const message = buildPaperBindReminderEmail({ task, requirementIndex, context: reminder, details });
  const sent = await sendMail({
    settings,
    from: { email: settings.fromEmail, name: settings.fromName },
    to: recipients,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  const sentAt = (now instanceof Date ? now : parseDate(now) || new Date()).toISOString();
  return {
    sentAt,
    recipients,
    subject: message.subject,
    messageId: sent?.messageId || "",
    reminderKey: reminder.reminderKey,
    scheduledFor: reminder.scheduledFor,
    examStart: reminder.examStart,
    category: reminder.category,
  };
}
