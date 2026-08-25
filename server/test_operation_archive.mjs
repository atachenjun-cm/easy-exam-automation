import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOperationArchiveDraft,
  editOperationArchiveDraft,
  OPERATION_ARCHIVE_FIELD_ORDER,
  operationArchiveActualDataWindow,
  operationArchiveActualsFromScoreRows,
  operationArchiveAssessmentFromPapers,
  refreshOperationArchiveEvidenceDraft,
} from "./operation_archive.mjs";

function taskFixture(assessmentMode = "none") {
  return {
    taskId: "task-archive",
    projectName: "蜀道投资集团有限责任公司招聘笔试",
    sessions: [
      {
        sessionType: "formal",
        session_id: "433782",
        name: "蜀道集团正式考试",
        start: "2026-08-06T09:00:00",
        end: "2026-08-06T10:30:00",
        candidateCount: 34,
        requirementIndex: 0,
      },
      {
        sessionType: "trial",
        session_id: "433781",
        name: "蜀道集团试考",
        start: "2026-08-05T09:00:00",
        end: "2026-08-05T10:00:00",
        candidateCount: 7,
        requirementIndex: 0,
      },
    ],
    config: {
      operationBatchCode: "EZT261018",
      businessRequirement: {
        project_code: "F0020795",
        project_name: "蜀道投资集团有限责任公司招聘笔试",
        system_type: "易考",
        exam_service_scope: "全流程",
        registration_method: "客户提供报名数据",
        registration_website_required: "不需要",
        billing_basis: "按参考科次结算",
        estimated_subject_count: "34",
        other_notes: "不应自动带入归档备注",
      },
      examRequirements: [{
        fields: {
          "考试名称": "蜀道集团正式考试",
          "考试日期时间": "2026-08-06 09:00 - 2026-08-06 10:30",
        },
        config: { courses: [{ code: "C01", name: "综合能力" }] },
      }],
      paperFormBinds: [{
        status: "success",
        result: {
          bindResult: {
            results: [{
              form_codes: ["PAPER-01"],
              unit_info: { assessment_mode: assessmentMode },
            }],
          },
        },
      }],
      operationBatch: {
        code: "EZT261018",
        batchName: "蜀道轨道交通集团招聘笔试_2026年8月",
        draft: {
          fields: {
            batchName: { value: "蜀道轨道交通集团招聘笔试_2026年8月" },
            businessDepartment: { value: "地方业务中心" },
            businessOwner: { value: "赖昌明" },
            projectManager: { value: "陈军" },
            projectDepartment: { value: "项目实施一部" },
            servicePersonnel: { value: "在线监考" },
            stationUsage: { value: "无需考站" },
            estimatedCityCount: { value: "0" },
            systemType: { value: "易考" },
            arrangementService: { value: "其它" },
            onlineSettlementArrangementSource: { value: "其它" },
            billingBasis: { value: "按参考科次结算" },
          },
        },
      },
    },
  };
}

test("archive fields follow the operation-console order and use formal execution statistics", () => {
  const draft = buildOperationArchiveDraft(taskFixture(), {
    now: "2026-08-07T00:00:00.000Z",
    actuals: { candidateSubjects: "34", completedSubjects: "31", assessment: { complete: true, personalityAssessment: "否", personalityAssessmentScope: "" } },
  });

  assert.deepEqual(Object.keys(draft.fields), [...OPERATION_ARCHIVE_FIELD_ORDER]);
  assert.deepEqual(
    Object.entries(draft.fields).filter(([, field]) => !field.hidden).map(([key]) => key).slice(0, 3),
    ["personalityAssessment", "personalityAssessmentScope", "examType"],
  );
  for (const key of ["projectCode", "projectName", "businessDepartment", "businessOwner", "batchCode", "batchName", "projectManager", "projectDepartment", "examVenueDisplayName"]) {
    assert.equal(draft.fields[key].hidden, true);
  }
  assert.equal(draft.fields.examDateRange.value, "2026-08-06 ~ 2026-08-06");
  assert.equal(draft.fields.examStartDate.hidden, true);
  assert.equal(draft.fields.registrationSubjects.value, "34");
  assert.equal(draft.fields.openSubjects.value, "34");
  assert.equal(draft.fields.attendedSubjects.value, "31");
  for (const key of [
    "ataRegistrationAdjustmentReason",
    "registrationAdjustmentReason",
    "openSubjectsAdjustmentReason",
    "attendedSubjectsAdjustmentReason",
  ]) {
    assert.equal(draft.fields[key].value, "");
  }
  assert.equal(draft.fields.averageAttendanceRate.value, "91.18");
  assert.equal(draft.fields.implementationUsers.value, "34");
  assert.equal(draft.fields.implementationSites.value, "0");
  assert.equal(draft.fields.implementationRooms.value, "0");
  assert.equal(draft.fields.implementationSessions.value, "1");
  assert.equal(draft.fields.implementationPapers.value, "1");
  assert.equal(draft.fields.implementationSubjects.value, "1");
  assert.equal(draft.fields.scheduleCount.value, "1");
  assert.equal(draft.fields.operationOrganizationService.value, "是");
  assert.equal(draft.fields.remark.hidden, true);
  assert.equal(draft.fields.remark.editable, false);
  assert.equal(draft.fields.remark.value, "");
  assert.equal(draft.attachmentsRequired, false);
  assert.equal(draft.warnings.length, 0);
});

test("archive OPA choice is derived only from final bound paper structures", () => {
  assert.deepEqual(operationArchiveAssessmentFromPapers(taskFixture("none")), {
    complete: true,
    personalityAssessment: "否",
    personalityAssessmentScope: "",
  });
  assert.deepEqual(operationArchiveAssessmentFromPapers(taskFixture("only_opa")), {
    complete: true,
    personalityAssessment: "是",
    personalityAssessmentScope: "仅考OPA",
  });
  assert.deepEqual(operationArchiveAssessmentFromPapers(taskFixture("includes_opa")), {
    complete: true,
    personalityAssessment: "是",
    personalityAssessmentScope: "考试内容包含OPA",
  });
});

test("archive assessment fields can be corrected before filling operation control", () => {
  const task = taskFixture("only_opa");
  const result = editOperationArchiveDraft(task, {
    fields: {
      personalityAssessment: "否",
      personalityAssessmentScope: "仅有OPA",
    },
  }, {
    actuals: { candidateSubjects: "34", completedSubjects: "31" },
  });
  assert.equal(result.edits.personalityAssessment, "否");
  assert.equal(result.edits.personalityAssessmentScope, "");
  assert.equal(result.draft.fields.personalityAssessment.value, "否");
  assert.equal(result.draft.fields.personalityAssessmentScope.value, "");
});

test("manual assessment values remain valid when the paper structure is unavailable", () => {
  const task = taskFixture("only_opa");
  delete task.config.paperFormBinds;
  task.config.operationArchive = {
    edits: {
      personalityAssessment: "是",
      personalityAssessmentScope: "仅考OPA",
    },
  };

  const draft = buildOperationArchiveDraft(task, {
    actuals: { candidateSubjects: "10", completedSubjects: "9" },
  });

  assert.equal(draft.fields.personalityAssessment.value, "是");
  assert.equal(draft.fields.personalityAssessmentScope.value, "仅考OPA");
  assert.equal(draft.warnings.some((item) => item.code === "ARCHIVE_PAPER_STRUCTURE_REQUIRED"), false);
});

test("evidence refresh reuses submitted fields but recalculates attendance", () => {
  const task = taskFixture("only_opa");
  delete task.config.paperFormBinds;
  task.config.operationArchive = {
    edits: {
      attendedSubjects: "8",
      averageAttendanceRate: "80",
    },
    lastSubmission: {
      formSnapshot: {
        personalityAssessment: "是",
        personalityAssessmentScope: "仅考OPA",
        examType: "机考",
        registrationSubjects: "10",
        openSubjects: "10",
        attendedSubjects: "8",
        averageAttendanceRate: "80",
        implementationPapers: "1",
      },
    },
  };

  const refreshed = refreshOperationArchiveEvidenceDraft(task, {
    actuals: { candidateSubjects: "10", completedSubjects: "9" },
  });

  assert.equal(refreshed.draft.fields.personalityAssessment.value, "是");
  assert.equal(refreshed.draft.fields.personalityAssessmentScope.value, "仅考OPA");
  assert.equal(refreshed.draft.fields.registrationSubjects.value, "10");
  assert.equal(refreshed.draft.fields.openSubjects.value, "10");
  assert.equal(refreshed.draft.fields.attendedSubjects.value, "9");
  assert.equal(refreshed.draft.fields.averageAttendanceRate.value, "90");
  assert.deepEqual(refreshed.draft.warnings, []);
});

test("archive normalizes the legacy only-OPA label to the current operation-console option", () => {
  const task = taskFixture("only_opa");
  task.config.operationArchive = {
    edits: {
      personalityAssessment: "是",
      personalityAssessmentScope: "仅有OPA",
    },
  };

  const draft = buildOperationArchiveDraft(task, {
    actuals: { candidateSubjects: "34", completedSubjects: "31" },
  });
  const edited = editOperationArchiveDraft(task, {
    fields: { personalityAssessmentScope: "仅有OPA" },
  }, {
    actuals: { candidateSubjects: "34", completedSubjects: "31" },
  });

  assert.equal(draft.fields.personalityAssessmentScope.value, "仅考OPA");
  assert.equal(edited.edits.personalityAssessmentScope, "仅考OPA");
});

test("operation organization service defaults to yes even when personnel service is not needed", () => {
  const task = taskFixture();
  task.config.operationBatch.draft.fields.servicePersonnel.value = "不需要";
  const draft = buildOperationArchiveDraft(task, {
    actuals: { candidateSubjects: "34", completedSubjects: "31" },
  });
  assert.equal(draft.fields.operationOrganizationService.value, "是");
});

test("manually entered archive adjustment reasons remain available", () => {
  const result = editOperationArchiveDraft(taskFixture(), {
    fields: {
      attendedSubjectsAdjustmentReason: "线下情况说明",
    },
  }, {
    actuals: { candidateSubjects: "34", completedSubjects: "31" },
  });
  assert.equal(result.edits.attendedSubjectsAdjustmentReason, "线下情况说明");
  assert.equal(result.draft.fields.attendedSubjectsAdjustmentReason.value, "线下情况说明");
});

test("zero completed formal candidates remains a real actual value", () => {
  const task = taskFixture();
  const draft = buildOperationArchiveDraft(task, {
    actuals: { completedSubjects: "0", assessment: operationArchiveAssessmentFromPapers(task) },
  });
  assert.equal(draft.fields.attendedSubjects.value, "0");
  assert.equal(draft.fields.averageAttendanceRate.value, "0");
  assert.equal(draft.fields.attendedSubjectsAdjustmentReason.value, "");
});

test("actual exam data is fetched only from the day after the last formal exam", () => {
  const task = taskFixture();
  assert.deepEqual(operationArchiveActualDataWindow(task, { today: "2026-08-06" }), {
    ready: false,
    lastFormalDate: "2026-08-06",
    availableDate: "2026-08-07",
  });
  assert.deepEqual(operationArchiveActualDataWindow(task, { today: "2026-08-07" }), {
    ready: true,
    lastFormalDate: "2026-08-06",
    availableDate: "2026-08-07",
  });
  const draft = buildOperationArchiveDraft(task, {
    actuals: {
      completedSubjects: "",
      assessment: operationArchiveAssessmentFromPapers(task),
      pending: true,
      availableDate: "2026-08-07",
    },
  });
  assert.ok(draft.warnings.some((warning) => warning.code === "ARCHIVE_ACTUAL_RESULT_NOT_READY"));
});

test("next-day API candidate totals override cached formal session counts", () => {
  const task = taskFixture();
  const draft = buildOperationArchiveDraft(task, {
    actuals: {
      candidateSubjects: "35",
      completedSubjects: "31",
      assessment: operationArchiveAssessmentFromPapers(task),
    },
  });
  assert.equal(draft.fields.registrationSubjects.value, "35");
  assert.equal(draft.fields.openSubjects.value, "35");
  assert.equal(draft.fields.implementationUsers.value, "35");
  assert.equal(draft.fields.averageAttendanceRate.value, "88.57");
});

test("completed score processing rows provide archive attendance totals", () => {
  const actuals = operationArchiveActualsFromScoreRows([
    { exam_status: "已完成", score: "80" },
    { exam_status: "参考", score: "" },
    { exam_status: "未开考", score: "" },
    { exam_status: "其它", score: 0 },
  ]);
  assert.deepEqual(actuals, { candidateSubjects: "4", completedSubjects: "3" });
});
