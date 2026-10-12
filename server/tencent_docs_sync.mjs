const COLUMN_COUNT = 30;
const SESSION_ID_COLUMN = 15;
const COLLECTION_RULE_COLUMN = 16;
const READ_END_COLUMN = "AD";
const READ_BATCH_ROWS = 200;
const READ_MAX_ROWS = 1000;
const DEFAULT_FONT_SIZE = 10;
const APPEND_RECHECK_ATTEMPTS = 3;

let syncQueue = Promise.resolve();

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function projectManagerFromPlatformAccount(value) {
  const account = text(value).toLowerCase();
  return {
    "chenjun@ata.net.cn": "陈军",
    "siyuanyuan@ata.net.cn": "司园园",
  }[account] || "";
}

function projectManagerText(config = {}, platformAccountEmail = "") {
  return text(
    config.businessRequirement?.project_manager
    || config.fanweiSource?.raw?.fields?.["选择项目经理"]
    || config.fanweiSource?.raw?.fields?.["项目经理"]
    || config.projectManager,
  ) || projectManagerFromPlatformAccount(platformAccountEmail);
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

function normalizeDisplayTime(value) {
  return text(value).replace(/-/g, "/");
}

function datePart(value) {
  const normalized = normalizeDisplayTime(value);
  const match = normalized.match(/^(\d{4}\/\d{1,2}\/\d{1,2})/);
  return match ? match[1] : "";
}

function weekdayText(value) {
  const parsed = parseDate(value);
  if (!parsed) return "";
  return "日一二三四五六"[parsed.getDay()] || "";
}

function fullDateTimeText(value, includeWeekday = false) {
  const normalized = normalizeDisplayTime(value);
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})/);
  if (!match) return "";
  const date = `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
  return includeWeekday ? `${date}(周${weekdayText(value)})${match[4]}` : `${date}${match[4]}`;
}

function timeOnly(value) {
  const normalized = normalizeDisplayTime(value);
  const match = normalized.match(/\s+(\d{1,2}:\d{2})/);
  return match ? match[1] : "";
}

function monthDayTime(value) {
  const normalized = normalizeDisplayTime(value);
  const match = normalized.match(/^\d{4}\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})/);
  return match ? `${Number(match[1])}月${Number(match[2])}日${match[3]}` : "";
}

function notificationRangeEnd(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return timeOnly(end);
  if (
    startDate.getFullYear() === endDate.getFullYear()
    && startDate.getMonth() === endDate.getMonth()
    && startDate.getDate() === endDate.getDate()
  ) return timeOnly(end);
  if (startDate.getFullYear() === endDate.getFullYear()) return monthDayTime(end);
  return fullDateTimeText(end);
}

function notificationExamTitle(value) {
  return text(value).replace(/-试考$/, "");
}

function unifiedExamCodeFromUrl(value) {
  const normalized = text(value);
  const match = normalized.match(/\/exam\/(\d+)\/uniform\/login\/?/i);
  return match ? `E${match[1]}` : "";
}

function usesUnifiedExamAddress(config, session) {
  const addressText = text(config.examAddress || config.examUrlType);
  if (addressText.includes("独立")) return false;
  if (addressText.includes("统一")) return true;
  if (config.unifiedExamAddress !== undefined) return Boolean(config.unifiedExamAddress);
  return Boolean(unifiedExamCodeFromUrl(session.url) || unifiedExamCodeFromUrl(config.examUrl));
}

function examPasswordText(config, session) {
  const sessionId = text(session.session_id || session.id);
  const unifiedCode = usesUnifiedExamAddress(config, session)
    ? unifiedExamCodeFromUrl(session.url) || unifiedExamCodeFromUrl(config.examUrl)
    : "";
  if (unifiedCode) return unifiedCode;
  const explicitCode = text(
    config.unifiedExamCode ||
    config.unifiedExamPassword ||
    config.examPassword ||
    config.examCode ||
    session.unified_exam_code ||
    session.unifiedExamCode ||
    session.exam_code ||
    session.examCode,
  );
  if (explicitCode) return explicitCode;
  if (sessionId) return sessionId;
  return text(
    "【考试口令】",
  );
}

function sessionExamPasswordText(config, session) {
  const explicitCode = text(
    config.sessionExamPassword ||
    config.sessionPassword ||
    session.exam_password ||
    session.examPassword ||
    session.password ||
    session.session_password ||
    session.sessionPassword ||
    session.exam_code ||
    session.examCode ||
    config.examPassword ||
    config.examCode,
  );
  if (explicitCode) return explicitCode;
  return text(session.session_id || session.id);
}

function tencentDocExamPasswordText(config, session) {
  const sessionPassword = sessionExamPasswordText(config, session);
  const unifiedCode = usesUnifiedExamAddress(config, session)
    ? unifiedExamCodeFromUrl(session.url) || unifiedExamCodeFromUrl(config.examUrl)
    : "";
  if (unifiedCode && sessionPassword) return `统一入口：${unifiedCode}\n考试口令：${sessionPassword}`;
  if (unifiedCode) return unifiedCode;
  return examPasswordText(config, session);
}

function loginWindowText(config, kind) {
  if (kind === "mock") return "不允许提前登录，无迟到限制";
  const early = Number(config?.earlyLoginMinutes || 0);
  const late = Number(config?.lateLimitMinutes || 0);
  const earlyText = early > 0 ? `提前${early}分钟登录` : "不允许提前登录";
  const lateText = late > 0 ? `允许迟到${late}分钟` : "无迟到限制";
  return `${earlyText}，${lateText}`;
}

function minutesBetween(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return 0;
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60_000));
}

function answerTimeRange(config, duration, isTrial) {
  if (isTrial) return "一个单元，10-90分钟";
  const min = Number(config?.minAnswerMinutes || config?.earlySubmitMinutes || 0) || 0;
  return `一个单元，${min > 0 ? min : 60}-${duration || 0}分钟`;
}

function monitorRule(config) {
  const video = Boolean(config.videoMonitor || config.videoRecord);
  const hawkeye = Boolean(config.hawkeye);
  if (video && hawkeye) return "双监控";
  if (video) return "单监控";
  return "不使用";
}

function invigilatorText(config = {}) {
  const fanweiArrangement = text(
    config.businessRequirement?.ata_invigilator_arrangement
    || config.fanweiSource?.raw?.fields?.["是否需要ATA安排人工监考"],
  );
  if (config.videoMonitor || fanweiArrangement.includes("分散")) return "ATA监考";
  return text(config.invigilatorText);
}

function leaveLimitText(config, session, deviceText) {
  const isClientExam = deviceText === "客户端";
  const isTrial = session?.kind === "mock" || session?.sessionType === "trial";
  const fallbackCount = isClientExam ? (isTrial ? 20 : 10) : (isTrial ? 10 : 5);
  const configuredCount = isClientExam
    ? (isTrial ? 20 : config?.clientLoginLimit)
    : config?.leaveLimit;
  const parsedCount = configuredCount === null || configuredCount === undefined || configuredCount === ""
    ? Number.NaN
    : Number(configuredCount);
  const count = Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : fallbackCount;
  return `${deviceText}，${count}次`;
}

function collectionRuleText(config, session) {
  if (sessionIsTrial(session)) return "不准点收卷，无迟到扣时";
  const timeRule = text(config?.timeRule) || "迟到及离开扣时";
  return `准点收卷，${timeRule === "不扣时" ? "无迟到扣时" : timeRule}`;
}

function sessionIsTrial(session = {}) {
  return session.kind === "mock" || session.sessionType === "trial";
}

function sessionRequirementIndex(session = {}) {
  const index = Number(session.requirementIndex || 0);
  return Number.isFinite(index) && index >= 0 ? index : 0;
}

function sessionConfig(config = {}, session = {}) {
  const requirementIndex = sessionRequirementIndex(session);
  const requirements = Array.isArray(config.examRequirements) && config.examRequirements.length
    ? config.examRequirements
    : config.examRequirement?.fields
      ? [config.examRequirement]
      : [];
  const requirementConfig = requirements[requirementIndex]?.config;
  if (!requirementConfig || typeof requirementConfig !== "object" || Array.isArray(requirementConfig)) {
    return config;
  }
  return {
    ...config,
    ...requirementConfig,
    // The detail-page SMS ignores a stale task-level override once a requirement config exists.
    notificationContent: requirementConfig.notificationContent,
  };
}

function notificationText(config, session, requirementSessions = []) {
  const formalSession = requirementSessions.find((item) => !sessionIsTrial(item))
    || (!sessionIsTrial(session) ? session : {});
  const trialSession = requirementSessions.find(sessionIsTrial)
    || (sessionIsTrial(session) ? session : {});
  const formalStart = text(formalSession.start || config.startTimeDisplay);
  const formalEnd = text(formalSession.end || config.endTimeDisplay);
  const trialStart = text(trialSession.start || config.mockStartTimeDisplay);
  const trialEnd = text(trialSession.end || config.mockEndTimeDisplay);
  const examTitle = notificationExamTitle(config.examName || formalSession.name || session.name);
  const formalRange = `${fullDateTimeText(formalStart, true)}-${notificationRangeEnd(formalStart, formalEnd)}`;
  const trialRange = trialStart && trialEnd
    ? `${fullDateTimeText(trialStart)}-${monthDayTime(trialEnd)}`
    : "XXX年XX月XX日XX:XX-X月XX日XX:XX";
  const hasTrial = Boolean(config.mockExamEnabled || requirementSessions.some(sessionIsTrial));
  const trialNotice = hasTrial
    ? `本次考试设置试考环节，请提前参加试考调试考试设备。试考时间为${trialRange}，请在上述时间内完成考前测试。正式考试和试考时，`
    : "";
  const sessionId = text(session.session_id || session.id);
  const examCode = examPasswordText(config, session);
  const clientDownload = text(
    config.clientDownloadUrl ||
    config.clientDownload ||
    (sessionId
      ? `https://eztest.cn/exam/session/${encodeURIComponent(sessionId)}/client/download`
      : "【客户端下载】"),
  );
  return `考生您好！${examTitle}将于北京时间${formalRange}举行。本次考试为在线考试，要求使用电脑下载安装考试客户端作答，并自行准备第二台移动设备作为第二视角监控，客户端下载地址：${clientDownload} 。${trialNotice}打开考试客户端输入口令和您的准考证号即可登录参加考试，考试口令统一为：${examCode}，准考证号均为个人手机号。正式考试可提前30分钟登录系统，迟到20分钟后系统将无法登录。若遇系统问题，请联系考试系统界面上的技术支持。祝您考试顺利！（蜀道集团）`;
}

function templateForSession(remoteRows = [], isTrial = false) {
  const marker = isTrial ? "示例-试考" : "示例-正式";
  const found = remoteRows.find((row) => text(row?.[0]).includes(marker));
  return found ? Array.from({ length: COLUMN_COUNT }, (_, index) => text(found[index])) : [];
}

function applyTemplate(values, template = []) {
  const row = Array.from({ length: COLUMN_COUNT }, (_, index) => text(template[index]));
  values.forEach((value, index) => {
    const normalized = text(value);
    if (normalized) row[index] = normalized;
  });
  return row;
}

function sessionRow(config, session, template = [], created = [], platformAccountEmail = "") {
  const isTrial = sessionIsTrial(session);
  const requirementIndex = sessionRequirementIndex(session);
  const requirementSessions = created.filter((item) => sessionRequirementIndex(item) === requirementIndex);
  const kind = isTrial ? "mock" : "main";
  const start = text(session.start || (isTrial ? config.mockStartTimeDisplay : config.startTimeDisplay));
  const end = text(session.end || (isTrial ? config.mockEndTimeDisplay : config.endTimeDisplay));
  const clientExam = Boolean(config.clientExam) || text(config.examType).includes("客户端");
  const startForSheet = normalizeDisplayTime(start);
  const endForSheet = normalizeDisplayTime(end);
  const examKindText = text(config.examKindText) || (isTrial ? "试考-分散模式" : "正式");
  const duration = isTrial ? 90 : minutesBetween(start, end);
  const deviceText = clientExam ? "客户端" : "网页端";
  const importedCandidateCount = Number(session.candidate_count ?? session.candidateCount ?? 0);
  const candidateCount = Number.isFinite(importedCandidateCount) && importedCandidateCount > 0
    ? String(importedCandidateCount)
    : "";
  const projectCode = text(config.businessRequirement?.project_code || config.projectCode);
  const customerName = text(config.fanweiSource?.raw?.fields?.["客户名称（仅供参考）"]) || "蜀道集团";
  const projectManager = projectManagerText(config, platformAccountEmail);

  const row = applyTemplate([
    text(session.name || (isTrial ? config.mockExamName : config.examName)),
    projectCode,
    projectManager,
    examKindText,
    customerName,
    candidateCount,
    text(config.startDateColumn) || datePart(start),
    text(config.endDateColumn) || datePart(end),
    loginWindowText(config, kind),
    startForSheet && endForSheet ? `${startForSheet}-${endForSheet}` : "",
    `${duration}分钟`,
    leaveLimitText(config, session, deviceText),
    isTrial ? "是，作答10分钟可交卷" : "是，作答60分钟可交卷",
    answerTimeRange(config, duration, isTrial),
    text(config.loginMode) || "准考证号",
    tencentDocExamPasswordText(config, session),
    collectionRuleText(config, session),
    monitorRule(config),
    isTrial ? "不需要" : "考中侦测",
    "不需要",
    text(config.notificationMethod) || "ATA短信",
    text(config.notificationTime) || "已通知",
    "纸质草稿纸",
    deviceText,
    "仅在线客服",
    text(config.personalInfoEditing) || "不允许",
    config.hawkeye ? "鹰眼" : "",
    invigilatorText(config),
    text(config.specialRequirementText) || "声音监控",
    text(config.notificationContent) || notificationText(config, session, requirementSessions),
  ], template);
  row[1] = projectCode;
  row[2] = projectManager;
  row[5] = candidateCount;
  return row;
}

export function buildTencentDocRows({ config = {}, created = [], remoteRows = [], platformAccountEmail = "" } = {}) {
  return created
    .filter((session) => text(session?.id || session?.session_id))
    .map((session) => {
      const isTrial = session.kind === "mock" || session.sessionType === "trial";
      return sessionRow(
        sessionConfig(config, session),
        session,
        templateForSession(remoteRows, isTrial),
        created,
        platformAccountEmail,
      );
    });
}

export function tencentDocsSettingsFromEnv(env = process.env) {
  const settings = {
    clientId: text(env.TENCENT_DOC_CLIENT_ID),
    accessToken: text(env.TENCENT_DOC_ACCESS_TOKEN),
    openId: text(env.TENCENT_DOC_OPEN_ID),
    fileId: text(env.TENCENT_DOC_FILE_ID || "DY1pQTURrc1BSSlND"),
    sheetId: text(env.TENCENT_DOC_SHEET_ID || "gd4707"),
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
  const select = value.select;
  if (select && Array.isArray(select.value)) {
    const options = Array.isArray(select.options) ? select.options : [];
    return select.value
      .map((selectedId) => options.find((option) => text(option?.id) === text(selectedId))?.text ?? selectedId)
      .map(text)
      .filter(Boolean)
      .join("，");
  }
  return value.text ?? value.number ?? value.boolValue ?? "";
}

export function remoteGridRows(payload = {}) {
  return (payload?.gridData?.rows || []).map((row) => (row?.values || []).map(cellValue));
}

function collectSelectOptionsByColumn(payload = {}, catalog = new Map()) {
  const startColumn = Number(payload?.gridData?.startColumn || 0);
  for (const row of payload?.gridData?.rows || []) {
    for (const [relativeColumn, cell] of (row?.values || []).entries()) {
      const select = cell?.cellValue?.select;
      const options = Array.isArray(select?.options)
        ? select.options.filter((option) => text(option?.id) && text(option?.text))
        : [];
      if (!options.length) continue;
      const column = startColumn + relativeColumn;
      const current = catalog.get(column);
      if (!current || options.length > current.options.length) {
        catalog.set(column, {
          multiple: Boolean(select.multiple),
          options,
        });
      }
    }
  }
  return catalog;
}

function hasAnyGridValue(payload = {}) {
  return remoteGridRows(payload).some((row) => row.some((value) => text(value)));
}

async function readTencentDocSnapshot({ base, sheetId, settings, fetchImpl = fetch } = {}) {
  const rows = [];
  const selectOptionsByColumn = new Map();
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
    collectSelectOptionsByColumn(payload, selectOptionsByColumn);
    if (!hasAnyGridValue(payload)) break;
  }
  return { rows, selectOptionsByColumn };
}

export async function readTencentDocRows(options = {}) {
  return (await readTencentDocSnapshot(options)).rows;
}

function requestCellValue(value, column, selectOptionsByColumn = new Map()) {
  const normalized = text(value);
  const select = column === COLLECTION_RULE_COLUMN
    ? selectOptionsByColumn.get(column)
    : null;
  if (!select || !normalized) return { text: normalized };

  const option = select.options.find((item) => text(item?.text) === normalized);
  if (!option) {
    throw new Error(`腾讯文档Q列下拉选项中找不到“${normalized}”`);
  }
  // Tencent Docs accepts the exact option label when updating a SELECT cell.
  // Sending the SELECT object itself returns success but persists an empty option.
  return { text: option.text };
}

function requestForRow(sheetId, rowIndex, values, selectOptionsByColumn) {
  return {
    updateRangeRequest: {
      sheetId,
      gridData: {
        startRow: rowIndex,
        startColumn: 0,
        rows: [{
          values: values.slice(0, COLUMN_COUNT).map((value, column) => ({
            cellValue: requestCellValue(value, column, selectOptionsByColumn),
            cellFormat: {
              textFormat: {
                fontSize: DEFAULT_FONT_SIZE,
                color: { red: 255, green: 0, blue: 0, alpha: 255 },
              },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
            },
          })),
        }],
      },
    },
  };
}

export function buildBatchUpdateRequests({
  sheetId,
  remoteRows = [],
  rows = [],
  selectOptionsByColumn = new Map(),
} = {}) {
  const lastContentRow = remoteRows.reduce(
    (lastIndex, remoteRow, index) => (rowIsBlank(remoteRow) ? lastIndex : index),
    -1,
  );
  let target = Math.max(1, lastContentRow + 1);
  const requests = [];
  for (const row of rows) {
    requests.push(requestForRow(sheetId, target, row, selectOptionsByColumn));
    target += 1;
  }
  return requests;
}

async function appendTargetIsBlank({ base, sheetId, settings, requests, fetchImpl }) {
  if (!requests.length) return true;
  const startRowIndex = requests[0].updateRangeRequest.gridData.startRow;
  const endRowIndex = requests.at(-1).updateRangeRequest.gridData.startRow;
  const rangeUrl = `${base}/${encodeURIComponent(sheetId)}/A${startRowIndex + 1}:${READ_END_COLUMN}${endRowIndex + 1}`;
  const payload = await readJson(await fetchImpl(rangeUrl, { headers: headers(settings) }), "追加位置复核");
  return remoteGridRows(payload).every(rowIsBlank);
}

async function verifyCollectionRules({ base, sheetId, settings, requests, fetchImpl }) {
  if (!requests.length) return;
  const startRowIndex = requests[0].updateRangeRequest.gridData.startRow;
  const endRowIndex = requests.at(-1).updateRangeRequest.gridData.startRow;
  const rangeUrl = `${base}/${encodeURIComponent(sheetId)}/Q${startRowIndex + 1}:Q${endRowIndex + 1}`;
  const payload = await readJson(await fetchImpl(rangeUrl, { headers: headers(settings) }), "Q列写入后回查");
  const actualValues = remoteGridRows(payload).map((row) => text(row?.[0]));
  const expectedValues = requests.map((request) => text(
    request.updateRangeRequest.gridData.rows?.[0]?.values?.[COLLECTION_RULE_COLUMN]?.cellValue?.text,
  ));
  const mismatchIndex = expectedValues.findIndex((expected, index) => actualValues[index] !== expected);
  if (mismatchIndex >= 0) {
    const rowNumber = startRowIndex + mismatchIndex + 1;
    const actual = actualValues[mismatchIndex] || "空值";
    throw new Error(`腾讯文档Q列写入后回查不一致：Q${rowNumber} 期望“${expectedValues[mismatchIndex]}”，实际为“${actual}”`);
  }
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

async function runTencentDocsSync({
  config,
  created,
  settings,
  platformAccountEmail = "",
  fetchImpl = fetch,
} = {}) {
  const required = ["clientId", "accessToken", "openId", "fileId", "sheetId"];
  const missing = required.filter((key) => !text(settings?.[key]));
  if (missing.length) throw new Error(`腾讯文档配置缺失：${missing.join(", ")}`);

  const base = `https://docs.qq.com/openapi/spreadsheet/v3/files/${encodeURIComponent(settings.fileId)}`;
  let requests = [];
  for (let attempt = 0; attempt < APPEND_RECHECK_ATTEMPTS; attempt += 1) {
    const { rows: remoteRows, selectOptionsByColumn } = await readTencentDocSnapshot({
      base,
      sheetId: settings.sheetId,
      settings,
      fetchImpl,
    });
    const rows = buildTencentDocRows({ config, created, remoteRows, platformAccountEmail });
    requests = buildBatchUpdateRequests({
      sheetId: settings.sheetId,
      remoteRows,
      rows,
      selectOptionsByColumn,
    });
    if (!requests.length) return { updatedRows: 0, requests: [] };
    if (await appendTargetIsBlank({
      base,
      sheetId: settings.sheetId,
      settings,
      requests,
      fetchImpl,
    })) break;
    requests = [];
  }
  if (!requests.length) {
    throw new Error("腾讯文档末尾追加位置持续被占用，已停止写入以避免覆盖现有内容");
  }

  const updatePayload = await readJson(await fetchImpl(`${base}/batchUpdate`, {
    method: "POST",
    headers: headers(settings, true),
    body: JSON.stringify({ requests }),
  }), "写入");
  await verifyCollectionRules({ base, sheetId: settings.sheetId, settings, requests, fetchImpl });
  return { updatedRows: requests.length, requests, response: updatePayload };
}

export function syncExamConfigToTencentDocs(options = {}) {
  const pending = syncQueue.then(() => runTencentDocsSync(options));
  syncQueue = pending.catch(() => {});
  return pending;
}
