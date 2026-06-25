import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(rootDir, "server", "easy_exam_server.mjs"), "utf8");

test("server listen host can be configured for LAN deployment", () => {
  assert.ok(serverSource.includes("process.env.HOST"));
  assert.ok(serverSource.includes("server.listen(port, host"));
});

test("EasyExam account settings are stored per console user", () => {
  assert.ok(serverSource.includes('path.join(runtimeDir, "user_settings.json")'));
  assert.ok(serverSource.includes("saveUserLogin(state.userSettings, user"));
  assert.ok(serverSource.includes("currentUserLogin({"));
});

test("deleting a console user removes that user's EasyExam account settings", () => {
  assert.ok(serverSource.includes("delete state.userSettings.users[normalizeEmail(email)]"));
  assert.ok(serverSource.includes("await fs.writeFile(userSettingsPath, JSON.stringify(state.userSettings, null, 2), \"utf8\")"));
});

test("authenticated automation jobs use saved user settings instead of request overrides", () => {
  assert.ok(serverSource.includes("const storedLogin = getYikaoLoginForRequest(req);"));
  assert.ok(serverSource.includes("const login = auth.enabled ? storedLogin : { ...storedLogin, ...(payload.login || {}) };"));
});

test("session creation does not enable bluetooth blocking by default", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.equal(buildPayloads.includes("check_bluetooth: true"), false);
});

test("candidate import forwards optional course_code to EasyExam tenant API", () => {
  assert.ok(serverSource.includes("buildTenantCandidateEntries(candidates, customFieldMappings)"));
  assert.ok(serverSource.includes("candidate_tenant_payload.mjs"));
});

test("candidate import configures selected import fields as visible personal fields before importing", () => {
  assert.ok(serverSource.includes("const {"));
  assert.ok(serverSource.includes("selectedImportFields"));
  assert.ok(serverSource.includes("buildSelectedImportFields(payload?.field_mapping || {}, payload?.custom_fields || [])"));
  assert.ok(serverSource.includes("excludedPersonalSyncBaseKeys"));
  assert.ok(serverSource.includes("ensureSessionCustomPersonalFields(login, sessionId, selectedImportFields)"));
  assert.ok(serverSource.includes("syncImportPersonalFields"));
  const importHandler = serverSource.slice(serverSource.indexOf("async function handleCandidateImport"));
  assert.ok(importHandler.indexOf("ensureSessionCustomPersonalFields(login, sessionId, selectedImportFields)") < importHandler.indexOf("postCandidatesToTenant("));
  assert.ok(importHandler.indexOf("customFieldMappings") < importHandler.indexOf("postCandidatesToTenant("));
});

test("candidate personal field setup reads original session config and updates by PUT", () => {
  const setupFn = serverSource.slice(
    serverSource.indexOf("async function getTenantSessionDetail"),
    serverSource.indexOf("async function handleCandidateTemplate"),
  );
  assert.ok(setupFn.includes("getTenantSessionDetail(login, sessionId)"));
  assert.ok(setupFn.includes("获取原场次配置"));
  assert.ok(setupFn.includes("buildSessionPersonalPutPayload"));
  assert.ok(setupFn.includes('method: "PUT"'));
  assert.ok(setupFn.includes("场次信息项同步失败"));
});

test("candidate personal field setup builds PUT payload after merging personal fields", () => {
  const setupFn = serverSource.slice(
    serverSource.indexOf("async function ensureSessionCustomPersonalFields"),
    serverSource.indexOf("async function getSessionImportState"),
  );
  assert.ok(setupFn.indexOf("syncImportPersonalFields") < setupFn.indexOf("buildSessionPersonalPutPayload"));
  assert.ok(setupFn.indexOf("buildSessionPersonalPutPayload") < setupFn.indexOf('method: "PUT"'));
  assert.ok(setupFn.includes('method: "PUT"'));
  assert.ok(setupFn.includes("场次信息项同步失败"));
});
