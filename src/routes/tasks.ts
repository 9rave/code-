// 任务路由（见开发指南 §6.4）
import type { Env, SessionPayload } from "../types";
import { json, ok, HttpError, STATUS } from "../utils/errors";
import { requestId } from "../utils/id";
import * as taskSvc from "../services/task-service";
import * as q from "../db/queries";
import { businessDate } from "../utils/time";
import { parseTaskText } from "../adapters/nl-parse";

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

// ---------- 自然语言解析预览（不改库，供 UI 实时展示「读懂了什么」） ----------
export async function parse(req: Request, _env: Env, _user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  try {
    const text = typeof body.text === "string" ? body.text : "";
    return json(ok(parseTaskText(text)));
  } catch (e) {
    return err(e, reqId);
  }
}

// ---------- 一句话建任务（AlarmRobot「一句家常话」理念） ----------
// 解析口语化描述 → 直接落库。识别到具体时间或周期时，自动开启「到点提醒」。
export async function quickAdd(req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  try {
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "请输入内容");
    const parsed = parseTaskText(text);
    if (!parsed.title || parsed.title === "提醒事项") {
      return json({ ok: false, error: { code: "PARSE_FAILED", message: "无法识别任务内容，请补充描述", parsed } }, 422);
    }
    const task = await taskSvc.createTask(env, user.sub, {
      title: parsed.title,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      recurrence: parsed.recurrence,
      tags: parsed.tags,
      // 说出了「时间/周期」即视为要提醒，自动开启到点推送
      remindMe: !!(parsed.dueTime || parsed.recurrence),
    });
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

// ---------- 统计（UI/UX 规范「统计」页 + Dashboard KPI） ----------
export async function statistics(_req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  try {
    const data = await q.getStatistics(env.DB, user.sub, businessDate());
    return json(ok(data));
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
