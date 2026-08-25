const TRUE_VALUES = new Set(["是", "需要", "开启", "开启录制", "启用", "true", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["否", "不需要", "无需", "关闭", "禁用", "false", "no", "n", "0"]);

const CONFIG_SELECTION_IDS = new Set([
  "allow_anonymous", "anonymous_unique", "anonymous_phone", "anonymous_email",
  "unique_phone_as_permit", "unique_identity_id_as_permit", "ip_white_list", "practice_mode",
  "nda", "entry_review", "id_card_review", "around_review", "monitor", "save_video",
  "login_validation", "face_detection_dur", "ai_gaze", "eagle_eye", "no_interfere", "eagle_eye2",
  "desktop_monitor", "desktop_monitor_video", "lock_screen", "client_required", "app_required",
  "exclusive_network", "check_bluetooth", "smart_input_disabled", "watermark", "copy_item_unable",
  "show_point", "public_score", "show_score_detail", "force_no_score", "re_answer",
  "answer_save_high", "answer_save", "wrong_practice", "force_prohibit_retry", "datum_line",
  "manual_score", "send_result_email",
]);

function boundedInteger(value, fallback, min, max) {
  const parsed = normalizeInteger(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function buildSessionOptionsFromConfigSelection(selection = {}) {
  const explicit = selection?.explicit === true;
  if (!explicit) return { explicit: false, public: {}, pendingInternal: [] };

  const selected = new Set(
    (Array.isArray(selection.selectedIds) ? selection.selectedIds : [])
      .map((id) => normalizeText(id))
      .filter((id) => CONFIG_SELECTION_IDS.has(id)),
  );
  const values = selection.values && typeof selection.values === "object" && !Array.isArray(selection.values)
    ? selection.values
    : {};
  const enabled = (id) => selected.has(id);
  const loginMode = normalizeText(values.loginMode) === "manual" ? "manual" : "auto";
  const loginMethod = ["registration_photo", "public_security", "post_exam_public_security"].includes(values.loginMethod)
    ? values.loginMethod
    : "registration_photo";
  const lockMode = normalizeText(values.lockMode) === "client" ? "client" : "web";
  const manualScoreMode = normalizeText(values.manualScoreMode) === "new" ? "new" : "legacy";
  const desktopClientRequired = enabled("lock_screen") && lockMode === "client" && enabled("client_required");
  const publicOptions = {
    allow_anonymous: enabled("allow_anonymous"),
    anonymous_unique: enabled("anonymous_unique"),
    ip_white_list: enabled("ip_white_list"),
    ip_white_list_str: enabled("ip_white_list") ? normalizeText(values.ipWhiteList) : "",
    practice_mode: enabled("practice_mode"),
    nda: enabled("nda"),
    entry_review: enabled("entry_review"),
    id_card_review: enabled("id_card_review"),
    around_review: enabled("around_review"),
    monitor: enabled("monitor"),
    save_video: enabled("save_video"),
    face_detection: enabled("login_validation") && loginMode === "auto" && loginMethod === "registration_photo",
    face_detection_review: false,
    photo_review: enabled("login_validation") && loginMode === "manual",
    police_detection: enabled("login_validation") && loginMode === "auto" && loginMethod === "public_security",
    police_detection_after: enabled("login_validation") && loginMode === "auto" && loginMethod === "post_exam_public_security",
    face_detection_dur: enabled("face_detection_dur"),
    eagle_eye: enabled("eagle_eye"),
    no_interfere: enabled("no_interfere"),
    eagle_eye2: enabled("eagle_eye2"),
    desktop_monitor: enabled("desktop_monitor"),
    desktop_monitor_video: enabled("desktop_monitor_video"),
    lock_screen: enabled("lock_screen"),
    client_required: desktopClientRequired,
    app_required: enabled("lock_screen") && lockMode === "client" && !desktopClientRequired && enabled("app_required"),
    exclusive_network: desktopClientRequired && enabled("exclusive_network"),
    check_bluetooth: desktopClientRequired && enabled("check_bluetooth"),
    smart_input_disabled: desktopClientRequired && enabled("smart_input_disabled"),
    watermark: enabled("watermark"),
    copy_item_unable: enabled("copy_item_unable"),
    show_point: enabled("show_point"),
    public_score: enabled("public_score"),
    show_score_detail: enabled("show_score_detail"),
    force_no_score: enabled("force_no_score"),
    re_answer: enabled("re_answer"),
    answer_save_high: enabled("answer_save_high"),
    answer_save: enabled("answer_save"),
    wrong_practice: enabled("wrong_practice"),
    force_prohibit_retry: enabled("force_prohibit_retry"),
    datum_line: enabled("datum_line"),
    manual_score: enabled("manual_score"),
    new_mark: enabled("manual_score") && manualScoreMode === "new",
    send_result_email: enabled("send_result_email"),
    result_email_address: enabled("send_result_email") ? normalizeText(values.resultEmail) : "",
  };
  if (enabled("lock_screen")) {
    publicOptions.login_times = boundedInteger(values.loginTimes, 5, 1, 99);
    if (lockMode === "web") {
      publicOptions.lock_screen_exit_sec = boundedInteger(values.webLeaveSeconds, 5, 1, 99);
      publicOptions.lock_screen_time = boundedInteger(values.webLeaveTimes, 5, 1, 99);
    }
  }
  if (enabled("re_answer")) {
    publicOptions.re_answer_times = boundedInteger(values.reAnswerTimes, 1, 1, 99);
  }
  if (enabled("datum_line")) {
    publicOptions.datum_score = boundedInteger(values.passingScore, 60, 0, 100);
  }

  const pendingInternal = [];
  if (enabled("anonymous_unique")) {
    pendingInternal.push({
      id: "anonymous_unique",
      label: "注册验证方式",
      value: normalizeText(values.anonymousMethod) === "anonymous_email" ? "邮箱" : "手机号",
      fields: ["anonymous_unique_field"],
    });
  }
  if (enabled("unique_phone_as_permit")) {
    pendingInternal.push({
      id: "unique_phone_as_permit",
      label: "手机号作为准考证号",
      value: "开启",
      fields: ["unique_phone_as_permit"],
    });
  }
  if (enabled("unique_identity_id_as_permit")) {
    pendingInternal.push({
      id: "unique_identity_id_as_permit",
      label: "身份证号作为准考证号",
      value: "开启",
      fields: ["unique_identity_id_as_permit"],
    });
  }
  if (enabled("face_detection_dur")) {
    pendingInternal.push({
      id: "face_detection_dur",
      label: "作弊侦测版本",
      value: normalizeText(values.detectionLevel) === "advanced" ? "升级版 AI" : "基础版 AI",
      fields: ["ai_face_compare", "ai_detection"],
    });
  }
  if (enabled("ai_gaze")) {
    pendingInternal.push({ id: "ai_gaze", label: "视线追踪", value: "开启", fields: ["ai_gaze"] });
  }

  return { explicit: true, public: publicOptions, pendingInternal };
}

export function buildAutoConfigFromRequirement(requirement = {}, options = {}) {
  const warnings = [];
  const formalRange = parseDateTimeRange(requirement.formal_exam_time_range);
  const mockRange = parseDateTimeRange(requirement.mock_exam_time_range);
  const subjects = normalizeSubjects(requirement.subjects || requirement.subjects_text);
  const paperNames = normalizeSubjects(requirement.paper_names || requirement.paper_names_text);
  const examType = normalizeExamType(requirement.exam_client_type);
  const courses = buildUncreatedCourses(subjects, paperNames);
  const sessionOptions = buildSessionOptionsFromConfigSelection(options.configSelection);

  if (!requirement.exam_name) warnings.push("缺少考试名称。");
  if (!formalRange.start || !formalRange.end) warnings.push("正式考试时间无法解析。");
  if (requirement.mock_exam_time_range && (!mockRange.start || !mockRange.end)) warnings.push("试考时间无法解析，试考自动创建会跳过。");
  if (!requirement.mock_exam_time_range) warnings.push("未读取到试考时间，试考自动创建会跳过。");
  if (!subjects.length) warnings.push("未读取到科目信息，批量导入科目步骤会跳过。");
  if (paperNames.length && paperNames.length !== subjects.length) warnings.push("试卷名称数量与科目数量不一致，请按科目顺序逐项填写。");
  if (sessionOptions.pendingInternal.length) {
    warnings.push(`以下配置需报备后人工开启：${sessionOptions.pendingInternal.map((item) => item.label).join("、")}。`);
  }

  const config = {
    examName: normalizeText(requirement.exam_name),
    u8Code: normalizeText(requirement.u8_code),
    projectManager: normalizeText(requirement.project_manager),
    customerName: normalizeText(options.customerName || requirement.customer_name),
    candidateCount: normalizeInteger(requirement.candidate_count) ?? "",
    startTimeDisplay: formatDisplayDateTime(formalRange.start),
    endTimeDisplay: formatDisplayDateTime(formalRange.end),
    startTimeIso: formatIsoDateTime(formalRange.start),
    endTimeIso: formatIsoDateTime(formalRange.end),
    earlyLoginMinutes: normalizeInteger(requirement.early_login_minutes),
    lateLimitMinutes: normalizeInteger(requirement.late_limit_minutes),
    timeRule: normalizeText(requirement.time_rule),
    examAddress: normalizeText(requirement.exam_address),
    unifiedExamAddress: normalizeText(requirement.exam_address) === "统一考试地址",
    preLoginPrompt: normalizeRichText(requirement.pre_login_prompt),
    welcomeText: normalizeText(requirement.welcome_text),
    pledgeContent: normalizeRichText(requirement.pledge_content),
    videoMonitor: normalizeBoolean(requirement.video_monitor_required),
    videoRecord: normalizeBoolean(requirement.video_record_required),
    loginVerifyMode: "考后公安验证",
    hawkeye: normalizeBoolean(requirement.hawkeye_required),
    examType,
    clientExam: examType === "客户端考试",
    webExam: examType === "网页考试",
    leaveLimit: normalizeInteger(requirement.leave_limit_count),
    clientLoginLimit: normalizeInteger(requirement.client_login_limit) || 10,
    manualScore: normalizeEnabledText(requirement.manual_score_text),
    manualScoreText: normalizeText(requirement.manual_score_text),
    watermark: normalizeBoolean(requirement.watermark_enabled),
    disableCopy: normalizeBoolean(requirement.copy_forbidden),
    subjects,
    courses,
    subjectImportPath: "",
    mockExamEnabled: Boolean(mockRange.start && mockRange.end),
    mockExamName: requirement.exam_name ? `${normalizeText(requirement.exam_name)}-试考` : "",
    mockStartTimeDisplay: formatDisplayDateTime(mockRange.start),
    mockEndTimeDisplay: formatDisplayDateTime(mockRange.end),
    mockStartTimeIso: formatIsoDateTime(mockRange.start),
    mockEndTimeIso: formatIsoDateTime(mockRange.end),
    visibleFields: ["姓名", "身份证号"],
    editableFields: [],
    requiredFields: [],
    confirmOnly: true,
    sessionOptions,
  };

  return { config, warnings };
}

export function buildAutoConfigPreviewRows(config = {}) {
  const rows = [];
  const add = (stage, item, value, action) => {
    rows.push([stage, item, value || "空", action]);
  };
  const subjects = Array.isArray(config.subjects)
    ? config.subjects.map((subject) => normalizeText(subject)).filter(Boolean)
    : [];
  const visibleFields = Array.isArray(config.visibleFields)
    ? config.visibleFields.map((field) => normalizeText(field)).filter(Boolean)
    : ["姓名", "身份证号"];

  add("基础信息", "考试名称", config.examName, "自动填写");
  add(
    "基础信息",
    "考试时间",
    `${config.startTimeDisplay || ""} 至 ${config.endTimeDisplay || ""}`,
    "人工核对",
  );
  add("基础信息", "提前登录时间", `${config.earlyLoginMinutes || 0} 分钟`, "自动填写");
  add("基础信息", "限制迟到时间", `${config.lateLimitMinutes || 0} 分钟`, "自动填写");
  add("基础信息", "试卷扣时规则", config.timeRule || "系统默认", "自动选择");
  add("基础信息", "考试地址", config.examAddress || "系统默认", "按需求单选择");
  add("基础信息", "考前等待提示", config.preLoginPrompt || "空", "自动填写");
  add("基础信息", "欢迎语", config.welcomeText || "空", "自动填写");
  add("科目管理", "批量导入科目", subjects.join("、") || "空", "自动生成");
  add("选择试卷", "跳过试卷设置", "是", "自动跳过");
  add("个人信息", "考生可见字段", visibleFields.join(", ") || "无", "自动勾选");
  add("个人信息", "允许编辑字段", "无", "自动取消");
  add("个人信息", "必填字段", "无", "自动取消");
  add("开考前", "考试承诺书", config.pledgeContent || "否", "自动填写");
  add(
    "考试中",
    "视频监控/录制",
    `${config.videoMonitor ? "是" : "否"} / ${config.videoRecord ? "是" : "否"}`,
    "自动勾选",
  );
  if (config.videoMonitor) {
    add("考试中", "登录验证", "自动验证；考后公安验证", "视频监控默认启用");
    add("考试中", "作弊侦测", "基础版AI", "视频监控默认启用");
  }
  add("考试中", "鹰眼监控", config.hawkeye ? "是" : "否", "自动勾选");
  add(
    "考试中",
    "锁定考试",
    config.clientExam
      ? `客户端考试；登录限制 ${config.clientLoginLimit} 次`
      : config.webExam && config.leaveLimit !== null && config.leaveLimit !== undefined
        ? `网页考试；允许离开 ${config.leaveLimit} 次`
        : "否",
    "自动勾选",
  );
  add("考试中", "答题水印", config.watermark ? "是" : "否", "自动勾选");
  add("考试中", "禁止复制", config.disableCopy ? "是" : "否", "自动勾选");
  add("考试后", "人工判分", config.manualScoreText || (config.manualScore ? "是" : "否"), "按需求单配置");
  if (config.mockExamEnabled) {
    add("试考", "试考名称", config.mockExamName, "自动新建");
    add(
      "试考",
      "试考时间",
      `${config.mockStartTimeDisplay || ""} 至 ${config.mockEndTimeDisplay || ""}`,
      "自动填写",
    );
    add("试考", "提前登录时间", "不设置", "自动跳过");
    add("试考", "限制迟到时间", "不设置", "自动跳过");
    add("试考", "试卷扣时规则", "不扣时", "自动选择");
    add("试考", "科目设置", "跳过", "自动跳过");
  }
  add("完成", "最终创建", "点击创建完成", "自动创建");
  return rows;
}

export function parseDateTimeRange(value) {
  const text = normalizeText(value);
  if (!text) return { start: null, end: null };
  const flexibleRange = parseFlexibleDateTimeRange(text);
  if (flexibleRange.start && flexibleRange.end) return flexibleRange;
  const matches = [...text.matchAll(/(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s+(\d{1,2}:\d{2})(?::\d{2})?/g)];
  if (matches.length < 2) return { start: null, end: null };
  return {
    start: parseDateTime(`${matches[0][1]} ${matches[0][2]}`),
    end: parseDateTime(`${matches[1][1]} ${matches[1][2]}`),
  };
}

function normalizeDateTimeText(value) {
  return normalizeText(value)
    .replace(/[：]/g, ":")
    .replace(/[－–—~～]/g, "-")
    .replace(/到|至/g, "-")
    .replace(/\s*:\s*/g, ":")
    .replace(/([0-2]?\d)\s*[点时]\s*半/g, "$1:30")
    .replace(/([0-2]?\d)\s*[点时](?!\s*半)/g, "$1:00")
    .replace(/分/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dateMatchToParts(match) {
  const offset = match.length >= 5 ? 1 : 0;
  const year = match[offset + 1] ? Number(match[offset + 1]) : new Date().getFullYear();
  return { year, month: Number(match[offset + 2]), day: Number(match[offset + 3]) };
}

function extractTimeTokens(text) {
  return [...String(text || "").matchAll(/(?:^|[^\d])([0-2]?\d)(?::([0-5]?\d))?(?::[0-5]?\d)?(?=$|[^\d])/g)]
    .map((match) => ({ hour: Number(match[1]), minute: match[2] === undefined ? 0 : Number(match[2]) }))
    .filter((item) => item.hour >= 0 && item.hour <= 23 && item.minute >= 0 && item.minute <= 59);
}

function isValidDateTime(value) {
  if (!value) return false;
  const date = new Date(value.year, value.month - 1, value.day);
  return date.getFullYear() === value.year
    && date.getMonth() === value.month - 1
    && date.getDate() === value.day
    && value.hour >= 0
    && value.hour <= 23
    && value.minute >= 0
    && value.minute <= 59;
}

function parseFlexibleDateTimeRange(value) {
  const text = normalizeDateTimeText(value);
  const datePattern = /(^|[^\d:：]|[^\d][:：])(?:(\d{4})\s*[\/\-.年]\s*)?(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*(?:日)?/g;
  const dateMatches = [...text.matchAll(datePattern)]
    .filter((match) => isValidDateTime({ ...dateMatchToParts(match), hour: 0, minute: 0 }));
  if (dateMatches.length >= 2) {
    const startDate = dateMatchToParts(dateMatches[0]);
    const endDate = dateMatchToParts(dateMatches[1]);
    const startTime = extractTimeTokens(text.slice(dateMatches[0].index + dateMatches[0][0].length, dateMatches[1].index))[0];
    const endTime = extractTimeTokens(text.slice(dateMatches[1].index + dateMatches[1][0].length))[0];
    const start = startTime ? { ...startDate, ...startTime } : null;
    const end = endTime ? { ...endDate, ...endTime } : null;
    return isValidDateTime(start) && isValidDateTime(end) ? { start, end } : { start: null, end: null };
  }
  if (dateMatches.length === 1) {
    const date = dateMatchToParts(dateMatches[0]);
    const times = extractTimeTokens(text.slice(dateMatches[0].index + dateMatches[0][0].length));
    if (times.length >= 2) {
      const start = { ...date, ...times[0] };
      const end = { ...date, ...times[1] };
      return isValidDateTime(start) && isValidDateTime(end) ? { start, end } : { start: null, end: null };
    }
  }
  return { start: null, end: null };
}

function parseDateTime(value) {
  const match = normalizeText(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (!year || !month || !day || hour < 0 || minute < 0) return null;
  return { year, month, day, hour, minute };
}

function formatDisplayDateTime(value) {
  if (!value) return "";
  return [
    String(value.year).padStart(4, "0"),
    String(value.month).padStart(2, "0"),
    String(value.day).padStart(2, "0"),
  ].join("/") + ` ${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

function formatIsoDateTime(value) {
  if (!value) return "";
  return [
    String(value.year).padStart(4, "0"),
    String(value.month).padStart(2, "0"),
    String(value.day).padStart(2, "0"),
  ].join("-") + `T${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}:00.000`;
}

function buildUncreatedCourses(subjects, paperNames = []) {
  return subjects.map((subject, index) => {
    const paperName = normalizeText(paperNames[index]);
    return { name: subject, ...(paperName ? { paper_name: paperName } : {}) };
  });
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeRichText(value) {
  const text = normalizeText(value);
  return richTextPlainText(text) ? text : "";
}

function richTextPlainText(value) {
  return normalizeText(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function normalizeSubjects(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return normalizeText(value).split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const match = normalizeText(value).match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  if (!text) return defaultValue;
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  return defaultValue;
}

function normalizeEnabledText(value, defaultValue = false) {
  const text = normalizeText(value);
  if (!text) return defaultValue;
  const lowered = text.toLowerCase();
  if (FALSE_VALUES.has(lowered) || /不需要|无需|不开|关闭|否/.test(lowered)) return false;
  return true;
}

function normalizeExamType(value) {
  const text = normalizeText(value);
  if (["web", "WEB", "Web", "网页考试", "浏览器考试"].includes(text)) return "网页考试";
  if (["client", "CLIENT", "Client", "客户端考试", "锁定考试"].includes(text)) return "客户端考试";
  return text;
}
