import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOperationBatchManagedResult,
  buildDesiredOperationBatchSnapshot,
  buildFormalOperationBatchSnapshot,
  normalizedOperationBatchManagedSnapshot,
  operationBatchManagedDiff,
  operationBatchUpdateState,
} from "./operation_batch_update.mjs";

function taskFixture() {
  return {
    sessions: [
      {
        sessionType: "trial",
        name: "试考",
        start: "2026-08-05T09:00:00",
        end: "2026-08-05T10:00:00",
        requirementIndex: 0,
      },
      {
        sessionType: "formal",
        name: "正式考试最终名称",
        start: "2026-08-06T09:00:00+08:00",
        end: "2026-08-06T10:30:00+08:00",
        requirementIndex: 0,
      },
    ],
    config: {
      businessRequirement: { batch_name: "泛微旧批次名" },
      operationBatch: {
        batchName: "运控已确认批次名",
        draft: { fields: { batchName: { value: "运控已确认批次名" } } },
      },
      examRequirements: [{
        fields: {
          "考试名称": "需求单旧名称",
          "考试日期时间": "2026-08-01 08:00 - 2026-08-01 09:00",
          "提前登录时间": "30分钟",
          "备注": "正式考试日程",
        },
      }],
    },
  };
}

test("archive schedule snapshot uses formal sessions and excludes trial sessions", () => {
  const desired = buildFormalOperationBatchSnapshot(taskFixture());
  assert.equal(desired.complete, true);
  assert.deepEqual(desired.snapshot, {
    batchName: "运控已确认批次名",
    examStartDate: "2026-08-06",
    examEndDate: "2026-08-06",
    schedules: [{
      requirementIndex: 0,
      scene: "1",
      code: "1",
      name: "正式考试最终名称",
      start: "2026-08-06T09:00:00",
      end: "2026-08-06T10:30:00",
      timezone: "东8区",
      durationMinutes: "90",
      earlyLoginMinutes: "30",
      trial: false,
      remark: "正式考试日程",
    }],
  });
  assert.deepEqual(normalizedOperationBatchManagedSnapshot(desired.snapshot), desired.snapshot);
});

test("formal schedule diff includes every missing operation-console column", () => {
  const desired = buildFormalOperationBatchSnapshot(taskFixture()).snapshot;
  const changes = operationBatchManagedDiff({
    batchName: desired.batchName,
    examStartDate: desired.examStartDate,
    examEndDate: desired.examEndDate,
    schedules: [],
  }, desired);
  assert.deepEqual(changes.map((change) => change.path), [
    "schedules[0].scene",
    "schedules[0].code",
    "schedules[0].name",
    "schedules[0].start",
    "schedules[0].end",
    "schedules[0].timezone",
    "schedules[0].durationMinutes",
    "schedules[0].earlyLoginMinutes",
    "schedules[0].remark",
  ]);
});

test("archive schedule blocks when no formal session exists", () => {
  const task = taskFixture();
  task.sessions = task.sessions.filter((session) => session.sessionType === "trial");
  const desired = buildFormalOperationBatchSnapshot(task);
  assert.equal(desired.complete, false);
  assert.deepEqual(desired.snapshot.schedules, []);
});

test("batch update state exposes only fields changed after the confirmed snapshot", () => {
  const task = taskFixture();
  const applied = buildDesiredOperationBatchSnapshot(task).snapshot;
  task.config.operationBatchCode = "EZT261018";
  task.config.operationBatch.managedSnapshot = structuredClone(applied);

  const unchanged = operationBatchUpdateState(task);
  assert.equal(unchanged.status, "success");
  assert.equal(unchanged.baselineRequired, false);
  assert.deepEqual(unchanged.changes, []);

  task.config.examRequirements[0].fields["考试名称"] = "需求单更新后的名称";
  const changed = operationBatchUpdateState(task);
  assert.equal(changed.status, "update_available");
  assert.equal(changed.baselineRequired, false);
  assert.deepEqual(changed.changes, [{
    path: "schedules[0].name",
    label: "日程1考试名称",
    before: "需求单旧名称",
    after: "需求单更新后的名称",
    requirementIndex: 0,
  }]);
});

test("a newly created batch can store a verified empty schedule baseline", () => {
  const result = applyOperationBatchManagedResult({
    config: { operationBatch: { code: "EZT261018" } },
  }, {
    verified: true,
    allowEmptySchedules: true,
    action: "create_baseline",
    snapshot: {
      batchName: "已建批次",
      examStartDate: "2026-08-06",
      examEndDate: "2026-08-06",
      schedules: [],
    },
  });

  assert.deepEqual(result.operationBatch.managedSnapshot, {
    batchName: "已建批次",
    examStartDate: "2026-08-06",
    examEndDate: "2026-08-06",
    schedules: [],
  });
  assert.equal(result.operationBatch.managedSnapshotVersion, 1);
});
