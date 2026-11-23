# 插件化设计：把 DSH 的「万物皆插件」搬进 jaryn-bot

> 2026-11-23。补丁文档：把 [runtime-design.md](runtime-design.md) 的内核改成**插件树**，而不是一堆写死的模块。
> 一句话：**内核只保留四个原语，其余全部是插件；产品 = 一份组合配置（profile）+ 补丁（patch）+ 可替换的 bundle。**

---

## 0. 先说结论

1. **值得做，但别把它做成"所有东西都插件"的宗教。** 只把**能力边界**（模型、工具、存储、通道、调度、记忆、审批、fs+shell）做成 seam；内核（Context / Effect / Event / Loader）必须小而稳。
2. **DSH 的五个理念要全抄**：无特权核心、贡献即效果、capability seam 三元组、启动即组合（profile/bundle/patch）、事件分三类且"model-visible 必须落日志"。
3. **代价**：P0 从 1–2 周增至 3–4 周（多约 2 周：内核 + loader + 5 个 seam）；**收益**：每条 IM 通道、每个工具、每种记忆实现都能独立演进、独立测试、独立发布——这正是你要开源的形态。
4. 三个需求的落点直接变清晰：**多 Bot = preset 组合 + 隔离 realm；记忆 = memory seam（sqlite/vector 两种 provider）+ 整理任务插件；主动 = scheduler seam + trigger 插件。**

---

## 1. DSH 到底在说什么（提炼成 5 条）

| # | 理念 | 原话/证据 | 对我们的含义 |
|---|---|---|---|
| 1 | **没有特权核心** | "Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself" | 我们的 agent loop、存储、工具注册表也必须是插件；否则"可替换"是假的 |
| 2 | **贡献即效果，卸载即回滚** | registrations are effects that unwind when their plugin unloads | 每个注册返回 disposer；插件热卸/配置变更/测试隔离都靠它 |
| 3 | **能力 = 接缝（Definition + Provider + Consumer）** | "A seam is a swappable capability with three roles" | 换一个 provider 就换掉整条链路（如 fs/shell 指向远程沙箱） |
| 4 | **启动即组合** | profile → bundles → user patch → `--patch`，按行 id 覆盖/插入/禁用 | 部署形态（server/worker/cli）只是不同 profile，不是不同代码 |
| 5 | **事件分三类，模型可见即落日志** | session events（durable）/ agent events（live）/ capability events（policy） | 插件注入上下文必须留痕，否则回放/审计/评测全断 |

DSH 的框架是 Cordis（`vendor/cordis`，MIT，v4.1.0，随 DSH 源码 vendored；配置与加载器是同仓库的 `cordis-plugin-loader` 1.1.0）。**我们不用直接依赖它**：自己写约 1200 行内核更可控，也可以把它的源码当参考（MIT，注明出处即可）。

---

## 2. 内核：四原语，1200 行

### 2.1 Context 树

```ts
export interface Context {
  readonly parent?: Context;
  readonly scope: 'root' | 'bot' | 'session' | 'agent';
  readonly id: string;                              // 'root' | 'bot:jaryn' | 'session:s_123'

  get<T>(key: SeamKey): T | undefined;              // 读服务
  provide<T>(key: SeamKey, value: T): Disposer;     // 注册服务（effect）
  effect(setup: () => void | Disposer): Disposer;   // 注册即效果
  on<E extends keyof Events>(e: E, fn: Listener<E>): Disposer;   // 事件订阅（effect）

  plugin(p: Plugin, cfg?: unknown): Promise<Fiber>; // 挂一个插件
  get loaded(): boolean;
  get disposer(): Disposer;
}
```

- **树**：root → 每 bot 一个子 ctx → 每 session → 每 agent。子 ctx 继承父的服务查找；`provide` 在子 ctx 只影响子树（这就是 per-bot 覆盖）。
- **Disposer**：幂等函数；`ctx.dispose()` 逆序展开。插件失败/配置变更/测试结束都靠它清理，不靠"记得删"。

### 2.2 服务与依赖声明

```ts
export interface Plugin<C = unknown> {
  name: string;
  inject?: SeamKey[];          // 必需服务；缺了就不启动（或 fail-loud）
  optional?: SeamKey[];        // 可选服务
  config?: ZodSchema<C>;       // 配置校验，启动即校验
  apply(ctx: Context, config: C): void | Promise<void>;
}
```

- **启动顺序由依赖决定**，不由书写顺序决定（避免"配置文件顺序敏感"这类经典 bug）。
- 缺必需依赖：**fail loud**（打出插件 id + 缺失的 key + 谁在等），不静默跳过。
- 循环依赖直接报错。

### 2.3 四类事件模式（emit / parallel / serial / waterfall）

| 模式 | 语义 | 用途 |
|---|---|---|
| `emit` | 同步广播，返回值丢弃 | 通知类（`turn.started`、`memory.written`） |
| `parallel` | 全部 await，错误聚合 | 清理、遥测 |
| `serial` | 顺序 await，可中止 | 收尾（`turn/stopping`） |
| `waterfall` | 监听器必须 `next()` 才交给下一个；第一个 `return` 短路 | **拦截/改写**：审批、注入、工具前置 |

```ts
type Waterfall<In, Out> = (input: In, next: (i?: In) => Promise<Out>) => Promise<Out>;
```

**三类事件域**（对应 DSH）：

```ts
// A. 会话事件：durable，写 events 表
interface SessionEvents {
  'turn.started': { turnId: string }; 'turn.ended': { turnId: string; reason: TurnEndReason };
  'input.owner': InputPayload; 'input.bot': InputPayload; 'input.system': InputPayload;
  'model.response': { blocks: ContentBlock[]; usage: Usage };
  'tool.call': ToolCall; 'tool.result': ToolResult;
  'approval.requested': ApprovalRequest; 'approval.resolved': ApprovalDecision;
  'goal.updated': GoalState; 'memory.written': MemoryRecord;
}

// B. Agent 事件：live，只在进程内，可拦截
interface AgentEvents {
  'agent/pre-step': Waterfall<StepInput, StepDecision>;   // 改/拒用户输入
  'agent/request': Waterfall<ModelRequest, ModelRequest>; // 改模型请求
  'agent/stream': { delta: ModelDelta };                  // 只观察
  'agent/turn-stopping': { turnId: string };              // serial，收尾
}

// C. 能力事件：seam 上的策略钩子
interface CapabilityEvents {
  'tools/pre-execute': Waterfall<ToolCall, ToolDecision>; // → 审批
  'tools/post-execute': { call: ToolCall; result: ToolResult };
  'fs/before-write': Waterfall<FsWrite, FsWrite>;
  'memory/before-write': Waterfall<MemoryRecord, MemoryRecord>;
  'llm/stream': { request: ModelRequest; stream: AsyncIterable<ModelDelta> };
  'channel/inbound': Waterfall<InboundMessage, InboundMessage>;
}
```

**命名约定**：持久会话事件用 `a.b`（如 `tool.call`），live / 能力事件用 `a/b`（如 `agent/pre-step`、`tools/pre-execute`）。

**规则**：任何插件要给模型加"可见内容"，必须 ① 写一个 session event，或 ② 注册一个纯投影（pure projection）——CI 里有 `assertReconstructable(session)` 兜底。

### 2.4 Loader：启动即组合

```
$JARY_HOME/profiles/<name>/package.json   → { jaryn: { profile: { bundles: [...] } } }
  ↓ 按序展开 bundle 的 patch 文件（每行 = 一个插件 id + name + config）
  ↓ 叠加 profile 的 jaryn.patch.yml
  ↓ 叠加 $JARY_HOME/jaryn.patch.yml
  ↓ 叠加 --patch <file>
  = 最终 rows
  ↓ 解析 name（npm 包 / 本地目录 / 内置）→ 校验 config → 拓扑排序（inject）→ apply
```

行操作只有三种（够用且好调试）：

```yaml
- id: llm
  config: { provider: deepseek, model: deepseek-v4-flash }   # 整行替换 config
- insert:
    - id: plugin-web-search
      name: '@jaryn/plugin-web-search'
      config: { provider: deepseek }
- id: tools-shell
  disabled: true
```

> **与 DSH 的差异**：DSH 的 patch 是"整行 config 替换，不合并"。我们沿用（行为可预测），但提供 `jary config print` 看最终结果。

---

## 3. Bundle / Profile / Preset

### 3.1 三种发行物

| 概念 | 是什么 | 例子 |
|---|---|---|
| **bundle** | 一组插件行 + code 的发行包（`package.json` 的 `jaryn.bundle` 指向 patch 文件） | `@jaryn/base`、`@jaryn/server`、`@jaryn/channel-telegram` |
| **profile** | 一套命名组合（bundles + 用户 patch），存放在 `$JARY_HOME/profiles/<name>` | `server`、`worker`、`cli`、`minimal` |
| **preset** | **单个 bot** 的组合补丁（在 bot 声明内生效） | `researcher`、`writer`、`ops` |

```json
// 插件包的 package.json
{
  "name": "@jaryn/plugin-web-search",
  "version": "0.1.0",
  "jaryn": {
    "plugin": { "entry": "./dist/index.js", "inject": ["tools", "web"] },
    "bundle": { "patch": "./jaryn.patch.yml", "engines": { "jaryn": ">=0.1.0 <0.2.0" } }
  }
}
```

### 3.2 Bot = 一个 preset（关键简化）

```yaml
# $JARY_HOME/presets/researcher.yml
- id: persona
  config: { prefix: "你是研究员：只给结论和来源，不写散文。", name: "researcher" }
- id: tools-web
- id: tools-fs
  config: { write: false }          # 只读
- id: tools-shell
  disabled: true                    # 不给命令执行
- id: memory
  config: { scope: "bot:researcher" }
- id: budget
  config: { maxSteps: 12, maxCostUsd: 0.20 }
```

- bot 创建时：`jary bot add researcher --preset researcher --workspace /data/bots/researcher`。
- 运行时：为该 bot 建**子 Context**（`bot:researcher`），preset 的行在其下挂载；`isolate` 标记的服务（如 memory、budget）每个 bot 一份实例。
- **这就是"多 bot"的机制**：不是 if/else 分支，是组合差异。

---

## 4. 第一等接缝（v0.1 做这 8 个；P0 先落最小的 5 个）

| Seam（ctx key） | Definition（接口） | 默认 Provider | Consumer | 换掉能怎样 |
|---|---|---|---|---|
| `llm` | `ModelProvider` | DeepSeek | agent-loop、标题、压缩 | OpenAI/Anthropic/本地 |
| `tools` | 工具注册表 + 执行管道 | 内置工具插件 | agent-loop、prompt 装配 | 增删工具、per-bot 工具子集 |
| `store` | SessionStore / EventStore | SQLite | 所有持久化 | Postgres、远程 DB |
| `fs` + `shell` | 文件与进程执行世界 | 本地进程 | fs/shell 工具、skills | 容器、远程沙箱（一次换全链路） |
| `approvals` | 规则引擎 + 回答器链（waterfall） | 规则 + IM 卡片 | tools 管道 | 换成 Auto Review 模型 |
| `memory` | `remember/search/forget/digest` | SQLite+FTS+文件 | 上下文装配、记忆工具 | 向量库、MCP memory |
| `channels` | `ChannelAdapter` | Telegram/飞书 | gateway | 企微/钉钉/Slack |
| `scheduler` | 触发器 + 投递 | 内置 cron/webhook | jobs、goal | Redis/Temporal（多实例） |

**P0 只落最小 5 个**（`llm`/`tools`/`store`/`fs+shell`/`approvals`）；`channels`/`memory`/`scheduler` 随 P2/P3 接入，其余进第二批。

**第二批（P2–P3 按需再做）**：`bus`（bot 间消息，进程内→Redis）、`secrets`（文件→Vault）、`telemetry`、`sandbox`、`artifacts`、`title`、`compaction`、以及**多个可替换的 `agent-loop` 实现**（默认循环 P0 就有）。

> `agent-loop` 也做成 seam（`ctx.agentLoop`）：默认循环是插件；以后想试"plan-execute 循环"或"多模型投票循环"，换一个插件即可——这是 DSH 给我们的最大启发。

---

## 5. 内核与业务的分界（写死 vs 插件）

| 类别 | 归属 | 理由 |
|---|---|---|
| Context / Effect / Event / Loader / 配置校验 / 日志 | **内核（写死）** | 别的都依赖它，必须稳且小 |
| Agent loop、prompt 装配、compaction、工具管道 | 插件（`@jaryn/agent-core`） | 可替换、可测试 |
| 模型适配、工具、通道、存储、调度、记忆、审批 | 插件 | 变化最快的部分 |
| DB schema 迁移 | 内核 + store 插件共用（版本表） | 迁移必须原子、集中 |
| CLI 命令 | 插件（`ctx.commands`） | 第三方能加命令 |

**反模式（别做）**：
- 把"内核 API"当公共 API 频繁改 → 插件全碎。内核 API 进 `v1` 后按 semver 走，破坏性变更必须升大版本并给迁移工具。
- 让插件直接读写 `events` 表 → 必须走 `ctx.store` 的接口。
- 插件里 `process.exit` / 改全局状态 / 劫持日志 → CLI 的 `plugin doctor` 检测；文档列为红线。

---

## 6. 插件管理、分发与信任

### 6.1 安装

```bash
jary plugin add npm:@jaryn/plugin-web-search@0.1.0
jary plugin add git:https://github.com/you/jaryn-plugin-x#v0.2.0
jary plugin add file:../local-plugin
jary plugin list / remove / outdated / doctor
jary config print --profile server   # 最终组合，可 diff
```

- 装进 `$JARY_HOME/plugins`，写回 profile 的 `package.json`；`engines.jary` 不满足直接拒绝。
- v0 **改插件要重启**（DSH 的 config-only HMR 我们不抄，省 1 周）；`--dev` 下支持配置热重载。

### 6.2 插件索引（分发）

和 DSH 一样：**索引 = 一个 JSON 文件挂任意静态页**（GitHub Pages / 对象存储）。

```bash
jary plugin index add https://your.github.io/jaryn-index/index.json
jary plugin search "飞书"
```

用户手动加索引源 → 天然适合开源分发，不需要中心化审核（但要提示"索引是第三方内容"）。

### 6.3 信任模型（比 DSH 更进一步）

DSH 的插件跑在 Host 进程里，等于完全信任。我们开源后会有第三方插件，必须声明能力：

```json
{ "jaryn": { "permissions": {
  "fs": "workspace",              // "none" | "readonly" | "workspace" | "full"
  "network": ["api.telegram.org"],// 域名白名单，* 为全部
  "process": false,               // 能否起子进程
  "secrets": ["TELEGRAM_TOKEN"]   // 能读哪些 secret
}}}
```

- v0：**声明 + 启动检查 + 文档警告**（进程内）；越权调用（如 fs 跑出 workspace）由 `ctx.fs` 统一拦截。
- v0.2：**`jary plugin host` 进程外插件**——不可信插件跑在独立 worker，能力通过 JSON-RPC 代理（工具注册、事件订阅都走代理）。这是我们的差异化：**DSH 的插件在 Host 进程内运行，没有插件级能力沙箱**。
- 高危插件（`process: true` / `network: *` / `secrets`）安装时要求显式 `--trust`。

---

## 7. 三个需求怎么落到插件上

| 需求 | 插件 | 机制 |
|---|---|---|
| **多 Bot** | `@jaryn/bots`（名册）+ `@jaryn/bus`（总线）+ `@jaryn/tasks`（任务板）+ preset | 每 bot 子 Context；`bus` 默认进程内队列，可换 Redis |
| **记忆** | `@jaryn/memory-sqlite`（默认）+ `@jaryn/memory-vector`（可选）+ `@jaryn/consolidation`（整理任务） | `memory` seam 的 `remember/search/forget/digest`；`memory/before-write` 做脱敏/去重 |
| **主动** | `@jaryn/scheduler` + trigger 插件（cron / webhook / rss / email）+ `@jaryn/goal` + `@jaryn/budget` | `scheduler` seam；每个 trigger 是独立插件，按需装 |
| 通道 | `@jaryn/channel-telegram`、`-feishu`、`-slack`… | 每个通道一个包，独立发布/独立 CI |
| 工具 | `@jaryn/tool-*` 每个工具一个包或一组 | 第三方工具就是 npm 包 |
| 审批 | `@jaryn/approvals`（规则）+ `@jaryn/approval-im`（卡片）+ 可选 `-autoreview` | waterfall 回答器链 |

---

## 8. 对路线图与工期的影响

| 阶段 | 原计划 | 加插件内核后 |
|---|---|---|
| P0 骨架 | 1–2 周 | **3–4 周**（多约 2 周：Context/Effect/Event/Loader + config 校验 + 5 个 seam 空实现 + fake 插件） |
| P1 真模型 | 2–3 周 | 不变（llm/tools 是 seam，先接默认实现） |
| P2 通道 | 2–3 周 | 不变（通道本来就是插件） |
| P3 记忆+多 Bot | 2–3 周 | 略增（memory/bus seam） |
| P4 主动 | 2 周 | 不变（scheduler 是 seam） |
| P5 硬化 | 3–4 周 | 略增（插件管理器/索引/文档） |
| 总计 | 12–17 周 ≈ 3–4 个月 | **14–19 周 ≈ 3.5–4.5 个月；含缓冲按 4–5 个月排** |

**但这是"少走回头路"的钱**：没有 seam，第三个通道、第二种记忆实现、第二个模型时你会重写；有了 seam，每个都是新包。

---

## 9. 插件化最容易被做坏的五个地方

1. **内核 API 不稳定** → 插件生态立刻死。内核 API v1 冻结，破坏性变更走大版本 + codemod。
2. **配置地狱** → 必须有 `jary config print`、默认 profile、错误信息带行号与文件路径。
3. **加载顺序敏感** → 用 inject 拓扑排序，禁止"靠 YAML 顺序碰巧能跑"。
4. **第三方插件乱来** → 能力声明 + 进程外宿主 + 索引信任提示，三件套。
5. **过度插件化** → 不是所有东西都要拆包：内核、schema、CLI 骨架保持单体；只把 seam 拆出去。

---

## 10. 开工顺序（P0 第 1–2 周里程碑）

```
week 1:
  packages/kernel/         context + effect + events + loader + config (zod) + disposer 测试
  packages/testing/        FakeProvider / FakeChannel / FakeStore（用于所有测试）
  packages/agent-core/     最小循环（作为插件，提供 ctx.agentLoop）
  packages/bundles/base/   base bundle 的 patch：llm/tools（含 fs-shell）/store/approvals
week 2:
  packages/cli/            jary chat / config print / plugin list
  packages/llm-deepseek/   真模型（可先 stub）
  packages/tools-shell/    第一个工具（风险=execute，默认 ask）
  验收：配置文件里禁用 tools-shell 后，模型确实看不到 shell 工具

week 3–4:
  loader 诊断与 fail-loud、config print、事件回放、混沌测试（kill -9 恢复）
```

**最后一条验收最关键**：它证明"组合真的生效"，而不是"配置文件被读了但没人用"。

---

## 11. 与 DSH 的对照（抄什么、不抄什么）

**抄**：四原语；无特权核心；capability seam 三元组；profile/bundle/patch 分层与行 id；三类事件；"model-visible 必须落日志"；preset 隔离；插件索引；`config print`/fail-loud。

**不抄**：Cordis 本体（自己写 1200 行，或后期评估依赖）；HMR（v0 不做）；单用户假设；stdout 当协议通道；约 340 个包的粒度（我们按 seam 拆，约 25–35 个包）。

**反超点**：插件**能力声明 + 进程外宿主**（DSH 的插件在 Host 进程内、无沙箱）；事件与应用解耦（worker 独立进程，可容器化）。

---

## 12. 一页速查

```
内核（写死）         Context · Effect · Event · Loader · Config · Log
第一等 seam（8）     llm · tools · store · fs+shell · approvals · memory · channels · scheduler
第二等 seam（P2–P3）  bus · secrets · telemetry · sandbox · artifacts · compaction · title · 第二套 agent-loop
组合                 profile(部署) → bundle(发行) → patch(覆盖) → preset(单个 bot)
插件声明             package.json 的 jaryn.plugin / jaryn.bundle / jaryn.permissions
事件                 会话(durable) / agent(live) / capability(policy)，waterfall 用于拦截
铁律                 注册即 effect；模型可见即落日志；内核 API v1 冻结
```
