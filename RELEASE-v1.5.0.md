# jaryn-bot v1.5.0 — 录屏教学 / 设备令牌与 SSE

## 新增

- **操作录制**：`computer.startRecording` 记录 `goto/click/type/key` 步骤，`stopRecording` 返回步骤与时长
- **teach.record_start / teach.record_stop**：录完直接生成 `SKILL.md` 草稿，配合 `teach.save` 落盘，`skill.load` 加载
- **SSE 设备令牌**：EventSource 不能设置 header，支持 `/api/stream?token=<device token>`（也支持 `JARY_API_TOKEN`）
- 127 个测试

## 验证

```bash
npm test && npm run check
jary version   # 1.5.0
```

## 仍未做（外部条件 / 明确不做）

- WebRTC 低延迟串流（现用 CDP screencast）
- 桌面壳/原生 App（PWA 可用，设计暂缓）
- 真实支付网关（仅卡信息填表）
- 官方 Gmail/Calendar OAuth 应用（需自建应用；示例+回调就绪）
- 真实模型评测（需 `DEEPSEEK_API_KEY`）、Docker 实测（需 docker）
- 团队 / 会议 / 企业管控 / 语音 / 多租户（明确不做）
