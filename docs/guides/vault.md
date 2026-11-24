# Vault 与凭据

> 适用版本：v1.11.0 · 状态：现行
> 说明 Bot 如何保存和使用密码、API Key 与卡信息，以及为什么这些值不进入模型上下文、工具参数和日志。

## 1. 概览

Vault 是本地 write-only 凭据库。写入后只返回元数据；使用凭据的主要路径是"盲填"：服务端在浏览器页面的 DOM 中写入值，模型只收到"填写了哪些字段"。

| 能力 | v1.10.0 实现 |
|---|---|
| 静态加密 | SQLite `vault_items.secret_enc`，AES-256-GCM（每条随机 IV + auth tag），密钥经 SHA-256 派生（`packages/vault/src/crypto.ts`） |
| 主密钥 | `JARY_VAULT_KEY` 环境变量，或 `$JARY_HOME/vault.key`（自动生成、权限 0600） |
| 盲填 | `vault.fill`：校验授权与 origin 后，用页面 JS 写入 username/password（或 token），只返回 `{ok, filled}` |
| 授权 | 新增项默认对所有 Bot 可用；第一次 `vault.grant` 后锁定，只有被授权 Bot 可填充 |
| Secure Form | 一次性 token、默认 10 分钟有效；用户在独立页面输入后直接入库，不经过模型 |
| 审计 / 轮换 | `vault_events` 记录 add/fill/grant/revoke/rotate/remove（不含值）；轮换立即替换密文 |
| 外部密码管理器 | 1Password（`op read`）、Bitwarden（`bw get item`）服务；TOTP（RFC 6238）纯函数 |
| 卡信息 | `vault.fill_card`，默认关闭，`risk=destructive`，每次调用需审批；不接支付网关 |

模型可见的只有元数据（名称、origin、username、时间戳）和填充结果。进程内部的 `VaultService.reveal()` 仅供填充逻辑使用，不是工具也不是 HTTP 端点。

## 2. 快速上手

```bash
jary vault add --name "GitHub 工作账号" --origin https://github.com \
  --username me@example.com --password '******'
jary vault list                 # 元数据（不含 secret）
jary vault rotate <id> --password '******'
jary vault events               # 最近 50 条 vault_events
jary vault remove <id>
```

`--password` 会进入 shell history，真实密码优先用 Secure Form。`jary vault add` 只写 `{username, password}` 形式的 secret；API Key、卡信息、oauth 项请走 HTTP 或工具。

写入 API Key、向当前页面填充、生成安全表单（`secure-form` 返回 `{token,url}`）：

```bash
BASE=http://127.0.0.1:8787
AUTH="authorization: Bearer $JARY_API_TOKEN"

curl -s -X POST "$BASE/api/vault" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"kind":"api_key","name":"Demo API","secret":{"token":"sk-..."}}'

curl -s -X POST "$BASE/api/vault/<itemId>/fill" -H "$AUTH" \
  -H 'content-type: application/json' -d '{"botId":"default","origin":"https://example.com"}'

curl -s -X POST "$BASE/api/vault/secure-form" -H "$AUTH" \
  -H 'content-type: application/json' -d '{"origin":"https://example.com","purpose":"登录 Example"}'
```

## 3. 配置与参数

### 3.1 配置项

| 项 | 默认 | 说明 |
|---|---|---|
| `vault.keyPath` | `$JARY_HOME/vault.key` | 主密钥文件；可经 profile patch 的 `@jaryn/vault` 行配置 |
| `JARY_VAULT_KEY` | 未设置 | 设置后忽略密钥文件；值直接 SHA-256 后作为 AES 密钥 |
| `vault.allowCardPayments` | `false` | 卡填表总开关；是 `vaultToolsPlugin` 的注册参数，当前 CLI 以默认参数注册，需自定义注册/插件传入，见 `packages/cli/src/index.ts` |

### 3.2 数据模型

| 字段 | 说明 |
|---|---|
| `id` | `vault_<uuid>` |
| `kind` | `login` / `card` / `api_key` / `note` / `oauth`；只有 login、api_key 可被 `vault.fill` 填充 |
| `name`, `origin`, `username` | 明文元数据；`origin` 用于填充时的 host 校验 |
| `secret_enc` | 加密后的 JSON；login 用 `{username,password}`，api_key 可用 `{token}`，card 用 `{number,expiry,holder,cvc?}` |
| `scope`, `grants_only` | 默认 `global`；`grants_only=1` 表示只允许被 grant 的 Bot |
| `vault_grants` | `(item_id, bot_id)`；`bot_id='*'` 表示任意 Bot |
| `vault_events` | 审计行：ts/actor/bot_id/item_id/action/origin/result |
| `secure_forms` | `token, origin, purpose, kind, expires_at, used` |

### 3.3 工具

| 工具 | risk | 说明 |
|---|---|---|
| `vault.list` | read | 列出元数据，可按 scope 过滤 |
| `vault.fill` | external | 填充 login/api_key；默认每次走审批 |
| `vault.secure_form` | write | 生成一次性表单链接 |
| `vault.fill_card` | destructive | 卡填表；默认禁用，需 `allowCardPayments` |
| `vault.rotate` | write | 用新 secret 替换旧密文 |
| `vault.grant` | write | 授权 Bot；`revoke:true` 撤销 |
| `vault.remove` | write | 删除项 |

### 3.4 HTTP 端点

| 方法/路径 | 说明 |
|---|---|
| `GET /api/vault` | 列表，仅元数据 |
| `POST /api/vault` | 新增；body 需 `name`、`secret`，可选 `kind/origin/username` |
| `DELETE /api/vault/<id>` | 删除 |
| `POST /api/vault/<id>/fill` | 填充；body `{botId?, origin?}`，需要 computer 挂载 |
| `POST /api/vault/secure-form` | 生成表单；body `{origin,purpose,kind?}` |
| `GET/POST /secure/<token>` | 表单页面与提交；不走 Bearer 鉴权，token 即凭据 |

grant、revoke、rotate、events 没有 HTTP 路由；分别用工具、CLI（rotate/events）或自定义插件。

## 4. 常见任务

### 4.1 保存 API Key 为页面填充项

`POST /api/vault` 写入 `kind:"api_key"`、`secret.token`，之后再 `POST /api/vault/<id>/fill`。填充逻辑优先取 `secret.password`，其次 `secret.token`。若目标是 REST API 调用而不是网页表单，应使用连接器的 `auth.env`/OAuth 配置（见 [连接器与邮箱](connectors-email.md)）。

### 4.2 首次登录用 Secure Form

Bot 需要登录但 Vault 无记录时，调用 `vault.secure_form` 或 `POST /api/vault/secure-form`，把返回的相对 URL 拼上服务地址发给用户。用户在 `/secure/<token>` 输入 username/password，提交后直接入库；token 10 分钟过期且只能使用一次，模型全程看不到值。

### 4.3 限制某凭据只给指定 Bot

用 `vault.grant {id, botId}` 授权。注意语义：授权前所有 Bot 都可用；任意一次 grant 后该项永久进入锁定状态，之后只有被 grant 的 Bot（或 `*`）能填充；`vault.grant {revoke:true}` 只删除对应 grant，不会解除锁定（见 `packages/vault/src/store.ts` 的 `canUse`）。

### 4.4 轮换与审计

```bash
jary vault rotate <id> --password 'new-secret'
jary vault events
```

轮换只更新密文，不改变授权关系；`vault_events` 记录操作者和结果，不记录 secret 值。当 item 配置了 origin 时，`vault.fill` 的 origin 不匹配会先记一条 `denied` 事件再抛错。

### 4.5 1Password / Bitwarden / TOTP

```json
[
  { "id": "onePassword", "name": "@jaryn/secrets/onePassword",
    "config": { "references": { "github": "op://Private/GitHub/password" } } },
  { "id": "bitwarden", "name": "@jaryn/secrets/bitwarden",
    "config": { "sessionEnv": "BW_SESSION" } }
]
```

服务通过 `ctx.get('onePassword')` / `ctx.get('bitwarden')` 提供 `read(name)` 与 `fill(name, client)`，值不落 jaryn 库；1Password 需本机 `op` 已登录，Bitwarden 需 `bw` 已解锁并设置对应 session 环境变量。TOTP 以 `totp(secret)` 函数导出（SHA-1、6 位、30 秒），v1.10.0 没有内置 TOTP 工具；需要在自定义工具里调用，见 `packages/secrets/src/index.ts`。

### 4.6 卡信息填表

只有显式启用 `allowCardPayments` 后 `vault.fill_card` 才可用。每次调用都是 `destructive` 风险，默认必须审批；填充字段取 card 项 secret 的 `number/expiry/cvc/holder`。卡号等值进入页面 DOM，但不回传模型；CVV 不属于默认存储内容。真实支付网关、扣款、对账、虚拟卡发卡均不在范围内。

## 5. 安全边界与限制

- **密钥丢失即不可恢复。** 没有恢复码、没有主密钥轮换、没有 OS Keyring/Argon2：`JARY_VAULT_KEY` 或 `vault.key` 丢失后，已有密文无法解密。备份时必须同时备份数据库与 `vault.key`。
- **静态加密不等于磁盘安全。** 密钥文件位于 `$JARY_HOME`（生产通常挂载为 `/data`），权限 0600；请依赖主机磁盘加密与目录权限，共享主机上应严格控制数据目录访问。
- **盲填的边界是"不经过模型上下文/工具参数/日志"。** 值会写入目标页面 DOM，页面自身及页面脚本本就能读到；origin 校验只比较 host，且 item 未设 `origin` 时不校验。填充使用启发式选择器（`input[type=password]`、email/user/text），自定义登录 UI 可能返回 `filled: []`。
- **审批不是 Vault 内建的一次性授权。** `vault.fill` 是 external 风险，是否弹审批由审批规则决定（默认 ask）；没有"本会话允许"的 Vault 级授权。
- **授权只在填充时校验。** `reveal()` 不做 Bot 校验；`vault.fill_card` 会显式检查 `canUse`，`vault.fill` 同样检查。删除项后 grant 行可能残留，但 item 已不存在，无法使用。
- **Secure Form 是能力链接。** 路由本身不校验 Bearer，token 泄露即等于一次性填写权；默认 10 分钟、一次使用，表单只采集 username/password。
- **没有实现的能力：** `${secret:name}` 工具参数替换、导入导出（1Password/Bitwarden/KeePass CSV）、Vault 管理 Web 面板、SSH key 注入、TOTP 自动填表、卡支付网关。
- **进程内存风险。** secret 解密后在 Node 进程内以字符串存在，没有 mlock/零化保证；同一进程内被攻破的插件可读取。

## 6. 相关文档

- [安全边界](../operations/security.md)
- [部署与数据目录](../operations/deployment.md)
- [工具参考](../reference/tools.md)
- [HTTP API 参考](../reference/http-api.md)
- [配置参考](../reference/configuration.md)
- [连接器与邮箱](connectors-email.md)
- [概念与设计](../concepts.md)
