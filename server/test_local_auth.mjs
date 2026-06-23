import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthContext,
  buildLoginCookie,
  buildLogoutCookie,
  parseCookies,
  shouldAllowWithoutAuth,
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

test("creates parses and clears session cookies", () => {
  const auth = buildAuthContext({
    env: { APP_LOGIN_EMAIL: "admin@example.com", APP_LOGIN_PASSWORD: "secret123" },
  });

  const cookie = buildLoginCookie(auth, "token-1");
  assert.match(cookie, /easy_exam_session=token-1/);
  assert.equal(parseCookies("easy_exam_session=token-1").easy_exam_session, "token-1");
  assert.match(buildLogoutCookie(auth), /Max-Age=0/);
});

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
