const INVALID_BINDING_MESSAGE = "科目已创建，但绑定参数不合法，请检查 course_code / form_codes";
const MISSING_FORM_CODES_MESSAGE = "科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次";

function compactBody(value) {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "string" ? value.slice(0, 1000) : JSON.stringify(value).slice(0, 1000);
}

function unwrapCourseDetails(payload) {
  const candidates = [payload?.data, payload?.course, payload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate[0];
    if (candidate && typeof candidate === "object") {
      if (Array.isArray(candidate.results) && candidate.results.length) return candidate.results[0];
      if (candidate.code !== undefined || candidate.course_code !== undefined || candidate.form_codes !== undefined) {
        return candidate;
      }
    }
  }
  return {};
}

function readCourseBinding(details) {
  const course = unwrapCourseDetails(details);
  const courseCode = typeof course.code === "string"
    ? course.code.trim()
    : typeof course.course_code === "string"
      ? course.course_code.trim()
      : "";
  const formCodes = Array.isArray(course.form_codes)
    ? course.form_codes.map((value) => typeof value === "string" ? value.trim() : value)
    : [];
  return { courseCode, formCodes };
}

export async function createSessionsThenConfigureCourses({
  sessionPayloads,
  createSession,
  configureCourses,
}) {
  const created = [];
  const formalIndex = sessionPayloads.findIndex((item) => item?.kind === "main");
  if (formalIndex < 0) {
    throw new Error("未找到正式考试创建参数");
  }
  const formalSession = await createSession(sessionPayloads[formalIndex], formalIndex);
  created.push(formalSession);
  if (!formalSession?.id) {
    throw new Error("未获取正式考试 session_id，无法创建和绑定科目");
  }
  await configureCourses(formalSession);
  for (const [index, item] of sessionPayloads.entries()) {
    if (index === formalIndex) continue;
    created.push(await createSession(item, index));
  }
  return created;
}

export function validateCourseBinding({ sessionId, courseCode, formCodes }) {
  const normalizedSessionId = typeof sessionId === "number" ? String(sessionId) : sessionId;
  if (typeof normalizedSessionId !== "string" || !normalizedSessionId.trim()) {
    throw new Error(INVALID_BINDING_MESSAGE);
  }
  if (typeof courseCode !== "string" || !courseCode.trim()) {
    throw new Error(INVALID_BINDING_MESSAGE);
  }
  if (!Array.isArray(formCodes) || !formCodes.length) {
    throw new Error(INVALID_BINDING_MESSAGE);
  }
  if (formCodes.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error(INVALID_BINDING_MESSAGE);
  }
  return {
    sessionId: normalizedSessionId.trim(),
    courseCode: courseCode.trim(),
    formCodes: formCodes.map((value) => value.trim()),
  };
}

export async function bindCoursesToFormalSession({
  login,
  apiBase,
  sessionId,
  courses,
  requestJson,
  emitLog,
}) {
  if (!Array.isArray(courses) || !courses.length) throw new Error(INVALID_BINDING_MESSAGE);
  const preparedBindings = [];
  const missingCourseCodes = [];
  const results = [];

  for (const requestedCourse of courses) {
    const requestedCode = typeof requestedCourse?.code === "string" ? requestedCourse.code.trim() : "";
    if (!requestedCode) throw new Error(INVALID_BINDING_MESSAGE);

    let details;
    try {
      details = await requestJson(
        login,
        `${apiBase}/tenant/api/courses/${encodeURIComponent(requestedCode)}/?apply=session`,
        { method: "GET" },
        `查询科目详情 ${requestedCode}`,
      );
    } catch (error) {
      if (error?.status === 404) {
        missingCourseCodes.push(requestedCode);
        continue;
      }
      throw error;
    }
    const { courseCode, formCodes } = readCourseBinding(details);
    if (!Array.isArray(formCodes) || !formCodes.length || formCodes.some((value) => typeof value !== "string" || !value.trim())) {
      missingCourseCodes.push(requestedCode);
      continue;
    }
    const validated = validateCourseBinding({ sessionId, courseCode, formCodes });
    preparedBindings.push(validated);
  }

  if (missingCourseCodes.length) {
    emitLog(`[科目绑定] ${MISSING_FORM_CODES_MESSAGE}：${missingCourseCodes.join("、")}`, "warning");
    return { status: "waiting_manual", missingCourseCodes };
  }

  for (const validated of preparedBindings) {
    const path = `/tenant/api/course/session/${encodeURIComponent(validated.sessionId)}/`;
    const payload = {
      course_code: validated.courseCode,
      form_codes: validated.formCodes,
    };

    emitLog(`[科目绑定] POST ${path}`);
    emitLog(`[科目绑定] HTTP Method = POST`);
    emitLog(`[科目绑定] session_id = ${validated.sessionId}`);
    emitLog(`[科目绑定] payload = ${JSON.stringify(payload)}`);

    try {
      const responseBody = await requestJson(
        login,
        `${apiBase}${path}`,
        {
          method: "POST",
          includeResponseMeta: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        `绑定科目 ${validated.courseCode} 到正式场次 ${validated.sessionId}`,
      );
      const httpStatus = responseBody?.__tenantResponse ? responseBody.httpStatus : 200;
      const body = responseBody?.__tenantResponse ? responseBody.body : responseBody;
      emitLog(`[科目绑定] httpStatus = ${httpStatus}`);
      emitLog(`[科目绑定] responseBody = ${compactBody(body)}`);
      results.push({ ...payload, responseBody: body });
    } catch (error) {
      emitLog(`[科目绑定] httpStatus = ${error?.status || "未知"}`, "warning");
      emitLog(`[科目绑定] responseBody = ${compactBody(error?.detail)}`, "warning");
      if (error?.status === 400) {
        const bindingError = new Error(INVALID_BINDING_MESSAGE);
        bindingError.status = error.status;
        bindingError.detail = error.detail;
        throw bindingError;
      }
      throw error;
    }
  }
  return { status: "success", results };
}

export { INVALID_BINDING_MESSAGE, MISSING_FORM_CODES_MESSAGE };
