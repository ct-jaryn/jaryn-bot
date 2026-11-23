import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import type { Tool } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store, storePlugin } from '@jaryn/store-sqlite'
import { startWebServer } from '../src/index.ts'
import { memoryPlugin } from '@jaryn/memory'
import { schedulerPlugin } from '@jaryn/scheduler'
import { computerPlugin } from '@jaryn/computer'

async function setup(script: any[][], opts: { approvalTimeoutMs?: number } = {}) {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  const tools = new Map<string, Tool>()
  ctx.provide('tools', {
    register: (t: Tool) => { tools.set(t.name, t); return () => tools.delete(t.name) },
    list: () => [...tools.values()],
    get: (n: string) => tools.get(n),
    execute: async (n: string, a: any) => tools.get(n)!.execute(a, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' }),
  })
  ctx.provide('llm', new FakeProvider(script))
  await ctx.mount(memoryPlugin())
  tools.set('echo', {
    name: 'echo', description: 'echo', schema: { type: 'object' }, risk: 'read',
    async execute(args) { return `echo:${args.text}` },
  })
  tools.set('danger', {
    name: 'danger', description: 'danger', schema: { type: 'object' }, risk: 'execute',
    async execute() { return 'ran' },
  })
  await ctx.mount(agentPlugin())
  await ctx.mount(schedulerPlugin())
  await ctx.mount(computerPlugin())
  store.createSession('web', 'default', '/tmp')
  const server = await startWebServer(ctx, { port: 0, ...opts })
  return { ctx, store, server }
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('timeout waiting')
}

test('serves UI and chat events', async () => {
  const { ctx, store, server } = await setup([[{ type: 'text', text: 'hello web' }, { type: 'finish', reason: 'stop' }]])
  try {
    const html = await (await fetch(`${server.url}/`)).text()
    assert.match(html, /jaryn/)
    const res = await fetch(`${server.url}/api/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'web', text: 'hi' }),
    })
    assert.equal(res.status, 202)
    await waitFor(async () => store.events('web').some((e: any) => e.type === 'turn.ended'))
    const events = store.events('web')
    assert.ok(events.some((e: any) => e.type === 'assistant.message' && e.data.text === 'hello web'))
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('approval allow path executes tool', async () => {
  const { ctx, store, server } = await setup([
    [{ type: 'tool_call', call: { id: 'c1', name: 'danger', args: {} } }, { type: 'finish', reason: 'tool' }],
    [{ type: 'text', text: 'done' }, { type: 'finish', reason: 'stop' }],
  ])
  try {
    await fetch(`${server.url}/api/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'web', text: 'do it' }),
    })
    await waitFor(async () => (await (await fetch(`${server.url}/api/approvals`)).json()).approvals.length > 0)
    const { approvals } = await (await fetch(`${server.url}/api/approvals`)).json()
    const id = approvals[0].id
    const res = await fetch(`${server.url}/api/approvals/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'allowed' }),
    })
    assert.equal(res.status, 200)
    await waitFor(async () => store.events('web').some((e: any) => e.type === 'tool.result'))
    const toolResult = store.events('web').find((e: any) => e.type === 'tool.result')
    assert.equal(toolResult.data.ok, true)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('computer status API reports stopped', async () => {
  const { ctx, server } = await setup([])
  try {
    const data = await (await fetch(`${server.url}/api/computer?botId=bot-a`)).json()
    assert.equal(data.status.state, 'stopped')
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('health and metrics endpoints', async () => {
  const { ctx, server } = await setup([])
  try {
    const health = await (await fetch(`${server.url}/healthz`)).json()
    assert.equal(health.ok, true)
    assert.equal(health.checks.store, true)
    const metrics = await (await fetch(`${server.url}/metrics`)).text()
    assert.match(metrics, /jaryn_sessions_total/)
    assert.match(metrics, /jaryn_jobs_total/)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('memory API remembers and searches', async () => {
  const { ctx, server } = await setup([])
  try {
    const created = await fetch(`${server.url}/api/memory`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '以后周报都用中文', kind: 'rule', pinned: true }),
    })
    assert.equal(created.status, 201)
    const found = await (await fetch(`${server.url}/api/memory?query=${encodeURIComponent('周报')}`)).json()
    assert.equal(found.memories.length, 1)
    const catalog = await (await fetch(`${server.url}/api/memory`)).json()
    assert.ok(catalog.categories.length >= 1)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('file upload and download', async () => {
  const { ctx, server } = await setup([])
  try {
    const up = await fetch(`${server.url}/api/files?sessionId=web&name=hello.txt`, { method: 'POST', body: 'file-body' })
    assert.equal(up.status, 201)
    const down = await fetch(`${server.url}/api/files?sessionId=web&path=inbox/hello.txt`)
    assert.equal(await down.text(), 'file-body')
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('approval timeout denies', async () => {
  const { ctx, store, server } = await setup([
    [{ type: 'tool_call', call: { id: 'c1', name: 'danger', args: {} } }, { type: 'finish', reason: 'tool' }],
    [{ type: 'text', text: 'timeout' }, { type: 'finish', reason: 'stop' }],
  ], { approvalTimeoutMs: 50 })
  try {
    await fetch(`${server.url}/api/message`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'web', text: 'do it' }),
    })
    await waitFor(async () => store.events('web').some((e: any) => e.type === 'tool.result'), 2000)
    const result = store.events('web').find((e: any) => e.type === 'tool.result')
    assert.equal(result.data.ok, false)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('approval deny path blocks tool', async () => {
  const { ctx, store, server } = await setup([
    [{ type: 'tool_call', call: { id: 'c1', name: 'danger', args: {} } }, { type: 'finish', reason: 'tool' }],
    [{ type: 'text', text: 'blocked' }, { type: 'finish', reason: 'stop' }],
  ])
  try {
    await fetch(`${server.url}/api/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'web', text: 'do it' }),
    })
    await waitFor(async () => (await (await fetch(`${server.url}/api/approvals`)).json()).approvals.length > 0)
    const { approvals } = await (await fetch(`${server.url}/api/approvals`)).json()
    await fetch(`${server.url}/api/approvals/${approvals[0].id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'denied' }),
    })
    await waitFor(async () => store.events('web').some((e: any) => e.type === 'tool.result'))
    const toolResult = store.events('web').find((e: any) => e.type === 'tool.result')
    assert.equal(toolResult.data.ok, false)
    assert.match(toolResult.data.error, /not-approved/)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})
