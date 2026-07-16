# AI Todo 助手 · GitHub Issues 清单

> 来源：V1.0 评审 + V1.1 优化版文档中的待办项与部署前核验项。
> V1.1 已解决 V1.0 的全部 P0/P1（单用户决策、签名 Cookie 会话、Seed 首账号、完整 DDL、幂等约束、PBKDF2、businessDate、前端页面清单）。以下为仍需跟踪的后续项。

一键创建：`REPO=owner/repo bash scripts/create-issues.sh`（需本机 `gh auth login`）。

| # | 标题 | 标签 | 参考 |
|---|---|---|---|
| 1 | [AI] 部署前核实 Workers AI 模型 ID 并替换占位符 | area: ai | §11.2 / 附录 C |
| 2 | [推送] 在企业微信真实群验证 Markdown 子集渲染 | area: push | §9.4 |
| 3 | [安全] 速率限制改为 KV/D1 跨实例实现 | area: security | §7.5 |
| 4 | [AI] 持久化每日手动 AI 生成计数 | area: ai | §4.5 |
| 5 | [前端] 完善移动端页面 | area: frontend | §10 |
| 6 | [运维] 实现导出与备份脚本 | area: infra | §13.3 / §14.3 |
| 7 | [测试] 补充集成与安全测试 | area: testing | §13 |
| 8 | [部署] 多环境（local/staging/prod）配置管理 | area: infra | §12.1 |
| 9 | [监控] 接入关键指标告警 | area: infra | §15.1 |
| 10 | [AI] MVP4 预留 Gemini/Groq/DeepSeek 适配器 | area: ai | §4.1 / §16 |
| 11 | [质量] 增加文档—代码一致性巡检 | docs | 全局 |
| 12 | [安全] Seed 首账号的密码策略与密钥分发 | area: security | §7.1 |
