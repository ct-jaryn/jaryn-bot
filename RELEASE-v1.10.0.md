# jaryn-bot v1.10.0 — 全量代码与文档梳理

把全部代码和文档过了一遍，修掉 4 个真实缺陷，补了自动化核对手段，文档数字全部对得上。

## 修复（都是实际会出问题的）

| 缺陷 | 影响 | 修复 |
|---|---|---|
| **OAuth 回调被鉴权拦截** | 浏览器从 Google 跳回 `/api/oauth/callback/gmail` 时没有 Bearer → 401，OAuth 流程走不通 | 回调路由改为 public，用 `state` 校验；测试覆盖 |
| **邮件入站只能带 API token** | 外部邮件服务无法只靠共享密钥投递 | 支持 `JARY_EMAIL_SECRET` + `x-jary-email-secret`，与 token 二选一 |
| **Vault 授权两处 bug** | `vault.grant/revoke` 传 `undefined` 给 SQLite 直接抛错；撤销最后一个授权后变成"任何 bot 都能用" | `audit` 绑定改 `null`；新增 `grants_only`：授权即锁定，撤销后仍锁定 |
| **Docker 镜像漏链 16 个包** | 镜像里 `@jaryn/office`、`goals`、`notifications` 等会 `ERR_MODULE_NOT_FOUND`，`docker compose up` 起不来 | Dockerfile 改为动态链接全部 `packages/*`，check-deploy + 回归测试防止再漏 |

## 新增工具

- `jary tools [--json]`：列出运行中组合的全部 **74** 个工具与风险等级
- CLI 管理动作写入审计：`bot.added/edited/removed`、`job.added`、`plugin.enabled/disabled`
- `npm run smoke`：CLI 端到端冒烟（init → doctor → tools → memory → bot → job → vault → goal → audit → plugin → backup → restore → stop-all）
- `npm run inventory` + [docs/18-code-inventory.md](docs/18-code-inventory.md)：从**真实加载的组合**导出包/插件/工具/路由/表/CLI/测试清单

## 文档对齐全清单

- `docs/02`：HTTP 端点表按实际 63 条路由重写（含 `/ws/client`、MJPEG、OAuth、通知、规则、用量、审计）
- `docs/04`：测试金字塔改为当前实况（Node 原生 `node:test`，无 pnpm/tsx），DoD 命令改 `npm test && npm run check`，加 smoke/inventory
- `docs/05`：拓扑从"gateway + worker"改为真实的**单进程 + 每 Bot 云电脑**；compose 与数据目录与 `deploy/` 完全一致（去掉 `jary.toml` 等不存在的文件）
- `docs/14`：74 工具 / 63 路由 / 23 CLI / 28 表 / 178 测试
- 新增 `docs/18`（自动生成）；`docs/README` 索引更新

## 验证

```bash
npm test        # 178 passed
npm run check   # docs 32 files / deploy 44 plugins / desktop 4 targets / eval 10 tasks
npm run smoke   # smoke ok
npm run inventory
jary version    # 1.10.0
jary tools      # 74 tools
```

## 已知未做（不变）

iOS 客户端、真 WebRTC、真实支付网关（均为 Won't）；真实模型评测 / Docker 实测 / macOS 安装包（需外部条件）。见 [docs/17-scope-and-wont.md](docs/17-scope-and-wont.md)。
