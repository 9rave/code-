// 到点提醒扫描（每分钟由 Cron Trigger 触发，见 index.ts 的 "* * * * *"）。
// 参考 AlarmRobot 的「轻量提醒」：任务到设定的时间，主动推送一条提醒，
// 基于微信/ntfy 等已配置的通道，无需用户打开 App。
import type { Env, Recurrence } from "../types";
import * as q from "../db/queries";
import * as pushSvc from "../services/push-service";
import { businessDate } from "../utils/time";
import { requestId } from "../utils/id";
import { log } from "../utils/logger";
import { firstUser } from "./_util";

function shanghaiTime(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now); // => HH:MM
}

const REC_LABEL: Record<Recurrence, string> = {
  daily: "（每天）",
  weekly: "（每周）",
  monthly: "（每月）",
  hourly: "（每小时）",
};

export async function runDueReminders(env: Env): Promise<void> {
  const reqId = requestId();
  const user = await firstUser(env);
  if (!user) return;

  const now = new Date();
  const date = businessDate(now);
  const time = shanghaiTime(now);

  const due = await q.listDueReminders(env.DB, user.id, date, time);
  if (!due.length) return;

  for (const t of due) {
    try {
      const rec = t.recurrence ? REC_LABEL[t.recurrence] : "";
      const when = [t.dueDate, t.dueTime].filter(Boolean).join(" ");
      const content = `⏰ 提醒：${t.title}${rec}\n${when || ""}`.trim();
      // hourly 用完整时间戳做幂等键（每小时间隔）；其余用「日期」做幂等键（每天一次）
      const scope = t.recurrence === "hourly" ? `reminder:${t.id}:${now.toISOString()}` : `reminder:${t.id}:${date}`;
      await pushSvc.sendPush(env, user.id, "custom", content, reqId, scope);
      await q.markReminded(env.DB, t.id, now.toISOString());
      log("info", "reminder_sent", { taskId: t.id, title: t.title, when }, reqId);
    } catch (e) {
      log("error", "reminder_failed", { taskId: t.id, error: String(e) }, reqId);
    }
  }
}
