import { ensureFormalCoursesCreated } from "./course_creation.mjs";
import { bindCoursesToFormalSession } from "./course_session_binding.mjs";
import { unbindCoursesFromManagerSession } from "./course_session_unbinding.mjs";

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

function sameCourseNames(left = [], right = []) {
  const current = normalizeCourseChangeNames(left);
  const suggested = normalizeCourseChangeNames(right);
  return current.length === suggested.length
    && current.every((name, index) => name === suggested[index]);
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

export function courseRequirementChangeForTaskSession(task = {}, session = {}, currentCourses = null) {
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
  const currentNames = (Array.isArray(currentCourses)
    ? currentCourses
    : taskCoursesForChange(task, requirementIndex))
    .map((course) => text(course?.name || course?.course_name || course?.title));
  if (sameCourseNames(currentNames, suggestedNames)) {
    return { pending: false, label: "", changeId, suggestedNames: [] };
  }
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

export function enrichTaskCourseRequirementChanges(task = {}, options = {}) {
  const currentByRequirementIndex = options.currentByRequirementIndex || {};
  const confirmedOnly = Boolean(options.confirmedOnly);
  const sessions = (Array.isArray(task.sessions) ? task.sessions : []).map((session) => {
    const requirementIndex = String(Math.max(Number(session.requirementIndex || 0), 0));
    const hasCurrent = Object.hasOwn(currentByRequirementIndex, requirementIndex);
    const courseRequirementChange = confirmedOnly && !hasCurrent
      ? { pending: false, label: "", suggestedNames: [] }
      : courseRequirementChangeForTaskSession(
        task,
        session,
        hasCurrent ? currentByRequirementIndex[requirementIndex] : null,
      );
    return { ...session, courseRequirementChange };
  });
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

function sessionBindingsFromDetail(payload) {
  const detail = unwrapCourseDetail(payload);
  return (Array.isArray(detail.res) ? detail.res : [])
    .map((session) => {
      const sessionId = text(session?.id || session?.session_id || session?.sessionId);
      if (!sessionId) return null;
      const entriesCount = Number(session?.entries_count ?? session?.entriesCount);
      const courseEntries = Number(session?.course_entries ?? session?.courseEntries);
      return {
        session_id: sessionId,
        entries_count: Number.isFinite(entriesCount) ? entriesCount : null,
        course_entries: Number.isFinite(courseEntries) ? courseEntries : null,
      };
    })
    .filter(Boolean);
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
  const sessionBindings = sessionBindingsFromDetail(sessionPayload);
  return {
    code: actualCode,
    name,
    form_codes: formCodesFromDetail(formPayload),
    session_count: sessionBindings.length,
    session_ids: sessionBindings.map((session) => session.session_id),
    session_bindings: sessionBindings,
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
  if (new Set(names).size !== names.length) {
    throw validationError("科目名称不能重复。");
  }

  const usedSnapshotIndexes = new Set();
  const items = new Array(names.length);
  for (const [desiredIndex, name] of names.entries()) {
    const snapshotIndex = snapshots.findIndex((snapshot, index) => (
      !usedSnapshotIndexes.has(index) && text(snapshot?.name) === name
    ));
    if (snapshotIndex < 0) continue;
    usedSnapshotIndexes.add(snapshotIndex);
    items[desiredIndex] = {
      before: snapshots[snapshotIndex],
      beforeIndex: snapshotIndex,
      desiredIndex,
      afterName: name,
      changed: false,
      reordered: snapshotIndex !== desiredIndex,
      added: false,
      removed: false,
    };
  }

  const remainingSnapshots = snapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .filter(({ index }) => !usedSnapshotIndexes.has(index));
  for (const [desiredIndex, name] of names.entries()) {
    if (items[desiredIndex]) continue;
    const next = remainingSnapshots.shift();
    if (!next) {
      items[desiredIndex] = {
        before: null,
        beforeIndex: -1,
        desiredIndex,
        afterName: name,
        changed: true,
        reordered: false,
        added: true,
        removed: false,
      };
      continue;
    }
    items[desiredIndex] = {
      before: next.snapshot,
      beforeIndex: next.index,
      desiredIndex,
      afterName: name,
      changed: text(next.snapshot?.name) !== name,
      reordered: next.index !== desiredIndex,
      added: false,
      removed: false,
    };
  }

  return [
    ...items,
    ...remainingSnapshots.map(({ snapshot, index }) => ({
      before: snapshot,
      beforeIndex: index,
      desiredIndex: -1,
      afterName: "",
      changed: true,
      reordered: false,
      added: false,
      removed: true,
    })),
  ];
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
  sessionId = "",
  creationConfig = {},
  onCoursesEnsured = async () => {},
  ensureCoursesCreated = ensureFormalCoursesCreated,
  bindCourses = bindCoursesToFormalSession,
  unbindCourses = unbindCoursesFromManagerSession,
  managerFetch = fetch,
}) {
  const base = text(apiBase).replace(/\/+$/, "");
  const plan = buildCourseChangePlan(snapshots, requestedNames);
  const desiredPlan = plan.filter((item) => !item.removed);
  const additions = desiredPlan.filter((item) => item.added);
  const removals = plan.filter((item) => item.removed);
  const targetSessionId = text(sessionId);
  if ((additions.length || removals.length) && !targetSessionId) {
    throw validationError("缺少正式考试场次编号，不能增减科目。");
  }
  for (const item of removals) {
    const otherSessionIds = (item.before.session_ids || []).filter((id) => text(id) !== targetSessionId);
    if (otherSessionIds.length) {
      throw validationError(`科目 ${item.before.name} / ${item.before.code} 还绑定了其他场次，不能自动删除。`);
    }
    const targetBinding = (item.before.session_bindings || [])
      .find((binding) => text(binding.session_id) === targetSessionId);
    const assignedCount = targetBinding?.course_entries ?? targetBinding?.entries_count ?? 0;
    if (Number(assignedCount) > 0) {
      throw validationError(`科目 ${item.before.name} / ${item.before.code} 已有 ${assignedCount} 名考生，不能自动删除。`);
    }
  }

  let remoteModified = false;
  try {
    const preparedCourses = new Array(desiredPlan.length);
    for (const item of desiredPlan) {
      if (item.added) continue;
      if (!item.changed) {
        preparedCourses[item.desiredIndex] = item.before;
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
      remoteModified = true;
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
      preparedCourses[item.desiredIndex] = snapshot;
    }
    const removalSnapshots = removals.map((item) => item.before);
    if (desiredPlan.some((item) => item.changed && !item.added)) {
      await onCoursesEnsured([...preparedCourses.filter(Boolean), ...removalSnapshots]);
    }

    let ensuredCourses = preparedCourses.filter(Boolean);
    if (additions.length) {
      const requestedCourses = desiredPlan.map((item) => (
        item.added
          ? { name: item.afterName, order: item.desiredIndex + 1 }
          : { ...preparedCourses[item.desiredIndex], name: item.afterName, order: item.desiredIndex + 1 }
      ));
      ensuredCourses = await ensureCoursesCreated({
        login,
        apiBase: base,
        config: { ...creationConfig, courses: requestedCourses },
        existingProjectCourses: preparedCourses.filter(Boolean),
        requestJson,
        emitLog,
        onCourseCreated: async (partialCourses) => {
          remoteModified = true;
          await onCoursesEnsured([...partialCourses, ...removalSnapshots]);
        },
      });
      if (ensuredCourses.length !== desiredPlan.length) {
        const error = new Error("新增科目后回传的科目数量不完整，已停止后续绑定。");
        error.status = 502;
        throw error;
      }
      await onCoursesEnsured([...ensuredCourses, ...removalSnapshots]);
    }

    let verified = await fetchTenantCourseSnapshots({
      apiBase: base,
      courses: ensuredCourses,
      requestJson,
      login,
      emitLog,
    });
    const missingBindings = targetSessionId
      ? verified.filter((course) => !course.session_ids.includes(targetSessionId))
      : [];
    let bindResult = { status: "success", results: [], skipped: true };
    if (missingBindings.length) {
      bindResult = await bindCourses({
        login,
        apiBase: base,
        sessionId: targetSessionId,
        courses: missingBindings,
        requestJson,
        emitLog,
      });
      remoteModified = true;
      verified = await fetchTenantCourseSnapshots({
        apiBase: base,
        courses: ensuredCourses,
        requestJson,
        login,
        emitLog,
      });
    }
    const stillUnbound = targetSessionId
      ? verified.filter((course) => !course.session_ids.includes(targetSessionId))
      : [];
    if (stillUnbound.length) {
      const error = new Error(`科目 ${stillUnbound.map((course) => course.code).join("、")} 未回查到正式场次绑定，已停止更新。`);
      error.status = 502;
      throw error;
    }

    if (removals.length) {
      const removedCodes = removals.map((item) => item.before.code);
      const unbindResult = await unbindCourses({
        login,
        sessionId: targetSessionId,
        courseCodes: removedCodes,
        fetchImpl: managerFetch,
        emitLog,
      });
      if (unbindResult?.changed) remoteModified = true;
      for (const item of removals) {
        const snapshot = await fetchTenantCourseSnapshot({
          apiBase: base,
          code: item.before.code,
          requestJson,
          login,
        });
        if (snapshot.session_ids.includes(targetSessionId)) {
          const error = new Error(`科目 ${item.before.code} 仍绑定正式考试场次 ${targetSessionId}，已停止删除。`);
          error.status = 502;
          throw error;
        }
      }
      emitLog(`已回查确认 ${removedCodes.length} 个科目解除正式场次绑定`);
      for (const [index, item] of removals.entries()) {
        const code = item.before.code;
        await requestJson(
          login,
          `${base}/tenant/api/course/`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ codes: [code] }),
          },
          `删除科目 ${code}`,
        );
        remoteModified = true;
        emitLog(`已调用易考接口删除科目：${code}`);
        try {
          await requestJson(
            login,
            `${base}/tenant/api/courses/${encodeURIComponent(code)}/?apply=session`,
            { method: "GET" },
            `确认科目已删除 ${code}`,
          );
          const error = new Error(`科目 ${code} 删除后仍可查询，删除未确认完成。`);
          error.status = 502;
          throw error;
        } catch (error) {
          if (error?.status !== 404) throw error;
        }
        emitLog(`已回查确认删除科目：${code}`);
        const pendingRemovalSnapshots = removals.slice(index + 1).map((pending) => pending.before);
        await onCoursesEnsured([...verified, ...pendingRemovalSnapshots]);
      }
    }

    const finalNames = verified.map((course) => course.name);
    const requested = normalizeCourseChangeNames(requestedNames);
    if (!sameStringList(finalNames, requested)) {
      const error = new Error("易考科目回查结果与提交内容不一致，已停止更新。");
      error.status = 502;
      throw error;
    }
    const orderedCourses = requested.map((name, index) => ({
      ...verified.find((course) => course.name === name),
      order: index + 1,
    }));
    const diff = [
      ...desiredPlan.filter((item) => item.changed && !item.added).map((item) => ({
        field: "course_name",
        label: "科目信息",
        code: item.before.code,
        before: item.before.name,
        after: item.afterName,
      })),
      ...additions.map((item) => {
        const course = orderedCourses[item.desiredIndex];
        return {
          field: "course_add",
          label: "科目信息",
          code: course.code,
          before: "",
          after: item.afterName,
        };
      }),
      ...removals.map((item) => ({
        field: "course_remove",
        label: "科目信息",
        code: item.before.code,
        before: item.before.name,
        after: "",
      })),
    ];
    return {
      changed: diff.length > 0 || plan.some((item) => item.reordered) || missingBindings.length > 0,
      diff,
      courses: orderedCourses,
      bindResult,
      boundCourseCodes: missingBindings.map((course) => course.code),
      createdCourseCodes: additions.map((item) => orderedCourses[item.desiredIndex]?.code).filter(Boolean),
      deletedCourseCodes: removals.map((item) => item.before.code),
    };
  } catch (error) {
    if (remoteModified) error.remoteModified = true;
    throw error;
  }
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
