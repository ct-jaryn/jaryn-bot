# Changelog

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
