# 02 · 接口规格（Interfaces）

> 状态：**现行**（v0.1）。功能行为见 [01-functional-spec.md](01-functional-spec.md)；数据结构见 [runtime-design.md](runtime-design.md) §4–§5；插件 manifest 见 [plugin-architecture.md](plugin-architecture.md) §3。
> 原则：**对外接口版本化**；worker 协议语言中立（JSON-RPC 2.0 over stdio）；CLI 与配置文件是长期契约。

---

## 1. CLI 命令

`jary <command>`。所有命令支持 `--home <dir>`（默认 `$JARY_HOME`）、`--config <file>`、`--json`。

| 命令 | 参数/选项 | 作用 | 退出码 |
|---|---|---|---|
| `init` | `--profile server` | 初始化 home、profile、示例配置 | 0 |
| `chat` | `--bot <id> "消息"` / 无参进 REPL | 本地对话（开发/验收用） | 0 |
| `bot add` | `--preset <name> --workspace <dir>` | 创建 Bot | 0/2 |
| `bot list` / `bot edit` / `bot remove` | `<id> [--purge]` | 名册管理 | 0 |
| `channel add` | `<id> --token env:VAR` | 添加通道 | 0 |
| `channel bind` | `--chat <id> --bot <id>` | 绑定会话 | 0 |
| `job add` | `--bot <id> --cron "..." --tz <tz> --delivery <addr> "<mission>"` | 创建主动任务 | 0 |
| `job list` / `job run` / `job enable` / `job disable` / `job runs` | `<id>` | 任务管理 | 0 |
| `session list` / `replay` / `export` / `delete` | `<id>` | 会话运维 | 0 |
| `config print` | `--profile <name>` | 打印最终插件组合（YAML） | 0 |
| `config validate` | — | 校验配置，错误带文件:行 | 0/2 |
| `plugin add` / `remove` / `enable` / `disable` / `list` | `<spec>` | 插件管理 | 0 |
| `plugin index add` / `search` | `<url>` / `<q>` | 插件索引 | 0 |
| `plugin doctor` | — | 插件诊断 | 0/1 |
| `doctor` | — | 全量健康检查 | 0/1 |
| `stop-all` | — | 熔断：中止所有 worker | 0 |
| `version` | — | 版本/构建信息 | 0 |

**退出码**：`0` 成功；`1` 运行时失败；`2` 参数/配置错误。

---

## 2. 配置文件 `jary.toml`

路径：`$JARY_HOME/jary.toml`（可用 `--config` 覆盖）。所有字段有默认值；`env:VAR` 表示从环境变量读取。

```toml
[server]
bind = "127.0.0.1:8787"          # HTTP（webhook/health/metrics）
public_url = "https://bot.example.com"   # 反代时用于生成外链
data_dir = "/data"

[models.default]
provider = "deepseek"            # 插件 id：deepseek/openai/anthropic
model = "deepseek-v4-flash"
api_key = "env:DEEPSEEK_API_KEY"
# base_url = "https://api.deepseek.com/v1"   # 可选；指向内网 vLLM/Ollama/私有云端点
context_tokens = 128000

[budgets]
default = { max_steps = 20, max_cost_usd = 0.20, max_wall_ms = 1_800_000, max_tool_calls = 80 }
[budgets.background]             # 主动任务的默认预算
default = { max_steps = 12, max_cost_usd = 0.10, max_wall_ms = 1_200_000 }

[memory]
digest_tokens = 2000
consolidation_cron = "0 3 * * *"
retention_days = 180

# [channels.telegram]          # 暂不做（IM 通知通道暂缓）；启用时再打开
# token = "env:TELEGRAM_TOKEN"
# allowed_users = ["123456789"]

[bots.jaryn]
preset = "jaryn"
workspace = "/data/bots/jaryn"
memory_scope = "bot:jaryn"

[jobs.daily-briefing]
bot = "jaryn"
trigger = { kind = "cron", expr = "0 8 * * *", tz = "Asia/Shanghai" }
mission = "按 MEMORY.md 的偏好，生成今日 AI 行业简报（≤400 字，带来源）"
delivery = { channel = "telegram", chat_id = "123456789" }
budget = { max_steps = 10, max_cost_usd = 0.08 }
```

**校验规则**：未知字段报错（避免拼写错误静默）；必填缺失报错；错误信息格式 `E_CONFIG <file>:<line> <field>: <reason>`。

---

## 3. 环境变量

| 变量 | 用途 |
|---|---|
| `JARY_HOME` | 数据根（默认 `~/.jary`） |
| `JARY_CONFIG` | 配置文件路径 |
| `JARY_PROFILE` | 启动 profile（`server`/`worker`/`cli`/`minimal`） |
| `DEEPSEEK_API_KEY` | 模型密钥（`env:` 引用） |
| `TELEGRAM_TOKEN` / `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | **暂不需要**（IM 通知通道暂不做） |
| `JARY_LOG_LEVEL` | `debug`/`info`/`warn`/`error` |
| `JARY_OTEL_ENDPOINT` | 可选，OTLP 导出 |

密钥只从环境或文件读取；**不允许**写在 `jary.toml` 明文里（`env:` 引用除外）。

---

## 4. Worker 协议（JSON-RPC 2.0 / stdio）

传输：父进程（gateway）`spawn` 子进程 `jary worker --bot <id>`，stdout 只走协议帧（每行一个 JSON），stderr 归日志。

### 4.1 Gateway → Worker（请求）

| 方法 | 参数 | 返回 |
|---|---|---|
| `handshake` | `{ protocolVersion: 1, botId, profile, home }` | `{ ok: true, workerVersion, pid }` |
| `session.open` | `{ sessionId, cwd, preset, origin? }` | `{ ok: true, resumed: boolean }` |
| `turn.start` | `{ sessionId, turnId, input: { blocks: ContentBlock[], provenance, actor } }` | `{ accepted: true }`（回执，不等于完成） |
| `turn.cancel` | `{ sessionId, turnId, reason }` | `{ ok: true }` |
| `session.close` | `{ sessionId }` | `{ ok: true }` |
| `health` | `{}` | `{ ok, sessions, rssBytes, uptimeMs }` |
| `shutdown` | `{ drainMs }` | `{ ok: true }` |

### 4.2 Worker → Gateway（反向请求）

| 方法 | 参数 | 返回 |
|---|---|---|
| `approval.request` | `{ sessionId, turnId, toolCallId, tool, args, risk, provenance }` | `{ decision: "allowed"｜"denied"｜"cancelled", scope: "once"｜"thread"｜"session" }` |
| `notify` | `{ sessionId, text, level }` | `{ ok: true }` |

### 4.3 Worker → Gateway（通知）

| 通知 | 载荷 | 说明 |
|---|---|---|
| `event` | `{ event: RuntimeEvent }` | 持久事件镜像，gateway 落库并广播 |
| `stream` | `{ sessionId, turnId, delta }` | 瞬态流式增量，不落库 |
| `status` | `{ sessionId, status }` | `running`/`idle`/`error` |
| `log` | `{ level, msg, fields }` | 结构化日志 |

### 4.4 错误与生命周期

- JSON-RPC 错误码沿用标准（`-32601` 方法不存在、`-32603` 内部错误）+ `data.code` 用功能错误码（见 [01](01-functional-spec.md#错误码)）。
- 版本不匹配 → `handshake` 返回 `E_PROTOCOL`，gateway 拒绝启动并提示升级。
- worker 崩溃：gateway 记录 `aborted`，踢掉该进程，下条消息时重启并 `session.open` 恢复。
- 空闲回收：30 分钟无活跃会话 → 优雅 `shutdown`，会话已持久化，下次冷启动。

---

## 5. 事件

两类，命名约定：**持久会话事件用 `a.b`**，**live/能力事件用 `a/b`**（详见 [runtime-design.md](runtime-design.md) §5）。

### 5.1 持久事件（写 `events` 表）

`session.created` `session.archived` `input.owner` `input.bot` `input.system` `turn.started` `turn.ended` `step.started` `step.ended` `model.request` `model.response` `tool.call` `tool.result` `approval.requested` `approval.resolved` `goal.updated` `memory.written` `memory.consolidated` `task.created` `task.updated` `bot.message.queued` `bot.message.delivered` `artifact.created` `budget.exceeded` `error`

### 5.2 live / 能力事件（只在进程内或网关内）

`agent/pre-step` `agent/request` `agent/stream` `agent/turn-stopping` `tools/pre-execute` `tools/post-execute` `fs/before-write` `memory/before-write` `llm/stream` `channel/inbound`

### 5.3 事件信封

```ts
interface RuntimeEvent<T = unknown> {
  seq: number; id: string; sessionId: string; turnId?: string;
  type: string; ts: number;
  actor: { kind: 'owner' | 'bot' | 'system' | 'worker'; id: string };
  provenance: 'owner' | 'bot' | 'web' | 'system';
  data: T;
}
```

---

## 6. HTTP 端点

| 方法/路径 | 用途 | 鉴权 |
|---|---|---|
| `GET /healthz` | 存活/依赖检查（DB、通道、worker 数） | 无（仅 bind 地址可达） |
| `GET /metrics` | Prometheus 文本指标 | 可选 token |
| `POST /hooks/:jobId` | 外部事件触发 job；`X-Jary-Signature: hmac-sha256` | HMAC |
| `POST /webhook/telegram` | **暂不做**（IM 通知通道暂缓） | — |
| `POST /webhook/feishu` | 飞书事件回调 | 签名校验 |
| `POST /approvals/:id` | 可选：外部审批（IM 按钮之外） | owner token |

**约定**：所有 POST 幂等键 `X-Idempotency-Key`（可选）；错误返回 `{ code, message }` 且 HTTP 状态与语义一致。

---

## 7. 数据与迁移

- 数据库：`$JARY_HOME/jary.db`（SQLite WAL）。表结构见 [runtime-design.md](runtime-design.md) §4。
- 迁移：`schema_migrations(version, applied_at)`；**只前进**；启动时比较版本：
  - 低于当前 → 自动迁移（先备份 `.bak`）；
  - 高于当前 → 拒绝启动并提示升级程序。
- 备份：`jary` 无内置备份命令时，文档要求 `sqlite3 .backup` + workspace rsync（见 [05](05-deployment-ops.md)）。
- 单写者：同一 session 只允许一个进程写；跨进程用文件锁 + DB 事务。

---

## 8. 插件与组合接口

- 插件包 manifest、bundle/profile/patch 格式：见 [plugin-architecture.md](plugin-architecture.md) §3。
- 插件能力声明：`jaryn.permissions`（`fs`/`network`/`process`/`secrets`）。
- 兼容性：`engines.jary` 语义化版本范围；不满足 → `E_PLUGIN` 拒绝安装。
- 内核 API：`ctx` 四原语（Context/Effect/Event/Loader）v1 冻结；破坏性变更升大版本并附 codemod。

---

## 9. 版本与兼容策略

| 接口 | 版本 | 兼容承诺 |
|---|---|---|
| Worker 协议 | `protocolVersion: 1` | 同大版本内向后兼容；新增可选字段 |
| 内核 API | v1 | 大版本内稳定 |
| 配置格式 | v1 | 新增字段可选；删除字段走迁移 |
| 数据库 schema | v1 起按 migration | 只前进，自动迁移 |
| 事件流 | v1 | 只增类型，不改既有语义 |
| 客户端协议 | `/ws/client` v1（v0.1 Web；客户端待定包） | 见 [06-clients-and-topology.md](06-clients-and-topology.md) |

**升级流程**：停服务 → 备份 → 换二进制/镜像 → 启动（自动迁移）→ `jary doctor` → 失败则回滚镜像与 DB 备份。

---

## 10. 客户端 API（v0.1 Web；桌面/手机=待定包）

控制端通过 `WSS /ws/client`（JSON-RPC）接入，执行端通过 `WSS /ws/node` 接入；文件走 REST。方法表、同步语义、配对与安全模型见 [06-clients-and-topology.md](06-clients-and-topology.md) §3–§4。

- **v0.1**：服务端提供 Web UI 静态资源（`GET /`、`/assets/*`）+ `/ws/client`；Web 端同源 cookie/令牌鉴权（单 owner）。
- **待定包（暂缓）**：设备配对、桌面/手机客户端、多端同步。
- **IM 通知**：暂不做，不配置任何通道凭据。

---

## 11. 后续子系统接口（待定包）

| 子系统 | 接口 | 版本 | 详见 |
|---|---|---|---|
| 云电脑 | `computer.start/stop/status/snapshot/restore`；WS `screen.subscribe` / `input.send` / `takeover.request / release`；工具 `browser.*` `desktop.*` | v0.2 | [07](07-cloud-computer.md) |
| Vault | `vault.add/list/fill/grant/revoke/rotate`；`POST /api/vault/secure-form`；工具 `vault.fill` `vault.secure_form` | 待定包 | [08](08-vault-and-credentials.md) |
| 连接器 | `GET/POST /api/connectors`；`GET /api/oauth/callback/:id`；工具 `gmail.*` `calendar.*` `github.*` | 待定包 | [09](09-connectors-and-artifacts.md) |
| 邮箱 | `POST /api/email/inbound`（或 IMAP 轮询）；SMTP 出站 | 待定包 | [09](09-connectors-and-artifacts.md) |
| Pages | `POST /api/pages` `GET /api/pages/:id` `POST /api/pages/:id/share` | 待定包 | [09](09-connectors-and-artifacts.md) |
| Initiative | `GET /api/initiative/proposals`；`POST /api/initiative/:id/accept / dismiss / mute` | 待定包 | [10](10-proactive-and-initiative.md) |

> 以上除**云电脑**（v0.2，下一阶段）外，其余子系统均**待定包，暂缓未排期**；接口保留作设计。
