# jaryn-bot v0.9.0 — IMAP 收信

## 新增

- **IMAP 客户端**：LOGIN → SELECT → SEARCH UNSEEN → FETCH RFC822 → STORE \Seen，纯 Node socket
- **收信轮询**：`imapInboxPlugin` 每 60s 拉取未读，写 `input.email` 事件到 `email` 会话，并发出 `email/received`
- **配置**：在 profile patch 里给 `email-imap` 行填 `imap: { host, port, user, pass, secure, mailbox }`
- 74 个测试（含假 IMAP 服务器端到端）

## 示例

```json
[{ "id": "email-imap", "name": "@jaryn/email/imap", "config": {
  "imap": { "host": "imap.example.com", "user": "bot@example.com", "pass": "***" },
  "pollMs": 60000 } }]
```

## 已知限制

- 只处理纯文本正文；HTML/附件尚未解析
- 只读 UNSEEN；不做规则路由（所有邮件进 `email` 会话）
- 无删除/归档动作
