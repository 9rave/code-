#!/usr/bin/env node
// gh-app-auth.mjs — 用 GitHub App 私钥按需签发并自动刷新 installation token。
// 零三方依赖：node:crypto（RS256 签 JWT）+ 全局 fetch（Node 18+）。
//
// 配置（仅 .pem 是机密，其余都是公开标识）：
//   GITHUB_APP_ID                App 数字 id（Settings → Developer settings → GitHub Apps）
//   GITHUB_APP_INSTALLATION_ID   安装 id（App → Install App 后，或 GET /app/installations 取得）
//   GITHUB_APP_KEY_PATH          私钥 .pem 路径（默认 .secrets/github-app.pem）
//   GITHUB_APP_TOKEN_TTL_MIN     installation token 有效期（≤60，默认 60）
//
// 任意失败都以明确的 AUTH_* 退出码（12）退出，便于自动化识别状态。

import { readFileSync, existsSync } from "node:fs";
import { createSign } from "node:crypto";
import { resolve } from "node:path";

const KEY_PATH = process.env.GITHUB_APP_KEY_PATH
  || resolve(process.cwd(), ".secrets", "github-app.pem");
const APP_ID = process.env.GITHUB_APP_ID;
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID;
const TTL_MIN = Math.min(60, Number(process.env.GITHUB_APP_TOKEN_TTL_MIN || 60));

let cache = null; // { token, expiresAt }

function fail(code, message, hint) {
  console.error(`[AUTH_${code}] ${message}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(12);
}

function makeJwt() {
  if (!APP_ID) fail("NO_APP_ID", "GITHUB_APP_ID 未设置。",
    "在 GitHub App 设置页复制数字 id 并设为环境变量。");
  if (!existsSync(KEY_PATH)) fail("NO_KEY", `私钥未找到：${KEY_PATH}`,
    "请把 GitHub App 私钥 .pem 放到该路径（已被 .gitignore 忽略）。");
  let key;
  try { key = readFileSync(KEY_PATH, "utf8"); }
  catch (e) { fail("KEY_UNREADABLE", `无法读取私钥：${e.message}`); }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: Number(APP_ID) };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = createSign("RSA-SHA256").update(data).sign(key, "base64url");
  return `${data}.${sig}`;
}

async function mint() {
  if (!INSTALLATION_ID) fail("NO_INSTALLATION_ID", "GITHUB_APP_INSTALLATION_ID 未设置。",
    "在 9rave/code- 上安装该 App 后，取其 installation id 设为环境变量。");
  const jwt = makeJwt();
  let res;
  try {
    res = await fetch(
      `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`,
      { method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" } });
  } catch (e) { fail("NETWORK", `访问 GitHub 网络错误：${e.message}`); }
  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => "");
    fail("FORBIDDEN", `GitHub 拒绝请求（HTTP ${res.status}）。${body}`,
      "App 可能已被卸载/暂停，或私钥已撤销。检查 App → Installations。");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail("MINT_FAILED", `签发 token 失败（HTTP ${res.status}）。${body}`);
  }
  const json = await res.json();
  cache = { token: json.token, expiresAt: new Date(json.expires_at).getTime() };
  return cache.token;
}

// 对外：返回有效 token；若剩余 <5 分钟则自动刷新（满足「过期前续期」）。
export async function getInstallationToken() {
  const now = Date.now();
  if (cache && cache.expiresAt - now > 5 * 60 * 1000) return cache.token;
  return mint();
}

// CLI：直接打印 token（供 autopush / 手动使用）
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const t = await getInstallationToken();
    process.stdout.write(t);
  } catch { process.exit(12); }
}
