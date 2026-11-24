# 测试

> 适用版本：v1.11.0 · 状态：现行
> 测试即验收：178 个测试、64 个测试文件，Node 原生 `node:test` 直接跑 TypeScript；发布前还需结构校验、CLI 冒烟与评测。

## 1. 测试分层

| 层 | 覆盖内容 | 代表位置 |
|---|---|---|
| 单元 | kernel、store、预算、审批规则、解析、工具纯逻辑 | `packages/*/test/*.test.ts` |
| 集成 | 插件组合 + FakeProvider + SQLite + 服务间联动 | agent-core、web、scheduler、initiative、bots |
| 端到端 | 真实 Chrome（导航/截图/screencast/MJPEG）、真实 TLS 握手、WebSocket、HTTP | `packages/computer/test`、`packages/email/test`、`packages/web/test` |
| CLI 冒烟 | init/doctor/tools/memory/bot/job/vault/goal/backup/restore/stop-all | `scripts/smoke.ts` |
| 安全用例 | 路径逃逸、SSRF、Vault 授权、审批规则、配对限次、导出脱敏 | tools-fs、tools-web、vault、agent-core、devices |
| 评测 | 10 个真实任务，需模型 key | `evals/` |

测试不依赖第三方测试框架，也不需要编译。Fake 组件位于 `@jaryn/testing`（FakeProvider 等），假 IMAP/SMTP/TLS/MCP/HTTP 服务由各测试用 Node 内置模块自行搭建。

## 2. 命令与预期输出

```bash
node scripts/link-workspaces.mjs      # 建立 @jaryn/* 链接；npm test 会自动执行
npm test                              # 全量；串行，单测超时 40 秒
npm run check                         # docs + deploy + desktop + inventory + eval 结构校验
npm run smoke                         # CLI 端到端冒烟
```

`npm test` 的等价脚本为：

```bash
node --test --test-concurrency=1 --test-timeout=40000 \
  packages/*/test/*.test.ts scripts/*.test.ts desktop/test/*.test.cjs
```

预期尾部输出（数字以当前版本为准）：

```text
ℹ tests 178
ℹ pass 178
ℹ fail 0
```

真实 Chrome 用例只有在系统带 Chrome 或设置了 `CHROME_PATH` 时才执行，否则 skip；此时 `pass` 会少 1、`skipped` 为 1，其余仍须全过。串行是刻意设置：并发跑真实 Chrome、端口监听和 SQLite 临时库会互相干扰。

`npm run check` 依次执行五个检查，末行预期为：

```text
docs check ok (... files, ... under docs/)
deploy check ok (44 registry plugins)
desktop check ok (5 files, 4 targets)
inventory check ok (74 tools, 63 routes, 64 test files)
eval tasks ok (10 tasks) — dry run, no model calls
```

`npm run smoke` 在临时 home 里跑真实 CLI 组合，预期 `smoke ok (<临时目录>)`；失败会逐条列出缺失的输出或非零退出。单文件调试：

```bash
node --test packages/web/test/auth.test.ts
node --test --test-name-pattern 'vault' packages/vault/test/*.test.ts
```

## 3. 新增测试的写法

- 位置与命名：`packages/<pkg>/test/<topic>.test.ts`，`scripts/*.test.ts`，桌面端 `desktop/test/*.test.cjs`；`npm test` 的 glob 会自动收录，无需注册。
- 用 `node:test` 的 `test()` + `node:assert/strict`；用例内自建临时 home（`mkdtempSync`）、端口用 `0`（`startWebServer({ port: 0 })`），结束时 `server.close()` / `ctx.dispose()`，不要写仓库内文件。
- 不依赖真实网络与外部服务：模型用 FakeProvider，邮件用本地假 SMTP/IMAP，TLS 用自签证书，HTTP/WS 用内置模块。需要真实 Chrome 的用例按现有模式加 skip 守卫（检查 `CHROME_PATH` 或平台默认路径）。
- 用例必须能离线通过：没有 `DEEPSEEK_API_KEY`、没有 Docker、没有 Chrome 时只 skip 对应用例，不失败。
- 每条新增行为要有断言，错误路径给出明确错误信息；安全相关行为（越权、拒绝、脱敏、限次）优先补用例。

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeProvider } from '@jaryn/testing'

test('某个行为：输入 → 期望', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-my-case-'))
  // 用临时 home 装载最小组合，调用被测算子；结束时释放 ctx / server
  assert.ok(home)
})
```

## 4. 评测（需 key）

```bash
npm run eval -- --dry     # 只校验 tasks.json 结构与数量，不调用模型
npm run eval              # 有 DEEPSEEK_API_KEY 时跑 10 个任务
npm run eval -- --json   # 附带结构化结果
```

- `evals/tasks.json` 每个任务包含 `id`、`prompt`、`expect`（期望出现在回答中的字符串）；`--dry` 要求至少 10 个任务、id 唯一、prompt 长度与 expect 非空。
- 无 key 时打印 `DEEPSEEK_API_KEY not set — structural check ok (10 tasks), model run skipped` 并以 0 退出；有 key 时逐任务打印 PASS/FAIL，末行 `N/10 passed`。
- 通过线为 ≥70%（10 个任务至少 7 个），否则脚本以非零退出。评测使用临时 home，不污染真实数据；改 prompt、工具描述或模型配置后应重跑并记录趋势。

## 5. CI 工作流矩阵

| 工作流 | 触发 | 运行环境 | 内容 |
|---|---|---|---|
| `ci.yml` | push main、PR | ubuntu-latest，Node 24 | link → `npm test` → `npm run check` → 桌面单元测试 |
| `release.yml` | tag `v*`、手动、每周一 | ubuntu-latest、windows-latest、macos-15，Java 17 | 测试/校验 → 桌面三平台打包 → Android APK → 汇总校验和；tag 时创建 GitHub Release |
| `ci.yml` | push/PR | ubuntu-latest，Node 24 | `npm test` + `npm run check` |

打包细节与签名、排错见 [自动打包](release.md)。

CI 不跑真实模型评测；需要 `DEEPSEEK_API_KEY` 的评测与 Docker/Chrome 相关验证属于发布前人工验收。

## 6. 验收门槛

| 门槛 | 命令/动作 | 通过标准 |
|---|---|---|
| 测试 | `npm test` | 178 个测试 0 失败；必要时带 `CHROME_PATH` 跑真实 Chrome |
| 结构 | `npm run check` | 五项全 ok，退出码 0 |
| 冒烟 | `npm run smoke` | `smoke ok`，无失败项 |
| 评测 | `npm run eval` | 无 key 时结构通过；有 key 时 ≥7/10 |
| 干净部署 | 新机器 `docker compose up` | 10 分钟内完成首轮对话（需 Docker 环境） |
| 备份恢复 | `jary backup` → `jary restore --yes` | `doctor` 无错，`replay` 能重建，Vault 可解密 |
| 升级回滚 | 备份 → 升级 → `doctor` | 失败可按 [部署](deployment.md) §6 回滚 |

每个改动自身的 Definition of Done：代码 + 测试、错误码与用户文案、配置/CLI/接口文档同步、关键审计点、`npm test && npm run check` 全绿；涉及模型行为的变化再跑一次评测基线。发布前把上表结果附在 PR 或发布说明里。能力清单与审计口径见 [能力审计](../design/audit.md)。

相关：[部署](deployment.md) · [安全](security.md) · [排错](troubleshooting.md) · [CLI 参考](../reference/cli.md)
