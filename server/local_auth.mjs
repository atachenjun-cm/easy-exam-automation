import { randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "easy_exam_session";

export function buildAuthContext({ env = process.env, localConfig = {} } = {}) {
  const email = String(localConfig.email || env.APP_LOGIN_EMAIL || "").trim();
  const password = String(localConfig.password || env.APP_LOGIN_PASSWORD || "");
  return {
    enabled: Boolean(email && password),
    email,
    password,
    sessions: new Map(),
    cookieName: SESSION_COOKIE,
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function verifyLogin(auth, email, password) {
  if (!auth?.enabled) return false;
  return safeEqual(String(email || "").trim(), auth.email) && safeEqual(String(password || ""), auth.password);
}

export function createSession(auth) {
  const token = randomBytes(32).toString("base64url");
  const user = { email: auth.email };
  auth.sessions.set(token, { user, createdAt: Date.now() });
  return { token, user };
}

export function getSessionUser(auth, token) {
  if (!auth?.enabled || !token) return null;
  return auth.sessions.get(token)?.user || null;
}

export function deleteSession(auth, token) {
  if (!auth?.enabled || !token) return false;
  return auth.sessions.delete(token);
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
  return cookieBase(auth, token, "; Max-Age=604800");
}

export function buildLogoutCookie(auth) {
  return cookieBase(auth, "", "; Max-Age=0");
}

export function shouldAllowWithoutAuth(method = "GET", pathname = "") {
  if (pathname === "/login") return method === "GET";
  if (pathname.startsWith("/web/")) return method === "GET";
  if (pathname === "/api/health") return method === "GET";
  if (pathname === "/api/auth/login") return method === "POST";
  if (pathname === "/api/auth/me") return method === "GET";
  if (pathname === "/api/auth/logout") return method === "POST";
  return false;
}
