// 输入脱敏：构造发给模型的 ReviewInput 时，仅保留白名单字段，默认不含备注（见开发指南 §4.4）
import type { Task, ReviewInput, ReviewStats } from "../types";

export function buildReviewInput(tasks: Task[], stats: ReviewStats): ReviewInput {
  return {
    tasks: tasks.map((t) => ({
      title: t.title,
      priority: t.priority,
      due_date: t.dueDate,
      status: t.status,
      estimated_duration_minutes: t.estimatedDurationMinutes,
    })),
    stats,
  };
}

// 若确需发送备注，先截断并做基础敏感词/模式过滤（演示级；生产应结合更完整策略）
export function safeNotes(notes: string | null, maxLen = 200): string | null {
  if (!notes) return null;
  const cleaned = notes.replace(/\b(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|password|token|secret|密钥)\b/gi, "[REDACTED]");
  return cleaned.slice(0, maxLen);
}

// 推送文本护栏（原 ADR-005，企微 → 通用 webhook）：第三方 webhook 不应接收 HTML/控制字符。
// 策略：剥离 HTML 标签与控制字符，截断到上限。适用于 ntfy / Telegram / Discord 等任意文本渠道。
export function sanitizeNotifyText(text: string, maxLen = 4000): string {
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, "") // 剥离 HTML 标签，防注入与渲染异常
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // 移除控制字符（保留 \n）
    .replace(/\u0009/g, "  ") // Tab → 两空格
    .slice(0, maxLen);
}
