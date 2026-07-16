// 周报定时任务（周五 18:45 北京 = 45 10 * * 5 UTC）
import type { Env } from "../types";
import * as reviewSvc from "../services/review-service";
import * as pushSvc from "../services/push-service";
import { businessDate } from "../utils/time";
import { requestId } from "../utils/id";
import { log } from "../utils/logger";
import { firstUser } from "./_util";

export async function runWeekly(env: Env): Promise<void> {
  const reqId = requestId();
  const bd = businessDate();
  const user = await firstUser(env);
  if (!user) return;
  const { degraded, review } = await reviewSvc.generateReview(env, user.id, "weekly", false, reqId);
  const content = pushSvc.renderWeekly(bd, review.content, review.source);
  await pushSvc.sendPush(env, user.id, "weekly", content, reqId);
  log("info", "weekly_run", { date: bd, source: review.source, degraded }, reqId);
}
