# Changelog

## Unreleased — P3 记忆 + 多 Bot（已完成）

### Added

- `@jaryn/memory`：SQLite + FTS5 记忆（bigram 分词、pinned、digest ≤600 token、目录检索 catalog/list/read、候选池 + 规则抽取 + 整理、遗忘）
- 记忆工具：`memory.remember/search/list/catalog/read/forget`
- agent loop：自动注入 digest、每轮规则抽取候选（0 LLM）
- `@jaryn/bots`：Bot 名册（独立 workspace/memory ns）、Bot 消息总线（hop≤2）、`bot.list_agents/send_message`
- `@jaryn/tasks`：任务板（create/claim/complete/list，CAS 版本）
- CLI：`memory add|list|search|catalog|digest|forget|consolidate`、`bot add|list|remove`
- Web API：`/api/memory`、`/api/bots`、`/api/tasks`
- 测试：tokenizer/FTS/digest/整理、bot 名册与 hop、任务板协作、记忆 API、digest 注入，共 36 个

## Unreleased — P2 Web UI（已完成）

### Added

- `@jaryn/web`：单页 Web UI（会话列表、流式聊天、工具步骤、审批卡、附件上传）
- HTTP API：`GET/POST /api/sessions`、`POST /api/message`、`GET /api/stream`（SSE）、`GET /api/events`、`GET/POST /api/approvals`、`GET/POST /api/files`、`/healthz`
- 审批桥：execute/external/destructive 默认 ask；允许/拒绝/超时（默认 deny）三路径
- CLI：`jary serve --port 8787`
- 测试：UI 服务、聊天事件、审批允许/拒绝/超时、文件上传下载，共 27 个

## Unreleased — P1 真模型（已完成）

### Added

- `@jaryn/llm-deepseek`：OpenAI 兼容流式、原生 tool-calling、reasoning、usage、429/5xx 重试、AbortSignal
- `@jaryn/tools-fs`：`fs.read/list/glob/grep`，工作区内路径校验、忽略目录、结果上限
- agent-core：正确的 tool_calls/tool 消息回填、上下文压缩（阈值可配，摘要落 `memory.consolidated`）、`cancelTurn`
- `evals/`：10 个任务与评测脚本（无 key 时跳过）
- CLI：接入 DeepSeek patch、fs 插件；`config print` 显示新增行
- 测试：provider SSE/重试、fs 工具与路径逃逸、压缩、取消，共 22 个

## Unreleased — P0 骨架（已完成）

### Added

- `@jaryn/kernel`：Context 树、服务 provide/inject、effect/disposer、事件（emit/parallel/serial/waterfall）、插件 Loader（profile/bundle/patch、拓扑排序、fail-loud）
- `@jaryn/store-sqlite`：SQLite 事件表、会话表、append/replay、WAL
- `@jaryn/agent-core`：turn 循环、预算（步数/工具数/墙钟）、工具注册表、事件落库、历史装配
- `@jaryn/tools-shell`：`shell.run`（超时/输出截断/取消）
- `@jaryn/testing`：FakeProvider / echo provider
- `@jaryn/cli`：`init`、`config print`、`chat`、`session list|replay`、`doctor`、`version`
- `packages/bundles/base/patch.json`：基础组合（store/llm/tools/shell/agent）
- 15 个测试：kernel、store、agent loop、shell、CLI 验收（含"禁用 shell 后模型看不到"、`kill -9` 后重开回放）

### Notes

- 当前仅 P0：模型为 echo/Fake provider；真实 DeepSeek 适配、上下文压缩、Web UI 属于 P1/P2。
