-- 0004: 扩展 push_logs.push_type 校验，新增 'custom'
-- push_tasks 自定义定时推送使用 type='custom'，原 CHECK 约束未包含，导致写入被拒绝。
-- SQLite 不支持 ALTER TABLE DROP CONSTRAINT，故采用「新建表 → 拷贝数据 → 改名」模式重建。
-- 该模式对全新库与已应用 0001 的现有库均安全（幂等）。

CREATE TABLE IF NOT EXISTS push_logs_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  push_date TEXT NOT NULL,
  push_type TEXT NOT NULL CHECK(push_type IN ('morning','evening','weekly','test','custom')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('success','failed','skipped')),
  http_status INTEGER,
  response_body TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

INSERT INTO push_logs_new (
  id, user_id, push_date, push_type, idempotency_key, status,
  http_status, response_body, attempt_count, created_at, updated_at
)
SELECT
  id, user_id, push_date, push_type, idempotency_key, status,
  http_status, response_body, attempt_count, created_at, updated_at
FROM push_logs;

DROP TABLE push_logs;
ALTER TABLE push_logs_new RENAME TO push_logs;

CREATE INDEX IF NOT EXISTS idx_push_user_date ON push_logs(user_id, push_date, push_type);
