import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { startWebServer } from '../src/index.ts'

test('session command endpoint handles /status and unknown commands', async () => {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', { register: () => () => {}, list: () => [1, 2], get: () => undefined, execute: async () => undefined } as any)
  ctx.provide('llm', new FakeProvider([]))
  await ctx.mount(agentPlugin())
  store.createSession('web', 'default', '/tmp')
  store.recordUsage({ sessionId: 'web', inputTokens: 10, outputTokens: 5, costUsd: 0.001 })
  const server = await startWebServer(ctx, { port: 0 })
  try {
    const status = await (await fetch(`${server.url}/api/sessions/web/command`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: '/status' }),
    })).json()
    assert.equal(status.session.id, 'web')
    assert.equal(status.usage.inputTokens, 10)
    assert.equal(status.tools, 2)
    const bad = await (await fetch(`${server.url}/api/sessions/web/command`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: '/nope' }),
    }))
    assert.equal(bad.status, 400)
  } finally { await server.close(); await ctx.dispose() }
})
