#!/usr/bin/env node
/**
 * Out-of-process Webhook notification bridge for jaryn-bot.
 *
 * Keeps the core runtime free of third-party IM SDKs (per docs/design/decisions.md)
 * while letting self-hosted owners receive instant mobile alerts (Feishu / WeCom /
 * DingTalk / Slack / Telegram / Bark / generic Webhook) when an approval card or
 * background notification arrives.
 *
 * Usage:
 *   JARY_URL=http://127.0.0.1:8787 \
 *   JARY_API_TOKEN=your-token \
 *   WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx \
 *   PUBLIC_WEB_URL=https://bot.example.com \
 *   node examples/webhook-notifier/notify-bridge.ts
 */

const JARY_URL = (process.env.JARY_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const API_TOKEN = process.env.JARY_API_TOKEN ?? ''
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? ''
const PUBLIC_WEB_URL = (process.env.PUBLIC_WEB_URL ?? JARY_URL).replace(/\/$/, '')
const POLL_MS = Math.max(5_000, Number(process.env.POLL_MS ?? 15_000))

const headers = (): Record<string, string> =>
  API_TOKEN ? { authorization: `Bearer ${API_TOKEN}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }

export function formatWebhookPayload(url: string, title: string, detail: string): Record<string, unknown> {
  const text = `【jaryn-bot】${title}\n${detail}\n处理入口：${PUBLIC_WEB_URL}`
  if (url.includes('feishu.cn') || url.includes('larksuite.com')) {
    return { msg_type: 'text', content: { text } }
  }
  if (url.includes('qyapi.weixin.qq.com')) {
    return { msgtype: 'text', text: { content: text } }
  }
  if (url.includes('oapi.dingtalk.com')) {
    return { msgtype: 'text', text: { content: text } }
  }
  if (url.includes('hooks.slack.com')) {
    return { text }
  }
  if (url.includes('discord.com/api/webhooks')) {
    return { content: text }
  }
  return { title, text, url: PUBLIC_WEB_URL, ts: Date.now() }
}

async function sendWebhook(title: string, detail: string): Promise<void> {
  const payload = formatWebhookPayload(WEBHOOK_URL, title, detail)
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    console.error(`[webhook] HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  }
}

async function watchApprovals(): Promise<void> {
  while (true) {
    try {
      let query = ''
      if (API_TOKEN) {
        const ticketRes = await fetch(`${JARY_URL}/api/stream-ticket`, { method: 'POST', headers: headers() })
        if (ticketRes.ok) {
          const { ticket } = (await ticketRes.json()) as { ticket: string }
          query = `?ticket=${encodeURIComponent(ticket)}`
        } else {
          query = `?token=${encodeURIComponent(API_TOKEN)}`
        }
      }
      const res = await fetch(`${JARY_URL}/api/stream${query}`)
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`)
      console.log(`[bridge] connected to ${JARY_URL}/api/stream`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const ev = JSON.parse(line.slice(5).trim())
          if (ev.type === 'approval' && ev.request) {
            await sendWebhook(
              `待审批高危动作：${ev.request.toolName} (${ev.request.risk})`,
              `会话：${ev.request.sessionId}\n参数：${JSON.stringify(ev.request.args).slice(0, 240)}`,
            )
          } else if (ev.type === 'question') {
            await sendWebhook(`Bot 请求确认`, `会话：${ev.sessionId ?? 'web'}\n问题：${ev.question}`)
          }
        }
      }
    } catch (err) {
      console.error(`[bridge] stream disconnected: ${(err as Error).message}; retrying in 5s`)
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }
}

const seenNotificationIds = new Set<number>()
async function pollNotifications(): Promise<void> {
  try {
    const res = await fetch(`${JARY_URL}/api/notifications?unread=1&limit=20`, { headers: headers() })
    if (!res.ok) return
    const data = (await res.json()) as { notifications?: { id: number; kind: string; title: string; body: string; suppressed: boolean }[] }
    for (const item of (data.notifications ?? []).reverse()) {
      if (seenNotificationIds.has(item.id) || item.suppressed) continue
      seenNotificationIds.add(item.id)
      await sendWebhook(`新通知 (${item.kind})：${item.title}`, item.body || '打开工作台查看详情')
    }
  } catch {
    // Retry on next interval.
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  if (!WEBHOOK_URL) {
    console.error('Missing WEBHOOK_URL. Set Feishu / WeCom / Slack / Discord / generic webhook URL.')
    process.exit(2)
  }
  setInterval(pollNotifications, POLL_MS)
  void pollNotifications()
  void watchApprovals()
}
