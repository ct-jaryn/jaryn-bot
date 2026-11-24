# 05 · 部署与运维（Deployment & Ops）

> 状态：**现行**（v1.10.0）。配置字段见 [02-interfaces.md](02-interfaces.md) §2，实际部署文件见 `deploy/`，部署校验 `npm run check:deploy`。
> 目标：一台常开机器 + Docker，10 分钟跑起来；单机失败可恢复、可备份、可升级。

---

## 1. 部署拓扑

```
                 ┌──────── 反代（Caddy/Nginx，TLS）────────┐
                 │  /  /api/*  /healthz  /metrics          │
                 └──────────────────┬──────────────────────┘
                                    ▼
                         ┌──────────────────────┐
                         │ jary serve（单进程）    │
                         │ 插件组合 / Web / 调度 /  │
                         │ 审批 / 记忆 / 事件流     │
                         └───┬───────────┬───────┘
                             │           │
             /data（SQLite + workspace + artifacts + vault.key）
                             │
                    ┌────────▼─────────┐
                    │ 云电脑（可选）     │  每 Bot 一个 Chrome 或容器
                    │ CDP :9222        │  截图/输入/快照，空闲自动停
                    └──────────────────┘
```

- **单进程、单实例**：插件全部同进程加载（内核组合），没有独立 worker/gateway；同一份 SQLite 单写者，不要横向扩容。
- 反代负责 TLS 与公网；`jary serve` 默认只绑 `127.0.0.1:8787`。
- **云电脑**是本机 Chrome（开发）或 Docker 容器（生产），每 Bot 一台；`deploy/computer/Dockerfile` 提供带 Xvfb/x11vnc/noVNC 的镜像。
- **客户端**（Electron/Android/PWA）连同一服务端，走 HTTP + `/ws/client`；不需要公网端口映射到客户端。
- 出网隧道（`jary tunnel`）用客户端主动出站，服务端不反向拨号。

### 1.1 私有化与数据边界

**定位**：v0.1 是**单租户、自托管（self-hosted）**部署，不是 SaaS。一个实例服务一个人（或一个白名单小团队），数据与密钥都在你自己的机器上。

| 数据 | 存储位置 | 是否出网 |
|---|---|---|
| 会话 / 事件 / 记忆 / 审批 / 审计 / 用量 | 本地 SQLite（`/data/jary.db`） | 否 |
| 代码 / 文件 / 产物 | 本地 `/data/bots/*/workspace`、`/data/artifacts` | 否（除非你主动外发） |
| 模型请求内容（prompt/上下文） | 发往模型端点 | **是**（默认 DeepSeek 云；可替换，见下） |
| 通知 | 本地 SQLite（Web 通知中心；IM 通道 Won't） | 否 |
| Web 搜索/抓取 | 发往搜索服务与目标站点 | **是**（可换自建 SearXNG：`search.baseUrl`） |
| MCP 工具调用 | 发往对应 MCP 服务 | 视配置 |
| 客户端缓存 | 设备本地（最近消息/未读） | 否（可清空） |

**私有化三档**

| 档位 | 形态 | 缺口 |
|---|---|---|
| **L1 默认自托管** | 数据/密钥本地；模型、IM、搜索出网 | 无（v0.1 就是这个） |
| **L2 内网模型** | 模型端点换成 vLLM / Ollama / 私有云 OpenAI 兼容端点 | 需支持 `baseUrl` 的 provider 插件（`llm-deepseek` 可配 `baseUrl`） |
| **L3 全内网离线** | 模型、IM、搜索、插件全部内网 | 内网 IM 适配器、离线插件包、本地搜索——v0.1 不承诺，以后评估 |

**为私有化做的设计选择**：SQLite 单文件（无外部 DB）、事件溯源本地、密钥只从 env/文件读、模型适配器可插拔、插件支持 `file:`/内网 git 安装、反代 TLS + allowlist、备份/恢复有演练脚本。

**不包含的企业私有化能力**（Won't）：多租户隔离、SSO/SCIM、HA/集群、审计导出与保留策略、离线安装包签名、合规认证。

---

## 2. docker compose（实际文件）

```bash
cp .env.example .env        # 至少填 JARY_API_TOKEN（公网必需）；DEEPSEEK_API_KEY 可选
docker compose -f deploy/docker-compose.yml up -d --build
# → http://127.0.0.1:8787
```

`deploy/docker-compose.yml` 的实质内容：

```yaml
services:
  jary:
    build: { context: .., dockerfile: deploy/Dockerfile }
    restart: unless-stopped
    env_file: ../.env
    ports: ["127.0.0.1:8787:8787"]
    volumes: ["../data:/data"]
    security_opt: ["no-new-privileges:true"]
```

镜像（`deploy/Dockerfile`）：

- `node:24-bookworm-slim`，**无 npm install / 无编译步骤**（Node 直接跑 TS，运行时不依赖第三方包）
- 构建时把 `packages/*` 全部链到 `node_modules/@jaryn/*`（动态生成，新增包不会漏）
- `/data` 卷：`jary.db`、`bots/*/workspace`、`artifacts`、`computers`、`vault.key`、`skills`
- 内置 `HEALTHCHECK`（`jary doctor`）

`.env`（权限 600）：

```
JARY_HOME=/data
DEEPSEEK_API_KEY=sk-...        # 可选；缺省用 echo provider
JARY_API_TOKEN=<随机串>        # 公网暴露时强烈建议
# 邮件/OAuth 等按需：
# JARY_EMAIL_SECRET=...
# JARY_OAUTH_CLIENT_ID_GMAIL=...
```

**首次启动**：`docker compose -f deploy/docker-compose.yml up -d` → `docker compose exec jary node packages/cli/src/index.ts doctor` → 浏览器打开反代地址。

## 3. 数据目录与备份

```
/data/
├─ profile.json       # 插件组合（bundle/patch 行）
├─ jary.db            # SQLite（WAL）
├─ bots/<id>/workspace/
├─ artifacts/
├─ computers/        # 云电脑 profile/workspace 与快照
├─ skills/            # 教学技能 SKILL.md
├─ exports/           # 会话导出
└─ vault.key          # Vault 主密钥（0600）
```

**备份（每日）**

```bash
sqlite3 /data/jary.db ".backup '/backup/jary-$(date +%F).db'"
rsync -a --delete /data/bots /data/artifacts /backup/
```

- 保留 14 天；备份文件与密钥分开存放。
- **恢复演练**（每月）：新目录恢复 → `jary doctor` → 抽查 3 个会话 `replay`。

**云电脑数据**：卷与快照单独保留 7 天；Vault 加密随 DB 备份，恢复需恢复码（见 [08](08-vault-and-credentials.md)）。

**恢复**

```bash
docker compose down
cp /backup/jary-YYYY-MM-DD.db /data/jary.db
rsync -a /backup/bots/ /data/bots/
docker compose up -d
```

---

## 4. 升级

1. `docker compose pull`（新 tag）；
2. 停服务 → 按 §3 备份；
3. `docker compose up -d` → 启动时自动 DB 迁移（先写 `.bak`）；
4. `jary doctor`；失败 → 回滚镜像 tag + 恢复 DB 备份；
5. 检查 `journal`：迁移版本 ≤ 当前程序。

**兼容原则**：DB 只前进；程序看到更高 schema 版本会拒绝启动。插件升级需满足 `engines.jary`。

---

## 5. 监控

| 指标 | 采集 | 告警阈值 |
|---|---|---|
| 进程存活 | `/healthz` | 连续 3 次失败 |
| 队列深度 | `/metrics jary_queue_depth` | > 20 持续 5 分钟 |
| turn 失败率 | `jary_turn_failed_total / total` | > 20%（1 小时） |
| 模型错误率 | `jary_model_errors_total` | > 10%（15 分钟） |
| 审批积压 | `jary_approvals_pending` | > 5 持续 10 分钟 |
| 日花费 | `jary_cost_usd_today` | > 预算 80% |
| worker RSS | `jary_worker_rss_bytes` | > 1.5GB |
| DB 大小 | `jary_db_bytes` | > 5GB |

**日志**：JSON 行到 stdout（`docker logs`），字段 `ts/level/session/turn/tool/err`；不记录密钥与完整 prompt（`--debug` 也不落密钥）。

---

## 6. Runbook（常见故障）

| 症状 | 排查 | 处理 |
|---|---|---|
| Bot 不回消息 | `doctor` → 通道 token、worker 数、最近错误 | 重启容器；检查 allowlist/限速 |
| worker 卡死 | `health` 无响应 / RSS 暴涨 | `jary stop-all`；重启；检查工具超时配置 |
| 模型 429/超时 | 日志 `E_MODEL` | 等退避；检查 API 余额/额度 |
| DB locked | 是否有第二个进程写 `/data` | 保证单实例；`lsof` 查占用 |
| 预算被刷爆 | `usage` 表按 job 聚合 | 立即 `stop-all`；降预算；查异常循环 |
| 疑似注入成功 | 查 `audit` 中 external 动作 | 停 Bot；轮换密钥；检查产物与消息 |
| 磁盘满 | `df -h` | 清理 artifacts（保留期）；扩容 |
| 恢复失败 | `.bak` 与备份配对 | 用最近可用备份；`replay` 校验 |

**熔断开关**：`jary stop-all` 立即中止所有 worker、暂停 job；恢复用 `jary job enable` / 重新发消息。

---

## 7. 资源估算

| 规模 | CPU | 内存 | 磁盘 | 说明 |
|---|---|---|---|---|
| **1 Bot，每日 <50 轮（4C4G 基准）** | **4 核** | **4GB** | **20GB** | 默认部署目标；1 worker + 1 云电脑（限额） |
| 1 Bot，每日 <50 轮（最小） | 2 核 | 2GB | 10GB | 最小可用 |
| 3 Bot，每日 <200 轮 | 4 核 | 4–6GB | 20GB | 常见个人配置 |
| 5–10 Bot，含定时任务 | 4–8 核 | 8–12GB | 50GB | 每 worker 约 300–600MB |
| 含云电脑（1–3 个常用） | 4–8 核 | 8–16GB | 40–80GB | 含镜像与快照；空闲休眠降耗 |
| 模型成本 | — | — | — | 主要成本；按 token 计，配合预算 |

> 内存与成本是主要约束，不是 CPU。每 Bot 一个 worker 进程是 v0.1 的简化，可接受。

---

## 8. 安全加固清单

- [ ] gateway 只绑 loopback，公网只经反代 + TLS；
- [ ] 反代保留 `Host`、限制请求体大小、限速；
- [ ] `.env`/`jary.toml` 权限 600，密钥不入镜像；
- [ ] 容器 `no-new-privileges`、非 root 用户、只读根文件系统（workspace 单独挂载）；
- [ ] IM allowlist 必填；未知用户默认拒绝；
- [ ] webhook 校验 HMAC/签名；
- [ ] 备份与密钥分离存储；
- [ ] 每月看一次 `audit`：external 动作、审批拒绝、插件变更。

---

## 9. 多实例与扩展（v0.1 之外）

- **不要**把同一 `/data` 挂给两个 gateway（SQLite 单写者）；
- 需要多实例：先换 Postgres（`store` seam）+ 分布式锁，再拆 worker 为独立服务；暂不做；
- 需要多租户：每租户一个 home + 容器，网关按租户路由；暂不做。
