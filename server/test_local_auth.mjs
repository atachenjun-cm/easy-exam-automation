import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthContext,
  buildLoginCookie,
  buildLogoutCookie,
  createSession,
  deleteLocalUser,
  deleteSessionsForEmail,
  hashPassword,
  isAdminUser,
  parseCookies,
  shouldAllowWithoutAuth,
  sanitizeUsers,
  updateLocalUser,
  upsertLocalUser,
  verifyPasswordHash,
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
  assert.deepEqual(await verifyLogin(auth, "admin@example.com", "secret123"), {
    email: "admin@example.com",
    role: "admin",
  });
  assert.equal(await verifyLogin(auth, "admin@example.com", "bad"), null);
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

test("stores coworker users with salted password hashes", async () => {
  const auth = buildAuthContext({
    env: { APP_LOGIN_EMAIL: "admin@example.com", APP_LOGIN_PASSWORD: "secret123" },
  });

  const user = upsertLocalUser(auth, { email: "coworker@example.com", password: "temp1234" });

  assert.equal(user.email, "coworker@example.com");
  assert.equal(user.role, "user");
  assert.equal(user.disabled, false);
  assert.notEqual(user.passwordHash, "temp1234");
  assert.equal(await verifyPasswordHash("temp1234", user.passwordSalt, user.passwordHash), true);
  assert.deepEqual(await verifyLogin(auth, "coworker@example.com", "temp1234"), {
    email: "coworker@example.com",
    role: "user",
  });
});

test("disabled coworker users cannot login", async () => {
  const auth = buildAuthContext({
    env: { APP_LOGIN_EMAIL: "admin@example.com", APP_LOGIN_PASSWORD: "secret123" },
  });
  upsertLocalUser(auth, { email: "coworker@example.com", password: "temp1234" });
  updateLocalUser(auth, "coworker@example.com", { disabled: true });

  assert.equal(await verifyLogin(auth, "coworker@example.com", "temp1234"), null);
  assert.equal(sanitizeUsers(auth.users)[0].passwordHash, undefined);
});

test("sessions include roles and can be cleared by email", () => {
  const auth = buildAuthContext({
    env: { APP_LOGIN_EMAIL: "admin@example.com", APP_LOGIN_PASSWORD: "secret123" },
  });

  const adminSession = createSession(auth, { email: "admin@example.com", role: "admin" });
  const userSession = createSession(auth, { email: "coworker@example.com", role: "user" });

  assert.equal(isAdminUser(adminSession.user), true);
  assert.equal(isAdminUser(userSession.user), false);
  deleteSessionsForEmail(auth, "coworker@example.com");
  assert.equal(auth.sessions.has(userSession.token), false);
  assert.equal(auth.sessions.has(adminSession.token), true);
});

test("local users can be deleted", () => {
  const auth = buildAuthContext({
    env: { APP_LOGIN_EMAIL: "admin@example.com", APP_LOGIN_PASSWORD: "secret123" },
  });
  upsertLocalUser(auth, { email: "coworker@example.com", password: "temp1234" });

  assert.equal(deleteLocalUser(auth, "coworker@example.com"), true);
  assert.deepEqual(sanitizeUsers(auth.users), []);
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
