# jaryn-bot

**自托管的个人 AI 同事。** 跑在你自己的云服务器上：它在自己的云电脑里查资料、写文档、跑命令、收发邮件；你通过浏览器派活，流式汇报、危险动作审批；不在线时按计划主动干活。

> **状态：设计阶段（v0.1 开发中）。** 当前仓库以设计文档为主，尚无可用代码。目标机器是 **4C4G** 的云服务器，默认容器化、无外部数据库。

---

## 为什么做这个

Grok Bot 展示了「个人 AI 同事」的产品形态：有自己的电脑、能跨应用干活、会主动提议。但它托管在云上、不能自托管、不能换模型、额度不透明。

jaryn-bot 用**原创实现**把同样的能力做在**你自己的服务器**上：

- **数据主权**：会话、记忆、凭据、产物都在你的磁盘上；出网只有模型 API / 通知 / 你显式连接的第三方服务。
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
| 记忆 | 长期事实、召回、查看/遗忘、每晚整理 | v0.1 |
| 例程与主动 | cron/webhook/邮件触发、目标多轮、预算护栏 | v0.1 |
| 云电脑（容器） | 浏览器/终端、看屏接管、任务级快照；Bot 可自建测试容器 | v0.4 |
| Vault | write-only 凭据、模型盲填、Secure Form | v0.5 |
| 连接器 / 邮箱 / Pages | Gmail/Calendar/GitHub、个人邮箱、可交互产物 | v0.3 |
| 桌面/手机客户端 | 设备配对、多端同步 | v0.2 |

**明确不做**：团队协作、会议、企业管控（SSO/SCIM/网络策略/组织 API）、语音、SaaS 计费。

## 路线图（全职估算）

| 版本 | 内容 | 累计 |
|---|---|---|
| v0.1 | 运行时 + Web UI + 记忆 + 例程 + 多 Bot + 插件 | 4–5 个月 |
| v0.2 | 桌面/手机客户端 + 多端同步 | 4.5–6 个月 |
| v0.3 | 连接器 + 邮箱 + Pages | 6–8 个月 |
| v0.4 | 云电脑 + 看屏接管 + 任务级快照 | 7.5–10.5 个月 |
| v0.5 | Vault + Auto Review | 9–12 个月 |
| v1.0 | Initiative + teach-a-task + 稳定化 | **10–14 个月** |

## 文档

设计文档在 [docs/](docs/README.md)：需求、功能规格、接口、架构、插件体系、云电脑、Vault、连接器、主动任务、对标矩阵、路线图、测试与运维。

## 开发

技术栈：TypeScript / Node 24 · pnpm monorepo · SQLite (WAL) + 事件溯源 · JSON-RPC over stdio/WSS · 默认 DeepSeek（兼容 OpenAI 协议）。

当前处于 P0 之前；开发计划见 [docs/03-roadmap.md](docs/03-roadmap.md)。

## 许可

**PolyForm Noncommercial 1.0.0** —— 仅限**非商业用途**。商业使用（含内部商业部署、SaaS、转售、集成进商业产品）需联系作者获取**商业授权**，见 [COMMERCIAL.md](COMMERCIAL.md)。

> 说明：该许可证**不是 OSI 定义的开源许可证**（OSI 不允许限制使用领域）。本项目按 **source-available（源码公开、非商业可用）** 表述；如果你需要一个 OSI 开源许可，可在 issue 里讨论。

贡献欢迎，提交即同意按同一许可证授权，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 免责声明

本项目处于早期设计/开发阶段，不提供任何担保；用于生产前请自行评估安全与合规。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

---

## English summary

**jaryn-bot** is a self-hosted personal AI teammate runtime: a bot that works on its own containerized computer (browser, terminal, documents, email), reports progress, asks for approval on risky actions, and proactively works on schedules. It is designed to run on a single 4C4G cloud server with Docker and SQLite.

It is **inspired by Grok Bot (xAI), but is an original, independent implementation** — no Grok Bot code or assets are used, and there is no affiliation or endorsement.

**License:** PolyForm Noncommercial 1.0.0 (noncommercial use only). Commercial use requires a separate license — see [COMMERCIAL.md](COMMERCIAL.md). This is a source-available project, not an OSI open-source project.

**Status:** design phase; v0.1 is not implemented yet. Design docs start at [docs/README.md](docs/README.md).
