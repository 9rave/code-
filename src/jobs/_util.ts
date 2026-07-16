import type { Env } from "../types";

// 单用户场景：取第一个启用账号作为推送目标
export async function firstUser(env: Env): Promise<{ id: string } | null> {
  const r = await env.DB.prepare("SELECT id FROM users WHERE is_active = 1 LIMIT 1").first();
  return r ? { id: (r as any).id } : null;
}
