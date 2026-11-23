# jaryn-bot v1.5.1 — MJPEG 看屏

## 新增

- `GET /api/computer/mjpeg`：`multipart/x-mixed-replace` 原生视频流，首帧立即发送（不会等待首帧才响应）
- Web UI 看屏改为 MJPEG（`<img src>` 原生渲染，浏览器自己解码，延迟低于 SSE + base64）
- 128 个测试（含真实 Chrome MJPEG 端到端）

## 仍未做

- 真 WebRTC（当前 screencast/MJPEG 已够日常看屏）
- 桌面壳/原生 App、真实支付网关、官方 Gmail/Calendar 应用
- 真实模型评测 / Docker 实测（需外部条件）
- 团队/会议/企业/语音/多租户（明确不做）
