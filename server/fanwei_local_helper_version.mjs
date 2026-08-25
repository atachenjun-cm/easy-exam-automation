export const FANWEI_LOCAL_HELPER_VERSION = 36;
export const FANWEI_LOCAL_HELPER_UPDATE_SCHEMA_VERSION = 1;
export const FANWEI_LOCAL_HELPER_UPDATE_STRATEGY = "server-files-v1";

export function buildFanweiHelperPackageManifest(platform) {
  return {
    schemaVersion: FANWEI_LOCAL_HELPER_UPDATE_SCHEMA_VERSION,
    helperVersion: FANWEI_LOCAL_HELPER_VERSION,
    platform: String(platform || ""),
    updateStrategy: FANWEI_LOCAL_HELPER_UPDATE_STRATEGY,
  };
}
