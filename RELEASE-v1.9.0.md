# jaryn-bot v1.9.0 — 邮件 TLS / 后台审批 / WS 协议 / 主动信号

上一轮审计列出的 P0/P1 项已全部落地。

## 安全与正确性

- **SMTP 重写**：465 隐式 TLS、STARTTLS（`auto` / 强制）、AUTH PLAIN + LOGIN、多行应答、附件、HTML 正文、非 ASCII 主题 RFC2047
- **后台审批 0 容忍**：`provenance != owner`（jobs/goals/workers/initiative）遇到 ask 风险工具**立即拒绝**并记 `background-policy`，不再等 30 分钟；需要放行就加一条 allow 规则
- **设备配对限次**：10 分钟窗口内最多 10 次失败，防猜码
- **云电脑域名 egress 白名单**：`allowedDomains: ["example.com", "*.trusted.dev"]`，非白名单 `browser.goto` 直接拒绝

## 新能力

- **`/ws/client` JSON-RPC**：`ping`、`session.list/create/subscribe`、`turn.send`（流式 delta + turn.end）、`turn.cancel`、`approval.respond`、`usage.total`；支持 `JARY_API_TOKEN` 鉴权
- **Initiative 信号 6 类**：任务失败、任务停滞、目标停滞、日历临近（45 分钟）、连接器失效、未读邮件；去重 + 日限额；**接受提议后立即执行并汇报**
- **工具输出落盘**：>32KB 自动写入 artifact，上下文只留指针
- **云电脑配额**：单次 4h、每日 8h、`computer.restart`、`computer.usage`
- **Pages**：版本历史（最多 20 版）+ 回滚、分享链接 TTL 与撤销
- 162 个测试（新增 SMTP TLS/STARTTLS、后台审批、WS RPC、Initiative 信号、配额、Pages 版本）

## 仍未做

- iOS 客户端、真 WebRTC、真实支付网关（明确不做或平台限制）
- 官方 Gmail/Calendar OAuth 应用（需自建应用；授权/回调/刷新链路已完整）
- 真实模型评测、Docker 镜像实测（需 `DEEPSEEK_API_KEY` / docker）
