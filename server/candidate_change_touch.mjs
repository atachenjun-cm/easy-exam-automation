import { createHash } from "node:crypto";
import { buildMessageCenterRoster, messageCenterContactForCandidate } from "./message_center.mjs";

export function buildCandidateChangeTouchRoster(changeSet = {}, onlineCandidates = []) {
  const afterSnapshot = (changeSet.snapshots || []).find((snapshot) => snapshot.phase === "after");
  if (!afterSnapshot || !["applied", "partial_failed"].includes(changeSet.status)) {
    throw new Error("变更尚未完成线上回读，不能创建新增考生触达任务。");
  }
  const added = (changeSet.items || []).filter((item) => item.operation === "add" && item.status === "success");
  if (!added.length) throw new Error("本次变更没有成功新增的考生。");
  const snapshotByPermit = new Map((afterSnapshot.roster || []).map((row) => [String(row.permit || "").trim(), row]));
  const onlineByPermit = new Map(onlineCandidates.map((row) => [String(row.permit || "").trim(), row]));
  const selected = added.map((item) => {
    const permit = String(item.permit || item.after?.permit || "").trim();
    const snapshot = snapshotByPermit.get(permit);
    const online = onlineByPermit.get(permit);
    if (!snapshot || !online || !item.after) throw new Error(`新增考生 ${permit} 的线上记录不完整，请先核对名单。`);
    const fromChange = buildMessageCenterRoster([item.after]).rows[0];
    const fromSnapshot = buildMessageCenterRoster([snapshot]).rows[0];
    const fromOnline = buildMessageCenterRoster([online]).rows[0];
    if (!fromChange || !fromSnapshot || !fromOnline
      || fromChange.name !== fromSnapshot.name || fromChange.phone !== fromSnapshot.phone
      || fromChange.name !== fromOnline.name || fromChange.phone !== fromOnline.phone) {
      throw new Error(`新增考生 ${permit} 的姓名或手机号已变化，请先核对名单。`);
    }
    return { full_name: fromOnline.name, mobile: fromOnline.phone };
  });
  const roster = buildMessageCenterRoster(selected);
  if (roster.summary.availableSms !== added.length || roster.summary.duplicatePhoneCount) {
    throw new Error("本次新增考生存在无效或重复手机号，请先核对后再创建短信触达任务。");
  }
  const addedPermits = new Set(added.map((item) => String(item.permit || item.after?.permit || "").trim()));
  const oldPhones = new Set(onlineCandidates
    .filter((candidate) => !addedPermits.has(String(candidate.permit || "").trim()))
    .map((candidate) => messageCenterContactForCandidate(candidate).phone)
    .filter(Boolean));
  if (roster.rows.some((row) => oldPhones.has(row.phone))) {
    throw new Error("本次新增考生手机号与原有考生重复，无法保证短信只触达新增考生。");
  }
  return {
    ...roster,
    fingerprint: createHash("sha256").update(JSON.stringify(roster.rows)).digest("hex"),
  };
}
