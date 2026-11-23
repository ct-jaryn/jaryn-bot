# jaryn-bot v1.0.0

自托管的个人 AI 同事，可在 4C4G 单机运行。从 v0.1 到 v1.0，规划中的能力均已实现并测试。

## 能力清单

| 领域 | 已实现 |
|---|---|
| 运行时 | 插件内核（Context/Effect/Event/Loader）、SQLite 事件溯源、可回放、失败重放 |
| 模型 | DeepSeek 流式 + 原生 tool-calling（OpenAI 兼容）、重试、取消、上下文压缩 |
| Web UI | 会话、流式、工具步骤、审批卡、附件、看屏面板、PWA 安装 |
| 审批 | execute/external/destructive 默认 ask；允许/拒绝/超时；设备令牌 |
| 记忆 | FTS5 + bigram、pinned、≤600 token digest、目录检索、整理、遗忘 |
| 多 Bot | 名册、任务板（CAS）、消息总线（hop≤2） |
| 主动 | cron/every/webhook(HMAC)、预算、目标多轮、历史、stop-all、Initiative 提议、teach-a-task |
| 云电脑 | 本地 Chrome / Docker 后端、浏览器工具、截图、快照/恢复、SSE 看屏、接管、输入、本机出网隧道 |
| 凭据 | AES-256-GCM write-only、盲填、一次性 Secure Form、审计/轮换/授权 |
| 连接器 | 通用 HTTP（Bearer/API Key）、OAuth URL 助手、GitHub/httpbin 示例 |
| 邮箱 | SMTP 发信、IMAP 未读轮询、入站 webhook |
| 产物 | artifact 库、Pages（CSP、分享 token）、docx/xlsx/pptx（LibreOffice 可选） |
| 运维 | /healthz、/metrics、backup/restore、plugin 管理、doctor、tunnel、设备配对 |
| 质量 | 76 测试、docs/deploy/eval 校验脚本、CI 可用的 `npm run check` |

## 快速开始

```bash
cp .env.example .env         # 可选填 DEEPSEEK_API_KEY
docker compose -f deploy/docker-compose.yml up -d --build
# → http://127.0.0.1:8787
```

或本地：

```bash
node packages/cli/src/index.ts init --home ./data-home
node packages/cli/src/index.ts serve --home ./data-home --port 8787
```

## 未实现（明确边界）

- 桌面壳 / 原生 iOS/Android App（当前 PWA）
- 1Password / Bitwarden 集成、卡支付
- 官方 Gmail / Calendar OAuth 应用（仅通用连接器 + 示例）
- 邮件 HTML/附件解析（仅纯文本正文）
- 实时低延迟串流（当前截图轮询 2–10fps）
- 真实模型评测与 Docker 构建实测（需要 API key / 本机 docker）
- 团队协作 / 会议 / 企业管控 / 语音 / 多租户（设计上明确不做）
