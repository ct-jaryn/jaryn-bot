# 05 · 部署与运维（Deployment & Ops）

> 状态：**现行**（v0.1）。配置字段见 [02-interfaces.md](02-interfaces.md) §2，阶段见 [03-roadmap.md](03-roadmap.md)。
> 目标：一台常开机器 + Docker，10 分钟跑起来；单机失败可恢复、可备份、可升级。

---

## 1. 部署拓扑

```
            ┌──────────── 反代（Caddy/Nginx，TLS）────────────┐
  IM ──────►│  /webhook/*  /healthz  /metrics                 │
            └──────────────────┬──────────────────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │ jary gateway (容器)   │
                    │ 通道/调度/审批/记忆服务 │
                    └──────┬───────┬───────┘
                           │ stdio │（同容器内 spawn）
                    ┌──────▼───┐ ┌─▼────────┐
                    │ worker A │ │ worker B │  每 Bot 一个
                    └──────┬───┘ └────┬─────┘
                           └────┬─────┘
                     /data（SQLite + workspace + artifacts）
```

- **v0.1 只支持单实例**：SQLite 单写者 + 本地 worker；不要横向扩 gateway。
- 反代负责 TLS 与公网；gateway 只绑 `127.0.0.1:8787`。
- worker 与 gateway 同容器（v0.1），P5 可选容器外置（每 Bot 一容器）。
- **v0.2 起**：客户端/执行端主动出站 WSS 接入（无需端口映射），服务端不反向拨号；见 [06-clients-and-topology.md](06-clients-and-topology.md)。

### 1.1 私有化与数据边界

**定位**：v0.1 是**单租户、自托管（self-hosted）**部署，不是 SaaS。一个实例服务一个人（或一个白名单小团队），数据与密钥都在你自己的机器上。

| 数据 | 存储位置 | 是否出网 |
|---|---|---|
| 会话 / 事件 / 记忆 / 审批 / 审计 / 用量 | 本地 SQLite（`/data/jary.db`） | 否 |
| 代码 / 文件 / 产物 | 本地 `/data/bots/*/workspace`、`/data/artifacts` | 否（除非你主动外发） |
| 模型请求内容（prompt/上下文） | 发往模型端点 | **是**（默认 DeepSeek 云；可替换，见下） |
| IM 消息 | —（暂不做通知通道） | 否 |
| Web 搜索/抓取 | 发往搜索服务与目标站点 | **是**（可换自建 SearXNG，v0.2） |
| MCP 工具调用 | 发往对应 MCP 服务 | 视配置 |
| 客户端缓存 | 设备本地（最近消息/未读） | 否（可清空） |

**私有化三档**

| 档位 | 形态 | 缺口 |
|---|---|---|
| **L1 默认自托管** | 数据/密钥本地；模型、IM、搜索出网 | 无（v0.1 就是这个） |
| **L2 内网模型** | 模型端点换成 vLLM / Ollama / 私有云 OpenAI 兼容端点 | 需补 `base_url` 配置与离线模型；v0.1 的 `llm` 适配器已预留 |
| **L3 全内网离线** | 模型、IM、搜索、插件全部内网 | 内网 IM 适配器、离线插件包、本地搜索——v0.1 不承诺，v1.0 再评估 |

**为私有化做的设计选择**：SQLite 单文件（无外部 DB）、事件溯源本地、密钥只从 env/文件读、模型适配器可插拔、插件支持 `file:`/内网 git 安装、反代 TLS + allowlist、备份/恢复有演练脚本。

**不包含的企业私有化能力**（v1.0 前）：多租户隔离、SSO/SCIM、HA/集群、审计导出与保留策略、离线安装包签名、合规认证。

---

## 2. docker compose

```yaml
services:
  jary:
    image: ghcr.io/<you>/jary:0.1.0
    restart: unless-stopped
    env_file: .env
    ports: ["127.0.0.1:8787:8787"]
    volumes:
      - ./data:/data
      - ./jary.toml:/data/jary.toml:ro
    healthcheck:
      test: ["CMD", "jary", "doctor"]
      interval: 60s
      timeout: 20s
      retries: 3
    security_opt: ["no-new-privileges:true"]
    # 需要 shell 工具时保留；如需更强隔离，P5 起用 worker 侧容器
```

`.env`（权限 600）：

```
DEEPSEEK_API_KEY=sk-...
# TELEGRAM_TOKEN=...   # 暂不需要（IM 通知通道暂不做）
JARY_HOME=/data
JARY_LOG_LEVEL=info
```

**首次启动**：`docker compose up -d` → `docker compose exec jary jary doctor` → 浏览器打开反代地址进 Web UI，给 Bot 发第一条消息。

---

## 3. 数据目录与备份

```
/data/
├─ jary.toml
├─ jary.db            # SQLite（WAL）
├─ bots/<id>/workspace/
├─ artifacts/
├─ computers/        # 云电脑卷与快照（v0.4）
├─ profiles/          # 插件组合
└─ presets/
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
- 需要多实例：先换 Postgres（`store` seam）+ 分布式锁，再拆 worker 为独立服务；v1.0 前不做；
- 需要多租户：每租户一个 home + 容器，网关按租户路由；v1.0 前不做。
