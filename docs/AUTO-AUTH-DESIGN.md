# 自动授权机制设计（一次性授权 · 自主推进 · 安全可控）

> 目标：用户一次性授予访问权限后，Agent 可随任务进度自主把代码推送到
> `9rave/code-`，**无需每次手动发 token**；并在授权失效时给出明确状态。

---

## 0. 先说清楚一个硬约束（务必读）

你要的第 2 条「token 即将过期时自动续期」，**用 PAT 做不到**。

- GitHub 的 Classic / Fine-grained **Personal Access Token 无法被程序刷新**。
  它到期只有你能去网页重新生成，没有 API、没有 refresh token。
  所以现在「你每次发我一个 token」的循环，是 PAT 机制本身决定的，不是实现问题。
- 真正能「持久化 + 自动刷新」的 GitHub 凭据只有两种：
  1. **GitHub App**（私钥签发短期 installation token，可随时重新签发）；
  2. **OAuth App**（refresh token 流程，可刷新）。

因此下面以 **GitHub App** 为推荐方案——它是唯一同时满足你 4 条要求且「安全可控」的路径。

---

## 1. 方案对比

| 维度 | PAT（现状） | **GitHub App（推荐）** | OAuth App |
|---|---|---|---|
| 持久化（#1） | 存文件可持久，但到期即死 | 私钥存一次，**无过期** | refresh token 持久 |
| 自动续期（#2） | ❌ 不可能 | ✅ token 1h，自动重签 | ✅ refresh 自动续 |
| 连续性（#3） | 每次要你发 token，易断 | ✅ 无人工干预 | ✅ 无人工干预 |
| 失效通知（#4） | 能 | ✅ 明确 AUTH_* 码 | ✅ 明确错误 |
| 权限范围 | 整账号或单仓（classic 易过宽） | **精确单仓 + 单权限** | 用户授权范围 |
| 撤销方式 | 去网页 revoke 该 token | **卸载 App / 删密钥即失效** | revoke |
| 密钥是否进聊天 | 是（已暴露多次） | **否**（仅落本地文件） | 否 |

---

## 2. 推荐架构：GitHub App + 本地私钥 + 自动推送

```
 你（一次性）                本地工作区                          GitHub
 ┌──────────┐          ┌─────────────────────┐            ┌──────────────┐
 │ 创建 App │──安装──▶ │ .secrets/           │            │ 9rave/code-  │
 │ 下载 .pem│──放入──▶ │  github-app.pem     │            │              │
 └──────────┘          │  (gitignored,600)   │            │              │
                       └─────────┬───────────┘            │              │
 Agent 每轮提交后 /              │                        │              │
 定时自动化触发                  ▼                        │              │
                 ┌──────────────────────────┐   POST    │              │
                 │ scripts/autopush.mjs     │──────────▶│ /installations│
                 │   │                      │  JWT(RS256)│ /{id}/       │
                 │   ▼                      │            │  access_tokens│
                 │ scripts/gh-app-auth.mjs  │◀── token ──│  (1h)        │
                 │  缓存+<5min自动刷新       │            │              │
                 │  用 token 推 develop/main │── git push▶│              │
                 └──────────────────────────┘            └──────────────┘
```

### 流程
1. **你一次性**：在 GitHub 建 App → 安装在 `9rave/code-` → 下载私钥 `.pem` → 放到
   `ai-todo-assistant/.secrets/github-app.pem`（已加进 `.gitignore`，权限 600）。
2. Agent 提交后（或定时自动化触发）运行 `scripts/autopush.mjs`。
3. `gh-app-auth.mjs` 用私钥签 JWT（RS256），调 GitHub API 换取 **1 小时** installation token，
   本地缓存；**剩余 <5 分钟自动重签**（满足「过期前续期」）。
4. `autopush` 用该 token 把领先 origin 的分支推上去，推完把 remote URL 还原成干净地址。
5. 任意授权异常 → 打印 `[AUTH_*]` 状态并退出，**不静默失败**。

---

## 3. 四条要求如何被满足

1. **持久化**：私钥落本地 `.secrets/`（gitignored），无过期；token 运行时由私钥现签。
2. **自动续期**：installation token 有效期 1h，脚本在 <5min 时自动重签，调用方无感。
3. **连续性**：配合 WorkBuddy 定时自动化（见 §5），Agent 提交即推送，不因授权中断
   （唯一中断是你主动撤销——这是设计内的「急停开关」，见 §4）。
4. **失效通知**：明确的退出码与状态文案（见 §6）。

---

## 4. 安全模型

- **最小权限**：App 只安装在 `9rave/code-` 一个仓库，仅授予
  `Contents: Read and write`（如需改 CI 再加 `Workflows: Read and write`）。
  不给账号级宽泛权限。
- **密钥不进聊天/历史/仓库**：私钥只在你本地文件，`.gitignore` 已忽略；
  与之前把 PAT 明文发在对话里相比大幅降低泄露面。
- **可一键撤销**：你随时可在 GitHub 卸载该 App 或删除/轮换其私钥，
  Agent 访问**立即**失效（比逐个 revoke PAT 干净）。
- **密钥静默**：公钥可提交，私钥绝不提交；如误提交可立即轮换密钥使旧钥失效。
- **残留清理**：推送用临时 `x-access-token:<token>@` URL，推完还原为 `https://...`，
  token 不留在 `git remote -v` 或日志。

> 注意：私钥落在本地磁盘，若本机被攻破则 App 访问会沦陷——这与任何本地存储的
> 机密同理。可接受的做法：① App 仅授权单仓；② 不设 `workflows` 权限以缩小爆炸半径；
> ③ 你保留随时卸载 App 的急停能力。

---

## 5. 自主推进的「自动化」层

GitHub App 解决凭据，但要「随任务自主推进」还需一个触发器。两种：

- **A. 每轮结束自推（默认）**：Agent 完成提交后直接调 `autopush.mjs`，你无需介入。
- **B. 定时兜底自动化**：在 WorkBuddy 建一个 recurrence 自动化（如每 30 分钟），
  跑 `node scripts/autopush.mjs`。即使某轮漏推，也会被定时任务补上，确保连续性。

推荐 A+B 双保险。自动化会在结果里回显 `[PUSH_OK]/[AUTH_*]`，你一眼可知状态。

---

## 6. 状态通知码（要求 #4）

| 状态 | 含义 | 你该做的 |
|---|---|---|
| `[PUSH_OK] 已推送 <branch>` | 成功 | 无需动作 |
| `[PUSH_OK] 无待推送内容` | 已同步 | 无需动作 |
| `[AUTH_NO_KEY]` | 私钥文件缺失 | 放入 `.secrets/github-app.pem` |
| `[AUTH_NO_APP_ID]` | 未设 App id | 设 `GITHUB_APP_ID` |
| `[AUTH_NO_INSTALLATION_ID]` | 未安装/未设安装 id | 在仓库安装 App 并设 id |
| `[AUTH_FORBIDDEN]` | 401/403，App 被卸载或密钥撤销 | 检查 App → Installations |
| `[AUTH_NETWORK]` | 网络不可达 | 检查网络 |
| `[AUTH_MINT_FAILED]` | 其他签发失败 | 看附带 HTTP 信息 |

---

## 7. 权限范围与有效期（你要求的说明）

- **权限范围**：仅 `9rave/code-` 一个仓库；默认 `Contents: Read and write`；
  若需机器人改 CI，再加 `Workflows: Read and write`（与现有 `ci.yml` 推送兼容）。
- **installation token 有效期**：1 小时，自动续期，对**你无感**。
- **私钥有效期**：GitHub App 私钥**本身不过期**；「有效期」= **直到你撤销**
  （卸载 App 或删除/轮换密钥即失效）。这是比 PAT「固定过期日」更可控的模型。
- **对比 PAT**：PAT 有固定到期日且**无法续期**；本方案无到期日但**你随时可撤**。

---

## 8. 你的一次性操作（之后无需再发 token）

1. GitHub 右上角 → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**。
   - GitHub App name：`code-push-bot`（任取）
   - Homepage / Callback：可填 `https://github.com/9rave/code-`
   - **取消**「Expire user authorization tokens」相关项（我们用 App 自己凭据，不涉及用户 OAuth）
   - **Webhook**：不勾（不需要）
   - **Repository permissions** → **Contents: Read and write**（要改 CI 再加 **Workflows: Read and write**）
   - 其他默认 → **Create GitHub App**
2. 进入该 App → **Generate a private key** → 下载 `.pem`。
3. 把 `.pem` 放到 `ai-todo-assistant/.secrets/github-app.pem`
   （`chmod 600 .secrets/github-app.pem`）。
4. 该 App 页面左侧 **Install App** → 选 `9rave/code-` → Install。
5. 记下两处数字：
   - App 设置页顶部的 **App ID**；（设 `GITHUB_APP_ID`）
   - 安装后在 **App → Install App** 或调用 API 得到的 **Installation ID**；（设 `GITHUB_APP_INSTALLATION_ID`）
6. 告诉我「已放好」，我跑 `node scripts/gh-app-auth.mjs` 验证能签发，并建好定时自动化。

> 之后你**再也不需要发任何 token**。要停止授权，去 GitHub 卸载该 App 即可。
