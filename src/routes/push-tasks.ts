// 推送任务 + 机器人配置路由（见 §推送任务系统）
import type { Env, SessionPayload } from "../types";
import { json, ok, HttpError, STATUS } from "../utils/errors";
import { requestId } from "../utils/id";
import * as q from "../db/queries";
import { isValidCron, nextRun } from "../utils/cron";

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function listPushTasksRoute(_req: Request, env: Env, _user: SessionPayload): Promise<Response> {
  const items = await q.listPushTasks(env.DB);
  return json(ok({ items }));
}

export async function getPushTaskRoute(_req: Request, env: Env, _user: SessionPayload, id: string): Promise<Response> {
  const reqId = requestId();
  try {
    const t = await q.getPushTask(env.DB, id);
    if (!t) throw new HttpError(STATUS.NOT_FOUND, "NOT_FOUND", "任务不存在");
    return json(ok({ item: t }));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function createPushTaskRoute(req: Request, env: Env, _user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  try {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const scheduleCron = typeof body.scheduleCron === "string" ? body.scheduleCron.trim() : "";
    const template = typeof body.template === "string" ? body.template : "";
    const enabled = body.enabled === undefined ? true : !!body.enabled;

    if (!name) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "任务名称不能为空");
    if (!isValidCron(scheduleCron)) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "scheduleCron 不是合法的 5 字段 cron 表达式");

    let nextRunAt: string;
    try {
      nextRunAt = nextRun(scheduleCron, new Date()).toISOString();
    } catch {
      throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "该 cron 在未来 8 年内无匹配时间");
    }

    const created = await q.createPushTask(env.DB, { name, scheduleCron, template, enabled, nextRunAt });
    return json(ok({ item: created }), 201);
  } catch (e) {
    return err(e, reqId);
  }
}

export async function updatePushTaskRoute(req: Request, env: Env, _user: SessionPayload, id: string): Promise<Response> {
  const reqId = requestId();
  try {
    const existing = await q.getPushTask(env.DB, id);
    if (!existing) throw new HttpError(STATUS.NOT_FOUND, "NOT_FOUND", "任务不存在");
    const body = await readJson(req);
    const patch: { name?: string; scheduleCron?: string; template?: string; enabled?: boolean; nextRunAt?: string } = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "任务名称不能为空");
      patch.name = name;
    }
    if (body.enabled !== undefined) patch.enabled = !!body.enabled;
    if (body.template !== undefined) patch.template = String(body.template);
    if (body.scheduleCron !== undefined) {
      const cron = String(body.scheduleCron).trim();
      if (!isValidCron(cron)) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "scheduleCron 不是合法的 cron 表达式");
      patch.scheduleCron = cron;
      try {
        patch.nextRunAt = nextRun(cron, new Date()).toISOString();
      } catch {
        throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "该 cron 在未来 8 年内无匹配时间");
      }
    }

    const updated = await q.updatePushTask(env.DB, id, patch);
    return json(ok({ item: updated }));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function deletePushTaskRoute(_req: Request, env: Env, _user: SessionPayload, id: string): Promise<Response> {
  const reqId = requestId();
  try {
    const existing = await q.getPushTask(env.DB, id);
    if (!existing) throw new HttpError(STATUS.NOT_FOUND, "NOT_FOUND", "任务不存在");
    await q.deletePushTask(env.DB, id);
    return json(ok({ deleted: true }));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function getBotConfigRoute(_req: Request, env: Env, _user: SessionPayload): Promise<Response> {
  try {
    const webhookUrl = (await q.getBotConfig(env.DB, "webhook_url")) || env.NOTIFY_WEBHOOK_URL || "";
    const provider = (await q.getBotConfig(env.DB, "provider")) || (webhookUrl.includes("/bots/") ? "clawbot" : "");
    return json(
      ok({
        webhookUrl,
        provider,
        status: webhookUrl ? "configured" : "missing",
        managed: !!(await q.getBotConfig(env.DB, "webhook_url")),
      })
    );
  } catch (e) {
    return err(e, "bot-config-get");
  }
}

export async function setBotConfigRoute(req: Request, env: Env, _user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  try {
    const body = await readJson(req);
    const webhookUrl = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";
    if (!webhookUrl) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "webhookUrl 不能为空");
    await q.setBotConfig(env.DB, "webhook_url", webhookUrl);
    if (typeof body.provider === "string" && body.provider.trim()) {
      await q.setBotConfig(env.DB, "provider", body.provider.trim());
    }
    return json(ok({ saved: true }));
  } catch (e) {
    return err(e, reqId);
  }
}

function err(e: unknown, reqId: string): Response {
  const code = (e as HttpError).code || "INTERNAL_ERROR";
  const status = (e as HttpError).status || 500;
  return json({ ok: false, error: { code, message: (e as Error).message, requestId: reqId } }, status);
}
