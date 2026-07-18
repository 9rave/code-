// 数据库迁移脚本（见部署指南 §12.2）
// 按文件名顺序执行 src/db/migrations/*.sql，幂等（所有语句带 IF NOT EXISTS / ON CONFLICT）。
// 用法：npm run migrate [:dbname]   （dbname 默认 ai-todo，可被 MIGRATE_DB 覆盖）
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// 默认迁移本地 D1；部署生产库时传 --remote 或 D1_REMOTE=1（见 docs/DEPLOY.md）
const REMOTE = process.argv.includes("--remote") || process.env.D1_REMOTE === "1" ? " --remote" : "";
const posArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DB = posArgs[0] || process.env.MIGRATE_DB || "ai-todo";
const MIG_DIR = new URL("../src/db/migrations/", import.meta.url).pathname;

const files = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // 0001_init.sql, 0002_rate_limits.sql, ...

console.log(`对数据库 "${DB}" 应用迁移（共 ${files.length} 个）：`);
for (const f of files) {
  const p = join(MIG_DIR, f);
  console.log(`  → ${f}`);
  execSync(`npx wrangler d1 execute ${DB}${REMOTE} --file="${p}"`, { stdio: "inherit" });
}
console.log("迁移完成。");
