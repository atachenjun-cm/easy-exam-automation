import assert from "node:assert/strict";
import test from "node:test";

import { deleteTaskSessionsFromTenant } from "./session_deletion.mjs";

test("deletes each task session from EasyExam tenant API", async () => {
  const calls = [];
  const logs = [];
  const result = await deleteTaskSessionsFromTenant({
    login: {},
    apiBase: "https://eztest.cn",
    sessions: [
      { session_id: "426001", name: "正式考试", sessionType: "formal" },
      { session_id: "426002", name: "试考", sessionType: "trial" },
    ],
    requestJson: async (_login, url, options) => {
      calls.push({ url, options });
      return {};
    },
    emitLog: (message) => logs.push(message),
  });

  assert.deepEqual(calls.map((call) => [call.url, call.options.method]), [
    ["https://eztest.cn/tenant/api/session/426001/", "DELETE"],
    ["https://eztest.cn/tenant/api/session/426002/", "DELETE"],
  ]);
  assert.deepEqual(result.deletedSessionIds, ["426001", "426002"]);
  assert.ok(logs.includes("[API 删除] 易考场次删除成功：正式考试 / 426001"));
});

test("treats missing EasyExam sessions as already deleted", async () => {
  const result = await deleteTaskSessionsFromTenant({
    login: {},
    apiBase: "https://eztest.cn",
    sessions: [{ session_id: "426001", name: "正式考试" }],
    requestJson: async () => {
      const error = new Error("not found");
      error.status = 404;
      throw error;
    },
  });

  assert.deepEqual(result.deletedSessionIds, ["426001"]);
});

test("does not swallow non-404 EasyExam deletion errors", async () => {
  await assert.rejects(
    deleteTaskSessionsFromTenant({
      login: {},
      apiBase: "https://eztest.cn",
      sessions: [{ session_id: "426001", name: "正式考试" }],
      requestJson: async () => {
        const error = new Error("forbidden");
        error.status = 403;
        throw error;
      },
    }),
    /forbidden/,
  );
});
