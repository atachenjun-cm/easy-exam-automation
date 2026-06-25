import { createHash } from "node:crypto";

const FIXED_PERSONAL_KEYS = new Set(["full_name", "email", "phone", "gender", "identity_id", "id_number"]);
const RESERVED_LABELS = new Set(["姓名", "身份证号", "证件号", "准考证号", "科目编号", "科目名称"]);
const BASE_FIELD_CODES = new Map([
  ["姓名", "full_name"],
  ["准考证号", "permit"],
  ["身份证号", "identity_id"],
  ["证件号", "identity_id"],
  ["手机", "phone"],
  ["手机号", "phone"],
  ["手机号码", "phone"],
  ["联系电话", "phone"],
  ["电话", "phone"],
  ["邮箱", "email"],
  ["邮箱地址", "email"],
  ["电子邮箱", "email"],
  ["电子邮件", "email"],
  ["邮件", "email"],
  ["科目编号", "course_code"],
  ["科目名称", "course_name"],
]);
const CANONICAL_FIELD_NAMES = new Map([
  ["手机", "手机号码"],
  ["手机号", "手机号码"],
  ["手机号码", "手机号码"],
  ["联系电话", "手机号码"],
  ["电话", "手机号码"],
  ["mobile", "手机号码"],
  ["phone", "手机号码"],
  ["邮箱", "邮箱"],
  ["邮箱地址", "邮箱"],
  ["电子邮箱", "邮箱"],
  ["电子邮件", "邮箱"],
  ["邮件", "邮箱"],
  ["email", "邮箱"],
  ["mail", "邮箱"],
]);

export function customFieldKey(fieldName = "") {
  return String(fieldName || "").trim();
}

function normalizeHeaderKey(fieldName = "") {
  return customFieldKey(fieldName).replace(/\s+/g, "").toLowerCase();
}

export function canonicalImportFieldName(fieldName = "") {
  const name = customFieldKey(fieldName);
  const normalized = normalizeHeaderKey(name);
  for (const [alias, canonical] of CANONICAL_FIELD_NAMES.entries()) {
    if (normalizeHeaderKey(alias) === normalized) return canonical;
  }
  return name;
}

export function normalizeCustomPersonalFieldNames(fieldNames = []) {
  const seen = new Set();
  return (Array.isArray(fieldNames) ? fieldNames : [])
    .map(canonicalImportFieldName)
    .filter((name) => name && !RESERVED_LABELS.has(name) && !FIXED_PERSONAL_KEYS.has(name))
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .slice(0, 30);
}

export function generateCustomFieldCode(fieldName = "") {
  const name = customFieldKey(fieldName);
  if (!name) return "";
  return `cf_${createHash("sha1").update(name).digest("hex").slice(0, 12)}`;
}

export function normalizeCustomPersonalFieldRequests(customFields = []) {
  const source = Array.isArray(customFields) ? customFields : [];
  const seen = new Set();
  return source
    .filter((field) => field?.enabled !== false)
    .map((field, index) => {
      const fieldName = canonicalImportFieldName(field?.target_name || field?.field_name || field?.name || field?.source_column);
      const sourceColumn = customFieldKey(field?.source_column || fieldName);
      return { field_name: fieldName, source_column: sourceColumn, order_index: index };
    })
    .filter((field) => field.field_name && !RESERVED_LABELS.has(field.field_name) && !FIXED_PERSONAL_KEYS.has(field.field_name))
    .filter((field) => {
      if (seen.has(field.field_name)) return false;
      seen.add(field.field_name);
      return true;
    })
    .slice(0, 30);
}

export function normalizeImportPersonalFieldRequests(fields = []) {
  const source = Array.isArray(fields) ? fields : [];
  const seen = new Set();
  return source
    .filter((field) => field?.enabled !== false)
    .map((field, index) => {
      const fieldName = canonicalImportFieldName(field?.field_name || field?.target_name || field?.name || field?.source_column);
      const sourceColumn = customFieldKey(field?.source_column || fieldName);
      const fieldCode = customFieldKey(field?.field_code || field?.code || BASE_FIELD_CODES.get(fieldName) || generateCustomFieldCode(fieldName));
      return {
        field_name: fieldName,
        field_code: fieldCode,
        source_column: sourceColumn,
        field_kind: customFieldKey(field?.field_kind || field?.kind || "custom") || "custom",
        order_index: Number.isFinite(Number(field?.order_index)) ? Number(field.order_index) : index,
      };
    })
    .filter((field) => field.field_name && field.field_code)
    .filter((field) => {
      if (seen.has(field.field_name)) return false;
      seen.add(field.field_name);
      return true;
    })
    .slice(0, 60);
}

function existingPersonalEntry(personal = {}, fieldName = "", fieldCode = "") {
  const entries = Object.entries(personal && typeof personal === "object" && !Array.isArray(personal) ? personal : {});
  return entries.find(([key, value]) => {
    const label = customFieldKey(value?.label || value?.name || value?.field_name || "");
    const code = customFieldKey(value?.code || value?.field_code || key);
    return key === fieldCode || key === fieldName || code === fieldCode || code === fieldName || label === fieldName;
  });
}

export function syncImportPersonalFields(personal = {}, fields = []) {
  const next = { ...(personal && typeof personal === "object" && !Array.isArray(personal) ? personal : {}) };
  const requests = normalizeImportPersonalFieldRequests(fields);
  const startOrder = Math.max(
    6,
    ...Object.values(next)
      .map((item) => Number(item?.order))
      .filter((value) => Number.isFinite(value)),
  ) + 1;
  const mappings = [];
  requests.forEach((request, index) => {
    const preferredCode = request.field_code || generateCustomFieldCode(request.field_name);
    const existing = existingPersonalEntry(next, request.field_name, preferredCode);
    const fieldCode = existing ? existing[0] : preferredCode;
    const existingValue = existing && existing[1] && typeof existing[1] === "object" ? existing[1] : {};
    next[fieldCode] = {
      ...existingValue,
      code: existingValue.code || fieldCode,
      editable: false,
      allow_edit: false,
      required: false,
      candidate_visible: true,
      visible: true,
      type: existingValue.type || "text",
      order: Number.isFinite(Number(existingValue.order)) ? Number(existingValue.order) : startOrder + index,
      label: existingValue.label || request.field_name,
    };
    mappings.push({
      field_name: request.field_name,
      field_code: fieldCode,
      yikao_field_id: String(existingValue.id || existingValue.field_id || ""),
      source_column: request.source_column,
      field_kind: request.field_kind,
      field_type: next[fieldCode].type || "text",
      required: Boolean(next[fieldCode].required),
      order_index: request.order_index,
      status: existing ? "existing" : "created",
    });
  });
  return {
    personal: next,
    mappings,
    names: requests.map((field) => field.field_name),
  };
}

export function syncCustomPersonalFields(personal = {}, customFields = []) {
  const requests = normalizeCustomPersonalFieldRequests(customFields).map((field) => ({
    ...field,
    field_code: generateCustomFieldCode(field.field_name),
    field_kind: "custom",
  }));
  return syncImportPersonalFields(personal, requests);
}

export function mergeCustomPersonalFields(personal = {}, fieldNames = []) {
  const customFields = normalizeCustomPersonalFieldNames(fieldNames).map((name) => ({
    source_column: name,
    target_name: name,
    enabled: true,
  }));
  return syncCustomPersonalFields(personal, customFields).personal;
}
