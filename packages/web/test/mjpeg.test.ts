import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { ComputerService } from '@jaryn/computer'
import { startWebServer } from '../src/index.ts'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const available = existsSync(CHROME)

test('mjpeg endpoint streams multipart frames', { skip: !available, timeout: 40_000 }, async () => {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', { register: () => () => {}, list: () => [], get: () => undefined, execute: async () => undefined } as any)
  ctx.provide('llm', new FakeProvider([]))
  const computer = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-mjpeg-')), chromePath: CHROME })
  ctx.provide('computer', computer)
  await ctx.mount(agentPlugin())
  const server = await startWebServer(ctx, { port: 0 })
  const controller = new AbortController()
  try {
    const client = await computer.client('bot-mjpeg')
    await client.navigate('data:text/html,<h1>mjpeg</h1>')
    const res = await fetch(`${server.url}/api/computer/mjpeg?botId=bot-mjpeg`, { signal: controller.signal })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /multipart\/x-mixed-replace/)
    const reader = res.body!.getReader()
    let text = ''
    const timer = setTimeout(() => controller.abort(), 12_000)
    try {
      while (!text.includes('Content-Length')) {
        await client.evaluate('document.body.style.opacity = document.body.style.opacity === "1" ? "0.999" : "1"').catch(() => undefined)
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value?: Uint8Array; done: boolean }>((resolve) => setTimeout(() => resolve({ done: true }), 300)),
        ])
        if (done) break
        if (value) text += Buffer.from(value).toString('latin1')
      }
    } catch { /* aborted */ } finally { clearTimeout(timer); controller.abort() }
    assert.match(text, /Content-Type: image\/jpeg/)
  } finally {
    controller.abort()
    await server.close()
    await computer.shutdown()
    await ctx.dispose()
  }
})
