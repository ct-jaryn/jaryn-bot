# jaryn-bot v1.7.0 — Android 客户端

## 新增

- **Android 客户端**（`mobile/android/`）：Kotlin WebView 瘦客户端
  - 首次启动填服务器地址（SharedPreferences 保存）；返回键优先网页后退
  - 全部逻辑在服务端，客户端不存会话、不跑模型
- **GitHub Actions 构建**：`.github/workflows/mobile-android.yml`（JDK 17 + Gradle）→ `app-debug.apk`，tag 自动附 Release
- **实测产物**：APK 3.1 MB / 426 项，含 `classes.dex`、`resources.arsc`、`AndroidManifest.xml`
- Web：启动时从 Vault 恢复 OAuth token 到连接器（重启后 Gmail/Calendar 仍可用）

## 客户端矩阵

| 平台 | 形态 | 构建 | 状态 |
|---|---|---|---|
| Web / PWA | 浏览器 | 服务端自带 | ✅ |
| macOS | Electron dmg | `desktop-macos.yml`（需可用 macOS runner） | 工作流就绪 |
| Windows | Electron NSIS | `desktop.yml` | ✅ 78MB exe |
| Linux | Electron AppImage/deb | `desktop.yml` | ✅ 103MB / 71MB |
| Android | WebView APK | `mobile-android.yml` | ✅ 3.1MB APK |
| iOS | — | 需 macOS + Apple 签名 | 未做 |

## 仍未做

- iOS 客户端（平台限制）
- WebRTC（当前 CDP screencast + MJPEG）
- 真实支付网关（仅卡信息填表）
- 官方 Gmail/Calendar OAuth 应用（需自建应用；刷新流程已实现）
- 真实模型评测 / Docker 实测（需外部条件）
- 团队/会议/企业/语音/多租户（明确不做）
