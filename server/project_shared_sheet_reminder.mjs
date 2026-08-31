import {
  normalizeEmailSettings,
  parseEmailRecipients,
} from "./content_requirement_email.mjs";
import { sendSmtpMail } from "./smtp_mailer.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function parseDate(value) {
  if (value instanceof Date) {
    const copy = new Date(value);
    return Number.isFinite(copy.getTime()) ? copy : null;
  }
  if (!value) return null;
  const normalized = text(value).replace(/\//g, "-").replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function sessionType(session = {}) {
  return text(session.sessionType || session.session_type);
}

function sessionStart(session = {}) {
  return parseDate(session.start || session.start_time || session.startTime);
}

function projectSharedSheetStep(task = {}) {
  return (Array.isArray(task.steps) ? task.steps : [])
    .find((step) => step?.stepKey === "project_shared_sheet") || {};
}

function relevantSessions(task = {}) {
  return (Array.isArray(task.sessions) ? task.sessions : [])
    .filter((session) => ["formal", "trial"].includes(sessionType(session)));
}

function expectedSessionIds(task = {}) {
  return relevantSessions(task)
    .map((session) => text(session.session_id || session.id))
    .filter(Boolean)
    .sort();
}

export function projectSharedSheetReminderEarliestSession(task = {}) {
  const candidates = relevantSessions(task)
    .map((session) => ({ session, start: sessionStart(session) }))
    .filter((item) => item.start)
    .sort((left, right) => {
      const timeDifference = left.start.getTime() - right.start.getTime();
      if (timeDifference) return timeDifference;
      if (sessionType(left.session) === sessionType(right.session)) return 0;
      return sessionType(left.session) === "trial" ? -1 : 1;
    });
  if (!candidates.length) return null;
  const { session, start } = candidates[0];
  const type = sessionType(session);
  return {
    sessionId: text(session.session_id || session.id),
    sessionType: type,
    sessionTypeLabel: type === "trial" ? "试考" : "正式考试",
    requirementIndex: Math.max(Number(session.requirementIndex || session.requirement_index || 0), 0),
    name: text(session.name),
    start,
  };
}

export function projectSharedSheetReminderSchedule(earliestStart) {
  const start = parseDate(earliestStart);
  if (!start) return null;
  const scheduled = new Date(start);
  scheduled.setDate(scheduled.getDate() - 1);
  scheduled.setHours(17, 0, 0, 0);
  return {
    scheduled,
    reminderLabel: "最早场次前一天 17:00",
  };
}

export function projectSharedSheetReminderState(task = {}) {
  return task.config?.projectSharedSheetReminder || {};
}

export function projectSharedSheetWasFilled(task = {}) {
  const step = projectSharedSheetStep(task);
  if (step.status !== "success") return false;
  const expectedIds = expectedSessionIds(task);
  const persistedIds = Array.isArray(step.result?.sessionIds)
    ? step.result.sessionIds.map(text).filter(Boolean)
    : [];
  if (!persistedIds.length) return true;
  const persisted = new Set(persistedIds);
  return expectedIds.every((sessionId) => persisted.has(sessionId));
}

function reminderKey({ earliest, scheduledFor, sessionIds }) {
  return [
    earliest.sessionType,
    earliest.sessionId,
    earliest.start.toISOString(),
    scheduledFor,
    sessionIds.join(","),
  ].join("|");
}

function sentReminderMatchesEarliestSession(state = {}, earliest = {}) {
  if (state.status !== "sent") return false;
  if (!text(state.earliestSessionId) || text(state.earliestSessionId) !== earliest.sessionId) return false;
  const persistedStart = parseDate(state.earliestSessionStart);
  return Boolean(persistedStart && persistedStart.getTime() === earliest.start.getTime());
}

export function projectSharedSheetReminderDecision(task = {}, now = new Date()) {
  const normalizedNow = parseDate(now);
  if (!normalizedNow) return { due: false, reason: "invalid_now" };
  const earliest = projectSharedSheetReminderEarliestSession(task);
  if (!earliest) return { due: false, reason: "missing_session_start" };
  if (projectSharedSheetWasFilled(task)) return { due: false, reason: "shared_sheet_filled" };
  const schedule = projectSharedSheetReminderSchedule(earliest.start);
  if (!schedule) return { due: false, reason: "missing_schedule" };
  if (normalizedNow.getTime() < schedule.scheduled.getTime()) {
    return { due: false, reason: "before_schedule" };
  }
  if (normalizedNow.getTime() >= earliest.start.getTime()) {
    return { due: false, reason: "earliest_session_started" };
  }
  const sessionIds = expectedSessionIds(task);
  const scheduledFor = schedule.scheduled.toISOString();
  const key = reminderKey({ earliest, scheduledFor, sessionIds });
  const state = projectSharedSheetReminderState(task);
  if (
    (state.status === "sent" && state.reminderKey === key)
    || sentReminderMatchesEarliestSession(state, earliest)
  ) {
    return { due: false, reason: "already_sent" };
  }
  return {
    due: true,
    reason: state.status === "failed" && state.reminderKey === key ? "retry" : "scheduled",
    reminderKey: key,
    scheduledFor,
    reminderLabel: schedule.reminderLabel,
    earliestSessionId: earliest.sessionId,
    earliestSessionType: earliest.sessionType,
    earliestSessionTypeLabel: earliest.sessionTypeLabel,
    earliestSessionName: earliest.name,
    earliestSessionStart: earliest.start.toISOString(),
    requirementIndex: earliest.requirementIndex,
    sessionIds,
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(value) {
  const date = parseDate(value);
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

function reminderExamName(task = {}, context = {}) {
  return text(
    context.earliestSessionName
    || task.examName
    || task.projectName
    || "未命名考试",
  );
}

export function buildProjectSharedSheetReminderEmail({ task = {}, context } = {}) {
  const reminder = context || projectSharedSheetReminderDecision(task, new Date());
  if (!reminder?.due) throw new Error("当前考试不在项目共享大表提醒时间窗口内");
  const projectName = text(task.projectName || task.examName) || "未命名项目";
  const examName = reminderExamName(task, reminder);
  const sessionLabel = reminder.earliestSessionTypeLabel || "考试";
  const sessionTime = formatLocalDateTime(reminder.earliestSessionStart);
  const subject = `[项目共享大表提醒] ${projectName} 尚未填写项目共享大表`;
  const body = [
    "项目共享大表尚未填写",
    "",
    `项目名称：${projectName}`,
    `最早场次：${sessionLabel}｜${examName}`,
    `场次时间：${sessionTime}`,
    "",
    "截至提醒时间，任务详情中的“项目共享大表”步骤尚未填写成功。",
    "请登录易考自动配置控制台，在考试任务详情中触发填写并核对新在线表。",
    "系统自动发送，请勿回复本邮件。",
  ].join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#eef1f5;color:#1f2937;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;border:1px solid #cfd6df;border-top:5px solid #b42318;background:#ffffff"><tr><td style="padding:22px 26px;border-bottom:1px solid #e1e6ec"><h1 style="margin:0;font-size:22px;color:#172033">项目共享大表尚未填写</h1><p style="margin:6px 0 0;color:#5d697a">最早场次将在次日开始，请及时完成填写。</p></td></tr><tr><td style="padding:22px 26px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><th style="width:22%;padding:10px;border:1px solid #d9e0e8;background:#f5f7fa;text-align:left">项目名称</th><td style="padding:10px;border:1px solid #d9e0e8">${escapeHtml(projectName)}</td></tr><tr><th style="padding:10px;border:1px solid #d9e0e8;background:#f5f7fa;text-align:left">最早场次</th><td style="padding:10px;border:1px solid #d9e0e8">${escapeHtml(`${sessionLabel}｜${examName}`)}</td></tr><tr><th style="padding:10px;border:1px solid #d9e0e8;background:#f5f7fa;text-align:left">场次时间</th><td style="padding:10px;border:1px solid #d9e0e8">${escapeHtml(sessionTime)}</td></tr></table><p style="margin:18px 0 0;padding:12px 14px;border:1px solid #c8d7e6;background:#f1f6fb;color:#2e4e6e"><strong>请处理：</strong>登录易考自动配置控制台，在考试任务详情中触发“项目共享大表”填写并核对新在线表。</p></td></tr><tr><td style="padding:13px 26px;border-top:1px solid #e1e6ec;background:#f5f7fa;color:#6c7787;font-size:12px">系统自动发送，请勿回复本邮件。</td></tr></table></td></tr></table></body></html>`;
  return { subject, text: body, html, projectName, examName, sessionLabel, sessionTime };
}

export async function sendProjectSharedSheetReminderEmail({
  task = {},
  context,
  emailSettings,
  sendMail = sendSmtpMail,
  now = new Date(),
} = {}) {
  const reminder = context || projectSharedSheetReminderDecision(task, now);
  if (!reminder?.due) throw new Error("当前考试不在项目共享大表提醒时间窗口内");
  const recipients = parseEmailRecipients(task.ownerEmail);
  if (!recipients.length) throw new Error("任务未记录创建账户邮箱，无法发送项目共享大表提醒");
  const settings = normalizeEmailSettings(emailSettings);
  if (!settings.fromEmail) throw new Error("请先配置发件邮箱");
  if (!settings.username) throw new Error("请先配置 SMTP 用户名");
  if (!settings.password) throw new Error("请先配置 SMTP 密码或应用密码");
  const message = buildProjectSharedSheetReminderEmail({ task, context: reminder });
  const sent = await sendMail({
    settings,
    from: { email: settings.fromEmail, name: settings.fromName },
    to: recipients,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  const sentAt = (parseDate(now) || new Date()).toISOString();
  return {
    sentAt,
    recipients,
    subject: message.subject,
    messageId: sent?.messageId || "",
    reminderKey: reminder.reminderKey,
    scheduledFor: reminder.scheduledFor,
    earliestSessionId: reminder.earliestSessionId,
    earliestSessionStart: reminder.earliestSessionStart,
  };
}
