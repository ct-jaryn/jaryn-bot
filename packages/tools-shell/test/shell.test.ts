import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { Context } from '@jaryn/kernel'
import { shellPlugin, shellTool } from '../src/index.ts'
import { toolRegistryPlugin } from '@jaryn/agent-core'

test('shell tool runs a command', async () => {
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(toolRegistryPlugin())
  const tools = ctx.get<any>('tools')
  const dispose = tools.register(shellTool())
  const out = await tools.execute('shell.run', { command: 'printf hi' }, { signal: new AbortController().signal, sessionId: 's', cwd: tmpdir() })
  assert.match(String(out), /hi/)
  dispose()
  await ctx.dispose()
})

test('shell plugin registers tool', async () => {
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(toolRegistryPlugin())
  await ctx.mount(shellPlugin())
  assert.ok(ctx.get<any>('tools').list().some((t: any) => t.name === 'shell.run'))
  await ctx.dispose()
})
