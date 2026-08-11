import {
  allowedSessionChangeFields,
  buildSessionChangeDiff,
  editableSessionFieldsFromDetail,
  sessionChangeHistoryFromStep,
} from "./session_change.mjs";

export const SESSION_SYNC_ACTION = "sync_from_yikao";

const allowedFieldSet = new Set(allowedSessionChangeFields);

function text(value) {
  return String(value ?? "").trim();
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && text(value) !== "") return value;
  }
  return "";
}

function minuteValue(...values) {
  const value = firstValue(...values);
  const normalized = text(value).replace(/分钟/g, "").trim();
  if (!normalized) return "";
  const number = Number(normalized);
  if (Number.isFinite(number)) return number < 0 ? "" : number;
  return value;
}

function taskRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
}

function requirementForSession(task = {}, session = {}) {
  const index = Math.max(Number(session.requirementIndex || 0), 0);
  return taskRequirements(task)[index] || {};
}

function storedSessionSnapshot(task = {}, sessionId = "") {
  const snapshot = task.config?.sessionSync?.snapshots?.[text(sessionId)];
  return objectValue(snapshot);
}

function sessionChangeStep(task = {}) {
  return (Array.isArray(task.steps) ? task.steps : [])
    .find((step) => step.stepKey === "session_change") || {};
}

function baselineFromRequirement(task = {}, session = {}) {
  const requirement = requirementForSession(task, session);
  const fields = objectValue(requirement.fields);
  const config = {
    ...objectValue(task.config),
    ...objectValue(requirement.config),
  };
  const isTrial = text(session.sessionType || session.session_type) === "trial";
  return {
    name: firstValue(
      session.name,
      isTrial ? config.mockExamName : config.examName,
      fields["考试名称"],
    ),
    start: firstValue(
      session.start,
      session.start_time,
      isTrial ? config.mockStartTimeDisplay : config.startTimeDisplay,
    ),
    end: firstValue(
      session.end,
      session.end_time,
      isTrial ? config.mockEndTimeDisplay : config.endTimeDisplay,
    ),
    early: isTrial ? "" : minuteValue(config.earlyLoginMinutes, fields["提前登录时间"]),
    later: isTrial ? "" : minuteValue(config.lateLimitMinutes, fields["限制迟到时间"]),
    message: firstValue(config.welcomeText, fields["欢迎语"]),
    notice: firstValue(config.preLoginPrompt, fields["考前等待提示"]),
  };
}

function applyLaterSessionHistory(task, session, baseline, storedAt = "") {
  const sessionId = text(session.session_id || session.id);
  const storedTime = Date.parse(storedAt || "");
  const history = sessionChangeHistoryFromStep(sessionChangeStep(task))
    .filter((record) => text(record.sessionId) === sessionId && record.status !== "failed")
    .filter((record) => {
      if (!Number.isFinite(storedTime)) return true;
      const changedTime = Date.parse(record.changedAt || "");
      return Number.isFinite(changedTime) && changedTime > storedTime;
    })
    .sort((left, right) => Date.parse(left.changedAt || "") - Date.parse(right.changedAt || ""));
  for (const record of history) {
    for (const change of Array.isArray(record.diff) ? record.diff : []) {
      const field = text(change.field);
      if (allowedFieldSet.has(field)) baseline[field] = change.after ?? "";
    }
  }
  return baseline;
}

export function sessionSyncSnapshotFromDetail(detail = {}) {
  const snapshot = editableSessionFieldsFromDetail(detail);
  snapshot.early = minuteValue(snapshot.early);
  snapshot.later = minuteValue(snapshot.later);
  if (!text(snapshot.name) || !text(snapshot.start) || !text(snapshot.end)) {
    const error = new Error("易考场次当前信息不完整，已停止同步");
    error.code = "SESSION_SYNC_SNAPSHOT_INCOMPLETE";
    throw error;
  }
  return snapshot;
}

export function sessionSyncBaselineForTaskSession(task = {}, session = {}) {
  const stored = storedSessionSnapshot(task, session.session_id || session.id);
  const storedCurrent = objectValue(stored.current);
  const baseline = {
    ...baselineFromRequirement(task, session),
    ...(Object.keys(storedCurrent).length ? editableSessionFieldsFromDetail(storedCurrent) : {}),
  };
  applyLaterSessionHistory(task, session, baseline, stored.syncedAt);
  baseline.name = firstValue(session.name, baseline.name);
  baseline.start = firstValue(session.start, session.start_time, baseline.start);
  baseline.end = firstValue(session.end, session.end_time, baseline.end);
  return editableSessionFieldsFromDetail(baseline);
}

export function buildSessionSyncPreview(task = {}, session = {}, detail = {}, checkedAt = "") {
  const current = sessionSyncSnapshotFromDetail(detail);
  const local = sessionSyncBaselineForTaskSession(task, session);
  const diff = buildSessionChangeDiff(local, current);
  return {
    sessionId: text(session.session_id || session.id),
    sessionType: text(session.sessionType || session.session_type),
    requirementIndex: Math.max(Number(session.requirementIndex || 0), 0),
    checkedAt: checkedAt || new Date().toISOString(),
    local,
    current,
    diff,
    changed: diff.length > 0,
  };
}

export function buildSessionSyncConfigPatch(task = {}, input = {}) {
  const session = input.session || {};
  const sessionId = text(session.session_id || session.id);
  if (!sessionId) throw new Error("缺少易考场次口令，不能保存同步结果");
  const current = sessionSyncSnapshotFromDetail(input.current || {});
  const existing = objectValue(task.config?.sessionSync);
  const snapshots = objectValue(existing.snapshots);
  const history = Array.isArray(existing.history) ? existing.history : [];
  const syncedAt = input.syncedAt || new Date().toISOString();
  const record = {
    id: input.id || `${sessionId}-${Date.parse(syncedAt) || Date.now()}`,
    action: SESSION_SYNC_ACTION,
    syncedAt,
    operator: text(input.operator),
    sessionId,
    sessionType: text(session.sessionType || session.session_type),
    requirementIndex: Math.max(Number(session.requirementIndex || 0), 0),
    diff: Array.isArray(input.diff) ? structuredClone(input.diff) : [],
  };
  return {
    sessionSync: {
      ...existing,
      version: 1,
      lastSyncedAt: syncedAt,
      snapshots: {
        ...snapshots,
        [sessionId]: {
          sessionId,
          sessionType: record.sessionType,
          requirementIndex: record.requirementIndex,
          current: structuredClone(current),
          syncedAt,
        },
      },
      history: [record, ...history].slice(0, 50),
    },
  };
}

export function sessionSyncErrorMessage(error = {}) {
  if (error?.code === "SESSION_SYNC_SNAPSHOT_INCOMPLETE") return error.message;
  const status = Number(error?.status || 0);
  if (status === 401) return "租户 API 返回 401，请检查租户 API Key。";
  if (status === 403) return "租户 API 返回 403，场次不存在、不属于当前租户，或当前 Key 无读取权限。";
  if (status === 404) return "易考未找到该场次，请核对考试口令。";
  if (status === 429) return "租户 API 返回 429，请稍后重试。";
  return `读取易考场次信息失败：${status || "未知"}`;
}
