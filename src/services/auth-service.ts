// 鉴权服务（见开发指南 §6.3 / §7）
import type { Env, SessionUser } from "../types";
import * as q from "../db/queries";
import { hashPassword, verifyPassword, generateSalt, passwordParams, validatePasswordPolicy } from "../security/password";
import {
  signSession,
  verifySession,
  parseCookies,
  sessionCookieValue,
  clearSessionCookie,
  SessionPayload,
} from "../security/session";
import { checkRateLimit, LOGIN_WINDOW_MS, LOGIN_MAX } from "../security/rate-limit";
import { HttpError, STATUS } from "../utils/errors";

export async function login(
  env: Env,
  username: string,
  password: string,
  clientIp: string
): Promise<{ token: string; user: any }> {
  const lim = await checkRateLimit(env.DB, "login:" + clientIp, LOGIN_WINDOW_MS, LOGIN_MAX);
  if (!lim.allowed) {
    throw new HttpError(STATUS.RATE_LIMITED, "RATE_LIMITED", "登录过于频繁，请稍后再试", lim.retryAfterMs);
  }
  const user = await q.getUserByUsername(env.DB, username);
  if (!user) throw new HttpError(STATUS.AUTH_FAILED, "AUTH_FAILED", "用户名或密码错误");
  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) throw new HttpError(STATUS.AUTH_FAILED, "AUTH_FAILED", "用户名或密码错误");
  const token = await signSession({ sub: user.id, sessionVersion: user.session_version }, env.SESSION_SECRET);
  return { token, user };
}

export async function requireUser(env: Env, req: Request): Promise<SessionPayload> {
  const cookies = parseCookies(req.headers.get("cookie"));
  const payload = await verifySession(cookies["session"], env.SESSION_SECRET);
  if (!payload) throw new HttpError(STATUS.AUTH_REQUIRED, "AUTH_REQUIRED", "未登录或会话已失效");
  // 会话版本校验：改密后 session_version 递增，旧 Token 立即失效（见 ADR 会话失效）
  const user = await q.getUserById(env.DB, payload.sub);
  if (!user || user.session_version !== payload.sessionVersion) {
    throw new HttpError(STATUS.AUTH_REQUIRED, "AUTH_REQUIRED", "会话已失效，请重新登录");
  }
  return payload;
}

export async function changePassword(
  env: Env,
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (!newPassword) {
    throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "新密码不能为空");
  }
  validatePasswordPolicy(newPassword); // ≥12 位 + 至少 3 类字符（见 ADR-004）
  const user = await q.getUserById(env.DB, userId);
  if (!user) throw new HttpError(STATUS.AUTH_REQUIRED, "AUTH_REQUIRED", "未登录或会话已失效");
  const ok = await verifyPassword(currentPassword, user.password_salt, user.password_hash);
  if (!ok) throw new HttpError(STATUS.AUTH_FAILED, "AUTH_FAILED", "当前密码错误");
  const salt = generateSalt();
  const hash = await hashPassword(newPassword, salt);
  await q.setPassword(env.DB, userId, hash, salt, passwordParams());
  await q.bumpSessionVersion(env.DB, userId); // 旧会话立即失效
}

export async function getMe(env: Env, userId: string): Promise<SessionUser> {
  const u = await q.getUserById(env.DB, userId);
  if (!u) throw new HttpError(STATUS.AUTH_REQUIRED, "AUTH_REQUIRED", "未登录或会话已失效");
  return {
    id: u.id,
    username: u.username,
    mustChangePassword: !!u.must_change_password,
    sessionVersion: u.session_version,
  };
}

export function sessionCookie(token: string): string {
  return sessionCookieValue(token);
}

export function clearCookie(): string {
  return clearSessionCookie();
}
