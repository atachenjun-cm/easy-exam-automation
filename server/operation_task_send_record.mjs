function text(value) {
  return String(value ?? "").trim();
}

const SEND_TYPES = new Set(["首次发送", "再次发送"]);

export function normalizeOperationTaskSendRecords(records = []) {
  return [...(records || [])].flatMap((item) => {
    const type = text(item?.type);
    const sentAt = text(item?.sentAt);
    if (!SEND_TYPES.has(type) || !sentAt) return [];
    return [{ type, sentAt }];
  });
}

export function operationTaskTimelineSendRecord(value) {
  const normalized = text(value).replace(/\s+/g, " ");
  const match = normalized.match(
    /^(首次发送|再次发送)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})$/,
  );
  return match ? { type: match[1], sentAt: match[2] } : null;
}

function recordKey(record = {}) {
  return `${text(record.type)}\0${text(record.sentAt)}`;
}

export function newOperationTaskSendRecords(beforeRecords = [], afterRecords = []) {
  const remaining = new Map();
  for (const record of normalizeOperationTaskSendRecords(beforeRecords)) {
    const key = recordKey(record);
    remaining.set(key, (remaining.get(key) || 0) + 1);
  }
  return normalizeOperationTaskSendRecords(afterRecords).filter((record) => {
    const key = recordKey(record);
    const count = remaining.get(key) || 0;
    if (!count) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

export function findOperationTaskAttemptSendRecord(records = [], attempt = {}) {
  const expectedType = attempt.kind === "resend" ? "再次发送" : "首次发送";
  const startedAt = Date.parse(attempt.startedAt);
  if (!Number.isFinite(startedAt)) return null;
  const candidates = newOperationTaskSendRecords(
    attempt.beforeSendRecords || [],
    records,
  ).filter((record) => {
    if (record.type !== expectedType) return false;
    const sentAt = Date.parse(record.sentAt);
    return Number.isFinite(sentAt)
      && Math.floor(sentAt / 1000) >= Math.floor(startedAt / 1000);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function verifiedInitialOperationTaskSendRecord(records = []) {
  const initial = normalizeOperationTaskSendRecords(records)
    .filter((record) => record.type === "首次发送");
  return initial.length === 1 ? initial[0] : null;
}
