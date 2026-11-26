import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { notificationsPlugin } from '@jaryn/notifications'
import { startWebServer } from '../src/index.ts'
import { formatWebhookPayload } from '../../../examples/webhook-notifier/notify-bridge.ts'

test('notifications API lists, reads and counts', async () => {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', { register: () => () => {}, list: () => [], get: () => undefined, execute: async () => undefined } as any)
  ctx.provide('llm', new FakeProvider([]))
  await ctx.mount(agentPlugin())
  await ctx.mount(notificationsPlugin())
  const server = await startWebServer(ctx, { port: 0 })
  try {
    const notifications = ctx.get<any>('notifications')
    notifications.notify({ kind: 'job', title: '例程完成' })
    const list = await (await fetch(`${server.url}/api/notifications`)).json()
    assert.equal(list.notifications.length, 1)
    assert.equal(list.unread, 1)
    await fetch(`${server.url}/api/notifications/${list.notifications[0].id}/read`, { method: 'POST' })
    const after = await (await fetch(`${server.url}/api/notifications?unread=1`)).json()
    assert.equal(after.notifications.length, 0)
    const all = await (await fetch(`${server.url}/api/notifications/read-all`, { method: 'POST' })).json()
    assert.equal(all.marked, 0)
  } finally { await server.close(); await ctx.dispose() }
})

test('wildcard /api/stream receives session approval events for external bridges', async () => {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', { register: () => () => {}, list: () => [], get: () => undefined, execute: async () => undefined } as any)
  ctx.provide('llm', new FakeProvider([]))
  await ctx.mount(agentPlugin())
  const server = await startWebServer(ctx, { port: 0 })
  try {
    const sseRes = await fetch(`${server.url}/api/stream`)
    assert.equal(sseRes.status, 200)
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    // Read initial hello frame.
    await reader.read()

    const channel = ctx.get<any>('approvalChannel')
    const pendingPromise = channel.request({
      id: 'ap_wildcard_1',
      sessionId: 's_other',
      turnId: 't1',
      toolName: 'email.send',
      risk: 'external',
      args: { to: 'ops@example.com' },
    })

    const { value } = await reader.read()
    const chunk = decoder.decode(value)
    assert.match(chunk, /"type":"approval"/)
    assert.match(chunk, /ap_wildcard_1/)

    ctx.get<any>('pendingApprovals').resolve('ap_wildcard_1', 'denied')
    assert.equal(await pendingPromise, 'denied')
    await reader.cancel()
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('formatWebhookPayload adapts Feishu, WeCom and Slack payloads', () => {
  const feishu = formatWebhookPayload('https://open.feishu.cn/open-apis/bot/v2/hook/abc', '待审批', '详情') as any
  assert.equal(feishu.msg_type, 'text')
  assert.match(feishu.content.text, /待审批/)

  const wecom = formatWebhookPayload('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', '通知', '内容') as any
  assert.equal(wecom.msgtype, 'text')
  assert.match(wecom.text.content, /通知/)

  const slack = formatWebhookPayload('https://hooks.slack.com/services/T/B/X', 'Alert', 'Body') as any
  assert.match(slack.text, /Alert/)
})
