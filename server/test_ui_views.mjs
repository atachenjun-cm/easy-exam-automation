import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(rootDir, "outputs/web_prototype/easy_exam_automation.html"), "utf8");

test("hidden views cannot be overridden by component display styles", () => {
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test("navigation orders project management, exam list, then auto configuration", () => {
  const nav = html.slice(html.indexOf('<nav class="nav"'), html.indexOf("</nav>"));
  const projectIndex = nav.indexOf('id="projectNavBtn"');
  const examIndex = nav.indexOf('id="examNavBtn"');
  const autoIndex = nav.indexOf('id="autoNavItem"');
  assert.ok(projectIndex >= 0 && examIndex >= 0 && autoIndex >= 0);
  assert.ok(projectIndex < examIndex && examIndex < autoIndex);
});

test("project and exam views explicitly hide auto configuration content", () => {
  assert.ok(html.includes("autoTopbar.hidden = !(isAuto || isCandidate)"));
  assert.ok(html.includes("autoConfigStack.hidden = !isAuto"));
  assert.ok(html.includes('projectManagementView.hidden = section !== "projects"'));
  assert.ok(html.includes('examListView.hidden = section !== "exams"'));
});
