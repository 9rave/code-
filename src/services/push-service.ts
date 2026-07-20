// 推送服务：通用 webhook（ntfy / PushPlus / Server酱 / 自托管 ClawBot 桥）渲染、幂等、重试
// 见开发指南 §9。通道无关：传输层统一 POST JSON，按 NOTIFY_WEBHOOK_URL 的 host/path 选负载格式。
import type { Env, PushType, Task, ReviewSource } from "../types";
import * as q from "../db/queries";
import { businessDate } from "../utils/time";
import { HttpError, STATUS } from "../utils/errors";
import { log } from "../utils/logger";
import { sanitizeNotifyText } from "../security/sanitize";

function modeLabel(source: ReviewSource | "rule"): string {
  return source === "ai" ? "AI 增强" : "规则引擎";
}

// ntfy 标题与标签（纯展示，不影响逻辑）
const TITLE: Record<PushType, string> = {
  morning: "AI Todo 早报",
  evening: "AI Todo 晚报",
  weekly: "AI Todo 周报",
  test: "AI Todo 测试推送",
  custom: "AI Todo",
};
const TAGS: Record<PushType, string[]> = {
  morning: ["calendar"],
  evening: ["memo"],
  weekly: ["weekend"],
  test: ["rocket"],
  custom: ["bell"],
};

// 解析最终 webhook URL：优先用环境变量 secret，否则回退到 D1 托管的 bot_config（UI 可管理）。
async function resolveNotifyUrl(env: Env): Promise<string> {
  if (env.NOTIFY_WEBHOOK_URL) return env.NOTIFY_WEBHOOK_URL;
  try {
    const v = await q.getBotConfig(env.DB, "webhook_url");
    return v || "";
  } catch {
    return "";
  }
}

// 按 webhook host/path 选择负载格式（token 一律放 NOTIFY_WEBHOOK_URL，不入 body）：
// - 自托管 ClawBot 桥 (WeClawBot-API)：路径含 /bots/ → { text }
// - pushplus： { title, content, template:"txt" }
// - server酱：  { title, desp }
// - 其它/ntfy： { title, message, tags, priority }
export function buildNotifyPayload(url: string, type: PushType, content: string): Record<string, unknown> {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  const title = TITLE[type] ?? "AI Todo";

  if (url.includes("/bots/")) {
    // WeClawBot-API：POST /bots/{bot_id}/messages 接收 { text }
    return { text: content };
  }
  if (host.includes("pushplus.plus")) {
    return { title, content, template: "txt" };
  }
  if (host.includes("sctapi.ftqq.com") || host.includes("sc.ftqq.com")) {
    return { title, desp: content };
  }
  // 默认 ntfy / 通用
  return { title, message: content, tags: TAGS[type] ?? ["bell"], priority: 3 };
}

// ---------- 渲染（纯文本，适配 ntfy 等通用 webhook） ----------
export function renderMorning(date: string, today: Task[], overdue: Task[], source: ReviewSource | "rule" = "rule"): string {
  const high = today.filter((t) => t.priority === "high").length;
  const lines: string[] = [];
  lines.push(`AI Todo 早报｜${date}`);
  lines.push(`今日 ${today.length} 项，逾期 ${overdue.length} 项，高优先级 ${high} 项`);
  lines.push("");
  const all = [...overdue, ...today].slice(0, 15);
  all.forEach((t, i) => {
    const tag = t.dueDate && t.dueDate < date ? "[逾期] " : t.priority === "high" ? "[高] " : "";
    const dur = t.estimatedDurationMinutes ? `（预计 ${t.estimatedDurationMinutes} 分钟）` : "";
    lines.push(`${i + 1}. ${tag}${t.title}${dur}`);
  });
  lines.push("");
  lines.push("建议：先处理逾期且高优先级事项。");
  lines.push(`生成模式：${modeLabel(source)}`);
  return sanitizeNotifyText(lines.join("\n"));
}

export function renderEvening(date: string, content: string, source: ReviewSource | "rule" = "rule"): string {
  const body = sanitizeNotifyText(content);
  return sanitizeNotifyText(`AI Todo 晚报｜${date}\n\n${body}\n\n生成模式：${modeLabel(source)}`);
}

export function renderWeekly(date: string, content: string, source: ReviewSource | "rule" = "rule"): string {
  const body = sanitizeNotifyText(content);
  return sanitizeNotifyText(`AI Todo 周报｜${date}\n\n${body}\n\n生成模式：${modeLabel(source)}`);
}

export function renderTest(): string {
  return sanitizeNotifyText("AI Todo 测试推送\n配置正常 ✅");
}

// 自定义推送任务的内容渲染（模板占位符替换）
export function renderTemplate(template: string, ctx: Record<string, string>): string {
  if (!template || !template.trim()) {
    return sanitizeNotifyText(
      `AI Todo 推送｜${ctx.date ?? ""}\n待办 ${ctx.pending_count ?? "?"} · 逾期 ${ctx.overdue_count ?? "?"} · 高优先级 ${ctx.high_count ?? "?"}`
    );
  }
  const out = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (ctx[k] !== undefined ? ctx[k] : ""));
  return sanitizeNotifyText(out);
}

// ---------- 发送（幂等 + 重试） ----------
// 重试策略（provider 无关）：
//   - 2xx          → 成功，结束
//   - 4xx（客户端错误，如无效 topic / 鉴权失败）→ 非重试（业务拒绝）
//   - 5xx / 网络异常 → 重试，最多 3 次
// scope 用于幂等键：内置任务用 type，自定义任务用任务 id（避免多任务同日互相覆盖）。
export async function sendPush(
  env: Env,
  userId: string,
  type: PushType,
  content: string,
  reqId: string,
  scope?: string
): Promise<void> {
  const bd = businessDate();
  const idemScope = scope ?? type;
  const idempotencyKey = `${userId}:${bd}:${idemScope}`;

  const url = await resolveNotifyUrl(env);
  // 未配置 webhook：静默跳过（cron 推送不记录失败，避免无谓噪声）
  if (!url) {
    log("info", "push_skipped_no_config", { type, idemScope }, reqId);
    return;
  }

  if (await q.pushLogExists(env.DB, idempotencyKey)) {
    log("info", "push_skipped", { type, idempotencyKey }, reqId);
    return;
  }

  let attempt = 0;
  let success = false;
  let httpStatus: number | null = null;
  let resp = "";

  while (attempt < 3) {
    attempt++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildNotifyPayload(url, type, content)),
      });
      httpStatus = res.status;
      resp = (await res.text().catch(() => "")) || "";

      if (res.ok) {
        success = true;
        break;
      }
      if (res.status >= 400 && res.status < 500) break; // 业务拒绝，不重试
      if (attempt >= 3) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    } catch {
      if (attempt >= 3) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  await q.insertPushLog(env.DB, userId, bd, type, idempotencyKey, success ? "success" : "failed", httpStatus, resp.slice(0, 500), attempt);
  if (!success) {
    log("error", "push_failed", { type, httpStatus, idempotencyKey }, reqId);
  }
}

export async function testPush(env: Env, userId: string, reqId: string): Promise<void> {
  if (!(await resolveNotifyUrl(env))) {
    throw new HttpError(STATUS.PUSH_FAILED, "PUSH_FAILED", "未配置推送 Webhook（NOTIFY_WEBHOOK_URL 或 bot_config.webhook_url）");
  }
  await sendPush(env, userId, "test", renderTest(), reqId);
}
