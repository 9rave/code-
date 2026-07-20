import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../src/types";
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
import { runScheduler } from "../../src/services/scheduler";

describe("scheduler + push_tasks integration", () => {
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
    cookie = (await loginAs(env, makeCtx().ctx, user, "5.5.5.1")).cookie;
  });
  afterEach(() => {
    restoreWebhook();
  });

  async function insertTask(id: string, nextRunAt: string, enabled = 1) {
    await db
      .prepare(
        "INSERT INTO push_tasks (id,name,kind,schedule_cron,template,enabled,last_status,next_run_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
      )
      .bind(id, "任务" + id, "custom", "0 9 * * *", "{{date}} 待办 {{pending_count}}", enabled, "never", nextRunAt, nextRunAt, nextRunAt)
      .run();
  }

  it("runs a due custom task: pushes, logs, advances next_run_at", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await insertTask("t1", past, 1);

    await runScheduler(env);

    const logs = (await db.prepare("SELECT * FROM push_logs").all()).results ?? [];
    expect(logs).toHaveLength(1);
    expect((logs[0] as any).status).toBe("success");
    expect((logs[0] as any).push_type).toBe("custom");
    expect((logs[0] as any).idempotency_key).toContain("t1");

    expect(webhook.calls).toHaveLength(1);
    expect(webhook.calls[0].message).toContain("待办");

    const t = await db.prepare("SELECT next_run_at FROM push_tasks WHERE id='t1'").first();
    expect(new Date((t as any).next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("skips disabled and not-due tasks", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await insertTask("t2", future, 0); // disabled
    await insertTask("t3", future, 1); // enabled but not due

    await runScheduler(env);

    const logs = (await db.prepare("SELECT * FROM push_logs").all()).results ?? [];
    expect(logs).toHaveLength(0);
  });

  it("push-tasks CRUD API + validation", async () => {
    const create = await call(env, makeCtx().ctx, "POST", "/api/push-tasks", {
      cookie,
      body: { name: "每日摘要", scheduleCron: "0 9 * * *", template: "{{date}} 你好" },
    });
    expect(create.status).toBe(201);
    const id = create.json.data.item.id;
    expect(create.json.data.item.nextRunAt).toBeTruthy();

    const list = await call(env, makeCtx().ctx, "GET", "/api/push-tasks", { cookie });
    expect(list.json.data.items).toHaveLength(1);

    const upd = await call(env, makeCtx().ctx, "PUT", `/api/push-tasks/${id}`, { cookie, body: { name: "改名" } });
    expect(upd.json.data.item.name).toBe("改名");

    const bad = await call(env, makeCtx().ctx, "POST", "/api/push-tasks", { cookie, body: { name: "X", scheduleCron: "nope" } });
    expect(bad.status).toBe(400);

    const del = await call(env, makeCtx().ctx, "DELETE", `/api/push-tasks/${id}`, { cookie });
    expect(del.json.data.deleted).toBe(true);

    // 回归：删除后按 id 获取应返回 404（而非 500）
    const missing = await call(env, makeCtx().ctx, "GET", `/api/push-tasks/${id}`, { cookie });
    expect(missing.status).toBe(404);
  });

  it("回归：PATCH /api/push-tasks/:id 必须路由到更新逻辑（此前仅注册 PUT，导致 PATCH 静默 404）", async () => {
    const create = await call(env, makeCtx().ctx, "POST", "/api/push-tasks", {
      cookie,
      body: { name: "PATCH回归", scheduleCron: "0 9 * * *", template: "x" },
    });
    expect(create.status).toBe(201);
    const id = create.json.data.item.id;

    // PATCH 部分更新：此前返回 404，现应 200 并应用变更
    const patchUpd = await call(env, makeCtx().ctx, "PATCH", `/api/push-tasks/${id}`, { cookie, body: { enabled: false } });
    expect(patchUpd.status).toBe(200);
    expect(patchUpd.json.data.item.enabled).toBe(false);

    await call(env, makeCtx().ctx, "DELETE", `/api/push-tasks/${id}`, { cookie });
  });

  it("bot-config get/set via API", async () => {
    const set = await call(env, makeCtx().ctx, "PUT", "/api/bot-config", {
      cookie,
      body: { webhookUrl: "https://ntfy.sh/test-topic", provider: "ntfy" },
    });
    expect(set.status).toBe(200);
    const get = await call(env, makeCtx().ctx, "GET", "/api/bot-config", { cookie });
    expect(get.json.data.webhookUrl).toBe("https://ntfy.sh/test-topic");
    expect(get.json.data.managed).toBe(true);
  });
});
