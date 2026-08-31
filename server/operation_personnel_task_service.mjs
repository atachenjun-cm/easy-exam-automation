import { createHash, randomUUID } from "node:crypto";

import {
  buildOperationPersonnelTaskDraft,
  buildOperationPersonnelTaskStatus,
  diffOperationPersonnelTaskDrafts,
  operationPersonnelConfirmedEdits,
  operationPersonnelTaskBaselineFingerprint,
  operationPersonnelTaskFingerprint,
  operationPersonnelTaskSnapshot,
} from "./operation_personnel_task.mjs";
import {
  normalizeOperationPersonnelSnapshot,
  operationPersonnelConflictBaseline,
  operationPersonnelConflicts,
  operationPersonnelDisplaySchedules,
  operationPersonnelResumeBaseline,
} from "./operation_personnel_task_runner.mjs";
import { operationPersonnelScheduleGate } from "./operation_personnel_schedule_gate.mjs";

const VALID_ENVIRONMENTS = new Set(["test", "production"]);
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const CHANGE_SUMMARY_MAX_LENGTH = 4000;
const ACTIVE_ATTEMPT_STATUSES = new Set(["queued", "running"]);
const RECOVERY_STATUSES = new Set(["operation_conflict", "result_unknown", "failed_resumable"]);
const PENDING_REQUIREMENT_STATUSES = new Set(["pending_internal_review", "pending_review"]);

function text(value) {
  return String(value ?? "").trim();
}

export function operationPersonnelFailedResumeConflictBaseline(current = {}, previous = {}) {
  const baseline = structuredClone(current || {});
  for (const key of ["personnel", "dates", "requirements"]) {
    if (previous?.[key] !== undefined) baseline[key] = structuredClone(previous[key]);
  }
  return baseline;
}

export function operationPersonnelFailedResumeObservedBaseline(state = {}) {
  return structuredClone(
    state.checkpoints?.inspect_batch?.readback
    || state.activeAttempt?.baseline
    || state.activeAttempt?.target
    || {},
  );
}

function serviceError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function operationPersonnelChangeSummary(value) {
  const summary = text(value);
  if (summary.length > CHANGE_SUMMARY_MAX_LENGTH) {
    throw serviceError(
      "PERSONNEL_CHANGE_SUMMARY_TOO_LONG",
      400,
      `人员任务单变更内容不能超过 ${CHANGE_SUMMARY_MAX_LENGTH} 个字符`,
    );
  }
  return summary;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function completedPreviewInspectionCheckpoint(kind, baseline, snapshot, completedAt) {
  return {
    name: "inspect_batch",
    status: "completed",
    completedAt,
    targetDigest: createHash("sha256")
      .update(JSON.stringify({ kind, baseline }))
      .digest("hex"),
    readback: structuredClone(snapshot),
  };
}

function draftSourceFingerprint(draft = {}) {
  return fingerprint(draft);
}

function managedScheduleProjection(items = []) {
  return items.map(({ requirementIndex, name, start, end }) => ({
    requirementIndex,
    name,
    start,
    end,
  }));
}

export function operationPersonnelManagedSchedules(draft = {}, managedSchedules = []) {
  const managed = managedScheduleProjection(managedSchedules);
  if (managed.length) return managed;
  return (draft.schedules || []).map((schedule, requirementIndex) => ({
    requirementIndex,
    name: text(schedule.subjectName || schedule.name),
    start: text(schedule.start),
    end: text(schedule.end),
  }));
}

function requireManagedSchedules(task) {
  const result = operationPersonnelScheduleGate(task);
  if (!result.ok) throw serviceError(result.code, 409, result.message);
  return result;
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function shanghaiDateKey(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function operationPersonnelExpiredDateLabels(draft = {}, nowValue = Date.now()) {
  const dates = draft.dates || {};
  const today = shanghaiDateKey(nowValue);
  return [
    ["人员落实结束日期", text(dates.end)],
    ["人员名单提交日期", text(dates.nameListDue)],
  ].filter(([, value]) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value < today)
    .map(([label]) => label);
}

function requirementRequestId(task = {}) {
  return [
    task.config?.requirementRequestId,
    task.config?.initialRequirementRequestId,
    task.config?.businessRequirement?.requirementRequestId,
  ].map(text).find(Boolean) || "";
}

function requirementVersion(task = {}, requirement = {}) {
  const multiple = (task.config?.examRequirements || []).map((item) => ({
    id: text(item?.id),
    version: Number(item?.version || 0),
  }));
  if (multiple.length) return stableJson(multiple);
  const singular = Number(task.config?.examRequirement?.version);
  if (Number.isFinite(singular)) return singular;
  const external = Number(requirement?.version);
  return Number.isFinite(external) ? external : 0;
}

function hasPendingRequirementChange(requirement = {}) {
  return (requirement?.changeRequests || []).some((item) => (
    PENDING_REQUIREMENT_STATUSES.has(text(item?.status))
  ));
}

function canAccess(task, actor = {}) {
  if (!actor?.role || actor.role === "admin") return true;
  return Boolean(text(task?.ownerEmail))
    && text(task.ownerEmail).toLowerCase() === text(actor.email).toLowerCase();
}

function assertTask(task, actor) {
  if (!task || !canAccess(task, actor)) {
    throw serviceError("PERSONNEL_TASK_NOT_FOUND", 404, "人员任务不存在");
  }
  return task;
}

function assertEnvironment(environment) {
  if (!VALID_ENVIRONMENTS.has(environment)) {
    throw serviceError(
      "PERSONNEL_ENVIRONMENT_INVALID",
      409,
      `未知运控收件环境：${environment || "空"}`,
    );
  }
}

function stateDefaults(environment, draft = {}) {
  return {
    schemaVersion: 1,
    environment,
    status: "ready",
    draft,
    draftVersion: 1,
    sourceFingerprint: draft && Object.keys(draft).length
      ? draftSourceFingerprint(draft)
      : "",
    lastSuccessfulFingerprint: "",
    scheduleCodeMap: draft.scheduleCodeMap || {},
    lastOperationSnapshot: null,
    checkpoints: {},
    activePreview: null,
    activeAttempt: null,
    sendHistory: [],
    initialSendVerification: null,
    changeSummary: "",
    events: [],
  };
}

function normalizedState(task, environment, draft = null) {
  const existing = task?.config?.operationPersonnelTask || {};
  const generated = draft || existing.draft || {};
  const activeAttempt = existing.activeAttempt
    ? structuredClone(existing.activeAttempt)
    : null;
  if (activeAttempt?.status === "sent") activeAttempt.error = null;
  const recoveredStatus = RECOVERY_STATUSES.has(activeAttempt?.status)
    ? activeAttempt.status
    : existing.status;
  return {
    ...stateDefaults(environment, generated),
    ...structuredClone(existing),
    status: recoveredStatus,
    environment,
    draft: structuredClone(existing.draft || generated),
    // scheduleCodeMap is deserialized only for compatibility with historical drafts.
    scheduleCodeMap: structuredClone(existing.scheduleCodeMap || generated.scheduleCodeMap || {}),
    checkpoints: structuredClone(existing.checkpoints || {}),
    activePreview: existing.activePreview ? structuredClone(existing.activePreview) : null,
    activeAttempt,
    sendHistory: structuredClone(existing.sendHistory || []),
    events: structuredClone(existing.events || []),
  };
}

function operationPersonnelStateHasSent(state = {}) {
  return Boolean(
    state.status === "sent"
    || state.lastSuccessfulFingerprint
    || state.initialSendVerification?.status === "verified"
    || (Array.isArray(state.sendHistory) && state.sendHistory.length > 0)
  );
}

function ignoreHistoricalExpiredDateWarning(draft = {}, ignore = false) {
  if (ignore) {
    draft.warnings = (draft.warnings || []).filter(
      (item) => item.code !== "PERSONNEL_DATES_EXPIRED",
    );
  }
  return draft;
}

function operationPersonnelResendPreview(state = {}, draft = {}) {
  const history = Array.isArray(state.sendHistory) ? state.sendHistory : [];
  const hasSent = operationPersonnelStateHasSent(state);
  const currentTaskSnapshot = operationPersonnelTaskSnapshot(draft);
  const latestHistory = history.at(-1) || {};
  const baselineTaskSnapshot = latestHistory.taskSnapshot || state.lastSentTaskSnapshot || null;
  const changes = hasSent && baselineTaskSnapshot
    ? diffOperationPersonnelTaskDrafts(baselineTaskSnapshot, currentTaskSnapshot)
    : { schedules: { added: [], changed: [], deleted: [] }, fields: [], summary: "" };
  return {
    isResend: hasSent,
    sendCount: Math.max(history.length, hasSent ? 1 : 0),
    suggestedChangeSummary: !hasSent
      ? ""
      : baselineTaskSnapshot
        ? (changes.summary || "与上次发送的任务信息一致")
        : "上次发送记录未保存完整配置快照，请人工填写并核对本次变更内容",
    changes,
    currentFingerprint: operationPersonnelTaskFingerprint(currentTaskSnapshot),
    baselineAvailable: Boolean(baselineTaskSnapshot),
    baselineFingerprint: baselineTaskSnapshot
      ? operationPersonnelTaskFingerprint(baselineTaskSnapshot)
      : "",
  };
}

export function operationPersonnelRequirementsFromPersonnel(personnel = {}, overrides = {}) {
  return [
    {
      name: "正式考试-最早登录系统时间",
      value: `考生可于考试开始前${text(personnel.earliestLoginMinutes)}分钟登录`,
    },
    {
      name: "正式考试-监考人员安排",
      value: "ATA监考-分散",
    },
    {
      name: "正式考试-监考人员数量",
      value: text(personnel.monitorCount),
    },
    {
      name: "正式考试-监考人员比例",
      value: text(personnel.monitorRatio),
    },
    {
      name: "正式考试-监考登录监控",
      value: text(personnel.loginMonitoring),
    },
  ].map((item) => ({
    ...item,
    value: Object.hasOwn(overrides || {}, item.name)
      ? text(overrides[item.name])
      : item.value,
  }));
}

export function operationPersonnelInformationMissing(draft = {}, options = {}) {
  const personnel = draft.personnel || {};
  const dates = draft.dates || {};
  const recipients = draft.recipients || {};
  const requirements = operationPersonnelRequirementsFromPersonnel(
    personnel,
    draft.requirementOverrides,
  );
  const positiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const missing = [
    ["人员服务", text(personnel.serviceType) === "ATA 监考－分散在线监考"],
    ["人员落实平台", Boolean(text(personnel.platform))],
    ["监考登录监控", ["是", "否"].includes(text(personnel.loginMonitoring))],
    ["监考比例", /^[1-9]\d*:[1-9]\d*$/.test(text(personnel.monitorRatio))],
    ["监考人数计算基数", positiveInteger(personnel.candidateBasis)],
    ["监考人数", positiveInteger(personnel.monitorCount)],
    ["最早登录系统时间", Number.isFinite(Number(personnel.earliestLoginMinutes))
      && Number(personnel.earliestLoginMinutes) >= 0],
    ["人员落实开始日期", /^\d{4}-\d{2}-\d{2}$/.test(text(dates.start))],
    ["人员落实结束日期", /^\d{4}-\d{2}-\d{2}$/.test(text(dates.end))],
    ["人员名单提交日期", /^\d{4}-\d{2}-\d{2}$/.test(text(dates.nameListDue))],
    ["收件项目部", Boolean(text(recipients.toGroup))],
    ["收件人项目经理", Array.isArray(recipients.toNames)
      && recipients.toNames.length === 1 && Boolean(text(recipients.toNames[0]))],
    ["固定抄送部门", Array.isArray(recipients.ccGroups)
      && recipients.ccGroups.length === 2
      && recipients.ccGroups[0] === "考站管理&质量控制部"
      && recipients.ccGroups[1] === "结算组"],
  ].filter(([, complete]) => !complete).map(([label]) => label);
  if (text(dates.start) && text(dates.end) && text(dates.start) > text(dates.end)) {
    missing.push("人员落实日期范围");
  }
  for (const item of requirements) {
    if (!text(item.value)) missing.push(item.name);
  }
  if (options.allowExpiredDates !== true) {
    for (const label of operationPersonnelExpiredDateLabels(draft, options.now ?? Date.now())) {
      missing.push(`${label}已过期`);
    }
  }
  return [...new Set(missing)];
}

function attachOperationPersonnelTargets(draft = {}) {
  draft.targetRequirements = operationPersonnelRequirementsFromPersonnel(
    draft.personnel,
    draft.requirementOverrides,
  );
  return draft;
}

function assertOperationPersonnelInformationComplete(draft = {}, nowValue = Date.now(), options = {}) {
  const missing = operationPersonnelInformationMissing(draft, {
    now: nowValue,
    allowExpiredDates: options.allowExpiredDates === true,
  });
  if (!missing.length) return;
  throw serviceError(
    "PERSONNEL_DRAFT_INCOMPLETE",
    409,
    `人员信息填写不完整：${missing.join("、")}`,
  );
}

function targetFromDraft(draft = {}, snapshot = {}) {
  const batch = {
    ...(snapshot.batch || {}),
    ...(draft.operationBatch || {}),
    ...(draft.batch || {}),
    published: true,
  };
  if (draft.environment === "test") {
    if (text(snapshot.batch?.projectCode)) batch.projectCode = snapshot.batch.projectCode;
    if (text(snapshot.batch?.projectName)) batch.projectName = snapshot.batch.projectName;
  }
  return normalizeOperationPersonnelSnapshot({
    batch,
    schedules: structuredClone(
      snapshot.schedules?.length ? snapshot.schedules : (draft.schedules || []),
    ),
    personnel: draft.personnel || {},
    dates: draft.dates || {},
    requirements: operationPersonnelRequirementsFromPersonnel(
      draft.personnel,
      draft.requirementOverrides,
    ),
    taskSheet: draft.operationTaskSheet || snapshot.taskSheet || {},
    sendRecords: snapshot.sendRecords || [],
    directoryMatch: draft.directoryMatch || snapshot.directoryMatch || {},
  });
}

function editableDraft(base, input = {}, options = {}) {
  const draft = structuredClone(base);
  const changes = [];
  const set = (path, value) => {
    const keys = path.split(".");
    let owner = draft;
    for (const key of keys.slice(0, -1)) owner = owner[key];
    const key = keys.at(-1);
    if (stableJson(owner[key]) === stableJson(value)) return;
    changes.push({ path, before: owner[key] ?? "", after: value ?? "" });
    owner[key] = value;
  };
  const dates = input.draft?.dates || input.dates || {};
  for (const key of ["start", "end", "nameListDue"]) {
    if (Object.hasOwn(dates, key)) set(`dates.${key}`, text(dates[key]));
  }
  const requirements = input.draft?.requirements || input.requirements || {};
  const requirementEntries = Array.isArray(requirements)
    ? requirements.map((item) => [text(item?.name), text(item?.value)])
    : Object.entries(requirements).map(([name, value]) => [text(name), text(value)]);
  const editableRequirementNames = new Set([
    "正式考试-最早登录系统时间",
    "正式考试-监考人员安排",
    "正式考试-监考人员数量",
    "正式考试-监考人员比例",
  ]);
  draft.requirementOverrides = { ...(draft.requirementOverrides || {}) };
  for (const [name, value] of requirementEntries) {
    if (!editableRequirementNames.has(name)) continue;
    set(`requirementOverrides.${name}`, value);
    if (name === "正式考试-最早登录系统时间") {
      const minutes = value.match(/考试开始前\s*(\d+)\s*分钟/)?.[1];
      set("personnel.earliestLoginMinutes", minutes === undefined ? "" : Number(minutes));
    } else if (name === "正式考试-监考人员数量") {
      set("personnel.monitorCount", /^\d+$/.test(value) ? Number(value) : value);
    } else if (name === "正式考试-监考人员比例") {
      set("personnel.monitorRatio", value);
      const basis = value.match(/^\d+:(\d+)$/)?.[1];
      set("personnel.candidateBasis", basis === undefined ? "" : Number(basis));
    }
  }
  const validIsoDate = (value) => {
    const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3]);
  };
  const datesValid = ["start", "end", "nameListDue"].every((key) => validIsoDate(draft.dates?.[key]))
    && draft.dates.start <= draft.dates.end;
  const expiredDateLabels = datesValid
    ? operationPersonnelExpiredDateLabels(draft, options.now ?? Date.now())
    : [];
  const personnelRequirementsValid = Number.isSafeInteger(Number(draft.personnel?.earliestLoginMinutes))
    && Number(draft.personnel.earliestLoginMinutes) >= 0
    && Number.isSafeInteger(Number(draft.personnel?.monitorCount))
    && Number(draft.personnel.monitorCount) > 0
    && /^[1-9]\d*:[1-9]\d*$/.test(text(draft.personnel?.monitorRatio));
  const resolvable = new Map([
    ["PERSONNEL_DATES_REQUIRED", datesValid],
    ["PERSONNEL_DATES_EXPIRED", datesValid && expiredDateLabels.length === 0],
    ["FORMAL_ROOM_ASSIGNMENT_REQUIRED", personnelRequirementsValid],
  ]);
  const warnings = (draft.warnings || []).filter(
    (item) => !(resolvable.has(item.code) && resolvable.get(item.code)),
  );
  for (const [code, resolved] of resolvable) {
    if (!resolved && !warnings.some((item) => item.code === code)) {
      if (code === "PERSONNEL_DATES_EXPIRED" && !datesValid) continue;
      warnings.push(code === "PERSONNEL_DATES_EXPIRED"
        ? {
            code,
            fields: expiredDateLabels,
            message: `${expiredDateLabels.join("、")}已过期`,
          }
        : { code });
    }
  }
  draft.warnings = warnings;
  return { draft, changes: changes.sort((left, right) => left.path.localeCompare(right.path)) };
}

function operationSnapshotChanges(before = {}, after = {}, prefix = "") {
  if (stableJson(before) === stableJson(after)) return [];
  if (Array.isArray(before) || Array.isArray(after)
    || !before || !after
    || typeof before !== "object" || typeof after !== "object") {
    return [{ path: prefix, before: before ?? "", after: after ?? "" }];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .flatMap((key) => operationSnapshotChanges(
      before[key],
      after[key],
      prefix ? `${prefix}.${key}` : key,
    ))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function confirmationOperationChanges(changes = []) {
  return changes.filter((item) => (
    text(item.path) !== "requirements"
    && !text(item.path).startsWith("requirements.")
  ));
}

function changeValue(value) {
  if (value === undefined || value === null || value === "") return "空";
  return value && typeof value === "object" ? stableJson(value) : text(value);
}

function suggestedChangeSummary(changes = []) {
  return changes
    .map((item) => (
      `${item.path}：${changeValue(item.before)} → ${changeValue(item.after)}`
    ))
    .join("；");
}

function withoutDirectory(snapshot = {}) {
  return {
    ...structuredClone(snapshot),
    directoryMatch: { to: [], cc: [] },
  };
}

function irreversibleBoundaryReached(checkpoints = {}) {
  const submit = checkpoints.submit_send;
  return ["running", "submission_started", "completed"].includes(submit?.status)
    || Boolean(checkpoints.verify_send_record);
}

function recoverOrphanedAttempt(state, activeAttemptIds) {
  const attempt = state.activeAttempt;
  if (!attempt || !ACTIVE_ATTEMPT_STATUSES.has(attempt.status)
    || activeAttemptIds.has(attempt.attemptId)) {
    return state;
  }
  const status = irreversibleBoundaryReached(state.checkpoints)
    ? "result_unknown"
    : "failed_resumable";
  return {
    ...state,
    status,
    activeAttempt: { ...attempt, status },
  };
}

function attemptHistory(attempt, result, completedAt) {
  return {
    attemptId: attempt.attemptId,
    kind: attempt.kind,
    operator: attempt.operator,
    environment: attempt.environment,
    requirementVersion: attempt.requirementVersion,
    draftVersion: attempt.draftVersion,
    fingerprint: attempt.fingerprint,
    recipients: structuredClone(attempt.recipients),
    taskSnapshot: structuredClone(attempt.taskSnapshot || null),
    operationRecord: structuredClone(result.sendRecord),
    operationSnapshot: structuredClone(result.operationSnapshot || attempt.operationSnapshot || null),
    changeSummary: attempt.changeSummary,
    createdAt: attempt.createdAt,
    completedAt,
  };
}

function resultRecipients(result = {}, fallback = { to: [], cc: [] }) {
  const directory = result.operationSnapshot?.directoryMatch || {};
  const people = (items) => (items || []).map((item) => ({
    id: text(item?.id),
    name: text(item?.name),
    ...(text(item?.kind) ? { kind: text(item.kind) } : {}),
  }));
  const recipients = { to: people(directory.to), cc: people(directory.cc) };
  return recipients.to.length || recipients.cc.length
    ? recipients
    : structuredClone(fallback);
}

function attemptMatchesPreview(attempt, preview) {
  const binding = (value = {}, baseline = {}) => {
    const { operationSnapshotFingerprint: _operationSnapshotFingerprint, ...comparable } = value;
    return {
      ...comparable,
      baselineSnapshotFingerprint: value.baselineSnapshotFingerprint
        || fingerprint(baseline),
    };
  };
  return attempt
    && attempt.environment === preview.environment
    && attempt.kind === preview.kind
    && attempt.requirementVersion === preview.requirementVersion
    && attempt.draftVersion === preview.draftVersion
    && attempt.fingerprint === preview.fingerprint
    && stableJson(attempt.recipients) === stableJson(preview.recipients)
    && text(attempt.changeSummary) === text(preview.changeSummary)
    && stableJson(attempt.target) === stableJson(preview.target)
    && stableJson(attempt.baseline) === stableJson(preview.baseline)
    && stableJson(binding(attempt.previewBinding, attempt.baseline))
      === stableJson(binding(preview.previewBinding, preview.baseline));
}

function recheckedOperationSnapshot(state, result) {
  const attempt = state.activeAttempt;
  const layers = [
    state.lastOperationSnapshot,
    attempt.target,
    attempt.operationSnapshot,
    result.operationSnapshot,
  ].filter(Boolean);
  if (!layers.length) {
    throw serviceError(
      "PERSONNEL_RECHECK_SNAPSHOT_MISSING",
      409,
      "发送记录已出现，但缺少可核验的原发送快照",
    );
  }
  const nested = ["batch", "personnel", "dates", "taskSheet", "directoryMatch"];
  const merged = layers.reduce((current, layer) => {
    const next = { ...current, ...structuredClone(layer) };
    for (const key of nested) {
      next[key] = { ...(current[key] || {}), ...(layer[key] || {}) };
    }
    return next;
  }, {});
  const seenRecords = new Set();
  const records = [
    result.sendRecord,
    ...(result.sendRecords || []),
    ...(merged.sendRecords || []),
  ].filter((item) => {
    if (!item) return false;
    const key = `${text(item.type)}\u0000${text(item.sentAt)}`;
    if (seenRecords.has(key)) return false;
    seenRecords.add(key);
    return true;
  });
  return normalizeOperationPersonnelSnapshot({
    ...merged,
    sendRecords: records,
  });
}

function serializedFailure(error) {
  return {
    code: text(error?.code) || "PERSONNEL_ATTEMPT_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function localActorFingerprint(actor = {}) {
  return fingerprint({
    email: text(actor.email).toLowerCase(),
    role: text(actor.role),
  });
}

function operationPersonnelAttemptInstruction(attempt = {}, checkpoints = {}) {
  return {
    environment: attempt.environment,
    kind: attempt.kind,
    batch: attempt.target?.batch || {},
    target: attempt.target,
    managedSchedules: managedScheduleProjection(attempt.managedSchedules),
    displaySchedules: structuredClone(attempt.displaySchedules || []),
    baseline: attempt.baseline,
    changeSummary: attempt.changeSummary,
    checkpoints: structuredClone(checkpoints || {}),
  };
}

export function createOperationPersonnelTaskService(dependencies = {}) {
  const {
    readTask,
    updateTaskConfig,
    readRequirement = async () => null,
    coordinator,
    runInspection,
    runInspectionSession,
    runInspectionInSession,
    runAttempt,
    runRecheck,
    validateBrowserSession = async () => {},
    closeBrowserSession,
    environment: rawEnvironment = "",
    activeAttemptIds = new Set(),
    previewBrowserSessions = new Map(),
    now = Date.now,
    makeToken = randomUUID,
    makeAttemptId = randomUUID,
    defer = (job) => setImmediate(() => void job()),
  } = dependencies;
  const environment = text(rawEnvironment);
  const openInspectionSession = runInspectionSession || (async (instruction) => ({
    snapshot: await runInspection(instruction),
    browserSession: { close: async () => {} },
  }));
  const inspectRetainedSession = runInspectionInSession
    || (async (_browserSession, instruction) => runInspection(instruction));
  const closeRetainedBrowser = closeBrowserSession
    || (async (browserSession) => browserSession?.close?.());

  function previewBrowserError() {
    return serviceError(
      "PERSONNEL_PREVIEW_BROWSER_STALE",
      409,
      "人员任务预览浏览器已失效，请重新预览",
    );
  }

  async function disposePreviewBrowser(record) {
    if (!record || record.status === "closed") return;
    record.status = "closed";
    if (record.timer) clearTimeout(record.timer);
    if (previewBrowserSessions.get(record.previewToken) === record) {
      previewBrowserSessions.delete(record.previewToken);
    }
    try {
      await closeRetainedBrowser(record.browserSession);
    } finally {
      record.releaseProfile?.();
      record.releaseProfile = null;
    }
  }

  async function discardTaskPreviewBrowser(taskId) {
    const records = [...previewBrowserSessions.values()]
      .filter((record) => record.taskId === taskId && record.status !== "claimed");
    await Promise.all(records.map((record) => disposePreviewBrowser(record)));
  }

  function retainPreviewBrowser(result, browserSession, releaseProfile) {
    const preview = result.state.activePreview;
    const record = {
      taskId: result.taskId,
      previewToken: result.previewToken,
      draftVersion: result.draftVersion,
      requirementVersion: preview.requirementVersion,
      sourceFingerprint: result.state.sourceFingerprint,
      operationSnapshotFingerprint: preview.operationSnapshotFingerprint,
      expiresAt: Date.parse(result.expiresAt),
      browserSession,
      releaseProfile,
      status: "ready",
      timer: null,
    };
    previewBrowserSessions.set(record.previewToken, record);
    const delay = Math.max(0, record.expiresAt - now());
    record.timer = setTimeout(() => {
      void disposePreviewBrowser(record).catch(() => {});
    }, delay);
    record.timer.unref?.();
    return record;
  }

  function claimPreviewBrowser(taskId, preview, state) {
    const record = previewBrowserSessions.get(preview.token);
    const matches = record
      && record.status === "ready"
      && record.taskId === taskId
      && record.previewToken === preview.token
      && record.draftVersion === preview.draftVersion
      && record.requirementVersion === preview.requirementVersion
      && record.sourceFingerprint === state.sourceFingerprint
      && record.operationSnapshotFingerprint === preview.operationSnapshotFingerprint
      && Number.isFinite(record.expiresAt)
      && record.expiresAt > now();
    if (!matches) throw previewBrowserError();
    record.status = "claimed";
    if (record.timer) clearTimeout(record.timer);
    record.timer = null;
    return record;
  }

  async function readAuthorized(taskId, actor) {
    return assertTask(await readTask(taskId), actor);
  }

  async function readRequirementFor(task) {
    const requestId = requirementRequestId(task);
    return requestId ? await readRequirement(requestId) : null;
  }

  async function persistState(taskId, state) {
    return updateTaskConfig(taskId, { operationPersonnelTask: state });
  }

  async function withTaskLock(taskId, run) {
    const release = coordinator.acquireTask(taskId);
    try {
      return await run();
    } finally {
      release();
    }
  }

  async function updateAttemptState(taskId, attemptId, change) {
    return withTaskLock(taskId, async () => {
      const task = await readTask(taskId);
      if (!task) return null;
      const state = normalizedState(task, environment);
      if (state.activeAttempt?.attemptId !== attemptId) return null;
      const next = await change(state, task);
      await persistState(taskId, next);
      return next;
    });
  }

  async function get(taskId, actor) {
    const task = await readAuthorized(taskId, actor);
    if (!VALID_ENVIRONMENTS.has(environment)) {
      const state = normalizedState(task, environment, {});
      return {
        taskId,
        state: { ...state, status: "unsupported", draft: {} },
      };
    }
    const draft = attachOperationPersonnelTargets(buildOperationPersonnelTaskDraft(task, {
      environment,
      now: nowIso(now),
      scheduleCodeMap: task.config?.operationPersonnelTask?.scheduleCodeMap || {},
    }));
    const managed = operationPersonnelScheduleGate(task);
    if (managed.ok) {
      draft.managedSchedules = operationPersonnelManagedSchedules(draft, managed.schedules);
    }
    let state = normalizedState(task, environment, draft);
    state = recoverOrphanedAttempt(state, activeAttemptIds);
    const requirementReadback = state.checkpoints?.sync_exam_service_requirements?.status === "completed"
      ? state.checkpoints.sync_exam_service_requirements.readback
      : state.lastOperationSnapshot?.requirements;
    if (Array.isArray(requirementReadback)) {
      draft.operationRequirements = structuredClone(requirementReadback);
    }
    state.draft = structuredClone(draft);
    state.sourceFingerprint = draftSourceFingerprint(draft);
    state.scheduleCodeMap = structuredClone(draft.scheduleCodeMap || {});
    if (!ACTIVE_ATTEMPT_STATUSES.has(state.activeAttempt?.status)
      && !RECOVERY_STATUSES.has(state.status)) {
      state.status = buildOperationPersonnelTaskStatus(task, draft).status;
    }
    state.resendPreview = operationPersonnelResendPreview(state, draft);
    return { taskId, state };
  }

  async function edit(taskId, actor, input = {}) {
    const result = await withTaskLock(taskId, async () => {
      const task = await readAuthorized(taskId, actor);
      const state = recoverOrphanedAttempt(
        normalizedState(task, environment),
        activeAttemptIds,
      );
      if (ACTIVE_ATTEMPT_STATUSES.has(state.activeAttempt?.status)) {
        throw serviceError(
          "PERSONNEL_ATTEMPT_IN_PROGRESS",
          409,
          "人员任务发送正在执行，暂不能编辑",
        );
      }
      if (state.status === "result_unknown") {
        throw serviceError(
          "PERSONNEL_RESULT_UNKNOWN",
          409,
          "上次发送结果未知，只能重新核对发送记录",
        );
      }

      const draft = buildOperationPersonnelTaskDraft(task, {
        environment,
        now: nowIso(now),
        scheduleCodeMap: state.scheduleCodeMap,
      });
      const managed = operationPersonnelScheduleGate(task);
      if (managed.ok) {
        draft.managedSchedules = operationPersonnelManagedSchedules(draft, managed.schedules);
      }
      const edited = editableDraft(draft, input, { now: now() });
      const historicalDatesAllowed = operationPersonnelStateHasSent(state);
      ignoreHistoricalExpiredDateWarning(edited.draft, historicalDatesAllowed);
      attachOperationPersonnelTargets(edited.draft);
      assertOperationPersonnelInformationComplete(edited.draft, now(), {
        allowExpiredDates: historicalDatesAllowed,
      });
      const blockingWarnings = edited.draft.warnings.filter(
        (item) => item.code !== "UNSUPPORTED_PERSONNEL_TASK",
      );
      if (blockingWarnings.length) {
        throw serviceError(
          "PERSONNEL_DRAFT_INCOMPLETE",
          409,
          "人员任务字段无效，请检查日期和考务需求",
        );
      }

      const draftVersion = Number(state.draftVersion || 0) + (edited.changes.length ? 1 : 0);
      const nextTask = {
        ...task,
        config: {
          ...task.config,
          operationPersonnelTask: {
            ...(task.config?.operationPersonnelTask || {}),
            ...state,
          },
        },
      };
      const next = {
        ...state,
        status: VALID_ENVIRONMENTS.has(environment)
          ? buildOperationPersonnelTaskStatus(nextTask, edited.draft).status
          : "unsupported",
        draft: edited.draft,
        draftVersion,
        sourceFingerprint: draftSourceFingerprint(edited.draft),
        confirmedEdits: operationPersonnelConfirmedEdits(edited.draft),
        scheduleCodeMap: structuredClone(edited.draft.scheduleCodeMap || {}),
        activePreview: edited.changes.length ? null : state.activePreview,
        changeSummary: diffOperationPersonnelTaskDrafts(state.draft || {}, edited.draft).summary,
        events: edited.changes.length
          ? [...state.events, {
              type: "operation_personnel_draft_edited",
              actor: text(actor?.email),
              changes: structuredClone(edited.changes),
              createdAt: nowIso(now),
            }]
          : state.events,
      };
      await persistState(taskId, next);
      return {
        taskId,
        state: next,
        changes: structuredClone(edited.changes),
        changeSummary: next.changeSummary,
      };
    });
    if (result.changes.length) await discardTaskPreviewBrowser(taskId);
    return result;
  }

  async function preview(taskId, actor, input = {}) {
    assertEnvironment(environment);
    await discardTaskPreviewBrowser(taskId);
    const initialTask = await readAuthorized(taskId, actor);
    const initialManaged = requireManagedSchedules(initialTask);
    const initialManagedSnapshotFingerprint = fingerprint(initialManaged.managedSnapshot);
    const existing = recoverOrphanedAttempt(
      normalizedState(initialTask, environment),
      activeAttemptIds,
    );
    const requestedChangeSummary = operationPersonnelChangeSummary(input.changeSummary);
    if (existing.status === "result_unknown") {
      throw serviceError(
        "PERSONNEL_RESULT_UNKNOWN",
        409,
        "上次发送结果未知，只能重新核对发送记录",
      );
    }
    const requirement = await readRequirementFor(initialTask);
    if (hasPendingRequirementChange(requirement)) {
      throw serviceError(
        "PERSONNEL_PENDING_REQUIREMENT_CHANGE",
        409,
        "存在待审核的外部需求变更，不能预览人员任务",
      );
    }
    const inspectedRequirementVersion = requirementVersion(initialTask, requirement);
    const generated = buildOperationPersonnelTaskDraft(initialTask, {
      environment,
      now: nowIso(now),
      scheduleCodeMap: existing.scheduleCodeMap,
    });
    const edited = editableDraft(generated, input, { now: now() });
    const draft = attachOperationPersonnelTargets(edited.draft);
    const historicalDatesAllowed = operationPersonnelStateHasSent(existing);
    ignoreHistoricalExpiredDateWarning(draft, historicalDatesAllowed);
    draft.managedSchedules = operationPersonnelManagedSchedules(
      draft,
      initialManaged.schedules,
    );
    if ((draft.warnings || []).some((item) => item.code === "UNSUPPORTED_PERSONNEL_TASK")) {
      throw serviceError(
        "PERSONNEL_TASK_UNSUPPORTED",
        409,
        "当前需求包含人员任务单不支持的监考范围",
      );
    }
    assertOperationPersonnelInformationComplete(draft, now(), {
      allowExpiredDates: historicalDatesAllowed,
    });

    const resendPreview = operationPersonnelResendPreview(existing, draft);
    const knownResend = resendPreview.isResend;
    if (knownResend && !requestedChangeSummary) {
      throw serviceError(
        "PERSONNEL_CHANGE_SUMMARY_REQUIRED",
        400,
        "重新发送人员任务单必须填写变更内容",
      );
    }
    if (knownResend && (
      text(input.previewDraftFingerprint) !== resendPreview.currentFingerprint
      || text(input.previewBaselineFingerprint) !== resendPreview.baselineFingerprint
    )) {
      throw serviceError(
        "PERSONNEL_PREVIEW_STALE",
        409,
        "人员任务配置或上次发送基线已变化，请重新查看变更内容",
      );
    }
    const knownResendDirectoryProbeSummary = knownResend
      ? requestedChangeSummary
      : "";
    const releaseProfile = coordinator.acquireProfile();
    let browserSession;
    let retained = false;
    let snapshot;
    let kind;
    let externalBaseline;
    let target;
    let baseline;
    let operationChanges;
    try {
      const localInspection = input.localInspection;
      const localSessionToken = text(localInspection?.sessionToken);
      const localSessionExpiresAt = Date.parse(localInspection?.expiresAt);
      if (localInspection && (
        !localSessionToken
        || !Number.isFinite(localSessionExpiresAt)
        || localSessionExpiresAt <= now()
        || !localInspection.snapshot
      )) {
        throw previewBrowserError();
      }
      const inspected = localInspection
        ? {
            snapshot: localInspection.snapshot,
            browserSession: {
              localHelperSessionToken: localSessionToken,
              expiresAt: new Date(localSessionExpiresAt).toISOString(),
              close: async () => {},
            },
          }
        : await openInspectionSession({
            environment,
            batch: draft.batch,
            batchCode: draft.batch.code,
            detailUrl: text(initialTask.config?.operationBatch?.detailUrl),
            allowUnpublishedPreview: true,
            ...(knownResendDirectoryProbeSummary
              ? { directoryProbeSummary: knownResendDirectoryProbeSummary }
              : {}),
          });
      browserSession = inspected.browserSession;
      snapshot = normalizeOperationPersonnelSnapshot(inspected.snapshot);
      draft.displaySchedules = operationPersonnelDisplaySchedules(
        draft.managedSchedules,
        snapshot.schedules.length ? snapshot.schedules : draft.schedules,
      );
      externalBaseline = !existing.lastSuccessfulFingerprint
        && snapshot.sendRecords.length > 0;
      kind = knownResend || externalBaseline
        ? "resend"
        : "initial";
      if (kind === "initial" && requestedChangeSummary) {
        throw serviceError(
          "PERSONNEL_CHANGE_SUMMARY_UNEXPECTED",
          400,
          "首次发送人员任务单不应填写变更内容",
        );
      }
      target = targetFromDraft(draft, snapshot);
      baseline = existing.lastSuccessfulFingerprint
        ? normalizeOperationPersonnelSnapshot(existing.lastOperationSnapshot || {})
        : externalBaseline
          ? structuredClone(snapshot)
          : structuredClone(target);
      if (kind === "initial") baseline.batch.published = snapshot.batch.published;
      operationChanges = operationSnapshotChanges(snapshot, target);
      if (kind === "resend" && !knownResend
        && !(snapshot.directoryMatch?.to?.length || snapshot.directoryMatch?.cc?.length)) {
        if (localInspection) {
          throw serviceError(
            "PERSONNEL_DIRECTORY_MATCH_MISSING",
            409,
            "同事端本机预览未取得人员任务收件目录，请重新预览",
          );
        }
        const directoryProbeSummary = text(
          diffOperationPersonnelTaskDrafts(existing.draft || {}, draft).summary
          || suggestedChangeSummary(confirmationOperationChanges(operationChanges))
          || "本次人员任务重发收件目录核验",
        );
        const fullSnapshot = normalizeOperationPersonnelSnapshot(await inspectRetainedSession(
          browserSession,
          {
          environment,
          batch: draft.batch,
          batchCode: draft.batch.code,
          directoryProbeSummary,
          },
        ));
        const drift = operationSnapshotChanges(
          withoutDirectory(snapshot),
          withoutDirectory(fullSnapshot),
        );
        if (drift.length) {
          const error = serviceError(
            "PERSONNEL_OPERATION_CONFLICT",
            409,
            `运控人员任务状态冲突：${drift.map((item) => item.path).join("、")}`,
          );
          error.conflicts = drift;
          throw error;
        }
        snapshot = fullSnapshot;
        if (externalBaseline) baseline = structuredClone(fullSnapshot);
        target = targetFromDraft(draft, fullSnapshot);
        operationChanges = operationSnapshotChanges(snapshot, target);
      }
    } catch (error) {
      await closeRetainedBrowser(browserSession).catch(() => {});
      releaseProfile();
      throw error;
    }
    if (externalBaseline) {
      try {
        const recognized = await withTaskLock(taskId, async () => {
          const freshTask = await readAuthorized(taskId, actor);
          const freshState = normalizedState(freshTask, environment);
          if (freshState.lastSuccessfulFingerprint
            || freshState.initialSendVerification?.status === "verified") {
            throw serviceError(
              "PERSONNEL_PREVIEW_STALE",
              409,
              "人员任务首次发送状态已被其他操作更新，请刷新后重试",
            );
          }
          const initialRecords = snapshot.sendRecords.filter(
            (record) => record.type === "首次发送",
          );
          if (initialRecords.length !== 1) {
            throw serviceError(
              "PERSONNEL_INITIAL_SEND_RECORD_AMBIGUOUS",
              409,
              `运控首次发送记录必须唯一，实际 ${initialRecords.length} 条`,
            );
          }
          const sendRecord = structuredClone(initialRecords[0]);
          const verifiedAt = nowIso(now);
          const verificationFingerprint = `external:${fingerprint({ sendRecord, snapshot })}`;
          const sourceFingerprint = draftSourceFingerprint(draft);
          const historyEntry = {
            attemptId: verificationFingerprint,
            kind: "initial",
            operator: "external",
            environment,
            requirementVersion: inspectedRequirementVersion,
            draftVersion: Number(freshState.draftVersion || 1),
            fingerprint: verificationFingerprint,
            recipients: resultRecipients({ operationSnapshot: snapshot }),
            operationRecord: sendRecord,
            operationSnapshot: structuredClone(snapshot),
            changeSummary: "",
            createdAt: sendRecord.sentAt,
            completedAt: sendRecord.sentAt,
          };
          const sendHistory = freshState.sendHistory.some((item) => (
            item.kind === "initial"
            && item.operationRecord?.sentAt === sendRecord.sentAt
          ))
            ? freshState.sendHistory
            : [...freshState.sendHistory, historyEntry];
          const next = {
            ...freshState,
            status: operationChanges.length ? "changes_pending" : "sent",
            draft,
            sourceFingerprint,
            lastSuccessfulFingerprint: verificationFingerprint,
            lastOperationSnapshot: structuredClone(snapshot),
            activePreview: null,
            activeAttempt: null,
            sendHistory,
            initialSendVerification: {
              status: "verified",
              sendRecord,
              verifiedAt,
              evidence: "operation_record_readback",
            },
            events: [...freshState.events, {
              type: "operation_personnel_initial_send_recognized",
              actor: text(actor?.email),
              sendRecord,
              createdAt: verifiedAt,
            }],
          };
          await persistState(taskId, next);
          return {
            taskId,
            state: next,
            initialSendRecognized: true,
            sendRecord,
            changes: diffOperationPersonnelTaskDrafts(freshState.draft || {}, draft),
            operationChanges: confirmationOperationChanges(operationChanges),
          };
        });
        return recognized;
      } finally {
        await closeRetainedBrowser(browserSession).catch(() => {});
        releaseProfile();
      }
    }
    let result;
    try {
      const conflictBaseline = existing.status === "failed_resumable"
      && existing.activeAttempt
      ? operationPersonnelResumeBaseline(
        operationPersonnelFailedResumeConflictBaseline(
          baseline || target,
          operationPersonnelFailedResumeObservedBaseline(existing),
        ),
        existing.checkpoints,
      )
      : baseline || target;
    const conflicts = operationPersonnelConflicts(
      operationPersonnelConflictBaseline(
        conflictBaseline,
        snapshot,
        kind,
        draft.managedSchedules,
      ),
      snapshot,
      kind,
    );
    if (conflicts.length) {
      const error = serviceError(
        "PERSONNEL_OPERATION_CONFLICT",
        409,
        `运控人员任务状态冲突：${conflicts.map((item) => item.path).join("、")}`,
      );
      error.conflicts = conflicts;
      throw error;
    }

      result = await withTaskLock(taskId, async () => {
      const freshTask = await readAuthorized(taskId, actor);
      const freshManaged = requireManagedSchedules(freshTask);
      if (fingerprint(freshManaged.managedSnapshot) !== initialManagedSnapshotFingerprint) {
        throw serviceError(
          "PERSONNEL_BATCH_SCHEDULE_CONFLICT",
          409,
          "批次受管日程在预览期间发生变化，请重新检查",
        );
      }
      const freshRequirement = await readRequirementFor(freshTask);
      if (hasPendingRequirementChange(freshRequirement)) {
        throw serviceError(
          "PERSONNEL_PENDING_REQUIREMENT_CHANGE",
          409,
          "存在待审核的外部需求变更，不能预览人员任务",
        );
      }
      const freshState = recoverOrphanedAttempt(
        normalizedState(freshTask, environment),
        activeAttemptIds,
      );
      const currentRequirementVersion = requirementVersion(freshTask, freshRequirement);
      if (currentRequirementVersion !== inspectedRequirementVersion) {
        throw serviceError(
          "PERSONNEL_PREVIEW_STALE",
          409,
          "人员任务需求版本已变化，请重新检查",
        );
      }
      const initialVersion = Number(freshState.draftVersion || 0) || 1;
      const draftVersion = edited.changes.length ? initialVersion + 1 : initialVersion;
      draft.operationRequirements = structuredClone(snapshot.requirements);
      draft.operationTaskSheet = structuredClone(snapshot.taskSheet);
      draft.operationBatch = structuredClone(snapshot.batch);
      draft.directoryMatch = structuredClone(snapshot.directoryMatch);
      draft.previewOperationSnapshot = structuredClone(snapshot);
      const previewBaseline = kind === "initial" ? target : baseline;
      draft.previewBaselineSnapshot = structuredClone(previewBaseline);
      const sourceFingerprint = draftSourceFingerprint(draft);
      const token = text(makeToken());
      const createdAt = nowIso(now);
      const expiresAt = new Date(now() + PREVIEW_TTL_MS).toISOString();
      const activePreview = {
        token,
        expiresAt,
        requirementVersion: currentRequirementVersion,
        draftVersion,
        kind,
        changeSummary: kind === "resend" ? requestedChangeSummary : "",
        externalBaseline,
        baselineSendRecord: externalBaseline
          ? structuredClone(baseline.sendRecords[0] || null)
          : null,
        baselineSnapshotFingerprint: fingerprint(previewBaseline),
        taskSnapshotFingerprint: resendPreview.currentFingerprint,
        baselineTaskSnapshotFingerprint: resendPreview.baselineFingerprint,
        operationSnapshotFingerprint: fingerprint(snapshot),
        directoryMatchFingerprint: fingerprint(snapshot.directoryMatch),
        managedScheduleFingerprint: fingerprint(draft.managedSchedules),
        displayScheduleFingerprint: fingerprint(draft.displaySchedules),
      };
      const events = [
        ...freshState.events,
        {
          type: "operation_personnel_previewed",
          actor: text(actor?.email),
          createdAt,
        },
        ...(externalBaseline ? [{
          type: "operation_personnel_external_send_baseline_adopted",
          actor: text(actor?.email),
          sendRecord: structuredClone(activePreview.baselineSendRecord),
          createdAt,
        }] : []),
        ...(edited.changes.length ? [{
          type: "operation_personnel_draft_auto_confirmed",
          actor: text(actor?.email),
          changes: structuredClone(edited.changes),
          createdAt,
        }] : []),
      ];
      const next = {
        ...freshState,
        schemaVersion: 1,
        environment,
        status: buildOperationPersonnelTaskStatus(freshTask, draft).status,
        draft,
        draftVersion,
        sourceFingerprint,
        scheduleCodeMap: structuredClone(draft.scheduleCodeMap || {}),
        activePreview,
        events,
      };
      await persistState(taskId, next);
      return {
        taskId,
        previewToken: token,
        expiresAt,
        draftVersion,
        state: next,
        changes: diffOperationPersonnelTaskDrafts(freshState.draft || {}, draft),
        operationChanges: confirmationOperationChanges(operationChanges),
      };
      });
      retainPreviewBrowser(result, browserSession, releaseProfile);
      retained = true;
      return result;
    } finally {
      if (!retained) {
        await closeRetainedBrowser(browserSession).catch(() => {});
        releaseProfile();
      }
    }
  }

  async function persistCheckpoint(taskId, attemptId, checkpoint) {
    return updateAttemptState(taskId, attemptId, async (state) => ({
      ...state,
      checkpoints: {
        ...state.checkpoints,
        [checkpoint.name]: structuredClone(checkpoint),
      },
      events: [...state.events, {
        type: "operation_personnel_checkpoint",
        attemptId,
        checkpoint: checkpoint.name,
        status: checkpoint.status,
        createdAt: nowIso(now),
      }],
    }));
  }

  async function persistVerification(taskId, attemptId, verification) {
    return updateAttemptState(taskId, attemptId, async (state) => ({
      ...state,
      activeAttempt: {
        ...state.activeAttempt,
        verification: structuredClone(verification),
      },
    }));
  }

  async function finishAttempt(taskId, attemptId, result) {
    return updateAttemptState(taskId, attemptId, async (state) => {
      const attempt = state.activeAttempt;
      const completedAt = text(result.completedAt) || nowIso(now);
      if (result.status !== "sent" || !result.sendRecord) {
        return {
          ...state,
          status: "result_unknown",
          activeAttempt: {
            ...attempt,
            status: "result_unknown",
            completedAt,
            operationSnapshot: structuredClone(result.operationSnapshot || null),
          },
          events: [...state.events, {
            type: "operation_personnel_result_unknown",
            attemptId,
            createdAt: completedAt,
          }],
        };
      }
      const completedAttempt = {
        ...attempt,
        recipients: resultRecipients(result, attempt.recipients),
      };
      const history = state.sendHistory.some((item) => item.attemptId === attemptId)
        ? state.sendHistory
        : [...state.sendHistory, attemptHistory(completedAttempt, result, completedAt)];
      return {
        ...state,
        status: "sent",
        lastSuccessfulFingerprint: attempt.fingerprint,
        ...(completedAttempt.taskSnapshot
          ? { lastSentTaskSnapshot: structuredClone(completedAttempt.taskSnapshot) }
          : {}),
        lastOperationSnapshot: structuredClone(result.operationSnapshot),
        activeAttempt: { ...completedAttempt, status: "sent", completedAt },
        sendHistory: history,
        initialSendVerification: attempt.kind === "initial" ? {
          status: "verified",
          sendRecord: structuredClone(result.sendRecord),
          verifiedAt: completedAt,
          evidence: "operation_record_readback",
        } : state.initialSendVerification,
        changeSummary: attempt.changeSummary,
        events: [...state.events, {
          type: "operation_personnel_sent",
          attemptId,
          createdAt: completedAt,
        }],
      };
    });
  }

  async function failAttempt(taskId, attemptId, failure) {
    return updateAttemptState(taskId, attemptId, async (state) => {
      const status = irreversibleBoundaryReached(state.checkpoints)
        ? "result_unknown"
        : "failed_resumable";
      const completedAt = nowIso(now);
      return {
        ...state,
        status,
        activeAttempt: {
          ...state.activeAttempt,
          status,
          completedAt,
          error: serializedFailure(failure),
        },
        events: [...state.events, {
          type: "operation_personnel_attempt_failed",
          attemptId,
          status,
          error: serializedFailure(failure),
          createdAt: completedAt,
        }],
      };
    });
  }

  async function runQueuedAttempt(taskId, attemptId, previewBrowser) {
    activeAttemptIds.add(attemptId);
    try {
      const running = await withTaskLock(taskId, async () => {
        const freshTask = await readTask(taskId);
        const freshAttempt = freshTask?.config?.operationPersonnelTask?.activeAttempt;
        if (!freshTask || freshAttempt?.attemptId !== attemptId) return null;
        const freshManaged = requireManagedSchedules(freshTask);
        const state = normalizedState(freshTask, environment);
        assertOperationPersonnelInformationComplete(state.draft, now(), {
          allowExpiredDates: operationPersonnelStateHasSent(state),
        });
        const freshManagedFingerprint = fingerprint(
          operationPersonnelManagedSchedules(state.draft, freshManaged.schedules),
        );
        if (freshAttempt.previewBinding?.managedScheduleFingerprint
            !== freshManagedFingerprint) {
          throw serviceError(
            "PERSONNEL_BATCH_SCHEDULE_CONFLICT",
            409,
            "批次受管日程在排队期间发生变化，请重新检查",
          );
        }
        const next = {
          ...state,
          status: "applying_config",
          activeAttempt: {
            ...state.activeAttempt,
            status: "running",
            startedAt: state.activeAttempt.startedAt || nowIso(now),
          },
        };
        await persistState(taskId, next);
        return next;
      });
      if (!running) return;
      const attempt = running.activeAttempt;
      const result = await runAttempt(operationPersonnelAttemptInstruction(
        attempt,
        running.checkpoints,
      ), {
        now,
        browserSession: previewBrowser.browserSession,
        onCheckpoint: (checkpoint) => persistCheckpoint(taskId, attemptId, checkpoint),
        onVerification: (verification) => persistVerification(taskId, attemptId, verification),
      });
      await finishAttempt(taskId, attemptId, result);
    } catch (error) {
      await failAttempt(taskId, attemptId, error);
    } finally {
      await disposePreviewBrowser(previewBrowser).catch(() => {});
      activeAttemptIds.delete(attemptId);
    }
  }

  async function handleQueuedAttemptRejection(taskId, attemptId, error) {
    try {
      await failAttempt(taskId, attemptId, error);
    } catch {
      // The deferred job has no caller; a second persistence failure cannot be recovered here.
    }
  }

  async function send(taskId, actor, input = {}) {
    assertEnvironment(environment);
    let claimedBrowser;
    let queued;
    try {
      queued = await withTaskLock(taskId, async () => {
      const task = await readAuthorized(taskId, actor);
      const requirement = await readRequirementFor(task);
      if (hasPendingRequirementChange(requirement)) {
        throw serviceError(
          "PERSONNEL_PENDING_REQUIREMENT_CHANGE",
          409,
          "存在待审核的外部需求变更，不能发送人员任务",
        );
      }
      const state = recoverOrphanedAttempt(
        normalizedState(task, environment),
        activeAttemptIds,
      );
      if (ACTIVE_ATTEMPT_STATUSES.has(state.activeAttempt?.status)) {
        throw serviceError(
          "PERSONNEL_ATTEMPT_IN_PROGRESS",
          409,
          "人员任务发送正在执行",
        );
      }
      if (state.status === "result_unknown") {
        throw serviceError(
          "PERSONNEL_RESULT_UNKNOWN",
          409,
          "上次发送结果未知，只能重新核对发送记录",
        );
      }
      const preview = state.activePreview;
      const resendPreview = operationPersonnelResendPreview(state, state.draft);
      const expiresAt = Date.parse(preview?.expiresAt);
      const stale = !preview
        || preview.token !== text(input.previewToken)
        || !Number.isFinite(expiresAt)
        || expiresAt <= now()
        || preview.requirementVersion !== requirementVersion(task, requirement)
        || preview.draftVersion !== Number(input.draftVersion)
        || state.draftVersion !== Number(input.draftVersion)
        || state.environment !== environment
        || state.draft.environment !== environment
        || state.sourceFingerprint !== draftSourceFingerprint(state.draft)
        || preview.taskSnapshotFingerprint !== resendPreview.currentFingerprint
        || preview.baselineTaskSnapshotFingerprint !== resendPreview.baselineFingerprint
        || preview.baselineSnapshotFingerprint
          !== fingerprint(state.draft.previewBaselineSnapshot || {})
        || preview.operationSnapshotFingerprint
          !== fingerprint(state.draft.previewOperationSnapshot || {})
        || preview.directoryMatchFingerprint !== fingerprint(state.draft.directoryMatch || {})
        || preview.displayScheduleFingerprint !== fingerprint(state.draft.displaySchedules || []);
      if (stale) {
        throw serviceError(
          "PERSONNEL_PREVIEW_STALE",
          409,
          "人员任务预览已失效，请重新检查",
        );
      }
      let currentManaged;
      try {
        currentManaged = requireManagedSchedules(task);
      } catch (error) {
        await persistState(taskId, { ...state, activePreview: null });
        throw error;
      }
      const currentManagedSchedules = operationPersonnelManagedSchedules(
        state.draft,
        currentManaged.schedules,
      );
      if (preview.managedScheduleFingerprint !== fingerprint(currentManagedSchedules)) {
        await persistState(taskId, { ...state, activePreview: null });
        throw serviceError(
          "PERSONNEL_BATCH_SCHEDULE_CONFLICT",
          409,
          "批次受管日程在确认发送前发生变化，请重新检查",
        );
      }
      const edited = editableDraft(state.draft, input.edits || {}, { now: now() });
      const finalDraft = attachOperationPersonnelTargets(edited.draft);
      const historicalDatesAllowed = preview.kind === "resend"
        || operationPersonnelStateHasSent(state);
      ignoreHistoricalExpiredDateWarning(finalDraft, historicalDatesAllowed);
      if (finalDraft.warnings.length) {
        throw serviceError(
          "PERSONNEL_DRAFT_INCOMPLETE",
          409,
          "人员任务字段无效，请检查日期、监考人数和监考比例",
        );
      }
      assertOperationPersonnelInformationComplete(finalDraft, now(), {
        allowExpiredDates: historicalDatesAllowed,
      });
      const finalDraftVersion = Number(state.draftVersion || 0) + (edited.changes.length ? 1 : 0);
      const currentFingerprint = operationPersonnelTaskFingerprint(finalDraft);
      const baselineFingerprint = operationPersonnelTaskBaselineFingerprint(state);
      if (baselineFingerprint && baselineFingerprint === currentFingerprint) {
        throw serviceError(
          "PERSONNEL_CONTENT_UNCHANGED",
          409,
          "人员任务内容未变化，不允许重复发送",
        );
      }
      const kind = preview.kind;
      if (!["initial", "resend"].includes(kind)) {
        throw serviceError(
          "PERSONNEL_PREVIEW_STALE",
          409,
          "人员任务预览已失效，请重新检查",
        );
      }
      const changeSummary = operationPersonnelChangeSummary(input.changeSummary);
      if (kind === "resend" && !changeSummary) {
        throw serviceError(
          "PERSONNEL_CHANGE_SUMMARY_REQUIRED",
          400,
          "重新发送人员任务单必须填写变更内容",
        );
      }
      if (kind === "initial" && changeSummary) {
        throw serviceError(
          "PERSONNEL_CHANGE_SUMMARY_UNEXPECTED",
          400,
          "首次发送人员任务单不应填写变更内容",
        );
      }
      if (kind === "resend" && changeSummary !== text(preview.changeSummary)) {
        throw serviceError(
          "PERSONNEL_CHANGE_SUMMARY_MISMATCH",
          409,
          "人员任务单变更内容与预览时填写内容不一致，请重新预览",
        );
      }
      const target = targetFromDraft(
        finalDraft,
        finalDraft.previewOperationSnapshot || {},
      );
      const baseline = structuredClone(finalDraft.previewBaselineSnapshot || {});
      if (kind === "resend" && preview.externalBaseline
        && !operationSnapshotChanges(baseline, target).length) {
        throw serviceError(
          "PERSONNEL_CONTENT_UNCHANGED",
          409,
          "人员任务内容未变化，不允许重复发送",
        );
      }
      const previous = state.activeAttempt?.status === "failed_resumable"
        ? state.activeAttempt
        : null;
      const recipients = {
        to: structuredClone(finalDraft.directoryMatch?.to || []),
        cc: structuredClone(finalDraft.directoryMatch?.cc || []),
      };
      const previewBinding = {
        baselineSnapshotFingerprint: preview.baselineSnapshotFingerprint,
        operationSnapshotFingerprint: preview.operationSnapshotFingerprint,
        directoryMatchFingerprint: preview.directoryMatchFingerprint,
        managedScheduleFingerprint: preview.managedScheduleFingerprint,
        displayScheduleFingerprint: preview.displayScheduleFingerprint,
      };
      const resumeSameAttempt = attemptMatchesPreview(previous, {
        environment,
        kind,
        requirementVersion: preview.requirementVersion,
        draftVersion: finalDraftVersion,
        fingerprint: currentFingerprint,
        recipients,
        target,
        baseline,
        previewBinding,
        changeSummary,
      });
      const attemptId = resumeSameAttempt ? previous.attemptId : text(makeAttemptId());
      const createdAt = resumeSameAttempt ? previous.createdAt : nowIso(now);
      const attempt = {
        ...(resumeSameAttempt ? previous : {}),
        attemptId,
        kind,
        operator: text(actor?.email),
        environment,
        requirementVersion: preview.requirementVersion,
        draftVersion: finalDraftVersion,
        fingerprint: currentFingerprint,
        recipients,
        taskSnapshot: operationPersonnelTaskSnapshot(finalDraft),
        managedSchedules: managedScheduleProjection(finalDraft.managedSchedules),
        displaySchedules: structuredClone(finalDraft.displaySchedules),
        changeSummary,
        createdAt,
        status: "queued",
        error: null,
        completedAt: "",
        target,
        baseline,
        previewBinding,
      };
      claimedBrowser = claimPreviewBrowser(taskId, preview, state);
      try {
        await validateBrowserSession(claimedBrowser.browserSession, {
          environment,
          batch: finalDraft.batch,
          batchCode: finalDraft.batch.code,
        });
      } catch (error) {
        if (error?.code === "PERSONNEL_PREVIEW_BROWSER_STALE") throw error;
        throw previewBrowserError();
      }
      const localHelperSessionToken = text(
        claimedBrowser.browserSession?.localHelperSessionToken,
      );
      let localExecution = null;
      if (localHelperSessionToken) {
        const completionToken = text(makeToken());
        const expiresAt = new Date(now() + PREVIEW_TTL_MS).toISOString();
        attempt.executionLocation = "caller_helper";
        attempt.localExecution = {
          actorFingerprint: localActorFingerprint(actor),
          completionTokenHash: fingerprint(completionToken),
          expiresAt,
        };
        localExecution = {
          completionToken,
          expiresAt,
          sessionToken: localHelperSessionToken,
        };
      }
      const inspectCheckpoint = completedPreviewInspectionCheckpoint(
        kind,
        baseline,
        finalDraft.previewOperationSnapshot || {},
        nowIso(now),
      );
      const next = {
        ...state,
        status: "ready",
        draft: finalDraft,
        draftVersion: finalDraftVersion,
        sourceFingerprint: draftSourceFingerprint(finalDraft),
        confirmedEdits: operationPersonnelConfirmedEdits(finalDraft),
        scheduleCodeMap: structuredClone(finalDraft.scheduleCodeMap || {}),
        activePreview: null,
        activeAttempt: attempt,
        checkpoints: {
          ...(resumeSameAttempt ? state.checkpoints : {}),
          inspect_batch: inspectCheckpoint,
        },
        changeSummary,
        events: [...state.events, {
          type: "operation_personnel_attempt_queued",
          attemptId,
          actor: text(actor?.email),
          createdAt,
        }],
      };
      await persistState(taskId, next);
      activeAttemptIds.add(attemptId);
      return { attempt, localExecution, checkpoints: next.checkpoints };
      });
    } catch (error) {
      const readyBrowser = previewBrowserSessions.get(text(input.previewToken));
      const ownedBrowser = claimedBrowser
        || (readyBrowser?.taskId === taskId && readyBrowser.status === "ready"
          ? readyBrowser
          : null);
      await disposePreviewBrowser(ownedBrowser).catch(() => {});
      throw error;
    }
    if (queued.localExecution) {
      await disposePreviewBrowser(claimedBrowser).catch(() => {});
      return {
        statusCode: 202,
        attemptId: queued.attempt.attemptId,
        localExecution: {
          ...queued.localExecution,
          instruction: operationPersonnelAttemptInstruction(
            queued.attempt,
            queued.checkpoints,
          ),
        },
      };
    }
    defer(() => runQueuedAttempt(taskId, queued.attempt.attemptId, claimedBrowser).catch(
      (error) => handleQueuedAttemptRejection(taskId, queued.attempt.attemptId, error),
    ));
    return { statusCode: 202, attemptId: queued.attempt.attemptId };
  }

  async function completeLocalAttempt(taskId, actor, input = {}) {
    const attemptId = text(input.attemptId);
    const completionToken = text(input.completionToken);
    const task = await readAuthorized(taskId, actor);
    const current = normalizedState(task, environment);
    const activeAttempt = current.activeAttempt;
    const localExecution = activeAttempt?.localExecution || {};
    const completionMatches = completionToken
      && fingerprint(completionToken) === text(localExecution.completionTokenHash);
    if (
      !activeAttempt
      || activeAttempt.attemptId !== attemptId
      || activeAttempt.executionLocation !== "caller_helper"
      || localExecution.actorFingerprint !== localActorFingerprint(actor)
      || !completionMatches
    ) {
      throw serviceError(
        "PERSONNEL_LOCAL_EXECUTION_STALE",
        409,
        "人员任务本机执行凭据已失效，请重新预览",
      );
    }
    if (["sent", "failed_resumable", "result_unknown"].includes(activeAttempt.status)) {
      return { taskId, state: current, attempt: activeAttempt };
    }
    if (Date.parse(localExecution.expiresAt) <= now()) {
      activeAttemptIds.delete(attemptId);
      const failure = serviceError(
        "PERSONNEL_LOCAL_EXECUTION_STALE",
        409,
        "人员任务本机执行已超时，请重新预览",
      );
      const state = await failAttempt(taskId, attemptId, failure);
      return { taskId, state, attempt: state?.activeAttempt };
    }

    const envelope = input.helperResult?.operationPersonnelAttempt || null;
    const checkpoints = Array.isArray(envelope?.checkpoints) ? envelope.checkpoints : [];
    const verification = envelope?.verification || null;
    try {
      await updateAttemptState(taskId, attemptId, async (state) => ({
        ...state,
        status: "applying_config",
        activeAttempt: {
          ...state.activeAttempt,
          status: "running",
          startedAt: state.activeAttempt.startedAt || nowIso(now),
          ...(verification ? { verification: structuredClone(verification) } : {}),
        },
        checkpoints: checkpoints.reduce((result, checkpoint) => ({
          ...result,
          [text(checkpoint?.name)]: structuredClone(checkpoint),
        }), { ...state.checkpoints }),
      }));

      if (envelope?.status === "completed" && envelope.result) {
        const state = await finishAttempt(taskId, attemptId, envelope.result);
        return { taskId, state, attempt: state?.activeAttempt };
      }
      const rawFailure = envelope?.error || input.helperError || {};
      const failure = serviceError(
        text(rawFailure.code) || "PERSONNEL_LOCAL_EXECUTION_FAILED",
        Number(rawFailure.status || 409),
        text(rawFailure.message) || "同事端本机人员任务执行失败",
      );
      const state = await failAttempt(taskId, attemptId, failure);
      return { taskId, state, attempt: state?.activeAttempt };
    } finally {
      activeAttemptIds.delete(attemptId);
    }
  }

  async function attempt(taskId, actor, attemptId) {
    const result = await get(taskId, actor);
    if (result.state.activeAttempt?.attemptId !== text(attemptId)) {
      throw serviceError(
        "PERSONNEL_ATTEMPT_NOT_FOUND",
        404,
        "人员任务发送尝试不存在",
      );
    }
    return { ...result, attempt: result.state.activeAttempt };
  }

  async function recheck(taskId, actor, input = {}) {
    assertEnvironment(environment);
    const task = await readAuthorized(taskId, actor);
    const state = recoverOrphanedAttempt(normalizedState(task, environment), activeAttemptIds);
    if (state.status !== "result_unknown" || !state.activeAttempt) {
      throw serviceError(
        "PERSONNEL_RECHECK_NOT_ALLOWED",
        409,
        "只有发送结果未知时才能重新核对发送记录",
      );
    }
    const originalAttemptId = state.activeAttempt.attemptId;
    const submitStartedAt = state.checkpoints.submit_send?.readback?.startedAt
      || state.activeAttempt.startedAt;
    const instruction = {
        environment,
        kind: state.activeAttempt.kind,
        batch: state.activeAttempt.target?.batch || state.draft.batch,
        detailUrl: text(task.config?.operationBatch?.detailUrl),
        attempt: {
          kind: state.activeAttempt.kind,
          startedAt: submitStartedAt,
          beforeSendRecords: structuredClone(
            state.checkpoints.submit_send?.readback?.beforeSendRecords || [],
          ),
        },
      };
    let result = input.localResult;
    if (!result) {
      const releaseProfile = coordinator.acquireProfile();
      try {
        result = await runRecheck(instruction);
      } finally {
        releaseProfile();
      }
    }
    const next = await updateAttemptState(taskId, originalAttemptId, async (freshState) => {
      const freshAttempt = freshState.activeAttempt;
      const checkedAt = nowIso(now);
      if (!result.sendRecord) {
        return {
          ...freshState,
          status: "result_unknown",
          activeAttempt: { ...freshAttempt, status: "result_unknown" },
          events: [...freshState.events, {
            type: "operation_personnel_rechecked",
            attemptId: originalAttemptId,
            matched: false,
            createdAt: checkedAt,
          }],
        };
      }
      const completedAt = text(result.completedAt) || checkedAt;
      const operationSnapshot = recheckedOperationSnapshot(freshState, result);
      const reconciled = {
        ...result,
        operationSnapshot,
        completedAt,
      };
      const history = freshState.sendHistory.some((item) => item.attemptId === originalAttemptId)
        ? freshState.sendHistory
        : [...freshState.sendHistory, attemptHistory(freshAttempt, reconciled, completedAt)];
      return {
        ...freshState,
        status: "sent",
        lastSuccessfulFingerprint: freshAttempt.fingerprint,
        ...(freshAttempt.taskSnapshot
          ? { lastSentTaskSnapshot: structuredClone(freshAttempt.taskSnapshot) }
          : {}),
        lastOperationSnapshot: operationSnapshot,
        confirmedEdits: operationPersonnelConfirmedEdits(freshAttempt.target || freshState.draft),
        activeAttempt: {
          ...freshAttempt,
          status: "sent",
          error: null,
          completedAt,
          operationSnapshot,
        },
        sendHistory: history,
        initialSendVerification: freshAttempt.kind === "initial" ? {
          status: "verified",
          sendRecord: structuredClone(result.sendRecord),
          verifiedAt: checkedAt,
          evidence: "operation_record_readback",
        } : freshState.initialSendVerification,
        events: [...freshState.events, {
          type: "operation_personnel_rechecked",
          attemptId: originalAttemptId,
          matched: true,
          createdAt: checkedAt,
        }],
      };
    });
    return { taskId, state: next };
  }

  return { get, edit, preview, send, completeLocalAttempt, attempt, recheck };
}
