import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOperationContentSyncResult,
  buildOperationContentDraft,
  normalizeOperationContentSnapshot,
} from "./operation_content.mjs";

function taskFixture() {
  return {
    sessions: [{ sessionType: "formal", candidateCount: 10 }],
    config: {
      operationBatchCode: "EZT261036",
      operationBatch: {
        code: "EZT261036",
        batchName: "蜀道轨道交通心理测评_2026年8月",
        detailUrl: "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=abc123",
      },
      tenantId: "108049",
      businessRequirement: {
        batch_name: "蜀道轨道交通心理测评_2026年8月",
        question_types: "客观题",
        content_source: "ATA现有内容",
        closed_item_writing_required: "不需要",
        manual_marking_required: "不需要",
        estimated_subject_count: "10",
        opa_rows: [
          { "时长（分钟）": "30" },
          { "时长（分钟）": "30" },
        ],
      },
      examRequirements: [{
        fields: {
          "考试名称": "蜀道轨道交通集团2026年第一批公开招聘笔试心理测评",
          "考试日期时间": "2026/8/8 10:00:00-2026/8/8 17:00:00",
          "科目信息": "OPA测评",
        },
        config: {
          tenantId: "108049",
          courses: [{ name: "OPA测评", code: "20260808-01-01" }],
        },
      }],
    },
  };
}

test("operation content draft matches the content task and uses OPA duration", () => {
  const draft = buildOperationContentDraft(taskFixture());
  assert.deepEqual(draft.warnings, []);
  assert.deepEqual(draft.batch, {
    code: "EZT261036",
    name: "蜀道轨道交通心理测评_2026年8月",
    detailUrl: "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=abc123",
  });
  assert.deepEqual(draft.configuration, {
    background: "ATA通用模板",
    loginMode: "准考证号",
    itemTypes: ["客观题"],
    contentSources: ["ATA现有内容"],
    closePaper: "否",
    reviewPaper: "否",
    singleMaxSubjects: "10",
    paperLanguages: ["简体中文"],
    osLanguages: ["简体中文"],
    closureStart: "2026-08-08 10:00",
    closureEnd: "2026-08-08 17:00",
  });
  assert.deepEqual(draft.subjects, [{
    name: "OPA测评",
    durationMinutes: "30",
    remark: "租户 ID：108049；科目编号：OPA测评（20260808-01-01）",
  }]);
});

test("operation content draft blocks incomplete batch identity and email time", () => {
  const task = taskFixture();
  delete task.config.operationBatch.detailUrl;
  delete task.config.examRequirements[0].fields["考试日期时间"];
  const draft = buildOperationContentDraft(task);
  assert.deepEqual(draft.warnings.map((item) => item.field), [
    "batch.detailUrl",
    "configuration.closureStart",
    "configuration.closureEnd",
  ]);
});

test("operation content result must match the exact verified readback", () => {
  const draft = buildOperationContentDraft(taskFixture());
  const snapshot = normalizeOperationContentSnapshot(draft);
  assert.deepEqual(assertOperationContentSyncResult(draft, {
    status: "success",
    verified: true,
    snapshot,
  }), snapshot);

  const changed = structuredClone(snapshot);
  changed.batch.name = "错误批次";
  assert.throws(() => assertOperationContentSyncResult(draft, {
    status: "success",
    verified: true,
    snapshot: changed,
  }), (error) => error.code === "OPERATION_CONTENT_SYNC_MISMATCH");
});
