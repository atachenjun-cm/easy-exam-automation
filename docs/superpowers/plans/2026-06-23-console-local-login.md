# Console Local Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local email/password login gate for the easy exam automation console.

**Architecture:** Put credential parsing, cookie creation, and session validation in a small server auth module. Wire the module into `easy_exam_server.mjs` before existing API handlers, and add a `/login` client route using the current single-page HTML shell and router.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in `crypto`, existing HTML/CSS/ES module frontend.

---

## File Structure

- Create: `server/local_auth.mjs`
  - Pure helpers for config loading, password comparison, session token generation, cookie parsing, login response cookies, and route protection decisions.
- Modify: `server/easy_exam_server.mjs`
  - Initialize local auth, add `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, and guard protected API/frontend routes.
- Modify: `server/frontend_routes.mjs`
  - Add `/login` to SPA fallback route list.
- Modify: `web/router.mjs`
  - Add `login` route and keep authenticated default redirect to `/projects`.
- Create: `web/pages/LoginPage.mjs`
  - Small page object matching existing page module pattern.
- Modify: `outputs/web_prototype/easy_exam_automation.html`
  - Add login markup/styles, auth state wiring, logout button, and auth bootstrap.
- Create: `server/test_local_auth.mjs`
  - Unit tests for auth helpers.
- Modify: `server/test_app_router.mjs`
  - Route coverage for `/login`.
- Modify: `server/test_ui_views.mjs`
  - HTML markers for login form, logout button, and auth bootstrap.

## Task 1: Auth Helper Module

**Files:**
- Create: `server/local_auth.mjs`
- Test: `server/test_local_auth.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that verify:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthContext,
  buildLoginCookie,
  buildLogoutCookie,
  parseCookies,
  verifyLogin,
} from "./local_auth.mjs";

test("auth is disabled without both configured credentials", () => {
  const auth = buildAuthContext({ env: { APP_LOGIN_EMAIL: "admin@example.com" } });
  assert.equal(auth.enabled, false);
});

test("verifies configured email and password exactly", async () => {
  const auth = buildAuthContext({
    env: { APP_LOGIN_EMAIL: "admin@example.com", APP_LOGIN_PASSWORD: "secret123" },
  });
  assert.equal(auth.enabled, true);
  assert.equal(await verifyLogin(auth, "admin@example.com", "secret123"), true);
  assert.equal(await verifyLogin(auth, "admin@example.com", "bad"), false);
});

test("creates, parses, and clears session cookies", () => {
  const auth = buildAuthContext({
    env: { APP_LOGIN_EMAIL: "admin@example.com", APP_LOGIN_PASSWORD: "secret123" },
  });
  const cookie = buildLoginCookie(auth, "token-1");
  assert.match(cookie, /easy_exam_session=token-1/);
  assert.equal(parseCookies("easy_exam_session=token-1").easy_exam_session, "token-1");
  assert.match(buildLogoutCookie(auth), /Max-Age=0/);
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
node --test server/test_local_auth.mjs
```

Expected: fail because `server/local_auth.mjs` does not exist.

- [ ] **Step 3: Implement helper**

Implement only the functions under test plus an in-memory session map:

```js
import { randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "easy_exam_session";

export function buildAuthContext({ env = process.env, localConfig = {} } = {}) {
  const email = String(localConfig.email || env.APP_LOGIN_EMAIL || "").trim();
  const password = String(localConfig.password || env.APP_LOGIN_PASSWORD || "");
  return {
    enabled: Boolean(email && password),
    email,
    password,
    sessions: new Map(),
    cookieName: SESSION_COOKIE,
  };
}
```

Complete helpers for `verifyLogin`, `createSession`, `getSessionUser`, `deleteSession`, `parseCookies`, `buildLoginCookie`, and `buildLogoutCookie`.

- [ ] **Step 4: Verify green**

Run:

```bash
node --test server/test_local_auth.mjs
```

Expected: pass.

## Task 2: Server Auth Endpoints And Guards

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Test: `server/test_local_auth.mjs`

- [ ] **Step 1: Add failing route-decision tests**

Extend `server/test_local_auth.mjs` with tests for:

```js
import { shouldAllowWithoutAuth } from "./local_auth.mjs";

test("allows login health and frontend module routes without auth", () => {
  assert.equal(shouldAllowWithoutAuth("GET", "/login"), true);
  assert.equal(shouldAllowWithoutAuth("POST", "/api/auth/login"), true);
  assert.equal(shouldAllowWithoutAuth("GET", "/api/health"), true);
  assert.equal(shouldAllowWithoutAuth("GET", "/web/router.mjs"), true);
});

test("protects business API routes when auth is enabled", () => {
  assert.equal(shouldAllowWithoutAuth("GET", "/api/tasks"), false);
  assert.equal(shouldAllowWithoutAuth("POST", "/api/jobs"), false);
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
node --test server/test_local_auth.mjs
```

Expected: fail because `shouldAllowWithoutAuth` is not implemented.

- [ ] **Step 3: Implement route guard helpers and wire server**

Add `shouldAllowWithoutAuth`, initialize `const auth = buildAuthContext(...)` in `easy_exam_server.mjs`, and guard requests before existing business handlers:

- If auth disabled, continue.
- If allowed public path, continue.
- If valid session cookie, continue.
- If frontend route, redirect to `/login?next=<path>`.
- Otherwise return `401` JSON.

Add handlers for:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

- [ ] **Step 4: Verify server helper tests**

Run:

```bash
node --test server/test_local_auth.mjs
```

Expected: pass.

## Task 3: Login Route And UI

**Files:**
- Modify: `server/frontend_routes.mjs`
- Modify: `web/router.mjs`
- Create: `web/pages/LoginPage.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_app_router.mjs`
- Test: `server/test_ui_views.mjs`

- [ ] **Step 1: Write failing UI and route tests**

Update tests to expect:

- `matchRoute("/login").name === "login"`
- `isFrontendRoute("/login") === true`
- HTML contains `id="loginView"`, `id="loginEmailInput"`, `id="loginPasswordInput"`, `id="logoutBtn"`, and `AuthController`.

- [ ] **Step 2: Verify red**

Run:

```bash
node --test server/test_app_router.mjs server/test_ui_views.mjs
```

Expected: fail because `/login` and login markup do not exist.

- [ ] **Step 3: Implement UI**

Add a hidden login root before the app shell. The login page:

- Uses existing colors and form styles.
- Submits to `/api/auth/login`.
- Navigates to `next` query param or `/projects`.
- Calls `/api/auth/me` during boot.
- Shows authenticated email in sidebar.
- Logs out with `/api/auth/logout`.

- [ ] **Step 4: Verify UI tests**

Run:

```bash
node --test server/test_app_router.mjs server/test_ui_views.mjs
```

Expected: pass.

## Task 4: Full Verification And Deployment

**Files:**
- Runtime deployment copy only.

- [ ] **Step 1: Run full deterministic tests**

Run:

```bash
node --test server/test_*.mjs
python3 -m unittest discover server -p 'test_*.py'
```

Expected: all tests pass.

- [ ] **Step 2: Deploy tracked files to local service directory**

Run:

```bash
git ls-files -z | rsync -av --from0 --files-from=- "/Users/chen/Desktop/ai 易考/" "/Users/chen/Library/Application Support/yikao-auto-config-web/"
launchctl kickstart -k "gui/$(id -u)/com.chen.yikao-auto-config-web"
```

- [ ] **Step 3: Verify live service**

Run:

```bash
curl -fsS http://127.0.0.1:8765/api/health
curl -i http://127.0.0.1:8765/projects
```

Expected:

- Health returns `{"ok":true}`.
- If auth is configured, `/projects` redirects to `/login`.
- If auth is not configured yet, `/projects` serves the console for backwards compatibility.

## Self-Review

- The plan does not modify requirement center files.
- The plan keeps exam automation and tenant API business handlers intact.
- The plan uses TDD for helper behavior and UI route markers.
- The plan keeps authentication local and minimal.
