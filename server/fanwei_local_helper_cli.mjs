import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFanweiLocalHelperServer,
  loopbackBaseUrl,
  normalizeAllowedOrigins,
} from "./fanwei_local_helper.mjs";
import { markFanweiHelperUpdateVerified } from "./fanwei_local_helper_update.mjs";
import { FANWEI_LOCAL_HELPER_VERSION } from "./fanwei_local_helper_version.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 18765;
const DEFAULT_CHROME_PORT = 19222;
const DEFAULT_SHUTDOWN_GRACE_MS = 2000;
const HELPER_ENV_KEYS = new Set([
  "YIKAO_HELPER_HOST",
  "YIKAO_HELPER_PORT",
  "YIKAO_HELPER_CHROME_PORT",
  "YIKAO_HELPER_RUNTIME_DIR",
  "YIKAO_CONSOLE_ORIGINS",
]);

function parseEnvFile(text = "") {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (!HELPER_ENV_KEYS.has(key)) continue;
    result[key] = trimmed.slice(index + 1).trim();
  }
  return result;
}

export async function mergeHelperConfigEnv(env = process.env) {
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const runtimeDir = String(env.YIKAO_HELPER_RUNTIME_DIR || "").trim();
  const candidates = [
    env.YIKAO_HELPER_CONFIG_FILE,
    runtimeDir ? path.join(runtimeDir, "config.env") : "",
    path.join(process.cwd(), "config.env"),
    path.join(moduleRoot, "config.env"),
  ].filter(Boolean);
  for (const candidate of Array.from(new Set(candidates))) {
    try {
      return { ...env, ...parseEnvFile(await readFile(candidate, "utf8")) };
    } catch {}
  }
  return env;
}

function portFromEnv(value, name, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) {
    throw new TypeError(`${name} must be an integer from 1 to 65535`);
  }
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}

function powershellLiteral(value = "") {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function scheduleFanweiHelperRestart({
  platform = process.platform,
  runtimeDir,
  currentPid = process.pid,
  spawnImpl = spawn,
} = {}) {
  if (platform === "darwin") {
    return { strategy: "launchd-keepalive" };
  }
  if (platform !== "win32") {
    throw new Error(`Unsupported helper restart platform: ${platform}`);
  }
  const nodePath = path.join(runtimeDir, "node.exe");
  const entryPath = path.join(runtimeDir, "server", "fanwei_local_helper_cli.mjs");
  const stdoutPath = path.join(runtimeDir, "helper.log");
  const stderrPath = path.join(runtimeDir, "helper-error.log");
  const pidPath = path.join(runtimeDir, "helper.pid");
  const command = [
    `$oldPid=${Number(currentPid)};`,
    "Wait-Process -Id $oldPid -ErrorAction SilentlyContinue;",
    `Remove-Item -LiteralPath ${powershellLiteral(pidPath)} -Force -ErrorAction SilentlyContinue;`,
    `$next=Start-Process -FilePath ${powershellLiteral(nodePath)} `
      + `-ArgumentList @(${powershellLiteral(entryPath)}) `
      + `-WorkingDirectory ${powershellLiteral(runtimeDir)} -WindowStyle Hidden `
      + `-RedirectStandardOutput ${powershellLiteral(stdoutPath)} `
      + `-RedirectStandardError ${powershellLiteral(stderrPath)} -PassThru;`,
    `Set-Content -LiteralPath ${powershellLiteral(pidPath)} -Value $next.Id -Encoding ascii;`,
  ].join(" ");
  const child = spawnImpl("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref?.();
  return { strategy: "windows-detached-restart", pid: child.pid || null };
}

export function helperConfigFromEnv(env = process.env) {
  const host = String(env.YIKAO_HELPER_HOST || DEFAULT_HOST).trim();
  if (host !== DEFAULT_HOST) {
    throw new TypeError("YIKAO_HELPER_HOST must be 127.0.0.1 (loopback-only)");
  }

  const allowedOrigins = normalizeAllowedOrigins(env.YIKAO_CONSOLE_ORIGINS);
  if (!allowedOrigins.length) {
    throw new TypeError("YIKAO_CONSOLE_ORIGINS must contain 至少一个有效 origin");
  }

  const configuredRuntimeDir = String(env.YIKAO_HELPER_RUNTIME_DIR || "").trim();
  return {
    host,
    port: portFromEnv(env.YIKAO_HELPER_PORT, "YIKAO_HELPER_PORT", DEFAULT_PORT),
    chromePort: portFromEnv(
      env.YIKAO_HELPER_CHROME_PORT,
      "YIKAO_HELPER_CHROME_PORT",
      DEFAULT_CHROME_PORT,
    ),
    allowedOrigins,
    runtimeDir: configuredRuntimeDir
      ? path.resolve(configuredRuntimeDir)
      : path.join(os.homedir(), ".yikao-local-helper"),
  };
}

export async function runFanweiLocalHelperCli(env = process.env) {
  const mergedEnv = await mergeHelperConfigEnv(env);
  const config = helperConfigFromEnv(mergedEnv);
  const shutdownGraceMs = portFromEnv(
    mergedEnv.YIKAO_HELPER_SHUTDOWN_GRACE_MS,
    "YIKAO_HELPER_SHUTDOWN_GRACE_MS",
    DEFAULT_SHUTDOWN_GRACE_MS,
  );
  await mkdir(config.runtimeDir, { recursive: true });
  const server = createFanweiLocalHelperServer(config);
  let closing = false;
  let forceTimer = null;

  const shutdown = () => {
    if (closing) {
      console.error("Fanwei local helper forced shutdown after repeated signal.");
      process.exit(1);
    }
    closing = true;
    if (!server.listening) {
      process.exit(0);
      return;
    }
    forceTimer = setTimeout(() => {
      console.error(`Fanwei local helper shutdown exceeded ${shutdownGraceMs}ms; forcing exit.`);
      server.closeAllConnections?.();
      process.exit(1);
    }, shutdownGraceMs);
    forceTimer.unref?.();
    server.close((error) => {
      clearTimeout(forceTimer);
      forceTimer = null;
      if (error) {
        console.error(`Fanwei local helper close failed: ${error.code || "ERROR"}: ${error.message || error}`);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.once("helper-update-applied", (update, controls = {}) => {
    try {
      const restart = scheduleFanweiHelperRestart({
        platform: process.platform,
        runtimeDir: config.runtimeDir,
      });
      console.log(
        `Fanwei local helper update applied: v${update?.fromVersion || "?"} -> v${update?.toVersion || "?"}; restart=${restart.strategy}`,
      );
      setTimeout(shutdown, 50);
    } catch (error) {
      console.error(`Fanwei local helper restart scheduling failed: ${error?.message || error}`);
      controls.resumeAfterRestartFailure?.();
    }
  });

  if (!server.listening) await once(server, "listening");
  await markFanweiHelperUpdateVerified(config.runtimeDir, FANWEI_LOCAL_HELPER_VERSION).catch((error) => {
    console.error(`Fanwei local helper update verification marker failed: ${error?.message || error}`);
  });
  console.log(
    `Fanwei local helper: ${loopbackBaseUrl(config.host, config.port)}; allowed origins: ${config.allowedOrigins.join(", ")}`,
  );
  return server;
}

async function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    const [entryPath, modulePath] = await Promise.all([
      realpath(path.resolve(process.argv[1])),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return entryPath === modulePath;
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (await isDirectRun()) {
  runFanweiLocalHelperCli().catch((error) => {
    console.error(`Fanwei local helper failed to start: ${error?.code || "ERROR"}: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
