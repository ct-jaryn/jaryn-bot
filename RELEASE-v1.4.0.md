# jaryn-bot v1.4.0 — 收尾剩余 🟡 项

把审计里剩下的"可做但没做"补完。

## 新增

- `skill.load`：按名加载 `SKILL.md`（配合技能目录注入，形成闭环）
- 审批 `always` 持久授权：可跨重启记住"这个工具永远允许"
- Web 命令 API：`POST /api/sessions/:id/command`，支持 `/status`、`/compact`
- Initiative 定时扫描：`scanEveryMs` 配置，自动产生提议
- 产物保留期清理：`artifactToolsPlugin({ retentionDays })` 每 6 小时清理
- `bot remove --purge`：连同 workspace 一起删除
- 测试串行化，125 个测试稳定通过

## 验证

```bash
npm test && npm run check
jary version   # 1.4.0
jary doctor    # 43 plugins
```

## 仍未做

- WebRTC 低延迟串流（当前 CDP screencast）
- 桌面壳/原生 App（PWA 可用，设计暂缓）
- 真实支付网关（仅卡信息填表）
- 官方 Gmail/Calendar OAuth 应用（需自建应用，示例+回调就绪）
- 真实模型评测 / Docker 实测（需 `DEEPSEEK_API_KEY` / 本机 docker）
- 团队协作 / 会议 / 企业管控 / 语音 / 多租户（明确不做）
