// 设置路由（见开发指南 §6.5 / §10.3）
import type { Env, SessionPayload } from "../types";
import { json, ok, HttpError } from "../utils/errors";
import { requestId } from "../utils/id";
import { businessDate } from "../utils/time";
import { testPush } from "../services/push-service";
import * as q from "../db/queries";

export async function status(_req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  try {
    const aiEnabled = env.AI_ENABLED === "true";
    const bd = businessDate();

    const last = await env.DB
      .prepare("SELECT provider, model, degraded, latency_ms, created_at FROM ai_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(user.sub)
      .first();

    const manualCount = await q.countManualAiToday(env.DB, user.sub, bd);

    const data = {
      aiEnabled,
      aiProvider: env.AI_PROVIDER,
      aiModel: aiEnabled ? env.AI_MODEL : null,
      aiStatus: !aiEnabled ? "off" : aiEnabled ? "workers_ai" : "degraded",
      lastCall: last
        ? {
            outcome: (last as any).degraded ? "degraded" : "success",
            provider: (last as any).provider,
            at: (last as any).created_at,
          }
        : null,
      manualGenerationsToday: manualCount,
      wecom: env.WECOM_WEBHOOK_URL ? "configured" : "missing",
    };
    return json(ok(data));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function testPushRoute(_req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  try {
    await testPush(env, user.sub, reqId);
    return json(ok({ pushed: true }));
  } catch (e) {
    return err(e, reqId);
  }
}

function err(e: unknown, reqId: string): Response {
  const code = (e as HttpError).code || "INTERNAL_ERROR";
  const status = (e as HttpError).status || 500;
  return json({ ok: false, error: { code, message: (e as Error).message, requestId: reqId } }, status);
}
