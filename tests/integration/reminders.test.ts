import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../src/types";
import {
  getDb,
  disposeMf,
  resetSchema,
  makeEnv,
  seedUser,
  createWebhookMock,
  installWebhook,
  restoreWebhook,
  type SeedUser,
} from "./harness";
import { businessDate } from "../../src/utils/time";
import * as q from "../../src/db/queries";
import { runDueReminders } from "../../src/jobs/reminders";

// 与 src/jobs/reminders.ts 的 shanghaiTime 保持一致
function shanghaiTime(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

describe("reminder sweep (到点提醒) integration", () => {
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

  async function makeDueTask(opts: { recurrence?: any; remindMe?: boolean; dueTime?: string }) {
    const now = new Date();
    const date = businessDate(now);
    const time = opts.dueTime ?? shanghaiTime(now);
    return q.createTask(db, {
      userId: user.id,
      title: "到点提醒 integration",
      dueDate: date,
      dueTime: time,
      recurrence: opts.recurrence ?? null,
      remindMe: opts.remindMe ?? true,
    });
  }

  it("fires a one-shot timed reminder, pushes, and marks reminded_at", async () => {
    const t = await makeDueTask({});
    expect(t.remindedAt).toBeNull();

    await runDueReminders(env);

    expect(webhook.calls).toHaveLength(1);
    expect(webhook.calls[0].message).toContain("到点提醒 integration");

    const row = (await db.prepare("SELECT reminded_at FROM tasks WHERE id=?").bind(t.id).first()) as any;
    expect(row.reminded_at).not.toBeNull();

    // 同一次扫描内再次运行：已提醒过 → 不重复推送（幂等）
    webhook.calls.length = 0;
    await runDueReminders(env);
    expect(webhook.calls).toHaveLength(0);
  });

  it("daily recurrence pushes once per day (same-day re-run is a no-op)", async () => {
    const t = await makeDueTask({ recurrence: "daily" });

    await runDueReminders(env);
    expect(webhook.calls).toHaveLength(1);

    webhook.calls.length = 0;
    await runDueReminders(env); // 同一天再次扫描
    expect(webhook.calls).toHaveLength(0);

    const row = (await db.prepare("SELECT reminded_at FROM tasks WHERE id=?").bind(t.id).first()) as any;
    expect(row.reminded_at).not.toBeNull();
  });

  it("does NOT fire when remind_me is off", async () => {
    await makeDueTask({ remindMe: false });
    await runDueReminders(env);
    expect(webhook.calls).toHaveLength(0);
  });

  it("does NOT fire when the time does not match", async () => {
    // 故意设一个错开的时间（当前时间 +12 小时，模 24）
    const now = new Date();
    const wrong = shanghaiTime(new Date(now.getTime() + 12 * 3600_000));
    await makeDueTask({ dueTime: wrong });
    await runDueReminders(env);
    expect(webhook.calls).toHaveLength(0);
  });
});
