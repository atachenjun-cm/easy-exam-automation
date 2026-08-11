import assert from "node:assert/strict";
import test from "node:test";

import {
  createPublicExamAssistantResponse,
  extractAssistantDate,
  extractAssistantTime,
  summarizeAssistantSession,
} from "./public_exam_assistant.mjs";

const now = new Date("2026-08-10T04:00:00.000Z");

const tasks = [
  { taskId: "task-a", projectName: "华东招聘考试", examName: "华东招聘考试", projectCode: "F001" },
  { taskId: "task-b", projectName: "西南校招考试", examName: "西南校招考试", projectCode: "F002" },
  { taskId: "task-c", projectName: "其他考试", examName: "其他考试", projectCode: "F003" },
];

const sessions = [
  { taskId: "task-a", requirementIndex: 0, sessionType: "formal", session_id: "a-main-1", name: "华东正考", start: "2026-08-09 09:00", end: "2026-08-09 11:00", candidateCount: 4 },
  { taskId: "task-a", requirementIndex: 0, sessionType: "trial", session_id: "a-trial-1", name: "华东试考", start: "2026-08-08 15:00", end: "2026-08-08 16:00", candidateCount: 4 },
  { taskId: "task-a", requirementIndex: 1, sessionType: "formal", session_id: "a-main-2", name: "华东第二场正考", start: "2026-08-10 09:00", end: "2026-08-10 11:00", candidateCount: 9 },
  { taskId: "task-a", requirementIndex: 1, sessionType: "trial", session_id: "a-trial-2", name: "华东第二场试考", start: "2026-08-09 15:00", end: "2026-08-09 16:00", candidateCount: 9 },
  { taskId: "task-b", requirementIndex: 0, sessionType: "formal", session_id: "b-main-1", name: "西南正考", start: "2026-08-09 10:00", end: "2026-08-09 12:00", candidateCount: 3 },
  { taskId: "task-b", requirementIndex: 0, sessionType: "trial", session_id: "b-trial-1", name: "西南试考", start: "2026-08-08 14:00", end: "2026-08-08 15:00", candidateCount: 3 },
  { taskId: "task-c", requirementIndex: 0, sessionType: "formal", session_id: "c-main-1", name: "其他正考", start: "2026-08-11 09:00", end: "2026-08-11 11:00", candidateCount: 2 },
];

const rowsBySession = {
  "a-trial-1": [
    { exam_status: "已完成" },
    { exam_status: "未开考" },
    { exam_status: "未开考" },
    { exam_status: "未开考" },
  ],
  "a-trial-2": Array.from({ length: 9 }, (_, index) => ({
    name: `考生${index + 1}`,
    permit: `A${String(index + 1).padStart(3, "0")}`,
    exam_status: "未开考",
  })),
  "b-trial-1": [
    { exam_status: "已完成" },
    { exam_status: "参考" },
    { exam_status: "未开考" },
  ],
  "a-main-1": [
    { exam_status: "已完成" },
    { exam_status: "已完成" },
    { name: "张三", permit: "A003", exam_status: "未开考" },
    { name: "李四", permit: "A004", exam_status: "未开考" },
  ],
  "b-main-1": [
    { exam_status: "已完成" },
    { exam_status: "已完成" },
    { exam_status: "未开考" },
  ],
};

function dependencies() {
  const taskDetails = new Map(tasks.map((task) => [task.taskId, {
    ...task,
    sessions: sessions.filter((session) => session.taskId === task.taskId),
  }]));
  return {
    listTasks: async () => tasks,
    listSessions: async () => sessions,
    getTask: async (taskId) => taskDetails.get(taskId),
    fetchSessionRows: async ({ session }) => ({ rows: rowsBySession[session.session_id] || [] }),
    now,
  };
}

test("parses common Chinese date and start-time expressions", () => {
  assert.equal(extractAssistantDate("8-9 的考试试考多少人没参加", now), "2026-08-09");
  assert.equal(extractAssistantDate("今天的正考情况", now), "2026-08-10");
  const saturday = new Date("2026-08-08T05:00:00.000Z");
  assert.equal(extractAssistantDate("周一的考试情况", saturday), "2026-08-10");
  assert.equal(extractAssistantDate("下周一的考试情况", saturday), "2026-08-10");
  assert.equal(extractAssistantDate("本周一的考试情况", saturday), "2026-08-03");
  assert.equal(extractAssistantDate("下周一的考试情况", now), "2026-08-17");
  assert.deepEqual(extractAssistantTime("8 月 9 日上午 9 点的考试"), {
    hour: 9,
    minute: 0,
    minuteSpecified: false,
  });
  assert.deepEqual(extractAssistantTime("8 月 9 日下午 2:30 的考试"), {
    hour: 14,
    minute: 30,
    minuteSpecified: true,
  });
});

test("searches projects by formal exam date and aggregates their matching trial sessions", async () => {
  const response = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "8-9 的考试试考多少人没参加，咋样",
  });

  assert.equal(response.kind, "answer");
  assert.deepEqual(response.context.selectedTaskIds, ["task-a", "task-b"]);
  assert.deepEqual(response.context.requirementIndexesByTask, { "task-a": [0], "task-b": [0] });
  assert.match(response.answer, /查到正考时间为 2026 年 8 月 9 日的 2 个考试项目/);
  assert.match(response.answer, /合计试考：应考 7 人，已参加 3 人，未参加 4 人/);
  assert.doesNotMatch(response.answer, /华东第二场试考/);
});

test("displays the exam name instead of the project name", async () => {
  const response = await createPublicExamAssistantResponse({
    listTasks: async () => [{
      taskId: "shared-project",
      projectName: "蜀道投资集团有限责任公司招聘笔试",
      examName: "蜀道轨道交通集团2026年第一批公开招聘笔试心理测评",
      projectCode: "F0020795",
    }],
    listSessions: async () => [{
      taskId: "shared-project",
      requirementIndex: 0,
      sessionType: "formal",
      session_id: "formal-434392",
      name: "蜀道轨道交通集团2026年第一批公开招聘笔试心理测评",
      start: "2026-08-10 10:00",
      end: "2026-08-10 17:00",
      candidateCount: 10,
    }],
    getTask: async () => ({
      taskId: "shared-project",
      projectName: "蜀道投资集团有限责任公司招聘笔试",
      examName: "蜀道轨道交通集团2026年第一批公开招聘笔试心理测评",
      projectCode: "F0020795",
      sessions: [{
        taskId: "shared-project",
        requirementIndex: 0,
        sessionType: "formal",
        session_id: "formal-434392",
        name: "蜀道轨道交通集团2026年第一批公开招聘笔试心理测评",
        start: "2026-08-10 10:00",
        end: "2026-08-10 17:00",
        candidateCount: 10,
      }],
    }),
    fetchSessionRows: async () => ({ rows: [] }),
    now,
    message: "周一的心理测评情况",
  });

  assert.match(response.answer, /蜀道轨道交通集团2026年第一批公开招聘笔试心理测评/);
  assert.doesNotMatch(response.answer, /蜀道投资集团有限责任公司招聘笔试/);
});

test("keeps archived projects queryable", async () => {
  const archivedTask = {
    taskId: "archived-project",
    projectName: "归档项目",
    examName: "蜀道轨道交通集团2026年第一批公开招聘笔试心理测评",
    hiddenAt: "2026-08-09T06:18:02.000Z",
  };
  const archivedSession = {
    taskId: archivedTask.taskId,
    requirementIndex: 0,
    sessionType: "formal",
    session_id: "formal-434392",
    name: archivedTask.examName,
    start: "2026-08-08 10:00",
    end: "2026-08-08 17:00",
    candidateCount: 10,
  };
  const response = await createPublicExamAssistantResponse({
    listTasks: async () => [archivedTask],
    listSessions: async () => [archivedSession],
    getTask: async () => ({ ...archivedTask, sessions: [archivedSession] }),
    fetchSessionRows: async () => ({ rows: [] }),
    now,
    message: archivedTask.examName,
  });

  assert.equal(response.kind, "answer");
  assert.deepEqual(response.context.selectedTaskIds, [archivedTask.taskId]);
  assert.match(response.answer, /蜀道轨道交通集团2026年第一批公开招聘笔试心理测评/);
  assert.match(response.answer, /正考（8 月 8 日 10:00-17:00）/);
});

test("uses an explicit start hour to narrow date-based exam search", async () => {
  const response = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "8 月 9 日上午 9 点的考试，试考多少人没参加",
  });

  assert.deepEqual(response.context.selectedTaskIds, ["task-a"]);
  assert.match(response.answer, /正考时间为 2026 年 8 月 9 日 09:00的 1 个考试项目/);
  assert.match(response.answer, /合计试考：应考 4 人，已参加 1 人，未参加 3 人/);
});

test("never falls back from a formal exam date to a trial-only date match", async () => {
  const response = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "8 月 8 日的考试试考多少人没参加",
  });

  assert.equal(response.kind, "not_found");
  assert.match(response.answer, /没有找到正考日期为 2026 年 8 月 8 日的项目/);
});

test("keeps date-matched projects for a conversational formal-exam follow-up", async () => {
  const first = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "8-9 的考试试考多少人没参加",
  });
  const followup = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "正考呢",
    context: first.context,
  });

  assert.deepEqual(followup.context.selectedTaskIds, ["task-a", "task-b"]);
  assert.match(followup.answer, /合计正考：应考 7 人，已参加 4 人，未参加 3 人/);
  assert.doesNotMatch(followup.answer, /华东第二场正考/);
});

test("resolves an upcoming weekday and lists not-started trial candidates in a follow-up", async () => {
  const saturday = new Date("2026-08-08T05:00:00.000Z");
  const first = await createPublicExamAssistantResponse({
    ...dependencies(),
    now: saturday,
    message: "周一的考试情况",
  });
  assert.deepEqual(first.context.selectedTaskIds, ["task-a"]);
  assert.deepEqual(first.context.requirementIndexesByTask, { "task-a": [1] });
  assert.match(first.answer, /正考时间为 2026 年 8 月 10 日/);

  const followup = await createPublicExamAssistantResponse({
    ...dependencies(),
    now: saturday,
    message: "能不能把没试考的名单给我",
    context: first.context,
  });
  assert.deepEqual(followup.context.selectedTaskIds, ["task-a"]);
  assert.deepEqual(followup.context.lastSessionTypes, ["trial"]);
  assert.match(followup.answer, /当前未进入试考的考生名单（9 人）/);
  assert.match(followup.answer, /1\. 考生1（准考证号：A001）/);
  assert.match(followup.answer, /9\. 考生9（准考证号：A009）/);
});

test("uses the previous exam selection for short colloquial candidate-list follow-ups", async () => {
  const first = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "8-9 的考试情况",
  });

  for (const message of [
    "没考的发我",
    "没考的名单",
    "名单",
    "考生名单给我",
    "还有谁没考",
    "还有哪些人没考",
    "谁没来",
    "没来的名单",
    "缺考的是哪些人",
    "未参加人员",
    "未参加人员 呢",
    "没进考试的发我",
    "还没参考的都有谁",
  ]) {
    const followup = await createPublicExamAssistantResponse({
      ...dependencies(),
      message,
      context: first.context,
    });
    assert.equal(followup.kind, "answer");
    assert.deepEqual(followup.context.selectedTaskIds, ["task-a", "task-b"]);
    assert.deepEqual(followup.context.lastSessionTypes, ["formal", "trial"]);
    assert.match(followup.answer, /华东招聘考试 - 正考（8 月 9 日 09:00-11:00）未参加正考的考生名单（2 人）/);
    assert.match(followup.answer, /1\. 张三（准考证号：A003）/);
    assert.doesNotMatch(followup.answer, /没有找到/);
  }
});

test("guides a candidate-list request that has no selected exam", async () => {
  const response = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "考生名单给我",
  });

  assert.equal(response.kind, "prompt");
  assert.match(response.answer, /请先告诉我考试名称、项目编号或正考日期/);
  assert.match(response.answer, /还有谁没考/);
});

test("uses an explicit exam name in a colloquial list request", async () => {
  const first = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "8-9 的考试情况",
  });
  const response = await createPublicExamAssistantResponse({
    ...dependencies(),
    message: "其他考试还有谁没考",
    context: first.context,
  });

  assert.deepEqual(response.context.selectedTaskIds, ["task-c"]);
  assert.match(response.answer, /其他考试/);
});

test("does not count not-started candidates as absent before a session ends", () => {
  const summary = summarizeAssistantSession({
    session: {
      sessionType: "formal",
      session_id: "future-main",
      end: "2026-08-11 12:00",
      candidateCount: 3,
    },
    rows: [{ exam_status: "已完成" }, { exam_status: "未开考" }, { exam_status: "未开考" }],
    now,
  });

  assert.equal(summary.ended, false);
  assert.equal(summary.participated, 1);
  assert.equal(summary.notStarted, 2);
  assert.equal(summary.absent, 0);
});

test("reports interrupted candidates without classifying them as absent", async () => {
  const interruptedTask = {
    taskId: "interrupted-task",
    projectName: "中断测试",
    examName: "中断测试",
  };
  const interruptedSession = {
    taskId: interruptedTask.taskId,
    requirementIndex: 0,
    sessionType: "formal",
    session_id: "interrupted-formal",
    name: "中断测试",
    start: "2026-08-08 10:00",
    end: "2026-08-08 11:00",
    candidateCount: 2,
  };
  const response = await createPublicExamAssistantResponse({
    listTasks: async () => [interruptedTask],
    listSessions: async () => [interruptedSession],
    getTask: async () => ({ ...interruptedTask, sessions: [interruptedSession] }),
    fetchSessionRows: async () => ({
      rows: [
        { name: "已完成人员", permit: "A001", exam_status: "completed" },
        { name: "李锟", permit: "A002", exam_status: "interrupted" },
      ],
    }),
    now,
    message: "中断测试谁没考",
  });

  assert.match(response.answer, /应考 2 人，已参加 1 人，未参加 0 人，考试中断 1 人/);
  assert.match(response.answer, /考试中断的考生（1 人，单独统计，不计为未参加）/);
  assert.match(response.answer, /1\. 李锟（准考证号：A002）/);
  assert.doesNotMatch(response.answer, /状态待同步/);
});

test("asks for a numbered choice when an exam name matches multiple projects", async () => {
  const sharedTasks = [
    { taskId: "same-1", projectName: "统一招聘考试", projectCode: "P1" },
    { taskId: "same-2", projectName: "统一招聘考试", projectCode: "P2" },
  ];
  const sharedSessions = sharedTasks.flatMap((task, index) => ([
    {
      taskId: task.taskId,
      requirementIndex: 0,
      sessionType: "formal",
      session_id: `same-formal-${index}`,
      start: `2026-08-${10 + index} 09:00`,
      end: index === 0 ? "2026-08-10 10:00" : "2026-08-12 10:00",
    },
    {
      taskId: task.taskId,
      requirementIndex: 0,
      sessionType: "trial",
      session_id: `same-trial-${index}`,
      start: `2026-08-${8 + index} 09:00`,
      end: `2026-08-${8 + index} 10:00`,
    },
  ]));
  const base = {
    listTasks: async () => sharedTasks,
    listSessions: async () => sharedSessions,
    getTask: async (taskId) => ({ ...sharedTasks.find((task) => task.taskId === taskId), sessions: sharedSessions.filter((session) => session.taskId === taskId) }),
    fetchSessionRows: async () => ({ rows: [] }),
    now,
  };
  const choices = await createPublicExamAssistantResponse({
    ...base,
    message: "统一招聘考试试考情况",
  });
  assert.equal(choices.kind, "choices");
  assert.equal(choices.choices.length, 2);
  assert.equal(choices.choices[0].label, "正考 2026 年 8 月 10 日 09:00-10:00，统一招聘考试，项目编号 P1");
  assert.equal(choices.choices[1].label, "正考 2026 年 8 月 11 日 09:00-2026 年 8 月 12 日 10:00，统一招聘考试，项目编号 P2");

  const selected = await createPublicExamAssistantResponse({
    ...base,
    message: "2",
    context: choices.context,
  });
  assert.deepEqual(selected.context.selectedTaskIds, ["same-2"]);
});
