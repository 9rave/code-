# 阶段四 · 自测与质量门禁报告

> 运行环境：本地 Node 22 + `npm install` 后 `tsc --noEmit` 与 `vitest run`。

## 1. 类型检查
- 命令：`npm run typecheck`（`tsc --noEmit`）
- 范围：`src/`（Worker 代码；`scripts/`、`tests/` 走 `tsx`/`vitest`，不进 Worker 的 tsc）
- 结果：**通过（0 错误）**

### 自测过程中修复的关键问题（原本被沙箱阻断的 tsc 掩盖）
1. **camelCase / snake_case 契约不一致（系统性）**：内部 `Task`/`DailyLog`/`Review` 类型原为 DB 的 snake_case（如 `due_date`），但 API 契约（文档 §6.4/§6.5）与服务层使用 camelCase（如 `dueDate`）。`tsc` 报大量 `Property 'dueDate' does not exist on type 'Partial<Task>'`。
   - 决策：内部类型统一改为 camelCase（以对外契约为准），`queries.ts` 作为 snake↔camel 边界。
2. `id.ts` 缺 `nowIso` 导出 → 补导出。
3. `SessionPayload` 未从 `types` 导出 → `types/index.ts` 再导出。
4. `index.ts` 缺失 `./jobs` 模块入口 → 新增 `src/jobs/index.ts`。
5. `rule.generateReview(input, opts)` 参数过多 → 改为 `rule.generateReview(input)`。
6. 路由 `body` 为 `unknown` → 显式 `as Record<string, any>`。
7. `getDayStats` 行类型 unknown → `as any[]` 转换。
8. 测试文件尾部笔误 `n` → 删除。

## 2. 单元测试
- 命令：`npm test`（`vitest run`）
- 结果：**9 文件 / 56 用例全部通过**

| 文件 | 覆盖 |
|---|---|
| tests/time.test.ts | `businessDate()` 跨日/时区 |
| tests/password.test.ts | PBKDF2 哈希与验证 |
| tests/rule-based.test.ts | 规则引擎确定性输出 |
| tests/rate-limit.test.ts | 固定窗口限流数学（新增，ADR-001） |
| tests/sanitize.test.ts | 推送文本护栏（sanitizeNotifyText）+ 白名单 + 敏感词脱敏（新增，ADR-005） |
| tests/password-policy.test.ts | 密码策略 ≥12 位/3 类（新增，ADR-004） |
| tests/cron.test.ts | 三个复盘 Cron 表达式解析与分发 |
| tests/push-payload.test.ts | 通道无关推送 payload 构建（ntfy / PushPlus / Server酱 / ClawBot 格式分支） |
| tests/adapters-mvp4.test.ts | MVP4 备用适配器（Gemini / Groq / DeepSeek）工厂选择与降级回退 |

## 2.1 集成测试（新增）
- 命令：`npm run test -- tests/integration`
- 机制：**Miniflare + 真实 D1（workerd SQLite）**，直接驱动 Worker 的 `fetch`/`scheduled` 处理器，无数据库 Mock。每个用例重置 schema（DROP + 重放迁移）保证隔离。`vitest.config.ts` 关闭文件并行（`fileParallelism:false`）并放宽超时以容纳 workerd 启动与推送重试。
- 结果：**6 文件 / 37 用例全部通过**（全量 `npm test` 共 **93 用例 / 15 文件**通过）。

| 文件 | 覆盖的业务流（正常 + 异常） |
|---|---|
| tests/integration/auth.test.ts | 登录成功/失败、登录限流 429+Retry-After、未登录 401、改密（成功/错密码/弱密码）、**改密后旧会话失效**、登出清 Cookie |
| tests/integration/tasks.test.ts | 任务 CRUD、camelCase 契约落库、校验拒绝（空标题/非法优先级/非法日期/超范围时长）、按业务日期视图（today/overdue/unscheduled/completed/week）、跨用户隔离 |
| tests/integration/reviews.test.ts | 规则复盘生成与落库、启用 AI 时走 Workers AI 并记 ai_usage、AI 异常回退规则引擎（degraded）、手动 AI 日限额拦截、每日日志 upsert/get、日期范围列举与非法日期拒绝 |
| tests/integration/push.test.ts | 测试推送成功写 push_logs、幂等（同日同类型仅一次 webhook）、HTTP 500 重试 3 次后记失败、业务错误（errcode≠0）不重试、未配置 Webhook 静默跳过 |
| tests/integration/cron.test.ts | 三个复盘 Cron 表达式正确分发到 morning/evening/weekly 任务，验证「任务→复盘→推送」协作；无用户时优雅跳过；未知 Cron 空跑 |
| tests/integration/scheduler.test.ts | 每分钟 `runScheduler`（`* * * * *`）扫描到期 `push_tasks` 并执行自定义推送；过期任务不重发；UI 通道配置覆盖环境变量 |

- 集成测试中发现并修复的两个问题：
  1. **会话失效未生效（安全）**：`verifySession` 未校验 `session_version`，`bumpSessionVersion` 改密后旧 Token 仍可用。`requireUser` 现比对库中 `session_version`，旧会话立即失效。
  2. **推送重试计数偏差**：`sendPush` 在 3 次失败后 `attempt_count` 记为 4。已改为记录真实发起次数（成功/业务拒绝=本次，连续失败=3）。

## 3. 质量门禁（CI）
`.github/workflows/ci.yml` 在 PR 与 push 到 `main`/`develop` 时自动 `typecheck` + `test`，守住"文档—代码一致"与"密钥不入库"。

## 4. 待补（非阻塞）
- [x] 集成测试：Miniflare + 真实 D1 验证登录/Cron/推送/调度器（本轮已补全，37 集成用例 / 全量 93 用例）。
- [ ] 安全测试：Cookie 标志端到端、提示词注入端到端（单测已覆盖白名单与脱敏）。
- [ ] 真群推送文本渲染核验（部署后人工验证，#2 运行期项）。
