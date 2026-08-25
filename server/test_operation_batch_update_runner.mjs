import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOperationBatchDetailIdentity,
  operationBatchVisibleSchedulesFromRaw,
  runOperationBatchManagedUpdate,
  synchronizeOperationBatchScheduleForArchive,
  waitForVisibleScheduleRows,
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

test("新增日程后等待重绘完成再读取可见行", async () => {
  let clock = 0;
  let reads = 0;
  const rows = await waitForVisibleScheduleRows(async () => {
    reads += 1;
    return reads >= 3 ? [{ id: "schedule-1" }] : [];
  }, 1, {
    timeoutMs: 1000,
    pollMs: 100,
    now: () => clock,
    wait: async (delay) => { clock += delay; },
  });

  assert.deepEqual(rows, [{ id: "schedule-1" }]);
  assert.equal(reads, 3);
});

test("新增日程行持续未出现时返回明确冲突", async () => {
  let clock = 0;
  await assert.rejects(
    waitForVisibleScheduleRows(async () => [], 1, {
      timeoutMs: 200,
      pollMs: 100,
      now: () => clock,
      wait: async (delay) => { clock += delay; },
    }),
    (error) => error?.code === "OPERATION_BATCH_UPDATE_CONFLICT"
      && /期望至少 1 行，实际 0 行/.test(error.message),
  );
});

function batchDetailPage({ code = "EZT261018", name = "正式批次", guid = "target" } = {}) {
  const title = {
    locator(selector) {
      if (selector === ":scope > span") return { count: async () => 1, innerText: async () => code };
      if (selector === ":scope > label") return { count: async () => 1, innerText: async () => name };
      throw new Error(`unexpected title selector: ${selector}`);
    },
  };
  return {
    url: () => `https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=${guid}`,
    locator(selector) {
      if (selector === ".header-title:visible") return { count: async () => 1, first: () => title };
      throw new Error(`unexpected page selector: ${selector}`);
    },
  };
}

test("批次详情标题重绘后再核验目标批次代码", async () => {
  const codes = ["EZT261030", "EZT261048", "EZT261048"];
  let codeReadCount = 0;
  const title = {
    locator(selector) {
      if (selector === ":scope > span") {
        return {
          count: async () => 1,
          innerText: async () => codes[Math.min(codeReadCount++, codes.length - 1)],
        };
      }
      if (selector === ":scope > label") {
        return { count: async () => 1, innerText: async () => "目标批次" };
      }
      throw new Error(`unexpected title selector: ${selector}`);
    },
  };
  const page = {
    url: () => "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=target",
    waitForTimeout: async () => {},
    locator(selector) {
      if (selector === ".header-title:visible") {
        return { count: async () => 1, first: () => title };
      }
      throw new Error(`unexpected page selector: ${selector}`);
    },
  };

  const detailUrl = await assertOperationBatchDetailIdentity(page, {
    batchCode: "EZT261048",
    batchName: "目标批次",
    batchListUrl: "https://dashboard.ata.net.cn/batch/batchList",
  });

  assert.equal(detailUrl, "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=target");
});

test("批次详情未读到实际批次名时停止", async () => {
  await assert.rejects(
    assertOperationBatchDetailIdentity(batchDetailPage({ name: "" }), {
      batchCode: "EZT261018",
      batchListUrl: "https://dashboard.ata.net.cn/batch/batchList",
    }),
    { code: "OPERATION_BATCH_ACTUAL_NAME_MISSING" },
  );
});

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

test("archive schedule synchronization reuses the verified batch when multiple detail pages are open", async () => {
  const wrongPage = batchDetailPage({ code: "EZT261030", name: "其他批次", guid: "wrong" });
  const targetPage = batchDetailPage();
  const targetDetailUrl = targetPage.url();
  const selectedPages = [];
  const context = { pages: () => [wrongPage, targetPage] };
  const adapter = {
    async readOverview(page) {
      selectedPages.push(page);
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
    batch: { code: "EZT261018", name: "正式批次" },
    desiredSnapshot,
  }, {
    context,
    adapter,
    closeContext: false,
    reuseVerifiedDetail: true,
    verifiedDetailUrl: targetDetailUrl,
  });

  assert.equal(result.action, "none");
  assert.deepEqual(selectedPages, [targetPage]);
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
