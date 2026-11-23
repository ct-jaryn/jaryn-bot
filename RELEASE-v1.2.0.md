# jaryn-bot v1.2.0 — RSS / 1Password / 进程外插件 / 快速看屏

## 新增

- **RSS 触发**：`trigger: { kind: "rss", url, everySeconds }`，新条目才派发，避免重复
- **1Password**：`@jaryn/secrets-1password` 通过 `op read` 取值并直接填入页面（值不进模型）
- **TOTP**：RFC 6238（SHA-1/6 位/30 秒），用于可选的二次验证码
- **进程外插件宿主**：第三方插件跑在独立子进程，通过 JSON-RPC 暴露工具；`examples/plugin-host` 是可运行示例（`demo.echo`、`demo.sum`）
- **快速看屏**：云电脑改用 CDP `Page.startScreencast`（JPEG，everyNthFrame=2），Web UI 默认走 screencast
- **Gmail/Calendar 示例**：连接器配置 + 自建 OAuth 应用指南（`examples/connectors/oauth.md`）

## 验证

```bash
npm test        # 117 tests（含真实 Chrome screencast）
npm run check
jary doctor     # 41 plugins
```

## 仍未做（明确）

- Bitwarden、卡支付
- 真 WebRTC 串流（当前 CDP screencast）
- 安静时段、IM 投递（无 IM）
- 桌面壳/原生 App
- 真实模型评测与 Docker 实测（需外部条件）
