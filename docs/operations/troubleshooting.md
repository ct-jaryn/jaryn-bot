# 排错

> 适用版本：v1.11.0 · 状态：现行
> 按症状组织：每条先给判断方法，再给处理步骤；命令默认在仓库根执行，`<home>` 指 `--home` 指向的 `$JARY_HOME`。

## 1. 服务起不来

**判断方法**
```bash
node --version                              # 必须 >= 24
node scripts/link-workspaces.mjs            # @jaryn/* 链接缺失时模块解析失败
node packages/cli/src/index.ts doctor --home <home>
```

`doctor` 逐项输出 `ok`/`FAIL`：`node >= 24`、`home writable`、`base patch`、`plugins loaded`、`tools registered`。Docker 场景先看容器：

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs --tail 100 jary
```

**解决**

- `base patch FAIL` 或启动时报 JSON 解析错误：`profile.json` 里的 `patchFile` 是绝对路径，仓库移动后会失效；重跑 `init` 或改回当前路径。
- `plugins loaded FAIL`：转 §4。模块找不到 `@jaryn/*`：先跑 `link-workspaces`；`home writable FAIL`：修目录权限或换可写 home。
- Compose 直接报 `env file ... not found`：在仓库根执行 `cp .env.example .env`。端口冲突转 §2。

## 2. 端口被占用

**判断方法**：启动日志出现 `EADDRINUSE`。确认占用者：

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN      # macOS / Linux
ss -ltnp 'sport = :8787'              # Linux
```

**解决**

- 停掉占用进程，或给 `serve` 换端口：`jary serve --port 8788`。
- Docker 与宿主机服务不能同时监听 8787；Compose 的映射是 `127.0.0.1:8787:8787`，容器内的 8787 不直接暴露。
- 只改端口时记得同步反代 upstream 与客户端地址。

## 3. 401 unauthorized

**判断方法**
```bash
curl -i http://127.0.0.1:8787/api/sessions
curl -i -H "Authorization: Bearer $JARY_API_TOKEN" http://127.0.0.1:8787/api/sessions
```

若未设置 `JARY_API_TOKEN`，两种请求都应返回 200；设置了则第一种必然 401，响应体为 `{"error":"unauthorized"}`。

**解决**

- 确认令牌一致，且使用 `Bearer ` 前缀（或查询串 `?token=`）；反代若删除/改写 `Authorization` 头，需显式透传。
- 浏览器 Web UI 用 `http://<host>/?token=<JARY_API_TOKEN>` 打开，`app.js` 会把令牌存入 localStorage 并附加到请求；仍 401 时确认 URL 带 token、localStorage 未被清空，以及反代没有剥掉 `Authorization` 头。
- `/ws/client` 接受 `JARY_API_TOKEN`、`?token=` 或已配对设备令牌；浏览器 WebSocket 无法自定义头，需用查询串。
- `/metrics` 同样需要令牌；`/healthz`、静态页、`/pages/`、`/p/<token>`、`/secure/<token>` 不需要。
- 设备配对失败时检查：配对码 10 分钟过期、只能用一次；连续错误会被窗口限次，等待窗口结束再试，必要时 `jary device pair-code` 重新生成。

## 4. 插件加载失败

**判断方法**
```bash
node packages/cli/src/index.ts plugin list --home <home>      # 是否被 disabled
node packages/cli/src/index.ts plugin doctor --home <home>    # MISSING / MISSING DEP
node packages/cli/src/index.ts config print --home <home>     # 组合后的行
```

`plugin doctor` 输出 `MISSING <id>: <name>` 表示组合引用了未注册的插件；`MISSING DEP <id>: needs <key>` 表示依赖未提供。

**解决**

- 用 `plugin disable <id>` 禁用可疑行后重启，先让服务起来，再逐项排查。
- 第三方插件安装在 `<home>/profiles/default`，安装失败看 npm stderr；未加 `--trust` 会有提示，确认来源可信后再启用。`inject` 依赖缺失时调整 profile/patch 顺序或补上提供方。
- 组合与 patch 规则见 [插件指南](../guides/plugins.md)；错误信息带插件 id 与文件位置，仍不清楚时看 `packages/kernel/src`。

## 5. Chrome / 云电脑起不来

**判断方法**
```bash
node packages/cli/src/index.ts computer status --home <home> --bot default
node packages/cli/src/index.ts computer start --home <home> --bot default
```

启动失败常见错误是 `chrome did not start: <stderr 前 300 字>`（等待 15 秒仍无 `DevToolsActivePort`）。

**解决**

- 找不到浏览器：设置 `CHROME_PATH` 指向 Chrome/Chromium；Linux 默认尝试 `google-chrome`，macOS 默认是 Google Chrome 应用路径。上次异常退出留锁时先 `computer stop`，仍失败再删除 `<home>/computers/<bot>/profile/SingletonLock`（或重建 profile）。
- 容器云电脑：确认 Docker 可用、镜像已构建（`docker build -t jaryn-computer:0.2 -f deploy/computer/Dockerfile .`），并用 `--patch packages/bundles/docker-computer/patch.json` 启动；容器内 CDP 监听 9222，noVNC 在 6080。
- 被策略拒绝时区分“启动失败”和“导航被拒”：域名白名单、4h/日配额、空闲自动停都会让工具返回明确错误，见 [云电脑指南](../guides/cloud-computer.md)。

## 6. 邮件认证失败

**判断方法**
- 发信：让 Bot 调 `email.send`，错误会以工具结果返回，常见为 `SMTP expected 235 timeout`（认证未通过或服务端不接受该认证方式）、`SMTP server does not offer STARTTLS`、证书错误。
- 收信：IMAP 轮询失败不崩溃，会发出 `email/error` 事件；入站 webhook 返回 401 时先看请求头。

**解决**

- 配置在 patch 的 `smtp`/`imap` 段（字段见 `packages/email/src/smtp.ts`、`imap.ts`）：465 用 `security: "tls"`，587 用 `"starttls"`，服务端不支持加密时才用 `"none"`；认证只支持 AUTH PLAIN 与 AUTH LOGIN。
- 535 多为账号/应用专用密码错误（Gmail 等需应用密码）；自签证书测试可设 `rejectUnauthorized: false`，生产不要关闭校验。
- 入站邮件 401：请求头 `x-jary-email-secret` 必须等于 `JARY_EMAIL_SECRET`；未设置时接口走普通 API 令牌鉴权。
- allowlist 只影响收信处理，不改变 SMTP 发信；IMAP 需要 `packages/bundles/email-imap/patch.json` 且配置账号。

## 7. OAuth 回调 401 / 失败

**判断方法**：回调路径是公开的（不校验 Bearer），所以 401 通常来自反代或错误地址。直接请求看响应体：

```bash
curl -i "https://<域名>/api/oauth/callback/gmail?code=x&state=y"
```

- 400：缺 `code`，或 `state` 与 `JARY_OAUTH_STATE_<ID>` 不一致；500：`JARY_OAUTH_TOKEN_URL_<ID>` 或 `JARY_OAUTH_CLIENT_ID_<ID>` 未配置。
- 502：拿 code 换 token 失败（client secret、redirect_uri、code 过期等），响应体带原因；401：回调本身不产生 401，检查反代认证与地址是否打到别的服务。

**解决**

- 环境变量 id 大写：`JARY_OAUTH_TOKEN_URL_GMAIL`、`JARY_OAUTH_CLIENT_ID_GMAIL`、`JARY_OAUTH_CLIENT_SECRET_GMAIL`、`JARY_OAUTH_STATE_GMAIL`；示例见 `examples/connectors/oauth.md`。
- OAuth 应用里登记的回调必须与 `https://<域名>/api/oauth/callback/<id>` 完全一致；当前实现用请求 Host 拼 `redirect_uri`（`packages/web/src/index.ts`），反代改 Host 或 TLS 终结方式不一致会导致换 token 的 redirect_uri 不匹配，表现为 502。
- 回调成功后 token 写入 Vault（kind `oauth`），可用 `jary vault list` 确认；`state` 建议始终配置，否则回调没有 CSRF 校验。

## 8. 审批卡住

**判断方法**
```bash
curl -s -H "Authorization: Bearer $JARY_API_TOKEN" \
  http://127.0.0.1:8787/api/approvals
```

Web 端审批卡不出现，先看 `/api/stream` 是否被反代缓冲；审批请求也可能已经超时。界面说明见 [Web 工作台](../guides/web-ui.md)。

**解决**

- 单条审批默认 30 分钟超时，超时、连接断开、Abort 都按拒绝处理；重新发起该动作即可。直接决定：`POST /api/approvals/<id>`，请求体 `{"decision":"allowed"}` 或 `{"decision":"denied"}`。
- 后台任务（定时、目标、子 Bot）不允许等人：需要审批的工具会被立即拒绝并记录 `background`；要用就给显式 `allow` 规则，grant 不适用于这条路径。
- 规则冲突时 `deny > ask > allow`；确认规则列表：`GET /api/rules`。重启进程会清空内存中的待决审批（全部按拒绝处理）。

## 9. 备份 / 恢复失败

**判断方法**
- `database not found: <path>`：home 或 `store.path` 不对；SQLite 实际在 `<home>/data/jary.db`，可用 `find <home> -name 'jary.db'` 确认。
- `restore` 报 usage：缺少 `--from <backup-dir>` 或未加 `--yes`，且备份目录必须包含 `jary.db`；备份时 `VACUUM INTO` 报目标已存在则换新的 `--out` 目录。

**解决**

- 停服务后再恢复，避免覆盖正在写入的 WAL；恢复后重启并跑 `doctor`，核对 `jary session list`、`jary session replay <id>`、`jary vault list`。
- `jary backup` 不含 `profile.json`、`vault.key`、`computers/`、`skills/`、`exports/`；Vault 无法解密时补回原 `vault.key` 或设置相同 `JARY_VAULT_KEY`；备份与密钥分离保存。
- 磁盘不足会让备份/恢复中途失败；先 `df -h` 清理旧备份与 `artifacts/`。

## 10. 测试抖动 / 偶发失败

**判断方法**
```bash
npm test                                   # 全量，串行
node --test packages/web/test/auth.test.ts # 单文件复现
node --test --test-name-pattern 'vault' packages/vault/test/*.test.ts
```

**解决**

- 不要并发跑两份测试：真实 Chrome、固定端口、SQLite 临时库会互相干扰；用 `npm test` 的串行参数，并从仓库根执行、先确认 Node 24 与 `link-workspaces`。
- Chrome 用例失败：设置 `CHROME_PATH`，清理残留 Chrome 进程与临时 profile；没有 Chrome 时应 skip 而不是失败。
- 单测超时 40 秒；网络/磁盘慢的机器先复现单文件，再判断是环境还是用例问题。
- `npm test` 顺带跑 `scripts/check-docs.test.ts`，文档链接或头部格式错误会表现为测试失败；先跑 `npm run check:docs` 看具体文件。

相关：[部署](deployment.md) · [安全](security.md) · [测试](testing.md) · [配置参考](../reference/configuration.md) · [HTTP API](../reference/http-api.md)
