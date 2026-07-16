#!/usr/bin/env bash
# 一键创建 AI Todo 助手 的 GitHub Issues（基于 V1.0 评审 + V1.1 优化后的待办项）
# 用法（在本机，已 `gh auth login`）：
#   REPO=owner/repo bash scripts/create-issues.sh
# 若仓库不存在对应 label，请先创建或删去各行的 --label 参数。
set -euo pipefail

REPO="${REPO:?请先设置 REPO=owner/repo（例如：REPO=hody/ai-todo-assistant）}"

echo "将在仓库 $REPO 创建 Issues ..."

gh issue create --repo "$REPO" --title "[AI] 部署前核实 Workers AI 模型 ID 并替换占位符" --label "area: ai" --body "$(cat <<'EOF'
wrangler.jsonc 中 `AI_MODEL` 仍为 `<deployment-verified-model-id>` 占位符。

- 在 Cloudflare 控制台/官方文档核实当前可用且免费的模型 ID 后替换。
- 在 README / 部署清单中记录核实日期（参考开发指南 §11.2 / 附录 C）。
- 相关代码：src/adapters/workers-ai.ts、src/services/review-service.ts。
EOF
)"

gh issue create --repo "$REPO" --title "[推送] 在企业微信真实群验证 Markdown 子集渲染" --label "area: push" --body "$(cat <<'EOF'
推送模板使用 `#` 标题、`**加粗**`、``>`` 引用。企业微信 Markdown 为受限子集，需在真实群验证：

- 标题层级、`**加粗**`、引用块的实际渲染。
- 超长消息压缩为重点摘要的落点（开发指南 §9.4）。

相关代码：src/services/push-service.ts（renderMorning/renderEvening/renderWeekly）。
EOF
)"

gh issue create --repo "$REPO" --title "[安全] 速率限制改为 KV/D1 跨实例实现" --label "area: security" --body "$(cat <<'EOF'
当前 `loginLimiter` 为单实例内存兜底（src/security/rate-limit.ts），Workers 多实例下计数不共享。

- 生产应改用 KV 或 D1 做跨请求计数。
- 覆盖：登录 IP 限流（§7.5）、AI 每日手动上限（§4.5）。
EOF
)"

gh issue create --repo "$REPO" --title "[AI] 持久化每日手动 AI 生成计数" --label "area: ai" --body "$(cat <<'EOF'
当前 `countManualAiToday` 用 `reviews.regenerated_at IS NOT NULL` 近似手动 AI 次数，存在边界误差。

- 建议增加独立计数（KV/D1），更准确执行 `AI_DAILY_MANUAL_LIMIT`。
- 相关：src/db/queries.ts、src/services/review-service.ts（§4.5）。
EOF
)"

gh issue create --repo "$REPO" --title "[前端] 完善移动端页面（今日/逾期/本周/已完成、详情、设置）" --label "area: frontend" --body "$(cat <<'EOF'
`public/` 仅为极简起步版（登录 + 今日列表 + 新建 + 完成）。

需补齐（开发指南 §10）：
- `/tasks/new`、`/tasks/:id`（编辑/完成/删除/顺延）
- `/review`（早报/晚报/周报、重新生成）
- `/settings`（AI 状态、推送测试、修改密码）
- 移动端交互：即时反馈、短时撤销、清楚显示“规则模式/AI 增强”。
EOF
)"

gh issue create --repo "$REPO" --title "[运维] 实现导出与备份脚本" --label "area: infra" --body "$(cat <<'EOF'
文档 §13.3 / §14.3 要求每周导出 tasks/daily_logs/reviews 为 JSON/CSV 并脱敏。

- 骨架未含导出脚本，需补充（D1 导出 + 对象存储/邮件）。
- 敏感字段按 §9.4 白名单脱敏。
EOF
)"

gh issue create --repo "$REPO" --title "[测试] 补充集成与安全测试" --label "area: testing" --body "$(cat <<'EOF'
现有测试仅单元（time/password/rule-based）。需补充（开发指南 §13）：
- 无 AI 全流程；Workers AI 成功/超时/429/5xx 降级
- Cron 重跑幂等（不重复复盘/推送）
- Webhook 5xx 重试；提示词注入不生效；日志无密钥泄露
EOF
)"

gh issue create --repo "$REPO" --title "[部署] 多环境（local/staging/prod）配置管理" --label "area: infra" --body "$(cat <<'EOF'
需明确 local/staging/prod 的 vars 与 secrets 差异（尤其 `AI_ENABLED`、`AI_MODEL`），并提供环境切换脚本/文档（开发指南 §12.1）。
EOF
)"

gh issue create --repo "$REPO" --title "[监控] 接入关键指标告警" --label "area: infra" --body "$(cat <<'EOF'
文档 §15.1 列出告警项：API 5xx、登录失败、Cron 未执行、推送失败、AI 降级率、AI 调用上限。需落到具体通道（邮件/企微/Webhook）。
EOF
)"

gh issue create --repo "$REPO" --title "[AI] MVP4 预留 Gemini/Groq/DeepSeek 适配器" --label "area: ai" --body "$(cat <<'EOF'
`ModelAdapter` 已抽象（src/adapters/）。需补充 Gemini/Groq/DeepSeek 适配器与配置切换，且不修改业务层（开发指南 §4.1 / §16）。
EOF
)"

gh issue create --repo "$REPO" --title "[质量] 增加文档—代码一致性巡检" --label "docs" --body "$(cat <<'EOF'
API 契约、DDL、错误码以开发指南（V1.1 优化版）为准。建议在 CI 中校验：
- wrangler 路由与文档 API 表一致
- D1 迁移字段与文档一致
- 错误码与 §6.2 一致
防止文档/代码漂移。
EOF
)"

gh issue create --repo "$REPO" --title "[安全] Seed 首账号的密码策略与密钥分发" --label "area: security" --body "$(cat <<'EOF'
首账号经 `scripts/seed.ts` 写入，初始密码经环境变量传入（开发指南 §7.1）。需明确：
- 强密码要求与生成方式
- 安全通道分发初始密码
- 首次强制改密的落库验证（must_change_password）
EOF
)"

echo "✅ 已创建 12 个 Issues。"
