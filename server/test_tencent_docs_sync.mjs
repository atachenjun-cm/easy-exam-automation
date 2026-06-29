import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBatchUpdateRequests,
  buildTencentDocRows,
  syncExamConfigToTencentDocs,
} from "./tencent_docs_sync.mjs";

const config = {
  examName: "项目招聘考试",
  startTimeDisplay: "2026-07-01 09:00",
  endTimeDisplay: "2026-07-01 11:00",
  mockStartTimeDisplay: "2026-06-30 15:00",
  mockEndTimeDisplay: "2026-06-30 17:00",
  earlyLoginMinutes: 30,
  lateLimitMinutes: 20,
  examType: "客户端考试",
  clientExam: true,
  videoMonitor: true,
  hawkeye: true,
  loginVerifyMode: "考后公安验证",
  timeRule: "迟到扣时",
};

const created = [
  { kind: "main", id: "formal-1", name: "项目招聘考试", start: "2026-07-01 09:00", end: "2026-07-01 11:00" },
  { kind: "mock", id: "trial-1", name: "项目招聘考试-试考", start: "2026-06-30 15:00", end: "2026-06-30 17:00" },
];

test("builds one 27-column Tencent Docs row for each created session", () => {
  const rows = buildTencentDocRows({ config, created });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 27);
  assert.equal(rows[0][0], "项目招聘考试");
  assert.equal(rows[0][3], "正式");
  assert.equal(rows[0][8], "提前30分钟登录，允许迟到20分钟");
  assert.equal(rows[0][9], "2026-07-01 09:00-2026-07-01 11:00");
  assert.equal(rows[0][10], "120分钟");
  assert.equal(rows[0][11], "客户端，10次");
  assert.equal(rows[0][15], "formal-1");
  assert.equal(rows[0][17], "是");
  assert.equal(rows[0][26], "鹰眼");
  assert.equal(rows[1][3], "试考");
  assert.equal(rows[1][8], "不允许提前登录，无迟到限制");
  assert.equal(rows[1][15], "trial-1");
});

test("leaves AI cloud monitoring blank when hawkeye is disabled", () => {
  const rows = buildTencentDocRows({ config: { ...config, hawkeye: false }, created: [created[0]] });
  assert.equal(rows[0][26], "");
});

test("updates an existing session row and appends a new session to the first blank row", () => {
  const remoteRows = [
    Array.from({ length: 26 }, (_, index) => index === 0 ? "考试名称" : ""),
    Array.from({ length: 26 }, (_, index) => index === 15 ? "formal-1" : index === 0 ? "旧名称" : ""),
    Array(26).fill(""),
  ];

  const requests = buildBatchUpdateRequests({
    sheetId: "BB08J2",
    remoteRows,
    rows: buildTencentDocRows({ config, created }),
  });

  assert.deepEqual(requests.map((item) => item.updateRangeRequest.gridData.startRow), [1, 2]);
  assert.equal(requests[0].updateRangeRequest.sheetId, "BB08J2");
  assert.equal(requests[0].updateRangeRequest.gridData.rows[0].values[15].cellValue.text, "formal-1");
  assert.equal(requests[1].updateRangeRequest.gridData.rows[0].values[15].cellValue.text, "trial-1");
});

test("sync reads the sheet before submitting an idempotent batch update", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (!options.method || options.method === "GET") {
      if (String(url).endsWith("/A1:AA200")) {
        return new Response(JSON.stringify({
          gridData: {
            rows: [
              { values: [{ cellValue: { text: "考试名称" } }] },
              { values: Array.from({ length: 16 }, (_, index) => ({ cellValue: { text: index === 15 ? "formal-1" : "" } })) },
            ],
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).endsWith("/A201:AA400")) {
        return new Response(JSON.stringify({
          code: 400001,
          message: "invalid param error: 'range' invalid",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected read range: ${url}`);
    }
    return new Response(JSON.stringify({ responses: [{ updateRangeResponse: {} }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await syncExamConfigToTencentDocs({
    config,
    created: [created[0]],
    settings: {
      clientId: "client",
      accessToken: "token",
      openId: "open",
      fileId: "file",
      sheetId: "BB08J2",
    },
    fetchImpl,
  });

  assert.equal(result.updatedRows, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers["Access-Token"], "token");
  assert.ok(calls[0].url.endsWith("/A1:AA200"));
  assert.ok(calls[1].url.endsWith("/A201:AA400"));
  assert.equal(calls[2].options.method, "POST");
  assert.equal(JSON.parse(calls[2].options.body).requests.length, 1);
});
