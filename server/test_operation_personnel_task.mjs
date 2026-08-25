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
  closeOperationPersonnelBrowserSession,
  fillVisiblePersonnelConfiguration,
  fillVisiblePersonnelTaskChangeSummary,
  inspectOperationPersonnelTask,
  clickVisiblePersonnelPaginationNext,
  OPERATION_PERSONNEL_CHECKPOINTS,
  operationPersonnelCurrentPageFromVisibleRaw,
  operationPersonnelPageFromVisibleRaw,
  operationPersonnelConflicts,
  operationPersonnelContextPage,
  operationPersonnelDisplaySchedules,
  operationPersonnelMailSelectionTarget,
  operationPersonnelRecipientGroupMatches,
  operationPersonnelRecipientRule,
  operationPersonnelTaskListFilterSettled,
  operationPersonnelTaskListCanReuseFilter,
  operationPersonnelTaskListPageCount,
  operationPersonnelTaskSearchValue,
  operationPersonnelTaskSheetFromVisibleRaw,
  openVisibleBatchPersonnelTaskSheet,
  readVisiblePersonnelTaskResultSummary,
  matchOperationPersonnelRecipients,
  runOperationPersonnelAttempt,
  selectVisiblePersonnelRecipients,
  selectVisiblePersonnelDate,
  selectVisiblePersonnelDateRange,
  submitVisiblePersonnelTaskFilter,
  waitForVisiblePersonnelConfiguration,
  waitForVisiblePersonnelTaskInitialResults,
  waitForVisiblePersonnelTaskListFilter,
} from "./operation_personnel_task_runner.mjs";

test("人员任务重发精确填写并回读人工变更内容", async () => {
  const events = [];
  let inputValue = "";
  const summary = {
    count: async () => 1,
    first: () => ({ waitFor: async ({ state }) => events.push(`wait:${state}`) }),
    fill: async (value) => {
      inputValue = value;
      events.push(`fill:${value}`);
    },
    inputValue: async () => inputValue,
  };
  const next = {
    count: async () => 1,
    click: async () => events.push("next"),
  };
  const dialog = {
    count: async () => 1,
    first: () => ({ waitFor: async () => {} }),
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert.deepEqual(options, { name: "下一步", exact: true });
      return next;
    },
  };
  const page = {
    locator: (selector) => {
      if (selector.includes("placeholder")) return summary;
      assert.equal(selector, ".ant-modal:visible");
      return {
        filter: (options) => {
          assert.deepEqual(options, { hasText: "填写变更内容" });
          return dialog;
        },
      };
    },
  };

  assert.equal(
    await fillVisiblePersonnelTaskChangeSummary(page, " 调整人员落实日期 "),
    "调整人员落实日期",
  );
  assert.deepEqual(events, [
    "wait:visible",
    "fill:调整人员落实日期",
    "next",
  ]);
});

test("人员任务重发拒绝空白、超长或回读不一致的变更内容", async () => {
  await assert.rejects(
    () => fillVisiblePersonnelTaskChangeSummary({}, "  "),
    (error) => error?.code === "PERSONNEL_CHANGE_SUMMARY_REQUIRED",
  );
  await assert.rejects(
    () => fillVisiblePersonnelTaskChangeSummary({}, "x".repeat(4001)),
    (error) => error?.code === "PERSONNEL_CHANGE_SUMMARY_TOO_LONG",
  );
  await assert.rejects(
    () => fillVisiblePersonnelTaskChangeSummary({
      locator: () => ({
        first: () => ({ waitFor: async () => { throw new Error("missing"); } }),
      }),
    }, "本次变更"),
    (error) => error?.code === "PERSONNEL_CHANGE_SUMMARY_CONTROL_MISSING",
  );
  await assert.rejects(
    () => fillVisiblePersonnelTaskChangeSummary({
      locator: () => ({
        count: async () => 1,
        first: () => ({ waitFor: async () => {} }),
        fill: async () => {},
        inputValue: async () => "其他内容",
      }),
    }, "本次变更"),
    (error) => error?.code === "PERSONNEL_CHANGE_SUMMARY_READBACK_MISMATCH",
  );
});

test("人员任务优先复用当前已打开的目标批次详情页", async () => {
  const unrelatedPage = { url: () => "https://oa.ata.net.cn/workflow/request/ViewRequest.jsp" };
  const operationListPage = { url: () => "https://dashboard.ata.net.cn/batch/batchList" };
  const targetPage = {
    url: () => "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=target-guid",
  };
  let newPageCalls = 0;
  const selected = await operationPersonnelContextPage({
    pages: () => [unrelatedPage, operationListPage, targetPage],
    newPage: async () => {
      newPageCalls += 1;
      return { url: () => "about:blank" };
    },
  }, {
    detailUrl: "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=target-guid",
  }, {
    baseUrl: "https://dashboard.ata.net.cn/dashboard",
  });

  assert.equal(selected.page, targetPage);
  assert.equal(selected.batchDetailLocated, true);
  assert.equal(newPageCalls, 0);
});

test("人员任务结束不关闭本机助手共享的 Chrome 上下文", async () => {
  let closeCalls = 0;
  const session = {
    context: { close: async () => { closeCalls += 1; } },
    ownsContext: false,
    closed: false,
  };

  await closeOperationPersonnelBrowserSession(session);

  assert.equal(session.closed, true);
  assert.equal(closeCalls, 0);
});

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
  assert.equal(first.schedules.length, 1);
  assert.equal(first.schedules[0].subjectName, "示例考试");
  assert.equal(first.schedules[0].scheduleCode, 1);
  assert.equal(second.schedules[0].scheduleCode, 1);
  assert.deepEqual(first.recipients, {
    toGroup: "项目实施一部",
    toNames: ["陈军"],
    ccGroup: "考站管理&质量控制部",
    ccGroups: ["考站管理&质量控制部", "结算组"],
    ccCount: 0,
    ccGroupOnly: true,
    ruleVersion: 4,
  });
  assert.equal(first.personnel.candidateBasis, 27);
  assert.equal(first.personnel.monitorRatio, "1:27");
  assert.equal(first.personnel.monitorCount, 3);
  assert.equal(first.personnel.loginMonitoring, "否");
  assert.equal(first.warnings.length, 0);
});

test("人员任务按正式考试生成日程，不按科目拆行", () => {
  const task = baseTask();
  task.config.examRequirements[0].fields["考试名称"] = "正式考试名称";
  task.config.examRequirements[0].config.courses = [
    { name: "建设项目管理岗" },
    { name: "电力交易员岗" },
  ];

  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });

  assert.equal(draft.schedules.length, 1);
  assert.equal(draft.schedules[0].subjectName, "正式考试名称");
  assert.equal(draft.schedules[0].start, "2026/08/20 09:00");
  assert.equal(draft.schedules[0].end, "2026/08/20 11:00");
  assert.equal(draft.schedules[0].subjectCode, "");
});

test("人员任务优先使用已创建正式场次的名称和日程", () => {
  const task = baseTask();
  task.sessions[0] = {
    ...task.sessions[0],
    requirementIndex: 0,
    name: "已创建正式场次",
    start: "2026/08/20 09:30",
    end: "2026/08/20 11:30",
  };

  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });

  assert.equal(draft.schedules.length, 1);
  assert.equal(draft.schedules[0].subjectName, "已创建正式场次");
  assert.equal(draft.schedules[0].start, "2026/08/20 09:30");
  assert.equal(draft.schedules[0].end, "2026/08/20 11:30");
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
    }, {
      name: "结算组",
      people: [],
    }],
  });

  assert.equal(operationPersonnelRecipientGroupMatches("项目实施一部（项目经理）", "项目实施一部"), true);
  assert.equal(rule.toName, "司园园");
  assert.equal(rule.ccGroup, "考站管理&质量控制部");
  assert.deepEqual(rule.ccGroups, ["考站管理&质量控制部", "结算组"]);
  assert.deepEqual(matched, {
    to: [{ id: "siyuanyuan@ata.net.cn", name: "司园园" }],
    cc: [
      { id: "group:考站管理&质量控制部", name: "考站管理&质量控制部", kind: "group" },
      { id: "group:结算组", name: "结算组", kind: "group" },
    ],
  });
});

test("人员任务复用内容任务单邮箱选择目标", () => {
  const rule = operationPersonnelRecipientRule({
    batch: { projectDepartment: "项目实施一部", projectManager: "陈军" },
  });
  const recipients = {
    to: [{ id: "chenjun@ata.net.cn", name: "陈军" }],
    cc: rule.ccGroups.map((name) => ({ id: `group:${name}`, name, kind: "group" })),
  };
  assert.deepEqual(operationPersonnelMailSelectionTarget(recipients, rule), {
    recipients: ["chenjun@ata.net.cn"],
    cc: [],
    directoryGroups: {
      recipients: [{
        name: "项目实施一部(项目经理)",
        emails: ["chenjun@ata.net.cn"],
      }],
      cc: [],
    },
    selectedGroups: {
      recipients: [],
      cc: ["考站管理&质量控制部", "结算组"],
    },
    recipientLabel: "人员任务单收件人",
    ccLabel: "人员任务单抄送",
    ccGroupLabel: "人员任务单抄送部门",
  });
});

test("人员任务按内容任务单顺序清空、展开、选择并回读邮箱", async () => {
  const rule = operationPersonnelRecipientRule({
    batch: { projectDepartment: "项目实施一部", projectManager: "陈军" },
  });
  const state = new Map([
    ["项目实施一部(项目经理)", false],
    ["chenjun@ata.net.cn (陈军)", false],
    ["考站管理&质量控制部", false],
    ["结算组", false],
  ]);
  const metadata = [
    { label: "项目实施一部(项目经理)", section: "recipients" },
    { label: "chenjun@ata.net.cn (陈军)", section: "recipients", parent: "项目实施一部(项目经理)" },
    { label: "考站管理&质量控制部", section: "cc" },
    { label: "结算组", section: "cc" },
  ];
  const visibleMetadata = () => metadata.filter((item) => !item.parent || state.get(item.parent));
  const control = (entry) => ({
    evaluate: async () => ({ label: entry.label, section: entry.section }),
    isChecked: async () => state.get(entry.label),
    click: async () => { state.set(entry.label, !state.get(entry.label)); },
    check: async () => { state.set(entry.label, true); },
    uncheck: async () => { state.set(entry.label, false); },
  });
  const dialog = {
    evaluate: async () => visibleMetadata().map((entry) => ({
      label: entry.label,
      section: entry.section,
      checked: state.get(entry.label),
    })),
    locator(selector) {
      assert.equal(selector, 'input[type="checkbox"]');
      return { all: async () => visibleMetadata().map(control) };
    },
  };

  assert.deepEqual(await selectVisiblePersonnelRecipients(
    { waitForTimeout: async () => {} },
    dialog,
    {
      to: [{ id: "chenjun@ata.net.cn", name: "陈军" }],
      cc: rule.ccGroups.map((name) => ({ id: `group:${name}`, name, kind: "group" })),
    },
    rule,
  ), {
    recipients: ["chenjun@ata.net.cn"],
    cc: [],
    groups: {
      recipients: ["项目实施一部(项目经理)"],
      cc: ["考站管理&质量控制部", "结算组"],
    },
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

test("自动建批次后平台日程未同步到空快照时仍可实时核对", () => {
  const task = baseTask();
  task.config.operationBatch = {
    ...task.config.operationBatch,
    status: "published",
    scheduleStatus: "failed",
    managedSnapshot: {
      batchName: "示例考试_2026年8月",
      examStartDate: "2026-08-20",
      examEndDate: "2026-08-20",
      schedules: [],
    },
  };

  const result = operationPersonnelScheduleGate(task);

  assert.equal(result.ok, true);
  assert.deepEqual(result.schedules, []);
  assert.deepEqual(result.managedSnapshot, task.config.operationBatch.managedSnapshot);
});

test("空日程快照的批次概况字段无效时仍然阻断", () => {
  const task = baseTask();
  task.config.operationBatch.managedSnapshot = {
    batchName: "示例考试_2026年8月",
    examStartDate: "无效日期",
    examEndDate: "2026-08-20",
    schedules: [],
  };

  const result = operationPersonnelScheduleGate(task);

  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_SCHEDULE_CONFLICT");
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
  assert.equal(
    diffOperationPersonnelTaskDrafts(before, after).summary,
    "人员落实结束日期：由“2026-08-17”调整为“2026-08-19”",
  );
});

test("人员任务变更摘要覆盖批次、日程和收件规则", () => {
  const before = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
    makeId: () => "stable-subject",
  });
  const after = structuredClone(before);
  after.batch.name = "变更后的批次";
  after.schedules[0].start = "2026-08-20 10:00";
  after.recipients.toNames = ["另一位项目经理"];

  const summary = diffOperationPersonnelTaskDrafts(before, after).summary;
  assert.match(summary, /批次名称/);
  assert.match(summary, /修改考试日程/);
  assert.match(summary, /收件人/);
});

test("人员执行先核验考试日程，再同步人员配置并进入任务单", () => {
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
    OPERATION_PERSONNEL_CHECKPOINTS.indexOf("verify_exam_schedules")
      < OPERATION_PERSONNEL_CHECKPOINTS.indexOf("sync_personnel_config"),
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
      && error.reasonCode === "PERSONNEL_CONFIGURATION_INCOMPLETE"
      && error.missingFields.includes("监考类型")
      && error.message.includes("监考类型"),
  );
});

test("人员配置和考务需求已完整回填时直接点击发送任务单", async () => {
  const lines = [
    "人员落实日期：", "2026-08-18 ~ 2026-08-19",
    "人员落实平台：", "悦站",
    "监考类型：", "分散监考",
    "人员名单提交日期：", "2026-08-19",
    "正式考试-最早登录系统时间：", "考生可于考试开始前30分钟登录",
    "正式考试-监考人员安排：", "ATA监考-分散，已安排人员周玉衡",
    "正式考试-监考人员数量：", "1",
    "正式考试-监考人员比例：", "1:24",
    "正式考试-监考登录监控：", "否",
  ];
  let sendClicks = 0;
  const control = (selected = "true", onClick = () => {}) => ({
    count: async () => 1,
    waitFor: async () => {},
    getAttribute: async () => selected,
    click: async () => onClick(),
  });
  const taskSheet = {
    count: async () => 1,
    filter() { return this; },
  };
  const page = {
    getByRole(_role, options = {}) {
      if (options.name === "人员" || options.name === "在线监考") return control();
      if (options.name === "发送任务单") return control("", () => { sendClicks += 1; });
      throw new Error(`未预期的角色定位：${String(options.name)}`);
    },
    evaluate: async () => ({ lines }),
    waitForTimeout: async () => {},
    locator(selector) {
      assert.equal(selector, ".ant-modal:visible");
      return taskSheet;
    },
  };

  assert.equal(await openVisibleBatchPersonnelTaskSheet(page), taskSheet);
  assert.equal(sendClicks, 1);
});

test("发送前会阻止考务需求未完整的人员任务", async () => {
  await assert.rejects(
    waitForVisiblePersonnelConfiguration({
      evaluate: async () => ({ lines: [
        "人员落实日期：", "2026-08-18 ~ 2026-08-19",
        "人员落实平台：", "悦站",
        "监考类型：", "分散监考",
        "人员名单提交日期：", "2026-08-19",
      ] }),
    }, { maxChecks: 1, requireRequirements: true }),
    (error) => error.code === "PERSONNEL_OPERATION_CONFLICT"
      && error.message.includes("正式考试-监考人员安排"),
  );
});

test("任务单不再用监考人员安排的纯文本判断任务类型", () => {
  const snapshot = operationPersonnelTaskSheetFromVisibleRaw({
    keyValueRows: [
      ["监考类型", "分散监考"],
      ["正式考试-监考人员安排", "ATA监考-分散，已安排人员周玉衡zhouyuheng@ata.net.cn"],
    ],
    scheduleHeaders: [
      "日程代码", "日程", "时长(分钟)", "考试名称", "考生提前登录(分钟)",
    ],
    scheduleRows: [[
      "1", "2026-08-20 19:00~21:00", "120", "蜀能矿产2026年三季度社会招聘考试", "30",
    ]],
    sendRecordRows: [["发送时间", "变更内容"]],
  });

  assert.equal(snapshot.taskSheet.type, "分散在线监考");
  assert.equal(
    snapshot.requirements.find((item) => item.name === "正式考试-监考人员安排")?.value,
    "ATA监考-分散，已安排人员周玉衡zhouyuheng@ata.net.cn",
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

test("同月人员日期范围直接连续选择开始日和结束日", async () => {
  const events = [];
  let calendarOpen = true;
  const emptyControl = {
    count: async () => 0,
    first() { return this; },
  };
  const calendars = {
    count: async () => calendarOpen ? 1 : 0,
    last() { return this; },
    waitFor: async () => {},
  };
  const dateCell = (label, closesCalendar = false) => ({
    count: async () => 1,
    click: async (options) => {
      assert.deepEqual(options, { force: true, timeout: 10_000 });
      events.push(label);
      if (closesCalendar) calendarOpen = false;
    },
  });
  const page = {
    locator(selector) {
      if (selector === ".ant-calendar-picker-container:visible") return calendars;
      if ([
        ".ant-calendar-decade-panel:visible",
        ".ant-calendar-year-panel:visible",
        ".ant-calendar-month-panel:visible",
      ].includes(selector)) return emptyControl;
      if (selector.includes('[title="2026年8月18日"]')) return dateCell("date:2026-08-18");
      if (selector.includes('[title="2026年8月19日"]')) {
        return dateCell("date:2026-08-19", true);
      }
      throw new Error(`unexpected page selector: ${selector}`);
    },
  };
  const dialog = {
    locator: (selector) => {
      if (selector === 'input[placeholder="开始日期"]:visible') {
        return {
          count: async () => 1,
          click: async () => events.push("input:开始日期"),
        };
      }
      throw new Error(`结束日期输入框不应在选择开始日后被再次点击: ${selector}`);
    },
  };

  await selectVisiblePersonnelDateRange(
    page,
    dialog,
    "2026-08-18",
    "2026-08-19",
  );

  assert.deepEqual(events, [
    "input:开始日期",
    "date:2026-08-18",
    "date:2026-08-19",
  ]);
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

test("已发布批次人员配置未完成时预览仍返回待写入配置", async () => {
  let openedTaskSheet = 0;
  let openedSchedulePage = 0;
  const batch = { code: "EZT261095", batchName: "蜀道装备第8次校招_2026年8月", published: true };
  const incomplete = new Error("运控人员任务状态冲突：人员配置保存后页面未完整恢复：监考类型");
  incomplete.code = "PERSONNEL_OPERATION_CONFLICT";
  incomplete.reasonCode = "PERSONNEL_CONFIGURATION_INCOMPLETE";
  incomplete.missingFields = ["监考类型"];
  const visibleSnapshot = {
    __currentBatchRaw: {},
    __scheduleRows: [],
    batch,
    schedules: [],
    personnel: {},
    dates: {},
    requirements: [],
    taskSheet: {},
    sendRecords: [],
    directoryGroups: [],
    evidence: {
      batch: { present: true, missing: [] },
      schedules: { present: true, missing: [] },
      personnel: { present: false, missing: ["监考类型"] },
      dates: { present: false, missing: ["人员落实结束日期"] },
      requirements: { present: false, missing: ["考务需求表"] },
      taskSheet: { present: false, missing: ["任务单内容"] },
      sendRecords: { present: false, missing: ["发送记录表"] },
      directoryGroups: { present: false, missing: ["人员目录"] },
    },
  };
  const snapshot = await inspectOperationPersonnelTask(
    { evaluate: async () => structuredClone(visibleSnapshot) },
    { environment: "test", batch, batchCode: batch.code, allowUnpublishedPreview: true },
    {
      readBatchPages: async () => ({
        headers: ["批次代码"],
        pages: [[{ cells: [batch.code] }]],
      }),
      openBatchRow: async () => {},
      openPersonnelTaskSheet: async () => {
        openedTaskSheet += 1;
        throw incomplete;
      },
      openEztestSchedulePage: async () => { openedSchedulePage += 1; },
    },
  );

  assert.equal(openedTaskSheet, 1);
  assert.equal(openedSchedulePage, 1);
  assert.equal(snapshot.batch.code, batch.code);
  assert.equal(snapshot.batch.published, true);
  assert.deepEqual(snapshot.schedules, []);
  assert.equal(snapshot.personnel.serviceType, "");
  assert.equal(snapshot.dates.end, "");
  assert.deepEqual(snapshot.requirements, []);
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
    }, {
      name: "结算组",
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
    cc: [
      { id: "group:考站管理&质量控制部", name: "考站管理&质量控制部", kind: "group" },
      { id: "group:结算组", name: "结算组", kind: "group" },
    ],
  });
  assert.equal(submitted, true);
});
