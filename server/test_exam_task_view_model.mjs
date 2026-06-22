import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateExamSessions,
  matchesExamTask,
  resolveCandidateTaskContext,
} from "../web/exam_task_view_model.mjs";

const sessions = [
  {
    taskId: "task-1",
    projectName: "考试甲",
    sourceAccount: "account-a",
    sessionType: "formal",
    session_id: "1001",
    name: "考试甲",
    status: "success",
  },
  {
    taskId: "task-1",
    projectName: "考试甲",
    sourceAccount: "account-a",
    sessionType: "trial",
    session_id: "1002",
    name: "考试甲-试考",
    status: "running",
  },
  {
    taskId: "task-2",
    projectName: "考试甲",
    sourceAccount: "account-b",
    sessionType: "formal",
    session_id: "2001",
    name: "考试甲",
    status: "failed",
  },
];

test("aggregates formal and trial sessions by taskId instead of exam name", () => {
  const tasks = aggregateExamSessions(sessions);

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].formalSession.session_id, "1001");
  assert.equal(tasks[0].trialSession.session_id, "1002");
  assert.equal(tasks[0].status, "running");
  assert.equal(tasks[1].status, "failed");
});

test("marks a task successful only when all existing sessions succeed", () => {
  const tasks = aggregateExamSessions([
    { ...sessions[0] },
    { ...sessions[1], status: "success" },
  ]);

  assert.equal(tasks[0].status, "success");
});

test("searches all task and session identifiers", () => {
  const task = aggregateExamSessions(sessions)[0];

  assert.equal(matchesExamTask(task, "1002"), true);
  assert.equal(matchesExamTask(task, "account-a"), true);
  assert.equal(matchesExamTask(task, "考试甲-试考"), true);
  assert.equal(matchesExamTask(task, "不存在"), false);
});

test("resolves only the valid requested session", () => {
  const task = { sessions: sessions.filter((item) => item.taskId === "task-1") };
  const formal = resolveCandidateTaskContext(task, "1001");
  const trial = resolveCandidateTaskContext(task, "1002");

  assert.deepEqual(formal.sessions.map((session) => session.session_id), ["1001"]);
  assert.equal(formal.selectedSession.session_id, "1001");
  assert.deepEqual(trial.sessions.map((session) => session.session_id), ["1002"]);
  assert.equal(trial.selectedSession.session_id, "1002");
  assert.deepEqual(resolveCandidateTaskContext(task, "other"), { sessions: [], selectedSession: null });
  assert.deepEqual(resolveCandidateTaskContext(task), { sessions: [], selectedSession: null });
});
