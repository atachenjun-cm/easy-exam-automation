import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { millisecondsUntilNextHour } from "./paper_bind_scheduler.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(rootDir, "server/easy_exam_server.mjs"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source markers: ${startMarker}`);
  return serverSource.slice(start, end);
}

test("paper form bind retry does not mark missing form codes as success", () => {
  assert.ok(serverSource.includes('if (bindResult.status === "waiting_manual")'));
  assert.ok(serverSource.includes('updatePaperFormBindState(task.taskId, requirementIndex, "failed"'));
  assert.ok(serverSource.includes("status: 409"));
  assert.ok(serverSource.includes("missingCourseCodes"));
});

test("paper form bind retry checks tenant session detail for manual binding before failing", () => {
  assert.ok(serverSource.includes("detectSessionPaperBindings"));
  assert.ok(serverSource.includes("if (!courses.length)"));
  assert.ok(serverSource.includes('if (manualBindResult.status === "success")'));
  assert.ok(serverSource.includes("detectedManualBinding: true"));
  assert.ok(serverSource.includes("人工绑定回查确认正式场次已有试卷"));
});

test("trial paper bind is a retryable task step", () => {
  assert.ok(serverSource.includes('if (stepKey === "trial_paper_bind")'));
  assert.ok(serverSource.includes("bindDefaultTrialPaperToSession"));
  assert.ok(serverSource.includes('updateTaskStep(taskId, stepKey, "waiting_manual"'));
});

test("paper binding scheduler runs at the next whole hour before the formal exam starts", () => {
  assert.ok(serverSource.includes("shouldAttemptScheduledPaperBind"));
  assert.ok(serverSource.includes("runScheduledPaperBindingOnce"));
  assert.ok(serverSource.includes("scheduleNextPaperBindingCheck"));
  assert.ok(serverSource.includes("millisecondsUntilNextHour(scheduledAt)"));
  assert.ok(serverSource.includes("scheduledForMs - Date.now()"));
  assert.ok(serverSource.includes("setTimeout(runAtWholeHour, remainingMs)"));
  assert.equal(serverSource.includes("setInterval(runScheduledPaperBindingOnce"), false);
});

test("paper binding scheduler calculates the delay to the next whole hour", () => {
  assert.equal(millisecondsUntilNextHour(new Date("2026-07-23T08:43:38.352Z")), 981648);
  assert.equal(millisecondsUntilNextHour(new Date("2026-07-23T09:00:00.000Z")), 60 * 60 * 1000);
});

test("paper binding state and execution are isolated by requirement", () => {
  assert.ok(serverSource.includes("function taskRequirementConfig(task = {}, requirementIndex = 0)"));
  assert.ok(serverSource.includes("function taskFormalSession(task = {}, requirementIndex = 0)"));
  assert.ok(serverSource.includes("function paperFormBindState(task = {}, requirementIndex = 0)"));
  assert.ok(serverSource.includes("paperFormBinds[normalizedIndex] = next"));
  assert.ok(serverSource.includes("normalizeCourseRecords({ courses: taskCoursesForChange(task, requirementIndex) })"));
  assert.ok(serverSource.includes("runPaperFormBindForTask(task, login, { scheduled: true, requirementIndex })"));
});

test("paper binding scheduler retries failed checks every whole hour and stops after success", () => {
  const shouldAttemptSource = sourceBetween(
    "function shouldAttemptScheduledPaperBind",
    "async function runPaperFormBindForTask",
  );

  assert.ok(shouldAttemptSource.includes('current.status === "success" || current.status === "running"'));
  assert.equal(shouldAttemptSource.includes("shouldSkipFailedPaperBindCheckInCurrentHour"), false);
  assert.equal(serverSource.includes("shouldSkipFailedPaperBindCheckInCurrentHour"), false);
});

test("paper binding detail renders bound form codes and manual action", () => {
  assert.ok(serverSource.includes("paperFormBind"));
  const html = fs.readFileSync(path.join(rootDir, "outputs/web_prototype/easy_exam_automation.html"), "utf8");
  assert.ok(html.includes("buildPaperBindFeedback"));
  assert.ok(html.includes("buildCourseBindFeedback"));
  assert.ok(html.includes("已绑定试卷"));
  assert.ok(html.includes("考试科目"));
  assert.ok(html.includes("paper-bind-feedback success"));
  assert.ok(html.includes("course-bind-feedback success"));
  assert.ok(html.includes("paper-bind-label\">试卷名"));
  assert.ok(html.includes("paper-bind-label\">科目编号"));
  assert.equal(html.includes("paper-bind-label\">试卷编号"), false);
  assert.ok(html.includes("course-bind-label\">科目编号"));
  assert.ok(html.includes("course-bind-line course-bind-code-line"));
  assert.ok(html.includes('class="course-bind-code-value"'));
  assert.ok(html.includes(".course-bind-code-line .course-bind-label { flex: 0 0 auto; margin-right: 2px; white-space: nowrap; }"));
  assert.ok(html.includes(".course-bind-code-value { min-width: 0; font-size: 11px; white-space: nowrap; }"));
  assert.ok(html.includes(".course-bind-code-line .sms-copy-button { width: 22px; height: 22px; flex-basis: 22px; }"));
  assert.ok(html.includes('buildCourseCodeCopyButton(course.code || course.course_code || "")'));
  assert.ok(html.includes('data-copy-course-code="${safeText(courseCode)}"'));
  assert.ok(html.includes("data-trigger-step=\"paper_form_bind\""));
});
