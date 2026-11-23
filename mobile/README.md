# jaryn 移动客户端（Android）

瘦客户端：WebView 包一层，指向你的 `jary serve`。iOS 需要 macOS 构建与签名，未提供。

## 功能

- 首次启动填服务器地址（保存到 SharedPreferences）
- 返回键优先在网页内后退
- 全部逻辑在服务端；本 App 不存会话、不跑模型

## 构建（GitHub Actions）

`.github/workflows/mobile-android.yml`：ubuntu + JDK 17 + Gradle → `assembleDebug` → 上传 APK；打 `v*` tag 时自动附到 Release。

本地需要 Android SDK 才能构建；本项目只提供源码与 CI 构建。

## 安装

下载 Release 里的 `app-debug.apk`，允许"未知来源"安装。**debug 包未签名发布版**，仅自用；
上架商店需要签名 keystore、release 构建与隐私政策。

## 限制

- 仅 Android；iOS 需 macOS + Xcode + Apple 签名，未做
- 明文 HTTP 允许（自托管内网常见）；公网请配 HTTPS 反代
