import { createHash } from "node:crypto";

export const CANDIDATE_CHANGE_FIELDS = [
  "full_name",
  "identity_id",
  "course_code",
  "mobile",
  "email",
  "custom_fields",
];

const EDITOR_BASE_FIELDS = new Map([
  ["full_name", { candidate_key: "full_name", label: "姓名", type: "text" }],
  ["identity_id", { candidate_key: "identity_id", label: "身份证号", type: "text" }],
  ["phone", { candidate_key: "mobile", label: "手机号码", type: "text" }],
  ["mobile", { candidate_key: "mobile", label: "手机号码", type: "text" }],
  ["email", { candidate_key: "email", label: "邮箱", type: "email" }],
]);

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

function editorFieldFromPersonal(fieldCode, config = {}, storedMappings = []) {
  const code = text(config.code || config.field_code || fieldCode);
  const label = text(config.label || config.name || config.field_name || code);
  const base = EDITOR_BASE_FIELDS.get(code);
  const stored = storedMappings.find((field) => (
    text(field.field_code || field.code) === code
    || text(field.field_name || field.name) === label
  ));
  return {
    field_code: code,
    field_name: text(stored?.field_name || stored?.name || label),
    label: label || base?.label || code,
    candidate_key: base?.candidate_key || "",
    scope: base ? "base" : "custom",
    type: text(config.type || stored?.field_type || base?.type || "text"),
    required: Boolean(config.required),
    choices: Array.isArray(config.choices) ? config.choices.map(text).filter(Boolean) : [],
    order: Number.isFinite(Number(config.order)) ? Number(config.order) : Number(stored?.order_index || 0),
  };
}

export function buildCandidateChangeEditorFields({
  personal = {},
  storedMappings = [],
} = {}) {
  const fields = [{
    field_code: "permit",
    field_name: "准考证号",
    label: "准考证号",
    candidate_key: "permit",
    scope: "base",
    type: "text",
    required: true,
    choices: [],
    order: -2,
  }];
  const personalEntries = Object.entries(
    personal && typeof personal === "object" && !Array.isArray(personal) ? personal : {},
  );
  const visiblePersonalFields = personalEntries
    .filter(([, config]) => config && typeof config === "object" && config.visible !== false)
    .map(([code, config]) => editorFieldFromPersonal(code, config, storedMappings))
    .filter((field) => field.field_code && !["permit", "course_code"].includes(field.field_code))
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, "zh-CN"));
  if (visiblePersonalFields.length) {
    fields.push(...visiblePersonalFields);
  } else {
    fields.push(
      {
        field_code: "full_name",
        field_name: "姓名",
        label: "姓名",
        candidate_key: "full_name",
        scope: "base",
        type: "text",
        required: true,
        choices: [],
        order: -1,
      },
      ...(Array.isArray(storedMappings) ? storedMappings : []).map((field) => editorFieldFromPersonal(
        field.field_code || field.code,
        {
          label: field.field_name || field.name,
          type: field.field_type,
          required: field.required,
          order: field.order_index,
        },
        storedMappings,
      )),
    );
  }
  if (!fields.some((field) => field.field_code === "full_name")) {
    fields.splice(1, 0, {
      field_code: "full_name",
      field_name: "姓名",
      label: "姓名",
      candidate_key: "full_name",
      scope: "base",
      type: "text",
      required: true,
      choices: [],
      order: -1,
    });
  }
  fields.push({
    field_code: "course_code",
    field_name: "科目编号",
    label: "科目编号",
    candidate_key: "course_code",
    scope: "base",
    type: "text",
    required: true,
    choices: [],
    order: Number.MAX_SAFE_INTEGER,
  });
  const seen = new Set();
  return fields
    .filter((field) => {
      if (!field.field_code || seen.has(field.field_code)) return false;
      seen.add(field.field_code);
      return true;
    })
    .map((field) => ({
      ...field,
      required: field.field_code === "permit" || field.field_code === "full_name" || Boolean(field.required),
    }));
}

export function candidateChangeFieldMappings(editorFields = []) {
  return (Array.isArray(editorFields) ? editorFields : [])
    .filter((field) => !["permit", "full_name", "identity_id", "course_code"].includes(text(field.field_code)))
    .map((field, index) => ({
      field_name: text(field.field_name || field.label),
      field_code: text(field.field_code),
      field_type: text(field.type || "text"),
      required: Boolean(field.required),
      order_index: Number.isFinite(Number(field.order)) ? Number(field.order) : index,
    }))
    .filter((field) => field.field_name && field.field_code);
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

export function candidateChangeSessionAllowsChanges(session = {}, now = Date.now()) {
  return candidateChangeSessionPhase(session, now) !== "ended";
}

export function candidateChangeImpact({ session = {}, summary = {} } = {}) {
  const added = Number(summary.add || 0) > 0;
  const countChanged = added || Number(summary.delete || 0) > 0;
  const courseChanged = Number(summary.edit || 0) > 0;
  return {
    room_assignment: added && Number(session.roomCount || 0) > 0
      ? "append_to_existing"
      : countChanged || courseChanged ? "needs_preview" : "unchanged",
    personnel_task: Number(session.roomCount || 0) > 0 && (countChanged || courseChanged) ? "pending_review" : "unchanged",
    candidate_notice: "no_auto_send",
    tencent_docs: countChanged || courseChanged ? "pending_sync" : "unchanged",
  };
}
