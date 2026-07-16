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

// 企微 Markdown 子集护栏（见 ADR-005）：企微仅支持受限 Markdown，且不支持内嵌 HTML。
// 策略：剥离 HTML 标签与控制字符，保留企微支持的语法（标题/加粗/引用/列表/行内代码/链接）。
// 注意：不转义独立的 `>`（企微用其表示引用），仅移除成对的 <...> 标签。
export function sanitizeWeComMarkdown(md: string, maxLen = 4000): string {
  if (!md) return "";
  return md
    .replace(/<[^>]*>/g, "") // 剥离 HTML 标签，防注入与渲染异常
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // 移除控制字符（保留 \n）
    .replace(/\u0009/g, "  ") // Tab → 两空格
    .slice(0, maxLen);
}
