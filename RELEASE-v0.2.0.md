# jaryn-bot v0.2.0 — 云电脑

在 v0.1.0 基础上，把「Bot 有自己的电脑」做成可运行能力。

## 新增

- **每 Bot 一台电脑**：本地 Chrome headless（开发）或 Docker 容器（隔离）
- **浏览器**：`browser.goto/extract/click/type/screenshot`，基于 CDP
- **看屏**：`/api/computer/screenshot` 返回当前页面 PNG
- **快照/恢复**：workspace + 浏览器 profile，任务级回滚
- **CLI**：`jary computer status|start|stop|snapshot --bot <id>`
- **Web API**：`/api/computer`、`/api/computer/start|stop|snapshot`、`/api/computer/screenshot`
- **Docker**：`deploy/computer/Dockerfile`（chromium + 中文字体），可选 patch 切换后端

## 快速开始

```bash
node packages/cli/src/index.ts computer start --bot default
node packages/cli/src/index.ts computer status --bot default
```

Docker 后端：

```bash
docker build -t jaryn-computer:0.2 -f deploy/computer/Dockerfile .
jary config print --patch packages/bundles/docker-computer/patch.json
```

## 已知限制

- 本地后端无隔离，仅建议开发机使用；生产用 Docker 后端
- 看屏目前是截图轮询，实时串流/人工接管未实现
- 桌面 GUI（Xvfb）未实现
- 本机出网（jary tunnel）未实现
