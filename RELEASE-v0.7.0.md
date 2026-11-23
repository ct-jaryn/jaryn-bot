# jaryn-bot v0.7.0 — 多设备配对

## 新增

- **配对码**：`POST /api/devices/pair-code` → 6 位数字，10 分钟有效、一次性
- **设备令牌**：`POST /api/devices/pair {code,name}` → 返回 token（只显示一次，服务端存 sha256）
- **设备管理**：`GET /api/devices`、`POST /api/devices/:id/revoke`
- **CLI**：`jary device pair-code|list|revoke`
- **连接器示例**：GitHub（Bearer）、httpbin（API Key），`examples/connectors/`
- Web API 依然单 owner；设备令牌用于未来客户端/隧道鉴权，当前不强制

## 使用

```bash
jary device pair-code
# 在手机/另一台电脑上：
curl -X POST localhost:8787/api/devices/pair -d '{"code":"123456","name":"phone"}'
```

## 已知限制

- 桌面壳/原生 App 尚未提供；PWA 可安装到主屏
- 设备令牌尚未强制用于 API 鉴权（单机 loopback 部署前提）
