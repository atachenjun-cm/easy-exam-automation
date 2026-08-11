import {
  assertOperationContentSyncResult,
  normalizeOperationContentSnapshot,
  operationContentFingerprint,
} from "./operation_content.mjs";
import { openExactBatch } from "./operation_archive_runner.mjs";
import { operationConsoleBatchListUrl } from "./operation_batch_runner.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function runnerError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function visibleLocators(locator) {
  const items = await locator.all();
  const visible = [];
  for (const item of items) {
    if (await item.isVisible().catch(() => false)) visible.push(item);
  }
  return visible;
}

async function uniqueVisible(locator, label) {
  const matches = await visibleLocators(locator);
  if (matches.length !== 1) {
    throw runnerError("OPERATION_CONTENT_CONTROL_NOT_UNIQUE", `${label}必须唯一，实际 ${matches.length} 个`);
  }
  return matches[0];
}

function expectedOrigin(batchListUrl) {
  return new URL(batchListUrl).origin;
}

async function operationConsolePage(context, batchListUrl) {
  const pages = typeof context?.pages === "function" ? context.pages() : [];
  const origin = expectedOrigin(batchListUrl);
  const matching = pages.find((page) => {
    try {
      return new URL(page.url()).origin === origin;
    } catch {
      return false;
    }
  });
  return matching || pages[0] || await context.newPage();
}

function archiveIdentityDraft(draft = {}) {
  return {
    fields: {
      batchCode: { value: draft.batch?.code },
      batchName: { value: draft.batch?.name },
    },
  };
}

function apiData(payload = {}) {
  return payload?.data && typeof payload.data === "object" ? payload.data : {};
}

function apiSuccess(payload = {}) {
  return Number(payload?.code) === 10;
}

function requireApiSuccess(payload, label) {
  if (!apiSuccess(payload)) {
    throw runnerError("OPERATION_CONTENT_API_FAILED", `${label}失败：${text(payload?.message) || `返回码 ${payload?.code ?? "未知"}`}`);
  }
  return payload;
}

export function operationContentSnapshotFromApi({
  itemContent = {},
  subjectContent = {},
  identity = {},
  detailUrl = "",
} = {}) {
  const item = apiData(itemContent);
  const subjectData = apiData(subjectContent);
  return normalizeOperationContentSnapshot({
    batch: {
      code: item.batch_code || identity.code,
      name: item.batch_name || identity.batchName,
      detailUrl,
    },
    configuration: {
      background: item.background,
      loginMode: item.login_mode,
      itemTypes: item.item_type || [],
      contentSources: item.content_source || [],
      closePaper: item.close_paper,
      reviewPaper: item.review_paper,
      singleMaxSubjects: item.single_max_subjects,
      paperLanguages: item.paper_language || [],
      osLanguages: item.os_language || [],
      closureStart: item.closure_begin_datetime,
      closureEnd: item.closure_end_datetime,
    },
    subjects: (Array.isArray(subjectData._items) ? subjectData._items : []).map((subject) => ({
      name: subject.subject_name,
      durationMinutes: subject.last,
      remark: subject.memo,
    })),
  });
}

export function operationContentSectionsChanged(current = {}, desired = {}) {
  const currentSnapshot = normalizeOperationContentSnapshot(current);
  const desiredSnapshot = normalizeOperationContentSnapshot(desired);
  return {
    configuration: operationContentFingerprint({
      batch: desiredSnapshot.batch,
      configuration: currentSnapshot.configuration,
      subjects: desiredSnapshot.subjects,
    }) !== operationContentFingerprint(desiredSnapshot),
    subjects: operationContentFingerprint({
      batch: desiredSnapshot.batch,
      configuration: desiredSnapshot.configuration,
      subjects: currentSnapshot.subjects,
    }) !== operationContentFingerprint(desiredSnapshot),
  };
}

async function openContentTabAndRead(page, draft, identity) {
  const overview = await uniqueVisible(
    page.locator(".ant-tabs-tab").filter({ hasText: /^\s*概况\s*$/ }),
    "批次详情页概况标签",
  );
  const content = await uniqueVisible(
    page.locator(".ant-tabs-tab").filter({ hasText: /^\s*内容\s*$/ }),
    "批次详情页内容标签",
  );
  if ((await content.getAttribute("class") || "").includes("ant-tabs-tab-active")) {
    await overview.click();
  }
  const itemResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/batch/get_item_content",
    { timeout: 15000 },
  );
  const subjectResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/batch/get_paper_subject_content_list",
    { timeout: 15000 },
  );
  await content.click();
  const [item, subjects] = await Promise.all([itemResponse, subjectResponse]);
  const [itemContent, subjectContent] = await Promise.all([item.json(), subjects.json()]);
  requireApiSuccess(itemContent, "读取运控内容配置项");
  requireApiSuccess(subjectContent, "读取运控科目信息");
  const snapshot = operationContentSnapshotFromApi({
    itemContent,
    subjectContent,
    identity,
    detailUrl: page.url(),
  });
  if (snapshot.batch.code !== text(draft.batch?.code) || snapshot.batch.name.replace(/\s+/g, "") !== text(draft.batch?.name).replace(/\s+/g, "")) {
    throw runnerError(
      "OPERATION_CONTENT_BATCH_IDENTITY_MISMATCH",
      `运控内容回读批次不一致：预期 ${draft.batch?.code} / ${draft.batch?.name}，实际 ${snapshot.batch.code} / ${snapshot.batch.name}`,
    );
  }
  return snapshot;
}

async function openEditor(page, title) {
  const heading = await uniqueVisible(page.getByText(title, { exact: true }), `内容模块“${title}”标题`);
  const header = heading.locator("xpath=..");
  const edit = await uniqueVisible(header.locator(".anticon-edit"), `内容模块“${title}”编辑按钮`);
  await edit.click();
  const modal = page.locator(".ant-modal:visible").filter({ hasText: title }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  return modal;
}

async function selectValues(page, modal, id, values, multiple = false) {
  const root = modal.locator(`#${id}`);
  await root.waitFor({ state: "visible", timeout: 5000 });
  if (multiple) {
    while (await root.locator(".ant-select-selection__choice__remove").count()) {
      await root.locator(".ant-select-selection__choice__remove").first().click();
    }
  }
  for (const value of values) {
    await root.locator(".ant-select-selection").click();
    const dropdown = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):visible").last();
    await dropdown.waitFor({ state: "visible", timeout: 5000 });
    const option = dropdown.locator(".ant-select-dropdown-menu-item").filter({
      hasText: new RegExp(`^\\s*${text(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`),
    });
    if (await option.count() !== 1) {
      throw runnerError("OPERATION_CONTENT_OPTION_NOT_UNIQUE", `内容字段 ${id} 的选项“${value}”必须唯一，实际 ${await option.count()} 个`);
    }
    await option.click();
    await modal.locator(".ant-modal-title").click().catch(() => {});
  }
}

async function confirmEditor(page, modal, endpoint, label) {
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === endpoint,
    { timeout: 15000 },
  );
  const confirm = await uniqueVisible(modal.getByRole("button").filter({ hasText: /确\s*定/ }), `${label}确定按钮`);
  await confirm.click();
  const response = await responsePromise;
  const payload = await response.json();
  requireApiSuccess(payload, label);
  await modal.waitFor({ state: "hidden", timeout: 10000 });
}

async function fillConfiguration(page, configuration) {
  const modal = await openEditor(page, "配置项");
  await modal.locator("#background").fill(configuration.background);
  await modal.locator("#login_mode").fill(configuration.loginMode);
  await selectValues(page, modal, "item_type", configuration.itemTypes, true);
  await selectValues(page, modal, "content_source", configuration.contentSources, true);
  await selectValues(page, modal, "close_paper", [configuration.closePaper]);
  await selectValues(page, modal, "review_paper", [configuration.reviewPaper]);
  await modal.locator("#single_max_subjects input").fill(configuration.singleMaxSubjects);
  await selectValues(page, modal, "paper_language", configuration.paperLanguages, true);
  await selectValues(page, modal, "os_language", configuration.osLanguages, true);
  await modal.locator("#closure_begin_end_datetime").click();
  const picker = page.locator(".ant-calendar-picker-container:visible,.ant-calendar:visible").last();
  await picker.waitFor({ state: "visible", timeout: 5000 });
  const pickerValue = (value) => /\d{2}:\d{2}$/.test(text(value)) ? `${text(value)}:00` : text(value);
  await picker.locator('input[placeholder="开始日期"]').fill(pickerValue(configuration.closureStart));
  await picker.locator('input[placeholder="开始日期"]').press("Tab");
  await picker.locator('input[placeholder="结束日期"]').fill(pickerValue(configuration.closureEnd));
  await picker.locator('input[placeholder="结束日期"]').press("Tab");
  await uniqueVisible(picker.getByText(/确\s*定/, { exact: true }), "内容时间确定按钮").then((button) => button.click());
  await confirmEditor(page, modal, "/api/batch/save_item_content", "保存运控内容配置项");
}

async function fillSubjects(page, desiredSubjects) {
  const modal = await openEditor(page, "科目信息");
  const rows = modal.locator("tbody tr");
  while (await rows.count() > desiredSubjects.length) {
    await rows.last().locator(".anticon-close").click();
  }
  while (await rows.count() < desiredSubjects.length) {
    const add = await uniqueVisible(modal.getByRole("button").filter({ hasText: /新\s*增/ }), "科目信息新增按钮");
    await add.click();
  }
  for (let index = 0; index < desiredSubjects.length; index += 1) {
    const row = rows.nth(index);
    const subject = desiredSubjects[index];
    await row.locator("textarea").nth(0).fill(subject.name);
    await row.locator("input[role=spinbutton]").fill(subject.durationMinutes);
    await row.locator("textarea").nth(1).fill(subject.remark);
  }
  await confirmEditor(page, modal, "/api/batch/save_paper_subject_content_list", "保存运控科目信息");
}

export async function syncOperationContent(draft = {}, options = {}) {
  if (!draft?.batch?.code || !draft?.batch?.name || !draft?.batch?.detailUrl) {
    throw runnerError("OPERATION_CONTENT_DRAFT_INVALID", "缺少完整的运营批次代码、名称或详情地址", 400);
  }
  if (Array.isArray(draft.warnings) && draft.warnings.length) {
    throw runnerError("OPERATION_CONTENT_DRAFT_INCOMPLETE", draft.warnings.map((item) => item.message).join("；"), 400);
  }
  const batchListUrl = operationConsoleBatchListUrl({ baseUrl: options.baseUrl });
  const context = options.context;
  if (!context) throw runnerError("OPERATION_CONTENT_CONTEXT_REQUIRED", "缺少运营控制台浏览器环境", 503);
  const page = await operationConsolePage(context, batchListUrl);
  const identity = await openExactBatch(page, archiveIdentityDraft(draft), batchListUrl, {
    batchDetailUrl: draft.batch.detailUrl,
  });
  const before = await openContentTabAndRead(page, draft, identity);
  const changes = operationContentSectionsChanged(before, draft);
  if (changes.configuration) await fillConfiguration(page, draft.configuration);
  if (changes.subjects) await fillSubjects(page, draft.subjects);
  const snapshot = await openContentTabAndRead(page, draft, identity);
  assertOperationContentSyncResult(draft, { status: "success", verified: true, snapshot });
  return {
    status: "success",
    verified: true,
    snapshot,
    changed: changes,
    checkpoints: [
      "opened_exact_batch",
      "batch_code_and_name_verified",
      ...(changes.configuration ? ["configuration_saved"] : []),
      ...(changes.subjects ? ["subjects_saved"] : []),
      "content_readback_verified",
    ],
  };
}
