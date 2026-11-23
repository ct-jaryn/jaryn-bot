# jaryn-bot 文档地图

> 2026-11-23。共 **20 份正文 + 本索引**，分五类：**规划**、**功能与接口**、**子系统设计**、**核心设计**、**研究/历史**。
> 需要你拍板的事集中在 [12 决策清单](12-decision-register.md)。
> 目标：**个人版完全对标 Grok Bot 并 6 点超越；团队协作 / 会议 / 企业管控 / 语音明确不做。**
> 状态标记：`现行` = 以此为准；`设计` = 架构决策，已冻结到 v0.1；`历史` = 旧分析，保留作证据。

## 一、先看什么

| 你是 | 阅读顺序 |
|---|---|
| **产品/需求** | [00 PRD](00-prd.md) → [01 功能规格](01-functional-spec.md) → [03 规划](03-roadmap.md) → [11 对标矩阵](11-parity-and-beyond.md) |
| **开发** | [02 接口](02-interfaces.md) → [12 运行时设计](runtime-design.md) → [13 插件设计](plugin-architecture.md) → [04 测试验收](04-testing-acceptance.md) |
| **运维/部署** | [05 部署运维](05-deployment-ops.md) → [02 接口](02-interfaces.md)（配置/HTTP 段） |
| **多端客户端** | [06 服务端+多客户端](06-clients-and-topology.md) → [02 接口](02-interfaces.md)（客户端 API） |
| **云电脑/Vault/连接器/主动** | [07 云电脑](07-cloud-computer.md) · [08 Vault](08-vault-and-credentials.md) · [09 连接器](09-connectors-and-artifacts.md) · [10 主动](10-proactive-and-initiative.md) |
| **记忆模块** | [13 记忆模块（轻量/低消耗）](13-memory-module.md) → [12 运行时 §10](runtime-design.md) |
| **想了解为什么、对标什么** | [11 对标矩阵](11-parity-and-beyond.md) → [14 差距历史](gap-vs-grokbot.md) → [15 选型](build-on-dsh-vs-standalone.md) |
| **要拍板** | [12 决策清单](12-decision-register.md)（D-01…D-30，按影响阶段排序） |

## 二、文档清单

| # | 文件 | 内容 | 状态 |
|---|---|---|---|
| 00 | [00-prd.md](00-prd.md) | 产品需求：定位、用户故事、MoSCoW 需求池、非功能需求、成功指标、版本边界、明确不做 | 现行 |
| 01 | [01-functional-spec.md](01-functional-spec.md) | 功能规格：FR-1…FR-19、错误码、状态机 | 现行 |
| 02 | [02-interfaces.md](02-interfaces.md) | 接口：CLI、配置、环境变量、Worker/Client 协议、HTTP、DB 迁移、兼容策略 | 现行 |
| 03 | [03-roadmap.md](03-roadmap.md) | 规划：P0–P5 任务/验收/依赖、发布节奏、后续版本阶梯 | 现行 |
| 04 | [04-testing-acceptance.md](04-testing-acceptance.md) | 测试与验收：测试金字塔、阶段 Gate、DoD、评测、混沌、安全、CI | 现行 |
| 05 | [05-deployment-ops.md](05-deployment-ops.md) | 部署运维：拓扑、compose、私有化边界、备份、升级、监控、runbook | 现行 |
| 06 | [06-clients-and-topology.md](06-clients-and-topology.md) | 服务端 + 多客户端：控制端/执行端、配对鉴权、WS 协议、多端同步 | 现行（待定包） |
| 07 | [07-cloud-computer.md](07-cloud-computer.md) | 云电脑：容器/VM、浏览器/终端、看屏接管、任务级快照、网络与成本 | 现行（v0.2） |
| 08 | [08-vault-and-credentials.md](08-vault-and-credentials.md) | Vault：write-only、填充代理、Secure Form、1Password、支付与审计 | 现行（待定包） |
| 09 | [09-connectors-and-artifacts.md](09-connectors-and-artifacts.md) | 连接器、个人邮箱、Pages、产物管线 | 现行（待定包） |
| 10 | [10-proactive-and-initiative.md](10-proactive-and-initiative.md) | Routine、Initiative 信号与提议、Teach-a-task、通知与预算 | 现行（待定包） |
| 11 | [11-parity-and-beyond.md](11-parity-and-beyond.md) | 对标矩阵、6 个超越点、明确不做清单、版本阶梯、风险 | 现行 |
| 12 | [runtime-design.md](runtime-design.md) | 运行时主设计：进程/事件/SQLite/循环/工具/审批/多 Bot/调度/ADR | 设计（v0.1 冻结） |
| 13 | [13-memory-module.md](13-memory-module.md) | **记忆模块**：四层存储、bigram 分词、FTS5、0 LLM 写入、≤600 token digest | 现行（P3） |
| 14 | [plugin-architecture.md](plugin-architecture.md) | 插件化：Context/Effect/Event/Loader、seam、bundle/profile/preset、安全 | 设计（v0.1 冻结） |
| 15 | [gap-vs-grokbot.md](gap-vs-grokbot.md) | 早期差距估算（个人/产品/企业三档） | 历史（被 11 取代） |
| 16 | [build-on-dsh-vs-standalone.md](build-on-dsh-vs-standalone.md) | 选型：DSH 插件 / 独立 + DSH / 完全自研 | 历史（结论：自研） |
| 17 | [scope-multibot-memory-proactive.md](scope-multibot-memory-proactive.md) | DSH 方案下的能力设计 | 历史（机制思路参考） |
| 18 | [feasibility-and-architecture.md](feasibility-and-architecture.md) | Grok Bot 拆解 + DSH 服务端能力核查 | 历史（背景） |
| 19 | [12-decision-register.md](12-decision-register.md) | **决策清单**：需要 owner 拍板的 30 项（选项/建议/后果）+ 已定事项 | 现行 |
| 20 | [14-completion-audit.md](14-completion-audit.md) | **完成度审计**：FR-1…FR-19 逐条状态、仍缺项、外部条件与不做项 | 现行 |

## 三、关键数字（所有文档必须一致）

| 项 | 值 |
|---|---|
| 技术栈 | TypeScript / Node 24 · pnpm monorepo · SQLite (WAL) · 事件溯源 · JSON-RPC over stdio/WSS · 默认 DeepSeek |
| 进程模型 | gateway（`jary`）+ worker（每 Bot 一个）+ 客户端（控制端/执行端） |
| 内核 | Context / Effect / Event / Loader，约 1200 行 |
| 第一等接缝 | 8 个：`llm` `tools` `store` `fs+shell` `approvals` `memory` `channels` `scheduler`（P0 先落 5 个） |
| **v0.1（P0–P5）** | 运行时 + Web UI + 记忆 + 例程 + 多 Bot + 插件；**按 Gate 发版，不设日期** |
| 下一阶段 | **云电脑（容器）+ 本机出网**；v0.1 Gate 全过后启动 |
| 已完成 | 运行时/Web/记忆/多Bot(spawn)/主动/硬化/云电脑(看屏/接管/出网/exec)/Vault/连接器(OAuth 回调)/邮箱(SMTP+IMAP+附件)/Pages/office(docx/xlsx/pptx)/Initiative/teach/多设备/鉴权/goals/usage/审计/审批规则 |
| 未完成 | 桌面壳/原生 App、1Password/卡支付/TOTP、官方 Gmail/Calendar 应用、实时低延迟串流、进程外插件宿主、RSS/安静时段/IM 投递、真实模型评测与 Docker 实测（需外部条件） |
| 明确不做 | 团队协作 / 会议 / 企业管控（SSO·SCIM·网络策略·组织 API·审计导出）/ 语音 / SaaS 计费 |
| 私有化 | 单租户自托管；数据与密钥本地；出网仅模型（IM/连接器暂不做） |
| 许可 | AGPL-3.0 + 商业双许可（网络使用须公开源码；闭源商业需授权） |
| 记忆 | 每轮 digest ≤600 token；整理 ≤1 次 LLM/天（≤2K token）；默认无向量库/embedding；DB <1MB/年 |
| 目录检索 | 文件：`fs.list/glob/grep`（上限 200/200/50，忽略 .git/node_modules）；记忆：`memory.catalog` ≤200 token |
| 实现进度 | **v1.1.0 已发布**（109 测试）；逐 FR 审计见 [14 完成度审计](14-completion-audit.md) |

## 四、维护约定

1. **改数字先改本文第三节**；任何"周/月/百分比"只能来自这张表或明确标注"估算"。
2. **需求变更**：先改 `00-prd.md` 需求池，再改 `01-functional-spec.md`，最后同步 `03-roadmap.md` 与 `11-parity-and-beyond.md`；设计文档只在架构变化时改。
3. **版本能力**：新能力必须同时写"版本号 + Gate"，并在 `11` 的矩阵中有对应行。
4. **明确不做清单是硬约束**：新需求先对照 [00 PRD §4 Won't](00-prd.md#4-需求池moscow) 与 [11 §4](11-parity-and-beyond.md#4-明确不做写死避免范围蔓延)。
5. **状态标记**：`历史` 文档只在顶部加说明，不改正文；避免旧结论被当成现行方案。
