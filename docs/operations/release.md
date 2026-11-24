# 自动打包与发布

> 适用版本：v1.12.0 · 状态：现行
> 一条流水线产出全部客户端安装包；公开仓库使用 GitHub 托管标准 runner，不产生 Actions 分钟费用。

## 1. 触发方式

| 事件 | 行为 |
|---|---|
| push tag `v*` | 校验 → 构建各平台 → 上传 QA 产物 → **创建/更新 GitHub Release**（附 `SHA256SUMS.txt`，Release notes 取自 CHANGELOG 对应版本） |
| 手动 `workflow_dispatch` | 同样构建并上传 workflow artifacts，**不**创建 Release（用于验证打包链路） |
| 每周一 03:00 UTC（schedule） | 快照构建 `0.0.0-main.<sha>`，只上传 artifacts，尽早发现打包断裂 |

工作流：`.github/workflows/release.yml`（唯一打包入口）；质量门禁在 `.github/workflows/ci.yml`。

## 2. 产物

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows | `jaryn.Setup-<version>.exe` | NSIS 安装包，未签名（SmartScreen 会提示） |
| Linux | `jaryn-<version>.AppImage`、`jaryn-desktop_<version>_amd64.deb` | AppImage + Debian 包 |
| macOS | `jaryn-<version>.dmg`、`jaryn-<version>-arm64.dmg` | x64 与 arm64；未签名/未公证 |
| Android | `jaryn-<version>-debug.apk` | debug 签名，仅自用 |
| 全部 | `SHA256SUMS.txt` | 发布/下载后校验 |

版本号来源：
- tag 构建：取 tag 去掉 `v`（`v1.12.0` → `1.12.0`），构建前写入 `desktop/package.json` 与 Android `versionName`；
- 手动/定时：`<package.json 版本>-main.<短 SHA>`。

## 3. Runner 与免费额度

公开仓库的 GitHub 托管标准 runner **免费且不计分钟**。本流水线使用：

| 标签 | 用途 | 注意 |
|---|---|---|
| `ubuntu-latest` | 校验、Linux 桌面包、Android APK、发布 | 稳定 |
| `windows-latest` | Windows NSIS | 稳定 |
| `macos-15` | macOS dmg（arm64 runner，交叉构建 x64+arm64） | 稳定；`macos-14` 在本账号返回 “configuration not supported”，`macos-13` 已下线 |

> 若仓库改为私有，Actions 分钟会计费（macOS 有倍率）。私有化时建议只保留 `ubuntu-latest` 打包 Linux/Android，桌面 Windows/macOS 用本地构建或自托管 runner。

## 4. 缓存与耗时

- 缓存 `~/.cache/electron`、`~/.cache/electron-builder`（Windows/macOS 对应目录），key 由 `desktop/package.json` 哈希决定。
- 典型耗时：校验约 30s；Linux/Windows 桌面各 2–3 分钟；macOS 2–4 分钟；Android 1–2 分钟；发布 <1 分钟。
- `concurrency` 按 ref 串行，避免同 tag 重复发布。

## 5. 签名与公证（未做）

产物未签名，正式分发需自备证书，在仓库 Secrets 配置后由 electron-builder 自动使用：

| 平台 | Secrets | 效果 |
|---|---|---|
| Windows | `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` | 消除 SmartScreen 未知发布者 |
| macOS | `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | 签名 + notarize（需 electron-builder `notarize` 配置） |
| Android | `ANDROID_KEYSTORE_BASE64` 等（需在 workflow 中加签名步骤） | release 签名，可上架 |

当前 workflow 显式设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，保证无证书时也能出包。

## 6. 本地复现

```bash
cd desktop && npm install && npm test
npx electron-builder --linux --publish never   # 或 --win / --mac
# macOS 需在 macOS 上执行；Windows NSIS 在 Linux 上需要 wine
cd ../mobile/android && gradle assembleDebug
```

## 7. 排错

| 症状 | 原因 / 处理 |
|---|---|
| macOS job 立即 cancelled，annotation 为 “configuration not supported” | 用了不可用的标签（`macos-14`）；改用 `macos-15` |
| electron-builder 报 `Please specify project homepage` / author email | `desktop/package.json` 缺少 `homepage`/`author.email`/`maintainer` |
| Release 里出现旧版本资产 | 手动删除旧资产；workflow 只追加同名文件覆盖 |
| 发布 job 报 unmatched files | 构建 job 未产出预期文件；看该平台 artifact 与日志 |
| Android 版本号未变 | 检查 `stamp version` 步骤的 `sed` 是否命中 `versionName`/`versionCode` 行 |
