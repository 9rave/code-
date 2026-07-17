import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiAdapter } from "../src/adapters/gemini";
import { GroqAdapter } from "../src/adapters/groq";
import { DeepSeekAdapter } from "../src/adapters/deepseek";
import { WorkersAIAdapter } from "../src/adapters/workers-ai";
import { createPrimaryAdapter, generateWithFallback } from "../src/adapters/model-adapter";
import type { Env, ReviewInput } from "../src/types";

const INPUT: ReviewInput = {
  tasks: [
    { title: "写报告", priority: "high", due_date: "2026-07-17", status: "pending", estimated_duration_minutes: 60 },
  ],
  stats: { total: 1, completed: 0, pending: 1, overdue: 0, highPriority: 1 },
};
const OPTS = { timeoutMs: 5000, maxTokens: 400 };

function mockJsonResponse(payload: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status }));
}

describe("GeminiAdapter", () => {
  it("调用 Gemini REST 并提取 content", async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("key=test-key");
      const body = JSON.parse(init.body);
      expect(body.contents[0].parts[0].text).toContain("stats");
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ content: "Gemini 复盘" }) }] } }] }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-1.5-flash" } as unknown as Env;
    const r = await new GeminiAdapter(env).generateReview(INPUT, OPTS);
    expect(r.provider).toBe("gemini");
    expect(r.content).toBe("Gemini 复盘");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("缺少密钥时抛 GEMINI_API_KEY_MISSING", async () => {
    const env = {} as unknown as Env;
    await expect(new GeminiAdapter(env).generateReview(INPUT, OPTS)).rejects.toThrow("GEMINI_API_KEY_MISSING");
  });

  it("HTTP 非 200 时抛错", async () => {
    vi.stubGlobal("fetch", mockJsonResponse({ error: "bad" }, 400));
    const env = { GEMINI_API_KEY: "k" } as unknown as Env;
    await expect(new GeminiAdapter(env).generateReview(INPUT, OPTS)).rejects.toThrow("GEMINI_HTTP_400");
  });
});

describe("GroqAdapter", () => {
  it("调用 OpenAI 兼容接口并提取 content", async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(init.headers.authorization).toBe("Bearer test-key");
      const body = JSON.parse(init.body);
      expect(body.response_format.type).toBe("json_object");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ content: "Groq 复盘" }) } }] }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = { GROQ_API_KEY: "test-key" } as unknown as Env;
    const r = await new GroqAdapter(env).generateReview(INPUT, OPTS);
    expect(r.provider).toBe("groq");
    expect(r.content).toBe("Groq 复盘");
  });

  it("缺少密钥时抛 GROQ_API_KEY_MISSING", async () => {
    const env = {} as unknown as Env;
    await expect(new GroqAdapter(env).generateReview(INPUT, OPTS)).rejects.toThrow("GROQ_API_KEY_MISSING");
  });
});

describe("DeepSeekAdapter", () => {
  it("调用 DeepSeek 接口并提取 content", async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(init.headers.authorization).toBe("Bearer test-key");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ content: "DeepSeek 复盘" }) } }] }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = { DEEPSEEK_API_KEY: "test-key" } as unknown as Env;
    const r = await new DeepSeekAdapter(env).generateReview(INPUT, OPTS);
    expect(r.provider).toBe("deepseek");
    expect(r.content).toBe("DeepSeek 复盘");
  });

  it("缺少密钥时抛 DEEPSEEK_API_KEY_MISSING", async () => {
    const env = {} as unknown as Env;
    await expect(new DeepSeekAdapter(env).generateReview(INPUT, OPTS)).rejects.toThrow("DEEPSEEK_API_KEY_MISSING");
  });
});

describe("createPrimaryAdapter (工厂选择)", () => {
  it("AI 未启用 → null", () => {
    expect(createPrimaryAdapter({ AI_ENABLED: "false" } as unknown as Env)).toBeNull();
  });
  it("AI 启用 + gemini + 有密钥 → GeminiAdapter", () => {
    const a = createPrimaryAdapter({ AI_ENABLED: "true", AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" } as unknown as Env);
    expect(a).toBeInstanceOf(GeminiAdapter);
  });
  it("AI 启用 + groq + 有密钥 → GroqAdapter", () => {
    const a = createPrimaryAdapter({ AI_ENABLED: "true", AI_PROVIDER: "groq", GROQ_API_KEY: "k" } as unknown as Env);
    expect(a).toBeInstanceOf(GroqAdapter);
  });
  it("AI 启用 + deepseek + 有密钥 → DeepSeekAdapter", () => {
    const a = createPrimaryAdapter({ AI_ENABLED: "true", AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k" } as unknown as Env);
    expect(a).toBeInstanceOf(DeepSeekAdapter);
  });
  it("AI 启用 + workers_ai 且有绑定 → WorkersAIAdapter", () => {
    const a = createPrimaryAdapter({ AI_ENABLED: "true", AI_PROVIDER: "workers_ai", AI: {} } as unknown as Env);
    expect(a).toBeInstanceOf(WorkersAIAdapter);
  });
  it("AI 启用 + workers_ai 但无绑定 → null（回退规则）", () => {
    expect(createPrimaryAdapter({ AI_ENABLED: "true", AI_PROVIDER: "workers_ai" } as unknown as Env)).toBeNull();
  });
  it("未知 provider → null", () => {
    expect(createPrimaryAdapter({ AI_ENABLED: "true", AI_PROVIDER: "unknown" } as unknown as Env)).toBeNull();
  });
});

describe("generateWithFallback (降级)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ content: "AI 复盘内容" }) }] } }] }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("AI 未启用 → 规则基线，非降级", async () => {
    const r = await generateWithFallback({ AI_ENABLED: "false" } as unknown as Env, INPUT, OPTS);
    expect(r.degraded).toBe(false);
    expect(r.result.provider).toBe("rule");
  });

  it("AI 启用但 provider 缺密钥 → 降级回退规则", async () => {
    const r = await generateWithFallback({ AI_ENABLED: "true", AI_PROVIDER: "gemini" } as unknown as Env, INPUT, OPTS);
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe("no_primary_adapter");
    expect(r.result.provider).toBe("rule");
  });

  it("AI 启用 + gemini + 有密钥 → 返回 AI 结果，非降级", async () => {
    const r = await generateWithFallback(
      { AI_ENABLED: "true", AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" } as unknown as Env,
      INPUT,
      OPTS
    );
    expect(r.degraded).toBe(false);
    expect(r.result.provider).toBe("gemini");
    expect(r.result.content).toBe("AI 复盘内容");
  });
});
