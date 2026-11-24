import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { startWebServer } from '../src/index.ts'

/** Tiny WS client (text frames, client-side masking) for the JSON-RPC tests. */
function wsConnect(port: number, path: string) {
  const socket = connect({ host: '127.0.0.1', port })
  const key = randomBytes(16).toString('base64')
  const messages: any[] = []
  let buffer = Buffer.alloc(0)
  let handshakeDone = false
  let resolveReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => { resolveReady = resolve })
  socket.on('connect', () => {
    socket.write([
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '', '',
    ].join('\r\n'))
  })
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd >= 0 && !handshakeDone) {
      handshakeDone = true
      buffer = buffer.subarray(headerEnd + 4)
      resolveReady!()
    }
    while (buffer.length >= 2) {
      const opcode = buffer[0]! & 0x0f
      let len = buffer[1]! & 0x7f
      let offset = 2
      if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); offset = 4 }
      else if (len === 127) { if (buffer.length < 10) return; len = Number(buffer.readBigUInt64BE(2)); offset = 10 }
      if (buffer.length < offset + len) return
      const payload = buffer.subarray(offset, offset + len)
      buffer = buffer.subarray(offset + len)
      if (opcode === 1) messages.push(JSON.parse(payload.toString('utf8')))
    }
  })
  socket.on('error', () => {})
  const send = (obj: unknown) => {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8')
    const mask = randomBytes(4)
    let header: Buffer
    if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length])
    else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xfe; header.writeUInt16BE(payload.length, 2) }
    const masked = Buffer.from(payload)
    for (let i = 0; i < masked.length; i++) masked[i]! ^= mask[i % 4]!
    socket.write(Buffer.concat([header, mask, masked]))
  }
  const close = () => socket.destroy()
  return { ready, messages, send, close, key }
}

async function setup() {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('llm', new FakeProvider([[{ type: 'text', text: 'ws hello' }, { type: 'finish', reason: 'stop' }]]))
  await ctx.mount(toolRegistryPlugin())
  await ctx.mount(agentPlugin())
  const server = await startWebServer(ctx, { port: 0 })
  return { ctx, store, server }
}

const waitFor = async (messages: any[], predicate: (m: any) => boolean, timeout = 5000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const hit = messages.find(predicate)
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out; got ${JSON.stringify(messages)}`)
}

test('ws/client: handshake, ping, session create/list', async () => {
  const { ctx, server } = await setup()
  const port = Number(new URL(server.url).port)
  const ws = wsConnect(port, '/ws/client')
  try {
    await ws.ready
    await waitFor(ws.messages, (m) => m.event === 'ready')
    ws.send({ id: 1, method: 'ping' })
    const pong = await waitFor(ws.messages, (m) => m.id === 1)
    assert.ok(pong.result.pong > 0)
    ws.send({ id: 2, method: 'session.create', params: { id: 'ws-a', botId: 'default' } })
    const created = await waitFor(ws.messages, (m) => m.id === 2)
    assert.equal(created.result.session.id, 'ws-a')
    ws.send({ id: 3, method: 'session.list' })
    const list = await waitFor(ws.messages, (m) => m.id === 3)
    assert.ok(list.result.sessions.some((s: any) => s.id === 'ws-a'))
    ws.send({ id: 4, method: 'nope' })
    const bad = await waitFor(ws.messages, (m) => m.id === 4)
    assert.match(bad.error, /unknown method/)
  } finally {
    ws.close()
    await server.close()
    await ctx.dispose()
  }
})

test('ws/client: turn.send streams deltas and end event', async () => {
  const { ctx, server } = await setup()
  const port = Number(new URL(server.url).port)
  const ws = wsConnect(port, '/ws/client')
  try {
    await ws.ready
    await waitFor(ws.messages, (m) => m.event === 'ready')
    ws.send({ id: 1, method: 'session.create', params: { id: 'ws-turn' } })
    await waitFor(ws.messages, (m) => m.id === 1)
    ws.send({ id: 2, method: 'turn.send', params: { sessionId: 'ws-turn', text: 'hi' } })
    const accepted = await waitFor(ws.messages, (m) => m.id === 2)
    assert.equal(accepted.result.accepted, true)
    const end = await waitFor(ws.messages, (m) => m.event === 'turn.end')
    assert.ok(['stop', 'completed'].includes(end.data.finishReason))
    assert.match(end.data.text, /ws hello/)
  } finally {
    ws.close()
    await server.close()
    await ctx.dispose()
  }
})

test('ws/client rejects unauthorized connections when a token is set', async () => {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('llm', new FakeProvider([]))
  await ctx.mount(toolRegistryPlugin())
  await ctx.mount(agentPlugin())
  const server = await startWebServer(ctx, { port: 0, apiToken: 'secret' })
  const port = Number(new URL(server.url).port)
  const ws = wsConnect(port, '/ws/client')
  try {
    await ws.ready
    await new Promise((r) => setTimeout(r, 150))
    assert.equal(ws.messages.length, 0)
  } finally {
    ws.close()
    await server.close()
    await ctx.dispose()
  }
})
