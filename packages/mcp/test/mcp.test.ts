import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Context } from '@jaryn/kernel'
import { toolRegistryPlugin } from '@jaryn/agent-core'
import { mcpPlugin } from '../src/index.ts'

test('connects to a stdio MCP server and registers tools', async () => {
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(toolRegistryPlugin())
  await ctx.mount(mcpPlugin({
    servers: [{ name: 'fake', command: process.execPath, args: [join(import.meta.dirname, 'fake-server.ts')] }],
  }))
  const tools = ctx.get<any>('tools')
  const names = tools.list().map((t: any) => t.name)
  assert.ok(names.includes('mcp.fake.echo'), names.join(','))
  const out = await tools.execute('mcp.fake.echo', { text: 'hi' }, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' })
  assert.match(String(out), /mcp-echo:hi/)
  await ctx.dispose()
})
