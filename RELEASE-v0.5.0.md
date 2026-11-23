# jaryn-bot v0.5.0 — Initiative / teach-a-task / PWA

## 新增

- **Initiative（主动提议）**：信号 → 打分 `impact × urgency × confidence − 0.15` → 阈值 0.6 → 24h 去重 → 每 Bot 每天 ≤3 条
  - 内置扫描：失败/超预算的 job、停滞 >3 天的任务
  - 接受 → 自动建任务；拒绝 → 可"静音这类"
- **teach-a-task**：步骤 → `SKILL.md` 草稿 → 保存到 `$JARY_HOME/skills` → 列表
- **PWA**：manifest + service worker，可安装到桌面/手机主屏；API 不做离线缓存
- **API**：`/api/initiative`（list/scan/accept/dismiss）、`/api/teach`

## 试一下

```bash
# 让调度器失败几次，或让任务停滞 3 天，然后：
curl -X POST localhost:8787/api/initiative/scan
curl localhost:8787/api/initiative
curl -X POST localhost:8787/api/initiative/<id>/accept
```

## 已知限制

- 信号源目前只有 job 失败/任务停滞；邮件、日历、连接器事件未接入
- 录屏教学（浏览器操作转技能）未实现，仅手写/步骤草稿
- 桌面壳/手机原生客户端未实现（当前 PWA）
