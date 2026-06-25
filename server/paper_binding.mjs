const INVALID_PAPER_BINDING_MESSAGE = "试卷绑定参数不合法，请检查 session_id / course_code / form_codes";
const MISSING_FORM_CODES_MESSAGE = "科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次";

function compactBody(value) {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "string" ? value.slice(0, 1000) : JSON.stringify(value).slice(0, 1000);
}

function normalizeFormCodes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") return String(item.code || item.form_code || item.formCode || "").trim();
        return String(item || "").trim();
      })
      .filter(Boolean);
  }
  return String(value || "")
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCourseCode(course) {
  return String(course?.code || course?.course_code || "").trim();
}

function normalizeCourseName(course) {
  return String(course?.name || course?.course_name || course?.title || "").trim();
}

function unwrapCourseDetail(payload) {
  const candidates = [payload?.data, payload?.course, payload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate[0] || {};
    if (candidate && typeof candidate === "object") return candidate;
  }
  return {};
}

function extractCourseCode(payload, fallbackCode) {
  const course = unwrapCourseDetail(payload);
  return String(course?.code || course?.course_code || fallbackCode || "").trim();
}

function extractFormCodesFromCourseDetail(payload) {
  const course = unwrapCourseDetail(payload);
  const formLists = [
    course?.res,
    course?.results,
    course?.forms,
    course?.form_codes,
    course?.formCodes,
    course?.data?.res,
    course?.data?.results,
    course?.data?.form_codes,
    course?.data?.formCodes,
  ];
  const codes = formLists.flatMap((value) => normalizeFormCodes(value));
  return Array.from(new Set(codes));
}

async function fetchCourseFormBinding({ login, apiBase, courseCode, requestJson, emitLog }) {
  const path = `/tenant/api/courses/${encodeURIComponent(courseCode)}/?apply=form`;
  emitLog(`[试卷绑定] GET ${path}`);
  const detail = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, `查询科目试卷 ${courseCode}`);
  emitLog(`[试卷绑定] 科目详情 responseBody = ${compactBody(detail)}`);
  return {
    courseCode: extractCourseCode(detail, courseCode),
    formCodes: extractFormCodesFromCourseDetail(detail),
    detail,
  };
}

function validatePaperBinding({ sessionId, courseCode, formCodes }) {
  const normalizedSessionId = typeof sessionId === "number" ? String(sessionId) : sessionId;
  if (typeof normalizedSessionId !== "string" || !normalizedSessionId.trim()) {
    throw new Error(INVALID_PAPER_BINDING_MESSAGE);
  }
  if (typeof courseCode !== "string" || !courseCode.trim()) {
    throw new Error(INVALID_PAPER_BINDING_MESSAGE);
  }
  const normalizedFormCodes = normalizeFormCodes(formCodes);
  if (!normalizedFormCodes.length) {
    throw new Error(MISSING_FORM_CODES_MESSAGE);
  }
  return {
    sessionId: normalizedSessionId.trim(),
    courseCode: courseCode.trim(),
    formCodes: normalizedFormCodes,
  };
}

async function postCourseSessionFormCodes({ login, apiBase, binding, requestJson, emitLog }) {
  const path = `/tenant/api/course/session/${encodeURIComponent(binding.sessionId)}/`;
  const payload = {
    course_code: binding.courseCode,
    form_codes: binding.formCodes,
  };

  emitLog(`[试卷绑定] POST ${path}`);
  emitLog(`[试卷绑定] HTTP Method = POST`);
  emitLog(`[试卷绑定] session_id = ${binding.sessionId}`);
  emitLog(`[试卷绑定] payload = ${JSON.stringify(payload)}`);

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
      `绑定试卷 ${binding.formCodes.join("、")} 到正式场次 ${binding.sessionId}`,
    );
    const httpStatus = responseBody?.__tenantResponse ? responseBody.httpStatus : 200;
    const body = responseBody?.__tenantResponse ? responseBody.body : responseBody;
    emitLog(`[试卷绑定] httpStatus = ${httpStatus}`);
    emitLog(`[试卷绑定] responseBody = ${compactBody(body)}`);
    return { ...payload, responseBody: body };
  } catch (error) {
    emitLog(`[试卷绑定] url = ${path}`, "warning");
    emitLog(`[试卷绑定] requestBody = ${JSON.stringify(payload)}`, "warning");
    emitLog(`[试卷绑定] httpStatus = ${error?.status || "未知"}`, "warning");
    emitLog(`[试卷绑定] responseBody = ${compactBody(error?.detail)}`, "warning");
    if (error?.status === 400) {
      const bindingError = new Error(INVALID_PAPER_BINDING_MESSAGE);
      bindingError.status = error.status;
      bindingError.detail = error.detail;
      throw bindingError;
    }
    throw error;
  }
}

async function bindPapersToFormalSession({
  login,
  apiBase,
  sessionId,
  courses,
  requestJson,
  emitLog = () => {},
}) {
  if (!Array.isArray(courses) || !courses.length) throw new Error(INVALID_PAPER_BINDING_MESSAGE);
  const preparedBindings = [];
  const missingCourseCodes = [];
  const results = [];

  emitLog(`[试卷绑定] 开始绑定试卷，session_id=${sessionId || ""}`);

  for (const course of courses) {
    const requestedCourseCode = normalizeCourseCode(course);
    const courseName = normalizeCourseName(course);
    if (!requestedCourseCode) throw new Error(INVALID_PAPER_BINDING_MESSAGE);

    let refreshed;
    try {
      refreshed = await fetchCourseFormBinding({
        login,
        apiBase,
        courseCode: requestedCourseCode,
        requestJson,
        emitLog,
      });
    } catch (error) {
      if (error?.status === 404) {
        missingCourseCodes.push(requestedCourseCode);
        continue;
      }
      throw error;
    }

    if (!refreshed.formCodes.length) {
      missingCourseCodes.push(requestedCourseCode);
      continue;
    }

    const validated = validatePaperBinding({
      sessionId,
      courseCode: refreshed.courseCode || requestedCourseCode,
      formCodes: refreshed.formCodes,
    });
    preparedBindings.push({ ...validated, courseName });
  }

  if (missingCourseCodes.length) {
    emitLog(`[试卷绑定] ${MISSING_FORM_CODES_MESSAGE}：${missingCourseCodes.join("、")}`, "warning");
    return { status: "waiting_manual", missingCourseCodes };
  }

  for (const binding of preparedBindings) {
    emitLog(`[试卷绑定] 科目=${binding.courseName || binding.courseCode}，course_code=${binding.courseCode}，form_codes=[${binding.formCodes.join(", ")}]`);
    const response = await postCourseSessionFormCodes({ login, apiBase, binding, requestJson, emitLog });
    emitLog("[试卷绑定] 调用试卷绑定接口成功");
    results.push({
      session_id: binding.sessionId,
      course_name: binding.courseName,
      course_code: binding.courseCode,
      form_codes: binding.formCodes,
      responseBody: response.responseBody,
    });
  }

  emitLog("[试卷绑定] 正式考试试卷绑定完成");
  return { status: "success", results };
}

export {
  INVALID_PAPER_BINDING_MESSAGE,
  MISSING_FORM_CODES_MESSAGE,
  bindPapersToFormalSession,
  validatePaperBinding,
};
