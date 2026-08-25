import { createHash } from "node:crypto";

export const CANDIDATE_CHANGE_FIELDS = [
  "full_name",
  "identity_id",
  "course_code",
  "mobile",
  "email",
  "custom_fields",
];

function text(value) {
  return String(value ?? "").trim();
}

function normalizeCustomFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, fieldValue]) => [text(key), text(fieldValue)])
      .filter(([key]) => key)
      .sort(([left], [right]) => left.localeCompare(right, "zh-CN")),
  );
}

export function normalizeCandidateChangeRow(row = {}) {
  return {
    permit: text(row.permit || row.admission_ticket || row.entry || row.account),
    full_name: text(row.full_name || row.name || row.real_name),
    identity_id: text(row.identity_id || row.id_card || row.identity).toUpperCase(),
    course_code: text(row.course_code || row.courseCode),
    course_name: text(row.course_name || row.course || row.subject),
    mobile: text(row.mobile || row.phone || row.mobile_phone),
    email: text(row.email || row.mail),
    exam_status: text(row.exam_status || row.entry_status || row.status),
    custom_fields: normalizeCustomFields(row.custom_fields || row.customFields),
  };
}

export function normalizeCandidateRoster(rows = []) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .map(normalizeCandidateChangeRow)
    .filter((row) => row.permit)
    .sort((left, right) => left.permit.localeCompare(right.permit, "en"));
  const duplicatePermits = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.permit)) duplicatePermits.push(candidate.permit);
    seen.add(candidate.permit);
  }
  return { candidates, duplicatePermits: [...new Set(duplicatePermits)] };
}

export function candidateRosterForValidation(proposedRows = [], currentRows = []) {
  const proposed = normalizeCandidateRoster(proposedRows).candidates;
  const currentByPermit = new Map(
    normalizeCandidateRoster(currentRows).candidates.map((candidate) => [candidate.permit, candidate]),
  );
  return proposed.map((candidate) => {
    const current = currentByPermit.get(candidate.permit) || {};
    const unchangedMasked = (field) => {
      const value = text(candidate[field]);
      return /[\u2022*]/.test(value) && value === text(current[field]);
    };
    return {
      ...candidate,
      identity_id: unchangedMasked("identity_id") ? "" : candidate.identity_id,
      mobile: unchangedMasked("mobile") ? "" : candidate.mobile,
      email: unchangedMasked("email") ? "" : candidate.email,
    };
  });
}

function hashRow(row) {
  return {
    permit: row.permit,
    full_name: row.full_name,
    identity_id: row.identity_id,
    course_code: row.course_code,
    mobile: row.mobile,
    email: row.email,
    custom_fields: row.custom_fields,
  };
}

export function candidateRosterHash(rows = []) {
  const { candidates } = normalizeCandidateRoster(rows);
  return createHash("sha256")
    .update(JSON.stringify(candidates.map(hashRow)))
    .digest("hex");
}

function changedFields(before, after) {
  return CANDIDATE_CHANGE_FIELDS.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

function riskForChange(operation, fields = []) {
  if (operation === "delete") return "high";
  if (fields.includes("course_code")) return "high";
  if (operation === "edit") return "medium";
  return "low";
}

function candidateHasStarted(candidate = {}) {
  const status = text(candidate.exam_status).toLowerCase();
  return Boolean(status && !["valid", "未开考", "未参考", "待考试"].includes(status));
}

export function buildCandidateChangePreview(beforeRows = [], afterRows = []) {
  const beforeRoster = normalizeCandidateRoster(beforeRows);
  const afterRoster = normalizeCandidateRoster(afterRows);
  const errors = [];
  if (afterRoster.duplicatePermits.length) {
    errors.push(`最新版名单存在重复准考证号：${afterRoster.duplicatePermits.join("、")}`);
  }
  const beforeByPermit = new Map(beforeRoster.candidates.map((row) => [row.permit, row]));
  const afterByPermit = new Map(afterRoster.candidates.map((row) => [row.permit, row]));
  const items = [];

  for (const after of afterRoster.candidates) {
    const before = beforeByPermit.get(after.permit);
    if (!before) {
      items.push({
        operation: "add",
        old_permit: "",
        permit: after.permit,
        before: null,
        after,
        changed_fields: CANDIDATE_CHANGE_FIELDS.filter((field) => field !== "custom_fields" && after[field]),
        risk_level: "low",
        blocked: false,
        block_reason: "",
      });
      continue;
    }
    const fields = changedFields(before, after);
    if (!fields.length) continue;
    const started = candidateHasStarted(before);
    items.push({
      operation: "edit",
      old_permit: before.permit,
      permit: after.permit,
      before,
      after: { ...after, exam_status: before.exam_status || after.exam_status },
      changed_fields: fields,
      risk_level: riskForChange("edit", fields),
      blocked: started,
      block_reason: started ? `考生状态为“${before.exam_status}”，不能修改考试身份信息` : "",
    });
  }

  for (const before of beforeRoster.candidates) {
    if (afterByPermit.has(before.permit)) continue;
    const started = candidateHasStarted(before);
    items.push({
      operation: "delete",
      old_permit: before.permit,
      permit: before.permit,
      before,
      after: null,
      changed_fields: [],
      risk_level: "high",
      blocked: started,
      block_reason: started ? `考生状态为“${before.exam_status}”，不能删除` : "",
    });
  }

  const operationOrder = { add: 0, edit: 1, delete: 2 };
  items.sort((left, right) => operationOrder[left.operation] - operationOrder[right.operation] || left.permit.localeCompare(right.permit, "en"));
  const summary = items.reduce(
    (result, item) => {
      result[item.operation] += 1;
      if (item.risk_level === "high") result.high_risk += 1;
      if (item.blocked) result.blocked += 1;
      return result;
    },
    { add: 0, edit: 0, delete: 0, unchanged: Math.max(0, afterRoster.candidates.length - items.filter((item) => item.operation !== "delete").length), high_risk: 0, blocked: 0 },
  );
  return {
    before: beforeRoster.candidates,
    after: afterRoster.candidates,
    baseline_hash: candidateRosterHash(beforeRoster.candidates),
    proposed_hash: candidateRosterHash(afterRoster.candidates),
    items,
    summary,
    errors,
  };
}

export function candidateChangeSessionPhase(session = {}, now = Date.now()) {
  const start = Date.parse(String(session.start || session.start_time || "").replace(/\//g, "-").replace(" ", "T"));
  const end = Date.parse(String(session.end || session.end_time || "").replace(/\//g, "-").replace(" ", "T"));
  if (Number.isFinite(end) && end <= now) return "ended";
  if (Number.isFinite(start) && start <= now) return "started";
  return "not_started";
}

export function candidateChangeImpact({ session = {}, summary = {} } = {}) {
  const countChanged = Number(summary.add || 0) > 0 || Number(summary.delete || 0) > 0;
  const courseChanged = Number(summary.edit || 0) > 0;
  return {
    room_assignment: countChanged || courseChanged ? "needs_preview" : "unchanged",
    personnel_task: Number(session.roomCount || 0) > 0 && (countChanged || courseChanged) ? "pending_review" : "unchanged",
    candidate_notice: "no_auto_send",
    tencent_docs: countChanged || courseChanged ? "pending_sync" : "unchanged",
  };
}
