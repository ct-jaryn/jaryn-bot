# 06 · 服务端 + 多客户端拓扑（Clients & Topology）

> 状态：**现行（v0.2 设计，暂缓）**。v0.1 只用 Web UI；本文件定义未来如何扩展成"一处私有化服务端 + 多处客户端"（桌面/手机/执行端），当前不排期。
> 关联：[05 部署运维](05-deployment-ops.md) · [02 接口规格](02-interfaces.md) · [03 路线图](03-roadmap.md) · [00 PRD](00-prd.md)

---

## 1. 目标形态

```
                     ┌──────────────── 私有化服务端（一处部署）────────────────┐
                     │  gateway：会话 / 记忆 / 审批 / 调度 / 插件 / 鉴权         │
                     │  worker × N：每 Bot 一个                                │
                     │  接入层：IM 通道 + Client API + Node API                 │
                     └───────┬──────────────────────────┬────────────────────┘
                             │ WSS（客户端主动出站）        │ WSS（执行端主动出站）
                    ┌────────▼────────┐        ┌────────▼─────────┐
                    │ 控制端 Client    │        │ 执行端 Node       │
                    │ Web / 桌面 / 手机 │        │ 本地文件/命令/浏览器│
                    └─────────────────┘        └──────────────────┘
```

**关键选择**：
- **服务端是唯一真相**：会话、事件、记忆、产物、审批全在服务端；客户端无状态（只做缓存）。
- **客户端主动出站连服务端**（WSS 443），服务端从不反向拨号 → 家庭/公司 NAT 后也能用，不需要端口映射。
- **Web 是 v0.1 的唯一界面**（服务端自带，见 [02 §10](02-interfaces.md)）。桌面/手机客户端、IM 通知**暂缓**（未排期）。
- **默认不需要执行端**：控制端只"看和说"，所有工具在服务端跑。执行端是可选扩展，见 §4。

---

## 2. 两类客户端（必须分开设计）

| | **控制端 Client** | **执行端 Node**（可选） |
|---|---|---|
| 装在哪 | 手机/电脑/浏览器，任何地方 | 有本地文件、内网、浏览器的机器 |
| 作用 | 聊天、看流式、点审批、收产物、管会话 | 提供受控的本地工具执行（fs/shell/browser） |
| 信任级别 | 中（能读该用户可见的会话） | **高（能在这台机器上执行命令）** |
| 是否需要 | v0.2 起推荐 | v1.0 起按需，默认关闭 |
| 主要风险 | 令牌泄漏、设备丢失 | 远程代码执行、越权读文件 |
| 工期估算 | **Web 2–3 周（v0.1）**；桌面/手机壳 +2–4 周（v0.2） | 4–6 周 + 安全硬化 2 周 |

> **建议先做控制端**：它解决"不同地方都能用"的 90% 需求，且不引入远程执行风险。

---

## 3. 控制端设计

### 3.1 身份与配对

1. 服务端管理员（owner）在 CLI 生成一次性配对码：`jary device pair --role client`，10 分钟有效、限 3 次尝试。
2. 客户端输入配对码 + 设备名 → `POST /api/pair` → `{ deviceId, deviceToken }`。
3. 令牌存 OS Keychain/Keystore；可随时 `jary device list/revoke`。
4. 角色：`owner`（全部 Bot/会话）、`node`（执行端）。**单 owner 产品，不做 member/多人**。

### 3.2 协议（WS JSON-RPC + REST）

**WS `/ws/client`，文本帧每行一个 JSON。**

| 方向 | 方法 | 说明 |
|---|---|---|
| C→S | `hello {protocolVersion, deviceToken, lastSeq?}` | 握手；带 lastSeq 时回放缺失事件 |
| C→S | `subscribe {sessionIds?}` | 订阅事件（缺省=该用户全部可见会话） |
| C→S | `send {sessionId?, blocks, clientMsgId}` | 发消息（幂等，10 分钟去重） |
| C→S | `cancel {sessionId}` | 中止当前 turn |
| C→S | `approval.respond {approvalId, decision, scope}` | 审批（与 IM 按钮等价，先到先得） |
| C→S | `resume {sessionId, fromSeq}` | 从指定序号回放 |
| S→C | `event {event}` | 持久事件（带 seq） |
| S→C | `stream {sessionId, turnId, delta}` | 瞬态流式增量（不重放） |
| S→C | `status {sessionId, status}` | running/idle/error |
| S→C | `approval.requested {approval}` | 审批卡 |
| S→C | `artifact {artifact}` | 产物生成/更新 |
| S→C | `presence {deviceId, online}` | 多端在线状态（可选） |

**REST**（文件与列表，避免 WS 大帧）：`GET /api/sessions`、`GET /api/sessions/:id/events?fromSeq=`、`POST /api/files`、`GET /api/files/:id`、`GET /api/artifacts/:id`、`GET /healthz`。

### 3.3 同步语义（多端关键）

- 服务端是唯一写者；每个持久事件有单调递增 `seq`（会话内）。
- 重连：`hello{lastSeq}` → 服务端回放 `seq > lastSeq` 的事件；过旧则回"快照 + 从快照 seq 开始"。
- 流式增量是瞬态：断线后客户端请求当前 turn 的快照文本，而不是重放 delta。
- 多端同时在线：任意设备可发消息（按会话排队），所有订阅设备收到同一事件流；审批先响应者生效（幂等）。
- 离线：客户端本地缓存最近 N 条 + 未读；重新上线补拉。

### 3.4 推送与通知

- 有客户端在线 → 应用内通知；
- 无客户端在线 → **暂不做外部推送**（IM/APNs/FCM 暂缓）；结果留在 Web UI，下次打开可见。
- 通知内容不含密钥与完整 prompt（只给摘要 + 链接）。

### 3.5 客户端形态优先级

| 形态 | 优点 | 估算 | 建议 |
|---|---|---|---|
| **Web UI** | 零安装、任何地方浏览器可用、与 05 的反代部署天然配合 | 2–3 周 | **v0.1 随服务端交付** |
| **PWA 增强** | 离线缓存/安装到桌面/推送 | +1 周 | v0.2 |
| 桌面壳（Tauri/Electron 包 PWA） | 系统托盘、开机自启、本地文件拖拽 | +2–4 周 | 第二批 |
| 手机原生（iOS/Android） | 推送、语音入口 | +4–6 周 | v1.0 视需要 |

---

## 4. 执行端 Node（可选，高风险）

### 4.1 作用

把"在这台机器上干活"变成一种可注册的能力：读本地文件、跑命令、开浏览器、访问内网服务。适用于：公司电脑上的资料、家里 NAS、只有内网可达的系统。

### 4.2 协议

WS `/ws/node`：
- `register {hostname, os, capabilities: {fsRoots[], shell: bool, browser: bool}, fingerprint}`
- `heartbeat {load, versions}`（30s）
- S→N `exec {jobId, tool, args, policy: {roots, timeoutMs, maxBytes}, approvalId?}`
- N→S `exec.result {jobId, ok, output|error, artifacts[]}`
- N→S `exec.progress {jobId, text}`（可选）

### 4.3 安全模型（比控制端严一档）

1. **注册需要 owner 在服务端确认**（显示设备指纹/IP/能力），默认拒绝。
2. **每个 exec 默认需要审批**；可对"只读 + 指定根目录"建立窄规则；写/执行永远 ask。
3. **Node 侧强制作用域**：roots 白名单、symlink 解析后校验、命令以低权限用户运行、超时/输出上限、进程组 kill。
4. **服务端策略优先**：Node 只执行已批准的 job，不自行解释自然语言。
5. **审计双向**：服务端记 job/审批；Node 记本地执行日志。
6. **可撤销**：`jary device revoke <node>` 立即断开并拒绝后续 job。
7. **默认关闭**：安装包里不含 Node；需单独 `jary node install` 并显式开启。

### 4.4 与 worker 的关系

- 服务端 worker（每 Bot 一个）照旧跑 Agent 循环与大部分工具；
- 仅当工具被路由到某 Node 时（`fs`/`shell` 指向 node:<id>），才发 `exec`；
- Node 不是 worker 的替代，是 `fs/shell` seam 的另一个 provider（对应 [plugin-architecture.md](plugin-architecture.md) 的 seam 设计）。

---

## 5. 部署与网络

| 项 | 做法 |
|---|---|
| 服务端暴露 | 反代 TLS（443）+ WS upgrade；只暴露必要路径 |
| 客户端网络 | 只需出站 443；无需端口映射/公网 IP |
| 更隐私 | 叠一层 WireGuard/Tailscale，客户端只在虚拟内网可达 |
| 多客户端 | 同一账号可多设备；设备列表可踢 |
| 服务端常开 | 客户端离线不影响任务；服务端离线则全部不可用（单点，v0.2 不做 HA） |
| 数据 | 全部在服务端 `/data`；客户端只缓存最近消息 |

---

## 6. 对现有设计的影响（改动面）

| 模块 | 变化 | 工作量 |
|---|---|---|
| 接入层 | 新增 `access` 抽象：IM channel / Client WS / Node WS 三类 peer | 1–2 周 |
| 鉴权 | 设备配对、令牌、角色、撤销；与 owner 鉴权并存 | 1 周 |
| 事件流 | 暴露带 seq 的订阅/回放接口（内部已有事件溯源，主要是投影与分页） | 1 周 |
| 文件通道 | 上传/下载（附件、产物），大小限制与类型白名单 | 3–5 天 |
| 前端 | **Web UI（v0.1）**：会话/聊天/审批/产物/设置；桌面壳 v0.2 | 2–3 周（v0.1） |
| Node | 注册/心跳/exec 执行器 + 安全硬化 | 4–8 周 |
| 文档/测试 | 契约测试、重连/回放/多端并发用例 | 1 周 |

**排期建议**：v0.1 交付 Web UI；v0.2 = 桌面/手机壳 + 多端同步 ≈ +4–6 周；执行端放 v1.0（+4–8 周），除非你明确需要"操作本地内网/浏览器"。

---

## 7. 与 IM 的关系（不要二选一）

- IM 继续保留：它是"零安装、随时能找到人"的通道，适合通知、审批、轻命令（`/stop`、`/status`）。
- Client 提供富交互：流式渲染、多端同步、产物预览、会话管理。
- 两者写同一套会话：统一入口 `input` 带 provenance=owner；审批在任一界面响应都生效（先到先得）。
- 默认路由：用户最后活跃的界面优先；无客户端在线时回落 IM。

---

## 8. 安全清单（上线前逐条过）

- [ ] 配对码一次性、限时、限次、限 IP 段（可选）
- [ ] 设备令牌存 Keychain/Keystore，支持轮换与撤销
- [ ] 所有 WS/REST 走 TLS；可选证书 pinning
- [ ] 每设备权限最小化（仅 owner 设备；node 单独授权）
- [ ] Node 注册需 owner 确认；exec 默认审批；roots 白名单
- [ ] 审计：登录、设备增删、审批、Node exec、文件下载
- [ ] 客户端缓存可清空；退出登录清 token
- [ ] 服务端不主动拨号；Node 不做端口监听

---

## 9. 明确不做

- P2P/去中心化同步；端到端加密（v1.0 再评估）
- 客户端本地跑模型/本地 Agent
- 公网无鉴权暴露
- 多租户 SaaS（一个部署 = 一个 owner/团队）

---

## 10. 一句话

**服务端私有化一处部署 + 客户端随处安装**，对现有设计不是推翻，而是**把"IM 通道"泛化成"多端接入层"**：
**v0.1 只做 Web UI**（服务端自带，浏览器即客户端）；桌面/手机壳与执行端**暂缓**，到需要时再做。未来客户端都通过"主动出站 WSS"接入，不需要公网端口。
