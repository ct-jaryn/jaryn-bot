# CLI 参考

> 适用版本：v1.11.0 · 状态：现行
> 全部命令、常用选项与示例；行为以 `packages/cli/src/index.ts` 为准，帮助文本可用 `jary help` 查看。

## 1. 通用约定

- 入口：workspace 链接后可直接用 `jary`；未安装时用 `node packages/cli/src/index.ts`，两者等价。
- 语法：`jary <命令> [子命令] [位置参数] [--选项 值]`。布尔选项只写 `--flag`；不带值的 `--flag` 视为 `true`。
- `--home <dir>`：数据根目录，默认 `~/.jary`。标 ✓ 的命令读取它；装配插件时 CLI 会把解析结果写入 `JARY_HOME` 供插件使用。
- `--patch <file>`：在 profile 之上追加一层 patch，适用于所有需要装配运行时的命令（`config print`、`doctor`、`serve`、`chat`、`memory`、`bot`、`job`、`stop-all`、`computer`、`vault`、`device`、`goal`、`tools`、`usage`、`audit`、`session`、`backup`、`restore`、`plugin list|doctor`）。
- 退出码：`0` 成功；`1` 运行时失败（如 `doctor` 检查失败、备份文件缺失）；`2` 参数或用法错误。
- 所有子命令的 `--home` 都可省略；下面只标注该命令是否依赖本地数据（✓ 表示会读写 `--home` 下的数据）。

## 2. 日常使用

| 命令 | 子命令与关键选项 | 示例 | `--home` |
|---|---|---|---|
| `jary init` | 无；创建 home 与 `profile.json` | `jary init --home ./data-home` | ✓ |
| `jary config` | `print`；`--json` 打印完整 row 数组 | `jary config print --home ./data-home` | ✓ |
| `jary chat` | 位置参数或 `--text`；`--bot`（会话 `cli:<bot>`，默认 `cli:default`） | `jary chat --bot researcher --home ./data-home "列出当前目录的大文件"` | ✓ |
| `jary serve` | `--port`（默认 8787）、`--host`（默认 127.0.0.1） | `jary serve --home ./data-home --port 8787` | ✓ |
| `jary memory` | `add`、`list`、`search`、`catalog`、`digest`、`forget`、`consolidate`、`stats`（catalog 别名）；`--ns`、`--kind`、`--limit`、`--pinned` | `jary memory add "周报用中文，结论先行" --kind rule --pinned --home ./data-home` | ✓ |
| `jary bot` | `add`、`list`、`edit`、`remove`；`--name`、`--persona`、`--workspace`、`--purge` | `jary bot add researcher --name 研究员 --home ./data-home` | ✓ |
| `jary job` | `add`、`list`、`run`、`enable`、`disable`、`remove`、`runs`；`--cron`、`--tz`、`--every`、`--webhook`（必须配 `--secret`）、`--secret`、`--bot`、`--name`、`--max-rounds`、`--max-steps` | `jary job add --cron "0 8 * * *" --tz Asia/Shanghai --name morning "生成今日简报" --home ./data-home` | ✓ |
| `jary goal` | `set`、`list`、`run`、`pause`、`clear`；`--session`（默认 `cli`）、`--max-rounds`、`--id` | `jary goal set "把 v1.10 发布说明写完" --session cli --home ./data-home` | ✓ |
| `jary tools` | `--json`；按风险打印已注册工具 | `jary tools --json --home ./data-home` | ✓ |
| `jary vault` | `add`、`list`、`remove`、`rotate`、`events`；`--name`、`--origin`、`--username`、`--password`、`--kind` | `jary vault add --name GitHub --origin https://github.com --username me --password "..." --home ./data-home` | ✓ |
| `jary computer` | `status`、`start`、`stop`、`snapshot`；`--bot`（默认 default）、`--label` | `jary computer status --bot default --home ./data-home` | ✓ |
| `jary device` | `pair-code`、`list`、`revoke`；配对码默认 10 分钟有效 | `jary device pair-code --home ./data-home` | ✓ |
| `jary tunnel` | `--url ws://<server>/tunnel`；前台运行直到 Ctrl-C | `jary tunnel --url ws://example.com/tunnel` | — |
| `jary version` | 无；输出版本与 Node 版本 | `jary version` | — |
| `jary help` | 无；输出命令一览（`--help`、`-h` 同义） | `jary help` | — |

## 3. 运维

| 命令 | 子命令与关键选项 | 示例 | `--home` |
|---|---|---|---|
| `jary backup` | `--out <dir>`（默认 `$JARY_HOME/backups/<ISO 时间戳>`） | `jary backup --home ./data-home --out ./backups/2026-11-24` | ✓ |
| `jary restore` | `--from <backup-dir>`、`--yes`（必需） | `jary restore --home ./data-home --from ./backups/2026-11-24 --yes` | ✓ |
| `jary stop-all` | 无；暂停调度器并取消运行中的 turn | `jary stop-all --home ./data-home` | ✓ |
| `jary plugin` | `list`、`doctor`、`permissions`、`add`、`remove`、`enable`、`disable`、`index`；`add` 支持 `npm:`、`git:`、`file:` 前缀与 `--trust` | `jary plugin list --home ./data-home` | ✓ |
| `jary usage` | `--session <id>`；输出 token 与费用汇总 | `jary usage --home ./data-home` | ✓ |

## 4. 排查

| 命令 | 子命令与关键选项 | 示例 | `--home` |
|---|---|---|---|
| `jary doctor` | 无；检查 Node 版本、home 可写、base patch、插件加载、工具注册；失败退出 1 | `jary doctor --home ./data-home` | ✓ |
| `jary audit` | `--limit`（默认 50）；输出管理动作审计日志 | `jary audit --limit 20 --home ./data-home` | ✓ |
| `jary session` | `list`、`replay <id>`、`export <id>`（`--out`）、`delete <id>`（`--yes`）；导出默认脱敏 | `jary session export cli --out ./export.jsonl --home ./data-home` | ✓ |

## 5. 关键行为与示例

```bash
#1) 初始化：只写 profile.json，不创建数据库；首次装配运行时才创建 $JARY_HOME/data/jary.db
jary init --home ./data-home
jary config print --home ./data-home          # 查看组合后的插件行

#2) 接入真实模型（bundle patch 叠加在 profile 之上）
DEEPSEEK_API_KEY=sk-... jary serve --home ./data-home \
  --patch packages/bundles/deepseek/patch.json

#3) 例程：cron / every / webhook 三选一，webhook 可用 --secret 做 HMAC
jary job add --every 3600 --name hourly "检查收件箱并汇总" --bot default --home ./data-home
jary job add --webhook /deploy --secret "$HOOK_SECRET" --name deploy "检查部署状态" --home ./data-home
jary job runs <job-id> --home ./data-home

#4) 会话取证：replay 逐步打印事件；export 默认对 token/password 等字段脱敏
jary session list --home ./data-home
jary session replay <session-id> --home ./data-home
JARY_EXPORT_RAW=1 jary session export <session-id> --out ./raw.jsonl --home ./data-home

#5) 插件：add 会把行写入 profile.json 并装到 $JARY_HOME/profiles/default
jary plugin add npm:@scope/jary-plugin@1.2.3 --home ./data-home
jary plugin disable some-plugin --home ./data-home   # 需重启生效
jary plugin doctor --home ./data-home                # 缺少依赖时退出 1
```

补充说明：

- `jary init` 不会生成数据库；`data/jary.db` 由 store 插件在首次装配时创建（基础 patch 的 `path` 为相对 home 的 `data/jary.db`）。
- `jary chat` 使用会话 `cli:<bot>`（默认 `cli:default`）；`--bot` 决定会话的 botId 与工作区，重复对话会续用同一会话。
- `jary memory` 的 `add` 需要文本参数，`--kind` 默认 `fact`，`--pinned` 提升参与每轮摘要的优先级；`forget` 按查询删除。
- `jary job add` 的触发器优先级为 `--cron` > `--every` > `--webhook`；`--tz` 默认 `UTC`，`--every` 单位为秒（最小 60 秒）。
- `--webhook <path>` 的值保存在 `trigger.path`；HTTP 触发地址是 `/hooks/<job-id>`（按作业 id 查找，不使用 path），且必须配置 `--secret` 做 HMAC 校验，否则创建与触发都会被拒绝。
- `jary backup` 用 SQLite `VACUUM INTO` 导出数据库，并复制 `bots`、`artifacts`、`profiles`、`presets`（存在时），写 `manifest.json`；**不包含 `vault.key`**，需单独保管。
- `jary restore` 覆盖当前数据库与上述目录，必须显式 `--yes`；恢复后需重启服务。
- `jary stop-all` 只暂停调度并取消运行中的 turn，不关闭进程；恢复用 `jary job enable` 或停止后重新 `serve`。
- `jary plugin add` 调用本机 `npm install --prefix $JARY_HOME/profiles/default`，需要网络与 npm；第三方插件与主进程同进程运行，`--trust` 只跳过警告，不改变权限。
- `jary plugin remove` 按包名删除 profile 中对应 patch 行；`enable`/`disable` 按 row id 追加 `{ id, disabled }`，重启后生效。
- `jary device pair-code` 生成一次性六位配对码（默认 10 分钟有效）；`revoke` 传入设备 id。
- `jary tunnel` 是客户端主动出站的隧道，服务端不反向拨号；见 [HTTP API](http-api.md) 与 [部署](../operations/deployment.md)。
- `jary serve` 启动 Web/API 并启动调度器（5 秒 tick），前台阻塞到 SIGINT/SIGTERM。
- 相关阅读：[快速开始](../getting-started.md)、[配置](configuration.md)、[事件](events.md)、[排错](../operations/troubleshooting.md)。
