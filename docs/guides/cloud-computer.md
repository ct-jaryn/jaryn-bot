# 云电脑

> 适用版本：v1.11.0 · 状态：现行
> 这份文档说明如何为 Bot 启动一台浏览器型云电脑，让它在网页上操作，并从 Web UI 看屏、接管和回滚。

## 概览

云电脑为每个 Bot 提供独立的浏览器实例与工作目录，Bot 通过 `browser.*` 与 `computer.*` 工具操作；人可以实时看屏、发送鼠标/键盘输入、接管或交还。工作目录与浏览器 profile 持久化在 `$JARY_HOME/data/computers/<botId>/`。

| 后端 | 实现 | 适用 |
|---|---|---|
| `local` | 本机 Chrome，`--headless=new`，CDP 远程调试 | 开发机、单机自托管（base 默认） |
| `docker` | 容器内 Chromium + Xvfb/VNC 组件，CDP 9222 | 需要隔离或运行在 Linux 服务器 |

当前只实现这两种后端；`ComputerBackend` 接口可以扩展其他 provider，但仓库内没有 microVM 或远程沙箱实现。

## 快速上手

云电脑实例由 `jary serve` 进程持有，通过 HTTP API 或 Agent 工具管理。启动服务后：

```bash
curl -s 'http://127.0.0.1:8787/api/computer?botId=jaryn'
curl -s -X POST 'http://127.0.0.1:8787/api/computer/start?botId=jaryn'
curl -s -X POST 'http://127.0.0.1:8787/api/computer/snapshot?botId=jaryn&label=before-login'
curl -s 'http://127.0.0.1:8787/api/computer/screenshot?botId=jaryn' -o shot.png
```

看屏有两种 SSE 形式：截图轮询（`/screen`，`fps` 允许 0.5–10）与 CDP screencast（`/screen?mode=screencast&quality=55`）；Web UI 使用 MJPEG 端点。接管与输入通过以下接口完成：

```bash
curl -sN 'http://127.0.0.1:8787/api/computer/screen?botId=jaryn&fps=2'
curl -sN 'http://127.0.0.1:8787/api/computer/screen?botId=jaryn&mode=screencast&quality=55'
curl -sN 'http://127.0.0.1:8787/api/computer/mjpeg?botId=jaryn&quality=55' -o -

curl -s -X POST http://127.0.0.1:8787/api/computer/takeover \
  -H 'content-type: application/json' -d '{"botId":"jaryn","enabled":true}'
curl -s -X POST http://127.0.0.1:8787/api/computer/input \
  -H 'content-type: application/json' \
  -d '{"botId":"jaryn","event":{"type":"click","x":320,"y":480}}'
```

## 关键概念与配置

配置行 `@jaryn/computer`：

| 配置项 | 默认 | 说明 |
|---|---|---|
| `backend` | `local` | `local` 或 `docker` |
| `dataDir` | `$JARY_HOME/data/computers` | workspace、profile、快照、截图的根目录 |
| `chromePath` | `CHROME_PATH` 或本机 Chrome | local 后端的浏览器路径 |
| `image` | `jaryn-computer:0.2` | docker 镜像 |
| `network` | `none` | docker 网络模式，可设 `bridge` |
| `idleMs` | 未设置 | 配置后空闲到期自动停机 |
| `maxSessionMs` | 14400000（4h） | 单次会话上限 |
| `maxDailyMs` | 28800000（8h） | 每 Bot 每日累计上限 |
| `allowedDomains` | `[]` | `browser.goto` 域名白名单，空表示不限制 |

Docker 后端固定 1 CPU、1 GB 内存、pids 256、`no-new-privileges`，只挂载 workspace 与 profile，CDP 端口映射到 127.0.0.1 的随机端口。

| 工具 | 风险 | 说明 |
|---|---|---|
| `computer.status` / `start` / `stop` / `restart` | 读/执行 | 生命周期 |
| `computer.snapshot` / `restore` | 写/执行 | 快照与回滚 |
| `computer.usage` | 读 | 当日用量与上限 |
| `computer.exec` | 执行 | Docker 后端容器内命令，工作目录 `/workspace` |
| `browser.goto` / `extract` / `click` / `type` / `screenshot` | 网络/读/执行 | 基于 CDP 的页面操作 |

`browser.click` 与 `browser.type` 通过 CSS 选择器定位元素；`browser.extract` 返回页面可见文本并截断到 8000 字符；`browser.screenshot` 把 PNG 写入 `dataDir/<botId>/screenshots/`。模型侧没有任意 JS 执行工具，`CdpClient.evaluate` 只供内部与 Vault 填充使用。

生命周期：`start` 创建或复用实例（已运行则复用并检查配额），`stop` 结束进程/容器并结算用量，`restart` 强制重启，`snapshot` 复制 workspace 与 profile 到 `dataDir/<botId>/snapshots/<label>-<ts>/`，`restore` 先停止实例再删除当前 workspace/profile 并回填快照，不会自动重新启动。

## 常见任务

### 让 Bot 打开网页并提取内容

```bash
jary chat --bot jaryn "打开 https://example.com，提取标题和正文要点"
```

Bot 会依次调用 `browser.goto` 与 `browser.extract`。`browser.goto` 会检查接管状态、域名白名单与配额；工具在未传 `botId` 时操作 `default` 实例，多 Bot 环境需显式指定。

### 在 Web UI 看屏与接管

右侧「屏幕」面板通过 MJPEG 拉流；点击画面会把坐标提交到 `/api/computer/input`，「接管」与「交还」切换 takeover 状态。接管期间 Bot 的写操作类工具（`browser.goto`/`click`/`type`、`computer.exec`/`restart`）会抛错，避免与人工操作冲突；人工输入不受限制。

### 快照与回滚

```bash
curl -s -X POST 'http://127.0.0.1:8787/api/computer/snapshot?botId=jaryn&label=before-transfer'
```

Agent 侧使用 `computer.restore({ botId, path })`，`path` 为快照目录。快照要求实例正在运行；回滚会覆盖当前 workspace 与浏览器 profile，操作前应再次快照。

### 在容器内执行命令

仅 Docker 后端支持。`computer.exec` 默认超时 60 秒，工作目录 `/workspace`，stdout 截断 64 KB、stderr 截断 8 KB，结果末尾附 exit code；local 后端调用会直接报错。

### 查看用量与配额

Agent 可用 `computer.usage` 查看 `day`、`ms`、`sessionMs` 与 `limits`。配额在复用已运行实例的 `start` 与 `browser.goto` 时检查：单次超过 4 小时或当日超过 8 小时会抛错；`computer.restart` 可以重置单次会话计时，但当日额度用尽后仍需等到次日。累计时长在 `stop` 时结算。

### 限制出站域名

```json
[
  { "id": "computer", "name": "@jaryn/computer",
    "config": { "backend": "local", "allowedDomains": ["example.com", "*.trusted.dev"] } }
]
```

模式支持精确主机、`*.suffix` 与 `*`，只拦截 `browser.goto`。生产环境建议同时用 Docker 后端的 `network: "none"` 或网络层策略。

### 经本机出网（隧道）

```bash
jary tunnel --url ws://<jary-host>:8787/tunnel
```

连接建立后服务端为 Chrome 设置本地代理；代理只有一个客户端槽位，隧道离线时请求返回 502。需要重启云电脑，新实例才会带上代理配置。

## 限制与边界

- Local 后端固定 `--headless=new`，画面是浏览器视口，不是完整 Linux 桌面；没有 `desktop.*` 工具，也不能通过 VNC/noVNC 操作桌面。镜像包含 Xvfb/x11vnc/noVNC 组件，但当前工具与看屏链路只接 Chromium。
- 浏览器工具只有 goto/extract/click/type/screenshot；没有滚动、下拉选择、下载、上传、热键等工具。
- 接管标记不会中断已经在执行的 turn；它只让后续写操作类工具失败。
- 快照只包含 workspace 与浏览器 profile，不含容器内存或运行中进程；`restore` 不会重启实例。
- 配额是"检查时抛错"，不是到时强制快照并停机；高风险操作前也不会自动快照。
- `idleMs` 默认未配置，空闲不会自动停机；需要自动停机时显式配置（base patch 未设置）。
- `jary computer` CLI 子命令在独立进程中创建服务，看不到 `jary serve` 持有的实例，命令退出时也会 shutdown；管理常驻云电脑请用 HTTP API 或 Agent 工具。
- 域名白名单仅在 `browser.goto` 生效；Docker 默认 `network: none` 时容器本身不能出网，需要显式改 `bridge`。
- 隧道只影响新启动的 Chrome；看屏、输入与接管接口与其他 API 一样受 `JARY_API_TOKEN` 保护，未设 token 时不要将服务暴露到公网。
- 凭据填充走 Vault（`vault.fill`/`vault.fill_card`），不经过模型上下文；截图仍可能包含页面上的敏感信息，看屏画面与截图文件需按敏感数据处理。
- 没有 microVM、远程云沙箱、Windows/macOS 桌面或多用户协作。

## 相关文档

- [快速上手](../getting-started.md)
- [核心概念](../concepts.md)
- [工具参考](../reference/tools.md)
- [CLI 参考](../reference/cli.md)
- [HTTP API 参考](../reference/http-api.md)
- [配置参考](../reference/configuration.md)
- [Web UI 指南](web-ui.md)
- [Vault 与凭据](vault.md)
- [安全与权限](../operations/security.md)
- [故障排查](../operations/troubleshooting.md)
