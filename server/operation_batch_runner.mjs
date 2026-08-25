import path from "node:path";

import {
  assertOperationBatchDetailIdentityResult,
  openOperationBatchIdentityByCode,
} from "./operation_batch_update_runner.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function compactText(value) {
  return text(value).replace(/\s+/g, "");
}

export const DEFAULT_OPERATION_CONSOLE_BASE_URL = "https://dashboard.ata.net.cn";

export function operationConsoleBatchListUrl(options = {}) {
  const env = options.env || process.env;
  const baseUrl = text(options.baseUrl || env.OPERATION_CONSOLE_BASE_URL || DEFAULT_OPERATION_CONSOLE_BASE_URL);
  return `${baseUrl.replace(/\/$/, "")}/batch/batchList`;
}

function draftValue(draft, key) {
  return text(draft?.fields?.[key]?.value);
}

const operationFieldIds = new Map([
  ["业务部归属", "start_department"],
  ["批次名称", "batch_name"],
  ["项目部归属", "project_department"],
  ["考试日期", "exam_datetime"],
  ["预估总考量", "exam_amount"],
  ["预估单场最大科次数", "exam_concurrency"],
  ["预估城市数", "exam_cities"],
  ["系统类型", "system_type"],
  ["使用考站情况", "exam_station"],
  ["编排服务", "arrange_method"],
  ["在线结算编排来源", "arrange_type"],
  ["结算依据", "settlement_subjects"],
  ["备注", "memo"],
]);

export function operationFieldId(label) {
  return operationFieldIds.get(text(label)) || "";
}

export function operationDateTitle(value) {
  const match = text(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return text(value);
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

export function operationServiceButtonLabels(fields = {}) {
  const labels = [];
  const contentService = text(fields.contentService);
  if (contentService && !/(不配置|不需要)/.test(contentService)) labels.push("内容");
  if (text(fields.serviceExam)) labels.push("考试");
  const personnel = text(fields.servicePersonnel);
  if (personnel && !personnel.includes("不需要")) labels.push("人员");
  return labels;
}

export function operationConfigServiceSelections(fields = {}) {
  const selections = [];
  const contentService = text(fields.contentService);
  if (contentService && !/(不配置|不需要)/.test(contentService)) {
    selections.push({ category: "内容", option: contentService });
  }
  const serviceExam = text(fields.serviceExam);
  const servicePersonnel = text(fields.servicePersonnel);
  if (serviceExam) selections.push({ category: "考试", option: serviceExam });
  if (servicePersonnel && !servicePersonnel.includes("不需要")) {
    selections.push({ category: "人员", option: "在线监考" });
  }
  return selections;
}

export function operationSelectedTaskMismatches(draft, selected = {}) {
  const checks = [
    ["projectCode", "项目编码"],
    ["projectName", "项目名称"],
  ];
  return checks
    .map(([key, label]) => ({
      label,
      expected: draftValue(draft, key),
      actual: text(selected[key]),
    }))
    .filter((item) => item.expected && item.actual && item.expected !== item.actual);
}

export function operationSelectedTaskMismatchMessage(mismatches = []) {
  const detail = mismatches
    .map((item) => `${item.label}期望 ${item.expected}，实际 ${item.actual}`)
    .join("；");
  return `运营控制台需求任务单与当前项目不一致：${detail}。请先确认业务需求单流水号或选择正确的运控任务单。`;
}

export function operationTaskMismatchAllowed(options = {}) {
  if (options.allowTaskMismatch === true) return true;
  const env = options.env || process.env;
  return env.OPERATION_CONSOLE_ALLOW_TEST_TASK_MISMATCH === "1";
}

export function operationConsoleNeedsLogin(urlValue = "") {
  const value = text(urlValue).toLowerCase();
  return value.includes("/oauth2/authorize") || value.includes("/loginwaiting") || value.includes("/login");
}

export function operationConsoleLoginMessage(minutes) {
  return `运营控制台需要登录。请在自动化浏览器中完成登录，系统会等待最多 ${minutes} 分钟；登录完成后会继续创建并发布批次。`;
}

export function operationTaskSearchInputSelector() {
  return 'input[placeholder*="流水号"]';
}

export function operationSelectControlSelector() {
  return ".ant-select-selection, .ant-select-selector, [role='combobox']";
}

export function operationDropdownValueCandidates(label, value) {
  const normalizedLabel = text(label);
  const normalizedValue = text(value);
  if (!normalizedValue) return [];
  if (normalizedLabel === "业务部归属"
    && (normalizedValue.includes("办事处") || normalizedValue.includes("代表处"))) {
    return [normalizedValue, "地方业务中心"];
  }
  const aliases = {
    结算依据: {
      按报名科次结算: ["按开考科次结算"],
    },
  };
  return [normalizedValue, ...(aliases[normalizedLabel]?.[normalizedValue] || [])];
}

export function operationBatchCodeFromText(value) {
  return text(value).match(/\b[A-Z]{3}\d{6}\b/)?.[0] || "";
}

function reconciliationRequiredError(cause) {
  const error = new Error(cause?.message || String(cause || "运营批次需要人工回查确认"));
  error.code = "OPERATION_BATCH_RECONCILIATION_REQUIRED";
  error.status = 409;
  if (cause && cause !== error) error.cause = cause;
  return error;
}

async function clickByText(page, textValue) {
  await page.getByText(textValue, { exact: false }).first().click();
}

async function formItemByLabel(page, label) {
  const labelNode = page.locator(`label[title^="${label}"]`).first();
  await labelNode.waitFor({ state: "visible", timeout: 30000 });
  return labelNode.locator("xpath=ancestor::*[contains(@class,'ant-form-item')][1]");
}

async function fillInputNearLabel(page, label, value) {
  if (!text(value)) return;
  const fieldId = operationFieldId(label);
  const input = fieldId
    ? page.locator(`#${fieldId}, #${fieldId} input, #${fieldId} textarea`).last()
    : (await formItemByLabel(page, label)).locator("input,textarea").first();
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.fill(text(value));
}

async function inputValueById(page, id) {
  const input = page.locator(`#${id}`).first();
  await input.waitFor({ state: "attached", timeout: 30000 });
  return input.inputValue();
}

async function assertSelectedTaskMatchesDraft(page, draft, options = {}) {
  await page.locator("#project_code").waitFor({ state: "attached", timeout: 30000 });
  await page.waitForFunction(() => document.querySelector("#project_code")?.value || "", null, { timeout: 30000 });
  const selected = {
    projectCode: await inputValueById(page, "project_code"),
    projectName: await inputValueById(page, "project_name"),
  };
  const mismatches = operationSelectedTaskMismatches(draft, selected);
  if (mismatches.length && !operationTaskMismatchAllowed(options)) {
    throw new Error(operationSelectedTaskMismatchMessage(mismatches));
  }
}

async function chooseDropdownValue(page, label, value) {
  if (!text(value)) return;
  const fieldId = operationFieldId(label);
  const container = fieldId ? page.locator(`#${fieldId}`).first() : await formItemByLabel(page, label);
  const candidates = operationDropdownValueCandidates(label, value);
  let lastError;
  for (const candidate of candidates) {
    await container.locator(operationSelectControlSelector()).first().click();
    try {
      await page.getByText(candidate, { exact: true }).last().click({ timeout: 5000 });
      return;
    } catch (error) {
      lastError = error;
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  throw new Error(`运营控制台下拉选项不存在：${label}=${value}`, lastError ? { cause: lastError } : undefined);
}

async function chooseDateRange(page, startDate, endDate) {
  const startTitle = operationDateTitle(startDate);
  const endTitle = operationDateTitle(endDate || startDate);
  if (!startTitle) return;
  await page.locator("#exam_datetime").click();
  const startCell = page.locator(`td[title="${startTitle}"] .ant-calendar-date`).last();
  await startCell.waitFor({ state: "visible", timeout: 30000 });
  await startCell.click();
  const endCell = page.locator(`td[title="${endTitle}"] .ant-calendar-date`).last();
  await endCell.waitFor({ state: "visible", timeout: 30000 });
  await endCell.click();
}

async function clickConfigServiceButton(page, label) {
  if (!text(label)) return;
  const target = compactText(label);
  const formItems = await page.locator(".ant-form-item").all();
  for (const item of formItems) {
    const itemText = compactText(await item.innerText().catch(() => ""));
    if (!itemText.includes("配置服务")) continue;
    const buttons = await item.locator("button").all();
    for (const button of buttons) {
      const value = compactText(await button.innerText());
      if (value === target) {
        await button.click();
        return;
      }
    }
  }
  const container = await formItemByLabel(page, "配置服务");
  const buttons = await container.locator("button").all();
  for (const button of buttons) {
    const value = compactText(await button.innerText());
    if (value === target) {
      await button.click();
      return;
    }
  }
  throw new Error(`配置服务中未找到按钮：${label}`);
}

async function clickVisibleModalButton(page, label) {
  const target = compactText(label);
  const buttons = await page.locator(".ant-modal:visible button").all();
  for (const button of buttons) {
    const value = compactText(await button.innerText().catch(() => ""));
    if (value === target) {
      await button.click();
      return;
    }
  }
  throw new Error(`配置服务选项中未找到按钮：${label}`);
}

async function chooseConfigService(page, selection = {}) {
  if (!text(selection.category) || !text(selection.option)) return;
  await clickConfigServiceButton(page, selection.category);
  await clickVisibleModalButton(page, selection.option);
}

async function selectOperationTask(page, serial) {
  const searchInput = page.locator(operationTaskSearchInputSelector()).last();
  await searchInput.waitFor({ state: "visible", timeout: 30000 });
  await searchInput.fill(serial);
  await searchInput.press("Enter");
  const modal = page.locator(".ant-modal:visible").last();
  await page.waitForFunction((expectedSerial) => {
    const modals = Array.from(document.querySelectorAll(".ant-modal"))
      .filter((node) => node.getClientRects().length > 0);
    const latest = modals.at(-1);
    return latest?.innerText?.includes(expectedSerial);
  }, serial, { timeout: 30000 }).catch(async () => {
    const modalText = await modal.innerText().catch(() => "");
    if (modalText.includes("暂无数据") || modalText.includes("找到0条结果")) {
      throw new Error(`运营控制台未找到考试需求任务单：${serial}`);
    }
    throw new Error(`运营控制台考试需求任务单搜索超时：${serial}`);
  });
  const result = modal.getByText(serial, { exact: false }).first();
  await result.click();
  await modal.getByRole("button", { name: /确\s*定/ }).click();
}

async function ensureBatchListReady(page, batchListUrl, options = {}) {
  const loginWaitMinutes = Number(options.loginWaitMinutes || process.env.OPERATION_CONSOLE_LOGIN_WAIT_MINUTES || 10);
  const waitMs = Math.max(1, loginWaitMinutes) * 60 * 1000;
  const createButton = page.getByRole("button", { name: /创建批次/ });
  try {
    await createButton.waitFor({ state: "visible", timeout: 30000 });
    return;
  } catch {}

  if (!operationConsoleNeedsLogin(page.url())) {
    throw new Error(`未找到“创建批次”按钮，当前页面：${page.url()}`);
  }

  // Keep the headed browser open so the user can finish SSO login manually.
  await page.waitForURL((url) => !operationConsoleNeedsLogin(String(url)), { timeout: waitMs }).catch(() => {
    throw new Error(operationConsoleLoginMessage(loginWaitMinutes));
  });
  await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
  await createButton.waitFor({ state: "visible", timeout: 30000 });
}

function operationConsolePageIsUsable(page) {
  if (!page) return false;
  try {
    if (typeof page.isClosed === "function" && page.isClosed()) return false;
    const mainFrame = typeof page.mainFrame === "function" ? page.mainFrame() : null;
    if (typeof mainFrame?.isDetached === "function" && mainFrame.isDetached()) return false;
    return true;
  } catch {
    return false;
  }
}

function operationConsoleUrlsMatch(actual, expected) {
  try {
    return new URL(text(actual)).href === new URL(text(expected)).href;
  } catch {
    return false;
  }
}

function operationConsolePageUrl(page) {
  try {
    return text(page?.url?.());
  } catch {
    return "";
  }
}

export function operationConsoleNavigationCanRetry(error) {
  return /No frame with given id found|Frame has been detached|Target page, context or browser has been closed|Target closed/i
    .test(error?.message || String(error || ""));
}

export async function navigateOperationConsolePage(context, page, targetUrl) {
  let candidate = operationConsolePageIsUsable(page) ? page : await context.newPage();
  if (operationConsoleUrlsMatch(operationConsolePageUrl(candidate), targetUrl)) {
    try {
      if (typeof candidate.title === "function") await candidate.title();
      return candidate;
    } catch (error) {
      if (!operationConsoleNavigationCanRetry(error)) throw error;
    }
    candidate = await context.newPage();
    await candidate.goto(targetUrl, { waitUntil: "domcontentloaded" });
    return candidate;
  }
  try {
    await candidate.goto(targetUrl, { waitUntil: "domcontentloaded" });
    return candidate;
  } catch (error) {
    if (!operationConsoleNavigationCanRetry(error)) throw error;
  }

  candidate = await context.newPage();
  await candidate.goto(targetUrl, { waitUntil: "domcontentloaded" });
  return candidate;
}

export async function operationConsolePage(context, batchListUrl) {
  const pages = typeof context?.pages === "function" ? context.pages() : [];
  let expectedOrigin = "";
  try {
    expectedOrigin = new URL(batchListUrl).origin;
  } catch {}
  const isExpectedConsolePage = (candidate) => {
    const currentUrl = operationConsolePageUrl(candidate);
    if (!currentUrl) return false;
    try {
      return new URL(currentUrl).origin === expectedOrigin;
    } catch {
      return false;
    }
  };
  const consolePage = pages
    .filter(operationConsolePageIsUsable)
    .find(isExpectedConsolePage);
  return consolePage || await context.newPage();
}

async function uniqueOperationBatchResult(page, batchName, batchCode = "") {
  const normalizedName = text(batchName);
  const titleMatches = page.locator(".same-batch-title:visible").filter({ hasText: normalizedName });
  const titleCount = await titleMatches.count();
  if (titleCount > 1) {
    throw reconciliationRequiredError(new Error(`批次名称未找到唯一结果：${normalizedName}，实际 ${titleCount} 条`));
  }
  if (titleCount === 1) return titleMatches.first();

  let rowMatches = page.locator("tbody tr:visible").filter({ hasText: normalizedName });
  if (batchCode) rowMatches = rowMatches.filter({ hasText: batchCode });
  const rowCount = await rowMatches.count();
  if (rowCount > 1) {
    throw reconciliationRequiredError(new Error(`批次名称未找到唯一结果：${normalizedName}，实际 ${rowCount} 条`));
  }
  if (rowCount === 1) return rowMatches.first();
  throw reconciliationRequiredError(new Error(`按批次名称未找到批次：${normalizedName}`));
}

async function waitForOperationBatchListSettle(page, options = {}) {
  const maxChecks = Math.max(2, Number(options.tableStableMaxChecks || 30));
  const pollMs = Math.max(0, Number(options.tableStablePollMs ?? 100));
  let previousSignature = "";
  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    const loadingCount = await page.locator(".ant-spin-spinning").count();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const signature = bodyText.replace(/\s+/g, " ").trim();
    if (!loadingCount && attempt > 0 && signature === previousSignature) return;
    previousSignature = signature;
    await page.waitForTimeout(pollMs);
  }
  throw reconciliationRequiredError(new Error("批次列表在安全等待时间内未稳定，无法确认完整查询结果"));
}

async function findCreatedBatchFromList(page, batchListUrl, batchName, options = {}) {
  const normalizedName = text(batchName);
  if (!normalizedName) return null;
  await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
  await ensureBatchListReady(page, batchListUrl, options);
  await waitForOperationBatchListSettle(page, options);
  const searchInput = page.locator("input[placeholder*=批次代码], input[placeholder*=批次名称]").first();
  await searchInput.waitFor({ state: "visible", timeout: 30000 });
  await searchInput.fill(normalizedName);
  await searchInput.press("Enter");
  await page.waitForFunction((expectedName) => document.body?.innerText?.includes(expectedName), normalizedName, { timeout: 30000 });
  const target = await uniqueOperationBatchResult(page, normalizedName, text(options.operationBatchCode));
  const targetText = await target.innerText().catch(() => "");
  const bodyText = await page.locator("body").innerText();
  const code = operationBatchCodeFromText(targetText) || operationBatchCodeFromText(bodyText);
  if (!code) return null;
  const identity = await openOperationBatchIdentityByCode(page, {
    batchCode: code,
    batchName: normalizedName,
    batchListUrl,
    options,
  });
  return {
    operationBatchCode: code,
    batchName: identity.batchName,
    batchGuid: new URL(identity.detailUrl).searchParams.get("batch_guid") || "",
    detailUrl: identity.detailUrl,
    status: "created_unpublished",
    identityVerified: true,
  };
}

async function operationBatchActionButton(page, labelPattern, roleName, description) {
  const candidates = [];
  if (typeof page.locator === "function") {
    const modal = page.locator(".ant-modal:visible").last();
    candidates.push(modal.locator("button").filter({ hasText: labelPattern }));
    candidates.push(page.locator("button:visible").filter({ hasText: labelPattern }));
    candidates.push(page.locator('[role="button"]:visible').filter({ hasText: labelPattern }));
  }
  if (typeof page.getByRole === "function") {
    candidates.push(page.getByRole("button", { name: roleName, exact: true }));
  }

  let lastError;
  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      if (count === 1) {
        await candidate.waitFor({ state: "visible", timeout: 30000 });
        return candidate;
      }
      if (count > 1) {
        lastError = new Error(`${description}数量异常：${count}`);
      }
    } catch (error) {
      lastError = error;
    }
  }

  const delayedCandidate = candidates[0];
  if (delayedCandidate && typeof delayedCandidate.waitFor === "function") {
    await delayedCandidate.waitFor({ state: "visible", timeout: 30000 });
    const count = await delayedCandidate.count();
    if (count === 1) return delayedCandidate;
    throw new Error(`${description}数量异常：${count}`);
  }
  if (lastError) throw lastError;
  throw new Error(`未找到${description}`);
}

export async function assignFirstOperationProjectGroup(page, options = {}) {
  const modal = page.locator(".ant-modal:visible")
    .filter({ hasText: "新项目指定项目组" });
  await modal.waitFor({
    state: "visible",
    timeout: Number(options.projectGroupDialogWaitMs || 30000),
  });
  const modalCount = await modal.count();
  if (modalCount !== 1) {
    throw new Error(`“新项目指定项目组”弹窗数量异常：${modalCount}`);
  }

  const plusCandidates = [
    modal.locator(".anticon-plus:visible, [data-icon='plus']:visible"),
    modal.locator("[aria-label*='plus']:visible"),
    modal.locator("button:visible, [role='button']:visible, a:visible")
      .filter({ hasText: /^\s*\+\s*$/ }),
  ];
  let firstAddButton = null;
  for (const candidate of plusCandidates) {
    if (await candidate.count()) {
      firstAddButton = candidate.first();
      break;
    }
  }
  if (!firstAddButton) throw new Error("“新项目指定项目组”弹窗中未找到可选项目组的 + 按钮");
  if (typeof firstAddButton.scrollIntoViewIfNeeded === "function") {
    await firstAddButton.scrollIntoViewIfNeeded();
  }
  await firstAddButton.click();

  const confirmButton = modal.locator("button:visible")
    .filter({ hasText: /^\s*确\s*定\s*$/ });
  const confirmCount = await confirmButton.count();
  if (confirmCount !== 1) {
    throw new Error(`“新项目指定项目组”弹窗确定按钮数量异常：${confirmCount}`);
  }
  await confirmButton.click();
  await modal.waitFor({
    state: "hidden",
    timeout: Number(options.projectGroupConfirmWaitMs || 30000),
  });
  return { projectGroupAssigned: true };
}

export async function clickOperationBatchComplete(page, options = {}) {
  const completeButton = await operationBatchActionButton(
    page,
    /^\s*完\s*成\s*$/,
    "完成",
    "运营控制台最终确认页“完成”按钮",
  );
  if (typeof completeButton.scrollIntoViewIfNeeded === "function") {
    await completeButton.scrollIntoViewIfNeeded();
  }
  await completeButton.click({ force: true });
  if (options.assignProjectGroup === false) return { projectGroupAssigned: false };

  if (/batchDetail/.test(page.url())) return { projectGroupAssigned: false };
  const waitMs = Number(options.projectGroupDialogWaitMs || 30000);
  const projectGroupModal = page.locator(".ant-modal:visible")
    .filter({ hasText: "新项目指定项目组" });
  let outcome;
  try {
    outcome = await Promise.any([
      page.waitForURL(/batchDetail/, { timeout: waitMs }).then(() => "detail"),
      projectGroupModal.waitFor({ state: "visible", timeout: waitMs }).then(() => "project_group"),
      completeButton.waitFor({ state: "hidden", timeout: waitMs }).then(async () => {
        await page.waitForTimeout(Number(options.projectGroupGraceWaitMs ?? 500));
        if (await projectGroupModal.count() === 1) return "project_group";
        if (/batchDetail/.test(page.url())) return "detail";
        if (/\/batch\/batchList(?:[?#]|$)/.test(page.url())) return "list";
        throw new Error("完成按钮消失后未回到批次列表");
      }),
    ]);
  } catch {
    throw new Error("点击“完成”后既未回到批次列表，也未进入批次详情页或出现“新项目指定项目组”弹窗");
  }
  if (outcome === "detail" || outcome === "list") return { projectGroupAssigned: false };
  return await assignFirstOperationProjectGroup(page, options);
}

export function operationBatchIsPublishedText(value) {
  const bodyText = compactText(value);
  return bodyText.includes("批次状态")
    && bodyText.includes("已发布")
    && !bodyText.includes("未发布");
}

export function operationBatchPublishStateFromTags(values = []) {
  const tags = (values || []).map(compactText);
  const published = tags.filter((value) => value === "已发布").length;
  const unpublished = tags.filter((value) => (
    value === "未发布" || value === "撤销发布"
  )).length;
  if (published === 1 && unpublished === 0) return "published";
  if (published === 0 && unpublished === 1) return "unpublished";
  return "";
}

async function waitForOperationBatchPublishState(page, options = {}) {
  await page.waitForFunction(() => {
    const values = [...document.querySelectorAll(".ant-tag")]
      .filter((node) => Boolean(
        node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      ))
      .map((node) => String(node.textContent || "").replace(/\s+/g, ""));
    const published = values.filter((value) => value === "已发布").length;
    const unpublished = values.filter((value) => (
      value === "未发布" || value === "撤销发布"
    )).length;
    return (published === 1 && unpublished === 0)
      || (published === 0 && unpublished === 1);
  }, null, { timeout: Number(options.publishWaitMs || 30000) });
  const state = operationBatchPublishStateFromTags(
    await page.locator(".ant-tag:visible").allInnerTexts(),
  );
  if (!state) throw new Error("批次发布状态标签不唯一或尚未加载");
  return state;
}

export async function runOperationBatchReconciliation(draft, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const headless = options.headless ?? process.env.OPERATION_CONSOLE_HEADLESS === "1";
  let context = options.context;
  if (!context) {
    const { chromium } = await import("playwright").catch((error) => {
      const message = error?.code === "ERR_MODULE_NOT_FOUND"
        ? "未安装 Playwright，不能启动运营控制台浏览器自动化。请先执行 npm install。"
        : (error instanceof Error ? error.message : String(error));
      throw new Error(message);
    });
    context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: null,
    });
  }
  const batchListUrl = operationConsoleBatchListUrl({ baseUrl: options.baseUrl });
  let page = options.page || await operationConsolePage(context, batchListUrl);
  try {
    page = await navigateOperationConsolePage(context, page, batchListUrl);
    await ensureBatchListReady(page, batchListUrl, options);
    const batchName = draftValue(draft, "batchName");
    const operationBatchCode = text(options.operationBatchCode);
    if (operationBatchCode) {
      const identity = await openOperationBatchIdentityByCode(page, {
        batchCode: operationBatchCode,
        batchName,
        batchListUrl,
        options,
      });
      const publishState = options.publishAfterCreate === false
        ? await waitForOperationBatchPublishState(page, options)
        : (await clickOperationBatchPublish(page, options)).status;
      return {
        operationBatchCode,
        batchName: identity.batchName,
        batchGuid: new URL(page.url()).searchParams.get("batch_guid") || "",
        detailUrl: identity.detailUrl,
        status: publishState === "published" ? "published" : "created_unpublished",
        identityVerified: true,
      };
    }
    if (options.publishAfterCreate === false) {
      return await findCreatedBatchFromList(page, batchListUrl, batchName, options);
    }
    return await publishOperationBatchFromList(page, batchListUrl, batchName, options);
  } finally {
    if (options.closeContext !== false) await context.close();
  }
}

export async function clickOperationBatchPublish(page, options = {}) {
  if (await waitForOperationBatchPublishState(page, options) === "published") {
    return { status: "published", detailUrl: page.url(), alreadyPublished: true };
  }
  const publishButton = await operationBatchActionButton(
    page,
    /^\s*发\s*布\s*$/,
    "发布",
    "批次详情页“发布”按钮",
  );
  const modalCountBefore = await page.locator(".ant-modal:visible").count();
  await publishButton.click();
  await page.waitForTimeout(Number(options.publishDialogWaitMs ?? 300));
  const modals = page.locator(".ant-modal:visible");
  if (await modals.count() > modalCountBefore) {
    const modal = modals.last();
    const buttons = await modal.locator("button").all();
    const confirmationButton = (await Promise.all(buttons.map(async (button) => ({
      button,
      label: compactText(await button.innerText().catch(() => "")),
    })))).find(({ label }) => ["确定", "确认", "确认发布", "发布"].includes(label))?.button;
    if (!confirmationButton) throw new Error("发布确认框缺少唯一确认按钮");
    await confirmationButton.click();
  }
  await page.waitForFunction(() => [...document.querySelectorAll(".ant-tag")]
    .filter((node) => Boolean(
      node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    ))
    .map((node) => String(node.textContent || "").replace(/\s+/g, ""))
    .includes("已发布"), null, { timeout: Number(options.publishWaitMs || 30000) });
  await page.reload({ waitUntil: "domcontentloaded" });
  if (await waitForOperationBatchPublishState(page, options) !== "published") {
    throw new Error("点击发布后刷新回读仍为未发布");
  }
  return { status: "published", detailUrl: page.url() };
}

export async function publishOperationBatchFromList(page, batchListUrl, batchName, options = {}) {
  const normalizedName = text(batchName);
  await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
  await ensureBatchListReady(page, batchListUrl, options);
  await waitForOperationBatchListSettle(page, options);
  const searchInput = page.locator("input[placeholder*=批次代码], input[placeholder*=批次名称]").first();
  await searchInput.waitFor({ state: "visible", timeout: 30000 });
  await searchInput.fill(normalizedName);
  await searchInput.press("Enter");
  await page.waitForFunction((expectedName) => document.body?.innerText?.includes(expectedName), normalizedName, { timeout: 30000 });
  const target = await uniqueOperationBatchResult(page, normalizedName, text(options.operationBatchCode));
  const targetText = await target.innerText().catch(() => "");
  const code = operationBatchCodeFromText(targetText)
    || operationBatchCodeFromText(await page.locator("body").innerText());
  if (!code) throw new Error(`按批次名称未找到批次代码：${normalizedName}`);
  const identity = await openOperationBatchIdentityByCode(page, {
    batchCode: code,
    batchName: normalizedName,
    batchListUrl,
    options,
  });
  const published = await clickOperationBatchPublish(page, options);
  return {
    operationBatchCode: code,
    batchName: identity.batchName,
    batchGuid: new URL(page.url()).searchParams.get("batch_guid") || "",
    detailUrl: identity.detailUrl || published.detailUrl,
    status: published.status,
    identityVerified: true,
  };
}

export async function runOperationBatchCreation(draft, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const headless = options.headless ?? process.env.OPERATION_CONSOLE_HEADLESS === "1";
  let context = options.context;
  if (!context) {
    const { chromium } = await import("playwright").catch((error) => {
      const message = error?.code === "ERR_MODULE_NOT_FOUND"
        ? "未安装 Playwright，不能启动运营控制台浏览器自动化。请先执行 npm install。"
        : (error instanceof Error ? error.message : String(error));
      throw new Error(message);
    });
    context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: null,
    });
  }
  const batchListUrl = operationConsoleBatchListUrl({ baseUrl: options.baseUrl });
  let page = options.page || await operationConsolePage(context, batchListUrl);
  try {
    page = await navigateOperationConsolePage(context, page, batchListUrl);
    await ensureBatchListReady(page, batchListUrl, options);
    await page.getByRole("button", { name: /创建批次/ }).click();
    await page.getByRole("button", { name: /选\s*择/ }).click();
    const serial = draftValue(draft, "operationTaskSerial");
    if (!serial) throw new Error("缺少考试需求任务单流水号");
    await selectOperationTask(page, serial);

    await chooseDropdownValue(page, "业务部归属", draftValue(draft, "businessDepartment"));
    await fillInputNearLabel(page, "批次名称", draftValue(draft, "batchName"));
    await chooseDropdownValue(page, "项目部归属", draftValue(draft, "projectDepartment"));
    await chooseDateRange(page, draftValue(draft, "examStartDate"), draftValue(draft, "examEndDate"));
    for (const selection of operationConfigServiceSelections({
      contentService: draftValue(draft, "contentService"),
      serviceExam: draftValue(draft, "serviceExam"),
      servicePersonnel: draftValue(draft, "servicePersonnel"),
    })) {
      await chooseConfigService(page, selection);
    }
    await page.getByRole("button", { name: /下一步/ }).click();

    await fillInputNearLabel(page, "预估总考量", draftValue(draft, "estimatedTotalSubjectCount"));
    await fillInputNearLabel(page, "预估单场最大科次数", draftValue(draft, "estimatedMaxSubjectCount"));
    await fillInputNearLabel(page, "预估城市数", draftValue(draft, "estimatedCityCount"));
    await chooseDropdownValue(page, "系统类型", draftValue(draft, "systemType"));
    await chooseDropdownValue(page, "使用考站情况", draftValue(draft, "stationUsage"));
    await chooseDropdownValue(page, "编排服务", draftValue(draft, "arrangementService"));
    await chooseDropdownValue(page, "在线结算编排来源", draftValue(draft, "onlineSettlementArrangementSource"));
    await chooseDropdownValue(page, "结算依据", draftValue(draft, "billingBasis"));
    await fillInputNearLabel(page, "备注", draftValue(draft, "remark"));
    await page.getByRole("button", { name: /下一步/ }).click();
    const batchName = draftValue(draft, "batchName");
    try {
      await clickOperationBatchComplete(page, options);
    } catch (error) {
      throw reconciliationRequiredError(error);
    }
    let created;
    if (/batchDetail/.test(page.url())) {
      const bodyText = await page.locator("body").innerText();
      const code = operationBatchCodeFromText(bodyText);
      if (!code) throw reconciliationRequiredError(new Error("创建完成，但未能从详情页读取批次代码"));
      await assertOperationBatchDetailIdentityResult(page, {
        batchCode: code,
        batchName,
        batchListUrl,
      });
      const identity = await openOperationBatchIdentityByCode(page, {
        batchCode: code,
        batchName,
        batchListUrl,
        options,
      });
      created = {
        operationBatchCode: code,
        batchName: identity.batchName,
        batchGuid: new URL(identity.detailUrl).searchParams.get("batch_guid") || "",
        detailUrl: identity.detailUrl,
        status: "created_unpublished",
        identityVerified: true,
      };
    } else {
      created = await findCreatedBatchFromList(page, batchListUrl, batchName, options);
      if (!created) {
        throw reconciliationRequiredError(new Error("创建已提交，但未能在批次列表定位并打开新批次"));
      }
    }
    if (options.publishAfterCreate === false) return created;
    try {
      return await publishOperationBatchFromList(page, batchListUrl, batchName, options);
    } catch (error) {
      // The batch was already submitted. Return its code so the platform can sync it even when publish needs a follow-up.
      return {
        ...created,
        status: "created_unpublished",
        errorCode: String(error?.code || "OPERATION_BATCH_PUBLISH_FAILED"),
        errorMessage: error?.message || String(error),
      };
    }
  } finally {
    if (options.closeContext !== false) await context.close();
  }
}
