# Security Policy

## 报告漏洞

请**不要**在公开 issue 中披露安全问题。使用 GitHub 的私密漏洞报告（Security → Advisories → Report a vulnerability），或在仓库主页找到作者联系方式私信。

请提供：影响版本、复现步骤、影响面（能否读取凭据/越权执行/逃逸容器）、建议修复方向。

## 范围

- 鉴权与设备配对；
- Vault 与凭据填充路径（模型/日志/截图泄漏）；
- 容器/沙箱逃逸、跨 Bot 数据访问；
- 提示注入导致未授权 external 动作；
- SSRF、路径穿越、命令注入。

## 承诺

- 48 小时内确认收到；
- 修复前不公开细节；
- 修复后经你同意在 CHANGELOG 中致谢。
