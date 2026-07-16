// 日志 / 复盘路由（见开发指南 §6.5）
import type { Env, SessionPayload, ReviewType } from "../types";
import { json, ok, HttpError } from "../utils/errors";
import { requestId } from "../utils/id";
import * as reviewSvc from "../services/review-service";
import { businessDate, addDays } from "../utils/time";

export async function getDailyLog(req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || businessDate();
  try {
    return json(ok(await reviewSvc.getDailyLog(env, user.sub, date)));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function upsertDailyLog(req: Request, env: Env, user: SessionPayload, date: string): Promise<Response> {
  const reqId = requestId();
  const body = await req.json().catch(() => ({}));
  try {
    return json(ok(await reviewSvc.upsertDailyLog(env, user.sub, date, body)));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function list(req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  const url = new URL(req.url);
  const type = (url.searchParams.get("type") as ReviewType) || "evening";
  const to = url.searchParams.get("to") || businessDate();
  const from = url.searchParams.get("from") || addDays(to, -7);
  try {
    return json(ok(await reviewSvc.getReviews(env, user.sub, type, from, to)));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function generate(req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  const body = await req.json().catch(() => ({}));
  const type = (body.type as ReviewType) || "evening";
  try {
    await reviewSvc.enforceManualLimit(env, user.sub); // 仅手动生成受限
    const { review, degraded, reason } = await reviewSvc.generateReview(env, user.sub, type, true, reqId);
    return json(ok(review, degraded ? { degraded: true, reason } : undefined));
  } catch (e) {
    // AI 降级不视为错误：若后续有 AI_UNAVAILABLE 语义，可在此返回 200 + meta
    return err(e, reqId);
  }
}

function err(e: unknown, reqId: string): Response {
  const code = (e as HttpError).code || "INTERNAL_ERROR";
  const status = (e as HttpError).status || 500;
  return json({ ok: false, error: { code, message: (e as Error).message, requestId: reqId } }, status);
}
