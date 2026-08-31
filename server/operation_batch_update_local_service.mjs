import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { operationBatchCodeIsValid } from "./operation_batch.mjs";
import {
  applyOperationBatchManagedResult,
  buildDesiredOperationBatchSnapshot,
  normalizedOperationBatchInspectedSnapshot,
  normalizedOperationBatchManagedSnapshot,
  operationBatchManagedDiff,
  operationBatchUpdateState,
} from "./operation_batch_update.mjs";
import { differingManagedFields } from "./operation_batch_update_service.mjs";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const PREPARATION_TTL_MS = 15 * 60 * 1000;
const TERMINAL_ATTEMPT_STATUSES = new Set(["succeeded", "conflict", "failed"]);

function text(value) {
  return String(value ?? "").trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function comparableUpdateSnapshot(snapshot, changes = []) {
  const comparable = structuredClone(snapshot);
  if (!changes.some((change) => change?.path === "servicePersonnel")) {
    delete comparable.servicePersonnel;
  }
  return comparable;
}

function tokenHash(value) {
  return createHash("sha256").update(text(value)).digest("hex");
}

function tokenMatches(token, expectedHash) {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(text(expectedHash), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function normalizedActor(actor = {}) {
  return {
    email: text(actor.email).toLowerCase(),
    role: text(actor.role),
  };
}

function actorFingerprint(actor) {
  return fingerprint(normalizedActor(actor));
}

function canAccess(task, actor = {}) {
  if (!actor?.role || actor.role === "admin") return true;
  return Boolean(text(task?.ownerEmail))
    && text(task.ownerEmail).toLowerCase() === text(actor.email).toLowerCase();
}

function serviceError(code, status, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, detail);
  return error;
}

function assertTask(task, actor) {
  if (!task || !canAccess(task, actor)) {
    throw serviceError("OPERATION_BATCH_UPDATE_NOT_FOUND", 404, "运营批次修改任务不存在");
  }
  return task;
}

function batchCode(task = {}) {
  const code = text(task.config?.operationBatchCode || task.config?.operationBatch?.code);
  if (!operationBatchCodeIsValid(code)) {
    throw serviceError("OPERATION_BATCH_CODE_REQUIRED", 409, "缺少有效的运控批次代码");
  }
  return code;
}

function batchReference(task, code) {
  const current = task.config?.operationBatch || {};
  return {
    code,
    ...(text(current.batchName) ? { name: text(current.batchName) } : {}),
    ...(text(current.detailUrl) ? { detailUrl: text(current.detailUrl) } : {}),
  };
}

function desiredSnapshot(task = {}) {
  const desired = buildDesiredOperationBatchSnapshot(task);
  if (!desired.complete) {
    throw serviceError(
      "OPERATION_BATCH_SCHEDULE_INCOMPLETE",
      409,
      "运营批次日程尚未完整，不能更新",
      { missing: desired.missing },
    );
  }
  return normalizedOperationBatchManagedSnapshot(desired.snapshot);
}

function appliedSnapshot(task = {}) {
  const value = task.config?.operationBatch?.managedSnapshot;
  return value && typeof value === "object" && !Array.isArray(value)
    ? normalizedOperationBatchInspectedSnapshot(value)
    : null;
}

function taskVersion(task = {}) {
  const requirements = Array.isArray(task.config?.examRequirements)
    ? task.config.examRequirements
    : task.config?.examRequirement?.fields
      ? [task.config.examRequirement]
      : [];
  return stableJson({
    fanwei: Number(task.config?.fanweiSource?.version || 0),
    requirements: requirements.map((requirement, index) => ({
      id: text(requirement?.id || `requirement-${index + 1}`),
      version: Number(requirement?.version || 0),
    })),
  });
}

function resultPayload(input = {}, key) {
  const helperResult = input.helperResult || input;
  return helperResult?.[key] || helperResult;
}

function serializedError(result = {}, fallbackCode, fallbackMessage) {
  return {
    code: text(result.errorCode) || fallbackCode,
    message: text(result.errorMessage) || fallbackMessage,
    ...(Array.isArray(result.differingFields) && result.differingFields.length
      ? { differingFields: structuredClone(result.differingFields) }
      : {}),
  };
}

function replaceAttempt(operationBatch = {}, attemptId, update) {
  const attempts = Array.isArray(operationBatch.updateAttempts)
    ? structuredClone(operationBatch.updateAttempts)
    : [];
  const index = attempts.findIndex((attempt) => attempt.attemptId === attemptId);
  if (index < 0) {
    throw serviceError(
      "OPERATION_BATCH_ATTEMPT_NOT_FOUND",
      404,
      "运营批次修改尝试不存在",
    );
  }
  attempts[index] = { ...attempts[index], ...structuredClone(update) };
  return attempts;
}

export function createOperationBatchLocalUpdateService(dependencies = {}) {
  const {
    readTask,
    updateTaskConfig,
    assertAutomationEnabled = () => {},
    now = Date.now,
    makePreparationId = randomUUID,
    makeAttemptId = randomUUID,
    makePreviewToken = () => randomBytes(32).toString("base64url"),
    preparations = new Map(),
  } = dependencies;

  async function readAuthorized(taskId, actor) {
    return assertTask(await readTask(taskId), actor);
  }

  async function persistOperationBatch(taskId, operationBatch) {
    return updateTaskConfig(taskId, { operationBatch });
  }

  function cleanupPreparations() {
    const currentTime = now();
    for (const [preparationId, preparation] of preparations) {
      if (preparation.expiresAt <= currentTime) preparations.delete(preparationId);
    }
  }

  function activePreparation(taskId, kind, expectedActorFingerprint = "") {
    cleanupPreparations();
    for (const [preparationId, preparation] of preparations) {
      if (
        preparation.taskId === taskId
        && preparation.kind === kind
        && (!expectedActorFingerprint || preparation.actorFingerprint === expectedActorFingerprint)
      ) {
        return { preparationId, preparation };
      }
    }
    return null;
  }

  function checkedPreparation(taskId, input, actor, kind) {
    cleanupPreparations();
    const preparationId = text(input.preparationId);
    const preparation = preparations.get(preparationId);
    if (
      !preparation
      || preparation.taskId !== taskId
      || preparation.kind !== kind
      || preparation.actorFingerprint !== actorFingerprint(actor)
    ) {
      throw serviceError(
        "OPERATION_BATCH_PREPARATION_STALE",
        409,
        "运营批次更新准备信息已失效，请重新检查",
      );
    }
    return { preparationId, preparation };
  }

  async function state(taskId, actor) {
    const task = await readAuthorized(taskId, actor);
    const desired = buildDesiredOperationBatchSnapshot(task);
    const localState = operationBatchUpdateState(task);
    return {
      taskId,
      state: localState,
      desiredSnapshot: desired.snapshot,
      appliedSnapshot: task.config?.operationBatch?.managedSnapshot || null,
      missing: desired.missing,
      pageStatus: text(task.config?.operationBatch?.status) || localState.status,
    };
  }

  async function preparePreview(taskId, actor) {
    assertAutomationEnabled();
    const task = await readAuthorized(taskId, actor);
    const code = batchCode(task);
    const desired = desiredSnapshot(task);
    const applied = appliedSnapshot(task);
    const version = taskVersion(task);
    const desiredFingerprint = fingerprint(desired);
    const currentActorFingerprint = actorFingerprint(actor);
    const preparationId = text(makePreparationId());
    const includeServicePersonnel = !applied || operationBatchManagedDiff(applied, desired)
      .some((change) => change?.path === "servicePersonnel");
    const instruction = {
      batch: batchReference(task, code),
      includeServicePersonnel,
    };
    const preparation = {
      kind: "preview",
      taskId,
      actorFingerprint: currentActorFingerprint,
      taskVersion: version,
      desiredFingerprint,
      instruction,
      expiresAt: now() + PREPARATION_TTL_MS,
    };
    preparations.set(preparationId, preparation);
    return { preparationId, preparation, instruction };
  }

  async function completePreview(taskId, input, actor) {
    const { preparationId, preparation } = checkedPreparation(taskId, input, actor, "preview");
    const result = resultPayload(input, "operationBatchInspection");
    if (result?.status !== "success" || !result.snapshot) {
      throw serviceError(
        text(result?.errorCode) || "OPERATION_BATCH_INSPECTION_FAILED",
        409,
        text(result?.errorMessage) || "未能读取运营批次当前信息",
      );
    }
    let inspected;
    try {
      inspected = normalizedOperationBatchInspectedSnapshot(result.snapshot);
    } catch (error) {
      throw serviceError(
        "OPERATION_BATCH_INSPECTION_INVALID",
        409,
        error instanceof Error ? error.message : String(error),
      );
    }
    const task = await readAuthorized(taskId, actor);
    const desired = desiredSnapshot(task);
    if (
      taskVersion(task) !== preparation.taskVersion
      || fingerprint(desired) !== preparation.desiredFingerprint
    ) {
      preparations.delete(preparationId);
      throw serviceError(
        "OPERATION_BATCH_PREVIEW_STALE",
        409,
        "运营批次检查已过期：项目在检查期间发生变化",
      );
    }
    const applied = appliedSnapshot(task);
    const comparableInspected = structuredClone(inspected);
    if (
      applied
      && Object.hasOwn(applied, "servicePersonnel")
      && !Object.hasOwn(comparableInspected, "servicePersonnel")
    ) {
      comparableInspected.servicePersonnel = applied.servicePersonnel;
    }
    const changes = operationBatchManagedDiff(comparableInspected, desired);
    const appliedDifferences = applied
      ? differingManagedFields(applied, comparableInspected)
      : [];
    if (comparableInspected.schedules.length > desired.schedules.length) {
      throw serviceError(
        "OPERATION_BATCH_UPDATE_CONFLICT",
        409,
        "不允许减少已存在的运营批次日程数量",
        { differingFields: differingManagedFields(desired, comparableInspected) },
      );
    }
    const current = task.config?.operationBatch || {};
    preparations.delete(preparationId);
    if (!changes.length) {
      const alreadyManuallyAligned = appliedDifferences.length > 0;
      const upgradesLegacyPersonnelBaseline = Boolean(
        applied
        && Object.hasOwn(desired, "servicePersonnel")
        && !Object.hasOwn(applied, "servicePersonnel"),
      );
      const patch = !applied || upgradesLegacyPersonnelBaseline || alreadyManuallyAligned
        ? applyOperationBatchManagedResult(task, {
          verified: true,
          snapshot: comparableInspected,
          action: alreadyManuallyAligned
            ? "verified_current"
            : upgradesLegacyPersonnelBaseline ? "baseline_upgrade" : "baseline",
          syncedAt: nowIso(now),
          detailUrl: result.detailUrl,
          checkpoints: result.checkpoints,
        })
        : { operationBatch: current };
      const updatedTask = await persistOperationBatch(taskId, {
        ...patch.operationBatch,
        status: "success",
        scheduleStatus: "synced",
        scheduleErrorCode: "",
        scheduleErrorMessage: "",
        activeUpdatePreview: null,
        errorCode: "",
        errorMessage: "",
        updatedAt: nowIso(now),
      });
      return {
        action: "none",
        changes: [],
        inspectedCurrent: comparableInspected,
        desiredSnapshot: desired,
        task: updatedTask,
      };
    }
    if (appliedDifferences.length) {
      throw serviceError(
        "OPERATION_BATCH_UPDATE_CONFLICT",
        409,
        "运控当前信息与上次已确认快照不一致，请人工核对",
        { differingFields: appliedDifferences, inspectedCurrent: comparableInspected },
      );
    }
    const previewToken = text(makePreviewToken());
    const activeUpdatePreview = {
      tokenHash: tokenHash(previewToken),
      taskVersion: preparation.taskVersion,
      desiredFingerprint: preparation.desiredFingerprint,
      inspectedCurrentFingerprint: fingerprint(comparableInspected),
      actorFingerprint: preparation.actorFingerprint,
      changes: structuredClone(changes),
      inspectedCurrent: structuredClone(comparableInspected),
      createdAt: nowIso(now),
      expiresAt: new Date(now() + PREVIEW_TTL_MS).toISOString(),
    };
    const updatedTask = await persistOperationBatch(taskId, {
      ...current,
      status: "update_available",
      activeUpdatePreview,
      updatedAt: nowIso(now),
    });
    return {
      action: "update",
      previewToken,
      expiresAt: activeUpdatePreview.expiresAt,
      changes,
      inspectedCurrent: comparableInspected,
      desiredSnapshot: desired,
      task: updatedTask,
    };
  }

  async function prepareUpdate(taskId, input, actor) {
    assertAutomationEnabled();
    const previewToken = text(input.previewToken);
    const active = activePreparation(taskId, "update");
    if (active) {
      if (active.preparation.actorFingerprint !== actorFingerprint(actor)) {
        throw serviceError(
          "OPERATION_BATCH_UPDATE_LOCKED",
          409,
          "该项目正在另一台电脑上更新运营批次，请稍后重试",
        );
      }
      if (!tokenMatches(previewToken, active.preparation.previewTokenHash)) {
        throw serviceError("OPERATION_BATCH_PREVIEW_STALE", 409, "运营批次预览已过期，请重新检查");
      }
      return { ...active, instruction: active.preparation.instruction };
    }
    const task = await readAuthorized(taskId, actor);
    const code = batchCode(task);
    const desired = desiredSnapshot(task);
    const current = task.config?.operationBatch || {};
    const preview = current.activeUpdatePreview;
    if (
      !preview
      || !tokenMatches(previewToken, preview.tokenHash)
      || preview.actorFingerprint !== actorFingerprint(actor)
      || Date.parse(preview.expiresAt) <= now()
      || preview.taskVersion !== taskVersion(task)
      || preview.desiredFingerprint !== fingerprint(desired)
      || preview.inspectedCurrentFingerprint !== fingerprint(preview.inspectedCurrent)
      || !Array.isArray(preview.changes)
      || !preview.changes.length
    ) {
      throw serviceError("OPERATION_BATCH_PREVIEW_STALE", 409, "运营批次预览已过期，请重新检查");
    }
    const applied = appliedSnapshot(task);
    if (applied && differingManagedFields(applied, preview.inspectedCurrent).length) {
      throw serviceError("OPERATION_BATCH_PREVIEW_STALE", 409, "已应用快照在确认前发生变化，请重新检查");
    }
    const activeAttempt = (current.updateAttempts || []).find((attempt) => (
      !TERMINAL_ATTEMPT_STATUSES.has(attempt.status)
    ));
    if (activeAttempt) {
      throw serviceError("OPERATION_BATCH_UPDATE_IN_PROGRESS", 409, "运营批次更新正在执行");
    }
    const attemptId = text(makeAttemptId());
    const preparationId = text(makePreparationId());
    const instruction = {
      batch: {
        ...batchReference(task, code),
        expectedAppliedSnapshot: structuredClone(preview.inspectedCurrent),
      },
      desiredSnapshot: structuredClone(desired),
      changes: structuredClone(preview.changes),
    };
    const attempt = {
      attemptId,
      status: "pending",
      checkpoint: "awaiting_local_helper",
      desiredSnapshot: structuredClone(desired),
      inspectedBefore: structuredClone(preview.inspectedCurrent),
      inspectedAfter: null,
      changes: structuredClone(preview.changes),
      actor: normalizedActor(actor),
      createdAt: nowIso(now),
      completedAt: null,
      error: null,
    };
    const preparation = {
      kind: "update",
      taskId,
      attemptId,
      actorFingerprint: actorFingerprint(actor),
      previewTokenHash: tokenHash(previewToken),
      instruction,
      expiresAt: now() + PREPARATION_TTL_MS,
    };
    preparations.set(preparationId, preparation);
    try {
      const updatedTask = await persistOperationBatch(taskId, {
        ...current,
        status: "updating",
        activeUpdatePreview: null,
        updateAttempts: [
          ...(Array.isArray(current.updateAttempts) ? current.updateAttempts : []),
          attempt,
        ],
        updatedAt: nowIso(now),
      });
      return { preparationId, preparation, instruction, attemptId, task: updatedTask };
    } catch (error) {
      preparations.delete(preparationId);
      throw error;
    }
  }

  async function completeUpdate(taskId, input, actor) {
    const { preparationId, preparation } = checkedPreparation(taskId, input, actor, "update");
    const result = resultPayload(input, "operationBatchUpdate");
    const task = await readAuthorized(taskId, actor);
    const current = task.config?.operationBatch || {};
    const desired = normalizedOperationBatchManagedSnapshot(preparation.instruction.desiredSnapshot);
    const expected = normalizedOperationBatchInspectedSnapshot(
      preparation.instruction.batch.expectedAppliedSnapshot,
    );
    let inspectedAfter = null;
    const rawSnapshot = result?.snapshot || result?.inspectedAfter || result?.actual;
    if (rawSnapshot) {
      try {
        inspectedAfter = normalizedOperationBatchInspectedSnapshot(rawSnapshot);
      } catch {
        inspectedAfter = null;
      }
    }
    const changes = preparation.instruction.changes || [];
    const reachedDesired = inspectedAfter
      && fingerprint(comparableUpdateSnapshot(inspectedAfter, changes))
        === fingerprint(comparableUpdateSnapshot(desired, changes));
    const verifiedSuccess = result?.status === "success" && result?.verified === true && reachedDesired;
    const completedAt = nowIso(now);
    let updatedTask;
    if (verifiedSuccess || reachedDesired) {
      const patch = applyOperationBatchManagedResult(task, {
        verified: true,
        snapshot: desired,
        action: "update",
        syncedAt: completedAt,
        detailUrl: result.detailUrl,
        checkpoints: result.checkpoints || (verifiedSuccess ? [] : ["reconciled_exact_readback"]),
      });
      updatedTask = await persistOperationBatch(taskId, {
        ...patch.operationBatch,
        status: "success",
        scheduleStatus: "synced",
        scheduleErrorCode: "",
        scheduleErrorMessage: "",
        activeUpdatePreview: null,
        updateAttempts: replaceAttempt(patch.operationBatch, preparation.attemptId, {
          status: "succeeded",
          checkpoint: "completed",
          inspectedAfter: structuredClone(desired),
          completedAt,
          error: null,
        }),
        errorCode: "",
        errorMessage: "",
        updatedAt: completedAt,
      });
    } else {
      const unchanged = inspectedAfter
        && fingerprint(comparableUpdateSnapshot(inspectedAfter, changes))
          === fingerprint(comparableUpdateSnapshot(expected, changes));
      const conflict = Boolean(inspectedAfter && !unchanged);
      const error = serializedError(
        result,
        conflict ? "OPERATION_BATCH_UPDATE_CONFLICT" : "OPERATION_BATCH_UPDATE_FAILED",
        conflict
          ? "运营批次更新后状态不明确，请人工核对"
          : "运营批次未发生变化，可以重新检查后再试",
      );
      updatedTask = await persistOperationBatch(taskId, {
        ...current,
        status: conflict ? "update_conflict" : "update_failed",
        activeUpdatePreview: null,
        updateAttempts: replaceAttempt(current, preparation.attemptId, {
          status: conflict ? "conflict" : "failed",
          checkpoint: conflict ? "manual_review" : "safe_retry",
          inspectedAfter: inspectedAfter ? structuredClone(inspectedAfter) : null,
          completedAt,
          error,
        }),
        errorCode: error.code,
        errorMessage: error.message,
        updatedAt: completedAt,
      });
    }
    preparations.delete(preparationId);
    const attempt = (updatedTask.config?.operationBatch?.updateAttempts || [])
      .find((item) => item.attemptId === preparation.attemptId);
    return { task: updatedTask, attempt, completed: true };
  }

  async function attempt(taskId, attemptId, actor) {
    const task = await readAuthorized(taskId, actor);
    const current = (task.config?.operationBatch?.updateAttempts || [])
      .find((item) => item.attemptId === attemptId);
    if (!current) {
      throw serviceError("OPERATION_BATCH_ATTEMPT_NOT_FOUND", 404, "运营批次修改尝试不存在");
    }
    return {
      task,
      attempt: structuredClone(current),
      completed: TERMINAL_ATTEMPT_STATUSES.has(current.status),
    };
  }

  return {
    state,
    preparePreview,
    completePreview,
    prepareUpdate,
    completeUpdate,
    attempt,
  };
}
