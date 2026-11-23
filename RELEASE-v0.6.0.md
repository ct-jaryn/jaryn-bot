# jaryn-bot v0.6.0 — 实时看屏 / 接管 / 本机出网

## 新增

- **实时看屏**：`GET /api/computer/screen?botId&fps=2` SSE 流；Web UI "看屏" 面板每帧更新
- **接管**：`POST /api/computer/takeover {botId, enabled}`；接管期间 Bot 的 `browser.*` 动作被拒绝（暂停），交还后恢复
- **输入**：`POST /api/computer/input` 支持 click(x,y) / type(text) / key；UI 点画面即点击、输入框发送文本
- **本机出网隧道**：客户端 `jary tunnel --url ws://server:8787/tunnel` 主动连服务器；服务器本地起 HTTP 代理（含 CONNECT），浏览器流量经客户端家宽/公司网出去
- 隧道连接后，新启动的云电脑自动加 `--proxy-server` 使用隧道

## 使用

```bash
# 有家宽/公司网的机器
jary tunnel --url ws://<server>:8787/tunnel

# 服务器：看屏/接管
curl -N localhost:8787/api/computer/screen?botId=default
curl -X POST localhost:8787/api/computer/takeover -d '{"botId":"default","enabled":true}'
```

## 已知限制

- 看屏是 JPEG/PNG 帧轮询（2–10fps），不是 WebRTC 低延迟串流
- 接管状态不持久化（重启后恢复为未接管）
- 隧道为单客户端、无鉴权（依赖本机反代与网络边界）
- 桌面 GUI（Xvfb）未实现
