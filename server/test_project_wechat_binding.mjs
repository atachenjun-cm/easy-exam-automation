import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectWechatRequirementSeed,
  createProjectWechatBindingResolver,
  projectWechatRequirementRequestId,
} from "./project_wechat_binding.mjs";

function sampleTask(overrides = {}) {
  return {
    taskId: "project-1",
    projectName: "四川项目",
    config: {
      customerName: "客户甲",
      examRequirement: {
        version: 2,
        fields: {
          "考试名称": "招聘考试",
          "考试日期时间": "2026/7/30 09:00-2026/7/30 11:00",
          "提前登录时间": "30分钟",
          "视频录制": "开启录制",
          "科目信息": "行测、申论",
        },
        config: { examName: "招聘考试", videoRecord: true, subjects: ["行测", "申论"] },
      },
      ...overrides.config,
    },
    ...overrides,
  };
}

test("project WeChat requirement id is stable for the project", () => {
  assert.equal(projectWechatRequirementRequestId("project-1"), "wechat-project-project-1");
});

test("project WeChat seed comes from the current EasyExam requirement", () => {
  const seed = buildProjectWechatRequirementSeed(sampleTask());
  assert.equal(seed.exam_name, "招聘考试");
  assert.equal(seed.formal_exam_time_range, "2026/7/30 09:00-2026/7/30 11:00");
  assert.equal(seed.early_login_minutes, "30分钟");
  assert.equal(seed.video_record_required, true);
  assert.deepEqual(seed.subjects, ["行测", "申论"]);
});

test("first project group binding creates and links a requirement baseline", async () => {
  const task = sampleTask();
  const calls = [];
  const resolver = createProjectWechatBindingResolver({
    getTask: async () => task,
    canAccessTask: () => true,
    getRequirement: async () => null,
    upsertRequirement: async (payload) => {
      calls.push(["upsert", payload]);
      return { requestId: payload.requestId, latest: { version: 1, requirement: payload.requirement } };
    },
    updateTask: async (taskId, config) => {
      calls.push(["update", { taskId, config }]);
      return { ...task, config: { ...task.config, ...config } };
    },
  });

  const resolved = await resolver({
    taskId: "project-1",
    payload: { groups: [{ groupName: "四川项目群", intervalMinutes: 15, customerName: "客户乙" }] },
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.payload.groups[0].requirementRequestId, "wechat-project-project-1");
  assert.equal(calls.length, 0, "resolver must not write before collector validation");

  const committed = await resolved.commit();
  assert.equal(committed.task.config.requirementRequestId, "wechat-project-project-1");
  assert.equal(calls[0][0], "upsert");
  assert.equal(calls[0][1].customer.name, "客户乙");
  assert.equal(calls[1][0], "update");
});

test("existing project requirement is reused without adding a baseline version", async () => {
  const task = sampleTask({ config: { requirementRequestId: "req-existing" } });
  let upserted = false;
  const resolver = createProjectWechatBindingResolver({
    getTask: async () => task,
    getRequirement: async () => ({ requestId: "req-existing" }),
    upsertRequirement: async () => { upserted = true; },
    updateTask: async () => { throw new Error("must not relink"); },
  });
  const resolved = await resolver({ taskId: task.taskId, payload: { groups: [{ groupName: "已有群" }] } });
  const committed = await resolved.commit();
  assert.equal(committed.requirementRequestId, "req-existing");
  assert.equal(upserted, false);
});

test("project group binding rejects inaccessible projects", async () => {
  const resolver = createProjectWechatBindingResolver({
    getTask: async () => sampleTask(),
    canAccessTask: () => false,
  });
  const result = await resolver({ taskId: "project-1", payload: { groups: [{ groupName: "群" }] } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});
