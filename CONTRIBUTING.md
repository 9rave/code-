# 贡献指南（Contributing）

欢迎参与 AI Todo 助手开发。请先阅读 [分支策略](docs/BRANCHING.md)。

## 环境准备
```bash
nvm use                # 使用 .nvmrc 指定的 Node 版本
npm install
cp .dev.vars.example .dev.vars
```

## 开发流程
1. 从 `develop` 切出 `feature/<slug>` 分支。
2. 遵循目录结构（`src/` 各模块职责见 README 与开发指南）。
3. 保持与开发指南的 API 契约、DDL、错误码一致。
4. 自测：`npm run typecheck && npm test`。
5. 提交信息使用 Conventional Commits。
6. 推送并发起 PR 到 `develop`，填写 PR 模板。

## 代码规范
- TypeScript strict 模式，禁止 `any` 滥用（类型已在 `src/types`）。
- 密钥只存 `wrangler secret` 或 `.dev.vars`（已被 git 忽略），**严禁入库**。
- 日志不得记录 password / Cookie / SESSION_SECRET / Webhook。

## PR 要求
- 关联 Issue（如 `Closes #12`）。
- CI（typecheck + test）必须通过。
- 至少 1 人 Review 后 squash 合入。

## 密钥与配置
- 环境变量在 `wrangler.jsonc` 的 `vars`（非敏感）。
- 敏感信息（`SESSION_SECRET` / `WECOM_WEBHOOK_URL`）走 Secrets，不进仓库。
