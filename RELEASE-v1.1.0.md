# jaryn-bot v1.1.0 — 补齐审计缺口

v1.0 审计发现的缺口已全部补齐（可实现的），逐条状态见 [docs/14-completion-audit.md](docs/14-completion-audit.md)。

## 本次补齐

- **文件**：`fs.write` / `fs.edit`（唯一性校验、路径围栏）
- **网络**：`web.search`（SearXNG 或 DuckDuckGo）+ `web.fetch`（DNS 解析 + 私网/元数据拦截）
- **交互**：`ask_user` 工具 + Web 问题卡（10 分钟超时）
- **调度**：模型可调用 `schedule.create/list/cancel`
- **多 Bot**：`bot.spawn_worker`（子会话在自己的 workspace 跑）、`bot.inbox`、`bot.edit`、会话按 bot 路由
- **费用**：token/费用记账（`usage` 表）、`maxCostUsd` 预算、`jary usage`、`/api/usage`
- **审批**：规则引擎（deny > ask > allow；tool/risk/path 匹配）、once/session 授权、`approvals`/`audit` 表、`/api/rules`
- **技能**：`$JARY_HOME/skills` 目录注入 system prompt（不再是"存了不用"）
- **邮件**：HTML→文本、MIME base64 附件→artifact、发件人 allowlist
- **连接器**：`/api/oauth/callback/:id` 授权码换 token 并存 Vault，后续调用自动带 Bearer
- **云电脑**：空闲自动停机、容器网络策略、镜像含 Xvfb/x11vnc/noVNC、`computer.exec` 容器内执行
- **Office**：纯 TS 生成 docx / xlsx / pptx（ZIP + OOXML，无 LibreOffice 依赖；包结构经 unzip/XML 校验）
- **目标**：`goals` 表 + `goal.set/status/run/pause`，多轮驱动（DONE/BLOCKED 判定），注入 prompt
- **UI**：停止按钮、问题卡、侧边面板（记忆/任务/页面/产物/例程/提议/用量/审计）、会话管理、bot 选择
- **插件**：`jaryn.permissions` 声明 + `jary plugin permissions`

## 验证

```bash
npm test        # 109 tests
npm run check   # docs + deploy + eval dry-run
jary doctor     # 39 plugins load
```

## 仍需外部条件（未做）

- 真实 DeepSeek 评测：需要 `DEEPSEEK_API_KEY`
- Docker 镜像实测：本机无 docker
- 桌面壳/原生 App、1Password/卡支付/TOTP、官方 Gmail/Calendar 应用、实时低延迟串流、进程外插件宿主
