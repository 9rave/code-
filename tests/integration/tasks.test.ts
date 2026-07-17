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

describe("Tasks API integration", () => {
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
    cookie = (await loginAs(env, makeCtx().ctx, user, "3.3.3.1")).cookie;
  });
  afterEach(() => {
    restoreWebhook();
  });

  async function createTask(body: Record<string, unknown>) {
    const { ctx } = makeCtx();
    const r = await call(env, ctx, "POST", "/api/tasks", { cookie, body });
    expect(r.status).toBe(200);
    return r.json.data as any;
  }

  it("creates a task with camelCase contract fields persisted to D1", async () => {
    const task = await createTask({
      title: "Ship integration tests",
      priority: "high",
      dueDate: businessDate(),
      estimatedDurationMinutes: 90,
      tags: ["qa", "release"],
    });
    expect(task.id).toBeTruthy();
    expect(task.dueDate).toBe(businessDate());
    expect(task.estimatedDurationMinutes).toBe(90);
    expect(task.tags).toEqual(["qa", "release"]);
    expect(task.status).toBe("pending");
  });

  it("rejects invalid task input (empty title / bad priority / bad dueDate / bad duration)", async () => {
    const cases: Record<string, unknown>[] = [
      { title: "" },
      { title: "x", priority: "urgent" },
      { title: "x", dueDate: "2026/07/16" },
      { title: "x", estimatedDurationMinutes: 99999 },
    ];
    for (const body of cases) {
      const { ctx } = makeCtx();
      const r = await call(env, ctx, "POST", "/api/tasks", { cookie, body });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("lists tasks by business-date view (today / overdue / unscheduled / completed / week)", async () => {
    const today = businessDate();
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);

    const tToday = await createTask({ title: "today", dueDate: today });
    const tOverdue = await createTask({ title: "overdue", dueDate: yesterday });
    const tUnsched = await createTask({ title: "unscheduled" });
    const tWeek = await createTask({ title: "week", dueDate: tomorrow });
    await createTask({ title: "done" });
    // complete the "done" task
    const { ctx } = makeCtx();
    await call(env, ctx, "POST", `/api/tasks/${tWeek.id}/complete`, { cookie });

    async function list(view?: string) {
      const c = makeCtx();
      const r = await call(env, c.ctx, "GET", "/api/tasks" + (view ? `?view=${view}` : ""), { cookie });
      expect(r.status).toBe(200);
      return (r.json.data.items as any[]).map((t) => t.title);
    }

    expect(await list("today")).toEqual(expect.arrayContaining(["today"]));
    expect(await list("overdue")).toEqual(expect.arrayContaining(["overdue"]));
    expect(await list("unscheduled")).toEqual(expect.arrayContaining(["unscheduled"]));
    const completed = await list("completed");
    expect(completed).toContain("week"); // completed task
    expect(completed).not.toContain("today");
    const week = await list("week");
    expect(week).toEqual(expect.arrayContaining(["today", "week"]));
    expect(week).not.toContain("overdue");
  });

  it("full lifecycle: get → patch → complete → rollover → soft-delete", async () => {
    const created = await createTask({ title: "lifecycle", priority: "low", dueDate: businessDate() });
    const id = created.id;

    // get
    const getR = await call(env, makeCtx().ctx, "GET", `/api/tasks/${id}`, { cookie });
    expect(getR.status).toBe(200);
    expect(getR.json.data.title).toBe("lifecycle");

    // patch
    const patchR = await call(env, makeCtx().ctx, "PATCH", `/api/tasks/${id}`, {
      cookie,
      body: { title: "lifecycle v2", priority: "high" },
    });
    expect(patchR.status).toBe(200);
    expect(patchR.json.data.title).toBe("lifecycle v2");
    expect(patchR.json.data.priority).toBe("high");

    // rollover (pending task) defers to next business day
    const rollR = await call(env, makeCtx().ctx, "POST", `/api/tasks/${id}/rollover`, { cookie });
    expect(rollR.status).toBe(200);
    expect(rollR.json.data.dueDate).toBe(addDays(businessDate(), 1));
    expect(rollR.json.data.rolloverCount).toBe(1);

    // complete
    const compR = await call(env, makeCtx().ctx, "POST", `/api/tasks/${id}/complete`, { cookie });
    expect(compR.status).toBe(200);
    expect(compR.json.data.status).toBe("completed");
    expect(compR.json.data.completedAt).toBeTruthy();

    // delete (soft)
    const delR = await call(env, makeCtx().ctx, "DELETE", `/api/tasks/${id}`, { cookie });
    expect(delR.status).toBe(200);
    const afterDel = await call(env, makeCtx().ctx, "GET", `/api/tasks/${id}`, { cookie });
    expect(afterDel.status).toBe(404);
  });

  it("rollover defers a pending task to the next business day and bumps rolloverCount", async () => {
    const created = await createTask({ title: "roll", dueDate: businessDate() });
    const r = await call(env, makeCtx().ctx, "POST", `/api/tasks/${created.id}/rollover`, { cookie });
    expect(r.status).toBe(200);
    expect(r.json.data.dueDate).toBe(addDays(businessDate(), 1));
    expect(r.json.data.rolloverCount).toBe(1);
  });

  it("isolates tasks between users (cross-account access returns 404)", async () => {
    const aTask = await createTask({ title: "alice-secret" });

    // second user
    const bob = await seedUser(db, "bob", "B0b#Str0ngPass");
    const bobCookie = (await loginAs(env, makeCtx().ctx, bob, "3.3.3.2")).cookie;

    const r = await call(env, makeCtx().ctx, "GET", `/api/tasks/${aTask.id}`, { cookie: bobCookie });
    expect(r.status).toBe(404);

    const listR = await call(env, makeCtx().ctx, "GET", "/api/tasks", { cookie: bobCookie });
    expect(listR.json.data.items).toHaveLength(0);
  });
});
