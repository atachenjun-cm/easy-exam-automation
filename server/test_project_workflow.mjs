import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFanweiProjectConfig,
  buildOperationArchiveDraft,
  buildPersonnelTaskDraft,
  buildProjectWorkflow,
  normalizeFanweiBusinessRequirement,
  removeProjectExamRequirement,
} from "./project_workflow.mjs";
import { contentRequirementEmailFingerprint } from "./content_requirement_email.mjs";
import { operationArchiveFingerprint } from "./operation_archive.mjs";
import {
  buildOperationPersonnelTaskDraft,
  operationPersonnelTaskFingerprint,
} from "./operation_personnel_task.mjs";
import { operationPersonnelScheduleGate } from "./operation_personnel_schedule_gate.mjs";
import { buildDesiredOperationBatchSnapshot } from "./operation_batch_update.mjs";

const fanwei = {
  requestid: "1505614",
  fields: {
    "申请人": "张老师",
    "申请人部门": "企业业务部",
    "运控流水号": "R0042182",
    "项目名称": "四川校招项目",
    "项目编码": "F0020795",
    "批次名称": "四川校招项目_2026年7月",
    "业务方向": "企业",
    "系统类型": "易考",
    "预估科次": "320",
    "结算依据": "按参考科次结算",
    "是否需要ATA安排人工监考": "需要安排分散人工监考",
    "是否需要ATA安排集中监考场地": "不需要",
    "内容人员": "卢宁",
    "其他说明": "需要在线巡考",
  },
  serviceConfirmation: { fields: { "单位名称": "四川省公路设计院", "预计人次": "300", "在线巡考": "需要（3个）" } },
  examSceneRows: [{ "考试日期": "2026-07-20", "场次安排说明": "09:30-11:30" }],
  opaRows: [],
  flowOpinionRows: [{ "处理人": "杨铭", "部门": "内容开发部", "接收人": "卢宁" }],
};

const model = { requirementFields: { "考试名称": "2026 校园招聘笔试", "考试日期时间": "2026/7/20 09:30-2026/7/20 11:30", "科目信息": "综合能力" } };

test("normalizes Fanwei into the business requirement used by operation tasks", () => {
  const result = normalizeFanweiBusinessRequirement(fanwei, model);
  assert.equal(result.operation_serial_number, "R0042182");
  assert.equal(result.project_code, "F0020795");
  assert.equal(result.batch_name, "四川校招项目_2026年7月");
  assert.equal(result.customer_name, "四川省公路设计院");
  assert.equal(result.ata_invigilator_arrangement, "需要安排分散人工监考");
  assert.equal(result.content_personnel, "卢宁");
  assert.equal(result.online_inspection, "需要（3个）");
  assert.deepEqual(result.flow_opinion_rows, fanwei.flowOpinionRows);
  assert.deepEqual(result.exam_schedule, [{ exam_date: "2026-07-20", exam_time: "09:30-11:30", note: "" }]);
});

test("builds versioned Fanwei and EasyExam snapshots for a project card", () => {
  const result = buildFanweiProjectConfig({
    fanwei,
    model,
    parsed: { config: { examName: "2026 校园招聘笔试", customerName: "四川省公路设计院" }, previewRows: [{ item: "考试名称" }] },
    filename: "泛微_R0042182_需求单.xlsx",
    uploadId: "upload-1",
    now: "2026-07-18T02:00:00.000Z",
  });
  assert.equal(result.projectCard.sourceKey, "R0042182");
  assert.equal(result.fanweiSource.raw.requestid, "1505614");
  assert.equal(result.examRequirement.fields["考试名称"], "2026 校园招聘笔试");
  assert.equal(result.examRequirement.uploadId, "upload-1");
  assert.equal(result.examRequirements.length, 1);
  assert.equal(result.examRequirements[0], result.examRequirement);
  assert.equal(result.businessRequirement.project_code, "F0020795");
});

test("stores every copied EasyExam requirement while keeping the first as the legacy snapshot", () => {
  const result = buildFanweiProjectConfig({
    fanwei,
    model,
    filename: "泛微_R0042182_需求单.xlsx",
    uploadId: "upload-1",
    requirements: [
      { fields: { "考试名称": "第一场", "考试日期时间": "2026/7/20 09:30-2026/7/20 11:30" }, config: { examName: "第一场" } },
      { fields: { "考试名称": "第二场", "考试日期时间": "2026/7/21 09:30-2026/7/21 11:30" }, config: { examName: "第二场" } },
    ],
    now: "2026-07-19T02:00:00.000Z",
  });
  assert.equal(result.examRequirements.length, 2);
  assert.equal(result.examRequirements[0].fields["考试名称"], "第一场");
  assert.equal(result.examRequirements[1].fields["考试名称"], "第二场");
  assert.equal(result.examRequirements[1].filename, "泛微_R0042182_需求单_需求单2.xlsx");
  assert.equal(result.examRequirement, result.examRequirements[0]);
});

test("appends later requirements to the same Fanwei project without replacing existing snapshots", () => {
  const existing = buildFanweiProjectConfig({
    fanwei,
    model,
    filename: "泛微_R0042182_需求单.xlsx",
    uploadId: "upload-1",
    requirements: [
      {
        fields: { "考试名称": "原正式考试", "考试日期时间": "2026/7/20 09:30-2026/7/20 11:30" },
        config: { examName: "原正式考试", apiKeyProfileId: "profile-original" },
      },
    ],
    now: "2026-07-19T02:00:00.000Z",
  });
  const originalRequirement = existing.examRequirements[0];

  const appended = buildFanweiProjectConfig({
    fanwei,
    model: { requirementFields: { "考试名称": "新增测试", "考试日期时间": "2026/7/24 09:30-2026/7/24 11:30" } },
    filename: "泛微_R0042182_需求单.xlsx",
    uploadId: "upload-2",
    requirements: [
      {
        fields: { "考试名称": "新增测试", "考试日期时间": "2026/7/24 09:30-2026/7/24 11:30" },
        config: { examName: "新增测试", apiKeyProfileId: "profile-original" },
        filename: "泛微_R0042182_需求单.xlsx",
        uploadId: "upload-2",
      },
    ],
    previousConfig: { ...existing, apiKeyProfileId: "profile-original", courses: [{ course_code: "K001" }] },
    now: "2026-07-23T01:10:49.000Z",
  });

  assert.equal(appended.examRequirements.length, 2);
  assert.deepEqual(appended.examRequirements[0], originalRequirement);
  assert.equal(appended.examRequirements[1].id, "requirement-2");
  assert.equal(appended.examRequirements[1].fields["考试名称"], "新增测试");
  assert.equal(appended.examRequirements[1].filename, "泛微_R0042182_需求单_需求单2.xlsx");
  assert.equal(appended.examRequirements[1].uploadId, "upload-2");
  assert.equal(appended.examRequirement, appended.examRequirements[0]);
  assert.equal(appended.apiKeyProfileId, "profile-original");
  assert.deepEqual(appended.courses, [{ course_code: "K001" }]);
});

test("removes one EasyExam requirement and reindexes the remaining snapshots", () => {
  const first = { id: "requirement-1", order: 1, fields: { "考试名称": "第一场" } };
  const second = { id: "requirement-2", order: 2, fields: { "考试名称": "第二场" } };
  const third = { id: "requirement-3", order: 3, fields: { "考试名称": "第三场" } };
  const result = removeProjectExamRequirement({
    examRequirements: [first, second, third],
    examRequirement: first,
  }, 1);

  assert.deepEqual(result.examRequirements.map((item) => item.id), ["requirement-1", "requirement-3"]);
  assert.deepEqual(result.examRequirements.map((item) => item.order), [1, 2]);
  assert.equal(result.examRequirement.id, "requirement-1");
});

test("clears the legacy EasyExam snapshot when the last requirement is removed", () => {
  const only = { id: "requirement-1", order: 1, fields: { "考试名称": "唯一场" } };
  const result = removeProjectExamRequirement({ examRequirements: [only], examRequirement: only }, 0);

  assert.deepEqual(result.examRequirements, []);
  assert.equal(result.examRequirement, null);
  assert.throws(() => removeProjectExamRequirement({ examRequirements: [only], examRequirement: only }, 2), /需求单序号不存在/);
});

test("personnel and archive drafts keep their source boundaries", () => {
  const config = buildFanweiProjectConfig({ fanwei, model, parsed: { config: {} } });
  const task = {
    taskId: "task-1",
    projectName: "2026 校园招聘笔试",
    config: { ...config, operationBatchCode: "EZT260003", contentRequirementEmail: { lastSentAt: "2026-07-18" } },
    sessions: [{ sessionType: "formal", session_id: "1001", candidateCount: 300, roomCount: 10 }],
  };
  const personnel = buildPersonnelTaskDraft(task);
  const archive = buildOperationArchiveDraft(task);
  assert.equal(personnel.fields.personnelService.source, "fanwei");
  assert.equal(personnel.fields.batchCode.source, "operation_result");
  assert.equal(archive.fields.registrationSubjects.value, "300");
  assert.equal(archive.fields.registrationSubjects.source, "actual_result");
});

test("workflow opens personnel and content after batch and archive after actual execution", () => {
  const config = buildFanweiProjectConfig({
    fanwei,
    model: {
      requirementFields: {
        ...model.requirementFields,
        "考试日期时间": "2026/8/20 09:30-2026/8/20 11:30",
      },
    },
    parsed: { config: {
      startTimeDisplay: "2026-07-20 09:30",
      endTimeDisplay: "2026-07-20 11:30",
    } },
  });
  const waiting = buildProjectWorkflow({ config, sessions: [] }, { warnings: [] });
  assert.equal(waiting.steps.batch.status, "ready");
  assert.equal(waiting.steps.personnel.status, "waiting_batch");
  assert.equal(waiting.steps.content.status, "waiting_batch");
  assert.equal(waiting.steps.archive.status, "waiting_execution");
  const trialOnly = buildProjectWorkflow({
    config: { ...config, operationBatchCode: "EZT260003" },
    sessions: [{ sessionType: "trial", session_id: "1000" }],
  }, { warnings: [] });
  assert.equal(trialOnly.steps.archive.status, "waiting_execution");

  const ready = buildProjectWorkflow({ config: {
    ...config,
    operationBatchCode: "EZT260003",
    operationBatch: {
      code: "EZT260003",
      draft: {
        fields: {
          projectDepartment: { value: "项目实施一部" },
          projectManager: { value: "项目经理" },
        },
      },
    },
    operationPersonnelTask: {
      confirmedEdits: {
        dates: { start: "2026-08-17", end: "2026-08-17", nameListDue: "2026-08-17" },
        personnel: { monitorCount: 6 },
      },
    },
  }, sessions: [{
    sessionType: "formal",
    session_id: "1001",
    start: "2026-08-20 09:30",
    end: "2026-08-20 11:30",
    candidateCount: 300,
    roomCount: 10,
  }] }, { warnings: [] });
  assert.equal(ready.steps.personnel.status, "ready");
  assert.equal(ready.steps.content.status, "ready");
  assert.equal(ready.steps.archive.status, "ready");
});

function taskWithAppliedOperationFields() {
  const config = buildFanweiProjectConfig({
    fanwei,
    model: {
      requirementFields: {
        ...model.requirementFields,
        "考试日期时间": "2026/8/20 09:30-2026/8/20 11:30",
      },
    },
    parsed: {
      config: {
        startTimeDisplay: "2026-08-20 09:30",
        endTimeDisplay: "2026-08-20 11:30",
      },
    },
  });
  const task = {
    taskId: "task-change-notice",
    projectName: "2026 校园招聘笔试",
    config: {
      ...config,
      operationBatchCode: "EZT261018",
      projectSourceChangeHistory: [
        { source: "fanwei", changes: [{ field: "项目名称", before: "旧值", after: "四川校招项目" }] },
        { source: "examRequirement", changes: [{ field: "考试名称", before: "旧值", after: "2026 校园招聘笔试" }] },
      ],
      operationBatch: {
        code: "EZT261018",
        batchName: "四川校招项目_2026年7月",
        draft: {
          fields: {
            batchName: { value: "四川校招项目_2026年7月" },
            projectManager: { value: "项目经理" },
            projectDepartment: { value: "项目实施一部" },
          },
        },
      },
    },
    sessions: [{
      sessionType: "formal",
      session_id: "1001",
      requirementIndex: 0,
      start: "2026-08-20 09:30",
      end: "2026-08-20 11:30",
      candidateCount: 300,
      roomCount: 10,
    }],
  };
  task.config.operationBatch.managedSnapshot = buildDesiredOperationBatchSnapshot(task).snapshot;
  const personnelDraft = buildOperationPersonnelTaskDraft(task);
  const personnelGate = operationPersonnelScheduleGate(task);
  if (personnelGate.ok) personnelDraft.managedSchedules = structuredClone(personnelGate.schedules);
  task.config.operationPersonnelTask = {
    lastSuccessfulFingerprint: operationPersonnelTaskFingerprint(personnelDraft),
    scheduleCodeMap: personnelDraft.scheduleCodeMap,
  };
  task.config.contentRequirementEmail = {
    lastSourceFingerprint: contentRequirementEmailFingerprint({ task }),
  };
  const archiveDraft = buildOperationArchiveDraft(task);
  task.config.operationArchive = {
    status: "submitted",
    lastSubmittedFingerprint: operationArchiveFingerprint(archiveDraft),
  };
  return task;
}

test("historical source edits do not warn when current operation fields are already aligned", () => {
  const task = taskWithAppliedOperationFields();
  const workflow = buildProjectWorkflow(task, { warnings: [] });

  assert.deepEqual(
    Object.fromEntries(Object.entries(workflow.steps).map(([key, step]) => [key, step.changeNotice])),
    { batch: "", personnel: "", content: "", archive: "" },
  );

  task.config.examRequirements[0].version += 1;
  task.config.examRequirements[0].fields["欢迎语"] = "与运控无关的更新";
  const unrelated = buildProjectWorkflow(task, { warnings: [] });
  assert.deepEqual(
    Object.fromEntries(Object.entries(unrelated.steps).map(([key, step]) => [key, step.changeNotice])),
    { batch: "", personnel: "", content: "", archive: "" },
  );
});

test("a batch without a managed baseline does not claim that source fields changed", () => {
  const task = taskWithAppliedOperationFields();
  delete task.config.operationBatch.managedSnapshot;
  const workflow = buildProjectWorkflow(task, { warnings: [] });

  assert.equal(workflow.steps.batch.baselineRequired, true);
  assert.ok(workflow.steps.batch.managedChanges.length > 0);
  assert.equal(workflow.steps.batch.changeNotice, "");
});

test("current source edits warn only on operation steps whose fields differ", () => {
  const task = taskWithAppliedOperationFields();
  task.config.examRequirements[0].fields["考试名称"] = "更新后的考试名称";
  const requirementChanged = buildProjectWorkflow(task, { warnings: [] });
  assert.equal(requirementChanged.steps.batch.changeNotice, "有变更请确认");
  assert.equal(requirementChanged.steps.personnel.changeNotice, "有变更请确认");
  assert.equal(requirementChanged.steps.content.changeNotice, "有变更请确认");
  assert.equal(requirementChanged.steps.archive.changeNotice, "");

  const fanweiTask = taskWithAppliedOperationFields();
  fanweiTask.config.businessRequirement.project_name = "更新后的泛微项目名称";
  fanweiTask.config.fanweiSource.raw.fields["项目名称"] = "更新后的泛微项目名称";
  const fanweiChanged = buildProjectWorkflow(fanweiTask, { warnings: [] });
  assert.equal(fanweiChanged.steps.batch.changeNotice, "");
  assert.equal(fanweiChanged.steps.personnel.changeNotice, "有变更请确认");
  assert.equal(fanweiChanged.steps.content.changeNotice, "有变更请确认");
  assert.equal(fanweiChanged.steps.archive.changeNotice, "有变更请确认");
});
