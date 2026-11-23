import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, approvalPlugin, questionsPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import type { Tool } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store, storePlugin } from '@jaryn/store-sqlite'
import { startWebServer } from '../src/index.ts'
import { memoryPlugin } from '@jaryn/memory'
import { schedulerPlugin } from '@jaryn/scheduler'
import { computerPlugin } from '@jaryn/computer'
import { vaultPlugin, vaultToolsPlugin } from '@jaryn/vault'
import { artifactsPlugin, artifactToolsPlugin } from '@jaryn/artifacts'
import { pagesPlugin, pageToolsPlugin } from '@jaryn/pages'
import { initiativePlugin, initiativeToolsPlugin } from '@jaryn/initiative'
import { devicesPlugin } from '@jaryn/devices'

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
  await ctx.mount(questionsPlugin())
  await ctx.mount(approvalPlugin({ askRisks: ['execute', 'external', 'destructive'] }))
  await ctx.mount(schedulerPlugin())
  await ctx.mount(computerPlugin())
  await ctx.mount(vaultPlugin())
  await ctx.mount(vaultToolsPlugin())
  await ctx.mount(artifactsPlugin())
  await ctx.mount(artifactToolsPlugin())
  await ctx.mount(pagesPlugin())
  await ctx.mount(pageToolsPlugin())
  await ctx.mount(initiativePlugin())
  await ctx.mount(initiativeToolsPlugin())
  await ctx.mount(devicesPlugin())
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

test('API token auth and inbound email webhook', async () => {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', { register: () => () => {}, list: () => [], get: () => undefined, execute: async () => undefined })
  ctx.provide('llm', new FakeProvider([]))
  await ctx.mount(agentPlugin())
  await ctx.mount(questionsPlugin())
  await ctx.mount(approvalPlugin({ askRisks: ['execute', 'external', 'destructive'] }))
  const server = await startWebServer(ctx, { port: 0, apiToken: 'tok-1' })
  try {
    const denied = await fetch(`${server.url}/api/sessions`)
    assert.equal(denied.status, 401)
    const allowed = await fetch(`${server.url}/api/sessions`, { headers: { authorization: 'Bearer tok-1' } })
    assert.equal(allowed.status, 200)
    const email = await fetch(`${server.url}/api/email/inbound`, {
      method: 'POST', headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'a@b.c', subject: 'hi', text: 'hello' }),
    })
    assert.equal(email.status, 202)
    assert.ok(store.events('email').some((e: any) => e.type === 'input.email'))
  } finally { await server.close(); await ctx.dispose() }
})

test('serves PWA manifest and service worker', async () => {
  const { ctx, server } = await setup([])
  try {
    const manifest = await (await fetch(`${server.url}/manifest.json`)).json()
    assert.equal(manifest.short_name, 'jaryn')
    const sw = await fetch(`${server.url}/sw.js`)
    assert.equal(sw.status, 200)
    const html = await (await fetch(`${server.url}/`)).text()
    assert.match(html, /manifest\.json/)
  } finally { await server.close(); await ctx.dispose() }
})

test('serves UI and chat events', async () => {
  const { ctx, store, server } = await setup([[{ type: 'text', text: 'hello web' }, { type: 'finish', reason: 'stop' }]])
  try {
    const html = await (await fetch(`${server.url}/`)).text()
    assert.match(html, /jaryn/)
    assert.match(html, /panel-toggle/)
    assert.match(html, /stop-btn/)
    assert.match(html, /questions/)
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

test('session title, fork, archive and delete', async () => {
  const { ctx, store, server } = await setup([[{ type: 'text', text: 'hi' }, { type: 'finish', reason: 'stop' }]])
  try {
    await fetch(`${server.url}/api/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'web', text: 'hello' }) })
    await new Promise((r) => setTimeout(r, 100))
    const patched = await (await fetch(`${server.url}/api/sessions/web`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '周报会话' }) })).json()
    assert.equal(patched.session.title, '周报会话')
    const fork = await (await fetch(`${server.url}/api/sessions/web/fork`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'web-fork' }) })).json()
    assert.equal(fork.session.id, 'web-fork')
    assert.ok(store.events('web-fork').length > 0)
    await fetch(`${server.url}/api/sessions/web`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) })
    const list = await (await fetch(`${server.url}/api/sessions`)).json()
    assert.ok(!list.sessions.some((s: any) => s.id === 'web'))
    const del = await (await fetch(`${server.url}/api/sessions/web-fork`, { method: 'DELETE' })).json()
    assert.equal(del.deleted, true)
  } finally { await server.close(); await ctx.dispose() }
})

test('usage, audit and rules endpoints', async () => {
  const { ctx, store, server } = await setup([])
  try {
    store.recordUsage({ sessionId: 'web', inputTokens: 100, outputTokens: 50, costUsd: 0.01 })
    const usage = await (await fetch(`${server.url}/api/usage`)).json()
    assert.equal(usage.inputTokens, 100)
    const audit = await (await fetch(`${server.url}/api/audit`)).json()
    assert.ok(Array.isArray(audit.entries))
    const added = await (await fetch(`${server.url}/api/rules`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'shell.*', effect: 'deny' }),
    })).json()
    assert.equal(added.rules.length, 1)
    const list = await (await fetch(`${server.url}/api/rules`)).json()
    assert.equal(list.rules[0].effect, 'deny')
  } finally { await server.close(); await ctx.dispose() }
})

test('cancel endpoint reports no active turn', async () => {
  const { ctx, server } = await setup([])
  try {
    const res = await (await fetch(`${server.url}/api/sessions/web/cancel`, { method: 'POST' })).json()
    assert.equal(res.cancelled, false)
  } finally { await server.close(); await ctx.dispose() }
})

test('ask_user question round-trip over the web', async () => {
  const { ctx, server } = await setup([])
  try {
    const questions = ctx.get<any>('questions')
    const pending = questions.ask({ sessionId: 'web', question: 'Which repo?', options: ['a', 'b'] })
    let id = ''
    for (let i = 0; i < 40; i++) {
      const list = await (await fetch(`${server.url}/api/questions`)).json()
      if (list.pending.length > 0) { id = list.pending[0]; break }
      await new Promise((r) => setTimeout(r, 25))
    }
    assert.ok(id, 'question should be pending')
    await fetch(`${server.url}/api/questions/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: 'a' }),
    })
    assert.equal(await pending, 'a')
  } finally { await server.close(); await ctx.dispose() }
})

test('device pairing flow', async () => {
  const { ctx, server } = await setup([])
  try {
    const code = await (await fetch(`${server.url}/api/devices/pair-code`, { method: 'POST' })).json()
    assert.match(code.code, /^\d{6}$/)
    const paired = await (await fetch(`${server.url}/api/devices/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.code, name: 'phone' }),
    })).json()
    assert.ok(paired.token)
    const list = await (await fetch(`${server.url}/api/devices`)).json()
    assert.equal(list.devices.length, 1)
    const revoke = await (await fetch(`${server.url}/api/devices/${paired.deviceId}/revoke`, { method: 'POST' })).json()
    assert.equal(revoke.revoked, true)
  } finally { await server.close(); await ctx.dispose() }
})

test('initiative API creates, accepts and dismisses proposals', async () => {
  const { ctx, server } = await setup([])
  try {
    const initiative = ctx.get<any>('initiative')
    const created = initiative.ingest({ title: 'GitHub 授权过期', reason: '需要重连', impact: 1, urgency: 1, confidence: 1 }).created
    assert.ok(created)
    let list = await (await fetch(`${server.url}/api/initiative`)).json()
    assert.equal(list.proposals.length, 1)
    const accepted = await (await fetch(`${server.url}/api/initiative/${created.id}/accept`, { method: 'POST' })).json()
    assert.equal(accepted.proposal.status, 'accepted')
    list = await (await fetch(`${server.url}/api/initiative`)).json()
    assert.equal(list.proposals.length, 0)
  } finally { await server.close(); await ctx.dispose() }
})

test('pages create, render and share', async () => {
  const { ctx, server } = await setup([])
  try {
    const created = await (await fetch(`${server.url}/api/pages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '周报', template: 'table', data: [{ a: 1 }] }),
    })).json()
    const page = await (await fetch(`${server.url}/pages/${created.page.id}`)).text()
    assert.match(page, /周报/)
    assert.match(page, /Content-Security-Policy/)
    const share = await (await fetch(`${server.url}/api/pages/${created.page.id}/share`, { method: 'POST' })).json()
    const shared = await (await fetch(`${server.url}/p/${share.token}`)).text()
    assert.match(shared, /周报/)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('artifacts save and list', async () => {
  const { ctx, server } = await setup([])
  try {
    await fetch(`${server.url}/api/artifacts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a.txt', content: 'hello' }),
    })
    const list = await (await fetch(`${server.url}/api/artifacts`)).json()
    assert.equal(list.artifacts.length, 1)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('secure form stores a credential', async () => {
  const { ctx, server } = await setup([])
  try {
    const created = await (await fetch(`${server.url}/api/vault/secure-form`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'https://example.com', purpose: '登录' }),
    })).json()
    const page = await (await fetch(`${server.url}${created.url}`)).text()
    assert.match(page, /secure form/)
    const submit = await fetch(`${server.url}${created.url}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'me', password: 'pw' }).toString(),
    })
    assert.equal(submit.status, 200)
    const list = await (await fetch(`${server.url}/api/vault`)).json()
    assert.equal(list.items.length, 1)
    assert.equal(list.items[0].username, 'me')
    assert.equal(JSON.stringify(list.items).includes('pw'), false)
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
    const takeover = await (await fetch(`${server.url}/api/computer/takeover`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botId: 'bot-a', enabled: true }),
    })).json()
    assert.equal(takeover.takeover, true)
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
