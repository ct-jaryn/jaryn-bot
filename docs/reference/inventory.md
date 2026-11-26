# 代码清单（自动生成）

> 适用版本：v1.11.0 · 状态：自动生成（`npm run inventory`）

包/插件/工具/路由/表/CLI/测试文件的全量统计，用于核对文档数字。`npm run check:inventory` 会校验它与运行时一致。

## 1. 规模

| 项 | 数量 |
|---|---|
| 包（packages/*） | 31 |
| 已加载插件 | 41 |
| 模型可见工具 | 74 |
| HTTP 路由（含静态与 webhook） | 66 |
| SQLite 表 | 28 |
| CLI 命令 | 22 |
| 测试文件 | 65 |

## 2. 工具（按风险）

| 风险 | 数量 | 含义 |
|---|---|---|
| read | 26 | 只读（自动允许） |
| write | 29 | 写工作区（自动允许） |
| execute | 10 | 执行（默认需审批） |
| network | 3 | 出网只读（自动允许） |
| external | 5 | 外部副作用（默认需审批） |
| destructive | 1 | 破坏性（默认需审批，逐次） |

## 3. 工具清单

| 工具 | 风险 |
|---|---|
| `artifact.list` | read |
| `artifact.present` | write |
| `artifact.save` | write |
| `ask_user` | external |
| `bot.inbox` | read |
| `bot.list_agents` | read |
| `bot.send_message` | external |
| `browser.click` | execute |
| `browser.extract` | read |
| `browser.goto` | network |
| `browser.screenshot` | read |
| `browser.type` | execute |
| `computer.exec` | execute |
| `computer.restart` | execute |
| `computer.restore` | execute |
| `computer.snapshot` | write |
| `computer.start` | execute |
| `computer.status` | read |
| `computer.stop` | execute |
| `computer.usage` | read |
| `fs.edit` | write |
| `fs.glob` | read |
| `fs.grep` | read |
| `fs.list` | read |
| `fs.read` | read |
| `fs.write` | write |
| `goal.pause` | write |
| `goal.run` | execute |
| `goal.set` | write |
| `goal.status` | read |
| `initiative.accept` | execute |
| `initiative.dismiss` | write |
| `initiative.list` | read |
| `initiative.scan` | read |
| `memory.catalog` | read |
| `memory.forget` | write |
| `memory.list` | read |
| `memory.read` | read |
| `memory.remember` | write |
| `memory.search` | read |
| `office.docx` | write |
| `office.pptx` | write |
| `office.xlsx` | write |
| `pages.create` | write |
| `pages.export` | read |
| `pages.list` | read |
| `pages.rollback` | write |
| `pages.share` | external |
| `pages.update` | write |
| `pages.versions` | read |
| `schedule.cancel` | write |
| `schedule.create` | write |
| `schedule.list` | read |
| `shell.run` | execute |
| `skill.load` | read |
| `spawn_worker` | external |
| `task.claim` | write |
| `task.complete` | write |
| `task.create` | write |
| `task.list` | read |
| `teach.draft` | write |
| `teach.list` | read |
| `teach.record_start` | write |
| `teach.record_stop` | write |
| `teach.save` | write |
| `vault.fill` | external |
| `vault.fill_card` | destructive |
| `vault.grant` | write |
| `vault.list` | read |
| `vault.remove` | write |
| `vault.rotate` | write |
| `vault.secure_form` | write |
| `web.fetch` | network |
| `web.search` | network |

## 4. HTTP 路由

| 方法 | 路径 |
|---|---|
| DELETE | `/api/memory/*` |
| DELETE | `/api/vault/*` |
| GET | `/api/approvals` |
| GET | `/api/artifacts` |
| GET | `/api/audit` |
| GET | `/api/bots` |
| GET | `/api/computer` |
| GET | `/api/computer/mjpeg` |
| GET | `/api/computer/screen` |
| GET | `/api/computer/screenshot` |
| GET | `/api/devices` |
| GET | `/api/events` |
| GET | `/api/files` |
| GET | `/api/initiative` |
| GET | `/api/jobs` |
| GET | `/api/memory` |
| GET | `/api/notifications` |
| GET | `/api/oauth/authorize/*` |
| GET | `/api/oauth/callback/*` |
| GET | `/api/pages` |
| GET | `/api/questions` |
| GET | `/api/rules` |
| GET | `/api/sessions` |
| GET | `/api/stream` |
| GET | `/api/tasks` |
| GET | `/api/teach` |
| GET | `/api/tunnel` |
| GET | `/api/usage` |
| GET | `/api/vault` |
| GET | `/app.js` |
| GET | `/healthz` |
| GET | `/icon.svg` |
| GET | `/manifest.json` |
| GET | `/metrics` |
| GET | `/p/*` |
| GET | `/pages/*` |
| GET | `/secure/*` |
| GET | `/style.css` |
| GET | `/sw.js` |
| POST | `/api/approvals/*` |
| POST | `/api/artifacts` |
| POST | `/api/bots` |
| POST | `/api/computer/input` |
| POST | `/api/computer/takeover` |
| POST | `/api/devices/pair` |
| POST | `/api/devices/pair-code` |
| POST | `/api/devices/revoke-all` |
| POST | `/api/email/inbound` |
| POST | `/api/files` |
| POST | `/api/initiative/scan` |
| POST | `/api/jobs` |
| POST | `/api/memory` |
| POST | `/api/message` |
| POST | `/api/notifications/read-all` |
| POST | `/api/oauth/refresh/*` |
| POST | `/api/pages` |
| POST | `/api/questions/*` |
| POST | `/api/rules` |
| POST | `/api/sessions` |
| POST | `/api/sessions/*` |
| POST | `/api/stream-ticket` |
| POST | `/api/teach` |
| POST | `/api/vault` |
| POST | `/api/vault/secure-form` |
| POST | `/hooks/*` |
| POST | `/secure/*` |

## 5. SQLite 表

`approvals`, `artifacts`, `audit`, `bot_messages`, `bots`, `device_pair_codes`, `devices`, `events`, `goals`, `initiative_mutes`, `initiative_proposals`, `job_runs`, `jobs`, `memories`, `memory_candidates`, `memory_runs`, `memory_tags`, `notifications`, `page_versions`, `pages`, `schema_meta`, `secure_forms`, `sessions`, `tasks`, `usage`, `vault_events`, `vault_grants`, `vault_items`

## 6. CLI 命令

`audit`, `backup`, `bot`, `chat`, `computer`, `config`, `device`, `doctor`, `goal`, `init`, `job`, `memory`, `plugin`, `restore`, `serve`, `session`, `stop-all`, `tools`, `tunnel`, `usage`, `vault`, `version`

## 7. 测试文件

- `desktop/test/config.test.cjs`
- `packages/agent-core/test/background-approval.test.ts`
- `packages/agent-core/test/grants.test.ts`
- `packages/agent-core/test/loop.test.ts`
- `packages/agent-core/test/parallel.test.ts`
- `packages/agent-core/test/spill.test.ts`
- `packages/agent-core/test/usage-rules.test.ts`
- `packages/artifacts/test/artifacts.test.ts`
- `packages/bots/test/bots.test.ts`
- `packages/bots/test/spawn.test.ts`
- `packages/cli/test/acceptance.test.ts`
- `packages/cli/test/export.test.ts`
- `packages/computer/test/computer.test.ts`
- `packages/computer/test/idle.test.ts`
- `packages/computer/test/limits.test.ts`
- `packages/computer/test/local-chrome.test.ts`
- `packages/computer/test/recording.test.ts`
- `packages/computer/test/screencast.test.ts`
- `packages/connectors/test/connectors.test.ts`
- `packages/connectors/test/oauth.test.ts`
- `packages/connectors/test/refresh.test.ts`
- `packages/devices/test/devices.test.ts`
- `packages/devices/test/pair-limit.test.ts`
- `packages/email/test/email.test.ts`
- `packages/email/test/imap.test.ts`
- `packages/email/test/mime.test.ts`
- `packages/email/test/smtp.test.ts`
- `packages/goals/test/goals.test.ts`
- `packages/initiative/test/initiative.test.ts`
- `packages/initiative/test/signals.test.ts`
- `packages/kernel/test/kernel.test.ts`
- `packages/llm-deepseek/test/provider.test.ts`
- `packages/maintenance/test/maintenance.test.ts`
- `packages/mcp/test/mcp.test.ts`
- `packages/memory/test/maintain.test.ts`
- `packages/memory/test/memory.test.ts`
- `packages/notifications/test/notifications.test.ts`
- `packages/office/test/office.test.ts`
- `packages/pages/test/pages.test.ts`
- `packages/pages/test/versions.test.ts`
- `packages/plugin-host/test/host.test.ts`
- `packages/sandbox-docker/test/sandbox.test.ts`
- `packages/scheduler/test/rss.test.ts`
- `packages/scheduler/test/scheduler.test.ts`
- `packages/secrets/test/onepassword.test.ts`
- `packages/store-sqlite/test/store.test.ts`
- `packages/tasks/test/tasks.test.ts`
- `packages/tools-fs/test/fs.test.ts`
- `packages/tools-fs/test/write.test.ts`
- `packages/tools-shell/test/shell.test.ts`
- `packages/tools-web/test/web.test.ts`
- `packages/tunnel/test/tunnel.test.ts`
- `packages/vault/test/card.test.ts`
- `packages/vault/test/grants.test.ts`
- `packages/vault/test/vault.test.ts`
- `packages/web/test/auth.test.ts`
- `packages/web/test/authz.test.ts`
- `packages/web/test/command.test.ts`
- `packages/web/test/commands.test.ts`
- `packages/web/test/mjpeg.test.ts`
- `packages/web/test/notifications.test.ts`
- `packages/web/test/web.test.ts`
- `packages/web/test/ws-client.test.ts`
- `scripts/check-deploy.test.ts`
- `scripts/check-docs.test.ts`
