import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

import app from "../../src/index";
import type { Env } from "../../src/types";
import { businessDate } from "../../src/utils/time";
import {
  getDb,
  disposeMf,
  resetSchema,
  makeEnv,
  seedUser,
  flush,
  makeCtx,
  createWebhookMock,
  installWebhook,
  restoreWebhook,
  type SeedUser,
} from "./harness";

describe("Cron job integration (jobs → review → push)", () => {
  let db: D1Database;
  let env: Env;
  let user: SeedUser;
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
    // one task due today so morning/evening reports have content
    await db
      .prepare(
        "INSERT INTO tasks (id, user_id, title, priority, status, due_date, created_at, updated_at) VALUES (?, ?, ?, 'high', 'pending', ?, ?, ?)"
      )
      .bind("task-1", user.id, "cron task", businessDate(), new Date().toISOString(), new Date().toISOString())
      .run();
  });
  afterEach(() => {
    restoreWebhook();
  });

  async function runCron(cron: string): Promise<void> {
    const { waitList, ctx } = makeCtx();
    await app.scheduled({ cron, scheduledTime: Date.now(), type: "scheduled" } as any, env, ctx);
    await flush(waitList);
  }

  async function pushLogs() {
    const rows = await db.prepare("SELECT * FROM push_logs").all();
    return (rows.results ?? []) as any[];
  }
  async function reviews(type: string) {
    const rows = await db
      .prepare("SELECT * FROM reviews WHERE review_type = ?")
      .bind(type)
      .all();
    return (rows.results ?? []) as any[];
  }

  it("morning cron (30 0 * * 1-5) generates a morning push with today's tasks", async () => {
    await runCron("30 0 * * 1-5");
    const logs = await pushLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].push_type).toBe("morning");
    expect(logs[0].status).toBe("success");
    expect(webhook.calls).toHaveLength(1);
    expect(webhook.calls[0].message).toContain("早报");
    expect(webhook.calls[0].message).toContain("cron task");
  });

  it("evening cron (30 10 * * *) generates a rule-based review and pushes it", async () => {
    await runCron("30 10 * * *");
    const revs = await reviews("evening");
    expect(revs).toHaveLength(1);
    expect(revs[0].source).toBe("rule");

    const logs = await pushLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].push_type).toBe("evening");
    expect(webhook.calls[0].message).toContain("晚报");
    expect(webhook.calls[0].message).toContain("规则引擎");
  });

  it("weekly cron (45 10 * * 5) generates a weekly review and pushes it", async () => {
    await runCron("45 10 * * 5");
    const revs = await reviews("weekly");
    expect(revs).toHaveLength(1);
    expect(revs[0].source).toBe("rule");

    const logs = await pushLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].push_type).toBe("weekly");
    expect(webhook.calls[0].message).toContain("周报");
  });

  it("skips gracefully when there is no active user (no push, no error)", async () => {
    await resetSchema(db); // no user seeded
    await runCron("30 0 * * 1-5");
    expect(webhook.calls).toHaveLength(0);
    expect(await pushLogs()).toHaveLength(0);
  });

  it("ignores unknown cron expressions (no handler runs)", async () => {
    await runCron("0 0 * * 0");
    expect(webhook.calls).toHaveLength(0);
    expect(await pushLogs()).toHaveLength(0);
  });
});
