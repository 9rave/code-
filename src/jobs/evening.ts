// 晚报定时任务（每天 18:30 北京 = 30 10 * * * UTC）
import type { Env } from "../types";
import * as reviewSvc from "../services/review-service";
import * as pushSvc from "../services/push-service";
import { businessDate } from "../utils/time";
import { requestId } from "../utils/id";
import { log } from "../utils/logger";
import { firstUser } from "./_util";

export async function runEvening(env: Env): Promise<void> {
  const reqId = requestId();
  const bd = businessDate();
  const user = await firstUser(env);
  if (!user) return;
  const { degraded, review } = await reviewSvc.generateReview(env, user.id, "evening", false, reqId);
  const content = pushSvc.renderEvening(bd, review.content);
  await pushSvc.sendPush(env, user.id, "evening", content, reqId);
  log("info", "evening_run", { date: bd, source: review.source, degraded }, reqId);
}
