import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOperationPersonnelTaskDraft,
  buildOperationPersonnelTaskStatus,
  diffOperationPersonnelTaskDrafts,
  operationPersonnelTaskFingerprint,
} from "./operation_personnel_task.mjs";
import { operationPersonnelScheduleGate } from "./operation_personnel_schedule_gate.mjs";
import {
  assertVisiblePersonnelDateInputs,
  fillVisiblePersonnelConfiguration,
  inspectOperationPersonnelTask,
  clickVisiblePersonnelPaginationNext,
  OPERATION_PERSONNEL_CHECKPOINTS,
  operationPersonnelCurrentPageFromVisibleRaw,
  operationPersonnelPageFromVisibleRaw,
  operationPersonnelConflicts,
  operationPersonnelDisplaySchedules,
  operationPersonnelRecipientGroupMatches,
  operationPersonnelRecipientRule,
  operationPersonnelTaskListFilterSettled,
  operationPersonnelTaskListCanReuseFilter,
  operationPersonnelTaskListPageCount,
  operationPersonnelTaskSearchValue,
  readVisiblePersonnelTaskResultSummary,
  matchOperationPersonnelRecipients,
  runOperationPersonnelAttempt,
  selectVisiblePersonnelDate,
  submitVisiblePersonnelTaskFilter,
  waitForVisiblePersonnelConfiguration,
  waitForVisiblePersonnelTaskInitialResults,
  waitForVisiblePersonnelTaskListFilter,
} from "./operation_personnel_task_runner.mjs";

function baseTask() {
  return {
    taskId: "personnel-task-a",
    projectName: "示例考试",
    config: {
      operationBatchCode: "EZT260003",
      operationBatch: {
        code: "EZT260003",
        draft: { fields: {
          batchName: { value: "示例考试_2026年8月" },
          projectDepartment: { value: "项目实施一部" },
        } },
      },
      businessRequirement: {
        operation_serial_number: "R0042483",
        project_code: "P260001",
        project_name: "示例考试",
        project_manager: "陈军",
        ata_invigilator_arrangement: "需要安排分散人工监考",
      },
      examRequirements: [{
        id: "requirement-1",
        version: 3,
        fields: { "考试名称": "示例考试" },
        config: {
          startTimeDisplay: "2026/08/20 09:00",
          endTimeDisplay: "2026/08/20 11:00",
          earlyLoginMinutes: 30,
          courses: [{ code: "C001", name: "综合能力" }],
        },
      }],
    },
    sessions: [{
      sessionType: "formal",
      start: "2026/08/20 09:00",
      end: "2026/08/20 11:00",
      candidateCount: 81,
      roomCount: 3,
    }],
  };
}

test("人员任务草稿保留日程编号并套用平台收件人规则", () => {
  const first = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
    makeId: () => "stable-subject",
  });
  const second = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:01:00.000Z",
    scheduleCodeMap: first.scheduleCodeMap,
    makeId: () => "stable-subject",
  });

  assert.equal(first.batch.batchName, "示例考试_2026年8月");
  assert.equal(first.schedules[0].scheduleCode, 1);
  assert.equal(second.schedules[0].scheduleCode, 1);
  assert.deepEqual(first.recipients, {
    toGroup: "项目实施一部",
    toNames: ["陈军"],
    ccGroup: "考站管理&质量控制部",
    ccCount: 0,
    ccGroupOnly: true,
    ruleVersion: 3,
  });
  assert.equal(first.personnel.candidateBasis, 27);
  assert.equal(first.personnel.monitorRatio, "1:27");
  assert.equal(first.personnel.monitorCount, 3);
  assert.equal(first.personnel.loginMonitoring, "否");
  assert.equal(first.warnings.length, 0);
});

test("人员任务按项目负责人匹配平台账号并兼容项目经理目录后缀", () => {
  const task = baseTask();
  task.config.businessRequirement.project_manager = "司园园";
  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });
  const rule = operationPersonnelRecipientRule({ batch: draft.batch });
  const matched = matchOperationPersonnelRecipients({
    batch: draft.batch,
    groups: [{
      name: "项目实施一部(项目经理)",
      people: [{ id: "siyuanyuan@ata.net.cn", name: "司园园" }],
    }, {
      name: "考站管理&质量控制部",
      people: [],
    }],
  });

  assert.equal(operationPersonnelRecipientGroupMatches("项目实施一部（项目经理）", "项目实施一部"), true);
  assert.equal(rule.toName, "司园园");
  assert.equal(rule.ccGroup, "考站管理&质量控制部");
  assert.deepEqual(matched, {
    to: [{ id: "siyuanyuan@ata.net.cn", name: "司园园" }],
    cc: [{ id: "group:考站管理&质量控制部", name: "考站管理&质量控制部", kind: "group" }],
  });
});

test("人员任务状态会区分待建批次和可核对状态", () => {
  const task = baseTask();
  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
    makeId: () => "stable-subject",
  });
  const waitingDraft = structuredClone(draft);
  waitingDraft.batch.code = "";
  assert.equal(buildOperationPersonnelTaskStatus({ ...task, config: { ...task.config, operationBatchCode: "" } }, waitingDraft).status, "waiting_batch");
  assert.equal(buildOperationPersonnelTaskStatus(task, draft).status, "ready");
});

test("已有批次代码时人员任务不要求先建立日程同步基线", () => {
  const task = baseTask();
  const result = operationPersonnelScheduleGate(task);
  assert.equal(result.ok, true);
  assert.deepEqual(result.schedules, []);
  assert.equal(result.managedSnapshot, null);
});

test("无受管基线时本地斜杠日期仍可严格匹配运控日程", () => {
  assert.deepEqual(operationPersonnelDisplaySchedules([
    {
      requirementIndex: 0,
      name: "综合能力",
      start: "2026/08/20 09:00",
      end: "2026/08/20 11:00",
    },
  ], [
    {
      scheduleCode: 1,
      subjectName: "综合能力",
      start: "2026-08-20 09:00",
      end: "2026-08-20 11:00",
    },
  ]), [
    {
      scheduleCode: 1,
      name: "综合能力",
      start: "2026/08/20 09:00",
      end: "2026/08/20 11:00",
    },
  ]);
});

test("人员任务指纹和变更摘要只包含可发送字段", () => {
  const before = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
    makeId: () => "stable-subject",
  });
  const after = structuredClone(before);
  after.dates.end = "2026-08-19";
  const beforeFingerprint = operationPersonnelTaskFingerprint(before);
  assert.match(beforeFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(beforeFingerprint, operationPersonnelTaskFingerprint(after));
  assert.equal(diffOperationPersonnelTaskDrafts(before, after).summary, "人员落实结束日期：2026-08-17 → 2026-08-19");
});

test("人员执行先完成人员配置，再进入考试日程和任务单", () => {
  const target = {
    batch: { code: "EZT260003", batchName: "示例考试_2026年8月", published: true },
    schedules: [{
      scheduleCode: 1,
      subjectName: "综合能力",
      start: "2026-08-20 09:00",
      end: "2026-08-20 11:00",
    }],
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: "悦站",
      loginMonitoring: "否",
      monitorRatio: "1:50",
      monitorCount: 2,
      earliestLoginMinutes: 30,
      trialIncluded: false,
    },
    dates: { start: "2026-08-05", end: "2026-08-17", nameListDue: "2026-08-17" },
    requirements: [{ name: "监考说明", value: "按要求执行" }],
    taskSheet: {
      type: "分散在线监考",
      conditions: [{ name: "人员信息", satisfied: true }],
      content: "示例任务单",
    },
    directoryMatch: {
      to: [{ id: "chenjun@ata.net.cn", name: "陈军" }],
      cc: [{ id: "group:考站管理&质量控制部", name: "考站管理&质量控制部", kind: "group" }],
    },
  };
  assert.deepEqual(
    operationPersonnelConflicts(
      target,
      { batch: target.batch, schedules: target.schedules, personnel: {}, dates: {}, requirements: [] },
      "initial",
    ),
    [],
  );
  assert.ok(
    OPERATION_PERSONNEL_CHECKPOINTS.indexOf("sync_personnel_config")
      < OPERATION_PERSONNEL_CHECKPOINTS.indexOf("verify_exam_schedules"),
  );
  assert.ok(
    OPERATION_PERSONNEL_CHECKPOINTS.indexOf("sync_exam_service_requirements")
      < OPERATION_PERSONNEL_CHECKPOINTS.indexOf("verify_task_sheet"),
  );
});

test("运营人员页会等待监考类型等配置字段完整后再回读", async () => {
  const incompleteLines = [
    "人员落实日期：",
    "2026-08-06 ~ 2026-08-06",
    "人员落实平台：",
    "悦站",
  ];
  const completeLines = [
    ...incompleteLines,
    "监考类型：",
    "分散监考",
    "人员名单提交日期：",
    "2026-08-06",
  ];
  let reads = 0;
  let waits = 0;
  const snapshot = await waitForVisiblePersonnelConfiguration({
    evaluate: async () => ({
      lines: reads++ === 0 ? incompleteLines : completeLines,
    }),
    waitForTimeout: async () => { waits += 1; },
  }, { maxChecks: 2, pollMs: 1 });

  assert.equal(reads, 2);
  assert.equal(waits, 1);
  assert.equal(snapshot.personnel.serviceType, "ATA 监考－分散在线监考");
  assert.deepEqual(snapshot.dates, {
    start: "2026-08-06",
    end: "2026-08-06",
    nameListDue: "2026-08-06",
  });
});

test("运营人员页持续缺少监考类型时给出准确阻断字段", async () => {
  await assert.rejects(
    waitForVisiblePersonnelConfiguration({
      evaluate: async () => ({
        lines: [
          "人员落实日期：",
          "2026-08-06 ~ 2026-08-06",
          "人员落实平台：",
          "悦站",
          "人员名单提交日期：",
          "2026-08-06",
        ],
      }),
      waitForTimeout: async () => {},
    }, { maxChecks: 2, pollMs: 1 }),
    (error) => error.code === "PERSONNEL_OPERATION_CONFLICT"
      && error.message.includes("监考类型"),
  );
});

test("人员日期选择器会从误开的年份面板恢复到目标日期", async () => {
  assert.equal(typeof fillVisiblePersonnelConfiguration, "function");
  const events = [];
  let panel = "year";
  const emptyControl = {
    count: async () => 0,
    first() { return this; },
  };
  const calendar = {
    count: async () => 1,
    locator(selector) {
      if (selector.includes("year-panel-cell")) {
        return {
          count: async () => 1,
          click: async () => {
            events.push("year:2026");
            panel = "month";
          },
        };
      }
      if (selector.includes("month-panel-month")) {
        return {
          filter: ({ hasText }) => ({
            count: async () => hasText.test("八月") ? 1 : 0,
            click: async () => {
              events.push("month:8");
              panel = "date";
            },
          }),
        };
      }
      throw new Error(`unexpected calendar selector: ${selector}`);
    },
  };
  const panelControl = (name) => ({
    count: async () => panel === name ? 1 : 0,
    first: () => ({
      locator: () => calendar,
    }),
  });
  const input = {
    count: async () => 1,
    click: async () => events.push("input"),
  };
  const dateCell = {
    count: async () => 1,
    click: async (options) => {
      assert.deepEqual(options, { force: true, timeout: 10_000 });
      events.push("date:2026-08-06");
    },
  };
  const page = {
    locator(selector) {
      if (selector === ".ant-calendar-decade-panel:visible") return panelControl("decade");
      if (selector === ".ant-calendar-year-panel:visible") return panelControl("year");
      if (selector === ".ant-calendar-month-panel:visible") return panelControl("month");
      if (selector.includes('[title="2026年8月6日"]')) return dateCell;
      if (selector === ".ant-calendar-picker-container:visible") return emptyControl;
      throw new Error(`unexpected page selector: ${selector}`);
    },
    waitForTimeout: async () => {},
  };
  const dialog = {
    locator: (selector) => {
      assert.equal(selector, 'input[placeholder="请选择日期"]:visible');
      return input;
    },
  };

  await selectVisiblePersonnelDate(page, dialog, "请选择日期", "2026-08-06");

  assert.deepEqual(events, ["input", "year:2026", "month:8", "date:2026-08-06"]);
  assert.equal(operationPersonnelPageFromVisibleRaw({
    lines: ["监考类型：", "分散监考"],
  }).personnel.serviceType, "ATA 监考－分散在线监考");
});

test("人员日期在点击确定前必须回读为目标结束日期和提交日期", async () => {
  const values = new Map([
    ['input[placeholder="开始日期"]:visible', "2026-08-07"],
    ['input[placeholder="结束日期"]:visible', "2026-08-10"],
    ['input[placeholder="请选择日期"]:visible', "2026-08-10"],
  ]);
  const dialog = {
    locator(selector) {
      return {
        count: async () => 1,
        inputValue: async () => values.get(selector),
      };
    },
  };
  const expected = { start: "2026-08-07", end: "2026-08-10", nameListDue: "2026-08-10" };

  await assertVisiblePersonnelDateInputs(dialog, expected);
  values.set('input[placeholder="结束日期"]:visible', "2026-08-17");
  await assert.rejects(
    assertVisiblePersonnelDateInputs(dialog, expected),
    (error) => error.code === "PERSONNEL_OPERATION_CONFLICT"
      && error.message.includes("结束日期期望 2026-08-10，实际 2026-08-17"),
  );
});

test("任务列表翻页直接点击当前节点，避免 Ant 重绘后的旧节点超时", async () => {
  let clicked = 0;
  const clickable = {
    count: async () => 1,
    evaluate: async (callback) => callback({ click: () => { clicked += 1; } }),
  };
  const control = {
    locator: (selector) => {
      assert.equal(selector, "button, a");
      return { first: () => clickable };
    },
  };

  await clickVisiblePersonnelPaginationNext(control);

  assert.equal(clicked, 1);
});

test("任务列表当前页从同一次可见 DOM 快照读取", () => {
  assert.equal(operationPersonnelCurrentPageFromVisibleRaw({
    paginationCount: 1,
    activeCount: 1,
    value: "3",
  }), 3);
  assert.equal(operationPersonnelCurrentPageFromVisibleRaw({ paginationCount: 0 }), 1);
  assert.throws(
    () => operationPersonnelCurrentPageFromVisibleRaw({
      paginationCount: 1,
      activeCount: 0,
    }),
    /分散在线监考任务当前页.*实际 0 个/,
  );
});

test("任务列表筛选前等待初始结果统计渲染完成", async () => {
  let waited = false;
  const summary = {
    count: async () => (waited ? 1 : 0),
    first: () => summary,
    waitFor: async ({ state, timeout }) => {
      assert.equal(state, "visible");
      assert.equal(timeout, 250);
      waited = true;
    },
    innerText: async () => "找到 717 条结果",
  };
  const page = {
    getByText: (pattern) => {
      assert.match("找到 1 条结果", pattern);
      return summary;
    },
  };

  assert.equal(await readVisiblePersonnelTaskResultSummary(page, 250), "找到 717 条结果");
  assert.equal(waited, true);
});

test("任务列表同时等待结果统计、可见行数和精确匹配稳定", () => {
  const base = {
    previousSummary: "找到 717 条结果",
    summary: "找到 1 条结果",
    exactCount: 1,
    pageSize: 10,
    paginationCount: 1,
    activePage: 1,
    nextDisabled: true,
  };
  assert.equal(operationPersonnelTaskListFilterSettled({ ...base, rowCount: 10 }), false);
  assert.equal(operationPersonnelTaskListFilterSettled({ ...base, rowCount: 1 }), true);
  assert.equal(operationPersonnelTaskListFilterSettled({
    ...base,
    rowCount: 1,
    activePage: 6,
    nextDisabled: false,
  }), false);
});

test("任务列表按稳定结果总数限制最大页数", () => {
  assert.equal(operationPersonnelTaskListPageCount("找到 1 条结果", 10), 1);
  assert.equal(operationPersonnelTaskListPageCount("找到 21 条结果", 10), 3);
});

test("任务列表复用已完成的同批次唯一筛选", () => {
  assert.equal(operationPersonnelTaskListCanReuseFilter(
    "示例批次_2026年8月",
    "示例批次_2026年8月",
    "找到 1 条结果",
  ), true);
  assert.equal(operationPersonnelTaskListCanReuseFilter(
    "",
    "示例批次_2026年8月",
    "找到 717 条结果",
  ), false);
});

test("任务列表筛选需连续稳定，忽略初始化期间的瞬时正确状态", async () => {
  const stable = {
    previousSummary: "找到 717 条结果",
    summary: "找到 1 条结果",
    tableCount: 1,
    exactCount: 1,
    rowCount: 1,
    pageSize: 10,
    paginationCount: 1,
    activePage: 1,
    nextDisabled: true,
  };
  const unstable = { ...stable, exactCount: 0, rowCount: 0 };
  const snapshots = [stable, stable, unstable, stable, stable, stable];
  let reads = 0;
  const page = {
    evaluate: async () => snapshots[reads++],
    waitForTimeout: async () => {},
  };

  assert.deepEqual(await waitForVisiblePersonnelTaskListFilter(page, {
    maxChecks: snapshots.length,
    stableChecks: 3,
    pollMs: 0,
  }), stable);
  assert.equal(reads, snapshots.length);
});

test("任务列表可要求完整批次名筛选结果必须唯一", async () => {
  const multiple = {
    previousSummary: "找到 717 条结果",
    summary: "找到 2 条结果",
    tableCount: 1,
    exactCount: 1,
    rowCount: 2,
    pageSize: 10,
    paginationCount: 1,
    activePage: 1,
    nextDisabled: true,
  };
  await assert.rejects(
    waitForVisiblePersonnelTaskListFilter({
      evaluate: async () => multiple,
      waitForTimeout: async () => {},
    }, {
      maxChecks: 2,
      stableChecks: 1,
      requiredSummary: "找到 1 条结果",
      pollMs: 0,
    }),
    /查询结果未稳定/,
  );
});

test("任务列表重新查询时先清空同值输入以触发筛选", async () => {
  const actions = [];
  await submitVisiblePersonnelTaskFilter({
    fill: async (value) => actions.push(["fill", value]),
    press: async (value) => actions.push(["press", value]),
  }, "示例批次_2026年8月");
  assert.deepEqual(actions, [
    ["fill", ""],
    ["fill", "示例批次_2026年8月"],
    ["press", "Enter"],
  ]);
});

test("任务列表表头加载后才决定使用批次名称筛选", () => {
  assert.equal(operationPersonnelTaskSearchValue({
    batchCodeColumnVisible: false,
    batchNameColumnVisible: true,
  }, "EZT260001", "示例批次_2026年8月"), "示例批次_2026年8月");
  assert.throws(
    () => operationPersonnelTaskSearchValue({}, "EZT260001", "示例批次_2026年8月"),
    /缺少可见的批次代码或批次名称列/,
  );
});

test("任务列表等待初始 0 条过渡为已加载结果后再筛选", async () => {
  const summaries = ["找到 0 条结果", "找到 717 条结果"];
  let index = 0;
  const summary = {
    count: async () => 1,
    first: () => summary,
    innerText: async () => summaries[Math.min(index++, summaries.length - 1)],
  };
  const page = {
    getByText: () => summary,
    waitForTimeout: async () => {},
  };

  assert.equal(await waitForVisiblePersonnelTaskInitialResults(page, {
    maxChecks: 2,
    pollMs: 0,
  }), "找到 717 条结果");
  assert.equal(index, 2);
});

test("人员配置优先时只读预检查不会打开人员任务单", async () => {
  let openedTaskSheet = false;
  const batch = { code: "EZT260003", batchName: "示例考试_2026年8月", published: true };
  const snapshot = await inspectOperationPersonnelTask(
    {},
    { environment: "test", batch, batchCode: batch.code, skipTaskSheet: true },
    {
      readBatchPages: async () => ({
        headers: ["批次代码"],
        pages: [[{ cells: [batch.code] }]],
      }),
      openBatchRow: async () => {},
      readBatch: async () => batch,
      openEztestSchedulePage: async () => {},
      readSchedules: async () => [{
        scheduleCode: 1,
        subjectName: "综合能力",
        start: "2026-08-20 09:00",
        end: "2026-08-20 11:00",
      }],
      readPersonnel: async () => ({}),
      readDates: async () => ({}),
      readRequirements: async () => [],
      readTaskSheet: async () => {
        openedTaskSheet = true;
        return {};
      },
      readSendRecords: async () => [],
      readDirectoryGroups: async () => [],
    },
  );

  assert.equal(openedTaskSheet, false);
  assert.equal(snapshot.batch.code, batch.code);
  assert.equal(snapshot.batch.batchName, batch.batchName);
  assert.equal(snapshot.batch.published, true);
  assert.equal(snapshot.schedules.length, 1);
  assert.equal(snapshot.personnel.serviceType, "");
  assert.equal(snapshot.personnel.platform, "");
});

test("人员任务实际执行先写入并回读人员配置，再打开任务单", async () => {
  const events = [];
  let configured = false;
  let submitted = false;
  let selectedRecipients = { to: [], cc: [] };
  const now = Date.parse("2026-08-05T02:00:00.000Z");
  const batch = {
    code: "EZT260003",
    batchName: "示例考试_2026年8月",
    projectDepartment: "项目实施一部",
    projectManager: "陈军",
    published: true,
  };
  const schedules = [{
    scheduleCode: 1,
    subjectName: "综合能力",
    start: "2026-08-20 09:00",
    end: "2026-08-20 11:00",
  }];
  const target = {
    batch,
    schedules,
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: "悦站",
      loginMonitoring: "否",
      monitorRatio: "1:50",
      monitorCount: 2,
      earliestLoginMinutes: 30,
      trialIncluded: false,
    },
    dates: { start: "2026-08-05", end: "2026-08-17", nameListDue: "2026-08-17" },
    requirements: [{ name: "监考说明", value: "按要求执行" }],
    taskSheet: {
      type: "分散在线监考",
      conditions: [{ name: "人员信息", satisfied: true }],
      content: "示例任务单",
    },
    directoryMatch: { to: [], cc: [] },
  };
  const readPersonnel = async () => configured ? target.personnel : {};
  const readDates = async () => configured ? target.dates : {};
  const readRequirements = async () => configured ? target.requirements : [];
  const options = {
    context: {
      pages: () => [{}],
      close: async () => {},
    },
    now: () => now,
    readBatchPages: async () => ({
      headers: ["批次代码"],
      pages: [[{ cells: [batch.code] }]],
    }),
    openBatchRow: async () => {},
    readBatch: async () => batch,
    openEztestSchedulePage: async () => events.push("openEztestSchedulePage"),
    readSchedules: async () => schedules,
    openPersonnelPage: async () => events.push("openPersonnelPage"),
    readPersonnel,
    syncPersonnelConfig: async () => {
      events.push("syncPersonnelConfig");
      configured = true;
    },
    readDates,
    syncPersonnelDates: async () => events.push("syncPersonnelDates"),
    readRequirements,
    syncExamServiceRequirements: async () => events.push("syncExamServiceRequirements"),
    openTaskSheet: async () => events.push("openTaskSheet"),
    readTaskSheet: async () => {
      events.push("readTaskSheet");
      return target.taskSheet;
    },
    readTaskSheetSchedules: async () => schedules,
    readDirectoryGroups: async () => [{
      name: "项目实施一部(项目经理)",
      people: [{ id: "chenjun@ata.net.cn", name: "陈军" }],
    }, {
      name: "考站管理&质量控制部",
      people: [],
    }],
    readSelectedRecipients: async () => selectedRecipients,
    selectRecipients: async (_page, recipients) => {
      events.push("selectRecipients");
      selectedRecipients = structuredClone(recipients);
    },
    confirmSend: async () => {
      events.push("confirmSend");
      submitted = true;
    },
    readSendRecords: async () => submitted
      ? [{ type: "首次发送", sentAt: new Date(now).toISOString() }]
      : [],
    closeTaskSheet: async () => {},
    reopenTaskSheet: async () => {},
  };

  const result = await runOperationPersonnelAttempt({
    environment: "test",
    kind: "initial",
    batch,
    target,
    baseline: target,
    managedSchedules: [{
      requirementIndex: 0,
      name: "综合能力",
      start: "2026-08-20 09:00",
      end: "2026-08-20 11:00",
    }],
    displaySchedules: [{
      scheduleCode: 1,
      name: "综合能力",
      start: "2026-08-20 09:00",
      end: "2026-08-20 11:00",
    }],
  }, options);

  assert.equal(result.status, "sent");
  assert.ok(events.indexOf("syncPersonnelConfig") >= 0);
  assert.ok(events.indexOf("openTaskSheet") >= 0);
  assert.ok(events.indexOf("syncPersonnelConfig") < events.indexOf("openTaskSheet"));
  assert.deepEqual(selectedRecipients, {
    to: [{ id: "chenjun@ata.net.cn", name: "陈军" }],
    cc: [{ id: "group:考站管理&质量控制部", name: "考站管理&质量控制部", kind: "group" }],
  });
  assert.equal(submitted, true);
});
