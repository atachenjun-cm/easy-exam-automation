import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultRuntimeDir = path.join(rootDir, ".easy_exam_runtime");
const defaultDbPath = path.join(defaultRuntimeDir, "requirement_requests.sqlite3");
const requirementScript = path.join(__dirname, "requirement_request_db.py");

function defaultJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function defaultReadBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
}

function parseJsonSafe(buffer) {
  try {
    return JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || ""));
  } catch {
    return null;
  }
}

function decodeSegment(value) {
  return decodeURIComponent(value || "");
}

export function createRequirementRequestHandler(options = {}) {
  const dbPath = options.dbPath || process.env.REQUIREMENT_DB_PATH || defaultDbPath;
  const pythonBin = options.pythonBin || process.env.CODEX_PYTHON || process.env.PYTHON || "python3";
  const json = options.json || defaultJson;
  const readBody = options.readBody || defaultReadBody;

  async function runRequirementStore(action, payload = {}) {
    const child = spawn(pythonBin, [requirementScript, dbPath, action], {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.end(JSON.stringify(payload));
    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `需求操作失败：${action}`);
    }
    return JSON.parse(stdout || "null");
  }

  async function readJson(req) {
    return parseJsonSafe(await readBody(req)) || {};
  }

  return async function handleRequirementRequest(req, res, url = new URL(req.url, "http://127.0.0.1")) {
    const pathname = url.pathname;

    if (req.method === "POST" && pathname === "/api/ai/requirements/upsert") {
      const payload = await readJson(req);
      const requirement = await runRequirementStore("upsert", {
        requestId: payload.requestId || payload.request_id,
        customer: payload.customer || {},
        requirement: payload.requirement || {},
        message: payload.message || "",
        source: payload.source || "dify",
      });
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const aiGetMatch = pathname.match(/^\/api\/ai\/requirements\/([^/]+)$/);
    if (req.method === "GET" && aiGetMatch) {
      const requirement = await runRequirementStore("get", {
        requestId: decodeSegment(aiGetMatch[1]),
      });
      json(res, requirement ? 200 : 404, requirement ? { ok: true, requirement } : { error: "Not found" });
      return true;
    }

    const confirmMatch = pathname.match(/^\/api\/ai\/requirements\/([^/]+)\/customer-confirmed$/);
    if (req.method === "POST" && confirmMatch) {
      const payload = await readJson(req);
      const requirement = await runRequirementStore("confirm", {
        requestId: decodeSegment(confirmMatch[1]),
        customerReply: payload.customerReply || payload.customer_reply || "",
        conversationId: payload.conversationId || payload.conversation_id || "",
      });
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const changeMatch = pathname.match(/^\/api\/ai\/requirements\/([^/]+)\/change-request$/);
    if (req.method === "POST" && changeMatch) {
      const payload = await readJson(req);
      const requirement = await runRequirementStore("change", {
        requestId: decodeSegment(changeMatch[1]),
        customerMessage: payload.customerMessage || payload.customer_message || "",
        changes: payload.changes || {},
      });
      json(res, 200, { ok: true, requirement });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/requirements") {
      const requirements = await runRequirementStore("list");
      json(res, 200, { requirements });
      return true;
    }

    const staffGetMatch = pathname.match(/^\/api\/requirements\/([^/]+)$/);
    if (req.method === "GET" && staffGetMatch) {
      const requirement = await runRequirementStore("get", {
        requestId: decodeSegment(staffGetMatch[1]),
      });
      json(res, requirement ? 200 : 404, requirement ? requirement : { error: "Not found" });
      return true;
    }

    const readyMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/mark-ready$/);
    if (req.method === "POST" && readyMatch) {
      const payload = await readJson(req);
      const requirement = await runRequirementStore("mark_ready", {
        requestId: decodeSegment(readyMatch[1]),
        reviewer: payload.reviewer || "",
      });
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const linkTaskMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/link-task$/);
    if (req.method === "POST" && linkTaskMatch) {
      const payload = await readJson(req);
      const requirement = await runRequirementStore("link_task", {
        requestId: decodeSegment(linkTaskMatch[1]),
        taskId: payload.taskId || payload.task_id || "",
      });
      json(res, 200, { ok: true, requirement });
      return true;
    }

    return false;
  };
}

export const handleRequirementRequest = createRequirementRequestHandler();
