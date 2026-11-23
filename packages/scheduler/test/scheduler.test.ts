import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { JobScheduler, nextCron, schedulerPlugin } from '../src/index.ts'
import type { Tool } from '@jaryn/agent-core'

function ctxFor(script: any[][]) {
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
  tools.set('echo', {
    name: 'echo', description: 'echo', schema: { type: 'object' }, risk: 'read',
    async execute() { return 'ok' },
  })
  return { ctx, store }
}

async function mounted(script: any[][]) {
  const base = ctxFor(script)
  await base.ctx.mount(agentPlugin())
  await base.ctx.mount(schedulerPlugin())
  return { ...base, scheduler: base.ctx.get<JobScheduler>('scheduler')! }
}

test('cron next occurrence', () => {
  const next = nextCron('*/5 * * * *', 'UTC', new Date('2026-01-01T00:02:30Z'))
  assert.equal(next.toISOString(), '2026-01-01T00:05:00.000Z')
  const daily = nextCron('0 8 * * *', 'Asia/Shanghai', new Date('2026-01-01T00:00:00Z'))
  assert.equal(daily.toISOString(), '2026-01-02T00:00:00.000Z') // next 08:00 Shanghai
})

test('runNow executes a job and records the run', async () => {
  const { ctx, store, scheduler } = await mounted([[{ type: 'text', text: 'briefing done' }, { type: 'finish', reason: 'stop' }]])
  try {
    const job = scheduler.add({ botId: 'default', name: 'brief', trigger: { kind: 'every', seconds: 3600 }, mission: 'do briefing' })
    const run = await scheduler.runNow(job.id)
    assert.equal(run.status, 'done')
    assert.match(run.summary ?? '', /briefing done/)
    assert.ok(store.events(`job:${job.id}`).some((e: any) => e.type === 'turn.ended'))
    assert.equal(scheduler.runs(job.id).length, 1)
    assert.equal(scheduler.get(job.id)!.runCount, 1)
  } finally { await ctx.dispose() }
})

test('goal rounds continue until DONE', async () => {
  const { ctx, scheduler } = await mounted([
    [{ type: 'text', text: 'round one working' }, { type: 'finish', reason: 'stop' }],
    [{ type: 'text', text: 'DONE' }, { type: 'finish', reason: 'stop' }],
  ])
  try {
    const job = scheduler.add({ trigger: { kind: 'every', seconds: 3600 }, mission: 'finish report', budget: { maxRounds: 3 } })
    const run = await scheduler.runNow(job.id)
    assert.equal(run.rounds, 2)
    assert.equal(run.status, 'done')
  } finally { await ctx.dispose() }
})

test('budget cut stops the job', async () => {
  const { ctx, scheduler } = await mounted([
    [{ type: 'tool_call', call: { id: 'c1', name: 'echo', args: {} } }, { type: 'finish', reason: 'tool' }],
    [{ type: 'text', text: 'should not reach' }, { type: 'finish', reason: 'stop' }],
  ])
  try {
    const job = scheduler.add({ trigger: { kind: 'every', seconds: 3600 }, mission: 'loop', budget: { maxSteps: 1 } })
    const run = await scheduler.runNow(job.id)
    assert.equal(run.status, 'budget')
  } finally { await ctx.dispose() }
})

test('webhook requires a valid signature', async () => {
  const { ctx, scheduler } = await mounted([[{ type: 'text', text: 'hooked' }, { type: 'finish', reason: 'stop' }]])
  try {
    const job = scheduler.add({ trigger: { kind: 'webhook', path: 'test', secret: 's3cret' }, mission: 'handle hook' })
    await assert.rejects(() => scheduler.triggerWebhook(job.id, '{"x":1}', 'bad'), /invalid webhook signature/)
    const sig = createHmac('sha256', 's3cret').update('{"x":1}').digest('hex')
    const run = await scheduler.triggerWebhook(job.id, '{"x":1}', sig)
    assert.equal(run.status, 'done')
  } finally { await ctx.dispose() }
})
