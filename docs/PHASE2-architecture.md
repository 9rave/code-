# 阶段二 · 架构设计与关键决策（ADR）

> 每个决策记录：背景、选项、选择、理由、影响。所有决策以"未配置 AI 系统仍完整可用"为铁律。

## ADR-001 · 速率限制改为 D1 固定窗口计数
- **背景**：当前 `src/security/rate-limit.ts` 用进程内 `Map`，Workers 多实例下计数不共享 → 登录暴力防护在生产失效。
- **选项**：(a) Cloudflare Rate Limit Binding；(b) KV 原子计数器；(c) D1 固定窗口表。
- **选择**：**(c) D1**。理由：已依赖 D1，零新增绑定；登录限流与 AI 计数同库，运维简单；KV 最终一致可能在窗口边界多放行几次，D1 强一致更稳。新增 `rate_limits(key,count,reset_at)` 表 + `0002` 迁移。
- **实现要点**：`INSERT OR IGNORE` + `UPDATE ... CASE WHEN reset_at<=? THEN 1 ELSE count+1` 原子窗口；返回 `allowed` 与 `retryAfterMs`；`Retry-After` 头写入 429。
- **影响**：登录路由改为 `await`；`HttpError` 增加 `retryAfter` 字段。

## ADR-002 · Workers AI 默认模型 ID 与验证闸门
- **背景**：`AI_MODEL` 为占位符，部署即报错风险。
- **选择**：默认 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`（Cloudflare 公开模型）。**但 AI 默认关闭**（`AI_ENABLED=false`），占位符不会触发调用。部署启用前须在 Cloudflare 控制台核实当前可用模型 ID（附录 C）。
- **影响**：`wrangler.jsonc` 写入真实默认；README 增加"启用 AI 前必须核实模型 ID"提示。

## ADR-003 · 导出/备份脚本
- **背景**：验收清单要求"导出和备份流程验证"。
- **选择**：`scripts/export.ts` 调用 `wrangler d1 execute <db> --command="SELECT ..." --json`，将每张表导出为 `exports/<ts>/<table>.json` + 一份合并 CSV。纯运维脚本，走 `tsx`，不进 Worker 构建。
- **理由**：无需引入额外依赖；复用 wrangler 凭证；可 cron 化做备份。

## ADR-004 · Seed 首账号密码策略
- **背景**：Seed 无任何强度校验，易设弱密码。
- **选择**：`validatePasswordPolicy(pw)`（≥12 位 + 含大小写/数字/符号中至少 3 类），在 `changePassword` 与 `seed.ts` 强制。初始密码经 `INITIAL_ADMIN_PASSWORD` 环境变量注入，**首次登录强制改密**。
- **密钥分发**：README 明确"通过安全通道（口令管理器/当面）告知，不落库、不进 Git、不写聊天记录"。

## ADR-005 · 企微 Markdown 子集校验 + 真实来源标签
- **背景**：`renderMorning` 把"生成模式"写死为 `规则引擎 / AI 增强`；企微 Markdown 为受限子集，未做校验。
- **选择**：新增 `sanitizeWeComMarkdown()`（剥离 `<>` HTML、控制字符、未支持语法），渲染函数接收 `source: 'rule'|'ai'` 显示真实模式。早报恒为 `rule`（早报 job 不调用 AI）；晚报/周报显示实际 `review.source`。
- **理由**：状态准确 + 防止注入/渲染异常；保持降级语义（AI 失败不覆盖已有复盘）。

## ADR-006 · 多环境配置（wrangler `env`）
- **背景**：local/staging/prod 共用一份 vars，易误开 AI 或混用 DB。
- **选择**：`wrangler.jsonc` 增加 `env.staging` / `env.production`，各自独立 `vars`（staging 可 `AI_ENABLED=true`）与 `d1_databases`（占位 id）。部署命令改为 `wrangler deploy --env staging`。
- **理由**：不新增 CI 复杂度；与现有 `.github/workflows/ci.yml` 兼容（CI 仍只跑 typecheck+test）。

## ADR-007 · 前端增强（主题 + 复盘面板）
- **背景**：文档 §10 要求显示"规则/AI 增强"并支持移动端优先；当前前端无主题切换、无复盘视图。
- **选择**：补充 light/dark/system 主题切换（玻璃拟态风格），新增复盘面板（展示早/晚/周报、手动重新生成、显示降级提示）与每日日志入口。沿用 Cookie 会话，不引入框架。
- **理由**：对齐"premium"标准与文档状态展示要求；保持零构建依赖。

## 模块边界确认（不变）
路由层 → 服务层 → 适配器/DB；`ModelAdapter` 接口保持不变（#10 仅扩展实现）。所有写接口经鉴权中间件。
