import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOperationArchiveBatchIdentity,
  clearOperationArchiveAttachments,
  confirmArchiveSubmission,
  inspectOperationArchive,
  openExactBatch,
  openArchiveForm,
  openArchiveTab,
  operationArchiveConfirmationTextMatches,
  operationArchiveFormLabelMatches,
  operationArchiveDesiredSelectValue,
  operationArchiveInputMapping,
  operationArchiveSchedulePromptText,
  operationArchiveShouldFillInputValue,
  operationArchiveShouldFillValue,
  operationArchiveStatusFromText,
  replaceOperationArchiveAttachments,
  setOperationArchivePersonalityAssessment,
  submitOperationArchive,
  waitForOperationArchiveSelectOption,
} from "./operation_archive_runner.mjs";

test("archive runner matches form labels exactly", () => {
  assert.equal(operationArchiveFormLabelMatches("系统类型：", "系统类型"), true);
  assert.equal(operationArchiveFormLabelMatches("报名系统类型：", "系统类型"), false);
  assert.equal(operationArchiveFormLabelMatches(" 报名系统类型 : ", "报名系统类型"), true);
  assert.equal(operationArchiveFormLabelMatches("* 考试类型：", "考试类型"), true);
});

test("archive runner always selects computer-based exam type", () => {
  const draft = { fields: { examType: { value: "其它" }, systemType: { value: "易考" } } };
  assert.equal(operationArchiveDesiredSelectValue(draft, "examType"), "机考");
  assert.equal(operationArchiveDesiredSelectValue(draft, "systemType"), "易考");
});

test("archive runner keeps matching values and replaces missing or different values", () => {
  assert.equal(operationArchiveShouldFillValue("其它", "其它"), false);
  assert.equal(operationArchiveShouldFillValue("其它", "在线考务"), true);
  assert.equal(operationArchiveShouldFillValue("", "易考"), true);
  assert.equal(operationArchiveShouldFillValue("", ""), false);
});

test("archive runner refreshes an enabled personality switch so the scope field renders", async () => {
  let enabled = true;
  const clickStates = [];
  let waitedForLabel = "";
  const toggle = {
    async count() { return 1; },
    async innerText() { return enabled ? "是" : "否"; },
    async getAttribute(name) {
      assert.equal(name, "aria-checked");
      return enabled ? "true" : "false";
    },
    async click() {
      enabled = !enabled;
      clickStates.push(enabled ? "是" : "否");
    },
  };
  const modal = {
    locator(selector) {
      assert.equal(selector, "#is_opa");
      return toggle;
    },
  };
  const page = {
    async waitForFunction(callback, argument, options) {
      waitedForLabel = argument;
      assert.deepEqual(options, { timeout: 10000 });
      const previousDocument = globalThis.document;
      globalThis.document = {
        querySelectorAll(selector) {
          assert.equal(selector, ".ant-modal");
          return [{
            offsetWidth: 1,
            offsetHeight: 1,
            getClientRects() { return [{}]; },
            querySelectorAll(itemSelector) {
              assert.equal(itemSelector, ".ant-form-item");
              return [{
                innerText: "包含性格测评\n请选择",
                querySelectorAll(labelSelector) {
                  assert.equal(labelSelector, ".ant-form-item-label, label");
                  return [{ textContent: "包含性格测评：" }];
                },
              }];
            },
          }];
        },
      };
      try {
        assert.equal(callback(argument), true);
      } finally {
        globalThis.document = previousDocument;
      }
    },
  };

  assert.equal(await setOperationArchivePersonalityAssessment(page, modal, "是"), true);
  assert.deepEqual(clickStates, ["否", "是"]);
  assert.equal(waitedForLabel, "包含性格测评");
});

test("archive runner removes historical attachments before uploading the latest screenshots", async () => {
  let remaining = 2;
  let historicalAttachmentReappeared = false;
  const events = [];
  const removeAction = {
    async click() {
      remaining -= 1;
      events.push("remove");
    },
  };
  const archiveItem = {
    async isVisible() { return true; },
    async hover() { events.push("hover"); },
    locator(selector) {
      assert.match(selector, /anticon-delete/);
      return {
        async count() { return 1; },
        first() { return removeAction; },
      };
    },
  };
  const fileInput = {
    async count() { return 1; },
    async setInputFiles(paths) {
      assert.deepEqual(paths, ["/tmp/latest.jpg"]);
      remaining = paths.length;
      events.push("upload");
    },
  };
  const modal = {
    locator(selector) {
      if (selector === ".ant-upload-list-item") {
        return { async all() { return Array.from({ length: remaining }, () => archiveItem); } };
      }
      if (selector === ".ant-upload-list-item-uploading") {
        return { async all() { return []; } };
      }
      if (selector === 'input[type="file"]') return fileInput;
      throw new Error(`unexpected selector: ${selector}`);
    },
  };
  const page = {
    async waitForFunction(callback, argument, options) {
      assert.deepEqual(options, { timeout: 10000 });
      const previousDocument = globalThis.document;
      const uploadItem = () => ({
        offsetWidth: 1,
        offsetHeight: 1,
        getClientRects() { return [{}]; },
        classList: { contains() { return false; } },
      });
      globalThis.document = {
        querySelectorAll(selector) {
          assert.equal(selector, ".ant-modal");
          return [{
            offsetWidth: 1,
            offsetHeight: 1,
            getClientRects() { return [{}]; },
            querySelectorAll(itemSelector) {
              assert.equal(itemSelector, ".ant-upload-list-item");
              return Array.from({ length: remaining }, uploadItem);
            },
          }];
        },
      };
      try {
        assert.equal(callback(argument), true);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    async waitForTimeout(timeout) {
      assert.ok([250, 1500].includes(timeout));
      if (timeout === 1500 && remaining === 0 && !historicalAttachmentReappeared) {
        remaining = 1;
        historicalAttachmentReappeared = true;
        events.push("reappear");
      }
    },
  };

  assert.equal(await clearOperationArchiveAttachments(page, {
    locator(selector) {
      assert.equal(selector, ".ant-upload-list-item");
      return { async all() { return []; } };
    },
  }), 0);
  assert.deepEqual(await replaceOperationArchiveAttachments(page, modal, ["/tmp/latest.jpg"]), {
    removed: 3,
    uploaded: 1,
  });
  assert.deepEqual(events, ["hover", "remove", "hover", "remove", "reappear", "hover", "remove", "upload"]);
});

test("archive runner retries when a historical attachment returns during the latest upload", async () => {
  let remaining = 1;
  let uploadCount = 0;
  let returnedDuringUpload = false;
  const events = [];
  const removeAction = {
    async click() {
      remaining -= 1;
      events.push("remove");
    },
  };
  const archiveItem = {
    async isVisible() { return true; },
    async hover() {},
    locator() {
      return {
        async count() { return 1; },
        first() { return removeAction; },
      };
    },
  };
  const modal = {
    locator(selector) {
      if (selector === ".ant-upload-list-item") {
        return { async all() { return Array.from({ length: remaining }, () => archiveItem); } };
      }
      if (selector === ".ant-upload-list-item-uploading") {
        return { async all() { return []; } };
      }
      if (selector === 'input[type="file"]') {
        return {
          async count() { return 1; },
          async setInputFiles() {
            uploadCount += 1;
            remaining = 1;
            events.push(`upload-${uploadCount}`);
          },
        };
      }
      throw new Error(`unexpected selector: ${selector}`);
    },
  };
  const page = {
    async waitForFunction(callback, argument) {
      const previousDocument = globalThis.document;
      globalThis.document = {
        querySelectorAll() {
          return [{
            offsetWidth: 1,
            offsetHeight: 1,
            getClientRects() { return [{}]; },
            querySelectorAll() {
              return Array.from({ length: remaining }, () => ({
                offsetWidth: 1,
                offsetHeight: 1,
                getClientRects() { return [{}]; },
              }));
            },
          }];
        },
      };
      try {
        assert.equal(callback(argument), true);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    async waitForTimeout(timeout) {
      if (timeout === 250 && uploadCount === 1 && !returnedDuringUpload) {
        remaining = 2;
        returnedDuringUpload = true;
        events.push("late-return");
      }
    },
  };

  assert.deepEqual(await replaceOperationArchiveAttachments(page, modal, ["/tmp/latest.jpg"]), {
    removed: 3,
    uploaded: 1,
  });
  assert.deepEqual(events, ["remove", "upload-1", "late-return", "remove", "remove", "upload-2"]);
});

test("archive runner waits for the unique visible select option across portal dropdowns", async () => {
  const hiddenMatch = {
    async isVisible() { return false; },
    async innerText() { return "仅考OPA"; },
  };
  const visibleMatch = {
    async isVisible() { return true; },
    async innerText() { return "仅考 OPA"; },
  };
  const visibleOther = {
    async isVisible() { return true; },
    async innerText() { return "考试内容包含OPA"; },
  };
  let waitArgument = null;
  const page = {
    async waitForFunction(_callback, argument) {
      waitArgument = argument;
    },
    locator(selector) {
      assert.match(selector, /ant-select-dropdown-menu-item/);
      return { async all() { return [hiddenMatch, visibleMatch, visibleOther]; } };
    },
  };

  const option = await waitForOperationArchiveSelectOption(page, "包含性格测评", "仅考OPA");

  assert.strictEqual(option, visibleMatch);
  assert.equal(waitArgument.expectedText, "仅考OPA");
});

test("archive runner reuses the already-open exact batch without navigating again", async () => {
  const detailUrl = "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=expected-guid";
  let gotoCalls = 0;
  const textLeaf = (value) => ({ async innerText() { return value; } });
  const title = {
    async waitFor() {},
    async count() { return 1; },
    locator(selector) {
      if (selector === ":scope > span") return { first() { return textLeaf("EZT261029"); } };
      if (selector === ":scope > label") return { first() { return textLeaf("目标批次"); } };
      throw new Error(`unexpected title selector: ${selector}`);
    },
  };
  const page = {
    url() { return detailUrl; },
    async goto() { gotoCalls += 1; },
    async waitForFunction() {},
    locator(selector) {
      if (selector === ".header-title:visible") return title;
      if (selector === ".header-info:visible") {
        return {
          async waitFor() {},
          async count() { return 1; },
          locator() { return { async allInnerTexts() { return ["F0027433", "目标项目"]; } }; },
        };
      }
      if (selector === "body") return { async innerText() { return "已发布"; } };
      throw new Error(`unexpected selector: ${selector}`);
    },
  };

  const identity = await openExactBatch(page, {
    fields: {
      batchCode: { value: "EZT261029" },
      batchName: { value: "目标批次" },
    },
  }, "https://dashboard.ata.net.cn/batch/batchList", { batchDetailUrl: detailUrl });

  assert.equal(gotoCalls, 0);
  assert.equal(identity.code, "EZT261029");
  assert.equal(identity.batchName, "目标批次");
});

test("archive runner always clears a non-empty remark", () => {
  assert.equal(operationArchiveShouldFillInputValue("remark", "旧备注", ""), true);
  assert.equal(operationArchiveShouldFillInputValue("remark", "", ""), false);
  assert.equal(operationArchiveShouldFillInputValue("registrationSubjects", "34", "34"), false);
});

test("archive runner requires the loaded batch code and batch name to both match", () => {
  const draft = {
    fields: {
      batchCode: { value: "EZT261018" },
      batchName: { value: "expected name" },
      projectCode: { value: "F0020795" },
    },
  };
  assert.deepEqual(assertOperationArchiveBatchIdentity(draft, {
    code: "EZT261018",
    batchName: "expected name",
    projectCode: "F0020795",
  }), {
    code: "EZT261018",
    batchName: "expected name",
    projectCode: "F0020795",
  });
  assert.throws(
    () => assertOperationArchiveBatchIdentity(draft, { code: "YKT240042", batchName: "expected name" }),
    (error) => error.code === "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH" && /预期 EZT261018，实际 YKT240042/.test(error.message),
  );
  assert.throws(
    () => assertOperationArchiveBatchIdentity(draft, { code: "EZT261018", batchName: "错误批次" }),
    (error) => error.code === "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH" && /预期 expected name，实际 错误批次/.test(error.message),
  );
});

test("archive inspection and submission stop before opening the archive tab when the loaded batch is wrong", async () => {
  const expectedUrl = "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=expected-guid";
  let currentUrl = "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=stale-guid";
  let archiveTabRequested = false;
  const textLeaf = (value) => ({ async innerText() { return value; } });
  const title = {
    async waitFor() {},
    async count() { return 1; },
    locator(selector) {
      if (selector === ":scope > span") return { first() { return textLeaf("YKT240042"); } };
      if (selector === ":scope > label") return { first() { return textLeaf("错误批次"); } };
      throw new Error(`unexpected title selector: ${selector}`);
    },
  };
  const info = {
    async waitFor() {},
    async count() { return 1; },
    locator(selector) {
      if (selector === ".hover-link:visible") {
        return { async allInnerTexts() { return ["F0000000", "错误项目"]; } };
      }
      throw new Error(`unexpected info selector: ${selector}`);
    },
  };
  const page = {
    url() { return currentUrl; },
    async goto(url) { currentUrl = String(url); },
    async waitForFunction() {},
    locator(selector) {
      if (selector === ".header-title:visible") return title;
      if (selector === ".header-info:visible") return info;
      if (selector === "body") return { async innerText() { return "已发布"; } };
      if (selector === ".ant-tabs-tab") archiveTabRequested = true;
      throw new Error(`unexpected page selector: ${selector}`);
    },
  };
  const context = { pages() { return [page]; } };
  const draft = {
    fields: {
      batchCode: { value: "EZT261029" },
      batchName: { value: "湖北三鑫金铜性格测评_2026年8月" },
    },
  };

  for (const runArchive of [inspectOperationArchive, submitOperationArchive]) {
    await assert.rejects(
      runArchive(draft, {
        baseUrl: "https://dashboard.ata.net.cn",
        batchDetailUrl: expectedUrl,
        context,
        closeContext: false,
      }),
      (error) => error.code === "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH" && /YKT240042/.test(error.message),
    );
  }
  assert.equal(currentUrl, expectedUrl);
  assert.equal(archiveTabRequested, false);
});

test("archive runner maps every operation-console input id", () => {
  const values = {
    cityCount: "0",
    ataRegistrationSubjects: "0",
    ataRegistrationAdjustmentReason: "ATA 调整",
    registrationSubjects: "34",
    registrationAdjustmentReason: "报考调整",
    openSubjects: "34",
    openSubjectsAdjustmentReason: "开考调整",
    attendedSubjects: "31",
    attendedSubjectsAdjustmentReason: "参考调整",
    averageAttendanceRate: "91.18",
    implementationUsers: "34",
    implementationSites: "0",
    implementationRooms: "0",
    implementationSessions: "1",
    implementationPapers: "1",
    implementationSubjects: "1",
    scheduleCount: "1",
    remark: "",
  };
  const draft = { fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) };
  assert.deepEqual(operationArchiveInputMapping(draft), {
    exam_cities: "0",
    reg_subjects: "0",
    system_reg_subjects_adjustment_reason: "ATA 调整",
    reg_operation_subjects: "34",
    reg_subjects_adjustment_reason: "报考调整",
    arranged_operation_subjects: "34",
    arranged_subjects_adjustment_reason: "开考调整",
    exam_operation_subjects: "31",
    exam_subjects_adjustment_reason: "参考调整",
    avg_exam_percent: "91.18",
    exam_users: "34",
    exam_places: "0",
    exam_rooms: "0",
    exam_scenes: "1",
    papers: "1",
    subjects: "1",
    schedules: "1",
    memo: "",
  });
});

test("archive runner recognizes pending and submitted operation-console states", () => {
  assert.equal(operationArchiveStatusFromText("状态：待提交 我要归档"), "pending");
  assert.equal(operationArchiveStatusFromText("状态：审核未通过 审核意见：撤回 重新归档"), "pending");
  assert.equal(operationArchiveStatusFromText("状态：已归档"), "submitted");
  assert.equal(operationArchiveStatusFromText("状态：审核中"), "submitted");
  assert.equal(operationArchiveStatusFromText("状态：待审核 我要归档"), "submitted");
});

test("archive runner recognizes the visible archive submission confirmation wording", () => {
  assert.equal(operationArchiveConfirmationTextMatches("提示 您确认要提交归档吗 取消 确定"), true);
  assert.equal(operationArchiveConfirmationTextMatches("是否确认提交归档"), true);
  assert.equal(operationArchiveConfirmationTextMatches("我要归档 取消 确定"), false);
});

test("archive runner clicks the visible ordinary modal confirmation instead of a hidden stale root", async () => {
  let clicked = false;
  const button = {
    async isVisible() { return true; },
    async click() { clicked = true; },
  };
  const buttonLocator = {
    async all() { return [button]; },
  };
  const visibleConfirmation = {
    async isVisible() { return true; },
    async innerText() { return "提示 您确认要提交归档吗 取消 确定"; },
    getByRole() { return buttonLocator; },
  };
  const hiddenStaleConfirmation = {
    async isVisible() { return false; },
    async innerText() { return "提示 您确认要提交归档吗 取消 确定"; },
  };
  const page = {
    locator(selector) {
      if (selector === ".ant-modal:visible") return { async all() { return [visibleConfirmation]; } };
      if (selector === ".ant-modal-confirm:visible") return { async all() { return [hiddenStaleConfirmation]; } };
      throw new Error(`unexpected selector: ${selector}`);
    },
  };

  await confirmArchiveSubmission(page);
  assert.equal(clicked, true);
});

test("archive runner recognizes an operation-console schedule prompt", () => {
  assert.equal(operationArchiveSchedulePromptText(["", "该批次没有考试日程，请先完善日程"]), "该批次没有考试日程，请先完善日程");
  assert.equal(operationArchiveSchedulePromptText(["归档信息已打开"]), "");
});

test("archive runner waits for the archive action after switching tabs", async () => {
  let clicked = false;
  let waitArgument = null;
  let waitOptions = null;
  const tab = {
    async isVisible() { return true; },
    async click() { clicked = true; },
  };
  const archiveTabs = {
    filter() { return this; },
    async all() { return [tab]; },
  };
  const page = {
    locator(selector) {
      if (selector === ".ant-tabs-tab") return archiveTabs;
      if (selector === "body") return { async innerText() { return "状态：审核未通过 重新归档"; } };
      throw new Error(`unexpected selector: ${selector}`);
    },
    async waitForFunction(_callback, argument, options) {
      waitArgument = argument;
      waitOptions = options;
    },
  };

  assert.equal(await openArchiveTab(page), "pending");
  assert.equal(clicked, true);
  assert.deepEqual(waitArgument, ["我要归档", "重新归档"]);
  assert.deepEqual(waitOptions, { timeout: 10000 });
});

test("archive runner clicks the rearchive action after a rejected review", async () => {
  let clicked = false;
  let waitArgument = null;
  const button = {
    async isVisible() { return true; },
    async click() { clicked = true; },
  };
  const modal = { async waitFor() {} };
  const page = {
    getByRole(role, options) {
      assert.equal(role, "button");
      assert.equal(options.name.test("重新归档"), true);
      return { async all() { return [button]; } };
    },
    locator(selector) {
      if (selector === ".ant-modal") {
        return {
          filter(options) {
            assert.equal(options.hasText.test("重新归档"), true);
            return { async all() { return []; } };
          },
        };
      }
      if (selector.includes(".ant-message-notice")) return { async all() { return []; } };
      if (selector === ".ant-modal:visible") {
        return {
          filter(options) {
            assert.equal(options.hasText.test("重新归档"), true);
            return { last() { return modal; } };
          },
        };
      }
      throw new Error(`unexpected selector: ${selector}`);
    },
    async waitForFunction(_callback, argument) { waitArgument = argument; },
  };

  assert.strictEqual(await openArchiveForm(page), modal);
  assert.equal(clicked, true);
  assert.deepEqual(waitArgument, ["我要归档", "重新归档"]);
});
