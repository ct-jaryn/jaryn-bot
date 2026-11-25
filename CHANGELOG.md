# 更新记录

> 适用版本：v1.13.0 · 状态：现行

按版本倒序。每一条只写"用户可见的变化"；设计取舍见 [决策与边界](docs/design/decisions.md)，能力现状见 [能力审计](docs/design/audit.md)。

## v1.13.0 — 服务端与客户端鉴权审计

安全修复（按严重度）：

- **严重：设备配对鉴权绕过**。`POST /api/devices/pair-code` 原为公开路由，任何可达者都能生成配对码并换取 **owner 级设备令牌**，绕过 `JARY_API_TOKEN`。现在生成配对码必须已鉴权；配对本身仍公开（设备只持有一次性码）。
- **高：`/tunnel` WebSocket 未鉴权**。任何人都能注册为出网隧道客户端。现在 upgrade 需 API/设备令牌（`?token=`，因为 WebSocket 客户端无法带自定义头），匿名返回 401；`jary tunnel` 支持 `--token` 或 `JARY_API_TOKEN`。
- **中：OAuth 回调 state 可选**。未配置 `JARY_OAUTH_STATE_*` 时旧代码不校验 state（CSRF/账号串联）。现在必须匹配一次性 state（由新增 `GET /api/oauth/authorize/:id` 签发，10 分钟）或显式配置的静态 state，否则 400。
- **中：未签名的 webhook 例程可被任何请求触发**。现在 webhook job 必须配置 secret（CLI/HTTP 创建时就拒绝），触发时强制 HMAC 校验。
- **中：设备令牌缺少吊销全部入口**。新增 `POST /api/devices/revoke-all`。

其他：

- 浏览器流式端点改用 **10 分钟 stream ticket**（`POST /api/stream-ticket`），长期 API 令牌不再出现在 SSE/看屏 URL 中；`?token=` 保留兼容。首次用 `?token=` 打开 Web UI 后立即从地址栏移除。
- 统一安全响应头：CSP（self、禁内联脚本、禁 frame 嵌入）、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`。
- 非 loopback 绑定且未设 `JARY_API_TOKEN` 时启动打印警告。
- Android 客户端支持填写 API Token（首开以 `?token=` 引导，随后正常使用）；桌面端修复 token 未从配置传给页面。
- 新增 `deploy/Caddyfile`（TLS、HSTS、SSE/WS 反代）；部署/安全/API/客户端文档同步鉴权模型。
- 测试 178 → 184（鉴权绕过回归、stream ticket 作用域、OAuth state、tunnel 鉴权、webhook secret、设备吊销）。

## v1.12.1 — macOS 客户端 ad-hoc 签名

- macOS 包在无 Developer ID 时由 `after-pack` 钩子对整个 `.app` 做 ad-hoc 签名，修复 Gatekeeper 报"已损坏"，首次打开只需右键 →「打开」。
- 发布说明/客户端文档补充 macOS 打开方式；签名/公证仍需证书。

## v1.12.0 — 自动打包流水线

- 统一 `release.yml`：tag / 手动 / 每周一定时三入口，一次产出 **Windows / Linux / macOS / Android** 客户端。
- macOS 恢复自动构建：改用可用的 `macos-15` runner（`macos-13` 已下线、`macos-14` 在本账号返回 configuration not supported），一次构建 x64 + arm64 两个 dmg。
- tag 构建自动创建/更新 GitHub Release：版本从 tag 注入（桌面 `package.json`、Android `versionName`/`versionCode`），Release notes 从 CHANGELOG 抽取，附 `SHA256SUMS.txt`。
- 定时/手动构建产出 `0.0.0-main.<sha>` 快照 artifacts，不创建 Release，用于发现打包链路断裂。
- 缓存 electron/electron-builder 下载，缩短重复构建时间。
- 新增 [自动打包](docs/operations/release.md) 文档（触发方式、产物、免费 runner、签名、排错）；`check:desktop` 改为校验统一工作流与旧工作流不再存在。
- 桌面/Android 版本号 1.12.0。

## v1.11.0 — 文档重构

- 文档结构重做：`docs/` 按 **指南 / 参考 / 运维 / 设计** 四类组织，取代旧的编号式设计文档；删除 PRD、路线图、对标分析、逐版本发布说明等历史文档。
- README 重写：定位、与聊天机器人的区别、快速开始、能力表、架构图、文档索引、安全边界。
- 新增：核心概念、快速开始、工具清单（自动生成）、代码清单（自动生成）。
- 文档与代码同步修正：Web 工作台文本命令与面板、`/ws/client` 方法、路由鉴权、SMTP/IMAP 配置方式、云电脑看屏模式与实际配额语义等。
- `npm run check` 增加清单一致性校验；文档结构、状态头、链接由 `scripts/check-docs.ts` 校验。

## v1.10.0 — 全量代码与文档梳理

- 修复：OAuth 回调被 API token 拦截；邮件入站支持 `JARY_EMAIL_SECRET`；Vault `grant/revoke` 崩溃与"撤销后人人可用"；Docker 镜像漏链 16 个包。
- 新增：`jary tools`、CLI 管理动作写审计、`npm run smoke`、`npm run inventory`。
- 测试 162 → 178。

## v1.9.0 — 邮件 TLS / 后台审批 / WS 协议 / 主动信号

- SMTP 重写：465 隐式 TLS、STARTTLS、AUTH PLAIN/LOGIN、附件、HTML、RFC2047 主题。
- 后台任务审批零容忍：遇到需审批工具立即拒绝（allow 规则可预批）。
- 设备配对限次；工具输出 >32KB 落盘 artifact。
- `/ws/client` JSON-RPC（session/turn/approval/usage + 事件）；Initiative 信号扩到 6 类，接受即执行。
- 云电脑单次 4h/每日 8h 配额、域名白名单、`computer.restart`；Pages 版本历史/回滚/分享 TTL。

## v1.8.0 — 功能缺口补齐

- Vault 授权强制、记忆容量/TTL/衰减维护、`parallelSafe` 工具并发、`plugin add/remove`、`session export`（脱敏）、Pages 导出。
- Web 文本命令扩展；`@jaryn/maintenance` 自动归档会话。

## v1.7.0 — Android 客户端

- Kotlin WebView 客户端 + GitHub Actions 构建 APK；Web 启动时从 Vault 恢复 OAuth token。

## v1.6.0 — 桌面客户端

- Electron 瘦客户端（窗口/菜单/服务器配置/导航守卫）+ electron-builder 目标；GitHub Actions 产出 Windows/Linux 安装包。

## v1.5.0–v1.5.1 — 录屏教学 / MJPEG 看屏

- 操作录制 → 技能草稿（`teach.record_start/stop`）；设备令牌可用于 SSE。
- `/api/computer/mjpeg` 原生 MJPEG 看屏，Web 端默认使用。

## v1.4.0 — 收尾剩余部分项

- `skill.load`、审批 always 持久授权、会话命令 API（`/status`、`/compact`）、Initiative 定时扫描、产物保留期清理、`bot remove --purge`。

## v1.3.0 — 通知中心 / Bitwarden / 卡填充

- 通知表 + 未读计数 + 安静时段；Bitwarden 读取；卡信息填表（默认关、每次审批、不接支付网关）。

## v1.2.0 — RSS / 1Password / 进程外插件 / 快速看屏

- RSS 触发、1Password/TOTP、`@jaryn/plugin-host`、CDP screencast、Gmail/Calendar 示例配置。

## v1.1.0 — 审计缺口补齐

- `fs.write/edit`、`web.search/fetch`（SSRF 防护）、`ask_user`、`schedule.*`、`spawn_worker`、用量/费用、审批规则与审计、office docx/xlsx/pptx、goals、通知、技能注入。

## v1.0.0 — 收尾

- 文档/部署/评测自动校验、Docker 说明、发布说明；76 个测试。

## v0.2.0–v0.9.0 — 能力包

- v0.2 云电脑（Local/Docker、快照、看屏；v0.6 接管/输入/出网隧道）
- v0.3 Vault（AES-GCM、盲填、Secure Form）
- v0.4 连接器/邮箱/Pages/产物
- v0.5 Initiative/teach/PWA
- v0.7 多设备配对/令牌/吊销
- v0.8 鉴权 + 入站邮件 webhook
- v0.9 IMAP 收信

## v0.1.0 — 运行时

- 插件内核、SQLite 事件溯源、agent 循环、`shell.run`、CLI、Web UI、记忆、多 Bot、例程、Docker 沙箱、MCP、备份恢复。
