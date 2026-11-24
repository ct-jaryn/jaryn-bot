import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, approvalPlugin, runTurn, toolRegistryPlugin } from '../src/index.ts'
import type { Tool } from '../src/index.ts'

function setup(rules: any[]) {
  const ctx = new Context({ scope: 'root' })
  const events: any[] = []
  const approvals: any[] = []
  ctx.provide('store', {
    sessions: new Map<string, any>(),
    getSession() { return undefined },
    createSession(id: string, botId: string, cwd: string) { const s = { id, botId, cwd }; this.sessions.set(id, s); return s },
    append(e: any) { events.push(e); return { seq: events.length } },
    events() { return events },
    setSessionStatus() {},
    recordApproval(row: any) { approvals.push(row) },
    audit() {},
  })
  let executed = 0
  const danger: Tool = {
    name: 'danger', description: 'd', schema: { type: 'object' }, risk: 'execute',
    async execute() { executed++; return 'ran' },
  }
  let step = 0
  ctx.provide('llm', {
    name: 'fake',
    async *stream() {
      step++
      if (step === 1) { yield { type: 'tool_call', call: { id: 'c1', name: 'danger', args: {} } }; yield { type: 'finish', reason: 'tool' }; return }
      yield { type: 'text', text: 'done' }
      yield { type: 'finish', reason: 'stop' }
    },
  })
  return { ctx, events, approvals, executed: () => executed, rules, danger }
}

test('background turn denies ask-risk tool instantly instead of waiting', async () => {
  const h = setup([])
  await h.ctx.mount(toolRegistryPlugin())
  h.ctx.get<any>('tools').register(h.danger)
  await h.ctx.mount(approvalPlugin({ askRisks: ['execute'] }))
  await h.ctx.mount(agentPlugin())
  const started = Date.now()
  await runTurn(h.ctx, { sessionId: 'job:1', text: 'go', provenance: 'system' })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 2000, `should fail fast, took ${elapsed}ms`)
  assert.equal(h.executed(), 0)
  assert.equal(h.approvals[0].status, 'denied')
  assert.equal(h.approvals[0].resolver, 'background-policy')
})

test('background turn can run when an allow rule matches', async () => {
  const h = setup([])
  await h.ctx.mount(toolRegistryPlugin())
  h.ctx.get<any>('tools').register(h.danger)
  await h.ctx.mount(approvalPlugin({ askRisks: ['execute'], rules: [{ tool: 'danger', effect: 'allow' }] }))
  await h.ctx.mount(agentPlugin())
  await runTurn(h.ctx, { sessionId: 'job:2', text: 'go', provenance: 'system' })
  assert.equal(h.executed(), 1)
})
