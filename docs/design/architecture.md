# 架构

> 适用版本：v1.11.0 · 状态：现行
> 自托管单进程 Agent 运行时：插件组合启动、事件溯源持久化、能力按 seam 扩展。

## 1. 定位与硬约束

jaryn-bot 是一个跑在用户自己机器上的常驻 AI 同事。差异不在 agent 循环本身，而在三件事：**组合方式**（部署形态是一份可覆盖的插件行）、**持久化语义**（append-only 事件是唯一真相）、**信任边界**（危险动作走审批，凭据不进入上下文）。

| 约束 | 取值 | 影响 |
|---|---|---|
| 运行时 | TypeScript / Node 24，无第三方运行时依赖 | `node` 直接执行 TS，依赖面即攻击面 |
| 进程 | 单进程（`jary serve`）；另有云电脑容器与进程外插件宿主两个子进程边界 | 不做横向扩容，SQLite 单写者 |
| 存储 | SQLite（WAL）+ 工作区文件 | 零外部数据库；`jary backup`（VACUUM INTO + 目录拷贝） |
| 部署目标 | 单 owner，一台 4C4G 云服务器 | 内存与模型成本是主要约束 |
| 规模 | 31 个包、41 个已加载插件、74 个工具、63 条路由、28 张表、23 个 CLI 命令 | 全量清单见 [代码清单](../reference/inventory.md) |
| 测试 | 64 个测试文件 / 178 个用例 | `npm test` 串行执行 |

## 2. 分层

```
┌ 接口层 ──────────────────────────────────────────────────────────┐
│ Web 工作台 / PWA · HTTP /api/* · GET /api/stream (SSE)            │
│ /ws/client (JSON-RPC) · CLI 23 命令 · Electron / Android 客户端   │
└───────────────────────────────┬──────────────────────────────────┘
┌ 能力层（插件，41 个已加载）────┼──────────────────────────────────┐
│ 工具 74：fs · shell · web · browser · computer · memory · task   │
│   · bot · vault · pages · artifact · office · email · goal ...   │
│ 云电脑 · 记忆 · 任务板/消息总线 · 调度/目标 · 提议/教学           │
│ 产物/Pages · 连接器/邮件 · 通知 · Vault/密钥 · 维护 · 设备配对    │
└───────────────────────────────┬──────────────────────────────────┘
┌ 运行时（插件）────────────────┼──────────────────────────────────┐
│ agent-core：循环 · 上下文装配 · 压缩 · 工具注册 · 审批 · 定价     │
│ llm-deepseek（Provider）· store-sqlite（事件存储）· questions     │
└───────────────────────────────┬──────────────────────────────────┘
┌ 内核（写死，约 350 行）────────┼──────────────────────────────────┐
│ Context 树 · Effect/disposer · EventBus（emit/parallel/serial/   │
│ waterfall）· Loader（patch → 拓扑排序 → mount）· 插件声明         │
└───────────────────────────────┬──────────────────────────────────┘
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
  SQLite jary.db（28 表）+ workspace + artifacts   模型 API（默认 DeepSeek）
                                                  出网目标 · 云电脑容器
```

分层的判据是依赖方向：能力层只依赖运行时与内核，内核不 import 任何能力包；接口层不持有状态，状态全部落到存储层。

## 3. 关键机制

### 3.1 组合：profile → bundle → patch → rows

```
profile.json（bundles[] + patches[]）
  → 按序展开每个 bundle 的 patch（insert / 整行替换 config / disabled）
  → 叠加 profile 自己的 patch
  = rows（id + name + config）
  → 解析插件 name → 校验 provides/inject/optional
  → 按 provides 拓扑排序 → ctx.mount(row) → 插件 apply 生效
```

- 行操作只有三种：`insert`、按 `id` 整行替换、`disabled`。config 是**整值替换**，不做深合并，行为可预测。
- `inject` 缺失、同一 service 两个 provider、循环依赖都 **fail-loud**，错误信息带行 id 与插件名（`packages/kernel/src/loader.ts`）。
- 默认组合是 `packages/bundles/base/patch.json` 的 41 行；换模型只覆盖 `llm` 一行（`bundles/deepseek/patch.json`），换云电脑后端只覆盖 `computer` 一行（`bundles/docker-computer/patch.json`）。
- Bot 是名册数据而非进程分支：`bots` 表记录 persona、workspace、记忆命名空间（默认 `bot:<id>`）；会话按 `bot_id` 归属，`spawn_worker` 为子 Bot 建独立 session 与 workspace，记忆与工作区随之隔离。内核的 Context 树（`root` / `bot` / `session` / `agent`）保留了分层能力，当前运行时只实例化 `root`。
- 自检命令：`jary config print` 看最终 rows，`jary plugin doctor` 验证依赖闭合。

### 3.2 事件溯源：append-only events + replay

- `events` 表是唯一真相，`seq` 自增，写入即不可改；信封为 `{id, session_id, turn_id, type, actor_kind, actor_id, provenance, ts, data}`。
- 已写入的事件类型包括 `input.owner`、`turn.started`、`step.started`、`model.response`、`assistant.message`、`tool.call`、`tool.result`、`approval.requested`、`approval.resolved`、`memory.consolidated`、`error`、`turn.ended`；完整清单见 [事件](../reference/events.md)。
- 会话历史、回放、fork 都从同一份日志派生：`buildHistory` 只投影 `input.owner` / `assistant.message`，`jary session replay <id>` 逐条重放，fork 复制事件到新 session。
- 流式 token delta 是**瞬态**，只推送不落库；`sessions.status`、`usage`、`approvals`、`audit` 是记账/派生表，不是第二份事实。
- 修正靠追加新事件，不靠改历史。崩溃恢复 = 重开进程 + 回放事件，不重新执行工具副作用。

### 3.3 Agent 循环

```
输入 → 读 events 装配 history → 预算初始化
  → 每步：system（默认人设 + goal 段落 + 记忆摘要 + 技能目录）
          → 模型流式请求（记录 model.response）
  → 有 tool_calls：逐个过审批 seam → 执行 → 结果回填
  → 无 tool_calls：结束
  → turn.ended + usage + audit
```

- 预算默认 `maxSteps 8`、`maxToolCalls 20`、`maxWallMs 120s`，可被 Bot/请求覆盖；`maxCostUsd` 可选，按模型单价累计。
- 上下文窗口默认 128k，估算用量超 70% 触发压缩：较早消息交给模型摘要并替换，写 `memory.consolidated`。
- 工具调用：仅 `parallelSafe` 且无需审批的连续调用并行（上限 4），其余串行，结果按原顺序回填。
- 输出治理：超过 32KB 落 artifact 并返回指针；`web.*` / `mcp.*` / `bot.*` 输出包 `<untrusted>`，声明为数据而非指令。
- 取消：每个会话一个 `AbortController`，`/stop`、预算越界、墙钟超时、进程退出都走 abort，provider 与工具都接收 signal。

### 3.4 审批 seam

| 风险 | 例子 | 默认 |
|---|---|---|
| read | 读文件、搜索 | 允许 |
| write | 写工作区 | 允许 |
| network | web fetch | 允许（带 SSRF/大小限制） |
| execute | shell | **ask** |
| external | Bot 消息、页面分享、外部 API、发邮件（配置 SMTP 后） | **ask** |
| destructive | 卡信息填表（`vault.fill_card`） | **ask** |

- 规则引擎确定性优先：`deny > ask > allow`，匹配维度为工具 glob、风险等级、路径前缀；有效期 `once` / `session` / `always`。
- 决议顺序：deny 规则 → allow 规则 → 已有 grant → 风险是否需 ask → 交互审批通道 → 无通道即 **fail-closed**（默认拒绝）。
- 后台轮次（`provenance != owner`：例程、目标、worker）不等人：只有显式 allow 规则能预批，否则立即拒绝并记 `approval.resolved{reason:'background'}`。
- destructive 不预置任何 allow 规则，每次默认请求审批；owner 可显式授予 once / session。
- 每次请求/决定写 `approvals` 表与 `audit`；默认 30 分钟超时等于拒绝。

### 3.5 记忆

- 三层：工作记忆（事件 + 压缩摘要）、长期事实（`memories` 表 + FTS5 + 标签）、技能（`<home>/skills/*/SKILL.md`，目录注入 + `skill.load`）。
- 检索用 SQLite FTS5（`memories_fts`，`unicode61`）加自研 bigram 分词，中文无需外部分词器；不引入向量库。
- digest 每轮注入，上限 600 token：pinned 优先 + 查询命中，无命中不注入。
- 写入不依赖 LLM 逐条判断：规则候选池 → 整理任务去重/合并/同键覆盖；另有容量上限、衰减归档、TTL 与定时维护。
- 作用域仅 `global` 与 `bot:<id>`；单 owner，没有团队记忆。

### 3.6 云电脑

- 每 Bot 一台，后端 `local`（本机 Chrome）或 `docker`（容器，生产形态）；通过 CDP `:9222` 控制。
- 工具面：`browser.*`（goto / click / type / extract / screenshot）、`computer.*`（start / stop / snapshot / restore / exec / usage / restart）。
- 看屏三级递进：截图轮询 → CDP screencast → MJPEG（`/api/computer/mjpeg`，浏览器原生渲染），不做 WebRTC。
- 配额与隔离：空闲自动停机、单次 4h、每日 8h；容器默认 `--network none`、浏览器导航域名白名单、`no-new-privileges`。
- 快照覆盖 workspace 与浏览器 profile，可回滚；镜像由 `deploy/computer/Dockerfile` 提供（Xvfb + x11vnc + noVNC）。

## 4. 包结构

31 个包按用途分组；`packages/bundles/` 下 7 个 patch 只是组合数据，不是代码包。

| 分组 | 包 | 职责 |
|---|---|---|
| 内核 | `kernel` | Context 树、Effect/disposer、EventBus、Loader、插件声明 |
| 运行时 | `agent-core` `llm-deepseek` `store-sqlite` `testing` | 循环与装配、模型适配、事件存储、Fake Provider |
| 工具与执行 | `tools-fs` `tools-shell` `tools-web` `sandbox-docker` `mcp` `office` | 文件 / 命令 / 出网 / 沙箱 / MCP / Office 文档 |
| 内容与产物 | `artifacts` `pages` | 产物库、Pages（版本 / 分享 / 导出） |
| 协作与主动 | `bots` `tasks` `goals` `scheduler` `initiative` `memory` `notifications` `maintenance` | 名册/总线、任务板、目标、调度、提议与教学、记忆、通知、维护 |
| 信任 | `vault` `secrets` | 加密凭据与盲填、1Password/Bitwarden 读取 |
| 集成 | `connectors` `email` | 通用 HTTP 连接器、SMTP/IMAP |
| 接入与客户端 | `computer` `tunnel` `devices` `web` `cli` `plugin-host` | 云电脑、出网隧道、设备配对、Web/API、CLI、进程外宿主 |
| 组合 | `bundles/{base,deepseek,docker,docker-computer,email-imap,mcp,web-search}` | 默认组合与按需覆盖 |

## 5. 数据模型

28 张表按用途分组；所有表由各插件在启动时 `CREATE TABLE IF NOT EXISTS` 自建，schema 版本记录在 `schema_meta`。

| 分组 | 表 | 说明 |
|---|---|---|
| 核心与时序 | `schema_meta` `sessions` `events` | 版本、会话、append-only 事件（唯一真相） |
| 记账与审计 | `usage` `approvals` `audit` | 用量/费用、审批流水、操作审计 |
| 协作 | `bots` `bot_messages` `tasks` `goals` | 名册、Bot 间消息（hop ≤ 2）、任务板（CAS）、持久目标 |
| 记忆 | `memories` `memory_tags` `memory_candidates` `memory_runs` | 事实/偏好 + `memories_fts` 虚拟表、候选池、整理记录 |
| 主动 | `jobs` `job_runs` `initiative_proposals` `initiative_mutes` `notifications` | 例程、运行历史、提议、静音、通知中心 |
| 产物与页面 | `artifacts` `pages` `page_versions` | 产物元数据、页面、版本历史 |
| 凭据 | `vault_items` `vault_grants` `vault_events` `secure_forms` | 密文条目、Bot 授权、使用审计、一次性表单 |
| 客户端 | `devices` `device_pair_codes` | 设备与令牌、配对码（失败限次） |

## 6. 单进程与 4C4G 约束

- **单进程**：所有插件在同一进程内组合加载，没有 gateway / worker 拆分，也没有跨进程 JSON-RPC 传输。取消靠 `AbortController`，不靠杀进程；同一份 SQLite 只有一个写者。
- **服务进程之外的边界只有两个**：云电脑容器（Docker）与进程外插件宿主（`@jaryn/plugin-host` 子进程，NDJSON 代理工具调用）。
- **代价**：不能横向扩容；重启期间服务短暂不可用（事件可回放，不丢事实）；一个插件异常可能影响整个进程，所以第三方插件优先走进程外宿主。
- **资源画像**：1 Bot、每日 <50 轮的基准配置是 4C4G / 20GB；主要成本是模型 token 与内存，不是 CPU（见 [部署](../operations/deployment.md)）。
- **为省资源做的设计选择**：不用外部数据库、不用 Redis、不用向量库；工具并发上限 4；云电脑空闲自动停机与日配额；日志不落完整 prompt。
- **不采用的进程模型**：旧设计中"每 Bot 一个 worker 进程 + gateway"的拆分已废止，原因见 [决策](decisions.md)。

## 7. 扩展点

| 扩展点 | 机制 | 做法 |
|---|---|---|
| 换模型 | `provides: ['llm']`，实现 `Provider.stream` | 覆盖 `llm` 行（本地 vLLM/Ollama、其他云 API） |
| 加工具 | `inject: ['tools']`，`tools.register(tool)` 返回 disposer | npm 包 + 一行 patch；风险等级决定是否审批 |
| 换存储 | `provides: ['store']`，实现 `EventStore` 接口 | 替换 `store` 行；事件语义不变 |
| 换云电脑 | `computer` seam 的 backend | 当前 `local` / `docker`；新后端实现同一接口 |
| 接外部系统 | connectors 声明式 HTTP 工具；email 的 SMTP/IMAP | 配置即可，不发版 |
| 组合覆盖 | bundle / profile patch | `insert`、整行替换、`disabled` |
| 事件订阅 | `ctx.on('email/received', fn)` 等 | EventBus 支持 emit / parallel / serial / waterfall |
| 第三方插件 | `jary plugin add npm:｜git:｜file:`；权限声明 `jaryn.permissions` | 装进 profile，重启生效；`jary plugin permissions` 扫描高危声明 |
| 不可信插件 | `@jaryn/plugin-host` 子进程 + NDJSON（ready / call / result） | 工具注册经代理，进程外执行 |

内核 API（Context / Effect / Event / Loader / Plugin 声明）是稳定的公共边界；能力变化只应新增插件与 patch 行，不应改内核契约。CLI 命令目前集中在 `packages/cli`，尚未插件化。

相关文档：[核心概念](../concepts.md) · [插件指南](../guides/plugins.md) · [事件参考](../reference/events.md) · [决策与边界](decisions.md) · [能力审计](audit.md)
