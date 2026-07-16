// 任务服务（见开发指南 §6.4 / §8）
import type { Env, Task, Priority, TaskStatus } from "../types";
import * as q from "../db/queries";
import { HttpError, STATUS } from "../utils/errors";
import { businessDate, addDays } from "../utils/time";

const PRIORITIES: Priority[] = ["low", "medium", "high"];
const STATUSES: TaskStatus[] = ["pending", "completed", "cancelled"];

function validateCreate(body: any): q.CreateTaskInput {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > 200) {
    throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "标题长度需 1-200");
  }
  const priority = (body.priority as Priority) || "medium";
  if (!PRIORITIES.includes(priority)) {
    throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "优先级非法");
  }
  if (body.estimatedDurationMinutes !== undefined && body.estimatedDurationMinutes !== null) {
    const n = Number(body.estimatedDurationMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440) {
      throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "预计耗时需 1-1440 整数");
    }
  }
  if (body.dueDate !== undefined && body.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
    throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "dueDate 格式应为 YYYY-MM-DD");
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "description 需为字符串");
  }
  const tags = Array.isArray(body.tags) ? body.tags.filter((t: any) => typeof t === "string").slice(0, 20) : [];
  return {
    userId: "", // 由调用方填充
    title,
    description: body.description ?? null,
    priority,
    dueDate: body.dueDate ?? null,
    estimatedDurationMinutes: body.estimatedDurationMinutes ?? null,
    tags,
  };
}

export async function createTask(env: Env, userId: string, body: any): Promise<Task> {
  const input = validateCreate(body);
  input.userId = userId;
  return q.createTask(env.DB, input);
}

export async function listTasks(env: Env, userId: string, filter: q.ListTasksFilter) {
  return q.listTasks(env.DB, userId, { ...filter, businessDateStr: businessDate() });
}

export async function getTask(env: Env, id: string, userId: string): Promise<Task> {
  const t = await q.getTask(env.DB, id, userId);
  if (!t) throw new HttpError(STATUS.NOT_FOUND, "NOT_FOUND", "任务不存在");
  return t;
}

export async function updateTask(env: Env, id: string, userId: string, body: any): Promise<Task> {
  const patch: Partial<Task> = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (t.length < 1 || t.length > 200) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "标题长度需 1-200");
    patch.title = t;
  }
  if (body.description !== undefined) patch.description = body.description;
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "优先级非法");
    patch.priority = body.priority;
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "状态非法");
    patch.status = body.status;
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate))
      throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "dueDate 格式应为 YYYY-MM-DD");
    patch.dueDate = body.dueDate;
  }
  if (body.estimatedDurationMinutes !== undefined) {
    const n = Number(body.estimatedDurationMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "预计耗时需 1-1440 整数");
    patch.estimatedDurationMinutes = n;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) throw new HttpError(STATUS.VALIDATION_ERROR, "VALIDATION_ERROR", "tags 需为数组");
    patch.tags = body.tags.filter((t: any) => typeof t === "string").slice(0, 20);
  }
  const t = await q.updateTask(env.DB, id, userId, patch);
  if (!t) throw new HttpError(STATUS.NOT_FOUND, "NOT_FOUND", "任务不存在");
  return t;
}

export async function completeTask(env: Env, id: string, userId: string): Promise<Task> {
  const t = await q.completeTask(env.DB, id, userId);
  if (!t) throw new HttpError(STATUS.NOT_FOUND, "NOT_FOUND", "任务不存在");
  return t;
}

export async function rolloverTask(env: Env, id: string, userId: string): Promise<Task> {
  const nextDue = addDays(businessDate(), 1);
  const t = await q.rolloverTask(env.DB, id, userId, nextDue);
  if (!t) throw new HttpError(STATUS.NOT_FOUND, "NOT_FOUND", "任务不存在");
  return t;
}

export async function deleteTask(env: Env, id: string, userId: string): Promise<void> {
  const t = await q.getTask(env.DB, id, userId);
  if (!t) throw new HttpError(STATUS.NOT_FOUND, "NOT_FOUND", "任务不存在");
  await q.softDeleteTask(env.DB, id, userId);
}
