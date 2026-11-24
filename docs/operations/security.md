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

`jary serve` 默认只绑 `127.0.0.1:8787`。公网部署必须由反代终结 TLS，并二选一：

- **设置 `JARY_API_TOKEN`**：`/api/*` 与 `/metrics` 要求 `Authorization: Bearer <token>`，也接受 `?token=<token>`。令牌比较为字符串相等，未做时序安全比较；不要通过 URL 传递，查询串会进入反代与浏览器历史。
- **不设令牌**：代码直接放行所有到达进程的请求（`authorized` 在 `apiToken` 为空时返回 true）。此时安全完全依赖 loopback 绑定与反代自身的认证。

公开与受保护路径（`packages/web/src/index.ts`）：

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `/`、`/app.js`、`/style.css` 等 | 无 | Web UI 静态资源 |
| `/healthz` | 无 | 返回 store/agent/memory/scheduler 挂载状态 |
| `/api/*` | API 令牌或设备令牌 | 其他接口默认受保护 |
| `/api/devices/pair-code`、`/api/devices/pair` | 无 | 设备配对，见下 |
| `/api/oauth/callback/*` | 无 | 由 `state` 校验（仅在配置了对应环境变量时） |
| `/api/email/inbound` | 共享密钥或 API 令牌 | `x-jary-email-secret` 等于 `JARY_EMAIL_SECRET` 时放行，否则按普通 API 鉴权 |
| `/metrics` | API 令牌 | Prometheus 文本 |
| `/pages/<id>`、`/p/<token>`、`/secure/<token>` | 无 | 页面、分享链接、一次性表单，链接本身就是凭据 |

设备配对：`pair-code` 生成 6 位数字、10 分钟有效的一次性码；`pair` 换发 32 字节随机设备令牌（库中只存 SHA-256）。配对失败有窗口限次（默认 10 次/10 分钟），设备令牌可被 `jary device revoke` 吊销，并可用于 HTTP `/api/*` 与 `/ws/client`。注意两点：

1. 两个配对端点都是公开路径。若服务可被公网访问，任何可达者都能先申领配对码再换取 owner 令牌；必须在反代限制来源地址，或不要公网暴露配对路径。
2. `/ws/client` 与 HTTP 使用同一套校验：`JARY_API_TOKEN`、`?token=` 或已配对设备令牌均可，接入方式见 [客户端指南](../guides/clients.md)。

其他边界：

- 没有内建请求限速（配对失败限次除外），登录爆破防护、并发与连接数限制应在反代完成。
- 请求体上限 1MB；`/api/files` 上传上限 20MB；反代需相应设置 `client_max_body_size`。
- 浏览器 UI 可用 `?token=<JARY_API_TOKEN>` 打开，令牌会存入 localStorage 并附加到后续请求；查询串会进入反代日志，更稳妥的是反代注入 `Authorization` 或做独立认证。
- Pages 分享与 Secure Form 只应发给可信对象；分享令牌可设过期时间，Secure Form 10 分钟过期且单次使用。

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
