# Console User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-only coworker account management to the console.

**Architecture:** Extend `server/local_auth.mjs` with hashed coworker users and admin-aware sessions. Wire local JSON persistence and admin-only `/api/auth/users` routes into `server/easy_exam_server.mjs`, then add a `/users` route and page in the existing single HTML shell.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in `crypto`, existing HTML/CSS/ES module frontend.

---

## Task 1: Auth Store

**Files:** `server/local_auth.mjs`, `server/test_local_auth.mjs`

- [ ] Write failing tests for coworker password hashing, user login, disabled login rejection, role in session user, and `isAdminUser`.
- [ ] Run `node --test server/test_local_auth.mjs` and confirm the new tests fail.
- [ ] Implement `hashPassword`, `verifyPasswordHash`, `sanitizeUsers`, `upsertLocalUser`, `updateLocalUser`, `deleteLocalUser`, `verifyLogin` support for admin plus local users, `createSession(auth, user)`, `deleteSessionsForEmail`, and `isAdminUser`.
- [ ] Run `node --test server/test_local_auth.mjs` and confirm it passes.

## Task 2: Server User APIs

**Files:** `server/easy_exam_server.mjs`, `server/test_local_auth.mjs`

- [ ] Write tests for route protection helper behavior if needed.
- [ ] Add `authUsersPath = .easy_exam_runtime/auth_users.json`.
- [ ] Load coworker users at startup and save on changes.
- [ ] Add admin-only handlers:
  - `GET /api/auth/users`
  - `POST /api/auth/users`
  - `PATCH /api/auth/users/:email`
  - `DELETE /api/auth/users/:email`
- [ ] Return 403 for non-admin sessions.
- [ ] Clear sessions when disabling or deleting a user.
- [ ] Verify with curl against a temporary port.

## Task 3: Frontend Page

**Files:** `web/router.mjs`, `server/frontend_routes.mjs`, `web/pages/UserManagementPage.mjs`, `outputs/web_prototype/easy_exam_automation.html`, `server/test_app_router.mjs`, `server/test_ui_views.mjs`

- [ ] Write failing tests for `/users` routing and user management HTML markers.
- [ ] Add `/users` route and SPA fallback.
- [ ] Add sidebar `用户管理`, hidden for non-admin users.
- [ ] Add page markup with form, table, status text, and action buttons.
- [ ] Add JS functions to load, render, add/update, enable/disable, and delete users.
- [ ] Verify the route/UI tests pass.

## Task 4: Verification And Deployment

- [ ] Run Node deterministic tests excluding the real-Chrome time-only test:
  `node --test server/test_app_router.mjs server/test_course_session_binding.mjs server/test_exam_task_view_model.mjs server/test_page_boundaries.mjs server/test_requirement_request_api.mjs server/test_ui_views.mjs server/test_local_auth.mjs server/test_server_config.mjs`
- [ ] Run Python tests:
  `python3 -m unittest discover server -p 'test_*.py'`
- [ ] Sync tracked files to `/Users/chen/Library/Application Support/yikao-auto-config-web/`.
- [ ] Restart `com.chen.yikao-auto-config-web`.
- [ ] Verify with live HTTP:
  - Admin login succeeds.
  - Admin can create coworker.
  - Coworker login succeeds.
  - Disabled coworker login fails.
