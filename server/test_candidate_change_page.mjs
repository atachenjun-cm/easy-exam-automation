import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(rootDir, "web/pages/CandidateChangePage.mjs"), "utf8");
const server = fs.readFileSync(path.join(rootDir, "server/easy_exam_server.mjs"), "utf8");
const html = fs.readFileSync(path.join(rootDir, "outputs/web_prototype/easy_exam_automation.html"), "utf8");

test("candidate course code is a session-scoped select with a blocking manual-entry warning", () => {
  assert.match(page, /field\.type === "select"/);
  assert.match(page, /不属于本场次，请从下拉选项中选择/);
  assert.match(server, /candidateChangeCoursesForSession/);
  assert.match(server, /fetchTenantCoursesForSession/);
  assert.match(server, /变更草稿中存在不属于本场次的科目编号/);
});

test("candidate draft supports bulk selection and an explicit clear-candidates-and-rooms action", () => {
  assert.match(page, /data-ccm-select-permit/);
  assert.match(page, /data-ccm-delete-selected/);
  assert.match(page, /data-ccm-clear-session/);
  assert.match(page, /清空本场次考生及分班/);
  assert.match(server, /clearCandidateChangeRooms/);
  assert.match(server, /room_assignment: "clear_all"/);
  assert.match(server, /expectedEmptyRoster[\s\S]*!expectedEmptyRoster/);
});

test("formal candidate additions can be copied to trial with the SKTY course code", () => {
  assert.match(page, /data-ccm-sync-trial/);
  assert.match(page, /同步新增考生到试考/);
  assert.match(server, /syncCandidateChangeAddsToTrial/);
  assert.match(server, /course_code: DEFAULT_TRIAL_COURSE_CODE/);
  assert.match(server, /already_present/);
});

test("candidate page uses platform-sized controls and merges roster metrics into the context", () => {
  assert.match(html, /#candidateChangePanel \.btn,[\s\S]*min-height: 40px;[\s\S]*font-size: 15px/);
  assert.match(html, /\.ccm-table \{[^}]*font-size: 14px/);
  assert.match(page, /<div><span>线上考生<\/span>/);
  assert.match(page, /<div><span>名单版本<\/span>/);
  const rosterStart = page.indexOf("function rosterHtml()");
  const rosterEnd = page.indexOf("function workingRosterTable()", rosterStart);
  assert.equal(page.slice(rosterStart, rosterEnd).includes('<div class="ccm-summary">'), false);
});
