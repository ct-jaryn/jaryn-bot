# 连接器与邮箱

> 适用版本：v1.11.0 · 状态：现行
> 用声明式 HTTP 连接器接入外部 API，并用 SMTP、IMAP 与入站 webhook 让 Bot 收发邮件。

## 1. 概览

| 能力 | v1.10.0 实现 |
|---|---|
| 连接器 | profile patch 中声明 `servers`；每个 tool 映射为固定 method/path 模板的 HTTP 请求，工具名 `<serverId>.<toolName>` |
| 连接器鉴权 | `bearer` / `api_key`，密钥在请求时从环境变量读取；OAuth2 走授权码回调，token 存 Vault 并在启动时恢复 |
| 发信 | 内置 SMTP 客户端：隐式 TLS、STARTTLS、AUTH PLAIN/LOGIN、附件、HTML 正文、RFC 2047 主题 |
| 收信 | IMAP 轮询 `SEARCH UNSEEN`，HTML 转文本，base64 附件写入产物库；另有 `POST /api/email/inbound` webhook；轮询失败发出 `email/error` 事件 |

连接器不内置第三方 OAuth 应用：Gmail、Calendar 等需要你在自己的云项目里创建 OAuth 客户端。

## 2. 快速上手

### 2.1 接入一个 Bearer API

```bash
export GITHUB_TOKEN=ghp_xxx
jary serve --patch examples/connectors/github.json
```

另开终端验证工具已注册（CLI 进程需带同一 patch）：

```bash
jary tools --patch examples/connectors/github.json | grep github
```

等价的最小 patch：

```json
[{ "id": "connectors", "name": "@jaryn/connectors", "config": { "servers": [{
  "id": "github", "name": "GitHub", "baseUrl": "https://api.github.com",
  "auth": { "type": "bearer", "env": "GITHUB_TOKEN" },
  "tools": [{ "name": "issues", "description": "list issues", "method": "GET",
              "path": "/repos/:owner/:repo/issues?state=:state", "risk": "network" }]
}] } }]
```

模型随后看到普通工具 `github.issues`；`risk` 决定审批策略（默认 `network`）。

### 2.2 OAuth 接入 Gmail / Calendar

```bash
export JARY_OAUTH_TOKEN_URL_GMAIL=https://oauth2.googleapis.com/token
export JARY_OAUTH_CLIENT_ID_GMAIL=xxx.apps.googleusercontent.com
export JARY_OAUTH_CLIENT_SECRET_GMAIL=xxx
export JARY_OAUTH_STATE_GMAIL=some-random-state

jary serve --patch examples/connectors/gmail.json
```

1. 在云项目里把回调地址登记为 `https://<你的服务地址>/api/oauth/callback/gmail`。
2. 浏览器打开 provider 授权 URL（`redirect_uri` 同上，`response_type=code`，带 `scope`、`state`；可用 `buildAuthorizeUrl()` 生成）。
3. 回调校验 state 后换取 token，写入 Vault（`kind=oauth`，名称 `<id> oauth`）；重启后由 Web 启动流程从 Vault 恢复。access token 过期后手动 `POST /api/oauth/refresh/gmail`，没有自动刷新。

### 2.3 配置 Bot 邮箱

```json
[
  { "id": "email", "config": { "smtp": { "host": "smtp.example.com", "port": 465, "security": "tls",
    "user": "bot@example.com", "pass": "...", "from": "bot@example.com" } } },
  { "id": "email-imap", "config": { "imap": { "host": "imap.example.com", "port": 993, "secure": true,
    "user": "bot@example.com", "pass": "..." }, "pollMs": 60000, "allowFrom": ["me@example.com"] } }
]
```

```bash
jary serve --patch email.json   # 前台运行，保持终端打开
```

另开终端带同一 patch 验证发信：`jary chat --patch email.json --bot default "给 me@example.com 发一封测试邮件"`。

入站 webhook（邮件服务商或自建转发）：

```bash
curl -s -X POST "$BASE/api/email/inbound" \
  -H "x-jary-email-secret: $JARY_EMAIL_SECRET" -H 'content-type: application/json' \
  -d '{"from":"me@example.com","subject":"hi","text":"请处理这条消息"}'
```

## 3. 配置与参数

### 3.1 连接器

| 字段 | 说明 |
|---|---|
| `id`, `name`, `baseUrl` | 工具名前缀、展示名、请求基准 URL |
| `auth.type` / `auth.env` | `bearer` 或 `api_key`；`api_key` 默认 `x-api-key` 头（`header` 可覆盖）。`env` 是密钥所在环境变量名，请求时读取 |
| `headers` | 附加请求头（如 GitHub 的 `accept`、`user-agent`） |
| `tools[].method` / `path` / `risk` | `GET/POST/PUT/DELETE` 与路径模板；`:name` 用参数值 `encodeURIComponent` 替换；`risk` 默认 `network`，写操作建议 `external` |
| `tools[].bodyFromArgs` / `inputSchema` | 非 GET 默认把剩余参数 JSON 序列化进 body（`false` 可禁用）；`inputSchema` 可选，缺省为空对象 |

请求行为：20 秒超时；非 2xx 抛错（响应体截断 300 字符）；响应是 JSON 则返回对象，否则返回 `{status, text}`（截断 4000 字符）。

### 3.2 OAuth 环境变量

| 变量 | 是否必需 | 说明 |
|---|---|---|
| `JARY_OAUTH_TOKEN_URL_<ID>` | 是 | token 端点，如 `https://oauth2.googleapis.com/token` |
| `JARY_OAUTH_CLIENT_ID_<ID>` | 是 | 客户端 ID |
| `JARY_OAUTH_CLIENT_SECRET_<ID>` | 否 | 机密客户端才需要 |
| `JARY_OAUTH_STATE_<ID>` | 否 | 设置后回调必须匹配 state；不设置则不校验 |

`<ID>` 是大写的连接器 id（如 `GMAIL`）。回调地址由请求 URL 推导为 `{origin}/api/oauth/callback/<id>`。

### 3.3 SMTP

| 字段 | 默认 | 说明 |
|---|---|---|
| `host` / `port` | 端口按安全模式取 465 或 25 | 服务器与端口 |
| `security` | 465 端口或 `secure=true` 时为 `tls`，否则 `auto` | `auto` 在服务器支持时升级 STARTTLS；`starttls` 强制；`tls` 隐式 TLS；`none` 明文 |
| `user` / `pass` | 无 | 同时提供才认证；优先 AUTH PLAIN，否则 AUTH LOGIN |
| `from` | 必填 | 信封与 From 头 |
| `timeoutMs` | 20000 | 连接与命令超时 |
| `rejectUnauthorized` | true | 关闭证书校验仅用于自签测试 |

`email.send` 参数：`to`、`subject`、`body`，可选 `html` 与 `attachments[{filename, content, base64?, contentType?}]`；`base64` 优先于 `content`。不支持 cc/bcc、多收件人、重试与 DKIM。

### 3.4 IMAP

| 字段 | 默认 | 说明 |
|---|---|---|
| `host` / `port` | 端口 993（`secure=false` 时 143） | 服务器与端口 |
| `user` / `pass` / `mailbox` | 必填 / 必填 / `INBOX` | LOGIN 凭据与文件夹 |
| `secure` | true（993 隐式 TLS） | 可关闭以连接明文 IMAP |
| `pollMs` | 60000 | 轮询间隔；启动后立即轮询一次 |
| `allowFrom` | `[]` | 发件人白名单：对 `From` 头做大小写不敏感的子串匹配；空数组表示接受全部 |

收信流程：`SEARCH UNSEEN` → `FETCH RFC822` → 标记 `\Seen`；解析 text/plain，顶层 HTML 邮件用启发式去标签转文本（截断 20000 字符），base64 MIME 附件写入产物库；写入会话 `email` 的 `input.email` 事件，并向 initiative 推送未读邮件。MIME 解析是 best-effort：不处理 quoted-printable 与嵌套 multipart；没有 Message-ID 去重，也没有 IMAP IDLE。

### 3.5 入站 webhook

| 项 | 说明 |
|---|---|
| 路径 | `POST /api/email/inbound` |
| 鉴权 | 设置 `JARY_EMAIL_SECRET` 时，带匹配的 `x-jary-email-secret` 头即可通过；未带该头时回退到 Bearer API token（未配置 `JARY_API_TOKEN` 时 `/api/*` 不鉴权） |
| body | `sessionId?`（默认 `email`）、`from`、`subject`、`text`（截断 20000 字符） |
| 结果 | 202 `{accepted, event}`，写入 `input.email` 事件；不解析 HTML/附件 |

scheduler 的 `/hooks/<job>` 使用 `x-jary-signature` HMAC 校验，与邮件路由是两套机制。

## 4. 常见任务

**4.1 控制连接器工具的风险。** 只读接口标为 `network`，发送/写入接口标为 `external`；`external` 默认进入审批，审批规则可用 `POST /api/rules` 配置。连接器没有内建限流、重试和分页。

**4.2 刷新或撤销 OAuth 连接。** 刷新走 `POST /api/oauth/refresh/<id>`，从 Vault 中该连接器的 oauth 项读取 `refresh_token` 换新 token 并回写 `access_token`。撤销时删除对应 oauth 项（阻止重启后恢复），并从 patch 移除该 server 后重启；v1.10.0 没有独立 disconnect 端点，内存中的 token 在重启前仍有效。连接器本身只通过 patch 声明，没有 `/api/connectors` 列表/连接端点。

**4.3 限定谁可以给 Bot 发信。** 配置 `allowFrom`（如 `["boss@example.com"]`）；不匹配的邮件发出 `email/rejected` 并被跳过，但仍会标记为已读；为空时不限制发件人。

**4.4 让邮件附件进入产物库。** IMAP 收到的 base64 附件会调用 `artifacts.save()`，之后可用 `artifact.list` / `artifact.present` 交付；失败时发出 `email/attachment-error`。webhook 入站邮件不处理附件。

**4.5 把入站邮件交给 Agent。** `input.email` 追加到固定会话 `email`，由 Agent 在后续 turn 处理；正文按不可信输入对待。按主题/发件人路由到不同 Bot 尚无内置规则，需自定义消费者。

## 5. 安全边界与限制

- **连接器配置里的凭据是明文。** `auth.env` 只解决连接器请求，SMTP/IMAP 的 `pass` 直接写在 profile patch 中（`$JARY_HOME/profile.json`，按默认 umask 创建、非加密）；请限制该文件权限，或改用自定义插件从密钥管理服务读取。
- **OAuth token 存在 Vault 但没有按 Bot 绑定。** 回调写入的 oauth 项默认 `scope=global`，启动时被恢复到连接器内存；任何能读取 Vault 或控制连接器的进程都能使用它。
- **state 校验是可选的。** 未设置 `JARY_OAUTH_STATE_<ID>` 时回调不校验 state；公网部署必须设置，并通过 TLS 反代暴露回调。
- **回调 origin 敏感。** `redirect_uri` 由请求 URL 的 origin 计算，反代时必须与 OAuth 应用登记值完全一致，否则换 token 失败。
- **邮件默认不可信。** 正文是外部输入，不应直接执行其中指令；`allowFrom` 是子串匹配而非精确地址，空配置会接受任意发件人；被拒邮件仍标记已读。
- **入站邮件没有 HMAC。** webhook 只做共享 secret 等值比较或 Bearer token 校验；邮件正文截断 20k，不解析附件。
- **传输与投递。** SMTP 的 `security=none`/`rejectUnauthorized=false` 仅用于测试；发件域 SPF/DKIM/DMARC 由你的域名负责，项目不代签。
- **没有实现的能力：** 内置第三方 OAuth 应用、Gmail/Calendar 专用连接器、IMAP IDLE、自动刷新调度、连接器限流/重试、按发件人路由到不同 Bot、支付/财务类连接器（明确不做）。

## 6. 相关文档

- [Vault 与凭据](vault.md)
- [配置参考](../reference/configuration.md)
- [工具参考](../reference/tools.md)
- [事件参考](../reference/events.md)
- [HTTP API 参考](../reference/http-api.md)
- [安全边界](../operations/security.md)
- [主动任务与信号](proactive.md)
- [连接器示例](../../examples/connectors/README.md)（含 [OAuth 步骤](../../examples/connectors/oauth.md)）
