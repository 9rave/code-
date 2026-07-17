import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

import type { Env } from "../../src/types";
import { businessDate, addDays } from "../../src/utils/time";
import {
  getDb,
  disposeMf,
  resetSchema,
  makeEnv,
  seedUser,
  loginAs,
  call,
  makeCtx,
  createWebhookMock,
  installWebhook,
  restoreWebhook,
  type SeedUser,
} from "./harness";

// A fake Workers AI binding that returns a clean JSON review.
const fakeAiSuccess = {
  run: async (_model: string, _opts: any) => ({
    response: JSON.stringify({ content: "AI generated evening review" }),
  }),
};
// A fake Workers AI binding that always throws → must fall back to rule engine.
const fakeAiThrows = {
  run: async () => {
    throw new Error(" Workers AI unavailable");
  },
};

describe("Reviews & daily-log integration", () => {
  let db: D1Database;
  let env: Env;
  let user: SeedUser;
  let cookie: string;
  const webhook = createWebhookMock();

  beforeAll(async () => {
    db = await getDb();
  });
  afterAll(async () => {
    await disposeMf();
  });
  beforeEach(async () => {
    await resetSchema(db);
    user = await seedUser(db);
    env = makeEnv(db);
    webhook.setBehavior("ok");
    webhook.calls.length = 0;
    installWebhook(webhook);
    cookie = (await loginAs(env, makeCtx().ctx, user, "4.4.4.1")).cookie;
  });
  afterEach(() => {
    restoreWebhook();
  });

  it("generates a rule-based evening review (AI disabled) and persists it to D1", async () => {
    await call(env, makeCtx().ctx, "POST", "/api/tasks", {
      cookie,
      body: { title: "task a", priority: "high", dueDate: businessDate() },
    });

    const r = await call(env, makeCtx().ctx, "POST", "/api/reviews/generate", {
      cookie,
      body: { type: "evening" },
    });
    expect(r.status).toBe(200);
    expect(r.json.data.source).toBe("rule");
    expect(r.json.data.content).toContain("完成率");

    // DB row exists and is idempotent on (user, date, type)
    const list = await call(env, makeCtx().ctx, "GET", `/api/reviews?type=evening`, { cookie });
    expect(list.json.data).toHaveLength(1);
    expect(list.json.data[0].source).toBe("rule");
  });

  it("uses Workers AI when enabled and records AI usage", async () => {
    env = makeEnv(db, { AI_ENABLED: "true", AI: fakeAiSuccess as any });

    const r = await call(env, makeCtx().ctx, "POST", "/api/reviews/generate", {
      cookie,
      body: { type: "evening" },
    });
    expect(r.status).toBe(200);
    expect(r.json.data.source).toBe("ai");
    expect(r.json.data.provider).toBe("workers_ai");
    expect(r.json.data.content).toBe("AI generated evening review");

    const ctx = makeCtx();
    const usage = await call(env, ctx.ctx, "GET", "/api/settings/status", { cookie });
    expect(usage.json.data.aiStatus).toBe("workers_ai");
    expect(usage.json.data.lastCall?.outcome).toBe("success");
  });

  it("falls back to the rule engine when Workers AI throws (degraded, not an error)", async () => {
    env = makeEnv(db, { AI_ENABLED: "true", AI: fakeAiThrows as any });

    const r = await call(env, makeCtx().ctx, "POST", "/api/reviews/generate", {
      cookie,
      body: { type: "evening" },
    });
    expect(r.status).toBe(200);
    expect(r.json.data.source).toBe("rule"); // baseline used
    expect(r.json.meta?.degraded).toBe(true); // flagged degraded

    const status = await call(env, makeCtx().ctx, "GET", "/api/settings/status", { cookie });
    expect(status.json.data.lastCall?.outcome).toBe("degraded");
  });

  it("enforces the daily manual AI generation limit", async () => {
    env = makeEnv(db, { AI_ENABLED: "true", AI_DAILY_MANUAL_LIMIT: "1", AI: fakeAiSuccess as any });

    const first = await call(env, makeCtx().ctx, "POST", "/api/reviews/generate", {
      cookie,
      body: { type: "evening" },
    });
    expect(first.status).toBe(200);
    expect(first.json.data.source).toBe("ai");

    const second = await call(env, makeCtx().ctx, "POST", "/api/reviews/generate", {
      cookie,
      body: { type: "evening" },
    });
    expect(second.status).toBe(429);
    expect(second.json.error.code).toBe("RATE_LIMITED");
  });

  it("upserts and reads the daily log", async () => {
    const date = businessDate();
    const put = await call(env, makeCtx().ctx, "PUT", `/api/daily-log/${date}`, {
      cookie,
      body: { mood: "focused", summary: "shipped tests", blockers: "none" },
    });
    expect(put.status).toBe(200);
    expect(put.json.data.mood).toBe("focused");

    const get = await call(env, makeCtx().ctx, "GET", `/api/daily-log?date=${date}`, { cookie });
    expect(get.status).toBe(200);
    expect(get.json.data.summary).toBe("shipped tests");

    // upsert updates in place
    const put2 = await call(env, makeCtx().ctx, "PUT", `/api/daily-log/${date}`, {
      cookie,
      body: { mood: "tired", summary: "refactored" },
    });
    expect(put2.json.data.mood).toBe("tired");
    expect(put2.json.data.summary).toBe("refactored");
  });

  it("lists reviews within a date range and rejects malformed dates", async () => {
    await call(env, makeCtx().ctx, "POST", "/api/reviews/generate", {
      cookie,
      body: { type: "evening" },
    });
    const from = addDays(businessDate(), -1);
    const to = businessDate();
    const list = await call(env, makeCtx().ctx, "GET", `/api/reviews?type=evening&from=${from}&to=${to}`, {
      cookie,
    });
    expect(list.status).toBe(200);
    expect(list.json.data.length).toBeGreaterThanOrEqual(1);

    const bad = await call(env, makeCtx().ctx, "GET", `/api/reviews?type=evening&from=2026/01/01&to=${to}`, {
      cookie,
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("VALIDATION_ERROR");
  });
});
