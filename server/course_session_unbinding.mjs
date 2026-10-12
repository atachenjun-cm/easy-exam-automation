function text(value) {
  return String(value ?? "").trim();
}

function managerBase(login = {}) {
  const candidate = text(login?.url || login?.webBase || login?.apiBase || "https://eztest.org");
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

function managerHeaders({ base, cookie, sessionId, json = false }) {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Accept: "application/json, text/plain, */*",
    Cookie: cookie,
    Origin: base,
    Referer: `${base}/manager/schedule/session/${encodeURIComponent(sessionId)}/select_form/wizard/`,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function courseCode(course = {}) {
  return text(course.course_code || course.code);
}

function selectFormPayload(payload = {}) {
  return payload?.data?.select_form || payload?.select_form || null;
}

function selectedFormsForCourses(courses = []) {
  return courses.flatMap((course) => {
    const code = courseCode(course);
    return (Array.isArray(course?.select_forms) ? course.select_forms : []).map((form) => ({
      ...form,
      type: form?.is_template ? "template" : "form",
      course_code: code,
    }));
  });
}

async function loginToManager({ login, fetchImpl }) {
  const username = text(login?.username);
  const password = String(login?.password || "");
  if (!username || !password) {
    const error = new Error("缺少易考后台账号或密码，无法解除场次科目绑定。");
    error.status = 400;
    throw error;
  }
  const base = managerBase(login);
  const loginPayload = username.includes("@")
    ? { email: username, password, remember: false, code: "" }
    : { phone: username, password, remember: false, code: "" };
  const response = await fetchImpl(`${base}/dapi/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginPayload),
  });
  await readManagerJson(response, "登录易考后台解除场次科目绑定");
  const cookie = cookieHeaderFromResponse(response);
  if (!cookie) {
    const error = new Error("登录易考后台解除场次科目绑定失败：未返回登录 Cookie。");
    error.status = 502;
    throw error;
  }
  return { base, cookie };
}

async function fetchSessionSelectForm({ base, cookie, sessionId, sessionKind, fetchImpl }) {
  const url = new URL(`/dapi/schedule/session/${encodeURIComponent(sessionId)}/edit/`, base);
  url.searchParams.set("step", "select_form");
  url.searchParams.set("kind", sessionKind);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: managerHeaders({ base, cookie, sessionId }),
  });
  const payload = await readManagerJson(response, "读取易考场次科目配置");
  const selectForm = selectFormPayload(payload);
  if (!selectForm || !Array.isArray(selectForm.courses)) {
    const error = new Error("易考未返回完整场次科目配置，已停止移除科目。");
    error.status = 502;
    throw error;
  }
  return { url, selectForm };
}

export async function unbindCoursesFromManagerSession({
  login,
  sessionId,
  courseCodes,
  sessionKind = "online_exam",
  fetchImpl = fetch,
  emitLog = () => {},
} = {}) {
  const targetSessionId = text(sessionId);
  const targets = [...new Set((Array.isArray(courseCodes) ? courseCodes : []).map(text).filter(Boolean))];
  if (!targetSessionId || !targets.length) {
    const error = new Error("解除场次科目绑定参数不完整。");
    error.status = 400;
    throw error;
  }

  const { base, cookie } = await loginToManager({ login, fetchImpl });
  const entryCheckResponse = await fetchImpl(
    `${base}/dapi/schedule/session/${encodeURIComponent(targetSessionId)}/entry_check/`,
    {
      method: "GET",
      headers: managerHeaders({ base, cookie, sessionId: targetSessionId }),
    },
  );
  const entryCheck = await readManagerJson(entryCheckResponse, "检查易考场次考生");
  if (entryCheck?.data?.have_entry || entryCheck?.have_entry) {
    const error = new Error(`正式考试场次 ${targetSessionId} 已有考生，易考不允许调整科目。`);
    error.status = 400;
    throw error;
  }

  const { url, selectForm } = await fetchSessionSelectForm({
    base,
    cookie,
    sessionId: targetSessionId,
    sessionKind: text(sessionKind) || "online_exam",
    fetchImpl,
  });
  const targetSet = new Set(targets);
  const existingCodes = new Set(selectForm.courses.map(courseCode).filter(Boolean));
  const presentTargets = targets.filter((code) => existingCodes.has(code));
  if (!presentTargets.length) {
    emitLog(`场次 ${targetSessionId} 已不包含待移除科目：${targets.join("、")}`);
    return { changed: false, removedCourseCodes: [], remainingCourses: selectForm.courses };
  }

  const remainingCourses = selectForm.courses.filter((course) => !targetSet.has(courseCode(course)));
  if (!remainingCourses.length) {
    const error = new Error("不能移除场次内的全部科目。");
    error.status = 400;
    throw error;
  }
  const tenantId = selectForm.tid ?? login?.tenantId;
  if (tenantId === undefined || tenantId === null || text(tenantId) === "") {
    const error = new Error("缺少易考租户编号，无法保存场次科目配置。");
    error.status = 400;
    throw error;
  }

  let remoteModified = false;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: managerHeaders({ base, cookie, sessionId: targetSessionId, json: true }),
      body: JSON.stringify({
        select_form: {
          forms: { select_forms: selectedFormsForCourses(remainingCourses) },
          tid: tenantId,
          sequence_form: Boolean(selectForm.sequence_form),
          courses: remainingCourses,
        },
      }),
    });
    await readManagerJson(response, "保存易考场次科目配置");
    remoteModified = true;

    const readback = await fetchSessionSelectForm({
      base,
      cookie,
      sessionId: targetSessionId,
      sessionKind: text(sessionKind) || "online_exam",
      fetchImpl,
    });
    const readbackCodes = new Set(readback.selectForm.courses.map(courseCode).filter(Boolean));
    const stillBound = targets.filter((code) => readbackCodes.has(code));
    if (stillBound.length) {
      const error = new Error(`科目 ${stillBound.join("、")} 仍在场次 ${targetSessionId} 中，解绑未确认完成。`);
      error.status = 502;
      throw error;
    }
    const missingRemaining = remainingCourses.map(courseCode).filter((code) => code && !readbackCodes.has(code));
    if (missingRemaining.length) {
      const error = new Error(`场次科目回查缺少 ${missingRemaining.join("、")}，已停止后续删除。`);
      error.status = 502;
      throw error;
    }
    emitLog(`已解除场次 ${targetSessionId} 的科目绑定：${presentTargets.join("、")}`);
    return {
      changed: true,
      removedCourseCodes: presentTargets,
      remainingCourses: readback.selectForm.courses,
    };
  } catch (error) {
    if (remoteModified) error.remoteModified = true;
    throw error;
  }
}

export { managerBase, selectedFormsForCourses };
