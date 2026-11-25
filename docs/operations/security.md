# 安全

> 适用版本：v1.11.0 · 状态：现行
> 单人自托管的威胁模型：攻击面主要是公网暴露、提示注入与凭据路径；控制点是鉴权、审批、Vault 与审计。

## 1. 威胁模型（单人自托管）

| 资产 | 风险 | 现有控制 |
|---|---|---|
| Vault 中的密码、令牌、卡信息 | 被模型、日志、截图或备份泄漏 | AES-256-GCM 加密、模型盲填、不记录明文 |
| Bot 工作区与产物 | 越权读写宿主文件 | 路径围栏、审批、可选 Docker 沙箱 |
| 服务器与内网 | SSRF、命令执行、容器逃逸 | SSRF 过滤、审批、容器限制、反代隔离 |
| 会话、记忆、审批、审计 | 被未授权客户端读取 | API 令牌、设备令牌、loopback 绑定、TLS |
| 模型 key 与 OAuth 凭据 | 环境变量或配置泄漏 | 只从 env/文件读取，不写入镜像 |

信任边界：

| 边界 | 不可信一侧 | 控制 |
|---|---|---|
| 互联网 → 服务 | 扫描器、匿名访问者 | 只绑 loopback，反代 TLS，`JARY_API_TOKEN` |
| 模型输出 → 工具执行 | 被提示注入的模型输出 | 风险分级与人工审批，后台任务直接拒绝 |
| 网页 / MCP / Bot 消息 → 上下文 | 外部文本 | `mcp.*`、`web.*`、`bot.*` 输出包 `<untrusted>`，动作仍需审批 |
| 第三方插件 → 进程 | 第三方代码 | `jary plugin permissions` 扫描、安装警告 `--trust`、可选进程外宿主 |

明确假设：单 owner、宿主机与部署者可信、反代与操作系统自行加固。多租户、企业身份、合规审计导出不在模型内，见 §8 与 [决策与边界](../design/decisions.md)。

## 2. 鉴权与网络暴露

`jary serve` 默认只绑 `127.0.0.1:8787`；若绑定到非 loopback 且没有设置 `JARY_API_TOKEN`，启动时会打印明确警告。公网部署必须由反代终结 TLS，并**设置 `JARY_API_TOKEN`**：

- **设置令牌**：`/api/*`、`/metrics`、`/ws/client`、`/tunnel` 要求 `Authorization: Bearer <token>`；也接受 `?token=<token>`（浏览器/WS 无法带 header 时）与已配对设备令牌。
- **不设令牌**：进程内直接放行所有请求，此时安全完全依赖 loopback 绑定与反代自身认证。仅限本机/可信内网。

### 2.1 公开路径与受保护路径

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `/`、`/app.js`、`/style.css` 等静态资源 | 无 | 页面本身不含数据；API 仍需令牌 |
| `/healthz` | 无 | 只返回组件挂载状态 |
| `/api/*` | 令牌（Bearer / `?token=` / 设备令牌） | 默认受保护 |
| `POST /api/devices/pair` | 无 | 设备用一次性配对码换令牌；配对码本身需 owner 鉴权生成 |
| `GET /api/oauth/callback/*` | 无（强制 `state`） | 浏览器从 OAuth 提供方重定向回来，无法带 Bearer；用一次性 state 防 CSRF |
| `POST /api/email/inbound` | `x-jary-email-secret` 或令牌 | 共享密钥必须等于 `JARY_EMAIL_SECRET` |
| `/metrics` | 令牌 | Prometheus 文本 |
| `WS /tunnel` | 令牌 | 出网隧道；未鉴权的 upgrade 返回 401 |
| `/pages/<id>`、`/p/<token>`、`/secure/<token>` | 无 | 页面/分享链接/一次性表单，链接本身就是凭据 |

### 2.2 令牌模型

| 令牌 | 生成 | 存储 | 作用域 | 吊销 |
|---|---|---|---|---|
| Owner API 令牌 | 部署者设置 `JARY_API_TOKEN`（建议 `openssl rand -hex 32`） | 环境变量 | 全部 API、WS、审批 | 改环境变量并重启 |
| 设备令牌 | 已鉴权客户端 `POST /api/devices/pair-code` 生成 6 位码（10 分钟、单次），设备 `POST /api/devices/pair` 换取 | 库里只存 SHA-256 | **等价 owner**（无角色细分） | `POST /api/devices/:id/revoke`、`POST /api/devices/revoke-all`、`jary device revoke` |
| Stream ticket | 已鉴权 `POST /api/stream-ticket` | 进程内存，10 分钟 | 仅 `/api/stream`、`/api/computer/screen`、`/api/computer/mjpeg` | 到期自动失效 |

要点：

- **配对码生成必须已鉴权**（v1.13 修复）。此前 `/api/devices/pair-code` 是公开路径，任何可达者都能申领配对码并换取 owner 令牌，等于绕过 `JARY_API_TOKEN`。
- 设备令牌没有权限细分，等同于 owner；给手机/脚本配对前先确认设备可信。默认失败限次为进程内 10 次/10 分钟，重启清零。
- 浏览器不能用 header 发 EventSource/`<img>` 请求，所以 Web UI 先换 **stream ticket** 再连接；长期 API 令牌不会出现在流 URL 里。`?token=` 仍被接受（兼容），但反代日志会记录查询串，建议只在首次引导时使用。
- 首次打开 Web UI 可用 `https://<域名>/?token=<token>`；页面把令牌存进 localStorage 后立即从地址栏移除。
- 令牌比较当前是字符串相等，未做常数时间比较；触发条件是能反复测时延，实际风险低，反代限速可缓解。
- 没有内建请求限速（配对失败限次除外）、没有账号体系与登录页；爆破/连接数/请求体限制应在反代完成。

### 2.3 部署加固清单

1. 只暴露 443；8787 保持 loopback（Compose 默认如此）。
2. 反代终结 TLS 并加 HSTS；示例见 `deploy/Caddyfile`。
3. 设置强随机 `JARY_API_TOKEN`；不要用 URL 传令牌做日常使用。
4. 反代层限制 `POST /api/devices/pair` 频率与来源；不需要配对的部署可直接在 WAF/反代封掉该路径。
5. 不把 `.env`、`data/`、`vault.key` 提交或放进镜像；`.env` 权限 600。
6. 客户端连接公网服务时只用 `https://`；桌面/Android 的服务器地址填 https。

其他边界：

- 请求体上限 1MB；`/api/files` 上传上限 20MB；反代需相应设置 `client_max_body_size`。
- Pages 分享与 Secure Form 只应发给可信对象；分享令牌可设过期时间，Secure Form 10 分钟过期且单次使用。
- 安全响应头由应用统一发送：`Content-Security-Policy`（self、禁内联脚本、禁 frame 嵌入）、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`。

## 3. 审批与风险模型

当前 74 个模型可见工具的风险分布：`read` 26、`write` 29、`network` 3、`execute` 10、`external` 5、`destructive` 1（`vault.fill_card`）。

| 风险 | 默认行为 | 典型工具 |
|---|---|---|
| `read` / `write` / `network` | 自动允许 | `fs.read`、`fs.write`、`web.fetch` |
| `execute` | 逐次审批 | `shell.run` |
| `external` | 逐次审批 | `email.send`、`vault.fill`、`spawn_worker` |
| `destructive` | 逐次审批 | `vault.fill_card`（还需显式开启） |

审批实现（`packages/agent-core/src/approvals.ts`、`rules.ts`）：

- 规则引擎按 `deny > ask > allow` 取最强结果，可匹配工具 glob、风险集合、路径前缀。
- GrantStore 支持一次、会话、永久三种作用域；持久化接口存在但当前 CLI 组合未接入（`packages/agent-core/src/rules.ts`），重启后内存中的 grant 会丢失。
- 无交互通道时**失败即拒绝**；Web 审批默认 30 分钟超时，超时、Abort、连接关闭都记为拒绝。
- 后台 turn（provenance 不是 `owner`：定时任务、目标、子 Bot）**不允许等人**：没有显式 `allow` 规则时，需要审批的工具立即拒绝并将原因记为 `background`；grant 不能替代 allow 规则。
- 审批请求与结果写入 `approvals` 表，同时是 append-only 事件；HTTP `GET /api/approvals` 可查看待决项，`POST /api/approvals/<id>` 以 `{"decision":"allowed"}` 或 `{"decision":"denied"}` 决定。界面交互见 [Web 工作台](../guides/web-ui.md)。

## 4. 凭据（Vault）

- 加密：AES-256-GCM，随机 12 字节 IV，认证标签随密文一起存 SQLite；随机生成 32 字节种子并以 base64 写入 `vault.key`（权限 0600），运行时对文件内容或 `JARY_VAULT_KEY` 做 SHA-256 派生加密密钥（`packages/vault/src/crypto.ts`）。
- 模型不可见：`vault.list` 只返回元数据，`reveal` 仅进程内使用；模型只能触发 `vault.fill` 填表，明文不进入 prompt、事件或截图。
- 填表校验：origin 必须与条目记录的主机一致；条目一旦被授予过 Bot，就进入 `grants_only` 锁定，仅被授权的 Bot（或 `*`）可用，撤销最后一个授权后保持锁定。
- 一次性 Secure Form：公开链接、10 分钟过期、只能提交一次；用于让 owner 在不把密码交给模型的前提下写入 Vault。
- 卡信息：只做“填表”，默认关闭（`vault.allowCardPayments`），每次使用都是 `destructive` 审批；不接任何支付网关、不发起扣款、不做对账。卡数据（含用户自行填写的可选 cvc 字段）只加密存于 Vault，不进入模型上下文——支付网关是永久 Won't，见 [决策与边界](../design/decisions.md)。
- 审计：`vault_events` 记录 add、fill、denied、rotate、grant、revoke，可用 `jary vault events` 查看。
- 备份：Vault 密文随数据库备份，主密钥**不在** `jary backup` 内；丢失 `vault.key` 即无法解密，密钥应与备份分离保管。

## 5. 沙箱、路径围栏、SSRF 与不可信输出

| 面 | 实现 | 备注 |
|---|---|---|
| 文件路径 | `fs.*` 以会话工作区为根，`resolve` 后要求相对路径不越界 | 拒绝 `..` 与绝对路径；实现未做 realpath，不要在工作区放指向敏感路径的符号链接 |
| 命令执行 | `shell.run` 在 cwd 下 `sh -c`，30 秒超时、32KB 输出上限 | 风险 `execute`，逐次审批 |
| Docker 沙箱 | `packages/bundles/docker/patch.json` 挂载 sandbox：`--network none`、`--memory 512m`、`--cpus 0.5`、`--pids-limit 128`、`no-new-privileges`、只挂当前工作区 | 需要 Docker；宿主机仍需自行限制 Docker socket |
| 云电脑 | Docker 镜像内 Chromium + CDP；可配域名白名单与配额 | 容器内 `--no-sandbox`，隔离依赖容器边界 |
| SSRF | `web.fetch` 仅允许 http/https；拒绝 URL 内凭据、localhost/`.local`/`.internal`、私网/回环/链路本地地址；DNS 解析结果与最终 URL 都复查 | 2MB 响应上限、正文截断 20k |
| 不可信输出 | 工具结果中 `mcp.*`、`web.*`、`bot.*` 包 `<untrusted>` 后回注模型 | 降低注入成功率，不替代审批；最终控制仍是人对高风险动作的确认 |
| 第三方插件 | 默认进程内运行；安装时提示来源风险，`jary plugin permissions` 扫描 `jaryn.permissions` 声明；可用 `plugin-host` 放进程外 | 进程外宿主降低崩溃/逃逸面，不改变其可调用工具的风险等级 |

提示注入无法被完全消除：恶意网页可以诱导模型请求 `external`/`destructive` 工具，防线是“默认审批 + 后台任务拒绝 + 审计可回放”，不是信任模型。

## 6. 审计与响应

- SQLite 中可直接检查：`events`（append-only 全事件）、`approvals`、`audit`、`vault_events`、`usage`。
- 常用命令：`jary audit --limit 50`、`jary session replay <id>`、`jary usage`、`jary vault events`、`jary session export <id>`。
- 会话导出默认对 password、secret、token、api key、authorization、card、cvc 等键脱敏；`JARY_EXPORT_RAW=1` 会关闭脱敏，只应在受控环境临时使用。
- 服务不记录逐请求日志，也不写日志文件；MCP/进程外插件的 stderr 带前缀转发。排查时依赖 SQLite 表与容器日志，不要把密钥放进会打印的环境变量。
- 建议每月复核：`external`/`destructive` 动作与拒绝记录、插件启停与安装、设备列表（`jary device list`）、Vault 授权（`jary vault list` 与 events）。

## 7. 漏洞报告

安全问题不要在公开 issue 披露。报告渠道、范围与响应承诺见 [SECURITY.md](../../SECURITY.md)：GitHub 私密漏洞报告或作者私信，48 小时内确认，修复前不公开细节。

报告时请附：影响版本、复现步骤、影响面（能否读凭据、越权执行、逃逸容器）、建议修复方向。重点范围：鉴权与设备配对、Vault 与凭据填充、沙箱逃逸与跨 Bot 访问、提示注入导致未授权 external 动作、SSRF/路径穿越/命令注入。

## 8. 明确不做（Won't 摘要）

| 项 | 边界 |
|---|---|
| 多租户、团队协作、共享 Bot | 单 owner；多设备仍是同一 owner |
| SSO/SCIM、企业网络策略、审计导出与保留策略 | 单机审计已有，不做企业管控 |
| 真实支付网关、扣款、对账 | 只做卡信息填表，默认关闭；不接网关、不发起扣款 |
| IM 通知通道 | 通知只在 Web 内 |
| 原生 iOS 客户端、真 WebRTC 串流 | 需平台签名或完整媒体栈 |
| 插件索引签名校验、进程外插件细粒度限额 | 当前有权限声明与进程外宿主，签名未做 |
| OS 级强隔离（microVM/Firecracker） | 云电脑为 Docker 容器，隔离强度依赖容器 |

完整清单与变更规则：[决策与边界](../design/decisions.md)。

相关：[部署](deployment.md) · [测试](testing.md) · [排错](troubleshooting.md) · [Vault 指南](../guides/vault.md) · [工具清单](../reference/tools.md)
