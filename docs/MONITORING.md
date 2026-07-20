# 监控与告警（Issue #9）

> 范围：本服务为 Cloudflare Workers + D1 单用户部署，**无独立后端进程**，因此告警分两层：
> 1. **平台原生告警** —— 在 Cloudflare 控制面板配置，无需写代码（§1）。
> 2. **业务派生告警** —— 数据已落 D1（`push_logs` / `ai_usage` / `rate_limits` / `users`），用 `scripts/healthcheck.mjs` 周期轮询，可接 Cloudflare Alerting Webhook 或通用推送通道（§2–§3）。
>
> 设计原则：**避免告警疲劳** —— 只对「影响业务可用性」的指标设 High，趋势/容量类设 Medium/Low；阈值给的是起点，上线后按真实流量微调。

---

## 1. 平台原生告警（Cloudflare 控制面板）

路径：**Workers & Pages → ai-todo → Settings → Metrics & Analytics / Notifications**，或 **Notifications（铃铛）→ Add notification**。以下规则建议全部开启，通知渠道选「Email」+「Webhook」（Webhook 可转发到通用推送通道或邮件）。

| # | 告警名 | 指标 | 阈值（起点） | 严重度 | 说明 |
|---|---|---|---|---|---|
| P1 | Worker 异常错误率 | `worker_computed_error` / `worker_subrequest_error` | 错误率 > 1%（5 分钟窗口） | **High** | 代码抛错或子请求失败，直接影响登录/任务/复盘 |
| P2 | 请求延迟 p99 | `worker_duration_p99` | > 1000 ms（10 分钟窗口） | Medium | 体验劣化预警，D1 慢查询常是诱因 |
| P3 | D1 错误 | D1 `errors` | > 0（5 分钟窗口） | **High** | D1 写入/读取失败，会导致任务丢失或复盘失败 |
| P4 | D1 慢查询 | D1 `query_duration_p99` | > 200 ms | Medium | 容量预警，便于提前优化索引 |
| P5 | 子请求失败 | `worker_subrequest` failed | > 0.5%（5 分钟） | Medium | 多为推送 webhook / Workers AI 网络问题 |

**通知渠道建议**：告警统一发到**独立**的运维告警群（不要和业务复盘推送混在同一群），或用 Cloudflare Email + PagerDuty（生产必配 on-call）。

---

## 2. 业务派生告警（来自 D1）

这些指标平台面板看不到，需用 `scripts/healthcheck.mjs` 周期运行（建议挂在 cron 或外部监控如 UptimeRobot 每 15 分钟调一次），其退出码非 0 即代表异常，可直接作为健康检查探针。

| # | 指标 | 数据源 | 判定 | 严重度 |
|---|---|---|---|---|
| B1 | 推送失败 | `push_logs.status='failed'`（当日+前一日） | 任意失败 → **High** | 业务核心，用户收不到晨/夕/周复盘 |
| B2 | Cron 任务缺失 | `push_logs.status='success'` 当日缺 `morning`/`evening` | 缺任一 → **High** | 说明定时任务未触发或推送链断 |
| B3 | AI 日限额占用 | `ai_usage`（手动）当日计数 / `AI_DAILY_MANUAL_LIMIT`（默认 5） | ≥ 80% → Medium | 用户当日手动 AI 生成将触顶 |
| B4 | AI 降级率 | `ai_usage.degraded=1` 占比（近 24h） | > 30% → Medium | Workers AI 经常失败回退规则引擎 |
| B5 | 登录限流暴增 | `rate_limits` 中 `login:*` 活跃桶数（近 1h） | > 20 个独立 IP → Medium | 疑似撞库/爆破 |
| B6 | 强制改密挂起 | `users.must_change_password=1` 且 `updated_at` 超 7 天 | 任意 → Low | 安全卫生，首账号未及时改密码 |

> 业务日期一律以 **Asia/Shanghai** 计算（与 `src/utils/time.ts` 的 `businessDate()` 一致），healthcheck 脚本内部已用 `Intl` 对齐，避免 UTC 跨日错判。

---

## 3. healthcheck 脚本用法

```bash
# 本地库检查（无需 Cloudflare 凭证）
HEALTHCHECK_LOCAL=1 node scripts/healthcheck.mjs

# 生产库检查（需 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 已配置）
node scripts/healthcheck.mjs

# 自定义 D1 库名（默认读 wrangler.jsonc 的 d1_databases[0].database_name）
DB_NAME=ai-todo node scripts/healthcheck.mjs
```

- 脚本自动从 `wrangler.jsonc` 读取 D1 库名，调用 `wrangler d1 execute --json` 拉取 §2 的指标。
- **异常时退出码 1**，并打印每一项红/黄/绿状态；可作为外部监控的 HTTP/TCP 探针或 CI 定时任务。
- 若 `wrangler` 不可用或命令失败，脚本会**打印对应的原始 SQL**，方便你到 Cloudflare D1 控制台手动执行。
- 阈值集中在脚本顶部 `CHECKS` 常量，按真实流量调。

---

## 4. 上线前后核对清单

**部署前（代码侧，已完成）**
- [x] `push_logs` / `ai_usage` / `rate_limits` 落库，可追溯（#3/#4）
- [x] 推送失败重试 3 次并记录（#push-service）
- [x] `sanitizeNotifyText` 防注入（#2）
- [x] 登录 D1 固定窗口限流（#3）

**部署后（面板侧，待你配置）**
- [ ] 在 Cloudflare 开启 P1–P5 平台告警（§1）
- [ ] 配置告警通知渠道（运维告警群 / Email / PagerDuty）
- [ ] 将 `healthcheck.mjs` 接入定时任务（每 15 分钟），探针退出码非 0 即告警（§2–§3）
- [ ] 首次运行 healthcheck 校准 B3/B4/B5 阈值（默认 5 / 30% / 20 为起点）
- [ ] 真群推送文本渲染核验（#2 运行期项）后，确认 B1 不再误报
