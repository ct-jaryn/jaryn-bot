# 客户端使用指南

> 适用版本：v1.11.0 · 状态：现行
> Web/PWA、Electron 桌面、Android 三种客户端与设备配对、令牌、`/ws/client` 协议的接入方式与边界。

## 概览

服务端单进程部署，客户端是「瘦壳」：不在本地跑模型、不存会话，只负责渲染与交互。客户端主动出站连服务端，服务端从不反向拨号，因此不需要公网端口映射。

```text
浏览器 / PWA ──┐
Electron 桌面 ──┼── 出站 HTTPS / WSS ──→ jary serve（会话/事件/审批/工具/插件/鉴权）
Android WebView ┘
自定义客户端 ──── /ws/client JSON-RPC
```

- 服务端是唯一真相；桌面与 Android 都是把同一个 Web UI 装进原生窗口/WebView。
- 原生 iOS 明确不做；执行端 Node（`/ws/node`）也未实现。
- 自定义客户端通过 `/ws/client` 接 JSON-RPC；文件与列表仍走 REST。

| 形态 | 载体 | 安装方式 | 备注 |
|---|---|---|---|
| Web | 浏览器直接访问服务端 | 无 | 功能最全，与桌面/手机同源 |
| PWA | 同一页面的 manifest + service worker | 浏览器「安装」 | 应用外壳离线，API 不缓存 |
| Electron | `desktop/`（Electron 33） | GitHub Release 安装包 | Windows/Linux 已出包；macOS 需手动工作流 |
| Android | `mobile/android/`（Kotlin WebView） | Release 中的 `app-debug.apk` | minSdk 26 / compileSdk 34，允许明文 HTTP |
| 自定义 | 任意语言 | 自行实现 | `/ws/client`，协议版本 1 |

## 快速上手

服务端默认只监听 `127.0.0.1:8787`；局域网访问需显式 `--host 0.0.0.0`。

```bash
jary init --home ./data-home
jary serve --home ./data-home --port 8787 --host 0.0.0.0
```

- Web / PWA：浏览器打开 `http://<服务器>:8787`，功能与桌面/Android 同源。
- 桌面：下载 Release 中的 `jaryn.Setup.<ver>.exe` 或 `.AppImage`/`.deb`；首次启动填服务器地址，菜单「连接 → 更改服务器 / 重新连接」。
- Android：下载 `app-debug.apk`，允许未知来源，首次启动填服务器地址。

三种客户端共用同一个 Web UI，账号体系为单 owner。若在公网暴露，必须在前面加 TLS 反代并做访问控制（见「限制与边界」）。

## 设备配对与令牌

配对用于给「非浏览器」或脚本客户端发放长期令牌。配对码由管理员在服务端生成：

```bash
jary device pair-code                 # {"code":"123456","expiresAt":...}
jary device list                      # 设备列表、最后在线、吊销时间
jary device revoke dev_xxx            # 立即失效
```

客户端侧兑换（该端点不需要鉴权，因为它就是用来换取令牌的）：

```bash
curl -sX POST http://127.0.0.1:8787/api/devices/pair \
  -H 'content-type: application/json' \
  -d '{"code":"123456","name":"laptop"}'
```

响应为 `{"deviceId":"dev_...","token":"<64 位 hex>"}`，token 只在此处出现一次。

| 项 | 实际行为（`packages/devices/src/index.ts`） |
|---|---|
| 码格式 | 6 位数字，10 分钟有效，使用一次即作废 |
| 失败限次 | 全局限流：默认 10 次失败 / 10 分钟窗口，超限锁定；`maxAttemptsPerCode`（默认 5）已声明但当前未逐码计数 |
| 令牌 | 32 字节随机 hex；服务端只存 SHA-256，明文只在配对响应出现一次 |
| 角色 | 固定 `owner`；服务端没有 member/多人角色 |
| 吊销 | `revoked_at` 置位后 `verify` 立即失败；没有「轮换」命令，轮换=吊销后重新配对 |
| HTTP 用法 | `Authorization: Bearer <token>` 或 `?token=<token>`；`/api/devices/pair(-code)`、OAuth 回调、`/healthz` 与静态资源无需鉴权 |
| 管理接口 | `GET /api/devices`、`POST /api/devices/:id/revoke`；配对接口为 `POST /api/devices/pair-code`、`POST /api/devices/pair` |

限制：配对码与配对接口是公开路由；失败计数保存在进程内存，重启清零；公网部署建议在反代层限制配对端点来源。

## `/ws/client` 协议

路径 `ws://<host>:8787/ws/client`（TLS 下 `wss://`）。每个 WebSocket 文本帧是一个 JSON 对象；请求带 `id`，响应 `{id,result}` 或 `{id,error}`，服务端推送为 `{event,data}`。连接建立后先收到：

```json
{"event":"ready","data":{"version":1,"methods":["ping","session.list","session.create","session.subscribe","turn.send","turn.cancel","approval.list","approval.respond","usage.total"]}}
```

| 方法 | 参数 | 结果 |
|---|---|---|
| `ping` | — | `{pong:<时间戳>}` |
| `session.list` | — | `{sessions:[...]}`（不含归档） |
| `session.create` | `{id?, botId?}` | `{session}`，缺省 id 为 `ws_<时间戳>` |
| `session.subscribe` | `{sessionId}` | `{sessionId, events}`，仅最近 50 条历史，不是持续订阅 |
| `turn.send` | `{sessionId, text, provenance?}` | `{accepted:true, sessionId}`；随后在该连接推送流事件 |
| `turn.cancel` | `{sessionId}` | `{cancelled:boolean}` |
| `approval.list` | — | `{approvals:[...]}`（Web 服务挂载的待审批桥） |
| `approval.respond` | `{id, decision}` | `{resolved:boolean}`；只有字符串 `allowed` 视为允许 |
| `usage.total` | `{sessionId?}` | 输入/输出/缓存 tokens 与累计费用 |

turn 相关事件只有三种：

| 事件 | 数据 | 说明 |
|---|---|---|
| `turn.delta` | `{delta:{type:"text" 等,...}}` | 流式增量：type 为 text/reasoning/tool_call/usage/finish |
| `turn.end` | `{finishReason, text}` | 本轮完成 |
| `turn.error` | `{message}` | 本轮失败 |

最小客户端（Node 24 自带全局 `WebSocket`）：

```bash
node --input-type=module -e '
const ws = new WebSocket("ws://127.0.0.1:8787/ws/client")
ws.onmessage = (e) => console.log(e.data)
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "ping" }))
'
```

一次 turn 的消息序列：

```text
→ {"id":1,"method":"session.create","params":{"id":"demo","botId":"default"}}
← {"id":1,"result":{"session":{"id":"demo",...}}}
→ {"id":2,"method":"turn.send","params":{"sessionId":"demo","text":"你好"}}
← {"id":2,"result":{"accepted":true,"sessionId":"demo"}}
← {"event":"turn.delta","data":{"type":"text","text":"..."}}
← {"event":"turn.end","data":{"finishReason":"stop","text":"..."}}
```

鉴权：与 HTTP 共用同一套规则——`Authorization: Bearer <JARY_API_TOKEN>`、`?token=<token>`，或配对得到的设备令牌；否则握手返回 401。未设置 `JARY_API_TOKEN` 时不校验（仅本机/内网使用时如此）。

## 客户端构建与产物

| 工作流 | 触发 | 产物 | 说明 |
|---|---|---|---|
| `.github/workflows/release.yml` | tag `v*` / 手动 / 每周一 | 全部客户端 + `SHA256SUMS.txt` | 一次构建全平台：Windows `.exe`、Linux `.AppImage`/`.deb`、macOS `.dmg`（x64+arm64）、Android `.apk`；tag 时自动创建/更新 GitHub Release |

**免费 runner 说明**：公开仓库使用 GitHub 托管的标准 runner 不扣分钟。本流水线使用的标签：`ubuntu-latest`、`windows-latest`、`macos-15`（arm64，交叉构建 x64/arm64 dmg）。
不要用 `macos-13`（已下线）或 `macos-14`（本账号返回 “configuration not supported”），这两者会让任务直接取消。
更完整的打包/签名/排错说明见 [自动打包](../operations/release.md)。

打包全部在 GitHub Actions 完成，本地只需跑单测：`node --test desktop/test/*.test.cjs`（已包含在 `npm test`）。

## 常见任务

**换服务器**：桌面端用菜单「连接 → 更改服务器」；Android 首次启动填写后没有菜单入口，需清除应用数据（SharedPreferences `jaryn`）重新填写。

**从手机/平板访问**：服务端加 `--host 0.0.0.0`，手机与服务器同网段；公网访问用 TLS 反代，并为 `/ws/client` 与 `/tunnel` 保留 `Upgrade` 头。

**让服务端访问内网**：在能访问内网的机器上跑 `jary tunnel --url ws://<server>/tunnel`，服务端云电脑的浏览器会经该机器出站（`GET /api/tunnel` 可看连接状态）。它只是 HTTP 代理隧道，不是执行端 Node，不提供 fs/shell 工具。

**桌面壳的安全设置**：Electron 使用 `contextIsolation`、关闭 `nodeIntegration`、开 `sandbox`；配置写入 userData 下 `config.json`（0600）；导航被限制在当前服务端域，外链交给系统浏览器打开。

## 限制与边界

- 没有 `/ws/node` 与远程执行端；`/tunnel` 只是出站 HTTP 代理。原生 iOS 不做。
- `/ws/client` 是 v1 最小实现：`session.subscribe` 只回历史快照，没有 seq、回放与断线补发；`turn.send` 的流事件只发给发起连接，不广播给其它连接，多端同步需自行轮询历史。
- 设备令牌与 API 令牌在 HTTP 与 `/ws/client` 上都能用；令牌不区分 owner/Bot，拿到即代表 owner。
- 桌面端「API Token」保存在 userData 的 `config.json`（0600），页面启动时通过 preload 读取并用于 API/SSE/看屏请求；改了 token 需重新保存配置。
- 安装包未做发行签名，APK 为 debug 构建：Windows SmartScreen、macOS Gatekeeper 会拦截，分发给他人需自行签名/公证；macOS 安装包需在可用 runner 的账号上手动跑工作流。
- Android 仅 debug 构建、允许明文 HTTP、未上架；iOS 无客户端。
- 无推送：没有 APNs/FCM，通知只在 Web UI 通知中心；PWA 也没有后台同步。客户端离线不影响服务端任务，但会丢失实时视图。
- 服务端单进程：WS 连接、审批桥、SSE 都在进程内，不能水平扩展；重启会断开所有客户端并丢失内存中的待审批/待回答。

## 相关文档

- [快速开始](../getting-started.md) · [核心概念](../concepts.md)
- [Web UI 指南](../guides/web-ui.md) · [插件指南](../guides/plugins.md)
- [HTTP API 参考](../reference/http-api.md) · [CLI 参考](../reference/cli.md) · [事件参考](../reference/events.md) · [配置参考](../reference/configuration.md)
- [部署](../operations/deployment.md) · [安全](../operations/security.md) · [故障排查](../operations/troubleshooting.md) · [架构](../design/architecture.md) · [决策记录](../design/decisions.md)
