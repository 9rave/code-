// Seed CLI：计算密码哈希并写入 D1（见开发指南 §12.2）
// 用法：INITIAL_ADMIN_USERNAME=admin INITIAL_ADMIN_PASSWORD='xxx' npm run seed
import { execSync } from "node:child_process";
import { hashPassword, generateSalt, passwordParams, validatePasswordPolicy } from "../src/security/password";

async function main() {
  const username = process.env.INITIAL_ADMIN_USERNAME || "admin";
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password) {
    console.error("请设置 INITIAL_ADMIN_PASSWORD 环境变量（也可设置 INITIAL_ADMIN_USERNAME）");
    process.exit(1);
  }
  try {
    validatePasswordPolicy(password); // 首账号也须满足强度策略（ADR-004）
  } catch (e: any) {
    console.error("密码不符合策略：" + (e?.message || e));
    process.exit(1);
  }
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  const params = passwordParams();
  const now = new Date().toISOString();
  const esc = (s: string) => s.replace(/'/g, "''");

  const sql =
    `INSERT INTO users (id, username, password_hash, password_salt, password_params, created_at, updated_at) ` +
    `VALUES ('${crypto.randomUUID()}', '${esc(username)}', '${esc(hash)}', '${esc(salt)}', '${esc(params)}', '${now}', '${now}') ` +
    `ON CONFLICT(username) DO NOTHING;`;

  execSync(`npx wrangler d1 execute ai-todo --command="${sql}"`, { stdio: "inherit" });
  console.log(`已尝试 Seed 用户 "${username}"（若已存在则跳过）。首次登录需强制改密。`);
}

main();
