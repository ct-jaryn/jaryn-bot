# jaryn-bot

**自托管的个人 AI 同事。** 跑在你自己的云服务器上：它查资料、写文档、跑命令（云电脑在下一阶段）；你通过浏览器派活，流式汇报、危险动作审批；不在线时按计划主动干活。

> **状态：v0.3.0 已发布（Vault 凭据）。** 在 v0.2 基础上加入 write-only Vault（AES-GCM）、模型盲填、Secure Form、审计与轮换；56 个测试通过。见 [RELEASE-v0.3.0.md](RELEASE-v0.3.0.md)。目标机器是 **4C4G** 的云服务器，默认容器化、无外部数据库。

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

## 规划中的能力

| 能力 | 说明 | 版本 |
|---|---|---|
| Web UI（主入口） | 会话、流式、审批卡、产物、多会话 | v0.1 |
| Bot 名册 | 每个 Bot 独立人格/工具/工作区/记忆/预算 | v0.1 |
| 记忆 | SQLite+FTS5；digest ≤600 token、0 LLM 写入、每晚整理；可查看/遗忘 | v0.1 |
| 例程与主动 | cron/webhook/邮件触发、目标多轮、预算护栏 | v0.1 |
| 云电脑（容器） | 浏览器/终端、看屏接管、任务级快照、本机出网；Bot 可自建测试容器 | 下一阶段 |
| Vault | write-only 凭据、模型盲填、Secure Form | 暂缓 |
| 连接器 / 邮箱 / Pages | Gmail/Calendar/GitHub、个人邮箱、可交互产物 | 暂缓 |
| 桌面/手机客户端 | 设备配对、多端同步 | 暂缓 |

**明确不做**：团队协作、会议、企业管控（SSO/SCIM/网络策略/组织 API）、语音、SaaS 计费。
**暂不启动**：IM 通知通道、桌面/手机客户端、Vault、连接器、卡支付、Pages、Initiative（设计保留，等对应阶段再定）。

## 版本节奏（不设开发周期/日期）

| 版本 | 内容 | 状态 |
|---|---|---|
| v0.1 | 运行时 + Web UI + 记忆 + 例程 + 多 Bot + 插件 | **进行中**（按能力包 + Gate 发版） |
| v0.2 | 云电脑（容器）+ 看屏接管 + 任务级快照 + 本机出网 | 下一阶段（v0.1 Gate 全过后启动） |
| 待定包 | 桌面/手机客户端、Vault、连接器/邮箱/Pages、Initiative、卡支付 | 不排期，需要时再取 |

> **不承诺开发周期或发布日期。** 一个版本 = 一组能力 + 退出 Gate；Gate 全过即发，不过就减范围（见 [docs/03-roadmap.md](docs/03-roadmap.md)）。

## 文档

设计文档在 [docs/](docs/README.md)：需求、功能规格、接口、架构、插件体系、云电脑、Vault、连接器、主动任务、对标矩阵、路线图、测试与运维。

## 开发

技术栈：TypeScript / Node 24 · pnpm monorepo · SQLite (WAL) + 事件溯源 · JSON-RPC over stdio/WSS · 默认 DeepSeek（兼容 OpenAI 协议）。

## 开发进度

- ✅ **P0 骨架**：kernel、SQLite store（事件回放）、agent 循环、`shell.run`、CLI、Fake provider
- ✅ **P1 真模型**：DeepSeek 流式 + 原生 tool-calling + 重试；`fs.list/glob/grep` 目录检索；上下文压缩；`cancelTurn` 取消；10 任务评测脚本（需 `DEEPSEEK_API_KEY`）
- ✅ **P2 Web UI**：单页 UI（会话列表/流式聊天/工具步骤/审批卡/附件上传）、SSE 事件流、审批桥（允许/拒绝/超时）、会话与文件 API、`jary serve`
- ✅ **P3 记忆 + 多 Bot**：SQLite+FTS5 记忆（bigram 分词、≤600 token digest、0 LLM 写入、目录检索、整理/遗忘）、记忆工具、Bot 名册、任务板（CAS）、Bot 消息总线（hop≤2）、CLI `memory`/`bot`
- ✅ **P4 主动任务**：cron/every/webhook 触发、job 预算与目标多轮、运行历史、`stop-all` 熔断、`/hooks/:id` HMAC
- ✅ **P5 硬化**：Docker 沙箱（可选）、MCP stdio 客户端、插件管理、`/metrics`、备份/恢复、untrusted 包装、Compose/Dockerfile、v0.1.0
- ✅ **v0.2 云电脑**：Local Chrome / Docker 容器后端、`browser.goto/extract/click/type/screenshot`、看屏截图、任务级快照/恢复、`jary computer`、`/api/computer`
- ✅ **v0.3 Vault**：AES-256-GCM write-only 存储、模型盲填（`vault.fill`）、一次性 Secure Form、审计/轮换/授权；56 个测试

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

**Status:** design phase; v0.1 is not implemented yet. Design docs start at [docs/README.md](docs/README.md).
