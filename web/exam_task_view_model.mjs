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

export function aggregateExamSessions(sessions = []) {
  const tasks = new Map();
  for (const session of sessions) {
    if (!session?.taskId) continue;
    if (!tasks.has(session.taskId)) {
      tasks.set(session.taskId, {
        taskId: session.taskId,
        projectName: session.projectName || session.name || "未命名考试",
        sourceAccount: session.sourceAccount || "",
        sessions: [],
      });
    }
    tasks.get(session.taskId).sessions.push(session);
  }
  return [...tasks.values()].map((task) => ({
    ...task,
    formalSession: task.sessions.find((session) => session.sessionType === "formal") || null,
    trialSession: task.sessions.find((session) => session.sessionType === "trial") || null,
    status: aggregateStatus(task.sessions),
  }));
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
