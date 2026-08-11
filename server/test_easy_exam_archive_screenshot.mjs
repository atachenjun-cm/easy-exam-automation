import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveScreenshotFileName,
  archiveScreenshotTargets,
  captureJpegWithinLimit,
  EASY_EXAM_ARCHIVE_SCREENSHOT_LIMIT_BYTES,
} from "./easy_exam_archive_screenshot.mjs";

test("archive screenshot targets include only formal sessions with tenant ids", () => {
  const targets = archiveScreenshotTargets({
    taskId: "task-1",
    sessions: [
      { sessionType: "trial", session_id: "100", name: "招聘考试-试考" },
      { sessionType: "formal", session_id: "101", name: "招聘考试" },
      { sessionType: "formal", session_id: "", name: "未创建正式考试" },
    ],
  });
  assert.deepEqual(targets, [{ sessionId: "101", sessionName: "招聘考试" }]);
});

test("archive screenshot file names are safe and retain the formal session id", () => {
  assert.equal(
    archiveScreenshotFileName("task/1", { sessionId: "433783", sessionName: "蜀道:正式考试" }),
    "task-1-433783-蜀道-正式考试-archive.jpg",
  );
});

test("jpeg capture lowers quality until the screenshot is within 250KB", async () => {
  const attempts = [];
  const element = {
    async screenshot({ quality }) {
      attempts.push(quality);
      return Buffer.alloc(quality > 52 ? 300 * 1024 : 220 * 1024);
    },
  };
  const result = await captureJpegWithinLimit(element);
  assert.equal(result.quality, 52);
  assert.ok(result.buffer.length <= EASY_EXAM_ARCHIVE_SCREENSHOT_LIMIT_BYTES);
  assert.deepEqual(attempts, [82, 72, 62, 52]);
});

test("jpeg capture rejects an image that cannot be compressed below the limit", async () => {
  const element = { async screenshot() { return Buffer.alloc(251 * 1024); } };
  await assert.rejects(
    captureJpegWithinLimit(element),
    (error) => error.code === "ARCHIVE_SCREENSHOT_TOO_LARGE",
  );
});
