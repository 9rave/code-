// 任务路由（见开发指南 §6.4）
import type { Env, SessionPayload } from "../types";
import { json, ok, HttpError } from "../utils/errors";
import { requestId } from "../utils/id";
import * as taskSvc from "../services/task-service";

export async function list(req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  const url = new URL(req.url);
  const filter = {
    view: (url.searchParams.get("view") as any) || undefined,
    status: (url.searchParams.get("status") as any) || undefined,
    priority: (url.searchParams.get("priority") as any) || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
  };
  try {
    const data = await taskSvc.listTasks(env, user.sub, filter);
    return json(ok(data));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function create(req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  const body = await req.json().catch(() => ({}));
  try {
    const task = await taskSvc.createTask(env, user.sub, body);
    return json(ok(task));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function get(_req: Request, env: Env, user: SessionPayload, id: string): Promise<Response> {
  const reqId = requestId();
  try {
    return json(ok(await taskSvc.getTask(env, id, user.sub)));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function patch(req: Request, env: Env, user: SessionPayload, id: string): Promise<Response> {
  const reqId = requestId();
  const body = await req.json().catch(() => ({}));
  try {
    return json(ok(await taskSvc.updateTask(env, id, user.sub, body)));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function complete(_req: Request, env: Env, user: SessionPayload, id: string): Promise<Response> {
  const reqId = requestId();
  try {
    return json(ok(await taskSvc.completeTask(env, id, user.sub)));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function rollover(_req: Request, env: Env, user: SessionPayload, id: string): Promise<Response> {
  const reqId = requestId();
  try {
    return json(ok(await taskSvc.rolloverTask(env, id, user.sub)));
  } catch (e) {
    return err(e, reqId);
  }
}

export async function remove(_req: Request, env: Env, user: SessionPayload, id: string): Promise<Response> {
  const reqId = requestId();
  try {
    await taskSvc.deleteTask(env, id, user.sub);
    return json(ok({}));
  } catch (e) {
    return err(e, reqId);
  }
}

function err(e: unknown, reqId: string): Response {
  const code = (e as HttpError).code || "INTERNAL_ERROR";
  const status = (e as HttpError).status || 500;
  return json({ ok: false, error: { code, message: (e as Error).message, requestId: reqId } }, status);
}
