import { createHash } from "node:crypto";
import path from "node:path";
import {
  launchOperationBatchContext,
  openExactOperationBatchCard,
  operationBatchDetailIdentity,
  operationConsoleBaseUrl,
  operationDateTitle,
  runWithOperationBatchContext,
  startOperationBatchListSearch,
} from "./operation_personnel_console_runner.mjs";
import {
  openVisibleEztestSchedulePage,
  runOperationBatchScheduleInitialization,
} from "./operation_batch_update_runner.mjs";
import {
  checkboxByLabel,
  visibleCheckboxEntries,
  waitForDirectoryGroupCheckbox,
} from "./operation_content_runner.mjs";
import {
  findOperationTaskAttemptSendRecord,
  normalizeOperationTaskSendRecords,
  operationTaskTimelineSendRecord,
} from "./operation_task_send_record.mjs";

const PERSONNEL_CC_GROUPS = Object.freeze(["考站管理&质量控制部", "结算组"]);
const PERSONNEL_CC_DEFAULT_IDS = Object.freeze(["zypz@ata.net.cn"]);

function text(value) {
  return String(value ?? "").trim();
}

function logicalRecipientGroupName(value) {
  return text(value).replace(/\s*[（(]\s*项目经理\s*[）)]\s*$/, "");
}

function isProjectManagerRecipientGroup(value) {
  return /[（(]\s*项目经理\s*[）)]\s*$/.test(text(value));
}

function projectManagerDirectoryGroup(department = "") {
  if (/^项目实施[一二三四]部$/.test(department)) return `${department}(项目经理)`;
  if (department === "项目实施五部") return `${department}（项目经理）`;
  return text(department);
}

export function operationPersonnelRecipientGroupMatches(actual, expected) {
  return Boolean(text(actual) && text(expected))
    && logicalRecipientGroupName(actual) === logicalRecipientGroupName(expected);
}

export function operationPersonnelRecipientRule(options = {}) {
  const batch = options.target?.batch || options.batch || {};
  const recipients = options.recipients || options.target?.recipients || {};
  const toGroup = text(recipients.toGroup || batch.projectDepartment);
  const toNames = Array.isArray(recipients.toNames) ? recipients.toNames.map(text).filter(Boolean) : [];
  const toName = text(toNames[0] || batch.projectManager);
  if (!toGroup || !toName || toNames.length > 1) {
    throw operationConflict("发送规则必须包含唯一的项目部归属和项目经理");
  }
  return {
    toGroup,
    toName,
    ccGroup: PERSONNEL_CC_GROUPS[0],
    ccGroups: [...PERSONNEL_CC_GROUPS],
    ccCount: 0,
    ccGroupOnly: true,
    allowedDefaultIds: [...PERSONNEL_CC_DEFAULT_IDS],
  };
}

export function operationPersonnelMailSelectionTarget(recipients = {}, rule = {}) {
  const toEmails = [...(recipients.to || [])]
    .filter((item) => text(item?.kind) !== "group")
    .map((item) => text(item?.id).toLowerCase())
    .filter(Boolean);
  const ccPeople = [...(recipients.cc || [])]
    .filter((item) => text(item?.kind) !== "group");
  const ccEmails = ccPeople.map((item) => text(item?.id).toLowerCase()).filter(Boolean);
  const ccGroups = [...(recipients.cc || [])]
    .filter((item) => text(item?.kind) === "group")
    .map((item) => text(item?.name))
    .filter(Boolean);
  return {
    recipients: toEmails,
    cc: ccEmails,
    directoryGroups: {
      recipients: toEmails.length ? [{
        name: projectManagerDirectoryGroup(rule.toGroup),
        emails: toEmails,
      }] : [],
      cc: ccEmails.length ? [{ name: text(rule.ccGroup), emails: ccEmails }] : [],
    },
    selectedGroups: { recipients: [], cc: ccGroups },
    recipientLabel: "人员任务单收件人",
    ccLabel: "人员任务单抄送",
    ccGroupLabel: "人员任务单抄送部门",
  };
}

function numberOrText(value) {
  const normalized = text(value);
  if (!normalized) return "";
  const number = Number(normalized);
  return Number.isFinite(number) ? number : normalized;
}

function normalizeSchedule(raw = {}) {
  return {
    scheduleEntryId: text(raw.scheduleEntryId),
    scheduleCode: numberOrText(raw.scheduleCode),
    subjectCode: text(raw.subjectCode),
    subjectName: text(raw.subjectName),
    start: text(raw.start),
    end: text(raw.end),
    durationMinutes: numberOrText(raw.durationMinutes),
    earlyLoginMinutes: numberOrText(raw.earlyLoginMinutes),
  };
}

function normalizeManagedSchedule(raw = {}) {
  return {
    requirementIndex: Number(raw.requirementIndex),
    name: text(raw.name),
    start: text(raw.start),
    end: text(raw.end),
  };
}

function byScheduleCode(left, right) {
  return Number(left.scheduleCode || 0) - Number(right.scheduleCode || 0)
    || text(left.scheduleCode).localeCompare(text(right.scheduleCode));
}

function assertScheduleCodes(schedules = []) {
  const seen = new Set();
  for (const schedule of schedules) {
    const code = text(numberOrText(schedule?.scheduleCode));
    if (!code) throw batchScheduleConflict("考试日程缺少日程代码，不能进行精确比较");
    if (seen.has(code)) throw batchScheduleConflict(`考试日程代码 ${code} 重复，不能进行精确比较`);
    seen.add(code);
  }
}

function comparableScheduleMinute(value) {
  const raw = text(value);
  const match = raw.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match || (match[6] !== undefined && match[6] !== "00")) {
    throw batchScheduleConflict(
      `考试日程时间 ${raw || "空"} 无效或包含页面无法核验的非零秒`,
    );
  }
  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  ));
  if (parsed.getUTCFullYear() !== Number(year)
      || parsed.getUTCMonth() !== Number(month) - 1
      || parsed.getUTCDate() !== Number(day)
      || parsed.getUTCHours() !== Number(hour)
      || parsed.getUTCMinutes() !== Number(minute)) {
    throw batchScheduleConflict(`考试日程时间 ${raw} 无效`);
  }
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function comparableScheduleContent(schedule = {}) {
  return {
    name: text(schedule.name ?? schedule.subjectName),
    start: comparableScheduleMinute(schedule.start),
    end: comparableScheduleMinute(schedule.end),
  };
}

function sameScheduleContent(left, right) {
  return sameData(
    comparableScheduleContent(left),
    comparableScheduleContent(right),
  );
}

export function operationPersonnelDisplaySchedules(managedSchedules = [], operationSchedules = []) {
  const actual = operationSchedules.map(normalizeSchedule);
  assertScheduleCodes(actual);
  const matchedCodes = new Set();
  const displaySchedules = managedSchedules.map((managed) => {
    const matches = actual.filter((schedule) => (
      sameScheduleContent(schedule, managed)
    ));
    const code = text(matches[0]?.scheduleCode);
    if (matches.length !== 1 || matchedCodes.has(code)) {
      throw batchScheduleConflict("运控日程代码缺失、重复或不能与易考需求一一对应");
    }
    matchedCodes.add(code);
    return {
      scheduleCode: matches[0].scheduleCode,
      name: managed.name,
      start: managed.start,
      end: managed.end,
    };
  });
  if (matchedCodes.size !== actual.length) {
    throw batchScheduleConflict("运控日程代码缺失、重复或不能与易考需求一一对应");
  }
  return displaySchedules;
}

export function operationPersonnelConflictBaseline(
  expected = {},
  actual = {},
  mode = "initial",
  managedSchedules = [],
) {
  const baseline = structuredClone(expected);
  if (mode !== "resend") return baseline;
  operationPersonnelDisplaySchedules(managedSchedules, actual.schedules || []);
  baseline.schedules = structuredClone(actual.schedules || []);
  return baseline;
}

function normalizePersonnel(raw = {}) {
  return {
    serviceType: text(raw.serviceType),
    platform: text(raw.platform),
    loginMonitoring: text(raw.loginMonitoring),
    monitorRatio: text(raw.monitorRatio),
    candidateBasis: numberOrText(raw.candidateBasis),
    monitorCount: numberOrText(raw.monitorCount),
    earliestLoginMinutes: numberOrText(raw.earliestLoginMinutes),
    trialIncluded: raw.trialIncluded === true,
  };
}

function personnelConfigProjection(raw = {}) {
  const personnel = normalizePersonnel(raw);
  return {
    serviceType: personnel.serviceType,
    platform: personnel.platform,
  };
}

export function operationPersonnelResumeBaseline(baseline = {}, checkpoints = {}) {
  const expected = structuredClone(baseline);
  const completedReadback = (name) => (
    checkpoints?.[name]?.status === "completed"
      ? checkpoints[name].readback
      : undefined
  );
  const personnelConfig = completedReadback("sync_personnel_config");
  if (personnelConfig) {
    Object.assign(expected.personnel, personnelConfigProjection(personnelConfig));
  }
  const dates = completedReadback("sync_personnel_dates");
  if (dates) expected.dates = normalizeDates(dates);
  const requirements = completedReadback("sync_exam_service_requirements");
  if (requirements) {
    expected.requirements = normalizeRequirements(requirements);
    const values = new Map(expected.requirements.map((item) => [item.name, item.value]));
    const earliestLoginMinutes = text(values.get("正式考试-最早登录系统时间"))
      .match(/前\s*(\d+)\s*分钟/)?.[1];
    if (earliestLoginMinutes !== undefined) {
      expected.personnel.earliestLoginMinutes = numberOrText(earliestLoginMinutes);
    }
    const monitorCount = values.get("正式考试-监考人员数量");
    if (monitorCount !== undefined) {
      expected.personnel.monitorCount = numberOrText(monitorCount);
    }
    const monitorRatio = values.get("正式考试-监考人员比例");
    if (monitorRatio !== undefined) expected.personnel.monitorRatio = text(monitorRatio);
    const loginMonitoring = values.get("正式考试-监考登录监控");
    if (loginMonitoring !== undefined) {
      expected.personnel.loginMonitoring = text(loginMonitoring);
    }
  }
  return expected;
}

function normalizeDates(raw = {}) {
  return {
    start: text(raw.start),
    end: text(raw.end),
    nameListDue: text(raw.nameListDue),
  };
}

function normalizeRequirements(raw = []) {
  return [...(raw || [])].map((item) => ({
    name: text(item?.name),
    value: text(item?.value),
  }));
}

function normalizeTaskSheet(raw = {}) {
  const condition = (item) => (
    item && typeof item === "object"
      ? { name: text(item.name), satisfied: item.satisfied === true }
      : text(item)
  );
  return {
    type: text(raw.type),
    conditions: [...(raw.conditions || [])].map(condition),
    content: text(raw.content),
  };
}

function normalizeSendRecords(raw = []) {
  return normalizeOperationTaskSendRecords(raw);
}

function normalizeDirectoryMatch(raw = {}) {
  const people = (items) => [...(items || [])].map((item) => ({
    group: text(item?.group),
    id: text(item?.id),
    name: text(item?.name),
    ...(text(item?.kind) ? { kind: text(item.kind) } : {}),
  }));
  return { to: people(raw.to), cc: people(raw.cc) };
}

export function normalizeOperationPersonnelSnapshot(raw = {}) {
  assertScheduleCodes(raw.schedules || []);
  return {
    batch: {
      code: text(raw.batch?.code),
      projectCode: text(raw.batch?.projectCode),
      projectName: text(raw.batch?.projectName),
      batchName: text(raw.batch?.batchName),
      projectDepartment: text(raw.batch?.projectDepartment),
      projectManager: text(raw.batch?.projectManager),
      systemType: text(raw.batch?.systemType),
      published: raw.batch?.published === true,
    },
    schedules: [...(raw.schedules || [])].map(normalizeSchedule).sort(byScheduleCode),
    personnel: normalizePersonnel(raw.personnel),
    dates: normalizeDates(raw.dates),
    requirements: normalizeRequirements(raw.requirements),
    taskSheet: normalizeTaskSheet(raw.taskSheet),
    sendRecords: normalizeSendRecords(raw.sendRecords),
    directoryMatch: normalizeDirectoryMatch(raw.directoryMatch),
  };
}

function exactGroup(groups, name) {
  const matches = groups.filter((group) => (
    operationPersonnelRecipientGroupMatches(group?.name, name)
  ));
  const projectManagerMatches = matches.filter((group) => (
    isProjectManagerRecipientGroup(group?.name)
  ));
  const resolved = projectManagerMatches.length ? projectManagerMatches : matches;
  if (resolved.length !== 1) {
    throw new Error(`人员目录组“${name}”必须精确匹配 1 个，实际 ${resolved.length} 个`);
  }
  return resolved[0];
}

function exactPerson(group, name) {
  const matches = [...(group.people || [])].filter((person) => text(person?.name) === name);
  if (matches.length !== 1) {
    throw new Error(`${text(group.name)}中的“${name}”必须精确匹配 1 人，实际 ${matches.length} 人`);
  }
  return matches[0];
}

function recipient(person) {
  return {
    id: text(person?.id),
    name: text(person?.name),
    ...(text(person?.kind) ? { kind: text(person.kind) } : {}),
  };
}

function groupRecipient(name) {
  return { id: `group:${text(name)}`, name: text(name), kind: "group" };
}

export function matchOperationPersonnelRecipients(options = {}) {
  const rule = operationPersonnelRecipientRule(options);
  const groups = [...(options.groups || [])];
  const toGroup = exactGroup(groups, rule.toGroup);
  const to = [recipient(exactPerson(toGroup, rule.toName))];
  if (!rule.ccGroups.length) return { to, cc: [] };
  const ccGroups = rule.ccGroups.map((groupName) => exactGroup(groups, groupName));
  if (rule.ccGroupOnly) return { to, cc: ccGroups.map((group) => groupRecipient(group.name)) };
  const ccGroup = ccGroups[0];
  const cc = [...(ccGroup.people || [])].map(recipient);
  if (cc.length !== rule.ccCount) {
    throw new Error(`${rule.ccGroup}必须精确匹配 ${rule.ccCount} 人，实际 ${cc.length} 人`);
  }
  if (new Set(cc.map((item) => item.id)).size !== cc.length
    || new Set(cc.map((item) => item.name)).size !== cc.length) {
    throw new Error(`${rule.ccGroup}存在重复人员，不能精确匹配`);
  }
  return { to, cc };
}

function directoryMatch(rule, matched) {
  return {
    to: matched.to.map((item) => ({ group: rule.toGroup, ...item })),
    cc: matched.cc.map((item) => ({
      group: item.kind === "group" ? item.name : rule.ccGroup,
      ...item,
    })),
  };
}

function batchCodeColumn(headers = []) {
  const matches = headers
    .map((header, index) => ({ header: text(header), index }))
    .filter((item) => item.header === "批次代码");
  if (matches.length !== 1) {
    throw new Error(`运控人员任务检查阻断：批次列表必须有唯一“批次代码”列，实际 ${matches.length} 列`);
  }
  return matches[0].index;
}

async function readOperationPersonnelBatchPages(page, batchListUrl, batchCode, options = {}) {
  const result = await startOperationBatchListSearch(page, batchListUrl, batchCode, options);
  return {
    headers: result.headers,
    layout: result.layout,
    pages: [result.rows.map((cells) => ({
      cells: cells.map(text),
      pageNumber: 1,
    }))],
  };
}

function exactBatchRow(result = {}, batchCode) {
  const codeColumn = batchCodeColumn(result.headers);
  const matches = (result.pages || [])
    .flat()
    .filter((row) => text(row?.cells?.[codeColumn]) === batchCode);
  if (!matches.length) throw new Error(`未找到批次代码 ${batchCode}`);
  if (matches.length !== 1) throw new Error(`批次代码 ${batchCode} 精确匹配到 ${matches.length} 行`);
  return { ...matches[0], codeColumn };
}

async function openOperationPersonnelBatchRow(page, row, context = {}) {
  const { batchCode, batchPages = {} } = context;
  const { layout } = batchPages;
  const codeColumn = row.codeColumn;
  if (layout === "cards") {
    await openExactOperationBatchCard(page, batchCode);
    if (typeof page.waitForLoadState === "function") {
      await page.waitForLoadState("domcontentloaded");
    }
    return;
  }
  const locators = await page.locator("tbody tr").all();
  const exact = [];
  for (const locator of locators) {
    const cells = (await locator.locator("td").allInnerTexts()).map(text);
    if (cells[codeColumn] === batchCode) exact.push(locator);
  }
  if (exact.length !== 1) {
    throw new Error(`重新打开详情前，批次代码 ${batchCode} 精确匹配到 ${exact.length} 行`);
  }
  const codeCell = exact[0].locator("td").nth(codeColumn);
  const detailLink = codeCell.getByRole("link", { name: batchCode, exact: true });
  if (await detailLink.count() !== 1) {
    throw new Error(`批次代码 ${batchCode} 单元格缺少唯一详情链接`);
  }
  await detailLink.click();
  if (typeof page.waitForLoadState === "function") {
    await page.waitForLoadState("domcontentloaded");
  }
}

const BATCH_IDENTITY_FIELDS = ["code", "batchName"];

function verifyBatchDetailIdentity(expected = {}, actual = {}) {
  const conflicts = BATCH_IDENTITY_FIELDS
    .filter((key) => key === "code" || text(expected[key]))
    .filter((key) => text(expected[key]) !== text(actual[key]))
    .map((key) => `${key} 期望 ${text(expected[key]) || "空"}，实际 ${text(actual[key]) || "空"}`);
  if (conflicts.length) {
    throw new Error(`批次详情身份不一致：${conflicts.join("；")}`);
  }
}

function visibleHeaderField(value, label) {
  const normalized = text(value).replace(/\s+/g, " ");
  const labels = ["业务部归属", "业务负责人", "项目部归属", "项目经理", "考试日期"];
  const otherLabels = labels.filter((item) => item !== label).join("|");
  const match = normalized.match(new RegExp(
    `${label}[：:]\\s*(.*?)(?=\\s*(?:\\||(?:${otherLabels})[：:])|$)`,
  ));
  return text(match?.[1]);
}

export function operationPersonnelBatchIdentityFromVisibleRaw(raw = {}) {
  const titleUnique = Number(raw.titleCount) === 1;
  const projectLinksUnique = Number(raw.projectLinkCount) === 2;
  const headerUnique = Number(raw.headerInfoCount) === 1;
  const publicationTags = [...(raw.statusTags || [])]
    .map(text)
    .filter((value) => ["已发布", "撤销发布", "未发布"].includes(value));
  const statusUnique = Number(raw.statusCount) === 1 && publicationTags.length === 1;
  const systemTypeUnique = Number(raw.systemTypeCount) === 1 && Boolean(text(raw.systemType));
  const projectDepartment = headerUnique
    ? visibleHeaderField(raw.headerInfoText, "项目部归属")
    : "";
  const projectManager = headerUnique
    ? visibleHeaderField(raw.headerInfoText, "项目经理")
    : "";
  const checks = [
    ["批次代码", titleUnique && Boolean(text(raw.code))],
    ["批次名称", titleUnique && Boolean(text(raw.batchName))],
    ["项目编码", projectLinksUnique && Boolean(text(raw.projectCode))],
    ["项目名称", projectLinksUnique && Boolean(text(raw.projectName))],
    ["项目部归属", Boolean(projectDepartment)],
    ["项目经理", Boolean(projectManager)],
    ["系统类型", systemTypeUnique],
    ["发布状态", statusUnique],
  ];
  const missing = checks.filter(([, present]) => !present).map(([label]) => label);
  return {
    batch: {
      code: titleUnique ? text(raw.code) : "",
      projectCode: projectLinksUnique ? text(raw.projectCode) : "",
      projectName: projectLinksUnique ? text(raw.projectName) : "",
      batchName: titleUnique ? text(raw.batchName) : "",
      projectDepartment,
      projectManager,
      systemType: systemTypeUnique ? text(raw.systemType) : "",
      published: statusUnique && publicationTags[0] === "已发布",
    },
    evidence: { present: missing.length === 0, missing },
  };
}

const VISIBLE_PERSONNEL_REQUIREMENT_NAMES = Object.freeze([
  "正式考试-最早登录系统时间",
  "正式考试-监考人员安排",
  "正式考试-监考人员数量",
  "正式考试-监考人员比例",
  "正式考试-监考登录监控",
]);

function visibleLineValue(lines, label) {
  const values = [];
  const prefix = `${label}：`;
  const alternatePrefix = `${label}:`;
  for (let index = 0; index < lines.length; index += 1) {
    const line = text(lines[index]).replace(/\s+/g, " ");
    if (line === label || line === prefix || line === alternatePrefix) {
      const next = text(lines[index + 1]).replace(/\s+/g, " ");
      if (next) values.push(next);
    } else if (line.startsWith(prefix) || line.startsWith(alternatePrefix)) {
      values.push(text(line.slice(
        line.startsWith(prefix) ? prefix.length : alternatePrefix.length,
      )));
    }
  }
  return values.length === 1 ? values[0] : "";
}

export function operationPersonnelPageFromVisibleRaw(raw = {}) {
  const lines = [...(raw.lines || [])].map(text).filter(Boolean);
  const dateRange = visibleLineValue(lines, "人员落实日期");
  const [start = "", end = "", ...extraDates] = dateRange.split("~").map(text);
  const platform = visibleLineValue(lines, "人员落实平台");
  const monitorType = visibleLineValue(lines, "监考类型");
  const nameListDue = visibleLineValue(lines, "人员名单提交日期");
  const requirements = VISIBLE_PERSONNEL_REQUIREMENT_NAMES.map((name) => ({
    name,
    value: visibleLineValue(lines, name),
  }));
  const requirement = (name) => requirements.find((item) => item.name === name)?.value || "";
  const earliestLoginMinutes = requirement("正式考试-最早登录系统时间")
    .match(/前\s*(\d+)\s*分钟/)?.[1] || "";
  const personnelMissing = [
    ["人员落实平台", platform],
    ["监考类型", monitorType === "分散监考"],
  ].filter(([, present]) => !present).map(([label]) => label);
  const datesMissing = [
    ["人员落实开始日期", start],
    ["人员落实结束日期", end && extraDates.length === 0],
    ["人员名单提交日期", nameListDue],
  ].filter(([, present]) => !present).map(([label]) => label);
  const requirementsMissing = requirements
    .filter((item) => !item.value)
    .map((item) => item.name);
  return {
    personnel: normalizePersonnel({
      serviceType: monitorType === "分散监考" ? "ATA 监考－分散在线监考" : "",
      platform,
      loginMonitoring: requirement("正式考试-监考登录监控"),
      monitorRatio: requirement("正式考试-监考人员比例"),
      candidateBasis: "",
      monitorCount: requirement("正式考试-监考人员数量"),
      earliestLoginMinutes,
      trialIncluded: false,
    }),
    dates: normalizeDates({ start, end, nameListDue }),
    requirements,
    evidence: {
      personnel: {
        present: personnelMissing.length === 0,
        missing: personnelMissing,
      },
      dates: {
        present: datesMissing.length === 0,
        missing: datesMissing,
      },
      requirements: {
        present: requirementsMissing.length === 0,
        missing: requirementsMissing,
      },
    },
  };
}

export async function clickVisiblePersonnelPaginationNext(control) {
  const clickable = control.locator("button, a").first();
  if (await clickable.count() !== 1) {
    throw operationControlError("分散在线监考任务下一页按钮", await clickable.count());
  }
  await clickable.evaluate((element) => element.click());
}

export function operationPersonnelCurrentPageFromVisibleRaw(raw = {}) {
  const paginationCount = Number(raw.paginationCount || 0);
  if (paginationCount === 0) return 1;
  if (paginationCount !== 1) {
    throw operationControlError("分散在线监考任务分页", paginationCount);
  }
  const activeCount = Number(raw.activeCount || 0);
  if (activeCount !== 1) {
    throw operationControlError("分散在线监考任务当前页", activeCount);
  }
  const value = text(raw.value);
  if (!/^\d+$/.test(value)) throw new Error(`分散在线监考任务当前页无效：${value || "空"}`);
  return Number(value);
}

export async function readVisiblePersonnelTaskResultSummary(page, timeout = 10_000) {
  const summary = page.getByText(/^找到\s*\d+\s*条结果$/);
  if (await summary.count() === 0) {
    await summary.first().waitFor({ state: "visible", timeout });
  }
  const count = await summary.count();
  if (count !== 1) throw operationControlError("分散在线监考任务结果统计", count);
  const value = text(await summary.first().innerText());
  if (!/^找到\s*\d+\s*条结果$/.test(value)) {
    throw new Error(`分散在线监考任务结果统计无效：${value || "空"}`);
  }
  return value;
}

export async function waitForVisiblePersonnelTaskInitialResults(page, options = {}) {
  const maxChecks = Math.max(1, Number(options.maxChecks || 51));
  const pollMs = Math.max(0, Number(options.pollMs ?? 200));
  let summary = "";
  for (let check = 0; check < maxChecks; check += 1) {
    summary = await readVisiblePersonnelTaskResultSummary(page);
    if (!/^找到\s*0\s*条结果$/.test(summary)) return summary;
    if (check + 1 < maxChecks && typeof page.waitForTimeout === "function") {
      await page.waitForTimeout(pollMs);
    }
  }
  throw new Error(`分散在线监考任务初始列表未完成加载：${summary || "无结果统计"}`);
}

export function operationPersonnelTaskListFilterSettled(raw = {}) {
  const summary = text(raw.summary);
  const summaryMatch = summary.match(/^找到\s*(\d+)\s*条结果$/);
  const pageSize = Math.max(1, Number(raw.pageSize || 10));
  if (!summaryMatch) return false;
  const total = Number(summaryMatch[1]);
  const summarySettled = summary !== text(raw.previousSummary)
    || /^找到\s*1\s*条结果$/.test(text(raw.previousSummary));
  const paginationCount = Number(raw.paginationCount || 0);
  const paginationSettled = paginationCount === 0
    ? total <= pageSize
    : paginationCount === 1
      && Number(raw.activePage) === 1
      && (total > pageSize || raw.nextDisabled === true);
  return summarySettled
    && paginationSettled
    && Number(raw.exactCount) === 1
    && Number(raw.rowCount) === Math.min(total, pageSize);
}

export function operationPersonnelTaskListPageCount(summary, pageSize = 10) {
  const match = text(summary).match(/^找到\s*(\d+)\s*条结果$/);
  if (!match) throw new Error(`分散在线监考任务结果统计无效：${text(summary) || "空"}`);
  return Math.max(1, Math.ceil(Number(match[1]) / Math.max(1, Number(pageSize || 10))));
}

export function operationPersonnelTaskListCanReuseFilter(currentValue, searchValue, summary) {
  return text(currentValue) === text(searchValue)
    && /^找到\s*1\s*条结果$/.test(text(summary));
}

export async function submitVisiblePersonnelTaskFilter(search, searchValue) {
  await search.fill("");
  await search.fill(searchValue);
  await search.press("Enter");
}

export function operationPersonnelTaskSearchValue(visibility = {}, batchCode, batchName) {
  if (visibility.batchCodeColumnVisible) return text(batchCode);
  if (visibility.batchNameColumnVisible) return text(batchName);
  throw new Error("分散在线监考任务主表缺少可见的批次代码或批次名称列");
}

export async function waitForVisiblePersonnelTaskListFilter(page, options = {}) {
  const maxChecks = Math.max(1, Number(options.maxChecks || 51));
  const pollMs = Math.max(0, Number(options.pollMs ?? 200));
  const stableChecks = Math.max(1, Number(options.stableChecks || 5));
  let consecutiveStable = 0;
  let latest = {};
  for (let check = 0; check < maxChecks; check += 1) {
    latest = await page.evaluate(({ batchCode, batchName, previousSummary }) => {
      const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
      const visible = (element) => Boolean(
        element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length)
      );
      const tables = [...document.querySelectorAll("table")].filter((table) => {
        if (!visible(table)) return false;
        return [...table.querySelectorAll("thead th")]
          .some((header) => clean(header.textContent) === "批次名称");
      });
      const table = tables.length === 1 ? tables[0] : null;
      const headers = table
        ? [...table.querySelectorAll("thead th")].map((header) => clean(header.textContent))
        : [];
      const rows = table
        ? [...table.querySelectorAll("tbody tr")].filter(visible)
        : [];
      const codeIndex = headers.indexOf("批次代码");
      const nameIndex = headers.indexOf("批次名称");
      const exactCount = rows.filter((row) => {
        const cells = [...row.querySelectorAll("td")].map((cell) => clean(cell.textContent));
        return cells[nameIndex] === batchName
          && (codeIndex < 0 || cells[codeIndex] === batchCode);
      }).length;
      const summary = String(document.body?.innerText ?? "")
        .match(/找到\s*\d+\s*条结果/)?.[0] || "";
      const pageSizeText = [...document.querySelectorAll(".ant-pagination-options-size-changer")]
        .filter(visible)[0]?.textContent || "";
      const paginations = [...document.querySelectorAll(".ant-pagination")].filter(visible);
      const active = paginations.length === 1
        ? [...paginations[0].querySelectorAll(".ant-pagination-item-active")].filter(visible)
        : [];
      const next = paginations.length === 1
        ? [...paginations[0].querySelectorAll(".ant-pagination-next")].filter(visible)
        : [];
      return {
        previousSummary,
        summary: clean(summary),
        tableCount: tables.length,
        exactCount,
        rowCount: rows.length,
        pageSize: Number(pageSizeText.match(/\d+/)?.[0] || 10),
        paginationCount: paginations.length,
        activePage: Number(active[0]?.getAttribute("title") || active[0]?.textContent || 0),
        nextDisabled: next.length === 1 && (
          next[0].classList.contains("ant-pagination-disabled")
          || next[0].getAttribute("aria-disabled") === "true"
        ),
      };
    }, options);
    consecutiveStable = (!options.requiredSummary || latest.summary === options.requiredSummary)
      && latest.tableCount === 1
      && operationPersonnelTaskListFilterSettled(latest)
      ? consecutiveStable + 1
      : 0;
    if (consecutiveStable >= stableChecks) return latest;
    if (check + 1 < maxChecks && typeof page.waitForTimeout === "function") {
      await page.waitForTimeout(pollMs);
    }
  }
  throw new Error(`运控任务查询结果未稳定：${JSON.stringify(latest)}`);
}

function visibleRowMap(rows = []) {
  const output = new Map();
  for (const row of rows) {
    const key = text(row?.[0]);
    if (!key) continue;
    if (output.has(key)) {
      throw new Error(`运控人员任务检查阻断：任务单字段“${key}”重复`);
    }
    output.set(key, text(row?.[1]));
  }
  return output;
}

function requiredHeaderIndex(headers = [], label) {
  const matches = headers
    .map((header, index) => ({ header: text(header), index }))
    .filter((item) => item.header === label);
  if (matches.length !== 1) {
    throw new Error(`运控人员任务检查阻断：任务单日程表头“${label}”必须精确匹配 1 列`);
  }
  return matches[0].index;
}

function visibleScheduleRange(value) {
  const [startValue, endValue, ...extra] = text(value).split("~").map(text);
  if (!startValue || !endValue || extra.length) {
    throw new Error(`运控人员任务检查阻断：任务单日程“${text(value)}”格式无效`);
  }
  const startDate = startValue.match(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}$/)?.[1];
  const end = /^\d{2}:\d{2}$/.test(endValue) && startDate
    ? `${startDate} ${endValue}`
    : endValue;
  return { start: startValue, end };
}

function requiredVisibleScheduleValue(row = {}, labels = [], fieldName) {
  const values = labels
    .filter((label) => Object.hasOwn(row, label))
    .map((label) => text(row[label]))
    .filter(Boolean);
  if (values.length !== 1) {
    throw new Error(`运控人员任务检查阻断：考试日程“${fieldName}”必须精确匹配 1 个值`);
  }
  return values[0];
}

export function operationPersonnelBatchSchedulesFromVisibleRows(rows = []) {
  return [...rows].map((row) => {
    const combined = text(row?.["日程"]);
    const separateStart = text(row?.["开始时间"]);
    const separateEnd = text(row?.["结束时间"]);
    if (combined && (separateStart || separateEnd)) {
      throw new Error("运控人员任务检查阻断：考试日程同时包含组合和分列时间");
    }
    const range = combined
      ? visibleScheduleRange(combined)
      : {
        start: requiredVisibleScheduleValue(row, ["开始时间"], "开始时间"),
        end: requiredVisibleScheduleValue(row, ["结束时间"], "结束时间"),
      };
    return normalizeSchedule({
      scheduleEntryId: row?.__scheduleEntryId || row?.["日程条目ID"] || row?.["日程稳定ID"],
      scheduleCode: requiredVisibleScheduleValue(row, ["日程代码"], "日程代码"),
      subjectCode: row?.["科目代码"],
      subjectName: requiredVisibleScheduleValue(row, ["考试名称", "科目名称"], "考试名称"),
      start: range.start,
      end: range.end,
      durationMinutes: requiredVisibleScheduleValue(row, ["时长(分钟)", "时长"], "时长"),
      earlyLoginMinutes: requiredVisibleScheduleValue(
        row,
        ["考生提前登录(分钟)", "提前登录分钟数"],
        "考生提前登录分钟数",
      ),
    });
  });
}

function visibleConditionSatisfied(value) {
  const normalized = text(value);
  if (/未设置|未发布|已结束/.test(normalized)) return false;
  return /已设置|未结束|已发布/.test(normalized);
}

export function operationPersonnelSendRecordsFromVisibleRows(rows = []) {
  const visibleRows = [...rows];
  if (visibleRows.length < 1
    || text(visibleRows[0]?.[0]) !== "发送时间"
    || text(visibleRows[0]?.[1]) !== "变更内容") {
    throw new Error("运控人员任务检查阻断：发送记录表头无效");
  }
  return visibleRows.slice(1).map((row) => {
    const sentAt = text(row?.[0]);
    const type = text(row?.[1]);
    if (!sentAt || !["首次发送", "再次发送"].includes(type)) {
      throw new Error("运控人员任务检查阻断：发送记录行无效");
    }
    return { type, sentAt };
  });
}

export function operationPersonnelTimelineSendRecordFromVisibleText(value) {
  return operationTaskTimelineSendRecord(value);
}

export function operationPersonnelDirectoryPeopleFromVisibleTexts(values = []) {
  const seen = new Set();
  return [...values].flatMap((value) => {
    const match = text(value).match(/^([^\s()]+@[^\s()]+)\s+\(([^()]+)\)$/);
    if (!match) return [];
    const id = text(match[1]);
    const name = text(match[2]);
    const key = `${id}\0${name}`;
    if (!id || !name || seen.has(key)) return [];
    seen.add(key);
    return [{ id, name }];
  });
}

export function operationPersonnelTaskSheetFromVisibleRaw(raw = {}) {
  const values = visibleRowMap(raw.keyValueRows);

  const scheduleHeaders = [...(raw.scheduleHeaders || [])].map(text);
  const subjectHeader = ["考试名称", "科目名称"].filter(
    (label) => scheduleHeaders.includes(label),
  );
  if (subjectHeader.length !== 1) {
    throw new Error("运控人员任务检查阻断：任务单日程表头“考试名称”必须精确匹配 1 列");
  }
  const scheduleIndexes = Object.fromEntries([
    "日程代码",
    "日程",
    "时长(分钟)",
    subjectHeader[0],
    "考生提前登录(分钟)",
  ].map((label) => [label, requiredHeaderIndex(scheduleHeaders, label)]));
  const schedules = [...(raw.scheduleRows || [])].map((row) => {
    const range = visibleScheduleRange(row[scheduleIndexes["日程"]]);
    return {
      scheduleCode: row[scheduleIndexes["日程代码"]],
      subjectName: row[scheduleIndexes[subjectHeader[0]]],
      start: range.start,
      end: range.end,
      durationMinutes: row[scheduleIndexes["时长(分钟)"]],
      earlyLoginMinutes: row[scheduleIndexes["考生提前登录(分钟)"]],
    };
  });

  const sendRecords = operationPersonnelSendRecordsFromVisibleRows(
    raw.sendRecordRows,
  );
  const loginMinutes = values.get("正式考试-最早登录系统时间")
    ?.match(/前\s*(\d+)\s*分钟/)?.[1] || "";
  const requirementNames = [
    "正式考试-最早登录系统时间",
    "正式考试-监考人员安排",
    "正式考试-监考人员数量",
    "正式考试-监考人员比例",
    "正式考试-监考登录监控",
  ];
  const conditions = [...(raw.conditions || [])].map((name) => ({
    name: text(name),
    satisfied: visibleConditionSatisfied(name),
  }));
  const [combinedStart = "", combinedEnd = ""] = text(values.get("人员落实日期"))
    .split("~")
    .map(text);

  return normalizeOperationPersonnelSnapshot({
    batch: {
      projectCode: values.get("项目编码"),
      projectName: values.get("项目名称"),
      batchName: values.get("批次名称"),
      projectDepartment: values.get("项目部归属"),
      projectManager: values.get("项目经理"),
      systemType: values.get("系统类型"),
      published: conditions.some((item) => (
        item.satisfied
        && item.name.includes("批次状态")
        && item.name.includes("已发布")
      )),
    },
    schedules,
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: values.get("人员落实平台"),
      loginMonitoring: values.get("正式考试-监考登录监控"),
      monitorRatio: values.get("正式考试-监考人员比例"),
      monitorCount: values.get("正式考试-监考人员数量"),
      earliestLoginMinutes: loginMinutes,
      trialIncluded: false,
    },
    dates: {
      start: values.get("人员落实开始日期") || combinedStart,
      end: values.get("人员落实结束日期") || combinedEnd,
      nameListDue: values.get("人员名单提交日期"),
    },
    requirements: requirementNames.map((name) => ({
      name,
      value: values.get(name),
    })),
    taskSheet: {
      type: "分散在线监考",
      conditions,
      content: text(raw.content),
    },
    sendRecords,
  });
}

export async function openVisiblePersonnelTaskSheet(page, instruction = {}, options = {}) {
  const batchCode = text(instruction.batch?.code || instruction.batchCode);
  const batchName = text(instruction.batch?.batchName || instruction.batchName);
  if (!batchCode) throw new Error("缺少运控批次代码");
  if (!batchName) throw new Error("缺少运控批次名称");
  const baseUrl = operationConsoleBaseUrl(options);
  await page.goto(`${baseUrl.replace(/\/$/, "")}/job/decentralizedInvigilate`, {
    waitUntil: "domcontentloaded",
  });
  const search = page.locator(
    'input[placeholder="请输入批次代码、批次名称、项目经理"]:visible',
  );
  if (await search.count() === 0) {
    await search.waitFor({ state: "visible", timeout: 10_000 });
  }
  if (await search.count() !== 1) {
    throw operationControlError("分散在线监考任务筛选框", await search.count());
  }
  const previousResultSummary = await waitForVisiblePersonnelTaskInitialResults(page);
  await page.getByRole("columnheader", { name: "批次名称", exact: true }).first().waitFor({
    state: "visible",
    timeout: 10_000,
  });
  const visibleTables = page.locator("table:visible");
  let batchCodeColumnVisible = false;
  let batchNameColumnVisible = false;
  for (let index = 0; index < await visibleTables.count(); index += 1) {
    const headers = (await visibleTables.nth(index).locator("thead th").allInnerTexts()).map(text);
    batchCodeColumnVisible ||= headers.includes("批次代码");
    batchNameColumnVisible ||= headers.includes("批次名称");
  }
  const searchValue = operationPersonnelTaskSearchValue({
    batchCodeColumnVisible,
    batchNameColumnVisible,
  }, batchCode, batchName);
  const reuseExistingFilter = operationPersonnelTaskListCanReuseFilter(
    await search.inputValue(),
    searchValue,
    previousResultSummary,
  );
  let filteredListState;
  if (reuseExistingFilter) {
    try {
      filteredListState = await waitForVisiblePersonnelTaskListFilter(page, {
        batchCode,
        batchName,
        previousSummary: previousResultSummary,
        requiredSummary: previousResultSummary,
        maxChecks: 16,
      });
    } catch {
      filteredListState = undefined;
    }
  }
  if (!filteredListState) {
    const filterBaseline = reuseExistingFilter
      ? await readVisiblePersonnelTaskResultSummary(page)
      : previousResultSummary;
    await submitVisiblePersonnelTaskFilter(search, searchValue);
    try {
      await page.getByText(searchValue, { exact: true }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });
    } catch (cause) {
      const error = new Error(`运控批次 ${batchCode}/${batchName} 尚未生成人员任务单`);
      error.code = "PERSONNEL_TASK_SHEET_NOT_READY";
      error.status = 409;
      error.cause = cause;
      throw error;
    }
    try {
      filteredListState = await waitForVisiblePersonnelTaskListFilter(page, {
        batchCode,
        batchName,
        previousSummary: filterBaseline,
        requiredSummary: "找到 1 条结果",
      });
    } catch (cause) {
      const error = new Error(
        `运控任务查询结果未在 10 秒内稳定：${batchCode}/${batchName}；${text(cause?.message)}`,
      );
      error.code = "PERSONNEL_TASK_LIST_FILTER_TIMEOUT";
      error.status = 409;
      error.cause = cause;
      throw error;
    }
  }
  const filteredPageCount = operationPersonnelTaskListPageCount(
    filteredListState.summary,
    filteredListState.pageSize,
  );

  const currentPage = async () => {
    const raw = await page.evaluate(() => {
      const visible = (element) => Boolean(
        element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length)
      );
      const paginations = [...document.querySelectorAll(".ant-pagination")].filter(visible);
      const active = paginations.length === 1
        ? [...paginations[0].querySelectorAll(".ant-pagination-item-active")].filter(visible)
        : [];
      return {
        paginationCount: paginations.length,
        activeCount: active.length,
        value: active[0]?.getAttribute("title") || active[0]?.textContent || "",
      };
    });
    return operationPersonnelCurrentPageFromVisibleRaw(raw);
  };
  const currentRowsSignature = async () => {
    const tables = page.locator("table:visible");
    for (let index = 0; index < await tables.count(); index += 1) {
      const table = tables.nth(index);
      const headers = (await table.locator("thead th").allInnerTexts()).map(text);
      if (!headers.includes("批次名称")) continue;
      const rows = table.locator("tbody tr");
      const values = [];
      for (let rowIndex = 0; rowIndex < await rows.count(); rowIndex += 1) {
        values.push((await rows.nth(rowIndex).locator("td").allInnerTexts()).map(text));
      }
      return JSON.stringify(values);
    }
    throw operationControlError("分散在线监考任务主表", 0);
  };
  const waitForPageRows = async (pageNumber, previousRows) => {
    if (typeof page.waitForFunction !== "function") return;
    try {
      await page.waitForFunction(
        ({ pageNumber: expectedPage, previousRows: previous }) => {
          const active = document.querySelector(".ant-pagination-item-active");
          const current = Number(active?.getAttribute("title") || active?.textContent);
          if (current !== expectedPage) return false;
          const visible = (element) => Boolean(
            element.offsetWidth || element.offsetHeight || element.getClientRects().length
          );
          const table = [...document.querySelectorAll("table")].find((candidate) => (
            visible(candidate)
            && [...candidate.querySelectorAll("thead th")]
              .some((header) => header.textContent?.trim() === "批次名称")
          ));
          if (!table) return false;
          const rows = [...table.querySelectorAll("tbody tr")].map((row) => (
            [...row.querySelectorAll("td")].map((cell) => (
              (cell.textContent || "").trim().replace(/\s+/g, " ")
            ))
          ));
          return rows.length > 0 && JSON.stringify(rows) !== previous;
        },
        { pageNumber, previousRows },
        { timeout: 10_000 },
      );
    } catch (cause) {
      const error = new Error(`分散在线监考任务列表未稳定到第 ${pageNumber} 页`);
      error.cause = cause;
      throw error;
    }
  };
  const nextPage = async () => {
    if (await currentPage() >= filteredPageCount) return false;
    const action = await page.evaluate(() => {
      const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
      const visible = (element) => Boolean(
        element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length)
      );
      const paginations = [...document.querySelectorAll(".ant-pagination")].filter(visible);
      if (paginations.length === 0) return { state: "end", paginationCount: 0 };
      if (paginations.length !== 1) {
        return { state: "invalid", paginationCount: paginations.length };
      }
      const pagination = paginations[0];
      const next = [...pagination.querySelectorAll(".ant-pagination-next")].filter(visible);
      if (next.length !== 1) {
        return { state: "invalid", paginationCount: 1, nextCount: next.length };
      }
      const control = next[0];
      if (control.classList.contains("ant-pagination-disabled")
        || control.getAttribute("aria-disabled") === "true") {
        return { state: "end", paginationCount: 1, nextCount: 1 };
      }
      const active = [...pagination.querySelectorAll(".ant-pagination-item-active")].filter(visible);
      const before = Number(active[0]?.getAttribute("title") || active[0]?.textContent);
      if (active.length !== 1 || !Number.isInteger(before) || before < 1) {
        return {
          state: "invalid",
          paginationCount: 1,
          nextCount: 1,
          activeCount: active.length,
          activeValue: Number.isFinite(before) ? String(before) : "",
        };
      }
      const tables = [...document.querySelectorAll("table")].filter((table) => (
        visible(table)
        && [...table.querySelectorAll("thead th")]
          .some((header) => clean(header.textContent) === "批次名称")
      ));
      if (tables.length !== 1) {
        return {
          state: "invalid",
          paginationCount: 1,
          nextCount: 1,
          activeCount: 1,
          before,
          tableCount: tables.length,
        };
      }
      const rows = [...tables[0].querySelectorAll("tbody tr")].map((row) => (
        [...row.querySelectorAll("td")].map((cell) => clean(cell.textContent))
      ));
      const clickable = [...control.querySelectorAll("button, a")].filter(visible);
      if (clickable.length !== 1) {
        return {
          state: "invalid",
          paginationCount: 1,
          nextCount: 1,
          activeCount: 1,
          before,
          tableCount: 1,
          clickableCount: clickable.length,
        };
      }
      clickable[0].click();
      return {
        state: "clicked",
        paginationCount: 1,
        nextCount: 1,
        activeCount: 1,
        tableCount: 1,
        clickableCount: 1,
        before,
        previousRows: JSON.stringify(rows),
      };
    });
    if (action.state === "end") return false;
    if (action.paginationCount !== 1) {
      throw operationControlError("分散在线监考任务分页", action.paginationCount);
    }
    if (action.nextCount !== 1) {
      throw operationControlError("分散在线监考任务下一页", action.nextCount);
    }
    if (action.activeCount !== 1 || !action.activeValue && !action.before) {
      throw operationControlError("分散在线监考任务当前页", action.activeCount);
    }
    if (action.tableCount !== 1) {
      throw operationControlError("分散在线监考任务主表", action.tableCount);
    }
    if (action.clickableCount !== 1) {
      throw operationControlError("分散在线监考任务下一页按钮", action.clickableCount);
    }
    await waitForPageRows(action.before + 1, action.previousRows);
    return true;
  };
  const readPage = async () => {
    const tables = page.locator("table:visible");
    const matches = [];
    for (let index = 0; index < await tables.count(); index += 1) {
      const table = tables.nth(index);
      const headers = (await table.locator("thead th").allInnerTexts()).map(text);
      if (headers.includes("批次名称")) {
        matches.push({ table, headers });
      }
    }
    if (matches.length !== 1) {
      throw operationControlError("分散在线监考任务主表", matches.length);
    }
    const { table, headers } = matches[0];
    const batchCodeIndex = headers.indexOf("批次代码");
    const batchNameIndex = headers.indexOf("批次名称");
    const rows = table.locator("tbody tr");
    const exact = [];
    for (let index = 0; index < await rows.count(); index += 1) {
      const cells = (await rows.nth(index).locator("td").allInnerTexts()).map(text);
      if (cells[batchNameIndex] === batchName
        && (batchCodeIndex < 0 || cells[batchCodeIndex] === batchCode)) {
        exact.push({ pageNumber: await currentPage(), rowIndex: index });
      }
    }
    return exact;
  };

  const exactRows = [];
  do {
    exactRows.push(...await readPage());
  } while (await nextPage());
  if (exactRows.length !== 1) {
    throw new Error(`运控批次 ${batchCode}/${batchName} 精确匹配到 ${exactRows.length} 行`);
  }
  const selected = exactRows[0];
  if (await currentPage() > selected.pageNumber) {
    const previousRows = await currentRowsSignature();
    await search.fill(searchValue);
    await search.press("Enter");
    await waitForPageRows(1, previousRows);
    if (await currentPage() !== 1) {
      throw new Error(`运控任务查询后未返回第 1 页，无法重新定位 ${batchCode}/${batchName}`);
    }
  }
  while (await currentPage() < selected.pageNumber) {
    if (!await nextPage()) {
      throw new Error(`未能返回运控批次 ${batchCode}/${batchName} 所在第 ${selected.pageNumber} 页`);
    }
  }
  const finalRows = await readPage();
  if (finalRows.length !== 1) {
    throw new Error(
      `打开任务单前，运控批次 ${batchCode}/${batchName} 精确匹配到 ${finalRows.length} 行`,
    );
  }
  const action = page.locator(".ant-table-fixed-right table:visible tbody tr")
    .nth(finalRows[0].rowIndex)
    .getByText("发送任务单", { exact: true });
  await clickUniqueVisible(action, "分散在线监考发送任务单入口");
  const taskSheet = page.locator(".ant-modal:visible").filter({
    hasText: "任务单发送需满足以下条件",
  });
  await taskSheet.first().waitFor({
    state: "visible",
    timeout: 10_000,
  });
  if (await taskSheet.count() !== 1) {
    throw operationControlError("分散在线监考任务单弹窗", await taskSheet.count());
  }
}

export async function readVisiblePersonnelTaskSheet(page) {
  const dialogs = page.locator(".ant-modal:visible").filter({
    hasText: "任务单发送需满足以下条件",
  });
  const dialogCount = await dialogs.count();
  if (dialogCount !== 1) {
    throw operationControlError("分散在线监考任务单弹窗", dialogCount);
  }
  if (typeof page.waitForFunction === "function") {
    try {
      await page.waitForFunction(() => {
        const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
        const visible = (node) => Boolean(
          node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        );
        const modal = [...document.querySelectorAll(".ant-modal")].find((node) => (
          visible(node)
          && clean(node.innerText).includes("任务单发送需满足以下条件")
        ));
        if (!modal) return false;
        const rowValue = (label) => {
          for (const row of modal.querySelectorAll(".order-item, .m_bottom.ant-row")) {
            if (!visible(row)) continue;
            const title = row.querySelector(":scope > .order-title-1");
            if (clean(title?.textContent).replace(/[：:]\s*$/, "") !== label) continue;
            const value = [...row.children]
              .filter((node) => node !== title)
              .map((node) => clean(node.textContent))
              .find(Boolean);
            return value || "";
          }
          return "";
        };
        const schedule = [...modal.querySelectorAll("table")].find((table) => {
          const headers = [...table.querySelectorAll("thead th")].map((cell) => clean(cell.textContent));
          return visible(table)
            && headers.includes("日程代码")
            && (headers.includes("考试名称") || headers.includes("科目名称"));
        });
        const scheduleRows = schedule
          ? [...schedule.querySelectorAll("tbody tr")].filter(visible)
          : [];
        return Boolean(
          rowValue("批次名称")
          && rowValue("批次名称") !== "—"
          && scheduleRows.length > 0,
        );
      }, undefined, { timeout: 30_000 });
    } catch (cause) {
      const error = new Error("分散在线监考任务单基本信息和考试日程未在 30 秒内稳定");
      error.cause = cause;
      throw error;
    }
  }
  const raw = await page.evaluate(() => {
    const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
    const visible = (node) => Boolean(
      node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    );
    const modals = [...document.querySelectorAll(".ant-modal")].filter((node) => (
      visible(node)
      && clean(node.innerText).includes("任务单发送需满足以下条件")
    ));
    const modal = modals[0];
    const tables = [...modal.querySelectorAll("table")].filter(visible);
    const cells = (row) => [...row.querySelectorAll("th, td")].map((cell) => clean(cell.textContent));
    const tableRows = (table) => [...table.querySelectorAll("tr")].filter(visible).map(cells);
    const sendTable = tables.find((table) => {
      const first = tableRows(table)[0] || [];
      return first[0] === "发送时间" && first[1] === "变更内容";
    });
    const scheduleTable = tables.find((table) => {
      const headers = [...table.querySelectorAll("thead th")].map((cell) => clean(cell.textContent));
      return headers.includes("日程代码")
        && headers.includes("日程")
        && (headers.includes("考试名称") || headers.includes("科目名称"));
    });
    const tableKeyValueRows = tables
      .filter((table) => table !== sendTable && table !== scheduleTable)
      .flatMap(tableRows)
      .filter((row) => row.length === 2);
    const layoutKeyValueRows = [...modal.querySelectorAll(".order-item, .m_bottom.ant-row")]
      .filter(visible)
      .flatMap((row) => {
        const title = row.querySelector(":scope > .order-title-1");
        const label = clean(title?.textContent).replace(/[：:]\s*$/, "");
        if (!label) return [];
        const value = [...row.children]
          .filter((node) => node !== title)
          .map((node) => clean(node.textContent))
          .find(Boolean) || "";
        return [[label, value]];
      });
    const keyValueRows = layoutKeyValueRows.length
      ? layoutKeyValueRows
      : tableKeyValueRows;
    const scheduleHeaders = scheduleTable
      ? [...scheduleTable.querySelectorAll("thead th")].map((cell) => clean(cell.textContent))
      : [];
    const scheduleRows = scheduleTable
      ? [...scheduleTable.querySelectorAll("tbody tr")].filter(visible).map(cells)
      : [];
    const timelineSendTexts = [...document.querySelectorAll(".ant-timeline-item-content")]
      .filter(visible)
      .map((node) => clean(node.textContent));
    const sendRecordRows = sendTable ? tableRows(sendTable) : null;
    const modalText = String(modal.innerText ?? "");
    const conditions = [...modalText.matchAll(
      /\d+、\s*(.*?)(?=\s*\d+、|基本信息)/gs,
    )].map((match) => clean(match[1])).filter(Boolean);
    return {
      conditions,
      keyValueRows,
      scheduleHeaders,
      scheduleRows,
      sendRecordRows,
      timelineSendTexts,
      content: JSON.stringify({
        conditions,
        keyValueRows,
        scheduleHeaders,
        scheduleRows,
      }),
    };
  });
  const timelineSendRecordRows = [
    ["发送时间", "变更内容"],
    ...(raw.timelineSendTexts || []).flatMap((value) => {
      const record = operationPersonnelTimelineSendRecordFromVisibleText(value);
      return record ? [[record.sentAt, record.type]] : [];
    }),
  ];
  const sendRecordRows = timelineSendRecordRows.length > 1
    ? timelineSendRecordRows
    : raw.sendRecordRows || timelineSendRecordRows;
  return operationPersonnelTaskSheetFromVisibleRaw({ ...raw, sendRecordRows });
}

async function readVisibleOperationPersonnelSnapshot(page) {
  if (typeof page.evaluate !== "function") return {};
  if (typeof page.waitForFunction === "function") {
    try {
      await page.waitForFunction(() => {
        const clean = (value) => String(value ?? "").trim();
        const visible = (node) => Boolean(
          node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        );
        const titles = [...document.querySelectorAll(".header-title")].filter(visible);
        if (titles.length !== 1) return false;
        const headerRoot = titles[0].parentElement?.parentElement;
        const statusNodes = headerRoot
          ? [...headerRoot.querySelectorAll(".right p")].filter(
            (node) => visible(node) && clean(node.textContent).startsWith("批次状态"),
          )
          : [];
        if (statusNodes.length !== 1) return false;
        const publicationTags = [...statusNodes[0].querySelectorAll(".ant-tag")]
          .map((node) => clean(node.textContent))
          .filter((value) => ["已发布", "撤销发布", "未发布"].includes(value));
        return publicationTags.length === 1;
      }, undefined, { timeout: 10_000 });
    } catch (cause) {
      const error = new Error("批次详情发布状态未在 10 秒内稳定");
      error.cause = cause;
      throw error;
    }
  }
  const snapshot = await page.evaluate(() => {
    const clean = (value) => String(value ?? "").trim();
    const visible = (node) => Boolean(node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length));
    const field = (label) => {
      const labels = [...document.querySelectorAll("label, .ant-form-item-label")];
      const node = labels.find((item) => visible(item) && clean(item.textContent).replace(/[：:]\s*$/, "") === label);
      const container = node?.closest(".ant-form-item") || node?.parentElement;
      const control = container?.querySelector("input, textarea, .ant-select-selection-selected-value, .ant-select-selection-item");
      return {
        present: Boolean(node && control && visible(control)),
        value: clean(control?.value ?? control?.textContent ?? ""),
      };
    };
    const table = (requiredHeaders) => {
      for (const node of document.querySelectorAll("table")) {
        if (!visible(node)) continue;
        const headers = [...node.querySelectorAll("thead th")].map((item) => clean(item.textContent));
        if (!requiredHeaders.every((header) => headers.includes(header))) continue;
        return {
          present: true,
          rows: [...node.querySelectorAll("tbody tr")].map((row) => ({
            ...Object.fromEntries(
              [...row.querySelectorAll("td")].map((cell, index) => [headers[index], clean(cell.textContent)]),
            ),
            __scheduleEntryId: clean(row.getAttribute("data-schedule-entry-id")),
          })),
        };
      }
      return { present: false, rows: [] };
    };
    const labels = {
      batch: ["批次代码", "项目编码", "项目名称", "批次名称", "项目部归属", "项目经理", "系统类型", "发布状态"],
      personnel: ["人员服务类型", "人员落实平台", "监考登录监控", "监考比例", "监考人数计算基数", "监考人数", "最早登录系统时间", "试考监考"],
      dates: ["人员落实开始日期", "人员落实结束日期", "人员名单提交日期"],
      taskSheet: ["任务单类型", "任务单内容"],
    };
    const fields = Object.fromEntries(
      Object.values(labels).flat().map((label) => [label, field(label)]),
    );
    const evidenceForFields = (section) => {
      const missing = labels[section].filter((label) => !fields[label].present);
      return { present: missing.length === 0, missing };
    };
    const currentScheduleTable = table(["日程代码", "日程"]);
    const scheduleTable = currentScheduleTable.present
      ? currentScheduleTable
      : table(["日程代码", "开始时间", "结束时间"]);
    const requirementTable = table(["考务需求"]);
    const conditionTable = table(["发送条件"]);
    const sendRecordTable = table(["发送类型", "发送时间"]);
    const requirements = requirementTable.rows.map((row) => ({
      name: row["考务需求"],
      value: row["需求内容"] || row["配置"],
    }));
    const sendRecords = sendRecordTable.rows.map((row) => ({
      type: row["发送类型"],
      sentAt: row["发送时间"],
    }));
    const groupNodes = [...document.querySelectorAll("[data-directory-group]")].filter(visible);
    const groups = groupNodes.map((group) => ({
      name: clean(group.getAttribute("data-directory-group")),
      people: [...group.querySelectorAll("[data-person-id]")].filter(visible).map((person) => ({
        id: clean(person.getAttribute("data-person-id")),
        name: clean(person.getAttribute("data-person-name") || person.textContent),
      })),
    }));
    const currentTitles = [...document.querySelectorAll(".header-title")].filter(visible);
    const currentTitle = currentTitles.length === 1 ? currentTitles[0] : null;
    const currentHeaderInfos = [...document.querySelectorAll(".header-info")].filter(visible);
    const currentHeaderInfo = currentHeaderInfos.length === 1 ? currentHeaderInfos[0] : null;
    const projectLinks = currentHeaderInfo
      ? [...currentHeaderInfo.querySelectorAll(".hover-link")].filter(visible)
      : [];
    const currentHeaderRoot = currentTitle?.parentElement?.parentElement;
    const statusNodes = currentHeaderRoot
      ? [...currentHeaderRoot.querySelectorAll(".right p")].filter(
        (node) => visible(node) && clean(node.textContent).startsWith("批次状态"),
      )
      : [];
    const systemTypeNodes = [...document.querySelectorAll(".basic-item")].filter((node) => {
      const label = node.querySelector(".basic-title-1");
      return visible(node) && clean(label?.textContent).replace(/[：:]\s*$/, "") === "系统类型";
    });
    const currentBatchRaw = {
      titleCount: currentTitles.length,
      code: clean(currentTitle?.querySelector(":scope > span")?.textContent),
      batchName: clean(currentTitle?.querySelector(":scope > label")?.textContent),
      projectLinkCount: projectLinks.length,
      projectCode: clean(projectLinks[0]?.textContent),
      projectName: clean(projectLinks[1]?.textContent),
      headerInfoCount: currentHeaderInfos.length,
      headerInfoText: clean(currentHeaderInfo?.textContent),
      statusCount: statusNodes.length,
      statusTags: statusNodes.length === 1
        ? [...statusNodes[0].querySelectorAll(".ant-tag")].map((node) => clean(node.textContent))
        : [],
      systemTypeCount: systemTypeNodes.length,
      systemType: systemTypeNodes.length === 1
        ? clean(systemTypeNodes[0].querySelector("label")?.textContent)
        : "",
    };
    return {
      __currentBatchRaw: currentBatchRaw,
      batch: {
        code: fields["批次代码"].value,
        projectCode: fields["项目编码"].value,
        projectName: fields["项目名称"].value,
        batchName: fields["批次名称"].value,
        projectDepartment: fields["项目部归属"].value,
        projectManager: fields["项目经理"].value,
        systemType: fields["系统类型"].value,
        published: fields["发布状态"].value === "已发布",
      },
      schedules: [],
      __scheduleRows: scheduleTable.rows,
      personnel: {
        serviceType: fields["人员服务类型"].value,
        platform: fields["人员落实平台"].value,
        loginMonitoring: fields["监考登录监控"].value,
        monitorRatio: fields["监考比例"].value,
        candidateBasis: fields["监考人数计算基数"].value,
        monitorCount: fields["监考人数"].value,
        earliestLoginMinutes: fields["最早登录系统时间"].value,
        trialIncluded: fields["试考监考"].value === "是",
      },
      dates: {
        start: fields["人员落实开始日期"].value,
        end: fields["人员落实结束日期"].value,
        nameListDue: fields["人员名单提交日期"].value,
      },
      requirements,
      taskSheet: {
        type: fields["任务单类型"].value,
        conditions: conditionTable.rows.map((row) => ({
          name: row["发送条件"],
          satisfied: ["已满足", "已完成", "通过", "是"].includes(
            row["状态"] || row["是否满足"] || row["结果"],
          ),
        })),
        content: fields["任务单内容"].value,
      },
      sendRecords,
      directoryGroups: groups,
      evidence: {
        batch: evidenceForFields("batch"),
        schedules: {
          present: scheduleTable.present,
          missing: scheduleTable.present ? [] : ["考试日程表"],
        },
        personnel: evidenceForFields("personnel"),
        dates: evidenceForFields("dates"),
        requirements: {
          present: requirementTable.present,
          missing: requirementTable.present ? [] : ["考务需求表"],
        },
        taskSheet: {
          present: evidenceForFields("taskSheet").present && conditionTable.present,
          missing: [
            ...evidenceForFields("taskSheet").missing,
            ...(conditionTable.present ? [] : ["分散在线监考任务单"]),
          ],
        },
        sendRecords: {
          present: sendRecordTable.present,
          missing: sendRecordTable.present ? [] : ["发送记录表"],
        },
        directoryGroups: {
          present: groupNodes.length > 0,
          missing: groupNodes.length > 0 ? [] : ["人员目录"],
        },
      },
    };
  });
  snapshot.schedules = operationPersonnelBatchSchedulesFromVisibleRows(
    snapshot.__scheduleRows,
  );
  delete snapshot.__scheduleRows;
  if (Object.values(snapshot.__currentBatchRaw || {}).some((value) => (
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  ))) {
    const current = operationPersonnelBatchIdentityFromVisibleRaw(snapshot.__currentBatchRaw);
    snapshot.batch = current.batch;
    snapshot.evidence.batch = current.evidence;
  }
  delete snapshot.__currentBatchRaw;
  return snapshot;
}

function assertVisibleSection(snapshot, key) {
  const evidence = snapshot?.evidence?.[key];
  if (evidence?.present === true) return;
  const missing = (evidence?.missing || [key]).map(text).filter(Boolean).join("、");
  const error = new Error(`运控人员任务检查阻断：无法确认可见页面中的${missing}`);
  error.code = "OPERATION_PERSONNEL_INSPECTION_BLOCKED";
  error.status = 409;
  throw error;
}

async function locateOperationPersonnelBatch(page, instruction = {}, options = {}) {
  const batchCode = text(instruction.batch?.code || instruction.batchCode);
  if (!batchCode) throw new Error("缺少运控批次代码");
  if (options.batchDetailLocated === true) return { batchCode, reused: true };
  const baseUrl = operationConsoleBaseUrl(options);
  const batchListUrl = `${baseUrl.replace(/\/$/, "")}/batch/batchList`;
  const batchPages = await (
    options.readBatchPages
    || ((actualPage) => readOperationPersonnelBatchPages(actualPage, batchListUrl, batchCode, options))
  )(page, instruction);
  const selectedRow = exactBatchRow(batchPages, batchCode);
  await (options.openBatchRow || openOperationPersonnelBatchRow)(page, selectedRow, {
    batchListUrl,
    batchCode,
    batchPages,
    options,
  });
  return { batchCode, reused: false };
}

export async function inspectOperationPersonnelTask(page, instruction = {}, options = {}) {
  const { batchCode } = await locateOperationPersonnelBatch(page, instruction, options);

  let visibleSnapshot;
  const visible = async () => {
    visibleSnapshot ||= await (
      options.readVisibleSnapshot || readVisibleOperationPersonnelSnapshot
    )(page, instruction);
    return visibleSnapshot;
  };
  const read = async (optionName, key, fallback) => {
    if (typeof options[optionName] === "function") {
      return options[optionName](page, instruction);
    }
    const snapshot = await visible();
    assertVisibleSection(snapshot, key);
    return snapshot[key] ?? fallback;
  };
  const batch = await read("readBatch", "batch", {});
  verifyBatchDetailIdentity(
    { ...(instruction.batch || {}), code: batchCode },
    batch,
  );
  const setupPreview = async (restoreBatchDetail = false) => {
    if (restoreBatchDetail) {
      await locateOperationPersonnelBatch(page, instruction, options);
    }
    await (options.openEztestSchedulePage || openVisibleEztestSchedulePage)(page);
    visibleSnapshot = undefined;
    const schedules = await read("readSchedules", "schedules", []);
    return normalizeOperationPersonnelSnapshot({
      batch,
      schedules,
      personnel: {},
      dates: {},
      requirements: [],
      taskSheet: {},
      sendRecords: [],
      directoryMatch: { to: [], cc: [] },
    });
  };
  if (instruction.skipTaskSheet === true) return setupPreview();
  if (instruction.allowUnpublishedPreview === true && batch.published !== true) {
    return setupPreview();
  }
  const legacySectionReaders = [
    "readSchedules",
    "readPersonnel",
    "readDates",
    "readRequirements",
    "readTaskSheet",
    "readSendRecords",
  ].some((name) => typeof options[name] === "function")
    || typeof options.readVisibleSnapshot === "function";
  if (!legacySectionReaders) {
    try {
      await (
        options.openPersonnelTaskSheet
        || ((actualPage, actualInstruction) => (
          openVisibleBatchPersonnelTaskSheet(actualPage, actualInstruction)
        ))
      )(page, instruction);
    } catch (error) {
      const taskSheetUnavailable = error?.code === "PERSONNEL_TASK_SHEET_NOT_READY"
        || error?.reasonCode === "PERSONNEL_CONFIGURATION_INCOMPLETE";
      if (instruction.allowUnpublishedPreview === true && taskSheetUnavailable) {
        return setupPreview(Boolean(options.openPersonnelTaskSheet));
      }
      throw error;
    }
    const taskSnapshot = normalizeOperationPersonnelSnapshot(await (
      options.readPersonnelTaskSheetSnapshot || readVisiblePersonnelTaskSheet
    )(page, instruction));
    const directoryProbeSummary = text(
      instruction.directoryProbeSummary || instruction.changeSummary,
    );
    let matched = { to: [], cc: [] };
    if (directoryProbeSummary) {
      let groups;
      if (options.openPersonnelDirectory || options.readDirectoryGroups) {
        await options.openPersonnelDirectory?.(page, instruction);
        groups = await (
          options.readDirectoryGroups
          || ((actualPage, actualInstruction) => (
            VISIBLE_OPERATION_PERSONNEL_ADAPTER.readDirectoryGroups(
              actualPage,
              actualInstruction,
            )
          ))
        )(page, instruction);
      } else {
        groups = await inspectVisiblePersonnelDirectory(page, instruction);
      }
      matched = matchOperationPersonnelRecipients({ ...instruction, groups });
    }
    return normalizeOperationPersonnelSnapshot({
      ...taskSnapshot,
      batch: {
        ...taskSnapshot.batch,
        ...batch,
        published: taskSnapshot.batch.published === true || batch.published === true,
      },
      directoryMatch: directoryProbeSummary
        ? directoryMatch(operationPersonnelRecipientRule(instruction), matched)
        : { to: [], cc: [] },
    });
  }
  const groups = await read("readDirectoryGroups", "directoryGroups", []);
  const rule = operationPersonnelRecipientRule(instruction);
  const matched = matchOperationPersonnelRecipients({ ...instruction, groups });
  return normalizeOperationPersonnelSnapshot({
    batch,
    schedules: await read("readSchedules", "schedules", []),
    personnel: await read("readPersonnel", "personnel", {}),
    dates: await read("readDates", "dates", {}),
    requirements: await read("readRequirements", "requirements", []),
    taskSheet: await read("readTaskSheet", "taskSheet", {}),
    sendRecords: await read("readSendRecords", "sendRecords", []),
    directoryMatch: directoryMatch(rule, matched),
  });
}

function flatten(value, prefix = "", output = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const key = prefix === "schedules" && item && typeof item === "object"
        ? text(item.scheduleCode)
        : String(index);
      flatten(item, prefix ? `${prefix}.${key}` : key, output);
    });
  } else if (value && typeof value === "object") {
    Object.keys(value).sort().forEach((key) => {
      if (prefix === "schedules" && key === "scheduleCode") return;
      flatten(value[key], prefix ? `${prefix}.${key}` : key, output);
    });
  } else if (prefix) {
    output.set(prefix, value);
  }
  return output;
}

function sameValue(left, right) {
  return Object.is(left, right);
}

function empty(value) {
  return value === undefined || value === null || value === "";
}

const INITIAL_TARGET_ROOTS = new Set(["schedules", "personnel", "dates", "requirements"]);

function pathRoot(fieldPath) {
  return text(fieldPath).split(".")[0];
}

function configured(value) {
  return !empty(value) && value !== false;
}

function membershipMap(root, value = {}) {
  if (root === "schedules") {
    return new Map((value.schedules || []).map((item) => [
      text(numberOrText(item.scheduleCode)),
      item,
    ]));
  }
  return new Map((value.requirements || []).map((item, index) => [String(index), item]));
}

function membershipConflicts(expected, actual, mode) {
  const conflicts = [];
  for (const root of ["schedules", "requirements"]) {
    const expectedItems = membershipMap(root, expected);
    const actualItems = membershipMap(root, actual);
    const keys = mode === "initial"
      ? [...actualItems.keys()].filter((key) => !expectedItems.has(key))
      : [...new Set([...expectedItems.keys(), ...actualItems.keys()])]
        .filter((key) => !expectedItems.has(key) || !actualItems.has(key));
    for (const key of keys) {
      conflicts.push({
        path: `${root}.${key}`,
        expected: expectedItems.get(key) ?? "",
        actual: actualItems.get(key) ?? "",
      });
    }
  }
  return conflicts;
}

export function operationPersonnelConflicts(expected = {}, actual = {}, mode = "initial") {
  if (!["initial", "resend"].includes(mode)) throw new Error(`未知人员任务冲突模式：${mode}`);
  assertScheduleCodes(expected.schedules || []);
  assertScheduleCodes(actual.schedules || []);
  const expectedFields = flatten(expected);
  const actualFields = flatten(actual);
  const memberships = membershipConflicts(expected, actual, mode);
  const membershipPaths = new Set(memberships.map((item) => item.path));
  const hidesMembershipChild = (fieldPath) => [...membershipPaths]
    .some((membershipPath) => fieldPath.startsWith(`${membershipPath}.`));
  const paths = mode === "initial"
    ? [...new Set([
      ...[...expectedFields.keys()].filter((fieldPath) => (
        pathRoot(fieldPath) === "batch" || INITIAL_TARGET_ROOTS.has(pathRoot(fieldPath))
      )),
      ...[...actualFields].filter(([fieldPath, value]) => (
        INITIAL_TARGET_ROOTS.has(pathRoot(fieldPath)) && configured(value)
      )).map(([fieldPath]) => fieldPath),
    ])].filter((fieldPath) => !hidesMembershipChild(fieldPath)).sort()
    : [...new Set([...expectedFields.keys(), ...actualFields.keys()])]
      .filter((fieldPath) => !hidesMembershipChild(fieldPath))
      .sort();
  const fieldConflicts = paths.flatMap((fieldPath) => {
    if (fieldPath === "taskSheet.content") return [];
    const expectedValue = expectedFields.get(fieldPath);
    const actualValue = actualFields.get(fieldPath);
    if (sameValue(expectedValue, actualValue)) return [];
    if (fieldPath === "personnel.candidateBasis" && empty(actualValue)) return [];
    const batchIdentity = fieldPath.startsWith("batch.");
    if (mode === "initial" && !batchIdentity && empty(actualValue)) return [];
    return [{ path: fieldPath, expected: expectedValue ?? "", actual: actualValue ?? "" }];
  });
  return [...memberships, ...fieldConflicts].sort((left, right) => left.path.localeCompare(right.path));
}

export async function runOperationPersonnelInspection(instruction, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const context = options.context || await launchOperationBatchContext(userDataDir, false, options);
  return runWithOperationBatchContext(
    context,
    (page) => inspectOperationPersonnelTask(page, instruction, options),
    { closeContext: !options.context },
  );
}

function previewBrowserStale(cause) {
  const error = new Error("人员任务预览浏览器已失效，请重新预览");
  error.code = "PERSONNEL_PREVIEW_BROWSER_STALE";
  error.status = 409;
  if (cause) error.cause = cause;
  return error;
}

function personnelBatchListUrl(options = {}) {
  return `${operationConsoleBaseUrl(options).replace(/\/$/, "")}/batch/batchList`;
}

export async function operationPersonnelContextPage(context, instruction = {}, options = {}) {
  const pages = typeof context?.pages === "function" ? context.pages() : [];
  const batchListUrl = personnelBatchListUrl(options);
  const expectedDetail = operationBatchDetailIdentity(
    instruction.detailUrl || instruction.batch?.detailUrl,
    batchListUrl,
  );
  if (expectedDetail) {
    const exactDetail = pages.find((page) => {
      const current = operationBatchDetailIdentity(page?.url?.(), batchListUrl);
      return current?.batchGuid === expectedDetail.batchGuid;
    });
    if (exactDetail) return { page: exactDetail, batchDetailLocated: true };
  }
  const expectedOrigin = new URL(batchListUrl).origin;
  const operationPage = pages.find((page) => {
    try {
      return new URL(page?.url?.()).origin === expectedOrigin;
    } catch {
      return false;
    }
  });
  return {
    page: operationPage || pages[0] || await context.newPage(),
    batchDetailLocated: false,
  };
}

async function closeRetainedPreviewTaskSheet(page, instruction, options = {}) {
  if (typeof page?.locator !== "function") return;
  const visibleModals = page.locator(".ant-modal:visible");
  if (typeof visibleModals?.filter !== "function") return;
  const taskSheets = visibleModals.filter({
    hasText: "任务单发送需满足以下条件",
  });
  const count = await taskSheets.count();
  if (count > 1) throw previewBrowserStale(new Error("预览结束时存在多个人员任务单弹窗"));
  if (count === 1) {
    await operationMethod(page, options, "closeTaskSheet")(page, instruction);
  }
}

export async function closeOperationPersonnelBrowserSession(session) {
  if (!session || session.closed) return;
  session.closed = true;
  if (session.ownsContext !== false) await session.context?.close?.();
}

export async function validateOperationPersonnelBrowserSession(
  session,
  instruction = {},
  options = {},
) {
  try {
    if (!session || session.closed || !session.context || !session.page) {
      throw new Error("浏览器上下文不存在或已关闭");
    }
    if (typeof session.page.isClosed === "function" && session.page.isClosed()) {
      throw new Error("批次详情页已关闭");
    }
    if (typeof session.context.pages === "function"
      && !session.context.pages().includes(session.page)) {
      throw new Error("原批次详情页已不在预览浏览器上下文中");
    }
    const current = operationBatchDetailIdentity(
      session.page.url(),
      session.batchListUrl || personnelBatchListUrl(options),
    );
    if (!current || current.batchGuid !== session.batchGuid) {
      throw new Error("批次详情页地址或 batch_guid 已变化");
    }
    const actualBatch = normalizeOperationPersonnelSnapshot({
      batch: await operationMethod(session.page, options, "readBatch")(
        session.page,
        instruction,
      ),
    }).batch;
    verifyBatchDetailIdentity({
      code: session.batchCode,
      batchName: session.batchName,
    }, actualBatch);
    return { detailUrl: current.detailUrl, batchGuid: current.batchGuid, batch: actualBatch };
  } catch (error) {
    if (error?.code === "PERSONNEL_PREVIEW_BROWSER_STALE") throw error;
    throw previewBrowserStale(error);
  }
}

export async function runOperationPersonnelInspectionSession(instruction, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const ownsContext = !options.context;
  const context = options.context || await launchOperationBatchContext(userDataDir, false, options);
  let session;
  try {
    const selected = await operationPersonnelContextPage(context, instruction, options);
    const page = selected.page;
    const snapshot = normalizeOperationPersonnelSnapshot(
      await inspectOperationPersonnelTask(page, instruction, {
        ...options,
        batchDetailLocated: selected.batchDetailLocated,
      }),
    );
    await closeRetainedPreviewTaskSheet(page, instruction, options);
    const batchListUrl = personnelBatchListUrl(options);
    const detail = operationBatchDetailIdentity(page.url(), batchListUrl);
    if (!detail) throw previewBrowserStale(new Error("预览结束时不在已验证批次详情页"));
    session = {
      context,
      page,
      batchListUrl,
      batchGuid: detail.batchGuid,
      detailUrl: detail.detailUrl,
      batchCode: text(snapshot.batch.code || instruction.batch?.code || instruction.batchCode),
      batchName: text(snapshot.batch.batchName || instruction.batch?.batchName),
      ownsContext,
      closed: false,
    };
    await validateOperationPersonnelBrowserSession(session, instruction, options);
    return { snapshot, browserSession: session };
  } catch (error) {
    await closeOperationPersonnelBrowserSession(session || { context, ownsContext }).catch(() => {});
    throw error;
  }
}

export async function runOperationPersonnelInspectionInSession(
  browserSession,
  instruction,
  options = {},
) {
  await validateOperationPersonnelBrowserSession(browserSession, instruction, options);
  const snapshot = await inspectOperationPersonnelTask(
    browserSession.page,
    instruction,
    { ...options, batchDetailLocated: true },
  );
  await closeRetainedPreviewTaskSheet(browserSession.page, instruction, options);
  return snapshot;
}

function operationControlError(label, count) {
  const error = new Error(`运控可见页面控件“${label}”必须精确匹配 1 个，实际 ${count} 个`);
  error.code = "PERSONNEL_OPERATION_CONTROL_AMBIGUOUS";
  error.status = 409;
  return error;
}

async function uniqueVisibleControl(locator, label) {
  const count = typeof locator?.count === "function" ? await locator.count() : 0;
  if (count !== 1) throw operationControlError(label, count);
  return locator;
}

async function clickUniqueVisible(locator, label) {
  const control = await uniqueVisibleControl(locator, label);
  await control.click();
  return control;
}

async function topVisibleDialog(page, label) {
  const dialogs = typeof page?.getByRole === "function"
    ? page.getByRole("dialog")
    : null;
  const count = typeof dialogs?.count === "function" ? await dialogs.count() : 0;
  if (count < 1) throw operationControlError(label, count);
  return dialogs.last();
}

async function uniqueVisibleModalWithText(page, value, label) {
  const visibleModals = page.locator(".ant-modal:visible");
  if (typeof visibleModals?.filter !== "function") {
    return topVisibleDialog(page, label);
  }
  const modals = visibleModals.filter({ hasText: value });
  if (await modals.count() === 0) {
    await modals.first().waitFor({ state: "visible", timeout: 10_000 });
  }
  return uniqueVisibleControl(modals, label);
}

async function visiblePersonnelMailDialog(page) {
  const visibleModals = page.locator(".ant-modal:visible");
  if (typeof visibleModals?.filter !== "function") {
    return topVisibleDialog(page, "邮件发送弹窗");
  }
  for (const title of ["填写收件人邮箱", "邮件发送"]) {
    const modal = visibleModals.filter({ hasText: title });
    if (await modal.count() === 1) return modal;
  }
  const modal = visibleModals.filter({ hasText: /填写收件人邮箱|邮件发送/ });
  if (await modal.count() === 0) {
    await modal.first().waitFor({ state: "visible", timeout: 10_000 });
  }
  return uniqueVisibleControl(modal, "邮件发送弹窗");
}

async function clickUniqueNamedButton(container, names, label) {
  const button = await uniqueNamedButton(container, names, label);
  await button.click();
}

async function uniqueNamedButton(container, names, label) {
  const matches = [];
  for (const name of names) {
    const button = container.getByRole("button", { name, exact: true });
    if (await button.count() === 1) matches.push(button);
  }
  if (matches.length !== 1) throw operationControlError(label, matches.length);
  return matches[0];
}

async function exactVisibleRows(page, value) {
  if (typeof page?.locator !== "function") return [];
  const rows = page.locator("table:visible tbody tr");
  const count = await rows.count();
  const exact = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const cells = (await row.locator("td").allInnerTexts()).map(text);
    if (cells.includes(text(value))) exact.push(row);
  }
  return exact;
}

async function exactScheduleRows(page, schedule = {}) {
  const code = text(numberOrText(schedule.scheduleCode));
  const entryId = text(schedule.scheduleEntryId);
  if (!code || !entryId) return [];
  const rows = await exactVisibleRows(page, code);
  const exact = [];
  for (const row of rows) {
    const actualEntryId = text(await row.getAttribute("data-schedule-entry-id"));
    const cells = (await row.locator("td").allInnerTexts()).map(text);
    if (actualEntryId === entryId || cells.includes(entryId)) exact.push(row);
  }
  return exact;
}

async function labeledVisibleControl(page, label, selector) {
  const direct = typeof page?.getByLabel === "function"
    ? page.getByLabel(label, { exact: true })
    : null;
  const directCount = typeof direct?.count === "function" ? await direct.count() : 0;
  if (directCount > 1) throw operationControlError(label, directCount);
  if (directCount === 1) return direct;
  const labels = typeof page?.getByText === "function"
    ? page.getByText(label, { exact: true })
    : null;
  const labelNode = await uniqueVisibleControl(labels, `${label}标签`);
  const item = labelNode.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-form-item ')][1]",
  );
  const itemCount = await item.count();
  if (itemCount > 1) throw operationControlError(`${label}表单项`, itemCount);
  if (itemCount === 1) return uniqueVisibleControl(item.locator(selector), label);
  const row = labelNode.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-row ')][1]",
  );
  if (await row.count() !== 1) throw operationControlError(`${label}表单行`, await row.count());
  return uniqueVisibleControl(row.locator(":scope > .ant-col").nth(1), label);
}

async function fillVisibleField(page, label, value) {
  const control = await labeledVisibleControl(page, label, "input:visible, textarea:visible");
  await control.fill(text(value));
}

async function confirmTopVisibleDialog(page) {
  const dialog = await topVisibleDialog(page, "运控弹窗");
  const button = dialog.getByRole("button", { name: /^确\s*定$/ });
  await clickUniqueVisible(button, "运控弹窗确定按钮");
}

async function readVisibleSection(page, key) {
  const snapshot = await readVisibleOperationPersonnelSnapshot(page);
  assertVisibleSection(snapshot, key);
  return snapshot[key];
}

async function ensureVisiblePersonnelPage(page, instruction = {}) {
  const personnelTab = page.getByRole("tab", { name: "人员", exact: true });
  if (await personnelTab.count() === 0) {
    await personnelTab.waitFor({ state: "visible", timeout: 10_000 });
  }
  const exactPersonnelTab = await uniqueVisibleControl(personnelTab, "批次详情人员页签");
  if (text(await exactPersonnelTab.getAttribute("aria-selected")) !== "true") {
    await exactPersonnelTab.click();
  }
  const onlineTab = page.getByRole("tab", { name: "在线监考", exact: true });
  if (await onlineTab.count() === 0) {
    await onlineTab.waitFor({ state: "visible", timeout: 10_000 });
  }
  const exactOnlineTab = await uniqueVisibleControl(onlineTab, "人员在线监考页签");
  if (text(await exactOnlineTab.getAttribute("aria-selected")) !== "true") {
    await exactOnlineTab.click();
  }
}

export async function openVisibleBatchPersonnelTaskSheet(page, instruction = {}) {
  await ensureVisiblePersonnelPage(page, instruction);
  await waitForVisiblePersonnelConfiguration(page, {
    maxChecks: 51,
    pollMs: 300,
    stableChecks: 1,
    requireRequirements: true,
  });
  const sendButton = page.getByRole("button", { name: "发送任务单", exact: true });
  await clickUniqueVisible(sendButton, "批次详情人员发送任务单按钮");
  if (typeof page.waitForTimeout === "function") await page.waitForTimeout(200);

  const taskSheet = page.locator(".ant-modal:visible").filter({
    hasText: "任务单发送需满足以下条件",
  });
  const taskSheetCount = await taskSheet.count();
  if (taskSheetCount === 1) return taskSheet;
  if (taskSheetCount > 1) {
    return uniqueVisibleControl(taskSheet, "分散在线监考任务单弹窗");
  }

  return uniqueVisibleModalWithText(
    page,
    "任务单发送需满足以下条件",
    "分散在线监考任务单弹窗",
  );
}

async function readVisiblePersonnelPageRaw(page) {
  return page.evaluate(() => ({
    lines: String(document.body?.innerText ?? "")
      .split(/\n+/)
      .map((value) => value.trim().replace(/\s+/g, " "))
      .filter(Boolean),
  }));
}

export async function waitForVisiblePersonnelConfiguration(page, options = {}) {
  const maxChecks = Math.max(1, Number(options.maxChecks || 51));
  const pollMs = Math.max(0, Number(options.pollMs ?? 200));
  const stableChecks = Math.max(1, Number(options.stableChecks || 1));
  const requireRequirements = options.requireRequirements === true;
  let snapshot = operationPersonnelPageFromVisibleRaw({ lines: [] });
  let stableCount = 0;
  let stableValue = "";
  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    snapshot = operationPersonnelPageFromVisibleRaw(
      await readVisiblePersonnelPageRaw(page),
    );
    if (snapshot.evidence.personnel.present
      && snapshot.evidence.dates.present
      && (!requireRequirements || snapshot.evidence.requirements.present)) {
      const currentValue = JSON.stringify([
        snapshot.personnel,
        snapshot.dates,
        ...(requireRequirements ? [snapshot.requirements] : []),
      ]);
      stableCount = currentValue === stableValue ? stableCount + 1 : 1;
      stableValue = currentValue;
      if (stableCount >= stableChecks) return snapshot;
    } else {
      stableCount = 0;
      stableValue = "";
    }
    if (attempt + 1 < maxChecks && pollMs > 0) {
      if (typeof page.waitForTimeout === "function") {
        await page.waitForTimeout(pollMs);
      } else {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
  }
  const missingFields = [...new Set([
    ...(snapshot.evidence.personnel.missing || []),
    ...(snapshot.evidence.dates.missing || []),
    ...(requireRequirements ? snapshot.evidence.requirements.missing || [] : []),
  ])];
  const error = operationConflict(
    `人员配置保存后页面未完整恢复：${missingFields.join("、") || "必填字段"}`,
  );
  error.reasonCode = "PERSONNEL_CONFIGURATION_INCOMPLETE";
  error.missingFields = missingFields;
  throw error;
}

async function readVisiblePersonnelPage(page) {
  return waitForVisiblePersonnelConfiguration(page);
}

async function readVisiblePersonnelPageSection(page, key) {
  const snapshot = await readVisiblePersonnelPage(page);
  assertVisibleSection(snapshot, key);
  return snapshot[key];
}

export async function waitForVisiblePersonnelRequirements(page, target = [], options = {}) {
  const expected = target.map((item) => ({
    name: text(item.name),
    value: text(item.value),
  }));
  const maxChecks = Math.max(1, Number(options.maxChecks || 51));
  const pollMs = Math.max(0, Number(options.pollMs ?? 200));
  let actual = [];
  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    const raw = await page.evaluate(() => ({
      lines: String(document.body?.innerText ?? "")
        .split(/\n+/)
        .map((value) => value.trim().replace(/\s+/g, " "))
        .filter(Boolean),
    }));
    actual = operationPersonnelPageFromVisibleRaw(raw).requirements;
    const actualByName = new Map(actual.map((item) => [text(item.name), text(item.value)]));
    if (expected.every((item) => actualByName.get(item.name) === item.value)) return expected;
    if (attempt + 1 < maxChecks) await page.waitForTimeout(pollMs);
  }
  const actualByName = new Map(actual.map((item) => [text(item.name), text(item.value)]));
  const missing = expected
    .filter((item) => actualByName.get(item.name) !== item.value)
    .map((item) => item.name)
    .join("、");
  throw operationConflict(`考务需求保存后未生效：${missing}`);
}

export async function openVisiblePersonnelSectionEditor(page, label) {
  const personnelPanel = await uniqueVisibleControl(
    page.locator(".supervise:visible"),
    "在线监考人员面板",
  );
  const visibleTitles = personnelPanel
    .getByText(label, { exact: true })
    .filter({ visible: true });
  const title = await uniqueVisibleControl(
    visibleTitles,
    `在线监考${label}标题`,
  );
  let header = title.locator("xpath=ancestor::*[@role='button'][1]");
  if (await header.count() !== 1) {
    header = title.locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-collapse-header ')][1]",
    );
  }
  if (await header.count() !== 1) {
    throw operationControlError(`在线监考${label}区块`, await header.count());
  }
  await clickUniqueVisible(
    header.locator(".anticon-edit:visible"),
    `在线监考${label}编辑按钮`,
  );
}

async function visiblePersonnelConfigDialog(page) {
  const startInput = page.locator('input[placeholder="开始日期"]:visible');
  if (await startInput.count() === 0) {
    await startInput.waitFor({ state: "visible", timeout: 10_000 });
  }
  const dialogs = page.locator(".ant-modal:visible").filter({ has: startInput });
  return uniqueVisibleControl(dialogs, "在线监考配置项弹窗");
}

async function restoreVisiblePersonnelDateGrid(page, value, placeholder) {
  const targetDate = new Date(`${text(value).replaceAll("/", "-")}T00:00:00`);
  if (Number.isNaN(targetDate.getTime())) {
    throw operationConflict(`人员日期 ${text(value) || "空"} 无效，不能打开日期面板`);
  }
  const targetYear = String(targetDate.getFullYear());
  const targetDecade = `${Math.floor(targetDate.getFullYear() / 10) * 10}-${Math.floor(targetDate.getFullYear() / 10) * 10 + 9}`;
  const targetMonth = targetDate.getMonth() + 1;
  const chineseMonth = [
    "", "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月",
  ][targetMonth];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const decadePanels = page.locator(".ant-calendar-decade-panel:visible");
    const yearPanels = page.locator(".ant-calendar-year-panel:visible");
    const monthPanels = page.locator(".ant-calendar-month-panel:visible");
    const panelCount = await decadePanels.count() + await yearPanels.count() + await monthPanels.count();
    if (panelCount === 0) return;
    if (panelCount > 1) {
      throw operationControlError("人员日期年月选择面板", panelCount);
    }
    const panel = (await decadePanels.count() === 1 ? decadePanels
      : await yearPanels.count() === 1 ? yearPanels : monthPanels).first();
    let calendar = panel.locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' ant-calendar-range-part ')][1]",
    );
    if (await calendar.count() === 0) {
      calendar = panel.locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' ant-calendar ')][1]",
      );
    }
    if (await decadePanels.count() === 1) {
      const decade = calendar
        .locator(`.ant-calendar-decade-panel-decade:visible`)
        .filter({ hasText: new RegExp(`^${targetDecade}$`) });
      await clickUniqueVisible(decade, `${targetDecade}年代选项`);
    } else if (await yearPanels.count() === 1) {
      const year = calendar.locator(`.ant-calendar-year-panel-cell[title="${targetYear}"]:visible`);
      await clickUniqueVisible(year, `${targetYear}年份选项`);
    } else {
      const month = calendar
        .locator(".ant-calendar-month-panel-month:visible")
        .filter({ hasText: new RegExp(`^(?:${targetMonth}月|${chineseMonth})$`) });
      await clickUniqueVisible(month, `${targetMonth}月选项`);
    }
    if (typeof page.waitForTimeout === "function") await page.waitForTimeout(100);
  }
  if (text(placeholder)) {
    throw operationConflict(`${text(placeholder)}日期选择器未恢复到日期面板`);
  }
  throw operationConflict("人员日期选择器未恢复到日期面板");
}

async function visiblePersonnelDateCell(
  page,
  value,
  nextMonthAttempts = 0,
  forceTargetMonth = false,
  placeholder = "",
) {
  const selector = `td[title="${operationDateTitle(value)}"]`
    + ":not(.ant-calendar-last-month-cell)"
    + ":not(.ant-calendar-next-month-btn-day)";
  const cell = page.locator(`${selector}:visible`);
  await restoreVisiblePersonnelDateGrid(page, value, placeholder);
  let targetMonthSelected = false;
  if (nextMonthAttempts > 0 && (forceTargetMonth || await cell.count() === 0)) {
    const targetDate = new Date(`${text(value).replaceAll("/", "-")}T00:00:00`);
    const monthSelects = page.locator(".ant-calendar-month-select:visible");
    if (!Number.isNaN(targetDate.getTime()) && await monthSelects.count() > 0) {
      await monthSelects.last().click();
      const monthNumber = targetDate.getMonth() + 1;
      const chineseMonth = [
        "", "一月", "二月", "三月", "四月", "五月", "六月",
        "七月", "八月", "九月", "十月", "十一月", "十二月",
      ][monthNumber];
      const monthOption = page
        .locator(".ant-calendar-month-panel:visible .ant-calendar-month-panel-month")
        .filter({ hasText: new RegExp(`^(?:${monthNumber}月|${chineseMonth})$`) });
      await (await uniqueVisibleControl(
        monthOption,
        `${monthNumber}月选项`,
      )).click();
      targetMonthSelected = true;
      nextMonthAttempts = 0;
    }
  }
  if (await cell.count() > 0) nextMonthAttempts = 0;
  for (let attempt = 0; attempt < nextMonthAttempts; attempt += 1) {
    const nextButtons = page.locator(".ant-calendar-next-month-btn:visible");
    if (await nextButtons.count() > 0) {
      await nextButtons.last().click();
    } else if (typeof page.keyboard?.press === "function") {
      await page.keyboard.press("PageDown");
    } else {
      break;
    }
    if (typeof page.waitForTimeout === "function") await page.waitForTimeout(200);
  }
  if (await cell.count() === 0 && targetMonthSelected) {
    const dayText = String(new Date(`${text(value).replaceAll("/", "-")}T00:00:00`).getDate());
    const rightPanelDay = page
      .locator(
        ".ant-calendar-range-right:visible "
          + "td:not(.ant-calendar-last-month-cell):not(.ant-calendar-next-month-btn-day) "
          + ".ant-calendar-date",
      )
      .filter({ hasText: new RegExp(`^${dayText}$`) });
    if (await rightPanelDay.count() > 0) {
      return uniqueVisibleControl(rightPanelDay, `${text(value)}日期单元格`);
    }
    const activeDay = page
      .locator(
        ".ant-calendar-picker-container:visible "
          + "td:not(.ant-calendar-last-month-cell):not(.ant-calendar-next-month-btn-day) "
          + ".ant-calendar-date",
      )
      .filter({ hasText: new RegExp(`^${dayText}$`) });
    if (await activeDay.count() > 0) {
      return uniqueVisibleControl(activeDay, `${text(value)}日期单元格`);
    }
  }
  if (await cell.count() === 0) {
    await cell.waitFor({ state: "visible", timeout: 10_000 });
  }
  return uniqueVisibleControl(cell, `${text(value)}日期单元格`);
}

export async function selectVisiblePersonnelDate(page, dialog, placeholder, value) {
  const input = await uniqueVisibleControl(
    dialog.locator(`input[placeholder="${placeholder}"]:visible`),
    `${placeholder}输入框`,
  );
  await input.click();
  await (await visiblePersonnelDateCell(page, value, 1, false, placeholder))
    .click({ force: true, timeout: 10_000 });
  const calendars = page.locator(".ant-calendar-picker-container:visible");
  const calendarCount = await calendars.count();
  if (calendarCount > 1) {
    throw operationControlError("人员日期选择浮层", calendarCount);
  }
  if (calendarCount === 1) {
    await page.keyboard.press("Escape");
    await calendars.waitFor({ state: "hidden", timeout: 10_000 });
  }
}

export async function selectVisiblePersonnelDateRange(page, dialog, start, end) {
  const startInput = await uniqueVisibleControl(
    dialog.locator('input[placeholder="开始日期"]:visible'),
    "开始日期输入框",
  );
  await startInput.click();
  const calendars = page.locator(".ant-calendar-picker-container:visible");
  if (await calendars.count() === 0 && typeof calendars.last === "function") {
    await calendars.waitFor({ state: "visible", timeout: 10_000 });
  }
  await (await visiblePersonnelDateCell(page, start, 0, false, "开始日期"))
    .click({ force: true, timeout: 10_000 });
  const startDate = new Date(`${text(start).replaceAll("/", "-")}T00:00:00`);
  const endDate = new Date(`${text(end).replaceAll("/", "-")}T00:00:00`);
  const monthDifference = Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
    ? 1
    : Math.max(
      0,
      (endDate.getFullYear() - startDate.getFullYear()) * 12
        + endDate.getMonth() - startDate.getMonth(),
    );
  await (await visiblePersonnelDateCell(
    page,
    end,
    Math.min(monthDifference, 24),
    true,
    "结束日期",
  )).click({ force: true, timeout: 10_000 });
  if (await calendars.count() > 0) {
    await calendars.waitFor({ state: "hidden", timeout: 10_000 });
  }
}

function normalizedVisibleDateInput(value) {
  const match = text(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return text(value);
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

export async function assertVisiblePersonnelDateInputs(dialog, expected = {}) {
  const controls = [
    ["开始日期", 'input[placeholder="开始日期"]:visible', expected.start],
    ["结束日期", 'input[placeholder="结束日期"]:visible', expected.end],
    ["人员名单提交日期", 'input[placeholder="请选择日期"]:visible', expected.nameListDue],
  ];
  const conflicts = [];
  for (const [label, selector, value] of controls) {
    const input = await uniqueVisibleControl(dialog.locator(selector), `${label}输入框`);
    const actual = normalizedVisibleDateInput(await input.inputValue());
    const target = normalizedVisibleDateInput(value);
    if (actual !== target) conflicts.push(`${label}期望 ${target || "空"}，实际 ${actual || "空"}`);
  }
  if (conflicts.length) {
    throw operationConflict(`人员日期选择结果不一致：${conflicts.join("；")}`);
  }
}

async function chooseVisibleRadio(dialog, name) {
  const values = {
    悦站: "tc_joytest",
    考站服务平台: "tc",
    分散监考: "decentralized",
    集中监考: "centralized",
  };
  const value = values[text(name)];
  const locator = value
    ? dialog.locator(`input[type="radio"][value="${value}"]:visible`)
    : dialog.getByRole("radio", { name: text(name), exact: true });
  const radio = await uniqueVisibleControl(
    locator,
    `${text(name)}单选项`,
  );
  await radio.click({ force: true, timeout: 10_000 });
}

export async function fillVisiblePersonnelConfiguration(
  page,
  dialog,
  personnel = {},
  datesValue = {},
) {
  if (text(personnel.serviceType) !== "ATA 监考－分散在线监考") {
    throw operationConflict("人员服务类型不是 ATA 分散在线监考");
  }
  const dates = normalizeDates(datesValue);
  if (!dates.start || !dates.end || !dates.nameListDue) {
    throw operationConflict("人员配置缺少完整日期");
  }
  await chooseVisibleRadio(dialog, personnel.platform);
  await chooseVisibleRadio(dialog, "分散监考");
  await selectVisiblePersonnelDateRange(page, dialog, dates.start, dates.end);
  await selectVisiblePersonnelDate(page, dialog, "请选择日期", dates.nameListDue);
  await assertVisiblePersonnelDateInputs(dialog, dates);
}

async function confirmVisiblePersonnelConfig(page, dialog) {
  await clickUniqueNamedButton(
    dialog,
    ["确 定", "确定"],
    "在线监考配置项确定按钮",
  );
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  await readVisiblePersonnelPage(page);
}

async function visiblePersonnelRequirementsDrawer(page) {
  const title = page.getByText("在线监考——考务需求", { exact: true });
  if (await title.count() === 0) {
    await title.waitFor({ state: "visible", timeout: 10_000 });
  }
  const drawers = page.locator(".ant-drawer:visible").filter({
    hasText: "在线监考——考务需求",
  });
  return uniqueVisibleControl(drawers, "在线监考考务需求抽屉");
}

async function exactVisibleRequirementRow(drawer, name) {
  const label = drawer.getByText(text(name), { exact: true });
  if (await label.count() === 0) {
    await label.waitFor({ state: "visible", timeout: 10_000 });
  }
  const exact = await uniqueVisibleControl(label, `考务需求 ${text(name)} 名称`);
  return uniqueVisibleControl(
    exact.locator("xpath=ancestor::tr[1]"),
    `考务需求 ${text(name)} 行`,
  );
}

export async function ensureVisiblePersonnelRequirementRows(page, drawer, names = []) {
  const missing = [];
  for (const name of names) {
    const count = await drawer.getByText(text(name), { exact: true }).count();
    if (count > 1) throw operationControlError(`考务需求 ${text(name)} 名称`, count);
    if (count === 0) missing.push(text(name));
  }
  if (!missing.length) return;

  await clickUniqueVisible(
    drawer.getByText("新增考务项", { exact: true }),
    "新增考务项按钮",
  );
  const modals = page.locator(".ant-modal:visible").filter({
    hasText: "自定义选项",
  });
  if (await modals.count() === 0) {
    await modals.first().waitFor({ state: "visible", timeout: 10_000 });
  }
  const modal = await uniqueVisibleControl(modals, "考务项弹窗");
  for (const name of missing) {
    const checkbox = await uniqueVisibleControl(
      modal.getByRole("checkbox", { name, exact: true }),
      `考务项 ${name} 复选框`,
    );
    if (!await checkbox.isChecked()) await checkbox.check();
  }
  await clickUniqueVisible(
    modal.getByRole("button", { name: /^确\s*定$/ }),
    "考务项确定按钮",
  );
  await modal.waitFor({ state: "hidden", timeout: 10_000 });
}

export async function editVisibleSchedule(page, schedule, existing) {
  if (existing) {
    const rows = await exactScheduleRows(page, schedule);
    if (rows.length !== 1) throw scheduleNotUnique(schedule, rows.length);
    await clickUniqueVisible(
      rows[0].getByRole("button", { name: "编辑", exact: true }),
      `日程 ${schedule.scheduleCode} 编辑按钮`,
    );
  } else {
    await clickUniqueVisible(
      page.getByRole("button", { name: "新增考试日程", exact: true }),
      "新增考试日程按钮",
    );
  }
  await fillVisibleField(page, "日程代码", schedule.scheduleCode);
  await fillVisibleField(page, "科目代码", schedule.subjectCode);
  await fillVisibleField(page, "科目名称", schedule.subjectName);
  await fillVisibleField(page, "开始时间", schedule.start);
  await fillVisibleField(page, "结束时间", schedule.end);
  await fillVisibleField(page, "时长", schedule.durationMinutes);
  await fillVisibleField(page, "提前登录分钟数", schedule.earlyLoginMinutes);
  await confirmTopVisibleDialog(page);
}

function personnelMailEntryEmail(entry = {}) {
  return text(entry.label).match(/^([^\s()]+@[^\s()]+)\s*(?:\(|$)/)?.[1]?.toLowerCase() || "";
}

async function clearVisiblePersonnelMailSelections(dialog) {
  const entries = await visibleCheckboxEntries(dialog);
  for (const entry of entries.filter((item) => item.checked && personnelMailEntryEmail(item))) {
    await (await checkboxByLabel(dialog, entry.label, entry.section)).uncheck();
  }
  for (const entry of entries.filter((item) => item.checked && !personnelMailEntryEmail(item))) {
    await (await checkboxByLabel(dialog, entry.label, entry.section)).uncheck();
  }
}

async function ensureVisiblePersonnelMailGroupExpanded(page, dialog, section, directoryGroup) {
  let group = await waitForDirectoryGroupCheckbox(
    page,
    dialog,
    directoryGroup.name,
    section,
  );
  if (!await group.isChecked()) await group.click();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    group = await checkboxByLabel(dialog, directoryGroup.name, section);
    const visibleEmails = new Set((await visibleCheckboxEntries(dialog))
      .filter((entry) => entry.section === section)
      .map(personnelMailEntryEmail)
      .filter(Boolean));
    if (await group.isChecked()
      && directoryGroup.emails.every((email) => visibleEmails.has(email))) return;
    if (typeof page.waitForTimeout === "function") await page.waitForTimeout(100);
  }
  throw operationConflict(`人员目录分组“${directoryGroup.name}”勾选后未显示目标人员`);
}

async function selectVisiblePersonnelMailEmails(
  page,
  dialog,
  section,
  expectedEmails,
  directoryGroups,
) {
  const expected = new Set(expectedEmails);
  if (!expected.size) return;
  const selected = new Set();
  const selectVisible = async (groupEmails) => {
    const pending = new Set(groupEmails);
    const entries = await visibleCheckboxEntries(dialog);
    for (const entry of entries) {
      const email = personnelMailEntryEmail(entry);
      if (entry.section !== section || !pending.has(email) || selected.has(email)) continue;
      const checkbox = await checkboxByLabel(dialog, entry.label, section);
      if (!entry.checked) await checkbox.check();
      selected.add(email);
    }
  };

  for (const directoryGroup of directoryGroups) {
    await ensureVisiblePersonnelMailGroupExpanded(page, dialog, section, directoryGroup);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await selectVisible(directoryGroup.emails);
      if (directoryGroup.emails.every((email) => selected.has(email))) break;
      if (typeof page.waitForTimeout === "function") await page.waitForTimeout(100);
    }
    const missingFromGroup = directoryGroup.emails.filter((email) => !selected.has(email));
    if (missingFromGroup.length) {
      throw operationConflict(
        `人员目录分组“${directoryGroup.name}”未找到：${missingFromGroup.join("、")}`,
      );
    }
  }
  const missing = [...expected].filter((email) => !selected.has(email));
  if (missing.length) {
    throw operationConflict(
      `${section === "cc" ? "抄送" : "收件人"}目录未找到：${missing.join("、")}`,
    );
  }
}

async function selectVisiblePersonnelMailGroups(page, dialog, section, groupNames = []) {
  for (const groupName of [...new Set(groupNames.map(text).filter(Boolean))]) {
    const group = await waitForDirectoryGroupCheckbox(page, dialog, groupName, section);
    if (!await group.isChecked()) await group.check();
  }
}

async function readVisiblePersonnelMailSelection(dialog) {
  const selected = { recipients: [], cc: [], groups: { recipients: [], cc: [] } };
  for (const entry of await visibleCheckboxEntries(dialog)) {
    if (!entry.checked) continue;
    const email = personnelMailEntryEmail(entry);
    if (email) selected[entry.section].push(email);
    else selected.groups[entry.section].push(text(entry.label));
  }
  selected.recipients = [...new Set(selected.recipients)];
  selected.cc = [...new Set(selected.cc)];
  selected.groups.recipients = [...new Set(selected.groups.recipients)];
  selected.groups.cc = [...new Set(selected.groups.cc)];
  return selected;
}

function assertExactPersonnelMailSelection(actual, expected, label) {
  const actualSorted = [...new Set(actual.map(text).filter(Boolean))].sort();
  const expectedSorted = [...new Set(expected.map(text).filter(Boolean))].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw operationConflict(
      `${label}回读不一致：预期 ${expectedSorted.join("、") || "无"}，实际 ${actualSorted.join("、") || "无"}`,
    );
  }
}

export async function selectVisiblePersonnelRecipients(
  page,
  mailDialog,
  recipients,
  rule,
) {
  const target = operationPersonnelMailSelectionTarget(recipients, rule);
  await clearVisiblePersonnelMailSelections(mailDialog);
  await selectVisiblePersonnelMailEmails(
    page,
    mailDialog,
    "recipients",
    target.recipients,
    target.directoryGroups.recipients,
  );
  await selectVisiblePersonnelMailEmails(
    page,
    mailDialog,
    "cc",
    target.cc,
    target.directoryGroups.cc,
  );
  await selectVisiblePersonnelMailGroups(
    page,
    mailDialog,
    "cc",
    target.selectedGroups.cc,
  );
  const selected = await readVisiblePersonnelMailSelection(mailDialog);
  assertExactPersonnelMailSelection(
    selected.recipients,
    target.recipients,
    "人员任务单收件人",
  );
  assertExactPersonnelMailSelection(
    selected.groups.cc,
    target.selectedGroups.cc,
    "人员任务单抄送部门",
  );
  return selected;
}

export async function readVisiblePersonnelMailRecipients(mailDialog, expected, rule = {}) {
  const selected = await readVisiblePersonnelMailSelection(mailDialog);
  const expectedTo = [...(expected.to || [])]
    .filter((item) => text(item?.kind) !== "group");
  const expectedCcPeople = [...(expected.cc || [])]
    .filter((item) => text(item?.kind) !== "group");
  const expectedCcGroups = [...(expected.cc || [])]
    .filter((item) => text(item?.kind) === "group")
    .map((item) => text(item?.name));

  assertExactPersonnelMailSelection(
    selected.recipients,
    expectedTo.map((item) => item.id),
    "人员任务单收件人",
  );
  if (expectedCcGroups.length) {
    assertExactPersonnelMailSelection(
      selected.groups.cc,
      expectedCcGroups,
      "人员任务单抄送部门",
    );
  } else {
    assertExactPersonnelMailSelection(
      selected.cc,
      expectedCcPeople.map((item) => item.id),
      "人员任务单抄送",
    );
  }
  const nameById = new Map(
    [...expectedTo, ...expectedCcPeople].map((item) => [text(item.id).toLowerCase(), text(item.name)]),
  );
  return {
    to: selected.recipients.map((id) => ({ id, name: nameById.get(id) || "" })),
    cc: expectedCcGroups.length
      ? expectedCcGroups.map(groupRecipient)
      : selected.cc.map((id) => ({ id, name: nameById.get(id) || "" })),
  };
}

export async function confirmVisiblePersonnelMailDialog(mailDialog) {
  const button = await uniqueNamedButton(
    mailDialog,
    ["确 定", "确定"],
    "邮件发送最终确定按钮",
  );
  if (typeof mailDialog?.waitFor !== "function") {
    await button.click();
    return;
  }
  const hidden = mailDialog.waitFor({ state: "hidden", timeout: 30_000 });
  await button.click();
  await hidden;
}

async function visibleDirectoryPeople(dialog) {
  const values = await dialog.evaluate((node) => {
    const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
    const visible = (element) => Boolean(
      element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length),
    );
    return [...node.querySelectorAll("*")]
      .filter(visible)
      .filter((element) => element.children.length === 0)
      .map((element) => clean(element.textContent))
      .filter((value) => /^[^\s()]+@[^\s()]+\s+\([^()]+\)$/.test(value));
  });
  return operationPersonnelDirectoryPeopleFromVisibleTexts(values);
}

export async function expandVisibleDirectoryGroup(page, dialog, groupName, section = "") {
  const before = await visibleDirectoryPeople(dialog);
  const contentSection = section === "to" ? "recipients" : section;
  const visibleName = contentSection === "recipients"
    ? projectManagerDirectoryGroup(groupName)
    : text(groupName);
  const group = await waitForDirectoryGroupCheckbox(
    page,
    dialog,
    visibleName,
    contentSection,
  );
  if (!await group.isChecked()) await group.check();
  const after = await visibleDirectoryPeople(dialog);
  const existing = new Set(before.map((person) => `${person.id}\0${person.name}`));
  const added = after.filter((person) => !existing.has(`${person.id}\0${person.name}`));
  const members = added.length ? added : after;
  if (!members.length) {
    throw operationControlError(`人员目录组 ${groupName} 成员`, 0);
  }
  return members;
}

async function closeVisibleMailDialog(page) {
  const mailDialog = await visiblePersonnelMailDialog(page);
  const close = mailDialog.locator(".ant-modal-close:visible");
  const closeCount = await close.count();
  if (closeCount === 1) {
    await close.click();
    return;
  }
  await clickUniqueVisible(
    mailDialog.getByRole("button", { name: "取 消", exact: true }),
    "邮件发送取消按钮",
  );
}

export async function readVisiblePersonnelDirectoryGroups(page, mailDialog, rule) {
  const projectGroup = projectManagerDirectoryGroup(rule.toGroup);
  const groups = [{
    name: projectGroup,
    people: await expandVisibleDirectoryGroup(page, mailDialog, rule.toGroup, "to"),
  }];
  for (const groupName of rule.ccGroups) {
    await waitForDirectoryGroupCheckbox(page, mailDialog, groupName, "cc");
    groups.push({ name: groupName, people: [] });
  }
  return groups;
}

export async function fillVisiblePersonnelTaskChangeSummary(page, value) {
  const changeSummary = text(value);
  if (!changeSummary) {
    const error = new Error("重新发送人员任务单必须填写变更内容");
    error.code = "PERSONNEL_CHANGE_SUMMARY_REQUIRED";
    error.status = 400;
    throw error;
  }
  if (changeSummary.length > 4000) {
    const error = new Error("人员任务单变更内容不能超过 4000 个字符");
    error.code = "PERSONNEL_CHANGE_SUMMARY_TOO_LONG";
    error.status = 400;
    throw error;
  }
  const summary = page.locator(
    'textarea[placeholder="请填写任务单变更内容"]:visible, input[placeholder="请填写任务单变更内容"]:visible',
  );
  try {
    await summary.first().waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const error = new Error("运控未出现人员任务单变更内容输入框，禁止继续发送");
    error.code = "PERSONNEL_CHANGE_SUMMARY_CONTROL_MISSING";
    error.status = 409;
    throw error;
  }
  await uniqueVisibleControl(summary, "任务单变更内容");
  await summary.fill(changeSummary);
  if (text(await summary.inputValue()) !== changeSummary) {
    const error = new Error("人员任务单变更内容回读不一致");
    error.code = "PERSONNEL_CHANGE_SUMMARY_READBACK_MISMATCH";
    error.status = 409;
    throw error;
  }
  const dialog = await uniqueVisibleModalWithText(
    page,
    "填写变更内容",
    "任务单变更内容弹窗",
  );
  await clickUniqueVisible(
    dialog.getByRole("button", { name: "下一步", exact: true }),
    "任务单变更内容下一步按钮",
  );
  return changeSummary;
}

export async function openVisiblePersonnelMailDialog(page, instruction = {}) {
  const taskDialog = await uniqueVisibleModalWithText(
    page,
    "任务单发送需满足以下条件",
    "分散在线监考任务单弹窗",
  );
  await clickUniqueVisible(
    taskDialog.getByRole("button", { name: "发送任务单", exact: true }),
    "任务单内置发送按钮",
  );

  const changeSummary = text(
    instruction.changeSummary || instruction.directoryProbeSummary,
  );
  if (instruction.kind === "resend" || changeSummary) {
    await fillVisiblePersonnelTaskChangeSummary(page, changeSummary);
  }

  return visiblePersonnelMailDialog(page);
}

async function readVisibleMailRecipients(page, instruction = {}) {
  const mailDialog = await visiblePersonnelMailDialog(page);
  const rule = operationPersonnelRecipientRule(instruction);
  const expected = targetRecipients(instruction.target || {});
  return readVisiblePersonnelMailRecipients(mailDialog, expected, rule);
}

export async function inspectVisiblePersonnelDirectory(page, instruction = {}) {
  const mailDialog = await openVisiblePersonnelMailDialog(page, instruction);
  const rule = operationPersonnelRecipientRule(instruction);
  const groups = await readVisiblePersonnelDirectoryGroups(page, mailDialog, rule);
  await closeVisibleMailDialog(page);
  return groups;
}

export async function readVisibleTopRightSendRecords(page) {
  const visibleDialogs = page.locator(".ant-modal:visible");
  if (typeof visibleDialogs?.filter === "function") {
    const taskDialogs = visibleDialogs.filter({
      hasText: "任务单发送需满足以下条件",
    });
    const taskDialogCount = await taskDialogs.count();
    if (taskDialogCount > 1) {
      throw operationControlError("分散在线监考任务单弹窗", taskDialogCount);
    }
    if (taskDialogCount === 1) {
      return (await readVisiblePersonnelTaskSheet(page)).sendRecords;
    }
  }

  const marked = page.locator("[data-operation-send-records]:visible");
  const markedCount = await marked.count();
  if (markedCount > 1) throw operationControlError("任务单右上角发送记录区", markedCount);
  if (markedCount === 1) {
    const records = marked.locator("[data-operation-send-record]:visible");
    const count = await records.count();
    const output = [];
    for (let index = 0; index < count; index += 1) {
      const record = records.nth(index);
      output.push({
        type: text(await record.getAttribute("data-send-type")),
        sentAt: text(await record.getAttribute("data-sent-at")),
      });
    }
    return output;
  }

  const tables = page.locator("table:visible");
  const tableCount = await tables.count();
  const matches = [];
  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const table = tables.nth(tableIndex);
    const headers = (await table.locator("thead th").allInnerTexts()).map(text);
    const typeIndex = headers.indexOf("发送类型");
    const timeIndex = headers.indexOf("发送时间");
    if (typeIndex >= 0 && timeIndex >= 0) matches.push({ table, typeIndex, timeIndex });
  }
  if (matches.length !== 1) {
    throw operationControlError("任务单右上角发送记录表", matches.length);
  }
  const { table, typeIndex, timeIndex } = matches[0];
  const rows = table.locator("tbody tr");
  const rowCount = await rows.count();
  const output = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = (await rows.nth(rowIndex).locator("td").allInnerTexts()).map(text);
    output.push({ type: cells[typeIndex], sentAt: cells[timeIndex] });
  }
  return output;
}

const VISIBLE_OPERATION_PERSONNEL_ADAPTER = Object.freeze({
  readBatch: (page) => readVisibleSection(page, "batch"),
  readSchedules: (page) => readVisibleSection(page, "schedules"),
  readPersonnel: (page) => readVisiblePersonnelPageSection(page, "personnel"),
  readDates: (page) => readVisiblePersonnelPageSection(page, "dates"),
  readRequirements: (page) => readVisiblePersonnelPageSection(page, "requirements"),
  openPersonnelPage: (page, instruction = {}) => ensureVisiblePersonnelPage(page, instruction),
  readTaskSheet: async (page) => (await readVisiblePersonnelTaskSheet(page)).taskSheet,
  readTaskSheetSchedules: async (page) => (await readVisiblePersonnelTaskSheet(page)).schedules,
  readSendRecords: (page) => readVisibleTopRightSendRecords(page),
  readDirectoryGroups: (page) => readVisibleSection(page, "directoryGroups"),

  async publishBatch(page, instruction, options = {}) {
    await locateOperationPersonnelBatch(page, instruction, options);
    const pageOrigin = new URL(page.url()).origin;
    const responseWait = typeof page.waitForResponse === "function"
      ? page.waitForResponse((response) => {
        try {
          const request = response.request();
          return new URL(response.url()).origin === pageOrigin
            && new URL(response.url()).pathname === "/api/batch/save_push_status"
            && request.method() === "POST"
            && ["xhr", "fetch"].includes(request.resourceType());
        } catch {
          return false;
        }
      }, { timeout: 30_000 })
      : null;
    responseWait?.catch(() => {});
    await clickUniqueVisible(
      page.getByRole("button", { name: /^发\s*布$/ }),
      "发布按钮",
    );
    await confirmTopVisibleDialog(page);
    if (responseWait) {
      const response = await responseWait;
      const responseError = await response.finished();
      if (responseError) throw responseError;
      const payload = await response.json().catch(() => null);
      if (!response.ok() || Number(payload?.code) !== 10) {
        throw operationConflict(
          `批次发布请求失败：HTTP ${response.status?.() || "?"}，code ${payload?.code ?? "?"}`,
        );
      }
    }
    if (typeof page.waitForTimeout === "function") await page.waitForTimeout(500);
    await page.waitForFunction(() => {
      const clean = (value) => String(value ?? "").trim();
      const visible = (node) => Boolean(
        node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      );
      const titles = [...document.querySelectorAll(".header-title")].filter(visible);
      if (titles.length !== 1) return false;
      const headerRoot = titles[0].parentElement?.parentElement;
      const statusNodes = headerRoot
        ? [...headerRoot.querySelectorAll(".right p")].filter(
          (node) => visible(node) && clean(node.textContent).startsWith("批次状态"),
        )
        : [];
      return statusNodes.length === 1
        && [...statusNodes[0].querySelectorAll(".ant-tag")]
          .some((node) => clean(node.textContent) === "已发布");
    }, null, { timeout: 30_000 });
  },

  async syncExamSchedules(page, target = [], current = []) {
    const currentByCode = new Map(current.map((item) => [text(item.scheduleCode), item]));
    for (const schedule of target) {
      const existing = currentByCode.get(text(schedule.scheduleCode));
      if (existing && sameData(existing, schedule)) continue;
      await editVisibleSchedule(page, schedule, existing);
    }
  },

  async initializeExamSchedules(page, target = {}, instruction = {}, options = {}) {
    const schedules = [...(target.schedules || [])];
    const startDates = schedules.map((item) => text(item.start).slice(0, 10)).filter(Boolean).sort();
    const endDates = schedules.map((item) => text(item.end).slice(0, 10)).filter(Boolean).sort();
    const desiredSnapshot = {
      batchName: text(target.batch?.batchName),
      examStartDate: startDates[0] || "",
      examEndDate: endDates.at(-1) || "",
      schedules: schedules.map((schedule, requirementIndex) => ({
        requirementIndex,
        scene: String(requirementIndex + 1),
        code: text(schedule.scheduleCode),
        name: text(schedule.subjectName),
        start: text(schedule.start),
        end: text(schedule.end),
        timezone: "东8区",
        durationMinutes: schedule.durationMinutes,
        earlyLoginMinutes: schedule.earlyLoginMinutes,
        trial: false,
        remark: "",
      })),
    };
    const result = await runOperationBatchScheduleInitialization({
      batch: {
        code: text(target.batch?.code || instruction.batch?.code || instruction.batchCode),
        name: desiredSnapshot.batchName,
      },
      desiredSnapshot,
    }, {
      page,
      baseUrl: options.baseUrl,
      reuseVerifiedDetail: true,
      verifiedDetailUrl: page.url(),
    });
    if (result?.verified !== true) {
      throw operationConflict("平台无日程，自动补充后未通过精确回读");
    }
    return result;
  },

  findScheduleRows: (page, schedule) => exactScheduleRows(page, schedule),

  async deleteSchedule(_page, schedule, row) {
    if (!row) throw scheduleNotUnique(schedule, 0);
    await clickUniqueVisible(
      row.getByRole("button", { name: "删除", exact: true }),
      `日程 ${schedule.scheduleEntryId}/${schedule.scheduleCode} 删除按钮`,
    );
    await confirmTopVisibleDialog(_page);
  },

  async syncPersonnelConfig(page, personnel = {}, _current = {}, instruction = {}) {
    const dates = normalizeDates(instruction.target?.dates || {});
    await openVisiblePersonnelSectionEditor(page, "配置项");
    const dialog = await visiblePersonnelConfigDialog(page);
    await fillVisiblePersonnelConfiguration(page, dialog, personnel, dates);
    await confirmVisiblePersonnelConfig(page, dialog);
  },

  async syncPersonnelDates(page, dates = {}, current = {}, instruction = {}) {
    await openVisiblePersonnelSectionEditor(page, "配置项");
    const dialog = await visiblePersonnelConfigDialog(page);
    if (text(current.start) !== text(dates.start)
      || text(current.end) !== text(dates.end)) {
      await selectVisiblePersonnelDateRange(page, dialog, dates.start, dates.end);
    }
    if (text(current.nameListDue) !== text(dates.nameListDue)) {
      await selectVisiblePersonnelDate(page, dialog, "请选择日期", dates.nameListDue);
    }
    await assertVisiblePersonnelDateInputs(dialog, dates);
    await confirmVisiblePersonnelConfig(page, dialog);
  },

  async syncExamServiceRequirements(page, target = [], current = [], instruction = {}) {
    await openVisiblePersonnelSectionEditor(page, "考务需求");
    const drawer = await visiblePersonnelRequirementsDrawer(page);
    await ensureVisiblePersonnelRequirementRows(
      page,
      drawer,
      target.map((item) => text(item.name)),
    );
    const currentByName = new Map(current.map((item) => [text(item.name), text(item.value)]));
    for (const item of target) {
      if (currentByName.get(text(item.name)) === text(item.value)) continue;
      const row = await exactVisibleRequirementRow(drawer, item.name);
      const input = await uniqueVisibleControl(
        row.locator("textarea:visible"),
        `考务需求 ${text(item.name)} 描述`,
      );
      await input.fill(text(item.value));
    }
    await clickUniqueNamedButton(
      drawer,
      ["确 定", "确定"],
      "在线监考考务需求确定按钮",
    );
    await drawer.waitFor({ state: "hidden", timeout: 10_000 });
    await waitForVisiblePersonnelRequirements(page, target);
  },

  openTaskSheet: (page, instruction = {}) => (
    openVisibleBatchPersonnelTaskSheet(page, instruction)
  ),

  async selectRecipients(page, recipients, instruction = {}) {
    const mailDialog = await openVisiblePersonnelMailDialog(page, instruction);
    const rule = operationPersonnelRecipientRule(instruction);
    await selectVisiblePersonnelRecipients(page, mailDialog, recipients, rule);
  },

  readSelectedRecipients: (page, instruction) => (
    readVisibleMailRecipients(page, instruction)
  ),

  async confirmSend(page) {
    const mailDialog = await visiblePersonnelMailDialog(page);
    await confirmVisiblePersonnelMailDialog(mailDialog);
  },

  async closeTaskSheet(page) {
    const dialog = await uniqueVisibleModalWithText(
      page,
      "任务单发送需满足以下条件",
      "分散在线监考任务单弹窗",
    );
    await clickUniqueVisible(dialog.locator(".ant-modal-close:visible"), "任务单关闭按钮");
  },

  reopenTaskSheet: (page, instruction) => (
    VISIBLE_OPERATION_PERSONNEL_ADAPTER.openTaskSheet(page, instruction)
  ),
});

export const OPERATION_PERSONNEL_CHECKPOINTS = Object.freeze([
  "inspect_batch",
  "publish_batch",
  "verify_exam_schedules",
  "sync_personnel_config",
  "sync_personnel_dates",
  "sync_exam_service_requirements",
  "verify_task_sheet",
  "select_recipients",
  "submit_send",
  "verify_send_record",
]);

function operationMethod(page, options, name) {
  const owner = options[name]
    ? options
    : (options.adapter?.[name] ? options.adapter : VISIBLE_OPERATION_PERSONNEL_ADAPTER);
  const method = options[name] || options.adapter?.[name] || VISIBLE_OPERATION_PERSONNEL_ADAPTER[name];
  if (typeof method !== "function") {
    throw new Error(`运控人员任务执行器缺少 ${name} 方法`);
  }
  return method.bind(owner);
}

function sameData(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operationConflict(detail) {
  const error = new Error(`运控人员任务状态冲突：${detail}`);
  error.code = "PERSONNEL_OPERATION_CONFLICT";
  error.status = 409;
  return error;
}

function batchScheduleConflict(detail) {
  const error = new Error(`批次受管日程冲突：${detail}`);
  error.code = "PERSONNEL_BATCH_SCHEDULE_CONFLICT";
  error.status = 409;
  return error;
}

function checkpointDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function personnelCheckpoint(
  name,
  targetDigest,
  action,
  verify,
  options,
  runningReadback,
) {
  const now = options.now || Date.now;
  await options.onCheckpoint?.({
    name,
    status: "running",
    startedAt: new Date(now()).toISOString(),
    targetDigest,
    ...(runningReadback === undefined ? {} : { readback: runningReadback }),
  });
  const output = await action();
  const readback = await verify(output);
  await options.onCheckpoint?.({
    name,
    status: "completed",
    completedAt: new Date(now()).toISOString(),
    targetDigest,
    readback,
  });
  return readback;
}

async function runPersonnelCheckpoint({
  name,
  target,
  beforeAction,
  action,
  verify,
  verifyCompleted,
  actionStartedIsIrreversible = false,
  runningReadback,
  instruction,
  options,
}) {
  const targetDigest = checkpointDigest(target);
  const saved = instruction.checkpoints?.[name];
  const actionStarted = actionStartedIsIrreversible
    && ["running", "submission_started", "completed"].includes(saved?.status);
  if (saved?.status === "completed" || actionStarted) {
    if (saved.targetDigest && saved.targetDigest !== targetDigest) {
      throw operationConflict(`${name} 的已保存目标摘要与当前目标不一致`);
    }
    if (saved.status === "completed" && !saved.targetDigest) {
      throw operationConflict(`${name} 的已保存目标摘要缺失`);
    }
    return verifyCompleted(saved);
  }
  await beforeAction?.();
  return personnelCheckpoint(
    name,
    targetDigest,
    action,
    verify,
    options,
    runningReadback,
  );
}

function targetRecipients(target = {}) {
  const people = (items) => [...(items || [])].map((item) => ({
    id: text(item?.id),
    name: text(item?.name),
    ...(text(item?.kind) ? { kind: text(item.kind) } : {}),
  }));
  return {
    to: people(target.directoryMatch?.to),
    cc: people(target.directoryMatch?.cc),
  };
}

function assertReadback(name, expected, actual) {
  if (!sameData(expected, actual)) {
    throw operationConflict(`${name} 回读结果与已确认目标不一致`);
  }
  return actual;
}

export function findAttemptSendRecord(records = [], attempt = {}) {
  return findOperationTaskAttemptSendRecord(records, attempt);
}

async function waitForNewSendRecord(readRecords, attempt, options = {}) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const deadline = now() + 30_000;
  await options.onVerification?.({
    phase: options.phase,
    deadlineAt: new Date(deadline).toISOString(),
  });
  while (now() < deadline) {
    const match = findAttemptSendRecord(await readRecords(), attempt);
    if (match) return match;
    await sleep(Math.min(1000, Math.max(0, deadline - now())));
  }
  return null;
}

function taskSheetBlocked(detail) {
  const error = new Error(`运控任务单发送条件阻断：${detail}`);
  error.code = "PERSONNEL_TASK_SHEET_BLOCKED";
  error.status = 409;
  return error;
}

function assertTaskSheetReady(expected, actual) {
  if (!actual.conditions.length || actual.conditions.some((condition) => (
    !condition || typeof condition !== "object" || condition.satisfied !== true
  ))) {
    throw taskSheetBlocked("页面发送条件未全部满足");
  }
  if (text(expected.type) && text(expected.type) !== text(actual.type)) {
    throw operationConflict("verify_task_sheet 任务单类型与已确认目标不一致");
  }
  return actual;
}

function assertManagedSchedules(managedSchedules, displaySchedules, schedules) {
  const expected = operationPersonnelDisplaySchedules(
    managedSchedules,
    (displaySchedules || []).map((schedule) => ({
      scheduleCode: schedule.scheduleCode,
      subjectName: schedule.name,
      start: schedule.start,
      end: schedule.end,
    })),
  );
  const actual = [...(schedules || [])].map(normalizeSchedule);
  assertScheduleCodes(actual);
  const actualByCode = new Map(actual.map((schedule) => [
    text(schedule.scheduleCode),
    schedule,
  ]));
  const complete = expected.length === actual.length
    && expected.every((schedule) => {
      const visible = actualByCode.get(text(schedule.scheduleCode));
      return visible && sameScheduleContent(schedule, visible);
    });
  if (!complete) {
    throw batchScheduleConflict(
      "运控可见日程与已确认受管日程不一致，请先在建批次环节完成批次信息修改",
    );
  }
  return expected;
}

function scheduleNotUnique(schedule, count) {
  const error = new Error(
    `考试日程 ${schedule.scheduleEntryId || "缺少稳定 ID"}/${schedule.scheduleCode || "缺少代码"}`
    + ` 必须精确匹配 1 行，实际 ${count} 行`,
  );
  error.code = "PERSONNEL_SCHEDULE_NOT_UNIQUE";
  error.status = 409;
  return error;
}

async function runOperationPersonnelAttemptOnPage(page, instruction, options) {
  await locateOperationPersonnelBatch(page, instruction, options);
  options = { ...options, batchDetailLocated: true };
  const target = normalizeOperationPersonnelSnapshot(instruction.target || {});
  const baseline = normalizeOperationPersonnelSnapshot(instruction.baseline || instruction.target || {});
  const resumeBaseline = operationPersonnelResumeBaseline(
    baseline,
    instruction.checkpoints,
  );
  const kind = instruction.kind === "resend" ? "resend" : "initial";
  const managedSchedules = [...(instruction.managedSchedules || [])]
    .map(normalizeManagedSchedule)
    .sort((left, right) => left.requirementIndex - right.requirementIndex);
  const displaySchedules = structuredClone(instruction.displaySchedules || []);
  const inspect = async () => {
    const actual = await inspectOperationPersonnelTask(page, {
      ...instruction,
      allowUnpublishedPreview: kind === "initial",
      skipTaskSheet: true,
    }, options);
    const expected = operationPersonnelConflictBaseline(
      resumeBaseline,
      actual,
      kind,
      managedSchedules,
    );
    if (kind === "initial") {
      expected.batch.published = actual.batch.published;
    }
    const conflicts = operationPersonnelConflicts(expected, actual, kind);
    if (conflicts.length) {
      throw operationConflict(conflicts.map((item) => item.path).join("、"));
    }
    return actual;
  };
  let snapshot = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[0],
    target: { kind, baseline },
    action: inspect,
    verify: async (actual) => actual,
    verifyCompleted: inspect,
    instruction,
    options,
  });

  const readPublishedBatch = async () => {
    if (snapshot.batch.published) return snapshot.batch;
    await locateOperationPersonnelBatch(page, instruction, options);
    const batch = normalizeOperationPersonnelSnapshot({
      batch: await operationMethod(page, options, "readBatch")(page, instruction),
    }).batch;
    if (!batch.published) throw operationConflict("批次发布后回读仍为未发布");
    return batch;
  };
  let publishInstruction = instruction;
  const savedPublish = instruction.checkpoints?.[OPERATION_PERSONNEL_CHECKPOINTS[1]];
  if (savedPublish?.status === "completed") {
    await locateOperationPersonnelBatch(page, instruction, options);
    const currentBatch = normalizeOperationPersonnelSnapshot({
      batch: await operationMethod(page, options, "readBatch")(page, instruction),
    }).batch;
    snapshot.batch = currentBatch;
    if (!currentBatch.published) {
      const checkpoints = { ...(instruction.checkpoints || {}) };
      delete checkpoints[OPERATION_PERSONNEL_CHECKPOINTS[1]];
      publishInstruction = { ...instruction, checkpoints };
    }
  }
  snapshot.batch = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[1],
    target: { ...target.batch, published: true },
    action: async () => {
      if (kind === "initial" && !snapshot.batch.published) {
        await operationMethod(page, options, "publishBatch")(page, instruction, options);
      }
    },
    verify: readPublishedBatch,
    verifyCompleted: readPublishedBatch,
    instruction: publishInstruction,
    options,
  });

  if (kind === "initial" && baseline.batch.published !== true) {
    const refreshed = await inspectOperationPersonnelTask(page, {
      ...instruction,
      allowUnpublishedPreview: false,
      skipTaskSheet: true,
    }, options);
    const expected = structuredClone(baseline);
    expected.batch.published = refreshed.batch.published;
    const conflicts = operationPersonnelConflicts(expected, refreshed, kind);
    if (conflicts.length) {
      throw operationConflict(conflicts.map((item) => item.path).join("、"));
    }
    snapshot = refreshed;
    const legacyInspection = [
      "readSchedules",
      "readPersonnel",
      "readDates",
      "readRequirements",
      "readTaskSheet",
      "readSendRecords",
      "readDirectoryGroups",
    ].some((name) => typeof options[name] === "function")
      || typeof options.readVisibleSnapshot === "function";
    if (!legacyInspection) {
      await operationMethod(page, options, "closeTaskSheet")(page, instruction);
      await locateOperationPersonnelBatch(page, instruction, options);
    }
  }

  const readSection = async (readName, key) => {
    const raw = await operationMethod(page, options, readName)(page, instruction);
    return normalizeOperationPersonnelSnapshot({ [key]: raw })[key];
  };
  const sync = async (
    checkpointName,
    optionName,
    readName,
    key,
    action,
    project = (value) => value,
  ) => {
    const inspectedRaw = snapshot[key];
    const inspected = project(inspectedRaw);
    const desired = project(target[key]);
    const unchanged = sameData(inspected, desired);
    const readAndVerify = async () => assertReadback(
      checkpointName,
      desired,
      project(await readSection(readName, key)),
    );
    snapshot[key] = await runPersonnelCheckpoint({
      name: checkpointName,
      target: desired,
      action: action || (async () => {
        if (!unchanged) {
          await operationMethod(page, options, optionName)(
            page,
            target[key],
            inspectedRaw,
            instruction,
          );
        }
      }),
      verify: unchanged ? async () => inspected : readAndVerify,
      verifyCompleted: unchanged ? async () => inspected : readAndVerify,
      instruction,
      options,
    });
  };

  const readManagedSchedules = async () => {
    await locateOperationPersonnelBatch(page, instruction, options);
    await (options.openEztestSchedulePage || openVisibleEztestSchedulePage)(page, instruction);
    return assertManagedSchedules(
      managedSchedules,
      displaySchedules,
      await operationMethod(page, options, "readSchedules")(page, instruction),
    );
  };
  await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[2],
    target: displaySchedules,
    action: async () => {
      await locateOperationPersonnelBatch(page, instruction, options);
      await (options.openEztestSchedulePage || openVisibleEztestSchedulePage)(page, instruction);
      const current = await operationMethod(page, options, "readSchedules")(page, instruction);
      if (current.length === 0) {
        await operationMethod(page, options, "initializeExamSchedules")(
          page,
          target,
          instruction,
          options,
        );
      }
    },
    verify: readManagedSchedules,
    verifyCompleted: readManagedSchedules,
    instruction,
    options,
  });

  await operationMethod(page, options, "openPersonnelPage")(page, instruction);
  await sync(
    OPERATION_PERSONNEL_CHECKPOINTS[3],
    "syncPersonnelConfig",
    "readPersonnel",
    "personnel",
    undefined,
    personnelConfigProjection,
  );
  snapshot.dates = normalizeDates(await readSection("readDates", "dates"));
  await sync(OPERATION_PERSONNEL_CHECKPOINTS[4], "syncPersonnelDates", "readDates", "dates");
  await sync(
    OPERATION_PERSONNEL_CHECKPOINTS[5],
    "syncExamServiceRequirements",
    "readRequirements",
    "requirements",
  );

  const readAndVerifyTaskSheet = async () => {
    const taskSheet = normalizeTaskSheet(
      await operationMethod(page, options, "readTaskSheet")(page, instruction),
    );
    const taskSheetSchedules = await operationMethod(
      page,
      options,
      "readTaskSheetSchedules",
    )(page, instruction);
    assertManagedSchedules(managedSchedules, displaySchedules, taskSheetSchedules);
    return assertTaskSheetReady(target.taskSheet, taskSheet);
  };
  await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[6],
    target: target.taskSheet,
    action: () => operationMethod(page, options, "openTaskSheet")(page, instruction),
    verify: readAndVerifyTaskSheet,
    verifyCompleted: async () => {
      await operationMethod(page, options, "openTaskSheet")(page, instruction);
      return readAndVerifyTaskSheet();
    },
    instruction,
    options,
  });

  const beforeSendRecords = normalizeSendRecords(
    await operationMethod(page, options, "readSendRecords")(page, instruction),
  );
  if (kind === "initial") {
    const existingSendRecords = beforeSendRecords;
    if (existingSendRecords.length) {
      throw operationConflict("平台已存在人员任务发送记录，必须先按重发流程核对，不能再次首次发送");
    }
  }

  if (!target.directoryMatch.to.length && !target.directoryMatch.cc.length) {
    const customDirectoryReader = options.readDirectoryGroups
      || options.adapter?.readDirectoryGroups;
    const groups = customDirectoryReader
      ? await customDirectoryReader(page, instruction)
      : await inspectVisiblePersonnelDirectory(page, instruction);
    target.directoryMatch = directoryMatch(
      operationPersonnelRecipientRule(instruction),
      matchOperationPersonnelRecipients({ ...instruction, groups }),
    );
    instruction.target = structuredClone(target);
  }
  const recipients = targetRecipients(target);
  const readAndVerifyRecipients = async () => {
    const actual = targetRecipients({
      directoryMatch: await operationMethod(page, options, "readSelectedRecipients")(page, instruction),
    });
    const hydrateNames = (actualPeople, expectedPeople) => {
      const expectedById = new Map(expectedPeople.map((item) => [item.id, item.name]));
      return actualPeople.map((item) => ({
        ...item,
        name: item.name || expectedById.get(item.id) || "",
      }));
    };
    return assertReadback("select_recipients", recipients, {
      to: hydrateNames(actual.to, recipients.to),
      cc: hydrateNames(actual.cc, recipients.cc),
    });
  };
  await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[7],
    target: recipients,
    action: () => operationMethod(page, options, "selectRecipients")(page, recipients, instruction),
    verify: readAndVerifyRecipients,
    verifyCompleted: readAndVerifyRecipients,
    instruction,
    options,
  });

  const submitTarget = { kind, recipients };
  const pendingAttempt = {
    kind,
    startedAt: new Date((options.now || Date.now)()).toISOString(),
    beforeSendRecords,
  };
  const attempt = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[8],
    target: submitTarget,
    beforeAction: async () => {
      assertManagedSchedules(
        managedSchedules,
        displaySchedules,
        await operationMethod(page, options, "readTaskSheetSchedules")(page, instruction),
      );
      await readAndVerifyRecipients();
    },
    action: async () => {
      await operationMethod(page, options, "confirmSend")(page, pendingAttempt, instruction);
      return pendingAttempt;
    },
    verify: async (value) => value,
    verifyCompleted: async (completed) => {
      const value = completed.readback;
      if (!value?.startedAt || value.kind !== kind) {
        throw operationConflict("submit_send 已完成但缺少本次发送开始时间");
      }
      return value;
    },
    actionStartedIsIrreversible: true,
    runningReadback: pendingAttempt,
    instruction,
    options,
  });

  const readRecords = () => operationMethod(page, options, "readSendRecords")(page, instruction);
  const verifyRecord = async () => {
    const record = findAttemptSendRecord(await readRecords(), attempt);
    if (!record) throw operationConflict("verify_send_record 已完成但发送记录无法回读");
    return record;
  };
  const sendRecord = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[9],
    target: attempt,
    action: async () => {
      const first = await waitForNewSendRecord(readRecords, attempt, {
        ...options,
        phase: "initial",
      });
      if (first) return first;
      await operationMethod(page, options, "closeTaskSheet")(page, instruction);
      await operationMethod(page, options, "reopenTaskSheet")(page, instruction);
      return waitForNewSendRecord(readRecords, attempt, {
        ...options,
        phase: "reopened",
      });
    },
    verify: async (record) => record,
    verifyCompleted: verifyRecord,
    instruction,
    options,
  });

  const finalRecords = normalizeSendRecords(await readRecords());
  return {
    status: sendRecord ? "sent" : "result_unknown",
    sendRecord,
    attemptStartedAt: attempt.startedAt,
    completedAt: new Date((options.now || Date.now)()).toISOString(),
    operationSnapshot: normalizeOperationPersonnelSnapshot({
      ...target,
      batch: snapshot.batch,
      sendRecords: finalRecords,
    }),
  };
}

export async function runOperationPersonnelAttempt(instruction, options = {}) {
  if (options.browserSession) {
    await validateOperationPersonnelBrowserSession(
      options.browserSession,
      instruction,
      options,
    );
    return runOperationPersonnelAttemptOnPage(
      options.browserSession.page,
      instruction,
      { ...options, batchDetailLocated: true },
    );
  }
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const context = options.context || await launchOperationBatchContext(userDataDir, false, options);
  return runWithOperationBatchContext(
    context,
    (page) => runOperationPersonnelAttemptOnPage(page, instruction, options),
    { closeContext: !options.context },
  );
}

export async function runOperationPersonnelRecheck(instruction, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const context = options.context || await launchOperationBatchContext(userDataDir, false, options);
  return runWithOperationBatchContext(context, async () => {
    const selected = await operationPersonnelContextPage(context, instruction, options);
    const page = selected.page;
    const runOptions = { ...options, batchDetailLocated: selected.batchDetailLocated };
    await locateOperationPersonnelBatch(page, instruction, runOptions);
    await operationMethod(page, options, "openTaskSheet")(page, instruction);
    const records = normalizeSendRecords(
      await operationMethod(page, options, "readSendRecords")(page, instruction),
    );
    const attempt = instruction.attempt || {
      kind: instruction.kind === "resend" ? "resend" : "initial",
      startedAt: instruction.attemptStartedAt,
    };
    const sendRecord = findAttemptSendRecord(records, attempt);
    return {
      status: sendRecord ? "sent" : "result_unknown",
      sendRecord,
      sendRecords: records,
    };
  }, { closeContext: !options.context });
}
