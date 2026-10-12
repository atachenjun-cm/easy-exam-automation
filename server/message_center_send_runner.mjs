const DEFAULT_MESSAGE_CENTER_ORIGIN = "https://yygl.ata.net.cn";
const MESSAGE_CENTER_BATCH_STORAGE_KEY = "messageCenterCurrentBatchId";

export class MessageCenterSendPreparationError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizedPhone(value = "") {
  return text(value).replace(/[\s()-]/g, "");
}

export function normalizeMessageCenterSendPreparation(input = {}, {
  allowedOrigins = new Set([DEFAULT_MESSAGE_CENTER_ORIGIN]),
} = {}) {
  let parsed;
  try {
    parsed = new URL(text(input.baseUrl));
  } catch {
    throw new MessageCenterSendPreparationError(
      "message_center_url_invalid",
      "信息触达平台页面地址不正确。",
      400,
    );
  }
  const originAllowed = allowedOrigins instanceof Set && allowedOrigins.has(parsed.origin);
  if (!originAllowed || parsed.username || parsed.password) {
    throw new MessageCenterSendPreparationError(
      "message_center_url_invalid",
      "信息触达平台页面地址未获本机助手允许。",
      400,
    );
  }

  const batchId = text(input.batchId);
  const batchName = text(input.batchName);
  const taskName = text(input.taskName);
  const smsContent = text(input.smsContent);
  const expectedCount = Number(input.expectedCount);
  const expectedPhones = Array.from(new Set(
    (Array.isArray(input.expectedPhones) ? input.expectedPhones : [])
      .map(normalizedPhone)
      .filter(Boolean),
  ));
  if (!/^\d+$/.test(batchId) || !batchName || batchName.length > 200) {
    throw new MessageCenterSendPreparationError(
      "message_center_batch_invalid",
      "缺少有效的信息触达批次。",
      400,
    );
  }
  if (!taskName || taskName.length > 80) {
    throw new MessageCenterSendPreparationError(
      "message_center_task_name_invalid",
      "发送任务名称不能为空且不能超过 80 个字符。",
      400,
    );
  }
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 100000) {
    throw new MessageCenterSendPreparationError(
      "message_center_roster_invalid",
      "信息触达考生人数无效。",
      400,
    );
  }
  if (!expectedPhones.length || expectedPhones.some((phone) => !/^\+?\d{7,20}$/.test(phone))) {
    throw new MessageCenterSendPreparationError(
      "message_center_phone_invalid",
      "没有可用于短信发送的有效考生手机号。",
      400,
    );
  }
  if (!smsContent || smsContent.length > 500) {
    throw new MessageCenterSendPreparationError(
      "message_center_sms_invalid",
      "短信正文不能为空且不能超过 500 个字符。",
      400,
    );
  }
  return {
    baseUrl: `${parsed.origin}/#/MessageCampaigns`,
    batchId,
    batchName,
    taskName,
    expectedCount,
    expectedPhones,
    smsContent,
  };
}

function messageCenterPage(context, baseUrl) {
  const origin = new URL(baseUrl).origin;
  return context.pages().find((page) => {
    try {
      const current = new URL(page.url());
      return current.origin === origin && current.hash.startsWith("#/MessageCampaigns");
    } catch {
      return false;
    }
  }) || null;
}

async function waitForPlatformPage(page) {
  try {
    await page.getByRole("heading", { name: "名单与发送", exact: true }).waitFor({
      state: "visible",
      timeout: 15000,
    });
  } catch {
    throw new MessageCenterSendPreparationError(
      "message_center_login_required",
      "信息触达平台尚未登录，请在打开的专用 Chrome 中登录后重试。",
      409,
    );
  }
}

async function switchMatches(control, enabled) {
  try {
    return await control.isChecked() === enabled;
  } catch {
    return false;
  }
}

async function waitForSwitchState(page, control, enabled, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await switchMatches(control, enabled)) return true;
    await page.waitForTimeout(100);
  }
  return switchMatches(control, enabled);
}

async function setSwitch(page, section, enabled, label) {
  const control = section.getByRole("switch");
  const checked = await control.isChecked();
  if (await control.isDisabled()) {
    if (checked === enabled) return;
    throw new MessageCenterSendPreparationError(
      "message_center_channel_unavailable",
      `信息触达平台的${label}渠道未配置或当前账号无权限。`,
      409,
    );
  }
  if (checked !== enabled) {
    await control.waitFor({ state: "attached", timeout: 5000 });
    // Element Plus drawers animate their contents. Dispatching the control's
    // native click avoids Playwright's stability wait while preserving Vue's
    // normal change event and application state update.
    await control.evaluate((element) => element.click());
  }
  if (!await waitForSwitchState(page, control, enabled)) {
    throw new MessageCenterSendPreparationError(
      "message_center_channel_state_failed",
      `未能将${label}渠道切换为${enabled ? "开启" : "关闭"}。`,
      409,
    );
  }
}

async function selectedSmsTemplateLabels(smsSection) {
  return (await smsSection.locator(".el-select__selected-item:visible").allTextContents())
    .map((value) => text(value))
    .filter((value) => value && value !== "选择短信模板（可选）");
}

async function clearSmsTemplate(smsSection) {
  const input = smsSection.getByPlaceholder("选择短信模板（可选）");
  if (!(await selectedSmsTemplateLabels(smsSection)).length) return;
  const select = input.locator("xpath=ancestor::div[contains(@class, 'el-select')][1]");
  await select.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  });
  const clear = select.locator(".el-select__clear").first();
  if (await clear.count()) await clear.evaluate((element) => element.click());
  if ((await selectedSmsTemplateLabels(smsSection)).length) {
    await input.evaluate((element) => element.focus());
    await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await input.press("Backspace");
    await input.press("Escape");
  }
  if ((await selectedSmsTemplateLabels(smsSection)).length) {
    throw new MessageCenterSendPreparationError(
      "message_center_sms_template_clear_failed",
      "短信模板仍处于选中状态，已停止在发送前，请手动清空模板后重试。",
      409,
    );
  }
}

function parseVisibleNumber(value = "") {
  const matched = text(value).match(/\d[\d,]*/);
  return matched ? Number(matched[0].replaceAll(",", "")) : Number.NaN;
}

function messageCenterTestTaskName(taskName = "") {
  const suffix = "_测试发送";
  return `${text(taskName).slice(0, 80 - suffix.length)}${suffix}`;
}

async function sendSmsTestToCurrentAccount(page, preparation) {
  const openTest = page.getByRole("button", { name: "测试发送", exact: true });
  await openTest.waitFor({ state: "visible", timeout: 10000 });
  if (!await openTest.isEnabled()) {
    throw new MessageCenterSendPreparationError(
      "message_center_test_send_unavailable",
      "信息触达平台当前账号无法测试发送短信，已停止在正式发送确认前。",
      409,
    );
  }
  await openTest.click();

  const dialog = page.getByRole("dialog", { name: "测试发送" });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const smsTab = dialog.getByRole("tab", { name: "短信", exact: true });
  if (await smsTab.getAttribute("aria-selected") !== "true") await smsTab.click();

  const testTaskName = messageCenterTestTaskName(preparation.taskName);
  const taskNameInput = dialog.getByRole("textbox", { name: /测试任务名称/ });
  const smsContentInput = dialog.getByPlaceholder("请输入实际发送给自己的短信内容");
  await taskNameInput.fill(testTaskName);
  await smsContentInput.fill(preparation.smsContent);
  if (text(await taskNameInput.inputValue()) !== testTaskName
    || text(await smsContentInput.inputValue()) !== preparation.smsContent) {
    throw new MessageCenterSendPreparationError(
      "message_center_test_send_content_failed",
      "未能写入测试短信任务名称或正文，已停止在正式发送确认前。",
      409,
    );
  }

  const sendToSelf = dialog.getByRole("button", { name: "发送给自己", exact: true });
  try {
    await sendToSelf.click({ timeout: 10000 });
  } catch {
    throw new MessageCenterSendPreparationError(
      "message_center_test_sms_recipient_unavailable",
      "信息触达平台未能启用“发送给自己”，请核对当前登录账号手机号和页面提示。已停止在正式发送确认前。",
      409,
    );
  }

  const successNotice = page.locator(".el-message--success, .el-notification--success").first();
  const errorNotice = page.locator(".el-message--error, .el-notification--error").first();
  let outcome = "";
  try {
    outcome = await Promise.race([
      dialog.waitFor({ state: "hidden", timeout: 20000 }).then(() => "closed"),
      successNotice.waitFor({ state: "visible", timeout: 20000 }).then(() => "success"),
      errorNotice.waitFor({ state: "visible", timeout: 20000 }).then(() => "error"),
    ]);
  } catch {
    throw new MessageCenterSendPreparationError(
      "message_center_test_send_unknown",
      "测试短信提交结果不明确，已停止继续。请先在信息触达平台任务历史中确认，避免重复测试发送。",
      409,
    );
  }
  if (outcome === "error") {
    throw new MessageCenterSendPreparationError(
      "message_center_test_send_failed",
      `测试短信发送失败：${text(await errorNotice.innerText()) || "请检查短信平台提示"}。已停止进入正式发送确认页。`,
      409,
    );
  }
  if (outcome === "success" && await dialog.isVisible()) {
    try {
      await dialog.waitFor({ state: "hidden", timeout: 2000 });
    } catch {
      if (await dialog.isVisible()) {
        const close = dialog.getByRole("button", { name: "关闭此对话框" });
        const dismiss = await close.count()
          ? close
          : dialog.getByRole("button", { name: "取消", exact: true });
        try {
          await dismiss.click({ timeout: 3000 });
        } catch (error) {
          if (await dialog.isVisible()) throw error;
        }
        await dialog.waitFor({ state: "hidden", timeout: 5000 });
      }
    }
  }
  return { status: "sent", taskName: testTaskName };
}

export async function openMessageCenterSendConfirmation(input = {}, {
  context,
  allowedOrigins,
} = {}) {
  if (!context?.pages || !context?.newPage) {
    throw new TypeError("A Playwright browser context is required");
  }
  const preparation = normalizeMessageCenterSendPreparation(input, { allowedOrigins });
  let page = messageCenterPage(context, preparation.baseUrl);
  if (!page) page = await context.newPage();
  await page.goto(preparation.baseUrl, { waitUntil: "domcontentloaded" });
  await waitForPlatformPage(page);
  await page.evaluate(({ key, batchId }) => sessionStorage.setItem(key, batchId), {
    key: MESSAGE_CENTER_BATCH_STORAGE_KEY,
    batchId: preparation.batchId,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForPlatformPage(page);

  try {
    await page.getByRole("heading", { name: preparation.batchName, exact: true }).waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.getByText(`共 ${preparation.expectedCount.toLocaleString()} 条`, { exact: true }).waitFor({
      state: "visible",
      timeout: 10000,
    });
  } catch {
    throw new MessageCenterSendPreparationError(
      "message_center_batch_mismatch",
      "信息触达批次名称或考生人数与自动配置台不一致，已停止发送前准备。",
      409,
    );
  }

  if (preparation.expectedCount <= 20) {
    const rows = await page.locator(".el-table__body-wrapper tbody tr").allTextContents();
    const visible = rows.join("\n").replace(/[\s()-]/g, "");
    const missing = preparation.expectedPhones.filter((phone) => !visible.includes(phone));
    if (missing.length) {
      throw new MessageCenterSendPreparationError(
        "message_center_phone_mismatch",
        "信息触达批次中的手机号与自动配置台不一致，已停止发送前准备。",
        409,
      );
    }
  }

  const testSend = await sendSmsTestToCurrentAccount(page, preparation);

  const selectAll = page.getByRole("button", { name: "选择全部筛选结果", exact: true });
  if (await selectAll.isVisible()) await selectAll.click();
  const selection = page.locator(".mc-selection-copy");
  await selection.waitFor({ state: "visible", timeout: 10000 });
  if (!text(await selection.innerText()).includes(`已选择全部筛选结果 ${preparation.expectedCount.toLocaleString()} 人`)) {
    throw new MessageCenterSendPreparationError(
      "message_center_selection_mismatch",
      "信息触达平台未能选中当前批次全部考生，已停止发送前准备。",
      409,
    );
  }
  await page.getByRole("button", { name: "短信 / 邮件", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "发送信息" });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const taskNameInput = dialog.getByText("任务名称", { exact: true }).locator("xpath=following::input[1]");
  await taskNameInput.waitFor({ state: "visible", timeout: 5000 });
  await taskNameInput.fill(preparation.taskName);
  if (text(await taskNameInput.inputValue()) !== preparation.taskName) {
    throw new MessageCenterSendPreparationError(
      "message_center_task_name_failed",
      "未能写入发送任务名称，已停止发送前准备。",
      409,
    );
  }
  const smsChannel = dialog.locator(".channel-switch").filter({ hasText: "短信" });
  const emailChannel = dialog.locator(".channel-switch").filter({ hasText: "邮件" });
  await setSwitch(page, smsChannel, true, "短信");
  await setSwitch(page, emailChannel, false, "邮件");

  const smsSection = dialog.locator(".channel-config").filter({ hasText: "短信内容" });
  await clearSmsTemplate(smsSection);
  await smsSection.getByPlaceholder("请输入短信文案，支持模板变量").fill(preparation.smsContent);

  const smsPreview = dialog.locator(".preview-grid > div").filter({ hasText: "可发短信" }).locator("strong");
  const availableSms = parseVisibleNumber(await smsPreview.innerText());
  if (availableSms !== preparation.expectedPhones.length) {
    throw new MessageCenterSendPreparationError(
      "message_center_sms_recipient_mismatch",
      `信息触达平台显示可发短信 ${Number.isFinite(availableSms) ? availableSms : "未知"} 人，自动配置台为 ${preparation.expectedPhones.length} 人，已停止发送前准备。`,
      409,
    );
  }

  const confirm = dialog.getByRole("button", { name: "确认发送", exact: true });
  await confirm.waitFor({ state: "visible", timeout: 10000 });
  if (!await confirm.isEnabled()) {
    throw new MessageCenterSendPreparationError(
      "message_center_confirmation_unavailable",
      "发送确认页尚未准备完成，请核对页面提示后重试。",
      409,
    );
  }
  await page.bringToFront();
  return {
    status: "ready",
    batchId: preparation.batchId,
    taskName: preparation.taskName,
    selectedCount: preparation.expectedCount,
    availableSms,
    testSend,
    pageUrl: page.url(),
  };
}
