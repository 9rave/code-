// Gemini 适配器（MVP4 预留，见开发指南 §4.1 / §16）
// 通过 Google Generative Language REST API 调用；仅启用 AI 且配置了 GEMINI_API_KEY 时生效。
import type { ModelAdapter, ReviewInput, ModelResult, GenerateOptions, Env, ProviderHealth } from "../types";
import { SYSTEM_PROMPT, buildUserPayload, extractContent } from "./prompt";

export class GeminiAdapter implements ModelAdapter {
  name = "gemini";
  constructor(private env: Env) {}

  private get key(): string | undefined {
    return this.env.GEMINI_API_KEY;
  }
  private get model(): string {
    return this.env.GEMINI_MODEL || "gemini-1.5-flash";
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: !!this.key, detail: this.key ? undefined : "GEMINI_API_KEY 未配置" };
  }

  async generateReview(input: ReviewInput, opts: GenerateOptions): Promise<ModelResult> {
    const key = this.key;
    if (!key) throw new Error("GEMINI_API_KEY_MISSING");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${key}`;
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: buildUserPayload(input) }] }],
      generationConfig: {
        maxOutputTokens: opts.maxTokens,
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    };

    const start = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GEMINI_HTTP_${res.status}: ${detail.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const raw =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    const content = extractContent(raw);
    return {
      content,
      provider: "gemini",
      model: this.model,
      latencyMs: Date.now() - start,
      usage: { raw: true },
    };
  }
}
