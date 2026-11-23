# jaryn-bot v1.6.0 — 桌面客户端（GitHub Actions 打包）

## 新增

- **Electron 桌面客户端**（`desktop/`）：瘦客户端，指向你的 `jary serve`
  - 首次启动填服务器地址（+ 可选 `JARY_API_TOKEN`），配置存 userData（0600）
  - 菜单：重新连接 / 更改服务器 / 打开仓库
  - 导航守卫：只允许停留在当前服务器域；外链走系统浏览器
- **GitHub Actions 打包**（不需要本地工具链）
  - `desktop.yml`：tag 或手动触发 → Windows NSIS + Linux AppImage/deb，tag 自动附到 Release
  - `desktop-macos.yml`：macOS dmg 单独工作流（runner 不在所有 plan 可用）
  - `ci.yml`：link workspaces → `npm test` → docs/deploy/desktop 校验
- **已构建产物（Actions run 45175719792）**
  - `jaryn Setup 1.6.0.exe` 78MB（PE32 GUI / NSIS）
  - `jaryn-1.6.0.AppImage` 103MB（ELF x86-64 + squashfs）
  - `jaryn-desktop_1.6.0_amd64.deb` 71MB（control: 1.6.0 / maintainer / homepage；payload 105 项含 app.asar）

## 使用

```bash
# 服务器
jary serve --port 8787
# 客户端：安装后填 http://<server>:8787（需要 token 时一并填）
```

## 未做

- 代码签名/公证（macOS 需 Apple Developer ID，Windows 需代码签名证书）
- 原生 iOS/Android（PWA 可加主屏；原生需独立工程与商店签名）
- WebRTC（现用 CDP screencast + MJPEG）
- 真实支付网关
- Gmail/Calendar 官方 OAuth 应用（需自建应用；刷新流程已实现）
- 真实模型评测 / Docker 实测（需外部条件）
