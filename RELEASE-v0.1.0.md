# jaryn-bot v0.1.0

首个可用版本：自托管的个人 AI 同事，Web UI 优先，4C4G 单机可跑。

## 包含

- **运行时**：插件内核（Context/Effect/Event/Loader）、SQLite 事件溯源、可回放
- **模型**：DeepSeek 流式 + 原生 tool-calling（OpenAI 兼容），重试与取消
- **Web UI**：会话、流式聊天、工具步骤、审批卡、附件上传；SSE 事件流
- **审批**：execute/external/destructive 默认 ask，允许/拒绝/超时
- **记忆**：SQLite+FTS5、bigram 分词、≤600 token digest、目录检索、整理/遗忘
- **多 Bot**：名册（独立 workspace/记忆域）、任务板（CAS）、消息总线（hop≤2）
- **主动任务**：cron/every/webhook(HMAC) 触发、预算、目标多轮、运行历史、stop-all
- **工具**：shell、fs.list/glob/grep/read、memory.*、task.*、bot.*
- **硬化**：Docker 沙箱（可选）、MCP 客户端、插件管理、/metrics、备份/恢复、外部工具输出 untrusted 包装

## 快速开始

```bash
cp .env.example .env            # 填 DEEPSEEK_API_KEY（可选）
sudo docker compose -f deploy/docker-compose.yml up -d
# → http://127.0.0.1:8787
```

或本地：

```bash
node packages/cli/src/index.ts init --home ./data-home
node packages/cli/src/index.ts serve --home ./data-home --port 8787
```

## 已知限制

- 仅单 owner、单实例（SQLite 单写者）
- 真实 DeepSeek 评测需 API key（`node evals/run.ts`）
- IM 通知、桌面客户端、Vault、连接器/邮箱/Pages、Initiative 未实现（待定包）
- Docker 沙箱需要宿主机 Docker；MCP 仅 stdio
