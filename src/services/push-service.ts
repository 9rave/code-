// 推送服务：企业微信 Markdown 渲染、幂等、重试（见开发指南 §9）
import type { Env, PushType, Task, ReviewSource } from "../types";
import * as q from "../db/queries";
import { businessDate } from "../utils/time";
import { HttpError, STATUS } from "../utils/errors";
import { log } from "../utils/logger";
import { sanitizeWeComMarkdown } from "../security/sanitize";

function modeLabel(source: ReviewSource | "rule"): string {
  return source === "ai" ? "AI 增强" : "规则引擎";
}

// ---------- 渲染 ----------
export function renderMorning(date: string, today: Task[], overdue: Task[], source: ReviewSource | "rule" = "rule"): string {
  const high = today.filter((t) => t.priority === "high").length;
  const lines: string[] = [];
  lines.push(`**AI Todo 早报｜${date}**`);
  lines.push(`> 今日 ${today.length} 项，逾期 ${overdue.length} 项，高优先级 ${high} 项`);
  lines.push("");
  const all = [...overdue, ...today].slice(0, 15);
  all.forEach((t, i) => {
    const tag = t.dueDate && t.dueDate < date ? "【逾期】" : t.priority === "high" ? "【高】" : "";
    const dur = t.estimatedDurationMinutes ? `（预计 ${t.estimatedDurationMinutes} 分钟）` : "";
    lines.push(`${i + 1}. ${tag}${t.title}${dur}`);
  });
  lines.push("");
  lines.push("建议：先处理逾期且高优先级事项。");
  lines.push(`生成模式：${modeLabel(source)}`);
  return sanitizeWeComMarkdown(lines.join("\n"));
}

export function renderEvening(date: string, content: string, source: ReviewSource | "rule" = "rule"): string {
  const body = sanitizeWeComMarkdown(content);
  return sanitizeWeComMarkdown(`**AI Todo 晚报｜${date}**\n\n${body}\n\n> 生成模式：${modeLabel(source)}`);
}

export function renderWeekly(date: string, content: string, source: ReviewSource | "rule" = "rule"): string {
  const body = sanitizeWeComMarkdown(content);
  return sanitizeWeComMarkdown(`**AI Todo 周报｜${date}**\n\n${body}\n\n> 生成模式：${modeLabel(source)}`);
}

export function renderTest(): string {
  return "**AI Todo 测试推送**\n> 配置正常 ✅";
}

// ---------- 发送（幂等 + 重试） ----------
export async function sendPush(
  env: Env,
  userId: string,
  type: PushType,
  content: string,
  reqId: string
): Promise<void> {
  const bd = businessDate();
  const idempotencyKey = `${userId}:${bd}:${type}`;

  if (await q.pushLogExists(env.DB, idempotencyKey)) {
    log("info", "push_skipped", { type, idempotencyKey }, reqId);
    return;
  }

  let attempt = 0;
  let success = false;
  let httpStatus: number | null = null;
  let resp = "";

  // 最多重试 3 次；attempt 记录真实发起次数（成功/业务拒绝时即本次，连续失败为 3）
  while (attempt < 3) {
    attempt++;
    try {
      const res = await fetch(env.WECOM_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
      });
      httpStatus = res.status;
      const json = (await res.json().catch(() => ({}))) as any;
      resp = JSON.stringify(json);

      if (!res.ok) throw new Error("HTTP_" + res.status);
      if (json.errcode !== undefined && json.errcode !== 0) {
        // 业务拒绝（如 invalid key），不重试
        break;
      }
      success = true;
      break;
    } catch {
      if (attempt >= 3) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  await q.insertPushLog(env.DB, userId, bd, type, idempotencyKey, success ? "success" : "failed", httpStatus, resp, attempt);
  if (!success) {
    log("error", "push_failed", { type, httpStatus, idempotencyKey }, reqId);
  }
}

export async function testPush(env: Env, userId: string, reqId: string): Promise<void> {
  if (!env.WECOM_WEBHOOK_URL) {
    throw new HttpError(STATUS.PUSH_FAILED, "PUSH_FAILED", "未配置企业微信 Webhook");
  }
  await sendPush(env, userId, "test", renderTest(), reqId);
}
