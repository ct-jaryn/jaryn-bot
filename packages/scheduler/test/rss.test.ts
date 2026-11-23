import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { fetchFeed, JobScheduler, schedulerPlugin } from '../src/index.ts'
import type { Tool } from '@jaryn/agent-core'

const FEED = (title: string) => `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://example.com/${title}</link></item></channel></rss>`

test('fetchFeed parses rss items', async () => {
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end(FEED('new-post')) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    const items = await fetchFeed(`http://127.0.0.1:${port}/feed`)
    assert.equal(items.length, 1)
    assert.equal(items[0]!.title, 'new-post')
  } finally { server.close() }
})

test('rss job dispatches once per new item', async () => {
  let title = 'first'
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end(FEED(title)) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  const tools = new Map<string, Tool>()
  ctx.provide('tools', {
    register: (t: Tool) => { tools.set(t.name, t); return () => tools.delete(t.name) },
    list: () => [...tools.values()],
    get: (n: string) => tools.get(n),
    execute: async () => undefined,
  } as any)
  ctx.provide('llm', new FakeProvider([]))
  ctx.provide('approvals', { request: async () => 'allowed' })
  try {
    await ctx.mount(agentPlugin())
    await ctx.mount(schedulerPlugin())
    const scheduler = ctx.get<JobScheduler>('scheduler')!
    const job = scheduler.add({ trigger: { kind: 'rss', url: `http://127.0.0.1:${port}/feed`, everySeconds: 60 }, mission: 'summarize new post' })
    await scheduler.pollFeeds({ force: true })
    await scheduler.pollFeeds({ force: true })
    assert.equal(scheduler.runs(job.id).length, 1)
    title = 'second'
    await scheduler.pollFeeds({ force: true })
    assert.equal(scheduler.runs(job.id).length, 2)
  } finally { await ctx.dispose(); server.close() }
})
