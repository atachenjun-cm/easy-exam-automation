import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "easy_exam_session";
export const SESSION_MAX_AGE_SECONDS = 31536000;
export const FEATURE_PERMISSION_MESSAGE_CENTER_DIRECT_SEND = "message_center_direct_send";
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
const FEATURE_PERMISSION_KEYS = new Set([FEATURE_PERMISSION_MESSAGE_CENTER_DIRECT_SEND]);

export function buildAuthContext({ env = process.env, localConfig = {} } = {}) {
  const email = String(localConfig.email || env.APP_LOGIN_EMAIL || "").trim();
  const password = String(localConfig.password || env.APP_LOGIN_PASSWORD || "");
  const users = Array.isArray(localConfig.users) ? [...localConfig.users] : [];
  if (email && password) {
    const normalizedAdminEmail = normalizeEmail(email);
    const existingAdminIndex = users.findIndex((user) => normalizeEmail(user.email) === normalizedAdminEmail);
    const existingAdmin = existingAdminIndex >= 0 ? users[existingAdminIndex] : {};
    const { passwordHash, passwordSalt, memberAccountAccess, featurePermissions, ...adminMetadata } = existingAdmin;
    if (existingAdminIndex >= 0) users.splice(existingAdminIndex, 1);
    users.unshift({
      ...adminMetadata,
      email: normalizedAdminEmail,
      role: "admin",
      disabled: false,
      memberEmails: normalizeMemberEmails(existingAdmin.memberEmails),
      ...normalizedMemberAccountAccessProperty(memberAccountAccess),
      ...normalizedFeaturePermissionsProperty(featurePermissions),
    });
  }
  return {
    enabled: Boolean(email && password),
    email,
    password,
    users,
    sessions: new Map(),
    cookieName: SESSION_COOKIE,
  };
}

export function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password, salt = randomBytes(16).toString("base64url")) {
  const hash = pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("base64url");
  return { passwordSalt: salt, passwordHash: hash };
}

export async function verifyPasswordHash(password, salt, hash) {
  if (!salt || !hash) return false;
  const computed = hashPassword(password, salt).passwordHash;
  return safeEqual(computed, hash);
}

export async function verifyLogin(auth, email, password) {
  if (!auth?.enabled) return false;
  const normalizedEmail = normalizeEmail(email);
  if (safeEqual(normalizedEmail, normalizeEmail(auth.email)) && safeEqual(String(password || ""), auth.password)) {
    return { email: auth.email, role: "admin" };
  }

  const user = (auth.users || []).find((item) => normalizeEmail(item.email) === normalizedEmail);
  if (!user || user.disabled) return null;
  if (!(await verifyPasswordHash(password, user.passwordSalt, user.passwordHash))) return null;
  return {
    email: user.email,
    role: user.role || "user",
    ...normalizedFeaturePermissionsProperty(user.featurePermissions),
  };
}

export function createSession(auth, user = { email: auth.email, role: "admin" }, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  auth.sessions.set(token, { user, createdAt: now, expiresAt: now + SESSION_MAX_AGE_MS });
  return { token, user };
}

export function getSessionUser(auth, token, now = Date.now()) {
  if (!auth?.enabled || !token) return null;
  const session = auth.sessions.get(token);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt <= now) {
    auth.sessions.delete(token);
    return null;
  }
  return session.user || null;
}

export function deleteSession(auth, token) {
  if (!auth?.enabled || !token) return false;
  return auth.sessions.delete(token);
}

export function deleteSessionsForEmail(auth, email) {
  const normalizedEmail = normalizeEmail(email);
  for (const [token, session] of auth.sessions.entries()) {
    if (normalizeEmail(session.user?.email) === normalizedEmail) auth.sessions.delete(token);
  }
}

export function serializeSessions(auth, now = Date.now()) {
  if (!auth?.enabled) return [];
  return [...auth.sessions.entries()]
    .filter(([, session]) => !session.expiresAt || session.expiresAt > now)
    .map(([token, session]) => ({
      token,
      user: session.user,
      createdAt: session.createdAt || now,
      expiresAt: session.expiresAt || now + SESSION_MAX_AGE_MS,
    }));
}

export function restoreSessions(auth, sessions = [], now = Date.now()) {
  if (!auth?.enabled) return auth;
  auth.sessions = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const token = String(session?.token || "").trim();
    if (!token || !session?.user) continue;
    const expiresAt = Number(session.expiresAt || 0);
    if (expiresAt && expiresAt <= now) continue;
    auth.sessions.set(token, {
      user: session.user,
      createdAt: Number(session.createdAt || now),
      expiresAt: expiresAt || now + SESSION_MAX_AGE_MS,
    });
  }
  return auth;
}

export function isAdminUser(user) {
  return user?.role === "admin";
}

function normalizeMemberEmails(memberEmails = []) {
  if (!Array.isArray(memberEmails)) return [];
  return [...new Set(memberEmails.map((email) => normalizeEmail(email)).filter(Boolean))];
}

function normalizeProfileIds(profileIds = []) {
  if (!Array.isArray(profileIds)) return [];
  return [...new Set(profileIds.map((profileId) => String(profileId || "").trim()).filter(Boolean))];
}

function normalizePermissionKeys(featurePermissions = []) {
  if (!Array.isArray(featurePermissions)) return [];
  return [...new Set(featurePermissions.map((permission) => String(permission || "").trim()).filter(Boolean))];
}

export function userFeaturePermissions(user) {
  return normalizePermissionKeys(user?.featurePermissions)
    .filter((permission) => FEATURE_PERMISSION_KEYS.has(permission));
}

function normalizedFeaturePermissionsProperty(featurePermissions = []) {
  const normalized = userFeaturePermissions({ featurePermissions });
  return normalized.length ? { featurePermissions: normalized } : {};
}

export function hasFeaturePermission(user, permission) {
  if (isAdminUser(user)) return true;
  const normalizedPermission = String(permission || "").trim();
  return Boolean(normalizedPermission && userFeaturePermissions(user).includes(normalizedPermission));
}

function normalizeMemberAccountAccess(memberAccountAccess = {}) {
  if (!memberAccountAccess || typeof memberAccountAccess !== "object" || Array.isArray(memberAccountAccess)) return {};
  const normalized = {};
  for (const [memberEmail, profileIds] of Object.entries(memberAccountAccess)) {
    const email = normalizeEmail(memberEmail);
    if (!email || !Array.isArray(profileIds)) continue;
    normalized[email] = normalizeProfileIds(profileIds);
  }
  return normalized;
}

function normalizedMemberAccountAccessProperty(memberAccountAccess = {}) {
  const normalized = normalizeMemberAccountAccess(memberAccountAccess);
  return Object.keys(normalized).length ? { memberAccountAccess: normalized } : {};
}

export function memberAccountProfileAccess(leader, memberEmail, availableProfileIds = []) {
  const email = normalizeEmail(memberEmail);
  const available = normalizeProfileIds(availableProfileIds);
  const access = normalizeMemberAccountAccess(leader?.memberAccountAccess);
  const configured = Boolean(email && Object.hasOwn(access, email));
  const selected = configured ? access[email] : available;
  const availableSet = new Set(available);
  return {
    configured,
    profileIds: selected.filter((profileId) => availableSet.has(profileId)),
  };
}

export function setMemberAccountProfileAccess(auth, leaderEmail, memberEmail, profileIds = []) {
  const normalizedLeaderEmail = normalizeEmail(leaderEmail);
  const normalizedMemberEmail = normalizeEmail(memberEmail);
  const leader = (auth.users || []).find((user) => normalizeEmail(user.email) === normalizedLeaderEmail);
  if (!leader) return null;
  if (!normalizeMemberEmails(leader.memberEmails).includes(normalizedMemberEmail)) {
    throw new Error(`${normalizedMemberEmail || "该账号"} 不是 ${normalizedLeaderEmail} 的组员。`);
  }
  const access = normalizeMemberAccountAccess(leader.memberAccountAccess);
  access[normalizedMemberEmail] = normalizeProfileIds(profileIds);
  leader.memberAccountAccess = access;
  leader.updatedAt = new Date().toISOString();
  return leader;
}

export function groupLeaderForMember(user, users = []) {
  if (!user?.role || isAdminUser(user)) return null;
  const memberEmail = normalizeEmail(user.email);
  if (!memberEmail) return null;
  return (users || []).find((candidate) => (
    normalizeEmail(candidate?.email) !== memberEmail
    && normalizeMemberEmails(candidate?.memberEmails).includes(memberEmail)
  )) || null;
}

export function canViewOwner(user, ownerEmail = "", users = []) {
  if (!user?.role) return true;
  if (isAdminUser(user)) return true;
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return false;
  const viewerEmail = normalizeEmail(user.email);
  if (viewerEmail === owner) return true;
  const viewer = (users || []).find((item) => normalizeEmail(item.email) === viewerEmail);
  return normalizeMemberEmails(viewer?.memberEmails ?? user.memberEmails).includes(owner);
}

export function sanitizeUsers(users = []) {
  return users.map(({ passwordHash, passwordSalt, memberAccountAccess, featurePermissions, ...user }) => ({
    ...user,
    memberEmails: normalizeMemberEmails(user.memberEmails),
    ...normalizedMemberAccountAccessProperty(memberAccountAccess),
    ...normalizedFeaturePermissionsProperty(featurePermissions),
  }));
}

export function upsertLocalUser(auth, { email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("请输入同事邮箱。");
  if (!String(password || "")) throw new Error("请输入临时密码。");
  if (normalizedEmail === normalizeEmail(auth.email)) throw new Error("管理员账号不需要重复添加。");

  const now = new Date().toISOString();
  const existingIndex = (auth.users || []).findIndex((user) => normalizeEmail(user.email) === normalizedEmail);
  const existing = existingIndex >= 0 ? auth.users[existingIndex] : {};
  const next = {
    ...existing,
    email: normalizedEmail,
    ...hashPassword(password),
    role: "user",
    disabled: false,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  if (existingIndex >= 0) auth.users[existingIndex] = next;
  else auth.users.push(next);
  return next;
}

export function updateLocalUser(auth, email, patch = {}) {
  const normalizedEmail = normalizeEmail(email);
  const user = (auth.users || []).find((item) => normalizeEmail(item.email) === normalizedEmail);
  if (!user) return null;
  const adminAccount = normalizedEmail === normalizeEmail(auth.email);
  if (adminAccount && patch.disabled !== undefined) throw new Error("管理员账号不能禁用。");
  if (adminAccount && patch.password) throw new Error("管理员登录密码不能在用户管理中修改。");
  if (patch.disabled !== undefined) user.disabled = Boolean(patch.disabled);
  if (patch.password) Object.assign(user, hashPassword(patch.password));
  if (patch.featurePermissions !== undefined) {
    if (!Array.isArray(patch.featurePermissions)) throw new Error("功能权限格式不正确。");
    const requestedPermissions = normalizePermissionKeys(patch.featurePermissions);
    const invalidPermission = requestedPermissions.find((permission) => !FEATURE_PERMISSION_KEYS.has(permission));
    if (invalidPermission) throw new Error(`不支持的功能权限：${invalidPermission}`);
    if (requestedPermissions.length) user.featurePermissions = requestedPermissions;
    else delete user.featurePermissions;
  }
  if (patch.memberEmails !== undefined) {
    if (!Array.isArray(patch.memberEmails)) throw new Error("组员邮箱格式不正确。");
    const existingMemberEmails = normalizeMemberEmails(user.memberEmails);
    const memberEmails = normalizeMemberEmails(patch.memberEmails);
    if (memberEmails.includes(normalizedEmail)) throw new Error("不能将自己添加为组员。");
    for (const memberEmail of memberEmails) {
      if (memberEmail === normalizeEmail(auth.email)) throw new Error("管理员账号不能作为组员。");
      if (!(auth.users || []).some((item) => normalizeEmail(item.email) === memberEmail)) {
        throw new Error(`请先开通组员账号：${memberEmail}`);
      }
      const existingLeader = (auth.users || []).find((item) => (
        normalizeEmail(item.email) !== normalizedEmail
        && normalizeMemberEmails(item.memberEmails).includes(memberEmail)
      ));
      if (existingLeader) throw new Error(`${memberEmail} 已属于 ${existingLeader.email} 的项目组。`);
    }
    user.memberEmails = memberEmails;
    const memberAccountAccess = normalizeMemberAccountAccess(user.memberAccountAccess);
    for (const memberEmail of Object.keys(memberAccountAccess)) {
      if (!memberEmails.includes(memberEmail)) delete memberAccountAccess[memberEmail];
    }
    for (const memberEmail of memberEmails) {
      if (!existingMemberEmails.includes(memberEmail) && !Object.hasOwn(memberAccountAccess, memberEmail)) {
        memberAccountAccess[memberEmail] = [];
      }
    }
    if (Object.keys(memberAccountAccess).length) user.memberAccountAccess = memberAccountAccess;
    else delete user.memberAccountAccess;
  }
  user.updatedAt = new Date().toISOString();
  return user;
}

export function deleteLocalUser(auth, email) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === normalizeEmail(auth.email)) return false;
  const before = auth.users.length;
  auth.users = auth.users.filter((user) => normalizeEmail(user.email) !== normalizedEmail);
  if (auth.users.length === before) return false;
  const now = new Date().toISOString();
  for (const user of auth.users) {
    const memberEmails = normalizeMemberEmails(user.memberEmails);
    const memberAccountAccess = normalizeMemberAccountAccess(user.memberAccountAccess);
    const hadMember = memberEmails.includes(normalizedEmail);
    const hadAccountAccess = Object.hasOwn(memberAccountAccess, normalizedEmail);
    if (!hadMember && !hadAccountAccess) continue;
    if (hadMember) user.memberEmails = memberEmails.filter((memberEmail) => memberEmail !== normalizedEmail);
    if (hadAccountAccess) delete memberAccountAccess[normalizedEmail];
    if (Object.keys(memberAccountAccess).length) user.memberAccountAccess = memberAccountAccess;
    else delete user.memberAccountAccess;
    user.updatedAt = now;
  }
  return true;
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function cookieBase(auth, value, options = "") {
  const encoded = encodeURIComponent(value);
  return `${auth.cookieName || SESSION_COOKIE}=${encoded}; Path=/; HttpOnly; SameSite=Lax${options}`;
}

export function buildLoginCookie(auth, token) {
  return cookieBase(auth, token, `; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
}

export function buildLogoutCookie(auth) {
  return cookieBase(auth, "", "; Max-Age=0");
}

export function shouldAllowWithoutAuth(method = "GET", pathname = "") {
  if (pathname === "/login") return method === "GET";
  if (/^\/assistant\/?$/.test(pathname)) return method === "GET";
  if (pathname.startsWith("/web/")) return method === "GET";
  if (pathname === "/api/health") return method === "GET";
  if (pathname === "/api/public/assistant/chat") return method === "POST";
  if (pathname === "/api/auth/login") return method === "POST";
  if (pathname === "/api/auth/me") return method === "GET";
  if (pathname === "/api/auth/logout") return method === "POST";
  if (pathname === "/api/fanwei/bridge/submit") return method === "POST" || method === "OPTIONS";
  return false;
}

export function shouldAllowInternalWechatCollectorRequest(method = "GET", pathname = "", remoteAddress = "") {
  const address = String(remoteAddress || "").trim().toLowerCase();
  const isLoopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  if (!isLoopback) return false;
  if (method === "GET" && pathname === "/api/requirements") return true;
  if (method === "POST" && pathname === "/api/ai/requirements/dispatch") return true;
  return false;
}
