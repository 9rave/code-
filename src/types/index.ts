// 共享类型定义 —— 与开发指南 V1.1 的 API 契约、DDL 保持一致。

export type Priority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "completed" | "cancelled";
export type ReviewType = "morning" | "evening" | "weekly";
export type ReviewSource = "rule" | "ai";
export type PushType = "morning" | "evening" | "weekly" | "test" | "custom";

// 内部 Task 与对外契约一致，使用 camelCase；queries 层负责与 D1 的 snake_case 列互转。
export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  priority: Priority;
  status: TaskStatus;
  dueDate: string | null;
  estimatedDurationMinutes: number | null;
  tags: string[];
  rolloverCount: number;
  completedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyLog {
  logDate: string;
  mood: string | null;
  summary: string;
  blockers: string | null;
  updatedAt: string;
}

export interface Review {
  reviewDate: string;
  reviewType: ReviewType;
  content: string;
  source: ReviewSource;
  provider: string | null;
  model: string | null;
  regeneratedAt: string | null;
  createdAt: string;
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

// 会话载荷（与 security/session.ts 保持一致，便于路由直接从 types 引入）
export type { SessionPayload } from "../security/session";

// ---- 运行环境 ----
export interface Env {
  DB: D1Database;
  AI?: unknown; // Workers AI binding（可选）
  SESSION_SECRET: string;
  NOTIFY_WEBHOOK_URL: string;
  AI_ENABLED: string;
  AI_PROVIDER: string;
  AI_MODEL: string;
  // MVP4 适配器密钥（敏感，请用 `wrangler secret put` 注入，勿写入 vars / 仓库）
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  BUSINESS_TIMEZONE: string;
  AI_TIMEOUT_MS: string;
  AI_MAX_OUTPUT_TOKENS: string;
  AI_DAILY_MANUAL_LIMIT: string;
  ASSETS?: { fetch: (req: Request) => Promise<Response> }; // 可选：静态前端（Workers Assets / Pages）
}
