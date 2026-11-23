# jaryn-bot v0.8.0 — API 鉴权 + 入站邮件

## 新增

- **API 鉴权**：设置 `JARY_API_TOKEN` 后，`/api/*` 与 `/metrics` 需要 `Authorization: Bearer <token>`；
  也接受设备配对得到的设备令牌，或 EventSource 用的 `?token=`
- **入站邮件 webhook**：`POST /api/email/inbound`（可选 `x-jary-email-secret`）→ 不经过模型，直接写
  `input.email` 事件到 `email` 会话，供后续任务/流程消费
- 公共路径保持开放：`/healthz`、静态 UI、`/api/devices/pair*`（配对需要先拿 code）
- 71 个测试

## 使用

```bash
export JARY_API_TOKEN=change-me
jary serve --port 8787
curl -H 'Authorization: Bearer change-me' localhost:8787/api/sessions
curl -X POST localhost:8787/api/email/inbound -H 'Authorization: Bearer change-me' \
  -d '{"from":"a@b.c","subject":"hi","text":"hello"}'
```

## 已知限制

- IMAP 主动轮询未实现（入站依赖邮件供应商 webhook 转发）
- 设备令牌尚未细分权限（均为 owner）
