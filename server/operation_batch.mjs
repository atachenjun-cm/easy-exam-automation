function text(value) {
  return String(value ?? "").trim();
}

export const OPERATION_BATCH_RECONCILIATION_REQUIRED = "OPERATION_BATCH_RECONCILIATION_REQUIRED";

function field(value, source, label) {
  return { value: text(value), source, label };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

export function hasOperationBatchTextReplacementCharacter(value = "") {
  return text(value).includes("\uFFFD");
}

export const OPERATION_PROJECT_DEPARTMENTS = Object.freeze([
  "项目实施一部",
  "项目实施二部",
  "项目实施三部",
  "项目实施四部",
  "项目实施五部",
  "悦考在线运维部",
]);

const DEFAULT_OPERATION_PROJECT_DEPARTMENT = "项目实施五部";
const OPERATION_PROJECT_DEPARTMENT_BY_OWNER = new Map([
  ["chenjun@ata.net.cn", "项目实施一部"],
  ["siyuanyuan@ata.net.cn", "项目实施三部"],
]);

export function operationProjectDepartmentForOwner(ownerEmail = "") {
  return OPERATION_PROJECT_DEPARTMENT_BY_OWNER.get(text(ownerEmail).toLowerCase())
    || DEFAULT_OPERATION_PROJECT_DEPARTMENT;
}

export function normalizeOperationProjectDepartment(value = "") {
  const normalized = text(value);
  return OPERATION_PROJECT_DEPARTMENTS.includes(normalized) ? normalized : "";
}

export function initializeOperationBatchDefaults(config = {}, ownerEmail = "") {
  const current = config?.operationBatch && typeof config.operationBatch === "object"
    ? config.operationBatch
    : {};
  return {
    ...config,
    operationBatch: {
      ...current,
      projectDepartmentDefault: operationProjectDepartmentForOwner(ownerEmail),
    },
  };
}

function numberText(value) {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return raw;
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

function scheduleDates(business = {}) {
  const dates = Array.isArray(business.exam_schedule)
    ? business.exam_schedule.map((item) => text(item?.exam_date)).filter(Boolean)
    : [];
  if (dates.length) {
    return { start: dates[0], end: dates[dates.length - 1] };
  }
  const range = text(business.formal_exam_time_range);
  const matches = [...range.matchAll(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g)].map((item) => item[0].replaceAll("/", "-"));
  return { start: matches[0] || "", end: matches[matches.length - 1] || matches[0] || "" };
}

function normalizedBatchProjectName(value = "") {
  return text(value)
    .replace(/有限责任公司|股份有限公司|有限公司/g, "")
    .replace(/20\d{2}年/g, "")
    .replace(/第[一二三四五六七八九十百0-9]+批/g, "")
    .replace(/公开(?=招聘)/g, "")
    .replace(/社会(?=招聘)/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function stripBatchDateSuffix(value = "") {
  return text(value).replace(/[_\s-]+20\d{2}年\d{1,2}月(?:\d{1,2}日)?$/, "").trim();
}

export function operationBatchNameForTask(task = {}, business = task.config?.businessRequirement || {}) {
  const savedBatch = task.config?.operationBatch || {};
  const confirmedCode = firstNonEmpty(task.config?.operationBatchCode, savedBatch.code);
  if (operationBatchCodeIsValid(confirmedCode)) {
    const confirmedName = firstNonEmpty(savedBatch.batchName, savedBatch.name);
    if (confirmedName) return confirmedName;
  }
  const batchNameMode = firstNonEmpty(
    task.config?.fanweiSource?.batchNameMode,
    business.batch_name_mode,
  );
  const sourceBatchName = firstNonEmpty(
    task.config?.fanweiSource?.raw?.fields?.["批次名称"],
    business.batch_name,
  );
  if (batchNameMode === "manual" && sourceBatchName) return sourceBatchName;
  const projectName = normalizedBatchProjectName(stripBatchDateSuffix(firstNonEmpty(
    task.config?.examName,
    task.config?.examRequirement?.fields?.["考试名称"],
    business.exam_name,
    task.projectName,
    business.project_name,
    sourceBatchName,
    savedBatch.batchName,
    savedBatch.name,
  )));
  const { start } = scheduleDates(business);
  if (!projectName) return "";
  if (!start) return projectName;
  const match = start.match(/^(\d{4})-(\d{1,2})-/);
  return match ? `${projectName}_${match[1]}年${Number(match[2])}月` : projectName;
}

function centralVenueNotRequired(value) {
  const normalized = text(value);
  return normalized === "不需要" || normalized.includes("不需要");
}

function defaultSystemType(value) {
  const normalized = text(value);
  return normalized || "易考";
}

function operationBusinessDepartment(value) {
  const normalized = text(value);
  if (normalized.includes("办事处") || normalized.includes("代表处")) {
    return { value: "地方业务中心", source: "default_rule" };
  }
  return { value: normalized, source: "business_requirement" };
}

function personnelServiceFromInvigilatorArrangement(value) {
  const normalized = text(value);
  if (!normalized) return { value: "", source: "manual" };
  if (normalized.includes("不需要")) return { value: "不需要", source: "business_requirement" };
  if (normalized.includes("分散")) return { value: "分散人工监考", source: "business_requirement" };
  if (normalized.includes("集中")) return { value: "集中人工监考", source: "business_requirement" };
  return { value: normalized, source: "business_requirement" };
}

function contentServiceFromParticipation(value) {
  const normalized = text(value);
  const needsContentService = normalized
    && !/(不需要|无需)/.test(normalized)
    && (normalized.includes("制题") || normalized.includes("历史项目试卷"));
  if (needsContentService) return { value: "制题", source: "business_requirement" };
  return { value: "不配置", source: normalized ? "business_requirement" : "default_rule" };
}

function buildWarnings(fields) {
  const warnings = [];
  for (const [key, item] of Object.entries(fields)) {
    if (!item.value && item.required) {
      warnings.push({ field: key, message: `${item.label}缺失，需要人工补充` });
    }
  }
  return warnings;
}

export function buildOperationBatchDraft(task = {}, overrides = {}) {
  const business = task.config?.businessRequirement || {};
  const batchNameMode = firstNonEmpty(
    task.config?.fanweiSource?.batchNameMode,
    business.batch_name_mode,
  );
  const estimatedCount = numberText(business.estimated_subject_count);
  const dates = scheduleDates(business);
  const systemType = defaultSystemType(business.system_type);
  const noCentralVenue = centralVenueNotRequired(business.ata_central_venue_required);
  const businessDepartment = operationBusinessDepartment(business.applicant_department);
  const servicePersonnel = personnelServiceFromInvigilatorArrangement(business.ata_invigilator_arrangement);
  const contentService = contentServiceFromParticipation(business.ata_content_participation);
  const projectDepartment = firstNonEmpty(
    task.config?.operationBatch?.projectDepartmentDefault,
    DEFAULT_OPERATION_PROJECT_DEPARTMENT,
  );
  const projectName = firstNonEmpty(
    business.project_name,
    task.projectName,
    task.config?.examName,
    task.config?.examRequirement?.fields?.["考试名称"],
  );
  const projectNameSource = business.project_name || task.projectName
    ? "business_requirement"
    : "easy_exam_requirement";
  const fields = {
    operationTaskSerial: field(business.operation_serial_number, "business_requirement", "考试需求任务单"),
    projectCode: field(business.project_code, "business_requirement", "项目编码"),
    projectName: field(projectName, projectNameSource, "项目名称"),
    businessDirection: field(business.business_direction, "business_requirement", "业务方向"),
    businessDepartment: field(businessDepartment.value, businessDepartment.source, "业务部归属"),
    businessOwner: field(business.applicant, "business_requirement", "业务负责人"),
    batchName: field(
      operationBatchNameForTask(task, business),
      batchNameMode === "manual" ? "manual" : (business.batch_name ? "business_requirement" : "default_rule"),
      "批次名称",
    ),
    projectDepartment: field(projectDepartment, "default_rule", "项目部归属"),
    examStartDate: field(dates.start, "business_requirement", "考试开始日期"),
    examEndDate: field(dates.end, "business_requirement", "考试结束日期"),
    serviceExam: field(systemType === "易考" ? "易考" : systemType, "default_rule", "考试服务"),
    servicePersonnel: field(servicePersonnel.value, servicePersonnel.source, "人员服务"),
    contentParticipation: field(business.ata_content_participation, "business_requirement", "内容制题参与方式"),
    contentService: field(contentService.value, contentService.source, "内容服务"),
    estimatedTotalSubjectCount: field(estimatedCount, "business_requirement", "预估总考量"),
    estimatedMaxSubjectCount: field(estimatedCount, "default_rule", "预估单场最大科次数"),
    estimatedCityCount: field(noCentralVenue ? "0" : "", noCentralVenue ? "default_rule" : "manual", "预估城市数"),
    systemType: field(systemType, business.system_type ? "business_requirement" : "default_rule", "系统类型"),
    stationUsage: field(noCentralVenue ? "无需考站" : "", noCentralVenue ? "default_rule" : "manual", "使用考站情况"),
    arrangementService: field(systemType === "易考" ? "其它" : "", systemType === "易考" ? "default_rule" : "manual", "编排服务"),
    onlineSettlementArrangementSource: field(systemType === "易考" ? "其它" : "", systemType === "易考" ? "default_rule" : "manual", "在线结算编排来源"),
    billingBasis: field(business.billing_basis, "business_requirement", "结算依据"),
    remark: field("", "manual", "备注"),
  };
  for (const [key, value] of Object.entries(overrides.fields || {})) {
    // Source-owned fields must win over stale persisted draft values.
    if (["projectName", "batchName", "examStartDate", "examEndDate", "servicePersonnel"].includes(key) || !fields[key]) continue;
    // A failed clipboard/encoding path can persist replacement characters in a manual override.
    // Keep the source value so the corrupted text cannot reach the operation console.
    if (hasOperationBatchTextReplacementCharacter(value)) continue;
    if (key === "businessDepartment") {
      const businessDepartmentOverride = operationBusinessDepartment(value);
      fields[key] = { ...fields[key], ...businessDepartmentOverride };
      continue;
    }
    fields[key] = { ...fields[key], value: text(value), source: "manual" };
  }
  fields.operationTaskSerial.required = true;
  fields.batchName.required = true;
  fields.projectDepartment.required = true;
  fields.servicePersonnel.required = true;
  fields.estimatedTotalSubjectCount.required = true;
  fields.estimatedMaxSubjectCount.required = true;
  fields.estimatedCityCount.required = true;
  fields.systemType.required = true;
  fields.stationUsage.required = true;
  fields.arrangementService.required = true;
  fields.onlineSettlementArrangementSource.required = true;
  fields.billingBasis.required = true;

  return {
    project: {
      taskId: text(task.taskId),
      projectName: text(task.projectName || business.project_name),
      requirementRequestId: text(task.config?.requirementRequestId || task.config?.initialRequirementRequestId),
    },
    fields,
    warnings: buildWarnings(fields),
    createdAt: new Date().toISOString(),
  };
}

export function applyOperationBatchResult(task = {}, result = {}) {
  const code = text(result.operationBatchCode || result.code);
  if (!code) throw new Error("缺少运营批次代码");
  const current = task.config?.operationBatch || {};
  const batchName = firstNonEmpty(
    result.operationBatchName,
    result.batchName,
    result.batch_name,
    current.batchName,
  );
  const events = Array.isArray(current.events) ? current.events.slice() : [];
  events.push({
    type: "operation_batch_created",
    code,
    status: text(result.status || "created_unpublished"),
    at: new Date().toISOString(),
  });
  return {
    operationBatchCode: code,
    operationBatch: {
      ...current,
      code,
      ...(batchName ? { batchName } : {}),
      batchGuid: text(result.batchGuid),
      detailUrl: text(result.detailUrl),
      status: text(result.status || "created_unpublished"),
      errorCode: text(result.errorCode),
      errorMessage: text(result.errorMessage),
      updatedAt: new Date().toISOString(),
      events,
    },
    scoreStampBatchName: firstNonEmpty(task.config?.scoreStampBatchName, batchName),
  };
}

export function operationBatchCodeIsValid(value) {
  return /^[A-Z]{3}\d{6}$/.test(text(value));
}

export function operationBatchNeedsReconciliation(task = {}) {
  const current = task.config?.operationBatch || {};
  const code = firstNonEmpty(task.config?.operationBatchCode, current.code);
  if (operationBatchCodeIsValid(code)) return false;
  if (code) return true;
  return ["creating", "reconciling", "reconciliation_required"].includes(current.status)
    || current.errorCode === OPERATION_BATCH_RECONCILIATION_REQUIRED
    || current.errorMessage === "创建完成，但未能从详情页读取批次代码";
}

export function operationBatchDraftForReconciliation(task = {}) {
  const savedDraft = task.config?.operationBatch?.draft;
  if (savedDraft && typeof savedDraft === "object" && !Array.isArray(savedDraft)) return savedDraft;
  return buildOperationBatchDraft(task);
}

export function resolveOperationBatchResultWrite(task = {}, result = {}) {
  const operationBatchCode = text(result.operationBatchCode || result.code);
  if (!operationBatchCode) throw new Error("缺少运营批次代码");
  if (!operationBatchCodeIsValid(operationBatchCode)) throw new Error("运营批次代码格式不合法");
  const existingCodes = [text(task.config?.operationBatchCode), text(task.config?.operationBatch?.code)];
  const existingOperationBatchCode = existingCodes.find(operationBatchCodeIsValid) || firstNonEmpty(...existingCodes);
  if (operationBatchCodeIsValid(existingOperationBatchCode)) {
    return {
      status: existingOperationBatchCode === operationBatchCode ? "idempotent" : "conflict",
      operationBatchCode,
      existingOperationBatchCode,
    };
  }
  return { status: "apply", operationBatchCode, patch: applyOperationBatchResult(task, result) };
}

export function operationBatchFailureState(error, externalBatchConfirmed = false) {
  const reconciliationRequired = externalBatchConfirmed || error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED;
  return {
    status: reconciliationRequired ? "reconciliation_required" : "failed",
    errorCode: reconciliationRequired ? OPERATION_BATCH_RECONCILIATION_REQUIRED : "",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

export function operationBatchDisplayId(task = {}) {
  return firstNonEmpty(task.config?.operationBatchCode, task.config?.operationBatch?.code, task.config?.requirementRequestId, task.config?.initialRequirementRequestId);
}

export function acquireOperationBatchCreation(inFlight, taskId) {
  if (inFlight.has(taskId)) {
    const error = new Error("运营批次正在创建，请勿重复提交");
    error.status = 409;
    throw error;
  }
  inFlight.add(taskId);
}

export function releaseOperationBatchCreation(inFlight, taskId) {
  inFlight.delete(taskId);
}
