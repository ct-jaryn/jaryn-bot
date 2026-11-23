# 01 · 功能规格（Functional Spec）

> 状态：**现行**（v0.1 基线；FR-15…FR-19 为后续版本能力，已标注版本）。需求来源：[00-prd.md](00-prd.md)。接口细节见 [02-interfaces.md](02-interfaces.md)，设计见 [runtime-design.md](runtime-design.md)。
> 约定：`FR-x` 功能编号；每条都写"目的 / 行为 / 边界与错误 / 验收"；验收必须可执行、可判定。

---

## FR-1 Bot 管理

**目的**：多 Bot 名册 = 多个数字同事，每个有自己的身份、工具、记忆、预算。

| 项 | 规格 |
|---|---|
| 创建 | `jary bot add <id> --preset <preset> --workspace <dir>`；同时创建 workspace 目录与记忆命名空间 |
| 编辑 | `jary bot edit <id> --preset ... --budget ...`；修改 persona 不重启进程，下一条消息生效 |
| 删除 | `jary bot remove <id>`：归档会话、保留 workspace（`--purge` 才删文件）；需二次确认 |
| 列表 | `jary bot list` 输出 id/名称/preset/状态/今日用量 |
| Bot 字段 | `id`（唯一）、`name`、`persona`、`preset`、`workspace`、`memory_scope`、`budget`、`enabled` |
| Bot 数量 | v0.1 上限 20 个（每 Bot 一个 worker 进程） |

**边界与错误**
- id 只允许 `[a-z0-9-]{2,32}`；重复 → `E_CONFIG`。
- workspace 必须为空目录或已属于该 Bot（防止误指到 `/`）→ 否则 `E_CONFIG` 并提示。
- 删除有活跃任务的 Bot → 先取消任务再删除。

**验收**：创建两个 Bot（researcher / writer），各自 `/status` 显示独立工具集与记忆域；禁用 `tools-shell` 后 researcher 的模型看不到 shell。

---

## FR-2 会话与消息

**目的**：一个会话 = 一条连续的、可回放的对话线。

| 项 | 规格 |
|---|---|
| 创建 | IM 里首次私聊自动建会话；`/new` 强制新会话 |
| 续聊 | 同一 IM 会话（chat/thread）默认续聊最近会话；`/resume <id>` 切换 |
| 标题 | 首条消息后异步生成（失败则用前 40 字符） |
| 归档 | `/archive` 或 30 天无消息自动归档（可配）；归档后只读 |
| 回放 | `jary session replay <id>` 从事件重建并打印；`export` 导出脱敏 JSONL |
| 删除 | `/delete`（owner）软删 + 30 天后物理清理 |
| 并发 | 同一会话同时只允许一个 turn；新消息排队（收到"排队中"提示） |

**边界与错误**
- 不存在的会话 id → `E_NOTFOUND`。
- 会话被另一进程占用（单写者）→ `E_SESSION_BUSY`，提示稍后重试。

**验收**：`kill -9` 后重启，`/resume` 能继续；`replay` 输出与原始事件一致。

---

## FR-3 IM 通知通道（非主界面）

**目的**：把结果与审批提醒推到手机；轻命令可用，但**主界面是 Web UI（FR-20）**。

| 项 | 规格 |
|---|---|
| 通道 | v0.1：Telegram、飞书（Lark）；插件化，每通道一个包 |
| 绑定 | `jary channel add telegram --token env:TELEGRAM_TOKEN`；`bind <chat> <bot>` |
| 身份 | 只接受 allowlist 用户；未知用户 → 礼貌拒绝并记 audit |
| 私聊 | 所有文本 → 当前 Bot 会话 |
| 群聊 | 仅 `@bot` 或被回复时响应；同一 thread 固定一个会话 |
| 流式 | 先发"思考中"占位消息；每 ≥1.2s 编辑一次；结束后终态消息 |
| 长消息 | 按平台上限拆分（Telegram 4096 / 飞书卡片限制） |
| 附件 | 图片/文件下载到 `workspace/inbox/`，登记 artifact；单文件 ≤ 20MB |
| 幂等 | 按平台 `update_id`/`event_id` 去重；重复投递不重复执行 |
| 限速 | 出站每聊天 ≤ 20 条/分钟；超限排队 |
| 失败 | 编辑失败降级为"只发最终消息"；通道断线自动重连（指数退避） |

**边界与错误**
- 平台不支持编辑（如飞书某些卡片）→ 自动降级。
- 收到不支持类型（语音/贴纸）→ 提示"暂不支持"，不消耗模型调用。

**验收**：手机发一句话，3 秒内看到"思考中"，随后逐段更新，最终一条完整回复；断网 1 分钟后恢复不丢消息。

---

## FR-4 Agent 运行

**目的**：一次 turn = 模型思考 + 工具执行，直到给出最终回答或被中止。

| 项 | 规格 |
|---|---|
| 输入 | 文本、图片（≤4 张）、文件引用；三者可组合 |
| 流式 | 文本/推理 delta 实时推送；工具调用以"步骤"形式展示（工具名 + 参数摘要） |
| 最大步数 | 默认 20 步/轮（可配 1–50）；超出以 `max-steps` 结束并说明 |
| 工具并行 | `parallelSafe` 工具并行 ≤4；其余串行 |
| 取消 | `/stop`、审批拒绝、预算超限、网关关闭 → abort；工具与子进程收到 signal |
| 超时 | 单步 5 分钟、单轮 30 分钟（可配）；超时 abort，10s 不退杀 worker |
| 重试 | 模型 429/5xx/网络 ≤3 次退避；幂等工具 ≤2 次；非幂等不重试 |
| 错误提示 | 面向用户的人话（"模型服务超时，已停止，本次消耗 X"），附错误码 |
| 预算 | 每轮检查 token/费用/步数/墙钟；超限写 `budget.exceeded` |

**边界与错误**
- 上下文超窗口 → 自动压缩（保留最近 6 轮原文 + 摘要），压缩失败则以 `E_CONTEXT` 结束。
- 模型不支持 tool-calling → 降级为文本协议解析（一次重试）。

**验收**：发"读 README 并总结"，可见 read 工具步骤；中途 `/stop` 在 2 秒内停止且会话可继续。

---

## FR-5 工具集

**目的**：模型能对世界产生真实作用，同时每个动作可审计、可控。

| 工具 | 行为 | 风险 | 默认 |
|---|---|---|---|
| `fs.read` / `list` / `search` | 读文件/列目录/正则搜索 | read | 允许 |
| `fs.write` / `edit` | 写/改文件（限 workspace） | write | 允许（workspace 内） |
| `shell.run` | 执行命令（argv 数组、cwd、超时、输出截断） | execute | **ask** |
| `web.search` | 搜索，返回答案 + 来源 | network | 允许 |
| `web.fetch` | 抓取页面为文本（SSRF 防护） | network | 允许 |
| `memory.remember/search/forget/list` | 记忆读写 | write | 允许 |
| `skill.list/load` | 技能目录/加载 | read | 允许 |
| `task.create/claim/complete/list` | 任务板 | write | 允许 |
| `bot.send_message/list_agents/spawn_worker` | Bot 协作 | external | **ask** |
| `schedule.create/list/cancel` | 定时任务 | write | 允许 |
| `artifact.save/present` | 产物登记/发送 | write | 允许 |
| `ask_user` | 向用户提问（阻塞等回答） | external | 允许 |
| `mcp.<server>.<tool>` | 外部 MCP 工具 | external | **ask** |

**输出治理**：>32KB 截断并落盘给路径；>1MB 拒绝；二进制转 artifact。
**错误**：工具错误以结构化结果返回模型（`{ok:false, code, message}`），不打断循环；fatal 才中止。

**验收**：模型尝试 `shell.run` 时出现审批卡；拒绝后模型收到 `not-approved` 并改用只读工具完成。

---

## FR-6 审批与权限

**目的**：危险动作必须有人类授权，且授权语义清晰（只有用户消息算指令）。

| 项 | 规格 |
|---|---|
| 风险等级 | read / write / network / execute / external / destructive |
| 默认策略 | 见 FR-5；`destructive` 默认 deny（除非显式规则） |
| 规则 | 按工具/风险/来源/Bot/路径匹配；`deny > ask > allow`；用户规则优先 |
| 授权范围 | once（一次）/ thread（本 thread）/ session（本会话）/ always（仅 owner 可建） |
| 审批卡 | 显示工具名、参数摘要（敏感值脱敏）、影响路径、[同意一次][本会话允许][拒绝] |
| 超时 | 前台 30 分钟；后台任务 0 容忍（超时=拒绝） |
| 信任边界 | 只有 `owner` 来源的输入能授权 external/execute/destructive；bot/web 来源只能触发 read/write |
| 审计 | 每次请求与决定写 `approvals` + `audit`，`/approvals` 可查 |
| 自动审查（v0.5） | 独立审查模型在工具执行前评估；拒绝转人工；审查模型不能放宽规则 |

**验收**：`bot.send_message` 触发审批，拒绝后动作不执行；后台任务里的 shell 直接 deny 并记录原因。

---

## FR-7 记忆

**目的**：跨会话记住人、偏好、规则、历史，且用户可查、可改、可删。

| 层 | 规格 |
|---|---|
| 长期事实 | `memories` 表：kind=fact/preference/rule/event；scope=global/bot/team；带来源与置信度 |
| Digest | 每轮注入 ≤2K token：pinned + 最近高置信 + 与当前对话 FTS 相关 |
| 写入 | 模型调用 `memory.remember`；或每晚整理任务从当天事件提炼 |
| 整理 | 每天 03:00（可配）跑 consolidation：去重/合并/降权/更新 `MEMORY.md` |
| 查看 | `/memory` 列出当前 Bot 记得什么；`/memory global` 查看全局事实 |
| 遗忘 | `/forget <关键词>` 删除匹配记忆并记审计；`/forget all` 需二次确认 |
| 作用域 | 跨 Bot 不默认共享；`team` 域需显式写入 |

**边界与错误**
- 单条记忆 ≤ 1000 字符；超长拆分。
- 密钥/密码类内容拒绝写入（正则 + 用户确认）。

**验收**：告诉它"周报用中文、结论先行"，`/new` 后仍生效；`/forget 周报` 后不再生效。

---

## FR-8 多 Bot 协作（单 owner）

**目的**：一个 Bot 能带几个专才；多个 Bot 能像同事一样递活（分阶段）。

| 能力 | v0.1（L1） | v0.5（L2） |
|---|---|---|
| 子 Bot | `spawn_worker(role, task)`：子会话独立、工具子集、继承预算 | 同 |
| 任务板 | `task.create/claim/complete/list`，CAS 认领 | 同 |
| 消息 | `send_message(agent, text)` 给子 Bot | 跨 Bot 总线：`ask/inform/handoff` |
| 防环路 | — | hop≤2、同 thread≤20 条、pair≤6 条/分钟、内容哈希去重、唤醒预算 |
| 信任 | bot 消息视为**数据**，不能授权 external 类动作 | 同 |

**验收（v0.1）**：让它"研究三家竞品并写对比"，root 拆 3 个子任务，worker 并行搜集，root 汇总成文件；全程任务板可见。

**边界**：v0.1 只做单 owner；**不做多人共享 Bot、人类群聊、团队记忆审核**（见 [11](11-parity-and-beyond.md) §4）。

---

## FR-9 主动任务

**目的**：不在线时也干活；但不打扰、不失控。

| 项 | 规格 |
|---|---|
| 创建 | `/job add <name> --cron "0 8 * * *" --tz Asia/Shanghai --bot jaryn "<任务>"`；或 `jary job add` |
| 触发 | cron（5 字段）、every（秒）、webhook（HMAC）、RSS（轮询新条目） |
| 执行 | 新建/复用任务会话；需要多轮时自动建 goal（max_rounds ≤20） |
| 预算 | 每 job 独立：token/费用/墙钟/轮数；超限停止并汇报"被预算截断" |
| 投递 | 结果推到指定 IM 会话；安静时段只进摘要 |
| 历史 | `job runs` 显示每次运行的状态/耗时/花费/摘要 |
| 熔断 | `jary stop-all` 中止所有 worker；`/job disable` 暂停单个 |
| 噪音 | 只发"有结论/有异常"的摘要，不发过程；可一键静音 |

**验收**：创建"每天 8 点简报"，次日 8 点收到带来源的简报；把预算设为 0.05 美元后，超限自动停止并说明。

---

## FR-10 产物与交付

| 项 | 规格 |
|---|---|
| 保存 | 产物写入 `workspace/outbox/`，登记 `artifacts` 表 |
| 交付 | 完成时自动附产物（图片直接发，文件发链接/附件） |
| 格式 | md/txt/json/csv/图片；office（docx/xlsx/pptx）通过 office 插件 |
| 大小 | 单文件 ≤ 20MB；超出提示"已保存到服务器，路径 X" |
| 预览 | IM 内给链接/缩略图；无 Web UI 时给服务器路径 |
| 清理 | 产物保留 30 天（可配），`/artifacts` 可查可删 |

**验收**：让它写一份对比报告，收到 `.md` 文件；让它做 PPT，收到 `.pptx`（office 插件已装）。

---

## FR-11 命令

| 命令 | 作用 | 权限 |
|---|---|---|
| `/new` | 开新会话 | 所有人 |
| `/resume <id>` | 恢复会话 | 所有人 |
| `/archive` | 归档当前会话（只读） | owner |
| `/delete` | 软删当前会话（30 天后清理） | owner |
| `/stop` | 中止当前 turn | 所有人 |
| `/status` | Bot/会话/预算/队列状态 | 所有人 |
| `/memory` `/forget` | 查看/删除记忆 | owner |
| `/remember <文本>` | 直接写记忆 | owner |
| `/approve` `/deny` | 审批（备用，主用按钮） | owner |
| `/bot list` `/bot new` | 名册 | owner |
| `/job list` `/job run <id>` | 主动任务 | owner |
| `/artifacts` | 产物列表 | owner |
| `/help` | 命令帮助 | 所有人 |

**验收**：每条命令返回结构化结果或明确错误；未知命令不消耗模型调用。

---

## FR-12 运维命令

| 命令 | 作用 |
|---|---|
| `jary init` | 初始化 `$JARY_HOME`、默认 profile、示例配置 |
| `jary doctor` | 检查配置/DB/通道/模型/预算/插件版本 |
| `jary config print [--profile]` | 打印最终组合（可 diff） |
| `jary session replay <id>` | 从事件回放 |
| `jary session export <id>` | 导出脱敏 JSONL |
| `jary stop-all` | 熔断：中止所有 worker |
| `jary version` | 版本与构建信息 |

**验收**：`jary doctor` 能在 10 秒内给出通过/失败与修复建议。

---

## FR-13 插件管理

| 项 | 规格 |
|---|---|
| 安装 | `jary plugin add npm:@jaryn/plugin-x@1.2.3` / `git:` / `file:` |
| 启用/禁用 | `jary plugin enable/disable <id>` → 写 profile patch |
| 列表 | 显示已装、版本、来源、权限声明、兼容性 |
| 索引 | `jary plugin index add <url>`；`search`；索引是第三方内容需提示 |
| 信任 | 高危权限（`process` / `network:*` / `secrets`）安装需 `--trust` |
| 生效 | v0.1 需重启；`--dev` 支持配置热重载 |
| 诊断 | `jary plugin doctor` 检查版本、权限、加载错误 |

**验收**：装一个工具插件后模型能看到；禁用后立刻看不到；权限超限安装被拒。

---

## FR-14 客户端接入（v0.1 Web；v0.2 桌面/手机）

**目的**：一处私有化服务端，多处客户端连上来用。**v0.1 先交付 Web UI**（服务端自带静态资源 + WS），v0.2 加桌面/手机客户端与多设备同步。

| 项 | 规格 |
|---|---|
| 配对 | owner 生成一次性配对码（10 分钟、限 3 次）→ 客户端 `POST /api/pair` 换设备令牌 |
| 会话 | 客户端列出可见 Bot/会话；订阅事件流；发消息带 `clientMsgId` 幂等 |
| 流式 | 通过 WS 接收 `stream` 增量；断线重连后取当前 turn 快照，不重放 delta |
| 审批 | 客户端审批卡与 IM 按钮等价；先响应者生效，重复响应幂等 |
| 产物 | REST 上传/下载文件与产物；单文件 ≤ 20MB |
| 多端 | 任意设备可发消息（按会话排队）；所有订阅设备收同一事件流；显示在线状态 |
| 离线 | 断线重连带 `lastSeq` 补齐；过旧则快照 + 从快照 seq 开始 |
| 撤销 | owner 可列出/踢出设备；撤销后令牌立即失效 |

**边界与错误**：配对码错误/过期 → `E_AUTH`；令牌撤销 → `E_AUTH`；协议版本不匹配 → `E_PROTOCOL`（拒绝并提示升级）。
**验收（v0.1）**：浏览器打开 Web UI，能对话/审批/下载产物；刷新后会话与流式状态不丢。**验收（v0.2）**：桌面 + 手机 + Web 三端同一会话；断线补齐。
详细协议见 [06-clients-and-topology.md](06-clients-and-topology.md)。

---

## FR-15 云电脑（v0.4）

**目的**：Bot 有自己的 Linux 电脑，能开浏览器/点桌面/敲终端，人能看屏接管。

| 项 | 规格 |
|---|---|
| 生命周期 | 首次使用创建；空闲 15 分钟休眠；单次运行 >4h 强制快照停止；`reset` 需审批 |
| 浏览器 | Chromium + Playwright；登录态持久；截图回传模型 |
| 桌面 | Xvfb + VNC/WebRTC 串流；鼠标/键盘/文本输入 |
| 接管 | Bot 暂停 → 客户端全屏控制 → 交还后继续；需 owner 确认 |
| 快照 | 任务级快照（workspace+home+profile）；恢复/回滚 |
| 隔离 | 每 Bot 独立容器/网络；无宿主挂载；跨 Bot 不可读 |
| 网络 | 默认 NAT 出网；禁止私网/元数据 IP；可选本机出网 |
| 成本 | CPU/内存/磁盘配额；储能休眠；预算超限停止 |

**验收**：见 [07](07-cloud-computer.md) §10。

## FR-16 Vault 与凭据（v0.5）

**目的**：模型永远看不到密码，但能"用"密码登录/填表。

| 项 | 规格 |
|---|---|
| 存储 | 加密 DB；write-only；列表只返回元数据 |
| 填充 | `vault.fill(itemId)` → 服务端校验 origin/授权/审批 → 浏览器内代理直接填 DOM；模型只见"已填写" |
| 安全表单 | 无凭据时发一次性表单，用户输入 → 直传 Vault → 自动填充 |
| 1Password | 通过官方 CLI 实时取，需用户在 1Password 批准 |
| 支付 | 默认关闭；开启后每次支付审批；默认不存 CVV |
| 审计 | 记录 view/fill/payment/rotate/revoke（不含值） |

**验收**：见 [08](08-vault-and-credentials.md) §10。

## FR-17 连接器与邮箱（v0.3）

| 项 | 规格 |
|---|---|
| 连接 | OAuth（PKCE）或 API Key；token 入 Vault；按 Bot 授权 |
| 工具 | `gmail.search/send`、`calendar.create`、`github.issues`…；send 类默认 ask |
| 撤销 | 删连接 → token 失效、工具消失 |
| 邮箱 | 自有域名/IMAP；入站 allowlist；出站 SMTP；附件转 artifact |
| MCP | 任意 MCP server 作为兜底扩展 |

**验收**：见 [09](09-connectors-and-artifacts.md) §6。

## FR-18 Pages 与产物增强（v0.3）

| 项 | 规格 |
|---|---|
| Pages | 自包含 HTML 包；客户端 iframe sandbox 渲染；默认私有；可分享（token/过期/可撤销）；可导出离线 HTML |
| 产物 | docx/xlsx/pptx/图/下载文件；≤20MB；30 天保留；缩略图预览 |
| 安全 | CSP 加固；禁用外联与存储；可选 ClamAV |

**验收**：生成看板并打开；恶意 HTML 被拦；导出可离线看。

## FR-19 Initiative 与 Teach-a-task（v1.0）

| 项 | 规格 |
|---|---|
| 信号 | 日历临近/未读重要邮件/连接器失效/任务失败/任务板停滞/目标进度 |
| 提议 | 打分 ≥0.6；每 Bot 每天 ≤3 条；去重 24h；带"为什么"；可"别再推" |
| 接受 | 点"做"→ 生成任务执行；**提议不是授权**，风险动作仍审批 |
| 教学 | 录制/手写 → 草稿 → 沙箱试跑 → 审阅 → 保存为技能；密码/卡不记录 |
| 通知 | 安静时段进摘要；失败/安全类立即推 |

**验收**：见 [10](10-proactive-and-initiative.md) §8。

---

## 错误码

| 码 | 含义 | 用户可见文案 |
|---|---|---|
| `E_CONFIG` | 配置非法 | "配置有误：<字段> <原因>（文件:行）" |
| `E_AUTH` | 未授权/非 allowlist | "你没有权限执行这个操作" |
| `E_CHANNEL` | 通道错误（限速/断线） | "消息通道暂时不可用，已重试 N 次" |
| `E_MODEL` | 模型错误（超时/限流/内容拒绝） | "模型服务出错：<原因>" |
| `E_TOOL` | 工具执行失败 | "工具 <name> 失败：<原因>" |
| `E_APPROVAL` | 审批拒绝/超时 | "操作未获批准：<工具>" |
| `E_BUDGET` | 预算超限 | "本次任务超出预算（<原因>），已停止" |
| `E_STORE` | 存储/DB 错误 | "数据存储异常，已记录" |
| `E_PLUGIN` | 插件加载/兼容错误 | "插件 <id> 启动失败：<原因>" |
| `E_RATE` | 速率限制 | "操作太频繁，请稍后" |
| `E_CANCEL` | 已取消 | "已停止" |
| `E_TIMEOUT` | 超时 | "超时（<阶段>）" |
| `E_INTERNAL` | 兜底 | "内部错误：<id>（已记录日志）" |

---

## 状态机

```
Session:  idle ──turn.start──► running ──turn.end──► idle
             └─archive──► archived（只读）

Turn:     started ─► streaming ─► tool_wait ─► streaming ─► completed
              └────────────► aborted | error | budget | max-steps

Approval: pending ─► allowed | denied | expired | cancelled

Job:      scheduled ─► due ─► running ─► done | failed | skipped | budget-cut
```

---

## 范围外

- **v0.1 不做**：云电脑、Vault、连接器、Pages、桌面/手机客户端、Initiative（随 v0.2–v1.0 交付；v0.1 含 Web UI）。
- **全版本不做**：团队协作（多人/共享 Bot/群聊）、会议、企业管控（SSO/SCIM/网络策略/组织 API）、语音、SaaS/多租户/计费。见 [11](11-parity-and-beyond.md) §4。
