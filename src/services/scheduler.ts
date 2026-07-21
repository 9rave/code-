// 调度器：每分钟由 Cron Trigger 触发，扫描到期且启用的自定义推送任务并执行。
// 见 §推送任务系统。内置早/晚/周报仍走原 fixed cron（jobs/*），本调度器只处理 push_tasks 表。
import type { Env } from "../types";
import * as q from "../db/queries";
import * as pushSvc from "../services/push-service";
import * as taskSvc from "../services/task-service";
import { businessDate } from "../utils/time";
import { requestId } from "../utils/id";
import { log } from "../utils/logger";
import { nextRun } from "../utils/cron";
import { firstUser } from "../jobs/_util";
import { runDueReminders } from "../jobs/reminders";

function fallbackNext(now: Date): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

async function renderTaskContent(env: Env, userId: string, template: string): Promise<string> {
  const bd = businessDate();
  const stats = await q.getDayStats(env.DB, userId, bd);
  const today = await taskSvc.listTasks(env, userId, { view: "today" });
  const taskLines = today.items
    .slice(0, 15)
    .map((t, i) => `${i + 1}. ${t.priority === "high" ? "[高] " : ""}${t.title}`)
    .join("\n");
  const ctx: Record<string, string> = {
    date: bd,
    today_count: String(today.items.length),
    overdue_count: String(stats.overdue),
    high_count: String(stats.highPriority),
    pending_count: String(stats.pending),
    completed_count: String(stats.completed),
    tasks: taskLines,
  };
  return pushSvc.renderTemplate(template, ctx);
}

export async function runScheduler(env: Env): Promise<void> {
  const reqId = requestId();
  const user = await firstUser(env);
  if (!user) {
    log("warn", "scheduler_skip", { reason: "no_user" }, reqId);
    return;
  }
  // 先处理到点任务提醒（AlarmRobot 式轻量提醒），再跑自定义推送任务。
  try {
    await runDueReminders(env);
  } catch (e) {
    log("error", "reminder_sweep_failed", { error: String(e) }, reqId);
  }
  const now = new Date();
  const due = await q.listDuePushTasks(env.DB, now.toISOString());

  for (const task of due) {
    try {
      const content = await renderTaskContent(env, user.id, task.template);
      await pushSvc.sendPush(env, user.id, "custom", content, reqId, task.id);
      let next: string;
      try {
        next = nextRun(task.scheduleCron, now).toISOString();
      } catch {
        next = fallbackNext(now);
      }
      await q.markPushTaskRun(env.DB, task.id, "success", next);
      log("info", "scheduler_task_run", { taskId: task.id, name: task.name, next }, reqId);
    } catch (e) {
      let next: string;
      try {
        next = nextRun(task.scheduleCron, now).toISOString();
      } catch {
        next = fallbackNext(now);
      }
      await q.markPushTaskRun(env.DB, task.id, "failed", next);
      log("error", "scheduler_task_failed", { taskId: task.id, name: task.name, error: String(e) }, reqId);
    }
  }
}
