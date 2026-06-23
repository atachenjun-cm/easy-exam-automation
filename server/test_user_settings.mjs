import assert from "node:assert/strict";
import test from "node:test";

import {
  currentUserLogin,
  defaultUserSettings,
  saveUserLogin,
  userSettingsKey,
} from "./user_settings.mjs";

const legacySettings = {
  login: {
    url: "https://eztest.org/manager/accounts/login",
    username: "legacy-admin",
    password: "legacy-pass",
    tenantApiKey: "legacy-key",
  },
};

test("stores EasyExam login settings separately for each console user", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "Alice@Example.com", role: "user" };
  const bob = { email: "bob@example.com", role: "user" };

  saveUserLogin(userSettings, alice, {
    url: "https://eztest.org/manager/accounts/login",
    username: "alice-yikao",
    password: "alice-pass",
    tenantApiKey: "alice-key",
  });
  saveUserLogin(userSettings, bob, {
    url: "https://eztest.org/manager/accounts/login",
    username: "bob-yikao",
    password: "bob-pass",
    tenantApiKey: "bob-key",
  });

  assert.equal(currentUserLogin({ user: alice, userSettings }).username, "alice-yikao");
  assert.equal(currentUserLogin({ user: bob, userSettings }).username, "bob-yikao");
  assert.equal(userSettings.users[userSettingsKey(alice)].login.tenantApiKey, "alice-key");
  assert.equal(userSettings.users[userSettingsKey(bob)].login.tenantApiKey, "bob-key");
});

test("coworkers do not see legacy global EasyExam login settings", () => {
  const userSettings = defaultUserSettings();
  const coworker = { email: "coworker@example.com", role: "user" };

  assert.deepEqual(currentUserLogin({ user: coworker, userSettings, legacySettings }), {
    url: "https://eztest.org/manager/accounts/login",
    username: "",
    password: "",
    tenantApiKey: "",
  });
});

test("admin can fall back to legacy global EasyExam login settings before saving personal settings", () => {
  const userSettings = defaultUserSettings();
  const admin = { email: "admin@example.com", role: "admin" };

  assert.deepEqual(currentUserLogin({ user: admin, userSettings, legacySettings }), legacySettings.login);
});

test("auth-disabled local mode keeps using global EasyExam login settings", () => {
  const userSettings = defaultUserSettings();

  assert.deepEqual(currentUserLogin({ user: { email: "" }, userSettings, legacySettings }), legacySettings.login);
});
