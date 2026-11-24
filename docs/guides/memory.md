# 长期记忆

> 适用版本：v1.11.0 · 状态：现行
> 这份文档说明 Bot 如何跨会话记住事实、偏好与规则，以及如何查看、纠正和删除记忆。

## 概览

记忆存放在 SQLite 单文件中（默认随 `jary.db`），不引入向量库或 embedding：写入是显式命令与规则抽取，读取是 FTS5 + 中文 bigram 检索，按预算拼成 digest 注入 system 提示。

| 层次 | 内容 | 进入上下文的方式 |
|---|---|---|
| 工作记忆 | 当前会话消息与压缩摘要 | 由上下文装配直接携带 |
| 核心记忆（pinned） | 稳定的事实、规则、偏好 | 每次组装 system 时固定注入，最多 5 条 |
| 检索记忆 | 与当前输入命中关键词的条目 | 每次组装 system 时取 FTS top-k（默认 5） |
| 情节记忆（episode） | 短期事件摘要 | 与检索记忆一起竞争，受 TTL 清理 |

digest 上限 600 token（按 1 token ≈ 3 字符折算），单条只截取前 120 字；没有命中时不注入。

## 快速上手

CLI 的默认命名空间是 `global`：

```bash
jary memory add --kind rule --pinned "以后周报都用中文，结论先行"
jary memory add --ns bot:jaryn "我的时区是 Asia/Shanghai"
jary memory search "周报 中文" --limit 5
jary memory catalog
jary memory list --kind rule --limit 20
jary memory digest "周报"
jary memory forget "周报"
jary memory consolidate
```

HTTP（`jary serve` 默认 127.0.0.1:8787）：

```bash
curl -s 'http://127.0.0.1:8787/api/memory?ns=bot:jaryn'
curl -s 'http://127.0.0.1:8787/api/memory?ns=bot:jaryn&query=周报'
curl -s -X POST http://127.0.0.1:8787/api/memory \
  -H 'content-type: application/json' \
  -d '{"ns":"bot:jaryn","text":"以后周报都用中文","kind":"rule","pinned":true}'
curl -s -X DELETE 'http://127.0.0.1:8787/api/memory/<id>?ns=bot:jaryn'
```

Web 会话命令：`/remember <文本>`、`/forget <词>`、`/memory`。三条命令都使用当前会话 Bot 的命名空间。

## 关键概念与配置

| 概念 | 说明 |
|---|---|
| `ns` | `global` 或 `bot:<id>`。Agent 的 digest 与自动抽取使用 `bot:<botId>`；CLI/HTTP 默认 `global`；记忆工具默认由 `@jaryn/memory` 的 `ns` 配置决定（默认 `global`） |
| `kind` | `fact`、`preference`、`rule`、`episode`、`skill`、`note`，默认 `fact` |
| `pinned` | 固定注入，容量回收时不会被淘汰 |
| `source` | `user`、`rule`、`consolidation` 等，用于溯源 |
| `confidence` | 0–1，默认 0.7，参与检索排序与衰减 |
| `expiresAt` | 过期时间；检索会过滤，`list`/`catalog` 不过滤 |

记忆插件配置（`@jaryn/memory` 的 `config`）：

| 配置项 | 默认 | 作用 |
|---|---|---|
| `ns` | `global` | 记忆工具使用的命名空间 |
| `maxEntries` | `5000` | 单库容量上限 |
| `episodeTtlDays` | `30` | episode 的 TTL，过期直接删除 |
| `decayDays` | `90` | 衰减窗口 |

写入限制：单条不超过 500 字符，空文本拒绝；文本按 bigram 分词后写入 `tokens` 与 FTS 索引。`catalog` 返回每个 kind 的条数和最多 3 条 60 字标题；`list` 单次最多返回 100 条，可按 `kind`/`tag` 过滤；`read` 返回单条全文。

检索排序为 `-bm25 + 0.3*recency + 0.5*pinned + 0.2*confidence`，其中 `recency = exp(-days/30)`。读取不会回写 `last_used_at`/`use_count`，这两个值只反映写入或合并时间。

自动维护由记忆插件与 maintenance 插件各自每 6 小时触发一次：

| 机制 | 行为 |
|---|---|
| TTL | 删除超过 `episodeTtlDays` 的 `episode` |
| 衰减归档 | 90 天未使用且得分低于 0.2 的非 pinned 条目，`expires_at` 置为过去 |
| 容量回收 | 超过 `maxEntries` 时删除到约 90%，优先低置信度、久未更新的非 pinned 条目 |

## 常见任务

### 让一条偏好跨会话生效

使用 `pinned` 与 `rule`，并写入 Bot 的命名空间；这样每次组装 system 时都会出现在 digest 前部：

```bash
jary memory add --ns bot:jaryn --kind rule --pinned "回答先给结论，再给依据"
```

### 查看 Bot 记得什么

先看目录再取条目，避免一次读出全库：`memory.catalog` → `memory.list` → `memory.read`，或对应 HTTP/CLI 命令。

```bash
jary memory catalog
curl -s 'http://127.0.0.1:8787/api/memory?ns=bot:jaryn&kind=rule'
```

### 纠正与遗忘

当前没有"同 key 覆盖"或就地编辑的命令。纠正做法是先 `forget` 再 `add`；`forget` 按关键词命中（最多 50 条）或按 id 删除。

```bash
jary memory forget "旧偏好"
jary memory add --ns bot:jaryn --kind preference "新偏好"
```

### 处理自动抽取的候选

每轮用户输入都会经过规则抽取；输入整句命中固定句式（如 `记住：…`、`以后要…`、`我喜欢…`）时写入 `memory_candidates`。整理是手动命令，纯规则去重合并，不调用 LLM：

```bash
jary memory consolidate
```

整理消费最多 200 条候选：文本 Jaccard ≥ 0.8 视为重复并提升置信度，否则写入 `memories` 并标记候选已消费。

### 从脚本写入

使用 `POST /api/memory`，字段为 `ns`、`text`、`kind`、`pinned`；删除使用 `DELETE /api/memory/<id>?ns=...`。需要固定命名空间时，可在 profile patch 中配置 `@jaryn/memory` 的 `ns`。

## 限制与边界

- 只做字面检索：中文按 bigram、英文按词；没有向量检索、同义扩展或 embedding 依赖。
- `memory.remember` 等模型工具默认写 `global`，而 Agent 的 digest 读取 `bot:<botId>`。要让工具写入进入当前 Bot 的上下文，需把 `ns` 配置为对应 Bot 的命名空间，或改用 `/remember`、CLI/HTTP 显式指定命名空间。
- 归档不是物理删除：`search`/`digest` 会跳过过期条目，`list`/`catalog` 仍能查到。
- `tags` 有表与 `list({tag})` 过滤，但当前没有写入 tag 的 CLI、HTTP 或工具入口。
- 写入不做密钥、卡号、身份证号识别；不要把凭据写进记忆，凭据应放在 Vault。
- 候选池没有自动整理任务，也没有 TTL；不执行 `consolidate` 就不会进入长期记忆。
- `episode` 类型受 TTL 清理，但当前没有自动写入 episode 的路径。
- 整理与维护都不调用模型；不存在"每日 03:00 整理""≤2K token/天"这类 LLM 预算。
- 没有 `memory export` 命令；备份请直接备份 SQLite（`jary backup`），或按 `ns` 查询后自行导出。
- 同一数据库内按 `ns` 隔离，跨 `ns` 查不到；Bot 之间默认互不可见。

## 相关文档

- [快速上手](../getting-started.md)
- [核心概念](../concepts.md)
- [工具参考](../reference/tools.md)
- [CLI 参考](../reference/cli.md)
- [HTTP API 参考](../reference/http-api.md)
- [配置参考](../reference/configuration.md)
- [Web UI 指南](web-ui.md)
- [Vault 与凭据](vault.md)
- [故障排查](../operations/troubleshooting.md)
