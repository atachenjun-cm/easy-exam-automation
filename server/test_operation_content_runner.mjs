import assert from "node:assert/strict";
import test from "node:test";

import {
  operationContentSectionsChanged,
  operationContentSnapshotFromApi,
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
