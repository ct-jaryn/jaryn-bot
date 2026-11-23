import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { Context } from '@jaryn/kernel'
import { toolRegistryPlugin } from '@jaryn/agent-core'
import { PluginHostProcess, pluginHostPlugin } from '../src/index.ts'

const ROOT = resolve(import.meta.dirname, '../../..')
const ENTRY = join(ROOT, 'examples/plugin-host/echo-plugin.ts')

test('hosts an out-of-process plugin and calls its tools', async () => {
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(toolRegistryPlugin())
  await ctx.mount(pluginHostPlugin({ hosts: [{ id: 'demo', command: process.execPath, args: [ENTRY] }] }))
  const tools = ctx.get<any>('tools')
  try {
    for (let i = 0; i < 60; i++) {
      if (tools.list().some((t: any) => t.name === 'demo.echo')) break
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.ok(tools.list().some((t: any) => t.name === 'demo.echo'))
    const out = await tools.execute('demo.echo', { text: 'hi' }, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' })
    assert.deepEqual(out, { echo: 'hi' })
    const sum = await tools.execute('demo.sum', { values: [1, 2, 3] }, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' })
    assert.deepEqual(sum, { sum: 6 })
  } finally {
    await ctx.dispose()
  }
})

test('host reports errors from child as tool errors', async () => {
  const host = new PluginHostProcess({ id: 'demo', command: process.execPath, args: [ENTRY] })
  await host.start()
  try {
    await assert.rejects(() => host.call('nope', {}), /unknown tool/)
  } finally { host.stop() }
})
