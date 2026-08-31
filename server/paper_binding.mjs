const INVALID_PAPER_BINDING_MESSAGE = "试卷绑定参数不合法，请检查 session_id / course_code / form_codes";
const MISSING_FORM_CODES_MESSAGE = "科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次";

function managerBase(login = {}) {
  const candidate = String(login?.url || login?.webBase || login?.apiBase || "https://eztest.org").trim();
  try {
    const url = new URL(candidate);
    const host = url.host === "eztest.cn" ? "eztest.org" : url.host;
    return `${url.protocol}//${host}`;
  } catch {
    return "https://eztest.org";
  }
}

function cookieHeaderFromResponse(response) {
  const raw = response?.headers?.get?.("set-cookie") || response?.headers?.get?.("Set-Cookie") || "";
  return String(raw)
    .split(/,(?=[^;,]+=)/)
    .map((item) => item.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function readManagerJson(response, action) {
  const body = await response.text();
  let payload = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    payload = body;
  }
  if (!response.ok) {
    const error = new Error(`${action}失败：HTTP ${response.status}`);
    error.status = response.status;
    error.detail = payload;
    throw error;
  }
  return payload;
}

async function loginToManagerForPaperCatalog(login, fetchImpl) {
  const username = String(login?.username || "").trim();
  const password = String(login?.password || "");
  if (!username || !password) throw new Error("缺少易考后台账号或密码，无法确认活跃试卷范围。");
  const payload = username.includes("@")
    ? { email: username, password, remember: false, code: "" }
    : { phone: username, password, remember: false, code: "" };
  const base = managerBase(login);
  const response = await fetchImpl(`${base}/dapi/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await readManagerJson(response, "登录易考后台确认活跃试卷");
  const cookie = cookieHeaderFromResponse(response);
  if (!cookie) throw new Error("登录易考后台确认活跃试卷失败：未返回登录 Cookie。");
  return { base, cookie };
}

async function fetchManagerPaperCatalog({ login, formType = "active", fetchImpl }) {
  const { base, cookie } = await loginToManagerForPaperCatalog(login, fetchImpl);
  const papers = [];
  let page = 1;
  let pagesCount = 1;
  do {
    const url = new URL("/dapi/content/form/list/", base);
    url.searchParams.set("form_type", formType);
    url.searchParams.set("page", String(page));
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        Cookie: cookie,
        Origin: base,
        Referer: `${base}/manager/content/form/list?keyword=&form_type=${encodeURIComponent(formType)}&page=${page}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const payload = await readManagerJson(response, formType === "active" ? "查询易考活跃试卷" : "查询易考历史试卷");
    const data = payload?.data || payload || {};
    const current = Array.isArray(data.forms) ? data.forms : Array.isArray(data.form_list) ? data.form_list : [];
    papers.push(...current);
    pagesCount = Math.max(1, Number(data.pages_count || data.pagesCount || 1));
    page += 1;
  } while (page <= pagesCount && page <= 100);
  return papers;
}

function filterTenantPapersByManagerCatalog(tenantPapers, managerPapers) {
  const activeIds = new Set((Array.isArray(managerPapers) ? managerPapers : [])
    .map((paper) => String(paper?.pk ?? paper?.id ?? "").trim())
    .filter(Boolean));
  const activeNames = new Set((Array.isArray(managerPapers) ? managerPapers : [])
    .map((paper) => normalizePaperName(paper?.name || paper?.paper_name || ""))
    .filter(Boolean));
  return (Array.isArray(tenantPapers) ? tenantPapers : []).filter((paper) => {
    const paperId = String(paper?.id ?? paper?.pk ?? "").trim();
    if (paperId && activeIds.size) return activeIds.has(paperId);
    return activeNames.has(normalizePaperName(paper?.name || paper?.paper_name || ""));
  });
}

function paperSearchScopeLabel(scope) {
  return scope === "all" ? "所有试卷" : "活跃试卷";
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
    .replace(/[\s\p{P}\p{S}]+/gu, "");
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

function normalizeExamDateIdentifier(value) {
  const raw = value instanceof Date && !Number.isNaN(value.getTime())
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(value)
    : String(value || "").trim();
  const match = raw.match(/(?:^|\D)(20\d{2})\D?(\d{2})\D?(\d{2})(?:\D|$)/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return "";
  return `${match[1]}${match[2]}${match[3]}`;
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

function longestCommonSubsequenceLength(left, right) {
  if (!left || !right) return 0;
  let previous = new Array(right.length + 1).fill(0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Array(right.length + 1).fill(0);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1] + 1
        : Math.max(previous[rightIndex], current[rightIndex - 1]);
    }
    previous = current;
  }
  return previous[right.length];
}

function fuzzyCourseNameScore(paperName, courseName) {
  const expected = normalizePaperName(courseName);
  const actual = normalizePaperName(paperName);
  if (expected.length < 2 || !actual) return 0;
  if (expected.length < 4 && !actual.includes(expected)) return 0;
  const commonLength = longestCommonSubsequenceLength(expected, actual);
  const coverage = commonLength / expected.length;
  const precision = commonLength / actual.length;
  if (commonLength < Math.min(4, expected.length) || coverage < 0.55) return 0;
  return (5 * coverage * precision) / ((4 * precision) + coverage);
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
    value.form_list,
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

function normalizeCourseList(payload) {
  const candidates = [
    payload?.data,
    payload?.courses,
    payload?.course_list,
    payload?.results,
    Array.isArray(payload) ? payload : null,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.map(normalizeSessionCourseCandidate).filter((course) => course?.code || course?.name);
  }
  return [];
}

function courseCodePaperPrefix(value = "") {
  const match = String(value || "").trim().match(/^(\d{8})-\d{2}-(\d{2})$/);
  return match ? `${match[1]}${match[2]}` : "";
}

function paperCourseMatchScore(paper, course) {
  const paperName = String(paper?.name || "");
  const courseCode = normalizeCourseCode(course);
  const courseName = normalizeCourseName(course);
  if (paper?.courseCode && normalizeSearchIdentifier(paper.courseCode) === normalizeSearchIdentifier(courseCode)) return 1000;
  if (courseCode && paperNameContainsIdentifier(paperName, courseCode)) return 900;
  const codePrefix = courseCodePaperPrefix(courseCode);
  if (codePrefix && paperNameContainsIdentifier(paperName, codePrefix)) return 850;
  if (courseName && paperNameContainsCourseName(paperName, courseName)) return 700 + Math.min(courseName.length, 100);
  const fuzzyScore = fuzzyCourseNameScore(paperName, courseName);
  return fuzzyScore > 0 ? 500 + fuzzyScore : 0;
}

function uniqueCourseCandidates(...courseLists) {
  const result = [];
  const seen = new Set();
  for (const course of courseLists.flat()) {
    const normalized = normalizeSessionCourseCandidate(course);
    if (!normalized) continue;
    const key = normalizeCourseCode(normalized) || `name:${normalizeCourseName(normalized)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function buildSessionSubjectPaperSnapshot({ formsPayload, courseListPayload, knownCourses = [] } = {}) {
  const papers = normalizeFormList(formsPayload);
  const courseCandidates = uniqueCourseCandidates(
    normalizeCourseList(courseListPayload),
    Array.isArray(knownCourses) ? knownCourses : [],
  );
  const matchedCourses = new Map();
  const unmatchedPapers = [];

  for (const paper of papers) {
    const scored = courseCandidates
      .map((course) => ({ course, score: paperCourseMatchScore(paper, course) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    const tied = best && scored.filter((item) => item.score === best.score);
    if (!best || tied.length !== 1) {
      unmatchedPapers.push({ code: paper.code, name: paper.name });
      continue;
    }
    const course = best.course;
    const key = normalizeCourseCode(course) || `name:${normalizeCourseName(course)}`;
    const current = matchedCourses.get(key) || {
      code: normalizeCourseCode(course),
      name: normalizeCourseName(course),
      form_codes: [],
      paper_names: [],
    };
    if (paper.code && !current.form_codes.includes(paper.code)) current.form_codes.push(paper.code);
    if (paper.name && !current.paper_names.includes(paper.name)) current.paper_names.push(paper.name);
    matchedCourses.set(key, current);
  }

  const courses = [...matchedCourses.values()].map((course) => ({
    ...course,
    ...(course.paper_names[0] ? { paper_name: course.paper_names[0] } : {}),
  }));
  return {
    courses,
    papers: papers.map((paper) => ({ code: paper.code, name: paper.name })),
    unmatchedPapers,
    courseReadMode: courses.length ? "tenant_courses_matched_by_bound_papers" : "not_returned",
  };
}

function uniquePaperRecords(papers = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(papers) ? papers : []) {
    const paper = normalizePaperCandidate(value);
    if (!paper.code && !paper.name) continue;
    const key = paper.code ? `code:${paper.code}` : `name:${normalizePaperName(paper.name)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ code: paper.code, name: paper.name });
  }
  return result;
}

function sessionDetailSubjectPaperSnapshot(payload, sessionId) {
  const detailCourses = extractSessionCourses(payload, sessionId);
  const courses = detailCourses.map((course) => {
    const papers = uniquePaperRecords(course.papers);
    const formCodes = papers.map((paper) => paper.code).filter(Boolean);
    const paperNames = papers.map((paper) => paper.name).filter(Boolean);
    return {
      code: course.code,
      name: course.name,
      form_codes: formCodes,
      paper_names: paperNames,
      ...(paperNames[0] ? { paper_name: paperNames[0] } : {}),
    };
  });
  return {
    courses,
    papers: uniquePaperRecords(detailCourses.flatMap((course) => course.papers || [])),
  };
}

function mergeSessionSubjectPaperSnapshots(detailSnapshot, matchedSnapshot) {
  const courses = (Array.isArray(detailSnapshot?.courses) ? detailSnapshot.courses : []).map((course) => ({
    ...course,
    form_codes: [...(course.form_codes || [])],
    paper_names: [...(course.paper_names || [])],
  }));
  for (const readback of Array.isArray(matchedSnapshot?.courses) ? matchedSnapshot.courses : []) {
    const index = courses.findIndex((course) => (
      (readback.code && course.code === readback.code)
      || (!readback.code && readback.name && course.name === readback.name)
      || (!course.code && course.name && course.name === readback.name)
    ));
    if (index < 0) {
      courses.push({ ...readback });
      continue;
    }
    const current = courses[index];
    current.form_codes = [...new Set([...(current.form_codes || []), ...(readback.form_codes || [])])];
    current.paper_names = [...new Set([...(current.paper_names || []), ...(readback.paper_names || [])])];
    if (!current.paper_name && current.paper_names[0]) current.paper_name = current.paper_names[0];
  }
  return {
    courses,
    papers: uniquePaperRecords([...(detailSnapshot?.papers || []), ...(matchedSnapshot?.papers || [])]),
    unmatchedPapers: Array.isArray(matchedSnapshot?.unmatchedPapers) ? matchedSnapshot.unmatchedPapers : [],
    courseReadMode: detailSnapshot?.courses?.length
      ? "session_detail"
      : matchedSnapshot?.courseReadMode || "not_returned",
  };
}

function courseSessionAssociations(payload = {}) {
  const detail = unwrapCourseDetail(payload);
  const candidates = [
    detail.res,
    detail.results,
    detail.sessions,
    detail.session_list,
    detail.sessionList,
    detail.data?.res,
    detail.data?.results,
    detail.data?.sessions,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

async function fetchKnownCoursesForSession({ login, apiBase, sessionId, knownCourses, requestJson, emitLog }) {
  const courses = [];
  for (const knownCourse of uniqueCourseCandidates(knownCourses)) {
    const courseCode = normalizeCourseCode(knownCourse);
    if (!courseCode) continue;
    try {
      const payload = await requestJson(
        login,
        `${apiBase}/tenant/api/courses/${encodeURIComponent(courseCode)}/?apply=session`,
        { method: "GET" },
        `查询科目场次 ${courseCode}`,
      );
      const associated = courseSessionAssociations(payload).some((session) => (
        String(session?.id ?? session?.session_id ?? session?.sessionId ?? session).trim() === String(sessionId).trim()
      ));
      if (!associated) continue;
      const detail = unwrapCourseDetail(payload);
      courses.push({
        code: String(detail.code || detail.course_code || courseCode).trim(),
        name: String(detail.name || detail.course_name || normalizeCourseName(knownCourse)).trim(),
        form_codes: [],
        paper_names: [],
      });
    } catch (error) {
      emitLog(`[易考信息同步] 科目 ${courseCode} 的场次关联读取失败`, "warning");
    }
  }
  return courses;
}

async function fetchSessionSubjectPaperSnapshot({
  login,
  apiBase,
  sessionId,
  sessionDetail = null,
  knownCourses = [],
  requestJson,
  emitLog = () => {},
}) {
  const formsPath = `/tenant/api/session/${encodeURIComponent(sessionId)}/forms/`;
  let formsPayload = {};
  try {
    formsPayload = await requestJson(login, `${apiBase}${formsPath}`, { method: "GET" }, `查询场次试卷列表 ${sessionId}`);
  } catch (error) {
    if (!sessionDetail) throw error;
    emitLog("[易考信息同步] 场次试卷列表读取失败，继续使用场次详情回读科目和试卷", "warning");
  }
  const papers = normalizeFormList(formsPayload);
  let courseListPayload = null;
  if (papers.length) {
    try {
      courseListPayload = await requestJson(
        login,
        `${apiBase}/tenant/api/course_list/1/1000/`,
        { method: "GET" },
        "查询租户科目列表",
      );
    } catch (error) {
      emitLog("[易考信息同步] 租户科目列表读取失败，继续使用平台已有科目匹配已绑试卷", "warning");
    }
  }
  let detailSnapshot = sessionDetailSubjectPaperSnapshot(sessionDetail, sessionId);
  if (!detailSnapshot.courses.length) {
    try {
      const sessionListPayload = await requestJson(
        login,
        `${apiBase}/tenant/api/session/?session_ids=${encodeURIComponent(sessionId)}`,
        { method: "GET" },
        `从场次列表读取科目和试卷 ${sessionId}`,
      );
      detailSnapshot = sessionDetailSubjectPaperSnapshot(sessionListPayload, sessionId);
    } catch (error) {
      emitLog("[易考信息同步] 场次列表科目读取失败，继续使用已取得的试卷信息", "warning");
    }
  }
  if (!detailSnapshot.courses.length && Array.isArray(knownCourses) && knownCourses.length) {
    const associatedCourses = await fetchKnownCoursesForSession({
      login,
      apiBase,
      sessionId,
      knownCourses,
      requestJson,
      emitLog,
    });
    if (associatedCourses.length) detailSnapshot = { courses: associatedCourses, papers: [] };
  }
  const matchedSnapshot = buildSessionSubjectPaperSnapshot({
    formsPayload,
    courseListPayload,
    knownCourses: [...detailSnapshot.courses, ...(Array.isArray(knownCourses) ? knownCourses : [])],
  });
  const snapshot = mergeSessionSubjectPaperSnapshots(detailSnapshot, matchedSnapshot);
  emitLog(`[易考信息同步] 已读取 ${snapshot.courses.length} 个科目、${snapshot.papers.length} 份试卷`);
  return snapshot;
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

function selectFormCodesForCourse({ courseCode, courseName, workflowSerial, examDate, formPapers, multiSubject = false }) {
  const papers = (Array.isArray(formPapers) ? formPapers : []).map(normalizePaperCandidate).filter((paper) => paper.code);
  const normalizedExamDate = normalizeExamDateIdentifier(examDate);
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
  const selectClosestNameMatch = (items, { requireSerial = false } = {}) => {
    const scored = items
      .map((item) => ({ ...item, score: fuzzyCourseNameScore(item.paper.name, courseName) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!scored.length) return null;
    const bestScore = scored[0].score;
    const bestMatches = scored
      .filter((item) => Math.abs(bestScore - item.score) < Number.EPSILON)
      .map((item) => ({
        ...item,
        signals: requireSerial ? ["workflow_serial", "course_name"] : ["course_name"],
      }));
    return selectBestMatches(bestMatches, {
      matchScore: bestScore,
      matchedByOverride: requireSerial ? "workflow_serial_and_course_name_fuzzy" : "course_name_fuzzy",
      matchedByLabelOverride: requireSerial ? "泛微流水号及科目名称近似" : "科目名称近似",
      matchedValueOverride: requireSerial ? `${workflowSerial} / ${courseName}` : courseName,
    });
  };
  const selectDateAndNameMatch = () => {
    if (!normalizedExamDate) return null;
    const dateMatches = withSignals.filter((item) => paperNameContainsIdentifier(item.paper.name, normalizedExamDate));
    if (!dateMatches.length) return null;
    const exactNameMatches = dateMatches.filter((item) => paperNameContainsCourseName(item.paper.name, courseName));
    if (exactNameMatches.length) {
      return selectBestMatches(exactNameMatches.map((item) => ({ ...item, signals: [] })), {
        matchedByOverride: "exam_date_and_course_name",
        matchedByLabelOverride: "考试日期及科目名称",
        matchedValueOverride: `${normalizedExamDate} / ${courseName}`,
      });
    }
    const scored = dateMatches
      .map((item) => ({ ...item, score: fuzzyCourseNameScore(item.paper.name, courseName) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!scored.length) return null;
    const bestScore = scored[0].score;
    const bestMatches = scored
      .filter((item) => Math.abs(bestScore - item.score) < Number.EPSILON)
      .map((item) => ({ ...item, signals: [] }));
    return selectBestMatches(bestMatches, {
      matchScore: bestScore,
      matchedByOverride: "exam_date_and_course_name_fuzzy",
      matchedByLabelOverride: "考试日期及科目名称近似",
      matchedValueOverride: `${normalizedExamDate} / ${courseName}`,
    });
  };
  if (multiSubject) {
    if (codeMatches.length) return selectBestMatches(codeMatches);
    const closestSerialNameMatch = selectClosestNameMatch(serialMatches, { requireSerial: true });
    if (closestSerialNameMatch) return closestSerialNameMatch;
    const dateAndNameMatch = selectDateAndNameMatch();
    if (dateAndNameMatch) return dateAndNameMatch;
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
  if (serialMatches.length) {
    const closestSerialNameMatch = selectClosestNameMatch(serialMatches, { requireSerial: true });
    if (closestSerialNameMatch) return closestSerialNameMatch;
    return selectBestMatches(serialMatches);
  }
  const closestNameMatch = selectClosestNameMatch(withSignals);
  if (closestNameMatch) return closestNameMatch;

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

async function fetchTenantFormList({
  login,
  apiBase,
  requestJson,
  emitLog,
  paperSearchScope = "active",
  managerFetch = null,
}) {
  const path = "/tenant/api/form/list/?form_type=active&order_by=-id";
  const payload = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, "查询租户试卷列表");
  const tenantPapers = normalizeFormList(payload);
  if (paperSearchScope === "all") {
    emitLog(`[试卷绑定] 已查询所有试卷，共 ${tenantPapers.length} 份`);
    return tenantPapers;
  }
  if (typeof managerFetch !== "function") {
    emitLog(`[试卷绑定] 已查询活跃试卷，共 ${tenantPapers.length} 份`);
    return tenantPapers;
  }
  emitLog(`[试卷绑定] 已从租户接口读取试卷候选，共 ${tenantPapers.length} 份`);
  const activeCatalog = await fetchManagerPaperCatalog({ login, formType: "active", fetchImpl: managerFetch });
  const activePapers = filterTenantPapersByManagerCatalog(tenantPapers, activeCatalog);
  emitLog(`[试卷绑定] 已确认活跃试卷，共 ${activePapers.length} 份`);
  return activePapers;
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
  emitLog(`[试卷绑定] 已将 ${binding.formCodes.length} 份${binding.paperScopeLabel || "活跃试卷"}关联到科目“${binding.courseName || binding.courseCode}”`);
  return { ...payload, responseBody: body };
}

async function bindPapersToFormalSession({
  login,
  apiBase,
  sessionId,
  courses,
  workflowSerial = "",
  examDate = "",
  paperSearchScope = "active",
  managerFetch = null,
  requestJson,
  emitLog = () => {},
}) {
  if (!Array.isArray(courses) || !courses.length) throw new Error(INVALID_PAPER_BINDING_MESSAGE);
  const preparedBindings = [];
  const missingCourseCodes = [];
  const duplicatePaperMatches = [];
  const results = [];

  const normalizedPaperSearchScope = paperSearchScope === "all" ? "all" : "active";
  const paperScopeLabel = paperSearchScopeLabel(normalizedPaperSearchScope);
  emitLog(`[试卷绑定] 开始检查${paperScopeLabel}`);
  const tenantFormList = await fetchTenantFormList({
    login,
    apiBase,
    requestJson,
    emitLog,
    paperSearchScope: normalizedPaperSearchScope,
    managerFetch,
  });

  for (const course of courses) {
    const requestedCourseCode = normalizeCourseCode(course);
    const courseName = normalizeCourseName(course);
    if (!requestedCourseCode) throw new Error(INVALID_PAPER_BINDING_MESSAGE);

    const selected = selectFormCodesForCourse({
      courseCode: requestedCourseCode,
      courseName,
      workflowSerial,
      examDate,
      formPapers: tenantFormList,
      multiSubject: courses.length > 1,
    });
    const selectedFormCodes = selected.formCodes;

    const matchMessage = selected.status === "matched"
      ? `已按${selected.matchedByLabel}“${selected.matchedValue}”匹配${paperScopeLabel}“${selected.candidates[0]?.name || ""}”`
      : selected.status === "ambiguous"
        ? `${paperScopeLabel}中有 ${selected.candidates.length} 份试卷命中${selected.matchedByLabel}“${selected.matchedValue}”，需要人工确认`
        : selected.matchedBy === "workflow_serial_and_course_name"
          ? `${paperScopeLabel}中未找到同时包含泛微流水号“${workflowSerial}”和科目名称“${courseName}”的试卷`
          : `${paperScopeLabel}中未找到包含科目编号“${requestedCourseCode}”或科目名称“${courseName}”${workflowSerial ? `或泛微流水号“${workflowSerial}”` : ""}的试卷`;
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
      paperScopeLabel,
      paperNames: selected.candidates.map((item) => item.name).filter(Boolean),
    });
  }

  if (missingCourseCodes.length) {
    emitLog(`[试卷绑定] ${missingCourseCodes.length} 个科目未在${paperScopeLabel}中找到对应试卷`, "warning");
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
  buildSessionSubjectPaperSnapshot,
  detectSessionPaperBindings,
  fetchSessionSubjectPaperSnapshot,
  validatePaperBinding,
};
