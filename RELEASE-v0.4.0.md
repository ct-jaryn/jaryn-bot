# jaryn-bot v0.4.0 — 连接器 / 邮箱 / Pages / 产物

## 新增

- **连接器框架**：通用 HTTP 连接器（配置 baseUrl、认证、工具列表），API Key/Bearer；OAuth 授权 URL 助手；工具名 `<connector>.<tool>`
- **SMTP 发信**：纯 Node socket 实现 EHLO / AUTH LOGIN / MAIL / RCPT / DATA；`email.send`（risk external，需审批）
- **Pages**：表格/报告模板、CSP 无脚本渲染、更新、分享 token（`/p/:token` 只读）、导出
- **产物库**：`artifact.save/list`，sha256 与 20MB 上限
- **Web**：`/api/pages`、`/pages/:id`、`/p/:token`、`/api/artifacts`

## 配置示例

```json
{ "connectors": { "servers": [{
  "id": "github", "name": "GitHub", "baseUrl": "https://api.github.com",
  "auth": { "type": "bearer", "env": "GITHUB_TOKEN" },
  "tools": [{ "name": "repo", "description": "get repo", "method": "GET", "path": "/repos/:owner/:repo" }]
}]}}
```

## 已知限制

- Gmail/Calendar 等官方连接器只是配置示例，未内置 OAuth 应用
- 收信（IMAP）未实现；邮件目前只出不进
- Pages 禁止脚本（CSP `script-src 'none'`），交互图表待后续
