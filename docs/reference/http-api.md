# HTTP / WebSocket API 参考

> 适用版本：v1.11.0 · 状态：现行
> 单进程 HTTP + SSE + WebSocket 接口；路由与鉴权以 `packages/web/src/index.ts`、`packages/web/src/ws-client.ts` 为准。

## 1. 基础

| 项 | 值 |
|---|---|
| 监听 | `jary serve --host 127.0.0.1 --port 8787`；默认只绑 loopback |
| Content-Type | JSON 接口为 `application/json`；页面/SSE/流式接口见各节 |
| 路由规模 | `node scripts/inventory.ts` 统计 63 条路由注册点（动态段合并计数） |
| 请求体上限 | JSON 请求 1 MB；`POST /api/files` 单文件 20 MB |
| 错误格式 | `{"error": "..."}`，HTTP 状态与语义一致 |

## 2. 鉴权

设置 `JARY_API_TOKEN` 后，所有 `/api/*`（下文标注“公开”的除外）、`/metrics`、`/ws/client` 需要令牌；未设置时这些接口不做鉴权。传入方式：

| 方式 | 适用范围 | 说明 |
|---|---|---|
| `Authorization: Bearer <token>` | HTTP 与 `/ws/client` | 推荐；Web/桌面/Android 客户端使用 |
| `?token=<token>` | HTTP 与 `/ws/client` | 供 EventSource、视频流等无法带 header 的场景 |
| 设备令牌 | 仅 HTTP | `POST /api/devices/pair` 返回的 `token`，经 `devices.verify` 校验后放行 |
| `X-Jary-Email-Secret` | `POST /api/email/inbound` | 与环境变量 `JARY_EMAIL_SECRET` 相等时视为已鉴权，优先于 API token |
| `X-Jary-Signature` | `POST /hooks/*` | 作业配置了 `trigger.secret` 时按 HMAC-SHA256(secret, raw body) 校验；`sha256=` 前缀可省略 |
| OAuth `state` | `GET /api/oauth/callback/:id` | 由浏览器重定向到达，用 `JARY_OAUTH_STATE_<ID>` 校验；未配置该变量则不校验 |

- 公开例外：`/healthz`、静态资源、`GET /pages/*`、`GET /p/*`、`GET|POST /secure/*`、`POST /api/devices/pair-code`、`POST /api/devices/pair`、`GET /api/oauth/callback/*`。
- `/ws/client` 与 HTTP 共用鉴权：`JARY_API_TOKEN`（Bearer 或 `?token=`）或设备令牌（`POST /api/devices/pair` 返回）。
- `/hooks/*` 未配置 `trigger.secret` 时不校验签名（也不在 `/api/*` 下，不受 API token 保护）；公网使用务必设置 secret。
- 鉴权失败返回 `401 {"error":"unauthorized"}`；`/healthz` 在依赖缺失时返回 `503`。
- `GET /metrics` 输出 Prometheus 文本：`jaryn_sessions_total`、`jaryn_events_total{type=...}`、`jaryn_jobs_total`、`jaryn_job_runs_total`、`jaryn_memory_total{ns="global"}`。

## 3. 端点

### 3.1 页面、健康与指标

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/`、`/index.html` | Web 工作台入口 | 公开 |
| GET | `/app.js`、`/style.css`、`/manifest.json`、`/sw.js`、`/icon.svg` | 静态资源与 PWA | 公开 |
| GET | `/healthz` | 存活检查（store/agent/memory/scheduler） | 公开 |
| GET | `/metrics` | Prometheus 文本指标 | token |
| GET | `/pages/:id` | 渲染 Page 为 HTML | 公开 |
| GET | `/p/:token` | 通过分享令牌渲染 Page（可带 TTL） | 公开 |
| GET | `/secure/:token` | Vault 一次性 Secure Form 页面 | 公开 |
| POST | `/secure/:token` | 提交表单写入 Vault | 公开 |

### 3.2 会话

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/api/sessions` | 会话列表；`?archived=1` 含归档 | token |
| POST | `/api/sessions` | 新建会话；body 可带 `id`、`botId`、`cwd` | token |
| PATCH | `/api/sessions/:id` | 改标题（`title`）或归档（`archived`） | token |
| DELETE | `/api/sessions/:id` | 删除会话及其事件 | token |
| POST | `/api/sessions/:id/fork` | 分叉会话；body 可带 `id`、`upToSeq` | token |
| POST | `/api/sessions/:id/cancel` | 取消该会话运行中的 turn | token |
| POST | `/api/sessions/:id/command` | 文本命令：`/status`、`/compact`、`/new`、`/stop`、`/memory`、`/remember`、`/forget`、`/artifacts`、`/jobs`、`/bots`、`/approvals`、`/help` | token |

### 3.3 对话、事件与流

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| POST | `/api/message` | 发消息并异步运行一个 turn（立即返回 202） | token |
| GET | `/api/events` | 事件回放；`?sessionId=...&fromSeq=...` | token |
| GET | `/api/stream` | SSE 实时流；`?sessionId=...`（默认 `*` 收全部） | token |

### 3.4 审批、问题与规则

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/api/approvals` | 待审批列表 | token |
| POST | `/api/approvals/:id` | 决策；body `{"decision":"allowed"}` 或 `denied` | token |
| GET | `/api/rules` | 审批规则列表 | token |
| POST | `/api/rules` | 新增规则；`effect` 必须为 `allow`、`ask` 或 `deny` | token |
| GET | `/api/questions` | 待回答问题 id 列表 | token |
| POST | `/api/questions/:id` | 回答；body `{"answer":"..."}` | token |

### 3.5 记忆、Bot 与任务

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/api/memory` | 目录与统计；`?query=` 搜索，`?kind=` 列条目，`?ns=` 指定命名空间 | token |
| POST | `/api/memory` | 新增记忆；body 需 `text`，可带 `ns`、`kind`、`pinned` | token |
| DELETE | `/api/memory/:id` | 删除记忆；`?ns=` 默认 `global` | token |
| GET | `/api/bots` | Bot 名册 | token |
| POST | `/api/bots` | 新建 Bot；body 需 `id`，可带 `name`、`persona` | token |
| GET | `/api/tasks` | 任务板 | token |

### 3.6 例程与 Webhook

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/api/jobs` | 例程列表与运行记录 | token |
| POST | `/api/jobs` | 新建例程；body 需 `mission` 与 `trigger` | token |
| POST | `/api/jobs/:id/run` | 立即运行 | token |
| POST | `/api/jobs/:id/enable` | 启用 | token |
| POST | `/api/jobs/:id/disable` | 停用 | token |
| GET | `/api/jobs/:id/runs` | 单例程运行记录 | token |
| POST | `/hooks/:id` | Webhook 触发例程；`:id` 为例程 id；配置 secret 时校验 `X-Jary-Signature` | HMAC（配置 secret 时） |

### 3.7 产物、Pages、教学与提议

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/api/artifacts` | 产物列表 | token |
| POST | `/api/artifacts` | 保存产物；body 需 `name` 与 `content` | token |
| GET | `/api/pages` | Page 列表 | token |
| POST | `/api/pages` | 新建 Page；body 需 `title` | token |
| POST | `/api/pages/:id/share` | 生成/撤销分享链接；`enabled`、`ttlHours` | token |
| GET | `/api/pages/:id/versions` | 版本历史 | token |
| POST | `/api/pages/:id/rollback` | 回滚；body 需 `version` | token |
| GET | `/api/pages/:id/export` | 导出 HTML（附件下载） | token |
| GET | `/api/teach` | 技能目录 | token |
| POST | `/api/teach` | 保存技能；body 需 `title` | token |
| GET | `/api/initiative` | 提议列表；`?botId=` 过滤 | token |
| POST | `/api/initiative/scan` | 扫描信号生成提议 | token |
| POST | `/api/initiative/:id/accept` | 接受并执行，同时创建任务 | token |
| POST | `/api/initiative/:id/dismiss` | 忽略；body `{"mute":true}` 可静音同类 | token |

### 3.8 云电脑与隧道

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/api/computer` | 状态；`?botId=` 默认 `default` | token |
| POST | `/api/computer/start` | 启动；`?botId=` | token |
| POST | `/api/computer/stop` | 停止；`?botId=` | token |
| POST | `/api/computer/snapshot` | 快照；`?botId=&label=` | token |
| GET | `/api/computer/screenshot` | 单帧 PNG | token |
| GET | `/api/computer/screen` | SSE 看屏；`?botId=&fps=&mode=screencast&quality=` | token |
| GET | `/api/computer/mjpeg` | MJPEG 原生流；`?botId=&quality=` | token |
| POST | `/api/computer/takeover` | 接管/交还；body `botId`、`enabled` | token |
| POST | `/api/computer/input` | 输入事件；body `botId`、`event` | token |
| GET | `/api/tunnel` | 出网隧道状态（connected/proxyPort） | token |

### 3.9 Vault、连接器与邮箱

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/api/vault` | 凭据元数据列表（不含明文） | token |
| POST | `/api/vault` | 新增凭据；body 需 `name` 与 `secret` | token |
| DELETE | `/api/vault/:id` | 删除凭据 | token |
| POST | `/api/vault/:id/fill` | 向当前页面盲填；body `botId`、`origin` | token |
| POST | `/api/vault/secure-form` | 创建一次性 Secure Form；body 需 `origin` 与 `purpose` | token |
| GET | `/api/oauth/callback/:id` | OAuth 授权码回调；校验 `state` 后写入 Vault | state |
| POST | `/api/oauth/refresh/:id` | 刷新 access token | token |
| POST | `/api/email/inbound` | 入站邮件 webhook，写入 `input.email` 事件 | 邮箱密钥或 token |

OAuth 相关环境变量按连接器 id 大写拼接：`JARY_OAUTH_TOKEN_URL_<ID>`、`JARY_OAUTH_CLIENT_ID_<ID>`、`JARY_OAUTH_CLIENT_SECRET_<ID>`、`JARY_OAUTH_STATE_<ID>`；回调地址为 `<origin>/api/oauth/callback/<id>`。

### 3.10 文件、通知、用量、审计与设备

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| POST | `/api/files` | 上传文件到会话 `inbox/`；`?sessionId=&name=` | token |
| GET | `/api/files` | 下载工作区文件；`?sessionId=&path=`，路径越界返回 400 | token |
| GET | `/api/notifications` | 通知列表；`?limit=&unread=1`，含未读数 | token |
| POST | `/api/notifications/read-all` | 全部标记已读 | token |
| POST | `/api/notifications/:id/read` | 标记单条已读 | token |
| GET | `/api/usage` | token 与费用汇总；`?sessionId=` | token |
| GET | `/api/audit` | 审计日志；`?limit=` 默认 50 | token |
| POST | `/api/devices/pair-code` | 生成配对码（默认 10 分钟有效） | 公开 |
| POST | `/api/devices/pair` | 配对换令牌；body `code`、`name` | 公开 |
| GET | `/api/devices` | 设备列表 | token |
| POST | `/api/devices/:id/revoke` | 吊销设备 | token |

## 4. `/ws/client`（WebSocket，JSON-RPC 风格）

同一 HTTP 端口升级：`ws://<host>:8787/ws/client`。连接建立后服务端先发 `{"event":"ready","data":{"version":1,"methods":[...]}}`；请求帧 `{"id":1,"method":"...","params":{}}`；响应帧 `{"id":1,"result":...}` 或 `{"id":1,"error":"..."}`；服务端事件帧 `{"event":"...","data":{...}}`。帧中没有 `jsonrpc` 字段。

| 方法 | 参数 | 结果 |
|---|---|---|
| `ping` | 无 | `{ pong: <ts> }` |
| `session.list` | 无 | `{ sessions: [...] }` |
| `session.create` | `id?`、`botId?` | `{ session }` |
| `session.subscribe` | `sessionId` | `{ sessionId, events }`（最近 50 条；当前版本不推送后续事件） |
| `turn.send` | `sessionId`、`text`、`provenance?` | `{ accepted: true, sessionId }`，随后事件流式返回 |
| `turn.cancel` | `sessionId` | `{ cancelled: boolean }` |
| `approval.list` | 无 | `{ approvals: [...] }` |
| `approval.respond` | `id`、`decision`（`allowed` 或 `denied`） | `{ resolved: boolean }` |
| `usage.total` | `sessionId?` | `{ inputTokens, outputTokens, cacheReadTokens, costUsd }` |

服务端事件：

| 事件 | 载荷 | 说明 |
|---|---|---|
| `ready` | `{ version: 1, methods }` | 握手完成与方法列表 |
| `turn.delta` | 模型增量（文本/工具调用/用量） | 对应 `turn.send` 启动的 turn |
| `turn.end` | `{ finishReason, text }` | turn 正常结束 |
| `turn.error` | `{ message }` | turn 异常 |

## 5. SSE 事件格式

每个事件是一行 `data: <json>`，空行分隔；没有 `event:` 字段。`/api/stream` 的帧类型：

| 类型 | 载荷 | 触发 |
|---|---|---|
| `hello` | `{ sessionId }` | 连接建立 |
| `delta` | `{ delta }` | `POST /api/message` 的模型增量 |
| `turn.end` | `{ result }` | 该 turn 结束 |
| `error` | `{ message }` | 该 turn 异常 |
| `approval` | `{ request }` | 需要审批 |
| `approval.resolved` | `{ id, decision }` | 审批决定 |
| `question` | `{ id, question, options }` | 模型提问 |
| `question.resolved` | `{ id }` | 问题已答 |

`/api/computer/screen` 的 SSE 帧为 `{ "type": "frame", "image": "<base64>", "ts": number }` 或 `{ "type": "error", "message": "..." }`；MJPEG 流为 `multipart/x-mixed-replace`，每帧 JPEG。

## 6. 约定与边界

- API 不带版本前缀；不承诺跨大版本兼容，升级前看 [更新记录](../../CHANGELOG.md)。
- 会话状态由事件流重建，`/api/events` 与 `/ws/client` 的 `session.subscribe` 都读同一 `events` 表。
- SSE 只广播经 `/api/message` 触发的 turn 与 Web 侧审批/问题；例程、CLI 等非 HTTP 入口触发的 turn 不镜像到 `/api/stream`，需要轮询 `/api/events`。
- 动态路径均按代码解析，示例：`/api/jobs/:id/run`、`/api/approvals/:id`；路径包含 `:` 的是占位符，不是字面量。
- 相关阅读：[CLI](cli.md)、[配置](configuration.md)、[事件](events.md)、[客户端](../guides/clients.md)、[安全](../operations/security.md)。
