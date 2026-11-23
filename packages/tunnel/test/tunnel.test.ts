import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { request } from 'node:http'
import { Context } from '@jaryn/kernel'
import { startWebServer } from '@jaryn/web'
import { TunnelClient } from '../src/index.ts'

test('client tunnel proxies HTTP through the server', async () => {
  const target = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('via-tunnel:' + req.url) })
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r))
  const targetPort = (target.address() as any).port
  const ctx = new Context({ scope: 'root' })
  const web = await startWebServer(ctx, { port: 0 })
  const client = new TunnelClient(`ws://127.0.0.1:${new URL(web.url).port}/tunnel`)
  await client.connect()
  try {
    let status: any
    for (let i = 0; i < 50; i++) {
      status = await (await fetch(`${web.url}/api/tunnel`)).json()
      if (status.connected && status.proxyPort) break
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.equal(status.connected, true)
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: status.proxyPort, method: 'GET', path: `http://127.0.0.1:${targetPort}/hello` }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      req.on('error', reject)
      req.end()
    })
    assert.match(body, /via-tunnel:\/hello/)
  } finally {
    client.close()
    await web.close()
    await ctx.dispose()
    target.close()
  }
})
