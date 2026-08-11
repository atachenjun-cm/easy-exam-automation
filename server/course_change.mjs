function text(value) {
  return String(value ?? "").trim();
}

function compactNames(values = []) {
  return values.map(text).filter(Boolean);
}

export function normalizeCourseChangeNames(value) {
  if (Array.isArray(value)) return compactNames(value);
  return compactNames(String(value || "").split(/[\n,，;；、]+/));
}

function normalizeFormCodes(value) {
  if (Array.isArray(value)) return compactNames(value);
  return normalizeCourseChangeNames(value);
}

function normalizeStoredCourses(courses = []) {
  return (Array.isArray(courses) ? courses : [])
    .map((course, index) => {
      const code = text(course?.code || course?.course_code);
      const name = text(course?.name || course?.course_name || course?.title);
      if (!code || !name) return null;
      return {
        ...course,
        code,
        name,
        form_codes: normalizeFormCodes(course?.form_codes || course?.formCodes || code),
        order: Number(course?.order || index + 1),
      };
    })
    .filter(Boolean);
}

function taskRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
}

export function taskCoursesForChange(task = {}, requirementIndex = 0) {
  const index = Math.max(Number(requirementIndex || 0), 0);
  if (index === 0) {
    const rootCourses = normalizeStoredCourses(task.config?.courses);
    if (rootCourses.length) return rootCourses;
  }

  const createStep = (Array.isArray(task.steps) ? task.steps : [])
    .find((step) => step.stepKey === "course_create") || {};
  const requirementCourses = normalizeStoredCourses(
    createStep.requirementProgress?.[String(index)]?.result?.courses,
  );
  if (requirementCourses.length) return requirementCourses;
  if (index === 0) {
    const stepCourses = normalizeStoredCourses(createStep.result?.courses);
    if (stepCourses.length) return stepCourses;
  }

  return normalizeStoredCourses(taskRequirements(task)[index]?.config?.courses);
}

export function requirementCourseNames(task = {}, requirementIndex = 0) {
  const index = Math.max(Number(requirementIndex || 0), 0);
  const requirement = taskRequirements(task)[index] || {};
  const config = requirement.config || {};
  const subjects = normalizeCourseChangeNames(config.subjects);
  if (subjects.length) return subjects;
  const courseNames = normalizeStoredCourses(config.courses).map((course) => course.name);
  if (courseNames.length) return courseNames;
  return normalizeCourseChangeNames(requirement.fields?.["科目信息"]);
}

function courseChangeStep(task = {}) {
  return (Array.isArray(task.steps) ? task.steps : []).find((step) => step.stepKey === "course_change") || {};
}

export function courseChangeHistoryFromStep(step = {}) {
  return Array.isArray(step?.result?.history) ? step.result.history : [];
}

function appliedCourseRequirementChangeIds(task = {}, requirementIndex = 0) {
  const index = Math.max(Number(requirementIndex || 0), 0);
  const legacy = courseChangeHistoryFromStep(courseChangeStep(task))
    .filter((record) => Number(record.requirementIndex || 0) === index && record.requirementChangeApplied)
    .map((record) => text(record.requirementChangeId));
  const combinedStep = (Array.isArray(task.steps) ? task.steps : [])
    .find((step) => step.stepKey === "session_change") || {};
  const combined = (Array.isArray(combinedStep?.result?.history) ? combinedStep.result.history : [])
    .filter((record) => Number(record.courseRequirementIndex || 0) === index && record.courseRequirementChangeApplied)
    .map((record) => text(record.courseRequirementChangeId));
  return new Set([...legacy, ...combined].filter(Boolean));
}

function latestCourseSourceChange(task = {}, requirementIndex = 0) {
  const index = Math.max(Number(requirementIndex || 0), 0);
  const history = Array.isArray(task.config?.projectSourceChangeHistory)
    ? task.config.projectSourceChangeHistory
    : Array.isArray(task.config?.examRequirementChangeHistory)
      ? task.config.examRequirementChangeHistory
      : [];
  const manual = [...history].reverse().find((record) => (
    ["examRequirement", "project_requirement_editor"].includes(text(record.source))
    && Math.max(Number(record.requirementIndex || 0), 0) === index
    && (Array.isArray(record.changes) ? record.changes : []).some((change) => text(change.field) === "科目信息")
  ));
  if (manual) return manual;

  const sync = task.config?.wechatRequirementSync || {};
  const hasCourseChange = (Array.isArray(sync.changes) ? sync.changes : [])
    .some((change) => text(change.field) === "科目信息");
  if (sync.status !== "pending_session_sync" || !hasCourseChange || index !== 0) return null;
  return {
    changeId: text(sync.changeId) || `requirement-v${Number(sync.requirementVersion || 0)}`,
    changedAt: sync.reviewedAt || "",
    changes: sync.changes,
    requirementVersion: Number(sync.requirementVersion || 0),
    source: "wechat",
  };
}

export function courseRequirementChangeForTaskSession(task = {}, session = {}) {
  if (text(session.sessionType) !== "formal") return { pending: false, label: "", suggestedNames: [] };
  const requirementIndex = Math.max(Number(session.requirementIndex || 0), 0);
  const latest = latestCourseSourceChange(task, requirementIndex);
  if (!latest) return { pending: false, label: "", suggestedNames: [] };
  const changeId = text(latest.changeId);
  if (changeId && appliedCourseRequirementChangeIds(task, requirementIndex).has(changeId)) {
    return { pending: false, label: "", changeId, suggestedNames: [] };
  }
  const suggestedNames = requirementCourseNames(task, requirementIndex);
  if (!suggestedNames.length) return { pending: false, label: "", changeId, suggestedNames: [] };
  return {
    pending: true,
    label: "科目有变请确认",
    changeId,
    changedAt: latest.changedAt || "",
    requirementIndex,
    requirementVersion: Number(latest.requirementVersion || 0),
    source: latest.source || "",
    suggestedNames,
  };
}

export function enrichTaskCourseRequirementChanges(task = {}) {
  const sessions = (Array.isArray(task.sessions) ? task.sessions : []).map((session) => ({
    ...session,
    courseRequirementChange: courseRequirementChangeForTaskSession(task, session),
  }));
  const pendingCount = sessions.filter((session) => session.courseRequirementChange?.pending).length;
  return {
    ...task,
    sessions,
    courseRequirementChangeSummary: {
      pending: pendingCount > 0,
      pendingCount,
      label: pendingCount ? "科目有变请确认" : "",
    },
  };
}

function unwrapCourseDetail(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    if (!payload.code && !payload.course_code && !payload.name && !payload.res && !payload.form_codes) return payload.data;
  }
  return payload;
}

function formCodesFromDetail(payload) {
  const detail = unwrapCourseDetail(payload);
  const sources = [
    detail.res,
    detail.results,
    detail.forms,
    detail.form_codes,
    detail.formCodes,
    detail.data?.res,
    detail.data?.results,
    detail.data?.forms,
    detail.data?.form_codes,
    detail.data?.formCodes,
  ];
  const present = sources.filter((value) => Array.isArray(value) || typeof value === "string");
  if (!present.length) {
    const error = new Error("易考科目试卷绑定查询返回格式不正确，为避免清空绑定已停止修改。");
    error.status = 502;
    throw error;
  }
  return [...new Set(present.flatMap((value) => (
    Array.isArray(value)
      ? compactNames(value.map((item) => (
        item && typeof item === "object" ? item.code || item.form_code || item.formCode : item
      )))
      : normalizeFormCodes(value)
  )))];
}

export async function fetchTenantCourseSnapshot({ apiBase, code, requestJson, login }) {
  const base = text(apiBase).replace(/\/+$/, "");
  const courseCode = text(code);
  if (!courseCode) {
    const error = new Error("缺少已创建的科目编号，不能修改科目信息。");
    error.status = 400;
    throw error;
  }
  const encodedCode = encodeURIComponent(courseCode);
  const [sessionPayload, formPayload] = await Promise.all([
    requestJson(
      login,
      `${base}/tenant/api/courses/${encodedCode}/?apply=session`,
      { method: "GET" },
      `查询科目场次 ${courseCode}`,
    ),
    requestJson(
      login,
      `${base}/tenant/api/courses/${encodedCode}/?apply=form`,
      { method: "GET" },
      `查询科目试卷 ${courseCode}`,
    ),
  ]);
  const detail = unwrapCourseDetail(sessionPayload);
  const actualCode = text(detail.code || detail.course_code || courseCode);
  const name = text(detail.name || detail.course_name);
  if (!name) {
    const error = new Error(`易考未返回科目 ${courseCode} 的名称，已停止修改。`);
    error.status = 502;
    throw error;
  }
  return {
    code: actualCode,
    name,
    form_codes: formCodesFromDetail(formPayload),
    session_count: Array.isArray(detail.res) ? detail.res.length : 0,
  };
}

export async function fetchTenantCourseSnapshots({ apiBase, courses, requestJson, login, emitLog = () => {} }) {
  const storedCourses = normalizeStoredCourses(courses);
  const snapshots = [];
  for (const course of storedCourses) {
    const snapshot = await fetchTenantCourseSnapshot({ apiBase, code: course.code, requestJson, login });
    snapshots.push(snapshot);
    emitLog(`已通过易考接口查询科目：${snapshot.name} / ${snapshot.code}`);
  }
  return snapshots;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function buildCourseChangePlan(snapshots = [], requestedNames = []) {
  const names = normalizeCourseChangeNames(requestedNames);
  if (!names.length) throw validationError("科目信息不能为空。");
  if (!Array.isArray(snapshots) || !snapshots.length) throw validationError("未找到已创建的易考科目。");
  if (names.length !== snapshots.length) {
    throw validationError(`当前已创建 ${snapshots.length} 个科目，本次提交 ${names.length} 个；为避免影响现有绑定，仅支持科目数量不变时修改名称。`);
  }
  return snapshots.map((snapshot, index) => ({
    before: snapshot,
    afterName: names[index],
    changed: text(snapshot.name) !== names[index],
  }));
}

function sameStringList(left = [], right = []) {
  const a = compactNames(left).sort();
  const b = compactNames(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function applyTenantCourseChanges({
  apiBase,
  snapshots,
  requestedNames,
  requestJson,
  login,
  emitLog = () => {},
}) {
  const base = text(apiBase).replace(/\/+$/, "");
  const plan = buildCourseChangePlan(snapshots, requestedNames);
  const verified = [];
  for (const item of plan) {
    if (!item.changed) {
      verified.push(item.before);
      continue;
    }
    const payload = {
      code: item.before.code,
      name: item.afterName,
      form_codes: item.before.form_codes,
    };
    await requestJson(
      login,
      `${base}/tenant/api/course/`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      `修改科目 ${item.before.code}`,
    );
    emitLog(`已调用易考接口修改科目：${item.before.name} → ${item.afterName} / ${item.before.code}`);
    const snapshot = await fetchTenantCourseSnapshot({
      apiBase: base,
      code: item.before.code,
      requestJson,
      login,
    });
    if (snapshot.name !== item.afterName) {
      const error = new Error(`科目 ${item.before.code} 回查名称不一致，修改未确认完成。`);
      error.status = 502;
      throw error;
    }
    if (!sameStringList(snapshot.form_codes, item.before.form_codes)) {
      const error = new Error(`科目 ${item.before.code} 的试卷绑定回查不一致，修改未确认完成。`);
      error.status = 502;
      throw error;
    }
    emitLog(`已回查确认科目：${snapshot.name} / ${snapshot.code}，保留 ${snapshot.form_codes.length} 个试卷绑定`);
    verified.push(snapshot);
  }
  return {
    changed: plan.some((item) => item.changed),
    diff: plan.filter((item) => item.changed).map((item) => ({
      field: "course_name",
      label: "科目信息",
      code: item.before.code,
      before: item.before.name,
      after: item.afterName,
    })),
    courses: verified,
  };
}

export function appendCourseChangeHistory(existing = [], record = {}) {
  const history = Array.isArray(existing) ? existing : [];
  const item = {
    id: record.id || `course-${Date.now()}`,
    changedAt: record.changedAt || new Date().toISOString(),
    operator: text(record.operator),
    requirementIndex: Math.max(Number(record.requirementIndex || 0), 0),
    apiBase: text(record.apiBase),
    status: record.status || "success",
    diff: Array.isArray(record.diff) ? record.diff : [],
    verifiedCourses: Array.isArray(record.verifiedCourses) ? record.verifiedCourses : [],
    requirementChangeId: text(record.requirementChangeId),
    requirementChangeApplied: Boolean(record.requirementChangeApplied),
  };
  return [item, ...history].slice(0, 50);
}

export function tenantCourseChangeErrorMessage(error = {}) {
  const status = Number(error?.status || 0);
  if (status === 400 && error?.message) return String(error.message);
  if (status === 401) return "租户 API 返回 401，请检查租户 API Key。";
  if (status === 403) return "租户 API 返回 403，科目不存在、不属于当前租户，或当前 Key 无权限修改。";
  if (status === 404) return "易考未找到需要修改的科目，请核对科目编号。";
  if (status === 429) return "租户 API 返回 429，请稍后重试。";
  return error?.message || `租户 API 修改科目失败：${status || "未知"}`;
}

export { normalizeStoredCourses };
