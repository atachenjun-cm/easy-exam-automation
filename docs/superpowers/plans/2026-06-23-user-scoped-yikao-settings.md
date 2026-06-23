# User Scoped Yikao Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store and use each console user's EasyExam account settings independently so coworkers cannot view or overwrite each other's credentials.

**Architecture:** Add a `user_settings.json` runtime file keyed by normalized login email. Existing global `settings.json` remains only for legacy admin fallback and auth-disabled local mode. All authenticated EasyExam API and job paths resolve login settings from the current request user.

**Tech Stack:** Node.js built-in HTTP server, local JSON runtime files, existing `node:test` tests.

---

### Task 1: User Settings Helpers

**Files:**
- Create: `server/user_settings.mjs`
- Test: `server/test_user_settings.mjs`

- [ ] Write failing tests for isolated user settings, admin legacy fallback, and coworker no-fallback behavior.
- [ ] Implement helper functions for normalized user ids, login sanitization, per-user read/write, and legacy fallback.
- [ ] Run `node --test server/test_user_settings.mjs`.

### Task 2: Server Integration

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/test_server_config.mjs`

- [ ] Load and save `.easy_exam_runtime/user_settings.json`.
- [ ] Change `/api/settings` GET/POST to current-user-scoped login settings.
- [ ] Change import task `sourceAccount`, job creation, sessions, candidate import, room preview/auto, and paper-bind retry to resolve the current user's EasyExam login.
- [ ] Ignore authenticated `/api/jobs` `payload.login` overrides so automation uses the saved account for the current login user.
- [ ] Keep auth-disabled mode using existing global settings for local compatibility.

### Task 3: Verify And Deploy

**Files:**
- Modify only files from Task 1 and Task 2.

- [ ] Run focused Node tests.
- [ ] Run full deterministic Node and Python test suites.
- [ ] Commit the scoped settings change.
- [ ] Deploy to the LaunchAgent service directory and restart.
- [ ] Verify through live HTTP calls that two users save different EasyExam accounts and read back only their own values.
