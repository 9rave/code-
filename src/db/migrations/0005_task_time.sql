-- AI Todo 助手 · 迁移 0005：任务时间 / 周期 / 到点提醒
-- 设计：全部为「加列」式变更，向后兼容，不改动任何既有列与业务流。
-- 执行：npm run migrate（自动按文件名顺序应用，幂等）。

-- 具体提醒时间（24h，HH:MM）。配合 due_date 形成「某日某时」。
ALTER TABLE tasks ADD COLUMN due_time TEXT;

-- 周期提醒：daily / weekly / monthly / hourly（NULL = 一次性）。
ALTER TABLE tasks ADD COLUMN recurrence TEXT CHECK(recurrence IN ('daily','weekly','monthly','hourly'));

-- 是否开启「到点推送提醒」。默认 0（关闭），与既有任务行为一致。
ALTER TABLE tasks ADD COLUMN remind_me INTEGER NOT NULL DEFAULT 0;

-- 上次提醒时间（幂等用）。NULL = 尚未提醒过。
ALTER TABLE tasks ADD COLUMN reminded_at TEXT;

-- 支撑「每分钟扫描到点任务」的查询。
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks(user_id, status, due_date, due_time, remind_me);
