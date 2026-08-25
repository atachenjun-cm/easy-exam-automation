import {
  normalizedOperationBatchInspectedSnapshot,
  normalizedOperationBatchManagedSnapshot,
} from "./operation_batch_update.mjs";
import { operationBatchCodeIsValid } from "./operation_batch.mjs";

const ACTION = "请先在建批次环节完成批次创建并记录批次代码";

function blocked(code, status, detail) {
  return {
    ok: false,
    code,
    status,
    message: `${detail}，${ACTION}`,
    managedSnapshot: null,
    schedules: [],
  };
}

export function operationPersonnelScheduleGate(task = {}) {
  const operationBatchCode = String(
    task.config?.operationBatchCode || task.config?.operationBatch?.code || "",
  ).trim();
  if (!operationBatchCodeIsValid(operationBatchCode)) {
    return blocked("PERSONNEL_BATCH_CODE_REQUIRED", "waiting_batch", "运营批次代码尚未记录");
  }

  const rawManagedSnapshot = task.config?.operationBatch?.managedSnapshot;
  if (!rawManagedSnapshot) {
    return {
      ok: true,
      code: "",
      status: "ready",
      message: "",
      managedSnapshot: null,
      schedules: [],
    };
  }

  try {
    const emptyScheduleBaseline = Array.isArray(rawManagedSnapshot.schedules)
      && rawManagedSnapshot.schedules.length === 0;
    const managedSnapshot = emptyScheduleBaseline
      ? normalizedOperationBatchInspectedSnapshot(rawManagedSnapshot)
      : normalizedOperationBatchManagedSnapshot(rawManagedSnapshot);
    return {
      ok: true,
      code: "",
      status: "ready",
      message: "",
      managedSnapshot,
      schedules: structuredClone(managedSnapshot.schedules),
    };
  } catch {
    return blocked("PERSONNEL_BATCH_SCHEDULE_CONFLICT", "conflict", "批次受管日程快照无效");
  }
}
