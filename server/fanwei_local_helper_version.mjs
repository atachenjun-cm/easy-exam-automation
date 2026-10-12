export const FANWEI_LOCAL_HELPER_VERSION = 54;
export const FANWEI_LOCAL_HELPER_UPDATE_SCHEMA_VERSION = 1;
export const FANWEI_LOCAL_HELPER_UPDATE_STRATEGY = "server-files-v1";
export const FANWEI_LOCAL_HELPER_SERVER_FILES = Object.freeze([
  "fanwei_local_helper_cli.mjs",
  "fanwei_local_helper.mjs",
  "fanwei_local_helper_update.mjs",
  "fanwei_local_helper_version.mjs",
  "fanwei_auto_read.mjs",
  "score_stamp_application.mjs",
  "operation_batch_runner.mjs",
  "operation_batch_update_runner.mjs",
  "operation_personnel_console_runner.mjs",
  "operation_personnel_task_runner.mjs",
  "operation_archive_runner.mjs",
  "content_email_directory.mjs",
  "operation_batch.mjs",
  "operation_content.mjs",
  "operation_task_send_record.mjs",
  "operation_content_runner.mjs",
  "message_center_send_runner.mjs",
]);

export function buildFanweiHelperPackageManifest(platform) {
  return {
    schemaVersion: FANWEI_LOCAL_HELPER_UPDATE_SCHEMA_VERSION,
    helperVersion: FANWEI_LOCAL_HELPER_VERSION,
    platform: String(platform || ""),
    updateStrategy: FANWEI_LOCAL_HELPER_UPDATE_STRATEGY,
  };
}
