import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  deployProductionRelease,
  normalizeReleaseId,
  parseProductionReleaseArgs,
  prepareProductionRelease,
  rollbackProductionRelease,
  validateReleaseBundle,
} from "../scripts/production_release.mjs";

const scope = ["server", "web", "outputs/web_prototype", "package.json"];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeApplication(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
}

function makeRelease(releaseId = "YKAI002", files = {
  "server/app.mjs": "new server\n",
  "web/app.mjs": "new web\n",
  "outputs/web_prototype/index.html": "new html\n",
  "package.json": "{}\n",
}) {
  const releaseDir = mkdtempSync(path.join(os.tmpdir(), "yikai-release-"));
  const appDir = path.join(releaseDir, "app");
  writeApplication(appDir, files);
  mkdirSync(path.join(releaseDir, "release"), { recursive: true });
  const manifest = Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, content]) => `${digest(content)}  ${relativePath}`)
    .join("\n");
  writeFileSync(path.join(releaseDir, "release", `${releaseId}.sha256`), `${manifest}\n`);
  writeFileSync(path.join(releaseDir, "release", `${releaseId}.json`), `${JSON.stringify({
    releaseId,
    serviceLabel: "com.chen.yikao-auto-config-web",
    applicationFileCount: Object.keys(files).length,
    manifest: `release/${releaseId}.sha256`,
    applicationScope: scope,
  })}\n`);
  return releaseDir;
}

test("prepare captures the running 8766 application into a verified versioned bundle", () => {
  const testAppDir = mkdtempSync(path.join(os.tmpdir(), "yikai-test-app-"));
  writeApplication(testAppDir, {
    "server/easy_exam_server.mjs": "server\n",
    "scripts/run_local_service.sh": "#!/bin/bash\n",
    "outputs/web_prototype/easy_exam_automation.html": "html\n",
    "package.json": "{}\n",
  });
  const releasesDir = mkdtempSync(path.join(os.tmpdir(), "yikai-releases-"));
  const result = prepareProductionRelease({
    releaseId: "YKAI002",
    confirm: "YKAI002",
    config: { testAppDir, releasesDir },
    inspectTestIdentity: () => ({ pid: 200, cwd: testAppDir, port: 8766, label: "test" }),
    testHealth: () => ({ ok: true }),
    now: new Date("2026-08-31T04:00:00Z"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.applicationFileCount, 4);
  assert.equal(validateReleaseBundle(result.releaseDir, "YKAI002").fileCount, 4);
  assert.equal(readFileSync(path.join(result.releaseDir, "app", "server", "easy_exam_server.mjs"), "utf8"), "server\n");
});

function makeProduction() {
  const root = mkdtempSync(path.join(os.tmpdir(), "yikai-production-"));
  writeApplication(root, {
    "server/app.mjs": "old server\n",
    "web/app.mjs": "old web\n",
    "outputs/web_prototype/index.html": "old html\n",
    "package.json": "{\"old\":true}\n",
  });
  mkdirSync(path.join(root, ".easy_exam_runtime"), { recursive: true });
  writeFileSync(path.join(root, ".easy_exam_runtime", "task_state.sqlite3"), "business-data\n");
  writeFileSync(path.join(root, ".env"), "SECRET=keep\n");
  return root;
}

function serviceDouble({ failFirstHealthAfterStart = false } = {}) {
  let starts = 0;
  let stops = 0;
  let healthCalls = 0;
  return {
    stop() { stops += 1; },
    start() { starts += 1; },
    health() {
      healthCalls += 1;
      if (failFirstHealthAfterStart && starts === 1 && healthCalls >= 2) throw new Error("new release unhealthy");
      return { ok: true };
    },
    counters() { return { starts, stops, healthCalls }; },
  };
}

function configFor(targetDir) {
  return {
    targetDir,
    backupsDir: mkdtempSync(path.join(os.tmpdir(), "yikai-deploy-backups-")),
  };
}

function identity(config) {
  return { pid: 100, cwd: config.targetDir, label: "test", port: 8765 };
}

function snapshotState() {
  return { ok: true, databaseCount: 2, configCount: 3 };
}

test("production release CLI requires exact action arguments and confirmation", () => {
  assert.deepEqual(parseProductionReleaseArgs(["preflight", "--release", "YKAI002"]), {
    action: "preflight",
    release: "YKAI002",
  });
  assert.throws(() => parseProductionReleaseArgs(["deploy", "--release", "YKAI002", "--unknown"]), /未知参数/);
  assert.throws(() => normalizeReleaseId("../../bad"), /版本号必须/);

  const releaseDir = makeRelease();
  const targetDir = makeProduction();
  assert.throws(() => deployProductionRelease({
    releaseDir,
    releaseId: "YKAI002",
    confirm: "",
    config: configFor(targetDir),
    service: serviceDouble(),
    inspectIdentity: identity,
    snapshotState,
  }), /未执行/);
  assert.equal(readFileSync(path.join(targetDir, "server/app.mjs"), "utf8"), "old server\n");
});

test("release bundle verification rejects tampering and files outside the allowlist", () => {
  const releaseDir = makeRelease();
  assert.equal(validateReleaseBundle(releaseDir, "YKAI002").fileCount, 4);
  writeFileSync(path.join(releaseDir, "app", "server", "app.mjs"), "tampered\n");
  assert.throws(() => validateReleaseBundle(releaseDir, "YKAI002"), /校验失败/);

  const extraReleaseDir = makeRelease("YKAI003", {
    "server/app.mjs": "server\n",
    ".env": "SECRET=bad\n",
  });
  assert.throws(() => validateReleaseBundle(extraReleaseDir, "YKAI003"), /超出发布范围/);
});

test("deployment replaces only application code and preserves production data and secrets", () => {
  const releaseDir = makeRelease();
  const targetDir = makeProduction();
  const config = configFor(targetDir);
  const service = serviceDouble();
  const result = deployProductionRelease({
    releaseDir,
    releaseId: "YKAI002",
    confirm: "YKAI002",
    config,
    service,
    inspectIdentity: identity,
    snapshotState,
    now: new Date("2026-08-31T04:05:06Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(readFileSync(path.join(targetDir, "server/app.mjs"), "utf8"), "new server\n");
  assert.equal(readFileSync(path.join(targetDir, ".easy_exam_runtime", "task_state.sqlite3"), "utf8"), "business-data\n");
  assert.equal(readFileSync(path.join(targetDir, ".env"), "utf8"), "SECRET=keep\n");
  assert.equal(readFileSync(path.join(result.backupDir, "app", "server", "app.mjs"), "utf8"), "old server\n");
  assert.deepEqual(service.counters(), { starts: 1, stops: 1, healthCalls: 2 });
});

test("failed deployment restores the previous application automatically", () => {
  const releaseDir = makeRelease();
  const targetDir = makeProduction();
  const config = configFor(targetDir);
  const service = serviceDouble({ failFirstHealthAfterStart: true });
  assert.throws(() => deployProductionRelease({
    releaseDir,
    releaseId: "YKAI002",
    confirm: "YKAI002",
    config,
    service,
    inspectIdentity: identity,
    snapshotState,
    now: new Date("2026-08-31T04:05:07Z"),
  }), /已自动恢复部署前代码/);
  assert.equal(readFileSync(path.join(targetDir, "server/app.mjs"), "utf8"), "old server\n");
  assert.equal(readFileSync(path.join(targetDir, ".easy_exam_runtime", "task_state.sqlite3"), "utf8"), "business-data\n");
  assert.deepEqual(service.counters(), { starts: 2, stops: 2, healthCalls: 3 });
});

test("manual rollback restores backup code while preserving newer business data", () => {
  const releaseDir = makeRelease();
  const targetDir = makeProduction();
  const config = configFor(targetDir);
  const deployResult = deployProductionRelease({
    releaseDir,
    releaseId: "YKAI002",
    confirm: "YKAI002",
    config,
    service: serviceDouble(),
    inspectIdentity: identity,
    snapshotState,
    now: new Date("2026-08-31T04:05:08Z"),
  });
  writeFileSync(path.join(targetDir, ".easy_exam_runtime", "task_state.sqlite3"), "newer-business-data\n");

  const rollback = rollbackProductionRelease({
    backupDir: deployResult.backupDir,
    backupId: deployResult.backupId,
    confirm: deployResult.backupId,
    config,
    service: serviceDouble(),
    inspectIdentity: identity,
    snapshotState,
    now: new Date("2026-08-31T04:05:09Z"),
  });
  assert.equal(rollback.ok, true);
  assert.equal(readFileSync(path.join(targetDir, "server/app.mjs"), "utf8"), "old server\n");
  assert.equal(readFileSync(path.join(targetDir, ".easy_exam_runtime", "task_state.sqlite3"), "utf8"), "newer-business-data\n");
});
