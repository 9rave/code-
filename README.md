# AI Todo 助手（V1.1 · 免费 AI 版）

个人待办管理 + **免费微信推送（ClawBot 桥接 / ntfy 等通用 Webhook）** + 规则引擎复盘（可选 Workers AI 免费增强）+ **定时推送任务系统**。
**设计铁律：未配置任何 AI 时，系统仍完整可用。**

完整设计规范见 [`../AI_Todo_Assistant_开发指南_V1.1_优化版.md`](../AI_Todo_Assistant_开发指南_V1.1_优化版.md)。

## 技术栈
Cloudflare Workers · D1 (SQLite) · Cron Triggers · Workers AI（可选）· 通道无关推送 Webhook（ntfy / PushPlus / Server酱 / 自托管 ClawBot 桥）· 静态前端（public/）。

## 快速开始
```bash
npm install
cp .dev.vars.example .dev.vars   # 填入 SESSION_SECRET / NOTIFY_WEBHOOK_URL（ntfy 等通用推送 webhook）

# 1. 建库
wrangler d1 create ai-todo
#   把输出的 database_id 填进 wrangler.jsonc 的 d1_databases.database_id

# 2. 迁移（幂等，按序执行 0001 / 0002 / 0003 / 0004）
npm run migrate            # 等价于对 src/db/migrations/*.sql 顺序执行 wrangler d1 execute
#   上线到生产库：npm run migrate -- --remote

# 3. Seed 首个管理员（环境变量注入密码，须 ≥12 位且含 3 类字符）
INITIAL_ADMIN_USERNAME=admin INITIAL_ADMIN_PASSWORD='你的强密码' npm run seed
#   上线到生产库：INITIAL_ADMIN_USERNAME=admin INITIAL_ADMIN_PASSWORD='...' npm run seed -- --remote

# 4. 本地开发
npm run dev

# 5. 自测（类型检查 + 单元/集成测试，共 93 用例 / 15 文件）
npm run typecheck
npm test                                   # 单元 + 集成（vitest run，全量）
npm run test -- tests/integration          # 仅集成测试：Miniflare + 真实 D1

# 6. 上线（多环境）
npm run deploy                     # 默认环境
npm run deploy:staging             # --env staging（可启用 AI_ENABLED=true）
npm run deploy:production          # --env production

# 7. 备份（导出各表为 JSON/CSV 到 exports/<时间戳>/）
npm run export
```

## 核心能力
- **任务管理**：CRUD、今日/逾期/未完成/已完成视图、拖拽改状态、标签/优先级/搜索。
- **复盘（规则引擎）**：早报/晚报/周报 + 每日日志，可选 Workers AI 免费增强（默认关闭、可降级）。
- **推送与定时任务**：通道无关 Webhook（ntfy / PushPlus / Server酱 / 自托管 ClawBot 微信桥）；`push_tasks` 表支持自定义 cron、内容模板、启用开关；每分钟调度器扫描到期任务并推送；幂等（同日同类型仅一次）+ 重试（2xx 成功 / 4xx 不重试 / 5xx 重试≤3）+ `push_logs` 记录。
- **机器人通道配置**：设置页可视化配置 `webhook_url` / `provider`（UI 优先于环境变量），无需改代码即可切换推送通道。
- **安全**：首账号强密码策略 + 首次登录强制改密、登录限流（D1 固定窗口 429+Retry-After）、HttpOnly 签名 Cookie、输出脱敏。

## 目录
```
src/
  index.ts            # 路由 + scheduled() 入口（含 push-tasks / bot-config 路由）
  routes/             # HTTP 层：参数校验、错误封装
  services/           # 业务逻辑（task / review / push / scheduler）
  adapters/           # ModelAdapter：规则 / Workers AI
  jobs/               # 早报/晚报/周报定时任务
  db/                 # queries + migrations(0001~0004) + seed
  security/           # session / password / sanitize / rate-limit
  utils/              # time / errors / id / logger
  types/              # 共享类型
public/               # 静态前端（设计系统 + 看板/日历/统计/复盘/详情 Drawer + 移动端）
tests/                # 单元测试 + 集成测试（tests/integration：Miniflare + 真实 D1）
```

## 环境变量（wrangler.jsonc → vars）
`AI_ENABLED`(默认 false) · `BUSINESS_TIMEZONE`(Asia/Shanghai) · `AI_TIMEOUT_MS`(10000) · `AI_MAX_OUTPUT_TOKENS`(400) · `AI_DAILY_MANUAL_LIMIT`(5)

> ⚠️ **启用 AI 前必须核实模型 ID**：`AI_MODEL` 默认为 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`，但 Cloudflare 模型目录会更新。启用 `AI_ENABLED=true` 前，请在 Cloudflare 控制台确认该模型 ID 当前可用（见开发指南附录 C）。AI 默认关闭，关闭时占位符不会触发任何调用。

## 安全要点
- **首账号密码策略**：`validatePasswordPolicy` 强制 ≥12 位且含大小写/数字/符号中至少 3 类；Seed 与改密均生效。初始密码经 `INITIAL_ADMIN_PASSWORD` 注入，**首次登录强制改密**，请通过安全通道（口令管理器/当面）告知，不入库、不进 Git、不写聊天记录。
- **登录限流**：已落地为 D1 固定窗口（10 次/15 分钟/IP），跨实例一致；超限返回 429 并带 `Retry-After`。

## Secrets（不在仓库）
`SESSION_SECRET` · `NOTIFY_WEBHOOK_URL`（通用推送 Webhook：ntfy / PushPlus / Server酱 / 自托管 ClawBot 桥；不配置则推送静默跳过；界面「机器人通道配置」可覆盖此值）

## 仓库与协作
- **目标远程仓库**：已确认 `https://github.com/9rave/code-` 为 `9rave` 名下的公开仓库（默认分支 `main`）。本地仓库当前尚未配置 remote；首次推送可执行 `git remote add origin https://github.com/9rave/code-.git && git push -u origin develop`。
- **分支策略**：轻量 Git Flow —— `main`（生产/受保护）↔ `develop`（集成）↔ `feature/*`（开发）↔ `hotfix/*`（紧急修复）。详见 [`docs/BRANCHING.md`](docs/BRANCHING.md)。
- **贡献流程**：从 `develop` 切 `feature` 分支 → 自测 → PR 回 `develop`（需 CI 通过 + Review）。见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
- **CI**：`.github/workflows/ci.yml` 在 PR/推送 `main`、`develop` 时自动跑 `npm run typecheck` 与 `npm test`。
- **提交规范**：Conventional Commits（`feat`/`fix`/`docs`/`refactor`/`test`/`chore`）。
- **Node 版本**：见 `.nvmrc`（当前 22），团队统一用 `nvm use`。

## 目录（协作约定）
- 改动 API 契约 / DDL / 错误码时，须同步更新 `../AI_Todo_Assistant_开发指南_V1.1_优化版.md`，保持文档—代码一致（见 Issue #11）。
- 密钥、Webhook 等敏感信息只走 `wrangler secret`，禁止入库。
