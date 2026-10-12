import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  appendCourseChangeHistory,
  applyTenantCourseChanges,
  buildCourseChangePlan,
  courseRequirementChangeForTaskSession,
  enrichTaskCourseRequirementChanges,
  fetchTenantCourseSnapshot,
  fetchTenantCourseSnapshots,
  normalizeCourseChangeNames,
  requirementCourseNames,
  taskCoursesForChange,
  tenantCourseChangeErrorMessage,
} from "./course_change.mjs";

test("course names normalize common requirement separators", () => {
  assert.deepEqual(normalizeCourseChangeNames(" 综合能力、专业知识\n英语 "), ["综合能力", "专业知识", "英语"]);
  assert.deepEqual(normalizeCourseChangeNames([" 综合能力 ", "", "专业知识"]), ["综合能力", "专业知识"]);
});

test("course change uses persisted created codes instead of regenerated requirement codes", () => {
  const task = {
    config: {
      courses: [{ name: "旧科目", code: "20260803-01-01", form_codes: ["FORM-OLD"] }],
      examRequirements: [{
        fields: { "科目信息": "新科目" },
        config: {
          subjects: ["新科目"],
          courses: [{ name: "新科目", code: "20260802-01-01", form_codes: ["20260802-01-01"] }],
        },
      }],
    },
    steps: [],
  };

  assert.deepEqual(taskCoursesForChange(task, 0).map((course) => course.code), ["20260803-01-01"]);
  assert.deepEqual(requirementCourseNames(task, 0), ["新科目"]);
});

test("course requirement changes are independent from trial and clear after matching course history", () => {
  const task = {
    config: {
      examRequirements: [{ config: { subjects: ["新科目"] } }],
      projectSourceChangeHistory: [{
        changeId: "course-change-1",
        source: "examRequirement",
        requirementIndex: 0,
        changedAt: "2026-07-29T08:56:30.037Z",
        changes: [{ field: "科目信息", before: "旧科目", after: "新科目" }],
      }],
    },
    sessions: [
      { session_id: "432821", sessionType: "formal", requirementIndex: 0 },
      { session_id: "432822", sessionType: "trial", requirementIndex: 0 },
    ],
    steps: [],
  };

  const enriched = enrichTaskCourseRequirementChanges(task);
  assert.equal(enriched.sessions[0].courseRequirementChange.pending, true);
  assert.deepEqual(enriched.sessions[0].courseRequirementChange.suggestedNames, ["新科目"]);
  assert.equal(enriched.sessions[1].courseRequirementChange.pending, false);
  assert.equal(enriched.courseRequirementChangeSummary.pendingCount, 1);

  task.steps = [{
    stepKey: "session_change",
    result: {
      history: [{
        courseRequirementIndex: 0,
        courseRequirementChangeId: "course-change-1",
        courseRequirementChangeApplied: true,
      }],
    },
  }];
  assert.equal(courseRequirementChangeForTaskSession(task, task.sessions[0]).pending, false);
});

test("course requirement reminder clears when created courses already match the latest requirement", () => {
  const task = {
    config: {
      courses: [{ code: "20260812-01-01", name: "OPA测评专业人士情绪倾向" }],
      examRequirements: [{ config: { subjects: ["OPA测评专业人士情绪倾向"] } }],
      projectSourceChangeHistory: [{
        changeId: "course-change-before-create",
        source: "examRequirement",
        requirementIndex: 0,
        changedAt: "2026-08-11T08:56:30.037Z",
        changes: [{ field: "科目信息", before: "OPA测评", after: "OPA测评专业人士情绪倾向" }],
      }],
    },
    sessions: [{ session_id: "434954", sessionType: "formal", requirementIndex: 0 }],
    steps: [],
  };

  const enriched = enrichTaskCourseRequirementChanges(task);
  assert.equal(enriched.sessions[0].courseRequirementChange.pending, false);
  assert.equal(enriched.courseRequirementChangeSummary.pendingCount, 0);
});

test("course requirement reminder uses current tenant course names when provided", () => {
  const task = {
    config: {
      courses: [{ code: "20260812-01-01", name: "旧科目" }],
      examRequirements: [{ config: { subjects: ["新科目"] } }],
      projectSourceChangeHistory: [{
        changeId: "course-change-live-preview",
        source: "examRequirement",
        requirementIndex: 0,
        changes: [{ field: "科目信息", before: "旧科目", after: "新科目" }],
      }],
    },
    steps: [],
  };
  const session = { session_id: "434954", sessionType: "formal", requirementIndex: 0 };

  assert.equal(courseRequirementChangeForTaskSession(task, session).pending, true);
  assert.equal(
    courseRequirementChangeForTaskSession(task, session, [{ code: "20260812-01-01", name: "新科目" }]).pending,
    false,
  );
});

test("tenant course query reads session and form details through EasyExam APIs", async () => {
  const calls = [];
  const snapshot = await fetchTenantCourseSnapshot({
    apiBase: "https://eztest.cn/",
    code: "20260803-01-01",
    login: { tenantApiKey: "test" },
    requestJson: async (_login, url, options) => {
      calls.push({ url, method: options.method });
      if (url.endsWith("?apply=session")) {
        return { code: "20260803-01-01", name: "旧科目", res: [{ id: 432821 }] };
      }
      return { code: "20260803-01-01", name: "旧科目", res: [{ code: "FORM-A" }, { code: "FORM-B" }] };
    },
  });

  assert.deepEqual(snapshot, {
    code: "20260803-01-01",
    name: "旧科目",
    form_codes: ["FORM-A", "FORM-B"],
    session_count: 1,
    session_ids: ["432821"],
    session_bindings: [{
      session_id: "432821",
      entries_count: null,
      course_entries: null,
    }],
  });
  assert.deepEqual(calls, [
    { url: "https://eztest.cn/tenant/api/courses/20260803-01-01/?apply=session", method: "GET" },
    { url: "https://eztest.cn/tenant/api/courses/20260803-01-01/?apply=form", method: "GET" },
  ]);
});

test("course update preserves queried form codes and verifies the result without session PUT", async () => {
  const calls = [];
  let currentName = "旧科目";
  const requestJson = async (_login, url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    assert.equal(url.includes("/tenant/api/session/"), false);
    if (options.method === "PUT") {
      currentName = JSON.parse(options.body).name;
      return { code: "20260803-01-01", name: currentName, form_codes: ["FORM-A"] };
    }
    if (url.endsWith("?apply=session")) {
      return { code: "20260803-01-01", name: currentName, res: [{ id: 432821 }] };
    }
    return { code: "20260803-01-01", name: currentName, res: [{ code: "FORM-A" }] };
  };
  const snapshots = await fetchTenantCourseSnapshots({
    apiBase: "https://eztest.cn",
    courses: [{ code: "20260803-01-01", name: "旧科目" }],
    login: {},
    requestJson,
  });
  const result = await applyTenantCourseChanges({
    apiBase: "https://eztest.cn",
    snapshots,
    requestedNames: ["新科目"],
    login: {},
    requestJson,
  });

  const putCall = calls.find((call) => call.method === "PUT");
  assert.equal(putCall.url, "https://eztest.cn/tenant/api/course/");
  assert.deepEqual(putCall.body, {
    code: "20260803-01-01",
    name: "新科目",
    form_codes: ["FORM-A"],
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.diff, [{
    field: "course_name",
    label: "科目信息",
    code: "20260803-01-01",
    before: "旧科目",
    after: "新科目",
  }]);
  assert.equal(result.courses[0].name, "新科目");
});

test("course increase preserves matching courses even when a new subject is inserted first", () => {
  const plan = buildCourseChangePlan([
    { code: "C1", name: "原科目", form_codes: [] },
  ], ["新增科目", "原科目"]);

  assert.equal(plan.length, 2);
  assert.equal(plan[0].added, true);
  assert.equal(plan[0].afterName, "新增科目");
  assert.equal(plan[1].before.code, "C1");
  assert.equal(plan[1].changed, false);
});

test("course decrease preserves matching courses and marks only the remainder for deletion", () => {
  const plan = buildCourseChangePlan([
    { code: "C1", name: "科目一", form_codes: [] },
    { code: "C2", name: "科目二", form_codes: [] },
  ], ["科目二"]);

  assert.equal(plan.length, 2);
  assert.equal(plan[0].before.code, "C2");
  assert.equal(plan[0].removed, false);
  assert.equal(plan[1].before.code, "C1");
  assert.equal(plan[1].removed, true);
});

test("course increase creates only the missing course and binds it to the formal session", async () => {
  const calls = [];
  const state = new Map([
    ["20260904-01-01", {
      name: "基础物业岗",
      forms: ["FORM-A"],
      sessions: ["437214"],
    }],
  ]);
  const requestJson = async (_login, url, options) => {
    const method = options.method;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method, body });
    if (url.endsWith("/tenant/api/courses/?apply=session")) {
      return { results: [...state].map(([code, value]) => ({ code, name: value.name })) };
    }
    const courseMatch = url.match(/\/tenant\/api\/courses\/([^/]+)\/\?apply=(session|form)$/);
    if (courseMatch) {
      const code = decodeURIComponent(courseMatch[1]);
      const course = state.get(code);
      if (!course) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return courseMatch[2] === "session"
        ? {
          code,
          name: course.name,
          res: course.sessions.map((id) => ({ id, entries_count: 0, course_entries: 0 })),
        }
        : { code, name: course.name, res: course.forms.map((formCode) => ({ code: formCode })) };
    }
    if (url.endsWith("/tenant/api/course/") && method === "POST") {
      state.set(body.code, { name: body.name, forms: body.form_codes, sessions: [] });
      return { code: body.code, name: body.name };
    }
    if (url.endsWith("/tenant/api/course/session/437214/") && method === "POST") {
      state.get(body.course_code).sessions.push("437214");
      return { ok: true };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  const snapshots = await fetchTenantCourseSnapshots({
    apiBase: "https://eztest.cn",
    courses: [{ code: "20260904-01-01", name: "基础物业岗" }],
    login: {},
    requestJson,
  });
  const persisted = [];
  const result = await applyTenantCourseChanges({
    apiBase: "https://eztest.cn",
    snapshots,
    requestedNames: ["基础物业岗", "物业运营管理岗"],
    sessionId: "437214",
    creationConfig: { startTimeDisplay: "2026/09/04 09:00" },
    login: {},
    requestJson,
    onCoursesEnsured: async (courses) => persisted.push(courses.map((course) => course.code)),
  });

  assert.deepEqual(result.courses.map((course) => course.name), ["基础物业岗", "物业运营管理岗"]);
  assert.deepEqual(result.createdCourseCodes, ["20260904-01-02"]);
  assert.deepEqual(result.boundCourseCodes, ["20260904-01-02"]);
  assert.deepEqual(result.diff, [{
    field: "course_add",
    label: "科目信息",
    code: "20260904-01-02",
    before: "",
    after: "物业运营管理岗",
  }]);
  assert.equal(calls.filter((call) => call.method === "POST" && call.url.endsWith("/tenant/api/course/")).length, 1);
  assert.deepEqual(
    calls.filter((call) => call.url.endsWith("/tenant/api/course/session/437214/")).map((call) => call.body.course_code),
    ["20260904-01-02"],
  );
  assert.ok(persisted.some((codes) => codes.includes("20260904-01-02")));
});

test("course decrease deletes only an unused course bound to the current formal session", async () => {
  const calls = [];
  const deleted = new Set();
  const requestJson = async (_login, url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options.method, body });
    if (url.endsWith("/tenant/api/course/") && options.method === "DELETE") {
      body.codes.forEach((code) => deleted.add(code));
      return { ok: true };
    }
    const courseMatch = url.match(/\/tenant\/api\/courses\/([^/]+)\/\?apply=(session|form)$/);
    if (courseMatch) {
      const code = decodeURIComponent(courseMatch[1]);
      if (deleted.has(code)) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return courseMatch[2] === "session"
        ? { code, name: "保留科目", res: [{ id: "S1", entries_count: 0, course_entries: 0 }] }
        : { code, name: "保留科目", res: [] };
    }
    throw new Error(`unexpected request: ${options.method} ${url}`);
  };
  const snapshots = [
    {
      code: "C1",
      name: "保留科目",
      form_codes: [],
      session_ids: ["S1"],
      session_bindings: [{ session_id: "S1", entries_count: 0, course_entries: 0 }],
    },
    {
      code: "C2",
      name: "删除科目",
      form_codes: ["FORM-B"],
      session_ids: ["S1"],
      session_bindings: [{ session_id: "S1", entries_count: 0, course_entries: 0 }],
    },
  ];
  const persisted = [];
  const result = await applyTenantCourseChanges({
    apiBase: "https://eztest.cn",
    snapshots,
    requestedNames: ["保留科目"],
    sessionId: "S1",
    login: {},
    requestJson,
    onCoursesEnsured: async (courses) => persisted.push(courses.map((course) => course.code)),
  });

  assert.deepEqual(result.deletedCourseCodes, ["C2"]);
  assert.deepEqual(result.courses.map((course) => course.code), ["C1"]);
  assert.deepEqual(result.diff, [{
    field: "course_remove",
    label: "科目信息",
    code: "C2",
    before: "删除科目",
    after: "",
  }]);
  assert.deepEqual(calls.find((call) => call.method === "DELETE").body, { codes: ["C2"] });
  assert.deepEqual(persisted.at(-1), ["C1"]);
});

test("course decrease stops before deletion when the course is shared or has candidates", async () => {
  const baseCourse = {
    code: "C1",
    name: "保留科目",
    form_codes: [],
    session_ids: ["S1"],
    session_bindings: [{ session_id: "S1", entries_count: 0, course_entries: 0 }],
  };
  const sharedCourse = {
    code: "C2",
    name: "共享科目",
    form_codes: [],
    session_ids: ["S1", "S2"],
    session_bindings: [
      { session_id: "S1", entries_count: 0, course_entries: 0 },
      { session_id: "S2", entries_count: 0, course_entries: 0 },
    ],
  };
  let requested = false;
  await assert.rejects(
    applyTenantCourseChanges({
      apiBase: "https://eztest.cn",
      snapshots: [baseCourse, sharedCourse],
      requestedNames: ["保留科目"],
      sessionId: "S1",
      login: {},
      requestJson: async () => { requested = true; },
    }),
    /还绑定了其他场次/,
  );
  assert.equal(requested, false);

  const assignedCourse = {
    ...sharedCourse,
    name: "有考生科目",
    session_ids: ["S1"],
    session_bindings: [{ session_id: "S1", entries_count: 3, course_entries: 2 }],
  };
  await assert.rejects(
    applyTenantCourseChanges({
      apiBase: "https://eztest.cn",
      snapshots: [baseCourse, assignedCourse],
      requestedNames: ["保留科目"],
      sessionId: "S1",
      login: {},
      requestJson: async () => { requested = true; },
    }),
    /已有 2 名考生/,
  );
});

test("course decrease persists confirmed deletions so a later failure can be retried", async () => {
  const snapshots = [
    {
      code: "C1",
      name: "保留科目",
      form_codes: [],
      session_ids: ["S1"],
      session_bindings: [{ session_id: "S1", entries_count: 0, course_entries: 0 }],
    },
    {
      code: "C2",
      name: "删除科目一",
      form_codes: [],
      session_ids: ["S1"],
      session_bindings: [{ session_id: "S1", entries_count: 0, course_entries: 0 }],
    },
    {
      code: "C3",
      name: "删除科目二",
      form_codes: [],
      session_ids: ["S1"],
      session_bindings: [{ session_id: "S1", entries_count: 0, course_entries: 0 }],
    },
  ];
  const deleted = new Set();
  const persisted = [];
  const requestJson = async (_login, url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.endsWith("/tenant/api/course/") && options.method === "DELETE") {
      if (body.codes[0] === "C3") {
        const error = new Error("temporary failure");
        error.status = 503;
        throw error;
      }
      deleted.add(body.codes[0]);
      return { ok: true };
    }
    const courseMatch = url.match(/\/tenant\/api\/courses\/([^/]+)\/\?apply=(session|form)$/);
    if (!courseMatch) throw new Error(`unexpected request: ${options.method} ${url}`);
    const code = decodeURIComponent(courseMatch[1]);
    if (deleted.has(code)) {
      const error = new Error("not found");
      error.status = 404;
      throw error;
    }
    return courseMatch[2] === "session"
      ? { code, name: "保留科目", res: [{ id: "S1", entries_count: 0, course_entries: 0 }] }
      : { code, name: "保留科目", res: [] };
  };

  await assert.rejects(
    applyTenantCourseChanges({
      apiBase: "https://eztest.cn",
      snapshots,
      requestedNames: ["保留科目"],
      sessionId: "S1",
      login: {},
      requestJson,
      onCoursesEnsured: async (courses) => persisted.push(courses.map((course) => course.code)),
    }),
    (error) => error.status === 503 && error.remoteModified === true,
  );
  assert.deepEqual(persisted.at(-1), ["C1", "C3"]);
});

test("missing form binding shape stops updates to avoid clearing papers", async () => {
  await assert.rejects(
    fetchTenantCourseSnapshot({
      apiBase: "https://eztest.cn",
      code: "C1",
      login: {},
      requestJson: async (_login, url) => (
        url.endsWith("?apply=session")
          ? { code: "C1", name: "科目一", res: [] }
          : { code: "C1", name: "科目一" }
      ),
    }),
    /为避免清空绑定已停止修改/,
  );
});

test("course history keeps newest successful verification first", () => {
  const history = appendCourseChangeHistory([{ id: "old" }], {
    id: "new",
    requirementIndex: 1,
    requirementChangeId: "change-2",
    requirementChangeApplied: true,
    diff: [{ before: "旧", after: "新" }],
    verifiedCourses: [{ code: "C1", name: "新" }],
  });
  assert.equal(history[0].id, "new");
  assert.equal(history[0].requirementIndex, 1);
  assert.equal(history[0].requirementChangeApplied, true);
  assert.equal(history[1].id, "old");
});

test("tenant course errors are operator friendly", () => {
  assert.equal(tenantCourseChangeErrorMessage({ status: 401 }), "租户 API 返回 401，请检查租户 API Key。");
  assert.match(tenantCourseChangeErrorMessage({ status: 403 }), /无权限修改/);
  assert.match(tenantCourseChangeErrorMessage({ status: 404 }), /未找到需要修改的科目/);
  assert.equal(tenantCourseChangeErrorMessage({ status: 400, message: "数量不一致" }), "数量不一致");
});

test("course updates are recorded by the existing session-change step", () => {
  const serverSource = fs.readFileSync(new URL("./easy_exam_server.mjs", import.meta.url), "utf8");
  const start = serverSource.indexOf("async function handleCourseChange(taskId, req, res) {");
  const end = serverSource.indexOf("\nasync function enrichTaskPaperUnitInfoForDetail", start);
  assert.ok(start >= 0 && end > start);
  const handler = serverSource.slice(start, end);
  assert.ok(handler.includes('updateTaskStep(taskId, "session_change", "running"'));
  assert.ok(handler.includes('updateTaskStep(taskId, "session_change", "success"'));
  assert.ok(handler.includes('updateTaskStep(taskId, "session_change", "failed"'));
  assert.equal(handler.includes('updateTaskStep(taskId, "course_change"'), false);
});
