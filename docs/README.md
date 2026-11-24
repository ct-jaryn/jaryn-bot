# jaryn-bot 文档

> 适用版本：v1.11.0 · 状态：现行

面向使用者和贡献者的文档入口。按"先跑起来 → 建立概念 → 按需查"的顺序阅读；每份文档开头标注适用版本与状态（现行 / 自动生成 / 历史）。

## 五分钟上手

1. [快速开始](getting-started.md)：安装、配置模型、第一次派活、验证。
2. [核心概念](concepts.md)：会话与事件、工具与审批、Bot、云电脑、Vault。
3. 打开 Web 工作台（`jary serve` → `http://127.0.0.1:8787`），或在终端 `jary chat "帮我看看这个仓库"`。

## 使用指南

按任务组织，每份都可独立阅读。

| 文档 | 什么时候看 |
|---|---|
| [Web 工作台](guides/web-ui.md) | 界面各部分、文本命令、看屏、通知 |
| [客户端](guides/clients.md) | 桌面/Android/PWA、设备配对、`/ws/client` 协议 |
| [记忆](guides/memory.md) | 它记得什么、怎么查看/遗忘、容量与维护 |
| [主动任务](guides/proactive.md) | 例程、目标、提议、教学、通知 |
| [云电脑](guides/cloud-computer.md) | 浏览器/终端、看屏接管、快照、配额与白名单 |
| [Vault 与凭据](guides/vault.md) | 盲填、Secure Form、授权、1Password/Bitwarden、卡填表边界 |
| [连接器与邮箱](guides/connectors-email.md) | HTTP/OAuth 连接器、SMTP/IMAP、入站邮件 |
| [Pages 与产物](guides/pages-artifacts.md) | 页面、版本/回滚/分享、artifact、Office 文档 |
| [插件](guides/plugins.md) | 组合与 patch、写一个工具插件、进程外宿主 |

## 参考

| 文档 | 内容 |
|---|---|
| [CLI](reference/cli.md) | 全部命令、选项、示例 |
| [HTTP / WS API](reference/http-api.md) | 路由、鉴权、`/ws/client` 方法、SSE 格式 |
| [工具清单](reference/tools.md) | 模型可见的 74 个工具与风险等级（自动生成） |
| [配置](reference/configuration.md) | profile/patch、插件配置字段、环境变量、目录布局 |
| [事件](reference/events.md) | 事件信封、常见类型、回放与订阅 |
| [代码清单](reference/inventory.md) | 包/插件/路由/表/测试全量统计（自动生成） |

## 运维

[部署](operations/deployment.md) · [安全](operations/security.md) · [测试](operations/testing.md) · [排错](operations/troubleshooting.md)

## 设计

[架构](design/architecture.md) · [决策与边界](design/decisions.md) · [能力审计](design/audit.md)

## 约定

- **版本**：文档头部标注适用版本；API/配置以对应版本的代码为准。
- **事实优先**：命令、端点、工具清单以仓库代码和自动生成文档为准，不靠记忆。
- **边界**：不做清单与变更规则见 [决策与边界](design/decisions.md)，不在聊天里口头扩范围。
- **维护**：改代码后跑 `npm run check`（含文档链接与清单一致性校验）；改了工具/路由跑 `npm run inventory` 重新生成自动文档。

## 历史文档

旧版设计文档（PRD、路线图、对标分析、逐版本发布说明）已归档为 Git 历史；需要追溯时看 `git log -- docs/` 或对应 tag 的 GitHub Release。
