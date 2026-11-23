# jaryn-bot v1.3.0 — 通知中心 / Bitwarden / 卡填充

## 新增

- **通知中心**：`notifications` 表、未读计数、`/api/notifications`（list/read/read-all）；例程完成、Initiative 提议、新邮件自动通知
- **安静时段**：`quietHours.start/end/tz`（支持跨夜），命中时通知标记 `suppressed`（仍落库，不打扰）
- **Bitwarden**：`@jaryn/secrets` 新增 `bw get item --raw` 读取 + 页面填充
- **卡填充**：Vault `kind: card` + `vault.fill_card`；**默认关闭**（`vault.allowCardPayments=true` 才可用），risk=destructive **每次审批**，值不回传模型
- **Web UI**：通知铃铛 + 通知面板（15s 轮询未读数）
- **测试串行**：`npm test` 改为 `--test-concurrency=1`，消除 Chrome 相关 flaky
- 123 个测试

## 验证

```bash
npm test        # 123 passed
npm run check   # docs + deploy + eval 结构
jary doctor     # 43 plugins
```

## 仍未做（外部条件/明确不做）

- 真实模型评测（需 `DEEPSEEK_API_KEY`）、Docker 镜像实测（需本机 docker）
- 官方 Gmail/Calendar OAuth 应用（需自建应用与审核；示例+回调已就绪）
- 桌面壳/原生 App（PWA 可用，设计暂缓）
- 真实支付结算（只做卡信息填表，不做支付网关）
- 团队协作 / 会议 / 企业管控 / 语音 / 多租户（明确不做）
