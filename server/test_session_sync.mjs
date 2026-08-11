import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_SYNC_ACTION,
  buildSessionSyncConfigPatch,
  buildSessionSyncPreview,
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
  }, "2026-08-10T06:32:00.000Z");

  assert.equal(preview.changed, true);
  assert.deepEqual(preview.diff.map((item) => item.field), ["name", "start", "end", "early"]);
  assert.equal(preview.checkedAt, "2026-08-10T06:32:00.000Z");
  assert.equal(preview.current.name, "易考当前名称");
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
