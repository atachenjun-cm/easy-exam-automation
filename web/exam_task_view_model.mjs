const STATUS_PRIORITY = {
  failed: 5,
  running: 4,
  waiting_manual: 3,
  success: 2,
  pending: 1,
};

function aggregateStatus(sessions) {
  const statuses = sessions.map((session) => session.status || "pending");
  if (sessions.length && statuses.every((status) => status === "success")) return "success";
  return statuses.reduce(
    (selected, status) =>
      (STATUS_PRIORITY[status] || 1) > (STATUS_PRIORITY[selected] || 1) ? status : selected,
    "pending",
  );
}

function parseExamTime(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const text = String(value).trim();
  const localMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, year, month, day, hour, minute, second = "0"] = localMatch;
    const localTime = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime();
    return Number.isFinite(localTime) ? localTime : Number.POSITIVE_INFINITY;
  }
  const normalized = text.replace(/\//g, "-").replace(" ", "T");
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

export function sortTaskLogsNewestFirst(logs = []) {
  return logs
    .map((log, index) => ({ log, index, time: parseExamTime(log?.time) }))
    .sort((left, right) => {
      if (!Number.isFinite(left.time) && !Number.isFinite(right.time)) return left.index - right.index;
      if (!Number.isFinite(left.time)) return 1;
      if (!Number.isFinite(right.time)) return -1;
      return right.time - left.time || left.index - right.index;
    })
    .map(({ log }) => log);
}

function resolveTaskProgress(sessions) {
  const session = sessions.find((item) => Number.isFinite(Number(item?.progress)));
  return session ? Number(session.progress) : 0;
}

function textValue(value) {
  return String(value ?? "").trim();
}

export function unifiedExamCodeFromUrl(value) {
  const match = textValue(value).match(/\/exam\/(\d+)\/uniform\/login\/?/i);
  return match ? `E${match[1]}` : "";
}

export function isUnifiedExamAddress(taskOrSession = {}) {
  const config = taskOrSession.config || {};
  const addressText = textValue(config.examAddress || config.examUrlType);
  if (addressText.includes("独立")) return false;
  if (addressText.includes("统一")) return true;
  if (config.unifiedExamAddress !== undefined) return Boolean(config.unifiedExamAddress);
  return Boolean(
    unifiedExamCodeFromUrl(taskOrSession.url) ||
      unifiedExamCodeFromUrl(config.examUrl) ||
      config.unifiedExamCode ||
      config.unifiedExamPassword ||
      taskOrSession.unified_exam_code ||
      taskOrSession.unifiedExamCode,
  );
}

export function resolveUnifiedExamCode(taskOrSession = {}) {
  const config = taskOrSession.config || {};
  const urlCode = unifiedExamCodeFromUrl(taskOrSession.url) || unifiedExamCodeFromUrl(config.examUrl);
  if (urlCode) return urlCode;

  const explicitUnifiedCode = textValue(
    config.unifiedExamCode ||
      config.unifiedExamPassword ||
      taskOrSession.unified_exam_code ||
      taskOrSession.unifiedExamCode,
  );
  if (explicitUnifiedCode) return explicitUnifiedCode;
  if (!isUnifiedExamAddress(taskOrSession)) return "";

  return textValue(
      config.examPassword ||
      config.examCode ||
      taskOrSession.exam_code ||
      taskOrSession.examCode,
  );
}

export function isExamTaskEnded(task, now = new Date()) {
  const formalSessions = Array.isArray(task?.formalSessions)
    ? task.formalSessions
    : (task?.sessions || []).filter((session) => session.sessionType === "formal");
  if (!formalSessions.length) return false;
  return formalSessions.every((session) => {
    const endTime = parseExamTime(session.end);
    const startTime = parseExamTime(session.start);
    const comparisonTime = Number.isFinite(endTime) ? endTime : startTime;
    return Number.isFinite(comparisonTime) && comparisonTime < now.getTime();
  });
}

function sessionRequirementOrder(left, right) {
  return Number(left?.requirementIndex || 0) - Number(right?.requirementIndex || 0);
}

function latestSessionTime(sessions = []) {
  const times = sessions.map((session) => parseExamTime(session?.start)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : Number.POSITIVE_INFINITY;
}

export function aggregateExamSessions(sessions = []) {
  const tasks = new Map();
  for (const session of sessions) {
    if (!session?.taskId) continue;
    if (!tasks.has(session.taskId)) {
      tasks.set(session.taskId, {
        taskId: session.taskId,
        projectName: session.projectName || session.name || "未命名考试",
        sourceAccount: session.sourceAccount || "",
        config: session.config || {},
        sessions: [],
      });
    }
    const task = tasks.get(session.taskId);
    if (!Object.keys(task.config || {}).length && session.config) task.config = session.config;
    task.sessions.push(session);
  }
  return [...tasks.values()]
    .map((task, index) => {
      const formalSessions = task.sessions.filter((session) => session.sessionType === "formal").sort(sessionRequirementOrder);
      const trialSessions = task.sessions.filter((session) => session.sessionType === "trial").sort(sessionRequirementOrder);
      const formalSession = formalSessions[0] || null;
      return {
        ...task,
        formalSession,
        formalSessions,
        trialSession: trialSessions[0] || null,
        trialSessions,
        status: aggregateStatus(task.sessions),
        progress: resolveTaskProgress(task.sessions),
        unifiedExamCode: resolveUnifiedExamCode(task) || task.sessions.map(resolveUnifiedExamCode).find(Boolean) || "",
        sortIndex: index,
      };
    })
    .sort((left, right) => {
      const leftTime = latestSessionTime(left.formalSessions);
      const rightTime = latestSessionTime(right.formalSessions);
      if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return left.sortIndex - right.sortIndex;
      if (!Number.isFinite(leftTime)) return 1;
      if (!Number.isFinite(rightTime)) return -1;
      return rightTime - leftTime || left.sortIndex - right.sortIndex;
    })
    .map(({ sortIndex, ...task }) => task);
}

export function matchesExamTask(task, query = "") {
  const normalized = String(query).trim().toLowerCase();
  if (!normalized) return true;
  return [
    task.projectName,
    task.sourceAccount,
    ...task.sessions.flatMap((session) => [session.name, session.session_id]),
  ].some((value) => String(value || "").toLowerCase().includes(normalized));
}

function examTaskRequirementCount(task = {}) {
  const configured = Array.isArray(task?.config?.examRequirements) ? task.config.examRequirements.length : 0;
  const sessionCount = (task?.sessions || []).reduce(
    (count, session) => Math.max(count, Number(session?.requirementIndex || 0) + 1),
    0,
  );
  const progressCount = (task?.steps || []).reduce((count, step) => {
    const indexes = Object.keys(step?.requirementProgress || {})
      .map((key) => Number(key))
      .filter((index) => Number.isInteger(index) && index >= 0);
    return indexes.length ? Math.max(count, Math.max(...indexes) + 1) : count;
  }, 0);
  return Math.max(configured, sessionCount, progressCount, 1);
}

function examTaskRequirementConfig(task = {}, requirementIndex = 0) {
  return task?.config?.examRequirements?.[requirementIndex]?.config || task?.config || {};
}

function examTaskSession(task = {}, sessionType = "formal", requirementIndex = 0) {
  return (task?.sessions || []).find((session) => (
    session?.sessionType === sessionType &&
    Number(session?.requirementIndex || 0) === Number(requirementIndex)
  )) || null;
}

function examTaskTypeRequirementIndexes(task = {}, sessionType = "formal") {
  const indexes = Array.from({ length: examTaskRequirementCount(task) }, (_, index) => index);
  if (sessionType !== "trial") return indexes;
  return indexes.filter((index) => (
    Boolean(examTaskRequirementConfig(task, index)?.mockExamEnabled) ||
    Boolean(examTaskSession(task, "trial", index))
  ));
}

function examTaskStepStatus(task = {}, stepKey = "", requirementIndex = 0, requirementCount = 1) {
  const step = (task?.steps || []).find((item) => item?.stepKey === stepKey);
  return step?.requirementProgress?.[String(requirementIndex)]?.status ||
    (requirementCount === 1 ? step?.status : "") ||
    "pending";
}

function summarizeExamTaskProgress(statuses = []) {
  if (!statuses.length) return { enabled: false, completed: 0, total: 0, tone: "disabled" };
  const completed = statuses.filter((status) => status === "success" || status === "skipped").length;
  let tone = "pending";
  if (statuses.some((status) => status === "failed")) tone = "failed";
  else if (completed === statuses.length) tone = "complete";
  else if (statuses.some((status) => status === "waiting_manual")) tone = "warning";
  else if (statuses.some((status) => status === "running") || completed > 0) tone = "running";
  return { enabled: true, completed, total: statuses.length, tone };
}

export function examTaskTypeProgress(task = {}, sessionType = "formal") {
  const indexes = examTaskTypeRequirementIndexes(task, sessionType);
  if (!indexes.length) {
    const disabled = summarizeExamTaskProgress([]);
    return { enabled: false, sessionCreation: disabled, candidateImport: disabled, paperBinding: disabled };
  }

  const requirementCount = indexes.length;
  const sessionCreation = summarizeExamTaskProgress(indexes.map((index) => (
    textValue(examTaskSession(task, sessionType, index)?.session_id || examTaskSession(task, sessionType, index)?.id)
      ? "success"
      : "pending"
  )));
  const candidateStepKey = sessionType === "formal" ? "formal_candidate_import" : "trial_candidate_import";
  const candidateImport = summarizeExamTaskProgress(indexes.map((index) => (
    examTaskStepStatus(task, candidateStepKey, index, requirementCount)
  )));
  const paperBinding = sessionType === "formal"
    ? summarizeExamTaskProgress(indexes.map((index) => {
        const saved = Array.isArray(task?.config?.paperFormBinds) ? task.config.paperFormBinds[index] : null;
        const paperState = saved || (index === 0 ? task?.config?.paperFormBind : null) || {};
        return paperState.status || "pending";
      }))
    : summarizeExamTaskProgress(indexes.map((index) => (
        examTaskStepStatus(task, "trial_paper_bind", index, requirementCount)
      )));

  return { enabled: true, sessionCreation, candidateImport, paperBinding };
}

function examTaskSyncPreviewState(task = {}) {
  if (task?.examListSyncPreviewLoaded) {
    return {
      loaded: true,
      preview: task.examListSyncPreview,
      error: textValue(task.examListSyncPreviewError),
    };
  }
  const cached = task?.config?.examListSyncPreviewCache;
  if (cached && typeof cached === "object" && Array.isArray(cached.sessions)) {
    return { loaded: true, preview: cached, error: "" };
  }
  return { loaded: false, preview: null, error: "" };
}

export function examTaskSyncCheckedAt(task = {}) {
  const state = examTaskSyncPreviewState(task);
  if (!state.loaded) return "";
  return textValue(state.preview?.checkedAt)
    || textValue(state.preview?.sessions?.find((session) => session?.checkedAt)?.checkedAt);
}

export function examTaskSyncDifference(task = {}, sessionType = "formal", enabled = true) {
  if (!enabled) return { label: "--", tone: "disabled", interactive: false, sessionId: "" };
  const state = examTaskSyncPreviewState(task);
  const preview = state.preview;
  const sessions = Array.isArray(preview?.sessions)
    ? preview.sessions.filter((item) => item?.sessionType === sessionType)
    : [];
  if (!state.loaded) return { label: "--", tone: "pending", interactive: false, sessionId: "" };

  const differenceCountForSession = (item) => Number.isFinite(Number(item?.differenceCount))
    ? Math.max(Number(item.differenceCount), 0)
    : Array.isArray(item?.diff) ? item.diff.length : 0;
  const differences = sessions.filter((item) => !item?.error && differenceCountForSession(item) > 0);
  const differenceCount = differences.reduce((count, item) => count + differenceCountForSession(item), 0);
  const failures = sessions.filter((item) => item?.error);
  if (differenceCount) {
    return {
      label: String(differenceCount),
      tone: failures.length ? "failed" : "difference",
      interactive: true,
      sessionId: textValue(differences[0]?.sessionId),
    };
  }
  if (failures.length || state.error) {
    const fallbackSession = (task?.sessions || []).find((session) => session?.sessionType === sessionType);
    return {
      label: "!",
      tone: "failed",
      interactive: true,
      sessionId: textValue(failures[0]?.sessionId || fallbackSession?.session_id),
    };
  }
  if (!sessions.length) return { label: "--", tone: "pending", interactive: false, sessionId: "" };
  return { label: "0", tone: "complete", interactive: false, sessionId: "" };
}

export function resolveCandidateTaskContext(task, requestedSessionId = "") {
  const selectedSession = (task?.sessions || []).find(
    (session) =>
      ["formal", "trial"].includes(session.sessionType) &&
      String(session.session_id || "").trim() &&
      String(session.session_id) === String(requestedSessionId),
  ) || null;
  return {
    sessions: selectedSession ? [selectedSession] : [],
    selectedSession,
  };
}
