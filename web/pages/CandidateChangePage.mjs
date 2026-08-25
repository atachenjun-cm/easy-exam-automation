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

function contactText(candidate = {}) {
  return candidate.email || candidate.mobile || "--";
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
} = {}) {
  const state = {
    taskId: "",
    sessionId: "",
    data: null,
    activeTab: "roster",
    mode: "full_list",
    search: "",
    workingRoster: [],
    parsedFileName: "",
    parseSummary: null,
    changeSet: null,
    canApply: false,
    busy: false,
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
    const task = state.data?.task || {};
    const session = state.data?.session || {};
    topbar.innerHTML = `
      <div>
        <h1>考生变更管理</h1>
        <p class="subtitle">${escapeHtml(task.projectName || "考试项目")} · ${escapeHtml(session.name || "目标场次")}</p>
      </div>
      <div class="view-actions">
        <button class="btn" type="button" data-ccm-original-import>首次导入页面</button>
        <button class="btn" type="button" data-ccm-back>返回考试详情</button>
      </div>`;
  }

  function contextHtml() {
    const session = state.data?.session || {};
    const task = state.data?.task || {};
    const phase = state.data?.phase;
    return `
      <section class="ccm-context" aria-label="当前考试场次">
        <div><span>考试项目</span><strong>${escapeHtml(task.examName || task.projectName || "--")}</strong></div>
        <div><span>目标场次</span><strong>${escapeHtml(session.sessionType === "trial" ? "试考" : "正式考试")}</strong></div>
        <div><span>考试时间</span><strong>${escapeHtml(session.start || "--")}</strong></div>
        <div><span>当前阶段</span><strong class="${phase === "not_started" ? "ccm-ok" : "ccm-danger"}">${phase === "not_started" ? "未开考" : phase === "started" ? "考试进行中" : "考试已结束"}</strong></div>
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
    const rows = (state.data?.candidates || []).filter((candidate) => {
      const query = state.search.trim().toLowerCase();
      if (!query) return true;
      return [candidate.full_name, candidate.permit, candidate.email, candidate.mobile]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
    const pendingCount = (state.data?.changes || []).filter((change) => change.status === "waiting_review").length;
    return `
      <div class="ccm-summary">
        <div><span>线上考生</span><strong>${Number(state.data?.candidates?.length || 0)}</strong></div>
        <div><span>已分班</span><strong>${Number(state.data?.session?.roomCount || 0)} 班</strong></div>
        <div><span>待审核变更</span><strong class="ccm-warn">${pendingCount}</strong></div>
        <div><span>名单版本</span><strong>${escapeHtml(String(state.data?.rosterHash || "").slice(0, 8).toUpperCase())}</strong></div>
      </div>
      <div class="ccm-toolbar">
        <label class="ccm-search"><span class="sr-only">搜索考生</span><input class="field-input" type="search" data-ccm-search value="${escapeHtml(state.search)}" placeholder="姓名或准考证号"></label>
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
              <td>${escapeHtml(candidate.course_name || candidate.course_code || "--")}</td>
              <td>${escapeHtml(contactText(candidate))}</td>
              <td>${escapeHtml(candidate.exam_status || "未开考")}</td>
            </tr>`).join("") : '<tr><td colspan="5" class="ccm-empty">没有符合条件的考生</td></tr>'}</tbody>
        </table>
      </div>
      <p class="ccm-footnote">线上校验时间：${escapeHtml(formatTime(state.data?.checkedAt))}。名单数据来自当前易考场次，不使用文件缓存生成变更。</p>`;
  }

  function workingRosterTable() {
    const rows = state.workingRoster || [];
    return `
      <div class="ccm-table-wrap ccm-working-table">
        <table class="ccm-table">
          <thead><tr><th>考生</th><th>准考证号</th><th>科目编号</th><th>联系方式</th><th>操作</th></tr></thead>
          <tbody>${rows.length ? rows.slice(0, 100).map((candidate) => `
            <tr>
              <td><strong>${escapeHtml(candidate.full_name || "--")}</strong></td>
              <td><code>${escapeHtml(candidate.permit)}</code></td>
              <td>${escapeHtml(candidate.course_code || "--")}</td>
              <td>${escapeHtml(contactText(candidate))}</td>
              <td><div class="ccm-row-actions"><button type="button" class="btn" data-ccm-edit="${escapeHtml(candidate.permit)}">编辑</button><button type="button" class="btn danger" data-ccm-delete="${escapeHtml(candidate.permit)}">删除</button></div></td>
            </tr>`).join("") : '<tr><td colspan="5" class="ccm-empty">名单为空</td></tr>'}</tbody>
        </table>
      </div>
      ${rows.length > 100 ? `<p class="ccm-footnote">当前共 ${rows.length} 人，表格先显示前 100 人；差异计算仍包含全部考生。</p>` : ""}`;
  }

  function createHtml() {
    const parsed = state.parseSummary;
    return `
      <div class="ccm-create-head">
        <div class="ccm-segmented" aria-label="变更录入方式">
          <button type="button" class="${state.mode === "full_list" ? "is-active" : ""}" data-ccm-mode="full_list">上传最新版名单</button>
          <button type="button" class="${state.mode === "manual" ? "is-active" : ""}" data-ccm-mode="manual">逐条增删改</button>
        </div>
        <span>基线：线上名单 ${Number(state.data?.candidates?.length || 0)} 人</span>
      </div>
      <div class="ccm-create-grid">
        <section class="ccm-section">
          <div class="ccm-section-head"><h2>${state.mode === "full_list" ? "最新版完整名单" : "变更后的完整名单"}</h2>${state.mode === "manual" ? '<button type="button" class="btn" data-ccm-add>新增考生</button>' : ""}</div>
          <div class="ccm-section-body">
            ${state.mode === "full_list" ? `
              <label class="ccm-upload ${state.parsedFileName ? "has-file" : ""}">
                <input type="file" data-ccm-file accept=".xlsx,.xls,.csv">
                <strong>${escapeHtml(state.parsedFileName || "选择最新版完整名单")}</strong>
                <span>${parsed ? `已识别 ${parsed.total} 人，解析错误 ${parsed.errors} 项` : "支持 .xlsx、.xls、.csv；上传后只生成差异，不直接导入。"}</span>
              </label>` : `
              <div class="ccm-notice">在当前线上名单副本中编辑。保存后先生成差异，不会立即修改易考。</div>`}
            ${state.mode === "manual" || state.parsedFileName ? workingRosterTable() : ""}
          </div>
        </section>
        <aside class="ccm-section">
          <div class="ccm-section-head"><h2>提交信息</h2></div>
          <div class="ccm-section-body">
            <label class="ccm-field"><span>目标场次</span><input class="field-input" value="${escapeHtml(state.data?.session?.name || "")}" disabled></label>
            <label class="ccm-field"><span>变更原因</span><textarea class="field-input" rows="4" data-ccm-reason placeholder="填写本次增删改原因"></textarea></label>
            <div class="ccm-notice is-warning">最新版名单中缺失的考生只会列为“拟删除”；必须在差异页逐项核对后才能执行。</div>
            <button type="button" class="btn primary ccm-block" data-ccm-preview ${state.workingRoster.length ? "" : "disabled"}>生成差异预览</button>
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
            <div><strong>班级分配</strong><span>${changeSet.impact?.room_assignment === "needs_preview" ? "执行后需要重新预览分班" : "不受影响"}</span></div>
            <div><strong>监考人员任务</strong><span>${changeSet.impact?.personnel_task === "pending_review" ? "标记为变更待检查" : "不受影响"}</span></div>
            <div><strong>考生通知</strong><span>本次不会自动发送短信或邮件</span></div>
            <div><strong>腾讯文档</strong><span>${changeSet.impact?.tencent_docs === "pending_sync" ? "线上回读后标记待同步" : "不受影响"}</span></div>
          </div>
        </section>
        <aside class="ccm-section">
          <div class="ccm-section-head"><h2>人工确认</h2></div>
          <div class="ccm-section-body ccm-confirm-list">
            <label><input type="checkbox" data-ccm-confirm-check>已核对全部拟删除考生</label>
            <label><input type="checkbox" data-ccm-confirm-check>已核对科目及准考证号变化</label>
            <label><input type="checkbox" data-ccm-confirm-check>同意执行后重新检查分班和任务单</label>
            ${!allConfirmed ? `<div class="ccm-notice is-danger">${Number(summary.blocked || 0) ? `有 ${Number(summary.blocked)} 项因考试状态被阻止。` : "当前场次已经开始或结束，名单结构已冻结。"}</div>` : ""}
            <button type="button" class="btn primary ccm-block" data-ccm-apply ${allConfirmed ? "" : "disabled"}>确认并执行 ${items.length} 项变更</button>
            <p class="ccm-footnote">执行前会再次读取易考名单并校验版本；名单已变化时自动停止。</p>
          </div>
        </aside>
      </div>`;
  }

  function historyHtml() {
    const changes = state.data?.changes || [];
    return `
      <div class="ccm-history-head"><div><h2>变更记录</h2><p>保留提交原因、名单基线、逐项结果和线上回读状态。</p></div><button type="button" class="btn" data-ccm-refresh-history>刷新</button></div>
      <div class="ccm-table-wrap">
        <table class="ccm-table">
          <thead><tr><th>变更单</th><th>提交时间</th><th>来源</th><th>变更范围</th><th>状态</th><th>操作人</th></tr></thead>
          <tbody>${changes.length ? changes.map((change) => `
            <tr>
              <td><code>${escapeHtml(change.id)}</code><div class="ccm-table-sub">${escapeHtml(change.reason || "未填写原因")}</div></td>
              <td>${escapeHtml(formatTime(change.createdAt))}</td>
              <td>${change.sourceType === "manual" ? "逐条增删改" : "完整名单"}</td>
              <td>新增 ${Number(change.summary?.add || 0)} · 修改 ${Number(change.summary?.edit || 0)} · 删除 ${Number(change.summary?.delete || 0)}</td>
              <td>${statusBadge(change.status)}${change.error ? `<div class="ccm-table-error">${escapeHtml(change.error)}</div>` : ""}</td>
              <td>${escapeHtml(change.createdBy || "--")}</td>
            </tr>`).join("") : '<tr><td colspan="6" class="ccm-empty">暂无考生变更记录</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  function editorDialogHtml() {
    return `
      <dialog class="ccm-editor-dialog" data-ccm-editor-dialog>
        <form method="dialog" class="ccm-editor-form">
          <div class="ccm-editor-head"><h2 data-ccm-editor-title>编辑考生</h2><button type="button" class="btn" data-ccm-editor-close>关闭</button></div>
          <div class="ccm-editor-fields">
            <label class="ccm-field"><span>准考证号</span><input class="field-input" name="permit" required></label>
            <label class="ccm-field"><span>姓名</span><input class="field-input" name="full_name" required></label>
            <label class="ccm-field"><span>身份证号</span><input class="field-input" name="identity_id"></label>
            <label class="ccm-field"><span>科目编号</span><input class="field-input" name="course_code"></label>
            <label class="ccm-field"><span>手机号</span><input class="field-input" name="mobile"></label>
            <label class="ccm-field"><span>邮箱</span><input class="field-input" name="email" type="email"></label>
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
    for (const field of ["permit", "full_name", "identity_id", "course_code", "mobile", "email"]) {
      form.elements[field].value = candidate?.[field] || "";
    }
    dialog.showModal();
    form.elements.permit.focus();
  }

  async function load() {
    const query = new URLSearchParams(window.location.search);
    state.taskId = String(query.get("taskId") || "").trim();
    state.sessionId = String(query.get("sessionId") || "").trim();
    if (!state.taskId || !state.sessionId) throw new Error("缺少考试任务或场次参数。");
    root.innerHTML = '<div class="ccm-loading">正在读取易考线上名单...</div>';
    state.data = await request(`/api/tasks/${encodeURIComponent(state.taskId)}/sessions/${encodeURIComponent(state.sessionId)}/candidate-roster?_=${Date.now()}`);
    state.workingRoster = cloneRows(state.data.candidates);
    state.changeSet = null;
    state.activeTab = "roster";
    render();
  }

  async function refreshHistory() {
    const data = await request(`/api/tasks/${encodeURIComponent(state.taskId)}/sessions/${encodeURIComponent(state.sessionId)}/candidate-changes?_=${Date.now()}`);
    state.data.changes = data.changes || [];
    render();
  }

  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-ccm-search]")) return;
    state.search = event.target.value;
    const selection = event.target.selectionStart;
    render();
    const input = root.querySelector("[data-ccm-search]");
    input?.focus();
    input?.setSelectionRange(selection, selection);
  });

  root.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-ccm-file]");
    if (!input?.files?.[0]) return;
    try {
      setBusy(true);
      const file = input.files[0];
      const response = await fetch(`${apiBase}/api/candidates/parse?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: await file.arrayBuffer(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "名单解析失败");
      if (Array.isArray(data.errors) && data.errors.length) throw new Error(data.errors.join("\n"));
      state.parsedFileName = data.filename || file.name;
      state.workingRoster = cloneRows(data.candidates || []);
      state.parseSummary = { total: state.workingRoster.length, errors: Number(data.errors?.length || 0) };
      render();
    } catch (error) {
      showError(error.message || String(error), { title: "名单解析失败" });
      render();
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target.closest(".ccm-editor-form");
    if (!form) return;
    event.preventDefault();
    const candidate = Object.fromEntries(new FormData(form).entries());
    candidate.custom_fields = {};
    const originalPermit = form.dataset.originalPermit;
    const duplicate = state.workingRoster.find((row) => row.permit === candidate.permit && row.permit !== originalPermit);
    if (duplicate) {
      showError(`准考证号 ${candidate.permit} 已存在。`);
      return;
    }
    if (originalPermit) {
      state.workingRoster = state.workingRoster.map((row) => row.permit === originalPermit ? { ...row, ...candidate } : row);
    } else {
      state.workingRoster = [...state.workingRoster, candidate];
    }
    form.closest("dialog").close();
    render();
  });

  root.addEventListener("click", async (event) => {
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
    if (event.target.closest("[data-ccm-original-import]")) {
      navigate(`/candidate-import?taskId=${encodeURIComponent(state.taskId)}&sessionId=${encodeURIComponent(state.sessionId)}`);
      return;
    }
    if (event.target.closest("[data-ccm-new-change]")) {
      state.activeTab = "create";
      state.workingRoster = cloneRows(state.data.candidates);
      state.parsedFileName = "";
      state.parseSummary = null;
      render();
      return;
    }
    const mode = event.target.closest("[data-ccm-mode]");
    if (mode) {
      state.mode = mode.dataset.ccmMode;
      state.workingRoster = cloneRows(state.data.candidates);
      state.parsedFileName = "";
      state.parseSummary = null;
      render();
      return;
    }
    if (event.target.closest("[data-ccm-add]")) {
      openEditor();
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
      if (await showConfirm(`确认将 ${candidate?.full_name || candidate?.permit} 列为拟删除考生？`, { confirmText: "列为拟删除", danger: true })) {
        state.workingRoster = state.workingRoster.filter((row) => row.permit !== remove.dataset.ccmDelete);
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
          body: JSON.stringify({ sourceType: state.mode, reason, candidates: state.workingRoster }),
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
        `确认执行 ${state.changeSet.items.length} 项考生变更？执行前会再次校验线上名单版本。`,
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
      return;
    }
    if (event.target.closest("[data-ccm-original-import]")) {
      navigate(`/candidate-import?taskId=${encodeURIComponent(state.taskId)}&sessionId=${encodeURIComponent(state.sessionId)}`);
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
