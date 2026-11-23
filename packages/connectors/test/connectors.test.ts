import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@jaryn/kernel'
import { toolRegistryPlugin } from '@jaryn/agent-core'
import { connectorsPlugin } from '../src/index.ts'

test('api-key connector calls HTTP with auth header', async () => {
  process.env.TEST_CONNECTOR_KEY = 'k-123'
  const requests: any[] = []
  const server = createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers['x-api-key'] })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ hello: 'world', path: req.url }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  const ctx = new Context({ scope: 'root' })
  try {
    await ctx.mount(toolRegistryPlugin())
    await ctx.mount(connectorsPlugin({
      servers: [{
        id: 'demo', name: 'Demo', baseUrl: `http://127.0.0.1:${port}`,
        auth: { type: 'api_key', header: 'x-api-key', env: 'TEST_CONNECTOR_KEY' },
        tools: [{ name: 'echo', description: 'echo', method: 'GET', path: '/items/:id', risk: 'network' }],
      }],
    }))
    const tools = ctx.get<any>('tools')
    assert.ok(tools.list().some((t: any) => t.name === 'demo.echo'))
    const out = await tools.execute('demo.echo', { id: '42' }, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' })
    assert.match(JSON.stringify(out), /hello/)
    assert.equal(requests[0].auth, 'k-123')
    assert.match(requests[0].url, /\/items\/42/)
  } finally {
    await ctx.dispose()
    server.close()
  }
})
