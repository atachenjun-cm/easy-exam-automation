import assert from "node:assert/strict";
import test from "node:test";

import {
  bindCoursesToFormalSession,
  createSessionsThenConfigureCourses,
  validateCourseBinding,
} from "./course_session_binding.mjs";

test("creates the formal session and courses before the trial session", async () => {
  const order = [];
  const created = await createSessionsThenConfigureCourses({
    sessionPayloads: [{ kind: "main" }, { kind: "mock" }],
    createSession: async (item) => {
      order.push(item.kind);
      return { kind: item.kind, id: item.kind === "main" ? "formal-1" : "trial-1" };
    },
    configureCourses: async (formalSession) => {
      order.push("course");
      assert.equal(formalSession.id, "formal-1");
    },
  });

  assert.deepEqual(order, ["main", "course", "mock"]);
  assert.equal(created.length, 2);
});

test("does not create courses when formal session creation fails", async () => {
  const order = [];
  await assert.rejects(createSessionsThenConfigureCourses({
    sessionPayloads: [{ kind: "main" }, { kind: "mock" }],
    createSession: async (item) => {
      order.push(item.kind);
      if (item.kind === "main") throw new Error("formal failed");
      return { kind: item.kind, id: "trial-1" };
    },
    configureCourses: async () => order.push("course"),
  }), { message: "formal failed" });
  assert.deepEqual(order, ["main"]);
});

test("re-fetches course details and posts only course_code and form_codes", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return { data: { name: "语文", code: "20260619-01", form_codes: ["YW-001"] } };
    }
    return { ok: true };
  };

  await bindCoursesToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: 426039,
    courses: [{ name: "语文", code: "request-code", form_codes: ["语文试卷"] }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/courses/request-code/?apply=session");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/course/session/426039/");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    course_code: "20260619-01",
    form_codes: ["YW-001"],
  });
  assert.ok(logs.includes("[科目绑定] POST /tenant/api/course/session/426039/"));
  assert.ok(logs.includes('[科目绑定] payload = {"course_code":"20260619-01","form_codes":["YW-001"]}'));
  assert.ok(logs.includes("[科目绑定] httpStatus = 200"));
});

test("does not bind when refreshed details have no valid form codes", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { code: "20260619-01", form_codes: ["", null] };
  };

  const result = await bindCoursesToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "426039",
    courses: [{ code: "20260619-01" }],
    requestJson,
    emitLog: () => {},
  });
  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["20260619-01"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
});

test("treats a missing refreshed course detail as waiting for paper binding", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    const error = new Error("not found");
    error.status = 404;
    throw error;
  };
  const result = await bindCoursesToFormalSession({
    login: {}, apiBase: "https://eztest.cn", sessionId: "426039",
    courses: [{ code: "20260619-01" }], requestJson, emitLog: () => {},
  });
  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["20260619-01"] });
  assert.equal(calls.length, 1);
});

test("does not partially bind when any course has no form codes", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (url.includes("C-01")) return { code: "C-01", form_codes: ["F-01"] };
    return { code: "C-02", form_codes: [] };
  };
  const result = await bindCoursesToFormalSession({
    login: {}, apiBase: "https://eztest.cn", sessionId: "42",
    courses: [{ code: "C-01" }, { code: "C-02" }], requestJson, emitLog: () => {},
  });
  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["C-02"] });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
});

test("strictly rejects empty and non-string binding values", () => {
  assert.throws(() => validateCourseBinding({ sessionId: "", courseCode: "C1", formCodes: ["F1"] }));
  assert.throws(() => validateCourseBinding({ sessionId: "S1", courseCode: "", formCodes: ["F1"] }));
  assert.throws(() => validateCourseBinding({ sessionId: "S1", courseCode: "C1", formCodes: [] }));
  assert.throws(() => validateCourseBinding({ sessionId: "S1", courseCode: "C1", formCodes: [null] }));
  assert.throws(() => validateCourseBinding({ sessionId: "S1", courseCode: "C1", formCodes: [""] }));
});

test("rejects binding when there are no course codes to refresh", async () => {
  let requested = false;
  await assert.rejects(
    bindCoursesToFormalSession({
      login: {}, apiBase: "https://eztest.cn", sessionId: "S1", courses: [],
      requestJson: async () => { requested = true; }, emitLog: () => {},
    }),
    { message: "科目已创建，但绑定参数不合法，请检查 course_code / form_codes" },
  );
  assert.equal(requested, false);
});

test("logs response details and translates HTTP 400 binding errors", async () => {
  const logs = [];
  const requestJson = async (_login, _url, options) => {
    if (options.method === "GET") return { code: "20260619-01", form_codes: ["YW-001"] };
    const error = new Error("bad request");
    error.status = 400;
    error.detail = { msg: "参数错误" };
    throw error;
  };

  await assert.rejects(
    bindCoursesToFormalSession({
      login: {}, apiBase: "https://eztest.cn", sessionId: "426039",
      courses: [{ code: "20260619-01" }], requestJson,
      emitLog: (message) => logs.push(message),
    }),
    { message: "科目已创建，但绑定参数不合法，请检查 course_code / form_codes" },
  );
  assert.ok(logs.includes("[科目绑定] httpStatus = 400"));
  assert.ok(logs.includes('[科目绑定] responseBody = {"msg":"参数错误"}'));
});

test("logs the actual successful binding HTTP status", async () => {
  const logs = [];
  const requestJson = async (_login, _url, options) => {
    if (options.method === "GET") return { code: "C-01", form_codes: ["F-01"] };
    return { __tenantResponse: true, httpStatus: 201, body: { created: true } };
  };

  await bindCoursesToFormalSession({
    login: {}, apiBase: "https://eztest.cn", sessionId: "42",
    courses: [{ code: "C-01" }], requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.ok(logs.includes("[科目绑定] httpStatus = 201"));
  assert.ok(logs.includes('[科目绑定] responseBody = {"created":true}'));
});
