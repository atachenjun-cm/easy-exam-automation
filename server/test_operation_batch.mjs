import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyOperationBatchResult,
  buildOperationBatchDraft,
  hasOperationBatchTextReplacementCharacter,
  initializeOperationBatchDefaults,
  normalizeOperationProjectDepartment,
  OPERATION_PROJECT_DEPARTMENTS,
  operationProjectDepartmentForOwner,
  operationBatchNameForTask,
  operationBatchDisplayId,
} from "./operation_batch.mjs";
import {
  operationConsoleNeedsLogin,
  operationConsoleLoginMessage,
  operationConsoleBatchListUrl,
  operationBatchCodeFromText,
  operationBatchIsPublishedText,
  operationBatchPublishStateFromTags,
  assignFirstOperationProjectGroup,
  clickOperationBatchComplete,
  operationConfigServiceSelections,
  operationDateTitle,
  operationDropdownValueCandidates,
  operationFieldId,
  operationSelectedTaskMismatchMessage,
  operationSelectedTaskMismatches,
  operationServiceButtonLabels,
  operationTaskMismatchAllowed,
  operationTaskSearchInputSelector,
  operationSelectControlSelector,
  runOperationBatchCreation,
} from "./operation_batch_runner.mjs";

test("operation batch names use the abbreviated exam name instead of a shared parent project", () => {
  const baseBusiness = {
    project_name: "蜀道投资集团有限责任公司招聘笔试",
    exam_schedule: [{ exam_date: "2026-08-06" }],
  };
  assert.equal(operationBatchNameForTask({
    projectName: baseBusiness.project_name,
    config: {
      examName: "蜀道轨道交通集团2026年第一批公开招聘笔试",
      businessRequirement: baseBusiness,
    },
  }), "蜀道轨道交通集团招聘笔试_2026年8月");
  assert.equal(operationBatchNameForTask({
    projectName: "四川省交通建设集团有限责任公司2026年社会招聘笔试",
    config: {
      examName: "四川省交通建设集团有限责任公司2026年社会招聘笔试",
      businessRequirement: baseBusiness,
    },
  }), "四川省交通建设集团招聘笔试_2026年8月");
});

test("operation batch project name uses the Fanwei project while its batch name uses the exam name", () => {
  const task = {
    projectName: "蜀道投资集团有限责任公司招聘笔试",
    config: {
      examName: "蜀道轨道交通集团2026年第一批公开招聘笔试",
      businessRequirement: {
        project_name: "蜀道投资集团有限责任公司招聘笔试",
        exam_schedule: [{ exam_date: "2026-08-06" }],
      },
    },
  };

  const draft = buildOperationBatchDraft(task);

  assert.equal(draft.fields.projectName.value, "蜀道投资集团有限责任公司招聘笔试");
  assert.equal(draft.fields.projectName.source, "business_requirement");
  assert.equal(draft.fields.batchName.value, "蜀道轨道交通集团招聘笔试_2026年8月");
});

test("operation batch names abbreviate raw source names until a confirmed batch exists", () => {
  const task = {
    config: {
      examName: "湖北三鑫金铜股份有限公司性格测评（中智）",
      businessRequirement: {
        batch_name: "湖北三鑫金铜股份有限公司性格测评（中智）_2026年8月",
        exam_schedule: [{ exam_date: "2026-08-07" }],
      },
    },
  };

  assert.equal(
    operationBatchNameForTask(task),
    "湖北三鑫金铜性格测评（中智）_2026年8月",
  );
  assert.equal(
    operationBatchNameForTask({
      ...task,
      config: {
        ...task.config,
        operationBatchCode: "EZT260008",
        operationBatch: { code: "EZT260008", batchName: "运控实际批次名" },
      },
    }),
    "运控实际批次名",
  );
});

test("manual batch names survive draft refresh after source edits", () => {
  const task = {
    config: {
      examName: "湖北三鑫金铜股份有限公司性格测评（中智）",
      fanweiSource: {
        batchNameMode: "manual",
        raw: { fields: { "批次名称": "湖北三鑫金铜性格测评-人工命名" } },
      },
      businessRequirement: {
        batch_name: "湖北三鑫金铜性格测评-人工命名",
        batch_name_mode: "manual",
        exam_schedule: [{ exam_date: "2026-08-07" }],
      },
    },
  };

  const draft = buildOperationBatchDraft(task);
  assert.equal(operationBatchNameForTask(task), "湖北三鑫金铜性格测评-人工命名");
  assert.equal(draft.fields.batchName.value, "湖北三鑫金铜性格测评-人工命名");
  assert.equal(draft.fields.batchName.source, "manual");
});

test("operation batch runner defaults to the current operation console batch list", () => {
  assert.equal(
    operationConsoleBatchListUrl({ env: {} }),
    "https://dashboard.ata.net.cn/batch/batchList",
  );
  assert.equal(
    operationConsoleBatchListUrl({ baseUrl: "https://operation.example.test/", env: {} }),
    "https://operation.example.test/batch/batchList",
  );
});

test("operation batch runner reuses the helper browser context", async () => {
  const reachedExistingContext = new Error("reached existing helper context");
  let closeCalls = 0;
  const context = {
    pages: () => [{
      goto: async () => { throw reachedExistingContext; },
    }],
    close: async () => { closeCalls += 1; },
  };
  await assert.rejects(
    runOperationBatchCreation({ fields: {} }, {
      baseUrl: "https://dashboard.ata.net.cn",
      context,
      closeContext: false,
    }),
    (error) => error === reachedExistingContext,
  );
  assert.equal(closeCalls, 0);
});

test("operation batch creation proceeds after task selection without project identity validation", async () => {
  const source = await readFile(new URL("./operation_batch_runner.mjs", import.meta.url), "utf8");
  const creationStart = source.indexOf("export async function runOperationBatchCreation");
  const creationSource = source.slice(creationStart);
  assert.equal(creationSource.includes("assertSelectedTaskMatchesDraft"), false);
});

test("buildOperationBatchDraft maps business requirement fields with explicit sources", () => {
  const task = {
    taskId: "internal-task-id",
    projectName: "浙江省对外服务有限公司社会招聘项目",
    config: {
      requirementRequestId: "internal-request-uuid",
      businessRequirement: {
        operation_serial_number: "R0031682",
        project_code: "F0012393",
        project_name: "浙江省对外服务有限公司社会招聘项目",
        business_direction: "政府",
        applicant_department: "地方业务中心",
        ata_invigilator_arrangement: "不需要",
        ata_content_participation: "需要ATA制题或使用历史项目试卷",
        system_type: "易考",
        estimated_subject_count: "30",
        billing_basis: "按开考科次结算",
        ata_central_venue_required: "不需要",
        exam_schedule: [{ exam_date: "2026-07-10", exam_time: "全天", note: "" }],
      },
    },
  };

  const draft = buildOperationBatchDraft(task);

  assert.equal(draft.project.taskId, "internal-task-id");
  assert.equal(draft.project.requirementRequestId, "internal-request-uuid");
  assert.equal(draft.fields.operationTaskSerial.value, "R0031682");
  assert.equal(draft.fields.projectCode.value, "F0012393");
  assert.equal(draft.fields.projectName.value, "浙江省对外服务有限公司社会招聘项目");
  assert.equal(draft.fields.businessDirection.value, "政府");
  assert.equal(draft.fields.businessDepartment.value, "地方业务中心");
  assert.equal(draft.fields.estimatedTotalSubjectCount.value, "30");
  assert.equal(draft.fields.estimatedMaxSubjectCount.value, "30");
  assert.equal(draft.fields.estimatedCityCount.value, "0");
  assert.equal(draft.fields.systemType.value, "易考");
  assert.equal(draft.fields.stationUsage.value, "无需考站");
  assert.equal(draft.fields.arrangementService.value, "其它");
  assert.equal(draft.fields.onlineSettlementArrangementSource.value, "其它");
  assert.equal(draft.fields.projectDepartment.value, "项目实施五部");
  assert.equal(draft.fields.servicePersonnel.value, "不需要");
  assert.equal(draft.fields.contentParticipation.value, "需要ATA制题或使用历史项目试卷");
  assert.equal(draft.fields.contentService.value, "制题");
  assert.equal(draft.fields.contentService.source, "business_requirement");
  assert.equal(draft.fields.billingBasis.value, "按开考科次结算");
  assert.equal(draft.fields.examStartDate.value, "2026-07-10");
  assert.equal(draft.fields.examEndDate.value, "2026-07-10");
  assert.equal(draft.fields.batchName.source, "default_rule");
  assert.ok(draft.fields.batchName.value.includes("2026年7月"));
  assert.equal(draft.warnings.some((item) => item.field === "projectDepartment"), false);
});

test("operation batch draft ignores replacement-character-corrupted manual overrides", () => {
  const task = {
    taskId: "corrupted-billing-basis-task-id",
    config: {
      businessRequirement: {
        billing_basis: "按参考科次结算",
      },
    },
  };
  const corruptedValue = "按参考科次\uFFFD\uFFFD\uFFFD算";

  assert.equal(hasOperationBatchTextReplacementCharacter(corruptedValue), true);
  const draft = buildOperationBatchDraft(task, {
    fields: { billingBasis: corruptedValue },
  });

  assert.equal(draft.fields.billingBasis.value, "按参考科次结算");
  assert.equal(draft.fields.billingBasis.source, "business_requirement");
});

test("operation batch draft keeps the current source batch name over stale draft data", () => {
  const task = {
    config: {
      fanweiSource: {
        batchNameMode: "manual",
        raw: { fields: { "批次名称": "湖北三鑫金铜性格测评_2026年8月" } },
      },
      businessRequirement: {
        batch_name: "湖北三鑫金铜股份有限公司性格测评（中智）_2026年8月",
        batch_name_mode: "manual",
        exam_schedule: [{ exam_date: "2026-08-07" }],
      },
    },
  };

  const draft = buildOperationBatchDraft(task, {
    fields: { batchName: "湖北三鑫金铜性格测评（中智）_2026年8月" },
  });

  assert.equal(draft.fields.batchName.value, "湖北三鑫金铜性格测评_2026年8月");
  assert.equal(draft.fields.batchName.source, "manual");
});

test("operation batch draft keeps current source name and dates over stale draft data", () => {
  const task = {
    projectName: "湖北三鑫金铜股份有限公司性格测评（中智）",
    config: {
      examName: "湖北三鑫金铜股份有限公司性格测评",
      businessRequirement: {
        project_name: "湖北三鑫金铜股份有限公司性格测评（中智）",
        exam_schedule: [{ exam_date: "2026-08-06" }],
      },
      operationBatch: {
        draft: {
          fields: {
            projectName: { value: "湖北三鑫金铜股份有限公司性格测评（中智）" },
            examStartDate: { value: "2026-08-07" },
            examEndDate: { value: "2026-08-07" },
          },
        },
      },
    },
  };

  const draft = buildOperationBatchDraft(task, {
    fields: {
      projectName: "湖北三鑫金铜股份有限公司性格测评（中智）",
      examStartDate: "2026-08-07",
      examEndDate: "2026-08-07",
    },
  });

  assert.equal(draft.fields.projectName.value, "湖北三鑫金铜股份有限公司性格测评（中智）");
  assert.equal(draft.fields.projectName.source, "business_requirement");
  assert.equal(draft.fields.examStartDate.value, "2026-08-06");
  assert.equal(draft.fields.examEndDate.value, "2026-08-06");
});

test("buildOperationBatchDraft normalizes office department and personnel service defaults", () => {
  const task = {
    taskId: "office-task-id",
    config: {
      businessRequirement: {
        operation_serial_number: "R0031683",
        project_name: "某办事处考试项目",
        applicant_department: "杭州办事处",
        ata_invigilator_arrangement: "需要安排分散人工监考",
        estimated_subject_count: "12",
        billing_basis: "按开考科次结算",
        ata_central_venue_required: "不需要",
      },
    },
  };

  const draft = buildOperationBatchDraft(task);

  assert.equal(draft.fields.businessDepartment.value, "地方业务中心");
  assert.equal(draft.fields.businessDepartment.source, "default_rule");
  assert.equal(draft.fields.projectDepartment.value, "项目实施五部");
  assert.equal(draft.fields.projectDepartment.source, "default_rule");
  assert.equal(draft.fields.servicePersonnel.value, "分散人工监考");
  assert.equal(draft.fields.servicePersonnel.source, "business_requirement");
  assert.equal(draft.warnings.some((item) => item.field === "projectDepartment"), false);
  assert.equal(draft.warnings.some((item) => item.field === "servicePersonnel"), false);
});

test("buildOperationBatchDraft normalizes representative offices, including saved draft overrides", () => {
  const task = {
    taskId: "representative-office-task-id",
    config: {
      businessRequirement: {
        applicant_department: "成都代表处",
      },
    },
  };

  const draft = buildOperationBatchDraft(task);
  assert.equal(draft.fields.businessDepartment.value, "地方业务中心");
  assert.equal(draft.fields.businessDepartment.source, "default_rule");

  const restoredDraft = buildOperationBatchDraft(task, {
    fields: { businessDepartment: "成都代表处" },
  });
  assert.equal(restoredDraft.fields.businessDepartment.value, "地方业务中心");
  assert.equal(restoredDraft.fields.businessDepartment.source, "default_rule");
});

test("new projects snapshot the operation project department from the owner account", () => {
  assert.deepEqual(OPERATION_PROJECT_DEPARTMENTS, [
    "项目实施一部",
    "项目实施二部",
    "项目实施三部",
    "项目实施四部",
    "项目实施五部",
    "悦考在线运维部",
  ]);
  assert.equal(normalizeOperationProjectDepartment("项目实施三部"), "项目实施三部");
  assert.equal(normalizeOperationProjectDepartment("未知部门"), "");
  const cases = [
    ["chenjun@ata.net.cn", "项目实施一部"],
    ["CHENJUN@ATA.NET.CN", "项目实施一部"],
    ["siyuanyuan@ata.net.cn", "项目实施三部"],
    ["other@ata.net.cn", "项目实施五部"],
  ];

  for (const [ownerEmail, expected] of cases) {
    const config = initializeOperationBatchDefaults({ marker: "preserved" }, ownerEmail);
    const draft = buildOperationBatchDraft({ ownerEmail, config });
    assert.equal(operationProjectDepartmentForOwner(ownerEmail), expected);
    assert.equal(config.marker, "preserved");
    assert.equal(config.operationBatch.projectDepartmentDefault, expected);
    assert.equal(draft.fields.projectDepartment.value, expected);
    assert.equal(draft.fields.projectDepartment.source, "default_rule");
  }
});

test("existing projects keep the legacy project department and manual overrides", () => {
  const task = {
    ownerEmail: "chenjun@ata.net.cn",
    config: { businessRequirement: {} },
  };

  const legacyDraft = buildOperationBatchDraft(task);
  assert.equal(legacyDraft.fields.projectDepartment.value, "项目实施五部");

  const manualDraft = buildOperationBatchDraft(task, {
    fields: { projectDepartment: "项目实施二部" },
  });
  assert.equal(manualDraft.fields.projectDepartment.value, "项目实施二部");
  assert.equal(manualDraft.fields.projectDepartment.source, "manual");
});

test("applyOperationBatchResult writes batch code without replacing internal ids", () => {
  const task = {
    taskId: "internal-task-id",
    config: {
      requirementRequestId: "internal-request-uuid",
      initialRequirementRequestId: "internal-request-uuid",
      operationBatch: {
        draft: {
          fields: {
            operationTaskSerial: { value: "R0031682" },
            batchName: { value: "示例运营批次_2026年8月" },
          },
        },
        errorMessage: "previous failure",
      },
    },
  };

  const patch = applyOperationBatchResult(task, {
    operationBatchCode: "EZT260003",
    batchName: "运控实际批次_2026年8月",
    batchGuid: "e368050be9e14671892d7ea8c48b33ca",
    status: "created_unpublished",
  });

  assert.equal(patch.operationBatchCode, "EZT260003");
  assert.equal(patch.requirementRequestId, undefined);
  assert.equal(patch.initialRequirementRequestId, undefined);
  assert.equal(patch.operationBatch.code, "EZT260003");
  assert.equal(patch.operationBatch.batchName, "运控实际批次_2026年8月");
  assert.equal(patch.scoreStampBatchName, "运控实际批次_2026年8月");
  assert.equal(patch.operationBatch.batchGuid, "e368050be9e14671892d7ea8c48b33ca");
  assert.equal(patch.operationBatch.status, "created_unpublished");
  assert.equal(patch.operationBatch.errorMessage, "");
  assert.equal(patch.operationBatch.draft.fields.operationTaskSerial.value, "R0031682");
  assert.equal(patch.operationBatch.events.length, 1);
  assert.equal(patch.operationBatch.events[0].type, "operation_batch_created");
});

test("applyOperationBatchResult does not promote a draft name to an actual batch name", () => {
  const patch = applyOperationBatchResult({
    config: {
      scoreStampBatchName: "人工批次名",
      operationBatch: { draft: { fields: { batchName: { value: "自动批次名" } } } },
    },
  }, { operationBatchCode: "EZT260006" });

  assert.equal(patch.operationBatch.batchName, undefined);
  assert.equal(patch.scoreStampBatchName, "人工批次名");
});

test("applyOperationBatchResult keeps the batch name returned by the operation console", () => {
  const patch = applyOperationBatchResult({}, {
    operationBatchCode: "EZT260007",
    batchName: "回传批次名_2026年8月",
  });

  assert.equal(patch.operationBatch.batchName, "回传批次名_2026年8月");
  assert.equal(patch.scoreStampBatchName, "回传批次名_2026年8月");
});

test("applyOperationBatchResult preserves a synced code when publishing needs a follow-up", () => {
  const patch = applyOperationBatchResult({}, {
    operationBatchCode: "EZT260005",
    status: "created_unpublished",
    errorCode: "OPERATION_BATCH_PUBLISH_FAILED",
    errorMessage: "发布确认超时",
  });

  assert.equal(patch.operationBatchCode, "EZT260005");
  assert.equal(patch.operationBatch.status, "created_unpublished");
  assert.equal(patch.operationBatch.errorCode, "OPERATION_BATCH_PUBLISH_FAILED");
  assert.equal(patch.operationBatch.errorMessage, "发布确认超时");
});

test("operationBatchDisplayId prefers batch code over internal requirement id", () => {
  assert.equal(operationBatchDisplayId({
    config: {
      operationBatchCode: "EZT260003",
      requirementRequestId: "internal-request-uuid",
    },
  }), "EZT260003");
  assert.equal(operationBatchDisplayId({
    config: {
      requirementRequestId: "internal-request-uuid",
    },
  }), "internal-request-uuid");
});

test("operation batch creation guard rejects overlap and allows retry after release", async () => {
  const module = await import("./operation_batch.mjs");
  assert.equal(typeof module.acquireOperationBatchCreation, "function");
  assert.equal(typeof module.releaseOperationBatchCreation, "function");
  const inFlight = new Set();

  module.acquireOperationBatchCreation(inFlight, "task-1");
  assert.throws(
    () => module.acquireOperationBatchCreation(inFlight, "task-1"),
    (error) => error?.status === 409 && /正在创建/.test(error.message),
  );
  module.releaseOperationBatchCreation(inFlight, "task-1");
  assert.doesNotThrow(() => module.acquireOperationBatchCreation(inFlight, "task-1"));
});

test("operation batch runner identifies operation console login redirect", () => {
  assert.equal(operationConsoleNeedsLogin("http://172.16.21.201:9004/loginWaiting?response_type=code"), true);
  assert.equal(operationConsoleNeedsLogin("http://172.16.21.201:9003/OAuth2/authorize?redirect_uri=http%3A%2F%2F172.16.18.198%3A8020%2Fuser%2Flogin"), true);
  assert.equal(operationConsoleNeedsLogin("https://dashboard.ata.net.cn/batch/batchList"), false);
  assert.match(operationConsoleLoginMessage(10), /10 分钟/);
});

test("operation batch runner extracts operation batch code from batch list text", () => {
  const text = "找到 1 条结果\nQTT260007\n实施中\n北京农商银行公文大赛_2026年8月";
  assert.equal(operationBatchCodeFromText(text), "QTT260007");
});

test("operation batch runner clicks the unique final 完成 button after the form summary", async () => {
  const calls = [];
  const button = {
    waitFor: async (options) => calls.push(["waitFor", options]),
    count: async () => 1,
    click: async (options) => calls.push(["click", options]),
  };
  const page = {
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert.deepEqual(options, { name: "完成", exact: true });
      return button;
    },
  };

  await clickOperationBatchComplete(page, { assignProjectGroup: false });

  assert.deepEqual(calls, [
    ["waitFor", { state: "visible", timeout: 30000 }],
    ["click", { force: true }],
  ]);
});

test("operation batch runner resolves 完成 from the visible creation modal text", async () => {
  const calls = [];
  const button = {
    count: async () => 1,
    waitFor: async (options) => calls.push(["waitFor", options]),
    scrollIntoViewIfNeeded: async () => calls.push(["scroll"]),
    click: async (options) => calls.push(["click", options]),
  };
  const modal = {
    locator: (selector) => {
      assert.equal(selector, "button");
      return { filter: () => button };
    },
  };
  const page = {
    locator: (selector) => {
      if (selector === ".ant-modal:visible") return { last: () => modal };
      return { filter: () => ({ count: async () => 0 }) };
    },
    getByRole: () => ({ count: async () => 0 }),
  };

  await clickOperationBatchComplete(page, { assignProjectGroup: false });

  assert.deepEqual(calls, [
    ["waitFor", { state: "visible", timeout: 30000 }],
    ["scroll"],
    ["click", { force: true }],
  ]);
});

test("operation batch runner accepts direct detail navigation without a project-group dialog", async () => {
  const calls = [];
  let currentUrl = "https://dashboard.ata.net.cn/batch/batchList";
  const empty = {
    count: async () => 0,
    filter: () => empty,
    last: () => empty,
    locator: () => empty,
  };
  const button = {
    count: async () => 1,
    waitFor: async (options) => calls.push(["waitFor", options]),
    click: async (options) => {
      calls.push(["click", options]);
      currentUrl = "https://dashboard.ata.net.cn/batch/batchDetail?batch_guid=batch-guid";
    },
  };
  const page = {
    getByRole: () => button,
    url: () => currentUrl,
    locator: () => empty,
  };

  const result = await clickOperationBatchComplete(page);

  assert.deepEqual(result, { projectGroupAssigned: false });
  assert.deepEqual(calls, [
    ["waitFor", { state: "visible", timeout: 30000 }],
    ["click", { force: true }],
  ]);
});

test("operation batch publish-state detection handles status badges on separate lines", () => {
  assert.equal(operationBatchIsPublishedText("批次状态：\n实施中\n未发布"), false);
  assert.equal(operationBatchIsPublishedText("批次状态：\n实施中"), false);
  assert.equal(operationBatchIsPublishedText("批次状态：\n实施中\n已发布"), true);
  assert.equal(operationBatchIsPublishedText("批次详情加载中"), false);
  assert.equal(operationBatchPublishStateFromTags(["实施中", "已发布"]), "published");
  assert.equal(operationBatchPublishStateFromTags(["实施中", "未发布"]), "unpublished");
  assert.equal(operationBatchPublishStateFromTags(["实施中", "撤销发布"]), "unpublished");
  assert.equal(operationBatchPublishStateFromTags(["实施中"]), "");
});

test("operation batch runner assigns the first available project group and confirms", async () => {
  const calls = [];
  const plusButton = {
    count: async () => 5,
    first: () => ({
      scrollIntoViewIfNeeded: async () => calls.push(["plus-scroll"]),
      click: async () => calls.push(["plus-click"]),
    }),
  };
  const empty = {
    count: async () => 0,
    filter: () => empty,
  };
  const confirmButton = {
    count: async () => 1,
    click: async () => calls.push(["confirm-click"]),
  };
  const modal = {
    count: async () => 1,
    waitFor: async (options) => calls.push(["modal-wait", options]),
    locator: (selector) => {
      if (selector.startsWith(".anticon-plus")) return plusButton;
      if (selector === "button:visible") {
        return {
          filter: ({ hasText }) => {
            assert.equal(hasText.test("确定"), true);
            return confirmButton;
          },
        };
      }
      return empty;
    },
  };
  const page = {
    locator: (selector) => {
      assert.equal(selector, ".ant-modal:visible");
      return {
        filter: ({ hasText }) => {
          assert.equal(hasText, "新项目指定项目组");
          return modal;
        },
      };
    },
  };

  const result = await assignFirstOperationProjectGroup(page);

  assert.deepEqual(result, { projectGroupAssigned: true });
  assert.deepEqual(calls, [
    ["modal-wait", { state: "visible", timeout: 30000 }],
    ["plus-scroll"],
    ["plus-click"],
    ["confirm-click"],
    ["modal-wait", { state: "hidden", timeout: 30000 }],
  ]);
});

test("operation batch runner uses the task serial search input in selection modal", () => {
  assert.equal(operationTaskSearchInputSelector(), 'input[placeholder*="流水号"]');
});

test("operation batch runner supports ant design select controls in recorded console", () => {
  assert.ok(operationSelectControlSelector().includes(".ant-select-selection"));
  assert.ok(operationSelectControlSelector().includes(".ant-select-selector"));
});

test("operation batch runner maps recorded form labels to stable control ids", () => {
  assert.equal(operationFieldId("业务部归属"), "start_department");
  assert.equal(operationFieldId("项目部归属"), "project_department");
  assert.equal(operationFieldId("系统类型"), "system_type");
});

test("operation batch runner maps requirement terms to operation console dropdown aliases", () => {
  assert.deepEqual(operationDropdownValueCandidates("业务部归属", "成都代表处"), ["成都代表处", "地方业务中心"]);
  assert.deepEqual(operationDropdownValueCandidates("结算依据", "按报名科次结算"), ["按报名科次结算", "按开考科次结算"]);
  assert.deepEqual(operationDropdownValueCandidates("系统类型", "易考"), ["易考"]);
});

test("operation batch runner formats ant calendar date titles", () => {
  assert.equal(operationDateTitle("2026-08-22"), "2026年8月22日");
  assert.equal(operationDateTitle("2026/08/02"), "2026年8月2日");
});

test("operation batch runner maps service fields to recorded config service buttons", () => {
  assert.deepEqual(operationServiceButtonLabels({ serviceExam: "易考", servicePersonnel: "在线监考" }), ["考试", "人员"]);
  assert.deepEqual(operationServiceButtonLabels({ serviceExam: "易考", servicePersonnel: "" }), ["考试"]);
  assert.deepEqual(operationServiceButtonLabels({ contentService: "制题", serviceExam: "易考", servicePersonnel: "在线监考" }), ["内容", "考试", "人员"]);
});

test("operation batch runner selects service category and concrete service options", () => {
  assert.deepEqual(operationConfigServiceSelections({ contentService: "制题", serviceExam: "易考", servicePersonnel: "在线监考" }), [
    { category: "内容", option: "制题" },
    { category: "考试", option: "易考" },
    { category: "人员", option: "在线监考" },
  ]);
  assert.deepEqual(operationConfigServiceSelections({ serviceExam: "易考", servicePersonnel: "在线监考" }), [
    { category: "考试", option: "易考" },
    { category: "人员", option: "在线监考" },
  ]);
  assert.deepEqual(operationConfigServiceSelections({ serviceExam: "易考", servicePersonnel: "分散人工监考" }), [
    { category: "考试", option: "易考" },
    { category: "人员", option: "在线监考" },
  ]);
});

test("operation batch runner describes mismatched selected operation tasks", () => {
  const draft = {
    fields: {
      projectCode: { value: "F0020592" },
      projectName: { value: "北京农商银行公文大赛" },
    },
  };
  const mismatches = operationSelectedTaskMismatches(draft, {
    projectCode: "F0012393",
    projectName: "宁德时代",
  });
  assert.deepEqual(mismatches, [
    { label: "项目编码", expected: "F0020592", actual: "F0012393" },
    { label: "项目名称", expected: "北京农商银行公文大赛", actual: "宁德时代" },
  ]);
  assert.match(operationSelectedTaskMismatchMessage(mismatches), /需求任务单与当前项目不一致/);
});

test("operation batch mismatch policy retains its explicit test switch", () => {
  assert.equal(operationTaskMismatchAllowed({}), false);
  assert.equal(operationTaskMismatchAllowed({ allowTaskMismatch: true }), true);
  assert.equal(operationTaskMismatchAllowed({ env: { OPERATION_CONSOLE_ALLOW_TEST_TASK_MISMATCH: "1" } }), true);
  assert.equal(operationTaskMismatchAllowed({ env: { OPERATION_CONSOLE_ALLOW_TEST_TASK_MISMATCH: "0" } }), false);
});
