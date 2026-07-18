# AI Todo 助手 · 部署 Runbook

> 目的：把「代码完成但未上线」的项目变成可运行的生产实例。
> 适用范围：`ai-todo-assistant`（Cloudflare Workers + D1 + Cron Triggers + Workers Assets + 可选 Workers AI）。
> 配套文档：`README.md` · `docs/MONITORING.md` · `docs/BRANCHING.md` · `docs/github-issues.md`。

---

## 0. 关键事实（部署前必读）

| 项 | 说明 |
|---|---|
| Worker 名称 | `ai-todo-assistant`（顶层 `name`） |
| 入口 | `src/index.ts` |
| D1 绑定 | `DB`；默认/生产库名 `ai-todo`，staging 库名 `ai-todo-staging` |
| AI 绑定 | `AI`（Workers AI，可选） |
| 静态资源 | `assets.directory = public`，绑定名 `ASSETS`，由 `src/index.ts:69` 在未命中 API 路由时回退托管 |
| Cron | `30 0 * * 1-5`（工作日早报）、`30 10 * * *`（晚报）、`45 10 * * 5`（周报），时区跟随 `BUSINESS_TIMEZONE=Asia/Shanghai` |
| Secrets | `SESSION_SECRET`、`WECOM_WEBHOOK_URL`（启用第三方 AI 时加 `GEMINI_API_KEY`/`GROQ_API_KEY`/`DEEPSEEK_API_KEY`） |
| 分支策略 | `main` 受保护，必须经 PR + CI；发布从 `develop` 走 PR 合入 `main` |

> ⚠️ **staging / production 共用同一 Worker 名称**：当前 `wrangler.jsonc` 的 `env.staging` / `env.production` 未覆盖 `name`，因此 `wrangler deploy --env staging` 与 `--env production` 会**部署到同一个脚本 `ai-todo-assistant`**，互相覆盖。
> - 若需真正隔离的 staging，请在 `env.staging` 下加 `"name": "ai-todo-assistant-staging"`。
> - 首次上线建议直接部署到生产（`--env production`），跳过 staging 或用独立名称的 staging。

---

## 1. 部署前置检查清单（Pre-deploy Checklist）

### 1.1 代码与质量
- [ ] `npm ci` 已安装依赖（项目 `node_modules/.bin/wrangler` 存在）
- [ ] `npm run typecheck` 零错误（`tsc --noEmit`）
- [ ] `npm test` 全绿（单元 27 + 集成 32 = 59；若含 MVP4 适配器则 77，含 PBKDF2 上限断言）
- [ ] `npm run dev` 本地冒烟：能登录、能建任务、能触发 test-push

### 1.2 Cloudflare 账号与凭据
- [ ] 拥有目标 Cloudflare 账号，且 `wrangler whoami` 能返回账号信息
- [ ] 凭据权限至少包含：**Account > Workers Scripts > Edit**、**Account > D1 > Edit**、（启用 AI 时）**Account > Workers AI > Read**
  - 推荐用 `CLOUDFLARE_API_TOKEN` 环境变量（ Scope：自定义令牌，勾选上述权限 + `Account > Account Settings > Read`）
  - 或本地 `wrangler login`（OAuth 浏览器授权）

### 1.3 配置文件
- [ ] `wrangler.jsonc` 三处 `database_id` 占位符已替换为真实 D1 id（顶层 `:24`、staging `:53`、production `:70`）
- [ ] `assets` 绑定已存在（`directory: public`, `binding: ASSETS`）—— 见本次提交
- [ ] `compatibility_date` 为较新值（当前 `2026-07-01`），与目标运行时兼容

### 1.4 数据库与种子
- [ ] 真实 D1 已创建（见 §2.2），`database_id` 已回填
- [ ] 迁移已对真实库执行（`npm run migrate`），`0001_*` / `0002_*` 两张表 + 幂等约束就位
- [ ] 首管理员已 Seed（`INITIAL_ADMIN_USERNAME` + 强密码），且已知密码走安全通道分发

### 1.5 密钥与第三方
- [ ] `SESSION_SECRET` 已 `wrangler secret put`（≥32 位高熵随机串，如 `openssl rand -base64 48`）
- [ ] `WECOM_WEBHOOK_URL` 已 `wrangler secret put`（企微群机器人 Webhook）
- [ ] 若启用 AI：已在 Cloudflare 控制台核实 `AI_MODEL` 当前可用；第三方 Provider 的 key 已 secret put
- [ ] `AI_ENABLED` 决策明确：默认 `false`（纯规则，零成本）；staging 可 `true`

### 1.6 监控（可选但建议同步做）
- [ ] 按 `docs/MONITORING.md` 在 Cloudflare 面板配平台告警（P1–P5）
- [ ] 本地可跑 `npm run healthcheck`（需 `wrangler` 可用 + 真实库）

---

## 2. 部署步骤（Deployment Steps）

### 2.1 鉴权
```bash
# 方式 A：令牌（CI / 沙箱推荐）
export CLOUDFLARE_API_TOKEN="<你的 CF API Token>"

# 方式 B：本地 OAuth
npx wrangler login

# 校验
npx wrangler whoami
```

### 2.2 创建 D1（仅首次）
```bash
# 生产库
npx wrangler d1 create ai-todo
#   输出形如：database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
#   把它填进 wrangler.jsonc 顶层 :24 与 env.production :70

# staging 库（若用独立 staging）
npx wrangler d1 create ai-todo-staging --env staging
#   填进 env.staging :53
```

### 2.3 迁移（对真实 D1）
```bash
# 默认/生产库
npm run migrate

# 若 migrate 脚本未读 env，可手动逐文件：
npx wrangler d1 execute ai-todo --file=src/db/migrations/0001_schema.sql
npx wrangler d1 execute ai-todo --file=src/db/migrations/0002_rate_limits.sql

# staging（如用独立库）
npx wrangler d1 execute ai-todo-staging --env staging --file=src/db/migrations/0001_schema.sql
npx wrangler d1 execute ai-todo-staging --env staging --file=src/db/migrations/0002_rate_limits.sql
```

### 2.4 Seed 首管理员
```bash
INITIAL_ADMIN_USERNAME=admin \
INITIAL_ADMIN_PASSWORD='替换为≥12位且含3类字符的强密码' \
npm run seed
```
> 密码经 `validatePasswordPolicy` 校验；首次登录会被强制改密。请通过口令管理器/当面告知，不入库、不进 Git、不写聊天记录。

### 2.5 注入 Secrets
```bash
npx wrangler secret put SESSION_SECRET
# 粘贴：openssl rand -base64 48 的输出

npx wrangler secret put WECOM_WEBHOOK_URL
# 粘贴企微群机器人 Webhook 完整 URL

# 仅在启用第三方 AI 时：
# npx wrangler secret put GEMINI_API_KEY
# npx wrangler secret put GROQ_API_KEY
# npx wrangler secret put DEEPSEEK_API_KEY
```
> Secrets 不进仓库；`.dev.vars` 仅本地 `wrangler dev` 用，已被 `.gitignore` 忽略。

### 2.6 部署
```bash
# 先到生产（推荐首次直接上生产）
npx wrangler deploy --env production

# 或等价地（需顶层 :24 也已回填真实 id）：
# npx wrangler deploy

# 若已为 staging 设独立 name，可先验证：
# npx wrangler deploy --env staging
```

### 2.7 上线验证（Smoke Test）
1. 打开 Worker URL（Cloudflare 面板 → Workers & Pages → ai-todo-assistant → 触发器/URL）。
2. 用 Seed 的账号登录，触发强制改密。
3. 创建一个任务，标记完成，确认 API 正常。
4. 在「设置」页点 **test-push**，确认企微群收到 Markdown 消息。
5. 访问 `/`（根路径），确认移动端页面（`public/index.html` + `/app.js`）正常加载——验证 `assets` 绑定生效。
6. 确认 Cron Triggers 已在面板注册（3 条），下次触发时间合理（Asia/Shanghai）。
7. 跑一次 `npm run healthcheck` 确认无异常。

### 2.8 代码入库
```bash
git add wrangler.jsonc   # 已含真实 D1 id；secrets 不入库
git commit -m "deploy: 补全 assets 绑定 + D1 id，上线准备"
# 走 PR 合入 main（main 受保护）
```

---

## 3. 回滚方案（Rollback Plan）

### 3.1 代码/Worker 回滚（首选，秒级）
```bash
# 回退到上一部署版本
npx wrangler rollback --env production

# 或回退到指定版本
npx wrangler rollback <version-id> --env production
```
> `wrangler rollback` 仅回退 Worker 代码与配置，**不影响 D1 数据**。

### 3.2 数据库回滚
- D1 **不支持自动回滚**。策略：
  - 迁移保持**幂等、非破坏性**（本项目 `0001/0002` 已是 `CREATE TABLE IF NOT EXISTS` + 唯一约束）。
  - 破坏性变更前，先 `npm run export` 全量备份到 `exports/<时间戳>/`。
  - 若需反向，手动编写补偿 SQL 经 `npx wrangler d1 execute` 执行，或从备份恢复。
- 紧急数据保护：先 `npm run export` 再操作。

### 3.3 Secrets 误改
```bash
npx wrangler secret delete SESSION_SECRET --env production
npx wrangler secret put SESSION_SECRET --env production
```

### 3.4 紧急熔断
- 在 Cloudflare 面板暂停 Worker（或把路由切到维护页）。
- 误删 D1：从最近 `exports/` 备份恢复；D1 有 24h 内时间点恢复（面板 → D1 → 备份）。

---

## 4. 异常处理流程（Exception Handling）

| 现象 | 可能原因 | 排查 / 处置 |
|---|---|---|
| `wrangler whoami` 报错 / 部署 401 | 未鉴权或 Token 权限不足 | 检查 `CLOUDFLARE_API_TOKEN`；确认含 Workers Scripts:Edit + D1:Edit；重试 `wrangler whoami` |
| 部署报 D1 binding / `database_id` 无效 | 占位符未替换或 id 错 | 回填真实 id（§2.2）；`wrangler d1 list` 核对 id |
| 前端根路径 404 / 白屏 | `assets` 绑定缺失或 `public/` 缺 `index.html` | 确认 `wrangler.jsonc` 有 `assets` 块；`public/index.html` 存在；重新 `wrangler deploy` |
| `/app.js` 等静态资源 404 | 资源路径不匹配 | 确认前端用相对/绝对根路径；`assets.directory=public` 已配 |
| `npm run migrate` 失败 | SQL 语法 / 迁移非幂等 | 本地 `wrangler d1 execute --local` 复现；检查 `0001/0002` 幂等 |
| 登录接口 500（日志 `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported`） | `src/security/password.ts` 的 PBKDF2 迭代次数 > 100000（Cloudflare Workers Web Crypto 上限） | 把 `ITERATIONS` 降到 ≤ 100000；并重设管理员密码（verifyPassword 用全局常量重新哈希，旧哈希不匹配）；`tests/password.test.ts` 已加断言守护 |
| 登录接口 500（无上述 Pbkdf2 报错） | `SESSION_SECRET` 缺失 | `wrangler secret list` 确认已注入；本地 `.dev.vars` 复现 |
| 推送失败 / 企微无消息 | `WECOM_WEBHOOK_URL` 错或群机器人被踢 | 查 `push_logs`；跑 `settings/test-push`；healthcheck 业务告警 B1 |
| Cron 没按时触发 | `triggers.crons` 未注册或时区错 | 面板 Cron Triggers 页确认 3 条；核对 `BUSINESS_TIMEZONE` |
| AI 调用失败 / 自动降级 | 模型 ID 失效或 key 缺失 | 查 `ai_usage`；healthcheck B3/B4；控制台核实 `AI_MODEL` 可用性 |
| 迁移后数据异常 | 破坏性变更 | 用 `exports/` 备份恢复；补补偿 SQL |
| `wrangler deploy` 覆盖 staging | staging/prod 同名（见 §0） | 给 `env.staging` 设独立 `name`；或只用 `--env production` |

---

## 5. 发布节奏建议

- **日常修复（hotfix）**：从 `main` 切 `hotfix/*` → 修 → PR 回 `main` + 合并 `develop`。
- **新功能**：`develop` 切 `feature/*` → 自测 → PR 回 `develop`（CI + Review）。
- **上线**：`develop` → PR → `main`；`main` 合入后 `wrangler deploy --env production`。
- **变更 DB schema**：先在 staging/本地验证迁移幂等，再上生产；提前 `npm run export` 备份。
