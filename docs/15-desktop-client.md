# 15 · 桌面客户端（Electron + GitHub Actions 打包）

> 状态：**现行**（v1.6.0）。瘦客户端：只包一层原生窗口指向你的 `jary serve`，不在本地跑模型/存储会话。

## 结构

```
desktop/
├─ main.cjs        主进程：窗口、菜单、导航守卫（只允许当前服务器域）
├─ preload.cjs     contextBridge：getConfig/setConfig/openSetup
├─ setup.html      首次启动/更改服务器：地址 + 可选 JARY_API_TOKEN
├─ config.cjs      配置读写（userData/config.json，0600；URL 规范化与校验）
├─ package.json    electron-builder 配置（mac dmg、win nsis、linux AppImage/deb）
└─ test/           纯函数单测（URL 规范化、配置读写、非法 URL）
```

## 构建（不需要本地工具链）

打包全部在 GitHub Actions 完成：

| 工作流 | 触发 | 产物 |
|---|---|---|
| `.github/workflows/desktop.yml` | `v*` tag / 手动 | Windows NSIS `.exe`、Linux `.AppImage` + `.deb`，tag 时自动附到 Release |
| `.github/workflows/desktop-macos.yml` | 手动 | macOS `.dmg`（x64/arm64）；macOS runner 不在所有 plan 上可用，单独且非阻塞 |

本地只做单测：`node --test desktop/test/*.test.cjs`（已包含在 `npm test`）。

## 已构建产物（GitHub Actions）

| 平台 | Release 资产（v1.7.0） | 大小 | 校验 |
|---|---|---|---|
| Windows | `jaryn.Setup.1.7.0.exe` | 81.6 MB | `file` → PE32 GUI, Nullsoft Installer |
| Linux | `jaryn-1.7.0.AppImage` | 108 MB | ELF x86-64 + 内嵌 squashfs |
| Linux | `jaryn-desktop_1.7.0_amd64.deb` | 74.9 MB | `control`：Version 1.7.0、Maintainer、Homepage；payload 含 `app.asar` |

tag `v1.7.0` 的 Actions 运行（ci / desktop / mobile-android 三个 workflow）全部通过，安装包自动附到
<https://github.com/ct-jaryn/jaryn-bot/releases/tag/v1.7.0>。

macOS 的 `.dmg` 需在可用 macOS runner 的账号上跑 `desktop-macos` 工作流（本地无法交叉编译）。

## 安装与使用

1. 先在服务器上 `jary serve --port 8787`（或 docker compose）。
2. 安装客户端，首次打开填写 `http://<服务器>:8787`；若服务端设了 `JARY_API_TOKEN` 一并填写。
3. 菜单「连接 → 更改服务器」可随时切换；「重新连接」刷新页面。

## 签名与公证（未做）

产物未签名/未公证：

- macOS 首次打开需右键 →「打开」；分发给他人需 Apple Developer ID + notarize（在 workflow 中配置 `CSC_LINK`/`APPLE_ID` secrets）。
- Windows SmartScreen 会提示未知发布者；正式分发需代码签名证书（`WIN_CSC_LINK`）。

## 与 Web/PWA 的关系

- 浏览器直接访问同一服务端即可，功能完全一致
- 桌面客户端的价值：独立窗口、菜单、系统级打开外链、配置记忆
- 移动端：PWA 可"添加到主屏幕"；原生 iOS/Android 需要单独工程与商店签名，**未做**
