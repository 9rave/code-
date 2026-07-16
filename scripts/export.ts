// 导出/备份脚本（见 ADR-003 / 验收清单 §12.4）
// 将 D1 各表导出为 JSON + CSV，便于离线备份与数据迁移。
// 用法：npm run export [:dbname]   （dbname 默认 ai-todo，可被 EXPORT_DB 覆盖）
// 依赖：本地已 `wrangler login` 且对目标库有访问权限。
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const DB = process.argv[2] || process.env.EXPORT_DB || "ai-todo";
const TABLES = ["users", "tasks", "daily_logs", "reviews", "push_logs", "ai_usage", "rate_limits"];

function toCsv(rows: any[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return head + "\n" + body;
}

function parseResults(stdout: string): any[] {
  try {
    const parsed = JSON.parse(stdout);
    // wrangler d1 execute --json 返回结果数组；兼容 { results } 与 { result:[{results}] }
    if (Array.isArray(parsed)) {
      for (const item of parsed) if (item && Array.isArray(item.results)) return item.results;
    }
    if (parsed && Array.isArray(parsed.results)) return parsed.results;
    if (parsed && parsed.result && Array.isArray(parsed.result[0]?.results)) return parsed.result[0].results;
  } catch {
    /* ignore */
  }
  return [];
}

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = `exports/${ts}`;
  mkdirSync(dir, { recursive: true });
  console.log(`导出数据库 "${DB}" → ${dir}/`);

  let totalRows = 0;
  for (const table of TABLES) {
    const cmd = `npx wrangler d1 execute ${DB} --command="SELECT * FROM ${table}" --json`;
    const stdout = execSync(cmd, { encoding: "utf-8" });
    const rows = parseResults(stdout);
    writeFileSync(`${dir}/${table}.json`, JSON.stringify(rows, null, 2));
    if (rows.length) writeFileSync(`${dir}/${table}.csv`, toCsv(rows));
    totalRows += rows.length;
    console.log(`  ${table}: ${rows.length} 行`);
  }
  writeFileSync(`${dir}/_manifest.json`, JSON.stringify({ db: DB, exportedAt: new Date().toISOString(), tables: TABLES, totalRows }, null, 2));
  console.log(`完成。共 ${totalRows} 行。建议将 exports/ 加入备份或冷存储，并定期运行本脚本。`);
}

main().catch((e) => {
  console.error("导出失败：", e?.message || e);
  process.exit(1);
});
