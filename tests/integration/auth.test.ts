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
  cookieFrom,
  makeCtx,
  createWebhookMock,
  installWebhook,
  restoreWebhook,
  type SeedUser,
} from "./harness";

describe("Auth & session integration", () => {
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
  });
  afterEach(() => {
    restoreWebhook();
  });

  it("login returns a session cookie and /me reflects the authenticated user", async () => {
    const { ctx } = makeCtx();
    const login = await call(env, ctx, "POST", "/api/auth/login", {
      body: { username: user.username, password: user.password },
      ip: "1.1.1.1",
    });
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login.res);
    expect(cookie.startsWith("session=")).toBe(true);

    const me = await call(env, ctx, "GET", "/api/auth/me", { cookie });
    expect(me.status).toBe(200);
    expect(me.json.data.username).toBe(user.username);
    expect(me.json.data.mustChangePassword).toBe(true); // seeded default
  });

  it("rejects a wrong password with 401 AUTH_FAILED", async () => {
    const { ctx } = makeCtx();
    const r = await call(env, ctx, "POST", "/api/auth/login", {
      body: { username: user.username, password: "Wrong#Passw0rd" },
      ip: "1.1.1.2",
    });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("AUTH_FAILED");
  });

  it("rejects an unknown username with 401 AUTH_FAILED", async () => {
    const { ctx } = makeCtx();
    const r = await call(env, ctx, "POST", "/api/auth/login", {
      body: { username: "ghost", password: "whatever" },
      ip: "1.1.1.3",
    });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("AUTH_FAILED");
  });

  it("locks login after 10 attempts in the window (429 + Retry-After), proving cross-instance rate limiting", async () => {
    const { ctx } = makeCtx();
    const ip = "9.9.9.9";
    let locked: Awaited<ReturnType<typeof call>> | null = null;
    for (let i = 0; i < 11; i++) {
      const r = await call(env, ctx, "POST", "/api/auth/login", {
        body: { username: user.username, password: "bad" },
        ip,
      });
      if (i < 10) expect(r.status).toBe(401); // counted but wrong creds
      else locked = r;
    }
    expect(locked!.status).toBe(429);
    expect(locked!.res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(locked!.json.error.code).toBe("RATE_LIMITED");
  });

  it("returns 401 AUTH_REQUIRED for protected routes without a session", async () => {
    const { ctx } = makeCtx();
    const r = await call(env, ctx, "GET", "/api/tasks");
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("AUTH_REQUIRED");
  });

  it("change-password rotates credentials (old rejected, new accepted)", async () => {
    const { ctx } = makeCtx();
    const { cookie } = await loginAs(env, ctx, user, "2.2.2.2");
    const newPass = "N3w#Str0ngPass";

    const change = await call(env, ctx, "POST", "/api/auth/change-password", {
      cookie,
      body: { currentPassword: user.password, newPassword: newPass },
    });
    expect(change.status).toBe(200);

    const old = await call(env, ctx, "POST", "/api/auth/login", {
      body: { username: user.username, password: user.password },
      ip: "2.2.2.3",
    });
    expect(old.status).toBe(401);

    const neu = await call(env, ctx, "POST", "/api/auth/login", {
      body: { username: user.username, password: newPass },
      ip: "2.2.2.4",
    });
    expect(neu.status).toBe(200);
  });

  it("change-password rejects a wrong current password", async () => {
    const { ctx } = makeCtx();
    const { cookie } = await loginAs(env, ctx, user, "2.2.2.5");
    const r = await call(env, ctx, "POST", "/api/auth/change-password", {
      cookie,
      body: { currentPassword: "wrong", newPassword: "N3w#Str0ngPass" },
    });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("AUTH_FAILED");
  });

  it("change-password enforces the password policy (400 on weak password)", async () => {
    const { ctx } = makeCtx();
    const { cookie } = await loginAs(env, ctx, user, "2.2.2.6");
    const r = await call(env, ctx, "POST", "/api/auth/change-password", {
      cookie,
      body: { currentPassword: user.password, newPassword: "short" },
    });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION_ERROR");
  });

  it("password change invalidates previously issued sessions (session_version check)", async () => {
    const { ctx } = makeCtx();
    const { cookie: oldCookie } = await loginAs(env, ctx, user, "2.2.2.7");

    await call(env, ctx, "POST", "/api/auth/change-password", {
      cookie: oldCookie,
      body: { currentPassword: user.password, newPassword: "N3w#Str0ngPass" },
    });

    const me = await call(env, ctx, "GET", "/api/auth/me", { cookie: oldCookie });
    expect(me.status).toBe(401);
    expect(me.json.error.code).toBe("AUTH_REQUIRED");
  });

  it("logout clears the session cookie", async () => {
    const { ctx } = makeCtx();
    const { cookie } = await loginAs(env, ctx, user, "2.2.2.8");
    const r = await call(env, ctx, "POST", "/api/auth/logout", { cookie });
    expect(r.status).toBe(200);
    const setCookies = (r.res.headers.getSetCookie?.() as string[] | undefined) ?? [];
    const sessionCookie = setCookies.find((c) => c.startsWith("session="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("Max-Age=0");
  });
});
