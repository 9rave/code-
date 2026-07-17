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

describe("WeCom push integration (idempotency & retry)", () => {
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

  async function pushLogs() {
    const rows = await db.prepare("SELECT * FROM push_logs").all();
    return (rows.results ?? []) as any[];
  }

  it("test-push succeeds, calls the webhook once and writes a success log", async () => {
    const r = await call(env, makeCtx().ctx, "POST", "/api/settings/test-push", { cookie });
    expect(r.status).toBe(200);
    expect(r.json.data.pushed).toBe(true);

    expect(webhook.calls).toHaveLength(1);
    const logs = await pushLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("success");
    expect(logs[0].push_type).toBe("test");
    expect(logs[0].http_status).toBe(200);
  });

  it("is idempotent for the same day+type (second push is skipped, no extra webhook call)", async () => {
    const first = await call(env, makeCtx().ctx, "POST", "/api/settings/test-push", { cookie });
    expect(first.status).toBe(200);
    const second = await call(env, makeCtx().ctx, "POST", "/api/settings/test-push", { cookie });
    expect(second.status).toBe(200);

    // webhook only hit once; exactly one log row (skipped pushes are no-ops)
    expect(webhook.calls).toHaveLength(1);
    const logs = await pushLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("success");
  });

  it("retries on HTTP 500 up to 3 times, then logs a failed push", async () => {
    webhook.setBehavior("always_500");
    const r = await call(env, makeCtx().ctx, "POST", "/api/settings/test-push", { cookie });
    expect(r.status).toBe(200); // route still 200; push failure is non-fatal

    expect(webhook.calls).toHaveLength(3); // 3 attempts
    const logs = await pushLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("failed");
    expect(logs[0].attempt_count).toBe(3);
    expect(logs[0].http_status).toBe(500);
  });

  it("does NOT retry on a business-level error (errcode != 0), logs a failed push once", async () => {
    webhook.setBehavior("biz_error");
    const r = await call(env, makeCtx().ctx, "POST", "/api/settings/test-push", { cookie });
    expect(r.status).toBe(200);

    expect(webhook.calls).toHaveLength(1); // no retry
    const logs = await pushLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("failed");
    expect(logs[0].attempt_count).toBe(1);
  });

  it("returns 502 PUSH_FAILED when the webhook is not configured", async () => {
    env = makeEnv(db, { WECOM_WEBHOOK_URL: "" });
    const r = await call(env, makeCtx().ctx, "POST", "/api/settings/test-push", { cookie });
    expect(r.status).toBe(502);
    expect(r.json.error.code).toBe("PUSH_FAILED");
  });
});
