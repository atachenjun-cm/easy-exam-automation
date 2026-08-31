import { createHash, randomUUID } from "node:crypto";
import { operationBatchCodeIsValid } from "./operation_batch.mjs";

const SCHEMA_VERSION = 1;
const PERSONNEL_CC_GROUPS = Object.freeze(["考站管理&质量控制部", "结算组"]);
const EDITABLE_PERSONNEL_REQUIREMENT_NAMES = [
  "正式考试-最早登录系统时间",
  "正式考试-监考人员安排",
  "正式考试-监考人员数量",
  "正式考试-监考人员比例",
];

function text(value) {
  return String(value ?? "").trim();
}

function confirmedTruthy(value) {
  return value === true || ["是", "需要", "true", "1"].includes(text(value).toLowerCase());
}

function operationPersonnelTaskAlreadySent(task = {}) {
  const state = task.config?.operationPersonnelTask || {};
  return Boolean(
    state.status === "sent"
    || state.lastSuccessfulFingerprint
    || state.initialSendVerification?.status === "verified"
    || (Array.isArray(state.sendHistory) && state.sendHistory.length > 0)
  );
}

function taskRequirements(task) {
  const items = task.config?.examRequirements;
  return Array.isArray(items) && items.length
    ? items
    : (task.config?.examRequirement?.fields ? [task.config.examRequirement] : []);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assignScheduleCodes(entries, previousMap = {}) {
  const used = Object.values(previousMap).map((item) => Number(item.scheduleCode || 0));
  let nextCode = Math.max(0, ...used) + 1;
  const scheduleCodeMap = { ...previousMap };
  const schedules = entries.map((entry) => {
    const previous = scheduleCodeMap[entry.scheduleEntryId];
    const scheduleCode = Number(previous?.scheduleCode || entry.previousScheduleCode || nextCode++);
    scheduleCodeMap[entry.scheduleEntryId] = {
      scheduleEntryId: entry.scheduleEntryId,
      scheduleCode,
      subjectKey: entry.subjectKey,
      requirementId: entry.requirementId,
      sessionType: entry.sessionType,
      courseIndex: entry.courseIndex,
    };
    const { previousScheduleCode, ...schedule } = entry;
    return { ...schedule, scheduleCode };
  });
  return { schedules, scheduleCodeMap };
}

function dateValue(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function canonicalPersonnelScheduleDateTime(value) {
  const raw = text(value);
  const match = raw.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return raw;
  const [, year, month, day, hour, minute, second = ""] = match;
  const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}`;
  return second && second !== "00" ? `${normalized}:${second}` : normalized;
}

function normalizedPersonnelSchedule(item = {}) {
  return {
    ...structuredClone(item || {}),
    start: canonicalPersonnelScheduleDateTime(item?.start),
    end: canonicalPersonnelScheduleDateTime(item?.end),
  };
}

function formatShanghaiDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysBefore(dateText, days) {
  const parsed = dateValue(dateText);
  if (!Number.isFinite(parsed)) return "";
  return formatShanghaiDate(parsed - days * 24 * 60 * 60 * 1000);
}

function simultaneousCountPeak(sessions, countForSession) {
  const events = sessions.flatMap((session) => {
    const start = dateValue(session.start);
    const end = dateValue(session.end);
    const count = Number(countForSession(session) || 0);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && count > 0
      ? [{ at: start, delta: count }, { at: end, delta: -count }]
      : [];
  }).sort((left, right) => left.at - right.at || left.delta - right.delta);
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

function formalRoomAssignment(task = {}) {
  const formalSessions = (Array.isArray(task.sessions) ? task.sessions : [])
    .filter((session) => text(session.sessionType || session.session_type) === "formal");
  const assigned = formalSessions.filter((session) => (
    Number.isSafeInteger(Number(session.roomCount || session.room_count))
    && Number(session.roomCount || session.room_count) > 0
    && Number.isSafeInteger(Number(session.candidateCount || session.candidate_count))
    && Number(session.candidateCount || session.candidate_count) > 0
  ));
  if (!formalSessions.length || assigned.length !== formalSessions.length) {
    return { complete: false, monitorCount: "", roomSize: "" };
  }
  const roomSize = Math.max(...assigned.map((session) => Math.ceil(
    Number(session.candidateCount || session.candidate_count)
      / Number(session.roomCount || session.room_count),
  )));
  const concurrent = simultaneousCountPeak(
    assigned,
    (session) => session.roomCount || session.room_count,
  );
  const monitorCount = concurrent || Math.max(
    ...assigned.map((session) => Number(session.roomCount || session.room_count)),
  );
  return { complete: monitorCount > 0 && roomSize > 0, monitorCount, roomSize };
}

function includesTrialMonitoring(task, requirement) {
  return requirement?.config?.trialMonitoringRequired === true
    || task.config?.trialMonitoringRequired === true
    || [requirement?.fields?.["试考监考"], task.config?.businessRequirement?.trial_monitoring_required]
      .some((value) => ["是", "需要", "true"].includes(text(value).toLowerCase()));
}

function scheduleRows(task, previousMap, _makeId, warnings) {
  const rows = [];
  for (const [requirementIndex, requirement] of taskRequirements(task).entries()) {
    const config = requirement.config || {};
    const sessionType = text(config.sessionType) === "trial" || config.isTrial === true ? "trial" : "formal";
    if (sessionType === "trial" && !includesTrialMonitoring(task, requirement)) continue;
    const requirementId = text(requirement.id) || `requirement-${requirementIndex + 1}`;
    const session = (Array.isArray(task.sessions) ? task.sessions : []).find((item) => (
      text(item?.sessionType || item?.session_type) === sessionType
      && Number(item?.requirementIndex || item?.requirement_index || 0) === requirementIndex
    ));
    const legacyEntry = Object.values(previousMap)
      .filter((item) => item.requirementId === requirementId && item.sessionType === sessionType)
      .sort((left, right) => Number(left.courseIndex || 0) - Number(right.courseIndex || 0))[0] || {};
    const subjectKey = "exam";
    const scheduleEntryId = `${requirementId}:${sessionType}:${subjectKey}`;
    const start = text(session?.start || session?.start_time || config.startTimeDisplay || config.start);
    const end = text(session?.end || session?.end_time || config.endTimeDisplay || config.end);
    const startAt = dateValue(start);
    const endAt = dateValue(end);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      warnings.push({ code: "INVALID_SCHEDULE_RANGE", scheduleEntryId });
    }
    rows.push({
      scheduleEntryId,
      requirementId,
      sessionType,
      subjectKey,
      courseIndex: 0,
      subjectCode: "",
      subjectName: text(session?.name || requirement.fields?.["考试名称"] || config.examName),
      start,
      end,
      earlyLoginMinutes: Number(config.earlyLoginMinutes || 0),
      previousScheduleCode: legacyEntry.scheduleCode,
    });
  }
  return rows.sort((left, right) => dateValue(left.start) - dateValue(right.start));
}

function unsupported(task) {
  const business = task.config?.businessRequirement || {};
  const service = text(business.ata_invigilator_arrangement);
  return !service.includes("分散人工监考")
    || confirmedTruthy(business.highEndSupplementRequired)
    || confirmedTruthy(business.high_end_supplement_required);
}

function sourceVersion(task) {
  const requirements = taskRequirements(task);
  return {
    requirements: requirements.map((item) => ({ id: text(item.id), version: Number(item.version || 0) })),
    fanwei: Number(task.config?.fanweiSource?.version || 0),
  };
}

export function operationPersonnelConfirmedEdits(draft = {}) {
  const dates = {};
  for (const key of ["start", "end", "nameListDue"]) {
    const value = text(draft.dates?.[key]);
    if (value) dates[key] = value;
  }
  const storedRequirements = draft.requirementOverrides
    || (!Array.isArray(draft.requirements) ? draft.requirements : {})
    || {};
  const requirements = {};
  for (const name of EDITABLE_PERSONNEL_REQUIREMENT_NAMES) {
    const value = text(storedRequirements[name]);
    if (value) requirements[name] = value;
  }
  return { dates, personnel: {}, requirements };
}

function confirmedEditsFromTask(task = {}) {
  const state = task.config?.operationPersonnelTask || {};
  if (state.confirmedEdits) {
    return operationPersonnelConfirmedEdits(state.confirmedEdits);
  }
  if (!state.lastSuccessfulFingerprint) return { dates: {}, personnel: {}, requirements: {} };
  const stored = operationPersonnelConfirmedEdits(state.draft || {});
  const successfulTarget = state.activeAttempt?.status === "sent"
    ? operationPersonnelConfirmedEdits(state.activeAttempt.target || {})
    : { dates: {}, personnel: {}, requirements: {} };
  return {
    dates: { ...stored.dates, ...successfulTarget.dates },
    personnel: { ...stored.personnel, ...successfulTarget.personnel },
    requirements: { ...stored.requirements, ...successfulTarget.requirements },
  };
}

function applyConfirmedRequirementEdits(draft, requirements = {}) {
  draft.requirementOverrides = {};
  for (const name of EDITABLE_PERSONNEL_REQUIREMENT_NAMES) {
    const value = text(requirements[name]);
    if (!value) continue;
    draft.requirementOverrides[name] = value;
    if (name === "正式考试-最早登录系统时间") {
      const minutes = value.match(/考试开始前\s*(\d+)\s*分钟/)?.[1];
      if (minutes !== undefined) draft.personnel.earliestLoginMinutes = Number(minutes);
    } else if (name === "正式考试-监考人员数量") {
      draft.personnel.monitorCount = Number(value);
    } else if (name === "正式考试-监考人员比例") {
      draft.personnel.monitorRatio = value;
      const basis = value.match(/^\d+:(\d+)$/)?.[1];
      if (basis !== undefined) draft.personnel.candidateBasis = Number(basis);
    }
  }
}

export function buildOperationPersonnelTaskDraft(task = {}, options = {}) {
  const environment = text(options.environment || task.config?.operationPersonnelTask?.environment || "test");
  const warnings = [];
  const business = task.config?.businessRequirement || {};
  const operationBatch = task.config?.operationBatch || {};
  const batchFields = operationBatch.draft?.fields || {};
  const projectDepartment = text(
    batchFields.projectDepartment?.value
    || operationBatch.projectDepartment
    || operationBatch.projectDepartmentDefault
    || business.project_department,
  );
  const projectManager = text(
    batchFields.projectManager?.value
    || operationBatch.projectManager
    || business.project_manager
    || task.config?.projectManager,
  );
  if (!projectDepartment || !projectManager) {
    warnings.push({
      code: "PERSONNEL_RECIPIENT_REQUIRED",
      message: `发送规则缺少${!projectDepartment ? "项目部归属" : ""}${!projectDepartment && !projectManager ? "、" : ""}${!projectManager ? "项目经理" : ""}`,
    });
  }
  const previousMap = options.scheduleCodeMap || task.config?.operationPersonnelTask?.scheduleCodeMap || {};
  const rows = scheduleRows(task, previousMap, options.makeId || randomUUID, warnings);
  const { schedules, scheduleCodeMap } = assignScheduleCodes(rows, previousMap);
  const formalSchedules = schedules.filter((item) => item.sessionType === "formal");
  const roomAssignment = formalRoomAssignment(task);
  if (!roomAssignment.complete) warnings.push({ code: "FORMAL_ROOM_ASSIGNMENT_REQUIRED" });
  const earliestStart = formalSchedules.map((item) => item.start).sort((left, right) => dateValue(left) - dateValue(right))[0] || "";
  const now = options.now || new Date().toISOString();
  const today = formatShanghaiDate(dateValue(now));
  const due = daysBefore(earliestStart, 3);
  const validDates = due && due >= today;
  if (!validDates) warnings.push({ code: "PERSONNEL_DATES_REQUIRED" });
  if (unsupported(task)) warnings.push({ code: "UNSUPPORTED_PERSONNEL_TASK" });
  const recipients = {
    toGroup: projectDepartment,
    toNames: projectManager ? [projectManager] : [],
    ccGroup: PERSONNEL_CC_GROUPS[0],
    ccGroups: [...PERSONNEL_CC_GROUPS],
    ccCount: 0,
    ccGroupOnly: true,
    ruleVersion: 4,
  };
  const draft = {
    schemaVersion: SCHEMA_VERSION,
    environment,
    batch: {
      code: text(task.config?.operationBatchCode || task.config?.operationBatch?.code),
      batchName: text(
        task.config?.operationBatch?.batchName
        || task.config?.operationBatch?.draft?.fields?.batchName?.value,
      ),
      operationTaskSerial: text(task.config?.businessRequirement?.operation_serial_number),
      projectCode: text(task.config?.businessRequirement?.project_code),
      projectName: text(task.config?.businessRequirement?.project_name || task.projectName),
      projectDepartment,
      projectManager,
    },
    schedules,
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: "悦站",
      loginMonitoring: "否",
      monitorRatio: roomAssignment.complete ? `1:${roomAssignment.roomSize}` : "",
      candidateBasis: roomAssignment.roomSize,
      monitorCount: roomAssignment.monitorCount,
      earliestLoginMinutes: Math.max(0, ...formalSchedules.map((item) => item.earlyLoginMinutes)),
      trialIncluded: schedules.some((item) => item.sessionType === "trial"),
    },
    dates: { start: today, end: validDates ? due : "", nameListDue: validDates ? due : "" },
    recipients,
    sourceVersion: sourceVersion(task),
    warnings,
    scheduleCodeMap,
  };
  const confirmed = confirmedEditsFromTask(task);
  draft.dates = { ...draft.dates, ...confirmed.dates };
  applyConfirmedRequirementEdits(draft, confirmed.requirements);
  const datesComplete = ["start", "end", "nameListDue"].every(
    (key) => /^\d{4}-\d{2}-\d{2}$/.test(text(draft.dates[key])),
  ) && draft.dates.start <= draft.dates.end;
  const expiredDateFields = datesComplete
    ? [
        ["end", "人员落实结束日期"],
        ["nameListDue", "人员名单提交日期"],
      ].filter(([key]) => draft.dates[key] < today).map(([, label]) => label)
    : [];
  const monitorCountComplete = Number.isSafeInteger(Number(draft.personnel.monitorCount))
    && Number(draft.personnel.monitorCount) > 0;
  draft.warnings = draft.warnings.filter((item) => (
    !(item.code === "PERSONNEL_DATES_REQUIRED" && datesComplete)
    && item.code !== "PERSONNEL_DATES_EXPIRED"
    && !(item.code === "FORMAL_ROOM_ASSIGNMENT_REQUIRED" && monitorCountComplete)
  ));
  if (expiredDateFields.length && !operationPersonnelTaskAlreadySent(task)) {
    draft.warnings.push({
      code: "PERSONNEL_DATES_EXPIRED",
      fields: expiredDateFields,
      message: `${expiredDateFields.join("、")}已过期`,
    });
  }
  return draft;
}

export function operationPersonnelTaskSnapshot(draft = {}) {
  const recipients = draft.recipients || {};
  const managedSchedules = (draft.managedSchedules || []).map(
    ({ requirementIndex, name, start, end }) => ({
      requirementIndex,
      name,
      start: canonicalPersonnelScheduleDateTime(start),
      end: canonicalPersonnelScheduleDateTime(end),
    }),
  );
  return {
    environment: draft.environment,
    batch: structuredClone(draft.batch || {}),
    schedules: (draft.schedules || []).map(normalizedPersonnelSchedule),
    managedSchedules,
    personnel: structuredClone(draft.personnel || {}),
    requirementOverrides: structuredClone(draft.requirementOverrides || {}),
    dates: structuredClone(draft.dates || {}),
    recipients: {
      ruleVersion: recipients.ruleVersion,
      toGroup: recipients.toGroup,
      toNames: recipients.toNames,
      ccGroup: recipients.ccGroup,
      ccGroups: recipients.ccGroups,
      ccCount: recipients.ccCount,
      ccGroupOnly: recipients.ccGroupOnly === true,
    },
  };
}

export function operationPersonnelTaskFingerprint(draft) {
  const material = operationPersonnelTaskSnapshot(draft);
  return createHash("sha256").update(stableJson(material)).digest("hex");
}

export function operationPersonnelTaskBaselineFingerprint(state = {}) {
  const history = Array.isArray(state.sendHistory) ? state.sendHistory : [];
  const baseline = history.at(-1)?.taskSnapshot || state.lastSentTaskSnapshot;
  return baseline
    ? operationPersonnelTaskFingerprint(baseline)
    : text(state.lastSuccessfulFingerprint);
}

function changedFields(before, after, prefix = "") {
  const fields = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      fields.push(...changedFields(left, right, path));
    } else if (stableJson(left) !== stableJson(right)) {
      fields.push({ path, before: left ?? "", after: right ?? "" });
    }
  }
  return fields;
}

const FIELD_LABELS = {
  "batch.code": "批次代码",
  "batch.name": "批次名称",
  "batch.detailUrl": "批次详情地址",
  "dates.start": "人员落实开始日期",
  "dates.end": "人员落实结束日期",
  "dates.nameListDue": "人员名单提交日期",
  "personnel.serviceType": "人员服务类型",
  "personnel.platform": "人员落实平台",
  "personnel.loginMonitoring": "监考登录监控",
  "personnel.monitorRatio": "监考比例",
  "personnel.candidateBasis": "正式考试每班人数",
  "personnel.monitorCount": "监考人数",
  "personnel.earliestLoginMinutes": "最早登录系统时间",
  "personnel.trialIncluded": "是否包含试考",
  "requirementOverrides.正式考试-最早登录系统时间": "正式考试-最早登录系统时间",
  "requirementOverrides.正式考试-监考人员安排": "正式考试-监考人员安排",
  "requirementOverrides.正式考试-监考人员数量": "正式考试-监考人员数量",
  "requirementOverrides.正式考试-监考人员比例": "正式考试-监考人员比例",
  "recipients.ruleVersion": "收件规则版本",
  "recipients.toGroup": "收件人分组",
  "recipients.toNames": "收件人",
  "recipients.ccGroup": "抄送分组",
  "recipients.ccGroups": "抄送分组",
  "recipients.ccCount": "抄送人数",
  "recipients.ccGroupOnly": "仅使用抄送分组",
};

function personnelDiffDisplay(value) {
  if (Array.isArray(value)) return value.map(personnelDiffDisplay).join("、") || "空";
  if (value && typeof value === "object") return stableJson(value);
  if (value === true) return "是";
  if (value === false) return "否";
  return text(value) || "空";
}

function personnelScheduleDisplay(item = {}) {
  const name = text(item.subjectName || item.name) || "未命名考试";
  const range = [text(item.start), text(item.end)].filter(Boolean).join(" 至 ");
  return range ? `${name}（${range}）` : name;
}

export function diffOperationPersonnelTaskDrafts(before = {}, after = {}) {
  const normalizedBefore = operationPersonnelTaskSnapshot(before);
  const normalizedAfter = operationPersonnelTaskSnapshot(after);
  const beforeById = new Map(normalizedBefore.schedules.map((item) => [item.scheduleEntryId, item]));
  const afterById = new Map(normalizedAfter.schedules.map((item) => [item.scheduleEntryId, item]));
  const added = [...afterById].filter(([id]) => !beforeById.has(id)).map(([, item]) => item);
  const deleted = [...beforeById].filter(([id]) => !afterById.has(id)).map(([, item]) => item);
  const changed = [...afterById].filter(([id, item]) => beforeById.has(id) && stableJson(beforeById.get(id)) !== stableJson(item))
    .map(([id, item]) => ({ before: beforeById.get(id), after: item }));
  const fields = [
    ...changedFields(normalizedBefore.batch, normalizedAfter.batch, "batch"),
    ...changedFields(normalizedBefore.dates, normalizedAfter.dates, "dates"),
    ...changedFields(normalizedBefore.personnel, normalizedAfter.personnel, "personnel"),
    ...changedFields(normalizedBefore.requirementOverrides, normalizedAfter.requirementOverrides, "requirementOverrides"),
    ...changedFields(normalizedBefore.recipients, normalizedAfter.recipients, "recipients"),
    ...(stableJson(normalizedBefore.managedSchedules) === stableJson(normalizedAfter.managedSchedules)
      ? []
      : [{
          path: "managedSchedules",
          before: normalizedBefore.managedSchedules,
          after: normalizedAfter.managedSchedules,
        }]),
  ];
  const parts = [];
  for (const item of added) parts.push(`新增考试日程：${personnelScheduleDisplay(item)}`);
  for (const item of changed) {
    parts.push(`修改考试日程：由“${personnelScheduleDisplay(item.before)}”调整为“${personnelScheduleDisplay(item.after)}”`);
  }
  for (const item of deleted) parts.push(`删除考试日程：${personnelScheduleDisplay(item)}`);
  for (const field of fields) {
    if (field.path === "managedSchedules") {
      parts.push("批次受管日程：已更新");
    } else {
      parts.push(`${FIELD_LABELS[field.path] || field.path}：由“${personnelDiffDisplay(field.before)}”调整为“${personnelDiffDisplay(field.after)}”`);
    }
  }
  return { schedules: { added, changed, deleted }, fields, summary: parts.join("；") };
}

export function buildOperationPersonnelTaskStatus(task = {}, draft = {}) {
  const state = task.config?.operationPersonnelTask || {};
  const persistent = text(state.status);
  const actions = (id, label) => [{ id, label }];
  if ((draft.warnings || []).some((item) => item.code === "INVALID_RECIPIENT_ENVIRONMENT")) return { status: "unsupported", actions: [] };
  if (["operation_conflict", "result_unknown", "failed_resumable"].includes(persistent)) {
    return {
      status: persistent,
      actions: persistent === "result_unknown" ? actions("recheck", "重新核对发送记录") : actions("resume", persistent === "failed_resumable" ? "继续未完成流程" : "检查并发送人员任务单"),
    };
  }
  if (!operationBatchCodeIsValid(draft.batch?.code)) return { status: "waiting_batch", actions: [] };
  const fingerprint = operationPersonnelTaskFingerprint(draft);
  const baselineFingerprint = operationPersonnelTaskBaselineFingerprint(state);
  if (baselineFingerprint && baselineFingerprint === fingerprint) {
    return { status: "sent", actions: actions("preview_adjust", "调整人员任务并重新发送") };
  }
  if (baselineFingerprint) return { status: "changes_pending", actions: actions("preview_resend", "检查变更并重新发送") };
  if (persistent === "changes_pending") return { status: "changes_pending", actions: actions("preview_resend", "检查变更并重新发送") };
  if (persistent === "sent") {
    return { status: "sent", actions: actions("preview_adjust", "调整人员任务并重新发送") };
  }
  if ((draft.warnings || []).some((item) => item.code === "UNSUPPORTED_PERSONNEL_TASK")) return { status: "unsupported", actions: [] };
  if (state.pendingChange === true || task.config?.pendingChange === true) return { status: "blocked_pending_change", actions: [] };
  if ((draft.warnings || []).length) return { status: "needs_review", actions: actions("preview", "检查并发送人员任务单") };
  return { status: "ready", actions: actions("preview", "检查并发送人员任务单") };
}
