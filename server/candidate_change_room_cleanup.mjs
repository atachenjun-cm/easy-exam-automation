function text(value) {
  return String(value ?? "").trim();
}

function normalizeRooms(payload) {
  const candidates = [
    payload?.rooms,
    payload?.data?.rooms,
    payload?.data,
    payload?.results,
    Array.isArray(payload) ? payload : null,
  ];
  return candidates.find(Array.isArray) || [];
}

export async function clearCandidateChangeRooms({
  login = {},
  apiBase,
  sessionId,
  requestJson,
} = {}) {
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId) throw new Error("缺少场次编号，不能清空分班。");
  if (typeof requestJson !== "function") throw new Error("缺少易考请求方法，不能清空分班。");
  const base = text(apiBase).replace(/\/+$/, "");
  const url = `${base}/tenant/api/session/${encodeURIComponent(normalizedSessionId)}/rooms/`;
  const before = normalizeRooms(await requestJson(login, url, { method: "GET" }, "读取本场次分班"));
  if (!before.length) return { status: "already_empty", removedCount: 0 };

  await requestJson(
    login,
    url,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_ids: [] }),
    },
    "清空本场次分班",
  );
  const after = normalizeRooms(await requestJson(login, url, { method: "GET" }, "回读本场次分班"));
  if (after.length) {
    const error = new Error(`本场次仍有 ${after.length} 个班级，清空分班未确认完成。`);
    error.status = 502;
    throw error;
  }
  return { status: "cleared", removedCount: before.length };
}
