# jaryn-bot v1.9.1 — 文档边界澄清：支付网关永久不做

本次只有文档变更，没有功能改动。

## 明确不做（Won't）

新增唯一权威清单 [docs/17-scope-and-wont.md](docs/17-scope-and-wont.md)：

- **真实支付网关 / 结算**：不接 Stripe/PayPal、不发起扣款、不做对账、不存 CVV。Vault 只做"把已存卡号填进结账页"，默认关闭、每次 `destructive` 审批、值不进入模型/日志/截图
- IM 通知通道、团队协作、会议、企业管控、语音、SaaS 计费/多租户、原生 iOS、真 WebRTC

## 同步更新的文档

- `README.md`：已交付能力表、不做清单、版本历史 v0.1→v1.9、测试数 162、英文摘要状态
- `docs/00-prd.md`：R-25 改为 "Won't（永久不做）"，状态表改为已发布 + 不做
- `docs/01-functional-spec.md`：Vault"支付"行改为"卡填表"，范围外语义修正
- `docs/03-roadmap.md`：待定包池逐项标记已完成 / 不做
- `docs/08-vault-and-credentials.md`：状态行与银行卡条目明确"不接网关、不做结算"
- `docs/09-connectors-and-artifacts.md`：支付类连接器标注明确不做
- `docs/11-parity-and-beyond.md`、`docs/12-decision-register.md`（D-24 已定不做）、`docs/14-completion-audit.md`

## 验证

```bash
npm test        # 162 passed（无功能改动）
npm run check   # docs 31 files / deploy 44 plugins / desktop / eval
jary version    # 1.9.1
```
