# jaryn-bot v1.8.0 — 补齐功能审计缺口

对照设计文档又扫了一遍代码，修掉/补上的功能缺口：

## 修复（安全/正确性）

- **Vault 授权强制**：`vault.fill` / `vault.fill_card` 现在真的检查 `vault_grants`（之前存表不校验）
- **记忆维护**：容量上限 5000、episode TTL、得分衰减归档、超限淘汰、每 6 小时自动执行
- **工具并行**：`parallelSafe` 且非 execute/external/destructive 的调用并发执行（≤4）

## 新增

- `jary plugin add npm:/git:/file:` 与 `jary plugin remove`（写入 profile patch，`--trust` 提示）
- `jary session export <id>`（默认脱敏；`JARY_EXPORT_RAW=1` 原样）与 `session delete --yes`
- `pages.export` 工具 + `GET /api/pages/:id/export`
- Web 文本命令：`/status /compact /new /stop /memory /forget /remember /artifacts /jobs /bots /approvals /help`
- `@jaryn/maintenance`：30 天自动归档会话、停滞 goal 标记
- 137 个测试

## 仍然没做（下一批）

- SMTP TLS/STARTTLS + 发信附件（当前仅明文 25 端口）
- `/ws/client` JSON-RPC 客户端协议（现为 SSE+REST）
- Initiative 信号扩展（日历/邮件/连接器失效/目标停滞）、接受提议自动执行
- 后台任务审批 0 容忍策略、审批 thread 作用域
- 工具输出 >32KB 落盘、>1MB 拒绝/二进制转 artifact
- 云电脑 4h/8h 上限、按域名 egress 白名单、`computer.restart`
- Pages 版本历史、分享链接过期/撤销
- 设备配对码尝试次数限制、node 角色
- iOS 客户端、真 WebRTC、真实支付网关、官方 Gmail/Calendar 应用（外部条件或明确不做）
