import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedSessionChangeFields,
  appendSessionChangeHistory,
  buildSessionChangeDiff,
  editableSessionFieldsFromDetail,
  enrichTaskSessionRequirementChanges,
  featureEnabledForRuntime,
  fetchTenantSessionDetailWithListFallback,
  localSessionFieldsForChange,
  mergeSessionChangePayload,
  putTenantSessionDetail,
  sessionChangeBasePayloadFromTask,
  sessionChangeHistoryFromStep,
  sessionChangeMatchesSuggested,
  sessionChangeSummary,
  sessionRequirementChangeForTaskSession,
  tenantSessionChangeErrorMessage,
  validateSessionChangeRequest,
} from "./session_change.mjs";

test("feature is enabled by default and retains an emergency off switch", () => {
  assert.equal(featureEnabledForRuntime("/app/.easy_exam_runtime", {}), true);
  assert.equal(featureEnabledForRuntime("/app/.easy_exam_runtime_test", {}), true);
  assert.equal(featureEnabledForRuntime("/app/runtime", { SESSION_CHANGE_ENABLED: "1" }), true);
  assert.equal(featureEnabledForRuntime("/app/runtime", { SESSION_CHANGE_ENABLED: "0" }), false);
});

test("validation rejects unknown fields and invalid date ranges", () => {
  const unknown = validateSessionChangeRequest({ name: "A", invalid: "x" });
  assert.deepEqual(unknown.errors, ["不支持修改字段：invalid"]);

  const badRange = validateSessionChangeRequest({
    name: "A",
    start: "2026-07-20 11:00:00",
    end: "2026-07-20 09:00:00",
  });
  assert.ok(badRange.errors.includes("结束时间必须晚于开始时间"));
});

test("validation normalizes allowed fields and permits clearing early/later", () => {
  const result = validateSessionChangeRequest({
    name: "  新场次  ",
    start: "2026-07-20 09:00",
    end: "2026-07-20 11:00",
    early: "",
    later: null,
    message: "",
    notice: " 请提前登录 ",
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.changes, {
    name: "新场次",
    start: "2026-07-20 09:00",
    end: "2026-07-20 11:00",
    early: null,
    later: null,
    message: "",
    notice: "请提前登录",
  });
});

test("session change payload contains only fields whose values actually changed", () => {
  const original = {
    id: "10001",
    name: "旧场次",
    start: "2026-07-20 08:00",
    end: "2026-07-20 10:00",
    early: 15,
    later: 20,
    forms: ["F001"],
    monitor: true,
    personal: { full_name: { label: "姓名" } },
    url: "https://example.com",
    extra: { readonly: true },
  };

  const merged = mergeSessionChangePayload(original, {
    name: "新场次",
    start: "2026-07-20 09:00",
    end: "2026-07-20 11:00",
    early: null,
    later: null,
    message: "欢迎",
  });

  assert.deepEqual(merged, {
    name: "新场次",
    start: "2026-07-20 09:00",
    end: "2026-07-20 11:00",
    early: null,
    later: null,
    message: "欢迎",
  });
  assert.equal(Object.hasOwn(merged, "forms"), false);
  assert.equal(Object.hasOwn(merged, "monitor"), false);
  assert.equal(Object.hasOwn(merged, "personal"), false);
});

test("name-only tenant update cannot carry candidate or other session configuration", async () => {
  const calls = [];
  await putTenantSessionDetail({
    apiBase: "https://eztest.cn/",
    sessionId: "433541",
    login: { tenantApiKey: "test" },
    payload: {
      name: "新场次名称",
      personal: {},
      forms: [],
      monitor: false,
      save_video: false,
    },
    requestJson: async (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2], {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "新场次名称" }),
  });
});

test("diff includes only changed fields with labels", () => {
  const diff = buildSessionChangeDiff(
    { name: "旧场次", start: "2026-07-20 08:00", message: "" },
    { name: "新场次", start: "2026-07-20 08:00", message: "欢迎" },
  );

  assert.deepEqual(diff, [
    { field: "name", label: "场次名称", before: "旧场次", after: "新场次" },
    { field: "message", label: "欢迎语", before: "", after: "欢迎" },
  ]);
});

test("requirement changes mark matching formal and trial sessions pending with suggested times", () => {
  const task = {
    config: {
      examRequirements: [{
        version: 2,
        config: {
          examName: "新正式考试",
          startTimeDisplay: "2026/08/02 09:30",
          endTimeDisplay: "2026/08/02 11:30",
          mockExamName: "新正式考试-试考",
          mockStartTimeDisplay: "2026/08/01 10:00",
          mockEndTimeDisplay: "2026/08/01 17:00",
        },
      }],
      projectSourceChangeHistory: [{
        changeId: "change-time-1",
        source: "examRequirement",
        requirementIndex: 0,
        changedAt: "2026-07-29T02:22:22.604Z",
        changes: [
          { field: "考试日期时间", before: "old", after: "new" },
          { field: "试考日期时间", before: "old", after: "new" },
        ],
      }],
    },
    sessions: [
      { session_id: "432821", sessionType: "formal", requirementIndex: 0 },
      { session_id: "432822", sessionType: "trial", requirementIndex: 0 },
    ],
    steps: [],
  };

  const formal = sessionRequirementChangeForTaskSession(task, task.sessions[0]);
  const trial = sessionRequirementChangeForTaskSession(task, task.sessions[1]);
  assert.equal(formal.pending, true);
  assert.equal(formal.label, "需求有变请确认");
  assert.deepEqual(formal.suggestedChanges, {
    start: "2026/08/02 09:30",
    end: "2026/08/02 11:30",
  });
  assert.deepEqual(trial.suggestedChanges, {
    start: "2026/08/01 10:00",
    end: "2026/08/01 17:00",
  });

  const enriched = enrichTaskSessionRequirementChanges(task);
  assert.equal(enriched.requirementChangeSummary.pendingCount, 2);
  assert.equal(enriched.sessions[0].requirementChange.changeId, "change-time-1");
});

test("multiple unresolved requirement changes are merged for one session", () => {
  const task = {
    config: {
      examRequirement: {
        fields: {
          "考试日期时间": "旧时间",
          "考试名称": "旧名称",
        },
        config: {
          examName: "新考试名称",
          startTimeDisplay: "2026/08/06 10:00",
          endTimeDisplay: "2026/08/06 22:00",
        },
      },
      projectSourceChangeHistory: [
        {
          changeId: "change-time-1",
          source: "examRequirement",
          requirementIndex: 0,
          changedAt: "2026-08-06T02:52:56.187Z",
          changes: [{ field: "考试日期时间", before: "旧时间", after: "新时间" }],
        },
        {
          changeId: "change-name-2",
          source: "examRequirement",
          requirementIndex: 0,
          changedAt: "2026-08-06T03:19:09.889Z",
          changes: [{ field: "考试名称", before: "旧名称", after: "新名称" }],
        },
      ],
    },
    sessions: [{
      session_id: "432821",
      sessionType: "formal",
      requirementIndex: 0,
      name: "旧名称",
      start: "2026-08-07 14:00",
      end: "2026-08-07 18:00",
    }],
    steps: [],
  };

  const change = sessionRequirementChangeForTaskSession(task, task.sessions[0]);
  assert.equal(change.pending, true);
  assert.equal(change.changeId, "change-name-2");
  assert.deepEqual(change.changedFields, ["考试日期时间", "考试名称"]);
  assert.deepEqual(change.suggestedChanges, {
    name: "新考试名称",
    start: "2026/08/06 10:00",
    end: "2026/08/06 22:00",
  });
});

test("an applied requirement change clears only the matching session reminder", () => {
  const task = {
    config: {
      examRequirement: {
        fields: { "考试日期时间": "new" },
        config: { startTimeDisplay: "2026/08/02 09:30", endTimeDisplay: "2026/08/02 11:30" },
      },
      projectSourceChangeHistory: [{
        changeId: "change-time-2",
        source: "examRequirement",
        changedAt: "2026-07-29T02:22:22.604Z",
        changes: [{ field: "考试日期时间", before: "old", after: "new" }],
      }],
    },
    sessions: [
      { session_id: "432821", sessionType: "formal" },
      { session_id: "432822", sessionType: "formal" },
    ],
    steps: [{
      stepKey: "session_change",
      result: {
        history: [{
          sessionId: "432821",
          requirementChangeId: "change-time-2",
          requirementChangeApplied: true,
        }],
      },
    }],
  };

  const enriched = enrichTaskSessionRequirementChanges(task);
  assert.equal(enriched.sessions[0].requirementChange.pending, false);
  assert.equal(enriched.sessions[1].requirementChange.pending, true);
  assert.equal(enriched.requirementChangeSummary.pendingCount, 1);
});

test("current session values matching the latest requirement clear the reminder without a history record", () => {
  const task = {
    config: {
      examRequirement: {
        config: {
          mockExamName: "新试考",
          mockStartTimeDisplay: "2026/08/01 10:00",
          mockEndTimeDisplay: "2026/08/01 17:00",
        },
      },
      projectSourceChangeHistory: [{
        changeId: "change-trial-time",
        source: "examRequirement",
        changedAt: "2026-07-29T02:22:22.604Z",
        changes: [{ field: "试考日期时间", before: "old", after: "new" }],
      }],
    },
    sessions: [{
      session_id: "432822",
      sessionType: "trial",
      name: "新试考",
      start: "2026-08-01 10:00",
      end: "2026-08-01 17:00",
    }],
    steps: [],
  };

  const enriched = enrichTaskSessionRequirementChanges(task);
  assert.equal(enriched.sessions[0].requirementChange.pending, false);
  assert.equal(enriched.requirementChangeSummary.pendingCount, 0);
});

test("suggested requirement values must match the submitted session change", () => {
  assert.equal(sessionChangeMatchesSuggested(
    { start: "2026-08-02 09:30:00", end: "2026-08-02 11:30:00" },
    { start: "2026/08/02 09:30", end: "2026/08/02 11:30" },
  ), true);
  assert.equal(sessionChangeMatchesSuggested(
    { start: "2026-08-02 10:00:00" },
    { start: "2026/08/02 09:30" },
  ), false);
});

test("editable fields expose the safe subset from tenant detail", () => {
  assert.deepEqual(allowedSessionChangeFields, ["name", "start", "end", "early", "later", "message", "notice"]);
  assert.deepEqual(editableSessionFieldsFromDetail({ name: "A", monitor: true, early: 30 }), {
    name: "A",
    start: "",
    end: "",
    early: 30,
    later: "",
    message: "",
    notice: "",
  });
});

test("local session fallback exposes basic editable fields", () => {
  assert.deepEqual(localSessionFieldsForChange({
    name: "本地场次",
    start: "2026-07-09 16:20",
    end: "2026-07-09 17:20",
    early: 30,
    later: 20,
  }), {
    name: "本地场次",
    start: "2026-07-09 16:20",
    end: "2026-07-09 17:20",
    early: 30,
    later: 20,
    message: "",
    notice: "",
  });
});

test("task fallback contains editable fields only when detail lookup fails", () => {
  const payload = sessionChangeBasePayloadFromTask(
    { config: { welcomeText: "欢迎", preLoginPrompt: "请提前登录", personal: { full_name: { required: true } } } },
    { name: "本地场次", start: "2026-07-09 16:20", end: "2026-07-09 17:20", early: 30 },
  );

  assert.deepEqual(payload, {
    name: "本地场次",
    start: "2026-07-09 16:20",
    end: "2026-07-09 17:20",
    early: 30,
    later: "",
    message: "",
    notice: "",
  });
  assert.equal(Object.hasOwn(payload, "personal"), false);
});

test("task fallback payload preserves explicit local prompts when available", () => {
  const payload = sessionChangeBasePayloadFromTask(
    { config: { welcomeText: "默认欢迎", preLoginPrompt: "默认提示", personal: { full_name: { required: true } } } },
    {
      name: "本地场次",
      start: "2026-07-09 16:20",
      end: "2026-07-09 17:20",
      message: "易考已有欢迎语",
      notice: "易考已有登录提示",
    },
  );

  assert.equal(payload.message, "易考已有欢迎语");
  assert.equal(payload.notice, "易考已有登录提示");
});

test("safe summary omits full tenant body", () => {
  assert.deepEqual(sessionChangeSummary({ status: 0, info: "success", data: { secret: "x" } }), {
    status: 0,
    info: "success",
  });
  assert.deepEqual(sessionChangeSummary("ok"), { bodyType: "string", body: "ok" });
});

test("tenant session change errors use operator friendly messages", () => {
  assert.equal(tenantSessionChangeErrorMessage({ status: 401 }), "租户 API 返回 401，请检查租户 API Key。");
  assert.equal(tenantSessionChangeErrorMessage({ status: 403 }), "租户 API 返回 403，场次不存在、不属于当前租户，或当前 Key 无权限修改。");
  assert.equal(tenantSessionChangeErrorMessage({ status: 429 }), "租户 API 返回 429，请稍后重试。");
  assert.equal(tenantSessionChangeErrorMessage({ status: 500 }), "租户 API 修改场次失败：500");
});

test("session preview keeps the direct detail response when it succeeds", async () => {
  const requests = [];
  const detail = await fetchTenantSessionDetailWithListFallback({
    apiBase: "https://eztest.cn/",
    sessionId: "432821",
    login: { tenantApiKey: "test" },
    requestJson: async (_login, url) => {
      requests.push(url);
      return { id: 432821, name: "正式考试" };
    },
  });

  assert.equal(detail.name, "正式考试");
  assert.deepEqual(requests, ["https://eztest.cn/tenant/api/session/432821/"]);
});

test("session preview reads the matching list item when the detail endpoint fails", async () => {
  const requests = [];
  const detail = await fetchTenantSessionDetailWithListFallback({
    apiBase: "https://eztest.cn",
    sessionId: "432821",
    login: { tenantApiKey: "test" },
    requestJson: async (_login, url) => {
      requests.push(url);
      if (url.endsWith("/432821/")) {
        const error = new Error("detail failed");
        error.status = 500;
        throw error;
      }
      return { sessions: [{ id: 432820 }, { id: 432821, name: "正式考试" }] };
    },
  });

  assert.equal(detail.name, "正式考试");
  assert.deepEqual(requests, [
    "https://eztest.cn/tenant/api/session/432821/",
    "https://eztest.cn/tenant/api/session/?session_ids=432821",
  ]);
});

test("session change history appends newest record without losing older records", () => {
  const existing = [{ id: "old", sessionId: "10001", changedAt: "2026-07-08T09:00:00.000Z" }];
  const history = appendSessionChangeHistory(existing, {
    id: "new",
    changedAt: "2026-07-09T10:00:00.000Z",
    operator: "chenjun@ata.net.cn",
    sessionId: "429937",
    sessionType: "formal",
    apiBase: "https://eztest.cn",
    status: "success",
    tenantStatus: 200,
    verifyStatus: 200,
    diff: [{ field: "name", label: "场次名称", before: "旧场次", after: "新场次" }],
    verifiedSession: { name: "新场次", start: "2026/07/17 10:30", end: "2026/07/17 11:30" },
  });

  assert.equal(history.length, 2);
  assert.equal(history[0].id, "new");
  assert.equal(history[0].operator, "chenjun@ata.net.cn");
  assert.equal(history[0].sessionLabel, "正式考试");
  assert.deepEqual(history[0].diff, [{ field: "name", label: "场次名称", before: "旧场次", after: "新场次" }]);
  assert.deepEqual(history[0].verifiedSession, { name: "新场次", start: "2026/07/17 10:30", end: "2026/07/17 11:30" });
  assert.equal(history[1], existing[0]);
});

test("session change history preserves the EasyExam pull-sync action", () => {
  const history = appendSessionChangeHistory([], {
    sessionId: "434324",
    sessionType: "formal",
    status: "success",
    action: "sync_from_yikao",
    diff: [{ field: "name", label: "场次名称", before: "旧名称", after: "新名称" }],
  });

  assert.equal(history[0].action, "sync_from_yikao");
});

test("legacy session change step diff can be displayed as history", () => {
  const history = sessionChangeHistoryFromStep({
    status: "success",
    completedAt: "2026-07-08T09:34:23+00:00",
    result: {
      sessionId: "429937",
      sessionType: "formal",
      apiBase: "https://eztest.cn",
      diff: [{ field: "start", label: "开始时间", before: "2026-07-18 10:30", after: "2026-07-17 10:30" }],
      tenantResponseSummary: {},
    },
  });

  assert.equal(history.length, 1);
  assert.equal(history[0].id, "429937-legacy");
  assert.equal(history[0].sessionLabel, "正式考试");
  assert.equal(history[0].tenantStatus, 200);
  assert.deepEqual(history[0].diff, [{ field: "start", label: "开始时间", before: "2026-07-18 10:30", after: "2026-07-17 10:30" }]);
});
