# Exam List, Detail, and Candidate Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregate exam sessions by task, show formal and trial sessions together on task details, and open the existing candidate workflow with task-scoped session context.

**Architecture:** Add a small pure view-model module for grouping sessions, deriving status, searching tasks, and resolving candidate context. Keep DOM rendering and navigation in the existing HTML controller, and let `CandidateImportPage` invoke an injected entry callback. Existing APIs and requirement-center code remain unchanged.

**Tech Stack:** Native ES modules, browser DOM APIs, Node.js test runner, existing Node/Python service.

---

### Task 1: Pure Exam Task View Model

**Files:**
- Create: `web/exam_task_view_model.mjs`
- Create: `server/test_exam_task_view_model.mjs`

- [ ] **Step 1: Write failing aggregation and context tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateExamSessions,
  matchesExamTask,
  resolveCandidateTaskContext,
} from "../web/exam_task_view_model.mjs";

const sessions = [
  { taskId: "task-1", projectName: "考试甲", sourceAccount: "account-a", sessionType: "formal", session_id: "1001", name: "考试甲", status: "success" },
  { taskId: "task-1", projectName: "考试甲", sourceAccount: "account-a", sessionType: "trial", session_id: "1002", name: "考试甲-试考", status: "running" },
  { taskId: "task-2", projectName: "考试甲", sourceAccount: "account-b", sessionType: "formal", session_id: "2001", name: "考试甲", status: "failed" },
];

test("aggregates formal and trial sessions by taskId instead of exam name", () => {
  const tasks = aggregateExamSessions(sessions);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].formalSession.session_id, "1001");
  assert.equal(tasks[0].trialSession.session_id, "1002");
  assert.equal(tasks[0].status, "running");
  assert.equal(tasks[1].status, "failed");
});

test("searches all task and session identifiers", () => {
  const task = aggregateExamSessions(sessions)[0];
  assert.equal(matchesExamTask(task, "1002"), true);
  assert.equal(matchesExamTask(task, "account-a"), true);
  assert.equal(matchesExamTask(task, "不存在"), false);
});

test("resolves both task sessions and selects only a valid requested session", () => {
  const task = { sessions: sessions.filter((item) => item.taskId === "task-1") };
  const valid = resolveCandidateTaskContext(task, "1002");
  assert.equal(valid.sessions.length, 2);
  assert.equal(valid.selectedSession.session_id, "1002");
  assert.equal(resolveCandidateTaskContext(task, "other").selectedSession, null);
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_exam_task_view_model.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/exam_task_view_model.mjs`.

- [ ] **Step 3: Implement the pure view model**

```js
const STATUS_PRIORITY = {
  failed: 5,
  running: 4,
  waiting_manual: 3,
  success: 2,
  pending: 1,
};

function aggregateStatus(sessions) {
  const statuses = sessions.map((session) => session.status || "pending");
  if (sessions.length && statuses.every((status) => status === "success")) return "success";
  return statuses.reduce((selected, status) =>
    (STATUS_PRIORITY[status] || 1) > (STATUS_PRIORITY[selected] || 1) ? status : selected,
  "pending");
}

export function aggregateExamSessions(sessions = []) {
  const tasks = new Map();
  for (const session of sessions) {
    if (!session?.taskId) continue;
    if (!tasks.has(session.taskId)) {
      tasks.set(session.taskId, {
        taskId: session.taskId,
        projectName: session.projectName || session.name || "未命名考试",
        sourceAccount: session.sourceAccount || "",
        sessions: [],
      });
    }
    tasks.get(session.taskId).sessions.push(session);
  }
  return [...tasks.values()].map((task) => ({
    ...task,
    formalSession: task.sessions.find((session) => session.sessionType === "formal") || null,
    trialSession: task.sessions.find((session) => session.sessionType === "trial") || null,
    status: aggregateStatus(task.sessions),
  }));
}

export function matchesExamTask(task, query = "") {
  const normalized = String(query).trim().toLowerCase();
  if (!normalized) return true;
  return [task.projectName, task.sourceAccount, ...task.sessions.flatMap((session) => [session.name, session.session_id])]
    .some((value) => String(value || "").toLowerCase().includes(normalized));
}

export function resolveCandidateTaskContext(task, requestedSessionId = "") {
  const sessions = (task?.sessions || []).filter((session) =>
    ["formal", "trial"].includes(session.sessionType) && String(session.session_id || "").trim(),
  );
  const selectedSession = sessions.find((session) => String(session.session_id) === String(requestedSessionId)) || null;
  return { sessions, selectedSession };
}
```

- [ ] **Step 4: Run the view-model tests**

Run the Step 2 command again.

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit the view model**

```bash
git add web/exam_task_view_model.mjs server/test_exam_task_view_model.mjs
git commit -m "feat: aggregate exam sessions by task"
```

### Task 2: Aggregated List and Dual Session Cards

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_ui_views.mjs`

- [ ] **Step 1: Add failing HTML boundary tests**

```js
test("exam list is task-aggregated and exam detail owns dual session cards", () => {
  assert.ok(html.includes('import { aggregateExamSessions, matchesExamTask, resolveCandidateTaskContext } from "/web/exam_task_view_model.mjs"'));
  assert.ok(html.includes('id="taskSessionCards"'));
  assert.ok(html.includes('data-candidate-task-id'));
  assert.equal(html.includes('id="examTypeFilter"'), false);
});

test("requirement center remains present while exam views change", () => {
  assert.ok(html.includes('id="requirementsView"'));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes('RequirementListPage({ root: requirementsView'));
  assert.ok(html.includes('RequirementDetailPage({ root: requirementDetailView'));
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL because `taskSessionCards` and the view-model import are absent.

- [ ] **Step 3: Replace the exam list markup and render grouped rows**

Import the view-model functions and change the exam list to columns `考试名称`, `正式考试`, `试考`, `来源账号`, `考生数`, `班级数`, `状态`, `操作`. Remove the type select and its listener. Render rows from:

```js
const exams = aggregateExamSessions(taskViewState.sessions)
  .filter((task) => matchesExamTask(task, examSearchInput.value));
```

Use `projectName` as the clickable task name and navigate with its `taskId`. Each formal/trial cell renders the session name, `session_id`, and start/end time or `尚未创建`.

- [ ] **Step 4: Replace the detail session table with two session cards**

Render formal and trial slots in a responsive `task-session-grid`:

```js
const sessionByType = new Map((task.sessions || []).map((session) => [session.sessionType, session]));
taskSessionCards.innerHTML = ["formal", "trial"].map((sessionType) => {
  const session = sessionByType.get(sessionType);
  if (!session) return `<article class="task-session-card empty"><h3>${sessionType === "formal" ? "正式考试" : "试考"}</h3><div>尚未创建</div></article>`;
  return `<article class="task-session-card">
    <h3>${sessionType === "formal" ? "正式考试" : "试考"}</h3>
    <div>${safeText(session.name)}</div>
    <div>session_id：${safeText(session.session_id || "--")}</div>
    <div>${safeText(session.start || "--")} ~ ${safeText(session.end || "--")}</div>
    <div>考生 ${Number(session.candidateCount || 0)} · 班级 ${Number(session.roomCount || 0)}</div>
    ${statusChip(session.status)}
    <button class="btn" data-candidate-task-id="${safeText(task.taskId)}" data-session-id="${safeText(session.session_id)}" ${session.session_id ? "" : "disabled"}>管理考生</button>
  </article>`;
}).join("");
```

The delegated click handler navigates to `/candidate-import?taskId=...&sessionId=...`.

- [ ] **Step 5: Run UI and pure tests**

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs server/test_exam_task_view_model.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Commit list and detail UI**

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "feat: show exam tasks with dual session details"
```

### Task 3: Task-Scoped Candidate Context

**Files:**
- Modify: `web/pages/CandidateImportPage.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_page_boundaries.mjs`

- [ ] **Step 1: Write a failing candidate page lifecycle test**

```js
import { CandidateImportPage } from "../web/pages/CandidateImportPage.mjs";

test("CandidateImportPage loads task context when entering the route", async () => {
  let entered = 0;
  const root = {};
  const page = CandidateImportPage({ root, loadContext: async () => { entered += 1; } });
  await page.enter();
  assert.equal(entered, 1);
});
```

- [ ] **Step 2: Run the boundary test and verify it fails**

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_page_boundaries.mjs
```

Expected: FAIL because `CandidateImportPage` ignores `loadContext`.

- [ ] **Step 3: Inject the candidate entry callback**

```js
export function CandidateImportPage({ root, loadContext = async () => {} }) {
  return { name: "candidate-import", roots: [root], enter: () => loadContext() };
}
```

- [ ] **Step 4: Load task sessions from query parameters**

In the HTML controller, add `loadCandidateTaskContext()` that reads `window.location.search`. With no `taskId`, leave the standalone page unchanged. With a `taskId`, fetch `/api/tasks/:taskId`, call `resolveCandidateTaskContext(task, sessionId)`, update `candidateUiState.sessions` and `candidateUiState.selectedSession`, and invoke existing `renderSessions()` and `renderSelectedSession()` functions. On failure, log the error and retain the manual “加载未过期场次” button.

Wire the page with:

```js
CandidateImportPage({ root: candidateImportPanel, loadContext: loadCandidateTaskContext })
```

- [ ] **Step 5: Run focused regression tests**

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_exam_task_view_model.mjs server/test_ui_views.mjs server/test_page_boundaries.mjs server/test_app_router.mjs
```

Expected: all tests pass, including requirement-center route cases.

- [ ] **Step 6: Commit candidate context entry**

```bash
git add web/pages/CandidateImportPage.mjs outputs/web_prototype/easy_exam_automation.html server/test_page_boundaries.mjs
git commit -m "feat: preselect task sessions for candidate management"
```

### Task 4: Full Verification and Deployment

**Files:**
- Verify only: protected requirement-center files
- Deploy tracked files to: `/Users/chen/Library/Application Support/yikao-auto-config-web/`

- [ ] **Step 1: Verify protected files did not change**

```bash
git diff origin/main --name-only | rg 'requirement_request|Requirement(List|Detail)Page' && exit 1 || true
```

Expected: no protected requirement-center implementation files are listed.

- [ ] **Step 2: Run all deterministic tests**

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_app_router.mjs server/test_course_session_binding.mjs server/test_exam_task_view_model.mjs server/test_page_boundaries.mjs server/test_requirement_request_api.mjs server/test_ui_views.mjs
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: both commands exit 0 with no failed tests.

- [ ] **Step 3: Sync tracked files and restart the service**

```bash
git ls-files -z | rsync -av --from0 --files-from=- "/Users/chen/Desktop/ai 易考/" "/Users/chen/Library/Application Support/yikao-auto-config-web/"
launchctl kickstart -k "gui/$(id -u)/com.chen.yikao-auto-config-web"
```

- [ ] **Step 4: Verify deployed routes**

```bash
curl -fsS http://127.0.0.1:8765/api/health
curl -fsS http://127.0.0.1:8765/exams | rg 'taskSessionCards|RequirementListPage'
curl -fsS http://127.0.0.1:8765/api/requirements
```

Expected: health is `{"ok":true}`, the deployed HTML contains both exam and requirement markers, and the requirement API returns JSON.
