const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

const SESSION_TYPE_LABELS = {
  formal: "正考",
  trial: "试考",
};

const SEARCH_STOP_PHRASES = [
  "没有去考的",
  "没去考的",
  "没有考的",
  "没考的",
  "未考的",
  "还没参加的",
  "还没参考的",
  "还没进入的",
  "还没进的",
  "还没考的",
  "没有参加的",
  "没参加的",
  "未参加的",
  "没有参考的",
  "没参考的",
  "未参考的",
  "没有来的",
  "没来的",
  "没有进入的",
  "没进入的",
  "未进入的",
  "缺考的",
  "没有去考",
  "没去考",
  "没有考",
  "没考",
  "未考",
  "还没参加",
  "还没参考",
  "还没进入",
  "还没进",
  "还没考",
  "没有参加",
  "没参加",
  "未参加",
  "没有参考",
  "没参考",
  "未参考",
  "没有来",
  "没来",
  "没有进入",
  "没进入",
  "未进入",
  "缺考",
  "可不可以把",
  "能不能把",
  "可以把",
  "请把",
  "没有试考",
  "没试考",
  "未试考",
  "没有正考",
  "没正考",
  "未正考",
  "考生名单",
  "人员名单",
  "哪些考生",
  "哪些人",
  "都有谁",
  "列出来",
  "列出",
  "整理成",
  "整理",
  "导出",
  "下载",
  "生成",
  "提供",
  "发给我",
  "发我",
  "名单",
  "给我",
  "把",
  "将",
  "谁",
  "还有",
  "的是",
  "一下",
  "麻烦",
  "帮忙",
  "帮我",
  "帮我查询一下",
  "帮我查一下",
  "麻烦查询一下",
  "麻烦查一下",
  "我想了解",
  "我想问",
  "请查询",
  "请问",
  "查询一下",
  "查一下",
  "查下",
  "看一下",
  "看看",
  "正式考试",
  "正考",
  "模拟考试",
  "模拟考",
  "试考",
  "未参加",
  "没参加",
  "没有参加",
  "未参考",
  "缺考",
  "已参加",
  "参考人数",
  "应考人数",
  "多少人",
  "有多少",
  "几个人",
  "几人",
  "考试情况",
  "项目情况",
  "情况",
  "数据",
  "状态",
  "现在",
  "当前",
  "怎么样",
  "咋样",
  "如何",
  "呢",
  "吗",
  "的考试",
  "考试",
];

function text(value) {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function normalizedSearchText(value = "") {
  return text(value)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function shanghaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateKey(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 2100) return "";
  if (!Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) return "";
  if (!Number.isInteger(normalizedDay) || normalizedDay < 1 || normalizedDay > 31) return "";
  const date = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, normalizedDay));
  if (
    date.getUTCFullYear() !== normalizedYear
    || date.getUTCMonth() !== normalizedMonth - 1
    || date.getUTCDate() !== normalizedDay
  ) return "";
  return `${normalizedYear}-${String(normalizedMonth).padStart(2, "0")}-${String(normalizedDay).padStart(2, "0")}`;
}

function relativeShanghaiDateKey(offsetDays, now = new Date()) {
  const parts = shanghaiDateParts(now);
  const base = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays));
  return dateKey(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

function weekdayShanghaiDateKey(message = "", now = new Date()) {
  const match = text(message).match(/(上|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/u);
  if (!match) return "";
  const targetWeekday = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[match[2]];
  const parts = shanghaiDateParts(now);
  const base = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const currentWeekday = base.getUTCDay() || 7;
  let offsetDays = targetWeekday - currentWeekday;
  if (match[1] === "下") offsetDays += 7;
  else if (match[1] === "上") offsetDays -= 7;
  else if (!match[1] && offsetDays < 0) offsetDays += 7;
  return relativeShanghaiDateKey(offsetDays, now);
}

export function extractAssistantDate(message = "", now = new Date()) {
  const raw = text(message);
  if (!raw) return "";
  if (raw.includes("今天")) return relativeShanghaiDateKey(0, now);
  if (raw.includes("明天")) return relativeShanghaiDateKey(1, now);
  if (raw.includes("昨天")) return relativeShanghaiDateKey(-1, now);
  const weekday = weekdayShanghaiDateKey(raw, now);
  if (weekday) return weekday;

  const full = raw.match(/(?:^|\D)(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*[日号]?/u);
  if (full) return dateKey(full[1], full[2], full[3]);

  const short = raw.match(/(?:^|\D)(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*[日号]?(?:\D|$)/u);
  if (!short) return "";
  const current = shanghaiDateParts(now);
  return dateKey(current.year, short[1], short[2]);
}

export function extractAssistantTime(message = "") {
  const match = text(message).match(/(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*(?:[:：点时])\s*(\d{1,2})?\s*分?/u);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3] || 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const period = match[1] || "";
  if ((period === "下午" || period === "晚上") && hour < 12) hour += 12;
  if (period === "中午" && hour < 11) hour += 12;
  if (period === "凌晨" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return { hour, minute, minuteSpecified: Boolean(match[3]) };
}

function dateKeyFromSessionValue(value = "") {
  const raw = text(value);
  const direct = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (direct) return dateKey(direct[1], direct[2], direct[3]);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = shanghaiDateParts(parsed);
  return dateKey(parts.year, parts.month, parts.day);
}

function sessionTimeParts(value = "") {
  const raw = text(value);
  const direct = raw.match(/[T\s](\d{1,2}):(\d{2})/);
  if (direct && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return { hour: Number(direct[1]), minute: Number(direct[2]) };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHANGHAI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { hour: Number(values.hour), minute: Number(values.minute) };
}

function sessionMatchesTime(session, queryTime) {
  if (!queryTime) return true;
  const parts = sessionTimeParts(session?.start);
  if (!parts || parts.hour !== queryTime.hour) return false;
  return !queryTime.minuteSpecified || parts.minute === queryTime.minute;
}

function formatDateKey(value = "") {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日` : text(value);
}

function parseSessionEnd(value = "") {
  const raw = text(value);
  if (!raw) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6] || 0),
  ));
}

function requestedSessionTypes(message = "", context = {}) {
  const raw = text(message);
  const types = [];
  if (/试考|模拟考/.test(raw)) types.push("trial");
  if (/正考|正式考试/.test(raw)) types.push("formal");
  if (types.length) return unique(types);
  const previous = Array.isArray(context.lastSessionTypes)
    ? context.lastSessionTypes.filter((value) => value === "formal" || value === "trial")
    : [];
  return previous.length ? unique(previous) : ["formal", "trial"];
}

function requestsCandidateList(message = "") {
  const raw = text(message);
  return /名单|哪(?:些|个)(?:考生|人|人员)?|都有谁|还有谁|谁|姓名|名字|发(?:给)?我|发下|给我|给下|列(?:出|出来)|导出|拉(?:个|一下)|来(?:一份|份)|(?:考生|人员|人)\s*(?:呢|吗|呀|啊)?$/u.test(raw);
}

function requestsCandidateExport(message = "") {
  return /导出|下载|生成[^\n]{0,8}(?:名单|表格|文件)/u.test(text(message));
}

function requestsExplicitNonParticipants(message = "") {
  const raw = text(message);
  return /缺考|没考|未考|没试考|没有试考|未试考|没去考|没有去考|没参加|没有参加|未参加|没参考|没有参考|未参考|没来|没有来|未到|没到|没有到|没进|没有进|未进入|没进入|还没(?:考|参加|参考|进入|进)|没登录|未登录/u.test(raw);
}

function requestedCandidateListMode(message = "", context = {}, subjectName = "") {
  if (!requestsCandidateList(message)) return "";
  if (/已参加|参加过|已参考|参考过/u.test(text(message))) return "";
  if (requestsExplicitNonParticipants(message)) return "non_participant";
  if (subjectName) return "subject_roster";
  const hasSelectedExams = Array.isArray(context.selectedTaskIds) && context.selectedTaskIds.length > 0;
  return hasSelectedExams ? "non_participant" : "";
}

function extractSearchHint(message = "") {
  let value = text(message)
    .replace(/20\d{2}\s*[年\-/.]\s*\d{1,2}\s*[月\-/.]\s*\d{1,2}\s*[日号]?/gu, "")
    .replace(/\d{1,2}\s*[月\-/.]\s*\d{1,2}\s*[日号]?/gu, "")
    .replace(/(?:凌晨|早上|上午|中午|下午|晚上)?\s*\d{1,2}\s*(?:[:：点时])\s*\d{0,2}\s*分?/gu, "")
    .replace(/(?:上|下|本|这)?(?:周|星期|礼拜)[一二三四五六日天]/gu, "")
    .replace(/今天|明天|昨天/gu, "");
  for (const phrase of SEARCH_STOP_PHRASES) value = value.split(phrase).join("");
  const normalized = normalizedSearchText(value);
  return normalized.length >= 2 ? normalized : "";
}

function selectionIndex(message = "") {
  const raw = text(message);
  const numeric = raw.match(/^(?:第\s*)?(\d{1,2})(?:\s*个)?$/);
  if (numeric) return Number(numeric[1]) - 1;
  const chinese = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 七: 6, 八: 7, 九: 8, 十: 9 };
  const match = raw.match(/^第?([一二三四五六七八九十])个?$/);
  return match ? chinese[match[1]] : -1;
}

function searchBigrams(value = "") {
  const normalized = normalizedSearchText(value);
  if (normalized.length < 2) return normalized ? [normalized] : [];
  const result = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.push(normalized.slice(index, index + 2));
  }
  return result;
}

function similarity(left = "", right = "") {
  const leftPairs = searchBigrams(left);
  const rightPairs = searchBigrams(right);
  if (!leftPairs.length || !rightPairs.length) return 0;
  const remaining = [...rightPairs];
  let matches = 0;
  for (const pair of leftPairs) {
    const index = remaining.indexOf(pair);
    if (index < 0) continue;
    matches += 1;
    remaining.splice(index, 1);
  }
  return (2 * matches) / (leftPairs.length + rightPairs.length);
}

function sessionsForTask(taskId, sessions = []) {
  return sessions.filter((session) => text(session?.taskId) === text(taskId));
}

function configuredSubjectsFromSession(session = {}) {
  const config = session?.config && typeof session.config === "object" ? session.config : {};
  const requirements = Array.isArray(config.examRequirements) && config.examRequirements.length
    ? config.examRequirements
    : (config.examRequirement && typeof config.examRequirement === "object" ? [config.examRequirement] : []);
  const requirement = requirements[Number(session.requirementIndex || 0)] || {};
  const requirementConfig = requirement?.config && typeof requirement.config === "object"
    ? requirement.config
    : {};
  const courses = Array.isArray(requirementConfig.courses) && requirementConfig.courses.length
    ? requirementConfig.courses
    : config.courses;
  return configuredAssistantSubjects(courses);
}

function subjectNamesForResolution({ sessions = [], taskIds = [], requirementIndexesByTask = {} } = {}) {
  const allowedTaskIds = new Set((taskIds || []).map(text).filter(Boolean));
  const names = [];
  for (const session of sessions) {
    const taskId = text(session?.taskId);
    if (allowedTaskIds.size && !allowedTaskIds.has(taskId)) continue;
    const allowedIndexes = requirementIndexesByTask?.[taskId];
    if (Array.isArray(allowedIndexes) && allowedIndexes.length
      && !allowedIndexes.includes(Number(session.requirementIndex || 0))) continue;
    names.push(...configuredSubjectsFromSession(session));
  }
  return configuredAssistantSubjects(names);
}

function subjectNamedInMessage(message = "", subjectNames = []) {
  const normalizedMessage = normalizedSearchText(message);
  return [...subjectNames]
    .sort((left, right) => normalizedSearchText(right).length - normalizedSearchText(left).length)
    .find((subject) => {
      const key = normalizedSearchText(subject);
      return key.length >= 2 && normalizedMessage.includes(key);
    }) || "";
}

function requestsAllSubjects(message = "") {
  return /全部科目|所有科目|各科目|每个科目/u.test(text(message));
}

function taskSearchFields(task = {}, sessions = []) {
  return unique([
    task.projectCode,
    task.projectName,
    task.examName,
    task.customerName,
    ...sessions.map((session) => session?.name),
  ].map(text));
}

function tasksNamedInMessage(tasks = [], sessions = [], message = "") {
  const normalizedMessage = normalizedSearchText(message);
  return tasks.filter((task) => taskSearchFields(task, sessionsForTask(task.taskId, sessions))
    .some((field) => {
      const key = normalizedSearchText(field);
      return key.length >= 4 && normalizedMessage.includes(key);
    }));
}

function searchHintWithoutTaskNames(hint = "", tasks = [], sessions = []) {
  let remaining = normalizedSearchText(hint);
  const taskHints = tasks.flatMap((task) => (
    taskSearchFields(task, sessionsForTask(task.taskId, sessions))
      .map((field) => extractSearchHint(field))
      .filter((fieldHint) => fieldHint.length >= 4)
  )).sort((left, right) => right.length - left.length);
  for (const taskHint of taskHints) remaining = remaining.split(taskHint).join("");
  return remaining;
}

function scoreTaskMatch(task, sessions, message, hint) {
  const normalizedMessage = normalizedSearchText(message);
  let score = 0;
  for (const field of taskSearchFields(task, sessions)) {
    const normalizedField = normalizedSearchText(field);
    if (!normalizedField || normalizedField.length < 2) continue;
    if (normalizedMessage.includes(normalizedField)) score = Math.max(score, 220 + normalizedField.length);
    if (hint && normalizedField === hint) score = Math.max(score, 210 + hint.length);
    if (hint && normalizedField.includes(hint)) score = Math.max(score, 150 + hint.length);
    if (hint && hint.includes(normalizedField)) score = Math.max(score, 130 + normalizedField.length);
    if (hint) score = Math.max(score, Math.round(similarity(hint, normalizedField) * 100));
  }
  return score;
}

function taskLabel(task = {}, sessions = []) {
  const projectName = text(task.projectName || task.examName || "未命名考试");
  const examName = text(task.examName);
  const projectCode = text(task.projectCode);
  const formalSession = sessions.find((session) => (
    session.sessionType === "formal" && dateKeyFromSessionValue(session.start)
  ));
  const formalTime = sessionTimeLabel(formalSession, { includeYear: true });
  return [
    formalTime ? `正考 ${formalTime}` : "",
    projectName,
    examName && examName !== projectName ? examName : "",
    projectCode ? `项目编号 ${projectCode}` : "",
  ].filter(Boolean).join("，");
}

function safeContext(context = {}) {
  const selectedTaskIds = Array.isArray(context.selectedTaskIds)
    ? context.selectedTaskIds.map(text).filter(Boolean).slice(0, 30)
    : [text(context.selectedTaskId)].filter(Boolean);
  const pendingTaskIds = Array.isArray(context.pendingTaskIds)
    ? context.pendingTaskIds.map(text).filter(Boolean).slice(0, 10)
    : [];
  const requirementIndexesByTask = {};
  if (context.requirementIndexesByTask && typeof context.requirementIndexesByTask === "object") {
    for (const [taskId, indexes] of Object.entries(context.requirementIndexesByTask)) {
      if (!selectedTaskIds.includes(text(taskId)) || !Array.isArray(indexes)) continue;
      requirementIndexesByTask[text(taskId)] = unique(indexes
        .map(Number)
        .filter((value) => Number.isInteger(value) && value >= 0)
        .slice(0, 20));
    }
  }
  return {
    selectedTaskIds,
    pendingTaskIds,
    lastSessionTypes: requestedSessionTypes("", context),
    dateKey: text(context.dateKey),
    subjectName: text(context.subjectName),
    requirementIndexesByTask,
  };
}

function resolveTargets({ tasks, sessions, message, context, now }) {
  const queryDate = extractAssistantDate(message, now);
  const queryTime = extractAssistantTime(message);
  const namedTasks = tasksNamedInMessage(tasks, sessions, message);
  let hint = extractSearchHint(message);
  const subjectTaskIds = namedTasks.length
    ? namedTasks.map((task) => text(task.taskId))
    : context.selectedTaskIds;
  const scopedSubjectNames = subjectTaskIds.length
    ? subjectNamesForResolution({
        sessions,
        taskIds: subjectTaskIds,
        requirementIndexesByTask: namedTasks.length ? {} : context.requirementIndexesByTask,
      })
    : [];
  const subjectHint = namedTasks.length
    ? searchHintWithoutTaskNames(hint, namedTasks, sessions)
    : hint;
  const explicitSubjectName = subjectNamedInMessage(subjectHint, scopedSubjectNames);
  if (explicitSubjectName) {
    hint = hint.split(normalizedSearchText(explicitSubjectName)).join("");
  }
  const subjectName = requestsAllSubjects(message)
    ? ""
    : (explicitSubjectName || (!queryDate && !hint ? context.subjectName : ""));
  const hasExplicitSessionType = /试考|模拟考|正考|正式考试/u.test(text(message));
  const types = subjectName && !hasExplicitSessionType
    ? ["formal"]
    : requestedSessionTypes(message, context);
  const candidateListMode = requestedCandidateListMode(message, context, subjectName);
  const includeCandidateList = Boolean(candidateListMode);
  const subjectOptions = {
    subjectName,
    candidateListMode,
    includeCandidateList,
    exportCandidateList: requestsCandidateExport(message),
  };
  if (includeCandidateList && context.selectedTaskIds.length && hint) {
    const strongestNamedMatch = Math.max(0, ...tasks.map((task) => (
      scoreTaskMatch(task, sessionsForTask(task.taskId, sessions), message, hint)
    )));
    if (strongestNamedMatch < 100) hint = "";
  }
  const taskById = new Map(tasks.map((task) => [text(task.taskId), task]));
  const pending = context.pendingTaskIds.filter((taskId) => taskById.has(taskId));
  const selectedIndex = selectionIndex(message);
  if (!queryDate && !hint && pending.length && selectedIndex >= 0 && selectedIndex < pending.length) {
    return { kind: "targets", taskIds: [pending[selectedIndex]], types, mode: "selection", dateKey: "", ...subjectOptions };
  }

  if (queryDate) {
    const formalRequirementIndexes = {};
    const formalMatches = tasks.filter((task) => {
      const indexes = sessionsForTask(task.taskId, sessions)
        .filter((session) => (
          session.sessionType === "formal"
          && dateKeyFromSessionValue(session.start) === queryDate
          && sessionMatchesTime(session, queryTime)
        ))
        .map((session) => Number(session.requirementIndex || 0));
      if (indexes.length) formalRequirementIndexes[text(task.taskId)] = unique(indexes);
      return indexes.length > 0;
    });
    if (formalMatches.length) {
      return {
        kind: "targets",
        taskIds: formalMatches.map((task) => text(task.taskId)),
        types,
        mode: "date",
        dateKey: queryDate,
        queryTime,
        requirementIndexesByTask: formalRequirementIndexes,
        ...subjectOptions,
      };
    }

    if (!hasExplicitSessionType && !subjectName) {
      const trialRequirementIndexes = {};
      const trialMatches = tasks.filter((task) => {
        const indexes = sessionsForTask(task.taskId, sessions)
          .filter((session) => (
            session.sessionType === "trial"
            && dateKeyFromSessionValue(session.start) === queryDate
            && sessionMatchesTime(session, queryTime)
          ))
          .map((session) => Number(session.requirementIndex || 0));
        if (indexes.length) trialRequirementIndexes[text(task.taskId)] = unique(indexes);
        return indexes.length > 0;
      });
      if (trialMatches.length) {
        return {
          kind: "targets",
          taskIds: trialMatches.map((task) => text(task.taskId)),
          types: ["trial"],
          mode: "session_date",
          dateKey: queryDate,
          queryTime,
          requirementIndexesByTask: trialRequirementIndexes,
          ...subjectOptions,
        };
      }
    }

    return { kind: "not_found", types, mode: "date", dateKey: queryDate, queryTime, hint: "", ...subjectOptions };
  }

  if (hint) {
    const ranked = tasks
      .map((task) => ({
        task,
        score: scoreTaskMatch(task, sessionsForTask(task.taskId, sessions), message, hint),
      }))
      .filter((item) => item.score >= 42)
      .sort((left, right) => right.score - left.score);
    if (!ranked.length) return { kind: "not_found", types, mode: "name", dateKey: "", hint, ...subjectOptions };
    const bestScore = ranked[0].score;
    const matches = ranked.filter((item) => item.score >= bestScore - 8).slice(0, 10);
    if (matches.length === 1) {
      return { kind: "targets", taskIds: [text(matches[0].task.taskId)], types, mode: "name", dateKey: "", ...subjectOptions };
    }
    return {
      kind: "choices",
      taskIds: matches.map((item) => text(item.task.taskId)),
      types,
      labels: matches.map((item) => taskLabel(item.task, sessionsForTask(item.task.taskId, sessions))),
      ...subjectOptions,
    };
  }

  const selected = context.selectedTaskIds.filter((taskId) => taskById.has(taskId));
  if (selected.length) {
    return {
      kind: "targets",
      taskIds: selected,
      types,
      mode: selected.length > 1 ? "followup_group" : "followup",
      dateKey: context.dateKey,
      requirementIndexesByTask: context.requirementIndexesByTask,
      ...subjectOptions,
    };
  }
  return { kind: "prompt", types, ...subjectOptions };
}

function normalizedRowStatus(row = {}) {
  const raw = normalizedSearchText(row.exam_status ?? row.examStatus ?? row.status ?? row.entry_status);
  if (text(row.score) || text(row.total_score) || text(row.totalScore)) return "referenced";
  if (["已完成", "参考", "已参考", "finished", "complete", "completed"].includes(raw)) return "referenced";
  if (["缺考", "absent", "noshow"].includes(raw)) return "absent";
  if (["考试中断", "中断", "interrupted"].includes(raw)) return "interrupted";
  if (["考试中", "正在考试", "进行中", "started", "inprogress"].includes(raw)) return "in_progress";
  if (!raw || ["未开考", "未开始", "待考试", "valid", "notstarted", "pending"].includes(raw)) return "not_started";
  return "unknown";
}

function assistantCandidate(row = {}) {
  return {
    name: text(row.name || row.full_name || row.real_name || row["姓名"]),
    permit: text(row.permit || row.admission_ticket || row.ticket || row["准考证号"]),
    course: text(row.course || row.course_name || row.subject_name || row["科目"]),
  };
}

function emptyAssistantCounts() {
  return {
    referenced: 0,
    inProgress: 0,
    interrupted: 0,
    notStarted: 0,
    explicitAbsent: 0,
    unknown: 0,
  };
}

function countAssistantStatus(counts, status) {
  if (status === "referenced") counts.referenced += 1;
  else if (status === "in_progress") counts.inProgress += 1;
  else if (status === "interrupted") counts.interrupted += 1;
  else if (status === "not_started") counts.notStarted += 1;
  else if (status === "absent") counts.explicitAbsent += 1;
  else counts.unknown += 1;
}

function assistantStatistics(counts, { expected, ended, unreturned = 0 } = {}) {
  return {
    expected,
    participated: counts.referenced + counts.inProgress,
    referenced: counts.referenced,
    inProgress: counts.inProgress,
    interrupted: counts.interrupted,
    notStarted: counts.notStarted,
    absent: counts.explicitAbsent + (ended ? counts.notStarted : 0),
    explicitAbsent: counts.explicitAbsent,
    statusPending: counts.unknown + unreturned,
  };
}

function configuredAssistantSubjects(subjectNames = []) {
  const seen = new Set();
  return (Array.isArray(subjectNames) ? subjectNames : [])
    .map((subject) => text(subject?.name || subject?.course_name || subject))
    .filter((subject) => {
      const key = normalizedSearchText(subject);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function summarizeAssistantSession({
  session = {},
  rows = [],
  subjectNames = [],
  now = new Date(),
  includeCandidates = false,
} = {}) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const counts = emptyAssistantCounts();
  const configuredSubjects = configuredAssistantSubjects(subjectNames);
  const configuredSubjectByKey = new Map(
    configuredSubjects.map((subject) => [normalizedSearchText(subject), subject]),
  );
  const subjectBuckets = new Map(
    configuredSubjects.map((subject) => [subject, { counts: emptyAssistantCounts(), rowCount: 0, unreturned: 0 }]),
  );
  const nonParticipantCandidates = [];
  const interruptedCandidates = [];
  const statusPendingCandidates = [];
  const allCandidates = [];
  const seenCandidateKeys = new Set();
  const seenAllCandidateKeys = new Set();
  for (const row of normalizedRows) {
    const status = normalizedRowStatus(row);
    countAssistantStatus(counts, status);
    const candidate = assistantCandidate(row);
    const rawSubject = candidate.course;
    const subject = configuredSubjectByKey.get(normalizedSearchText(rawSubject))
      || (configuredSubjects.length === 1 ? configuredSubjects[0] : rawSubject || "科目未返回");
    candidate.course = session.sessionType === "trial"
      ? ""
      : configuredSubjectByKey.get(normalizedSearchText(rawSubject)) || rawSubject;
    candidate.subject = subject;
    if (!subjectBuckets.has(subject)) {
      subjectBuckets.set(subject, { counts: emptyAssistantCounts(), rowCount: 0, unreturned: 0 });
    }
    const subjectBucket = subjectBuckets.get(subject);
    subjectBucket.rowCount += 1;
    countAssistantStatus(subjectBucket.counts, status);
    if (includeCandidates) {
      const allCandidateKey = candidate.permit || candidate.name;
      if ((candidate.name || candidate.permit) && (!allCandidateKey || !seenAllCandidateKeys.has(allCandidateKey))) {
        allCandidates.push({ ...candidate, status });
        if (allCandidateKey) seenAllCandidateKeys.add(allCandidateKey);
      }
    }
    if (includeCandidates && ["not_started", "absent", "interrupted", "unknown"].includes(status)) {
      const key = candidate.permit || candidate.name;
      if ((candidate.name || candidate.permit) && (!key || !seenCandidateKeys.has(key))) {
        if (status === "not_started" || status === "absent") nonParticipantCandidates.push(candidate);
        else if (status === "interrupted") interruptedCandidates.push(candidate);
        else statusPendingCandidates.push(candidate);
        if (key) seenCandidateKeys.add(key);
      }
    }
  }
  const expected = Math.max(Number(session.candidateCount || session.candidate_count || 0), normalizedRows.length);
  const end = parseSessionEnd(session.end || session.end_time);
  const ended = Boolean(end && end.getTime() <= now.getTime());
  const unreturned = Math.max(expected - normalizedRows.length, 0);
  if (unreturned) {
    const subject = configuredSubjects.length === 1 ? configuredSubjects[0] : "科目未返回";
    if (!subjectBuckets.has(subject)) {
      subjectBuckets.set(subject, { counts: emptyAssistantCounts(), rowCount: 0, unreturned: 0 });
    }
    subjectBuckets.get(subject).unreturned += unreturned;
  }
  const statistics = assistantStatistics(counts, { expected, ended, unreturned });
  const subjectStats = session.sessionType === "trial"
    ? []
    : [...subjectBuckets.entries()].map(([name, bucket]) => ({
      name,
      ended,
      ...assistantStatistics(bucket.counts, {
        expected: bucket.rowCount + bucket.unreturned,
        ended,
        unreturned: bucket.unreturned,
      }),
    }));
  return {
    sessionId: text(session.session_id || session.sessionId || session.id),
    sessionType: session.sessionType === "trial" ? "trial" : "formal",
    name: text(session.name),
    start: text(session.start || session.start_time),
    end: text(session.end || session.end_time),
    ended,
    ...statistics,
    subjectStats,
    allCandidates,
    nonParticipantCandidates,
    interruptedCandidates,
    statusPendingCandidates,
    available: true,
  };
}

function sessionTimeLabel(session = {}, { includeYear = false } = {}) {
  const startDate = dateKeyFromSessionValue(session?.start);
  const endDate = dateKeyFromSessionValue(session?.end);
  const startParts = sessionTimeParts(session?.start);
  const endParts = sessionTimeParts(session?.end);
  const startTime = startParts
    ? `${String(startParts.hour).padStart(2, "0")}:${String(startParts.minute).padStart(2, "0")}`
    : "";
  const endTime = endParts
    ? `${String(endParts.hour).padStart(2, "0")}:${String(endParts.minute).padStart(2, "0")}`
    : "";
  const dateLabel = (value) => {
    if (!value) return "";
    if (includeYear) return formatDateKey(value);
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[2])} 月 ${Number(match[3])} 日` : value;
  };
  const start = [dateLabel(startDate), startTime].filter(Boolean).join(" ");
  if (!endTime) return start;
  const end = endDate && endDate !== startDate
    ? `${dateLabel(endDate)} ${endTime}`
    : endTime;
  return `${start}-${end}`;
}

function sessionSummaryText(session = {}, { includeType = true } = {}) {
  const type = SESSION_TYPE_LABELS[session.sessionType] || "考试";
  const time = sessionTimeLabel(session);
  const prefix = includeType ? `${type}${time ? `（${time}）` : ""}` : "";
  if (!session.available) return `${prefix || type}：实时数据暂时无法读取`;
  const details = [
    `应考 ${session.expected} 人`,
    `已参加 ${session.participated} 人`,
  ];
  if (session.ended) details.push(`未参加 ${session.absent} 人`);
  else {
    details.push(`当前未进入考试 ${session.notStarted + (session.explicitAbsent || 0)} 人`);
    details.push("场次尚未结束，暂不计缺考");
  }
  if (session.inProgress) details.push(`考试中 ${session.inProgress} 人`);
  if (session.interrupted) details.push(`考试中断 ${session.interrupted} 人`);
  if (session.statusPending) details.push(`状态待同步 ${session.statusPending} 人`);
  return `${prefix ? `${prefix}：` : ""}${details.join("，")}`;
}

function sessionSubjectSummaryLines(session = {}, { indent = "" } = {}) {
  const subjects = Array.isArray(session.subjectStats) ? session.subjectStats : [];
  if (!session.available || !subjects.length) return [];
  const type = SESSION_TYPE_LABELS[session.sessionType] || "考试";
  const lines = [`${indent}${type}各科目参考统计：`];
  subjects.forEach((subject) => {
    const details = [
      `应考 ${subject.expected} 人`,
      `已参加 ${subject.participated} 人`,
    ];
    if (subject.ended) details.push(`未参加 ${subject.absent} 人`);
    else details.push(`当前未进入考试 ${subject.notStarted + (subject.explicitAbsent || 0)} 人`);
    if (subject.inProgress) details.push(`考试中 ${subject.inProgress} 人`);
    if (subject.interrupted) details.push(`考试中断 ${subject.interrupted} 人`);
    if (subject.statusPending) details.push(`状态待同步 ${subject.statusPending} 人`);
    lines.push(`${indent}- ${subject.name}：${details.join("，")}`);
  });
  return lines;
}

function aggregateSessions(sessions = [], sessionType) {
  const available = sessions.filter((session) => session.sessionType === sessionType && session.available);
  if (!available.length) return null;
  return available.reduce((total, session) => ({
    sessionType,
    available: true,
    ended: total.ended && session.ended,
    expected: total.expected + session.expected,
    participated: total.participated + session.participated,
    referenced: total.referenced + session.referenced,
    inProgress: total.inProgress + session.inProgress,
    interrupted: total.interrupted + (session.interrupted || 0),
    notStarted: total.notStarted + session.notStarted,
    explicitAbsent: total.explicitAbsent + session.explicitAbsent,
    absent: total.absent + session.absent,
    statusPending: total.statusPending + session.statusPending,
  }), {
    sessionType,
    available: true,
    ended: true,
    expected: 0,
    participated: 0,
    referenced: 0,
    inProgress: 0,
    interrupted: 0,
    notStarted: 0,
    explicitAbsent: 0,
    absent: 0,
    statusPending: 0,
  });
}

function taskDisplayName(task = {}) {
  return text(task.examName || task.projectName || "未命名考试");
}

function candidateListItem(candidate = {}, index = 0) {
  const name = candidate.name || "姓名未返回";
  const details = [
    candidate.course ? `科目：${candidate.course}` : "",
    candidate.permit ? `准考证号：${candidate.permit}` : "",
  ].filter(Boolean);
  return `${index + 1}. ${name}${details.length ? `（${details.join("；")}）` : ""}`;
}

function subjectStatForSession(session = {}, subjectName = "") {
  const key = normalizedSearchText(subjectName);
  return (Array.isArray(session.subjectStats) ? session.subjectStats : [])
    .find((subject) => normalizedSearchText(subject?.name) === key) || null;
}

function candidateMatchesSubject(candidate = {}, subjectName = "") {
  const requested = normalizedSearchText(subjectName);
  return Boolean(requested) && [candidate.subject, candidate.course]
    .some((value) => normalizedSearchText(value) === requested);
}

function subjectCandidateListLines(results = [], resolution = {}) {
  const subjectName = text(resolution.subjectName);
  if (!resolution.includeCandidateList || !subjectName) return [];
  const lines = [];
  for (const result of results) {
    const matchingSessions = (result.sessions || []).filter((session) => (
      resolution.types.includes(session.sessionType) && session.available
    ));
    for (const session of matchingSessions) {
      const subject = subjectStatForSession(session, subjectName);
      if (!subject) continue;
      const type = SESSION_TYPE_LABELS[session.sessionType] || "考试";
      const time = sessionTimeLabel(session);
      const isRoster = resolution.candidateListMode === "subject_roster";
      const candidates = (isRoster ? session.allCandidates : session.nonParticipantCandidates)
        .filter((candidate) => candidateMatchesSubject(candidate, subjectName));
      const total = isRoster
        ? subject.expected
        : (subject.ended ? subject.absent : subject.notStarted + (subject.explicitAbsent || 0));
      const state = subject.ended ? `未参加${type}` : `当前未进入${type}`;
      const title = isRoster
        ? `科目“${subjectName}”的考生名单`
        : `科目“${subjectName}”${state}的考生名单`;
      lines.push(`${taskDisplayName(result)} - ${type}${time ? `（${time}）` : ""}${title}（${total} 人）：`);
      if (!candidates.length) {
        lines.push(total ? "状态接口未返回这些考生的姓名和准考证号。" : "无");
      } else {
        candidates.forEach((candidate, index) => lines.push(candidateListItem(candidate, index)));
      }
      if (total > candidates.length) {
        lines.push(`另有 ${total - candidates.length} 人的身份信息尚未同步。`);
      }
      if (isRoster) continue;

      const interruptedCandidates = (session.interruptedCandidates || [])
        .filter((candidate) => candidateMatchesSubject(candidate, subjectName));
      if (subject.interrupted) {
        lines.push(`科目“${subjectName}”考试中断的考生（${subject.interrupted} 人，单独统计，不计为未参加）：`);
        interruptedCandidates.forEach((candidate, index) => lines.push(candidateListItem(candidate, index)));
        if (subject.interrupted > interruptedCandidates.length) {
          lines.push(`另有 ${subject.interrupted - interruptedCandidates.length} 人的身份信息尚未同步。`);
        }
      }
      const statusPendingCandidates = (session.statusPendingCandidates || [])
        .filter((candidate) => candidateMatchesSubject(candidate, subjectName));
      if (subject.statusPending) {
        lines.push(`科目“${subjectName}”状态待同步的考生（${subject.statusPending} 人，暂不能判定是否参加）：`);
        statusPendingCandidates.forEach((candidate, index) => lines.push(candidateListItem(candidate, index)));
        if (subject.statusPending > statusPendingCandidates.length) {
          lines.push(`另有 ${subject.statusPending - statusPendingCandidates.length} 人的身份信息尚未同步。`);
        }
      }
    }
  }
  return lines;
}

function candidateListLines(results = [], resolution = {}) {
  if (!resolution.includeCandidateList) return [];
  if (resolution.subjectName) return subjectCandidateListLines(results, resolution);
  const lines = [];
  for (const result of results) {
    const matchingSessions = (result.sessions || []).filter((session) => (
      resolution.types.includes(session.sessionType) && session.available
    ));
    for (const session of matchingSessions) {
      const type = SESSION_TYPE_LABELS[session.sessionType] || "考试";
      const time = sessionTimeLabel(session);
      const candidates = Array.isArray(session.nonParticipantCandidates)
        ? session.nonParticipantCandidates
        : [];
      const total = session.ended
        ? session.absent
        : session.notStarted + (session.explicitAbsent || 0);
      const state = session.ended ? `未参加${type}` : `当前未进入${type}`;
      lines.push(`${taskDisplayName(result)} - ${type}${time ? `（${time}）` : ""}${state}的考生名单（${total} 人）：`);
      if (!candidates.length) {
        lines.push(total ? "状态接口未返回这些考生的姓名和准考证号。" : "无");
      } else {
        candidates.forEach((candidate, index) => lines.push(candidateListItem(candidate, index)));
      }
      if (total > candidates.length) {
        lines.push(`另有 ${total - candidates.length} 人的身份信息尚未同步。`);
      }
      const interruptedCandidates = Array.isArray(session.interruptedCandidates)
        ? session.interruptedCandidates
        : [];
      if (session.interrupted) {
        lines.push(`${taskDisplayName(result)} - ${type}${time ? `（${time}）` : ""}考试中断的考生（${session.interrupted} 人，单独统计，不计为未参加）：`);
        interruptedCandidates.forEach((candidate, index) => lines.push(candidateListItem(candidate, index)));
        if (session.interrupted > interruptedCandidates.length) {
          lines.push(`另有 ${session.interrupted - interruptedCandidates.length} 人的身份信息尚未同步。`);
        }
      }
      const statusPendingCandidates = Array.isArray(session.statusPendingCandidates)
        ? session.statusPendingCandidates
        : [];
      if (session.statusPending) {
        lines.push(`${taskDisplayName(result)} - ${type}${time ? `（${time}）` : ""}状态待同步的考生（${session.statusPending} 人，暂不能判定是否参加）：`);
        statusPendingCandidates.forEach((candidate, index) => lines.push(candidateListItem(candidate, index)));
        if (session.statusPending > statusPendingCandidates.length) {
          lines.push(`另有 ${session.statusPending - statusPendingCandidates.length} 人的身份信息尚未同步。`);
        }
      }
    }
  }
  return lines;
}

function candidateListDownloads(results = [], resolution = {}) {
  if (!resolution.exportCandidateList || !resolution.includeCandidateList) return [];
  const downloads = [];
  for (const result of results) {
    const matchingSessions = (result.sessions || []).filter((session) => (
      session.sessionType === "trial"
      && resolution.types.includes(session.sessionType)
      && session.available
    ));
    for (const session of matchingSessions) {
      const total = session.ended
        ? session.absent
        : session.notStarted + (session.explicitAbsent || 0);
      if (!total || !session.sessionId) continue;
      const stateLabel = session.ended ? "未试考" : "当前未进入试考";
      downloads.push({
        kind: "not_started_candidates",
        label: `导出${stateLabel}名单（${total} 人）`,
        url: `/api/sessions/${encodeURIComponent(session.sessionId)}/not-started-candidates/download`,
        fileName: `${text(session.name || taskDisplayName(result) || "试考")}-${stateLabel}考生名单.xlsx`,
      });
    }
  }
  return downloads;
}

function subjectAnswerLines(results = [], resolution = {}) {
  const subjectName = text(resolution.subjectName);
  const lines = [];
  if (results.length === 1) {
    lines.push(`查到了“${taskDisplayName(results[0])}”中的科目“${subjectName}”。`);
  } else {
    lines.push(`查到当前选中的 ${results.length} 个考试项目中的科目“${subjectName}”。`);
  }
  results.forEach((result, index) => {
    if (results.length > 1) lines.push(`${index + 1}. ${taskDisplayName(result)}：`);
    const indent = results.length > 1 ? "   " : "";
    const matchingSessions = (result.sessions || []).filter((session) => resolution.types.includes(session.sessionType));
    if (!matchingSessions.length) {
      lines.push(`${indent}未找到已创建的${resolution.types.map((type) => SESSION_TYPE_LABELS[type]).join("或")}场次。`);
      return;
    }
    let found = false;
    for (const session of matchingSessions) {
      if (!session.available) {
        lines.push(`${indent}${SESSION_TYPE_LABELS[session.sessionType] || "考试"}：实时数据暂时无法读取`);
        continue;
      }
      const subject = subjectStatForSession(session, subjectName);
      if (!subject) continue;
      found = true;
      lines.push(`${indent}科目“${subjectName}”${sessionSummaryText({ ...session, ...subject })}`);
    }
    if (!found && matchingSessions.some((session) => session.available)) {
      lines.push(`${indent}实时数据中没有找到科目“${subjectName}”。`);
    }
  });
  return lines;
}

function buildAnswer({ results, resolution, now }) {
  const queriedAt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const allSessions = results.flatMap((result) => result.sessions || []);
  const lines = [];
  if (resolution.subjectName) {
    lines.push(...subjectAnswerLines(results, resolution));
  } else if (["date", "session_date", "followup_group"].includes(resolution.mode)) {
    const timeText = resolution.queryTime
      ? ` ${String(resolution.queryTime.hour).padStart(2, "0")}:${String(resolution.queryTime.minute).padStart(2, "0")}`
      : "";
    const dateType = resolution.mode === "session_date" ? "试考" : "正考";
    const dateText = resolution.dateKey ? `${dateType}时间为 ${formatDateKey(resolution.dateKey)}${timeText}的` : "当前选中的";
    lines.push(`查到${dateText} ${results.length} 个考试项目。`);
    for (const type of resolution.types) {
      const aggregate = aggregateSessions(allSessions, type);
      if (aggregate) lines.push(`合计${sessionSummaryText(aggregate)}`);
    }
    results.forEach((result, index) => {
      const available = result.sessions.filter((session) => resolution.types.includes(session.sessionType));
      if (!available.length) {
        lines.push(`${index + 1}. ${taskDisplayName(result)}：未找到已创建的${resolution.types.map((type) => SESSION_TYPE_LABELS[type]).join("或")}场次`);
        return;
      }
      lines.push(`${index + 1}. ${taskDisplayName(result)}：`);
      available.forEach((session) => lines.push(`   ${sessionSummaryText(session)}`));
      available.forEach((session) => lines.push(...sessionSubjectSummaryLines(session, { indent: "   " })));
    });
  } else {
    const result = results[0];
    lines.push(`查到了“${taskDisplayName(result)}”。`);
    const available = result.sessions.filter((session) => resolution.types.includes(session.sessionType));
    if (!available.length) {
      lines.push(`这个项目暂时没有已创建的${resolution.types.map((type) => SESSION_TYPE_LABELS[type]).join("或")}场次。`);
    } else {
      available.forEach((session) => lines.push(sessionSummaryText(session)));
      available.forEach((session) => lines.push(...sessionSubjectSummaryLines(session)));
    }
  }
  lines.push(...candidateListLines(results, resolution));
  lines.push(`数据更新时间：${queriedAt}`);
  return lines.join("\n");
}

function choiceResponse(resolution, context) {
  const answer = [
    `找到 ${resolution.labels.length} 个可能的考试，请回复序号：`,
    ...resolution.labels.map((label, index) => `${index + 1}. ${label}`),
  ].join("\n");
  return {
    ok: true,
    kind: "choices",
    answer,
    context: {
      selectedTaskIds: [],
      pendingTaskIds: resolution.taskIds,
      lastSessionTypes: resolution.types,
      dateKey: context.dateKey || "",
      subjectName: resolution.subjectName || "",
      requirementIndexesByTask: {},
    },
    choices: resolution.labels.map((label, index) => ({ index: index + 1, label })),
  };
}

export async function createPublicExamAssistantResponse({
  message,
  context = {},
  listTasks,
  listSessions,
  getTask,
  fetchSessionRows,
  now = new Date(),
} = {}) {
  const question = text(message);
  if (!question) {
    return { ok: false, status: 400, error: "请输入要查询的考试问题。" };
  }
  if (question.length > 500) {
    return { ok: false, status: 400, error: "单次问题不能超过 500 个字符。" };
  }
  const safe = safeContext(context);
  const [tasksResult, sessionsResult] = await Promise.all([listTasks(), listSessions()]);
  const tasks = Array.isArray(tasksResult) ? tasksResult : [];
  const sessions = Array.isArray(sessionsResult) ? sessionsResult : [];
  if (!tasks.length) {
    return {
      ok: true,
      kind: "answer",
      answer: "当前还没有可查询的考试项目。",
      context: { selectedTaskIds: [], pendingTaskIds: [], lastSessionTypes: [], dateKey: "", subjectName: "" },
      results: [],
    };
  }

  const resolution = resolveTargets({ tasks, sessions, message: question, context: safe, now });
  if (resolution.kind === "prompt") {
    const listGuidance = requestsCandidateList(question)
      ? "请先告诉我考试名称、项目编号或正考日期，例如“8月8日的考试”。查到考试后，可以继续问“还有谁没考”“缺考名单”或“没参加的发我”。"
      : "请告诉我考试名称、项目编号或正考日期，例如“8月8日的考试情况”或“项目名称 + 正考情况”。";
    return {
      ok: true,
      kind: "prompt",
      answer: listGuidance,
      context: safe,
      results: [],
    };
  }
  if (resolution.kind === "not_found") {
    const target = resolution.mode === "date"
      ? `正考日期为 ${formatDateKey(resolution.dateKey)}的项目`
      : `“${resolution.hint || question}”对应的考试`;
    return {
      ok: true,
      kind: "not_found",
      answer: `没有找到${target}，请补充更完整的考试名称、项目编号或日期。可以这样问：“8月8日的考试情况”或“完整考试名称 + 谁没考”。`,
      context: { ...safe, pendingTaskIds: [] },
      results: [],
    };
  }
  if (resolution.kind === "choices") return choiceResponse(resolution, safe);

  const details = (await Promise.all(resolution.taskIds.map((taskId) => getTask(taskId))))
    .filter(Boolean);
  const results = await Promise.all(details.map(async (task) => {
    const allowedRequirementIndexes = resolution.requirementIndexesByTask?.[text(task.taskId)];
    const taskSessions = (Array.isArray(task.sessions) ? task.sessions : sessionsForTask(task.taskId, sessions))
      .filter((session) => (
        resolution.types.includes(session.sessionType)
        && text(session.session_id)
        && (!Array.isArray(allowedRequirementIndexes)
          || allowedRequirementIndexes.includes(Number(session.requirementIndex || 0)))
      ));
    const sessionResults = await Promise.all(taskSessions.map(async (session) => {
      try {
        const payload = await fetchSessionRows({ task, session });
        const rows = Array.isArray(payload) ? payload : payload?.rows || [];
        return summarizeAssistantSession({
          session,
          rows,
          subjectNames: payload?.subjectNames || payload?.subjects || [],
          now,
          includeCandidates: resolution.includeCandidateList,
        });
      } catch {
        return {
          sessionId: text(session.session_id),
          sessionType: session.sessionType === "trial" ? "trial" : "formal",
          name: text(session.name),
          start: text(session.start),
          end: text(session.end),
          available: false,
        };
      }
    }));
    return {
      taskId: text(task.taskId),
      projectName: text(task.projectName),
      examName: text(task.examName || task.config?.examName),
      projectCode: text(task.projectCode || task.config?.projectCode),
      sessions: sessionResults,
    };
  }));

  const nextContext = {
    selectedTaskIds: results.map((result) => result.taskId),
    pendingTaskIds: [],
    lastSessionTypes: resolution.types,
    dateKey: resolution.dateKey || "",
    subjectName: resolution.subjectName || "",
    requirementIndexesByTask: resolution.requirementIndexesByTask || {},
  };
  return {
    ok: true,
    kind: "answer",
    answer: buildAnswer({ results, resolution, now }),
    context: nextContext,
    results,
    downloads: candidateListDownloads(results, resolution),
  };
}
