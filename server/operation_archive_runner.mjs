import path from "node:path";

import {
  operationConsoleBatchListUrl,
  operationConsoleNeedsLogin,
  operationConsoleLoginMessage,
} from "./operation_batch_runner.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function compact(value) {
  return text(value).replace(/\s+/g, "");
}

function fieldValue(draft, key) {
  return text(draft?.fields?.[key]?.value);
}

function archiveError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function sameText(expected, actual) {
  return compact(expected) === compact(actual);
}

const ARCHIVE_INPUT_IDS = Object.freeze({
  cityCount: "exam_cities",
  ataRegistrationSubjects: "reg_subjects",
  ataRegistrationAdjustmentReason: "system_reg_subjects_adjustment_reason",
  registrationSubjects: "reg_operation_subjects",
  registrationAdjustmentReason: "reg_subjects_adjustment_reason",
  openSubjects: "arranged_operation_subjects",
  openSubjectsAdjustmentReason: "arranged_subjects_adjustment_reason",
  attendedSubjects: "exam_operation_subjects",
  attendedSubjectsAdjustmentReason: "exam_subjects_adjustment_reason",
  averageAttendanceRate: "avg_exam_percent",
  implementationUsers: "exam_users",
  implementationSites: "exam_places",
  implementationRooms: "exam_rooms",
  implementationSessions: "exam_scenes",
  implementationPapers: "papers",
  implementationSubjects: "subjects",
  scheduleCount: "schedules",
  remark: "memo",
});

const ARCHIVE_SELECT_LABELS = Object.freeze({
  personalityAssessmentScope: "包含性格测评",
  examType: "考试类型",
  operationServiceScope: "运营服务范围",
  stationUsage: "使用考站情况",
  registrationMode: "报名模式类型",
  registrationSystemType: "报名系统类型",
  systemType: "系统类型",
  arrangementService: "编排服务",
  settlementArrangementSource: "在线结算编排来源",
  billingBasis: "结算依据",
});

const ARCHIVE_SELECT_OPTION_SELECTOR = [
  ".ant-select-dropdown-menu-item",
  ".ant-select-item-option",
  "[role=option]",
].join(", ");

const ARCHIVE_ACTION_LABELS = Object.freeze(["我要归档", "重新归档"]);
const ARCHIVE_ACTION_NAME_PATTERN = /^\s*(?:我要归档|重新归档)\s*$/;
const ARCHIVE_FORM_TEXT_PATTERN = /(?:我要归档|重新归档)/;
const ARCHIVE_ATTACHMENT_REMOVE_SELECTOR = [
  ".anticon-delete",
  '[aria-label*="delete" i]',
  '[aria-label*="删除"]',
  '[aria-label*="移除"]',
  '[title*="删除"]',
  '[title*="移除"]',
].join(", ");

export function operationArchiveInputMapping(draft = {}) {
  return Object.fromEntries(Object.entries(ARCHIVE_INPUT_IDS).map(([key, id]) => [id, fieldValue(draft, key)]));
}

export function operationArchiveStatusFromText(value = "") {
  const normalized = compact(value);
  if (/状态[:：](已归档|已提交|已完成|待审核|审核中)/.test(normalized)) return "submitted";
  if (/状态[:：]待提交/.test(normalized)
    || ARCHIVE_ACTION_LABELS.some((label) => normalized.includes(label))) return "pending";
  return "unknown";
}

export function operationArchiveConfirmationTextMatches(value = "") {
  const normalized = compact(value);
  return normalized.includes("提交归档") && normalized.includes("确认");
}

export function operationArchiveSchedulePromptText(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map(text)
    .find((value) => value.includes("日程")) || "";
}

export function operationArchiveFormLabelMatches(actual, expected) {
  const normalized = (value) => compact(value).replace(/^[*＊]/, "").replace(/[：:]$/, "");
  return normalized(actual) === normalized(expected);
}

export function operationArchiveShouldFillValue(current, expected) {
  return Boolean(text(expected)) && !sameText(current, expected);
}

export function operationArchiveShouldFillInputValue(key, current, expected) {
  if (key === "remark") return Boolean(text(current));
  return operationArchiveShouldFillValue(current, expected);
}

export function operationArchiveDesiredSelectValue(draft, key) {
  return key === "examType" ? "机考" : fieldValue(draft, key);
}

async function ensureBatchListReady(page, batchListUrl, options = {}) {
  const loginWaitMinutes = Number(options.loginWaitMinutes || process.env.OPERATION_CONSOLE_LOGIN_WAIT_MINUTES || 10);
  const createButton = page.getByRole("button", { name: /创建批次/ });
  try {
    await createButton.waitFor({ state: "visible", timeout: 10000 });
    return;
  } catch {}
  if (!operationConsoleNeedsLogin(page.url())) {
    throw archiveError("OPERATION_ARCHIVE_BATCH_LIST_UNAVAILABLE", `未找到运营批次列表，当前页面：${page.url()}`);
  }
  await page.waitForURL((url) => !operationConsoleNeedsLogin(String(url)), {
    timeout: Math.max(1, loginWaitMinutes) * 60 * 1000,
  }).catch(() => {
    throw archiveError("OPERATION_ARCHIVE_LOGIN_REQUIRED", operationConsoleLoginMessage(loginWaitMinutes));
  });
  await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
  await createButton.waitFor({ state: "visible", timeout: 30000 });
}

async function operationConsolePage(context, batchListUrl) {
  const pages = typeof context?.pages === "function" ? context.pages() : [];
  const expectedOrigin = new URL(batchListUrl).origin;
  const matching = pages.find((page) => {
    try {
      return new URL(page.url()).origin === expectedOrigin;
    } catch {
      return false;
    }
  });
  return matching || pages[0] || await context.newPage();
}

async function visibleLocators(locator) {
  const locators = await locator.all();
  const visible = [];
  for (const item of locators) {
    if (await item.isVisible().catch(() => false)) visible.push(item);
  }
  return visible;
}

async function readBatchIdentity(page) {
  const title = page.locator(".header-title:visible");
  const info = page.locator(".header-info:visible");
  if (await title.count() !== 1 || await info.count() !== 1) {
    throw archiveError("OPERATION_ARCHIVE_IDENTITY_UNAVAILABLE", "批次详情页缺少唯一的批次标题或项目信息");
  }
  const projectLinks = await info.locator(".hover-link:visible").allInnerTexts();
  const bodyText = await page.locator("body").innerText();
  return {
    code: text(await title.locator(":scope > span").first().innerText()),
    batchName: text(await title.locator(":scope > label").first().innerText()),
    projectCode: text(projectLinks[0]),
    projectName: text(projectLinks[1]),
    published: bodyText.includes("已发布") && !bodyText.includes("未发布"),
  };
}

function operationArchiveBatchDetailUrl(value, batchListUrl) {
  let detailUrl;
  try {
    detailUrl = new URL(text(value));
  } catch {
    throw archiveError("OPERATION_ARCHIVE_BATCH_URL_INVALID", "已保存的运营批次详情地址无效");
  }
  const expectedOrigin = new URL(batchListUrl).origin;
  if (detailUrl.origin !== expectedOrigin
    || detailUrl.pathname !== "/batch/batchDetail"
    || !detailUrl.searchParams.get("batch_guid")) {
    throw archiveError("OPERATION_ARCHIVE_BATCH_URL_INVALID", "已保存的运营批次详情地址不属于有效的批次详情页");
  }
  return detailUrl;
}

export function assertOperationArchiveBatchIdentity(draft, identity = {}) {
  const expectedCode = fieldValue(draft, "batchCode");
  const actualCode = text(identity.code);
  if (!expectedCode || actualCode !== expectedCode) {
    throw archiveError(
      "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH",
      `归档批次校验失败：预期 ${expectedCode || "(空)"}，实际 ${actualCode || "(未读取)"}`,
    );
  }
  const expectedName = fieldValue(draft, "batchName");
  const actualName = text(identity.batchName);
  if (!expectedName || !sameText(actualName, expectedName)) {
    throw archiveError(
      "OPERATION_ARCHIVE_BATCH_IDENTITY_MISMATCH",
      `归档批次名称校验失败：预期 ${expectedName || "(空)"}，实际 ${actualName || "(未读取)"}`,
    );
  }
  return { ...identity, code: actualCode, batchName: actualName };
}

async function readAndVerifyBatchIdentity(page, draft) {
  await page.locator(".header-title:visible").waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".header-info:visible").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const title = document.querySelector(".header-title");
    const code = title?.querySelector(":scope > span")?.textContent?.trim();
    const name = title?.querySelector(":scope > label")?.textContent?.trim();
    return Boolean(code && name);
  }, null, { timeout: 30000 });
  const identity = await readBatchIdentity(page);
  return assertOperationArchiveBatchIdentity(draft, identity);
}

export async function openExactBatch(page, draft, batchListUrl, options = {}) {
  const batchCode = fieldValue(draft, "batchCode");
  const savedDetailUrl = text(options.batchDetailUrl);
  if (savedDetailUrl) {
    const targetUrl = operationArchiveBatchDetailUrl(savedDetailUrl, batchListUrl);
    let currentUrl = null;
    try {
      currentUrl = new URL(page.url());
    } catch {}
    if (currentUrl
      && currentUrl.origin === targetUrl.origin
      && currentUrl.pathname === targetUrl.pathname
      && currentUrl.searchParams.get("batch_guid") === targetUrl.searchParams.get("batch_guid")) {
      return await readAndVerifyBatchIdentity(page, draft);
    }
    await page.goto(targetUrl.href, { waitUntil: "domcontentloaded" });
    return await readAndVerifyBatchIdentity(page, draft);
  }
  const detailUrl = new URL(page.url());
  if (detailUrl.origin === new URL(batchListUrl).origin && detailUrl.pathname === "/batch/batchDetail") {
    const identity = await readBatchIdentity(page).catch(() => null);
    if (identity?.code === batchCode) {
      return assertOperationArchiveBatchIdentity(draft, identity);
    }
  }
  await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
  await ensureBatchListReady(page, batchListUrl, options);
  const search = page.locator("input[placeholder*=批次代码], input[placeholder*=批次名称]").first();
  await search.waitFor({ state: "visible", timeout: 30000 });
  await search.fill(batchCode);
  await search.press("Enter");
  await page.waitForFunction((expected) => document.body?.innerText?.includes(expected), batchCode, { timeout: 30000 });
  const codeNodes = await visibleLocators(page.getByText(batchCode, { exact: true }));
  if (codeNodes.length !== 1) {
    throw archiveError("OPERATION_ARCHIVE_BATCH_NOT_UNIQUE", `批次代码 ${batchCode} 精确匹配到 ${codeNodes.length} 个可见结果`);
  }
  const detailWait = page.waitForURL((url) => {
    const value = new URL(String(url));
    return value.origin === new URL(batchListUrl).origin
      && value.pathname === "/batch/batchDetail"
      && Boolean(value.searchParams.get("batch_guid"));
  }, { timeout: 30000 });
  detailWait.catch(() => {});
  await codeNodes[0].click();
  await detailWait;
  return await readAndVerifyBatchIdentity(page, draft);
}

export async function openArchiveTab(page) {
  const tabs = await visibleLocators(page.locator(".ant-tabs-tab").filter({ hasText: /^\s*归档\s*$/ }));
  if (tabs.length !== 1) {
    throw archiveError("OPERATION_ARCHIVE_TAB_NOT_UNIQUE", `批次详情页“归档”标签必须唯一，实际 ${tabs.length} 个`);
  }
  await tabs[0].click();
  try {
    await page.waitForFunction((actionLabels) => {
      const value = (document.body?.innerText || "").replace(/\s+/g, "");
      return actionLabels.some((label) => value.includes(label))
        || /状态[:：](已归档|已提交|已完成|待审核|审核中)/.test(value);
    }, ARCHIVE_ACTION_LABELS, { timeout: 10000 });
  } catch (error) {
    if (!/timeout/i.test(String(error?.name || error?.message || error))) throw error;
  }
  const bodyText = await page.locator("body").innerText();
  return operationArchiveStatusFromText(bodyText);
}

async function currentArchiveForm(page) {
  const existingModals = await visibleLocators(page.locator(".ant-modal").filter({ hasText: ARCHIVE_FORM_TEXT_PATTERN }));
  if (existingModals.length === 1) return existingModals[0];
  if (existingModals.length > 1) {
    throw archiveError("OPERATION_ARCHIVE_FORM_NOT_UNIQUE", `归档填写弹窗必须唯一，实际 ${existingModals.length} 个`);
  }
  return null;
}

export async function openArchiveForm(page) {
  const existingModal = await currentArchiveForm(page);
  if (existingModal) return existingModal;
  const buttons = await visibleLocators(page.getByRole("button", { name: ARCHIVE_ACTION_NAME_PATTERN }));
  if (!buttons.length) {
    const status = operationArchiveStatusFromText(await page.locator("body").innerText());
    if (status === "submitted") return null;
    throw archiveError("OPERATION_ARCHIVE_ACTION_NOT_FOUND", "批次归档页未找到唯一的“我要归档”或“重新归档”按钮");
  }
  if (buttons.length !== 1) {
    throw archiveError("OPERATION_ARCHIVE_ACTION_NOT_UNIQUE", `归档操作按钮必须唯一，实际 ${buttons.length} 个`);
  }
  await buttons[0].click();
  await page.waitForFunction((actionLabels) => {
    const visible = (node) => Boolean(
      node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    );
    const archiveModal = [...document.querySelectorAll(".ant-modal")]
      .some((node) => visible(node) && actionLabels.some((label) => (node.innerText || "").includes(label)));
    const scheduleNotice = [...document.querySelectorAll(
      ".ant-message-notice, .ant-notification-notice, .ant-modal-confirm",
    )].some((node) => visible(node) && (node.innerText || "").includes("日程"));
    return archiveModal || scheduleNotice;
  }, ARCHIVE_ACTION_LABELS, { timeout: 10000 });
  const notices = await visibleLocators(page.locator([
    ".ant-message-notice",
    ".ant-notification-notice",
    ".ant-modal-confirm",
  ].join(", ")));
  const schedulePrompt = operationArchiveSchedulePromptText(
    await Promise.all(notices.map((notice) => notice.innerText())),
  );
  if (schedulePrompt) {
    throw archiveError("OPERATION_ARCHIVE_SCHEDULE_REQUIRED", schedulePrompt);
  }
  const modal = page.locator(".ant-modal:visible").filter({ hasText: ARCHIVE_FORM_TEXT_PATTERN }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  return modal;
}

async function formItem(modal, label) {
  const candidates = await visibleLocators(modal.locator(".ant-form-item"));
  const items = [];
  for (const candidate of candidates) {
    const labels = await candidate.locator(".ant-form-item-label, label").allInnerTexts().catch(() => []);
    const firstLine = text(await candidate.innerText().catch(() => "")).split(/\r?\n/, 1)[0];
    if (firstLine) labels.push(firstLine);
    if (labels.some((actualLabel) => operationArchiveFormLabelMatches(actualLabel, label))) items.push(candidate);
  }
  if (items.length !== 1) {
    throw archiveError("OPERATION_ARCHIVE_FIELD_NOT_UNIQUE", `归档字段“${label}”必须唯一，实际 ${items.length} 个`);
  }
  return items[0];
}

export async function waitForOperationArchiveSelectOption(page, label, value, timeoutMs = 10000) {
  const expected = compact(value);
  await page.waitForFunction(({ selector, expectedText }) => {
    const normalized = (input) => String(input || "").trim().replace(/\s+/g, "");
    return [...document.querySelectorAll(selector)].some((option) => {
      const style = window.getComputedStyle(option);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && option.getClientRects().length > 0
        && normalized(option.textContent) === expectedText;
    });
  }, {
    selector: ARCHIVE_SELECT_OPTION_SELECTOR,
    expectedText: expected,
  }, { timeout: timeoutMs }).catch(() => {});

  const optionCandidates = await visibleLocators(page.locator(ARCHIVE_SELECT_OPTION_SELECTOR));
  const options = [];
  for (const option of optionCandidates) {
    const optionText = await option.innerText().catch(() => "");
    if (sameText(optionText, value)) options.push(option);
  }
  if (options.length !== 1) {
    throw archiveError("OPERATION_ARCHIVE_OPTION_NOT_UNIQUE", `归档字段“${label}”选项“${value}”必须唯一，实际 ${options.length} 个`);
  }
  return options[0];
}

async function chooseSelect(page, modal, label, value) {
  if (!text(value)) return false;
  const item = await formItem(modal, label);
  const currentValue = await readSelectValue(modal, label).catch(() => "");
  if (!operationArchiveShouldFillValue(currentValue, value)) return false;
  const control = item.locator(".ant-select-selection, .ant-select-selector, [role=combobox]").first();
  await control.click();
  let option;
  try {
    option = await waitForOperationArchiveSelectOption(page, label, value);
  } catch (error) {
    await control.press("Escape").catch(() => {});
    throw error;
  }
  await option.click();
  return true;
}

async function readSelectValue(modal, label) {
  const item = await formItem(modal, label);
  const selected = await item.locator([
    ".ant-select-selection__choice__content",
    ".ant-select-selection-selected-value",
    ".ant-select-selection-item",
  ].join(", ")).allTextContents();
  const values = selected.map(text).filter(Boolean);
  if (values.length) return values.join("、");
  const rendered = item.locator(".ant-select-selection__rendered").first();
  if (await rendered.count() !== 1) return "";
  return compact(await rendered.innerText()).replace("请选择", "");
}

async function setSwitch(modal, id, expected) {
  const toggle = modal.locator(`#${id}`);
  if (await toggle.count() !== 1) {
    throw archiveError("OPERATION_ARCHIVE_FIELD_NOT_UNIQUE", `归档开关 ${id} 必须唯一`);
  }
  const desired = text(expected) === "是";
  const current = compact(await toggle.innerText()) === "是"
    || await toggle.getAttribute("aria-checked") === "true";
  if (current === desired) return false;
  await toggle.click();
  return true;
}

async function waitForArchiveFormItem(page, label, timeout = 10000) {
  await page.waitForFunction((expectedLabel) => {
    const normalized = (value) => String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/^[*＊]/, "")
      .replace(/[：:]$/, "");
    const visible = (node) => Boolean(
      node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    );
    return [...document.querySelectorAll(".ant-modal")]
      .filter(visible)
      .some((modal) => [...modal.querySelectorAll(".ant-form-item")].some((item) => {
        const labels = [...item.querySelectorAll(".ant-form-item-label, label")]
          .map((node) => node.textContent || "");
        const firstLine = String(item.innerText || "").split(/\r?\n/, 1)[0];
        if (firstLine) labels.push(firstLine);
        return labels.some((actualLabel) => normalized(actualLabel) === normalized(expectedLabel));
      }));
  }, label, { timeout });
}

export async function setOperationArchivePersonalityAssessment(page, modal, expected) {
  const changed = await setSwitch(modal, "is_opa", expected);
  if (text(expected) !== "是") return changed;
  if (!changed) {
    await setSwitch(modal, "is_opa", "否");
    await setSwitch(modal, "is_opa", "是");
  }
  await waitForArchiveFormItem(page, ARCHIVE_SELECT_LABELS.personalityAssessmentScope);
  return true;
}

async function waitForArchiveAttachmentCount(page, expectedCount, timeout = 10000) {
  await page.waitForFunction((count) => {
    const visible = (node) => Boolean(
      node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    );
    const modals = [...document.querySelectorAll(".ant-modal")].filter(visible);
    if (modals.length !== 1) return false;
    return [...modals[0].querySelectorAll(".ant-upload-list-item")].filter(visible).length === count;
  }, expectedCount, { timeout });
}

export async function clearOperationArchiveAttachments(page, modal) {
  let removed = 0;
  while (removed < 20) {
    const items = await visibleLocators(modal.locator(".ant-upload-list-item"));
    if (!items.length) return removed;
    const item = items[0];
    const expectedCount = items.length - 1;
    await item.hover();
    let actions = item.locator(ARCHIVE_ATTACHMENT_REMOVE_SELECTOR);
    let actionCount = await actions.count();
    if (!actionCount) {
      actions = item.getByRole("button", { name: /删除|移除|delete/i });
      actionCount = await actions.count();
    }
    if (actionCount !== 1) {
      throw archiveError(
        "OPERATION_ARCHIVE_ATTACHMENT_REMOVE_NOT_UNIQUE",
        `归档历史附件删除按钮必须唯一，实际 ${actionCount} 个`,
      );
    }
    await actions.first().click();
    await waitForArchiveAttachmentCount(page, expectedCount);
    removed += 1;
    await page.waitForTimeout(1500);
    if ((await visibleLocators(modal.locator(".ant-upload-list-item"))).length !== expectedCount) {
      continue;
    }
  }
  const remaining = await visibleLocators(modal.locator(".ant-upload-list-item"));
  if (remaining.length) {
    throw archiveError("OPERATION_ARCHIVE_ATTACHMENT_REMOVE_FAILED", "归档历史附件未全部删除");
  }
  return removed;
}

async function waitForArchiveAttachmentsReady(page, modal, expectedCount, timeout = 30000) {
  const interval = 250;
  const stableChecksRequired = 8;
  const maxChecks = Math.ceil(timeout / interval);
  let stableChecks = 0;
  let lastCount = 0;
  for (let check = 0; check < maxChecks; check += 1) {
    const items = await visibleLocators(modal.locator(".ant-upload-list-item"));
    const uploading = await visibleLocators(modal.locator(".ant-upload-list-item-uploading"));
    lastCount = items.length;
    if (lastCount > expectedCount) return { ready: false, count: lastCount };
    if (lastCount === expectedCount && !uploading.length) {
      stableChecks += 1;
      if (stableChecks >= stableChecksRequired) return { ready: true, count: lastCount };
    } else {
      stableChecks = 0;
    }
    await page.waitForTimeout(interval);
  }
  throw archiveError(
    "OPERATION_ARCHIVE_ATTACHMENT_UPLOAD_TIMEOUT",
    `归档最新附件上传未完成，期望 ${expectedCount} 个，实际 ${lastCount} 个`,
  );
}

export async function replaceOperationArchiveAttachments(page, modal, attachmentPaths = []) {
  if (!attachmentPaths.length) return { removed: 0, uploaded: 0 };
  let removed = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    removed += await clearOperationArchiveAttachments(page, modal);
    const fileInput = modal.locator('input[type="file"]');
    if (await fileInput.count() !== 1) {
      throw archiveError("OPERATION_ARCHIVE_ATTACHMENT_INPUT_MISSING", "归档弹窗缺少唯一附件上传控件");
    }
    await fileInput.setInputFiles(attachmentPaths);
    const ready = await waitForArchiveAttachmentsReady(page, modal, attachmentPaths.length);
    if (ready.ready) return { removed, uploaded: attachmentPaths.length };
  }
  throw archiveError("OPERATION_ARCHIVE_ATTACHMENT_REPLACE_FAILED", "历史附件反复回流，未能只保留最新归档截图");
}

async function readFormSnapshot(modal) {
  const controls = {};
  for (const [key, id] of Object.entries(ARCHIVE_INPUT_IDS)) {
    const inputs = await visibleLocators(modal.locator(`input#${id}, textarea#${id}`));
    controls[key] = inputs.length ? text(await inputs[0].inputValue()) : "";
  }
  controls.personalityAssessment = compact(await modal.locator("#is_opa").innerText());
  controls.operationOrganizationService = compact(await modal.locator("#operate_service").innerText());
  for (const [key, label] of Object.entries(ARCHIVE_SELECT_LABELS)) {
    if (key === "personalityAssessmentScope" && controls.personalityAssessment !== "是") {
      controls[key] = "";
      continue;
    }
    controls[key] = await readSelectValue(modal, label).catch(() => "");
  }
  controls.examStartDate = text(await modal.getByPlaceholder("开始日期").inputValue());
  controls.examEndDate = text(await modal.getByPlaceholder("结束日期").inputValue());
  return controls;
}

async function fillArchiveForm(page, modal, draft, attachmentPaths = []) {
  const written = new Set();
  if (await setOperationArchivePersonalityAssessment(
    page,
    modal,
    fieldValue(draft, "personalityAssessment"),
  )) {
    written.add("personalityAssessment");
  }
  if (await setSwitch(modal, "operate_service", fieldValue(draft, "operationOrganizationService"))) {
    written.add("operationOrganizationService");
  }
  for (const [key, label] of Object.entries(ARCHIVE_SELECT_LABELS)) {
    if (key === "personalityAssessmentScope" && fieldValue(draft, "personalityAssessment") !== "是") continue;
    if (await chooseSelect(page, modal, label, operationArchiveDesiredSelectValue(draft, key))) written.add(key);
  }
  for (const [key, id] of Object.entries(ARCHIVE_INPUT_IDS)) {
    const inputs = await visibleLocators(modal.locator(`input#${id}, textarea#${id}`));
    if (!inputs.length) {
      throw archiveError("OPERATION_ARCHIVE_FIELD_MISSING", `归档输入框 ${id} 不存在`);
    }
    const input = inputs[0];
    const currentValue = await input.inputValue();
    if (!operationArchiveShouldFillInputValue(key, currentValue, fieldValue(draft, key))) continue;
    await input.fill(fieldValue(draft, key));
    written.add(key);
  }
  await replaceOperationArchiveAttachments(page, modal, attachmentPaths);
  const snapshot = await readFormSnapshot(modal);
  for (const key of Object.keys(ARCHIVE_INPUT_IDS)) {
    if (!written.has(key)) continue;
    if (!sameText(snapshot[key], fieldValue(draft, key))) {
      throw archiveError("OPERATION_ARCHIVE_READBACK_CONFLICT", `${draft.fields[key].label}填写后回读不一致`);
    }
  }
  for (const key of ["personalityAssessment", "operationOrganizationService", ...Object.keys(ARCHIVE_SELECT_LABELS)]) {
    if (!written.has(key)) continue;
    if (key === "personalityAssessmentScope" && fieldValue(draft, "personalityAssessment") !== "是") continue;
    if (!sameText(snapshot[key], operationArchiveDesiredSelectValue(draft, key))) {
      throw archiveError("OPERATION_ARCHIVE_READBACK_CONFLICT", `${draft.fields[key].label}填写后回读不一致`);
    }
  }
  return snapshot;
}

async function closeArchiveModal(modal) {
  const cancel = modal.getByRole("button", { name: /^\s*取\s*消\s*$/ });
  if (await cancel.count() === 1) await cancel.click().catch(() => {});
}

async function currentArchiveSubmissionConfirmation(page) {
  const modalCandidates = await visibleLocators(page.locator(".ant-modal:visible"));
  let confirmations = [];
  for (const candidate of modalCandidates) {
    if (operationArchiveConfirmationTextMatches(await candidate.innerText().catch(() => ""))) {
      confirmations.push(candidate);
    }
  }
  if (!confirmations.length) {
    const confirmCandidates = await visibleLocators(page.locator(".ant-modal-confirm:visible"));
    for (const candidate of confirmCandidates) {
      if (operationArchiveConfirmationTextMatches(await candidate.innerText().catch(() => ""))) {
        confirmations.push(candidate);
      }
    }
  }
  if (confirmations.length > 1) {
    throw archiveError("OPERATION_ARCHIVE_CONFIRM_NOT_UNIQUE", `归档提交确认框必须唯一，实际 ${confirmations.length} 个`);
  }
  return confirmations[0] || null;
}

export async function confirmArchiveSubmission(page, timeout = 10000) {
  let confirmation = await currentArchiveSubmissionConfirmation(page);
  if (!confirmation) {
    await page.waitForFunction(() => {
      const visible = (node) => Boolean(
        node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      );
      return [...document.querySelectorAll(".ant-modal, .ant-modal-confirm")].some((node) => {
        const value = (node.innerText || "").replace(/\s+/g, "");
        return visible(node) && value.includes("提交归档") && value.includes("确认");
      });
    }, null, { timeout });
    confirmation = await currentArchiveSubmissionConfirmation(page);
  }
  if (!confirmation) {
    throw archiveError("OPERATION_ARCHIVE_CONFIRM_MISSING", "未找到归档提交确认框");
  }
  const confirmButtons = await visibleLocators(
    confirmation.getByRole("button", { name: /^\s*确\s*定\s*$/ }),
  );
  if (confirmButtons.length !== 1) {
    throw archiveError("OPERATION_ARCHIVE_CONFIRM_ACTION_NOT_UNIQUE", `归档提交确认按钮必须唯一，实际 ${confirmButtons.length} 个`);
  }
  await confirmButtons[0].click();
}

async function waitForArchiveSubmitted(page, timeout) {
  await page.waitForFunction(() => {
    const value = (document.body?.innerText || "").replace(/\s+/g, "");
    return /状态[:：](已归档|已提交|已完成|待审核|审核中)/.test(value);
  }, null, { timeout });
  const bodyText = await page.locator("body").innerText();
  return operationArchiveStatusFromText(bodyText);
}

async function launchContext(options = {}) {
  if (options.context) return { context: options.context, owned: false };
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const headless = options.headless ?? process.env.OPERATION_CONSOLE_HEADLESS === "1";
  const { chromium } = await import("playwright").catch(() => {
    throw archiveError("OPERATION_ARCHIVE_PLAYWRIGHT_MISSING", "本机助手缺少运控归档自动化组件，请更新本机助手", 503);
  });
  return { context: await chromium.launchPersistentContext(userDataDir, { headless, viewport: null }), owned: true };
}

async function withArchivePage(draft, options, operation) {
  const { context, owned } = await launchContext(options);
  const batchListUrl = operationConsoleBatchListUrl(options);
  const page = await operationConsolePage(context, batchListUrl);
  try {
    const identity = await openExactBatch(page, draft, batchListUrl, options);
    return await operation(page, identity);
  } finally {
    if (owned || options.closeContext !== false) await context.close();
  }
}

export async function inspectOperationArchive(draft, options = {}) {
  return withArchivePage(draft, options, async (page, identity) => {
    let modal = await currentArchiveForm(page);
    if (!modal) {
      const currentStatus = await openArchiveTab(page);
      if (currentStatus === "submitted") {
        return { status: "already_archived", externalStatus: "已提交", identity, detailUrl: page.url() };
      }
      modal = await openArchiveForm(page);
    }
    if (!modal) return { status: "already_archived", externalStatus: "已提交", identity, detailUrl: page.url() };
    try {
      return {
        status: "ready",
        identity,
        detailUrl: page.url(),
        formSnapshot: await readFormSnapshot(modal),
      };
    } finally {
      await closeArchiveModal(modal);
    }
  });
}

export async function prepareOperationArchive(draft, options = {}) {
  return withArchivePage(draft, options, async (page, identity) => {
    let modal = await currentArchiveForm(page);
    if (!modal) {
      const currentStatus = await openArchiveTab(page);
      if (currentStatus === "submitted") {
        return { status: "already_archived", externalStatus: "已提交", identity, detailUrl: page.url() };
      }
      modal = await openArchiveForm(page);
    }
    if (!modal) return { status: "already_archived", externalStatus: "已提交", identity, detailUrl: page.url() };
    const formSnapshot = await fillArchiveForm(page, modal, draft, options.attachmentPaths || []);
    return {
      status: "prepared",
      identity,
      detailUrl: page.url(),
      formSnapshot,
    };
  });
}

export async function submitOperationArchive(draft, options = {}) {
  return withArchivePage(draft, options, async (page, identity) => {
    const submitWaitMs = Number(options.submitWaitMs || 30000);
    const pendingConfirmation = await currentArchiveSubmissionConfirmation(page);
    if (pendingConfirmation) {
      try {
        await confirmArchiveSubmission(page, submitWaitMs);
        const externalStatus = await waitForArchiveSubmitted(page, submitWaitMs);
        return { status: "submitted", externalStatus, identity, detailUrl: page.url() };
      } catch (error) {
        const externalStatus = operationArchiveStatusFromText(
          await page.locator("body").innerText().catch(() => ""),
        );
        if (externalStatus === "submitted") {
          return { status: "submitted", externalStatus, identity, detailUrl: page.url() };
        }
        return {
          status: "result_unknown",
          externalStatus,
          identity,
          detailUrl: page.url(),
          errorCode: text(error?.code) || "OPERATION_ARCHIVE_RESULT_UNKNOWN",
          errorMessage: error?.message || String(error),
        };
      }
    }
    let modal = await currentArchiveForm(page);
    if (!modal) {
      const currentStatus = await openArchiveTab(page);
      if (currentStatus === "submitted") {
        return { status: "already_archived", externalStatus: "已提交", identity, detailUrl: page.url() };
      }
      modal = await openArchiveForm(page);
    }
    if (!modal) return { status: "already_archived", externalStatus: "已提交", identity, detailUrl: page.url() };
    let submissionStarted = false;
    let formSnapshot = null;
    try {
      formSnapshot = await fillArchiveForm(page, modal, draft, options.attachmentPaths || []);
      const submit = modal.getByRole("button", { name: /^\s*确\s*定\s*$/ });
      if (await submit.count() !== 1) {
        throw archiveError("OPERATION_ARCHIVE_SUBMIT_NOT_UNIQUE", "归档弹窗“确定”按钮必须唯一");
      }
      submissionStarted = true;
      if (!await currentArchiveSubmissionConfirmation(page)) await submit.click();
      await confirmArchiveSubmission(page, submitWaitMs);
      await modal.waitFor({ state: "hidden", timeout: submitWaitMs });
      const externalStatus = await waitForArchiveSubmitted(page, submitWaitMs);
      return {
        status: "submitted",
        externalStatus,
        identity,
        detailUrl: page.url(),
        formSnapshot,
      };
    } catch (error) {
      if (!submissionStarted) throw error;
      const externalStatus = operationArchiveStatusFromText(
        await page.locator("body").innerText().catch(() => ""),
      );
      if (externalStatus === "submitted") {
        return {
          status: "submitted",
          externalStatus,
          identity,
          detailUrl: page.url(),
          formSnapshot,
        };
      }
      return {
        status: "result_unknown",
        externalStatus,
        identity,
        detailUrl: page.url(),
        errorCode: text(error?.code) || "OPERATION_ARCHIVE_RESULT_UNKNOWN",
        errorMessage: error?.message || String(error),
      };
    }
  });
}
