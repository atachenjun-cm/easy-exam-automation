const SIMPLE_PRFT_REPORT_TYPE = "simple_PRFT";

function reportSections(payload = {}) {
  const candidates = [
    payload?.form_content?.sections,
    payload?.form?.sections,
    payload?.data?.form_content?.sections,
    payload?.data?.form?.sections,
    payload?.response?.form_content?.sections,
  ];
  return candidates.find((sections) => Array.isArray(sections)) || [];
}

export function isSimplePrftResponse(payload = {}) {
  return reportSections(payload).some((section) => (
    String(section?.custom_report || "").trim().toLowerCase() === "datatalk"
    && String(section?.datatalk?.report_type || "").trim() === SIMPLE_PRFT_REPORT_TYPE
  ));
}

export function normalizeSimplePrftEntryReports(payload = {}) {
  const rawReports = Array.isArray(payload?.data?.entry_reports)
    ? payload.data.entry_reports
    : Array.isArray(payload?.entry_reports)
      ? payload.entry_reports
      : [];
  return rawReports
    .map((report) => {
      if (Array.isArray(report)) {
        return {
          name: String(report[0] || "").trim(),
          url: String(report[1] || "").trim(),
          status: String(report[2] || "").trim(),
        };
      }
      return {
        name: String(report?.name || report?.title || report?.label || "").trim(),
        url: String(report?.url || report?.link || report?.href || "").trim(),
        status: String(report?.status || "").trim(),
      };
    })
    .filter((report) => report.name && report.url);
}

function managerBase(login = {}) {
  const candidate = String(login?.url || login?.apiBase || "https://eztest.org").trim();
  try {
    return new URL(candidate).origin;
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

async function readJsonResponse(response, action) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(`${action}失败：HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loginToManager({ login, fetchImpl }) {
  const username = String(login?.username || "").trim();
  const password = String(login?.password || "");
  if (!username || !password) throw new Error("缺少易考后台账号或密码");
  const payload = username.includes("@")
    ? { email: username, password, remember: false, code: "" }
    : { phone: username, password, remember: false, code: "" };
  const response = await fetchImpl(`${managerBase(login)}/dapi/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await readJsonResponse(response, "登录易考后台查询特殊测评报告");
  const cookie = cookieHeaderFromResponse(response);
  if (!cookie) throw new Error("登录易考后台查询特殊测评报告失败：未返回登录 Cookie");
  return cookie;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

export async function fetchSimplePrftAssessmentReports({
  login,
  sessionId,
  candidates = [],
  requestTenantJson,
  fetchImpl = fetch,
  logs = [],
} = {}) {
  if (!candidates.length || typeof requestTenantJson !== "function") return [];
  const apiBase = String(login?.apiBase || "https://eztest.cn").replace(/\/+$/, "");
  const matched = (await mapWithConcurrency(candidates, 4, async (candidate) => {
    const permit = String(candidate?.row?.permit || candidate?.permit || "").trim();
    if (!permit) return null;
    const responseUrl = new URL(
      `/tenant/api/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(permit)}/response/`,
      apiBase,
    );
    try {
      const payload = await requestTenantJson(login, responseUrl, {}, "查询特殊测评报告类型");
      return isSimplePrftResponse(payload) ? candidate : null;
    } catch (error) {
      logs.push(`[成绩处理] 考生 permit=${permit} 特殊测评报告类型查询失败：${error?.message || error}`);
      return null;
    }
  })).filter(Boolean);

  if (!matched.length) return [];
  logs.push(`[成绩处理] 识别到 ${matched.length} 名 simple_PRFT 特殊测评考生，开始查询管理端考生报告`);
  const cookie = await loginToManager({ login, fetchImpl });
  const base = managerBase(login);
  const results = await mapWithConcurrency(matched, 4, async (candidate) => {
    const permit = String(candidate?.row?.permit || candidate?.permit || "").trim();
    const detailUrl = `${base}/dapi/schedule/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(permit)}/`;
    try {
      const response = await fetchImpl(detailUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
          Cookie: cookie,
          Referer: `${base}/manager/schedule/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(permit)}`,
        },
      });
      const payload = await readJsonResponse(response, `查询考生 permit=${permit} 特殊测评报告`);
      return { candidate, reports: normalizeSimplePrftEntryReports(payload) };
    } catch (error) {
      logs.push(`[成绩处理] 考生 permit=${permit} 特殊测评报告查询失败：${error?.message || error}`);
      return { candidate, reports: [] };
    }
  });
  return results.filter((result) => result.reports.length);
}
