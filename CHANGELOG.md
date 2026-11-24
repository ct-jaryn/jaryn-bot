# Changelog

## v1.9.1 — 文档边界澄清（支付网关永久不做）

### Docs

- 新增 [docs/17-scope-and-wont.md](docs/17-scope-and-wont.md)：**明确不做清单**（真实支付网关/结算、IM 通道、团队/会议/企业/语音/多租户、原生 iOS、真 WebRTC）+ 待外部条件项 + 变更规则
- PRD / 功能规格 / 路线图 / Vault / 对标矩阵 / 决策清单 / 完成度审计同步：**真实支付网关永久不做**，只保留卡信息填表（默认关、每次审批、不存 CVV、值不回传）
- README 状态区重写：已交付能力表、明确不做清单、版本历史（v0.1→v1.9）、测试数 162；修正英文摘要里过时的"design phase"描述
- 去掉"卡支付待定包/暂缓"等过时表述


## v1.9.0 — 邮件 TLS / 后台审批 / WS 协议 / 主动信号

### Added / Fixed

- **SMTP 全面重写**：隐式 TLS(465)、STARTTLS（auto/require）、AUTH PLAIN + AUTH LOGIN、多行应答解析、附件、HTML 正文、RFC2047 主题
- **后台任务审批 0 容忍**：jobs/goals/workers 的 ask 风险工具立即拒绝（`background-policy`），不会被 30 分钟超时拖住；可用 allow 规则预批
- **设备配对限次**：窗口内失败次数上限（默认 10/10min），防暴力猜码
- **工具输出落盘**：>32KB 自动存 artifact 并返回指针
- **`/ws/client` JSON-RPC**：ping/session.list/create/subscribe/turn.send/turn.cancel/approval.respond/usage.total + 事件推送，支持 token 鉴权
- **Initiative 信号扩到 6 类**：任务失败、任务停滞、目标停滞、日历临近（45min）、连接器失效、未读邮件；接受提议后立即执行任务
- **云电脑上限与边界**：单次 4h、每日 8h、域名 egress 白名单、`computer.restart`、`computer.usage`
- **Pages**：版本历史（20 版）+ 回滚、分享链接过期时间与撤销
- 162 个测试


## v1.8.0 — 补齐功能审计缺口

### Fixed / Added

- **Vault 授权强制**：`fill` / `fill_card` 现在校验 `vault_grants`（无授权记录则默认允许 owner，有记录则必须匹配 bot）
- **记忆维护**：容量上限（默认 5000）、episode TTL、按得分衰减归档、超限淘汰、每 6 小时自动维护
- **工具并行**：`parallelSafe` 且非审批风险的调用并发执行（≤4）
- **`jary plugin add/remove`**：npm / git / file 安装到 profile，写入 patch 行；`--trust` 提示
- **`jary session export`**（脱敏 JSONL，`JARY_EXPORT_RAW=1` 关闭脱敏）与 `session delete --yes`
- **Pages 导出**：`pages.export` 工具 + `GET /api/pages/:id/export`
- **Web 文本命令**：`/status /compact /new /stop /memory /forget /remember /artifacts /jobs /bots /approvals /help`
- **维护插件** `@jaryn/maintenance`：30 天自动归档会话、清理停滞 goal
- 137 个测试（含并行执行、命令、维护、授权）


## v1.7.0 — Android 客户端

### Added

- `mobile/android/`：Kotlin WebView 瘦客户端（服务器地址保存、返回键后退、JS/DOM storage）
- `.github/workflows/mobile-android.yml`：JDK 17 + Gradle 8.7 `assembleDebug` → APK 上传/tag 附 Release
- Actions 实测产出：`app-debug.apk` 3.1 MB（426 项，含 classes.dex/resources.arsc/AndroidManifest.xml）
- Web：启动时从 Vault 恢复 OAuth access_token 到连接器
- 文档 `16-mobile-client.md`


## v1.6.0 — 桌面客户端（GitHub Actions 打包）

### Added

- `desktop/`：Electron 瘦客户端（窗口/菜单/服务器地址+API token 配置/导航守卫）
- electron-builder 目标：macOS dmg（x64/arm64）、Windows NSIS、Linux AppImage/deb
- `.github/workflows/desktop.yml`：tag/手动触发，构建 win/linux 并附到 Release
- `.github/workflows/desktop-macos.yml`：macOS 单独、非阻塞（runner 不在所有 plan 可用）
- `.github/workflows/ci.yml`：workspace 链接 + 测试 + docs/deploy/desktop 校验
- `scripts/link-workspaces.mjs`、`scripts/check-desktop.ts`
- GitHub Actions 实际产出：Windows 78MB exe、Linux 103MB AppImage / 71MB deb（已校验）
- 132 个测试


## v1.5.1 — MJPEG 看屏

### Added

- `GET /api/computer/mjpeg`：`multipart/x-mixed-replace` 原生视频流（首帧立即发送），Web UI 看屏改用 MJPEG（SSE 作为回退保留）
- 128 个测试


## v1.5.0 — 录屏教学 / 设备令牌与 SSE

### Added

- 操作录制：`computer.startRecording/record/stopRecording`，记录 goto/click/type/key 步骤
- `teach.record_start` / `teach.record_stop`：录制结束直接产出 SKILL.md 草稿
- SSE 设备令牌鉴权：`/api/stream?token=<device token>`（EventSource 无法带 header 的场景）
- 127 个测试


## v1.4.0 — 收尾剩余 🟡 项

### Added

- `skill.load` 工具（按名加载 SKILL.md）
- 审批：`always` 持久授权（GrantStore persistence）
- Web：`POST /api/sessions/:id/command`（`/status`、`/compact`）
- Initiative：可配置定时自动扫描（`scanEveryMs`）
- 产物：保留期自动清理（`artifactToolsPlugin({ retentionDays })`）
- Bot：`bot remove --purge` 清理 workspace
- 125 个测试


## v1.3.0 — 通知中心 / Bitwarden / 卡填充

### Added

- `@jaryn/notifications`：通知表 + 未读计数 + 安静时段（越夜窗口判定）；例程完成/Initiative/新邮件自动通知
- Web：`/api/notifications`（list/read/read-all）、通知铃铛与通知面板（15s 轮询未读数）
- `@jaryn/secrets`：1Password 与 Bitwarden（`bw get item --raw`）读取 + 填充代理；TOTP 保留
- Vault：卡类型与 `vault.fill_card`（默认关闭，risk=destructive 每次审批，值不回传）
- 123 个测试


## v1.2.0 — RSS / 1Password / 进程外插件 / 快速看屏

### Added

- 调度：`rss` 触发器（feed 轮询、按新条目派发、去重）
- `@jaryn/secrets-1password`：`op read` 读取 + 页面填充代理；RFC 6238 TOTP
- `@jaryn/plugin-host`：进程外插件宿主（JSON-RPC 工具代理）+ `examples/plugin-host` 示例
- 云电脑：CDP `Page.startScreencast` 看屏（更高帧率），Web UI 默认使用 screencast 模式
- 示例：Gmail / Google Calendar 连接器配置 + OAuth 自建应用指南
- 117 个测试


## v1.1.0 — 补齐审计缺口

### Added

- 工具：`fs.write` / `fs.edit`、`web.search` / `web.fetch`（DNS/私网 SSRF 防护）、`ask_user`、`schedule.*`、`artifact.present`、`bot.spawn_worker` / `bot.inbox`、`computer.exec`、`vault.rotate` / `vault.grant`、`office.docx/xlsx/pptx`、`goal.*`
- 会话：标题、归档、删除、fork、`/api/sessions/:id/cancel`
- 多 Bot：`spawn_worker` 子会话落在 bot workspace；会话按 bot 路由 cwd；`bot.edit`
- 用量/费用：usage 表、按模型记账、`maxCostUsd` 预算、`/api/usage`、`jary usage`
- 审批：规则引擎（deny>ask>allow、glob/risk/path）、once/session 授权、approvals/audit 表、`/api/rules`
- 技能：SKILL.md 目录注入 system prompt
- 邮件：HTML→文本、MIME base64 附件→artifact、发件人 allowlist
- 连接器：OAuth 授权 URL + `/api/oauth/callback/:id` 换 token 并存 Vault
- 云电脑：空闲自动停机（可配）、容器网络策略、镜像增加 Xvfb/x11vnc/noVNC、容器内 `computer.exec`
- 插件：`jaryn.permissions` 声明 + `jary plugin permissions` 扫描
- Web UI：停止按钮、ask_user 卡片、面板（记忆/任务/页面/产物/例程/提议/用量/审计）、会话重命名/归档/删除、bot 选择
- 文档：[14 完成度审计](docs/14-completion-audit.md)；109 个测试


## v1.0.0 — 收尾与发布

### Added

- `scripts/check-docs.ts`：代码围栏/表格列数/相对链接/必需文件校验
- `scripts/check-deploy.ts`：Dockerfile/compose 与 CLI 插件注册表一致性校验
- `evals/run.ts --dry`：无 key 也能做 10 任务结构校验；有 key 跑真实评测
- `deploy/README.md`、`npm test` / `npm run check` / `npm run eval` 脚本
- 76 个测试（含 docs/deploy 校验）


## v0.9.0 — IMAP 收信

### Added

- `@jaryn/email` 的 IMAP 客户端：LOGIN → SELECT → SEARCH UNSEEN → FETCH RFC822 → STORE \Seen
- `imapInboxPlugin`：轮询收信 → 写 `input.email` 事件到 `email` 会话，`email/received` 事件
- 测试用假 IMAP 服务器覆盖协议链路与事件落库
- 74 个测试


## v0.8.0 — API 鉴权 + 入站邮件

### Added

- 可选 API 鉴权：`JARY_API_TOKEN` 设置后 `/api/*` 需要 `Authorization: Bearer`（也接受设备令牌/`?token=`）
- 入站邮件 webhook：`POST /api/email/inbound`（可选 `x-jary-email-secret`）→ 写 `input.email` 事件到 `email` 会话
- `.env.example` 增加 token/secret；部署文档补充
- 71 个测试


## v0.7.0 — 多设备配对 + 连接器示例

### Added

- `@jaryn/devices`：6 位一次性配对码（10 分钟）、设备令牌（sha256 存储）、设备列表/吊销
- Web API：`/api/devices/pair-code|pair|list|:id/revoke`
- CLI：`jary device pair-code|list|revoke`
- 连接器示例：GitHub（Bearer token）、httpbin（API Key）；`examples/connectors/`
- 70 个测试


## v0.6.0 — 实时看屏 / 接管 / 本机出网

### Added

- SSE 实时看屏：`/api/computer/screen?botId&fps`，Web UI 看屏面板
- 人工接管：`/api/computer/takeover`；接管期间 Bot 的浏览器动作被拒绝
- 输入通道：点击（坐标）、文本、按键 → CDP Input
- `@jaryn/tunnel`：WebSocket 出网隧道，服务器本地 HTTP/CONNECT 代理经客户端网络转发；`jary tunnel --url ws://.../tunnel`
- 云电脑启动时自动使用隧道代理（新启动的实例）
- 67 个测试


## v0.5.0 — Initiative / teach-a-task / PWA

### Added

- `@jaryn/initiative`：信号摄入、打分（影响×紧急×置信−噪音）、阈值、24h 去重、每日限额、接受/拒绝/静音
- 扫描源：失败/超预算 job、停滞任务（>3 天）
- `@jaryn/initiative` 的 teach：步骤→SKILL.md 草稿、保存到 `$JARY_HOME/skills`、列表
- Web：`/api/initiative`（list/scan/accept/dismiss）、`/api/teach`
- PWA：`manifest.json`、`sw.js`（shell 缓存、API 不缓存）、图标
- 66 个测试


## v0.4.0 — 连接器 / 邮箱 / Pages / 产物

### Added

- `@jaryn/connectors`：通用 HTTP 连接器（API Key/Bearer、路径参数、超时），OAuth 授权 URL 助手；工具 `<id>.<tool>`
- `@jaryn/email`：SMTP 发信（EHLO/AUTH LOGIN/MAIL/RCPT/DATA），`email.send`
- `@jaryn/pages`：Pages（表格/报告模板、更新、分享 token、CSP 无脚本渲染、导出）
- `@jaryn/artifacts`：产物库（20MB 上限、sha256、列表/读取）
- CLI/Web：`/api/pages`、`/pages/:id`、`/p/:token`、`/api/artifacts`、`/api/vault*`
- 62 个测试


## v0.3.0 — Vault 凭据

### Added

- `@jaryn/vault`：AES-256-GCM 加密、write-only 存储、元数据列表不含 secret
- 填充代理 `vault.fill`：按 origin 校验后把账号/密码写入页面，模型与日志不见明文
- 一次性 Secure Form：`/api/vault/secure-form` + `/secure/:token` 表单 → 直接入库
- 审计（add/fill/rotate/remove/grant）、轮换、授权
- CLI `jary vault add|list|remove|rotate|events`；Web `/api/vault*`
- 56 个测试


## v0.2.0 — 云电脑

### Added

- `@jaryn/computer`：每 Bot 一台电脑（Local Chrome headless / Docker 容器后端）
- CDP 客户端：导航、取文本、点击、输入、截图
- 浏览器工具：`browser.goto/extract/click/type/screenshot`、`computer.start/stop/status/snapshot/restore`
- 任务级快照/恢复（workspace + 浏览器 profile）
- CLI `jary computer status|start|stop|snapshot`；Web `/api/computer` + `/api/computer/screenshot`
- Docker 镜像 `deploy/computer/Dockerfile` + `packages/bundles/docker-computer` patch
- 真实 Chrome 端到端测试；51 个测试


## v0.1.0 — 首个可用版本

包含 P0–P5：
- 运行时（插件内核/事件溯源/SQLite）、DeepSeek 流式与工具调用
- Web UI（SSE、审批桥、附件、会话/文件 API）、`jary serve`
- 记忆（FTS5、digest、目录检索、整理）、多 Bot 名册/任务板/消息总线
- 主动任务（cron/every/webhook、预算、目标多轮、历史、stop-all）
- 硬化：Docker 沙箱、MCP 客户端、插件管理、`/metrics`、备份/恢复、untrusted 包装
- 47 个测试、Dockerfile/compose、发布说明 [RELEASE-v0.1.0.md](RELEASE-v0.1.0.md)


## Unreleased — P4 主动任务（已完成）

### Added

- `@jaryn/scheduler`：cron（5 字段 + 时区）、every、webhook（HMAC-SHA256）触发
- job 模型：mission、预算（步数/工具数/墙钟/轮数）、投递会话、运行历史、启停
- goal 多轮：`maxRounds` 循环直到 `DONE` 或预算截断
- `stop-all`：暂停调度并取消运行中的 turn
- Web API：`/api/jobs`、`/api/jobs/:id/run|enable|disable|runs`、`/hooks/:id`
- CLI：`job add|list|run|enable|disable|remove|runs`、`stop-all`
- 测试：cron 计算、job 执行、目标多轮、预算截断、webhook 签名，共 41 个

## Unreleased — P3 记忆 + 多 Bot（已完成）

### Added

- `@jaryn/memory`：SQLite + FTS5 记忆（bigram 分词、pinned、digest ≤600 token、目录检索 catalog/list/read、候选池 + 规则抽取 + 整理、遗忘）
- 记忆工具：`memory.remember/search/list/catalog/read/forget`
- agent loop：自动注入 digest、每轮规则抽取候选（0 LLM）
- `@jaryn/bots`：Bot 名册（独立 workspace/memory ns）、Bot 消息总线（hop≤2）、`bot.list_agents/send_message`
- `@jaryn/tasks`：任务板（create/claim/complete/list，CAS 版本）
- CLI：`memory add|list|search|catalog|digest|forget|consolidate`、`bot add|list|remove`
- Web API：`/api/memory`、`/api/bots`、`/api/tasks`
- 测试：tokenizer/FTS/digest/整理、bot 名册与 hop、任务板协作、记忆 API、digest 注入，共 36 个

## Unreleased — P2 Web UI（已完成）

### Added

- `@jaryn/web`：单页 Web UI（会话列表、流式聊天、工具步骤、审批卡、附件上传）
- HTTP API：`GET/POST /api/sessions`、`POST /api/message`、`GET /api/stream`（SSE）、`GET /api/events`、`GET/POST /api/approvals`、`GET/POST /api/files`、`/healthz`
- 审批桥：execute/external/destructive 默认 ask；允许/拒绝/超时（默认 deny）三路径
- CLI：`jary serve --port 8787`
- 测试：UI 服务、聊天事件、审批允许/拒绝/超时、文件上传下载，共 27 个

## Unreleased — P1 真模型（已完成）

### Added

- `@jaryn/llm-deepseek`：OpenAI 兼容流式、原生 tool-calling、reasoning、usage、429/5xx 重试、AbortSignal
- `@jaryn/tools-fs`：`fs.read/list/glob/grep`，工作区内路径校验、忽略目录、结果上限
- agent-core：正确的 tool_calls/tool 消息回填、上下文压缩（阈值可配，摘要落 `memory.consolidated`）、`cancelTurn`
- `evals/`：10 个任务与评测脚本（无 key 时跳过）
- CLI：接入 DeepSeek patch、fs 插件；`config print` 显示新增行
- 测试：provider SSE/重试、fs 工具与路径逃逸、压缩、取消，共 22 个

## Unreleased — P0 骨架（已完成）

### Added

- `@jaryn/kernel`：Context 树、服务 provide/inject、effect/disposer、事件（emit/parallel/serial/waterfall）、插件 Loader（profile/bundle/patch、拓扑排序、fail-loud）
- `@jaryn/store-sqlite`：SQLite 事件表、会话表、append/replay、WAL
- `@jaryn/agent-core`：turn 循环、预算（步数/工具数/墙钟）、工具注册表、事件落库、历史装配
- `@jaryn/tools-shell`：`shell.run`（超时/输出截断/取消）
- `@jaryn/testing`：FakeProvider / echo provider
- `@jaryn/cli`：`init`、`config print`、`chat`、`session list|replay`、`doctor`、`version`
- `packages/bundles/base/patch.json`：基础组合（store/llm/tools/shell/agent）
- 15 个测试：kernel、store、agent loop、shell、CLI 验收（含"禁用 shell 后模型看不到"、`kill -9` 后重开回放）

### Notes

- 当前仅 P0：模型为 echo/Fake provider；真实 DeepSeek 适配、上下文压缩、Web UI 属于 P1/P2。
