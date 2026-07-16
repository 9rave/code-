// 规则引擎适配器：确定性复盘，无 AI 依赖（见开发指南 §4.1 / §4.3）
import type { ModelAdapter, ReviewInput, ModelResult } from "../types";

export class RuleBasedAdapter implements ModelAdapter {
  name = "rule";

  async generateReview(input: ReviewInput): Promise<ModelResult> {
    const start = Date.now();
    const content = buildRuleContent(input);
    return { content, provider: "rule", model: "rule-engine", latencyMs: Date.now() - start };
  }
}

function buildRuleContent(input: ReviewInput): string {
  const { stats } = input;
  const rate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
  const lines: string[] = [];
  lines.push(`今日完成率 ${rate}%`);
  lines.push(
    `完成 ${stats.completed} / 共 ${stats.total}，未完成 ${stats.pending}，逾期 ${stats.overdue}，高优先级 ${stats.highPriority}`
  );
  lines.push("建议：" + buildDeterministicSuggestions(input));
  return lines.join("\n");
}

function buildDeterministicSuggestions(input: ReviewInput): string {
  const overdueHigh = input.tasks.filter(
    (t) => t.status === "pending" && t.due_date && t.priority === "high"
  );
  if (overdueHigh.length) {
    return "先处理逾期的【高优先级】任务：" + overdueHigh.map((t) => t.title).join("、");
  }
  const pending = input.tasks.filter((t) => t.status === "pending");
  if (pending.length) {
    return "按计划推进；优先处理高优先级与较早截止的任务：" + pending.slice(0, 3).map((t) => t.title).join("、");
  }
  return "今日任务已清空，可规划明日重点。";
}
