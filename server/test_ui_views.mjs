import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(rootDir, "outputs/web_prototype/easy_exam_automation.html"), "utf8");

function sourceBetween(start, end) {
  const startIndex = html.indexOf(start);
  assert.ok(startIndex >= 0, `missing source start: ${start}`);
  const endIndex = html.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing source end: ${end}`);
  return html.slice(startIndex, endIndex);
}

function compileInlineFunction(start, end, dependencies = {}) {
  const source = sourceBetween(start, end).trim();
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  return Function(...names, `return (${source});`)(...values);
}

test("hidden views cannot be overridden by component display styles", () => {
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test("auto configuration logs render API error responses as text", () => {
  const renderLogs = sourceBetween("function renderLogs()", "function addLog");
  assert.match(renderLogs, /escapeHtml\(entry\.message\)/);
  assert.doesNotMatch(renderLogs, /\$\{entry\.message\}/);
});

test("navigation orders project management, exam list, then auto configuration", () => {
  const nav = html.slice(html.indexOf('<nav class="nav"'), html.indexOf("</nav>"));
  const projectIndex = nav.indexOf('id="projectNavBtn"');
  const examIndex = nav.indexOf('id="examNavBtn"');
  const autoIndex = nav.indexOf('id="autoNavItem"');
  assert.ok(projectIndex >= 0 && examIndex >= 0 && autoIndex >= 0);
  assert.ok(projectIndex < examIndex && examIndex < autoIndex);
});

test("requirements and template pages remain routable without sidebar entries", () => {
  assert.ok(html.includes('id="requirementsNavBtn" data-route-menu="requirements" type="button" hidden'));
  assert.ok(html.includes('id="templatesNavBtn" data-route-menu="templates" type="button" hidden'));
  assert.ok(html.includes('RequirementListPage({ root: requirementsView, loadRequirements })'));
  assert.ok(html.includes('staticPage("templates", templatesView)'));
});

test("exam list room count uses the confirmed class icon asset", () => {
  assert.ok(html.includes("class-count-icon"));
  assert.ok(html.includes("class-icon-exact-person-blue"));
  assert.ok(html.includes('title="班级数"'));
});

test("platform pages do not render feature introduction panels", () => {
  assert.equal(html.includes('<h2 class="panel-title">功能介绍</h2>'), false);
});

test("auto configuration progress uses a unified visual workflow", () => {
  assert.ok(html.includes('class="auto-workflow-card"'));
  assert.ok(html.includes('class="workflow-step-icon"'));
  assert.ok(html.includes('class="workflow-connector"'));
  assert.equal(html.includes(".step:not(:last-child)::after"), false);
  assert.ok(html.includes('class="workflow-progress-copy"'));
  assert.ok(html.includes('data-metric-icon="fields"'));
  assert.ok(html.includes('data-metric-icon="status"'));
  assert.ok(html.includes('识别配置项<span class="metric-icon"'));
  assert.equal(html.includes(".metric::after"), false);
  assert.ok(html.includes("@container (max-width: 430px)"));
  assert.ok(html.includes("grid-template-columns: 1fr;"));
  assert.ok(html.includes("bottom: 6px;"));
});

test("URL page layout replaces shared showView content switching", () => {
  assert.ok(html.includes('import { createRouter } from "/web/router.mjs"'));
  assert.ok(html.includes("ProjectListPage({ root: projectManagementView"));
  assert.ok(html.includes("ExamListPage({ root: examListView"));
  assert.ok(html.includes("RequirementListPage({ root: requirementsView"));
  assert.ok(html.includes("RequirementDetailPage({ root: requirementDetailView"));
  assert.ok(html.includes('staticPage("wechat-collector", wechatCollectorView, loadWechatCollector'));
  assert.equal(html.includes("function showView"), false);
  assert.equal(html.includes("syncActiveNavByScroll"), false);
});

test("requirement center renders list and detail surfaces", () => {
  assert.ok(html.includes('id="requirementsList"'));
  assert.ok(html.includes('id="requirementWorkQueueFilters"'));
  assert.ok(html.includes("需求处理工作台"));
  assert.ok(html.includes("renderRequirementWorkQueueFilters"));
  assert.ok(html.includes("requirementNextAction"));
  assert.ok(html.includes("data-requirement-filter"));
  assert.ok(html.includes("有待处理变更"));
  assert.ok(html.includes("处理变更"));
  assert.ok(html.includes("审核需求"));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes('id="requirementNextStep"'));
  assert.ok(html.includes("当前处理建议"));
  assert.ok(html.includes("renderRequirementNextStep"));
  assert.ok(html.includes("优先处理客户变更"));
  assert.ok(html.includes("生成客户补充话术"));
  assert.ok(html.includes("标记客户已确认，可进入执行"));
  assert.ok(html.includes("<details open><summary>2. 当前可执行操作</summary>"));
  assert.ok(html.includes("<details><summary>3. 变更与确认记录</summary>"));
  assert.ok(html.includes("<details><summary>4. 审计记录</summary>"));
  assert.ok(html.includes('id="requirementClarificationBtn"'));
  assert.ok(html.includes('id="requirementClarificationQuestions"'));
  assert.ok(html.includes('id="requirementClarificationPrompt"'));
  assert.ok(html.includes('id="requirementReviewedBtn"'));
  assert.ok(html.includes('id="requirementMarkReadyBtn"'));
  assert.ok(html.includes('id="requirementLinkTaskBtn"'));
  assert.ok(html.includes('id="requirementTimeline"'));
  assert.ok(html.includes('id="requirementVersions"'));
  assert.ok(html.includes('id="requirementChanges"'));
  assert.ok(html.includes('id="requirementAnalysisCandidates"'));
  assert.ok(html.includes('id="requirementSource"'));
  assert.ok(html.includes('id="requirementAuditMessage"'));
  assert.ok(html.includes("ready_for_manual_execution"));
  assert.ok(html.includes("renderRequirementChangeRequests"));
  assert.ok(html.includes('data-change-action="accept"'));
  assert.ok(html.includes('data-change-action="reject"'));
  assert.ok(html.includes("/change-requests/"));
  assert.ok(html.includes("change_request_accepted"));
  assert.ok(html.includes("change_request_rejected"));
  assert.ok(html.includes("formatRequirementChangeFields"));
  assert.ok(html.includes("formatRequirementChangeRecord"));
  assert.ok(html.includes("isDisplayableRequirementChangeField"));
  assert.ok(html.includes('["watermark_enabled", "copy_forbidden"].includes(field)'));
  assert.ok(html.includes("采纳并生成新版本"));
  assert.ok(html.includes("驳回此次变更"));
  assert.ok(html.includes("采纳后会生成新的需求版本；驳回后不会修改当前需求。"));
  assert.ok(html.includes("0. 解析结果确认"));
  assert.ok(html.includes("规则解析和 LLM 候选解析都会在这里展示"));
  assert.ok(html.includes("renderRequirementAnalysisCandidates"));
  assert.ok(html.includes("latestAnalysisCandidateEvent"));
  assert.ok(html.includes("LLM 候选"));
  assert.ok(html.includes("规则与 LLM 冲突"));
  assert.ok(html.includes("发给客户的补充问题"));
  assert.ok(html.includes("1. 核对需求内容"));
  assert.ok(html.includes("先看最新需求、缺失项和原始来源"));
  assert.equal(html.includes("2. 人工审核处理"), false);
  assert.ok(html.includes("微信群模式下，审核动作只处理需求单状态，不会反向操作微信群"));
  assert.ok(html.includes("要求客户补充：信息不完整时生成可复制的话术"));
  assert.ok(html.includes("内部审核通过，待客户确认：内容完整但还需要客户最终确认"));
  assert.ok(html.includes("标记可进入执行：客户确认后交给执行侧创建考试任务"));
  assert.ok(html.includes("关联执行任务编号：记录后续创建出的考试任务，便于从需求追踪到执行结果"));
  assert.ok(html.includes("3. 变更与确认记录"));
  assert.ok(html.includes("4. 审计记录"));
  assert.ok(html.includes("formatRequirementEvent"));
  assert.ok(html.includes("parseRequirementSource"));
  assert.ok(html.includes("微信群"));
  assert.ok(html.includes("采集时间"));
  assert.equal(html.includes("JSON.stringify(item.payload || {})"), false);
  assert.equal(html.includes("JSON.stringify(item.changes || {})"), false);
});

test("WeChat collector page renders config and scheduler status surfaces", () => {
  const wechatSystemConfigPanel = sourceBetween(
    '<details class="system-config-section system-config-wechat-section" id="wechatCollectorSystemConfigPanel">',
    '\n          </div></div>\n          </details>\n        </section>\n        <section class="task-view" id="userManagementView" hidden>',
  );
  const wechatSystemConfigIds = [
    "wechatCollectorLaunchSummary",
    "dryRunWechatCollectorBtn",
    "runWechatPipelineSmokeBtn",
    "runWechatCollectorOnceBtn",
    "wechatCollectorPreflight",
    "wechatPipelineSmoke",
    "wechatCollectorRequirementCenter",
    "wechatLlmEnabled",
    "loadWechatLlmModelsBtn",
    "saveWechatLlmConfigBtn",
    "installWechatCollectorAutomationBtn",
    "uninstallWechatCollectorAutomationBtn",
    "wechatCollectorGoLive",
    "installWechatCollectorServiceBtn",
    "uninstallWechatCollectorServiceBtn",
    "wechatCollectorService",
    "installWechatCollectorSchedulerBtn",
    "uninstallWechatCollectorSchedulerBtn",
    "wechatCollectorScheduler",
  ];
  for (const id of wechatSystemConfigIds) {
    assert.ok(wechatSystemConfigPanel.includes(`id="${id}"`), `${id} must remain inside the WeChat system configuration card`);
  }
  assert.equal((wechatSystemConfigPanel.match(/<details class="wechat-system-config-section">/g) || []).length, 5);
  assert.equal(wechatSystemConfigPanel.includes('<details class="wechat-system-config-section" open'), false);
  assert.ok(wechatSystemConfigPanel.includes('<details class="wechat-system-config-section"><summary>微信采集上线状态</summary>'));
  assert.ok(wechatSystemConfigPanel.includes('<details class="wechat-system-config-section"><summary>1. 初始化验证 / 上线前检查</summary>'));
  assert.ok(wechatSystemConfigPanel.includes('<details class="wechat-system-config-section"><summary>LLM 候选解析</summary>'));
  assert.ok(wechatSystemConfigPanel.includes('<details class="wechat-system-config-section"><summary>2. 上线自动采集</summary>'));
  assert.ok(wechatSystemConfigPanel.includes('<details class="wechat-system-config-section"><summary>高级维护：服务与定时任务</summary>'));
  assert.ok(html.includes('id="wechatCollectorNavBtn"'));
  assert.ok(html.includes('id="systemConfigNavBtn"'));
  assert.ok(html.includes('id="wechatCollectorView"'));
  assert.ok(html.includes('id="systemConfigView"'));
  assert.ok(html.includes('id="wechatCollectorReadiness"'));
  assert.ok(html.includes('id="wechatCollectorGoLive"'));
  assert.ok(html.includes('id="wechatCollectorConfig"'));
  assert.ok(html.includes('id="wechatCollectorConfigBackups"'));
  assert.ok(html.includes('id="wechatCollectorStatus"'));
  assert.ok(html.includes('id="wechatCollectorHistory"'));
  assert.ok(html.includes('id="wechatCollectorPreflight"'));
  assert.ok(html.includes('id="wechatPipelineSmoke"'));
  assert.ok(html.includes('id="wechatCollectorLogs"'));
  assert.ok(html.includes('id="wechatCollectorService"'));
  assert.ok(html.includes('id="wechatCollectorScheduler"'));
  assert.ok(html.includes('id="wechatCollectorRequirementCenter"'));
  assert.ok(html.includes('id="installWechatCollectorServiceBtn"'));
  assert.ok(html.includes('id="uninstallWechatCollectorServiceBtn"'));
  assert.ok(html.includes('id="installWechatCollectorSchedulerBtn"'));
  assert.ok(html.includes('id="uninstallWechatCollectorSchedulerBtn"'));
  assert.ok(html.includes('id="installWechatCollectorAutomationBtn"'));
  assert.ok(html.includes('id="uninstallWechatCollectorAutomationBtn"'));
  assert.ok(html.includes('id="refreshWechatCollectorBtn"'));
  assert.ok(html.includes('id="dryRunWechatCollectorBtn"'));
  assert.ok(html.includes('id="runWechatCollectorOnceBtn"'));
  assert.ok(html.includes('id="runWechatPipelineSmokeBtn"'));
  assert.ok(html.includes('id="addWechatGroupBtn"'));
  assert.equal(html.includes('id="saveWechatCollectorConfigBtn"'), false);
  assert.ok(html.includes('data-wechat-action="remove"'));
  assert.ok(html.includes('data-wechat-action="run-once"'));
  assert.ok(html.includes("renderWechatCollectorReadiness"));
  assert.ok(html.includes("微信群配置"));
  assert.ok(html.includes("1. 配置微信群"));
  assert.ok(html.includes("采集边界：可见群聊 OCR · 需求中心人工确认 · 已下载附件按本群可见文件名关联 · 不自动下载群文件"));
  assert.equal(html.includes("<h2 class=\"panel-title\">当前能力</h2>"), false);
  assert.ok(html.includes("每个微信群独立保存设置"));
  assert.equal(html.includes(">保存微信群配置<"), false);
  assert.ok(html.includes("wechat-group-card"));
  assert.ok(html.includes("wechat-group-summary"));
  assert.ok(html.includes("#wechatCollectorConfig"));
  assert.ok(html.includes("min-height: 0"));
  assert.ok(html.includes("max-height: 720px"));
  assert.ok(html.includes("项目：${safeText(group.project_name || \"未填写项目\")}"));
  assert.ok(html.includes("关联需求单编号"));
  assert.ok(html.includes("可留空。填入后，本群后续采集和变更会归到这张需求单；不填则首次有效采集时新建需求。"));
  assert.ok(html.includes('data-wechat-field="requirement_request_id"'));
  assert.ok(html.includes("保存本群设置"));
  assert.ok(html.includes('data-wechat-action="save-group"'));
  assert.ok(html.includes("群设置操作"));
  assert.equal(html.includes("<details><summary>群设置操作</summary>"), false);
  assert.ok(html.includes("<details><summary>高级：配置备份与恢复</summary>"));
  assert.ok(html.includes("<details><summary>3. 排障日志</summary>"));
  assert.ok(html.includes("最近运行摘要"));
  assert.ok(html.includes("只保留最近摘要，详细排障看群卡片或日志"));
  assert.equal(html.includes("<h2 class=\"panel-title\">配置备份与恢复</h2>"), false);
  assert.ok(html.includes("任务执行状态"));
  assert.ok(html.includes("需求更新记录"));
  assert.ok(html.includes("renderWechatGroupRequirementTimeline"));
  assert.ok(html.includes("renderWechatGroupRequirementUpdates"));
  assert.ok(html.includes("renderWechatGroupRequirementChanges"));
  assert.ok(html.includes("采集运行记录"));
  assert.ok(html.includes("客户变更记录"));
  assert.ok(html.includes("查看需求单详情"));
  assert.ok(html.includes('<h2 class="panel-title">需求更新记录</h2></div><div class="view-actions">${renderWechatRequirementDetailButton(effectiveRequestId)}</div>'));
  assert.equal(html.includes('const actions = `<div class="view-actions" style="margin-top:10px;"><button class="btn" data-wechat-action="open-requirement"'), false);
  assert.ok(html.includes("字段变更"));
  assert.ok(html.includes("本群已关联需求单，可在这里核对最近客户变更。"));
  assert.equal(html.includes("<h2 class=\"panel-title\">关联需求字段变更</h2>"), false);
  assert.ok(html.includes("messageCount"));
  assert.ok(html.includes("changeCount"));
  assert.ok(html.includes("1. 初始化验证"));
  assert.ok(html.includes("环境预检"));
  assert.ok(html.includes("立即采集"));
  assert.ok(html.includes("每个启用群上线前都需要在配置表对应行执行“立即采集本群”"));
  assert.ok(html.includes("识别到新需求或变更时会推送需求中心并更新 checkpoint"));
  assert.ok(html.includes("2. 上线自动采集"));
  assert.ok(html.includes("上线前必须完成"));
  assert.ok(html.includes("3. 高级维护"));
  assert.ok(html.includes("renderWechatCollectorGoLive"));
  assert.ok(html.includes("setWechatCollectorInstallAvailability"));
  assert.ok(html.includes("installWechatCollectorSchedulerBtn.disabled = !available;"));
  assert.ok(html.includes("installWechatCollectorAutomationBtn.disabled = !available;"));
  assert.ok(html.includes('const missingLabels = checks.filter((item) => !item.ok).map((item) => item.label);'));
  assert.ok(html.includes("上线前必须完成"));
  assert.ok(html.includes("配置合法"));
  assert.ok(html.includes("config_valid"));
  assert.ok(html.includes('readinessChecks.find((item) => item.key === "pipeline_smoke")'));
  assert.ok(html.includes("const smokeOk = Boolean(smokeCheck.ok);"));
  assert.equal(html.includes("const smokeOk = Boolean(statusData.pipelineSmoke?.ok);"), false);
  assert.ok(html.includes('readinessChecks.find((item) => item.key === "requirement_push")'));
  assert.ok(html.includes("const realPushOk = Boolean(realPushCheck.ok);"));
  assert.equal(html.includes('latestRunGroups.filter((group) => group.status === "pushed")'), false);
  assert.ok(html.includes("真实微信试跑"));
  assert.ok(html.includes("立即采集本群"));
  assert.ok(html.includes("定时已安装并加载"));
  assert.ok(html.includes("renderWechatCollectorLogs"));
  assert.ok(html.includes("renderWechatCollectorScheduler"));
  assert.ok(html.includes("renderWechatCollectorService"));
  assert.ok(html.includes("手动服务可达"));
  assert.ok(html.includes("LaunchAgent 常驻"));
  assert.ok(html.includes("不自动下载群文件"));
  assert.ok(html.includes("renderWechatCollectorRequirementCenter"));
  assert.ok(html.includes("renderWechatCollectorRunGroups"));
  assert.ok(html.includes("renderWechatCollectorHistory"));
  assert.ok(html.includes('const fallbackStatus = item.status || "unknown";'));
  assert.ok(html.includes('const statusText = groups.length ? groupStatusText : wechatCollectorStatusLabel(fallbackStatus);'));
  assert.ok(html.includes('const failed = fallbackStatus === "failed" || fallbackStatus === "skipped"'));
  assert.ok(html.includes("运行历史"));
  assert.ok(html.includes("taskViewState.wechatGroupStatuses = statusData.groups || []"));
  assert.ok(html.includes("renderWechatCollectorConfig(groups, taskViewState.wechatGroupStatuses, taskViewState.wechatHistory)"));
  assert.ok(html.includes("renderWechatCollectorConfigBackups(statusData.configBackups"));
  assert.ok(html.includes("配置备份与恢复"));
  assert.ok(html.includes('data-wechat-action="restore-config"'));
  assert.ok(html.includes("/api/wechat-collector/config/restore"));
  assert.ok(html.includes("restoreWechatCollectorConfigBackup"));
  assert.ok(html.includes("latestStatus"));
  assert.ok(html.includes("status.latestError ? `错误：${status.latestError}` : \"\""));
  assert.ok(html.includes("checkpointUpdatedAt"));
  assert.ok(html.includes("下次运行"));
  assert.ok(html.includes("renderWechatCollectorPreflight"));
  assert.equal(html.includes("附件扫描排障"), false);
  assert.equal(html.includes("扫描已下载文件"), false);
  assert.ok(html.includes("本群附件"));
  assert.ok(html.includes("本群最近一次采集未关联已下载附件"));
  assert.ok(html.includes('data-wechat-action="show-attachments"'));
  assert.ok(html.includes("系统配置"));
  assert.ok(html.includes("微信采集配置"));
  assert.ok(html.includes('<details class="system-config-section system-config-wechat-section" id="wechatCollectorSystemConfigPanel"><summary><div><h2 class="panel-title">微信采集配置</h2><p class="subtitle">微信采集所需的状态、环境检查、链路验证、解析配置、安装和维护均在本卡片内完成。</p></div></summary>\n          <div class="view-actions system-config-section-header-actions"><button class="btn primary" id="installWechatCollectorAutomationBtn" type="button" disabled title="等待上线前检查">安装自动采集</button></div>\n          <div class="panel system-config-section-panel"><div class="panel-body">'));
  assert.equal(html.includes('<h2 class="panel-title">2. 上线自动采集</h2><p class="subtitle">只有“上线前必须完成”全部通过后，才安装定时自动采集。</p></div><div class="view-actions"><button class="btn" id="installWechatCollectorAutomationBtn"'), false);
  assert.ok(html.includes('id="wechatCollectorLaunchSummary"'));
  assert.ok(html.includes("微信采集上线状态"));
  assert.ok(html.includes("renderWechatCollectorLaunchSummary"));
  assert.ok(html.includes("上线前检查"));
  assert.ok(html.includes("检查本机采集环境"));
  assert.ok(html.includes("去微信采集页逐群验证"));
  assert.ok(html.includes("批量真实采集所有启用群"));
  assert.ok(html.includes("<details><summary>高级操作：批量真实采集</summary>"));
  assert.ok(html.includes("<details class=\"wechat-system-config-section\"><summary>高级维护：服务与定时任务</summary>"));
  assert.ok(html.includes("一般不用改 Endpoint"));
  assert.ok(html.includes("清空已保存密钥"));
  assert.ok(html.includes("LLM 候选解析"));
  assert.equal(html.includes("cc-connect 新消息采集"), false);
  assert.equal(html.includes("/api/wechat-collector/cc-connect/"), false);
  assert.equal(html.includes("Homebrew"), false);
  assert.equal(html.includes('id="wechatCcConnectStatus"'), false);
  assert.equal(html.includes("renderWechatCcConnectStatus"), false);
  assert.equal(html.includes("copyWechatCcConnectCommand"), false);
  assert.ok(html.includes('id="wechatLlmEnabled"'));
  assert.ok(html.includes('id="wechatLlmProvider"'));
  assert.ok(html.includes('<option value="qwen">千问'));
  assert.ok(html.includes('id="wechatLlmApiKey"'));
  assert.ok(html.includes('id="loadWechatLlmModelsBtn"'));
  assert.ok(html.includes('id="saveWechatLlmConfigBtn"'));
  assert.ok(html.includes("renderWechatLlmConfig"));
  assert.ok(html.includes("renderWechatLlmModelOptions"));
  assert.ok(html.includes("loadWechatLlmModels"));
  assert.ok(html.includes("collectWechatLlmConfig"));
  assert.ok(html.includes('apiKey: wechatLlmApiKey.value.replace(/\\s+/g, "")'));
  assert.ok(html.includes("/api/wechat-collector/llm/models"));
  assert.ok(html.includes("apiKeyConfigured"));
  assert.ok(html.includes("1. 配置微信群"));
  assert.ok(html.includes("2. 运行监控"));
  assert.ok(html.includes("3. 排障日志"));
  assert.ok(html.includes("配置备份与恢复"));
  assert.ok(html.includes("附件只在本群最近一次采集中按可见文件名关联"));
  assert.ok(html.includes("staticPage(\"system-config\", systemConfigView, loadWechatCollector"));
  assert.ok(html.includes('name === "system-config" ? loadSystemConfiguration : enter'));
  assert.ok(html.includes("renderWechatPipelineSmoke(statusData.pipelineSmoke || {})"));
  assert.ok(html.includes("const freshnessText = result.ok ? (result.fresh ? \"有效\" : (result.stale ? \"已过期\" : \"待确认\")) : \"未通过\";"));
  assert.ok(html.includes("完成：${formatTaskTime(result.finishedAt)}"));
  assert.ok(html.includes("skipped_interval"));
  assert.ok(html.includes("no_new_messages"));
  assert.ok(html.includes("captureMode"));
  assert.ok(html.includes("screenshotPath"));
  assert.ok(html.includes("captureRect"));
  assert.equal(html.includes('data-wechat-field="incremental_source"'), false);
  assert.equal(html.includes('data-wechat-field="cc_connect_chat_id"'), false);
  assert.equal(html.includes('data-wechat-action="fill-chat-id"'), false);
  assert.equal(html.includes("ccConnectLastMessageId"), false);
  assert.ok(html.includes("采集：OCR 可见窗口"));
  assert.ok(html.includes("采集方式：OCR 当前窗口/定时可见窗口"));
  assert.ok(html.includes("截图区域：${safeText(group.captureRect)}"));
  assert.ok(html.includes("ocrCommand"));
  assert.ok(html.includes("nextRunAt"));
  assert.ok(html.includes("附件候选：${Number(group.attachmentCandidateCount || 0)} · 已关联：${Number(group.attachmentCount || 0)}"));
  assert.ok(html.includes("附件过滤"));
  assert.ok(html.includes("installWechatCollectorService"));
  assert.ok(html.includes("uninstallWechatCollectorService"));
  assert.ok(html.includes("installWechatCollectorAutomation"));
  assert.ok(html.includes("uninstallWechatCollectorAutomation"));
  assert.ok(html.includes("confirmWechatSideEffect"));
  assert.ok(html.includes("会激活微信"));
  assert.ok(html.includes("LaunchAgent"));
  assert.ok(html.includes("runWechatCollectorOnce"));
  assert.ok(html.includes("runWechatCollectorGroupOnce"));
  assert.ok(html.includes("saveWechatCollectorGroup"));
  assert.ok(html.includes("groupName"));
  assert.ok(html.includes("await loadWechatCollector()"));
  assert.ok(html.includes("dryRunWechatCollector"));
  assert.ok(html.includes("showWechatGroupAttachmentStatus"));
  assert.ok(html.includes("runWechatPipelineSmoke"));
  assert.ok(html.includes("/api/wechat-collector/pipeline-smoke-test"));
  assert.ok(html.includes("fetchWechatPipelineSmoke"));
  assert.ok(html.includes("return { httpOk: response.ok, status: response.status, data };"));
  assert.ok(html.includes("renderWechatPipelineSmoke(result.data?.result || { ok: false, error: result.data?.error ||"));
  assert.ok(html.includes("/api/wechat-collector/dry-run"));
  assert.ok(html.includes("installWechatCollectorScheduler"));
  assert.ok(html.includes("uninstallWechatCollectorScheduler"));
  assert.ok(html.includes("collectWechatCollectorConfig"));
  assert.ok(html.includes("validateWechatCollectorConfig"));
  assert.ok(html.includes("wechatIntervalInputValue"));
  assert.equal(html.includes("Number(group.interval_minutes || 15)"), false);
  assert.equal(html.includes('value("interval_minutes") || "15"'), false);
  assert.ok(html.includes("采集间隔必须是大于等于 1 的整数"));
  assert.ok(html.includes("微信群名称重复"));
  assert.ok(html.includes("removeWechatCollectorRow"));
  assert.ok(html.includes("/api/wechat-collector/config"));
  assert.ok(html.includes("/api/wechat-collector/status"));
  assert.ok(html.includes('method: "PUT"'));
  assert.ok(html.includes("result.backupPath"));
  assert.ok(html.includes("已备份上一版配置"));
  assert.ok(html.includes("await loadWechatCollector()"));
  assert.ok(html.includes("${label}已保存，正在刷新状态"));
});

test("auto config page renders customer service scheduler controls", () => {
  assert.ok(html.includes('id="customerServiceSchedulerProfiles"'));
  assert.ok(html.includes('id="customerServiceSchedulerRunBtn"'));
  assert.ok(html.includes("/api/customer-service-scheduler"));
  assert.ok(html.includes("/api/customer-service-scheduler/run"));
  assert.ok(html.includes("renderCustomerServiceSchedulerProfiles"));
  assert.ok(html.includes("data-customer-service-action"));
  assert.ok(html.includes("在线客服定时"));
  assert.ok(html.includes('id="customerServiceSchedulerRunBtn" type="button">立即运行</button>'));
  assert.ok(html.includes("async function runCustomerServiceSchedulerNow()"));
  assert.ok(html.includes("JSON.stringify({ dryRun: false })"));
  assert.ok(html.includes('customerServiceSchedulerRunBtn.textContent = "运行中..."'));
  assert.ok(html.includes("实际调整 ${summary.updated || 0} 个"));
  assert.equal(html.includes("runCustomerServiceSchedulerDryRun"), false);
  assert.equal(html.includes('id="loginState"'), false);
  assert.equal(html.includes('id="customerServiceSchedulerState"'), false);
  assert.equal(html.includes("选择一个账号用于新建考试、读取场次和导入考生。"), false);
  assert.equal(html.includes("开考前 24 小时自动开启，考试结束后自动关闭，每小时巡检一次。"), false);
  assert.ok(html.includes('<span class="panel-title">自动配置账号</span>'));
  assert.ok(html.includes('<span class="panel-title">在线客服定时</span>'));
  assert.ok(html.includes('class="btn primary backend-connection-action" id="addBackendAccountBtn"'));
  assert.ok(html.includes('class="btn primary backend-connection-action" id="customerServiceSchedulerRunBtn"'));
  assert.ok(html.includes('id="configurationAccountProfiles"'));
  assert.ok(html.includes('id="accountEditorModal"'));
  assert.ok(html.includes("accountEditorModal.showModal()"));
  assert.ok(html.includes('data-account-action="current"'));
  assert.ok(html.includes("用于自动配置"));
  assert.ok(html.indexOf('id="configurationAccountProfiles"') < html.indexOf('id="customerServiceSchedulerProfiles"'));
  assert.match(html, /\.account-editor-fields\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(html, /\.account-editor-modal\s*\{[^}]*--account-glass-blur:\s*18px[^}]*background:\s*rgba\(255, 255, 255, 0\.28\)[^}]*backdrop-filter:\s*blur\(var\(--account-glass-blur\)\)/s);
  assert.match(html, /\.scheduler-profile\s*\{[^}]*background:\s*rgba\(248, 250, 252, 0\.52\)[^}]*backdrop-filter:\s*blur\(12px\)/s);
  assert.match(html, /\.scheduler-profile\.is-current\s*\{[^}]*background:\s*rgba\(31, 117, 203, 0\.1\)[^}]*inset 3px 0 0 var\(--blue\)/s);
  assert.ok(html.includes("const orderedConfigurationProfiles = [...profiles].sort((left, right) => Number(right.current) - Number(left.current))"));
  assert.ok(html.includes('class="scheduler-profile${profile.current ? " is-current" : ""}"'));
  assert.match(html, /:root\[data-theme="dark"\] \.account-editor-modal\s*\{[^}]*--account-glass-blur:\s*24px[^}]*background:\s*rgba\(22, 27, 34, 0\.64\)/s);
  assert.match(html, /:root\[data-theme="dark"\] \.scheduler-profile\s*\{[^}]*background:\s*rgba\(31, 38, 48, 0\.44\)/s);
  assert.match(html, /:root\[data-theme="dark"\] \.scheduler-profile\.is-current\s*\{[^}]*background:\s*rgba\(10, 132, 255, 0\.14\)/s);
  assert.ok(html.includes("@keyframes account-editor-in"));
  assert.ok(html.includes("@keyframes account-editor-out"));
  assert.ok(html.includes("from { opacity: 0; backdrop-filter: blur(0); }"));
  assert.ok(html.includes("to { opacity: 1; backdrop-filter: blur(2px); }"));
  assert.ok(html.includes("accountEditorModal.classList.add(\"is-closing\")"));
  assert.ok(html.includes("window.setTimeout(finishClosingAccountEditor, 180)"));
  assert.ok(html.includes('accountEditorModal.addEventListener("cancel"'));
  assert.ok(html.includes('openAccountEditor({ mode: "edit", profile, trigger: button })'));
  assert.ok(html.includes("async function loadAccountEditorCredentials(profileId)"));
  assert.ok(html.includes("/credentials`"));
  assert.ok(html.includes('backendLoginPasswordInput.value = mode === "edit" ? credentials.password || "" : ""'));
  assert.ok(html.includes('tenantApiKeyInput.value = mode === "edit" ? credentials.tenantApiKey || "" : ""'));
  assert.ok(html.includes('await openAccountEditor({ mode: "edit", profile, trigger: button })'));
  assert.ok(html.includes('data-account-action="remark"'));
  assert.ok(html.includes('openAccountEditor({ mode: "remark", profile, trigger: button })'));
  assert.ok(html.includes('const remark = profile.remark ? `<span class="tag blue">'));
  assert.match(html, /\.tag\.blue\s*\{[^}]*background:\s*#eaf3ff[^}]*color:\s*var\(--blue-dark\)/s);
  assert.match(html, /:root\[data-theme="dark"\] \.tag\.blue\s*\{[^}]*background:\s*rgba\(10, 132, 255, 0\.14\)[^}]*color:\s*var\(--blue\)/s);
  assert.ok(html.includes('id="accountRemarkInput"'));
  assert.ok(html.includes('class="btn danger" type="button" data-account-action="delete"'));
  assert.match(html, /\.btn\.danger\s*\{[^}]*border-color:\s*#e7a6a1[^}]*background:\s*#fff1f0[^}]*color:\s*var\(--red\)/s);
  assert.match(html, /:root\[data-theme="dark"\] \.btn\.danger,[\s\S]*background:\s*rgba\(255, 69, 58, 0\.14\)[^}]*color:\s*#ff6961/s);
  assert.ok(html.includes('id="accountDeleteConfirmModal"'));
  assert.ok(html.includes('id="accountDeleteConfirmMessage"'));
  assert.ok(html.includes('id="accountDeleteConfirmBtn"'));
  assert.ok(html.includes("accountDeleteConfirmModal.showModal()"));
  assert.ok(html.includes("openAccountDeleteConfirm(profile, button)"));
  assert.ok(html.includes("await confirmAccountDelete()"));
  assert.ok(html.includes("await deleteCustomerServiceSchedulerProfile(profileId)"));
  assert.ok(html.includes('accountDeleteConfirmModal.addEventListener("cancel"'));
});

test("auto config upload icon sits left of its copy", () => {
  assert.match(html, /#dropZone\s*\{[^}]*grid-template-columns:\s*58px minmax\(0, auto\)[^}]*text-align:\s*left/s);
  assert.match(html, /#dropZone \.file-badge\s*\{[^}]*grid-row:\s*1 \/ 3/s);
  assert.match(html, /#dropZone \.drop-title\s*\{[^}]*grid-column:\s*2/s);
  assert.match(html, /#dropZone \.drop-note\s*\{[^}]*grid-column:\s*2/s);
});

test("long configuration preview fields expand on demand", () => {
  assert.ok(html.includes('new Set(["考前等待提示", "欢迎语", "考试承诺书", "考试承诺书内容"])'));
  assert.ok(html.includes('class="config-preview-disclosure" data-preview-disclosure'));
  assert.ok(html.includes('class="config-preview-value"'));
  assert.ok(html.includes("function togglePreviewDisclosure(disclosure)"));
  assert.ok(html.includes('previewRows.addEventListener("click"'));
  assert.ok(html.includes('previewRows.addEventListener("keydown"'));
  assert.ok(html.includes("max-height: 4.8em"));
});

test("configuration preview hides editable and required field rows", () => {
  assert.ok(html.includes('new Set(["允许编辑字段", "必填字段"])'));
  assert.ok(html.includes('.filter(([, item]) => !hiddenPreviewItems.has(item))'));
  assert.ok(html.includes('["科目管理", "批量导入科目", "语文、数学", "自动生成"]'));
  assert.equal(html.includes("下载后台模板后导入"), false);
});

test("account and customer service settings render as separate collapsed cards", () => {
  assert.equal(html.includes("配置账号管理"), false);
  assert.ok(html.includes('class="panel backend-connection-panel is-collapsed" id="backendConnectionPanel"'));
  assert.ok(html.includes('class="panel backend-connection-panel is-collapsed" id="customerServiceSchedulerPanel"'));
  assert.ok(html.includes('id="backendConnectionToggle"'));
  assert.ok(html.includes('id="customerServiceSchedulerToggle"'));
  assert.ok(html.includes('class="backend-connection-summary" id="backendConnectionToggle"'));
  assert.ok(html.includes('class="backend-connection-summary" id="customerServiceSchedulerToggle"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('aria-controls="backendConnectionBody"'));
  assert.ok(html.includes('aria-controls="customerServiceSchedulerBody"'));
  assert.equal(html.includes('id="backendConnectionToggleText"'), false);
  assert.ok(html.includes('.backend-connection-summary {'));
  assert.ok(html.includes('grid-template-columns: minmax(0, 1fr) auto 18px'));
  assert.match(html, /\.backend-connection-summary\s*\{[^}]*min-height:\s*0[^}]*padding:\s*15px 16px/s);
  assert.match(html, /\.backend-connection-summary \.panel-title\s*\{[^}]*font-weight:\s*700/s);
  assert.match(html, /\.backend-connection-action\s*\{[^}]*right:\s*50px[^}]*height:\s*40px[^}]*min-width:\s*96px[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*line-height:\s*1/s);
  assert.match(html, /\.backend-connection-panel\.is-collapsed \.backend-connection-action\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s);
  assert.match(html, /\.backend-connection-panel:not\(\.is-collapsed\) \.backend-connection-action-slot\s*\{[^}]*width:\s*96px/s);
  assert.ok(
    html.includes(
      'class="backend-connection-content" id="backendConnectionBody" style="max-height: 0px; opacity: 0" inert',
    ),
  );
  assert.ok(
    html.includes(
      'class="backend-connection-content" id="customerServiceSchedulerBody" style="max-height: 0px; opacity: 0" inert',
    ),
  );
  assert.ok(html.includes('class="panel-body backend-connection-content-inner"'));
  assert.match(html, /\.backend-connection-content\s*\{[^}]*transition:\s*max-height 200ms ease-out, opacity 200ms ease-out/s);
  assert.ok(html.includes("function setBackendConnectionExpanded(expanded)"));
  assert.ok(html.includes("function setCustomerServiceSchedulerExpanded(expanded)"));
  assert.ok(html.includes("function setCollapsiblePanelExpanded(panel, toggle, body, expanded)"));
  assert.ok(html.includes('backendConnectionToggle.addEventListener("click"'));
  assert.ok(html.includes('customerServiceSchedulerToggle.addEventListener("click"'));
  assert.ok(html.includes('body.style.maxHeight = `${targetHeight}px`'));
  assert.ok(html.includes("void body.offsetHeight"));
  assert.ok(html.includes('body.style.opacity = expanded ? "1" : "0"'));
});

test("exam list is task-aggregated and exam detail owns dual session cards", () => {
  assert.ok(
    html.includes(
      'import { aggregateExamSessions, isExamTaskEnded, matchesExamTask, resolveCandidateTaskContext, sortTaskLogsNewestFirst } from "/web/exam_task_view_model.mjs"',
    ),
  );
  assert.ok(html.includes('id="taskSessionCards"'));
  assert.ok(html.includes('id="endedExamsToggleBtn"'));
  assert.ok(html.includes('id="examFilterTabs"'));
  assert.ok(html.includes('id="examQueryBtn"'));
  assert.ok(html.includes('id="examStatusFilterBtn"'));
  assert.ok(html.includes('examStatusFilterLabel.textContent = statusCountText(EXAM_LIST_MODE_LABELS[selectedMode], examStatusCounts[selectedMode])'));
  assert.ok(html.includes('button.textContent = statusCountText(EXAM_STATUS_FILTER_OPTION_LABELS[mode], examStatusCounts[mode])'));
  assert.ok(html.includes('id="examTimeFilterBtn"'));
  assert.equal(html.includes('id="refreshExamsBtn"'), false);
  assert.ok(html.includes('class="panel task-detail-overview exam-log-panel is-collapsed" id="examExecutionPanel"'));
  assert.ok(html.includes('id="examExecutionToggle" type="button" aria-expanded="false" aria-controls="examExecutionBody"'));
  assert.ok(html.includes('id="examExecutionBody" style="max-height: 0px; opacity: 0" inert'));
  assert.ok(html.includes("function setExamExecutionExpanded(expanded)"));
  assert.ok(html.includes("setExamExecutionExpanded(false);"));
  assert.ok(html.includes('examExecutionToggle.addEventListener("click"'));
  assert.equal(html.includes('id="examContinueBtn"'), false);
  assert.equal(html.includes('id="examRefreshBtn"'), false);
  assert.equal(html.includes("快捷操作与执行日志"), false);
  assert.equal(html.includes('id="examTimeClearBtn"'), false);
  assert.equal(html.includes("exam-time-clear-btn"), false);
  assert.ok(html.includes('class="exam-filter-menu exam-calendar-menu" id="examTimeFilterMenu"'));
  assert.ok(html.includes('id="examCalendarGrid"'));
  assert.ok(html.includes('data-exam-time-clear'));
  assert.ok(html.includes("function clearExamTimeFilter()"));
  assert.ok(html.includes('data-exam-calendar-date'));
  assert.ok(html.includes("function renderExamTimeCalendar()"));
  assert.ok(html.includes("function setExamCalendarMonth(delta)"));
  assert.ok(html.includes('taskViewState.examTimeFilter = `date:${dateKey}`;'));
  assert.ok(html.includes('data-exam-list-mode="active"'));
  assert.ok(html.includes('class="exam-filter-tab-highlight"'));
  assert.ok(html.includes("查看已结束考试"));
  assert.ok(html.includes('examListMode: "active"'));
  assert.ok(html.includes('const sourceExams = selectedMode === "all" ? timeFilteredAllExams : selectedMode === "ended" ? endedExams : activeExams;'));
  assert.ok(html.includes("function matchesExamTimeFilter(task, filter)"));
  assert.match(html, /\.exam-filter-menu\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(-6px\);[^}]*transition:\s*all 200ms ease-out/s);
  assert.match(html, /\.exam-filter-tab-highlight\s*\{[^}]*transition:\s*all 200ms ease-out/s);
  assert.match(html, /#examListRows\.exam-list-fade-in\s*\{\s*animation:\s*exam-list-fade-in 150ms ease-out;/);
  assert.ok(html.includes("isExamTaskEnded(task)"));
  assert.ok(html.includes("function examTaskWithDetail(task)"));
  assert.ok(html.includes("taskViewState.examTaskDetails[task.taskId]"));
  assert.ok(html.includes("aggregateExamSessions(taskViewState.sessions).map(examTaskWithDetail)"));
  assert.ok(html.includes('const rowStatusChip = (task) => progressChip(currentTaskProgress(task), task.status);'));
  assert.ok(html.includes("taskViewState.examTaskDetails = Object.fromEntries"));
  assert.ok(html.includes("function formatProgressPercent(value)"));
  assert.ok(html.includes("function progressChip(value, status = \"\")"));
  assert.ok(html.includes("function progressTone(progress, status = \"\")"));
  assert.ok(html.includes('if (normalized >= 100) return "complete";'));
  assert.ok(html.includes('if (normalized >= 51) return "major";'));
  assert.ok(html.includes('if (normalized >= 26) return "mid";'));
  assert.ok(html.includes('if (normalized >= 1) return "early";'));
  assert.ok(html.includes("progress-chip.complete"));
  assert.ok(html.includes("progress-chip.early"));
  assert.ok(html.includes("progress-chip.mid"));
  assert.ok(html.includes("progress-chip.major"));
  assert.ok(html.includes("progress-chip.failed"));
  assert.ok(html.includes("${progressTone(progress, status)}"));
  assert.ok(html.includes(".exam-row-status { display: grid; gap: 6px; min-width: 170px;"));
  assert.ok(html.includes(".exam-row-status .progress-chip { width: 160px; min-width: 160px; min-height: 16px; height: 16px; padding: 0 8px;"));
  assert.ok(html.includes("style=\"--progress-fill:${progress}%\""));
  assert.ok(html.includes("data-candidate-task-id"));
  assert.ok(html.includes('placeholder="考试名称 / 场次名称 / 考试口令 / 账号"'));
  assert.ok(html.includes("<th>考试名称</th>"));
  assert.equal(html.includes("<th>项目名称</th>"), false);
  assert.ok(html.includes("<th>正式考试</th><th>试考</th>"));
  assert.ok(html.includes("<th>配置进度</th>"));
  assert.ok(html.includes("<th>考试口令</th>"));
  assert.ok(html.includes("function examNameCell(task)"));
  assert.ok(html.includes("safeText(projectCardTitle(task))"));
  assert.ok(html.includes("function sessionSummaries(sessions, label)"));
  assert.ok(html.includes('sessionSummaries(task.formalSessions, "正式考试")'));
  assert.ok(html.includes('sessionSummaries(task.trialSessions, "试考")'));
  assert.ok(html.includes("统一口令 ${safeText(unifiedCode)}"));
  assert.ok(html.includes('<td>${examNameCell(task)}</td>'));
  assert.ok(html.includes(".exam-unified-code { color: var(--text);"));
  assert.ok(html.includes("function formatSessionTime(session)"));
  assert.ok(html.includes("（ID:${safeText(session.session_id || \"--\")}）"));
  assert.ok(html.includes('<div class="exam-session-time">${formatSessionTime(session)}</div>'));
  assert.ok(html.includes('title="考生数"><svg viewBox="0 0 24 24" aria-hidden="true"'));
  assert.ok(html.includes('title="班级数"><svg viewBox="0 0 24 24" aria-hidden="true"'));
  assert.equal(html.includes('<td>${sessionSummary(task.formalSession, "正式考试")}</td>'), false);
  assert.equal(html.includes('<td>${sessionSummary(task.trialSession, "试考")}</td>'), false);
  assert.ok(html.includes('class="exam-link-button task-detail-btn" data-task-id="${safeText(task.taskId)}" type="button">查看详情</button>'));
  assert.ok(html.includes(".exam-link-button"));
  assert.equal(html.includes('data-action="refresh" type="button" title="刷新" aria-label="刷新"'), false);
  assert.equal(html.includes("/web/assets/refresh-icon.png"), false);
  assert.equal(html.includes(".icon-button.is-spinning img"), false);
  assert.equal(html.includes("@keyframes refresh-spin"), false);
  assert.equal(html.includes('aria-label="刷新">↻</button>'), false);
  assert.equal(html.includes('aria-label="刷新"><svg'), false);
  assert.equal(html.includes("流程进度：${formatProgressPercent(task.progress)}"), false);
  assert.equal(html.includes('<div><div class="task-overview-label">考试口令</div><div class="task-overview-value">${safeText(session.session_id || "--")}</div></div>'), false);
  assert.equal(html.includes('placeholder="考试名称 / 场次名称 / session_id / 账号"'), false);
  assert.equal(html.includes("<th>来源账号</th><th>考生数</th><th>班级数</th>"), false);
  assert.equal(html.includes("<th>session_id</th>"), false);
  assert.equal(html.includes(">session_id<"), false);
  assert.equal(html.includes('id="examTypeFilter"'), false);
});

test("requirement center remains present while exam views change", () => {
  assert.ok(html.includes('id="requirementsView"'));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes("RequirementListPage({ root: requirementsView"));
  assert.ok(html.includes("RequirementDetailPage({ root: requirementDetailView"));
});

test("project and system views expose the selective PR 5 collaboration controls", () => {
  assert.ok(html.includes('id="projectOperationBatchState"'));
  assert.ok(html.includes('id="operationBatchCreateBtn"'));
  assert.ok(html.includes('id="operationBatchRecordBtn"'));
  assert.ok(html.includes('id="contentRequirementEmailRecipients"'));
  assert.ok(html.includes('id="contentRequirementEmailCc"'));
  assert.ok(html.includes('id="operationContentSyncBtn"'));
  assert.ok(html.includes('id="operationContentSyncState"'));
  assert.equal(html.includes('id="contentRequirementEmailSendBtn"'), false);
  assert.ok(html.includes('id="emailSettingsPanel"'));
  assert.ok(html.includes('id="saveEmailSettingsBtn"'));
  assert.ok(html.includes('id="sendEmailTestBtn"'));
  assert.ok(html.includes('<details class="system-config-section system-config-email-section"><summary><div><h2 class="panel-title">邮箱配置</h2><p class="subtitle">使用 Outlook 公司邮箱发送内容任务单。收件人不在这里保存，发送时按项目当次输入。</p></div></summary>\n          <div class="view-actions system-config-section-header-actions"><button class="btn" id="sendEmailTestBtn"'));
  assert.ok(html.includes('<details class="system-config-section system-config-operation-section"><summary><div><h2 class="panel-title">运营控制台自动化环境</h2><p class="subtitle">只检查和修复本机浏览器自动化运行环境；运控账号登录、内网连通由使用者自行保证。</p></div></summary>\n          <div class="view-actions system-config-section-header-actions"><button class="btn" id="checkOperationConsoleEnvironmentBtn"'));
  assert.equal(/<details class="system-config-section[^"]*" open/.test(html), false);
  assert.match(html, /\.system-config-section\s*\{[^}]*border:\s*1px solid var\(--line\)[^}]*border-radius:\s*var\(--radius-card\)[^}]*background:\s*var\(--panel\)[^}]*box-shadow:\s*var\(--shadow\)/s);
  assert.match(html, /\.system-config-section\s*>\s*summary\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*min-height:\s*74px/s);
  assert.equal(html.includes('.system-config-section > summary::before'), false);
  assert.match(html, /\.system-config-section-header-actions\s*\{[^}]*display:\s*none[^}]*position:\s*absolute[^}]*top:\s*17px[^}]*right:\s*16px/s);
  assert.match(html, /\.system-config-section\[open\]\s*>\s*\.system-config-section-header-actions\s*\{\s*display:\s*flex;\s*\}/s);
  assert.match(html, /\.system-config-wechat-section\[open\]\s*>\s*summary\s*\{\s*padding-right:\s*220px;\s*\}/s);
  assert.match(html, /\.system-config-section-panel\s*\{[^}]*border:\s*0[^}]*box-shadow:\s*none/s);
  assert.ok(html.includes("data-requirement-edit-field"));
  assert.ok(html.includes("/staff-edit"));

  assert.ok(html.includes('id="autoConfigStack"'));
  assert.ok(html.includes('id="examListView"'));
  assert.ok(html.includes('id="candidateImportPanel"'));
  assert.ok(html.includes('id="fanweiRequirementTable"'));
});

test("content task email fields match the content exam value typography", () => {
  assert.match(
    html,
    /#contentRequirementEmailRecipients,\s*#contentRequirementEmailCc\s*\{\s*font-size:\s*14px;\s*line-height:\s*1\.55;\s*\}/,
  );
});

test("requirement edit payload includes only dirty fields and preserves intentional clears", () => {
  assert.ok(html.includes("data-requirement-edit-original="));
  assert.ok(html.includes('input.dataset.requirementEditDirty = "true"'));

  const collectProjectRequirementStaffEditPayload = compileInlineFunction(
    "function collectProjectRequirementStaffEditPayload()",
    "function markProjectRequirementEditFieldDirty(input)",
    {
      projectRequirementInline: {
        querySelectorAll() {
          return [
            {
              dataset: { requirementEditField: "exam_name", requirementEditDirty: "false" },
              value: "2026招聘考试",
            },
            {
              dataset: { requirementEditField: "mock_exam_time_range", requirementEditDirty: "true" },
              value: "",
            },
            {
              dataset: { requirementEditField: "subjects", requirementEditDirty: "true" },
              value: "",
            },
          ];
        },
      },
    },
  );

  assert.deepEqual(collectProjectRequirementStaffEditPayload(), {
    fields: {
      mock_exam_time_range: "",
      subjects: [],
    },
  });
});

test("rendering a project clears non-persisted content email recipients and CC", () => {
  const renderProjectDetail = sourceBetween(
    "      function renderProjectDetail(task) {",
    "\n      async function loadProjectDetail(projectId) {",
  );

  assert.ok(renderProjectDetail.includes('contentRequirementEmailRecipients.value = "";'));
  assert.ok(renderProjectDetail.includes('contentRequirementEmailCc.value = "";'));
  assert.ok(renderProjectDetail.includes('contentRequirementEmailState.textContent = "";'));
  assert.ok(renderProjectDetail.includes("contentRequirementEmailState.hidden = true;"));
});

test("project detail loads ignore stale project responses", async () => {
  const taskViewState = { currentProjectId: "", currentProject: null };
  const deferredA = Promise.withResolvers();
  const rendered = [];
  const loadedPanels = [];
  const panelState = () => ({ textContent: "" });
  const dependencies = {
    taskViewState,
    fetchJson: async (url) => url.includes("project-a") ? deferredA.promise : { taskId: "project-b" },
    renderProjectDetail: (task) => {
      taskViewState.currentProjectId = task.taskId;
      taskViewState.currentProject = task;
      rendered.push(task.taskId);
    },
    loadProjectOperationBatchDraft: async (task) => {
      loadedPanels.push(`draft:${task.taskId}`);
    },
    loadProjectRequirementForDetail: async (task) => loadedPanels.push(`requirement:${task.taskId}`),
    loadProjectWechatBinding: async (task = taskViewState.currentProject) => loadedPanels.push(`wechat:${task.taskId}`),
    isCurrentProject: (taskId) => taskViewState.currentProjectId === taskId,
    setProjectOverviewExpanded: () => {},
    setProjectActionControlsDisabled: () => {},
    projectOperationBatchState: panelState(),
    projectRequirementInlineState: panelState(),
    projectWechatBindingState: panelState(),
  };
  const loadProjectDetail = compileInlineFunction(
    "      async function loadProjectDetail(projectId) {",
    "\n      function requirementNextAction(item = {}) {",
    dependencies,
  );

  const loadA = loadProjectDetail("project-a");
  await loadProjectDetail("project-b");
  deferredA.resolve({ taskId: "project-a" });
  await loadA;

  assert.deepEqual(rendered, ["project-b"]);
  assert.deepEqual(loadedPanels.sort(), ["draft:project-b", "requirement:project-b", "wechat:project-b"]);
});

test("project detail follow-up panel failures are isolated", async () => {
  const taskViewState = { currentProjectId: "", currentProject: null };
  const loadedPanels = [];
  const panelState = () => ({ textContent: "" });
  const dependencies = {
    taskViewState,
    fetchJson: async () => ({ taskId: "project-b" }),
    renderProjectDetail: (task) => {
      taskViewState.currentProjectId = task.taskId;
      taskViewState.currentProject = task;
    },
    loadProjectOperationBatchDraft: async (task) => {
      loadedPanels.push(`draft:${task.taskId}`);
      throw new Error("draft unavailable");
    },
    loadProjectRequirementForDetail: async (task) => loadedPanels.push(`requirement:${task.taskId}`),
    loadProjectWechatBinding: async (task = taskViewState.currentProject) => loadedPanels.push(`wechat:${task.taskId}`),
    isCurrentProject: (taskId) => taskViewState.currentProjectId === taskId,
    setProjectOverviewExpanded: () => {},
    setProjectActionControlsDisabled: () => {},
    projectOperationBatchState: panelState(),
    projectRequirementInlineState: panelState(),
    projectWechatBindingState: panelState(),
  };
  const loadProjectDetail = compileInlineFunction(
    "      async function loadProjectDetail(projectId) {",
    "\n      function requirementNextAction(item = {}) {",
    dependencies,
  );

  await assert.doesNotReject(loadProjectDetail("project-b"));

  assert.deepEqual(loadedPanels.sort(), ["draft:project-b", "requirement:project-b", "wechat:project-b"]);
  assert.equal(dependencies.projectOperationBatchState.textContent, "无法加载运营批次参数：draft unavailable");
});

test("stale project mutation responses do not overwrite the active project or DOM", async () => {
  const deferred = Promise.withResolvers();
  const taskViewState = { currentProjectId: "project-a", currentProject: { taskId: "project-a" } };
  const contentRequirementEmailState = { textContent: "" };
  const dependencies = {
    taskViewState,
    contentRequirementEmailRecipients: { value: "a@example.com" },
    contentRequirementEmailCc: { value: "cc@example.com" },
    contentRequirementEmailState,
    fetchJson: async () => deferred.promise,
    isCurrentProject: (taskId) => taskViewState.currentProjectId === taskId,
  };
  const sendContentRequirementEmailFromProject = compileInlineFunction(
    "      async function sendContentRequirementEmailFromProject() {",
    "\n      function validateOperationContentPreparation(prepared) {",
    dependencies,
  );

  const sendFromA = sendContentRequirementEmailFromProject();
  taskViewState.currentProjectId = "project-b";
  taskViewState.currentProject = { taskId: "project-b" };
  contentRequirementEmailState.textContent = "project-b-state";
  deferred.resolve({ task: { taskId: "project-a" }, result: { recipients: ["a@example.com"] } });
  await sendFromA;

  assert.equal(taskViewState.currentProject.taskId, "project-b");
  assert.equal(contentRequirementEmailState.textContent, "project-b-state");
});

test("every project mutation guards each response before updating shared state", () => {
  const handlers = [
    ["createProjectOperationBatch", "      async function createProjectOperationBatch() {", "\n      async function recordProjectOperationBatchCode() {"],
    ["recordProjectOperationBatchCode", "      async function recordProjectOperationBatchCode() {", "\n      const projectRequirementConfigFields = ["],
    ["handleProjectRequirementStaffEdit", "      async function handleProjectRequirementStaffEdit() {", "\n      async function handleProjectRequirementChangeAction(button) {"],
    ["handleProjectRequirementChangeAction", "      async function handleProjectRequirementChangeAction(button) {", "\n      async function handleProjectRequirementSubmitAction(button) {"],
    ["handleProjectRequirementSubmitAction", "      async function handleProjectRequirementSubmitAction(button) {", "\n      function projectWechatIdentity(task = {}) {"],
    ["saveProjectWechatBinding", "      async function saveProjectWechatBinding() {", "\n      function renderProjectDetail(task) {"],
    ["sendContentRequirementEmailFromProject", "      async function sendContentRequirementEmailFromProject() {", "\n      function validateOperationContentPreparation(prepared) {"],
    ["syncOperationContentFromProject", "      async function syncOperationContentFromProject() {", "\n      async function saveContentTaskRemark(input) {"],
  ];

  for (const [name, start, end] of handlers) {
    const source = sourceBetween(start, end);
    assert.ok(source.includes("const taskId = task?.taskId;"), `${name} must capture taskId`);
    const mutationPattern = name === "syncOperationContentFromProject"
      ? /const (?:prepared|result) = await (?:fetchJson|completeOperationContentHelper)/g
      : /const result = await fetchJson/g;
    const awaitIndexes = Array.from(source.matchAll(mutationPattern), (match) => match.index);
    assert.ok(awaitIndexes.length > 0, `${name} must contain a mutation request`);
    for (const [index, awaitIndex] of awaitIndexes.entries()) {
      const nextAwaitIndex = awaitIndexes[index + 1] ?? source.length;
      const guardIndex = source.indexOf("if (!isCurrentProject(taskId)) return;", awaitIndex);
      assert.ok(guardIndex > awaitIndex && guardIndex < nextAwaitIndex, `${name} must guard mutation response ${index + 1}`);
    }
  }
});

test("project navigation clears stale state and disables actions until current render", async () => {
  const deferred = Promise.withResolvers();
  const disabledStates = [];
  const taskViewState = { currentProjectId: "project-a", currentProject: { taskId: "project-a" } };
  const dependencies = {
    taskViewState,
    fetchJson: async () => deferred.promise,
    isCurrentProject: (taskId) => taskViewState.currentProjectId === taskId,
    setProjectOverviewExpanded: () => {},
    setProjectActionControlsDisabled: (disabled) => disabledStates.push(disabled),
    renderProjectDetail: (task) => {
      taskViewState.currentProject = task;
      dependencies.setProjectActionControlsDisabled(false);
    },
    loadProjectOperationBatchDraft: async () => {},
    loadProjectRequirementForDetail: async () => {},
    loadProjectWechatBinding: async () => {},
    projectOperationBatchState: { textContent: "" },
    projectRequirementInlineState: { textContent: "" },
    projectWechatBindingState: { textContent: "" },
  };
  const loadProjectDetail = compileInlineFunction(
    "      async function loadProjectDetail(projectId) {",
    "\n      function requirementNextAction(item = {}) {",
    dependencies,
  );

  const loadB = loadProjectDetail("project-b");
  assert.equal(taskViewState.currentProject, null);
  assert.deepEqual(disabledStates, [true]);
  deferred.resolve({ taskId: "project-b" });
  await loadB;
  assert.deepEqual(disabledStates, [true, false]);

  const renderProjectDetail = sourceBetween(
    "      function renderProjectDetail(task) {",
    "\n      async function loadProjectDetail(projectId) {",
  );
  assert.ok(renderProjectDetail.includes("setProjectActionControlsDisabled(false);"));
  const actionHelperStart = html.indexOf("      function setProjectActionControlsDisabled(disabled) {");
  const actionHelperEnd = html.indexOf("\n      async function loadProjectOperationBatchDraft", actionHelperStart);
  assert.ok(actionHelperStart >= 0 && actionHelperEnd > actionHelperStart);
  const actionHelper = html.slice(actionHelperStart, actionHelperEnd);
  for (const control of [
    "projectAutoConfigBtn",
    "operationBatchRefreshBtn",
    "operationBatchCreateBtn",
    "operationBatchRecordBtn",
    "operationContentSyncBtn",
    "projectWechatBindingRefreshBtn",
    "projectWechatBindingSaveBtn",
  ]) {
    assert.ok(actionHelper.includes(control), `missing project action control: ${control}`);
  }
});

test("each asynchronous project panel loader guards shared state by task id", () => {
  const draftLoader = sourceBetween(
    "      async function loadProjectOperationBatchDraft(task = taskViewState.currentProject) {",
    "\n      async function createProjectOperationBatch() {",
  );
  const requirementLoader = sourceBetween(
    "      async function loadProjectRequirementForDetail(task) {",
    "\n      function collectProjectRequirementStaffEditPayload() {",
  );
  const wechatLoader = sourceBetween(
    "      async function loadProjectWechatBinding",
    "\n      async function saveProjectWechatBinding() {",
  );

  for (const loader of [draftLoader, requirementLoader, wechatLoader]) {
    assert.ok(loader.includes("const taskId = task?.taskId;"));
    assert.ok(loader.includes("if (!isCurrentProject(taskId)) return;"));
    const awaitIndex = loader.indexOf("await ");
    assert.ok(awaitIndex >= 0);
    assert.ok(loader.indexOf("if (!isCurrentProject(taskId)) return;", awaitIndex) > awaitIndex);
  }
});

test("collector route avoids system probes while system configuration isolates panel failures", async () => {
  const collectorLoader = sourceBetween(
    "      async function loadWechatCollector() {",
    "\n      function renderWechatCollectorPreflight(preflight) {",
  );
  assert.equal(collectorLoader.includes("/api/operation-console/environment"), false);
  assert.equal(collectorLoader.includes("/api/email/settings"), false);

  const loaded = [];
  const dependencies = {
    loadWechatCollector: async () => loaded.push("collector"),
    checkOperationConsoleEnvironment: async () => {
      loaded.push("operation");
      throw new Error("operation unavailable");
    },
    loadEmailSettings: async () => {
      loaded.push("email");
      throw new Error("email unavailable");
    },
    wechatCollectorPreflight: { innerHTML: "collector-state" },
    operationConsoleEnvironment: { innerHTML: "" },
    emailSettingsState: { textContent: "" },
  };
  const loadSystemConfiguration = compileInlineFunction(
    "      async function loadSystemConfiguration() {",
    "\n      async function saveEmailSettings() {",
    dependencies,
  );

  await loadSystemConfiguration();

  assert.deepEqual(loaded.sort(), ["collector", "email", "operation"]);
  assert.equal(dependencies.wechatCollectorPreflight.innerHTML, "collector-state");
  assert.equal(dependencies.operationConsoleEnvironment.textContent, "operation unavailable");
  assert.equal(dependencies.emailSettingsState.textContent, "email unavailable");
  assert.ok(html.includes('staticPage("system-config", systemConfigView, loadWechatCollector'));
  assert.ok(html.includes('name === "system-config" ? loadSystemConfiguration : enter'));
});

test("project clarification submits field identifiers separately from customer questions", () => {
  const handler = sourceBetween(
    "      async function handleProjectRequirementSubmitAction(button) {",
    "\n      function projectWechatIdentity(task = {}) {",
  );

  assert.ok(handler.includes("missingFields: detail.latest?.missingFields || []"));
  assert.equal(handler.includes("missingFields: questions"), false);
});

test("recipient status text uses raw text and manual batch recording preserves its draft", () => {
  const emailFunctions = sourceBetween(
    "      async function sendEmailTest() {",
    "\n      async function checkOperationConsoleEnvironment() {",
  );
  const recordBatch = sourceBetween(
    "      async function recordProjectOperationBatchCode() {",
    "\n      const projectRequirementConfigFields = [",
  );

  assert.equal(emailFunctions.includes("safeText((result.result?.recipients || []).join"), false);
  assert.ok(html.includes('id="operationBatchNameInput"'));
  assert.ok(html.indexOf('id="operationBatchCodeInput"') < html.indexOf('id="operationBatchNameInput"'));
  assert.ok(recordBatch.includes("const draftHtml = projectOperationBatchDraft.innerHTML;"));
  assert.ok(recordBatch.includes("const operationBatchName = operationBatchNameInput.value.trim();"));
  assert.ok(recordBatch.includes("operationBatchName,"));
  assert.ok(recordBatch.includes("projectOperationBatchDraft.innerHTML = draftHtml;"));
});

test("operation batch draft loading refills the manual code and name fields", () => {
  const nameResolver = sourceBetween(
    "      function operationBatchNameFromTask(task = {}) {",
    "\n      function generatedOperationBatchNameFromTask",
  );
  const draftLoader = sourceBetween(
    "      async function loadProjectOperationBatchDraft(task = taskViewState.currentProject) {",
    "\n      async function confirmOperationBatchNotCreated()",
  );

  assert.ok(nameResolver.includes("taskViewState.currentOperationBatchDraft?.fields?.batchName?.value"));
  assert.ok(nameResolver.includes('task.config?.fanweiSource?.raw?.fields?.["批次名称"]'));
  assert.ok(nameResolver.includes('task.config?.fanweiSource?.batchNameMode'));
  assert.ok(nameResolver.includes("generatedOperationBatchNameFromTask(task)"));
  assert.ok(draftLoader.includes("operationBatchCodeInput.value = taskViewState.currentProject.config?.operationBatchCode"));
  assert.ok(draftLoader.includes("operationBatchNameInput.value = operationBatchNameFromTask(taskViewState.currentProject)"));
});

test("operation batch create calls automation and exposes progress in the dialog", () => {
  const handler = sourceBetween(
    "      async function createProjectOperationBatch() {",
    "\n      async function recordProjectOperationBatchCode() {",
  );
  assert.ok(html.includes('id="operationBatchActionState"'));
  assert.ok(handler.includes("/operation-batch/create"));
  assert.ok(handler.includes('ensureOperationBatchLocalHelper("operationBatchCreate")'));
  assert.ok(handler.includes('fetchFanweiHelper(localHelper.path'));
  assert.ok(handler.includes("preparationId: prepared.preparationId"));
  assert.ok(handler.includes("setOperationBatchActionState(pendingMessage)"));
  assert.ok(handler.includes("operationBatchCreateBtn.disabled = true"));
  assert.ok(handler.includes("try {"));
  assert.ok(handler.includes("finally"));
  assert.ok(handler.includes("updateOperationBatchActions(taskViewState.currentProject)"));
  assert.ok(html.includes("setOperationBatchActionState(message, true)"));
  assert.ok(html.includes('id="operationBatchSyncBtn"'));
  assert.ok(html.includes("/operation-batch/reconcile"));
  assert.ok(html.includes('id="operationBatchSyncBtn" type="button">添加日程</button>'));
  assert.ok(html.includes('operationBatchSyncBtn.textContent = "添加日程"'));
  assert.ok(handler.includes("正在按批次代码定位，并核对批次代码和批次名称"));
  assert.ok(handler.includes("批次日程已添加，发布状态和批次信息已同步"));
  assert.ok(html.includes("批次已发布；日程仍待添加"));
  assert.ok(html.includes('id="operationBatchHelperUpdateBtn"'));
  assert.ok(html.includes("helper_update_required"));
  assert.ok(html.includes("operationBatchCreate: 19"));
  assert.ok(html.includes("operationBatchReconcile: 16"));
  assert.ok(html.includes("operationBatchUpdate: 16"));
  assert.ok(html.includes("Number(health.helperVersion || 0) < minimumVersion"));
  assert.ok(html.includes("health.capabilities?.selfUpdate === true"));
  assert.ok(html.includes("/api/fanwei/helper-update-manifest"));
  assert.ok(html.includes('fetchFanweiHelper("/update"'));
  assert.ok(html.includes("waitForUpdatedFanweiHelper"));
  assert.ok(html.includes("本机助手已更新完成"));
  assert.ok(html.includes("本机助手已是最新版本"));
  assert.ok(html.includes("operation_batch_playwright_missing"));
  assert.ok(html.includes("downloadFanweiHelperInstaller"));
});

test("automatic helper updates are opt-in by helper capability so legacy v8 stays untouched", () => {
  const updater = sourceBetween(
    "      async function maybeAutoUpdateFanweiHelper(health, { onStatus } = {}) {",
    "\n      async function updateFanweiLocalHelper()",
  );
  const helperGate = sourceBetween(
    "      async function ensureScoreStampLocalHelper(requiredCapability = \"\", { onUpdateStatus } = {}) {",
    "\n      async function submitScoreStampApplicationResult",
  );
  assert.ok(updater.includes("health?.capabilities?.selfUpdate !== true) return health"));
  assert.ok(updater.includes("/api/fanwei/helper-update-manifest"));
  assert.ok(updater.includes('fetchFanweiHelper("/update"'));
  assert.ok(helperGate.includes("health.capabilities?.selfUpdate === true"));
  assert.ok(helperGate.includes("currentVersionUsable"));
  assert.ok(helperGate.includes("onUpdateStatus"));
  assert.ok(html.includes('confirmText: isContentSync ? "继续同步运控" : "继续添加日程"'));
});

test("Fanwei read stays available without a forced helper update and exposes stuck-update recovery", () => {
  const statusLoader = sourceBetween(
    "      async function loadFanweiAutoReadStatus() {",
    "\n      async function createFanweiRequirementImport()",
  );
  const reader = sourceBetween(
    "      async function copyFanweiReaderScript() {",
    "\n      async function loadFanweiAutoReadStatus()",
  );
  assert.ok(statusLoader.includes("health.capabilities?.fanweiRead !== true && health.capabilities?.selfUpdate === true"));
  assert.ok(statusLoader.includes("当前助手不支持泛微读取"));
  assert.ok(statusLoader.includes('error.code === "helper_update_in_progress"'));
  assert.ok(statusLoader.includes("showFanweiHelperUpdateRecovery()"));
  assert.ok(reader.includes('error.code === "helper_update_in_progress"'));
  assert.ok(reader.includes("showFanweiHelperUpdateRecovery()"));
  assert.ok(html.includes("请先重启电脑"));
  assert.ok(html.includes("fanweiInstallHelperBtn.hidden = false"));
});

test("manual helper update reports both completed and already-current outcomes", () => {
  const updater = sourceBetween(
    "      async function maybeAutoUpdateFanweiHelper(health, { onStatus } = {}) {",
    "\n      async function updateFanweiLocalHelper()",
  );

  assert.ok(updater.includes("本机助手已更新完成"));
  assert.ok(updater.includes("本机助手已是最新版本"));
  assert.ok(updater.includes("waitForUpdatedFanweiHelper"));
  assert.ok(updater.includes("可以重新添加日程"));
  assert.ok(html.includes('helperUpdateStatus: "updated"'));
  assert.ok(html.includes('title: "本机助手更新完成"'));
});

test("operation batch exposes a confirmation-gated recovery action after an uncertain create", () => {
  const handler = sourceBetween(
    "      async function confirmOperationBatchNotCreated() {",
    "      async function createProjectOperationBatch() {",
  );
  assert.ok(html.includes('id="operationBatchRetryBtn"'));
  assert.ok(handler.includes("await showConfirmDialog"));
  assert.ok(handler.includes("confirmNoExternalBatch: true"));
  assert.ok(handler.includes("/operation-batch/retry"));
  assert.ok(html.includes("operationBatchRetryBtn.hidden = Boolean(code) || !blocked"));
});

test("candidate page loads and preselects task-scoped sessions", () => {
  assert.ok(html.includes("async function loadCandidateTaskContext()"));
  assert.ok(html.includes("resolveCandidateTaskContext(task, sessionId)"));
  assert.ok(html.includes("loadContext: loadCandidateTaskContext"));
  assert.ok(html.includes("sessionSelect.value = String(candidateUiState.selectedSession.session_id)"));
  assert.ok(html.includes("已带入目标考试场次"));
  assert.ok(html.includes("candidateUiState.taskScoped = Boolean(taskId)"));
  assert.ok(html.includes("renderLoadSessionsAction()"));
  assert.ok(html.includes("loadSessionsAction.hidden = candidateUiState.taskScoped"));
  assert.equal(html.includes("已带入正式考试和试考"), false);
});

test("candidate import route labels the mapping panel as EasyExam field selection", () => {
  const candidatePanel = html.slice(
    html.indexOf('id="candidateImportPanel"'),
    html.indexOf('id="projectDetailView"'),
  );
  assert.ok(candidatePanel.includes("易考字段选择"));
  assert.equal(candidatePanel.includes("<h3 class=\"panel-title\">字段映射</h3>"), false);
});

test("candidate upload card explains raw list import and information item mapping", () => {
  const uploadCard = html.slice(
    html.indexOf('id="candidateDropZone"'),
    html.indexOf('id="candidateFileInput"'),
  );
  assert.ok(uploadCard.includes("上传客户原始名单"));
  assert.ok(uploadCard.includes("支持 .xlsx、.xls、.csv 格式。"));
  assert.ok(uploadCard.includes("上传后，请在下方选择需要导入易考的信息项以及对应字段，导入后自动生成信息项。"));
  assert.ok(uploadCard.includes("客户名单首行必须是基本信息项才可自动读取"));
  assert.equal(uploadCard.includes("固定字段映射后"), false);
  assert.equal(uploadCard.includes("必填字段：准考证号 / 姓名"), false);

  const helpBoxStyle = html.slice(
    html.indexOf(".candidate-help-box {"),
    html.indexOf(".candidate-card-head"),
  );
  assert.ok(helpBoxStyle.includes("display: block"));
  assert.ok(helpBoxStyle.includes("max-width: 100%"));
  assert.ok(helpBoxStyle.includes("overflow-wrap: anywhere"));
  assert.match(html, /\.candidate-upload-box\s*>\s*span\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(html, /\.candidate-upload-box\s+\.drop-title\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/s);
  assert.ok(helpBoxStyle.includes(".candidate-upload-warning"));
  assert.ok(helpBoxStyle.includes("color: #dc2626"));
  assert.equal(helpBoxStyle.includes("border:"), false);
  assert.equal(helpBoxStyle.includes("background:"), false);
  assert.equal(helpBoxStyle.includes("padding:"), false);
});

test("candidate parsing does not append a validation error-count log", () => {
  const parseBlock = sourceBetween(
    "async function parseCandidateFile(file)",
    "function renderSessions(message",
  );
  assert.ok(parseBlock.includes('"[名单校验] 校验通过"'));
  assert.equal(
    parseBlock.includes("`[名单校验] 存在 ${candidateUiState.errors.length} 个错误`"),
    false,
  );
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

test("candidate import keeps the right preview rail visible while scrolling", () => {
  assert.match(html, /\.candidate-panel\s*\{[^}]*overflow:\s*visible/s);
  assert.match(html, /\.candidate-right\s*\{[^}]*position:\s*sticky[^}]*top:\s*18px[^}]*max-height:\s*calc\(100vh - 36px\)[^}]*overflow-y:\s*auto/s);
  assert.match(html, /@media\s*\(max-width:\s*1120px\)\s*\{[\s\S]*?\.candidate-right\s*\{[^}]*position:\s*static[^}]*max-height:\s*none[^}]*overflow-y:\s*visible/s);
});

test("candidate import keeps long session names inside the left rail", () => {
  assert.match(html, /\.candidate-session-card\s+\.candidate-card-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(html, /\.candidate-session-card\s+\.candidate-card-body\s*>\s*\*,\s*[\r\n\s]*\.candidate-session-grid\s*>\s*\*\s*\{[^}]*min-width:\s*0/s);
  assert.match(html, /\.mapping-card select,\s*[\r\n\s]*\.custom-field-name,\s*[\r\n\s]*\.session-select\s*\{[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*box-sizing:\s*border-box/s);
});

test("candidate import title uses a page topbar outside the content panel", () => {
  const topbarStart = html.indexOf('id="candidateTopbar"');
  const panelStart = html.indexOf('id="candidateImportPanel"');
  const panelEnd = html.indexOf('id="projectDetailView"');
  assert.ok(topbarStart >= 0);
  assert.ok(topbarStart < panelStart);
  assert.ok(html.slice(topbarStart, panelStart).includes("<h1>考生名单整理与导入</h1>"));
  assert.equal(html.slice(panelStart, panelEnd).includes("考生名单整理与导入"), false);
  assert.ok(html.includes("CandidateImportPage({ root: candidateImportPanel, topbar: candidateTopbar"));
});

test("candidate import supports custom field selection and local save payload", () => {
  assert.ok(html.includes("客户名单自定义字段"));
  assert.ok(html.includes('id="selectAllCustomFieldsBtn"'));
  assert.ok(html.includes('id="clearCustomFieldsBtn"'));
  assert.equal(html.includes('id="candidateDownloadBtn"'), false);
  assert.equal(html.includes(">下载导入模板</button>"), false);
  assert.ok(html.includes('id="loadSessionsAction"'));
  const candidatePanel = html.slice(
    html.indexOf('id="candidateImportPanel"'),
    html.indexOf('id="projectDetailView"'),
  );
  assert.ok(candidatePanel.indexOf('id="loadSessionsAction"') > candidatePanel.indexOf('id="sessionSelect"'));
  assert.ok(candidatePanel.indexOf('id="loadSessionsAction"') < candidatePanel.indexOf('id="candidateImportBtn"'));
  assert.equal(html.includes('id="addCustomFieldBtn"'), false);
  assert.match(html, /\.custom-field-head\s*\{[^}]*flex-wrap:\s*wrap[^}]*min-width:\s*0/s);
  assert.match(html, /\.custom-field-head\s*>\s*div:first-child\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.match(html, /\.custom-field-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(96px,\s*max-content\)\)[^}]*max-width:\s*100%/s);
  assert.match(html, /\.custom-field-actions\s+\.btn\s*\{[^}]*max-width:\s*100%[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(html, /\.custom-field-row\s*\{[^}]*grid-template-columns:\s*28px\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(html, /\.custom-field-source,\s*[\r\n\s]*\.custom-field-sample\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s);
  assert.ok(html.includes("custom_field_candidates"));
  assert.ok(html.includes("selectedCustomFields()"));
  assert.ok(html.includes("custom_fields: buildCustomFieldValues(row)"));
  assert.ok(html.includes("自定义字段已随考生导入请求发送到易考"));
});

test("candidate import requires manual room size before importing candidates", () => {
  const candidatePanel = html.slice(
    html.indexOf('id="candidateImportPanel"'),
    html.indexOf('id="projectDetailView"'),
  );
  assert.ok(candidatePanel.includes('id="roomTargetSizeInput" type="number" min="1" step="1" value="0"'));
  assert.equal(candidatePanel.includes('id="roomTargetSizeInput" type="number" min="1" step="1" value="30"'), false);
  assert.ok(html.includes("function candidateRoomTargetSizeIsValid()"));

  const renderResultBody = html.slice(
    html.indexOf("function renderCandidateResult()"),
    html.indexOf("async function parseCandidateFile"),
  );
  assert.ok(renderResultBody.includes("candidateRoomTargetSizeIsValid()"));

  const renderSessionBody = html.slice(
    html.indexOf("function renderSelectedSession()"),
    html.indexOf("async function loadCandidateTaskContext"),
  );
  assert.ok(renderSessionBody.includes("candidateRoomTargetSizeIsValid()"));

  const importBody = html.slice(
    html.indexOf("async function autoAssignRoomsAfterImport()"),
    html.indexOf("async function importCandidatesToSession()"),
  );
  assert.ok(importBody.includes("const targetSize = Number(roomTargetSizeInput.value);"));
  assert.ok(importBody.includes("请填写每个班级人数"));
  assert.equal(importBody.includes("roomTargetSizeInput.value || 30"), false);
  assert.ok(html.includes('roomTargetSizeInput.value = "0";'));
});

test("candidate import failures use the centered application dialog", () => {
  const candidateListeners = html.slice(
    html.indexOf('candidateFileInput.addEventListener("change"'),
    html.indexOf("const staticPage ="),
  );
  assert.ok(candidateListeners.includes("showErrorDialog(`名单解析失败：${message}`)"));
  assert.ok(candidateListeners.includes("showErrorDialog(`场次加载失败：${message}`)"));
  assert.ok(candidateListeners.includes("showErrorDialog(`监考账号下载失败：${message}`)"));
  assert.ok(candidateListeners.includes("showErrorDialog(`考生导入失败：${message}`)"));
  assert.ok(candidateListeners.includes('candidateLog(`[名单解析] ${message}`, "warn")'));
  assert.ok(candidateListeners.includes('candidateLog(`[考生导入] ${message}`, "warn")'));
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
  assert.ok(html.includes("mappedCandidateSourceColumns"));
  assert.ok(html.includes("!mappedColumns.has(field.source_column)"));
  assert.ok(html.includes("mappedColumns.has(column)"));
  assert.ok(html.includes("固定字段不会重复展示"));
});

test("candidate mapping canonicalizes phone and email aliases in fixed fields", () => {
  assert.ok(html.includes("function canonicalImportFieldName"));
  assert.ok(html.includes('return "手机号码"'));
  assert.ok(html.includes('return "邮箱"'));
  assert.ok(html.includes("candidateMapMobile.value"));
  assert.ok(html.includes("candidateMapEmail.value"));
});

test("candidate validation messages use Chinese field labels", () => {
  const validationBlock = html.slice(
    html.indexOf("function validateCandidatesClient"),
    html.indexOf("function calculateCandidateStats"),
  );
  assert.ok(validationBlock.includes("candidateFieldLabel"));
  assert.ok(validationBlock.includes("const missingMappedFields"));
  assert.ok(validationBlock.includes("缺少字段映射：${candidateFieldLabel(field)}"));
  assert.ok(validationBlock.includes("if (!missingMappedFields.has(field)"));
  assert.ok(validationBlock.includes("第 ${rowNum} 行缺少${candidateFieldLabel(field)}"));
  assert.ok(validationBlock.includes('第 ${rowNum} 行${candidateFieldLabel("identity_id")}为科学计数法格式'));
  assert.ok(validationBlock.includes('第 ${rowNum} 行${candidateFieldLabel("permit")}为科学计数法格式'));
  assert.equal(validationBlock.includes("缺少字段映射：${field}"), false);
  assert.equal(validationBlock.includes("行缺少 ${field}"), false);
  assert.equal(validationBlock.includes("行 permit 为科学计数法格式"), false);
  assert.equal(validationBlock.includes("course_code。"), false);
});

test("candidate validation rejects invalid permit and phone-mapped permit formats", () => {
  const validationBlock = html.slice(
    html.indexOf("function validateCandidatesClient"),
    html.indexOf("function candidateStats"),
  );
  assert.ok(html.includes("function isValidCandidatePermit"));
  assert.ok(html.includes("function isValidCandidateMobile"));
  assert.ok(validationBlock.includes("candidatePermitMappedFromMobile"));
  assert.ok(validationBlock.includes("第 ${rowNum} 行准考证号只能包含英文字母和数字"));
  assert.ok(validationBlock.includes("第 ${rowNum} 行${permitMobileError}"));
});

test("candidate validation checks mainland identity and mobile numbers before import", () => {
  const validationBlock = html.slice(
    html.indexOf("function validateCandidatesClient"),
    html.indexOf("function candidateStats"),
  );
  assert.ok(html.includes("function normalizeCandidateIdentityId"));
  assert.ok(html.includes("function validateCandidateIdentityId"));
  assert.ok(html.includes("function candidateIdentityChecksum"));
  assert.ok(html.includes("function normalizeCandidateMobile"));
  assert.ok(html.includes("function validateCandidateMobile"));
  assert.ok(html.includes("身份证号格式不正确"));
  assert.ok(html.includes("身份证号出生日期不合法"));
  assert.ok(html.includes("身份证号校验码错误"));
  assert.ok(html.includes("手机号不能为空"));
  assert.ok(html.includes("手机号格式不正确"));
  assert.ok(html.includes("手机号必须为 11 位数字"));
  assert.ok(validationBlock.includes("validateCandidateIdentityId(candidate.identity_id)"));
  assert.ok(validationBlock.includes("validateCandidateMobile(candidate.mobile)"));
  assert.ok(html.includes("identity_id: normalizeCandidateIdentityId"));
  assert.ok(html.includes("mobile: normalizeCandidateMobile"));
});

test("local login page and logout controls are present", () => {
  assert.ok(html.includes('id="loginView"'));
  assert.equal(html.includes('id="loginView" hidden'), false);
  assert.ok(html.includes('id="appShell" hidden'));
  assert.ok(html.includes('id="authLoginEmailInput"'));
  assert.ok(html.includes('id="authLoginPasswordInput"'));
  assert.ok(html.includes('id="logoutBtn"'));
  assert.ok(html.includes("本机请使用"));
  assert.ok(html.includes("http://127.0.0.1:8765/login"));
  assert.ok(html.includes("http://172.16.13.214:8765/login"));
  assert.ok(html.includes('id="loginForm" method="post"'));
  assert.ok(html.includes('id="authLoginEmailInput" name="email"'));
  assert.ok(html.includes('id="authLoginPasswordInput" name="password"'));
  assert.ok(html.includes("AuthController"));
});

test("sidebar account status shows email inline and reveals logout after expanding", () => {
  assert.ok(html.includes(".side-status-summary"));
  assert.ok(html.includes("grid-template-columns: minmax(0, 1fr) auto;"));
  assert.match(html, /\.side-status\s*\{[^}]*font-size:\s*14px/s);
  assert.match(html, /\.side-status-toggle span:last-child\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.ok(html.includes(".side-status-toggle[data-email]:hover::after"));
  assert.ok(html.includes("content: attr(data-email);"));
  assert.ok(html.includes("background: #ffffff;"));
  assert.ok(html.includes("white-space: nowrap;"));
  assert.ok(html.includes("sideStatusToggle.dataset.email = email;"));
  assert.equal(html.includes("authEmailText.title = email;"), false);
  assert.ok(html.includes('<button class="logout-button side-status-logout" id="logoutBtn" type="button">退出登录</button>'));
  assert.ok(html.indexOf('<div class="side-status-extra">') < html.indexOf('<button class="logout-button side-status-logout" id="logoutBtn" type="button">退出登录</button>'));
  assert.ok(html.includes('sideStatusToggle.addEventListener("click"'));
  assert.ok(html.includes('sideStatusCard.classList.toggle("expanded", expanded);'));
  assert.ok(html.includes('sideStatusToggle.setAttribute("aria-expanded", expanded ? "true" : "false");'));
  assert.equal(html.includes('<div class="status-line"><span>会话</span><button class="logout-button" id="logoutBtn" type="button">退出登录</button></div>'), false);
  assert.equal(html.includes('<div class="status-line"><span>易考后台</span><span>待配置</span></div>'), false);
  assert.equal(html.includes('<div class="status-line"><span>脚本引擎</span><span class="ok">可用</span></div>'), false);
  assert.equal(html.includes('<div class="status-line"><span>最终创建</span><span>人工确认</span></div>'), false);
});

test("sidebar email tooltip follows the dark theme palette", () => {
  assert.match(
    html,
    /:root\[data-theme="dark"\] \.side-status-toggle\[data-email\]:hover::after,[\s\S]*?\.side-status-toggle\[data-email\]:focus-visible::after\s*\{[^}]*border-color:\s*var\(--line\)[^}]*background:\s*var\(--panel-soft\)[^}]*color:\s*var\(--text-normal\)[^}]*rgba\(0, 0, 0, 0\.36\)/s,
  );
});

test("sidebar offers a compact persistent light and dark theme toggle", () => {
  assert.match(html, /\.side-status-summary\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.ok(html.includes('id="themeToggle"'));
  assert.ok(html.includes('aria-label="切换到深色模式"'));
  assert.ok(html.includes('class="theme-icon theme-icon-moon"'));
  assert.ok(html.includes('class="theme-icon theme-icon-sun"'));
  assert.ok(html.includes(':root[data-theme="dark"]'));
  assert.ok(html.includes('const THEME_STORAGE_KEY = "easy-exam-theme";'));
  assert.ok(html.includes('localStorage.getItem(THEME_STORAGE_KEY)'));
  assert.ok(html.includes('document.documentElement.dataset.theme = theme;'));
  assert.ok(html.includes('localStorage.setItem(THEME_STORAGE_KEY, theme);'));
  assert.ok(html.includes('themeToggle.addEventListener("click"'));
});

test("brand uses theme-specific icons and the concise product name", () => {
  assert.ok(html.includes('/web/assets/easy-exam-brand-light.png'));
  assert.ok(html.includes('/web/assets/easy-exam-brand-dark.png'));
  assert.match(html, /:root\[data-theme="dark"\]\s+\.brand-mark-light\s*\{[^}]*display:\s*none/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.brand-mark-dark\s*\{[^}]*display:\s*block/s);
  assert.equal((html.match(/<div class="brand-title">自动配置台<\/div>/g) || []).length, 2);
  assert.equal(html.includes("考试配置台"), false);
  assert.equal(html.includes("需求单驱动自动化"), false);
  assert.ok(fs.existsSync(path.join(rootDir, "web/assets/easy-exam-brand-light.png")));
  assert.ok(fs.existsSync(path.join(rootDir, "web/assets/easy-exam-brand-dark.png")));
});

test("dark theme keeps buttons and workflow labels readable", () => {
  assert.match(html, /:root\[data-theme="dark"\]\s+\.btn\s*\{[^}]*color:\s*var\(--text-normal\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.btn:disabled\s*\{[^}]*opacity:\s*1[^}]*background:\s*var\(--panel-soft\)[^}]*color:\s*var\(--muted\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.btn\.primary:disabled\s*\{[^}]*background:\s*var\(--panel-soft\)[^}]*color:\s*var\(--muted\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.btn\.primary:not\(:disabled\)\s*\{[^}]*#0a84ff[^}]*rgba\(0, 0, 0, 0\.12\)[^}]*color:\s*#ffffff/is);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.step-title[^\{]*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.scheduler-title[^\{]*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.scheduler-profile strong[^\{]*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.step-state\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.mapping-card select[^\{]*\{[^}]*background:\s*var\(--input\)[^}]*color:\s*var\(--text-normal\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.status-chip\.success[^\{]*\{[^}]*background:\s*var\(--panel-soft\)[^}]*color:\s*var\(--green\)/s);
  const darkPanelSurfaceRule = html.match(/:root\[data-theme="dark"\]\s+:where\([\s\S]*?\)\s*\{\s*background:\s*var\(--panel\);\s*\}/)?.[0] || "";
  assert.equal(darkPanelSurfaceRule.includes(".task-step-action,"), false);
});

test("dark theme adapts project source workflow and dialog cards", () => {
  assert.match(html, /:root\[data-theme="dark"\] \.operation-detail-modal \.account-editor-body\s*\{[^}]*background:\s*rgba\(17, 22, 31, 0\.28\)/s);
  assert.match(html, /:root\[data-theme="dark"\] button\.project-source-item:hover,[\s\S]*\.operation-workflow-step:hover\s*\{[^}]*background:\s*var\(--panel-soft\)/s);
  assert.match(html, /:root\[data-theme="dark"\] \.operation-workflow-step\[aria-selected="true"\]\s*\{[^}]*background:\s*rgba\(10, 132, 255, 0\.14\)/s);
  assert.match(html, /:root\[data-theme="dark"\] \.project-source-icon\.examRequirement\s*\{[^}]*border-color:\s*rgba\(10, 132, 255, 0\.36\)[^}]*background:\s*rgba\(10, 132, 255, 0\.14\)/s);
  assert.match(html, /:root\[data-theme="dark"\] \.operation-param-item,[\s\S]*\.operation-task-note\s*\{[^}]*background:\s*var\(--project-glass-raised\)/s);
  assert.match(html, /:root\[data-theme="dark"\] \.workflow-source-badge\.easy_exam_requirement\s*\{[^}]*color:\s*var\(--green\)/s);
});

test("project workflow source cards and collaboration shell share the account editor glass treatment", () => {
  assert.match(html, /#projectDetailView\s*\{[^}]*--project-glass-blur:\s*18px[^}]*--project-glass-surface:\s*rgba\(255, 255, 255, 0\.42\)/s);
  assert.match(html, /#projectDetailView \.panel,[\s\S]*#projectDetailView \.project-source-item,[\s\S]*#projectOperationBatchPanel\s*\{[^}]*backdrop-filter:\s*blur\(var\(--project-glass-blur\)\) saturate\(var\(--project-glass-saturation\)\)/s);
  assert.match(html, /#projectDetailView \.operation-param-item,[\s\S]*#projectDetailView \.operation-task-note\s*\{[^}]*background:\s*var\(--project-glass-raised\)[^}]*backdrop-filter:\s*blur\(12px\)/s);
  assert.match(html, /:root\[data-theme="dark"\] #projectDetailView\s*\{[^}]*--project-glass-surface:\s*rgba\(22, 27, 34, 0\.58\)[^}]*--project-glass-border:\s*rgba\(255, 255, 255, 0\.14\)/s);
});

test("project source and collaboration cards match the approved compact radius layout", () => {
  assert.match(html, /\.project-source-strip\s*\{[^}]*grid-template-columns:\s*repeat\(3,[^}]*gap:\s*14px/s);
  assert.match(html, /\.project-source-item\s*\{[^}]*min-height:\s*154px[^}]*border-radius:\s*8px/s);
  assert.match(html, /\.project-source-auto-config-slot \.btn\s*\{[^}]*min-height:\s*29px[^}]*height:\s*29px[^}]*font-size:\s*13px/s);
  assert.match(html, /\.project-source-requirement-button\s*\{[^}]*min-height:\s*29px[^}]*height:\s*29px/s);
  assert.ok(html.includes('class="project-source-icon fanwei"'));
  assert.ok(html.includes('class="project-source-icon examRequirement"'));
  assert.ok(html.includes('class="project-source-icon actualResult"'));
  for (const asset of [
    "fanwei-requirement-logo.png",
    "easy-exam-requirement-logo.png",
    "operation-collaboration-logo.png",
  ]) {
    assert.ok(html.includes(`/web/assets/${asset}`));
    assert.ok(fs.existsSync(path.join(rootDir, "web/assets", asset)));
  }
  assert.equal(html.includes('<span class="project-source-icon fanwei" aria-hidden="true"><svg'), false);
  assert.ok(html.includes('class="operation-workflow-heading-icon" src="/web/assets/operation-collaboration-logo.png"'));
  assert.ok(html.includes('data-project-actual-result'));
  assert.ok(html.includes('openOperationDetail("archive", actualResultButton)'));
  assert.equal(html.includes('class="project-source-arrow"'), false);
  assert.equal(html.includes(".project-source-auto-config-slot .btn::after"), false);
  assert.match(html, /#projectOperationBatchPanel\s*\{[^}]*border-radius:\s*8px/s);
  assert.match(html, /\.operation-workflow-step\s*\{[^}]*border-radius:\s*8px/s);
  assert.ok(html.includes('class="operation-workflow-connector"'));
  assert.ok(html.includes('<span class="operation-workflow-connector" aria-hidden="true"></span>'));
  assert.equal(html.includes(".operation-workflow-connector svg"), false);
});

test("project detail typography matches the exam detail hierarchy", () => {
  assert.match(html, /#projectDetailView \.project-source-title,[\s\S]*#projectDetailView \.project-requirement-snapshot-head h3\s*\{[^}]*font-size:\s*16px[^}]*font-weight:\s*800[^}]*line-height:\s*1\.45/s);
  assert.match(html, /#projectDetailView \.operation-param-label,[\s\S]*#projectDetailView \.project-requirement-snapshot \.fanwei-field-label\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*400/s);
  assert.match(html, /#projectDetailView \.operation-param-value,[\s\S]*#projectDetailView \.project-requirement-snapshot \.fanwei-field-value\s*\{[^}]*font-size:\s*16px[^}]*font-weight:\s*800/s);
  assert.match(html, /#projectDetailView \.project-source-meta,[\s\S]*#projectDetailView \.operation-task-section \.subtitle\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*400[^}]*line-height:\s*1\.7/s);
  assert.match(html, /\.task-overview-label\s*\{[^}]*font-size:\s*12px/s);
  assert.match(html, /\.task-overview-value\s*\{[^}]*font-weight:\s*800/s);
});

test("dark theme uses the approved surface and semantic color hierarchy", () => {
  const darkTokens = sourceBetween(':root[data-theme="dark"] {', "\n      }");
  assert.ok(darkTokens.includes("--bg: #0d1117;"));
  assert.ok(darkTokens.includes("--panel: #161b22;"));
  assert.ok(darkTokens.includes("--panel-soft: #1f2630;"));
  assert.ok(darkTokens.includes("--input: #11161f;"));
  assert.ok(darkTokens.includes("--line: #30363d;"));
  assert.ok(darkTokens.includes("--text: #f5f5f7;"));
  assert.ok(darkTokens.includes("--text-normal: #d1d5db;"));
  assert.ok(darkTokens.includes("--muted: #9ca3af;"));
  assert.ok(darkTokens.includes("--primary: #0a84ff;"));
  assert.ok(darkTokens.includes("--green: #30d158;"));
  assert.ok(darkTokens.includes("--amber: #ffd60a;"));
  assert.ok(darkTokens.includes("--red: #ff453a;"));
});

test("app shell and main content keep the active theme background", () => {
  assert.match(html, /\.app-shell\s*\{[^}]*background:\s*var\(--bg\)/s);
  assert.match(html, /\.main\s*\{[^}]*background:\s*var\(--bg\)/s);
});

test("dark theme keeps active operation cards on dark surfaces", () => {
  assert.match(html, /:root\[data-theme="dark"\]\s+\.operation-action-card\.active\s*\{[^}]*border-color:\s*var\(--primary\)[^}]*background:\s*var\(--panel-soft\)/s);
});

test("login page script does not redeclare backend settings variables", () => {
  assert.equal((html.match(/const loginPasswordInput/g) || []).length, 0);
  assert.ok(html.includes("const authLoginPasswordInput"));
  assert.ok(html.includes("const backendLoginPasswordInput"));
  assert.equal((html.match(/id="loginPasswordInput"/g) || []).length, 1);
});

test("auto config uses fixed EasyExam login URL without showing a URL input", () => {
  assert.equal(html.includes('id="loginUrlInput"'), false);
  assert.equal(html.includes("<span class=\"field-label\">登录网址</span>"), false);
  assert.ok(html.includes('url: "https://eztest.org/manager/accounts/login"'));
  assert.ok(html.includes("请完整填写账号、密码和租户 API Key。"));
  assert.equal(html.includes("请完整填写登录网址、账号和密码。"), false);
});

test("auto config renders operations dashboard structure without changing controls", () => {
  assert.ok(html.includes('class="auto-workbench" id="autoWorkbench" hidden'));
  assert.equal(html.includes('class="workflow-rail"'), false);
  assert.ok(html.includes('class="workflow-inline"'));
  assert.ok(html.includes('class="workbench-main"'));
  assert.ok(html.includes('class="support-rail"'));
  assert.equal(html.includes('data-workbench-resizer="workflow"'), false);
  assert.ok(html.includes('data-workbench-resizer="support"'));
  assert.ok(html.includes('role="separator" aria-orientation="vertical"'));
  assert.ok(html.includes("easyExam:autoWorkbenchSplit:v3"));
  assert.ok(html.includes("installWorkbenchResizeControls"));
  assert.ok(html.includes('id="loginUsernameInput"'));
  assert.ok(html.includes('id="tenantIdInput" type="text"'));
  assert.ok(html.indexOf('id="tenantIdInput"') < html.indexOf('id="loginUsernameInput"'));
  assert.ok(html.includes('id="loginPasswordInput"'));
  assert.ok(html.includes('id="tenantApiKeyInput"'));
  assert.ok(html.includes("tenantId: tenantIdInput.value.trim()"));
  assert.ok(html.includes('tenantIdInput.value = mode === "edit" ? credentials.tenantId || "" : ""'));
  assert.ok(html.includes('id="saveLoginBtn"'));
  assert.ok(html.includes('id="dropZone"'));
  assert.ok(html.includes('id="progressNumber"'));
  assert.ok(
    html.indexOf('id="dropZone"') < html.indexOf('class="workflow-inline"'),
    "upload area should render before the inline workflow panel",
  );
  assert.ok(
    html.indexOf('id="stepList"') < html.indexOf('id="progressNumber"'),
    "workflow steps should render before the right-side progress summary",
  );
  assert.ok(html.includes('class="workflow-steps"'));
  assert.ok(html.includes('class="workflow-summary"'));
  assert.ok(html.includes('id="previewRows"'));
  assert.ok(html.includes('id="captureGrid"'));
  assert.ok(html.includes('id="logList"'));
  assert.ok(html.includes('class="progress-circle" id="progressCircle"'));
  assert.ok(html.includes('class="progress-ring"'));
  assert.ok(html.includes('class="progress-ring-track"'));
  assert.ok(html.includes('class="progress-ring-value" id="progressRingValue"'));
  assert.match(html, /class="progress-circle"[\s\S]*id="progressNumber"/);
  assert.ok(html.includes("--workflow-progress-early: #fbbf24;"));
  assert.ok(html.includes("--workflow-progress-mid: #60a5fa;"));
  assert.ok(html.includes("--workflow-progress-major: #2563eb;"));
  assert.ok(html.includes("--workflow-progress-complete: #16a34a;"));
  assert.match(html, /\.progress-ring-value\s*\{[^}]*stroke:\s*var\(--workflow-progress-major\)/s);
  assert.match(html, /\.progress-circle\[data-progress-tone="early"\]\s+\.progress-ring-value\s*\{[^}]*stroke:\s*var\(--workflow-progress-early\)/s);
  assert.match(html, /\.progress-circle\[data-progress-tone="mid"\]\s+\.progress-ring-value\s*\{[^}]*stroke:\s*var\(--workflow-progress-mid\)/s);
  assert.match(html, /\.progress-circle\[data-progress-tone="complete"\]\s+\.progress-ring-value\s*\{[^}]*stroke:\s*var\(--workflow-progress-complete\)/s);
  assert.match(html, /\.workflow-summary\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(html, /\.workflow-summary\s+\.subtitle\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(html, /\.progress-ring-value\s*\{[^}]*stroke-dasharray:\s*var\(--progress-circumference\)[^}]*stroke-dashoffset:\s*var\(--progress-offset\)/s);
  assert.match(html, /\.progress-circle\s*\{[^}]*width:\s*104px/s);
  assert.match(html, /\.workflow-inline\s+\.progress-number\s*\{[^}]*font-size:\s*25px/s);
  assert.match(html, /\.step\.done\s+\.workflow-step-icon\s*\{[^}]*background:\s*var\(--workflow-step-complete\)/s);
  assert.match(html, /\.step\.active\s+\.workflow-step-icon\s*\{[^}]*background:\s*var\(--workflow-step-running\)/s);
  assert.match(html, /function applyImportResult\(fileName,\s*data\)\s*\{[\s\S]*setProgress\(8,\s*"需求单已读取，等待开始配置",\s*1\)/);
  assert.match(html, /function inferProgressStageIndex\(normalizedPercent,\s*stageIndex\)\s*\{/);
  assert.match(html, /if \(normalizedPercent >= 100\) return steps\.length;/);
  assert.match(html, /const effectiveStageIndex = inferProgressStageIndex\(normalizedPercent,\s*stageIndex\);/);
  assert.match(html, /connector\.classList\.toggle\("done",\s*effectiveStageIndex > index\)/);
  assert.match(html, /step\.classList\.toggle\("done",\s*effectiveStageIndex >= 0 && index < effectiveStageIndex\)/);
  assert.match(html, /@container \(max-width:\s*520px\)[\s\S]*\.progress-circle\s*\{[^}]*width:\s*70px/s);
  assert.match(html, /progressCircle\.style\.setProperty\("--progress-offset",\s*String\(progressOffset\)\)/);
  assert.match(html, /progressCircle\.dataset\.progressTone\s*=\s*progressTone\(normalizedPercent\)/);
  assert.match(html, /progressCircle\.setAttribute\("aria-label",\s*`配置进度 \$\{normalizedPercent\}%`\)/);
  assert.equal(html.includes("conic-gradient(var(--blue)"), false);
  assert.equal(html.includes('class="bar"'), false);
  assert.equal(html.includes('class="bar-fill"'), false);
  assert.equal(html.includes('id="barFill"'), false);
  assert.equal(html.includes("barFill.style.width"), false);
  assert.equal(html.includes('id="modeTag"'), false);
  assert.equal(html.includes('class="review-strip"'), false);
  assert.equal(html.includes("最终创建前会停在易考确认页"), false);
  assert.equal(html.includes('class="mock-window"'), false);
  assert.equal(html.includes("installLocalZoomGuard"), false);
  assert.equal(html.includes("zoom-compensated"), false);
  assert.equal(html.includes("zoom-notice"), false);
  assert.equal(html.includes("transform: scale(var(--local-zoom-scale"), false);
  assert.equal(html.includes("document.body.style.zoom"), false);
  assert.equal(html.includes("document.documentElement.style.zoom"), false);
  assert.equal(html.includes("--local-zoom-factor"), false);
  assert.equal(html.includes("--local-zoom-scale"), false);
  assert.match(html, /\.app-shell\s*\{[^}]*display:\s*flex[^}]*width:\s*100%[^}]*min-width:\s*0/s);
  assert.match(html, /\.main\s*\{[^}]*flex:\s*1\s+1\s+auto[^}]*min-width:\s*0[^}]*width:\s*100%/s);
  assert.match(html, /\.auto-workbench\s*\{[^}]*--workbench-left-width:\s*calc\(\(100% - 28px\) \/ 2\)[^}]*--workbench-right-width:\s*calc\(\(100% - 28px\) \/ 2\)[^}]*display:\s*grid[^}]*grid-template-columns:[^}]*minmax\(0,\s*var\(--workbench-left-width\)\)[^}]*minmax\(0,\s*var\(--workbench-right-width\)\)[^}]*width:\s*100%[^}]*min-width:\s*0/s);
  assert.equal(html.includes("--support-rail-width"), false);
  assert.equal(html.includes("--workbench-main-min-width"), false);
  assert.match(html, /\.support-rail\s*\{[^}]*width:\s*100%/s);
  assert.match(html, /\.support-rail\s*>\s*\.panel\s*\{[^}]*width:\s*100%/s);
  assert.match(html, /\.support-rail\s+\.panel-body\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(html, /\.support-rail\s+table\s*\{[^}]*min-width:\s*360px/s);
  assert.match(html, /\.workflow-inline\s*\{[^}]*border:\s*1px solid var\(--line\)[^}]*border-radius:\s*8px/s);
  assert.match(html, /const defaultSplit = \{ leftPercent: 50, rightPercent: 50 \}/);
  assert.match(html, /const defaultWidths = \(\) => splitToWidths\(defaultSplit\)/);
  assert.match(html, /const workbenchWidth = \(\) => \{[\s\S]*autoWorkbench\.parentElement\?\.getBoundingClientRect\(\)\.width/s);
  assert.equal(html.includes("|| 1280"), false);
  assert.match(html, /const resetWidths = \(\) => \{[\s\S]*removeProperty\("--workbench-left-width"\)[\s\S]*removeProperty\("--workbench-right-width"\)/);
  assert.match(html, /const readSavedSplit = \(\) => \{[\s\S]*localStorage\.getItem\(storageKey\)[\s\S]*return null/s);
  assert.match(html, /const savedSplit = readSavedSplit\(\);\s*if \(savedSplit\) applyWidths\(splitToWidths\(savedSplit\)\);\s*else resetWidths\(\);/);
  assert.match(html, /autoWorkbench\.style\.setProperty\("--workbench-left-width", `\$\{Math\.round\(widths\.left\)\}px`\)/);
  assert.match(html, /autoWorkbench\.style\.setProperty\("--workbench-right-width", `\$\{Math\.round\(widths\.right\)\}px`\)/);
  assert.match(html, /leftPercent:\s*Math\.round\(leftPercent\)/);
  assert.match(html, /rightPercent:\s*Math\.round\(rightPercent\)/);
  assert.match(html, /support:\s*\{ minPercent: 25, maxPercent: 50 \}/);
  assert.ok(html.includes('aria-valuemin="25"'));
  assert.ok(html.includes('aria-valuemax="50"'));
  assert.equal(html.includes('aria-valuemax="75"'), false);
  assert.match(html, /\.workbench-main\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(html, /\.workbench-main\s*\{[^}]*max-height:/s);
  assert.doesNotMatch(html, /\.workbench-main\s*\{[^}]*overflow-y:\s*auto/s);
  assert.equal(html.includes("@media (max-width: 1360px)"), false);
  assert.equal(html.includes("@media (max-width: 1180px)"), false);
  assert.match(html, /@media\s*\(max-width:\s*900px\)[\s\S]*\.auto-workbench\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("capture preview uses a clean border and opens the full screenshot", () => {
  assert.ok(html.includes('class="capture-image"'));
  assert.match(html, /\.capture-thumb\s*\{[^}]*aspect-ratio:\s*1544\s*\/\s*528/s);
  assert.match(html, /\.capture-thumb\s*\{[^}]*padding:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(html, /\.capture-image\s*\{[^}]*border:\s*0[^}]*border-radius:\s*0/s);
  assert.match(html, /\.capture-card\s*\{[^}]*cursor:\s*zoom-in/s);
  assert.ok(html.includes('id="captureModal"'));
  assert.ok(html.includes('class="capture-modal-image"'));
  assert.ok(html.includes('data-capture-index="${index}"'));
  assert.match(html, /function openCaptureModal\(index, trigger\)[\s\S]*captureModal\.showModal\(\)/s);
  assert.match(html, /captureModal\.addEventListener\("close"[\s\S]*captureModalTrigger\?\.focus\(\)/s);
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
  assert.equal(html.includes('id="refreshProjectsBtn"'), false);
  assert.ok(html.includes('id="newProjectBtn"'));
  assert.ok(html.includes('id="projectSearchBtn" type="button">查询</button><button class="btn primary project-filter-query" id="newProjectBtn" type="button">+ 新建项目</button>'));
  assert.ok(html.includes('class="project-filter-row"'));
  assert.ok(html.includes('grid-template-columns: minmax(320px, 1.35fr) minmax(220px, 1fr) repeat(2, 118px)'));
  assert.ok(html.includes('.project-filter-row .field-input { width: 100%; height: 44px; min-height: 44px; }'));
  assert.ok(html.includes('.project-filter-search .field-input { padding: 10px 14px 10px 46px; font-size: 15px; font-weight: 700; color: var(--text); }'));
  assert.ok(html.includes('.project-filter-search-icon { position: absolute; left: 17px; top: 50%; width: 18px; height: 18px;'));
  assert.ok(html.includes('<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.4"></circle><path d="m16.2 16.2 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path></svg><input class="field-input" id="projectSearchInput"'));
  assert.ok(html.includes(':root[data-theme="dark"] #projectManagementView .project-filter-search-icon,'));
  assert.ok(html.includes('id="projectSearchBtn" type="button">查询</button>'));
  assert.ok(html.includes('id="projectSearchInput" aria-label="搜索项目"'));
  assert.ok(html.includes('id="projectStatusFilter" aria-label="项目状态"'));
  assert.ok(html.includes('"": visibleTasks.filter((task) => !task.hiddenAt).length'));
  assert.ok(html.includes('archived: visibleTasks.filter((task) => task.hiddenAt).length'));
  assert.ok(html.includes('option.textContent = statusCountText(label, projectStatusCounts[option.value] || 0)'));
  assert.ok(html.includes('projectStatusFilter.addEventListener("change", renderProjectList)'));
  assert.equal(html.includes('<span class="sr-only">搜索项目</span>'), false);
  assert.equal(html.includes('<span class="sr-only">项目状态</span>'), false);
  assert.ok(html.includes('id="projectStats" hidden'));
  assert.ok(html.includes('data-action="delete"'));
  assert.ok(html.includes('class="btn danger project-action" data-action="delete"'));
  assert.ok(html.includes('id="projectDeleteConfirmModal"'));
  assert.ok(html.includes('id="projectDeleteConfirmMessage"'));
  assert.ok(html.includes('id="projectDeleteConfirmBtn"'));
  assert.ok(html.includes("openProjectDeleteConfirm(card.dataset.taskId, actionButton)"));
  assert.ok(html.includes("projectDeleteConfirmModal.showModal()"));
  assert.ok(html.includes("await confirmProjectDelete()"));
  assert.ok(html.includes("await deleteProjectCard(taskId)"));
  assert.ok(html.includes('projectDeleteConfirmModal.addEventListener("cancel"'));
  const projectDeleteFunction = sourceBetween(
    "async function deleteProjectCard(taskId)",
    "async function confirmProjectDelete()",
  );
  assert.equal(projectDeleteFunction.includes("window.confirm"), false);
  assert.ok(html.includes("同步删除易考中的正式考试/试考场次"));
  assert.ok(html.includes('method: "DELETE"'));
  assert.ok(html.includes("/api/tasks/"));
});

test("site errors use the centered application dialog", () => {
  assert.ok(html.includes('id="siteErrorModal"'));
  assert.ok(html.includes('id="siteErrorTitle"'));
  assert.ok(html.includes('id="siteErrorMessage"'));
  assert.ok(html.includes('id="siteErrorConfirmBtn"'));
  assert.match(html, /\.account-editor-modal\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*height:\s*fit-content;[^}]*margin:\s*auto;/s);
  assert.match(html, /\.session-time-picker\.account-editor-modal\s*\{[\s\S]*inset:\s*auto;[\s\S]*margin:\s*0;/s);
  assert.ok(html.includes("function showErrorDialog(message, options = {})"));
  assert.ok(html.includes("siteErrorModal.showModal()"));
  assert.ok(html.includes('siteErrorModal.addEventListener("cancel"'));
  assert.ok(html.includes('if (action === "edit") return showErrorDialog("项目编辑将在独立表单中接入，不会打开自动配置组件。");'));
  assert.equal(html.includes('if (action === "edit") return alert("项目编辑将在独立表单中接入，不会打开自动配置组件。");'), false);
  assert.ok(html.includes("showErrorDialog(`下载失败：${error.message || String(error)}`)"));
  assert.ok(html.includes("showErrorDialog(`复制失败：${error.message || String(error)}`)"));
  assert.ok(html.includes("showErrorDialog(error.message || String(error))"));
  assert.equal(html.includes("alert(error.message || String(error))"), false);
  assert.equal(html.includes("alert(error.message);"), false);
});

test("site confirmations use the centered application dialog instead of browser prompts", () => {
  assert.ok(html.includes('class="account-editor-modal account-delete-modal" id="siteConfirmModal"'));
  assert.ok(html.includes('id="siteConfirmCancelBtn"'));
  assert.ok(html.includes('id="siteConfirmBtn"'));
  assert.ok(html.includes("function showConfirmDialog(message, options = {})"));
  assert.ok(html.includes("siteConfirmModal.showModal()"));
  assert.ok(html.includes('siteConfirmModal.addEventListener("cancel"'));
  assert.ok(html.includes('showConfirmDialog(data.message || "当前场次已存在班级'));
  assert.equal(/\b(?:window\.)?confirm\s*\(/.test(html), false);
});

test("project management archives cards and exposes an archived filter", () => {
  assert.ok(html.includes('<option value="archived">已归档</option>'));
  assert.ok(html.includes('archived: "已归档"'));
  assert.ok(html.includes('data-action="archive"'));
  assert.ok(html.includes("async function archiveProjectCard(taskId)"));
  assert.ok(html.includes('fetchJson(`/api/tasks/${encodeURIComponent(taskId)}?archive=1`, { method: "DELETE" })'));
  assert.ok(html.includes('fetchJson(`/api/tasks?includeArchived=1&_=${Date.now()}`)'));
  assert.ok(html.includes('status === "archived"'));
  assert.ok(html.includes("Boolean(task.hiddenAt)"));
});

test("project management loads cards without per-project detail synchronization", () => {
  const source = sourceBetween(
    "async function runProjectListLoad()",
    "async function deleteProjectCard",
  );
  assert.ok(source.includes("Promise.all(["));
  assert.ok(source.includes("fetchJson(`/api/tasks?includeArchived=1&_=${Date.now()}`)"));
  assert.ok(source.includes("fetchJson(`/api/exams?_=${Date.now()}`)"));
  assert.ok(source.includes("projectTasksWithSessions(taskData.tasks || [], sessions)"));
  assert.ok(source.includes("setProjectListRefreshState();"));
  assert.equal(source.includes("fetchJson(`/api/tasks/${encodeURIComponent"), false);
  assert.equal(source.includes("createStagedListLoader"), false);
});

test("project management renders projects as soon as auto config creates an exam", () => {
  const isAutoConfiguredProject = compileInlineFunction(
    "function isAutoConfiguredProject(task) {",
    "\n      function taskConfigurationStageFromSteps",
  );

  assert.equal(isAutoConfiguredProject({ status: "success", sessions: [] }), false);
  assert.equal(isAutoConfiguredProject({ status: "running", sessions: [{ session_id: "" }] }), false);
  assert.equal(isAutoConfiguredProject({
    status: "running",
    sessions: [{ sessionType: "formal", session_id: "exam-123" }],
  }), true);

  const renderFunction = sourceBetween(
    "function renderProjectList()",
    "async function loadProjects(",
  );
  assert.ok(renderFunction.includes("const visibleTasks = taskViewState.tasks.filter(isAutoConfiguredProject);"));
  assert.ok(renderFunction.includes("const projects = visibleTasks.filter((task) => {"));
  assert.ok(renderFunction.includes('visibleTasks.filter((task) => task.status === "success").length'));
  assert.ok(renderFunction.includes("项目总数 ${visibleTasks.length}"));
  assert.equal(renderFunction.includes("const projects = taskViewState.tasks.filter((task) => {"), false);
});

test("project cards use the exam name as their title", () => {
  const projectCardTitle = compileInlineFunction(
    "function projectCardTitle(task = {}) {",
    "\n      function hasConfiguredExam",
  );

  assert.equal(projectCardTitle({ projectName: "项目名", config: { examName: "考试名" } }), "考试名");
  assert.equal(projectCardTitle({ projectName: "项目名", examName: "摘要考试名" }), "摘要考试名");
  assert.equal(projectCardTitle({
    projectName: "项目名",
    config: { examRequirement: { fields: { "考试名称": "需求单考试名" } } },
  }), "需求单考试名");
  assert.equal(projectCardTitle({
    projectName: "项目名",
    config: {
      examRequirements: [],
      examRequirement: { fields: { "考试名称": "旧版需求单考试名" } },
    },
  }), "旧版需求单考试名");
  assert.equal(projectCardTitle({
    projectName: "项目名",
    sessions: [{ sessionType: "formal", name: "正式场次考试名" }],
  }), "正式场次考试名");
  assert.equal(projectCardTitle({ projectName: "历史项目名" }), "历史项目名");

  const renderFunction = sourceBetween(
    "function renderProjectList()",
    "async function loadProjects(",
  );
  assert.ok(renderFunction.includes("safeText(projectCardTitle(task))"));
});

test("project list enters with a fresh load while retaining existing cards during refresh", () => {
  const pageSource = fs.readFileSync(path.join(rootDir, "web/pages/ProjectListPage.mjs"), "utf8");
  assert.ok(pageSource.includes("loadProjects({ forceRefresh: true })"));
  assert.ok(html.includes('id="projectListRefreshState" aria-live="polite" hidden'));
  assert.ok(html.includes("function setProjectListRefreshState(message = \"\")"));
  const source = sourceBetween("async function loadProjects(", "let projectDeleteConfirmTrigger");
  assert.ok(source.includes("setProjectListRefreshState();"));
  assert.equal(source.includes("正在刷新项目"), false);
});

test("project cards sort by formal then trial exam start time descending", () => {
  const source = sourceBetween("function projectExamStartTimestamp(task)", "async function runProjectListLoad()");
  assert.ok(source.includes('session.sessionType === "formal"'));
  assert.ok(source.includes('session.sessionType === "trial"'));
  assert.ok(source.includes("Number.NEGATIVE_INFINITY"));
  assert.ok(source.includes("rightExamTime > leftExamTime ? 1 : -1"));
  assert.ok(source.includes('Date.parse(right.updatedAt || "")'));
});

test("project card actions only expose archive and delete in a bounded grid", () => {
  assert.match(html, /\.project-card\s*\{[^}]*overflow:\s*hidden[^}]*box-sizing:\s*border-box/s);
  assert.match(html, /\.card-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*max-height:\s*0[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s);
  assert.match(html, /\.project-card\.is-actions-visible \.card-actions\s*\{[^}]*max-height:\s*140px[^}]*visibility:\s*visible[^}]*pointer-events:\s*auto/s);
  assert.match(html, /\.card-actions\s+button\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/s);
  const renderFunction = sourceBetween("function renderProjectList()", "async function runProjectListLoad()");
  assert.ok(renderFunction.includes('data-action="toggle-actions"'));
  assert.ok(renderFunction.includes('aria-expanded="false"'));
  assert.ok(renderFunction.includes('aria-label="展开项目操作"'));
  assert.ok(renderFunction.includes('data-action="archive"'));
  assert.ok(renderFunction.includes('data-action="delete"'));
  assert.equal(renderFunction.includes('data-action="view"'), false);
  assert.equal(renderFunction.includes('data-action="edit"'), false);
  assert.equal(renderFunction.includes('data-action="auto"'), false);
});

test("project cards open details directly by click or keyboard", () => {
  assert.ok(html.includes('data-task-id="${safeText(task.taskId)}" role="link" tabindex="0"'));
  const clickHandler = sourceBetween(
    'projectGrid.addEventListener("click", (event) => {',
    'projectGrid.addEventListener("keydown", (event) => {',
  );
  assert.ok(clickHandler.includes('router.navigate(`/projects/${encodeURIComponent(card.dataset.taskId)}`)'));
  assert.ok(clickHandler.includes('if (action === "toggle-actions")'));
  assert.ok(clickHandler.includes('card.classList.add("is-actions-visible")'));
  assert.ok(clickHandler.includes('actionButton.setAttribute("aria-expanded", "true")'));
  assert.ok(clickHandler.includes('if (action === "archive")'));
  assert.ok(clickHandler.includes('if (action === "delete")'));
  const keyboardHandler = sourceBetween(
    'projectGrid.addEventListener("keydown", (event) => {',
    'requirementsList.addEventListener("click", (event) => {',
  );
  assert.ok(keyboardHandler.includes('event.key !== "Enter" && event.key !== " "'));
  assert.ok(keyboardHandler.includes('router.navigate(`/projects/${encodeURIComponent(card.dataset.taskId)}`)'));
});

test("exam list renders session rows before detail synchronization", () => {
  const source = sourceBetween(
    "const runExamListLoad = createStagedListLoader({",
    "function cloneTaskStep",
  );
  assert.ok(source.includes("fetchJson(`/api/exams?_=${Date.now()}`)"));
  assert.ok(source.includes("applyInitial:"));
  assert.ok(source.includes("taskViewState.sessions = sessions;"));
  assert.ok(source.includes("renderExamList();"));
  assert.ok(source.includes("loadDetail:"));
  assert.ok(source.includes("applyDetails:"));
});

test("list pages reuse visible data while refreshing", () => {
  assert.ok(html.includes("const LIST_CACHE_TTL_MS = 30 * 1000;"));
  assert.ok(html.includes("function hasFreshListCache(cache)"));
  assert.ok(html.includes("function runCachedListLoad(cache, loader)"));
  assert.ok(html.includes("async function loadProjects({ forceRefresh = false } = {})"));
  assert.ok(html.includes("async function loadExams({ forceRefresh = false } = {})"));
  assert.ok(html.includes("if (!forceRefresh && taskViewState.tasks.length) {"));
  assert.ok(html.includes("if (!forceRefresh && taskViewState.sessions.length) {"));
  assert.ok(html.includes("return await runCachedListLoad(cache, runProjectListLoad);"));
  assert.ok(html.includes("return runCachedListLoad(cache, runExamListLoad);"));
});

test("detail pages reuse task data before background refresh", () => {
  assert.ok(html.includes("const TASK_DETAIL_CACHE_TTL_MS = 30 * 1000;"));
  assert.ok(html.includes("function rememberTaskDetail(task)"));
  assert.ok(html.includes("function getTaskDetailCache(taskId)"));
  assert.ok(html.includes("function loadTaskDetail(taskId, { forceRefresh = false } = {})"));
  assert.ok(html.includes("async function openTaskDetail(taskId, { forceRefresh = false } = {})"));
  assert.ok(html.includes("if (cached && !forceRefresh)"));
  assert.ok(html.includes("loadTaskDetail(taskId, { forceRefresh })"));
  const projectDetailLoader = sourceBetween(
    "      async function loadProjectDetail(projectId) {",
    "      function requirementNextAction",
  );
  assert.ok(projectDetailLoader.includes("const cached = typeof getTaskDetailCache === \"function\" ? getTaskDetailCache(projectId) : null;"));
  assert.ok(projectDetailLoader.includes("if (cached.fresh)"));
  assert.ok(projectDetailLoader.includes("void loadPanels(cached.task);"));
});

test("exam task overview starts collapsed and removes redundant top actions", () => {
  assert.equal(html.includes('id="backToExamsBtn"'), false);
  assert.equal(html.includes('id="refreshTaskBtn"'), false);
  assert.ok(html.includes('class="task-overview task-detail-overview is-collapsed"'));
  assert.ok(html.includes('id="taskOverviewTitle"'));
  assert.ok(html.includes('id="taskOverviewProgress"'));
  assert.ok(html.includes('id="taskOverviewBody" style="max-height: 0px; opacity: 0" inert'));
  assert.ok(html.includes('<div class="panel exam-progress-panel"><div class="panel-head"><h2 class="panel-title">进度步骤</h2></div>'));
  assert.equal(html.includes("各步骤独立更新，按实际执行结果展示。"), false);
  assert.ok(html.includes("批次名称"));
  assert.ok(html.includes("const scoreStampBatchName = String(task.config?.scoreStampBatchName || operationBatchNameFromTask(task) || \"\").trim();"));
  assert.match(html, /<textarea class="task-overview-input" data-score-stamp-batch-name-input rows="1"[^>]*>\$\{safeText\(scoreStampBatchName\)\}<\/textarea>/);
  assert.match(html, /data-score-stamp-batch-name-save="\$\{safeText\(task\.taskId\)\}" type="button" hidden>保存<\/button>/);
  assert.ok(html.includes("/score-stamp-batch-name"));
  assert.ok(html.includes("async function saveScoreStampBatchName(taskId, batchName)"));
  assert.match(html, /\.task-overview-value\s*\{[^}]*font-weight:\s*800;[^}]*line-height:\s*1\.35/);
  assert.match(html, /\.task-overview-input\s*\{[^}]*width:\s*calc\(100% \+ 1px\);[^}]*margin-top:\s*-1px;[^}]*margin-left:\s*-1px;[^}]*padding:\s*0;[^}]*border:\s*1px solid transparent;[^}]*background:\s*transparent;[^}]*font:\s*inherit;[^}]*font-size:\s*inherit;[^}]*font-weight:\s*800;[^}]*line-height:\s*1\.35;[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;[^}]*resize:\s*none/);
  assert.match(html, /\.task-overview-input:focus\s*\{[^}]*border-color:\s*var\(--blue\);[^}]*background:\s*var\(--surface\)/);
  assert.ok(html.includes("function resizeTaskOverviewBatchNameInput(input)"));
  assert.ok(html.includes('taskOverview.addEventListener("input"'));
  assert.ok(html.includes('resizeTaskOverviewBatchNameInput(taskOverview.querySelector("[data-score-stamp-batch-name-input]"))'));
  assert.ok(html.includes('taskOverview.addEventListener("focusin"'));
  assert.ok(html.includes('taskOverview.addEventListener("focusout"'));
  assert.ok(html.includes("if (saveButton) saveButton.hidden = false;"));
  assert.ok(html.includes("if (saveButton && !saveButton.disabled) saveButton.hidden = true;"));
  assert.ok(html.includes("function setTaskOverviewExpanded(expanded)"));
  assert.ok(html.includes("transition: max-height 200ms ease-out, opacity 200ms ease-out"));
  assert.match(html, /#taskDetailView \.task-detail-overview-title,\s*#taskDetailView \.exam-progress-panel \.panel-title\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.3;[^}]*font-weight:\s*800/);
  assert.equal(html.includes('<div class="task-overview-label">任务编号</div><div class="task-overview-value">${safeText(task.taskId)}</div>'), false);
  assert.equal(html.includes("#taskOverview .task-overview-grid { grid-template-columns: repeat(6"), false);
  assert.match(html, /#taskOverview \.task-overview-grid\s*\{[^}]*grid-template-columns:\s*max-content var\(--task-batch-width, 320px\) max-content max-content max-content;[^}]*align-items:\s*start;[^}]*justify-content:\s*space-between;[^}]*column-gap:\s*16px/);
  assert.match(html, /#taskOverview \.task-overview-grid > :last-child\s*\{[^}]*padding-right:\s*34px/);
  assert.ok(html.includes('context.measureText(input.value || input.placeholder || "").width'));
  assert.ok(html.includes('filter((item) => !item.matches("[data-score-stamp-batch-name-editor]"))'));
  assert.ok(html.includes("grid.clientWidth - siblingWidth - (16 * (grid.children.length - 1))"));
  assert.ok(html.includes('grid.style.setProperty("--task-batch-width"'));
  assert.ok(html.includes("const borderHeight = input.offsetHeight - input.clientHeight;"));
  assert.ok(html.includes("input.scrollHeight + borderHeight"));
  assert.equal(html.includes("task-detail-overview-status"), false);
});

test("exam task detail keeps every formal session and only enabled trial sessions", () => {
  const renderTaskDetail = sourceBetween(
    "      function renderTaskDetail(task, options = {}) {",
    "\n      async function downloadTaskMonitorAccounts",
  );
  assert.ok(renderTaskDetail.includes("const requirementCount = taskRequirementCount(task)"));
  assert.ok(renderTaskDetail.includes('...(taskRequirementHasTrial(task, requirementIndex) ? [{ requirementIndex, sessionType: "trial" }] : [])'));
  assert.ok(renderTaskDetail.includes('item.sessionType === sessionType && Number(item.requirementIndex || 0) === requirementIndex'));
  assert.ok(renderTaskDetail.includes('data-requirement-index="${requirementIndex}"'));
  assert.ok(renderTaskDetail.includes('`需求单 ${requirementIndex + 1} · ${label}`'));
  assert.equal(renderTaskDetail.includes('data-not-started-candidates-download'), false);
  assert.equal(renderTaskDetail.includes("const sessionByType = new Map"), false);
});

test("trial candidate export reads the live session and handles download errors", () => {
  const displaySteps = sourceBetween(
    "      function buildTaskDisplaySteps(task) {",
    "      function buildSessionChangeRecordStep",
  );
  assert.ok(displaySteps.includes("buildTrialNotStartedCandidateDownloadAction(task)"));
  assert.ok(displaySteps.includes('stepMap.get("trial_session_create")'));
  assert.ok(displaySteps.includes("triggerActionHtml"));
  assert.ok(html.includes("async function downloadNotStartedCandidates(button)"));
  assert.ok(html.includes("function buildTrialNotStartedCandidateDownloadAction(task)"));
  assert.ok(html.includes("/not-started-candidates/download"));
  assert.ok(html.includes("downloadFileNameFromDisposition(response.headers.get(\"Content-Disposition\"))"));
  assert.ok(html.includes('const notStartedCandidatesDownload = event.target.closest("[data-not-started-candidates-download]")'));
  assert.ok(html.includes("taskStepGrid.addEventListener"));
  assert.ok(html.includes("未开考考生名单下载失败"));
});

test("exam list and detail display the exam name instead of the project name", () => {
  const taskRenderer = sourceBetween(
    "      function renderTaskDetail(task, options = {}) {",
    "\n      async function downloadTaskMonitorAccounts",
  );
  const examListRenderer = sourceBetween(
    "      function renderExamList() {",
    "\n      const runExamListLoad = createStagedListLoader({",
  );
  assert.ok(taskRenderer.includes("taskOverviewTitle.textContent = projectCardTitle(task)"));
  assert.ok(examListRenderer.includes("safeText(projectCardTitle(task))"));
  assert.equal(examListRenderer.includes("safeText(task.projectName)"), false);
});

test("exam progress cards show independent status rows for every requirement", () => {
  assert.ok(html.includes("function taskRequirementCount(task)"));
  assert.ok(html.includes("function renderStepRequirementProgress(step, task)"));
  assert.ok(html.includes("const trialOnlyStepKeys = new Set"));
  assert.ok(html.includes("function taskRequirementHasTrial(task, requirementIndex = 0)"));
  assert.ok(html.includes("function trialRequirementProgressForView(task, requirementProgress = {})"));
  assert.ok(html.includes("!trialOnlyStepKeys.has(step?.stepKey) || taskRequirementHasTrial(task, requirementIndex)"));
  assert.ok(html.includes('class="task-step-requirement-row" data-step-requirement-index="${requirementIndex}"'));
  assert.ok(html.includes("需求单 ${requirementIndex + 1}"));
  assert.ok(html.includes("const requirementProgress = Object.fromEntries("));
  assert.ok(html.includes("importStep?.requirementProgress?.[requirementKey]"));
  assert.ok(html.includes("roomStep?.requirementProgress?.[requirementKey]"));
  assert.ok(html.includes("monitorStep?.requirementProgress?.[requirementKey]"));
  assert.ok(html.includes("status: aggregateRequirementDisplayStatus(Object.values(requirementProgress).map((entry) => entry.status))"));
  assert.ok(html.includes("const collapsibleContentHtml = ["));
  assert.ok(html.includes("requirementProgressHtml,"));
  assert.ok(html.includes("const subHtml = !requirementProgressHtml && Object.keys(sub).length"));
  assert.match(html, /\.task-step-requirement-row\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/s);
});

test("project detail overview starts collapsed like exam detail", () => {
  assert.ok(html.includes('id="projectOverviewPanel"'));
  assert.ok(html.includes('id="projectOverviewToggle" type="button" aria-expanded="false"'));
  assert.ok(html.includes('id="projectOverviewTitle">等待加载项目名称'));
  assert.ok(html.includes('id="projectOverviewProgress">0.0%</span>'));
  assert.ok(html.includes('id="projectOverviewBody" style="max-height: 0px; opacity: 0" inert'));
  assert.ok(html.includes("function setProjectOverviewExpanded(expanded)"));
  const renderProjectDetail = sourceBetween(
    "      function renderProjectDetail(task) {",
    "\n      async function loadProjectDetail(projectId) {",
  );
  assert.ok(renderProjectDetail.includes('projectOverviewTitle.textContent = projectCardTitle(task) || "未命名项目";'));
  assert.ok(renderProjectDetail.includes('task-overview-label">泛微流水号'));
  assert.ok(renderProjectDetail.includes('${safeText(card.sourceKey || "未记录")}'));
  assert.equal(renderProjectDetail.includes('task-overview-label">项目状态'), false);
  assert.equal(html.includes('id="projectDetailSubtitle"'), false);
  assert.equal(renderProjectDetail.includes("projectDetailSubtitle"), false);
  const loadProjectDetail = sourceBetween(
    "      async function loadProjectDetail(projectId) {",
    "\n      function requirementNextAction(item = {}) {",
  );
  assert.ok(loadProjectDetail.includes("setProjectOverviewExpanded(false);"));
});

test("operation batch update button appears only for confirmed managed differences", () => {
  assert.match(
    html,
    /id="operationBatchUpdateManagedBtn" type="button" hidden>更新批次<\/button>/,
  );
  const workflowRenderer = sourceBetween(
    "      function renderProjectWorkflow(task = {}, workflow = {}, batchDraft = {}) {",
    "\n      function projectRequirementFormalTime(requirement = {}) {",
  );
  assert.ok(workflowRenderer.includes("workflow.steps?.batch?.baselineRequired"));
  assert.ok(workflowRenderer.includes("workflow.steps?.batch?.managedChanges"));

  const updateActions = sourceBetween(
    "      function updateOperationBatchActions(task = taskViewState.currentProject) {",
    "\n      function setOperationBatchActionState(message = \"\", isError = false) {",
  );
  assert.ok(updateActions.includes("!taskViewState.currentOperationBatchBaselineRequired"));
  assert.ok(updateActions.includes("taskViewState.currentOperationBatchManagedChanges.length"));
  assert.ok(updateActions.includes("operationBatchUpdateManagedBtn.hidden = !hasManagedChanges;"));
  assert.ok(updateActions.includes('operationBatchUpdateManagedBtn.textContent = updateStatus === "updating" ? "正在更新" : "更新批次";'));
  assert.equal(updateActions.includes('"update_failed"'), false);

  const taskViewState = {
    currentProject: null,
    currentOperationBatchUpdateStatus: "success",
    currentOperationBatchBaselineRequired: false,
    currentOperationBatchManagedChanges: [],
  };
  const operationBatchCreateBtn = {};
  const operationBatchUpdateManagedBtn = {};
  const operationBatchSyncBtn = {};
  const operationBatchRetryBtn = {};
  const operationBatchRecordBtn = {};
  const updateOperationBatchActions = compileInlineFunction(
    "      function updateOperationBatchActions(task = taskViewState.currentProject) {",
    "\n      function setOperationBatchActionState(message = \"\", isError = false) {",
    {
      taskViewState,
      operationBatchCreateBtn,
      operationBatchUpdateManagedBtn,
      operationBatchSyncBtn,
      operationBatchRetryBtn,
      operationBatchRecordBtn,
    },
  );
  const createdTask = {
    config: {
      operationBatchCode: "EZT261018",
      operationBatch: { code: "EZT261018", status: "success" },
    },
  };

  updateOperationBatchActions(createdTask);
  assert.equal(operationBatchUpdateManagedBtn.hidden, true);

  taskViewState.currentOperationBatchUpdateStatus = "update_available";
  taskViewState.currentOperationBatchManagedChanges = [{ path: "schedules[0].name" }];
  updateOperationBatchActions(createdTask);
  assert.equal(operationBatchUpdateManagedBtn.hidden, false);
  assert.equal(operationBatchUpdateManagedBtn.textContent, "更新批次");

  taskViewState.currentOperationBatchBaselineRequired = true;
  updateOperationBatchActions(createdTask);
  assert.equal(operationBatchUpdateManagedBtn.hidden, true);
});

test("operation batch draft follows the operation console two-column field order", () => {
  const labelsSource = sourceBetween(
    "      const operationBatchFieldLabels = [",
    "\n\n      function operationBatchSourceLabel(source) {",
  ).trim();
  const operationBatchFieldLabels = Function(
    `${labelsSource}; return operationBatchFieldLabels;`,
  )();
  assert.deepEqual(operationBatchFieldLabels.map(([key]) => key), [
    "operationTaskSerial",
    "projectCode",
    "projectName",
    "businessDirection",
    "businessDepartment",
    "businessOwner",
    "batchName",
    "projectDepartment",
    "examDateRange",
    "estimatedTotalSubjectCount",
    "estimatedMaxSubjectCount",
    "estimatedCityCount",
    "systemType",
    "stationUsage",
    "arrangementService",
    "onlineSettlementArrangementSource",
    "billingBasis",
    "serviceExam",
    "servicePersonnel",
    "contentParticipation",
    "contentService",
  ]);
  assert.equal(operationBatchFieldLabels.some(([key]) => key === "remark"), false);
  assert.match(html, /\.operation-batch-param-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(html, /data-operation-param="operationTaskSerial"[^}]*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);

  const renderOperationBatchDraft = compileInlineFunction(
    "      function renderOperationBatchDraft(draft = {}, hasCreatedBatch = false) {",
    "\n\n      function updateOperationBatchActions(task = taskViewState.currentProject) {",
    {
      operationBatchFieldLabels,
      safeText: (value) => String(value ?? ""),
      operationBatchSourceLabel: () => "泛微",
    },
  );
  const rendered = renderOperationBatchDraft({
    fields: {
      examStartDate: { value: "2026-08-06", source: "fanwei" },
      examEndDate: { value: "2026-08-08", source: "fanwei" },
    },
  });
  assert.ok(rendered.includes('class="operation-param-list operation-batch-param-list"'));
  assert.ok(rendered.includes('data-operation-param="examDateRange"'));
  assert.ok(rendered.includes("2026-08-06 ~ 2026-08-08"));
  assert.equal(rendered.includes('data-operation-param="remark"'), false);
});

test("project auto configuration action lives in the upper requirement source card", () => {
  assert.equal(html.includes('id="backToProjectsBtn"'), false);
  assert.equal(html.includes(">返回项目</button>"), false);
  assert.equal((html.match(/id="projectAutoConfigBtn"/g) || []).length, 1);
  assert.ok(html.includes('data-project-auto-config-slot'));
  assert.ok(html.includes("autoConfigSlot.append(projectAutoConfigBtn)"));
  assert.match(html, /id="projectSourceStrip"[\s\S]*?id="projectAutoConfigBtn"[^>]*hidden>进入自动配置<\/button>/s);
  assert.equal(html.includes("配置需求确认"), false);
  assert.ok(html.includes("<summary>需求变更</summary>"));
  assert.ok(html.includes("projectSourceRequirementChangeHistory"));
  assert.ok(html.includes("projectWorkflowSourceChangeNotice"));
  assert.ok(html.includes("workflow.steps?.[stepKey]?.changeNotice"));
  assert.ok(html.includes('const statusLabel = status === "update_available" ? ""'));
  assert.ok(html.includes('${statusLabel ? `<span class="tag'));
  assert.ok(html.includes('<details id="projectWechatBindingPanel" class="project-detail-disclosure is-collapsed">\n            <summary>微信采集</summary>'));
  assert.equal(html.includes("<summary>本项目微信群</summary>"), false);
  const changePanel = html.slice(
    html.indexOf('<details id="projectRequirementInlinePanel"'),
    html.indexOf('<details id="projectWechatBindingPanel"'),
  );
  assert.equal(changePanel.includes("panel-title"), false);
  assert.equal(changePanel.includes("后续需求单修改"), false);
  const operationPanel = html.slice(
    html.indexOf('<section id="projectOperationBatchPanel"'),
    html.indexOf('<dialog class="account-editor-modal operation-detail-modal"'),
  );
  assert.ok(operationPanel.includes('class="operation-workflow-title"'));
  assert.equal(operationPanel.includes("运控任务流"), false);
  assert.ok(operationPanel.includes('id="operationBatchRefreshBtn" type="button" hidden'));
  assert.ok(html.includes('projectAutoConfigBtn.addEventListener("click"'));
});

test("project workflow warnings render only unresolved operation field differences", () => {
  const notice = compileInlineFunction(
    "      function projectWorkflowSourceChangeNotice(workflow = {}, stepKey = \"\") {",
    "\n      function renderProjectSourceRequirementChangeLog",
  );
  const historicalOnly = {
    steps: { batch: { changeNotice: "" } },
    projectSourceChangeHistory: [{ source: "fanwei" }],
  };
  assert.equal(notice(historicalOnly, "batch"), "");
  assert.equal(notice({ steps: { batch: { changeNotice: "有变更请确认" } } }, "batch"), "有变更请确认");
});

test("project detail sections default to collapsed disclosures", () => {
  for (const [id, title] of [
    ["projectRequirementInlinePanel", "需求变更"],
    ["projectWechatBindingPanel", "微信采集"],
    ["projectSessionsPanel", "考试任务与场次"],
    ["projectFilesPanel", "相关文件"],
    ["projectLogsPanel", "项目日志"],
  ]) {
    assert.match(html, new RegExp(`<details[^>]*id="${id}"[^>]*>\\s*<summary>[\\s\\S]*?${title}[\\s\\S]*?</summary>`));
    assert.equal(new RegExp(`<details[^>]*id="${id}"[^>]*\\sopen(?:\\s|>)`).test(html), false);
  }
  assert.ok(html.includes('const projectDetailDisclosures = Array.from(document.querySelectorAll("#projectDetailView > .project-detail-disclosure"))'));
  assert.ok(html.includes("projectDetailDisclosures.forEach((panel) => setProjectDetailDisclosureExpanded(panel, false))"));
});

test("project session card sits directly above operation collaboration", () => {
  const projectDetailMarkup = sourceBetween(
    '        <section class="task-view" id="projectDetailView" hidden>',
    '\n        <section class="task-view" id="examListView" hidden>',
  );
  const sourceIndex = projectDetailMarkup.indexOf('id="projectSourceStrip"');
  const sessionsIndex = projectDetailMarkup.indexOf('id="projectSessionsPanel"');
  const operationIndex = projectDetailMarkup.indexOf('id="projectOperationBatchPanel"');

  assert.ok(sourceIndex >= 0 && sessionsIndex >= 0 && operationIndex >= 0);
  assert.ok(sourceIndex < sessionsIndex);
  assert.ok(sessionsIndex < operationIndex);
});

test("exam detail progress cards include paper binding and grouped candidate flows", () => {
  assert.ok(html.includes("buildTaskDisplaySteps(task)"));
  assert.ok(html.includes('if (taskHasAnyTrial(task) && stepMap.has("trial_session_create"))'));
  assert.ok(html.includes('if (taskHasAnyTrial(task) && stepMap.has("trial_paper_bind"))'));
  assert.ok(html.includes('if (taskHasAnyTrial(task)) display.push(buildGroupedCandidateStep(task, stepMap, "trial"))'));
  assert.ok(html.includes("试卷绑定"));
  assert.ok(html.includes("试考试卷绑定"));
  assert.ok(html.includes('stepMap.has("trial_paper_bind")'));
  assert.ok(html.includes("试考考生导入 & 自动分班"));
  assert.ok(html.includes("正式考试考生导入 & 自动分班"));
  assert.ok(html.includes("成绩处理"));
  assert.ok(html.includes("data-score-process"));
  assert.ok(html.includes("data-score-download"));
  assert.ok(html.includes('data-score-format="xlsx"'));
  assert.ok(html.includes('data-score-format="pdf"'));
  assert.ok(html.includes("下载成绩单 Excel"));
  assert.ok(html.includes("下载成绩单 PDF"));
  assert.ok(html.includes("data-score-stamp-archive-download"));
  assert.ok(html.includes("data-score-stamp-application"));
  assert.ok(html.includes("?format=${encodeURIComponent(format)}"));
  assert.ok(html.includes("data-monitor-download"));
  assert.ok(html.includes("下载监考账号"));
  assert.ok(html.includes("试卷绑定"));
  assert.equal(html.includes("触发试卷绑定"), false);
  assert.ok(html.includes('data-trigger-step="paper_form_bind"'));
  assert.ok(html.includes("function shouldShowRetryStepAction(step)"));
  assert.ok(html.includes("function shouldShowInlineRetryStepAction(step)"));
  assert.ok(html.includes("function retryStepActionHtml(step)"));
  assert.ok(html.includes('step.stepKey === "trial_paper_bind" && step.status === "pending"'));
  assert.ok(html.includes('shouldShowInlineRetryStepAction(step) ? retryStepActionHtml(step) : "",'));
  assert.ok(html.includes("${step.extraDetail ? `<div>${safeText(step.extraDetail)}</div>` : \"\"}"));
  assert.equal(html.includes("!step.hideLogs ? `<div style=\"margin-top:8px;\">${safeText(logs)}</div>` : \"\""), false);
  assert.ok(html.includes("继续绑定试考试卷"));
  assert.ok(html.includes("paperFormBind"));
  assert.ok(html.includes('stepName: "试卷绑定"'));
  assert.ok(html.includes("const stepLogs = sortTaskLogsNewestFirst(["));
  assert.ok(html.includes("function concisePaperBindLogMessage(message, fallback = \"\")"));
  assert.ok(html.includes("message: concisePaperBindLogMessage(log.message, paperState.errorMessage)"));
  assert.ok(html.includes("试卷绑定|试考默认卷"));
  assert.ok(html.includes("\\b(GET|POST|PUT)\\s+\\/"));
  assert.ok(html.includes("responseBody|requestBody|payload|HTTP Method|httpStatus"));
  assert.ok(html.includes('summaries.push("[试考默认卷] 开始绑定默认试考卷")'));
  assert.ok(html.includes("legacyTrialCourseMatch"));
  assert.ok(html.includes('const message = step.stepKey === "trial_paper_bind"'));
  assert.ok(html.includes("? concisePaperBindLogMessage(log.message, step.errorMessage)"));
  assert.ok(html.includes('message === "试卷绑定状态已更新"'));
  assert.ok(html.includes('/steps/${encodeURIComponent(retry.dataset.retryStep)}/retry'));
  assert.ok(html.includes('<div class="task-step-times">开始：${formatTaskTime(step.startedAt)}<br>完成：${formatTaskTime(step.completedAt)}</div>'));
  assert.equal(html.includes("耗时：${formatDuration(step.durationMs)}"), false);
});

test("paper binding controls and state are separated by requirement", () => {
  assert.ok(html.includes("function paperFormBindStatesForView(task = {})"));
  assert.ok(html.includes("function buildPaperFormBindDisplayStep(task)"));
  assert.ok(html.includes("paperFormBinds"));
  assert.ok(html.includes('data-trigger-step="paper_form_bind" data-requirement-index="${requirementIndex}"'));
  assert.ok(html.includes('const requirementLabel = paperStates.length > 1 ? `需求单 ${requirementIndex + 1} · ` : "";'));
  assert.ok(html.includes(">${requirementLabel}${actionLabel}</button>"));
  assert.ok(html.includes("paperFormBindRequirementSummary(task, requirementIndex, paperState)"));
  assert.ok(html.includes('body: JSON.stringify({ requirementIndex: Number(trigger.dataset.requirementIndex || 0) })'));
  assert.ok(html.includes('"试卷名称"'));
  assert.equal(html.includes('["17", "试卷名称"]'), false);
  assert.ok(html.includes('["17", "科目信息"]'));
  assert.ok(html.includes("function buildPaperBindFeedbackForTask(task, paperStates)"));
  assert.ok(html.includes("extraHtml: buildPaperBindFeedbackForTask(task, paperStates)"));
  assert.equal(html.includes('paper-bind-label">试卷编号'), false);
});

test("formal course binding feedback lists courses from every requirement", () => {
  const buildCourseBindFeedback = compileInlineFunction(
    "      function buildCourseBindFeedback(courseStep = {}, task = {}) {",
    "\n      function shouldShowRetryStepAction(step) {",
    {
      taskRequirementCount: () => 1,
      taskRequirementConfigForView: (task) => task.config.examRequirements[0].config,
      safeText: (value) => String(value ?? ""),
      buildCourseCodeCopyButton: () => "",
    },
  );
  const feedback = buildCourseBindFeedback(
    { result: { courses: [{ name: "旧科目", code: "20260803-01-01" }] } },
    { config: { examRequirements: [{ config: { courses: [{ name: "新科目", code: "20260803-01-01" }] } }] } },
  );

  assert.ok(html.includes('buildCourseBindFeedback(stepMap.get("course_create"), task)'));
  assert.ok(html.includes("taskRequirementConfigForView(task, requirementIndex)?.courses"));
  assert.ok(html.includes("courseStep?.requirementProgress?.[String(requirementIndex)]?.result?.courses"));
  assert.ok(html.includes("requirementCourses.length ? requirementCourses : fallbackCourses"));
  assert.ok(html.includes('<span class="course-bind-label">需求单</span>${requirementIndex + 1}'));
  assert.ok(feedback.includes("新科目"));
  assert.equal(feedback.includes("旧科目"), false);
});

test("all step card supporting content stays collapsed until its card opens", () => {
  assert.ok(html.includes(".task-step-extra-detail { display: none; }"));
  assert.ok(html.includes(".task-step-card.open .task-step-extra-detail { display: block; }"));
  assert.ok(html.includes("const collapsibleContentHtml = ["));
  assert.ok(html.includes("requirementProgressHtml,"));
  assert.ok(html.includes('step.monitorActionHtml || "",'));
  assert.ok(html.includes('step.triggerActionHtml || "",'));
  assert.ok(html.includes('step.extraHtml || "",'));
  assert.ok(html.includes('${collapsibleContentHtml ? `<div class="task-step-extra-detail">${collapsibleContentHtml}</div>` : ""}'));
  assert.ok(html.includes('if (card) card.classList.toggle("open")'));
});

test("configuration progress comes from required progress cards", () => {
  assert.ok(html.includes("const CONFIG_PROGRESS_STEP_KEYS = new Set"));
  assert.ok(html.includes('["paper_bind_display", "试卷绑定"]'));
  assert.ok(html.includes("function taskConfigurationProgress(task)"));
  assert.ok(html.includes("buildTaskDisplaySteps(task).filter(isConfigurationProgressStep)"));
  assert.ok(html.includes("if (!Array.isArray(task?.steps) || !task.steps.length) return clampProgress(task?.progress);"));
  assert.ok(html.includes("completedSteps / progressSteps.length"));
  assert.ok(html.includes("function taskConfigurationStageFromSteps(progressSteps"));
  assert.ok(html.includes('const failedStep = progressSteps.find((step) => step.status === "failed");'));
  assert.ok(html.includes("if (failedStep) return failedStep.stepName;"));
  assert.ok(html.includes('const currentStep = progressSteps.find((step) => step.status !== "success");'));
  const projectListSource = sourceBetween("function renderProjectList()", "async function runProjectListLoad()");
  assert.equal(projectListSource.includes("currentTaskProgress(task)"), false);
  assert.equal(projectListSource.includes("当前进度"), false);
  assert.equal(projectListSource.includes("mini-progress"), false);
  assert.ok(html.includes("const progressSteps = displaySteps.filter(isConfigurationProgressStep);"));
  assert.ok(html.includes("const displayProgress = taskConfigurationProgressFromSteps(progressSteps, task.progress);"));
  assert.ok(html.includes("currentTaskProgress(task)"));
  assert.equal(html.includes("task.progress || 0).toFixed(1)}%</div></div>"), false);
  assert.equal(html.includes("const progress = Number(task?.progress || 0);"), false);
});

test("exam detail session cards use candidate import and room status", () => {
  assert.ok(html.includes("function sessionCandidateStatusChip(task, sessionType, session)"));
  assert.ok(html.includes('return `<span class="status-chip waiting_manual">待导入名单</span>`'));
  assert.ok(html.includes('return statusChip("success")'));
  assert.ok(html.includes("sessionCandidateStatusChip(task, sessionType, session)"));
  assert.equal(html.includes("<h3>${label}</h3>${statusChip(session.status)}"), false);
  assert.ok(html.includes(".task-session-card h3 { margin: 0; font-size: 16px; font-weight: 800; }"));
  assert.ok(html.includes(".exam-session-summary strong { display: block; color: var(--text); font-weight: 800; }"));
  assert.ok(html.includes(".exam-session-time { margin-top: 4px; color: var(--text); font-weight: 800; white-space: nowrap; }"));
  assert.ok(html.includes(".task-step-name { font-weight: 800; line-height: 1.45; }"));
  assert.equal(html.includes("font-weight: 850"), false);
});

test("exam detail shows configuration complete when progress is 100 percent", () => {
  assert.ok(html.includes("function taskCurrentStageText(task, progress = currentTaskProgress(task), progressSteps = buildTaskDisplaySteps(task).filter(isConfigurationProgressStep))"));
  assert.ok(html.includes('return progress >= 100 ? "配置完成" : taskConfigurationStageFromSteps(progressSteps, task?.currentStage);'));
  assert.ok(html.includes('${safeText(taskCurrentStageText(task, displayProgress, progressSteps))}'));
});

test("cards and buttons share consistent corner radius tokens", () => {
  assert.ok(html.includes("--radius-card: 8px;"));
  assert.ok(html.includes("--radius-button: 6px;"));
  assert.match(html, /\.project-card,[\s\S]*\.task-overview,[\s\S]*\.task-step-card,[\s\S]*border-radius:\s*var\(--radius-card\)/);
  assert.match(html, /\.task-session-card,[\s\S]*\.candidate-card,[\s\S]*\.monitor-account-card[\s\S]*border-radius:\s*var\(--radius-card\)/);
  assert.match(html, /\.btn,[\s\S]*\.task-step-action,[\s\S]*\.candidate-session-actions\s+\.btn\.primary\s*\{[\s\S]*border-radius:\s*var\(--radius-button\)/);
  assert.match(html, /\.exam-filter-tab\.is-active\s*\{[\s\S]*border-radius:\s*var\(--radius-button\)/);
});

test("primary workflow pages share typography and corner radius hierarchy", () => {
  assert.match(html, /#autoTopbar h1,[\s\S]*#candidateTopbar h1,[\s\S]*#projectManagementView \.view-heading h1,[\s\S]*#examListView \.view-heading h1\s*\{\s*font-size:\s*25px/);
  assert.match(html, /#projectManagementView \.project-title,[\s\S]*#examListView \.exam-name-button,[\s\S]*#autoWorkbench \.panel-title,[\s\S]*#candidateImportPanel \.candidate-card-head \.panel-title\s*\{\s*font-size:\s*16px/);
  assert.match(html, /#projectManagementView \.panel,[\s\S]*#examListView \.exam-filter-panel,[\s\S]*#autoWorkbench \.workflow-inline,[\s\S]*#candidateImportPanel \.candidate-card[\s\S]*border-radius:\s*var\(--radius-card\)/);
  assert.match(html, /#projectManagementView \.field-input,[\s\S]*#examListView \.exam-filter-control,[\s\S]*#autoWorkbench \.btn,[\s\S]*#candidateImportPanel select[\s\S]*border-radius:\s*var\(--radius-button\)/);
  assert.ok(html.includes("grid-template-columns: minmax(360px, 5fr) minmax(150px, 1.4fr) minmax(180px, 1.6fr) 118px"));
  assert.ok(html.includes(".exam-query-btn { width: 118px; height: 44px; min-height: 44px; min-width: 118px;"));
  assert.ok(html.includes(".exam-filter-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); padding: 14px; }"));
  assert.ok(html.includes('id="examFilterTabs" role="tablist" aria-label="考试状态筛选" hidden'));
});

test("exam detail shows project shared sheet before score processing with a manual trigger", () => {
  assert.ok(html.includes("项目共享大表"));
  assert.ok(html.includes("短信通知"));
  assert.ok(html.includes("buildNotificationMessage"));
  assert.ok(html.includes("buildPsychologicalNotificationMessage"));
  assert.ok(html.includes("考生您好！"));
  assert.ok(html.includes("https://eztest.cn/exam/session/${examPathCode}/"));
  assert.ok(html.includes("https://eztest.org/exam/${examPathCode}/uniform/login/"));
  assert.ok(html.includes("/uniform/login/"));
  assert.ok(html.includes('examCode.replace(/^E(?=\\d+$)/i, "")'));
  assert.ok(html.includes("正式考试和试考时，"));
  assert.ok(html.includes("打开考试客户端输入口令和您的准考证号即可登录参加考试"));
  assert.ok(html.includes('const trialSession = getTaskSessionByRequirement(task, "trial", requirementIndex) || {}'));
  assert.ok(html.includes("config.mockExamEnabled || notificationTextValue(trialSession.session_id || trialSession.id)"));
  assert.ok(html.includes("const trialNotice = hasTrial"));
  assert.ok(html.includes("data-shared-sheet-fill"));
  assert.ok(html.includes("打开在线表"));
  assert.ok(html.includes("https://docs.qq.com/sheet/DY1pQTURrc1BSSlND?tab=gd4707"));
  assert.match(html, /\.task-step-action,\s*\.sms-platform-link,\s*\.sms-candidate-download\s*\{[\s\S]*min-height:\s*28px;[\s\S]*background:\s*var\(--blue\);[\s\S]*color:\s*#fff;[\s\S]*padding:\s*5px 10px;[\s\S]*font-size:\s*12px;/);
  assert.match(html, /\.task-step-action:disabled,\s*\.sms-candidate-download:disabled\s*\{[\s\S]*color:\s*var\(--muted\);[\s\S]*background:\s*#f4f7fb;[\s\S]*opacity:\s*1;[\s\S]*cursor:\s*not-allowed;/);
  assert.match(html, /\.sms-copy-button\s*\{[\s\S]*width:\s*28px;[\s\S]*background:\s*transparent;[\s\S]*color:\s*var\(--blue\);[\s\S]*padding:\s*0;/);
  assert.match(html, /\.task-step-action,[\s\S]*border-radius:\s*var\(--radius-button\)/);
  assert.ok(html.includes("填写"));
  assert.equal(html.includes("触发填写"), false);
  assert.ok(html.includes("重新填写"));
  assert.ok(html.includes("/shared-sheet/fill"));
  const displaySteps = html.slice(
    html.indexOf("function buildTaskDisplaySteps(task)"),
    html.indexOf("function renderTaskDetail(task)"),
  );
  const sharedSheetStep = displaySteps.slice(
    displaySteps.indexOf('stepKey: "project_shared_sheet"'),
    displaySteps.indexOf('stepKey: "sms_notification"'),
  );
  assert.ok(sharedSheetStep.includes("buildSharedSheetDetail"));
  assert.ok(html.includes('return `填写完成：${formatTaskTime(sharedSheetStep.completedAt)}`'));
  assert.equal(html.includes('填写中 - 填写完成'), false);
  assert.ok(sharedSheetStep.includes("hideLogs: true"));
  assert.ok(displaySteps.indexOf('stepKey: "project_shared_sheet"') < displaySteps.indexOf('stepKey: "score_process"'));
  assert.ok(displaySteps.indexOf('stepKey: "project_shared_sheet"') < displaySteps.indexOf('stepKey: "sms_notification"'));
  assert.ok(displaySteps.indexOf('stepKey: "sms_notification"') < displaySteps.indexOf('stepKey: "score_process"'));
  assert.ok(html.includes("function buildRequirementSmsHtml(task)"));
  assert.ok(html.includes("buildNotificationMessage(task, requirementIndex)"));
  assert.ok(html.includes("buildPsychologicalNotificationMessage(task, requirementIndex)"));
  assert.ok(html.includes('data-sms-requirement-index="${requirementIndex}"'));
  assert.ok(html.includes('class="sms-requirement-tabs"'));
  assert.ok(html.includes('data-sms-requirement-tab="${requirementIndex}"'));
  assert.ok(html.includes('event.target.closest("[data-sms-requirement-tab]")'));
  assert.equal(html.includes('.task-step-card[data-step-key="sms_notification"] { grid-column: 1 / -1; }'), false);
  assert.ok(html.includes('candidate.session_id || "") === sessionId'));
  const smsStep = displaySteps.slice(
    displaySteps.indexOf('stepKey: "sms_notification"'),
    displaySteps.indexOf('const scoreStep = stepMap.get("score_process")'),
  );
  assert.equal(smsStep.includes("triggerActionHtml"), false);
  assert.equal(smsStep.includes("extraDetail: notificationMessage"), false);
  assert.ok(smsStep.includes("hideDetail: true"));
  assert.ok(smsStep.includes("extraHtml"));
  assert.ok(html.includes("data-copy-sms"));
  assert.ok(smsStep.includes("buildRequirementSmsHtml(task)"));
  assert.ok(html.includes("sms-action-row"));
  const smsBuilder = sourceBetween("function buildRequirementSmsHtml(task)", "function buildGroupedCandidateStep");
  assert.ok(smsBuilder.includes("https://home.danmi.com/#/login"));
  assert.ok(smsBuilder.includes("旦米"));
  assert.ok(html.includes("sms-platform-link"));
  assert.ok(smsBuilder.includes("buildSmsCandidateTable(requirementCandidates)"));
  assert.equal(smsBuilder.includes('<div class="sms-action-row"><button class="sms-copy-button"'), false);
  assert.ok(smsBuilder.includes('<div class="sms-action-row">${buildSmsCandidateTable(requirementCandidates)}<a class="sms-platform-link"'));
  assert.ok(smsBuilder.includes('<div class="sms-message-list"><div class="sms-message-body">${buildSmsCopyButton(notificationMessage)}<div class="sms-message-text">${safeText(notificationMessage)}</div></div><div class="sms-message-body">${buildSmsCopyButton(psychologicalNotificationMessage)}<div class="sms-message-text">${safeText(psychologicalNotificationMessage)}</div></div></div>'));
  assert.ok(html.includes("function buildSmsCopyButton(message)"));
  assert.ok(html.includes("function buildCourseCodeCopyButton(courseCode)"));
  assert.ok(html.includes('aria-label="复制短信"'));
  assert.ok(html.includes('aria-label="复制科目编号"'));
  assert.ok(html.includes('class="sms-copy-icon"'));
  assert.ok(html.includes(".sms-message-body + .sms-message-body"));
  assert.equal(smsBuilder.includes('data-sms-toggle="message"'), false);
  assert.equal(smsBuilder.includes("展开全部"), false);
  assert.equal(html.includes(".sms-notification-preview.is-expanded .sms-message-text"), false);
  assert.equal(html.includes(".sms-expand-button"), false);
  assert.equal(html.includes('event.target.closest("[data-sms-toggle]")'), false);
  assert.ok(html.includes("async function activateSmsRequirement(smsCard, activeIndex)"));
  assert.ok(html.includes('window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches'));
  assert.ok(html.includes('transform: "translateY(-6px)"'));
  assert.ok(html.includes('transform: "translateY(6px)"'));
  assert.ok(html.includes("group.getAnimations?.().forEach((animation) => animation.cancel())"));
  assert.ok(html.includes("outgoingAnimation?.cancel()"));
  assert.ok(html.includes("incomingAnimation?.cancel()"));
  assert.ok(html.includes("await activateSmsRequirement(smsCard, activeIndex)"));
  assert.equal(html.includes("sms-candidate-table"), false);
  assert.ok(html.includes("sms-candidate-download"));
  assert.ok(html.includes("data-download-sms-candidates"));
  assert.ok(html.includes("downloadSmsCandidatesCsv"));
  assert.ok(html.includes("考生姓名"));
  assert.ok(html.includes("手机号码"));
  assert.ok(html.includes('type="button">考生手机号下载</button>'));
  assert.equal(html.includes("<small>Download</small>"), false);
  assert.equal(html.includes(">复制</button>"), false);
  assert.equal(html.includes(">复制短信</button>"), false);
  assert.ok(html.includes("smsCandidateRows"));
  assert.ok(html.includes("考生手机号.csv"));
  assert.ok(html.includes("sms-copy-button"));
  assert.ok(html.includes("overflow-wrap: anywhere"));
  assert.ok(html.includes("function copyTextToClipboard"));
  assert.ok(html.includes("navigator.clipboard.writeText"));
  assert.ok(html.includes('document.execCommand("copy")'));
  assert.ok(html.includes('event.target.closest("[data-copy-sms], [data-copy-course-code]")'));
  assert.ok(html.includes('await copyTextToClipboard(smsCopy.dataset.copyCourseCode ?? smsCopy.dataset.copySms ?? "")'));
  assert.ok(html.includes('smsCopy.classList.add("is-copied")'));
  assert.ok(html.includes('smsCopy.setAttribute("aria-label", "已复制")'));
  assert.ok(html.includes('.sms-copy-button.is-copied::after'));
  assert.ok(html.includes('content: "已复制"'));
  assert.ok(html.includes('bottom: calc(100% + 9px)'));
  assert.ok(html.includes('if (card && window.getSelection()?.toString().trim()) return;'));
  assert.equal(html.includes('smsCopy.textContent = "已复制"'), false);
  assert.ok(html.includes("!step.hideDetail"));
  assert.equal(html.includes("!step.hideLogs"), false);
});

test("psychological SMS uses the exam password in the selected address format", () => {
  const usesUnifiedAddress = compileInlineFunction(
    "      function notificationUsesUnifiedExamAddress(config, session) {",
    "\n      function buildNotificationMessage(task, requirementIndex = 0) {",
    {
      notificationTextValue: (value) => String(value ?? "").trim(),
      unifiedExamCodeFromNotificationUrl: (value) => {
        const match = String(value ?? "").match(/\/exam\/(\d+)\/uniform\/login\/?/i);
        return match ? `E${match[1]}` : "";
      },
    },
  );
  const buildMessage = compileInlineFunction(
    "      function buildPsychologicalNotificationMessage(task, requirementIndex = 0) {",
    "\n      function buildRequirementSmsHtml(task) {",
    {
      taskRequirementConfigForView: (task) => task.config,
      getTaskSessionByRequirement: (task) => task.session,
      notificationTextValue: (value) => String(value ?? "").trim(),
      notificationExamTitle: (value) => String(value ?? "").replace(/-试考$/, ""),
      fullNotificationDateTime: () => "2026年8月8日(周六)10:00",
      notificationTimeOnly: () => "17:00",
      notificationExamPassword: (config, session) => config.examPassword || session.session_id,
      notificationUsesUnifiedExamAddress: usesUnifiedAddress,
    },
  );
  const task = {
    config: {
      examName: "心理测评",
      startTimeDisplay: "2026-08-08 10:00",
      endTimeDisplay: "2026-08-08 17:00",
      examPassword: "434392",
    },
    session: { session_id: "434392" },
  };

  const independentMessage = buildMessage({
    ...task,
    config: { ...task.config, examAddress: "独立考试地址" },
  });
  assert.match(independentMessage, /心理测评网址:https:\/\/eztest\.cn\/exam\/session\/434392\//);
  assert.doesNotMatch(independentMessage, /uniform\/login/);

  const unifiedMessage = buildMessage({
    ...task,
    config: { ...task.config, examAddress: "统一考试地址", examPassword: "E107910" },
  });
  assert.match(unifiedMessage, /心理测评网址:https:\/\/eztest\.org\/exam\/107910\/uniform\/login\//);
});

test("score feedback downloads use the server-provided exam-prefixed filename", () => {
  const downloadBlock = html.slice(
    html.indexOf("function downloadFileNameFromDisposition"),
    html.indexOf("async function openTaskDetail"),
  );
  assert.ok(downloadBlock.includes("filename\\*=UTF-8''"));
  assert.ok(downloadBlock.includes('response.headers.get("Content-Disposition")'));
  assert.ok(downloadBlock.includes("scoreFeedbackDownloadFileName(response, format)"));
  assert.equal(downloadBlock.includes('link.download = format === "pdf" ? "成绩反馈单.pdf" : "成绩反馈单.xlsx";'), false);
});

test("score process card downloads assessment documents when links exist", () => {
  const scoreAction = sourceBetween("function buildScoreProcessAction", "function scoreStampApplicationStatusText");
  assert.ok(html.includes("下载测评文档"));
  assert.ok(html.includes("data-score-report-download"));
  assert.equal(scoreAction.includes("下载盖章压缩包"), false);
  assert.equal(scoreAction.includes("data-score-stamp-archive-download"), false);
  assert.ok(scoreAction.indexOf("下载成绩单 PDF") < scoreAction.indexOf("${reportDownloadHtml}"));
  assert.ok(scoreAction.indexOf("${reportDownloadHtml}") < scoreAction.indexOf("${stampApplicationHtml}"));
  assert.ok(html.includes("reportLinkCount"));
  assert.ok(html.includes("Number(scoreStep?.result?.reportLinkCount || 0) > 0"));
  assert.ok(html.includes("/scores/reports/download"));
  assert.ok(html.includes("function scoreReportsDownloadFileName(response)"));
  assert.ok(html.includes("async function downloadScoreReports(taskId)"));
  assert.ok(html.includes("scoreReportsDownloadFileName(response)"));
  assert.ok(html.includes("const scoreReportDownload = event.target.closest(\"[data-score-report-download]\")"));
  assert.ok(html.includes("await downloadScoreReports(scoreReportDownload.dataset.scoreReportDownload)"));
});

test("score process card can retry OA seal application and download encrypted stamp archive", () => {
  assert.ok(html.includes("function scoreStampApplicationStatusText(scoreStep)"));
  assert.ok(html.includes("上传加密压缩包并保存"));
  assert.ok(html.includes("已打开 OA 申请页并上传加密压缩包"));
  assert.ok(html.includes("async function triggerScoreStampApplication(taskId)"));
  assert.ok(html.includes("async function triggerScoreStampApplicationViaHelper(taskId)"));
  assert.ok(html.includes("async function ensureScoreStampLocalHelper(requiredCapability"));
  assert.ok(html.includes("async function submitScoreStampApplicationResult(taskId, stampApplication)"));
  assert.ok(html.includes("SCORE_STAMP_TODO_LIST_URL"));
  assert.ok(html.includes("https://oa.ata.net.cn/wui/index.html#/main/workflow/listDoing?menuIds=1,13&menuPathIds=1,13&_key=wx3if1"));
  assert.ok(html.includes(">提交申请</a>"));
  assert.ok(html.includes("stampStatus === \"opened\" && stampApplication.saved"));
  assert.ok(html.includes('fetchFanweiHelper("/score-stamp/start"'));
  assert.ok(html.includes('ensureScoreStampLocalHelper("scoreStampApplication")'));
  assert.ok(html.includes("/scores/stamp-application/prepare"));
  assert.ok(html.includes("/scores/stamp-application/result"));
  assert.ok(html.includes("本机助手版本过旧"));
  assert.ok(html.includes("await triggerScoreStampApplication(taskId)"));
  const triggerFunction = sourceBetween(
    "async function triggerScoreStampApplication(taskId)",
    "async function triggerProjectSharedSheetFill(taskId)",
  );
  assert.ok(triggerFunction.includes("triggerScoreStampApplicationViaHelper(taskId)"));
  assert.equal(triggerFunction.includes("/scores/stamp-application"), false);
  assert.equal(triggerFunction.includes("IS_LOOPBACK_CONSOLE"), false);
  assert.ok(html.includes("async function downloadScoreStampArchive(taskId)"));
  assert.ok(html.includes("/scores/stamp-archive/download"));
  assert.ok(html.includes("scoreStampArchiveDownloadFileName(response)"));
  assert.ok(html.includes('const scoreStampApplication = event.target.closest("[data-score-stamp-application]")'));
  assert.ok(html.includes('const scoreStampArchiveDownload = event.target.closest("[data-score-stamp-archive-download]")'));
});

test("auto config page exposes exam request template download instead of demo import", () => {
  assert.ok(html.includes("导入模板下载"));
  assert.ok(html.includes("/api/templates/exam-request"));
  assert.equal(html.includes("模拟导入"), false);
  assert.equal(html.includes("applyImportResult(demoData.filename, demoData)"), false);
});

test("Fanwei local helper owns status, Chrome launch, and reads on the coworker's computer", () => {
  const fanweiSection = sourceBetween(
    '<section class="task-view" id="fanweiTestView"',
    '<section class="task-view" id="projectDetailView"',
  );
  assert.ok(fanweiSection.includes('id="fanweiCopyScriptBtn"'));
  assert.ok(fanweiSection.includes(">读取泛微信息</button>"));
  assert.ok(fanweiSection.includes('id="fanweiSerialInput"'));
  assert.ok(fanweiSection.includes('id="fanweiImportBtn" type="button" disabled'));
  assert.ok(fanweiSection.includes('id="fanweiInstallHelperBtn" type="button" hidden'));
  assert.ok(fanweiSection.includes('id="fanweiHelperWindowsDownload" href="/api/fanwei/helper-installer?platform=windows" hidden'));
  assert.ok(fanweiSection.includes('id="fanweiHelperMacDownload" href="/api/fanwei/helper-installer?platform=macos" hidden'));
  assert.ok(fanweiSection.includes("/api/fanwei/helper-installer?platform=windows"));
  assert.ok(fanweiSection.includes("/api/fanwei/helper-installer?platform=macos"));
  assert.equal(fanweiSection.includes('id="fanweiSerialInput" value="R0042182"'), false);
  assert.match(fanweiSection, /自动读取|自动读取真实泛微字段/);
  assert.equal(fanweiSection.includes("到已登录的泛微主表页执行"), false);

  assert.ok(html.includes('const FANWEI_HELPER_BASE = "http://127.0.0.1:18765";'));
  const helperFetchFunction = sourceBetween(
    "async function fetchFanweiHelper(path, options = {})",
    "async function copyFanweiReaderScript()",
  );
  assert.ok(helperFetchFunction.includes("new AbortController()"));
  assert.ok(helperFetchFunction.includes("setTimeout"));
  assert.ok(helperFetchFunction.includes('cache: "no-store"'));
  assert.ok(helperFetchFunction.includes('credentials: "omit"'));
  assert.ok(helperFetchFunction.includes("response.text()"));
  assert.ok(helperFetchFunction.includes("JSON.parse"));
  assert.ok(helperFetchFunction.includes("data.error?.message"));
  assert.ok(helperFetchFunction.includes("本机助手未连接或未授权当前 8765 地址"));
  assert.ok(helperFetchFunction.includes('helperError.code = "helper_unreachable"'));

  const copyFunction = sourceBetween(
    "async function copyFanweiReaderScript()",
    "async function loadFanweiAutoReadStatus()",
  );
  assert.ok(copyFunction.includes('fetchFanweiHelper("/fanwei/read"'));
  assert.ok(copyFunction.includes("body: JSON.stringify({ serialNo })"));
  assert.ok(copyFunction.includes("data.ok !== true"));
  assert.ok(copyFunction.includes("Object.keys(data.data.fields).length"));
  assert.ok(copyFunction.includes('data.data.fields["运控流水号"]'));
  assert.ok(copyFunction.includes("returnedSerialNo !== serialNo"));
  assert.ok(copyFunction.includes('`${runtime.apiBase}/api/fanwei/requirement-preview`'));
  assert.ok(copyFunction.includes("fanwei: raw"));
  assert.ok(copyFunction.includes("uiState.fanweiRead = { serialNo, raw, model }"));
  assert.ok(copyFunction.includes("renderFanweiModel(model)"));
  assert.ok((copyFunction.match(/assertCurrentFanweiSerial\(serialNo\)/g) || []).length >= 2);
  assert.equal(copyFunction.includes("acceptFanweiImport"), false);
  assert.equal(copyFunction.includes("applyImportResult"), false);
  assert.equal(copyFunction.includes("/api/fanwei/requirement-import"), false);
  assert.ok(copyFunction.includes('fanweiReadTransport === "server"'));
  assert.ok(copyFunction.includes("virtualSerial || fanweiReadTransport"));
  assert.ok(copyFunction.includes("正在生成全合成的虚拟泛微需求"));
  assert.ok(copyFunction.includes('`${runtime.apiBase}/api/fanwei/local-read`'));
  assert.equal(copyFunction.includes("/api/fanwei/auto-read"), false);
  assert.equal(copyFunction.includes("navigator.clipboard.writeText(script)"), false);
  assert.equal(copyFunction.includes("pollFanweiBridgeResult"), false);
  assert.equal(copyFunction.includes("请切到泛微主表页执行"), false);

  const statusFunction = sourceBetween(
    "async function loadFanweiAutoReadStatus()",
    "async function createFanweiRequirementImport()",
  );
  const downloadVisibilityFunction = sourceBetween(
    "function setFanweiHelperDownloadsVisible(visible)",
    "function resetFanweiReadState()",
  );
  assert.ok(downloadVisibilityFunction.includes("fanweiHelperWindowsDownload.hidden = !visible"));
  assert.ok(downloadVisibilityFunction.includes("fanweiHelperMacDownload.hidden = !visible"));
  assert.ok(statusFunction.includes("setFanweiHelperDownloadsVisible(false)"));
  assert.ok(statusFunction.includes("setFanweiHelperDownloadsVisible(true)"));
  assert.ok(statusFunction.indexOf("setFanweiHelperDownloadsVisible(true)") > statusFunction.indexOf("} catch (error) {"));
  assert.ok(statusFunction.includes('fetchFanweiHelper("/health"'));
  assert.ok(statusFunction.includes('fetchFanweiHelper("/chrome/ensure"'));
  assert.ok(statusFunction.includes("IS_LOOPBACK_CONSOLE"));
  assert.ok(statusFunction.includes("/api/fanwei/auto-read/status"));
  assert.ok(statusFunction.includes('fanweiReadTransport = "server"'));
  assert.ok(statusFunction.includes("fanweiInstallHelperBtn.hidden = false"));
  assert.ok(statusFunction.includes("安装本机助手"));
  assert.ok(statusFunction.includes("本机助手未安装或未启动"));
  assert.ok(statusFunction.includes('error.code === "chrome_not_found"'));
  assert.ok(statusFunction.includes("请先安装 Google Chrome"));
  assert.ok(statusFunction.includes("已自动打开专用 Chrome"));
  assert.ok(statusFunction.includes("登录泛微并打开对应需求单页面"));
  assert.ok(statusFunction.includes("fanweiTabFound"));
});

test("fanwei top actions keep hint spacing visually balanced", () => {
  const fanweiSection = sourceBetween(
    '<section class="task-view" id="fanweiTestView"',
    '<section class="task-view" id="projectDetailView"',
  );
  const toolbar = sourceBetween(
    '<div class="fanwei-toolbar mb-2">',
    '<div class="fanwei-workbench">',
  );
  assert.ok(toolbar.includes('<div class="fanwei-action-stack gap-2">'));
  assert.ok(toolbar.includes('<div class="view-actions items-center">'));
  assert.ok(toolbar.includes('class="field-input h-10" id="fanweiSerialInput"'));
  assert.ok(toolbar.includes('class="btn h-10" id="fanweiCopyScriptBtn"'));
  assert.ok(toolbar.includes('class="btn h-10" id="fanweiHelperWindowsDownload" href="/api/fanwei/helper-installer?platform=windows" hidden'));
  assert.ok(toolbar.includes('class="btn h-10" id="fanweiHelperMacDownload" href="/api/fanwei/helper-installer?platform=macos" hidden'));
  assert.ok(toolbar.includes('class="btn primary h-10" id="fanweiImportBtn"'));
  assert.ok(toolbar.includes('<button class="btn primary h-10" id="fanweiImportBtn" type="button" disabled>进入自动配置</button>'));
  assert.equal(toolbar.includes("生成需求单并进入自动配置"), false);
  assert.ok(toolbar.includes('<p class="task-meta fanwei-toolbar-status m-0 text-gray-500" id="fanweiImportState"'));
  assert.equal(fanweiSection.includes('<div class="task-meta fanwei-toolbar-status" id="fanweiImportState"'), false);
  assert.match(html, /\.gap-2\s*\{\s*gap:\s*8px;?\s*\}/);
  assert.match(html, /\.mb-2\s*\{\s*margin-bottom:\s*8px;?\s*\}/);
  assert.match(html, /\.h-10\s*\{[^}]*height:\s*40px;[^}]*\}/);
  assert.match(html, /\.items-center\s*\{\s*align-items:\s*center;?\s*\}/);
  assert.match(html, /\.m-0\s*\{\s*margin:\s*0;?\s*\}/);
  assert.match(html, /\.text-gray-500\s*\{\s*color:\s*#6b7280;?\s*\}/);
  assert.match(html, /\.fanwei-action-stack\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*100%;/s);
  assert.match(html, /\.fanwei-toolbar-content \.view-actions\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*width:\s*max-content;[^}]*max-width:\s*100%;/s);
  assert.match(html, /\.fanwei-toolbar-status\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*20px;[^}]*\}/);

  const workbenchCss = sourceBetween(".fanwei-workbench {", ".fanwei-toolbar {");
  assert.equal(workbenchCss.includes("margin-top"), false);
});

test("fanwei test page removes redundant local heading block", () => {
  const fanweiSection = sourceBetween(
    '<section class="task-view" id="fanweiTestView"',
    '<section class="task-view" id="projectDetailView"',
  );
  assert.equal(fanweiSection.includes('<div class="view-heading">'), false);
  assert.equal(fanweiSection.includes('id="backFromFanweiBtn"'), false);
  assert.equal(fanweiSection.includes("泛微新建项目"), false);
  assert.equal(fanweiSection.includes("通过泛微流水号生成易考新建考试需求单"), false);
  assert.equal(fanweiSection.includes("泛微主表和服务确认单字段会在这里合并展示。"), false);
  assert.equal(fanweiSection.includes("生成内容会保持原模板下拉和默认配置。"), false);
  assert.ok(html.includes('backFromFanweiBtn?.addEventListener("click"'));
});

test("fanwei test page keeps field cards and requirement dropdowns", () => {
  const fanweiSection = sourceBetween(
    '<section class="task-view" id="fanweiTestView"',
    '<section class="task-view" id="projectDetailView"',
  );
  assert.ok(fanweiSection.includes('class="fanwei-workbench"'));
  assert.match(html, /\.fanwei-workbench\s*\{[^}]*align-items:\s*stretch/s);
  assert.ok(fanweiSection.includes('class="fanwei-field-list"'));
  assert.ok(fanweiSection.includes('<div class="empty-state">等待读取</div>'));
  assert.equal(fanweiSection.includes("等待读取泛微单"), false);
  assert.ok(fanweiSection.includes('id="fanweiRequirementEmpty"'));
  assert.ok(fanweiSection.includes('<div class="empty-state">等待生成</div>'));
  assert.ok(fanweiSection.includes('id="fanweiRequirementTableWrap" hidden'));
  assert.ok(fanweiSection.includes('id="fanweiRequirementTable"'));
  assert.ok(fanweiSection.includes('id="fanweiRequirementTabs"'));
  assert.ok(fanweiSection.includes('id="fanweiDuplicateRequirementBtn"'));
  assert.ok(fanweiSection.includes('class="btn primary fanwei-requirement-copy"'));
  assert.ok(fanweiSection.includes("data-fanwei-requirement-duplicate"));
  assert.ok(fanweiSection.includes('class="fanwei-requirement-title-row"><h2 class="panel-title">易考需求单</h2><span class="task-meta fanwei-requirement-count" id="fanweiRequirementCount" hidden></span>'));
  assert.equal(fanweiSection.includes('<p class="task-meta fanwei-requirement-count" id="fanweiRequirementCount"'), false);
  assert.ok(html.includes('class="exam-table fanwei-requirement-sheet"'));
  assert.ok(html.includes(".fanwei-field-card"));
  assert.ok(html.includes(".fanwei-source-pill"));
  assert.ok(html.includes(".fanwei-requirement-stack"));
  assert.ok(html.includes(".fanwei-requirement-layer"));
  assert.ok(html.includes(".fanwei-requirement-sheet"));
  assert.ok(html.includes(".fanwei-select"));
  assert.ok(html.includes("const fanweiSelectOptions = {"));
  assert.ok(html.includes('"试卷扣时规则": ["不扣时", "迟到扣时", "迟到及离开扣时"]'));

  const renderModelFunction = sourceBetween(
    "function renderFanweiModel(model = {})",
    "async function acceptFanweiImport",
  );
  const renderStackFunction = sourceBetween(
    "function renderFanweiRequirementStack()",
    "function activateFanweiRequirement",
  );
  const renderValueFunction = sourceBetween(
    "function renderFanweiRequirementValue(item, value, requirementIndex)",
    "function ensureFanweiRequirementFields",
  );
  assert.ok(renderModelFunction.includes("fanwei-field-card"));
  assert.ok(renderModelFunction.includes("uiState.fanweiRequirements ="));
  assert.ok(renderModelFunction.includes("renderFanweiRequirementStack()"));
  assert.ok(renderModelFunction.includes("fanweiRequirementEmpty.hidden = true"));
  assert.ok(renderModelFunction.includes("fanweiRequirementTableWrap.hidden = false"));
  assert.ok(renderStackFunction.includes("renderFanweiRequirementRows(requirement.fields, index)"));
  assert.ok(renderStackFunction.includes('data-fanwei-requirement-layer="${index}"'));
  assert.ok(renderValueFunction.includes('contenteditable="true"'));
  assert.ok(renderValueFunction.includes("data-fanwei-field"));
  assert.ok(renderValueFunction.includes("data-fanwei-requirement-index"));
  assert.ok(renderValueFunction.includes("fanwei-select"));
});

test("fanwei requirement sheets expose a scoped three-stage 42-item configuration picker", () => {
  const fanweiSection = sourceBetween(
    '<section class="task-view" id="fanweiTestView"',
    '<section class="task-view" id="projectDetailView"',
  );
  const catalogSource = sourceBetween("const fanweiConfigCatalog = {", "const fanweiConfigItems =");
  const itemIds = [...catalogSource.matchAll(/id:\s*"([a-z0-9_]+)"/g)].map((match) => match[1]);

  assert.ok(html.includes('id="fanweiConfigPickerModal"'));
  assert.ok(html.includes('class="account-editor-modal fanwei-config-picker-modal"'));
  assert.ok(html.includes('id="fanweiConfigPickerModal" aria-label="配置选择"'));
  assert.equal(html.includes('id="fanweiConfigPickerTitle"'), false);
  assert.ok(html.includes('id="fanweiConfigPickerOptions"'));
  assert.ok(html.includes('id="fanweiConfigPickerSelected"'));
  assert.ok(html.includes('data-fanwei-config-stage="before"'));
  assert.ok(html.includes('data-fanwei-config-stage="during"'));
  assert.ok(html.includes('data-fanwei-config-stage="after"'));
  assert.ok(html.includes('aria-selected="true">开考前</button>'));
  assert.ok(html.includes('aria-selected="false">考试中</button>'));
  assert.ok(html.includes('aria-selected="false">考试后</button>'));
  assert.equal(html.includes("开考前配置</button>"), false);
  assert.equal(html.includes("考试中配置</button>"), false);
  assert.equal(html.includes("考试后配置</button>"), false);
  assert.equal(itemIds.length, 42);
  assert.equal(new Set(itemIds).size, 42);

  const pickerStyles = sourceBetween(
    "      .fanwei-config-picker-modal {",
    "      .exam-list-table th,",
  );
  assert.ok(pickerStyles.includes("--fanwei-picker-glass-surface:"));
  assert.ok(pickerStyles.includes("background: var(--fanwei-picker-glass-surface);"));
  assert.ok(pickerStyles.includes("background: var(--fanwei-picker-glass-raised);"));
  assert.ok(pickerStyles.includes("border-bottom: 1px solid var(--fanwei-picker-glass-divider);"));
  assert.equal(pickerStyles.includes(".fanwei-config-picker-modal::backdrop { background: rgba(15, 23, 42, 0.42); }"), false);

  const baseRowIds = sourceBetween(
    "const fanweiConfigBaseRowIds = new Set([",
    "]);",
  );
  ["nda", "monitor", "save_video", "eagle_eye", "lock_screen", "manual_score"].forEach((id) => {
    assert.ok(baseRowIds.includes(`"${id}"`));
  });

  const renderStackFunction = sourceBetween(
    "function renderFanweiRequirementStack()",
    "function activateFanweiRequirement",
  );
  assert.ok(renderStackFunction.includes('data-fanwei-config-open="${index}"'));
  assert.ok(renderStackFunction.includes(">增加配置</button>"));
  assert.ok(
    renderStackFunction.indexOf('data-fanwei-requirement-delete="${index}"')
      < renderStackFunction.indexOf("${configButton}"),
  );
  assert.ok(html.includes(".fanwei-requirement-config {\n        margin-left: auto;"));
  assert.ok(html.includes(".fanwei-requirement-config,\n      .fanwei-requirement-copy {\n        width: 90px;\n        min-width: 90px;\n        min-height: 29px;\n        height: 29px;"));
  assert.equal(html.includes(".fanwei-requirement-copy {\n        min-height: 29px;\n        height: 29px;\n        margin-left: auto;"), false);

  const renderRowsFunction = sourceBetween(
    "function renderFanweiRequirementRows(fields, requirementIndex)",
    "function renderFanweiRequirementStack()",
  );
  assert.ok(renderRowsFunction.includes("!fanweiConfigBaseRowIds.has(item.id)"));

  const saveFunction = sourceBetween(
    "function saveFanweiConfigSelection()",
    "function closeFanweiConfigPicker",
  );
  assert.ok(saveFunction.includes("uiState.fanweiRequirements[requirementIndex]"));
  assert.ok(saveFunction.includes("explicit: true"));
  assert.equal(saveFunction.includes("uiState.fanweiRequirements.map"), false);
});

test("fanwei config picker reflects the current requirement before opening", () => {
  const catalogSource = sourceBetween("const fanweiConfigCatalog = {", "const fanweiConfigItems =");
  const defaultSelection = compileInlineFunction(
    "function defaultFanweiConfigSelection(fields = {})",
    "\n\n      function cloneFanweiConfigSelection",
    {
      fanweiDefaultConfigIds: ["watermark", "copy_item_unable"],
      fanweiConfigItems: [
        "nda", "monitor", "save_video", "login_validation", "face_detection_dur", "ai_gaze",
        "eagle_eye", "desktop_monitor", "desktop_monitor_video", "lock_screen", "client_required",
        "exclusive_network", "watermark", "copy_item_unable", "show_point", "public_score", "manual_score",
      ].map((id) => ({ id })),
    },
  );
  const clientSelection = defaultSelection({
    "考试类型": "客户端考试",
    "登录验证": "自动验证；考后公安验证",
    "登陆次数": "10",
    "视频监控": "需要",
    "视频录制": "开启录制",
    "鹰眼监控": "需要",
    "考试承诺书内容": "已填写",
  });
  const webSelection = defaultSelection({
    "考试类型": "网页考试",
    "登录验证方式": "人工审核",
    "允许离开次数（网页考试时填写）": "3",
  });
  const recordingDisabledSelection = defaultSelection({
    "视频监控": "需要",
    "视频录制": "无需录制",
  });
  const openPicker = sourceBetween(
    "function openFanweiConfigPicker(requirementIndex = uiState.activeFanweiRequirementIndex)",
    "\n\n      function applyFanweiConfigSelectionToFields",
  );
  const platformRenderer = sourceBetween(
    "function fanweiConfigPlatformOptionsHtml(selected)",
    "\n\n      function renderFanweiConfigPicker",
  );
  const controlRenderer = sourceBetween(
    "function fanweiConfigControlHtml(item)",
    "\n\n      function fanweiConfigOptionHtml",
  );

  assert.equal(clientSelection.values.lockMode, "client");
  assert.equal(clientSelection.values.loginMode, "auto");
  assert.equal(clientSelection.values.loginMethod, "post_exam_public_security");
  assert.equal(clientSelection.values.loginTimes, 10);
  assert.ok(clientSelection.selectedIds.includes("client_required"));
  assert.ok(clientSelection.selectedIds.includes("exclusive_network"));
  assert.ok(clientSelection.selectedIds.includes("watermark"));
  assert.ok(clientSelection.selectedIds.includes("copy_item_unable"));
  assert.equal(clientSelection.selectedIds.includes("ai_gaze"), false);
  assert.equal(clientSelection.selectedIds.includes("desktop_monitor"), false);
  assert.equal(clientSelection.selectedIds.includes("show_point"), false);
  assert.equal(clientSelection.selectedIds.includes("public_score"), false);
  assert.equal(clientSelection.selectedIds.includes("app_required"), false);
  assert.equal(webSelection.values.lockMode, "web");
  assert.equal(webSelection.values.loginMode, "manual");
  assert.equal(webSelection.values.webLeaveTimes, 3);
  assert.equal(webSelection.selectedIds.includes("client_required"), false);
  assert.ok(recordingDisabledSelection.selectedIds.includes("monitor"));
  assert.equal(recordingDisabledSelection.selectedIds.includes("save_video"), false);
  const explicitOptionalSelection = defaultSelection({
    "视线追踪": "需要",
    "桌面监控": "是",
    "显示分值": "开启",
    "查看成绩": "是",
    "答题水印": "否",
    "禁止复制": "关闭",
  });
  assert.ok(explicitOptionalSelection.selectedIds.includes("ai_gaze"));
  assert.ok(explicitOptionalSelection.selectedIds.includes("desktop_monitor"));
  assert.ok(explicitOptionalSelection.selectedIds.includes("show_point"));
  assert.ok(explicitOptionalSelection.selectedIds.includes("public_score"));
  assert.equal(explicitOptionalSelection.selectedIds.includes("watermark"), false);
  assert.equal(explicitOptionalSelection.selectedIds.includes("copy_item_unable"), false);
  assert.ok(openPicker.includes("collectFanweiRequirementFields(requirementIndex)"));
  assert.ok(openPicker.includes("defaultFanweiConfigSelection(requirement.fields)"));
  assert.ok(platformRenderer.includes('["client_required", "app_required"]'));
  assert.ok(platformRenderer.includes("fanwei-config-platform-row"));
  assert.ok(controlRenderer.includes('class="fanwei-config-lock-leave-controls"'));
  assert.ok(html.includes(".fanwei-config-lock-leave-controls {\n        flex: 0 0 100%;"));
  assert.match(catalogSource, /id: "client_required"[^\n]+mutexGroup: "client_platform"/);
  assert.match(catalogSource, /id: "app_required"[^\n]+mutexGroup: "client_platform"/);
  assert.match(catalogSource, /id: "save_video"[^\n]+inlineParent: "monitor"/);
  const dependencySelector = sourceBetween(
    "function fanweiConfigSelectWithDependencies(item, selected)",
    "\n\n      function fanweiConfigRemoveWithDependents",
  );
  assert.ok(dependencySelector.includes("if (selected.has(item.id)) return;"));
  assert.ok(dependencySelector.includes("fanweiConfigRemoveWithDependents(candidate.id, selected)"));
  assert.ok(html.includes("需报备后人工开启"));
  const pickerRenderer = sourceBetween(
    "function renderFanweiConfigPicker()",
    "\n\n      function openFanweiConfigPicker",
  );
  const pickerSummaryRenderer = sourceBetween(
    "function renderFanweiConfigPickerSummary()",
    "\n\n      function renderFanweiConfigPicker()",
  );
  const displayValue = sourceBetween(
    "function fanweiConfigDisplayValue(item, selection = fanweiConfigPickerDraft)",
    "\n\n      function fanweiConfigSegment",
  );
  assert.ok(pickerRenderer.includes("if (item.inlineParent) return \"\""));
  assert.ok(pickerRenderer.includes("renderFanweiConfigPickerSummary()"));
  assert.ok(pickerSummaryRenderer.includes("selected.has(item.id) && !item.inlineParent"));
  assert.ok(displayValue.includes('item.id === "monitor" && selected.has("save_video")'));
  assert.ok(displayValue.includes('return "是 · 开启录制"'));
  const liveInputListener = sourceBetween(
    'fanweiConfigPickerOptions.addEventListener("input", (event) => {',
    'fanweiConfigPickerOptions.addEventListener("change", (event) => {',
  );
  assert.ok(liveInputListener.includes("updateFanweiConfigInputValue(input)"));
  assert.ok(liveInputListener.includes("renderFanweiConfigPickerSummary()"));
});

test("desktop-only client options stay nested and hidden until desktop is selected", () => {
  const visibility = sourceBetween(
    "function fanweiConfigItemVisible(item, selected)",
    "\n\n      function fanweiConfigSelectWithDependencies",
  );
  const catalogSource = sourceBetween("const fanweiConfigCatalog = {", "const fanweiConfigItems =");

  ["exclusive_network", "check_bluetooth", "smart_input_disabled"].forEach((id) => {
    assert.match(
      catalogSource,
      new RegExp(`id: "${id}"[^\\n]+parent: "client_required"[^\\n]+hideUntilParent: true`),
    );
  });
  assert.ok(visibility.includes("!selected.has(item.parent)"));
});

test("fanwei requirement copies and submit payload keep independent configuration selections", () => {
  const duplicateFunction = sourceBetween(
    "function duplicateFanweiRequirement()",
    "function renderFanweiModel(model = {})",
  );
  assert.ok(duplicateFunction.includes("cloneFanweiConfigSelection(sourceRequirement.configSelection)"));
  assert.ok(html.includes("function collectAllFanweiRequirementConfigSelections()"));
  assert.ok(html.includes("requirementConfigSelectionsList"));
  assert.ok(html.includes("collectAllFanweiRequirementConfigSelections()"));
});

test("fanwei requirement copies keep independent fields and switch the active layer", () => {
  assert.ok(html.includes("fanweiRequirements: []"));
  assert.ok(html.includes("activeFanweiRequirementIndex: 0"));
  assert.ok(html.includes("fanweiRequirementSwitching: false"));
  assert.ok(html.includes('fanweiDuplicateRequirementBtn.addEventListener("click", duplicateFanweiRequirement)'));
  assert.ok(html.includes('class="account-editor-modal account-delete-modal" id="fanweiRequirementDeleteConfirmModal"'));
  assert.match(html, /@keyframes fanwei-requirement-promote[\s\S]*@keyframes fanwei-requirement-send-back/);
  assert.match(html, /\.fanwei-requirement-layer\.is-behind > \.fanwei-requirement-layer-head,[\s\S]*\.fanwei-requirement-layer\.is-behind > \.fanwei-table-wrap\s*\{[^}]*opacity:\s*0\.58[^}]*filter:\s*blur\(2\.4px\)/s);
  assert.match(html, /\.fanwei-requirement-file-tab\s*\{[^}]*width:\s*max-content[^}]*background:\s*color-mix/s);
  assert.match(html, /\.fanwei-requirement-delete\s*\{[^}]*min-height:\s*29px[^}]*height:\s*29px[^}]*justify-content:\s*center/s);
  assert.match(html, /\.fanwei-requirement-copy\s*\{[^}]*min-height:\s*29px[^}]*height:\s*29px[^}]*margin-left:\s*auto/s);
  assert.match(html, /\.fanwei-requirement-delete,[\s\S]*\.fanwei-requirement-copy\s*\{[^}]*font-size:\s*13px[^}]*font-weight:\s*800[^}]*line-height:\s*1/s);

  const duplicateFunction = sourceBetween(
    "function duplicateFanweiRequirement()",
    "function renderFanweiModel(model = {})",
  );
  assert.ok(duplicateFunction.includes("collectFanweiRequirementFields(uiState.activeFanweiRequirementIndex)"));
  assert.ok(duplicateFunction.includes("fields: { ...sourceFields }"));
  assert.ok(duplicateFunction.includes("uiState.activeFanweiRequirementIndex = uiState.fanweiRequirements.length - 1"));
  assert.equal(duplicateFunction.includes("当前编辑"), false);

  const activateFunction = sourceBetween(
    "function activateFanweiRequirement(requirementIndex)",
    "function duplicateFanweiRequirement()",
  );
  assert.ok(activateFunction.includes("collectFanweiRequirementFields(uiState.activeFanweiRequirementIndex)"));
  assert.ok(activateFunction.includes('currentLayer?.classList.add("is-leaving")'));
  assert.ok(activateFunction.includes('nextLayer?.classList.add("is-promoting")'));
  assert.ok(activateFunction.includes("window.setTimeout(() =>"));
  assert.match(activateFunction, /window\.setTimeout\(\(\) => \{[\s\S]*uiState\.activeFanweiRequirementIndex = requirementIndex[\s\S]*renderFanweiRequirementStack\(\)/);

  const renderStackFunction = sourceBetween(
    "function renderFanweiRequirementStack()",
    "function activateFanweiRequirement",
  );
  assert.ok(renderStackFunction.includes('data-fanwei-requirement-tab="${index}"'));
  assert.ok(renderStackFunction.includes("需求单 ${index + 1}"));
  assert.ok(renderStackFunction.includes("const layerStep = 44"));
  assert.ok(renderStackFunction.includes("Math.min(Math.max(requirements.length - 1, 0), 3) * layerStep"));
  assert.ok(renderStackFunction.includes('class="fanwei-requirement-file-tab"'));
  assert.ok(renderStackFunction.includes('class="fanwei-requirement-tab-actions"'));
  assert.ok(renderStackFunction.includes('class="btn danger fanwei-requirement-delete"'));
  assert.ok(renderStackFunction.includes('data-fanwei-requirement-delete="${index}"'));
  assert.ok(renderStackFunction.includes('aria-label="删除需求单 ${index + 1}"'));
  assert.ok(renderStackFunction.includes("const layerOffset = active ? frontOffset : rank * layerStep"));
  assert.ok(renderStackFunction.includes('fanweiRequirementTabs.innerHTML = ""'));
  assert.equal(renderStackFunction.includes('class="fanwei-requirement-layer-title"'), false);
  assert.equal(renderStackFunction.includes('class="fanwei-requirement-layer-summary"'), false);
  assert.equal(renderStackFunction.includes('class="fanwei-requirement-layer-state"'), false);
  assert.equal(renderStackFunction.includes("当前编辑"), false);
  assert.ok(renderStackFunction.includes('fanweiRequirementCount.textContent = "";'));
  assert.ok(renderStackFunction.includes("fanweiRequirementCount.hidden = true"));
  assert.ok(renderStackFunction.includes('fanweiRequirementCount.textContent = `共 ${requirements.length} 份`'));
  assert.ok(renderStackFunction.includes("fanweiRequirementCount.hidden = false"));
  assert.ok(renderStackFunction.includes(".fanwei-requirement-tab-actions`)?.append(fanweiDuplicateRequirementBtn)"));
  assert.ok(renderStackFunction.includes("fanweiDuplicateRequirementBtn.hidden = false"));
  assert.ok(renderStackFunction.includes('requirements.length <= 1 ? "disabled" : ""'));
  assert.match(html, /\.fanwei-requirement-layer\.is-behind::after\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px/s);

  const deleteFunction = sourceBetween(
    "function deleteFanweiRequirement(requirementIndex)",
    "function confirmFanweiRequirementDelete()",
  );
  assert.ok(deleteFunction.includes("uiState.fanweiRequirements.splice(requirementIndex, 1)"));
  assert.ok(deleteFunction.includes("requirementIndex < activeIndexBeforeDelete"));
  assert.ok(deleteFunction.includes("renderFanweiRequirementStack()"));
  assert.ok(html.includes('openFanweiRequirementDeleteConfirm(Number(deleteButton.dataset.fanweiRequirementDelete), deleteButton)'));
  assert.ok(html.includes('if (event.target.closest("[data-fanwei-requirement-duplicate]")) return'));
});

test("fanwei fallback reader ignores conditionally hidden form rows", () => {
  const readerFunction = sourceBetween(
    "function buildFanweiReaderScript({ endpoint, token, serialNo })",
    "async function pollFanweiBridgeResult",
  );

  assert.match(readerFunction, /getClientRects\(\)\.length/);
  assert.match(readerFunction, /row\.cells\.length && isVisible\(row\.tr\)/);
  assert.match(readerFunction, /\.wf-req-sign-list-content/);
  assert.match(readerFunction, /\.left-department-span/);
  assert.match(readerFunction, /\.logitem-Recipient/);
  assert.match(readerFunction, /flowOpinionRows/);
});

test("dark theme covers the complete Fanwei workbench", () => {
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-field-card\s*\{[^}]*border-color:\s*var\(--line\)[^}]*background:\s*var\(--panel-soft\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-source-pill\s*\{[^}]*border:\s*1px solid var\(--line\)[^}]*background:\s*var\(--panel\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-requirement-sheet\s*\{[^}]*border-color:\s*var\(--line\)[^}]*background:\s*var\(--panel\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-requirement-sheet th[^\{]*\{[^}]*background:\s*var\(--panel-soft\)[^}]*color:\s*var\(--text\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-requirement-sheet td\s*\{[^}]*background:\s*var\(--panel\)[^}]*color:\s*var\(--text-normal\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-requirement-sheet td:nth-child\(3\)\s*\{[^}]*background:\s*var\(--input\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-select,[\s\S]*\.fanwei-editable\s*\{[^}]*background:\s*var\(--input\)[^}]*color:\s*var\(--text-normal\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-requirement-sheet \.fanwei-highlight\s*\{[^}]*color:\s*var\(--amber\)/s);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.fanwei-requirement-sheet \.fanwei-warn-item\s*\{[^}]*color:\s*var\(--red\)/s);
});

test("dark theme keeps the selected session date visible", () => {
  const darkPanelRuleIndex = html.indexOf(':root[data-theme="dark"] :where(');
  const selectedDayRuleIndex = html.indexOf(':root[data-theme="dark"] .session-time-day.is-selected');
  assert.ok(selectedDayRuleIndex > darkPanelRuleIndex);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.session-time-day\.is-selected\s*\{[^}]*background:\s*var\(--blue\);[^}]*color:\s*#ffffff;[^}]*box-shadow:/s);
});

test("fanwei requirement sheet edits sync into generated import payload", () => {
  assert.ok(html.includes("function syncFanweiRequirementField"));
  assert.ok(html.includes("fanweiRequirementTable.addEventListener(\"input\""));
  assert.ok(html.includes("fanweiRequirementTable.addEventListener(\"change\""));
  assert.ok(html.includes("fanweiRequirementTable.addEventListener(\"focusout\""));
  assert.ok(html.includes("collectFanweiEditedRequirementFields()"));
  assert.ok(html.includes('const requirementTimeRangeFields = new Set(["考试日期时间", "试考日期时间"])'));
  assert.ok(html.includes("function renderTimeRangeEditor"));
  assert.ok(html.includes("function normalizeFanweiTimeRangeText"));
  assert.ok(html.includes("function validateTimeRangeEditor"));
  assert.ok(html.includes("结束时间不能早于开始时间"));
  assert.ok(html.includes('class="account-editor-modal session-time-picker" id="sessionTimePicker"'));
  assert.ok(html.includes("sessionTimePicker.showModal()"));
  assert.ok(html.includes("event.target === sessionTimePicker"));
  assert.ok(html.includes("data-session-picker-close"));
  assert.ok(html.includes("sessionTimePicker.addEventListener(\"cancel\""));
  assert.ok(html.includes('const anchor = input.closest(".session-time-control") || input'));
  assert.ok(html.includes("const anchorRect = anchor.getBoundingClientRect()"));
  assert.ok(html.includes("const anchorWidth = Math.round(anchorRect.width"));
  assert.ok(html.includes("Math.max(320, anchorWidth + 40), 400"));
  assert.ok(html.includes("const topBelow = anchorRect.bottom + gap"));
  assert.ok(html.includes('sessionTimePicker.style.width = `${pickerWidth}px`'));
  assert.ok(html.includes('sessionTimePicker.style.left = `${left}px`'));
  assert.match(html, /\.session-time-picker\.account-editor-modal\s*\{[\s\S]*inset:\s*auto;[\s\S]*margin:\s*0;/s);
  assert.match(html, /\.session-time-current-head\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*padding:\s*0 8px;/s);
  assert.match(html, /\.session-time-picker-columns\s*\{[^}]*height:\s*210px;/s);
  assert.match(html, /\.session-time-picker \.session-time-now,[\s\S]*\.session-time-picker \.session-time-picker-actions \.btn\s*\{[^}]*font-size:\s*15px;/s);
  assert.match(html, /\.session-time-picker-message\.session-time-picker-error\s*\{[^}]*color:\s*var\(--red\);[^}]*font-weight:\s*800;/s);
  assert.ok(html.includes('class="session-time-picker-head session-time-current-head"><div class="session-time-current-text"'));
  assert.ok(html.includes('data-session-picker-message'));
  assert.ok(html.includes("function setSessionTimePickerError"));
  assert.ok(html.includes('normalizeExternalTimeRangeInput(input, { surface: "picker" })'));
  assert.ok(html.includes('validateTimeRangeEditor(editor, { report: true, surface: options.surface || "page" })'));
  assert.ok(html.includes('if (surface === "picker")'));
  assert.ok(html.includes("setSessionTimePickerError(message);"));
  assert.ok(html.includes('data-fanwei-time-range="true"'));
  assert.ok(html.includes("data-fanwei-time-picker-part"));
  assert.ok(html.includes(".field-input.is-invalid"));
  assert.ok(html.includes("document.body.append(sessionTimePicker)"));
  assert.ok(html.includes('openSessionTimePicker(part, input, "fanweiRequirement")'));
  assert.equal(html.includes(">◧</button>"), false);
  assert.ok(html.includes('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>'));
  assert.ok(html.includes("if (!validateVisibleTimeRangeEditors(fanweiRequirementTable, { report: true })) return;"));

  const createImportFunction = sourceBetween(
    "async function createFanweiRequirementImport()",
    "async function loadSettings()",
  );
  assert.ok(createImportFunction.includes("uiState.fanweiRead"));
  assert.ok(createImportFunction.includes("fanwei: uiState.fanweiRead.raw"));
  assert.ok(createImportFunction.includes("const requirementFieldsList = collectAllFanweiRequirementFields()"));
  assert.ok(createImportFunction.includes("requirementFields: requirementFieldsList[0]"));
  assert.ok(createImportFunction.includes("requirementFieldsList"));
  assert.ok(createImportFunction.includes("await enterFanweiAutoConfig(data, serialNo)"));
});

test("fanwei read preview stays transient until user generates the requirement", () => {
  assert.ok(html.includes("fanweiRead: null"));
  const resetFunction = sourceBetween(
    "function resetFanweiReadState()",
    "async function copyFanweiReaderScript()",
  );
  assert.ok(resetFunction.includes("uiState.fanweiRead = null"));
  assert.ok(resetFunction.includes("fanweiImportBtn.disabled = true"));
  assert.ok(resetFunction.includes("等待读取"));
  assert.ok(resetFunction.includes('fanweiRequirementCount.textContent = "";'));
  assert.ok(resetFunction.includes("fanweiRequirementCount.hidden = true"));
  assert.ok(resetFunction.includes("fanweiRequirementEmpty.hidden = false"));
  assert.ok(resetFunction.includes("fanweiRequirementTableWrap.hidden = true"));

  const copyFunction = sourceBetween(
    "async function copyFanweiReaderScript()",
    "async function loadFanweiAutoReadStatus()",
  );
  assert.ok(copyFunction.includes("resetFanweiReadState()"));
  assert.ok(copyFunction.includes("fanweiImportBtn.disabled = false"));
  assert.equal(copyFunction.includes("acceptFanweiImport"), false);

  const acceptFunction = sourceBetween(
    "async function acceptFanweiImport(data, serialNo)",
    "async function enterFanweiAutoConfig(data, serialNo)",
  );
  assert.ok(acceptFunction.includes("renderFanweiModel"));
  assert.ok(acceptFunction.includes("installAutoConfigRequirements("));
  assert.ok(acceptFunction.includes("data.examRequirements || []"));
  assert.ok(acceptFunction.includes("appendedStartIndex"));
  assert.equal(acceptFunction.includes('router.navigate("/auto-config")'), false);
  assert.ok(acceptFunction.includes("份需求单"));

  const createImportFunction = sourceBetween(
    "async function enterFanweiAutoConfig(data, serialNo)",
    "async function loadFanweiAutoReadStatus()",
  );
  assert.ok(createImportFunction.includes('router.navigate("/auto-config")'));

  const inputListener = sourceBetween(
    'fanweiCopyScriptBtn.addEventListener("click"',
    'fanweiRequirementTable.addEventListener("input"',
  );
  assert.ok(inputListener.includes('fanweiSerialInput.addEventListener("input"'));
  assert.ok(inputListener.includes("resetFanweiReadState()"));
});

test("fanwei preview shows template defaults and preserves rich default HTML", () => {
  assert.equal(html.includes('"使用模板默认内容"'), false);
  assert.ok(html.includes('new Set(["考前等待提示", "考试承诺书内容"])'));
  assert.ok(html.includes('fanweiOriginalDefaultValues.set(fanweiRequirementOriginalKey(requirementIndex, item), { rawValue, displayValue })'));
  assert.match(html, /\.fanwei-editable\.is-rich-default\s*\{[^}]*height:\s*28px[^}]*max-height:\s*28px[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/s);
  assert.match(html, /\.fanwei-editable\.is-rich-default:hover,[\s\S]*\.fanwei-editable\.is-rich-default\.is-expanded\s*\{[^}]*position:\s*absolute[^}]*max-height:\s*min\(60vh, 480px\)[^}]*white-space:\s*normal/s);
  assert.ok(html.includes('class="fanwei-rich-rendered"'));
  assert.ok(html.includes('class="fanwei-rich-rendered" contenteditable="true"'));
  assert.match(html, /function sanitizeFanweiRichHtml\(value\)[\s\S]*allowedTags[\s\S]*template\.innerHTML/s);
  assert.match(html, /function normalizeFanweiRequirementFieldValue\(field, value\)[\s\S]*fanweiReadableContent\(text\) \? text : ""/s);
  assert.match(html, /element\.dataset\.richDirty === "true"[\s\S]*sanitizeFanweiRichHtml\(editor\?\.innerHTML \|\| ""\)[\s\S]*normalizeFanweiRequirementFieldValue\(field, richValue\)/s);
  assert.match(html, /target\.dataset\.richDirty = "true"[\s\S]*syncFanweiRequirementField[\s\S]*summary\.textContent = fanweiReadableContent\(nextValue\)/s);
  assert.match(html, /fanweiRequirementTable\.addEventListener\("click"[\s\S]*target\.classList\.toggle\("is-expanded"\)/s);
  assert.ok(html.includes('["考前等待提示", "欢迎语", "考试承诺书内容"].includes(item)'));
});

test("fanwei requirement table keeps its established column widths", () => {
  assert.match(html, /\.fanwei-requirement-sheet\s*\{[^}]*width:\s*100%[^}]*min-width:\s*760px[^}]*table-layout:\s*fixed/s);
  assert.match(html, /\.fanwei-requirement-sheet th:nth-child\(1\),[\s\S]*\.fanwei-requirement-sheet td:nth-child\(1\)\s*\{[^}]*width:\s*64px/s);
  assert.match(html, /\.fanwei-requirement-sheet th:nth-child\(2\),[\s\S]*\.fanwei-requirement-sheet td:nth-child\(2\)\s*\{[^}]*width:\s*210px/s);
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

test("Fanwei read page can save a project card separately from auto configuration", () => {
  assert.ok(html.includes('id="fanweiProjectCardBtn" type="button" disabled>生成项目卡片</button>'));
  assert.ok(html.includes("async function createFanweiProjectCard()"));
  assert.ok(html.includes('`${runtime.apiBase}/api/fanwei/project-card`'));
  assert.ok(html.includes('router.navigate(`/projects/${encodeURIComponent(data.taskId)}`)'));
});

test("project list includes pending Fanwei cards and exposes their source identity", () => {
  assert.ok(html.includes('<option value="ready_for_config">待配置</option>'));
  assert.ok(html.includes("task?.projectCard?.createdAt || task?.config?.projectCard?.createdAt"));
  assert.ok(html.includes("泛微流水号：${safeText(card.sourceKey)}"));
  assert.ok(html.includes('projectDisplayStatus(left) === "ready_for_config"'));
});

test("project detail renders sourced operation workflow and keeps local archive distinct", () => {
  for (const id of [
    "projectSourceStrip",
    "projectWorkflowSteps",
    "projectPersonnelTaskDraft",
    "projectContentTaskDraft",
    "projectOperationArchiveDraft",
    "projectWorkflowGates",
  ]) assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.includes("泛微 + 实际执行"));
  const archivePanel = html.slice(
    html.indexOf('data-operation-detail="archive"'),
    html.indexOf('id="operationDetailActions"'),
  );
  assert.equal(archivePanel.includes("运控归档信息"), false);
  assert.equal(archivePanel.includes("字段顺序与运营控制台归档弹窗一致"), false);
  assert.equal(archivePanel.includes('class="workflow-source-badge actual_result"'), false);
  assert.ok(archivePanel.indexOf('id="projectOperationArchiveDraft"') < archivePanel.indexOf('id="operationArchiveEditBtn"'));
  assert.ok(archivePanel.indexOf('id="operationArchiveEditBtn"') < archivePanel.indexOf('id="operationArchiveSaveBtn"'));
  assert.ok(archivePanel.indexOf('id="operationArchiveSaveBtn"') < archivePanel.indexOf('id="operationArchiveCancelEditBtn"'));
  assert.ok(archivePanel.indexOf('id="operationArchiveCancelEditBtn"') < archivePanel.indexOf('id="operationArchiveRefreshEvidenceBtn"'));
  assert.ok(archivePanel.indexOf('id="operationArchiveEditBtn"') < archivePanel.indexOf('id="operationArchiveRefreshEvidenceBtn"'));
  assert.ok(archivePanel.includes('id="operationArchiveSaveBtn"'));
  assert.ok(archivePanel.includes('id="operationArchiveCancelEditBtn"'));
  assert.ok(archivePanel.includes('id="operationArchiveRefreshEvidenceBtn"'));
  assert.ok(archivePanel.includes("更新易考数据"));
  assert.equal(archivePanel.includes("更新参考人数和截图"), false);
  assert.equal(archivePanel.includes("其他归档信息不变"), false);
  assert.equal(archivePanel.includes("执行门槛"), false);
  assert.equal(archivePanel.includes("字段缺失会停在待补充"), false);
  assert.ok(archivePanel.includes('id="projectWorkflowGates" hidden'));
  assert.equal(archivePanel.includes('id="operationArchiveAttachments"'), false);
  assert.equal(html.includes("operationArchiveAttachmentPayload"), false);
  assert.ok(html.includes('class="operation-archive-field-grid"'));
  assert.ok(html.includes('class="operation-archive-screenshot"'));
  assert.ok(html.includes("function renderOperationArchiveScreenshot"));
  assert.ok(html.includes("易考正式考试截图"));
  const renderArchiveScreenshot = compileInlineFunction(
    "      function renderOperationArchiveScreenshot(screenshot = {}) {",
    "\n      function renderOperationArchiveDraft",
    { safeText: (value) => String(value ?? "") },
  );
  assert.equal(renderArchiveScreenshot({}), "");
  assert.equal(renderArchiveScreenshot({ status: "capturing" }), "");
  assert.equal(renderArchiveScreenshot({ status: "failed" }), "");
  assert.equal(renderArchiveScreenshot({ status: "success", files: [] }), "");
  assert.match(renderArchiveScreenshot({
    status: "success",
    files: [{ url: "/screenshots/formal.png", sessionName: "正式考试" }],
  }), /易考正式考试截图[\s\S]*formal\.png/);
  assert.ok(html.includes("${warningRows}${renderOperationArchiveScreenshot(screenshot)}"));
  assert.ok(html.includes('state.screenshot?.status === "success"'));
  assert.ok(html.includes('["基础归档信息", entries.filter(([key]) => operationArchiveBaseFieldKeys.has(key))]'));
  assert.ok(html.includes('["执行结果", entries.filter(([key]) => !operationArchiveBaseFieldKeys.has(key))]'));
  assert.ok(html.includes('data-operation-archive-field="${safeText(key)}"${hidden ? " hidden" : ""}'));
  assert.ok(html.includes('if (assessment && scope) scope.hidden = assessment.value !== "是";'));
  assert.ok(html.includes('operationArchiveInspectBtn.hidden = false;'));
  assert.ok(html.includes('completed ? "重新归档" : "填写归档"'));
  assert.ok(html.includes("async function refreshOperationArchiveEvidence()"));
  assert.ok(html.includes("/operation-archive/evidence/refresh"));
  assert.ok(html.includes('operationArchiveRefreshEvidenceBtn.addEventListener("click"'));
  assert.ok(html.includes("请先确认已在运控端人工处理为可归档状态"));
  const workflowMeta = sourceBetween(
    "      const projectWorkflowStepMeta = [",
    "\n      const projectWorkflowStatusLabels",
  );
  assert.ok(workflowMeta.indexOf('["content", "内容任务"') < workflowMeta.indexOf('["personnel", "人员任务"'));
  const contentPanel = html.slice(
    html.indexOf('data-operation-detail="content"'),
    html.indexOf('data-operation-detail="archive"'),
  );
  assert.equal(contentPanel.includes("内容任务信息"), false);
  assert.equal(contentPanel.includes("考试配置只读取"), false);
  assert.equal(contentPanel.includes("等待发送。"), false);
  assert.ok(contentPanel.includes('id="contentRequirementEmailState" style="margin-top:8px;" hidden'));
  assert.ok(contentPanel.includes('<button class="btn primary" id="operationContentSyncBtn" type="button">发送内容任务单</button>'));
  assert.equal(contentPanel.includes("发送记录"), false);
  assert.equal(contentPanel.includes("contentRequirementEmailHistory"), false);
  assert.equal(html.includes("已按内容人员匹配"), false);
  assert.ok(contentPanel.includes('id="operationContentSyncState" style="margin-top:8px;" hidden'));
  assert.ok(html.includes('function projectContentActualCourseState(task = {})'));
  assert.ok(html.includes('function renderProjectContentExamList(requirements = [], sessions = [], remarks = {}, defaultRemark = "", actualCourseState = {})'));
  assert.ok(html.includes('task.config?.tenantId || ""'));
  assert.ok(html.includes('projectContentActualCourseState(task)'));
  assert.ok(html.includes('renderOperationContentConfiguration(workflow.operationContentDraft?.configuration)'));
  assert.ok(html.indexOf('renderOperationContentConfiguration(workflow.operationContentDraft?.configuration)') < html.indexOf('renderProjectContentExamList('));
  assert.ok(html.includes('class="content-configuration-summary"'));
  assert.ok(html.includes('<div class="content-configuration-block"><h4 class="content-configuration-title">配置项</h4><section class="content-configuration-summary">'));
  assert.match(html, /\.content-configuration-summary\s*\{[^}]*border:\s*1px solid var\(--line\)[^}]*background:\s*var\(--panel\)/s);
  assert.ok(html.includes('const tenantRemark = tenantId ? `租户 ID：${tenantId}` : ""'));
  assert.ok(html.includes("return value === tenantId && tenantId ? tenantRemark : value"));
  assert.ok(html.includes("projectRequirementTrialTime(requirement, trialSession)"));
  assert.ok(html.includes('subjects: "试考"'));
  assert.ok(html.includes('actualCourseState.trial?.[originalIndex] ? [{ name: "试考", code: "SKTY" }] : []'));
  assert.ok(html.includes("left.startTimestamp - right.startTimestamp"));
  assert.ok(html.includes("${safeText(exam.name)}</span><span class=\"content-exam-value\">${safeText(exam.time)}</span><span class=\"content-exam-value\">${safeText(exam.subjects)}"));
  assert.ok(html.includes("<span>序号</span><span>考试名称</span><span>考试时间</span><span>科目信息</span><span>备注</span>"));
  assert.ok(html.includes('class="content-exam-index">${index + 1}</span>'));
  assert.ok(html.includes('data-content-exam-remark-key="${safeText(exam.key)}"'));
  assert.ok(html.includes('placeholder="填写备注"'));
  assert.ok(html.includes("async function saveContentTaskRemark(input)"));
  assert.ok(html.includes("/content-task-remarks"));
  assert.ok(html.includes('projectContentTaskDraft.addEventListener("change"'));
  const contentSync = sourceBetween(
    "      async function syncOperationContentFromProject() {",
    "\n      async function saveContentTaskRemark(input) {",
  );
  assert.ok(contentSync.includes("/operation-content/sync"));
  assert.ok(contentSync.includes('ensureOperationBatchLocalHelper("operationContentSync")'));
  assert.ok(contentSync.includes("validateOperationContentPreparation(prepared)"));
  assert.ok(contentSync.includes("保存完成后将直接发送任务单"));
  assert.ok(contentSync.includes('title: isResend ? "填写变更内容" : "确认同步运控并发送任务单"'));
  assert.ok(contentSync.includes('label: "变更内容"'));
  assert.ok(contentSync.includes('value: dispatchPreview.suggestedChangeSummary || ""'));
  assert.ok(contentSync.includes('placeholder: "系统已列出本次与上次发送任务的全部差异，可补充说明"'));
  assert.ok(contentSync.includes("required: true"));
  assert.ok(contentSync.includes("previewDraftFingerprint: dispatchPreview.currentFingerprint"));
  assert.ok(contentSync.includes("previewBaselineFingerprint: dispatchPreview.baselineFingerprint"));
  assert.ok(contentSync.includes('timeoutMs: 240000'));
  assert.ok(contentSync.includes("changed.configuration"));
  assert.ok(contentSync.includes("changed.subjects"));
  assert.ok(contentSync.includes('!["sent", "already_sent"].includes(dispatch.status)'));
  assert.ok(contentSync.includes('dispatch.status === "already_sent"'));
  assert.ok(html.includes('localHelper.path !== "/operation-content/sync"'));
  assert.ok(html.includes("operationContentSync: 26"));
  assert.ok(html.includes('confirmText: isContentSync ? "继续同步并发送" : "继续添加日程"'));
  assert.ok(html.includes('id="operationContentSyncBtn" type="button">发送内容任务单</button>'));
  assert.ok(html.includes("function operationContentTaskHasSent(task = {})"));
  assert.ok(html.includes('contentSync.initialSendVerification?.status === "verified"'));
  assert.ok(html.includes('contentSync.dispatchStatus === "sent"'));
  assert.ok(html.includes('Boolean(String(contentSync.lastDispatchedAt || "").trim())'));
  assert.ok(html.includes("operationContentSyncBtn.textContent = operationContentTaskHasSent(task)"));
  assert.ok(html.includes('? "重新发送内容任务单"'));
  assert.equal(html.includes('operationContentSyncBtn.textContent = "同步运控并发送任务单"'), false);
  assert.equal(html.includes('operationContentSyncBtn.textContent = "重新同步并发送任务单"'), false);
  assert.ok(html.includes('operationContentSyncBtn.addEventListener("click"'));
  const contentExamRenderer = sourceBetween(
    '      function renderProjectContentExamList(requirements = [], sessions = [], remarks = {}, defaultRemark = "", actualCourseState = {}) {',
    "\n      const projectDialogTriggers",
  );
  assert.equal(contentExamRenderer.includes("考试 ${index + 1}"), false);
  assert.equal(contentExamRenderer.includes("<span>来源</span>"), false);
  assert.equal(contentExamRenderer.includes("workflow-source-badge easy_exam_requirement"), false);
  assert.equal(html.includes("项目列表中的“归档”仅隐藏本地项目卡，两者互不替代"), false);
  assert.ok(html.includes("/operation-workflow?_=${Date.now()}"));
});

test("content task detail prepends the operation configuration summary", () => {
  const renderOperationContentConfiguration = compileInlineFunction(
    '      function renderOperationContentConfiguration(configuration = {}) {',
    "\n      function renderProjectContentExamList",
    { safeText: (value) => String(value ?? "") },
  );
  const rendered = renderOperationContentConfiguration({
    background: "ATA通用模板",
    loginMode: "准考证号",
    itemTypes: ["客观题"],
    contentSources: ["ATA现有内容"],
    closePaper: "否",
    reviewPaper: "否",
    singleMaxSubjects: "24",
    paperLanguages: ["简体中文"],
    osLanguages: ["简体中文"],
    closureStart: "2026-08-19 10:00",
    closureEnd: "2026-08-19 17:00",
  });

  for (const value of [
    "配置项",
    "ATA通用模板",
    "准考证号",
    "客观题",
    "ATA现有内容",
    "单科最大科次",
    "24",
    "2026-08-19 10:00 ~ 2026-08-19 17:00",
  ]) assert.ok(rendered.includes(value));
});

test("content task remarks retain formal and trial course codes", () => {
  const projectContentActualCourseState = compileInlineFunction(
    '      function projectContentActualCourseState(task = {}) {',
    "\n      function contentTaskRemarkWithCourseCodes",
  );
  const contentTaskRemarkWithCourseCodes = compileInlineFunction(
    '      function contentTaskRemarkWithCourseCodes(remark = "", courses = []) {',
    "\n      function renderProjectContentExamList",
  );
  const renderProjectContentExamList = compileInlineFunction(
    '      function renderProjectContentExamList(requirements = [], sessions = [], remarks = {}, defaultRemark = "", actualCourseState = {}) {',
    "\n      const projectDialogTriggers",
    {
      contentTaskRemarkWithCourseCodes,
      projectRequirementFormalTime: (requirement) => requirement.fields?.["考试日期时间"] || "待补充",
      projectRequirementSubjects: (requirement) => (requirement.config?.courses || []).map((course) => course.name).join("、") || "待补充",
      projectRequirementTrialTime: (requirement) => requirement.fields?.["试考日期时间"] || "",
      projectDateTimeStartTimestamp: (value) => Date.parse(value) || Number.MAX_SAFE_INTEGER,
      safeText: (value) => String(value ?? ""),
    },
  );

  assert.equal(
    contentTaskRemarkWithCourseCodes("租户 ID：tenant-1", [
      { name: "语文", code: "20260731-01-01" },
      { name: "数学", course_code: "20260731-01-02" },
    ]),
    "租户 ID：tenant-1；科目编号：语文（20260731-01-01）、数学（20260731-01-02）",
  );
  assert.equal(
    contentTaskRemarkWithCourseCodes("", [{ name: "试考", code: "SKTY" }]),
    "科目编号：试考（SKTY）",
  );

  assert.deepEqual(
    projectContentActualCourseState({
      config: { examRequirements: [{}, {}] },
      steps: [
        {
          stepKey: "course_create",
          status: "running",
          requirementProgress: {
            0: { status: "success", result: { courses: [{ name: "语文", code: "C001" }] } },
            1: { status: "pending", result: { courses: [{ name: "数学", code: "PREVIEW-ONLY" }] } },
          },
        },
        {
          stepKey: "trial_paper_bind",
          status: "running",
          requirementProgress: {
            0: { status: "success", result: {} },
            1: { status: "pending", result: {} },
          },
        },
      ],
    }),
    { formal: [[{ name: "语文", code: "C001" }], []], trial: [true, false] },
  );

  const rendered = renderProjectContentExamList([
    {
      fields: { "考试名称": "第一场", "考试日期时间": "2026-08-01 09:00", "试考日期时间": "2026-07-31 16:00" },
      config: { courses: [{ name: "语文", code: "C001" }, { name: "数学", code: "C002" }] },
    },
  ], [], {}, "tenant-1", {
    formal: [[{ name: "语文", code: "C001" }, { name: "数学", code: "C002" }]],
    trial: [true],
  });
  assert.ok(rendered.includes("租户 ID：tenant-1；科目编号：语文（C001）、数学（C002）"));
  assert.ok(rendered.includes("租户 ID：tenant-1；科目编号：试考（SKTY）"));

  const pendingRendered = renderProjectContentExamList([
    {
      fields: { "考试名称": "未创建考试", "考试日期时间": "2026-08-01 09:00", "试考日期时间": "2026-07-31 16:00" },
      config: { courses: [{ name: "语文", code: "PREGENERATED-001" }] },
    },
  ], [], {}, "tenant-1", { formal: [[]], trial: [false] });
  assert.equal(pendingRendered.includes("PREGENERATED-001"), false);
  assert.equal(pendingRendered.includes("SKTY"), false);
});

test("operation workflow and source cards open account-style editable dialogs", () => {
  for (const id of [
    "operationDetailModal",
    "operationDetailTitle",
    "sourceDetailModal",
    "sourceDetailFields",
    "sourceDetailSaveBtn",
  ]) assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.includes('class="account-editor-modal operation-detail-modal"'));
  assert.ok(html.includes('class="account-editor-actions" id="operationDetailActions"'));
  assert.ok(html.includes('data-workflow-step="${safeText(key)}"'));
  assert.ok(html.includes('data-project-source="${safeText(item.key)}"'));
  assert.ok(html.includes('class="project-source-item project-source-item-with-requirements"'));
  assert.ok(html.includes('class="project-source-requirement-list" aria-label="易考需求单列表"'));
  assert.ok(html.includes('data-project-source="examRequirement" data-project-source-index="${index}"'));
  assert.ok(html.includes('aria-label="查看和修改需求单 ${index + 1}"'));
  assert.ok(html.includes("function openOperationDetail(stepKey, trigger = null)"));
  assert.ok(html.includes('operationDetailActions.hidden = stepKey === "content";'));
  const workflowRenderer = sourceBetween(
    "      function renderProjectWorkflow(task = {}, workflow = {}, batchDraft = {}) {",
    "\n      function projectRequirementFormalTime(requirement = {}) {",
  );
  assert.ok(workflowRenderer.includes("workflow.contentEmailDefaults || {}"));
  assert.ok(workflowRenderer.includes("contentRequirementEmailRecipients.value"));
  assert.ok(workflowRenderer.includes("contentRequirementEmailCc.value"));
  assert.equal(workflowRenderer.includes("contentEmailDefaults.matched"), false);
  const sendContentEmail = sourceBetween(
    "      async function sendContentRequirementEmailFromProject() {",
    "\n      async function saveContentTaskRemark(input) {",
  );
  assert.ok(sendContentEmail.includes("JSON.stringify({ recipients, cc })"));
  assert.ok(sendContentEmail.includes("result.result?.cc"));
  assert.ok(html.includes("function openProjectSourceDetail(source, trigger = null)"));
  assert.ok(html.includes('sourceDetailModal.classList.toggle("is-single-column", source === "examRequirement")'));
  assert.match(html, /#sourceDetailModal\.is-single-column \.source-detail-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(html, /#sourceDetailModal\[data-source="fanwei"\] \.source-detail-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/s);
  assert.match(html, /#sourceDetailModal\[data-source="fanwei"\] \.source-detail-grid > \.field[\s\S]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(html, /\.source-detail-field-title\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.ok(html.includes('["申请人", "申请人部门", "申请日期", "运控流水号", "项目名称", "项目编码", "系统类型", "预估科次", "结算依据", "预估收入", "是否需要ATA安排人工监考", "是否需要ATA安排集中监考场地", "是否需要人工阅卷", "阅卷安排", "EPI测试", "性格测试工具", "考核内容是否仅性格测试"]'));
  assert.ok(html.includes('["ATA内容制题参与方式", "内容来源", "是否需要封闭制题", "试题类型", "科目数", "试卷数"]'));
  assert.ok(html.includes('" source-detail-field-paired"'));
  assert.ok(html.includes('" source-detail-field-triple"'));
  assert.ok(html.includes("async function saveProjectSourceDetail()"));
  assert.ok(html.includes("async function deleteProjectExamRequirement()"));
  assert.ok(html.includes('sourceDetailCancelBtn.textContent = source === "examRequirement" ? "删除" : "取消"'));
  assert.ok(html.includes('sourceDetailCancelBtn.classList.toggle("danger", source === "examRequirement")'));
  assert.ok(html.includes('method: "DELETE"'));
  assert.ok(html.includes('body: JSON.stringify({ source: "examRequirement", requirementIndex })'));
  assert.ok(html.includes("删除后不会进入自动配置。"));
  assert.ok(html.includes("renderProjectDetail(result.task)"));
  assert.ok(html.includes("/source-snapshot"));
  assert.ok(html.includes("function sourceFanweiFieldGroup(task = {}, fields = {})"));
  assert.ok(html.includes("function sourceFanweiFieldsForDisplay(task = {}, fields = {})"));
  assert.ok(html.includes("taskViewState.currentOperationBatchDraft?.fields?.batchName?.value"));
  assert.ok(html.includes("generatedOperationBatchNameFromTask(task)"));
  assert.ok(html.includes('class="source-detail-inline-fields"'));
  assert.ok(html.includes('sourceFanweiFieldGroup(task, sourceFanweiFieldsForDisplay(task, raw.fields || {}))'));
  assert.ok(html.includes("const fanweiMultiColumnFieldGroups = ["));
  assert.ok(html.includes('["结算依据", "预估收入"]'));
  assert.ok(html.includes('if (["附件", "项目经理操作"].includes(key)) return true;'));
  assert.ok(html.includes('if (key === "批次名称" && entriesByKey.has("项目编码"))'));
  assert.ok(html.includes('group.includes("项目编码") && entriesByKey.has("批次名称")'));
  assert.ok(html.includes('rows.map((row, index) => ["考试日期", "场次安排说明", "备注"].map'));
  assert.ok(html.includes('const fieldClass = " source-detail-field-triple";'));
  assert.ok(html.includes("function sourceExamSceneRowsForTask(task = {}, rows = [])"));
  assert.ok(html.includes("sourceExamSceneGroup(sourceExamSceneRowsForTask(task, raw.examSceneRows || []))"));
  assert.match(html, /#sourceDetailModal \.field-input\s*\{[^}]*font-family:\s*inherit;[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.4;/s);
  assert.ok(html.includes("function isUnselectedFanweiField(key, value)"));
  assert.ok(html.includes("!isUnselectedFanweiField(key, value)"));
  for (const option of ["项目实施一部", "项目实施二部", "项目实施三部", "项目实施四部", "项目实施五部", "悦考在线运维部"]) {
    assert.ok(html.includes(`"${option}"`), `missing operation project department option: ${option}`);
  }
  assert.ok(html.includes('["contentParticipation", "内容制题参与方式"]'));
  assert.ok(html.includes('["contentService", "内容服务"]'));
});

test("Fanwei scene defaults use formal exam times from EasyExam requirements", () => {
  const sourceExamSceneRowsForTask = compileInlineFunction(
    "      function sourceExamSceneRowsForTask(task = {}, rows = []) {",
    "\n      function openProjectSourceDetail(source, trigger = null) {",
    {
      projectExamRequirements: (task) => task.config?.examRequirements || [],
      projectRequirementFormalTime: (requirement) => requirement.fields?.["考试日期时间"] || "待补充",
      parseFlexibleTimeRange: (value) => {
        const points = [...String(value || "").matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})/g)]
          .map((match) => ({
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3]),
            hour: Number(match[4]),
            minute: Number(match[5]),
          }));
        return points.length >= 2 ? { start: points[0], end: points[1] } : null;
      },
      padTimePart: (value) => String(value).padStart(2, "0"),
    },
  );

  const task = {
    config: {
      examRequirements: [
        { fields: { "考试日期时间": "2026/8/8 09:30-2026/8/8 11:00" } },
        { fields: { "考试日期时间": "2026/8/9 14:00-2026/8/9 16:30" } },
      ],
    },
  };
  assert.deepEqual(sourceExamSceneRowsForTask(task, [
    { "考试日期": "2026-08-01", "场次安排说明": "08:00-09:00", "备注": "保留备注" },
  ]), [
    { "考试日期": "2026-08-08", "场次安排说明": "09:30-11:00", "备注": "保留备注" },
    { "考试日期": "2026-08-09", "场次安排说明": "14:00-16:30" },
  ]);
  const existingRows = [{ "考试日期": "2026-08-01", "场次安排说明": "08:00-09:00", "备注": "原值" }];
  assert.deepEqual(sourceExamSceneRowsForTask({ config: { examRequirements: [{ fields: {} }] } }, existingRows), existingRows);
});

test("Fanwei source display derives batch name from the abbreviated exam name", () => {
  const generatedBatchName = compileInlineFunction(
    "      function generatedOperationBatchNameFromTask(task = {}) {",
    "\n      function operationBatchInfoText(task = {}) {",
  );

  assert.equal(generatedBatchName({
    projectName: "蜀道投资集团有限责任公司招聘笔试",
    config: {
      examName: "蜀道轨道交通集团2026年第一批公开招聘笔试",
      fanweiSource: { raw: { examSceneRows: [{ "考试日期": "2026-08-06" }] } },
    },
  }), "蜀道轨道交通集团招聘笔试_2026年8月");
  assert.equal(generatedBatchName({
    projectName: "四川省交通建设集团有限责任公司2026年社会招聘笔试",
    config: {
      examName: "四川省交通建设集团有限责任公司2026年社会招聘笔试",
      businessRequirement: { formal_exam_time_range: "2026/8/6 19:00:00-2026/8/6 21:00:00" },
    },
  }), "四川省交通建设集团招聘笔试_2026年8月");
});

test("EasyExam source editing includes the established requirement dropdown options", () => {
  const sourceControl = sourceBetween(
    "      function sourceFieldControl(group, key, value, selectOptions = {}) {",
    "\n      const projectExamRequirementFieldOrder",
  );
  assert.ok(sourceControl.includes("const options = selectOptions[key] || [];"));
  assert.ok(sourceControl.includes('<select class="field-input"'));
  assert.ok(sourceControl.includes(">请选择</option>"));
  assert.ok(sourceControl.includes("text && !options.includes(text) ? [text, ...options] : options"));
  assert.ok(sourceControl.includes('data-source-time-range="true"'));
  assert.ok(sourceControl.includes("data-source-time-picker-part"));
  assert.ok(html.includes('sourceDetailFields.addEventListener("focusout"'));
  assert.ok(html.includes('openSessionTimePicker(part, input, "sourceDetail")'));
  assert.ok(html.includes("if (!validateVisibleTimeRangeEditors(sourceDetailFields, { report: true })) return;"));
  assert.ok(html.includes('sourceFieldGroup("配置需求字段", "fields", orderedProjectExamRequirementFields(snapshot.fields || {}), fanweiSelectOptions)'));
  for (const field of ["试卷扣时规则", "考试地址", "视频监控", "视频录制", "鹰眼监控", "考试类型", "人工判分"]) {
    assert.ok(html.includes(`"${field}": [`), `missing dropdown options for ${field}`);
  }
});

test("project configuration opens saved EasyExam requirements from the upper source card", () => {
  const sourceRenderer = sourceBetween(
    "      function renderProjectSources(task = {}, workflow = {}) {",
    "\n      function renderProjectWorkflow(task = {}, workflow = {}, batchDraft = {}) {",
  );
  const changeRenderer = sourceBetween(
    "      function renderProjectRequirementInline(task, detail = null) {",
    "\n      async function loadProjectRequirementForDetail(task)",
  );
  assert.ok(html.includes("function projectExamRequirements(task = {})"));
  assert.ok(sourceRenderer.includes('data-project-source="examRequirement"'));
  assert.ok(sourceRenderer.includes('data-project-source-index="${index}"'));
  assert.ok(sourceRenderer.includes('aria-label="查看和修改需求单 ${index + 1}"'));
  assert.ok(html.includes('sourceDetailTitle.textContent = "易考需求单"'));
  assert.ok(html.includes('sourceFieldGroup("配置需求字段"'));
  assert.equal(changeRenderer.includes("renderProjectExamRequirementSnapshot"), false);
  assert.ok(changeRenderer.includes("projectSourceRequirementChangeHistory"));
  assert.ok(changeRenderer.includes("暂无需求变更记录"));
});

test("project WeChat changes render compact review cards for both session states", () => {
  const renderer = sourceBetween(
    "      function renderProjectRequirementChangeLog(detail = {}, { actions = true } = {}) {",
    "\n      function renderRequirementNextStep(requirement)",
  );
  const action = sourceBetween(
    "      async function handleProjectRequirementChangeAction(button) {",
    "\n      async function handleProjectRequirementSubmitAction(button)",
  );
  const binding = sourceBetween(
    "      async function saveProjectWechatBinding() {",
    "\n      function renderProjectDetail(task)",
  );

  assert.ok(renderer.includes('class="project-requirement-review-card"'));
  assert.ok(renderer.includes("微信群原话"));
  assert.ok(renderer.includes("审核通过并更新需求单"));
  assert.ok(renderer.includes("未建立考试场次 · 审核后更新需求单"));
  assert.ok(renderer.includes("已建立考试场次 · 审核后更新需求单，并标记需同步场次"));
  assert.ok(renderer.includes("需同步已建场次"));
  assert.ok(action.includes("/api/tasks/${encodeURIComponent(taskId)}/requirements/"));
  assert.ok(action.includes("taskViewState.currentProject = result.task || task"));
  assert.equal(binding.includes("!identity.requirementRequestId"), false);
  assert.ok(binding.includes("intervalMinutes < 15"));
  assert.ok(html.includes('id="projectWechatIntervalMinutes" type="number" min="15"'));
});

test("exam views surface pending requirement changes and open the confirmed time-change flow", () => {
  const projectRenderer = sourceBetween(
    "      function renderProjectDetail(task) {",
    "\n      async function loadProjectDetail(projectId) {",
  );
  const projectSessionRenderer = sourceBetween(
    "      function renderProjectSessionRows(task = taskViewState.currentProject) {",
    "\n      async function previewProjectSessionSync() {",
  );
  const taskRenderer = sourceBetween(
    "      function renderTaskDetail(task, options = {}) {",
    "\n      function downloadFileNameFromDisposition",
  );
  const changeOpener = sourceBetween(
    "      async function openSessionChange(taskId, sessionId, trigger = null) {",
    "\n      async function submitSessionChange() {",
  );
  const changeSubmitter = sourceBetween(
    "      async function submitSessionChange() {",
    "\n      function formatSessionTime(session) {",
  );
  const diffRenderer = sourceBetween(
    "      function renderSessionChangeDiff() {",
    "\n      function formatApiErrorDetail(error) {",
  );
  const timeValidator = sourceBetween(
    "      function validateSessionChangeTimeRange({ report = false } = {}) {",
    "\n      function renderSessionChangeDiff() {",
  );
  const initialValue = compileInlineFunction(
    "      function sessionChangeInitialFieldValue(field, suggested = {}, requirementPending = false) {",
    "\n      function sessionChangeChangedValues() {",
  );
  const changedValues = compileInlineFunction(
    "      function sessionChangeChangedValues() {",
    "\n      function sessionChangeCourseInputNames() {",
    {
      taskViewState: {
        sessionChange: {
          current: {
            name: "原场次",
            start: "2026/08/03 09:00",
            end: "2026/08/03 11:00",
            early: 30,
            later: 20,
            message: "原欢迎语",
            notice: "原登录提示",
          },
        },
      },
      sessionChangeFormValues: () => ({
        name: "",
        start: "2026-08-03 09:00",
        end: "2026-08-03 11:00",
        early: null,
        later: null,
        message: "",
        notice: "",
      }),
      tenantTimeToDisplayTime: (value) => String(value || "").replaceAll("-", "/"),
    },
  );

  assert.ok(html.includes("<th>状态</th><th>操作</th>"));
  assert.ok(html.includes('class="session-requirement-notice" id="sessionRequirementChangeNotice" hidden'));
  assert.equal(html.includes("sessionRequirementChangeActionBtn"), false);
  assert.ok(html.includes('class="account-editor-modal session-change-modal" id="sessionChangePanel"'));
  assert.equal(html.includes('id="sessionChangeMeta"'), false);
  assert.ok(html.includes('class="settings-grid" id="sessionChangeEditorFields"'));
  assert.ok(html.includes('class="field session-change-name-field"'));
  assert.ok(html.includes(".session-change-name-field { grid-column: 1 / -1; }"));
  assert.ok(html.includes('class="account-editor-actions"><button class="btn" id="sessionChangeCancelBtn"'));
  assert.ok(html.includes("function taskHasPendingRequirementChange(task = {})"));
  assert.ok(html.includes('<span class="tag amber">需求有变请确认</span>'));
  assert.ok(projectSessionRenderer.includes("sessionRequirementChangeBadge(session)"));
  assert.ok(projectSessionRenderer.includes("data-project-session-change-task-id"));
  assert.ok(projectSessionRenderer.includes(">修改场次</button>"));
  assert.ok(taskRenderer.includes("pendingRequirementSessions"));
  assert.ok(taskRenderer.includes("sessionRequirementChangeNotice.hidden"));
  assert.ok(taskRenderer.includes("sessionRequirementChangeBadge(session)"));
  assert.ok(html.includes(".task-session-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px;"));
  assert.ok(html.includes(".session-requirement-notice {"));
  assert.ok(html.includes("min-height: 72px;"));
  assert.ok(changeOpener.includes("showProjectDialog(sessionChangePanel, trigger)"));
  assert.ok(html.includes("sessionChangePanel.addEventListener(\"cancel\""));
  assert.ok(changeOpener.includes("preview.requirementChange"));
  assert.ok(changeOpener.includes("requirementChange.suggestedChanges"));
  assert.ok(changeOpener.includes("sessionChangeInitialFieldValue(field, suggested, requirementChange.pending)"));
  assert.ok(changeOpener.includes("const hasRequirementChanges = Boolean(requirementChange.pending || courseRequirementChange.pending)"));
  assert.ok(changeOpener.includes("sessionChangeEditorFields.hidden = true"));
  assert.ok(changeOpener.includes("sessionChangeConfirmRow.hidden = !hasRequirementChanges"));
  assert.ok(changeOpener.includes("sessionChangeSubmitBtn.hidden = !hasRequirementChanges"));
  assert.ok(changeOpener.includes("courseRequirementChange.pending && courses.length"));
  assert.equal(changeOpener.includes('setSessionChangeAlert("需求有变请确认"'), false);
  assert.ok(diffRenderer.includes('label: "考试时间"'));
  assert.ok(diffRenderer.includes('field !== "start" && field !== "end"'));
  assert.ok(diffRenderer.includes('class="project-requirement-diff-row"'));
  assert.ok(timeValidator.includes('end < start'));
  assert.equal(timeValidator.includes("sessionChangeCurrentMinuteValue"), false);
  assert.equal(timeValidator.includes("考试时间不能早于当前时间"), false);
  assert.ok(changeSubmitter.includes("requirementChangeId: taskViewState.sessionChange.requirementChangeId"));
  assert.ok(changeSubmitter.includes("renderSessionChangeSuccess(completedParts)"));
  assert.ok(changeSubmitter.includes("renderSessionChangeFailure(completedParts)"));
  assert.ok(changeSubmitter.includes("error?.response?.task"));
  assert.equal(changeSubmitter.includes("formatApiErrorDetail(error)"), false);
  assert.equal(changeSubmitter.includes("throw error"), false);
  assert.ok(html.includes("修改记录已写入下方执行日志。"));
  assert.ok(taskRenderer.includes("(task.steps || []).flatMap((step) => (step.logs || [])"));
  assert.ok(html.includes('projectDetailSessionRows.addEventListener("click"'));
  assert.ok(html.includes(".then(() => openSessionChange(taskId, sessionId))"));
  assert.equal(initialValue("name", { start: "新时间" }, true), "");
  assert.equal(initialValue("name", { name: "新场次" }, true), "新场次");
  assert.equal(initialValue("name", {}, false), "");
  assert.ok(html.includes('id="sessionChangeConfirmRow" style="margin-top:12px;" hidden'));
  assert.ok(diffRenderer.includes('"无需求变更"'));
  assert.deepEqual(changedValues(), {});
});

test("session change record details do not collapse the outer task card", () => {
  const taskStepClickHandler = sourceBetween(
    '      taskStepGrid.addEventListener("click", async (event) => {',
    "\n\n      dropZone.addEventListener",
  );
  const recordGuardIndex = taskStepClickHandler.indexOf(
    'const sessionChangeRecordCard = event.target.closest(".session-change-record-card")',
  );
  const outerCardToggleIndex = taskStepClickHandler.indexOf(
    'const card = event.target.closest(".task-step-card")',
  );

  assert.ok(recordGuardIndex >= 0);
  assert.ok(recordGuardIndex < outerCardToggleIndex);
  assert.match(
    taskStepClickHandler.slice(recordGuardIndex, outerCardToggleIndex),
    /if \(sessionChangeRecordCard\) \{\s*event\.stopPropagation\(\);\s*return;\s*\}/,
  );
});

test("project session sync previews current EasyExam differences and only updates after confirmation", () => {
  const rowRenderer = sourceBetween(
    "      function renderProjectSessionRows(task = taskViewState.currentProject) {",
    "\n      async function previewProjectSessionSync() {",
  );
  const previewHandler = sourceBetween(
    "      async function previewProjectSessionSync() {",
    "\n      async function applyProjectSessionSync(sessionId) {",
  );
  const applyHandler = sourceBetween(
    "      async function applyProjectSessionSync(sessionId) {",
    "\n      function toggleAllProjectSessionSyncDiffs() {",
  );
  const clickHandler = sourceBetween(
    '      projectDetailSessionRows.addEventListener("click", (event) => {',
    "\n      projectWorkflowSteps.addEventListener",
  );
  const historyCard = sourceBetween(
    "      function sessionChangeHistoryCard(record = {}, index = 0) {",
    "\n      function inferredPaperName",
  );

  assert.ok(html.includes('id="projectSessionSyncBtn"'));
  assert.ok(html.includes(">同步易考信息</button>"));
  assert.ok(html.includes('id="projectSessionSyncCount"'));
  assert.match(html, /\.project-session-sync-button\s*\{[^}]*min-height:\s*28px;[^}]*font-size:\s*12px;/s);
  assert.ok(rowRenderer.includes('"有差异"'));
  assert.ok(rowRenderer.includes('"查看差异"'));
  assert.ok(rowRenderer.includes('"查看易考信息"'));
  assert.ok(html.includes("function renderProjectSessionSyncReadback"));
  assert.ok(html.includes("科目信息"));
  assert.ok(html.includes("已绑定试卷"));
  assert.ok(html.includes("配置项 ${Number(summary.configurationCount || 0)}"));
  assert.ok(rowRenderer.includes("data-project-session-change-task-id"));
  assert.ok(rowRenderer.includes(">修改场次</button>"));
  assert.ok(previewHandler.includes("/sessions/sync-preview"));
  assert.ok(previewHandler.includes("method: \"POST\"") === false);
  assert.ok(applyHandler.includes("/sync-from-yikao"));
  assert.ok(applyHandler.includes("JSON.stringify({ confirm: true })"));
  assert.ok(clickHandler.includes('action === "later"'));
  assert.ok(clickHandler.includes('action === "apply"'));
  assert.ok(historyCard.includes('record.action === "sync_from_yikao"'));
  assert.ok(historyCard.includes('"同步完成"'));
});

test("exam detail aggregates EasyExam course changes into the session-change dialog", () => {
  const taskRenderer = sourceBetween(
    "      function renderTaskDetail(task, options = {}) {",
    "\n      function downloadFileNameFromDisposition",
  );
  const sessionOpener = sourceBetween(
    "      async function openSessionChange(taskId, sessionId, trigger = null) {",
    "\n      async function submitSessionChange() {",
  );
  const sessionSubmitter = sourceBetween(
    "      async function submitSessionChange() {",
    "\n      function formatSessionTime(session) {",
  );
  const courseEntries = compileInlineFunction(
    "      function sessionChangeCourseEntries() {",
    "\n      function sessionChangeDisplayTimeValue(value) {",
    {
      sessionChangeCourseNamesValid: () => true,
      sessionChangeCourseSection: { hidden: false },
      taskViewState: { sessionChange: { courses: [{ code: "20260803-01-01", name: "原科目" }] } },
      sessionChangeCourseInputNames: () => ["新科目"],
    },
  );

  assert.ok(html.includes('id="sessionChangeCourseSection"'));
  assert.ok(html.includes('id="sessionChangeCourseFields"'));
  assert.equal(html.includes('id="courseChangePanel"'), false);
  assert.equal(html.includes(">修改科目</button>"), false);
  assert.equal(taskRenderer.includes("data-course-change-task-id"), false);
  assert.ok(sessionOpener.includes("/courses/change-preview?requirementIndex="));
  assert.ok(sessionOpener.includes("courseRequirementChange.pending && courses.length"));
  assert.ok(sessionOpener.includes("sessionChangeCourseSection.hidden = false"));
  assert.match(html, /data-course-change-name="\$\{index\}"[^>]*readonly/);
  assert.ok(sessionSubmitter.includes("/courses/change"));
  assert.ok(sessionSubmitter.includes("names: sessionChangeCourseInputNames()"));
  assert.ok(sessionSubmitter.includes("keepSessionChangePanel: true"));
  assert.deepEqual(courseEntries(), [{
    label: "科目信息",
    before: "原科目",
    after: "新科目",
    beforeCaption: "当前科目",
  }]);
  assert.ok(html.includes("科目信息") && html.includes("修改记录已写入下方执行日志。"));
  assert.ok(taskRenderer.includes("(task.steps || []).flatMap((step) => (step.logs || [])"));
  assert.ok(sessionSubmitter.includes("/sessions/${encodeURIComponent(sessionId)}/change"));
});

test("long confirmation copy starts collapsed in the generated requirement card", () => {
  const collapsedFields = sourceBetween(
    "      const projectRequirementCollapsedSnapshotFields = new Set([",
    "\n      function renderProjectRequirementSnapshotValue",
  );
  for (const field of ["考前等待提示", "欢迎语", "考试承诺书内容"]) {
    assert.ok(collapsedFields.includes(`"${field}"`));
  }
  assert.ok(html.includes("projectRequirementCollapsedSnapshotFields.has(label)"));
  assert.ok(html.includes('data-project-requirement-disclosure role="button" tabindex="0" aria-expanded="false"'));
  assert.match(html, /#projectDetailView \.project-requirement-snapshot \.config-preview-value\s*\{[^}]*max-height:\s*3\.1em/s);
  assert.match(html, /#projectDetailView \.project-requirement-snapshot \.config-preview-disclosure\.is-expanded \.config-preview-value\s*\{[^}]*max-height:\s*none/s);
  assert.ok(html.includes('projectRequirementInline.addEventListener("keydown"'));
  assert.ok(html.includes("togglePreviewDisclosure(disclosure);"));
});

test("EasyExam requirement fields follow the actual configuration flow", () => {
  const block = html.slice(
    html.indexOf("const projectExamRequirementFieldOrder = ["),
    html.indexOf("function orderedProjectExamRequirementFields"),
  );
  const labels = ["考试名称", "考试日期时间", "试考日期时间", "考前等待提示", "欢迎语", "考试承诺书内容", "视频监控", "科目信息"];
  labels.slice(1).forEach((label, index) => {
    assert.ok(block.indexOf(labels[index]) < block.indexOf(label), `${labels[index]} should render before ${label}`);
  });
  const ordering = sourceBetween(
    "      function orderedProjectExamRequirementFields(fields = {}) {",
    "\n      function sourceFieldGroup",
  );
  assert.ok(ordering.includes('const lastField = "科目信息";'));
  assert.ok(ordering.includes("const ordered = [...known, ...extra];"));
  assert.ok(ordering.includes("ordered.push(lastField);"));
  assert.ok(html.includes('sourceFieldGroup("配置需求字段", "fields", orderedProjectExamRequirementFields(snapshot.fields || {}), fanweiSelectOptions)'));
  assert.ok(html.includes("Object.entries(orderedProjectExamRequirementFields(snapshot.fields || {}))"));
});

test("auto configuration restores the persisted EasyExam requirement by project id", () => {
  assert.ok(html.includes("async function loadAutoConfigProject()"));
  assert.ok(html.includes('new URLSearchParams(window.location.search).get("projectId")'));
  assert.ok(html.includes("const requirements = projectExamRequirements(task)"));
  assert.ok(html.includes("installAutoConfigRequirements(requirements, data, initialRequirementIndex)"));
  assert.ok(html.includes("pendingRequirementIndex"));
  assert.ok(html.includes("AutoConfigPage({ documentObject: document, loadProject: loadAutoConfigProject })"));
  assert.ok(html.includes("requirementIndex: uiState.autoConfigRequirementIndex"));
  assert.ok(html.includes("startAutoConfigRequirement(nextIndex)"));
});

test("project personnel workflow exposes a protected preview and recheck flow", () => {
  assert.ok(html.includes('id="operationPersonnelTaskActionBtn"'));
  assert.ok(html.includes('id="operationPersonnelTaskEditBtn" type="button">编辑</button>'));
  assert.ok(html.includes('id="operationPersonnelTaskSaveBtn" type="button" hidden>保存</button>'));
  assert.ok(html.includes('id="operationPersonnelTaskCancelEditBtn" type="button" hidden>取消</button>'));
  assert.ok(html.includes('method: "PATCH"'));
  assert.ok(html.includes("data-operation-personnel-edit"));
  assert.ok(html.includes("/operation-personnel-task`"));
  assert.ok(html.includes('id="operationPersonnelTaskRecheckBtn"'));
  assert.ok(html.includes('id="operationPersonnelTaskState"'));
  assert.equal(html.includes("人员任务接口待接入"), false);
  assert.ok(html.includes("function renderOperationPersonnelDraft(draft = {}, editing = false)"));
  assert.equal(html.includes("人员服务字段来自泛微，批次代码来自建批次结果。"), false);
  assert.equal(html.includes('<div class="operation-task-section-head"><span class="workflow-source-badge fanwei">泛微</span></div>'), false);
  assert.ok(html.includes("operation-personnel-schedule-list"));
  assert.ok(html.includes("function renderOperationPersonnelSchedule(item = {}, index = 0)"));
  assert.ok(html.includes("function operationPersonnelRequirementComparison(draft = {})"));
  assert.ok(html.includes("function operationPersonnelPendingWritePlan(draft = {})"));
  assert.ok(html.includes("function renderOperationPersonnelRequirements(draft = {}, editing = false)"));
  const personnelRequirementsRenderer = sourceBetween(
    "      function renderOperationPersonnelRequirements(draft = {}, editing = false) {",
    "\n      function renderOperationPersonnelDraft",
  );
  assert.ok(personnelRequirementsRenderer.includes('.filter((item) => item.name !== "正式考试-监考登录监控")'));
  assert.ok(personnelRequirementsRenderer.includes("data-operation-personnel-requirement"));
  assert.ok(personnelRequirementsRenderer.includes("可编辑"));
  assert.ok(personnelRequirementsRenderer.includes('item.synced ? "已同步" : "待写入"'));
  assert.equal(personnelRequirementsRenderer.includes('"待核对"'), false);
  const personnelDraftRenderer = sourceBetween(
    "      function renderOperationPersonnelDraft(draft = {}, editing = false) {",
    "\n      function renderOperationPersonnelTaskState",
  );
  assert.equal(personnelDraftRenderer.includes('renderOperationPersonnelParam("监考登录监控"'), false);
  assert.equal(personnelDraftRenderer.includes('renderOperationPersonnelParam("最早登录系统时间"'), false);
  assert.ok(personnelDraftRenderer.includes('renderOperationPersonnelParam("监考类型", "分散监考"'));
  assert.equal(personnelDraftRenderer.includes('renderOperationPersonnelParam("监考比例"'), false);
  assert.equal(personnelDraftRenderer.includes('renderOperationPersonnelParam("监考人数"'), false);
  assert.equal(personnelDraftRenderer.includes('renderOperationPersonnelParam("人员服务"'), false);
  assert.ok(html.includes('const edits = { dates: {}, personnel: {}, requirements: {} };'));
  assert.ok(html.includes("edits.requirements[name] = input.value"));
  assert.ok(html.includes('data-personnel-section="configuration"'));
  assert.ok(html.includes('data-personnel-section="requirements"'));
  assert.equal(personnelDraftRenderer.includes('data-personnel-section="task"'), false);
  assert.equal(personnelDraftRenderer.includes("<h4>任务信息</h4>"), false);
  assert.ok(html.includes('data-personnel-section="recipients"'));
  assert.ok(html.includes("operation-personnel-field-grid"));
  assert.ok(html.includes("operation-personnel-requirement-list"));
  assert.ok(html.includes('renderOperationPersonnelParam("人员落实日期", `${dates.start || "待补充"} ~ ${dates.end || "待补充"}`'));
  assert.ok(html.includes("function renderOperationPersonnelEditDateRange(dates = {}, warning = false)"));
  assert.ok(html.includes('data-operation-personnel-edit="dates.start"'));
  assert.ok(html.includes('data-operation-personnel-edit="dates.end"'));
  assert.ok(html.includes("待写入"));
  assert.ok(html.includes("补全人员信息并发送"));
  assert.ok(html.includes("operation-personnel-schedule-list .content-exam-header"));
  assert.ok(html.includes("content-exam-card operation-personnel-schedule-card"));
  assert.ok(html.includes("<span>序号</span><span>考试名称</span><span>考试时间</span>"));
  assert.ok(html.includes("schedules.map((item, index) => renderOperationPersonnelSchedule(item, index))"));
  assert.ok(html.includes("/operation-personnel-task/preview"));
  assert.ok(html.includes("/operation-personnel-task/send"));
  assert.ok(html.includes("/operation-personnel-task/recheck"));
  const handler = sourceBetween(
    "      async function previewAndSendOperationPersonnelTask() {",
    "\n      async function recheckOperationPersonnelTask() {",
  );
  assert.ok(handler.includes("await showConfirmDialog"));
  assert.ok(handler.includes('title: "填写变更内容"'));
  assert.ok(handler.includes('label: "变更内容"'));
  assert.ok(handler.includes('value: resendPreview.suggestedChangeSummary || ""'));
  assert.ok(handler.includes('placeholder: "系统已列出本次与上次发送任务的全部差异，可补充说明"'));
  assert.ok(handler.includes("required: true"));
  assert.ok(handler.includes("operationPersonnelTaskHasSent"));
  assert.ok(html.includes("Array.isArray(state.sendHistory) && state.sendHistory.length > 0"));
  assert.ok(handler.includes("previewDraftFingerprint: resendPreview.currentFingerprint"));
  assert.ok(handler.includes("previewBaselineFingerprint: resendPreview.baselineFingerprint"));
  assert.ok(handler.includes("await ensureScoreStampLocalHelper()"));
  assert.ok(handler.includes("正在连接已开启的运控页面"));
  assert.ok(handler.includes("正在自动补全人员信息、选择收件人与抄送人并发送任务单"));
  assert.ok(handler.includes("changeSummary"));
  assert.ok(handler.includes("previewToken: preview.previewToken"));
  assert.ok(handler.includes("await pollOperationPersonnelAttempt"));
  assert.ok(html.includes("function operationPersonnelExpiredDateLabels(draft = {})"));
  assert.ok(html.includes('recipients.ccGroups || [recipients.ccGroup]'));
  assert.ok(html.includes('join("、")'));
  assert.ok(html.includes("expiredDateLabels.length > 0"));
  assert.ok(html.includes('operationPersonnelTaskActionBtn.title = expiredDateLabels.length'));
});

test("personnel task layout keeps the shared card styling", () => {
  const layoutCss = sourceBetween(
    "      .operation-personnel-layout {",
    "\n      .operation-param-item {",
  );
  assert.ok(layoutCss.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"));
  assert.ok(html.includes(".operation-personnel-field-grid,\n        .operation-personnel-requirement-list { grid-template-columns: 1fr; }"));
  assert.equal(layoutCss.includes("background:"), false);
  assert.equal(layoutCss.includes("border-radius:"), false);
  assert.equal(layoutCss.includes("box-shadow:"), false);
});

test("personnel task save shows only a concise success message", () => {
  const saveHandler = sourceBetween(
    "      async function saveOperationPersonnelTaskEdit() {",
    "\n      async function pollOperationPersonnelAttempt",
  );
  assert.ok(saveHandler.includes('operationPersonnelTaskState.textContent = "人员任务草稿已保存。";'));
  assert.equal(saveHandler.includes("result.changeSummary"), false);
});

test("project personnel workflow keeps a fallback draft for local editing", () => {
  const workflowRenderer = sourceBetween(
    "      function renderProjectWorkflow(task = {}, workflow = {}, batchDraft = {}) {",
    "\n      function projectRequirementFormalTime",
  );
  assert.ok(workflowRenderer.includes("const workflowPersonnelDraft = workflow.personnelDraft || {};"));
  assert.ok(workflowRenderer.includes("taskViewState.operationPersonnelTask = {"));
  assert.ok(workflowRenderer.includes("draft: workflowPersonnelDraft"));
  assert.ok(workflowRenderer.includes("if (!taskViewState.operationPersonnelEditing)"));
});
