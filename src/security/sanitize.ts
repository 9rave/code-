// 输入脱敏：构造发给模型的 ReviewInput 时，仅保留白名单字段，默认不含备注（见开发指南 §4.4）
import type { Task, ReviewInput, ReviewStats } from "../types";

export function buildReviewInput(tasks: Task[], stats: ReviewStats): ReviewInput {
  return {
    tasks: tasks.map((t) => ({
      title: t.title,
      priority: t.priority,
      due_date: t.due_date,
      status: t.status,
      estimated_duration_minutes: t.estimated_duration_minutes,
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
