import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { enableSessionVideoRecording } from "./session_video_recording.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));

test("video recording update changes only save_video through the tenant API", async () => {
  const calls = [];
  const login = { tenantApiKey: "test-key" };
  const result = await enableSessionVideoRecording({
    apiBase: "https://eztest.cn/",
    login,
    sessionId: "432073",
    requestJson: async (...args) => {
      calls.push(args);
      return { id: 432073, url: "https://eztest.cn/exam/test/" };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], login);
  assert.equal(calls[0][1], "https://eztest.cn/tenant/api/session/432073/");
  assert.deepEqual(calls[0][2], {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_video: true }),
  });
  assert.equal(calls[0][3], "开启正式考试视频录制 432073");
  assert.equal(result.sessionId, "432073");
});

test("video recording update requires a formal session id", async () => {
  await assert.rejects(
    enableSessionVideoRecording({
      apiBase: "https://eztest.cn",
      login: {},
      sessionId: "",
      requestJson: async () => ({}),
    }),
    /缺少正式考试 session_id/,
  );
});

test("session creation enables recording only for a requested formal exam", () => {
  const serverSource = fs.readFileSync(path.join(serverDir, "easy_exam_server.mjs"), "utf8");
  const createBlock = serverSource.slice(
    serverSource.indexOf("const sessionId = extractSessionId(result)"),
    serverSource.indexOf("const createdSession = {", serverSource.indexOf("const sessionId = extractSessionId(result)")),
  );

  assert.match(createBlock, /item\.kind === "main" && item\.payload\.save_video === true/);
  assert.match(createBlock, /await enableSessionVideoRecording\(\{/);
});
