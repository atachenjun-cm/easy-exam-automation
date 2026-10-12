const replacementCharacter = "\uFFFD";
const defaultTemplateRepairFields = new Set(["考前等待提示", "考试承诺书内容"]);
const maximumDefaultTemplateGap = 8;
const minimumDefaultTemplateLiteralCharacters = 64;
const minimumDefaultTemplateLiteralCoverage = 0.9;

export function repairKnownRequirementText(value) {
  return String(value ?? "")
    .replace(/防切屏\uFFFD+控/gu, "防切屏监控");
}

export function repairKnownRequirementTextFields(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([field, item]) => [field, repairKnownRequirementText(item)]),
  );
}

export function requirementFieldsWithReplacementCharacters(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([, item]) => String(item ?? "").includes(replacementCharacter))
    .map(([field]) => field);
}

function normalizedTemplateText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function replacementCharactersMatchTemplate(value, template) {
  const source = normalizedTemplateText(value);
  const target = normalizedTemplateText(template);
  if (!source.includes(replacementCharacter) || !target || target.includes(replacementCharacter)) return false;
  const segments = source.split(/\uFFFD+/gu);
  if (!segments[0] || !segments.at(-1) || !target.startsWith(segments[0])) return false;
  const literalCharacters = segments.reduce((total, segment) => total + segment.length, 0);
  if (
    literalCharacters < minimumDefaultTemplateLiteralCharacters
    || literalCharacters / target.length < minimumDefaultTemplateLiteralCoverage
  ) {
    return false;
  }

  const memo = new Map();
  const matchCount = (index, cursor) => {
    if (index >= segments.length) return cursor === target.length ? 1 : 0;
    const key = `${index}:${cursor}`;
    if (memo.has(key)) return memo.get(key);
    const segment = segments[index];
    let matches = 0;
    for (let gap = 1; gap <= maximumDefaultTemplateGap; gap += 1) {
      const position = cursor + gap;
      if (!target.startsWith(segment, position)) continue;
      matches += matchCount(index + 1, position + segment.length);
      if (matches > 1) break;
    }
    memo.set(key, matches);
    return matches;
  };
  return matchCount(1, segments[0].length) === 1;
}

export function repairRequirementTextFieldsFromDefaults(value = {}, defaults = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const templates = defaults && typeof defaults === "object" && !Array.isArray(defaults) ? defaults : {};
  const fields = {};
  const repairs = [];
  for (const [field, item] of Object.entries(source)) {
    const original = String(item ?? "");
    let repaired = repairKnownRequirementText(original);
    let repairSource = repaired === original ? "" : "known_pattern";
    const template = String(templates[field] ?? "");
    if (
      defaultTemplateRepairFields.has(field)
      && repaired.includes(replacementCharacter)
      && replacementCharactersMatchTemplate(repaired, template)
    ) {
      repaired = template;
      repairSource = "default_template";
    }
    fields[field] = repaired;
    if (repaired !== original) repairs.push({ field, before: original, after: repaired, source: repairSource });
  }
  return {
    fields,
    repairs,
    warningFields: requirementFieldsWithReplacementCharacters(fields),
  };
}

export function knownRequirementTextRepairChanges(before = {}, after = {}) {
  if (!before || typeof before !== "object" || Array.isArray(before)) return [];
  const afterFields = after && typeof after === "object" && !Array.isArray(after) ? after : {};
  return Object.entries(before).flatMap(([field, value]) => {
    const original = String(value ?? "");
    const repaired = repairKnownRequirementText(original);
    const saved = String(afterFields[field] ?? "");
    if (original === repaired || repaired !== saved) return [];
    return [{ field, before: original, after: saved }];
  });
}

export function requirementTextIntegrityWarning(value = {}) {
  const fields = requirementFieldsWithReplacementCharacters(value);
  return fields.length
    ? `需求单以下字段包含异常字符“�”：${fields.join("、")}。请及时在易考中修改。`
    : "";
}
