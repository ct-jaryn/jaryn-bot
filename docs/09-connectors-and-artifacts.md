# 09 · 连接器 · 邮箱 · Pages · 产物

> 状态：**现行（v0.4 已实现：通用 HTTP 连接器、SMTP 发信、入站 webhook、IMAP 轮询、Pages、产物；Gmail/Calendar 等官方 Gmail/Calendar 提供示例配置与 OAuth 回调，需要用户自建 OAuth 应用）**。目标：让 Bot 直接"在你常用的工具里干活"，而不是只能开网页点。
> 关联：[01 FR-17/FR-18](01-functional-spec.md) · [08 Vault](08-vault-and-credentials.md) · [06 客户端](06-clients-and-topology.md)

---

## 1. 连接器框架

**目的**：把"第三方 API"抽象成统一插件，token 进 Vault，工具名统一，权限可单撤。

```json
// connector manifest（插件 package.json 的一节）
{
  "jaryn": {
    "connector": {
      "id": "gmail",
      "auth": { "type": "oauth2", "scopes": ["gmail.readonly", "gmail.send"], "pkce": true },
      "tools": [
        { "name": "search", "risk": "read" },
        { "name": "read", "risk": "read" },
        { "name": "send", "risk": "external" }
      ],
      "rateLimit": { "perMinute": 60 }
    }
  }
}
```

**统一行为**
- 连接：`jary connector connect gmail`（或客户端按钮）→ 浏览器 OAuth → 回调 → token 入 Vault → 绑定 Bot。
- 工具名：`gmail.search` / `gmail.send` / `calendar.create` …；模型看到的是普通工具。
- 权限：连接级（scope）+ 工具级（risk）；`send` 类默认 ask；可对"某 Bot + 某收件人域"建窄规则。
- 撤销：删连接 → token 失效 + 工具立即消失。
- 健康：token 过期/被吊销 → 通知用户重新授权（见 10 主动任务）。

**OAuth broker（服务端）**
- 回调地址：`https://<server>/api/oauth/callback/:connector`。
- 流程：客户端发起 → 服务端生成 state + PKCE → 浏览器授权 → 回调校验 state → 换 token → 加密存 Vault。
- 作用域最小化；不申请写权限除非用户显式连接"写"。
- 无浏览器环境：CLI 提供 device-code 流（若厂商支持）。

**官方连接器优先级（个人版）**

| 优先级 | 连接器 | 用途 |
|---|---|---|
| P0 | Gmail、Google Calendar | 邮件/日程 = 主动任务的主要信号源 |
| P0 | GitHub | issue/PR/CI 通知、代码任务 |
| P1 | Notion、Google Drive | 文档读写 |
| P1 | 个人邮箱（IMAP/SMTP） | 自建域名邮箱 |
| P2 | Linear、Slack（个人 DM） | 任务与通知 |
| — | 任意 MCP server | 兜底扩展 |

**明确不做**：企业级连接器（Salesforce/Workday 等）、团队共享连接器、多用户 token 池。

---

## 2. 个人邮箱通道

**目的**：给 Bot 一个自己的邮箱地址，像真人同事一样收发邮件；也是"主动任务"的输入源。

| 项 | 规格 |
|---|---|
| 地址 | 两种：① 自有域名 catch-all/plus（`bot@yourdomain.com`）；② 提供商 API（Gmail 专用标签/应用密码） |
| 入站 | IMAP IDLE 或 webhook 轮询（60s）；解析 MIME/附件；去重（Message-ID） |
| 出站 | SMTP 或 Gmail API；发件人显示 Bot 名称；签名可配 |
| 安全 | 仅接受 allowlist 发件人（默认"仅自己"）；SPF/DKIM 由你的域负责 |
| 路由 | 主题/发件人规则 → 指定 Bot/会话；默认进 primary Bot |
| 隐私 | 正文作为不可信输入（injection 标注）；不自动执行邮件里的指令 |

**验收**：给它发一封邮件 → 5 分钟内回复；附件被保存为 artifact；陌生发件人被拒并通知你。

---

## 3. Pages（可交互产物）

**目的**：比 docx 更适合"持续更新的东西"——日报、看板、tracker、对比表；对标 Grok Bot Pages。

**设计**
- 产物类型 `page`：一个自包含 HTML 包（HTML/CSS/JS + 内嵌数据），**只允许白名单 API**（无外网、无 localStorage、无 cookie）。
- 生成：模型写 `pages.create {title, html, data}`；服务端做 CSP 加固与大小限制（≤2MB）。
- 渲染：客户端在 `<iframe sandbox="allow-scripts">` 里打开；服务端不执行页面 JS。
- 分享：默认私有（仅 owner 设备）；可生成只读分享链接（token、可设过期、可撤销）。
- 更新：页面是 artifact 的新版本，保留历史；"今天的日报"可覆盖同名页面。
- 数据驱动：可选 `data` JSON + 内置渲染模板（表格/图表/筛选），模型不写 JS 也能出看板。

**与 Grok Bot 的差异（超越点）**：Pages 在**自己服务器**上，链接不经过第三方；默认私有，可完全离线打开（导出 HTML）。

---

## 4. 产物管线

| 类型 | 生成 | 预览 |
|---|---|---|
| md / txt / csv / json | 直接写 | 客户端渲染 / IM 附件 |
| docx / xlsx / pptx | LibreOffice（容器内）模板化生成 | 客户端缩略图 + 下载 |
| 图片 | 工具生成/截图 | 直接预览 |
| 下载文件 | 浏览器下载 → artifact | 链接 |
| page | HTML 包 | iframe |

- 存储：`/data/artifacts/<id>`，DB 记元数据；单文件 ≤20MB，保留 30 天（可配）。
- 安全：HTML/SVG 一律沙箱渲染；可执行文件仅存储不预览；可选 ClamAV 扫描。
- 交付：客户端内查看/下载；IM 里发文件或链接。

---

## 5. 接口

```ts
// connector seam
interface ConnectorRegistry {
  list(): ConnectorMeta[]
  connect(id, botId, scopes?): Promise<ConnectionId>
  disconnect(connectionId): Promise<void>
  health(connectionId): Promise<'ok'|'expired'|'revoked'>
}

// 工具示例
'gmail.search {query}'
'gmail.send {to, subject, body, attachments?}'    // risk=external
'calendar.create {title, start, end, attendees}'
'github.issues {repo, state}'

// pages
'pages.create {title, html?, data?, template?}'
'pages.update {pageId, ...}'
'pages.share {pageId, expiresIn}'
```

---

## 6. 验收（连接器 Gate）

- [ ] Gmail 连接成功；`search` 返回结果；`send` 触发审批后发出
- [ ] token 过期 → 通知"重新授权" → 重新连后工具恢复
- [ ] 撤销连接 → 工具立即不可见、token 失效
- [ ] IMAP 邮箱：收信 → 5 分钟内处理 → 回复
- [ ] 生成一个 Pages 看板，客户端打开正常；导出 HTML 离线可看
- [ ] 分享链接带 token/过期/可撤销；默认私有
- [ ] docx/xlsx/pptx 生成并在客户端预览
- [ ] 恶意 HTML（外联/窃取）被 CSP 拦截

---

## 7. 明确不做

- 企业连接器与团队共享授权
- 公共 Page 托管/建站（仅私有分享链接）
- 浏览器插件/邮件客户端（我们只做 Bot 侧）
- 支付/财务类连接器（Stripe 等）——**明确不做**；Vault 只做卡信息填表，不接网关（见 [17](17-scope-and-wont.md)）
