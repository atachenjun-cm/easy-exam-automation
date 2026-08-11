import { randomUUID } from "node:crypto";

import {
  assertOperationContentSyncResult,
  buildOperationContentDraft,
} from "./operation_content.mjs";

const PREPARATION_TTL_MS = 15 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function actorKey(actor = {}) {
  return text(actor.email || actor).toLowerCase() || "local-admin";
}

function serviceError(code, status, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, detail);
  return error;
}

function helperResult(input = {}) {
  const result = input.helperResult || input;
  return result?.operationContentSync || result;
}

export function createOperationContentSyncService(dependencies = {}) {
  const {
    readTask,
    updateTaskConfig,
    assertAutomationEnabled = () => {},
    now = Date.now,
    makePreparationId = randomUUID,
    preparations = new Map(),
  } = dependencies;

  function cleanup() {
    const current = now();
    for (const [id, preparation] of preparations) {
      if (preparation.expiresAt <= current) preparations.delete(id);
    }
  }

  async function task(taskId) {
    const value = await readTask(taskId);
    if (!value) throw serviceError("OPERATION_CONTENT_NOT_FOUND", 404, "内容同步任务不存在");
    return value;
  }

  async function persist(taskId, currentTask, patch) {
    const current = currentTask.config?.operationContentSync || {};
    return await updateTaskConfig(taskId, {
      operationContentSync: {
        ...current,
        ...patch,
        updatedAt: new Date(now()).toISOString(),
      },
    });
  }

  async function state(taskId) {
    const currentTask = await task(taskId);
    return {
      task: currentTask,
      draft: buildOperationContentDraft(currentTask),
      state: currentTask.config?.operationContentSync || {},
    };
  }

  async function prepare(taskId, actor = {}) {
    assertAutomationEnabled();
    cleanup();
    const currentTask = await task(taskId);
    const draft = buildOperationContentDraft(currentTask);
    if (draft.warnings.length) {
      throw serviceError(
        "OPERATION_CONTENT_DRAFT_INCOMPLETE",
        409,
        draft.warnings.map((item) => item.message).join("；"),
        { warnings: draft.warnings },
      );
    }
    const key = actorKey(actor);
    for (const [preparationId, preparation] of preparations) {
      if (preparation.taskId !== taskId) continue;
      if (preparation.actorKey !== key) {
        throw serviceError("OPERATION_CONTENT_SYNC_LOCKED", 409, "该项目正在另一台电脑上同步运控内容，请稍后重试");
      }
      if (preparation.draft.fingerprint === draft.fingerprint) {
        return { preparationId, preparation, task: currentTask };
      }
      preparations.delete(preparationId);
    }
    const preparationId = text(makePreparationId());
    const preparation = {
      taskId,
      actorKey: key,
      draft: structuredClone(draft),
      expiresAt: now() + PREPARATION_TTL_MS,
    };
    preparations.set(preparationId, preparation);
    const updated = await persist(taskId, currentTask, {
      status: "awaiting_local_helper",
      errorCode: "",
      errorMessage: "",
      activePreparationId: preparationId,
      draftFingerprint: draft.fingerprint,
    });
    return { preparationId, preparation, task: updated };
  }

  async function complete(taskId, input = {}, actor = {}) {
    cleanup();
    const preparationId = text(input.preparationId);
    const preparation = preparations.get(preparationId);
    if (!preparation
      || preparation.taskId !== taskId
      || preparation.actorKey !== actorKey(actor)) {
      throw serviceError("OPERATION_CONTENT_PREPARATION_STALE", 409, "运控内容同步准备信息已失效，请重新点击同步");
    }
    const currentTask = await task(taskId);
    const result = helperResult(input);
    if (!result || typeof result !== "object") {
      throw serviceError("OPERATION_CONTENT_RESULT_REQUIRED", 400, "缺少本机助手内容同步结果");
    }
    if (result.status === "failed") {
      preparations.delete(preparationId);
      const updated = await persist(taskId, currentTask, {
        status: "failed",
        errorCode: text(result.errorCode) || "OPERATION_CONTENT_HELPER_FAILED",
        errorMessage: text(result.errorMessage) || "本机助手同步运控内容失败",
        activePreparationId: "",
      });
      throw serviceError(
        text(result.errorCode) || "OPERATION_CONTENT_HELPER_FAILED",
        409,
        text(result.errorMessage) || "本机助手同步运控内容失败",
        { task: updated },
      );
    }
    let snapshot;
    try {
      snapshot = assertOperationContentSyncResult(preparation.draft, result);
    } catch (error) {
      preparations.delete(preparationId);
      const updated = await persist(taskId, currentTask, {
        status: "failed",
        errorCode: text(error.code) || "OPERATION_CONTENT_SYNC_UNVERIFIED",
        errorMessage: error.message || String(error),
        activePreparationId: "",
      });
      error.task = updated;
      throw error;
    }
    preparations.delete(preparationId);
    const currentState = currentTask.config?.operationContentSync || {};
    const syncedAt = new Date(now()).toISOString();
    const updated = await persist(taskId, currentTask, {
      status: "success",
      errorCode: "",
      errorMessage: "",
      activePreparationId: "",
      lastSyncedAt: syncedAt,
      lastSnapshot: snapshot,
      draftFingerprint: preparation.draft.fingerprint,
      checkpoints: Array.isArray(result.checkpoints) ? result.checkpoints : [],
      events: [...(Array.isArray(currentState.events) ? currentState.events : []), {
        type: "operation_content_synced",
        actor: preparation.actorKey,
        createdAt: syncedAt,
      }].slice(-20),
    });
    return { task: updated, state: updated.config?.operationContentSync || {}, snapshot };
  }

  return { state, prepare, complete };
}
