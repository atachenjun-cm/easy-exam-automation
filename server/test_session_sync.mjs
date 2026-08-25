import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_SYNC_ACTION,
  buildSessionSyncConfigPatch,
  buildSessionSyncPreview,
  sessionConfigurationSnapshotFromDetail,
  sessionOptionSnapshotFromDetail,
  sessionSyncBaselineForTaskSession,
  sessionSyncErrorMessage,
  sessionSyncSnapshotFromDetail,
} from "./session_sync.mjs";

function sampleTask() {
  return {
    taskId: "task-sync-1",
    config: {
      marker: "preserve",
      examRequirements: [{
        fields: {
          "考试名称": "原始需求名称",
          "提前登录时间": "30分钟",
          "限制迟到时间": "20",
          "欢迎语": "欢迎参加考试",
          "考前等待提示": "请等待开考",
        },
        config: {
          examName: "原始需求名称",
          startTimeDisplay: "2026/08/10 19:00",
          endTimeDisplay: "2026/08/10 20:30",
          mockExamName: "原始需求名称-试考",
          mockStartTimeDisplay: "2026/08/09 10:00",
          mockEndTimeDisplay: "2026/08/09 17:00",
        },
      }],
    },
    sessions: [{
      session_id: "434324",
      sessionType: "formal",
      requirementIndex: 0,
      name: "平台场次名称",
      start: "2026-08-10 19:00",
      end: "2026-08-10 20:30",
    }],
    steps: [],
  };
}

test("session sync baseline uses the platform session and requirement configuration", () => {
  const task = sampleTask();
  assert.deepEqual(sessionSyncBaselineForTaskSession(task, task.sessions[0]), {
    name: "平台场次名称",
    start: "2026-08-10 19:00",
    end: "2026-08-10 20:30",
    early: 30,
    later: 20,
    message: "欢迎参加考试",
    notice: "请等待开考",
  });
});

test("session sync preview reports only current unresolved EasyExam differences", () => {
  const task = sampleTask();
  const preview = buildSessionSyncPreview(task, task.sessions[0], {
    id: "434324",
    name: "易考当前名称",
    start: "2026-08-10 19:30",
    end: "2026-08-10 21:00",
    early: 15,
    later: 20,
    message: "欢迎参加考试",
    notice: "请等待开考",
    monitor: 1,
    save_video: true,
    eagle_eye: "false",
    watermark: "开启",
    copy_item_unable: 0,
    show_point: "yes",
    lock_screen: true,
    client_required: true,
    exclusive_network: false,
    login_times: "10",
  }, "2026-08-10T06:32:00.000Z");

  assert.equal(preview.changed, true);
  assert.deepEqual(preview.diff.filter((item) => item.group === "session").map((item) => item.field), ["name", "start", "end", "early"]);
  assert.ok(preview.diff.some((item) => item.field === "config.save_video"));
  assert.equal(preview.checkedAt, "2026-08-10T06:32:00.000Z");
  assert.equal(preview.current.name, "易考当前名称");
  assert.deepEqual(
    Object.fromEntries(Object.entries(preview.options).filter(([, value]) => value !== null)),
    {
      monitor: true,
      save_video: true,
      eagle_eye: false,
      lock_screen: true,
      client_required: true,
      exclusive_network: false,
      watermark: true,
      copy_item_unable: false,
      show_point: true,
      login_times: 10,
    },
  );
});

test("session option snapshots report missing fields explicitly", () => {
  const snapshot = sessionOptionSnapshotFromDetail({ monitor: false });
  assert.equal(snapshot.monitor, false);
  assert.equal(snapshot.save_video, null);
  assert.equal(snapshot.login_times, null);
  assert.equal(snapshot.monitor_replay, null);
});

test("session sync reads subjects, bound papers, and documented configuration items", () => {
  const task = sampleTask();
  task.config.examRequirements[0].config.courses = [];
  task.config.examRequirements[0].config.sessionOptions = {
    explicit: true,
    public: { new_mark: true },
    pendingInternal: [{ id: "ai_gaze", label: "视线追踪", value: "开启" }],
  };
  const detail = {
    name: "平台场次名称",
    start: "2026/08/10 19:00",
    end: "2026/08/10 20:30",
    early: 30,
    later: 20,
    notice: "请等待开考",
    re_answer_times: 0,
    extra: {
      new_monitor: true,
      open_talk: false,
      new_mark: false,
      monitor_replay: true,
    },
  };
  const inventory = {
    courses: [
      { code: "20260810-01-01", name: "项目管理类", form_codes: ["FORM-1"], paper_names: ["项目管理类试卷"] },
      { code: "20260810-01-02", name: "安全环保类", form_codes: ["FORM-2"], paper_names: ["安全环保类试卷"] },
    ],
    papers: [
      { code: "FORM-1", name: "项目管理类试卷" },
      { code: "FORM-2", name: "安全环保类试卷" },
    ],
    courseReadMode: "tenant_courses_matched_by_bound_papers",
  };

  const preview = buildSessionSyncPreview(task, task.sessions[0], detail, "2026-08-20T00:00:00.000Z", inventory);
  assert.deepEqual(preview.readbackSummary, { courseCount: 2, paperCount: 2, configurationCount: 5 });
  assert.deepEqual(preview.configuration.items.map((item) => item.field), ["new_mark", "re_answer_times", "open_talk", "monitor_replay", "new_monitor"]);
  assert.equal(preview.configuration.items.find((item) => item.field === "new_monitor").syncable, false);
  assert.ok(preview.diff.some((item) => item.field === "courses"));
  assert.ok(preview.diff.some((item) => item.field === "papers"));
  assert.ok(preview.diff.some((item) => item.field === "config.monitor_replay"));

  const patch = buildSessionSyncConfigPatch(task, {
    session: task.sessions[0],
    current: preview.current,
    availableFields: preview.availableFields,
    options: preview.configuration.options,
    courses: preview.courses,
    papers: preview.papers,
    diff: preview.diff,
    syncedAt: "2026-08-20T00:01:00.000Z",
  });
  assert.equal(patch.examRequirements[0].config.courses.length, 2);
  assert.equal(patch.examRequirements[0].config.sessionOptions.public.monitor_replay, true);
  assert.equal(patch.examRequirements[0].config.sessionOptions.public.new_monitor, undefined);
  assert.deepEqual(patch.examRequirements[0].config.sessionOptions.pendingInternal, [
    { id: "ai_gaze", label: "视线追踪", value: "开启" },
  ]);
});

test("test-session extra configuration is read without inventing missing subjects or papers", () => {
  const configuration = sessionConfigurationSnapshotFromDetail({
    extra: { new_monitor: true, open_talk: false, new_mark: false, monitor_replay: true },
  });
  assert.equal(configuration.items.length, 4);
  assert.equal(configuration.options.monitor_replay, true);
  assert.equal(configuration.options.new_monitor, undefined);
});

test("equivalent date separators and EasyExam unset minute sentinels do not create false differences", () => {
  const task = sampleTask();
  task.config.examRequirements[0].fields["提前登录时间"] = "";
  task.config.examRequirements[0].fields["限制迟到时间"] = "";
  const preview = buildSessionSyncPreview(task, task.sessions[0], {
    name: "平台场次名称",
    start: "2026/08/10 19:00:00",
    end: "2026/08/10 20:30:00",
    early: -1,
    later: "-1",
    message: "欢迎参加考试",
    notice: "请等待开考",
  });

  assert.equal(preview.changed, false);
  assert.deepEqual(preview.diff, []);
});

test("stored EasyExam snapshot is advanced by later platform change history", () => {
  const task = sampleTask();
  task.config.sessionSync = {
    snapshots: {
      "434324": {
        syncedAt: "2026-08-10T01:00:00.000Z",
        current: {
          name: "上次同步名称",
          start: "2026-08-10 19:00",
          end: "2026-08-10 20:30",
          early: 30,
          later: 20,
          message: "旧欢迎语",
          notice: "请等待开考",
        },
      },
    },
  };
  task.steps = [{
    stepKey: "session_change",
    result: {
      history: [{
        sessionId: "434324",
        status: "success",
        changedAt: "2026-08-10T02:00:00.000Z",
        diff: [{ field: "message", before: "旧欢迎语", after: "平台新欢迎语" }],
      }],
    },
  }];

  const baseline = sessionSyncBaselineForTaskSession(task, task.sessions[0]);
  assert.equal(baseline.message, "平台新欢迎语");
  assert.equal(baseline.early, 30);
  assert.equal(baseline.name, "平台场次名称");
});

test("sync config patch preserves requirements and records an audited snapshot", () => {
  const task = sampleTask();
  const diff = [{ field: "early", label: "提前登录分钟", before: 30, after: 15 }];
  const patch = buildSessionSyncConfigPatch(task, {
    session: task.sessions[0],
    current: {
      name: "易考当前名称",
      start: "2026-08-10 19:30",
      end: "2026-08-10 21:00",
      early: 15,
      later: 20,
      message: "欢迎参加考试",
      notice: "请等待开考",
    },
    diff,
    operator: "operator@example.com",
    syncedAt: "2026-08-10T06:35:00.000Z",
  });

  assert.equal(patch.sessionSync.snapshots["434324"].current.early, 15);
  assert.equal(patch.sessionSync.history[0].action, SESSION_SYNC_ACTION);
  assert.equal(patch.sessionSync.history[0].operator, "operator@example.com");
  assert.deepEqual(task.config.examRequirements[0].fields["考试名称"], "原始需求名称");
  assert.equal(task.config.marker, "preserve");
});

test("incomplete tenant snapshots are rejected before local persistence", () => {
  assert.throws(
    () => sessionSyncSnapshotFromDetail({ name: "缺少时间" }),
    (error) => error.code === "SESSION_SYNC_SNAPSHOT_INCOMPLETE",
  );
});

test("session sync read errors use read-only operator wording", () => {
  assert.equal(sessionSyncErrorMessage({ status: 403 }), "租户 API 返回 403，场次不存在、不属于当前租户，或当前 Key 无读取权限。");
  assert.equal(sessionSyncErrorMessage({ status: 404 }), "易考未找到该场次，请核对考试口令。");
  assert.equal(sessionSyncErrorMessage({ status: 500 }), "读取易考场次信息失败：500");
});
