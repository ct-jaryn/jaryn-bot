import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, runTurn, toolRegistryPlugin } from '../src/index.ts'
import type { Tool } from '../src/index.ts'

function build(script: any[][]) {
  const ctx = new Context({ scope: 'root' })
  const events: any[] = []
  const store = {
    sessions: new Map<string, { id: string; cwd: string }>(),
    getSession(id: string) { return this.sessions.get(id) },
    createSession(id: string, _bot: string, cwd: string) { const s = { id, cwd }; this.sessions.set(id, s); return s },
    append(e: any) { events.push(e); return { seq: events.length } },
    events() { return events },
    setSessionStatus() {},
  }
  ctx.provide('store', store)
  const tools = new Map<string, Tool>()
  ctx.provide('tools', {
    register: (t: Tool) => { tools.set(t.name, t); return () => tools.delete(t.name) },
    list: () => [...tools.values()],
    get: (n: string) => tools.get(n),
    execute: async (n: string, a: any) => tools.get(n)!.execute(a, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' }),
  })
  const fake: any = {
    name: 'fake',
    async *stream() {
      const turn = script.shift() ?? [{ type: 'text', text: 'done' }, { type: 'finish', reason: 'stop' }]
      for (const d of turn) yield d
    },
  }
  ctx.provide('llm', fake)
  tools.set('echo', {
    name: 'echo', description: 'echo', schema: { type: 'object' }, risk: 'read',
    async execute(args) { return `echo:${args.text}` },
  })
  return { ctx, tools, events }
}

test('runTurn records events and returns text', async () => {
  const { ctx, events } = build([[{ type: 'text', text: 'hello' }, { type: 'finish', reason: 'stop' }]])
  const result = await runTurn(ctx, { sessionId: 's1', text: 'hi' })
  assert.equal(result.text, 'hello')
  assert.equal(result.finishReason, 'completed')
  assert.ok(events.some((e) => e.type === 'turn.started'))
  assert.ok(events.some((e) => e.type === 'turn.ended'))
  assert.ok(events.some((e) => e.type === 'assistant.message'))
})

test('runTurn executes a tool then continues', async () => {
  const { ctx, events } = build([
    [{ type: 'tool_call', call: { id: 'c1', name: 'echo', args: { text: 'x' } } }, { type: 'finish', reason: 'tool' }],
    [{ type: 'text', text: 'tool done' }, { type: 'finish', reason: 'stop' }],
  ])
  const result = await runTurn(ctx, { sessionId: 's2', text: 'use tool' })
  assert.equal(result.text, 'tool done')
  assert.equal(result.toolCalls, 1)
  const resultEvent = events.find((e) => e.type === 'tool.result')
  assert.equal(resultEvent.data.ok, true)
  assert.equal(resultEvent.data.output, 'echo:x')
})

test('agent plugin mounts when dependencies present', async () => {
  const { ctx } = build([])
  await ctx.mount(agentPlugin())
  const agent = ctx.get<any>('agent')
  assert.equal(typeof agent.runTurn, 'function')
})
