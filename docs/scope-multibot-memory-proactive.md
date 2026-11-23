# jaryn-bot 能力设计：多 Bot 交流 / 记忆 / 主动任务（不做语音）

> 需求收敛（2026-11-23）：**不要语音**；要 **① 多 bot 自己交流 ② 记忆 ③ 主动搜索并完成任务**。
> **状态：本文是「基于 DSH」方案下的能力设计；最终决定完全自研。机制思路（Team 协作 / 记忆分层 / 守夜人）仍然适用，对应自研版的 bus / memory / scheduler 插件，见 [runtime-design.md](runtime-design.md) 与 [plugin-architecture.md](plugin-architecture.md)。**
> **历史文档：文中一切时间/工期估算均已失效，不代表当前计划；版本节奏见 [03-roadmap.md](03-roadmap.md)。**
> 版本基线：`@deepseek-ai/dsh` 0.2.2-rc.5（`sdk` profile = `dsh-base` + `dsh-sdk-app` 两层）。
> 结论先说：**这三项里两项半是 DSH 原生能力，缺的那半是"记忆的自动提炼与语义召回"和"守夜人调度"**——都能补，但补法不同。

---

## 0. 一页结论

| 需求 | DSH 现状 | 结论 | 主要工作量 |
|---|---|---|---|
| **多 bot 自己交流** | ✅ Team 模式原生：`subagent` / `send_message` / `list_agents` / 4 个任务板工具；需一行 patch 开启 | **v0 直接可用**；"对等名册 + 群聊"要补网关消息总线（v0.5） | 小 → 中 |
| **记忆** | ⚠️ 有载体没闭环：`AGENTS.md` 指令链、`SKILL.md` 技能、会话检索工具、compaction；**没有自动记忆提炼 / 语义召回** | **v0 用"文件 + 会话检索"够用**；语义记忆用 MCP memory（v1） | 中 |
| **主动搜索 + 完成任务** | ✅ 原生件齐全：`web_search`/`web_fetch`、`/goal` 自动多轮、schedule、jobs、subagent 并行 | **缺"触发器/守夜人"，网关补 cron/webhook 即可** | 中 |

**一句话架构**：DSH 负责"一个 bot 怎么思考和干活"，网关负责"谁是 bot、它记得什么、什么时候该干活、干完告诉谁"。

---

## 1. 目标形态

```
                    ┌──────────── 网关 jaryn-gateway ────────────┐
IM(Telegram/Slack) ─┤ 通道适配 / 身份映射 / 消息总线 / 调度器      │
   webhook          │ 记忆服务(文件+MCP) / 审批 broker / 审计      │
                    └──────┬──────────────────────┬──────────────┘
                           │ stdio JSON-RPC       │ MCP(可选)
                    ┌──────▼──────┐        ┌──────▼──────┐
                    │ bot A        │        │ memory MCP  │
                    │ dsh sdk 进程 │◀──────▶│ (语义记忆)   │
                    │  root 会话   │        └─────────────┘
                    │  ├ worker 1  │  ← Team 模式：send_message / 任务板
                    │  └ worker 2  │
                    └──────────────┘
```

- **Bot** = 一个 agent preset（persona + 工具 + 权限）+ 一个 workspace（记忆/产物）+ 一条会话线。
- **Bot 内的 worker** = DSH 原生 subagent（Team 模式，共享任务板，可互相发消息）。
- **Bot 之间** = 网关消息总线（v0.5 起），不是 DSH 原生。
- **守夜人** = 网关 cron/webhook → 给 bot 投递任务；DSH 内 schedule 用 `session` 目标也能做，但网关做更可控（见 §4.2）。

---

## 2. 多 Bot 自己交流

### 2.1 两层实现，别混为一谈

| | **L1：DSH 原生 Team（v0）** | **L2：网关消息总线（v0.5）** |
|---|---|---|
| 形态 | 一个 root 会话开 Team 模式，子 bot 是有角色的 subagent | N 个独立 bot（独立会话/进程），网关做消息路由 |
| 通信 | `send_message`、`list_agents`（`interrupt_agent` 需另覆盖 `tool-subagent-control.config.interrupt: true`）；root 可续聊/回收 | 自建 `send_to_bot` / `check_inbox` 工具（MCP 最简单）→ 网关投递 |
| 协作 | 原生任务板 4 工具：`team_task_create/get/list/update`（claim/complete 用 CAS） | 自建（SQLite 表即可），或复用 DSH 的板 |
| 记忆隔离 | **同一 workspace**（要按子目录隔离） | 每 bot 独立 cwd/`AGENTS.md`，天然隔离 |
| 成本 | 低（同进程、同模型树） | 中（每 bot 一个进程） |
| 主要风险 | 单 workspace 文件冲突；root 是单点；不是"对等群聊" | 消息环路、唤醒风暴、调度复杂度 |
| 适合 | **v0 验证"多 bot 协作到底有没有用"** | 名册/群聊的产品形态 |

**建议：v0 只做 L1，用 2–3 个固定角色（研究员 / 写手 / 审校）跑通"自己分工、互相递活"；确认有价值再上 L2。** 不要一上来写消息总线——它 80% 的复杂度在防环路和预算控制，不在通信本身。

### 2.2 L1 怎么开（已验证的配置）

`dsh-base` 已经挂了 `agent-team`、`tool-agent-team`、`subagent` 与 `subagent-control`，**只差"默认开启"**。在 `$DSH_HOME/profiles/sdk/cordis.patch.yml` 加：

```yaml
- id: agent-team
  config:
    defaultEnabled: true
```

（官方 `docs/user/guide/python-sdk.md#enable-team-mode` 给的正是这段；SDK 侧也可以按启动 patch 传。）

开启后模型拿到：`subagent` / `subagent_fork` / `send_message` / `list_agents` + 任务板四件套（`interrupt_agent` 默认关闭——`dsh-base` 把 `tool-subagent-control.interrupt` 设为 `false`，要用需在 profile patch 里覆盖为 `true`）；root 与所有子 bot 用同一套任务 schema。**注意 Team 是"每 root 会话的模式"**，resume 会保留当时的选择。

### 2.3 角色设计（映射 Grok Bot 的"首席参谋"）

- **root = 首席参谋**：接活、拆任务、派给 worker、向人汇报。它只有一个职责：调度与汇总。
- **worker = 专才**：每个 worker 一个 preset（persona + 工具子集 + 工作目录子目录），例如
  - `researcher`：只给 `web_search/web_fetch` + 文件读，产出带来源的笔记；
  - `writer`：只给文件读写 + office，把笔记变成简报；
  - `critic`：只给读 + 搜索，负责挑错，不给写权限。
- **交接用任务板，不用自由聊天**：`team_task_create` 写清目标/验收，worker `claim` 后干，`complete` 时附产物路径。自由 `send_message` 只用于澄清，不用于传状态——否则上下文会被聊天记录撑爆。
- **文件约定**：`workspace/<bot>/` 各自子目录，共享产物放 `workspace/outbox/`，避免同 workspace 互踩。

### 2.4 L2 消息总线的关键设计（等到 v0.5）

- 工具形态：一个 stdio MCP server 暴露 `list_bots`、`send_message(to, text, thread?)`、`check_inbox`，内部 HTTP 调网关；**不用写 DSH 插件**（MCP 一行配置）。
- 消息信封：`{from, to, threadId, hop, kind: ask|inform|handoff, payload, deadline}`。
- 防失控四件套：**hop ≤ 2、同 thread 消息数上限、每 bot 每分钟速率上限、每轮 token/墙钟预算**；超限直接拒绝并记审计。
- **信任边界**：bot 之间的消息**不是用户指令**，不得触发"发送/发布/删除/付款"这类动作；这些只能由人的消息或审批授权（与 Grok Bot "只有用户消息算指令"一致）。这条写进 `AGENTS.md`。
- 群聊语义（谁在说话、该谁接）：v1 再做，v0 用"点名/任务板"代替。

---

## 3. 记忆

### 3.1 四层，别指望一个机制解决

| 层 | 机制（DSH 原生） | 何时生效 | 成本 | v0 |
|---|---|---|---|---|
| **工作记忆** | 会话本身 + 自动 compaction | 自动 | 每轮 token（主要成本） | ✅ |
| **长期事实** | `AGENTS.md` 指令链：`$DSH_HOME/AGENTS.md`（全局）+ workspace 下从根到 cwd 的 `AGENTS.md`（AGENTS.md/CLAUDE.md 兼容），每条链 65,536 字节预算 | **会话首次请求载入**；文件系统操作可发现新的嵌套文件；resume 会对齐基线；**不热监听编辑** | 每轮注入（有上限） | ✅ |
| **情节（过去发生过什么）** | `@deepseek-ai/dsh-tool-session-query`（opt-in）：搜索历史会话、事件、关系、精确读取；**跨会话只允许 cwd 完全一致**，且排除当前会话 | 模型按需调用 | 低 | ✅ 一行 patch |
| **技能（怎么做）** | `skill-filesystem` + `tool-skill`：`SKILL.md` 目录/YAML frontmatter，项目/自定义/用户三个根，热监听 | 按需加载 | 低 | ✅ |
| **语义（记住事实并召回）** | MCP memory server（官方给了 3 份参考配置：Memorix、MCP Reference Memory、Engram） | 模型按需调用 | 中（多一个服务） | v1 |

### 3.2 关键坑：`AGENTS.md` 写了不等于立刻生效

`agent-instructions` 在**第一次请求**载入链，之后不持续监听外部编辑；resume 才对齐。所以"让 bot 自己写记忆文件、下一句话就记得"**不成立**。三种补法：

1. **会话边界刷新**（推荐 v0）：重要记忆写入后，网关在下一条消息前判断"记忆脏了"→ 新建会话（`session/query` 用新 sessionId）或 resume；旧会话历史仍在，可用 session-query 检索。
2. **记忆摘要注入**：网关每轮把 `MEMORY.md` 的 1–2KB 摘要作为 text block 拼在用户消息前。简单粗暴，成本可控（约几百 token/轮）。
3. **召回工具**（推荐 v1）：记忆服务（MCP/SQLite+FTS）提供 `recall(query)`，模型自己决定何时查。

### 3.3 记忆写入策略（模型自动 + 人可纠正）

- `AGENTS.md` 里写死规则：**"用户明确表达的长期偏好、身份事实、工作规则 → 追加到 `MEMORY.md` 的对应小节；一次性任务细节不写。"**（对应 Grok Bot "Bot 自己决定记什么"）
- 每晚一个"记忆整理"任务：读当天会话（session-query）→ 提炼 → 去重 → 改写 `MEMORY.md`（带日期），旧内容进 `MEMORY.archive.md`。
- 用户命令：`/forget <关键词>` → 网关改文件 + 记审计；`/remember <文本>` → 网关直接追加。
- 隔离：每 bot 一个 workspace（= 一个 `AGENTS.md` 链），`$DSH_HOME/AGENTS.md` 放"关于主人"的全局事实（名字、时区、偏好），与 Grok Bot 的 "About you" 同构。

### 3.4 跨 bot 记忆的硬约束

`tool-session-query` 的跨会话授权条件是 **cwd 完全一致**。所以：

- 想共享"过去发生过什么"→ 同 workspace（或共享 cwd）；
- 想隔离 → 各自 cwd；
- 想"共享知识但各自私有"→ 共享知识放共享 `AGENTS.md`/团队 `SKILL.md`，私有用各自 `MEMORY.md` + MCP memory 的 namespace。

---

## 4. 主动搜索 + 完成任务

### 4.1 原生件（都已确认在 base 里）

| 件 | 作用 | 证据 |
|---|---|---|
| `web_search` + `web_fetch` | 主动搜索、读全文；结果标注为外部不可信内容 | `dsh-tool-web` README；base 挂 `web-search-deepseek`/`web-fetch-http` |
| `/goal` + goal + goal-round-driver | 一个持久目标跨轮推进，**自动多轮**直到完成/受阻，默认轮数上限 256 | `dsh-goal` README；base 挂 goal/driver/command |
| team / subagent | 并行搜索、分工 | base 已挂 |
| jobs | 后台长命令 | base 挂 `jobs-local` + `tool-jobs` |
| schedule | 7 种 timing（cron/RRULE/…），投递到会话 | base + sdk-app 挂 schedule/tool-schedule |
| compaction | 长任务不撑爆上下文 | base 挂 |

### 4.2 守夜人放哪：网关 cron，而不是 DSH schedule（v0）

DSH schedule 有个坑：**SDK 组合缺少 Session 创建 provider 时，`new` / `new_once` 目标会被拒（`invalid_rule`），只有 `session` 目标可用**（`docs/subsystems/schedule.md` Delivery targets；标准 `sdk` profile 是否提供该 provider 建议开工时实测）。也就是说"每次触发开一个新会话"在 sdk profile 里**未必**能做到。

所以 v0 的调度放网关：

```
MISSIONS.md / SQLite
   ├─ trigger: cron(5 字段) | every(秒) | webhook | rss 轮询
   ├─ mission: prompt + 目标 + 预算(maxRounds/maxTokens/墙钟) + 交付物
   └─ on fire → 取/建会话说 session/query 投递
        → 模型自己 web_search / 开 subagent / 设 goal 多轮
        → session.event 流回网关 → 进度推 IM
        → session.query.completed → 结果/产物推 IM
```

- **"主动"的分层**（按实现难度递增）：
  1. **定时主动**（v0）：每天 8 点简报、每小时盯一个话题；
  2. **目标驱动**（v0）：`/goal 把 X 查清楚并写成一页`，agent 自动多轮，人只看结果；
  3. **事件驱动**（v1）：新邮件/RSS/仓库 PR/群消息 → 触发任务；
  4. **自发发现**（v2）：agent 自己巡检待办、发现异常再提议——这才是 Grok Bot 的 "initiative"，成本最高、最容易骚扰，不要早做。
- **预算护栏**（必须有，否则一夜烧穿）：`initialize.maxTokens`、goal 轮数（别用 256，压到 8–20）、单任务墙钟、每日总预算、超限杀进程（SDK 无 cancel）。
- **交付**：优先 `session.query.completed` 的 `finalResponse` + 产物路径；需要中途播报时给 bot 一个 `notify` MCP 工具（可选）。
- **无人值守审批**：后台任务默认"不需要审批的动作才允许自动跑"；需要审批的一律超时=拒绝（对应 Grok Bot 后台卡 30 分钟过期），并把"待批"推给人。

---

## 5. 与既有里程碑的合并（去掉语音后的 v0）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0（3 天）** | 网关 + `dsh --profile sdk` + Telegram 一来一回；`web_search` 可用；workspace 放 `AGENTS.md` | 一句话问"今天 XX 有什么新闻"能搜到并回 |
| **M1（1 周）** | Team 模式开、3 个角色 worker + 任务板；流式过程消息；审批内联按钮；文件收发 | 让它"查三家竞品并写对比"，它自己分工完成 |
| **M2（1–2 周）** | 多 bot 名册（每 bot 独立进程/workspace）；记忆整理任务；MCP 消息总线；cron 简报 | 每天早上自动发简报；两个 bot 能互相递活 |
| **M3** | MCP 语义记忆；Playwright MCP；容器隔离；审计 | 跨天记得住偏好；能开网页办事 |

**明确不做**：语音/会议/TTS、云电脑 CUA、Vault/自动登录、计费与多租户 IAM。

---

## 6. 风险清单（按"会不会让你翻车"排序）

1. **多 bot 消息环路 / 唤醒风暴** → hop/速率/预算三重限制；v0 只在任务板 + 有限 send_message 上开放。
2. **记忆写而不生效** → 会话边界刷新或摘要注入，别假设文件热更新。
3. **上下文税** → compaction + 短会话 + 检索代替长历史；每任务预算。
4. **SDK 无 cancel** → 任务超时只能杀进程；确保 `session/resume` 幂等，产物落盘再汇报。
5. **Team 共享 workspace** → 子目录隔离 + outbox 约定。
6. **主动任务的噪音** → 主动只发"有结论/有异常"的摘要，不发过程；可一键静音。
7. **rc 版本漂移** → 协议层隔离 + 锁定版本 + 回归用例。

---

## 7. 需要你拍板的两个点

1. **多 bot 的"交流"是哪种？**
   - (a) 一个 bot 内部带几个 worker 分工（L1，v0 就能做，成本低）；
   - (b) 几个独立 bot 像同事一样互相发消息（L2，需要网关总线，多 1–2 周）。
   （建议先 (a)，跑一周再决定 (b)。）
2. **"主动"从哪来？**
   - (a) 定时（每天/每小时）；
   - (b) 我给它一个目标，它自己推进到完成；
   - (c) 外部事件（邮件/RSS/PR/群消息）触发。
   （建议 v0 做 (a)+(b)，(c) 需要你指定数据源。）

> **后续结论（2026-11-23）**：已决定完全自研；v0 采用 **L1**（一个 bot 带 worker），对等总线降为 v0.5；主动先做 **(a) 定时 + (b) 目标驱动**，(c) 事件触发等指定数据源。自研版对应实现见 [runtime-design.md](runtime-design.md)（bus / scheduler 插件）。

---

## 附录：关键证据

| 结论 | 证据 |
|---|---|
| Team 已挂载、需 `defaultEnabled: true` | `dsh-base/cordis.patch.yml:363-405`；`docs/user/guide/python-sdk.md#enable-team-mode` |
| 成员用 `send_message/list_agents`（`interrupt_agent` 默认关闭）通信 | `P/dsh-tool-agent-team/README.md`；另见 `dsh-base/cordis.patch.yml:386-389`（`tool-subagent-control.interrupt: false`） |
| 任务板 4 工具 + CAS | `P/dsh-tool-agent-team/README.md`；`P/dsh-agent-team/README.md` |
| `AGENTS.md` 链 / 65KB / 不热监听 | `P/dsh-agent-instructions/README.md` |
| `SKILL.md` 技能根 | `P/dsh-skill-filesystem/README.md` |
| 会话检索需 cwd 一致 | `P/dsh-tool-session-query/README.md` |
| MCP memory 三份参考配置 | `docs/user/guide/mcp-memory.md` |
| web_search/web_fetch | `P/dsh-tool-web/README.md`；`dsh-base/cordis.patch.yml:493-505` |
| goal 自动多轮、轮数上限 | `P/dsh-goal/README.md`；`dsh-base/cordis.patch.yml:327-334` |
| SDK 下 schedule 的 `new` 目标可能被拒（条件） | `docs/subsystems/schedule.md` Delivery targets |
| SDK 无 cancel/close | `P/dsh-sdk-protocol/README.md:140-142` |
