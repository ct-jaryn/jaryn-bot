# 快速开始

> 适用版本：v1.11.0 · 状态：现行
> 从零到"Bot 干完第一件活"：安装、配置模型、打开 Web、派活、验证。

## 1. 前置条件

| 项 | 要求 |
|---|---|
| Node | **24+**（用原生 TypeScript 运行，无编译步骤） |
| 系统 | Linux / macOS；Windows 建议 Docker 或 WSL |
| 内存 | 2 GB 起步；4C4G 可跑满全部能力 |
| Docker | 可选。生产推荐；云电脑容器后端需要 |
| 模型 | 默认 DeepSeek API（兼容 OpenAI 协议），也可换其它 provider |

不需要 `npm install`：运行时不依赖第三方包。

## 2. 安装与初始化

```bash
git clone https://github.com/ct-jaryn/jaryn-bot.git
cd jaryn-bot
node scripts/link-workspaces.mjs            # 建立 packages/* 链接（npm test 也会自动执行）

node packages/cli/src/index.ts init --home ./data-home
node packages/cli/src/index.ts doctor       # 逐项检查：patch、插件、工具、目录权限
```

`init` 生成 `data-home/profile.json`（插件组合）与 `data-home/jary.db`（SQLite，事件/记忆/审批/用量）。

## 3. 选择模型

默认组合使用 `echo` provider（离线、可跑通链路、不产生费用），适合先验证。

接真实模型：

```bash
export DEEPSEEK_API_KEY=sk-...
node packages/cli/src/index.ts serve --home ./data-home \
  --patch packages/bundles/deepseek/patch.json
```

其它兼容 OpenAI Chat Completions 的服务：在 patch 里改 `baseUrl` / `model`，不需要改代码。字段见 [配置](reference/configuration.md)。

## 4. 打开 Web 工作台

```bash
node packages/cli/src/index.ts serve --home ./data-home --port 8787
# → http://127.0.0.1:8787
```

首次进入会看到会话列表与输入框。试试：

- 「帮我总结这个仓库的目录结构，写成 markdown 文件放在 workspace」
- 触发写文件/执行命令时会出现**审批卡**：允许一次 / 拒绝
- 右侧「面板」可看记忆、任务、页面、产物、例程、用量、审计
- 顶部「看屏」需要先有云电脑（见 [云电脑](guides/cloud-computer.md)）

界面细节见 [Web 工作台](guides/web-ui.md)。

## 5. 命令行方式

```bash
# 单轮对话
node packages/cli/src/index.ts chat --home ./data-home "列出当前目录大文件"

# 记忆
node packages/cli/src/index.ts memory add "以后周报用中文，结论先行" --kind rule --pinned

# 多 Bot
node packages/cli/src/index.ts bot add researcher --name 研究员

# 每天 8 点的例程
node packages/cli/src/index.ts job add --cron "0 8 * * *" --tz Asia/Shanghai \
  --name morning "生成今日简报并保存为 /workspace/brief.md"
```

全部命令见 [CLI 参考](reference/cli.md)。

## 6. 生产部署（Docker + 反代）

```bash
cp .env.example .env
# 至少设置 JARY_API_TOKEN=<随机串>；DEEPSEEK_API_KEY 可选
docker compose -f deploy/docker-compose.yml up -d --build
```

- 只绑 `127.0.0.1:8787`，公网必须走 Caddy/Nginx TLS 反代。
- 数据卷 `./data`：`jary.db`、各 Bot workspace、artifacts、云电脑、`vault.key`。
- 健康检查：`GET /healthz`；日志与升级见 [部署](operations/deployment.md)。

## 7. 验证

```bash
npm test        # 184 tests（串行；真实 Chrome、TLS、WS、SQLite）
npm run check   # docs + deploy + desktop + inventory + eval 结构校验
npm run smoke   # CLI 端到端冒烟
node scripts/inventory.ts   # 打印运行时工具/路由/表统计
```

真实模型质量评测需要 key：

```bash
DEEPSEEK_API_KEY=sk-... node evals/run.ts
```

## 8. 目录布局

```
$JARY_HOME/
├─ profile.json        # 插件组合（bundle + patch 行）
├─ data/jary.db        # SQLite（事件、记忆、审批、用量、任务…；路径来自 base patch）
├─ bots/<id>/workspace # 每个 Bot 的工作区
├─ artifacts/          # 产物文件
├─ computers/          # 云电脑 profile / 快照
├─ skills/             # 教学技能 SKILL.md
├─ exports/            # 会话导出
└─ vault.key           # Vault 主密钥（0600）
```

## 下一步

- 建立心智模型：[核心概念](concepts.md)
- 按需启用：记忆、主动任务、云电脑、Vault、连接器、Pages
- 写自己的插件：[插件指南](guides/plugins.md)
- 出问题：[排错](operations/troubleshooting.md)
