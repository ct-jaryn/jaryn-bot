# 10 · 主动任务 · Initiative · Teach-a-task

> 状态：**现行（待定包）**。目标：Bot 不只是"你问它答"，而是**自己发现该干的活、按计划干、干完汇报**——对标并超越 Grok Bot 的 Routine + initiative。
> 关联：[01 FR-19](01-functional-spec.md) · [09 连接器](09-connectors-and-artifacts.md) · [06 客户端](06-clients-and-topology.md)

---

## 1. 三层模型

| 层 | 是什么 | 谁触发 | 类比 |
|---|---|---|---|
| **Routine** | 明确的任务 + 时间/事件触发器（"每天 8 点简报"） | cron / webhook / 邮件 / RSS / 连接器事件 | 闹钟 + 脚本 |
| **Initiative** | Bot 从信号里**发现**可做的事，先提议，你点头才做 | 信号引擎（未读邮件、临近截止、连接器失效…） | 靠谱的同事 |
| **Teach-a-task** | 你演示一次，它把流程存成技能，以后复用 | 用户教 | 带新人 |

---

## 2. Routine

```yaml
# $JARY_HOME/routines/daily-briefing.yml
id: daily-briefing
bot: jaryn
trigger: { kind: cron, expr: "0 8 * * *", tz: Asia/Shanghai }
mission: |
  读 MEMORY.md 的偏好，汇总：① 今天日历 ② 未读重要邮件 ③ 关注的 GitHub 仓库动态。
  输出 ≤400 字，带来源；无重要内容则只发一行"今天无重要事项"。
budget: { max_steps: 10, max_cost_usd: 0.08, max_wall_ms: 600000 }
delivery: { to: last-active-client, fallback: telegram }
condition: "not quiet_hours"       # 可选
dedupe: { key: daily-briefing-{{date}}, window: 1d }
```

**触发器**

| kind | 参数 | 说明 |
|---|---|---|
| `cron` | `expr` / `tz` | 5 字段；时区必填 |
| `every` | `seconds` | ≥60s |
| `webhook` | `path` / `hmac` | 外部系统触发 |
| `email` | `match: {from, subject}` | 新邮件（连接器/邮箱通道） |
| `rss` | `url` / `every` | 新条目 |
| `calendar` | `before_minutes` | 事件临近 |
| `connector` | `connector: github, event: ci_failed` | 连接器事件（能力允许时） |

**规则**：同一 routine 串行（上次未完则跳过并记 `skipped`）；失败不自动重试（记录 + 通知）；所有运行有 `runs` 历史与花费。

---

## 3. Initiative（超越点）

**核心原则**：**先提议，不自动做**。initiative 只能产出"建议卡"，接不接受由你决定；接单后按 Routine/任务执行，风险动作照常审批。

### 3.1 信号源

| 信号 | 来源 | 例子 |
|---|---|---|
| 日历临近 | Calendar 连接器 | "15:00 有客户会，要不要我准备一页背景？" |
| 未读重要邮件 | Gmail/IMAP | "对方问了报价，需要我起草回复吗？" |
| 连接器失效 | connector.health | "GitHub 授权过期了，点此重连" |
| 任务失败 | job runs | "昨晚的简报失败了（超预算），要调高吗？" |
| 任务板停滞 | task board | "这个调研任务 3 天没动，要继续吗？" |
| 长期目标 | `/goal` | "周报目标还差 2 天，今天要推进吗？" |

### 3.2 打分与降噪

```
score = 影响(0–1) × 紧急(0–1) × 置信(0–1) − 打扰成本
```
- 只推 `score ≥ 阈值`（默认 0.6，可配）。
- 每 Bot 每天最多 3 条提议；重复信号 24h 内合并。
- 安静时段不推（进早报摘要）。
- 每条提议带"为什么"（信号 + 证据），可一键"以后别推这类"（写规则）。

### 3.3 接受后

- 你点"做" → 生成任务（绑定来源证据）→ Bot 执行 → 完成后回到同一条消息线程汇报。
- 你不理 → 24h 后过期，记 `dismissed`。
- **initiative 提议不是授权**：执行时的风险动作仍需审批（provenance=owner 的"做"是授权意图，不是 blanket allow）。

---

## 4. Teach-a-task

**目标**：把"只有你会做的流程"变成可复用技能（`SKILL.md`）。

**两种录制**
1. **手动步骤**：你写 5–10 步的自然语言步骤 → 生成技能草稿。
2. **演示录制**：在云电脑里你接管操作，系统记录：
   - 浏览器导航、点击、输入（**输入到密码/卡字段的内容不记录**，只记"填写了密码"）；
   - 文件操作与命令（脱敏后）；
   - 生成动作序列 → 归纳成技能草稿。

**流程**

```
录制/手写 ─► 草稿 SKILL.md ─► 在沙箱试跑一次 ─► 你审阅 ─► 保存到 skills/ ─► 可被 routine 调用
```

- 草稿包含：适用场景、前提、步骤、失败处理、需要的连接器/凭据（只记引用名）。
- 试跑失败 → 高亮失败步骤，允许改步骤后重试。
- 保存需你确认；技能可版本化、可删除。
- **不记录**：密码、卡号、TOTP、私信内容（除非你显式允许）。

---

## 5. 通知与投递

| 场景 | 投递 |
|---|---|
| 有客户端在线 | 客户端应用内（卡片 + 链接） |
| 无客户端 | **暂不做外部推送**（IM 暂缓）；结果留在 Web/下次打开可见 |
| 安静时段 | 只进摘要，次日早晨汇总 |
| 高优先级（失败/安全） | 立即推，不受安静时段限制（可关） |

- 所有主动消息带"为什么发给你"（来源）与"静音/别再推"。
- 每日主动消息上限默认 10 条（可配）。
- 投递失败 → 降级到 IM → 再失败记 `undelivered`。

---

## 6. 预算与熔断

- Routine 独立预算（token/费用/墙钟/轮数），超限停止并汇报"被预算截断"。
- 每日/每周总预算（软上限告警 + 硬上限停止）。
- `jary stop-all` 立即暂停所有 routine 与 initiative；恢复需显式。
- 连续失败 3 次的 routine 自动暂停并通知。

---

## 7. 接口

```yaml
# CLI
jary routine add|list|run|enable|disable|runs <id>
jary initiative list|dismiss|mute <id>
jary teach start|stop|save
```

```ts
// 内部
interface Scheduler { nextRun(routine): Date; dispatch(routine): Promise<RunId> }
interface Initiative {
  ingest(signal): Promise<ProposalId>
  list(): Promise<Proposal[]>
  accept(proposalId): Promise<TaskId>
  dismiss(proposalId, reason): Promise<void>
}
```

---

## 8. 验收（Initiative Gate）

- [ ] 每日 8 点简报连续 5 天成功；无重要内容时只发一行
- [ ] 日历临近提议出现，接受后完成并回到原线程
- [ ] 连接器过期提议出现，一键重连后恢复
- [ ] 提议去重：同一信号 24h 内只出现一次；每天 ≤3 条
- [ ] 安静时段不推送；次日摘要包含
- [ ] teach-a-task：演示一次 → 生成草稿 → 试跑 → 保存 → 被 routine 调用成功
- [ ] 录制不包含密码/卡号（断言日志与草稿）
- [ ] 预算超限 5s 内停止；连续失败 3 次自动暂停
- [ ] 所有提议带"为什么"，可一键"别再推"

---

## 9. 明确不做

- 自动执行外部动作而不提议（initiative 永远先问）
- 团队共享 routine / 团队知识库（团队协作不做）
- 跨用户学习（"别人的 Bot 怎么用"）——隐私与合规
- 会议纪要 / 语音提醒（会议与语音不做）
- 无限自主循环（一切有预算和轮数上限）
