-- 0002: 跨实例速率限制计数（见开发指南 §7.5 / ADR-001）
-- 取代单实例内存 Map：Workers 多实例下内存不共享，计数必须落库才能保证限流有效。
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL          -- 窗口结束的 epoch 毫秒
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
