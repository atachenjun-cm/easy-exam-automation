const COLUMN_COUNT = 27;
const SESSION_ID_COLUMN = 15;
const READ_END_COLUMN = "AA";
const READ_BATCH_ROWS = 200;
const READ_MAX_ROWS = 1000;

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseDate(value) {
  const normalized = text(value).replace("T", " ");
  const match = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
  );
}

function durationText(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return "";
  const minutes = Math.round((endDate.getTime() - startDate.getTime()) / 60_000);
  return minutes >= 0 ? `${minutes}分钟` : "";
}

function loginWindowText(config, kind) {
  if (kind === "mock") return "不允许提前登录，无迟到限制";
  const early = Number(config?.earlyLoginMinutes || 0);
  const late = Number(config?.lateLimitMinutes || 0);
  const earlyText = early > 0 ? `提前${early}分钟登录` : "不允许提前登录";
  const lateText = late > 0 ? `允许迟到${late}分钟` : "无迟到限制";
  return `${earlyText}，${lateText}`;
}

function yesNo(value) {
  return value ? "是" : "否";
}

function sessionRow(config, session) {
  const isTrial = session.kind === "mock" || session.sessionType === "trial";
  const kind = isTrial ? "mock" : "main";
  const start = text(session.start || (isTrial ? config.mockStartTimeDisplay : config.startTimeDisplay));
  const end = text(session.end || (isTrial ? config.mockEndTimeDisplay : config.endTimeDisplay));
  const clientExam = Boolean(config.clientExam) || text(config.examType).includes("客户端");
  const loginTimes = isTrial ? 20 : 10;
  const courses = Array.isArray(config.courses) ? config.courses : [];
  const unitInfo = text(config.unitInfo) || courses.map((course) => text(course.name || course.code)).filter(Boolean).join("、");

  return [
    text(session.name || (isTrial ? config.mockExamName : config.examName)),
    text(config.u8Code),
    text(config.projectManager),
    isTrial ? "试考" : "正式",
    text(config.customerName),
    text(config.candidateCount),
    start,
    end,
    loginWindowText(config, kind),
    start && end ? `${start}-${end}` : "",
    durationText(start, end),
    clientExam ? `客户端，${loginTimes}次` : text(config.leaveLimit) ? `网页端，${config.leaveLimit}次` : "网页端",
    text(config.earlySubmitText),
    unitInfo,
    text(config.loginMode),
    text(session.id || session.session_id),
    text(config.punctualCollection),
    yesNo(Boolean(config.videoMonitor)),
    yesNo(Boolean(config.faceDetection)),
    text(config.loginVerifyMode),
    text(config.notificationMethod),
    text(config.notificationTime),
    text(config.calculatorAndDraftPaper),
    text(config.deviceVersion || config.examType),
    text(config.onlineSupport),
    text(config.personalInfoEditing),
    config.hawkeye ? "鹰眼" : "",
  ];
}

export function buildTencentDocRows({ config = {}, created = [] } = {}) {
  return created
    .filter((session) => text(session?.id || session?.session_id))
    .map((session) => sessionRow(config, session));
}

export function tencentDocsSettingsFromEnv(env = process.env) {
  const settings = {
    clientId: text(env.TENCENT_DOC_CLIENT_ID),
    accessToken: text(env.TENCENT_DOC_ACCESS_TOKEN),
    openId: text(env.TENCENT_DOC_OPEN_ID),
    fileId: text(env.TENCENT_DOC_FILE_ID || "DR3NiT296WmtpWXVM"),
    sheetId: text(env.TENCENT_DOC_SHEET_ID || "BB08J2"),
  };
  return {
    ...settings,
    enabled: Boolean(settings.clientId && settings.accessToken && settings.openId && settings.fileId && settings.sheetId),
  };
}

function rowIsBlank(row = []) {
  return row.every((value) => !text(value));
}

function cellValue(cell = {}) {
  const value = cell?.cellValue || {};
  return value.text ?? value.number ?? value.boolValue ?? "";
}

export function remoteGridRows(payload = {}) {
  return (payload?.gridData?.rows || []).map((row) => (row?.values || []).map(cellValue));
}

function hasAnyGridValue(payload = {}) {
  return remoteGridRows(payload).some((row) => row.some((value) => text(value)));
}

export async function readTencentDocRows({ base, sheetId, settings, fetchImpl = fetch } = {}) {
  const rows = [];
  for (let startRow = 1; startRow <= READ_MAX_ROWS; startRow += READ_BATCH_ROWS) {
    const endRow = Math.min(startRow + READ_BATCH_ROWS - 1, READ_MAX_ROWS);
    const rangeUrl = `${base}/${encodeURIComponent(sheetId)}/A${startRow}:${READ_END_COLUMN}${endRow}`;
    let payload;
    try {
      payload = await readJson(await fetchImpl(rangeUrl, { headers: headers(settings) }), "读取");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (startRow > 1 && message.includes("range") && message.includes("invalid")) break;
      throw error;
    }
    rows.push(...remoteGridRows(payload));
    if (!hasAnyGridValue(payload)) break;
  }
  return rows;
}

function requestForRow(sheetId, rowIndex, values) {
  return {
    updateRangeRequest: {
      sheetId,
      gridData: {
        startRow: rowIndex,
        startColumn: 0,
        rows: [{
          values: values.slice(0, COLUMN_COUNT).map((value) => ({ cellValue: { text: text(value) } })),
        }],
      },
    },
  };
}

export function buildBatchUpdateRequests({ sheetId, remoteRows = [], rows = [] } = {}) {
  const reserved = new Set();
  const requests = [];
  for (const row of rows) {
    const sessionId = text(row[SESSION_ID_COLUMN]);
    let target = remoteRows.findIndex(
      (remoteRow, index) => index > 0 && !reserved.has(index) && text(remoteRow?.[SESSION_ID_COLUMN]) === sessionId,
    );
    if (target < 0) {
      target = remoteRows.findIndex((remoteRow, index) => index > 0 && !reserved.has(index) && rowIsBlank(remoteRow));
    }
    if (target < 0) target = Math.max(1, remoteRows.length);
    while (reserved.has(target)) target += 1;
    reserved.add(target);
    requests.push(requestForRow(sheetId, target, row));
  }
  return requests;
}

async function readJson(response, action) {
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }
  const businessCode = payload?.code;
  if (!response.ok || (businessCode !== undefined && Number(businessCode) !== 0)) {
    const detail = payload?.message || payload?.msg || raw || `HTTP ${response.status}`;
    throw new Error(`腾讯文档${action}失败：${detail}`);
  }
  return payload;
}

function headers(settings, includeContentType = false) {
  return {
    "Access-Token": settings.accessToken,
    "Client-Id": settings.clientId,
    "Open-Id": settings.openId,
    Accept: "application/json",
    ...(includeContentType ? { "Content-Type": "application/json" } : {}),
  };
}

export async function syncExamConfigToTencentDocs({ config, created, settings, fetchImpl = fetch } = {}) {
  const required = ["clientId", "accessToken", "openId", "fileId", "sheetId"];
  const missing = required.filter((key) => !text(settings?.[key]));
  if (missing.length) throw new Error(`腾讯文档配置缺失：${missing.join(", ")}`);

  const base = `https://docs.qq.com/openapi/spreadsheet/v3/files/${encodeURIComponent(settings.fileId)}`;
  const remoteRows = await readTencentDocRows({
    base,
    sheetId: settings.sheetId,
    settings,
    fetchImpl,
  });
  const rows = buildTencentDocRows({ config, created });
  const requests = buildBatchUpdateRequests({
    sheetId: settings.sheetId,
    remoteRows,
    rows,
  });
  if (!requests.length) return { updatedRows: 0, requests: [] };

  const updatePayload = await readJson(await fetchImpl(`${base}/batchUpdate`, {
    method: "POST",
    headers: headers(settings, true),
    body: JSON.stringify({ requests }),
  }), "写入");
  return { updatedRows: requests.length, requests, response: updatePayload };
}
