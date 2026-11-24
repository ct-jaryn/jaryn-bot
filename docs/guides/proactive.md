# 例程、目标与主动提议

> 适用版本：v1.11.0 · 状态：现行
> 这份文档说明如何让 Bot 按计划或外部事件执行任务、用多轮目标推进长任务、从信号中主动提出建议，以及把流程固化成可复用技能。

## 概览

| 机制 | 触发方式 | 产出 |
|---|---|---|
| 例程（job） | cron、固定间隔、webhook、RSS | 一次或多次 turn，运行历史与通知 |
| 多轮目标（goal） | 显式 `goal.run` | 连续多轮 turn，journal 与 system 中的目标行 |
| 主动提议（initiative） | 扫描 6 类信号 | pending 提议，可接受、忽略或静音 |
| 技能（teach） | 手写步骤或录制操作 | `skills/<slug>/SKILL.md`，目录注入 system |

## 快速上手

下面的命令创建三个例程（每天 08:00 的简报、每小时检查、部署 webhook），并演示目标、主动提议与技能入口：

```bash
jary job add --cron "0 8 * * *" --tz Asia/Shanghai --name daily-briefing \
  "汇总今天的日历和未读重要邮件，输出不超过 400 字"
jary job add --every 3600 --name hourly-check "检查任务板并推进待办"
jary job add --webhook deploy --secret "$WEBHOOK_SECRET" --name on-deploy "部署后检查健康状态"
jary job list
jary job runs <jobId>

jary goal set "把 Q4 复盘整理成三页文档" --session web --max-rounds 6
jary goal run --id <goalId>
```

```bash
curl -s -X POST http://127.0.0.1:8787/api/initiative/scan
curl -s 'http://127.0.0.1:8787/api/initiative?botId=jaryn'
curl -s -X POST http://127.0.0.1:8787/api/teach -H 'content-type: application/json' \
  -d '{"title":"生成周报","steps":["打开报表页","导出 Markdown","按模板改写"]}'
```

Web UI 的「例程」「提议」「通知」页签提供列表、立即运行、扫描、接受、忽略与全部已读。

## 关键概念与配置

### 例程触发器

| kind | 参数 | 说明 |
|---|---|---|
| `cron` | `expr`、`tz` | 5 字段；数字与 `* - / ,`；不支持 `@daily`、`MON` 等别名；缺省 UTC |
| `every` | `seconds` | 最小 60 秒 |
| `webhook` | `secret`（可选） | 端点固定为 `POST /hooks/<jobId>`，`path` 字段不参与路由 |
| `rss` | `url`、`everySeconds` | 最小 60 秒，默认 600；只在最新条目变化时触发 |

`cron` 的日与星期同时限定时取交集；同一 job 串行执行，触发时若上次仍在运行则跳过本次。

### 例程预算与运行历史

| 预算字段 | 默认 | 说明 |
|---|---|---|
| `maxRounds` | 1 | 1–20；多轮时第 2 轮起追加 "Reply DONE when complete" |
| `maxSteps` / `maxToolCalls` / `maxWallMs` | 未设置 | 透传给单轮 turn |
| `maxCostUsd` | 不生效 | 字段存在，但调度器未透传费用上限 |

运行状态为 `running`、`done`、`failed`、`budget`：`finishReason=completed` 记为 `done`，`aborted` 记为 `failed`，其余（如 `max-steps`、`budget`）记为 `budget`。`job_runs` 记录 session、状态、摘要、轮数与起止时间，查询最多返回最近 50 条。

### 目标

- 每个会话最多一个 `active` 目标；`goal.set` 在已有 active 目标时替换 objective。状态为 `active`、`paused`、`completed`、`blocked`、`cleared`，journal 保留最近 20 条。
- 每次组装 system 时注入 `Active goal (round x/y): objective`；`goal.run` 串行推进，收到 `DONE` 或 `BLOCKED: <原因>` 时结束。
- 维护任务会把 14 天未更新的 active 目标置为 `blocked`。

### 主动提议

| 配置项 | 默认 | 说明 |
|---|---|---|
| `threshold` | 0.6 | 低于阈值的信号不创建提议 |
| `maxPerDay` | 3 | 每个 Bot 滚动 24 小时上限 |
| `dedupeMs` | 24h | 相同标题去重窗口 |
| `ttlMs` | 24h | pending 提议的过期时间 |
| `scanEveryMs` | 未设置 | 大于 0 时定时扫描；默认需手动触发 |

打分为 `score = impact × urgency × confidence − 0.15`，提议按分数排序，状态为 `pending`，超过 TTL 自动变为 `expired`。

| 信号 | kind | 判定 |
|---|---|---|
| 例程失败 | `job-failure` | 24 小时内 `failed`/`budget` 的运行 |
| 任务停滞 | `stale-task` | `todo`/`claimed` 超过 3 天未更新 |
| 目标停滞 | `goal-stall` | `active` 目标 7 天未更新 |
| 日历临近 | `calendar-soon` | 事件在 45 分钟内开始 |
| 连接器失效 | `connector-failure` | 24 小时内的连接器失败记录 |
| 未读邮件 | `email-unread` | 未读超过 1 天 |

未读邮件由 IMAP 插件填充；`calendarEvents` 与 `connectorFailures` 需要相应插件写入，当前仓库内没有内置填充逻辑（见 `packages/initiative/src/index.ts`）。

### 通知与技能

通知中心落库并记录 `suppressed`，安静时段只抑制打扰，不丢消息。配置项为 `quietHours.start` / `quietHours.end`（支持跨夜，`start=end` 视为关闭）与 `quietHours.tz`（默认 UTC）。通知来源包括 `job/finished`、`initiative/proposal`、`email/received`；列表接口支持 `unread=1` 与 `limit`（最大 200）。

技能保存在 `$JARY_HOME/skills/<slug>/SKILL.md`，系统提示注入最多 12 个技能的标题、步骤数与相对路径。录制只捕获经 `computer.input` 的点击、输入、按键和 `browser.goto` 导航，不覆盖浏览器工具内部的 `browser.click`/`browser.type`，也不做密码或卡号脱敏。

## 常见任务

### 每日简报

上面的 `daily-briefing` 例程即可作为起点：cron 触发后任务在 `job:<jobId>` 会话中运行，结果触发 `job/finished` 通知；成本由 `maxRounds`、`maxSteps` 与 Agent 默认预算控制。

### 接入外部 webhook

```bash
BODY='{"event":"deploy","sha":"abc123"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.*= //')
curl -s -X POST "http://127.0.0.1:8787/hooks/<jobId>" \
  -H "x-jary-signature: sha256=$SIG" \
  --data "$BODY"
```

服务端按 HMAC-SHA256 校验 `x-jary-signature`（可带 `sha256=` 前缀）。未配置 `secret` 时任何请求都会触发；请求会等待本次运行结束才返回 `202`，外部系统需要放宽超时。webhook job 没有 `nextRunAt`，不会被调度器轮询触发。

### 用多轮目标推进长任务

`--session` 必须与目标会话一致，目标行才会出现在该会话的 system 提示里。多轮目标适合"一次说不完"的任务；它不会被定时触发，长周期任务应把 `goal.run` 或推进动作写进例程。

### 处理主动提议

扫描后查看 `pending` 列表，再接受、忽略或静音：

```bash
curl -s -X POST http://127.0.0.1:8787/api/initiative/scan
curl -s 'http://127.0.0.1:8787/api/initiative?botId=jaryn'
curl -s -X POST http://127.0.0.1:8787/api/initiative/<proposalId>/dismiss \
  -H 'content-type: application/json' -d '{"mute":true}'
```

接受即执行由 Agent 工具 `initiative.accept` 完成：创建任务并在 `initiative:<proposalId>` 会话中立即跑一轮；后台 provenance 下需要人工的风险工具会失败封闭。HTTP `accept` 与 Web UI 的接受按钮只创建任务，不执行。

### 教一个技能

手写步骤可直接保存；录制流程通过工具 `teach.record_start` 与 `teach.record_stop` 完成，随后用 `teach.draft` → `teach.save` 落盘。保存后技能目录注入 system，Agent 需要时用 `skill.load` 或 `fs.read` 读取全文。`GET /api/teach` 可列出已有技能。

### 配置安静时段与定时扫描

配置在 profile patch 中生效，启动 `jary serve` 时加载：

```json
[
  { "id": "notifications", "name": "@jaryn/notifications",
    "config": { "quietHours": { "start": "22:00", "end": "08:00", "tz": "Asia/Shanghai" } } },
  { "id": "initiative", "name": "@jaryn/initiative",
    "config": { "threshold": 0.6, "maxPerDay": 3, "scanEveryMs": 900000 } }
]
```

```bash
jary config print --patch ./patch.json   # 预览合并结果
jary serve --patch ./patch.json          # 启动时应用
```

## 限制与边界

- 没有 IM/邮件/短信推送：主动消息只进通知中心，或由在线客户端读取；不存在"先推 Telegram 再降级"。
- 例程失败不自动重试，也不会因连续失败自动暂停；失败写运行历史并发通知，Initiative 可据此提议。
- `job` 只有 cron、every、webhook、rss 四种触发器；邮件、日历、连接器事件不是例程触发器。
- Webhook 没有幂等键；重复请求会让同一 job 多次运行，并发时第二次以"已在运行"拒绝。`/hooks/` 不在 API token 鉴权范围内，务必配置 `secret`。
- RSS 用进程内记录最新链接，重启后可能再触发一次；正则解析，复杂 feed 可能取不到条目。
- 提议的静音按"Bot + 标题"哈希落库，没有解除静音的接口或命令。
- 日历与连接器信号需要外部填充；未填充时实际来源只有例程失败、任务停滞、目标停滞、未读邮件四类。
- 目标不会自动推进；需要手动 `goal.run`、工具 `goal.run`，或把推进动作写进例程。
- `jary stop-all` 在独立 CLI 进程内调用调度器 `stopAll`，不会停止已经运行的 `jary serve` 进程；需要停服请结束 serve 进程。
- 技能没有试跑、审阅、版本化流程；保存即生效，删除需手动处理目录。录制不做脱敏，录制期间不要输入密码或卡号。
- 主动提议不是授权：接受后执行时，高风险工具仍走审批；后台执行的提议无法完成需要人工确认的步骤。

## 相关文档

- [快速上手](../getting-started.md)
- [核心概念](../concepts.md)
- [连接器与邮件](connectors-email.md)
- [工具参考](../reference/tools.md)
- [CLI 参考](../reference/cli.md)
- [HTTP API 参考](../reference/http-api.md)
- [配置参考](../reference/configuration.md)
- [事件参考](../reference/events.md)
- [部署与运维](../operations/deployment.md)
- [安全与权限](../operations/security.md)
