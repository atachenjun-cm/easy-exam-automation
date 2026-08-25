import fs from "node:fs/promises";
import path from "node:path";

import { chromium as defaultChromium } from "playwright";

export const EASY_EXAM_ARCHIVE_SCREENSHOT_LIMIT_BYTES = 250 * 1024;
export const EASY_EXAM_EXAM_LIST_URL = "https://eztest.org/manager/schedule/session/list/all/";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeFilePart(value, fallback = "exam") {
  return text(value)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.+$/g, "")
    .slice(0, 80) || fallback;
}

export function archiveScreenshotTargets(task = {}) {
  return (task.sessions || [])
    .filter((session) => session?.sessionType === "formal" && text(session.session_id))
    .slice(0, 10)
    .map((session) => ({
      sessionId: text(session.session_id),
      sessionName: text(session.name || task.projectName || "正式考试"),
    }));
}

export function archiveScreenshotFileName(taskId, target = {}) {
  return `${safeFilePart(taskId, "task")}-${safeFilePart(target.sessionId, "session")}-${safeFilePart(target.sessionName, "formal-exam")}-archive.jpg`;
}

export async function captureJpegWithinLimit(element, options = {}) {
  const maxBytes = Number(options.maxBytes || EASY_EXAM_ARCHIVE_SCREENSHOT_LIMIT_BYTES);
  const qualities = options.qualities || [82, 72, 62, 52, 42, 32, 24];
  let lastBuffer = null;
  for (const quality of qualities) {
    const buffer = await element.screenshot({ type: "jpeg", quality, animations: "disabled" });
    lastBuffer = buffer;
    if (buffer.length <= maxBytes) return { buffer, quality };
  }
  const error = new Error(`易考考试截图压缩后仍超过 ${Math.floor(maxBytes / 1024)}KB（当前 ${Math.ceil((lastBuffer?.length || 0) / 1024)}KB）`);
  error.code = "ARCHIVE_SCREENSHOT_TOO_LARGE";
  throw error;
}

async function isLoginPage(page) {
  if (/\/accounts\/login|\/manager\/login/i.test(page.url())) return true;
  return await page.locator("input[type='password']").count() > 0;
}

async function firstVisible(locators, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const locator of locators) {
      try {
        if (await locator.count() && await locator.first().isVisible()) return locator.first();
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

async function loginToEasyExam(page, login = {}) {
  if (!(await isLoginPage(page))) return;
  if (!text(login.username) || !String(login.password || "")) {
    const error = new Error("缺少易考账号或密码，无法自动截取正式考试页面");
    error.code = "ARCHIVE_SCREENSHOT_LOGIN_MISSING";
    throw error;
  }
  const userInput = await firstVisible([
    page.locator("input[placeholder*='手机或邮箱']"),
    page.locator("input[placeholder*='邮箱']"),
    page.locator("input[placeholder*='账号']"),
    page.locator("input[type='email']"),
    page.locator("input[type='text']"),
  ]);
  const passwordInput = await firstVisible([page.locator("input[type='password']")]);
  if (!userInput || !passwordInput) {
    const error = new Error("未识别到易考登录页的账号或密码输入框");
    error.code = "ARCHIVE_SCREENSHOT_LOGIN_FORM_MISSING";
    throw error;
  }
  await userInput.fill(text(login.username));
  await passwordInput.fill(String(login.password || ""));
  const consent = page.locator("input[type='checkbox']").first();
  if (await consent.count()) {
    try {
      if (!(await consent.isChecked())) await consent.check();
    } catch {}
  }
  const submit = await firstVisible([
    page.getByRole("button", { name: /^登\s*录$/ }),
    page.locator("button[type='submit']"),
    page.locator("input[type='submit']"),
  ], 3000);
  if (submit) await submit.click();
  else await passwordInput.press("Enter");
  await page.waitForTimeout(800);
  const deadline = Date.now() + 15_000;
  let consecutiveReadyChecks = 0;
  while (Date.now() < deadline) {
    if (await isLoginPage(page)) consecutiveReadyChecks = 0;
    else consecutiveReadyChecks += 1;
    if (consecutiveReadyChecks >= 2) return;
    await page.waitForTimeout(300);
  }
  const error = new Error("易考后台自动登录失败，未能进入考试列表");
  error.code = "ARCHIVE_SCREENSHOT_LOGIN_FAILED";
  throw error;
}

export async function findExamCardElement(page, target) {
  const handle = await page.evaluateHandle(({ sessionId, sessionName }) => {
    const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const escapedId = String(sessionId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessionPattern = escapedId ? new RegExp(`/session/${escapedId}/?(?:$|[?#])`) : null;
    const links = [...document.querySelectorAll("a[href]")];
    let seeds = sessionPattern
      ? links.filter((link) => sessionPattern.test(link.href || link.getAttribute("href") || ""))
      : [];
    if (!seeds.length) {
      seeds = [...document.querySelectorAll("a, h1, h2, h3, h4, div, span, p")]
        .filter((element) => visible(element) && norm(element.textContent) === norm(sessionName));
    }
    const cards = [];
    for (const seed of seeds) {
      const matchedBySessionId = Boolean(sessionPattern
        && sessionPattern.test(seed.href || seed.getAttribute?.("href") || ""));
      let current = seed;
      for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
        if (!visible(current)) continue;
        const rect = current.getBoundingClientRect();
        const content = norm(current.textContent);
        if (rect.width >= Math.min(680, window.innerWidth * 0.55)
          && rect.height >= 120
          && rect.height <= 480
          && (matchedBySessionId || !sessionName || content.includes(norm(sessionName)))) {
          cards.push(current);
        }
      }
    }
    const uniqueCards = [...new Set(cards)];
    uniqueCards.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    });
    if (!uniqueCards.length) return null;
    if (!sessionPattern) {
      const smallestArea = uniqueCards[0].getBoundingClientRect().width * uniqueCards[0].getBoundingClientRect().height;
      const equallySpecific = uniqueCards.filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.width * rect.height <= smallestArea * 1.08;
      });
      if (equallySpecific.length > 1) throw new Error(`考试名称匹配到多个列表项：${sessionName}`);
    }
    return uniqueCards[0];
  }, target);
  return handle.asElement();
}

async function filterExamList(page, sessionName) {
  const searchInput = await firstVisible([
    page.locator("input[placeholder*='考试名称']"),
    page.locator("input[placeholder*='考试']"),
  ], 1200);
  if (!searchInput) return false;
  await searchInput.fill(sessionName);
  await searchInput.press("Enter");
  await page.waitForTimeout(1200);
  return true;
}

async function launchArchiveBrowser(chromium) {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

export async function captureEasyExamArchiveScreenshots(options = {}) {
  const {
    task,
    login,
    outputDir,
    chromium = defaultChromium,
    listUrl = EASY_EXAM_EXAM_LIST_URL,
    maxBytes = EASY_EXAM_ARCHIVE_SCREENSHOT_LIMIT_BYTES,
  } = options;
  const targets = archiveScreenshotTargets(task);
  if (!targets.length) {
    const error = new Error("缺少正式考试 session_id，无法截取归档凭证");
    error.code = "ARCHIVE_SCREENSHOT_SESSION_MISSING";
    throw error;
  }
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await launchArchiveBrowser(chromium);
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  const results = [];
  try {
    await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1000);
    await loginToEasyExam(page, login);
    await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1000);
    if (await isLoginPage(page)) {
      await loginToEasyExam(page, login);
      await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1000);
    }
    if (await isLoginPage(page)) {
      const error = new Error("易考后台登录状态未生效，无法打开考试列表");
      error.code = "ARCHIVE_SCREENSHOT_LOGIN_FAILED";
      throw error;
    }
    await page.waitForTimeout(1000);
    for (const target of targets) {
      let card = await findExamCardElement(page, target);
      if (!card && await filterExamList(page, target.sessionName)) {
        card = await findExamCardElement(page, target);
      }
      if (!card) {
        const diagnostic = await page.locator("a[href*='/manager/schedule/session/']").evaluateAll((links) => (
          links.slice(0, 20).map((link) => ({
            href: link.getAttribute("href") || "",
            text: String(link.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
            width: Math.round(link.getBoundingClientRect().width),
            height: Math.round(link.getBoundingClientRect().height),
          }))
        ));
        const error = new Error(`未在易考考试列表唯一找到正式考试：${target.sessionName}（${target.sessionId}）；当前页面 ${page.url()}，可见考试链接 ${JSON.stringify(diagnostic)}`);
        error.code = "ARCHIVE_SCREENSHOT_EXAM_NOT_FOUND";
        throw error;
      }
      await card.scrollIntoViewIfNeeded();
      const { buffer, quality } = await captureJpegWithinLimit(card, { maxBytes });
      const fileName = archiveScreenshotFileName(task.taskId, target);
      const filePath = path.resolve(outputDir, fileName);
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, buffer, { mode: 0o600 });
      await fs.rename(tempPath, filePath);
      results.push({
        status: "success",
        sessionId: target.sessionId,
        sessionName: target.sessionName,
        fileName,
        filePath,
        mimeType: "image/jpeg",
        sizeBytes: buffer.length,
        quality,
        capturedAt: new Date().toISOString(),
        sourceUrl: listUrl,
      });
      if (targets.length > 1) {
        await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(700);
      }
    }
    return results;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
