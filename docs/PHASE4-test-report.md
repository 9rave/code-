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
- 结果：**6 文件 / 27 用例全部通过**

| 文件 | 覆盖 |
|---|---|
| tests/time.test.ts | `businessDate()` 跨日/时区 |
| tests/password.test.ts | PBKDF2 哈希与验证 |
| tests/rule-based.test.ts | 规则引擎确定性输出 |
| tests/rate-limit.test.ts | 固定窗口限流数学（新增，ADR-001） |
| tests/sanitize.test.ts | 企微 Markdown 护栏 + 白名单 + 敏感词脱敏（新增，ADR-005） |
| tests/password-policy.test.ts | 密码策略 ≥12 位/3 类（新增，ADR-004） |

## 3. 质量门禁（CI）
`.github/workflows/ci.yml` 在 PR 与 push 到 `main`/`develop` 时自动 `typecheck` + `test`，守住"文档—代码一致"与"密钥不入库"。

## 4. 待补（非阻塞）
- [ ] 集成测试：用 Miniflare + 真实 D1 本地实例验证登录/Cron/推送（需活动 Worker，本轮以单测覆盖核心纯逻辑）。
- [ ] 安全测试：Cookie 标志、登录限流端到端、提示词注入（单测已覆盖白名单与脱敏，端到端待补）。
- [ ] 真群企微 Markdown 渲染核验（部署后人工验证，#2 运行期项）。
