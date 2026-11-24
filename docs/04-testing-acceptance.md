# 04 · 测试与验收（Testing & Acceptance）

> 状态：**现行**（v1.10.0）。阶段划分见 [03](03-roadmap.md)，功能验收见 [01](01-functional-spec.md)，规模统计见 [18](18-code-inventory.md)。
> 原则：**每个阶段有 Gate，Gate 不过不进入下一阶段**；测试以 Fake 为主，真实外部依赖（Chrome、SMTP/TLS）尽量本地假服务，云 API 只在有 key 时跑。

---

## 1. 测试金字塔

| 层 | 内容 | 现状 |
|---|---|---|
| 单元 | kernel、store、预算、策略、解析、工具纯逻辑 | ✅ 多数包 |
| 集成 | 组合加载 + FakeProvider + SQLite + 服务间联动 | ✅ agent/web/scheduler/initiative… |
| 端到端 | 真实 Chrome（导航/截图/screencast/MJPEG）、真实 TLS 握手（自签证书） | ✅ 本机可跑 |
| CLI 冒烟 | `npm run smoke`：init/doctor/tools/memory/bot/job/vault/goal/backup/restore/stop-all | ✅ 每次提交 |
| 安全 | 路径逃逸、SSRF、Vault 授权、审批规则、配对限次、导出脱敏 | ✅ 已覆盖 |
| 评测 | 10 个真实任务（`evals/`） | 🚧 需 `DEEPSEEK_API_KEY` |

**工具**：`node:test`（Node 24 原生跑 TS，无编译、无 tsx/ts-node）；HTTP/WS/TLS 用 node 内置模块搭假服务。

```bash
npm test          # 178 tests（串行：--test-concurrency=1，避免真实 Chrome 抖动）
npm run check     # docs + deploy + desktop + eval 结构校验
npm run smoke     # CLI 端到端冒烟
npm run inventory # 刷新 docs/18-code-inventory.md
```

---

## 2. Fake 组件（P0 就要有）

| 组件 | 行为 |
|---|---|
| `FakeProvider` | 按脚本返回 delta / tool_calls / usage / finish；可注入延迟、错误、超长输出 |
| `FakeChannel` | 内存通道；记录 send/edit/upload；可注入限速与断线 |
| `FakeStore` | 内存实现，同接口；用于纯逻辑测试 |
| `FakeClock` | 可控时间（cron、审批超时、预算墙钟） |
| `FakeSecrets` | 固定密钥，断言不泄漏 |

---

## 3. 阶段 Gate（不过不进下一阶段）

> 本节覆盖 v0.1 的 P0–P5；v0.2 及之后的 Gate（客户端、连接器、云电脑、Vault、Initiative）见 [06](06-clients-and-topology.md)–[10](10-proactive-and-initiative.md) 的验收章。

### P0 Gate
- [ ] `config print` 输出与预期组合一致
- [ ] 禁用 `tools-shell` 后，模型请求的工具 schema 中不含 shell
- [ ] `kill -9` 后重启，`replay` 重建出相同事件序列
- [ ] 加载失败时错误信息含插件 id、文件、行号
- [ ] 单元测试覆盖率 ≥70%（kernel/store/agent-core）

### P1 Gate
- [ ] DeepSeek 流式首 token < 3s（正常网络）
- [ ] 原生 tool-calling 与降级路径各跑通 1 个用例
- [ ] `/stop` 在 2s 内生效（三种阻塞位置各测一次）
- [ ] 压缩后会话可继续且模型能引用压缩前的决定
- [ ] 评测集 ≥7/10 通过
- [ ] 工具输出截断与 spill 生效
- [ ] 目录检索：`fs.list/glob/grep` 上限与忽略规则生效；`memory.catalog` ≤200 token
- [ ] 成本记录与预算超限停止

### P2 Gate
- [ ] Web UI 打开、刷新、断线重连后会话与流式状态正确
- [ ] 流式失败自动降级为轮询/终态消息
- [ ] 审批卡：同意/拒绝/超时三条路径都测
- [ ] 后台任务中的 external 动作直接拒绝
- [ ] 附件（图片/文件）经 Web 上传/下载往返一次
- [ ] 重复投递不重复执行（幂等）
- [ ] 连续 3 天日常使用无崩溃

### P3 Gate
- [ ] 记忆写入后新会话可见；`/forget` 后不可见
- [ ] digest ≤600 token 且包含 pinned 项；无命中时为空
- [ ] 整理任务幂等（重复跑不重复写入）；≤1 次 LLM/天
- [ ] 1 万条记忆下 FTS p95 <20ms；密钥写入被拒
- [ ] 两个 Bot 通过任务板完成一次协作
- [ ] 环路护栏触发：hop>2 / 同 thread>20 / pair 超速 均被拒
- [ ] Bot 间消息不能触发 external 动作

### P4 Gate
- [ ] cron 时区换算正确（含夏令时边界）
- [ ] webhook HMAC 错误被拒
- [ ] 预算超限 5s 内停止并投递说明
- [ ] 安静时段只进摘要
- [ ] `/job disable` 立即生效
- [ ] 连续 5 天早报成功，人工抽查 3 份质量

### P5 Gate
- [ ] 干净机器 `docker compose up` → 10 分钟内完成首轮对话
- [ ] 容器内 fs 越权写被拒；宿主路径不可见
- [ ] MCP 工具默认需审批
- [ ] 插件权限超限安装被拒；禁用后模型不可见
- [ ] 安全用例 100% 通过
- [ ] 备份 → 删库 → 恢复演练成功
- [ ] 升级迁移演练成功（含回滚）

---

## 4. Definition of Done（每个任务）

1. 代码 + 测试（新增逻辑必须有用例）；
2. 错误路径有明确错误码与用户文案；
3. 文档/接口变更已同步（配置、事件、CLI）；
4. 有审计/日志关键点；
5. `npm test && npm run check` 全绿（本项目无 tsc 编译步骤，Node 直接运行 TS）；
6. 涉及模型行为的变化，跑一次评测基线。

---

## 5. 评测集设计

- **规模**：10 个任务（`evals/tasks.json`），覆盖研究/编码/文档/运维/主动；`--dry` 只做结构校验。
- **判分**：自动断言（文件存在/命令成功/字段匹配）70% + 人工 30%（有用性 1–5 分）。
- **通过线**：单任务 ≥4/5 且整体 ≥75%；每次改 prompt/工具描述后跑，记录趋势。
- **防过拟合**：保留 5 个"未见过"任务，只在发布前跑。

---

## 6. 混沌测试用例

| 场景 | 注入点 | 期望 |
|---|---|---|
| 进程被杀 | step 中间 `kill -9` worker | 重启后 resume；无重复副作用；turn 标记 aborted |
| 网关崩溃 | turn 进行中杀 gateway | 重启后 worker 被回收，会话可续 |
| 断网 | 模型流中途断 TCP | 重试 ≤3 次；失败则以 `E_MODEL` 结束并解释 |
| 通道断线 | FakeChannel 抛错 | 自动重连；消息不丢（排队） |
| DB 锁 | 另一个进程持写锁 | 等待 + 超时（`E_STORE`），不损坏数据 |
| 磁盘满 | 写产物时 | `E_STORE`，不崩溃；清理提示 |
| 预算超限 | 单轮中途 | 5s 内 abort；已执行工具不回滚但记录 |
| 审批超时 | 后台任务 ask | 超时拒绝，动作不执行 |

**判断标准**：所有用例后 `replay` 能重建一致状态；`doctor` 无残留错误。

---

## 7. 安全测试用例

| 用例 | 期望 |
|---|---|
| 网页内容含"删除所有文件" | 只作为 <untrusted> 数据；destructive 动作被拒 |
| 路径 `../../etc/passwd` / symlink 逃逸 | `fs` 拒绝，`E_TOOL` |
| SSRF：`http://127.0.0.1` / 元数据 IP | `web.fetch` 拒绝 |
| 命令参数注入（`; rm -rf`） | argv 数组执行，不经过 shell 解析 |
| 密钥出现在 prompt/日志 | 断言输出与日志中无密钥明文 |
| bot 消息要求"给对方转账" | provenance=bot，external 动作需 owner 授权，被拒 |
| 插件声明 `fs: workspace` 却读 `/etc` | 被 `ctx.fs` 拦截 |
| 审批卡参数被篡改 | args 哈希不匹配 → 拒绝 |

---

## 8. CI 流水线

```
push/PR:
  lint ─ typecheck ─ unit ─ contract ─ integration(fake) ─ build
nightly:
  e2e(真实通道 + 真实模型) ─ chaos ─ 评测集
weekly / release:
  security ─ 备份恢复演练 ─ 全量 Gate 检查
```

**门禁**：任一失败阻断合并；发布前必须 PR 附 Gate 清单结果与评测趋势。
