# 事件参考

> 适用版本：v1.11.0 · 状态：现行
> 事件信封、持久化与回放、常见事件类型、订阅方式；以 `packages/store-sqlite/src/index.ts` 与 `packages/agent-core/src/loop.ts` 为准。

## 1. 事件信封

会话状态是 **append-only 事件流**：一次 turn 的输入、模型输出、工具调用/结果、审批请求/决定、结束原因都写成一条事件。存储层写入并返回的字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `seq` | number | SQLite 自增主键；全库递增，不按会话重置 |
| `id` | string | `evt_<uuid>`，全局唯一 |
| `sessionId` | string | 所属会话 |
| `turnId` | string? | 所属 turn（系统/邮件等事件可为空） |
| `type` | string | 事件类型，见 §3 |
| `actorKind` | string | `owner`、`worker`、`system`；`append` 默认 `system` |
| `actorId` | string? | 操作者 id（可选） |
| `provenance` | string | 来源：`owner`、`web`、`system` 等；默认 `system` |
| `ts` | number | 写入时间（`Date.now()` 毫秒） |
| `data` | JSON | 事件载荷；存储为 JSON 字符串，读取时解析 |

> 早期接口文档中的 `actor: { kind, id }` 对象字段与旧信封形状已不再使用；以本表和 `StoredEvent` 类型为准。

## 2. 持久化与回放

```sql
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  type TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  provenance TEXT NOT NULL,
  ts INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session ON events(session_id, seq);
```

- 写入：`store.append({ sessionId, type, turnId, actorKind, actorId, provenance, data })` 插入一行，并把 `sessions.updated_at` 更新为当前时间；事件只增不改。
- 读取：`store.events(sessionId, fromSeq)` 按 `seq` 升序返回；`store.replay(sessionId)` 等价于全量读取。HTTP 对应 `GET /api/events?sessionId=&fromSeq=`。
- 重建：新一轮 turn 用事件重建模型历史，只取 `input.owner` 与 `assistant.message` 两种类型（`buildHistory`）；其余事件不进入模型上下文。
- 分叉：`POST /api/sessions/:id/fork` 把源会话事件复制到新会话（可 `upToSeq`），复制出的事件会获得新的 `seq`。
- 导出：`jary session export <id>` 输出 JSONL，默认按字段名脱敏 token/password/secret 等；`JARY_EXPORT_RAW=1` 时原样导出。`jary session replay` 逐行打印 `seq/type/data`。
- 删除：`jary session delete <id> --yes` 与 `DELETE /api/sessions/:id` 会删除该会话的事件行。
- 保留：当前代码没有事件 TTL 或自动清理；`maintenance` 只归档长期不活跃的会话，不删事件。
- 体量：`tool.result` 持久化的是工具原始返回值（可能很大）；超出 32KB 时仅模型上下文会落 artifact，事件本身仍保存完整输出。
- 审计是另一张表（`audit`，`jary audit` 查看），记录 `bot.added`、`job.added`、`turn.ended`、`rule.added`、`oauth.connected` 等管理/生命周期动作，不与会话事件混用。

## 3. 常见事件类型

| 类型 | 产生方 | `data` 要点 | 含义 |
|---|---|---|---|
| `input.owner` | agent loop | `{ text, provenance }` | 一次 turn 的输入（用户消息或其它来源） |
| `input.email` | IMAP 插件、`POST /api/email/inbound` | 邮件对象：`from`、`subject`、`text` 等 | 入站邮件作为输入写入会话 `email` |
| `turn.started` | agent loop | `{ turnId }` | turn 开始 |
| `step.started` | agent loop | `{ step }` | 第 N 步开始；当前没有 `step.ended` |
| `model.response` | agent loop | `{ text, calls, provider }` | 模型一次完整响应（含工具调用请求） |
| `assistant.message` | agent loop | `{ text }` | 面向用户的助手文本 |
| `tool.call` | agent loop | `{ id, name, args }` | 模型请求调用工具 |
| `tool.result` | agent loop | 成功 `{ id, name, ok: true, output }`；失败 `{ id, name, ok: false, error }` | 工具执行结果 |
| `approval.requested` | agent loop | `{ id, sessionId, turnId, toolName, risk, args, background? }` | 请求审批；后台 turn 带 `background: true` |
| `approval.resolved` | agent loop | `{ id, decision }`；后台拒绝附带 `reason: "background"` | 审批结果（`allowed` 或 `denied`） |
| `memory.consolidated` | agent loop | `{ kind: "compaction", summary, dropped }` | 上下文超阈值时压缩历史 |
| `error` | agent loop | `{ message }` | turn 内异常 |
| `turn.ended` | agent loop（finally） | `{ turnId, reason, steps, toolCalls, ms }` | turn 结束；`reason` 为 `completed`、`aborted`、`error`、`budget`、`max-steps`、`max-tool-calls` |

以下类型在早期文档中出现、但当前代码没有 `store.append`：`session.created`、`session.archived`、`input.bot`、`input.system`、`step.ended`、`model.request`、`goal.updated`、`memory.written`、`task.created`、`bot.message.queued`、`bot.message.delivered`、`artifact.created`、`budget.exceeded`。需要这些语义时请以对应服务的数据库表（tasks、goals、bot_messages 等）为准。

## 4. 进程内 live 事件

与持久事件分开：`ctx.emit(type, payload)` 走内核 EventBus，不落库、不镜像到 HTTP；订阅方是进程内插件（例如 notifications 订阅 `job/finished`、`initiative/proposal`、`email/received`）。

| 事件 | 产生方 |
|---|---|
| `worker/spawned`、`worker/finished` | bots（派子 Bot） |
| `job/finished`、`rss/error` | scheduler |
| `email/received`、`email/rejected`、`email/error`、`email/attachment-error` | email/imap |
| `initiative/proposal` | initiative |
| `mcp/connected`、`mcp/error` | mcp |
| `plugin-host/ready`、`plugin-host/error` | plugin-host |
| `sandbox/unavailable` | sandbox-docker |

## 5. 订阅方式

| 方式 | 位置 | 收到什么 |
|---|---|---|
| SSE | `GET /api/stream?sessionId=<id>`（`*` 为全部） | 先收 `hello`，随后 `delta`、`turn.end`、`error`、`approval`、`approval.resolved`、`question`、`question.resolved`；帧格式 `data: <json>` + 空行 |
| WebSocket | `ws://<host>:8787/ws/client` 的 `turn.send` | `turn.delta`、`turn.end`、`turn.error`；连接时先收 `ready`（含方法列表） |
| HTTP 轮询 | `GET /api/events?sessionId=&fromSeq=` | 持久事件数组，可用于断线补拉 |
| CLI | `jary session replay`、`jary session export` | 本地读取同一 `events` 表 |

- SSE 只广播经 `POST /api/message` 触发的 turn 以及 Web 侧审批/问题；例程、CLI 等非 HTTP 入口触发的 turn 需要轮询 `/api/events`。
- `/ws/client` 的 `session.subscribe` 返回最近 50 条持久事件，但当前版本不会继续推送后续事件。
- 具体帧字段与鉴权见 [HTTP API](http-api.md)；事件如何影响记忆与上下文见 [记忆](../guides/memory.md)、[架构](../design/architecture.md)。
- 相关阅读：[CLI](cli.md)、[配置](configuration.md)、[快速开始](../getting-started.md)。
