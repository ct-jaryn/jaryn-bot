# 核心概念

> 适用版本：v1.11.0 · 状态：现行
> 读这一份建立心智模型；具体操作看 [使用指南](README.md#使用指南)，实现细节看 [架构](design/architecture.md)。

jaryn-bot 不是"带工具的聊天窗口"，而是一个**常驻的智能体运行时**。理解下面九个概念，其余都是组合。

## 1. 组合（Composition）：万物皆插件

运行时没有"主程序"，只有**一组插件**。启动时读取 `profile.json`：按顺序展开 bundle 的 patch 文件，每个 patch 行 = 一个插件 + 配置。插件通过 `provide` / `inject` 声明依赖，loader 按依赖拓扑排序加载，缺依赖就**启动失败**（fail-loud），不会静默降级。

- 因此：换模型、关工具、加通道，都是**改配置行**，不是改代码。
- 见 [插件指南](guides/plugins.md) · [配置](reference/configuration.md)。

## 2. 会话（Session）与事件（Event）

会话是对话与工作上下文。所有状态变化写成 **append-only 事件**（`events` 表）：用户输入、模型输出、工具调用与结果、审批请求与决定、turn 结束…

- 重启不丢：状态由事件重建；`jary session replay` 可逐步回放。
- 可审计：`jary audit` 记录管理动作，事件流保留完整过程。
- 见 [事件参考](reference/events.md)。

## 3. Turn 与工具（Tools）

一次用户输入触发一个 **turn**，agent 循环里模型可以多次调用工具，直到给出最终答复或触发预算。预算包括：最大步数、最大工具调用数、墙钟时间、**费用上限**。

工具是模型唯一能"动手"的方式：读写文件、跑命令、查网页、发邮件、生成 Office 文档、操作浏览器…每个工具声明 JSON Schema 与**风险等级**（见下节）。当前 74 个，清单见 [工具参考](reference/tools.md)。

## 4. 审批与风险（Approval）

| 风险 | 例子 | 默认行为 |
|---|---|---|
| `read` | `fs.read`、`web.fetch` | 自动允许 |
| `write` | `fs.write`、`office.docx` | 自动允许（围栏在工作区内） |
| `network` | `web.search` | 自动允许（SSRF 防护开启） |
| `execute` | `shell.run`、`browser.click` | **每次审批** |
| `external` | `email.send`、连接器写操作 | **每次审批** |
| `destructive` | 卡填表 | **每次审批**（无法"永远允许"） |

规则引擎按 `deny > ask > allow` 评估，支持工具名/风险/路径前缀匹配；授权作用域有 once / session / always。**后台任务（例程、目标、子 Bot）不允许等人**：遇到需要审批的工具立即拒绝并记审计，除非有 allow 规则预批。

## 5. Bot、工作区与预算

一个实例可以有多个 Bot：各自的人格（persona）、工具子集、工作区目录、记忆命名空间、预算。Bot 之间可以派活：`spawn_worker` 创建一个跑在该 Bot 工作区的子会话；任务板（`task.*`）用 CAS 认领，消息总线路由带防环（hop ≤ 2）。

单 owner 设计：多 Bot 是你自己的分身，不是多租户。

## 6. 记忆（Memory）

两层：**事实/规则**（长期，可 pinned，参与每轮摘要）与 **episode**（过程记录，有 TTL）。每轮注入 ≤600 token 的 digest；容量有上限，旧且少用的记忆会被衰减归档，每 6 小时自动维护。模型可主动 `memory.remember` / `memory.forget`。

见 [记忆指南](guides/memory.md)。

## 7. 主动（Jobs / Goals / Initiative）

- **例程**：cron、固定间隔、webhook(HMAC)、RSS 触发，按预算运行，结果进通知中心。
- **目标**：多轮推进一个长期目标，模型用 `DONE` / `BLOCKED:` 结束。
- **Initiative**：从信号（任务失败/停滞、目标停滞、日历临近、连接器失效、未读邮件）生成提议，打分、去重、日限额；接受后**立即执行**。
- **教学**：录制操作或手写步骤，生成技能草稿，保存后进入技能目录。

见 [主动任务指南](guides/proactive.md)。

## 8. 云电脑（Cloud Computer）

每个 Bot 可以有一台"电脑"：本机 Chrome（开发）或 Docker 容器（生产，含 Xvfb/VNC/noVNC）。agent 通过 CDP 操作浏览器；人在 Web 里看屏（MJPEG/screencast）并可**接管**（接管时 agent 暂停）。支持快照/恢复、容器内终端、空闲自动停机、单次 4h/每日 8h 配额、域名 egress 白名单。

见 [云电脑指南](guides/cloud-computer.md)。

## 9. Vault 与产物

- **Vault**：凭据 write-only 存储（AES-256-GCM）。模型只能请求"填入某页面"，值不进入 prompt/日志/截图；支持授权（授权后锁定）、审计、轮换、1Password/Bitwarden、TOTP。卡信息填表默认关闭，不接支付网关。
- **产物**：artifact 库（文件/图片/Office 文档）+ Pages（HTML 页面，带版本、回滚、限时分享）。工具输出超过 32KB 时自动落盘成 artifact，上下文只留指针。

见 [Vault](guides/vault.md) · [Pages 与产物](guides/pages-artifacts.md)。

## 一次请求的生命周期

```
用户输入
  → 创建 turn，写 input.owner 事件
  → 组装 system prompt（人设 + 目标 + 记忆摘要 + 技能目录）
  → 模型流式输出；若请求工具：
       → 风险检查 → 审批（前台等人 / 后台拒绝除非 allow）
       → 执行工具 → 写 tool.call / tool.result → 结果回给模型
  → 模型给出最终答复 → 写 assistant.message / turn.ended
  → 记录 usage（token/费用），会话与记忆更新
```

下一步：跑一遍 [快速开始](getting-started.md)，然后按任务读对应的[使用指南](README.md#使用指南)。
