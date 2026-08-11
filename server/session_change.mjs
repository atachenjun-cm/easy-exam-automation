const fieldLabels = {
  name: "场次名称",
  start: "开始时间",
  end: "结束时间",
  early: "提前登录分钟",
  later: "迟到限制分钟",
  message: "欢迎语",
  notice: "登录提示",
};

export const allowedSessionChangeFields = ["name", "start", "end", "early", "later", "message", "notice"];
const allowedSet = new Set(allowedSessionChangeFields);

export function featureEnabledForRuntime(_runtimeDir, env = process.env) {
  return env.SESSION_CHANGE_ENABLED !== "0";
}

function text(value) {
  return String(value ?? "").trim();
}

function parseDateLike(value) {
  const raw = text(value);
  if (!raw) return Number.NaN;
  const time = Date.parse(raw.replace(/\//g, "-").replace(" ", "T"));
  return Number.isFinite(time) ? time : Number.NaN;
}

function normalizeMinute(value, field, errors) {
  if (value === "" || value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    errors.push(`${fieldLabels[field]}不能为负数或非数字`);
    return undefined;
  }
  return Math.floor(num);
}

export function validateSessionChangeRequest(rawChanges = {}) {
  const changes = {};
  const errors = [];
  const source = rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges) ? rawChanges : {};

  for (const field of Object.keys(source)) {
    if (!allowedSet.has(field)) errors.push(`不支持修改字段：${field}`);
  }
  if (errors.length) return { ok: false, errors, changes: {} };

  for (const field of allowedSessionChangeFields) {
    if (!Object.hasOwn(source, field)) continue;
    if (field === "early" || field === "later") {
      const value = normalizeMinute(source[field], field, errors);
      if (value !== undefined) changes[field] = value;
      continue;
    }
    changes[field] = text(source[field]);
  }

  if (Object.hasOwn(changes, "name") && !changes.name) errors.push("场次名称不能为空");
  if (Object.hasOwn(changes, "start")) {
    const startTime = parseDateLike(changes.start);
    if (!Number.isFinite(startTime)) errors.push("开始时间格式不正确");
  }
  if (Object.hasOwn(changes, "end")) {
    const endTime = parseDateLike(changes.end);
    if (!Number.isFinite(endTime)) errors.push("结束时间格式不正确");
  }
  if (Object.hasOwn(changes, "start") && Object.hasOwn(changes, "end")) {
    const startTime = parseDateLike(changes.start);
    const endTime = parseDateLike(changes.end);
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime <= startTime) {
      errors.push("结束时间必须晚于开始时间");
    }
  }

  return { ok: errors.length === 0, errors, changes };
}

export function editableSessionFieldsFromDetail(detail = {}) {
  return Object.fromEntries(allowedSessionChangeFields.map((field) => [field, detail[field] ?? ""]));
}

export function localSessionFieldsForChange(session = {}) {
  return {
    name: session.name ?? "",
    start: session.start ?? "",
    end: session.end ?? "",
    early: session.early ?? "",
    later: session.later ?? "",
    message: session.message ?? "",
    notice: session.notice ?? "",
  };
}

export function sessionChangeBasePayloadFromTask(task = {}, session = {}) {
  const common = task?.config?.sessionChangeBase || {};
  return localSessionFieldsForChange(Object.fromEntries(
    allowedSessionChangeFields.map((field) => [field, session[field] ?? common[field] ?? ""]),
  ));
}

export function sessionChangePatchPayload(changes = {}) {
  const source = changes && typeof changes === "object" && !Array.isArray(changes) ? changes : {};
  return Object.fromEntries(
    allowedSessionChangeFields
      .filter((field) => Object.hasOwn(source, field))
      .map((field) => [field, source[field]]),
  );
}

function sameSessionChangeValue(field, left, right) {
  if (field === "start" || field === "end") {
    const leftTime = parseDateLike(left);
    const rightTime = parseDateLike(right);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime === rightTime;
  }
  if (field === "early" || field === "later") {
    const leftValue = left === "" || left === null || left === undefined ? null : Number(left);
    const rightValue = right === "" || right === null || right === undefined ? null : Number(right);
    return leftValue === rightValue;
  }
  return String(left ?? "") === String(right ?? "");
}

export function mergeSessionChangePayload(original = {}, changes = {}) {
  const source = original && typeof original === "object" && !Array.isArray(original) ? original : {};
  return Object.fromEntries(
    Object.entries(sessionChangePatchPayload(changes))
      .filter(([field, value]) => !sameSessionChangeValue(field, source[field], value)),
  );
}

export function buildSessionChangeDiff(before = {}, after = {}) {
  const rows = [];
  for (const field of allowedSessionChangeFields) {
    const oldValue = before[field] ?? "";
    const newValue = after[field] ?? "";
    if (sameSessionChangeValue(field, oldValue, newValue)) continue;
    rows.push({ field, label: fieldLabels[field], before: oldValue, after: newValue });
  }
  return rows;
}

const formalRequirementFields = new Set([
  "考试名称",
  "考试日期时间",
  "提前登录时间",
  "限制迟到时间",
  "欢迎语",
  "考前等待提示",
]);
const trialRequirementFields = new Set([
  "考试名称",
  "试考日期时间",
]);

function taskExamRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
}

function sessionRequirement(task = {}, session = {}) {
  const requirements = taskExamRequirements(task);
  const index = Math.max(Number(session.requirementIndex || 0), 0);
  return requirements[index] || requirements[0] || {};
}

function sessionRequirementFields(session = {}) {
  return session.sessionType === "trial" ? trialRequirementFields : formalRequirementFields;
}

function sessionChangeStep(task = {}) {
  return (Array.isArray(task.steps) ? task.steps : []).find((step) => step.stepKey === "session_change") || {};
}

function appliedRequirementChangeIds(task = {}, session = {}) {
  const sessionId = text(session.session_id || session.id);
  return new Set(sessionChangeHistoryFromStep(sessionChangeStep(task))
    .filter((record) => text(record.sessionId) === sessionId && record.requirementChangeApplied)
    .map((record) => text(record.requirementChangeId))
    .filter(Boolean));
}

function relevantSourceChanges(task = {}, session = {}) {
  const requirementIndex = Math.max(Number(session.requirementIndex || 0), 0);
  const relevantFields = sessionRequirementFields(session);
  const history = Array.isArray(task.config?.projectSourceChangeHistory)
    ? task.config.projectSourceChangeHistory
    : Array.isArray(task.config?.examRequirementChangeHistory)
      ? task.config.examRequirementChangeHistory
      : [];
  return history.filter((record) => {
    if (!["examRequirement", "project_requirement_editor"].includes(text(record.source))) return false;
    if (Math.max(Number(record.requirementIndex || 0), 0) !== requirementIndex) return false;
    return (Array.isArray(record.changes) ? record.changes : []).some((change) => relevantFields.has(text(change.field)));
  });
}

function pendingWechatRequirementChange(task = {}, session = {}) {
  const sync = task.config?.wechatRequirementSync || {};
  if (sync.status !== "pending_session_sync") return null;
  const sessionId = text(session.session_id || session.id);
  const affected = Array.isArray(sync.affectedSessionIds) ? sync.affectedSessionIds.map(text).filter(Boolean) : [];
  if (affected.length && !affected.includes(sessionId)) return null;
  const synced = Array.isArray(sync.syncedSessionIds) ? sync.syncedSessionIds.map(text).filter(Boolean) : [];
  if (synced.includes(sessionId)) return null;
  return {
    changeId: text(sync.changeId) || `requirement-v${Number(sync.requirementVersion || 0)}`,
    changedAt: sync.reviewedAt || "",
    changes: Array.isArray(sync.changes) ? sync.changes : [],
    requirementVersion: Number(sync.requirementVersion || 0),
    source: "wechat",
  };
}

function setSuggestedChange(suggested, field, value) {
  if (value === undefined || value === null) return;
  suggested[field] = value;
}

function suggestedChangesFromRequirement(task = {}, session = {}, changedFields = []) {
  const config = sessionRequirement(task, session).config || {};
  const fields = new Set(changedFields.map(text).filter(Boolean));
  const includes = (field) => fields.size === 0 || fields.has(field);
  const suggested = {};
  if (session.sessionType === "trial") {
    if (includes("考试名称")) setSuggestedChange(suggested, "name", config.mockExamName);
    if (includes("试考日期时间")) {
      setSuggestedChange(suggested, "start", config.mockStartTimeDisplay);
      setSuggestedChange(suggested, "end", config.mockEndTimeDisplay);
    }
    return suggested;
  }
  if (includes("考试名称")) setSuggestedChange(suggested, "name", config.examName);
  if (includes("考试日期时间")) {
    setSuggestedChange(suggested, "start", config.startTimeDisplay);
    setSuggestedChange(suggested, "end", config.endTimeDisplay);
  }
  if (includes("提前登录时间")) setSuggestedChange(suggested, "early", config.earlyLoginMinutes);
  if (includes("限制迟到时间")) setSuggestedChange(suggested, "later", config.lateLimitMinutes);
  if (includes("欢迎语")) setSuggestedChange(suggested, "message", config.welcomeText);
  if (includes("考前等待提示")) setSuggestedChange(suggested, "notice", config.preLoginPrompt);
  return suggested;
}

export function sessionRequirementChangeForTaskSession(task = {}, session = {}) {
  const appliedIds = appliedRequirementChangeIds(task, session);
  const manualChanges = relevantSourceChanges(task, session)
    .filter((record) => !appliedIds.has(text(record.changeId)));
  const wechat = pendingWechatRequirementChange(task, session);
  const candidates = [...manualChanges, ...(wechat ? [wechat] : [])];
  if (!candidates.length) return { pending: false, label: "", suggestedChanges: {} };
  const latest = [...candidates].reverse().sort((left, right) => (
    Date.parse(right.changedAt || "") - Date.parse(left.changedAt || "")
  ))[0] || candidates[candidates.length - 1];
  const changedFields = [...new Set(candidates.flatMap((record) => (
    Array.isArray(record.changes) ? record.changes : []
  ).map((change) => text(change.field)).filter(Boolean)))];
  const suggestedChanges = suggestedChangesFromRequirement(task, session, changedFields);
  const changeId = text(latest.changeId);
  if (!Object.keys(suggestedChanges).length) return { pending: false, label: "", changeId, suggestedChanges: {} };
  if (sessionChangeMatchesSuggested(session, suggestedChanges)) {
    return { pending: false, label: "", changeId, suggestedChanges: {} };
  }
  return {
    pending: true,
    label: "需求有变请确认",
    changeId,
    changedAt: latest.changedAt || "",
    changedFields,
    requirementVersion: Number(latest.requirementVersion || 0),
    source: latest.source || "",
    suggestedChanges,
  };
}

export function enrichTaskSessionRequirementChanges(task = {}) {
  const sessions = (Array.isArray(task.sessions) ? task.sessions : []).map((session) => ({
    ...session,
    requirementChange: sessionRequirementChangeForTaskSession(task, session),
  }));
  const pendingCount = sessions.filter((session) => session.requirementChange?.pending).length;
  return {
    ...task,
    sessions,
    requirementChangeSummary: {
      pending: pendingCount > 0,
      pendingCount,
      label: pendingCount ? "需求有变请确认" : "",
    },
  };
}

export function sessionChangeMatchesSuggested(after = {}, suggested = {}) {
  return Object.entries(suggested).every(([field, expected]) => {
    const actual = after[field];
    if (field === "start" || field === "end") {
      const actualTime = parseDateLike(actual);
      const expectedTime = parseDateLike(expected);
      return Number.isFinite(actualTime) && Number.isFinite(expectedTime) && actualTime === expectedTime;
    }
    if (field === "early" || field === "later") return Number(actual) === Number(expected);
    return String(actual ?? "") === String(expected ?? "");
  });
}

export function sessionChangeSummary(body) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.info !== undefined ? { info: body.info } : {}),
      ...(body.error !== undefined ? { error: body.error } : {}),
      ...(body.detail !== undefined && typeof body.detail !== "object" ? { detail: body.detail } : {}),
    };
  }
  return { bodyType: typeof body, body: String(body ?? "").slice(0, 500) };
}

export function appendSessionChangeHistory(existing = [], record = {}) {
  const base = Array.isArray(existing) ? existing : [];
  const sessionType = String(record.sessionType || "");
  const item = {
    id: record.id || `${record.sessionId || "session"}-${Date.now()}`,
    changedAt: record.changedAt || new Date().toISOString(),
    operator: record.operator || "",
    sessionId: String(record.sessionId || ""),
    sessionType,
    sessionLabel: sessionType === "formal" ? "正式考试" : sessionType === "trial" ? "试考" : "场次",
    apiBase: record.apiBase || "",
    status: record.status || "success",
    tenantStatus: record.tenantStatus ?? "",
    verifyStatus: record.verifyStatus ?? "",
    diff: Array.isArray(record.diff) ? record.diff : [],
    tenantResponseSummary: record.tenantResponseSummary || {},
    verifiedSession: record.verifiedSession || null,
    warning: record.warning || null,
    requirementChangeId: text(record.requirementChangeId),
    requirementChangeApplied: Boolean(record.requirementChangeApplied),
    courseRequirementIndex: Math.max(Number(record.courseRequirementIndex || 0), 0),
    courseRequirementChangeId: text(record.courseRequirementChangeId),
    courseRequirementChangeApplied: Boolean(record.courseRequirementChangeApplied),
    verifiedCourses: Array.isArray(record.verifiedCourses) ? record.verifiedCourses : [],
    action: text(record.action),
  };
  return [item, ...base].slice(0, 50);
}

export function sessionChangeHistoryFromStep(step = {}) {
  if (Array.isArray(step?.result?.history) && step.result.history.length) return step.result.history;
  if (!Array.isArray(step?.result?.diff) || !step.result.diff.length) return [];
  return appendSessionChangeHistory([], {
    id: `${step.result.sessionId || "session"}-legacy`,
    changedAt: step.completedAt || step.startedAt || "",
    operator: step.result.operator || "",
    sessionId: step.result.sessionId || "",
    sessionType: step.result.sessionType || "",
    apiBase: step.result.apiBase || "",
    status: step.status || "success",
    tenantStatus: step.result.tenantStatus || 200,
    verifyStatus: step.result.verifyStatus || "",
    diff: step.result.diff,
    tenantResponseSummary: step.result.tenantResponseSummary || {},
    verifiedSession: step.result.verifiedSession || null,
    requirementChangeId: step.result.requirementChangeId || "",
    requirementChangeApplied: Boolean(step.result.requirementChangeApplied),
    courseRequirementIndex: Number(step.result.requirementIndex || 0),
    courseRequirementChangeId: step.result.courseRequirementChangeId || "",
    courseRequirementChangeApplied: Boolean(step.result.courseRequirementChangeApplied),
    verifiedCourses: step.result.courses || [],
  });
}

export function tenantSessionChangeErrorMessage(error = {}) {
  const status = Number(error?.status || 0);
  if (status === 401) return "租户 API 返回 401，请检查租户 API Key。";
  if (status === 403) return "租户 API 返回 403，场次不存在、不属于当前租户，或当前 Key 无权限修改。";
  if (status === 429) return "租户 API 返回 429，请稍后重试。";
  return `租户 API 修改场次失败：${status || "未知"}`;
}

export async function fetchTenantSessionDetail({ apiBase, sessionId, requestJson, login }) {
  const base = String(apiBase || "").replace(/\/+$/, "");
  return await requestJson(
    login,
    `${base}/tenant/api/session/${encodeURIComponent(sessionId)}/`,
    { method: "GET" },
    `读取场次详情 ${sessionId}`,
  );
}

function tenantSessionId(value = {}) {
  return String(value?.id ?? value?.session_id ?? value?.sessionId ?? "").trim();
}

function tenantSessionList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["sessions", "results", "data", "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

export async function fetchTenantSessionDetailWithListFallback(options = {}) {
  try {
    return await fetchTenantSessionDetail(options);
  } catch (detailError) {
    const base = String(options.apiBase || "").replace(/\/+$/, "");
    const sessionId = String(options.sessionId || "").trim();
    const payload = await options.requestJson(
      options.login,
      `${base}/tenant/api/session/?session_ids=${encodeURIComponent(sessionId)}`,
      { method: "GET" },
      `从场次列表读取 ${sessionId}`,
    );
    const detail = tenantSessionList(payload).find((item) => tenantSessionId(item) === sessionId);
    if (detail) return detail;
    throw detailError;
  }
}

export async function putTenantSessionDetail({ apiBase, sessionId, payload, requestJson, login }) {
  const base = String(apiBase || "").replace(/\/+$/, "");
  const safePayload = sessionChangePatchPayload(payload);
  if (!Object.keys(safePayload).length) throw new Error("修改场次信息失败：没有可提交的变更字段");
  return await requestJson(
    login,
    `${base}/tenant/api/session/${encodeURIComponent(sessionId)}/`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safePayload),
    },
    `修改场次信息 ${sessionId}`,
  );
}
