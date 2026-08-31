import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildProjectSharedSheetReminderEmail,
  projectSharedSheetReminderDecision,
  projectSharedSheetReminderEarliestSession,
  projectSharedSheetReminderSchedule,
  projectSharedSheetWasFilled,
  sendProjectSharedSheetReminderEmail,
} from "./project_shared_sheet_reminder.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function taskFixture({
  sessions,
  stepStatus = "pending",
  stepResult,
  reminder,
  ownerEmail = "owner@example.com",
} = {}) {
  return {
    taskId: "task-shared-sheet-reminder-1",
    projectName: "项目共享表提醒测试项目",
    ownerEmail,
    config: {
      ...(reminder ? { projectSharedSheetReminder: reminder } : {}),
    },
    sessions: sessions || [
      {
        sessionType: "formal",
        session_id: "formal-1",
        name: "项目共享表提醒测试考试",
        start: "2026-08-25 19:00:00",
      },
      {
        sessionType: "trial",
        session_id: "trial-1",
        name: "项目共享表提醒测试考试-试考",
        start: "2026-08-24 10:00:00",
      },
    ],
    steps: [{
      stepKey: "project_shared_sheet",
      status: stepStatus,
      ...(stepResult ? { result: stepResult } : {}),
    }],
  };
}

const emailSettings = {
  host: "smtp.example.com",
  port: 587,
  fromEmail: "sender@example.com",
  fromName: "易考自动化",
  username: "sender@example.com",
  password: "test-password",
};

test("earliest trial session controls the reminder even when formal is listed first", () => {
  const earliest = projectSharedSheetReminderEarliestSession(taskFixture());
  assert.equal(earliest.sessionId, "trial-1");
  assert.equal(earliest.sessionType, "trial");
  assert.equal(earliest.sessionTypeLabel, "试考");
});

test("a formal-only task uses its formal session as the earliest session", () => {
  const task = taskFixture({
    sessions: [{
      sessionType: "formal",
      session_id: "formal-only",
      name: "只有正考",
      start: "2026-08-25 19:00:00",
    }],
  });
  const earliest = projectSharedSheetReminderEarliestSession(task);
  assert.equal(earliest.sessionId, "formal-only");
  assert.equal(earliest.sessionTypeLabel, "正式考试");
});

test("reminder starts at 17:00 on the day before the earliest session", () => {
  const schedule = projectSharedSheetReminderSchedule("2026-08-24 10:00:00");
  assert.deepEqual(
    [schedule.scheduled.getFullYear(), schedule.scheduled.getMonth(), schedule.scheduled.getDate(), schedule.scheduled.getHours()],
    [2026, 7, 23, 17],
  );
  const task = taskFixture();
  assert.equal(projectSharedSheetReminderDecision(task, new Date(2026, 7, 23, 16, 59, 59)).due, false);
  assert.equal(projectSharedSheetReminderDecision(task, new Date(2026, 7, 23, 17, 0, 0)).due, true);
  assert.equal(projectSharedSheetReminderDecision(task, new Date(2026, 7, 24, 10, 0, 0)).reason, "earliest_session_started");
});

test("a successful fill covering all current sessions suppresses the reminder", () => {
  const task = taskFixture({
    stepStatus: "success",
    stepResult: { sessionIds: ["formal-1", "trial-1"] },
  });
  assert.equal(projectSharedSheetWasFilled(task), true);
  assert.equal(
    projectSharedSheetReminderDecision(task, new Date(2026, 7, 23, 17, 0, 0)).reason,
    "shared_sheet_filled",
  );
});

test("a legacy successful fill without session ids is accepted, but a partial current fill is reminded", () => {
  assert.equal(projectSharedSheetWasFilled(taskFixture({ stepStatus: "success" })), true);
  const partial = taskFixture({
    stepStatus: "success",
    stepResult: { sessionIds: ["formal-1"] },
  });
  assert.equal(projectSharedSheetWasFilled(partial), false);
  assert.equal(projectSharedSheetReminderDecision(partial, new Date(2026, 7, 23, 17, 0, 0)).due, true);
});

test("a sent reminder is deduplicated and a failed reminder retries before the session", () => {
  const now = new Date(2026, 7, 23, 17, 0, 0);
  const initial = projectSharedSheetReminderDecision(taskFixture(), now);
  const sent = taskFixture({ reminder: { status: "sent", reminderKey: initial.reminderKey } });
  assert.equal(projectSharedSheetReminderDecision(sent, new Date(2026, 7, 23, 18, 0, 0)).reason, "already_sent");

  const failed = taskFixture({ reminder: { status: "failed", reminderKey: initial.reminderKey } });
  const retry = projectSharedSheetReminderDecision(failed, new Date(2026, 7, 23, 18, 0, 0));
  assert.equal(retry.due, true);
  assert.equal(retry.reason, "retry");
});

test("a reminder sent under the old schedule is not sent again after the schedule changes", () => {
  const task = taskFixture({
    reminder: {
      status: "sent",
      reminderKey: "trial|trial-1|2026-08-24T02:00:00.000Z|2026-08-23T01:00:00.000Z|formal-1,trial-1",
      earliestSessionId: "trial-1",
      earliestSessionStart: "2026-08-24T02:00:00.000Z",
      scheduledFor: "2026-08-23T01:00:00.000Z",
    },
  });
  const decision = projectSharedSheetReminderDecision(task, new Date(2026, 7, 23, 17, 0, 0));
  assert.equal(decision.due, false);
  assert.equal(decision.reason, "already_sent");
});

test("changing the earliest session creates a new reminder key", () => {
  const now = new Date(2026, 7, 23, 17, 0, 0);
  const initial = projectSharedSheetReminderDecision(taskFixture(), now);
  const changed = taskFixture({
    reminder: { status: "sent", reminderKey: initial.reminderKey },
    sessions: [
      { sessionType: "trial", session_id: "trial-1", name: "改期试考", start: "2026-08-25 10:00:00" },
      { sessionType: "formal", session_id: "formal-1", name: "改期正考", start: "2026-08-26 19:00:00" },
    ],
  });
  const decision = projectSharedSheetReminderDecision(changed, new Date(2026, 7, 24, 17, 0, 0));
  assert.equal(decision.due, true);
  assert.notEqual(decision.reminderKey, initial.reminderKey);
});

test("reminder email goes only to the task owner account", async () => {
  const task = taskFixture();
  const now = new Date(2026, 7, 23, 17, 0, 0);
  const context = projectSharedSheetReminderDecision(task, now);
  const message = buildProjectSharedSheetReminderEmail({ task, context });
  assert.match(message.subject, /项目共享表提醒测试项目/);
  assert.match(message.text, /最早场次：试考/);
  assert.match(message.text, /2026-08-24 10:00/);
  assert.match(message.text, /触发填写并核对新在线表/);

  let delivery;
  const result = await sendProjectSharedSheetReminderEmail({
    task,
    context,
    emailSettings,
    now,
    sendMail: async (payload) => {
      delivery = payload;
      return { messageId: "mock-shared-sheet-message-id" };
    },
  });
  assert.deepEqual(delivery.to, ["owner@example.com"]);
  assert.equal(delivery.cc, undefined);
  assert.equal(result.messageId, "mock-shared-sheet-message-id");
  assert.equal(result.reminderKey, context.reminderKey);
});

test("missing task owner email fails before SMTP delivery", async () => {
  const task = taskFixture({ ownerEmail: "" });
  const now = new Date(2026, 7, 23, 17, 0, 0);
  let called = false;
  await assert.rejects(
    sendProjectSharedSheetReminderEmail({
      task,
      context: projectSharedSheetReminderDecision(task, now),
      emailSettings,
      now,
      sendMail: async () => {
        called = true;
      },
    }),
    /未记录创建账户邮箱/,
  );
  assert.equal(called, false);
});

test("server checks project shared sheet reminders after paper reminders on the same whole-hour schedule", () => {
  const source = fs.readFileSync(path.join(rootDir, "server/easy_exam_server.mjs"), "utf8");
  const paperCall = source.indexOf("await runScheduledPaperBindRemindersOnce(checkTime)");
  const sharedSheetCall = source.indexOf("await runScheduledProjectSharedSheetRemindersOnce(checkTime)");
  assert.ok(paperCall >= 0);
  assert.ok(sharedSheetCall > paperCall);
  assert.ok(source.includes("projectSharedSheetReminder: next"));
});
