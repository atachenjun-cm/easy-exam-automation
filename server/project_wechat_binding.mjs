function text(value) {
  return String(value ?? "").trim();
}

function first(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizedBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (["是", "需要", "开启", "开启录制", "启用", "true", "yes", "1"].includes(normalized)) return true;
  if (["否", "不需要", "无需", "关闭", "关闭录制", "禁用", "false", "no", "0"].includes(normalized)) return false;
  return value;
}

function projectRequirementSnapshot(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements[0] || {};
  return task.config?.examRequirement || {};
}

function displayRange(start, end) {
  const normalizedStart = text(start);
  const normalizedEnd = text(end);
  return normalizedStart && normalizedEnd ? `${normalizedStart}-${normalizedEnd}` : "";
}

export function projectWechatRequirementRequestId(taskId) {
  return `wechat-project-${text(taskId)}`;
}

export function buildProjectWechatRequirementSeed(task = {}) {
  const snapshot = projectRequirementSnapshot(task);
  const fields = snapshot.fields || {};
  const config = snapshot.config || task.config || {};
  const courses = Array.isArray(config.courses) ? config.courses : [];
  return {
    exam_name: first(fields["考试名称"], config.examName, task.projectName),
    formal_exam_time_range: first(
      fields["考试日期时间"],
      displayRange(config.startTimeDisplay, config.endTimeDisplay),
    ),
    mock_exam_time_range: first(
      fields["试考日期时间"],
      displayRange(config.mockStartTimeDisplay, config.mockEndTimeDisplay),
    ),
    early_login_minutes: first(fields["提前登录时间"], config.earlyLoginMinutes),
    late_limit_minutes: first(fields["限制迟到时间"], config.lateLimitMinutes),
    time_rule: first(fields["试卷扣时规则"], config.timeRule),
    exam_address: first(fields["考试地址"], config.examAddress),
    pre_login_prompt: first(fields["考前等待提示"], config.preLoginPrompt),
    welcome_text: first(fields["欢迎语"], config.welcomeText),
    pledge_content: first(fields["考试承诺书内容"], config.pledgeContent),
    video_monitor_required: normalizedBoolean(fields["视频监控"] ?? config.videoMonitor),
    video_record_required: normalizedBoolean(fields["视频录制"] ?? config.videoRecord),
    hawkeye_required: normalizedBoolean(fields["鹰眼监控"] ?? config.hawkeye),
    exam_client_type: first(fields["考试类型"], config.examType),
    client_login_limit: first(fields["登陆次数"], config.clientLoginLimit),
    manual_score_text: first(fields["人工判分"], config.manualScoreText),
    paper_names: splitList(fields["试卷名称"]).length
      ? splitList(fields["试卷名称"])
      : courses.map((course) => first(course.paper_name, course.paperName)).filter(Boolean),
    subjects: splitList(fields["科目信息"]).length ? splitList(fields["科目信息"]) : splitList(config.subjects),
    watermark_enabled: config.watermark,
    copy_forbidden: config.disableCopy,
    leave_limit_count: config.leaveLimit,
    u8_code: first(config.u8Code, task.config?.businessRequirement?.u8_code),
    project_manager: first(config.projectManager, task.config?.businessRequirement?.project_manager),
    customer_name: first(config.customerName, task.config?.customerName, task.config?.businessRequirement?.customer_name),
    candidate_count: config.candidateCount,
  };
}

export function createProjectWechatBindingResolver(options = {}) {
  const getTask = options.getTask;
  const canAccessTask = options.canAccessTask || (() => true);
  const getRequirement = options.getRequirement;
  const upsertRequirement = options.upsertRequirement;
  const updateTask = options.updateTask;

  return async function resolveProjectBinding({ taskId, payload = {}, req } = {}) {
    const normalizedTaskId = text(taskId);
    const task = normalizedTaskId && getTask ? await getTask(normalizedTaskId) : null;
    if (!task || !(await canAccessTask(task, req))) {
      return { ok: false, status: 404, error: "未找到可访问的项目" };
    }
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    if (groups.length !== 1) {
      return { ok: false, status: 400, error: "每个项目只能绑定一个微信群" };
    }
    const sourceGroup = groups[0] || {};
    const groupName = first(sourceGroup.groupName, sourceGroup.group_name);
    if (!groupName) return { ok: false, status: 400, error: "请填写本项目微信群名称" };

    const projectName = first(task.projectName, task.config?.businessRequirement?.project_name);
    if (!projectName) return { ok: false, status: 400, error: "当前项目缺少项目名称" };
    const requirementRequestId = first(
      task.config?.requirementRequestId,
      task.config?.initialRequirementRequestId,
      task.config?.businessRequirement?.requirementRequestId,
      projectWechatRequirementRequestId(normalizedTaskId),
    );
    const customerName = first(
      sourceGroup.customerName,
      sourceGroup.customer_name,
      task.config?.businessRequirement?.customer_name,
      task.config?.customerName,
    );
    const canonicalGroup = {
      ...sourceGroup,
      taskId: normalizedTaskId,
      groupName,
      projectName,
      customerName,
      requirementRequestId,
    };
    const resolvedPayload = {
      ...payload,
      project: { taskId: normalizedTaskId, projectName, customerName, requirementRequestId },
      groups: [canonicalGroup],
    };

    return {
      ok: true,
      payload: resolvedPayload,
      async commit() {
        let requirement = getRequirement ? await getRequirement(requirementRequestId) : null;
        if (!requirement && upsertRequirement) {
          requirement = await upsertRequirement({
            requestId: requirementRequestId,
            customer: { name: customerName },
            requirement: buildProjectWechatRequirementSeed(task),
            source: "project_wechat_binding",
            message: "项目首次绑定微信群，建立易考需求基线",
          });
        }
        const taskNeedsLink = text(task.config?.requirementRequestId) !== requirementRequestId;
        const updatedTask = taskNeedsLink && updateTask
          ? await updateTask(normalizedTaskId, { requirementRequestId })
          : task;
        return { task: updatedTask, requirement, requirementRequestId };
      },
    };
  };
}
