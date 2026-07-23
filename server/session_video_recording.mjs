export async function enableSessionVideoRecording({
  apiBase,
  login,
  sessionId,
  requestJson,
}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    throw new Error("开启视频录制失败：缺少正式考试 session_id");
  }
  if (typeof requestJson !== "function") {
    throw new Error("开启视频录制失败：缺少易考接口请求方法");
  }

  const base = String(apiBase || "https://eztest.cn").replace(/\/+$/, "");
  const result = await requestJson(
    login,
    `${base}/tenant/api/session/${encodeURIComponent(normalizedSessionId)}/`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ save_video: true }),
    },
    `开启正式考试视频录制 ${normalizedSessionId}`,
  );

  return { sessionId: normalizedSessionId, result };
}
