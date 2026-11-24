# jaryn-bot

**自托管的个人 AI 同事。** 跑在你自己的云服务器上：它查资料、写文档、跑命令（云电脑在下一阶段）；你通过浏览器派活，流式汇报、危险动作审批；不在线时按计划主动干活。

**状态：v1.9.1 已发布。** 运行时、Web UI、记忆、多 Bot（含 spawn_worker）、主动任务、云电脑（看屏/接管/出网/容器内终端）、Vault、连接器（OAuth 回调）/邮箱（SMTP+IMAP+附件）、Pages、office（docx/xlsx/pptx）、Initiative/teach、goals、usage/审计、审批规则、多设备配对、鉴权、SMTP TLS/附件、`/ws/client` JSON-RPC、6 类主动信号、云电脑配额与域名白名单、Pages 版本回滚、通知中心、**Electron 桌面客户端 + Android 客户端（GitHub Actions 打包）**；**162 个测试；Actions 产出 win/linux 安装包与 Android APK**。逐 FR 完成度见 [docs/14-completion-audit.md](docs/14-completion-audit.md)。

> 目标机器是 **4C4G** 的云服务器，默认容器化、无外部数据库。最新发布说明见 [RELEASE-v1.9.0.md](RELEASE-v1.9.0.md)。

---

## 为什么做这个

Grok Bot 展示了「个人 AI 同事」的产品形态：有自己的电脑、能跨应用干活、会主动提议。但它托管在云上、不能自托管、不能换模型、额度不透明。

jaryn-bot 用**原创实现**把同样的能力做在**你自己的服务器**上：

- **数据主权**：会话、记忆、凭据、产物都在你的磁盘上；出网只有模型 API 与你显式连接的第三方服务。
- **成本可控**：模型可换（默认 DeepSeek API，兼容 OpenAI 协议），每任务/每日预算硬上限。
- **可审计可回放**：append-only 事件流，任何一步都能 replay。
- **隔离更细**：每个 Bot 一台容器电脑（不是每用户一台），任务级快照可回滚。
- **可扩展**：插件化的工具/连接器/通道；开源可改。

## 与 Grok Bot 的关系（重要）

- **灵感来源**：产品形态参考 [Grok Bot](https://docs.x.ai/grok-bot/overview)（xAI / SpaceXAI）。
- **原创代码**：本项目的代码与设计为独立实现，**不包含** Grok Bot 的任何代码、资源或内部资料。
- **无关联**：与 xAI 无任何隶属、合作或背书关系；"Grok"、"Grok Bot" 等商标归其所有者。
- **不承诺等价**：目标是个人版能力对标，不追求团队/会议/企业功能。

详见 [NOTICE.md](NOTICE.md)。

## 已交付能力

| 能力 | 状态 | 说明 |
|---|---|---|
| Web UI（主入口） | ✅ | 会话、流式、工具步骤、审批卡、问题卡、看屏、面板（记忆/任务/页面/产物/例程/提议/用量/审计/通知） |
| Bot 名册 | ✅ | 每个 Bot 独立人格/工具/工作区/记忆/预算；`spawn_worker` 派子任务 |
| 记忆 | ✅ | SQLite+FTS5；digest ≤600 token、0 LLM 写入；容量上限/衰减归档/TTL/定时维护 |
| 例程与主动 | ✅ | cron/every/webhook(HMAC)/RSS、目标多轮、预算护栏、运行历史、通知中心（安静时段） |
| 云电脑（容器） | ✅ | 浏览器/终端、看屏接管（MJPEG/screencast）、任务级快照、本机出网、单次 4h/每日 8h 配额、域名白名单 |
| Vault | ✅ | AES-GCM write-only、模型盲填、Secure Form、授权强制、1Password/Bitwarden/TOTP；**卡信息填表**（默认关、每次审批、值不回传） |
| 连接器 / 邮箱 / Pages | ✅ | Gmail/Calendar/GitHub 示例、OAuth 授权/回调/刷新、SMTP（TLS/STARTTLS/附件）、IMAP 收信、Pages（版本/回滚/分享 TTL） |
| 桌面 / 手机客户端 | ✅ | Electron（Actions 产出 win/linux 安装包）、Android WebView APK；PWA 可用 |
| 协议与扩展 | ✅ | REST + SSE + `/ws/client` JSON-RPC + 出网隧道；组合式插件内核、进程外插件宿主 |

**明确不做（Won't，不再评估）**：团队协作、会议、企业管控（SSO/SCIM/网络策略/组织 API）、语音、SaaS 计费/多租户、**真实支付网关/结算**、IM 通知通道、原生 iOS 客户端。

> 卡能力只做"把已存卡号填进结账页"（默认关闭、每次审批、值不进模型），**不接支付网关、不做扣款/结算、不存 CVV**。完整清单见 [docs/17-scope-and-wont.md](docs/17-scope-and-wont.md)。

## 版本历史（不设开发周期/日期）

| 版本 | 内容 |
|---|---|
| v0.1 | 运行时 + Web UI + 记忆 + 例程 + 多 Bot + 插件 |
| v0.2 | 云电脑（容器）+ 看屏接管 + 任务级快照 + 本机出网 |
| v0.3 | Vault（write-only、盲填、Secure Form、审计/轮换/授权） |
| v0.4 | 连接器 / 邮箱 / Pages / 产物库 |
| v0.5 | Initiative + teach-a-task + PWA |
| v0.6 | 实时看屏/接管/输入 + `jary tunnel` 出网 |
| v0.7 | 多设备配对/令牌/吊销 + 连接器示例 |
| v0.8–v0.9 | 鉴权、入站邮件 webhook、IMAP 收信 |
| v1.0 | 文档/部署/评测自动校验 + 发布说明 |
| v1.1–v1.5 | 审计缺口补齐：fs.write/web.search/ask_user/spawn_worker/用量费用/审批规则/office/goals/通知/1Password/RSS/插件宿主/MJPEG/录屏教学 |
| v1.6–v1.7 | Electron 桌面客户端 + Android 客户端（GitHub Actions 打包） |
| v1.8–v1.9 | 功能缺口收尾：Vault 授权强制、记忆维护、并行工具、plugin add、会话导出、SMTP TLS/附件、后台审批 0 容忍、`/ws/client` RPC、6 类主动信号、云电脑配额、Pages 版本 |

> **不承诺开发周期或发布日期。** 一个版本 = 一组能力 + 退出 Gate；Gate 全过即发（见 [docs/03-roadmap.md](docs/03-roadmap.md)）。

## 文档

设计文档在 [docs/](docs/README.md)：需求、功能规格、接口、架构、插件体系、云电脑、Vault、连接器、主动任务、对标矩阵、路线图、测试与运维、完成度审计、客户端、**不做清单**。

## 开发

技术栈：TypeScript / Node 24（原生运行 TS，无编译步骤）· npm workspaces · SQLite (WAL) + 事件溯源 · HTTP/SSE/WebSocket · 默认 DeepSeek（兼容 OpenAI 协议）。

```bash
node packages/cli/src/index.ts init --home ./data-home
node packages/cli/src/index.ts doctor
node packages/cli/src/index.ts serve --home ./data-home --port 8787
npm test          # 162 tests（串行，含真实 Chrome）
npm run check     # docs + deploy + eval 结构校验
npm run eval      # 真实模型评测（需 DEEPSEEK_API_KEY）
```

## 开发进度

- ✅ **P0 骨架**：kernel、SQLite store（事件回放）、agent 循环、`shell.run`、CLI、Fake provider
- ✅ **P1 真模型**：DeepSeek 流式 + 原生 tool-calling + 重试；`fs.list/glob/grep` 目录检索；上下文压缩；`cancelTurn` 取消；10 任务评测脚本（需 `DEEPSEEK_API_KEY`）
- ✅ **P2 Web UI**：单页 UI（会话列表/流式聊天/工具步骤/审批卡/附件上传）、SSE 事件流、审批桥（允许/拒绝/超时）、会话与文件 API、`jary serve`
- ✅ **P3 记忆 + 多 Bot**：SQLite+FTS5 记忆（bigram 分词、≤600 token digest、0 LLM 写入、目录检索、整理/遗忘）、记忆工具、Bot 名册、任务板（CAS）、Bot 消息总线（hop≤2）、CLI `memory`/`bot`
- ✅ **P4 主动任务**：cron/every/webhook 触发、job 预算与目标多轮、运行历史、`stop-all` 熔断、`/hooks/:id` HMAC
- ✅ **P5 硬化**：Docker 沙箱（可选）、MCP stdio 客户端、插件管理、`/metrics`、备份/恢复、untrusted 包装、Compose/Dockerfile、v0.1.0
- ✅ **v0.2 云电脑**：Local Chrome / Docker 容器后端、`browser.goto/extract/click/type/screenshot`、看屏截图、任务级快照/恢复、`jary computer`、`/api/computer`
- ✅ **v0.3 Vault**：AES-256-GCM write-only 存储、模型盲填（`vault.fill`）、一次性 Secure Form、审计/轮换/授权
- ✅ **v0.4 连接器/邮箱/Pages**：通用 HTTP 连接器（API Key/Bearer、OAuth URL 助手）、SMTP 发信、Pages（表格/报告模板、CSP、分享 token）、产物库
- ✅ **v0.5 Initiative + PWA**：主动提议（失败任务/停滞任务扫描、打分、去重、限额、接受建任务/拒绝/静音）、teach-a-task（草稿/保存/列表）、PWA manifest/service worker
- ✅ **v0.6 看屏/接管/出网**：SSE 实时看屏、接管后暂停 Bot 动作、鼠标/键盘/文本输入、`jary tunnel` 出网隧道（HTTP + CONNECT）
- ✅ **v0.7 多设备 + 示例**：设备配对码/令牌/吊销（phone/desktop/web）、`/api/devices`、`jary device`、GitHub/HTTP 连接器示例
- ✅ **v0.8 鉴权 + 入站邮件**：`JARY_API_TOKEN`（Bearer/设备令牌）保护 `/api/*`；`/api/email/inbound` 入站邮件 webhook
- ✅ **v0.9 IMAP 收信**：IMAP 轮询（SEARCH UNSEEN → FETCH → 标已读）→ `input.email` 事件
- ✅ **v1.0 收尾**：文档/部署/评测自动校验脚本、Docker 说明、发布说明
- ✅ **v1.1–v1.9**：审计缺口全面补齐（详见 [docs/14-completion-audit.md](docs/14-completion-audit.md) 与 [CHANGELOG.md](CHANGELOG.md)）；**162 个测试**

```bash
node packages/cli/src/index.ts init
node packages/cli/src/index.ts config print
node packages/cli/src/index.ts chat --bot jaryn "hello"
node packages/cli/src/index.ts doctor
# 真实模型（需 DEEPSEEK_API_KEY）
node packages/cli/src/index.ts chat --home ~/.jary --patch packages/bundles/deepseek/patch.json "hello"
# Web UI
node packages/cli/src/index.ts serve --port 8787
# → http://127.0.0.1:8787

# 记忆 / 多 Bot
node packages/cli/src/index.ts memory add "以后周报都用中文，结论先行" --kind rule --pinned
node packages/cli/src/index.ts memory catalog
node packages/cli/src/index.ts bot add researcher
node packages/cli/src/index.ts bot list

# 主动任务
node packages/cli/src/index.ts job add --cron "0 8 * * *" --tz Asia/Shanghai --name morning "生成今日简报"
node packages/cli/src/index.ts job list
node packages/cli/src/index.ts job run <id>
node packages/cli/src/index.ts stop-all

# 运维
node packages/cli/src/index.ts backup --out ./backups/now
node packages/cli/src/index.ts plugin doctor
node packages/cli/src/index.ts plugin disable shell

# 云电脑（v0.2）
node packages/cli/src/index.ts computer start --bot default
node packages/cli/src/index.ts computer status --bot default

# Vault（v0.3）
node packages/cli/src/index.ts vault add --name GitHub --origin https://github.com --username me --password ...
node packages/cli/src/index.ts vault list

# 连接器/Pages/产物（v0.4）：通过 profile patch 配置 connectors；Web 打开 /pages/<id>

# 出网隧道（v0.6）：在有家宽/公司网的机器上
node packages/cli/src/index.ts tunnel --url ws://<server>:8787/tunnel
```

开发计划见 [docs/03-roadmap.md](docs/03-roadmap.md)。

## 许可

**AGPL-3.0 + 商业双许可**：

- 默认在 **AGPL-3.0** 下开源：可自由使用、修改、分发；**通过网络提供服务时须公开对应源码**。
- 商业场景（内部商业使用、SaaS、闭源集成、转售等）请联系作者获取**商业授权**（可闭源），见 [COMMERCIAL.md](COMMERCIAL.md)。

贡献欢迎，提交即同意按同一许可证授权（AGPL-3.0），并同时授权作者以商业许可再授权，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 免责声明

本项目处于早期设计/开发阶段，不提供任何担保；用于生产前请自行评估安全与合规。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

---

## English summary

**jaryn-bot** is a self-hosted personal AI teammate runtime: a bot that works on its own containerized computer (browser, terminal, documents, email), reports progress, asks for approval on risky actions, and proactively works on schedules. It is designed to run on a single 4C4G cloud server with Docker and SQLite.

It is **inspired by Grok Bot (xAI), but is an original, independent implementation** — no Grok Bot code or assets are used, and there is no affiliation or endorsement.

**License:** AGPL-3.0 (OSI-approved, strong copyleft) with a commercial dual license. Network use requires publishing your corresponding source under AGPL; for closed/commercial use contact the author for a commercial license — see [COMMERCIAL.md](COMMERCIAL.md).

**Status:** v1.9.0 released — runtime, Web UI, memory, multi-bot, proactive jobs, cloud computer, vault, connectors/email/Pages, notifications, desktop (Electron) and Android clients, `/ws/client` JSON-RPC. 162 tests. A real payment gateway is explicitly out of scope (card *filling* only, disabled by default). Design docs: [docs/README.md](docs/README.md).
