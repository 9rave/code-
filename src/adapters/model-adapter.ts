// 模型路由与降级（见开发指南 §4.3）
// 规则基线始终先生成；启用 AI 时按 AI_PROVIDER 选择增强适配器，任何异常/非法输出/缺密钥回退规则结果。
import type { ModelAdapter, ReviewInput, ModelResult, GenerateOptions, Env } from "../types";
import { RuleBasedAdapter } from "./rule-based";
import { WorkersAIAdapter } from "./workers-ai";
import { GeminiAdapter } from "./gemini";
import { GroqAdapter } from "./groq";
import { DeepSeekAdapter } from "./deepseek";

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

// 按 AI_PROVIDER 选择「主」适配器；缺密钥/绑定/未知 provider/未启用时返回 null（调用方回退规则）。
export function createPrimaryAdapter(env: Env): ModelAdapter | null {
  if (env.AI_ENABLED !== "true") return null;
  switch (env.AI_PROVIDER) {
    case "workers_ai":
      return env.AI ? new WorkersAIAdapter(env) : null;
    case "gemini":
      return env.GEMINI_API_KEY ? new GeminiAdapter(env) : null;
    case "groq":
      return env.GROQ_API_KEY ? new GroqAdapter(env) : null;
    case "deepseek":
      return env.DEEPSEEK_API_KEY ? new DeepSeekAdapter(env) : null;
    default:
      return null;
  }
}

export async function generateWithFallback(
  env: Env,
  input: ReviewInput,
  opts: GenerateOptions
): Promise<FallbackResult> {
  const rule = new RuleBasedAdapter();
  const baseline = await rule.generateReview(input);

  const primary = createPrimaryAdapter(env);
  // 未启用 AI：规则即最终结果（非降级）
  if (!primary) {
    const degraded = env.AI_ENABLED === "true"; // 启用了却选不到适配器 = 降级
    return { result: baseline, degraded, reason: degraded ? "no_primary_adapter" : undefined };
  }

  try {
    const result = await withTimeout(primary.generateReview(input, opts), opts.timeoutMs);
    if (!validateOutput(result)) {
      return { result: baseline, degraded: true, reason: "invalid_output" };
    }
    return { result, degraded: false };
  } catch (e: any) {
    return { result: baseline, degraded: true, reason: e?.message || "error" };
  }
}
