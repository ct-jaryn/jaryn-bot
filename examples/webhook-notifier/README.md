# 外置移动通知与审批提醒桥接（Webhook Bridge）

按 [决策与边界](../../docs/design/decisions.md) 的架构约束，`jaryn-bot` 内核保持纯粹的 **Web 单入口**，不在主进程内耦合飞书、企业微信、钉钉、Slack、Telegram 等第三方 IM SDK。

但当你把 `jaryn-bot` 部署在云服务器（4C4G）常驻运行定时例程或长任务时，可以通过本目录提供的**零依赖进程外脚本** `notify-bridge.ts`，在以下时刻实时推送提醒到手机 IM，并一键跳回 Web / PWA 审批页处理：

1. **高危动作待审批**（`execute` / `external` / `destructive` 工具触发审批卡时实时推送）；
2. **Bot 提问待确认**（`ask_user` 卡片）；
3. **后台主动通知**（例程完成、6 类主动提议信号、新邮件入站，自动遵守通知中心的安静时段设置）。

## 启动方式

无需安装任何第三方包，直接用 Node 运行：

```bash
export JARY_URL=http://127.0.0.1:8787
export JARY_API_TOKEN=<你的令牌>
export PUBLIC_WEB_URL=https://bot.example.com   # 手机点击跳转的公网反代地址
export WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/<你的机器人密钥>

node examples/webhook-notifier/notify-bridge.ts
```

## 已内置自动识别的 Webhook 格式

脚本会根据 `WEBHOOK_URL` 域名自动组装对应 JSON 消息体：

- **飞书 / Lark**（`open.feishu.cn` / `open.larksuite.com`）
- **企业微信群机器人**（`qyapi.weixin.qq.com`）
- **钉钉群机器人**（`oapi.dingtalk.com`）
- **Slack Incoming Webhook**（`hooks.slack.com`）
- **Discord Webhook**（`discord.com/api/webhooks`）
- **通用 JSON Webhook**（任意自建推送网关 / Bark 中转服务）
