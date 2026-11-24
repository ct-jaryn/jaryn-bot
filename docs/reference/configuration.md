# 配置参考

> 适用版本：v1.11.0 · 状态：现行
> `profile.json`、bundle/patch 行、常用插件字段、环境变量与目录布局；以 `packages/kernel/src/loader.ts` 与各插件源码为准。

## 1. profile.json

数据根由 `--home` 决定（默认 `~/.jary`），profile 位于 `$JARY_HOME/profile.json`。文件不存在时按默认组合启动（仅 base bundle）；`jary init` 会生成：

```json
{
  "name": "default",
  "bundles": [
    { "name": "base", "patchFile": "/abs/path/packages/bundles/base/patch.json" }
  ],
  "patches": []
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | profile 名称，仅用于标识 |
| `bundles` | array | 按数组顺序叠加的 bundle；`name` 为标识，`patchFile` 为 patch JSON 路径 |
| `patches` | array | 最后叠加的一层 patch 操作（可省略） |

- `patchFile` 用 `path.resolve` 解析：相对路径按**进程当前目录**解析，不是按 home；`jary init` 写入的是绝对路径。
- patch 文件内容是 `PatchOp[]`（JSON 数组）。
- 修改 profile 后无需重新 init；下一条 CLI 命令或重启 `serve` 即按新组合装配。

## 2. bundle / patch 行

bundle 是「一行一个插件」的有序列表，加载时按依赖拓扑排序；patch 行 = 插件 + 配置 + 启用状态。

```json
[
  { "id": "store", "name": "@jaryn/store-sqlite", "config": { "path": "data/jary.db" } },
  { "id": "llm", "name": "@jaryn/llm-deepseek", "config": { "model": "deepseek-chat" } },
  { "id": "web", "name": "@jaryn/tools-web", "config": { "search": { "provider": "searxng", "baseUrl": "http://127.0.0.1:8888" } } },
  { "id": "sandbox", "name": "@jaryn/sandbox-docker", "config": {} },
  { "id": "old-tool", "disabled": true }
]
```

| 操作形式 | 含义 |
|---|---|
| `{ "insert": [Row...] }` | 批量插入；同 `id` 已存在时整行替换 |
| `{ "id", "name", "config", "disabled" }` | 按 id 更新：`name`/`config`/`disabled` 出现才覆盖，未出现的字段保持不变 |
| `{ "id", "config" }` 且 id 不存在 | 必须同时给 `name` 才能新增一行，否则报错 |

- 组合顺序：`profile.bundles` 逐个 applyPatch → 最后 `profile.patches`。`config` 是**整值替换**，不会深合并。
- `disabled: true` 的行跳过加载；若其它插件 `inject` 了它提供的服务，启动失败。
- 失败是显式的：未知插件、缺失依赖、循环依赖、同一服务被两个行提供，都会在装配阶段抛出 `PluginError`，不会静默降级。
- `--patch <file>` 在 profile 之后追加一层 patch，用于临时换模型、加工具；命令见 [CLI](cli.md)。

## 3. 内置 bundle

| bundle | patchFile | 内容 |
|---|---|---|
| base | `packages/bundles/base/patch.json` | 41 个基础插件（store、agent、fs、shell、memory、bots、scheduler、云电脑、vault、pages、email、goals、notifications 等） |
| deepseek | `packages/bundles/deepseek/patch.json` | 把 `llm` 行替换为 `@jaryn/llm-deepseek` |
| web-search | `packages/bundles/web-search/patch.json` | 把 `web` 行配置为 SearXNG |
| docker | `packages/bundles/docker/patch.json` | 插入 `sandbox` 行（Docker 沙箱执行） |
| docker-computer | `packages/bundles/docker-computer/patch.json` | 云电脑改为 Docker 后端 |
| email-imap | `packages/bundles/email-imap/patch.json` | 为 `email-imap` 行设置 `pollMs` |
| mcp | `packages/bundles/mcp/patch.json` | 插入 `mcp` 行与 `servers` 配置 |

## 4. 常用插件 config 字段

| 行（包） | 字段 | 默认 | 说明 |
|---|---|---|---|
| store（`@jaryn/store-sqlite`） | `path` | `data/jary.db`（base patch，相对 home） | SQLite 路径；插件未配置时用内存库 |
| llm（`@jaryn/llm-deepseek`） | `apiKey`、`baseUrl`、`model`、`maxTokens`、`retries` | 依环境变量，见 §5 | 兼容 OpenAI Chat Completions 的端点 |
| approvals（`@jaryn/agent-core/approvals`） | `askRisks`、`timeoutMs`、`rules` | execute/external/destructive；30 分钟；[] | 审批策略与规则 |
| pricing（`@jaryn/agent-core/pricing`） | `inputPer1M`、`outputPer1M`、`cacheReadPer1M` | 0.28、0.42、0.028（USD/1M） | 费用估算单价 |
| tools-web（`@jaryn/tools-web`） | `search.provider`、`search.baseUrl`、`search.apiKey`、`fetchTimeoutMs`、`maxBytes`、`maxResults` | duckduckgo（有 baseUrl 时 searxng）；15000；2000000；5 | 搜索与抓取 |
| memory（`@jaryn/memory`） | `ns`、`maxEntries`、`episodeTtlDays`、`decayDays` | `global`；其余见源码 | 记忆命名空间与容量 |
| computer（`@jaryn/computer`） | `backend`、`dataDir`、`chromePath`、`image`、`idleMs`、`network`、`maxSessionMs`、`maxDailyMs`、`allowedDomains` | local；`$JARY_HOME/computers`；自动探测；jaryn-computer:0.2；不启用；none；4h；8h；[] | 云电脑后端与限额 |
| vault（`@jaryn/vault`） | `keyPath`、`allowCardPayments` | `$JARY_HOME/vault.key`、false | 主密钥与卡填表开关 |
| connectors（`@jaryn/connectors`） | `servers[]`：`id`、`name`、`baseUrl`、`auth`、`headers`、`tools[]` | [] | 通用 HTTP 连接器 |
| email（`@jaryn/email`） | `smtp`：`host`、`port`、`user`、`pass`、`from`、`security`、`secure`、`timeoutMs` | 未配置则不挂载发信 | SMTP 发信 |
| email-imap（`@jaryn/email/imap`） | `imap`：`host`、`port`、`user`、`pass`、`secure`、`mailbox`；`pollMs`、`allowFrom` | 未配置则不轮询；60000；[] | IMAP 收信 |
| mcp（`@jaryn/mcp`） | `servers[]`：`name`、`command`、`args`、`env` | [] | stdio MCP 服务 |
| plugin-host（`@jaryn/plugin-host`） | `hosts[]`：`id`、`command`、`args`、`env`、`timeoutMs` | []；60000 | 进程外插件宿主 |
| sandbox-docker（`@jaryn/sandbox-docker`） | `image`、`memory`、`cpus`、`network`、`maxOutputBytes` | debian:bookworm-slim；512m；0.5；none；32000 | 容器沙箱 |
| tools-shell（`@jaryn/tools-shell`） | `timeoutMs`、`maxOutputBytes` | 30000、32000 | shell.run 限制 |
| tools-fs（`@jaryn/tools-fs`） | `root` | 未设置（会话 cwd） | 文件工具根目录 |
| initiative（`@jaryn/initiative`） | `threshold`、`maxPerDay`、`dedupeMs`、`ttlMs`、`scanEveryMs` | 0.6；3；24h；24h；不扫描 | 提议打分与限额 |
| notifications（`@jaryn/notifications`） | `quietHours`：`start`、`end`、`tz` | 未设置 | 安静时段 |
| maintenance（`@jaryn/maintenance`） | `archiveSessionsAfterDays`、`everyMs` | 30；6h | 归档空闲会话并触发记忆维护 |
| devices（`@jaryn/devices`） | `maxAttemptsPerCode`、`maxAttemptsPerWindow`、`windowMs` | 5；10；10 分钟 | 配对防爆破 |
| scheduler（`@jaryn/scheduler`） | `autostart`、`tickMs` | false；5000 | 调度器 tick；CLI serve 会显式启动 |
| artifacts-tools（`@jaryn/artifacts/tools`） | `retentionDays` | 未设置（不清理） | 产物定期清理 |
| onePassword（`@jaryn/secrets/onePassword`） | `binary`、`references`、`timeoutMs` | op；{}；15000 | 1Password CLI |
| bitwarden（`@jaryn/secrets/bitwarden`） | `binary`、`sessionEnv`、`timeoutMs` | bw；BW_SESSION；20000 | Bitwarden CLI |

## 5. 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `JARY_HOME` | CLI 解析 `--home`，默认 `~/.jary` | 数据根；CLI 在装配插件时会写入该变量供插件读取 |
| `JARY_API_TOKEN` | 未设置（不鉴权） | 设置后 `/api/*`、`/metrics`、`/ws/client` 需要令牌 |
| `JARY_EMAIL_SECRET` | 未设置 | 入站邮件 `X-Jary-Email-Secret` 共享密钥 |
| `DEEPSEEK_API_KEY` | 无（base 用 echo provider） | DeepSeek 模型密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | 模型端点（可换内网兼容服务） |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |
| `JARY_VAULT_KEY` | 未设置（使用或生成 `$JARY_HOME/vault.key`） | 从环境派生 Vault 主密钥 |
| `CHROME_PATH` | 自动探测 Google Chrome | 本地云电脑的 Chrome 路径 |
| `JARY_EXPORT_RAW` | 未设置（导出脱敏） | 设为 `1` 时 `session export` 输出原始事件 |
| `JARY_OAUTH_TOKEN_URL_<ID>` | 无 | OAuth token 端点 |
| `JARY_OAUTH_CLIENT_ID_<ID>` | 无 | OAuth client id |
| `JARY_OAUTH_CLIENT_SECRET_<ID>` | 无 | OAuth client secret |
| `JARY_OAUTH_STATE_<ID>` | 未设置（不校验 state） | OAuth 回调 state 校验值 |
| `BW_SESSION` | 未设置 | Bitwarden CLI 会话（可由 `sessionEnv` 改名） |

> `.env.example` 中出现的 `IMAP_HOST`、`IMAP_USER`、`IMAP_PASS` 当前代码不读取；IMAP/SMTP 请通过 patch 的 `imap`/`smtp` 字段配置。

## 6. 端口与目录布局

| 端口 | 默认 | 说明 |
|---|---|---|
| HTTP/WS/SSE | `127.0.0.1:8787` | `serve --host/--port`；反代后暴露公网 |
| 隧道代理 | `127.0.0.1` 随机端口 | `TunnelServer.ensureProxy` 监听 0 端口 |
| 云电脑 CDP | 随机本地端口 | 本地 Chrome `--remote-debugging-port=0`；Docker 映射到宿主随机端口 |

```text
$JARY_HOME/                    # --home，默认 ~/.jary；Docker 为 /data
├─ profile.json                # 插件组合
├─ data/jary.db                # SQLite（WAL；base patch 的相对路径）
├─ bots/<id>/                  # 每个 Bot 的工作区（默认）
├─ artifacts/                  # artifact 文件
├─ computers/                  # 云电脑 profile / workspace / 快照
├─ skills/<slug>/SKILL.md      # 教学技能
├─ exports/<session>.jsonl     # session export 默认输出
├─ backups/<ISO 时间戳>/       # backup 默认输出
├─ profiles/default/           # plugin add 的 npm prefix
├─ plugin-index.json           # plugin index 维护的索引源
└─ vault.key                   # Vault 主密钥（0600）
```

- 数据库目录由 store 行 `path` 决定；改 `path` 即换库文件，备份/恢复前先确认。
- `vault.key` 不在 `jary backup` 内，必须与数据库备份分开保管；丢失后已存凭据不可解。
- 校验命令：`jary config print`、`jary plugin doctor`、`jary doctor`；改配置后失败会在启动时显式报错。
- 相关阅读：[CLI](cli.md)、[插件](../guides/plugins.md)、[部署](../operations/deployment.md)、[安全](../operations/security.md)。
