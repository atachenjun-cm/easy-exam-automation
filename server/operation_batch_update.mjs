import { operationBatchCodeIsValid, operationBatchNeedsReconciliation } from "./operation_batch.mjs";

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

function examRequirements(task = {}) {
  const config = task.config || {};
  if (Array.isArray(config.examRequirements) && config.examRequirements.length) {
    return config.examRequirements;
  }
  return config.examRequirement?.fields ? [config.examRequirement] : [];
}

function validDateParts(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function dateParts(value) {
  const match = text(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return validDateParts(...parts) ? parts : null;
}

function dateTimeParts(value) {
  const match = text(value).match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = parts;
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  return parts;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateString(parts) {
  if (!parts) return "";
  return `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`;
}

function dateTimeString(parts) {
  if (!parts) return "";
  return `${dateString(parts)}T${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`;
}

function dateTimeValue(parts) {
  return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
}

function numberText(value) {
  const normalized = text(value).replace(/分钟/g, "").trim();
  if (!normalized) return "";
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? String(number) : "";
}

function durationMinutes(startValue, endValue) {
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || endValue <= startValue) return "";
  return String(Math.round((endValue - startValue) / 60000));
}

function parseRange(value) {
  const match = text(value).match(
    /^(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)$/,
  );
  if (!match) return null;
  const startParts = dateTimeParts(match[1]);
  const endParts = dateTimeParts(match[2]);
  if (!startParts || !endParts || dateTimeValue(startParts) >= dateTimeValue(endParts)) return null;
  return {
    start: dateTimeString(startParts),
    end: dateTimeString(endParts),
    startValue: dateTimeValue(startParts),
    endValue: dateTimeValue(endParts),
  };
}

function confirmedBatchName(task = {}) {
  return text(task.config?.operationBatch?.batchName);
}

function hasInvalidReplacementCharacter(value) {
  return text(value).includes("\uFFFD");
}

function repairManagedBatchName(value, current = {}) {
  const managedName = text(value);
  if (!hasInvalidReplacementCharacter(managedName)) return managedName;
  const confirmedName = first(current.batchName, current.name);
  return confirmedName && !hasInvalidReplacementCharacter(confirmedName)
    ? confirmedName
    : managedName;
}

function desiredPersonnelService(task = {}) {
  const value = text(task.config?.businessRequirement?.ata_invigilator_arrangement);
  if (!value) return "";
  return /(?:不需要|无需)/.test(value) ? "不需要" : "在线监考";
}

function legacyManagedPersonnelService(task = {}) {
  const value = text(task.config?.operationBatch?.draft?.fields?.servicePersonnel?.value);
  if (!value) return "";
  return /(?:不需要|无需)/.test(value) ? "不需要" : "在线监考";
}

function parseManagedSchedule(requirement = {}, requirementIndex) {
  const name = text(requirement.fields?.["考试名称"]);
  const range = parseRange(requirement.fields?.["考试日期时间"]);
  const earlyLoginMinutes = numberText(
    requirement.fields?.["提前登录时间"] ?? requirement.config?.earlyLoginMinutes ?? 0,
  ) || "0";
  const remark = text(requirement.fields?.["备注"]);
  const missing = [];
  if (!name) missing.push("考试名称");
  if (!range) missing.push("考试日期时间");
  return {
    requirementIndex,
    name,
    start: range?.start || "",
    end: range?.end || "",
    startValue: range?.startValue,
    endValue: range?.endValue,
    scene: String(requirementIndex + 1),
    code: String(requirementIndex + 1),
    timezone: "东8区",
    durationMinutes: durationMinutes(range?.startValue, range?.endValue),
    earlyLoginMinutes,
    trial: false,
    remark,
    missing,
  };
}

function snapshotFromSchedules(task, schedules) {
  const byStart = [...schedules].sort((left, right) => left.startValue - right.startValue);
  const byEnd = [...schedules].sort((left, right) => left.endValue - right.endValue);
  const servicePersonnel = desiredPersonnelService(task);
  return {
    batchName: confirmedBatchName(task),
    examStartDate: dateString(dateTimeParts(byStart[0]?.start)),
    examEndDate: dateString(dateTimeParts(byEnd.at(-1)?.end)),
    ...(servicePersonnel ? { servicePersonnel } : {}),
    schedules: schedules.map(({ requirementIndex, name, start, end, scene, code, timezone, durationMinutes: duration, earlyLoginMinutes, trial, remark }) => ({
      requirementIndex,
      scene,
      code,
      name,
      start,
      end,
      timezone,
      durationMinutes: duration,
      earlyLoginMinutes,
      trial,
      remark,
    })),
  };
}

export function buildDesiredOperationBatchSnapshot(task = {}) {
  const requirements = examRequirements(task);
  const parsed = requirements.map((requirement, requirementIndex) =>
    parseManagedSchedule(requirement, requirementIndex));
  const missing = parsed
    .filter((item) => item.missing.length)
    .map(({ requirementIndex, missing: fields }) => ({ requirementIndex, fields }));
  if (!requirements.length || missing.length) {
    const servicePersonnel = desiredPersonnelService(task);
    return {
      complete: false,
      missing,
      snapshot: {
        batchName: confirmedBatchName(task),
        examStartDate: "",
        examEndDate: "",
        ...(servicePersonnel ? { servicePersonnel } : {}),
        schedules: [],
      },
    };
  }
  return {
    complete: true,
    missing: [],
    snapshot: snapshotFromSchedules(task, parsed),
  };
}

function formalSessionSchedule(task, session, scheduleIndex, requirements) {
  const sourceRequirementIndex = Number.isInteger(Number(session?.requirementIndex))
    ? Number(session.requirementIndex)
    : scheduleIndex;
  const requirement = requirements[sourceRequirementIndex] || {};
  const startParts = dateTimeParts(first(session?.start, session?.start_time));
  const endParts = dateTimeParts(first(session?.end, session?.end_time));
  const startValue = startParts ? dateTimeValue(startParts) : Number.NaN;
  const endValue = endParts ? dateTimeValue(endParts) : Number.NaN;
  const name = first(session?.name, requirement.fields?.["考试名称"]);
  const missing = [];
  if (!name) missing.push("考试名称");
  if (!startParts || !endParts || startValue >= endValue) missing.push("考试日期时间");
  return {
    requirementIndex: scheduleIndex,
    sourceRequirementIndex,
    scene: String(scheduleIndex + 1),
    code: String(scheduleIndex + 1),
    name,
    start: dateTimeString(startParts),
    end: dateTimeString(endParts),
    startValue,
    endValue,
    timezone: "东8区",
    durationMinutes: durationMinutes(startValue, endValue),
    earlyLoginMinutes: numberText(
      requirement.fields?.["提前登录时间"] ?? requirement.config?.earlyLoginMinutes ?? 0,
    ) || "0",
    trial: false,
    remark: text(requirement.fields?.["备注"]),
    missing,
  };
}

export function buildFormalOperationBatchSnapshot(task = {}) {
  const requirements = examRequirements(task);
  const sessions = (Array.isArray(task.sessions) ? task.sessions : [])
    .filter((session) => text(session?.sessionType || session?.session_type) === "formal")
    .sort((left, right) => {
      const leftIndex = Number(left?.requirementIndex || 0);
      const rightIndex = Number(right?.requirementIndex || 0);
      return leftIndex - rightIndex || text(left?.start).localeCompare(text(right?.start));
    });
  const parsed = sessions.map((session, index) => formalSessionSchedule(task, session, index, requirements));
  const missing = parsed
    .filter((item) => item.missing.length)
    .map(({ requirementIndex, missing: fields }) => ({ requirementIndex, fields }));
  if (!sessions.length || missing.length) {
    return {
      complete: false,
      missing: sessions.length ? missing : [{ requirementIndex: 0, fields: ["正式考试"] }],
      snapshot: {
        batchName: confirmedBatchName(task),
        examStartDate: "",
        examEndDate: "",
        schedules: [],
      },
    };
  }
  const byStart = [...parsed].sort((left, right) => left.startValue - right.startValue);
  const byEnd = [...parsed].sort((left, right) => left.endValue - right.endValue);
  return {
    complete: true,
    missing: [],
    snapshot: {
      batchName: confirmedBatchName(task),
      examStartDate: dateString(dateTimeParts(byStart[0].start)),
      examEndDate: dateString(dateTimeParts(byEnd.at(-1).end)),
      schedules: parsed.map(({ missing: ignored, sourceRequirementIndex: sourceIgnored, startValue: startIgnored, endValue: endIgnored, ...schedule }) => schedule),
    },
  };
}

function normalizedDate(value) {
  return dateString(dateParts(value)) || text(value);
}

function normalizedDateTime(value) {
  return dateTimeString(dateTimeParts(value)) || text(value);
}

function normalizedSnapshotForDiff(snapshot = {}) {
  const schedules = Array.isArray(snapshot.schedules) ? snapshot.schedules : [];
  return {
    batchName: text(snapshot.batchName),
    examStartDate: normalizedDate(snapshot.examStartDate),
    examEndDate: normalizedDate(snapshot.examEndDate),
    ...(Object.hasOwn(snapshot, "servicePersonnel")
      ? { servicePersonnel: text(snapshot.servicePersonnel) }
      : {}),
    schedules: schedules.map((schedule) => ({
      requirementIndex: Number(schedule?.requirementIndex),
      scene: text(schedule?.scene),
      code: text(schedule?.code),
      name: text(schedule?.name),
      start: normalizedDateTime(schedule?.start),
      end: normalizedDateTime(schedule?.end),
      timezone: text(schedule?.timezone),
      durationMinutes: numberText(schedule?.durationMinutes),
      earlyLoginMinutes: numberText(schedule?.earlyLoginMinutes),
      trial: schedule?.trial === true || text(schedule?.trial) === "是",
      remark: text(schedule?.remark),
    })),
  };
}

function managedChange(path, label, before, after, requirementIndex) {
  return {
    path,
    label,
    before,
    after,
    ...(requirementIndex === undefined ? {} : { requirementIndex }),
  };
}

export function operationBatchManagedDiff(applied = {}, desired = {}) {
  const before = normalizedSnapshotForDiff(applied);
  const after = normalizedSnapshotForDiff(desired);
  const changes = [];
  for (const [path, label] of [
    ["batchName", "批次名称"],
    ["examStartDate", "概况考试开始日期"],
    ["examEndDate", "概况考试结束日期"],
  ]) {
    if (before[path] !== after[path]) {
      changes.push(managedChange(path, label, before[path], after[path]));
    }
  }
  if (
    Object.hasOwn(after, "servicePersonnel")
    && before.servicePersonnel !== after.servicePersonnel
  ) {
    changes.push(managedChange(
      "servicePersonnel",
      "人员服务",
      before.servicePersonnel || "",
      after.servicePersonnel,
    ));
  }
  const beforeByIndex = new Map(before.schedules.map((schedule) => [
    schedule.requirementIndex,
    schedule,
  ]));
  for (const schedule of after.schedules) {
    const appliedSchedule = beforeByIndex.get(schedule.requirementIndex) || {};
    for (const [field, label] of [
      ["scene", "场次"],
      ["code", "日程代码"],
      ["name", "考试名称"],
      ["start", "开始时间"],
      ["end", "结束时间"],
      ["timezone", "时区"],
      ["durationMinutes", "时长(分钟)"],
      ["earlyLoginMinutes", "考生提前登录(分钟)"],
      ["trial", "试考"],
      ["remark", "备注"],
    ]) {
      const beforeValue = field === "trial" ? Boolean(appliedSchedule[field]) : text(appliedSchedule[field]);
      const afterValue = field === "trial" ? Boolean(schedule[field]) : text(schedule[field]);
      if (beforeValue !== afterValue) {
        changes.push(managedChange(
          `schedules[${schedule.requirementIndex}].${field}`,
          `日程${schedule.requirementIndex + 1}${label}`,
          beforeValue,
          afterValue,
          schedule.requirementIndex,
        ));
      }
    }
  }
  return changes;
}

function appliedScheduleIdentityConflict(snapshot = {}) {
  if (!Array.isArray(snapshot.schedules)) return false;
  return snapshot.schedules.some((schedule, index) =>
    !Number.isInteger(Number(schedule?.requirementIndex))
    || Number(schedule.requirementIndex) !== index);
}

export function operationBatchUpdateState(task = {}) {
  const current = task.config?.operationBatch || {};
  const batchCode = text(task.config?.operationBatchCode || current.code);
  if (!operationBatchCodeIsValid(batchCode)) {
    return {
      status: operationBatchNeedsReconciliation(task) ? "reconciliation_required" : "ready",
      baselineRequired: false,
      missing: [],
      changes: [],
    };
  }

  const desired = buildDesiredOperationBatchSnapshot(task);
  const hasManagedSnapshot = Boolean(
    current.managedSnapshot
    && typeof current.managedSnapshot === "object"
    && !Array.isArray(current.managedSnapshot),
  );
  const applied = hasManagedSnapshot ? structuredClone(current.managedSnapshot) : {};
  if (Object.hasOwn(applied, "batchName")) {
    applied.batchName = repairManagedBatchName(applied.batchName, current);
  }
  if (!Object.hasOwn(applied, "servicePersonnel")) {
    const legacyPersonnelService = legacyManagedPersonnelService(task);
    if (legacyPersonnelService) applied.servicePersonnel = legacyPersonnelService;
  }
  const desiredScheduleCount = examRequirements(task).length;
  const appliedScheduleCount = Array.isArray(applied.schedules) ? applied.schedules.length : 0;
  const changes = desired.complete ? operationBatchManagedDiff(applied, desired.snapshot) : [];
  let status;
  if (desiredScheduleCount < appliedScheduleCount || appliedScheduleIdentityConflict(applied)) {
    status = "update_conflict";
  } else if (!desired.complete) {
    status = "waiting_schedule";
  } else if (changes.length) {
    status = "update_available";
  } else {
    status = "success";
  }
  return {
    status,
    baselineRequired: !hasManagedSnapshot,
    missing: desired.missing,
    changes,
  };
}

function normalizedOperationBatchSnapshot(snapshot, { requireSchedules = true } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("缺少运营批次受管快照");
  }
  const batchName = text(snapshot.batchName);
  const examStartParts = dateParts(snapshot.examStartDate);
  const examEndParts = dateParts(snapshot.examEndDate);
  const schedules = Array.isArray(snapshot.schedules) ? snapshot.schedules : null;
  if (
    !batchName
    || !examStartParts
    || !examEndParts
    || Date.UTC(...[examStartParts[0], examStartParts[1] - 1, examStartParts[2]])
      > Date.UTC(...[examEndParts[0], examEndParts[1] - 1, examEndParts[2]])
    || !schedules
  ) {
    throw new Error("运营批次受管快照不完整或格式不合法");
  }
  if (requireSchedules && !schedules.length) {
    throw new Error("运营批次受管快照必须包含至少一条完整日程");
  }
  const normalizedSchedules = schedules.map((schedule, index) => {
    const requirementIndex = Number(schedule?.requirementIndex);
    const name = text(schedule?.name);
    const scene = text(schedule?.scene);
    const code = text(schedule?.code);
    const startParts = dateTimeParts(schedule?.start);
    const endParts = dateTimeParts(schedule?.end);
    if (
      !Number.isInteger(requirementIndex)
      || requirementIndex !== index
      || !scene
      || !code
      || !name
      || !startParts
      || !endParts
      || dateTimeValue(startParts) >= dateTimeValue(endParts)
    ) {
      throw new Error("运营批次受管快照不完整或格式不合法");
    }
    return {
      requirementIndex,
      scene,
      code,
      name,
      start: dateTimeString(startParts),
      end: dateTimeString(endParts),
      timezone: text(schedule?.timezone),
      durationMinutes: numberText(schedule?.durationMinutes) || durationMinutes(dateTimeValue(startParts), dateTimeValue(endParts)),
      earlyLoginMinutes: numberText(schedule?.earlyLoginMinutes) || "0",
      trial: schedule?.trial === true || text(schedule?.trial) === "是",
      remark: text(schedule?.remark),
    };
  });
  const examStartDate = dateString(examStartParts);
  const examEndDate = dateString(examEndParts);
  if (normalizedSchedules.length) {
    const scheduleStartDate = [...normalizedSchedules]
      .sort((left, right) => left.start.localeCompare(right.start))[0].start.slice(0, 10);
    const scheduleEndDate = [...normalizedSchedules]
      .sort((left, right) => left.end.localeCompare(right.end)).at(-1).end.slice(0, 10);
    if (examStartDate !== scheduleStartDate || examEndDate !== scheduleEndDate) {
      throw new Error(
        `运营批次受管快照概况日期 ${examStartDate}~${examEndDate} 与日程范围 ${scheduleStartDate}~${scheduleEndDate} 不一致`,
      );
    }
  }
  return {
    batchName,
    examStartDate,
    examEndDate,
    ...(Object.hasOwn(snapshot, "servicePersonnel")
      ? { servicePersonnel: text(snapshot.servicePersonnel) }
      : {}),
    schedules: normalizedSchedules,
  };
}

export function normalizedOperationBatchManagedSnapshot(snapshot) {
  return normalizedOperationBatchSnapshot(snapshot, { requireSchedules: true });
}

export function normalizedOperationBatchInspectedSnapshot(snapshot) {
  return normalizedOperationBatchSnapshot(snapshot, { requireSchedules: false });
}

export function applyOperationBatchManagedResult(task = {}, result = {}) {
  if (result.verified !== true) {
    throw new Error("运营批次受管结果未通过回读验证");
  }
  const current = task.config?.operationBatch || {};
  const snapshot = { ...(result.snapshot || {}) };
  if (
    !Object.hasOwn(snapshot, "servicePersonnel")
    && Object.hasOwn(current.managedSnapshot || {}, "servicePersonnel")
  ) {
    snapshot.servicePersonnel = current.managedSnapshot.servicePersonnel;
  }
  snapshot.batchName = repairManagedBatchName(snapshot.batchName, current);
  if (hasInvalidReplacementCharacter(snapshot.batchName)) {
    throw new Error("运营批次受管快照中的批次名称包含异常字符");
  }
  const managedSnapshot = result.allowEmptySchedules === true
    ? normalizedOperationBatchInspectedSnapshot(snapshot)
    : normalizedOperationBatchManagedSnapshot(snapshot);
  const managedSnapshotVersion = Number(current.managedSnapshotVersion || 0) + 1;
  const lastManagedSyncAt = text(result.syncedAt) || new Date().toISOString();
  const event = {
    type: "operation_batch_managed_sync",
    action: text(result.action) || "sync",
    at: lastManagedSyncAt,
    version: managedSnapshotVersion,
    ...(text(result.detailUrl) ? { detailUrl: text(result.detailUrl) } : {}),
    ...(result.checkpoints === undefined ? {} : {
      checkpoints: Array.isArray(result.checkpoints)
        ? result.checkpoints.slice()
        : { ...result.checkpoints },
    }),
  };
  return {
    operationBatch: {
      ...current,
      ...(text(result.detailUrl) ? { detailUrl: text(result.detailUrl) } : {}),
      managedSnapshot,
      managedSnapshotVersion,
      lastManagedSyncAt,
      managedEvents: [
        ...(Array.isArray(current.managedEvents) ? current.managedEvents : []),
        event,
      ],
    },
  };
}
