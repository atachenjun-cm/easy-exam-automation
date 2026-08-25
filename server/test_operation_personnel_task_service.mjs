import assert from "node:assert/strict";
import test from "node:test";

import { buildOperationPersonnelTaskDraft } from "./operation_personnel_task.mjs";
import {
  createOperationPersonnelTaskService,
  operationPersonnelExpiredDateLabels,
  operationPersonnelFailedResumeConflictBaseline,
  operationPersonnelFailedResumeObservedBaseline,
  operationPersonnelInformationMissing,
  operationPersonnelManagedSchedules,
  operationPersonnelRequirementsFromPersonnel,
} from "./operation_personnel_task_service.mjs";

function baseTask() {
  return {
    taskId: "personnel-edit-task",
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

test("人员任务详情只允许编辑日期，分班同步字段不会被手工覆盖", async () => {
  let task = baseTask();
  let inspectionCalls = 0;
  const service = createOperationPersonnelTaskService({
    readTask: async () => structuredClone(task),
    updateTaskConfig: async (_taskId, config) => {
      task = { ...task, config: { ...task.config, ...structuredClone(config) } };
      return structuredClone(task);
    },
    coordinator: {
      acquireTask: () => () => {},
      acquireProfile: () => () => {},
    },
    runInspection: async () => {
      inspectionCalls += 1;
      throw new Error("编辑保存不应检查运控平台");
    },
    environment: "",
    now: () => Date.parse("2026-08-05T02:00:00.000Z"),
  });

  const result = await service.edit("personnel-edit-task", { role: "admin" }, {
    dates: {
      start: "2026-08-06",
      end: "2026-08-19",
      nameListDue: "2026-08-19",
    },
    personnel: {
      monitorRatio: "1:40",
      monitorCount: "4",
    },
  });

  assert.equal(inspectionCalls, 0);
  assert.equal(result.state.draft.dates.start, "2026-08-06");
  assert.equal(result.state.draft.dates.end, "2026-08-19");
  assert.equal(result.state.draft.personnel.monitorRatio, "1:27");
  assert.equal(result.state.draft.personnel.monitorCount, 3);
  assert.equal(result.state.warnings, undefined);
  assert.equal(result.state.activePreview, null);
  assert.equal(task.config.operationPersonnelTask.confirmedEdits.dates.start, "2026-08-06");
  assert.deepEqual(task.config.operationPersonnelTask.confirmedEdits.personnel, {});
  assert.equal(result.state.status, "unsupported");
});

test("人员任务发送草稿忽略旧的手工人员参数并同步正式考试分班结果", () => {
  const task = baseTask();
  task.config.operationPersonnelTask = {
    confirmedEdits: {
      dates: { start: "2026-08-06", end: "2026-08-19", nameListDue: "2026-08-19" },
      personnel: { monitorRatio: "1:40", monitorCount: 3 },
    },
  };

  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });

  assert.deepEqual(draft.dates, {
    start: "2026-08-06",
    end: "2026-08-19",
    nameListDue: "2026-08-19",
  });
  assert.equal(draft.personnel.monitorRatio, "1:27");
  assert.equal(draft.personnel.monitorCount, 3);
});

test("人员任务详情保存四项可编辑考务需求并用于后续写入", async () => {
  let task = baseTask();
  const service = createOperationPersonnelTaskService({
    readTask: async () => structuredClone(task),
    updateTaskConfig: async (_taskId, config) => {
      task = { ...task, config: { ...task.config, ...structuredClone(config) } };
      return structuredClone(task);
    },
    coordinator: {
      acquireTask: () => () => {},
      acquireProfile: () => () => {},
    },
    environment: "",
    now: () => Date.parse("2026-08-05T02:00:00.000Z"),
  });
  const requirements = {
    "正式考试-最早登录系统时间": "考生可于考试开始前45分钟登录",
    "正式考试-监考人员安排": "ATA监考-分散（重点场）",
    "正式考试-监考人员数量": "5",
    "正式考试-监考人员比例": "1:20",
  };

  const result = await service.edit("personnel-edit-task", { role: "admin" }, { requirements });

  assert.equal(result.state.draft.personnel.earliestLoginMinutes, 45);
  assert.equal(result.state.draft.personnel.monitorCount, 5);
  assert.equal(result.state.draft.personnel.monitorRatio, "1:20");
  assert.equal(result.state.draft.personnel.candidateBasis, 20);
  assert.deepEqual(result.state.draft.requirementOverrides, requirements);
  assert.deepEqual(result.state.draft.targetRequirements.slice(0, 4), Object.entries(requirements).map(([name, value]) => ({ name, value })));
  assert.deepEqual(task.config.operationPersonnelTask.confirmedEdits.requirements, requirements);

  const rebuilt = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });
  assert.equal(rebuilt.personnel.earliestLoginMinutes, 45);
  assert.equal(rebuilt.personnel.monitorCount, 5);
  assert.equal(rebuilt.personnel.monitorRatio, "1:20");
  assert.deepEqual(rebuilt.requirementOverrides, requirements);
});

test("人员任务详情拒绝保存格式无效的考务需求", async () => {
  const task = baseTask();
  const service = createOperationPersonnelTaskService({
    readTask: async () => structuredClone(task),
    updateTaskConfig: async () => {
      throw new Error("无效草稿不应持久化");
    },
    coordinator: {
      acquireTask: () => () => {},
      acquireProfile: () => () => {},
    },
    environment: "test",
    now: () => Date.parse("2026-08-05T02:00:00.000Z"),
  });

  await assert.rejects(
    () => service.edit("personnel-edit-task", { role: "admin" }, {
      requirements: {
        "正式考试-最早登录系统时间": "未填写时间",
        "正式考试-监考人员安排": "",
        "正式考试-监考人员数量": "0",
        "正式考试-监考人员比例": "无效比例",
      },
    }),
    (error) => error?.code === "PERSONNEL_DRAFT_INCOMPLETE",
  );
});

test("人员任务生成完整的五项正式考试考务需求", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });
  const requirements = operationPersonnelRequirementsFromPersonnel(draft.personnel);

  assert.deepEqual(requirements, [
    { name: "正式考试-最早登录系统时间", value: "考生可于考试开始前30分钟登录" },
    { name: "正式考试-监考人员安排", value: "ATA监考-分散" },
    { name: "正式考试-监考人员数量", value: "3" },
    { name: "正式考试-监考人员比例", value: "1:27" },
    { name: "正式考试-监考登录监控", value: "否" },
  ]);
  assert.deepEqual(operationPersonnelInformationMissing(draft), []);
});

test("人员任务缺少结算组时阻止发送", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });
  draft.recipients.ccGroups = ["考站管理&质量控制部"];

  assert.ok(operationPersonnelInformationMissing(draft).includes("固定抄送部门"));
});

test("人员任务刷新时沿用已完成考务需求检查点的真实回读", async () => {
  const task = baseTask();
  const readback = [
    { name: "正式考试-最早登录系统时间", value: "考生可于考试开始前30分钟登录" },
    { name: "正式考试-监考人员安排", value: "ATA监考-分散" },
    { name: "正式考试-监考人员数量", value: "3" },
    { name: "正式考试-监考人员比例", value: "1:27" },
    { name: "正式考试-监考登录监控", value: "否" },
  ];
  task.config.operationPersonnelTask = {
    status: "failed_resumable",
    checkpoints: {
      sync_exam_service_requirements: {
        status: "completed",
        readback,
      },
    },
  };
  const service = createOperationPersonnelTaskService({
    readTask: async () => structuredClone(task),
    coordinator: { acquireTask: () => () => {} },
    environment: "test",
    now: () => Date.parse("2026-08-05T02:00:00.000Z"),
  });

  const result = await service.get(task.taskId, { role: "admin" });

  assert.deepEqual(result.state.draft.operationRequirements, readback);
});

test("人员任务严格阻止未填写完整的人员信息", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });
  draft.personnel.loginMonitoring = "";
  draft.personnel.candidateBasis = "";

  assert.deepEqual(operationPersonnelInformationMissing(draft), [
    "监考登录监控",
    "监考人数计算基数",
    "正式考试-监考登录监控",
  ]);
});

test("人员任务结束日期或名单提交日期过期时阻止发送", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });
  draft.dates = {
    start: "2026-08-05",
    end: "2026-08-07",
    nameListDue: "2026-08-06",
  };

  assert.deepEqual(
    operationPersonnelExpiredDateLabels(draft, Date.parse("2026-08-08T02:00:00.000Z")),
    ["人员落实结束日期", "人员名单提交日期"],
  );
  assert.deepEqual(
    operationPersonnelInformationMissing(draft, { now: Date.parse("2026-08-08T02:00:00.000Z") })
      .filter((label) => label.endsWith("已过期")),
    ["人员落实结束日期已过期", "人员名单提交日期已过期"],
  );
});

test("批次缺少受管快照时从当前人员草稿建立严格日程基线", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask(), {
    environment: "test",
    now: "2026-08-05T02:00:00.000Z",
  });

  assert.deepEqual(operationPersonnelManagedSchedules(draft, []), [{
    requirementIndex: 0,
    name: "示例考试",
    start: "2026/08/20 09:00",
    end: "2026/08/20 11:00",
  }]);
});

test("首次预览可用草稿日程核对已有运控日程", async () => {
  let task = baseTask();
  const service = createOperationPersonnelTaskService({
    readTask: async () => structuredClone(task),
    updateTaskConfig: async (_taskId, config) => {
      task = { ...task, config: { ...task.config, ...structuredClone(config) } };
      return structuredClone(task);
    },
    coordinator: {
      acquireTask: () => () => {},
      acquireProfile: () => () => {},
    },
    runInspection: async () => ({
      batch: {
        code: "EZT260003",
        projectCode: "P260001",
        projectName: "示例考试",
        batchName: "示例考试_2026年8月",
        projectDepartment: "项目实施一部",
        projectManager: "陈军",
        published: true,
      },
      schedules: [{
        scheduleCode: 1,
        subjectName: "示例考试",
        start: "2026-08-20 09:00",
        end: "2026-08-20 11:00",
      }],
      personnel: {},
      dates: {},
      requirements: [],
      taskSheet: {},
      sendRecords: [],
      directoryMatch: { to: [], cc: [] },
    }),
    environment: "test",
    now: () => Date.parse("2026-08-05T02:00:00.000Z"),
    makeToken: () => "preview-token",
  });

  const result = await service.preview(task.taskId, { role: "admin" });

  assert.deepEqual(result.state.draft.managedSchedules, [{
    requirementIndex: 0,
    name: "示例考试",
    start: "2026/08/20 09:00",
    end: "2026/08/20 11:00",
  }]);
  assert.deepEqual(result.state.draft.displaySchedules, [{
    scheduleCode: 1,
    name: "示例考试",
    start: "2026/08/20 09:00",
    end: "2026/08/20 11:00",
  }]);
  assert.equal(result.state.draft.targetRequirements.length, 5);
  assert.ok(result.state.draft.targetRequirements.every((item) => item.value));
});

test("发送排队复核在无受管快照时继续使用草稿日程", async () => {
  let task = baseTask();
  let deferredJob = null;
  let attemptInstruction = null;
  const snapshot = {
    batch: {
      code: "EZT260003",
      projectCode: "P260001",
      projectName: "示例考试",
      batchName: "示例考试_2026年8月",
      projectDepartment: "项目实施一部",
      projectManager: "陈军",
      published: true,
    },
    schedules: [{
      scheduleCode: 1,
      subjectName: "示例考试",
      start: "2026-08-20 09:00",
      end: "2026-08-20 11:00",
    }],
    personnel: {},
    dates: {},
    requirements: [],
    taskSheet: {},
    sendRecords: [],
    directoryMatch: { to: [], cc: [] },
  };
  const service = createOperationPersonnelTaskService({
    readTask: async () => structuredClone(task),
    updateTaskConfig: async (_taskId, config) => {
      task = { ...task, config: { ...task.config, ...structuredClone(config) } };
      return structuredClone(task);
    },
    coordinator: {
      acquireTask: () => () => {},
      acquireProfile: () => () => {},
    },
    runInspection: async () => structuredClone(snapshot),
    runAttempt: async (instruction) => {
      attemptInstruction = structuredClone(instruction);
      return {
        status: "sent",
        completedAt: "2026-08-05T02:01:00.000Z",
        sendRecord: { type: "首次发送", sentAt: "2026-08-05T02:01:00.000Z" },
        operationSnapshot: structuredClone(snapshot),
      };
    },
    environment: "test",
    now: () => Date.parse("2026-08-05T02:00:00.000Z"),
    makeToken: () => "queued-preview-token",
    makeAttemptId: () => "queued-attempt",
    defer: (job) => { deferredJob = job; },
  });

  const preview = await service.preview(task.taskId, { role: "admin" });
  const queued = await service.send(task.taskId, { role: "admin" }, {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
  });
  assert.equal(queued.attemptId, "queued-attempt");
  assert.equal(typeof deferredJob, "function");
  await deferredJob();

  assert.deepEqual(attemptInstruction.managedSchedules, [{
    requirementIndex: 0,
    name: "示例考试",
    start: "2026/08/20 09:00",
    end: "2026/08/20 11:00",
  }]);
  assert.equal(task.config.operationPersonnelTask.activeAttempt.status, "sent");
});

test("失败流程沿用上次真实基线，允许确认已知日期变更", async () => {
  let task = baseTask();
  const operationSnapshot = {
    batch: {
      code: "EZT260003",
      projectCode: "P260001",
      projectName: "示例考试",
      batchName: "示例考试_2026年8月",
      projectDepartment: "项目实施一部",
      projectManager: "陈军",
      published: true,
    },
    schedules: [{
      scheduleCode: 1,
      subjectName: "示例考试",
      start: "2026-08-20 09:00",
      end: "2026-08-20 11:00",
    }],
    personnel: {},
    dates: {
      start: "2026-08-05",
      end: "2026-08-05",
      nameListDue: "2026-08-05",
    },
    requirements: [],
    taskSheet: {},
    sendRecords: [],
    directoryMatch: { to: [], cc: [] },
  };
  task.config.operationPersonnelTask = {
    status: "failed_resumable",
    activeAttempt: {
      attemptId: "failed-attempt",
      status: "failed_resumable",
      baseline: {
        ...structuredClone(operationSnapshot),
        schedules: [],
        dates: {
          start: "2026-08-06",
          end: "2026-08-06",
          nameListDue: "2026-08-06",
        },
      },
    },
    checkpoints: {
      inspect_batch: {
        status: "completed",
        readback: structuredClone(operationSnapshot),
      },
    },
  };
  const service = createOperationPersonnelTaskService({
    readTask: async () => structuredClone(task),
    updateTaskConfig: async (_taskId, config) => {
      task = { ...task, config: { ...task.config, ...structuredClone(config) } };
      return structuredClone(task);
    },
    coordinator: {
      acquireTask: () => () => {},
      acquireProfile: () => () => {},
    },
    runInspection: async () => structuredClone(operationSnapshot),
    environment: "test",
    now: () => Date.parse("2026-08-05T02:00:00.000Z"),
    makeToken: () => "resume-preview-token",
  });

  const result = await service.preview(task.taskId, { role: "admin" }, {
    dates: {
      start: "2026-08-06",
      end: "2026-08-06",
      nameListDue: "2026-08-06",
    },
  });

  assert.equal(result.previewToken, "resume-preview-token");
  assert.deepEqual(result.state.draft.dates, {
    start: "2026-08-06",
    end: "2026-08-06",
    nameListDue: "2026-08-06",
  });
});

test("失败恢复只沿用可编辑人员基线，不回退当前批次日程", () => {
  const current = {
    batch: { code: "EZT260003" },
    schedules: [{ scheduleCode: 1 }],
    personnel: { monitorRatio: "1:40" },
    dates: { start: "2026-08-06" },
    requirements: [{ name: "监考比例", value: "1:40" }],
  };
  const previous = {
    schedules: [],
    personnel: { monitorRatio: "1:34" },
    dates: { start: "2026-08-05" },
    requirements: [],
  };

  assert.deepEqual(operationPersonnelFailedResumeConflictBaseline(current, previous), {
    batch: { code: "EZT260003" },
    schedules: [{ scheduleCode: 1 }],
    personnel: { monitorRatio: "1:34" },
    dates: { start: "2026-08-05" },
    requirements: [],
  });
});

test("失败恢复优先使用上次检查的真实回读而不是计划目标", () => {
  const observed = {
    dates: { start: "2026-08-05", end: "2026-08-05", nameListDue: "2026-08-05" },
    requirements: [],
  };
  const state = {
    activeAttempt: {
      baseline: {
        dates: { start: "2026-08-06", end: "2026-08-06", nameListDue: "2026-08-06" },
        requirements: [{ name: "监考比例", value: "1:34" }],
      },
    },
    checkpoints: {
      inspect_batch: { status: "completed", readback: observed },
    },
  };

  assert.deepEqual(operationPersonnelFailedResumeObservedBaseline(state), observed);
});

test("失败尝试的终态优先于残留的处理中状态", async () => {
  const task = baseTask();
  task.config.operationPersonnelTask = {
    status: "applying_config",
    activeAttempt: {
      attemptId: "failed-attempt",
      status: "failed_resumable",
      error: { code: "PERSONNEL_ATTEMPT_FAILED", message: "日期面板未恢复" },
    },
  };
  const service = createOperationPersonnelTaskService({
    readTask: async () => structuredClone(task),
    coordinator: { acquireTask: () => () => {} },
    environment: "test",
  });

  const result = await service.get(task.taskId, { role: "admin" });

  assert.equal(result.state.status, "failed_resumable");
  assert.equal(result.state.activeAttempt.status, "failed_resumable");
});
