-- AI Todo 助手 · D1 初始化迁移（与开发指南 V1.1 §5.2 一致）
-- 执行：wrangler d1 execute ai-todo --file=./src/db/migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_params TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','cancelled')),
  due_date TEXT,
  estimated_duration_minutes INTEGER,
  tags_json TEXT,
  rollover_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due ON tasks(user_id, status, due_date);

CREATE TABLE IF NOT EXISTS daily_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  log_date TEXT NOT NULL,
  mood TEXT,
  summary TEXT,
  blockers TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, log_date),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  review_date TEXT NOT NULL,
  review_type TEXT NOT NULL CHECK(review_type IN ('morning','evening','weekly')),
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('rule','ai')),
  provider TEXT,
  model TEXT,
  regenerated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, review_date, review_type),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS push_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  push_date TEXT NOT NULL,
  push_type TEXT NOT NULL CHECK(push_type IN ('morning','evening','weekly','test')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('success','failed','skipped')),
  http_status INTEGER,
  response_body TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_push_user_date ON push_logs(user_id, push_date, push_type);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  review_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  degraded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage(user_id, created_at);
