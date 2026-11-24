# 能力审计

> 适用版本：v1.11.0 · 状态：现行
> 代码与测试对照出的能力矩阵：哪些已交付、哪些有明确缺口、哪些按决策不做。

审计方法是**对照代码而不是对照提交信息**：逐个检查实际注册的工具、HTTP 路由、CLI 命令、数据库表与测试文件。数字由 `node scripts/inventory.ts` 维护，全量清单见 [代码清单](../reference/inventory.md)。

## 口径

| 状态 | 含义 |
|---|---|
| ✅ | 核心行为已实现，并有测试覆盖 |
| 🟡 | 主路径可用，存在明确缺口，或尚未在目标环境验证 |
| ⛔ | 按决策不做（边界，不是缺陷） |

复算命令：`npm test`（串行）、`npm run check`（文档/部署/清单/评测结构）、`npm run smoke`（CLI 端到端）、`node scripts/inventory.ts`、`node evals/run.ts --dry`、`node packages/cli/src/index.ts doctor`。

## 能力矩阵

| 模块 | 状态 | 已实现 | 缺口/边界 |
|---|---|---|---|
| 组合与插件内核 | ✅ | profile → bundle → patch、`provides/inject/optional` 拓扑排序、fail-loud、`config print`、`plugin doctor/permissions/add/remove`、插件索引源、进程外宿主 | 索引签名校验未做；改插件需重启（无 HMR） |
| 事件与回放 | ✅ | append-only `events` + `seq`、`session replay/fork/export`、会话自动归档（maintenance）、`/api/events`、SSE | — |
| Agent 循环 | ✅ | 流式输出、工具循环、上下文压缩、预算（步数/工具/墙钟/费用）、`/stop` 取消、并行安全工具并发（≤4）、usage 记账 | — |
| 工具系统 | ✅ | 74 个工具：fs、shell、web、browser、computer、memory、task、bot、goal、vault、pages、artifact、office、email、initiative、teach、schedule、ask_user、spawn_worker | 输出 >32KB 自动落 artifact；`web/mcp/bot` 输出标注不可信 |
| 审批 | ✅ | 6 级风险、规则引擎（deny > ask > allow）、once/session/always、超时拒绝、后台轮次 0 容忍、`approvals` + `audit`、`/api/rules` | 规则里的 `thread` 作用域尚未使用（无 IM，用 `session` 等价） |
| 记忆 | ✅ | FTS5 + bigram、pinned、每轮 ≤600 token digest、catalog/list/read、整理、遗忘、标签、容量上限、衰减归档、TTL、定时维护 | 语义检索（embedding）未做，属可选增强 |
| 多 Bot 协作 | ✅ | 名册、每 Bot 工作区隔离、`spawn_worker` 子会话、任务板 CAS、Bot 消息总线（hop ≤ 2、限速、去重）、inbox | 对等群聊按决策不做 |
| 持久目标 | ✅ | `goals` 表、`goal.set/status/run/pause`、自动多轮（DONE/BLOCKED 判定）、prompt 注入 | — |
| 主动任务 | ✅ | cron / every / webhook(HMAC) / RSS、预算护栏、运行历史、`stop-all`、通知中心 + 安静时段 | 投递到 IM 按决策不做 |
| 提议与教学 | ✅ | 6 类信号（任务失败/停滞、目标停滞、日历临近、连接器失效、未读邮件）、打分/阈值/去重/日限额、接受即执行、静音、录制→技能 | — |
| 产物与 Office | ✅ | artifact 库、docx/xlsx/pptx、`present`、保留期自动清理 | — |
| Pages | ✅ | 创建/更新/列表/分享（过期、撤销）、版本历史（20 版）与回滚、CSP 渲染、导出 HTML | 交互脚本按设计禁用（CSP `script-src 'none'`） |
| 云电脑 | ✅ | local/docker 后端、`browser.*`、截图、快照/恢复、看屏三级（截图 / CDP screencast / MJPEG）、接管、输入、`computer.exec`、空闲停机、单次 4h/每日 8h、导航域名白名单 | 桌面镜像未在真机验证（需 Docker）；真 WebRTC ⛔ |
| Vault 与凭据 | ✅ | AES-256-GCM write-only、盲填、Secure Form、审计、轮换、grant/revoke、1Password、Bitwarden、TOTP（secrets 读取）、卡信息填表（默认关 + 逐次审批 + 值不回传） | 真实支付网关/结算 ⛔ |
| 连接器 | ✅ | 通用 HTTP、Bearer/API Key、OAuth 授权/回调/刷新 | 官方 Gmail/Calendar 应用需部署者自注册（OAuth 链路已实现） |
| 邮件 | ✅ | SMTP（465 隐式 TLS / STARTTLS / AUTH PLAIN+LOGIN / 附件 / HTML）、IMAP 轮询、HTML→文本、附件→artifact、发件人 allowlist、入站 webhook | — |
| Web 工作台与 API | ✅ | 63 条路由、SSE 流、`/ws/client` 双向 JSON-RPC（session/turn/approval/usage）、审批卡/问题卡、看屏接管、侧边面板 | — |
| 客户端 | ✅ | PWA、Electron 桌面、Android WebView、设备配对（失败限次）/令牌/吊销 | 原生 iOS ⛔（需 macOS + Xcode + 签名） |
| CLI | ✅ | 23 个命令：init/chat/serve/config/doctor/tools/plugin/bot/session/memory/job/goal/computer/vault/tunnel/device/usage/audit/backup/restore/stop-all/version/help | 命令集中在 `packages/cli`，未插件化 |
| 运维与部署 | 🟡 | doctor、backup/restore、stop-all、`/healthz`、`/metrics`、Dockerfile + compose、反代 TLS 文档 | Docker 镜像未在真机构建/运行实测 |
| 测试与自动校验 | ✅ | 64 个测试文件 / 178 个用例（真实 Chrome、假 IMAP/SMTP/TLS/MCP 服务、office 包结构、CLI 冒烟）、check-docs / check-deploy / check-inventory / evals --dry | 真实模型评测需 API key |
| 真实模型端到端评测 | 🟡 | 10 任务评测脚本与结构校验就绪（`node evals/run.ts --dry`） | 需 `DEEPSEEK_API_KEY` 才能跑真实分 |
| 桌面安装包 | 🟡 | GitHub Actions 产出 win/linux 安装包 | macOS `.dmg` 需可用的 macOS runner（`desktop-macos.yml` 已就绪） |

## 总量（v1.10.0）

| 项 | 数量 |
|---|---|
| 包（`packages/*`） | 31 |
| 已加载插件 | 41（默认 base 组合） |
| 模型可见工具 | 74（read 26 / write 29 / execute 10 / network 3 / external 5 / destructive 1） |
| HTTP 路由 | 63 |
| SQLite 表 | 28 |
| CLI 命令 | 23 |
| 组合 patch（`packages/bundles/*`） | 7 |
| TypeScript 源码 | 约 9.8k 行（`packages/*/src`） |
| 测试 | 64 个文件 / 178 个用例 |
| 前端静态资源 | 约 490 行（`packages/web/src/public`） |

## 待外部条件（不是缺陷）

| 项 | 状态 | 卡在哪 |
|---|---|---|
| 真实模型评测（10 任务） | 🟡 | 需要 `DEEPSEEK_API_KEY`；`npm run eval` |
| Docker 镜像构建/运行实测 | 🟡 | 需要一台有 Docker 的机器；步骤见 `deploy/README.md` |
| 云电脑桌面镜像真机验证（Xvfb / VNC / noVNC） | 🟡 | 同上，需要 Docker |
| macOS 安装包（`.dmg`） | 🟡 | 需要可用的 macOS runner；`desktop-macos.yml` 已就绪 |

## 结论与边界

- **已交付**：内核组合、事件回放、Agent 循环、74 个工具、审批、记忆、多 Bot、主动任务、产物/Pages/Office、云电脑、Vault、连接器与邮件、Web/API/客户端、CLI、测试与自动校验。
- **有明确缺口但不阻塞**：语义检索、插件索引签名、桌面镜像验证、真实模型评测、macOS 打包。
- **按决策不做**：真实支付网关/结算、团队/会议/企业/语音/多租户、IM 通道、原生 iOS、真 WebRTC、桌面 GUI。完整边界与变更规则见 [决策与边界](decisions.md) §6、§7。
