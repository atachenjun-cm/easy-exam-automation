function uniqueSessionsWithIds(sessions = []) {
  const seen = new Set();
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => ({
      sessionId: String(session?.session_id || session?.id || "").trim(),
      name: String(session?.name || "").trim(),
      sessionType: String(session?.sessionType || session?.session_type || "").trim(),
    }))
    .filter((session) => {
      if (!session.sessionId || seen.has(session.sessionId)) return false;
      seen.add(session.sessionId);
      return true;
    });
}

export async function deleteTaskSessionsFromTenant({
  login,
  apiBase,
  sessions,
  requestJson,
  emitLog = () => {},
}) {
  const targets = uniqueSessionsWithIds(sessions);
  const deletedSessionIds = [];
  for (const session of targets) {
    const label = `${session.name || session.sessionType || "考试场次"} / ${session.sessionId}`;
    emitLog(`[API 删除] 准备删除易考场次：${label}`);
    try {
      await requestJson(
        login,
        `${apiBase}/tenant/api/session/${encodeURIComponent(session.sessionId)}/`,
        { method: "DELETE" },
        `删除考试场次 ${session.sessionId}`,
      );
      emitLog(`[API 删除] 易考场次删除成功：${label}`);
      deletedSessionIds.push(session.sessionId);
    } catch (error) {
      if (error?.status === 404) {
        emitLog(`[API 删除] 易考场次已不存在，继续清理本地记录：${label}`);
        deletedSessionIds.push(session.sessionId);
        continue;
      }
      throw error;
    }
  }
  return { deletedSessionIds };
}

export { uniqueSessionsWithIds };
