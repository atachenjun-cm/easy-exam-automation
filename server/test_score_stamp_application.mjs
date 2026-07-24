import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScoreStampBatchSearchTerms,
  buildScoreStampApplicationFillScript,
  buildScoreStampApplicationPayload,
  buildScoreStampApplicationSaveScript,
  buildScoreStampAttachmentPrepareScript,
  scoreStampWorkflowUrl,
} from "./score_stamp_application.mjs";

test("score stamp application defaults to the OA score seal workflow and encrypted archive password", () => {
  const payload = buildScoreStampApplicationPayload({
    task: {
      taskId: "task-1",
      projectName: "宏达集团考试",
      config: {
        operationBatchCode: "EZT260003",
        businessRequirement: {
          applicant: "陈军",
          applicant_department: "项目实施一部",
        },
      },
    },
    scoreResult: {
      pdfFileName: "宏达集团考试-成绩反馈单.pdf",
      stampArchiveFileName: "宏达集团考试-盖章附件.zip",
      stampArchivePath: "/tmp/archive.zip",
      stampArchivePassword: "1234",
    },
    now: new Date("2026-07-22T01:00:00Z"),
    env: {},
  });

  assert.match(scoreStampWorkflowUrl({}), /^https:\/\/oa\.ata\.net\.cn\/spa\/workflow\/static4form\/index\.html\?_rdm=\d+#\/main\/workflow\/req\?iscreate=1&workflowid=105021/);
  assert.equal(payload.batchKeyword, "宏达集团考试");
  assert.equal(payload.batchSearchKeyword, "宏达集团考试");
  assert.deepEqual(payload.sealPositions, ["落款章"]);
  assert.equal(payload.reason, "成绩盖章");
  assert.equal(payload.archivePassword, "1234");
  assert.equal(payload.archiveFileName, "宏达集团考试-盖章附件.zip");
});

test("score stamp batch search terms include organization and exam-name abbreviation candidates", () => {
  const terms = buildScoreStampBatchSearchTerms("四川公路桥梁建设集团有限公司公路隧道分公司TBM管理岗笔试");

  assert.ok(terms.includes("四川公路桥梁建设集团TBM管理岗笔试"));
});

test("score stamp payload uses manual batch name as the direct OA batch search term", () => {
  const payload = buildScoreStampApplicationPayload({
    task: {
      taskId: "task-1",
      projectName: "自动推断考试名",
      config: {
        scoreStampBatchName: "人工回填批次名称_2026年7月",
        operationBatchCode: "EZT260003",
      },
    },
    scoreResult: {
      pdfFileName: "成绩反馈单.pdf",
      stampArchiveFileName: "成绩盖章附件.zip",
    },
    env: {},
  });

  assert.equal(payload.batchKeyword, "人工回填批次名称_2026年7月");
  assert.equal(payload.batchSearchKeyword, "人工回填批次名称_2026年7月");
  assert.deepEqual(payload.batchSearchQueries, ["人工回填批次名称_2026年7月"]);
  assert.deepEqual(payload.batchMatchKeywords, ["人工回填批次名称_2026年7月"]);
});

test("score stamp fill script asks the operator to verify the uploaded encrypted archive", () => {
  const script = buildScoreStampApplicationFillScript({
    archiveFileName: "score.zip",
    archivePassword: "1234",
  });

  assert.match(script, /上传加密压缩包附件/);
  assert.match(script, /selectBatchByExamName/);
  assert.match(script, /解压密码/);
  assert.match(script, /自动填写成绩盖章申请/);
  assert.match(script, /controlValue/);
  assert.match(script, /ownerDocument\?\.defaultView/);
  assert.match(script, /makeDomEvent/);
  assert.match(script, /createEvent/);
  assert.match(script, /HTMLElement\?\.prototype\?\.click/);
  assert.match(script, /findBatchSearchButton/);
  assert.match(script, /button\.ant-btn-ghost\.ant-btn-icon-only/);
  assert.match(script, /optionInputsReady/);
  assert.match(script, /interactiveControlsReady/);
  assert.doesNotMatch(script, /instanceof HTMLTextAreaElement/);
  assert.doesNotMatch(script, /new Event\(eventName/);
  assert.match(script, /^\(async \(\) =>/);
});

test("score stamp attachment script tags an OA file input before DevTools upload", () => {
  const script = buildScoreStampAttachmentPrepareScript();

  assert.match(script, /input\[type="file"\]/);
  assert.match(script, /data-codex-score-stamp-upload/);
  assert.match(script, /附件\|上传\|选择文件/);
  assert.match(script, /^new Promise/);
});

test("score stamp save script clicks save without submitting the OA request", () => {
  const script = buildScoreStampApplicationSaveScript();

  assert.match(script, /compactValues\.some\(\(value\) => value === "保存"\)/);
  assert.match(script, /querySelectorAll\("iframe"\)/);
  assert.match(script, /savedDraftDetected/);
  assert.match(script, /OA 已进入待办列表，按已保存处理/);
  assert.match(script, /requestid=/);
  assert.match(script, /流程:处理/);
  assert.match(script, /makeDomEvent/);
  assert.match(script, /HTMLElement\?\.prototype\?\.click/);
  assert.match(script, /saved: true/);
  assert.match(script, /点击保存/);
  assert.match(script, /value === "提交"/);
  assert.match(script, /^\(async \(\) =>/);
});
