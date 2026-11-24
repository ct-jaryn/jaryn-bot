# 14 · 完成度审计（设计 vs 代码）

> 状态：**现行**（v1.10.0 后）。数字与工具/路由清单见 [18 代码清单](18-code-inventory.md)（自动生成）。方法：逐条对照 `01-functional-spec.md` 的 FR-1…FR-19 与 `00-prd.md` 需求池，检查代码里**实际注册的工具、HTTP 路由、CLI 命令、DB 表**，而不是看提交信息。
> 复算命令：`npm test`（串行）、`npm run check`、`npm run smoke`（CLI 端到端）、`npm run inventory`（刷新 [18](18-code-inventory.md)）、`node scripts/check-docs.ts`、`node scripts/check-deploy.ts`、`node packages/cli/src/index.ts doctor`。

## 口径

| 状态 | 含义 |
|---|---|
| ✅ | 该 FR 的核心行为全部实现并有测试 |
| 🟡 | 主路径可用，仍有明确缺口（下方"缺"列） |
| ⛔ | 设计明确不做（非缺陷） |
| 🚧 | 需外部条件（API key / Docker / 第三方应用审核） |

## 矩阵

| FR | 模块 | 状态 | 已实现 | 仍缺 |
|---|---|---|---|---|
| FR-1 | Bot 管理 | ✅ | add/list/edit/remove（`--purge` 清理 workspace）、记忆命名空间、会话按 bot 路由 | — |
| FR-2 | 会话 | ✅ | 建/列/标题/归档/删除/fork/回放、选会话续聊、**30 天自动归档（maintenance）**、导出 JSONL | 自动标题（LLM） |
| FR-3 | IM 通知 | ⛔ | 按决策不做（Web 单入口） | — |
| FR-4 | Agent 运行 | ✅ | 流式、工具循环、重试、压缩、预算（步数/工具/墙钟/费用）、`/stop`、usage 记账、**并行安全工具并发执行** | 无 |
| FR-5 | 工具集 | ✅ | **74 个工具**：fs.read/write/edit/list/glob/grep、shell、web.search/fetch(SSRF)、memory.*、task.*、bot.*（含 spawn_worker/inbox）、browser.*、computer.*（含 exec/restart/usage）、vault.*（含 rotate/grant/fill_card）、pages.*（含 versions/rollback/export）、artifact.*、email.send、office.docx/xlsx/pptx、initiative.*、teach.*（含录制）、schedule.*、ask_user、goal.* | 无（含输出 >32KB 自动落盘 artifact） |
| FR-6 | 审批 | ✅ | 风险分级、规则引擎、once/session/always 授权、超时默认拒绝、approvals+audit 表、**后台任务 0 容忍（立即拒绝，可用 allow 规则预批）** | thread 作用域（无 IM 场景等价于 session） |
| FR-7 | 记忆 | ✅ | FTS5+bigram、pinned、≤600 token digest、catalog/list/read、整理、遗忘、tags、**容量上限/衰减归档/TTL/定时维护** | 语义检索（可选，未做） |
| FR-8 | 多 Bot | ✅ | 名册、workspace 隔离、spawn_worker 子会话、任务板 CAS、消息总线 hop≤2、inbox | 对等群聊（设计不做） |
| FR-9 | 主动任务 | ✅ | cron/every/webhook(HMAC)/RSS、预算、目标多轮、运行历史、stop-all、**通知中心 + 安静时段** | 投递到 IM（无 IM） |
| FR-10 | 产物 | ✅ | artifact 库、office docx/xlsx/pptx、present、Pages（含导出 HTML）、保留期自动清理 | — |
| FR-11 | 命令 | ✅ | Web 文本命令：`/status /compact /new /stop /memory /forget /remember /artifacts /jobs /bots /approvals /help`；CLI 26+ 子命令 | — |
| FR-12 | 运维 | ✅ | doctor、config print、replay、plugin（list/doctor/permissions/enable/disable/index）、backup/restore、stop-all、usage/audit | — |
| FR-13 | 插件 | ✅ | 组合/patch、拓扑排序、fail-loud、诊断、索引源、权限声明扫描、进程外宿主、**`plugin add/remove`（npm/git/file）** | 索引签名校验 |
| FR-14 | 客户端 | ✅ | Web UI、PWA、SSE、**`/ws/client` JSON-RPC（双向：session/turn/approval/usage）**、设备配对（**失败限次**）/令牌/吊销、Electron 桌面端、Android WebView 客户端 | iOS（需 macOS+Xcode+签名，未做） |
| FR-15 | 云电脑 | ✅ | 本地 Chrome/Docker、browser.*、截图、快照/恢复、看屏（截图轮询 / CDP screencast / **MJPEG 原生流**）、接管、输入、`computer.exec`、空闲自动停机、容器网络策略、镜像含 Xvfb/x11vnc/noVNC、**单次 4h/每日 8h 上限**、**域名 egress 白名单**、`computer.restart`/`computer.usage` | 真 WebRTC；桌面镜像未在真机验证（需 docker） |
| FR-16 | Vault | ✅ | AES-GCM write-only、盲填、Secure Form、审计、轮换、grant/revoke（**填充时强制校验授权**）、1Password、Bitwarden、TOTP、**卡信息填表**（默认关 + destructive 审批 + 值不回传） | **真实支付网关/结算：永久不做**（见 [17](17-scope-and-wont.md)） |
| FR-17 | 连接器/邮箱 | ✅ | 通用 HTTP、Bearer/APIKey、OAuth 授权/回调/刷新、SMTP（**465 隐式 TLS / STARTTLS / AUTH PLAIN+LOGIN / 附件 / HTML 正文**）、IMAP 轮询、HTML→文本、附件→artifact、发件人 allowlist | 官方 Gmail/Calendar 应用（需自注册+审核，配置已支持） |
| FR-18 | Pages/产物 | ✅ | create/update/list/share（**过期时间/撤销**）、**版本历史 20 版 + 回滚**、CSP 渲染、`/pages/:id`、`/p/:token`、导出 HTML、office 产物 | 交互脚本（设计为禁用） |
| FR-19 | Initiative/teach | ✅ | 信号(**6 类**：任务失败/任务停滞/目标停滞/日历临近/连接器失效/未读邮件)/打分/阈值/去重/日限额、**接受后立即执行**、静音、定时扫描、teach 录制→技能、技能目录注入 | — |

## 新增（不在原 FR 列表）

| 能力 | 状态 | 说明 |
|---|---|---|
| 持久目标（goal） | ✅ | `goals` 表 + `goal.set/status/run/pause` + 自动多轮（DONE/BLOCKED 判定）+ 注入 prompt |
| 用量与费用 | ✅ | `usage` 表、按模型记账、`maxCostUsd` 预算、`jary usage`、`/api/usage` |
| 审计 | ✅ | `audit` 表、`jary audit`、`/api/audit` |
| 审批规则管理 | ✅ | `GET/POST /api/rules`、`approvalRules` 服务 |

## 总量

- 31 个包、约 **10.6k 行 TS**（`packages/*/src`）、前端约 350 行
- **178 个测试**（64 个测试文件：真实 Chrome/screencast/MJPEG、假 IMAP/SMTP/TLS/MCP/HTTP 服务、office 包结构、CLI 冒烟与导出脱敏）
- **74 个工具**、**63 条 HTTP 路由**、**23 个 CLI 命令**（自动统计见 [18](18-code-inventory.md)）
- 文档：**24 份设计文档 + 23 份发布说明**（README/CHANGELOG/NOTICE 等另计）
- 自动化校验：`check-docs`（结构/链接）、`check-deploy`（镜像/注册表）、`evals --dry`（10 任务结构）

## 里程碑对应

| 里程碑 | 状态 |
|---|---|
| M0 组合生效 / 回放 | ✅ |
| M1 能干真活 | ✅（真实模型需 key） |
| M2 每天可用（Web） | ✅ |
| M3 记得住 / 多 Bot 协作 | ✅ |
| M4 不用开口（例程 + Initiative） | ✅（Initiative 扫描为手动/工具触发） |
| M5 能给别人部署 | 🚧 Docker 镜像未实测（本机无 docker）；备份/恢复/校验已就绪 |
| M6 能操作网页 | ✅（浏览器/截图/接管/快照） |

## 仍需外部条件（Won't 清单见 [17](17-scope-and-wont.md)）

| 项 | 类型 | 说明 |
|---|---|---|
| 真实模型评测（10 任务） | 🚧 | 需要 `DEEPSEEK_API_KEY`；`npm run eval` |
| Docker 镜像构建/运行实测 | 🚧 | 需要 docker；`deploy/README.md` |
| 桌面客户端 | ✅ | Electron 瘦客户端，GitHub Actions 产出 win/linux 安装包（见 [15](15-desktop-client.md)）；macOS 需可用 runner |
| Android 客户端 | ✅ | WebView 壳，Actions 产出 APK（见 [16](16-mobile-client.md)） |
| 原生 iOS 客户端 | ⛔ **Won't** | PWA 可加主屏；Android 客户端已有 |
| 真实支付网关/结算 | ⛔ **Won't** | 仅做卡信息填表；不接 gateway、不扣款、不存 CVV（[17](17-scope-and-wont.md)） |
| 官方 Gmail/Calendar OAuth 应用 | 🚧 | 部署者自建应用即可；授权/回调/刷新已实现（[17](17-scope-and-wont.md) §2） |
| 实时低延迟串流（WebRTC） | 未做 | CDP screencast + MJPEG 已满足日常看屏；WebRTC 需媒体栈，收益低 |
| 进程外插件宿主 | ✅ | `@jaryn/plugin-host` + 示例插件 |
| IM 投递 | 未做 | 按决策不做 IM；通知中心已实现（含安静时段） |
| 团队协作 / 会议 / 企业管控 / 语音 / 多租户 | ⛔ **Won't** | 决策明确不做（[17](17-scope-and-wont.md)） |
