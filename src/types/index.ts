// 共享类型定义 —— 与开发指南 V1.1 的 API 契约、DDL 保持一致。

export type Priority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "completed" | "cancelled";
export type ReviewType = "morning" | "evening" | "weekly";
export type ReviewSource = "rule" | "ai";
export type PushType = "morning" | "evening" | "weekly" | "test";

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  priority: Priority;
  status: TaskStatus;
  due_date: string | null;
  estimated_duration_minutes: number | null;
  tags: string[];
  rollover_count: number;
  completed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyLog {
  log_date: string;
  mood: string | null;
  summary: string;
  blockers: string | null;
  updated_at: string;
}

export interface Review {
  review_date: string;
  review_type: ReviewType;
  content: string;
  source: ReviewSource;
  provider: string | null;
  model: string | null;
  regenerated_at: string | null;
  created_at: string;
}

export interface SessionUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
  sessionVersion: number;
}

// ---- AI 适配器相关 ----
export interface ReviewStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  highPriority: number;
}

export interface ReviewInput {
  tasks: Array<{
    title: string;
    priority: Priority;
    due_date: string | null;
    status: TaskStatus;
    estimated_duration_minutes: number | null;
  }>;
  stats: ReviewStats;
}

export interface GenerateOptions {
  timeoutMs: number;
  maxTokens: number;
}

export interface ModelResult {
  content: string;
  provider: string;
  model: string;
  usage?: Record<string, unknown>;
  latencyMs: number;
}

export interface ProviderHealth {
  ok: boolean;
  detail?: string;
}

export interface ModelAdapter {
  name: string;
  generateReview(input: ReviewInput, options: GenerateOptions): Promise<ModelResult>;
  healthCheck?(): Promise<ProviderHealth>;
}

// ---- 运行环境 ----
export interface Env {
  DB: D1Database;
  AI?: unknown; // Workers AI binding（可选）
  SESSION_SECRET: string;
  WECOM_WEBHOOK_URL: string;
  AI_ENABLED: string;
  AI_PROVIDER: string;
  AI_MODEL: string;
  BUSINESS_TIMEZONE: string;
  AI_TIMEOUT_MS: string;
  AI_MAX_OUTPUT_TOKENS: string;
  AI_DAILY_MANUAL_LIMIT: string;
  ASSETS?: { fetch: (req: Request) => Promise<Response> }; // 可选：静态前端（Workers Assets / Pages）
}
