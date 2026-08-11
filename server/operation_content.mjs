import { createHash } from "node:crypto";

function text(value) {
  return String(value ?? "").trim();
}

function compact(value) {
  return text(value).replace(/\s+/g, "");
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function splitOptions(value) {
  return unique(Array.isArray(value) ? value : text(value).split(/[、,，;；]+/));
}

function yesNo(value) {
  const normalized = compact(value);
  if (["是", "需要", "需要安排", "需要ATA安排"].some((item) => normalized === compact(item))) return "是";
  if (["否", "不需要", "无需", "不需要安排"].some((item) => normalized === compact(item))) return "否";
  return text(value);
}

function dateTimeParts(value) {
  const normalized = text(value);
  const matches = [...normalized.matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/g)];
  const format = (match, fallbackTime = "") => {
    if (!match) return "";
    const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    const time = match[4] === undefined
      ? fallbackTime
      : `${match[4].padStart(2, "0")}:${match[5]}:${String(match[6] || "00").padStart(2, "0")}`;
    return time ? `${date} ${time}` : date;
  };
  if (matches.length >= 2) return { start: format(matches[0]), end: format(matches[1]) };
  if (matches.length === 1) {
    const trailing = normalized.slice((matches[0].index || 0) + matches[0][0].length)
      .match(/(?:-|至|到|~)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const endTime = trailing
      ? `${trailing[1].padStart(2, "0")}:${trailing[2]}:${String(trailing[3] || "00").padStart(2, "0")}`
      : "";
    return { start: format(matches[0]), end: endTime ? format(matches[0], endTime) : "" };
  }
  return { start: "", end: "" };
}

function durationMinutes(start, end) {
  const startAt = new Date(text(start).replace(" ", "T")).getTime();
  const endAt = new Date(text(end).replace(" ", "T")).getTime();
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return "";
  return String(Math.round((endAt - startAt) / 60_000));
}

function canonicalDateTime(value) {
  const parsed = dateTimeParts(value).start;
  return text(parsed || value).replace(/:\d{2}$/, "");
}

function canonicalBatchDetailUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const batchGuid = text(url.searchParams.get("batch_guid"));
    if (!batchGuid) return raw;
    return `${url.origin}${url.pathname}?batch_guid=${encodeURIComponent(batchGuid)}`;
  } catch {
    return raw;
  }
}

function operationRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
}

function requirementRange(requirement = {}, fallback = {}) {
  const fields = requirement.fields || {};
  const config = requirement.config || {};
  const explicit = dateTimeParts(fields["考试日期时间"]);
  if (explicit.start && explicit.end) return explicit;
  const start = text(config.startTimeDisplay || config.startTimeIso || fallback.start);
  const end = text(config.endTimeDisplay || config.endTimeIso || fallback.end);
  const combined = dateTimeParts(`${start}-${end}`);
  return combined.start && combined.end ? combined : { start, end };
}

function operationClosureRange(task = {}, requirements = []) {
  const ranges = requirements.map((requirement) => requirementRange(requirement, {
    start: task.config?.startTimeDisplay || task.config?.startTimeIso,
    end: task.config?.endTimeDisplay || task.config?.endTimeIso,
  })).filter((range) => range.start && range.end);
  if (!ranges.length) return { start: "", end: "" };
  return {
    start: ranges.map((range) => range.start).sort()[0],
    end: ranges.map((range) => range.end).sort().at(-1),
  };
}

function requirementCourses(requirement = {}, task = {}) {
  const config = requirement.config || {};
  const configured = Array.isArray(config.courses) && config.courses.length
    ? config.courses
    : Array.isArray(task.config?.courses) ? task.config.courses : [];
  if (configured.length) {
    return configured.map((course) => typeof course === "object" && course !== null
      ? {
          name: text(course.name || course.courseName || course.subjectName),
          code: text(course.code || course.course_code),
          duration: text(course.durationMinutes || course.duration || course.minutes || course["时长（分钟）"]),
        }
      : { name: text(course), code: "", duration: "" }).filter((course) => course.name);
  }
  return splitOptions(requirement.fields?.["科目信息"] || config.subjects || task.config?.subjects)
    .map((name) => ({ name, code: "", duration: "" }));
}

function opaDurationForSubject(subjectName, business = {}) {
  if (!/OPA/i.test(text(subjectName))) return "";
  const durations = unique((Array.isArray(business.opa_rows) ? business.opa_rows : [])
    .map((row) => row?.["时长（分钟）"] || row?.duration || row?.durationMinutes));
  return durations.length === 1 ? durations[0] : "";
}

function subjectRemark(task = {}, requirement = {}, requirementIndex = 0, course = {}) {
  const remarks = task.config?.contentTaskRemarks || {};
  const saved = Object.hasOwn(remarks, `formal:${requirementIndex}`)
    ? text(remarks[`formal:${requirementIndex}`])
    : "";
  const tenantId = text(requirement.config?.tenantId || task.config?.tenantId);
  const base = saved || (tenantId ? `租户 ID：${tenantId}` : text(requirement.fields?.["备注"] || requirement.config?.remark));
  if (!course.code || base.includes(course.code)) return base;
  return [base, `科目编号：${course.name ? `${course.name}（${course.code}）` : course.code}`].filter(Boolean).join("；");
}

function operationSubjects(task = {}, requirements = [], business = {}) {
  const rows = [];
  requirements.forEach((requirement, requirementIndex) => {
    const range = requirementRange(requirement, {
      start: task.config?.startTimeDisplay || task.config?.startTimeIso,
      end: task.config?.endTimeDisplay || task.config?.endTimeIso,
    });
    const fallbackDuration = durationMinutes(range.start, range.end);
    for (const course of requirementCourses(requirement, task)) {
      rows.push({
        name: course.name,
        durationMinutes: text(course.duration || opaDurationForSubject(course.name, business) || fallbackDuration),
        remark: subjectRemark(task, requirement, requirementIndex, course),
      });
    }
  });
  return Array.from(new Map(rows.map((row) => [`${row.name}\n${row.durationMinutes}\n${row.remark}`, row])).values());
}

function maximumSubjectCount(task = {}, business = {}) {
  const formalCounts = (Array.isArray(task.sessions) ? task.sessions : [])
    .filter((session) => text(session.sessionType || session.session_type) === "formal")
    .map((session) => Number(session.candidateCount || session.candidate_count || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (formalCounts.length) return String(Math.max(...formalCounts));
  const draftValue = task.config?.operationBatch?.draft?.fields?.estimatedMaxSubjectCount?.value;
  return text(draftValue || business.estimated_subject_count || task.config?.candidateCount);
}

function operationBatchName(task = {}) {
  return text(
    task.config?.operationBatch?.batchName
    || task.config?.operationBatch?.draft?.fields?.batchName?.value
    || task.config?.businessRequirement?.batch_name,
  );
}

export function normalizeOperationContentSnapshot(value = {}) {
  const configuration = value.configuration || {};
  return {
    batch: {
      code: text(value.batch?.code || value.batchCode),
      name: text(value.batch?.name || value.batchName),
      detailUrl: canonicalBatchDetailUrl(value.batch?.detailUrl || value.detailUrl),
    },
    configuration: {
      background: text(configuration.background),
      loginMode: text(configuration.loginMode),
      itemTypes: unique(configuration.itemTypes || []),
      contentSources: unique(configuration.contentSources || []),
      closePaper: text(configuration.closePaper),
      reviewPaper: text(configuration.reviewPaper),
      singleMaxSubjects: text(configuration.singleMaxSubjects),
      paperLanguages: unique(configuration.paperLanguages || []),
      osLanguages: unique(configuration.osLanguages || []),
      closureStart: canonicalDateTime(configuration.closureStart),
      closureEnd: canonicalDateTime(configuration.closureEnd),
    },
    subjects: (Array.isArray(value.subjects) ? value.subjects : []).map((subject) => ({
      name: text(subject.name),
      durationMinutes: text(subject.durationMinutes),
      remark: text(subject.remark),
    })),
  };
}

export function operationContentFingerprint(value = {}) {
  return fingerprint(normalizeOperationContentSnapshot(value));
}

export function buildOperationContentDraft(task = {}) {
  const business = task.config?.businessRequirement || {};
  const requirements = operationRequirements(task);
  const closure = operationClosureRange(task, requirements);
  const snapshot = normalizeOperationContentSnapshot({
    batch: {
      code: task.config?.operationBatchCode || task.config?.operationBatch?.code,
      name: operationBatchName(task),
      detailUrl: task.config?.operationBatch?.detailUrl,
    },
    configuration: {
      background: task.config?.interfaceBackground || "ATA通用模板",
      loginMode: task.config?.loginMethod || "准考证号",
      itemTypes: splitOptions(business.question_types),
      contentSources: splitOptions(business.content_source),
      closePaper: yesNo(business.closed_item_writing_required),
      reviewPaper: yesNo(business.manual_marking_required),
      singleMaxSubjects: maximumSubjectCount(task, business),
      paperLanguages: splitOptions(task.config?.paperLanguage || "简体中文"),
      osLanguages: splitOptions(task.config?.systemLanguage || "简体中文"),
      closureStart: closure.start,
      closureEnd: closure.end,
    },
    subjects: operationSubjects(task, requirements, business),
  });
  const warnings = [];
  const required = [
    ["batch.code", snapshot.batch.code, "缺少运营批次代码"],
    ["batch.name", snapshot.batch.name, "缺少运营批次名称"],
    ["batch.detailUrl", snapshot.batch.detailUrl, "缺少运营批次详情地址"],
    ["configuration.itemTypes", snapshot.configuration.itemTypes.length, "缺少试题类型"],
    ["configuration.contentSources", snapshot.configuration.contentSources.length, "缺少内容来源"],
    ["configuration.closePaper", snapshot.configuration.closePaper, "缺少封闭制题配置"],
    ["configuration.reviewPaper", snapshot.configuration.reviewPaper, "缺少人工阅卷配置"],
    ["configuration.singleMaxSubjects", snapshot.configuration.singleMaxSubjects, "缺少单科最大科次"],
    ["configuration.closureStart", snapshot.configuration.closureStart, "缺少内容任务考试开始时间"],
    ["configuration.closureEnd", snapshot.configuration.closureEnd, "缺少内容任务考试结束时间"],
    ["subjects", snapshot.subjects.length, "缺少科目信息"],
  ];
  for (const [field, value, message] of required) {
    if (!value) warnings.push({ field, message });
  }
  snapshot.subjects.forEach((subject, index) => {
    if (!subject.name) warnings.push({ field: `subjects[${index}].name`, message: `科目 ${index + 1} 缺少名称` });
    if (!subject.durationMinutes) warnings.push({ field: `subjects[${index}].durationMinutes`, message: `科目 ${subject.name || index + 1} 缺少时长` });
  });
  return {
    ...snapshot,
    warnings,
    fingerprint: operationContentFingerprint(snapshot),
  };
}

export function assertOperationContentSyncResult(draft = {}, result = {}) {
  if (result?.status !== "success" || result?.verified !== true || !result?.snapshot) {
    const error = new Error(result?.errorMessage || "运营内容同步未通过回读验证");
    error.code = text(result?.errorCode) || "OPERATION_CONTENT_SYNC_UNVERIFIED";
    error.status = 409;
    throw error;
  }
  const expected = normalizeOperationContentSnapshot(draft);
  const actual = normalizeOperationContentSnapshot(result.snapshot);
  if (operationContentFingerprint(expected) !== operationContentFingerprint(actual)) {
    const error = new Error("运营内容同步回读结果与内容任务不一致");
    error.code = "OPERATION_CONTENT_SYNC_MISMATCH";
    error.status = 409;
    error.expected = expected;
    error.actual = actual;
    throw error;
  }
  return actual;
}
