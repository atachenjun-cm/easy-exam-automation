import { buildAutoConfigFromRequirement } from "./requirement_auto_config_adapter.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function listText(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("、");
  return text(value);
}

function minuteText(value) {
  const normalized = text(value);
  if (!normalized) return "";
  return /分钟$/.test(normalized) ? normalized : `${normalized}分钟`;
}

function requirementBooleanText(value, trueText, falseText) {
  if (typeof value === "boolean") return value ? trueText : falseText;
  return text(value);
}

function setMappedField(fields, requirement, sourceKey, targetKey, format = text) {
  if (!Object.hasOwn(requirement, sourceKey)) return;
  fields[targetKey] = format(requirement[sourceKey]);
}

export function requirementFieldsFromStructuredRequirement(requirement = {}, currentFields = {}) {
  const fields = { ...(currentFields || {}) };
  setMappedField(fields, requirement, "exam_name", "考试名称");
  setMappedField(fields, requirement, "formal_exam_time_range", "考试日期时间");
  setMappedField(fields, requirement, "mock_exam_time_range", "试考日期时间");
  setMappedField(fields, requirement, "early_login_minutes", "提前登录时间", minuteText);
  setMappedField(fields, requirement, "late_limit_minutes", "限制迟到时间", minuteText);
  setMappedField(fields, requirement, "time_rule", "试卷扣时规则");
  setMappedField(fields, requirement, "exam_address", "考试地址");
  setMappedField(fields, requirement, "pre_login_prompt", "考前等待提示");
  setMappedField(fields, requirement, "welcome_text", "欢迎语");
  setMappedField(fields, requirement, "pledge_content", "考试承诺书内容");
  setMappedField(fields, requirement, "video_monitor_required", "视频监控", (value) => requirementBooleanText(value, "需要", "不需要"));
  setMappedField(fields, requirement, "video_record_required", "视频录制", (value) => requirementBooleanText(value, "开启录制", "关闭录制"));
  setMappedField(fields, requirement, "hawkeye_required", "鹰眼监控", (value) => requirementBooleanText(value, "需要", "不需要"));
  setMappedField(fields, requirement, "exam_client_type", "考试类型", (value) => {
    const normalized = text(value);
    if (normalized === "web") return "网页考试";
    if (normalized === "client") return "客户端考试";
    return normalized;
  });
  setMappedField(fields, requirement, "client_login_limit", "登陆次数");
  setMappedField(fields, requirement, "manual_score_text", "人工判分");
  if (Object.hasOwn(requirement, "paper_names")) fields["试卷名称"] = listText(requirement.paper_names);
  else if (Object.hasOwn(requirement, "paper_names_text")) fields["试卷名称"] = listText(requirement.paper_names_text);
  if (Object.hasOwn(requirement, "subjects")) fields["科目信息"] = listText(requirement.subjects);
  else if (Object.hasOwn(requirement, "subjects_text")) fields["科目信息"] = listText(requirement.subjects_text);
  return fields;
}

function taskExamRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
}

function mergeRequirementCoursePaperNames(currentCourses = [], generatedCourses = []) {
  return (Array.isArray(currentCourses) ? currentCourses : []).map((course, index) => {
    const next = { ...course };
    const generated = generatedCourses[index] || {};
    const paperName = text(generated.paper_name || generated.paperName);
    if (paperName) next.paper_name = paperName;
    else delete next.paper_name;
    return next;
  });
}

function createdSessions(task = {}) {
  return (Array.isArray(task.sessions) ? task.sessions : []).filter((session) => text(session?.session_id || session?.id));
}

export function syncAcceptedRequirementToTask({ task = {}, requirement = {}, changeId = "", now = new Date().toISOString() } = {}) {
  const structured = requirement.latest?.requirement || {};
  const currentRequirements = taskExamRequirements(task);
  const current = currentRequirements[0] || task.config?.examRequirement || {
    id: "requirement-1",
    order: 1,
    version: 0,
    fields: {},
    config: {},
  };
  const currentConfig = current.config || {};
  const fields = requirementFieldsFromStructuredRequirement(structured, current.fields || {});
  const generated = buildAutoConfigFromRequirement(structured, {
    customerName: task.config?.customerName || currentConfig.customerName || structured.customer_name || "",
  });
  const generatedConfig = generated.config || {};
  const sessions = createdSessions(task);
  const subjectsUnchanged = JSON.stringify(currentConfig.subjects || []) === JSON.stringify(generatedConfig.subjects || []);
  const courseBasisUnchanged = subjectsUnchanged
    && text(currentConfig.startTimeDisplay) === text(generatedConfig.startTimeDisplay);
  const preserveCreatedCourses = sessions.length > 0 && subjectsUnchanged;
  const persistedCourses = preserveCreatedCourses && Array.isArray(task.config?.courses) && task.config.courses.length
    ? task.config.courses
    : currentConfig.courses;
  const config = {
    ...currentConfig,
    ...generatedConfig,
    ...(courseBasisUnchanged || preserveCreatedCourses ? {
      courses: mergeRequirementCoursePaperNames(persistedCourses, generatedConfig.courses),
      subjectImportPath: currentConfig.subjectImportPath || generatedConfig.subjectImportPath || "",
    } : {}),
    apiKeyProfileId: currentConfig.apiKeyProfileId || "",
  };
  const examRequirement = {
    ...current,
    version: Number(current.version || 0) + 1,
    modifiedAt: now,
    confirmedAt: now,
    fields,
    config,
  };
  const examRequirements = currentRequirements.length ? [...currentRequirements] : [examRequirement];
  examRequirements[0] = examRequirement;
  const sessionIds = sessions.map((session) => text(session.session_id || session.id));
  const status = sessions.length ? "pending_session_sync" : "requirement_updated";
  const requirementVersion = Number(requirement.latest?.version || 0);
  const wechatRequirementSync = {
    status,
    requirementRequestId: text(requirement.requestId || task.config?.requirementRequestId),
    changeId: text(changeId),
    requirementVersion,
    reviewedAt: now,
    affectedSessionIds: sessionIds,
  };
  return {
    configPatch: {
      examRequirements,
      examRequirement,
      examName: text(fields["考试名称"] || config.examName || task.config?.examName || ""),
      wechatRequirementSync,
    },
    sessionImpact: {
      hasCreatedSessions: sessions.length > 0,
      status,
      affectedSessionIds: sessionIds,
      requirementVersion,
    },
  };
}
