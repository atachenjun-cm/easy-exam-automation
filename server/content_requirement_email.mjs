import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { sendSmtpMail } from "./smtp_mailer.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function firstValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function display(value) {
  return text(value) || "—";
}

function emailAddress(value) {
  const email = text(value);
  if (!/^[^\s@<>(),;:\\"\[\]]+@[^\s@<>(),;:\\"\[\]]+\.[^\s@<>(),;:\\"\[\]]+$/.test(email)) {
    throw new Error(`邮箱地址格式不正确：${email || "空地址"}`);
  }
  return email;
}

function draftField(task = {}, key) {
  return text(task.config?.operationBatch?.draft?.fields?.[key]?.value);
}

function dateFromText(value) {
  const match = text(value).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function scheduleDates(business = {}, formalExamTime = "") {
  const formalMatches = [...text(formalExamTime).matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)]
    .map((item) => dateFromText(item[0]))
    .filter(Boolean);
  if (formalMatches.length) {
    return {
      start: formalMatches[0],
      end: formalMatches[formalMatches.length - 1] || formalMatches[0],
    };
  }
  const dates = Array.isArray(business.exam_schedule)
    ? business.exam_schedule.map((item) => dateFromText(item?.exam_date)).filter(Boolean)
    : [];
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };
  const matches = [...text(business.formal_exam_time_range).matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)]
    .map((item) => dateFromText(item[0]))
    .filter(Boolean);
  return { start: matches[0] || "", end: matches[matches.length - 1] || matches[0] || "" };
}

function dateTimeRange(value) {
  const normalized = text(value);
  const dateTimePattern = /\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g;
  const matches = normalized.match(dateTimePattern) || [];
  if (matches.length >= 2) return { start: matches[0], end: matches[1] };
  if (matches.length === 1) {
    const trailingTime = normalized.slice(normalized.indexOf(matches[0]) + matches[0].length)
      .match(/(?:-|至|到|~)\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
    const date = matches[0].match(/^\d{4}[/-]\d{1,2}[/-]\d{1,2}/)?.[0] || "";
    return {
      start: matches[0],
      end: trailingTime && date ? `${date} ${trailingTime[1]}` : "",
    };
  }
  return { start: "", end: "" };
}

function positiveCount(value) {
  const normalized = text(value);
  const count = Number(normalized);
  return normalized && Number.isFinite(count) && count > 0 ? normalized : "";
}

function formalExamCandidateCount(task = {}) {
  const counts = (Array.isArray(task.sessions) ? task.sessions : [])
    .filter((session) => text(session?.sessionType || session?.session_type) === "formal")
    .map((session) => Number(session?.candidateCount || session?.candidate_count || 0))
    .filter((count) => Number.isFinite(count) && count > 0);
  return counts.length ? String(Math.max(...counts)) : "";
}

function dateTimeTimestamp(value) {
  const match = text(value).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (!match) return NaN;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  ).getTime();
}

function durationMinutes(value) {
  const range = dateTimeRange(value);
  const start = dateTimeTimestamp(range.start);
  const end = dateTimeTimestamp(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
  return String(Math.round((end - start) / 60_000));
}

function taskExamRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement && typeof task.config.examRequirement === "object"
    ? [task.config.examRequirement]
    : [];
}

function requirementSubjects(requirement = {}) {
  const values = [
    ...text(requirement.fields?.["科目信息"]).split(/[\n、,，;；]+/),
    ...(Array.isArray(requirement.config?.courses) ? requirement.config.courses : [])
      .map((course) => typeof course === "object" && course !== null ? course.name : course),
    ...(Array.isArray(requirement.config?.subjects) ? requirement.config.subjects : [])
      .map((subject) => typeof subject === "object" && subject !== null ? subject.name : subject),
  ].map((item) => text(item)).filter(Boolean);
  return [...new Set(values)];
}

function successfulStepResult(task = {}, stepKey, requirementIndex, requirementCount) {
  const step = (Array.isArray(task.steps) ? task.steps : []).find((item) => item?.stepKey === stepKey);
  const progress = step?.requirementProgress?.[String(requirementIndex)];
  if (progress) return progress.status === "success" ? (progress.result || {}) : null;
  return requirementCount === 1 && step?.status === "success" ? (step.result || {}) : null;
}

function contentTaskRemarkWithCourseCodes(remark = "", courses = []) {
  const base = text(remark);
  const seen = new Set();
  const items = (Array.isArray(courses) ? courses : []).flatMap((course) => {
    const code = text(course?.code || course?.course_code);
    if (!code || seen.has(code) || base.includes(code)) return [];
    seen.add(code);
    const name = text(course?.name || course?.courseName);
    return [name ? `${name}（${code}）` : code];
  });
  return [base, items.length ? `科目编号：${items.join("、")}` : ""].filter(Boolean).join("；");
}

function contentExamRows({ task = {}, subjects = [], projectName = "", formalExamTime = "", trialExamTime = "" } = {}) {
  const requirements = taskExamRequirements(task);
  const sessions = Array.isArray(task.sessions) ? task.sessions : [];
  const remarks = task.config?.contentTaskRemarks || {};
  const tenantId = text(task.config?.tenantId);
  const tenantRemark = tenantId ? `租户 ID：${tenantId}` : "";
  const savedRemark = (key) => Object.hasOwn(remarks, key) ? text(remarks[key]) : null;
  const rows = [];

  requirements.forEach((requirement, requirementIndex) => {
    const config = requirement.config || {};
    const fields = requirement.fields || {};
    const formalSession = sessions.find((session) =>
      text(session?.sessionType || session?.session_type) === "formal"
      && Number(session?.requirementIndex || session?.requirement_index || 0) === requirementIndex);
    const formalTime = firstValue(
      fields["考试日期时间"],
      config.startTimeDisplay && config.endTimeDisplay
        ? `${config.startTimeDisplay}-${config.endTimeDisplay}`
        : "",
      formalSession?.start && formalSession?.end ? `${formalSession.start}-${formalSession.end}` : "",
      requirementIndex === 0 ? formalExamTime : "",
    );
    const formalCourses = successfulStepResult(task, "course_create", requirementIndex, requirements.length)?.courses;
    const formalRemark = savedRemark(`formal:${requirementIndex}`) ?? firstValue(tenantRemark, fields["备注"], config.remark);
    const requirementSubjectNames = requirementSubjects(requirement);
    (requirementSubjectNames.length ? requirementSubjectNames : [""]).forEach((subject, subjectIndex) => {
      const matchingCourses = (Array.isArray(formalCourses) ? formalCourses : [])
        .filter((course) => text(course?.name || course?.courseName) === subject);
      const subjectCourses = matchingCourses.length
        ? matchingCourses
        : (formalCourses?.length === requirementSubjectNames.length ? [formalCourses[subjectIndex]] : []);
      rows.push({
        examName: firstValue(fields["考试名称"], config.examName, formalSession?.name, projectName, `考试 ${requirementIndex + 1}`),
        time: formalTime,
        subject,
        duration: durationMinutes(formalTime),
        remark: contentTaskRemarkWithCourseCodes(formalRemark, subjectCourses),
        order: requirementIndex * 1_000 + subjectIndex,
        start: dateTimeTimestamp(dateTimeRange(formalTime).start),
      });
    });

  });

  if (!rows.length) {
    const formalSession = sessions.find((session) => text(session?.sessionType || session?.session_type) === "formal");
    const time = firstValue(
      formalExamTime,
      formalSession?.start && formalSession?.end ? `${formalSession.start}-${formalSession.end}` : "",
    );
    const fallbackSubjects = subjects.length ? subjects : [{ name: "" }];
    return fallbackSubjects.map((subject, index) => ({
      examName: firstValue(formalSession?.name, projectName),
      time,
      subject: subject.name,
      duration: firstValue(subject.duration, durationMinutes(time)),
      remark: firstValue(subject.remark, savedRemark("formal:0"), tenantRemark),
      order: index,
      start: dateTimeTimestamp(dateTimeRange(time).start),
    }));
  }

  return rows.sort((left, right) => {
    const leftStart = Number.isFinite(left.start) ? left.start : Number.MAX_SAFE_INTEGER;
    const rightStart = Number.isFinite(right.start) ? right.start : Number.MAX_SAFE_INTEGER;
    return leftStart - rightStart || left.order - right.order;
  });
}

function subjectRows(value) {
  const subjects = Array.isArray(value) ? value : (text(value) ? [value] : []);
  return subjects.map((item) => {
    if (typeof item === "object" && item !== null) {
      return {
        name: text(item.name || item.subjectName || item.courseName || item.subject || item.value),
        duration: text(item.durationMinutes || item.duration || item.examDuration || item.minutes || item["时长（分钟）"]),
        remark: text(item.remark || item.note || item["备注"]),
      };
    }
    return { name: text(item), duration: "", remark: "" };
  }).filter((item) => item.name);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInfoRows(rows) {
  return rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(display(value))}</td></tr>`).join("");
}

function contentSnapshot({ subject = "", customerName = "", projectManager = "", basicInfo = [], examRows = [] } = {}) {
  return {
    schemaVersion: 2,
    subject: text(subject),
    customerName: text(customerName),
    projectManager: text(projectManager),
    basicInfo: Object.fromEntries(basicInfo.map(([label, value]) => [label, text(value)])),
    examRows: examRows.map((row) => ({
      examName: text(row.examName),
      time: text(row.time),
      subject: text(row.subject),
      duration: text(row.duration),
      remark: text(row.remark),
    })),
  };
}

function contentEmailLatestSnapshot(task = {}) {
  const contentEmail = task.config?.contentRequirementEmail || {};
  const history = Array.isArray(contentEmail.history) ? contentEmail.history : [];
  const latestSnapshot = history.at(-1)?.contentSnapshot;
  if (latestSnapshot) return latestSnapshot;
  return history.length <= 1 ? (contentEmail.firstContentSnapshot || null) : null;
}

function contentEmailHasSent(task = {}) {
  const contentEmail = task.config?.contentRequirementEmail || {};
  return Boolean(
    (Array.isArray(contentEmail.history) && contentEmail.history.length)
    || text(contentEmail.lastSentAt),
  );
}

function changedValue(label, before, after, prefix = "") {
  if (text(before) === text(after)) return "";
  return `${prefix}${label}：由“${display(before)}”调整为“${display(after)}”`;
}

function examRowKeys(rows = []) {
  const counts = new Map();
  return new Map(rows.map((row) => {
    const base = `${text(row.examName)}\u0000${text(row.subject)}`;
    const occurrence = (counts.get(base) || 0) + 1;
    counts.set(base, occurrence);
    return [`${base}\u0000${occurrence}`, row];
  }));
}

export function diffContentRequirementEmailSnapshots(baseline = {}, current = {}) {
  const changes = [
    ...(Object.hasOwn(baseline, "subject")
      ? [changedValue("邮件主题", baseline.subject, current.subject)]
      : []),
    changedValue("客户名称", baseline.customerName, current.customerName),
    changedValue("项目经理", baseline.projectManager, current.projectManager),
  ].filter(Boolean);
  const beforeInfo = baseline.basicInfo || {};
  const afterInfo = current.basicInfo || {};
  for (const label of new Set([...Object.keys(beforeInfo), ...Object.keys(afterInfo)])) {
    const change = changedValue(label, beforeInfo[label], afterInfo[label]);
    if (change) changes.push(change);
  }

  const beforeRows = examRowKeys(Array.isArray(baseline.examRows) ? baseline.examRows : []);
  const afterRows = examRowKeys(Array.isArray(current.examRows) ? current.examRows : []);
  const rowLabels = { examName: "考试名称", time: "考试时间", subject: "科目名称", duration: "时长（分钟）", remark: "备注" };
  for (const [key, row] of beforeRows) {
    if (afterRows.has(key)) continue;
    changes.push(`删除科目：考试名称“${display(row.examName)}”，考试时间“${display(row.time)}”，科目名称“${display(row.subject)}”，时长（分钟）“${display(row.duration)}”，备注“${display(row.remark)}”`);
  }
  for (const [key, row] of afterRows) {
    const before = beforeRows.get(key);
    if (!before) {
      changes.push(`新增科目：考试名称“${display(row.examName)}”，考试时间“${display(row.time)}”，科目名称“${display(row.subject)}”，时长（分钟）“${display(row.duration)}”，备注“${display(row.remark)}”`);
      continue;
    }
    const prefix = `${display(row.subject)} / `;
    for (const field of ["time", "duration", "remark"]) {
      const change = changedValue(rowLabels[field], before[field], row[field], prefix);
      if (change) changes.push(change);
    }
  }
  const beforeOrder = [...beforeRows.keys()].filter((key) => afterRows.has(key));
  const afterOrder = [...afterRows.keys()].filter((key) => beforeRows.has(key));
  if (beforeOrder.length > 1 && beforeOrder.join("\n") !== afterOrder.join("\n")) {
    const orderText = (keys, rows) => keys.map((key) => {
      const row = rows.get(key) || {};
      return `${display(row.subject)}（${display(row.examName)}）`;
    }).join(" → ");
    changes.push(`科目顺序：由“${orderText(beforeOrder, beforeRows)}”调整为“${orderText(afterOrder, afterRows)}”`);
  }
  return changes;
}

function fallbackContentUpdateFromHistory(task = {}) {
  const contentEmailHistory = Array.isArray(task.config?.contentRequirementEmail?.history)
    ? task.config.contentRequirementEmail.history
    : [];
  const latestSentAt = Date.parse(contentEmailHistory.at(-1)?.sentAt || task.config?.contentRequirementEmail?.lastSentAt || "");
  const sourceHistory = Array.isArray(task.config?.projectSourceChangeHistory)
    ? task.config.projectSourceChangeHistory
    : [];
  const changes = sourceHistory
    .filter((record) => !Number.isFinite(latestSentAt) || Date.parse(record?.changedAt || "") >= latestSentAt)
    .flatMap((record) => (Array.isArray(record?.changes) ? record.changes : []))
    .map((change) => changedValue(text(change?.field) || "内容", change?.before, change?.after))
    .filter(Boolean);
  return changes.length
    ? [...new Set(changes)].join("\n")
    : "最近一次发送记录未保存内容快照，请人工填写并核对本次内容更新";
}

export function normalizeEmailSettings(input = {}, existing = {}) {
  const password = input.clearPassword === true
    ? ""
    : text(input.password) || text(existing.password);
  return {
    host: text(input.host) || text(existing.host) || "smtp.office365.com",
    port: Number(input.port || existing.port || 587),
    secure: input.secure === true,
    fromEmail: text(input.fromEmail) || text(existing.fromEmail),
    fromName: text(input.fromName) || text(existing.fromName),
    username: text(input.username) || text(existing.username),
    password,
  };
}

export function redactEmailSettings(settings = {}) {
  return {
    host: text(settings.host) || "smtp.office365.com",
    port: Number(settings.port || 587),
    secure: settings.secure === true,
    fromEmail: text(settings.fromEmail),
    fromName: text(settings.fromName),
    username: text(settings.username),
    passwordConfigured: Boolean(text(settings.password)),
  };
}

export function parseEmailRecipients(value) {
  return String(value || "")
    .split(/[;,\n，；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(emailAddress);
}

export async function writeEmailSettingsFile(filePath, settings) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

export function buildContentRequirementEmail({ task = {}, requirement = {}, contentUpdate = "" } = {}) {
  const business = task.config?.businessRequirement || {};
  const examRequirement = task.config?.examRequirement || {};
  const requirementConfig = examRequirement.config || {};
  const requirementFields = examRequirement.fields || {};
  const supplements = examRequirement.supplements || {};
  const strictSnapshot = Boolean(Object.keys(examRequirement).length);
  const legacyBusiness = strictSnapshot ? {} : business;
  const latest = requirement?.latest?.requirement || {};
  const examName = firstValue(latest.exam_name, latest.examName, requirementConfig.examName, requirementFields["考试名称"], task.projectName);
  const projectName = firstValue(
    task.config?.fanweiSource?.raw?.fields?.["项目名称"],
    business.project_name,
    latest.projectName,
    task.projectName,
    examName,
  );
  const customerName = firstValue(latest.customerName, requirement?.customer?.name, requirementConfig.customerName, task.config?.customerName, legacyBusiness.customer_name);
  const projectCode = firstValue(business.project_code, task.config?.projectCode);
  const batchCode = firstValue(task.config?.operationBatchCode, task.config?.operationBatch?.code);
  const formalExamTime = firstValue(
    latest.formal_exam_time_range,
    latest.formalExamTime,
    latest.examTime,
    latest.startTimeDisplay,
    requirementFields["考试日期时间"],
    requirementConfig.startTimeDisplay && requirementConfig.endTimeDisplay
      ? `${requirementConfig.startTimeDisplay}-${requirementConfig.endTimeDisplay}`
      : "",
    legacyBusiness.formal_exam_time,
    legacyBusiness.exam_time,
  );
  const trialExamTime = firstValue(
    latest.mock_exam_time_range,
    latest.trialExamTime,
    latest.mockStartTimeDisplay,
    requirementFields["试考日期时间"],
    requirementConfig.mockStartTimeDisplay && requirementConfig.mockEndTimeDisplay
      ? `${requirementConfig.mockStartTimeDisplay}-${requirementConfig.mockEndTimeDisplay}`
      : "",
    legacyBusiness.trial_exam_time,
  );
  const trialRange = dateTimeRange(trialExamTime);
  const dates = scheduleDates(legacyBusiness, formalExamTime);
  const batchName = firstValue(draftField(task, "batchName"), task.config?.operationBatch?.batchName);
  const examStartDate = firstValue(draftField(task, "examStartDate"), dates.start);
  const examEndDate = firstValue(draftField(task, "examEndDate"), dates.end);
  const systemType = firstValue(supplements.systemType, latest.systemType, strictSnapshot ? "易考" : draftField(task, "systemType"), legacyBusiness.system_type);
  const maxSubjectCount = firstValue(
    formalExamCandidateCount(task),
    positiveCount(latest.candidateCount),
    positiveCount(latest.candidate_count),
    positiveCount(requirementConfig.candidateCount),
    positiveCount(task.config?.candidateCount),
    positiveCount(business.candidate_count),
    positiveCount(supplements.estimatedMaxSubjectCount),
    positiveCount(latest.estimatedMaxSubjectCount),
    positiveCount(draftField(task, "estimatedMaxSubjectCount")),
    positiveCount(business.estimated_subject_count),
  );
  const projectManager = firstValue(latest.projectManager, latest.project_manager, requirementConfig.projectManager, supplements.projectManager, business.project_manager, task.config?.projectManager);
  const interfaceBackground = firstValue(latest.interfaceBackground, latest.interface_background, supplements.interfaceBackground, task.config?.interfaceBackground, "ATA通用模板");
  const loginMethod = firstValue(latest.loginMethod, latest.login_method, supplements.loginMethod, task.config?.loginMethod, "准考证号");
  const paperLanguage = firstValue(latest.paperLanguage, latest.paper_language, supplements.paperLanguage, task.config?.paperLanguage, "简体中文");
  const systemLanguage = firstValue(latest.systemLanguage, latest.system_language, supplements.systemLanguage, task.config?.systemLanguage, "简体中文");
  const tenantName = firstValue(latest.tenantName, latest.tenant_name, supplements.tenantName, task.config?.tenantName);
  const tenantId = firstValue(latest.tenantId, latest.tenant_id, supplements.tenantId, task.config?.tenantId);
  const requirementVersion = firstValue(requirement?.latest?.version, examRequirement.version);
  const subjects = subjectRows(firstValue(latest.subjects, latest.examSubjects, requirementConfig.courses, requirementConfig.subjects, requirementFields["科目信息"], legacyBusiness.subjects));
  const examRows = contentExamRows({ task, subjects, projectName: examName, formalExamTime, trialExamTime });
  const historyCount = Array.isArray(task.config?.contentRequirementEmail?.history)
    ? task.config.contentRequirementEmail.history.length
    : 0;
  const sendCount = historyCount || (contentEmailHasSent(task) ? 1 : 0);
  const normalizedContentUpdate = sendCount ? text(contentUpdate) : "";
  const title = `${projectManager ? `${projectManager}_` : ""}${batchName || projectName || task.taskId || "未命名项目"}、内容任务单`;
  const basicInfo = [
    ["项目编码", projectCode],
    ["项目名称", projectName],
    ["需求版本", requirementVersion],
    ["批次代码", batchCode],
    ["批次名称", batchName],
    ["系统类型", systemType],
    ["考试开始日期", examStartDate],
    ["考试结束日期", examEndDate],
    ["考试名称", examName],
    ["界面背景", interfaceBackground],
    ["登录方式", loginMethod],
    ["单科最大科次", maxSubjectCount],
    ["试卷使用语言", paperLanguage],
    ["操作系统语言", systemLanguage],
    ["封场或试考开始时间", firstValue(trialRange.start, latest.mockStartTimeDisplay, requirementConfig.mockStartTimeDisplay)],
    ["封场或试考结束时间", firstValue(trialRange.end, latest.mockEndTimeDisplay, requirementConfig.mockEndTimeDisplay)],
    ["租户名称", tenantName],
    ["租户ID", tenantId],
  ];
  const subjectText = examRows.map((item) => [
    display(item.examName),
    display(item.time),
    display(item.subject),
    display(item.duration),
    display(item.remark),
  ].join("  ")).join("\n");
  const lines = [
    "内容任务单",
    "",
    `发送记录：${sendCount ? "再次发送" : "首次发送"}`,
    ...(sendCount ? [`内容更新：${display(normalizedContentUpdate)}`] : []),
    `客户名称：${display(customerName)}`,
    `项目经理：${display(projectManager)}`,
    "",
    "基本信息",
    ...basicInfo.map(([label, value]) => `${label}：${display(value)}`),
    "",
    "科目信息",
    "考试名称  考试时间  科目名称  时长（分钟）  备注",
    subjectText,
    "",
    "系统自动发送，请勿回复本邮件，有问题请联系项目经理。",
  ];
  const subjectHtml = examRows.map((item) => `<tr><td>${escapeHtml(display(item.examName))}</td><td>${escapeHtml(display(item.time))}</td><td>${escapeHtml(display(item.subject))}</td><td>${escapeHtml(display(item.duration))}</td><td>${escapeHtml(display(item.remark))}</td></tr>`).join("");
  const updateHtml = normalizedContentUpdate
    ? `<div class="update"><strong>内容更新：</strong><div>${escapeHtml(normalizedContentUpdate).replaceAll("\n", "<br>")}</div></div>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#f5f7fb;color:#1f2937;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.mail{max-width:1100px;margin:0 auto;background:#fff;border:1px solid #d9e2ef}.head{padding:22px 28px;background:#1867b7;color:#fff}.head h1{margin:0;font-size:22px}.section{padding:20px 28px 0}.section h2{margin:0 0 10px;font-size:17px;color:#1d3656}.update{margin:10px 0 14px;padding:12px 14px;border-left:4px solid #d78b00;background:#fff8e8}.update strong{display:block;margin-bottom:4px;color:#7a4b00}table{width:100%;border-collapse:collapse}th,td{padding:9px 10px;border:1px solid #d9e2ef;text-align:left;vertical-align:top}th{width:34%;background:#f3f7fc;font-weight:600}.subject th{width:auto}.foot{margin-top:20px;padding:16px 28px;background:#f3f7fc;color:#607086;font-size:12px}</style></head><body><main class="mail"><header class="head"><h1>内容任务单</h1></header><section class="section"><p>发送记录：${sendCount ? "再次发送" : "首次发送"}</p>${updateHtml}<p>客户名称：${escapeHtml(display(customerName))}<br>项目经理：${escapeHtml(display(projectManager))}</p><h2>基本信息</h2><table>${renderInfoRows(basicInfo)}</table></section><section class="section"><h2>科目信息</h2><table class="subject"><thead><tr><th>考试名称</th><th>考试时间</th><th>科目名称</th><th>时长（分钟）</th><th>备注</th></tr></thead><tbody>${subjectHtml}</tbody></table></section><footer class="foot">系统自动发送，请勿回复本邮件，有问题请联系项目经理。</footer></main></body></html>`;
  return {
    subject: title,
    text: lines.join("\n"),
    html,
    contentSnapshot: contentSnapshot({ subject: title, customerName, projectManager, basicInfo, examRows }),
  };
}

export function contentRequirementEmailPreview({ task = {}, requirement = {} } = {}) {
  const history = Array.isArray(task.config?.contentRequirementEmail?.history)
    ? task.config.contentRequirementEmail.history
    : [];
  const currentSnapshot = buildContentRequirementEmail({ task, requirement }).contentSnapshot;
  const hasSent = contentEmailHasSent(task);
  if (!hasSent) return { isResend: false, sendCount: 0, suggestedUpdate: "", currentSnapshot };
  const baseline = contentEmailLatestSnapshot(task);
  const changes = baseline ? diffContentRequirementEmailSnapshots(baseline, currentSnapshot) : [];
  return {
    isResend: true,
    sendCount: history.length || 1,
    suggestedUpdate: baseline
      ? (changes.length ? changes.join("\n") : "与上次发送内容一致")
      : fallbackContentUpdateFromHistory(task),
    currentSnapshot,
    baselineAvailable: Boolean(baseline),
  };
}

export function contentRequirementEmailFingerprint({ task = {}, requirement = {} } = {}) {
  const stableTask = {
    ...task,
    config: {
      ...(task.config || {}),
      contentRequirementEmail: {
        ...(task.config?.contentRequirementEmail || {}),
        history: [],
      },
    },
  };
  const message = buildContentRequirementEmail({ task: stableTask, requirement });
  const operationalText = message.text
    .replace(/^发送记录：.*$/m, "")
    .replace(/^内容更新：.*$/m, "")
    .replace(/^需求版本：.*$/m, "");
  return createHash("sha256").update(`${message.subject}\n${operationalText}`).digest("hex");
}

export async function sendContentRequirementEmail({
  task = {},
  requirement = {},
  recipients,
  ccRecipients,
  contentUpdate,
  emailSettings,
  sendMail = sendSmtpMail,
} = {}) {
  const to = parseEmailRecipients(recipients);
  if (!to.length) throw new Error("请填写收件人");
  const cc = parseEmailRecipients(ccRecipients).filter((email) => !to.includes(email));
  const settings = normalizeEmailSettings(emailSettings);
  if (!settings.fromEmail) throw new Error("请先配置发件邮箱");
  if (!settings.username) throw new Error("请先配置 SMTP 用户名");
  if (!settings.password) throw new Error("请先配置 SMTP 密码或应用密码");
  const message = buildContentRequirementEmail({ task, requirement, contentUpdate });
  const sendHistory = Array.isArray(task.config?.contentRequirementEmail?.history)
    ? task.config.contentRequirementEmail.history
    : [];
  const previousSendCount = Math.max(
    sendHistory.length,
    ...sendHistory.map((item) => Number(item?.sendNumber || 0)).filter(Number.isFinite),
    contentEmailHasSent(task) ? 1 : 0,
  );
  const sent = await sendMail({
    settings,
    from: { email: settings.fromEmail, name: settings.fromName },
    to,
    cc,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return {
    sentAt: new Date().toISOString(),
    recipients: to,
    cc,
    subject: message.subject,
    messageId: sent?.messageId || "",
    sourceFingerprint: contentRequirementEmailFingerprint({ task, requirement }),
    sendType: contentEmailHasSent(task) ? "再次发送" : "首次发送",
    sendNumber: previousSendCount + 1,
    contentUpdate: contentEmailHasSent(task) ? text(contentUpdate) : "",
    contentSnapshot: message.contentSnapshot,
  };
}
