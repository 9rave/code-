// 模型路由与降级（见开发指南 §4.3）
// 规则基线始终先生成；启用 AI 时尝试增强，任何异常/非法输出回退规则结果。
import type { ModelAdapter, ReviewInput, ModelResult, GenerateOptions, Env } from "../types";
import { RuleBasedAdapter } from "./rule-based";
import { WorkersAIAdapter } from "./workers-ai";

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms));
  return Promise.race([p, timeout]);
}

export function validateOutput(r: ModelResult): boolean {
  return typeof r.content === "string" && r.content.trim().length > 0;
}

export interface FallbackResult {
  result: ModelResult;
  degraded: boolean;
  reason?: string;
}

export async function generateWithFallback(
  env: Env,
  input: ReviewInput,
  opts: GenerateOptions
): Promise<FallbackResult> {
  const rule = new RuleBasedAdapter();
  const baseline = await rule.generateReview(input);

  if (env.AI_ENABLED !== "true" || !env.AI) {
    return { result: baseline, degraded: false };
  }

  try {
    const primary = new WorkersAIAdapter(env);
    const result = await withTimeout(primary.generateReview(input, opts), opts.timeoutMs);
    if (!validateOutput(result)) {
      return { result: baseline, degraded: true, reason: "invalid_output" };
    }
    return { result, degraded: false };
  } catch (e: any) {
    return { result: baseline, degraded: true, reason: e?.message || "error" };
  }
}
