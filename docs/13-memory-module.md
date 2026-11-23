# 13 · 记忆模块（轻量、高效、低消耗）

> 状态：**现行（v0.1 / P3 实现）**。目标：在 **4C4G** 机器上，用 **SQLite 单文件** 做到"记得住、查得快、几乎不花钱"。
> 关联：[01 FR-7](01-functional-spec.md) · [12 运行时 §10](runtime-design.md) · [02 接口](02-interfaces.md) · [04 测试](04-testing-acceptance.md)
> 本文取代 [runtime-design.md](runtime-design.md) §10 的粗略描述；以本文为准。

---

## 1. 目标与非目标

**目标**

| 指标 | 目标 |
|---|---|
| 每轮注入 token | **≤600**（目标 300–500），占 128K 上下文 <0.5% |
| 检索延迟 | p95 **<20ms**（4C4G，1 万条以内） |
| 写入成本 | 默认 **0 次 LLM 调用/轮**（规则抽取） |
| 整理成本 | **≤1 次 LLM 调用/天**，≤2K token（极简模式可 0） |
| 外部依赖 | **0**：不引入向量库、不调用 embedding API、不装 GPU 依赖 |
| 存储增长 | 10 条/天 × 200 字 ≈ **<1MB/年** |
| 常驻内存 | <30MB（SQLite page cache + 索引） |
| 可用性 | 记忆模块故障不阻塞对话（降级为空 digest） |

**非目标**

- 不做"全量对话向量化"；
- 不做跨用户/团队记忆（单 owner）；
- 不做自动人格演化；
- 默认不做语义向量检索（可选插件，见 §10）。

---

## 2. 为什么不用向量库 / embedding（低消耗的核心决策）

| 方案 | 成本 | 在 4C4G 上的问题 |
|---|---|---|
| 全量 embedding + 向量库（Chroma/Qdrant） | 每轮或每写入 1 次 embedding；常驻服务 300MB+ | 内存吃紧、要额外进程、备份复杂 |
| 本地 ONNX embedding | 模型 20–100MB + 推理 CPU | 首 token 变慢；依赖体积大 |
| **FTS5 + 规则抽取 + 每日整理**（本方案） | 0 外部调用；CPU 微秒级 | 语义泛化弱（用标签/同义词表补偿） |

**结论**：个人记忆 90% 是"事实/偏好/规则/历史"，靠**关键词 + 时间 + 置信度**足够；语义检索作为可选增强，不默认开启。

---

## 3. 分层存储（四层，各有预算）

| 层 | 内容 | 注入方式 | 预算 |
|---|---|---|---|
| **L0 工作记忆** | 当前会话最近 6 轮原文 + 压缩摘要 | 上下文装配（已有） | 动态 |
| **L1 核心记忆（Pinned）** | 关于主人/规则/偏好的少量高价值事实 | **每轮固定注入**（稳定前缀） | ≤200 token |
| **L2 检索记忆（FTS）** | 事实/偏好/规则/事件摘要 | 按当前输入检索 top-k（k≤5） | ≤300 token |
| **L3 情节摘要** | 会话压缩产生的 episode | 与 L2 一起检索（TTL 30 天） | 计入 L2 |

> L1 放最前且内容稳定 → 命中 prompt 缓存；L2 每轮变化但很小。

---

## 4. 数据模型（SQLite）

```sql
-- 主表：一行一条记忆，文本短（≤500 字），带检索用分词列
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  ns TEXT NOT NULL,              -- 'global' | 'bot:<id>'（单 owner，无 team）
  kind TEXT NOT NULL,            -- 'fact' | 'preference' | 'rule' | 'episode' | 'skill'
  text TEXT NOT NULL,
  tokens TEXT NOT NULL,          -- 预分词，空格分隔（见 §5），供 FTS 用
  key TEXT,                      -- 归一化主题键（可选），用于"同键覆盖"
  source TEXT NOT NULL,          -- 'user' | 'model' | 'episode' | 'consolidation'
  source_ref TEXT,               -- 事件 id，可溯源
  confidence REAL NOT NULL DEFAULT 0.7,
  pinned INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER             -- episode 默认 30 天；fact 默认 NULL
);

-- FTS5：外部内容表，只索引 tokens；不重复存全文
CREATE VIRTUAL TABLE memories_fts USING fts5(
  tokens, content='memories', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- 候选池：规则抽到的原始片段，等待每日整理（不注入模型）
CREATE TABLE memory_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ns TEXT NOT NULL, text TEXT NOT NULL,
  tokens TEXT NOT NULL, source TEXT NOT NULL,
  created_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0
);

-- 整理运行记录（可观测/可回滚）
CREATE TABLE memory_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER, ended_at INTEGER,
  candidates INTEGER, added INTEGER, merged INTEGER, archived INTEGER,
  model_tokens INTEGER, status TEXT
);

-- 可选：同义词/别名（手工维护，提升召回，避免 embedding）
CREATE TABLE memory_aliases (term TEXT PRIMARY KEY, alias TEXT NOT NULL);
```

**容量上限**：`memories` ≤ 5000 行、总文本 ≤ 8MB；超限按 §7 的得分淘汰（先归档，再删）。

---

## 5. 轻量分词（中文不装 jieba）

目标：**零依赖、确定性、可索引中文**。

- 英文/数字：小写、按非字母数字切分；
- 中文：**bigram** 切分（"用户偏好" → "用户 户偏 偏好"），单字词保留；
- 去停用词（一个 ~50 词表：的/了/是/我/你/他/在/有/和/就/不…）；
- 结果存 `tokens`（空格分隔），同时用于 FTS 索引与查询。
- 查询：同一分词器 → `MATCH 'tok1 OR tok2 OR ...'`，按 BM25 排序。
- **2 字查询**（如"时区"）用 `LIKE '%时区%'` 兜底（表小，可接受）。

> 约 40 行代码；中文召回优于默认 unicode61 单字，成本可忽略。

---

## 6. 写入路径（默认 0 LLM）

```
对话中 ──► 规则抽取（正则/关键词，无模型）
            ├─ 显式：/remember、memory.remember → 直接写
            ├─ 隐式：命中"记住/以后/总是/从不/我喜欢/我的…"句式 → 写候选
            └─ 情节：会话压缩完成 → 写 episode（TTL 30 天）
         ──► memory_candidates（候选池，不注入）
每天 03:00（或空闲时）──► 整理任务（1 次 LLM，可选 0）
            ├─ 去重/合并（Jaccard ≥0.8）
            ├─ 抽取事实/偏好/规则（严格 JSON，校验失败丢弃）
            ├─ 同键覆盖（key 相同 → 更新旧值）
            └─ 写 memories + 记 memory_runs
```

**规则抽取示例**（不用模型）：

- `记住[:：]? (.{4,200})` → fact
- `以后(都)?要? (.{2,100})` / `以后别 (.{2,100})` → rule
- `我(喜欢|偏好|习惯|不喜欢) (.{2,100})` → preference
- `我的(时区|名字|邮箱|项目)是 (.{1,100})` → fact（key=字段名）

**每日整理（可选模型）**

- 输入：≤50 条候选（每条 ≤200 字）→ 输出严格 JSON 数组；
- 预算：≤2K token/天；用便宜模型或与主模型相同（可配 `memory.consolidation_model`）；
- **极简模式**：关闭 LLM，仅做规则去重入库（成本 0，质量略低）；
- 失败：候选保留 7 天，下次再试；不影响对话。

**写入限制**：单条 ≤500 字；每天新增 ≤50 条；拒绝密钥/卡号（正则 + 用户确认）。

---

## 7. 读取路径（每轮 ≤600 token，无 LLM）

```
当前输入 ──► 分词 ──► FTS 查询（ns ∈ {global, bot}，未过期，未归档）
              │            └─ 候选 top 20
              ├─ 排序：score = BM25 + 0.3*recency + 0.5*pinned + 0.2*confidence
              ├─ 去近重（Jaccard ≥0.8 只留一条）
              └─ 取 top-k（k≤5），每条截断 120 字
L1 pinned（≤200 token，稳定排序）
+ L2 检索结果（≤300 token）
+ 未完成目标/待办一行（若有）
= digest（≤600 token）→ 拼进 system 段
```

**排序细节**

- `recency = exp(-days_since_used / 30)`：最近用过的优先；
- `pinned` 固定进 L1，不参与 L2 竞争；
- 同键（`key` 相同）只保留最新一条；
- 无命中 → digest 为空，**不注入**（省 token）。

**性能**

- FTS5 查询在 5000 行内 <5ms；整体 digest <10ms；
- 每轮只查一次；同一 turn 内缓存结果；
- 不调用模型、不做 embedding。

---

## 8. 淘汰与遗忘（自动 + 手动）

| 机制 | 规则 |
|---|---|
| TTL | episode 30 天；候选 7 天；fact/rule/preference 默认永久 |
| 衰减 | `score = confidence * exp(-days_since_used/90) + 0.1*min(use_count,5)` |
| 归档 | score < 0.2 且 90 天未用 → `expires_at` 置为过去（不再检索，保留可恢复） |
| 容量 | 超 5000 行 → 按 score 淘汰到 4500 |
| 手动 | `/memory` 查看；`/forget <词>` 删除；`/remember <文本>` 直接写 |
| 纠错 | 同键覆盖；用户说"不对，是 X" → 更新 key 并降旧值 confidence |

---

## 9. 安全与隐私

- 记忆只存文本，不存密钥/卡号（写入前正则拦截）；
- 每 Bot 独立 `ns`，跨 Bot 不可查（`ns IN ('global','bot:<id>')`）；
- `source_ref` 指向事件，可溯源；删除记忆同时留审计；
- 备份随 SQLite；导出 `jary memory export --format json`（脱敏可选）；
- 模型看到的只有 digest（≤600 token），不是全库。

---

## 10. 可选语义增强（默认关闭）

若以后觉得关键词召回不够：

```ts
interface EmbeddingProvider { embed(texts: string[]): Promise<Float32Array[]> }
```

- 只对**已入库记忆**做 embedding（写入时一次，不是每轮）；
- 存储：`sqlite-vec` 扩展或 `memory_vec` BLOB 表（≤5000 条 × 384 维 × 4B ≈ 7.7MB）；
- 检索：hybrid = 0.7*FTS + 0.3*cosine；
- 触发条件：FTS 命中 <2 且用户 query 较长；
- **默认关闭**，开启需显式配置（`memory.semantic.enabled=true`）并接受额外 CPU/内存。

---

## 11. 预算与消耗（4C4G 实测目标）

| 项 | 目标 |
|---|---|
| 每轮 digest | ≤600 token（约 0.3–0.5K token，按 DeepSeek 价格可忽略） |
| 每日整理 | ≤1 次 LLM，≤2K token（约 ¥0.002/天级别） |
| 每日写入 | ≤50 条，CPU <10ms |
| 检索 p95 | <20ms |
| DB 增长 | <1MB/年（10 条/天） |
| 常驻内存 | <30MB |
| 备份 | 单文件，随 `jary.db` |

> 对比：全量 embedding 方案每天至少几千次 torch/ONNX 推理 + 向量库常驻；本方案**零外部调用**。

---

## 12. 指标与观测

- `memory_count`、`memory_hit_rate`（每轮有命中/总轮次）、`memory_digest_tokens`、`memory_search_ms`、`memory_consolidation_cost`、`memory_evicted`；
- `/memory stats` 给人看：条数、命中率、最近整理、占用；
- 回放：`jary memory audit` 看某条记忆由哪个事件写入。

---

## 13. 验收（P3 Gate）

- [ ] 告诉它"周报中文、结论先行" → 新会话仍生效；digest ≤600 token
- [ ] `/forget 周报` 后不再出现；`/memory` 能看到条目与来源
- [ ] 无命中时 digest 为空（不浪费 token）
- [ ] 1 万条记忆下 FTS p95 <20ms（造数据压测）
- [ ] 每日整理：≤1 次 LLM、≤2K token；失败不阻塞对话
- [ ] 密钥/卡号被拒绝写入
- [ ] 跨 Bot 查不到彼此记忆
- [ ] 极简模式（关 LLM）仍可去重入库
- [ ] DB 增长符合预估（30 天实测 <0.1MB）

---

## 14. 实现计划（P3，约 1–1.5 周）

| 天 | 工作 |
|---|---|
| D1 | 分词器 + 表/FTS + 读写仓库（单测） |
| D2 | 写入：显式/规则抽取/候选池；`/remember` `/forget` `/memory` |
| D3 | 读取：digest 组装 + 排序 + 去重 + 预算截断 |
| D4 | 整理任务：去重/合并/同键覆盖/衰减；memory_runs |
| D5 | 压测（1 万条）、指标、边界（无命中/中文/长文本） |
| D6 | 与上下文装配/压缩集成；Gate 验收 |

**依赖**：无新增第三方库（SQLite FTS5 内置）；分词器 ~40 行；整理用已有 LLM 适配器。

---

## 15. 与 Grok Bot 的对比（记忆维度）

| 维度 | Grok Bot | jaryn-bot |
|---|---|---|
| 形态 | 托管记忆 + 工作日志 | 本地 SQLite + 文件（MEMORY.md 导出） |
| 成本 | 受上下文税影响 | digest ≤600 token，整理 ≤2K/天 |
| 可控 | 可查看/编辑 | 可查看/编辑/导出/删除/回放来源 |
| 语义检索 | 黑盒 | 默认关键词，可选语义（自控） |
| 隔离 | 每 Bot 独立 | 每 Bot 独立 `ns` |
