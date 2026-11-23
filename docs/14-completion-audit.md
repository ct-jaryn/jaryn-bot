# 14 · 完成度审计（设计 vs 代码）

> 状态：**现行**（v1.6.0 后）。方法：逐条对照 `01-functional-spec.md` 的 FR-1…FR-19 与 `00-prd.md` 需求池，检查代码里**实际注册的工具、HTTP 路由、CLI 命令、DB 表**，而不是看提交信息。
> 复算命令：`npm test`（串行执行）、`npm run check`、`node scripts/check-docs.ts`、`node scripts/check-deploy.ts`、`node packages/cli/src/index.ts doctor`。

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
| FR-2 | 会话 | ✅ | 建/列/标题/归档/删除/fork/回放、选会话续聊 | 自动标题（LLM） |
| FR-3 | IM 通知 | ⛔ | 按决策不做（Web 单入口） | — |
| FR-4 | Agent 运行 | ✅ | 流式、工具循环、重试、压缩、步数/工具数/墙钟/**费用**预算、`/stop`（API+UI）、usage 记账 | 无 |
| FR-5 | 工具集 | ✅ | 51 个工具：fs.read/write/edit/list/glob/grep、shell、web.search/fetch(SSRF)、memory.*、task.*、bot.*（含 spawn_worker/inbox）、browser.*、computer.*（含 exec）、vault.*（含 rotate/grant）、pages.*、artifact.*、email.send、office.docx/xlsx/pptx、initiative.*、teach.*、schedule.*、ask_user、goal.* | 无（已补 `skill.load`） |
| FR-6 | 审批 | ✅ | 风险分级、规则引擎（deny>ask>allow、glob/risk/path）、once/session/**always 持久授权**、超时默认拒绝、approvals+audit 表 | 后台 0 容忍可通过规则配置 |
| FR-7 | 记忆 | ✅ | FTS5+bigram、pinned、≤600 token digest、catalog/list/read、整理、遗忘、tags | 语义检索（可选，未做） |
| FR-8 | 多 Bot | ✅ | 名册、workspace 隔离、spawn_worker 子会话、任务板 CAS、消息总线 hop≤2、inbox | 对等群聊（设计不做） |
| FR-9 | 主动任务 | ✅ | cron/every/webhook(HMAC)/RSS、预算、目标多轮、运行历史、stop-all、**通知中心 + 安静时段** | 投递到 IM（无 IM） |
| FR-10 | 产物 | ✅ | artifact 库、office docx/xlsx/pptx（纯 TS OOXML）、present、Pages、**保留期自动清理** | — |
| FR-11 | 命令 | ✅ | Web：新会话/停止/看屏/面板/`/status`/`/compact`（command API）；CLI 24+ 子命令 | — |
| FR-12 | 运维 | ✅ | doctor、config print、replay、plugin（list/doctor/permissions/enable/disable/index）、backup/restore、stop-all、usage/audit | — |
| FR-13 | 插件 | ✅ | 组合/patch、拓扑排序、fail-loud、诊断、索引源、权限声明扫描、**进程外插件宿主**（JSON-RPC 工具代理 + 示例插件） | 索引签名校验 |
| FR-14 | 客户端 | ✅ | Web UI、PWA、SSE（设备令牌鉴权）、设备配对/令牌/吊销、多面板、**Electron 桌面客户端（GitHub Actions 打包 win/linux；macOS 工作流就绪）** | 原生 iOS/Android（需单独工程与商店签名，明确不做） |
| FR-15 | 云电脑 | 🟡 | 本地 Chrome/Docker、browser.*、截图、快照/恢复、看屏（截图轮询 / CDP screencast / **MJPEG 原生流**）、接管、输入、`computer.exec`、空闲自动停机、容器网络策略、镜像含 Xvfb/x11vnc/noVNC | 真 WebRTC；桌面镜像未在真机验证（需 docker） |
| FR-16 | Vault | ✅ | AES-GCM write-only、盲填、Secure Form、审计、轮换、grant/revoke、1Password、Bitwarden、TOTP、**卡填充（默认关 + destructive 审批）** | —（真实支付网关明确不做） |
| FR-17 | 连接器/邮箱 | ✅ | 通用 HTTP、Bearer/APIKey、OAuth 授权 URL + 回调换 token（存 Vault）、SMTP、IMAP 轮询、HTML→文本、附件→artifact、发件人 allowlist | 官方 Gmail/Calendar 应用（需自注册+审核，配置已支持） |
| FR-18 | Pages/产物 | ✅ | create/update/list/share、CSP 渲染、`/pages/:id`、`/p/:token`、office 产物 | 交互脚本（设计为禁用） |
| FR-19 | Initiative/teach | ✅ | 信号(2 类)/打分/阈值/去重/日限额/接受建任务/静音、定时自动扫描、teach 草稿-保存-列表-加载、**操作录制→技能草稿**（teach.record_start/stop）、技能目录注入 prompt | — |

## 新增（不在原 FR 列表）

| 能力 | 状态 | 说明 |
|---|---|---|
| 持久目标（goal） | ✅ | `goals` 表 + `goal.set/status/run/pause` + 自动多轮（DONE/BLOCKED 判定）+ 注入 prompt |
| 用量与费用 | ✅ | `usage` 表、按模型记账、`maxCostUsd` 预算、`jary usage`、`/api/usage` |
| 审计 | ✅ | `audit` 表、`jary audit`、`/api/audit` |
| 审批规则管理 | ✅ | `GET/POST /api/rules`、`approvalRules` 服务 |

## 总量

- 31 个包、约 **10.6k 行 TS**（`packages/*/src`）、前端约 350 行
- **132 个测试**（40 个测试文件，含真实 Chrome/screencast、假 IMAP/SMTP/MCP/HTTP 服务、office 包结构校验）
- **65 个工具注册点**（含 MCP/插件宿主动态注册）、55 条 HTTP 路由、20+ CLI 子命令
- 文档：27 份 markdown（约 5.4k 行）+ 11 份发布说明
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

## 仍需外部条件或明确不做

| 项 | 类型 | 说明 |
|---|---|---|
| 真实模型评测（10 任务） | 🚧 | 需要 `DEEPSEEK_API_KEY`；`npm run eval` |
| Docker 镜像构建/运行实测 | 🚧 | 需要 docker；`deploy/README.md` |
| 桌面客户端 | ✅ | Electron 瘦客户端，GitHub Actions 产出 win/linux 安装包（见 [15](15-desktop-client.md)）；macOS 需可用 runner |
| 原生 iOS/Android | ⛔ | PWA 可加主屏；原生需独立工程与商店签名，明确不做 |
| 真实支付网关 | ⛔ | 仅做卡信息填表，不做支付结算 |
| 官方 Gmail/Calendar OAuth 应用 | 🚧 | 需自建 OAuth 应用（示例与回调已就绪） |
| 实时低延迟串流（WebRTC） | 未做 | 已提供 CDP screencast + MJPEG（浏览器原生渲染，延迟低于 SSE）；真 WebRTC 未做 |
| 进程外插件宿主 | ✅ | `@jaryn/plugin-host` + 示例插件 |
| IM 投递 | 未做 | 按决策不做 IM；通知中心已实现（含安静时段） |
| 团队协作 / 会议 / 企业管控 / 语音 / 多租户 | ⛔ | 决策明确不做 |
