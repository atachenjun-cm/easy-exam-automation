import path from "node:path";

import {
  advanceOperationBatchListPage,
  formItemByLabel,
  launchOperationBatchContext,
  openExactOperationBatchCard,
  operationConsoleBaseUrl,
  operationBatchDetailIdentity,
  operationDateTitle,
  operationBatchExactCodeLocation,
  runWithOperationBatchContext,
  searchOperationBatchListPages,
  startOperationBatchListSearch,
} from "./operation_personnel_console_runner.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function validDateParts(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function dateParts(value) {
  const match = text(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return validDateParts(...parts) ? parts : null;
}

function dateTimeParts(value) {
  const match = text(value).match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = parts;
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  return parts;
}

function dateString(parts) {
  return parts ? `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}` : "";
}

function dateTimeString(parts) {
  return parts
    ? `${dateString(parts)}T${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`
    : "";
}

function visibleDateTime(value) {
  const parts = dateTimeParts(value);
  return parts
    ? `${dateString(parts)} ${pad(parts[3])}:${pad(parts[4])}`
    : "";
}

function numberText(value) {
  const match = text(value).replace(/分钟/g, "").match(/\d+(?:\.\d+)?/);
  return match ? String(Number(match[0])) : "";
}

function booleanValue(value) {
  return value === true || /^(?:是|true|1)$/i.test(text(value));
}

function elapsedMinutes(startParts, endParts) {
  if (!startParts || !endParts) return "";
  const start = Date.UTC(startParts[0], startParts[1] - 1, startParts[2], startParts[3], startParts[4], startParts[5]);
  const end = Date.UTC(endParts[0], endParts[1] - 1, endParts[2], endParts[3], endParts[4], endParts[5]);
  return end > start ? String(Math.round((end - start) / 60000)) : "";
}

function visibleDateValues(value) {
  return [...text(value).matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)]
    .map((match) => dateString(dateParts(match[0])))
    .filter(Boolean);
}

function visibleDateTimeValues(value, compactEndDate = "") {
  const source = text(value);
  const matches = [...source.matchAll(
    /\d{4}[/-]\d{1,2}[/-]\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2})?/g,
  )];
  const values = matches
    .map((match) => visibleDateTime(match[0]))
    .filter(Boolean);
  if (values.length !== 1 || matches.length !== 1) return values;
  const remainder = source.slice(matches[0].index + matches[0][0].length);
  const compactEnd = remainder.match(
    /^\s*(?:~|至|—|–|-)\s*(\d{1,2}:\d{2}(?::\d{2})?)/,
  );
  if (!compactEnd) return values;
  const startParts = dateTimeParts(values[0]);
  const endDate = dateString(dateParts(compactEndDate)) || dateString(startParts);
  const endParts = dateTimeParts(`${endDate} ${compactEnd[1]}`);
  const end = visibleDateTime(dateTimeString(endParts));
  return end ? [...values, end] : values;
}

function errorWithCode(message, code, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  Object.assign(error, detail);
  return error;
}

export function operationBatchVisibleOverviewFromRaw(raw = {}) {
  const batchName = text(raw.batchName);
  const examText = text(raw.headerInfo).split(/考试日期[：:]/).at(-1);
  const dates = visibleDateValues(examText);
  if (
    Number(raw.titleCount) !== 1
    || Number(raw.headerInfoCount) !== 1
    || !batchName
    || !text(raw.headerInfo).match(/考试日期[：:]/)
    || dates.length < 1
    || dates.length > 2
  ) {
    throw errorWithCode(
      "运控批次静态概况缺少唯一批次名称或有效考试日期",
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  return {
    batchName,
    examStartDate: dates[0],
    examEndDate: dates[1] || dates[0],
  };
}

export async function waitForOperationBatchVisibleOverview(readRaw, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 10000));
  const pollMs = Math.max(0, Number(options.pollMs ?? 100));
  const now = options.now || Date.now;
  const wait = options.wait || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const deadline = now() + timeoutMs;
  let lastError;
  while (true) {
    try {
      return operationBatchVisibleOverviewFromRaw(await readRaw());
    } catch (error) {
      if (error?.code !== "OPERATION_BATCH_INSPECTION_BLOCKED") throw error;
      lastError = error;
    }
    if (now() >= deadline) throw lastError;
    await wait(pollMs);
  }
}

export async function waitForOperationBatchOverviewScheduleAlignment(
  readOverview,
  schedules,
  options = {},
) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 10000));
  const pollMs = Math.max(0, Number(options.pollMs ?? 100));
  const now = options.now || Date.now;
  const wait = options.wait || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const startDate = [...schedules].sort((left, right) => left.start.localeCompare(right.start))[0]?.start.slice(0, 10);
  const endDate = [...schedules].sort((left, right) => left.end.localeCompare(right.end)).at(-1)?.end.slice(0, 10);
  const deadline = now() + timeoutMs;
  let overview = options.initialOverview;
  while (true) {
    if (overview?.examStartDate === startDate && overview?.examEndDate === endDate) return overview;
    if (now() >= deadline) {
      throw errorWithCode(
        `运营批次概况日期 ${overview?.examStartDate || "--"}~${overview?.examEndDate || "--"} 与日程范围 ${startDate || "--"}~${endDate || "--"} 不一致`,
        "OPERATION_BATCH_INSPECTION_BLOCKED",
      );
    }
    await wait(pollMs);
    overview = await readOverview();
  }
}

export function operationBatchVisibleSchedulesFromRaw(raw = {}) {
  const matching = (raw.tables || []).filter((table) => {
    const headers = (table.headers || []).map(text);
    const fixedHeadersPresent = ["场次", "日程代码", "日程", "时区", "时长(分钟)", "考试名称", "考生提前登录(分钟)", "备注"].every((header) => (
      headers.filter((item) => item === header).length === 1
    ));
    const trialHeaders = headers.filter((item) => (
      item === "试考" || item === "自定义考试配置"
    ));
    return fixedHeadersPresent && trialHeaders.length === 1;
  });
  if (matching.length === 0 && raw.emptyScheduleVisible === true) {
    return [];
  }
  if (matching.length !== 1 || matching[0].hasMore) {
    throw errorWithCode(
      matching[0]?.hasMore
        ? "运控批次考试日程存在未读取的后续分页"
        : `必须找到唯一易考考试日程表，实际 ${matching.length} 个`,
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  const table = matching[0];
  const headers = table.headers.map(text);
  const dateIndex = headers.indexOf("日程");
  const nameIndex = headers.indexOf("考试名称");
  const sceneIndex = headers.indexOf("场次");
  const codeIndex = headers.indexOf("日程代码");
  const timezoneIndex = headers.indexOf("时区");
  const durationIndex = headers.indexOf("时长(分钟)");
  const earlyLoginIndex = headers.indexOf("考生提前登录(分钟)");
  const trialIndex = headers.findIndex((header) => (
    header === "试考" || header === "自定义考试配置"
  ));
  const remarkIndex = headers.indexOf("备注");
  const rows = (table.rows || []).filter((row) => (
    Array.isArray(row)
    && row.length === headers.length
    && !row.every((cell) => !text(cell))
  ));
  return rows.map((row, index) => {
    const values = visibleDateTimeValues(row[dateIndex], raw.examEndDate);
    const name = text(row[nameIndex]);
    const expectedDuration = values.length === 2
      ? elapsedMinutes(dateTimeParts(values[0]), dateTimeParts(values[1]))
      : "";
    if (values.length !== 2 || !name || !text(row[sceneIndex]) || !text(row[codeIndex])
      || !text(row[timezoneIndex]) || !numberText(row[earlyLoginIndex]) && numberText(row[earlyLoginIndex]) !== "0"
    ) {
      throw errorWithCode(
        `运控批次可见日程 ${index + 1} 缺少考试名称或完整起止时间`,
        "OPERATION_BATCH_INSPECTION_BLOCKED",
      );
    }
    return {
      scene: text(row[sceneIndex]),
      code: text(row[codeIndex]),
      name,
      start: values[0],
      end: values[1],
      timezone: text(row[timezoneIndex]),
      durationMinutes: expectedDuration,
      earlyLoginMinutes: numberText(row[earlyLoginIndex]) || "0",
      trial: booleanValue(row[trialIndex]),
      remark: text(row[remarkIndex]),
    };
  });
}

export async function waitForOperationBatchVisibleSchedules(readRaw, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 10000));
  const pollMs = Math.max(0, Number(options.pollMs ?? 100));
  const now = options.now || Date.now;
  const wait = options.wait || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const deadline = now() + timeoutMs;
  let lastError;
  while (true) {
    try {
      return operationBatchVisibleSchedulesFromRaw(await readRaw());
    } catch (error) {
      if (error?.code !== "OPERATION_BATCH_INSPECTION_BLOCKED") throw error;
      lastError = error;
    }
    if (now() >= deadline) throw lastError;
    await wait(pollMs);
  }
}

export function operationBatchVisiblePersonnelServiceFromRaw(raw = {}) {
  const personnelItems = (raw.items || []).filter((item) => (
    text(item?.title).replace(/\s+/g, "") === "人员："
  ));
  if (!personnelItems.length) return "不需要";
  const tags = personnelItems.flatMap((item) => (item.tags || []).map(text).filter(Boolean));
  if (personnelItems.length === 1 && tags.length === 1) {
    if (["在线监考", "支持"].includes(tags[0])) return "在线监考";
    if (["不支持", "不需要", "无需"].includes(tags[0])) return "不需要";
  }
  return "";
}

function batchCode(instruction = {}) {
  const code = text(instruction.batch?.code);
  if (!/^[A-Z]{3}\d{6}$/.test(code)) {
    throw errorWithCode("缺少有效的运控批次代码", "OPERATION_BATCH_CODE_REQUIRED");
  }
  return code;
}

function normalizeSnapshot(raw = {}, {
  code = "OPERATION_BATCH_INSPECTION_BLOCKED",
  requireSchedules = false,
} = {}) {
  const batchName = text(raw.batchName);
  const examStartParts = dateParts(raw.examStartDate);
  const examEndParts = dateParts(raw.examEndDate);
  const rawSchedules = Array.isArray(raw.schedules) ? raw.schedules : null;
  const hasServicePersonnel = Object.hasOwn(raw, "servicePersonnel");
  const servicePersonnel = text(raw.servicePersonnel);
  if (!batchName || !examStartParts || !examEndParts || !rawSchedules) {
    throw errorWithCode("运营批次受管字段不完整或格式不合法", code);
  }
  if (hasServicePersonnel && !["不需要", "在线监考"].includes(servicePersonnel)) {
    throw errorWithCode("运营批次人员服务不完整或格式不合法", code);
  }
  if (requireSchedules && !rawSchedules.length) {
    throw errorWithCode("运营批次初始化必须包含至少一条完整日程", code);
  }
  const schedules = rawSchedules.map((schedule, index) => {
    const requirementIndex = Number(schedule?.requirementIndex ?? index);
    const name = text(schedule?.name);
    const scene = text(schedule?.scene);
    const scheduleCode = text(schedule?.code);
    const startParts = dateTimeParts(schedule?.start);
    const endParts = dateTimeParts(schedule?.end);
    const startValue = startParts ? Date.UTC(
      startParts[0],
      startParts[1] - 1,
      startParts[2],
      startParts[3],
      startParts[4],
      startParts[5],
    ) : Number.NaN;
    const endValue = endParts ? Date.UTC(
      endParts[0],
      endParts[1] - 1,
      endParts[2],
      endParts[3],
      endParts[4],
      endParts[5],
    ) : Number.NaN;
    if (
      requirementIndex !== index
      || !scene
      || !scheduleCode
      || !name
      || !startParts
      || !endParts
      || startValue > endValue
    ) {
      throw errorWithCode(`运营批次日程 ${index + 1} 不完整或格式不合法`, code);
    }
    return {
      requirementIndex: index,
      scene,
      code: scheduleCode,
      name,
      start: dateTimeString(startParts),
      end: dateTimeString(endParts),
      timezone: text(schedule?.timezone),
      durationMinutes: numberText(schedule?.durationMinutes) || elapsedMinutes(startParts, endParts),
      earlyLoginMinutes: numberText(schedule?.earlyLoginMinutes) || "0",
      trial: booleanValue(schedule?.trial),
      remark: text(schedule?.remark),
    };
  });
  const examStartDate = dateString(examStartParts);
  const examEndDate = dateString(examEndParts);
  if (examStartDate > examEndDate) {
    throw errorWithCode("运营批次概况考试日期范围不合法", code);
  }
  if (requireSchedules) {
    const scheduleStartDate = [...schedules]
      .sort((left, right) => left.start.localeCompare(right.start))[0].start.slice(0, 10);
    const scheduleEndDate = [...schedules]
      .sort((left, right) => left.end.localeCompare(right.end)).at(-1).end.slice(0, 10);
    if (examStartDate !== scheduleStartDate || examEndDate !== scheduleEndDate) {
      throw errorWithCode(
        `运营批次概况日期 ${examStartDate}~${examEndDate} 与日程范围 ${scheduleStartDate}~${scheduleEndDate} 不一致`,
        code,
      );
    }
  }
  return {
    batchName,
    examStartDate,
    examEndDate,
    ...(hasServicePersonnel ? { servicePersonnel } : {}),
    schedules,
  };
}

function snapshotsEqual(actual, expected) {
  const comparableActual = { ...actual };
  if (!Object.hasOwn(expected, "servicePersonnel")) {
    delete comparableActual.servicePersonnel;
  }
  return JSON.stringify(comparableActual) === JSON.stringify(expected);
}

function batchListUrl(options = {}) {
  const baseUrl = operationConsoleBaseUrl(options);
  return `${baseUrl.replace(/\/$/, "")}/batch/batchList`;
}

function operationBatchListIdentity(result, location, code, expectedName = "") {
  const nameColumns = (result.headers || [])
    .map((header, index) => ({ header: text(header), index }))
    .filter((item) => item.header === "批次名称");
  if (nameColumns.length !== 1) {
    throw errorWithCode(
      `批次列表必须有唯一“批次名称”列，实际 ${nameColumns.length} 列`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  const row = result.pages?.[location.pageNumber - 1]?.[location.rowNumber - 1] || [];
  const actualCode = text(row[location.codeColumn]);
  const actualName = text(row[nameColumns[0].index]);
  if (actualCode !== text(code) || !actualName) {
    throw errorWithCode(
      `批次列表未取得批次代码 ${text(code)} 对应的完整身份`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  if (text(expectedName) && actualName !== text(expectedName)) {
    throw errorWithCode(
      `批次名称不一致：期望 ${text(expectedName)}，实际 ${actualName}`,
      "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH",
      { expectedBatchName: text(expectedName), actualBatchName: actualName },
    );
  }
  return { batchCode: actualCode, batchName: actualName };
}

export async function openOperationBatchIdentityByCode(
  page,
  { batchCode: code, batchName: expectedName = "", batchListUrl: listUrl, options = {} },
) {
  const searchPages = options.searchBatchListPages || searchOperationBatchListPages;
  const startSearch = options.startBatchListSearch || startOperationBatchListSearch;
  const advancePage = options.advanceBatchListPage || advanceOperationBatchListPage;
  const openCard = options.openExactBatchCard || openExactOperationBatchCard;
  const searchResult = await searchPages(page, listUrl, code, options);
  const location = operationBatchExactCodeLocation(searchResult, code);
  const searchedIdentity = operationBatchListIdentity(
    searchResult,
    location,
    code,
    expectedName,
  );
  const searchedPages = searchResult.pages || [];
  let headers = searchResult.headers || [];
  let rows = searchedPages.at(-1) || [];
  let layout = await page.locator(".ant-list:has(.same-batch-title)").count()
    ? "cards"
    : "table";
  if (location.pageNumber !== searchedPages.length) {
    ({ headers, layout, rows } = await startSearch(page, listUrl, code, options));
    for (let pageNumber = 1; pageNumber < location.pageNumber; pageNumber += 1) {
      rows = await advancePage(
        page,
        pageNumber,
        rows,
        listUrl,
        options,
      );
      if (!rows) {
        throw errorWithCode(
          `未能重新定位批次代码 ${code} 所在的第 ${location.pageNumber} 页`,
          "OPERATION_BATCH_UPDATE_CONFLICT",
        );
      }
    }
  }
  const reopenedLocation = operationBatchExactCodeLocation({ headers, pages: [rows] }, code);
  if (reopenedLocation.rowNumber !== location.rowNumber) {
    throw errorWithCode(
      `批次代码 ${code} 在重新定位时行顺序发生变化`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  operationBatchListIdentity(
    { headers, pages: [rows] },
    reopenedLocation,
    code,
    searchedIdentity.batchName,
  );

  if (layout === "cards") {
    await openCard(page, code, { verifyDetailIdentity: false });
  } else {
    const rowLocators = await page.locator("tbody tr").all();
    const matchingRows = [];
    for (const row of rowLocators) {
      const cells = (await row.locator("td").allInnerTexts()).map(text);
      if (cells[location.codeColumn] === code) matchingRows.push(row);
    }
    if (matchingRows.length !== 1) {
      throw errorWithCode(
        `重新打开详情前，批次代码 ${code} 精确匹配到 ${matchingRows.length} 行`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    const link = matchingRows[0]
      .locator("td")
      .nth(location.codeColumn)
      .getByRole("link", { name: code, exact: true });
    if (await link.count() !== 1) {
      throw errorWithCode(
        `批次代码 ${code} 单元格缺少唯一详情链接`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    const detailWait = page.waitForURL(
      (value) => Boolean(operationBatchDetailIdentity(String(value), listUrl)),
      { timeout: 30000 },
    );
    detailWait.catch(() => {});
    await link.click();
    await detailWait;
  }
  const detail = operationBatchDetailIdentity(page.url(), listUrl);
  if (!detail) {
    throw errorWithCode("打开批次后未进入有效详情地址", "OPERATION_BATCH_UPDATE_CONFLICT");
  }
  return { detailUrl: detail.detailUrl, batchName: searchedIdentity.batchName };
}

export async function openOperationBatchByCode(page, input) {
  return (await openOperationBatchIdentityByCode(page, input)).detailUrl;
}

export async function assertOperationBatchDetailIdentityResult(
  page,
  { batchCode: code, batchName: expectedName = "", batchListUrl: listUrl },
) {
  if (typeof page.waitForLoadState === "function") {
    await page.waitForLoadState("domcontentloaded");
  }
  const detail = operationBatchDetailIdentity(page.url(), listUrl);
  if (!detail) {
    throw errorWithCode("批次详情地址与批次列表不一致", "OPERATION_BATCH_UPDATE_CONFLICT");
  }
  const deadline = Date.now() + 10000;
  let stableCodeMatches = 0;
  let actualCode = "";
  let actualName = "";
  while (true) {
    const titles = page.locator(".header-title:visible");
    if (await titles.count() === 1) {
      const title = titles.first();
      const codeNodes = title.locator(":scope > span");
      const nameNodes = title.locator(":scope > label");
      actualCode = await codeNodes.count() === 1 ? text(await codeNodes.innerText()) : "";
      actualName = await nameNodes.count() === 1 ? text(await nameNodes.innerText()) : "";
    } else {
      actualCode = "";
      actualName = "";
    }
    stableCodeMatches = actualCode === code ? stableCodeMatches + 1 : 0;
    if (stableCodeMatches >= 2) break;
    if (Date.now() >= deadline) {
      throw errorWithCode(
        `批次详情页身份与批次代码 ${code} 不一致`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    await pageWait(page)(100);
  }
  if (!actualName) {
    throw errorWithCode(
      `批次详情页未取得实际批次名：${code}`,
      "OPERATION_BATCH_ACTUAL_NAME_MISSING",
    );
  }
  if (text(expectedName) && actualName !== text(expectedName)) {
    throw errorWithCode(
      `批次详情页名称不一致：期望 ${text(expectedName)}，实际 ${actualName || "--"}`,
      "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH",
      { expectedBatchName: text(expectedName), actualBatchName: actualName },
    );
  }
  return { detailUrl: detail.detailUrl, batchName: actualName };
}

export async function assertOperationBatchDetailIdentity(page, input) {
  return (await assertOperationBatchDetailIdentityResult(page, input)).detailUrl;
}

export async function openPersistedOperationBatchDetail(
  page,
  { detailUrl, batchCode: code, batchName: expectedName = "", batchListUrl: listUrl },
) {
  const expectedDetail = operationBatchDetailIdentity(detailUrl, listUrl);
  if (!expectedDetail) {
    throw errorWithCode(
      "已保存的运营批次详情地址无效",
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  const currentDetail = operationBatchDetailIdentity(page.url(), listUrl);
  if (currentDetail?.batchGuid !== expectedDetail.batchGuid) {
    await page.goto(expectedDetail.detailUrl, { waitUntil: "domcontentloaded" });
  }
  return assertOperationBatchDetailIdentity(page, {
    batchCode: code,
    batchName: expectedName,
    batchListUrl: listUrl,
  });
}

async function managedFormControl(page, label) {
  const item = await formItemByLabel(page, label);
  const controls = item.locator("input:visible,textarea:visible");
  const count = await controls.count();
  if (count !== 1) {
    throw errorWithCode(
      `运控批次字段“${label}”必须有唯一可见输入控件，实际 ${count} 个`,
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  return controls.first();
}

function exactScheduleColumn(headers, candidates, label, code = "OPERATION_BATCH_INSPECTION_BLOCKED") {
  const matches = headers
    .map((header, index) => ({ header: text(header), index }))
    .filter((item) => candidates.includes(item.header));
  if (matches.length !== 1) {
    throw errorWithCode(
      `考试日程表必须有唯一“${label}”列，实际 ${matches.length} 列`,
      code,
    );
  }
  return matches[0].index;
}

async function uniqueControl(locator, label, code = "OPERATION_BATCH_UPDATE_CONFLICT") {
  if (await locator.count() === 0) {
    await locator.waitFor({ state: "visible", timeout: 10000 });
  }
  const count = await locator.count();
  if (count !== 1) {
    throw errorWithCode(
      `${label}必须唯一，实际 ${count} 个`,
      code,
    );
  }
  return locator.first();
}

async function selectVisibleTab(page, name) {
  const tab = await uniqueControl(
    page.getByRole("tab", { name, exact: true }),
    `${name}标签页`,
    "OPERATION_BATCH_INSPECTION_BLOCKED",
  );
  if (text(await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
  }
  return tab;
}

function operationEztestScheduleResponseMatches(response) {
  try {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    if (
      pathname !== "/api/batch/get_schedule_list"
      || request.method() !== "POST"
    ) {
      return false;
    }
    const body = JSON.parse(request.postData() || "{}");
    return text(body.data_key).toLowerCase() === "eztest";
  } catch {
    return false;
  }
}

export function operationBatchSaveResponseMatches(response, pathname) {
  try {
    return new URL(response.url()).pathname === pathname
      && response.request().method() === "POST";
  } catch {
    return false;
  }
}

export async function saveOperationBatchModalAndWait({
  page,
  modal,
  button,
  pathname,
  label,
}) {
  let responsePromise;
  if (typeof page.waitForResponse === "function") {
    responsePromise = page.waitForResponse(
      (response) => operationBatchSaveResponseMatches(response, pathname),
      { timeout: 30000 },
    );
    responsePromise.catch(() => {});
  }
  await button.click();
  if (responsePromise) {
    const response = await responsePromise;
    await response.finished();
    const payload = await response.json().catch(() => null);
    if (!response.ok() || Number(payload?.code) !== 10) {
      throw errorWithCode(
        `${label}保存失败：HTTP ${response.status?.() || "?"}，code ${payload?.code ?? "?"}`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
  }
  await modal.waitFor({ state: "hidden", timeout: 10000 });
}

export async function openVisibleEztestSchedulePage(page) {
  const examTab = await uniqueControl(
    page.getByRole("tab", { name: "考试", exact: true }),
    "考试标签页",
    "OPERATION_BATCH_INSPECTION_BLOCKED",
  );
  const examSelected = text(await examTab.getAttribute("aria-selected")) === "true";
  let responsePromise;
  if (!examSelected && typeof page.waitForResponse === "function") {
    responsePromise = page.waitForResponse(
      operationEztestScheduleResponseMatches,
      { timeout: 30000 },
    );
    responsePromise.catch(() => {});
  }
  if (!examSelected) await examTab.click();
  const eztestTab = await uniqueControl(
    page.getByRole("tab", { name: "易考", exact: true }),
    "易考标签页",
    "OPERATION_BATCH_INSPECTION_BLOCKED",
  );
  const eztestSelected = text(await eztestTab.getAttribute("aria-selected")) === "true";
  if (!responsePromise && !eztestSelected && typeof page.waitForResponse === "function") {
    responsePromise = page.waitForResponse(
      operationEztestScheduleResponseMatches,
      { timeout: 30000 },
    );
    responsePromise.catch(() => {});
  }
  if (!eztestSelected) await eztestTab.click();
  if (responsePromise) {
    const response = await responsePromise;
    await response.finished();
    const payload = await response.json().catch(() => null);
    if (!response.ok() || Number(payload?.code) !== 10) {
      throw errorWithCode(
        `易考考试日程读取失败：HTTP ${response.status?.() || "?"}，code ${payload?.code ?? "?"}`,
        "OPERATION_BATCH_INSPECTION_BLOCKED",
      );
    }
  }
  await visibleSection(page, "考试日程", "OPERATION_BATCH_INSPECTION_BLOCKED");
}

async function visibleSection(page, title, code = "OPERATION_BATCH_UPDATE_CONFLICT") {
  const exactTitle = page.getByText(title, { exact: true });
  if (await exactTitle.count() === 0) {
    await exactTitle.waitFor({ state: "visible", timeout: 10000 });
  }
  return uniqueControl(
    page.locator(".ant-collapse-item:visible").filter({ has: exactTitle }),
    `${title}区块`,
    code,
  );
}

async function expandVisibleSection(section) {
  const header = await uniqueControl(
    section.locator(".ant-collapse-header:visible"),
    "折叠区块标题",
    "OPERATION_BATCH_INSPECTION_BLOCKED",
  );
  if (text(await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
    await section.locator(".ant-collapse-content:visible").waitFor({ state: "visible", timeout: 10000 });
  }
}

async function clickSectionEdit(page, title) {
  const section = await visibleSection(page, title);
  await (await uniqueControl(
    section.locator(".anticon-edit:visible"),
    `${title}编辑按钮`,
  )).click();
}

async function visibleModal(page, title) {
  const titleNode = page.getByText(title, { exact: true });
  if (await titleNode.count() === 0) {
    await titleNode.waitFor({ state: "visible", timeout: 10000 });
  }
  return uniqueControl(
    page.locator(".ant-modal:visible").filter({ has: titleNode }),
    `${title}弹窗`,
  );
}

export async function fillOperationBatchOverviewDateRange(page, start, end) {
  const modal = await visibleModal(page, "基本信息");
  const dateControl = await uniqueControl(
    modal.locator("#exam_datetime"),
    "考试日期控件",
  );
  await dateControl.click();
  for (const [label, value] of [["开始日期", start], ["结束日期", end]]) {
    const title = operationDateTitle(value);
    const cell = await uniqueControl(
      page.locator(
        `td[title="${title}"]:not(.ant-calendar-last-month-cell):not(.ant-calendar-next-month-btn-day):visible .ant-calendar-date`,
      ),
      `${label}日期单元格`,
    );
    await cell.click();
  }
  const picker = page.locator(".ant-calendar-picker-container:visible");
  if (await picker.count()) {
    await picker.first().waitFor({ state: "hidden", timeout: 10000 });
  }
  const startInput = await uniqueControl(
    dateControl.locator('input[placeholder="开始日期"]'),
    "开始日期输入框",
  );
  const endInput = await uniqueControl(
    dateControl.locator('input[placeholder="结束日期"]'),
    "结束日期输入框",
  );
  const actualStart = text(await startInput.inputValue());
  const actualEnd = text(await endInput.inputValue());
  if (actualStart !== text(start) || actualEnd !== text(end)) {
    throw errorWithCode(
      `考试日期范围回显不一致：${actualStart} ~ ${actualEnd}`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
}

async function editScheduleTable(page) {
  const modal = await visibleModal(page, "易考——考试日程");
  const matches = [];
  for (const table of await modal.locator("table:visible").all()) {
    const headers = (await table.locator("thead th").allInnerTexts()).map(text);
    try {
      matches.push({
        table,
        columns: {
          scene: exactScheduleColumn(
            headers,
            ["场次"],
            "场次",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          code: exactScheduleColumn(
            headers,
            ["日程代码"],
            "日程代码",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          date: exactScheduleColumn(
            headers,
            ["日程"],
            "日程",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          timezone: exactScheduleColumn(
            headers,
            ["时区"],
            "时区",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          durationMinutes: exactScheduleColumn(
            headers,
            ["时长(分钟)"],
            "时长(分钟)",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          name: exactScheduleColumn(
            headers,
            ["考试名称"],
            "考试名称",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          earlyLoginMinutes: exactScheduleColumn(
            headers,
            ["考生提前登录(分钟)"],
            "考生提前登录(分钟)",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          trial: exactScheduleColumn(
            headers,
            ["试考"],
            "试考",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          remark: exactScheduleColumn(
            headers,
            ["备注"],
            "备注",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
        },
      });
    } catch {}
  }
  if (matches.length !== 1) {
    throw errorWithCode(
      `必须找到唯一易考日程编辑表，实际 ${matches.length} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return matches[0];
}

async function visibleScheduleRows(table) {
  const rows = await table.locator("tbody tr").all();
  const visible = [];
  for (const row of rows) {
    if (
      (typeof row.isVisible !== "function" || await row.isVisible())
      && await row.locator("td").count() > 1
    ) {
      visible.push(row);
    }
  }
  return visible;
}

export async function waitForVisibleScheduleRows(
  readRows,
  minimumCount,
  {
    timeoutMs = 10000,
    pollMs = 100,
    now = Date.now,
    wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  } = {},
) {
  const expected = Math.max(0, Number(minimumCount) || 0);
  const deadline = now() + timeoutMs;
  let rows = [];
  while (true) {
    rows = await readRows();
    if (rows.length >= expected) return rows;
    if (now() >= deadline) {
      throw errorWithCode(
        `等待日程编辑行超时：期望至少 ${expected} 行，实际 ${rows.length} 行`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    await wait(pollMs);
  }
}

export async function clickScheduleAddButtonAndWait({
  button,
  reacquireButton = async () => button,
  readRows,
  beforeCount,
  primaryTimeoutMs = 1500,
  finalTimeoutMs = 10000,
  pollMs = 100,
  now = Date.now,
  wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
}) {
  const before = Math.max(0, Number(beforeCount) || 0);
  const expected = before + 1;
  if (typeof button.scrollIntoViewIfNeeded === "function") {
    await button.scrollIntoViewIfNeeded();
  }
  await button.click({ force: true });
  try {
    return await waitForVisibleScheduleRows(readRows, expected, {
      timeoutMs: primaryTimeoutMs,
      pollMs,
      now,
      wait,
    });
  } catch (error) {
    if (error?.code !== "OPERATION_BATCH_UPDATE_CONFLICT") throw error;
    const rows = await readRows();
    if (rows.length >= expected) return rows;
    if (rows.length !== before) throw error;
  }

  // ATA occasionally consumes the trusted click without updating the React row list.
  const retryButton = await reacquireButton();
  await retryButton.evaluate((element) => element.click());
  return waitForVisibleScheduleRows(readRows, expected, {
    timeoutMs: finalTimeoutMs,
    pollMs,
    now,
    wait,
  });
}

function pageWait(page) {
  return typeof page.waitForTimeout === "function"
    ? (delay) => page.waitForTimeout(delay)
    : (delay) => new Promise((resolve) => setTimeout(resolve, delay));
}

async function fillSingleScheduleCell(row, column, value, label) {
  const inputs = row.locator("td").nth(column).locator("input:visible,textarea:visible");
  const count = await inputs.count();
  if (count !== 1) {
    throw errorWithCode(
      `${label}单元格必须有唯一输入控件，实际 ${count} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  await inputs.first().fill(text(value));
}

async function chooseScheduleSelect(page, row, column, value, label) {
  const cell = row.locator("td").nth(column);
  const control = await uniqueControl(
    cell.locator(".ant-select-selection:visible,.ant-select-selector:visible,[role=combobox]:visible"),
    `${label}下拉框`,
  );
  await control.click();
  const dropdown = await uniqueControl(page.locator(".ant-select-dropdown:visible"), `${label}选项列表`);
  const option = await uniqueControl(dropdown.getByText(text(value), { exact: true }), `${label}选项“${text(value)}”`);
  await option.click();
}

async function setScheduleCheckbox(row, column, checked, label) {
  const input = await uniqueControl(
    row.locator("td").nth(column).locator('input[type="checkbox"]'),
    `${label}复选框`,
  );
  if (Boolean(await input.isChecked()) !== Boolean(checked)) await input.click();
}

export async function fillRangeInputs(
  page,
  container,
  startPlaceholder,
  endPlaceholder,
  start,
  end,
) {
  const startInput = await uniqueControl(
    container.locator(`input[placeholder="${startPlaceholder}"]:visible`),
    `${startPlaceholder}输入框`,
  );
  const endInput = await uniqueControl(
    container.locator(`input[placeholder="${endPlaceholder}"]:visible`),
    `${endPlaceholder}输入框`,
  );
  const startReadonly = await startInput.getAttribute("readonly") !== null;
  const endReadonly = await endInput.getAttribute("readonly") !== null;
  if (startReadonly !== endReadonly) {
    throw errorWithCode(
      `${startPlaceholder}与${endPlaceholder}输入状态不一致`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  if (startReadonly) {
    await startInput.click();
    const picker = await uniqueControl(
      page.locator(".ant-calendar-picker-container:visible"),
      "日期范围选择器",
    );
    const editors = picker.locator(".ant-calendar-input:visible");
    if (await editors.count() !== 2) {
      throw errorWithCode(
        `日期范围选择器必须有两个可编辑输入框，实际 ${await editors.count()} 个`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    await editors.nth(0).fill(text(start));
    await editors.nth(0).press("Tab");
    await editors.nth(1).fill(text(end));
    await editors.nth(1).press("Tab");
    await (await uniqueControl(
      picker.locator(".ant-calendar-ok-btn:visible"),
      "日期范围确定控件",
    )).click();
    const actualStart = text(await startInput.inputValue());
    const actualEnd = text(await endInput.inputValue());
    if (actualStart !== text(start) || actualEnd !== text(end)) {
      throw errorWithCode(
        `日期范围回显不一致：${actualStart} ~ ${actualEnd}`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    return;
  }
  await startInput.fill(text(start));
  await startInput.press("Tab");
  await endInput.fill(text(end));
  await endInput.press("Enter");
}

async function writeVisibleScheduleFields(
  page,
  requirementIndex,
  schedule,
  changed,
  { appended = false } = {},
) {
  let currentTable = await editScheduleTable(page);
  const rows = await waitForVisibleScheduleRows(async () => {
    currentTable = await editScheduleTable(page);
    return visibleScheduleRows(currentTable.table);
  }, requirementIndex + 1, { wait: pageWait(page) });
  const { columns } = currentTable;
  const row = rows[requirementIndex];
  if (!row) {
    throw errorWithCode(
      `未找到按可见顺序排列的日程 ${requirementIndex + 1}`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  if (appended) {
    await fillSingleScheduleCell(row, columns.scene, schedule.scene, "场次");
    await fillSingleScheduleCell(row, columns.code, schedule.code, "日程代码");
  } else {
    if (changed.has("scene")) await fillSingleScheduleCell(row, columns.scene, schedule.scene, "场次");
    if (changed.has("code")) await fillSingleScheduleCell(row, columns.code, schedule.code, "日程代码");
  }
  if (appended || changed.has("name")) {
    await fillSingleScheduleCell(row, columns.name, schedule.name, "考试名称");
  }
  if (appended || changed.has("start") || changed.has("end")) {
    await fillRangeInputs(
      page,
      row.locator("td").nth(columns.date),
      "考试开始时间",
      "考试结束时间",
      visibleDateTime(schedule.start),
      visibleDateTime(schedule.end),
    );
  }
  if (appended || changed.has("timezone")) {
    await chooseScheduleSelect(page, row, columns.timezone, schedule.timezone, "时区");
  }
  if (appended || changed.has("earlyLoginMinutes")) {
    await fillSingleScheduleCell(row, columns.earlyLoginMinutes, schedule.earlyLoginMinutes, "考生提前登录(分钟)");
  }
  if (appended || changed.has("trial")) {
    await setScheduleCheckbox(row, columns.trial, schedule.trial, "试考");
  }
  if (appended || changed.has("remark")) {
    await fillSingleScheduleCell(row, columns.remark, schedule.remark, "备注");
  }
}

async function uniqueButton(root, name, errorLabel) {
  const button = root.getByRole("button", { name });
  const count = await button.count();
  if (count !== 1) {
    throw errorWithCode(
      `${errorLabel}按钮必须唯一，实际 ${count} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return button;
}

export async function visibleButtonByExactText(root, exactText, errorLabel) {
  const escaped = text(exactText).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const button = root
    .locator("button:visible")
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) });
  const count = await button.count();
  if (count !== 1) {
    throw errorWithCode(
      `${errorLabel}按钮必须唯一，实际 ${count} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return button.first();
}

export async function reloadOperationBatchDetailForInspection(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function visibleButtonByCompactText(root, compactLabel, errorLabel) {
  const matches = [];
  for (const button of await root.locator("button:visible").all()) {
    if (text(await button.innerText()).replace(/\s+/g, "") === compactLabel) {
      matches.push(button);
    }
  }
  if (matches.length !== 1) {
    throw errorWithCode(
      `${errorLabel}按钮必须唯一，实际 ${matches.length} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return matches[0];
}

async function selectedServiceButton(button) {
  return text(await button.getAttribute("class")).split(/\s+/).includes("ant-btn-primary");
}

const visiblePageAdapter = {
  openBatchByCode: openOperationBatchByCode,
  refreshDetail: reloadOperationBatchDetailForInspection,
  async readOverview(page) {
    return waitForOperationBatchVisibleOverview(() => page.evaluate(() => {
        const visible = (node) => Boolean(
          node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        );
        const titles = [...document.querySelectorAll(".header-title")].filter(visible);
        const infos = [...document.querySelectorAll(".header-info")].filter(visible);
        return {
          titleCount: titles.length,
          headerInfoCount: infos.length,
          batchName: titles[0]?.querySelector(":scope > label")?.textContent || "",
          headerInfo: infos[0]?.innerText || "",
        };
      }), {
        wait: pageWait(page),
      });
  },
  async readSchedules(page, overview = {}) {
    await openVisibleEztestSchedulePage(page);
    const scheduleSection = await visibleSection(
      page,
      "考试日程",
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
    return waitForOperationBatchVisibleSchedules(async () => {
      const emptyScheduleVisible = text(await scheduleSection.innerText()).includes("暂无数据");
      const raw = await page.evaluate(() => {
        const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
        const visible = (node) => Boolean(
          node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        );
        return {
          tables: [...document.querySelectorAll("table")].filter(visible).map((table) => {
            const panel = table.closest(".ant-collapse-item") || table.parentElement;
            const next = panel?.querySelector(".ant-pagination-next");
            return {
              headers: [...table.querySelectorAll("thead th")].map((cell) => clean(cell.textContent)),
              rows: [...table.querySelectorAll("tbody tr")].filter(visible).map((row) => (
                [...row.querySelectorAll("td")].map((cell) => clean(cell.textContent))
              )),
              hasMore: Boolean(
                next
                && visible(next)
                && !next.classList.contains("ant-pagination-disabled")
                && next.getAttribute("aria-disabled") !== "true"
              ),
            };
          }),
        };
      });
      return { ...raw, emptyScheduleVisible, examEndDate: overview.examEndDate };
    }, { wait: pageWait(page) });
  },
  async readServices(page) {
    await selectVisibleTab(page, "概况");
    const section = await visibleSection(
      page,
      "配置服务",
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
    await expandVisibleSection(section);
    const raw = await section.evaluate((node) => ({
      items: [...node.querySelectorAll(".service-detail-item")].map((item) => ({
        title: item.querySelector(".basic-title-1")?.textContent || "",
        tags: [...item.querySelectorAll(".service-detail-tag")].map((tag) => tag.textContent || ""),
      })),
    }));
    const servicePersonnel = operationBatchVisiblePersonnelServiceFromRaw(raw);
    return servicePersonnel ? { servicePersonnel } : {};
  },
  async beginOverviewEdit(page) {
    await selectVisibleTab(page, "概况");
    await clickSectionEdit(page, "基本信息");
    await visibleModal(page, "基本信息");
  },
  async writeOverviewFields(page, desired, changed) {
    if (changed.has("batchName")) {
      await (await managedFormControl(page, "批次名称")).fill(desired.batchName);
    }
    if (changed.has("examStartDate") || changed.has("examEndDate")) {
      await fillOperationBatchOverviewDateRange(
        page,
        desired.examStartDate,
        desired.examEndDate,
      );
    }
  },
  async saveOverview(page) {
    const modal = await visibleModal(page, "基本信息");
    await saveOperationBatchModalAndWait({
      page,
      modal,
      button: await uniqueButton(modal, /^确\s*定$/, "基本信息确定"),
      pathname: "/api/batch/save_batch_basic",
      label: "批次基本信息",
    });
  },
  async beginServiceEdit(page) {
    await selectVisibleTab(page, "概况");
    await clickSectionEdit(page, "配置服务");
    await visibleModal(page, "配置服务");
  },
  async writeServiceFields(page, desired, changed) {
    if (!changed.has("servicePersonnel")) return;
    const modal = await visibleModal(page, "配置服务");
    const personnelButton = await visibleButtonByCompactText(modal, "人员", "人员服务类别");
    const needsPersonnel = desired.servicePersonnel === "在线监考";
    if (await selectedServiceButton(personnelButton) !== needsPersonnel) {
      await personnelButton.click();
    }
    if (needsPersonnel) {
      const onlineButton = await visibleButtonByCompactText(modal, "在线监考", "在线监考服务");
      if (!await selectedServiceButton(onlineButton)) await onlineButton.click();
      if (!await selectedServiceButton(personnelButton) || !await selectedServiceButton(onlineButton)) {
        throw errorWithCode("未能选中运控批次在线监考服务", "OPERATION_BATCH_UPDATE_CONFLICT");
      }
    } else if (await selectedServiceButton(personnelButton)) {
      throw errorWithCode("未能取消运控批次人员服务", "OPERATION_BATCH_UPDATE_CONFLICT");
    }
  },
  async saveServices(page) {
    const modal = await visibleModal(page, "配置服务");
    await saveOperationBatchModalAndWait({
      page,
      modal,
      button: await uniqueButton(modal, /^确\s*定$/, "配置服务确定"),
      pathname: "/api/batch/save_batch_service",
      label: "批次配置服务",
    });
  },
  async beginScheduleEdit(page) {
    await openVisibleEztestSchedulePage(page);
    await clickSectionEdit(page, "考试日程");
    await visibleModal(page, "易考——考试日程");
  },
  async appendSchedule(page) {
    const modal = await visibleModal(page, "易考——考试日程");
    const { table } = await editScheduleTable(page);
    const before = (await visibleScheduleRows(table)).length;
    const readRows = async () => {
      const current = await editScheduleTable(page);
      return visibleScheduleRows(current.table);
    };
    const rows = await clickScheduleAddButtonAndWait({
      button: await visibleButtonByExactText(modal, "新增", "新增日程"),
      reacquireButton: async () => visibleButtonByExactText(
        await visibleModal(page, "易考——考试日程"),
        "新增",
        "新增日程",
      ),
      readRows,
      beforeCount: before,
      wait: pageWait(page),
    });
    if (rows.length !== before + 1) {
      throw errorWithCode(
        `新增日程后可见行数异常：${before} → ${rows.length}`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
  },
  writeScheduleFields: writeVisibleScheduleFields,
  async saveSchedules(page) {
    const modal = await visibleModal(page, "易考——考试日程");
    await saveOperationBatchModalAndWait({
      page,
      modal,
      button: await uniqueButton(modal, /^确\s*定$/, "易考考试日程确定"),
      pathname: "/api/batch/save_schedule_list",
      label: "易考考试日程",
    });
  },
};

function adapter(options = {}) {
  return options.adapter || visiblePageAdapter;
}

async function readManagedSnapshot(page, pageAdapter, options = {}) {
  let overview = await pageAdapter.readOverview(page);
  const schedules = await pageAdapter.readSchedules(page, overview);
  if (schedules.length) {
    overview = await waitForOperationBatchOverviewScheduleAlignment(
      () => pageAdapter.readOverview(page),
      schedules,
      { initialOverview: overview, wait: pageWait(page) },
    );
  }
  const services = options.includeServicePersonnel !== false
    && typeof pageAdapter.readServices === "function"
    ? await pageAdapter.readServices(page)
    : {};
  return normalizeSnapshot({
    batchName: overview?.batchName,
    examStartDate: overview?.examStartDate,
    examEndDate: overview?.examEndDate,
    ...(Object.hasOwn(services || {}, "servicePersonnel")
      ? { servicePersonnel: services.servicePersonnel }
      : {}),
    schedules: schedules.map((schedule, requirementIndex) => ({
      requirementIndex,
      scene: schedule?.scene,
      code: schedule?.code,
      name: schedule?.name,
      start: schedule?.start,
      end: schedule?.end,
      timezone: schedule?.timezone,
      durationMinutes: schedule?.durationMinutes,
      earlyLoginMinutes: schedule?.earlyLoginMinutes,
      trial: schedule?.trial,
      remark: schedule?.remark,
    })),
  });
}

async function inspectOnPage(page, instruction, options = {}) {
  const code = batchCode(instruction);
  const pageAdapter = adapter(options);
  const listUrl = batchListUrl(options);
  const expectedName = text(instruction.batch?.name || instruction.desiredSnapshot?.batchName);
  const persistedDetailUrl = text(instruction.batch?.detailUrl);
  const detailUrl = options.searchByBatchCode
    ? await pageAdapter.openBatchByCode(page, {
      batchCode: code,
      batchName: expectedName,
      batchListUrl: listUrl,
      options,
    })
    : persistedDetailUrl
    ? await openPersistedOperationBatchDetail(page, {
      detailUrl: persistedDetailUrl,
      batchCode: code,
      batchName: expectedName,
      batchListUrl: listUrl,
    })
    : options.reuseVerifiedDetail
    ? await assertOperationBatchDetailIdentity(page, {
      batchCode: code,
      batchName: expectedName,
      batchListUrl: listUrl,
    })
    : await pageAdapter.openBatchByCode(page, {
      batchCode: code,
      batchName: expectedName,
      batchListUrl: listUrl,
      options,
    });
  if (typeof pageAdapter.refreshDetail === "function") {
    await pageAdapter.refreshDetail(page);
  }
  return {
    snapshot: await readManagedSnapshot(page, pageAdapter, options),
    detailUrl: text(detailUrl),
    pageAdapter,
    listUrl,
  };
}

async function withPage(options, operation) {
  if (options.page) return operation(options.page);
  const userDataDir = text(
    options.userDataDir
    || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"),
  );
  const context = options.context
    || await launchOperationBatchContext(userDataDir, false, options);
  if (options.context || options.closeContext === false) {
    const baseUrl = operationConsoleBaseUrl(options);
    const pages = context.pages();
    if (options.reuseVerifiedDetail) {
      const listUrl = batchListUrl(options);
      const verifiedDetail = operationBatchDetailIdentity(options.verifiedDetailUrl, listUrl);
      if (!verifiedDetail) {
        throw errorWithCode(
          "缺少刚核验的运营批次详情地址，已停止复用详情页",
          "OPERATION_BATCH_UPDATE_CONFLICT",
        );
      }
      const verifiedPage = pages.find((candidate) => {
        const candidateDetail = operationBatchDetailIdentity(candidate.url(), listUrl);
        return candidateDetail?.batchGuid === verifiedDetail.batchGuid;
      });
      if (!verifiedPage) {
        throw errorWithCode(
          "刚核验的运营批次详情页已不存在，已停止后续操作",
          "OPERATION_BATCH_UPDATE_CONFLICT",
        );
      }
      return operation(verifiedPage);
    }
    const page = pages.find((candidate) => {
      try {
        const value = new URL(candidate.url());
        return value.origin === new URL(baseUrl).origin && value.pathname === "/batch/batchDetail";
      } catch {
        return false;
      }
    }) || pages.find((candidate) => {
      try {
        return new URL(candidate.url()).origin === new URL(baseUrl).origin;
      } catch {
        return false;
      }
    }) || pages[0] || await context.newPage();
    return operation(page);
  }
  return runWithOperationBatchContext(context, operation);
}

function completeDesiredSnapshot(instruction, initialization = false) {
  try {
    return normalizeSnapshot(instruction?.desiredSnapshot, {
      code: initialization
        ? "OPERATION_BATCH_INITIALIZATION_INCOMPLETE"
        : "OPERATION_BATCH_DESIRED_SNAPSHOT_INVALID",
      requireSchedules: true,
    });
  } catch (error) {
    if (initialization && error?.code !== "OPERATION_BATCH_INITIALIZATION_INCOMPLETE") {
      error.code = "OPERATION_BATCH_INITIALIZATION_INCOMPLETE";
    }
    throw error;
  }
}

function invalidChanges(message) {
  throw errorWithCode(message, "OPERATION_BATCH_CHANGES_INVALID");
}

function assertExactChange(change, {
  before,
  after,
  requirementIndex,
}) {
  if (
    !Object.hasOwn(change, "before")
    || !Object.hasOwn(change, "after")
    || change.before !== before
    || change.after !== after
    || (
      requirementIndex !== undefined
      && change.requirementIndex !== requirementIndex
    )
  ) {
    invalidChanges(`运营批次修改声明与当前或期望快照不一致：${change.path}`);
  }
}

function validatedManagedFields(changes, current, desired) {
  if (!Array.isArray(changes)) {
    invalidChanges("运营批次修改清单格式不合法");
  }
  const changesByPath = new Map();
  for (const change of changes) {
    const changePath = typeof change?.path === "string" ? change.path : "";
    if (!changePath || changesByPath.has(changePath)) {
      invalidChanges(`运营批次修改清单包含空路径或重复路径：${changePath}`);
    }
    changesByPath.set(changePath, change);
  }

  const fields = {
    overview: new Set(),
    services: new Set(),
    schedules: new Map(),
    appended: new Set(),
  };

  for (const [field] of overviewFields) {
    const change = changesByPath.get(field);
    if (current[field] === desired[field]) {
      if (change) invalidChanges(`运营批次修改清单包含未变化字段：${field}`);
    } else {
      if (!change) invalidChanges(`运营批次修改清单缺少字段：${field}`);
      assertExactChange(change, {
        before: current[field],
        after: desired[field],
      });
      fields.overview.add(field);
      changesByPath.delete(field);
    }
  }

  for (const [field] of serviceFields) {
    if (!Object.hasOwn(desired, field)) continue;
    const change = changesByPath.get(field);
    if (current[field] === desired[field]) {
      if (change) invalidChanges(`运营批次修改清单包含未变化字段：${field}`);
    } else {
      if (!change) invalidChanges(`运营批次修改清单缺少字段：${field}`);
      assertExactChange(change, {
        before: current[field],
        after: desired[field],
      });
      fields.services.add(field);
      changesByPath.delete(field);
    }
  }

  for (let index = 0; index < current.schedules.length; index += 1) {
    const wholePath = `schedules[${index}]`;
    if (changesByPath.has(wholePath)) {
      invalidChanges(`已有运营批次日程不接受整行修改声明：${wholePath}`);
    }
    const changed = new Set();
    for (const [field] of scheduleFields) {
      const changePath = `${wholePath}.${field}`;
      const change = changesByPath.get(changePath);
      if (current.schedules[index][field] === desired.schedules[index][field]) {
        if (change) invalidChanges(`运营批次修改清单包含未变化字段：${changePath}`);
      } else {
        if (!change) invalidChanges(`运营批次修改清单缺少字段：${changePath}`);
        assertExactChange(change, {
          before: current.schedules[index][field],
          after: desired.schedules[index][field],
          requirementIndex: index,
        });
        changed.add(field);
        changesByPath.delete(changePath);
      }
    }
    if (changed.size) fields.schedules.set(index, changed);
  }

  for (let index = current.schedules.length; index < desired.schedules.length; index += 1) {
    const wholePath = `schedules[${index}]`;
    const wholeChange = changesByPath.get(wholePath);
    const fieldChanges = new Map(scheduleFields.map(([field]) => [
      field,
      changesByPath.get(`${wholePath}.${field}`),
    ]));
    const fieldCount = [...fieldChanges.values()].filter(Boolean).length;
    if (wholeChange && fieldCount) {
      invalidChanges(`新增运营批次日程不能混用整行和字段声明：${wholePath}`);
    }
    if (wholeChange) {
      assertExactChange(wholeChange, {
        before: "",
        after: desired.schedules[index].name,
        requirementIndex: index,
      });
      changesByPath.delete(wholePath);
    } else {
      const changed = new Set();
      for (const [field] of scheduleFields) {
        const changePath = `${wholePath}.${field}`;
        const change = fieldChanges.get(field);
        const emptyValue = field === "trial" ? false : "";
        if (desired.schedules[index][field] === emptyValue) {
          if (change) invalidChanges(`运营批次修改清单包含未变化字段：${changePath}`);
          continue;
        }
        if (!change) invalidChanges(`运营批次修改清单缺少字段：${changePath}`);
        assertExactChange(change, {
          before: emptyValue,
          after: desired.schedules[index][field],
          requirementIndex: index,
        });
        changed.add(field);
        changesByPath.delete(changePath);
      }
      fields.schedules.set(index, changed);
    }
    fields.appended.add(index);
  }

  if (changesByPath.size) {
    invalidChanges(
      `运营批次修改清单包含额外或非受管字段：${[...changesByPath.keys()].join("、")}`,
    );
  }
  return fields;
}

const overviewFields = [
  ["batchName", "批次名称"],
  ["examStartDate", "考试开始日期"],
  ["examEndDate", "考试结束日期"],
];

const serviceFields = [
  ["servicePersonnel", "人员服务"],
];

const scheduleFields = [
  ["scene", "场次"],
  ["code", "日程代码"],
  ["name", "考试名称"],
  ["start", "开始时间"],
  ["end", "结束时间"],
  ["timezone", "时区"],
  ["durationMinutes", "时长(分钟)"],
  ["earlyLoginMinutes", "考生提前登录(分钟)"],
  ["trial", "试考"],
  ["remark", "备注"],
];

async function writeManagedChanges(
  page,
  pageAdapter,
  current,
  desired,
  fields,
  { initialize = false } = {},
) {
  let writeCount = 0;
  const overviewChanged = new Set(
    overviewFields
      .map(([field]) => field)
      .filter((field) => initialize || fields.overview.has(field)),
  );
  if (overviewChanged.size) {
    if (typeof pageAdapter.beginOverviewEdit === "function") {
      await pageAdapter.beginOverviewEdit(page);
    }
    if (typeof pageAdapter.writeOverviewFields === "function") {
      await pageAdapter.writeOverviewFields(page, desired, overviewChanged);
      writeCount += overviewChanged.size;
    } else {
      for (const [field, label] of overviewFields) {
        if (!overviewChanged.has(field)) continue;
        await pageAdapter.writeOverview(page, field, label, desired[field]);
        writeCount += 1;
      }
    }
    const saveOverview = pageAdapter.saveOverview || pageAdapter.save;
    await saveOverview(page);
  }

  if (fields.services?.size) {
    if (typeof pageAdapter.beginServiceEdit === "function") {
      await pageAdapter.beginServiceEdit(page);
    }
    if (typeof pageAdapter.writeServiceFields !== "function") {
      throw errorWithCode("运营批次页面不支持修改人员服务", "OPERATION_BATCH_UPDATE_CONFLICT");
    }
    await pageAdapter.writeServiceFields(page, desired, fields.services);
    writeCount += fields.services.size;
    const saveServices = pageAdapter.saveServices || pageAdapter.save;
    await saveServices(page);
  }

  const scheduleChanged = initialize
    || fields.appended.size > 0
    || fields.schedules.size > 0;
  if (!scheduleChanged) return writeCount;
  if (typeof pageAdapter.beginScheduleEdit === "function") {
    await pageAdapter.beginScheduleEdit(page);
  }
  for (let index = 0; index < desired.schedules.length; index += 1) {
    const isNew = index >= current.schedules.length;
    const appended = isNew && (initialize || fields.appended.has(index));
    if (appended) {
      await pageAdapter.appendSchedule(page, index);
      writeCount += 1;
    }
    const changed = fields.schedules.get(index) || new Set();
    const fieldsToWrite = new Set(
      scheduleFields
        .map(([field]) => field)
        .filter((field) => initialize || appended || changed.has(field)),
    );
    if (!fieldsToWrite.size) continue;
    if (typeof pageAdapter.writeScheduleFields === "function") {
      await pageAdapter.writeScheduleFields(
        page,
        index,
        desired.schedules[index],
        fieldsToWrite,
        { appended },
      );
      writeCount += fieldsToWrite.size;
    } else {
      for (const [field, label] of scheduleFields) {
        if (!fieldsToWrite.has(field)) continue;
        const rawValue = desired.schedules[index][field];
        const value = ["start", "end"].includes(field)
          ? visibleDateTime(rawValue)
          : field === "trial" ? (rawValue ? "是" : "否") : rawValue;
        await pageAdapter.writeSchedule(page, index, field, label, value);
        writeCount += 1;
      }
    }
  }
  const saveSchedules = pageAdapter.saveSchedules || pageAdapter.save;
  await saveSchedules(page);
  return writeCount;
}

async function verifyReadback(page, instruction, options, expected) {
  const code = batchCode(instruction);
  const pageAdapter = adapter(options);
  const listUrl = batchListUrl(options);
  const expectedName = text(instruction.batch?.name || instruction.desiredSnapshot?.batchName);
  let detailUrl;
  if (options.reuseVerifiedDetail) {
    await page.reload({ waitUntil: "domcontentloaded" });
    detailUrl = await assertOperationBatchDetailIdentity(page, {
      batchCode: code,
      batchName: expectedName,
      batchListUrl: listUrl,
    });
  } else {
    detailUrl = await pageAdapter.openBatchByCode(page, {
      batchCode: code,
      batchName: expectedName,
      batchListUrl: listUrl,
      options,
    });
  }
  const actual = await readManagedSnapshot(page, pageAdapter, options);
  if (!snapshotsEqual(actual, expected)) {
    throw errorWithCode(
      "运营批次保存后回读与期望快照不一致",
      "OPERATION_BATCH_READBACK_MISMATCH",
      { expected, actual, detailUrl: text(detailUrl) },
    );
  }
  return { snapshot: actual, detailUrl: text(detailUrl) };
}

export async function inspectOperationBatchManagedSnapshot(instruction, options = {}) {
  batchCode(instruction);
  return withPage(options, async (page) => (
    await inspectOnPage(page, instruction, {
      ...options,
      includeServicePersonnel: instruction?.includeServicePersonnel !== false,
    })
  ).snapshot);
}

export async function runOperationBatchManagedUpdate(instruction, options = {}) {
  const code = batchCode(instruction);
  const desired = completeDesiredSnapshot(instruction);
  return withPage(options, async (page) => {
    const includesServiceChange = Array.isArray(instruction.changes)
      && instruction.changes.some((change) => change?.path === "servicePersonnel");
    const updateOptions = {
      ...options,
      searchByBatchCode: true,
      includeServicePersonnel: includesServiceChange,
    };
    const inspected = await inspectOnPage(page, instruction, updateOptions);
    const current = inspected.snapshot;
    if (desired.schedules.length < current.schedules.length) {
      throw errorWithCode(
        "不允许减少已同步的运营批次日程数量",
        "OPERATION_BATCH_SCHEDULE_COUNT_DECREASE",
        { currentCount: current.schedules.length, desiredCount: desired.schedules.length },
      );
    }
    const comparableDesired = structuredClone(desired);
    if (!includesServiceChange) delete comparableDesired.servicePersonnel;
    if (snapshotsEqual(current, comparableDesired)) {
      const verified = await verifyReadback(
        page,
        instruction,
        updateOptions,
        comparableDesired,
      );
      return {
        verified: true,
        snapshot: verified.snapshot,
        detailUrl: verified.detailUrl,
        checkpoints: [
          "opened_exact_batch",
          "desired_snapshot_already_present",
          "reentered_exact_batch",
          "exact_readback_verified",
        ],
      };
    }
    let expected;
    try {
      expected = normalizeSnapshot(instruction.batch?.expectedAppliedSnapshot, {
        code: "OPERATION_BATCH_UPDATE_CONFLICT",
      });
    } catch (error) {
      if (error?.code !== "OPERATION_BATCH_UPDATE_CONFLICT") {
        error.code = "OPERATION_BATCH_UPDATE_CONFLICT";
      }
      throw error;
    }
    const comparableExpected = structuredClone(expected);
    if (!includesServiceChange) {
      delete comparableExpected.servicePersonnel;
    }
    if (!snapshotsEqual(current, comparableExpected)) {
      throw errorWithCode(
        `运控批次 ${code} 当前受管字段与已应用快照不一致`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
        { expected: comparableExpected, actual: current },
      );
    }
    const fields = validatedManagedFields(instruction.changes, current, comparableDesired);
    const writeCount = await writeManagedChanges(
      page,
      inspected.pageAdapter,
      current,
      desired,
      fields,
    );
    const verified = await verifyReadback(
      page,
      instruction,
      updateOptions,
      comparableDesired,
    );
    return {
      verified: true,
      snapshot: verified.snapshot,
      detailUrl: verified.detailUrl,
      checkpoints: [
        "opened_exact_batch",
        "expected_snapshot_verified",
        ...(writeCount ? ["managed_fields_saved"] : []),
        "reentered_exact_batch",
        "exact_readback_verified",
      ],
    };
  });
}

export async function runOperationBatchScheduleInitialization(instruction, options = {}) {
  batchCode(instruction);
  const desired = completeDesiredSnapshot(instruction, true);
  return withPage(options, async (page) => {
    const inspected = await inspectOnPage(page, instruction, options);
    if (inspected.snapshot.schedules.length) {
      throw errorWithCode(
        "运营批次日程初始化要求当前日程为空",
        "OPERATION_BATCH_INITIALIZATION_CONFLICT",
        { actual: inspected.snapshot },
      );
    }
    if (inspected.snapshot.batchName !== desired.batchName) {
      throw errorWithCode(
        `运营批次名称不一致：期望 ${desired.batchName}，实际 ${inspected.snapshot.batchName}`,
        "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH",
        { expectedBatchName: desired.batchName, actualBatchName: inspected.snapshot.batchName },
      );
    }
    const fields = {
      overview: new Set(
        overviewFields
          .filter(([field]) => field !== "batchName" && inspected.snapshot[field] !== desired[field])
          .map(([field]) => field),
      ),
      schedules: new Map(),
      appended: new Set(desired.schedules.map((_, index) => index)),
    };
    await writeManagedChanges(
      page,
      inspected.pageAdapter,
      inspected.snapshot,
      desired,
      fields,
    );
    const verified = await verifyReadback(page, instruction, options, desired);
    return {
      verified: true,
      snapshot: verified.snapshot,
      detailUrl: verified.detailUrl,
      checkpoints: [
        "opened_exact_batch",
        "empty_schedule_set_verified",
        "managed_fields_saved",
        "reentered_exact_batch",
        "exact_readback_verified",
      ],
    };
  });
}

export async function synchronizeOperationBatchScheduleForArchive(instruction, options = {}) {
  batchCode(instruction);
  const desired = completeDesiredSnapshot(instruction, true);
  return withPage(options, async (page) => {
    const inspected = await inspectOnPage(page, instruction, options);
    const current = inspected.snapshot;
    if (current.batchName !== desired.batchName) {
      throw errorWithCode(
        `运营批次名称不一致：期望 ${desired.batchName}，实际 ${current.batchName}`,
        "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH",
        { expectedBatchName: desired.batchName, actualBatchName: current.batchName },
      );
    }
    if (current.schedules.length > desired.schedules.length) {
      throw errorWithCode(
        "运营批次现有日程多于正式考试日程，已停止自动归档",
        "OPERATION_BATCH_SCHEDULE_COUNT_DECREASE",
        { currentCount: current.schedules.length, desiredCount: desired.schedules.length },
      );
    }
    if (snapshotsEqual(current, desired)) {
      return {
        status: "success",
        verified: true,
        action: "none",
        snapshot: current,
        detailUrl: inspected.detailUrl,
        checkpoints: ["opened_exact_batch", "exact_schedule_already_present"],
      };
    }
    const fields = {
      overview: new Set(
        overviewFields
          .filter(([field]) => field !== "batchName" && current[field] !== desired[field])
          .map(([field]) => field),
      ),
      schedules: new Map(),
      appended: new Set(),
    };
    for (let index = 0; index < desired.schedules.length; index += 1) {
      if (index >= current.schedules.length) {
        fields.appended.add(index);
        fields.schedules.set(index, new Set(scheduleFields.map(([field]) => field)));
        continue;
      }
      const changed = scheduleFields
        .map(([field]) => field)
        .filter((field) => current.schedules[index][field] !== desired.schedules[index][field]);
      if (changed.length) fields.schedules.set(index, new Set(changed));
    }
    const writeCount = await writeManagedChanges(
      page,
      inspected.pageAdapter,
      current,
      desired,
      fields,
    );
    const verified = await verifyReadback(page, instruction, options, desired);
    return {
      status: "success",
      verified: true,
      action: current.schedules.length ? "update" : "initialize",
      snapshot: verified.snapshot,
      detailUrl: verified.detailUrl,
      checkpoints: [
        "opened_exact_batch",
        current.schedules.length ? "existing_schedule_verified" : "empty_schedule_set_verified",
        ...(writeCount ? ["managed_schedule_saved"] : []),
        "exact_schedule_readback_verified",
      ],
    };
  });
}
