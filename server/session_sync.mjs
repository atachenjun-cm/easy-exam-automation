import {
  coreSessionChangeFields,
  buildSessionChangeDiff,
  editableSessionFieldsFromDetail,
  sessionChangeHistoryFromStep,
} from "./session_change.mjs";

export const SESSION_SYNC_ACTION = "sync_from_yikao";

const allowedFieldSet = new Set(coreSessionChangeFields);

function editableCoreSessionFieldsFromDetail(detail = {}) {
  const editable = editableSessionFieldsFromDetail(detail);
  return Object.fromEntries(coreSessionChangeFields.map((field) => [field, editable[field] ?? ""]));
}

function text(value) {
  return String(value ?? "").trim();
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && text(value) !== "") return value;
  }
  return "";
}

function minuteValue(...values) {
  const value = firstValue(...values);
  const normalized = text(value).replace(/分钟/g, "").trim();
  if (!normalized) return "";
  const number = Number(normalized);
  if (Number.isFinite(number)) return number < 0 ? "" : number;
  return value;
}

const sessionOptionDefinitions = [
  ["allow_anonymous", "即报即考", "boolean"],
  ["anonymous_unique", "注册唯一性校验", "boolean"],
  ["ip_white_list", "限定登录位置", "boolean"],
  ["ip_white_list_str", "允许登录 IP", "text"],
  ["practice_mode", "练习模式", "boolean"],
  ["nda", "考试承诺书", "boolean"],
  ["entry_review", "资料审核", "boolean"],
  ["id_card_review", "证件照审核", "boolean"],
  ["around_review", "环境照审核", "boolean"],
  ["monitor", "视频监控", "boolean"],
  ["save_video", "视频录制", "boolean"],
  ["audio_monitor", "声音监控", "boolean"],
  ["face_detection", "报名照片比对", "boolean"],
  ["face_detection_review", "登录照片人工审核", "boolean"],
  ["photo_review", "照片人工审核", "boolean"],
  ["police_detection", "公安验证", "boolean"],
  ["police_detection_after", "考后公安验证", "boolean"],
  ["face_detection_dur", "考中照片比对", "boolean"],
  ["eagle_eye", "鹰眼监控", "boolean"],
  ["no_interfere", "鹰眼无干扰", "boolean"],
  ["eagle_eye2", "辅鹰眼", "boolean"],
  ["desktop_monitor", "桌面监控", "boolean"],
  ["desktop_monitor_video", "桌面监控录制", "boolean"],
  ["lock_screen", "锁定考试", "boolean"],
  ["client_required", "电脑客户端考试", "boolean"],
  ["app_required", "移动端考试", "boolean"],
  ["exclusive_network", "独占网络", "boolean"],
  ["check_bluetooth", "禁用蓝牙", "boolean"],
  ["smart_input_disabled", "禁用智能输入法", "boolean"],
  ["watermark", "答题水印", "boolean"],
  ["copy_item_unable", "禁止复制", "boolean"],
  ["show_point", "显示分值", "boolean"],
  ["public_score", "查看成绩", "boolean"],
  ["show_score_detail", "查看试卷解析", "boolean"],
  ["force_no_score", "强收禁查", "boolean"],
  ["re_answer", "不满意重做", "boolean"],
  ["answer_save_high", "保留最高分", "boolean"],
  ["answer_save", "保留答案", "boolean"],
  ["wrong_practice", "错题练习", "boolean"],
  ["force_prohibit_retry", "强收禁止重做", "boolean"],
  ["datum_line", "分数线", "boolean"],
  ["manual_score", "人工判分", "boolean"],
  ["new_mark", "新版阅卷", "boolean"],
  ["send_result_email", "成绩通知", "boolean"],
  ["result_email_address", "成绩通知邮箱", "text"],
  ["login_times", "允许登录次数", "number"],
  ["lock_screen_exit_sec", "离开页面计次秒数", "number"],
  ["lock_screen_time", "允许离开页面次数", "number"],
  ["re_answer_times", "允许重做次数", "number"],
  ["datum_score", "及格分数", "number"],
  ["open_talk", "允许考生对话", "boolean"],
  ["monitor_replay", "监控回放", "boolean"],
  ["skip_taking_photo", "监考免登录拍照", "boolean"],
  ["monitor_police_verification", "监考身份公安核验", "boolean"],
].map(([field, label, type]) => ({ field, label, type }));

const sessionOptionDefinitionByField = new Map(sessionOptionDefinitions.map((item) => [item.field, item]));

const excludedSessionOptionComparisonFields = new Set([
  "monitor_replay",
]);

const implicitPlatformSessionOptions = {
  new_mark: false,
  re_answer: false,
  open_talk: false,
  monitor_replay: false,
};

const remoteOnlyConfigurationLabels = {
  new_monitor: "新版监控",
  sequence_form: "顺序试卷",
};

function booleanOption(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = text(value).toLowerCase();
  if (["true", "1", "yes", "on", "是", "开启", "需要", "开启录制", "需要录制"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "否", "关闭", "不需要", "无需录制", "不需要录制"].includes(normalized)) return false;
  return null;
}

function optionValue(value, type) {
  if (type === "boolean") return booleanOption(value);
  if (type === "number") return value !== "" && value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === "text") return value === undefined || value === null ? null : String(value).trim();
  return value ?? null;
}

export function sessionConfigurationSnapshotFromDetail(detail = {}) {
  const source = objectValue(detail);
  const extra = objectValue(source.extra);
  const options = {};
  const items = [];
  const consumedExtraFields = new Set();
  for (const definition of sessionOptionDefinitions) {
    const inSource = Object.hasOwn(source, definition.field);
    const inExtra = Object.hasOwn(extra, definition.field);
    if (!inSource && !inExtra) continue;
    const raw = inSource ? source[definition.field] : extra[definition.field];
    const value = optionValue(raw, definition.type);
    if (value === null) continue;
    if (inExtra) consumedExtraFields.add(definition.field);
    options[definition.field] = value;
    items.push({
      field: definition.field,
      label: definition.label,
      value,
      sourceField: inSource ? definition.field : `extra.${definition.field}`,
      syncable: true,
    });
  }
  const retryCountIndex = items.findIndex((item) => item.field === "re_answer_times");
  const retryEnabledExplicitlyReturned = Object.hasOwn(options, "re_answer");
  if (options.re_answer === false || (!retryEnabledExplicitlyReturned && options.re_answer_times === 0)) {
    if (!retryEnabledExplicitlyReturned) {
      const retryCountItem = items[retryCountIndex];
      options.re_answer = false;
      items.splice(Math.max(retryCountIndex, 0), retryCountIndex >= 0 ? 1 : 0, {
        field: "re_answer",
        label: sessionOptionDefinitionByField.get("re_answer").label,
        value: false,
        sourceField: retryCountItem?.sourceField || "re_answer_times",
        syncable: true,
      });
    } else if (retryCountIndex >= 0) {
      items.splice(retryCountIndex, 1);
    }
    delete options.re_answer_times;
  }
  for (const [field, value] of Object.entries(extra)) {
    if (consumedExtraFields.has(field) || value === undefined) continue;
    items.push({
      field,
      label: remoteOnlyConfigurationLabels[field] || field,
      value,
      sourceField: `extra.${field}`,
      syncable: false,
      note: "仅回读，不写入平台自动配置",
    });
  }
  return { options, items };
}

export function sessionOptionSnapshotFromDetail(detail = {}) {
  const current = sessionConfigurationSnapshotFromDetail(detail).options;
  return Object.fromEntries(sessionOptionDefinitions.map(({ field }) => [field, Object.hasOwn(current, field) ? current[field] : null]));
}

function taskRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
}

function requirementForSession(task = {}, session = {}) {
  const index = Math.max(Number(session.requirementIndex || 0), 0);
  return taskRequirements(task)[index] || {};
}

function requirementConfigForSession(task = {}, session = {}) {
  const requirement = requirementForSession(task, session);
  return {
    ...objectValue(task.config),
    ...objectValue(requirement.config),
  };
}

function platformRequirementConfigForSession(task = {}, session = {}) {
  const requirement = requirementForSession(task, session);
  return Object.keys(requirement).length
    ? objectValue(requirement.config)
    : objectValue(task.config);
}

function localSessionOptions(task = {}, session = {}) {
  const config = platformRequirementConfigForSession(task, session);
  return config.sessionOptions?.explicit === true
    ? objectValue(config.sessionOptions.public)
    : {};
}

function requirementUsesNewMark(task = {}, session = {}) {
  const requirement = requirementForSession(task, session);
  const config = platformRequirementConfigForSession(task, session);
  const mode = text(firstValue(
    config.manualScoreText,
    objectValue(requirement.fields)["人工判分"],
  ));
  return Boolean(config.manualScore || mode) && mode.includes("新版");
}

function requirementBooleanSetting(task = {}, session = {}, configField, requirementField) {
  const requirement = requirementForSession(task, session);
  const config = platformRequirementConfigForSession(task, session);
  return booleanOption(firstValue(
    config[configField],
    objectValue(requirement.fields)[requirementField],
  )) === true;
}

function effectiveLocalSessionOptions(task = {}, session = {}) {
  const explicitOptions = localSessionOptions(task, session);
  const monitorEnabled = Object.hasOwn(explicitOptions, "monitor")
    ? booleanOption(explicitOptions.monitor) === true
    : requirementBooleanSetting(task, session, "videoMonitor", "视频监控");
  const replayRequested = !Object.hasOwn(explicitOptions, "monitor_replay")
    || booleanOption(explicitOptions.monitor_replay) === true;
  return {
    ...implicitPlatformSessionOptions,
    ...explicitOptions,
    ...(requirementUsesNewMark(task, session) ? { new_mark: true } : {}),
    monitor_replay: monitorEnabled && replayRequested,
  };
}

function normalizeCourseRecords(courses = []) {
  return (Array.isArray(courses) ? courses : []).map((course) => {
    const formCodes = Array.isArray(course?.form_codes) ? course.form_codes.map(text).filter(Boolean) : [];
    const paperNames = Array.isArray(course?.paper_names)
      ? course.paper_names.map(text).filter(Boolean)
      : [course?.paper_name, course?.paperName].map(text).filter(Boolean);
    return {
      code: text(course?.code || course?.course_code),
      name: text(course?.name || course?.course_name),
      form_codes: [...new Set(formCodes)],
      paper_names: [...new Set(paperNames)],
      ...(paperNames[0] ? { paper_name: paperNames[0] } : {}),
    };
  }).filter((course) => course.code || course.name);
}

function localCourses(task = {}, session = {}) {
  return normalizeCourseRecords(requirementConfigForSession(task, session).courses);
}

function paperRecordsFromCourses(courses = []) {
  const papers = [];
  const seen = new Set();
  for (const course of normalizeCourseRecords(courses)) {
    const count = Math.max(course.form_codes.length, course.paper_names.length);
    for (let index = 0; index < count; index += 1) {
      const code = course.form_codes[index] || "";
      const name = course.paper_names[index] || code;
      const key = code || `name:${name}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      papers.push({ code, name });
    }
  }
  return papers;
}

function boundPaperRecordsForSession(task = {}, session = {}) {
  const requirementIndex = Math.max(Number(session.requirementIndex || 0), 0);
  const state = task.config?.paperFormBinds?.[requirementIndex]
    || (requirementIndex === 0 ? task.config?.paperFormBind : null)
    || {};
  if (text(state.status) !== "success") return [];

  const result = objectValue(state.result);
  const sessionId = text(session.session_id || session.id);
  const recordedSessionId = text(result.sessionId);
  if (sessionId && recordedSessionId && sessionId !== recordedSessionId) return [];

  const bindResults = Array.isArray(result.bindResult?.results) ? result.bindResult.results : [];
  const matchingResults = bindResults.filter((item) => {
    const itemSessionId = text(item?.session_id || item?.sessionId);
    return !sessionId || !itemSessionId || itemSessionId === sessionId;
  });
  return paperRecordsFromCourses(matchingResults);
}

function mergeCourseRecords(currentCourses = [], readbackCourses = []) {
  const merged = normalizeCourseRecords(currentCourses);
  for (const readback of normalizeCourseRecords(readbackCourses)) {
    const index = merged.findIndex((course) => (
      (readback.code && course.code === readback.code)
      || (!readback.code && readback.name && course.name === readback.name)
      || (!course.code && course.name && course.name === readback.name)
    ));
    if (index >= 0) merged[index] = { ...merged[index], ...readback };
    else merged.push(readback);
  }
  return merged;
}

function listSignature(items = [], fields = []) {
  return JSON.stringify((Array.isArray(items) ? items : [])
    .map((item) => fields.map((field) => text(item?.[field])).join("\u0001"))
    .sort());
}

function courseDisplayValues(courses = []) {
  return normalizeCourseRecords(courses).map((course) => course.code ? `${course.name || "未命名科目"}（${course.code}）` : course.name);
}

function paperDisplayValues(papers = []) {
  return (Array.isArray(papers) ? papers : []).map((paper) => {
    const name = text(paper?.name || paper?.paper_name);
    const code = text(paper?.code || paper?.form_code);
    return code ? `${name || "未命名试卷"}（${code}）` : name;
  }).filter(Boolean);
}

function storedSessionSnapshot(task = {}, sessionId = "") {
  const snapshot = task.config?.sessionSync?.snapshots?.[text(sessionId)];
  return objectValue(snapshot);
}

function sessionChangeStep(task = {}) {
  return (Array.isArray(task.steps) ? task.steps : [])
    .find((step) => step.stepKey === "session_change") || {};
}

function baselineFromRequirement(task = {}, session = {}) {
  const requirement = requirementForSession(task, session);
  const fields = objectValue(requirement.fields);
  const config = {
    ...objectValue(task.config),
    ...objectValue(requirement.config),
  };
  const isTrial = text(session.sessionType || session.session_type) === "trial";
  return {
    name: firstValue(
      session.name,
      isTrial ? config.mockExamName : config.examName,
      fields["考试名称"],
    ),
    start: firstValue(
      session.start,
      session.start_time,
      isTrial ? config.mockStartTimeDisplay : config.startTimeDisplay,
    ),
    end: firstValue(
      session.end,
      session.end_time,
      isTrial ? config.mockEndTimeDisplay : config.endTimeDisplay,
    ),
    early: isTrial ? "" : minuteValue(config.earlyLoginMinutes, fields["提前登录时间"]),
    later: isTrial ? "" : minuteValue(config.lateLimitMinutes, fields["限制迟到时间"]),
    message: firstValue(config.welcomeText, fields["欢迎语"]),
    notice: firstValue(config.preLoginPrompt, fields["考前等待提示"]),
  };
}

function applyLaterSessionHistory(task, session, baseline, storedAt = "") {
  const sessionId = text(session.session_id || session.id);
  const storedTime = Date.parse(storedAt || "");
  const history = sessionChangeHistoryFromStep(sessionChangeStep(task))
    .filter((record) => text(record.sessionId) === sessionId && record.status !== "failed")
    .filter((record) => {
      if (!Number.isFinite(storedTime)) return true;
      const changedTime = Date.parse(record.changedAt || "");
      return Number.isFinite(changedTime) && changedTime > storedTime;
    })
    .sort((left, right) => Date.parse(left.changedAt || "") - Date.parse(right.changedAt || ""));
  for (const record of history) {
    for (const change of Array.isArray(record.diff) ? record.diff : []) {
      const field = text(change.field);
      if (allowedFieldSet.has(field)) baseline[field] = change.after ?? "";
    }
  }
  return baseline;
}

export function sessionSyncSnapshotFromDetail(detail = {}) {
  const snapshot = editableCoreSessionFieldsFromDetail(detail);
  snapshot.early = minuteValue(snapshot.early);
  snapshot.later = minuteValue(snapshot.later);
  if (!text(snapshot.name) || !text(snapshot.start) || !text(snapshot.end)) {
    const error = new Error("易考场次当前信息不完整，已停止同步");
    error.code = "SESSION_SYNC_SNAPSHOT_INCOMPLETE";
    throw error;
  }
  return snapshot;
}

export function sessionSyncAvailableFields(detail = {}) {
  const source = objectValue(detail);
  return coreSessionChangeFields.filter((field) => Object.hasOwn(source, field));
}

export function sessionSyncBaselineForTaskSession(task = {}, session = {}) {
  const stored = storedSessionSnapshot(task, session.session_id || session.id);
  const storedCurrent = objectValue(stored.current);
  const baseline = {
    ...baselineFromRequirement(task, session),
    ...(Object.keys(storedCurrent).length ? editableCoreSessionFieldsFromDetail(storedCurrent) : {}),
  };
  applyLaterSessionHistory(task, session, baseline, stored.syncedAt);
  baseline.name = firstValue(session.name, baseline.name);
  baseline.start = firstValue(session.start, session.start_time, baseline.start);
  baseline.end = firstValue(session.end, session.end_time, baseline.end);
  return editableCoreSessionFieldsFromDetail(baseline);
}

export function buildSessionSyncPreview(task = {}, session = {}, detail = {}, checkedAt = "", inventory = {}) {
  const current = sessionSyncSnapshotFromDetail(detail);
  const local = sessionSyncBaselineForTaskSession(task, session);
  const availableFields = sessionSyncAvailableFields(detail);
  const sessionDiff = buildSessionChangeDiff(local, current)
    .filter((item) => availableFields.includes(item.field))
    .map((item) => ({ ...item, group: "session" }));
  const configuration = sessionConfigurationSnapshotFromDetail(detail);
  const localOptions = effectiveLocalSessionOptions(task, session);
  const configurationDiff = configuration.items
    .filter((item) => item.syncable)
    .filter((item) => !excludedSessionOptionComparisonFields.has(item.field))
    .filter((item) => !Object.hasOwn(localOptions, item.field) || localOptions[item.field] !== item.value)
    .map((item) => ({
      field: `config.${item.field}`,
      optionField: item.field,
      label: `考试配置 · ${item.label}`,
      before: Object.hasOwn(localOptions, item.field) ? localOptions[item.field] : null,
      after: item.value,
      group: "configuration",
    }));
  const currentCourses = normalizeCourseRecords(inventory.courses);
  const currentPapers = (Array.isArray(inventory.papers) ? inventory.papers : []).map((paper) => ({
    code: text(paper?.code || paper?.form_code),
    name: text(paper?.name || paper?.paper_name),
  })).filter((paper) => paper.code || paper.name);
  const storedCourses = localCourses(task, session);
  const coursesForSync = mergeCourseRecords(storedCourses, currentCourses);
  const boundPapers = boundPaperRecordsForSession(task, session);
  const storedPapers = boundPapers.length ? boundPapers : paperRecordsFromCourses(storedCourses);
  const isFormal = text(session.sessionType || session.session_type) === "formal";
  const courseDiff = isFormal && currentCourses.length && listSignature(storedCourses, ["code", "name"]) !== listSignature(coursesForSync, ["code", "name"])
    ? [{
        field: "courses",
        label: "科目信息",
        before: courseDisplayValues(storedCourses),
        after: courseDisplayValues(coursesForSync),
        group: "courses",
      }]
    : [];
  const paperDiff = isFormal && currentPapers.length && listSignature(storedPapers, ["code", "name"]) !== listSignature(currentPapers, ["code", "name"])
    ? [{
        field: "papers",
        label: "已绑定试卷",
        before: paperDisplayValues(storedPapers),
        after: paperDisplayValues(currentPapers),
        group: "papers",
      }]
    : [];
  const diff = [...sessionDiff, ...courseDiff, ...paperDiff, ...configurationDiff];
  return {
    sessionId: text(session.session_id || session.id),
    sessionType: text(session.sessionType || session.session_type),
    requirementIndex: Math.max(Number(session.requirementIndex || 0), 0),
    checkedAt: checkedAt || new Date().toISOString(),
    local,
    current,
    availableFields,
    options: sessionOptionSnapshotFromDetail(detail),
    configuration,
    courses: currentCourses,
    coursesForSync,
    papers: currentPapers,
    unmatchedPapers: Array.isArray(inventory.unmatchedPapers) ? structuredClone(inventory.unmatchedPapers) : [],
    courseReadMode: text(inventory.courseReadMode),
    readbackSummary: {
      courseCount: currentCourses.length,
      paperCount: currentPapers.length,
      configurationCount: configuration.items.length,
    },
    diff,
    changed: diff.length > 0,
  };
}

export function sessionSyncListCacheFromPreview(preview = {}) {
  const sessions = (Array.isArray(preview?.sessions) ? preview.sessions : []).map((session) => {
    const differenceCount = Array.isArray(session?.diff)
      ? session.diff.length
      : Math.max(Number(session?.differenceCount || 0), 0);
    return {
      sessionId: text(session?.sessionId),
      sessionType: text(session?.sessionType),
      requirementIndex: Math.max(Number(session?.requirementIndex || 0), 0),
      checkedAt: text(session?.checkedAt || preview?.checkedAt),
      differenceCount,
      changed: differenceCount > 0,
      error: text(session?.error),
    };
  });
  return {
    version: 1,
    checkedAt: text(preview?.checkedAt),
    sessions,
    changedCount: sessions.filter((session) => session.changed).length,
    failedCount: sessions.filter((session) => session.error).length,
  };
}

export function sessionSyncDetailCacheFromPreview(preview = {}) {
  const sessions = (Array.isArray(preview?.sessions) ? preview.sessions : []).map((session) => {
    const diff = (Array.isArray(session?.diff) ? session.diff : []).map((item) => ({
      field: text(item?.field),
      optionField: text(item?.optionField),
      label: text(item?.label),
      before: structuredClone(item?.before ?? null),
      after: structuredClone(item?.after ?? null),
      group: text(item?.group),
    }));
    const configurationItems = (Array.isArray(session?.configuration?.items) ? session.configuration.items : []).map((item) => ({
      field: text(item?.field),
      label: text(item?.label),
      value: structuredClone(item?.value ?? null),
      sourceField: text(item?.sourceField),
      syncable: item?.syncable === true,
      note: text(item?.note),
    }));
    const courses = (Array.isArray(session?.courses) ? session.courses : []).map((item) => ({
      code: text(item?.code),
      name: text(item?.name),
    }));
    const papers = (Array.isArray(session?.papers) ? session.papers : []).map((item) => ({
      code: text(item?.code),
      name: text(item?.name),
    }));
    return {
      sessionId: text(session?.sessionId),
      sessionType: text(session?.sessionType),
      requirementIndex: Math.max(Number(session?.requirementIndex || 0), 0),
      checkedAt: text(session?.checkedAt || preview?.checkedAt),
      readbackSummary: {
        courseCount: Math.max(Number(session?.readbackSummary?.courseCount || 0), 0),
        paperCount: Math.max(Number(session?.readbackSummary?.paperCount || 0), 0),
        configurationCount: Math.max(Number(session?.readbackSummary?.configurationCount || 0), 0),
      },
      courses,
      papers,
      configuration: { items: configurationItems },
      diff,
      changed: diff.length > 0,
      error: text(session?.error),
      readbackWarning: text(session?.readbackWarning),
    };
  });
  return {
    version: 1,
    checkedAt: text(preview?.checkedAt),
    sessions,
    changedCount: sessions.filter((session) => session.changed).length,
    failedCount: sessions.filter((session) => session.error).length,
  };
}

export function buildSessionSyncConfigPatch(task = {}, input = {}) {
  const session = input.session || {};
  const sessionId = text(session.session_id || session.id);
  if (!sessionId) throw new Error("缺少易考场次口令，不能保存同步结果");
  const current = sessionSyncSnapshotFromDetail(input.current || {});
  const availableFields = Array.isArray(input.availableFields) ? input.availableFields.filter((field) => allowedFieldSet.has(field)) : [];
  const remoteOptions = Object.fromEntries(
    Object.entries(objectValue(input.options)).filter(([field, value]) => sessionOptionDefinitionByField.has(field) && value !== null),
  );
  const remoteCourses = normalizeCourseRecords(input.courses);
  const coursesForSync = normalizeCourseRecords(input.coursesForSync).length
    ? normalizeCourseRecords(input.coursesForSync)
    : remoteCourses;
  const remotePapers = (Array.isArray(input.papers) ? input.papers : []).map((paper) => ({
    code: text(paper?.code || paper?.form_code),
    name: text(paper?.name || paper?.paper_name),
  })).filter((paper) => paper.code || paper.name);
  const existing = objectValue(task.config?.sessionSync);
  const snapshots = objectValue(existing.snapshots);
  const history = Array.isArray(existing.history) ? existing.history : [];
  const syncedAt = input.syncedAt || new Date().toISOString();
  const requirementIndex = Math.max(Number(session.requirementIndex || 0), 0);
  const isTrial = text(session.sessionType || session.session_type) === "trial";
  const record = {
    id: input.id || `${sessionId}-${Date.parse(syncedAt) || Date.now()}`,
    action: SESSION_SYNC_ACTION,
    syncedAt,
    operator: text(input.operator),
    sessionId,
    sessionType: text(session.sessionType || session.session_type),
    requirementIndex,
    diff: Array.isArray(input.diff) ? structuredClone(input.diff) : [],
  };
  const patch = {
    sessionSync: {
      ...existing,
      version: 2,
      lastSyncedAt: syncedAt,
      snapshots: {
        ...snapshots,
        [sessionId]: {
          sessionId,
          sessionType: record.sessionType,
          requirementIndex: record.requirementIndex,
          current: structuredClone(current),
          availableFields: structuredClone(availableFields),
          options: structuredClone(remoteOptions),
          courses: structuredClone(remoteCourses),
          papers: structuredClone(remotePapers),
          syncedAt,
        },
      },
      history: [record, ...history].slice(0, 50),
    },
  };

  const requirements = taskRequirements(task);
  if (!requirements.length || !requirements[requirementIndex]) {
    if (!isTrial && coursesForSync.length) patch.courses = coursesForSync;
    if (Object.keys(remoteOptions).length) {
      const existingOptions = objectValue(task.config?.sessionOptions);
      patch.sessionOptions = {
        ...existingOptions,
        explicit: true,
        public: { ...objectValue(existingOptions.public), ...remoteOptions },
        pendingInternal: Array.isArray(existingOptions.pendingInternal) ? existingOptions.pendingInternal : [],
      };
    }
    return patch;
  }

  const examRequirements = [...requirements];
  const requirement = examRequirements[requirementIndex];
  const fields = { ...objectValue(requirement.fields) };
  const config = { ...objectValue(requirement.config) };
  if (availableFields.includes("name")) {
    if (isTrial) config.mockExamName = current.name;
    else {
      config.examName = current.name;
      fields["考试名称"] = current.name;
    }
  }
  if (availableFields.includes("start")) config[isTrial ? "mockStartTimeDisplay" : "startTimeDisplay"] = current.start;
  if (availableFields.includes("end")) config[isTrial ? "mockEndTimeDisplay" : "endTimeDisplay"] = current.end;
  if (!isTrial && availableFields.includes("early")) {
    config.earlyLoginMinutes = current.early;
    fields["提前登录时间"] = current.early === "" ? "" : `${current.early}分钟`;
  }
  if (!isTrial && availableFields.includes("later")) {
    config.lateLimitMinutes = current.later;
    fields["限制迟到时间"] = current.later === "" ? "" : `${current.later}分钟`;
  }
  if (!isTrial && availableFields.includes("message")) {
    config.welcomeText = current.message;
    fields["欢迎语"] = current.message;
  }
  if (!isTrial && availableFields.includes("notice")) {
    config.preLoginPrompt = current.notice;
    fields["考前等待提示"] = current.notice;
  }
  if (Object.keys(remoteOptions).length) {
    const existingOptions = objectValue(config.sessionOptions);
    config.sessionOptions = {
      ...existingOptions,
      explicit: true,
      public: { ...objectValue(existingOptions.public), ...remoteOptions },
      pendingInternal: Array.isArray(existingOptions.pendingInternal) ? existingOptions.pendingInternal : [],
    };
  }
  if (!isTrial && coursesForSync.length) {
    config.courses = coursesForSync;
    fields["科目信息"] = coursesForSync.map((course) => course.name).filter(Boolean).join("、");
    fields["试卷名称"] = remotePapers.map((paper) => paper.name).filter(Boolean).join("、");
  }
  examRequirements[requirementIndex] = { ...requirement, fields, config };
  patch.examRequirements = examRequirements;
  patch.examRequirement = examRequirements[0];
  if (requirementIndex === 0) {
    if (!isTrial && coursesForSync.length) patch.courses = coursesForSync;
    if (Object.keys(remoteOptions).length) patch.sessionOptions = config.sessionOptions;
  }
  return patch;
}

export function sessionSyncErrorMessage(error = {}) {
  if (error?.code === "SESSION_SYNC_SNAPSHOT_INCOMPLETE") return error.message;
  const status = Number(error?.status || 0);
  if (status === 401) return "租户 API 返回 401，请检查租户 API Key。";
  if (status === 403) return "租户 API 返回 403，场次不存在、不属于当前租户，或当前 Key 无读取权限。";
  if (status === 404) return "易考未找到该场次，请核对考试口令。";
  if (status === 429) return "租户 API 返回 429，请稍后重试。";
  return `读取易考场次信息失败：${status || "未知"}`;
}
