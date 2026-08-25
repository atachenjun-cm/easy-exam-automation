import assert from "node:assert/strict";
import test from "node:test";

import {
  clearOperationContentMultiSelect,
  operationContentSectionsChanged,
  operationContentSnapshotFromApi,
  operationContentSubjectFillSteps,
} from "./operation_content_runner.mjs";

function desiredSnapshot() {
  return {
    batch: {
      code: "EZT261036",
      name: "蜀道轨道交通心理测评_2026年8月",
      detailUrl: "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=target",
    },
    configuration: {
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
    },
    subjects: [{
      name: "OPA测评",
      durationMinutes: "30",
      remark: "租户 ID：108049；科目编号：OPA测评（20260808-01-01）",
    }],
  };
}

test("operation content API readback maps exact batch, configuration, and subjects", () => {
  const snapshot = operationContentSnapshotFromApi({
    detailUrl: desiredSnapshot().batch.detailUrl,
    identity: { code: "EZT261036", batchName: "蜀道轨道交通心理测评_2026年8月" },
    itemContent: {
      code: 10,
      data: {
        batch_code: "EZT261036",
        batch_name: "蜀道轨道交通心理测评_2026年8月",
        background: "ATA通用模板",
        login_mode: "准考证号",
        item_type: ["客观题"],
        content_source: ["ATA现有内容"],
        close_paper: "否",
        review_paper: "否",
        single_max_subjects: 10,
        paper_language: ["简体中文"],
        os_language: ["简体中文"],
        closure_begin_datetime: "2026-08-08 10:00",
        closure_end_datetime: "2026-08-08 17:00",
      },
    },
    subjectContent: {
      code: 10,
      data: {
        _items: [{
          subject_name: "OPA测评",
          last: 30,
          memo: "租户 ID：108049；科目编号：OPA测评（20260808-01-01）",
        }],
      },
    },
  });
  assert.deepEqual(snapshot, desiredSnapshot());
  assert.deepEqual(operationContentSectionsChanged(snapshot, desiredSnapshot()), {
    configuration: false,
    subjects: false,
  });
});

test("operation content changes are isolated by section", () => {
  const desired = desiredSnapshot();
  const current = structuredClone(desired);
  current.configuration.closePaper = "是";
  assert.deepEqual(operationContentSectionsChanged(current, desired), {
    configuration: true,
    subjects: false,
  });
  current.configuration.closePaper = "否";
  current.subjects[0].durationMinutes = "420";
  assert.deepEqual(operationContentSectionsChanged(current, desired), {
    configuration: false,
    subjects: true,
  });
});

test("operation content fills the existing blank subject row before adding another", () => {
  const subjects = [
    { name: "建设项目管理岗", durationMinutes: "120", remark: "" },
    { name: "电力交易员岗", durationMinutes: "120", remark: "" },
  ];

  assert.deepEqual(operationContentSubjectFillSteps(1, subjects), [
    { action: "fill", index: 0, subject: subjects[0] },
    { action: "add", index: 1 },
    { action: "fill", index: 1, subject: subjects[1] },
  ]);
});

test("operation content clears rerendering multi-select choices without locator clicks", async () => {
  let choiceCount = 3;
  let evaluateCalls = 0;
  const root = {
    locator(selector) {
      assert.equal(selector, ".ant-select-selection__choice__remove");
      return { count: async () => choiceCount };
    },
    async evaluate(_callback, options) {
      assert.equal(options.previousCount, choiceCount);
      evaluateCalls += 1;
      choiceCount -= 1;
    },
  };

  await clearOperationContentMultiSelect(root, "item_type");

  assert.equal(choiceCount, 0);
  assert.equal(evaluateCalls, 3);
});

test("operation content rejects a multi-select choice that does not disappear", async () => {
  const root = {
    locator: () => ({ count: async () => 1 }),
    evaluate: async () => {},
  };

  await assert.rejects(
    () => clearOperationContentMultiSelect(root, "item_type"),
    (error) => error?.code === "OPERATION_CONTENT_MULTI_SELECT_CLEAR_FAILED"
      && /item_type/.test(error.message),
  );
});
