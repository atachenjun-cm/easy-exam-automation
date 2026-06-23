import { isAdminUser, normalizeEmail } from "./local_auth.mjs";

export const DEFAULT_LOGIN_URL = "https://eztest.org/manager/accounts/login";

export function defaultLoginSettings() {
  return {
    url: DEFAULT_LOGIN_URL,
    username: "",
    password: "",
    tenantApiKey: "",
  };
}

export function defaultUserSettings() {
  return { users: {} };
}

export function normalizeUserSettings(raw = {}) {
  return {
    users: raw && typeof raw.users === "object" && !Array.isArray(raw.users) ? raw.users : {},
  };
}

export function userSettingsKey(user) {
  return normalizeEmail(user?.email || "");
}

export function sanitizeLoginSettings(login = {}) {
  const defaults = defaultLoginSettings();
  return {
    url: String(login.url || defaults.url).trim(),
    username: String(login.username || "").trim(),
    password: String(login.password || ""),
    tenantApiKey: String(login.tenantApiKey || "").trim(),
  };
}

export function currentUserLogin({ user, userSettings = defaultUserSettings(), legacySettings = {} } = {}) {
  const key = userSettingsKey(user);
  if (!key) return sanitizeLoginSettings(legacySettings.login || {});

  const scopedLogin = userSettings?.users?.[key]?.login;
  if (scopedLogin) return sanitizeLoginSettings(scopedLogin);

  if (isAdminUser(user)) return sanitizeLoginSettings(legacySettings.login || {});
  return defaultLoginSettings();
}

export function saveUserLogin(userSettings, user, login) {
  const key = userSettingsKey(user);
  if (!key) throw new Error("请先登录后再保存易考账号配置。");
  const nextSettings = normalizeUserSettings(userSettings);
  const now = new Date().toISOString();
  const existing = nextSettings.users[key] || {};
  nextSettings.users[key] = {
    ...existing,
    userId: key,
    login: sanitizeLoginSettings(login),
    updatedAt: now,
    createdAt: existing.createdAt || now,
  };
  return nextSettings.users[key];
}
