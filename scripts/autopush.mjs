#!/usr/bin/env node
// autopush.mjs — 推送所有领先 origin 的本地分支，使用按需签发的 GitHub App
// installation token。无 PAT、无聊天密钥。授权失败会以 AUTH_* 状态清晰报错。
import { execFileSync } from "node:child_process";
import { getInstallationToken } from "./gh-app-auth.mjs";

const REPO = "9rave/code-";
const REMOTE_URL = `https://github.com/${REPO}.git`;

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function branchesAhead() {
  try { sh("git", ["fetch", "--quiet", "origin"]); } catch { /* 离线也继续 */ }
  const out = sh("git", ["for-each-ref", "--format=%(refname:short) %(upstream:short)", "refs/heads"]);
  const ahead = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [branch, upstream] = line.split(" ");
    if (!upstream) { ahead.push(branch); continue; }
    const n = sh("git", ["rev-list", "--count", `${upstream}..${branch}`]).trim();
    if (Number(n) > 0) ahead.push(branch);
  }
  return ahead;
}

async function main() {
  let token;
  try { token = await getInstallationToken(); }
  catch { process.exit(12); } // gh-app-auth 已打印 AUTH_* 状态

  const branches = branchesAhead();
  if (!branches.length) { console.log("[PUSH_OK] 无待推送内容（各分支已同步）。"); return; }

  const withToken = `https://x-access-token:${token}@github.com/${REPO}.git`;
  for (const b of branches) {
    try {
      sh("git", ["remote", "set-url", "origin", withToken]);
      sh("git", ["push", "--quiet", "-u", "origin", b]);
      console.log(`[PUSH_OK] 已推送 ${b}`);
    } catch (e) {
      console.error(`[PUSH_FAILED] 分支 ${b}：${e.stderr || e.message}`);
      process.exitCode = 1;
    } finally {
      sh("git", ["remote", "set-url", "origin", REMOTE_URL]);
    }
  }
  console.log("[DONE] autopush 完成。");
}
main();
