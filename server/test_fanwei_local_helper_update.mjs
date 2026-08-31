import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyStagedFanweiHelperUpdate,
  FanweiHelperUpdateError,
  markFanweiHelperUpdateVerified,
  runFanweiHelperUpdate,
  validateFanweiHelperUpdateRequest,
} from "./fanwei_local_helper_update.mjs";

const allowedOrigin = "http://172.16.13.214:8765";
const token = "a".repeat(64);

function updatePayload(overrides = {}) {
  return {
    version: 10,
    packageUrl: `${allowedOrigin}/api/fanwei/helper-update-package?token=${token}`,
    sha256: "b".repeat(64),
    ...overrides,
  };
}

test("update request only accepts a newer version and a one-time package URL from an allowed console", () => {
  assert.deepEqual(validateFanweiHelperUpdateRequest(updatePayload(), {
    allowedOrigins: [allowedOrigin],
    currentVersion: 9,
  }), {
    targetVersion: 10,
    packageUrl: `${allowedOrigin}/api/fanwei/helper-update-package?token=${token}`,
    sha256: "b".repeat(64),
  });

  assert.throws(
    () => validateFanweiHelperUpdateRequest(updatePayload({ version: 9 }), {
      allowedOrigins: [allowedOrigin],
      currentVersion: 9,
    }),
    (error) => error instanceof FanweiHelperUpdateError && error.code === "helper_update_not_newer",
  );
  assert.throws(
    () => validateFanweiHelperUpdateRequest(updatePayload({
      packageUrl: `http://attacker.example/api/fanwei/helper-update-package?token=${token}`,
    }), {
      allowedOrigins: [allowedOrigin],
      currentVersion: 9,
    }),
    (error) => error instanceof FanweiHelperUpdateError && error.code === "helper_update_url_forbidden",
  );
  assert.throws(
    () => validateFanweiHelperUpdateRequest(updatePayload({
      packageUrl: `${allowedOrigin}/api/fanwei/helper-installer?token=${token}`,
    }), {
      allowedOrigins: [allowedOrigin],
      currentVersion: 9,
    }),
    (error) => error instanceof FanweiHelperUpdateError && error.code === "helper_update_url_forbidden",
  );
});

async function writeStagedPackage(packageDir, { version = 10, platform = "darwin-arm64" } = {}) {
  const serverDir = path.join(packageDir, "server");
  await mkdir(serverDir, { recursive: true });
  await writeFile(path.join(packageDir, "helper-package.json"), JSON.stringify({
    schemaVersion: 1,
    helperVersion: version,
    platform,
    updateStrategy: "server-files-v1",
  }));
  for (const fileName of [
    "fanwei_local_helper_cli.mjs",
    "fanwei_local_helper.mjs",
    "fanwei_local_helper_update.mjs",
    "fanwei_local_helper_version.mjs",
  ]) {
    await writeFile(path.join(serverDir, fileName), `new ${fileName}\n`);
  }
  await writeFile(path.join(packageDir, "install-macos.command"), "new installer\n");
}

test("staged update atomically replaces helper code while preserving config, Chrome profile, and logs", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-update-apply-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const runtimeDir = path.join(tempRoot, "runtime");
  const packageDir = path.join(tempRoot, "package");
  await mkdir(path.join(runtimeDir, "server"), { recursive: true });
  await mkdir(path.join(runtimeDir, "chrome-fanwei-profile"), { recursive: true });
  await writeFile(path.join(runtimeDir, "server", "old-helper.mjs"), "old helper\n");
  await writeFile(path.join(runtimeDir, "config.env"), "YIKAO_CONSOLE_ORIGINS=http://console\n");
  await writeFile(path.join(runtimeDir, "chrome-fanwei-profile", "Cookies"), "login-state\n");
  await writeFile(path.join(runtimeDir, "helper.log"), "existing log\n");
  await writeStagedPackage(packageDir);

  const result = await applyStagedFanweiHelperUpdate({
    runtimeDir,
    packageDir,
    platform: "darwin",
    arch: "arm64",
    currentVersion: 9,
    targetVersion: 10,
  });

  assert.equal(result.fromVersion, 9);
  assert.equal(result.toVersion, 10);
  assert.equal(await readFile(path.join(runtimeDir, "server", "fanwei_local_helper.mjs"), "utf8"), "new fanwei_local_helper.mjs\n");
  await assert.rejects(access(path.join(runtimeDir, "server", "old-helper.mjs")));
  assert.equal(await readFile(path.join(result.backupServerDir, "old-helper.mjs"), "utf8"), "old helper\n");
  assert.equal(await readFile(path.join(runtimeDir, "config.env"), "utf8"), "YIKAO_CONSOLE_ORIGINS=http://console\n");
  assert.equal(await readFile(path.join(runtimeDir, "chrome-fanwei-profile", "Cookies"), "utf8"), "login-state\n");
  assert.equal(await readFile(path.join(runtimeDir, "helper.log"), "utf8"), "existing log\n");
  assert.equal(await readFile(path.join(runtimeDir, "install-macos.command"), "utf8"), "new installer\n");
  const state = JSON.parse(await readFile(path.join(runtimeDir, ".helper-update-state.json"), "utf8"));
  assert.equal(state.toVersion, 10);
  assert.equal(state.restartPending, true);
});

test("download digest mismatch leaves the installed helper untouched", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-update-digest-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const runtimeDir = path.join(tempRoot, "runtime");
  await mkdir(path.join(runtimeDir, "server"), { recursive: true });
  await writeFile(path.join(runtimeDir, "server", "old-helper.mjs"), "old helper\n");
  let extractCalls = 0;
  const content = Buffer.from("tampered package");
  const expectedDigest = createHash("sha256").update("expected package").digest("hex");

  await assert.rejects(
    runFanweiHelperUpdate(updatePayload({ sha256: expectedDigest }), {
      runtimeDir,
      allowedOrigins: [allowedOrigin],
      platform: "darwin",
      arch: "arm64",
      currentVersion: 9,
      fetchImpl: async () => new Response(content, {
        status: 200,
        headers: { "Content-Length": String(content.length) },
      }),
      extractPackageImpl: async () => { extractCalls += 1; },
    }),
    (error) => error instanceof FanweiHelperUpdateError && error.code === "helper_update_digest_mismatch",
  );
  assert.equal(extractCalls, 0);
  assert.equal(await readFile(path.join(runtimeDir, "server", "old-helper.mjs"), "utf8"), "old helper\n");
});

test("verified update pipeline preflights before replacement and confirms the restarted version", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-update-pipeline-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const runtimeDir = path.join(tempRoot, "runtime");
  await mkdir(path.join(runtimeDir, "server"), { recursive: true });
  await writeFile(path.join(runtimeDir, "server", "old-helper.mjs"), "old helper\n");
  await writeFile(path.join(runtimeDir, "node"), "fixture node\n");
  const content = Buffer.from("fixture update archive");
  const digest = createHash("sha256").update(content).digest("hex");
  let preflightCalls = 0;

  const result = await runFanweiHelperUpdate(updatePayload({ sha256: digest }), {
    runtimeDir,
    allowedOrigins: [allowedOrigin],
    platform: "darwin",
    arch: "arm64",
    currentVersion: 9,
    fetchImpl: async () => new Response(content, { status: 200 }),
    extractPackageImpl: async ({ outputDir }) => {
      await writeStagedPackage(path.join(outputDir, "yikao-fanwei-helper-darwin-arm64"));
    },
    preflightPackageImpl: async ({ packageDir }) => {
      preflightCalls += 1;
      assert.match(packageDir, /yikao-fanwei-helper-darwin-arm64$/);
    },
  });

  assert.equal(preflightCalls, 1);
  assert.equal(result.toVersion, 10);
  assert.equal(await readFile(path.join(runtimeDir, "server", "fanwei_local_helper.mjs"), "utf8"), "new fanwei_local_helper.mjs\n");
  assert.equal(await markFanweiHelperUpdateVerified(runtimeDir, 10), true);
  const state = JSON.parse(await readFile(path.join(runtimeDir, ".helper-update-state.json"), "utf8"));
  assert.equal(state.restartPending, false);
  assert.match(state.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(await markFanweiHelperUpdateVerified(runtimeDir, 10), false);
});
