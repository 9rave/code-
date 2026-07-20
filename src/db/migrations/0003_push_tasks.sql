-- 0003: 定时推送任务 + 机器人配置（见推送任务系统 §推送）
-- 幂等：所有语句带 IF NOT EXISTS / 条件判断，可重复执行。

CREATE TABLE IF NOT EXISTS push_tasks (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'custom',   -- custom | morning | evening | weekly
  schedule_cron TEXT NOT NULL,                     -- 5 字段标准 cron 表达式
  template      TEXT NOT NULL DEFAULT '',          -- 内容模板，支持 {{date}} / {{tasks}} 等占位符
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   TEXT,
  last_status   TEXT,                              -- success | failed | skipped | never
  next_run_at   TEXT NOT NULL,                     -- ISO 时间，调度器据此判断到期
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_tasks_due ON push_tasks(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS bot_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
