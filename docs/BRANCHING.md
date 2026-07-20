# 分支策略（Branching Strategy）

> 目标：结构清晰、便于团队协作与后续维护。采用轻量 Git Flow。

## 分支模型

| 分支 | 用途 | 来源 | 合入目标 | 保护 |
|---|---|---|---|---|
| `main` | 生产就绪代码，每次合入即一个可发布版本 | — | — | ✅ 受保护，禁止直接 push |
| `develop` | 集成分支，日常开发基线 | `main` | — | ✅ 受保护，仅 PR 合入 |
| `feature/<slug>` | 功能 / 修复开发 | `develop` | `develop` | 否 |
| `release/<version>` | 发布准备（冻结功能、只修 bug） | `develop` | `main` + `develop` | 否 |
| `hotfix/<slug>` | 生产紧急修复 | `main` | `main` + `develop` | 否 |

> 个人/小团队可简化为：`main` + `develop` + `feature/*`，跳过 `release/*`。

## 命名规范
- 功能分支：`feature/login-cookie-session`、`feature/notify-push-retry`
- 修复分支：`fix/d1-idempotency`、`hotfix/push-timeout`
- 建议带上 Issue 编号：`feature/12-workers-ai-model-id`

## 工作流
1. 从 `develop` 切出 `feature/<slug>`。
2. 本地开发 + 自测（`npm run typecheck && npm test`）。
3. 推送分支并发起 **PR 到 `develop`**。
4. CI 通过 + 至少 1 人 Review 后合入（建议 squash merge 保持线性）。
5. 发布时从 `develop` 切 `release/<version>` → 合入 `main` → 打 tag `vX.Y.Z` → 部署。

## 提交信息（Conventional Commits）
```
feat: 新增推送重试（2xx 成功 / 4xx 不重试 / 5xx 重试≤3）
fix: 修正复盘幂等约束
docs: 补充分支策略文档
refactor: 抽离路由守卫
test: 补充 PBKDF2 单测
chore: 升级 wrangler 至 3.70
```
类型：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`。

## 分支保护建议（仓库 Settings）
- `main` / `develop`：禁止直接 push；要求 PR + CI 通过 + 至少 1 个审批。
- 合并方式：squash（保持历史清爽）。

详见 [`CONTRIBUTING.md`](../CONTRIBUTING.md) 与 [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md)。
