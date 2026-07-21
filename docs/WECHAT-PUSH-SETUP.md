# 微信推送通道搭建指南（免费 · ClawBot 桥接）

> 适用场景：本应用已内置「定时推送任务 + 机器人通道配置」功能。本文说明如何把消息**免费**推送到**微信**，无需企业微信、无需付费服务（PushPlus 等）。
>
> **本文档已按 2026-07-21 真实端到端验证过的步骤修订**（bot_id / 镜像 / 登录方式 / 优先级均经实测核对）。

---

## 1. 为什么不能直接用 ntfy 推微信？

`ntfy` 是一个独立的消息服务（自建或公共实例），它**不对接微信**。它的客户端是 App / 浏览器，不是微信。
所以「ntfy → 微信」在协议层面不存在，必须引入一个**能对接微信的桥接层**。

结论：**想免费推微信 = 用微信官方 ClawBot 协议 + 自行托管的桥接服务**。

---

## 2. 方案总览：ClawBot（微信官方） + WeClawBot-API（自托管桥）

```
你的待办 / 定时任务
   → AI Todo Worker（POST 到 NOTIFY_WEBHOOK_URL）
   → 你自托管的 WeClawBot-API 桥（开源 Node 服务，端口 26322）
   → 微信 ClawBot 插件（iLink 官方协议，低风险）
   → 你的微信会话里收到消息
```

### 微信 ClawBot（iLink 协议）
- 微信**官方**的「ClawBot / 机器人」插件（微信内新增的官方能力），基于 HTTP/JSON。
- **不是** itchat / wechaty 那种逆向协议 → 封号风险极低。
- 桥接域名：`ilinkai.weixin.qq.com`。

### WeClawBot-API（开源自托管桥）
- 开源项目：**`github.com/Cp0204/WeClawBot-API`**，Docker 镜像 **`cp0204/weclawbot-api:latest`**，默认端口 **`26322`**。
- 对外暴露极简接口，正好对接本应用的 `NOTIFY_WEBHOOK_URL` 模型：
  ```
  POST /bots/{bot_id}/messages?token=XXX
  body: {"text":"消息内容"}
  ```
  成功响应：`{"code":200,"message":"OK"}`
- **免费**：桥是你自己跑的，没有第三方按条收费。
- 登录态存放在挂载卷的 `config/auth.json`（含 `bot_id` 与 `api_token`，**属个人凭证，勿外泄**）。

> 本应用的 `push-service` 已自动识别 URL 中含 `/bots/` 并转换为 `{ "text": ... }` 负载，无需任何额外开发（实测零改码）。

---

## 3. ClawBot 的硬性限制（务必了解）

微信 ClawBot 是「上行优先」设计，存在三条限制：

| 限制 | 说明 | 应对 |
|------|------|------|
| **下行前必须先上行** | 你给机器人发过消息，它才能给你推 | 首次使用先给机器人发一句「ping」 |
| **每 10 次下行需补 1 次上行** | 连续推送 10 条后第 11 条会被拒 | 定期（如每 2~3 天）主动给 bot 发一条保活 |
| **每 24h 需至少 1 次上行** | 超过 24h 无上行，会话失效 | 同上，保活上行即可 |

> 实操建议：你每天约 3 条推送，差不多**每 3 天在微信里给 bot 发个「ping」**就够维持。

---

## 4. 搭建步骤（本地 Mac，零成本 · 推荐先试）

> 前置：已安装 **Docker Desktop**（桥是 Docker 镜像，没 Docker 跑不起来）。

### 4.1 拉起桥容器
```bash
# 在任意工作目录（如 ~/weclawbot）
mkdir -p ~/weclawbot && cd ~/weclawbot

docker run -d \
  --name weclawbot-api \
  -p 26322:26322 \
  -v "$PWD/config:/app/config" \
  --restart unless-stopped \
  cp0204/weclawbot-api:latest
```

### 4.2 扫码登录（关键步骤）
```bash
docker exec -it weclawbot-api bot
```
- 终端会打印一张**登录二维码**（约 2 分钟有效）。
- 手机微信 **「+」→「扫一扫」→ 右下角「相册」**（用相册扫比对着屏幕稳定），扫完后**手机上一定要点「确认登录」**。
- 登录成功后，在微信里**给「微信 ClawBot」发一条消息**（如「ping」）激活 API 发信。
- 登录态落盘到 `~/weclawbot/config/auth.json`，里面就是 `bot_id`（形如 `xxx@im.bot`）与 `api_token`。

> 二维码时效很短，若过期：重跑 `docker exec -it weclawbot-api bot` 或在容器内等它刷新后重扫即可。

### 4.3 让桥开机自启且不被休眠打断（可选）
- 用 `launchd` plist 托管容器，配 `KeepAlive` + `caffeinate -i` 防止合盖休眠断连。
- 缺点：Mac 关机 / 合盖则推送中断。若只需工作时段推送，完全够用。

---

## 5. 把桥地址配置进本应用

本应用的 `resolveNotifyUrl` 优先级：**环境变量 `NOTIFY_WEBHOOK_URL` 优先于界面 `bot_config`**。

### 方式一：环境变量（已验证最稳，推荐本地）
在 `.dev.vars`（本地）或 `wrangler.toml` / 部署 secret（生产）中：
```
NOTIFY_WEBHOOK_URL="http://<LAN_IP>:26322/bots/<bot_id>/messages?token=<api_token>"
```
- `<LAN_IP>` 取你 Mac 的局域网地址（`ipconfig getifaddr en0`），**不能用 `127.0.0.1`** —— Worker（workerd）无法回环访问宿主的 localhost，必须走局域网 IP。
- Mac 防火墙需放行 `26322`。

### 方式二：界面配置（bot_config）
1. 打开应用 → 设置 → **推送通道配置（机器人）**。
2. Webhook 地址填：
   ```
   http://<LAN_IP>:26322/bots/<bot_id>/messages?token=<api_token>
   ```
3. 提供商选「自动识别」或 ClawBot → 保存。
> 注意：界面配置**不会**覆盖环境变量；若 `.dev.vars` 已设 `NOTIFY_WEBHOOK_URL`，实际生效的是环境变量那份。

---

## 6. 端到端验证清单

- [ ] Docker 容器 `weclawbot-api` 运行中，端口 `26322` 监听
- [ ] 手机扫二维码并**点确认登录**，且已给 bot 发过首条消息（上行）
- [ ] `config/auth.json` 已生成（含 `bot_id` / `api_token`）
- [ ] 应用设置页「发送测试推送」返回 `pushed:true`，**微信收到「AI Todo 测试推送 / 配置正常 ✅」**
- [ ] （可选）新建一个 `*/1 * * * *` 的测试任务，1 分钟内微信收到定时消息

---

## 7. 故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 测试推送返回 `未配置` | 没填 Webhook | 填 `NOTIFY_WEBHOOK_URL` 或界面通道配置 |
| 微信收不到但 curl 桥能发 | Worker 用了 `127.0.0.1` 而非 LAN IP | 改为局域网 IP；确认 Mac 防火墙放行 26322 |
| 连续推送后中断 | 触发 10 次 / 24h 上行限制 | 给 bot 再发一条消息保活 |
| 扫码一直过期 | 二维码约 2 分钟时效 + 来回太慢 | 终端直接跑 `docker exec -it weclawbot-api bot` 实时扫，或用相册扫 |
| admin 登录 401（本地） | 本地 D1 密码被改过 | 用正确 PBKDF2 盐编码（盐 = hex 字符串的 UTF-8 字节）重算哈希写回 `users` 表 |

---

## 8. 生产环境注意（重要）

- **桥必须公网可达**：本地 `wrangler dev` 时 Worker 在 Mac 上，可用 LAN IP 访问桥；**一旦 `wrangler deploy` 上 Cloudflare 生产环境**，Worker 在云端，访问不到你局域网桥。届时桥需换成**公网 URL**（VPS / Cloudflare Tunnel 内网穿透 / 公网主机）。
- 低价 VPS（¥10–20/月）装 Docker 跑桥即可获得 7×24 稳定推送，建议用 `token` + 防火墙限制来源 IP。

---

## 9. 成本与风险总结

- **成本**：¥0（Mac 方案）或 ¥10–20/月（VPS）。相比 PushPlus 按条 / 订阅收费，长期更省。
- **封号风险**：ClawBot 为微信官方能力，远低于逆向协议。仍建议**仅自用、低频、不营销**。
- **灰度风险（⚠️ 重点）**：WeClawBot-API 项目处于**灰度期**（README 明确「可用性待观察」），微信 ClawBot 插件本身也在灰度，链路**可能随微信侧调整而失效**。建议：正式长期推送**不要只押它一个**，保留 ntfy 等保底通道（如本项目已配置的 `ntfy.sh/ai-todo-hodyli`）。
- **可靠性**：桥是单点，建议 VPS + 进程守护（docker `--restart unless-stopped` / launchd `KeepAlive`）。
