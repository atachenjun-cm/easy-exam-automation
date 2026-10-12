import {
  buildCandidateChangeRosterFromMapping,
  candidateChangeInitialFieldMapping,
  candidateChangeMissingMappings,
} from "../candidate_change_mapping.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cloneRows(rows = []) {
  return JSON.parse(JSON.stringify(Array.isArray(rows) ? rows : []));
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace("/", "-");
}

const operationLabels = { add: "新增", edit: "修改", delete: "删除" };
const fieldLabels = {
  full_name: "姓名",
  identity_id: "身份证号",
  course_code: "科目编号",
  mobile: "手机号",
  email: "邮箱",
  custom_fields: "自定义字段",
};
const statusLabels = {
  waiting_review: "待审核",
  applying: "执行中",
  applied: "已完成",
  conflict: "名单冲突",
  partial_failed: "部分失败",
  cancelled: "已取消",
};

function operationBadge(operation) {
  return `<span class="ccm-badge is-${escapeHtml(operation)}">${escapeHtml(operationLabels[operation] || operation)}</span>`;
}

function statusBadge(status) {
  return `<span class="ccm-status is-${escapeHtml(status)}">${escapeHtml(statusLabels[status] || status || "未知")}</span>`;
}

function changeSetActionCount(changeSet = {}) {
  const itemCount = Number(changeSet.items?.length || 0);
  return itemCount || (changeSet.impact?.room_assignment === "clear_all" ? 1 : 0);
}

function contactText(candidate = {}) {
  return candidate.email || candidate.mobile || "--";
}

export function candidateExamStatusText(status) {
  return String(status || "").trim().toLowerCase() === "completed" ? "已完成" : status || "未开考";
}

function candidateMatchesSearch(data, candidate = {}, search = "") {
  const query = String(search || "").trim().toLowerCase();
  if (!query) return true;
  return [
    candidate.full_name,
    candidate.permit,
    candidate.email,
    candidate.mobile,
    candidateCourseText(data, candidate),
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

function candidateCourseText(data, candidate = {}) {
  const code = String(candidate.course_code || "").trim();
  const course = (Array.isArray(data?.courses) ? data.courses : []).find((item) => (
    String(item?.code || item?.course_code || "").trim() === code
  ));
  const name = String(course?.name || course?.course_name || candidate.course_name || "").trim();
  if (name && code) return `${name}（${code}）`;
  return name || code || "--";
}

function editorFields(data = {}) {
  const fields = Array.isArray(data.editorFields) ? data.editorFields : [];
  if (fields.length) return fields;
  return [
    { field_code: "permit", field_name: "准考证号", label: "准考证号", candidate_key: "permit", scope: "base", type: "text", required: true },
    { field_code: "full_name", field_name: "姓名", label: "姓名", candidate_key: "full_name", scope: "base", type: "text", required: true },
  ];
}

function editorFieldValue(candidate = {}, field = {}) {
  if (field.scope === "base" && field.candidate_key) return candidate[field.candidate_key] || "";
  return candidate.custom_fields?.[field.field_name] || "";
}

function editorFieldOptions(field = {}) {
  const options = Array.isArray(field.options) ? field.options : [];
  if (options.length) {
    return options
      .map((option) => ({
        value: String(option?.value ?? "").trim(),
        label: String(option?.label ?? option?.value ?? "").trim(),
      }))
      .filter((option) => option.value);
  }
  return (Array.isArray(field.choices) ? field.choices : [])
    .map((choice) => ({ value: String(choice ?? "").trim(), label: String(choice ?? "").trim() }))
    .filter((option) => option.value);
}

function editorControlHtml(field, index) {
  const name = `editor_field_${index}`;
  const required = field.required ? "required" : "";
  const options = editorFieldOptions(field);
  if (field.type === "select" || options.length) {
    return `<select class="field-input" name="${name}" ${required}><option value="">请选择</option>${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select>`;
  }
  const inputType = field.type === "email" ? "email" : field.type === "date" ? "date" : "text";
  return `<input class="field-input" name="${name}" type="${inputType}" ${required}>`;
}

function invalidCandidateCourseMessage(data, courseCode) {
  const value = String(courseCode || "").trim();
  const courseField = editorFields(data).find((field) => field.field_code === "course_code");
  const validCodes = new Set(editorFieldOptions(courseField).map((option) => option.value));
  if (!value || validCodes.has(value)) return "";
  return `科目编号 ${value} 不属于本场次，请从下拉选项中选择。`;
}

function mappingOptionsHtml(columns = [], selected = "", required = false) {
  const emptyLabel = required ? "请选择对应列" : "不导入此字段";
  return `<option value="">${emptyLabel}</option>${(Array.isArray(columns) ? columns : []).map((column) => (
    `<option value="${escapeHtml(column)}" ${column === selected ? "selected" : ""}>${escapeHtml(column)}</option>`
  )).join("")}`;
}

function fieldChange(item, field) {
  const before = item.before?.[field];
  const after = item.after?.[field];
  const format = (value) => field === "custom_fields"
    ? Object.entries(value || {}).map(([key, itemValue]) => `${key}：${itemValue}`).join("；") || "空"
    : String(value || "空");
  return `<div class="ccm-field-change"><span>${escapeHtml(fieldLabels[field] || field)}</span><del>${escapeHtml(format(before))}</del><strong>${escapeHtml(format(after))}</strong></div>`;
}

export function CandidateChangePage({
  root,
  topbar,
  apiBase = "",
  navigate = () => {},
  showError = (message) => window.alert(message),
  showConfirm = async (message) => window.confirm(message),
  canUseTouch = () => false,
  prepareTouchSend = async () => {},
} = {}) {
  const state = {
    taskId: "",
    sessionId: "",
    data: null,
    activeTab: "roster",
    mode: "append_list",
    search: "",
    workingSearch: "",
    workingRoster: [],
    parsedFileName: "",
    parseSummary: null,
    sourceColumns: [],
    rawRows: [],
    fieldMapping: {},
    reason: "",
    changeSet: null,
    canApply: false,
    busy: false,
    selectedPermits: new Set(),
    clearRooms: false,
    syncAddedToTrial: false,
  };

  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, { cache: "no-store", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = Array.isArray(data.errors) && data.errors.length ? `\n${data.errors.join("\n")}` : "";
      const error = new Error(`${data.error || `请求失败：HTTP ${response.status}`}${detail}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function setBusy(busy) {
    state.busy = busy;
    root.querySelectorAll("button, input, select, textarea").forEach((control) => {
      if (control.dataset.keepEnabled === "true") return;
      control.disabled = busy;
    });
  }

  function renderTopbar() {
    if (!topbar) return;
    topbar.innerHTML = `
      <div>
        <h1>考生变更管理</h1>
      </div>
      <div class="view-actions">
        <button class="btn" type="button" data-ccm-back>返回考试详情</button>
      </div>`;
  }

  function contextHtml() {
    const session = state.data?.session || {};
    const task = state.data?.task || {};
    const phase = state.data?.phase;
    const pendingCount = (state.data?.changes || []).filter((change) => change.status === "waiting_review").length;
    return `
      <section class="ccm-context" aria-label="当前考试场次">
        <div><span>考试项目</span><strong>${escapeHtml(task.examName || task.projectName || "--")}</strong></div>
        <div><span>目标场次</span><strong>${escapeHtml(session.sessionType === "trial" ? "试考" : "正式考试")}</strong></div>
        <div><span>考试时间</span><strong>${escapeHtml(session.start || "--")}</strong></div>
        <div><span>当前阶段</span><strong class="${phase === "not_started" ? "ccm-ok" : "ccm-danger"}">${phase === "not_started" ? "未开考" : phase === "started" ? "考试进行中" : "考试已结束"}</strong></div>
        <div><span>线上考生</span><strong>${Number(state.data?.candidates?.length || 0)}</strong></div>
        <div><span>已分班</span><strong>${Number(session.roomCount || 0)} 班</strong></div>
        <div><span>待审核变更</span><strong class="ccm-warn">${pendingCount}</strong></div>
        <div><span>名单版本</span><strong>${escapeHtml(String(state.data?.rosterHash || "").slice(0, 8).toUpperCase() || "--")}</strong></div>
      </section>`;
  }

  function tabsHtml() {
    const pending = Number(state.data?.changes?.filter((change) => change.status === "waiting_review").length || 0);
    return `
      <nav class="ccm-tabs" aria-label="考生变更管理视图">
        <button type="button" class="${state.activeTab === "roster" ? "is-active" : ""}" data-ccm-tab="roster">当前名单</button>
        <button type="button" class="${state.activeTab === "create" ? "is-active" : ""}" data-ccm-tab="create">新建变更</button>
        <button type="button" class="${state.activeTab === "preview" ? "is-active" : ""}" data-ccm-tab="preview">差异预览${state.changeSet ? `<span>${Number(state.changeSet.items?.length || 0)}</span>` : ""}</button>
        <button type="button" class="${state.activeTab === "history" ? "is-active" : ""}" data-ccm-tab="history">变更记录${pending ? `<span>${pending}</span>` : ""}</button>
      </nav>`;
  }

  function rosterHtml() {
    const rows = (state.data?.candidates || [])
      .filter((candidate) => candidateMatchesSearch(state.data, candidate, state.search));
    return `
      <div class="ccm-toolbar">
        <label class="ccm-search">
          <svg class="ccm-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.4"></circle><path d="m16.2 16.2 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path></svg>
          <input class="field-input" type="search" data-ccm-search value="${escapeHtml(state.search)}" aria-label="搜索考生" placeholder="姓名或准考证号">
        </label>
        <div class="view-actions">
          <button class="btn" type="button" data-ccm-refresh>同步线上名单</button>
          <button class="btn primary" type="button" data-ccm-new-change>新建变更</button>
        </div>
      </div>
      <div class="ccm-table-wrap">
        <table class="ccm-table">
          <thead><tr><th>考生</th><th>准考证号</th><th>科目</th><th>联系方式</th><th>考试状态</th></tr></thead>
          <tbody>${rows.length ? rows.map((candidate) => `
            <tr>
              <td><strong>${escapeHtml(candidate.full_name || "--")}</strong></td>
              <td><code>${escapeHtml(candidate.permit)}</code></td>
              <td>${escapeHtml(candidateCourseText(state.data, candidate))}</td>
              <td>${escapeHtml(contactText(candidate))}</td>
              <td>${escapeHtml(candidateExamStatusText(candidate.exam_status))}</td>
            </tr>`).join("") : '<tr><td colspan="5" class="ccm-empty">没有符合条件的考生</td></tr>'}</tbody>
        </table>
      </div>
      <p class="ccm-footnote">线上校验时间：${escapeHtml(formatTime(state.data?.checkedAt))}。名单数据来自当前易考场次，不使用文件缓存生成变更。</p>`;
  }

  function appendListStats(rows = state.workingRoster) {
    const currentPermits = new Set((state.data?.candidates || []).map((candidate) => String(candidate.permit || "").trim()));
    const uniquePermits = new Set();
    let skippedExisting = 0;
    let additions = 0;
    for (const candidate of rows || []) {
      const permit = String(candidate?.permit || "").trim();
      if (!permit || uniquePermits.has(permit)) continue;
      uniquePermits.add(permit);
      if (currentPermits.has(permit)) skippedExisting += 1;
      else additions += 1;
    }
    return { total: uniquePermits.size, additions, skippedExisting, currentPermits };
  }

  function workingRosterTable() {
    const rows = state.workingRoster || [];
    const query = state.workingSearch.trim().toLowerCase();
    const filteredRows = rows.filter((candidate) => candidateMatchesSearch(state.data, candidate, query));
    const visibleRows = filteredRows.slice(0, 100);
    const selectedCount = state.selectedPermits.size;
    const allSelected = filteredRows.length > 0 && filteredRows.every((candidate) => state.selectedPermits.has(candidate.permit));
    const appendOnly = state.mode === "append_list";
    const appendStats = appendListStats(rows);
    const footnote = query
      ? `当前名单共 ${rows.length} 人，搜索结果 ${filteredRows.length} 人${filteredRows.length > 100 ? "，表格先显示前 100 人" : ""}；差异计算仍包含全部考生。`
      : rows.length > 100
        ? `当前共 ${rows.length} 人，表格先显示前 100 人；差异计算仍包含全部考生。`
        : "";
    return `
      <div class="ccm-batch-toolbar">
        <div class="ccm-batch-summary">
          <label class="ccm-search ccm-working-search">
            <svg class="ccm-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.4"></circle><path d="m16.2 16.2 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path></svg>
            <input class="field-input" type="search" data-ccm-working-search value="${escapeHtml(state.workingSearch)}" aria-label="搜索变更名单考生" placeholder="姓名或准考证号">
          </label>
          <span>${appendOnly ? `文件 ${appendStats.total} 人 · 待新增 ${appendStats.additions} 人 · 已存在跳过 ${appendStats.skippedExisting} 人` : `已选 ${selectedCount} 人`}</span>
        </div>
        <div class="view-actions">
          <button type="button" class="btn danger" data-ccm-delete-selected ${selectedCount ? "" : "disabled"}>${appendOnly ? "批量移除" : "批量删除"}</button>
          ${state.mode === "manual" ? `<button type="button" class="btn danger" data-ccm-clear-session ${state.data?.candidates?.length || state.data?.session?.roomCount ? "" : "disabled"}>清空本场次考生及分班</button>` : ""}
        </div>
      </div>
      ${state.clearRooms ? '<div class="ccm-notice is-danger">已将本场次全部考生和分班列入清空草稿。生成差异后仍需人工确认才会执行。</div>' : ""}
      <div class="ccm-table-wrap ccm-working-table">
        <table class="ccm-table">
          <thead><tr><th class="ccm-select-cell"><input type="checkbox" data-ccm-select-all aria-label="${query ? "全选搜索结果" : "全选本名单"}" ${allSelected ? "checked" : ""}></th><th>考生</th><th>准考证号</th><th>科目编号</th><th>联系方式</th>${appendOnly ? "<th>处理结果</th>" : ""}<th>操作</th></tr></thead>
          <tbody>${visibleRows.length ? visibleRows.map((candidate) => `
            <tr>
              <td class="ccm-select-cell"><input type="checkbox" data-ccm-select-permit="${escapeHtml(candidate.permit)}" aria-label="选择 ${escapeHtml(candidate.full_name || candidate.permit)}" ${state.selectedPermits.has(candidate.permit) ? "checked" : ""}></td>
              <td><strong>${escapeHtml(candidate.full_name || "--")}</strong></td>
              <td><code>${escapeHtml(candidate.permit)}</code></td>
              <td>${escapeHtml(candidateCourseText(state.data, candidate))}</td>
              <td>${escapeHtml(contactText(candidate))}</td>
              ${appendOnly ? `<td><span class="ccm-status ${appendStats.currentPermits.has(candidate.permit) ? "is-skipped" : "is-applied"}">${appendStats.currentPermits.has(candidate.permit) ? "已存在，跳过" : "待新增"}</span></td>` : ""}
              <td><div class="ccm-row-actions"><button type="button" class="btn" data-ccm-edit="${escapeHtml(candidate.permit)}">编辑</button><button type="button" class="btn danger" data-ccm-delete="${escapeHtml(candidate.permit)}">${appendOnly ? "移除" : "删除"}</button></div></td>
            </tr>`).join("") : `<tr><td colspan="${appendOnly ? 7 : 6}" class="ccm-empty">${rows.length ? "没有符合条件的考生" : "名单为空"}</td></tr>`}</tbody>
        </table>
      </div>
      ${footnote ? `<p class="ccm-footnote">${footnote}</p>` : ""}`;
  }

  function rebuildMappedRoster() {
    state.workingRoster = buildCandidateChangeRosterFromMapping({
      fields: editorFields(state.data),
      rawRows: state.rawRows,
      mapping: state.fieldMapping,
    });
    state.parseSummary = {
      total: state.workingRoster.length,
      missingFields: candidateChangeMissingMappings(editorFields(state.data), state.fieldMapping),
    };
    state.selectedPermits.clear();
    state.clearRooms = false;
  }

  function resetUploadedRoster() {
    state.parsedFileName = "";
    state.parseSummary = null;
    state.sourceColumns = [];
    state.rawRows = [];
    state.fieldMapping = {};
  }

  function mappingHtml() {
    if (!state.parsedFileName) return "";
    const fields = editorFields(state.data);
    const missingFields = state.parseSummary?.missingFields || [];
    return `
      <div class="ccm-mapping-panel">
        <div class="ccm-mapping-head">
          <div><h3>字段对应</h3><p>按本场收集字段确认原名单中的对应列。</p></div>
          <span class="ccm-mapping-state ${missingFields.length ? "is-incomplete" : "is-complete"}">${missingFields.length ? `待对应 ${missingFields.length} 项` : "字段对应完成"}</span>
        </div>
        <div class="ccm-mapping-grid">
          ${fields.map((field) => `
            <label class="ccm-mapping-field">
              <span>${escapeHtml(field.label || field.field_name)}${field.required ? "（必填）" : "（选填）"}</span>
              <select class="field-input" data-ccm-map-field="${escapeHtml(field.field_code)}">
                ${mappingOptionsHtml(state.sourceColumns, state.fieldMapping[field.field_code], field.required)}
              </select>
            </label>`).join("")}
        </div>
        ${missingFields.length ? `<div class="ccm-notice is-warning">请先对应：${escapeHtml(missingFields.join("、"))}</div>` : ""}
      </div>`;
  }

  function canGeneratePreview() {
    if (state.mode === "manual") return Boolean(state.workingRoster.length || state.data?.candidates?.length || state.clearRooms);
    if (!state.workingRoster.length) return false;
    return Boolean(state.parsedFileName) && !(state.parseSummary?.missingFields || []).length;
  }

  function createHtml() {
    const parsed = state.parseSummary;
    const uploadMode = state.mode !== "manual";
    const appendOnly = state.mode === "append_list";
    const appendStats = appendListStats();
    const sectionTitle = appendOnly ? "只新增名单" : state.mode === "full_list" ? "最新版完整名单" : "变更后的完整名单";
    return `
      <div class="ccm-create-head">
        <div class="ccm-segmented" aria-label="变更录入方式">
          <button type="button" class="${appendOnly ? "is-active" : ""}" data-ccm-mode="append_list">只新增名单</button>
          <button type="button" class="${state.mode === "full_list" ? "is-active" : ""}" data-ccm-mode="full_list">完整名单对比</button>
          <button type="button" class="${state.mode === "manual" ? "is-active" : ""}" data-ccm-mode="manual">逐条增删改</button>
        </div>
        <span>基线：线上名单 ${Number(state.data?.candidates?.length || 0)} 人</span>
      </div>
      <div class="ccm-create-grid">
        <section class="ccm-section">
          <div class="ccm-section-head"><h2>${sectionTitle}</h2>${state.mode === "manual" ? '<button type="button" class="btn" data-ccm-add>新增考生</button>' : ""}</div>
          <div class="ccm-section-body">
            ${uploadMode ? `
              <label class="ccm-upload ${state.parsedFileName ? "has-file" : ""}" data-ccm-upload>
                <input type="file" data-ccm-file accept=".xlsx,.xls,.csv">
                <strong>${escapeHtml(state.parsedFileName || (appendOnly ? "点击选择或拖拽待新增名单到此处" : "点击选择或拖拽最新版完整名单到此处"))}</strong>
                <span>${parsed
                  ? appendOnly
                    ? `已读取 ${appendStats.total} 人，其中待新增 ${appendStats.additions} 人、已存在跳过 ${appendStats.skippedExisting} 人`
                    : `已读取 ${parsed.total} 人，请确认下方字段对应`
                  : appendOnly
                    ? "可包含已有考生或全部为新考生；只按准考证号追加，不修改原名单。"
                    : "支持 .xlsx、.xls、.csv；缺失考生会列为拟删除。"}</span>
              </label>` : `
              <div class="ccm-notice">在当前线上名单副本中编辑。保存后先生成差异，不会立即修改易考。</div>`}
            ${uploadMode ? mappingHtml() : ""}
            ${state.mode === "manual" || state.parsedFileName ? workingRosterTable() : ""}
          </div>
        </section>
        <aside class="ccm-section">
          <div class="ccm-section-head"><h2>提交信息</h2></div>
          <div class="ccm-section-body">
            <label class="ccm-field"><span>目标场次</span><input class="field-input" value="${escapeHtml(state.data?.session?.name || "")}" disabled></label>
            <label class="ccm-field"><span>变更原因</span><textarea class="field-input" rows="4" data-ccm-reason placeholder="填写本次增删改原因">${escapeHtml(state.reason)}</textarea></label>
            ${state.data?.trialSession ? `
              <label class="ccm-option-check">
                <input type="checkbox" data-ccm-sync-trial ${state.syncAddedToTrial ? "checked" : ""}>
                <span><strong>同步新增考生到试考</strong><small>仅复制本次新增考生，科目编号自动替换为 SKTY；试考中已有的准考证号会跳过。</small></span>
              </label>` : ""}
            <div class="ccm-notice ${appendOnly ? "" : "is-warning"}">${appendOnly
              ? "按准考证号与易考当前名单比对：已有考生整行跳过，只新增不存在的考生，不修改、不删除原名单。"
              : state.mode === "full_list"
                ? "完整名单中缺失的考生会列为“拟删除”，已有考生字段变化会列为“拟修改”；必须在差异页逐项核对。"
                : "逐条编辑会按草稿生成新增、修改或删除差异；必须在差异页逐项核对。"}</div>
            <button type="button" class="btn primary ccm-block" data-ccm-preview ${canGeneratePreview() ? "" : "disabled"}>生成差异预览</button>
          </div>
        </aside>
      </div>`;
  }

  function previewHtml() {
    const changeSet = state.changeSet;
    if (!changeSet) {
      return `<div class="ccm-empty-panel"><h2>尚未生成差异</h2><p>从“新建变更”上传最新版名单或逐条编辑后，再生成差异预览。</p><button type="button" class="btn primary" data-ccm-new-change>新建变更</button></div>`;
    }
    const summary = changeSet.summary || {};
    const items = changeSet.items || [];
    const allConfirmed = state.canApply && Number(summary.blocked || 0) === 0;
    return `
      ${changeSet.sourceType === "append_list" ? `<div class="ccm-notice">只新增名单共 ${Number(changeSet.impact?.append_upload?.uploaded_count || 0)} 人：待新增 ${Number(changeSet.impact?.append_upload?.added_count || 0)} 人，易考已存在并跳过 ${Number(changeSet.impact?.append_upload?.skipped_existing_count || 0)} 人；不会修改或删除原考生。</div>` : ""}
      <div class="ccm-summary">
        <div><span>新增</span><strong class="ccm-ok">${Number(summary.add || 0)}</strong></div>
        <div><span>修改</span><strong>${Number(summary.edit || 0)}</strong></div>
        <div><span>删除</span><strong class="ccm-danger">${Number(summary.delete || 0)}</strong></div>
        <div><span>高风险</span><strong class="ccm-warn">${Number(summary.high_risk || 0)}</strong></div>
      </div>
      <div class="ccm-table-wrap">
        <table class="ccm-table ccm-diff-table">
          <thead><tr><th>操作</th><th>考生</th><th>准考证号</th><th>变化字段</th><th>校验</th></tr></thead>
          <tbody>${items.map((item) => `
            <tr class="${item.risk_level === "high" ? "is-high-risk" : ""}">
              <td>${operationBadge(item.operation)}</td>
              <td><strong>${escapeHtml(item.after?.full_name || item.before?.full_name || "--")}</strong></td>
              <td><code>${escapeHtml(item.permit || item.old_permit)}</code></td>
              <td>${item.operation === "edit" ? (item.changed_fields || []).map((field) => fieldChange(item, field)).join("") : item.operation === "add" ? `<strong class="ccm-ok">${escapeHtml(contactText(item.after))}</strong>` : `<del>${escapeHtml(item.before?.course_name || item.before?.course_code || "线上现有考生")}</del>`}</td>
              <td>${item.blocked ? `<span class="ccm-status is-partial_failed">${escapeHtml(item.block_reason)}</span>` : item.risk_level === "high" ? '<span class="ccm-status is-waiting_review">待确认</span>' : '<span class="ccm-status is-applied">通过</span>'}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="ccm-review-grid">
        <section class="ccm-section">
          <div class="ccm-section-head"><h2>下游影响</h2><span>只标记待处理，不自动发送</span></div>
          <div class="ccm-impact-list">
            <div><strong>班级分配</strong><span>${changeSet.impact?.room_assignment === "clear_all" ? "正式执行并确认全部考生删除后，清空本场次全部分班" : changeSet.impact?.room_assignment === "append_to_existing" ? "新增考生将自动加入当前人数最少的现有班级" : changeSet.impact?.room_assignment === "needs_preview" ? "执行后需要重新预览分班" : "不受影响"}</span></div>
            ${changeSet.impact?.trial_candidate_sync?.requested ? `<div><strong>试考名单</strong><span>本次成功新增的考生将复制到试考场次，科目编号替换为 SKTY</span></div>` : ""}
            <div><strong>监考人员任务</strong><span>${changeSet.impact?.personnel_task === "pending_review" ? "标记为变更待检查" : "不受影响"}</span></div>
            <div><strong>新增考生短信</strong><span>${Number(summary.add || 0) && canUseTouch() ? `变更完成后可为本次新增的 ${Number(summary.add)} 人创建独立触达任务；不会自动发送` : "本次不会自动发送短信或邮件"}</span></div>
            <div><strong>腾讯文档</strong><span>${changeSet.impact?.tencent_docs === "pending_sync" ? "线上回读后标记待同步" : "不受影响"}</span></div>
          </div>
        </section>
        <aside class="ccm-section">
          <div class="ccm-section-head"><h2>人工确认</h2></div>
          <div class="ccm-section-body ccm-confirm-list">
            <label><input type="checkbox" data-ccm-confirm-check>${changeSet.sourceType === "append_list" ? "确认本次只新增考生，不修改或删除原名单" : "已核对全部拟删除考生"}</label>
            <label><input type="checkbox" data-ccm-confirm-check>已核对科目及准考证号变化</label>
            <label><input type="checkbox" data-ccm-confirm-check>${changeSet.impact?.room_assignment === "clear_all" ? "同意在全部考生删除成功后清空本场次分班" : "同意执行新增考生分班并重新检查任务单"}</label>
            ${!allConfirmed ? `<div class="ccm-notice is-danger">${Number(summary.blocked || 0) ? `有 ${Number(summary.blocked)} 项因考试状态被阻止。` : "当前场次已经结束，不能再修改考生名单。"}</div>` : ""}
            <button type="button" class="btn primary ccm-block" data-ccm-apply ${allConfirmed ? "" : "disabled"}>确认并执行 ${changeSetActionCount(changeSet)} 项变更</button>
            <p class="ccm-footnote">执行前会再次读取易考名单并校验版本；名单已变化时自动停止。</p>
          </div>
        </aside>
      </div>`;
  }

  function historyHtml() {
    const changes = state.data?.changes || [];
    const touchEnabled = canUseTouch();
    return `
      <div class="ccm-history-head"><div><h2>变更记录</h2><p>保留提交原因、名单基线、逐项结果和线上回读状态。</p></div><button type="button" class="btn" data-ccm-refresh-history>刷新</button></div>
      <div class="ccm-table-wrap">
        <table class="ccm-table">
          <thead><tr><th>变更单</th><th>提交时间</th><th>来源</th><th>变更范围</th><th>状态</th><th>操作人</th>${touchEnabled ? "<th>新增考生短信</th>" : ""}</tr></thead>
          <tbody>${changes.length ? changes.map((change) => `
            <tr>
              <td><code>${escapeHtml(change.id)}</code><div class="ccm-table-sub">${escapeHtml(change.reason || "未填写原因")}</div></td>
              <td>${escapeHtml(formatTime(change.createdAt))}</td>
              <td>${change.sourceType === "manual" ? "逐条增删改" : change.sourceType === "append_list" ? "只新增名单" : "完整名单对比"}</td>
              <td>新增 ${Number(change.summary?.add || 0)} · 修改 ${Number(change.summary?.edit || 0)} · 删除 ${Number(change.summary?.delete || 0)}</td>
              <td>${statusBadge(change.status)}${change.error ? `<div class="ccm-table-error">${escapeHtml(change.error)}</div>` : ""}</td>
              <td>${escapeHtml(change.createdBy || "--")}</td>
              ${touchEnabled ? `<td>${Number(change.summary?.add || 0) && ["applied", "partial_failed"].includes(change.status)
                ? `${change.touchTask?.batchId ? `<div class="ccm-table-sub">批次 #${escapeHtml(change.touchTask.batchId)} · ${Number(change.touchTask.count || 0)} 人 · ${change.touchTask.status === "completed" ? "已导入" : "待核对"}${change.touchTask.batchUrl ? ` · <a href="${escapeHtml(change.touchTask.batchUrl)}" target="_blank" rel="noopener noreferrer">查看批次</a>` : ""}</div>` : ""}
                  <button type="button" class="btn" data-ccm-touch="${escapeHtml(change.id)}" ${change.touchTask?.batchId && change.touchTask.status !== "completed" ? "disabled" : ""}>${change.touchTask?.batchId ? "准备短信发送" : "创建触达任务"}</button>`
                : "--"}</td>` : ""}
            </tr>`).join("") : `<tr><td colspan="${touchEnabled ? 7 : 6}" class="ccm-empty">暂无考生变更记录</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  async function touchNewCandidates(changeSetId) {
    const basePath = `/api/tasks/${encodeURIComponent(state.taskId)}/sessions/${encodeURIComponent(state.sessionId)}/candidate-changes/${encodeURIComponent(changeSetId)}/message-center`;
    const preview = await request(`${basePath}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!preview.alreadyCreated) {
      const count = Number(preview.summary?.availableSms || 0);
      const confirmed = await showConfirm(
        `将为变更单 ${changeSetId} 成功新增的 ${count} 名考生创建独立触达批次“${preview.batchName}”。不会导入原有考生，也不会自动发送短信。确认创建？`,
        { title: "新增考生触达", confirmText: "创建批次" },
      );
      if (!confirmed) return;
      const imported = await request(`${basePath}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preparationId: preview.preparationId }),
      });
      await refreshHistory();
      if (imported.pending || imported.state?.status !== "completed") {
        throw new Error("触达批次尚未完成导入，请核对平台状态，勿重复创建。");
      }
    }
    const prepared = await request(`${basePath}/send-preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const localHelper = prepared.localHelper || {};
    if (localHelper.path !== "/message-center/prepare-send" || !localHelper.payload?.batchId) {
      throw new Error("短信发送确认参数不完整，请刷新后重试。");
    }
    const confirmed = await showConfirm(
      `将先向触达平台当前登录账号发送 1 条测试短信，再为本次新增的 ${Number(prepared.summary?.availableSms || 0)} 名考生打开正式发送确认页；不会自动确认整批发送。确认继续？`,
      { title: "新增考生短信", confirmText: "测试并继续" },
    );
    if (confirmed) await prepareTouchSend(localHelper);
  }

  function editorDialogHtml() {
    const fields = editorFields(state.data);
    return `
      <dialog class="ccm-editor-dialog" data-ccm-editor-dialog>
        <form method="dialog" class="ccm-editor-form">
          <div class="ccm-editor-head"><h2 data-ccm-editor-title>编辑考生</h2><button type="button" class="btn" data-ccm-editor-close>关闭</button></div>
          <div class="ccm-editor-fields">
            ${fields.map((field, index) => `<label class="ccm-field"><span>${escapeHtml(field.label || field.field_name)}</span>${editorControlHtml(field, index)}</label>`).join("")}
          </div>
          <div class="ccm-editor-actions"><button type="button" class="btn" data-ccm-editor-close>取消</button><button type="submit" class="btn primary">保存到变更草稿</button></div>
        </form>
      </dialog>`;
  }

  function render() {
    renderTopbar();
    const content = state.activeTab === "roster"
      ? rosterHtml()
      : state.activeTab === "create"
        ? createHtml()
        : state.activeTab === "preview"
          ? previewHtml()
          : historyHtml();
    root.innerHTML = `
      <div class="ccm-page">
        ${contextHtml()}
        ${tabsHtml()}
        <section class="ccm-content">${content}</section>
      </div>
      ${editorDialogHtml()}`;
  }

  function editorDialog() {
    return root.querySelector("[data-ccm-editor-dialog]");
  }

  function openEditor(candidate = null) {
    const dialog = editorDialog();
    const form = dialog.querySelector("form");
    form.dataset.originalPermit = candidate?.permit || "";
    dialog.querySelector("[data-ccm-editor-title]").textContent = candidate ? "编辑考生" : "新增考生";
    editorFields(state.data).forEach((field, index) => {
      const value = editorFieldValue(candidate || {}, field);
      const courseError = field.field_code === "course_code" ? invalidCandidateCourseMessage(state.data, value) : "";
      form.elements[`editor_field_${index}`].value = courseError ? "" : value;
      if (courseError) showError(courseError, { title: "科目编号不属于本场次" });
    });
    dialog.showModal();
    form.elements.editor_field_0.focus();
  }

  async function load() {
    const query = new URLSearchParams(window.location.search);
    state.taskId = String(query.get("taskId") || "").trim();
    state.sessionId = String(query.get("sessionId") || "").trim();
    if (!state.taskId || !state.sessionId) throw new Error("缺少考试任务或场次参数。");
    root.innerHTML = '<div class="ccm-loading">正在读取易考线上名单...</div>';
    state.data = await request(`/api/tasks/${encodeURIComponent(state.taskId)}/sessions/${encodeURIComponent(state.sessionId)}/candidate-roster?_=${Date.now()}`);
    state.workingRoster = cloneRows(state.data.candidates);
    resetUploadedRoster();
    state.reason = "";
    state.changeSet = null;
    state.selectedPermits.clear();
    state.clearRooms = false;
    state.syncAddedToTrial = false;
    state.activeTab = "roster";
    render();
  }

  async function refreshHistory() {
    const data = await request(`/api/tasks/${encodeURIComponent(state.taskId)}/sessions/${encodeURIComponent(state.sessionId)}/candidate-changes?_=${Date.now()}`);
    state.data.changes = data.changes || [];
    render();
  }

  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-ccm-reason]")) {
      state.reason = event.target.value;
      return;
    }
    const isRosterSearch = event.target.matches("[data-ccm-search]");
    const isWorkingSearch = event.target.matches("[data-ccm-working-search]");
    if (!isRosterSearch && !isWorkingSearch) return;
    const selector = isWorkingSearch ? "[data-ccm-working-search]" : "[data-ccm-search]";
    if (isWorkingSearch) state.workingSearch = event.target.value;
    else state.search = event.target.value;
    const selection = event.target.selectionStart;
    render();
    const input = root.querySelector(selector);
    input?.focus();
    input?.setSelectionRange(selection, selection);
  });

  async function parseRosterFile(file) {
    if (!file) return;
    try {
      const suffix = String(file.name || "").split(".").pop()?.toLowerCase();
      if (!["xlsx", "xls", "csv"].includes(suffix)) throw new Error("文件格式不支持，仅支持 .xlsx、.xls、.csv");
      setBusy(true);
      const response = await fetch(`${apiBase}/api/candidates/parse?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: await file.arrayBuffer(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "名单解析失败");
      state.parsedFileName = data.filename || file.name;
      state.rawRows = cloneRows(data.rawRows || []);
      if (!state.rawRows.length && Array.isArray(data.candidates)) state.rawRows = cloneRows(data.candidates);
      state.sourceColumns = (Array.isArray(data.columns) ? data.columns : [])
        .map((column) => String(column || "").trim())
        .filter(Boolean);
      if (!state.sourceColumns.length && state.rawRows[0]) {
        state.sourceColumns = Object.keys(state.rawRows[0]).filter((column) => column !== "__row");
      }
      state.fieldMapping = candidateChangeInitialFieldMapping({
        fields: editorFields(state.data),
        columns: state.sourceColumns,
        detectedMapping: data.mapping || data.auto_mapping || {},
      });
      rebuildMappedRoster();
      render();
    } catch (error) {
      showError(error.message || String(error), { title: "名单解析失败" });
      render();
    }
  }

  root.addEventListener("change", async (event) => {
    if (event.target.matches("[data-ccm-sync-trial]")) {
      state.syncAddedToTrial = event.target.checked;
      return;
    }
    if (event.target.matches("[data-ccm-select-all]")) {
      const filteredPermits = state.workingRoster
        .filter((candidate) => candidateMatchesSearch(state.data, candidate, state.workingSearch))
        .map((candidate) => candidate.permit);
      if (event.target.checked) filteredPermits.forEach((permit) => state.selectedPermits.add(permit));
      else filteredPermits.forEach((permit) => state.selectedPermits.delete(permit));
      render();
      return;
    }
    if (event.target.matches("[data-ccm-select-permit]")) {
      const permit = event.target.dataset.ccmSelectPermit;
      if (event.target.checked) state.selectedPermits.add(permit);
      else state.selectedPermits.delete(permit);
      render();
      return;
    }
    const mapping = event.target.closest("[data-ccm-map-field]");
    if (mapping) {
      state.fieldMapping[mapping.dataset.ccmMapField] = mapping.value;
      rebuildMappedRoster();
      render();
      return;
    }
    const input = event.target.closest("[data-ccm-file]");
    if (!input?.files?.[0]) return;
    await parseRosterFile(input.files[0]);
  });

  root.addEventListener("dragover", (event) => {
    const upload = event.target.closest("[data-ccm-upload]");
    if (!upload) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    upload.classList.add("is-dragover");
  });

  root.addEventListener("dragleave", (event) => {
    const upload = event.target.closest("[data-ccm-upload]");
    if (!upload || upload.contains(event.relatedTarget)) return;
    upload.classList.remove("is-dragover");
  });

  root.addEventListener("drop", async (event) => {
    const upload = event.target.closest("[data-ccm-upload]");
    if (!upload) return;
    event.preventDefault();
    upload.classList.remove("is-dragover");
    await parseRosterFile(event.dataTransfer?.files?.[0]);
  });

  root.addEventListener("submit", (event) => {
    const form = event.target.closest(".ccm-editor-form");
    if (!form) return;
    event.preventDefault();
    const originalPermit = form.dataset.originalPermit;
    const originalCandidate = state.workingRoster.find((row) => row.permit === originalPermit) || {};
    const candidate = {
      ...originalCandidate,
      custom_fields: { ...(originalCandidate.custom_fields || {}) },
    };
    editorFields(state.data).forEach((field, index) => {
      const value = String(form.elements[`editor_field_${index}`]?.value || "").trim();
      if (field.scope === "base" && field.candidate_key) candidate[field.candidate_key] = value;
      else candidate.custom_fields[field.field_name] = value;
    });
    const courseError = invalidCandidateCourseMessage(state.data, candidate.course_code);
    if (courseError) {
      showError(courseError, { title: "科目编号不属于本场次" });
      return;
    }
    const duplicate = state.workingRoster.find((row) => row.permit === candidate.permit && row.permit !== originalPermit);
    if (duplicate) {
      showError(`准考证号 ${candidate.permit} 已存在。`);
      return;
    }
    if (originalPermit) {
      state.workingRoster = state.workingRoster.map((row) => row.permit === originalPermit ? { ...row, ...candidate } : row);
      if (originalPermit !== candidate.permit) state.selectedPermits.delete(originalPermit);
    } else {
      state.workingRoster = [...state.workingRoster, candidate];
    }
    state.clearRooms = false;
    form.closest("dialog").close();
    render();
  });

  root.addEventListener("click", async (event) => {
    const touch = event.target.closest("[data-ccm-touch]");
    if (touch) {
      if (state.busy || !canUseTouch()) return;
      try {
        state.busy = true;
        touch.disabled = true;
        await touchNewCandidates(touch.dataset.ccmTouch);
      } catch (error) {
        showError(error.message || String(error), { title: "新增考生触达未完成" });
      } finally {
        state.busy = false;
        await refreshHistory().catch(() => render());
      }
      return;
    }
    const tab = event.target.closest("[data-ccm-tab]");
    if (tab) {
      state.activeTab = tab.dataset.ccmTab;
      render();
      return;
    }
    if (event.target.closest("[data-ccm-back]")) {
      navigate(`/exams/${encodeURIComponent(state.taskId)}`);
      return;
    }
    if (event.target.closest("[data-ccm-new-change]")) {
      state.activeTab = "create";
      state.workingRoster = cloneRows(state.data.candidates);
      resetUploadedRoster();
      state.reason = "";
      state.selectedPermits.clear();
      state.clearRooms = false;
      state.syncAddedToTrial = false;
      render();
      return;
    }
    const mode = event.target.closest("[data-ccm-mode]");
    if (mode) {
      state.mode = mode.dataset.ccmMode;
      state.workingRoster = cloneRows(state.data.candidates);
      resetUploadedRoster();
      state.selectedPermits.clear();
      state.clearRooms = false;
      render();
      return;
    }
    if (event.target.closest("[data-ccm-add]")) {
      openEditor();
      return;
    }
    if (event.target.closest("[data-ccm-delete-selected]")) {
      const selected = new Set(state.selectedPermits);
      if (!selected.size) return;
      const appendOnly = state.mode === "append_list";
      if (await showConfirm(
        appendOnly ? `确认从待新增名单移除已选 ${selected.size} 名考生？` : `确认将已选 ${selected.size} 名考生列为拟删除？`,
        { confirmText: appendOnly ? "从名单移除" : "批量列为拟删除", danger: true },
      )) {
        state.workingRoster = state.workingRoster.filter((candidate) => !selected.has(candidate.permit));
        state.selectedPermits.clear();
        state.clearRooms = false;
        render();
      }
      return;
    }
    if (event.target.closest("[data-ccm-clear-session]")) {
      const candidateCount = Number(state.data?.candidates?.length || 0);
      const roomCount = Number(state.data?.session?.roomCount || 0);
      const confirmed = await showConfirm(
        `确认将本场次 ${candidateCount} 名线上考生和 ${roomCount} 个班级全部列入清空草稿？生成差异后还需再次人工确认。`,
        { confirmText: "列入清空草稿", danger: true },
      );
      if (confirmed) {
        state.mode = "manual";
        state.workingRoster = [];
        state.selectedPermits.clear();
        state.clearRooms = true;
        resetUploadedRoster();
        render();
      }
      return;
    }
    const edit = event.target.closest("[data-ccm-edit]");
    if (edit) {
      openEditor(state.workingRoster.find((candidate) => candidate.permit === edit.dataset.ccmEdit));
      return;
    }
    const remove = event.target.closest("[data-ccm-delete]");
    if (remove) {
      const candidate = state.workingRoster.find((row) => row.permit === remove.dataset.ccmDelete);
      const appendOnly = state.mode === "append_list";
      if (await showConfirm(
        appendOnly
          ? `确认从待新增名单移除 ${candidate?.full_name || candidate?.permit}？`
          : `确认将 ${candidate?.full_name || candidate?.permit} 列为拟删除考生？`,
        { confirmText: appendOnly ? "从名单移除" : "列为拟删除", danger: true },
      )) {
        state.workingRoster = state.workingRoster.filter((row) => row.permit !== remove.dataset.ccmDelete);
        state.selectedPermits.delete(remove.dataset.ccmDelete);
        state.clearRooms = false;
        render();
      }
      return;
    }
    if (event.target.closest("[data-ccm-editor-close]")) {
      editorDialog()?.close();
      return;
    }
    if (event.target.closest("[data-ccm-refresh]")) {
      try {
        setBusy(true);
        await load();
      } catch (error) {
        showError(error.message || String(error));
        render();
      }
      return;
    }
    if (event.target.closest("[data-ccm-refresh-history]")) {
      try {
        setBusy(true);
        await refreshHistory();
      } catch (error) {
        showError(error.message || String(error));
        render();
      }
      return;
    }
    if (event.target.closest("[data-ccm-preview]")) {
      const reason = root.querySelector("[data-ccm-reason]")?.value.trim() || "";
      try {
        setBusy(true);
        const result = await request(`/api/tasks/${encodeURIComponent(state.taskId)}/sessions/${encodeURIComponent(state.sessionId)}/candidate-changes/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceType: state.mode,
            reason,
            candidates: state.workingRoster,
            clearRooms: state.clearRooms,
            syncAddedToTrial: state.syncAddedToTrial,
          }),
        });
        state.changeSet = result.changeSet;
        state.canApply = result.canApply;
        state.data.changes = [result.changeSet, ...(state.data.changes || []).filter((change) => change.id !== result.changeSet.id)];
        state.activeTab = "preview";
        render();
      } catch (error) {
        showError(error.message || String(error), { title: "差异生成失败" });
        render();
      }
      return;
    }
    if (event.target.closest("[data-ccm-apply]")) {
      const checks = [...root.querySelectorAll("[data-ccm-confirm-check]")];
      if (!checks.every((check) => check.checked)) {
        showError("请先完成三项人工核对。", { title: "尚未完成确认" });
        return;
      }
      const confirmed = await showConfirm(
        `确认执行 ${changeSetActionCount(state.changeSet)} 项考生变更？执行前会再次校验线上名单版本。`,
        { title: "确认执行考生变更", confirmText: "提交执行", danger: true },
      );
      if (!confirmed) return;
      try {
        setBusy(true);
        const result = await request(`/api/tasks/${encodeURIComponent(state.taskId)}/sessions/${encodeURIComponent(state.sessionId)}/candidate-changes/${encodeURIComponent(state.changeSet.id)}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
        state.changeSet = result.changeSet;
        await load();
        state.activeTab = "history";
        render();
      } catch (error) {
        if (error.data?.changeSet) state.changeSet = error.data.changeSet;
        showError(error.message || String(error), { title: "考生变更未完全执行" });
        await load().catch(() => {});
        state.activeTab = "history";
        render();
      }
    }
  });

  topbar?.addEventListener("click", (event) => {
    if (event.target.closest("[data-ccm-back]")) {
      navigate(`/exams/${encodeURIComponent(state.taskId)}`);
    }
  });

  return {
    name: "candidate-changes",
    roots: [topbar, root].filter(Boolean),
    enter: async () => {
      try {
        await load();
      } catch (error) {
        showError(error.message || String(error), { title: "考生名单读取失败" });
        navigate(`/exams/${encodeURIComponent(state.taskId || "")}`);
      }
    },
  };
}
