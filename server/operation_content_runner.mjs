import {
  normalizeOperationContentSnapshot,
  operationContentFingerprint,
} from "./operation_content.mjs";
import { openExactBatch } from "./operation_archive_runner.mjs";
import { operationConsoleBatchListUrl } from "./operation_batch_runner.mjs";
import {
  findOperationTaskAttemptSendRecord,
  normalizeOperationTaskSendRecords,
  operationTaskTimelineSendRecord,
  verifiedInitialOperationTaskSendRecord,
} from "./operation_task_send_record.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function runnerError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function assertOperationContentDraftComplete(draft = {}) {
  const snapshot = normalizeOperationContentSnapshot(draft);
  const missing = [];
  const required = [
    ["运营批次代码", snapshot.batch.code],
    ["运营批次名称", snapshot.batch.name],
    ["运营批次详情地址", snapshot.batch.detailUrl],
    ["界面背景", snapshot.configuration.background],
    ["登录方式", snapshot.configuration.loginMode],
    ["试题类型", snapshot.configuration.itemTypes.length],
    ["内容来源", snapshot.configuration.contentSources.length],
    ["封闭制题", snapshot.configuration.closePaper],
    ["人工阅卷", snapshot.configuration.reviewPaper],
    ["单科最大科次", snapshot.configuration.singleMaxSubjects],
    ["试卷使用语言", snapshot.configuration.paperLanguages.length],
    ["操作系统语言", snapshot.configuration.osLanguages.length],
    ["封场或试考开始时间", snapshot.configuration.closureStart],
    ["封场或试考结束时间", snapshot.configuration.closureEnd],
    ["科目信息", snapshot.subjects.length],
  ];
  for (const [label, value] of required) {
    if (!value) missing.push(label);
  }
  snapshot.subjects.forEach((subject, index) => {
    if (!subject.name) missing.push(`第 ${index + 1} 个科目名称`);
    if (!subject.durationMinutes) missing.push(`科目“${subject.name || index + 1}”时长`);
  });
  if (missing.length) {
    throw runnerError(
      "OPERATION_CONTENT_DRAFT_INCOMPLETE",
      `运控内容填写信息不完整：${missing.join("、")}`,
      400,
    );
  }
  return snapshot;
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

export function operationContentSubjectFillSteps(existingRowCount, desiredSubjects = []) {
  const initialCount = Math.max(0, Number.isInteger(Number(existingRowCount)) ? Number(existingRowCount) : 0);
  return (Array.isArray(desiredSubjects) ? desiredSubjects : []).flatMap((subject, index) => [
    ...(index >= initialCount ? [{ action: "add", index }] : []),
    { action: "fill", index, subject },
  ]);
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

export async function clearOperationContentMultiSelect(root, id, { timeout = 5000 } = {}) {
  const selector = ".ant-select-selection__choice__remove";
  let previousCount = await root.locator(selector).count();
  while (previousCount > 0) {
    try {
      await root.evaluate((element, options) => new Promise((resolve, reject) => {
        let timer;
        const finish = (callback, value) => {
          observer.disconnect();
          clearTimeout(timer);
          callback(value);
        };
        const check = () => {
          if (element.querySelectorAll(options.selector).length < options.previousCount) {
            finish(resolve, true);
          }
        };
        const observer = new MutationObserver(check);
        observer.observe(element, { childList: true, subtree: true });
        timer = setTimeout(
          () => finish(reject, new Error(`多选标签数量未从 ${options.previousCount} 减少`)),
          options.timeout,
        );
        const remove = element.querySelector(options.selector);
        if (!remove) {
          finish(resolve, true);
          return;
        }
        remove.click();
        check();
      }), { selector, previousCount, timeout });
    } catch (error) {
      throw runnerError(
        "OPERATION_CONTENT_MULTI_SELECT_CLEAR_FAILED",
        `内容字段 ${id} 清空旧选项失败：${text(error?.message) || "多选框未更新"}`,
      );
    }
    const currentCount = await root.locator(selector).count();
    if (currentCount >= previousCount) {
      throw runnerError(
        "OPERATION_CONTENT_MULTI_SELECT_CLEAR_FAILED",
        `内容字段 ${id} 清空旧选项失败：标签数量仍为 ${currentCount}`,
      );
    }
    previousCount = currentCount;
  }
}

export async function selectOperationContentValues(page, modal, id, values, multiple = false) {
  const root = modal.locator(`#${id}`);
  await root.waitFor({ state: "visible", timeout: 5000 });
  if (multiple) {
    await clearOperationContentMultiSelect(root, id);
  }
  const dropdowns = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):visible");
  await root.locator(".ant-select-selection").click();
  const dropdown = dropdowns.last();
  await dropdown.waitFor({ state: "visible", timeout: 5000 });
  for (const value of values) {
    const option = dropdown.locator(".ant-select-dropdown-menu-item").filter({
      hasText: new RegExp(`^\\s*${text(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`),
    });
    await option.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const optionCount = await option.count();
    if (optionCount !== 1) {
      throw runnerError("OPERATION_CONTENT_OPTION_NOT_UNIQUE", `内容字段 ${id} 的选项“${value}”必须唯一，实际 ${optionCount} 个`);
    }
    await option.click();
    if (multiple) {
      const selected = root.locator(".ant-select-selection__choice").filter({
        hasText: new RegExp(`^\\s*${text(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`),
      });
      await selected.waitFor({ state: "visible", timeout: 5000 });
      if (await selected.count() !== 1) {
        throw runnerError(
          "OPERATION_CONTENT_MULTI_SELECT_READBACK_MISMATCH",
          `内容字段 ${id} 的选项“${value}”未完成唯一回读`,
        );
      }
    }
  }
  await modal.locator(".ant-modal-title").click().catch(() => {});
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
  await selectOperationContentValues(page, modal, "item_type", configuration.itemTypes, true);
  await selectOperationContentValues(page, modal, "content_source", configuration.contentSources, true);
  await selectOperationContentValues(page, modal, "close_paper", [configuration.closePaper]);
  await selectOperationContentValues(page, modal, "review_paper", [configuration.reviewPaper]);
  await modal.locator("#single_max_subjects input").fill(configuration.singleMaxSubjects);
  await selectOperationContentValues(page, modal, "paper_language", configuration.paperLanguages, true);
  await selectOperationContentValues(page, modal, "os_language", configuration.osLanguages, true);
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
  const steps = operationContentSubjectFillSteps(await rows.count(), desiredSubjects);
  for (const step of steps) {
    if (step.action === "add") {
      const add = await uniqueVisible(modal.getByRole("button").filter({ hasText: /新\s*增/ }), "科目信息新增按钮");
      await add.click();
      await rows.nth(step.index).waitFor({ state: "attached", timeout: 5000 });
      continue;
    }
    const row = rows.nth(step.index);
    await row.locator("textarea").nth(0).fill(step.subject.name);
    await row.locator("input[role=spinbutton]").fill(step.subject.durationMinutes);
    await row.locator("textarea").nth(1).fill(step.subject.remark);
  }
  await confirmEditor(page, modal, "/api/batch/save_paper_subject_content_list", "保存运控科目信息");
}

function emailList(value) {
  const values = Array.isArray(value) ? value : text(value).split(/[\s,，;；]+/);
  return [...new Set(values.map((item) => text(item).toLowerCase()).filter(Boolean))];
}

function normalizeDispatchDirectoryGroups(value = {}, expectedBySection = {}) {
  const result = { recipients: [], cc: [] };
  for (const section of ["recipients", "cc"]) {
    const expected = new Set(expectedBySection[section] || []);
    const assigned = new Set();
    const groups = Array.isArray(value?.[section]) ? value[section] : [];
    for (const group of groups) {
      const name = text(group?.name);
      const emails = emailList(group?.emails);
      if (!name || !emails.length) {
        throw runnerError(
          "OPERATION_CONTENT_DIRECTORY_GROUP_INVALID",
          `${section === "cc" ? "抄送" : "收件人"}分组必须包含名称和邮箱`,
          400,
        );
      }
      for (const email of emails) {
        if (!expected.has(email)) {
          throw runnerError(
            "OPERATION_CONTENT_DIRECTORY_GROUP_UNEXPECTED_EMAIL",
            `人员目录分组“${name}”包含非目标邮箱：${email}`,
            400,
          );
        }
        if (assigned.has(email)) {
          throw runnerError(
            "OPERATION_CONTENT_DIRECTORY_GROUP_DUPLICATE_EMAIL",
            `目标邮箱被重复分配到人员目录分组：${email}`,
            400,
          );
        }
        assigned.add(email);
      }
      result[section].push({ name, emails });
    }
    const missing = [...expected].filter((email) => !assigned.has(email));
    if (missing.length) {
      throw runnerError(
        "OPERATION_CONTENT_DIRECTORY_GROUP_REQUIRED",
        `${section === "cc" ? "抄送" : "收件人"}邮箱未指定人员目录分组：${missing.join("、")}`,
        400,
      );
    }
  }
  return result;
}

export function normalizeOperationContentDispatchTarget(input = {}) {
  const recipients = emailList(input.recipients || input.to);
  const recipientSet = new Set(recipients);
  const cc = emailList(input.cc).filter((email) => !recipientSet.has(email));
  const invalid = [...recipients, ...cc].filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!recipients.length) {
    throw runnerError("OPERATION_CONTENT_RECIPIENTS_REQUIRED", "内容任务单至少需要一个收件人", 400);
  }
  if (invalid.length) {
    throw runnerError("OPERATION_CONTENT_RECIPIENT_INVALID", `内容任务单邮箱格式错误：${invalid.join("、")}`, 400);
  }
  const directoryGroups = normalizeDispatchDirectoryGroups(input.directoryGroups, { recipients, cc });
  return {
    projectCode: text(input.projectCode),
    recipients,
    cc,
    directoryGroups,
  };
}

export async function visibleCheckboxEntries(dialog) {
  return dialog.evaluate((node) => {
    const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
    const visible = (element) => Boolean(
      element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length),
    );
    const labelFor = (input) => clean(
      input.getAttribute("aria-label")
      || input.closest("label")?.innerText
      || input.closest(".ant-checkbox-wrapper")?.innerText
      || input.parentElement?.parentElement?.innerText,
    );
    const ccLabel = [...node.querySelectorAll("*")].find((element) => (
      visible(element)
      && element.children.length === 0
      && clean(element.textContent) === "抄送（C）"
    ));
    const ccTop = ccLabel?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
    return [...node.querySelectorAll('input[type="checkbox"]')]
      .filter((input) => (
        visible(input)
        || visible(input.closest("label"))
        || visible(input.closest(".ant-checkbox-wrapper"))
      ))
      .map((input) => ({
        label: labelFor(input),
        section: input.getBoundingClientRect().top < ccTop ? "recipients" : "cc",
        checked: input.checked === true,
      }))
      .filter((item) => item.label);
  });
}

function entryEmail(entry = {}) {
  return text(entry.label).match(/^([^\s()]+@[^\s()]+)\s*(?:\(|$)/)?.[1]?.toLowerCase() || "";
}

export async function checkboxByLabel(dialog, label, section = "") {
  const candidates = await dialog.locator('input[type="checkbox"]').all();
  const matches = [];
  for (const candidate of candidates) {
    const metadata = await candidate.evaluate((input) => {
      const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
      const visible = (element) => Boolean(
        element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length),
      );
      if (!visible(input)
        && !visible(input.closest("label"))
        && !visible(input.closest(".ant-checkbox-wrapper"))) {
        return { label: "", section: "" };
      }
      const root = input.closest(".ant-modal") || input.ownerDocument.body;
      const ccLabel = [...root.querySelectorAll("*")].find((element) => (
        visible(element)
        && element.children.length === 0
        && clean(element.textContent) === "抄送（C）"
      ));
      const ccTop = ccLabel?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
      return {
        label: clean(
          input.getAttribute("aria-label")
          || input.closest("label")?.innerText
          || input.closest(".ant-checkbox-wrapper")?.innerText
          || input.parentElement?.parentElement?.innerText,
        ),
        section: input.getBoundingClientRect().top < ccTop ? "recipients" : "cc",
      };
    });
    if (metadata.label === text(label) && (!section || metadata.section === section)) matches.push(candidate);
  }
  if (matches.length !== 1) {
    throw runnerError("OPERATION_CONTENT_RECIPIENT_CONTROL_NOT_UNIQUE", `人员目录“${label}”在${section === "cc" ? "抄送" : "收件人"}区域必须唯一，实际 ${matches.length} 个`);
  }
  return matches[0];
}

export async function waitForDirectoryGroupCheckbox(
  page,
  dialog,
  label,
  section,
  { attempts = 30, intervalMs = 100 } = {},
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await checkboxByLabel(dialog, label, section);
    } catch (error) {
      lastError = error;
      if (error?.code !== "OPERATION_CONTENT_RECIPIENT_CONTROL_NOT_UNIQUE"
        || !/实际 0 个/.test(text(error?.message))) throw error;
      if (typeof page.waitForTimeout === "function") await page.waitForTimeout(intervalMs);
    }
  }
  throw runnerError(
    "OPERATION_CONTENT_DIRECTORY_GROUP_NOT_RENDERED",
    `人员目录分组“${label}”未在${section === "cc" ? "抄送" : "收件人"}区域加载完成：${text(lastError?.message)}`,
  );
}

async function ensureDirectoryGroupExpanded(page, dialog, section, directoryGroup) {
  let group = await waitForDirectoryGroupCheckbox(page, dialog, directoryGroup.name, section);
  if (!await group.isChecked()) await group.click();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    group = await checkboxByLabel(dialog, directoryGroup.name, section);
    const visibleEmails = new Set((await visibleCheckboxEntries(dialog))
      .filter((entry) => entry.section === section)
      .map(entryEmail)
      .filter(Boolean));
    if (await group.isChecked()
      && directoryGroup.emails.every((email) => visibleEmails.has(email))) return;
    if (typeof page.waitForTimeout === "function") await page.waitForTimeout(100);
  }
  throw runnerError(
    "OPERATION_CONTENT_DIRECTORY_GROUP_NOT_EXPANDED",
    `人员目录分组“${directoryGroup.name}”勾选后未显示目标人员`,
  );
}

async function clearVisibleDirectorySelections(dialog) {
  const entries = await visibleCheckboxEntries(dialog);
  for (const entry of entries.filter((item) => item.checked && entryEmail(item))) {
    await (await checkboxByLabel(dialog, entry.label, entry.section)).uncheck();
  }
  for (const entry of entries.filter((item) => item.checked && !entryEmail(item))) {
    await (await checkboxByLabel(dialog, entry.label, entry.section)).uncheck();
  }
}

async function selectEmailTargets(page, dialog, section, expectedEmails, directoryGroups) {
  const expected = new Set(expectedEmails);
  if (!expected.size) return;
  const selected = new Set();

  const selectVisible = async (groupEmails) => {
    const pending = new Set(groupEmails);
    const entries = await visibleCheckboxEntries(dialog);
    for (const entry of entries) {
      const email = entryEmail(entry);
      if (entry.section !== section || !pending.has(email) || selected.has(email)) continue;
      const checkbox = await checkboxByLabel(dialog, entry.label, section);
      if (!entry.checked) await checkbox.check();
      selected.add(email);
    }
  };

  for (const directoryGroup of directoryGroups) {
    await ensureDirectoryGroupExpanded(page, dialog, section, directoryGroup);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await selectVisible(directoryGroup.emails);
      if (directoryGroup.emails.every((email) => selected.has(email))) break;
      if (typeof page.waitForTimeout === "function") await page.waitForTimeout(100);
    }
    const missingFromGroup = directoryGroup.emails.filter((email) => !selected.has(email));
    if (missingFromGroup.length) {
      throw runnerError(
        "OPERATION_CONTENT_RECIPIENT_NOT_FOUND_IN_GROUP",
        `人员目录分组“${directoryGroup.name}”未找到：${missingFromGroup.join("、")}`,
      );
    }
  }

  const missing = [...expected].filter((email) => !selected.has(email));
  if (missing.length) {
    throw runnerError(
      "OPERATION_CONTENT_RECIPIENT_NOT_FOUND",
      `${section === "cc" ? "抄送" : "收件人"}目录未找到：${missing.join("、")}`,
    );
  }
}

async function readCheckedDispatchTarget(dialog) {
  const selected = { recipients: [], cc: [] };
  for (const entry of await visibleCheckboxEntries(dialog)) {
    const email = entryEmail(entry);
    if (entry.checked && email) selected[entry.section].push(email);
  }
  selected.recipients = [...new Set(selected.recipients)];
  selected.cc = [...new Set(selected.cc)];
  return selected;
}

function assertExactEmails(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw runnerError(
      "OPERATION_CONTENT_RECIPIENT_READBACK_MISMATCH",
      `${label}回读不一致：预期 ${expectedSorted.join("、") || "无"}，实际 ${actualSorted.join("、") || "无"}`,
    );
  }
}

export function operationContentSendRecordsFromVisibleRaw(raw = {}) {
  const timelineRecords = normalizeOperationTaskSendRecords(
    (raw.timelineSendTexts || []).flatMap((value) => {
      const record = operationTaskTimelineSendRecord(value);
      return record ? [record] : [];
    }),
  );
  if (timelineRecords.length) return timelineRecords;
  const tableRows = Array.isArray(raw.sendRecordRows) ? raw.sendRecordRows : null;
  if (tableRows?.length) {
    if (text(tableRows[0]?.[0]) !== "发送时间"
      || text(tableRows[0]?.[1]) !== "变更内容") {
      throw runnerError("OPERATION_CONTENT_SEND_RECORD_INVALID", "内容任务单发送记录表头无效");
    }
    return normalizeOperationTaskSendRecords(tableRows.slice(1).map((row) => ({
      sentAt: row?.[0],
      type: row?.[1],
    })));
  }
  return [];
}

export async function readOperationContentTaskSendRecords(page) {
  const raw = await page.locator("body").evaluate((node) => {
    const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
    const visible = (element) => Boolean(
      element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length),
    );
    const rows = (table) => [...table.querySelectorAll("tr")]
      .filter(visible)
      .map((row) => [...row.querySelectorAll("th, td")].map((cell) => clean(cell.textContent)));
    const tables = [...node.querySelectorAll("table")].filter(visible);
    const sendTable = tables.find((table) => {
      const first = rows(table)[0] || [];
      return first[0] === "发送时间" && first[1] === "变更内容";
    });
    return {
      sendRecordRows: sendTable ? rows(sendTable) : null,
      timelineSendTexts: [...node.querySelectorAll(".ant-timeline-item-content")]
        .filter(visible)
        .map((element) => clean(element.textContent)),
    };
  });
  return operationContentSendRecordsFromVisibleRaw(raw);
}

async function waitForOperationContentSendRecord(readRecords, attempt, options = {}) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxChecks = Number(options.sendRecordMaxChecks || 30);
  const intervalMs = Number(options.sendRecordPollMs || 1000);
  for (let index = 0; index < maxChecks; index += 1) {
    const record = findOperationTaskAttemptSendRecord(await readRecords(), attempt);
    if (record) return record;
    if (index + 1 < maxChecks) await sleep(intervalMs);
  }
  return null;
}

export async function confirmOperationContentTaskSheet(
  page,
  mailDialog,
  finalConfirm,
  options = {},
) {
  const now = options.now || Date.now;
  if (typeof page?.waitForResponse !== "function") {
    throw runnerError(
      "OPERATION_CONTENT_DISPATCH_RESPONSE_UNAVAILABLE",
      "当前运控浏览器无法核验内容任务单发送接口",
      503,
    );
  }
  const responsePromise = page.waitForResponse((response) => {
    try {
      return response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/batch/send_item";
    } catch {
      return false;
    }
  }, { timeout: 20000 });
  const attempt = {
    kind: options.kind === "resend" ? "resend" : "initial",
    startedAt: new Date(now()).toISOString(),
    beforeSendRecords: normalizeOperationTaskSendRecords(options.beforeSendRecords || []),
  };
  try {
    await finalConfirm.click();
  } catch (error) {
    responsePromise.catch(() => {});
    throw runnerError(
      "OPERATION_CONTENT_FINAL_CONFIRM_FAILED",
      `点击内容任务单最终确定失败：${error?.message || String(error)}`,
    );
  }
  let response = null;
  try {
    response = await responsePromise;
  } catch {
    response = null;
  }
  let payload = {};
  if (response) {
    try {
      payload = await response.json();
    } catch {}
  }
  await mailDialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  let sendRecord = null;
  try {
    sendRecord = typeof options.readSendRecords === "function"
      ? await waitForOperationContentSendRecord(options.readSendRecords, attempt, options)
      : null;
  } catch (error) {
    throw runnerError(
      "OPERATION_CONTENT_DISPATCH_RECONCILIATION_REQUIRED",
      `已点击内容任务单最终确定，但读取运控发送记录失败；禁止重复发送：${error?.message || String(error)}`,
    );
  }
  if (sendRecord) {
    return {
      status: "sent",
      confirmed: true,
      responseVerified: Number(payload?.code) === 10,
      responseCode: Number(payload?.code) || null,
      responseMessage: text(payload?.message),
      sendRecord,
      attemptStartedAt: attempt.startedAt,
      sentAt: sendRecord.sentAt,
    };
  }
  if (response && Number(payload?.code) !== 10) {
    throw runnerError(
      "OPERATION_CONTENT_DISPATCH_FAILED",
      `内容任务单发送失败：${text(payload?.message) || `返回码 ${payload?.code ?? "未知"}`}`,
    );
  }
  throw runnerError(
    "OPERATION_CONTENT_DISPATCH_RECONCILIATION_REQUIRED",
    "已点击内容任务单最终确定，但未回读到本次运控发送记录；禁止重复发送",
  );
}

export async function fillOperationContentTaskChangeSummary(page, value) {
  const changeSummary = text(value);
  if (!changeSummary) {
    throw runnerError(
      "OPERATION_CONTENT_CHANGE_SUMMARY_REQUIRED",
      "重新发送内容任务单必须填写变更内容",
      400,
    );
  }
  if (changeSummary.length > 4000) {
    throw runnerError(
      "OPERATION_CONTENT_CHANGE_SUMMARY_TOO_LONG",
      "内容任务单变更内容不能超过 4000 个字符",
      400,
    );
  }
  const summaryLocator = page.locator(
    'textarea[placeholder="请填写任务单变更内容"], input[placeholder="请填写任务单变更内容"]',
  );
  try {
    await summaryLocator.first().waitFor({ state: "visible", timeout: 10000 });
  } catch {
    throw runnerError(
      "OPERATION_CONTENT_CHANGE_SUMMARY_CONTROL_MISSING",
      "运控未出现内容任务单变更内容输入框，禁止继续发送",
    );
  }
  const summaryInput = await uniqueVisible(summaryLocator, "内容任务单变更内容");
  await summaryInput.fill(changeSummary);
  if (text(await summaryInput.inputValue()) !== changeSummary) {
    throw runnerError(
      "OPERATION_CONTENT_CHANGE_SUMMARY_READBACK_MISMATCH",
      "内容任务单变更内容回读不一致",
    );
  }
  const changeDialog = await uniqueVisible(
    page.getByRole("dialog").filter({ hasText: "填写变更内容" }),
    "内容任务单变更内容弹窗",
  );
  const next = await uniqueVisible(
    changeDialog.getByRole("button", { name: "下一步", exact: true }),
    "内容任务单变更内容下一步按钮",
  );
  await next.click();
  return changeSummary;
}

export async function waitForOperationContentMailDialog(page) {
  const mailDialogs = page.getByRole("dialog").filter({
    hasText: /邮件发送|填写收件人邮箱/,
  });
  try {
    await mailDialogs.first().waitFor({ state: "visible", timeout: 10000 });
  } catch {
    throw runnerError(
      "OPERATION_CONTENT_MAIL_DIALOG_MISSING",
      "运控未出现内容任务单收件人弹窗，禁止继续发送",
    );
  }
  const visibleDialogs = await visibleLocators(mailDialogs);
  if (visibleDialogs.length !== 1) {
    throw runnerError(
      "OPERATION_CONTENT_MAIL_DIALOG_NOT_UNIQUE",
      `内容任务单收件人弹窗必须唯一，实际 ${visibleDialogs.length} 个`,
    );
  }
  return visibleDialogs[0];
}

export async function prepareOperationContentTaskSheet(draft = {}, targetInput = {}, options = {}) {
  if (!draft?.batch?.code || !draft?.batch?.name || !draft?.batch?.detailUrl) {
    throw runnerError("OPERATION_CONTENT_DRAFT_INVALID", "缺少完整的运营批次代码、名称或详情地址", 400);
  }
  const target = normalizeOperationContentDispatchTarget(targetInput);
  if (!target.projectCode) {
    throw runnerError("OPERATION_CONTENT_PROJECT_CODE_REQUIRED", "缺少内容任务对应的项目编码", 400);
  }
  const page = options.page;
  if (!page) throw runnerError("OPERATION_CONTENT_PAGE_REQUIRED", "缺少当前运控批次页面", 503);
  const bodyText = await page.locator("body").innerText();
  if (!bodyText.includes(draft.batch.code) || !bodyText.includes(draft.batch.name)) {
    throw runnerError(
      "OPERATION_CONTENT_BATCH_IDENTITY_MISMATCH",
      `当前运控页面不是目标批次 ${draft.batch.code} / ${draft.batch.name}`,
    );
  }

  const contentTab = await uniqueVisible(
    page.getByRole("tab", { name: "内容", exact: true }),
    "批次详情页内容标签",
  );
  if (text(await contentTab.getAttribute("aria-selected")) !== "true") await contentTab.click();
  const outerSend = await uniqueVisible(
    page.getByRole("button", { name: "发送任务单", exact: true }),
    "内容页发送任务单按钮",
  );
  await outerSend.click();
  const taskDialog = page.getByRole("dialog").filter({ hasText: "任务单发送需满足以下条件" });
  await taskDialog.waitFor({ state: "visible", timeout: 10000 });
  if (await taskDialog.count() !== 1) {
    throw runnerError("OPERATION_CONTENT_TASK_DIALOG_NOT_UNIQUE", `内容任务单弹窗必须唯一，实际 ${await taskDialog.count()} 个`);
  }
  await taskDialog.getByText(target.projectCode, { exact: false }).waitFor({
    state: "visible",
    timeout: 10000,
  });
  const taskText = await taskDialog.innerText();
  const trialStart = text(draft.configuration?.closureStart);
  const trialEnd = text(draft.configuration?.closureEnd);
  const trialStartMatch = trialStart.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  const trialEndMatch = trialEnd.match(/(\d{2}:\d{2})(?::\d{2})?$/);
  const expectedTrialRange = trialStartMatch && trialEndMatch
    ? `${trialStartMatch[1]} ${trialStartMatch[2]}~${trialEndMatch[1]}`
    : "";
  for (const [label, value] of [
    ["项目编码", target.projectCode],
    ["批次名称", draft.batch.name],
    ...(expectedTrialRange ? [["封场或试考时间", expectedTrialRange]] : []),
    ...draft.subjects.map((subject) => ["科目", subject.name]),
  ]) {
    if (!value || !taskText.includes(value)) {
      throw runnerError("OPERATION_CONTENT_TASK_IDENTITY_MISMATCH", `内容任务单${label}不匹配：${value || "未提供"}`);
    }
  }
  const beforeSendRecords = await readOperationContentTaskSendRecords(page);
  const sendKind = options.sendKind === "resend"
    ? "resend"
    : options.sendKind === "verification"
      ? "verification"
      : "initial";
  const existingInitialSend = verifiedInitialOperationTaskSendRecord(beforeSendRecords);
  if (sendKind !== "resend" && existingInitialSend) {
    return {
      status: "already_sent",
      confirmed: true,
      externallyVerified: true,
      sendRecord: existingInitialSend,
      sentAt: existingInitialSend.sentAt,
      batch: { code: draft.batch.code, name: draft.batch.name },
      projectCode: target.projectCode,
      recipients: [],
      cc: [],
      checkpoints: [
        "opened_exact_batch",
        "content_task_sheet_verified",
        "initial_send_record_verified",
      ],
    };
  }
  if (sendKind === "verification") {
    throw runnerError(
      "OPERATION_CONTENT_DISPATCH_RECONCILIATION_REQUIRED",
      "平台存在内容任务单发送记录，但运控未回读到唯一首次发送记录；禁止重复发送",
    );
  }
  if (sendKind === "initial" && beforeSendRecords.length) {
    throw runnerError(
      "OPERATION_CONTENT_INITIAL_SEND_CONFLICT",
      "运控已存在内容任务单发送记录，但无法确认唯一首次发送记录；禁止再次首次发送",
    );
  }
  if (sendKind === "resend" && !existingInitialSend) {
    throw runnerError(
      "OPERATION_CONTENT_RESEND_WITHOUT_INITIAL_RECORD",
      "运控未回读到唯一首次发送记录，禁止重新发送内容任务单",
    );
  }
  const innerSend = await uniqueVisible(
    taskDialog.getByRole("button", { name: "发送任务单", exact: true }),
    "内容任务单内置发送按钮",
  );
  await innerSend.click();
  const changeSummary = sendKind === "resend"
    ? await fillOperationContentTaskChangeSummary(page, options.changeSummary)
    : "";
  const mailDialog = await waitForOperationContentMailDialog(page);

  await clearVisibleDirectorySelections(mailDialog);
  await selectEmailTargets(
    page,
    mailDialog,
    "recipients",
    target.recipients,
    target.directoryGroups.recipients,
  );
  await selectEmailTargets(page, mailDialog, "cc", target.cc, target.directoryGroups.cc);
  const selected = await readCheckedDispatchTarget(mailDialog);
  assertExactEmails(selected.recipients, target.recipients, "内容任务单收件人");
  assertExactEmails(selected.cc, target.cc, "内容任务单抄送");
  const finalConfirm = mailDialog.getByRole("button", { name: /确\s*定/, exact: true });
  if (await finalConfirm.count() !== 1) {
    throw runnerError("OPERATION_CONTENT_FINAL_CONFIRM_NOT_UNIQUE", `最终确定按钮必须唯一，实际 ${await finalConfirm.count()} 个`);
  }
  if (options.confirm === true) {
    const confirmed = await confirmOperationContentTaskSheet(page, mailDialog, finalConfirm, {
      ...options,
      kind: sendKind,
      beforeSendRecords,
      readSendRecords: () => readOperationContentTaskSendRecords(page),
    });
    return {
      ...confirmed,
      batch: { code: draft.batch.code, name: draft.batch.name },
      projectCode: target.projectCode,
      ...selected,
      ...(changeSummary ? { changeSummary } : {}),
      checkpoints: [
        "opened_exact_batch",
        "content_task_sheet_verified",
        ...(changeSummary ? ["change_summary_filled"] : []),
        "recipients_selected",
        "final_confirm_clicked",
        "send_item_response_verified",
      ],
    };
  }
  return {
    status: "awaiting_confirmation",
    confirmed: false,
    batch: { code: draft.batch.code, name: draft.batch.name },
    projectCode: target.projectCode,
    ...selected,
    ...(changeSummary ? { changeSummary } : {}),
    checkpoints: [
      "opened_exact_batch",
      "content_task_sheet_verified",
      ...(changeSummary ? ["change_summary_filled"] : []),
      "recipients_selected",
      "stopped_before_final_confirm",
    ],
  };
}

export async function syncOperationContent(draft = {}, options = {}) {
  if (!draft?.batch?.code || !draft?.batch?.name || !draft?.batch?.detailUrl) {
    throw runnerError("OPERATION_CONTENT_DRAFT_INVALID", "缺少完整的运营批次代码、名称或详情地址", 400);
  }
  if (Array.isArray(draft.warnings) && draft.warnings.length) {
    throw runnerError("OPERATION_CONTENT_DRAFT_INCOMPLETE", draft.warnings.map((item) => item.message).join("；"), 400);
  }
  const completeDraft = assertOperationContentDraftComplete(draft);
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
  const syncResult = {
    status: "success",
    contentReady: true,
    batch: completeDraft.batch,
    changed: changes,
    checkpoints: [
      "opened_exact_batch",
      "batch_code_and_name_verified",
      "content_draft_complete",
      ...(changes.configuration ? ["configuration_saved"] : []),
      ...(changes.subjects ? ["subjects_saved"] : []),
      "content_fields_ready",
    ],
  };
  if (!options.dispatchTarget) return syncResult;
  const dispatch = await prepareOperationContentTaskSheet(draft, options.dispatchTarget, {
    page,
    confirm: options.confirmDispatch === true,
    sendKind: options.sendKind,
    changeSummary: options.changeSummary,
    now: options.now,
  });
  return {
    ...syncResult,
    dispatch,
    checkpoints: [...syncResult.checkpoints, ...dispatch.checkpoints],
  };
}
