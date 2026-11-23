import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, approvalPlugin, runTurn, RuleEngine, GrantStore, toolRegistryPlugin } from '../src/index.ts'
import type { Tool } from '../src/index.ts'

function setup(usagePerStep: { inputTokens: number; outputTokens: number } | null, pricing?: any) {
  const ctx = new Context({ scope: 'root' })
  const events: any[] = []
  const usageRows: any[] = []
  const approvals: any[] = []
  const audit: any[] = []
  const store = {
    sessions: new Map<string, any>(),
    getSession(id: string) { return this.sessions.get(id) },
    createSession(id: string, botId: string, cwd: string) { const s = { id, botId, cwd }; this.sessions.set(id, s); return s },
    append(e: any) { events.push(e); return { seq: events.length } },
    events() { return events },
    setSessionStatus() {},
    recordUsage(r: any) { usageRows.push(r) },
    recordApproval(r: any) { approvals.push(r) },
    audit(...args: any[]) { audit.push(args) },
  }
  ctx.provide('store', store)
  const tools = new Map<string, Tool>()
  ctx.provide('tools', {
    register: (t: Tool) => { tools.set(t.name, t); return () => tools.delete(t.name) },
    list: () => [...tools.values()],
    get: (n: string) => tools.get(n),
    execute: async (n: string, a: any) => tools.get(n)!.execute(a, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' }),
  })
  let step = 0
  const llm = {
    name: 'fake',
    async *stream() {
      step++
      if (usagePerStep) yield { type: 'usage', usage: usagePerStep }
      if (step === 1) yield { type: 'tool_call', call: { id: 'c1', name: 'danger', args: {} } }
      else yield { type: 'text', text: 'done' }
      yield { type: 'finish', reason: step === 1 ? 'tool' : 'stop' }
    },
  }
  ctx.provide('llm', llm)
  if (pricing) ctx.provide('pricing', pricing)
  tools.set('danger', { name: 'danger', description: 'd', schema: { type: 'object' }, risk: 'execute', async execute() { return 'ok' } })
  return { ctx, store, usageRows, approvals, audit }
}

test('usage is recorded and cost budget stops the turn', async () => {
  const { ctx, usageRows, audit } = setup({ inputTokens: 1_000_000, outputTokens: 0 }, { inputPer1M: 1, outputPer1M: 2 })
  await ctx.mount(approvalPlugin({ askRisks: [] }))
  await ctx.mount(agentPlugin())
  const result = await runTurn(ctx, { sessionId: 'u1', text: 'go', limits: { maxCostUsd: 0.5 } })
  assert.equal(result.finishReason, 'budget')
  assert.equal(usageRows.length, 1)
  assert.ok(usageRows[0].costUsd >= 1)
  assert.ok(audit.some((a) => a[0] === 'turn.ended'))
})

test('rules deny > ask > allow and grants pre-approve', async () => {
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(toolRegistryPlugin())
  const plugin = approvalPlugin({ rules: [
    { tool: 'shell.*', effect: 'deny', reason: 'no shell' },
    { tool: 'mcp.*', effect: 'allow' },
    { tool: '*', risk: ['execute'], effect: 'ask' },
  ] })
  await ctx.mount(plugin)
  const svc: any = ctx.get('approvalRules')
  const engine: RuleEngine = svc.rules
  assert.equal(engine.evaluate({ tool: 'shell.run', risk: 'execute' })?.effect, 'deny')
  assert.equal(engine.evaluate({ tool: 'mcp.x.y', risk: 'external' })?.effect, 'allow')
  assert.equal(engine.evaluate({ tool: 'other', risk: 'execute' })?.effect, 'ask')
  assert.equal(engine.evaluate({ tool: 'other', risk: 'read' }), undefined)

  // ask path fails closed without an answerer
  const approvals: any = ctx.get('approvals')
  const decision = await approvals.request({ id: 'a1', sessionId: 's1', turnId: 't', toolName: 'other', risk: 'execute', args: {} })
  assert.equal(decision, 'denied')
  // session grant bypasses ask
  svc.grants.grantSession('s1', 'other')
  const granted = await approvals.request({ id: 'a2', sessionId: 's1', turnId: 't', toolName: 'other', risk: 'execute', args: {} })
  assert.equal(granted, 'allowed')
})

test('grant store consumes once-grants', () => {
  const grants = new GrantStore()
  grants.grantOnce('s', 't')
  assert.equal(grants.consume('s', 't'), true)
  assert.equal(grants.consume('s', 't'), false)
})
