# 部署

> 适用版本：v1.11.0 · 状态：现行
> 单进程、单实例：一台常开机器 + 反代 TLS；Docker Compose 或裸机 Node 24 均可，数据全部落在 `$JARY_HOME`。

## 1. 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| Node | 24+ | 直接执行 TypeScript，无编译步骤 |
| 系统 | Linux；macOS 可用于开发 | 云电脑容器后端需要 Docker；Compose 为推荐方案 |
| 资源 | 4C4G / 20GB 起 | 规划值见 §8 |
| 网络 | 域名与证书；8787 只对本机开放 | 公网仅经 443 反代 |
| 模型 | DeepSeek key 或兼容端点 | 缺省 echo provider，可离线验证链路 |

不要横向扩容：插件、Agent 循环、调度、审批、Web 都在同一进程内，SQLite 是单写者；同一 `$JARY_HOME` 只能有一个进程。数据流与组件关系见 [架构](../design/architecture.md)，术语见 [核心概念](../concepts.md)，首次安装见 [快速开始](../getting-started.md)。

## 2. Docker Compose（推荐）

```bash
cp .env.example .env      # 至少确认 JARY_API_TOKEN；DEEPSEEK_API_KEY 可选
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec jary \
  node packages/cli/src/index.ts doctor --home /data
```

启动后访问 `http://127.0.0.1:8787`。`deploy/docker-compose.yml` 的实际行为：

| 配置 | 值 | 含义 |
|---|---|---|
| `build.context` / `dockerfile` | 仓库根 / `deploy/Dockerfile` | 从当前源码构建 |
| `ports` | `127.0.0.1:8787:8787` | 只绑 loopback，公网必须经反代 |
| `volumes` | `../data:/data` | 宿主 `data/` 即容器 `$JARY_HOME` |
| `env_file` | `../.env` | 仓库根 `.env`，权限建议 600 |
| `restart` | `unless-stopped` | 崩溃或重启后自动拉起 |
| `security_opt` | `no-new-privileges:true` | 容器内禁止提权 |

镜像（`deploy/Dockerfile`）：

- `node:24-bookworm-slim`，无 `npm install`、无编译步骤；构建时把 `packages/*` 动态链接成 `node_modules/@jaryn/*`。
- 默认命令 `serve --port 8787 --home /data`；`HEALTHCHECK` 每 60 秒执行 `doctor --home /data`（超时 20 秒，3 次失败标记 unhealthy）。
- 镜像默认以 root 运行（文件未设置 `USER`）；需要非 root 时自行添加用户并保证 `/data` 可写。
- SQLite 路径由 base bundle 的 `store.path`（默认 `data/jary.db`）相对 home 解析，容器内实际是 `/data/data/jary.db`，见 `packages/cli/src/index.ts` 的 `resolveHomePaths`。

`.env` 常用项（完整字段见 [配置参考](../reference/configuration.md)）：

| 变量 | 必需 | 作用 |
|---|---|---|
| `JARY_API_TOKEN` | 公网必需 | `/api/*`、`/metrics` 的 Bearer 令牌；不设则到达进程的请求一律放行 |
| `DEEPSEEK_API_KEY` | 接真实模型时 | key；另可用 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 覆盖端点与模型 |
| `JARY_EMAIL_SECRET` | 否 | 入站邮件 `/api/email/inbound` 的共享密钥 |
| `JARY_OAUTH_*_<ID>` | 用 OAuth 时 | token URL、client id/secret、state，示例见 `examples/connectors/oauth.md` |

若设置了 `JARY_API_TOKEN`，用 `https://<域名>/?token=<token>` 打开 Web UI 一次（令牌存 localStorage 并立即从地址栏移除），之后流式连接改用短期 stream ticket，不再把长期令牌放进 URL。配对码生成也需要该令牌（CLI 或已鉴权请求），设备令牌等价 owner，见 [安全](security.md) §2。

## 3. 裸机 Node

```bash
git clone https://github.com/ct-jaryn/jaryn-bot.git && cd jaryn-bot
node scripts/link-workspaces.mjs           # 建立 @jaryn/* 链接（npm test 也会执行）
node packages/cli/src/index.ts init --home ./data-home
node packages/cli/src/index.ts doctor --home ./data-home

export DEEPSEEK_API_KEY=sk-...
node packages/cli/src/index.ts serve --home ./data-home --port 8787 \
  --patch packages/bundles/deepseek/patch.json
```

- `serve` 默认 `--host 127.0.0.1`；`--host 0.0.0.0` 只用于可信内网，且仍应加 TLS。非 loopback 且未设 `JARY_API_TOKEN` 时启动会打印警告。
- 不传 `--home` 时 home 是 `~/.jary`；建议显式指定，便于备份与升级。
- 可选 patch：`packages/bundles/docker-computer/`（容器云电脑）、`web-search/`（SearXNG）、`mcp/`、`email-imap/`、`docker/`（Docker 沙箱）。

生产建议用 systemd 托管：`EnvironmentFile=/etc/jary.env`、`ExecStart=... serve --home /var/lib/jary --port 8787`、`Restart=on-failure`。

## 4. 反向代理与 TLS

Caddy（自动证书；仓库内有完整示例 `deploy/Caddyfile`，含安全头与 SSE 配置）：

```caddyfile
jary.example.com {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
    X-Frame-Options "DENY"
  }
  reverse_proxy 127.0.0.1:8787 {
    flush_interval -1        # SSE / 流式
  }
}
```

Nginx（TLS、SSE、WebSocket 需显式配置）：

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
  listen 443 ssl http2;
  server_name jary.example.com;
  ssl_certificate     /etc/letsencrypt/live/jary.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/jary.example.com/privkey.pem;
  client_max_body_size 21m;          # /api/files 单文件上限 20MB

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;             # /api/stream 是 SSE
    proxy_read_timeout 3600s;
  }
}
```

- 必须保留 `Host`：OAuth 回调与换 token 的 `redirect_uri` 由请求 Host 拼出（`packages/web/src/index.ts`），改写 Host 会导致回调地址不一致。`/ws/client` 与 `/tunnel` 走 Upgrade，`/api/stream` 是 SSE，需要关闭响应缓冲。`/tunnel` 需要鉴权：`jary tunnel --url ... --token <JARY_API_TOKEN>`（或设置同名环境变量），匿名 upgrade 返回 401。
- 设置 `JARY_API_TOKEN` 后，浏览器用 `https://<域名>/?token=<token>` 打开 Web UI 一次即可（令牌存 localStorage，地址栏查询串会被清掉）；SSE/看屏走 `POST /api/stream-ticket` 换来的 10 分钟 ticket。反代日志仍可能记录首次引导的查询串，建议用完即清或由反代注入 Authorization。
- `POST /api/devices/pair` 是公开路径（设备只持有一次性码），`POST /api/devices/pair-code` 需要 Bearer 鉴权；公网部署仍建议在反代限制 `/api/devices/pair` 的频率与来源。
- 只暴露 443；8787 保持 loopback，不要把 `--host 0.0.0.0` 直接暴露到公网。客户端接入与设备配对见 [客户端指南](../guides/clients.md)。

## 5. 数据目录与备份恢复

```text
$JARY_HOME/
├─ profile.json            # 插件组合（bundle/patch 行）
├─ data/jary.db            # SQLite（WAL，另有 -wal/-shm）
├─ vault.key               # Vault 主密钥（0600；可由 JARY_VAULT_KEY 覆盖）
├─ bots/<id>/              # 每个 Bot 的工作区
├─ artifacts/  computers/  # 产物；云电脑 profile 与 workspace
├─ skills/  exports/  profiles/  backups/   # 技能、导出、插件、备份输出
```

在线备份（SQLite 用 `VACUUM INTO` 取一致快照）：

```bash
node packages/cli/src/index.ts backup --home <home>
```

Docker 部署把 `<home>` 换成 `/data`，并用 `docker compose exec jary` 执行；默认输出在 `$JARY_HOME/backups`，对应宿主 `./data/backups`。

`jary backup` 实际覆盖范围：

| 内容 | 由命令备份 | 说明 |
|---|---|---|
| `data/jary.db` | 是 | 备份根生成 `jary.db` |
| `bots/`、`artifacts/`、`profiles/`、`presets/` | 是 | 递归复制 |
| `manifest.json` | 是 | 版本、时间、密钥需单独保存的提示 |
| `profile.json` | 否 | 需单独复制 |
| `vault.key` | 否 | 必须单独离线保存；没有同一密钥则 Vault 密文无法解密 |
| `computers/`、`skills/`、`exports/` | 否 | 按需 `rsync` 另行备份 |

恢复（先停服务，避免覆盖正在写入的 WAL）：

```bash
systemctl stop jary                              # Docker 用 docker compose ... stop jary
node packages/cli/src/index.ts restore --home <home> --from <backup-dir> --yes
cp <backup-dir>/vault.key <home>/vault.key       # 或恢复 JARY_VAULT_KEY
systemctl start jary                             # 对应上面的停止方式
node packages/cli/src/index.ts doctor --home <home>
```

Docker 场景用 `docker compose run --rm jary` 执行同一 restore 命令（`--home /data`，备份目录放入 `data/backups`），启动前把 `vault.key` 放回宿主 `data/vault.key`。

恢复后核对 `jary session list`、`jary session replay <id>`、`jary vault list`。建议每月演练“新目录恢复 + doctor + 抽查回放”；备份与密钥分开存放。

## 6. 升级与回滚

1. 备份：`jary backup`，并单独保存 `vault.key` 与 `profile.json`。
2. 切到目标 tag 后重新构建并启动：`docker compose -f deploy/docker-compose.yml build --pull`、`up -d`；裸机则重启 systemd 服务。
3. 验证 `/healthz`、healthcheck、`doctor`、`jary session list` 与 Web 一轮对话。
4. 回滚：切回旧 tag → 重新构建启动 → 用升级前备份恢复数据库；镜像与数据成对回滚。

数据库迁移在 store 启动时执行幂等 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE`（`packages/store-sqlite/src/index.ts`），没有自动 `.bak` 文件，程序也不会拒绝更高版本的 schema。升级前备份是唯一的回滚保障。第三方插件升级后跑一次 `jary plugin doctor`。

## 7. 健康检查与日志

| 检查项 | 位置 | 说明 |
|---|---|---|
| `/healthz` | 无需鉴权 | 检查 store、agent、memory、scheduler 是否挂载；全有 200，否则 503 |
| `/metrics` | 需要 Bearer | `jaryn_sessions_total`、`jaryn_events_total{type}`、`jaryn_jobs_total`、`jaryn_job_runs_total`、`jaryn_memory_total` |
| 容器 healthcheck | `docker inspect --format '{{.State.Health.Status}}' <容器>` | 镜像内 `doctor` 的结果 |
| 业务审计与回放 | `jary audit --limit 20`、`jary session replay <id>` | audit 表与 append-only 事件流，格式见 [事件参考](../reference/events.md) |

```bash
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS -H "Authorization: Bearer $JARY_API_TOKEN" http://127.0.0.1:8787/metrics
docker logs --tail 200 -f jary
journalctl -u jary -f
node packages/cli/src/index.ts audit --home <home> --limit 20
```

服务不写日志文件，也不逐请求打印结构化日志；启动时 stdout 输出 `jary web: http://...`，MCP/进程外插件子进程的 stderr 分别以 `[mcp:<name>]`、`[plugin:<id>]` 前缀转发。运行态以 SQLite 中的事件、审批、usage、audit 表为准；Docker 下把带 `--home` 的 CLI 换成 `docker compose exec jary node packages/cli/src/index.ts ... --home /data`。

## 8. 资源预算（4C4G）

| 场景 | CPU | 内存 | 磁盘 | 说明 |
|---|---|---|---|---|
| 1 Bot，每日 <50 轮（推荐基线） | 4 核 | 4GB | 20GB | 默认部署目标 |
| 1 Bot 最小可用 | 2 核 | 2GB | 10GB | 不含云电脑 |
| 3 Bot，每日 <200 轮 | 4 核 | 4–6GB | 20GB | 每个并发 turn 会抬高内存 |
| 1–3 个云电脑 | 4–8 核 | 8–16GB | 40–80GB | 含镜像与快照；空闲自动停可降耗 |

以上是部署规划值，不是基准测试结果。模型调用按 token 计费，是主要变动成本；内存通常是硬约束，headless Chrome 与 Docker 云电脑会额外占用内存，实际以 `/metrics`、容器统计和宿主机监控为准。

相关：[安全](security.md) · [测试](testing.md) · [排错](troubleshooting.md) · [CLI 参考](../reference/cli.md)
