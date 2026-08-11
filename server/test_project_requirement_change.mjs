import assert from "node:assert/strict";
import test from "node:test";

import {
  requirementFieldsFromStructuredRequirement,
  syncAcceptedRequirementToTask,
} from "./project_requirement_change.mjs";

function taskWithSessions(sessions = []) {
  return {
    taskId: "project-1",
    projectName: "招聘项目",
    sessions,
    config: {
      requirementRequestId: "req-1",
      customerName: "客户甲",
      examRequirements: [{
        id: "requirement-1",
        version: 3,
        fields: {
          "考试名称": "原考试",
          "考试日期时间": "2026/7/30 09:00-2026/7/30 11:00",
          "欢迎语": "保留欢迎语",
          "科目信息": "行测",
        },
        config: {
          examName: "原考试",
          startTimeDisplay: "2026/07/30 09:00",
          subjects: ["行测"],
          courses: [{ name: "行测", code: "20260730-01-01", form_codes: ["20260730-01-01"], paper_name: "旧试卷" }],
          apiKeyProfileId: "profile-1",
        },
      }],
    },
  };
}

const acceptedRequirement = {
  requestId: "req-1",
  latest: {
    version: 4,
    requirement: {
      exam_name: "新考试",
      formal_exam_time_range: "2026/7/30 09:00-2026/7/30 11:00",
      early_login_minutes: 30,
      video_record_required: true,
      exam_client_type: "web",
      subjects: ["行测"],
      paper_names: ["新试卷"],
    },
  },
};

test("structured requirement maps back to EasyExam fields and preserves unrelated fields", () => {
  const fields = requirementFieldsFromStructuredRequirement(acceptedRequirement.latest.requirement, { "欢迎语": "保留欢迎语" });
  assert.equal(fields["考试名称"], "新考试");
  assert.equal(fields["提前登录时间"], "30分钟");
  assert.equal(fields["视频录制"], "开启录制");
  assert.equal(fields["考试类型"], "网页考试");
  assert.equal(fields["科目信息"], "行测");
  assert.equal(fields["欢迎语"], "保留欢迎语");
});

test("accepted change updates the EasyExam requirement when no exam session exists", () => {
  const task = taskWithSessions();
  const result = syncAcceptedRequirementToTask({
    task,
    requirement: acceptedRequirement,
    changeId: "change-1",
    now: "2026-07-27T12:00:00.000Z",
  });
  assert.equal(result.configPatch.examRequirement.fields["考试名称"], "新考试");
  assert.equal(result.configPatch.examName, "新考试");
  assert.equal(result.configPatch.examRequirement.version, 4);
  assert.equal(result.configPatch.examRequirement.config.apiKeyProfileId, "profile-1");
  assert.equal(result.configPatch.examRequirement.config.courses[0].paper_name, "新试卷");
  assert.equal(result.sessionImpact.hasCreatedSessions, false);
  assert.equal(result.sessionImpact.status, "requirement_updated");
  assert.deepEqual(task.sessions, []);
});

test("accepted change marks existing sessions for later sync without modifying them", () => {
  const sessions = [{ session_id: "432577", name: "正式考试", status: "success" }];
  const task = taskWithSessions(sessions);
  const before = structuredClone(task.sessions);
  const result = syncAcceptedRequirementToTask({ task, requirement: acceptedRequirement, changeId: "change-2" });
  assert.equal(result.sessionImpact.hasCreatedSessions, true);
  assert.equal(result.sessionImpact.status, "pending_session_sync");
  assert.deepEqual(result.sessionImpact.affectedSessionIds, ["432577"]);
  assert.deepEqual(task.sessions, before);
  assert.deepEqual(result.configPatch.wechatRequirementSync.affectedSessionIds, ["432577"]);
});

test("time-only requirement changes preserve the real created course code", () => {
  const task = taskWithSessions([{ session_id: "432577", name: "正式考试", status: "success" }]);
  task.config.courses = [{ name: "行测", code: "20260730-02-01", form_codes: ["FORM-A"] }];
  const requirement = structuredClone(acceptedRequirement);
  requirement.latest.requirement.formal_exam_time_range = "2026/7/31 09:00-2026/7/31 11:00";

  const result = syncAcceptedRequirementToTask({ task, requirement, changeId: "change-time" });

  assert.deepEqual(result.configPatch.examRequirement.config.courses, [
    { name: "行测", code: "20260730-02-01", form_codes: ["FORM-A"], paper_name: "新试卷" },
  ]);
});
