# 16 · 移动客户端（Android）

> 状态：**现行**（v1.7.0）。和桌面客户端同思路：瘦 WebView 壳，指向你的 `jary serve`。

## 结构

```
mobile/android/
├─ settings.gradle.kts / build.gradle.kts / gradle.properties
├─ app/build.gradle.kts              # compileSdk 34 / minSdk 26 / Kotlin 1.9
└─ app/src/main/
   ├─ AndroidManifest.xml            # INTERNET + cleartext（自托管内网）
   ├─ java/com/jaryn/bot/MainActivity.kt   # WebView + 服务器地址设置
   └─ res/values/strings.xml
```

功能：首次启动输入服务器地址（SharedPreferences 保存）、返回键优先网页后退、JS/DOM storage 开启。

## 构建（GitHub Actions）

`.github/workflows/mobile-android.yml`：ubuntu + JDK 17 + Gradle 8.7 → `assembleDebug` → 上传 APK；`v*` tag 时自动附到 Release。

**已构建产物（Actions run 45177562407）**：`app-debug.apk` 3.1 MB，zip 内 426 项，含 `classes.dex`、`resources.arsc`、`AndroidManifest.xml`。

## 安装

下载 Release 中的 `app-debug.apk` → 允许"未知来源"安装。

## 限制

- 仅 Android；**iOS 未做**（需 macOS + Xcode + Apple 签名，GitHub 的 macOS runner 也不可用）
- debug 包未做 release 签名，仅适合自用；上架需 keystore、release 构建与隐私政策
- 允许明文 HTTP（内网自托管常见）；公网请用 HTTPS 反代
