# Web UI 使用指南

> 适用版本：v1.11.0 · 状态：现行
> 服务端自带的单页控制台：启动、会话、流式与工具步骤、审批/问题卡、看屏、侧边面板、文本命令与 PWA 的实际用法。

## 概览

Web UI 由 `@jaryn/web` 在 `jary serve` 时挂载，静态文件位于 `packages/web/src/public/`（`index.html`、`app.js`、`style.css`、`manifest.json`、`sw.js`、`icon.svg`），没有前端构建步骤。页面数据走 REST，运行态增量走 SSE（`GET /api/stream`）。

- 服务端是唯一真相：会话、事件、审批、记忆、产物都在服务端；页面只做展示与操作。
- 单 owner 产品：没有登录、多用户、角色体系。访问控制只有 `JARY_API_TOKEN` 与网络层/反代（见「限制与边界」）。
- 默认监听 `127.0.0.1:8787`；要让局域网另一台设备打开，需 `jary serve --host 0.0.0.0`，并自行加 TLS。

| 区域 | 内容 | 数据来源 |
|---|---|---|
| 左栏 | 新会话、Bot 选择、会话列表（标题/重命名/归档/删除） | `/api/sessions`、`/api/bots` |
| 顶栏 | 当前会话 id、运行状态、停止、通知铃铛、面板、看屏 | `/api/stream`、`/api/notifications` |
| 消息区 | 用户/助手/工具步骤、错误；助手文本流式追加 | `/api/events`、SSE `delta` |
| 卡片区 | 审批卡、问题卡 | SSE `approval` / `question` |
| 侧边面板 | 记忆、任务、页面、产物、例程、提议、用量、审计、通知 | 见面板表 |
| 看屏面板 | MJPEG 画面、点击/输入、接管 | `/api/computer/*` |

## 快速上手

数据目录默认 `~/.jary`，可用 `--home` 指定；服务端默认只监听 `127.0.0.1:8787`。

```bash
jary init --home ./data-home              # 初始化 profile 与数据目录
jary serve --home ./data-home --port 8787 # 启动 Web UI + API
```

浏览器打开 `http://127.0.0.1:8787`。默认模型是 echo provider，接真实模型：

```bash
DEEPSEEK_API_KEY=sk-... \
  jary serve --home ./data-home --patch packages/bundles/deepseek/patch.json
```

首次进入默认选中会话 `web`（首次发送消息时才写入数据库）。在输入框输入任务，Enter 发送，Shift+Enter 换行；运行中可点「停止」（等价 `/stop`）。

## 会话操作

| 操作 | 界面 | HTTP 接口 |
|---|---|---|
| 新建 | 左栏「+ 新会话」 | `POST /api/sessions` `{botId}` |
| 列表 | 左栏列表 | `GET /api/sessions`（`?archived=1` 才含归档） |
| 重命名 | 悬停会话行点笔形图标 | `PATCH /api/sessions/:id` `{title}` |
| 归档 | 悬停会话行点方形图标 | `PATCH /api/sessions/:id` `{archived:true}` |
| 删除 | 悬停会话行点叉，需确认 | `DELETE /api/sessions/:id` |
| Fork | 无按钮（仅接口） | `POST /api/sessions/:id/fork` `{id?, upToSeq?}` |
| 历史 | 选中会话自动加载 | `GET /api/events?sessionId=&fromSeq=` |
| 发消息 | 输入框 | `POST /api/message` `{sessionId,text,botId}`（202 后走 SSE） |
| 取消当前 turn | 顶栏「停止」 | `POST /api/sessions/:id/cancel` |

Fork 会复制源会话截至 `upToSeq` 的事件，标题追加 ` (fork)`，返回 201。归档在界面上是单向的：取消归档只能调接口 `{archived:false}`。

## 流式事件与卡片

`GET /api/stream?sessionId=<id>` 是 SSE，每行一个 `data: {...}`。页面同时只连接一个会话，切换会话会重连。

| `type` | 含义 | 页面处理 |
|---|---|---|
| `hello` | 连接确认 | 忽略 |
| `delta` | 模型增量，`delta.type` 为 `text`/`reasoning`/`tool_call`/`usage`/`finish` | 只把 `text` 追加到助手气泡 |
| `turn.end` | 本轮结束 | 状态置 idle，刷新会话列表 |
| `error` | 本轮异常 | 显示错误消息 |
| `approval` / `approval.resolved` | 审批请求/已解决 | 增删审批卡 |
| `question` / `question.resolved` | 反问请求/已解决 | 增删问题卡 |

工具调用与结果（`tool.call` / `tool.result`）不通过 SSE 实时渲染，而是来自会话事件历史：重新选中会话或刷新页面后出现 `→ 工具名 参数` 与对勾/叉号结果行。助手正文是真正的流式增量。

审批卡只有「允许一次」和「拒绝」；决定写回 `POST /api/approvals/:id` `{decision:"allowed"|"denied"}`。默认需要审批的风险是 `execute`、`external`、`destructive`，`read`/`write`/`network` 直接放行（规则可在 `/api/rules` 覆盖）。审批等待 30 分钟，超时按拒绝处理。问题卡等待 10 分钟，超时后模型收到「no answer (timed out); proceed with your best judgement」。两者都只存在服务端内存中，进程重启即丢失。

## 文本命令

输入以 `/` 开头即走命令通道 `POST /api/sessions/:id/command`，不消耗模型 turn（`/compact` 除外）。

| 命令 | 行为 |
|---|---|
| `/status` | 返回会话、用量汇总、已注册工具数 |
| `/compact` | 异步触发一次压缩 turn，立即返回 202 |
| `/new` | 新建同 Bot 会话并切换过去 |
| `/stop` | 取消当前会话运行中的 turn |
| `/memory` | 返回该会话 Bot 命名空间的记忆分类与统计 |
| `/forget <词>` | 删除匹配记忆 |
| `/remember <文本>` | 写入一条 `fact` 记忆 |
| `/artifacts` | 产物列表 |
| `/jobs` | 例程列表 |
| `/bots` | Bot 列表 |
| `/approvals` | 当前待审批列表 |
| `/help` | 命令清单 |

结果以 JSON 形式渲染在消息区（截断 1500 字符），不是自然语言回复。

## 侧边面板

点顶栏「面板」打开，切换标签时按需请求。

| 标签 | 内容 | 接口 |
|---|---|---|
| 记忆 | 分类计数、最近标题、快速记住 | `GET/POST /api/memory` |
| 任务 | 任务板 | `GET /api/tasks` |
| 页面 | 标题链接到 `/pages/:id` | `GET /api/pages` |
| 产物 | 名称、大小、MIME（无预览/下载按钮） | `GET /api/artifacts` |
| 例程 | 触发器、运行次数、下次时间、立即运行 | `GET /api/jobs`、`POST /api/jobs/:id/run` |
| 提议 | 扫描、接受、忽略 | `GET /api/initiative`、`POST /api/initiative/scan`、`/:id/accept`、`/:id/dismiss` |
| 用量 | 输入/输出/缓存 tokens、累计费用 | `GET /api/usage` |
| 审计 | 最近 30 条管理动作 | `GET /api/audit?limit=30` |
| 通知 | 列表、全部已读、安静时段标记 | `GET /api/notifications`、`POST /api/notifications/read-all` |

顶栏「通知」显示未读数，每 15 秒轮询一次；打开面板的「通知」标签可看详情。安静时段由 `@jaryn/notifications` 的配置决定，命中时通知仍写入，只标记 `suppressed` 并在面板显示「安静时段」：

```json
{ "id": "notifications", "name": "@jaryn/notifications",
  "config": { "quietHours": { "start": "22:00", "end": "08:00", "tz": "Asia/Shanghai" } } }
```

把这段作为一个 patch 操作追加到 `$JARY_HOME/profile.json` 的 `patches` 数组，重启 `jary serve` 生效。

## 看屏与接管

需要 `@jaryn/computer` 已挂载；首次看屏会自动启动（或复用）该 Bot 的浏览器，启动失败时面板只显示错误。点「看屏」后页面把 `<img>` 指向 MJPEG 流：

```text
GET /api/computer/mjpeg?botId=<bot>&quality=55
```

- 点击画面：把坐标按 1280×900 映射后 `POST /api/computer/input` `{event:{type:"click",x,y}}`。
- 输入框 +「输入」：先 `type` 再 `key: Enter`。
- 「接管」：`POST /api/computer/takeover` `{botId,enabled}`；接管期间 Bot 的浏览器动作会被拒绝（`computer is under human takeover`），再点「交还」恢复。
- 另有 SSE 版看屏接口：`GET /api/computer/screen?mode=screencast&botId=<bot>`，返回 `frame` 事件；页面默认用 MJPEG。

注意：页面把**当前会话 id** 当作 `botId` 传给看屏与接管接口（见 `packages/web/src/public/app.js`）。会话 id 与 Bot id 不同名时，需要在接口里显式指定真实 Bot。

## PWA

同一套静态资源即 PWA：`manifest.json` 声明 `display: standalone`，`sw.js` 缓存应用外壳（`/`、`/app.js`、`/style.css`、`/manifest.json`、`/icon.svg`），导航请求网络优先、失败回退缓存；`/api/` 请求不缓存。浏览器地址栏/菜单选择「安装」即可得到独立窗口。安装与 Service Worker 需要 HTTPS 或 localhost。没有推送、后台同步与离线写入；离线时只能打开壳，操作会失败。

## 限制与边界

- 鉴权：设置 `JARY_API_TOKEN` 后，用 `https://host:8787/?token=<token>` 打开一次；页面把令牌存入 localStorage 并从地址栏移除，后续 API 请求带 Bearer，SSE/看屏先用 `POST /api/stream-ticket` 换 10 分钟 ticket 再连接。401 时页面提示重新带 `?token=` 打开。桌面壳从自己的配置里注入令牌，无需手动带参数。
- 单实例：SSE 订阅者与待审批/待回答都保存在进程内存，多副本部署不会互通，重启会丢审批与问题。
- 无实时工具步骤：工具调用与结果要重新加载会话才出现；断线重连不补发错过的增量，以 `/api/events` 的历史为准。
- 归档无「取消归档」按钮；Fork 无界面入口；文件上传只有 `POST /api/files`，产物面板无预览/下载入口。
- 页面无 i18n、主题切换与多标签同步；左栏页脚版本号是静态文案，不代表实际版本。
- 看屏质量与帧率受浏览器/CDP 与网络影响；`botId` 传参问题见上一节。
- 公网暴露必须自行加 TLS 与访问控制，配对码接口本身不鉴权。

## 相关文档

- [快速开始](../getting-started.md) · [核心概念](../concepts.md)
- [客户端指南](../guides/clients.md) · [插件指南](../guides/plugins.md)
- [记忆](../guides/memory.md) · [主动任务](../guides/proactive.md) · [云电脑](../guides/cloud-computer.md) · [页面与产物](../guides/pages-artifacts.md)
- [CLI 参考](../reference/cli.md) · [HTTP API 参考](../reference/http-api.md) · [配置参考](../reference/configuration.md) · [事件参考](../reference/events.md)
- [部署](../operations/deployment.md) · [安全](../operations/security.md) · [故障排查](../operations/troubleshooting.md) · [架构](../design/architecture.md)
