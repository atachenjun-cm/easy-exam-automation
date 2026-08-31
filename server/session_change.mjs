const fieldLabels = {
  name: "场次名称",
  start: "开始时间",
  end: "结束时间",
  early: "提前登录分钟",
  later: "迟到限制分钟",
  message: "欢迎语",
  notice: "登录提示",
  unified_exam_address: "统一考试地址",
  later_deduction: "迟到扣时",
  auto_add_time: "迟到及离开扣时",
  nda: "考试承诺书",
  nda_notice: "考试承诺书内容",
  monitor: "视频监控",
  audio_monitor: "声音监控",
  save_video: "视频录制",
  eagle_eye: "鹰眼监控",
  lock_screen: "锁定考试",
  client_required: "电脑客户端考试",
  app_required: "移动端考试",
  exclusive_network: "独占网络",
  check_bluetooth: "禁用蓝牙",
  smart_input_disabled: "禁用智能输入法",
  login_times: "允许登录次数",
  lock_screen_exit_sec: "离开页面计次秒数",
  lock_screen_time: "允许离开页面次数",
  manual_score: "人工判分",
  new_mark: "新版阅卷",
  allow_anonymous: "即报即考",
  anonymous_unique: "注册唯一性校验",
  ip_white_list: "限定登录位置",
  ip_white_list_str: "允许登录 IP",
  practice_mode: "练习模式",
  entry_review: "资料审核",
  id_card_review: "证件照审核",
  around_review: "环境照审核",
  face_detection: "报名照片比对",
  face_detection_review: "登录照片人工审核",
  photo_review: "照片人工审核",
  police_detection: "公安验证",
  police_detection_after: "考后公安验证",
  face_detection_dur: "考中照片比对",
  no_interfere: "鹰眼无干扰",
  eagle_eye2: "辅鹰眼",
  desktop_monitor: "桌面监控",
  desktop_monitor_video: "桌面监控录制",
  watermark: "答题水印",
  copy_item_unable: "禁止复制",
  show_point: "显示分值",
  public_score: "查看成绩",
  show_score_detail: "查看试卷解析",
  force_no_score: "强收禁查",
  re_answer: "不满意重做",
  answer_save_high: "保留最高分",
  answer_save: "保留答案",
  wrong_practice: "错题练习",
  force_prohibit_retry: "强收禁止重做",
  datum_line: "分数线",
  send_result_email: "成绩通知",
  result_email_address: "成绩通知邮箱",
  re_answer_times: "允许重做次数",
  datum_score: "及格分数",
  open_talk: "允许考生对话",
  monitor_replay: "监控回放",
  skip_taking_photo: "监考免登录拍照",
  monitor_police_verification: "监考身份公安核验",
};

const sessionOptionFields = [
  "allow_anonymous", "anonymous_unique", "ip_white_list", "ip_white_list_str", "practice_mode",
  "nda", "entry_review", "id_card_review", "around_review", "monitor", "save_video", "audio_monitor",
  "face_detection", "face_detection_review", "photo_review", "police_detection", "police_detection_after",
  "face_detection_dur", "eagle_eye", "no_interfere", "eagle_eye2", "desktop_monitor",
  "desktop_monitor_video", "lock_screen", "client_required", "app_required", "exclusive_network",
  "check_bluetooth", "smart_input_disabled", "watermark", "copy_item_unable", "show_point",
  "public_score", "show_score_detail", "force_no_score", "re_answer", "answer_save_high", "answer_save",
  "wrong_practice", "force_prohibit_retry", "datum_line", "manual_score", "new_mark", "send_result_email",
  "result_email_address", "login_times", "lock_screen_exit_sec", "lock_screen_time", "re_answer_times",
  "datum_score", "open_talk", "monitor_replay", "skip_taking_photo", "monitor_police_verification",
];
const additionalSessionConfigurationFields = [
  "unified_exam_address", "later_deduction", "auto_add_time", "nda_notice",
];
export const coreSessionChangeFields = ["name", "start", "end", "early", "later", "message", "notice"];
export const allowedSessionChangeFields = [
  ...coreSessionChangeFields,
  ...additionalSessionConfigurationFields,
  ...sessionOptionFields,
];
const allowedSet = new Set(allowedSessionChangeFields);
const booleanSessionChangeFields = new Set([
  "unified_exam_address", "later_deduction", "auto_add_time",
  "allow_anonymous", "anonymous_unique", "ip_white_list", "practice_mode", "nda", "entry_review",
  "id_card_review", "around_review", "monitor", "save_video", "audio_monitor", "face_detection",
  "face_detection_review", "photo_review", "police_detection", "police_detection_after",
  "face_detection_dur", "eagle_eye", "no_interfere", "eagle_eye2", "desktop_monitor",
  "desktop_monitor_video", "lock_screen", "client_required", "app_required", "exclusive_network",
  "check_bluetooth", "smart_input_disabled", "watermark", "copy_item_unable", "show_point",
  "public_score", "show_score_detail", "force_no_score", "re_answer", "answer_save_high", "answer_save",
  "wrong_practice", "force_prohibit_retry", "datum_line", "manual_score", "new_mark", "send_result_email",
  "open_talk", "monitor_replay", "skip_taking_photo", "monitor_police_verification",
]);
const numberSessionChangeFields = new Set([
  "early", "later", "login_times", "lock_screen_exit_sec", "lock_screen_time", "re_answer_times", "datum_score",
]);

export function featureEnabledForRuntime(_runtimeDir, env = process.env) {
  return env.SESSION_CHANGE_ENABLED !== "0";
}

function text(value) {
  return String(value ?? "").trim();
}

function parseDateLike(value) {
  const raw = text(value);
  if (!raw) return Number.NaN;
  const time = Date.parse(raw.replace(/\//g, "-").replace(" ", "T"));
  return Number.isFinite(time) ? time : Number.NaN;
}

function normalizeMinute(value, field, errors) {
  if (value === "" || value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    errors.push(`${fieldLabels[field]}不能为负数或非数字`);
    return undefined;
  }
  return Math.floor(num);
}

function normalizeBoolean(value, field, errors) {
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  errors.push(`${fieldLabels[field] || field}必须为布尔值`);
  return undefined;
}

function comparableBoolean(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "是", "开启", "需要"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "否", "关闭", "不需要"].includes(normalized)) return false;
  return Boolean(value);
}

export function validateSessionChangeRequest(rawChanges = {}) {
  const changes = {};
  const errors = [];
  const source = rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges) ? rawChanges : {};

  for (const field of Object.keys(source)) {
    if (!allowedSet.has(field)) errors.push(`不支持修改字段：${field}`);
  }
  if (errors.length) return { ok: false, errors, changes: {} };

  for (const field of allowedSessionChangeFields) {
    if (!Object.hasOwn(source, field)) continue;
    if (numberSessionChangeFields.has(field)) {
      const value = normalizeMinute(source[field], field, errors);
      if (value !== undefined) changes[field] = value;
      continue;
    }
    if (booleanSessionChangeFields.has(field)) {
      const value = normalizeBoolean(source[field], field, errors);
      if (value !== undefined) changes[field] = value;
      continue;
    }
    changes[field] = text(source[field]);
  }

  if (Object.hasOwn(changes, "name") && !changes.name) errors.push("场次名称不能为空");
  if (Object.hasOwn(changes, "start")) {
    const startTime = parseDateLike(changes.start);
    if (!Number.isFinite(startTime)) errors.push("开始时间格式不正确");
  }
  if (Object.hasOwn(changes, "end")) {
    const endTime = parseDateLike(changes.end);
    if (!Number.isFinite(endTime)) errors.push("结束时间格式不正确");
  }
  if (Object.hasOwn(changes, "start") && Object.hasOwn(changes, "end")) {
    const startTime = parseDateLike(changes.start);
    const endTime = parseDateLike(changes.end);
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime <= startTime) {
      errors.push("结束时间必须晚于开始时间");
    }
  }

  return { ok: errors.length === 0, errors, changes };
}

export function editableSessionFieldsFromDetail(detail = {}) {
  const extra = detail?.extra && typeof detail.extra === "object" && !Array.isArray(detail.extra)
    ? detail.extra
    : {};
  return Object.fromEntries(allowedSessionChangeFields.map((field) => [
    field,
    Object.hasOwn(detail, field) ? detail[field] : Object.hasOwn(extra, field) ? extra[field] : "",
  ]));
}

export function editableSessionFieldNamesFromDetail(detail = {}) {
  const extra = detail?.extra && typeof detail.extra === "object" && !Array.isArray(detail.extra)
    ? detail.extra
    : {};
  return allowedSessionChangeFields.filter((field) => (
    Object.hasOwn(detail, field) || Object.hasOwn(extra, field)
  ));
}

export function localSessionFieldsForChange(session = {}) {
  const editable = editableSessionFieldsFromDetail(session);
  return Object.fromEntries(coreSessionChangeFields.map((field) => [field, editable[field] ?? ""]));
}

export function sessionChangeBasePayloadFromTask(task = {}, session = {}) {
  const common = task?.config?.sessionChangeBase || {};
  return localSessionFieldsForChange(Object.fromEntries(
    coreSessionChangeFields.map((field) => [field, session[field] ?? common[field] ?? ""]),
  ));
}

export function sessionChangePatchPayload(changes = {}) {
  const source = changes && typeof changes === "object" && !Array.isArray(changes) ? changes : {};
  return Object.fromEntries(
    allowedSessionChangeFields
      .filter((field) => Object.hasOwn(source, field))
      .map((field) => [field, source[field]]),
  );
}

function sameSessionChangeValue(field, left, right) {
  if (field === "start" || field === "end") {
    const leftTime = parseDateLike(left);
    const rightTime = parseDateLike(right);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime === rightTime;
  }
  if (numberSessionChangeFields.has(field)) {
    const leftValue = left === "" || left === null || left === undefined ? null : Number(left);
    const rightValue = right === "" || right === null || right === undefined ? null : Number(right);
    return leftValue === rightValue;
  }
  if (booleanSessionChangeFields.has(field)) {
    const leftValue = comparableBoolean(left);
    const rightValue = comparableBoolean(right);
    return leftValue === rightValue;
  }
  return String(left ?? "") === String(right ?? "");
}

export function mergeSessionChangePayload(original = {}, changes = {}) {
  const source = original && typeof original === "object" && !Array.isArray(original) ? original : {};
  return Object.fromEntries(
    Object.entries(sessionChangePatchPayload(changes))
      .filter(([field, value]) => !sameSessionChangeValue(field, source[field], value)),
  );
}

export function buildSessionChangeDiff(before = {}, after = {}) {
  const rows = [];
  for (const field of allowedSessionChangeFields) {
    const oldValue = before[field] ?? "";
    const newValue = after[field] ?? "";
    if (sameSessionChangeValue(field, oldValue, newValue)) continue;
    rows.push({ field, label: fieldLabels[field], before: oldValue, after: newValue });
  }
  return rows;
}

const formalRequirementFields = new Set([
  "考试名称",
  "考试日期时间",
  "提前登录时间",
  "限制迟到时间",
  "试卷扣时规则",
  "考试地址",
  "欢迎语",
  "考前等待提示",
  "考试承诺书内容",
  "视频监控",
  "视频录制",
  "鹰眼监控",
  "考试类型",
  "登陆次数",
  "人工判分",
  "允许离开次数（网页考试时填写）",
]);
const trialRequirementFields = new Set([
  "考试名称",
  "试考日期时间",
  "考试地址",
  "欢迎语",
  "考前等待提示",
  "视频监控",
  "鹰眼监控",
  "考试类型",
  "登陆次数",
  "人工判分",
  "允许离开次数（网页考试时填写）",
]);

const requirementBooleanOptionFields = new Map([
  ["即报即考", "allow_anonymous"],
  ["注册验证", "anonymous_unique"],
  ["练习模式", "practice_mode"],
  ["资料审核", "entry_review"],
  ["证件照", "id_card_review"],
  ["证件照审核", "id_card_review"],
  ["环境照", "around_review"],
  ["环境照审核", "around_review"],
  ["作弊侦测", "face_detection_dur"],
  ["无干扰模式", "no_interfere"],
  ["鹰眼无干扰", "no_interfere"],
  ["辅鹰眼监控", "eagle_eye2"],
  ["辅鹰眼", "eagle_eye2"],
  ["桌面监控", "desktop_monitor"],
  ["桌面视频录制", "desktop_monitor_video"],
  ["桌面监控录制", "desktop_monitor_video"],
  ["电脑端（Windows版/Mac版）", "client_required"],
  ["电脑客户端考试", "client_required"],
  ["移动端", "app_required"],
  ["移动端考试", "app_required"],
  ["独占网络", "exclusive_network"],
  ["禁用蓝牙", "check_bluetooth"],
  ["禁用智能输入法", "smart_input_disabled"],
  ["答题水印", "watermark"],
  ["禁止复制", "copy_item_unable"],
  ["显示分值", "show_point"],
  ["查看成绩", "public_score"],
  ["查看试卷解析", "show_score_detail"],
  ["强收禁查", "force_no_score"],
  ["保留最高分", "answer_save_high"],
  ["保留答案", "answer_save"],
  ["错题练习", "wrong_practice"],
  ["强收禁止重做", "force_prohibit_retry"],
]);
const requirementDirectOptionFields = new Set([
  ...requirementBooleanOptionFields.keys(),
  "限定登录位置",
  "登录验证",
  "登录验证方式",
  "不满意重做",
  "分数线",
  "成绩通知",
]);
for (const field of requirementDirectOptionFields) {
  formalRequirementFields.add(field);
  trialRequirementFields.add(field);
}

function requirementFieldEnabled(value) {
  const normalized = text(value).replace(/\s+/g, "");
  if (!normalized) return false;
  return !/^(否|不需要.*|无需.*|不开启.*|未开启.*|关闭.*|禁用.*|未勾选|false|no|n|0)$/i.test(normalized);
}

function requirementFieldDetailValue(value) {
  const normalized = text(value);
  if (!normalized || ["是", "开启", "需要", "待填写"].includes(normalized)) return "";
  return normalized;
}

export function requirementSessionOptionsFromFields(fields = {}, changedFields = []) {
  const source = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  const changed = new Set(changedFields.map(text).filter(Boolean));
  const includes = (label) => changed.size === 0 || changed.has(label);
  const options = {};

  for (const [label, field] of requirementBooleanOptionFields) {
    if (!includes(label) || !Object.hasOwn(source, label)) continue;
    options[field] = requirementFieldEnabled(source[label]);
  }

  if (includes("限定登录位置") && Object.hasOwn(source, "限定登录位置")) {
    const value = source["限定登录位置"];
    const enabled = requirementFieldEnabled(value);
    options.ip_white_list = enabled;
    options.ip_white_list_str = enabled ? requirementFieldDetailValue(value) : "";
  }

  const loginVerificationLabel = ["登录验证", "登录验证方式"]
    .find((label) => includes(label) && Object.hasOwn(source, label));
  if (loginVerificationLabel) {
    const value = text(source[loginVerificationLabel]);
    const enabled = requirementFieldEnabled(value);
    Object.assign(options, {
      face_detection: enabled && !value.includes("人工") && !value.includes("公安"),
      photo_review: enabled && value.includes("人工"),
      police_detection: enabled && value.includes("公安") && !/考后.*公安|公安.*考后/.test(value),
      police_detection_after: enabled && /考后.*公安|公安.*考后/.test(value),
    });
  }

  if (includes("不满意重做") && Object.hasOwn(source, "不满意重做")) {
    const value = source["不满意重做"];
    const enabled = requirementFieldEnabled(value);
    options.re_answer = enabled;
    options.re_answer_times = enabled ? integer(value, 1) : null;
  }
  if (includes("分数线") && Object.hasOwn(source, "分数线")) {
    const value = source["分数线"];
    const enabled = requirementFieldEnabled(value);
    options.datum_line = enabled;
    options.datum_score = enabled ? integer(value, 60) : null;
  }
  if (includes("成绩通知") && Object.hasOwn(source, "成绩通知")) {
    const value = source["成绩通知"];
    const enabled = requirementFieldEnabled(value);
    options.send_result_email = enabled;
    options.result_email_address = enabled ? requirementFieldDetailValue(value) : "";
  }

  return options;
}

function taskExamRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
}

function sessionRequirement(task = {}, session = {}) {
  const requirements = taskExamRequirements(task);
  const index = Math.max(Number(session.requirementIndex || 0), 0);
  return requirements[index] || requirements[0] || {};
}

function sessionRequirementFields(session = {}) {
  return session.sessionType === "trial" ? trialRequirementFields : formalRequirementFields;
}

function sessionChangeStep(task = {}) {
  return (Array.isArray(task.steps) ? task.steps : []).find((step) => step.stepKey === "session_change") || {};
}

function appliedRequirementChangeIds(task = {}, session = {}) {
  const sessionId = text(session.session_id || session.id);
  return new Set(sessionChangeHistoryFromStep(sessionChangeStep(task))
    .filter((record) => text(record.sessionId) === sessionId && record.requirementChangeApplied)
    .map((record) => text(record.requirementChangeId))
    .filter(Boolean));
}

function relevantSourceChanges(task = {}, session = {}) {
  const requirementIndex = Math.max(Number(session.requirementIndex || 0), 0);
  const relevantFields = sessionRequirementFields(session);
  const history = Array.isArray(task.config?.projectSourceChangeHistory)
    ? task.config.projectSourceChangeHistory
    : Array.isArray(task.config?.examRequirementChangeHistory)
      ? task.config.examRequirementChangeHistory
      : [];
  return history.filter((record) => {
    if (!["examRequirement", "project_requirement_editor"].includes(text(record.source))) return false;
    if (Math.max(Number(record.requirementIndex || 0), 0) !== requirementIndex) return false;
    return (Array.isArray(record.changes) ? record.changes : []).some((change) => relevantFields.has(text(change.field)));
  });
}

function pendingWechatRequirementChange(task = {}, session = {}) {
  const sync = task.config?.wechatRequirementSync || {};
  if (sync.status !== "pending_session_sync") return null;
  const sessionId = text(session.session_id || session.id);
  const affected = Array.isArray(sync.affectedSessionIds) ? sync.affectedSessionIds.map(text).filter(Boolean) : [];
  if (affected.length && !affected.includes(sessionId)) return null;
  const synced = Array.isArray(sync.syncedSessionIds) ? sync.syncedSessionIds.map(text).filter(Boolean) : [];
  if (synced.includes(sessionId)) return null;
  return {
    changeId: text(sync.changeId) || `requirement-v${Number(sync.requirementVersion || 0)}`,
    changedAt: sync.reviewedAt || "",
    changes: Array.isArray(sync.changes) ? sync.changes : [],
    requirementVersion: Number(sync.requirementVersion || 0),
    source: "wechat",
  };
}

function setSuggestedChange(suggested, field, value) {
  if (value === undefined || value === null) return;
  suggested[field] = value;
}

function setNullableSuggestedChange(suggested, field, value) {
  if (value === undefined) return;
  suggested[field] = value;
}

function integer(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const match = String(value).match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : fallback;
}

function timeRuleChanges(rule) {
  const normalized = text(rule).replace(/\s+/g, "");
  if (normalized.includes("不扣时")) return { later_deduction: false, auto_add_time: null };
  if (normalized.includes("迟到及离开")) return { later_deduction: null, auto_add_time: false };
  if (normalized.includes("迟到")) return { later_deduction: true, auto_add_time: null };
  return { later_deduction: null, auto_add_time: null };
}

function requirementSessionOptionChanges(config = {}, session = {}, changedFields = [], requirementFields = {}) {
  const isTrial = session.sessionType === "trial";
  const fields = new Set(changedFields.map(text).filter(Boolean));
  const includes = (field) => fields.size === 0 || fields.has(field);
  const suggested = {};
  const explicitOptions = config.sessionOptions?.explicit === true
    ? config.sessionOptions.public || {}
    : {};

  if (!isTrial && includes("试卷扣时规则")) {
    Object.assign(suggested, timeRuleChanges(config.timeRule));
  }
  if (includes("考试地址")) suggested.unified_exam_address = Boolean(config.unifiedExamAddress);
  if (!isTrial && includes("考试承诺书内容")) {
    suggested.nda = Boolean(text(config.pledgeContent));
    suggested.nda_notice = text(config.pledgeContent);
  }
  if (includes("视频监控")) {
    suggested.monitor = Boolean(config.videoMonitor);
    suggested.audio_monitor = Boolean(config.videoMonitor);
    suggested.police_detection_after = Boolean(config.videoMonitor) && text(config.loginVerifyMode).includes("考后公安");
  }
  if (!isTrial && includes("视频录制")) suggested.save_video = Boolean(config.videoRecord);
  if (includes("鹰眼监控")) suggested.eagle_eye = Boolean(config.hawkeye);
  if (includes("人工判分")) {
    suggested.manual_score = Boolean(config.manualScore);
    suggested.new_mark = Boolean(config.manualScore) && text(config.manualScoreText).includes("新版");
  }
  if (includes("考试类型")) {
    const clientExam = Boolean(config.clientExam) || text(config.examType).includes("客户端");
    const leaveFallback = isTrial ? 10 : 5;
    Object.assign(suggested, {
      lock_screen: true,
      client_required: clientExam,
      app_required: false,
      exclusive_network: clientExam,
      login_times: clientExam && isTrial ? 20 : integer(config.clientLoginLimit, 10),
      lock_screen_exit_sec: clientExam ? null : integer(config.webLeaveSeconds, 5),
      lock_screen_time: clientExam ? null : integer(config.leaveLimit, leaveFallback),
    });
  }
  if (includes("登陆次数")) suggested.login_times = integer(config.clientLoginLimit, isTrial && config.clientExam ? 20 : 10);
  if (includes("允许离开次数（网页考试时填写）") && !config.clientExam) {
    suggested.lock_screen_time = integer(config.leaveLimit, isTrial ? 10 : 5);
  }

  // Explicit picker options are already the tenant API field names. They are
  // included when a version record represents the whole configuration.
  if (fields.size === 0) {
    if (config.watermark !== null && config.watermark !== undefined) suggested.watermark = Boolean(config.watermark);
    if (config.disableCopy !== null && config.disableCopy !== undefined) suggested.copy_item_unable = Boolean(config.disableCopy);
    for (const [field, value] of Object.entries(explicitOptions)) {
      if (allowedSet.has(field)) setNullableSuggestedChange(suggested, field, value);
    }
    if (isTrial) {
      suggested.save_video = false;
      suggested.nda = false;
      suggested.nda_notice = "";
    }
  }
  Object.assign(suggested, requirementSessionOptionsFromFields(requirementFields, changedFields));
  if (includes("视频监控") || includes("视频录制")) {
    const monitorEnabled = comparableBoolean(suggested.monitor)
      ?? (comparableBoolean(config.videoMonitor) === true);
    const replayRequested = !Object.hasOwn(explicitOptions, "monitor_replay")
      || comparableBoolean(explicitOptions.monitor_replay) === true;
    suggested.monitor_replay = Boolean(monitorEnabled && replayRequested);
  }
  return suggested;
}

function suggestedChangesFromRequirement(task = {}, session = {}, changedFields = []) {
  const requirement = sessionRequirement(task, session);
  const config = requirement.config || {};
  const fields = new Set(changedFields.map(text).filter(Boolean));
  const includes = (field) => fields.size === 0 || fields.has(field);
  const suggested = {};
  if (session.sessionType === "trial") {
    if (includes("考试名称")) setSuggestedChange(suggested, "name", config.mockExamName);
    if (includes("试考日期时间")) {
      setSuggestedChange(suggested, "start", config.mockStartTimeDisplay);
      setSuggestedChange(suggested, "end", config.mockEndTimeDisplay);
    }
    return { ...suggested, ...requirementSessionOptionChanges(config, session, changedFields, requirement.fields) };
  }
  if (includes("考试名称")) setSuggestedChange(suggested, "name", config.examName);
  if (includes("考试日期时间")) {
    setSuggestedChange(suggested, "start", config.startTimeDisplay);
    setSuggestedChange(suggested, "end", config.endTimeDisplay);
  }
  if (includes("提前登录时间")) setNullableSuggestedChange(suggested, "early", config.earlyLoginMinutes);
  if (includes("限制迟到时间")) setNullableSuggestedChange(suggested, "later", config.lateLimitMinutes);
  if (includes("欢迎语")) setSuggestedChange(suggested, "message", config.welcomeText);
  if (includes("考前等待提示")) setSuggestedChange(suggested, "notice", config.preLoginPrompt);
  return { ...suggested, ...requirementSessionOptionChanges(config, session, changedFields, requirement.fields) };
}

export function sessionRequirementChangeForTaskSession(task = {}, session = {}, options = {}) {
  const appliedIds = appliedRequirementChangeIds(task, session);
  const manualChanges = relevantSourceChanges(task, session)
    .filter((record) => !appliedIds.has(text(record.changeId)));
  const wechat = pendingWechatRequirementChange(task, session);
  const candidates = [...manualChanges, ...(wechat ? [wechat] : [])];
  if (!candidates.length) return { pending: false, label: "", suggestedChanges: {} };
  const latest = [...candidates].reverse().sort((left, right) => (
    Date.parse(right.changedAt || "") - Date.parse(left.changedAt || "")
  ))[0] || candidates[candidates.length - 1];
  const changedFields = [...new Set(candidates.flatMap((record) => (
    Array.isArray(record.changes) ? record.changes : []
  ).map((change) => text(change.field)).filter(Boolean)))];
  const suggestedChanges = suggestedChangesFromRequirement(task, session, changedFields);
  const changeId = text(latest.changeId);
  if (!Object.keys(suggestedChanges).length) return { pending: false, label: "", changeId, suggestedChanges: {} };
  const knownFields = Array.isArray(options.knownFields) ? new Set(options.knownFields) : null;
  const confirmedSuggestedChanges = knownFields
    ? Object.fromEntries(Object.entries(suggestedChanges).filter(([field]) => knownFields.has(field)))
    : suggestedChanges;
  if (!Object.keys(confirmedSuggestedChanges).length) {
    return { pending: false, label: "", changeId, suggestedChanges: {} };
  }
  const diff = buildSessionChangeDiff(session, { ...session, ...confirmedSuggestedChanges });
  if (!diff.length || sessionChangeMatchesSuggested(session, confirmedSuggestedChanges)) {
    return { pending: false, label: "", changeId, suggestedChanges: {} };
  }
  return {
    pending: true,
    label: "需求有变请确认",
    changeId,
    changedAt: latest.changedAt || "",
    changedFields,
    requirementVersion: Number(latest.requirementVersion || 0),
    source: latest.source || "",
    suggestedChanges: confirmedSuggestedChanges,
    diff,
  };
}

export function enrichTaskSessionRequirementChanges(task = {}, options = {}) {
  const currentBySessionId = options.currentBySessionId || {};
  const knownFieldsBySessionId = options.knownFieldsBySessionId || {};
  const confirmedOnly = Boolean(options.confirmedOnly);
  const sessions = (Array.isArray(task.sessions) ? task.sessions : []).map((session) => {
    const sessionId = text(session.session_id || session.id);
    const hasCurrent = Object.hasOwn(currentBySessionId, sessionId);
    const current = hasCurrent ? currentBySessionId[sessionId] : null;
    const knownFields = hasCurrent
      ? knownFieldsBySessionId[sessionId] || Object.keys(current || {})
      : null;
    const requirementChange = confirmedOnly && !hasCurrent
      ? { pending: false, label: "", suggestedChanges: {} }
      : sessionRequirementChangeForTaskSession(
        task,
        current ? { ...session, ...current } : session,
        knownFields ? { knownFields } : {},
      );
    return { ...session, requirementChange };
  });
  const pendingCount = sessions.filter((session) => session.requirementChange?.pending).length;
  return {
    ...task,
    sessions,
    requirementChangeSummary: {
      pending: pendingCount > 0,
      pendingCount,
      label: pendingCount ? "需求有变请确认" : "",
    },
  };
}

export function sessionChangeMatchesSuggested(after = {}, suggested = {}) {
  return Object.entries(suggested).every(([field, expected]) => {
    const actual = after[field];
    if (field === "start" || field === "end") {
      const actualTime = parseDateLike(actual);
      const expectedTime = parseDateLike(expected);
      return Number.isFinite(actualTime) && Number.isFinite(expectedTime) && actualTime === expectedTime;
    }
    if (numberSessionChangeFields.has(field)) {
      if (expected === null || expected === "") return actual === null || actual === "" || actual === undefined;
      return Number(actual) === Number(expected);
    }
    if (booleanSessionChangeFields.has(field)) {
      if (expected === null || expected === "") return actual === null || actual === "" || actual === undefined;
      return comparableBoolean(actual) === comparableBoolean(expected);
    }
    return String(actual ?? "") === String(expected ?? "");
  });
}

export function sessionChangeSummary(body) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.info !== undefined ? { info: body.info } : {}),
      ...(body.error !== undefined ? { error: body.error } : {}),
      ...(body.detail !== undefined && typeof body.detail !== "object" ? { detail: body.detail } : {}),
    };
  }
  return { bodyType: typeof body, body: String(body ?? "").slice(0, 500) };
}

export function appendSessionChangeHistory(existing = [], record = {}) {
  const base = Array.isArray(existing) ? existing : [];
  const sessionType = String(record.sessionType || "");
  const item = {
    id: record.id || `${record.sessionId || "session"}-${Date.now()}`,
    changedAt: record.changedAt || new Date().toISOString(),
    operator: record.operator || "",
    sessionId: String(record.sessionId || ""),
    sessionType,
    sessionLabel: sessionType === "formal" ? "正式考试" : sessionType === "trial" ? "试考" : "场次",
    apiBase: record.apiBase || "",
    status: record.status || "success",
    tenantStatus: record.tenantStatus ?? "",
    verifyStatus: record.verifyStatus ?? "",
    diff: Array.isArray(record.diff) ? record.diff : [],
    tenantResponseSummary: record.tenantResponseSummary || {},
    verifiedSession: record.verifiedSession || null,
    warning: record.warning || null,
    requirementChangeId: text(record.requirementChangeId),
    requirementChangeApplied: Boolean(record.requirementChangeApplied),
    courseRequirementIndex: Math.max(Number(record.courseRequirementIndex || 0), 0),
    courseRequirementChangeId: text(record.courseRequirementChangeId),
    courseRequirementChangeApplied: Boolean(record.courseRequirementChangeApplied),
    verifiedCourses: Array.isArray(record.verifiedCourses) ? record.verifiedCourses : [],
    action: text(record.action),
  };
  return [item, ...base].slice(0, 50);
}

export function sessionChangeHistoryFromStep(step = {}) {
  if (Array.isArray(step?.result?.history) && step.result.history.length) return step.result.history;
  if (!Array.isArray(step?.result?.diff) || !step.result.diff.length) return [];
  return appendSessionChangeHistory([], {
    id: `${step.result.sessionId || "session"}-legacy`,
    changedAt: step.completedAt || step.startedAt || "",
    operator: step.result.operator || "",
    sessionId: step.result.sessionId || "",
    sessionType: step.result.sessionType || "",
    apiBase: step.result.apiBase || "",
    status: step.status || "success",
    tenantStatus: step.result.tenantStatus || 200,
    verifyStatus: step.result.verifyStatus || "",
    diff: step.result.diff,
    tenantResponseSummary: step.result.tenantResponseSummary || {},
    verifiedSession: step.result.verifiedSession || null,
    requirementChangeId: step.result.requirementChangeId || "",
    requirementChangeApplied: Boolean(step.result.requirementChangeApplied),
    courseRequirementIndex: Number(step.result.requirementIndex || 0),
    courseRequirementChangeId: step.result.courseRequirementChangeId || "",
    courseRequirementChangeApplied: Boolean(step.result.courseRequirementChangeApplied),
    verifiedCourses: step.result.courses || [],
  });
}

export function tenantSessionChangeErrorMessage(error = {}) {
  const status = Number(error?.status || 0);
  if (status === 401) return "租户 API 返回 401，请检查租户 API Key。";
  if (status === 403) return "租户 API 返回 403，场次不存在、不属于当前租户，或当前 Key 无权限修改。";
  if (status === 429) return "租户 API 返回 429，请稍后重试。";
  return `租户 API 修改场次失败：${status || "未知"}`;
}

export async function fetchTenantSessionDetail({ apiBase, sessionId, requestJson, login }) {
  const base = String(apiBase || "").replace(/\/+$/, "");
  return await requestJson(
    login,
    `${base}/tenant/api/session/${encodeURIComponent(sessionId)}/`,
    { method: "GET" },
    `读取场次详情 ${sessionId}`,
  );
}

function tenantSessionId(value = {}) {
  return String(value?.id ?? value?.session_id ?? value?.sessionId ?? "").trim();
}

function tenantSessionList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["sessions", "results", "data", "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

export async function fetchTenantSessionDetailWithListFallback(options = {}) {
  try {
    return await fetchTenantSessionDetail(options);
  } catch (detailError) {
    const base = String(options.apiBase || "").replace(/\/+$/, "");
    const sessionId = String(options.sessionId || "").trim();
    const payload = await options.requestJson(
      options.login,
      `${base}/tenant/api/session/?session_ids=${encodeURIComponent(sessionId)}`,
      { method: "GET" },
      `从场次列表读取 ${sessionId}`,
    );
    const detail = tenantSessionList(payload).find((item) => tenantSessionId(item) === sessionId);
    if (detail) return detail;
    throw detailError;
  }
}

export async function putTenantSessionDetail({ apiBase, sessionId, payload, requestJson, login }) {
  const base = String(apiBase || "").replace(/\/+$/, "");
  const safePayload = sessionChangePatchPayload(payload);
  if (!Object.keys(safePayload).length) throw new Error("修改场次信息失败：没有可提交的变更字段");
  return await requestJson(
    login,
    `${base}/tenant/api/session/${encodeURIComponent(sessionId)}/`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safePayload),
    },
    `修改场次信息 ${sessionId}`,
  );
}

export function sessionCreationCriticalOptions(sessionPayload = {}) {
  const monitorEnabled = comparableBoolean(sessionPayload.monitor) === true;
  const replayRequested = comparableBoolean(sessionPayload.monitor_replay) === true;
  return {
    new_mark: comparableBoolean(sessionPayload.new_mark) === true,
    monitor_replay: monitorEnabled && replayRequested,
  };
}

export async function ensureSessionCreationOptions({
  apiBase,
  sessionId,
  sessionPayload,
  requestJson,
  login,
}) {
  const expected = sessionCreationCriticalOptions(sessionPayload);
  const result = await putTenantSessionDetail({
    apiBase,
    sessionId,
    payload: expected,
    requestJson,
    login,
  });
  const detail = await fetchTenantSessionDetailWithListFallback({
    apiBase,
    sessionId,
    requestJson,
    login,
  });
  const actual = editableSessionFieldsFromDetail(detail);
  if (!sessionChangeMatchesSuggested(actual, expected)) {
    const error = new Error("场次创建后配置校验失败：新版阅卷或监控回放未正确生效");
    error.detail = { expected, actual };
    throw error;
  }
  return { sessionId: String(sessionId || "").trim(), expected, actual, result };
}
