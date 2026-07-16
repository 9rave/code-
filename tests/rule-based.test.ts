import { describe, it, expect } from "vitest";
import { RuleBasedAdapter } from "../src/adapters/rule-based";
import type { ReviewInput } from "../src/types";

function makeInput(overrides: Partial<ReviewInput["stats"]> = {}): ReviewInput {
  return {
    tasks: [
      { title: "任务A", priority: "high", due_date: "2026-07-16", status: "completed", estimated_duration_minutes: 30 },
      { title: "任务B", priority: "medium", due_date: "2026-07-20", status: "pending", estimated_duration_minutes: 60 },
    ],
    stats: { total: 2, completed: 1, pending: 1, overdue: 1, highPriority: 1, ...overrides },
  };
}

describe("RuleBasedAdapter", () => {
  it("生成包含完成率的确定性内容", async () => {
    const r = await new RuleBasedAdapter().generateReview(makeInput(), { timeoutMs: 0, maxTokens: 0 });
    expect(r.provider).toBe("rule");
    expect(r.content).toContain("完成率 50%");
  });

  it("对逾期高优先级任务给出优先建议", async () => {
    const r = await new RuleBasedAdapter().generateReview(makeInput(), { timeoutMs: 0, maxTokens: 0 });
    expect(r.content).toContain("高优先级");
  });

  it("无任务时给出中性建议", async () => {
    const r = await new RuleBasedAdapter().generateReview(
      { tasks: [], stats: { total: 0, completed: 0, pending: 0, overdue: 0, highPriority: 0 } },
      { timeoutMs: 0, maxTokens: 0 }
    );
    expect(r.content.length).toBeGreaterThan(0);
  });
});
