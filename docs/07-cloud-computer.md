# 07 · 云电脑（Computer Use）

> 状态：**现行（v0.2 容器/本地后端、浏览器工具、截图、快照；v0.6 实时看屏、接管、输入、本机出网已实现；桌面 GUI 未实现）**。对标 Grok Bot 的"每个 Bot 有自己的电脑"，但隔离粒度更细（每 Bot 一台，而不是每用户一台）；仅做容器 + 浏览器/终端，桌面 GUI 暂不做。
> 关联：[01 FR-15](01-functional-spec.md) · [06 客户端](06-clients-and-topology.md) · [08 Vault](08-vault-and-credentials.md) · [05 部署](05-deployment-ops.md)

---

## 1. 目标

让 Bot 能像人一样用一台 Linux 电脑：**开浏览器、点桌面、敲终端、看屏幕**，并且你能在客户端**实时看到、必要时接管**。

**为什么必须有**：Grok Bot 出圈的场景（订会议、报销、填表、登录后台）没有一个是只靠 API 能完成的。没有云电脑，产品只能停在"查资料/写文档/跑代码"。

**与 Grok Bot 的差异（超越点）**
| | Grok Bot | jaryn-bot |
|---|---|---|
| 隔离单元 | 每**用户**一台 VM（所有 Bot 共享，一个坏全坏） | **每 Bot 一台**（可再按任务快照） |
| 快照 | 整机镜像 | **任务级快照**（workspace + home + 浏览器 profile），可回滚到某一轮之前 |
| 部署 | 仅云 | 自托管：容器优先，可选 microVM；可跑在自己机器上 |
| 成本 | 常驻 VM | 空闲休眠 + 按任务计费 + 预算护栏 |

---

## 2. 形态与选型

| 形态 | 实现 | 隔离 | 启动 | 适用 |
|---|---|---|---|---|
| **容器（默认）** | Docker/Podman + Chromium + Xvfb + VNC | 命名空间级 | 秒级 | 个人自托管、单机 |
| **microVM（可选）** | Firecracker / Cloud Hypervisor | 内核级 | 百毫秒–秒 | 多租户或不可信任务 |
| **远程（可选）** | 外部云沙箱（E2B/Daytona 风格） | 厂商级 | 秒级 | 不想在本机跑 Chromium |

当前阶段只做容器；microVM 作为 `computer` seam 的另一个 provider（见 [plugin-architecture.md](plugin-architecture.md)）。

**镜像**（`jary-computer:latest`）：Debian slim + Chromium + Xvfb + x11vnc/websockify + LibreOffice + Python/Node + 常用 CLI（git/curl/jq）；**不含**任何用户密钥。每 Bot 可用 setup 脚本追加依赖（有网时）。

---

## 3. 生命周期

```
created ──first use──► running ──idle 15min──► hibernated
   ▲                      │                        │
   │                      └──max runtime 4h────────┤
   └──── resume ◄─────────┴──────── restore ◄──────┘
```

| 操作 | 语义 |
|---|---|
| `start` | 首次创建：新容器 + 卷 + 浏览器 profile 目录 |
| `hibernate` | 停容器，保留卷与 profile；内存态丢弃 |
| `resume` | 重启容器，挂回卷；浏览器恢复 tab（可选） |
| `snapshot` | 卷快照（workspace + home + profile），带标签与时间 |
| `restore` | 回滚到某快照；当前卷归档不删 |
| `reset` | 空卷重启（需审批） |
| `recreate` | 镜像更新：新容器挂旧卷，保留文件 |

**自动策略**：空闲 15 分钟休眠；单次运行 >4 小时强制快照并停止；每日最多运行 8 小时（可配）。

---

## 4. 能力

### 4.1 浏览器

- 容器内跑 Chromium（headless=false，Xvfb 显示）+ **Playwright**（通过 CDP）作为 `browser.*` 工具的实现。
- **登录态持久**：profile 目录在卷里，跨会话保留；退出/清除需显式操作。
- 工具：`browser.open/goto/click/type/scroll/screenshot/extract/select/download`；截图作为图片块回传模型。
- 反爬与 IP：默认数据中心 IP 会被部分站点拦；提供"经你本机出网"的可选模式（见 §7），不承诺绕过反爬。

### 4.2 桌面

- Xvfb + 轻量窗口管理器 + `x11vnc`/`websockify`，客户端用 noVNC 或 WebRTC 观看。
- 工具：`desktop.screenshot/click/drag/type/key/hotkey/scroll`（基于 xdotool/AT-SPI）。
- 适用：只有桌面客户端的应用（某些企业后台、老式软件）；**优先级低于浏览器**，因为可靠性和成本都更差。

### 4.3 终端

- 容器内持久 shell（`shell.run` 在云电脑里执行），工作目录 `/workspace` 与宿主机 Bot workspace 双向同步（见 §5）。

### 4.4 文件桥

- 容器 `/workspace` ⇄ 服务端 `bots/<id>/workspace`：统一通过 `fs` seam 读写；大文件用 artifact 通道。
- 下载文件：浏览器下载目录 → 自动登记 artifact → 可发回 IM/客户端。
- 上传：客户端/IM 附件 → 服务端 → 容器 `/workspace/inbox/`。

### 4.5 屏幕串流与接管

- 帧流：JPEG/WebP（默认 2–5 fps，按需 10 fps）+ 差量；通过客户端 WS 的 `screen.frame` 推送。
- 输入：客户端 `input.send {type: mouse|key|text}` → 服务端 → 容器（VNC/xinput）。
- **接管（takeover）**：Bot 暂停操作 → 客户端全屏控制 → "交还"后 Bot 继续；接管需 owner 确认；期间 Bot 只能观察。
- 隐私：屏幕可能含密码/验证码——截帧不落库、不回传模型；只给在线客户端。

---

## 5. 数据与快照

| 数据 | 位置 | 保留 |
|---|---|---|
| workspace | 服务端卷（bind mount） | 永久（受保留策略） |
| home / 浏览器 profile | 容器卷 | 随容器生命周期；reset 清空 |
| 快照 | 本地卷快照（LVM/ZFS/btrfs 或 tar+硬链接） | 最近 10 个 + 每日 1 个 |
| 下载产物 | artifact 存储 | 30 天（可配） |

**任务级快照**：每次高风险操作（卡填表、删除、发布）前自动快照；失败可"回滚到操作前"——这是 Grok Bot 没有的能力。

---

## 6. 安全

| 威胁 | 措施 |
|---|---|
| 容器逃逸 | 非 root、只读根文件系统、seccomp/AppArmor、无 host 挂载、独立网络命名空间 |
| 跨 Bot 读取 | 每 Bot 独立卷与网络；文件桥只映射本 Bot workspace |
| 凭据泄漏 | 密码/卡只经 [08 Vault](08-vault-and-credentials.md) 的填充代理进入页面，模型与截图都不含明文 |
| 误操作 | 高风险动作前快照 + 审批；`reset` 需二次确认 |
| 网络滥用 | egress 白名单（默认允许 https，可配域名）；禁止访问内网/元数据 IP |
| 无人值守失控 | 最大运行时长、每日配额、预算超限停止、`stop-all` 熔断 |
| 数据留存 | 休眠/销毁时清理临时目录；快照加密存储 |

---

## 7. 网络

- 默认：容器 NAT 出网，允许 443/80；DNS 走服务端；**禁止** 169.254.169.254、127.0.0.0/8、私网网段（可配例外）。
- **支持本机出网**（默认关闭）：用户在桌面客户端运行 `jary tunnel`，流量经其家宽/公司网出去（解决"数据中心 IP 被拦"）；代价是客户端必须在线。随云电脑阶段交付。
- 可选 **固定出口**：自建代理，给需要 IP 白名单的站点用。
- 不提供：专属公网 IP、住宅代理池（合规与成本原因）。

---

## 8. 接口

```ts
// computer seam
interface Computer {
  status(botId): Promise<ComputerStatus>
  start(botId, opts): Promise<void>
  stop(botId, mode: 'hibernate'|'destroy'): Promise<void>
  snapshot(botId, label): Promise<SnapshotId>
  restore(botId, snapshotId): Promise<void>
};

// 客户端 WS 扩展（见 06 §3.2）
'screen.subscribe {botId}'      // → screen.frame 通知
'input.send {botId, event}'     // 鼠标/键盘/文本
'takeover.request {botId}'      // → 审批 → takeover.granted
'takeover.release {botId}'
```

**工具**：`browser.*`、`desktop.*`、`computer.screenshot`、`computer.snapshot`。

---

## 9. 成本与控制

- 容器运行成本 ≈ CPU/内存 + 电费；**空闲即休眠**是核心省钱手段。
- 每 Bot 限额：CPU 2 核、内存 2–4GB、磁盘 10GB（可配）。
- 每任务预算：最大运行时长、最大下载量、最大 token。
- 观测：运行时长、启动次数、休眠率、快照大小、失败率。

---

## 10. 验收（云电脑 Gate）

- [ ] 在无头容器里打开一个真实网站、登录（Vault 填充）、完成一次表单提交并截图
- [ ] 客户端能实时看屏（≥2 fps），并成功接管 30 秒后交还
- [ ] 快照 → 破坏文件 → 恢复 → 内容一致
- [ ] 跨 Bot 无法读对方 workspace / 网络不可达
- [ ] 容器逃逸测试（挂载/权限/内核参数）全部阻断
- [ ] 空闲 15 分钟自动休眠，唤醒 <10s
- [ ] 单 Bot 连续运行 4 小时被强制快照并停止
- [ ] 成本：日均运行 <2 小时的配置月成本可接受（记录实测）

---

## 11. 4C4G 低资源与 Bot 自建容器

目标机器只有 **4 核 4GB**，云电脑必须按“最小可用”设计，而不是云端 VM 的默认配置。

### 11.1 资源预算（总量 4C/4G）

| 组件 | CPU | 内存 | 说明 |
|---|---|---|---|
| OS + 网关 + SQLite | 0.5 核 | 0.5GB | 常驻 |
| Worker（每 Bot） | 0.3–0.5 核 | 0.4–0.6GB | 最多 2 个同时活跃 |
| 云电脑容器（运行中） | 1 核 | 1.2–1.5GB | Chromium + Xvfb |
| headroom | 1 核 | 0.5–0.8GB | 峰值/编译 |

**硬约束**：同一时刻最多 **1 台云电脑运行**、**1 个 turn 执行**；其余排队。空闲 5 分钟即休眠（比默认 15 分钟更激进）。Chromium 关闭 GPU、单 tab、限制缓存；串流默认 2fps、按需 5fps。

### 11.2 Bot 自建容器（测试沙箱）

Bot 需要跑测试/构建时，可申请**一次性兄弟容器**（sibling container），而不是在云电脑里再套 Docker：

```yaml
# sandbox 工具（风险 execute，默认 ask）
' sandbox.run { image, cmd, timeoutSec, memMB, cpu, network }
' sandbox.stop { id }
```

**配额**：每 Bot 同时最多 1 个；默认 0.5 CPU / 512MB / 5 分钟 / 无网络（可显式开）；镜像白名单（如 `node:24`, `python:3.12`, `debian:slim`）；workspace 只读挂载或复制，不挂宿主 `/data`；`no-new-privileges`、非 root、无特权。

**隔离**：通过 Docker/Podman socket 代理执行，模型永远拿不到原始 socket；工具层做参数校验与配额；容器退出即删，日志截断保留。

**验收补充**：
- [ ] 4C4G 机器上同时跑 1 云电脑 + 1 worker，内存峰值 <3.6GB
- [ ] 空闲 5 分钟自动休眠，唤醒 <10s
- [ ] Bot 自建容器默认无网络、512MB、5 分钟超时；超配额被拒
- [ ] 容器无法挂载宿主目录/读取其他 Bot 数据

---

## 12. 明确不做

- Windows/macOS 云电脑（当前只做 Linux）
- 专属公网 IP / 住宅代理池
- 游戏/视频处理（算力与合规不匹配）
- 桌面级 CAD/专业软件（除非你明确需要并愿意加镜像）
- 多人在同一台云电脑上协作（团队协作明确不做）
