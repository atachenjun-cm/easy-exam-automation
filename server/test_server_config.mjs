import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(rootDir, "server", "easy_exam_server.mjs"), "utf8");
const requirementApiSource = fs.readFileSync(path.join(rootDir, "server", "requirement_request_api.mjs"), "utf8");

test("content email reads the same configured requirement database as the requirement API", () => {
  assert.match(requirementApiSource, /process\.env\.REQUIREMENT_DB_PATH \|\| defaultDbPath/);
  assert.match(
    serverSource,
    /const requirementDbPath = path\.resolve\(\s*rootDir,\s*process\.env\.REQUIREMENT_DB_PATH \|\| path\.join\(rootDir, "\.easy_exam_runtime", "requirement_requests\.sqlite3"\),?\s*\);/,
  );
});

test("server wires operation collaboration and content email endpoints", () => {
  assert.match(serverSource, /from "\.\/operation_batch\.mjs"/);
  assert.match(serverSource, /from "\.\/operation_batch_runner\.mjs"/);
  assert.match(serverSource, /from "\.\/operation_console_env\.mjs"/);
  assert.match(serverSource, /from "\.\/content_requirement_email\.mjs"/);
  assert.match(serverSource, /from "\.\/content_email_directory\.mjs"/);
  assert.match(serverSource, /\/api\/email\/settings/);
  assert.match(serverSource, /\/api\/operation-console\/environment/);
  assert.match(serverSource, /operation-batch\\\/create/);
  assert.match(serverSource, /content-requirement-email/);
  assert.match(serverSource, /operation-content\\\/sync/);
  assert.ok(serverSource.includes("contentEmailDefaultsForTask(task)"));
  assert.ok(serverSource.includes('ccRecipients: payload.cc || ""'));
  assert.ok(serverSource.includes("lastCc: result.cc"));
});

test("project workflow exposes the operation content configuration draft", () => {
  assert.match(serverSource, /import\s*\{[^}]*buildOperationContentDraft[^}]*\}\s*from "\.\/operation_content\.mjs";/);
  assert.ok(serverSource.includes("workflow.operationContentDraft = buildOperationContentDraft(task)"));
  assert.ok(serverSource.includes("workflow.operationContentDispatchPreview = operationContentDispatchPreview(task)"));
});

test("Fanwei helper downloads include the shared task-send evidence module", () => {
  assert.ok(
    serverSource.includes('"operation_task_send_record.mjs"'),
    "operation_task_send_record.mjs is not included in helper downloads",
  );
});

test("server wires read-only EasyExam session sync preview and confirmed local apply", () => {
  assert.match(serverSource, /from "\.\/session_sync\.mjs"/);
  assert.match(serverSource, /sessions\\\/sync-preview/);
  assert.match(serverSource, /sync-from-yikao/);
  const previewHandler = serverSource.slice(
    serverSource.indexOf("async function handleSessionSyncPreview"),
    serverSource.indexOf("async function handleSessionSyncApply"),
  );
  const applyHandler = serverSource.slice(
    serverSource.indexOf("async function handleSessionSyncApply"),
    serverSource.indexOf("async function handleSessionChangePreview"),
  );
  assert.ok(serverSource.includes("async function buildTenantSessionSyncPreview"));
  assert.ok(serverSource.includes("fetchTenantSessionDetailWithListFallback"));
  assert.ok(serverSource.includes("fetchSessionSubjectPaperSnapshot"));
  assert.ok(previewHandler.includes("buildTenantSessionSyncPreview"));
  assert.equal(previewHandler.includes("putTenantSessionDetail"), false);
  assert.ok(applyHandler.includes('runTaskState("sync_session"'));
  assert.ok(applyHandler.includes("payload?.confirm"));
  assert.equal(applyHandler.includes("putTenantSessionDetail"), false);
});

test("requirement change previews recalculate against current tenant values", () => {
  const sessionPreviewHandler = serverSource.slice(
    serverSource.indexOf("async function handleSessionChangePreview"),
    serverSource.indexOf("async function handleSessionChange(taskId"),
  );
  assert.ok(sessionPreviewHandler.includes("const current = editableSessionFieldsFromDetail(detail)"));
  assert.ok(sessionPreviewHandler.includes("sessionRequirementChangeForTaskSession(task, { ...session, ...current })"));

  const coursePreviewHandler = serverSource.slice(
    serverSource.indexOf("async function handleCourseChangePreview"),
    serverSource.indexOf("async function handleCourseChange(taskId"),
  );
  assert.ok(coursePreviewHandler.includes("courseRequirementChangeForTaskSession(task, formalSession, current)"));
});

test("task detail syncs the bound account tenant ID into project config", () => {
  assert.ok(serverSource.includes("function tenantIdForTask(task = {})"));
  assert.ok(serverSource.includes("profiles.find((item) => profileId && item.id === profileId)"));
  assert.ok(serverSource.includes("syncedTask = await syncTaskTenantId(syncedTask)"));
  assert.ok(serverSource.includes("const nextConfig = tenantId ? { ...config, tenantId } : config"));
});

test("global email and operation environment mutations require administrators", () => {
  const requestHandler = serverSource.slice(
    serverSource.indexOf("async function requestHandler"),
    serverSource.indexOf("await loadEnvFile()"),
  );
  for (const route of [
    'url.pathname === "/api/email/settings"',
    'url.pathname === "/api/email/test"',
    'url.pathname === "/api/operation-console/environment/install"',
    'url.pathname === "/api/operation-console/environment/enable"',
  ]) {
    const routeIndex = requestHandler.indexOf(route);
    assert.ok(routeIndex >= 0, `missing route: ${route}`);
    const routeBlock = requestHandler.slice(routeIndex, requestHandler.indexOf("\n    }", routeIndex) + 6);
    assert.ok(routeBlock.includes("requireAdmin(auth, req, res)"), `route is not admin-only: ${route}`);
  }

  const requireAdminBlock = serverSource.slice(
    serverSource.indexOf("function requireAdmin"),
    serverSource.indexOf("async function saveAuthUsers"),
  );
  assert.ok(requireAdminBlock.includes("if (!auth.enabled)"));
  assert.ok(requireAdminBlock.includes('role: "admin"'));
});

test("operation batch creation uses a per-task guard released in finally", () => {
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleOperationBatchCreate"),
    serverSource.indexOf("async function handleOperationBatchResult"),
  );
  assert.ok(serverSource.includes("const operationBatchCreationInFlight = new Set()"));
  assert.ok(handler.includes("acquireOperationBatchCreation(operationBatchCreationInFlight, taskId)"));
  assert.ok(handler.includes("finally"));
  assert.ok(handler.includes("releaseOperationBatchCreation(operationBatchCreationInFlight, taskId)"));
});

test("operation batch creation is prepared for the local helper and deduplicated by request id", () => {
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleOperationBatchCreate"),
    serverSource.indexOf("async function handleOperationBatchResult"),
  );
  assert.ok(serverSource.includes("const operationBatchLocalPreparations = new Map()"));
  assert.ok(handler.includes("activeOperationBatchLocalPreparation(taskId)"));
  assert.ok(serverSource.includes('path: "/operation-batch/create"'));
  assert.ok(serverSource.includes("requestId: preparationId"));
  assert.ok(serverSource.includes("publishAfterCreate: false"));
  assert.ok(handler.includes("buildDesiredOperationBatchSnapshot(task)"));
  assert.ok(handler.includes("applyCompletedOperationBatchResult(freshTask, helperResult)"));
  assert.ok(handler.includes("payload.helperResult?.operationBatch || payload.helperResult"));
  assert.equal(handler.includes("runOperationBatchCreation("), false);
});

test("operation batch reconciliation independently recovers publication and schedules", () => {
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleOperationBatchReconciliation"),
    serverSource.indexOf("async function handleOperationBatchRetry"),
  );
  assert.ok(handler.includes('path: "/operation-batch/reconcile"'));
  assert.ok(handler.includes('currentOperationBatch.scheduleStatus !== "synced"'));
  assert.ok(handler.includes("if (!followUpNeeded)"));
  assert.ok(handler.includes('code: "OPERATION_BATCH_ACTUAL_NAME_MISSING"'));
  assert.ok(handler.includes("operationBatchCode: existingOperationBatchCode"));
  assert.ok(handler.includes("desired: operationBatchDesiredForLocalHelper(preparation.desired)"));
  assert.ok(handler.includes("publishAfterCreate: false"));
  assert.ok(handler.includes("applyCompletedOperationBatchResult(freshTask, helperResult)"));
});

test("operation batch completion persists the verified schedule snapshot", () => {
  const helper = serverSource.slice(
    serverSource.indexOf("function applyCompletedOperationBatchResult"),
    serverSource.indexOf("async function handleOperationBatchDraft"),
  );
  assert.ok(helper.includes("applyOperationBatchResult(task, created)"));
  assert.ok(helper.includes("managedResult?.verified !== true"));
  assert.ok(helper.includes("applyOperationBatchManagedResult(taskWithCreatedBatch"));
  assert.ok(helper.includes('action: `create_${managedResult.action || "sync"}`'));
  assert.ok(helper.includes("allowEmptySchedules: managedResult.allowEmptySchedules === true"));
});

test("operation batch creation exposes an explicit no-batch recovery path", () => {
  const retryHandler = serverSource.slice(
    serverSource.indexOf("async function handleOperationBatchRetry"),
    serverSource.indexOf("async function handleOperationBatchResult"),
  );
  assert.ok(serverSource.includes("OPERATION_BATCH_UNCONFIRMED_STATUSES"));
  assert.ok(retryHandler.includes("confirmNoExternalBatch !== true"));
  assert.ok(retryHandler.includes("operationBatchCreationInFlight.has(taskId)"));
  assert.ok(retryHandler.includes('status: "failed"'));
  assert.ok(retryHandler.includes("OPERATION_BATCH_CONFIRMED_NOT_CREATED"));
  assert.ok(serverSource.includes("/operation-batch\\/retry"));
});

test("new projects snapshot the owner-specific operation project department", () => {
  assert.ok(serverSource.includes("initializeOperationBatchDefaults(taskConfig, auth.enabled ? taskOwnerEmail : \"\")"));
  assert.ok(serverSource.includes("initializeOperationBatchDefaults(parsed?.config || {}, taskOwnerEmail)"));
});

test("server listen host can be configured for LAN deployment", () => {
  assert.ok(serverSource.includes("process.env.HOST"));
  assert.ok(serverSource.includes("server.listen(port, host"));
});

test("server exposes exam request template download endpoint", () => {
  assert.ok(serverSource.includes('path.join(rootDir, "template", "v2易考新建考试需求单.xlsx")'));
  assert.ok(serverSource.includes("async function handleExamRequestTemplate"));
  assert.ok(serverSource.includes('/api/templates/exam-request'));
});

test("server exposes authenticated prebuilt Fanwei helper installer downloads", () => {
  assert.ok(serverSource.includes('path.join(runtimeDir, "fanwei-helper")'));
  assert.ok(serverSource.includes('path.join(rootDir, "dist", "fanwei-helper")'));
  assert.ok(serverSource.includes("async function handleFanweiHelperInstaller"));
  assert.ok(serverSource.includes("function requestOrigin(req)"));
  assert.ok(serverSource.includes("function helperPackageConfig(origin = \"\")"));
  assert.ok(serverSource.includes("async function dynamicFanweiHelperPackagePath"));
  assert.ok(serverSource.includes("async function overlayLatestFanweiHelperFiles"));
  for (const helperFile of [
    "operation_batch_update_runner.mjs",
    "operation_personnel_console_runner.mjs",
    "operation_archive_runner.mjs",
    "content_email_directory.mjs",
    "operation_batch.mjs",
    "operation_content.mjs",
    "operation_task_send_record.mjs",
    "operation_content_runner.mjs",
  ]) {
    assert.ok(serverSource.includes(`"${helperFile}"`), `${helperFile} is not included in helper downloads`);
  }
  assert.ok(serverSource.includes("await extractFanweiHelperPackageZip(packagePath, tempRoot)"));
  assert.ok(serverSource.includes("YIKAO_CONSOLE_ORIGINS=${origins}"));
  assert.ok(serverSource.includes('"http://127.0.0.1:8765"'));
  assert.ok(serverSource.includes('"http://localhost:8765"'));
  assert.equal(serverSource.includes("defaultFanweiHelperConsoleOrigin"), false);
  assert.equal(serverSource.includes("将使用预构建安装包"), false);
  assert.ok(serverSource.includes('/api/fanwei/helper-installer'));
  const requestHandlerBlock = serverSource.slice(serverSource.indexOf("async function requestHandler"));
  assert.ok(requestHandlerBlock.indexOf("!getAuthUserFromRequest(auth, req)") < requestHandlerBlock.indexOf("handleFanweiHelperInstaller(req, url, res)"));
});

test("EasyExam account settings are stored per console user", () => {
  assert.ok(serverSource.includes('path.join(runtimeDir, "user_settings.json")'));
  assert.ok(serverSource.includes("saveUserLogin(state.userSettings, user"));
  assert.ok(serverSource.includes("currentUserLogin({"));
});

test("Fanwei auto-read status opens dedicated Chrome when no Fanwei tab exists", () => {
  const ensureBlock = serverSource.slice(
    serverSource.indexOf("async function ensureFanweiDevToolsChromeAvailable"),
    serverSource.indexOf("async function readFanweiFromLocalChrome"),
  );
  assert.ok(ensureBlock.includes("status?.fanweiTabFound === false"));
  assert.ok(ensureBlock.includes("launchFanweiChromeForDevTools()"));
  assert.ok(ensureBlock.includes("launchedChrome: true"));

  const statusBlock = serverSource.slice(
    serverSource.indexOf("async function handleFanweiAutoReadStatus"),
    serverSource.indexOf("async function handleFanweiAutoRead(req"),
  );
  assert.ok(statusBlock.includes("available: true"));
  assert.ok(statusBlock.includes("...status"));
});

test("Fanwei serial miss does not relaunch Chrome when DevTools is already connected", () => {
  const readBlock = serverSource.slice(
    serverSource.indexOf("async function runFanweiDevToolsReadWithAutoLaunch"),
    serverSource.indexOf("async function ensureFanweiDevToolsChromeAvailable"),
  );
  assert.ok(readBlock.includes("return await runChromeDevToolsFanweiRead({ serialNo, timeoutMs });"));
  assert.equal(readBlock.includes("if (fanwei) return fanwei"), false);
  assert.equal(readBlock.includes("const launched = await launchFanweiChromeForDevTools();\n    if (!launched) return fanwei"), false);
});

test("loopback Fanwei read fallback returns raw data without creating an import", () => {
  const localReadBlock = serverSource.slice(
    serverSource.indexOf("async function handleFanweiLocalRead"),
    serverSource.indexOf("async function handleFanweiAutoRead(req"),
  );
  assert.ok(localReadBlock.includes("isLoopbackRequest(req)"));
  assert.ok(localReadBlock.includes("readFanweiFromLocalChrome(serialNo)"));
  assert.ok(localReadBlock.includes("isVirtualFanweiSerial(serialNo)"));
  assert.ok(localReadBlock.includes("buildVirtualFanweiReadPayload(serialNo)"));
  assert.ok(localReadBlock.includes("{ ok: true, data: fanwei }"));
  assert.equal(localReadBlock.includes("createFanweiRequirementImportFromPayload"), false);
  assert.equal(localReadBlock.includes("randomUUID"), false);
  assert.equal(localReadBlock.includes("fs.writeFile"), false);
  assert.ok(serverSource.includes('url.pathname === "/api/fanwei/local-read"'));
  assert.ok(serverSource.includes("handleFanweiLocalRead(req, res)"));
});

test("Fanwei preview route validates raw data and has no persistence side effects", () => {
  const previewBlock = serverSource.slice(
    serverSource.indexOf("function buildFanweiRequirementPreviewFromPayload"),
    serverSource.indexOf("async function createFanweiRequirementImportFromPayload"),
  );
  assert.ok(previewBlock.includes("validateFanweiReadPayload"));
  assert.ok(previewBlock.includes("buildFanweiRequirementModel"));
  assert.ok(previewBlock.includes("loadFanweiRequirementDefaults"));
  assert.ok(previewBlock.includes("applyVirtualFanweiRequirementDefaults"));
  assert.ok(previewBlock.includes("return { fanwei: model }"));
  assert.equal(previewBlock.includes("randomUUID"), false);
  assert.equal(previewBlock.includes("fs.writeFile"), false);
  assert.equal(previewBlock.includes("runPythonJson"), false);
  assert.equal(previewBlock.includes("createImportFromWorkbook"), false);
  assert.equal(previewBlock.includes("state.imports"), false);
  assert.ok(serverSource.includes('url.pathname === "/api/fanwei/requirement-preview"'));
  assert.ok(serverSource.includes("handleFanweiRequirementPreview(req, res)"));
  assert.ok(serverSource.includes('runPythonJson([\n      fanweiWorkbookScript,\n      "--defaults",\n      examRequestTemplatePath'));
});

test("Fanwei requirement import validates raw data before any file or task write", () => {
  const importBlock = serverSource.slice(
    serverSource.indexOf("async function createFanweiRequirementImportFromPayload"),
    serverSource.indexOf("async function handleFanweiRequirementImport"),
  );
  assert.ok(importBlock.includes("validateFanweiReadPayload"));
  assert.ok(importBlock.indexOf("validateFanweiReadPayload") < importBlock.indexOf("randomUUID"));
  assert.ok(importBlock.indexOf("validateFanweiReadPayload") < importBlock.indexOf("fs.writeFile"));
  assert.equal(importBlock.includes("sampleFanweiR0042182"), false);
  assert.equal(importBlock.includes('payload.serialNo === "R0042182"'), false);
  assert.ok(importBlock.includes("applyVirtualFanweiRequirementDefaults"));
});

test("Fanwei project cards persist dual snapshots and reuse the same serial card", () => {
  assert.ok(serverSource.includes('url.pathname === "/api/fanwei/project-card"'));
  assert.ok(serverSource.includes("buildFanweiProjectConfig"));
  assert.ok(serverSource.includes("findFanweiProject"));
  assert.ok(serverSource.includes("existingTaskId: existingTask?.taskId || \"\""));
  assert.ok(serverSource.includes("projectReused: Boolean(existingTask)"));
  assert.ok(serverSource.includes("payload.requirementFieldsList"));
  assert.ok(serverSource.includes("appendedExamRequirements = requirementFieldsList.map"));
  assert.ok(serverSource.includes("editableRequirementFieldsRecord(entry.fields)"));
  assert.ok(serverSource.includes("appendedRequirementStartIndex"));
  assert.ok(serverSource.includes("allExamRequirements"));
  assert.ok(serverSource.includes("previousConfig: existingTask?.config || {}"));
});

test("project workflow route returns sourced batch personnel content and archive state", () => {
  assert.ok(serverSource.includes("async function handleProjectWorkflow(taskId, req, res)"));
  assert.ok(serverSource.includes("buildProjectWorkflow(task, batchDraft)"));
  assert.ok(serverSource.includes("/operation-workflow$/"));
});

test("completed operation actions persist field fingerprints for current-difference warnings", () => {
  assert.ok(serverSource.includes("lastSourceFingerprint: result.sourceFingerprint"));
  assert.ok(serverSource.includes("lastSubmittedFingerprint: preparation.draftFingerprint"));
});

test("project source snapshots can be edited and rebuild downstream workflow data", () => {
  assert.ok(serverSource.includes("async function handleProjectSourceSnapshotUpdate(taskId, req, res)"));
  assert.ok(serverSource.includes("/source-snapshot$/"));
  assert.ok(serverSource.includes("normalizeFanweiBusinessRequirement(raw, { requirementFields })"));
  assert.ok(serverSource.includes("...editableStringRecord(currentRaw.fields)"));
  assert.ok(serverSource.includes("...editableStringRecord(payload.fields)"));
  assert.ok(serverSource.includes("const batchName = resolveOperationBatchName({"));
  assert.ok(serverSource.includes("batchNameMode: batchName.mode"));
  assert.ok(serverSource.includes("batch_name_mode: batchName.mode"));
  assert.ok(serverSource.includes("buildAutoConfigFromRequirement("));
  assert.ok(serverSource.includes("const fields = editableRequirementFieldsRecord(payload.fields);"));
  assert.ok(serverSource.includes("courseBasisUnchanged"));
  assert.ok(serverSource.includes("preserveCreatedCourses"));
  assert.ok(serverSource.includes("taskCoursesForChange(task, requirementIndex)"));
  assert.ok(serverSource.includes("mergeRequirementCoursePaperNames"));
  assert.ok(serverSource.includes('paper_names_text: fields["试卷名称"]'));
  assert.ok(serverSource.includes("subjectImportPath: currentConfig.subjectImportPath"));
  assert.ok(serverSource.includes("projectRequirementFieldChanges(current.fields, fields)"));
  assert.ok(serverSource.includes("projectSourceChangeHistory"));
  assert.ok(serverSource.includes("appendProjectSourceChangeHistory"));
  assert.ok(serverSource.includes("normalizeOperationProjectDepartment(submittedProjectDepartment)"));
  assert.ok(serverSource.includes("projectDepartmentDefault: projectDepartment"));
  assert.ok(serverSource.includes('label: "项目部归属"'));
  assert.ok(serverSource.includes('source: "fanwei"'));
  assert.ok(serverSource.includes('source: "examRequirement"'));
  assert.ok(serverSource.includes("versionBefore"));
  assert.ok(serverSource.includes("versionAfter"));
  assert.ok(serverSource.includes("async function handleContentTaskRemark(taskId, req, res)"));
  assert.ok(serverSource.includes("/content-task-remarks$/"));
  assert.ok(serverSource.includes("contentTaskRemarks"));
  assert.ok(serverSource.includes("async function handleScoreStampBatchName(taskId, req, res)"));
  assert.ok(serverSource.includes("/score-stamp-batch-name$/"));
  assert.ok(serverSource.includes("scoreStampBatchName"));
  assert.ok(serverSource.includes("sourceKey: fanweiSource.serialNo"));
  assert.ok(serverSource.includes('projectName: source === "fanwei"'));
  assert.ok(serverSource.includes('runTaskState("update_config", {'));
});

test("project EasyExam snapshots can be deleted before automatic configuration starts", () => {
  assert.ok(serverSource.includes("async function handleProjectSourceSnapshotDelete(taskId, req, res)"));
  assert.ok(serverSource.includes("taskRequirementExecutionStartedAtOrAfter(task, requirementIndex)"));
  assert.ok(serverSource.includes("removeProjectExamRequirement(task.config || {}, requirementIndex)"));
  assert.ok(serverSource.includes('req.method === "DELETE" && projectSourceSnapshotMatch'));
  assert.ok(serverSource.includes("该需求单或后续需求单已进入自动配置，不能删除。"));
});

test("auto configuration jobs can resume from a persisted project requirement", () => {
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleCreateJob(req, res)"),
    serverSource.indexOf("async function handleGetSettings"),
  );
  assert.ok(handler.includes("!payload?.uploadId && !payload?.taskId"));
  assert.ok(handler.includes('runTaskState("get", { taskId: payload.taskId })'));
  assert.ok(handler.includes("taskExamRequirements(task)"));
  assert.ok(handler.includes("payload.requirementIndex"));
  assert.ok(handler.includes("requirementIndex,"));
  assert.ok(handler.includes("requirement.previewRows || []"));
  assert.ok(serverSource.includes("requirementIndex: Number(importRecord.requirementIndex || 0)"));
  assert.ok(serverSource.includes("requirementIndex: job.requirementIndex"));
  assert.ok(serverSource.includes("requirementIndex: Number(session.requirementIndex || 0)"));
  assert.ok(handler.includes("taskHasCreatedSessions(taskForJob)"));
  assert.ok(handler.includes("getYikaoLoginForTask(taskForJob)"));
  assert.ok(handler.includes("getYikaoLoginForRequest(req)"));
});

test("deleting a console user removes that user's EasyExam account settings", () => {
  assert.ok(serverSource.includes("delete state.userSettings.users[normalizeEmail(email)]"));
  assert.ok(serverSource.includes("await fs.writeFile(userSettingsPath, JSON.stringify(state.userSettings, null, 2), \"utf8\")"));
});

test("authenticated automation jobs use the current account until a task has created sessions", () => {
  assert.ok(serverSource.includes("const reuseBoundTaskLogin = taskForJob && taskHasCreatedSessions(taskForJob);"));
  assert.ok(serverSource.includes("const storedLogin = reuseBoundTaskLogin ? getYikaoLoginForTask(taskForJob) : getYikaoLoginForRequest(req);"));
  assert.ok(serverSource.includes("const login = taskForJob || auth.enabled ? storedLogin : { ...storedLogin, ...(payload.login || {}) };"));
});

test("project cards stay unbound until auto configuration starts, then task operations reuse the bound profile", () => {
  assert.ok(serverSource.includes("function pinTaskApiKeyProfile"));
  assert.ok(serverSource.includes("async function bindTaskToAutomationLogin"));
  assert.ok(serverSource.includes("apiKeyProfileId:"));
  assert.ok(serverSource.includes("function taskHasCreatedSessions(task = {})"));
  assert.ok(serverSource.includes("String(session?.session_id || \"\").trim()"));

  const workbookProjectCreator = serverSource.slice(
    serverSource.indexOf("async function createImportFromWorkbook"),
    serverSource.indexOf("function createJob(importRecord, login)"),
  );
  const workbookImportHandler = serverSource.slice(
    serverSource.indexOf("async function handleImport(req, res)"),
    serverSource.indexOf("function sampleFanweiR0042182"),
  );
  for (const block of [workbookProjectCreator, workbookImportHandler]) {
    assert.ok(block.includes('sourceAccount: ""'));
    assert.equal(block.includes("pinTaskApiKeyProfile"), false);
    assert.equal(block.includes("getYikaoLoginForRequest(req)"), false);
  }

  const resolver = serverSource.slice(
    serverSource.indexOf("function getYikaoLoginForTask"),
    serverSource.indexOf("function publicYikaoLogin"),
  );
  assert.ok(resolver.includes("task.config?.apiKeyProfileId"));
  assert.ok(resolver.includes("task.sourceAccount"));
  assert.ok(resolver.includes("loginForApiKeyProfile"));

  const createJobHandler = serverSource.slice(
    serverSource.indexOf("async function handleCreateJob(req, res)"),
    serverSource.indexOf("function getAuthUserFromRequest"),
  );
  assert.ok(createJobHandler.includes("await bindTaskToAutomationLogin(job.taskId, login);"));
  assert.ok(serverSource.includes('sourceAccount: login.username || ""'));

  const taskScopedHandlers = [
    ["async function syncTaskDetailSessionState", "async function parseWorkbook"],
    ["async function handleSessionMonitorAccounts", "function normalizeTenantList"],
    ["async function handleCandidateImport", "async function handleRoomsPreview"],
    ["async function handleRoomsPreview", "async function handleRoomsAuto"],
    ["async function handleRoomsAuto", "async function handleCreateJob"],
    ["async function handleSessionSyncPreview", "async function handleSessionSyncApply"],
    ["async function handleSessionSyncApply", "async function handleSessionChangePreview"],
    ["async function handleSessionChangePreview", "async function handleSessionChange(taskId"],
    ["async function handleSessionChange", "async function enrichTaskPaperUnitInfoForDetail"],
    ["async function enrichTaskPaperUnitInfoForDetail", "function sharedSheetSessionFieldsFromDetail"],
    ["async function handleProjectSharedSheetFill", "function scoreFeedbackFileName"],
    ["async function runScoreProcessForTask", "async function handleScoreProcess"],
    ["async function handleScoreReportDownload", "async function handleTaskHide"],
    ["async function handleTaskHide", "function operationBatchDraftOverridesFromTask"],
    ["async function handleTaskStepRetry", "function handleEvents"],
  ];
  for (const [start, end] of taskScopedHandlers) {
    const block = serverSource.slice(serverSource.indexOf(start), serverSource.indexOf(end));
    assert.ok(block.includes("getYikaoLoginForTask(task)"), `${start} must use the task API key profile`);
    assert.equal(block.includes("getYikaoLoginForRequest(req)"), false, `${start} must not use the current saved API key`);
  }
});

test("session creation does not enable bluetooth blocking by default", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.equal(buildPayloads.includes("check_bluetooth: true"), false);
});

test("session creation forwards requirement exam address selection to tenant API", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.ok(buildPayloads.includes("unified_exam_address: unifiedExamAddress"));
  assert.ok(buildPayloads.includes("config.unifiedExamAddress"));
  assert.ok(buildPayloads.includes('config.examAddress || config.examUrlType || ""'));
});

test("session creation clears blank rich prompt and pledge fields before tenant API", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.ok(buildPayloads.includes("const preLoginPrompt = normalizeRequirementRichField(config.preLoginPrompt);"));
  assert.ok(buildPayloads.includes("const pledgeContent = normalizeRequirementRichField(config.pledgeContent);"));
  assert.ok(buildPayloads.includes("notice: preLoginPrompt"));
  assert.ok(serverSource.includes("function editableRequirementFieldsRecord"));
});

test("session creation forwards manual scoring selection to tenant API", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.ok(buildPayloads.includes("manual_score: boolValue(config.manualScore)"));
  assert.equal(buildPayloads.includes("manual_score: false"), false);
});

test("session creation enables monitor replay and anonymous monitor by default", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.ok(buildPayloads.includes("monitor_replay: true"));
  assert.ok(buildPayloads.includes("anonymous_monitor: true"));
});

test("trial session disables pledge content by default", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  const trialBlock = buildPayloads.slice(
    buildPayloads.indexOf("const trial = {"),
    buildPayloads.indexOf('applyTimeRule(trial, "不扣时")'),
  );
  assert.ok(trialBlock.includes("nda: false"));
  assert.ok(trialBlock.includes('nda_notice: ""'));
});

test("web exam session enables lock screen and forwards leave limit", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  const webMainBlock = buildPayloads.slice(
    buildPayloads.indexOf("} else {\n    Object.assign(main"),
    buildPayloads.indexOf("const payloads ="),
  );
  assert.ok(webMainBlock.includes("client_required: false"));
  assert.ok(webMainBlock.includes("lock_screen: true"));
  assert.ok(webMainBlock.includes("login_times: positiveNumber(config.clientLoginLimit, 10)"));
  assert.ok(webMainBlock.includes("lock_screen_exit_sec: positiveNumber(config.webLeaveSeconds, 5)"));
  assert.ok(webMainBlock.includes("lock_screen_time: positiveNumber(config.leaveLimit, 5)"));

  const webTrialBlock = buildPayloads.slice(
    buildPayloads.indexOf("} else {\n      Object.assign(trial"),
    buildPayloads.indexOf("payloads.push"),
  );
  assert.ok(webTrialBlock.includes("client_required: false"));
  assert.ok(webTrialBlock.includes("lock_screen: true"));
  assert.ok(webTrialBlock.includes("login_times: positiveNumber(config.clientLoginLimit, 10)"));
  assert.ok(webTrialBlock.includes("lock_screen_exit_sec: positiveNumber(config.webLeaveSeconds, 5)"));
  assert.ok(webTrialBlock.includes("lock_screen_time: positiveNumber(config.leaveLimit, 10)"));
});

test("Fanwei requirement import keeps per-sheet explicit configuration selections", () => {
  const importBlock = serverSource.slice(
    serverSource.indexOf("async function createFanweiRequirementImportFromPayload"),
    serverSource.indexOf("async function handleFanweiRequirementImport"),
  );
  assert.ok(importBlock.includes("payload.requirementConfigSelectionsList"));
  assert.ok(importBlock.includes("editableRequirementConfigSelection(entry.configSelection)"));
  assert.ok(importBlock.includes("configSelection: requirementConfigSelectionsList[index]"));
});

test("session creation overlays explicit picker fields without changing the legacy default path", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.ok(buildPayloads.includes("config.sessionOptions?.explicit === true"));
  assert.ok(buildPayloads.includes("value !== null && value !== undefined"));
  assert.ok(buildPayloads.includes("Object.assign(common, sessionOptionsPublic)"));
  assert.ok(buildPayloads.includes("if (!explicitSessionOptions)"));
  assert.ok(buildPayloads.includes("explicitSessionOptions ? boolValue(sessionOptionsPublic.save_video)"));
  assert.ok(serverSource.includes("[需报备后人工开启]"));
  assert.ok(serverSource.includes("请先完成报备，再由人工在易考后台开启并回读核验"));
});

test("candidate import forwards optional course_code to EasyExam tenant API", () => {
  assert.ok(serverSource.includes("buildTenantCandidateEntries(candidates, customFieldMappings)"));
  assert.ok(serverSource.includes("candidate_tenant_payload.mjs"));
});

test("candidate payload validation messages use Chinese field labels", () => {
  const validationBlock = serverSource.slice(
    serverSource.indexOf("function validateCandidatePayload"),
    serverSource.indexOf("const baseImportFieldDefinitions"),
  );
  assert.ok(validationBlock.includes("candidateFieldLabel"));
  assert.ok(validationBlock.includes('`第 ${row} 行缺少${candidateFieldLabel("permit")}`'));
  assert.ok(validationBlock.includes('`第 ${row} 行缺少${candidateFieldLabel("full_name")}`'));
  assert.ok(validationBlock.includes('`第 ${row} 行${candidateFieldLabel("identity_id")}为科学计数法格式，请修正原始文件后再导入`'));
  assert.ok(validationBlock.includes('`第 ${row} 行${candidateFieldLabel("permit")}为科学计数法格式，请修正原始文件后再导入`'));
  assert.equal(validationBlock.includes("缺少 permit"), false);
  assert.equal(validationBlock.includes("缺少 full_name"), false);
  assert.equal(validationBlock.includes("identity_id 为科学计数法格式"), false);
  assert.equal(validationBlock.includes("permit 为科学计数法格式"), false);
});

test("candidate payload validation rejects invalid permit and phone-mapped permit formats", () => {
  const validationBlock = serverSource.slice(
    serverSource.indexOf("function validateCandidatePayload"),
    serverSource.indexOf("const baseImportFieldDefinitions"),
  );
  assert.ok(validationBlock.includes("isValidCandidatePermit"));
  assert.ok(validationBlock.includes("candidatePermitMappedFromMobile"));
  assert.ok(validationBlock.includes('`第 ${row} 行准考证号只能包含英文字母和数字`'));
  assert.ok(validationBlock.includes("validateCandidateMobile(permit, { required: true })"));
  assert.ok(validationBlock.includes('`第 ${row} 行${permitMobileError}`'));
});

test("candidate payload validation checks mainland identity and mobile numbers before tenant import", () => {
  const validationBlock = serverSource.slice(
    serverSource.indexOf("function validateCandidatePayload"),
    serverSource.indexOf("const baseImportFieldDefinitions"),
  );
  assert.ok(serverSource.includes("function normalizeCandidateIdentityId"));
  assert.ok(serverSource.includes("function validateCandidateIdentityId"));
  assert.ok(serverSource.includes("function candidateIdentityChecksum"));
  assert.ok(serverSource.includes("function normalizeCandidateMobile"));
  assert.ok(serverSource.includes("function validateCandidateMobile"));
  assert.ok(serverSource.includes("身份证号格式不正确"));
  assert.ok(serverSource.includes("身份证号出生日期不合法"));
  assert.ok(serverSource.includes("身份证号校验码错误"));
  assert.ok(serverSource.includes("手机号不能为空"));
  assert.ok(serverSource.includes("手机号格式不正确"));
  assert.ok(serverSource.includes("手机号必须为 11 位数字"));
  assert.ok(validationBlock.includes("validateCandidateIdentityId(identityId)"));
  assert.ok(validationBlock.includes("validateCandidateMobile(mobile)"));
});

test("candidate import and auto rooms write back task detail state", () => {
  assert.ok(serverSource.includes("async function syncTaskDetailSessionState"));
  const importHandler = serverSource.slice(
    serverSource.indexOf("async function handleCandidateImport"),
    serverSource.indexOf("async function handleRoomsPreview"),
  );
  assert.ok(importHandler.includes("updateTaskSessionProgress(task, sessionId"));
  assert.ok(importHandler.includes("taskSessionImportStepKey(session.sessionType)"));

  const roomsHandler = serverSource.slice(
    serverSource.indexOf("async function handleRoomsAuto"),
    serverSource.indexOf("async function handleCreateJob"),
  );
  assert.ok(roomsHandler.includes("updateTaskSessionProgress(task, sessionId"));
  assert.ok(roomsHandler.includes("sessions_auto_rooms"));
  assert.ok(roomsHandler.includes("sessions_invigilator_export"));

  const detailHandler = serverSource.slice(
    serverSource.indexOf("async function handleTaskDetail"),
    serverSource.indexOf("async function handleTaskHide"),
  );
  assert.ok(detailHandler.includes("syncTaskDetailSessionState(req, syncedTask)"));
});

test("task progress updates stay isolated by requirement index", () => {
  const updateHelper = serverSource.slice(
    serverSource.indexOf("async function updateTaskStep"),
    serverSource.indexOf("async function findVisibleTaskBySessionId"),
  );
  assert.ok(updateHelper.includes("requirementIndex = null"));
  assert.ok(updateHelper.includes("{ taskId, stepKey, status, result, requirementIndex }"));

  const creationJob = serverSource.slice(
    serverSource.indexOf("async function runYikaoApiCreationJob"),
    serverSource.indexOf("async function runPythonJson"),
  );
  assert.ok(creationJob.includes("updateTaskStep(job.taskId, stepKey, status, result, job.requirementIndex)"));

  const syncHandler = serverSource.slice(
    serverSource.indexOf("async function syncTaskDetailSessionState"),
    serverSource.indexOf("async function parseWorkbook"),
  );
  assert.ok(syncHandler.includes("requirementProgress?.[String(requirementIndex)]"));
  assert.ok(syncHandler.includes("}, requirementIndex) || currentTask"));
  assert.ok(syncHandler.includes("mergedRequirementStepSubStatus"));

  const importHandler = serverSource.slice(
    serverSource.indexOf("async function handleCandidateImport"),
    serverSource.indexOf("async function handleRoomsPreview"),
  );
  assert.ok(importHandler.includes("Number(session.requirementIndex || 0)"));

  const roomsHandler = serverSource.slice(
    serverSource.indexOf("async function handleRoomsAuto"),
    serverSource.indexOf("async function handleCreateJob"),
  );
  assert.ok(roomsHandler.includes("mergedRequirementStepSubStatus"));
  assert.ok(roomsHandler.includes("}, requirementIndex);"));
});

test("created courses and paper retry target the selected requirement", () => {
  assert.ok(serverSource.includes("async function persistTaskRequirementCourses(taskId, requirementIndex, courses)"));
  assert.ok(serverSource.includes("examRequirements[normalizedIndex]"));
  assert.ok(serverSource.includes("persistTaskRequirementCourses(job.taskId, job.requirementIndex, courses)"));
  assert.ok(serverSource.includes("existingProjectCourses"));
  assert.equal(serverSource.includes("assignCourseCodesForExamConfig"), false);
  const retryHandler = serverSource.slice(
    serverSource.indexOf("async function handleTaskStepRetry"),
    serverSource.indexOf("function handleEvents"),
  );
  assert.ok(retryHandler.includes("payload.requirementIndex"));
  assert.ok(retryHandler.includes("taskFormalSession(task, requirementIndex)"));
  assert.ok(retryHandler.includes("taskCoursesForChange(task, requirementIndex)"));
  assert.ok(retryHandler.includes("runPaperFormBindForTask(task, login, { requirementIndex })"));
  const paperBindRunner = serverSource.slice(
    serverSource.indexOf("async function runPaperFormBindForTask"),
    serverSource.indexOf("async function runScheduledPaperBindingOnce"),
  );
  assert.ok(paperBindRunner.includes("examDate: formalSession?.start"));
});

test("monitor account export uses monitor session URL instead of exam URL", () => {
  assert.ok(serverSource.includes("function monitorSessionUrl"));
  assert.ok(serverSource.includes("https://eztest.org/monitor/session/"));
  assert.equal(serverSource.includes("/exam/session/"), false);
});

test("exam detail monitor download can fall back to cached generated monitor accounts", () => {
  assert.ok(serverSource.includes("async function findCachedMonitorAccounts"));
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleSessionMonitorAccounts"),
    serverSource.indexOf("function normalizeTenantList"),
  );
  assert.ok(handler.includes("findCachedMonitorAccounts(sessionId)"));
  assert.ok(handler.includes("tenantRooms"));
  assert.ok(handler.includes("cachedRooms"));
  assert.ok(serverSource.includes("num: room.num || cached.num || \"\""));
});

test("trial detail can export the live not-started candidate list", () => {
  assert.ok(serverSource.includes("notStartedCandidateExporterScript"));
  assert.ok(serverSource.includes("async function handleNotStartedCandidateDownload(sessionId, req, res)"));
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleNotStartedCandidateDownload"),
    serverSource.indexOf("async function findCachedMonitorAccounts"),
  );
  assert.ok(handler.includes('session.sessionType !== "trial"'));
  assert.ok(handler.includes("fetchAllSessionEntries(login, sessionId, [])"));
  assert.ok(handler.includes('filter((row) => String(row.exam_status || "").trim() === "未开考")'));
  assert.ok(handler.includes("notStartedCandidateExporterScript"));
  assert.ok(serverSource.includes("not-started-candidates\\/download"));
});

test("score processing exposes task endpoint and uses template exporter", () => {
  assert.ok(serverSource.includes("scoreFeedbackExporterScript"));
  assert.ok(serverSource.includes("zipDirectoryScript"));
  assert.ok(serverSource.includes("convertScoreFeedbackToPdf"));
  assert.ok(serverSource.includes("async function handleScoreProcess"));
  assert.ok(serverSource.includes("scoreProcessMatch"));
  assert.ok(serverSource.includes("scoreDownloadMatch"));
  assert.ok(serverSource.includes("scoreReportDownloadMatch"));
  assert.ok(serverSource.includes("score_process"));
  assert.ok(serverSource.includes("成绩处理"));
  assert.ok(serverSource.includes("processedDate"));
  assert.ok(serverSource.includes("payloadPath"));
  assert.ok(serverSource.includes("pdfFileName"));
  assert.ok(serverSource.includes("pdfFilePath"));
  assert.ok(serverSource.includes("function scoreFeedbackDownloadFileName(task, session, format)"));
  assert.ok(serverSource.includes('`${session?.name || task?.projectName || "成绩反馈单"}-成绩反馈单`'));
  assert.ok(serverSource.includes("function scoreReportArchiveFileName(task, session)"));
  assert.ok(serverSource.includes("function scoreFeedbackFormalSessions(task = {})"));
  assert.ok(serverSource.includes("function scoreFeedbackExamTime(sessions = [])"));
  assert.ok(serverSource.includes('format === "pdf"'));
  assert.ok(serverSource.includes('"Content-Type": format === "pdf" ? "application/pdf"'));
  assert.ok(serverSource.includes('"Content-Type": "application/zip"'));
  assert.ok(serverSource.includes("result.pdfFilePath || legacyPdfFilePath"));
  assert.ok(serverSource.includes('encodeURIComponent(scoreFeedbackDownloadFileName(task, formalSession, format))'));
  assert.ok(serverSource.includes('encodeURIComponent(scoreReportArchiveFileName(task, formalSession))'));
  assert.ok(serverSource.includes("await convertScoreFeedbackToPdf({ inputPath: workbookFilePath, outputPath: filePath })"));
});

test("score processing automatically prepares and uploads encrypted OA seal application archive", () => {
  assert.ok(serverSource.includes('from "./score_stamp_application.mjs"'));
  assert.ok(serverSource.includes("createPasswordProtectedScoreArchive"));
  assert.ok(serverSource.includes("scoreStampArchivePassword"));
  assert.ok(serverSource.includes('process.env.SCORE_STAMP_ARCHIVE_PASSWORD || "1234"'));
  const scoreProcessHandler = serverSource.slice(
    serverSource.indexOf("async function runScoreProcessForTask"),
    serverSource.indexOf("async function handleScoreDownload"),
  );
  assert.equal(scoreProcessHandler.includes("tryStartScoreStampApplication"), false);
  assert.equal(scoreProcessHandler.includes("isLoopbackRequest(req)"), false);
  assert.ok(scoreProcessHandler.includes("将通过当前电脑的本机助手自动打开本机 Chrome"));
  assert.ok(serverSource.includes("handleScoreStampApplicationPrepare"));
  assert.ok(serverSource.includes("handleScoreStampApplicationResult"));
  assert.ok(serverSource.includes("publicScoreStampApplicationPayload"));
  assert.ok(serverSource.includes("normalizeScoreStampApplicationResult"));
  assert.ok(serverSource.includes("function parseChromeJsonValue"));
  assert.ok(serverSource.includes("parseChromeJsonValue(raw)"));
  assert.ok(serverSource.includes("uploadFilesToChromeDevToolsFileInput"));
  assert.ok(serverSource.includes("buildScoreStampAttachmentPrepareScript()"));
  assert.ok(serverSource.includes("buildScoreStampApplicationSaveScript()"));
  assert.ok(serverSource.includes("attempts: 1"));
  assert.ok(serverSource.includes("OA 保存后页面已跳转，按已保存处理"));
  assert.ok(serverSource.includes("navigatedAfterSave: Boolean(saveResult.navigatedAfterSave)"));
  assert.ok(serverSource.includes("OA 成绩盖章申请页保存失败"));
  assert.ok(serverSource.includes("saved: Boolean(saveResult.saved)"));
  assert.ok(serverSource.includes("scoreStampApplicationMatch"));
  assert.ok(serverSource.includes("scoreStampApplicationPrepareMatch"));
  assert.ok(serverSource.includes("scoreStampApplicationResultMatch"));
  assert.ok(serverSource.includes("scoreStampArchiveDownloadMatch"));
});

test("score processing fetches paged entry and score data before exporting", () => {
  assert.ok(serverSource.includes("async function fetchAllSessionEntries"));
  assert.ok(serverSource.includes("async function fetchAllSessionScores"));
  assert.ok(serverSource.includes("async function fetchSingleEntryStatus"));
  assert.ok(serverSource.includes("async function fetchSingleEntryScore"));
  assert.ok(serverSource.includes("/entry/${encodeURIComponent(page)}/${encodeURIComponent(perPage)}/"));
  assert.ok(serverSource.includes("/score/${encodeURIComponent(page)}/${encodeURIComponent(perPage)}/"));
  assert.ok(serverSource.includes("/entry/${encodeURIComponent(permit)}/score/"));
  assert.ok(serverSource.includes("mergeEntryAndScoreRows"));
  const handler = serverSource.slice(
    serverSource.indexOf("async function runScoreProcessForTask"),
    serverSource.indexOf("async function handleScoreDownload"),
  );
  assert.ok(handler.includes("getYikaoLoginForTask(task)"));
  assert.equal(handler.includes("getYikaoLoginForRequest(req)"), false);
  assert.ok(handler.includes("const formalSessions = scoreFeedbackFormalSessions(task);"));
  assert.ok(handler.includes('const examName = formalSessions[0]?.name || task.projectName || "正式考试";'));
  assert.equal(handler.includes("const examName = task.projectName || formalSessions[0]?.name"), false);
  assert.equal(handler.includes('(task.sessions || []).find((session) => session.sessionType === "formal")'), false);
  assert.ok(handler.includes("for (const [index, formalSession] of formalSessions.entries())"));
  assert.ok(handler.includes("fetchAllSessionEntries(login, formalSession.session_id"));
  assert.ok(handler.includes("fetchAllSessionScores(login, formalSession.session_id"));
  assert.ok(handler.includes('runTaskState("list_candidates",'));
  assert.ok(handler.includes("sessionId: formalSession.session_id"));
  assert.ok(handler.includes("taskRequirementConfig(task, requirementIndex)"));
  assert.ok(handler.includes("mergeEntryAndScoreRows"));
  assert.ok(handler.includes("attachCourseNamesToCandidates"));
  assert.ok(handler.includes("attachAssessmentReportsToRows({"));
  assert.ok(serverSource.includes('from "./simple_prft_assessment_report.mjs"'));
  assert.ok(serverSource.includes("fetchSimplePrftAssessmentReports({"));
  assert.ok(handler.includes("rowsWithReports.push(...sessionRowsWithReports)"));
  assert.ok(handler.includes("sessionIds: formalSessions.map((session) => String(session.session_id))"));
  assert.ok(handler.includes("sessionCount: formalSessions.length"));
  assert.ok(handler.includes("正式考试 ${formalSessions.length} 场"));
});

test("score processing captures the formal EasyExam card in parallel and schedules after exam end", () => {
  assert.ok(serverSource.includes('from "./easy_exam_archive_screenshot.mjs"'));
  assert.ok(serverSource.includes("captureEasyExamArchiveScreenshots({"));
  assert.ok(serverSource.includes("const screenshotPromise = captureEasyExamArchiveScreenshots"));
  assert.ok(serverSource.includes("archiveScreenshots,"));
  assert.ok(serverSource.includes("function shouldAttemptScheduledScoreProcess"));
  assert.ok(serverSource.includes("async function runScheduledScoreProcessingOnce"));
  assert.ok(serverSource.includes('process.env.SCORE_PROCESS_SCHEDULER_DISABLED !== "1"'));
  assert.ok(serverSource.includes("return !scoreProcessHasArchiveScreenshots(step)"));
});

test("operation archive exposes the screenshot and sends it to the local helper as an attachment", () => {
  assert.ok(serverSource.includes("function operationArchiveScreenshotState"));
  assert.ok(serverSource.includes("async function handleOperationArchiveScreenshot"));
  assert.ok(serverSource.includes("async function handleOperationArchiveEvidenceRefresh"));
  assert.ok(serverSource.includes("async function refreshOperationArchiveActuals"));
  assert.ok(serverSource.includes("refreshOperationArchiveEvidenceDraft(task, { actuals })"));
  assert.ok(serverSource.includes("operationArchiveEvidenceInFlight"));
  assert.ok(serverSource.includes("operation_archive_evidence_refreshed"));
  assert.ok(serverSource.includes("actuals: { ...actuals, refreshedAt: now }"));
  assert.ok(serverSource.includes("archiveScreenshots,"));
  assert.ok(serverSource.includes("async function operationArchiveAttachmentPayloads"));
  assert.ok(serverSource.includes("const attachments = await operationArchiveAttachmentPayloads(task, { required: true })"));
  assert.ok(serverSource.includes("preparation.attachments?.length ? { attachments: preparation.attachments }"));
  assert.ok(serverSource.includes('batchDetailUrl: String(task.config?.operationBatch?.detailUrl || "")'));
  assert.ok(serverSource.includes("preparation.batchDetailUrl ? { batchDetailUrl: preparation.batchDetailUrl }"));
  assert.ok(serverSource.includes("function operationArchiveScheduleInstruction"));
  assert.ok(serverSource.includes("scheduleInstruction: operationArchiveScheduleInstruction(task)"));
  assert.ok(serverSource.includes("function operationBatchPatchFromArchiveSchedule"));
  assert.ok(serverSource.includes("helperResult.scheduleSynchronization"));
  assert.ok(serverSource.includes("reusePreparedArchiveForm"));
  assert.ok(serverSource.includes("function assertOperationArchiveHelperTarget"));
  assert.ok(serverSource.includes("assertOperationArchiveHelperTarget(preparation, helperResult)"));
  assert.ok(serverSource.includes('status = "submit_failed"'));
  assert.ok(serverSource.includes("operation-archive\\/screenshots\\/(\\d+)"));
  assert.ok(serverSource.includes("operation-archive\\/evidence\\/refresh"));
});

test("score report download packages assessment documents from score payload", () => {
  assert.ok(serverSource.includes("function scoreFeedbackPayloadPathFromResult(result = {})"));
  assert.ok(serverSource.includes("function assessmentReportsFromScoreRows(rows = [])"));
  assert.ok(serverSource.includes("function scoreReportCandidateFolderName(row = {}, index = 0)"));
  assert.ok(serverSource.includes("function scoreReportFileName(report = {}, response, reportUrl, index = 0)"));
  assert.ok(serverSource.includes("async function downloadAssessmentReportFiles"));
  assert.ok(serverSource.includes("async function zipDirectory"));
  assert.ok(serverSource.includes("runPythonJson([zipDirectoryScript, sourceDir, zipPath])"));
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleScoreReportDownload"),
    serverSource.indexOf("async function handleTaskHide"),
  );
  assert.ok(handler.includes("scoreFeedbackPayloadPathFromResult(result)"));
  assert.ok(handler.includes("assessmentReportsFromScoreRows(payload.rows || [])"));
  assert.ok(handler.includes("downloadAssessmentReportFiles({ login, reportItems, outputDir: tempDir })"));
  assert.ok(handler.includes("zipDirectory(tempDir, zipPath)"));
  assert.ok(handler.includes("getYikaoLoginForTask(task)"));
  assert.equal(handler.includes("getYikaoLoginForRequest(req)"), false);
  assert.ok(serverSource.includes("scores\\/reports\\/download$"));
});

test("completed API creation jobs do not automatically sync Tencent Docs", () => {
  assert.ok(serverSource.includes('from "./tencent_docs_sync.mjs"'));
  const creationJob = serverSource.slice(
    serverSource.indexOf("async function runYikaoApiCreationJob"),
    serverSource.indexOf("async function runPythonJson"),
  );
  assert.equal(creationJob.includes("syncExamConfigToTencentDocs"), false);
  assert.equal(creationJob.includes("tencentDocsSettingsFromEnv(process.env)"), false);
  assert.ok(creationJob.includes("项目共享大表未自动填写"));
});

test("project shared sheet trigger persists status and syncs formal plus optional trial sessions", () => {
  assert.ok(serverSource.includes("async function handleProjectSharedSheetFill(taskId, req, res)"));
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleProjectSharedSheetFill"),
    serverSource.indexOf("function scoreFeedbackFileName"),
  );
  assert.ok(handler.includes('updateTaskStep(taskId, "project_shared_sheet", "running"'));
  assert.ok(handler.includes("const sessions = (task.sessions || []).filter"));
  assert.ok(handler.includes('session.sessionType === "formal"'));
  assert.ok(handler.includes('session.sessionType === "trial"'));
  assert.equal(handler.includes('(task.sessions || []).find((session) => session.sessionType === "formal")'), false);
  assert.equal(handler.includes('(task.sessions || []).find((session) => session.sessionType === "trial")'), false);
  assert.ok(handler.includes('sessions.some((session) => session.sessionType === "formal")'));
  assert.ok(handler.includes("for (const session of sessions)"));
  assert.ok(handler.includes("normalizeEmail(task.ownerEmail || requestUser?.email || \"\")"));
  assert.ok(handler.includes("platformAccountEmail,"));
  assert.ok(handler.includes("sessionIds: sessions.map((session) => String(session.session_id))"));
  assert.ok(handler.includes("tencentDocsSettingsFromEnv(process.env)"));
  assert.ok(handler.includes("syncExamConfigToTencentDocs"));
  assert.ok(handler.includes('updateTaskStep(taskId, "project_shared_sheet", "success"'));
  assert.ok(handler.includes('updateTaskStep(taskId, "project_shared_sheet", "failed"'));
  assert.ok(serverSource.includes("shared-sheet\\/fill$/"));
  assert.ok(serverSource.includes("handleProjectSharedSheetFill(decodeURIComponent(sharedSheetFillMatch[1]), req, res)"));
});

test("task detail includes stored candidates for SMS notification review", () => {
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleTaskDetail"),
    serverSource.indexOf("async function handleProjectSharedSheetFill"),
  );
  assert.ok(handler.includes('runTaskState("list_candidates"'));
  assert.ok(handler.includes("syncedTask.candidates"));
});

test("project shared sheet fill refreshes session times and login limits from tenant detail", () => {
  const helperBlock = serverSource.slice(
    serverSource.indexOf("function sharedSheetSessionFieldsFromDetail"),
    serverSource.indexOf("async function handleProjectSharedSheetFill"),
  );
  assert.ok(helperBlock.includes("getTenantSessionDetail(login, sessionId)"));
  assert.ok(helperBlock.includes("detail?.start"));
  assert.ok(helperBlock.includes("detail?.end"));
  assert.ok(helperBlock.includes("clientLoginLimit"));
  assert.ok(helperBlock.includes("login_times"));
  assert.ok(helperBlock.includes("lock_screen_time"));
  assert.ok(helperBlock.includes("无法保证 L 列与考试配置一致"));

  const handler = serverSource.slice(
    serverSource.indexOf("async function handleProjectSharedSheetFill"),
    serverSource.indexOf("function scoreFeedbackFileName"),
  );
  assert.ok(handler.includes("const login = getYikaoLoginForTask(task);"));
  assert.ok(handler.includes("await enrichSharedSheetSessions(login, sessions, logs)"));
  assert.ok(handler.indexOf("await enrichSharedSheetSessions(login, sessions, logs)") < handler.indexOf("syncExamConfigToTencentDocs"));
});

test("candidate import configures selected import fields as visible personal fields before importing", () => {
  assert.ok(serverSource.includes("const {"));
  assert.ok(serverSource.includes("selectedImportFields"));
  assert.ok(serverSource.includes("buildSelectedImportFields(payload?.field_mapping || {}, payload?.custom_fields || [])"));
  assert.ok(serverSource.includes("excludedPersonalSyncBaseKeys"));
  assert.ok(serverSource.includes("ensureSessionCustomPersonalFields(login, sessionId, selectedImportFields)"));
  assert.ok(serverSource.includes("syncImportPersonalFields"));
  const importHandler = serverSource.slice(serverSource.indexOf("async function handleCandidateImport"));
  assert.ok(importHandler.indexOf("ensureSessionCustomPersonalFields(login, sessionId, selectedImportFields)") < importHandler.indexOf("postCandidatesToTenant("));
  assert.ok(importHandler.indexOf("customFieldMappings") < importHandler.indexOf("postCandidatesToTenant("));
});

test("candidate personal field setup reads original session config and updates by PUT", () => {
  const setupFn = serverSource.slice(
    serverSource.indexOf("async function getTenantSessionDetail"),
    serverSource.indexOf("async function handleCandidateTemplate"),
  );
  assert.ok(setupFn.includes("getTenantSessionDetail(login, sessionId)"));
  assert.ok(setupFn.includes("获取原场次配置"));
  assert.ok(setupFn.includes("buildSessionPersonalPutPayload"));
  assert.ok(setupFn.includes('method: "PUT"'));
  assert.ok(setupFn.includes("场次信息项同步失败"));
});

test("candidate personal field setup builds PUT payload after merging personal fields", () => {
  const setupFn = serverSource.slice(
    serverSource.indexOf("async function ensureSessionCustomPersonalFields"),
    serverSource.indexOf("async function getSessionImportState"),
  );
  assert.ok(setupFn.indexOf("syncImportPersonalFields") < setupFn.indexOf("buildSessionPersonalPutPayload"));
  assert.ok(setupFn.indexOf("buildSessionPersonalPutPayload") < setupFn.indexOf('method: "PUT"'));
  assert.ok(setupFn.includes('method: "PUT"'));
  assert.ok(setupFn.includes("场次信息项同步失败"));
});
