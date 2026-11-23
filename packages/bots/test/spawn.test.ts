import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import type { Tool } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { DatabaseSync } from 'node:sqlite'
import { botsPlugin, botToolsPlugin, BotsService } from '../src/index.ts'

test('spawn_worker runs a child session in the bot workspace', async () => {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', {
    register: (t: Tool) => {
      tools.set(t.name, t)
      return () => tools.delete(t.name)
    },
    list: () => [...tools.values()],
    get: (n: string) => tools.get(n),
    execute: async (n: string, a: any) => tools.get(n)!.execute(a, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' }),
  } as any)
  const tools = new Map<string, Tool>()
  ctx.provide('llm', new FakeProvider([[{ type: 'text', text: 'child done' }, { type: 'finish', reason: 'stop' }]]))
  ctx.provide('approvals', { request: async () => 'allowed' })
  await ctx.mount(agentPlugin())
  await ctx.mount(botsPlugin({ home: mkdtempSync(join(tmpdir(), 'jary-bots-')) }))
  await ctx.mount(botToolsPlugin())
  const bots = ctx.get<BotsService>('bots')!
  bots.add({ id: 'researcher', name: '研究员' })
  const out = await ctx.get<any>('tools').execute('spawn_worker', { botId: 'researcher', task: 'check docs' }, {
    signal: new AbortController().signal, sessionId: 'root', cwd: process.cwd(),
  })
  assert.equal(out.botId, 'researcher')
  assert.match(out.text, /child done/)
  const child = store.getSession(out.sessionId)!
  assert.equal(child.botId, 'researcher')
  assert.equal(child.cwd, bots.get('researcher')!.workspace)
})

test('bot edit updates persona and workspace', () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-bots-'))
  const bots = new BotsService(new DatabaseSync(':memory:'), home)
  bots.add({ id: 'writer' })
  const edited = bots.edit('writer', { persona: '只写结论', name: '写手' })
  assert.equal(edited.persona, '只写结论')
  assert.equal(edited.name, '写手')
})
