function text(value) {
  return String(value ?? "").trim();
}

const mobileAliases = new Set(["手机号码", "手机号", "手机", "联系电话", "电话", "mobile", "phone"]);

function normalizeHeader(value) {
  return text(value)
    .replace(/[\s\u3000]+/g, "")
    .replace(/[（(](?:必填|选填)[）)]$/u, "")
    .toLowerCase();
}

function detectedMappingKey(field = {}) {
  const code = text(field.field_code);
  if (["phone", "mobile"].includes(code)) return "mobile";
  if (["identity_id", "id_number"].includes(code)) return "identity_id";
  return code;
}

export function candidateChangeInitialFieldMapping({ fields = [], columns = [], detectedMapping = {} } = {}) {
  const sourceColumns = (Array.isArray(columns) ? columns : []).map(text).filter(Boolean);
  return Object.fromEntries((Array.isArray(fields) ? fields : []).map((field) => {
    const fieldCode = text(field.field_code);
    const detected = text(detectedMapping?.[detectedMappingKey(field)]);
    const detectedColumn = sourceColumns.find((column) => column === detected);
    const aliases = [field.label, field.field_name, field.field_code]
      .map(normalizeHeader)
      .filter(Boolean);
    const matchedColumn = sourceColumns.find((column) => aliases.includes(normalizeHeader(column)));
    return [fieldCode, detectedColumn || matchedColumn || ""];
  }));
}

function mappedValue(row = {}, sourceColumn = "") {
  if (!sourceColumn) return "";
  return text(row?.[sourceColumn]);
}

export function buildCandidateChangeRosterFromMapping({ fields = [], rawRows = [], mapping = {} } = {}) {
  return (Array.isArray(rawRows) ? rawRows : []).map((row, index) => {
    const candidate = {
      permit: "",
      full_name: "",
      identity_id: "",
      course_code: "",
      mobile: "",
      email: "",
      custom_fields: {},
      __row: Number(row?.__row || index + 2),
    };
    for (const field of Array.isArray(fields) ? fields : []) {
      const sourceColumn = text(mapping?.[field.field_code]);
      let value = mappedValue(row, sourceColumn);
      if (field.candidate_key === "identity_id") value = value.toUpperCase();
      if (field.candidate_key === "mobile" || (field.candidate_key === "permit" && mobileAliases.has(normalizeHeader(sourceColumn)))) {
        value = value.replace(/[\s\u3000-]+/g, "");
      }
      if (field.scope === "base" && field.candidate_key) candidate[field.candidate_key] = value;
      else candidate.custom_fields[text(field.field_name || field.label)] = value;
    }
    return candidate;
  });
}

export function candidateChangeMissingMappings(fields = [], mapping = {}) {
  return (Array.isArray(fields) ? fields : [])
    .filter((field) => field.required && !text(mapping?.[field.field_code]))
    .map((field) => text(field.label || field.field_name || field.field_code))
    .filter(Boolean);
}
