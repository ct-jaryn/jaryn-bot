# jaryn-bot 可行性分析：拆开 Grok Bot，看 DSH 能给你什么

> 调研时间：2026-11-23　|　被评估的 DSH 版本：`@deepseek-ai/dsh` **0.2.2-rc.5**（本机 Desktop 安装，MIT）
> **状态：选型前文档。2026-11-23 最终决定「完全自研运行时」，见 [runtime-design.md](runtime-design.md) 与 [plugin-architecture.md](plugin-architecture.md)；本文保留为 Grok Bot 竞品与 DSH 能力的背景资料。**
> **注意**：本文的 A/B/C 指**架构形态**（web 插件 / 网关+SDK / 云 Bot）；**项目形态**的 A/B/C（DSH 插件 / 独立仓库 + DSH 运行时 / 完全自研）见 [build-on-dsh-vs-standalone.md](build-on-dsh-vs-standalone.md)。
> 证据分级：**【官方】**= xAI/DSH 官方文档或随包源码；**【二手】**= 第三方研究/媒体；**【估算】**= 我的工作量与成本推断。
> 路径约定：`P = /Volumes/jarynHD/DSH/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/`，`CLI = P/dsh`。

---

## 0. 结论（TL;DR）

**能做，但要先说清楚"做一个 jaryn-bot"是哪一档。** 拿 DSH 当底座，三档目标的差距是数量级的：

| 目标 | 形态 | 判断 | 主要缺口 | 估算工作量 |
|---|---|---|---|---|
| **A. 个人版**（1 人，IM 里一个常驻 AI 同事） | Telegram/Slack/微信 + 一个 DSH agent | ✅ **可行**，DSH 已经给了 ~80% | 通道适配、身份↔会话映射、流式回写、审批卡片 | 2–4 周（1 人） |
| **B. 小团队版**（5–20 人，多 Bot 名册、共享知识、审批、例程） | 上述 + 多租户 + 容器隔离 + 定时/触发器 + 产物 | ⚠️ **可做，但要补一层"产品服务层"** | 多租户/鉴权、每 Bot 沙箱、记忆、触发器、可观测 | 2–4 人月 |
| **C. Grok Bot 对等品**（云电脑、浏览器/桌面操作、Vault、会议、企业管控） | 云 VM + 浏览器 + 凭据代理 + 会议机器人 + 计费 | ❌ **DSH 给不了，也不该指望它给** | 云电脑与 CUA、Vault/凭据代理、Slack/Teams/会议、企业 IAM、配额计费 | 6–12 人月 + 3–5 人 + 基础设施 |

**最重要的三句话：**

1. **DSH 是"agent runtime"，不是"agent 产品"。** 它给你 agent 循环、工具、会话持久化、子 agent、调度、审批接缝、插件与 SDK；它**不**给你身份体系、通道、云电脑、凭据保险箱、计费。Grok Bot 的护城河恰恰在后者。
2. **Grok Bot 的真实形态是"人事系统"而不是"更强的聊天框"**：Bot 名册、共享云电脑、审批卡、Routine、Team Bot。它的技术难点不是"会不会点网页"，而是**审批语义 + 凭据不落地 + 长任务可恢复**。
3. **DSH 服务端"版本"不是一个独立产品**：它是 `web` / `headless` / `sdk` / `sdk-minimal` / `acp` 五种 profile。你要的"服务端"= **`sdk` profile 的 stdio JSON-RPC 服务**（最干净），或 `web` profile 的本地 GUI 服务器（面向浏览器，不适合当第三方 API）。

**当时的建议（2026-11-23 已被推翻，最终选择完全自研）：先做 A 档个人版（2–4 周），架构选"独立网关 + SDK 进程"，把 C 档里最贵的部分（云电脑/浏览器/Vault）全部砍掉或外购。** 详见 §4–§5。

---

## 1. Grok Bot 拆解

### 1.1 定位与目标用户

- **定位**：给非工程知识工作者的"永远在线的 AI 同事"。Bot 有自己的电脑、能登录你的工具、跨应用干活，做完回来汇报，只在需要判断时找你。**【官方】** [overview](https://docs.x.ai/grok-bot/overview)、[designing-grok-bot](https://x.ai/news/designing-grok-bot)
- **节奏**：2026-08-11 beta，2026-11-11（美西）/ 11-12（北京）1.0。**【官方】** [introducing-grok-bot](https://x.ai/news/introducing-grok-bot)、[grok-bot-1-0](https://x.ai/news/grok-bot-1-0)
- **用户**：销售、GTM、运营、财务、设计、PM；预置岗位模板（Sales Outbound / Expense Manager / Bug Reproduction / Chief of Staff…），1.0 后主打"团队共享 Bot"。
- **UX**：聊天是主界面但不是唯一界面——侧栏 Bot 名册（头像即状态：idle/working/waiting/blocked）、审批卡、产物卡、Routine 面板、语音与会议入口。**【官方】** [chat-and-collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration)

### 1.2 真实架构（把营销话术和实现分开）

| 说法 | 真相 | 证据 |
|---|---|---|
| "每个 Bot 一台云电脑" | **隔离单元是"用户"不是"Bot"**：每用户一台 Firecracker microVM，同一用户的全部 Bot 共享浏览器会话、`/workspace` 文件、CLI 凭据；每个 Bot 只分到一块独立"屏幕"，可并行，但一个 Bot 同时只能跑一个 computer-use 任务 | 【官方】[security-faq](https://docs.x.ai/grok-bot/security-faq)、[computer-and-apps](https://docs.x.ai/grok-bot/computer-and-apps) |
| 常驻 | 持久磁盘 + 空闲休眠 + 镜像升级保留文件；合盖也继续，因为跑在云端 | 【官方】[computers](https://docs.x.ai/grok-bot/computers) |
| 控制面 | 在 Cursor 侧：请求经 Cursor 服务器 → 宿主 computer → 模型 → 第三方；连接器是 MCP 插件，**OAuth token 留在后端、不下发到 VM** | 【官方】[security](https://docs.x.ai/grok-bot/security) |
| 凭据 | Vault 是 write-only：登录/卡/联系信息以"引用填充"方式打进页面，模型看不到值；没有 Vault 时走 Secure Form 或 1Password；SSO/passkey/CAPTCHA/银行验证 → 人工接管电脑 | 【官方】[vault](https://docs.x.ai/grok-bot/vault) |
| 审批 | Auto Review 是**独立审查模型**，在每次 shell/连接器/computer-use/Routine/subagent 前判定放行或拦下；Custom Rules 自然语言规则（Ask first / Allow automatically 各上限 20 条）；**Ask first 永远优先**；后台卡 30 分钟过期 | 【官方】[approvals-security-and-privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy) |
| 记忆 | 每个 Bot 独立记忆（偏好/规则/工作日志）+ 少量"关于你"的全局事实；Team Bot 有团队记忆，协作者改动要 owner 审核 | 【官方】[how-grok-bot-works](https://docs.x.ai/grok-bot/how-grok-bot-works)、[team-bots](https://docs.x.ai/grok-bot/team-bots) |
| 例程 | Routine = cron 型计划 **+ 事件触发**（Slack/GitHub/Linear/Sentry/PagerDuty/邮件/Webhook）；还能"录屏演示→草稿 skill" | 【官方】[skills-routines-and-automations](https://docs.x.ai/grok-bot/skills-routines-and-automations) |
| 通道 | Slack（mention/DM）、Microsoft Teams、X Chat、`@mail.grokbot.com` 专属邮箱、视频会议（可被拉进 Meet/Zoom/Teams 听会、出纪要） | 【官方】[meetings](https://docs.x.ai/grok-bot/meetings)、[microsoft-teams](https://docs.x.ai/grok-bot/microsoft-teams) |
| 产物 | docx/xlsx/pptx/图/视频 + **Pages**（可交互报告/看板，公网链接，企业版可禁） | 【官方】[files-and-results](https://docs.x.ai/grok-bot/files-and-results) |
| 企业 | SAML/OIDC/SCIM、网络策略与目的地白名单、TLS 检视代理兼容、Inference hooks（把每次模型请求签名转发给你的安全网关）、90 天动作录屏、OTel；**不支持 on-prem / BYO 镜像** | 【官方】[security](https://docs.x.ai/grok-bot/security)、[identity-and-access](https://docs.x.ai/grok-bot/identity-and-access) |

> 纠偏：大量评测文写的"每个 Bot 一台 VM"是产品叙事；官方安全 FAQ 原话是 *"Isolation is per user, not per Grok Bot"*。**【官方】**

### 1.3 商业模式与配额（值得抄的部分）

- **没有独立 SKU，纯捆绑**：包含在 The X Subscription 的 Premium/Super/Ultra（$30/$100/$200，年付更低）与 Cursor Pro/Teams 里；Plus（$8）与 Free 不含。**【官方】** [x-subscription/grok-bot](https://docs.x.ai/x-subscription/grok-bot)、[pricing](https://docs.x.ai/x-subscription/pricing)
- **周额度池与 Grok/Cursor 共享**，按 token + agent 步数计量；**"周额度折合多少美元"官方从不公布**。**【官方】** [usage-limits](https://docs.x.ai/x-subscription/usage-limits)
- 能拿到的硬数字只有：Bot+群聊合计 50、群聊 2–6 个 Bot、每 Bot 同时 1 个 computer-use 任务、批量付款一次批准管 24h。**VM 规格/并发 VM/单任务时长上限均无公开文档。**

### 1.4 护城河与已被暴露的脆弱点

**护城河（也是自建要啃的骨头）**

1. **审批 + 权限语义**：只有"用户本人的消息"算指令，网页/邮件里的文字一律不算；Ask first 永远优先；后台审批有 30 分钟过期语义。这是提示注入防御的落点。**【官方】**
2. **凭据工程**：OAuth token 不下 VM、Vault write-only、"登录直接进页面、模型永远看不到"。
3. **长任务可靠性**：mid-turn 安全点暂停、跨镜像 recreate 续跑、断线重连不终结 turn。行业共识是"90% → 100% 的最后一段"最难。**【二手】**
4. **分发**：绑在 Cursor + X 订阅里卖，获客成本趋近于零。

**已知脆弱点（自建可以反超的地方）**

- **单点故障是架构性的**：一用户一 VM ⇒ 一个 Bot 把 VM 玩坏，整个名册停摆；官方给的隔离建议居然是"再开一个 Cursor 账号"。**【官方/二手】**
- **上下文税**：单轮重读整段历史，二手实测 20–25 万 token/轮，缓存读占大头；这是"低毛利"的根源。**【二手/估算】**
- **凭据不隔离**：同用户 Bot 之间共享登录与卡；在 App 内聊天时模型能看到已存卡号（为结账便利）。**【官方】**
- **计费不透明、无 VM 规格、无 on-prem、无专属 egress IP**。

**竞品格局（形态已同质化，差异回到信任/成本/分发）**：Manus Cue、OpenAI Dots、Meta Muse、Perplexity Personal Computer（本地常开 Mac mini）、OpenClaw（开源本地网关：多通道 + cron + 子 agent + 文件记忆）、Rakazo（开源自托管 Grok Bot 替代）、Kortix/Suna、OpenHands。**【二手】**

---

## 2. DSH 的"服务端版本"到底有什么

> 先纠正一个常见预期：**DSH 没有独立的 "server edition"，也没有 `dsh serve`。** 它的服务端能力体现为 5 种可组合 profile + 一层插件体系。**【官方/已验证】** `CLI/src/bin.ts`、`CLI/src/args.ts`、`P/dsh/docs/architecture.md:17,43`

### 2.1 五种运行形态

| Profile | 启动 | 传输 | 适合 |
|---|---|---|---|
| `web` | `dsh --profile web` | HTTP + WebSocket（`/api/*`、`/api/remote.mux`），默认 loopback **3080**，打印带进程 token 的 URL | 单用户 GUI 控制台；可反代公网（`--public-url/--trusted-host/--tls-*`），鉴权 = **launch token → 签名 cookie**，**owner-only、无密码/无多账号、无 logout** |
| `headless` | `dsh --profile headless "任务"` | 无端口；stdout 出最终答案，`--json` 出 NDJSON 事件，`--session-id` 续聊 | 脚本/CI/一次性任务；**无实时审批通道** |
| `sdk` | 由外部进程以 stdio 拉起 | **stdio 上的 NDJSON JSON-RPC 2.0** | ⭐ 常驻、可编程、无 GUI |
| `sdk-minimal` | 同上 | 同上 | 最小组合（shell/read_image/working_directory，固定 `danger-full-access`），用于一次性任务 |
| `acp` | `dsh --profile acp` | stdio，ACP v1（`session/new`、`prompt`、`list`、`resume`、`close`、`cancel`） | 编辑器/IDE 集成 |

另外有 **Python SDK**（`deepseek-harness-sdk`，自带原生运行时 wheel，覆盖 Linux x64/arm64、macOS 14+ arm64、Windows x64，无需系统 Node）——它做的就是"拉起 `dsh --profile sdk*` 子进程并说 JSON-RPC"。**【官方】** `CLI/docs/user/guide/python-sdk.md`

### 2.2 可编程接口：SDK JSON-RPC（最关键的资产）

**方法（client→server）**：`initialize`、`session/prompt`、`session/query`（高层 run）、`session/resume`、`session/wait`、`session/working-directory/get|set`、`shutdown`
**通知（server→client）**：`session.event`（该运行时内所有 session 的事件，**unfiltered**——网关需按 `sessionId` 过滤）、`session.status`（running/idle）、`session.query.completed`（finalResponse + finishReason）、`subagent.started|finished`
**可选的 server→client 请求**：`approval/request`（一次性审批）、`user-question/ask`（原生提问）
证据：`P/dsh-sdk-protocol/README.md:40-57`、`P/dsh-sdk-jsonrpc-server/README.md`

能力要点（都已验证）：

- **一个 `sessionId` = 一个常驻 Agent**；多个 session 可并存；prompt 是"排队"语义，立即返回回执，结果靠事件流。
- **durable 事件流**：每个会话事实都会推给客户端，可以直接转成 IM 的"过程消息"。
- **断点续跑**：`session/resume` 载入持久化历史、修复被打断的最后一轮；会话存在 `<DSH_HOME>/sessions/.../session.vN.jsonl.zstd`（单写者锁）。
- **原生命令**：`/compact`、`/permission <preset>`、`/plan`、`/goal` 都能通过 SDK 触发；`/goal` 会自动跑多轮直到目标达成——**这是"常驻员工"的雏形**。
- **审批接缝**：`initialize.approvalRequests=true` 后，敏感动作会变成 `approval/request` 发给你的网关——你在 IM 里回"同意/拒绝"即可；未接就 fail closed。**【已验证】**
- **工具面**：bash/文件/搜索/web fetch/office/子 agent/team/workflow/schedule/MCP 全在 composition 里选。

**硬限制（必须知道）**【已验证】：

- **没有 cancel、没有 per-session close、没有协议版本协商**——"停止"只能杀进程再 resume。
- stdout 是协议通道，树里任何 stdout 日志都会破坏协议。
- `sdk-minimal` 固定 `danger-full-access`（能改宿主任何路径），只能在一次性 workspace/容器里跑。
- 版本仍 `0.2.2-rc.5`，SDK 明确无兼容承诺。

### 2.3 多 agent、调度、记忆

- **subagent / workflow / team**：`ctx.subagents` 可编程；Team 是 root session 上的 durable 共享任务板（`P/dsh-agent-team`）。这对应 Grok Bot 的"多 Bot 协作"，但**没有独立 Remote API**，只能在 Agent 内部驱动。
- **Schedule**：`ctx.schedule` 有 7 种 timing、create/list/view/edit/run/delete、投递到已有/新建会话；**Host 必须常驻才有投递**；SDK 组合下支持"恢复提醒"（`sdkSessionActivation`）。这对应 Grok Bot 的 Routine（时间维度）。
- **记忆**：**没有一等公民的长期记忆**。可用：`AGENTS.md`/skills 文件、MCP memory server（官方有 `mcp-memory` 指南）、会话历史检索（session-query）。这是 A 档可接受、B 档要补的。
- **人格/身份**：`dsh-persona` 可按 preset 给每个会话独立 system prompt——**"多 Bot 名册"可以映射成多个 agent preset**。**【已验证】**
- **Auto Review**：DSH 有 `dsh-experimental-auto-review`——**独立审查模型在每次工具调用前判定**，与 Grok Bot 的 Auto Review 是同一思路（实验性、默认关）。**【已验证】**

### 2.4 扩展点：插件能干什么

- **Cordis 插件**（`apply(ctx)`，注册即 effect，可 HMR）：注册工具（`ctx.tools.register`）、服务、事件监听。
- **服务端可直接挂 HTTP/WS 路由**：`ctx.webServer.register / registerUpgrade / registerFallback`——`web` profile 下挂 `/telegram/webhook` 是正规口子（官方 `dsh-webhook-github` 就是先例）。**【已验证】**
- **MCP**：一行配置接 stdio 或 streamable-http server——**浏览器自动化（Playwright/Chrome MCP）、Gmail/日历/Notion 等连接器都能从这里外购**，不用自己写。
- **Bundle + profile patch**：`dsh plugin --profile X add <pkg>`，或直接写 `cordis.patch.yml` 覆盖行。MIT 许可，可商用。**【已验证】**

### 2.5 DSH 明确没有的东西（= jaryn-bot 要自己造的）

1. **通道层**：没有 Slack/Telegram/微信/邮件 adapter，没有消息↔会话映射、去重、富媒体、审批卡片回写。
2. **身份与多租户**：只有 owner cookie/token；没有用户体系、API key、配额、审计、logout。
3. **浏览器/桌面自动化**：**没有内置 Playwright**；CUA（`dsh-cua-bundle` / `dsh-experimental-cua-macos`）**仅 macOS，Windows 开发中，Linux 没有**。云服务器上的"点网页"必须靠 MCP 或自建。
4. **凭据保险箱**：有本地凭据库（`$DSH_HOME/.credentials.yaml`），没有 Vault/Secure Form/1Password 那种"模型永不可见"的填充代理。
5. **语音/会议**：有实验性 STT/语音输入，没有 TTS 通话与会议机器人。
6. **计费/配额/可观测**：无官方 metrics/健康 HTTP 端点与部署文档（仅有 telemetry/OTel 插件），无 docker/systemd 官方形态。
7. **产品级常驻契约**：SDK 无 cancel/close，得自己写进程池、健康检查、重连、优雅退出。

---

## 3. 逐项对标：Grok Bot vs DSH vs 你

| 能力 | Grok Bot | DSH 现状 | 差距与补法 | 补的成本 |
|---|---|---|---|---|
| Agent 循环/工具 | 一方 harness | ✅ 成熟（bash/fs/web/office/subagent/workflow） | 无 | 0 |
| 会话持久化/恢复 | 云 VM + 快照 | ✅ JSONL + zstd、resume、fork、compaction | 无 | 0 |
| 定时/例程 | Routine（cron+事件） | ⚠️ 只有时间维度（schedule） | 事件触发器要自建（webhook→prompt） | 小 |
| 多 Bot 协作 | 群聊 2–6、首席参谋 | ⚠️ subagent/team 板（进程内） | 对外暴露"多 Bot 名册"要自建 | 中 |
| 人格/岗位 | Bot 名册 + 记忆 | ✅ persona/preset；⚠️ 无长期记忆 | 记忆层（文件/MCP/SQLite） | 中 |
| IM 通道 | Slack/Teams/X/邮件 | ❌ 无 | 自写 adapter（grammY/bolt/邮件） | 中 |
| 语音/会议 | 语音通话、入会 | ❌ 基本无 | 外购（LiveKit/Recall.ai） | 大 |
| 云电脑/浏览器 | Firecracker VM + 浏览器 | ❌ Linux 无 CUA；无浏览器工具 | 容器 + Playwright MCP / 云浏览器 | 大 |
| 凭据保险箱 | Vault/Secure Form/1Password | ❌（仅本地凭据库） | 自建填充代理或先不做"自动登录" | 大 |
| 审批 | Auto Review + 规则 + 过期 | ✅ 审批接缝 + 实验性 Auto Review | 审批卡片 UI + 规则配置 | 小–中 |
| 产物 | docx/xlsx/pptx/Pages | ✅ office 工具 + present/文件 | Pages 类"可交互页面"要自建 | 小–中 |
| 多租户/企业 | SAML/SCIM/网络策略/审计 | ❌ 单用户 | 容器/进程隔离 + 自建 IAM | 大 |
| 计费/配额 | 捆绑订阅、周额度池 | ❌ | Stripe + 计量 | 中 |
| 可观测 | OTel + 90 天录屏 | ⚠️ OTel 包存在，形态未定 | 自建 | 中 |

**一句话**：DSH 把"大脑+手脚+记忆载体"给了你，Grok Bot 的其余部分全是"信任工程 + 分发 + 运维"。

---

## 4. 三种可行架构

### 方案 A：`dsh web` + 频道插件（最快，单用户）

```
Telegram/Slack ──webhook──▶ [dsh web 进程]
                              ├─ ctx.webServer.register('/tg/webhook')  (自写 Cordis 插件)
                              ├─ 插件: 消息 → ctx.agents 建会话/followup（服务 API 需在 0.2.2-rc.5 上自行核实）
                              ├─ GUI: 聊天/审批/产物/Routine 全复用
                              └─ 同一个 DSH_HOME 下的 JSONL 会话
```

- **优点**：GUI、审批 UI、Routine、Team 板、产物预览**全部免费**；单进程；你在本机就能看到 bot 在干什么。
- **缺点**：`web` profile 是**单用户、owner cookie** 模型，天然不能多租户；升级 rc 版本时要跟着改插件；插件开发要学 Cordis + Typert 生成器。
- **适合**：你一个人用、想尽快用上、且愿意接受"跑在一台常开机器上"。
- **估算**：通道插件 + 消息映射 3–5 天；调审批/流式 2–3 天。**【估算】**

### 方案 B：独立网关 + `dsh --profile sdk` 进程池（当时推荐，产品化路径）

```
Telegram / Slack / 微信 / Web
        │ webhook / long-poll
        ▼
┌─────────────────────────────────────────────┐
│ jaryn-bot gateway (Node/TS 或 Python)        │
│  ├─ Channel adapters (grammY / bolt / …)     │
│  ├─ Identity router: 通道用户 → bot preset → sessionId │
│  ├─ Session manager: 每 workspace 一个 dsh 子进程 │
│  ├─ JSON-RPC client (stdio)                  │
│  ├─ Event pump: session.event → 流式编辑消息   │
│  ├─ Approval broker: approval/request → 内联按钮 │
│  ├─ Scheduler: cron/webhook → session/query   │
│  └─ SQLite: 映射/审计/去重/配额                │
└───────────────┬─────────────────────────────┘
                │ stdio JSON-RPC
                ▼
   dsh --profile sdk  (每租户/每 workspace 一个)
   工具: bash/fs/office/web MCP + Playwright MCP
   持久化: DSH_HOME/sessions/*.jsonl.zstd
```

- **优点**：进程边界清晰；可以用 Python（官方 SDK）或 TS；容器化就是"一个容器一个 bot"；升级 DSH 只影响子进程；网关可以复用到多通道。
- **缺点**：**没有 cancel**（"停"= 杀进程 + resume）；要么每个租户一个进程（内存成本），要么所有会话挤一个进程（无隔离）；GUI/审批 UI 要自己写。
- **适合**：这就是 jaryn-bot 的"产品形态"。
- **估算**：v0 单人版 2–4 周；小团队版 2–4 人月。**【估算】**

### 方案 C：容器化云 Bot（Grok Bot 形态，规模化的终局）

方案 B 的 `dsh` 子进程跑在 **每 Bot 一个 Docker 容器**里（`bash-sandbox` 默认 `read-only`/`workspace-write`；容器负责 network/进程隔离），浏览器用 **Playwright MCP + 云浏览器**（Browserbase/Steel/自建 Chromium），截屏串流用 noVNC/WebRTC 实现"看它干活/接管"。

- **优点**：隔离单位从"用户"细化到"任务/线程"，恰好是 Grok Bot 的单点故障弱点；可休眠/快照/迁移。
- **缺点**：K8s/调度/镜像/持久卷/计费，全是基础设施活；成本从"进程"变"VM"。
- **适合**：多人团队版、或需要真正"云电脑"时。**不建议 v0 就上。**

### 选型建议

| 你的情况 | 选 |
|---|---|
| 只有你自己用，想 1 周内看到效果 | **A** |
| 想做"jaryn-bot"这个产品、以后接多通道/多用户 | **B**（v0 就能上） |
| 要给团队/客户用，含浏览器操作 | C（B 跑通后再演进） |

**当时的推荐：B 起步（最终改为完全自研）。** 理由：A 的"免费 GUI"是糖，但会把你的产品形态锁死在"DSH 桌面版的远程壳"；B 的网关层（身份映射、幂等、审批卡片、审计）无论哪档都要写，早写早省。**Phase 0 可以先用 A 花 3 天验证"IM 里对话 DSH"值不值得做。**

### 为什么不是"直接用 OpenClaw / Rakazo 当底座"？

这类开源项目强在**通道层**（Telegram/Slack/Discord/WhatsApp 多通道、cron、文件式记忆、网关），弱在**agent 运行时**（工具生态、会话恢复/压缩、子 agent、审批接缝、结构化事件流）。DSH 恰好相反。所以最省事的组合是：**借它们的通道层设计，用 DSH 当运行时**，而不是二选一；更不建议 fork 一个成型的"开源 Grok Bot 克隆"再往里塞 DSH——两边的架构假设（沙箱边界、会话模型、审批语义）不同，改造成本通常高于自己写一层网关。**【二手/估算】**

---

## 5. jaryn-bot v0：范围、里程碑、不做什么

> **2026-11-23 需求收敛：不做语音，聚焦「多 bot 自己交流 / 记忆 / 主动搜索完成任务」三项。对应的能力设计与配置见 [scope-multibot-memory-proactive.md](scope-multibot-memory-proactive.md)。**

> **最终决定（2026-11-23）：完全自研运行时。本节 DSH 路线里程碑仅作参考，最新计划见 [runtime-design.md](runtime-design.md) 第 19 节。**

### 5.1 产品定义（v0）

> **jaryn-bot = 跑在你自己服务器上的常驻 AI 同事。** 你在 Telegram（或 Slack）里给它派活，它在你的 workspace 里用 shell/文件/网页/文档工具干活，过程中流式汇报，危险动作弹审批卡，做完把产物发回来；不在线时也会按 schedule 主动干活。

**一个 bot = 一个 agent preset（人格+工具+工作目录）+ 一条会话线**。多 bot 名册 = 多个 preset。

### 5.2 里程碑

| 阶段 | 内容 | 验收 | 估时 |
|---|---|---|---|
| **M0 打通** | 网关拉起 `dsh --profile sdk`，`initialize` → `session/query`，把 `session.event` 打到终端；Telegram 发一句话收到回复 | 端到端一条消息 | 3 天 |
| **M1 单人可用** | 流式"打字机"编辑、消息↔session 映射、`/new /resume /compact`、文件收发、审批内联按钮、错误与重连 | 连续 3 天日常使用不崩 | 1–2 周 |
| **M2 像个员工** | 多 preset（名册）、schedule 主动任务、记忆（AGENTS.md + skills + SQLite 事实表）、产物卡（文件/预览） | 能自动跑晨报/巡检 | 1–2 周 |
| **M3 工具增强** | MCP：Playwright（网页操作）、Gmail/日历/Notion（按需）；容器化隔离；审计日志 | 能"打开网页办事" | 2–4 周 |
| **M4 多通道/多人** | Slack adapter、身份↔租户表、配额、部署脚本（systemd/docker compose） | 第二个人能用 | 1–2 月 |

### 5.3 明确不做（v0）

- ❌ 云电脑/桌面 CUA（Linux 无 DSH 实现）
- ❌ Vault/1Password/自动登录（先接受"人肉登录"）
- ❌ 语音通话/入会
- ❌ 计费/多租户 IAM（先单用户/白名单）
- ❌ Pages 类交互产物（先用文件 + markdown）

### 5.4 协议"Hello World"（可直接照抄的调用序）

```text
spawn: dsh --profile sdk        (env: DSH_HOME=<per-bot home>; cwd=<workspace>)

→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{
     "cwd":"/srv/jaryn/workspace",
     "provider":"deepseek-official","model":"deepseek-v4-flash",
     "approvalRequests":true,
     "capabilities":{"userQuestions":true}}}
← {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{
     "name":"deepseek-harness-sdk-runtime","version":"…"}}}

→ {"jsonrpc":"2.0","id":2,"method":"session/query","params":{
     "sessionId":"tg-12345",
     "contentBlocks":[{"type":"text","text":"看下这个仓库的测试为什么挂"}]}}

← notification: session.event × N          → 逐条渲染成 IM 里的"过程消息"
← request: approval/request                → IM 内联按钮
     {"sessionId":"tg-12345","toolName":"bash","callId":"…","reason":"…"}
     ← {"outcome":"allowed-once"}  // 或 "rejected" / "cancelled"
← notification: session.query.completed
     {"sessionId":"tg-12345","commandId":"…","finalResponse":"…","finishReason":{…}}
```

（字段名已对照 `P/dsh-sdk-protocol/src/types.ts:18,65,99` 核实：`InitializeParams{cwd,provider,model,reasoningEffort?,maxTokens?,approvalRequests?,capabilities?}`、`SessionQueryParams{sessionId,contentBlocks:TextBlock[]}`、`session.query.completed{sessionId,commandId,finalResponse,finishReason}`。`session/prompt` 是低层排队入口，`session/query` 是高层"发一句、等结果"入口；"停止"= 杀进程 + `session/resume`。）

---

## 6. 风险与硬约束（做之前必须接受）

1. **rc 版本、无兼容承诺**：`0.2.2-rc.5`；SDK 协议可能变，升级要回归测试。**缓解**：网关里隔离协议层，锁定版本，升级前跑回归用例。
2. **没有 cancel/close**：中止只能杀进程 + `session/resume`。**缓解**：进程池 + 优雅退出 + 会话不变式测试。
3. **`sdk-minimal` 是 danger-full-access**：能改宿主任何路径。**缓解**：容器或独立 Unix 用户跑；`sdk` profile 用 `bash-sandbox` + 权限预设。
4. **stdout 纯净**：任何日志/插件输出都会破坏 JSON-RPC。**缓解**：网关只读 stdout 的 JSON-RPC 帧，stderr 单独收集。
5. **提示注入与审批语义**：网页/邮件内容不是指令；Ask first 永远优先。**缓解**：审批策略引擎 + 只把"通道 owner 的消息"当输入（这正是 Grok Bot 的做法）。
6. **成本是上下文税**：会话越长每轮越贵。**缓解**：compaction、按线程开新会话、结构化记忆外置、限制工具输出长度。
7. **单写者锁**：同一会话不能多进程并发写。**缓解**：一个会话一个 owner 进程；跨进程转发。
8. **许可**：`@deepseek-ai/dsh` 是 **MIT**，可商用、可修改、可闭源分发；但**模型 API 的 ToS 与数据合规**要单独确认（尤其把用户数据送第三方模型）。

---

## 7. 当时的最终建议（已被 2026-11-23 决策推翻）

> 以下操作顺序基于 DSH 路线，仅作历史记录；自研版的开工顺序见 [runtime-design.md](runtime-design.md) §23。

**能。而且 DSH 是这个方向上少有的"合法、可编程、MIT、自带完整 agent 运行时"的底座。**

但请按这个顺序做，别一口气对标 Grok Bot：

1. **先验证价值（3 天）**：方案 A 快速做一个"Telegram ↔ dsh"的插件或脚本，自己用一周。如果一周后你还在用，再往下投。
2. **再产品化（2–4 周）**：切到方案 B，写网关四件套——**通道适配、身份↔会话映射、事件流回写、审批 broker**。这四件是任何档位都绕不过去的。
3. **最后才碰"云电脑"**：浏览器用 MCP 外购，CUA 等 DSH 的 Linux 支持或自己接 Playwright + 虚拟桌面。**不要为了"像 Grok Bot"而自建 Firecracker。**

**三个自检问题：**

- 你的 bot 需要"在网页上点来点去"吗？需要 → 先上 Playwright MCP，别碰 CUA。
- 只有你自己用吗？是 → 方案 A 就够，别过度设计多租户。
- 你能接受"停止 = 重启会话"吗？不能 → 只能选方案 A（进程内插件能原生取消）。

---

## 附录：证据索引

**DSH（本机 0.2.2-rc.5，均可复核）**

| 主题 | 位置 |
|---|---|
| profile 形态 | `CLI/docs/architecture.md:17,43`；`CLI/src/bin.ts:31-73` |
| web 服务器与鉴权 | `P/dsh-client-connection/README.md:41-47,82-83`；`P/dsh/docs/subsystems/web-server.md:102,222-241`；`P/dsh-web-app/README.md:16,38-43` |
| 公网反代 | `CLI/docs/user/guide/public-deployments.md` |
| SDK 协议方法表 | `P/dsh-sdk-protocol/README.md:40-57,140-142` |
| SDK 服务器行为/限制 | `P/dsh-sdk-jsonrpc-server/README.md` |
| headless | `P/dsh-headless/README.md:12,44-49,100-106` |
| Python SDK/平台 | `CLI/docs/user/guide/python-sdk.md` |
| 持久化 | `CLI/docs/subsystems/persistence.md:341`；`P/dsh/docs/architecture.md:128` |
| 审批接缝 | `P/dsh-user-approval/README.md`；`P/dsh-experimental-auto-review/README.md` |
| Team/子 agent | `P/dsh-agent-team/README.md:105,134-140`；`P/dsh-subagent/README.md` |
| 调度 | `P/dsh/docs/subsystems/schedule.md:5,84,91-102,131` |
| 人格 | `P/dsh-persona/README.md`；`P/dsh-web-app/README.md:95,133` |
| CUA 仅 macOS | `P/dsh-cua-bundle/README.md:12`；`P/dsh-experimental-cua-macos/README.md` |
| 插件 HTTP 路由 | `P/dsh/docs/subsystems/web-server.md:222-241`；`dsh-webhook-github`（在 DSH 仓库 `packages/experimental/webhook-github`，未随 Desktop 安装） |
| 许可/版本/Node | `CLI/package.json`（MIT, `engines.node>=24.9.0`） |

**Grok Bot（外链）**

- [Overview](https://docs.x.ai/grok-bot/overview) · [How it works](https://docs.x.ai/grok-bot/how-grok-bot-works) · [Bots](https://docs.x.ai/grok-bot/bots) · [Computer & apps](https://docs.x.ai/grok-bot/computer-and-apps) · [Vault](https://docs.x.ai/grok-bot/vault) · [Approvals](https://docs.x.ai/grok-bot/approvals-security-and-privacy) · [Routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) · [Team Bots](https://docs.x.ai/grok-bot/team-bots) · [Computers](https://docs.x.ai/grok-bot/computers) · [Security](https://docs.x.ai/grok-bot/security) · [Security FAQ](https://docs.x.ai/grok-bot/security-faq) · [Initiative](https://docs.x.ai/grok-bot/initiative) · [Meetings](https://docs.x.ai/grok-bot/meetings) · [Files & results](https://docs.x.ai/grok-bot/files-and-results) · [Pricing](https://docs.x.ai/x-subscription/pricing) · [Usage limits](https://docs.x.ai/x-subscription/usage-limits)
- 二手/背景：[36 氪访谈](https://www.36kr.com/p/4071829512935301)、[产品研究笔记](https://github.com/oneiron-dev/oneiron/blob/b229d8227abbb17b22457f2b6b052a10fb7ae42c/apps/web/docs/product-studies-20260907/grok-grokbot-product.md)
