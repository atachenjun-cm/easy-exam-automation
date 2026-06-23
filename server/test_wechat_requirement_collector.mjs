import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWechatRequirementDraft,
  loadWechatGroupConfig,
  parseWechatRequirementMessages,
} from "./wechat_requirement_collector.mjs";

const sampleConfig = {
  groups: [
    {
      group_name: "AI赋能运营自动化小组",
      project_name: "易考自动化需求",
      customer_name: "内部测试客户",
      enabled: true,
      interval_minutes: 15,
    },
    {
      group_name: "某客户考试项目群",
      project_name: "某客户校招考试",
      customer_name: "某客户",
      enabled: true,
      interval_minutes: 15,
    },
  ],
};

const sampleChat = `
2026/06/23 09:02 项目经理：
客户启动会确认，考试名称是 2026 校招笔试。

2026/06/23 09:06 客户张：
正式考试 8 月 20 日上午 9 点到 11 点，试考 8 月 19 日下午 3 点到 4 点。

2026/06/23 09:08 客户张：
科目是行测和英语，需要视频监控和录制，不需要鹰眼，网页考试，允许离开 3 次。

2026/06/23 09:15 项目经理：
登录规则先按提前 30 分钟，迟到 15 分钟不能进。

2026/06/23 10:20 客户张：
变更一下，科目增加数学。
`;

test("loads multi-group config and resolves the target group", () => {
  const config = loadWechatGroupConfig(sampleConfig);

  assert.equal(config.groups.length, 2);
  assert.equal(config.groups[0].groupName, "AI赋能运营自动化小组");
  assert.equal(config.groups[0].projectName, "易考自动化需求");
  assert.equal(config.groups[0].intervalMinutes, 15);
});

test("parses visible WeChat messages into a requirement draft", () => {
  const config = loadWechatGroupConfig(sampleConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: sampleChat,
  });

  assert.equal(draft.source.type, "wechat_group");
  assert.equal(draft.source.groupName, "AI赋能运营自动化小组");
  assert.equal(draft.project.projectName, "易考自动化需求");
  assert.equal(draft.project.customerName, "内部测试客户");
  assert.equal(draft.requirement.exam_name, "2026 校招笔试");
  assert.equal(draft.requirement.formal_exam_time_range, "8 月 20 日上午 9 点到 11 点");
  assert.equal(draft.requirement.mock_exam_time_range, "8 月 19 日下午 3 点到 4 点");
  assert.deepEqual(draft.requirement.subjects, ["行测", "英语", "数学"]);
  assert.equal(draft.requirement.video_monitor_required, "是");
  assert.equal(draft.requirement.video_record_required, "是");
  assert.equal(draft.requirement.hawkeye_required, "否");
  assert.equal(draft.requirement.exam_client_type, "网页考试");
  assert.equal(draft.requirement.leave_limit_count, 3);
  assert.equal(draft.requirement.early_login_minutes, "30分钟");
  assert.equal(draft.requirement.late_limit_minutes, "15分钟");
  assert.deepEqual(draft.unresolvedQuestions, []);
  assert.equal(draft.changeRecords.length, 1);
  assert.match(draft.changeRecords[0].message, /科目增加数学/);
  assert.match(draft.checkpoint.lastMessageHash, /^[a-f0-9]{64}$/);
});

test("reports unresolved questions when required fields are missing", () => {
  const messages = parseWechatRequirementMessages("客户：考试叫产品认证考试，科目是语文。");

  assert.equal(messages.requirement.exam_name, "产品认证考试");
  assert.deepEqual(messages.requirement.subjects, ["语文"]);
  assert.ok(messages.unresolvedQuestions.some((question) => question.includes("正式考试时间")));
  assert.ok(messages.unresolvedQuestions.some((question) => question.includes("试考时间")));
});
