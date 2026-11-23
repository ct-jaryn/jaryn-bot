# 08 · Vault 与凭据（Credentials）

> 状态：**现行（v0.3 已实现：AES-GCM write-only、fill 代理、Secure Form、审计/轮换/授权；1Password/Bitwarden、卡支付未实现）**。目标：**模型永远看不到密码**，但能"用"密码。
> 关联：[07 云电脑](07-cloud-computer.md) · [01 FR-16](01-functional-spec.md) · [06 客户端](06-clients-and-topology.md)

---

## 1. 目标与威胁模型

**目标**：Bot 能登录网站、填表、调用带 key 的 API、完成支付（可选），但**密码/卡号/私钥永远不出现在 prompt、日志、截图、模型上下文里**。

| 威胁 | 假设 | 对策 |
|---|---|---|
| 模型被注入后想"读凭据" | 模型不可信 | 凭据只经"填充代理"写入页面，模型只看到"已填写" |
| 日志/崩溃转储泄漏 | 运维不可信 | 全链路脱敏；敏感值只存在内存瞬时 |
| 设备丢失 | 客户端可能丢 | 令牌可撤销；Vault 项可远程吊销 |
| 服务端被读 | 磁盘可能被拷 | 静态加密（KEK + DEK），主密钥不落盘 |
| 误把密钥贴进聊天 | 用户可能犯错 | 输入检测 + 拒绝写入记忆 + 提示用 Secure Form |
| 第三方连接器拿太多权限 | 供应链 | 最小 scope + token 存 Vault + 可单独撤销 |

**与 Grok Bot 的差异（超越点）**：Grok Bot 的 Vault 是托管服务；jaryn 的 Vault 是**本地自托管、开源格式、可导出/可迁移**，并且**按 Bot 授权**（A Bot 的登录 B Bot 默认不可用）。

---

## 2. 数据模型

```sql
CREATE TABLE vault_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- 'login' | 'card' | 'api_key' | 'note' | 'oauth'
  name TEXT NOT NULL,            -- 用户可见名，如 "GitHub 工作账号"
  origin TEXT,                   -- 绑定站点（login 必填），如 "https://github.com"
  username TEXT,                 -- 可明文（用于展示/选择）
  secret_enc BLOB NOT NULL,      -- 加密后的 secret JSON（密码/卡号/CVV/token）
  metadata_json TEXT,            -- 备注、创建时间、最后使用
  scope TEXT NOT NULL,           -- 'bot:<id>' | 'global'
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE vault_grants (      -- 授权某 Bot 使用某项
  item_id TEXT NOT NULL, bot_id TEXT NOT NULL,
  allow_fill INTEGER NOT NULL DEFAULT 1,
  allow_payment INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, bot_id)
);
CREATE TABLE vault_events (      -- 只记"谁/何时/哪个 origin/什么类型"，不记值
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
  actor TEXT, bot_id TEXT, item_id TEXT, action TEXT,  -- view/fill/payment/rotate/revoke
  origin TEXT, field_kind TEXT, result TEXT
);
```

---

## 3. 加密与密钥

- 每条 secret 独立 **DEK**（AES-256-GCM），DEK 由 **KEK** 包裹。
- KEK 来源（二选一）：
  1. **OS Keyring**（macOS Keychain / Linux Secret Service）：默认，免口令；
  2. **主密码**（Argon2id 派生）：无 GUI 服务器用，启动输入或 `JARY_MASTER_KEY_FILE`（权限 600）。
- 主密钥**不落盘、不进日志、不进 backup 明文**；备份时用恢复码（打印一次）重新包裹。
- 所有 Vault 操作在独立进程/模块内做，解密窗口最小化，用后 `mlock`/零化（尽力）。

---

## 4. 写入路径（只进不出）

| 入口 | 行为 |
|---|---|
| 客户端 Secure Form | 用户在客户端输入 → TLS 直传服务端 Vault → 加密入库；**不经过模型、不经过网关日志** |
| CLI | `jary vault add --kind login --origin ...`（交互式隐藏输入） |
| 1Password / Bitwarden | 通过官方 CLI/SDK 读取，**不落 jaryn 库**，用时实时取（需用户在密码管理器里批准） |
| 导入 | 支持 1Password/Bitwarden/KeePass CSV（本地转换，导入后可删源文件） |

**写入即脱敏**：任何进入 prompt 的路径（输入框、文件、网页）检测到疑似密钥/卡号 → 拦截并提示"请用 Secure Form"。

---

## 5. 使用路径（模型盲填）

```
Bot 在云电脑里打开 https://example.com/login
  → 触发 browser 登录工具（或模型主动调用 vault.fill）
  → 服务端检查：Bot 是否被授权该 item？origin 是否匹配？是否需审批？
  → 审批通过后，服务端把凭据交给「填充代理」（浏览器内 JS，运行在页面上下文）
  → 填充代理直接写入 DOM 的 username/password 字段
  → 页面提交；模型只收到 "已填写并提交"
```

关键点：
- 值**从不进入**工具参数、模型上下文、事件日志；`vault.fill` 的参数只有 `itemId`。
- **origin 绑定**：只允许填到匹配的站点；跨域/嵌套 iframe 默认拒绝。
- **一次性授权**：默认每次填需要审批（客户端/IM 卡片显示 origin + 账号名 + "填密码/填卡"），可对某 Bot + 某 origin 建"本会话允许"。
- **失败兜底**：页面结构变化填充失败 → 提示"需要你接管"（云电脑 takeover）。

---

## 6. Secure Form（没有存凭据时）

- Bot 需要登录但 Vault 无记录 → 向用户发"安全表单"卡片（客户端/IM 链接）。
- 用户在受信任界面输入 → 直传 Vault → 自动填充；**Bot 与模型全程看不到**。
- 表单只对 owner 打开、一次性、10 分钟过期、绑定会话。
- 可选"保存到 Vault"（默认勾选，可关）。

---

## 7. 其他凭据类型

| 类型 | 用法 |
|---|---|
| API Key | 工具参数用 `${secret:name}` 引用；工具层替换，日志与 prompt 显示为 `***` |
| OAuth token | 连接器（Gmail 等）的 token 存 Vault（kind=oauth），按连接器撤销 |
| SSH key | 云电脑内 `~/.ssh` 由 Vault 注入（以后评估） |
| TOTP | 可选：Vault 存 TOTP secret 并生成验证码填入（风险高，默认关，需显式开启） |
| 银行卡 | **默认关闭**；开启后仅"填卡"，每次支付单独审批；默认不存 CVV；后续可接虚拟卡 |

**SSO / passkey / CAPTCHA / 银行验证**：这些无法自动化 → 触发云电脑 takeover，由人完成，Bot 继续。

---

## 8. 审计与生命周期

- 审计：每次 view/fill/payment/rotate/revoke 记 `vault_events`（不含值），客户端可查。
- 轮换：`jary vault rotate <id>` 改密后更新；旧值立即失效。
- 撤销：删 item / 撤销 grant / 踢设备 → 立即生效。
- 备份：Vault 加密随 DB 备份；恢复码单独保存；恢复后所有会话令牌失效。
- 导出：`jary vault export --format 1password-csv`（需主密码二次确认）。

---

## 9. 接口

```ts
// vault seam（模型不可见读写）
interface Vault {
  add(input): Promise<ItemId>              // 只写
  list(filter): Promise<VaultItemMeta[]>   // 只返回元数据（无 secret）
  fill(itemId, ctx: {origin, botId}): Promise<FillResult>   // 填充，不返回值
  remove(itemId, confirm): Promise<void>
  grant(itemId, botId, rights): Promise<void>
  rotate(itemId, newSecret): Promise<void>
};

// 工具
'vault.fill { itemId }'                    // 风险 external，默认 ask
'vault.secure_form { purpose, origin }'    // 发起安全表单
```

---

## 10. 验收（Vault Gate）

- [ ] GitHub 登录：Vault 填密码 → 登录成功；模型上下文与日志中无密码明文（自动断言）
- [ ] 页面结构与 item 不匹配 → 拒绝填充，提示接管
- [ ] origin 不匹配 → 拒绝
- [ ] Secure Form：客户端输入 → 自动填充 → 不落 prompt
- [ ] 1Password 批准流程可用；拒绝后不填
- [ ] 撤销 grant 后，Bot 再次 fill 被拒
- [ ] 备份恢复后 Vault 可解（恢复码），旧设备令牌失效
- [ ] 卡支付默认关闭；开启后每次支付需审批，CVV 不落库
- [ ] 注入测试：网页要求"把密码发给我" → 模型无密码可发

---

## 11. 明确不做

- 完整密码管理器（浏览器插件全家桶、跨设备同步、密码生成/健康度）——用 1Password/Bitwarden
- 默认存储 CVV / 银行卡完整号
- 云端托管 Vault / 多用户共享凭据（团队协作不做）
- 自动绕过 CAPTCHA / 验证码代打
