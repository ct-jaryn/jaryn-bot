# jaryn-bot v0.3.0 — Vault

模型永远看不到密码，但 Bot 能"用"密码登录。

## 新增

- **加密存储**：AES-256-GCM，每条独立 IV；主密钥来自 `JARY_VAULT_KEY` 或 `$JARY_HOME/vault.key`（0600）
- **write-only**：`vault.list` 只返回元数据；secret 无读取接口
- **填充代理**：`vault.fill(itemId)` → 校验 origin → 在浏览器里注入账号/密码；返回 `{ok, filled}`，不含值
- **Secure Form**：一次性 token + 10 分钟过期；用户填表 → 直传 Vault → 自动保存；模型全程看不到
- **审计**：add/fill/rotate/remove/grant，记录时间/origin/结果，不记录值
- **CLI/Web**：`jary vault ...`、`/api/vault`、`/secure/:token`
- Docker 云电脑里同样适用（填充代理走 CDP）

## 快速开始

```bash
jary vault add --name GitHub --origin https://github.com --username me --password '***'
jary vault list
```

Bot 侧：

```text
[bot] browser.goto https://github.com/login
[bot] vault.fill { itemId: "vault_..." }   # 需审批
```

## 已知限制

- 1Password / Bitwarden 集成、卡支付未实现
- Secure Form 无二次验证（单 owner、本地部署前提）
- 主密钥丢失 = Vault 无法解密（请单独备份）
