# jaryn-bot

**自托管的个人 AI 同事。** 一个跑在你自己服务器上的常驻智能体：它有自己的工作区和云电脑，能读写文件、跑命令、查网页、发邮件、生成文档表格、按计划主动干活；危险动作先问你，全部过程可回放、可审计。

[![License](https://img.shields.io/badge/license-AGPL--3.0%20%2B%20commercial-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-178%20passing-brightgreen)](docs/operations/testing.md)
[![Version](https://img.shields.io/badge/version-v1.12.1-informational)](CHANGELOG.md)

设计目标是一台 **4C4G** 云服务器、单 owner、Web 优先、默认云模型 API。不依赖外部数据库，不依赖第三方运行时包，`node` 直接跑 TypeScript。

---

## 它和"聊天机器人"的区别

| 普通聊天机器人 | jaryn-bot |
|---|---|
| 只会回话 | 会**动手**：文件、终端、浏览器、邮件、Office 文档、页面 |
| 一个对话框 | **多个 Bot** 各有工作区、记忆、预算；可互相派活 |
| 你问才答 | **主动**：cron / RSS / webhook / 信号提议，接受即执行 |
| 看不到过程 | **append-only 事件流**，每一步可回放、可审计 |
| 凭据暴露在上下文里 | **Vault**：模型看不到密码，只能"用"密码填表 |
| 跑在别人云上 | 你的机器、你的磁盘、你的模型 key |

## 快速开始

```bash
git clone https://github.com/ct-jaryn/jaryn-bot.git && cd jaryn-bot

node packages/cli/src/index.ts init --home ./data-home
node packages/cli/src/index.ts doctor          # 检查环境与插件组合
node packages/cli/src/index.ts serve --home ./data-home --port 8787
# → http://127.0.0.1:8787
```

接真实模型（默认 DeepSeek，兼容 OpenAI 协议）：

```bash
export DEEPSEEK_API_KEY=sk-...
node packages/cli/src/index.ts serve --home ./data-home \
  --patch packages/bundles/deepseek/patch.json
```

Docker（生产推荐，带反代）：

```bash
cp .env.example .env      # 填 JARY_API_TOKEN；DEEPSEEK_API_KEY 可选
docker compose -f deploy/docker-compose.yml up -d --build
```

桌面 / 手机客户端见 [客户端指南](docs/guides/clients.md)；完整安装与验证见 [快速开始](docs/getting-started.md)。

## 能力

| 能力 | 说明 |
|---|---|
| **Web 工作台** | 流式对话、工具步骤、审批卡、问题卡、看屏接管、侧边面板（记忆/任务/页面/产物/例程/提议/用量/审计/通知） |
| **多 Bot** | 每个 Bot 独立人格、工具集、工作区、记忆命名空间、预算；`spawn_worker` 派子任务 |
| **记忆** | SQLite FTS5 + bigram；每轮 ≤600 token 摘要；容量上限、衰减归档、TTL、定时维护 |
| **主动任务** | cron / every / webhook(HMAC) / RSS；目标多轮；6 类提议信号；通知中心（安静时段） |
| **云电脑** | 本机 Chrome 或 Docker 容器；看屏（截图/SSE/screencast/MJPEG）、接管、输入、快照恢复、容器内终端；4h/日 8h 配额、域名白名单 |
| **Vault** | AES-256-GCM write-only、模型盲填、一次性 Secure Form、授权锁定、1Password/Bitwarden/TOTP、卡信息填表（默认关，不接支付网关） |
| **连接器 / 邮箱** | 通用 HTTP + OAuth（授权/回调/刷新）、Gmail/Calendar 示例、SMTP（TLS/STARTTLS/附件）、IMAP 收信 |
| **产物** | artifact 库、Pages（版本/回滚/分享 TTL）、docx/xlsx/pptx（纯 TS 生成，无外部依赖） |
| **客户端** | Web/PWA、Electron（Windows/Linux 安装包）、Android APK；设备配对与令牌吊销；`/ws/client` JSON-RPC |
| **工程** | 插件内核（组合 + patch + 权限声明 + 进程外宿主）、178 个测试、CI 打包、文档/部署/清单自动校验 |

## 架构

```
               浏览器 / Electron / Android / CLI
                            │  HTTP · SSE · /ws/client
                    ┌───────▼────────┐
                    │  jary serve     │  单进程
                    │  ├ 插件内核      │  profile → bundle → patch
                    │  ├ Agent 循环    │  工具 · 审批 · 预算
                    │  ├ 事件溯源      │  append-only + replay
                    │  └ 调度/记忆/通知 │
                    └───┬────────┬────┘
                        │        │
              SQLite(WAL)   云电脑（每 Bot）
              $JARY_HOME    Chrome / Docker + CDP
```

细节：[架构](docs/design/architecture.md) · [核心概念](docs/concepts.md) · [插件](docs/guides/plugins.md)。

## 文档

| 入口 | 内容 |
|---|---|
| [快速开始](docs/getting-started.md) | 安装、配置模型、第一次派活、验证 |
| [核心概念](docs/concepts.md) | 会话/事件、工具、审批、Bot、云电脑、Vault 的心智模型 |
| [使用指南](docs/README.md#使用指南) | Web UI、客户端、记忆、主动任务、云电脑、Vault、连接器/邮箱、Pages/产物、插件 |
| [参考](docs/reference/cli.md) | [CLI](docs/reference/cli.md) · [HTTP/WS API](docs/reference/http-api.md) · [工具清单](docs/reference/tools.md) · [配置](docs/reference/configuration.md) · [事件](docs/reference/events.md) |
| [运维](docs/operations/deployment.md) | [部署](docs/operations/deployment.md) · [自动打包](docs/operations/release.md) · [安全](docs/operations/security.md) · [测试](docs/operations/testing.md) · [排错](docs/operations/troubleshooting.md) |
| [设计](docs/design/architecture.md) | [架构](docs/design/architecture.md) · [决策与边界](docs/design/decisions.md) · [能力审计](docs/design/audit.md) |
| [更新记录](CHANGELOG.md) | 各版本变更 |

## 开发

```bash
npm test          # 178 tests（串行；含真实 Chrome、TLS、WS）
npm run check     # docs + deploy + desktop + inventory + evals 结构校验
npm run smoke     # CLI 端到端冒烟
npm run inventory # 重新生成 docs/reference/inventory.md 与 docs/reference/tools.md
npm run eval      # 真实模型评测（需 DEEPSEEK_API_KEY）
```

无 npm 依赖、无编译步骤：Node 24 直接运行 `.ts`；`node scripts/link-workspaces.mjs` 建立包间链接（`npm test` 会自动执行）。

## 安全与边界

- 网络默认只绑 `127.0.0.1`；公网部署必须配置反代 TLS 与 `JARY_API_TOKEN`。见 [安全](docs/operations/security.md)。
- 风险模型：`read`/`write`/`network` 自动允许，`execute`/`external`/`destructive` 默认逐次审批；后台任务不允许等人，直接拒绝（可用 allow 规则预批）。
- 明确不做（Won't）：真实支付网关/结算、IM 通知通道、团队/会议/企业管控/语音/多租户、原生 iOS、真 WebRTC。见 [决策与边界](docs/design/decisions.md)。
- 安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 与 Grok Bot 的关系

产品形态参考 [Grok Bot](https://docs.x.ai/grok-bot/overview)（xAI）：**灵感来源，原创实现**，不包含其任何代码或资源，与 xAI 无隶属或背书关系；"Grok"、"Grok Bot" 商标归其所有者。见 [NOTICE.md](NOTICE.md)。

## 许可

**AGPL-3.0 + 商业双许可**：个人/开源使用按 AGPL-3.0（通过网络提供服务须公开对应源码）；商业闭源集成、SaaS、转售请联系作者获取商业授权，见 [COMMERCIAL.md](COMMERCIAL.md)。贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)。

> 项目仍在快速演进，不提供担保；生产使用前请自行评估安全与合规。

---

## English

**jaryn-bot** is a self-hosted personal AI teammate runtime. It runs on your own server with its own workspace and cloud computer: files, terminal, browser, email, Office documents, web pages, scheduled and proactive work — with human approval for risky actions, an append-only event log for replay/audit, and credentials that never enter the model context.

Single owner, Web-first, 4C4G-friendly, no external database, no runtime npm dependencies: Node 24 executes TypeScript directly. 178 tests; CI packages Windows/Linux/macOS desktop installers and an Android APK, with SHA256 checksums, on every version tag.

Docs start at [docs/README.md](docs/README.md). License: AGPL-3.0 with a commercial dual license ([COMMERCIAL.md](COMMERCIAL.md)). An original implementation inspired by Grok Bot — no affiliation.
