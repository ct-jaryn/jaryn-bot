# jaryn 桌面客户端

把自托管的 Web UI 包成原生窗口（Electron），支持 macOS / Windows / Linux。

## 功能

- 首次启动输入服务器地址（+ 可选 `JARY_API_TOKEN`），保存在用户目录（0600）
- 菜单可"重新连接 / 更改服务器"
- 外链用系统浏览器打开；禁止导航到非当前服务器地址
- 本地无 Node/终端依赖，所有逻辑都在服务端

## 本地开发

```bash
cd desktop
npm install
npm start          # 需要先跑 jary serve
```

## 打包

打包在 GitHub Actions 上完成（`.github/workflows/desktop.yml`），不需要本地安装工具链：

- 手动触发：Actions → desktop → Run workflow
- 打 tag（`v*`）时自动构建并把安装包附到 Release

产物（矩阵：macOS arm64/x64、Windows x64、Linux AppImage/deb）：

| 平台 | 文件 |
|---|---|
| macOS | `jaryn-*-arm64.dmg`、`jaryn-*-x64.dmg` |
| Windows | `jaryn-Setup-*.exe` |
| Linux | `jaryn-*.AppImage`、`jaryn_*.deb` |

> 未签名/未公证：首次打开 macOS 需右键"打开"，Windows 可能有 SmartScreen 提示。要签名需在仓库配置 Apple/Windows 证书 secrets。

## 客户端不做什么

- 不内置服务端、不本地跑模型（这是瘦客户端）
- 不缓存会话数据（除了窗口状态）
