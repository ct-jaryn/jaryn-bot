import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { notificationsPlugin } from '@jaryn/notifications'
import { startWebServer } from '../src/index.ts'

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
