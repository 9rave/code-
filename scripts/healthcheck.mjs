// scripts/healthcheck.mjs
// 业务派生健康巡检（Issue #9）：轮询 D1 的关键业务指标，异常时退出码 1。
// 用法见 docs/MONITORING.md §3。仅用 Node 内置模块 + wrangler CLI（可选）。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- 配置（按真实流量调） ----------
const AI_DAILY_MANUAL_LIMIT = Number(process.env.AI_DAILY_MANUAL_LIMIT) || 5;
const AI_QUOTA_WARN_RATIO = 0.8; // B3
const AI_DEGRADED_RATIO = 0.3; // B4
const LOGIN_BRUTE_THRESHOLD = 20; // B5
const WEEKS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------- 工具 ----------
function shanghaiDate(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // YYYY-MM-DD
}
function yest(d = new Date()) {
  const p = new Date(d);
  p.setDate(p.getDate() - 1);
  return shanghaiDate(p);
}
function shanghaiMidnightIso(d = new Date()) {
  // 当天上海 00:00 的 ISO（含时区偏移），用于 created_at 过滤
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // YYYY-MM-DD
  return parts + "T00:00:00+08:00";
}

function resolveDbName() {
  if (process.env.DB_NAME) return process.env.DB_NAME;
  try {
    const raw = readFileSync(join(__dirname, "..", "wrangler.jsonc"), "utf8");
    const json = JSON.parse(
      raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
    );
    const d1 = json.d1_databases?.[0];
    return d1?.database_name || d1?.binding || "ai-todo";
  } catch {
    return "ai-todo";
  }
}

async function runQuery(sql) {
  const db = resolveDbName();
  const local = process.env.HEALTHCHECK_LOCAL === "1";
  const args = [
    "d1",
    "execute",
    db,
    "--command",
    sql,
    "--json",
    ...(local ? ["--local"] : []),
  ];
  try {
    const { stdout } = await execFileP("npx", ["wrangler", ...args], {
      cwd: join(__dirname, ".."),
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim());
    // wrangler --json 结构：{ success, result: [ { results:[...], columns:[...] } ] }
    const first = parsed?.result?.[0];
    return first?.results ?? [];
  } catch (e) {
    return { __error: e?.message || String(e), __sql: sql };
  }
}

// ---------- 检查定义 ----------
// 每个 check 返回 { ok, severity, msg }
async function checkPushFailures() {
  const today = shanghaiDate();
  const ys = yest();
  const rows = await runQuery(
    `SELECT push_type, COUNT(*) AS c FROM push_logs WHERE status='failed' AND push_date IN ('${today}','${ys}') GROUP BY push_type`
  );
  if (rows.__error) return { ok: false, severity: "WARN", msg: `查询失败：${rows.__error}` };
  if (!rows.length) return { ok: true, severity: "OK", msg: "无推送失败" };
  const detail = rows.map((r) => `${r.push_type}=${r.c}`).join(", ");
  return { ok: false, severity: "HIGH", msg: `推送失败 → ${detail}` };
}

async function checkCronMissing() {
  const today = shanghaiDate();
  const rows = await runQuery(
    `SELECT push_type, COUNT(*) AS c FROM push_logs WHERE status='success' AND push_date='${today}' AND push_type IN ('morning','evening') GROUP BY push_type`
  );
  if (rows.__error) return { ok: false, severity: "WARN", msg: `查询失败：${rows.__error}` };
  const have = new Set(rows.map((r) => r.push_type));
  const missing = ["morning", "evening"].filter((t) => !have.has(t));
  if (!missing.length) return { ok: true, severity: "OK", msg: "今日 morning/evening 均已推送" };
  return { ok: false, severity: "HIGH", msg: `Cron 缺失 → ${missing.join(",")}` };
}

async function checkAiQuota() {
  const since = shanghaiMidnightIso();
  const rows = await runQuery(
    `SELECT COUNT(*) AS c FROM ai_usage WHERE review_type='manual' AND created_at >= '${since}'`
  );
  if (rows.__error) return { ok: false, severity: "WARN", msg: `查询失败：${rows.__error}` };
  const c = Number(rows[0]?.c ?? 0);
  const ratio = c / AI_DAILY_MANUAL_LIMIT;
  if (ratio >= AI_QUOTA_WARN_RATIO)
    return { ok: false, severity: "MED", msg: `AI 日限额占用 ${c}/${AI_DAILY_MANUAL_LIMIT} (${Math.round(ratio * 100)}%)` };
  return { ok: true, severity: "OK", msg: `AI 日限额 ${c}/${AI_DAILY_MANUAL_LIMIT}` };
}

async function checkAiDegraded() {
  const rows = await runQuery(
    `SELECT COUNT(*) AS total, COALESCE(SUM(degraded),0) AS degraded FROM ai_usage WHERE created_at >= datetime('now','-1 day')`
  );
  if (rows.__error) return { ok: false, severity: "WARN", msg: `查询失败：${rows.__error}` };
  const total = Number(rows[0]?.total ?? 0);
  const degraded = Number(rows[0]?.degraded ?? 0);
  if (total === 0) return { ok: true, severity: "OK", msg: "近 24h 无 AI 调用" };
  const ratio = degraded / total;
  if (ratio > AI_DEGRADED_RATIO)
    return { ok: false, severity: "MED", msg: `AI 降级率 ${Math.round(ratio * 100)}% (${degraded}/${total})` };
  return { ok: true, severity: "OK", msg: `AI 降级率 ${Math.round(ratio * 100)}%` };
}

async function checkLoginBrute() {
  const nowMs = Date.now();
  const rows = await runQuery(
    `SELECT COUNT(*) AS c FROM rate_limits WHERE key LIKE 'login:%' AND reset_at >= ${nowMs - 3600000}`
  );
  if (rows.__error) return { ok: false, severity: "WARN", msg: `查询失败：${rows.__error}` };
  const c = Number(rows[0]?.c ?? 0);
  if (c > LOGIN_BRUTE_THRESHOLD)
    return { ok: false, severity: "MED", msg: `登录限流活跃桶 ${c}（疑似爆破）` };
  return { ok: true, severity: "OK", msg: `登录限流桶 ${c}` };
}

async function checkMustChangePwd() {
  const rows = await runQuery(
    `SELECT username FROM users WHERE must_change_password=1 AND updated_at <= datetime('now','-7 day')`
  );
  if (rows.__error) return { ok: false, severity: "WARN", msg: `查询失败：${rows.__error}` };
  if (!rows.length) return { ok: true, severity: "OK", msg: "无挂起强制改密" };
  return { ok: false, severity: "LOW", msg: `强制改密挂起 → ${rows.map((r) => r.username).join(",")}` };
}

const CHECKS = [
  ["B1 推送失败", checkPushFailures],
  ["B2 Cron 缺失", checkCronMissing],
  ["B3 AI 日限额", checkAiQuota],
  ["B4 AI 降级率", checkAiDegraded],
  ["B5 登录限流", checkLoginBrute],
  ["B6 强制改密", checkMustChangePwd],
];

// ---------- 主流程 ----------
const ICON = { OK: "🟢", LOW: "🟡", MED: "🟠", HIGH: "🔴", WARN: "⚠️" };
let hasBreach = false;

console.log("=== AI Todo 助手 · 健康巡检 ===");
console.log(`业务日期(Asia/Shanghai): ${shanghaiDate()}  DB: ${resolveDbName()}\n`);

for (const [name, fn] of CHECKS) {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { ok: false, severity: "WARN", msg: `执行异常：${e?.message || e}` };
  }
  const icon = ICON[r.severity] || "·";
  console.log(`${icon} [${name}] ${r.msg}`);
  if (r.severity === "HIGH" || r.severity === "MED") hasBreach = true;
}

console.log("\n=== 巡检结束 ===");
if (hasBreach) {
  console.log("结果：存在需关注的异常（退出码 1）");
  process.exit(1);
}
console.log("结果：全部正常（退出码 0）");
process.exit(0);
