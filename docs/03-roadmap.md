# 03 · 规划（Roadmap）

> 状态：**现行**。范围见 [00-prd.md](00-prd.md)，验收见 [04-testing-acceptance.md](04-testing-acceptance.md)。
> 基线：单人全职；兼职按 ×2 估。所有工期为**估算**，以周为单位、按 4 周/月。

---

## 1. 发布定义

| 版本 | 判定条件 |
|---|---|
| `v0.0.x` | 内部可用：P0/P1 验收通过（CLI + 真模型 + shell） |
| `v0.1.0-alpha` | P2 验收通过（Web UI + 审批 + 文件），自己能天天用 |
| `v0.1.0-beta` | P4 验收通过（记忆 + 多 Bot + 主动任务） |
| `v0.1.0` | P5 验收通过（插件体系 + 沙箱 + 文档 + 安全清单），陌生人可 `docker compose up` |

**P0–P5 合计 15–21 周**（P0 3–4、P1 2–3、P2 3–4、P3 2–3、P4 2、P5 3–4），含缓冲按 **4–5 个月**排。

---

## 2. 总览

| 阶段 | 目标 | 关键交付 | 估时 | 依赖 |
|---|---|---|---|---|
| **P0 骨架** | 组合能跑、能回放 | kernel、store、agent-core、Fake、CLI、tools-shell | 3–4 周 | — |
| **P1 真模型** | 能干真活 | DeepSeek 适配、上下文装配、压缩、工具治理 | 2–3 周 | P0 |
| **P2 Web UI** | 浏览器里每天用 | Web UI（会话/流式/审批/产物）；通知通道暂不做 | 3–4 周 | P1 |
| **P3 记忆+多 Bot** | 记得住、能分工 | memory、consolidation、名册、任务板、子 Bot | 2–3 周 | P2 |
| **P4 主动** | 不用开口 | scheduler、job、goal、预算、投递、熔断 | 2 周 | P3 |
| **P5 硬化** | 能给别人用 | 容器沙箱、MCP、插件管理、指标、备份、文档 | 3–4 周 | P4 |

---

## 3. P0 · 骨架（3–4 周）

**目标**：证明"插件组合 + 事件回放"成立，模型还不需要真接。

**交付物**
- `packages/kernel`：Context 树、Effect/disposer、四类事件（emit/parallel/serial/waterfall）、Loader（profile → bundle → patch）、zod 配置校验、fail-loud 诊断
- `packages/store-sqlite`：SQLite v1 DDL、迁移、事件 append/read、投影、`replay`
- `packages/agent-core`：turn 循环、预算、abort、Fake 工具
- `packages/testing`：FakeProvider / FakeChannel / FakeStore
- `packages/bundles/base`：第一份 patch（store-sqlite、llm stub、tools-shell、approvals stub、agent-core）
- `packages/cli`：`init` / `chat` / `config print`
- `packages/tools-shell`：第一个工具（风险 execute，默认 ask 桩）

**任务清单**
- [ ] Context/子 Context/服务查找/effect 逆序释放（含单测）
- [ ] 事件总线四种模式 + 类型声明合并
- [ ] Loader：行 id 覆盖/插入/禁用、拓扑排序、循环依赖报错
- [ ] 配置校验错误带文件:行
- [ ] DDL + 迁移框架 + `schema_migrations`
- [ ] turn 循环骨架（FakeProvider 驱动）
- [ ] `kill -9` 后 `jary session replay` 恢复会话
- [ ] **验收：patch 里禁用 `tools-shell` → 模型看不到该工具**

**风险**：内核 API 反复改 → 先写测试再写实现；Loader 过早复杂化 → 只支持三种行操作。

---

## 4. P1 · 真模型（2–3 周）

**目标**：能完成真实仓库任务。

**交付物**
- `packages/llm-deepseek`：流式、原生 tool-calling、重试退避、usage/费用记账
- `packages/agent-core`：上下文装配（system/memory/skills/history/inbox/goal）、压缩（70% 触发）、tool executor（并行/串行、超时、输出截断落盘）
- 错误映射（`E_MODEL`/`E_TOOL`/`E_TIMEOUT`）、`ask_user` 工具
- 提示注入防护：web/bot 内容用 `<untrusted>` 包裹 + 声明
- `evals/`：10 个基线任务 + 断言

**任务清单**
- [ ] DeepSeek 适配器 + 流式解析
- [ ] tool-call 兼容（native / emulated 降级）
- [ ] 上下文预算分配（system ≤ 15%、memory ≤ 2K、history 动态）
- [ ] 压缩：摘要写 `memory.consolidated`，保留最近 6 轮
- [ ] 工具输出 >32KB 截断 + spill 文件路径
- [ ] `/stop` 在 2s 内生效（provider/工具/子进程）
- [ ] 成本记录到 `usage` 表
- [ ] 评测集跑通 ≥7/10

**验收**：在示例仓库上完成"读代码 → 改文件 → 跑测试 → 汇报"；`/stop` 可中断；费用可见。

**风险**：prompt/工具描述调优耗时 → 每天留 1 小时做评测回归；上下文估算不准 → 用 `countTokens` 或估算系数兜底。

---

## 5. P2 · Web UI（3–4 周）

**目标**：浏览器里每天用；不做 IM 通知通道。

**交付物**
- Web UI：会话列表、流式聊天、工具步骤、审批卡、产物下载、多会话
- 服务端静态资源 + `/ws/client`（见 [02 §10](02-interfaces.md)）
- 附件上传/下载；长消息切分；幂等
- 审批卡（Web 内联按钮）+ 规则引擎（风险默认 + once/thread/session）

**任务清单**
- [ ] Web 静态服务 + 会话/消息 API
- [ ] WS 流式渲染（失败降级为轮询）
- [ ] 审批内联卡片 + 30 分钟超时
- [ ] 后台任务 0 容忍（直接拒绝）
- [ ] 附件 → artifact → 模型图片块
- [ ] alpha 发布：自己用一周

**验收**：见 [04](04-testing-acceptance.md) 的 P2 Gate；连续 3 天日常使用不崩。

**风险**：前端工作量超预期 → 先只做单会话最小 UI；流式兼容 → 降级轮询。

---

## 6. P3 · 记忆 + 多 Bot（2–3 周）

**目标**：记得住、能分工。

**交付物**
- `memory` 插件：SQLite + FTS5、digest 注入、`remember/search/forget/list`
- `consolidation`：每晚整理任务（提炼/去重/降权/更新 `MEMORY.md`）
- Bot 名册：多进程、每 Bot workspace、preset、预算
- 任务板 + `spawn_worker` + `send_message` + 防环路（hop/线程/速率/去重）

**任务清单**
- [ ] 记忆表 + FTS 索引 + digest 生成（≤2K token）
- [ ] `/memory` `/forget` `/remember`
- [ ] 整理任务（cron 03:00）与审计
- [ ] 每 Bot 子 Context + isolate 服务
- [ ] 任务板 CAS + 子 Bot 生命周期
- [ ] 消息环路护栏 + `/stop-all`
- [ ] 跨会话记忆生效测试

**验收**：两个 Bot 协作完成"竞品对比"；`/new` 后仍记得偏好；`/forget` 生效。

**风险**：多进程内存占用 → 空闲回收；记忆污染 → 置信度 + 用户可查。

---

## 7. P4 · 主动（2 周）

**目标**：不用开口也有产出，且不失控。

**交付物**
- `scheduler`：cron / every / webhook / RSS；job 模型；run history；安静时段
- goal 多轮（max_rounds ≤20）+ 预算截断
- 投递到指定 IM；摘要优先；`stop-all` 熔断

**任务清单**
- [ ] cron 解析与 next_run 计算（含时区）
- [ ] webhook HMAC 校验
- [ ] job → 任务会话 → 结果投递链路
- [ ] 预算超限 5s 内停止并汇报
- [ ] 运行历史与失败重试策略（不自动重试，记失败）
- [ ] beta 发布：连续 5 天早报成功

**验收**：每天 8 点收到简报；预算设 0.05 美元后超限停止；`/job disable` 立即生效。

**风险**：主动任务烧钱 → 默认预算 + 频率上限；噪音 → 只发结论。

---

## 8. P5 · 硬化（3–4 周）

**目标**：陌生人能部署、能信任。

**交付物**
- 容器沙箱（每 Bot 一容器，workspace 挂载，factorial 从进程模式切换）
- MCP 客户端（stdio/HTTP）与工具命名 `mcp.<server>.<tool>`
- 插件管理器 + 索引 + `plugin doctor` + 权限声明检查
- 指标 `/metrics`、健康 `/healthz`、OTel（可选）
- 备份/恢复演练、升级迁移演练
- 安全测试集（注入/路径逃逸/SSRF/密钥泄漏）
- 文档：README、部署、运维、贡献指南

**任务清单**
- [ ] Docker 镜像（多阶段构建，<500MB）
- [ ] compose 模板 + `.env.example`
- [ ] 容器执行后端（fs/shell 指向容器）
- [ ] MCP 动态工具注册 + 审批默认 ask
- [ ] 插件安装/禁用/索引/权限
- [ ] 指标与告警阈值文档
- [ ] 安全用例全部通过
- [ ] v0.1.0 发布 + Release Notes

**验收**：见 [04](04-testing-acceptance.md) 的 P5 Gate；在干净机器 10 分钟内跑通。

**风险**：容器化改动面大 → 提前在 P3 定义 `fs/shell` seam；MCP 权限模型 → 默认 external+ask。

---

## 9. 关键路径与并行

```
kernel ─► store ─► agent-core ─► llm-deepseek ─► channels ─► memory ─► scheduler ─► hardening
                                   └─► approvals ─┘        └─► bots ─┘
```

- **关键路径**：kernel → store → loop → provider → channels（P0–P2）。
- **可并行**（若有第二人）：P1 后通道与记忆可并行；文档/评测/部署模板可从 P1 起持续做。
- **不可压缩**：P0 的内核与 P1 的上下文装配，压缩会以 2–3 倍返工偿还。

---

## 10. 范围削减顺序（延期时从下往上砍）

1. Pages 交互产物（本就不在 v0.1）
2. 第二个通知通道（只留 Telegram）
3. RSS/邮件触发（只留 cron + webhook）
4. office 产物（先只支持 md/csv/json）
5. 插件索引/市场（只留 `plugin add`）
6. OTel/指标（只留 `/healthz`）
7. 多 Bot 对等总线（L1 必须保留）
8. **绝不砍**：审批、预算、事件回放、记忆 digest、kill -9 恢复

---

## 11. 里程碑周历（相对周，含重叠缓冲）

| 周 | 内容 | 里程碑 |
|---|---|---|
| W1–W4 | P0 骨架 | 组合生效 + 回放通过 |
| W5–W7 | P1 真模型 | CLI 能干真活 |
| W8–W10 | P2 Web UI | **v0.1.0-alpha** |
| W11–W13 | P3 记忆 + 多 Bot | 两个 Bot 能协作 |
| W14–W15 | P4 主动 | **v0.1.0-beta** |
| W16–W19 | P5 硬化 | **v0.1.0** |

> 兼职：整体 ×2（约 8–10 个月）；有第二人可把 W8–W13 压到 4–5 周。

---

## 12. 后续阶段（暂缓项未排期）

v0.1 之后**先做云电脑**（容器、看屏接管、任务级快照、本机出网）。其余暂缓项不排期，到对应阶段再定：

| 阶段 | 内容 | 状态 |
|---|---|---|
| **下一阶段** | 云电脑（容器）+ 看屏接管 + 任务级快照 + **本机出网** | **v0.1 后启动**（约 +8–10 周） |
| v0.2 | 桌面/手机客户端 + 设备配对 + 多端同步 | 暂缓（未排期） |
| v0.3 | 连接器 + 邮箱 + Pages | 暂缓（未排期） |
| v0.5 | Vault + Secure Form + Auto Review | 暂缓（未排期） |
| v1.0 | Initiative + teach-a-task + 稳定化 | 暂缓（未排期） |

**范围纪律**：团队协作、会议、企业管控、语音、SaaS **永不进入本路线图**（见 [00 PRD](00-prd.md) §4 Won't 与 [11](11-parity-and-beyond.md) §4）。暂缓项每季度复核一次，不做就明确关闭。

---

## 13. 客户端轨道（暂缓，不阻塞 v0.1）

v0.1 交付后，按 [06-clients-and-topology.md](06-clients-and-topology.md) 扩展“一处服务端 + 多处客户端”。

| 项 | 内容 | 估时 | Gate |
|---|---|---|---|
| 服务端接入层 | `access` seam：IM / Client WS / Node WS 三类 peer；设备配对与令牌 | 2–3 周 | 三端同时在线；断线重连补齐 |
| 控制端 PWA | 会话列表 / 流式聊天 / 审批卡 / 产物下载 / 多端同步 | 2–3 周 | 手机 + 桌面浏览器同一会话 |
| 桌面壳 | Tauri 包 PWA；托盘、自启、拖拽上传 | +2–4 周 | 安装包可分发 |
| 执行端 Node（v1.0） | 注册/心跳/exec/作用域限制/审计 | 4–6 周 + 安全硬化 2 周 | 只读根目录 + 每个 exec 审批 |

**建议顺序**：接入层 → PWA → 桌面壳；执行端等有“本地文件/内网/浏览器”明确需求再做。v0.2 合计 +5–7 周（控制端），执行端另计。
