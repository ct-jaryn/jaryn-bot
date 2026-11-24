import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, runTurn, toolRegistryPlugin } from '../src/index.ts'
import type { Tool } from '../src/index.ts'

function setup(outputSize: number) {
  const ctx = new Context({ scope: 'root' })
  const events: any[] = []
  const saved: any[] = []
  ctx.provide('store', {
    sessions: new Map<string, any>(),
    getSession() { return undefined },
    createSession(id: string, botId: string, cwd: string) { const s = { id, botId, cwd }; this.sessions.set(id, s); return s },
    append(e: any) { events.push(e); return { seq: events.length } },
    events() { return events },
    setSessionStatus() {},
  })
  ctx.provide('artifacts', {
    save(input: any) { const record = { id: `art_${saved.length}`, name: input.name, bytes: input.content.length }; saved.push({ ...input, record }); return record },
  })
  const big: Tool = {
    name: 'big', description: 'returns a lot', schema: { type: 'object' }, risk: 'read',
    async execute() { return 'x'.repeat(outputSize) },
  }
  let step = 0
  ctx.provide('llm', {
    name: 'fake',
    async *stream() {
      step++
      if (step === 1) { yield { type: 'tool_call', call: { id: 'c1', name: 'big', args: {} } }; yield { type: 'finish', reason: 'tool' }; return }
      yield { type: 'text', text: 'done' }
      yield { type: 'finish', reason: 'stop' }
    },
  })
  return { ctx, events, saved, big }
}

test('huge tool output is spilled to an artifact with a pointer', async () => {
  const h = setup(40_000)
  await h.ctx.mount(toolRegistryPlugin())
  h.ctx.get<any>('tools').register(h.big)
  await h.ctx.mount(agentPlugin())
  await runTurn(h.ctx, { sessionId: 's', text: 'go' })
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].content.length, 40_000)
  const toolResult = h.events.find((e) => e.type === 'tool.result')
  assert.ok(toolResult)
  assert.equal((toolResult.data ?? toolResult).ok, true)
})

test('small output passes through untouched', async () => {
  const h = setup(100)
  await h.ctx.mount(toolRegistryPlugin())
  h.ctx.get<any>('tools').register(h.big)
  await h.ctx.mount(agentPlugin())
  await runTurn(h.ctx, { sessionId: 's', text: 'go' })
  assert.equal(h.saved.length, 0)
})
