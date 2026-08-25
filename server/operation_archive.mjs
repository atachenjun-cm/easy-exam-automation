import { createHash } from "node:crypto";

function text(value) {
  return String(value ?? "").trim();
}

function normalizePersonalityAssessmentScope(value) {
  const normalized = text(value);
  return normalized === "仅有OPA" ? "仅考OPA" : normalized;
}

function numberText(value) {
  const normalized = text(value).replaceAll(",", "");
  if (!normalized) return "";
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? String(number) : normalized;
}

function first(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeDate(value) {
  const match = text(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function normalizeExamType(systemType) {
  const value = text(systemType);
  if (["易考", "悦考", "机考"].some((item) => value.includes(item))) return "机考";
  if (value.includes("纸笔")) return "纸笔考";
  if (value.includes("面试")) return "面试";
  return value ? "其它" : "";
}

function normalizeServiceScope(value) {
  const normalized = text(value);
  if (normalized.includes("全流程")) return "全流程服务";
  const exact = OPERATION_ARCHIVE_OPTIONS.operationServiceScope.find((item) => normalized.includes(item));
  return exact || "";
}

function normalizeRegistrationMode(value) {
  const normalized = text(value);
  if (/客户.*(提供|报名表|数据)/.test(normalized)) return "客户提供报名数据";
  if (/ATA.*报名|在线报名/.test(normalized)) return "ATA报名系统在线报名";
  if (/无需报名|不需要报名/.test(normalized)) return "无需报名";
  return "";
}

function normalizeRegistrationSystem(value, mode) {
  const normalized = text(value);
  for (const option of OPERATION_ARCHIVE_OPTIONS.registrationSystemType) {
    if (normalized.includes(option)) return option;
  }
  return mode ? "其它" : "";
}

function formalSessions(task = {}) {
  return (Array.isArray(task.sessions) ? task.sessions : [])
    .filter((session) => text(session?.sessionType || session?.session_type) === "formal");
}

function nextDate(value) {
  const parts = normalizeDate(value)?.split("-").map(Number);
  if (!parts || parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return "";
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
  return date.toISOString().slice(0, 10);
}

export function operationArchiveActualDataWindow(task = {}, options = {}) {
  const endDates = formalSessions(task)
    .map((session) => normalizeDate(session?.end || session?.end_time))
    .filter(Boolean)
    .sort();
  if (!endDates.length) {
    return { ready: false, lastFormalDate: "", availableDate: "", availableAt: "", availableText: "" };
  }
  const lastFormalDate = endDates.at(-1);
  const availableDate = nextDate(lastFormalDate);
  const availableAt = availableDate ? `${availableDate}T08:00:00+08:00` : "";
  const availableText = availableDate ? `${availableDate} 08:00` : "";
  const current = options.now
    ? new Date(options.now)
    : options.today
      ? new Date(`${normalizeDate(options.today)}T00:00:00+08:00`)
      : new Date();
  return {
    ready: Boolean(availableAt && Number.isFinite(current.getTime()) && current.getTime() >= Date.parse(availableAt)),
    lastFormalDate,
    availableDate,
    availableAt,
    availableText,
  };
}

export function operationArchiveActualsFromScoreRows(rows = []) {
  const candidates = Array.isArray(rows) ? rows : [];
  const completed = candidates.filter((row) => {
    const status = text(row?.exam_status || row?.examStatus || row?.status);
    const score = text(row?.score);
    return ["已完成", "参考"].includes(status) || score !== "";
  });
  return {
    candidateSubjects: String(candidates.length),
    completedSubjects: String(completed.length),
  };
}

function courseCount(task = {}, business = {}) {
  const requirements = Array.isArray(task.config?.examRequirements) && task.config.examRequirements.length
    ? task.config.examRequirements
    : task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
  const courses = requirements.flatMap((requirement) => (
    Array.isArray(requirement?.config?.courses) ? requirement.config.courses : []
  ));
  const fallback = Array.isArray(task.config?.courses) ? task.config.courses : [];
  const values = (courses.length ? courses : fallback)
    .map((course) => first(course?.code, course?.name))
    .filter(Boolean);
  return numberText(values.length ? new Set(values).size : business.subject_count);
}

function paperBindingResults(task = {}) {
  const states = Array.isArray(task.config?.paperFormBinds) && task.config.paperFormBinds.length
    ? task.config.paperFormBinds
    : task.config?.paperFormBind ? [task.config.paperFormBind] : [];
  return states.flatMap((state) => (
    state?.status === "success" && Array.isArray(state.result?.bindResult?.results)
      ? state.result.bindResult.results
      : []
  ));
}

function paperUnitInfos(item = {}) {
  if (item.unit_info) return [item.unit_info];
  return Array.isArray(item.unit_infos) ? item.unit_infos : [];
}

export function operationArchiveAssessmentFromPapers(task = {}) {
  const results = paperBindingResults(task);
  const expectedPaperCount = results.reduce((sum, item) => (
    sum + (Array.isArray(item.form_codes) ? item.form_codes.filter(Boolean).length : 0)
  ), 0);
  const infos = results.flatMap(paperUnitInfos);
  if (!expectedPaperCount || infos.length < expectedPaperCount) {
    return { complete: false, personalityAssessment: "", personalityAssessmentScope: "" };
  }
  const modes = infos.map((info) => text(info?.assessment_mode) || "none");
  const assessmentCount = modes.filter((mode) => mode !== "none").length;
  if (!assessmentCount) {
    return { complete: true, personalityAssessment: "否", personalityAssessmentScope: "" };
  }
  const onlyAssessment = assessmentCount === modes.length && modes.every((mode) => mode === "only_opa");
  return {
    complete: true,
    personalityAssessment: "是",
    personalityAssessmentScope: onlyAssessment ? "仅考OPA" : "考试内容包含OPA",
  };
}

function paperCount(task = {}, business = {}) {
  const codes = paperBindingResults(task).flatMap((item) => (
    Array.isArray(item.form_codes) ? item.form_codes : []
  )).map(text).filter(Boolean);
  return numberText(codes.length ? new Set(codes).size : business.paper_count);
}

function percentText(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return "";
  return (numerator * 100 / denominator).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function sourceField(value, source, label, options = {}) {
  return {
    value: options.control === "number" ? numberText(value) : text(value),
    source,
    label,
    required: options.required === true,
    editable: options.editable !== false,
    control: options.control || "text",
    ...(options.hidden ? { hidden: true } : {}),
    ...(options.options ? { options: [...options.options] } : {}),
  };
}

export const OPERATION_ARCHIVE_OPTIONS = Object.freeze({
  yesNo: ["否", "是"],
  personalityAssessmentScope: ["考试内容包含OPA", "仅考OPA"],
  examType: ["机考", "纸笔考", "面试", "其它"],
  operationServiceScope: [
    "全流程服务",
    "单项服务：落实考位或监督考",
    "单项服务：系统数据操作",
    "单项服务：报名服务",
    "单项服务：考务文档整理",
    "单项服务：考生通知服务",
    "单项服务：客服或技术支持服务",
    "单项服务：提供顾问、咨询服务",
    "单项服务：其它",
  ],
  registrationMode: ["ATA报名系统在线报名", "客户提供报名数据", "无需报名"],
  registrationSystemType: ["上座", "H5", "易考", "在线考务", "其它"],
});

export const OPERATION_ARCHIVE_EDITABLE_FIELDS = Object.freeze([
  "personalityAssessment",
  "personalityAssessmentScope",
  "examType",
  "operationServiceScope",
  "operationOrganizationService",
  "registrationMode",
  "registrationSystemType",
  "ataRegistrationSubjects",
  "ataRegistrationAdjustmentReason",
  "registrationSubjects",
  "registrationAdjustmentReason",
  "openSubjects",
  "openSubjectsAdjustmentReason",
  "attendedSubjects",
  "attendedSubjectsAdjustmentReason",
  "averageAttendanceRate",
  "implementationUsers",
  "implementationSites",
  "implementationRooms",
  "implementationSessions",
  "implementationPapers",
  "implementationSubjects",
  "scheduleCount",
]);

export const OPERATION_ARCHIVE_FIELD_ORDER = Object.freeze([
  "projectCode",
  "projectName",
  "businessDepartment",
  "businessOwner",
  "batchCode",
  "batchName",
  "projectManager",
  "projectDepartment",
  "examVenueDisplayName",
  "personalityAssessment",
  "personalityAssessmentScope",
  "examType",
  "operationServiceScope",
  "operationOrganizationService",
  "stationUsage",
  "examDateRange",
  "examStartDate",
  "examEndDate",
  "cityCount",
  "registrationMode",
  "registrationSystemType",
  "systemType",
  "arrangementService",
  "settlementArrangementSource",
  "billingBasis",
  "ataRegistrationSubjects",
  "ataRegistrationAdjustmentReason",
  "registrationSubjects",
  "registrationAdjustmentReason",
  "openSubjects",
  "openSubjectsAdjustmentReason",
  "attendedSubjects",
  "attendedSubjectsAdjustmentReason",
  "averageAttendanceRate",
  "implementationUsers",
  "implementationSites",
  "implementationRooms",
  "implementationSessions",
  "implementationPapers",
  "implementationSubjects",
  "scheduleCount",
  "remark",
]);

export function operationArchiveFieldValues(draft = {}) {
  return Object.fromEntries(Object.entries(draft.fields || {}).map(([key, field]) => [key, text(field?.value)]));
}

export function operationArchiveFingerprint(draft = {}) {
  return createHash("sha256")
    .update(JSON.stringify(operationArchiveFieldValues(draft)))
    .digest("hex");
}

export function buildOperationArchiveDraft(task = {}, options = {}) {
  const business = task.config?.businessRequirement || {};
  const batch = task.config?.operationBatch || {};
  const batchFields = batch.draft?.fields || {};
  const sessions = formalSessions(task);
  const apiCandidateSubjects = text(options.actuals?.candidateSubjects);
  const actualCandidates = apiCandidateSubjects
    ? Number(apiCandidateSubjects)
    : sessions.reduce((sum, session) => sum + Number(session.candidateCount || 0), 0);
  const actualCompletedText = text(options.actuals?.completedSubjects);
  const actualCompleted = actualCompletedText ? Number(actualCompletedText) : Number.NaN;
  const dates = sessions.map((session) => ({
    start: normalizeDate(session.start || session.start_time),
    end: normalizeDate(session.end || session.end_time),
  }));
  const examStartDate = first(dates[0]?.start, batchFields.examStartDate?.value);
  const examEndDate = first(dates.at(-1)?.end, dates.at(-1)?.start, batchFields.examEndDate?.value, examStartDate);
  const plannedSubjects = numberText(first(business.estimated_subject_count, batchFields.estimatedTotalSubjectCount?.value));
  const registrationMode = normalizeRegistrationMode(business.registration_method);
  const assessment = options.actuals?.assessment || operationArchiveAssessmentFromPapers(task);
  const persistedEdits = task.config?.operationArchive?.edits || {};
  const value = (key, fallback) => Object.hasOwn(persistedEdits, key) ? persistedEdits[key] : fallback;
  const personalityAssessment = value("personalityAssessment", assessment.personalityAssessment);
  const personalityAssessmentScope = personalityAssessment === "是"
    ? normalizePersonalityAssessmentScope(value("personalityAssessmentScope", assessment.personalityAssessmentScope))
    : "";
  const fields = {
    projectCode: sourceField(first(business.project_code, task.config?.projectCode), "fanwei", "项目编码", { required: true, editable: false, hidden: true }),
    projectName: sourceField(first(business.project_name, task.projectName), "fanwei", "项目名称", { required: true, editable: false, hidden: true }),
    businessDepartment: sourceField(batchFields.businessDepartment?.value, "fanwei", "业务部归属", { editable: false, hidden: true }),
    businessOwner: sourceField(batchFields.businessOwner?.value, "fanwei", "业务负责人", { editable: false, hidden: true }),
    batchCode: sourceField(first(task.config?.operationBatchCode, batch.code), "operation_result", "运营批次代码", { required: true, editable: false, hidden: true }),
    batchName: sourceField(first(batch.draft?.fields?.batchName?.value, business.batch_name), "operation_result", "批次名称", { required: true, editable: false, hidden: true }),
    projectManager: sourceField(first(batchFields.projectManager?.value, business.project_manager), "fanwei", "项目经理", { editable: false, hidden: true }),
    projectDepartment: sourceField(batchFields.projectDepartment?.value, "operation_result", "项目部归属", { editable: false, hidden: true }),
    examVenueDisplayName: sourceField(first(batchFields.examVenueDisplayName?.value, batch.examVenueDisplayName), "operation_result", "考场显示名称", { editable: false, hidden: true }),
    personalityAssessment: sourceField(personalityAssessment, "actual_result", "是否包含性格测评", { required: true, control: "select", options: OPERATION_ARCHIVE_OPTIONS.yesNo }),
    personalityAssessmentScope: sourceField(personalityAssessmentScope, "actual_result", "包含性格测评", { required: personalityAssessment === "是", control: "select", options: OPERATION_ARCHIVE_OPTIONS.personalityAssessmentScope }),
    examType: sourceField(value("examType", normalizeExamType(business.system_type)), "fanwei", "考试类型", { required: true, control: "select", options: OPERATION_ARCHIVE_OPTIONS.examType }),
    operationServiceScope: sourceField(value("operationServiceScope", normalizeServiceScope(business.exam_service_scope)), "fanwei", "运营服务范围", { required: true, control: "select", options: OPERATION_ARCHIVE_OPTIONS.operationServiceScope }),
    operationOrganizationService: sourceField(value("operationOrganizationService", "是"), "operation_result", "运营组织服务工作", { control: "select", options: OPERATION_ARCHIVE_OPTIONS.yesNo }),
    stationUsage: sourceField(batchFields.stationUsage?.value, "operation_result", "使用考站情况", { required: true, editable: false }),
    examDateRange: sourceField(examStartDate && examEndDate ? `${examStartDate} ~ ${examEndDate}` : "", "actual_result", "考试日期", { required: true, editable: false }),
    examStartDate: sourceField(examStartDate, "actual_result", "考试开始日期", { required: true, editable: false, hidden: true }),
    examEndDate: sourceField(examEndDate, "actual_result", "考试结束日期", { required: true, editable: false, hidden: true }),
    cityCount: sourceField(batchFields.estimatedCityCount?.value, "operation_result", "开考城市数", { required: true, editable: false, control: "number" }),
    registrationMode: sourceField(value("registrationMode", registrationMode), "fanwei", "报名模式类型", { required: true, control: "select", options: OPERATION_ARCHIVE_OPTIONS.registrationMode }),
    registrationSystemType: sourceField(value("registrationSystemType", normalizeRegistrationSystem(business.registration_website_required, registrationMode)), "fanwei", "报名系统类型", { control: "select", options: OPERATION_ARCHIVE_OPTIONS.registrationSystemType }),
    systemType: sourceField(first(batchFields.systemType?.value, business.system_type), "operation_result", "系统类型", { required: true, editable: false }),
    arrangementService: sourceField(batchFields.arrangementService?.value, "operation_result", "编排服务", { required: true, editable: false }),
    settlementArrangementSource: sourceField(batchFields.onlineSettlementArrangementSource?.value, "operation_result", "在线结算编排来源", { required: true, editable: false }),
    billingBasis: sourceField(first(batchFields.billingBasis?.value, business.billing_basis), "fanwei", "结算依据", { required: true, editable: false }),
    ataRegistrationSubjects: sourceField(value("ataRegistrationSubjects", registrationMode === "ATA报名系统在线报名" ? plannedSubjects : "0"), "fanwei", "ATA系统报名科次", { control: "number" }),
    ataRegistrationAdjustmentReason: sourceField(value("ataRegistrationAdjustmentReason", ""), "actual_result", "调整说明"),
    registrationSubjects: sourceField(value("registrationSubjects", actualCandidates), "actual_result", "报考科次", { required: true, control: "number" }),
    registrationAdjustmentReason: sourceField(value("registrationAdjustmentReason", ""), "actual_result", "调整说明"),
    openSubjects: sourceField(value("openSubjects", actualCandidates), "actual_result", "开考科次", { required: true, control: "number" }),
    openSubjectsAdjustmentReason: sourceField(value("openSubjectsAdjustmentReason", ""), "actual_result", "调整说明"),
    attendedSubjects: sourceField(value("attendedSubjects", Number.isFinite(actualCompleted) ? actualCompleted : ""), "actual_result", "参考科次", { required: true, control: "number" }),
    attendedSubjectsAdjustmentReason: sourceField(value("attendedSubjectsAdjustmentReason", ""), "actual_result", "调整说明"),
    averageAttendanceRate: sourceField(value("averageAttendanceRate", percentText(actualCompleted, actualCandidates)), "actual_result", "平均参考率", { required: true, control: "number" }),
    implementationUsers: sourceField(value("implementationUsers", actualCandidates), "actual_result", "实施总人数", { required: true, control: "number" }),
    implementationSites: sourceField(value("implementationSites", "0"), "actual_result", "实施考站数", { required: true, control: "number" }),
    implementationRooms: sourceField(value("implementationRooms", "0"), "actual_result", "实施考场数", { required: true, control: "number" }),
    implementationSessions: sourceField(value("implementationSessions", sessions.length), "actual_result", "实施场次数", { required: true, control: "number" }),
    implementationPapers: sourceField(value("implementationPapers", paperCount(task, business)), "actual_result", "实施试卷数", { required: true, control: "number" }),
    implementationSubjects: sourceField(value("implementationSubjects", courseCount(task, business)), "actual_result", "实施科目数", { required: true, control: "number" }),
    scheduleCount: sourceField(value("scheduleCount", sessions.length), "actual_result", "考试日程数", { required: true, control: "number" }),
    remark: sourceField(value("remark", ""), "fanwei", "备注", { editable: false, hidden: true }),
  };
  const warnings = Object.entries(fields)
    .filter(([, field]) => field.required && !text(field.value))
    .map(([field, item]) => ({ code: "ARCHIVE_FIELD_REQUIRED", field, message: `${item.label}缺失，需要人工补充` }));
  if (!sessions.length) {
    warnings.push({ code: "ARCHIVE_FORMAL_SESSION_REQUIRED", field: "implementationSessions", message: "未找到已创建的正式考试场次" });
  }
  if (!assessment.complete && !Object.hasOwn(persistedEdits, "personalityAssessment")) {
    warnings.push({ code: "ARCHIVE_PAPER_STRUCTURE_REQUIRED", field: "personalityAssessment", message: "正式考试最终绑定的试卷结构尚未读取，不能判断 OPA 类型" });
  }
  if (text(options.actuals?.errorMessage)) {
    warnings.push({ code: "ARCHIVE_ACTUAL_RESULT_UNAVAILABLE", field: "attendedSubjects", message: `正式考试完成情况读取失败：${text(options.actuals.errorMessage)}` });
  }
  if (options.actuals?.pending === true) {
    warnings.push({
      code: "ARCHIVE_ACTUAL_RESULT_NOT_READY",
      field: "attendedSubjects",
      message: `正式考试数据将在 ${text(options.actuals.availableText) || "考试结束次日 08:00"} 通过接口获取`,
    });
  }
  const actualOrder = Object.keys(fields);
  if (actualOrder.some((key, index) => key !== OPERATION_ARCHIVE_FIELD_ORDER[index])) {
    throw new Error("运控归档字段顺序与运营控制台不一致");
  }
  return {
    schemaVersion: 1,
    fields,
    warnings,
    attachmentsRequired: false,
    createdAt: options.now || new Date().toISOString(),
  };
}

export function editOperationArchiveDraft(task = {}, input = {}, options = {}) {
  const generated = buildOperationArchiveDraft(task, options);
  const submitted = input?.fields && typeof input.fields === "object" ? input.fields : input;
  const edits = { ...(task.config?.operationArchive?.edits || {}) };
  for (const key of OPERATION_ARCHIVE_EDITABLE_FIELDS) {
    if (!Object.hasOwn(submitted || {}, key)) continue;
    const definition = generated.fields[key];
    const raw = submitted[key]?.value ?? submitted[key];
    const normalized = key === "personalityAssessmentScope"
      ? normalizePersonalityAssessmentScope(raw)
      : definition.control === "number" ? numberText(raw) : text(raw);
    if (definition.options && normalized && !definition.options.includes(normalized)) {
      const error = new Error(`${definition.label}不是可用选项`);
      error.code = "OPERATION_ARCHIVE_FIELD_INVALID";
      error.status = 409;
      throw error;
    }
    if (definition.control === "number" && normalized && !/^\d+(?:\.\d+)?$/.test(normalized)) {
      const error = new Error(`${definition.label}必须为非负数`);
      error.code = "OPERATION_ARCHIVE_FIELD_INVALID";
      error.status = 409;
      throw error;
    }
    edits[key] = normalized;
  }
  if (edits.personalityAssessment === "否") edits.personalityAssessmentScope = "";
  const nextTask = {
    ...task,
    config: {
      ...task.config,
      operationArchive: { ...(task.config?.operationArchive || {}), edits },
    },
  };
  return { edits, draft: buildOperationArchiveDraft(nextTask, options) };
}

export function refreshOperationArchiveEvidenceDraft(task = {}, options = {}) {
  const current = task.config?.operationArchive || {};
  const edits = { ...(current.edits || {}) };
  for (const key of ["attendedSubjects", "averageAttendanceRate"]) delete edits[key];
  const baselineTask = {
    ...task,
    config: {
      ...task.config,
      operationArchive: { ...current, edits },
    },
  };
  const generated = buildOperationArchiveDraft(baselineTask, options);
  const submittedSnapshot = current.lastSubmission?.formSnapshot
    || current.lastInspection?.formSnapshot
    || {};
  const unchangedFields = {};
  for (const [key, field] of Object.entries(generated.fields || {})) {
    const previousValue = text(submittedSnapshot[key]);
    if (field.editable
      && !["attendedSubjects", "averageAttendanceRate"].includes(key)
      && !Object.hasOwn(edits, key)
      && previousValue) {
      unchangedFields[key] = previousValue;
    }
  }
  if (!Object.keys(unchangedFields).length) return { edits, draft: generated };
  return editOperationArchiveDraft(baselineTask, { fields: unchangedFields }, options);
}

export function operationArchiveState(task = {}, options = {}) {
  const persisted = task.config?.operationArchive || {};
  const draft = buildOperationArchiveDraft(task, options);
  const status = text(persisted.status) || (draft.warnings.length ? "needs_review" : "ready_for_inspection");
  return {
    schemaVersion: 1,
    status,
    draft,
    draftFingerprint: operationArchiveFingerprint(draft),
    draftVersion: Number(persisted.draftVersion || 0),
    previewToken: text(persisted.previewToken),
    inspectedAt: text(persisted.inspectedAt),
    submittedAt: text(persisted.submittedAt),
    externalStatus: text(persisted.externalStatus),
    errorCode: text(persisted.errorCode),
    errorMessage: text(persisted.errorMessage),
  };
}
