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

test("URL page layout replaces shared showView content switching", () => {
  assert.ok(html.includes('import { createRouter } from "/web/router.mjs"'));
  assert.ok(html.includes("ProjectListPage({ root: projectManagementView"));
  assert.ok(html.includes("ExamListPage({ root: examListView"));
  assert.ok(html.includes("RequirementListPage({ root: requirementsView"));
  assert.ok(html.includes("RequirementDetailPage({ root: requirementDetailView"));
  assert.equal(html.includes("function showView"), false);
  assert.equal(html.includes("syncActiveNavByScroll"), false);
});

test("requirement center renders list and detail surfaces", () => {
  assert.ok(html.includes('id="requirementsList"'));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes('id="requirementMarkReadyBtn"'));
  assert.ok(html.includes('id="requirementLinkTaskBtn"'));
});

test("exam list is task-aggregated and exam detail owns dual session cards", () => {
  assert.ok(
    html.includes(
      'import { aggregateExamSessions, matchesExamTask, resolveCandidateTaskContext } from "/web/exam_task_view_model.mjs"',
    ),
  );
  assert.ok(html.includes('id="taskSessionCards"'));
  assert.ok(html.includes("data-candidate-task-id"));
  assert.equal(html.includes('id="examTypeFilter"'), false);
});

test("requirement center remains present while exam views change", () => {
  assert.ok(html.includes('id="requirementsView"'));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes("RequirementListPage({ root: requirementsView"));
  assert.ok(html.includes("RequirementDetailPage({ root: requirementDetailView"));
});

test("candidate page loads and preselects task-scoped sessions", () => {
  assert.ok(html.includes("async function loadCandidateTaskContext()"));
  assert.ok(html.includes("resolveCandidateTaskContext(task, sessionId)"));
  assert.ok(html.includes("loadContext: loadCandidateTaskContext"));
  assert.ok(html.includes("sessionSelect.value = String(candidateUiState.selectedSession.session_id)"));
  assert.ok(html.includes("已带入目标考试场次"));
  assert.equal(html.includes("已带入正式考试和试考"), false);
});

test("candidate import supports optional course code mapping", () => {
  assert.ok(html.includes('id="candidateMapCourseCode"'));
  assert.ok(html.includes('id="candidateMapMobile"'));
  assert.ok(html.includes('id="candidateMapEmail"'));
  assert.ok(html.includes("手机号码（选填）"));
  assert.ok(html.includes("<th>科目编号</th>"));
  assert.ok(html.includes("course_code: data.mapping?.course_code || \"\""));
  assert.ok(html.includes("candidateUiState.candidates.map(({ permit, full_name, identity_id, course_code, mobile, email, custom_fields })"));
});

test("candidate preview and import payload include mapped phone and email", () => {
  const renderResultBody = html.slice(
    html.indexOf("function renderCandidateResult()"),
    html.indexOf("async function parseCandidateFile"),
  );
  assert.ok(renderResultBody.includes("fixedPreviewFields"));
  assert.ok(renderResultBody.includes('key: "mobile"'));
  assert.ok(renderResultBody.includes('key: "email"'));

  const importBody = html.slice(
    html.indexOf("async function importCandidatesToSession()"),
    html.indexOf("async function splitRoomsAutomatically"),
  );
  assert.ok(importBody.includes("candidateUiState.candidates.map(({ permit, full_name, identity_id, course_code, mobile, email, custom_fields })"));
  assert.ok(importBody.includes("mobile,"));
  assert.ok(importBody.includes("email,"));
});

test("candidate import supports custom field selection and local save payload", () => {
  assert.ok(html.includes("客户名单自定义字段"));
  assert.ok(html.includes('id="selectAllCustomFieldsBtn"'));
  assert.ok(html.includes('id="clearCustomFieldsBtn"'));
  assert.ok(html.includes('id="addCustomFieldBtn"'));
  assert.ok(html.includes("custom_field_candidates"));
  assert.ok(html.includes("selectedCustomFields()"));
  assert.ok(html.includes("custom_fields: buildCustomFieldValues(row)"));
  assert.ok(html.includes("自定义字段已随考生导入请求发送到易考"));
});

test("candidate mapping allows permit from identity or phone while catching missing course code for formal multi-course tasks", () => {
  assert.equal(html.includes("字段映射重复"), false);
  assert.ok(html.includes("当前考试任务包含"));
  assert.ok(html.includes("必须映射“科目编号”"));
  assert.ok(html.includes("candidateUiState.taskCourses"));
});

test("candidate custom fields keep source columns already used by base mappings", () => {
  assert.equal(html.includes(".filter((field) => field.manual || !fixed.has(field.source_column))"), false);
  assert.equal(html.includes("if (!column || fixed.has(column) || existingSources.has(column)) return;"), false);
  assert.ok(html.includes("同一个 Excel 字段可同时用于准考证号和考生信息项"));
});

test("candidate mapping canonicalizes phone and email aliases in fixed fields", () => {
  assert.ok(html.includes("function canonicalImportFieldName"));
  assert.ok(html.includes('return "手机号码"'));
  assert.ok(html.includes('return "邮箱"'));
  assert.ok(html.includes("candidateMapMobile.value"));
  assert.ok(html.includes("candidateMapEmail.value"));
});

test("local login page and logout controls are present", () => {
  assert.ok(html.includes('id="loginView"'));
  assert.equal(html.includes('id="loginView" hidden'), false);
  assert.ok(html.includes('id="appShell" hidden'));
  assert.ok(html.includes('id="authLoginEmailInput"'));
  assert.ok(html.includes('id="authLoginPasswordInput"'));
  assert.ok(html.includes('id="logoutBtn"'));
  assert.ok(html.includes("请通过服务网址打开"));
  assert.ok(html.includes("AuthController"));
});

test("login page script does not redeclare backend settings variables", () => {
  assert.equal((html.match(/const loginPasswordInput/g) || []).length, 0);
  assert.ok(html.includes("const authLoginPasswordInput"));
  assert.ok(html.includes("const backendLoginPasswordInput"));
  assert.equal((html.match(/id="loginPasswordInput"/g) || []).length, 1);
});

test("user management page is present for admin account provisioning", () => {
  assert.ok(html.includes('id="usersNavBtn"'));
  assert.ok(html.includes('id="userManagementView"'));
  assert.ok(html.includes('id="userEmailInput"'));
  assert.ok(html.includes('id="userPasswordInput"'));
  assert.ok(html.includes('id="userRows"'));
  assert.ok(html.includes("UserManagementPage"));
});

test("project management supports deleting projects", () => {
  assert.ok(html.includes('data-action="delete"'));
  assert.ok(html.includes("同步删除易考中的正式考试/试考场次"));
  assert.ok(html.includes('method: "DELETE"'));
  assert.ok(html.includes("/api/tasks/"));
});

test("project card actions use a bounded two-column grid", () => {
  assert.match(html, /\.project-card\s*\{[^}]*overflow:\s*hidden[^}]*box-sizing:\s*border-box/s);
  assert.match(html, /\.card-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*max-width:\s*100%/s);
  assert.match(html, /\.card-actions\s+button\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/s);
  assert.ok(html.includes('class="card-actions"'));
});

test("exam detail progress cards include paper binding and grouped candidate flows", () => {
  assert.ok(html.includes("buildTaskDisplaySteps(task)"));
  assert.ok(html.includes("试卷绑定"));
  assert.ok(html.includes("试考考生导入 & 自动分班"));
  assert.ok(html.includes("正式考试考生导入 & 自动分班"));
  assert.ok(html.includes("成绩处理"));
  assert.ok(html.includes("data-score-process"));
  assert.ok(html.includes("data-score-download"));
  assert.ok(html.includes("data-monitor-download"));
  assert.ok(html.includes("下载监考账号"));
  assert.ok(html.includes("试卷绑定"));
  assert.equal(html.includes("触发试卷绑定"), false);
  assert.ok(html.includes('data-trigger-step="paper_form_bind"'));
  assert.ok(html.includes("paperFormBind"));
  assert.ok(html.includes('stepName: "试卷绑定"'));
  assert.ok(html.includes("/steps/paper_form_bind/retry"));
});

test("exam detail shows project shared sheet before score processing with a manual trigger", () => {
  assert.ok(html.includes("项目共享大表"));
  assert.ok(html.includes("data-shared-sheet-fill"));
  assert.ok(html.includes("打开在线表"));
  assert.ok(html.includes("https://docs.qq.com/sheet/DR3NiT296WmtpWXVM?tab=BB08J2"));
  assert.ok(html.includes("填写"));
  assert.equal(html.includes("触发填写"), false);
  assert.ok(html.includes("重新填写"));
  assert.ok(html.includes("/shared-sheet/fill"));
  const displaySteps = html.slice(
    html.indexOf("function buildTaskDisplaySteps(task)"),
    html.indexOf("function renderTaskDetail(task)"),
  );
  assert.ok(displaySteps.indexOf('stepKey: "project_shared_sheet"') < displaySteps.indexOf('stepKey: "score_process"'));
});

test("auto config page exposes exam request template download instead of demo import", () => {
  assert.ok(html.includes("导入模板下载"));
  assert.ok(html.includes("/api/templates/exam-request"));
  assert.equal(html.includes("模拟导入"), false);
  assert.equal(html.includes("applyImportResult(demoData.filename, demoData)"), false);
});

test("monitor account preview uses monitor session URL", () => {
  assert.ok(html.includes("function monitorSessionUrl"));
  assert.ok(html.includes("https://eztest.org/monitor/session/"));
  const buildMonitorAccounts = html.slice(html.indexOf("function buildMonitorAccounts"));
  assert.ok(buildMonitorAccounts.includes("monitor_url: sessionUrl"));
});

test("candidate monitor account preview hides monitor address but keeps it in download payload", () => {
  const previewMarkup = html.slice(html.indexOf('id="monitorAccountCard"'), html.indexOf('async function downloadMonitorAccountsExcel'));
  assert.equal(previewMarkup.includes("<th>监考地址</th>"), false);
  assert.equal(previewMarkup.includes("row.monitor_url"), false);
  assert.ok(previewMarkup.includes('colspan="6"'));
  const downloadFn = html.slice(html.indexOf("async function downloadMonitorAccountsExcel"));
  assert.ok(downloadFn.includes("monitor_url: row.monitor_url || \"\""));
});
