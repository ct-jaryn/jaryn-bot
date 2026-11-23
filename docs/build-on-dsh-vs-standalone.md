# 决策备忘：基于 DSH 做，还是独立做个开源项目？

> 2026-11-23。前提：不做语音；要 多 bot 交流 / 记忆 / 主动搜索完成任务。
> **后续（2026-11-23）：最终选择方案 C「完全自研运行时」；本文的 B 推荐仅作对比记录。自研设计见 [runtime-design.md](runtime-design.md) 与 [plugin-architecture.md](plugin-architecture.md)。**
> 分水岭不是"用不用 DSH"，而是**你的项目把价值押在 L1（agent 运行时）还是 L2（产品壳）**。
>
> **为什么最终仍选 C**：项目定位已从"产品壳"变成"自研运行时 + 插件生态"（要求参考 DSH 的插件理念），正命中第 4 节第 3 条——项目本身就是 runtime。C 的代价也被插件化设计摊薄：内核约 1200 行，能力全部外置为插件。下文 A/B/C 是当时的完整分析，保留以说明取舍。

---

## 0. 先纠正一个假选择

"基于 DSH"和"独立开源项目"不是对立面。两种都能成立，区别在于**依赖放在哪一层**：

| 层 | 内容 | 谁来做 |
|---|---|---|
| L0 | 模型/推理 | DeepSeek（或任意 provider） |
| **L1** | **agent 循环、工具、沙箱、会话持久化/恢复、compaction、子 agent、调度、审批接缝** | **DSH 已经做了，MIT，约 340 个包** |
| **L2** | **IM 通道、Bot 名册、记忆闭环、守夜人、审批卡片、产物、部署运维** | **空白，这才是"jaryn-bot"** |
| L3 | 分发/品牌/文档/社区 | 你的项目 |

**L1 自研 = 3–6 人月，且要和 DSH / Rakazo / OpenClaw 正面竞争；L2 才是没人做好的地方。**

---

## 1. 三方案对比

| | **A. DSH 插件/Bundle** | **B. 独立仓库 + DSH 作默认运行时（当时推荐）** | **C. 完全自研运行时** |
|---|---|---|---|
| 形态 | 装进 `dsh web`，发插件索引 | 自己的 CLI/服务，Docker 一键；内部 adapter 调 `dsh --profile sdk` | 自己写 agent loop、工具、会话 |
| 成本 | 最低（1–2 周出可用） | 中（网关层 2–4 周；DSH 免费给你 L1） | 高（3–6 人月才到"能用"） |
| 分发 | 吃 DSH 生态（GitHub 约 285.7k star / 35.6k fork；插件索引挂静态页即可，用户"Add index source"） | 靠自己做 GitHub/中文社区；也可同时发 DSH 索引 | 靠自己做 |
| 单用户/多用户 | DSH `web` 是单用户 owner 模型，做多人要绕过 | 自己控，可做多人 | 完全控 |
| 被上游锁死 | 高（插件 API + rc 版本） | 中（adapter 隔离，可换 runtime） | 无 |
| 上游抢你功能的风险 | 高（你就在它的壳里） | 中（L2 是它明确不做的） | 低 |
| 竞品 | 少（DSH 没有 IM/名册层） | 中（Rakazo/OpenClaw/Hermes 已占"自托管 AI 同事"） | 高（正面红海） |
| 适合 | 个人自用 / DSH 生态内小工具 | **想做开源项目、想长期维护、想要自己的品牌** | 你要解决 DSH 明确不做的事（Linux 云电脑、多租户 SaaS） |

---

## 2. 现实约束（决定选型的事实）

**支持"基于 DSH"的事实**

- DSH 是 MIT、公开仓库、**约 285.7k star / 35.6k fork**（2026-11-23 抓取，数值会变），2026-08 开源、仍在日更（pushed 2026-11-22）。生态规模本身就是分发渠道。
- 它有插件市场机制：**任何人写一个 JSON 索引挂静态页**，用户"Add index source"就能装（`docs/user/guide/plugin-market.md`）。这是零成本的获客入口。
- L1 能力确实完整：会话持久化/resume、compaction、子 agent/team 任务板、goal 多轮、schedule、web_search、office、MCP、审批接缝。这些自研要很久。
- 你要的三项（多 bot/记忆/主动）里，多 bot 和主动搜索是原生件，见 [scope-multibot-memory-proactive.md](scope-multibot-memory-proactive.md)。

**反对"基于 DSH"的事实**

- 版本 `0.2.2-rc.5`，**rc、无兼容承诺**；SDK 无 cancel/close；`web` 单用户；服务端路径不如 Desktop 走得熟。
- 上游是 DeepSeek 自家产品，方向不受你控制；**它哪天自己加 IM 通道，你就被覆盖**。
- 仓库 **Issues 关闭**（`has_issues: false`），社区反馈走 Discussions——上游 bug 你只能自己绕。
- 用户门槛：先装 DSH（Node 24、数百 MB）再装你的东西；对比 Rakazo 的 `docker compose` 一键，体验更差。

**"独立做"的现实对手**（都在 2026 年 8–11 月出现，二手信息）

- **Rakazo**：开源自托管，自称 Grok Bot 的替代；bots 各有会话/记忆/例程、语音、共享/私有云电脑、浏览器/终端/桌面、群聊、子 agent、Composio/Pipedream、Docker 镜像一键。功能覆盖已相当完整（beta）。
- **OpenClaw / Hermes Agent**：本地优先网关，多通道 + cron + 子 agent + 文件记忆，文档里有安装器/配置文件/网关三件套。
- 结论：**"再做一个自托管 AI 同事"是红海；"中文 IM + DeepSeek 成本 + 守夜人/记忆闭环 + DSH 生态缺口"才是空位。**

---

## 3. 当时的推荐：B 形态（独立仓库，DSH 当默认运行时；最终未采用）

### 3.1 仓库结构（建议）

```
jaryn-bot/
├─ packages/
│  ├─ runtime/          # 只做接口：RuntimeAdapter { start, send, stream, approve, stop, resume }
│  ├─ runtime-dsh/      # 默认实现：spawn `dsh --profile sdk` + stdio JSON-RPC
│  ├─ runtime-echo/     # 测试用假实现（不花钱跑 CI）
│  ├─ gateway/          # 通道、身份映射、消息总线、审批 broker、审计
│  ├─ memory/           # AGENTS.md/MEMORY.md 管理 + 会话检索 + MCP memory 适配
│  ├─ scheduler/        # cron/webhook/RSS → session/query，预算护栏
│  └─ channels/         # telegram / feishu / wecom / slack
├─ dsh-bundle/          # 顺带发布的 DSH 插件（吃生态流量，可选）
└─ docs/ deploy/        # 中文文档 + docker compose
```

**关键：`RuntimeAdapter` 只有 5–6 个方法（start/send/stream/approve/stop/resume），200 行以内。** 这层是你唯一的保险：DSH 挂了/变了/被上游抢了，你可以换第二个 runtime，而 L2 资产（通道/记忆/调度/用户）不动。

### 3.2 上游锁定策略（必须做）

1. **pin 死版本**（`@deepseek-ai/dsh@0.2.2-rc.5` 或你验证过的版本），升级走"看 release → 跑契约测试 → 升"的节奏。
2. **契约测试**：M0 就写一组 JSON-RPC 冒烟用例（initialize/query/approve/resume），CI 里对 fake runtime + 真实 DSH 各跑一遍。
3. **不 fork DSH**（约 340 个包，跟不动）；只写插件、patch、adapter。MIT 允许 fork，但那是最后手段。
4. **记录差异**：`docs/upstream-gaps.md` 记你绕过的 bug（无 cancel、单用户、schedule new-target 限制），上游修了就删。

### 3.3 开源策略

- **License**：MIT 或 Apache-2.0（与 DSH 兼容，商业友好）。
- **一键部署**：`docker compose up` 起网关 + 一个 DSH runtime；首次启动引导填模型 key、接 Telegram/飞书。
- **差异化切口（按优先级）**：
  1. **中文 IM 原生**：飞书/企业微信/钉钉（英文项目基本不碰；微信个人号有合规风险，先不做）；
  2. **守夜人 + 记忆闭环**：定时简报、目标驱动任务、每晚记忆整理——这是"AI 同事"和"聊天机器人"的分界；
  3. **DeepSeek 成本叙事**：同等任务 token 便宜，配合 compaction/预算护栏；
  4. **DSH 生态兼容**：可作为 DSH bundle 安装，也可独立部署——两条分发路。
- **不做的**：语音、云电脑/VNC、多租户 SaaS、计费（前三项是 Rakazo/Grok Bot 的战场，卷不过也不该卷）。

---

## 4. 当时列出的「该选 C」条件（本项目命中第 3 条）

只有这三种情况值得自研运行时：

1. 你的核心卖点是 **Linux 云电脑 + 浏览器/桌面操作**（DSH 的 CUA 只有 macOS）——那你得自建沙箱+浏览器+串流，运行时只是配菜；
2. 你要做 **多租户 SaaS**（DSH 单用户模型是硬墙，绕过去等于重写一半）；
3. 你的项目定位就是 **agent 运行时/框架**（那 DSH 是竞品，不是底座）——**jaryn-bot 最终就是这一条**。

否则：**别重写运行时，把命押在 L2。**

---

## 5. 当时的一句话（结论已被推翻）

**当时的结论**：做开源项目，但不要让"开源项目"等于"再写一个 agent runtime"。
独立仓库、独立品牌、自己的 L2 资产（通道/记忆/守夜人），DSH 作为默认运行时且用 200 行 adapter 隔离——**这既是速度最快的路，也是唯一一条上游变了你还能活的路。**

> **最终决定（2026-11-23）：选 C（完全自研运行时）。** 见 [runtime-design.md](runtime-design.md) 与 [plugin-architecture.md](plugin-architecture.md)。

---

## 附录：证据

- DSH 仓库：<https://github.com/deepseek-ai/deepseek-harness>（MIT；2026-11-23 抓取：约 285.7k star / 35.6k fork，数值会变；`has_issues: false`；pushed 2026-11-22）
- 插件索引机制：`docs/user/guide/plugin-market.md`（索引 = 任意静态托管的 JSON，用户手动 Add index source）
- DSH 单用户/owner 鉴权：`P/dsh-client-connection/README.md:41-47`
- SDK 无 cancel/close：`P/dsh-sdk-protocol/README.md:140-142`
- 竞品（二手）：[Rakazo](https://github.com/elie222/rakazo)、OpenClaw、Hermes Agent
