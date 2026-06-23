import crypto from "node:crypto";

const REQUIRED_FIELD_LABELS = {
  exam_name: "考试名称",
  formal_exam_time_range: "正式考试时间",
  mock_exam_time_range: "试考时间",
  early_login_minutes: "提前登录规则",
  late_limit_minutes: "迟到限制",
  video_monitor_required: "视频监控要求",
  video_record_required: "视频录制要求",
  hawkeye_required: "鹰眼要求",
  exam_client_type: "考试端类型",
  leave_limit_count: "允许离开次数",
  subjects: "考试科目",
};

export function loadWechatGroupConfig(input) {
  const raw = typeof input === "string" ? JSON.parse(input) : input || {};
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  return {
    groups: groups.map((group) => ({
      groupName: String(group.group_name || group.groupName || "").trim(),
      projectName: String(group.project_name || group.projectName || "").trim(),
      customerName: String(group.customer_name || group.customerName || "").trim(),
      enabled: group.enabled !== false,
      intervalMinutes: Number(group.interval_minutes || group.intervalMinutes || 15),
    })).filter((group) => group.groupName),
  };
}

export function buildWechatRequirementDraft({ config, groupName, text }) {
  const group = findGroup(config, groupName);
  const parsed = parseWechatRequirementMessages(text);
  return {
    source: {
      type: "wechat_group",
      groupName: group.groupName,
      collectedAt: new Date().toISOString(),
    },
    project: {
      projectName: group.projectName || group.groupName,
      customerName: group.customerName || "",
    },
    ...parsed,
  };
}

export function parseWechatRequirementMessages(text) {
  const normalizedText = normalizeText(text);
  const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);
  const messages = lines.map((line, index) => ({ index: index + 1, text: line }));
  const requirement = {};
  const changeRecords = [];

  requirement.exam_name = firstMatch(normalizedText, [
    /考试名称(?:是|为|叫|[:：])\s*([^。\n，,；;]+)/,
    /考试(?:叫|名为)\s*([^。\n，,；;]+)/,
  ]);
  requirement.formal_exam_time_range = firstMatch(normalizedText, [
    /正式考试\s*([^。\n，,；;]+)/,
    /正式(?:时间|考试时间)(?:是|为|[:：])?\s*([^。\n，,；;]+)/,
  ]);
  requirement.mock_exam_time_range = firstMatch(normalizedText, [
    /试考\s*([^。\n，,；;]+)/,
    /试考时间(?:是|为|[:：])?\s*([^。\n，,；;]+)/,
  ]);

  const subjectText = firstMatch(normalizedText, [
    /科目(?:是|为|[:：])\s*([^。\n；;]+)/,
    /考试科目(?:是|为|[:：])\s*([^。\n；;]+)/,
  ]);
  if (subjectText) requirement.subjects = normalizeSubjects(subjectText);

  const addedSubjects = collectAddedSubjects(lines, changeRecords);
  if (addedSubjects.length) {
    const existing = Array.isArray(requirement.subjects) ? requirement.subjects : [];
    requirement.subjects = unique([...existing, ...addedSubjects]);
  }

  if (/不需要鹰眼|不用鹰眼|无需鹰眼/.test(normalizedText)) requirement.hawkeye_required = "否";
  else if (/需要鹰眼|开启鹰眼|鹰眼/.test(normalizedText)) requirement.hawkeye_required = "是";

  if (/需要视频监控|开启视频监控|视频监控/.test(normalizedText)) requirement.video_monitor_required = "是";
  if (/不需要视频监控|不用视频监控|无需视频监控/.test(normalizedText)) requirement.video_monitor_required = "否";
  if (/需要(?:视频)?录制|开启(?:视频)?录制|视频监控和录制|录制/.test(normalizedText)) requirement.video_record_required = "是";
  if (/不需要(?:视频)?录制|不用(?:视频)?录制|无需(?:视频)?录制/.test(normalizedText)) requirement.video_record_required = "否";

  if (/网页考试|浏览器考试/.test(normalizedText)) requirement.exam_client_type = "网页考试";
  else if (/客户端考试|锁定考试/.test(normalizedText)) requirement.exam_client_type = "客户端考试";

  const leaveCount = firstNumberMatch(normalizedText, /允许离开\s*([0-9一二三四五六七八九十]+)\s*次/);
  if (leaveCount !== null) requirement.leave_limit_count = leaveCount;

  const earlyLogin = firstNumberMatch(normalizedText, /提前\s*([0-9一二三四五六七八九十]+)\s*分钟/);
  if (earlyLogin !== null) requirement.early_login_minutes = `${earlyLogin}分钟`;

  const lateLimit = firstNumberMatch(normalizedText, /迟到\s*([0-9一二三四五六七八九十]+)\s*分钟/);
  if (lateLimit !== null) requirement.late_limit_minutes = `${lateLimit}分钟`;

  return {
    requirement,
    unresolvedQuestions: buildUnresolvedQuestions(requirement),
    changeRecords,
    messages,
    checkpoint: {
      messageCount: messages.length,
      lastMessageHash: sha256(lines.at(-1) || normalizedText),
    },
  };
}

function findGroup(config, groupName) {
  const groups = config?.groups || [];
  const group = groups.find((item) => item.enabled && item.groupName === groupName);
  if (!group) {
    throw new Error(`未找到已启用的微信群配置：${groupName}`);
  }
  return group;
}

function normalizeText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanupValue(match[1]);
  }
  return undefined;
}

function cleanupValue(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/[。；;，,]$/g, "").trim();
}

function normalizeSubjects(value) {
  const subjectOnly = String(value || "").split(/，需要|,需要|，不需要|,不需要|，网页|,网页|，客户端|,客户端/)[0];
  return unique(subjectOnly.split(/和|、|,|，|;|；|\s+/).map((item) => item.trim()).filter(Boolean));
}

function collectAddedSubjects(lines, changeRecords) {
  const subjects = [];
  for (const line of lines) {
    if (!/变更|调整|增加|新增|加/.test(line)) continue;
    const match = line.match(/科目(?:增加|新增|加|调整为)?\s*([^。\n，,；;]+)/);
    if (!match?.[1]) continue;
    const added = normalizeSubjects(match[1].replace(/^增加|^新增|^加/, ""));
    if (!added.length) continue;
    subjects.push(...added);
    changeRecords.push({
      type: "subject_change",
      message: line,
      changes: { subjects: added },
    });
  }
  return subjects;
}

function buildUnresolvedQuestions(requirement) {
  return Object.entries(REQUIRED_FIELD_LABELS)
    .filter(([field]) => {
      const value = requirement[field];
      return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    })
    .map(([, label]) => `请确认${label}。`);
}

function firstNumberMatch(text, pattern) {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  return parseChineseNumber(match[1]);
}

function parseChineseNumber(value) {
  if (/^\d+$/.test(String(value))) return Number(value);
  const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const text = String(value);
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (map[tens] || 1) * 10 + (map[ones] || 0);
  }
  return map[text] ?? Number(value);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
