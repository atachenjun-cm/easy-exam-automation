# Project Shared Sheet Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent “项目共享大表” step before score processing, with a manual trigger that writes the formal session and the optional trial session to Tencent Docs.

**Architecture:** Extend the existing SQLite-backed step list with `project_shared_sheet`. Add a task-scoped POST handler that enforces task visibility, selects formal plus optional trial sessions, calls `syncExamConfigToTencentDocs`, and persists running/success/failed state. Render the new step from persisted data and invoke the endpoint from the existing exam-detail event delegation.

**Tech Stack:** Node.js ESM HTTP server, Python SQLite task store, vanilla HTML/CSS/JavaScript frontend, Node test runner, Python unittest.

---

### Task 1: Persist the new workflow step

**Files:**
- Modify: `server/task_state_db.py:10-22`
- Test: `server/test_task_state_db.py:60-82`

- [ ] **Step 1: Write the failing persistence test**

Add a test that creates a task, removes the step to simulate an old database row, reloads the task, and asserts that `project_shared_sheet` is restored before `score_process` with name `项目共享大表` and status `pending`.

- [ ] **Step 2: Run the persistence test and verify RED**

Run:

```bash
python3 -m unittest server/test_task_state_db.py
```

Expected: failure because `project_shared_sheet` does not exist.

- [ ] **Step 3: Add the step definition**

Insert:

```python
("project_shared_sheet", "项目共享大表"),
```

immediately before:

```python
("score_process", "成绩处理"),
```

- [ ] **Step 4: Run the persistence test and verify GREEN**

Run the same unittest command. Expected: pass.

### Task 2: Add the task-scoped shared-sheet trigger

**Files:**
- Modify: `server/easy_exam_server.mjs:2665-2795`
- Modify: `server/easy_exam_server.mjs:3035-3065`
- Test: `server/test_server_config.mjs:110-150`

- [ ] **Step 1: Write failing server-source tests**

Assert that the server contains:

```js
async function handleProjectSharedSheetFill(taskId, req, res)
```

and route:

```js
/api/tasks/:taskId/shared-sheet/fill
```

Assert the handler checks task visibility, reads `tencentDocsSettingsFromEnv(process.env)`, selects formal and optional trial sessions, calls `syncExamConfigToTencentDocs`, and updates `project_shared_sheet` to running/success/failed.

- [ ] **Step 2: Run the server test and verify RED**

```bash
node --test server/test_server_config.mjs
```

Expected: failure because the handler and route do not exist.

- [ ] **Step 3: Implement the minimal handler**

Add `handleProjectSharedSheetFill` that:

```js
const task = await runTaskState("get", { taskId });
if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
await updateTaskStep(taskId, "project_shared_sheet", "running", { message: "开始填写项目共享大表" });
```

Within `try`, require a formal session, include a trial session only when it has `session_id`, require enabled Tencent Docs settings, call:

```js
await syncExamConfigToTencentDocs({
  config: task.config || {},
  created: sessions,
  settings,
});
```

Persist success with `updatedRows`, session IDs, and readable logs. In `catch`, persist failed status with the error and return HTTP 500.

Add POST routing for:

```text
/api/tasks/[taskId]/shared-sheet/fill
```

- [ ] **Step 4: Run the server test and verify GREEN**

```bash
node --test server/test_server_config.mjs
```

Expected: pass.

### Task 3: Render the card and trigger button

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html:3075-3160`
- Modify: `outputs/web_prototype/easy_exam_automation.html:4980-5030`
- Test: `server/test_ui_views.mjs:165-190`

- [ ] **Step 1: Write failing UI tests**

Assert the HTML contains `项目共享大表`, `data-shared-sheet-fill`, `触发填写`, `重新填写`, and `/shared-sheet/fill`. Assert that `buildTaskDisplaySteps` pushes `project_shared_sheet` before `score_process`.

- [ ] **Step 2: Run the UI test and verify RED**

```bash
node --test server/test_ui_views.mjs
```

Expected: failure because the card and action are absent.

- [ ] **Step 3: Implement the card action and ordering**

Add `buildSharedSheetAction(task, step)` with labels:

```text
running -> 填写中
success -> 重新填写
other -> 触发填写
```

Disable the button while running. In `buildTaskDisplaySteps`, push the persisted `project_shared_sheet` step immediately before `score_process`.

Add delegated click handling that POSTs to:

```text
/api/tasks/[taskId]/shared-sheet/fill
```

then renders the returned task. On error, show the message and reload task detail.

- [ ] **Step 4: Run the UI test and verify GREEN**

```bash
node --test server/test_ui_views.mjs
```

Expected: pass.

### Task 4: Regression verification and deployment

**Files:**
- Modify: `WORKING_MEMORY.md`
- Deploy modified runtime files to `/Users/chen/Library/Application Support/yikao-auto-config-web`

- [ ] **Step 1: Run focused and full tests**

```bash
python3 -m unittest server/test_task_state_db.py
node --test server/test_server_config.mjs server/test_ui_views.mjs server/test_tencent_docs_sync.mjs
node --test server/test_*.mjs
python3 -m unittest discover -s server -p 'test_*.py'
git diff --check
```

Expected: all tests pass and no whitespace errors.

- [ ] **Step 2: Synchronize only changed runtime files**

Copy the modified server, frontend, and test-independent runtime files to the deployment directory without touching `.env` or `.easy_exam_runtime`.

- [ ] **Step 3: Restart and verify the service**

```bash
launchctl kickstart -k gui/$(id -u)/com.chen.yikao-auto-config-web
curl -sS http://127.0.0.1:8765/api/health
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Browser verification**

Open an exam detail page and confirm that “项目共享大表” appears immediately before “成绩处理”, shows “触发填写”, changes to running during the request, and becomes success or failed with logs.

- [ ] **Step 5: Update handoff memory**

Mark the card, route, status persistence, deployment, and verification results in `WORKING_MEMORY.md`. Keep the Tencent Docs dropdown-validation limitation listed separately until that issue is actually solved.
