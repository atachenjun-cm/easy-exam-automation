import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");

function makeGitSource() {
  const sourceDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-sync-source-"));
  mkdirSync(path.join(sourceDir, "server"), { recursive: true });
  mkdirSync(path.join(sourceDir, "web"), { recursive: true });
  mkdirSync(path.join(sourceDir, "template"), { recursive: true });
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "tracked-server\n");
  writeFileSync(path.join(sourceDir, "web", "router.mjs"), "tracked-web\n");
  writeFileSync(path.join(sourceDir, "template", "exam.xlsx"), "tracked-template\n");
  writeFileSync(path.join(sourceDir, "scratch.txt"), "untracked\n");
  execFileSync("git", ["init"], { cwd: sourceDir, stdio: "ignore" });
  execFileSync("git", ["add", "server/app.mjs", "web/router.mjs", "template/exam.xlsx"], { cwd: sourceDir, stdio: "ignore" });
  return sourceDir;
}

function commitSource(sourceDir, message) {
  execFileSync("git", ["-c", "user.name=Codex Test", "-c", "user.email=codex@example.com", "add", "."], { cwd: sourceDir, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Codex Test", "-c", "user.email=codex@example.com", "commit", "-m", message], { cwd: sourceDir, stdio: "ignore" });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceDir, encoding: "utf8" }).trim();
}

test("sync local runtime help and unknown arguments never mutate a target", () => {
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-sync-help-target-"));
  const scriptPath = path.join(rootDir, "scripts", "sync_local_runtime.mjs");
  const help = execFileSync(process.execPath, [scriptPath, "--target", targetDir, "--help"], { encoding: "utf8" });
  assert.match(help, /用法：node scripts\/sync_local_runtime\.mjs/);
  assert.equal(existsSync(path.join(targetDir, ".easy_exam_runtime")), false);

  const dryRun = execFileSync(process.execPath, [scriptPath, "--target", targetDir, "--dry-run"], { encoding: "utf8" });
  assert.equal(JSON.parse(dryRun).dryRun, true);
  assert.equal(existsSync(path.join(targetDir, ".easy_exam_runtime")), false);

  assert.throws(
    () => execFileSync(process.execPath, [scriptPath, "--unknown-option"], { encoding: "utf8" }),
    (error) => error.status === 2 && String(error.stderr).includes("未知参数：--unknown-option"),
  );
  assert.equal(existsSync(path.join(targetDir, ".easy_exam_runtime")), false);
  rmSync(targetDir, { recursive: true, force: true });
});

test("sync local runtime refuses to replace a newer runtime with an older checkout", () => {
  const sourceDir = makeGitSource();
  commitSource(sourceDir, "older checkout");
  const newerSourceDir = makeGitSource();
  const newerCommit = commitSource(newerSourceDir, "newer runtime");
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-sync-version-target-"));
  mkdirSync(path.join(targetDir, ".easy_exam_runtime"), { recursive: true });
  writeFileSync(path.join(targetDir, ".easy_exam_runtime", "sync-manifest.json"), `${JSON.stringify({ sourceCommit: newerCommit })}\n`);
  writeFileSync(path.join(targetDir, "sentinel.txt"), "keep-runtime\n");

  assert.throws(
    () => execFileSync(process.execPath, [
      path.join(rootDir, "scripts", "sync_local_runtime.mjs"),
      "--source",
      sourceDir,
      "--target",
      targetDir,
      "--no-restart",
    ], { encoding: "utf8" }),
    (error) => error.status === 1 && String(error.stderr).includes("拒绝覆盖运行时"),
  );
  assert.equal(readFileSync(path.join(targetDir, "sentinel.txt"), "utf8"), "keep-runtime\n");

  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(newerSourceDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
});

test("sync local runtime requires explicit confirmation for an unmarked existing target", () => {
  const sourceDir = makeGitSource();
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-sync-unmarked-target-"));
  mkdirSync(path.join(targetDir, "server"), { recursive: true });
  writeFileSync(path.join(targetDir, "server", "existing.mjs"), "existing-runtime\n");

  assert.throws(
    () => execFileSync(process.execPath, [
      path.join(rootDir, "scripts", "sync_local_runtime.mjs"),
      "--source",
      sourceDir,
      "--target",
      targetDir,
      "--no-restart",
    ], { encoding: "utf8" }),
    (error) => error.status === 1 && String(error.stderr).includes("未标记的现有运行时"),
  );
  assert.equal(readFileSync(path.join(targetDir, "server", "existing.mjs"), "utf8"), "existing-runtime\n");

  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
});

test("sync local runtime copies tracked files, removes stale files, and preserves runtime data", () => {
  const sourceDir = makeGitSource();
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-sync-target-"));
  mkdirSync(path.join(targetDir, ".easy_exam_runtime"), { recursive: true });
  mkdirSync(path.join(targetDir, "server"), { recursive: true });
  mkdirSync(path.join(targetDir, "template"), { recursive: true });
  writeFileSync(path.join(targetDir, ".easy_exam_runtime", "state.json"), '{"keep":true}\n');
  writeFileSync(path.join(targetDir, "server", "stale.mjs"), "old\n");
  writeFileSync(path.join(targetDir, "template", "stale.xlsx"), "old\n");

  const output = execFileSync(process.execPath, [
    path.join(rootDir, "scripts", "sync_local_runtime.mjs"),
    "--source",
    sourceDir,
    "--target",
    targetDir,
    "--force-sync",
    "--no-restart",
  ], { encoding: "utf8" });
  const body = JSON.parse(output);

  assert.equal(body.ok, true);
  assert.equal(body.restarted, false);
  assert.equal(readFileSync(path.join(targetDir, "server", "app.mjs"), "utf8"), "tracked-server\n");
  assert.equal(readFileSync(path.join(targetDir, "web", "router.mjs"), "utf8"), "tracked-web\n");
  assert.equal(readFileSync(path.join(targetDir, "template", "exam.xlsx"), "utf8"), "tracked-template\n");
  assert.equal(readFileSync(path.join(targetDir, ".easy_exam_runtime", "state.json"), "utf8"), '{"keep":true}\n');
  assert.equal(existsSync(path.join(targetDir, "scratch.txt")), false);
  assert.equal(existsSync(path.join(targetDir, "server", "stale.mjs")), false);
  assert.equal(existsSync(path.join(targetDir, "template", "stale.xlsx")), false);

  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
});

test("sync local runtime bootstraps launchd service when kickstart cannot find it", () => {
  const sourceDir = makeGitSource();
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-sync-target-"));
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "easy-exam-sync-bin-"));
  const logPath = path.join(fakeBin, "launchctl.log");
  const seenPath = path.join(fakeBin, "seen");
  const plistPath = path.join(fakeBin, "service.plist");
  writeFileSync(plistPath, "<plist></plist>\n");
  writeFileSync(path.join(fakeBin, "launchctl"), [
    "#!/bin/sh",
    "echo \"$@\" >> \"$LAUNCHCTL_LOG\"",
    "if [ \"$1\" = \"kickstart\" ] && [ ! -f \"$LAUNCHCTL_SEEN\" ]; then",
    "  touch \"$LAUNCHCTL_SEEN\"",
    "  echo 'Could not find service' >&2",
    "  exit 113",
    "fi",
    "exit 0",
    "",
  ].join("\n"));
  writeFileSync(path.join(fakeBin, "curl"), "#!/bin/sh\necho '{\"ok\":true}'\n");
  chmodSync(path.join(fakeBin, "launchctl"), 0o755);
  chmodSync(path.join(fakeBin, "curl"), 0o755);

  const output = execFileSync(process.execPath, [
    path.join(rootDir, "scripts", "sync_local_runtime.mjs"),
    "--source",
    sourceDir,
    "--target",
    targetDir,
    "--label",
    "com.test.service",
    "--plistPath",
    plistPath,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      LAUNCHCTL_LOG: logPath,
      LAUNCHCTL_SEEN: seenPath,
    },
  });
  const body = JSON.parse(output);

  assert.equal(body.ok, true);
  assert.equal(body.restarted, true);
  assert.equal(body.health, '{"ok":true}');
  assert.deepEqual(readFileSync(logPath, "utf8").trim().split("\n"), [
    "kickstart -k gui/501/com.test.service".replace("501", String(process.getuid())),
    `bootstrap gui/${process.getuid()} ${plistPath}`,
    "kickstart -k gui/501/com.test.service".replace("501", String(process.getuid())),
  ]);

  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
  rmSync(fakeBin, { recursive: true, force: true });
});
