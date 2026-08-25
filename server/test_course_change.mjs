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

test("course count changes are rejected before any update", () => {
  assert.throws(
    () => buildCourseChangePlan([
      { code: "C1", name: "科目一", form_codes: [] },
      { code: "C2", name: "科目二", form_codes: [] },
    ], ["只剩一个科目"]),
    /仅支持科目数量不变时修改名称/,
  );
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
