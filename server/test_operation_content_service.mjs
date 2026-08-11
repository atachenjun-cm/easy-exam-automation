import assert from "node:assert/strict";
import test from "node:test";

import { buildOperationContentDraft, normalizeOperationContentSnapshot } from "./operation_content.mjs";
import { createOperationContentSyncService } from "./operation_content_service.mjs";

function fixture() {
  return {
    taskId: "task-content",
    ownerEmail: "owner@example.com",
    sessions: [{ sessionType: "formal", candidateCount: 10 }],
    config: {
      operationBatchCode: "EZT261036",
      operationBatch: {
        code: "EZT261036",
        batchName: "目标批次",
        detailUrl: "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=target",
      },
      tenantId: "108049",
      businessRequirement: {
        question_types: "客观题",
        content_source: "ATA现有内容",
        closed_item_writing_required: "不需要",
        manual_marking_required: "不需要",
        opa_rows: [{ "时长（分钟）": "30" }],
      },
      examRequirements: [{
        fields: {
          "考试日期时间": "2026/8/8 10:00:00-2026/8/8 17:00:00",
          "科目信息": "OPA测评",
        },
        config: { courses: [{ name: "OPA测评", code: "OPA-01" }] },
      }],
    },
  };
}

function serviceHarness(initial = fixture()) {
  let stored = structuredClone(initial);
  let enabledChecks = 0;
  const service = createOperationContentSyncService({
    readTask: async (taskId) => taskId === stored.taskId ? structuredClone(stored) : null,
    updateTaskConfig: async (taskId, patch) => {
      assert.equal(taskId, stored.taskId);
      stored.config = { ...stored.config, ...structuredClone(patch) };
      return structuredClone(stored);
    },
    assertAutomationEnabled: () => { enabledChecks += 1; },
    now: () => Date.parse("2026-08-09T07:00:00Z"),
    makePreparationId: () => "prep-content",
  });
  return { service, stored: () => stored, enabledChecks: () => enabledChecks };
}

test("content sync prepares an exact local-helper payload source", async () => {
  const harness = serviceHarness();
  const prepared = await harness.service.prepare("task-content", { email: "owner@example.com" });
  assert.equal(prepared.preparationId, "prep-content");
  assert.equal(prepared.preparation.draft.batch.code, "EZT261036");
  assert.equal(prepared.preparation.draft.batch.name, "目标批次");
  assert.equal(harness.enabledChecks(), 1);
  assert.equal(harness.stored().config.operationContentSync.status, "awaiting_local_helper");
});

test("content sync persists only a verified exact readback", async () => {
  const harness = serviceHarness();
  const prepared = await harness.service.prepare("task-content", { email: "owner@example.com" });
  const result = await harness.service.complete("task-content", {
    preparationId: prepared.preparationId,
    helperResult: {
      operationContentSync: {
        status: "success",
        verified: true,
        snapshot: normalizeOperationContentSnapshot(buildOperationContentDraft(fixture())),
        checkpoints: ["opened_exact_batch", "content_readback_verified"],
      },
    },
  }, { email: "owner@example.com" });
  assert.equal(result.state.status, "success");
  assert.equal(result.state.lastSnapshot.batch.code, "EZT261036");
  assert.deepEqual(result.state.checkpoints, ["opened_exact_batch", "content_readback_verified"]);
});

test("content sync rejects a mismatched batch readback", async () => {
  const harness = serviceHarness();
  const prepared = await harness.service.prepare("task-content", { email: "owner@example.com" });
  const snapshot = normalizeOperationContentSnapshot(buildOperationContentDraft(fixture()));
  snapshot.batch.name = "错误批次";
  await assert.rejects(() => harness.service.complete("task-content", {
    preparationId: prepared.preparationId,
    helperResult: { operationContentSync: { status: "success", verified: true, snapshot } },
  }, { email: "owner@example.com" }), (error) => error.code === "OPERATION_CONTENT_SYNC_MISMATCH");
  assert.equal(harness.stored().config.operationContentSync.status, "failed");
});
