// Groq 适配器（MVP4 预留，见开发指南 §4.1 / §16）
// OpenAI 兼容 Chat Completions 接口；仅启用 AI 且配置了 GROQ_API_KEY 时生效。
import type { ModelAdapter, ReviewInput, ModelResult, GenerateOptions, Env, ProviderHealth } from "../types";
import { SYSTEM_PROMPT, buildUserPayload, extractContent } from "./prompt";

export class GroqAdapter implements ModelAdapter {
  name = "groq";
  constructor(private env: Env) {}

  private get key(): string | undefined {
    return this.env.GROQ_API_KEY;
  }
  private get model(): string {
    return this.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: !!this.key, detail: this.key ? undefined : "GROQ_API_KEY 未配置" };
  }

  async generateReview(input: ReviewInput, opts: GenerateOptions): Promise<ModelResult> {
    const key = this.key;
    if (!key) throw new Error("GROQ_API_KEY_MISSING");

    const url = "https://api.groq.com/openai/v1/chat/completions";
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPayload(input) },
      ],
      max_tokens: opts.maxTokens,
      temperature: 0.3,
      response_format: { type: "json_object" },
    };

    const start = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GROQ_HTTP_${res.status}: ${detail.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const content = extractContent(raw);
    return {
      content,
      provider: "groq",
      model: this.model,
      latencyMs: Date.now() - start,
      usage: { raw: true },
    };
  }
}
