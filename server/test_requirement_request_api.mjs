import assert from "node:assert/strict";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequirementRequestHandler } from "./requirement_request_api.mjs";

function makeReq(method, pathname, body = null) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  req.method = method;
  req.url = pathname;
  return req;
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    bodyText: "",
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(content = "") {
      this.bodyText = String(content);
      this.body = this.bodyText ? JSON.parse(this.bodyText) : null;
    },
  };
}

async function callRequirementHandler(method, pathname, body) {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });
  const req = makeReq(method, pathname, body);
  const res = makeRes();
  const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
  return { handled, statusCode: res.statusCode, body: res.body };
}

function completeRequirementPayload() {
  return {
    exam_name: "2026招聘考试",
    formal_exam_time_range: "2026-07-01 09:00 - 2026-07-01 11:00",
    mock_exam_time_range: "2026-06-30 15:00 - 2026-06-30 16:00",
    early_login_minutes: "30分钟",
    late_limit_minutes: "15分钟",
    video_monitor_required: "是",
    video_record_required: "是",
    hawkeye_required: "否",
    exam_client_type: "网页考试",
    leave_limit_count: 8,
    subjects: "英语，化学，物理",
  };
}

test("Dify upsert route stores a requirement and returns missing fields", async () => {
  const result = await callRequirementHandler("POST", "/api/ai/requirements/upsert", {
    customer: { name: "ATA客户" },
    requirement: { exam_name: "2026招聘考试", exam_client_type: "网页考试" },
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.requirement.status, "collecting");
  assert.ok(result.body.requirement.latest.missingFields.includes("formal_exam_time_range"));
  assert.ok(result.body.requirement.latest.missingFields.includes("leave_limit_count"));
});

test("staff routes can mark a confirmed requirement ready and link a task", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;
  await call("POST", `/api/ai/requirements/${requestId}/customer-confirmed`, {
    customerReply: "确认",
  });
  const ready = await call("POST", `/api/requirements/${requestId}/mark-ready`, {
    reviewer: "admin-op",
  });
  const linked = await call("POST", `/api/requirements/${requestId}/link-task`, {
    taskId: "task-10001",
  });

  assert.equal(ready.body.requirement.status, "ready_for_manual_execution");
  assert.equal(linked.body.requirement.status, "linked_to_execution_task");
  assert.equal(linked.body.requirement.linkedTaskId, "task-10001");
});

test("customer confirmation does not bypass manual execution readiness", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;

  const confirmed = await call("POST", `/api/ai/requirements/${requestId}/customer-confirmed`, {
    customerReply: "客户确认",
    conversationId: "conv-200",
  });
  const rejectedLink = await call("POST", `/api/requirements/${requestId}/link-task`, {
    taskId: "manual-task-001",
  });
  const ready = await call("POST", `/api/requirements/${requestId}/mark-ready`, {
    reviewer: "ops-a",
  });
  const linked = await call("POST", `/api/requirements/${requestId}/link-task`, {
    taskId: "manual-task-001",
  });

  assert.equal(confirmed.body.requirement.status, "customer_confirmed");
  assert.equal(rejectedLink.statusCode, 400);
  assert.match(rejectedLink.body.error, /ready for manual execution/);
  assert.equal(ready.body.requirement.status, "ready_for_manual_execution");
  assert.equal(linked.body.requirement.status, "linked_to_execution_task");
});

test("staff routes can request clarification and mark reviewed", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;

  const clarification = await call("POST", `/api/requirements/${requestId}/request-clarification`, {
    reviewer: "ops-a",
    message: "请补充考生名单模板要求",
    questions: ["是否需要我们提供考生名单模板？", "考生名单预计什么时候确认？"],
    missingFields: ["candidate_template_required"],
  });
  const reviewed = await call("POST", `/api/requirements/${requestId}/mark-reviewed`, {
    reviewer: "ops-a",
    message: "字段已核对，等待客户确认",
  });

  assert.equal(clarification.statusCode, 200);
  assert.equal(clarification.body.requirement.status, "need_customer_clarification");
  const clarificationEvent = clarification.body.requirement.events.find(
    (event) => event.eventType === "customer_clarification_requested",
  );
  assert.ok(clarificationEvent);
  assert.deepEqual(clarificationEvent.payload.questions, [
    "是否需要我们提供考生名单模板？",
    "考生名单预计什么时候确认？",
  ]);
  assert.deepEqual(clarificationEvent.payload.missingFields, ["candidate_template_required"]);
  assert.match(clarificationEvent.payload.customerPrompt, new RegExp(requestId));
  assert.match(clarificationEvent.payload.customerPrompt, /请补充以下信息/);
  assert.match(clarificationEvent.payload.customerPrompt, /是否需要我们提供考生名单模板/);
  assert.equal(reviewed.statusCode, 200);
  assert.equal(reviewed.body.requirement.status, "reviewed_waiting_customer_confirmation");
});

test("Dify dispatch route records customer confirmation intent", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;

  const confirmed = await call("POST", "/api/ai/requirements/dispatch", {
    intent: "customer_confirmed",
    requestId,
    customer_summary: "考试名称：2026招聘考试；客户确认无误。",
    customerReply: "确认无误",
    conversationId: "conv-dispatch-1",
  });

  assert.equal(confirmed.handled, true);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.ok, true);
  assert.equal(confirmed.body.action, "customer_confirmed");
  assert.equal(confirmed.body.requirement.status, "customer_confirmed");
  assert.equal(confirmed.body.requirement.confirmations[0].conversationId, "conv-dispatch-1");
});

test("Dify dispatch route records change request intent", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;
  await call("POST", `/api/ai/requirements/${requestId}/customer-confirmed`, {
    customerReply: "确认",
  });

  const changed = await call("POST", "/api/ai/requirements/dispatch", {
    intent: "change_request",
    requestId,
    customerMessage: "请增加数学科目",
    changes: {
      subjects: "英语，化学，物理，数学",
    },
  });

  assert.equal(changed.handled, true);
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.ok, true);
  assert.equal(changed.body.action, "change_request");
  assert.equal(changed.body.requirement.status, "change_requested");
  assert.equal(changed.body.requirement.changeRequests[0].changes.subjects.join("，"), "英语，化学，物理，数学");
});
