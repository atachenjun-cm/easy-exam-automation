import { randomUUID } from "node:crypto";

import {
  buildOperationContentDispatchTarget,
  buildOperationContentDraft,
  normalizeOperationContentSnapshot,
  operationContentDispatchPreview,
} from "./operation_content.mjs";

const PREPARATION_TTL_MS = 15 * 60 * 1000;
const CHANGE_SUMMARY_MAX_LENGTH = 4000;

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

function sameEmails(actual = [], expected = []) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function assertDispatchResult(
  target = {},
  result = {},
  sendKind = "initial",
  expectedChangeSummary = "",
) {
  const dispatch = result?.dispatch;
  if (dispatch?.status === "already_sent") {
    if (sendKind === "resend") {
      throw serviceError(
        "OPERATION_CONTENT_RESEND_UNVERIFIED",
        409,
        "本次重新发送未回读到新的运控再次发送记录",
      );
    }
    if (dispatch?.confirmed !== true
      || dispatch?.externallyVerified !== true
      || dispatch?.sendRecord?.type !== "首次发送"
      || !text(dispatch?.sendRecord?.sentAt)) {
      throw serviceError(
        "OPERATION_CONTENT_SEND_RECORD_UNVERIFIED",
        409,
        "内容任务单未回读到唯一的运控首次发送记录",
      );
    }
    if (text(dispatch.projectCode) !== text(target.projectCode)) {
      throw serviceError(
        "OPERATION_CONTENT_DISPATCH_MISMATCH",
        409,
        "内容任务单外部发送记录对应的项目编码不一致",
      );
    }
    return dispatch;
  }
  if (dispatch?.status !== "sent" || dispatch?.confirmed !== true) {
    throw serviceError(
      "OPERATION_CONTENT_DISPATCH_UNVERIFIED",
      409,
      "运控内容已同步，但内容任务单未取得明确发送成功结果",
    );
  }
  if (!sameEmails(dispatch.recipients, target.recipients)
    || !sameEmails(dispatch.cc, target.cc)
    || text(dispatch.projectCode) !== text(target.projectCode)) {
    throw serviceError(
      "OPERATION_CONTENT_DISPATCH_MISMATCH",
      409,
      "内容任务单发送结果与本次项目、收件人或抄送不一致",
    );
  }
  const expectedType = sendKind === "resend" ? "再次发送" : "首次发送";
  if (dispatch?.sendRecord?.type !== expectedType || !text(dispatch?.sendRecord?.sentAt)) {
    throw serviceError(
      "OPERATION_CONTENT_SEND_RECORD_UNVERIFIED",
      409,
      `内容任务单未回读到本次${expectedType}记录`,
    );
  }
  if (sendKind === "resend" && text(dispatch.changeSummary) !== text(expectedChangeSummary)) {
    throw serviceError(
      "OPERATION_CONTENT_CHANGE_SUMMARY_MISMATCH",
      409,
      "运控内容任务单回读的变更内容与平台填写内容不一致",
    );
  }
  return dispatch;
}

function operationContentSendKind(state = {}, changeSummary = "") {
  if (state.initialSendVerification?.status === "verified") return "resend";
  if (text(state.lastDispatchedAt) || state.dispatchStatus === "sent") {
    return text(changeSummary) ? "resend" : "verification";
  }
  return "initial";
}

function operationContentChangeSummary(value) {
  const summary = text(value);
  if (summary.length > CHANGE_SUMMARY_MAX_LENGTH) {
    throw serviceError(
      "OPERATION_CONTENT_CHANGE_SUMMARY_TOO_LONG",
      400,
      `内容任务单变更内容不能超过 ${CHANGE_SUMMARY_MAX_LENGTH} 个字符`,
    );
  }
  return summary;
}

function assertContentReadyResult(draft = {}, result = {}) {
  const checkpoints = Array.isArray(result?.checkpoints) ? result.checkpoints : [];
  if (result?.status !== "success"
    || result?.contentReady !== true
    || !checkpoints.includes("content_draft_complete")
    || !checkpoints.includes("content_fields_ready")) {
    throw serviceError(
      "OPERATION_CONTENT_SAVE_UNVERIFIED",
      409,
      "运控配置项或科目信息未确认填写完整",
    );
  }
  const expectedBatch = draft.batch || {};
  const actualBatch = result.batch || {};
  if (text(actualBatch.code) !== text(expectedBatch.code)
    || text(actualBatch.name).replace(/\s+/g, "") !== text(expectedBatch.name).replace(/\s+/g, "")) {
    throw serviceError(
      "OPERATION_CONTENT_BATCH_MISMATCH",
      409,
      "运控内容填写结果对应的批次不一致",
    );
  }
  const changed = {
    configuration: result?.changed?.configuration === true,
    subjects: result?.changed?.subjects === true,
  };
  if ((changed.configuration && !checkpoints.includes("configuration_saved"))
    || (changed.subjects && !checkpoints.includes("subjects_saved"))) {
    throw serviceError(
      "OPERATION_CONTENT_SAVE_UNVERIFIED",
      409,
      "运控配置项或科目信息保存结果不完整",
    );
  }
  return { batch: structuredClone(actualBatch), changed };
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
      dispatchPreview: operationContentDispatchPreview(currentTask),
    };
  }

  async function prepare(taskId, actor = {}, dispatchInput = {}) {
    assertAutomationEnabled();
    cleanup();
    const currentTask = await task(taskId);
    const currentState = currentTask.config?.operationContentSync || {};
    const changeSummary = operationContentChangeSummary(dispatchInput.changeSummary);
    const sendKind = operationContentSendKind(currentState, changeSummary);
    const dispatchPreview = operationContentDispatchPreview(currentTask);
    if (sendKind === "resend" && !changeSummary) {
      throw serviceError(
        "OPERATION_CONTENT_CHANGE_SUMMARY_REQUIRED",
        400,
        "重新发送内容任务单必须填写变更内容",
      );
    }
    if (sendKind === "initial" && changeSummary) {
      throw serviceError(
        "OPERATION_CONTENT_CHANGE_SUMMARY_UNEXPECTED",
        400,
        "首次发送内容任务单不应填写变更内容",
      );
    }
    if (sendKind === "resend" && (
      text(dispatchInput.previewDraftFingerprint) !== dispatchPreview.currentFingerprint
      || text(dispatchInput.previewBaselineFingerprint) !== dispatchPreview.baselineFingerprint
    )) {
      throw serviceError(
        "OPERATION_CONTENT_PREVIEW_STALE",
        409,
        "内容任务配置或上次发送基线已变化，请重新查看变更内容",
      );
    }
    if (currentState.status === "reconciliation_required") {
      throw serviceError(
        "OPERATION_CONTENT_DISPATCH_RECONCILIATION_REQUIRED",
        409,
        "上次内容任务单发送结果不明确，请先在运控核对任务单记录，禁止重复发送",
      );
    }
    const draft = buildOperationContentDraft(currentTask);
    if (draft.warnings.length) {
      throw serviceError(
        "OPERATION_CONTENT_DRAFT_INCOMPLETE",
        409,
        draft.warnings.map((item) => item.message).join("；"),
        { warnings: draft.warnings },
      );
    }
    const dispatchTarget = buildOperationContentDispatchTarget(currentTask, dispatchInput);
    const key = actorKey(actor);
    for (const [preparationId, preparation] of preparations) {
      if (preparation.taskId !== taskId) continue;
      if (preparation.actorKey !== key) {
        throw serviceError("OPERATION_CONTENT_SYNC_LOCKED", 409, "该项目正在另一台电脑上同步运控内容，请稍后重试");
      }
      if (preparation.draft.fingerprint === draft.fingerprint
        && preparation.sendKind === sendKind
        && preparation.changeSummary === changeSummary
        && preparation.previewBaselineFingerprint === dispatchPreview.baselineFingerprint
        && JSON.stringify(preparation.dispatchTarget) === JSON.stringify(dispatchTarget)) {
        return { preparationId, preparation, task: currentTask };
      }
      preparations.delete(preparationId);
    }
    const preparationId = text(makePreparationId());
    const preparation = {
      taskId,
      actorKey: key,
      draft: structuredClone(draft),
      dispatchTarget: structuredClone(dispatchTarget),
      sendKind,
      changeSummary,
      previewBaselineFingerprint: dispatchPreview.baselineFingerprint,
      expiresAt: now() + PREPARATION_TTL_MS,
    };
    preparations.set(preparationId, preparation);
    const updated = await persist(taskId, currentTask, {
      status: "awaiting_local_helper",
      errorCode: "",
      errorMessage: "",
      activePreparationId: preparationId,
      draftFingerprint: draft.fingerprint,
      pendingRecipients: dispatchTarget.recipients,
      pendingCc: dispatchTarget.cc,
      pendingSendKind: sendKind,
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
      const errorCode = text(result.errorCode) || "OPERATION_CONTENT_HELPER_FAILED";
      const reconciliationRequired = errorCode === "OPERATION_CONTENT_DISPATCH_RECONCILIATION_REQUIRED";
      const updated = await persist(taskId, currentTask, {
        status: reconciliationRequired ? "reconciliation_required" : "failed",
        errorCode,
        errorMessage: text(result.errorMessage) || "本机助手同步运控内容失败",
        activePreparationId: "",
      });
      throw serviceError(
        errorCode,
        409,
        text(result.errorMessage) || "本机助手同步运控内容失败",
        { task: updated },
      );
    }
    let submission;
    let dispatch;
    try {
      submission = assertContentReadyResult(preparation.draft, result);
      dispatch = assertDispatchResult(
        preparation.dispatchTarget,
        result,
        preparation.sendKind,
        preparation.changeSummary,
      );
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
    const existingVerification = currentState.initialSendVerification || {};
    const firstSendRecord = dispatch.sendRecord?.type === "首次发送"
      ? dispatch.sendRecord
      : existingVerification.sendRecord;
    const initialSendVerification = firstSendRecord ? {
      status: "verified",
      sendRecord: structuredClone(firstSendRecord),
      verifiedAt: syncedAt,
      evidence: dispatch.status === "already_sent"
        || dispatch.responseVerified !== true
        ? "operation_record_readback"
        : "api_and_operation_record_readback",
    } : existingVerification;
    const dispatchHistory = Array.isArray(currentState.dispatchHistory)
      ? currentState.dispatchHistory
      : [];
    const previousSendCount = Math.max(
      dispatchHistory.length,
      ...dispatchHistory.map((item) => Number(item?.sendNumber || 0)).filter(Number.isFinite),
      currentState.initialSendVerification?.status === "verified"
        || currentState.dispatchStatus === "sent"
        || text(currentState.lastDispatchedAt)
        ? 1
        : 0,
    );
    const sentAt = text(dispatch.sendRecord?.sentAt || dispatch.sentAt) || syncedAt;
    const actualDispatch = dispatch.status === "sent";
    const contentSnapshot = actualDispatch
      ? normalizeOperationContentSnapshot(preparation.draft)
      : null;
    const sendNumber = actualDispatch ? previousSendCount + 1 : Math.max(previousSendCount, 1);
    const historyEntry = {
      sendNumber,
      sendType: preparation.sendKind === "resend" ? "再次发送" : "首次发送",
      sentAt,
      actor: preparation.actorKey,
      recipients: structuredClone(dispatch.recipients || []),
      cc: structuredClone(dispatch.cc || []),
      changeSummary: preparation.changeSummary,
      sendRecord: structuredClone(dispatch.sendRecord || null),
      submission: structuredClone(submission),
      ...(contentSnapshot ? { contentSnapshot } : {}),
    };
    const nextDispatchHistory = dispatchHistory.some((item) => (
      item.sendType === historyEntry.sendType
      && text(item.sentAt) === sentAt
    ))
      ? dispatchHistory
      : [...dispatchHistory, historyEntry];
    const updated = await persist(taskId, currentTask, {
      status: "success",
      errorCode: "",
      errorMessage: "",
      activePreparationId: "",
      lastSyncedAt: syncedAt,
      lastDispatchedAt: text(dispatch.sentAt) || text(firstSendRecord?.sentAt) || syncedAt,
      ...(dispatch.status === "sent" ? {
        lastRecipients: dispatch.recipients,
        lastCc: dispatch.cc,
      } : {}),
      dispatchStatus: "sent",
      ...(preparation.sendKind === "resend" ? {
        lastChangeSummary: preparation.changeSummary,
      } : {}),
      initialSendVerification,
      lastSubmission: submission,
      dispatchHistory: nextDispatchHistory,
      ...(contentSnapshot ? { lastDispatchedSnapshot: contentSnapshot } : {}),
      ...(contentSnapshot && preparation.sendKind === "initial"
        && !currentState.firstDispatchedSnapshot
        ? { firstDispatchedSnapshot: contentSnapshot }
        : {}),
      draftFingerprint: preparation.draft.fingerprint,
      checkpoints: Array.isArray(result.checkpoints) ? result.checkpoints : [],
      events: [...(Array.isArray(currentState.events) ? currentState.events : []), {
        type: dispatch.status === "already_sent"
          ? "operation_content_initial_send_recognized"
          : preparation.sendKind === "resend"
            ? "operation_content_resent"
          : "operation_content_synced_and_dispatched",
        actor: preparation.actorKey,
        createdAt: syncedAt,
      }].slice(-20),
    });
    return {
      task: updated,
      state: updated.config?.operationContentSync || {},
      submission,
      dispatch,
    };
  }

  return { state, prepare, complete };
}
