import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { runTurn } from '../src/index.ts'
import type { Tool } from '../src/index.ts'

function harness(calls: { id: string; name: string }[]) {
  const ctx = new Context({ scope: 'root' })
  const events: any[] = []
  ctx.provide('store', {
    sessions: new Map<string, any>(),
    getSession() { return undefined },
    createSession(id: string, botId: string, cwd: string) { const s = { id, botId, cwd }; this.sessions.set(id, s); return s },
    append(e: any) { events.push(e); return { seq: events.length } },
    events() { return events },
    setSessionStatus() {},
  })
  const tools = new Map<string, Tool>()
  ctx.provide('tools', {
    register: (t: Tool) => { tools.set(t.name, t); return () => tools.delete(t.name) },
    list: () => [...tools.values()],
    get: (n: string) => tools.get(n),
    execute: async (n: string, a: any) => tools.get(n)!.execute(a, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' }),
  })
  const running: string[] = []
  let active = 0
  let maxActive = 0
  const slow = (name: string, wait: number): Tool => ({
    name, description: name, schema: { type: 'object' }, risk: 'read', parallelSafe: true,
    async execute() {
      running.push(name); active++; maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, wait))
      active--; return name
    },
  })
  tools.set('slow-a', slow('slow-a', 60))
  tools.set('slow-b', slow('slow-b', 60))
  tools.set('serial', { ...slow('serial', 20), parallelSafe: false } as Tool)
  let round = 0
  ctx.provide('llm', {
    name: 'fake',
    async *stream() {
      round++
      if (round === 1) { for (const c of calls) yield { type: 'tool_call', call: { id: c.id, name: c.name, args: {} } }; yield { type: 'finish', reason: 'tool' }; return }
      yield { type: 'text', text: 'done' }
      yield { type: 'finish', reason: 'stop' }
    },
  })
  return { ctx, events, getMax: () => maxActive, running }
}

test('parallel-safe read tools run concurrently', async () => {
  const h = harness([{ id: '1', name: 'slow-a' }, { id: '2', name: 'slow-b' }])
  await runTurn(h.ctx, { sessionId: 's', text: 'go' })
  // Concurrency is the real assertion; wall-clock varies on loaded CI machines.
  assert.equal(h.getMax(), 2)
  const toolMessages = h.events.filter((e) => e.type === 'tool.result')
  assert.equal(toolMessages.length, 2)
})

test('non parallel-safe tools stay serial', async () => {
  const h = harness([{ id: '1', name: 'slow-a' }, { id: '2', name: 'serial' }])
  await runTurn(h.ctx, { sessionId: 's', text: 'go' })
  assert.equal(h.getMax(), 1)
})
