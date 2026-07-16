// 早报定时任务（工作日 08:30 北京 = 30 0 * * 1-5 UTC）
import type { Env } from "../types";
import * as taskSvc from "../services/task-service";
import * as pushSvc from "../services/push-service";
import { businessDate } from "../utils/time";
import { requestId } from "../utils/id";
import { log } from "../utils/logger";
import { firstUser } from "./_util";

export async function runMorning(env: Env): Promise<void> {
  const reqId = requestId();
  const bd = businessDate();
  const user = await firstUser(env);
  if (!user) {
    log("warn", "morning_skip", { reason: "no_user" }, reqId);
    return;
  }
  const today = await taskSvc.listTasks(env, user.id, { view: "today" });
  const overdue = await taskSvc.listTasks(env, user.id, { view: "overdue" });
  const content = pushSvc.renderMorning(bd, today.items, overdue.items);
  await pushSvc.sendPush(env, user.id, "morning", content, reqId);
  log("info", "morning_run", { date: bd, tasks: today.items.length, overdue: overdue.items.length }, reqId);
}
