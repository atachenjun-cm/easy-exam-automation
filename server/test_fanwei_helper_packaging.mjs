import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FANWEI_LOCAL_HELPER_VERSION } from "./fanwei_local_helper_version.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const builderPath = path.join(rootDir, "scripts", "build_fanwei_helper_packages.mjs");
const deployDir = path.join(rootDir, "deploy", "fanwei-helper");
const consoleOrigin = "http://172.16.13.214:8765";

function readDeploy(name) {
  return fs.readFileSync(path.join(deployDir, name), "utf8");
}

function writeFixtureRuntime(dir, platform) {
  const fileName = platform === "win-x64" ? "node.exe" : "node";
  const runtimePath = path.join(dir, `${platform}-${fileName}`);
  fs.writeFileSync(runtimePath, "fixture runtime\n", { mode: 0o755 });
  return runtimePath;
}

function buildFixturePackage(platform) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fanwei-helper-package-"));
  const outputDir = path.join(tempDir, "output");
  const runtimePath = writeFixtureRuntime(tempDir, platform);
  const output = execFileSync(nodeBin, [
    builderPath,
    `--platform=${platform}`,
    `--node-runtime=${runtimePath}`,
    `--console-origin=${consoleOrigin}`,
    `--output=${outputDir}`,
  ], { cwd: rootDir, encoding: "utf8" });
  return { tempDir, outputDir, output };
}

function downloadWithHost(url, { cookie, host }) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, {
      headers: {
        Cookie: cookie,
        Host: host,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks),
      }));
    });
    request.on("error", reject);
  });
}

test("Windows installer uses the current user profile, autostarts, records a PID, and opens the shared console", () => {
  const install = readDeploy("install-windows.bat");
  const start = readDeploy("start-windows.bat");

  assert.match(install, /%LOCALAPPDATA%\\YikaoFanweiHelper/i);
  assert.match(install, /%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup/i);
  assert.match(install, /CONFIG_SOURCE=%SOURCE_DIR%config\.env/i);
  assert.match(install, /findstr \/B "YIKAO_CONSOLE_ORIGINS="/i);
  assert.match(install, /copy \/Y "%CONFIG_SOURCE%" "%INSTALL_DIR%\\config\.env"/i);
  assert.match(install, /start-windows\.bat/i);
  assert.match(install, /start "" "%CONSOLE_ORIGIN%\/fanwei-test"/i);
  assert.match(start, /helper\.pid/i);
  assert.match(start, /fanwei_local_helper_cli\.mjs/i);
});

test("macOS installer uses Application Support and bootstraps its own LaunchAgent", () => {
  const install = readDeploy("install-macos.command");
  const plist = readDeploy("com.ata.yikao-fanwei-helper.plist.template");

  assert.match(install, /Library\/Application Support\/YikaoFanweiHelper/);
  assert.match(install, /Library\/LaunchAgents\/com\.ata\.yikao-fanwei-helper\.plist/);
  assert.match(install, /cp -R "\$SOURCE_DIR\/node_modules\/playwright" "\$INSTALL_DIR\/node_modules\/"/);
  assert.match(install, /cp -R "\$SOURCE_DIR\/node_modules\/playwright-core" "\$INSTALL_DIR\/node_modules\/"/);
  assert.match(install, /launchctl bootstrap "gui\/\$UID"/);
  assert.match(install, /launchctl kickstart -k "gui\/\$UID\/com\.ata\.yikao-fanwei-helper"/);
  assert.match(install, /CONFIG_SOURCE="\$SOURCE_DIR\/config\.env"/);
  assert.match(install, /YIKAO_CONSOLE_ORIGINS=/);
  assert.match(install, /open "\$CONSOLE_URL"/);
  assert.match(plist, /com\.ata\.yikao-fanwei-helper/);
  assert.match(plist, /__HELPER_DIR__/);
});

for (const platform of ["win-x64", "darwin-x64", "darwin-arm64"]) {
  test(`package builder creates a complete ${platform} folder and zip`, () => {
    const { tempDir, outputDir, output } = buildFixturePackage(platform);
    try {
      const packageName = `yikao-fanwei-helper-${platform}`;
      const packageDir = path.join(outputDir, packageName);
      const runtimeName = platform === "win-x64" ? "node.exe" : "node";
      const installerName = platform === "win-x64" ? "install-windows.bat" : "install-macos.command";
      const expectedFiles = [
        "config.env",
        "helper-package.json",
        installerName,
        runtimeName,
        "server/fanwei_auto_read.mjs",
        "server/fanwei_local_helper.mjs",
        "server/fanwei_local_helper_cli.mjs",
        "server/fanwei_local_helper_update.mjs",
        "server/fanwei_local_helper_version.mjs",
        "server/operation_batch_runner.mjs",
        "server/operation_batch_update_runner.mjs",
        "server/operation_personnel_console_runner.mjs",
        "server/operation_archive_runner.mjs",
        "server/operation_content.mjs",
        "server/operation_content_runner.mjs",
        "server/score_stamp_application.mjs",
        "node_modules/playwright/package.json",
        "node_modules/playwright-core/package.json",
      ];
      for (const relative of expectedFiles) {
        assert.equal(fs.existsSync(path.join(packageDir, relative)), true, `${relative} is missing`);
      }
      assert.equal(fs.existsSync(path.join(outputDir, `${packageName}.zip`)), true);
      assert.match(fs.readFileSync(path.join(packageDir, "config.env"), "utf8"), new RegExp(consoleOrigin.replaceAll(".", "\\.")));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(packageDir, "helper-package.json"), "utf8")), {
        schemaVersion: 1,
        helperVersion: FANWEI_LOCAL_HELPER_VERSION,
        platform,
        updateStrategy: "server-files-v1",
      });
      assert.match(output, new RegExp(`${packageName}\\.zip`));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

test("package builder rejects missing inputs without leaving a partial package", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fanwei-helper-invalid-"));
  const outputDir = path.join(tempDir, "output");
  try {
    assert.throws(() => execFileSync(nodeBin, [
      builderPath,
      "--platform=win-x64",
      `--output=${outputDir}`,
    ], { cwd: rootDir, encoding: "utf8", stdio: "pipe" }));
    assert.equal(fs.existsSync(outputDir), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("authenticated server downloads a prebuilt helper zip and validates platform errors", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fanwei-helper-download-"));
  const runtimeDir = path.join(tempDir, "runtime");
  const packagesDir = path.join(runtimeDir, "fanwei-helper");
  fs.mkdirSync(packagesDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "auth.json"), JSON.stringify({
    email: "tester@example.com",
    password: "secret",
  }));
  const packageName = "yikao-fanwei-helper-win-x64";
  const packageDir = path.join(packagesDir, packageName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, "node.exe"), "fixture runtime\n");
  execFileSync("zip", ["-qry", `${packageName}.zip`, packageName], { cwd: packagesDir });

  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(nodeBin, [path.join(rootDir, "server", "easy_exam_server.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      EASY_EXAM_RUNTIME_DIR: runtimeDir,
      EASY_EXAM_FANWEI_HELPER_PACKAGES_DIR: path.join(tempDir, "empty-packages"),
      PAPER_BIND_SCHEDULER_DISABLED: "1",
      APP_LOGIN_EMAIL: "",
      APP_LOGIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server startup timed out")), 10000);
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("Easy Exam server running")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) => reject(new Error(`server exited early: ${code}`)));
    });

    const unauthenticated = await fetch(`${base}/api/fanwei/helper-installer?platform=windows`, { redirect: "manual" });
    assert.equal(unauthenticated.status, 401);
    const unauthenticatedManifest = await fetch(
      `${base}/api/fanwei/helper-update-manifest?platform=windows&currentVersion=${FANWEI_LOCAL_HELPER_VERSION - 1}`,
    );
    assert.equal(unauthenticatedManifest.status, 401);

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "tester@example.com", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(cookie);

    const latestManifestResponse = await fetch(
      `${base}/api/fanwei/helper-update-manifest?platform=windows&currentVersion=${FANWEI_LOCAL_HELPER_VERSION}`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(latestManifestResponse.status, 200);
    assert.deepEqual(await latestManifestResponse.json(), {
      updateAvailable: false,
      currentVersion: FANWEI_LOCAL_HELPER_VERSION,
      latestVersion: FANWEI_LOCAL_HELPER_VERSION,
    });

    const updateManifestResponse = await fetch(
      `${base}/api/fanwei/helper-update-manifest?platform=windows&currentVersion=${FANWEI_LOCAL_HELPER_VERSION - 1}`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(updateManifestResponse.status, 200);
    const updateManifest = await updateManifestResponse.json();
    assert.equal(updateManifest.updateAvailable, true);
    assert.equal(updateManifest.version, FANWEI_LOCAL_HELPER_VERSION);
    assert.match(updateManifest.packageUrl, new RegExp(`^${base.replaceAll(".", "\\.")}\/api\/fanwei\/helper-update-package\\?token=[0-9a-f]{64}$`));
    assert.match(updateManifest.sha256, /^[0-9a-f]{64}$/);
    const updatePackageResponse = await fetch(updateManifest.packageUrl);
    assert.equal(updatePackageResponse.status, 200);
    const updatePackage = Buffer.from(await updatePackageResponse.arrayBuffer());
    assert.equal(createHash("sha256").update(updatePackage).digest("hex"), updateManifest.sha256);
    const updateZip = path.join(tempDir, "auto-update.zip");
    fs.writeFileSync(updateZip, updatePackage);
    assert.deepEqual(JSON.parse(execFileSync(
      "unzip",
      ["-p", updateZip, `${packageName}/helper-package.json`],
      { encoding: "utf8" },
    )), {
      schemaVersion: 1,
      helperVersion: FANWEI_LOCAL_HELPER_VERSION,
      platform: "win-x64",
      updateStrategy: "server-files-v1",
    });
    assert.equal((await fetch(updateManifest.packageUrl)).status, 404);

    const download = await fetch(`${base}/api/fanwei/helper-installer?platform=windows`, {
      headers: { Cookie: cookie },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/zip");
    assert.match(download.headers.get("content-disposition") || "", /yikao-fanwei-helper-win-x64\.zip/);
    assert.match(download.headers.get("cache-control") || "", /no-store/);
    assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 2).toString("ascii"), "PK");

    fs.rmSync(packageDir, { recursive: true, force: true });
    fs.writeFileSync(path.join(packagesDir, `${packageName}.zip`), Buffer.from("stale invalid package"));
    const stalePackage = await fetch(`${base}/api/fanwei/helper-installer?platform=windows`, {
      headers: { Cookie: cookie },
    });
    assert.equal(stalePackage.status, 503);
    assert.match((await stalePackage.json()).error, /安装包生成失败/);

    const unknown = await fetch(`${base}/api/fanwei/helper-installer?platform=linux`, {
      headers: { Cookie: cookie },
    });
    assert.equal(unknown.status, 400);
    assert.match((await unknown.json()).error, /不支持/);

    const missing = await fetch(`${base}/api/fanwei/helper-installer?platform=macos`, {
      headers: { Cookie: cookie },
    });
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /安装包.*尚未生成/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("authenticated server rewrites helper package origin for the current console host", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fanwei-helper-origin-"));
  const runtimeDir = path.join(tempDir, "runtime");
  const packagesDir = path.join(runtimeDir, "fanwei-helper");
  const packageName = "yikao-fanwei-helper-win-x64";
  const packageDir = path.join(packagesDir, packageName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "auth.json"), JSON.stringify({
    email: "tester@example.com",
    password: "secret",
  }));
  fs.writeFileSync(path.join(packageDir, "config.env"), [
    "YIKAO_HELPER_HOST=127.0.0.1",
    "YIKAO_HELPER_PORT=18765",
    "YIKAO_HELPER_CHROME_PORT=19222",
    "YIKAO_CONSOLE_ORIGINS=http://old.example.test:8765",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(packageDir, "node.exe"), "fixture runtime\n");
  fs.mkdirSync(path.join(packageDir, "server"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "server", "score_stamp_application.mjs"), "stale helper source\n");
  execFileSync("zip", ["-qry", `${packageName}.zip`, packageName], { cwd: packagesDir });
  fs.rmSync(packageDir, { recursive: true, force: true });

  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(nodeBin, [path.join(rootDir, "server", "easy_exam_server.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      EASY_EXAM_RUNTIME_DIR: runtimeDir,
      EASY_EXAM_FANWEI_HELPER_PACKAGES_DIR: path.join(tempDir, "empty-packages"),
      PAPER_BIND_SCHEDULER_DISABLED: "1",
      APP_LOGIN_EMAIL: "",
      APP_LOGIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server startup timed out")), 10000);
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("Easy Exam server running")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) => reject(new Error(`server exited early: ${code}`)));
    });

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "tester@example.com", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(cookie);

    const download = await downloadWithHost(`${base}/api/fanwei/helper-installer?platform=windows`, {
      cookie,
      host: "10.9.8.7:8765",
    });
    assert.equal(download.status, 200);
    const downloadedZip = path.join(tempDir, "downloaded.zip");
    fs.writeFileSync(downloadedZip, download.body);
    const config = execFileSync("unzip", ["-p", downloadedZip, `${packageName}/config.env`], { encoding: "utf8" });
    assert.match(config, /YIKAO_CONSOLE_ORIGINS=http:\/\/10\.9\.8\.7:8765,http:\/\/127\.0\.0\.1:8765,http:\/\/localhost:8765/);
    assert.doesNotMatch(config, /old\.example\.test/);
    const helperSource = execFileSync(
      "unzip",
      ["-p", downloadedZip, `${packageName}/server/score_stamp_application.mjs`],
      { encoding: "utf8" },
    );
    assert.equal(helperSource, fs.readFileSync(path.join(rootDir, "server", "score_stamp_application.mjs"), "utf8"));
    assert.doesNotMatch(helperSource, /stale helper source/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
