import assert from "node:assert/strict";
import test from "node:test";

import { bindPapersToFormalSession, validatePaperBinding } from "./paper_binding.mjs";

const MISSING_FORM_CODES_MESSAGE = "科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次";

test("refreshes course form details and posts course_code with res form codes to formal session", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return {
        code: "20260725-04-01",
        name: "总会",
        res: [
          { code: "FORM-A", name: "总会试卷" },
          { code: "FORM-B", name: "总会备用卷" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "427535",
    courses: [{ name: "总会", code: "20260725-04-01", form_codes: ["OLD-LOCAL"] }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/courses/20260725-04-01/?apply=form");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/course/session/427535/");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    course_code: "20260725-04-01",
    form_codes: ["FORM-A", "FORM-B"],
  });
  assert.equal(calls.some((call) => call.url.endsWith("/tenant/api/course/") && call.options.method === "PUT"), false);
  assert.ok(logs.includes("[试卷绑定] GET /tenant/api/courses/20260725-04-01/?apply=form"));
  assert.ok(logs.includes("[试卷绑定] 科目=总会，course_code=20260725-04-01，form_codes=[FORM-A, FORM-B]"));
  assert.ok(logs.includes("[试卷绑定] POST /tenant/api/course/session/427535/"));
});

test("reads form codes from nested data res fields", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") return { data: { code: "C-01", res: [{ form_code: "F-01" }] } };
    return { ok: true };
  };

  await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "语文", code: "C-01" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    course_code: "C-01",
    form_codes: ["F-01"],
  });
});

test("rejects paper binding when apply=form returns no form codes", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { code: "20260725-04-01", res: [] };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "427535",
    courses: [{ name: "总会", code: "20260725-04-01" }],
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["20260725-04-01"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
});

test("does not partially bind when any course has no form codes", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (url.includes("C-01")) return { code: "C-01", res: [{ code: "F-01" }] };
    return { code: "C-02", res: [] };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "语文", code: "C-01" }, { name: "数学", code: "C-02" }],
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["C-02"] });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
});

test("validates paper binding inputs", () => {
  assert.throws(() => validatePaperBinding({ sessionId: "", courseCode: "C1", formCodes: ["F1"] }));
  assert.throws(() => validatePaperBinding({ sessionId: "S1", courseCode: "", formCodes: ["F1"] }));
  assert.throws(() => validatePaperBinding({ sessionId: "S1", courseCode: "C1", formCodes: [] }), {
    message: MISSING_FORM_CODES_MESSAGE,
  });
});
