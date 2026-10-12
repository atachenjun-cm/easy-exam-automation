function tenantErrorDetail(detail) {
  if (typeof detail === "string") return detail.trim();
  if (!detail || typeof detail !== "object") return "";
  for (const key of ["detail", "message", "msg", "error"]) {
    if (typeof detail[key] === "string") return detail[key].trim();
  }
  return "";
}

export function isTenantEmptyPageError(error = {}) {
  if (Number(error?.status) !== 403) return false;
  return /^本页结果为空[。！!]?$/.test(tenantErrorDetail(error?.detail));
}

export function isTenantMissingScoreError(error = {}) {
  if (Number(error?.status) !== 403) return false;
  return /^not found score[.!]?$/.test(tenantErrorDetail(error?.detail).toLowerCase());
}

export function classifyTenantSingleScoreError(error = {}) {
  if (Number(error?.status) === 404 || isTenantMissingScoreError(error)) return "missing";
  if (Number(error?.status) === 403) return "forbidden";
  return "other";
}
