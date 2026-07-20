# 微信推送通道搭建指南（免费 · ClawBot 桥接）

> 适用场景：本应用已内置「定时推送任务 + 机器人通道配置」功能。本文说明如何把消息**免费**推送到**微信**，无需企业微信、无需付费服务（PushPlus 等）。

---

## 1. 为什么不能直接用 ntfy 推微信？

`ntfy` 是一个独立的消息服务（自建或公共实例），它**不对接微信**。它的客户端是 App / 浏览器，不是微信。
所以「ntfy → 微信」在协议层面不存在，必须引入一个**能对接微信的桥接层**。

结论：**想免费推微信 = 用微信官方 ClawBot 协议 + 自行托管的桥接服务**。

---

## 2. 方案总览：ClawBot（微信官方） + WeClawBot-API（自托管桥）

### 微信 ClawBot（iLink 协议）
- 微信**官方**的「 clawbot / Claw 机器人」插件（微信内新增的官方能力），基于 HTTP/JSON。
- **不是** itchat / wechaty 那种逆向协议 → 封号风险极低。
- 桥接域名：`ilinkai.weixin.qq.com`。

### WeClawBot-API（开源自托管桥）
- 开源项目，职责：在「微信 ClawBot」与「你的 Webhook」之间做翻译。
- 对外暴露极简接口，正好对接本应用的 `NOTIFY_WEBHOOK_URL` 模型：
  ```
  POST /bots/{bot_id}/messages?token=XXX&text=消息内容
  # 或 POST /bots/{bot_id}/messages  body: {"text":"消息内容"}
  ```
- **免费**：因为桥是你自己跑的，没有第三方按条收费。

> 本应用的 `push-service` 已自动识别 `/bots/` 路径并转换为 `{ "text": ... }` 负载，无需任何额外开发。

---

## 3. ClawBot 的硬性限制（务必了解）

微信 ClawBot 是「上行优先」设计，存在三条限制：

| 限制 | 说明 | 应对 |
|------|------|------|
| **下行前必须先上行** | 你给机器人发过消息，它才能给你推 | 首次使用先给机器人发一句「你好」 |
| **每 10 次下行需补 1 次上行** | 连续推送 10 条后第 11 条会被拒 | 桥或定时脚本定期（如每天）主动发一条保活 |
| **每 24h 需至少 1 次上行** | 超过 24h 无上行，会话失效 | 用「每日早报」这类固定推送天然满足（前提是它先上行？不——下行不算）。建议桥内置每日保活上行 |

> 实操建议：在桥里加一个「每日 00:01 自动给机器人发一条心跳上行」的定时器，即可满足 24h 与 10 次限制，绝大多数场景下无感。

---

## 4. 获取 ClawBot 凭证（bot_id / token）

1. 在微信中启用 ClawBot / Claw 机器人插件，创建一个机器人。
2. 记录下 `bot_id` 与 `token`（以及你自己的微信账号需先「添加/关注」该机器人）。
3. **先给机器人发一条消息**（如「绑定」），完成首次上行。

> 具体入口随微信版本变动，以微信内 ClawBot 官方说明为准。

---

## 5. 自托管 WeClawBot-API 桥（两种主机选其一）

桥是一个**有状态、长连接**进程（需维持 iLink 会话），**不能**跑在 Cloudflare Workers 上（Workers 无状态、短生命周期）。可选主机：

### 方案 A：你的 Mac 本机（零成本 · 推荐先试）
适合 Mac 长期开机的场景（如学校 IT 办公室机器）。

```bash
# 1) 拉起桥（以 Docker 为例，按项目实际 README 调整命令）
docker run -d --name weclawbot -p 8080:8080 \
  -e BOT_ID=你的bot_id -e BOT_TOKEN=你的token \
  ghcr.io/your-org/weclawbot-api:latest

# 2) 验证
curl -X POST "http://localhost:8080/bots/你的bot_id/messages?token=你的token&text=hello"
# 微信应收到「hello」
```

让它在 Mac 上**开机自启且不被系统休眠打断**：
- 用 `launchd` plist 托管容器（或裸进程）。
- 加 `caffeinate` 防止合盖休眠断连。

示例 `~/Library/LaunchAgents/com.isns.weclawbot.plist`（要点）：
```xml
<key>ProgramArguments</key>
<array>
  <string>/usr/bin/caffeinate</string>
  <string>-i</string>
  <string>/usr/local/bin/docker</string>
  <string>start</string>
  <string>-a</string>
  <string>weclawbot</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
```

> 缺点：Mac 关机/合盖则推送中断。若只需**工作时段**推送，完全够用。

### 方案 B：低价 VPS（¥10–20/月 · 推荐要 24/7 时）
腾讯云/阿里云「轻量应用服务器」或任意 ¥5–15/月 VPS，装 Docker 后同方案 A 跑桥。

- 优势：7×24 在线、稳定、对外有固定公网 IP。
- 安全：桥只对内/或对应用开放，建议用 `token` + 防火墙限制来源 IP（仅放行本应用 Worker 出口，或套一层反向代理 + 访问控制）。

> 不推荐 Railway / Render 免费层：免费实例会休眠，违背「长连接保活」需求。

---

## 6. 把桥地址配置进本应用

桥跑起来后，把它的 URL 填进应用。两种方式任选：

### 方式一：界面配置（推荐，无需改代码/环境变量）
1. 打开应用 → 设置 → **推送通道配置（机器人）**。
2. Webhook 地址填：
   ```
   https://<你的桥主机>/bots/<bot_id>/messages?token=<你的token>
   ```
3. 提供商选「ClawBot（微信）」→ 保存。
4. 同页「定时推送任务」里新建任务，模板可用 `{{date}} {{pending_count}}` 等变量。

### 方式二：环境变量（部署时设定）
`wrangler.toml / .dev.vars` 中：
```
NOTIFY_WEBHOOK_URL="https://<你的桥主机>/bots/<bot_id>/messages?token=<你的token>"
```
界面配置会覆盖环境变量（界面优先）。

---

## 7. 端到端验证清单

- [ ] 微信内已给机器人发过首条消息（上行）
- [ ] `curl` 直发桥地址，微信收到（排除桥/凭证问题）
- [ ] 应用设置页「发送测试推送」成功，微信收到
- [ ] 新建一个 `*/1 * * * *` 的测试任务，1 分钟内微信收到定时消息
- [ ] 桥已配置每日保活上行（应对 24h / 10 次限制）

---

## 8. 故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 测试推送报错 `PUSH_FAILED: 未配置` | 没填 Webhook | 填 `NOTIFY_WEBHOOK_URL` 或界面通道配置 |
| 微信收不到但 curl 桥能发 | 应用出口 IP 被桥防火墙拦 | 放行应用 Worker 出口 / 取消限制 |
| 连续推送后中断 | 触发 10 次/24h 上行限制 | 桥加每日保活上行定时器 |
| 24h 后全失效 | 超过 24h 无上行 | 同上，保活上行 |
| 推送内容为空 | 模板变量未渲染 | 检查模板 `{{...}}` 拼写；`tasks` 等需有数据 |

---

## 9. 成本与风险总结

- **成本**：¥0（Mac 方案）或 ¥10–20/月（VPS）。相比 PushPlus 按条/订阅收费，长期更省。
- **封号风险**：ClawBot 为微信官方能力，远低于逆向协议。仍建议**仅自用、低频、不营销**。
- **可靠性**：桥是单点，建议 VPS + 进程守护（docker restart=always / launchd KeepAlive）。
