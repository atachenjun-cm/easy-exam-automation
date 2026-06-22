import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(rootDir, "outputs/web_prototype/easy_exam_automation.html"), "utf8");

test("hidden views cannot be overridden by component display styles", () => {
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test("navigation orders project management, exam list, then auto configuration", () => {
  const nav = html.slice(html.indexOf('<nav class="nav"'), html.indexOf("</nav>"));
  const projectIndex = nav.indexOf('id="projectNavBtn"');
  const examIndex = nav.indexOf('id="examNavBtn"');
  const autoIndex = nav.indexOf('id="autoNavItem"');
  assert.ok(projectIndex >= 0 && examIndex >= 0 && autoIndex >= 0);
  assert.ok(projectIndex < examIndex && examIndex < autoIndex);
});

test("URL page layout replaces shared showView content switching", () => {
  assert.ok(html.includes('import { createRouter } from "/web/router.mjs"'));
  assert.ok(html.includes("ProjectListPage({ root: projectManagementView"));
  assert.ok(html.includes("ExamListPage({ root: examListView"));
  assert.ok(html.includes("RequirementListPage({ root: requirementsView"));
  assert.ok(html.includes("RequirementDetailPage({ root: requirementDetailView"));
  assert.equal(html.includes("function showView"), false);
  assert.equal(html.includes("syncActiveNavByScroll"), false);
});

test("requirement center renders list and detail surfaces", () => {
  assert.ok(html.includes('id="requirementsList"'));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes('id="requirementMarkReadyBtn"'));
  assert.ok(html.includes('id="requirementLinkTaskBtn"'));
});

test("exam list is task-aggregated and exam detail owns dual session cards", () => {
  assert.ok(
    html.includes(
      'import { aggregateExamSessions, matchesExamTask, resolveCandidateTaskContext } from "/web/exam_task_view_model.mjs"',
    ),
  );
  assert.ok(html.includes('id="taskSessionCards"'));
  assert.ok(html.includes("data-candidate-task-id"));
  assert.equal(html.includes('id="examTypeFilter"'), false);
});

test("requirement center remains present while exam views change", () => {
  assert.ok(html.includes('id="requirementsView"'));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes("RequirementListPage({ root: requirementsView"));
  assert.ok(html.includes("RequirementDetailPage({ root: requirementDetailView"));
});

test("candidate page loads and preselects task-scoped sessions", () => {
  assert.ok(html.includes("async function loadCandidateTaskContext()"));
  assert.ok(html.includes("resolveCandidateTaskContext(task, sessionId)"));
  assert.ok(html.includes("loadContext: loadCandidateTaskContext"));
  assert.ok(html.includes("sessionSelect.value = String(candidateUiState.selectedSession.session_id)"));
});
