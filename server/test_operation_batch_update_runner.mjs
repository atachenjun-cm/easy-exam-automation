import assert from "node:assert/strict";
import test from "node:test";

import {
  operationBatchVisibleSchedulesFromRaw,
  runOperationBatchManagedUpdate,
  synchronizeOperationBatchScheduleForArchive,
} from "./operation_batch_update_runner.mjs";

const desiredSnapshot = {
  batchName: "正式批次",
  examStartDate: "2026-08-06",
  examEndDate: "2026-08-06",
  schedules: [{
    requirementIndex: 0,
    scene: "1",
    code: "1",
    name: "正式考试",
    start: "2026-08-06T09:00:00",
    end: "2026-08-06T10:30:00",
    timezone: "东8区",
    durationMinutes: "90",
    earlyLoginMinutes: "30",
    trial: false,
    remark: "",
  }],
};

test("visible schedule inspection accepts an explicit empty state", () => {
  assert.deepEqual(operationBatchVisibleSchedulesFromRaw({
    tables: [],
    emptyScheduleVisible: true,
  }), []);
  assert.throws(
    () => operationBatchVisibleSchedulesFromRaw({ tables: [] }),
    { code: "OPERATION_BATCH_INSPECTION_BLOCKED" },
  );
});

test("visible schedule inspection accepts the operation-console trial column alias", () => {
  const schedules = operationBatchVisibleSchedulesFromRaw({
    tables: [{
      headers: [
        "场次",
        "日程代码",
        "日程",
        "时区",
        "时长(分钟)",
        "考试名称",
        "考生提前登录(分钟)",
        "考试口令",
        "备注",
        "自定义考试配置",
        "操作",
      ],
      rows: [[
        "1",
        "1",
        "2026-08-08 10:00~17:00",
        "东8区",
        "420",
        "正式考试",
        "0",
        "",
        "",
        "否",
        "",
      ]],
      hasMore: false,
    }],
  });

  assert.deepEqual(schedules, [{
    scene: "1",
    code: "1",
    name: "正式考试",
    start: "2026-08-08 10:00",
    end: "2026-08-08 17:00",
    timezone: "东8区",
    durationMinutes: "420",
    earlyLoginMinutes: "0",
    trial: false,
    remark: "",
  }]);
});

test("archive schedule synchronization preserves a provided browser context", async () => {
  let closeCalls = 0;
  const page = {};
  const context = {
    pages: () => [page],
    async close() {
      closeCalls += 1;
    },
  };
  const adapter = {
    async openBatchByCode() {
      return "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=one";
    },
    async readOverview() {
      return {
        batchName: desiredSnapshot.batchName,
        examStartDate: desiredSnapshot.examStartDate,
        examEndDate: desiredSnapshot.examEndDate,
      };
    },
    async readSchedules() {
      return desiredSnapshot.schedules.map((schedule) => ({ ...schedule }));
    },
  };

  const result = await synchronizeOperationBatchScheduleForArchive({
    batch: { code: "EZT261018" },
    desiredSnapshot,
  }, { context, adapter, closeContext: false });

  assert.equal(result.action, "none");
  assert.equal(result.verified, true);
  assert.equal(closeCalls, 0);
});

test("archive schedule synchronization initializes an empty operation-console schedule and verifies readback", async () => {
  const calls = [];
  const state = {
    batchName: "正式批次",
    examStartDate: "2026-08-06",
    examEndDate: "2026-08-06",
    schedules: [],
  };
  const adapter = {
    async openBatchByCode() {
      calls.push("open");
      return "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=one";
    },
    async readOverview() {
      return {
        batchName: state.batchName,
        examStartDate: state.examStartDate,
        examEndDate: state.examEndDate,
      };
    },
    async readSchedules() {
      return state.schedules.map((schedule) => ({ ...schedule }));
    },
    async beginScheduleEdit() {
      calls.push("begin_schedule");
    },
    async appendSchedule() {
      calls.push("append_schedule");
      state.schedules.push({});
    },
    async writeScheduleFields(_page, index, schedule, fields, options) {
      calls.push("write_schedule");
      assert.equal(options.appended, true);
      assert.deepEqual([...fields], [
        "scene",
        "code",
        "name",
        "start",
        "end",
        "timezone",
        "durationMinutes",
        "earlyLoginMinutes",
        "trial",
        "remark",
      ]);
      state.schedules[index] = { ...schedule };
    },
    async saveSchedules() {
      calls.push("save_schedule");
    },
  };

  const result = await synchronizeOperationBatchScheduleForArchive({
    batch: { code: "EZT261018" },
    desiredSnapshot,
  }, { page: {}, adapter });

  assert.equal(result.verified, true);
  assert.equal(result.action, "initialize");
  assert.deepEqual(result.snapshot, desiredSnapshot);
  assert.deepEqual(calls, [
    "open",
    "begin_schedule",
    "append_schedule",
    "write_schedule",
    "save_schedule",
    "open",
  ]);
});

test("archive schedule synchronization stops before writes when the batch name mismatches", async () => {
  const calls = [];
  const adapter = {
    async openBatchByCode() {
      calls.push("open");
      return "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=wrong-name";
    },
    async readOverview() {
      return {
        batchName: "另一个批次",
        examStartDate: desiredSnapshot.examStartDate,
        examEndDate: desiredSnapshot.examEndDate,
      };
    },
    async readSchedules() {
      return [];
    },
    async beginScheduleEdit() {
      calls.push("begin_schedule");
    },
  };

  await assert.rejects(
    synchronizeOperationBatchScheduleForArchive({
      batch: { code: "EZT261018" },
      desiredSnapshot,
    }, { page: {}, adapter }),
    { code: "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH" },
  );
  assert.deepEqual(calls, ["open"]);
});

test("managed batch update writes only the declared changed field", async () => {
  const calls = [];
  const current = structuredClone(desiredSnapshot);
  const desired = structuredClone(desiredSnapshot);
  desired.schedules[0].name = "更新后的考试名称";
  const adapter = {
    async openBatchByCode() {
      calls.push("open");
      return "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=one";
    },
    async readOverview() {
      return {
        batchName: current.batchName,
        examStartDate: current.examStartDate,
        examEndDate: current.examEndDate,
      };
    },
    async readSchedules() {
      return current.schedules.map((schedule) => ({ ...schedule }));
    },
    async beginOverviewEdit() {
      calls.push("begin_overview");
    },
    async writeOverviewFields() {
      calls.push("write_overview");
    },
    async saveOverview() {
      calls.push("save_overview");
    },
    async beginScheduleEdit() {
      calls.push("begin_schedule");
    },
    async writeScheduleFields(_page, index, schedule, fields, options) {
      calls.push("write_schedule");
      assert.equal(options.appended, false);
      assert.deepEqual([...fields], ["name"]);
      for (const field of fields) current.schedules[index][field] = schedule[field];
    },
    async saveSchedules() {
      calls.push("save_schedule");
    },
  };

  const result = await runOperationBatchManagedUpdate({
    batch: {
      code: "EZT261018",
      expectedAppliedSnapshot: desiredSnapshot,
    },
    desiredSnapshot: desired,
    changes: [{
      path: "schedules[0].name",
      label: "日程1考试名称",
      before: "正式考试",
      after: "更新后的考试名称",
      requirementIndex: 0,
    }],
  }, { page: {}, adapter });

  assert.equal(result.verified, true);
  assert.deepEqual(current, desired);
  assert.deepEqual(calls, [
    "open",
    "begin_schedule",
    "write_schedule",
    "save_schedule",
    "open",
  ]);
});
