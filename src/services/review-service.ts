// 复盘服务（见开发指南 §4 / §6.5 / §8.4）
import type { Env, ReviewType, Review } from "../types";
import * as q from "../db/queries";
import { buildReviewInput } from "../security/sanitize";
import { generateWithFallback } from "../adapters/model-adapter";
import { businessDate } from "../utils/time";
import { HttpError, STATUS } from "../utils/errors";
import { log } from "../utils/logger";

export interface GenerateResult {
  review: Review;
  degraded: boolean;
  reason?: string;
}

export async function generateReview(
  env: Env,
  userId: string,
  type: ReviewType,
  manual: boolean,
  reqId: string
): Promise<GenerateResult> {
  const bd = businessDate();
  const { items } = await q.listTasks(env.DB, userId, { view: "week", businessDateStr: bd });
  const stats = await q.getDayStats(env.DB, userId, bd);
  const input = buildReviewInput(items, stats);

  const opts = {
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 10000,
    maxTokens: Number(env.AI_MAX_OUTPUT_TOKENS) || 400,
  };

  const { result, degraded, reason } = await generateWithFallback(env, input, opts);

  const isAi = result.provider !== "rule";
  const review = await q.upsertReview(
    env.DB,
    userId,
    bd,
    type,
    result.content,
    isAi ? "ai" : "rule",
    isAi ? result.provider : null,
    isAi ? result.model : null,
    manual
  );

  if (env.AI_ENABLED === "true" && isAi) {
    await q.recordAiUsage(env.DB, userId, type, result.provider, result.model, 0, 0, result.latencyMs, false);
  } else if (env.AI_ENABLED === "true" && degraded) {
    await q.recordAiUsage(env.DB, userId, type, env.AI_PROVIDER, null, 0, 0, result.latencyMs, true);
  }

  if (degraded) {
    log("warn", "review_generated", { reviewType: type, source: "rule", fallback: true, reason, latencyMs: result.latencyMs }, reqId);
  } else {
    log("info", "review_generated", { reviewType: type, source: isAi ? "ai" : "rule", latencyMs: result.latencyMs }, reqId);
  }

  return { review, degraded, reason };
}

export async function enforceManualLimit(env: Env, userId: string): Promise<void> {
  const limit = Number(env.AI_DAILY_MANUAL_LIMIT) || 5;
  const count = await q.countManualAiToday(env.DB, userId, businessDate());
  if (count >= limit) {
    throw new HttpError(STATUS.RATE_LIMITED, "RATE_LIMITED", `今日手动 AI 生成已达上限（${limit}）`);
  }
}

export async function getReviews(env: Env, userId: string, type: ReviewType, from: string, to: string): Promise<Review[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "日期范围格式应为 YYYY-MM-DD");
  }
  return q.getReviews(env.DB, userId, type, from, to);
}

export async function getDailyLog(env: Env, userId: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "date 格式应为 YYYY-MM-DD");
  }
  return q.getDailyLog(env.DB, userId, date);
}

export async function upsertDailyLog(env: Env, userId: string, date: string, body: any) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "date 格式应为 YYYY-MM-DD");
  }
  return q.upsertDailyLog(env.DB, userId, date, {
    mood: typeof body.mood === "string" ? body.mood.slice(0, 20) : undefined,
    summary: typeof body.summary === "string" ? body.summary.slice(0, 4000) : undefined,
    blockers: typeof body.blockers === "string" ? body.blockers.slice(0, 2000) : undefined,
  });
}
