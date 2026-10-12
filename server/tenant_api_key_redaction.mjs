const REDACTED_TENANT_API_KEY = "[已隐藏]";
const TENANT_API_KEY_FIELD = /^(?:tenantApiKey|tenant_api_key)$/i;

export function collectTenantApiKeySecrets({ settings = {}, userSettings = {}, env = {} } = {}) {
  const secrets = new Set();
  const add = (value) => {
    const normalized = String(value || "").trim();
    if (normalized) secrets.add(normalized);
  };
  const addLogin = (login = {}) => {
    add(login?.tenantApiKey);
    add(login?.tenant_api_key);
  };
  const addProfiles = (profiles = []) => {
    for (const profile of Array.isArray(profiles) ? profiles : []) {
      add(profile?.tenantApiKey);
      add(profile?.tenant_api_key);
      add(profile?.apiKey);
    }
  };

  add(env?.YIKAO_API_KEY);
  addLogin(settings?.login);
  addProfiles(settings?.apiKeyProfiles);
  for (const record of Object.values(userSettings?.users || {})) {
    addLogin(record?.login);
    addProfiles(record?.apiKeyProfiles);
  }
  return [...secrets].sort((left, right) => right.length - left.length);
}

export function createTenantApiKeyResponseReplacer(secrets = []) {
  const normalizedSecrets = [...new Set(
    (Array.isArray(secrets) ? secrets : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )].sort((left, right) => right.length - left.length);

  return (key, value) => {
    if (TENANT_API_KEY_FIELD.test(String(key || ""))) {
      return value ? REDACTED_TENANT_API_KEY : value;
    }
    if (typeof value !== "string") return value;
    let redacted = value;
    for (const secret of normalizedSecrets) {
      if (redacted === secret) return REDACTED_TENANT_API_KEY;
      if (redacted.includes(secret)) {
        redacted = redacted.split(secret).join(REDACTED_TENANT_API_KEY);
      }
    }
    return redacted;
  };
}
