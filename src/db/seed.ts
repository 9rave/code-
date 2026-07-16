// 首账号 Seed（见开发指南 §7.1）：部署时写入唯一管理员，首次登录强制改密
import type { D1Database } from "@cloudflare/workers-types";
import { hashPassword, generateSalt, passwordParams } from "../security/password";
import { uuid, nowIso } from "../utils/id";

export async function seedAdmin(db: D1Database, username: string, plainPassword: string): Promise<string> {
  const salt = generateSalt();
  const hash = await hashPassword(plainPassword, salt);
  const id = uuid();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, password_salt, password_params, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(username) DO NOTHING`
    )
    .bind(id, username, hash, salt, passwordParams(), now, now)
    .run();
  return id;
}
