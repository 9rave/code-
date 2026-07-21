// D1 数据访问层（与 0001_init.sql 字段严格一致）
import type { D1Database } from "@cloudflare/workers-types";
import type { Task, DailyLog, Review, ReviewType, Priority, TaskStatus, PushType } from "../types";
import { uuid, nowIso } from "../utils/id";
import { businessDate } from "../utils/time";

type DB = D1Database;

function rowToTask(r: any): Task {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    dueDate: r.due_date,
    dueTime: r.due_time ?? null,
    recurrence: (r.recurrence as Task["recurrence"]) ?? null,
    remindMe: !!r.remind_me,
    remindedAt: r.reminded_at ?? null,
    estimatedDurationMinutes: r.estimated_duration_minutes,
    tags: r.tags_json ? JSON.parse(r.tags_json) : [],
    rolloverCount: r.rollover_count,
    completedAt: r.completed_at,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- 用户 ----------
export async function getUserByUsername(db: DB, username: string): Promise<any | null> {
  return db.prepare("SELECT * FROM users WHERE username = ? AND is_active = 1").bind(username).first();
}

export async function getUserById(db: DB, id: string): Promise<any | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

export async function createUser(
  db: DB,
  u: { username: string; passwordHash: string; passwordSalt: string; passwordParams: string }
): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await db
    .prepare(
      "INSERT INTO users (id, username, password_hash, password_salt, password_params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, u.username, u.passwordHash, u.passwordSalt, u.passwordParams, now, now)
    .run();
  return id;
}

export async function bumpSessionVersion(db: DB, userId: string): Promise<void> {
  await db
    .prepare("UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?")
    .bind(nowIso(), userId)
    .run();
}

export async function setPassword(db: DB, userId: string, hash: string, salt: string, params: string): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_params = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
    .bind(hash, salt, params, nowIso(), userId)
    .run();
}

// ---------- 任务 ----------
export interface CreateTaskInput {
  userId: string;
  title: string;
  description?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrence?: Task["recurrence"];
  remindMe?: boolean;
  estimatedDurationMinutes?: number | null;
  tags?: string[];
}

export async function createTask(db: DB, input: CreateTaskInput): Promise<Task> {
  const id = uuid();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO tasks (id, user_id, title, description, priority, status, due_date, due_time, recurrence, remind_me, estimated_duration_minutes, tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.userId,
      input.title,
      input.description ?? null,
      input.priority ?? "medium",
      input.dueDate ?? null,
      input.dueTime ?? null,
      input.recurrence ?? null,
      input.remindMe ? 1 : 0,
      input.estimatedDurationMinutes ?? null,
      JSON.stringify(input.tags ?? []),
      now,
      now
    )
    .run();
  return (await getTask(db, id, input.userId))!;
}

export async function getTask(db: DB, id: string, userId: string): Promise<Task | null> {
  const r = await db
    .prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(id, userId)
    .first();
  return r ? rowToTask(r) : null;
}

export interface ListTasksFilter {
  view?: "today" | "overdue" | "week" | "completed" | "unscheduled";
  status?: TaskStatus;
  priority?: Priority;
  cursor?: string | null;
  limit?: number;
  businessDateStr?: string;
}

export async function listTasks(db: DB, userId: string, f: ListTasksFilter): Promise<{ items: Task[]; nextCursor: string | null }> {
  const bd = f.businessDateStr ?? businessDate();
  const weekEnd = weekEndingSunday(bd);
  const conds: string[] = ["user_id = ?", "deleted_at IS NULL"];
  const args: any[] = [userId];
  if (f.status) {
    conds.push("status = ?");
    args.push(f.status);
  }
  if (f.priority) {
    conds.push("priority = ?");
    args.push(f.priority);
  }
  if (f.view === "today") {
    conds.push("status = 'pending'", "due_date = ?");
    args.push(bd);
  } else if (f.view === "overdue") {
    conds.push("status = 'pending'", "due_date < ?");
    args.push(bd);
  } else if (f.view === "completed") {
    conds.push("status = 'completed'");
  } else if (f.view === "unscheduled") {
    conds.push("status = 'pending'", "due_date IS NULL");
  } else if (f.view === "week") {
    conds.push("due_date >= ?", "due_date <= ?");
    args.push(bd, weekEnd);
  }
  const limit = Math.min(f.limit ?? 50, 100);
  conds.push("id > ?");
  args.push(f.cursor ?? "0");
  const sql = `SELECT * FROM tasks WHERE ${conds.join(" AND ")} ORDER BY due_date ASC, due_time ASC, created_at ASC LIMIT ?`;
  args.push(limit + 1);
  const rows = await db.prepare(sql).bind(...args).all();
  const all = (rows.results ?? []).map(rowToTask);
  let nextCursor: string | null = null;
  if (all.length > limit) {
    nextCursor = all[limit - 1].id;
    all.length = limit;
  }
  return { items: all, nextCursor };
}

export async function updateTask(db: DB, id: string, userId: string, patch: Partial<Task>): Promise<Task | null> {
  const sets: string[] = [];
  const args: any[] = [];
  if (patch.title !== undefined) { sets.push("title = ?"); args.push(patch.title); }
  if (patch.description !== undefined) { sets.push("description = ?"); args.push(patch.description); }
  if (patch.priority !== undefined) { sets.push("priority = ?"); args.push(patch.priority); }
  if (patch.status !== undefined) { sets.push("status = ?"); args.push(patch.status); }
  if (patch.dueDate !== undefined) { sets.push("due_date = ?"); args.push(patch.dueDate); }
  if ((patch as any).dueTime !== undefined) { sets.push("due_time = ?"); args.push((patch as any).dueTime); }
  if ((patch as any).recurrence !== undefined) { sets.push("recurrence = ?"); args.push((patch as any).recurrence); }
  if ((patch as any).remindMe !== undefined) {
    sets.push("remind_me = ?");
    args.push((patch as any).remindMe ? 1 : 0);
    // 开启提醒时重置幂等标记，确保能再次触发；关闭则清空。
    sets.push("reminded_at = ?");
    args.push((patch as any).remindMe ? null : null);
  }
  if (patch.estimatedDurationMinutes !== undefined) { sets.push("estimated_duration_minutes = ?"); args.push(patch.estimatedDurationMinutes); }
  if (patch.tags !== undefined) { sets.push("tags_json = ?"); args.push(JSON.stringify(patch.tags)); }
  if (sets.length === 0) return getTask(db, id, userId);
  sets.push("updated_at = ?");
  args.push(nowIso(), id, userId);
  await db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...args).run();
  return getTask(db, id, userId);
}

export async function completeTask(db: DB, id: string, userId: string): Promise<Task | null> {
  await db
    .prepare("UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(nowIso(), nowIso(), id, userId)
    .run();
  return getTask(db, id, userId);
}

export async function rolloverTask(db: DB, id: string, userId: string, nextDue: string): Promise<Task | null> {
  await db
    .prepare("UPDATE tasks SET due_date = ?, rollover_count = rollover_count + 1, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(nextDue, nowIso(), id, userId)
    .run();
  return getTask(db, id, userId);
}

export async function softDeleteTask(db: DB, id: string, userId: string): Promise<void> {
  await db
    .prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(nowIso(), nowIso(), id, userId)
    .run();
}

// ---------- 到点提醒扫描（每分钟 Cron 调用，见 jobs/reminders.ts） ----------
// 命中条件：
//   - 一次性（recurrence 空）：due_date = 今天 且 due_time = 当前分钟 且 未提醒过
//   - 每天：due_time = 当前分钟 且（未提醒 或 上次提醒早于今天）
//   - 每周：due_time = 当前分钟 且 今天星期 = due_date 星期 且 今天未提醒过
//   - 每月：due_time = 当前分钟 且 今天日期 = due_date 日期 且 今天未提醒过
export async function listDueReminders(
  db: DB,
  userId: string,
  date: string,
  time: string
): Promise<Task[]> {
  const timed = await db
    .prepare(
      `SELECT * FROM tasks
       WHERE user_id = ? AND status = 'pending' AND remind_me = 1 AND due_time = ?
         AND (
           ((recurrence IS NULL OR recurrence = '') AND due_date = ? AND reminded_at IS NULL)
           OR (recurrence = 'daily' AND (reminded_at IS NULL OR substr(reminded_at,1,10) < ?))
           OR (recurrence = 'weekly' AND (reminded_at IS NULL OR substr(reminded_at,1,10) < ?) AND strftime('%w', due_date) = strftime('%w', ?))
           OR (recurrence = 'monthly' AND (reminded_at IS NULL OR substr(reminded_at,1,10) < ?) AND CAST(strftime('%d', due_date) AS INT) = CAST(strftime('%d', ?) AS INT))
         )`
    )
    .bind(userId, time, date, date, date, date, date, date)
    .all();
  const hourly = await db
    .prepare(
      `SELECT * FROM tasks
       WHERE user_id = ? AND status = 'pending' AND remind_me = 1 AND recurrence = 'hourly'
         AND (reminded_at IS NULL OR reminded_at < ?)`
    )
    .bind(userId, new Date(Date.now() - 3600_000).toISOString())
    .all();
  return [...(timed.results ?? []), ...(hourly.results ?? [])].map(rowToTask);
}

export async function markReminded(db: DB, id: string, atIso: string): Promise<void> {
  await db.prepare("UPDATE tasks SET reminded_at = ? WHERE id = ?").bind(atIso, id).run();
}

// ---------- 每日日志 ----------
export async function upsertDailyLog(
  db: DB,
  userId: string,
  logDate: string,
  data: { mood?: string | null; summary?: string; blockers?: string | null }
): Promise<DailyLog> {
  const now = nowIso();
  const existing = await db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .bind(userId, logDate)
    .first();
  if (existing) {
    const mood = data.mood !== undefined ? data.mood : (existing as any).mood;
    const summary = data.summary !== undefined ? data.summary : (existing as any).summary;
    const blockers = data.blockers !== undefined ? data.blockers : (existing as any).blockers;
    await db
      .prepare("UPDATE daily_logs SET mood = ?, summary = ?, blockers = ?, updated_at = ? WHERE user_id = ? AND log_date = ?")
      .bind(mood, summary, blockers, now, userId, logDate)
      .run();
  } else {
    await db
      .prepare("INSERT INTO daily_logs (id, user_id, log_date, mood, summary, blockers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(uuid(), userId, logDate, data.mood ?? null, data.summary ?? "", data.blockers ?? null, now, now)
      .run();
  }
  const r = await db.prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?").bind(userId, logDate).first();
  return rowToDailyLog(r);
}

export async function getDailyLog(db: DB, userId: string, logDate: string): Promise<DailyLog | null> {
  const r = await db.prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?").bind(userId, logDate).first();
  return r ? rowToDailyLog(r) : null;
}

function rowToDailyLog(r: any): DailyLog {
  return { logDate: r.log_date, mood: r.mood, summary: r.summary, blockers: r.blockers, updatedAt: r.updated_at };
}

// ---------- 复盘（幂等 UPSERT） ----------
export async function upsertReview(
  db: DB,
  userId: string,
  reviewDate: string,
  reviewType: ReviewType,
  content: string,
  source: "rule" | "ai",
  provider: string | null,
  model: string | null,
  regenerated: boolean
): Promise<Review> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO reviews (id, user_id, review_date, review_type, content, source, provider, model, regenerated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, review_date, review_type) DO UPDATE SET
         content = excluded.content, source = excluded.source, provider = excluded.provider,
         model = excluded.model, regenerated_at = excluded.regenerated_at, updated_at = excluded.updated_at`
    )
    .bind(
      uuid(),
      userId,
      reviewDate,
      reviewType,
      content,
      source,
      provider,
      model,
      regenerated ? now : (source === "ai" ? null : null),
      now,
      now
    )
    .run();
  const r = await db
    .prepare("SELECT * FROM reviews WHERE user_id = ? AND review_date = ? AND review_type = ?")
    .bind(userId, reviewDate, reviewType)
    .first();
  return rowToReview(r);
}

export async function getReviews(
  db: DB,
  userId: string,
  type: ReviewType,
  from: string,
  to: string
): Promise<Review[]> {
  const rows = await db
    .prepare(
      "SELECT * FROM reviews WHERE user_id = ? AND review_type = ? AND review_date >= ? AND review_date <= ? ORDER BY review_date DESC"
    )
    .bind(userId, type, from, to)
    .all();
  return (rows.results ?? []).map(rowToReview);
}

function rowToReview(r: any): Review {
  return {
    reviewDate: r.review_date,
    reviewType: r.review_type,
    content: r.content,
    source: r.source,
    provider: r.provider,
    model: r.model,
    regeneratedAt: r.regenerated_at,
    createdAt: r.created_at,
  };
}

export async function countManualAiToday(db: DB, userId: string, date: string): Promise<number> {
  const r = await db
    .prepare(
      "SELECT COUNT(*) AS c FROM reviews WHERE user_id = ? AND review_date = ? AND source = 'ai' AND regenerated_at IS NOT NULL"
    )
    .bind(userId, date)
    .first();
  return (r?.c as number) ?? 0;
}

// ---------- 推送审计（幂等） ----------
export async function pushLogExists(db: DB, idempotencyKey: string): Promise<boolean> {
  const r = await db.prepare("SELECT 1 FROM push_logs WHERE idempotency_key = ?").bind(idempotencyKey).first();
  return !!r;
}

export async function insertPushLog(
  db: DB,
  userId: string,
  pushDate: string,
  pushType: PushType,
  idempotencyKey: string,
  status: "success" | "failed" | "skipped",
  httpStatus: number | null,
  responseBody: string | null,
  attemptCount: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_logs (id, user_id, push_date, push_type, idempotency_key, status, http_status, response_body, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(uuid(), userId, pushDate, pushType, idempotencyKey, status, httpStatus, responseBody, attemptCount, nowIso(), nowIso())
    .run();
}

// ---------- AI 用量 ----------
export async function recordAiUsage(
  db: DB,
  userId: string,
  reviewType: ReviewType,
  provider: string,
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  degraded: boolean
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_usage (id, user_id, review_type, provider, model, input_tokens, output_tokens, latency_ms, degraded, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(uuid(), userId, reviewType, provider, model, inputTokens, outputTokens, latencyMs, degraded ? 1 : 0, nowIso())
    .run();
}

// ---------- 统计（供规则/AI 复盘使用） ----------
export interface Statistics {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  highPriority: number;
  byStatus: { pending: number; completed: number };
  byPriority: { high: number; medium: number; low: number };
}

// UI/UX 规范「统计」页 + Dashboard KPI 用的聚合（只读，跨状态/优先级分组）
export async function getStatistics(db: DB, userId: string, bd: string): Promise<Statistics> {
  const rows = (await db
    .prepare(
      `SELECT status, priority, due_date, COUNT(*) AS c FROM tasks
       WHERE user_id = ? AND deleted_at IS NULL
       GROUP BY status, priority, due_date`
    )
    .bind(userId)
    .all()).results ?? [];
  let total = 0, completed = 0, pending = 0, overdue = 0, highPriority = 0;
  const byStatus = { pending: 0, completed: 0 };
  const byPriority = { high: 0, medium: 0, low: 0 };
  for (const r of rows as any[]) {
    const c = Number(r.c);
    total += c;
    byStatus[r.status as "pending" | "completed"] += c;
    if (r.status === "completed") completed += c;
    if (r.status === "pending") {
      pending += c;
      byPriority[r.priority as "high" | "medium" | "low"] += c;
      if (r.priority === "high") highPriority += c;
      if (r.due_date && r.due_date < bd) overdue += c;
    }
  }
  return { total, completed, pending, overdue, highPriority, byStatus, byPriority };
}

export async function getDayStats(db: DB, userId: string, bd: string): Promise<{ total: number; completed: number; pending: number; overdue: number; highPriority: number }> {
  const rows = await db
    .prepare(
      `SELECT status, due_date, priority,
              COUNT(*) AS c FROM tasks
       WHERE user_id = ? AND deleted_at IS NULL AND (status = 'completed' OR (status = 'pending'))
       GROUP BY status, due_date, priority`
    )
    .bind(userId)
    .all();
  let completed = 0, pending = 0, overdue = 0, highPriority = 0, total = 0;
  for (const r of (rows.results ?? []) as any[]) {
    total += r.c;
    if (r.status === "completed") completed += r.c;
    if (r.status === "pending") {
      pending += r.c;
      if (r.due_date < bd) overdue += r.c;
      if (r.priority === "high") highPriority += r.c;
    }
  }
  return { total, completed, pending, overdue, highPriority };
}

function weekEndingSunday(bd: string): string {
  const d = new Date(bd + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun
  const add = day === 0 ? 0 : 7 - day;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

// ---------- 速率限制（固定窗口，跨实例一致，见 ADR-001） ----------
export function evaluateWindow(
  prev: { count: number; resetAt: number } | null,
  nowMs: number,
  windowMs: number,
  max: number
): { count: number; resetAt: number; allowed: boolean; retryAfterMs: number } {
  const resetAt = nowMs + windowMs;
  if (!prev || prev.resetAt <= nowMs) {
    return { count: 1, resetAt, allowed: true, retryAfterMs: windowMs };
  }
  const count = prev.count + 1;
  return { count, resetAt: prev.resetAt, allowed: count <= max, retryAfterMs: Math.max(0, prev.resetAt - nowMs) };
}

export async function rateLimitHit(
  db: DB,
  key: string,
  windowMs: number,
  max: number,
  nowMs: number
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const prevRow = (await db
    .prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?")
    .bind(key)
    .first()) as { count: number; reset_at: number } | null;
  const prev = prevRow ? { count: prevRow.count, resetAt: prevRow.reset_at } : null;
  const ev = evaluateWindow(prev, nowMs, windowMs, max);
  await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = excluded.count,
         reset_at = excluded.reset_at`
    )
    .bind(key, ev.count, ev.resetAt)
    .run();
  return { allowed: ev.allowed, retryAfterMs: ev.retryAfterMs };
}

// ---------- 定时推送任务（推送任务系统） ----------
export interface PushTask {
  id: string;
  name: string;
  kind: "custom" | "morning" | "evening" | "weekly";
  scheduleCron: string;
  template: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

function rowToPushTask(r: any): PushTask {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    scheduleCron: r.schedule_cron,
    template: r.template,
    enabled: !!r.enabled,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    nextRunAt: r.next_run_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CreatePushTaskInput {
  name: string;
  scheduleCron: string;
  template?: string;
  kind?: "custom" | "morning" | "evening" | "weekly";
  enabled?: boolean;
  nextRunAt: string;
}

export async function createPushTask(db: DB, input: CreatePushTaskInput): Promise<PushTask> {
  const id = uuid();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO push_tasks (id, name, kind, schedule_cron, template, enabled, last_status, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'never', ?, ?, ?)`
    )
    .bind(
      id,
      input.name,
      input.kind ?? "custom",
      input.scheduleCron,
      input.template ?? "",
      input.enabled === false ? 0 : 1,
      input.nextRunAt,
      now,
      now
    )
    .run();
  return (await getPushTask(db, id))!;
}

export async function getPushTask(db: DB, id: string): Promise<PushTask | null> {
  const r = await db.prepare("SELECT * FROM push_tasks WHERE id = ?").bind(id).first();
  return r ? rowToPushTask(r) : null;
}

export async function listPushTasks(db: DB): Promise<PushTask[]> {
  const rows = await db
    .prepare("SELECT * FROM push_tasks ORDER BY created_at DESC")
    .all();
  return (rows.results ?? []).map(rowToPushTask);
}

export async function updatePushTask(
  db: DB,
  id: string,
  patch: { name?: string; scheduleCron?: string; template?: string; enabled?: boolean; nextRunAt?: string }
): Promise<PushTask | null> {
  const sets: string[] = [];
  const args: any[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); args.push(patch.name); }
  if (patch.scheduleCron !== undefined) { sets.push("schedule_cron = ?"); args.push(patch.scheduleCron); }
  if (patch.template !== undefined) { sets.push("template = ?"); args.push(patch.template); }
  if (patch.enabled !== undefined) { sets.push("enabled = ?"); args.push(patch.enabled ? 1 : 0); }
  if (patch.nextRunAt !== undefined) { sets.push("next_run_at = ?"); args.push(patch.nextRunAt); }
  if (sets.length === 0) return getPushTask(db, id);
  sets.push("updated_at = ?");
  args.push(nowIso(), id);
  await db.prepare(`UPDATE push_tasks SET ${sets.join(", ")} WHERE id = ?`).bind(...args).run();
  return getPushTask(db, id);
}

export async function deletePushTask(db: DB, id: string): Promise<void> {
  await db.prepare("DELETE FROM push_tasks WHERE id = ?").bind(id).run();
}

// 调度器扫描：启用且已到/过 next_run_at 的任务
export async function listDuePushTasks(db: DB, nowIsoStr: string): Promise<PushTask[]> {
  const rows = await db
    .prepare("SELECT * FROM push_tasks WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC")
    .bind(nowIsoStr)
    .all();
  return (rows.results ?? []).map(rowToPushTask);
}

export async function markPushTaskRun(
  db: DB,
  id: string,
  status: "success" | "failed" | "skipped",
  nextRunAt: string
): Promise<void> {
  await db
    .prepare("UPDATE push_tasks SET last_run_at = ?, last_status = ?, next_run_at = ?, updated_at = ? WHERE id = ?")
    .bind(nowIso(), status, nextRunAt, nowIso(), id)
    .run();
}

// ---------- 机器人配置（UI 托管，替代/补充 secret） ----------
export async function getBotConfig(db: DB, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM bot_config WHERE key = ?").bind(key).first();
  return r ? (r as any).value : null;
}

export async function setBotConfig(db: DB, key: string, value: string): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO bot_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, value, now)
    .run();
}
