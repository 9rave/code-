// 速率限制：D1 固定窗口计数（见开发指南 §7.5 / ADR-001）
// 取代单实例内存 Map。所有写接口与登录的限流均走 D1，跨实例一致。
import type { D1Database } from "@cloudflare/workers-types";
import { rateLimitHit, evaluateWindow } from "../db/queries";

export async function checkRateLimit(
  db: D1Database,
  key: string,
  windowMs: number,
  max: number
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  return rateLimitHit(db, key, windowMs, max, Date.now());
}

// 预设窗口（登录暴力防护）
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 分钟
export const LOGIN_MAX = 10; // 每 IP 10 次
