const INVALID_PAPER_BINDING_MESSAGE = "试卷绑定参数不合法，请检查 session_id / course_code / form_codes";
const MISSING_FORM_CODES_MESSAGE = "科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次";

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

function hasSessionCourseFields(value) {
  return Boolean(
    value?.courses ||
    value?.course_list ||
    value?.courseList ||
    value?.subjects ||
    value?.subject_list ||
    value?.course ||
    value?.data?.courses ||
    value?.data?.course_list ||
    value?.data?.subjects,
  );
}

function unwrapSessionDetail(payload, sessionId) {
  const targetId = String(sessionId || "").trim();
  const directCandidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.session,
    payload?.detail,
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
  for (const item of directCandidates) {
    const itemId = String(item.id ?? item.session_id ?? item.sessionId ?? "").trim();
    if (!targetId || itemId === targetId || (!itemId && hasSessionCourseFields(item))) return item;
  }
  const listCandidates = [
    payload?.results,
    payload?.data?.results,
    payload?.data?.list,
    payload?.list,
    Array.isArray(payload) ? payload : null,
  ];
  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue;
    const match = candidate.find((item) => {
      const itemId = String(item?.id ?? item?.session_id ?? item?.sessionId ?? "").trim();
      return itemId === targetId;
    });
    if (match) return match;
  }
  return {};
}

function normalizePaperName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，、；;:：|｜-]/g, "");
}

function normalizeSearchIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function paperNameContainsIdentifier(paperName, identifier) {
  const expected = normalizeSearchIdentifier(identifier);
  const actual = normalizeSearchIdentifier(paperName);
  return Boolean(expected && actual && actual.includes(expected));
}

function paperNameContainsCourseName(paperName, courseName) {
  const expected = normalizePaperName(courseName);
  const actual = normalizePaperName(paperName);
  return Boolean(expected && actual && actual.includes(expected));
}

function paperMatchesCourseCode(paper, courseCode) {
  if (!courseCode) return false;
  return normalizeSearchIdentifier(paper?.courseCode) === normalizeSearchIdentifier(courseCode)
    || paperNameContainsIdentifier(paper?.name, courseCode);
}

function longestCommonSubstringLength(left, right) {
  if (!left || !right) return 0;
  let previous = new Array(right.length + 1).fill(0);
  let longest = 0;
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Array(right.length + 1).fill(0);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      if (left[leftIndex - 1] !== right[rightIndex - 1]) continue;
      current[rightIndex] = previous[rightIndex - 1] + 1;
      longest = Math.max(longest, current[rightIndex]);
    }
    previous = current;
  }
  return longest;
}

function fuzzyCourseNameScore(paperName, courseName) {
  const expected = normalizePaperName(courseName);
  const actual = normalizePaperName(paperName);
  if (expected.length < 4 || !actual) return 0;
  const commonLength = longestCommonSubstringLength(expected, actual);
  const coverage = commonLength / expected.length;
  if (commonLength < 4 || coverage < 0.55) return 0;
  return coverage;
}

function normalizePaperCandidate(value) {
  if (value && typeof value === "object") {
    const code = String(value.code || value.form_code || value.formCode || "").trim();
    return {
      code,
      name: String(value.name || value.paper_name || value.paperName || value.title || code).trim(),
      courseCode: String(value.course_code || value.courseCode || value.course || value.subject_code || value.subjectCode || "").trim(),
      courseName: String(value.course_name || value.courseName || value.subject_name || value.subjectName || "").trim(),
    };
  }
  const code = String(value || "").trim();
  return { code, name: code, courseCode: "", courseName: "" };
}

function normalizeSessionCourseCandidate(value) {
  if (!value || typeof value !== "object") return null;
  const code = String(
    value.code ||
    value.course_code ||
    value.courseCode ||
    value.subject_code ||
    value.subjectCode ||
    value.id ||
    "",
  ).trim();
  const name = String(value.name || value.course_name || value.courseName || value.title || code).trim();
  const formLists = [
    value.res,
    value.results,
    value.forms,
    value.form_codes,
    value.formCodes,
    value.papers,
    value.paper_list,
    value.paperList,
    value.form,
    value.paper,
  ];
  const papers = formLists.flatMap((item) => {
    if (Array.isArray(item)) return item.map(normalizePaperCandidate);
    if (item && typeof item === "object") return [normalizePaperCandidate(item)];
    return normalizeFormCodes(item).map((formCode) => ({ code: formCode, name: formCode }));
  }).filter((paper) => paper.code || paper.name);
  return code || name || papers.length ? { code, name, papers } : null;
}

function extractSessionCourses(payload, sessionId) {
  const detail = unwrapSessionDetail(payload, sessionId);
  const courseLists = [
    detail?.courses,
    detail?.course_list,
    detail?.courseList,
    detail?.subjects,
    detail?.subject_list,
    detail?.course,
    detail?.data?.courses,
    detail?.data?.course_list,
    detail?.data?.subjects,
  ];
  for (const candidate of courseLists) {
    const courses = (Array.isArray(candidate) ? candidate : candidate && typeof candidate === "object" ? [candidate] : [])
      .map(normalizeSessionCourseCandidate)
      .filter(Boolean);
    if (courses.length) return courses;
  }
  return [];
}

function normalizeFormList(payload) {
  const candidates = [
    payload?.form_list,
    payload?.forms,
    payload?.results,
    payload?.res,
    payload?.data?.form_list,
    payload?.data?.results,
    payload?.data?.res,
    Array.isArray(payload) ? payload : null,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(normalizePaperCandidate).filter((paper) => paper.code);
  }
  return [];
}

function sessionFormResults(sessionId, papers, source = "session_forms") {
  return (Array.isArray(papers) ? papers : []).map((paper) => ({
    session_id: String(sessionId || ""),
    course_name: paper.courseName || "科目",
    course_code: paper.courseCode || "",
    form_codes: [paper.code].filter(Boolean),
    paper_names: [paper.name].filter(Boolean),
    source,
  }));
}

function paperMatchesCourseIdentity(paper, course, workflowSerial = "") {
  const courseCode = normalizeCourseCode(course);
  const courseName = normalizeCourseName(course);
  if (paper?.courseCode) return paper.courseCode === courseCode;
  return paperNameContainsIdentifier(paper?.name, courseCode)
    || paperNameContainsCourseName(paper?.name, courseName)
    || fuzzyCourseNameScore(paper?.name, courseName) > 0
    || paperNameContainsIdentifier(paper?.name, workflowSerial);
}

function filterSessionFormsForCourses(papers, courses = [], workflowSerial = "") {
  const requestedCourses = Array.isArray(courses) ? courses : [];
  if (!requestedCourses.length) return papers;
  const requestedCodes = new Set(requestedCourses.map(normalizeCourseCode).filter(Boolean));
  if (!requestedCodes.size) return papers;
  return papers.filter((paper) => requestedCourses.some((course) => (
    paperMatchesCourseIdentity(paper, course, workflowSerial)
  )));
}

async function fetchSessionForms({ login, apiBase, sessionId, courses, workflowSerial, requestJson, emitLog }) {
  const path = `/tenant/api/session/${encodeURIComponent(sessionId)}/forms/`;
  const payload = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, `查询场次试卷列表 ${sessionId}`);
  const papers = filterSessionFormsForCourses(normalizeFormList(payload), courses, workflowSerial);
  emitLog(`[试卷绑定] 已检查正式场次，当前已绑定 ${papers.length} 份试卷`);
  return sessionFormResults(sessionId, papers);
}

function selectFormCodesForCourse({ courseCode, courseName, workflowSerial, formPapers, multiSubject = false }) {
  const papers = (Array.isArray(formPapers) ? formPapers : []).map(normalizePaperCandidate).filter((paper) => paper.code);
  const signalDefinitions = [
    {
      key: "course_code",
      label: "科目编号",
      value: courseCode,
      matches: (paper) => paperMatchesCourseCode(paper, courseCode),
    },
    {
      key: "workflow_serial",
      label: "泛微流水号",
      value: workflowSerial,
      matches: (paper) => paperNameContainsIdentifier(paper.name, workflowSerial),
    },
    {
      key: "course_name",
      label: "科目名称",
      value: courseName,
      matches: (paper) => paperNameContainsCourseName(paper.name, courseName),
    },
  ];
  const withSignals = papers.map((paper) => ({
    paper,
    signals: signalDefinitions
      .filter((definition) => String(definition.value || "").trim() && definition.matches(paper))
      .map((definition) => definition.key),
  }));
  const selectBestMatches = (items, {
    fallbackKey = "",
    matchScore = null,
    matchedByOverride = "",
    matchedByLabelOverride = "",
    matchedValueOverride = "",
  } = {}) => {
    if (!items.length) return { status: "missing", formCodes: [], candidates: papers, matchedBy: "", matchedByLabel: "", matchedValue: "" };
    const maxSignalCount = Math.max(...items.map((item) => item.signals.length));
    const bestItems = items.filter((item) => item.signals.length === maxSignalCount);
    const matchedDefinitions = fallbackKey
      ? signalDefinitions.filter((definition) => definition.key === fallbackKey)
      : signalDefinitions.filter((definition) => bestItems.some((item) => item.signals.includes(definition.key)));
    const matchedBy = matchedDefinitions.map((definition) => definition.key).join("_and_");
    const matchedByLabel = matchedDefinitions.map((definition) => definition.label).join("及");
    const matchedValue = matchedDefinitions.map((definition) => definition.value).filter(Boolean).join(" / ");
    const candidates = bestItems.map((item) => item.paper);
    return {
      status: candidates.length === 1 ? "matched" : "ambiguous",
      formCodes: candidates.length === 1 ? [candidates[0].code] : [],
      candidates,
      matchedBy: matchedByOverride || matchedBy || fallbackKey,
      matchedByLabel: matchedByLabelOverride || matchedByLabel || "科目名称近似",
      matchedValue: matchedValueOverride || matchedValue || courseName,
      ...(matchScore === null ? {} : { matchScore }),
    };
  };

  const codeMatches = withSignals.filter((item) => item.signals.includes("course_code"));
  const serialMatches = withSignals.filter((item) => item.signals.includes("workflow_serial"));
  const nameMatches = withSignals.filter((item) => item.signals.includes("course_name"));
  if (multiSubject) {
    if (codeMatches.length) return selectBestMatches(codeMatches);
    const serialAndNameMatches = withSignals.filter((item) => (
      item.signals.includes("workflow_serial") && item.signals.includes("course_name")
    ));
    if (serialAndNameMatches.length) return selectBestMatches(serialAndNameMatches);
    const fuzzySerialMatches = serialMatches
      .map((item) => ({ ...item, score: fuzzyCourseNameScore(item.paper.name, courseName) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    if (fuzzySerialMatches.length) {
      const bestScore = fuzzySerialMatches[0].score;
      const bestMatches = fuzzySerialMatches
        .filter((item) => bestScore - item.score < 0.1)
        .map((item) => ({ ...item, signals: ["workflow_serial", "course_name"] }));
      return selectBestMatches(bestMatches, {
        matchScore: bestScore,
        matchedByOverride: "workflow_serial_and_course_name_fuzzy",
        matchedByLabelOverride: "泛微流水号及科目名称近似",
        matchedValueOverride: `${workflowSerial} / ${courseName}`,
      });
    }
    return {
      status: "missing",
      formCodes: [],
      candidates: withSignals
        .filter((item) => item.signals.includes("workflow_serial") || item.signals.includes("course_name"))
        .map((item) => item.paper),
      matchedBy: "workflow_serial_and_course_name",
      matchedByLabel: "泛微流水号及科目名称",
      matchedValue: `${workflowSerial} / ${courseName}`,
    };
  }
  if (codeMatches.length) return selectBestMatches(codeMatches);
  if (serialMatches.length) return selectBestMatches(serialMatches);
  if (nameMatches.length) return selectBestMatches(nameMatches);

  const fuzzyMatches = papers
    .map((paper) => ({ paper, score: fuzzyCourseNameScore(paper.name, courseName) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (fuzzyMatches.length) {
    const bestScore = fuzzyMatches[0].score;
    const bestMatches = fuzzyMatches
      .filter((item) => bestScore - item.score < 0.1)
      .map((item) => ({ paper: item.paper, signals: [] }));
    return selectBestMatches(bestMatches, {
      fallbackKey: "course_name_fuzzy",
      matchScore: bestScore,
    });
  }

  return { status: "missing", formCodes: [], candidates: papers, matchedBy: "", matchedByLabel: "", matchedValue: "" };
}

function duplicatePaperMatchForCourse({ courseCode, courseName, selected }) {
  return {
    course_code: courseCode,
    course_name: courseName,
    matched_by: selected?.matchedBy || "",
    matched_value: selected?.matchedValue || "",
    candidates: (Array.isArray(selected?.candidates) ? selected.candidates : []).map((paper) => ({
      code: paper.code,
      name: paper.name,
    })),
  };
}

async function fetchTenantFormList({ login, apiBase, requestJson, emitLog }) {
  const path = "/tenant/api/form/list/?form_type=active&order_by=-id";
  const payload = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, "查询租户试卷列表");
  const papers = normalizeFormList(payload);
  emitLog(`[试卷绑定] 已查询活跃试卷，共 ${papers.length} 份`);
  return papers;
}

async function fetchSessionPaperBindingDetail({ login, apiBase, sessionId, courses, workflowSerial, requestJson, emitLog }) {
  try {
    const formResults = await fetchSessionForms({ login, apiBase, sessionId, courses, workflowSerial, requestJson, emitLog });
    if (formResults.length) {
      return { source: "forms", results: formResults };
    }
  } catch (error) {
    emitLog("[试卷绑定] 场次试卷列表回查失败，继续检查场次详情", "warning");
  }

  const detailPath = `/tenant/api/session/${encodeURIComponent(sessionId)}/`;
  try {
    const payload = await requestJson(login, `${apiBase}${detailPath}`, { method: "GET" }, `回查正式场次试卷 ${sessionId}`);
    return { source: "detail", payload };
  } catch (error) {
    emitLog("[试卷绑定] 正式场次详情回查失败，已改用场次列表继续检查", "warning");
    const listPath = `/tenant/api/session/?session_ids=${encodeURIComponent(sessionId)}`;
    const payload = await requestJson(login, `${apiBase}${listPath}`, { method: "GET" }, `回查正式场次列表试卷 ${sessionId}`);
    return { source: "list", payload };
  }
}

async function detectSessionPaperBindings({
  login,
  apiBase,
  sessionId,
  courses,
  workflowSerial = "",
  requestJson,
  emitLog = () => {},
}) {
  const normalizedSessionId = typeof sessionId === "number" ? String(sessionId) : String(sessionId || "").trim();
  if (!normalizedSessionId) throw new Error(INVALID_PAPER_BINDING_MESSAGE);

  const payload = await fetchSessionPaperBindingDetail({
    login,
    apiBase,
    sessionId: normalizedSessionId,
    courses,
    workflowSerial,
    requestJson,
    emitLog,
  });
  if (payload?.source === "forms") {
    emitLog("[试卷绑定] 人工绑定回查确认正式场次已有试卷", "success");
    return { status: "success", results: payload.results };
  }
  const sessionCourses = extractSessionCourses(payload?.payload, normalizedSessionId);
  const results = [];
  const missingCourseCodes = [];
  const requestedCourses = Array.isArray(courses) ? courses : [];

  if (!requestedCourses.length) {
    for (const sessionCourse of sessionCourses) {
      const papers = (sessionCourse.papers || []).filter((paper) => paper.code || paper.name);
      if (!papers.length) continue;
      results.push({
        session_id: normalizedSessionId,
        course_name: sessionCourse.name || "科目",
        course_code: sessionCourse.code || "",
        form_codes: papers.map((paper) => paper.code).filter(Boolean),
        paper_names: papers.map((paper) => paper.name).filter(Boolean),
        source: "session_detail",
      });
    }
    if (results.length) {
      emitLog("[试卷绑定] 人工绑定回查确认正式场次已有试卷", "success");
      return { status: "success", results };
    }
    emitLog("[试卷绑定] 人工绑定回查未发现已绑定试卷", "warning");
    return { status: "waiting_manual", missingCourseCodes: [] };
  }

  for (const course of requestedCourses) {
    const requestedCourseCode = normalizeCourseCode(course);
    const requestedCourseName = normalizeCourseName(course);
    if (!requestedCourseCode) throw new Error(INVALID_PAPER_BINDING_MESSAGE);
    const matched = sessionCourses.find((candidate) => {
      if (candidate.code && candidate.code === requestedCourseCode) return true;
      return !candidate.code && requestedCourseName && candidate.name === requestedCourseName;
    });
    const papers = (matched?.papers || []).filter((paper) => paper.code || paper.name);
    if (!matched || !papers.length) {
      missingCourseCodes.push(requestedCourseCode);
      continue;
    }
    results.push({
      session_id: normalizedSessionId,
      course_name: matched.name || requestedCourseName,
      course_code: matched.code || requestedCourseCode,
      form_codes: papers.map((paper) => paper.code).filter(Boolean),
      paper_names: papers.map((paper) => paper.name).filter(Boolean),
      source: "session_detail",
    });
  }

  if (missingCourseCodes.length) {
    emitLog(`[试卷绑定] 正式场次仍有 ${missingCourseCodes.length} 个科目未绑定试卷`, "warning");
    return { status: "waiting_manual", missingCourseCodes };
  }
  emitLog("[试卷绑定] 人工绑定回查确认正式场次已有试卷", "success");
  return { status: "success", results };
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
    const body = responseBody?.__tenantResponse ? responseBody.body : responseBody;
    emitLog(`[试卷绑定] 科目“${binding.courseName || binding.courseCode}”已绑定到正式场次`, "success");
    return { ...payload, responseBody: body };
  } catch (error) {
    emitLog(`[试卷绑定] 科目“${binding.courseName || binding.courseCode}”绑定失败（HTTP ${error?.status || "未知"}）`, "warning");
    if (error?.status === 400) {
      const bindingError = new Error(INVALID_PAPER_BINDING_MESSAGE);
      bindingError.status = error.status;
      bindingError.detail = error.detail;
      throw bindingError;
    }
    throw error;
  }
}

async function putCourseFormCodes({ login, apiBase, binding, requestJson, emitLog }) {
  const path = "/tenant/api/course/";
  const payload = {
    code: binding.courseCode,
    name: binding.courseName || binding.courseCode,
    form_codes: binding.formCodes,
  };
  const responseBody = await requestJson(
    login,
    `${apiBase}${path}`,
    {
      method: "PUT",
      includeResponseMeta: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `更新科目绑定试卷 ${binding.courseCode}`,
  );
  const body = responseBody?.__tenantResponse ? responseBody.body : responseBody;
  emitLog(`[试卷绑定] 已将 ${binding.formCodes.length} 份活跃试卷关联到科目“${binding.courseName || binding.courseCode}”`);
  return { ...payload, responseBody: body };
}

async function bindPapersToFormalSession({
  login,
  apiBase,
  sessionId,
  courses,
  workflowSerial = "",
  requestJson,
  emitLog = () => {},
}) {
  if (!Array.isArray(courses) || !courses.length) throw new Error(INVALID_PAPER_BINDING_MESSAGE);
  const preparedBindings = [];
  const missingCourseCodes = [];
  const duplicatePaperMatches = [];
  const results = [];

  emitLog("[试卷绑定] 开始检查活跃试卷");
  const tenantFormList = await fetchTenantFormList({ login, apiBase, requestJson, emitLog });

  for (const course of courses) {
    const requestedCourseCode = normalizeCourseCode(course);
    const courseName = normalizeCourseName(course);
    if (!requestedCourseCode) throw new Error(INVALID_PAPER_BINDING_MESSAGE);

    const selected = selectFormCodesForCourse({
      courseCode: requestedCourseCode,
      courseName,
      workflowSerial,
      formPapers: tenantFormList,
      multiSubject: courses.length > 1,
    });
    const selectedFormCodes = selected.formCodes;

    const matchMessage = selected.status === "matched"
      ? `已按${selected.matchedByLabel}“${selected.matchedValue}”匹配活跃试卷“${selected.candidates[0]?.name || ""}”`
      : selected.status === "ambiguous"
        ? `活跃试卷中有 ${selected.candidates.length} 份试卷命中${selected.matchedByLabel}“${selected.matchedValue}”，需要人工确认`
        : selected.matchedBy === "workflow_serial_and_course_name"
          ? `活跃试卷中未找到同时包含泛微流水号“${workflowSerial}”和科目名称“${courseName}”的试卷`
          : `活跃试卷中未找到包含科目编号“${requestedCourseCode}”或科目名称“${courseName}”${workflowSerial ? `或泛微流水号“${workflowSerial}”` : ""}的试卷`;
    emitLog(`[试卷绑定] ${matchMessage}`, selected.status === "matched" ? "success" : "warning");

    if (!selectedFormCodes.length) {
      missingCourseCodes.push(requestedCourseCode);
      if (selected.status === "ambiguous") {
        duplicatePaperMatches.push(duplicatePaperMatchForCourse({
          courseCode: requestedCourseCode,
          courseName,
          selected,
        }));
      }
      continue;
    }

    const validated = validatePaperBinding({
      sessionId,
      courseCode: requestedCourseCode,
      formCodes: selectedFormCodes,
    });
    preparedBindings.push({
      ...validated,
      courseName,
      paperNames: selected.candidates.map((item) => item.name).filter(Boolean),
    });
  }

  if (missingCourseCodes.length) {
    emitLog(`[试卷绑定] ${missingCourseCodes.length} 个科目未在活跃试卷中找到对应试卷`, "warning");
    return {
      status: "waiting_manual",
      missingCourseCodes,
      ...(duplicatePaperMatches.length ? { duplicatePaperMatches } : {}),
    };
  }

  for (const binding of preparedBindings) {
    await putCourseFormCodes({ login, apiBase, binding, requestJson, emitLog });
    const response = await postCourseSessionFormCodes({ login, apiBase, binding, requestJson, emitLog });
    results.push({
      session_id: binding.sessionId,
      course_name: binding.courseName,
      course_code: binding.courseCode,
      form_codes: binding.formCodes,
      paper_names: binding.paperNames,
      responseBody: response.responseBody,
    });
  }

  emitLog(`[试卷绑定] 试卷绑定完成，共 ${results.length} 个科目`, "success");
  return { status: "success", results };
}

export {
  INVALID_PAPER_BINDING_MESSAGE,
  MISSING_FORM_CODES_MESSAGE,
  bindPapersToFormalSession,
  detectSessionPaperBindings,
  validatePaperBinding,
};
