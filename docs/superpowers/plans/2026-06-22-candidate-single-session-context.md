# Candidate Single-Session Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the candidate-management session selector contain only the session chosen from exam details.

**Architecture:** Change the existing pure context resolver so a valid requested `sessionId` produces a one-element session list. Keep page rendering and all candidate import APIs unchanged; update only the task-context log text.

**Tech Stack:** Native ES modules, Node.js test runner, existing browser UI.

---

### Task 1: Filter Candidate Context to the Requested Session

**Files:**
- Modify: `server/test_exam_task_view_model.mjs`
- Modify: `web/exam_task_view_model.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`

- [ ] **Step 1: Change the existing context test to require one session**

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_exam_task_view_model.mjs
```

Expected: FAIL because the resolver returns both `1001` and `1002`.

- [ ] **Step 3: Implement the minimal single-session resolver**

```js
export function resolveCandidateTaskContext(task, requestedSessionId = "") {
  const selectedSession = (task?.sessions || []).find(
    (session) =>
      ["formal", "trial"].includes(session.sessionType) &&
      String(session.session_id || "").trim() &&
      String(session.session_id) === String(requestedSessionId),
  ) || null;
  return {
    sessions: selectedSession ? [selectedSession] : [],
    selectedSession,
  };
}
```

- [ ] **Step 4: Update task-context log wording**

Replace the success log with:

```js
candidateLog(
  `[场次选择] 已带入目标考试场次，共 ${context.sessions.length} 个场次${selectionMessage}`,
  context.sessions.length ? "success" : "warn",
);
```

- [ ] **Step 5: Run focused and full regression tests**

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_exam_task_view_model.mjs server/test_ui_views.mjs server/test_page_boundaries.mjs server/test_app_router.mjs server/test_requirement_request_api.mjs
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: all tests pass with no failed tests.

- [ ] **Step 6: Commit the fix**

```bash
git add server/test_exam_task_view_model.mjs web/exam_task_view_model.mjs outputs/web_prototype/easy_exam_automation.html
git commit -m "fix: scope candidate management to one session"
```

### Task 2: Deploy and Verify

**Files:**
- Deploy tracked files to: `/Users/chen/Library/Application Support/yikao-auto-config-web/`

- [ ] **Step 1: Verify requirement-center implementation files are unchanged**

```bash
git diff origin/main --name-only | rg 'server/requirement_request|web/pages/Requirement(List|Detail)Page|server/test_requirement_request' && exit 1 || true
```

Expected: no protected requirement-center implementation files are listed.

- [ ] **Step 2: Sync and restart**

```bash
git ls-files -z | rsync -av --from0 --files-from=- "/Users/chen/Desktop/ai 易考/" "/Users/chen/Library/Application Support/yikao-auto-config-web/"
launchctl kickstart -k "gui/$(id -u)/com.chen.yikao-auto-config-web"
```

- [ ] **Step 3: Verify both entry points in the browser**

Open formal and trial “管理考生” buttons separately. The selector must contain one task option, and its `session_id` must match the clicked card. `/api/requirements` must still return JSON.
