const TENANT_FIXED_ENTRY_KEYS = new Set([
  "permit",
  "full_name",
  "identity_id",
  "course_code",
  "email",
  "phone",
  "custom_fields",
]);
const PROTECTED_ENTRY_KEYS = new Set(["permit", "full_name", "identity_id", "course_code", "custom_fields"]);

function normalizeCustomFields(customFields = {}) {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return {};
  return Object.fromEntries(
    Object.entries(customFields)
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "")])
      .filter(([key]) => key && !TENANT_FIXED_ENTRY_KEYS.has(key)),
  );
}

function normalizeCustomFieldMappings(customFieldMappings = []) {
  const seen = new Set();
  return (Array.isArray(customFieldMappings) ? customFieldMappings : [])
    .map((field) => ({
      field_name: String(field?.field_name || field?.target_name || field?.name || "").trim(),
      field_code: String(field?.field_code || field?.code || "").trim(),
    }))
    .filter((field) => field.field_name && field.field_code && !PROTECTED_ENTRY_KEYS.has(field.field_code))
    .filter((field) => {
      if (seen.has(field.field_code)) return false;
      seen.add(field.field_code);
      return true;
    });
}

function mappedCustomFieldValues(customFields = {}, customFieldMappings = []) {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return {};
  const mappings = normalizeCustomFieldMappings(customFieldMappings);
  if (!mappings.length) return normalizeCustomFields(customFields);
  return Object.fromEntries(
    mappings.map((field) => [field.field_code, String(customFields[field.field_name] ?? "")]),
  );
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function customFieldAliasValue(customFields = {}, names = []) {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return "";
  for (const name of names) {
    const exact = customFields[name];
    const exactText = String(exact ?? "").trim();
    if (exactText) return exactText;
    const normalizedName = String(name || "").replace(/\s+/g, "").toLowerCase();
    const matched = Object.entries(customFields).find(
      ([key]) => String(key || "").replace(/\s+/g, "").toLowerCase() === normalizedName,
    );
    const matchedText = String(matched?.[1] ?? "").trim();
    if (matchedText) return matchedText;
  }
  return "";
}

export function buildTenantCandidateEntry(candidate = {}, customFieldMappings = []) {
  const entry = {
    permit: String(candidate.permit || ""),
    full_name: String(candidate.full_name || ""),
    identity_id: String(candidate.identity_id || ""),
    course_code: String(candidate.course_code || ""),
  };
  const mappedValues = mappedCustomFieldValues(candidate.custom_fields, customFieldMappings);
  const email = firstNonEmpty(
    candidate.email,
    mappedValues.email,
    customFieldAliasValue(candidate.custom_fields, ["邮箱", "邮箱地址", "电子邮箱", "电子邮件", "邮件", "email", "mail"]),
  );
  const phone = firstNonEmpty(
    candidate.phone,
    candidate.mobile,
    mappedValues.phone,
    customFieldAliasValue(candidate.custom_fields, ["手机号码", "手机号", "手机", "联系电话", "电话", "mobile", "phone"]),
  );
  if (!entry.course_code) delete entry.course_code;
  const result = { ...entry, ...mappedValues };
  if (email) result.email = email;
  if (phone) result.phone = phone;
  return result;
}

export function buildTenantCandidateEntries(candidates = [], customFieldMappings = []) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) =>
    buildTenantCandidateEntry(candidate, customFieldMappings),
  );
}
