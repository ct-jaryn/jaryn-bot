import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { memoryPlugin } from '@jaryn/memory'
import { startWebServer } from '../src/index.ts'

async function setup() {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', { register: () => () => {}, list: () => [], get: () => undefined, execute: async () => undefined } as any)
  ctx.provide('llm', new FakeProvider([]))
  await ctx.mount(agentPlugin())
  await ctx.mount(memoryPlugin())
  store.createSession('web', 'default', '/tmp')
  const server = await startWebServer(ctx, { port: 0 })
  return { ctx, store, server }
}

const run = async (server: any, command: string) => (await fetch(`${server.url}/api/sessions/web/command`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command }),
})).json()

test('slash commands: help, remember, memory, forget, new', async () => {
  const { ctx, server } = await setup()
  try {
    const help = await run(server, '/help')
    assert.ok(help.commands.includes('/memory'))
    const remembered = await run(server, '/remember 周报用中文')
    assert.match(remembered.item.text, /周报用中文/)
    const memory = await run(server, '/memory')
    assert.ok(memory.stats.total >= 1)
    const forgotten = await run(server, '/forget 周报')
    assert.equal(forgotten.deleted, 1)
    const created = await run(server, '/new')
    assert.match(created.session.id, /^s_/)
    const unknown = await fetch(`${server.url}/api/sessions/web/command`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: '/nope' }),
    })
    assert.equal(unknown.status, 400)
  } finally { await server.close(); await ctx.dispose() }
})
